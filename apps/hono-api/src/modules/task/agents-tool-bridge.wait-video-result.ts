import { z } from "zod";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
  PublicFlowGraphSchema,
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
import { fetchTaskResultForPolling } from "./task.polling";
import type { TaskResultDto } from "./task.schemas";
import {
  buildVideoFailureMessage,
  extractVideoAssetFromTaskResult,
  readTrimmedString,
  type ExtractedVideoAsset,
} from "./agents-tool-bridge.video-result";

export const VIDEO_WAIT_DEFAULT_TIMEOUT_MS = 7_140_000;
const VIDEO_WAIT_POLL_INTERVAL_MS = 3_000;

const PublicAgentsVideoWaitForResultArgsSchema = z.object({
  nodeId: optionalNonEmptyString,
  taskId: optionalNonEmptyString,
}).strict();

type PublicAgentsVideoWaitForResultArgs = z.infer<
  typeof PublicAgentsVideoWaitForResultArgsSchema
>;

type PublicAgentsVideoWaitForResultSuccessResult = {
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
  videoUrl: string;
  thumbnailUrl: string | null;
  vendor: string;
  taskId: string;
};

type PublicAgentsVideoWaitForResultPendingResult = {
  ok: true;
  flowId: string;
  updatedAt: string;
  stats: PublicAgentsVideoWaitForResultSuccessResult["stats"];
  nodeId: string;
  status: "pending";
  pending: true;
  videoUrl: null;
  thumbnailUrl: null;
  vendor: string;
  taskId: string;
  taskStatus: "queued" | "running" | "unknown";
  transientError?: {
    httpStatus?: number;
    message?: string;
    body?: unknown;
  };
};

export type PublicAgentsVideoWaitForResultResult =
  | PublicAgentsVideoWaitForResultSuccessResult
  | PublicAgentsVideoWaitForResultPendingResult;

type VideoNodeRuntimeContext = {
  nodeId: string;
  taskId: string;
  vendor: string;
  prompt: string;
  durationSeconds: number | null;
  videoModel: string | null;
  label: string;
};

type ExistingVideoNodeCompletion = {
  row: FlowRow;
  nodeId: string;
  taskId: string;
  vendor: string;
  asset: ExtractedVideoAsset;
};

type ExistingVideoNodeFailure = {
  row: FlowRow;
  nodeId: string;
  taskId: string;
  vendor: string;
  message: string;
  code: string;
  httpStatus: number;
  lastError: unknown;
};

type VideoWaitCompletion =
  | {
      source: "task";
      vendor: string;
      result: TaskResultDto;
      asset: ExtractedVideoAsset;
    }
  | {
      source: "flow";
      completion: ExistingVideoNodeCompletion;
    }
  | {
      source: "pending";
      vendor: string;
      taskStatus: "queued" | "running" | "unknown";
      transientError?: PublicAgentsVideoWaitForResultPendingResult["transientError"];
    };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function videoWaitDelayBeforeNextPoll(deadline: number): number {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return 0;
  return Math.min(VIDEO_WAIT_POLL_INTERVAL_MS, remainingMs);
}

export type VideoResultSettleOnceResult =
  | {
      outcome: "success";
      result: PublicAgentsVideoWaitForResultResult;
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

function isHostedVideoAsset(c: AppContext, asset: ExtractedVideoAsset): boolean {
  return Boolean(asset.videoUrl && isHostedAssetUrl(c, asset.videoUrl));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFlowGraphNode(value: unknown): value is { id?: unknown; data?: unknown } {
  return isRecord(value);
}

function readPositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.trunc(parsed));
}

