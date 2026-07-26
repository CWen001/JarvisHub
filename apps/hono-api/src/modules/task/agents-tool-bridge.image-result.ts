import type { TaskResultDto } from "./task.schemas";

export type ExtractedImageAsset = {
  imageUrl: string;
  assetId: string | null;
  sourceUrl?: string | null;
  modelInputUrl?: string | null;
};

export function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function extractImageAssetFromTaskResult(result: unknown): ExtractedImageAsset {
  if (!isRecord(result)) {
    return { imageUrl: "", assetId: null };
  }
  const directImageUrl = readTrimmedString(result.imageUrl);
  if (directImageUrl) {
    return {
      imageUrl: directImageUrl,
      assetId: readTrimmedString(result.assetId) || null,
      sourceUrl: readTrimmedString(result.sourceUrl) || null,
      modelInputUrl: readTrimmedString(result.modelInputUrl) || null,
    };
  }
  const imageResults = Array.isArray(result.imageResults) ? result.imageResults : [];
  for (const item of imageResults) {
    if (!isRecord(item)) continue;
    const url = readTrimmedString(item.url);
    if (!url) continue;
    return {
      imageUrl: url,
      assetId: readTrimmedString(item.assetId) || null,
      sourceUrl: readTrimmedString(item.sourceUrl) || null,
      modelInputUrl: readTrimmedString(item.modelInputUrl) || null,
    };
  }
  const assets = Array.isArray(result.assets) ? result.assets : [];
  for (const item of assets) {
    if (!isRecord(item)) continue;
    const url = readTrimmedString(item.url);
    if (!url) continue;
    const type = readTrimmedString(item.type).toLowerCase();
    if (type && type !== "image") continue;
    return {
      imageUrl: url,
      assetId: readTrimmedString(item.assetId) || null,
      sourceUrl: readTrimmedString(item.sourceUrl) || null,
      modelInputUrl: readTrimmedString(item.modelInputUrl) || null,
    };
  }
  return { imageUrl: "", assetId: null };
}

export function buildImageFailureMessage(result: unknown): string {
  if (!isRecord(result)) return "";
  const raw = isRecord(result.raw) ? result.raw : null;
  const response = isRecord(raw?.response) ? raw.response : null;
  const responseError = isRecord(response?.error) ? response.error : null;
  const parts = [
    readTrimmedString(result.message),
    readTrimmedString(result.error),
    readTrimmedString(raw?.failureReason),
    readTrimmedString(raw?.message),
    readTrimmedString(raw?.error),
    readTrimmedString(response?.message),
    readTrimmedString(response?.error),
    readTrimmedString(responseError?.message),
  ].filter(Boolean);
  return parts.join(" | ");
}

export function resolveImageTaskIdFromResult(result: TaskResultDto): string | null {
  const raw = isRecord(result.raw) ? result.raw : null;
  return readTrimmedString(raw?.taskId) || readTrimmedString(result.id) || null;
}
