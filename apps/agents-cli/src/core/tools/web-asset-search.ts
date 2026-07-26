import type { ToolHandler } from "./registry.js";
import { persistToolRetrievalRecord } from "./retrieval-store.js";

type PublicAssetSearchResult = {
  url: string;
  widthHint: number | null;
  source: "aura_public_asset";
};

type AssetFormat = "svg" | "png" | "jpg" | "webp" | "gif" | "unknown";
type AssetShape = "square" | "wide" | "tall" | "icon" | "logo" | "freeform-vector" | "unknown";
type TransparencyEvidence =
  | "provider-transparent-field"
  | "svg-vector"
  | "png-alpha-probed"
  | "opaque-detected"
  | "unknown";

type WebAssetSearchProvider = "anyasset" | "openverse" | "svgl";

type RawWebAssetCandidate = {
  provider: WebAssetSearchProvider;
  title: string;
  sourceUrl: string;
  url: string;
  previewUrl: string;
  license: string;
  attribution: string;
  providerHasAlpha: boolean | null;
};

type WebAssetSearchResult = {
  title: string;
  provider: WebAssetSearchProvider;
  sourceUrl: string;
  previewUrl: string;
  downloadUrl: string;
  format: AssetFormat;
  isVector: boolean;
  hasAlpha: boolean | null;
  transparencyEvidence: TransparencyEvidence;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  shape: AssetShape;
  license: string;
  attribution: string;
  metadataProbeError: string | null;
};

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 45_000;
const AURA_QUERY_MAX_WORDS = 4;
const ASSET_SEARCH_PROVIDERS: WebAssetSearchProvider[] = ["anyasset", "openverse", "svgl"];

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

function readBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeAssetFormat(url: string, contentType = ""): AssetFormat {
  const combined = `${url.split("?")[0] || ""} ${contentType}`.toLowerCase();
  if (combined.includes(".svg") || contentType.includes("svg")) return "svg";
  if (combined.includes(".png") || contentType.includes("png")) return "png";
  if (combined.includes(".jpg") || combined.includes(".jpeg") || contentType.includes("jpeg")) return "jpg";
  if (combined.includes(".webp") || contentType.includes("webp")) return "webp";
  if (combined.includes(".gif") || contentType.includes("gif")) return "gif";
  return "unknown";
}

function inferShape(format: AssetFormat, width: number | null, height: number | null): AssetShape {
  if (format === "svg" && (!width || !height)) return "freeform-vector";
  if (!width || !height) return "unknown";
  const ratio = width / height;
  if (format === "svg" && ratio > 2.5) return "logo";
  if (width <= 64 && height <= 64) return "icon";
  if (ratio >= 1.25) return "wide";
  if (ratio <= 0.8) return "tall";
  return "square";
}

function readBigEndianUint32(buffer: Uint8Array, offset: number): number | null {
  if (offset + 4 > buffer.length) return null;
  return ((buffer[offset] ?? 0) * 16_777_216) + ((buffer[offset + 1] ?? 0) << 16) + ((buffer[offset + 2] ?? 0) << 8) + (buffer[offset + 3] ?? 0);
}

function readLittleEndianUint24(buffer: Uint8Array, offset: number): number | null {
  if (offset + 3 > buffer.length) return null;
  return (buffer[offset] ?? 0) + ((buffer[offset + 1] ?? 0) << 8) + ((buffer[offset + 2] ?? 0) << 16);
}

function probePng(buffer: Uint8Array): { width: number | null; height: number | null; hasAlpha: boolean | null } {
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!pngSignature.every((value, index) => buffer[index] === value)) return { width: null, height: null, hasAlpha: null };
  const width = readBigEndianUint32(buffer, 16);
  const height = readBigEndianUint32(buffer, 20);
  const colorType = buffer[25];
  const hasAlpha = colorType === 4 || colorType === 6 ? true : colorType === 0 || colorType === 2 || colorType === 3 ? false : null;
  return { width, height, hasAlpha };
}

