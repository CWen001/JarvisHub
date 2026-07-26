import type { ToolContext, ToolHandler } from "./registry.js";
import {
  createRetrievalRecordStore,
  persistToolRetrievalRecord,
  type RetrievalRecord,
  type StoredRetrievalRecord,
} from "./retrieval-store.js";
import {
  diagnoseWebHeroAssetDecisions,
  diagnoseWebHeroAssetRequirements,
  diagnoseWebHeroImplementationBrief,
} from "../../contracts/webhero-evidence-contract.js";

type WebCodegenAssetRequirement = {
  assetId: string;
  placeholder: string;
  slotId: string;
  visualSpecId: string;
  visualSpecSummary: string;
  sourceEvidence: unknown;
  previewNodeId: string;
  screenshotOrder: string;
  renderMode: string;
  implementation: string;
  type: string;
  category: string;
  section: string;
  placement: string;
};

type WebHeroPreCodeAssetEvidenceDiagnosis = {
  ok: boolean;
  missing: string[];
  visualSlots: Record<string, unknown>[];
};

type WebCodegenResolvedAsset = {
  assetId: string;
  placeholder: string;
  url: string;
  source: string;
  sourceAudit: AssetSourceAuditSummary;
  previewDerived: boolean;
};

type AssetSourceAuditSummary = {
  publicSearchChecked: boolean;
  publicSearchRecordId: string;
  candidateUrls: string[];
  rejectionReasons: string[];
  generationReason: string;
  decision: string;
};

type PublicAssetCandidateContract = {
  assetId: string;
  sectionId: string;
  query: string;
  need: string;
  retrievalRecordId: string;
  candidateUrls: string[];
  decisionRule: string;
};

type WebCodegenComponentReference = {
  recordId: string;
  query: string;
  titles: string[];
  urls: string[];
  topReferences: ComponentReferenceDecision[];
};

type ComponentReferenceDecision = {
  referenceId: string;
  title: string;
  category: string;
  sourceUrl: string;
  decision: "select" | "reject";
  reason: string;
  usage: string;
};

type SectionImplementationBlueprint = {
  sectionId: string;
  sourceRecordId: string;
  query: string;
  selectedReferences: ComponentReferenceDecision[];
  rejectedReferences: ComponentReferenceDecision[];
  implementationMode: "use_selected_references" | "write_from_scratch";
  layoutRule: string;
  motionRule: string;
  mediaRule: string;
  requiredComponents: string[];
};

type SectionCodegenAsset = {
  assetId: string;
  placeholder: string;
  url: string;
  source: string;
};

type SectionCodegenInput = {
  sectionId: string;
  sectionKey: string;
  previewNodeId: string;
  order: number;
  previewVisualSpec: {
    visualSpecId: string;
    layoutSkeleton: string;
    mediaPlacement: string;
    typographyHierarchy: string;
    motionIntent: string;
    requiredDomArtifacts: string[];
    requiredCssArtifacts: string[];
  } | null;
  visualSlots: WebCodegenAssetRequirement[];
  resolvedAssets: SectionCodegenAsset[];
  requiredEmbeddedAssetIds: string[];
  sectionBlueprint: SectionImplementationBlueprint | null;
  taskContract: {
    kind: string;
    targetNodeIds: string[];
    contextNodeIds: string[];
    allowedNodeIds: string[];
  };
};

type MergeSectionAssemblyInput = {
  sectionId: string;
  previewNodeId: string;
  order: number;
  requiredEmbeddedAssetIds: string[];
  requiredAssetUrls: string[];
  requiredDomArtifacts: string[];
  requiredCssArtifacts: string[];
  forbiddenImplementation: string[];
  requiredComponents: string[];
  consistencyFlags: string[];
  sectionBlueprintSummary: {
    implementationMode: string;
    layoutRule: string;
    motionRule: string;
    mediaRule: string;
  } | null;
};

type WebCodegenContract = {
  ok: boolean;
  createdAt: string;
  targetNodeId: string;
  readiness: {
    canWriteFinalCode: boolean;
    missingCriticalInputs: string[];
    missingRetrievalRecordIds: string[];
    unresolvedImageAssets: Array<{ assetId: string; placeholder: string }>;
  };
  codegenRule: string;
  referencePrompt: {
    present: boolean;
    charCount: number;
    excerpt: string;
  };
  typographyContract: {
    selectedDisplayFont: string;
    selectedBodyFont: string;
    externalFontAllowed: boolean | null;
    fontSource: string;
    usage: string;
    cssHooks: string[];
    implementationRule: string;
  };
  fontRecommendationContract: {
    recordIds: string[];
    selected: unknown[];
    recommendations: unknown[];
    implementationRule: string;
  };
  iconContract: {
    recordIds: string[];
    icons: unknown[];
    implementationRule: string;
  };
  previewDetailChecklist: unknown[];
  componentReferenceContract: {
    recordIds: string[];
    references: WebCodegenComponentReference[];
    sectionBlueprints: SectionImplementationBlueprint[];
    implementationRule: string;
  };
  motionContract: {
    motionPlan: unknown[];
    assetMotionPlan: unknown[];
    componentMotionCarryover: unknown[];
    implementationRule: string;
  };
  assetContract: {
    requirements: WebCodegenAssetRequirement[];
    resolvedAssets: WebCodegenResolvedAsset[];
    publicAssetCandidates: PublicAssetCandidateContract[];
    normalizedAssetSearches: unknown[];
    unresolvedCandidateAudits: Array<{ assetId: string; issue: string }>;
    implementationRule: string;
  };
  sectionCodegenContract: {
    sections: SectionCodegenInput[];
    implementationRule: string;
  };
  sectionDraftPersistenceContract: {
    targetField: "webPageSectionDrafts";
    requiredFields: string[];
    verificationRule: string;
    implementationRule: string;
  };
  mergeCodegenContract: {
    approvedPreviewNodes: string[];
    requiresPersistedSectionDrafts: boolean;
    persistedDraftField: "webPageSectionDrafts";
    globalShellContract: {
      sectionOrder: Array<{ sectionId: string; previewNodeId: string; order: number }>;
      typography: {
        selectedDisplayFont: string;
        selectedBodyFont: string;
        externalFontAllowed: boolean | null;
        fontSource: string;
        cssHooks: string[];
      };
      sharedChrome: {
        globalNavMode: "required" | "section_local_only";
        sharedTabMode: "required" | "section_local_only";
        footerMode: "required" | "optional";
        buttonMaterial: string;
        motionOwner: string;
      };
      styleCues: string[];
      mobileRules: string[];
    };
    sectionAssembly: MergeSectionAssemblyInput[];
    resolvedAssetLedger: Array<{
      assetId: string;
      sectionId: string;
      previewNodeId: string;
      url: string;
      source: string;
    }>;
    consistencyChecklist: string[];
    stageCommitRules: string[];
    implementationRule: string;
  };
  assetGenerationContract: {
    promptRules: string[];
    componentAssetRules: string[];
    sourceAuditRules: string[];
  };
  mediaPlacementContract: {
    imageAssetIds: string[];
    defaultRule: string;
    forbiddenPattern: string;
    surfaceRule: string;
    configuratorRule: string;
  };
  visualStructureContract: {
    sectionArtifacts: Array<{
      sectionId: string;
      layoutSkeleton: string;
      componentGeometry: string;
      mediaRole: string;
      requiredDomArtifacts: string[];
      requiredCssArtifacts: string[];
      forbiddenImplementation: string[];
    }>;
    implementationRule: string;
  };
  sourceTreeContract: {
    minimumFiles: string[];
    implementationRule: string;
  };
  designDiversityContract: {
    antiSamenessRules: string[];
    previewSpecificDetailRules: string[];
    componentDetailRules: string[];
  };
  motionImplementationChecklist: string[];
  finalPromptAddendum: string;
};

const MAX_TEXT_EXCERPT = 1400;
const MAX_ARRAY_ITEMS = 12;
const MAX_REFERENCES_PER_RECORD = 3;
const MAX_FINAL_PROMPT_ADDENDUM_CHARS = 7000;

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function clipText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars).trim();
}

function readBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readStringArray(value: unknown, limit = MAX_ARRAY_ITEMS): string[] {
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

function readStringFromRecordKeys(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }
  return "";
}

function readRecordArray(value: unknown, limit = MAX_ARRAY_ITEMS): unknown[] {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) return parsed.slice(0, limit);
  return [];
}

function readRecordCollection(value: unknown, limit = MAX_ARRAY_ITEMS): unknown[] {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) return parsed.slice(0, limit);
  if (!isRecord(parsed)) return [];
  const values = Object.values(parsed).filter(isRecord);
  return values.slice(0, limit);
}

function hasNonEmptyObjectOrArray(value: unknown): boolean {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) return parsed.length > 0;
  return isRecord(parsed) && Object.keys(parsed).length > 0;
}

function readScalarString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function assetRecordId(record: Record<string, unknown>): string {
  return (
    readString(record.assetId) ||
    readString(record.id) ||
    readString(record.requirementId) ||
    readString(record.slotId) ||
    readString(record.webPageAssetId)
  );
}

function hasWebHeroPreCodeAssetEvidence(data: Record<string, unknown>): boolean {
  return diagnoseWebHeroPreCodeAssetEvidence(data).ok;
}

function diagnoseWebHeroPreCodeAssetEvidence(data: Record<string, unknown>): WebHeroPreCodeAssetEvidenceDiagnosis {
  const workflow = isRecord(data.webPageWorkflowContract) ? data.webPageWorkflowContract : {};
  const approvedPreviewNodeIds = Array.isArray(workflow.approvedPreviewNodes)
    ? workflow.approvedPreviewNodes.map(readString).filter(Boolean)
    : [];
  const diagnosis = diagnoseWebHeroAssetRequirements(data.webPageAssetRequirements, {
    approvedPreviewNodeIds,
  });
  return {
    ok: diagnosis.ok,
    missing: diagnosis.issues,
    visualSlots: diagnosis.visualSlots,
  };
}

function hasWebHeroAssetDecisionEvidence(data: Record<string, unknown>): boolean {
  return diagnoseWebHeroAssetDecisions(data.webPageAssetDecisions).ok;
}

function hasGeneratedAssetDecisionRecords(data: Record<string, unknown>): boolean {
  const decisions = parseMaybeJson(data.webPageAssetDecisions);
  if (!isRecord(decisions)) return false;
  return Array.isArray(decisions.generatedAssets) && decisions.generatedAssets.length > 0;
}

function readNestedRecord(root: Record<string, unknown>, path: string[]): Record<string, unknown> | null {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  return isRecord(current) ? current : null;
}

function readSectionId(record: Record<string, unknown>): string {
  return readStringFromRecordKeys(record, [
    "targetSectionId",
    "sectionId",
    "id",
    "previewNodeId",
    "sourcePreviewNodeId",
  ]);
}

