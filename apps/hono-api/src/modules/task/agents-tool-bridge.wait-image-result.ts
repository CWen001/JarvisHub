import { z } from "zod";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
  PublicFlowGraphSchema,
  PublicFlowPatchResponseSchema,
  optionalNonEmptyString,
} from "../flow/flow.public.schemas";
import { applyPublicFlowGraphPatch } from "../flow/flow.public.service";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import {
  getFlowByIdUnsafe,
  getFlowForOwner,
  mapFlowRowToDto,
  type FlowRow,
} from "../flow/flow.repo";
import { optimisticCanvasWrite } from "../flow/flow.optimistic-write";
import { isHostedAssetUrl } from "../asset/asset.hosting";
import { resolveRustfsConfig } from "../asset/rustfs.client";
import { fetchTaskResultForPolling } from "./task.polling";
import type { TaskRequestDto, TaskResultDto } from "./task.schemas";
import {
  buildImageFailureMessage,
  extractImageAssetFromTaskResult,
  readTrimmedString,
  type ExtractedImageAsset,
} from "./agents-tool-bridge.image-result";
import { validateWebPageAssetTransparency } from "./webpage-asset-transparency";
import { prepareGeneratedImageAssetForCanvas } from "./generated-image-postprocess";

export const IMAGE_WAIT_DEFAULT_TIMEOUT_MS = 7_140_000;
const IMAGE_WAIT_POLL_INTERVAL_MS = 3_000;

const PublicAgentsImageWaitForResultArgsSchema = z.object({
  nodeId: optionalNonEmptyString,
  taskId: optionalNonEmptyString,
}).strict();

type PublicAgentsImageWaitForResultArgs = z.infer<
  typeof PublicAgentsImageWaitForResultArgsSchema
>;

type PublicAgentsImageWaitForResultSuccessResult = {
  ok: true;
  flowId: string;
  updatedAt: string;
  stats: {
    createdNodes: number;
    createdEdges: number;
    patchedNodes: number;
    appendedArrays: number;
  };
  nodeId: string;
  status: "success";
  pending: false;
  imageUrl: string;
  vendor: string;
  taskId: string;
};

type PublicAgentsImageWaitForResultPendingResult = {
  ok: true;
  flowId: string;
  updatedAt: string;
  stats: PublicAgentsImageWaitForResultSuccessResult["stats"];
  nodeId: string;
  status: "pending";
  pending: true;
  imageUrl: null;
  vendor: string;
  taskId: string;
  taskStatus: "queued" | "running" | "unknown";
  transientError?: {
    httpStatus?: number;
    message?: string;
    body?: unknown;
  };
};

export type PublicAgentsImageWaitForResultResult =
  | PublicAgentsImageWaitForResultSuccessResult
  | PublicAgentsImageWaitForResultPendingResult;

type ImageNodeRuntimeContext = {
  nodeId: string;
  taskId: string;
  vendor: string;
  prompt: string;
  taskKind: Extract<TaskRequestDto["kind"], "text_to_image" | "image_edit">;
  label: string;
  imageModel: string | null;
};

type ExistingImageNodeCompletion = {
  row: FlowRow;
  nodeId: string;
  taskId: string;
  vendor: string;
  asset: ExtractedImageAsset;
  nodeData: Record<string, unknown>;
};

type ExistingImageNodeFailure = {
  nodeId: string;
  taskId: string;
  vendor: string;
  message: string;
  code: string;
  httpStatus: number;
  lastError: unknown;
};

type ImageWaitCompletion =
  | {
      source: "task";
      vendor: string;
      result: TaskResultDto;
      asset: ExtractedImageAsset;
    }
  | {
      source: "flow";
      completion: ExistingImageNodeCompletion;
    }
  | {
      source: "pending";
      vendor: string;
      taskStatus: "queued" | "running" | "unknown";
      transientError?: PublicAgentsImageWaitForResultPendingResult["transientError"];
    };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function imageWaitDelayBeforeNextPoll(deadline: number): number {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return 0;
  return Math.min(IMAGE_WAIT_POLL_INTERVAL_MS, remainingMs);
}

export type ImageResultSettleOnceResult =
  | {
      outcome: "success";
      result: PublicAgentsImageWaitForResultResult;
    }
  | {
      outcome: "pending";
      flowId: string;
      nodeId: string;
      taskId: string;
      vendor: string;
      taskStatus: "queued" | "running";
    }
  | {
      outcome: "skipped";
      flowId: string;
      nodeId: string;
      taskId: string;
      vendor: string;
      reason: "already_completed" | "already_failed";
    }
  | {
      outcome: "failed";
      flowId: string;
      nodeId: string;
      taskId: string;
      vendor: string;
      errorCode: string;
      errorMessage: string;
    }
  | {
      outcome: "transient_error";
      flowId: string;
      nodeId: string;
      taskId: string;
      vendor: string;
      httpStatus?: number;
      message?: string;
      body?: unknown;
    };

function isHostedImageAsset(c: AppContext, asset: ExtractedImageAsset): boolean {
  return Boolean(asset.imageUrl && isHostedAssetUrl(c, asset.imageUrl));
}

function hasObjectStorageConfig(c: AppContext): boolean {
  return Boolean(resolveRustfsConfig(c.env));
}

