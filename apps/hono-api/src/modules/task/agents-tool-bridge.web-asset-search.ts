import { AppError } from "../../middleware/error";
import { probePngAlpha } from "./webpage-asset-transparency";

type WebAssetSearchKind = "icon" | "image";

type WebAssetSearchInput = {
	bodyArgs: Record<string, unknown>;
};

type IconifyCollectionInfo = {
	name?: string;
	license?: {
		title?: string;
		spdx?: string;
		url?: string;
	};
};

type IconifySearchResponse = {
	icons: string[];
	collections: Record<string, IconifyCollectionInfo>;
	total?: number;
};

type OpenverseImageItem = {
	id?: string;
	title?: string;
	foreign_landing_url?: string;
	url?: string;
	creator?: string;
	creator_url?: string;
	license?: string;
	license_version?: string;
	license_url?: string;
	provider?: string;
	source?: string;
	category?: string;
	filetype?: string;
	width?: number;
	height?: number;
	thumbnail?: string;
	attribution?: string;
};

type OpenverseImageSearchResponse = {
	result_count?: number;
	page_count?: number;
	results: OpenverseImageItem[];
};

type WebAssetIconResult = {
	kind: "icon";
	source: "iconify";
	id: string;
	prefix: string;
	name: string;
	svgUrl: string;
	collectionName: string;
	licenseTitle: string;
	licenseSpdx: string;
	licenseUrl: string;
};

type WebAssetImageResult = {
	kind: "image";
	source: "openverse";
	id: string;
	title: string;
	url: string;
	thumbnail: string;
	landingUrl: string;
	creator: string;
	creatorUrl: string;
	license: string;
	licenseVersion: string;
	licenseUrl: string;
	provider: string;
	assetSource: string;
	category: string;
	filetype: string;
	width: number | null;
	height: number | null;
	attribution: string;
	format: "png" | "jpg" | "jpeg" | "webp" | "gif" | "unknown";
	transparentBackground: "yes" | "no" | "unknown";
	transparencyEvidence: "png-alpha-probed" | "opaque-detected" | "provider-transparent-field" | "format-hint" | "unknown";
	fitScore: number;
};

export type WebAssetSearchResult = WebAssetIconResult | WebAssetImageResult;

type WebAssetProviderWarning = {
	source: "iconify" | "openverse";
	code: string;
	message: string;
	details?: unknown;
};

export type WebAssetSearchResponse = {
	ok: true;
	status: "ok" | "degraded";
	kind: WebAssetSearchKind;
	query: string;
	source: "iconify" | "openverse";
	results: WebAssetSearchResult[];
	total: number;
	notice: string;
	nextAction?: "retry_icon_search" | "generate_image_asset" | "record_empty";
	nextTool?: string;
	nextToolReason?: string;
	providerWarnings?: WebAssetProviderWarning[];
};

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const ICONIFY_SEARCH_LIMIT_MIN = 32;
const WEB_ASSET_SEARCH_TIMEOUT_MS = 4_000;
const WEB_ASSET_ALPHA_PROBE_TIMEOUT_MS = 2_500;
const WEB_ASSET_ALPHA_PROBE_LIMIT = 8;

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readPositiveInteger(value: unknown, fallback: number): number {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(numeric)));
}

function readKind(value: unknown): WebAssetSearchKind {
	if (value === "icon" || value === "image") return value;
	throw new AppError("web_asset_search kind must be icon or image", {
		status: 400,
		code: "web_asset_search_invalid_args",
		details: { field: "kind", got: value },
	});
}

function readAllowedString(value: unknown, allowed: readonly string[], field: string): string {
	const trimmed = readTrimmedString(value);
	if (!trimmed) return "";
	if (allowed.includes(trimmed)) return trimmed;
	throw new AppError(`web_asset_search ${field} is invalid`, {
		status: 400,
		code: "web_asset_search_invalid_args",
		details: { field, got: trimmed, allowed },
	});
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		const text = readTrimmedString(item);
		if (text && !out.includes(text)) out.push(text);
	}
	return out;
}

