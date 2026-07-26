import type { TaskResultDto } from "./task.schemas";

export type ExtractedVideoAsset = {
  videoUrl: string;
  thumbnailUrl: string | null;
  assetId: string | null;
};

export function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function extractVideoAssetFromTaskResult(result: unknown): ExtractedVideoAsset {
  if (!isRecord(result)) {
    return { videoUrl: "", thumbnailUrl: null, assetId: null };
  }
  const assets = Array.isArray(result.assets) ? result.assets : [];
  for (const item of assets) {
    if (!isRecord(item)) continue;
    const url = readTrimmedString(item.url);
    if (!url) continue;
    const type = readTrimmedString(item.type).toLowerCase();
    if (!type || type === "video") {
      return {
        videoUrl: url,
        thumbnailUrl: readTrimmedString(item.thumbnailUrl) || null,
        assetId: readTrimmedString(item.assetId) || null,
      };
    }
  }
  const directVideoUrl = readTrimmedString(result.videoUrl);
  if (directVideoUrl) {
    return {
      videoUrl: directVideoUrl,
      thumbnailUrl: readTrimmedString(result.videoThumbnailUrl) || null,
      assetId: null,
    };
  }
  const videoResults = Array.isArray(result.videoResults) ? result.videoResults : [];
  for (const item of videoResults) {
    if (!isRecord(item)) continue;
    const url = readTrimmedString(item.url);
    if (!url) continue;
    return {
      videoUrl: url,
      thumbnailUrl: readTrimmedString(item.thumbnailUrl) || null,
      assetId: readTrimmedString(item.assetId) || null,
    };
  }
  return { videoUrl: "", thumbnailUrl: null, assetId: null };
}

export function buildVideoFailureMessage(result: unknown): string {
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

export function resolveTaskIdFromResult(result: TaskResultDto): string | null {
  const raw = isRecord(result.raw) ? result.raw : null;
  return readTrimmedString(raw?.taskId) || readTrimmedString(result.id) || null;
}