function canUseUnhostedImageAsset(c: AppContext, asset: ExtractedImageAsset): boolean {
  return Boolean(asset.imageUrl && !hasObjectStorageConfig(c));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFlowGraphNode(value: unknown): value is { id?: unknown; data?: unknown } {
  return isRecord(value);
}

function isImageNodeKind(value: unknown): boolean {
  const kind = readTrimmedString(value);
  return kind === "image" || kind === "imageEdit";
}

function readTaskKind(data: Record<string, unknown>): ImageNodeRuntimeContext["taskKind"] {
  const explicit = readTrimmedString(data.imageTaskKind) || readTrimmedString(data.taskKind);
  if (explicit === "image_edit" || explicit === "text_to_image") return explicit;
  const hasReferences =
    (Array.isArray(data.referenceImages) && data.referenceImages.length > 0) ||
    (Array.isArray(data.assetInputs) && data.assetInputs.length > 0);
  return hasReferences ? "image_edit" : "text_to_image";
}

function logImageWaitEvent(input: {
  event: string;
  nodeId: string;
  taskId: string;
  vendor: string | null;
  elapsedMs: number;
  status?: string;
  httpStatus?: number;
  timeoutMs?: number;
}): void {
  const parts = [
    `event=${input.event}`,
    `nodeId=${input.nodeId}`,
    `taskId=${input.taskId}`,
    `vendor=${input.vendor || "n/a"}`,
    `elapsedMs=${input.elapsedMs}`,
  ];
  if (input.status) parts.push(`status=${input.status}`);
  if (typeof input.httpStatus === "number") parts.push(`httpStatus=${input.httpStatus}`);
  if (typeof input.timeoutMs === "number") parts.push(`timeoutMs=${input.timeoutMs}`);
  console.info(`[agents-image-wait] ${parts.join(" ")}`);
}

function readFlowGraph(row: FlowRow): z.infer<typeof PublicFlowGraphSchema> {
  const dto = mapFlowRowToDto(row);
  const current = sanitizeFlowDataForStorage(dto.data ?? {});
  const parsed = PublicFlowGraphSchema.safeParse(current);
  if (!parsed.success) {
    throw new AppError("Flow data invalid", {
      status: 500,
      code: "flow_data_invalid",
      details: { issues: parsed.error.issues },
    });
  }
  return parsed.data;
}

function buildEmptyPatchStats(): PublicAgentsImageWaitForResultResult["stats"] {
  return {
    createdNodes: 0,
    createdEdges: 0,
    patchedNodes: 0,
    appendedArrays: 0,
  };
}

function readExistingImageNodeCompletion(input: {
  c: AppContext;
  row: FlowRow;
  nodeId: string;
  fallbackTaskId: string;
  fallbackVendor: string;
}): ExistingImageNodeCompletion | null {
  const graph = readFlowGraph(input.row);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isFlowGraphNode) : [];
  const node = nodes.find((item) => readTrimmedString(item.id) === input.nodeId);
  if (!node) return null;
  const data = isRecord(node.data) ? node.data : {};
  if (!isImageNodeKind(data.kind)) return null;
  const activeTaskId =
    readTrimmedString(data.imageTaskId) ||
    readTrimmedString(data.taskId) ||
    input.fallbackTaskId;
  const status = readTrimmedString(data.status).toLowerCase();
  if ((status === "queued" || status === "running") && activeTaskId) {
    const results = Array.isArray(data.imageResults) ? data.imageResults.filter(isRecord) : [];
    const hasActiveResult = results.some((item) => readTrimmedString(item.id) === activeTaskId && readTrimmedString(item.url));
    if (!hasActiveResult) return null;
  }
  const asset = extractImageAssetFromTaskResult(data);
  if (!asset.imageUrl) return null;
  if (!isHostedImageAsset(input.c, asset) && !canUseUnhostedImageAsset(input.c, asset)) return null;
  return {
    row: input.row,
    nodeId: readTrimmedString(node.id) || input.nodeId,
    taskId: activeTaskId,
    vendor: readTrimmedString(data.vendor) || input.fallbackVendor || "auto",
    asset,
    nodeData: data,
  };
}

function buildExistingImageCompletionResponse(input: {
  flowId: string;
  completion: ExistingImageNodeCompletion;
}): PublicAgentsImageWaitForResultResult {
  return {
    ok: true,
    flowId: input.flowId,
    updatedAt: input.completion.row.updated_at,
    stats: buildEmptyPatchStats(),
    nodeId: input.completion.nodeId,
    status: "success",
    pending: false,
    imageUrl: input.completion.asset.imageUrl,
    vendor: input.completion.vendor,
    taskId: input.completion.taskId,
  };
}

function buildContextFromExistingCompletion(
  completion: ExistingImageNodeCompletion,
): ImageNodeRuntimeContext {
  const data = completion.nodeData;
  return {
    nodeId: completion.nodeId,
    taskId: completion.taskId,
    vendor: completion.vendor,
    prompt: readTrimmedString(data.prompt),
    taskKind: readTaskKind(data),
    label: readTrimmedString(data.label) || "Generated Image",
    imageModel: readTrimmedString(data.imageModel) || null,
  };
}

async function validateExistingCompletionTransparency(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  completion: ExistingImageNodeCompletion;
  waitStartedAt: number;
}): Promise<void> {
  try {
    await validateWebPageAssetTransparency({
      nodeId: input.completion.nodeId,
      nodeData: input.completion.nodeData,
      imageUrl: input.completion.asset.imageUrl,
    });
  } catch (error) {
    await patchImageWaitFailureToCanvas({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
      context: buildContextFromExistingCompletion(input.completion),
      error,
      waitStartedAt: input.waitStartedAt,
    });
    throw error;
  }
}

function buildPendingImageWaitResponse(input: {
  flowId: string;
  row: FlowRow;
  context: ImageNodeRuntimeContext;
  vendor: string;
  taskStatus: "queued" | "running" | "unknown";
  transientError?: PublicAgentsImageWaitForResultPendingResult["transientError"];
}): PublicAgentsImageWaitForResultResult {
  return {
    ok: true,
    flowId: input.flowId,
    updatedAt: input.row.updated_at,
    stats: buildEmptyPatchStats(),
    nodeId: input.context.nodeId,
    status: "pending",
    pending: true,
    imageUrl: null,
    vendor: input.vendor,
    taskId: input.context.taskId,
    taskStatus: input.taskStatus,
    ...(input.transientError ? { transientError: input.transientError } : {}),
  };
}

function readExistingImageNodeFailure(input: {
  row: FlowRow;
  nodeId: string;
  fallbackTaskId: string;
  fallbackVendor: string;
}): ExistingImageNodeFailure | null {
  const graph = readFlowGraph(input.row);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isFlowGraphNode) : [];
  const node = nodes.find((item) => readTrimmedString(item.id) === input.nodeId);
  if (!node) return null;
  const data = isRecord(node.data) ? node.data : {};
  if (!isImageNodeKind(data.kind)) return null;
  if (readTrimmedString(data.status) !== "error") return null;
  const lastError = data.lastError;
  return {
    nodeId: readTrimmedString(node.id) || input.nodeId,
    taskId:
      readTrimmedString(data.imageTaskId) ||
      readTrimmedString(data.taskId) ||
      input.fallbackTaskId,
    vendor: readTrimmedString(data.vendor) || input.fallbackVendor || "auto",
    message: buildVisibleImageWaitErrorMessage(lastError),
    code: readErrorCode(lastError),
    httpStatus: readImageNodeFailureStatus(data, lastError),
    lastError,
  };
}

