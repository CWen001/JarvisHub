import path from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { isHostedAssetUrl, uploadToStorageFromUrl } from "../asset/asset.hosting";
import { resolvePublicAssetBaseUrl } from "../asset/asset.publicBase";
import { resolveRustfsConfig } from "../asset/rustfs.client";

type WebStyleReferenceSearchInput = {
	bodyArgs: Record<string, unknown>;
	c?: AppContext;
	requestUserId?: string;
};

type WebStyleSearchSource = "all" | "pinterest" | "dribbble" | "behance" | "design" | "competitors";

type WebStyleSearchResult = {
	id: string;
	title: string;
	pageUrl: string;
	imageUrl: string;
	thumbnailUrl: string;
	originalImageUrl?: string;
	originalThumbnailUrl?: string;
	vendorReferenceImageUrl?: string;
	hosting?: {
		status: "ready" | "skipped" | "failed";
		message?: string;
	};
	width: number | null;
	height: number | null;
	source: string;
	format: string;
	discoveryDate: string;
};

export type WebStyleReferenceSearchResponse = {
	ok: true;
	status: "ok" | "degraded";
	query: string;
	effectiveQuery: string;
	source: WebStyleSearchSource;
	count: number;
	next: string | null;
	results: WebStyleSearchResult[];
	notice: string;
	nextAction?: string;
	providerWarnings?: Array<{
		source: "pinterest";
		code: string;
		message: string;
		details?: unknown;
	}>;
};

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const REQUEST_TIMEOUT_MS = 35_000;
const execFileAsync = promisify(execFile);

type InspireImageSearchResult = {
	title?: unknown;
	pageUrl?: unknown;
	imageUrl?: unknown;
	thumbnailUrl?: unknown;
	width?: unknown;
	height?: unknown;
	source?: unknown;
	format?: unknown;
	discoveryDate?: unknown;
};

type InspireImageSearchPayload = {
	ok?: unknown;
	query?: unknown;
	effectiveQuery?: unknown;
	source?: unknown;
	count?: unknown;
	next?: unknown;
	results?: unknown;
};

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readLimit(value: unknown): number {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric)) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(numeric)));
}

function readSource(value: unknown): WebStyleSearchSource {
	const raw = readTrimmedString(value) || "all";
	if (raw === "all" || raw === "pinterest" || raw === "dribbble" || raw === "behance" || raw === "design" || raw === "competitors") {
		return raw;
	}
	throw new AppError("web_style_reference_search source is invalid", {
		status: 400,
		code: "web_style_reference_search_invalid_args",
		details: { field: "source", got: value },
	});
}

