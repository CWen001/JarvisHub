/**
 * Orchestrate the full snapshot export.
 *
 * Inputs:
 *   - flow row (already auth-checked by route)
 *   - canvas DOM clone HTML + font CSS + bounds (from web client)
 *
 * Steps (each emits an SSE event):
 *   1. parse-flow         -> graph, project_id
 *   2. load-conversation
 *   3. collect-assets
 *   4. materialize-asset (one event per asset, 1..N)
 *   5. rewrite-canvas-html -> swap remote URLs for materialized data URIs
 *   6. build-html         -> writes file to tempDir/{token}.html, emits download token
 *
 * Failures during step 4 are captured per-asset and continue the pipeline
 * (per design: "no silent fallback" surfaces failures in HTML metadata).
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto, { createHash } from "node:crypto";
import type { AppContext } from "../../types";
import type { FlowRow } from "../flow/flow.repo";
import {
  collectAssetRefsFromGraph,
  deduplicateAssetRefs,
  type AssetRef,
} from "./asset-collector";
import {
  materializeAssetsConcurrent,
  type MaterializedAsset,
} from "./asset-materializer";
import { loadFlowConversation } from "./flow-conversation.repo";
import { buildSnapshotHtml } from "./html-template/template";

export type SnapshotProgressEvent =
  | { kind: "step"; name: string; payload?: Record<string, unknown> }
  | { kind: "asset-progress"; completed: number; total: number; status: string }
  | { kind: "ready"; downloadToken: string; bytes: number }
  | { kind: "error"; message: string };

export type SnapshotNodeMetaDownload = {
  label: string;
  url: string;
  filename?: string;
};

export type SnapshotNodeMetaPptSlide = {
  index: number;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  imageUrl?: string;
  svgUrl?: string;
  svgMarkup?: string;
  speakerNotes?: string;
};

export type SnapshotNodeMetaPptDeck = {
  format?: string;
  pptxUrl?: string;
  pptxFilename?: string;
  slides: SnapshotNodeMetaPptSlide[];
};

export type SnapshotNodeMeta = {
  id: string;
  type?: string;
  kind?: string;
  label?: string;
  prompt?: string;
  imageUrl?: string;
  downloads?: SnapshotNodeMetaDownload[];
  pptDeck?: SnapshotNodeMetaPptDeck;
};

export type SnapshotPipelineInput = {
  flow: FlowRow;
  userId: string;
  canvasInnerHtml: string;
  fontCss: string;
  pageCss: string;
  canvasBounds: { x: number; y: number; width: number; height: number };
  videoInlineThresholdBytes?: number;
  nodeMeta?: SnapshotNodeMeta[];
};

export type SnapshotPipelineResult = {
  downloadToken: string;
  filePath: string;
  bytes: number;
  failedCount: number;
};

const SNAPSHOT_TEMP_SUBDIR = "jarvishub-snapshots";

function snapshotTempDir(): string {
  return path.join(os.tmpdir(), SNAPSHOT_TEMP_SUBDIR);
}

export function snapshotFilePath(token: string): string {
  return path.join(snapshotTempDir(), `${token}.html`);
}

function parseGraph(raw: string): { graph: unknown; projectId: string | null } {
  let graph: unknown = null;
  try {
    graph = JSON.parse(raw);
  } catch {
    graph = null;
  }
  let projectId: string | null = null;
  if (graph && typeof graph === "object" && !Array.isArray(graph)) {
    const meta = (graph as { __canvasFlowScope?: unknown }).__canvasFlowScope;
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      const scopeId = (meta as { scopeId?: unknown }).scopeId;
      const scopeType = (meta as { scopeType?: unknown }).scopeType;
      if (scopeType === "project" && typeof scopeId === "string") {
        projectId = scopeId;
      }
    }
  }
  return { graph, projectId };
}

/**
 * Emit a short opaque token that the offline viewer resolves to the actual
 * data URI at runtime through `window.__SNAPSHOT_ASSETS__[assetId]`. Keeping
 * the inline payload in the file exactly once (in the asset registry) avoids
 * the duplication that previously inflated exports to 100+ MB when the same
 * image was referenced from the DOM clone, the nodeMeta JSON, the per-node
 * download list, and a pptDeck slide entry.
 */
function assetRefToken(assetId: string): string {
  // Use a `data:` URI prefix so the browser does not attempt to fetch the
  // placeholder before the runtime asset rehydrator wires the real bytes in.
  return `data:asset/x-jh;id=${assetId}`;
}

function rewriteAssetUrls(html: string, materialized: MaterializedAsset[]): string {
  let out = html;
  for (const m of materialized) {
    if (m.status === "inline") {
      const original = m.ref.url;
      if (!original) continue;
      out = out.split(original).join(assetRefToken(m.assetId));
    } else if (m.status === "external") {
      const original = m.ref.url;
      if (!original || original === m.externalUrl) continue;
      out = out.split(original).join(m.externalUrl);
    }
  }
  return out;
}

