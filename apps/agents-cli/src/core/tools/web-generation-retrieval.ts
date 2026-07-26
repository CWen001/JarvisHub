import type { ToolContext, ToolHandler } from "./registry.js";
import { createComponentReferenceSearchTool } from "./component-reference.js";
import { createIconSearchTool } from "./icon-search.js";
import {
  persistToolRetrievalRecord,
  type RetrievalRecordKind,
  type StoredRetrievalRecord,
} from "./retrieval-store.js";
import { createWebAssetPublicSearchTool, createWebAssetSearchTool } from "./web-asset-search.js";

type SectionRetrievalRequest = {
  sectionId: string;
  query: string;
  visualDetails: string;
  assetSlots: string[];
};

type PublicAssetRetrievalRequest = {
  assetId: string;
  sectionId: string;
  query: string;
  need: string;
  querySource: "publicAssetQueries" | "assetRequirements";
};

type TypographyRetrievalRequest = {
  displayFontCandidates: string[];
  bodyFontCandidates: string[];
  fontSource: string;
  usage: string;
  externalFontAllowed: boolean | null;
};

type IconRetrievalRequest = {
  iconId: string;
  sectionId: string;
  query: string;
  usage: string;
  preferredSets: string[];
};

type NestedSearchPayload = {
  ok: boolean;
  query: string;
  resultCount: number;
  retrievalRecord: StoredRetrievalRecord | null;
  results: unknown[];
};

type SectionRetrievalResult = {
  sectionId: string;
  query: string;
  visualDetails: string;
  assetSlots: string[];
  resultCount: number;
  retrievalRecord: StoredRetrievalRecord | null;
  topReferenceCandidates: unknown[];
};

type PublicAssetRetrievalResult = {
  assetId: string;
  sectionId: string;
  query: string;
  need: string;
  querySource: "publicAssetQueries" | "assetRequirements";
  resultCount: number;
  retrievalRecord: StoredRetrievalRecord | null;
  candidateUrls: string[];
};

type NormalizedAssetRetrievalResult = {
  assetId: string;
  sectionId: string;
  query: string;
  need: string;
  resultCount: number;
  retrievalRecord: StoredRetrievalRecord | null;
  candidates: unknown[];
  candidateUrls: string[];
};

type IconRetrievalResult = {
  iconId: string;
  sectionId: string;
  query: string;
  usage: string;
  resultCount: number;
  retrievalRecord: StoredRetrievalRecord | null;
  topIconCandidates: unknown[];
};

type WebGenerationRetrievalPack = {
  ok: boolean;
  createdAt: string;
  usageContract: {
    storePackPath: string;
    componentPlanPath: string;
    assetAuditPath: string;
    finalCodeRule: string;
  };
  componentSearches: SectionRetrievalResult[];
  publicAssetSearches: PublicAssetRetrievalResult[];
  normalizedAssetSearches: NormalizedAssetRetrievalResult[];
  iconSearches: IconRetrievalResult[];
  assetSearchCoverage: AssetSearchCoverage;
  retrievalRecordIds: string[];
};

type AssetSearchCoverage = {
  imageAssetRequirementIds: string[];
  searchedAssetIds: string[];
  missingSearchAssetIds: string[];
  addedFromAssetRequirements: string[];
  note: string;
};

type ComponentReferencePlanDraft = {
  searchRecords: string[];
  sectionDecisions: Array<{
    sectionId: string;
    query: string;
    visualDetails: string;
    assetNeedAssessment: string;
    retrievalRecordId: string | null;
    selectionDecision: "agent_selection_required" | "write_from_scratch";
    topReferences: unknown[];
    rejectedReferenceWarnings: string[];
    implementationGuardrail: string;
    fallbackIfNoMatch: string;
  }>;
};

type AssetSearchAuditDraft = Array<{
  assetId: string;
  sectionId: string;
  query: string;
  need: string;
  retrievalRecordId: string | null;
  normalizedAssetSearchRecordId: string | null;
  candidateUrls: string[];
  normalizedCandidateUrls: string[];
  decision: "reuse_public_candidate_required" | "generation_allowed_after_recorded_rejection" | "search_failed_generation_allowed";
  requiredSourceAudit: {
    publicSearchChecked: true;
    publicSearchRecordId: string | null;
    normalizedAssetSearchRecordId: string | null;
    candidateUrls: string[];
    normalizedCandidateUrls: string[];
    rejectionReasonsRequired: boolean;
    generationReasonRequired: boolean;
  };
}>;

type TypographyPlanDraft = {
  status: "provided" | "agent_selection_required";
  displayFontCandidates: string[];
  bodyFontCandidates: string[];
  fontSource: string;
  usage: string;
  externalFontAllowed: boolean | null;
  implementation: string;
  cssHooks: string[];
};

