import type { ToolHandler } from "./registry.js";
import { persistToolRetrievalRecord } from "./retrieval-store.js";

type IconSearchCollectionInfo = {
  name: string;
  category: string;
  palette: boolean;
  height: number;
  license: string;
};

type IconSearchResult = {
  iconId: string;
  name: string;
  prefix: string;
  viewBox: string;
  width: number;
  height: number;
  palette: boolean;
  svg: string;
  license: string;
  category: string;
  usageHint: string;
};

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 40;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 45_000;
const ICONIFY_API_BASE = "https://api.iconify.design";

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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = readString(item);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readCollections(value: unknown): Record<string, IconSearchCollectionInfo> {
  if (!isRecord(value)) return {};
  const out: Record<string, IconSearchCollectionInfo> = {};
  for (const [prefix, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const license = isRecord(raw.license)
      ? readString(raw.license.spdx) || readString(raw.license.title)
      : "";
    out[prefix] = {
      name: readString(raw.name),
      category: readString(raw.category),
      palette: raw.palette === true,
      height: readNumber(raw.height, 16),
      license,
    };
  }
  return out;
}

function iconNameParts(iconId: string): { prefix: string; name: string } | null {
  const [prefix, ...rest] = iconId.split(":");
  const name = rest.join(":");
  if (!prefix || !name) return null;
  return { prefix, name };
}

function groupIconsByPrefix(iconIds: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const iconId of iconIds) {
    const parts = iconNameParts(iconId);
    if (!parts) continue;
    const existing = groups.get(parts.prefix) ?? [];
    existing.push(parts.name);
    groups.set(parts.prefix, existing);
  }
  return groups;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "CanvasAgents/1.0 icon-search",
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function buildIconResults(input: {
  iconIds: string[];
  collections: Record<string, IconSearchCollectionInfo>;
  iconDataByPrefix: Map<string, Record<string, unknown>>;
}): IconSearchResult[] {
  const results: IconSearchResult[] = [];
  for (const iconId of input.iconIds) {
    const parts = iconNameParts(iconId);
    if (!parts) continue;
    const iconSet = input.iconDataByPrefix.get(parts.prefix);
    const iconValue = iconSet?.[parts.name];
    const rawIcon: Record<string, unknown> | null = isRecord(iconValue) ? iconValue : null;
    if (!rawIcon) continue;
    const collection = input.collections[parts.prefix];
    const width = readNumber(rawIcon.width, collection?.height ?? 16);
    const height = readNumber(rawIcon.height, collection?.height ?? 16);
    const left = readNumber(rawIcon.left, 0);
    const top = readNumber(rawIcon.top, 0);
    const body = readString(rawIcon.body);
    if (!body) continue;
    const viewBox = `${left} ${top} ${width} ${height}`;
    results.push({
      iconId,
      name: parts.name,
      prefix: parts.prefix,
      viewBox,
      width,
      height,
      palette: collection?.palette ?? false,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="1em" height="1em">${body}</svg>`,
      license: collection?.license ?? "",
      category: collection?.category ?? "",
      usageHint:
        "Inline this SVG in the generated React source for buttons, configurator options, specs, dock items, and labels instead of omitting icons or using text-only pills.",
    });
  }
  return results;
}

export function createIconSearchTool(): ToolHandler {
  return {
    definition: {
      name: "icon_search",
      description:
        "Search Iconify for real SVG icons before website codegen. Use this for buttons, configurator controls, color/seat/wheel/charging/spec icons, docks, stickers, and toolbars. Returns inline SVG, viewBox, dimensions, collection license, and a retrievalRecord id for later codegen.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Icon search query, e.g. color palette, car seat, wheel, battery charging, compare arrows.",
          },
          preferredSets: {
            type: "array",
            items: { type: "string" },
            description: "Optional Iconify prefixes to bias search, e.g. lucide, tabler, ph, carbon, simple-icons, mdi.",
          },
          limit: {
            type: "number",
            description: "Maximum icons to return. Default 12, max 40.",
          },
          timeoutMs: {
            type: "number",
            description: "Network timeout in milliseconds. Default 15000, max 45000.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    async execute(args, ctx, toolCallId) {
      const query = readString(args.query);
      if (!query) throw new Error("icon_search query is required.");
      const limit = readPositiveInteger(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
      const timeoutMs = readPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
      const preferredSets = readStringArray(args.preferredSets);
      const params = new URLSearchParams({
        query,
        limit: String(limit),
      });
      if (preferredSets.length) params.set("prefixes", preferredSets.join(","));
      const searchUrl = `${ICONIFY_API_BASE}/search?${params.toString()}`;

      try {
        const searchPayload = await fetchJson(searchUrl, timeoutMs);
        const searchRecord = isRecord(searchPayload) ? searchPayload : {};
        const iconIds = readStringArray(searchRecord.icons).slice(0, limit);
        const collections = readCollections(searchRecord.collections);
        const iconDataByPrefix = new Map<string, Record<string, unknown>>();
        for (const [prefix, names] of groupIconsByPrefix(iconIds)) {
          const dataUrl = `${ICONIFY_API_BASE}/${encodeURIComponent(prefix)}.json?icons=${encodeURIComponent(names.join(","))}`;
          const iconSetPayload = await fetchJson(dataUrl, timeoutMs);
          const iconSetRecord = isRecord(iconSetPayload) ? iconSetPayload : {};
          iconDataByPrefix.set(prefix, isRecord(iconSetRecord.icons) ? iconSetRecord.icons : {});
        }
        const results = buildIconResults({ iconIds, collections, iconDataByPrefix });
        const contentPayload = {
          ok: true,
          provider: "iconify",
          query,
          preferredSets,
          searchUrl,
          resultCount: results.length,
          results,
          usageContract: {
            retrievalRecordPath: "retrievalRecord.id",
            codegenRule:
              "Store this id in iconRecordIds or section/component icon plans. Later codegen should inline selected SVGs and preserve per-control labels, gradients, active states, and hover motion.",
          },
        };
        const retrievalRecord = await persistToolRetrievalRecord(ctx, {
          kind: "icon_search",
          query,
          source: searchUrl,
          resultCount: results.length,
          payload: contentPayload,
        });
        return { toolCallId, content: JSON.stringify({ ...contentPayload, retrievalRecord }) };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const contentPayload = {
          ok: false,
          provider: "iconify",
          query,
          preferredSets,
          searchUrl,
          resultCount: 0,
          results: [],
          error: message,
          usageContract: {
            retrievalRecordPath: "retrievalRecord.id",
            failureRule:
              "Do not silently omit icons after this failure. Store the retrieval id and either retry with a better query/provider or explicitly state that icon retrieval failed.",
          },
        };
        const retrievalRecord = await persistToolRetrievalRecord(ctx, {
          kind: "icon_search",
          query,
          source: searchUrl,
          resultCount: 0,
          payload: contentPayload,
        });
        return { toolCallId, content: JSON.stringify({ ...contentPayload, retrievalRecord }) };
      }
    },
  };
}