function readImageNodeFailureStatus(
  data: Record<string, unknown>,
  lastError: unknown,
): number {
  const direct =
    typeof data.httpStatus === "number"
      ? data.httpStatus
      : typeof data.httpStatus === "string" && data.httpStatus.trim()
        ? Number(data.httpStatus)
        : Number.NaN;
  if (Number.isFinite(direct)) {
    const status = Math.trunc(direct);
    if (status >= 400 && status <= 599) return status;
  }
  return readErrorStatus(lastError);
}

function throwExistingImageNodeFailure(input: {
  flowId: string;
  failure: ExistingImageNodeFailure;
  elapsedMs: number;
}): never {
  logImageWaitEvent({
    event: "existing-flow-failure",
    nodeId: input.failure.nodeId,
    taskId: input.failure.taskId,
    vendor: input.failure.vendor,
    elapsedMs: input.elapsedMs,
    status: "error",
    httpStatus: input.failure.httpStatus,
  });
  throw new AppError(input.failure.message, {
    status: input.failure.httpStatus,
    code: "agents_tool_image_wait_node_failed",
    details: {
      flowId: input.flowId,
      nodeId: input.failure.nodeId,
      taskId: input.failure.taskId || null,
      vendor: input.failure.vendor || null,
      message: input.failure.message,
      code: input.failure.code,
      lastError: input.failure.lastError,
    },
  });
}

function isExistingImageNodeFailureError(error: unknown): boolean {
  return error instanceof AppError && error.code === "agents_tool_image_wait_node_failed";
}

function resolveImageNodeRuntimeContext(input: {
  row: FlowRow;
  args: PublicAgentsImageWaitForResultArgs;
  requestNodeId: string;
}): ImageNodeRuntimeContext {
  const graph = readFlowGraph(input.row);
  const requestedNodeId = readTrimmedString(input.args.nodeId) || input.requestNodeId;
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isFlowGraphNode) : [];
  const node = requestedNodeId
    ? nodes.find((item) => readTrimmedString(item.id) === requestedNodeId)
    : nodes.find((item) => {
        const data = isRecord(item.data) ? item.data : {};
        const status = readTrimmedString(data.status);
        const taskId = readTrimmedString(data.imageTaskId) || readTrimmedString(data.taskId);
        return isImageNodeKind(data.kind) && (status === "running" || status === "queued") && taskId;
      });
  if (!node) {
    throw new AppError("Image node not found", {
      status: 404,
      code: "image_node_not_found",
      details: { nodeId: requestedNodeId || null },
    });
  }
  const data = isRecord(node.data) ? node.data : {};
  if (!isImageNodeKind(data.kind)) {
    throw new AppError("Node is not an image node", {
      status: 400,
      code: "invalid_image_node_kind",
      details: { nodeId: readTrimmedString(node.id), kind: readTrimmedString(data.kind) || null },
    });
  }
  const nodeId = readTrimmedString(node.id);
  const requestedTaskId = readTrimmedString(input.args.taskId);
  const activeTaskId = readTrimmedString(data.imageTaskId);
  const legacyTaskId = readTrimmedString(data.taskId);
  if (requestedTaskId && activeTaskId && requestedTaskId !== activeTaskId) {
    throw new AppError("Image wait task id does not match the active image task", {
      status: 409,
      code: "image_wait_task_id_mismatch",
      details: {
        nodeId,
        requestedTaskId,
        activeTaskId,
        legacyTaskId: legacyTaskId || null,
      },
    });
  }
  const taskId = requestedTaskId || activeTaskId || legacyTaskId;
  if (!taskId) {
    throw new AppError("Image task id missing", {
      status: 400,
      code: "image_task_id_missing",
      details: { nodeId },
    });
  }
  return {
    nodeId,
    taskId,
    vendor: readTrimmedString(data.vendor) || "auto",
    prompt: readTrimmedString(data.prompt),
    taskKind: readTaskKind(data),
    label: readTrimmedString(data.label) || "Generated Image",
    imageModel: readTrimmedString(data.imageModel) || null,
  };
}

