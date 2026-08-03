import { z } from "zod";
import { loadImageViewControlsModule } from "../../platform/node/shared-schema-loader";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { readSelectedWebHeroStyleReference as readCanonicalSelectedWebHeroStyleReference } from "../flow/flow.webhero-style-reference";
import {
  PublicFlowCreateEdgeSchema,
  PublicFlowCreateGroupNodeSchema,
  PublicFlowCreateTaskNodeSchema,
  PublicFlowGraphSchema,
  PublicFlowPatchResponseSchema,
} from "../flow/flow.public.schemas";
import { applyPublicFlowGraphPatch } from "../flow/flow.public.service";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import {
  mapFlowRowToDto,
  type FlowRow,
} from "../flow/flow.repo";
import { optimisticCanvasWrite } from "../flow/flow.optimistic-write";
import { runPublicTask } from "../apiKey/apiKey.routes";
import {
  resolveCanvasTaskModel,
} from "./agents-tool-bridge.resolve-model";
import {
  AgentImageGenerateToCanvasArgsSchema,
  buildDirectImageGenerateToCanvasArgs,
} from "./agents-tool-bridge.agent-media-schemas";
import {
  buildImageFailureMessage,
  extractImageAssetFromTaskResult,
  resolveImageTaskIdFromResult,
} from "./agents-tool-bridge.image-result";
import type { TaskRequestDto } from "./task.schemas";
import { validateWebPageAssetTransparency } from "./webpage-asset-transparency";
import {
  appendGreenScreenBackgroundPrompt,
  imageNodeRequestsTransparentPng,
  prepareGeneratedImageAssetForCanvas,
} from "./generated-image-postprocess";
import { resolveLatestMediaReferences } from "./agents-tool-bridge.media-reference-resolver";

const APIMART_GPT_IMAGE_2_SIZE_VALUES = new Set([
  "auto",
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "5:4",
  "4:5",
  "16:9",
  "9:16",
  "2:1",
  "1:2",
  "21:9",
  "9:21",
]);
const APIMART_GPT_IMAGE_2_RESOLUTION_VALUES = new Set(["1k", "2k", "4k"]);
const { appendImageViewPrompt } = loadImageViewControlsModule();

const GATEWAY_RESOLUTION_LONG_EDGE: Record<string, number> = {
  "1k": 1024,
  "2k": 2048,
  "4k": 4096,
};

const GATEWAY_ASPECT_RATIOS: Record<string, [number, number]> = {
  "1:1": [1, 1],
  "3:2": [3, 2],
  "2:3": [2, 3],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "5:4": [5, 4],
  "4:5": [4, 5],
  "16:9": [16, 9],
  "9:16": [9, 16],
  "2:1": [2, 1],
  "1:2": [1, 2],
  "21:9": [21, 9],
  "9:21": [9, 21],
};

const GATEWAY_DEFAULT_RESOLUTION = "2k";
const WEBHERO_DEFAULT_IMAGE_RESOLUTION = "1k";
const GATEWAY_DEFAULT_PIXEL_SIZE = "2048x2048";

const GATEWAY_MIN_PIXEL_BUDGET = 1_000_000;

function assertGatewayPixelBudget(pixelSize: string): string {
  const parts = pixelSize.split("x");
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new AppError(
      `Gateway gpt-image-2 不接受 ${pixelSize}（无法解析为正整数像素尺寸）。请提供形如 "2048x1152" 的 WIDTHxHEIGHT。`,
      {
        status: 400,
        code: "agents_tool_gateway_pixel_size_invalid",
        details: { pixelSize },
      },
    );
  }
  const totalPixels = width * height;
  if (totalPixels < GATEWAY_MIN_PIXEL_BUDGET) {
    throw new AppError(
      `Gateway gpt-image-2 不接受 ${pixelSize}（${totalPixels} 像素低于最小预算 ${GATEWAY_MIN_PIXEL_BUDGET}）。请将 resolution 升至 2K/4K，或改用 1:1 等正方形 aspectRatio。`,
      {
        status: 400,
        code: "agents_tool_gateway_pixel_size_below_min_budget",
        details: { pixelSize, totalPixels, minPixelBudget: GATEWAY_MIN_PIXEL_BUDGET },
      },
    );
  }
  return pixelSize;
}

function roundToMultipleOf16(value: number): number {
  const r = Math.round(value / 16) * 16;
  return r > 0 ? r : 16;
}

export function resolveGatewayPixelSize(aspect: string, resolution: string): string {
  const aspectKey = (aspect || "").trim().toLowerCase();
  const resolutionKey = (resolution || "").trim().toLowerCase();
  if (/^\d+x\d+$/i.test(aspectKey)) return assertGatewayPixelBudget(aspectKey);
  const ratio = GATEWAY_ASPECT_RATIOS[aspectKey];
  if (!ratio) return GATEWAY_DEFAULT_PIXEL_SIZE;
  const longEdge = GATEWAY_RESOLUTION_LONG_EDGE[resolutionKey] ?? GATEWAY_RESOLUTION_LONG_EDGE[GATEWAY_DEFAULT_RESOLUTION];
  const [w, h] = ratio;
  if (w >= h) {
    const width = longEdge;
    const height = roundToMultipleOf16((longEdge * h) / w);
    return assertGatewayPixelBudget(`${width}x${height}`);
  }
  const height = longEdge;
  const width = roundToMultipleOf16((longEdge * w) / h);
  return assertGatewayPixelBudget(`${width}x${height}`);
}

type ModelSelectionDebugInfo = {
  slot: "image";
  vendorKey: string;
  modelKey: string;
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

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readWebHeroNodeById(row: FlowRow, webHeroNodeId: string): FlowNodeRecord | null {
  if (!webHeroNodeId) return null;
  const dto = mapFlowRowToDto(row);
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
  const webHeroNode = findFlowNodeById(currentNodes, webHeroNodeId);
  return isWebHeroNode(webHeroNode) ? webHeroNode : null;
}

function collectUrlsFromUnknown(value: unknown): string[] {
	const urls: string[] = [];
	const seen = new Set<string>();
	const visit = (candidate: unknown): void => {
		if (typeof candidate === "string") {
			const trimmed = candidate.trim();
			if (/^https?:\/\//i.test(trimmed) && !seen.has(trimmed)) {
				seen.add(trimmed);
				urls.push(trimmed);
			}
			return;
		}
		if (!candidate || typeof candidate !== "object") return;
		if (Array.isArray(candidate)) {
			candidate.forEach(visit);
			return;
		}
		const record = candidate as Record<string, unknown>;
		visit(record.imageUrl);
		visit(record.thumbnailUrl);
		visit(record.url);
		visit(record.src);
		visit(record.href);
	};
	visit(value);
	return urls;
}

function buildWebHeroStyleReferenceInputs(row: FlowRow, webPreviewForNodeId: string): {
  referenceImages: string[];
  assetInputs: CanvasAssetInput[];
} {
  if (!webPreviewForNodeId) return { referenceImages: [], assetInputs: [] };
  const webHeroNode = readWebHeroNodeById(row, webPreviewForNodeId);
  if (!webHeroNode) return { referenceImages: [], assetInputs: [] };
  const webHeroData = readNodeData(webHeroNode);
	const selectedStyleReference = readCanonicalSelectedWebHeroStyleReference(webHeroData);
	if (!selectedStyleReference) return { referenceImages: [], assetInputs: [] };
	const selectedRecord = selectedStyleReference.record;
  const referenceImages = selectedStyleReference.referenceUrls;
  if (!referenceImages.length) return { referenceImages: [], assetInputs: [] };
  const title =
    readTrimmedString(selectedRecord.title) ||
    readTrimmedString(selectedRecord.displayValue) ||
    "Selected WebHero style reference";
  const note =
    "Selected visual style reference for the whole WebHero preview set; keep typography, palette, composition density, material treatment, and section rhythm consistent across every generated section screenshot.";
  return {
    referenceImages: Array.from(new Set(referenceImages)),
    assetInputs: Array.from(new Set(referenceImages)).map((url) => ({
      url,
      role: "style",
      note,
      ...(title ? { name: title } : {}),
    })),
  };
}

function isLocalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.startsWith("127.") ||
      host === "::1" ||
      host.startsWith("10.") ||
      host.startsWith("169.254.") ||
      host.startsWith("0.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80:")
    );
  } catch {
    return false;
  }
}

