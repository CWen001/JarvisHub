import { Hono } from "hono";
import fs from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { AppContext, AppEnv } from "../../types";
import {
	authMiddleware,
} from "../../middleware/auth";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import {
	CreateAssetSchema,
	getUtf8TextByteLength,
	IngestProjectMaterialSchema,
	RenameAssetSchema,
	ServerAssetSchema,
	TEXT_UPLOAD_MAX_BYTES,
	TEXT_UPLOAD_MAX_LABEL,
	UpdateAssetDataSchema,
} from "./asset.schemas";
import {
	createAssetRow,
	getAssetByIdForUser,
	deleteAssetRow,
	listAssetsForUser,
	listAssetsForUserByKind,
	renameAssetRow,
	updateAssetDataRow,
} from "./asset.repo";
import { getProjectForOwner } from "../project/project.repo";
import { runAgentsBridgeChatTask } from "../task/task.agents-bridge";
import { resolvePublicAssetBaseUrl } from "./asset.publicBase";
import { buildAssetZipResponse } from "./asset-export";
import { uploadToStorageFromUrl } from "./asset.hosting";
import { createRustfsClient, resolveRustfsConfig } from "./rustfs.client";
import { resolveProjectDataRepoRoot } from "./project-data-root";

export const assetRouter = new Hono<AppEnv>();
function normalizeContentType(raw: string | null | undefined): string {
	const ct = typeof raw === "string" ? raw : "";
	return (ct.split(";")[0] || "").trim().toLowerCase() || "application/octet-stream";
}

function sanitizeUploadName(raw: unknown): string {
	if (typeof raw !== "string") return "";
	return raw
		.trim()
		.slice(0, 160)
		.replace(/[\u0000-\u001F\u007F]/g, "")
		.replace(/[\\/]/g, "_");
}

function buildTextUploadTooLargePayload(contentBytes?: number): {
	error: string;
	code: "TEXT_UPLOAD_TOO_LARGE";
	maxBytes: number;
	contentBytes?: number;
} {
	return {
		error: `文本上传内容过大，最大允许 ${TEXT_UPLOAD_MAX_LABEL}`,
		code: "TEXT_UPLOAD_TOO_LARGE",
		maxBytes: TEXT_UPLOAD_MAX_BYTES,
		...(typeof contentBytes === "number" && Number.isFinite(contentBytes)
			? { contentBytes: Math.max(0, Math.trunc(contentBytes)) }
			: {}),
	};
}

function extractTextUploadContentFromAssetData(data: unknown): string | null {
	if (!data || typeof data !== "object") return null;
	const record = data as Record<string, unknown>;
	const kind = typeof record.kind === "string" ? record.kind.trim() : "";
	if (kind !== "text") {
		return null;
	}
	return typeof record.content === "string" ? record.content : null;
}

function normalizeOptionalText(raw: unknown, maxLen: number): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (!Number.isFinite(maxLen) || maxLen <= 0) return trimmed;
	return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function detectUploadExtensionFromMeta(options: {
	contentType: string;
	fileName?: string;
}): string {
	const name = options.fileName || "";
	const contentType = normalizeContentType(options.contentType);
	const known: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/webp": "webp",
		"image/gif": "gif",
		"image/avif": "avif",
		"video/mp4": "mp4",
		"video/webm": "webm",
		"video/quicktime": "mov",
	};
	if (contentType && known[contentType]) return known[contentType];
	if (name) {
		const match = name.match(/\.([a-zA-Z0-9]+)$/);
		if (match && match[1]) return match[1].toLowerCase();
	}
	if (contentType.startsWith("image/")) {
		return contentType.slice("image/".length) || "png";
	}
	return "bin";
}

function inferMediaKind(options: {
	contentType: string;
	fileName?: string;
}): "image" | "video" | null {
	const contentType = normalizeContentType(options.contentType);
	if (contentType.startsWith("image/")) return "image";
	if (contentType.startsWith("video/")) return "video";
	const name = options.fileName || "";
	const ext = (name.split(".").pop() || "").toLowerCase();
	if (!ext) return null;
	if (["png", "jpg", "jpeg", "webp", "gif", "avif"].includes(ext)) return "image";
	if (["mp4", "webm", "mov"].includes(ext)) return "video";
	return null;
}

type HttpByteRange =
	| { suffix: number }
	| { offset: number; length?: number };

function parseHttpByteRangeHeader(header: string): HttpByteRange | null {
	const raw = typeof header === "string" ? header.trim() : "";
	if (!raw) return null;
	const match = raw.match(/^bytes=(.+)$/i);
	if (!match || !match[1]) return null;

	// Only support a single range: `bytes=start-end` / `bytes=start-` / `bytes=-suffix`
	const spec = match[1].split(",")[0]?.trim() || "";
	if (!spec) return null;
	const [startStr, endStr] = spec.split("-");
	if (typeof endStr === "undefined") return null;

	if (!startStr) {
		const suffix = Number(endStr);
		if (!Number.isFinite(suffix) || suffix <= 0) return null;
		return { suffix: Math.floor(suffix) };
	}

	const start = Number(startStr);
	if (!Number.isFinite(start) || start < 0) return null;
	if (!endStr) return { offset: Math.floor(start) };

	const end = Number(endStr);
	if (!Number.isFinite(end) || end < start) return null;
	return { offset: Math.floor(start), length: Math.floor(end - start + 1) };
}

function toHttpRangeHeader(range: HttpByteRange | null): string | null {
	if (!range) return null;
	if ("suffix" in range) return `bytes=-${range.suffix}`;
	if (typeof range.offset === "number" && typeof range.length === "number") {
		const end = range.offset + range.length - 1;
		return `bytes=${range.offset}-${end}`;
	}
	if (typeof range.offset === "number") {
		return `bytes=${range.offset}-`;
	}
	return null;
}
async function readStreamToBytes(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
): Promise<Uint8Array> {
	if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
		return new Uint8Array(await new Response(stream).arrayBuffer());
	}

	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value || value.byteLength === 0) continue;
			total += value.byteLength;
			if (total > maxBytes) {
				try {
					await reader.cancel();
				} catch {
					// ignore
				}
				throw new Error("file is too large");
			}
			chunks.push(value);
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// ignore
		}
	}

	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

function isNodeRuntime(): boolean {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const processRef = (globalThis as any)?.process;
	return !!processRef?.versions?.node;
}

function sanitizePathSegment(raw: string): string {
	return String(raw || "")
		.trim()
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.slice(0, 120);
}

function extractFirstJsonObject(text: string): any | null {
	const raw = String(text || "").trim();
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		// ignore
	}
	const block = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
	const candidate = block?.[1] || raw;
	try {
		return JSON.parse(candidate);
	} catch {
		return null;
	}
}


type MaterialChapter = { chapter: number; title: string; content: string };

const CHAPTER_HEADING_LINE_RE =
	/^\s*(?:正文\s*)?(?:(第\s*[0-9０-９一二三四五六七八九十百千零〇两IVXLCDMivxlcdm]+\s*(?:卷|部|篇|章|回|节)(?:\s*[-:：.、·\)]?\s*[^\r\n]{0,80})?)|((?:chapter|chap\.?)\s*[0-9ivxlcdm]+(?:\s*[-:：.、]\s*[^\r\n]{0,80})?)|((?:prologue|epilogue|序章|楔子|终章|尾声)\s*[^\r\n]{0,80}))\s*$/i;

function normalizeChapterList(value: unknown): MaterialChapter[] {
	if (!Array.isArray(value)) return [];
	const out: MaterialChapter[] = [];
	for (const item of value) {
		const chapterRaw = Number((item as any)?.chapter);
		const title = String((item as any)?.title || "").trim() || `第${chapterRaw || out.length + 1}章`;
		const content = String((item as any)?.content || "").trim();
		if (!Number.isFinite(chapterRaw) || chapterRaw <= 0 || !content) continue;
		out.push({
			chapter: Math.trunc(chapterRaw),
			title,
			content,
		});
	}
	return out;
}

function splitByChapterHeadings(content: string): MaterialChapter[] {
	const text = String(content || "");
	if (!text.trim()) return [];
	const lines = text.split(/\r?\n/);
	const lineOffsets: number[] = new Array(lines.length + 1);
	let cursor = 0;
	for (let i = 0; i < lines.length; i++) {
		lineOffsets[i + 1] = cursor + lines[i].length + 1;
		cursor = lineOffsets[i + 1];
	}
	const matches: Array<{ line: number; start: number; title: string }> = [];
	for (let i = 0; i < lines.length; i++) {
		const line = String(lines[i] || "").trim();
		if (!line || line.length > 120) continue;
		const m = line.match(CHAPTER_HEADING_LINE_RE);
		if (!m) continue;
		const title = String(m[1] || m[2] || m[3] || line).trim();
		if (!title) continue;
		matches.push({
			line: i + 1,
			start: lineOffsets[i] || 0,
			title,
		});
	}
	if (!matches.length) return [];

	const out: MaterialChapter[] = [];
	for (let i = 0; i < matches.length; i++) {
		const cur = matches[i];
		const next = matches[i + 1];
		const end = next ? next.start : text.length;
		const body = text.slice(cur.start, end).trim();
		if (!body) continue;
		out.push({
			chapter: i + 1,
			title: cur.title,
			content: body,
		});
	}
	return out;
}

function splitByFixedSize(content: string, chunkChars = 120_000): MaterialChapter[] {
	const text = String(content || "");
	if (!text.trim()) return [];
	const size = Math.max(20_000, Math.min(300_000, Math.trunc(chunkChars)));
	const out: MaterialChapter[] = [];
	let offset = 0;
	let idx = 1;
	while (offset < text.length) {
		const end = Math.min(text.length, offset + size);
		const body = text.slice(offset, end).trim();
		if (body) {
			out.push({
				chapter: idx,
				title: `自动分段 ${idx}`,
				content: body,
			});
			idx += 1;
		}
		offset = end;
	}
	return out;
}

function getPublicBase(c: Pick<AppContext, "env" | "req">): string {
	return resolvePublicAssetBaseUrl(c).trim().replace(/\/+$/, "");
}

function detectUploadExtension(file: File): string {
	const name = (file as any).name as string | undefined;
	const rawType = file.type || "";
	const contentType = rawType.split(";")[0].trim();
	const known: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/webp": "webp",
		"image/gif": "gif",
		"image/avif": "avif",
		"video/mp4": "mp4",
		"video/webm": "webm",
		"video/quicktime": "mov",
	};
	if (contentType && known[contentType]) return known[contentType];
	if (name && typeof name === "string") {
		const match = name.match(/\.([a-zA-Z0-9]+)$/);
		if (match && match[1]) return match[1].toLowerCase();
	}
	if (contentType.startsWith("image/")) {
		return contentType.slice("image/".length) || "png";
	}
	return "bin";
}