function readStringRecord(value: unknown): Record<string, unknown> {
	return asRecord(value) ?? {};
}

function readNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function appendOptionalSearchParam(params: URLSearchParams, key: string, value: string): void {
	if (value) params.set(key, value);
}

function readBoolean(value: unknown): boolean {
	if (value === true) return true;
	if (typeof value !== "string") return false;
	const normalized = value.trim().toLowerCase();
	return normalized === "true" || normalized === "1" || normalized === "yes";
}

function inferImageFormat(value: unknown): WebAssetImageResult["format"] {
	const text = readTrimmedString(value).toLowerCase();
	if (text.includes("png")) return "png";
	if (text.includes("jpg")) return "jpg";
	if (text.includes("jpeg")) return "jpeg";
	if (text.includes("webp")) return "webp";
	if (text.includes("gif")) return "gif";
	return "unknown";
}

function inferImageFormatFromUrl(url: string): WebAssetImageResult["format"] {
	try {
		const pathname = new URL(url).pathname.toLowerCase();
		const match = pathname.match(/\.([a-z0-9]+)$/);
		return inferImageFormat(match?.[1]);
	} catch {
		return inferImageFormat(url);
	}
}

function providerWarningFromError(source: "iconify" | "openverse", error: unknown): WebAssetProviderWarning {
	const maybeError = error as { code?: unknown; message?: unknown; details?: unknown };
	return {
		source,
		code: typeof maybeError?.code === "string" ? maybeError.code : "web_asset_search_provider_unavailable",
		message: typeof maybeError?.message === "string" && maybeError.message.trim()
			? maybeError.message
			: "Web asset search provider is unavailable",
		details: maybeError?.details,
	};
}

function degradedSearchResponse(input: {
	kind: WebAssetSearchKind;
	query: string;
	source: "iconify" | "openverse";
	error: unknown;
}): WebAssetSearchResponse {
	const providerWarning = providerWarningFromError(input.source, input.error);
	const warning = {
		source: providerWarning.source,
		code: providerWarning.code,
		message: providerWarning.message,
	};
	if (input.kind === "image") {
		return {
			ok: true,
			status: "degraded",
			kind: input.kind,
			query: input.query,
			source: input.source,
			results: [],
			total: 0,
			notice: "Image search unavailable or empty. Do not retry this image query in the same WebHero run. If the slot is preview-visible and not code_procedural, immediately call canvas_image_generate_to_canvas for that assetId, then record this warning on the asset board.",
			nextAction: "generate_image_asset",
			nextTool: "canvas_image_generate_to_canvas",
			nextToolReason: "public image search degraded; preview-visible image asset still needs a real generated canvas asset",
			providerWarnings: [warning],
		};
	}
	return {
		ok: true,
		status: "degraded",
		kind: input.kind,
		query: input.query,
		source: input.source,
		results: [],
		total: 0,
		notice: "Icon search unavailable or empty. Retry once with a simpler single-icon query/prefix, or record the unavailable icon decision; do not block non-icon image assets.",
		nextAction: "retry_icon_search",
		providerWarnings: [warning],
	};
}

async function fetchJsonWithTimeout(input: { url: string; source: "iconify" | "openverse" }): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), WEB_ASSET_SEARCH_TIMEOUT_MS);
	try {
		const response = await fetch(input.url, {
			method: "GET",
			headers: {
				accept: "application/json",
				"user-agent": "JarvisHub-WebAssetSearch/1.0",
			},
			signal: controller.signal,
		});
		const text = await response.text();
		if (!response.ok) {
			throw new AppError("Web asset search provider returned an error", {
				status: 502,
				code: "web_asset_search_provider_error",
				details: {
					source: input.source,
					status: response.status,
					url: input.url,
					body: text.slice(0, 500),
				},
			});
		}
		try {
			return JSON.parse(text) as unknown;
		} catch (error) {
			throw new AppError("Web asset search provider returned invalid JSON", {
				status: 502,
				code: "web_asset_search_invalid_provider_json",
				details: {
					source: input.source,
					url: input.url,
					error: error instanceof Error ? error.message : String(error),
				},
			});
		}
	} catch (error) {
		if (error instanceof AppError) throw error;
		throw new AppError("Web asset search request failed", {
			status: 502,
			code: "web_asset_search_failed",
			details: {
				source: input.source,
				url: input.url,
				timeoutMs: WEB_ASSET_SEARCH_TIMEOUT_MS,
				errorName: error instanceof Error ? error.name : "UnknownError",
				errorMessage: error instanceof Error ? error.message : String(error),
			},
		});
	} finally {
		clearTimeout(timeout);
	}
}

