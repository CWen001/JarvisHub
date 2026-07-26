import type { Message, MessageContentPart } from "../../types/index.js";
import type { ToolRuntimeState, VisionQueueEntry } from "./registry.js";

const VISION_QUEUE_HEADER = "[vision batch] Inspect the following image/video media and text content against the criteria/context. Reply in the NEXT turn based on what you observe.";

function buildContentParts(entries: VisionQueueEntry[]): MessageContentPart[] {
  const parts: MessageContentPart[] = [];
  parts.push({ type: "text", text: VISION_QUEUE_HEADER });
  for (const entry of entries) {
    if (entry.kind === "text") {
      const label = entry.label ? `[${entry.label}] ` : "";
      parts.push({ type: "text", text: `${label}${entry.text}` });
      continue;
    }
    if (entry.kind === "image") {
      if (entry.label) {
        parts.push({ type: "text", text: `[image: ${entry.label}]` });
      }
      parts.push({ type: "image_url", imageUrl: entry.url });
      continue;
    }
    if (entry.kind === "video") {
      if (entry.label) {
        parts.push({ type: "text", text: `[video: ${entry.label}]` });
      }
      parts.push({ type: "media_url", mediaUrl: entry.url });
    }
  }
  return parts;
}

export function buildVisionPlaceholderText(entries: VisionQueueEntry[]): string {
  const lines: string[] = [VISION_QUEUE_HEADER];
  for (const entry of entries) {
    if (entry.kind === "text") {
      const label = entry.label ? `[${entry.label}] ` : "";
      lines.push(`${label}${entry.text}`);
      continue;
    }
    const label = entry.label ? ` ${entry.label}` : "";
    if (entry.kind === "image") {
      lines.push(`[image${label}]`);
    } else if (entry.kind === "video") {
      lines.push(`[video${label}]`);
    }
  }
  return lines.join("\n");
}

export function drainVisionQueue(messages: Message[], state: ToolRuntimeState): number {
  if (!state.visionQueue.length) return 0;
  const entries = state.visionQueue.slice();
  const parts = buildContentParts(entries);
  const placeholderText = buildVisionPlaceholderText(entries);
  messages.push({
    role: "user",
    content: placeholderText,
    contentParts: parts,
  });
  state.visionQueue.length = 0;
  return entries.length;
}