function readArtifactArray(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const direct = readStringArray(record[key], MAX_ARRAY_ITEMS);
    if (direct.length) return direct;
  }
  const artifacts = readRecordArray(record.artifacts, MAX_ARRAY_ITEMS);
  const out: string[] = [];
  for (const artifact of artifacts) {
    if (!isRecord(artifact)) continue;
    const text = readStringFromRecordKeys(artifact, ["name", "artifact", "component", "dom", "css", "description"]);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function collectPreviewStructureItems(brief: Record<string, unknown>): unknown[] {
  const candidates = [
    brief.previewStructureArtifacts,
    brief.previewStructure,
    brief.structureArtifacts,
    brief.sectionStructureArtifacts,
    readNestedRecord(brief, ["previewAlignmentAudit"])?.previewStructureArtifacts,
    readNestedRecord(brief, ["previewAlignmentAudit"])?.structureArtifacts,
  ];
  for (const candidate of candidates) {
    const items = readRecordCollection(candidate, MAX_ARRAY_ITEMS);
    if (items.length) return items;
  }
  const sectionMap = readRecordCollection(brief.sectionMap, MAX_ARRAY_ITEMS);
  if (sectionMap.length) return sectionMap;
  return [];
}

function collectVisualStructureContract(brief: Record<string, unknown>): WebCodegenContract["visualStructureContract"] {
  const audit = readNestedRecord(brief, ["previewAlignmentAudit"]);
  const sectionComparisons = Array.isArray(audit?.sectionComparisons) ? audit.sectionComparisons : [];
  const sectionArtifacts: WebCodegenContract["visualStructureContract"]["sectionArtifacts"] = [];
  for (const item of sectionComparisons) {
    if (!isRecord(item)) continue;
    const requiredDomArtifacts = readArtifactArray(item, ["requiredDomArtifacts", "domArtifacts", "components", "requiredComponents"]);
    const requiredCssArtifacts = readArtifactArray(item, ["requiredCssArtifacts", "cssArtifacts", "styleArtifacts"]);
    const forbiddenImplementation = readStringArray(item.forbiddenImplementation, MAX_ARRAY_ITEMS);
    sectionArtifacts.push({
      sectionId: readSectionId(item),
      layoutSkeleton: readString(item.layoutSkeleton) || readString(item.layoutCarryover),
      componentGeometry: readString(item.componentGeometry) || readString(item.visualTokenCarryover),
      mediaRole: readString(item.mediaRole) || readString(item.mediaCarryover),
      requiredDomArtifacts,
      requiredCssArtifacts,
      forbiddenImplementation,
    });
    if (sectionArtifacts.length >= MAX_ARRAY_ITEMS) break;
  }
  if (!sectionArtifacts.length) {
    for (const item of collectPreviewStructureItems(brief)) {
      if (!isRecord(item)) continue;
      const requiredDomArtifacts = readArtifactArray(item, ["requiredDomArtifacts", "domArtifacts", "components", "requiredComponents", "keyComponents"]);
      const requiredCssArtifacts = readArtifactArray(item, ["requiredCssArtifacts", "cssArtifacts", "styleArtifacts", "visualTokens"]);
      const fallbackDom = requiredDomArtifacts.length
        ? requiredDomArtifacts
        : readStringFromRecordKeys(item, ["title", "name", "section", "description", "layout"]) ? [readStringFromRecordKeys(item, ["title", "name", "section", "description", "layout"])] : [];
      sectionArtifacts.push({
        sectionId: readSectionId(item) || `section-${sectionArtifacts.length + 1}`,
        layoutSkeleton: readString(item.layoutSkeleton) || readString(item.layout) || readString(item.notes),
        componentGeometry: readString(item.componentGeometry) || readString(item.geometry) || readString(item.visualDirection),
        mediaRole: readString(item.mediaRole) || readString(item.media) || readString(item.assetUsage),
        requiredDomArtifacts: fallbackDom,
        requiredCssArtifacts,
        forbiddenImplementation: readStringArray(item.forbiddenImplementation, MAX_ARRAY_ITEMS),
      });
      if (sectionArtifacts.length >= MAX_ARRAY_ITEMS) break;
    }
  }
  return {
    sectionArtifacts,
    implementationRule:
      "Final React source must instantiate every requiredDomArtifacts item as named DOM/SVG/component structure and every requiredCssArtifacts item as CSS. These are structural fidelity artifacts from the approved preview, not optional descriptive prose. If a preview includes technical curves, translucent panels, continuous strips, rails, labels, or masks, they must appear here before final code.",
  };
}

function hasRequiredStructureArtifacts(contract: WebCodegenContract["visualStructureContract"]): boolean {
  return contract.sectionArtifacts.some((section) => section.requiredDomArtifacts.length > 0);
}

function requiresIconSearch(brief: Record<string, unknown>): boolean {
  const iconPlan = readNestedRecord(brief, ["iconPlan"]);
  if (!iconPlan) return false;
  if (readStringArray(iconPlan.requiredIcons, MAX_ARRAY_ITEMS).length > 0) return true;
  if (readStringArray(iconPlan.iconIds, MAX_ARRAY_ITEMS).length > 0) return true;
  if (Array.isArray(iconPlan.searches) && iconPlan.searches.length > 0) return true;
  return readString(iconPlan.requirement).length > 0;
}

function nodeRecordId(node: Record<string, unknown>): string {
  return readString(node.id) || readString(node.nodeId);
}

function findTargetNodeDataInNodes(nodes: unknown, targetNodeId: string): Record<string, unknown> | null {
  if (!Array.isArray(nodes) || !targetNodeId) return null;
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    if (nodeRecordId(node) !== targetNodeId) continue;
    return isRecord(node.data) ? { ...node.data } : { ...node };
  }
  return null;
}

function extractTargetNodeDataFromContainer(value: unknown, targetNodeId: string, depth = 0): Record<string, unknown> | null {
  if (depth > 5) return null;
  if (typeof value === "string") {
    const parsed = parseMaybeJson(value);
    return parsed === value ? null : extractTargetNodeDataFromContainer(parsed, targetNodeId, depth + 1);
  }
  if (!isRecord(value)) return null;

  const directNodeData = nodeRecordId(value) === targetNodeId && isRecord(value.data)
    ? { ...value.data }
    : null;
  if (directNodeData) return directNodeData;

  const fromNodes = findTargetNodeDataInNodes(value.nodes, targetNodeId);
  if (fromNodes) return fromNodes;

  for (const key of ["flow", "data", "result", "content", "payload", "graph"]) {
    const nested = extractTargetNodeDataFromContainer(value[key], targetNodeId, depth + 1);
    if (nested) return nested;
  }

  return null;
}

function extractDirectTargetNodeData(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  if (isRecord(value.data) && !Array.isArray(value.nodes)) return { ...value.data };
  if (Array.isArray(value.nodes)) return {};
  return { ...value };
}

function readInputData(args: Record<string, unknown>): Record<string, unknown> {
  const targetNodeId = readString(args.targetNodeId);
  const targetNodeData = parseMaybeJson(args.targetNodeData);
  const base = extractTargetNodeDataFromContainer(targetNodeData, targetNodeId) ||
    extractTargetNodeDataFromContainer(args, targetNodeId) ||
    extractDirectTargetNodeData(targetNodeData);
  const directKeys = [
    "webPageReferencePrompt",
    "webPageImplementationBrief",
    "webPageAssetRequirements",
    "webPageResolvedAssets",
    "webPagePreviewComposite",
    "webWorkflowStage",
    "webWorkflowPlaceholder",
    "fontPlan",
    "previewDetailChecklist",
    "componentReferencePlan",
    "fontRecordIds",
    "iconRecordIds",
    "assetRecordIds",
    "retrievalPack",
    "motionPlan",
    "assetMotionPlan",
    "previewAlignmentAudit",
    "previewStructureArtifacts",
    "previewStructure",
    "structureArtifacts",
    "sectionStructureArtifacts",
    "sectionMap",
    "interactionNotes",
    "interactions",
    "animationPlan",
    "animationNotes",
    "microInteractions",
  ];
  for (const key of directKeys) {
    if (typeof args[key] !== "undefined") base[key] = args[key];
  }
  return base;
}

function readImplementationBrief(data: Record<string, unknown>): Record<string, unknown> {
  const parsed = parseMaybeJson(data.webPageImplementationBrief);
  const brief = isRecord(parsed) ? { ...parsed } : {};
  const topLevelBridgeKeys = [
    "fontPlan",
    "previewDetailChecklist",
    "componentReferencePlan",
    "fontRecordIds",
    "iconRecordIds",
    "assetRecordIds",
    "retrievalPack",
    "motionPlan",
    "assetMotionPlan",
    "previewAlignmentAudit",
    "previewStructureArtifacts",
    "previewStructure",
    "structureArtifacts",
    "sectionStructureArtifacts",
    "sectionMap",
    "interactionNotes",
    "interactions",
    "animationPlan",
    "animationNotes",
    "microInteractions",
  ];
  for (const key of topLevelBridgeKeys) {
    if (typeof brief[key] === "undefined" && typeof data[key] !== "undefined") {
      brief[key] = data[key];
    }
  }
  return brief;
}

function collectRecordIdsFromBrief(brief: Record<string, unknown>, extra: unknown): string[] {
  const ids: string[] = [];
  const push = (value: unknown): void => {
    const id = readString(value);
    if (id && !ids.includes(id)) ids.push(id);
  };
  for (const id of readStringArray(extra, 20)) push(id);
  for (const id of readStringArray(brief.fontRecordIds, 40)) push(id);
  for (const id of readStringArray(brief.iconRecordIds, 40)) push(id);
  for (const id of readStringArray(brief.assetRecordIds, 40)) push(id);
  for (const id of readStringArray(readNestedRecord(brief, ["fontPlan"])?.recordIds, 40)) push(id);
  for (const id of readStringArray(readNestedRecord(brief, ["iconPlan"])?.recordIds, 40)) push(id);
  for (const id of readStringArray(readNestedRecord(brief, ["assetSearchPlan"])?.recordIds, 40)) push(id);
  const retrievalPack = readNestedRecord(brief, ["retrievalPack"]);
  push(retrievalPack?.packRecordId);
  push(retrievalPack?.retrievalPackId);
  for (const id of readStringArray(retrievalPack?.recordIds, 40)) push(id);

  const componentPlan = readNestedRecord(brief, ["componentReferencePlan"]);
  const componentPlanRecordIds = [
    ...readStringArray(componentPlan?.searchRecords, 40),
    ...readStringArray(componentPlan?.recordIds, 40),
  ];
  if (!componentPlanRecordIds.length) {
    push(componentPlan?.retrievalPack);
    push(componentPlan?.retrievalPackId);
  }
  for (const id of componentPlanRecordIds) push(id);
  const decisions = Array.isArray(componentPlan?.sectionDecisions) ? componentPlan?.sectionDecisions : [];
  for (const decision of decisions) {
    if (!isRecord(decision)) continue;
    push(decision.retrievalRecordId);
    const topReferences = Array.isArray(decision.topReferences) ? decision.topReferences : [];
    for (const reference of topReferences) {
      if (isRecord(reference)) push(reference.retrievalRecordId);
    }
  }
  return ids;
}

async function readRetrievalRecords(input: {
  ctx: ToolContext;
  ids: string[];
}): Promise<{ records: RetrievalRecord[]; missingIds: string[] }> {
  const store = createRetrievalRecordStore(input.ctx);
  const records: RetrievalRecord[] = [];
  const missingIds: string[] = [];
  for (const id of input.ids) {
    try {
      records.push(await store.get(id));
    } catch {
      missingIds.push(id);
    }
  }
  return { records, missingIds };
}

function collectPayloadResults(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  const direct = Array.isArray(payload.results) ? payload.results : [];
  if (direct.length) return direct;
  const nested: unknown[] = [];
  const componentSearches = Array.isArray(payload.componentSearches) ? payload.componentSearches : [];
  for (const item of componentSearches) {
    if (!isRecord(item)) continue;
    const top = Array.isArray(item.topReferenceCandidates) ? item.topReferenceCandidates : [];
    nested.push(...top);
  }
  return nested;
}