type RecommendedStatePatch = {
  webPageImplementationBrief: {
    componentReferencePlan: ComponentReferencePlanDraft;
    fontPlan: TypographyPlanDraft;
    retrievalPack: {
      packRecordId: string;
      recordIds: string[];
    };
    iconPlan: {
      recordIds: string[];
      searches: Array<{
        iconId: string;
        sectionId: string;
        query: string;
        usage: string;
        retrievalRecordId: string | null;
      }>;
      implementation: string;
    };
    assetSearchCoverage: AssetSearchCoverage;
  };
  webPageResolvedAssetsSourceAuditHints: AssetSearchAuditDraft;
};

const DEFAULT_COMPONENT_TOP_K = 5;
const MAX_BATCH_ITEMS = 8;
const MAX_QUERY_CHARS = 320;
const MAX_DETAIL_CHARS = 900;
const MAX_ASSET_SLOTS = 10;
const TOP_REFERENCE_LIMIT = 3;
const TOP_ASSET_URL_LIMIT = 6;

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function readStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = readString(item);
    if (!text || out.includes(text)) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function readBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function clipText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars).trim();
}

function parseSections(value: unknown): SectionRetrievalRequest[] {
  if (!Array.isArray(value)) return [];
  const sections: SectionRetrievalRequest[] = [];
  for (const item of value.slice(0, MAX_BATCH_ITEMS)) {
    if (!isRecord(item)) continue;
    const sectionId = readString(item.sectionId);
    const query = clipText(readString(item.query), MAX_QUERY_CHARS);
    if (!sectionId || !query) continue;
    sections.push({
      sectionId,
      query,
      visualDetails: clipText(readString(item.visualDetails), MAX_DETAIL_CHARS),
      assetSlots: readStringArray(item.assetSlots, MAX_ASSET_SLOTS),
    });
  }
  return sections;
}

function parsePublicAssetQueries(value: unknown): PublicAssetRetrievalRequest[] {
  if (!Array.isArray(value)) return [];
  const queries: PublicAssetRetrievalRequest[] = [];
  for (const item of value.slice(0, MAX_BATCH_ITEMS)) {
    if (!isRecord(item)) continue;
    const assetId = readString(item.assetId);
    const sectionId = readString(item.sectionId);
    const query = clipText(readString(item.query), MAX_QUERY_CHARS);
    if (!assetId || !sectionId || !query) continue;
    queries.push({
      assetId,
      sectionId,
      query,
      need: clipText(readString(item.need), MAX_DETAIL_CHARS),
      querySource: "publicAssetQueries",
    });
  }
  return queries;
}

function buildAssetRequirementQuery(item: Record<string, unknown>): string {
  const explicit = clipText(
    readString(item.searchQuery) || readString(item.publicSearchQuery) || readString(item.query),
    MAX_QUERY_CHARS,
  );
  if (explicit) return explicit;
  const fields = [
    readString(item.role),
    readString(item.description),
    readString(item.placement),
    readString(item.aspect),
  ].filter((part) => part.length > 0);
  return clipText(fields.join(" "), MAX_QUERY_CHARS);
}

function buildAssetRequirementNeed(item: Record<string, unknown>): string {
  const fields = [
    readString(item.need),
    readString(item.role),
    readString(item.description),
    readString(item.placement),
  ].filter((part) => part.length > 0);
  return clipText(fields.join(" | "), MAX_DETAIL_CHARS);
}

function parseAssetRequirementQueries(value: unknown): PublicAssetRetrievalRequest[] {
  if (!Array.isArray(value)) return [];
  const queries: PublicAssetRetrievalRequest[] = [];
  for (const item of value.slice(0, MAX_BATCH_ITEMS)) {
    if (!isRecord(item)) continue;
    const renderMode = readString(item.renderMode);
    if (renderMode && renderMode !== "image_asset") continue;
    const assetId = readString(item.assetId);
    const sectionId = readString(item.sectionId) || readString(item.section);
    const query = buildAssetRequirementQuery(item);
    if (!assetId || !sectionId || !query) continue;
    queries.push({
      assetId,
      sectionId,
      query,
      need: buildAssetRequirementNeed(item),
      querySource: "assetRequirements",
    });
  }
  return queries;
}