function parseIconifySearchResponse(value: unknown): IconifySearchResponse {
	const record = asRecord(value);
	const icons = readStringArray(record?.icons);
	if (!record || !Array.isArray(record.icons)) {
		throw new AppError("Iconify search response did not include an icons array", {
			status: 502,
			code: "web_asset_search_invalid_provider_json",
			details: { source: "iconify" },
		});
	}
	const collectionsRaw = readStringRecord(record.collections);
	const collections: Record<string, IconifyCollectionInfo> = {};
	for (const [key, collectionValue] of Object.entries(collectionsRaw)) {
		const collection = asRecord(collectionValue);
		const license = asRecord(collection?.license);
		collections[key] = {
			name: readTrimmedString(collection?.name),
			license: {
				title: readTrimmedString(license?.title),
				spdx: readTrimmedString(license?.spdx),
				url: readTrimmedString(license?.url),
			},
		};
	}
	return {
		icons,
		collections,
		total: readNumber(record.total) ?? icons.length,
	};
}

function iconIdParts(iconId: string): { prefix: string; name: string } | null {
	const separatorIndex = iconId.indexOf(":");
	if (separatorIndex <= 0 || separatorIndex >= iconId.length - 1) return null;
	return {
		prefix: iconId.slice(0, separatorIndex),
		name: iconId.slice(separatorIndex + 1),
	};
}

function toIconResults(response: IconifySearchResponse, limit: number): WebAssetIconResult[] {
	const results: WebAssetIconResult[] = [];
	for (const iconId of response.icons) {
		const parts = iconIdParts(iconId);
		if (!parts) continue;
		const collection = response.collections[parts.prefix] ?? {};
		results.push({
			kind: "icon",
			source: "iconify",
			id: iconId,
			prefix: parts.prefix,
			name: parts.name,
			svgUrl: `https://api.iconify.design/${parts.prefix}/${parts.name}.svg?height=none`,
			collectionName: collection.name ?? "",
			licenseTitle: collection.license?.title ?? "",
			licenseSpdx: collection.license?.spdx ?? "",
			licenseUrl: collection.license?.url ?? "",
		});
		if (results.length >= limit) break;
	}
	return results;
}

function parseOpenverseSearchResponse(value: unknown): OpenverseImageSearchResponse {
	const record = asRecord(value);
	const resultsRaw = Array.isArray(record?.results) ? record.results : [];
	const results: OpenverseImageItem[] = [];
	for (const item of resultsRaw) {
		const entry = asRecord(item);
		if (!entry) continue;
		results.push({
			id: readTrimmedString(entry.id),
			title: readTrimmedString(entry.title),
			foreign_landing_url: readTrimmedString(entry.foreign_landing_url),
			url: readTrimmedString(entry.url),
			creator: readTrimmedString(entry.creator),
			creator_url: readTrimmedString(entry.creator_url),
			license: readTrimmedString(entry.license),
			license_version: readTrimmedString(entry.license_version),
			license_url: readTrimmedString(entry.license_url),
			provider: readTrimmedString(entry.provider),
			source: readTrimmedString(entry.source),
			category: readTrimmedString(entry.category),
			filetype: readTrimmedString(entry.filetype),
			width: readNumber(entry.width) ?? undefined,
			height: readNumber(entry.height) ?? undefined,
			thumbnail: readTrimmedString(entry.thumbnail),
			attribution: readTrimmedString(entry.attribution),
		});
	}
	if (!record || !Array.isArray(record.results)) {
		throw new AppError("Openverse search response did not include results", {
			status: 502,
			code: "web_asset_search_invalid_provider_json",
			details: { source: "openverse" },
		});
	}
	return {
		result_count: readNumber(record.result_count) ?? results.length,
		page_count: readNumber(record.page_count) ?? undefined,
		results,
	};
}