function collectPublicAssetSearches(records: RetrievalRecord[]): PublicAssetCandidateContract[] {
  const out: PublicAssetCandidateContract[] = [];
  const pushSearch = (item: unknown): void => {
    if (!isRecord(item)) return;
    const assetId = readString(item.assetId);
    const candidateUrls = readStringArray(item.candidateUrls, 12);
    const retrievalRecordId = readString(item.retrievalRecordId)
      || readString(readNestedRecord(item, ["retrievalRecord"])?.id);
    if (!assetId && !candidateUrls.length) return;
    out.push({
      assetId,
      sectionId: readString(item.sectionId),
      query: readString(item.query),
      need: readString(item.need),
      retrievalRecordId,
      candidateUrls,
      decisionRule: candidateUrls.length
        ? "Reuse one returned URL for generic/background/atmosphere needs unless sourceAudit.rejectionReasons explains why each candidate is unsuitable."
        : "No public candidate URL was returned; generated asset is allowed only with sourceAudit.generationReason.",
    });
  };
  for (const record of records) {
    const payload = isRecord(record.payload) ? record.payload : {};
    if (record.kind === "web_asset_public_search") {
      const results = Array.isArray(payload.results) ? payload.results : [];
      out.push({
        assetId: "",
        sectionId: "",
        query: readString(payload.originalQuery) || record.query,
        need: "",
        retrievalRecordId: record.id,
        candidateUrls: results
          .map((item) => isRecord(item) ? readString(item.url) : "")
          .filter((url) => url.length > 0)
          .slice(0, 12),
        decisionRule:
          "This direct public search record must be reflected in sourceAudit. If candidateUrls are present and final code uses generated media instead, record concrete rejectionReasons.",
      });
    }
    const publicAssetSearches = Array.isArray(payload.publicAssetSearches) ? payload.publicAssetSearches : [];
    for (const item of publicAssetSearches) pushSearch(item);
  }
  const deduped: PublicAssetCandidateContract[] = [];
  const seen = new Set<string>();
  for (const item of out) {
    const key = `${item.assetId}|${item.retrievalRecordId}|${item.candidateUrls.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= MAX_ARRAY_ITEMS) break;
  }
  return deduped;
}

function collectNormalizedAssetSearches(records: RetrievalRecord[]): unknown[] {
  const out: unknown[] = [];
  for (const record of records) {
    if (record.kind !== "web_asset_search") continue;
    const payload = isRecord(record.payload) ? record.payload : {};
    const results = Array.isArray(payload.results) ? payload.results : [];
    for (const result of results) {
      if (!isRecord(result)) continue;
      out.push({
        recordId: record.id,
        query: record.query,
        title: readString(result.title),
        provider: readString(result.provider),
        downloadUrl: readString(result.downloadUrl),
        previewUrl: readString(result.previewUrl),
        sourceUrl: readString(result.sourceUrl),
        format: readString(result.format),
        isVector: result.isVector === true,
        hasAlpha: typeof result.hasAlpha === "boolean" ? result.hasAlpha : null,
        transparencyEvidence: readString(result.transparencyEvidence),
        width: typeof result.width === "number" && Number.isFinite(result.width) ? result.width : null,
        height: typeof result.height === "number" && Number.isFinite(result.height) ? result.height : null,
        aspectRatio: typeof result.aspectRatio === "number" && Number.isFinite(result.aspectRatio) ? result.aspectRatio : null,
        shape: readString(result.shape),
        license: readString(result.license),
        attribution: readString(result.attribution),
        metadataProbeError: readString(result.metadataProbeError),
      });
      if (out.length >= MAX_ARRAY_ITEMS) return out;
    }
  }
  return out;
}

function collectIconContract(records: RetrievalRecord[]): WebCodegenContract["iconContract"] {
  const recordIds: string[] = [];
  const icons: unknown[] = [];
  const pushIcon = (recordId: string, query: string, result: unknown): void => {
    if (!isRecord(result)) return;
    icons.push({
      recordId,
      query,
      iconId: readString(result.iconId),
      name: readString(result.name),
      prefix: readString(result.prefix),
      viewBox: readString(result.viewBox),
      width: typeof result.width === "number" && Number.isFinite(result.width) ? result.width : null,
      height: typeof result.height === "number" && Number.isFinite(result.height) ? result.height : null,
      svg: readString(result.svg),
      license: readString(result.license),
      category: readString(result.category),
      usageHint: readString(result.usageHint),
    });
  };
  for (const record of records) {
    const payload = isRecord(record.payload) ? record.payload : {};
    if (record.kind === "icon_search") {
      recordIds.push(record.id);
      const results = Array.isArray(payload.results) ? payload.results : [];
      for (const result of results) {
        pushIcon(record.id, record.query, result);
        if (icons.length >= MAX_ARRAY_ITEMS) break;
      }
    }
    const iconSearches = Array.isArray(payload.iconSearches) ? payload.iconSearches : [];
    for (const search of iconSearches) {
      if (!isRecord(search)) continue;
      const nestedRecord = readNestedRecord(search, ["retrievalRecord"]);
      const nestedRecordId = readString(nestedRecord?.id);
      if (nestedRecordId && !recordIds.includes(nestedRecordId)) recordIds.push(nestedRecordId);
      const candidates = Array.isArray(search.topIconCandidates) ? search.topIconCandidates : [];
      for (const result of candidates) {
        pushIcon(nestedRecordId || record.id, readString(search.query) || record.query, result);
        if (icons.length >= MAX_ARRAY_ITEMS) break;
      }
      if (icons.length >= MAX_ARRAY_ITEMS) break;
    }
    if (icons.length >= MAX_ARRAY_ITEMS) break;
  }
  return {
    recordIds,
    icons,
    implementationRule:
      "When icon records exist, final React source should inline selected SVGs for configurator controls, dock/sticker buttons, CTA buttons, spec rows, and labels. Do not collapse icon-bearing controls into text-only pills.",
  };
}

function collectFontRecommendationContract(records: RetrievalRecord[]): WebCodegenContract["fontRecommendationContract"] {
  const recordIds: string[] = [];
  const selected: unknown[] = [];
  const recommendations: unknown[] = [];
  for (const record of records) {
    if (record.kind !== "font_recommendation_search") continue;
    recordIds.push(record.id);
    const payload = isRecord(record.payload) ? record.payload : {};
    if (isRecord(payload.selected)) {
      selected.push({ recordId: record.id, query: record.query, ...payload.selected });
    }
    const results = Array.isArray(payload.recommendations) ? payload.recommendations : [];
    for (const result of results) {
      if (!isRecord(result)) continue;
      recommendations.push({ recordId: record.id, query: record.query, ...result });
      if (recommendations.length >= MAX_ARRAY_ITEMS) break;
    }
  }
  return {
    recordIds,
    selected,
    recommendations,
    implementationRule:
      "When font recommendation records exist, use selected.displayFont/bodyFont/googleCssUrl to build fontPlan and final CSS imports. Do not revert to system/default fonts unless the record explicitly failed and the user accepts a fallback.",
  };
}

function readCandidateSource(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (isRecord(value.componentReferencePlanCandidate)) return value.componentReferencePlanCandidate;
  return value;
}

function readCandidateText(candidate: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = readString(candidate[key]);
    if (text) return text;
  }
  return "";
}

function readCandidateTitle(candidate: Record<string, unknown>): string {
  return readCandidateText(candidate, ["name", "title", "referenceId", "id"]);
}

function readCandidateReferenceId(candidate: Record<string, unknown>): string {
  return readCandidateText(candidate, ["referenceId", "id", "name", "title"]);
}

function readCandidateSourceUrl(candidate: Record<string, unknown>): string {
  return readCandidateText(candidate, ["source", "sourceUrl", "url"]);
}

function lowerText(value: string): string {
  return value.toLowerCase();
}

function isPrimaryMediaHostileReference(candidate: Record<string, unknown>): boolean {
  const category = lowerText(readString(candidate.category));
  const subcategory = lowerText(readString(candidate.subcategory));
  const title = lowerText(readCandidateTitle(candidate));
  const summary = lowerText(readString(candidate.summary));
  const combined = [subcategory, title, summary].join(" ");
  const detailChrome = isDetailChromeReference(candidate);
  if (["table", "admin", "form", "pricing"].includes(category)) return true;
  if (category === "card" && !detailChrome) return true;
  return [
    "tilt card",
    "3d tilt",
    "product card",
    "cards slider",
    "analytics table",
    "reorderable table",
    "pricing card",
    "bento",
  ].some((term) => combined.includes(term));
}

function isDetailChromeReference(candidate: Record<string, unknown>): boolean {
  const category = lowerText(readString(candidate.category));
  const subcategory = lowerText(readString(candidate.subcategory));
  const summary = lowerText(readString(candidate.summary));
  const componentRole = lowerText(readString(candidate.componentRole));
  const referenceId = lowerText(readCandidateReferenceId(candidate));
  const title = lowerText(readCandidateTitle(candidate));
  const combined = [category, subcategory, summary, componentRole, referenceId, title].join(" ");
  return [
    "dock",
    "sticker",
    "icon button",
    "gradient button",
    "toolbar",
    "control",
    "chip",
    "badge",
    "media slot",
  ].some((term) => combined.includes(term));
}

function isStrongCinematicReference(candidate: Record<string, unknown>): boolean {
  const category = lowerText(readString(candidate.category));
  const subcategory = lowerText(readString(candidate.subcategory));
  const summary = lowerText(readString(candidate.summary));
  const componentRole = lowerText(readString(candidate.componentRole));
  const referenceId = lowerText(readCandidateReferenceId(candidate));
  const title = lowerText(readCandidateTitle(candidate));
  const combined = [category, subcategory, summary, componentRole, referenceId, title].join(" ");
  return [
    "hero",
    "full-screen",
    "full-viewport",
    "scroll",
    "pinned",
    "cinematic",
    "shader-background",
    "blueprint",
  ].some((term) => combined.includes(term));
}

function createReferenceDecision(value: unknown): ComponentReferenceDecision | null {
  const candidate = readCandidateSource(value);
  if (!candidate) return null;
  const referenceId = readCandidateReferenceId(candidate);
  const title = readCandidateTitle(candidate);
  if (!referenceId && !title) return null;
  const category = readString(candidate.category) || readString(candidate.componentRole) || "unknown";
  const hostile = isPrimaryMediaHostileReference(candidate);
  const strong = isStrongCinematicReference(candidate);
  const detailChrome = isDetailChromeReference(candidate);
  const decision: "select" | "reject" = !hostile && (strong || detailChrome) ? "select" : "reject";
  const reason = decision === "select"
    ? detailChrome && !strong
      ? "Matches detailed UI chrome such as dock, sticker, icon button, gradient control, badge, or nested media slot; use as a subcomponent reference only."
      : "Matches cinematic/full-viewport/scroll/technical structure that can support the approved preview without replacing media composition."
    : hostile
      ? "Rejected as primary section driver because it is card/table/admin/tilt-oriented and would push image-led previews into rounded-card layouts."
      : "Rejected as primary section driver because it does not provide enough section-level layout or motion structure for this preview.";
  const usage = decision === "select"
    ? detailChrome && !strong
      ? "Use for local component details: icon placement, per-item gradient, sticker/dock hover, nested media slot, and active state. Do not use it as the page's main layout."
      : "Use only the structure, motion rhythm, and material language; replace demo assets/content with approved section assets and preview typography."
    : "Do not use as the main layout. At most borrow a tiny control/detail if it does not affect media placement.";
  return {
    referenceId: referenceId || title,
    title: title || referenceId,
    category,
    sourceUrl: readCandidateSourceUrl(candidate),
    decision,
    reason,
    usage,
  };
}

function collectComponentMotionCarryover(records: RetrievalRecord[]): unknown[] {
  const motion: unknown[] = [];
  for (const record of records) {
    for (const result of collectPayloadResults(record.payload)) {
      const source = readCandidateSource(result);
      if (!source) continue;
      if (isPrimaryMediaHostileReference(source)) continue;
      if (typeof source.motionCarryover !== "undefined") motion.push(source.motionCarryover);
      if (motion.length >= MAX_ARRAY_ITEMS) return motion;
    }
  }
  return motion;
}

function readSectionSearchesFromRecord(record: RetrievalRecord): Array<{
  sectionId: string;
  query: string;
  topReferenceCandidates: unknown[];
}> {
  const payload = isRecord(record.payload) ? record.payload : {};
  const searches = Array.isArray(payload.componentSearches) ? payload.componentSearches : [];
  const out: Array<{ sectionId: string; query: string; topReferenceCandidates: unknown[] }> = [];
  for (const item of searches) {
    if (!isRecord(item)) continue;
    out.push({
      sectionId: readString(item.sectionId) || readString(item.id) || "section",
      query: readString(item.query) || record.query,
      topReferenceCandidates: readRecordArray(item.topReferenceCandidates, MAX_REFERENCES_PER_RECORD),
    });
  }
  return out;
}

function buildSectionBlueprint(input: {
  sectionId: string;
  sourceRecordId: string;
  query: string;
  candidates: unknown[];
}): SectionImplementationBlueprint {
  const decisions = input.candidates
    .map((candidate) => createReferenceDecision(candidate))
    .filter((decision): decision is ComponentReferenceDecision => Boolean(decision));
  const selectedReferences = decisions.filter((decision) => decision.decision === "select").slice(0, 2);
  const rejectedReferences = decisions.filter((decision) => decision.decision === "reject");
  const implementationMode = selectedReferences.length ? "use_selected_references" : "write_from_scratch";
  return {
    sectionId: input.sectionId,
    sourceRecordId: input.sourceRecordId,
    query: input.query,
    selectedReferences,
    rejectedReferences,
    implementationMode,
    layoutRule:
      "Preserve approved-preview spatial grammar first: media planes, typography anchors, rails, masks, gradients, and spec stacks beat generic component layout.",
    motionRule:
      "Implement cinematic motion from selected references only when compatible: staged entrance, scroll/pin/mask/parallax, telemetry line animation, glass hover; reject card tilt/breathing media scale.",
    mediaRule:
      "Primary product/interior/CTA media must render as full-bleed, edge-to-edge, masked, centered stage, or gradient-blended layer, not as a rounded bordered image card.",
    requiredComponents: [
      "section module",
      "MediaStage or full-bleed media layer",
      "TelemetryRail or SpecStack",
      "GlassControls or GlassButton",
      "motion hook/timeline owner",
    ],
  };
}

function buildSectionBlueprints(records: RetrievalRecord[]): SectionImplementationBlueprint[] {
  const out: SectionImplementationBlueprint[] = [];
  for (const record of records) {
    const sectionSearches = readSectionSearchesFromRecord(record);
    if (sectionSearches.length) {
      for (const search of sectionSearches) {
        out.push(buildSectionBlueprint({
          sectionId: search.sectionId,
          sourceRecordId: record.id,
          query: search.query,
          candidates: search.topReferenceCandidates,
        }));
      }
      continue;
    }
    if (record.kind !== "component_reference_search") continue;
    out.push(buildSectionBlueprint({
      sectionId: inferSectionIdFromQuery(record.query),
      sourceRecordId: record.id,
      query: record.query,
      candidates: collectPayloadResults(record.payload).slice(0, MAX_REFERENCES_PER_RECORD),
    }));
  }
  const deduped: SectionImplementationBlueprint[] = [];
  const seen = new Set<string>();
  for (const blueprint of out) {
    const key = `${blueprint.sectionId}:${blueprint.sourceRecordId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(blueprint);
    if (deduped.length >= MAX_ARRAY_ITEMS) break;
  }
  return deduped;
}

function buildFallbackSectionBlueprints(brief: Record<string, unknown>): SectionImplementationBlueprint[] {
  const componentPlan = readNestedRecord(brief, ["componentReferencePlan"]);
  const sectionDecisions = readRecordCollection(componentPlan?.sectionDecisions, MAX_ARRAY_ITEMS);
  const sectionMap = readRecordCollection(brief.sectionMap, MAX_ARRAY_ITEMS);
  const audit = readNestedRecord(brief, ["previewAlignmentAudit"]);
  const sectionComparisons = readRecordArray(audit?.sectionComparisons, MAX_ARRAY_ITEMS);
  const sourceItems = sectionDecisions.length ? sectionDecisions : sectionMap.length ? sectionMap : sectionComparisons;
  const out: SectionImplementationBlueprint[] = [];
  for (const item of sourceItems) {
    if (!isRecord(item)) continue;
    const sectionId = readSectionId(item) || `section-${out.length + 1}`;
    out.push({
      sectionId,
      sourceRecordId: readString(item.retrievalRecordId) || readString(item.recordId) || "target-node-brief",
      query: readString(item.query) || readString(item.title) || sectionId,
      selectedReferences: [],
      rejectedReferences: [],
      implementationMode: "write_from_scratch",
      layoutRule:
        readString(item.layoutRule) ||
        readString(item.notes) ||
        "Preserve the approved preview section structure using target-node brief evidence; no external component retrieval record was required.",
      motionRule:
        readString(item.motionRule) ||
        readString(item.motion) ||
        "Implement section-appropriate entrance, hover, and scroll motion from the motionPlan or interaction notes.",
      mediaRule:
        readString(item.mediaRule) ||
        readString(item.assetUsage) ||
        "Use resolved section assets as embedded media; do not replace with generic cards or CSS-only placeholders.",
      requiredComponents:
        readArtifactArray(item, ["requiredComponents", "components", "requiredDomArtifacts", "keyComponents"]).length
          ? readArtifactArray(item, ["requiredComponents", "components", "requiredDomArtifacts", "keyComponents"])
          : ["section module", "MediaStage", "CTA/control group"],
    });
    if (out.length >= MAX_ARRAY_ITEMS) break;
  }
  return out;
}

function inferSectionIdFromQuery(query: string): string {
  const lowered = lowerText(query);
  if (lowered.includes("preorder") || lowered.includes("pre-order")) return "preorder";
  if (lowered.includes("footer")) return "footer";
  if (lowered.includes("reserve") || lowered.includes("reservation")) return "reserve";
  if (lowered.includes("hero")) return "hero";
  if (lowered.includes("performance") || lowered.includes("range")) return "performance";
  if (lowered.includes("interior") || lowered.includes("safety")) return "interior";
  if (lowered.includes("cta")) return "cta";
  if (lowered.includes("configurator") || lowered.includes("color rail")) return "configurator";
  return "section";
}

function buildComponentReferences(records: RetrievalRecord[]): WebCodegenComponentReference[] {
  return records
    .filter((record) => record.kind === "component_reference_search" || record.kind === "web_generation_retrieval_prepare")
    .map((record) => ({
      recordId: record.id,
      query: record.query,
      titles: record.summary.titles,
      urls: record.summary.urls,
      topReferences: collectPayloadResults(record.payload)
        .map((item) => createReferenceDecision(item))
        .filter((item): item is ComponentReferenceDecision => Boolean(item))
        .slice(0, MAX_REFERENCES_PER_RECORD),
    }));
}

function collectMotionPlan(brief: Record<string, unknown>): unknown[] {
  const direct = readRecordArray(brief.motionPlan, MAX_ARRAY_ITEMS);
  if (direct.length) return direct;
  const candidates = [
    brief.interactionNotes,
    brief.interactions,
    brief.animationPlan,
    brief.animationNotes,
    brief.microInteractions,
  ];
  const out: unknown[] = [];
  for (const candidate of candidates) {
    const parsed = parseMaybeJson(candidate);
    if (Array.isArray(parsed)) {
      out.push(...parsed.slice(0, MAX_ARRAY_ITEMS - out.length));
    } else {
      const text = readString(parsed);
      if (text) out.push({ target: "page interactions", implementation: text });
    }
    if (out.length >= MAX_ARRAY_ITEMS) return out.slice(0, MAX_ARRAY_ITEMS);
  }
  for (const item of readRecordCollection(brief.sectionMap, MAX_ARRAY_ITEMS)) {
    if (!isRecord(item)) continue;
    const motion = readStringFromRecordKeys(item, ["motion", "interaction", "interactionNotes", "animation"]);
    if (motion) out.push({ target: readSectionId(item) || "section", implementation: motion });
    if (out.length >= MAX_ARRAY_ITEMS) break;
  }
  return out;
}

function collectAssetRequirements(value: unknown): WebCodegenAssetRequirement[] {
  const parsed = parseMaybeJson(value);
  const source = isRecord(parsed) && Array.isArray(parsed.visualSlots)
    ? parsed.visualSlots
    : [];
  const out: WebCodegenAssetRequirement[] = [];
  for (const item of source) {
    if (!isRecord(item)) continue;
    const renderMode = readString(item.renderMode);
    if (renderMode) {
      out.push({
        assetId: readString(item.assetId),
        placeholder: readString(item.placeholder),
        slotId: readString(item.slotId),
        visualSpecId:
          readString(item.visualSpecId) ||
          readString(item.sourceVisualSpecId) ||
          readString(item.previewVisualSpecId),
        visualSpecSummary:
          readString(item.visualSpecSummary) ||
          readString(item.previewVisualCue) ||
          readString(item.derivedFromPreview),
        sourceEvidence: item.sourceEvidence ?? item.previewEvidence ?? item.visualSpec,
        previewNodeId: readString(item.previewNodeId) ||
          readString(item.sourcePreviewNodeId) ||
          readString(item.webPreviewNodeId) ||
          readString(item.previewId) ||
          readString(item.approvedPreviewNodeId),
        screenshotOrder:
          readScalarString(item.screenshotOrder) ||
          readScalarString(item.webScreenshotOrder) ||
          readScalarString(item.previewOrder) ||
          readScalarString(item.order),
        renderMode,
        implementation: readString(item.implementation) || readString(item.decision),
        type: readString(item.type),
        category: readString(item.category),
        section: readString(item.section) || readString(item.sectionId),
        placement: readString(item.placement),
      });
    }
  }
  return out;
}

function readBrowserUrl(record: Record<string, unknown>): string {
  const direct = [readString(record.url), readString(record.imageUrl), readString(record.src)]
    .find((value) => value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:image/"));
  if (direct) return direct;
  const imageResults = Array.isArray(record.imageResults) ? record.imageResults : [];
  for (const item of imageResults) {
    if (!isRecord(item)) continue;
    const nested = [readString(item.url), readString(item.imageUrl), readString(item.src)]
      .find((value) => value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:image/"));
    if (nested) return nested;
  }
  return "";
}

function readBrowserUrlFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:image/")) {
      return trimmed;
    }
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = readBrowserUrlFromUnknown(item);
      if (url) return url;
    }
    return "";
  }
  if (isRecord(value)) return readBrowserUrl(value);
  return "";
}

