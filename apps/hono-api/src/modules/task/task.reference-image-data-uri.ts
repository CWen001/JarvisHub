import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { decodeBase64ToBytes } from "./task.inline-asset-utils";
import { isSupportedImageMimeType, normalizeMimeType } from "./task.mime";

const DEFAULT_MAX_BYTES_PER_IMAGE = 8 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 3_000;

const CACHE_MAX_ENTRIES = 64;
const CACHE_TTL_MS = 10 * 60 * 1000;

type DownloadedReference = { dataUri: string; byteLength: number };

type ReferenceCacheEntry = {
	// Stored as a promise so concurrent downloads of the same URL share a single
	// in-flight fetch (single-flight) rather than each hitting the slow CDN.
	promise: Promise<DownloadedReference>;
	storedAtMs: number;
};

// Module-level cache, shared across requests in this process. Storyboard fan-out
// re-uses the same character/scene reference URLs across many clips; without this
// each clip re-downloads the same multi-MB image from a rate-limited public CDN.
const referenceDownloadCache = new Map<string, ReferenceCacheEntry>();

function readCachedReference(key: string): Promise<DownloadedReference> | null {
	const entry = referenceDownloadCache.get(key);
	if (!entry) return null;
	if (Date.now() - entry.storedAtMs > CACHE_TTL_MS) {
		referenceDownloadCache.delete(key);
		return null;
	}
	// Refresh LRU recency.
	referenceDownloadCache.delete(key);
	referenceDownloadCache.set(key, entry);
	return entry.promise;
}

function storeCachedReference(key: string, promise: Promise<DownloadedReference>): void {
	referenceDownloadCache.set(key, { promise, storedAtMs: Date.now() });
	while (referenceDownloadCache.size > CACHE_MAX_ENTRIES) {
		const oldest = referenceDownloadCache.keys().next().value;
		if (oldest === undefined) break;
		referenceDownloadCache.delete(oldest);
	}
}

/** Test-only: clear the module-level reference cache between cases. */
export function __clearReferenceDownloadCacheForTests(): void {
	referenceDownloadCache.clear();
}

function isRetryableReferenceError(error: unknown): boolean {
	if (error instanceof AppError) {
		const code = error.code;
		// Transient transport failures: timeout, or a fetch that never got an HTTP
		// status (DNS/socket). Content errors (too_large / invalid MIME / bad URL)
		// use distinct codes and are never retried.
		if (code === "reference_image_fetch_timeout") return true;
		if (code === "reference_image_fetch_failed") {
			const upstream = (error.details as { upstreamStatus?: unknown } | undefined)
				?.upstreamStatus;
			// A concrete upstream HTTP status means the server responded: only 5xx is
			// worth retrying. Any non-5xx (incl. 3xx redirects, 4xx) is deterministic.
			if (typeof upstream === "number") return upstream >= 500;
			// No upstream status → raw transport error → transient, retry.
			return true;
		}
		return false;
	}
	// Raw transport error (AbortError/TypeError from fetch) — transient, retry.
	return true;
}

function retryDelayMs(attemptIndex: number): number {
	const capped = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attemptIndex);
	return Math.round(capped * (0.5 + Math.random() * 0.5));
}

function sleep(delayMs: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, delayMs);
		(timer as unknown as { unref?: () => void })?.unref?.();
	});
}

export type InlineReferenceImagesOptions = {
	maxBytesPerImage?: number;
	maxTotalBytes?: number;
	timeoutMs?: number;
	maxAttempts?: number;
	logTag?: string;
};

function positiveInteger(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.max(1, Math.floor(value))
		: fallback;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x2000;
	for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}

function estimateDecodedBase64Bytes(base64: string): number | null {
	if (!base64 || !/^[a-z0-9+/]*={0,2}$/i.test(base64)) return null;
	const firstPadding = base64.indexOf("=");
	if (firstPadding >= 0 && firstPadding < base64.length - 2) return null;
	const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
	if (padding > 0 && base64.length % 4 !== 0) return null;
	if (base64.length % 4 === 1) return null;
	return Math.floor((base64.length * 3) / 4) - padding;
}

function abortError(): Error {
	const error = new Error("aborted");
	error.name = "AbortError";
	return error;
}

async function readStreamChunk(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
	if (signal.aborted) throw abortError();
	return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
		const onAbort = () => reject(abortError());
		signal.addEventListener("abort", onAbort, { once: true });
		reader.read().then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", onAbort);
		});
	});
}

function invalidReferenceImage(
	message: string,
	referenceIndex: number,
	details: Record<string, unknown> = {},
): AppError {
	return new AppError(message, {
		status: 400,
		code: "invalid_reference_image",
		details: { referenceIndex, ...details },
	});
}

