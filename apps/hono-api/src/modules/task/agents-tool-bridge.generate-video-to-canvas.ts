import { z } from "zod";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
  PublicFlowCreateTaskNodeSchema,
  PublicFlowGraphSchema,
  PublicFlowPatchResponseSchema,
} from "../flow/flow.public.schemas";
import { applyPublicFlowGraphPatch } from "../flow/flow.public.service";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import { mapFlowRowToDto, type FlowRow } from "../flow/flow.repo";
import { optimisticCanvasWrite } from "../flow/flow.optimistic-write";
import { runPublicTask } from "../apiKey/apiKey.routes";
import { isHostedAssetUrl } from "../asset/asset.hosting";
import {
  resolveCanvasTaskModel,
} from "./agents-tool-bridge.resolve-model";
import {
  AgentVideoGenerateToCanvasArgsSchema,
  buildDirectVideoGenerateToCanvasArgs,
} from "./agents-tool-bridge.agent-media-schemas";
import type { TaskRequestDto, TaskResultDto } from "./task.schemas";
import {
  buildVideoFailureMessage,
  extractVideoAssetFromTaskResult,
  readTrimmedString,
  resolveTaskIdFromResult,
} from "./agents-tool-bridge.video-result";
import { parseModelDefaults } from "./model-defaults";
import { detectSilentSignal } from "./audio-signal";
import { getCatalogModelByVendorAndKey } from "../model-catalog/model-catalog.repo";
import { resolveLatestMediaReferences } from "./agents-tool-bridge.media-reference-resolver";

const FIXED_VIDEO_RESOLUTION = "720p";

type VideoCanvasToolStatus = "queued" | "running" | "success";

type ModelSelectionDebugInfo = {
  slot: "video";
  vendorKey: string;
  modelKey: string;
};

type VideoGenerateDebugInfo = {
  normalizedTaskRequest: {
    kind: TaskRequestDto["kind"];
    prompt: string;
    negativePrompt?: string;
    extras: Record<string, unknown>;
  };
  providerNormalization?: {
    vendor: string;
    droppedUnsupportedFields: string[];
  };
  vendorRequest?: Record<string, unknown>;
  modelSelection?: ModelSelectionDebugInfo;
};

type MediaAgentRunContext = {
  runId?: string;
  toolCallId?: string;
  publicChatRunId?: string;
  sessionKey?: string;
};

function buildMediaAgentBinding(
  runContext: MediaAgentRunContext | undefined,
): Record<string, unknown> | null {
  const publicChatRunId = readTrimmedString(runContext?.publicChatRunId);
  const toolCallId = readTrimmedString(runContext?.toolCallId);
  if (!publicChatRunId || !toolCallId) return null;
  const agentsRunId = readTrimmedString(runContext?.runId);
  const sessionKey = readTrimmedString(runContext?.sessionKey);
  return {
    publicChatRunId,
    toolCallId,
    ...(agentsRunId ? { agentsRunId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    submittedAt: new Date().toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type FlowNodeRecord = Record<string, unknown>;

function readNodeRecord(value: unknown): FlowNodeRecord {
  return isRecord(value) ? value : {};
}

function readNodeIdField(node: FlowNodeRecord): string {
  return readTrimmedString(node.id);
}

function readNodeTypeField(node: FlowNodeRecord): string {
  return readTrimmedString(node.type);
}

function findFlowNodeById(nodes: unknown[], nodeId: string): FlowNodeRecord | null {
  for (const node of nodes) {
    const record = readNodeRecord(node);
    if (readNodeIdField(record) === nodeId) return record;
  }
  return null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = readTrimmedString(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.trunc(parsed));
}

function normalizeInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function readOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeVideoResolution(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, "").toLowerCase() : "";
}

function buildVideoSpecKey(
  resolution: string,
  durationSeconds: number | null,
): string {
  const normalizedResolution = normalizeVideoResolution(resolution);
  const normalizedDuration =
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
      ? Math.trunc(durationSeconds)
      : 0;
  if (!normalizedResolution || normalizedDuration <= 0) return "";
  return `video:${normalizedResolution}:${normalizedDuration}s`;
}

function omitCallerVideoResolutionFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...data };
  delete next.resolution;
  delete next.videoResolution;
  delete next.specKey;
  delete next.videoSpecKey;
  return next;
}

type CanvasAssetInput = {
  sourceNodeId?: string;
  assetId?: string;
  assetRefId?: string;
  url?: string;
  role?: string;
  note?: string;
  name?: string;
  weight?: number;
  relationshipKind?: "primary" | "reference";
};

function normalizeAssetInputs(value: unknown): CanvasAssetInput[] {
  if (!Array.isArray(value)) return [];
  const out: CanvasAssetInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const assetId = readTrimmedString(record.assetId);
    const sourceNodeId = readTrimmedString(record.sourceNodeId);
    const assetRefId = readTrimmedString(record.assetRefId);
    const url = readTrimmedString(record.url);
    const role = readTrimmedString(record.role);
    const note = readTrimmedString(record.note);
    const name = readTrimmedString(record.name);
    const weight = typeof record.weight === "number" && Number.isFinite(record.weight) ? record.weight : null;
    const relationshipKind = record.relationshipKind === "primary" || record.relationshipKind === "reference"
      ? record.relationshipKind
      : "";
    if (!sourceNodeId && !assetId && !assetRefId && !url) continue;
    out.push({
      ...(assetId ? { assetId } : {}),
      ...(sourceNodeId ? { sourceNodeId } : {}),
      ...(assetRefId ? { assetRefId } : {}),
      ...(url ? { url } : {}),
      ...(role ? { role } : {}),
      ...(note ? { note } : {}),
      ...(name ? { name } : {}),
      ...(weight !== null ? { weight } : {}),
      ...(relationshipKind ? { relationshipKind } : {}),
    });
  }
  return out;
}