function mergeAssetQueries(input: {
  explicitQueries: PublicAssetRetrievalRequest[];
  requirementQueries: PublicAssetRetrievalRequest[];
}): {
  queries: PublicAssetRetrievalRequest[];
  coverage: AssetSearchCoverage;
} {
  const queries: PublicAssetRetrievalRequest[] = [...input.explicitQueries];
  const addedFromAssetRequirements: string[] = [];
  for (const requirement of input.requirementQueries) {
    const alreadyCovered = queries.some((query) => query.assetId === requirement.assetId);
    if (alreadyCovered) continue;
    queries.push(requirement);
    addedFromAssetRequirements.push(requirement.assetId);
  }
  const imageAssetRequirementIds = input.requirementQueries
    .map((item) => item.assetId)
    .filter((assetId, index, ids) => assetId && ids.indexOf(assetId) === index);
  const searchedAssetIds = queries
    .map((item) => item.assetId)
    .filter((assetId, index, ids) => assetId && ids.indexOf(assetId) === index);
  const missingSearchAssetIds = imageAssetRequirementIds.filter((assetId) => !searchedAssetIds.includes(assetId));
  return {
    queries,
    coverage: {
      imageAssetRequirementIds,
      searchedAssetIds,
      missingSearchAssetIds,
      addedFromAssetRequirements,
      note:
        "Every image_asset requirement provided to assetRequirements is searched through public/Aura and normalized web_asset_search. Missing ids mean the requirement lacked assetId, sectionId, or searchable text and must be repaired before generating an asset node.",
    },
  };
}

function parseTypography(value: unknown): TypographyRetrievalRequest {
  if (!isRecord(value)) {
    return {
      displayFontCandidates: [],
      bodyFontCandidates: [],
      fontSource: "",
      usage: "",
      externalFontAllowed: null,
    };
  }
  return {
    displayFontCandidates: readStringArray(value.displayFontCandidates, 6),
    bodyFontCandidates: readStringArray(value.bodyFontCandidates, 6),
    fontSource: clipText(readString(value.fontSource), MAX_DETAIL_CHARS),
    usage: clipText(readString(value.usage), MAX_DETAIL_CHARS),
    externalFontAllowed: readBooleanOrNull(value.externalFontAllowed),
  };
}

function parseIconQueries(value: unknown): IconRetrievalRequest[] {
  if (!Array.isArray(value)) return [];
  const queries: IconRetrievalRequest[] = [];
  for (const item of value.slice(0, MAX_BATCH_ITEMS)) {
    if (!isRecord(item)) continue;
    const iconId = readString(item.iconId) || readString(item.id);
    const sectionId = readString(item.sectionId) || readString(item.section);
    const query = clipText(readString(item.query), MAX_QUERY_CHARS);
    if (!iconId || !sectionId || !query) continue;
    queries.push({
      iconId,
      sectionId,
      query,
      usage: clipText(readString(item.usage) || readString(item.role), MAX_DETAIL_CHARS),
      preferredSets: readStringArray(item.preferredSets, 8),
    });
  }
  return queries;
}

function parseStoredRetrievalRecord(value: unknown): StoredRetrievalRecord | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const kind = readString(value.kind) as RetrievalRecordKind;
  const createdAt = readString(value.createdAt);
  const relativePath = readString(value.relativePath);
  const path = readString(value.path);
  const resultCount = typeof value.resultCount === "number" && Number.isFinite(value.resultCount)
    ? Math.max(0, Math.floor(value.resultCount))
    : null;
  const summary = isRecord(value.summary)
    ? {
        titles: readStringArray(value.summary.titles, 8),
        urls: readStringArray(value.summary.urls, 8),
      }
    : { titles: [], urls: [] };
  if (!id || !kind || !createdAt || resultCount === null) return null;
  return {
    id,
    kind,
    path,
    relativePath,
    createdAt,
    resultCount,
    summary,
  };
}

function parseNestedSearchPayload(content: string): NestedSearchPayload {
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("nested search returned non-object JSON.");
  }
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  return {
    ok: parsed.ok === true,
    query: readString(parsed.query),
    resultCount: typeof parsed.resultCount === "number" && Number.isFinite(parsed.resultCount)
      ? Math.max(0, Math.floor(parsed.resultCount))
      : results.length,
    retrievalRecord: parseStoredRetrievalRecord(parsed.retrievalRecord),
    results,
  };
}

function topReferenceCandidates(results: unknown[]): unknown[] {
  const candidates: unknown[] = [];
  for (const item of results) {
    if (!isRecord(item)) continue;
    const candidate = item.componentReferencePlanCandidate;
    if (isRecord(candidate)) {
      candidates.push(candidate);
    } else {
      candidates.push(item);
    }
    if (candidates.length >= TOP_REFERENCE_LIMIT) break;
  }
  return candidates;
}

function candidateRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (isRecord(value.componentReferencePlanCandidate)) return value.componentReferencePlanCandidate;
  return value;
}

function candidateText(candidate: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = readString(candidate[key]);
    if (text) return text;
  }
  return "";
}

function isCardOrAdminCandidate(candidate: Record<string, unknown>): boolean {
  const category = candidateText(candidate, ["category"]).toLowerCase();
  const subcategory = candidateText(candidate, ["subcategory"]).toLowerCase();
  const name = candidateText(candidate, ["name", "title", "referenceId", "id"]).toLowerCase();
  const summary = candidateText(candidate, ["summary"]).toLowerCase();
  const joined = [category, subcategory, name, summary].join(" ");
  if (["card", "table", "admin", "form", "pricing"].includes(category)) return true;
  return [
    "tilt card",
    "3d tilt",
    "product card",
    "cards slider",
    "analytics table",
    "reorderable table",
    "pricing card",
    "bento",
  ].some((term) => joined.includes(term));
}