function buildUserUploadKey(userId: string, ext: string): string {
	const safeUser = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_");
	const now = new Date();
	const datePrefix = `${now.getUTCFullYear()}${String(
		now.getUTCMonth() + 1,
	).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
	const random = crypto.randomUUID();
	return `uploads/user/${safeUser}/${datePrefix}/${random}.${ext || "bin"}`;
}

function isHostedUrl(url: string, publicBase: string): boolean {
	const trimmed = (url || "").trim();
	if (!trimmed) return false;
	if (publicBase) {
		return trimmed.startsWith(`${publicBase}/`);
	}
	// Fallback: default generated asset key prefix
	return /^\/?gen\//.test(trimmed);
}

const ASSET_LIST_TEXT_MAX_CHARS = 8_000;

function trimAssetTextForList(value: unknown): {
	text: string;
	truncated: boolean;
	originalLength: number;
} {
	const raw = String(value || "");
	const originalLength = raw.length;
	if (originalLength <= ASSET_LIST_TEXT_MAX_CHARS) {
		return { text: raw, truncated: false, originalLength };
	}
	return {
		text: raw.slice(0, ASSET_LIST_TEXT_MAX_CHARS),
		truncated: true,
		originalLength,
	};
}

function compactAssetDataForList(data: unknown): unknown {
	if (!data || typeof data !== "object") return data;
	const next = { ...(data as Record<string, unknown>) };
	let truncated = false;
	let maxOriginalLength = 0;
	const textKeys = ["content", "prompt"];
	for (const key of textKeys) {
		if (typeof next[key] !== "string") continue;
		const { text, truncated: flag, originalLength } = trimAssetTextForList(next[key]);
		next[key] = text;
		if (flag) truncated = true;
		maxOriginalLength = Math.max(maxOriginalLength, originalLength);
	}
	if (Array.isArray(next.textResults)) {
		const list = (next.textResults as unknown[])
			.slice(0, 10)
			.map((item) => {
				if (!item || typeof item !== "object") return item;
				const row = { ...(item as Record<string, unknown>) };
				if (typeof row.text === "string") {
					const { text, truncated: flag, originalLength } = trimAssetTextForList(row.text);
					row.text = text;
					if (flag) truncated = true;
					maxOriginalLength = Math.max(maxOriginalLength, originalLength);
				}
				return row;
			});
		next.textResults = list;
	}
	if (truncated) {
		(next as any).contentTruncated = true;
		(next as any).contentOriginalLength = maxOriginalLength;
	}
	return next;
}

assetRouter.get("/", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const limitParam = c.req.query("limit");
	const limit =
		typeof limitParam === "string" && limitParam
			? Number(limitParam)
			: undefined;
	const cursor = c.req.query("cursor") || null;
	const projectId = c.req.query("projectId") || null;
	const kind = c.req.query("kind") || null;
	const fullData = String(c.req.query("fullData") || "").trim() === "1";

	const rows = await listAssetsForUser(c.env.DB, userId, {
		limit,
		cursor,
		projectId,
		kind,
	});
	const payload = rows.map((row) =>
		ServerAssetSchema.parse({
			id: row.id,
			name: row.name,
			data: row.data
				? fullData
					? JSON.parse(row.data)
					: compactAssetDataForList(JSON.parse(row.data))
				: null,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			userId,
			projectId: row.project_id,
		}),
	);
	const nextCursor = rows.length ? rows[rows.length - 1].created_at : null;
	return c.json({ items: payload, cursor: nextCursor });
});

assetRouter.post("/", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateAssetSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const textContent = extractTextUploadContentFromAssetData(parsed.data.data);
	if (typeof textContent === "string") {
		const contentBytes = getUtf8TextByteLength(textContent);
		if (contentBytes > TEXT_UPLOAD_MAX_BYTES) {
			return c.json(buildTextUploadTooLargePayload(contentBytes), 413);
		}
	}
	const nowIso = new Date().toISOString();
	const row = await createAssetRow(
		c.env.DB,
		userId,
		{
			name: parsed.data.name,
			data: parsed.data.data,
			projectId: parsed.data.projectId,
		},
		nowIso,
	);
	const payload = ServerAssetSchema.parse({
		id: row.id,
		name: row.name,
		data: row.data ? JSON.parse(row.data) : null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userId,
		projectId: row.project_id,
	});
	return c.json(payload);
});

assetRouter.post("/ingest-material", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = IngestProjectMaterialSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const input = parsed.data;
	const contentBytes = getUtf8TextByteLength(input.content);
	if (contentBytes > TEXT_UPLOAD_MAX_BYTES) {
		return c.json(buildTextUploadTooLargePayload(contentBytes), 413);
	}

	const project = await getProjectForOwner(c.env.DB, input.projectId, userId);
	if (!project) {
		return c.json({ error: "project not found" }, 404);
	}

	// Base asset row (always persisted for fallback/replay).
	const nowIso = new Date().toISOString();
	const baseRow = await createAssetRow(
		c.env.DB,
		userId,
		{
			name: input.name.trim(),
			projectId: input.projectId,
			data: {
				kind: input.kind,
				content: input.content,
				chapter: input.chapter ?? null,
				source: "upload",
				ingestMode: "agents_cli_or_fallback",
			},
		},
		nowIso,
	);

	if (!isNodeRuntime()) {
		return c.json({
			ok: true,
			mode: "db_only",
			baseAssetId: baseRow.id,
			chaptersCreated: 0,
			message: "non-node runtime: skipped filesystem ingest",
		});
	}

	const repoRoot = resolveProjectDataRepoRoot();
	const projectRoot = path.join(repoRoot, "project-data", sanitizePathSegment(input.projectId));
	const kindDir = path.join(projectRoot, "materials", sanitizePathSegment(input.kind));
	const chaptersDir = path.join(kindDir, "chapters");
	const rawDir = path.join(kindDir, "raw");
	await fs.mkdir(chaptersDir, { recursive: true });
	await fs.mkdir(rawDir, { recursive: true });

	const baseName = sanitizePathSegment(input.name) || "material";
	const rawPath = path.join(rawDir, `${Date.now()}-${baseName}.md`);
	await fs.writeFile(rawPath, input.content, "utf8");

	let chapters: MaterialChapter[] = [];
	// 1) First try deterministic heading split (cheap + robust for large novels).
	chapters = splitByChapterHeadings(input.content);

	// 2) If no headings and content is very large, chunk by fixed size to avoid bridge body limits.
	if (!chapters.length && input.content.length > 300_000) {
		chapters = splitByFixedSize(input.content, 120_000);
	}

	// 3) For smaller non-structured text, ask agents-cli to split.
	try {
		if (!chapters.length) {
			const prompt = [
				"请将下面文本切分为章节并返回严格 JSON。",
				'返回格式：{"chapters":[{"chapter":1,"title":"...","content":"..."}]}',
				"要求：",
				"- chapter 从 1 递增",
				"- content 保留原文核心，不要总结",
				"- 如果原文无法识别章节，也至少输出 1 章",
				"",
				input.content,
			].join("\n");
			const result = await runAgentsBridgeChatTask(c as any, userId, {
				kind: "chat",
				prompt,
			});
			const text = typeof (result as any)?.raw?.text === "string" ? (result as any).raw.text : "";
			const parsedJson = extractFirstJsonObject(text);
			chapters = normalizeChapterList((parsedJson as any)?.chapters);
		}
	} catch {
		// fallback below
	}

	if (!chapters.length) {
		chapters = [
			{
				chapter: input.chapter ?? 1,
				title: input.name.trim() || "第1章",
				content: input.content,
			},
		];
	}

	let created = 0;
	for (const ch of chapters) {
		const chapterNo = Math.max(1, Math.trunc(ch.chapter));
		const chapterFile = path.join(chaptersDir, `${String(chapterNo).padStart(3, "0")}.md`);
		await fs.writeFile(chapterFile, ch.content, "utf8");
		await createAssetRow(
			c.env.DB,
			userId,
			{
				name: `${ch.title || `第${chapterNo}章`}`.slice(0, 200),
				projectId: input.projectId,
				data: {
					kind: input.kind,
					content: ch.content,
					chapter: chapterNo,
					chapterTitle: ch.title || `第${chapterNo}章`,
					source: "agents_ingest",
					filePath: path.relative(repoRoot, chapterFile),
					baseAssetId: baseRow.id,
				},
			},
			new Date().toISOString(),
		);
		created += 1;
	}

	const indexPath = path.join(kindDir, "index.json");
	await fs.writeFile(
		indexPath,
		JSON.stringify(
			{
				projectId: input.projectId,
				kind: input.kind,
				baseAssetId: baseRow.id,
				rawPath: path.relative(repoRoot, rawPath),
				updatedAt: new Date().toISOString(),
				chapters: chapters.map((ch) => ({
					chapter: ch.chapter,
					title: ch.title,
					file: path.relative(repoRoot, path.join(chaptersDir, `${String(Math.max(1, Math.trunc(ch.chapter))).padStart(3, "0")}.md`)),
					length: ch.content.length,
				})),
			},
			null,
			2,
		),
		"utf8",
	);

	return c.json({
		ok: true,
		mode: "agents_cli",
		baseAssetId: baseRow.id,
		chaptersCreated: created,
		projectPath: path.relative(repoRoot, projectRoot),
		indexPath: path.relative(repoRoot, indexPath),
	});
});

assetRouter.post("/export-zip", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = await c.req.json().catch(() => null);
	const record = body && typeof body === "object" && !Array.isArray(body)
		? (body as Record<string, unknown>)
		: {};
	const scope = record.scope === "all" ? "all" : "canvas";
	return buildAssetZipResponse({
		c,
		userId,
		scope,
		kind: record.kind,
		canvasAssets: Array.isArray(record.assets) ? record.assets : [],
		maxAssets: record.maxAssets,
	});
});

assetRouter.patch("/:id/data", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	if (!id) return c.json({ error: "asset id is required" }, 400);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateAssetDataSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const textContent = extractTextUploadContentFromAssetData(parsed.data.data);
	if (typeof textContent === "string") {
		const contentBytes = getUtf8TextByteLength(textContent);
		if (contentBytes > TEXT_UPLOAD_MAX_BYTES) {
			return c.json(buildTextUploadTooLargePayload(contentBytes), 413);
		}
	}
	const nowIso = new Date().toISOString();
	await updateAssetDataRow(c.env.DB, userId, id, parsed.data.data, nowIso);
	const row = await getAssetByIdForUser(c.env.DB, id, userId);
	if (!row) {
		return c.json({ error: "asset not found or unauthorized" }, 404);
	}
	const payload = ServerAssetSchema.parse({
		id: row.id,
		name: row.name,
		data: row.data ? JSON.parse(row.data) : null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userId,
		projectId: row.project_id,
	});
	return c.json(payload);
});

assetRouter.put("/:id", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	if (!id) return c.json({ error: "asset id is required" }, 400);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = RenameAssetSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const nowIso = new Date().toISOString();
	const row = await renameAssetRow(
		c.env.DB,
		userId,
		id,
		parsed.data.name,
		nowIso,
	);
	const payload = ServerAssetSchema.parse({
		id: row.id,
		name: row.name,
		data: row.data ? JSON.parse(row.data) : null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userId,
		projectId: row.project_id,
	});
	return c.json(payload);
});

assetRouter.delete("/:id", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	if (!id) return c.json({ error: "asset id is required" }, 400);
	await deleteAssetRow(c.env.DB, userId, id);
	return c.body(null, 204);
});

assetRouter.post("/rehost", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const rustfs = resolveRustfsConfig(c.env);
	if (!rustfs) {
		return c.json({ error: "Object storage is not configured" }, 500);
	}

	const publicBase = resolvePublicAssetBaseUrl(c).trim().replace(/\/+$/, "");
	const isHostedUrl = (url: string): boolean => {
		const trimmed = (url || "").trim();
		if (!trimmed) return false;
		if (publicBase) return trimmed.startsWith(`${publicBase}/`);
		return /^\/?gen\//.test(trimmed);
	};

	const rows = await listAssetsForUserByKind(c.env.DB, userId, {
		kind: "generation",
		limit: 500,
	});

	const candidates = rows.filter((row) => {
		if (!row.data) return false;
		let parsed: any;
		try { parsed = JSON.parse(row.data); } catch { return false; }
		const status = parsed?.hosting?.status;
		if (status === "ready") return false;
		const sourceUrl = (parsed?.sourceUrl || "").trim();
		if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return false;
		if (isHostedUrl(parsed?.url || "")) return false;
		return true;
	});

	if (!candidates.length) {
		return c.json({ total: 0, succeeded: 0, failed: 0, results: [] });
	}

	const results: Array<{ id: string; status: "ok" | "failed" | "expired"; message?: string }> = [];
	let succeeded = 0;
	let failed = 0;

	for (const row of candidates) {
		const parsed = JSON.parse(row.data!);
		const sourceUrl = (parsed.sourceUrl as string).trim();
		const assetType = parsed.type === "video" ? "video" : "image";
		const nowIso = new Date().toISOString();

		await updateAssetDataRow(c.env.DB, userId, row.id, {
			...parsed,
			hosting: { status: "running", updatedAt: nowIso },
		}, nowIso);

		try {
			const uploaded = await uploadToStorageFromUrl({
				c,
				userId,
				sourceUrl,
				prefix: assetType === "video" ? "gen/videos" : "gen/images",
				storage: { kind: "rustfs", config: rustfs },
				publicBase,
			});

			const readyIso = new Date().toISOString();
			await updateAssetDataRow(c.env.DB, userId, row.id, {
				...parsed,
				url: uploaded.url,
				hosting: { status: "ready", updatedAt: readyIso, hostedAt: readyIso },
			}, readyIso);

			results.push({ id: row.id, status: "ok" });
			succeeded += 1;
		} catch (err: any) {
			const upstreamStatus = err?.details?.upstreamStatus as number | undefined;
			const isExpired = upstreamStatus === 403 || upstreamStatus === 404 || upstreamStatus === 410;

			if (isExpired) {
				await deleteAssetRow(c.env.DB, userId, row.id).catch(() => {});
				results.push({ id: row.id, status: "expired", message: "源链接已过期，已清理" });
			} else {
				const failIso = new Date().toISOString();
				await updateAssetDataRow(c.env.DB, userId, row.id, {
					...parsed,
					hosting: { status: "failed", message: err?.message || String(err), updatedAt: failIso },
				}, failIso).catch(() => {});
				results.push({ id: row.id, status: "failed", message: err?.message || "unknown" });
			}
			failed += 1;
		}
	}

	return c.json({ total: candidates.length, succeeded, failed, results });
});

// Public asset proxy: serves objects from configured object storage by key.
assetRouter.get("/r2/*", async (c) => {
	const rustfs = resolveRustfsConfig(c.env);
	if (!rustfs) {
		return c.json({ error: "Object storage is not configured" }, 500);
	}

	const pathname = new URL(c.req.url).pathname;
	const prefix = "/assets/r2/"; // keep legacy route path for backward compatibility
	const key = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
	if (!key) {
		return c.json({ error: "key is required" }, 400);
	}

	const rangeHeader = c.req.header("range") || c.req.header("Range") || "";
	const range = rangeHeader ? parseHttpByteRangeHeader(rangeHeader) : null;
	const rangeValue = toHttpRangeHeader(range);

	try {
		const client = createRustfsClient(c.env);
		const res = await client.send(
			new GetObjectCommand({
				Bucket: rustfs.bucket,
				Key: key,
				Range: rangeValue || undefined,
			}),
		);
		if (!res.Body) return c.json({ error: "not found" }, 404);
		const headers = new Headers();
		headers.set(
			"Content-Type",
			typeof res.ContentType === "string"
				? res.ContentType
				: "application/octet-stream",
		);
		headers.set(
			"Cache-Control",
			typeof res.CacheControl === "string"
				? res.CacheControl
				: "public, max-age=31536000, immutable",
		);
		headers.set("Access-Control-Allow-Origin", "*");
		headers.set(
			"Access-Control-Expose-Headers",
			"Content-Length,Content-Range,Accept-Ranges,ETag",
		);
		headers.set("Accept-Ranges", "bytes");
		if (typeof res.ETag === "string") headers.set("ETag", res.ETag);
		if (typeof res.ContentRange === "string") {
			headers.set("Content-Range", res.ContentRange);
		}
		if (typeof res.ContentLength === "number") {
			headers.set("Content-Length", String(res.ContentLength));
		}
		const status = range ? 206 : 200;
		return new Response(res.Body as ReadableStream, { status, headers });
	} catch {
		return c.json({ error: "not found" }, 404);
	}
});

// Upload a user asset file to configured object storage and persist it as an asset row.
assetRouter.post("/upload", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const rustfsConfig = resolveRustfsConfig(c.env);
	if (!rustfsConfig) {
		return c.json({ error: "Object storage is not configured" }, 500);
	}

	const MAX_BYTES = 30 * 1024 * 1024;
	const isNode = isNodeRuntime();
	const contentTypeHeader = normalizeContentType(c.req.header("content-type"));
	const isMultipart = contentTypeHeader.includes("multipart/form-data");

	let kind: "image" | "video" | null = null;
	let contentType = contentTypeHeader;
	let originalName: string | null = null;
	let size: number | null = null;
	let uploadValue: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | Blob | null = null;
	let uploadPump: Promise<void> | null = null;
	let name = "";
	let prompt: string | null = null;
	let vendor: string | null = null;
	let modelKey: string | null = null;
	let taskKind: string | null = null;
	let projectId: string | null = null;

	if (isMultipart) {
		const form = await c.req.formData();
		const file = form.get("file");
		if (!(file instanceof File)) {
			return c.json({ error: "file is required" }, 400);
		}

		originalName = sanitizeUploadName((file as any).name || "");
		contentType = normalizeContentType(file.type);
		kind = inferMediaKind({ contentType, fileName: originalName });
		if (!kind) {
			return c.json({ error: "only image/video files are allowed" }, 400);
		}

		if (typeof file.size === "number") {
			size = file.size;
			if (size > MAX_BYTES) {
				return c.json({ error: "file is too large (max 30MB)" }, 413);
			}
		}

		const nameValue = form.get("name");
		const rawName =
			typeof nameValue === "string" && nameValue.trim()
				? nameValue.trim()
				: originalName || "";
		name = sanitizeUploadName(rawName) || (kind === "video" ? "Video" : "Image");

		prompt = normalizeOptionalText(form.get("prompt"), 8000);
		vendor = normalizeOptionalText(form.get("vendor"), 64);
		modelKey = normalizeOptionalText(form.get("modelKey"), 128);
		taskKind = normalizeOptionalText(form.get("taskKind"), 64);
		projectId = normalizeOptionalText(form.get("projectId"), 128);

		uploadValue = file;
	} else {
		originalName = sanitizeUploadName(c.req.header("x-file-name") || "");
		contentType = contentTypeHeader;
		kind = inferMediaKind({ contentType, fileName: originalName || undefined });
		if (!kind) {
			return c.json({ error: "only image/video files are allowed" }, 400);
		}

		const contentLengthHeader = c.req.header("content-length");
		const parsedLen =
			typeof contentLengthHeader === "string" && contentLengthHeader
				? Number(contentLengthHeader)
				: NaN;
		const hasContentLength = Number.isFinite(parsedLen);
		const declaredSizeHeader = c.req.header("x-file-size");
		const declaredSize =
			typeof declaredSizeHeader === "string" && declaredSizeHeader
				? Number(declaredSizeHeader)
				: NaN;

		size = hasContentLength
			? parsedLen
			: Number.isFinite(declaredSize)
				? declaredSize
				: null;
		if (size != null && size > MAX_BYTES) {
			return c.json({ error: "file is too large (max 30MB)" }, 413);
		}

		name = sanitizeUploadName(c.req.query("name") || "") || (kind === "video" ? "Video" : "Image");
		prompt =
			normalizeOptionalText(
				c.req.header("x-asset-prompt") ||
					c.req.query("prompt") ||
					"",
				8000,
			) ?? null;
		vendor =
			normalizeOptionalText(
				c.req.header("x-asset-vendor") ||
					c.req.query("vendor") ||
					"",
				64,
			) ?? null;
		modelKey =
			normalizeOptionalText(
				c.req.header("x-asset-model-key") ||
					c.req.query("modelKey") ||
					"",
				128,
			) ?? null;
		taskKind =
			normalizeOptionalText(
				c.req.header("x-asset-task-kind") ||
					c.req.query("taskKind") ||
					"",
				64,
			) ?? null;
		projectId =
			normalizeOptionalText(
				c.req.header("x-asset-project-id") ||
					c.req.query("projectId") ||
					"",
				128,
			) ?? null;
		const bodyStream = c.req.raw.body as ReadableStream<Uint8Array> | null;
		if (!bodyStream) {
			return c.json({ error: "request body is required" }, 400);
		}

		if (isNode) {
			try {
				const bytes = await readStreamToBytes(bodyStream, MAX_BYTES);
				size = bytes.byteLength;
				uploadValue = bytes;
			} catch (err: any) {
				const msg = String(err?.message || "");
				if (/too large/i.test(msg)) {
					return c.json({ error: "file is too large (max 30MB)" }, 413);
				}
				throw err;
			}
		} else if (hasContentLength) {
			uploadValue = bodyStream;
		} else if (size != null) {
				const fixed = new TransformStream<Uint8Array, Uint8Array>();
				uploadPump = bodyStream.pipeTo(fixed.writable);
				uploadValue = fixed.readable;
		} else {
			try {
				const bytes = await readStreamToBytes(bodyStream, MAX_BYTES);
				size = bytes.byteLength;
				uploadValue = bytes;
			} catch (err: any) {
				const msg = String(err?.message || "");
				if (/too large/i.test(msg)) {
					return c.json({ error: "file is too large (max 30MB)" }, 413);
				}
				throw err;
			}
		}
	}

	const ext = detectUploadExtensionFromMeta({
		contentType,
		fileName: originalName || undefined,
	});
	const key = buildUserUploadKey(userId, ext);

	if (!uploadValue) {
		return c.json({ error: "request body is required" }, 400);
	}
	try {
		const client = createRustfsClient(c.env);
		let rustfsBody: any = uploadValue;
		let rustfsContentLength: number | undefined =
			typeof size === "number" && Number.isFinite(size) ? size : undefined;

		if (isNode) {
			if (uploadValue instanceof Uint8Array) {
				rustfsBody = uploadValue;
				rustfsContentLength = uploadValue.byteLength;
			} else if (uploadValue instanceof ArrayBuffer) {
				const bytes = new Uint8Array(uploadValue);
				rustfsBody = bytes;
				rustfsContentLength = bytes.byteLength;
			} else if (uploadValue instanceof Blob) {
				const bytes = new Uint8Array(await uploadValue.arrayBuffer());
				rustfsBody = bytes;
				rustfsContentLength = bytes.byteLength;
			}
		}

		const putPromise = client.send(
			new PutObjectCommand({
				Bucket: rustfsConfig.bucket,
				Key: key,
				Body: rustfsBody,
				ContentType: contentType,
				CacheControl: "public, max-age=31536000, immutable",
				ContentLength: rustfsContentLength,
			}),
		);
		if (uploadPump) {
			await Promise.all([putPromise, uploadPump]);
		} else {
			await putPromise;
		}
	} catch (err: any) {
		const msg = String(err?.message || "");
		if (/too large/i.test(msg)) {
			return c.json({ error: "file is too large (max 30MB)" }, 413);
		}
		throw err;
	}

	const publicBase = getPublicBase(c);
	const url = publicBase ? `${publicBase}/${key}` : `/${key}`;

	const nowIso = new Date().toISOString();
	const row = await createAssetRow(
		c.env.DB,
		userId,
		{
			name,
			data: {
				kind: "upload",
				type: kind,
				url,
				contentType,
				size,
				originalName: originalName || null,
				key,
				prompt,
				vendor,
				modelKey,
				taskKind,
			},
			projectId,
		},
		nowIso,
	);
	const payload = ServerAssetSchema.parse({
		id: row.id,
		name: row.name,
		data: row.data ? JSON.parse(row.data) : null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userId,
		projectId: row.project_id,
	});
	return c.json(payload);
});

function isBlockedProxyImageHost(hostname: string): boolean {
	const host = hostname.trim().toLowerCase();
	if (!host) return true;
	if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
	if (host.endsWith(".local")) return true;
	if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
	if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
	if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
	if (/^169\.254\.\d+\.\d+$/.test(host)) return true;
	return false;
}

// Proxy image: /assets/proxy-image?url=...
// Used by the 3D image view editor so remote reference images can be textured without relying on third-party WebGL CORS.
assetRouter.get("/proxy-image", authMiddleware, async (c) => {
	const raw = (c.req.query("url") || "").trim();
	if (!raw) {
		return c.json({ message: "url is required" }, 400);
	}
	let target = raw;
	try {
		target = decodeURIComponent(raw);
	} catch {
		// ignore
	}
	if (!/^https?:\/\//i.test(target)) {
		return c.json({ message: "only http/https urls are allowed" }, 400);
	}

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		return c.json({ message: "invalid url" }, 400);
	}

	if (isBlockedProxyImageHost(parsed.hostname)) {
		return c.json({ message: "upstream host is not allowed" }, 400);
	}

	try {
		const resp = await fetchWithHttpDebugLog(
			c,
			target,
			{
				headers: {
					Accept: "image/*",
					Origin: "https://jarvishub.local",
				},
			},
			{ tag: "asset:proxy-image" },
		);
		if (!resp.ok) {
			return c.json({ message: `fetch upstream failed: ${resp.status}` }, 502);
		}

		const contentType = resp.headers.get("content-type") || "";
		if (!/^image\//i.test(contentType)) {
			return c.json({ message: `upstream is not an image: ${contentType || "unknown"}` }, 400);
		}

		const headers = new Headers();
		headers.set("Content-Type", contentType || "image/jpeg");
		const contentLength = resp.headers.get("content-length");
		if (contentLength) headers.set("Content-Length", contentLength);
		headers.set("Cache-Control", "private, max-age=300");

		return new Response(resp.body, {
			status: 200,
			headers,
		});
	} catch (err: unknown) {
		return c.json(
			{ message: err instanceof Error ? err.message : "image proxy failed" },
			500,
		);
	}
});

// Proxy video: /assets/proxy-video?url=...
// Used by WebCut (which loads MP4 via fetch/streams and thus needs CORS-compatible responses).
assetRouter.get("/proxy-video", authMiddleware, async (c) => {
	const raw = (c.req.query("url") || "").trim();
	if (!raw) {
		return c.json({ message: "url is required" }, 400);
	}
	let target = raw;
	try {
		target = decodeURIComponent(raw);
	} catch {
		// ignore
	}
	if (!/^https?:\/\//i.test(target)) {
		return c.json({ message: "only http/https urls are allowed" }, 400);
	}

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		return c.json({ message: "invalid url" }, 400);
	}

	// Safety: avoid becoming a general-purpose open proxy (even though it's auth-protected).
	// Extend this allowlist if you need to support more upstreams.
	const host = parsed.hostname.toLowerCase();
	let r2PublicHost: string | null = null;
	try {
		const r2PublicBase = getPublicBase(c);
		if (r2PublicBase) {
			r2PublicHost = new URL(r2PublicBase).hostname.toLowerCase();
		}
	} catch {
		r2PublicHost = null;
	}

	const allowed =
		host === "videos.openai.com" ||
		host.endsWith(".openai.com") ||
		host.endsWith(".openaiusercontent.com") ||
		(!!r2PublicHost && host === r2PublicHost);
	if (!allowed) {
		return c.json({ message: "upstream host is not allowed" }, 400);
	}

	try {
		const range = c.req.header("range") || c.req.header("Range") || null;
		const resp = await fetchWithHttpDebugLog(
			c,
			target,
			{
				headers: {
					Origin: "https://jarvishub.local",
					...(range ? { Range: range } : null),
				},
			},
			{ tag: "asset:proxy-video" },
		);

		// Allow 200/206 only
		if (!(resp.status === 200 || resp.status === 206)) {
			return c.json(
				{ message: `fetch upstream failed: ${resp.status}` },
				502,
			);
		}

		const ct = resp.headers.get("content-type") || "";
		if (!/^video\//i.test(ct) && !/mp4/i.test(ct)) {
			return c.json({ message: `upstream is not a video: ${ct || "unknown"}` }, 400);
		}

		const headers = new Headers();
		headers.set("Content-Type", ct || "video/mp4");
		const contentLength = resp.headers.get("content-length");
		if (contentLength) headers.set("Content-Length", contentLength);
		const acceptRanges = resp.headers.get("accept-ranges");
		if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);
		const contentRange = resp.headers.get("content-range");
		if (contentRange) headers.set("Content-Range", contentRange);
		const origin = c.req.header("origin") || "";
		headers.set("Access-Control-Allow-Origin", origin || "*");
		headers.set("Access-Control-Allow-Credentials", "true");
		headers.set(
			"Access-Control-Expose-Headers",
			"Content-Length,Content-Range,Accept-Ranges",
		);
		headers.set("Vary", "Origin");

		// Signed URLs should not be cached for long.
		headers.set("Cache-Control", "private, max-age=60");

		return new Response(resp.body, {
			status: resp.status,
			headers,
		});
	} catch (err: any) {
		return c.json(
			{ message: err?.message || "proxy video failed" },
			500,
		);
	}
});

assetRouter.post("/character-library/import", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const projectId = normalizeOptionalText(body.projectId, 128) ?? null;
	const sourceAuthorization = normalizeTapNowText(body.sourceAuthorization);
	const sourceDeviceId = normalizeTapNowText(body.sourceDeviceId) || crypto.randomUUID();
	const sourceTimezone = normalizeTapNowText(body.sourceTimezone) || "Asia/Shanghai";
	const sourceLanguage = normalizeTapNowText(body.sourceLanguage) || "zh-CN";
	const sourceBrowserLocale = normalizeTapNowText(body.sourceBrowserLocale) || sourceLanguage;
	const upstreamFilters: TapNowCharacterFilterInput = {
		filterWorldview: normalizeTapNowFilterInput(body.filterWorldview),
		filterTheme: normalizeTapNowFilterInput(body.filterTheme),
		gender: normalizeTapNowFilterInput(body.gender),
		ageGroup: normalizeTapNowFilterInput(body.ageGroup),
		species: normalizeTapNowFilterInput(body.species),
		physique: normalizeTapNowFilterInput(body.physique),
		heightLevel: normalizeTapNowFilterInput(body.heightLevel),
		skinColor: normalizeTapNowFilterInput(body.skinColor),
		hairLength: normalizeTapNowFilterInput(body.hairLength),
		hairColor: normalizeTapNowFilterInput(body.hairColor),
		temperament: normalizeTapNowFilterInput(body.temperament),
	};
	const limitUpload = createAsyncLimiter(5);

	if (!sourceAuthorization) {
		return c.json({ error: "sourceAuthorization is required" }, 400);
	}

	const existingRows = await listAssetsForUserByKind(c.env.DB, userId, {
		kind: "aiCharacterLibraryCharacter",
		projectId,
		limit: 5000,
	});
	const existingMap = new Map<
		string,
		{ id: string; name: string; data: ImportedCharacterLibraryRecord }
	>();
	for (const row of existingRows) {
		const parsed = parseImportedCharacterAsset(parseAssetJson(row.data));
		if (!parsed) continue;
		existingMap.set(parsed.sourceCharacterUid, {
			id: row.id,
			name: row.name,
			data: parsed,
		});
	}

	let importedCount = 0;
	let updatedCount = 0;
	let offset = 0;
	let total = 0;
	const pageSize = 30;
	const nowIso = new Date().toISOString();

	while (true) {
		const page = await fetchTapNowCharacterPage({
			c,
			offset,
			limit: pageSize,
			sourceAuthorization,
			sourceDeviceId,
			sourceTimezone,
			sourceLanguage,
			sourceBrowserLocale,
			filters: upstreamFilters,
		});
		const records = page.characters;
		if (!total && page.total > 0) total = page.total;
		if (!records.length) break;

		await Promise.all(records.map(async (record) => {
			const sourceCharacterUid = buildImportedCharacterUid(record);
			const existing = existingMap.get(sourceCharacterUid) || null;
			const sourceImageUrls = {
				fullBody: normalizeTapNowText(record.full_body_image_url),
				threeView: normalizeTapNowText(record.three_view_image_url),
				expression: normalizeTapNowText(record.expression_image_url),
				closeup: normalizeTapNowText(record.closeup_image_url),
			};
			const importedImageUrls = {
				fullBody:
					existing?.data.sourceImageUrls.fullBody === sourceImageUrls.fullBody
						? existing.data.importedImageUrls.fullBody
						: await limitUpload(() => uploadImportedCharacterImage({
								c,
								userId,
								sourceUrl: sourceImageUrls.fullBody,
								sourceAuthorization,
								sourceDeviceId,
								sourceTimezone,
								sourceLanguage,
								sourceBrowserLocale,
							})),
				threeView:
					existing?.data.sourceImageUrls.threeView === sourceImageUrls.threeView
						? existing.data.importedImageUrls.threeView
						: await limitUpload(() => uploadImportedCharacterImage({
								c,
								userId,
								sourceUrl: sourceImageUrls.threeView,
								sourceAuthorization,
								sourceDeviceId,
								sourceTimezone,
								sourceLanguage,
								sourceBrowserLocale,
							})),
				expression:
					existing?.data.sourceImageUrls.expression === sourceImageUrls.expression
						? existing.data.importedImageUrls.expression
						: await limitUpload(() => uploadImportedCharacterImage({
								c,
								userId,
								sourceUrl: sourceImageUrls.expression,
								sourceAuthorization,
								sourceDeviceId,
								sourceTimezone,
								sourceLanguage,
								sourceBrowserLocale,
							})),
				closeup:
					existing?.data.sourceImageUrls.closeup === sourceImageUrls.closeup
						? existing.data.importedImageUrls.closeup
						: await limitUpload(() => uploadImportedCharacterImage({
								c,
								userId,
								sourceUrl: sourceImageUrls.closeup,
								sourceAuthorization,
								sourceDeviceId,
								sourceTimezone,
								sourceLanguage,
								sourceBrowserLocale,
							})),
			};

			const payload: ImportedCharacterLibraryRecord = {
				kind: "aiCharacterLibraryCharacter",
				source: "tapnow",
				sourceCharacterUid,
				sourceCharacterId: normalizeTapNowText(record.character_id),
				sourceGroupNumber: normalizeTapNowText(record.group_number),
				era: normalizeTapNowText(record.era),
				culturalRegion: normalizeTapNowText(record.cultural_region),
				genre: normalizeTapNowText(record.genre),
				timePeriod: normalizeTapNowText(record.time_period),
				appearanceBackground: normalizeTapNowText(record.appearance_background),
				scene: normalizeTapNowText(record.scene),
				gender: normalizeTapNowText(record.gender),
				ageGroup: normalizeTapNowText(record.age_group),
				species: normalizeTapNowText(record.species),
				physique: normalizeTapNowText(record.physique),
				heightLevel: normalizeTapNowText(record.height_level),
				skinColor: normalizeTapNowText(record.skin_color),
				hairLength: normalizeTapNowText(record.hair_length),
				hairColor: normalizeTapNowText(record.hair_color),
				temperament: normalizeTapNowText(record.temperament),
				outfit: normalizeTapNowText(record.outfit),
				distinctiveFeatures: normalizeTapNowText(record.distinctive_features),
				identityHint: normalizeTapNowText(record.identity_hint),
				filterWorldview: normalizeTapNowText(record.filter_worldview),
				filterTheme: normalizeTapNowText(record.filter_theme),
				filterScene: normalizeTapNowText(record.filter_scene),
				sourceImageUrls,
				importedImageUrls,
				importedAt: existing?.data.importedAt || nowIso,
				updatedAt: nowIso,
			};

			const assetName =
				normalizeTapNowText(record.identity_hint) ||
				normalizeTapNowText(record.character_id) ||
				normalizeTapNowText(record.id) ||
				"AI角色";
			if (existing?.id) {
				await updateAssetDataRow(c.env.DB, userId, existing.id, payload, nowIso);
				updatedCount += 1;
				existingMap.set(sourceCharacterUid, { id: existing.id, name: assetName, data: payload });
			} else {
				const created = await createAssetRow(
					c.env.DB,
					userId,
					{ name: assetName, data: payload, projectId },
					nowIso,
				);
				importedCount += 1;
				existingMap.set(sourceCharacterUid, { id: created.id, name: assetName, data: payload });
			}
		}));

		offset += records.length;
		if (records.length < pageSize) break;
		if (total > 0 && offset >= total) break;
	}

	const syncStateRows = await listAssetsForUserByKind(c.env.DB, userId, {
		kind: "aiCharacterLibraryImportState",
		projectId,
		limit: 10,
	});
	const syncPayload: ImportedCharacterLibrarySyncState = {
		kind: "aiCharacterLibraryImportState",
		source: "tapnow",
		totalCharacters: total || existingMap.size,
		importedCharacters: existingMap.size,
		lastSyncedAt: nowIso,
	};
	const syncStateRow = syncStateRows[0] || null;
	if (syncStateRow?.id) {
		await updateAssetDataRow(c.env.DB, userId, syncStateRow.id, syncPayload, nowIso);
	} else {
		await createAssetRow(
			c.env.DB,
			userId,
			{ name: "AI角色库导入状态", data: syncPayload, projectId },
			nowIso,
		);
	}

	return c.json({
		ok: true,
		totalCharacters: total || existingMap.size,
		importedCharacters: importedCount,
		updatedCharacters: updatedCount,
		storedCharacters: existingMap.size,
		lastSyncedAt: nowIso,
	});
});

assetRouter.get("/character-library/characters", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const requestUrl = new URL(c.req.url);
	const projectId = normalizeOptionalText(c.req.query("projectId"), 128) ?? null;
	const query = normalizeTapNowText(c.req.query("q"));
	const pageRaw = Number(c.req.query("page") || 0);
	const pageSizeRaw = Number(c.req.query("pageSize") || 0);
	const offsetRaw = Number(c.req.query("offset") || 0);
	const limitRaw = Number(c.req.query("limit") || 30);
	const page =
		Number.isFinite(pageRaw) && pageRaw > 0 ? Math.trunc(pageRaw) : 0;
	const pageSize =
		Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
			? Math.max(1, Math.min(Math.trunc(pageSizeRaw), 200))
			: 0;
	const offset =
		Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.trunc(offsetRaw) : 0;
	const limit =
		Number.isFinite(limitRaw) && limitRaw > 0
			? Math.max(1, Math.min(Math.trunc(limitRaw), 200))
			: 30;
	const worldview = readTapNowFilterValuesFromUrl(requestUrl, "filter_worldview");
	const theme = readTapNowFilterValuesFromUrl(requestUrl, "filter_theme");
	const gender = readTapNowFilterValuesFromUrl(requestUrl, "gender");
	const ageGroup = readTapNowFilterValuesFromUrl(requestUrl, "age_group");
	const species = readTapNowFilterValuesFromUrl(requestUrl, "species");
	const physique = readTapNowFilterValuesFromUrl(requestUrl, "physique");
	const heightLevel = readTapNowFilterValuesFromUrl(requestUrl, "height_level");
	const skinColor = readTapNowFilterValuesFromUrl(requestUrl, "skin_color");
	const hairLength = readTapNowFilterValuesFromUrl(requestUrl, "hair_length");
	const hairColor = readTapNowFilterValuesFromUrl(requestUrl, "hair_color");
	const temperament = readTapNowFilterValuesFromUrl(requestUrl, "temperament");

	const rows = await listAssetsForUserByKind(c.env.DB, userId, {
		kind: "aiCharacterLibraryCharacter",
		projectId,
		limit: 5000,
	});
	const items = rows
		.map((row) => {
			const parsed = parseImportedCharacterAsset(parseAssetJson(row.data));
			if (!parsed) return null;
			return {
				id: row.id,
				name: row.name,
				projectId: row.project_id,
				...toImportedCharacterResponse(parsed),
			};
		})
		.filter((item): item is ImportedCharacterLibraryListItem => item !== null)
		.filter((item) => matchesImportedCharacterQuery(item, query))
		.filter((item) => {
			if (!matchesTapNowFilter(item.filter_worldview, worldview)) return false;
			if (!matchesTapNowFilter(item.filter_theme, theme)) return false;
			if (!matchesTapNowFilter(item.gender, gender)) return false;
			if (!matchesTapNowFilter(item.age_group, ageGroup)) return false;
			if (!matchesTapNowFilter(item.species, species)) return false;
			if (!matchesTapNowFilter(item.physique, physique)) return false;
			if (!matchesTapNowFilter(item.height_level, heightLevel)) return false;
			if (!matchesTapNowFilter(item.skin_color, skinColor)) return false;
			if (!matchesTapNowFilter(item.hair_length, hairLength)) return false;
			if (!matchesTapNowFilter(item.hair_color, hairColor)) return false;
			if (!matchesTapNowFilter(item.temperament, temperament)) return false;
			return true;
		})
		.sort((a, b) => {
			const bTime = Date.parse(b.updated_at || "");
			const aTime = Date.parse(a.updated_at || "");
			if (Number.isFinite(bTime) && Number.isFinite(aTime) && bTime !== aTime) {
				return bTime - aTime;
			}
			return a.name.localeCompare(b.name, "zh-CN");
		});
	const effectiveLimit = pageSize || limit;
	const effectiveOffset = page > 0 ? (page - 1) * effectiveLimit : offset;

	const syncStateRows = await listAssetsForUserByKind(c.env.DB, userId, {
		kind: "aiCharacterLibraryImportState",
		projectId,
		limit: 10,
	});
	const syncState =
		parseImportedCharacterSyncState(parseAssetJson(syncStateRows[0]?.data ?? null)) ?? null;

	return c.json({
		characters: items.slice(effectiveOffset, effectiveOffset + effectiveLimit),
		total: items.length,
		page: page > 0 ? page : undefined,
		pageSize: effectiveLimit,
		syncState: syncState
			? {
					totalCharacters: syncState.totalCharacters,
					importedCharacters: syncState.importedCharacters,
					lastSyncedAt: syncState.lastSyncedAt,
				}
			: null,
	});
});

assetRouter.post("/character-library/characters", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const nowIso = new Date().toISOString();
	const body = (await c.req.json().catch(() => null)) as unknown;
	if (!body || typeof body !== "object") {
		return c.json({ error: "角色库记录必须是对象" }, 400);
	}
	const payload = body as ImportedCharacterLibraryUpsertInput;
	const projectId = normalizeImportedCharacterProjectId(payload.projectId);
	try {
		const normalized = normalizeImportedCharacterPayload({
			raw: payload,
			nowIso,
		});
		const created = await createAssetRow(
			c.env.DB,
			userId,
			{ name: normalized.name, data: normalized.record, projectId },
			nowIso,
		);
		await refreshImportedCharacterLibrarySyncState({
			c,
			userId,
			projectId,
			nowIso,
		});
		return c.json({
			character: {
				id: created.id,
				name: created.name,
				projectId: created.project_id,
				...toImportedCharacterResponse(normalized.record),
			},
		});
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "创建角色库记录失败" },
			400,
		);
	}
});

assetRouter.put("/character-library/characters/:id", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = normalizeTapNowText(c.req.param("id"));
	if (!id) return c.json({ error: "id is required" }, 400);
	const row = await getAssetByIdForUser(c.env.DB, id, userId);
	if (!row) return c.json({ error: "角色库记录不存在" }, 404);
	const existing = parseImportedCharacterAsset(parseAssetJson(row.data));
	if (!existing) return c.json({ error: "目标资产不是角色库记录" }, 400);
	const body = (await c.req.json().catch(() => null)) as unknown;
	if (!body || typeof body !== "object") {
		return c.json({ error: "角色库记录必须是对象" }, 400);
	}
	const payload = body as ImportedCharacterLibraryUpsertInput;
	const nowIso = new Date().toISOString();
	const projectId =
		normalizeImportedCharacterProjectId(payload.projectId) ??
		normalizeImportedCharacterProjectId(row.project_id);
	try {
		const normalized = normalizeImportedCharacterPayload({
			raw: payload,
			nowIso,
			existing,
		});
		await updateAssetDataRow(c.env.DB, userId, id, normalized.record, nowIso);
		if (normalizeTapNowText(payload.name) && normalizeTapNowText(payload.name) !== row.name) {
			await renameAssetRow(c.env.DB, userId, id, normalizeTapNowText(payload.name), nowIso);
		}
		await refreshImportedCharacterLibrarySyncState({
			c,
			userId,
			projectId,
			nowIso,
		});
		return c.json({
			character: {
				id,
				name: normalizeTapNowText(payload.name) || row.name,
				projectId,
				...toImportedCharacterResponse(normalized.record),
			},
		});
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "更新角色库记录失败" },
			400,
		);
	}
});

assetRouter.delete("/character-library/characters/:id", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = normalizeTapNowText(c.req.param("id"));
	if (!id) return c.json({ error: "id is required" }, 400);
	const row = await getAssetByIdForUser(c.env.DB, id, userId);
	if (!row) return c.json({ error: "角色库记录不存在" }, 404);
	const existing = parseImportedCharacterAsset(parseAssetJson(row.data));
	if (!existing) return c.json({ error: "目标资产不是角色库记录" }, 400);
	const nowIso = new Date().toISOString();
	const projectId = normalizeImportedCharacterProjectId(row.project_id);
	await deleteAssetRow(c.env.DB, userId, id);
	await refreshImportedCharacterLibrarySyncState({
		c,
		userId,
		projectId,
		nowIso,
	});
	return c.json({ ok: true });
});

assetRouter.post("/character-library/import-json", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => null)) as unknown;
	const { projectId, charactersRaw } = extractCharacterLibraryImportEnvelope(body);
	if (!charactersRaw.length) {
		return c.json({ error: "JSON 导入内容不能为空。支持数组、{characters:[...]}，以及 code/content/payload 包裹的 JSON / ```json code``` 文本" }, 400);
	}
	const existingRows = await listAssetsForUserByKind(c.env.DB, userId, {
		kind: "aiCharacterLibraryCharacter",
		projectId,
		limit: 5000,
	});
	const existingByUid = new Map<
		string,
		{ rowId: string; name: string; projectId: string | null; data: ImportedCharacterLibraryRecord }
	>();
	for (const row of existingRows) {
		const parsed = parseImportedCharacterAsset(parseAssetJson(row.data));
		if (!parsed) continue;
		existingByUid.set(parsed.sourceCharacterUid, {
			rowId: row.id,
			name: row.name,
			projectId: row.project_id,
			data: parsed,
		});
	}
	const nowIso = new Date().toISOString();
	let importedCount = 0;
	let updatedCount = 0;
	for (const item of charactersRaw) {
		const payload =
			item && typeof item === "object"
				? ({
						...(item as Record<string, unknown>),
						...(projectId ? { projectId } : {}),
					} as ImportedCharacterLibraryUpsertInput)
				: item;
		const draft = normalizeImportedCharacterPayload({
			raw: payload,
			nowIso,
		});
		const existing = existingByUid.get(draft.record.sourceCharacterUid) || null;
		const targetProjectId =
			projectId ??
			(existing ? normalizeImportedCharacterProjectId(existing.projectId) : null);
		if (existing?.rowId) {
			const merged = normalizeImportedCharacterPayload({
				raw: payload,
				nowIso,
				existing: existing.data,
			});
			await updateAssetDataRow(c.env.DB, userId, existing.rowId, merged.record, nowIso);
			if (merged.name !== existing.name) {
				await renameAssetRow(c.env.DB, userId, existing.rowId, merged.name, nowIso);
			}
			existingByUid.set(merged.record.sourceCharacterUid, {
				rowId: existing.rowId,
				name: merged.name,
				projectId: targetProjectId,
				data: merged.record,
			});
			updatedCount += 1;
		} else {
			const created = await createAssetRow(
				c.env.DB,
				userId,
				{
					name: draft.name,
					data: draft.record,
					projectId: targetProjectId,
				},
				nowIso,
			);
			existingByUid.set(draft.record.sourceCharacterUid, {
				rowId: created.id,
				name: draft.name,
				projectId: targetProjectId,
				data: draft.record,
			});
			importedCount += 1;
		}
	}
	const storedCount = await refreshImportedCharacterLibrarySyncState({
		c,
		userId,
		projectId,
		nowIso,
	});
	return c.json({
		ok: true,
		importedCharacters: importedCount,
		updatedCharacters: updatedCount,
		storedCharacters: storedCount,
		lastSyncedAt: nowIso,
	});
});

type ImportedCharacterLibraryRecord = {
	kind: "aiCharacterLibraryCharacter";
	source: "tapnow" | "json";
	sourceCharacterUid: string;
	sourceCharacterId: string;
	sourceGroupNumber: string;
	era: string;
	culturalRegion: string;
	genre: string;
	timePeriod: string;
	appearanceBackground: string;
	scene: string;
	gender: string;
	ageGroup: string;
	species: string;
	physique: string;
	heightLevel: string;
	skinColor: string;
	hairLength: string;
	hairColor: string;
	temperament: string;
	outfit: string;
	distinctiveFeatures: string;
	identityHint: string;
	filterWorldview: string;
	filterTheme: string;
	filterScene: string;
	sourceImageUrls: {
		fullBody: string;
		threeView: string;
		expression: string;
		closeup: string;
	};
	importedImageUrls: {
		fullBody: string;
		threeView: string;
		expression: string;
		closeup: string;
	};
	importedAt: string;
	updatedAt: string;
};

type ImportedCharacterLibrarySyncState = {
	kind: "aiCharacterLibraryImportState";
	source: "tapnow" | "local";
	totalCharacters: number;
	importedCharacters: number;
	lastSyncedAt: string;
};

type ImportedCharacterLibraryUpsertInput = {
	name?: unknown;
	projectId?: unknown;
	sourceCharacterUid?: unknown;
	character_id?: unknown;
	group_number?: unknown;
	era?: unknown;
	cultural_region?: unknown;
	genre?: unknown;
	time_period?: unknown;
	appearance_background?: unknown;
	scene?: unknown;
	gender?: unknown;
	age_group?: unknown;
	species?: unknown;
	physique?: unknown;
	height_level?: unknown;
	skin_color?: unknown;
	hair_length?: unknown;
	hair_color?: unknown;
	temperament?: unknown;
	outfit?: unknown;
	distinctive_features?: unknown;
	identity_hint?: unknown;
	filter_worldview?: unknown;
	filter_theme?: unknown;
	filter_scene?: unknown;
	full_body_image_url?: unknown;
	three_view_image_url?: unknown;
	expression_image_url?: unknown;
	closeup_image_url?: unknown;
	source_full_body_image_url?: unknown;
	source_three_view_image_url?: unknown;
	source_expression_image_url?: unknown;
	source_closeup_image_url?: unknown;
	imported_at?: unknown;
};

type TapNowCharacterRecord = {
	id?: string;
	character_id?: string;
	group_number?: string;
	era?: string;
	cultural_region?: string;
	genre?: string;
	time_period?: string;
	appearance_background?: string;
	scene?: string;
	gender?: string;
	age_group?: string;
	species?: string;
	physique?: string;
	height_level?: string;
	skin_color?: string;
	hair_length?: string;
	hair_color?: string;
	temperament?: string;
	outfit?: string;
	distinctive_features?: string;
	identity_hint?: string;
	full_body_image_url?: string;
	three_view_image_url?: string;
	expression_image_url?: string;
	closeup_image_url?: string;
	filter_worldview?: string;
	filter_theme?: string;
	filter_scene?: string;
};

type ImportedCharacterLibraryListItem = {
	id: string;
	name: string;
	projectId: string | null;
	character_id: string;
	group_number: string;
	era: string;
	cultural_region: string;
	genre: string;
	time_period: string;
	appearance_background: string;
	scene: string;
	gender: string;
	age_group: string;
	species: string;
	physique: string;
	height_level: string;
	skin_color: string;
	hair_length: string;
	hair_color: string;
	temperament: string;
	outfit: string;
	distinctive_features: string;
	identity_hint: string;
	full_body_image_url: string;
	three_view_image_url: string;
	expression_image_url: string;
	closeup_image_url: string;
	filter_worldview: string;
	filter_theme: string;
	filter_scene: string;
	imported_at: string;
	updated_at: string;
};

function normalizeTapNowText(value: unknown): string {
	return String(value || "").trim();
}

function normalizeImportedCharacterProjectId(value: unknown): string | null {
	const text = normalizeTapNowText(value);
	return text ? text.slice(0, 128) : null;
}

function stripJsonCodeFence(text: string): string {
	const raw = String(text || "").trim();
	const match = raw.match(/^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i);
	return match?.[1] ? match[1].trim() : raw;
}

function tryParseJsonFromUnknown(value: unknown): unknown | null {
	if (typeof value !== "string") return null;
	const text = stripJsonCodeFence(value);
	if (!text) return null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}

function extractCharacterLibraryImportEnvelope(
	input: unknown,
): { projectId: string | null; charactersRaw: unknown[] } {
	const tryExtract = (
		value: unknown,
		projectIdHint?: string | null,
	): { projectId: string | null; charactersRaw: unknown[] } | null => {
		if (Array.isArray(value)) {
			return {
				projectId: projectIdHint ?? null,
				charactersRaw: value,
			};
		}
		if (!value || typeof value !== "object") return null;
		const record = value as Record<string, unknown>;
		const nextProjectId =
			normalizeImportedCharacterProjectId(record.projectId) ?? projectIdHint ?? null;
		if (Array.isArray(record.characters)) {
			return {
				projectId: nextProjectId,
				charactersRaw: record.characters,
			};
		}
		const nestedKeys = ["code", "content", "payload", "data", "body", "json"];
		for (const key of nestedKeys) {
			if (!(key in record)) continue;
			const nestedValue = record[key];
			const parsedNested =
				tryParseJsonFromUnknown(nestedValue) ??
				(typeof nestedValue === "object" ? nestedValue : null);
			const extracted = tryExtract(parsedNested, nextProjectId);
			if (extracted?.charactersRaw.length) return extracted;
		}
		return null;
	};

	const parsedTopLevel = tryParseJsonFromUnknown(input);
	const extracted = tryExtract(parsedTopLevel ?? input);
	return extracted ?? { projectId: null, charactersRaw: [] };
}

function normalizeTapNowFilterValues(value: unknown): string[] {
	if (Array.isArray(value)) {
		return Array.from(
			new Set(
				value
					.map((item) => normalizeTapNowText(item).toLowerCase())
					.filter(Boolean),
			),
		);
	}
	const text = normalizeTapNowText(value).toLowerCase();
	return text ? [text] : [];
}

function normalizeTapNowFilterInput(value: unknown): string | string[] | undefined {
	const values = normalizeTapNowFilterValues(value);
	if (values.length === 0) return undefined;
	return values.length === 1 ? values[0] : values;
}

function readTapNowFilterValuesFromUrl(url: URL, key: string): string[] {
	return Array.from(
		new Set(
			url.searchParams
				.getAll(key)
				.map((item) => normalizeTapNowText(item).toLowerCase())
				.filter(Boolean),
		),
	);
}

function matchesTapNowFilter(value: string, filters: string[]): boolean {
	if (!filters.length) return true;
	return filters.includes(normalizeTapNowText(value).toLowerCase());
}

type TapNowCharacterFilterInput = {
	filterWorldview?: string | string[];
	filterTheme?: string | string[];
	gender?: string | string[];
	ageGroup?: string | string[];
	species?: string | string[];
	physique?: string | string[];
	heightLevel?: string | string[];
	skinColor?: string | string[];
	hairLength?: string | string[];
	hairColor?: string | string[];
	temperament?: string | string[];
};

function appendTapNowFilterQuery(
	searchParams: URLSearchParams,
	key: string,
	value?: string | string[],
): void {
	for (const item of normalizeTapNowFilterValues(value)) {
		searchParams.append(key, item);
	}
}

function createAsyncLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
	const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 1;
	let active = 0;
	const queue: Array<() => void> = [];
	return async <T>(task: () => Promise<T>): Promise<T> => {
		if (active >= safeLimit) {
			await new Promise<void>((resolve) => {
				queue.push(resolve);
			});
		}
		active += 1;
		try {
			return await task();
		} finally {
			active = Math.max(0, active - 1);
			const next = queue.shift();
			if (next) next();
		}
	};
}

function buildImportedCharacterUid(record: TapNowCharacterRecord): string {
	const primary = normalizeTapNowText(record.id);
	if (primary) return primary;
	const fallback = `${normalizeTapNowText(record.group_number)}:${normalizeTapNowText(record.character_id)}`;
	if (fallback !== ":") return fallback;
	throw new Error("tapnow character record missing id");
}

function parseAssetJson(data: string | null | undefined): unknown {
	if (typeof data !== "string" || !data.trim()) return null;
	try {
		return JSON.parse(data);
	} catch {
		return null;
	}
}

function parseImportedCharacterAsset(data: unknown): ImportedCharacterLibraryRecord | null {
	if (!data || typeof data !== "object") return null;
	const raw = data as Record<string, unknown>;
	if (normalizeTapNowText(raw.kind) !== "aiCharacterLibraryCharacter") return null;
	const sourceCharacterUid = normalizeTapNowText(raw.sourceCharacterUid);
	if (!sourceCharacterUid) return null;
	const importedImageUrlsRaw =
		raw.importedImageUrls && typeof raw.importedImageUrls === "object"
			? (raw.importedImageUrls as Record<string, unknown>)
			: {};
	const sourceImageUrlsRaw =
		raw.sourceImageUrls && typeof raw.sourceImageUrls === "object"
			? (raw.sourceImageUrls as Record<string, unknown>)
			: {};
	return {
		kind: "aiCharacterLibraryCharacter",
		source: "tapnow",
		sourceCharacterUid,
		sourceCharacterId: normalizeTapNowText(raw.sourceCharacterId),
		sourceGroupNumber: normalizeTapNowText(raw.sourceGroupNumber),
		era: normalizeTapNowText(raw.era),
		culturalRegion: normalizeTapNowText(raw.culturalRegion),
		genre: normalizeTapNowText(raw.genre),
		timePeriod: normalizeTapNowText(raw.timePeriod),
		appearanceBackground: normalizeTapNowText(raw.appearanceBackground),
		scene: normalizeTapNowText(raw.scene),
		gender: normalizeTapNowText(raw.gender),
		ageGroup: normalizeTapNowText(raw.ageGroup),
		species: normalizeTapNowText(raw.species),
		physique: normalizeTapNowText(raw.physique),
		heightLevel: normalizeTapNowText(raw.heightLevel),
		skinColor: normalizeTapNowText(raw.skinColor),
		hairLength: normalizeTapNowText(raw.hairLength),
		hairColor: normalizeTapNowText(raw.hairColor),
		temperament: normalizeTapNowText(raw.temperament),
		outfit: normalizeTapNowText(raw.outfit),
		distinctiveFeatures: normalizeTapNowText(raw.distinctiveFeatures),
		identityHint: normalizeTapNowText(raw.identityHint),
		filterWorldview: normalizeTapNowText(raw.filterWorldview),
		filterTheme: normalizeTapNowText(raw.filterTheme),
		filterScene: normalizeTapNowText(raw.filterScene),
		sourceImageUrls: {
			fullBody: normalizeTapNowText(sourceImageUrlsRaw.fullBody),
			threeView: normalizeTapNowText(sourceImageUrlsRaw.threeView),
			expression: normalizeTapNowText(sourceImageUrlsRaw.expression),
			closeup: normalizeTapNowText(sourceImageUrlsRaw.closeup),
		},
		importedImageUrls: {
			fullBody: normalizeTapNowText(importedImageUrlsRaw.fullBody),
			threeView: normalizeTapNowText(importedImageUrlsRaw.threeView),
			expression: normalizeTapNowText(importedImageUrlsRaw.expression),
			closeup: normalizeTapNowText(importedImageUrlsRaw.closeup),
		},
		importedAt: normalizeTapNowText(raw.importedAt),
		updatedAt: normalizeTapNowText(raw.updatedAt),
	};
}

function parseImportedCharacterSyncState(
	data: unknown,
): ImportedCharacterLibrarySyncState | null {
	if (!data || typeof data !== "object") return null;
	const raw = data as Record<string, unknown>;
	if (normalizeTapNowText(raw.kind) !== "aiCharacterLibraryImportState") return null;
	const totalCharacters = Number(raw.totalCharacters);
	const importedCharacters = Number(raw.importedCharacters);
	const lastSyncedAt = normalizeTapNowText(raw.lastSyncedAt);
	if (!Number.isFinite(totalCharacters) || !Number.isFinite(importedCharacters)) {
		return null;
	}
	return {
		kind: "aiCharacterLibraryImportState",
		source: normalizeTapNowText(raw.source) === "local" ? "local" : "tapnow",
		totalCharacters: Math.max(0, Math.trunc(totalCharacters)),
		importedCharacters: Math.max(0, Math.trunc(importedCharacters)),
		lastSyncedAt,
	};
}

function toImportedCharacterResponse(
	record: ImportedCharacterLibraryRecord,
): Omit<ImportedCharacterLibraryListItem, "id" | "name" | "projectId"> {
	return {
		character_id: record.sourceCharacterId,
		group_number: record.sourceGroupNumber,
		era: record.era,
		cultural_region: record.culturalRegion,
		genre: record.genre,
		time_period: record.timePeriod,
		appearance_background: record.appearanceBackground,
		scene: record.scene,
		gender: record.gender,
		age_group: record.ageGroup,
		species: record.species,
		physique: record.physique,
		height_level: record.heightLevel,
		skin_color: record.skinColor,
		hair_length: record.hairLength,
		hair_color: record.hairColor,
		temperament: record.temperament,
		outfit: record.outfit,
		distinctive_features: record.distinctiveFeatures,
		identity_hint: record.identityHint,
		full_body_image_url: record.importedImageUrls.fullBody,
		three_view_image_url: record.importedImageUrls.threeView,
		expression_image_url: record.importedImageUrls.expression,
		closeup_image_url: record.importedImageUrls.closeup,
		filter_worldview: record.filterWorldview,
		filter_theme: record.filterTheme,
		filter_scene: record.filterScene,
		imported_at: record.importedAt,
		updated_at: record.updatedAt,
	};
}

function buildImportedCharacterUidFromInput(input: {
	sourceCharacterUid?: string;
	groupNumber?: string;
	characterId?: string;
	identityHint?: string;
	name?: string;
}): string {
	const explicitUid = normalizeTapNowText(input.sourceCharacterUid);
	if (explicitUid) return explicitUid;
	const composite = [
		normalizeTapNowText(input.groupNumber),
		normalizeTapNowText(input.characterId),
		normalizeTapNowText(input.identityHint),
		normalizeTapNowText(input.name),
	]
		.filter(Boolean)
		.join(":")
		.toLowerCase();
	if (!composite) {
		throw new Error("角色库记录缺少可用于生成唯一标识的字段");
	}
	return `json:${composite}`;
}

function normalizeImportedCharacterPayload(input: {
	raw: unknown;
	nowIso: string;
	existing?: ImportedCharacterLibraryRecord | null;
}): { name: string; record: ImportedCharacterLibraryRecord } {
	if (!input.raw || typeof input.raw !== "object") {
		throw new Error("角色库记录必须是对象");
	}
	const raw = input.raw as ImportedCharacterLibraryUpsertInput;
	const existing = input.existing || null;
	const sourceCharacterId = normalizeTapNowText(raw.character_id) || existing?.sourceCharacterId || "";
	const identityHint = normalizeTapNowText(raw.identity_hint) || existing?.identityHint || "";
	const name =
		normalizeTapNowText(raw.name) ||
		identityHint ||
		sourceCharacterId ||
		existing?.identityHint ||
		existing?.sourceCharacterId ||
		"AI角色";
	if (!name.trim()) {
		throw new Error("角色库记录缺少 name / identity_hint / character_id");
	}
	const sourceGroupNumber = normalizeTapNowText(raw.group_number) || existing?.sourceGroupNumber || "";
	const sourceCharacterUid = buildImportedCharacterUidFromInput({
		sourceCharacterUid: normalizeTapNowText(raw.sourceCharacterUid) || existing?.sourceCharacterUid || "",
		groupNumber: sourceGroupNumber,
		characterId: sourceCharacterId,
		identityHint,
		name,
	});
	const importedImageUrls = {
		fullBody:
			normalizeTapNowText(raw.full_body_image_url) ||
			existing?.importedImageUrls.fullBody ||
			"",
		threeView:
			normalizeTapNowText(raw.three_view_image_url) ||
			existing?.importedImageUrls.threeView ||
			"",
		expression:
			normalizeTapNowText(raw.expression_image_url) ||
			existing?.importedImageUrls.expression ||
			"",
		closeup:
			normalizeTapNowText(raw.closeup_image_url) ||
			existing?.importedImageUrls.closeup ||
			"",
	};
	const sourceImageUrls = {
		fullBody:
			normalizeTapNowText(raw.source_full_body_image_url) ||
			existing?.sourceImageUrls.fullBody ||
			importedImageUrls.fullBody,
		threeView:
			normalizeTapNowText(raw.source_three_view_image_url) ||
			existing?.sourceImageUrls.threeView ||
			importedImageUrls.threeView,
		expression:
			normalizeTapNowText(raw.source_expression_image_url) ||
			existing?.sourceImageUrls.expression ||
			importedImageUrls.expression,
		closeup:
			normalizeTapNowText(raw.source_closeup_image_url) ||
			existing?.sourceImageUrls.closeup ||
			importedImageUrls.closeup,
	};
	return {
		name,
		record: {
			kind: "aiCharacterLibraryCharacter",
			source: existing?.source === "tapnow" ? "tapnow" : "json",
			sourceCharacterUid,
			sourceCharacterId,
			sourceGroupNumber,
			era: normalizeTapNowText(raw.era) || existing?.era || "",
			culturalRegion:
				normalizeTapNowText(raw.cultural_region) || existing?.culturalRegion || "",
			genre: normalizeTapNowText(raw.genre) || existing?.genre || "",
			timePeriod:
				normalizeTapNowText(raw.time_period) || existing?.timePeriod || "",
			appearanceBackground:
				normalizeTapNowText(raw.appearance_background) ||
				existing?.appearanceBackground ||
				"",
			scene: normalizeTapNowText(raw.scene) || existing?.scene || "",
			gender: normalizeTapNowText(raw.gender) || existing?.gender || "",
			ageGroup: normalizeTapNowText(raw.age_group) || existing?.ageGroup || "",
			species: normalizeTapNowText(raw.species) || existing?.species || "",
			physique: normalizeTapNowText(raw.physique) || existing?.physique || "",
			heightLevel:
				normalizeTapNowText(raw.height_level) || existing?.heightLevel || "",
			skinColor:
				normalizeTapNowText(raw.skin_color) || existing?.skinColor || "",
			hairLength:
				normalizeTapNowText(raw.hair_length) || existing?.hairLength || "",
			hairColor:
				normalizeTapNowText(raw.hair_color) || existing?.hairColor || "",
			temperament:
				normalizeTapNowText(raw.temperament) || existing?.temperament || "",
			outfit: normalizeTapNowText(raw.outfit) || existing?.outfit || "",
			distinctiveFeatures:
				normalizeTapNowText(raw.distinctive_features) ||
				existing?.distinctiveFeatures ||
				"",
			identityHint,
			filterWorldview:
				normalizeTapNowText(raw.filter_worldview) || existing?.filterWorldview || "",
			filterTheme:
				normalizeTapNowText(raw.filter_theme) || existing?.filterTheme || "",
			filterScene:
				normalizeTapNowText(raw.filter_scene) || existing?.filterScene || "",
			sourceImageUrls,
			importedImageUrls,
			importedAt:
				normalizeTapNowText(raw.imported_at) ||
				existing?.importedAt ||
				input.nowIso,
			updatedAt: input.nowIso,
		},
	};
}

function matchesImportedCharacterQuery(
	item: ImportedCharacterLibraryListItem,
	query: string,
): boolean {
	const normalizedQuery = normalizeTapNowText(query).toLowerCase();
	if (!normalizedQuery) return true;
	const haystack = [
		item.name,
		item.character_id,
		item.group_number,
		item.identity_hint,
		item.era,
		item.cultural_region,
		item.genre,
		item.time_period,
		item.scene,
		item.gender,
		item.age_group,
		item.species,
		item.physique,
		item.height_level,
		item.skin_color,
		item.hair_length,
		item.hair_color,
		item.temperament,
		item.outfit,
		item.distinctive_features,
		item.filter_worldview,
		item.filter_theme,
		item.filter_scene,
	]
		.map((value) => normalizeTapNowText(value).toLowerCase())
		.filter(Boolean);
	return haystack.some((value) => value.includes(normalizedQuery));
}

async function refreshImportedCharacterLibrarySyncState(input: {
	c: AppContext;
	userId: string;
	projectId: string | null;
	nowIso: string;
	lastSyncedAt?: string;
}): Promise<number> {
	const rows = await listAssetsForUserByKind(input.c.env.DB, input.userId, {
		kind: "aiCharacterLibraryCharacter",
		projectId: input.projectId,
		limit: 5000,
	});
	const storedCount = rows.length;
	const syncPayload: ImportedCharacterLibrarySyncState = {
		kind: "aiCharacterLibraryImportState",
		source: "local",
		totalCharacters: storedCount,
		importedCharacters: storedCount,
		lastSyncedAt: input.lastSyncedAt || input.nowIso,
	};
	const syncStateRows = await listAssetsForUserByKind(input.c.env.DB, input.userId, {
		kind: "aiCharacterLibraryImportState",
		projectId: input.projectId,
		limit: 10,
	});
	const syncStateRow = syncStateRows[0] || null;
	if (syncStateRow?.id) {
		await updateAssetDataRow(
			input.c.env.DB,
			input.userId,
			syncStateRow.id,
			syncPayload,
			input.nowIso,
		);
	} else {
		await createAssetRow(
			input.c.env.DB,
			input.userId,
			{ name: "AI角色库导入状态", data: syncPayload, projectId: input.projectId },
			input.nowIso,
		);
	}
	return storedCount;
}

async function uploadImportedCharacterImage(input: {
	c: AppContext;
	userId: string;
	sourceUrl: string;
	sourceAuthorization: string;
	sourceDeviceId: string;
	sourceTimezone: string;
	sourceLanguage: string;
	sourceBrowserLocale: string;
}): Promise<string> {
	const targetUrl = normalizeTapNowText(input.sourceUrl);
	if (!targetUrl) return "";
	const rustfsConfig = resolveRustfsConfig(input.c.env);
	if (!rustfsConfig) {
		throw new Error("Object storage is not configured");
	}
	const response = await fetchWithHttpDebugLog(
		input.c,
		targetUrl,
		{
			headers: {
				Authorization: input.sourceAuthorization,
				"X-Device-ID": input.sourceDeviceId,
				"X-Timezone": input.sourceTimezone,
				"X-Device-Type": "web",
				"User-Lang": input.sourceLanguage,
				"X-Browser-Locale": input.sourceBrowserLocale,
			},
		},
		{ tag: "asset:import-character-image-source" },
	);
	if (!response.ok) {
		throw new Error(`character image upstream failed: ${response.status}`);
	}
	const contentType = normalizeContentType(response.headers.get("content-type") || "");
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (!bytes.byteLength) {
		throw new Error("character image upstream returned empty body");
	}
	const ext = detectUploadExtensionFromMeta({
		contentType,
		fileName: targetUrl.split("/").pop() || undefined,
	});
	const key = buildUserUploadKey(input.userId, ext);
	const client = createRustfsClient(input.c.env);
	await client.send(
		new PutObjectCommand({
			Bucket: rustfsConfig.bucket,
			Key: key,
			Body: bytes,
			ContentType: contentType || "image/jpeg",
			CacheControl: "public, max-age=31536000, immutable",
			ContentLength: bytes.byteLength,
		}),
	);
	const publicBase = getPublicBase(input.c);
	return publicBase ? `${publicBase}/${key}` : `/${key}`;
}

async function fetchTapNowCharacterPage(input: {
	c: AppContext;
	offset: number;
	limit: number;
	sourceAuthorization: string;
	sourceDeviceId: string;
	sourceTimezone: string;
	sourceLanguage: string;
	sourceBrowserLocale: string;
	filters?: TapNowCharacterFilterInput;
}): Promise<{ characters: TapNowCharacterRecord[]; total: number }> {
	const qs = new URLSearchParams();
	qs.set("offset", String(input.offset));
	qs.set("limit", String(input.limit));
	qs.set("with_total", "true");
	appendTapNowFilterQuery(qs, "filter_worldview", input.filters?.filterWorldview);
	appendTapNowFilterQuery(qs, "filter_theme", input.filters?.filterTheme);
	appendTapNowFilterQuery(qs, "gender", input.filters?.gender);
	appendTapNowFilterQuery(qs, "age_group", input.filters?.ageGroup);
	appendTapNowFilterQuery(qs, "species", input.filters?.species);
	appendTapNowFilterQuery(qs, "physique", input.filters?.physique);
	appendTapNowFilterQuery(qs, "height_level", input.filters?.heightLevel);
	appendTapNowFilterQuery(qs, "skin_color", input.filters?.skinColor);
	appendTapNowFilterQuery(qs, "hair_length", input.filters?.hairLength);
	appendTapNowFilterQuery(qs, "hair_color", input.filters?.hairColor);
	appendTapNowFilterQuery(qs, "temperament", input.filters?.temperament);
	const url = `https://app.tapnow.ai/api/canvas/v1/character-library/characters?${qs.toString()}`;
	const response = await fetchWithHttpDebugLog(
		input.c,
		url,
		{
			headers: {
				Authorization: input.sourceAuthorization,
				"X-Device-ID": input.sourceDeviceId,
				"X-Timezone": input.sourceTimezone,
				"X-Device-Type": "web",
				"User-Lang": input.sourceLanguage,
				"X-Browser-Locale": input.sourceBrowserLocale,
				Accept: "application/json",
			},
		},
		{ tag: "asset:import-character-library-page" },
	);
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`character library upstream failed: ${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`);
	}
	const payload = (await response.json()) as {
		code?: number;
		data?: {
			characters?: TapNowCharacterRecord[];
			total?: number;
		};
	};
	if (payload?.code !== 0) {
		throw new Error(`character library upstream code=${String(payload?.code ?? "unknown")}`);
	}
	return {
		characters: Array.isArray(payload?.data?.characters) ? payload.data.characters : [],
		total:
			typeof payload?.data?.total === "number" && Number.isFinite(payload.data.total)
				? payload.data.total
				: 0,
	};
}