function buildProviderVideoTaskExtras(input: {
  vendor: string;
  modelKey: string;
  aspectRatio: string;
  resolution: string;
  specKey: string;
  durationSeconds: number | null;
  seed: number | null;
  generateAudio: boolean;
  returnLastFrame: boolean | null;
  referenceImages: string[];
  assetInputs: CanvasAssetInput[];
}): {
  extras: Record<string, unknown>;
  droppedUnsupportedFields: string[];
} {
  const droppedUnsupportedFields: string[] = [];
  const isSeedanceArkImageToVideo = input.vendor === "seedance-ark";
  if (isSeedanceArkImageToVideo && input.seed !== null) {
    droppedUnsupportedFields.push("seed");
  }
  if (isSeedanceArkImageToVideo && input.returnLastFrame === true) {
    droppedUnsupportedFields.push("returnLastFrame", "return_last_frame");
  }

  return {
    extras: {
      modelKey: input.modelKey,
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.resolution ? { resolution: input.resolution } : {}),
      ...(input.specKey ? { specKey: input.specKey, videoSpecKey: input.specKey } : {}),
      ...(input.durationSeconds ? { durationSeconds: input.durationSeconds } : {}),
      ...(!isSeedanceArkImageToVideo && input.seed !== null ? { seed: input.seed } : {}),
      generateAudio: input.generateAudio,
      generate_audio: input.generateAudio,
      ...(!isSeedanceArkImageToVideo && input.returnLastFrame === true
        ? { returnLastFrame: true, return_last_frame: true }
        : {}),
      ...(input.referenceImages.length ? { referenceImages: input.referenceImages } : {}),
      ...(input.assetInputs.length ? { assetInputs: input.assetInputs } : {}),
      persistAssets: true,
    },
    droppedUnsupportedFields,
  };
}

function normalizeVideoCanvasToolStatus(
  result: TaskResultDto,
  vendor: string,
): VideoCanvasToolStatus {
  if (result.status === "queued" || result.status === "running") return result.status;
  if (result.status === "succeeded") return "success";
  throw new AppError("视频生成失败", {
    status: 502,
    code: "agents_tool_video_generate_failed",
    details: {
      taskId: resolveTaskIdFromResult(result),
      vendor: vendor || null,
      status: result.status,
      message: buildVideoFailureMessage(result) || null,
    },
  });
}

function buildNormalizedTaskRequestDebug(
  taskRequest: TaskRequestDto,
): VideoGenerateDebugInfo["normalizedTaskRequest"] {
  const extras: unknown = taskRequest.extras;
  return {
    kind: taskRequest.kind,
    prompt: taskRequest.prompt,
    ...(taskRequest.negativePrompt ? { negativePrompt: taskRequest.negativePrompt } : {}),
    extras: isRecord(extras) ? extras : {},
  };
}