function readSourceAuditSummary(record: Record<string, unknown>): AssetSourceAuditSummary {
  const sourceAudit = isRecord(record.sourceAudit) ? record.sourceAudit : {};
  return {
    publicSearchChecked: sourceAudit.publicSearchChecked === true,
    publicSearchRecordId: readString(sourceAudit.publicSearchRecordId) || readString(sourceAudit.retrievalRecordId),
    candidateUrls: readStringArray(sourceAudit.candidateUrls, 12),
    rejectionReasons: readStringArray(sourceAudit.rejectionReasons, 12),
    generationReason: readString(sourceAudit.generationReason),
    decision: readString(sourceAudit.decision),
  };
}

function collectResolvedAssets(value: unknown): WebCodegenResolvedAsset[] {
  const parsed = parseMaybeJson(value);
  const out: WebCodegenResolvedAsset[] = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (!isRecord(item)) return;
    const sourceNodeId = readString(item.sourceNodeId);
    const url = readBrowserUrl(item) || (sourceNodeId ? `{{asset:${sourceNodeId}}}` : "");
    if (url) {
      out.push({
        assetId: readString(item.assetId),
        placeholder: readString(item.placeholder),
        url,
        source: readString(item.source),
        sourceAudit: readSourceAuditSummary(item),
        previewDerived: false,
      });
    }
    for (const child of Object.values(item)) {
      if (Array.isArray(child) || isRecord(child)) visit(child);
    }
  };
  visit(parsed);
  return out;
}

function collectPreviewScreenshotUrls(value: unknown): Set<string> {
  const urls = new Set<string>();
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (!isRecord(item)) return;
    const nodeId = readString(item.id);
    const data = isRecord(item.data) ? item.data : item;
    const previewOwner =
      readString(data.webPreviewForNodeId) ||
      readString(item.webPreviewForNodeId);
    const previewUrl =
      readBrowserUrlFromUnknown(data.imageUrl) ||
      readBrowserUrlFromUnknown(data.imageResults) ||
      readBrowserUrlFromUnknown(data.assetInputs);
    if ((previewOwner || nodeId) && previewUrl && (
      previewOwner ||
      nodeId.startsWith("web_preview") ||
      nodeId.startsWith("preview_") ||
      nodeId.startsWith("webpage_preview_")
    )) {
      urls.add(previewUrl);
    }
    for (const child of Object.values(item)) {
      if (Array.isArray(child) || isRecord(child)) visit(child);
    }
  };
  visit(value);
  return urls;
}

function markPreviewDerivedResolvedAssets(
  resolvedAssets: WebCodegenResolvedAsset[],
  previewUrls: Set<string>,
): WebCodegenResolvedAsset[] {
  if (previewUrls.size < 1) return resolvedAssets;
  return resolvedAssets.map((asset) => ({
    ...asset,
    previewDerived: previewUrls.has(asset.url),
  }));
}

function collectUnresolvedCandidateAudits(input: {
  publicAssetCandidates: PublicAssetCandidateContract[];
  resolvedAssets: WebCodegenResolvedAsset[];
}): Array<{ assetId: string; issue: string }> {
  const issues: Array<{ assetId: string; issue: string }> = [];
  for (const candidate of input.publicAssetCandidates) {
    if (!candidate.assetId || !candidate.candidateUrls.length) continue;
    const resolved = input.resolvedAssets.find((asset) => asset.assetId === candidate.assetId);
    if (!resolved) {
      issues.push({
        assetId: candidate.assetId,
        issue: "Public candidates exist, but no resolved asset with this assetId is present.",
      });
      continue;
    }
    if (candidate.candidateUrls.includes(resolved.url)) continue;
    if (resolved.sourceAudit.rejectionReasons.length > 0) continue;
    issues.push({
      assetId: candidate.assetId,
      issue: "Final resolved asset does not use a public candidate and sourceAudit.rejectionReasons is empty.",
    });
  }
  return issues.slice(0, MAX_ARRAY_ITEMS);
}

function collectPreviewChecklist(brief: Record<string, unknown>): unknown[] {
  const direct = readRecordArray(brief.previewDetailChecklist, MAX_ARRAY_ITEMS);
  if (direct.length) return direct;
  const previewAlignment = readNestedRecord(brief, ["previewAlignmentAudit"]);
  const revisionActions = readRecordArray(previewAlignment?.revisionActions, MAX_ARRAY_ITEMS);
  const sectionComparisons = readRecordArray(previewAlignment?.sectionComparisons, MAX_ARRAY_ITEMS);
  return [...revisionActions, ...sectionComparisons].slice(0, MAX_ARRAY_ITEMS);
}

function collectPreviewVisualSpecs(data: Record<string, unknown>, brief: Record<string, unknown>): Record<string, unknown>[] {
  const explicit = parseMaybeJson(data.webPagePreviewVisualSpecs);
  if (Array.isArray(explicit)) {
    const records = explicit.filter(isRecord);
    if (records.length) return records.slice(0, MAX_ARRAY_ITEMS);
  }
  const candidates = [
    brief.previewVisualSpecs,
    brief.webPagePreviewVisualSpecs,
    brief.previewStructureArtifacts,
  ];
  for (const candidate of candidates) {
    const parsed = parseMaybeJson(candidate);
    if (!Array.isArray(parsed)) continue;
    const records = parsed.filter(isRecord);
    if (records.length) return records.slice(0, MAX_ARRAY_ITEMS);
  }
  const audit = readNestedRecord(brief, ["previewAlignmentAudit"]);
  const comparisons = readRecordArray(audit?.sectionComparisons, MAX_ARRAY_ITEMS).filter(isRecord);
  if (comparisons.length) {
    return comparisons.map((item, index) => {
      const sectionId = readSectionId(item) || `section-${index + 1}`;
      return {
        visualSpecId: readString(item.visualSpecId) || `spec-${sectionId}`,
        sectionId,
        previewNodeId: readString(item.previewNodeId) || readString(item.sourcePreviewNodeId),
        order: readScalarString(item.order) || String(index + 1),
        layoutSkeleton: readString(item.layoutSkeleton) || readString(item.layoutCarryover),
        mediaPlacement: readString(item.mediaPlacement) || readString(item.mediaCarryover) || readString(item.mediaRole),
        typographyHierarchy: readString(item.typographyHierarchy) || readString(item.typographyCarryover),
        motionIntent: readString(item.motionIntent) || readString(item.motionCarryover),
        requiredDomArtifacts: readArtifactArray(item, ["requiredDomArtifacts", "domArtifacts", "components", "requiredComponents"]),
        requiredCssArtifacts: readArtifactArray(item, ["requiredCssArtifacts", "cssArtifacts", "styleArtifacts"]),
      };
    });
  }
  const sectionMap = readRecordCollection(brief.sectionMap, MAX_ARRAY_ITEMS).filter(isRecord);
  if (sectionMap.length) {
    return sectionMap.map((item, index) => {
      const sectionId = readSectionId(item) || `section-${index + 1}`;
      return {
        visualSpecId: readString(item.visualSpecId) || `spec-${sectionId}`,
        sectionId,
        previewNodeId: readString(item.previewNodeId),
        order: readScalarString(item.order) || String(index + 1),
        layoutSkeleton: readString(item.layoutSkeleton) || readString(item.layout) || readString(item.notes),
        mediaPlacement: readString(item.mediaPlacement) || readString(item.media) || readString(item.assetUsage),
        typographyHierarchy: readString(item.typographyHierarchy) || readString(item.typography),
        motionIntent: readString(item.motionIntent) || readString(item.motion) || readString(item.interaction),
        requiredDomArtifacts: readArtifactArray(item, ["requiredDomArtifacts", "domArtifacts", "components", "requiredComponents", "keyComponents"]),
        requiredCssArtifacts: readArtifactArray(item, ["requiredCssArtifacts", "cssArtifacts", "styleArtifacts", "visualTokens"]),
      };
    });
  }
  return [];
}