function isCinematicSectionCandidate(candidate: Record<string, unknown>): boolean {
  const category = candidateText(candidate, ["category"]).toLowerCase();
  const subcategory = candidateText(candidate, ["subcategory"]).toLowerCase();
  const summary = candidateText(candidate, ["summary"]).toLowerCase();
  const role = candidateText(candidate, ["componentRole"]).toLowerCase();
  const title = candidateText(candidate, ["name", "title", "referenceId", "id"]).toLowerCase();
  const joined = [category, subcategory, summary, role, title].join(" ");
  return [
    "hero",
    "full-screen",
    "full-viewport",
    "scroll",
    "pinned",
    "cinematic",
    "shader-background",
    "blueprint",
  ].some((term) => joined.includes(term));
}

function rejectedReferenceWarnings(candidates: unknown[]): string[] {
  const warnings: string[] = [];
  for (const value of candidates) {
    const candidate = candidateRecord(value);
    if (!candidate || !isCardOrAdminCandidate(candidate)) continue;
    const title = candidateText(candidate, ["name", "title", "referenceId", "id"]) || "untitled reference";
    const category = candidateText(candidate, ["category", "subcategory"]) || "unknown";
    warnings.push(`${title} (${category}) is card/table/admin/tilt-oriented; do not use it as the primary layout for image-led previews.`);
  }
  return warnings;
}

function hasUsableCinematicCandidate(candidates: unknown[]): boolean {
  return candidates.some((value) => {
    const candidate = candidateRecord(value);
    if (!candidate) return false;
    return !isCardOrAdminCandidate(candidate) && isCinematicSectionCandidate(candidate);
  });
}

function topCandidateUrls(results: unknown[]): string[] {
  const urls: string[] = [];
  for (const item of results) {
    if (!isRecord(item)) continue;
    const url = readString(item.url) || readString(item.downloadUrl) || readString(item.previewUrl);
    if (!url || urls.includes(url)) continue;
    urls.push(url);
    if (urls.length >= TOP_ASSET_URL_LIMIT) break;
  }
  return urls;
}

function topNormalizedAssetCandidates(results: unknown[]): unknown[] {
  const candidates: unknown[] = [];
  for (const item of results) {
    if (!isRecord(item)) continue;
    candidates.push({
      title: readString(item.title),
      provider: readString(item.provider),
      downloadUrl: readString(item.downloadUrl),
      previewUrl: readString(item.previewUrl),
      sourceUrl: readString(item.sourceUrl),
      format: readString(item.format),
      isVector: item.isVector === true,
      hasAlpha: typeof item.hasAlpha === "boolean" ? item.hasAlpha : null,
      transparencyEvidence: readString(item.transparencyEvidence),
      width: typeof item.width === "number" && Number.isFinite(item.width) ? item.width : null,
      height: typeof item.height === "number" && Number.isFinite(item.height) ? item.height : null,
      aspectRatio: typeof item.aspectRatio === "number" && Number.isFinite(item.aspectRatio) ? item.aspectRatio : null,
      shape: readString(item.shape),
      license: readString(item.license),
      attribution: readString(item.attribution),
      metadataProbeError: readString(item.metadataProbeError),
    });
    if (candidates.length >= TOP_REFERENCE_LIMIT) break;
  }
  return candidates;
}

function topIconCandidates(results: unknown[]): unknown[] {
  const candidates: unknown[] = [];
  for (const item of results) {
    if (!isRecord(item)) continue;
    candidates.push({
      iconId: readString(item.iconId),
      name: readString(item.name),
      prefix: readString(item.prefix),
      viewBox: readString(item.viewBox),
      width: typeof item.width === "number" && Number.isFinite(item.width) ? item.width : null,
      height: typeof item.height === "number" && Number.isFinite(item.height) ? item.height : null,
      svg: readString(item.svg),
      license: readString(item.license),
      category: readString(item.category),
      usageHint: readString(item.usageHint),
    });
    if (candidates.length >= TOP_REFERENCE_LIMIT) break;
  }
  return candidates;
}

async function runComponentSearch(input: {
  section: SectionRetrievalRequest;
  topK: number;
  ctx: ToolContext;
  toolCallId: string;
}): Promise<SectionRetrievalResult> {
  const tool = createComponentReferenceSearchTool();
  const result = await tool.execute(
    { query: input.section.query, topK: input.topK },
    input.ctx,
    `${input.toolCallId}:component:${input.section.sectionId}`,
  );
  const payload = parseNestedSearchPayload(result.content);
  return {
    sectionId: input.section.sectionId,
    query: input.section.query,
    visualDetails: input.section.visualDetails,
    assetSlots: input.section.assetSlots,
    resultCount: payload.resultCount,
    retrievalRecord: payload.retrievalRecord,
    topReferenceCandidates: topReferenceCandidates(payload.results),
  };
}