function toImageResults(response: OpenverseImageSearchResponse, limit: number): WebAssetImageResult[] {
	const results: WebAssetImageResult[] = [];
	for (const item of response.results) {
		const url = readTrimmedString(item.url);
		if (!url) continue;
		const format = inferImageFormat(item.filetype) === "unknown"
			? inferImageFormatFromUrl(url)
			: inferImageFormat(item.filetype);
		results.push({
			kind: "image",
			source: "openverse",
			id: readTrimmedString(item.id),
			title: readTrimmedString(item.title),
			url,
			thumbnail: readTrimmedString(item.thumbnail),
			landingUrl: readTrimmedString(item.foreign_landing_url),
			creator: readTrimmedString(item.creator),
			creatorUrl: readTrimmedString(item.creator_url),
			license: readTrimmedString(item.license),
			licenseVersion: readTrimmedString(item.license_version),
			licenseUrl: readTrimmedString(item.license_url),
			provider: readTrimmedString(item.provider),
			assetSource: readTrimmedString(item.source),
			category: readTrimmedString(item.category),
			filetype: readTrimmedString(item.filetype),
			width: readNumber(item.width),
			height: readNumber(item.height),
			attribution: readTrimmedString(item.attribution),
			format,
			transparentBackground: "unknown",
			transparencyEvidence: format === "png" ? "format-hint" : "unknown",
			fitScore: format === "png" ? 20 : 0,
		});
		if (results.length >= limit) break;
	}
	return results;
}

async function addTransparencyEvidence(
	results: WebAssetImageResult[],
	requireTransparent: boolean,
): Promise<WebAssetImageResult[]> {
	const probed = await Promise.all(results.map(async (result, index) => {
		if (result.format !== "png" || index >= WEB_ASSET_ALPHA_PROBE_LIMIT) return result;
		const alpha = await probePngAlpha(result.url, { timeoutMs: WEB_ASSET_ALPHA_PROBE_TIMEOUT_MS });
		if (alpha.status === "alpha") {
			return {
				...result,
				transparentBackground: "yes" as const,
				transparencyEvidence: "png-alpha-probed" as const,
				fitScore: result.fitScore + 80,
			};
		}
		if (alpha.status === "opaque") {
			return {
				...result,
				transparentBackground: "no" as const,
				transparencyEvidence: "opaque-detected" as const,
				fitScore: result.fitScore - (requireTransparent ? 80 : 10),
			};
		}
		return result;
	}));
	return probed.sort((a, b) => b.fitScore - a.fitScore);
}

async function searchIcons(input: { query: string; limit: number; prefix: string }): Promise<WebAssetSearchResponse> {
	const params = new URLSearchParams();
	params.set("query", input.query);
	params.set("limit", String(Math.max(ICONIFY_SEARCH_LIMIT_MIN, input.limit)));
	appendOptionalSearchParam(params, "prefixes", input.prefix);
	const url = `https://api.iconify.design/search?${params.toString()}`;
	let parsed: IconifySearchResponse;
	try {
		parsed = parseIconifySearchResponse(await fetchJsonWithTimeout({ url, source: "iconify" }));
	} catch (error) {
		return degradedSearchResponse({
			kind: "icon",
			query: input.query,
			source: "iconify",
			error,
		});
	}
	const results = toIconResults(parsed, input.limit);
	return {
		ok: true,
		status: "ok",
		kind: "icon",
		query: input.query,
		source: "iconify",
		results,
		total: parsed.total ?? results.length,
		notice: "Icon results are open-source Iconify icons. Use svgUrl or CSS mask/background-image instead of hand-writing SVG paths.",
	};
}