function previewSpecCoverageKeys(record: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const previewNodeId =
    readString(record.previewNodeId) ||
    readString(record.sourcePreviewNodeId) ||
    readString(record.webPreviewNodeId) ||
    readString(record.previewId) ||
    readString(record.approvedPreviewNodeId);
  if (previewNodeId) keys.push(`preview:${previewNodeId}`);
  const sectionId =
    readString(record.sectionId) ||
    readString(record.targetSectionId) ||
    readString(record.section);
  if (sectionId) keys.push(`section:${sectionId}`);
  const order =
    readScalarString(record.screenshotOrder) ||
    readScalarString(record.webScreenshotOrder) ||
    readScalarString(record.previewOrder) ||
    readScalarString(record.order);
  if (order) keys.push(`order:${order}`);
  return keys;
}

function findPreviewVisualSpec(input: {
  specs: Record<string, unknown>[];
  sectionId: string;
  previewNodeId: string;
  order: number;
}): SectionCodegenInput["previewVisualSpec"] {
  const wanted = new Set([
    input.previewNodeId ? `preview:${input.previewNodeId}` : "",
    input.sectionId ? `section:${input.sectionId}` : "",
    input.order ? `order:${input.order}` : "",
  ].filter(Boolean));
  const spec = input.specs.find((candidate) =>
    previewSpecCoverageKeys(candidate).some((key) => wanted.has(key))
  );
  if (!spec) return null;
  const requiredDomArtifacts = readArtifactArray(spec, [
    "requiredDomArtifacts",
    "domArtifacts",
    "components",
    "requiredComponents",
    "keyComponents",
  ]);
  const requiredCssArtifacts = readArtifactArray(spec, [
    "requiredCssArtifacts",
    "cssArtifacts",
    "visualTokens",
    "styleArtifacts",
  ]);
  return {
    visualSpecId:
      readString(spec.visualSpecId) ||
      readString(spec.id) ||
      [input.previewNodeId, input.sectionId, input.order].filter(Boolean).join(":"),
    layoutSkeleton:
      readString(spec.layoutSkeleton) ||
      readString(spec.layout) ||
      readString(spec.spatialLayout) ||
      readString(spec.composition),
    mediaPlacement:
      readString(spec.mediaPlacement) ||
      readString(spec.mediaRole) ||
      readString(spec.assetUsage) ||
      readString(spec.productPlacement),
    typographyHierarchy:
      readString(spec.typographyHierarchy) ||
      readString(spec.typography) ||
      readString(spec.textHierarchy),
    motionIntent:
      readString(spec.motionIntent) ||
      readString(spec.motion) ||
      readString(spec.interaction),
    requiredDomArtifacts,
    requiredCssArtifacts,
  };
}

function hasPreviewVisualSpecsForSections(
  sections: WebCodegenContract["sectionCodegenContract"]["sections"],
): boolean {
  return sections.length > 0 && sections.every((section) => Boolean(section.previewVisualSpec));
}

function hasPersistedPreviewVisualSpecs(data: Record<string, unknown>, brief: Record<string, unknown>): boolean {
  const parsed = parseMaybeJson(data.webPagePreviewVisualSpecs);
  if (Array.isArray(parsed) && parsed.filter(isRecord).length > 0) return true;
  const nested = parseMaybeJson(brief.previewVisualSpecs ?? brief.webPagePreviewVisualSpecs);
  if (Array.isArray(nested) && nested.filter(isRecord).length > 0) return true;
  const audit = readNestedRecord(brief, ["previewAlignmentAudit"]);
  if (readRecordArray(audit?.sectionComparisons, MAX_ARRAY_ITEMS).filter(isRecord).length > 0) return true;
  return readRecordCollection(brief.sectionMap, MAX_ARRAY_ITEMS).filter(isRecord).length > 0;
}

function imageRequirementHasPreviewEvidence(requirement: WebCodegenAssetRequirement): boolean {
  const original = requirement as unknown as Record<string, unknown>;
  return Boolean(
    readString(original.visualSpecId) ||
    readString(original.sourceVisualSpecId) ||
    readString(original.previewVisualSpecId) ||
    readString(original.visualSpecSummary) ||
    readString(original.previewVisualCue) ||
    hasNonEmptyObjectOrArray(original.sourceEvidence) ||
    hasNonEmptyObjectOrArray(original.previewEvidence) ||
    hasNonEmptyObjectOrArray(original.visualSpec)
  );
}

function imageRequirementsMissingPreviewEvidence(requirements: WebCodegenAssetRequirement[]): string[] {
  return requirements
    .filter(isCodegenImageAssetRequirement)
    .filter((requirement) => !imageRequirementHasPreviewEvidence(requirement))
    .map((requirement) => requirement.assetId || requirement.slotId || requirement.placeholder)
    .filter(Boolean)
    .slice(0, MAX_ARRAY_ITEMS);
}

function summarizeUnknownText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (!isRecord(value)) return "";
  const direct = readStringFromRecordKeys(value, [
    "item",
    "title",
    "name",
    "label",
    "description",
    "notes",
    "summary",
    "usage",
    "layout",
    "motion",
    "implementation",
  ]);
  if (direct) return direct;
  const serialized = JSON.stringify(value);
  return serialized ? clipText(serialized, 180) : "";
}

function collectPreviewCueStrings(checklist: unknown[]): string[] {
  const cues: string[] = [];
  for (const item of checklist) {
    const text = summarizeUnknownText(item);
    if (!text || cues.includes(text)) continue;
    cues.push(text);
    if (cues.length >= 8) break;
  }
  return cues;
}

function readTypographyContract(brief: Record<string, unknown>): WebCodegenContract["typographyContract"] {
  const rawFontPlan = parseMaybeJson(brief.fontPlan);
  const fontPlan = isRecord(rawFontPlan) ? rawFontPlan : {};
  const fontPlanArray = Array.isArray(rawFontPlan) ? rawFontPlan.filter(isRecord) : [];
  const namedFonts = isRecord(fontPlan.namedFonts) ? fontPlan.namedFonts : {};
  const displayCandidates = readStringArray(fontPlan.displayFontCandidates, 6);
  const bodyCandidates = readStringArray(fontPlan.bodyFontCandidates, 6);
  const utilityCandidates = readStringArray(fontPlan.utilityFontCandidates, 6);
  const fontByRole = (roles: string[]): Record<string, unknown> | null => {
    for (const item of fontPlanArray) {
      const role = lowerText(readString(item.role));
      if (roles.some((candidate) => role.includes(candidate))) return item;
    }
    return null;
  };
  const displayRecord = fontByRole(["display", "headline", "title", "hero"]);
  const bodyRecord = fontByRole(["body", "text", "paragraph", "copy", "content"]);
  const utilityRecord = fontByRole(["utility", "ui", "label", "metric"]);
  const displayFont = readString(displayRecord?.font) || readString(displayRecord?.name);
  const bodyFont = readString(bodyRecord?.font) || readString(bodyRecord?.name);
  const utilityFont = readString(utilityRecord?.font) || readString(utilityRecord?.name);
  return {
    selectedDisplayFont:
      displayCandidates[0] ||
      readString(fontPlan.selectedDisplayFont) ||
      readString(fontPlan.displayFont) ||
      readString(namedFonts.display) ||
      displayFont ||
      utilityCandidates[0] ||
      utilityFont ||
      "",
    selectedBodyFont:
      bodyCandidates[0] ||
      readString(fontPlan.selectedBodyFont) ||
      readString(fontPlan.bodyFont) ||
      readString(namedFonts.body) ||
      bodyFont ||
      utilityFont ||
      "",
    externalFontAllowed: readBooleanOrNull(fontPlan.externalFontAllowed),
    fontSource: readString(fontPlan.fontSource) || readString(displayRecord?.url) || readString(bodyRecord?.url),
    usage: readString(fontPlan.usage) || [readString(displayRecord?.usage), readString(bodyRecord?.usage)].filter(Boolean).join(" "),
    cssHooks: readStringArray(fontPlan.cssHooks, 10),
    implementationRule:
      "Final source must implement named display/body typography with browser-usable loading or an explicit CSS stack, expose --font-display/--font-body hooks, and apply display type to hero headings, metrics, nav logo, and section numbers.",
  };
}

function normalizeRequirementToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function isCodegenImageAssetRequirement(requirement: WebCodegenAssetRequirement): boolean {
  const tokens = [
    requirement.implementation,
    requirement.renderMode,
    requirement.type,
    requirement.category,
  ].map(normalizeRequirementToken);
  return tokens.some((token) => [
    "generate",
    "public_search",
    "web_asset_search",
    "existing_canvas",
    "image_asset",
    "image",
    "photo",
    "raster",
    "generated_image",
    "generated_image_reuse",
  ].includes(token));
}

function collectUnresolvedImageAssets(
  requirements: WebCodegenAssetRequirement[],
  resolvedAssets: WebCodegenResolvedAsset[],
): Array<{ assetId: string; placeholder: string }> {
  return requirements
    .filter(isCodegenImageAssetRequirement)
    .filter((requirement) => !resolvedAssets.some((asset) => {
      const assetIdMatches = requirement.assetId && asset.assetId === requirement.assetId;
      const placeholderMatches = requirement.placeholder && asset.placeholder === requirement.placeholder;
      return (assetIdMatches || placeholderMatches) && !asset.previewDerived;
    }))
    .map((requirement) => ({ assetId: requirement.assetId, placeholder: requirement.placeholder }));
}

function findResolvedAssetForRequirement(
  requirement: WebCodegenAssetRequirement,
  resolvedAssets: WebCodegenResolvedAsset[],
): WebCodegenResolvedAsset | null {
  return resolvedAssets.find((asset) => {
    const assetIdMatches = requirement.assetId && asset.assetId === requirement.assetId;
    const placeholderMatches = requirement.placeholder && asset.placeholder === requirement.placeholder;
    return (assetIdMatches || placeholderMatches) && !asset.previewDerived;
  }) ?? null;
}

function collectPreviewDerivedResolvedAssetIds(
  requirements: WebCodegenAssetRequirement[],
  resolvedAssets: WebCodegenResolvedAsset[],
): string[] {
  const offending = new Set<string>();
  requirements
    .filter(isCodegenImageAssetRequirement)
    .forEach((requirement) => {
      const matches = resolvedAssets.filter((asset) => {
        const assetIdMatches = requirement.assetId && asset.assetId === requirement.assetId;
        const placeholderMatches = requirement.placeholder && asset.placeholder === requirement.placeholder;
        return asset.previewDerived && (assetIdMatches || placeholderMatches);
      });
      if (matches.length > 0) offending.add(requirement.assetId || requirement.placeholder || requirement.slotId);
    });
  return Array.from(offending);
}