function buildUrlRewriteMap(materialized: MaterializedAsset[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const item of materialized) {
    const original = item.ref.url;
    if (!original) continue;
    if (item.status === "inline") {
      m.set(original, assetRefToken(item.assetId));
    } else if (item.status === "external") {
      m.set(original, item.externalUrl);
    }
    // "failed" — keep the original URL so the popover at least shows a
    // dead-link rather than crashing.
  }
  return m;
}

/**
 * Build the asset registry that the viewer loads at runtime. Each inline
 * payload is included exactly once, keyed by its content-addressable id.
 */
function buildAssetRegistry(materialized: MaterializedAsset[]): Record<string, string> {
  const reg: Record<string, string> = {};
  for (const m of materialized) {
    if (m.status !== "inline") continue;
    if (!m.assetId) continue;
    // Multiple inline entries can map to the same assetId (same bytes coming
    // from different source URLs) — overwriting is fine, the payload is
    // identical by construction.
    reg[m.assetId] = m.dataUri;
  }
  return reg;
}

/**
 * SVG slides produced by PPT Master embed their background image as a
 * `data:image/...;base64,...` URI inside `<image href>`. Without further
 * processing this means each ~2MB PNG is stored twice — once as a top-level
 * inline asset, once nested inside an SVG asset. We post-process the SVG
 * payloads to extract any embedded base64 image and replace it with the
 * same `data:asset/x-jh;id=<id>` placeholder used elsewhere. The registry
 * gains a single entry for each unique nested binary.
 *
 * This mutates the inline asset's `dataUri` in place: the assetId stays the
 * same (it identifies the SVG by its original bytes, before nested
 * substitution); the new bytes are the deduplicated SVG text.
 */
function dedupeNestedSvgImages(materialized: MaterializedAsset[]): void {
  const NESTED_RE = /data:image\/(?:[a-z0-9+.\-]+);base64,[A-Za-z0-9+/=]+/g;
  // First pass: build a map of unique nested payload bytes -> existing
  // top-level assetId if any (so a PNG used both as the slide image and as
  // the SVG background lands on the same id).
  const knownByPayload = new Map<string, string>();
  for (const m of materialized) {
    if (m.status !== "inline") continue;
    if (m.mimeType.startsWith("image/svg")) continue;
    if (!m.assetId) continue;
    // Use only the base64 portion as the dedup key.
    const idx = m.dataUri.indexOf(";base64,");
    if (idx < 0) continue;
    const payload = m.dataUri.slice(idx + ";base64,".length);
    knownByPayload.set(payload, m.assetId);
  }
  // Second pass: walk every SVG asset, extract nested data URIs, mint new
  // registry ids for ones not already in `knownByPayload`, then rewrite
  // the SVG text.
  for (const m of materialized) {
    if (m.status !== "inline") continue;
    if (!m.mimeType.startsWith("image/svg")) continue;
    const idx = m.dataUri.indexOf(";base64,");
    if (idx < 0) continue;
    const header = m.dataUri.slice(0, idx + ";base64,".length);
    const b64 = m.dataUri.slice(idx + ";base64,".length);
    let svgText: string;
    try {
      svgText = Buffer.from(b64, "base64").toString("utf8");
    } catch {
      continue;
    }
    let mutated = false;
    const nested = svgText.match(NESTED_RE);
    if (!nested) continue;
    for (const raw of nested) {
      const subIdx = raw.indexOf(";base64,");
      if (subIdx < 0) continue;
      const payload = raw.slice(subIdx + ";base64,".length);
      let id = knownByPayload.get(payload);
      if (!id) {
        // Hash the *raw bytes*, not the base64 string, so we agree with the
        // hashing scheme used by materializeAsset.
        let bin: Buffer;
        try {
          bin = Buffer.from(payload, "base64");
        } catch {
          continue;
        }
        id = createHash("sha1").update(bin).digest("base64url").slice(0, 12);
        knownByPayload.set(payload, id);
        // Append a synthetic inline entry so buildAssetRegistry picks it up.
        const mime = raw.slice(5, subIdx);
        materialized.push({
          ref: {
            nodeId: m.ref.nodeId,
            fieldPath: `${m.ref.fieldPath}<nested>`,
            url: `nested-asset:${id}`,
            mediaKind: "image",
          },
          status: "inline",
          dataUri: raw,
          mimeType: mime,
          byteLength: bin.byteLength,
          assetId: id,
        });
      }
      const placeholder = `data:asset/x-jh;id=${id}`;
      svgText = svgText.split(raw).join(placeholder);
      mutated = true;
    }
    if (mutated) {
      // Re-encode the SVG with placeholders in place and update the inline
      // entry in-place.
      const nextBytes = Buffer.from(svgText, "utf8");
      const nextB64 = nextBytes.toString("base64");
      (m as { dataUri: string }).dataUri = `${header}${nextB64}`;
      (m as { byteLength: number }).byteLength = nextBytes.byteLength;
    }
  }
}