async function runPublicAssetSearch(input: {
  asset: PublicAssetRetrievalRequest;
  limit: number;
  ctx: ToolContext;
  toolCallId: string;
}): Promise<PublicAssetRetrievalResult> {
  const tool = createWebAssetPublicSearchTool();
  const result = await tool.execute(
    { query: input.asset.query, limit: input.limit },
    input.ctx,
    `${input.toolCallId}:asset:${input.asset.assetId}`,
  );
  const payload = parseNestedSearchPayload(result.content);
  return {
    assetId: input.asset.assetId,
    sectionId: input.asset.sectionId,
    query: input.asset.query,
    need: input.asset.need,
    querySource: input.asset.querySource,
    resultCount: payload.resultCount,
    retrievalRecord: payload.retrievalRecord,
    candidateUrls: topCandidateUrls(payload.results),
  };
}

async function runNormalizedAssetSearch(input: {
  asset: PublicAssetRetrievalRequest;
  limit: number;
  ctx: ToolContext;
  toolCallId: string;
}): Promise<NormalizedAssetRetrievalResult> {
  const tool = createWebAssetSearchTool();
  const result = await tool.execute(
    {
      query: input.asset.query,
      role: input.asset.need || input.asset.assetId,
      type: "any",
      limit: input.limit,
    },
    input.ctx,
    `${input.toolCallId}:normalized-asset:${input.asset.assetId}`,
  );
  const payload = parseNestedSearchPayload(result.content);
  const candidates = topNormalizedAssetCandidates(payload.results);
  return {
    assetId: input.asset.assetId,
    sectionId: input.asset.sectionId,
    query: input.asset.query,
    need: input.asset.need,
    resultCount: payload.resultCount,
    retrievalRecord: payload.retrievalRecord,
    candidates,
    candidateUrls: topCandidateUrls(candidates),
  };
}

async function runIconSearch(input: {
  icon: IconRetrievalRequest;
  limit: number;
  ctx: ToolContext;
  toolCallId: string;
}): Promise<IconRetrievalResult> {
  const tool = createIconSearchTool();
  const result = await tool.execute(
    {
      query: input.icon.query,
      preferredSets: input.icon.preferredSets,
      limit: input.limit,
    },
    input.ctx,
    `${input.toolCallId}:icon:${input.icon.iconId}`,
  );
  const payload = parseNestedSearchPayload(result.content);
  return {
    iconId: input.icon.iconId,
    sectionId: input.icon.sectionId,
    query: input.icon.query,
    usage: input.icon.usage,
    resultCount: payload.resultCount,
    retrievalRecord: payload.retrievalRecord,
    topIconCandidates: topIconCandidates(payload.results),
  };
}

function collectRecordIds(pack: Omit<WebGenerationRetrievalPack, "retrievalRecordIds">): string[] {
  const ids: string[] = [];
  for (const item of pack.componentSearches) {
    if (item.retrievalRecord?.id && !ids.includes(item.retrievalRecord.id)) ids.push(item.retrievalRecord.id);
  }
  for (const item of pack.publicAssetSearches) {
    if (item.retrievalRecord?.id && !ids.includes(item.retrievalRecord.id)) ids.push(item.retrievalRecord.id);
  }
  for (const item of pack.normalizedAssetSearches) {
    if (item.retrievalRecord?.id && !ids.includes(item.retrievalRecord.id)) ids.push(item.retrievalRecord.id);
  }
  for (const item of pack.iconSearches) {
    if (item.retrievalRecord?.id && !ids.includes(item.retrievalRecord.id)) ids.push(item.retrievalRecord.id);
  }
  return ids;
}

function describeAssetNeed(section: SectionRetrievalResult): string {
  const slots = section.assetSlots.length ? section.assetSlots.join(", ") : "no explicit asset slots";
  const details = section.visualDetails || "No extra visual detail text was provided.";
  return `${details} Asset slots: ${slots}.`;
}