function assertImageSize(input: {
	referenceIndex: number;
	contentLength: number;
	maxBytes: number;
}): void {
	if (input.contentLength <= input.maxBytes) return;
	throw new AppError("参考图过大，无法发送到上游", {
		status: 400,
		code: "reference_image_too_large",
		details: input,
	});
}

function assertTotalImageSize(input: {
	referenceIndex: number;
	contentLength: number;
	maxBytes: number;
}): void {
	if (input.contentLength <= input.maxBytes) return;
	throw new AppError("参考图总大小超过限制", {
		status: 400,
		code: "reference_images_total_too_large",
		details: input,
	});
}

function normalizeInlineDataUri(input: {
	reference: string;
	referenceIndex: number;
	maxBytesPerImage: number;
}): { dataUri: string; byteLength: number } | null {
	const match = input.reference.match(/^data:([^;,]+);base64,([\s\S]*)$/i);
	if (!match) return null;

	const mimeType = normalizeMimeType(match[1]);
	if (!isSupportedImageMimeType(mimeType)) {
		throw invalidReferenceImage("参考图格式不受支持", input.referenceIndex, {
			contentType: mimeType || null,
		});
	}

	const base64 = String(match[2] || "").replace(/\s+/g, "");
	if (!base64) {
		throw invalidReferenceImage("参考图 data URI 为空", input.referenceIndex, {
			contentType: mimeType,
		});
	}
	const estimatedBytes = estimateDecodedBase64Bytes(base64);
	if (estimatedBytes === null) {
		throw invalidReferenceImage("参考图 base64 无法解码", input.referenceIndex, {
			contentType: mimeType,
		});
	}
	assertImageSize({
		referenceIndex: input.referenceIndex,
		contentLength: estimatedBytes,
		maxBytes: input.maxBytesPerImage,
	});

	let bytes: Uint8Array;
	try {
		bytes = decodeBase64ToBytes(base64);
	} catch {
		throw invalidReferenceImage("参考图 base64 无法解码", input.referenceIndex, {
			contentType: mimeType,
		});
	}
	assertImageSize({
		referenceIndex: input.referenceIndex,
		contentLength: bytes.byteLength,
		maxBytes: input.maxBytesPerImage,
	});

	return {
		dataUri: `data:${mimeType};base64,${base64}`,
		byteLength: bytes.byteLength,
	};
}

async function downloadReferenceImageOnce(input: {
	c: AppContext;
	reference: string;
	referenceIndex: number;
	maxBytesPerImage: number;
	timeoutMs: number;
	logTag: string;
}): Promise<{ dataUri: string; byteLength: number }> {
	if (!/^https?:\/\//i.test(input.reference)) {
		throw invalidReferenceImage(
			"参考图必须为 HTTP(S) URL 或 data:image/*;base64",
			input.referenceIndex,
		);
	}

	const controller = new AbortController();
	let bodyReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	let timeoutTriggered = false;
	const timeout = setTimeout(() => {
		timeoutTriggered = true;
		controller.abort();
		void bodyReader?.cancel().catch(() => undefined);
	}, input.timeoutMs);
	(timeout as any)?.unref?.();

	try {
		const response = await fetchWithHttpDebugLog(
			input.c,
			input.reference,
			{
				method: "GET",
				headers: { Accept: "image/png,image/jpeg,image/webp" },
				redirect: "manual",
				signal: controller.signal,
			},
			{ tag: input.logTag },
		);
		if (!response.ok) {
			throw new AppError(`参考图下载失败: ${response.status}`, {
				status: 502,
				code: "reference_image_fetch_failed",
				details: {
					referenceIndex: input.referenceIndex,
					upstreamStatus: response.status,
				},
			});
		}

		const contentType = normalizeMimeType(response.headers.get("content-type"));
		if (!isSupportedImageMimeType(contentType)) {
			throw invalidReferenceImage("参考图格式不受支持", input.referenceIndex, {
				contentType: contentType || null,
			});
		}

		const contentLengthHeader = response.headers.get("content-length");
		const declaredLength =
			typeof contentLengthHeader === "string" && /^\d+$/.test(contentLengthHeader)
				? Number(contentLengthHeader)
				: null;
			if (typeof declaredLength === "number" && Number.isFinite(declaredLength)) {
				if (declaredLength > input.maxBytesPerImage) {
					controller.abort();
					void response.body?.cancel().catch(() => undefined);
				}
				assertImageSize({
				referenceIndex: input.referenceIndex,
				contentLength: declaredLength,
				maxBytes: input.maxBytesPerImage,
				});
			}

			const chunks: Uint8Array[] = [];
			let byteLength = 0;
			bodyReader = response.body?.getReader() ?? null;
			if (bodyReader) {
				while (true) {
					const { value, done } = await readStreamChunk(bodyReader, controller.signal);
					if (done) break;
					if (!value || value.byteLength === 0) continue;
					byteLength += value.byteLength;
					if (byteLength > input.maxBytesPerImage) {
						controller.abort();
						void bodyReader.cancel().catch(() => undefined);
						assertImageSize({
							referenceIndex: input.referenceIndex,
							contentLength: byteLength,
							maxBytes: input.maxBytesPerImage,
						});
					}
					chunks.push(value);
				}
				bodyReader.releaseLock();
				bodyReader = null;
			}
			const bytes = new Uint8Array(byteLength);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return {
				dataUri: `data:${contentType};base64,${bytesToBase64(bytes)}`,
				byteLength,
			};
	} catch (error: any) {
		if (error instanceof AppError) throw error;
		const timedOut = timeoutTriggered || error?.name === "AbortError";
		throw new AppError(timedOut ? "参考图下载超时" : "参考图下载失败", {
			status: timedOut ? 504 : 502,
			code: timedOut
				? "reference_image_fetch_timeout"
				: "reference_image_fetch_failed",
				details: {
					referenceIndex: input.referenceIndex,
				},
			});
	} finally {
		clearTimeout(timeout);
	}
}