function applyUrlRewriteToNodeMeta(
  meta: SnapshotNodeMeta[] | undefined,
  urlMap: Map<string, string>,
): SnapshotNodeMeta[] {
  if (!meta || !meta.length) return [];
  if (urlMap.size === 0) return meta;
  const remap = (url: string | undefined): string | undefined => {
    if (!url) return url;
    const next = urlMap.get(url);
    return next || url;
  };
  return meta.map((entry) => {
    const next: SnapshotNodeMeta = { ...entry };
    if (next.imageUrl) next.imageUrl = remap(next.imageUrl);
    if (next.downloads && next.downloads.length) {
      next.downloads = next.downloads.map((d) => ({
        ...d,
        url: remap(d.url) || d.url,
      }));
    }
    if (next.pptDeck) {
      const deck = next.pptDeck;
      next.pptDeck = {
        ...deck,
        pptxUrl: remap(deck.pptxUrl),
        slides: deck.slides.map((slide) => {
          // remap on plain URLs;  for svgMarkup we run a substring replacement
          // against every known asset URL so that <image href> inside the
          // inline SVG also lands on the placeholder.
          let svgMarkup = slide.svgMarkup;
          if (svgMarkup && urlMap.size > 0) {
            for (const [orig, next] of urlMap.entries()) {
              if (svgMarkup.indexOf(orig) >= 0) svgMarkup = svgMarkup.split(orig).join(next);
            }
          }
          return {
            ...slide,
            imageUrl: remap(slide.imageUrl),
            svgUrl: remap(slide.svgUrl),
            svgMarkup,
          };
        }),
      };
    }
    return next;
  });
}

export async function runSnapshotPipeline(
  c: AppContext,
  input: SnapshotPipelineInput,
  onEvent: (event: SnapshotProgressEvent) => Promise<void> | void,
): Promise<SnapshotPipelineResult> {
  const { flow, userId, canvasInnerHtml, fontCss, pageCss, canvasBounds } = input;

  await onEvent({ kind: "step", name: "parse-flow" });
  const { graph, projectId: graphProjectId } = parseGraph(flow.data);
  const projectId = flow.project_id || graphProjectId || "";

  await onEvent({ kind: "step", name: "load-conversation" });
  const conversation = projectId
    ? await loadFlowConversation(c.env.DB, {
        userId,
        projectId,
        flowId: flow.id,
      })
    : { sessions: [], totalMessages: 0, truncatedSessionCount: 0 };

  await onEvent({ kind: "step", name: "collect-assets" });
  const refs: AssetRef[] = deduplicateAssetRefs(collectAssetRefsFromGraph(graph));
  await onEvent({
    kind: "step",
    name: "collected-assets",
    payload: { count: refs.length },
  });

  const materialized: MaterializedAsset[] = await materializeAssetsConcurrent(
    c,
    refs,
    {
      userId,
      videoInlineThresholdBytes: input.videoInlineThresholdBytes,
    },
    (completed, total, result) => {
      void onEvent({
        kind: "asset-progress",
        completed,
        total,
        status: result.status,
      });
    },
  );

  await onEvent({ kind: "step", name: "rewrite-canvas-html" });
  // Important: dedupe SVG-embedded PNGs FIRST so that the placeholder tokens
  // we are about to inject into the SVG bytes have matching registry ids.
  dedupeNestedSvgImages(materialized);
  const rewrittenHtml = rewriteAssetUrls(canvasInnerHtml, materialized);
  const urlRewriteMap = buildUrlRewriteMap(materialized);
  const rewrittenNodeMeta = applyUrlRewriteToNodeMeta(input.nodeMeta, urlRewriteMap);
  const assetRegistry = buildAssetRegistry(materialized);

  await onEvent({ kind: "step", name: "build-html" });
  const html = buildSnapshotHtml({
    flowId: flow.id,
    flowName: flow.name,
    exportedAtIso: new Date().toISOString(),
    conversation,
    assets: materialized,
    canvasInnerHtml: rewrittenHtml,
    fontCss,
    pageCss,
    canvasBounds,
    nodeCount: countNodes(graph),
    nodeMeta: rewrittenNodeMeta,
    assetRegistry,
  });

  const token = crypto.randomBytes(16).toString("hex");
  const dir = snapshotTempDir();
  await mkdir(dir, { recursive: true });
  const file = snapshotFilePath(token);
  await writeFile(file, html, "utf8");

  const bytes = Buffer.byteLength(html, "utf8");
  const failedCount = materialized.filter((m) => m.status === "failed").length;

  await onEvent({ kind: "ready", downloadToken: token, bytes });

  return { downloadToken: token, filePath: file, bytes, failedCount };
}

function countNodes(graph: unknown): number {
  if (
    graph &&
    typeof graph === "object" &&
    !Array.isArray(graph) &&
    Array.isArray((graph as { nodes?: unknown[] }).nodes)
  ) {
    return (graph as { nodes: unknown[] }).nodes.length;
  }
  return 0;
}
