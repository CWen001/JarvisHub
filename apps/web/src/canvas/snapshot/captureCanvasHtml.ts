/**
 * Capture the live React Flow canvas as a self-contained DOM clone.
 *
 * Output:
 *   - canvasInnerHtml: cloned `.react-flow__viewport` outerHTML. Class names
 *     and inline styles are preserved as-is; we do NOT inline computed styles
 *     because that produces megabytes of redundant defaults per element.
 *     Image/video src remain as their original remote URLs so the backend can
 *     swap them for materialized data URIs.
 *   - fontCss: @font-face CSS extracted by html-to-image so the HTML renders
 *     with the live UI's webfonts even offline.
 *   - pageCss: concatenated CSS rules from all same-origin stylesheets on the
 *     current page. Combined with preserved class names, this reproduces the
 *     live styling without per-element style inlining.
 *   - bounds: bounding box (with 32px pad) computed from node positions; used
 *     by the backend to size the exported canvas frame.
 */
import { getFontEmbedCSS } from "html-to-image";
import type { Node } from "@xyflow/react";

export type SnapshotNodeDownload = {
  /** Stable role label rendered as the button text, e.g. "图片" / "视频" / "PPTX". */
  label: string;
  /** Browser-usable URL. */
  url: string;
  /** Filename hint for the <a download> attribute. */
  filename?: string;
};

export type SnapshotPptSlide = {
  index: number;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  imageUrl?: string;
  svgUrl?: string;
  svgMarkup?: string;
  speakerNotes?: string;
};

export type SnapshotPptDeck = {
  /** 16:9 / 4:3 / etc. — drives the aspect ratio of the rendered slide. */
  format?: string;
  /** PPTX download URL once export_pptx has completed. */
  pptxUrl?: string;
  /** Filename hint for the PPTX download. */
  pptxFilename?: string;
  slides: SnapshotPptSlide[];
};

export type SnapshotNodeMeta = {
  id: string;
  type?: string;
  kind?: string;
  label?: string;
  prompt?: string;
  imageUrl?: string;
  /** Per-node download targets surfaced in the offline viewer's prompt popover. */
  downloads?: SnapshotNodeDownload[];
  /** Embedded pptDeck data so the offline viewer can render a slide carousel. */
  pptDeck?: SnapshotPptDeck;
};

export type CanvasHtmlSnapshot = {
  canvasInnerHtml: string;
  fontCss: string;
  pageCss: string;
  bounds: { x: number; y: number; width: number; height: number };
  nodeMeta: SnapshotNodeMeta[];
};

const FILTERED_SELECTORS = [
  ".react-flow__minimap",
  ".react-flow__controls",
  ".react-flow__attribution",
  ".react-flow__panel",
  ".react-flow__background",
] as const;

const PAD = 32;

export async function captureCanvasHtml(nodes: Node[]): Promise<CanvasHtmlSnapshot> {
  const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewport) throw new Error(".react-flow__viewport not found");
  if (!nodes.length) throw new Error("Canvas is empty");

  const bounds = computeBounds(nodes);
  const fontCss = await getFontEmbedCSS(viewport);
  const pageCss = extractPageCss();

  const clone = viewport.cloneNode(true) as HTMLElement;
  removeChrome(clone);
  stripHeavyAnchors(clone);
  clone.style.transform = `translate(${-bounds.x}px, ${-bounds.y}px)`;
  clone.style.transformOrigin = "top left";
  clone.style.width = `${bounds.width}px`;
  clone.style.height = `${bounds.height}px`;

  return {
    canvasInnerHtml: clone.outerHTML,
    fontCss,
    pageCss,
    bounds,
    nodeMeta: collectNodeMeta(nodes),
  };
}

function readStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function pushDownload(
  list: SnapshotNodeDownload[],
  label: string,
  url: string,
  filename?: string,
): void {
  if (!url) return;
  // Skip in-memory blob: URLs — they don't survive the exported HTML file.
  if (url.startsWith("blob:")) return;
  if (list.some((d) => d.url === url)) return;
  const entry: SnapshotNodeDownload = { label, url };
  if (filename) entry.filename = filename;
  list.push(entry);
}

function inferFilename(label: string, url: string, fallbackExt: string): string {
  try {
    const u = new URL(url, "http://placeholder.local");
    const last = u.pathname.split("/").filter(Boolean).pop() || "";
    if (last && /\.[a-z0-9]{2,8}$/i.test(last)) return last;
  } catch {
    // ignore
  }
  const safe = label.replace(/[^a-zA-Z0-9_-]+/g, "_") || "download";
  return `${safe}.${fallbackExt}`;
}

