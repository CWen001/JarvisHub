import { AppError } from "../../middleware/error";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import type { AppContext } from "../../types";
import { listAssetsForUser, type AssetRow } from "./asset.repo";
import {
	createStoredZipStream,
	ensureUniqueZipPath,
	sanitizeZipPathPart,
	type ZipEntrySource,
} from "./asset-zip";

export type AssetZipMediaType = "image" | "video" | "audio" | "text" | "html";
export type AssetZipKind = "all" | AssetZipMediaType;

export type NormalizedExportAsset = {
	assetId?: string;
	nodeId?: string;
	label: string;
	mediaType: AssetZipMediaType;
	url?: string;
	text?: string;
	html?: string;
	source?: string;
};

type ManifestItem = {
	status: "ok" | "failed";
	path?: string;
	label: string;
	mediaType: AssetZipMediaType;
	url?: string;
	source?: string;
	byteLength?: number;
	error?: string;
};

const DEFAULT_MAX_ASSETS = 5000;
const HARD_MAX_ASSETS = 5000;
const ASSET_EXPORT_PAGE_SIZE = 200;
const MAX_SINGLE_FILE_BYTES = 1024 * 1024 * 1024;

const textEncoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeKind(raw: unknown): AssetZipKind {
	const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (
		value === "image" ||
		value === "video" ||
		value === "audio" ||
		value === "text" ||
		value === "html"
	) {
		return value;
	}
	if (value === "web" || value === "webpage") return "html";
	return "all";
}

function normalizeMediaType(raw: unknown): AssetZipMediaType | null {
	const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (
		value === "image" ||
		value === "video" ||
		value === "audio" ||
		value === "text" ||
		value === "html"
	) {
		return value;
	}
	if (value === "web" || value === "webpage") return "html";
	return null;
}

function normalizeString(raw: unknown): string {
	return typeof raw === "string" ? raw.trim() : "";
}

function shouldKeepAsset(asset: NormalizedExportAsset, kind: AssetZipKind): boolean {
	return kind === "all" || asset.mediaType === kind;
}

function extensionFromContentType(contentType: string, mediaType: AssetZipMediaType): string {
	const type = contentType.split(";")[0]?.trim().toLowerCase() || "";
	const known: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/webp": "webp",
		"image/gif": "gif",
		"image/avif": "avif",
		"video/mp4": "mp4",
		"video/webm": "webm",
		"video/quicktime": "mov",
		"audio/mpeg": "mp3",
		"audio/mp3": "mp3",
		"audio/wav": "wav",
		"text/plain": "txt",
		"text/html": "html",
	};
	if (known[type]) return known[type];
	if (type.includes("/")) {
		const ext = type.split("/")[1]?.replace(/[^a-z0-9]+/g, "") || "";
		if (ext) return ext === "jpeg" ? "jpg" : ext;
	}
	if (mediaType === "image") return "png";
	if (mediaType === "video") return "mp4";
	if (mediaType === "audio") return "mp3";
	if (mediaType === "html") return "html";
	return "txt";
}

function extensionFromUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		const last = parsed.pathname.split("/").filter(Boolean).pop() || "";
		const dot = last.lastIndexOf(".");
		if (dot <= 0 || dot === last.length - 1) return null;
		const ext = last.slice(dot + 1).toLowerCase();
		return /^[a-z0-9]{1,8}$/.test(ext) ? ext : null;
	} catch {
		return null;
	}
}

function folderForMediaType(mediaType: AssetZipMediaType): string {
	if (mediaType === "image") return "images";
	if (mediaType === "video") return "videos";
	if (mediaType === "audio") return "audio";
	if (mediaType === "html") return "web";
	return "texts";
}

function defaultExtension(mediaType: AssetZipMediaType): string {
	if (mediaType === "image") return "png";
	if (mediaType === "video") return "mp4";
	if (mediaType === "audio") return "mp3";
	if (mediaType === "html") return "html";
	return "txt";
}

function buildBaseFilename(label: string, fallback: string): string {
	return sanitizeZipPathPart(label || fallback).replace(/\.[a-z0-9]{1,8}$/i, "");
}

function buildZipPath(input: {
	asset: NormalizedExportAsset;
	extension: string;
	usedPaths: Map<string, number>;
}): string {
	const folder = folderForMediaType(input.asset.mediaType);
	const base = buildBaseFilename(input.asset.label, input.asset.mediaType);
	return ensureUniqueZipPath(`${folder}/${base}.${input.extension}`, input.usedPaths);
}

function makeFilename(scope: "canvas" | "all"): string {
	const now = new Date();
	const stamp =
		`${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}` +
		`-${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}`;
	return scope === "canvas" ? `canvas-assets-${stamp}.zip` : `all-assets-${stamp}.zip`;
}

