import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { ToolContext, ToolHandler } from "./registry.js";

export type RetrievalRecordKind =
  | "component_reference_search"
  | "font_recommendation_search"
  | "icon_search"
  | "web_asset_search"
  | "web_asset_public_search"
  | "web_generation_retrieval_prepare"
  | "web_generation_codegen_prepare";

export type RetrievalRecordSummary = {
  titles: string[];
  urls: string[];
};

export type RetrievalRecord = {
  id: string;
  kind: RetrievalRecordKind;
  createdAt: string;
  query: string;
  source: string;
  resultCount: number;
  summary: RetrievalRecordSummary;
  payload: unknown;
};

export type StoredRetrievalRecord = {
  id: string;
  kind: RetrievalRecordKind;
  path: string;
  relativePath: string;
  createdAt: string;
  resultCount: number;
  summary: RetrievalRecordSummary;
};

const MAX_SUMMARY_ITEMS = 8;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const RECORD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readWorkspaceRoot(ctx: ToolContext): string {
  const fromMeta = readString(ctx.meta?.workspaceRoot);
  return fromMeta || ctx.cwd;
}

function retrievalRootForWorkspace(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".agents", "runtime", "retrieval");
}

function makeRecordId(kind: RetrievalRecordKind): string {
  return `${kind}-${Date.now()}-${randomUUID()}`;
}

function normalizeRecordId(id: string): string {
  const trimmed = id.trim().replace(/\.json$/i, "");
  if (!RECORD_ID_PATTERN.test(trimmed)) {
    throw new Error("retrieval record id must contain only letters, numbers, dot, underscore, or dash.");
  }
  return trimmed;
}

function recordPath(root: string, id: string): string {
  const normalized = normalizeRecordId(id);
  const target = path.join(root, `${normalized}.json`);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("retrieval record path escaped the retrieval store root.");
  }
  return target;
}

function asRetrievalRecordKind(value: unknown): RetrievalRecordKind | null {
  if (
    value === "component_reference_search" ||
    value === "font_recommendation_search" ||
    value === "icon_search" ||
    value === "web_asset_search" ||
    value === "web_asset_public_search"
  ) {
    return value;
  }
  if (value === "web_generation_retrieval_prepare") return value;
  if (value === "web_generation_codegen_prepare") return value;
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(readString).filter(Boolean);
}

function readRetrievalRecord(value: unknown): RetrievalRecord {
  if (!isRecord(value)) {
    throw new Error("retrieval record JSON must be an object.");
  }
  const kind = asRetrievalRecordKind(value.kind);
  if (!kind) throw new Error("retrieval record kind is invalid.");
  const id = readString(value.id);
  const createdAt = readString(value.createdAt);
  const query = readString(value.query);
  const source = readString(value.source);
  const resultCount = typeof value.resultCount === "number" && Number.isFinite(value.resultCount)
    ? value.resultCount
    : null;
  const summary = isRecord(value.summary)
    ? {
        titles: asStringArray(value.summary.titles),
        urls: asStringArray(value.summary.urls),
      }
    : null;
  if (!id || !createdAt || !query || !source || resultCount === null || !summary) {
    throw new Error("retrieval record JSON is missing required fields.");
  }
  return {
    id,
    kind,
    createdAt,
    query,
    source,
    resultCount,
    summary,
    payload: value.payload,
  };
}

function pushUnique(values: string[], value: string): void {
  const normalized = value.trim();
  if (!normalized || values.includes(normalized)) return;
  values.push(normalized);
}

function collectFromResultObject(result: Record<string, unknown>, summary: RetrievalRecordSummary): void {
  const title = readString(result.title) || readString(result.name) || readString(result.label) || readString(result.id);
  const url = readString(result.url) || readString(result.href) || readString(result.sourceUrl);
  pushUnique(summary.titles, title);
  pushUnique(summary.urls, url);
  const candidate = result.componentReferencePlanCandidate;
  if (isRecord(candidate)) {
    pushUnique(summary.titles, readString(candidate.referenceId) || readString(candidate.componentRole));
    pushUnique(summary.urls, readString(candidate.source));
  }
}

export function summarizeRetrievalPayload(payload: unknown): RetrievalRecordSummary {
  const summary: RetrievalRecordSummary = { titles: [], urls: [] };
  if (isRecord(payload)) {
    const results = Array.isArray(payload.results) ? payload.results : [];
    for (const item of results) {
      if (!isRecord(item)) continue;
      collectFromResultObject(item, summary);
      if (summary.titles.length >= MAX_SUMMARY_ITEMS && summary.urls.length >= MAX_SUMMARY_ITEMS) break;
    }
    pushUnique(summary.urls, readString(payload.searchUrl));
    pushUnique(summary.titles, readString(payload.librarySource));
  }
  return {
    titles: summary.titles.slice(0, MAX_SUMMARY_ITEMS),
    urls: summary.urls.slice(0, MAX_SUMMARY_ITEMS),
  };
}

export class RetrievalRecordStore {
  private readonly root: string;

