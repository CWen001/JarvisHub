/**
 * Walk a canvas graph and collect every asset URL we know about.
 *
 * The field-path table mirrors `apps/hono-api/src/modules/ai/tool-schemas.ts`
 * `canvasNodeSpecs` and the URL collection logic in
 * `apps/hono-api/src/modules/task/task.agents-bridge.ts:2497-2513`.
 */

export type AssetMediaKind = "image" | "video" | "audio" | "thumbnail" | "binary";

export type AssetRef = {
  nodeId: string;
  fieldPath: string;
  url: string;
  mediaKind: AssetMediaKind;
};

type GraphNode = {
  id?: string;
  type?: string;
  data?: unknown;
  [key: string]: unknown;
};

type GraphLike = {
  nodes?: unknown;
  edges?: unknown;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function takeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Skip data URIs and inline blob refs — they need no materialization.
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function pushImage(
  out: AssetRef[],
  nodeId: string,
  fieldPath: string,
  url: string | null,
  kind: AssetMediaKind = "image",
): void {
  if (!url) return;
  out.push({ nodeId, fieldPath, url, mediaKind: kind });
}

function collectFromImageNodeData(
  out: AssetRef[],
  nodeId: string,
  data: Record<string, unknown>,
): void {
  pushImage(out, nodeId, "data.imageUrl", takeString(data.imageUrl));
  if (isArray(data.imageResults)) {
    data.imageResults.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      pushImage(
        out,
        nodeId,
        `data.imageResults[${index}].url`,
        takeString(entry.url),
      );
    });
  }
}

function collectFromVideoNodeData(
  out: AssetRef[],
  nodeId: string,
  data: Record<string, unknown>,
): void {
  pushImage(out, nodeId, "data.videoUrl", takeString(data.videoUrl), "video");
  if (isArray(data.videoResults)) {
    data.videoResults.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      pushImage(
        out,
        nodeId,
        `data.videoResults[${index}].url`,
        takeString(entry.url),
        "video",
      );
      pushImage(
        out,
        nodeId,
        `data.videoResults[${index}].thumbnailUrl`,
        takeString(entry.thumbnailUrl),
        "thumbnail",
      );
    });
  }
  pushImage(out, nodeId, "data.firstFrameUrl", takeString(data.firstFrameUrl), "thumbnail");
  pushImage(out, nodeId, "data.lastFrameUrl", takeString(data.lastFrameUrl), "thumbnail");
  pushImage(out, nodeId, "data.veoFirstFrameUrl", takeString(data.veoFirstFrameUrl), "thumbnail");
  pushImage(out, nodeId, "data.veoLastFrameUrl", takeString(data.veoLastFrameUrl), "thumbnail");
}

function collectFromAudioNodeData(
  out: AssetRef[],
  nodeId: string,
  data: Record<string, unknown>,
): void {
  pushImage(out, nodeId, "data.audioUrl", takeString(data.audioUrl), "audio");
}

function collectFromPptDeckSlides(
  out: AssetRef[],
  nodeId: string,
  data: Record<string, unknown>,
): void {
  // PPTX download (top-level on pptDeck node)
  const pptxUrl = takeString(data.pptxUrl) ?? takeString((data as Record<string, unknown>).downloadUrl);
  if (pptxUrl) {
    out.push({ nodeId, fieldPath: "data.pptxUrl", url: pptxUrl, mediaKind: "binary" });
  }
  if (!isArray(data.slides)) return;
  data.slides.forEach((slide, index) => {
    if (!isRecord(slide)) return;
    pushImage(
      out,
      nodeId,
      `data.slides[${index}].imageUrl`,
      takeString(slide.imageUrl),
    );
    // svgUrl is a local /public/ppt-master/... reference. The materializer
    // inlines it as image/svg+xml; the SVG itself may reference local images
    // via relative href, which the snapshot HTML cannot resolve. We rely on
    // the slide.imageUrl above plus the SVG markup field if available.
    pushImage(
      out,
      nodeId,
      `data.slides[${index}].svgUrl`,
      takeString(slide.svgUrl),
    );
  });
}

function collectFromStoryboardCells(
  out: AssetRef[],
  nodeId: string,
  data: Record<string, unknown>,
): void {
  const cellArrayKeys = [
    "storyboardEditorCells",
    "imageCells",
    "storyboardCells",
  ] as const;
  for (const key of cellArrayKeys) {
    const list = data[key];
    if (!isArray(list)) continue;
    list.forEach((cell, index) => {
      if (!isRecord(cell)) return;
      pushImage(
        out,
        nodeId,
        `data.${key}[${index}].imageUrl`,
        takeString(cell.imageUrl),
      );
      pushImage(
        out,
        nodeId,
        `data.${key}[${index}].videoUrl`,
        takeString(cell.videoUrl),
        "video",
      );
      pushImage(
        out,
        nodeId,
        `data.${key}[${index}].firstFrameUrl`,
        takeString(cell.firstFrameUrl),
        "thumbnail",
      );
    });
  }
}

export function collectAssetRefsFromGraph(graphRaw: unknown): AssetRef[] {
  const out: AssetRef[] = [];
  const graph = (isRecord(graphRaw) ? graphRaw : {}) as GraphLike;
  const nodesRaw = graph.nodes;
  if (!isArray(nodesRaw)) return out;

  for (const nodeRaw of nodesRaw) {
    if (!isRecord(nodeRaw)) continue;
    const node = nodeRaw as GraphNode;
    const id = typeof node.id === "string" ? node.id : "";
    if (!id) continue;
    const data = isRecord(node.data) ? (node.data as Record<string, unknown>) : null;
    if (!data) continue;

    // The collector is intentionally generous: every node potentially has any
    // of these fields. We don't dispatch by node.type because storyboard
    // variants and image nodes may share fields.
    collectFromImageNodeData(out, id, data);
    collectFromVideoNodeData(out, id, data);
    collectFromAudioNodeData(out, id, data);
    collectFromStoryboardCells(out, id, data);
    collectFromPptDeckSlides(out, id, data);
  }
  return out;
}

export function deduplicateAssetRefs(refs: AssetRef[]): AssetRef[] {
  const seen = new Set<string>();
  const out: AssetRef[] = [];
  for (const ref of refs) {
    const key = ref.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}
