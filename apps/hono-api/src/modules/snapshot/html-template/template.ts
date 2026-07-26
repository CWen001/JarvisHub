/**
 * Assemble final single-file HTML snapshot from all gathered pieces.
 *
 * Output is a fully self-contained .html that opens via file:// double-click.
 * Layout mirrors the live JarvisHub studio view: canvas on the left,
 * AI chat panel on the right (HTML/CSS rendering — not a screenshot).
 *
 * The canvas content is a DOM clone of `.react-flow__viewport` with
 * computed styles inlined and asset URLs already rewritten to data URIs
 * by the pipeline's rewrite-canvas-html step.
 */

import type { MaterializedAsset } from "../asset-materializer";
import type { FlowConversation } from "../flow-conversation.repo";
import { SNAPSHOT_STYLES } from "./styles";
import { SNAPSHOT_VIEWER_JS } from "./viewer";

export type SnapshotNodeMetaTemplateDownload = {
  label: string;
  url: string;
  filename?: string;
};

export type SnapshotNodeMetaTemplatePptSlide = {
  index: number;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  imageUrl?: string;
  svgUrl?: string;
  svgMarkup?: string;
  speakerNotes?: string;
};

export type SnapshotNodeMetaTemplatePptDeck = {
  format?: string;
  pptxUrl?: string;
  pptxFilename?: string;
  slides: SnapshotNodeMetaTemplatePptSlide[];
};

export type SnapshotNodeMetaTemplate = {
  id: string;
  type?: string;
  kind?: string;
  label?: string;
  prompt?: string;
  imageUrl?: string;
  downloads?: SnapshotNodeMetaTemplateDownload[];
  pptDeck?: SnapshotNodeMetaTemplatePptDeck;
};

export type SnapshotHtmlInput = {
  flowId: string;
  flowName: string;
  exportedAtIso: string;
  conversation: FlowConversation;
  assets: MaterializedAsset[];
  canvasInnerHtml: string;
  fontCss: string;
  pageCss: string;
  canvasBounds: { x: number; y: number; width: number; height: number };
  nodeCount: number;
  nodeMeta?: SnapshotNodeMetaTemplate[];
  /**
   * Map of asset id -> data URI. Inlined exactly once into the offline page,
   * then resolved by the viewer wherever a `data:asset/x-jh;id=<id>` token appears
   * (DOM attributes, nodeMeta JSON, pptDeck slides, download chips).
   */
  assetRegistry?: Record<string, string>;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function collectFailures(assets: MaterializedAsset[]): Array<{
  nodeId: string;
  fieldPath: string;
  url: string;
  reason: string;
}> {
  const failed: Array<{ nodeId: string; fieldPath: string; url: string; reason: string }> = [];
  for (const a of assets) {
    if (a.status === "failed") {
      failed.push({
        nodeId: a.ref.nodeId,
        fieldPath: a.ref.fieldPath,
        url: a.ref.url,
        reason: a.reason,
      });
    }
  }
  return failed;
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value).replace(/<\/(script)/gi, "<\\/$1");
}

export function buildSnapshotHtml(input: SnapshotHtmlInput): string {
  const failed = collectFailures(input.assets);

  const payload = {
    conversation: input.conversation,
    failed,
    flow: { id: input.flowId, name: input.flowName, exportedAtIso: input.exportedAtIso },
    nodeMeta: input.nodeMeta || [],
  };

  const truncatedNote =
    input.conversation.truncatedSessionCount > 0
      ? `<span class="snapshot-meta-warn">${input.conversation.truncatedSessionCount} session(s) exceeded 80 messages — only the most recent are included</span>`
      : "";

  const failuresBlock =
    failed.length === 0
      ? ""
      : `
    <details class="snapshot-failures">
      <summary>${failed.length} asset(s) failed to export</summary>
      <ul>
        ${failed
          .map(
            (f) =>
              `<li>${escapeHtml(f.nodeId)} · ${escapeHtml(f.fieldPath)} — ${escapeHtml(f.reason)}</li>`,
          )
          .join("")}
      </ul>
    </details>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.flowName)} · Project snapshot</title>
  <style>${SNAPSHOT_STYLES}</style>
  <style data-page>${input.pageCss}</style>
  <style data-fonts>${input.fontCss}</style>
</head>
<body>
  <main class="snapshot-app">
    <section class="snapshot-canvas-col">
      <header class="snapshot-header">
        <h1 class="snapshot-header-title">${escapeHtml(input.flowName)}</h1>
        <div class="snapshot-meta">
          Exported ${escapeHtml(input.exportedAtIso)} · ${input.nodeCount} node(s) · ${input.conversation.totalMessages} message(s)
          ${truncatedNote}
        </div>
      </header>
      <div class="snapshot-canvas-frame" data-bounds-w="${input.canvasBounds.width}" data-bounds-h="${input.canvasBounds.height}" data-bounds-x="${input.canvasBounds.x}" data-bounds-y="${input.canvasBounds.y}">
        <div class="react-flow xyflow snapshot-rf-host">
          ${input.canvasInnerHtml}
        </div>
        <div class="snapshot-canvas-controls" role="group" aria-label="Canvas controls">
          <button type="button" data-action="zoom-in" title="Zoom in" aria-label="Zoom in">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button type="button" data-action="zoom-out" title="Zoom out" aria-label="Zoom out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button type="button" data-action="fit-view" title="Fit view" aria-label="Fit view">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="4 9 4 4 9 4"></polyline>
              <polyline points="20 9 20 4 15 4"></polyline>
              <polyline points="4 15 4 20 9 20"></polyline>
              <polyline points="20 15 20 20 15 20"></polyline>
            </svg>
          </button>
        </div>
        <div class="snapshot-node-popover" hidden role="dialog" aria-label="Node detail">
          <div class="snapshot-node-popover-header">
            <div>
              <div class="snapshot-node-popover-title" data-role="title"></div>
              <div class="snapshot-node-popover-kind" data-role="kind"></div>
            </div>
            <button type="button" class="snapshot-node-popover-close" data-role="close" aria-label="Close">×</button>
          </div>
          <div class="snapshot-node-popover-prompt" data-role="prompt"></div>
          <div class="snapshot-node-popover-downloads" data-role="downloads" hidden></div>
        </div>
      </div>
      ${failuresBlock}
    </section>
    <aside class="snapshot-chat-col">
      <div class="snapshot-chat-panel">
        <div class="snapshot-chat-panel-header">
          <div class="snapshot-chat-panel-title">AI Chat</div>
          <div class="snapshot-chat-panel-sub">${input.conversation.totalMessages} message(s) · ${input.conversation.sessions.length} session(s)</div>
        </div>
        <div class="snapshot-chat-panel-body"></div>
      </div>
    </aside>
  </main>
  <script>window.__SNAPSHOT__ = ${safeStringify(payload)};</script>
  <script>window.__SNAPSHOT_ASSETS__ = ${safeStringify(input.assetRegistry || {})};</script>
  <script>${SNAPSHOT_VIEWER_JS}</script>
</body>
</html>`;
}