assetRouter.get("/external/character-library/characters", authMiddleware, async (c) => {
	const authorization = c.req.header("authorization") || c.req.header("Authorization") || "";
	if (!authorization.trim()) {
		return c.json({ message: "authorization header is required" }, 401);
	}

	const requestUrl = new URL(c.req.url);
	const qs = new URLSearchParams();
	for (const key of [
		"offset",
		"limit",
		"with_total",
		"filter_worldview",
		"filter_theme",
		"gender",
		"age_group",
		"species",
		"physique",
		"height_level",
		"skin_color",
		"hair_length",
		"hair_color",
		"temperament",
	] as const) {
		for (const value of requestUrl.searchParams.getAll(key)) {
			const normalized = String(value || "").trim();
			if (normalized) qs.append(key, normalized);
		}
	}

	const targetUrl = `https://app.tapnow.ai/api/canvas/v1/character-library/characters${qs.toString() ? `?${qs.toString()}` : ""}`;
	try {
		const response = await fetchWithHttpDebugLog(
			c,
			targetUrl,
			{
				headers: {
					Authorization: authorization,
					"X-Device-ID": String(c.req.header("x-device-id") || c.req.header("X-Device-ID") || "").trim(),
					"X-Timezone": String(c.req.header("x-timezone") || c.req.header("X-Timezone") || "Asia/Shanghai").trim(),
					"X-Device-Type": String(c.req.header("x-device-type") || c.req.header("X-Device-Type") || "web").trim(),
					"User-Lang": String(c.req.header("user-lang") || c.req.header("User-Lang") || "zh-CN").trim(),
					"X-Browser-Locale": String(c.req.header("x-browser-locale") || c.req.header("X-Browser-Locale") || "zh-CN").trim(),
					Accept: "application/json",
				},
			},
			{ tag: "asset:external-character-library" },
		);
		const text = await response.text();
		if (!response.ok) {
			return c.json(
				{ message: `character library upstream failed: ${response.status}`, details: text.slice(0, 2000) },
				502,
			);
		}
		return new Response(text, {
			status: 200,
			headers: {
				"Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
				"Cache-Control": "private, max-age=30",
			},
		});
	} catch (err: unknown) {
		return c.json(
			{ message: err instanceof Error ? err.message : "character library proxy failed" },
			500,
		);
	}
});