async function downloadReferenceImageWithRetry(input: {
	c: AppContext;
	reference: string;
	referenceIndex: number;
	maxBytesPerImage: number;
	timeoutMs: number;
	maxAttempts: number;
	logTag: string;
}): Promise<DownloadedReference> {
	let lastError: unknown;
	for (let attempt = 0; attempt < input.maxAttempts; attempt += 1) {
		try {
			return await downloadReferenceImageOnce({
				c: input.c,
				reference: input.reference,
				referenceIndex: input.referenceIndex,
				maxBytesPerImage: input.maxBytesPerImage,
				timeoutMs: input.timeoutMs,
				logTag: input.logTag,
			});
		} catch (error) {
			lastError = error;
			const isLastAttempt = attempt === input.maxAttempts - 1;
			if (isLastAttempt || !isRetryableReferenceError(error)) throw error;
			await sleep(retryDelayMs(attempt));
		}
	}
	throw lastError instanceof Error
		? lastError
		: new AppError("参考图下载失败", {
				status: 502,
				code: "reference_image_fetch_failed",
				details: { referenceIndex: input.referenceIndex },
			});
}

function downloadReferenceImage(input: {
	c: AppContext;
	reference: string;
	referenceIndex: number;
	maxBytesPerImage: number;
	timeoutMs: number;
	maxAttempts: number;
	logTag: string;
}): Promise<DownloadedReference> {
	// Key on URL + size limit so a stricter caller can't reuse looser cached bytes.
	const cacheKey = `${input.maxBytesPerImage}|${input.reference}`;
	const cached = readCachedReference(cacheKey);
	if (cached) return cached;

	const promise = downloadReferenceImageWithRetry(input);
	// Single-flight: store the in-flight promise; evict on failure so a transient
	// error is never cached and the next request retries from scratch.
	storeCachedReference(cacheKey, promise);
	promise.catch(() => {
		if (referenceDownloadCache.get(cacheKey)?.promise === promise) {
			referenceDownloadCache.delete(cacheKey);
		}
	});
	return promise;
}

export async function inlineReferenceImagesAsDataUris(
	c: AppContext,
	references: string[],
	options: InlineReferenceImagesOptions = {},
): Promise<string[]> {
	const maxBytesPerImage = positiveInteger(
		options.maxBytesPerImage,
		DEFAULT_MAX_BYTES_PER_IMAGE,
	);
	const maxTotalBytes = positiveInteger(options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES);
	const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
	const maxAttempts = Math.max(
		1,
		Math.min(5, positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS)),
	);
	const logTag = options.logTag?.trim() || "task:reference-image-fetch";
	const output: string[] = [];
	let totalBytes = 0;

	for (const [referenceIndex, rawReference] of references.entries()) {
		const reference = String(rawReference || "").trim();
		if (!reference) {
			throw invalidReferenceImage("参考图为空", referenceIndex);
		}

		const resolved =
			normalizeInlineDataUri({ reference, referenceIndex, maxBytesPerImage }) ??
			(await downloadReferenceImage({
				c,
				reference,
				referenceIndex,
				maxBytesPerImage,
				timeoutMs,
				maxAttempts,
				logTag,
			}));
		totalBytes += resolved.byteLength;
		assertTotalImageSize({
			referenceIndex,
			contentLength: totalBytes,
			maxBytes: maxTotalBytes,
		});
		output.push(resolved.dataUri);
	}

	return output;
}