async function pollImageResultUntilTerminal(input: {
  c: AppContext;
  requestUserId: string;
  context: ImageNodeRuntimeContext;
  timeoutMs: number;
  readExistingCompletion: () => Promise<ExistingImageNodeCompletion | null>;
  readExistingFailure: () => Promise<ExistingImageNodeFailure | null>;
  flowId: string;
}): Promise<ImageWaitCompletion> {
  const startedAt = Date.now();
  const deadline = Date.now() + input.timeoutMs;
  let lastVendor = input.context.vendor;
  let lastTransientError: { status?: number; message?: string; body?: unknown } | null = null;
  let lastTaskStatus: "queued" | "running" | "unknown" = "unknown";
  while (Date.now() <= deadline) {
    const existingCompletion = await input.readExistingCompletion();
    if (existingCompletion) {
      logImageWaitEvent({
        event: "existing-flow-completion",
        nodeId: input.context.nodeId,
        taskId: input.context.taskId,
        vendor: existingCompletion.vendor || lastVendor,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        status: "success",
      });
      return { source: "flow", completion: existingCompletion };
    }
    const existingFailure = await input.readExistingFailure();
    if (existingFailure) {
      throwExistingImageNodeFailure({
        flowId: input.flowId,
        failure: existingFailure,
        elapsedMs: Math.max(0, Date.now() - startedAt),
      });
    }
    let outcome: Awaited<ReturnType<typeof fetchTaskResultForPolling>>;
    try {
      outcome = await fetchTaskResultForPolling(input.c, input.requestUserId, {
        taskId: input.context.taskId,
        vendor: lastVendor,
        taskKind: input.context.taskKind,
        prompt: input.context.prompt,
        mode: "public",
      });
    } catch (error: unknown) {
      const errObj = error as { status?: unknown; message?: unknown };
      const transientStatus =
        typeof errObj.status === "number" ? errObj.status : undefined;
      const transientMessage =
        typeof errObj.message === "string" ? errObj.message : String(error);
      if (
        isFatalAssetHostingPollError(error) ||
        classifyImagePollHttpStatus(transientStatus) === "fatal"
      ) {
        throw buildFatalImagePollError({
          error,
            nodeId: input.context.nodeId,
            taskId: input.context.taskId,
            vendor: lastVendor || null,
            httpStatus: transientStatus,
            message: transientMessage,
        });
      }
      lastTransientError = { status: transientStatus, message: transientMessage };
      lastTaskStatus = "unknown";
      logImageWaitEvent({
        event: "poll-transient-error",
        nodeId: input.context.nodeId,
        taskId: input.context.taskId,
        vendor: lastVendor,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        httpStatus: transientStatus,
      });
      const delayMs = imageWaitDelayBeforeNextPoll(deadline);
      if (delayMs <= 0) break;
      await sleep(delayMs);
      continue;
    }
    if (!outcome.ok) {
      if (
        isFatalAssetHostingPollError(outcome.body) ||
        classifyImagePollHttpStatus(outcome.status) === "fatal"
      ) {
        throw buildFatalImagePollError({
          error: outcome.body,
            nodeId: input.context.nodeId,
            taskId: input.context.taskId,
            vendor: lastVendor || null,
            httpStatus: outcome.status,
            body: outcome.body,
        });
      }
      lastTransientError = { status: outcome.status, body: outcome.body };
      lastTaskStatus = "unknown";
      logImageWaitEvent({
        event: "poll-transient-error",
        nodeId: input.context.nodeId,
        taskId: input.context.taskId,
        vendor: lastVendor,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        httpStatus: outcome.status,
      });
      const delayMs = imageWaitDelayBeforeNextPoll(deadline);
      if (delayMs <= 0) break;
      await sleep(delayMs);
      continue;
    }
    lastTransientError = null;
    lastVendor = readTrimmedString(outcome.vendor) || lastVendor;
    logImageWaitEvent({
      event: "poll-result",
      nodeId: input.context.nodeId,
      taskId: input.context.taskId,
      vendor: lastVendor,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      status: outcome.result.status,
    });
    if (outcome.result.status === "queued" || outcome.result.status === "running") {
      lastTaskStatus = outcome.result.status;
      const delayMs = imageWaitDelayBeforeNextPoll(deadline);
      if (delayMs <= 0) break;
      await sleep(delayMs);
      continue;
    }
    if (outcome.result.status === "failed") {
      throw new AppError("图片生成失败", {
        status: 502,
        code: "agents_tool_image_wait_failed",
        details: {
          nodeId: input.context.nodeId,
          taskId: input.context.taskId,
          vendor: lastVendor || null,
          message: buildImageFailureMessage(outcome.result) || null,
        },
      });
    }
    const asset = extractImageAssetFromTaskResult(outcome.result);
    if (!asset.imageUrl) {
      logImageWaitEvent({
        event: "missing-image-url",
        nodeId: input.context.nodeId,
        taskId: input.context.taskId,
        vendor: lastVendor,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        status: outcome.result.status,
      });
      throw new AppError("图片生成失败：未返回图片 URL", {
        status: 502,
        code: "agents_tool_image_wait_missing_url",
        details: {
          nodeId: input.context.nodeId,
          taskId: input.context.taskId,
          vendor: lastVendor || null,
        },
      });
    }
    logImageWaitEvent({
      event: "task-completion",
      nodeId: input.context.nodeId,
      taskId: input.context.taskId,
      vendor: lastVendor,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      status: outcome.result.status,
    });
    return { source: "task", vendor: lastVendor, result: outcome.result, asset };
  }
  logImageWaitEvent({
    event: "timeout",
    nodeId: input.context.nodeId,
    taskId: input.context.taskId,
    vendor: lastVendor,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    timeoutMs: input.timeoutMs,
  });
  return {
    source: "pending",
    vendor: lastVendor,
    taskStatus: lastTaskStatus,
    ...(lastTransientError
      ? {
          transientError: {
            ...(typeof lastTransientError.status === "number"
              ? { httpStatus: lastTransientError.status }
              : {}),
            ...(lastTransientError.message ? { message: lastTransientError.message } : {}),
            ...(lastTransientError.body !== undefined ? { body: lastTransientError.body } : {}),
          },
        }
      : {}),
  };
}

function buildImageResults(input: {
  existingData: Record<string, unknown>;
  context: ImageNodeRuntimeContext;
  result: TaskResultDto;
  asset: ExtractedImageAsset;
  successMetadata?: Record<string, unknown>;
}): { results: Array<Record<string, unknown>>; primaryIndex: number } {
  const existingResults = Array.isArray(input.existingData.imageResults)
    ? input.existingData.imageResults.filter(isRecord)
    : [];
  const existingIndex = existingResults.findIndex((item) => readTrimmedString(item.url) === input.asset.imageUrl);
  if (existingIndex >= 0) {
    const results = [...existingResults];
    if (input.successMetadata && Object.keys(input.successMetadata).length > 0) {
      results[existingIndex] = {
        ...results[existingIndex],
        ...input.successMetadata,
      };
    }
    return { results, primaryIndex: existingIndex };
  }
  const nextItem: Record<string, unknown> = {
    id: readTrimmedString(input.result.id) || input.context.taskId,
    url: input.asset.imageUrl,
    title: input.context.label,
    ...(input.successMetadata ?? {}),
  };
  if (input.context.imageModel) nextItem.model = input.context.imageModel;
  if (input.asset.assetId) nextItem.assetId = input.asset.assetId;
  const results = [...existingResults, nextItem];
  return { results, primaryIndex: results.length - 1 };
}