assetRouter.get("/external/character-library/image", authMiddleware, async (c) => {
	const authorization = c.req.header("authorization") || c.req.header("Authorization") || "";
	if (!authorization.trim()) {
		return c.json({ message: "authorization header is required" }, 401);
	}

	const raw = String(c.req.query("url") || "").trim();
	if (!raw) {
		return c.json({ message: "url is required" }, 400);
	}

	let target = raw;
	try {
		target = decodeURIComponent(raw);
	} catch {
		target = raw;
	}

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		return c.json({ message: "invalid url" }, 400);
	}

	const host = parsed.hostname.toLowerCase();
	const pathname = parsed.pathname;
	if (host !== "app.tapnow.ai" || !pathname.startsWith("/api/conversation/storage/uploads/")) {
		return c.json({ message: "upstream host is not allowed" }, 400);
	}

	try {
		const response = await fetchWithHttpDebugLog(
			c,
			target,
			{
				headers: {
					Authorization: authorization,
					"X-Device-ID": String(c.req.header("x-device-id") || c.req.header("X-Device-ID") || "").trim(),
					"X-Timezone": String(c.req.header("x-timezone") || c.req.header("X-Timezone") || "Asia/Shanghai").trim(),
					"X-Device-Type": String(c.req.header("x-device-type") || c.req.header("X-Device-Type") || "web").trim(),
					"User-Lang": String(c.req.header("user-lang") || c.req.header("User-Lang") || "zh-CN").trim(),
					"X-Browser-Locale": String(c.req.header("x-browser-locale") || c.req.header("X-Browser-Locale") || "zh-CN").trim(),
				},
			},
			{ tag: "asset:external-character-library-image" },
		);
		if (!response.ok) {
			return c.json({ message: `image upstream failed: ${response.status}` }, 502);
		}
		const headers = new Headers();
		headers.set("Content-Type", response.headers.get("content-type") || "image/jpeg");
		const contentLength = response.headers.get("content-length");
		if (contentLength) headers.set("Content-Length", contentLength);
		headers.set("Cache-Control", "private, max-age=300");
		return new Response(response.body, {
			status: 200,
			headers,
		});
	} catch (err: unknown) {
		return c.json(
			{ message: err instanceof Error ? err.message : "character library image proxy failed" },
			500,
		);
	}
});