function readVendorRequestDebug(result: TaskResultDto): Record<string, unknown> | undefined {
  if (!isRecord(result.raw)) return undefined;
  return isRecord(result.raw.request) ? result.raw.request : undefined;
}

export const PublicAgentsVideoGenerateToCanvasArgsSchema =
  AgentVideoGenerateToCanvasArgsSchema;

export type PublicAgentsVideoGenerateToCanvasArgs = z.infer<
  typeof PublicAgentsVideoGenerateToCanvasArgsSchema
>;

export type PublicAgentsVideoGenerateToCanvasResult = {
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
  status: VideoCanvasToolStatus;
  pending: boolean;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  vendor: string;
  taskId: string | null;
  debug: VideoGenerateDebugInfo;
};

export async function generateVideoToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  row: FlowRow;
  bodyArgs: unknown;
  runContext?: MediaAgentRunContext;
}): Promise<PublicAgentsVideoGenerateToCanvasResult> {
  const parsedArgs = PublicAgentsVideoGenerateToCanvasArgsSchema.safeParse(input.bodyArgs);
  if (!parsedArgs.success) {
    throw new AppError("Invalid video generate to canvas request", {
      status: 400,
      code: "invalid_video_generate_to_canvas_request",
      details: { issues: parsedArgs.error.issues },
    });
  }

  const taskNode = buildDirectVideoGenerateToCanvasArgs(parsedArgs.data).node;
  const nodeData = taskNode.data as Record<string, unknown>;
  const prompt = readTrimmedString(nodeData.prompt);
  const negativePrompt = readTrimmedString(nodeData.negativePrompt);

  const resolved = await resolveCanvasTaskModel(input.c, "video");
  const resolvedVendor = resolved.vendorKey;
  const resolvedModelKey = resolved.modelKey;
  const modelSelection: ModelSelectionDebugInfo = {
    slot: "video",
    vendorKey: resolvedVendor,
    modelKey: resolvedModelKey,
  };
  const aspectRatio = readTrimmedString(nodeData.aspectRatio);
  const resolution = FIXED_VIDEO_RESOLUTION;
  const durationSeconds = normalizePositiveInteger(nodeData.durationSeconds);
  const seed = normalizeInteger(nodeData.seed);

  const modelRow = await getCatalogModelByVendorAndKey(input.c.env.DB, {
    vendorKey: resolvedVendor,
    modelKey: resolvedModelKey,
  });
  const modelDefaults = parseModelDefaults(modelRow?.meta ?? null);

  const audioMode = readTrimmedString(nodeData.audioMode);
  const hardSilentSignal = detectSilentSignal(prompt);

  // Priority (high → low):
  //   1. user prompt hard signal ("静音"/"silent"/...) → false
  //   2. explicit UI audioMode ("silent" | "with-audio")
  //   3. model catalog meta.defaults.generateAudio
  //   4. true (final fallback)
  let generateAudio: boolean;
  if (hardSilentSignal) {
    generateAudio = false;
  } else if (audioMode === "silent") {
    generateAudio = false;
  } else if (audioMode === "with-audio") {
    generateAudio = true;
  } else if (typeof modelDefaults.generateAudio === "boolean") {
    generateAudio = modelDefaults.generateAudio;
  } else {
    generateAudio = true;
  }
  const returnLastFrame = readOptionalBoolean(nodeData.returnLastFrame);
  const specKey = buildVideoSpecKey(resolution, durationSeconds);
  const resolvedReferences = await resolveLatestMediaReferences({
    c: input.c,
    requestUserId: input.requestUserId,
    flowId: input.flowId,
    referenceImages: normalizeStringList(nodeData.referenceImages),
    assetInputs: normalizeAssetInputs(nodeData.assetInputs),
  });
  const referenceImages = resolvedReferences.referenceImages;
  const assetInputs = resolvedReferences.assetInputs;
  const taskKind: TaskRequestDto["kind"] = "image_to_video";
  const normalizedExtras = buildProviderVideoTaskExtras({
    vendor: resolvedVendor,
    modelKey: resolvedModelKey,
    aspectRatio,
    resolution,
    specKey,
    durationSeconds,
    seed,
    generateAudio,
    returnLastFrame,
    referenceImages,
    assetInputs,
  });
  const taskRequest: TaskRequestDto = {
    kind: taskKind,
    prompt,
    ...(negativePrompt ? { negativePrompt } : {}),
    extras: normalizedExtras.extras,
  };
  const generationContext = {
    schemaVersion: 1,
    requestedPrompt: prompt,
    effectivePrompt: prompt,
    promptTransforms: [] as string[],
    submittedAt: new Date().toISOString(),
  };

  const created = await runPublicTask(input.c, input.requestUserId, {
    vendor: "auto",
    vendorCandidates: [resolvedVendor],
    request: taskRequest,
  });

  const createdVendor = readTrimmedString(created.vendor) || "auto";
  const vendorRequest = readVendorRequestDebug(created.result);
  const debug: VideoGenerateDebugInfo = {
    normalizedTaskRequest: buildNormalizedTaskRequestDebug(taskRequest),
    ...(normalizedExtras.droppedUnsupportedFields.length
      ? {
          providerNormalization: {
            vendor: resolvedVendor,
            droppedUnsupportedFields: normalizedExtras.droppedUnsupportedFields,
          },
        }
      : {}),
    ...(vendorRequest ? { vendorRequest } : {}),
    ...(modelSelection ? { modelSelection } : {}),
  };
  const canvasStatus = normalizeVideoCanvasToolStatus(created.result, createdVendor);
  const taskId = resolveTaskIdFromResult(created.result);
  const extracted = extractVideoAssetFromTaskResult(created.result);
  if ((canvasStatus === "queued" || canvasStatus === "running") && !taskId) {
    throw new AppError("视频任务创建失败：未返回任务 ID", {
      status: 502,
      code: "agents_tool_video_task_id_missing",
      details: {
        vendor: createdVendor,
        status: created.result.status,
      },
    });
  }
  if (canvasStatus === "success" && !extracted.videoUrl) {
    throw new AppError("视频生成失败：未返回视频 URL", {
      status: 502,
      code: "agents_tool_video_missing_url",
      details: {
        taskId,
        vendor: createdVendor,
      },
    });
  }
  if (
    canvasStatus === "success" &&
    extracted.videoUrl &&
    !isHostedAssetUrl(input.c, extracted.videoUrl)
  ) {
    throw new AppError("视频生成结果未完成持久化托管", {
      status: 502,
      code: "agents_tool_video_unhosted_url",
      details: {
        taskId,
        vendor: createdVendor,
      },
    });
  }

  const explicitNodeId = readTrimmedString(taskNode.id);
  if (!explicitNodeId) {
    throw new AppError(
      "canvas_video_generate_to_canvas requires outputKey; choose a stable key such as video_clip_<n:02d>_<slug>.",
      {
        status: 400,
        code: "agents_tool_output_key_required",
        details: { tool: "canvas_video_generate_to_canvas" },
      },
    );
  }
  const nodeId = explicitNodeId;
  const label = readTrimmedString(nodeData.label) || "Generated Video";
  const canonicalNodeData = omitCallerVideoResolutionFields(nodeData);
  const mediaAgent = buildMediaAgentBinding(input.runContext);
  const finalNodeData =
    canvasStatus === "success"
      ? {
          ...canonicalNodeData,
          ...(mediaAgent ? { mediaAgent } : {}),
          kind: taskNode.data.kind,
          resolution,
          videoResolution: resolution,
          ...(specKey ? { specKey, videoSpecKey: specKey } : {}),
					generationContext,
          status: "success",
          progress: 100,
          videoUrl: extracted.videoUrl,
          ...(extracted.thumbnailUrl ? { videoThumbnailUrl: extracted.thumbnailUrl } : {}),
          videoResults: [
            {
              url: extracted.videoUrl,
              ...(extracted.thumbnailUrl ? { thumbnailUrl: extracted.thumbnailUrl } : {}),
              title: label,
              ...(extracted.assetId ? { assetId: extracted.assetId } : {}),
              ...(durationSeconds ? { duration: durationSeconds } : {}),
            },
          ],
          videoPrimaryIndex: 0,
          ...(extracted.assetId ? { assetId: extracted.assetId } : {}),
          ...(durationSeconds ? { videoDurationSeconds: durationSeconds } : {}),
          ...(taskId ? { taskId, videoTaskId: taskId } : {}),
          vendor: resolvedVendor,
          videoModelVendor: resolvedVendor,
          videoModel: resolvedModelKey,
        }
      : {
          ...canonicalNodeData,
          ...(mediaAgent ? { mediaAgent } : {}),
          kind: taskNode.data.kind,
          resolution,
          videoResolution: resolution,
          ...(specKey ? { specKey, videoSpecKey: specKey } : {}),
					generationContext,
          status: canvasStatus,
          progress: canvasStatus === "queued" ? 10 : 15,
          ...(durationSeconds ? { videoDurationSeconds: durationSeconds } : {}),
          ...(taskId ? { taskId, videoTaskId: taskId } : {}),
          vendor: resolvedVendor,
          videoModelVendor: resolvedVendor,
          videoModel: resolvedModelKey,
        };
  const finalNode = {
    ...taskNode,
    id: nodeId,
    data: finalNodeData,
  };

  const incomingKind = readTrimmedString(
    isRecord(taskNode.data) ? (taskNode.data as Record<string, unknown>).kind : undefined,
  );

  let didUpsert = false;
  let appliedStats: ReturnType<typeof applyPublicFlowGraphPatch>["stats"] | null = null;
  const { updatedRow } = await optimisticCanvasWrite({
    db: input.c.env.DB,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    versionLabel: "generate-video-pending",
    redisUrl: String(input.c.env.REDIS_URL || "").trim(),
    buildNextState: (latestRow: FlowRow) => {
      const dto = mapFlowRowToDto(latestRow);
      const current = sanitizeFlowDataForStorage(dto.data ?? {});
      const currentParsed = PublicFlowGraphSchema.safeParse(current);
      if (!currentParsed.success) {
        throw new AppError("Flow data invalid", {
          status: 500,
          code: "flow_data_invalid",
          details: { issues: currentParsed.error.issues },
        });
      }
      const currentNodes = Array.isArray(currentParsed.data.nodes) ? currentParsed.data.nodes : [];

      const existingNode = findFlowNodeById(currentNodes, nodeId);
      let applied: ReturnType<typeof applyPublicFlowGraphPatch>;
      if (existingNode) {
        const existingType = readNodeTypeField(existingNode);
        if (existingType !== "taskNode") {
          throw new AppError(
            `canvas_video_generate_to_canvas: node ${nodeId} exists but is not a taskNode; pick a different stable id`,
            {
              status: 409,
              code: "agents_tool_node_id_kind_mismatch",
              details: { nodeId, existingType },
            },
          );
        }
        const existingKind = readTrimmedString(
          isRecord(existingNode.data) ? (existingNode.data as Record<string, unknown>).kind : undefined,
        );
        if (incomingKind && existingKind && existingKind !== incomingKind) {
          throw new AppError(
            `canvas_video_generate_to_canvas: node ${nodeId} exists with data.kind="${existingKind}" but request kind="${incomingKind}"; pick a different stable id`,
            {
              status: 409,
              code: "agents_tool_node_id_kind_mismatch",
              details: { nodeId, existingKind, incomingKind },
            },
          );
        }
        didUpsert = true;
        applied = applyPublicFlowGraphPatch({
          current,
          origin: input.runContext,
          patch: {
            patchNodeData: [
              {
                id: nodeId,
                data: finalNodeData,
                mergeStrategy: "overwrite",
              },
            ],
          },
        });
      } else {
        didUpsert = false;
        applied = applyPublicFlowGraphPatch({
          current,
          origin: input.runContext,
          patch: {
            createNodes: [finalNode],
          },
        });
      }
      appliedStats = applied.stats;
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

  const responseFlow = PublicFlowGraphSchema.parse(
    sanitizeFlowDataForStorage(mapFlowRowToDto(updatedRow).data ?? {}),
  );
  const response = PublicFlowPatchResponseSchema.parse({
    ok: true,
    flowId: updatedRow.id,
    updatedAt: updatedRow.updated_at,
    stats: appliedStats ?? {
      createdNodes: didUpsert ? 0 : 1,
      createdEdges: 0,
      deletedNodes: 0,
      deletedEdges: 0,
      patchedNodes: didUpsert ? 1 : 0,
      appendedArrays: 0,
    },
    data: responseFlow,
  });

  return {
    ok: true,
    flowId: response.flowId,
    updatedAt: response.updatedAt,
    stats: response.stats,
    nodeId,
    status: canvasStatus,
    pending: canvasStatus !== "success",
    videoUrl: canvasStatus === "success" ? extracted.videoUrl : null,
    thumbnailUrl: canvasStatus === "success" ? extracted.thumbnailUrl : null,
    vendor: createdVendor,
    taskId,
    debug,
  };
}