function probeJpeg(buffer: Uint8Array): { width: number | null; height: number | null } {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return { width: null, height: null };
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = ((buffer[offset + 2] ?? 0) << 8) + (buffer[offset + 3] ?? 0);
    if (length <= 0) break;
    const isSof = marker !== undefined && ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf));
    if (isSof) {
      const height = ((buffer[offset + 5] ?? 0) << 8) + (buffer[offset + 6] ?? 0);
      const width = ((buffer[offset + 7] ?? 0) << 8) + (buffer[offset + 8] ?? 0);
      return { width, height };
    }
    offset += 2 + length;
  }
  return { width: null, height: null };
}

function probeWebp(buffer: Uint8Array): { width: number | null; height: number | null; hasAlpha: boolean | null } {
  const riff = String.fromCharCode(...buffer.slice(0, 4));
  const webp = String.fromCharCode(...buffer.slice(8, 12));
  if (riff !== "RIFF" || webp !== "WEBP") return { width: null, height: null, hasAlpha: null };
  const chunk = String.fromCharCode(...buffer.slice(12, 16));
  if (chunk === "VP8X") {
    const flags = buffer[20] ?? 0;
    const widthMinusOne = readLittleEndianUint24(buffer, 24);
    const heightMinusOne = readLittleEndianUint24(buffer, 27);
    return {
      width: widthMinusOne === null ? null : widthMinusOne + 1,
      height: heightMinusOne === null ? null : heightMinusOne + 1,
      hasAlpha: (flags & 0x10) === 0x10,
    };
  }
  return { width: null, height: null, hasAlpha: null };
}

