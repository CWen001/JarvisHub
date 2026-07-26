import type { ToolResult } from "../../types/index.js";

const MEDIA_TOOL_KIND = new Map<string, "image" | "video">([
  ["canvas_image_generate_to_canvas", "image"],
  ["canvas_image_wait_for_result", "image"],
  ["canvas_video_generate_to_canvas", "video"],
  ["canvas_video_wait_for_result", "video"],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readResultData(result: ToolResult): Record<string, unknown> {
  const structured = result.payload?.structuredOutput;
  if (isRecord(structured)) {
    if (isRecord(structured.data)) return structured.data;
    return structured;
  }
  return parseRecord(result.content) ?? {};
}

function stripAllUrls(value: string): string {
  return value
    .replace(/https?:\/\/[^\s<>{}\[\]"']+/gi, "[internal media URL omitted]")
    .replace(/\/?(?:assets\/r2\/)?gen\/[\w./%-]+/gi, "[internal media URL omitted]")
    .trim();
}

function stripInternalMediaUrls(value: string): string {
  return value.replace(
    /(?:https?:\/\/[^\s<>{}\[\]"']+)?\/(?:assets\/r2\/)?gen\/(?:images|videos|thumbnails)\/[\w./?&=%+~-]+/gi,
    "[internal media URL omitted]",
  );
}

function readCode(result: ToolResult, data: Record<string, unknown>): string {
  const structured = isRecord(result.payload?.structuredOutput)
    ? result.payload?.structuredOutput as Record<string, unknown>
    : {};
  return readString(data.code) || readString(structured.code) || "media_tool_failed";
}

export function buildModelFacingToolResultContent(input: {
  toolName: string;
  result: ToolResult;
}): string {
  const mediaKind = MEDIA_TOOL_KIND.get(input.toolName);
  if (!mediaKind) return stripInternalMediaUrls(input.result.content);

  const data = readResultData(input.result);
  if (input.result.isError === true) {
    const message = stripAllUrls(input.result.errorMessage || readString(data.message) || "Media tool failed");
    return JSON.stringify({
      ok: false,
      mediaKind,
      code: readCode(input.result, data),
      message,
      referenceContract: "Retry with stable node IDs; internal URLs are resolved by the backend.",
    });
  }

  const status = readString(data.status);
  const pending = typeof data.pending === "boolean"
    ? data.pending
    : status === "queued" || status === "running";
  const nodeId = readString(data.nodeId);
  const assetId = readString(data.assetId);
  const taskId = readString(data.taskId);
  const persisted = !pending && (status === "success" || status === "succeeded");
  return JSON.stringify({
    ok: data.ok !== false,
    mediaKind,
    ...(nodeId ? { nodeId } : {}),
    ...(assetId ? { assetId } : {}),
    ...(status ? { status } : {}),
    pending,
    ...(taskId ? { taskId } : {}),
    persisted,
    referenceContract: "Use nodeId for future canvas-media references; internal URLs are resolved by the backend.",
  });
}