function collectDownloadsFromNode(data: Record<string, unknown>): SnapshotNodeDownload[] {
  const out: SnapshotNodeDownload[] = [];

  const imageUrl = readStr(data.imageUrl);
  if (imageUrl) pushDownload(out, "图片", imageUrl, inferFilename("image", imageUrl, "png"));
  if (Array.isArray(data.imageResults)) {
    data.imageResults.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") return;
      const url = readStr((entry as Record<string, unknown>).url);
      if (url && url !== imageUrl) {
        pushDownload(out, `图片 ${index + 1}`, url, inferFilename(`image_${index + 1}`, url, "png"));
      }
    });
  }

  const videoUrl = readStr(data.videoUrl);
  if (videoUrl) pushDownload(out, "视频", videoUrl, inferFilename("video", videoUrl, "mp4"));
  if (Array.isArray(data.videoResults)) {
    data.videoResults.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") return;
      const url = readStr((entry as Record<string, unknown>).url);
      if (url && url !== videoUrl) {
        pushDownload(out, `视频 ${index + 1}`, url, inferFilename(`video_${index + 1}`, url, "mp4"));
      }
    });
  }

  const audioUrl = readStr(data.audioUrl);
  if (audioUrl) pushDownload(out, "音频", audioUrl, inferFilename("audio", audioUrl, "mp3"));

  // pptDeck: editable PPTX exported by ppt-master.
  const pptxUrl = readStr(data.pptxUrl) || readStr((data as Record<string, unknown>).downloadUrl);
  if (pptxUrl) pushDownload(out, "PPTX", pptxUrl, inferFilename("deck", pptxUrl, "pptx"));

  // webHero: final document HTML/CSS. We export the document via a data:
  // URL so the offline viewer can serve the standalone page back to the user.
  const webHeroDocumentHtml = readStr((data as Record<string, unknown>).webHeroDocumentHtml);
  if (webHeroDocumentHtml) {
    try {
      const dataUri = `data:text/html;charset=utf-8;base64,${btoa(unescape(encodeURIComponent(webHeroDocumentHtml)))}`;
      pushDownload(out, "网页 HTML", dataUri, "webhero.html");
    } catch {
      // ignore
    }
  }

  return out;
}

const PPT_FORMAT_WHITELIST = new Set(["ppt169", "ppt43", "xhs", "story"]);