function buildModelInputUrlLookup(row: FlowRow): Map<string, string> {
  const dto = mapFlowRowToDto(row);
  const current = sanitizeFlowDataForStorage(dto.data ?? {});
  const currentParsed = PublicFlowGraphSchema.safeParse(current);
  if (!currentParsed.success) return new Map();
  const out = new Map<string, string>();
  const currentNodes = Array.isArray(currentParsed.data.nodes) ? currentParsed.data.nodes : [];
  for (const node of currentNodes) {
    const data = readRecord((node as Record<string, unknown>)?.data);
    if (!data) continue;
    const displayUrls = [
      data.imageUrl,
      data.thumbnailUrl,
      data.url,
    ].flatMap(collectUrlsFromUnknown);
    const modelUrl =
      readTrimmedString(data.modelInputImageUrl) ||
      readTrimmedString(data.sourceImageUrl) ||
      readTrimmedString(data.sourceUrl) ||
      readTrimmedString(data.originalImageUrl) ||
      readTrimmedString(data.vendorReferenceImageUrl);
    if (!modelUrl || isLocalHttpUrl(modelUrl)) continue;
    for (const displayUrl of displayUrls) {
      if (displayUrl && displayUrl !== modelUrl) out.set(displayUrl, modelUrl);
    }
  }
  return out;
}

function canonicalizeModelReferenceUrl(url: string, lookup: Map<string, string>): string {
  const trimmed = readTrimmedString(url);
  if (!trimmed) return "";
  if (!isLocalHttpUrl(trimmed)) return trimmed;
  return lookup.get(trimmed) || "";
}