function buildComponentReferencePlanDraft(componentSearches: SectionRetrievalResult[]): ComponentReferencePlanDraft {
  const searchRecords = componentSearches
    .map((item) => item.retrievalRecord?.id || "")
    .filter((id) => id.length > 0);
  return {
    searchRecords,
    sectionDecisions: componentSearches.map((item) => {
      const warnings = rejectedReferenceWarnings(item.topReferenceCandidates);
      const hasUsable = hasUsableCinematicCandidate(item.topReferenceCandidates);
      return {
        sectionId: item.sectionId,
        query: item.query,
        visualDetails: item.visualDetails,
        assetNeedAssessment: describeAssetNeed(item),
        retrievalRecordId: item.retrievalRecord?.id || null,
        selectionDecision: hasUsable ? "agent_selection_required" : "write_from_scratch",
        topReferences: item.topReferenceCandidates,
        rejectedReferenceWarnings: warnings,
        implementationGuardrail:
          "Use retrieved references only for compatible structure/material/motion. If top candidates are cards, tables, admin widgets, pricing blocks, bento grids, or tilt demos, reject them as primary section drivers and implement the preview from scratch with media planes, masks, rails, spec stacks, and glass controls.",
        fallbackIfNoMatch:
          "If none of these retrieved references matches the approved preview's layout, material, motion, and asset slots, mark this section write_from_scratch and implement from the section spec instead of inventing a reference.",
      };
    }),
  };
}

function findNormalizedAssetSearch(
  normalizedAssetSearches: NormalizedAssetRetrievalResult[],
  item: PublicAssetRetrievalResult,
): NormalizedAssetRetrievalResult | null {
  return normalizedAssetSearches.find((candidate) => {
    if (candidate.assetId && item.assetId && candidate.assetId === item.assetId) return true;
    return candidate.sectionId === item.sectionId && candidate.query === item.query;
  }) ?? null;
}

function buildAssetSearchAuditDraft(input: {
  publicAssetSearches: PublicAssetRetrievalResult[];
  normalizedAssetSearches: NormalizedAssetRetrievalResult[];
}): AssetSearchAuditDraft {
  return input.publicAssetSearches.map((item) => {
    const normalized = findNormalizedAssetSearch(input.normalizedAssetSearches, item);
    const mergedCandidateUrls = [...item.candidateUrls, ...(normalized?.candidateUrls ?? [])]
      .filter((url, index, urls) => url && urls.indexOf(url) === index);
    return {
      assetId: item.assetId,
      sectionId: item.sectionId,
      query: item.query,
      need: item.need,
      retrievalRecordId: item.retrievalRecord?.id || null,
      normalizedAssetSearchRecordId: normalized?.retrievalRecord?.id || null,
      candidateUrls: item.candidateUrls,
      normalizedCandidateUrls: normalized?.candidateUrls ?? [],
      decision: mergedCandidateUrls.length
        ? "reuse_public_candidate_required"
        : item.retrievalRecord?.id
          ? "generation_allowed_after_recorded_rejection"
          : "search_failed_generation_allowed",
      requiredSourceAudit: {
        publicSearchChecked: true,
        publicSearchRecordId: item.retrievalRecord?.id || null,
        normalizedAssetSearchRecordId: normalized?.retrievalRecord?.id || null,
        candidateUrls: item.candidateUrls,
        normalizedCandidateUrls: normalized?.candidateUrls ?? [],
        rejectionReasonsRequired: mergedCandidateUrls.length > 0,
        generationReasonRequired: true,
      },
    };
  });
}

function buildTypographyPlanDraft(typography: TypographyRetrievalRequest): TypographyPlanDraft {
  const hasCandidate = typography.displayFontCandidates.length > 0 || typography.bodyFontCandidates.length > 0;
  if (hasCandidate) {
    return {
      status: "provided",
      displayFontCandidates: typography.displayFontCandidates,
      bodyFontCandidates: typography.bodyFontCandidates,
      fontSource: typography.fontSource || "explicit code-provided font import or local CSS font stack",
      usage: typography.usage || "Use display candidates for hero/editorial headings and body candidates for supporting copy.",
      externalFontAllowed: typography.externalFontAllowed,
      implementation:
        "Final code must implement the selected named font plan in index.html or CSS via link/@import/@font-face and assign CSS variables such as --font-display and --font-body. Do not leave premium visual websites on Inter/system-ui defaults unless the user explicitly chose that.",
      cssHooks: [":root --font-display", ":root --font-body", "body", "hero/editorial heading classes"],
    };
  }
  return {
    status: "agent_selection_required",
    displayFontCandidates: [],
    bodyFontCandidates: [],
    fontSource: "not_provided",
    usage:
      "Before final code, choose a named display font strategy that matches the approved preview and user taste. For premium/AWWWARDS pages, default Inter/system-ui alone is insufficient.",
    externalFontAllowed: typography.externalFontAllowed,
    implementation:
      "Add a font plan to webPageImplementationBrief before final code: named display font, named body font, source/import method, fallback stack, and exact CSS hooks. Browser-usable external fonts are allowed when the target runtime can load CDN assets.",
    cssHooks: [":root --font-display", ":root --font-body", "body", "hero/editorial heading classes"],
  };
}