function resolveInspireImageSearchScript(): string {
	const candidates = [
		path.resolve(process.cwd(), "scripts/inspire-image-search.mjs"),
		path.resolve(process.cwd(), "apps/hono-api/scripts/inspire-image-search.mjs"),
		path.resolve(__dirname, "../../../scripts/inspire-image-search.mjs"),
		path.resolve(__dirname, "../../../../scripts/inspire-image-search.mjs"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return candidates[0];
}

function toPinterestSearchSource(source: WebStyleSearchSource): "pinterest" {
	// WebHero style selection should show real visual references. Pinterest is the
	// most reliable source in this runtime and matches the user-facing selection UI.
	void source;
	return "pinterest";
}

function readOptionalNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeSearchResults(items: InspireImageSearchResult[], limit: number): WebStyleSearchResult[] {
	const out: WebStyleSearchResult[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		const imageUrl = readTrimmedString(item.imageUrl);
		const pageUrl = readTrimmedString(item.pageUrl);
		if (!imageUrl || !pageUrl || seen.has(imageUrl)) continue;
		seen.add(imageUrl);
		out.push({
			id: imageUrl,
			title: readTrimmedString(item.title) || readTrimmedString(item.source) || pageUrl,
			pageUrl,
			imageUrl,
			thumbnailUrl: readTrimmedString(item.thumbnailUrl) || imageUrl,
			width: readOptionalNumber(item.width),
			height: readOptionalNumber(item.height),
			source: readTrimmedString(item.source) || "pinterest",
			format: readTrimmedString(item.format) || "image",
			discoveryDate: readTrimmedString(item.discoveryDate) || new Date().toISOString(),
		});
		if (out.length >= limit) break;
	}
	return out;
}

function canPersistStyleReference(input: WebStyleReferenceSearchInput): input is WebStyleReferenceSearchInput & {
	c: AppContext;
	requestUserId: string;
} {
	if (!input.c || !readTrimmedString(input.requestUserId)) return false;
	return Boolean(resolveRustfsConfig(input.c.env));
}

async function persistStyleReferenceResults(input: {
	c: AppContext;
	requestUserId: string;
	results: WebStyleSearchResult[];
}): Promise<WebStyleSearchResult[]> {
	const publicBase = resolvePublicAssetBaseUrl(input.c).trim().replace(/\/+$/, "");
	const storage = resolveRustfsConfig(input.c.env);
	if (!storage || !publicBase) return input.results;

	const persisted: WebStyleSearchResult[] = [];
	for (const result of input.results) {
		if (isHostedAssetUrl(input.c, result.imageUrl)) {
			persisted.push({
				...result,
				thumbnailUrl: isHostedAssetUrl(input.c, result.thumbnailUrl) ? result.thumbnailUrl : result.imageUrl,
				hosting: { status: "skipped", message: "style reference image is already hosted" },
			});
			continue;
		}

		try {
			const uploaded = await uploadToStorageFromUrl({
				c: input.c,
				userId: input.requestUserId,
				sourceUrl: result.imageUrl,
				prefix: "gen/style-references",
				storage: { kind: "rustfs", config: storage },
				publicBase,
			});
			persisted.push({
				...result,
				id: uploaded.url,
				imageUrl: uploaded.url,
				thumbnailUrl: uploaded.url,
				originalImageUrl: result.imageUrl,
				originalThumbnailUrl: result.thumbnailUrl,
				vendorReferenceImageUrl: result.imageUrl,
				hosting: { status: "ready" },
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			persisted.push({
				...result,
				hosting: {
					status: "failed",
					message,
				},
			});
		}
	}
	return persisted;
}

function parseInspireImageSearchPayload(stdout: string): InspireImageSearchPayload {
	const trimmed = stdout.trim();
	if (!trimmed) {
		throw new Error("inspire-image-search returned empty stdout");
	}
	const parsed: unknown = JSON.parse(trimmed);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("inspire-image-search returned non-object JSON");
	}
	return parsed as InspireImageSearchPayload;
}

async function runPinterestInspireImageSearch(input: {
	query: string;
	limit: number;
	source: WebStyleSearchSource;
}): Promise<InspireImageSearchPayload> {
	const scriptSource = toPinterestSearchSource(input.source);
	const scriptPath = resolveInspireImageSearchScript();
	const args = [
		scriptPath,
		input.query,
		"--source",
		scriptSource,
		"--limit",
		String(input.limit),
	];
	const { stdout } = await execFileAsync("node", args, {
		timeout: REQUEST_TIMEOUT_MS + 5_000,
		maxBuffer: 20 * 1024 * 1024,
		env: process.env,
	});
	return parseInspireImageSearchPayload(stdout);
}

export async function searchWebStyleReferences(input: WebStyleReferenceSearchInput): Promise<WebStyleReferenceSearchResponse> {
	const query = readTrimmedString(input.bodyArgs.query);
	if (!query) {
		throw new AppError("web_style_reference_search query is required", {
			status: 400,
			code: "web_style_reference_search_invalid_args",
			details: { field: "query" },
		});
	}
	const source = readSource(input.bodyArgs.source);
	const limit = readLimit(input.bodyArgs.limit);

	try {
		const payload = await runPinterestInspireImageSearch({ query, limit, source });
		const rawResults = Array.isArray(payload.results)
			? (payload.results.filter((item): item is InspireImageSearchResult => Boolean(item && typeof item === "object" && !Array.isArray(item))))
			: [];
		const normalizedResults = normalizeSearchResults(rawResults, limit);
		const resultsWithHosting = canPersistStyleReference(input)
			? await persistStyleReferenceResults({
				c: input.c,
				requestUserId: input.requestUserId,
				results: normalizedResults,
			})
			: normalizedResults;
		const results = canPersistStyleReference(input)
			? resultsWithHosting.filter((item) => item.hosting?.status === "ready" || item.hosting?.status === "skipped")
			: resultsWithHosting;
		const effectiveQuery = readTrimmedString(payload.effectiveQuery) || `${query} site:pinterest.com`;
		if (results.length > 0) {
			return {
				ok: true,
				status: "ok",
				query,
				effectiveQuery,
				source,
				count: results.length,
				next: readTrimmedString(payload.next) || null,
				results,
				notice:
					"这是来自 Pinterest 搜索的真实风格参考图片，不是最终网页资产。请把 5 张结果作为 AI Chat 缩略图候选让用户选择，再进入 WebHero 预览生成。",
			};
		}
		return {
			ok: true,
			status: "degraded",
			query,
			effectiveQuery,
			source,
			count: 0,
			next: readTrimmedString(payload.next) || null,
			results: [],
			notice:
				"Style reference search did not return usable real public reference images. Stop the WebHero workflow here; do not generate fallback style boards or section previews. Fix search/provider/network settings or change query/source before continuing.",
			nextAction: "stop_and_report_style_reference_search_failure",
			providerWarnings: [
				{
					source: "pinterest",
					code: "web_style_reference_search_empty",
					message: "Pinterest inspire-image-search returned no usable image results",
					details: { query, effectiveQuery, script: resolveInspireImageSearchScript() },
				},
			],
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: true,
			status: "degraded",
			query,
			effectiveQuery: `${query} site:pinterest.com`,
			source,
			count: 0,
			next: null,
			results: [],
			notice:
				"Style reference search did not return usable real public reference images. Stop the WebHero workflow here; do not generate fallback style boards or section previews. Fix search/provider/network settings or change query/source before continuing.",
			nextAction: "stop_and_report_style_reference_search_failure",
			providerWarnings: [
				{
					source: "pinterest",
					code: "web_style_reference_search_failed",
					message,
						details: {
							query,
							script: resolveInspireImageSearchScript(),
							errorName: error instanceof Error ? error.name : "UnknownError",
							errorMessage: message,
						},
				},
			],
		};
	}
}