  constructor(workspaceRoot: string) {
    this.root = retrievalRootForWorkspace(workspaceRoot);
  }

  async put(input: {
    kind: RetrievalRecordKind;
    query: string;
    source: string;
    resultCount: number;
    payload: unknown;
  }): Promise<StoredRetrievalRecord> {
    const query = input.query.trim();
    if (!query) throw new Error("retrieval record query is required.");
    const source = input.source.trim();
    if (!source) throw new Error("retrieval record source is required.");
    const createdAt = new Date().toISOString();
    const id = makeRecordId(input.kind);
    const summary = summarizeRetrievalPayload(input.payload);
    const record: RetrievalRecord = {
      id,
      kind: input.kind,
      createdAt,
      query,
      source,
      resultCount: Math.max(0, Math.floor(input.resultCount)),
      summary,
      payload: input.payload,
    };
    await fs.mkdir(this.root, { recursive: true });
    const filePath = recordPath(this.root, id);
    await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return {
      id,
      kind: input.kind,
      path: filePath,
      relativePath: path.relative(path.dirname(path.dirname(path.dirname(this.root))), filePath),
      createdAt,
      resultCount: record.resultCount,
      summary,
    };
  }

  async get(id: string): Promise<RetrievalRecord> {
    const filePath = recordPath(this.root, id);
    const text = await fs.readFile(filePath, "utf8");
    return readRetrievalRecord(JSON.parse(text) as unknown);
  }

  async list(input?: { kind?: RetrievalRecordKind | null; limit?: number }): Promise<StoredRetrievalRecord[]> {
    const limit = readPositiveInteger(input?.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    let entries: string[];
    try {
      entries = await fs.readdir(this.root);
    } catch (error: unknown) {
      const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
      if (code === "ENOENT") return [];
      throw error;
    }
    const records: StoredRetrievalRecord[] = [];
    for (const entry of entries.filter((item) => item.endsWith(".json")).sort().reverse()) {
      const id = normalizeRecordId(entry);
      const filePath = recordPath(this.root, id);
      const record = readRetrievalRecord(JSON.parse(await fs.readFile(filePath, "utf8")) as unknown);
      if (input?.kind && record.kind !== input.kind) continue;
      records.push({
        id: record.id,
        kind: record.kind,
        path: filePath,
        relativePath: path.relative(path.dirname(path.dirname(path.dirname(this.root))), filePath),
        createdAt: record.createdAt,
        resultCount: record.resultCount,
        summary: record.summary,
      });
      if (records.length >= limit) break;
    }
    return records;
  }
}

export function createRetrievalRecordStore(ctx: ToolContext): RetrievalRecordStore {
  return new RetrievalRecordStore(readWorkspaceRoot(ctx));
}

export async function persistToolRetrievalRecord(
  ctx: ToolContext,
  input: {
    kind: RetrievalRecordKind;
    query: string;
    source: string;
    resultCount: number;
    payload: unknown;
  },
): Promise<StoredRetrievalRecord> {
  return createRetrievalRecordStore(ctx).put(input);
}

export function createRetrievalRecordGetTool(): ToolHandler {
  return {
    definition: {
      name: "retrieval_record_get",
      description:
        "Read a stored retrieval record by id from .agents/runtime/retrieval. Use this after component_reference_search or web_asset_public_search returned a retrievalRecord id, instead of carrying long search payloads in conversation context.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Stored retrieval record id returned by a previous search tool.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    async execute(args, ctx, toolCallId) {
      const id = readString(args.id);
      if (!id) throw new Error("retrieval_record_get id is required.");
      const record = await createRetrievalRecordStore(ctx).get(id);
      return {
        toolCallId,
        content: JSON.stringify({
          ok: true,
          record,
        }),
      };
    },
  };
}

export function createRetrievalRecordListTool(): ToolHandler {
  return {
    definition: {
      name: "retrieval_record_list",
      description:
        "List compact metadata for stored retrieval records in .agents/runtime/retrieval. Use this to find prior component/image search records before repeating the same retrieval.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "component_reference_search",
              "font_recommendation_search",
              "icon_search",
              "web_asset_search",
              "web_asset_public_search",
              "web_generation_retrieval_prepare",
              "web_generation_codegen_prepare",
            ],
            description: "Optional retrieval kind filter.",
          },
          limit: {
            type: "number",
            description: "Maximum records to list. Default 20, max 100.",
          },
        },
        additionalProperties: false,
      },
    },
    async execute(args, ctx, toolCallId) {
      const rawKind = readString(args.kind);
      const kind = rawKind ? asRetrievalRecordKind(rawKind) : null;
      if (rawKind && !kind) throw new Error("retrieval_record_list kind is invalid.");
      const records = await createRetrievalRecordStore(ctx).list({
        kind,
        limit: readPositiveInteger(args.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
      });
      return {
        toolCallId,
        content: JSON.stringify({
          ok: true,
          resultCount: records.length,
          records,
        }),
      };
    },
  };
}