async function patchCompletedImageResultToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  context: ImageNodeRuntimeContext;
  vendor: string;
  result: TaskResultDto;
  asset: ExtractedImageAsset;
  waitStartedAt: number;
}): Promise<PublicAgentsImageWaitForResultResult> {
  logImageWaitEvent({
    event: "patch-start",
    nodeId: input.context.nodeId,
    taskId: input.context.taskId,
    vendor: input.vendor,
    elapsedMs: Math.max(0, Date.now() - input.waitStartedAt),
    status: input.result.status,
  });

  let successMetadata: Record<string, unknown> = {};
  let canvasAsset = input.asset;
  try {
    const latestRow = await loadLatestFlowRow({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
    });
    const latestGraph = readFlowGraph(latestRow);
    const latestNodes = Array.isArray(latestGraph.nodes) ? latestGraph.nodes.filter(isFlowGraphNode) : [];
    const latestNode = latestNodes.find((item) => readTrimmedString(item.id) === input.context.nodeId);
    const existingData = isRecord(latestNode?.data) ? latestNode.data : {};
    const prepared = await prepareGeneratedImageAssetForCanvas({
      c: input.c,
      requestUserId: input.requestUserId,
      asset: input.asset,
      nodeData: existingData,
      meta: {
        taskKind: input.context.taskKind,
        prompt: input.context.prompt,
        vendor: input.vendor,
        modelKey: input.context.imageModel,
        taskId: input.context.taskId,
      },
    });
    canvasAsset = prepared.asset;
    successMetadata = await validateWebPageAssetTransparency({
      nodeId: input.context.nodeId,
      nodeData: existingData,
      imageUrl: canvasAsset.imageUrl,
    });
    successMetadata = {
      ...prepared.metadata,
      ...successMetadata,
    };
  } catch (error) {
    await patchImageWaitFailureToCanvas({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
      context: input.context,
      error,
      waitStartedAt: input.waitStartedAt,
    });
    throw error;
  }

  const { updatedRow } = await optimisticCanvasWrite({
    db: input.c.env.DB,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    versionLabel: "image-result",
    redisUrl: String(input.c.env.REDIS_URL || "").trim(),
    buildNextState: (latestRow: FlowRow) => {
      const latestGraph = readFlowGraph(latestRow);
      const latestNodes = Array.isArray(latestGraph.nodes) ? latestGraph.nodes.filter(isFlowGraphNode) : [];
      const latestNode = latestNodes.find((item) => readTrimmedString(item.id) === input.context.nodeId);
      if (!latestNode) {
        throw new AppError("Image node not found", {
          status: 404,
          code: "image_node_not_found",
          details: { nodeId: input.context.nodeId },
        });
      }
      const existingData = isRecord(latestNode.data) ? latestNode.data : {};
      const imageResults = buildImageResults({
        existingData,
        context: input.context,
        result: input.result,
        asset: canvasAsset,
        successMetadata,
      });
      const patchData: Record<string, unknown> = {
        status: "success",
        progress: 100,
        imageUrl: canvasAsset.imageUrl,
        ...successMetadata,
        imageResults: imageResults.results,
        imagePrimaryIndex: imageResults.primaryIndex,
        taskId: input.context.taskId,
        imageTaskId: input.context.taskId,
        imageTaskKind: input.context.taskKind,
        vendor: input.vendor,
        lastError: null,
        httpStatus: null,
        isQuotaExceeded: false,
      };
      if (canvasAsset.assetId) patchData.assetId = canvasAsset.assetId;
      if (input.context.imageModel) patchData.imageModel = input.context.imageModel;
      if (!isHostedImageAsset(input.c, canvasAsset) && !isRecord(patchData.assetHosting)) {
        patchData.assetHosting = {
          status: "disabled",
          message: "Object storage is not fully configured; using vendor image URL directly. Required: access key, secret key, endpoint/bucket URL, and bucket.",
          updatedAt: new Date().toISOString(),
        };
      }

      // slides[i].imageUrl is derived from this image node by
      // reconcilePptMasterNodeIdentities inside applyPublicFlowGraphPatch.
      const applied = applyPublicFlowGraphPatch({
        current: sanitizeFlowDataForStorage(mapFlowRowToDto(latestRow).data ?? {}),
        patch: {
          allowOverwrite: true,
          patchNodeData: [
            { id: input.context.nodeId, data: patchData },
          ],
        },
      });
      const sanitizedNext = sanitizeFlowDataForStorage(applied.data);
      const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
      if (!nextParsed.success) {
        throw new AppError("Flow patch produced invalid data", {
          status: 500,
          code: "flow_patch_invalid",
          details: { issues: nextParsed.error.issues },
        });
      }
      return { data: JSON.stringify(sanitizedNext ?? {}), name: latestRow.name };
    },
  });

  logImageWaitEvent({
    event: "patch-success",
    nodeId: input.context.nodeId,
    taskId: input.context.taskId,
    vendor: input.vendor,
    elapsedMs: Math.max(0, Date.now() - input.waitStartedAt),
    status: "success",
  });
  return {
    ok: true,
    flowId: updatedRow.id,
    updatedAt: updatedRow.updated_at,
    stats: { createdNodes: 0, createdEdges: 0, patchedNodes: 1, appendedArrays: 0 },
    nodeId: input.context.nodeId,
    status: "success",
    pending: false,
    imageUrl: canvasAsset.imageUrl,
    vendor: input.vendor,
    taskId: input.context.taskId,
  };
}

async function loadLatestFlowRow(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
}): Promise<FlowRow> {
  const row = input.devBypass
    ? await getFlowByIdUnsafe(input.c.env.DB, input.flowId)
    : await getFlowForOwner(input.c.env.DB, input.flowId, input.requestUserId);
  if (!row) {
    throw new AppError("Flow not found", {
      status: 404,
      code: "flow_not_found",
    });
  }
  return row;
}

function resolveVersionUserId(input: {
  devBypass: boolean;
  requestUserId: string;
  flowOwnerId: string | null;
}): string {
  if (!input.devBypass) return input.requestUserId;
  const ownerId = readTrimmedString(input.flowOwnerId);
  if (!ownerId) {
    throw new AppError("Flow owner missing", {
      status: 500,
      code: "flow_owner_missing",
    });
  }
  return ownerId;
}

function readErrorStatus(error: unknown): number {
  if (error instanceof AppError) return error.status;
  const record = isRecord(error) ? error : null;
  const value = record?.status;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return 500;
  const status = Math.trunc(parsed);
  return status >= 400 && status <= 599 ? status : 500;
}

function readErrorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  const record = isRecord(error) ? error : null;
  return readTrimmedString(record?.code) || "agents_tool_image_wait_error";
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const record = isRecord(error) ? error : null;
  return (
    readTrimmedString(record?.message) ||
    readTrimmedString(record?.error) ||
    readTrimmedString(error) ||
    "图片生成失败"
  );
}

function readErrorDetails(error: unknown): unknown {
  if (error instanceof AppError) return error.details;
  const record = isRecord(error) ? error : null;
  return record?.details;
}

function isFatalAssetHostingPollError(error: unknown): boolean {
  const code = readErrorCode(error);
  return (
    code === "asset_hosting_fetch_non_200" ||
    code === "asset_hosting_source_url_missing" ||
    code === "asset_hosting_source_url_invalid" ||
    code === "asset_hosting_disabled"
  );
}