function buildSectionCodegenContract(input: {
  targetNodeId: string;
  requirements: WebCodegenAssetRequirement[];
  resolvedAssets: WebCodegenResolvedAsset[];
  sectionBlueprints: SectionImplementationBlueprint[];
  previewVisualSpecs: Record<string, unknown>[];
}): WebCodegenContract["sectionCodegenContract"] {
  const groups = new Map<string, {
    sectionId: string;
    sectionKey: string;
    previewNodeId: string;
    order: number;
    visualSlots: WebCodegenAssetRequirement[];
  }>();
  input.requirements.forEach((requirement, index) => {
    const sectionId = requirement.section || `section-${index + 1}`;
    const previewNodeId = requirement.previewNodeId;
    const order = Number.parseInt(requirement.screenshotOrder, 10);
    const safeOrder = Number.isFinite(order) && order > 0 ? order : index + 1;
    const key = previewNodeId || `section:${sectionId}:${safeOrder}`;
    const existing = groups.get(key);
    if (existing) {
      existing.visualSlots.push(requirement);
      existing.order = Math.min(existing.order, safeOrder);
      return;
    }
    groups.set(key, {
      sectionId,
      sectionKey: key,
      previewNodeId,
      order: safeOrder,
      visualSlots: [requirement],
    });
  });

  const sections = Array.from(groups.values())
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_ARRAY_ITEMS)
    .map((group, index): SectionCodegenInput => {
      const requiredEmbeddedAssetIds = group.visualSlots
        .filter(isCodegenImageAssetRequirement)
        .map((slot) => slot.assetId || slot.placeholder || slot.slotId)
        .filter((assetId) => assetId.length > 0);
      const resolvedAssets = group.visualSlots
        .map((slot) => findResolvedAssetForRequirement(slot, input.resolvedAssets))
        .filter((asset): asset is WebCodegenResolvedAsset => Boolean(asset))
        .map((asset) => ({
          assetId: asset.assetId,
          placeholder: asset.placeholder,
          url: asset.url,
          source: asset.source,
        }));
      const sectionBlueprint = input.sectionBlueprints.find((blueprint) =>
        blueprint.sectionId === group.sectionId ||
        (group.previewNodeId && blueprint.sectionId === group.previewNodeId),
      ) ?? null;
      const contextNodeIds = group.previewNodeId ? [group.previewNodeId] : [];
      const allowedNodeIds = Array.from(new Set([input.targetNodeId, ...contextNodeIds].filter(Boolean)));
      return {
        sectionId: group.sectionId,
        sectionKey: group.sectionKey,
        previewNodeId: group.previewNodeId,
        order: group.order || index + 1,
        previewVisualSpec: findPreviewVisualSpec({
          specs: input.previewVisualSpecs,
          sectionId: group.sectionId,
          previewNodeId: group.previewNodeId,
          order: group.order || index + 1,
        }),
        visualSlots: group.visualSlots,
        resolvedAssets,
        requiredEmbeddedAssetIds,
        sectionBlueprint,
        taskContract: {
          kind: "webhero_section_codegen",
          targetNodeIds: input.targetNodeId ? [input.targetNodeId] : [],
          contextNodeIds,
          allowedNodeIds,
        },
      };
    });

  return {
    sections,
    implementationRule:
      "Dispatch one section_codegen sub-agent for each section in this array. Pass sectionId, previewNodeId, order, previewVisualSpec, visualSlots, resolvedAssets, requiredEmbeddedAssetIds, and taskContract verbatim. section_codegen must treat previewVisualSpec as the visual acceptance target and embed each resolvedAssets[].url verbatim for required image assets. Internal canvas assets use the canonical {{asset:<sourceNodeId>}} token, which must remain unchanged until server commit; never guess or copy an internal media URL. Preview screenshot URLs remain reference-only. For every image/media element, classify the approved preview morphology first: carded_panel only if the preview visibly shows that exact subject inside a rounded/square card, bordered frame, shadowed tile, or glass panel; otherwise implement it as transparent_cutout, background_matched_media, masked_media, full_bleed_media, or inline_icon. Never add a generic ImageCard/ProductCard wrapper, border, box shadow, or rounded rectangle around standalone media by habit.",
  };
}

function hasKeywordInTexts(texts: string[], keywords: string[]): boolean {
  const corpus = texts.join(" ").toLowerCase();
  return keywords.some((keyword) => corpus.includes(keyword));
}

function buildMergeCodegenContract(input: {
  targetNodeId: string;
  sectionCodegenContract: WebCodegenContract["sectionCodegenContract"];
  typography: WebCodegenContract["typographyContract"];
  previewDetailChecklist: unknown[];
  visualStructure: WebCodegenContract["visualStructureContract"];
}): WebCodegenContract["mergeCodegenContract"] {
  const approvedPreviewNodes: string[] = [];
  const resolvedAssetLedger = new Map<string, {
    assetId: string;
    sectionId: string;
    previewNodeId: string;
    url: string;
    source: string;
  }>();
  const styleCues = collectPreviewCueStrings(input.previewDetailChecklist);

  const sectionAssembly = input.sectionCodegenContract.sections
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((section): MergeSectionAssemblyInput => {
      if (section.previewNodeId && !approvedPreviewNodes.includes(section.previewNodeId)) {
        approvedPreviewNodes.push(section.previewNodeId);
      }
      const matchingArtifacts = input.visualStructure.sectionArtifacts.filter((artifact) =>
        artifact.sectionId === section.sectionId ||
        artifact.sectionId === section.previewNodeId,
      );
      const requiredDomArtifacts = matchingArtifacts.flatMap((artifact) => artifact.requiredDomArtifacts).slice(0, MAX_ARRAY_ITEMS);
      const requiredCssArtifacts = matchingArtifacts.flatMap((artifact) => artifact.requiredCssArtifacts).slice(0, MAX_ARRAY_ITEMS);
      const forbiddenImplementation = matchingArtifacts.flatMap((artifact) => artifact.forbiddenImplementation).slice(0, MAX_ARRAY_ITEMS);
      const requiredAssetUrls = section.resolvedAssets.map((asset) => asset.url);
      section.resolvedAssets.forEach((asset) => {
        const ledgerKey = `${section.sectionId}:${asset.assetId || asset.url}`;
        if (resolvedAssetLedger.has(ledgerKey)) return;
        resolvedAssetLedger.set(ledgerKey, {
          assetId: asset.assetId,
          sectionId: section.sectionId,
          previewNodeId: section.previewNodeId,
          url: asset.url,
          source: asset.source,
        });
      });
      const sectionCueTexts = [
        section.sectionId,
        section.previewNodeId,
        ...styleCues,
        ...requiredDomArtifacts,
        ...requiredCssArtifacts,
        ...(section.sectionBlueprint?.requiredComponents || []),
        section.sectionBlueprint?.layoutRule || "",
        section.sectionBlueprint?.motionRule || "",
      ];
      const consistencyFlags: string[] = [];
      if (hasKeywordInTexts(sectionCueTexts, ["nav", "navigation", "header", "masthead"])) {
        consistencyFlags.push("shared_nav_candidate");
      }
      if (hasKeywordInTexts(sectionCueTexts, ["tab", "tabs", "segmented", "filter", "switcher"])) {
        consistencyFlags.push("shared_tab_candidate");
      }
      if (hasKeywordInTexts(sectionCueTexts, ["footer", "trust strip", "runway"])) {
        consistencyFlags.push("footer_candidate");
      }
      if (!consistencyFlags.length) consistencyFlags.push("section_local_chrome");
      return {
        sectionId: section.sectionId,
        previewNodeId: section.previewNodeId,
        order: section.order,
        requiredEmbeddedAssetIds: section.requiredEmbeddedAssetIds,
        requiredAssetUrls,
        requiredDomArtifacts,
        requiredCssArtifacts,
        forbiddenImplementation,
        requiredComponents: section.sectionBlueprint?.requiredComponents || [],
        consistencyFlags,
        sectionBlueprintSummary: section.sectionBlueprint
          ? {
            implementationMode: section.sectionBlueprint.implementationMode,
            layoutRule: section.sectionBlueprint.layoutRule,
            motionRule: section.sectionBlueprint.motionRule,
            mediaRule: section.sectionBlueprint.mediaRule,
          }
          : null,
      };
    });

  const allFlags = sectionAssembly.flatMap((section) => section.consistencyFlags);
  const buttonMaterial = hasKeywordInTexts(styleCues, ["glass", "blur", "translucent"]) ? "glass" : "section_derived";
  return {
    approvedPreviewNodes,
    requiresPersistedSectionDrafts: true,
    persistedDraftField: "webPageSectionDrafts",
    globalShellContract: {
      sectionOrder: sectionAssembly.map((section) => ({
        sectionId: section.sectionId,
        previewNodeId: section.previewNodeId,
        order: section.order,
      })),
      typography: {
        selectedDisplayFont: input.typography.selectedDisplayFont,
        selectedBodyFont: input.typography.selectedBodyFont,
        externalFontAllowed: input.typography.externalFontAllowed,
        fontSource: input.typography.fontSource,
        cssHooks: input.typography.cssHooks,
      },
      sharedChrome: {
        globalNavMode: allFlags.includes("shared_nav_candidate") ? "required" : "section_local_only",
        sharedTabMode: allFlags.includes("shared_tab_candidate") ? "required" : "section_local_only",
        footerMode: allFlags.includes("footer_candidate") ? "required" : "optional",
        buttonMaterial,
        motionOwner: "single_global_motion_owner",
      },
      styleCues,
      mobileRules: [
        "Keep html/body max-width:100% and overflow-x:hidden.",
        "Ensure nav/tab/footer rows wrap instead of overflowing at mobile widths.",
        "Let dense grids collapse to one column before reducing text size.",
      ],
    },
    sectionAssembly,
    resolvedAssetLedger: Array.from(resolvedAssetLedger.values()).slice(0, MAX_ARRAY_ITEMS * 4),
    consistencyChecklist: [
      "Preserve approved preview order and emit one final section per preview node.",
      "Treat section drafts as source artifacts; merge may normalize chrome and tokens, but must not redesign section structure from scratch.",
      "Use only persisted webPageSectionDrafts that cover every approved preview; merge without persisted drafts is invalid.",
      "Do not add new card wrappers, bordered boxes, glass panels, rounded rectangles, or drop shadows around section draft media during merge. Preserve card/panel containers only when the section draft and approved preview both explicitly show that morphology.",
      "Keep one shared nav/tab/header/footer language when required by the global shell contract.",
      "Every required image asset URL from sectionAssembly must appear in final HTML/CSS.",
      "Deduplicate repeated classes, keyframes, and scroll observers before stage/commit.",
    ],
    stageCommitRules: [
      "Assemble final webHeroHtml/webHeroCss completely before the first staging call.",
      "Stage only webHeroHtml and webHeroCss; webHeroDocumentHtml is derived canonically by the server during commit.",
      "Copy the latest successful readiness flowUpdatedAt and previewNodeIds exactly into every staging chunk; the server binds the whole session to that snapshot.",
      "Freeze chunk totals per field for one stable sessionId; do not change totals mid-session.",
      "Do not mutate the flow between the readiness check, staging, and commit. A snapshot mismatch invalidates that transaction and must not be bypassed.",
      "If a staging response is lost, retry the exact chunk with the same sessionId; never create a replacement session.",
      "After both fields are complete, commit once. If the commit response is lost, retry the same sessionId so the server can return verified idempotent success.",
    ],
    implementationRule:
      `Use mergeCodegenContract as the compact assembly spec for target ${input.targetNodeId}. It is intentionally smaller than the full web_generation_codegen_prepare payload: do not re-read full candidate ledgers or regenerate section intent unless a section draft is blocked.`,
  };
}

function buildSectionDraftPersistenceContract(): WebCodegenContract["sectionDraftPersistenceContract"] {
  return {
    targetField: "webPageSectionDrafts",
    requiredFields: [
      "sectionId",
      "previewNodeId",
      "order",
      "html",
      "css",
      "usedAssetIds",
      "usedAssetUrls",
      "motionHooks",
      "consistencyNotes",
      "blocked",
    ],
    verificationRule:
      "After each successful full section_codegen result, persist its structured output verbatim to targetNode.data.webPageSectionDrafts with canvas_update_node_data. The runtime verifies the matching successful trace and injects codegenProvenance; parent-authored, edited, timed-out, failed, blocked, null-output, or alias-only drafts are rejected. Re-read the target node through canvas_flow_get and verify one proven non-blocked draft exists for every approved preview before dispatching webhero_merge_codegen.",
    implementationRule:
      "section drafts are not ephemeral merge input. They are persisted screenshot-to-code artifacts and the only acceptable source for merge-time section assembly and Studio inspection.",
  };
}

function buildMediaPlacementContract(
  requirements: WebCodegenAssetRequirement[],
): WebCodegenContract["mediaPlacementContract"] {
  const imageAssetIds = requirements
    .filter(isCodegenImageAssetRequirement)
    .map((requirement) => requirement.assetId || requirement.placeholder)
    .filter((assetId) => assetId.length > 0);
  return {
    imageAssetIds,
    defaultRule:
      "Treat image-level media as composition anchors: use full-bleed backgrounds, edge-to-edge media planes, masked product stages, absolute layers, or gradient blends between image and copy by default.",
    forbiddenPattern:
      "Do not wrap hero/product/interior/configurator/CTA images in rounded bordered image cards, 3D tilt cards, or breathing scale cards unless the persisted previewDetailChecklist explicitly requires that exact carded treatment.",
    surfaceRule:
      "Before styling any media asset, inspect previewVisualSpec, previewDetailChecklist, and intendedWebUsage. If the asset is transparent, cutout, background-matched, masked, full-bleed, or inline, place the media directly without an extra rectangular card or shadow layer.",
    configuratorRule:
      "For product configurator/showcase sections, preserve the preview spatial grammar: title near the upper center, color rail on the far left, large product image centered, and parameters/spec stack on the right. Do not convert it into a generic left-copy/right-card split.",
  };
}