function logVideoWaitEvent(input: {
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
  console.info(`[agents-video-wait] ${parts.join(" ")}`);
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

function buildEmptyPatchStats(): PublicAgentsVideoWaitForResultResult["stats"] {
  return {
    createdNodes: 0,
    createdEdges: 0,
    patchedNodes: 0,
    appendedArrays: 0,
  };
}

function readErrorStatus(error: unknown): number {
  if (error instanceof AppError) return error.status;
  const record = isRecord(error) ? error : null;
  const direct = typeof record?.status === "number" ? record.status : Number(record?.status);
  if (Number.isFinite(direct) && direct >= 400 && direct <= 599) return Math.trunc(direct);
  return 502;
}

function readErrorCode(error: unknown): string {
  if (error instanceof AppError && error.code.trim()) return error.code.trim();
  const record = isRecord(error) ? error : null;
  return readTrimmedString(record?.code) || "agents_tool_video_wait_error";
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const record = isRecord(error) ? error : null;
  return (
    readTrimmedString(record?.message) ||
    readTrimmedString(record?.error) ||
    readTrimmedString(error) ||
    "视频生成失败"
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

function buildFatalVideoPollError(input: {
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
  return new AppError("视频任务轮询被供应商拒绝，停止等待", {
    status: 502,
    code: "agents_tool_video_wait_fatal_poll_error",
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

function buildVisibleVideoWaitErrorMessage(error: unknown): string {
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

function readCanvasNodeFailureMessage(lastError: unknown): string {
  if (lastError instanceof Error && lastError.message.trim()) return lastError.message.trim();
  if (isRecord(lastError)) {
    return (
      readTrimmedString(lastError.message) ||
      readTrimmedString(lastError.error) ||
      readTrimmedString(lastError.reason) ||
      "视频生成失败"
    );
  }
  return readTrimmedString(lastError) || "视频生成失败";
}

function readCanvasNodeFailureCode(lastError: unknown): string {
  if (isRecord(lastError)) return readTrimmedString(lastError.code) || "canvas_video_node_failed";
  return "canvas_video_node_failed";
}

function readCanvasNodeFailureStatus(data: Record<string, unknown>, lastError: unknown): number {
  const fromNode = typeof data.httpStatus === "number" ? data.httpStatus : Number(data.httpStatus);
  if (Number.isFinite(fromNode) && fromNode >= 400 && fromNode <= 599) return Math.trunc(fromNode);
  const fromError = isRecord(lastError)
    ? typeof lastError.status === "number"
      ? lastError.status
      : Number(lastError.status)
    : Number.NaN;
  if (Number.isFinite(fromError) && fromError >= 400 && fromError <= 599) return Math.trunc(fromError);
  return 502;
}

function readExistingVideoNodeCompletion(input: {
  c: AppContext;
  row: FlowRow;
  nodeId: string;
  fallbackTaskId: string;
  fallbackVendor: string;
}): ExistingVideoNodeCompletion | null {
  const graph = readFlowGraph(input.row);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isFlowGraphNode) : [];
  const node = nodes.find((item) => readTrimmedString(item.id) === input.nodeId);
  if (!node) return null;
  const data = isRecord(node.data) ? node.data : {};
  const kind = readTrimmedString(data.kind);
  if (kind !== "video" && kind !== "composeVideo") return null;
  const asset = extractVideoAssetFromTaskResult(data);
  if (!asset.videoUrl) return null;
  if (!isHostedVideoAsset(input.c, asset)) return null;
  return {
    row: input.row,
    nodeId: readTrimmedString(node.id) || input.nodeId,
    taskId:
      readTrimmedString(data.videoTaskId) ||
      readTrimmedString(data.taskId) ||
      input.fallbackTaskId,
    vendor:
      readTrimmedString(data.videoModelVendor) ||
      readTrimmedString(data.vendor) ||
      input.fallbackVendor ||
      "auto",
    asset,
  };
}

function readExistingVideoNodeFailure(input: {
  row: FlowRow;
  nodeId: string;
  fallbackTaskId: string;
  fallbackVendor: string;
}): ExistingVideoNodeFailure | null {
  const graph = readFlowGraph(input.row);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isFlowGraphNode) : [];
  const node = nodes.find((item) => readTrimmedString(item.id) === input.nodeId);
  if (!node) return null;
  const data = isRecord(node.data) ? node.data : {};
  const kind = readTrimmedString(data.kind);
  if (kind !== "video" && kind !== "composeVideo") return null;
  if (readTrimmedString(data.status) !== "error") return null;
  const lastError = data.lastError;
  const taskId =
    readTrimmedString(data.videoTaskId) ||
    readTrimmedString(data.taskId) ||
    input.fallbackTaskId;
  const vendor =
    readTrimmedString(data.videoModelVendor) ||
    readTrimmedString(data.vendor) ||
    input.fallbackVendor ||
    "auto";
  return {
    row: input.row,
    nodeId: readTrimmedString(node.id) || input.nodeId,
    taskId,
    vendor,
    message: readCanvasNodeFailureMessage(lastError),
    code: readCanvasNodeFailureCode(lastError),
    httpStatus: readCanvasNodeFailureStatus(data, lastError),
    lastError,
  };
}

function throwExistingVideoNodeFailure(input: {
  flowId: string;
  failure: ExistingVideoNodeFailure;
  elapsedMs: number;
}): never {
  logVideoWaitEvent({
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
    code: "agents_tool_video_wait_node_failed",
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

function isExistingVideoNodeFailureError(error: unknown): boolean {
  return error instanceof AppError && error.code === "agents_tool_video_wait_node_failed";
}

function buildExistingVideoCompletionResponse(input: {
  flowId: string;
  completion: ExistingVideoNodeCompletion;
}): PublicAgentsVideoWaitForResultResult {
  return {
    ok: true,
    flowId: input.flowId,
    updatedAt: input.completion.row.updated_at,
    stats: buildEmptyPatchStats(),
    nodeId: input.completion.nodeId,
    status: "success",
    pending: false,
    videoUrl: input.completion.asset.videoUrl,
    thumbnailUrl: input.completion.asset.thumbnailUrl,
    vendor: input.completion.vendor,
    taskId: input.completion.taskId,
  };
}

function buildPendingVideoWaitResponse(input: {
  flowId: string;
  row: FlowRow;
  context: VideoNodeRuntimeContext;
  vendor: string;
  taskStatus: "queued" | "running" | "unknown";
  transientError?: PublicAgentsVideoWaitForResultPendingResult["transientError"];
}): PublicAgentsVideoWaitForResultResult {
  return {
    ok: true,
    flowId: input.flowId,
    updatedAt: input.row.updated_at,
    stats: buildEmptyPatchStats(),
    nodeId: input.context.nodeId,
    status: "pending",
    pending: true,
    videoUrl: null,
    thumbnailUrl: null,
    vendor: input.vendor,
    taskId: input.context.taskId,
    taskStatus: input.taskStatus,
    ...(input.transientError ? { transientError: input.transientError } : {}),
  };
}

function resolveVideoNodeRuntimeContext(input: {
  row: FlowRow;
  args: PublicAgentsVideoWaitForResultArgs;
  requestNodeId: string;
}): VideoNodeRuntimeContext {
  const graph = readFlowGraph(input.row);
  const requestedNodeId = readTrimmedString(input.args.nodeId) || input.requestNodeId;
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isFlowGraphNode) : [];
  const node = requestedNodeId
    ? nodes.find((item) => readTrimmedString(item.id) === requestedNodeId)
    : nodes.find((item) => {
        const data = isRecord(item.data) ? item.data : {};
        const kind = readTrimmedString(data.kind);
        const status = readTrimmedString(data.status);
        const taskId = readTrimmedString(data.videoTaskId) || readTrimmedString(data.taskId);
        return (kind === "video" || kind === "composeVideo") && (status === "running" || status === "queued") && taskId;
      });
  if (!node) {
    throw new AppError("Video node not found", {
      status: 404,
      code: "video_node_not_found",
      details: { nodeId: requestedNodeId || null },
    });
  }
  const data = isRecord(node.data) ? node.data : {};
  const kind = readTrimmedString(data.kind);
  if (kind !== "video" && kind !== "composeVideo") {
    throw new AppError("Node is not a video node", {
      status: 400,
      code: "invalid_video_node_kind",
      details: { nodeId: readTrimmedString(node.id), kind: kind || null },
    });
  }
  const nodeId = readTrimmedString(node.id);
  const requestedTaskId = readTrimmedString(input.args.taskId);
  const activeTaskId = readTrimmedString(data.videoTaskId);
  const legacyTaskId = readTrimmedString(data.taskId);
  if (requestedTaskId && activeTaskId && requestedTaskId !== activeTaskId) {
    throw new AppError("Video wait task id does not match the active video task", {
      status: 409,
      code: "video_wait_task_id_mismatch",
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
    throw new AppError("Video task id missing", {
      status: 400,
      code: "video_task_id_missing",
      details: { nodeId },
    });
  }
  return {
    nodeId,
    taskId,
    vendor: readTrimmedString(data.videoModelVendor) || readTrimmedString(data.vendor) || "auto",
    prompt: readTrimmedString(data.prompt),
    durationSeconds:
      readPositiveInteger(data.videoDurationSeconds) ??
      readPositiveInteger(data.durationSeconds),
    videoModel:
      readTrimmedString(data.videoModel) ||
      readTrimmedString(data.modelAlias) ||
      readTrimmedString(data.modelKey) ||
      null,
    label: readTrimmedString(data.label) || "Generated Video",
  };
}

const TRANSIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 429]);

/**
 * Classify an HTTP status (or absence of one) returned by `fetchTaskResultForPolling`.
 * "fatal" = won't change by retrying (most 4xx). "transient" = retry-worthy
 * (5xx, 408 timeout, 429 rate-limit, and network errors with no parseable status).
 */
export function classifyPollHttpStatus(
  status: number | undefined,
): "fatal" | "transient" {
  if (typeof status !== "number" || !Number.isFinite(status) || status <= 0) {
    return "transient";
  }
  if (status >= 500) return "transient";
  if (TRANSIENT_HTTP_STATUSES.has(status)) return "transient";
  if (status >= 400) return "fatal";
  return "transient";
}

async function pollVideoResultUntilTerminal(input: {
  c: AppContext;
  requestUserId: string;
  context: VideoNodeRuntimeContext;
  timeoutMs: number;
  readExistingCompletion: () => Promise<ExistingVideoNodeCompletion | null>;
  readExistingFailure: () => Promise<ExistingVideoNodeFailure | null>;
  flowId: string;
}): Promise<VideoWaitCompletion> {
  const startedAt = Date.now();
  const deadline = Date.now() + input.timeoutMs;
  let lastVendor = input.context.vendor;
  let lastTransientError: { status?: number; message?: string; body?: unknown } | null = null;
  let lastTaskStatus: "queued" | "running" | "unknown" = "unknown";
  while (Date.now() <= deadline) {
    const existingCompletion = await input.readExistingCompletion();
    if (existingCompletion) {
      logVideoWaitEvent({
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
      throwExistingVideoNodeFailure({
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
        taskKind: "image_to_video",
        prompt: input.context.prompt,
        mode: "public",
      });
    } catch (error: unknown) {
      const errObj = error as { status?: unknown; message?: unknown };
      const transientStatus =
        typeof errObj.status === "number" ? errObj.status : undefined;
      const transientMessage =
        typeof errObj.message === "string" ? errObj.message : String(error);
      const classification =
        isFatalAssetHostingPollError(error)
          ? "fatal"
          : classifyPollHttpStatus(transientStatus);
      lastTransientError = { status: transientStatus, message: transientMessage };
      logVideoWaitEvent({
        event:
          classification === "fatal"
            ? "poll-fatal-error"
            : "poll-transient-error",
        nodeId: input.context.nodeId,
        taskId: input.context.taskId,
        vendor: lastVendor,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        httpStatus: transientStatus,
      });
      if (classification === "fatal") {
        throw buildFatalVideoPollError({
          error,
          nodeId: input.context.nodeId,
          taskId: input.context.taskId,
          vendor: lastVendor || null,
          httpStatus: transientStatus,
          message: transientMessage,
        });
      }
      lastTaskStatus = "unknown";
      const delayMs = videoWaitDelayBeforeNextPoll(deadline);
      if (delayMs <= 0) break;
      await sleep(delayMs);
      continue;
    }
    if (!outcome.ok) {
      const classification =
        isFatalAssetHostingPollError(outcome.body)
          ? "fatal"
          : classifyPollHttpStatus(outcome.status);
      lastTransientError = { status: outcome.status, body: outcome.body };
      logVideoWaitEvent({
        event:
          classification === "fatal"
            ? "poll-fatal-error"
            : "poll-transient-error",
        nodeId: input.context.nodeId,
        taskId: input.context.taskId,
        vendor: lastVendor,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        httpStatus: outcome.status,
      });
      if (classification === "fatal") {
        throw buildFatalVideoPollError({
          error: outcome.body,
          nodeId: input.context.nodeId,
          taskId: input.context.taskId,
          vendor: lastVendor || null,
          httpStatus: outcome.status,
          body: outcome.body,
        });
      }
      lastTaskStatus = "unknown";
      const delayMs = videoWaitDelayBeforeNextPoll(deadline);
      if (delayMs <= 0) break;
      await sleep(delayMs);
      continue;
    }
    lastTransientError = null;
    lastVendor = readTrimmedString(outcome.vendor) || lastVendor;
    logVideoWaitEvent({
      event: "poll-result",
      nodeId: input.context.nodeId,
      taskId: input.context.taskId,
      vendor: lastVendor,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      status: outcome.result.status,
    });
    if (outcome.result.status === "queued" || outcome.result.status === "running") {
      lastTaskStatus = outcome.result.status;
      const delayMs = videoWaitDelayBeforeNextPoll(deadline);
      if (delayMs <= 0) break;
      await sleep(delayMs);
      continue;
    }
    if (outcome.result.status === "failed") {
      throw new AppError("视频生成失败", {
        status: 502,
        code: "agents_tool_video_wait_failed",
        details: {
          nodeId: input.context.nodeId,
          taskId: input.context.taskId,
          vendor: lastVendor || null,
          message: buildVideoFailureMessage(outcome.result) || null,
        },
      });
    }
    const asset = extractVideoAssetFromTaskResult(outcome.result);
    if (!asset.videoUrl) {
      logVideoWaitEvent({
        event: "missing-video-url",
        nodeId: input.context.nodeId,
        taskId: input.context.taskId,
        vendor: lastVendor,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        status: outcome.result.status,
      });
      throw new AppError("视频生成失败：未返回视频 URL", {
        status: 502,
        code: "agents_tool_video_wait_missing_url",
        details: {
          nodeId: input.context.nodeId,
          taskId: input.context.taskId,
          vendor: lastVendor || null,
        },
      });
    }
    if (!isHostedVideoAsset(input.c, asset)) {
      logVideoWaitEvent({
        event: "unhosted-video-url",
        nodeId: input.context.nodeId,
        taskId: input.context.taskId,
        vendor: lastVendor,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        status: outcome.result.status,
      });
      throw new AppError("视频生成结果未完成持久化托管", {
        status: 502,
        code: "agents_tool_video_wait_unhosted_url",
        details: {
          nodeId: input.context.nodeId,
          taskId: input.context.taskId,
          vendor: lastVendor || null,
        },
      });
    }
    logVideoWaitEvent({
      event: "task-completion",
      nodeId: input.context.nodeId,
      taskId: input.context.taskId,
      vendor: lastVendor,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      status: outcome.result.status,
    });
    return { source: "task", vendor: lastVendor, result: outcome.result, asset };
  }
  logVideoWaitEvent({
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

async function patchVideoWaitFailureToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  context: VideoNodeRuntimeContext;
  error: unknown;
  waitStartedAt: number;
}): Promise<void> {
  const errorStatus = readErrorStatus(input.error);
  const lastError: Record<string, unknown> = {
    message: buildVisibleVideoWaitErrorMessage(input.error),
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
    videoTaskId: input.context.taskId,
    vendor: input.context.vendor,
    videoModelVendor: input.context.vendor,
    lastError,
    httpStatus: errorStatus,
  };
  if (input.context.videoModel) patchData.videoModel = input.context.videoModel;
  if (input.context.durationSeconds) patchData.videoDurationSeconds = input.context.durationSeconds;

  logVideoWaitEvent({
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
    versionLabel: "video-result-error",
    redisUrl: String(input.c.env.REDIS_URL || "").trim(),
    buildNextState: (latestRow: FlowRow) => {
      const latestGraph = readFlowGraph(latestRow);
      const latestNodes = Array.isArray(latestGraph.nodes) ? latestGraph.nodes.filter(isFlowGraphNode) : [];
      const latestNode = latestNodes.find((item) => readTrimmedString(item.id) === input.context.nodeId);
      if (!latestNode) {
        throw new AppError("Video node not found", {
          status: 404,
          code: "video_node_not_found",
          details: { nodeId: input.context.nodeId },
        });
      }
      const existingData = isRecord(latestNode.data) ? latestNode.data : {};
      const kind = readTrimmedString(existingData.kind);
      if (kind !== "video" && kind !== "composeVideo") {
        throw new AppError("Node is not a video node", {
          status: 400,
          code: "invalid_video_node_kind",
          details: {
            nodeId: input.context.nodeId,
            kind: kind || null,
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
        throw new AppError("Video wait failure patch did not update node", {
          status: 500,
          code: "video_wait_error_patch_noop",
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

  logVideoWaitEvent({
    event: "error-patch-success",
    nodeId: input.context.nodeId,
    taskId: input.context.taskId,
    vendor: input.context.vendor,
    elapsedMs: Math.max(0, Date.now() - input.waitStartedAt),
    status: "error",
    httpStatus: errorStatus,
  });
}

function buildVideoResults(input: {
  existingData: Record<string, unknown>;
  context: VideoNodeRuntimeContext;
  result: TaskResultDto;
  asset: ExtractedVideoAsset;
}): { results: Array<Record<string, unknown>>; primaryIndex: number } {
  const existingResults = Array.isArray(input.existingData.videoResults)
    ? input.existingData.videoResults.filter(isRecord)
    : [];
  const existingIndex = existingResults.findIndex((item) => readTrimmedString(item.url) === input.asset.videoUrl);
  if (existingIndex >= 0) {
    return { results: existingResults, primaryIndex: existingIndex };
  }
  const nextItem: Record<string, unknown> = {
    id: readTrimmedString(input.result.id) || input.context.taskId,
    url: input.asset.videoUrl,
    title: input.context.label,
  };
  if (input.context.videoModel) nextItem.model = input.context.videoModel;
  if (input.asset.thumbnailUrl) nextItem.thumbnailUrl = input.asset.thumbnailUrl;
  if (input.asset.assetId) nextItem.assetId = input.asset.assetId;
  if (input.context.durationSeconds) nextItem.duration = input.context.durationSeconds;
  const results = [...existingResults, nextItem];
  return { results, primaryIndex: results.length - 1 };
}

async function patchCompletedVideoResultToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  context: VideoNodeRuntimeContext;
  vendor: string;
  result: TaskResultDto;
  asset: ExtractedVideoAsset;
  waitStartedAt: number;
}): Promise<PublicAgentsVideoWaitForResultResult> {
  logVideoWaitEvent({
    event: "patch-start",
    nodeId: input.context.nodeId,
    taskId: input.context.taskId,
    vendor: input.vendor,
    elapsedMs: Math.max(0, Date.now() - input.waitStartedAt),
    status: input.result.status,
  });

  const { updatedRow } = await optimisticCanvasWrite({
    db: input.c.env.DB,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    versionLabel: "video-result",
    redisUrl: String(input.c.env.REDIS_URL || "").trim(),
    buildNextState: (latestRow: FlowRow) => {
      const latestGraph = readFlowGraph(latestRow);
      const latestNodes = Array.isArray(latestGraph.nodes) ? latestGraph.nodes.filter(isFlowGraphNode) : [];
      const latestNode = latestNodes.find((item) => readTrimmedString(item.id) === input.context.nodeId);
      if (!latestNode) {
        throw new AppError("Video node not found", {
          status: 404,
          code: "video_node_not_found",
          details: { nodeId: input.context.nodeId },
        });
      }
      const existingData = isRecord(latestNode.data) ? latestNode.data : {};
      const videoResults = buildVideoResults({
        existingData,
        context: input.context,
        result: input.result,
        asset: input.asset,
      });
      const patchData: Record<string, unknown> = {
        status: "success",
        progress: 100,
        videoUrl: input.asset.videoUrl,
        videoResults: videoResults.results,
        videoPrimaryIndex: videoResults.primaryIndex,
        taskId: input.context.taskId,
        videoTaskId: input.context.taskId,
        vendor: input.vendor,
        videoModelVendor: input.vendor,
      };
      if (input.context.videoModel) patchData.videoModel = input.context.videoModel;
      if (input.asset.thumbnailUrl) patchData.videoThumbnailUrl = input.asset.thumbnailUrl;
      if (input.asset.assetId) patchData.assetId = input.asset.assetId;
      if (input.context.durationSeconds) patchData.videoDurationSeconds = input.context.durationSeconds;

      const applied = applyPublicFlowGraphPatch({
        current: sanitizeFlowDataForStorage(mapFlowRowToDto(latestRow).data ?? {}),
        patch: {
          allowOverwrite: true,
          patchNodeData: [{ id: input.context.nodeId, data: patchData }],
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

  logVideoWaitEvent({
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
    videoUrl: input.asset.videoUrl,
    thumbnailUrl: input.asset.thumbnailUrl,
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

export async function settleVideoResultToCanvasOnce(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  requestNodeId: string;
  bodyArgs: unknown;
}): Promise<VideoResultSettleOnceResult> {
  const waitStartedAt = Date.now();
  const parsedArgs = PublicAgentsVideoWaitForResultArgsSchema.safeParse(input.bodyArgs);
  if (!parsedArgs.success) {
    throw new AppError("Invalid video wait request", {
      status: 400,
      code: "invalid_video_wait_request",
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
    const existingCompletion = readExistingVideoNodeCompletion({
      c: input.c,
      row: latestRowBeforePolling,
      nodeId: requestedNodeId,
      fallbackTaskId: readTrimmedString(parsedArgs.data.taskId),
      fallbackVendor: "auto",
    });
    if (existingCompletion) {
      return {
        outcome: "success",
        result: buildExistingVideoCompletionResponse({
          flowId: input.flowId,
          completion: existingCompletion,
        }),
      };
    }
    const existingFailure = readExistingVideoNodeFailure({
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

  const waitContext = resolveVideoNodeRuntimeContext({
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
      taskKind: "image_to_video",
      prompt: waitContext.prompt,
      mode: "public",
    });
  } catch (error: unknown) {
    const errObj = error as { status?: unknown; message?: unknown };
    const httpStatus = typeof errObj.status === "number" ? errObj.status : undefined;
    const message = typeof errObj.message === "string" ? errObj.message : String(error);
    if (
      !isFatalAssetHostingPollError(error) &&
      classifyPollHttpStatus(httpStatus) === "transient"
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
    const fatal = buildFatalVideoPollError({
      error,
      nodeId: waitContext.nodeId,
      taskId: waitContext.taskId,
      vendor: lastVendor || null,
      httpStatus,
      message,
    });
    await patchVideoWaitFailureToCanvas({
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
      classifyPollHttpStatus(outcome.status) === "transient"
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
    const fatal = buildFatalVideoPollError({
      error: outcome.body,
      nodeId: waitContext.nodeId,
      taskId: waitContext.taskId,
      vendor: lastVendor || null,
      httpStatus: outcome.status,
      body: outcome.body,
    });
    await patchVideoWaitFailureToCanvas({
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
    terminalError = new AppError("视频生成失败", {
      status: 502,
      code: "agents_tool_video_wait_failed",
      details: {
        nodeId: waitContext.nodeId,
        taskId: waitContext.taskId,
        vendor: lastVendor || null,
        message: buildVideoFailureMessage(outcome.result) || null,
      },
    });
  }

  const asset = terminalError ? null : extractVideoAssetFromTaskResult(outcome.result);
  if (!terminalError && asset && !asset.videoUrl) {
    terminalError = new AppError("视频生成失败：未返回视频 URL", {
      status: 502,
      code: "agents_tool_video_wait_missing_url",
      details: {
        nodeId: waitContext.nodeId,
        taskId: waitContext.taskId,
        vendor: lastVendor || null,
      },
    });
  }
  if (!terminalError && asset && !isHostedVideoAsset(input.c, asset)) {
    terminalError = new AppError("视频生成结果未完成持久化托管", {
      status: 502,
      code: "agents_tool_video_wait_unhosted_url",
      details: {
        nodeId: waitContext.nodeId,
        taskId: waitContext.taskId,
        vendor: lastVendor || null,
      },
    });
  }
  if (terminalError) {
    await patchVideoWaitFailureToCanvas({
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

  const result = await patchCompletedVideoResultToCanvas({
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

export async function waitForVideoResultToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  row: FlowRow;
  requestNodeId: string;
  bodyArgs: unknown;
}): Promise<PublicAgentsVideoWaitForResultResult> {
  const waitStartedAt = Date.now();
  const parsedArgs = PublicAgentsVideoWaitForResultArgsSchema.safeParse(input.bodyArgs);
  if (!parsedArgs.success) {
    throw new AppError("Invalid video wait request", {
      status: 400,
      code: "invalid_video_wait_request",
      details: { issues: parsedArgs.error.issues },
    });
  }
  const timeoutMs = VIDEO_WAIT_DEFAULT_TIMEOUT_MS;
  const latestRowBeforePolling = await loadLatestFlowRow({
    c: input.c,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    flowId: input.flowId,
  });
  const requestedNodeId = readTrimmedString(parsedArgs.data.nodeId) || input.requestNodeId;
  if (requestedNodeId) {
    const existingCompletion = readExistingVideoNodeCompletion({
      c: input.c,
      row: latestRowBeforePolling,
      nodeId: requestedNodeId,
      fallbackTaskId: readTrimmedString(parsedArgs.data.taskId),
      fallbackVendor: "auto",
    });
    if (existingCompletion) {
      logVideoWaitEvent({
        event: "precheck-existing-flow-completion",
        nodeId: requestedNodeId,
        taskId: existingCompletion.taskId,
        vendor: existingCompletion.vendor,
        elapsedMs: Math.max(0, Date.now() - waitStartedAt),
        status: "success",
      });
      return buildExistingVideoCompletionResponse({
        flowId: input.flowId,
        completion: existingCompletion,
      });
    }
    const existingFailure = readExistingVideoNodeFailure({
      row: latestRowBeforePolling,
      nodeId: requestedNodeId,
      fallbackTaskId: readTrimmedString(parsedArgs.data.taskId),
      fallbackVendor: "auto",
    });
    if (existingFailure) {
      throwExistingVideoNodeFailure({
        flowId: input.flowId,
        failure: existingFailure,
        elapsedMs: Math.max(0, Date.now() - waitStartedAt),
      });
    }
  }
  const waitContext = resolveVideoNodeRuntimeContext({
    row: latestRowBeforePolling,
    args: parsedArgs.data,
    requestNodeId: input.requestNodeId,
  });
  logVideoWaitEvent({
    event: "wait-start",
    nodeId: waitContext.nodeId,
    taskId: waitContext.taskId,
    vendor: waitContext.vendor,
    elapsedMs: 0,
    timeoutMs,
  });
  const readExistingCompletion = async (): Promise<ExistingVideoNodeCompletion | null> => {
    const latestRow = await loadLatestFlowRow({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
    });
    return readExistingVideoNodeCompletion({
      c: input.c,
      row: latestRow,
      nodeId: waitContext.nodeId,
      fallbackTaskId: waitContext.taskId,
      fallbackVendor: waitContext.vendor,
    });
  };
  const readExistingFailure = async (): Promise<ExistingVideoNodeFailure | null> => {
    const latestRow = await loadLatestFlowRow({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
    });
    return readExistingVideoNodeFailure({
      row: latestRow,
      nodeId: waitContext.nodeId,
      fallbackTaskId: waitContext.taskId,
      fallbackVendor: waitContext.vendor,
    });
  };

  let completed: VideoWaitCompletion;
  try {
    completed = await pollVideoResultUntilTerminal({
      c: input.c,
      requestUserId: input.requestUserId,
      context: waitContext,
      timeoutMs,
      readExistingCompletion,
      readExistingFailure,
      flowId: input.flowId,
    });
  } catch (error) {
    if (isExistingVideoNodeFailureError(error)) throw error;
    try {
      await patchVideoWaitFailureToCanvas({
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
      console.error("[agents-video-wait] error-patch-failed", {
        nodeId: waitContext.nodeId,
        taskId: waitContext.taskId,
        patchError: serializeErrorForDetails(patchError),
      });
    }
    throw error;
  }
  if (completed.source === "flow") {
    return buildExistingVideoCompletionResponse({
      flowId: input.flowId,
      completion: completed.completion,
    });
  }
  if (completed.source === "pending") {
    return buildPendingVideoWaitResponse({
      flowId: input.flowId,
      row: latestRowBeforePolling,
      context: waitContext,
      vendor: completed.vendor,
      taskStatus: completed.taskStatus,
      ...(completed.transientError ? { transientError: completed.transientError } : {}),
    });
  }

  return patchCompletedVideoResultToCanvas({
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