function buildFatalImagePollError(input: {
  error: unknown;
  nodeId: string;
  taskId: string;
  vendor: string | null;
  httpStatus?: number;
  body?: unknown;
  message?: string;
}): AppError {
  if (isFatalAssetHostingPollError(input.error)) {
    return new AppError(readErrorMessage(input.error), {
      status: readErrorStatus(input.error),
      code: readErrorCode(input.error),
      details: {
        nodeId: input.nodeId,
        taskId: input.taskId,
        vendor: input.vendor,
        ...(typeof input.httpStatus === "number" ? { httpStatus: input.httpStatus } : {}),
        ...(input.body ? { body: input.body } : {}),
        ...(input.message ? { message: input.message } : {}),
        originalError: serializeErrorForDetails(input.error),
      },
    });
  }
  return new AppError("图片任务轮询被供应商拒绝，停止等待", {
    status: 502,
    code: "agents_tool_image_wait_fatal_poll_error",
    details: {
      nodeId: input.nodeId,
      taskId: input.taskId,
      vendor: input.vendor,
      ...(typeof input.httpStatus === "number" ? { httpStatus: input.httpStatus } : {}),
      ...(input.body ? { body: input.body } : {}),
      ...(input.message ? { message: input.message } : {}),
    },
  });
}

function toDetailsRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === "undefined") return {};
  return { originalDetails: value };
}

function buildVisibleImageWaitErrorMessage(error: unknown): string {
  const details = readErrorDetails(error);
  const detailMessage = isRecord(details) ? readTrimmedString(details.message) : "";
  return detailMessage || readErrorMessage(error);
}

function serializeErrorForDetails(error: unknown): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    message: readErrorMessage(error),
    code: readErrorCode(error),
    status: readErrorStatus(error),
  };
  const details = readErrorDetails(error);
  if (typeof details !== "undefined") serialized.details = details;
  return serialized;
}

function attachNodePatchFailureToThrownError(error: unknown, patchError: unknown): void {
  const nodePatchError = serializeErrorForDetails(patchError);
  if (error instanceof AppError) {
    error.details = {
      ...toDetailsRecord(error.details),
      nodePatchFailed: true,
      nodePatchError,
    };
    return;
  }
  if (!isRecord(error)) return;
  error.details = {
    ...toDetailsRecord(error.details),
    nodePatchFailed: true,
    nodePatchError,
  };
}

async function patchImageWaitFailureToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  context: ImageNodeRuntimeContext;
  error: unknown;
  waitStartedAt: number;
}): Promise<void> {
  const errorStatus = readErrorStatus(input.error);
  const lastError: Record<string, unknown> = {
    message: buildVisibleImageWaitErrorMessage(input.error),
    code: readErrorCode(input.error),
    status: errorStatus,
  };
  const errorDetails = readErrorDetails(input.error);
  if (typeof errorDetails !== "undefined") lastError.details = errorDetails;

  const patchData: Record<string, unknown> = {
    status: "error",
    progress: 0,
    pending: false,
    taskId: input.context.taskId,
    imageTaskId: input.context.taskId,
    imageTaskKind: input.context.taskKind,
    vendor: input.context.vendor,
    lastError,
    httpStatus: errorStatus,
    isQuotaExceeded: false,
  };
  if (input.context.imageModel) patchData.imageModel = input.context.imageModel;

  logImageWaitEvent({
    event: "error-patch-start",
    nodeId: input.context.nodeId,
    taskId: input.context.taskId,
    vendor: input.context.vendor,
    elapsedMs: Math.max(0, Date.now() - input.waitStartedAt),
    status: "error",
    httpStatus: errorStatus,
  });

  await optimisticCanvasWrite({
    db: input.c.env.DB,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    versionLabel: "image-result-error",
    redisUrl: String(input.c.env.REDIS_URL || "").trim(),
    buildNextState: (latestRow: FlowRow) => {
      const latestGraph = readFlowGraph(latestRow);
      const latestNodes = Array.isArray(latestGraph.nodes) ? latestGraph.nodes.filter(isFlowGraphNode) : [];
      const latestNode = latestNodes.find((item) => readTrimmedString(item.id) === input.context.nodeId);
      if (!latestNode) {
        throw new AppError("Image node not found", {
          status: 404,
          code: "image_node_not_found",
          details: { nodeId: input.context.nodeId },
        });
      }
      const existingData = isRecord(latestNode.data) ? latestNode.data : {};
      if (!isImageNodeKind(existingData.kind)) {
        throw new AppError("Node is not an image node", {
          status: 400,
          code: "invalid_image_node_kind",
          details: {
            nodeId: input.context.nodeId,
            kind: readTrimmedString(existingData.kind) || null,
          },
        });
      }
      const applied = applyPublicFlowGraphPatch({
        current: sanitizeFlowDataForStorage(mapFlowRowToDto(latestRow).data ?? {}),
        patch: {
          allowOverwrite: true,
          patchNodeData: [{ id: input.context.nodeId, data: patchData }],
        },
      });
      if (applied.stats.patchedNodes < 1) {
        throw new AppError("Image wait failure patch did not update node", {
          status: 500,
          code: "image_wait_error_patch_noop",
          details: { nodeId: input.context.nodeId },
        });
      }
      const sanitizedNext = sanitizeFlowDataForStorage(applied.data);
      const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
      if (!nextParsed.success) {
        throw new AppError("Flow patch produced invalid data", {
          status: 500,
          code: "flow_patch_invalid",
          details: { issues: nextParsed.error.issues },
        });
      }
      return { data: JSON.stringify(sanitizedNext ?? {}), name: latestRow.name };
    },
  });

  logImageWaitEvent({
    event: "error-patch-success",
    nodeId: input.context.nodeId,
    taskId: input.context.taskId,
    vendor: input.context.vendor,
    elapsedMs: Math.max(0, Date.now() - input.waitStartedAt),
    status: "error",
    httpStatus: errorStatus,
  });
}

const TRANSIENT_IMAGE_POLL_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 429]);

function classifyImagePollHttpStatus(
  status: number | undefined,
): "fatal" | "transient" {
  if (typeof status !== "number" || !Number.isFinite(status) || status <= 0) {
    return "transient";
  }
  if (status >= 500) return "transient";
  if (TRANSIENT_IMAGE_POLL_HTTP_STATUSES.has(status)) return "transient";
  if (status >= 400) return "fatal";
  return "transient";
}

