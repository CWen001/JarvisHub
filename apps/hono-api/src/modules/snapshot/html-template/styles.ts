/**
 * CSS for the snapshot viewer. Embedded as a string into the single .html.
 *
 * Layout: two columns (canvas left, AI chat panel right) — visually mirrors
 * the live JarvisHub studio view.
 *
 * Follows root Design.md minimalism: no decorative borders, single-layer
 * rounded radius rule (one container per block has border + radius).
 */
export const SNAPSHOT_STYLES = `
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1f2328;
  background: #f6f7f9;
}
body { padding: 16px; }

.snapshot-app {
  max-width: 1600px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 480px;
  gap: 16px;
  align-items: start;
}
@media (max-width: 1100px) {
  .snapshot-app { grid-template-columns: 1fr; }
  .snapshot-canvas-col { position: static; height: auto; }
}

.snapshot-canvas-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: sticky;
  top: 16px;
  height: calc(100vh - 32px);
}
.snapshot-canvas-col .snapshot-canvas-frame {
  flex: 1;
  min-height: 0;
}

.snapshot-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.snapshot-header-title {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
}
.snapshot-meta {
  font-size: 12px;
  color: #6b7280;
}
.snapshot-meta-warn {
  color: #b45309;
  margin-left: 8px;
}

.snapshot-canvas-frame {
  position: relative;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
}
.snapshot-canvas-frame .snapshot-rf-host {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.snapshot-canvas-frame .react-flow__viewport {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  transform-origin: top left !important;
}
.snapshot-canvas-frame .react-flow__edge-path {
  stroke: rgba(31, 35, 40, 0.55) !important;
  opacity: 1 !important;
}
.snapshot-canvas-frame .react-flow__edge.selected .react-flow__edge-path {
  stroke: rgba(31, 35, 40, 0.85) !important;
}
.snapshot-canvas-frame .tc-group-node__shell {
  border-color: rgba(31, 35, 40, 0.35) !important;
  background: rgba(31, 35, 40, 0.025) !important;
  box-shadow: none !important;
}
.snapshot-canvas-frame .tc-group-node__drag-handle {
  color: #1f2328 !important;
  border-color: rgba(31, 35, 40, 0.35) !important;
  background: #ffffff !important;
}

/* ===== AI chat panel (right column) ===== */
.snapshot-chat-col {
  min-width: 0;
}
.snapshot-chat-panel {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
}
.snapshot-chat-panel-header {
  padding: 14px 16px;
  border-bottom: 1px solid #f1f3f5;
}
.snapshot-chat-panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2328;
}
.snapshot-chat-panel-sub {
  font-size: 11px;
  color: #6b7280;
  margin-top: 2px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
}
.snapshot-chat-panel-body {
  flex: 1;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.snapshot-chat-empty {
  color: #9ca3af;
  font-size: 13px;
  text-align: center;
  padding: 24px 0;
}
.snapshot-chat-session-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 4px 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
}
.snapshot-chat-session-divider::before,
.snapshot-chat-session-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: #f1f3f5;
}

.snapshot-chat-msg {
  display: flex;
  flex-direction: column;
  max-width: 92%;
}
.snapshot-chat-msg[data-role="user"] {
  align-self: flex-end;
  align-items: flex-end;
}
.snapshot-chat-msg[data-role="assistant"] {
  align-self: flex-start;
  align-items: flex-start;
}
.snapshot-chat-msg-meta {
  font-size: 10px;
  color: #9ca3af;
  margin-bottom: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
}
.snapshot-chat-msg-bubble {
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
}
.snapshot-chat-msg[data-role="user"] .snapshot-chat-msg-bubble {
  background: #e5e7eb;
  color: #1f2328;
  border-bottom-right-radius: 4px;
}
.snapshot-chat-msg[data-role="assistant"] .snapshot-chat-msg-bubble {
  background: #f3f4f6;
  color: #1f2328;
  border-bottom-left-radius: 4px;
}
.snapshot-chat-msg-empty {
  font-style: italic;
  color: #9ca3af;
}

/* Todo card */
.snapshot-todo {
  margin-top: 8px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 8px 10px;
  width: 100%;
  max-width: 420px;
}
.snapshot-todo-title {
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.snapshot-todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.snapshot-todo-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  color: #374151;
}
.snapshot-todo-item-marker {
  flex: 0 0 14px;
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
}
.snapshot-todo-item[data-status="completed"] { color: #6b7280; text-decoration: line-through; }
.snapshot-todo-item[data-status="completed"] .snapshot-todo-item-marker { color: #16a34a; }
.snapshot-todo-item[data-status="in_progress"] .snapshot-todo-item-marker { color: #2563eb; }
.snapshot-todo-item[data-status="blocked"] .snapshot-todo-item-marker { color: #dc2626; }
.snapshot-todo-item[data-status="waiting"] .snapshot-todo-item-marker { color: #d97706; }
.snapshot-todo-item[data-status="pending"] .snapshot-todo-item-marker { color: #9ca3af; }

/* Tool call fold */
.snapshot-chat-tools {
  margin-top: 8px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 6px 10px;
  width: 100%;
  max-width: 420px;
}
.snapshot-chat-tools summary {
  font-size: 11px;
  color: #4b5563;
  cursor: pointer;
  user-select: none;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
}
.snapshot-chat-tools summary::-webkit-details-marker { display: none; }
.snapshot-chat-tools summary::before {
  content: "▸";
  font-size: 9px;
  color: #9ca3af;
  transition: transform 120ms ease;
}
.snapshot-chat-tools[open] summary::before {
  transform: rotate(90deg);
}
.snapshot-chat-tool {
  font-size: 11px;
  color: #4b5563;
  padding: 6px 0;
  border-top: 1px solid #f1f3f5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.snapshot-chat-tool:first-of-type {
  margin-top: 4px;
  border-top: 1px solid #f1f3f5;
}
.snapshot-chat-tool-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  color: #1f2328;
  font-weight: 500;
}
.snapshot-chat-tool-status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #e5e7eb;
  color: #374151;
}
.snapshot-chat-tool-status[data-status="failed"] { background: #fee2e2; color: #991b1b; }
.snapshot-chat-tool-status[data-status="succeeded"] { background: #dcfce7; color: #166534; }
.snapshot-chat-tool-status[data-status="running"] { background: #dbeafe; color: #1e40af; }
.snapshot-chat-tool-preview {
  flex-basis: 100%;
  color: #6b7280;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  word-break: break-word;
  white-space: pre-wrap;
}

.snapshot-failures {
  padding: 10px 12px;
  background: #fff7ed;
  border-radius: 6px;
  font-size: 12px;
  color: #92400e;
}
.snapshot-failures summary { cursor: pointer; }
.snapshot-failures ul { margin: 6px 0 0 0; padding-left: 18px; }

/* ===== Canvas overlay: pan/zoom controls + node prompt popover ===== */
.snapshot-canvas-controls {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 6px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
  user-select: none;
}
.snapshot-canvas-controls button {
  appearance: none;
  border: 1px solid transparent;
  background: #ffffff;
  color: #1f2937;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms ease, border-color 120ms ease;
}
.snapshot-canvas-controls button:hover {
  background: #f3f4f6;
  border-color: #d1d5db;
}
.snapshot-canvas-controls button:focus-visible {
  outline: none;
  border-color: rgba(59, 130, 246, 0.7);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
}
.snapshot-canvas-controls button svg {
  width: 16px;
  height: 16px;
}

.snapshot-canvas-frame .react-flow__node {
  cursor: pointer;
}

.snapshot-node-popover {
  position: absolute;
  z-index: 40;
  max-width: 360px;
  min-width: 220px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  box-shadow: 0 20px 48px rgba(15, 23, 42, 0.18);
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.55;
  color: #1f2937;
  pointer-events: auto;
}
/* When a slide carousel is present, allow the popover to grow so the
   embedded 16:9 stage stays legible. */
.snapshot-node-popover:has(.snapshot-pptdeck) {
  max-width: 520px;
  min-width: 320px;
}
.snapshot-node-popover[hidden] { display: none; }
.snapshot-node-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.snapshot-node-popover-title {
  font-size: 12px;
  font-weight: 600;
  color: #111827;
  word-break: break-all;
}
.snapshot-node-popover-kind {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6b7280;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
}
.snapshot-node-popover-close {
  appearance: none;
  border: none;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
}
.snapshot-node-popover-close:hover { background: #f3f4f6; color: #111827; }
.snapshot-node-popover-prompt {
  white-space: pre-wrap;
  word-break: break-word;
  background: #f9fafb;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: #1f2937;
  max-height: 280px;
  overflow: auto;
}
.snapshot-node-popover-empty {
  font-style: italic;
  color: #9ca3af;
}
.snapshot-node-popover-downloads {
  margin-top: 10px;
  border-top: 1px solid #f1f5f9;
  padding-top: 10px;
}
.snapshot-node-popover-downloads[hidden] { display: none; }
.snapshot-node-popover-downloads-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6b7280;
  margin-bottom: 6px;
}
.snapshot-node-popover-downloads-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.snapshot-node-popover-download {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  color: #111827;
  font-size: 11px;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  cursor: pointer;
}
.snapshot-node-popover-download:hover {
  background: #111827;
  border-color: #111827;
  color: #ffffff;
}
.snapshot-node-popover-download-icon {
  font-size: 12px;
  line-height: 1;
}
.snapshot-node-popover-download-label {
  white-space: nowrap;
}

.snapshot-pptdeck {
  margin-top: 12px;
  border-top: 1px solid #f1f5f9;
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.snapshot-pptdeck-stage {
  width: 100%;
  background: #0f172a;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  display: flex;
}
.snapshot-pptdeck-slide {
  position: absolute;
  inset: 0;
  display: flex;
  background: #ffffff;
}
.snapshot-pptdeck-slide-svg,
.snapshot-pptdeck-slide-object,
.snapshot-pptdeck-slide-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.snapshot-pptdeck-slide-svg > svg {
  width: 100%;
  height: 100%;
  display: block;
}
.snapshot-pptdeck-slide-fallback {
  position: absolute;
  inset: 0;
  padding: 18px 22px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: linear-gradient(135deg, #f8fafc, #ffffff 60%);
  color: #0f172a;
}
.snapshot-pptdeck-slide-title {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.3;
  color: #0f172a;
}
.snapshot-pptdeck-slide-subtitle {
  font-size: 12px;
  color: #475569;
}
.snapshot-pptdeck-slide-bullets {
  list-style: disc;
  padding-left: 18px;
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
  color: #1e293b;
}
.snapshot-pptdeck-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.snapshot-pptdeck-nav-btn {
  appearance: none;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  color: #111827;
  width: 30px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.snapshot-pptdeck-nav-btn:hover:not(:disabled) {
  background: #111827;
  border-color: #111827;
  color: #ffffff;
}
.snapshot-pptdeck-nav-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.snapshot-pptdeck-counter {
  font-size: 11px;
  color: #6b7280;
  font-variant-numeric: tabular-nums;
}
`;