function buildRecommendedStatePatch(input: {
  packRecordId: string;
  pack: WebGenerationRetrievalPack;
  typography: TypographyRetrievalRequest;
}): RecommendedStatePatch {
  return {
    webPageImplementationBrief: {
      componentReferencePlan: buildComponentReferencePlanDraft(input.pack.componentSearches),
      fontPlan: buildTypographyPlanDraft(input.typography),
      retrievalPack: {
        packRecordId: input.packRecordId,
        recordIds: input.pack.retrievalRecordIds,
      },
      iconPlan: {
        recordIds: input.pack.iconSearches
          .map((item) => item.retrievalRecord?.id || "")
          .filter((id) => id.length > 0),
        searches: input.pack.iconSearches.map((item) => ({
          iconId: item.iconId,
          sectionId: item.sectionId,
          query: item.query,
          usage: item.usage,
          retrievalRecordId: item.retrievalRecord?.id || null,
        })),
        implementation:
          "Final code must inline selected SVGs or use equivalent icon components for these controls. Do not replace icon-bearing preview controls with text-only pills.",
      },
      assetSearchCoverage: input.pack.assetSearchCoverage,
    },
    webPageResolvedAssetsSourceAuditHints: buildAssetSearchAuditDraft({
      publicAssetSearches: input.pack.publicAssetSearches,
      normalizedAssetSearches: input.pack.normalizedAssetSearches,
    }),
  };
}