export async function settleImageResultToCanvasOnce(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  requestNodeId: string;
  bodyArgs: unknown;
}): Promise<ImageResultSettleOnceResult> {
  const waitStartedAt = Date.now();
  const parsedArgs = PublicAgentsImageWaitForResultArgsSchema.safeParse(input.bodyArgs);
  if (!parsedArgs.success) {
    throw new AppError("Invalid image wait request", {
      status: 400,
      code: "invalid_image_wait_request",
      details: { issues: parsedArgs.error.issues },
    });
  }
  const latestRowBeforePolling = await loadLatestFlowRow({
    c: input.c,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    flowId: input.flowId,
  });
  const requestedNodeId = readTrimmedString(parsedArgs.data.nodeId) || input.requestNodeId;
  if (requestedNodeId) {
    const existingCompletion = readExistingImageNodeCompletion({
      c: input.c,
      row: latestRowBeforePolling,
      nodeId: requestedNodeId,
      fallbackTaskId: readTrimmedString(parsedArgs.data.taskId),
      fallbackVendor: "auto",
    });
    if (existingCompletion) {
      try {
        await validateExistingCompletionTransparency({
          c: input.c,
          requestUserId: input.requestUserId,
          devBypass: input.devBypass,
          flowId: input.flowId,
          completion: existingCompletion,
          waitStartedAt,
        });
      } catch (error) {
        return {
          outcome: "failed",
          flowId: input.flowId,
          nodeId: existingCompletion.nodeId,
          taskId: existingCompletion.taskId,
          vendor: existingCompletion.vendor,
          errorCode: readErrorCode(error),
          errorMessage: readErrorMessage(error),
        };
      }
      return {
        outcome: "success",
        result: buildExistingImageCompletionResponse({
          flowId: input.flowId,
          completion: existingCompletion,
        }),
      };
    }
    const existingFailure = readExistingImageNodeFailure({
      row: latestRowBeforePolling,
      nodeId: requestedNodeId,
      fallbackTaskId: readTrimmedString(parsedArgs.data.taskId),
      fallbackVendor: "auto",
    });
    if (existingFailure) {
      return {
        outcome: "skipped",
        flowId: input.flowId,
        nodeId: existingFailure.nodeId,
        taskId: existingFailure.taskId,
        vendor: existingFailure.vendor,
        reason: "already_failed",
      };
    }
  }

  const waitContext = resolveImageNodeRuntimeContext({
    row: latestRowBeforePolling,
    args: parsedArgs.data,
    requestNodeId: input.requestNodeId,
  });
  let lastVendor = waitContext.vendor;
  let outcome: Awaited<ReturnType<typeof fetchTaskResultForPolling>>;
  try {
    outcome = await fetchTaskResultForPolling(input.c, input.requestUserId, {
      taskId: waitContext.taskId,
      vendor: lastVendor,
      taskKind: waitContext.taskKind,
      prompt: waitContext.prompt,
      mode: "public",
    });
  } catch (error: unknown) {
    const errObj = error as { status?: unknown; message?: unknown };
    const httpStatus = typeof errObj.status === "number" ? errObj.status : undefined;
    const message = typeof errObj.message === "string" ? errObj.message : String(error);
    if (
      !isFatalAssetHostingPollError(error) &&
      classifyImagePollHttpStatus(httpStatus) === "transient"
    ) {
      return {
        outcome: "transient_error",
        flowId: input.flowId,
        nodeId: waitContext.nodeId,
        taskId: waitContext.taskId,
        vendor: lastVendor,
        ...(typeof httpStatus === "number" ? { httpStatus } : {}),
        message,
      };
    }
    const fatal = buildFatalImagePollError({
      error,
      nodeId: waitContext.nodeId,
      taskId: waitContext.taskId,
      vendor: lastVendor || null,
      httpStatus,
      message,
    });
    await patchImageWaitFailureToCanvas({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
      context: waitContext,
      error: fatal,
      waitStartedAt,
    });
    return {
      outcome: "failed",
      flowId: input.flowId,
      nodeId: waitContext.nodeId,
      taskId: waitContext.taskId,
      vendor: lastVendor,
      errorCode: fatal.code,
      errorMessage: fatal.message,
    };
  }
  if (!outcome.ok) {
    if (
      !isFatalAssetHostingPollError(outcome.body) &&
      classifyImagePollHttpStatus(outcome.status) === "transient"
    ) {
      return {
        outcome: "transient_error",
        flowId: input.flowId,
        nodeId: waitContext.nodeId,
        taskId: waitContext.taskId,
        vendor: lastVendor,
        httpStatus: outcome.status,
        body: outcome.body,
      };
    }
    const fatal = buildFatalImagePollError({
      error: outcome.body,
      nodeId: waitContext.nodeId,
      taskId: waitContext.taskId,
      vendor: lastVendor || null,
      httpStatus: outcome.status,
      body: outcome.body,
    });
    await patchImageWaitFailureToCanvas({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
      context: waitContext,
      error: fatal,
      waitStartedAt,
    });
    return {
      outcome: "failed",
      flowId: input.flowId,
      nodeId: waitContext.nodeId,
      taskId: waitContext.taskId,
      vendor: lastVendor,
      errorCode: fatal.code,
      errorMessage: fatal.message,
    };
  }

  lastVendor = readTrimmedString(outcome.vendor) || lastVendor;
  if (outcome.result.status === "queued" || outcome.result.status === "running") {
    return {
      outcome: "pending",
      flowId: input.flowId,
      nodeId: waitContext.nodeId,
      taskId: waitContext.taskId,
      vendor: lastVendor,
      taskStatus: outcome.result.status,
    };
  }

  let terminalError: AppError | null = null;
  if (outcome.result.status === "failed") {
    terminalError = new AppError("图片生成失败", {
      status: 502,
      code: "agents_tool_image_wait_failed",
      details: {
        nodeId: waitContext.nodeId,
        taskId: waitContext.taskId,
        vendor: lastVendor || null,
        message: buildImageFailureMessage(outcome.result) || null,
      },
    });
  }

  const asset = terminalError ? null : extractImageAssetFromTaskResult(outcome.result);
  if (!terminalError && asset && !asset.imageUrl) {
    terminalError = new AppError("图片生成失败：未返回图片 URL", {
      status: 502,
      code: "agents_tool_image_wait_missing_url",
      details: {
        nodeId: waitContext.nodeId,
        taskId: waitContext.taskId,
        vendor: lastVendor || null,
      },
    });
  }
  if (terminalError) {
    await patchImageWaitFailureToCanvas({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
      context: waitContext,
      error: terminalError,
      waitStartedAt,
    });
    return {
      outcome: "failed",
      flowId: input.flowId,
      nodeId: waitContext.nodeId,
      taskId: waitContext.taskId,
      vendor: lastVendor,
      errorCode: terminalError.code,
      errorMessage: terminalError.message,
    };
  }

  const result = await patchCompletedImageResultToCanvas({
    c: input.c,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    flowId: input.flowId,
    context: waitContext,
    vendor: lastVendor,
    result: outcome.result,
    asset: asset!,
    waitStartedAt,
  });
  return { outcome: "success", result };
}