function parseSvgLength(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)/.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function probeSvg(text: string): { width: number | null; height: number | null } {
  const svgMatch = /<svg\b([^>]*)>/i.exec(text);
  if (!svgMatch) return { width: null, height: null };
  const attrs = svgMatch[1] || "";
  const width = parseSvgLength(/width=["']([^"']+)["']/i.exec(attrs)?.[1] || "");
  const height = parseSvgLength(/height=["']([^"']+)["']/i.exec(attrs)?.[1] || "");
  if (width && height) return { width, height };
  const viewBox = /viewBox=["']([^"']+)["']/i.exec(attrs)?.[1] || "";
  const parts = viewBox.split(/[\s,]+/).map((part) => Number(part)).filter((part) => Number.isFinite(part));
  return {
    width: parts.length >= 4 ? parts[2] ?? null : null,
    height: parts.length >= 4 ? parts[3] ?? null : null,
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number, accept: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        accept,
        "user-agent": "CanvasAgents/1.0 web-asset-search",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetchWithTimeout(url, timeoutMs, "application/json,text/json");
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as unknown;
}

async function probeAssetMetadata(candidate: RawWebAssetCandidate, timeoutMs: number): Promise<WebAssetSearchResult> {
  let format = normalizeAssetFormat(candidate.url);
  let width: number | null = null;
  let height: number | null = null;
  let hasAlpha = candidate.providerHasAlpha;
  let transparencyEvidence: TransparencyEvidence = hasAlpha === true ? "provider-transparent-field" : "unknown";
  let metadataProbeError: string | null = null;
  try {
    const response = await fetchWithTimeout(candidate.url || candidate.previewUrl, timeoutMs, "image/*,image/svg+xml,*/*");
    const contentType = response.headers.get("content-type") ?? "";
    format = normalizeAssetFormat(candidate.url, contentType);
    if (format === "svg") {
      const text = await response.text();
      const probed = probeSvg(text);
      width = probed.width;
      height = probed.height;
      hasAlpha = true;
      transparencyEvidence = "svg-vector";
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (format === "png") {
        const probed = probePng(bytes);
        width = probed.width;
        height = probed.height;
        if (hasAlpha === null) hasAlpha = probed.hasAlpha;
        transparencyEvidence = hasAlpha ? "png-alpha-probed" : "opaque-detected";
      } else if (format === "jpg") {
        const probed = probeJpeg(bytes);
        width = probed.width;
        height = probed.height;
        hasAlpha = false;
        transparencyEvidence = "opaque-detected";
      } else if (format === "webp") {
        const probed = probeWebp(bytes);
        width = probed.width;
        height = probed.height;
        if (hasAlpha === null) hasAlpha = probed.hasAlpha;
        transparencyEvidence = hasAlpha === true ? "png-alpha-probed" : hasAlpha === false ? "opaque-detected" : "unknown";
      }
    }
  } catch (error: unknown) {
    metadataProbeError = error instanceof Error ? error.message : String(error);
  }
  const aspectRatio = width && height ? width / height : null;
  return {
    title: candidate.title,
    provider: candidate.provider,
    sourceUrl: candidate.sourceUrl,
    previewUrl: candidate.previewUrl,
    downloadUrl: candidate.url,
    format,
    isVector: format === "svg",
    hasAlpha,
    transparencyEvidence,
    width,
    height,
    aspectRatio,
    shape: inferShape(format, width, height),
    license: candidate.license,
    attribution: candidate.attribution,
    metadataProbeError,
  };
}

export function compactAuraSearchQuery(query: string): {
  query: string;
  originalQuery: string;
  wasCompacted: boolean;
  wordCount: number;
} {
  const words = query.split(/\s+/).map((word) => word.trim()).filter(Boolean);
  return {
    query,
    originalQuery: query,
    wasCompacted: false,
    wordCount: words.length,
  };
}

function readWidthHint(url: string): number | null {
  const match = /_(\d+)w\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.exec(url);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function extractAuraDirectImageUrls(html: string, limit: number): PublicAssetSearchResult[] {
  const seen = new Set<string>();
  const results: PublicAssetSearchResult[] = [];
  const pattern =
    /https:\/\/hoirqrkdgbmvpwutwuwj\.supabase\.co\/storage\/v1\/object\/public\/assets\/assets\/[^"'\s)]+?\.(?:jpg|jpeg|png|webp)/gi;
  const normalizedHtml = html
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
  for (const match of normalizedHtml.matchAll(pattern)) {
    const rawUrl = String(match[0] || "").trim();
    if (!rawUrl || seen.has(rawUrl)) continue;
    seen.add(rawUrl);
    results.push({
      url: rawUrl,
      widthHint: readWidthHint(rawUrl),
      source: "aura_public_asset",
    });
    if (results.length >= limit) break;
  }
  return results;
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = readString(record[key]);
    if (text) return text;
  }
  return "";
}

function mapAnyAssetResult(item: unknown): RawWebAssetCandidate | null {
  if (!isRecord(item)) return null;
  const links = isRecord(item.links) ? item.links : {};
  const url = firstString(item, ["url", "downloadUrl", "imageUrl", "src"])
    || firstString(links, ["download", "source", "url", "self"]);
  const previewUrl = firstString(item, ["preview", "previewUrl", "thumbnail", "thumbnailUrl"]) || url;
  if (!url && !previewUrl) return null;
  return {
    provider: "anyasset",
    title: firstString(item, ["title", "name", "label", "id"]),
    sourceUrl: firstString(item, ["sourceUrl", "href", "url"]) || firstString(links, ["html", "source", "url"]),
    url: url || previewUrl,
    previewUrl,
    license: firstString(item, ["license", "licenseType"]),
    attribution: firstString(item, ["creditLine", "attribution", "creator"]),
    providerHasAlpha: readBooleanOrNull(item.isTransparent) ?? readBooleanOrNull(item.hasAlpha),
  };
}

function mapOpenverseResult(item: unknown): RawWebAssetCandidate | null {
  if (!isRecord(item)) return null;
  const url = firstString(item, ["url", "foreign_landing_url"]);
  const previewUrl = firstString(item, ["thumbnail", "thumbnailUrl", "url"]) || url;
  if (!url && !previewUrl) return null;
  return {
    provider: "openverse",
    title: firstString(item, ["title", "id"]),
    sourceUrl: firstString(item, ["foreign_landing_url", "creator_url", "url"]),
    url: url || previewUrl,
    previewUrl,
    license: firstString(item, ["license", "license_version", "license_url"]),
    attribution: firstString(item, ["attribution", "creator"]),
    providerHasAlpha: null,
  };
}

function mapSvglResult(item: unknown): RawWebAssetCandidate[] {
  if (!isRecord(item)) return [];
  const rawRoute = firstString(item, ["route", "url", "link"]);
  const routes = isRecord(item.route)
    ? Object.values(item.route).map(readString).filter(Boolean)
    : rawRoute
      ? [rawRoute]
      : [];
  return routes.map((route) => {
    const url = route.startsWith("http") ? route : `https://svgl.app/library/${route.replace(/^\/+/, "")}`;
    return {
      provider: "svgl" as const,
      title: firstString(item, ["title", "name", "id"]),
      sourceUrl: firstString(item, ["url", "link"]) || url,
      url,
      previewUrl: url,
      license: firstString(item, ["license"]),
      attribution: firstString(item, ["author", "creator"]),
      providerHasAlpha: true,
    };
  });
}

async function searchAnyAsset(query: string, type: string, limit: number, timeoutMs: number): Promise<RawWebAssetCandidate[]> {
  const params = new URLSearchParams({
    q: query,
    type,
    limit: String(limit),
  });
  const payload = await fetchJson(`https://anyasset.dev/search?${params.toString()}`, timeoutMs);
  const results = isRecord(payload) && Array.isArray(payload.results) ? payload.results : [];
  return results.map(mapAnyAssetResult).filter((item): item is RawWebAssetCandidate => Boolean(item));
}

async function searchOpenverse(query: string, type: string, limit: number, timeoutMs: number): Promise<RawWebAssetCandidate[]> {
  const params = new URLSearchParams({
    q: query,
    page_size: String(limit),
  });
  if (type === "vector") params.set("extension", "svg");
  const payload = await fetchJson(`https://api.openverse.engineering/v1/images/?${params.toString()}`, timeoutMs);
  const results = isRecord(payload) && Array.isArray(payload.results) ? payload.results : [];
  return results.map(mapOpenverseResult).filter((item): item is RawWebAssetCandidate => Boolean(item));
}

async function searchSvgl(query: string, limit: number, timeoutMs: number): Promise<RawWebAssetCandidate[]> {
  const payload = await fetchJson(`https://api.svgl.app?search=${encodeURIComponent(query)}`, timeoutMs);
  const rawResults = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.results) ? payload.results : [];
  return rawResults.flatMap(mapSvglResult).slice(0, limit);
}

async function searchProvider(input: {
  provider: WebAssetSearchProvider;
  query: string;
  type: string;
  limit: number;
  timeoutMs: number;
}): Promise<{ provider: WebAssetSearchProvider; results: RawWebAssetCandidate[]; error: string | null }> {
  try {
    if (input.provider === "anyasset") {
      return {
        provider: input.provider,
        results: await searchAnyAsset(input.query, input.type, input.limit, input.timeoutMs),
        error: null,
      };
    }
    if (input.provider === "openverse") {
      return {
        provider: input.provider,
        results: await searchOpenverse(input.query, input.type, input.limit, input.timeoutMs),
        error: null,
      };
    }
    return {
      provider: input.provider,
      results: await searchSvgl(input.query, input.limit, input.timeoutMs),
      error: null,
    };
  } catch (error: unknown) {
    return {
      provider: input.provider,
      results: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readProviders(value: unknown): WebAssetSearchProvider[] {
  const raw = readStringArray(value);
  if (!raw.length) return ASSET_SEARCH_PROVIDERS;
  const allowed = new Set<WebAssetSearchProvider>(ASSET_SEARCH_PROVIDERS);
  const out = raw.filter((provider): provider is WebAssetSearchProvider => allowed.has(provider as WebAssetSearchProvider));
  return out.length ? out : ASSET_SEARCH_PROVIDERS;
}

export function createWebAssetSearchTool(): ToolHandler {
  return {
    definition: {
      name: "web_asset_search",
      description:
        "[REQUIRED] Search normalized web assets across AnyAsset, Openverse, and SVGL for webpage assets. MUST be called for every image_asset slot. If search returns 0 results or unsuitable results (wrong format, opaque when transparent needed, etc.), do NOT leave the slot empty — instead, mark it for generation via canvas_image_generate_to_canvas with transparentPng=true for foreground/cutout assets. Every slot MUST have a final URL before final code.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Asset query, e.g. electric car side profile svg, glassmorphism dock icons, carbon fiber texture, tesla logo svg.",
          },
          role: {
            type: "string",
            description: "Optional asset role for later codegen, e.g. hero foreground vehicle, configurator color icon, sticker media.",
          },
          type: {
            type: "string",
            enum: ["image", "vector", "icon", "any"],
            description: "Preferred asset type. Default any.",
          },
          providers: {
            type: "array",
            items: { type: "string", enum: ["anyasset", "openverse", "svgl"] },
            description: "Optional provider list. Defaults to anyasset, openverse, svgl.",
          },
          limit: {
            type: "number",
            description: "Maximum normalized assets to return. Default 8, max 20.",
          },
          timeoutMs: {
            type: "number",
            description: "Network timeout in milliseconds per provider/probe. Default 15000, max 45000.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    async execute(args, ctx, toolCallId) {
      const query = readString(args.query);
      if (!query) throw new Error("web_asset_search query is required.");
      const role = readString(args.role);
      const type = readString(args.type) || "any";
      const limit = readPositiveInteger(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
      const timeoutMs = readPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
      const providers = readProviders(args.providers);
      const providerSearches = await Promise.all(providers.map((provider) => searchProvider({
        provider,
        query,
        type,
        limit,
        timeoutMs,
      })));
      const rawCandidates = providerSearches.flatMap((search) => search.results);
      const seen = new Set<string>();
      const deduped = rawCandidates.filter((candidate) => {
        const key = candidate.url || candidate.previewUrl || candidate.sourceUrl;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, limit);
      const results = await Promise.all(deduped.map((candidate) => probeAssetMetadata(candidate, timeoutMs)));
      const providerErrors = providerSearches
        .filter((search) => search.error)
        .map((search) => ({ provider: search.provider, error: search.error }));
      const contentPayload = {
        ok: results.length > 0,
        query,
        role,
        type,
        providers,
        providerErrors,
        resultCount: results.length,
        results,
        usageContract: {
          retrievalRecordPath: "retrievalRecord.id",
          assetPlanRule:
            "Store this id in asset search audit fields or assetRecordIds. Codegen should prefer SVG/vector/transparent assets when result metadata proves suitability.",
          metadataRule:
            "Use format, isVector, hasAlpha, transparencyEvidence, width, height, aspectRatio, and shape instead of treating returned URLs as opaque strings.",
          failureRule:
            "If resultCount=0 or providerErrors exist, preserve this record. Do not claim no search happened; repair query/provider or explicitly generate missing custom assets.",
        },
      };
      const retrievalRecord = await persistToolRetrievalRecord(ctx, {
        kind: "web_asset_search",
        query,
        source: providers.join(","),
        resultCount: results.length,
        payload: contentPayload,
      });
      return {
        toolCallId,
        content: JSON.stringify({
          ...contentPayload,
          retrievalRecord,
        }),
      };
    },
  };
}

export function createWebAssetPublicSearchTool(): ToolHandler {
  return {
    definition: {
      name: "web_asset_public_search",
      description:
        "[REQUIRED] Search public/Aura direct image assets for webpage image_asset requirements. Use for generic backgrounds, abstract textures, architecture, portraits, atmosphere assets. Use 3-4 word queries. IMPORTANT: If search returns 0 results or URLs are unsuitable, the slot MUST be generated via canvas_image_generate_to_canvas. Do NOT leave any slot unresolved.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Public asset search query. Keep it to 3-4 broad words for Aura, e.g. dark car studio or abstract blue light.",
          },
          limit: {
            type: "number",
            description: "Maximum direct image URLs to return. Default 8, max 20.",
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
      if (!query) {
        throw new Error("web_asset_public_search query is required.");
      }
      const compactedQuery = compactAuraSearchQuery(query);
      const limit = readPositiveInteger(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
      const timeoutMs = readPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
      const searchUrl = `https://www.aura.build/assets?q=${encodeURIComponent(compactedQuery.query)}&order=popular`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(searchUrl, {
          signal: controller.signal,
          headers: {
            "user-agent": "CanvasAgents/1.0 asset-search",
            accept: "text/html,application/xhtml+xml",
          },
        });
        const html = await response.text();
        const results = response.ok ? extractAuraDirectImageUrls(html, limit) : [];
        const contentPayload = {
          ok: response.ok,
          query: compactedQuery.query,
          originalQuery: compactedQuery.originalQuery,
          queryPolicy: {
            maxWords: AURA_QUERY_MAX_WORDS,
            originalWordCount: compactedQuery.wordCount,
            compacted: compactedQuery.wasCompacted,
          },
          usageContract: {
            retrievalRecordPath: "retrievalRecord.id",
            retrievalRecordRule:
              "Store this id in asset search audit fields so later codegen can call retrieval_record_get instead of relying on long context.",
            resolvedAssetPath: "webPageResolvedAssets[].sourceAudit",
            whenResultsExist:
              "For every relevant image_asset requirement, either reuse a returned direct URL as source='aura_public_asset' or record returned URLs in sourceAudit.candidateUrls with concrete rejection reasons before generating a new asset.",
            candidateUrlRule:
              "Do not state that public search returned no usable candidates when resultCount > 0. Candidate URLs must remain visible in sourceAudit even when generated assets are chosen.",
            queryRule:
              "Use visually specific but searchable queries. Broad 3-4 word queries are recommended for generic atmosphere, but do not strip critical nouns such as sticker, icon, dock, gradient, product, interior, or media slot from detailed asset searches.",
          },
          searchUrl,
          status: response.status,
          resultCount: results.length,
          results,
          ...(response.ok
            ? {}
            : {
                error: `public asset search HTTP ${response.status}`,
              }),
        };
        const retrievalRecord = await persistToolRetrievalRecord(ctx, {
          kind: "web_asset_public_search",
          query: compactedQuery.originalQuery,
          source: searchUrl,
          resultCount: results.length,
          payload: contentPayload,
        });
        return {
          toolCallId,
          content: JSON.stringify({
            ...contentPayload,
            retrievalRecord,
          }),
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const contentPayload = {
          ok: false,
          query: compactedQuery.query,
          originalQuery: compactedQuery.originalQuery,
          queryPolicy: {
            maxWords: AURA_QUERY_MAX_WORDS,
            originalWordCount: compactedQuery.wordCount,
            compacted: compactedQuery.wasCompacted,
          },
          usageContract: {
            retrievalRecordPath: "retrievalRecord.id",
            retrievalRecordRule:
              "Store this id in asset search audit fields even when the search fails, so later codegen can distinguish searched-and-failed from never-searched.",
            resolvedAssetPath: "webPageResolvedAssets[].sourceAudit",
            failureRule:
              "A failed public search does not authorize silently claiming no candidates. Record this retrieval id and the error before generating a custom asset.",
          },
          searchUrl,
          resultCount: 0,
          results: [],
          error: message,
        };
        const retrievalRecord = await persistToolRetrievalRecord(ctx, {
          kind: "web_asset_public_search",
          query: compactedQuery.originalQuery,
          source: searchUrl,
          resultCount: 0,
          payload: contentPayload,
        });
        return {
          toolCallId,
          content: JSON.stringify({
            ...contentPayload,
            retrievalRecord,
          }),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
