import { Buffer } from "node:buffer";
import { isIP } from "node:net";

export const ALLOWED_INLINE_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

export const ALLOWED_INLINE_VIDEO_MIME = new Set([
  "video/mp4",
  "video/webm",
]);

export const ALLOWED_INLINE_MEDIA_MIME = new Set([
  ...ALLOWED_INLINE_IMAGE_MIME,
  ...ALLOWED_INLINE_VIDEO_MIME,
]);

export type InlineMediaResult = {
  mimeType: string;
  base64: string;
  dataUrl: string;
};

type CanvasImageLike = {
  width: number;
  height: number;
};

type CanvasContextLike = {
  fillStyle: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: "low" | "medium" | "high";
  fillRect: (x: number, y: number, width: number, height: number) => void;
  drawImage: (
    image: CanvasImageLike,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number,
  ) => void;
};

type CanvasLike = {
  getContext: (type: "2d") => CanvasContextLike | null;
  encode: (format: "jpeg", quality?: number) => Promise<Buffer>;
};

type CanvasModule = {
  createCanvas: (width: number, height: number) => CanvasLike;
  loadImage: (source: Buffer | Uint8Array | string) => Promise<CanvasImageLike>;
};

const IMAGE_FIT_MAX_EDGE = 4096;
const IMAGE_FIT_JPEG_QUALITY = 82;
const IMAGE_FIT_MAX_ATTEMPTS = 8;
const IMAGE_FIT_MAX_SOURCE_PIXELS = 25_000_000;
const IMAGE_FIT_UNSAFE_PREFLIGHT_MIME = new Set([
  "image/gif",
  "image/heic",
  "image/heif",
]);

type ImageDimensions = {
  width: number;
  height: number;
};

const DEFAULT_INLINE_FETCH_MAX_ATTEMPTS = 3;
const INLINE_FETCH_RETRY_BASE_DELAY_MS = 400;
const INLINE_FETCH_RETRY_MAX_DELAY_MS = 2000;

const INLINE_MEDIA_CACHE_MAX_ENTRIES = 64;
const INLINE_MEDIA_CACHE_TTL_MS = 10 * 60 * 1000;

type InlineCacheEntry = {
  // Stored as a promise so that concurrent callers for the same URL share a
  // single in-flight fetch (single-flight) instead of each downloading it.
  promise: Promise<InlineMediaResult>;
  storedAtMs: number;
};

// Module-level cache. Sub-agents run in the same process (no fork/worker), so
// this is shared across the whole agent tree: a character/scene reference used
// by many storyboard clips and re-sent across many turns is fetched only once.
const inlineMediaCache = new Map<string, InlineCacheEntry>();

function inlineCacheNow(): number {
  // Date.now via a single indirection so the value is easy to reason about;
  // callers never pass time in.
  return Date.now();
}

function readCachedInline(key: string): Promise<InlineMediaResult> | null {
  const entry = inlineMediaCache.get(key);
  if (!entry) return null;
  if (inlineCacheNow() - entry.storedAtMs > INLINE_MEDIA_CACHE_TTL_MS) {
    inlineMediaCache.delete(key);
    return null;
  }
  // Refresh LRU recency.
  inlineMediaCache.delete(key);
  inlineMediaCache.set(key, entry);
  return entry.promise;
}

function storeCachedInline(key: string, promise: Promise<InlineMediaResult>): void {
  inlineMediaCache.set(key, { promise, storedAtMs: inlineCacheNow() });
  while (inlineMediaCache.size > INLINE_MEDIA_CACHE_MAX_ENTRIES) {
    const oldest = inlineMediaCache.keys().next().value;
    if (oldest === undefined) break;
    inlineMediaCache.delete(oldest);
  }
}

/**
 * Test-only: clear the module-level inline cache so cases don't leak into
 * each other. Not part of the runtime contract.
 */
export function __clearInlineMediaCacheForTests(): void {
  inlineMediaCache.clear();
}

/**
 * A fetch error we raised ourselves, tagged with whether retrying could help.
 * Network-level errors thrown by `fetch` itself (ENOTFOUND, socket resets,
 * timeouts) are treated as retryable by default; content-level rejections
 * (bad MIME, oversize, invalid URL) are not.
 */
function markedInlineError(message: string, retryable: boolean): Error {
  const error = new Error(message);
  Object.defineProperty(error, "retryable", { value: retryable, enumerable: false });
  return error;
}