function readExplicitText(record: Record<string, unknown>): string {
	return normalizeString(record.text) || normalizeString(record.content);
}

function readExplicitHtml(record: Record<string, unknown>): string {
	return normalizeString(record.webHeroDocumentHtml) || normalizeString(record.documentHtml);
}

function pushUrlAsset(
	out: NormalizedExportAsset[],
	seen: Set<string>,
	input: {
		assetId?: string;
		nodeId?: string;
		label: string;
		mediaType: AssetZipMediaType;
		url: unknown;
		source: string;
	},
): void {
	const url = normalizeString(input.url);
	if (!url) return;
	const key = `${input.mediaType}:url:${url}`;
	if (seen.has(key)) return;
	seen.add(key);
	out.push({
		assetId: input.assetId,
		nodeId: input.nodeId,
		label: input.label,
		mediaType: input.mediaType,
		url,
		source: input.source,
	});
}

function pushInlineAsset(
	out: NormalizedExportAsset[],
	seen: Set<string>,
	input: {
		assetId?: string;
		nodeId?: string;
		label: string;
		mediaType: "text" | "html";
		value: unknown;
		source: string;
	},
): void {
	const value = normalizeString(input.value);
	if (!value) return;
	const key = `${input.mediaType}:inline:${value}`;
	if (seen.has(key)) return;
	seen.add(key);
	out.push({
		assetId: input.assetId,
		nodeId: input.nodeId,
		label: input.label,
		mediaType: input.mediaType,
		...(input.mediaType === "html" ? { html: value } : { text: value }),
		source: input.source,
	});
}

export function normalizeCanvasZipAssets(input: unknown): NormalizedExportAsset[] {
	const rows = Array.isArray(input) ? input : [];
	const out: NormalizedExportAsset[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		if (!isRecord(row)) continue;
		const mediaType = normalizeMediaType(row.mediaType);
		if (!mediaType) continue;
		const label =
			normalizeString(row.label) ||
			normalizeString(row.nodeId) ||
			normalizeString(row.assetId) ||
			mediaType;
		if (mediaType === "text") {
			pushInlineAsset(out, seen, {
				assetId: normalizeString(row.assetId) || undefined,
				nodeId: normalizeString(row.nodeId) || undefined,
				label,
				mediaType,
				value: row.text,
				source: normalizeString(row.source) || "canvas",
			});
			continue;
		}
		if (mediaType === "html") {
			pushInlineAsset(out, seen, {
				assetId: normalizeString(row.assetId) || undefined,
				nodeId: normalizeString(row.nodeId) || undefined,
				label,
				mediaType,
				value: row.html,
				source: normalizeString(row.source) || "canvas",
			});
			continue;
		}
		pushUrlAsset(out, seen, {
			assetId: normalizeString(row.assetId) || undefined,
			nodeId: normalizeString(row.nodeId) || undefined,
			label,
			mediaType,
			url: row.url,
			source: normalizeString(row.source) || "canvas",
		});
	}
	return out;
}