function buildFinalPromptAddendum(input: {
  typography: WebCodegenContract["typographyContract"];
  fontRecommendation: WebCodegenContract["fontRecommendationContract"];
  iconContract: WebCodegenContract["iconContract"];
  visualStructure: WebCodegenContract["visualStructureContract"];
  hasPreviewChecklist: boolean;
  componentRecordIds: string[];
  resolvedAssets: WebCodegenResolvedAsset[];
  publicAssetCandidates: PublicAssetCandidateContract[];
  normalizedAssetSearches: unknown[];
  unresolvedCandidateAudits: Array<{ assetId: string; issue: string }>;
  assetGeneration: WebCodegenContract["assetGenerationContract"];
  mediaPlacement: WebCodegenContract["mediaPlacementContract"];
  sectionBlueprints: SectionImplementationBlueprint[];
  designDiversity: WebCodegenContract["designDiversityContract"];
  motionImplementationChecklist: string[];
}): string {
  const assetLines = input.resolvedAssets
    .slice(0, 12)
    .map((asset) => `- ${asset.assetId || asset.placeholder}: ${asset.url}`)
    .join("\n");
  const blueprintLines = input.sectionBlueprints
    .slice(0, 8)
    .map((blueprint) => {
      const selected = blueprint.selectedReferences.map((reference) => reference.title).join(", ") || "none";
      const rejected = blueprint.rejectedReferences.map((reference) => reference.title).join(", ") || "none";
      return `- ${blueprint.sectionId}: mode=${blueprint.implementationMode}; selected=${selected}; rejected=${rejected}; media=${blueprint.mediaRule}`;
    })
    .join("\n");
  const publicAssetLines = input.publicAssetCandidates
    .slice(0, 8)
    .map((candidate) => {
      const urls = candidate.candidateUrls.slice(0, 3).join(", ") || "none";
      return `- ${candidate.assetId || "unassigned"}: query="${candidate.query}"; candidates=${urls}; rule=${candidate.decisionRule}`;
    })
    .join("\n");
  const normalizedAssetLines = input.normalizedAssetSearches
    .slice(0, 8)
    .map((item) => {
      if (!isRecord(item)) return "";
      const width = typeof item.width === "number" && Number.isFinite(item.width) ? String(item.width) : "";
      const height = typeof item.height === "number" && Number.isFinite(item.height) ? String(item.height) : "";
      const alpha = typeof item.hasAlpha === "boolean" ? String(item.hasAlpha) : "unknown";
      const size = width && height ? `${width}x${height}` : "unknown-size";
      return `- ${readString(item.title) || readString(item.downloadUrl)}: ${readString(item.format)} ${readString(item.shape)} ${size} alpha=${alpha} url=${readString(item.downloadUrl)}`;
    })
    .filter(Boolean)
    .join("\n");
  const iconLines = input.iconContract.icons
    .slice(0, 10)
    .map((item) => {
      if (!isRecord(item)) return "";
      return `- ${readString(item.iconId)} ${readString(item.viewBox)} for query "${readString(item.query)}"`;
    })
    .filter(Boolean)
    .join("\n");
  const structureLines = input.visualStructure.sectionArtifacts
    .slice(0, 8)
    .map((section) => {
      const dom = section.requiredDomArtifacts.join("; ") || "none";
      const css = section.requiredCssArtifacts.join("; ") || "none";
      const forbidden = section.forbiddenImplementation.join("; ") || "none";
      return `- ${section.sectionId || "unassigned"}: layout=${section.layoutSkeleton || "unspecified"}; geometry=${section.componentGeometry || "unspecified"}; media=${section.mediaRole || "unspecified"}; DOM=${dom}; CSS=${css}; forbidden=${forbidden}`;
    })
    .join("\n");
  const fontRecordLine = input.fontRecommendation.recordIds.length
    ? `Font recommendations records: ${input.fontRecommendation.recordIds.join(", ")}. Use selected/googleCssUrl before default fonts.`
    : "Font recommendations records: none.";
  const unresolvedAuditLines = input.unresolvedCandidateAudits
    .slice(0, 8)
    .map((issue) => `- ${issue.assetId}: ${issue.issue}`)
    .join("\n");
  return [
    "Use this codegen contract as the final implementation input.",
    `Typography: load/apply display font "${input.typography.selectedDisplayFont || "CHOOSE_NAMED_DISPLAY_FONT"}" and body font "${input.typography.selectedBodyFont || "CHOOSE_NAMED_BODY_FONT"}"; expose --font-display and --font-body.`,
    "Preview details: implement the persisted previewDetailChecklist exactly where possible, including per-letter accent spans, glass blur material, rail geometry, media crops, metric layout, and CTA placement.",
    structureLines ? `Required preview structure artifacts:\n${structureLines}` : "Required preview structure artifacts: none found. Repair previewAlignmentAudit.sectionComparisons[].requiredDomArtifacts before final code.",
    fontRecordLine,
    iconLines ? `Icon search candidates to inline:\n${iconLines}` : "Icon search candidates: none found. If the preview has icon-bearing controls, run icon_search before final code.",
    `Component references: read/carry over retrieval records ${input.componentRecordIds.join(", ") || "(none)"}. Use their styleCarryover, motionCarryover, assetSlots, and implementationNotes, but reject card/tilt/scale patterns when they contradict the approved preview composition.`,
    "React source tree: use src/App plus src/sections/* and src/components/*. Put glass UI, full-bleed/masked MediaStage, TelemetryRail, SpecStack, GlassControls, motion hooks, and section components into named modules. Do not create generic card wrapper components as the primary layout driver.",
    `Design diversity: ${input.designDiversity.antiSamenessRules.join(" ")}`,
    `Component detail restoration: ${input.designDiversity.componentDetailRules.join(" ")}`,
    `Generated/reused asset quality: ${input.assetGeneration.promptRules.join(" ")} ${input.assetGeneration.componentAssetRules.join(" ")}`,
    `Media placement: ${input.mediaPlacement.defaultRule} ${input.mediaPlacement.forbiddenPattern} ${input.mediaPlacement.surfaceRule}`,
    `Configurator/product showcase: ${input.mediaPlacement.configuratorRule}`,
    blueprintLines ? `Section implementation blueprint:\n${blueprintLines}` : "Section implementation blueprint: no section blueprint found; write from section specs and do not invent card grids.",
    publicAssetLines ? `Public asset candidates:\n${publicAssetLines}` : "Public asset candidates: none found. Do not claim public search succeeded unless sourceAudit/retrieval records prove it.",
    normalizedAssetLines ? `Normalized web asset candidates:\n${normalizedAssetLines}` : "Normalized web asset candidates: none found. Run web_asset_search for SVG/vector/transparent/dimension-aware needs before generating custom media.",
    unresolvedAuditLines ? `Asset candidate audit gaps to repair before final code:\n${unresolvedAuditLines}` : "Asset candidate audit: no unresolved public candidate audit gaps.",
    `Motion checklist:\n${input.motionImplementationChecklist.map((item) => `- ${item}`).join("\n")}`,
    assetLines ? `Resolved media references to use verbatim in source:\n${assetLines}` : "Resolved media references: none found in this contract; do not fabricate URLs or asset tokens.",
  ].join("\n").slice(0, MAX_FINAL_PROMPT_ADDENDUM_CHARS).trim();
}

function buildDesignDiversityContract(): WebCodegenContract["designDiversityContract"] {
  return {
    antiSamenessRules: [
      "Do not reuse the same rounded glass nav + rounded tab strip + glass card stack across unrelated website briefs.",
      "Derive section chrome from preview-specific geometry: full-bleed media, docks, stickers, color rails, spec stacks, masked panels, editorial type, or asymmetric overlays.",
      "Use rounded glass only where the approved preview actually shows glass; otherwise prefer image blends, flat editorial bands, line art, or custom controls.",
      "Do not invent a repeated Type/tab bar above every section. If the preview uses a one-off top rail, translate it once; other sections need distinct local chrome.",
      "If the preview shows a wide transparent band or footer runway, implement it as one continuous translucent strip with internal alignment, not as several card tiles.",
    ],
    previewSpecificDetailRules: [
      "If the preview shows icons inside buttons, implement real icons and labels, not text-only pills.",
      "If the preview shows sticker/card media with internal images, split those as image assets or implement nested image slots; do not collapse them into empty gradient backgrounds.",
      "If the preview shows multi-color gradients per control, preserve per-control gradient tokens instead of applying one shared accent color.",
      "Preserve the visible radius scale: tiny pills and chips may use 999px, small technical panels should stay near 4-12px, and primary media planes should not become oversized rounded rectangles unless the preview does.",
      "Preserve preview component morphology before content: single strip stays a strip, rail stays a rail, color selector stays a side rail, spec stack stays a right-side stack.",
      "Classify card morphology from the preview, not from model habits: carded panels keep their visible frame; transparent cutouts, standalone product renders, background-matched images, masked planes, and full-bleed media must not be wrapped in invented cards.",
    ],
    componentDetailRules: [
      "Components like Dock, stickers, configurators, and CTA controls need named component owners with props/data for icon, title, media, gradient, active state, and hover motion.",
      "Component references are not just inspiration: selected styleCarryover, motionCarryover, assetSlots, and implementationNotes must appear in final source structure.",
      "For static screenshots, add reasonable motion from the component/motion records: dock hover, sticker entrance, media parallax, mask reveal, line drawing, icon shimmer, or staggered controls.",
      "Motion must change perceived structure, material, or information state: line drawing, mask reveal, pinned section transition, active dock indicator, spec count-up, scan line, or media blend. Do not satisfy motion by only floating images up/down or applying breathing scale loops.",
    ],
  };
}

function buildAssetGenerationContract(): WebCodegenContract["assetGenerationContract"] {
  return {
    promptRules: [
      "Generated image_asset prompts must describe the visible subject, internal visual details, material, lighting, crop, placement, and motion-safe edge bleed; a generic background plate is invalid for sticker/card/dock/media-slot requirements.",
      "When the preview shows a sticker, card, dock item, button group, or product control with embedded imagery, the asset requirement must name that nested image/content role instead of asking only for an empty backdrop.",
      "Generated asset prompts must carry intendedWebUsage.surfaceTreatment/cardPolicy. Use carded_panel only when the approved preview shows that subject inside a visible card/panel/frame; otherwise explicitly say no rounded/square card, no border, no shadow, no glass tile, and request transparent_cutout/background_matched_media/masked_media/full_bleed_media as appropriate.",
      "If public search returns a suitable generic texture/photo/background, reuse it directly or document rejection before generating; generation is for precise custom foregrounds, branded/product-like scenes, and preview-specific composites.",
    ],
    componentAssetRules: [
      "Sticker/card/Dock/button components need structured data fields for icon, label, gradient, mediaUrl, active state, and hover/motion behavior.",
      "Do not bake simple icons, labels, and buttons into a screenshot image; implement them as code so gradients, hover, focus, and motion remain editable.",
      "Use Lucide or existing icon libraries for controls when possible; if an icon is visually custom and image-level, create a separate small asset requirement rather than omitting it.",
    ],
    sourceAuditRules: [
      "Generated assets must include sourceAudit.generationReason.",
      "If publicSearchChecked=true, sourceAudit must preserve publicSearchRecordId and candidateUrls.",
      "If generated media replaces public candidates, sourceAudit.rejectionReasons must explain why candidates were unsuitable.",
    ],
  };
}