export function createWebGenerationRetrievalPrepareTool(): ToolHandler {
  return {
    definition: {
      name: "web_generation_retrieval_prepare",
      description:
        "[REQUIRED Step 4/5] Batch retrieval manager for preview-first web generation. ONLY call after stepStatus.asset_inventory=completed. Runs component_reference_search per section and web_asset_public_search / web_asset_search per asset slot for reusable public imagery. Stores results and returns recommendedStatePatch. IMPORTANT: EVERY image_asset slot MUST be resolved — if public search returns nothing usable, the slot must be sent for generation via canvas_image_generate_to_canvas. Do NOT leave any slot unresolved before final code.",
      parameters: {
        type: "object",
        properties: {
          sections: {
            type: "array",
            description:
              "Major website sections to ground against the ComponentCard library. Each query must combine layout, material, motion, and asset-slot terms derived from the approved preview. Avoid generic card/3D-card/tilt-card terms unless the approved preview truly uses repeated cards; image-led product sections should prefer terms like full-bleed media plane, masked product stage, gradient media blend, color rail, spec stack, and glass controls.",
            items: {
              type: "object",
              properties: {
                sectionId: { type: "string" },
                query: { type: "string" },
                visualDetails: {
                  type: "string",
                  description:
                    "Distinct preview details that final code must preserve: headline colors/letter accents, glass button material, rail geometry, metric layout, media crop, CTA placement.",
                },
                assetSlots: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["sectionId", "query"],
              additionalProperties: false,
            },
          },
          publicAssetQueries: {
            type: "array",
            description:
              "Explicit public/Aura image searches. Include every unresolved renderMode=image_asset requirement here when possible. The tool also runs normalized web_asset_search for SVG/vector/transparency/dimension metadata. Do not use returned candidates blindly for precise branded product foregrounds; record rejection reasons before generating custom replacements.",
            items: {
              type: "object",
              properties: {
                assetId: { type: "string" },
                sectionId: { type: "string" },
                query: { type: "string" },
                need: { type: "string" },
              },
              required: ["assetId", "sectionId", "query"],
              additionalProperties: false,
            },
          },
          iconQueries: {
            type: "array",
            description:
              "Optional icon retrieval requests for controls visible in the approved previews: configurator color/seat/wheel/charging controls, spec rows, dock/sticker buttons, CTA arrows, labels, or toolbars. Use this instead of letting final React code invent text-only pills.",
            items: {
              type: "object",
              properties: {
                iconId: { type: "string", description: "Stable local id, e.g. battery-spec, paint-color, seat-option." },
                id: { type: "string" },
                sectionId: { type: "string" },
                section: { type: "string" },
                query: { type: "string", description: "Iconify search query, e.g. battery charging, car seat, color palette." },
                usage: { type: "string" },
                role: { type: "string" },
                preferredSets: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["query"],
              additionalProperties: false,
            },
          },
          assetRequirements: {
            type: "array",
            description:
              "Optional structured webPageAssetRequirements.requirements mirror. Every renderMode=image_asset item is merged into asset search coverage, so assets omitted from publicAssetQueries are still searched before generation. Provide assetId, sectionId, renderMode, searchQuery/query if available, plus role/description/placement for audit and query construction.",
            items: {
              type: "object",
              properties: {
                assetId: { type: "string" },
                sectionId: { type: "string" },
                section: { type: "string" },
                renderMode: { type: "string" },
                searchQuery: { type: "string" },
                publicSearchQuery: { type: "string" },
                query: { type: "string" },
                need: { type: "string" },
                role: { type: "string" },
                description: { type: "string" },
                placement: { type: "string" },
                aspect: { type: "string" },
              },
              required: ["assetId"],
              additionalProperties: true,
            },
          },
          componentTopK: {
            type: "number",
            description: "Top K component references per section. Default 5.",
          },
          publicAssetLimit: {
            type: "number",
            description: "Direct image URL limit per public asset query. Default 6.",
          },
          typography: {
            type: "object",
            description:
              "Optional explicit typography plan from the approved preview extraction. Provide named display/body font candidates and whether external browser fonts are allowed. If omitted, the returned recommendedStatePatch will mark fontPlan as agent_selection_required so final code does not silently default to Inter/system-ui.",
            properties: {
              displayFontCandidates: {
                type: "array",
                items: { type: "string" },
              },
              bodyFontCandidates: {
                type: "array",
                items: { type: "string" },
              },
              fontSource: {
                type: "string",
                description: "Example: Google Fonts, Adobe Fonts, local @font-face asset, or CSS-only fallback stack.",
              },
              usage: {
                type: "string",
                description: "Which text uses display vs body fonts, including headline/number/nav/CTA rules.",
              },
              externalFontAllowed: {
                type: "boolean",
                description: "Whether final browser code may load external font CSS/URLs.",
              },
            },
            additionalProperties: false,
          },
        },
        required: ["sections"],
        additionalProperties: false,
      },
    },
    async execute(args, ctx, toolCallId) {
      const sections = parseSections(args.sections);
      if (!sections.length) {
        throw new Error("web_generation_retrieval_prepare requires at least one section query.");
      }
      const explicitPublicAssetQueries = parsePublicAssetQueries(args.publicAssetQueries);
      const requirementAssetQueries = parseAssetRequirementQueries(args.assetRequirements);
      const { queries: publicAssetQueries, coverage: assetSearchCoverage } = mergeAssetQueries({
        explicitQueries: explicitPublicAssetQueries,
        requirementQueries: requirementAssetQueries,
      });
      const iconQueries = parseIconQueries(args.iconQueries);
      const typography = parseTypography(args.typography);
      const componentTopK = readPositiveInteger(args.componentTopK, DEFAULT_COMPONENT_TOP_K, 12);
      const publicAssetLimit = readPositiveInteger(args.publicAssetLimit, 6, 12);
      const componentSearches = await Promise.all(
        sections.map((section) => runComponentSearch({ section, topK: componentTopK, ctx, toolCallId })),
      );
      const publicAssetSearches = await Promise.all(
        publicAssetQueries.map((asset) => runPublicAssetSearch({ asset, limit: publicAssetLimit, ctx, toolCallId })),
      );
      const normalizedAssetSearches = await Promise.all(
        publicAssetQueries.map((asset) => runNormalizedAssetSearch({ asset, limit: publicAssetLimit, ctx, toolCallId })),
      );
      const iconSearches = await Promise.all(
        iconQueries.map((icon) => runIconSearch({ icon, limit: componentTopK, ctx, toolCallId })),
      );
      const partialPack: Omit<WebGenerationRetrievalPack, "retrievalRecordIds"> = {
        ok: true,
        createdAt: new Date().toISOString(),
        usageContract: {
          storePackPath: "webPageImplementationBrief.retrievalPack",
          componentPlanPath: "webPageImplementationBrief.componentReferencePlan",
          assetAuditPath: "webPageResolvedAssets[].sourceAudit",
          finalCodeRule:
            "Final web code should read this pack or its record ids, then implement selected component motion/style carryover and public asset candidate decisions. Public direct URLs returned for generic assets must be reused unless sourceAudit records concrete rejection reasons; generated assets must include generationReason and candidateUrls in sourceAudit. Do not fall back to generic sections when this pack exists.",
        },
        componentSearches,
        publicAssetSearches,
        normalizedAssetSearches,
        iconSearches,
        assetSearchCoverage,
      };
      const retrievalRecordIds = collectRecordIds(partialPack);
      const pack: WebGenerationRetrievalPack = { ...partialPack, retrievalRecordIds };
      const packRecord = await persistToolRetrievalRecord(ctx, {
        kind: "web_generation_retrieval_prepare",
        query: sections.map((section) => `${section.sectionId}:${section.query}`).join(" | "),
        source: "web_generation_retrieval_prepare",
        resultCount: componentSearches.reduce((sum, item) => sum + item.resultCount, 0)
          + publicAssetSearches.reduce((sum, item) => sum + item.resultCount, 0)
          + normalizedAssetSearches.reduce((sum, item) => sum + item.resultCount, 0)
          + iconSearches.reduce((sum, item) => sum + item.resultCount, 0),
        payload: pack,
      });
      const recommendedStatePatch = buildRecommendedStatePatch({
        packRecordId: packRecord.id,
        pack,
        typography,
      });
      return {
        toolCallId,
        content: JSON.stringify({
          ...pack,
          packRecord,
          recommendedStatePatch,
        }),
      };
    },
  };
}