export function extractExportAssetsFromAssetRow(row: AssetRow): NormalizedExportAsset[] {
	if (!row.data) return [];
	let data: unknown;
	try {
		data = JSON.parse(row.data);
	} catch {
		return [];
	}
	if (!isRecord(data)) return [];

	const out: NormalizedExportAsset[] = [];
	const seen = new Set<string>();
	const label = row.name || normalizeString(data.label) || normalizeString(data.prompt) || row.id;
	const explicitMedia = normalizeMediaType(data.type) || normalizeMediaType(data.kind);

	pushUrlAsset(out, seen, {
		assetId: row.id,
		label,
		mediaType: explicitMedia && explicitMedia !== "text" && explicitMedia !== "html" ? explicitMedia : "image",
		url: data.url,
		source: "data.url",
	});
	pushUrlAsset(out, seen, {
		assetId: row.id,
		label,
		mediaType: "image",
		url: data.imageUrl,
		source: "data.imageUrl",
	});
	pushUrlAsset(out, seen, {
		assetId: row.id,
		label,
		mediaType: "video",
		url: data.videoUrl,
		source: "data.videoUrl",
	});
	pushUrlAsset(out, seen, {
		assetId: row.id,
		label,
		mediaType: "audio",
		url: data.audioUrl,
		source: "data.audioUrl",
	});

	const imageResults = Array.isArray(data.imageResults) ? data.imageResults : [];
	imageResults.forEach((item, index) => {
		if (!isRecord(item)) return;
		pushUrlAsset(out, seen, {
			assetId: row.id,
			label,
			mediaType: "image",
			url: item.url,
			source: `data.imageResults[${index}].url`,
		});
	});

	const videoResults = Array.isArray(data.videoResults) ? data.videoResults : [];
	videoResults.forEach((item, index) => {
		if (!isRecord(item)) return;
		pushUrlAsset(out, seen, {
			assetId: row.id,
			label,
			mediaType: "video",
			url: item.url,
			source: `data.videoResults[${index}].url`,
		});
	});

	const audioResults = Array.isArray(data.audioResults) ? data.audioResults : [];
	audioResults.forEach((item, index) => {
		if (!isRecord(item)) return;
		pushUrlAsset(out, seen, {
			assetId: row.id,
			label,
			mediaType: "audio",
			url: item.url,
			source: `data.audioResults[${index}].url`,
		});
	});

	for (const arrayKey of ["assets", "outputs"] as const) {
		const list = Array.isArray(data[arrayKey]) ? data[arrayKey] : [];
		list.forEach((item, index) => {
			if (!isRecord(item)) return;
			const itemType = normalizeMediaType(item.type) || explicitMedia || "image";
			if (itemType === "text" || itemType === "html") return;
			pushUrlAsset(out, seen, {
				assetId: row.id,
				label,
				mediaType: itemType,
				url: item.url,
				source: `data.${arrayKey}[${index}].url`,
			});
		});
	}

	pushInlineAsset(out, seen, {
		assetId: row.id,
		label,
		mediaType: "text",
		value: readExplicitText(data),
		source: "data.text",
	});
	pushInlineAsset(out, seen, {
		assetId: row.id,
		label,
		mediaType: "html",
		value: readExplicitHtml(data),
		source: "data.webHeroDocumentHtml",
	});

	if (!out.length) {
		pushUrlAsset(out, seen, {
			assetId: row.id,
			label,
			mediaType: "image",
			url: data.thumbnailUrl,
			source: "data.thumbnailUrl",
		});
	}

	return out;
}

async function collectAllProjectAssets(input: {
	c: AppContext;
	userId: string;
	kind: AssetZipKind;
	maxAssets: number;
}): Promise<NormalizedExportAsset[]> {
	const out: NormalizedExportAsset[] = [];
	let cursor: string | null = null;
	while (out.length <= input.maxAssets) {
		const rows = await listAssetsForUser(input.c.env.DB, input.userId, {
			limit: ASSET_EXPORT_PAGE_SIZE,
			cursor,
		});
		for (const row of rows) {
			for (const asset of extractExportAssetsFromAssetRow(row)) {
				if (shouldKeepAsset(asset, input.kind)) out.push(asset);
				if (out.length > input.maxAssets) {
					throw new AppError("Too many assets to export", {
						status: 400,
						code: "asset_zip_too_many",
						details: { maxAssets: input.maxAssets },
					});
				}
			}
		}
		if (rows.length < ASSET_EXPORT_PAGE_SIZE) break;
		cursor = rows[rows.length - 1]?.created_at ?? null;
		if (!cursor) break;
	}
	return out;
}