function buildCodegenContract(input: {
  args: Record<string, unknown>;
  data: Record<string, unknown>;
  brief: Record<string, unknown>;
  records: RetrievalRecord[];
  missingRecordIds: string[];
}): WebCodegenContract {
  const targetNodeId = readString(input.args.targetNodeId);
  const referencePrompt = readString(input.data.webPageReferencePrompt);
  const preCodeAssetEvidence = diagnoseWebHeroPreCodeAssetEvidence(input.data);
  const requirements = collectAssetRequirements(input.data.webPageAssetRequirements);
  const previewUrls = collectPreviewScreenshotUrls(input.args.targetNodeData);
  const resolvedAssets = markPreviewDerivedResolvedAssets(
    collectResolvedAssets(input.data.webPageResolvedAssets),
    previewUrls,
  );
  const publicAssetCandidates = collectPublicAssetSearches(input.records);
  const normalizedAssetSearches = collectNormalizedAssetSearches(input.records);
  const unresolvedCandidateAudits = collectUnresolvedCandidateAudits({ publicAssetCandidates, resolvedAssets });
  const unresolvedImageAssets = collectUnresolvedImageAssets(requirements, resolvedAssets);
  const previewDerivedResolvedAssetIds = collectPreviewDerivedResolvedAssetIds(requirements, resolvedAssets);
  const typography = readTypographyContract(input.brief);
  const fontRecommendationContract = collectFontRecommendationContract(input.records);
  const iconContract = collectIconContract(input.records);
  const previewDetailChecklist = collectPreviewChecklist(input.brief);
  const previewVisualSpecs = collectPreviewVisualSpecs(input.data, input.brief);
  const componentReferences = buildComponentReferences(input.records);
  const componentRecordIds = componentReferences.map((item) => item.recordId);
  const retrievedSectionBlueprints = buildSectionBlueprints(input.records);
  const sectionBlueprints = retrievedSectionBlueprints.length
    ? retrievedSectionBlueprints
    : buildFallbackSectionBlueprints(input.brief);
  const motionPlan = collectMotionPlan(input.brief);
  const assetMotionPlan = readRecordArray(input.brief.assetMotionPlan, MAX_ARRAY_ITEMS);
  const hasIconRequirement = requiresIconSearch(input.brief);
  const visualStructure = collectVisualStructureContract(input.brief);
  const mediaPlacement = buildMediaPlacementContract(requirements);
  const sectionCodegenContract = buildSectionCodegenContract({
    targetNodeId,
    requirements,
    resolvedAssets,
    sectionBlueprints,
    previewVisualSpecs,
  });
  const sectionDraftPersistenceContract = buildSectionDraftPersistenceContract();
  const mergeCodegenContract = buildMergeCodegenContract({
    targetNodeId,
    sectionCodegenContract,
    typography,
    previewDetailChecklist,
    visualStructure,
  });
  const designDiversity = buildDesignDiversityContract();
  const assetGeneration = buildAssetGenerationContract();
  const motionImplementationChecklist = [
    "Implement a named timeline owner with GSAP, Framer Motion, or browser-safe React hooks; motion must exist in source, not only in prose.",
    "Hero: split headline into words/letters where needed, including preview-specific red accent spans; animate word/media entrance as a sequence.",
    "Assets: use resolved image references in parallax, mask, reveal, or gradient-blend layers; every image_asset external URL or canonical {{asset:<sourceNodeId>}} token must appear in staged source.",
    "Component details: animate dock/sticker/button/icon groups with stagger, hover lift, gradient shimmer, active indicator, or mask reveal when the preview shows those structures.",
    "Telemetry/specs: stagger labels/numbers/rails and animate line drawing or progress, not repeated rounded cards.",
    "Media placement: no breathing scale/3D tilt on primary vehicle/interior/CTA images unless a selected reference and preview both require it.",
    "Glass controls: implement backdrop-filter, translucent fill, inner highlight, hover/focus response.",
    "Reduced motion: provide a browser-safe reduced-motion branch that disables scroll scrub and long transforms.",
  ];
  const missingCriticalInputs: string[] = [];
  const rawImplementationBrief = input.data.webPageImplementationBrief;
  const hasPersistedImplementationBrief = diagnoseWebHeroImplementationBrief(rawImplementationBrief).ok;
  if (!referencePrompt) missingCriticalInputs.push("webPageReferencePrompt");
  if (!hasPersistedImplementationBrief) missingCriticalInputs.push("webPageImplementationBrief");
  if (!typography.selectedDisplayFont || !typography.selectedBodyFont) missingCriticalInputs.push("fontPlan.namedFonts");
  if (!previewDetailChecklist.length) missingCriticalInputs.push("previewDetailChecklist");
  const persistedPreviewVisualSpecs = hasPersistedPreviewVisualSpecs(input.data, input.brief);
  if (!persistedPreviewVisualSpecs || !hasPreviewVisualSpecsForSections(sectionCodegenContract.sections)) {
    missingCriticalInputs.push("webPagePreviewVisualSpecs");
  }
  const visualSpeclessImageRequirements = imageRequirementsMissingPreviewEvidence(requirements);
  if (visualSpeclessImageRequirements.length) {
    missingCriticalInputs.push(`visualSlots.imageAssetSourceEvidence:${visualSpeclessImageRequirements.join(",")}`);
  }
  if (!hasRequiredStructureArtifacts(visualStructure)) missingCriticalInputs.push("previewStructureArtifacts");
  if (hasIconRequirement && !iconContract.recordIds.length) missingCriticalInputs.push("iconSearchRecords");
  if (!componentRecordIds.length && !sectionBlueprints.length) missingCriticalInputs.push("componentRetrievalRecords");
  if (requirements.some(isCodegenImageAssetRequirement) && unresolvedImageAssets.length) {
    missingCriticalInputs.push("resolvedImageAssetUrls");
  }
  if (previewDerivedResolvedAssetIds.length) {
    missingCriticalInputs.push("resolvedImageAssetUrls.nonPreviewAssets");
  }
  if (!preCodeAssetEvidence.ok) {
    if (!isRecord(input.data.webPageAssetRequirements)) {
      missingCriticalInputs.push("webPageAssetRequirements");
    }
    missingCriticalInputs.push("webPageAssetRequirements.visualSlots");
    missingCriticalInputs.push(...preCodeAssetEvidence.missing);
  }
  if (!hasWebHeroAssetDecisionEvidence(input.data)) {
    missingCriticalInputs.push("webPageAssetDecisions");
  }
  if (!hasGeneratedAssetDecisionRecords(input.data)) {
    missingCriticalInputs.push("webPageAssetDecisions.generatedAssets");
  }
  if (unresolvedCandidateAudits.length) {
    missingCriticalInputs.push("publicAssetCandidateAudit");
  }
  const hasBlockingAssetEvidenceGap =
    !preCodeAssetEvidence.ok ||
    !persistedPreviewVisualSpecs ||
    !hasPreviewVisualSpecsForSections(sectionCodegenContract.sections) ||
    visualSpeclessImageRequirements.length > 0 ||
    (requirements.some(isCodegenImageAssetRequirement) && unresolvedImageAssets.length > 0) ||
    previewDerivedResolvedAssetIds.length > 0 ||
    !hasWebHeroAssetDecisionEvidence(input.data) ||
    !hasGeneratedAssetDecisionRecords(input.data);
  const finalPromptAddendum = buildFinalPromptAddendum({
    typography,
    fontRecommendation: fontRecommendationContract,
    iconContract,
    visualStructure,
    hasPreviewChecklist: previewDetailChecklist.length > 0,
    componentRecordIds,
    resolvedAssets,
    publicAssetCandidates,
    normalizedAssetSearches,
    unresolvedCandidateAudits,
    assetGeneration,
    mediaPlacement,
    sectionBlueprints,
    designDiversity,
    motionImplementationChecklist,
  });
  const codegenContractUsable =
    input.missingRecordIds.length === 0 && !hasBlockingAssetEvidenceGap;
  return {
    ok: true,
    createdAt: new Date().toISOString(),
    targetNodeId,
    readiness: {
      canWriteFinalCode: codegenContractUsable,
      missingCriticalInputs,
      missingRetrievalRecordIds: input.missingRecordIds,
      unresolvedImageAssets,
    },
    codegenRule:
      input.missingRecordIds.length > 0
        ? "BLOCKED: referenced retrieval records could not be loaded. Repair retrieval ids or rerun the relevant search/asset preparation before final code."
        : hasBlockingAssetEvidenceGap
          ? "BLOCKED: WebHero asset/reference evidence is incomplete. Complete preview visual specs, asset_inventory and asset_resolution first: persist webPagePreviewVisualSpecs, flat visualSlots with visualSpecId/sourceEvidence, required asset decisions including stylePlan, and resolve every required image asset before dispatching section_codegen or merge commit."
          : "Codegen contract generated and hard prerequisites are satisfied. Use sectionCodegenContract for one screenshot-to-code sub-agent per preview, persist webPageSectionDrafts, then merge only from persisted drafts.",
    referencePrompt: {
      present: Boolean(referencePrompt),
      charCount: referencePrompt.length,
      excerpt: clipText(referencePrompt, MAX_TEXT_EXCERPT),
    },
    typographyContract: typography,
    fontRecommendationContract,
    iconContract,
    previewDetailChecklist,
    componentReferenceContract: {
      recordIds: componentRecordIds,
      references: componentReferences,
      sectionBlueprints,
      implementationRule:
        "For each final section, follow sectionBlueprints first. Use selectedReferences for structure/motion only when they preserve preview layout. Treat rejectedReferences as explicit anti-inputs: do not let card/table/admin/tilt/scale components become the primary section layout.",
    },
    motionContract: {
      motionPlan,
      assetMotionPlan,
      componentMotionCarryover: collectComponentMotionCarryover(input.records),
      implementationRule:
        "Implement motion as code, not prose: named hooks/components, reduced-motion behavior, asset-aware parallax/mask/hover states, and section-specific technical animation where the brief requires it. Do not add breathing scale, card expansion, or 3D tilt to primary media unless the approved preview or selected reference explicitly requires that media behavior.",
    },
    assetContract: {
      requirements,
      resolvedAssets,
      publicAssetCandidates,
      normalizedAssetSearches,
      unresolvedCandidateAudits,
      implementationRule:
        "Every renderMode=image_asset resolved reference must appear in staged source as an img src, CSS background image, or asset constant. Keep canonical {{asset:<sourceNodeId>}} tokens verbatim; the server materializes them during commit. Public/Aura candidate URLs are first-class evidence: reuse them for suitable generic assets, or record sourceAudit.rejectionReasons before generating. Generated assets require sourceAudit.generationReason and candidateUrls when public search was checked. Product/device/hardware/camera/hinge/screen/lifestyle/scene/portrait visuals are embedded media, not reference-only CSS silhouettes. Reference-only assets are valid only for abstract layout/decorative/UI-structure evidence. Treat an asset as a transparent cutout only when metadata explicitly proves transparentPng=true and transparentBackground=yes or transparencyEvidence=png-alpha-probed; otherwise preserve its own background or blend it as an embedded section media image, and never expose checkerboard transparency placeholders in final HTML/CSS. Card/panel wrappers are not an asset default: only implement them when intendedWebUsage.cardPolicy/surfaceTreatment or previewDetailChecklist says the approved preview shows a visible card, frame, bordered panel, shadowed tile, or glass container for that exact asset.",
    },
    sectionCodegenContract,
    sectionDraftPersistenceContract,
    mergeCodegenContract,
    assetGenerationContract: assetGeneration,
    mediaPlacementContract: mediaPlacement,
    visualStructureContract: visualStructure,
    sourceTreeContract: {
      minimumFiles: [
        "src/App.jsx or src/App.tsx",
        "at least two src/sections/* modules",
        "at least two src/components/* modules",
        "src/styles.css or equivalent shared styles",
      ],
      implementationRule:
        "Use named components for GlassButton/GlassPanel, MediaStage, TelemetryRail, SpecStack, GlassControls, and section modules so preview details and motion have explicit owners. Avoid generic ImageCard/ProductCard wrappers for primary media unless previewDetailChecklist explicitly calls for them.",
    },
    designDiversityContract: designDiversity,
    motionImplementationChecklist,
    finalPromptAddendum,
  };
}

export function createWebGenerationCodegenPrepareTool(): ToolHandler {
  return {
    definition: {
      name: "web_generation_codegen_prepare",
      description:
        "[REQUIRED Step 5/5 diagnostic] Assemble the final compact codegen contract for webHero code generation. Call after canvas_webhero_check_readiness passes or after the workflow reaches final code. Reads the target node's WebHero fields from a node object or a canvas_flow_get wrapper, then fetches stored component/icon/font/asset records and returns a concise implementation contract. missingCriticalInputs are diagnostics/warnings for fidelity, not a hard final-code gate. Only missing retrieval records block this tool. The returned sectionCodegenContract is the authoritative input for dispatching one section_codegen sub-agent per preview section, including scoped task_contract and resolved asset references. Generated canvas sourceNodeId records become canonical {{asset:<sourceNodeId>}} tokens that codegen must embed verbatim; the server resolves them during commit. Must call BEFORE canvas_webhero_code_stage_raw_chunk.",
      parameters: {
        type: "object",
        properties: {
          targetNodeId: {
            type: "string",
            description: "Owning webHero/reactProject node id for audit only.",
          },
          targetNodeData: {
            description:
              "Current target node data object from canvas_flow_get. May include webPageReferencePrompt, webPageImplementationBrief, webPageAssetRequirements, and webPageResolvedAssets.",
            oneOf: [
              { type: "object", additionalProperties: true },
              { type: "string" },
            ],
          },
          webPageReferencePrompt: { type: "string" },
          webPageImplementationBrief: {
            oneOf: [
              { type: "object", additionalProperties: true },
              { type: "string" },
            ],
          },
          webPageAssetRequirements: {
            oneOf: [
              { type: "array", items: { type: "object", additionalProperties: true } },
              { type: "object", additionalProperties: true },
              { type: "string" },
            ],
          },
          webPageResolvedAssets: {
            oneOf: [
              { type: "array", items: { type: "object", additionalProperties: true } },
              { type: "object", additionalProperties: true },
              { type: "string" },
            ],
          },
          extraRetrievalRecordIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional extra retrieval ids to read in addition to ids found in the implementation brief.",
          },
        },
        additionalProperties: false,
      },
    },
    async execute(args, ctx, toolCallId) {
      const data = readInputData(args);
      const brief = readImplementationBrief(data);
      const recordIds = collectRecordIdsFromBrief(brief, args.extraRetrievalRecordIds);
      const { records, missingIds } = await readRetrievalRecords({ ctx, ids: recordIds });
      const contract = buildCodegenContract({
        args,
        data,
        brief,
        records,
        missingRecordIds: missingIds,
      });
      const codegenRecord: StoredRetrievalRecord = await persistToolRetrievalRecord(ctx, {
        kind: "web_generation_codegen_prepare",
        query: readString(args.targetNodeId) || "web-generation-codegen-contract",
        source: "web_generation_codegen_prepare",
        resultCount: records.length,
        payload: contract,
      });
      return {
        toolCallId,
        content: JSON.stringify({
          ...contract,
          codegenRecord,
        }),
      };
    },
  };
}