function isRetryableInlineError(error: unknown): boolean {
  if (error && typeof error === "object" && "retryable" in error) {
    return Boolean((error as { retryable?: unknown }).retryable);
  }
  // Errors thrown by fetch/undici (network, DNS, TLS, timeout) reach here
  // untagged — treat as transient and worth another attempt.
  return true;
}

function resolveInlineFetchMaxAttempts(explicit?: number): number {
  const fromEnv = Number(process.env.AGENTS_INLINE_FETCH_MAX_ATTEMPTS);
  const raw = explicit ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? Math.trunc(fromEnv) : DEFAULT_INLINE_FETCH_MAX_ATTEMPTS);
  return Math.max(1, Math.min(5, Math.trunc(raw)));
}

function inlineRetryDelayMs(attemptIndex: number): number {
  const capped = Math.min(
    INLINE_FETCH_RETRY_MAX_DELAY_MS,
    INLINE_FETCH_RETRY_BASE_DELAY_MS * 2 ** attemptIndex,
  );
  return Math.round(capped * (0.5 + Math.random() * 0.5));
}

function sleepUnlessAborted(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(abortSignal.reason instanceof Error ? abortSignal.reason : new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortSignal?.reason instanceof Error ? abortSignal.reason : new Error("aborted"));
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchInlineMediaOnce(input: {
  parsed: URL;
  allowedMimeTypes: Set<string>;
  maxBytes: number;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  label: string;
}): Promise<InlineMediaResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(markedInlineError(`${input.label} inline fetch timed out after ${input.timeoutMs}ms`, true));
  }, input.timeoutMs);
  const abortFromParent = () => {
    controller.abort(input.abortSignal?.reason instanceof Error ? input.abortSignal.reason : undefined);
  };
  if (input.abortSignal) {
    if (input.abortSignal.aborted) abortFromParent();
    else input.abortSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    const res = await fetch(input.parsed.toString(), { signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const retryable = res.status >= 500 || res.status === 429;
      throw markedInlineError(`${input.label} inline fetch failed: HTTP ${res.status} ${truncateText(text, 300)}`, retryable);
    }

    const mimeRaw = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const mimeType = mimeRaw || inferMimeFromUrl(input.parsed.pathname);
    if (!input.allowedMimeTypes.has(mimeType)) {
      throw markedInlineError(`${input.label} inline refused: unsupported MIME ${mimeType || "<unknown>"}`, false);
    }

    const declaredLen = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLen) && declaredLen > input.maxBytes) {
      throw markedInlineError(`${input.label} inline refused: declared size ${declaredLen} exceeds ${input.maxBytes} bytes`, false);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > input.maxBytes) {
      throw markedInlineError(`${input.label} inline refused: actual size ${buffer.length} exceeds ${input.maxBytes} bytes`, false);
    }
    const base64 = buffer.toString("base64");
    return {
      mimeType,
      base64,
      dataUrl: `data:${mimeType};base64,${base64}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown error");
    if (message.startsWith(`${input.label} inline `)) throw error;
    // Wrap raw fetch/network errors; retryable by default (isRetryableInlineError).
    throw markedInlineError(`${input.label} inline fetch failed for ${input.parsed.toString()}: ${message}`, true);
  } finally {
    clearTimeout(timeout);
    input.abortSignal?.removeEventListener("abort", abortFromParent);
  }
}

async function fetchInlineMediaWithRetry(input: {
  parsed: URL;
  allowedMimeTypes: Set<string>;
  maxBytes: number;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  label: string;
  maxAttempts: number;
}): Promise<InlineMediaResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < input.maxAttempts; attempt += 1) {
    if (input.abortSignal?.aborted) {
      throw input.abortSignal.reason instanceof Error ? input.abortSignal.reason : new Error("aborted");
    }
    try {
      return await fetchInlineMediaOnce({
        parsed: input.parsed,
        allowedMimeTypes: input.allowedMimeTypes,
        maxBytes: input.maxBytes,
        timeoutMs: input.timeoutMs,
        abortSignal: input.abortSignal,
        label: input.label,
      });
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === input.maxAttempts - 1;
      if (isLastAttempt || !isRetryableInlineError(error) || input.abortSignal?.aborted) {
        throw error;
      }
      await sleepUnlessAborted(inlineRetryDelayMs(attempt), input.abortSignal);
    }
  }
  // Unreachable: the loop either returns or throws, but satisfy the type checker.
  throw lastError instanceof Error ? lastError : new Error(`${input.label} inline fetch failed`);
}

export async function fetchInlineMediaData(input: {
  rawUrl: string;
  allowedMimeTypes: Set<string>;
  maxBytes: number;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  label: string;
  maxAttempts?: number;
}): Promise<InlineMediaResult> {
  const parsed = parseHttpUrl(input.rawUrl, input.label);
  const maxAttempts = resolveInlineFetchMaxAttempts(input.maxAttempts);

  // Key on URL + limits so a stricter caller can't reuse a looser caller's
  // cached bytes. Allowed-MIME set is stable per call site.
  const allowedKey = Array.from(input.allowedMimeTypes).sort().join(",");
  const cacheKey = `${input.maxBytes}|${allowedKey}|${parsed.toString()}`;

  const cached = readCachedInline(cacheKey);
  if (cached) return cached;

  const promise = fetchInlineMediaWithRetry({
    parsed,
    allowedMimeTypes: input.allowedMimeTypes,
    maxBytes: input.maxBytes,
    timeoutMs: input.timeoutMs,
    abortSignal: input.abortSignal,
    label: input.label,
    maxAttempts,
  });
  // Store the in-flight promise for single-flight dedupe; evict on failure so a
  // transient error is never cached and the next call retries from scratch.
  storeCachedInline(cacheKey, promise);
  promise.catch(() => {
    if (inlineMediaCache.get(cacheKey)?.promise === promise) {
      inlineMediaCache.delete(cacheKey);
    }
  });
  return promise;
}

export async function fitInlineImageToBase64Limit(input: {
  media: InlineMediaResult;
  maxBase64Bytes: number;
  label: string;
}): Promise<InlineMediaResult> {
  if (!Number.isSafeInteger(input.maxBase64Bytes) || input.maxBase64Bytes <= 0) {
    throw new Error(`${input.label} fit failed: maxBase64Bytes must be a positive integer`);
  }
  const currentBytes = Buffer.byteLength(input.media.base64, "ascii");
  if (currentBytes <= input.maxBase64Bytes) return input.media;

  try {
    const normalizedMime = input.media.mimeType.trim().toLowerCase();
    if (IMAGE_FIT_UNSAFE_PREFLIGHT_MIME.has(normalizedMime)) {
      throw new Error(
        `oversized ${normalizedMime} cannot be safely preflighted; convert it to PNG, JPEG, or WebP`,
      );
    }
    const source = Buffer.from(input.media.base64, "base64");
    const encodedDimensions = readEncodedImageDimensions(source, normalizedMime);
    if (!encodedDimensions) {
      throw new Error(
        `could not read ${input.media.mimeType || "image"} dimensions before native decode`,
      );
    }
    const sourcePixels = encodedDimensions.width * encodedDimensions.height;
    if (!Number.isSafeInteger(sourcePixels) || sourcePixels > IMAGE_FIT_MAX_SOURCE_PIXELS) {
      throw new Error(
        `${encodedDimensions.width}x${encodedDimensions.height} exceeds ${IMAGE_FIT_MAX_SOURCE_PIXELS} pixel limit`,
      );
    }

    const canvasModule = await loadCanvasModule();
    const image = await canvasModule.loadImage(source);
    const sourceWidth = normalizeImageDimension(image.width);
    const sourceHeight = normalizeImageDimension(image.height);
    const initialScale = Math.min(
      1,
      IMAGE_FIT_MAX_EDGE / Math.max(sourceWidth, sourceHeight),
    );
    let width = Math.max(1, Math.round(sourceWidth * initialScale));
    let height = Math.max(1, Math.round(sourceHeight * initialScale));
    let lastBase64Bytes = currentBytes;

    for (let attempt = 0; attempt < IMAGE_FIT_MAX_ATTEMPTS; attempt += 1) {
      const canvas = canvasModule.createCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("2d canvas context unavailable");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);

      const jpeg = await canvas.encode("jpeg", IMAGE_FIT_JPEG_QUALITY);
      const base64 = jpeg.toString("base64");
      lastBase64Bytes = Buffer.byteLength(base64, "ascii");
      if (lastBase64Bytes <= input.maxBase64Bytes) {
        return {
          mimeType: "image/jpeg",
          base64,
          dataUrl: `data:image/jpeg;base64,${base64}`,
        };
      }

      if (width === 1 && height === 1) break;
      const observedScale = Math.sqrt(input.maxBase64Bytes / lastBase64Bytes) * 0.9;
      const nextScale = Math.min(0.85, Math.max(0.25, observedScale));
      const nextWidth = Math.max(1, Math.floor(width * nextScale));
      const nextHeight = Math.max(1, Math.floor(height * nextScale));
      width = nextWidth === width && width > 1 ? width - 1 : nextWidth;
      height = nextHeight === height && height > 1 ? height - 1 : nextHeight;
    }

    throw new Error(
      `could not reduce Base64 payload from ${currentBytes} to ${input.maxBase64Bytes} bytes; last attempt was ${lastBase64Bytes} bytes`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown error");
    throw new Error(`${input.label} fit failed: ${message}`);
  }
}

async function loadCanvasModule(): Promise<CanvasModule> {
  const mod = (await import("@napi-rs/canvas")) as unknown as Partial<CanvasModule>;
  if (typeof mod.createCanvas !== "function" || typeof mod.loadImage !== "function") {
    throw new Error("@napi-rs/canvas is unavailable");
  }
  return {
    createCanvas: mod.createCanvas,
    loadImage: mod.loadImage,
  };
}

function normalizeImageDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`invalid image dimension: ${value}`);
  }
  return Math.max(1, Math.floor(value));
}

function readEncodedImageDimensions(buffer: Buffer, mimeType: string): ImageDimensions | null {
  const normalizedMime = mimeType.trim().toLowerCase();
  if (normalizedMime === "image/png") return readPngDimensions(buffer);
  if (normalizedMime === "image/jpeg") return readJpegDimensions(buffer);
  if (normalizedMime === "image/webp") return readWebpDimensions(buffer);
  return null;
}

function validDimensions(width: number, height: number): ImageDimensions | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }
  return validDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
}

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xda || offset + 1 >= buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null;
    if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
      return validDimensions(buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3));
    }
    offset += segmentLength;
  }
  return null;
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function readWebpDimensions(buffer: Buffer): ImageDimensions | null {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }
  const chunkType = buffer.toString("ascii", 12, 16);
  if (chunkType === "VP8X") {
    return validDimensions(
      buffer.readUIntLE(24, 3) + 1,
      buffer.readUIntLE(27, 3) + 1,
    );
  }
  if (chunkType === "VP8L" && buffer[20] === 0x2f) {
    const packed = buffer.readUInt32LE(21);
    return validDimensions((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
  }
  if (
    chunkType === "VP8 " &&
    buffer[23] === 0x9d &&
    buffer[24] === 0x01 &&
    buffer[25] === 0x2a
  ) {
    return validDimensions(buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff);
  }
  return null;
}

export function shouldInlineForCloudModel(rawUrl: string): boolean {
  const mode = String(process.env.AGENTS_INLINE_LOCAL_MEDIA_URLS || "local").trim().toLowerCase();
  if (mode === "0" || mode === "false" || mode === "off" || mode === "never") return false;
  if (mode === "1" || mode === "true" || mode === "on" || mode === "always") return true;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  return isLikelyInternalHost(parsed.hostname);
}

export function isLikelyInternalHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return true;
  if (lower === "metadata.google.internal") return true;
  const family = isIP(lower);
  if (family === 0) return false;
  if (family === 4) {
    if (
      lower.startsWith("10.") ||
      lower.startsWith("127.") ||
      lower.startsWith("169.254.") ||
      lower.startsWith("0.")
    ) {
      return true;
    }
    if (lower.startsWith("192.168.")) return true;
    const m = lower.match(/^172\.(\d+)\./);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  }
  if (family === 6) {
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:")) return true;
  }
  return false;
}

export function inferMimeFromUrl(pathname: string): string {
  const ext = pathname.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!ext) return "";
  switch (ext[1]) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    default:
      return "";
  }
}

function parseHttpUrl(rawUrl: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} inline rejected: invalid URL ${rawUrl}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} inline rejected: only http/https URLs are supported, got ${parsed.protocol}`);
  }
  return parsed;
}

function truncateText(value: string, maxChars: number): string {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
