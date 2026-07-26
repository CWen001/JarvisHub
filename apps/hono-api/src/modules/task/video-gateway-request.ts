import type { TaskRequestDto, TaskStatus } from "./task.schemas";
import { normalizeBaseUrl } from "./task.vendor-utils";

export const VIDEO_GATEWAY_VENDOR_KEY = "video-gateway";
export const DEFAULT_VIDEO_GATEWAY_BASE_URL = "https://video.example.com";
export const SEEDANCE_ARK_VENDOR_KEY = VIDEO_GATEWAY_VENDOR_KEY;

export type VideoGatewayImageContentItem = {
	type: "image_url";
	image_url: {
		url: string;
	};
	role: "reference_image";
};

export type VideoGatewayTextContentItem = {
	type: "text";
	text: string;
};

export type VideoGatewayContentItem =
	| VideoGatewayTextContentItem
	| VideoGatewayImageContentItem;

export type VideoGatewayVideoGenerationRequestBody = {
	model: string;
	content: VideoGatewayContentItem[];
	ratio?: string;
	duration?: number;
	generate_audio?: boolean;
};

const UNSUPPORTED_VIDEO_GATEWAY_VIDEO_FIELDS = [
	"seed",
	"return_last_frame",
	"returnLastFrame",
	"watermark",
] as const;

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function readPositiveNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return Math.trunc(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwnField(source: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(source, key);
}

function isUnsupportedVideoGatewayVideoField(
	source: Record<string, unknown>,
	field: (typeof UNSUPPORTED_VIDEO_GATEWAY_VIDEO_FIELDS)[number],
): boolean {
	if (!hasOwnField(source, field)) return false;
	if (field !== "return_last_frame" && field !== "returnLastFrame") return true;

	const value = source[field];
	return value !== false && value !== null && typeof value !== "undefined";
}

function pushStringValues(target: string[], value: unknown): void {
	const items = Array.isArray(value) ? value : [value];
	for (const item of items) {
		const url = readString(item);
		if (url) target.push(url);
	}
}

function pushAssetInputUrls(target: string[], value: unknown): void {
	if (!Array.isArray(value)) return;
	for (const item of value) {
		if (!isRecord(item)) continue;
		const url = readString(item.url);
		if (url) target.push(url);
	}
}

function uniqueUrls(urls: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const url of urls) {
		const trimmed = url.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

export function normalizeVideoGatewayBaseUrl(raw: string): string {
	const normalized = normalizeBaseUrl(raw || "") || DEFAULT_VIDEO_GATEWAY_BASE_URL;
	const taskPath = "/contents/generations/tasks";
	if (normalized.endsWith(taskPath)) {
		return normalized.slice(0, -taskPath.length);
	}
	if (normalized.endsWith("/api/v3")) return normalized;
	return `${normalized}/api/v3`;
}

export function buildVideoGatewayTaskUrl(input: {
	baseUrl: string;
	taskId?: string | null;
}): string {
	const baseUrl = normalizeVideoGatewayBaseUrl(input.baseUrl);
	const taskId = readString(input.taskId);
	const path = "/contents/generations/tasks";
	return taskId ? `${baseUrl}${path}/${encodeURIComponent(taskId)}` : `${baseUrl}${path}`;
}

export function buildVideoGatewayReferenceImages(
	extras: Record<string, unknown>,
): string[] {
	const urls: string[] = [];
	pushStringValues(urls, extras.referenceImages);
	pushStringValues(urls, extras.reference_images);
	pushStringValues(urls, extras.image_urls);
	pushStringValues(urls, extras.imageUrls);
	pushStringValues(urls, extras.url);
	pushStringValues(urls, extras.urls);
	pushStringValues(urls, extras.image);
	pushStringValues(urls, extras.imageUrl);
	pushAssetInputUrls(urls, extras.assetInputs);
	return uniqueUrls(urls).slice(0, 14);
}
export const buildSeedanceArkReferenceImages = buildVideoGatewayReferenceImages;

export function findUnsupportedVideoGatewayVideoFields(
	extras: Record<string, unknown>,
): string[] {
	return UNSUPPORTED_VIDEO_GATEWAY_VIDEO_FIELDS.filter((field) =>
		isUnsupportedVideoGatewayVideoField(extras, field),
	);
}
export const findUnsupportedSeedanceArkVideoFields = findUnsupportedVideoGatewayVideoFields;

export function buildVideoGatewayVideoGenerationRequestBody(input: {
	model: string;
	prompt: string;
	extras: Record<string, unknown>;
	referenceImages: string[];
}): VideoGatewayVideoGenerationRequestBody {
	const size =
		readString(input.extras.size) ||
		readString(input.extras.aspectRatio) ||
		readString(input.extras.aspect);
	const durationSeconds =
		readPositiveNumber(input.extras.durationSeconds) ??
		readPositiveNumber(input.extras.duration);
	const generateAudio =
		readBoolean(input.extras.generate_audio) ?? readBoolean(input.extras.generateAudio);
	const content: VideoGatewayContentItem[] = [
		{
			type: "text",
			text: input.prompt,
		},
		...input.referenceImages.map((url) => ({
			type: "image_url" as const,
			image_url: { url },
			role: "reference_image" as const,
		})),
	];

	return {
		model: input.model,
		content,
		...(size ? { ratio: size } : {}),
		...(typeof durationSeconds === "number" ? { duration: durationSeconds } : {}),
	...(typeof generateAudio === "boolean" ? { generate_audio: generateAudio } : {}),
	};
}
export const buildSeedanceArkVideoGenerationRequestBody = buildVideoGatewayVideoGenerationRequestBody;

export function normalizeVideoGatewayTaskStatus(value: unknown): TaskStatus | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	if (!normalized) return null;
	if (
		normalized === "queued" ||
		normalized === "pending" ||
		normalized === "submitted" ||
		normalized === "not_start"
	) {
		return "queued";
	}
	if (
		normalized === "running" ||
		normalized === "processing" ||
		normalized === "in_progress" ||
		normalized === "in-progress"
	) {
		return "running";
	}
	if (normalized === "succeeded" || normalized === "success" || normalized === "completed") {
		return "succeeded";
	}
	if (
		normalized === "failed" ||
		normalized === "fail" ||
		normalized === "cancelled" ||
		normalized === "canceled" ||
		normalized === "expired"
	) {
		return "failed";
	}
	return null;
}
export const normalizeSeedanceArkTaskStatus = normalizeVideoGatewayTaskStatus;

function extractVideoUrlFromContent(value: unknown): string {
	if (!value) return "";
	if (Array.isArray(value)) {
		for (const item of value) {
			const url = extractVideoUrlFromContent(item);
			if (url) return url;
		}
		return "";
	}
	if (!isRecord(value)) return "";
	const directUrl = readString(value.url) || readString(value.video_url);
	if (directUrl) return directUrl;
	const nestedVideoUrl = value.video_url;
	if (isRecord(nestedVideoUrl)) {
		const url = readString(nestedVideoUrl.url);
		if (url) return url;
	}
	const nestedOutput = value.output;
	if (isRecord(nestedOutput)) {
		const url = readString(nestedOutput.url) || readString(nestedOutput.video_url);
		if (url) return url;
	}
	return "";
}

export function extractVideoGatewayVideoUrl(payload: unknown): string {
	if (!isRecord(payload)) return "";
	const contentUrl = extractVideoUrlFromContent(payload.content);
	if (contentUrl) return contentUrl;
	const outputUrl = extractVideoUrlFromContent(payload.output);
	if (outputUrl) return outputUrl;
	const resultUrl = extractVideoUrlFromContent(payload.result);
	if (resultUrl) return resultUrl;
	return readString(payload.video_url) || readString(payload.videoUrl);
}
export const extractSeedanceArkVideoUrl = extractVideoGatewayVideoUrl;

export function readVideoGatewayModelFromRequest(req: TaskRequestDto): string {
	const extras = isRecord(req.extras) ? req.extras : {};
	const raw = readString(extras.modelKey);
	return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
}
export const readSeedanceArkModelFromRequest = readVideoGatewayModelFromRequest;
export const buildSeedanceArkTaskUrl = buildVideoGatewayTaskUrl;