function canonicalizeReferenceImagesForModel(urls: string[], lookup: Map<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const canonical = canonicalizeModelReferenceUrl(url, lookup);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

function canonicalizeAssetInputsForModel(
  assetInputs: CanvasAssetInput[],
  lookup: Map<string, string>,
): CanvasAssetInput[] {
  const out: CanvasAssetInput[] = [];
  for (const item of assetInputs) {
    const rawUrl = readTrimmedString(item.url);
    if (!rawUrl) {
      out.push(item);
      continue;
    }
    const canonical = canonicalizeModelReferenceUrl(rawUrl, lookup);
    if (!canonical) continue;
    out.push({ ...item, url: canonical });
  }
  return out;
}

function normalizePositiveInteger(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.max(1, Math.trunc(numeric));
}

function includesAnyToken(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

function inferTransparentWebPageAsset(nodeData: Record<string, unknown>, requirementRecord: Record<string, unknown>): boolean {
  if (nodeData.transparentPng === false || requirementRecord.transparentPng === false || requirementRecord.requireTransparent === false) {
    return false;
  }
  const text = [
    nodeData.webPageAssetId,
    nodeData.webPageAssetSlotId,
    nodeData.webPageAssetRole,
    nodeData.webPageAssetCategory,
    nodeData.webPageAssetPlacement,
    nodeData.label,
    nodeData.prompt,
    requirementRecord.assetId,
    requirementRecord.slotId,
    requirementRecord.subjectId,
    requirementRecord.subjectType,
    requirementRecord.role,
    requirementRecord.category,
    requirementRecord.type,
    requirementRecord.description,
    requirementRecord.reason,
    requirementRecord.placement,
  ].map(readTrimmedString).join(" ").toLowerCase();

  if (includesAnyToken(text, [
    "transparent png",
    "transparent background",
    "alpha",
    "cutout",
    "isolated product",
    "isolated foreground",
  ])) {
    return true;
  }

  return false;
}

function isExplicitOpaqueWebPageAsset(nodeData: Record<string, unknown>, requirementRecord: Record<string, unknown>): boolean {
  if (nodeData.transparentPng === false || requirementRecord.transparentPng === false || requirementRecord.requireTransparent === false) {
    return true;
  }
  const usage = readRecord(requirementRecord.intendedWebUsage);
  const text = [
    usage.backgroundTreatment,
    usage.layering,
    usage.interactionWithTypography,
    nodeData.prompt,
    nodeData.negativePrompt,
  ].map(readTrimmedString).join(" ").toLowerCase();
  return (
    text.includes("match the approved webpage section background") ||
    text.includes("section media layer") ||
    text.includes("embedded webpage image") ||
    text.includes("clean dark/neutral background") ||
    text.includes("no transparent") ||
    text.includes("not transparent")
  );
}

function normalizeApimartImageSize(value: unknown): string {
  const raw = readTrimmedString(value);
  if (!raw) return "";
  const normalized = raw.toLowerCase();
  return APIMART_GPT_IMAGE_2_SIZE_VALUES.has(normalized) ? normalized : raw;
}

function normalizeApimartImageResolution(value: unknown): string {
  const raw = readTrimmedString(value);
  if (!raw) return "";
  const normalized = raw.toLowerCase();
  return APIMART_GPT_IMAGE_2_RESOLUTION_VALUES.has(normalized) ? normalized : raw;
}

function defaultImageResolutionFromModelOptions(options: unknown): string {
  const record = readRecord(options);
  const candidates = [
    record.defaultImageSize,
    record.defaultResolution,
    record.defaultResolutionType,
    record.default_image_size,
    record.default_resolution,
    record.default_resolution_type,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeApimartImageResolution(candidate);
    if (normalized) return normalized;
  }
  return "";
}

function defaultWebHeroImageResolution(input: {
  resolvedVendor: string;
  modelOptions: unknown;
}): string {
  const configured = defaultImageResolutionFromModelOptions(input.modelOptions);
  if (configured) return configured;
  if (input.resolvedVendor === "gateway") return GATEWAY_DEFAULT_RESOLUTION;
  return WEBHERO_DEFAULT_IMAGE_RESOLUTION;
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

const ImageCanvasNodeKindSchema = z.enum(["image", "imageEdit"]);
type ImageCanvasNodeKind = z.infer<typeof ImageCanvasNodeKindSchema>;
type ImageCanvasToolStatus = "queued" | "running" | "success";
type FlowNodeRecord = Record<string, unknown>;
type PublicFlowCreateTaskNode = z.infer<typeof PublicFlowCreateTaskNodeSchema>;
type PublicFlowCreateGroupNode = z.infer<typeof PublicFlowCreateGroupNodeSchema>;
type PublicFlowCreateEdge = z.infer<typeof PublicFlowCreateEdgeSchema>;
type PublicFlowCreateNode = PublicFlowCreateTaskNode | PublicFlowCreateGroupNode;

const WEB_PAGE_ASSET_GROUP_WIDTH = 420;
const WEB_PAGE_ASSET_GROUP_HEIGHT = 260;
const WEB_PAGE_ASSET_GROUP_OFFSET_X = 520;
const WEB_PAGE_ASSET_GROUP_OFFSET_Y = 360;
const WEB_PAGE_GROUP_VERTICAL_GAP = 120;
const WEB_PAGE_ASSET_SOURCE_HANDLE = "out-image";
const WEB_PAGE_ASSET_TARGET_HANDLE = "in-any";
const WEB_PAGE_ASSET_EDGE_TYPE = "typed";
const WEB_PAGE_PREVIEW_GROUP_WIDTH = 780;
const WEB_PAGE_PREVIEW_GROUP_HEIGHT = 520;
const WEB_PAGE_PREVIEW_GROUP_OFFSET_X = 520;
const WEB_PAGE_PREVIEW_GROUP_OFFSET_Y = -120;
const WEB_PAGE_PREVIEW_NODE_WIDTH = 700;
const WEB_PAGE_PREVIEW_NODE_HEIGHT = 394;
const WEB_PAGE_PREVIEW_ASPECT_RATIO = "16:9";
const WEB_PAGE_ASSET_GENERATED_SOURCE = "generated";

const PPT_DECK_IMAGE_GROUP_WIDTH = 760;
const PPT_DECK_IMAGE_GROUP_HEIGHT = 540;
// Group sits to the LEFT of the pptDeck node (asset group on the left,
// pptDeck preview on the right). The client-side layout normalizer
// (normalizePptDeckTopLevelLayout) is the source of truth at runtime; this
// initial offset just keeps the first-frame placement consistent so the
// canvas does not flash with an inverted layout.
const PPT_DECK_IMAGE_GROUP_OFFSET_X = -(PPT_DECK_IMAGE_GROUP_WIDTH + 120);
const PPT_DECK_IMAGE_GROUP_OFFSET_Y = 0;
const PPT_DECK_IMAGE_NODE_WIDTH = 360;
const PPT_DECK_IMAGE_NODE_HEIGHT = 220;
const PPT_DECK_IMAGE_EDGE_SOURCE_HANDLE = "out-image";
const PPT_DECK_IMAGE_EDGE_TARGET_HANDLE = "in-any";
const PPT_DECK_IMAGE_EDGE_TYPE = "typed";

function normalizeImageCanvasToolStatus(
  result: { status: string },
  vendor: string,
): ImageCanvasToolStatus {
  if (result.status === "queued" || result.status === "running") return result.status;
  if (result.status === "succeeded") return "success";
  throw new AppError("图片生成失败", {
    status: 502,
    code: "agents_tool_image_generate_failed",
    details: {
      vendor: vendor || null,
      status: result.status,
      message: buildImageFailureMessage(result) || null,
    },
  });
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readNodeId(node: FlowNodeRecord | null | undefined): string {
  return readTrimmedString(node?.id);
}

function readNodeType(node: FlowNodeRecord | null | undefined): string {
  return readTrimmedString(node?.type);
}

function readNodeData(node: FlowNodeRecord | null | undefined): Record<string, unknown> {
  return readRecord(node?.data);
}

function readNodePosition(node: FlowNodeRecord | null | undefined): { x: number; y: number } {
  const position = readRecord(node?.position);
  const x = typeof position.x === "number" && Number.isFinite(position.x) ? position.x : 0;
  const y = typeof position.y === "number" && Number.isFinite(position.y) ? position.y : 0;
  return { x, y };
}

function readNodeHeight(node: FlowNodeRecord | null | undefined, fallback: number): number {
  const style = readRecord(node?.style);
  const data = readNodeData(node);
  for (const value of [node?.height, style.height, data.nodeHeight]) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return fallback;
}

function findFlowNodeById(nodes: unknown[], nodeId: string): FlowNodeRecord | null {
  for (const node of nodes) {
    const record = readRecord(node);
    if (readNodeId(record) === nodeId) return record;
  }
  return null;
}

export function assertImageCanvasOutputTargetCompatible(input: {
  nodes: unknown[];
  nodeId: string;
  incomingKind: ImageCanvasNodeKind;
}): FlowNodeRecord | null {
  const existingNode = findFlowNodeById(input.nodes, input.nodeId);
  if (!existingNode) return null;

  const existingType = readNodeType(existingNode);
  if (existingType !== "taskNode") {
    throw new AppError(
      `canvas_image_generate_to_canvas: node ${input.nodeId} exists but is not a taskNode; choose a new stable outputKey before generating`,
      {
        status: 409,
        code: "agents_tool_node_id_kind_mismatch",
        details: { nodeId: input.nodeId, existingType },
      },
    );
  }

  const existingKind = readTrimmedString(readNodeData(existingNode).kind);
  if (existingKind && existingKind !== input.incomingKind) {
    throw new AppError(
      `canvas_image_generate_to_canvas: node ${input.nodeId} exists with data.kind="${existingKind}" but request kind="${input.incomingKind}"; when references make this an imageEdit, keep the existing node as a reference and choose a new stable outputKey`,
      {
        status: 409,
        code: "agents_tool_node_id_kind_mismatch",
        details: { nodeId: input.nodeId, existingKind, incomingKind: input.incomingKind },
      },
    );
  }
  return existingNode;
}

function isWebHeroNode(node: FlowNodeRecord | null | undefined): node is FlowNodeRecord {
  return readNodeType(node) === "taskNode" && readTrimmedString(readNodeData(node).kind) === "webHero";
}

function findWebPageAssetGroup(nodes: unknown[], webHeroNodeId: string): FlowNodeRecord | null {
  for (const node of nodes) {
    const record = readRecord(node);
    if (!record || readNodeType(record) !== "groupNode") continue;
    const data = readNodeData(record);
    if (readTrimmedString(data.webPageAssetGroupForNodeId) === webHeroNodeId) return record;
  }
  return null;
}

function findWebPagePreviewGroup(nodes: unknown[], webHeroNodeId: string): FlowNodeRecord | null {
  for (const node of nodes) {
    const record = readRecord(node);
    if (!record || readNodeType(record) !== "groupNode") continue;
    const data = readNodeData(record);
    if (readTrimmedString(data.webPagePreviewGroupForNodeId) === webHeroNodeId) return record;
  }
  return null;
}

function buildWebPageAssetGroupNode(
  webHeroNode: FlowNodeRecord,
  previewGroup?: FlowNodeRecord | null,
): z.infer<typeof PublicFlowCreateGroupNodeSchema> {
  const webHeroPosition = readNodePosition(webHeroNode);
  const defaultPosition = {
    x: webHeroPosition.x + WEB_PAGE_ASSET_GROUP_OFFSET_X,
    y: webHeroPosition.y + WEB_PAGE_ASSET_GROUP_OFFSET_Y,
  };
  const previewPosition = previewGroup ? readNodePosition(previewGroup) : null;
  return {
    id: `web-assets-${readNodeId(webHeroNode)}`,
    type: "groupNode",
    position: previewPosition
      ? {
          x: previewPosition.x,
          y: Math.max(
            defaultPosition.y,
            previewPosition.y
              + readNodeHeight(previewGroup, WEB_PAGE_PREVIEW_GROUP_HEIGHT)
              + WEB_PAGE_GROUP_VERTICAL_GAP,
          ),
        }
      : defaultPosition,
    data: {
      label: "网页素材资产",
      isGroup: true,
      groupKind: "webPageAssets",
      webPageAssetGroupForNodeId: readNodeId(webHeroNode),
      nodeWidth: WEB_PAGE_ASSET_GROUP_WIDTH,
      nodeHeight: WEB_PAGE_ASSET_GROUP_HEIGHT,
    },
    style: {
      width: WEB_PAGE_ASSET_GROUP_WIDTH,
      height: WEB_PAGE_ASSET_GROUP_HEIGHT,
    },
    selected: false,
  };
}

function isPptDeckNode(node: FlowNodeRecord | null | undefined): node is FlowNodeRecord {
  return readNodeType(node) === "taskNode" && readTrimmedString(readNodeData(node).kind) === "pptDeck";
}

function findPptDeckImageGroup(nodes: unknown[], pptDeckNodeId: string): FlowNodeRecord | null {
  for (const node of nodes) {
    const record = readRecord(node);
    if (!record || readNodeType(record) !== "groupNode") continue;
    const data = readNodeData(record);
    if (readTrimmedString(data.pptDeckImageGroupForNodeId) === pptDeckNodeId) return record;
  }
  return null;
}

function buildPptDeckImageGroupNode(pptDeckNode: FlowNodeRecord): z.infer<typeof PublicFlowCreateGroupNodeSchema> {
  const pptDeckPosition = readNodePosition(pptDeckNode);
  return {
    id: `ppt-images-${readNodeId(pptDeckNode)}`,
    type: "groupNode",
    position: {
      x: pptDeckPosition.x + PPT_DECK_IMAGE_GROUP_OFFSET_X,
      y: pptDeckPosition.y + PPT_DECK_IMAGE_GROUP_OFFSET_Y,
    },
    data: {
      label: "PPT 配图素材",
      isGroup: true,
      groupKind: "pptDeckImages",
      pptDeckImageGroupForNodeId: readNodeId(pptDeckNode),
      nodeWidth: PPT_DECK_IMAGE_GROUP_WIDTH,
      nodeHeight: PPT_DECK_IMAGE_GROUP_HEIGHT,
    },
    style: {
      width: PPT_DECK_IMAGE_GROUP_WIDTH,
      height: PPT_DECK_IMAGE_GROUP_HEIGHT,
    },
    selected: false,
  };
}

function buildPptDeckImageEdge(sourceNodeId: string, targetNodeId: string): z.infer<typeof PublicFlowCreateEdgeSchema> {
  return {
    id: `ppt-deck-image-edge-${sourceNodeId}-${targetNodeId}`,
    source: sourceNodeId,
    target: targetNodeId,
    sourceHandle: PPT_DECK_IMAGE_EDGE_SOURCE_HANDLE,
    targetHandle: PPT_DECK_IMAGE_EDGE_TARGET_HANDLE,
    type: PPT_DECK_IMAGE_EDGE_TYPE,
    animated: false,
  };
}

function buildWebPagePreviewGroupNode(webHeroNode: FlowNodeRecord): z.infer<typeof PublicFlowCreateGroupNodeSchema> {
  const webHeroPosition = readNodePosition(webHeroNode);
  return {
    id: `web-previews-${readNodeId(webHeroNode)}`,
    type: "groupNode",
    position: {
      x: webHeroPosition.x + WEB_PAGE_PREVIEW_GROUP_OFFSET_X,
      y: webHeroPosition.y + WEB_PAGE_PREVIEW_GROUP_OFFSET_Y,
    },
    data: {
      label: "网页预览可视化图",
      isGroup: true,
      groupKind: "webPagePreviews",
      webPagePreviewGroupForNodeId: readNodeId(webHeroNode),
      nodeWidth: WEB_PAGE_PREVIEW_GROUP_WIDTH,
      nodeHeight: WEB_PAGE_PREVIEW_GROUP_HEIGHT,
    },
    style: {
      width: WEB_PAGE_PREVIEW_GROUP_WIDTH,
      height: WEB_PAGE_PREVIEW_GROUP_HEIGHT,
    },
    selected: false,
  };
}

function buildWebPageAssetEdge(sourceNodeId: string, targetNodeId: string): z.infer<typeof PublicFlowCreateEdgeSchema> {
  return {
    id: `web-asset-edge-${sourceNodeId}-${targetNodeId}`,
    source: sourceNodeId,
    target: targetNodeId,
    sourceHandle: WEB_PAGE_ASSET_SOURCE_HANDLE,
    targetHandle: WEB_PAGE_ASSET_TARGET_HANDLE,
    type: WEB_PAGE_ASSET_EDGE_TYPE,
    animated: false,
  };
}

function normalizeWebPageAssetMetadata(nodeData: Record<string, unknown>): Record<string, unknown> {
  const webPageAssetForNodeId = readTrimmedString(nodeData.webPageAssetForNodeId);
  if (!webPageAssetForNodeId) return {};

  const assetId = readTrimmedString(nodeData.webPageAssetId);
  const slotId = readTrimmedString(nodeData.webPageAssetSlotId) || assetId;
  const source = readTrimmedString(nodeData.webPageAssetSource) || WEB_PAGE_ASSET_GENERATED_SOURCE;
  const role = readTrimmedString(nodeData.webPageAssetRole);
  const placement = readTrimmedString(nodeData.webPageAssetPlacement);
  const requirementRecord = readRecord(nodeData.webPageAssetRequirement);
  const prompt = readTrimmedString(nodeData.prompt);
  const promptText = [
    prompt,
    placement,
    readTrimmedString(nodeData.webPageAssetCategory),
    readTrimmedString(requirementRecord.description),
    readTrimmedString(requirementRecord.reason),
  ].join(" ").toLowerCase();
  const explicitOpaque = isExplicitOpaqueWebPageAsset(nodeData, requirementRecord);
  const transparentPng = !explicitOpaque && (
    nodeData.transparentPng === true ||
    requirementRecord.transparentPng === true ||
    requirementRecord.requireTransparent === true ||
    inferTransparentWebPageAsset(nodeData, requirementRecord) ||
    promptText.includes("transparent png") ||
    promptText.includes("transparent background") ||
    promptText.includes("alpha") ||
    promptText.includes("cutout") ||
    promptText.includes("isolated product")
  );
  const requirementUsage = readRecord(requirementRecord.intendedWebUsage);
  const nodeUsage = readRecord(nodeData.intendedWebUsage);
  const opaqueIntendedWebUsage = {
    placement: placement || readTrimmedString(requirementRecord.placement) || "webpage image asset",
    backgroundTreatment: "match the approved webpage section background",
    cropAndSafeArea: "keep the subject fully usable in responsive HTML layouts with enough breathing room",
    layering: "section media layer",
    interactionWithTypography: "avoid baked-in text and keep page typography separate",
    responsiveBehavior: "scale and crop predictably on desktop and mobile without important subject loss",
    visualContinuity: "match the approved preview section lighting, palette, material, and brand mood",
  };
  const baseIntendedWebUsage =
    explicitOpaque
      ? { ...requirementUsage, ...opaqueIntendedWebUsage }
      : Object.keys(requirementUsage).length > 0
      ? requirementUsage
      : Object.keys(nodeUsage).length > 0
        ? nodeUsage
        : {
            placement: placement || readTrimmedString(requirementRecord.placement) || "webpage image asset",
            backgroundTreatment: transparentPng ? "transparent alpha" : "match the approved webpage section background",
            cropAndSafeArea: "keep the subject fully usable in responsive HTML layouts with enough breathing room",
            layering: transparentPng ? "foreground overlay that can sit above gradients, UI, or typography" : "section media layer",
            interactionWithTypography: transparentPng
              ? "clean alpha edges so nearby typography remains readable"
              : "avoid baked-in text and keep page typography separate",
            responsiveBehavior: "scale and crop predictably on desktop and mobile without important subject loss",
            visualContinuity: "match the approved preview section lighting, palette, material, and brand mood",
          };
  const requirement =
    Object.keys(requirementRecord).length > 0
      ? {
          ...(assetId ? { assetId } : {}),
          ...(slotId ? { slotId } : {}),
          implementation: "generate",
          source,
          renderMode: "image_asset",
          ...(role ? { role } : {}),
          ...(placement ? { placement } : {}),
          ...requirementRecord,
          intendedWebUsage: baseIntendedWebUsage,
        }
      : {
          ...(assetId ? { assetId } : {}),
          ...(slotId ? { slotId } : {}),
          implementation: "generate",
          source,
          renderMode: "image_asset",
          ...(role ? { role } : {}),
          ...(placement ? { placement } : {}),
          description: prompt.slice(0, 360),
          intendedWebUsage: baseIntendedWebUsage,
        };

  return {
    ...(slotId ? { webPageAssetSlotId: slotId } : {}),
    ...(placement ? { webPageAssetPlacement: placement } : {}),
    transparentPng,
    webPageAssetSource: source,
    webPageAssetRequirement: requirement,
  };
}

function buildWebPageAssetUsagePromptSuffix(nodeData: Record<string, unknown>): string {
  const requirement = readRecord(nodeData.webPageAssetRequirement);
  const requirementUsage = readRecord(requirement.intendedWebUsage);
  const nodeUsage = readRecord(nodeData.intendedWebUsage);
  const intendedWebUsage = Object.keys(requirementUsage).length > 0 ? requirementUsage : nodeUsage;
  if (!readTrimmedString(nodeData.webPageAssetForNodeId)) return "";

  const placement =
    readTrimmedString(nodeData.webPageAssetPlacement) ||
    readTrimmedString(requirement.placement) ||
    readTrimmedString(intendedWebUsage.placement);
  const backgroundTreatment = readTrimmedString(intendedWebUsage.backgroundTreatment);
  const cropAndSafeArea = readTrimmedString(intendedWebUsage.cropAndSafeArea);
  const layering = readTrimmedString(intendedWebUsage.layering);
  const interactionWithTypography = readTrimmedString(intendedWebUsage.interactionWithTypography);
  const responsiveBehavior = readTrimmedString(intendedWebUsage.responsiveBehavior);
  const visualContinuity = readTrimmedString(intendedWebUsage.visualContinuity);
  const surfaceTreatment = readTrimmedString(intendedWebUsage.surfaceTreatment);
  const cardPolicy = readTrimmedString(intendedWebUsage.cardPolicy);
  const containerTreatment = readTrimmedString(intendedWebUsage.containerTreatment);
  const combinedSurfacePolicy = [
    surfaceTreatment,
    cardPolicy,
    containerTreatment,
    backgroundTreatment,
    layering,
  ].join(" ").toLowerCase();
  const previewRequiresCard =
    combinedSurfacePolicy.includes("carded_panel") ||
    combinedSurfacePolicy.includes("preview_card") ||
    combinedSurfacePolicy.includes("visible card") ||
    combinedSurfacePolicy.includes("visible panel") ||
    combinedSurfacePolicy.includes("visible frame") ||
    combinedSurfacePolicy.includes("framed_media") ||
    combinedSurfacePolicy.includes("shadowed_tile") ||
    combinedSurfacePolicy.includes("glass_panel");
  const transparentPng = nodeData.transparentPng === true ||
    requirement.transparentPng === true ||
    requirement.requireTransparent === true ||
    (!isExplicitOpaqueWebPageAsset(nodeData, requirement) && (
    backgroundTreatment.toLowerCase().includes("transparent") ||
    interactionWithTypography.toLowerCase().includes("transparent")
    ));

  return [
    "",
    "Webpage asset usage contract:",
    "Generate this as a reusable website asset for the stated section placement, not as a finished webpage screenshot and not as a generic rounded card.",
    placement ? `Placement: ${placement}.` : "",
    backgroundTreatment ? `Background treatment: ${backgroundTreatment}.` : "",
    surfaceTreatment ? `Surface treatment: ${surfaceTreatment}.` : "",
    cardPolicy ? `Card policy: ${cardPolicy}.` : "",
    containerTreatment ? `Container treatment: ${containerTreatment}.` : "",
    cropAndSafeArea ? `Crop and safe area: ${cropAndSafeArea}.` : "",
    layering ? `Layering: ${layering}.` : "",
    interactionWithTypography ? `Interaction with typography: ${interactionWithTypography}.` : "",
    responsiveBehavior ? `Responsive behavior: ${responsiveBehavior}.` : "",
    visualContinuity ? `Visual continuity: ${visualContinuity}.` : "",
    previewRequiresCard
      ? "Container rule: include the preview-visible card/panel/frame treatment only to the same degree shown in the approved preview; match its radius, border, shadow, and material instead of inventing a generic image card."
      : "Container rule: do not add a rounded rectangle, square card, border, drop shadow, glass tile, white box, or framed image container. Generate the subject/media directly as the specified cutout, background-matched media, masked media, or full-bleed media.",
    transparentPng
      ? "Use a real transparent PNG-style cutout with clean alpha edges. No rectangular background plate, no card frame, no white box, no text, no watermark."
      : "Match the intended webpage background and edge blending. Do not add browser chrome, card framing, text, logos, or watermarks unless explicitly required.",
  ].filter(Boolean).join("\n");
}

function assertWebHeroPreviewStyleReferenceSelected(input: {
  row: FlowRow;
  webPreviewForNodeId: string;
	outputNodeId: string;
}): void {
  if (!input.webPreviewForNodeId) return;
  const dto = mapFlowRowToDto(input.row);
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
  const webHeroNode = findFlowNodeById(currentNodes, input.webPreviewForNodeId);
  if (!isWebHeroNode(webHeroNode)) {
    throw new AppError("webPreviewForNodeId must point to an existing webHero node", {
      status: 400,
      code: "web_page_preview_target_not_found",
      details: {
        nodeId: input.webPreviewForNodeId,
      },
    });
  }
  const targetWebHeroData = readNodeData(webHeroNode);
	const workflow = readRecord(targetWebHeroData.webPageWorkflowContract);
	const approvedPreviewNodeIds = Array.isArray(workflow.approvedPreviewNodes)
		? workflow.approvedPreviewNodes.map(readTrimmedString).filter(Boolean)
		: [];
	if (input.outputNodeId && approvedPreviewNodeIds.includes(input.outputNodeId)) {
		throw new AppError("An approved WebHero preview cannot be regenerated in place", {
			status: 409,
			code: "webhero_approved_preview_immutable",
			details: {
				nodeId: input.webPreviewForNodeId,
				previewNodeId: input.outputNodeId,
				requiredNextStep: "Apply an explicit approvedPreviewNodes transition with webHeroResetDownstreamEvidence=true before regenerating this preview node.",
			},
		});
	}
	const selectedStyleReference = readCanonicalSelectedWebHeroStyleReference(targetWebHeroData);
	const executableStyleReference = buildWebHeroStyleReferenceInputs(input.row, input.webPreviewForNodeId);
  if (!selectedStyleReference || executableStyleReference.referenceImages.length < 1) {
    throw new AppError("WebHero preview generation requires selected style reference", {
      status: 409,
      code: "webhero_style_reference_selection_required",
      details: {
        nodeId: input.webPreviewForNodeId,
        nextAction: "create_or_show_style_reference_candidates_and_ask_user",
        requirement:
		  "Persist a canonical webPageWorkflowContract.selectedStyleReference object with an executable HTTP(S) image URL before calling canvas_image_generate_to_canvas with webPreviewForNodeId.",
      },
    });
  }
}

export const PublicAgentsImageGenerateToCanvasArgsSchema =
  AgentImageGenerateToCanvasArgsSchema;

export type PublicAgentsImageGenerateToCanvasArgs = z.infer<
  typeof PublicAgentsImageGenerateToCanvasArgsSchema
>;

export type PublicAgentsImageGenerateToCanvasResult = {
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
  status: ImageCanvasToolStatus;
  pending: boolean;
  imageUrl: string | null;
  vendor: string;
  taskId: string | null;
  assetId: string | null;
  label: string;
  shotNo?: number;
  debug: {
    modelSelection: ModelSelectionDebugInfo;
  };
};


export async function generateImageToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  row: FlowRow;
  bodyArgs: unknown;
  runContext?: MediaAgentRunContext;
}): Promise<PublicAgentsImageGenerateToCanvasResult> {
  const parsedArgs = PublicAgentsImageGenerateToCanvasArgsSchema.safeParse(input.bodyArgs);
  if (!parsedArgs.success) {
    throw new AppError("Invalid image generate to canvas request", {
      status: 400,
      code: "invalid_image_generate_to_canvas_request",
      details: { issues: parsedArgs.error.issues },
    });
  }

  const taskNode = buildDirectImageGenerateToCanvasArgs(parsedArgs.data).node;
  const nodeData = taskNode.data as Record<string, unknown>;
  const promptMetadata = normalizeWebPageAssetMetadata(nodeData);
  const promptNodeData = {
    ...nodeData,
    ...promptMetadata,
  };
  const requestedPrompt = readTrimmedString(promptNodeData.prompt);
  const imageViewPrompt = appendImageViewPrompt(requestedPrompt, {
    cameraControl: promptNodeData.imageCameraControl,
    lightingRig: promptNodeData.imageLightingRig,
  });
  const webPageAssetUsagePromptSuffix = buildWebPageAssetUsagePromptSuffix(promptNodeData);
  const rawPrompt = imageViewPrompt + webPageAssetUsagePromptSuffix;
  const requestsTransparentPng = imageNodeRequestsTransparentPng(promptNodeData);
  const prompt = requestsTransparentPng
    ? appendGreenScreenBackgroundPrompt(rawPrompt)
    : rawPrompt;
  const promptTransforms = [
    ...(imageViewPrompt !== requestedPrompt ? ["image_view_controls"] : []),
    ...(webPageAssetUsagePromptSuffix ? ["web_page_asset_usage"] : []),
    ...(requestsTransparentPng ? ["green_screen_background"] : []),
  ];
  const negativePrompt = readTrimmedString(nodeData.negativePrompt);
  const systemPrompt = readTrimmedString(nodeData.systemPrompt);
  const webPreviewForNodeId = readTrimmedString(nodeData.webPreviewForNodeId);
  assertWebHeroPreviewStyleReferenceSelected({
    row: input.row,
    webPreviewForNodeId,
	outputNodeId: readTrimmedString(taskNode.id),
  });

  const resolved = await resolveCanvasTaskModel(input.c, "image");
  const resolvedVendor = resolved.vendorKey;
  const resolvedModelKey = resolved.modelKey;
  const modelSelection: ModelSelectionDebugInfo = {
    slot: "image",
    vendorKey: resolvedVendor,
    modelKey: resolvedModelKey,
  };
  const imageSize =
    (webPreviewForNodeId ? WEB_PAGE_PREVIEW_ASPECT_RATIO : "") ||
    normalizeApimartImageSize(nodeData.aspectRatio);
  const webPageAssetForNodeIdFromInput = readTrimmedString(nodeData.webPageAssetForNodeId);
  const webHeroDefaultResolution = defaultWebHeroImageResolution({
    resolvedVendor,
    modelOptions: resolved.options,
  });
  const imageResolution =
    normalizeApimartImageResolution(nodeData.resolution) ||
    (webPreviewForNodeId || webPageAssetForNodeIdFromInput ? webHeroDefaultResolution : "");
  const webHeroModelInputLookup =
    webPreviewForNodeId || webPageAssetForNodeIdFromInput
      ? buildModelInputUrlLookup(input.row)
      : new Map<string, string>();
  const webHeroStyleReferences = buildWebHeroStyleReferenceInputs(input.row, webPreviewForNodeId);
	const webPreviewStyleProvenance = webPreviewForNodeId
		? {
			webPreviewStyleReferenceUrls: [...webHeroStyleReferences.referenceImages].sort(),
		  }
		: {};
  const webHeroStyleReferenceUrls = new Set([
    ...webHeroStyleReferences.referenceImages,
    ...webHeroStyleReferences.assetInputs.map((item) => readTrimmedString(item.url)).filter(Boolean),
  ]);
  const explicitReferenceImages = normalizeStringList(nodeData.referenceImages)
    .filter((url) => !webHeroStyleReferenceUrls.has(url));
  const explicitAssetInputs = normalizeAssetInputs(nodeData.assetInputs)
    .filter((item) => {
      const url = readTrimmedString(item.url);
      return !url || !webHeroStyleReferenceUrls.has(url);
    });
  const resolvedExplicitReferences = await resolveLatestMediaReferences({
    c: input.c,
    requestUserId: input.requestUserId,
    flowId: input.flowId,
    referenceImages: explicitReferenceImages,
    assetInputs: explicitAssetInputs,
  });
  const referenceImages = Array.from(new Set([
    ...canonicalizeReferenceImagesForModel(
      webHeroStyleReferences.referenceImages,
      webHeroModelInputLookup,
    ),
    ...resolvedExplicitReferences.referenceImages,
  ]));
  const assetInputs = (() => {
    const merged: CanvasAssetInput[] = [];
    const seen = new Set<string>();
    const vendorInputs = [
      ...canonicalizeAssetInputsForModel(
        webHeroStyleReferences.assetInputs,
        webHeroModelInputLookup,
      ),
      ...resolvedExplicitReferences.assetInputs,
    ];
    for (const item of vendorInputs) {
      const key = readTrimmedString(item.url) || readTrimmedString(item.assetId);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      merged.push(item);
    }
    return merged;
  })();
  const taskKind: TaskRequestDto["kind"] =
    referenceImages.length > 0 || assetInputs.length > 0 ? "image_edit" : "text_to_image";
  const provenanceReferenceImages = Array.from(new Set([
    ...webHeroStyleReferences.referenceImages,
    ...explicitReferenceImages,
  ]));
  const provenanceAssetInputs = [
    ...webHeroStyleReferences.assetInputs,
    ...explicitAssetInputs,
  ];
  const effectiveNodeData: Record<string, unknown> = {
    ...nodeData,
    kind: taskKind === "image_edit" ? "imageEdit" : nodeData.kind,
    ...(provenanceReferenceImages.length ? { referenceImages: provenanceReferenceImages } : {}),
    ...(provenanceAssetInputs.length ? { assetInputs: provenanceAssetInputs } : {}),
  };
  const explicitNodeId = readTrimmedString(taskNode.id);
  if (!explicitNodeId) {
    throw new AppError(
      "canvas_image_generate_to_canvas requires outputKey; choose a stable key such as storyboard_clip_<n:02d>_<slug>, scene_base_<slug>, character_<slug>_pose_<n:02d>, or prop_<slug>_<n:02d>.",
      {
        status: 400,
        code: "agents_tool_output_key_required",
        details: { tool: "canvas_image_generate_to_canvas" },
      },
    );
  }
  const nodeId = explicitNodeId;
  const imageNodeKind = ImageCanvasNodeKindSchema.parse(effectiveNodeData.kind);
  // Reject incompatible output identities before the cost-bearing provider dispatch.
  // The optimistic write repeats this check later to cover concurrent Flow changes.
  const preflightData = sanitizeFlowDataForStorage(mapFlowRowToDto(input.row).data ?? {});
  const preflightParsed = PublicFlowGraphSchema.safeParse(preflightData);
  if (!preflightParsed.success) {
    throw new AppError("Flow data invalid", {
      status: 500,
      code: "flow_data_invalid",
      details: { issues: preflightParsed.error.issues },
    });
  }
  assertImageCanvasOutputTargetCompatible({
    nodes: preflightParsed.data.nodes ?? [],
    nodeId,
    incomingKind: imageNodeKind,
  });

  const gatewayPixelSize =
    resolvedVendor === "gateway" ? resolveGatewayPixelSize(imageSize, imageResolution) : "";
  const taskRequest: TaskRequestDto = {
    kind: taskKind,
    prompt,
    ...(negativePrompt ? { negativePrompt } : {}),
    extras: {
      modelKey: resolvedModelKey,
      ...(imageSize ? { aspectRatio: imageSize, size: imageSize } : {}),
      ...(imageResolution
        ? { imageResolution, resolution: imageResolution }
        : {}),
      ...(gatewayPixelSize ? { imagePixelSize: gatewayPixelSize } : {}),
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(referenceImages.length ? { referenceImages } : {}),
      ...(assetInputs.length ? { assetInputs } : {}),
      persistAssets: true,
    },
  };
  const generationContext = {
    schemaVersion: 1,
    requestedPrompt,
    effectivePrompt: prompt,
    promptTransforms,
    submittedAt: new Date().toISOString(),
  };

  const created = await runPublicTask(input.c, input.requestUserId, {
    vendor: "auto",
    vendorCandidates: [resolvedVendor],
    request: taskRequest,
  });

  const createdVendor = readTrimmedString(created.vendor) || "auto";
  const canvasStatus = normalizeImageCanvasToolStatus(created.result, createdVendor);
  const taskId = resolveImageTaskIdFromResult(created.result);
  const extracted = extractImageAssetFromTaskResult(created.result);
  if ((canvasStatus === "queued" || canvasStatus === "running") && !taskId) {
    throw new AppError("图片任务创建失败：未返回任务 ID", {
      status: 502,
      code: "agents_tool_image_task_id_missing",
      details: {
        vendor: createdVendor,
        status: created.result.status,
      },
    });
  }
  if (canvasStatus === "success" && !extracted.imageUrl) {
    throw new AppError("图片生成失败：未返回图片 URL", {
      status: 502,
      code: "agents_tool_image_missing_url",
      details: {
        taskId,
        vendor: createdVendor,
      },
    });
  }

  const webPageAssetForNodeId = readTrimmedString(effectiveNodeData.webPageAssetForNodeId);
  const webPageAssetMetadata = normalizeWebPageAssetMetadata(effectiveNodeData);
	  const imagePostprocessNodeData = {
		...effectiveNodeData,
		...webPreviewStyleProvenance,
    ...webPageAssetMetadata,
  };
  let canvasAsset = extracted;
  let assetPostprocessMetadata: Record<string, unknown> = {};
  if (canvasStatus === "success") {
    const prepared = await prepareGeneratedImageAssetForCanvas({
      c: input.c,
      requestUserId: input.requestUserId,
      asset: extracted,
      nodeData: imagePostprocessNodeData,
      meta: {
        taskKind,
        prompt,
        vendor: resolvedVendor,
        modelKey: resolvedModelKey,
        taskId,
      },
    });
    canvasAsset = prepared.asset;
    assetPostprocessMetadata = prepared.metadata;
  }
  const modelInputImageUrl =
    readTrimmedString(canvasAsset.modelInputUrl) ||
    readTrimmedString(canvasAsset.sourceUrl);
  const transparencyMetadata = canvasStatus === "success"
    ? await validateWebPageAssetTransparency({
        nodeId,
        nodeData: imagePostprocessNodeData,
        imageUrl: canvasAsset.imageUrl,
      })
    : {};
  const pptDeckImageForNodeId = readTrimmedString(effectiveNodeData.pptDeckImageForNodeId);
  const pptDeckSlideIndexRaw = effectiveNodeData.pptDeckSlideIndex;
  const pptDeckSlideIndex =
    typeof pptDeckSlideIndexRaw === "number" && Number.isFinite(pptDeckSlideIndexRaw)
      ? Math.max(0, Math.round(pptDeckSlideIndexRaw))
      : null;
  const pptDeckImageMetadata = pptDeckImageForNodeId
    ? {
        pptDeckImageForNodeId,
        ...(pptDeckSlideIndex !== null ? { pptDeckSlideIndex } : {}),
        ...(readTrimmedString(effectiveNodeData.pptDeckSlideId) ? { pptDeckSlideId: readTrimmedString(effectiveNodeData.pptDeckSlideId) } : {}),
      }
    : {};
  const label = readTrimmedString(effectiveNodeData.label);
  const shotNo =
    normalizePositiveInteger(effectiveNodeData.shotNo) ??
    normalizePositiveInteger(effectiveNodeData.shotIndex);
  const mediaAgent = buildMediaAgentBinding(input.runContext);
  const previewLockOverrides = webPreviewForNodeId
    ? {
        aspect: WEB_PAGE_PREVIEW_ASPECT_RATIO,
        aspectRatio: WEB_PAGE_PREVIEW_ASPECT_RATIO,
        size: WEB_PAGE_PREVIEW_ASPECT_RATIO,
        imageResolution,
        resolution: imageResolution,
        nodeWidth: WEB_PAGE_PREVIEW_NODE_WIDTH,
        nodeHeight: WEB_PAGE_PREVIEW_NODE_HEIGHT,
      }
    : {};
  const finalNodeData =
    canvasStatus === "success"
      ? {
		  ...effectiveNodeData,
		  ...webPreviewStyleProvenance,
          ...(mediaAgent ? { mediaAgent } : {}),
          ...webPageAssetMetadata,
          ...pptDeckImageMetadata,
          kind: imageNodeKind,
          ...previewLockOverrides,
					generationContext,
          status: "success",
          progress: 100,
          imageUrl: canvasAsset.imageUrl,
          ...(modelInputImageUrl ? { modelInputImageUrl, sourceImageUrl: modelInputImageUrl } : {}),
          ...assetPostprocessMetadata,
          ...transparencyMetadata,
          imageResults: [
            {
              url: canvasAsset.imageUrl,
              ...(modelInputImageUrl ? { modelInputUrl: modelInputImageUrl, sourceUrl: modelInputImageUrl } : {}),
              title: label,
              ...assetPostprocessMetadata,
              ...transparencyMetadata,
              ...(shotNo !== null ? { shotNo } : {}),
              ...(canvasAsset.assetId ? { assetId: canvasAsset.assetId } : {}),
            },
          ],
          imagePrimaryIndex: 0,
          ...(canvasAsset.assetId ? { assetId: canvasAsset.assetId } : {}),
          ...(taskId ? { taskId, imageTaskId: taskId } : {}),
          imageTaskKind: taskKind,
          vendor: resolvedVendor,
          imageModelVendor: resolvedVendor,
          imageModel: resolvedModelKey,
          lastError: null,
          httpStatus: null,
          isQuotaExceeded: false,
        }
	      : {
	          ...effectiveNodeData,
			  ...webPreviewStyleProvenance,
          ...(mediaAgent ? { mediaAgent } : {}),
          ...webPageAssetMetadata,
          ...pptDeckImageMetadata,
          kind: imageNodeKind,
          ...previewLockOverrides,
					generationContext,
          status: canvasStatus,
          progress: canvasStatus === "queued" ? 10 : 15,
          imageUrl: null,
          imageResults: [],
          imagePrimaryIndex: null,
          assetId: null,
          ...(taskId ? { taskId, imageTaskId: taskId } : {}),
          imageTaskKind: taskKind,
          vendor: resolvedVendor,
          imageModelVendor: resolvedVendor,
          imageModel: resolvedModelKey,
          lastError: null,
          httpStatus: null,
          isQuotaExceeded: false,
        };
  const finalNode: PublicFlowCreateTaskNode = {
    ...taskNode,
    id: nodeId,
    data: PublicFlowCreateTaskNodeSchema.shape.data.parse(finalNodeData),
  };

  let didUpsert = false;
  const { updatedRow } = await optimisticCanvasWrite({
    db: input.c.env.DB,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    versionLabel: "generate-image-pending",
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
      const currentEdges = Array.isArray(currentParsed.data.edges) ? currentParsed.data.edges : [];

      const existingNode = assertImageCanvasOutputTargetCompatible({
        nodes: currentNodes,
        nodeId,
        incomingKind: imageNodeKind,
      });
      if (existingNode) {
        didUpsert = true;
        // slides[i].imageUrl is derived from this image node by
        // reconcilePptMasterNodeIdentities inside applyPublicFlowGraphPatch.
        const applied = applyPublicFlowGraphPatch({
          current,
          origin: input.runContext,
          patch: {
            allowOverwrite: true,
            patchNodeData: [
              {
                id: nodeId,
                data: finalNodeData,
                mergeStrategy: "overwrite",
              },
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
      }

      didUpsert = false;
      let createNodes: PublicFlowCreateNode[] = [finalNode];
      const createEdges: PublicFlowCreateEdge[] = [];
      if (webPreviewForNodeId) {
        const webHeroNode = findFlowNodeById(currentNodes, webPreviewForNodeId);
        if (!isWebHeroNode(webHeroNode)) {
          throw new AppError("webPreviewForNodeId must point to an existing webHero node", {
            status: 400,
            code: "web_page_preview_target_not_found",
            details: { nodeId: webPreviewForNodeId },
          });
        }
        const targetWebHeroNode = webHeroNode;
        const existingGroup = findWebPagePreviewGroup(currentNodes, webPreviewForNodeId);
        const parsedExistingGroup = existingGroup
          ? PublicFlowCreateGroupNodeSchema.parse(existingGroup)
          : null;
        const groupNode = parsedExistingGroup || buildWebPagePreviewGroupNode(targetWebHeroNode);
        const groupId = readNodeId(groupNode);
        finalNode.parentId = groupId;
        if (!parsedExistingGroup) {
          createNodes = [groupNode, finalNode];
        }
      }
      if (webPageAssetForNodeId) {
        const webHeroNode = findFlowNodeById(currentNodes, webPageAssetForNodeId);
        if (!isWebHeroNode(webHeroNode)) {
          throw new AppError("webPageAssetForNodeId must point to an existing webHero node", {
            status: 400,
            code: "web_page_asset_target_not_found",
            details: { nodeId: webPageAssetForNodeId },
          });
        }
        const targetWebHeroNode = webHeroNode;
        const existingGroup = findWebPageAssetGroup(currentNodes, webPageAssetForNodeId);
        const parsedExistingGroup = existingGroup
          ? PublicFlowCreateGroupNodeSchema.parse(existingGroup)
          : null;
        const previewGroup = findWebPagePreviewGroup(currentNodes, webPageAssetForNodeId);
        const groupNode = parsedExistingGroup
          || buildWebPageAssetGroupNode(targetWebHeroNode, previewGroup);
        const groupId = readNodeId(groupNode);
        finalNode.parentId = groupId;
        if (!parsedExistingGroup) {
          createNodes = [groupNode, finalNode];
        }
        const edgeId = `web-asset-edge-${nodeId}-${webPageAssetForNodeId}`;
        const edgeExists = currentEdges.some((edge) => readTrimmedString(readRecord(edge).id) === edgeId);
        if (!edgeExists) createEdges.push(buildWebPageAssetEdge(nodeId, webPageAssetForNodeId));
      }
      if (pptDeckImageForNodeId) {
        const pptDeckNode = findFlowNodeById(currentNodes, pptDeckImageForNodeId);
        if (!isPptDeckNode(pptDeckNode)) {
          throw new AppError("pptDeckImageForNodeId must point to an existing pptDeck node", {
            status: 400,
            code: "ppt_deck_image_target_not_found",
            details: { nodeId: pptDeckImageForNodeId },
          });
        }
        const targetPptDeckNode = pptDeckNode;
        const existingGroup = findPptDeckImageGroup(currentNodes, pptDeckImageForNodeId);
        const parsedExistingGroup = existingGroup
          ? PublicFlowCreateGroupNodeSchema.parse(existingGroup)
          : null;
        const groupNode = parsedExistingGroup || buildPptDeckImageGroupNode(targetPptDeckNode);
        const groupId = readNodeId(groupNode);
        finalNode.parentId = groupId;
        if (!parsedExistingGroup) {
          createNodes = [groupNode, ...createNodes];
        }
        const ppEdgeId = `ppt-deck-image-edge-${nodeId}-${pptDeckImageForNodeId}`;
        const ppEdgeExists = currentEdges.some((edge) => readTrimmedString(readRecord(edge).id) === ppEdgeId);
        if (!ppEdgeExists) createEdges.push(buildPptDeckImageEdge(nodeId, pptDeckImageForNodeId));
      }
      // slides[i].imageUrl is derived from the newly created image node by
      // reconcilePptMasterNodeIdentities inside applyPublicFlowGraphPatch.
      const applied = applyPublicFlowGraphPatch({
        current,
        origin: input.runContext,
        patch: {
          createNodes,
          ...(createEdges.length ? { createEdges } : {}),
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

  const response = PublicFlowPatchResponseSchema.parse({
    ok: true,
    flowId: updatedRow.id,
    updatedAt: updatedRow.updated_at,
    stats: {
      createdNodes: didUpsert ? 0 : 1,
      createdEdges: 0,
      deletedNodes: 0,
      deletedEdges: 0,
      patchedNodes: didUpsert ? 1 : 0,
      appendedArrays: 0,
    },
    data: PublicFlowGraphSchema.parse(sanitizeFlowDataForStorage(mapFlowRowToDto(updatedRow).data ?? {})),
  });

  return {
    ok: true,
    flowId: response.flowId,
    updatedAt: response.updatedAt,
    stats: response.stats,
    nodeId,
    status: canvasStatus,
    pending: canvasStatus !== "success",
    imageUrl: canvasStatus === "success" ? canvasAsset.imageUrl : null,
    vendor: createdVendor,
    taskId,
    assetId: canvasStatus === "success" ? canvasAsset.assetId : null,
    label,
    ...(shotNo !== null ? { shotNo } : {}),
    debug: { modelSelection },
  };
}