export async function waitForImageResultToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  row: FlowRow;
  requestNodeId: string;
  bodyArgs: unknown;
}): Promise<PublicAgentsImageWaitForResultResult> {
  const waitStartedAt = Date.now();
  const parsedArgs = PublicAgentsImageWaitForResultArgsSchema.safeParse(input.bodyArgs);
  if (!parsedArgs.success) {
    throw new AppError("Invalid image wait request", {
      status: 400,
      code: "invalid_image_wait_request",
      details: { issues: parsedArgs.error.issues },
    });
  }
  const timeoutMs = IMAGE_WAIT_DEFAULT_TIMEOUT_MS;
  const latestRowBeforePolling = await loadLatestFlowRow({
    c: input.c,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    flowId: input.flowId,
  });
  const requestedNodeId = readTrimmedString(parsedArgs.data.nodeId) || input.requestNodeId;
  if (requestedNodeId) {
    const existingCompletion = readExistingImageNodeCompletion({
      c: input.c,
      row: latestRowBeforePolling,
      nodeId: requestedNodeId,
      fallbackTaskId: readTrimmedString(parsedArgs.data.taskId),
      fallbackVendor: "auto",
    });
    if (existingCompletion) {
      logImageWaitEvent({
        event: "precheck-existing-flow-completion",
        nodeId: requestedNodeId,
        taskId: existingCompletion.taskId,
        vendor: existingCompletion.vendor,
        elapsedMs: Math.max(0, Date.now() - waitStartedAt),
        status: "success",
      });
      await validateExistingCompletionTransparency({
        c: input.c,
        requestUserId: input.requestUserId,
        devBypass: input.devBypass,
        flowId: input.flowId,
        completion: existingCompletion,
        waitStartedAt,
      });
      // slides[i].imageUrl is backend-derived from image nodes on every flow
      // write (reconcilePptMasterNodeIdentities). No bespoke mirror is needed
      // here: the next PPT write re-derives it, and export readiness is based on
      // the generated child image nodes, not this denormalized field.
      return buildExistingImageCompletionResponse({
        flowId: input.flowId,
        completion: existingCompletion,
      });
    }
    const existingFailure = readExistingImageNodeFailure({
      row: latestRowBeforePolling,
      nodeId: requestedNodeId,
      fallbackTaskId: readTrimmedString(parsedArgs.data.taskId),
      fallbackVendor: "auto",
    });
    if (existingFailure) {
      throwExistingImageNodeFailure({
        flowId: input.flowId,
        failure: existingFailure,
        elapsedMs: Math.max(0, Date.now() - waitStartedAt),
      });
    }
  }
  const waitContext = resolveImageNodeRuntimeContext({
    row: latestRowBeforePolling,
    args: parsedArgs.data,
    requestNodeId: input.requestNodeId,
  });
  logImageWaitEvent({
    event: "wait-start",
    nodeId: waitContext.nodeId,
    taskId: waitContext.taskId,
    vendor: waitContext.vendor,
    elapsedMs: 0,
    timeoutMs,
  });
  const readExistingCompletion = async (): Promise<ExistingImageNodeCompletion | null> => {
    const latestRow = await loadLatestFlowRow({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
    });
    return readExistingImageNodeCompletion({
      c: input.c,
      row: latestRow,
      nodeId: waitContext.nodeId,
      fallbackTaskId: waitContext.taskId,
      fallbackVendor: waitContext.vendor,
    });
  };
  const readExistingFailure = async (): Promise<ExistingImageNodeFailure | null> => {
    const latestRow = await loadLatestFlowRow({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
    });
    return readExistingImageNodeFailure({
      row: latestRow,
      nodeId: waitContext.nodeId,
      fallbackTaskId: waitContext.taskId,
      fallbackVendor: waitContext.vendor,
    });
  };

  let completed: ImageWaitCompletion;
  try {
    completed = await pollImageResultUntilTerminal({
      c: input.c,
      requestUserId: input.requestUserId,
      context: waitContext,
      timeoutMs,
      readExistingCompletion,
      readExistingFailure,
      flowId: input.flowId,
    });
  } catch (error) {
    if (isExistingImageNodeFailureError(error)) throw error;
    try {
      await patchImageWaitFailureToCanvas({
        c: input.c,
        requestUserId: input.requestUserId,
        devBypass: input.devBypass,
        flowId: input.flowId,
        context: waitContext,
        error,
        waitStartedAt,
      });
    } catch (patchError) {
      attachNodePatchFailureToThrownError(error, patchError);
      console.error("[agents-image-wait] error-patch-failed", {
        nodeId: waitContext.nodeId,
        taskId: waitContext.taskId,
        patchError: serializeErrorForDetails(patchError),
      });
    }
    throw error;
  }
  if (completed.source === "flow") {
    await validateExistingCompletionTransparency({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
      completion: completed.completion,
      waitStartedAt,
    });
    return buildExistingImageCompletionResponse({
      flowId: input.flowId,
      completion: completed.completion,
    });
  }
  if (completed.source === "pending") {
    return buildPendingImageWaitResponse({
      flowId: input.flowId,
      row: latestRowBeforePolling,
      context: waitContext,
      vendor: completed.vendor,
      taskStatus: completed.taskStatus,
      ...(completed.transientError ? { transientError: completed.transientError } : {}),
    });
  }

  return patchCompletedImageResultToCanvas({
    c: input.c,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    flowId: input.flowId,
    context: waitContext,
    vendor: completed.vendor,
    result: completed.result,
    asset: completed.asset,
    waitStartedAt,
  });
}

