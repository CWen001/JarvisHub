import type { ToolHandler, VisionQueueEntry } from "./registry.js";
import { executeRemoteTool, readRemoteToolDefinitions } from "./remote.js";

const READ_MEDIA_TOOL_NAME = "canvas_evaluate_node_read_media";

type ReadMediaItem =
  | {
      kind: "image" | "video";
      url: string;
      role: string;
      sourceField: string;
    }
  | {
      kind: "text";
      text: string;
      role: string;
      sourceField: string;
    };

type ReadMediaResult = {
  ok: true;
  flowId: string;
  nodeId: string;
  nodeType: string;
  nodeKind: string;
  label: string;
  status: string;
  prompt: string;
  items: ReadMediaItem[];
};

type QueuedStandaloneMedia = {
  kind: "image" | "video";
  url: string;
  label: string;
};

const MEDIA_URL_LIMIT = 24;

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const trimmed = readString(item);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

function isPlaceholderNodeId(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "dummy" ||
    normalized === "placeholder" ||
    normalized === "none" ||
    normalized === "n/a" ||
    normalized === "null" ||
    normalized === "undefined"
  );
}

function normalizeRequestedNodeIds(value: unknown, limit: number, hasMediaUrls: boolean): string[] {
  const nodeIds = readStringArray(value, limit);
  if (!hasMediaUrls) return nodeIds;
  return nodeIds.filter((nodeId) => !isPlaceholderNodeId(nodeId));
}

function hasOnlyPlaceholderNodeIds(nodeIds: string[]): boolean {
  return nodeIds.length === 0 || nodeIds.every(isPlaceholderNodeId);
}

function normalizeMediaUrl(value: unknown): string {
  const raw = readString(value);
  if (!raw) return "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
  return parsed.toString();
}

function readMediaUrlArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const url = normalizeMediaUrl(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

function inferMediaKindFromUrl(url: string): "image" | "video" | null {
  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  if (/\.(png|jpe?g|webp|gif|heic|heif)$/.test(pathname)) return "image";
  if (/\.(mp4|webm)$/.test(pathname)) return "video";
  return null;
}

function isInternalCanvasMediaUrl(url: string): boolean {
  try {
    return /\/(?:assets\/r2\/)?gen\/(?:images|videos|thumbnails)\//i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function readAllowedCanvasNodeIds(meta: Record<string, unknown> | undefined): Set<string> | null {
  const fromMeta = readStringArray(meta?.allowedCanvasNodeIds, 200);
  if (fromMeta.length > 0) return new Set(fromMeta);
  const contract = meta?.subagentTaskContract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return null;
  const contractRecord = contract as Record<string, unknown>;
  const fromContract = [
    ...readStringArray(contractRecord.allowedNodeIds, 200),
    ...readStringArray(contractRecord.targetNodeIds, 200),
    ...readStringArray(contractRecord.contextNodeIds, 200),
  ].filter((nodeId, index, all) => all.indexOf(nodeId) === index);
  return fromContract.length > 0 ? new Set(fromContract) : null;
}

function readAllowedMediaUrls(meta: Record<string, unknown> | undefined): Set<string> | null {
  const fromMeta = readMediaUrlArray(meta?.allowedMediaUrls, 200);
  if (fromMeta.length > 0) return new Set(fromMeta);
  const contract = meta?.subagentTaskContract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return null;
  const contractRecord = contract as Record<string, unknown>;
  const fromContract = [
    ...readMediaUrlArray(contractRecord.allowedMediaUrls, 200),
    ...readMediaUrlArray(contractRecord.targetMediaUrls, 200),
    ...readMediaUrlArray(contractRecord.contextMediaUrls, 200),
  ].filter((url, index, all) => all.indexOf(url) === index);
  return fromContract.length > 0 ? new Set(fromContract) : null;
}

function readImplicitCriticMediaUrls(input: {
  explicitMediaUrls: string[];
  rawNodeIds: string[];
  meta: Record<string, unknown> | undefined;
}): string[] {
  if (input.explicitMediaUrls.length > 0) return input.explicitMediaUrls;
  if (readString(input.meta?.currentAgentType) !== "critic") return [];
  if (!hasOnlyPlaceholderNodeIds(input.rawNodeIds)) return [];
  const allowed = readAllowedMediaUrls(input.meta);
  if (!allowed) return [];
  return Array.from(allowed).slice(0, MEDIA_URL_LIMIT);
}

function assertCriticNodeScope(nodeIds: string[], meta: Record<string, unknown> | undefined): void {
  if (readString(meta?.currentAgentType) !== "critic") return;
  if (nodeIds.length === 0) return;
  const allowed = readAllowedCanvasNodeIds(meta);
  if (!allowed) {
    throw new Error(
      "canvas_read_node_media_for_context: critic media read not allowed without scoped task_contract targetNodeIds/contextNodeIds/allowedNodeIds.",
    );
  }
  const blocked = nodeIds.filter((nodeId) => !allowed.has(nodeId));
  if (blocked.length > 0) {
    throw new Error(
      `canvas_read_node_media_for_context: critic media read not allowed for nodeIds outside scope: ${blocked.join(", ")}`,
    );
  }
}

function assertCriticMediaUrlScope(mediaUrls: string[], meta: Record<string, unknown> | undefined): void {
  if (readString(meta?.currentAgentType) !== "critic") return;
  if (mediaUrls.length === 0) return;
  const allowed = readAllowedMediaUrls(meta);
  if (!allowed) {
    throw new Error(
      "canvas_read_node_media_for_context: critic media URL read not allowed without scoped task_contract allowedMediaUrls/targetMediaUrls/contextMediaUrls.",
    );
  }
  const blocked = mediaUrls.filter((url) => !allowed.has(url));
  if (blocked.length > 0) {
    throw new Error(
      `canvas_read_node_media_for_context: critic media URL read not allowed for URLs outside scope: ${blocked.join(", ")}`,
    );
  }
}

function canUseExplicitStandaloneCriticMediaUrls(input: {
  explicitMediaUrls: string[];
  rawNodeIds: string[];
  meta: Record<string, unknown> | undefined;
}): boolean {
  return (
    readString(input.meta?.currentAgentType) === "critic" &&
    input.explicitMediaUrls.length > 0 &&
    input.rawNodeIds.length > 0 &&
    hasOnlyPlaceholderNodeIds(input.rawNodeIds)
  );
}

function extractData(payload: { structuredOutput?: unknown } | undefined): ReadMediaResult | null {
  const structured = payload?.structuredOutput;
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) return null;
  const structuredRecord = structured as Record<string, unknown>;
  const data = (structuredRecord.data && typeof structuredRecord.data === "object" && !Array.isArray(structuredRecord.data)
    ? (structuredRecord.data as Record<string, unknown>)
    : structuredRecord) as Record<string, unknown>;
  if (!Array.isArray(data.items)) return null;
  return data as unknown as ReadMediaResult;
}

function appendMediaEntries(input: {
  queued: VisionQueueEntry[];
  nodeId: string;
  items: ReadMediaItem[];
}): { images: number; videos: number; texts: number } {
  let images = 0;
  let videos = 0;
  let texts = 0;
  const seenImages = new Set(
    input.queued
      .filter((entry): entry is Extract<VisionQueueEntry, { kind: "image" }> => entry.kind === "image")
      .map((entry) => entry.url),
  );
  const seenVideos = new Set(
    input.queued
      .filter((entry): entry is Extract<VisionQueueEntry, { kind: "video" }> => entry.kind === "video")
      .map((entry) => entry.url),
  );
  for (const item of input.items) {
    if (item.kind === "text") {
      const text = readString(item.text);
      if (!text) continue;
      texts += 1;
      input.queued.push({
        kind: "text",
        text,
        label: `${input.nodeId}:${item.role || item.sourceField}`,
      });
      continue;
    }
    if (item.kind !== "image" && item.kind !== "video") continue;
    const url = readString(item.url);
    if (!url) continue;
    if (item.kind === "image") {
      if (seenImages.has(url)) continue;
      seenImages.add(url);
      images += 1;
    } else {
      if (seenVideos.has(url)) continue;
      seenVideos.add(url);
      videos += 1;
    }
    input.queued.push({
      kind: item.kind,
      url,
      label: `${input.nodeId}:${item.role || item.sourceField}`,
      nodeId: input.nodeId,
    });
  }
  return { images, videos, texts };
}

function appendStandaloneMediaEntries(input: {
  queued: VisionQueueEntry[];
  mediaUrls: string[];
}): { images: number; videos: number; media: QueuedStandaloneMedia[] } {
  let images = 0;
  let videos = 0;
  const media: QueuedStandaloneMedia[] = [];
  const seen = new Set(
    input.queued
      .filter((entry): entry is Extract<VisionQueueEntry, { kind: "image" | "video" }> =>
        entry.kind === "image" || entry.kind === "video",
      )
      .map((entry) => entry.url),
  );
  for (const url of input.mediaUrls) {
    if (seen.has(url)) continue;
    const kind = inferMediaKindFromUrl(url);
    if (!kind) {
      throw new Error(
        `canvas_read_node_media_for_context: unsupported standalone media URL extension for ${url}. Supported image/video URLs must end with png, jpg, jpeg, webp, gif, heic, heif, mp4, or webm.`,
      );
    }
    seen.add(url);
    if (kind === "image") images += 1;
    else videos += 1;
    const label = `media-url:${media.length + 1}`;
    input.queued.push({ kind, url, label });
    media.push({ kind, url, label });
  }
  return { images, videos, media };
}

export const readNodeMediaForContextTool: ToolHandler = {
  definition: {
    name: "canvas_read_node_media_for_context",
    description: [
      "Read real image/video/text content from existing JarvisHub nodes or explicitly scoped standalone media URLs and enqueue it as multimodal context for the next model turn.",
      "Use this before final WebHero, screenshot-to-code, or critic evaluation when approved preview/reference nodes must be seen directly, not described from memory.",
      "Only call this for nodes that already have inspectable media URLs; if a generation is still pending, call the matching wait tool first. For critic URL reviews, mediaUrls must be allowed by task_contract allowedMediaUrls/targetMediaUrls/contextMediaUrls.",
      "Fails loud when requested nodes have no supported media or text, so the agent cannot silently proceed without evidence.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        nodeIds: {
          type: "array",
          description: "Canvas node ids whose image/video media or text content should be queued for the next turn.",
          items: { type: "string" },
          minItems: 1,
          maxItems: 24,
        },
        mediaUrls: {
          type: "array",
          description:
            "Standalone image/video URLs to queue when the task_contract explicitly allows them. Use this for URL-only critic reviews.",
          items: { type: "string" },
          minItems: 1,
          maxItems: 24,
        },
        brief: {
          type: "string",
          description:
            "Optional instruction/context block to place before the media in the next multimodal turn.",
        },
      },
      additionalProperties: false,
    },
    effects: { readOnly: true },
    permission: { defaultMode: "allow" },
  },
  async execute(args, ctx, toolCallId) {
    const explicitMediaUrls = readMediaUrlArray(args.mediaUrls, MEDIA_URL_LIMIT);
    if (explicitMediaUrls.some(isInternalCanvasMediaUrl)) {
      throw new Error(
        "canvas_read_node_media_for_context: internal canvas media must be referenced by nodeIds; the Harness resolves the latest persisted URL internally.",
      );
    }
    const rawNodeIds = readStringArray(args.nodeIds, 24);
    const mediaUrls = readImplicitCriticMediaUrls({
      explicitMediaUrls,
      rawNodeIds,
      meta: ctx.meta,
    });
    const nodeIds = normalizeRequestedNodeIds(args.nodeIds, 24, mediaUrls.length > 0);
    const allowExplicitStandaloneCriticUrls = canUseExplicitStandaloneCriticMediaUrls({
      explicitMediaUrls,
      rawNodeIds,
      meta: ctx.meta,
    });
    const brief = readString(args.brief);
    if (!nodeIds.length && !mediaUrls.length) {
      throw new Error("canvas_read_node_media_for_context: nodeIds or mediaUrls is required (non-empty).");
    }
    assertCriticNodeScope(nodeIds, ctx.meta);
    if (!allowExplicitStandaloneCriticUrls) {
      assertCriticMediaUrlScope(mediaUrls, ctx.meta);
    }

    if (nodeIds.length > 0) {
      const remoteTools = readRemoteToolDefinitions(ctx.meta);
      const bridgeAvailable = remoteTools.some((tool) => tool.name === READ_MEDIA_TOOL_NAME);
      if (!bridgeAvailable) {
        throw new Error(
          `canvas_read_node_media_for_context requires bridge tool ${READ_MEDIA_TOOL_NAME}; not registered in current runtime.`,
        );
      }
    }

    const queued: VisionQueueEntry[] = [];
    if (brief) {
      queued.push({ kind: "text", text: brief, label: "brief" });
    }

    const summaries: Array<{
      nodeId: string;
      nodeKind: string;
      label: string;
      status: string;
      itemKinds: Array<ReadMediaItem["kind"]>;
      itemCount: number;
    }> = [];
    let imageCount = 0;
    let videoCount = 0;
    let textItemCount = 0;
    let standaloneMedia: QueuedStandaloneMedia[] = [];

    for (const nodeId of nodeIds) {
      const result = await executeRemoteTool({
        name: READ_MEDIA_TOOL_NAME,
        args: { nodeId },
        toolCallId: `${toolCallId}:${nodeId}`,
        meta: ctx.meta,
      });
      if (!result) {
        throw new Error(
          `canvas_read_node_media_for_context: bridge returned null for node ${nodeId}. Runtime must fail loud rather than stub vision input.`,
        );
      }
      const data = extractData(result.payload);
      if (!data || !Array.isArray(data.items) || data.items.length === 0) {
        throw new Error(
          `canvas_read_node_media_for_context: node ${nodeId} has no inspectable media. Run or wait for the upstream generation before reading context.`,
        );
      }
      const appended = appendMediaEntries({ queued, nodeId, items: data.items });
      imageCount += appended.images;
      videoCount += appended.videos;
      textItemCount += appended.texts;
      summaries.push({
        nodeId: data.nodeId,
        nodeKind: data.nodeKind,
        label: data.label,
        status: data.status,
        itemKinds: Array.from(new Set(data.items.map((item) => item.kind))),
        itemCount: data.items.length,
      });
    }

    if (mediaUrls.length > 0) {
      const appended = appendStandaloneMediaEntries({ queued, mediaUrls });
      imageCount += appended.images;
      videoCount += appended.videos;
      standaloneMedia = appended.media;
    }

    if (imageCount + videoCount + textItemCount === 0) {
      throw new Error(
        "canvas_read_node_media_for_context: no supported media URLs or text content extractable from the requested nodes. Final delivery or evaluation must not proceed without direct evidence.",
      );
    }

    for (const entry of queued) {
      ctx.state.visionQueue.push(entry);
    }

    const contentPayload = {
      ok: true as const,
      queued: {
        images: imageCount,
        videos: videoCount,
        textBlocks: queued.filter((entry) => entry.kind === "text").length,
      },
      nodes: summaries,
      ...(standaloneMedia.length > 0 ? { mediaUrls: standaloneMedia } : {}),
      nextTurnContract: {
        useMediaAsPrimaryEvidence: true,
        instruction:
          "On the next turn, inspect the queued image/video media and text content directly before writing, verifying, or evaluating output.",
      },
    };
    const content = JSON.stringify(contentPayload);
    return {
      toolCallId,
      content,
      payload: { text: content, structuredOutput: contentPayload },
    };
  },
};