export function collectPptDeck(data: Record<string, unknown>): SnapshotPptDeck | undefined {
  const slidesRaw = Array.isArray(data.slides) ? data.slides : null;
  const pptxUrl = readStr(data.pptxUrl) || readStr((data as Record<string, unknown>).downloadUrl);
  if (!slidesRaw && !pptxUrl) return undefined;
  const formatRaw = readStr(data.format);
  const format = PPT_FORMAT_WHITELIST.has(formatRaw) ? formatRaw : "ppt169";
  const out: SnapshotPptDeck = { format, slides: [] };
  if (pptxUrl) {
    out.pptxUrl = pptxUrl;
    out.pptxFilename = inferFilename("deck", pptxUrl, "pptx");
  }
  if (slidesRaw) {
    out.slides = slidesRaw.slice(0, 60).map((raw, index): SnapshotPptSlide => {
      const record = (raw && typeof raw === "object" && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {};
      const slide: SnapshotPptSlide = { index };
      const title = readStr(record.title) || readStr(record.label);
      if (title) slide.title = title;
      const subtitle = readStr(record.subtitle) || readStr(record.summary);
      if (subtitle) slide.subtitle = subtitle;
      const speakerNotes = readStr(record.speakerNotes) || readStr(record.notes);
      if (speakerNotes) slide.speakerNotes = speakerNotes;
      const imageUrl = readStr(record.imageUrl);
      if (imageUrl) slide.imageUrl = imageUrl;
      const svgUrl = readStr(record.svgUrl);
      if (svgUrl) slide.svgUrl = svgUrl;
      const svgMarkup = readStr(record.svgMarkup);
      if (svgMarkup) slide.svgMarkup = svgMarkup;
      if (Array.isArray(record.bullets)) {
        const bullets = (record.bullets as unknown[])
          .map((b) => (typeof b === "string" ? b.trim() : ""))
          .filter(Boolean)
          .slice(0, 8);
        if (bullets.length) slide.bullets = bullets;
      }
      return slide;
    });
  }
  return out;
}

function collectNodeMeta(nodes: Node[]): SnapshotNodeMeta[] {
  const out: SnapshotNodeMeta[] = [];
  for (const n of nodes) {
    const id = typeof n.id === "string" ? n.id : "";
    if (!id) continue;
    const data = (n.data && typeof n.data === "object" ? n.data : {}) as Record<string, unknown>;
    const meta: SnapshotNodeMeta = { id };
    const type = typeof n.type === "string" ? n.type : "";
    if (type) meta.type = type;
    const kind = readStr(data.kind);
    if (kind) meta.kind = kind;
    const label = readStr(data.label);
    if (label) meta.label = label;
    const prompt = readStr(data.prompt);
    if (prompt) meta.prompt = prompt;
    const imageUrl = readStr(data.imageUrl);
    if (imageUrl) meta.imageUrl = imageUrl;
    const downloads = collectDownloadsFromNode(data);
    if (downloads.length) meta.downloads = downloads;
    const pptDeck = collectPptDeck(data);
    if (pptDeck) meta.pptDeck = pptDeck;
    if (!meta.kind && !meta.prompt && !meta.label && !meta.imageUrl && !meta.downloads && !meta.pptDeck) continue;
    out.push(meta);
  }
  return out;
}

type BoundsCandidate = {
  id: string;
  hidden: boolean;
  parentId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
};

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function collectBoundsCandidates(nodes: Node[]): BoundsCandidate[] {
  const out: BoundsCandidate[] = [];
  for (const n of nodes) {
    if (n.hidden) continue;
    const x = n.position?.x ?? 0;
    const y = n.position?.y ?? 0;
    const measured = n.measured ?? {};
    const w = readNumber((n as { width?: unknown }).width) ?? readNumber(measured.width) ?? 0;
    const h = readNumber((n as { height?: unknown }).height) ?? readNumber(measured.height) ?? 0;
    if (w <= 0 || h <= 0) continue;
    const parentId = typeof (n as { parentId?: unknown }).parentId === "string"
      ? ((n as { parentId?: string }).parentId as string)
      : null;
    out.push({
      id: typeof n.id === "string" ? n.id : "",
      hidden: Boolean(n.hidden),
      parentId,
      x,
      y,
      w,
      h,
    });
  }
  return out;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function dropOutliers(candidates: BoundsCandidate[]): BoundsCandidate[] {
  if (candidates.length < 4) return candidates;
  // Compute the median axis-aligned span; flag nodes whose center is more
  // than 6x the median span away from the dataset's center. Real flows
  // rarely place active nodes that far apart, while stale or test nodes
  // sometimes end up at ~-4e5 or +4e5 (manual drag, math glitch, etc.).
  const cxs = candidates.map((c) => c.x + c.w / 2);
  const cys = candidates.map((c) => c.y + c.h / 2);
  const widths = candidates.map((c) => c.w);
  const heights = candidates.map((c) => c.h);
  const medCx = median(cxs);
  const medCy = median(cys);
  const medW = Math.max(120, median(widths));
  const medH = Math.max(120, median(heights));
  const maxDx = medW * 60; // generous: ~60 typical node widths from center
  const maxDy = medH * 60;
  const filtered = candidates.filter((c) => {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    return Math.abs(cx - medCx) <= maxDx && Math.abs(cy - medCy) <= maxDy;
  });
  // Always keep at least one node; if everything was flagged outlier, fall
  // back to the unfiltered list.
  return filtered.length === 0 ? candidates : filtered;
}

function computeBounds(nodes: Node[]): { x: number; y: number; width: number; height: number } {
  const candidates = collectBoundsCandidates(nodes);
  if (candidates.length === 0) {
    return { x: 0, y: 0, width: 1280, height: 720 };
  }
  const kept = dropOutliers(candidates);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of kept) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + c.w);
    maxY = Math.max(maxY, c.y + c.h);
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: 1280, height: 720 };
  }
  return {
    x: minX - PAD,
    y: minY - PAD,
    width: maxX - minX + PAD * 2,
    height: maxY - minY + PAD * 2,
  };
}

function extractPageCss(): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      // cross-origin stylesheet — skip silently
      rules = null;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      chunks.push(rule.cssText);
    }
  }
  return chunks.join("\n");
}

function removeChrome(root: HTMLElement): void {
  for (const sel of FILTERED_SELECTORS) {
    root.querySelectorAll(sel).forEach((n) => n.remove());
  }
}

// Drop any anchor whose href is a data: URI larger than ~16KB. These are
// typically inlined PPTX/MP4 downloads embedded into the node card's "下载"
// button. Leaving them in the cloned canvas HTML would bloat the offline
// export by tens to hundreds of MB. The offline viewer surfaces those
// downloads via nodeMeta.downloads + the popover chip with a fetch-based
// fallback, so dropping the inline href here does not lose functionality.
const HEAVY_HREF_BYTE_THRESHOLD = 16 * 1024;
function stripHeavyAnchors(root: HTMLElement): void {
  root.querySelectorAll("a[href^='data:']").forEach((node) => {
    const a = node as HTMLAnchorElement;
    const href = a.getAttribute("href") || "";
    if (href.length <= HEAVY_HREF_BYTE_THRESHOLD) return;
    // Keep the element so the layout doesn't shift, but neutralize the href
    // and click target.
    a.removeAttribute("href");
    a.removeAttribute("download");
    a.setAttribute("data-snapshot-stripped", "1");
  });
}