async function searchImages(input: {
	query: string;
	limit: number;
	licenseType: string;
	aspectRatio: string;
	size: string;
	requireTransparent: boolean;
	preferTransparent: boolean;
	format: string;
}): Promise<WebAssetSearchResponse> {
	const params = new URLSearchParams();
	const transparentQuery = (input.requireTransparent || input.preferTransparent) &&
		!/\b(png|transparent|cutout|isolated)\b/i.test(input.query)
		? `${input.query} transparent png cutout isolated`
		: input.query;
	params.set("q", transparentQuery);
	params.set("page_size", String(Math.max(input.limit, input.requireTransparent || input.preferTransparent ? WEB_ASSET_ALPHA_PROBE_LIMIT : input.limit)));
	params.set("page", "1");
	params.set("mature", "false");
	params.set("filter_dead", "true");
	appendOptionalSearchParam(params, "license_type", input.licenseType);
	appendOptionalSearchParam(params, "aspect_ratio", input.aspectRatio);
	appendOptionalSearchParam(params, "size", input.size);
	appendOptionalSearchParam(params, "extension", input.format);
	const url = `https://api.openverse.org/v1/images/?${params.toString()}`;
	let parsed: OpenverseImageSearchResponse;
	try {
		parsed = parseOpenverseSearchResponse(await fetchJsonWithTimeout({ url, source: "openverse" }));
	} catch (error) {
		return degradedSearchResponse({
			kind: "image",
			query: input.query,
			source: "openverse",
			error,
		});
	}
	const results = (await addTransparencyEvidence(toImageResults(parsed, Math.max(input.limit, WEB_ASSET_ALPHA_PROBE_LIMIT)), input.requireTransparent))
		.filter((item) => !input.requireTransparent || item.transparentBackground === "yes")
		.slice(0, input.limit);
	const status = input.requireTransparent && results.length === 0 ? "degraded" : "ok";
	return {
		ok: true,
		status,
		kind: "image",
		query: input.query,
		source: "openverse",
		results,
		total: parsed.result_count ?? results.length,
		notice: status === "degraded"
			? "No PNG result with alpha transparency was verified. If this slot needs transparent foreground/cutout placement, immediately generate a custom transparent webpage asset with canvas_image_generate_to_canvas for the same assetId."
			: "Image results come from Openverse. Verify license, attribution, crop, and visual fit before using them in WebHero code. For transparent placement, prefer candidates with transparentBackground=yes and transparencyEvidence=png-alpha-probed.",
		...(status === "degraded"
			? {
				nextAction: "generate_image_asset" as const,
				nextTool: "canvas_image_generate_to_canvas",
				nextToolReason: "transparent PNG search did not produce a verified alpha candidate",
			}
			: {}),
	};
}

export async function searchWebAssets(input: WebAssetSearchInput): Promise<WebAssetSearchResponse> {
	const kind = readKind(input.bodyArgs.kind);
	const query = readTrimmedString(input.bodyArgs.query);
	if (!query) {
		throw new AppError("web_asset_search query is required", {
			status: 400,
			code: "web_asset_search_invalid_args",
			details: { field: "query" },
		});
	}
	const limit = readPositiveInteger(input.bodyArgs.limit, DEFAULT_LIMIT);
	if (kind === "icon") {
		return await searchIcons({
			query,
			limit,
			prefix: readTrimmedString(input.bodyArgs.prefix),
		});
	}
	return await searchImages({
		query,
		limit,
		licenseType: readAllowedString(input.bodyArgs.licenseType, ["all", "all-cc", "commercial", "modification"], "licenseType"),
		aspectRatio: readAllowedString(input.bodyArgs.aspectRatio, ["tall", "wide", "square"], "aspectRatio"),
		size: readAllowedString(input.bodyArgs.size, ["small", "medium", "large"], "size"),
		requireTransparent: readBoolean(input.bodyArgs.requireTransparent),
		preferTransparent: readBoolean(input.bodyArgs.preferTransparent),
		format: readAllowedString(input.bodyArgs.format, ["png", "jpg", "jpeg", "webp", "gif"], "format"),
	});
}