function dedupeAssets(assets: NormalizedExportAsset[]): NormalizedExportAsset[] {
	const out: NormalizedExportAsset[] = [];
	const seen = new Set<string>();
	for (const asset of assets) {
		const key =
			asset.url
				? `${asset.mediaType}:url:${asset.url}`
				: `${asset.mediaType}:inline:${asset.html || asset.text || ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(asset);
	}
	return out;
}

function readableStreamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

function createCountingStream(input: {
	stream: ReadableStream<Uint8Array>;
	onComplete: (byteLength: number) => void;
}): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const reader = input.stream.getReader();
			let total = 0;
			try {
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					if (!value) continue;
					total += value.byteLength;
					controller.enqueue(value);
				}
				input.onComplete(total);
				controller.close();
			} catch (err) {
				controller.error(err);
			} finally {
				reader.releaseLock();
			}
		},
	});
}

async function openRemoteAsset(input: {
	c: AppContext;
	asset: NormalizedExportAsset;
	usedPaths: Map<string, number>;
	manifest: ManifestItem[];
}): Promise<ZipEntrySource | null> {
	const url = input.asset.url || "";
	try {
		const response = await fetchWithHttpDebugLog(input.c, url, undefined, {
			tag: "asset-zip:fetch",
		});
		if (!response.ok) {
			throw new Error(`upstream ${response.status}`);
		}
		const contentLength = Number(response.headers.get("content-length") || "");
		if (Number.isFinite(contentLength) && contentLength > MAX_SINGLE_FILE_BYTES) {
			throw new Error(`file too large: ${contentLength}`);
		}
		const contentType =
			response.headers.get("content-type") || "application/octet-stream";
		const extension =
			extensionFromContentType(contentType, input.asset.mediaType) ||
			extensionFromUrl(url) ||
			defaultExtension(input.asset.mediaType);
		const path = buildZipPath({
			asset: input.asset,
			extension,
			usedPaths: input.usedPaths,
		});
		const manifestItem: ManifestItem = {
			status: "ok",
			path,
			label: input.asset.label,
			mediaType: input.asset.mediaType,
			url,
			source: input.asset.source,
			byteLength: 0,
		};
		input.manifest.push(manifestItem);
		const body = response.body || readableStreamFromBytes(new Uint8Array(await response.arrayBuffer()));
		return {
			path,
			stream: createCountingStream({
				stream: body,
				onComplete: (byteLength) => {
					manifestItem.byteLength = byteLength;
				},
			}),
			contentType,
		};
	} catch (err) {
		input.manifest.push({
			status: "failed",
			label: input.asset.label,
			mediaType: input.asset.mediaType,
			url,
			source: input.asset.source,
			error: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
}

async function* buildZipEntries(input: {
	c: AppContext;
	scope: "canvas" | "all";
	assets: NormalizedExportAsset[];
}): AsyncIterable<ZipEntrySource> {
	const manifest: ManifestItem[] = [];
	const usedPaths = new Map<string, number>();

	for (const asset of input.assets) {
		if (asset.mediaType === "text" || asset.mediaType === "html") {
			const content = asset.mediaType === "html" ? asset.html || "" : asset.text || "";
			const bytes = textEncoder.encode(content);
			const path = buildZipPath({
				asset,
				extension: defaultExtension(asset.mediaType),
				usedPaths,
			});
			manifest.push({
				status: "ok",
				path,
				label: asset.label,
				mediaType: asset.mediaType,
				source: asset.source,
				byteLength: bytes.byteLength,
			});
			yield { path, bytes };
			continue;
		}

		const entry = await openRemoteAsset({
			c: input.c,
			asset,
			usedPaths,
			manifest,
		});
		if (entry) yield entry;
	}

	const okCount = manifest.filter((item) => item.status === "ok").length;
	const failedCount = manifest.filter((item) => item.status === "failed").length;
	const summary = {
		scope: input.scope,
		exportedAt: new Date().toISOString(),
		total: manifest.length,
		ok: okCount,
		failed: failedCount,
		items: manifest,
	};
	yield {
		path: ensureUniqueZipPath("README.txt", usedPaths),
		bytes: textEncoder.encode(
			`JarvisHub asset export\nScope: ${input.scope}\nFiles: ${okCount}\nFailed: ${failedCount}\n`,
		),
	};
	yield {
		path: ensureUniqueZipPath("manifest.json", usedPaths),
		bytes: textEncoder.encode(JSON.stringify(summary, null, 2)),
	};
}

function parseMaxAssets(raw: unknown): number {
	const n = typeof raw === "number" ? raw : Number(raw);
	if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_ASSETS;
	return Math.max(1, Math.min(Math.trunc(n), HARD_MAX_ASSETS));
}

function normalizeRequest(input: {
	scope: "canvas" | "all";
	kind?: unknown;
	canvasAssets?: unknown[];
	maxAssets?: unknown;
}): {
	scope: "canvas" | "all";
	kind: AssetZipKind;
	canvasAssets: unknown[];
	maxAssets: number;
} {
	return {
		scope: input.scope,
		kind: normalizeKind(input.kind),
		canvasAssets: Array.isArray(input.canvasAssets) ? input.canvasAssets : [],
		maxAssets: parseMaxAssets(input.maxAssets),
	};
}

export async function buildAssetZipResponse(input: {
	c: AppContext;
	userId: string;
	scope: "canvas" | "all";
	kind?: unknown;
	canvasAssets?: unknown[];
	maxAssets?: unknown;
}): Promise<Response> {
	const request = normalizeRequest(input);
	const assets =
		request.scope === "canvas"
			? normalizeCanvasZipAssets(request.canvasAssets).filter((asset) =>
					shouldKeepAsset(asset, request.kind),
				)
			: await collectAllProjectAssets({
					c: input.c,
					userId: input.userId,
					kind: request.kind,
					maxAssets: request.maxAssets,
				});
	const deduped = dedupeAssets(assets);
	if (!deduped.length) {
		throw new AppError("No exportable assets", {
			status: 400,
			code: "asset_zip_empty",
		});
	}

	const filename = makeFilename(request.scope);
	const zipStream = createStoredZipStream(
		buildZipEntries({
			c: input.c,
			scope: request.scope,
			assets: deduped,
		}),
	);
	return new Response(zipStream, {
		status: 200,
		headers: {
			"content-type": "application/zip",
			"content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
			"cache-control": "private, no-store",
		},
	});
}
