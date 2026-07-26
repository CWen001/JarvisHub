import { AppError } from "../../middleware/error";
import { createHash } from "node:crypto";
import { mergePublicFlowNodeData } from "../flow/flow.public.service";
import {
  assertWebHeroFinalCodeMutationSource,
  dataWritesWebHeroFinalCode,
  narrowWebHeroPolicyGraph,
  type WebHeroFinalCodeMutationSource,
} from "../flow/flow.webhero-code-policy";
import { readSelectedWebHeroStyleReference } from "../flow/flow.webhero-style-reference";
import { hasUsableWebHeroResolvedAssetReference } from "./agents-tool-bridge.webhero-asset-references";
import {
  diagnoseWebHeroAssetDecisions,
  diagnoseWebHeroAssetRequirements,
  diagnoseWebHeroImplementationBrief,
  diagnoseWebHeroSectionDraft,
} from "./agents-tool-bridge.webhero-evidence-contract";

type FlowGraphRecord = {
  nodes?: unknown[];
  edges?: unknown[];
};

type FlowPatchLike = {
  allowOverwrite?: boolean;
  deleteNodeIds?: string[];
  createNodes?: Array<{
    id?: string;
    type?: string;
    data?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  patchNodeData?: Array<{
    id: string;
    data?: Record<string, unknown>;
    mergeStrategy?: "skip-equal" | "overwrite" | "fail";
    webHeroRewindFromPhase?:
      | "preview_generation"
      | "preview_visual_spec"
      | "asset_inventory"
      | "asset_resolution"
      | "section_codegen";
  }>;
};

type WebHeroFinalCodeValidationOptions = {
  requireComplete?: boolean;
};

type WebHeroEvidenceReport = {
  hasRequiredPreviews: boolean;
	previewReadinessMissing: string[];
  isLegacyNoPreviewWorkflow: boolean;
  hasStyleReference: boolean;
  hasSectionDrafts: boolean;
  goalContractMissing: string[];
  assetInventoryMissing: string[];
  assetResolutionMissing: string[];
  sectionDraftMissing: string[];
  finalCodeMissing: string[];
};

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJsonValue(item)]),
  );
}

export function computeWebHeroCodeInputDigest(graph: FlowGraphRecord, nodeId: string): string {
  const targetData = flowNodeData(findFlowNodeById(graph, nodeId));
  const workflow = parseMaybeJsonRecord(targetData.webPageWorkflowContract);
  const previewNodeIds = readApprovedWebHeroPreviewNodeIds(graph, nodeId).slice().sort();
  const previewEvidence = previewNodeIds.map((previewNodeId) => {
    const data = flowNodeData(findFlowNodeById(graph, previewNodeId));
    return {
      id: previewNodeId,
      status: data.status,
      imageUrl: data.imageUrl,
      imageResults: data.imageResults,
      webPreviewStyleReferenceUrls: data.webPreviewStyleReferenceUrls,
      webScreenshotOrder: data.webScreenshotOrder,
      webScreenshotSectionId: data.webScreenshotSectionId,
    };
  });
  const payload = canonicalJsonValue({
    version: 1,
    nodeId,
    selectedStyleReferenceUrls: readSelectedWebHeroStyleReference(targetData)?.referenceUrls.slice().sort() || [],
    approvedPreviewNodes: previewNodeIds,
    previewEvidence,
    webPagePreviewVisualSpecs: targetData.webPagePreviewVisualSpecs,
    visibleSubjectInventory: targetData.visibleSubjectInventory,
    webPageVisibleSubjectInventory: targetData.webPageVisibleSubjectInventory,
    webPageAssetRequirements: targetData.webPageAssetRequirements,
    webPageResolvedAssets: targetData.webPageResolvedAssets,
    webPageAssetDecisions: targetData.webPageAssetDecisions,
    componentReferencePlan: targetData.componentReferencePlan,
    webPageImplementationBrief: targetData.webPageImplementationBrief,
	webPageReferencePrompt: targetData.webPageReferencePrompt,
    fontPlan: targetData.fontPlan,
    previewDetailChecklist: targetData.previewDetailChecklist,
    webPageSectionDrafts: targetData.webPageSectionDrafts,
    workflowSharedStyleBible: workflow.sharedStyleBible,
  });
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

const WEBHERO_GOAL_STEPS = [
  "style_reference_selection",
  "preview_generation",
  "preview_visual_spec",
  "asset_inventory",
  "asset_resolution",
  "section_codegen",
  "merge_codegen",
  "completed",
] as const;

type WebHeroGoalStep = typeof WEBHERO_GOAL_STEPS[number];

const WEBHERO_GOAL_STEP_ALIASES: Record<string, WebHeroGoalStep> = {
  style_selection: "style_reference_selection",
  style_reference: "style_reference_selection",
  previews: "preview_generation",
  preview: "preview_generation",
  visual_spec: "preview_visual_spec",
  preview_specs: "preview_visual_spec",
  preview_visual_specs: "preview_visual_spec",
  asset_inventory_planning: "asset_inventory",
  asset_resolution_generation: "asset_resolution",
  final_code: "merge_codegen",
  final_codegen: "merge_codegen",
  codegen: "section_codegen",
  section_codegen: "section_codegen",
  merge: "merge_codegen",
  done: "completed",
};

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readScalarString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function parseMaybeJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseMaybeJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function parseMaybeJsonArray(value: unknown): unknown[] {
  const parsed = parseMaybeJsonValue(value);
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeWebHeroGoalStep(value: unknown): WebHeroGoalStep | "" {
  const token = normalizeToken(value);
  if (!token) return "";
  if ((WEBHERO_GOAL_STEPS as readonly string[]).includes(token)) return token as WebHeroGoalStep;
  return WEBHERO_GOAL_STEP_ALIASES[token] || "";
}

function webHeroGoalStepIndex(step: WebHeroGoalStep | ""): number {
  if (!step) return -1;
  return WEBHERO_GOAL_STEPS.indexOf(step);
}

function readWebHeroGoalContract(data: Record<string, unknown>): Record<string, unknown> {
  return parseMaybeJsonRecord(data.webHeroGoalContract);
}

function hasWebHeroGoalContract(data: Record<string, unknown>): boolean {
  const contract = readWebHeroGoalContract(data);
  return readTrimmedString(contract.kind) === "webHeroGoalContract" || Object.keys(contract).length > 0;
}

function webHeroGoalCurrentStep(data: Record<string, unknown>): WebHeroGoalStep | "" {
  const goal = readWebHeroGoalContract(data);
  const direct = normalizeWebHeroGoalStep(goal.currentStep);
  if (direct) return direct;
  const workflow = parseMaybeJsonRecord(data.webPageWorkflowContract);
  return normalizeWebHeroGoalStep(workflow.currentStep);
}

function webHeroGoalContractHardRules(data: Record<string, unknown>): Record<string, unknown> {
  const contract = readWebHeroGoalContract(data);
  return parseMaybeJsonRecord(contract.hardRules);
}

function webHeroGoalContractIssues(data: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const contract = readWebHeroGoalContract(data);
  if (!hasWebHeroGoalContract(data)) {
    issues.push("webHeroGoalContract persistent state machine");
    return issues;
  }
  if (readTrimmedString(contract.kind) && readTrimmedString(contract.kind) !== "webHeroGoalContract") {
    issues.push("webHeroGoalContract.kind must be webHeroGoalContract");
  }
  if (!normalizeWebHeroGoalStep(contract.currentStep)) {
    issues.push("webHeroGoalContract.currentStep must be a known WebHero goal step");
  }
  const stepIds = new Set(
    parseMaybeJsonArray(contract.steps)
      .filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
      .map((item) => normalizeWebHeroGoalStep(item.id))
      .filter(Boolean),
  );
  for (const step of WEBHERO_GOAL_STEPS) {
    if (!stepIds.has(step)) issues.push(`webHeroGoalContract.steps missing ${step}`);
  }
  const hardRules = webHeroGoalContractHardRules(data);
  const requiredRules = [
    "previewVisualSpecsRequired",
    "imageAssetsRequireVisualSpecEvidence",
    "sectionDraftsRequirePreviewBinding",
    "mergeFromPersistedDraftsOnly",
    "noPreviewScreenshotsAsFinalAssets",
  ];
  for (const rule of requiredRules) {
    if (hardRules[rule] !== true) issues.push(`webHeroGoalContract.hardRules.${rule}=true`);
  }
  return issues;
}

export function buildDefaultWebHeroGoalContract(input: {
  nodeId: string;
  goal?: string;
  currentStep?: string;
  stepStatus?: Record<string, unknown>;
}): Record<string, unknown> {
  const currentStep = normalizeWebHeroGoalStep(input.currentStep) || "style_reference_selection";
  const stepStatus = input.stepStatus || {};
  return {
    kind: "webHeroGoalContract",
    version: 1,
    targetWebHeroNodeId: input.nodeId,
    goal: readTrimmedString(input.goal) || "WebHero preview-first website workflow",
    currentStep,
    steps: WEBHERO_GOAL_STEPS.map((step) => ({
      id: step,
      status:
        step === currentStep
		  ? currentStep === "completed" ? "completed" : "in_progress"
          : webHeroGoalStepIndex(step) < webHeroGoalStepIndex(currentStep)
            ? "completed"
            : "pending",
    })),
    legacyStepStatus: stepStatus,
    hardRules: {
      previewVisualSpecsRequired: true,
      imageAssetsRequireVisualSpecEvidence: true,
      sectionDraftsRequirePreviewBinding: true,
      mergeFromPersistedDraftsOnly: true,
      noPreviewScreenshotsAsFinalAssets: true,
      debugResumeFromCurrentStepOnly: true,
    },
  };
}

function hasNonEmptyRecordOrArray(value: unknown): boolean {
  const parsed = parseMaybeJsonValue(value);
  if (Array.isArray(parsed)) return parsed.length > 0;
  return Boolean(parsed && typeof parsed === "object" && Object.keys(parsed as Record<string, unknown>).length > 0);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === "string" && value.trim()) return true;
  return hasNonEmptyRecordOrArray(value);
}

function collectBrowserUsableUrls(value: unknown): string[] {
  const parsed = parseMaybeJsonValue(value);
  const urls = new Set<string>();
  const visit = (item: unknown, depth: number): void => {
    if (depth > 8) return;
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:image/")) {
        urls.add(trimmed);
      }
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child) => visit(child, depth + 1));
      return;
    }
    if (!item || typeof item !== "object") return;
		const record = item as Record<string, unknown>;
		for (const key of ["url", "imageUrl", "src", "outputUrl", "hostedUrl"]) {
			visit(record[key], depth + 1);
		}
		for (const key of ["imageResults", "results", "images", "outputs"]) {
			visit(record[key], depth + 1);
		}
  };
  visit(parsed, 0);
  return Array.from(urls);
}

function hasBrowserUsableUrl(value: unknown): boolean {
	return collectBrowserUsableUrls(value).length > 0;
}

function collectRecords(value: unknown): Record<string, unknown>[] {
  const parsed = parseMaybeJsonValue(value);
  const out: Record<string, unknown>[] = [];
  const visit = (item: unknown, depth: number): void => {
    if (depth > 8) return;
    if (Array.isArray(item)) {
      item.forEach((child) => visit(child, depth + 1));
      return;
    }
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    out.push(record);
    Object.values(record).forEach((child) => visit(child, depth + 1));
  };
  visit(parsed, 0);
  return out;
}

function normalizeToken(value: unknown): string {
  return readTrimmedString(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeSearchText(value: unknown): string {
  return readTrimmedString(value).toLowerCase().replace(/[_-]+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsSearchKeyword(text: string, keyword: string): boolean {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return false;
  if (/\s/.test(normalizedKeyword)) return text.includes(normalizedKeyword);
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedKeyword)}([^a-z0-9]|$)`).test(text);
}

function isImageAssetRequirement(record: Record<string, unknown>): boolean {
  const implementation = normalizeToken(record.implementation);
  const renderMode = normalizeToken(record.renderMode);
  const type = normalizeToken(record.type);
  const category = normalizeToken(record.category);
  return (
    implementation === "generate" ||
    implementation === "public_search" ||
    implementation === "web_asset_search" ||
    implementation === "existing_canvas" ||
    renderMode === "image_asset" ||
    type === "image" ||
    type === "photo" ||
    type === "raster" ||
    type === "generated_image" ||
    type === "generated_image_reuse" ||
    category === "generated_image" ||
    category === "image_asset"
  );
}

function isIconAssetRequirement(record: Record<string, unknown>): boolean {
  const tokens = [
    record.implementation,
    record.decision,
    record.source,
    record.sourceType,
    record.webPageAssetSource,
    record.type,
    record.kind,
    record.category,
  ].map(normalizeToken);
  return tokens.some((token) => token === "icon" || token === "icon_search" || token === "iconify");
}

const PROCEDURAL_VISUAL_TOKENS = new Set([
  "code_procedural",
  "code_procedural_css",
  "css_procedural",
  "css",
  "html_css",
  "html_css_text",
  "text_css",
  "typographic_css",
]);

const NARRATIVE_IMAGE_TYPE_TOKENS = new Set([
  "product_visual",
  "technical_product_visual",
  "product_mockup",
  "device_mockup",
  "app_mockup",
  "ui_mockup",
  "ecosystem_ui",
  "lifestyle_visual",
  "portrait",
  "photo",
  "scene",
  "media",
  "hero_object",
  "hero_visual",
  "section_illustration",
  "generated_image",
  "image_asset",
]);

const NARRATIVE_IMAGE_KEYWORDS = [
  "product",
  "earbud",
  "headphone",
  "charging case",
  "device",
  "hardware",
  "mockup",
  "phone pairing",
  "app ui",
  "chat ui",
  "conversation ui",
  "ecosystem",
  "exploded",
  "acoustic",
  "chip",
  "driver",
  "structure",
  "technical",
  "material",
  "wearing",
  "lifestyle",
  "portrait",
  "person",
  "face",
  "avatar",
  "companion",
  "scene",
  "photo",
  "media",
  "3d",
  "foreground",
  "hero render",
  "vehicle",
  "car",
  "wearable",
];

const EMBED_REQUIRED_TYPE_TOKENS = new Set([
  "product_visual",
  "technical_product_visual",
  "product_mockup",
  "device_mockup",
  "lifestyle_visual",
  "portrait",
  "photo",
  "scene",
  "hero_object",
  "hero_visual",
]);

const EMBED_REQUIRED_KEYWORDS = [
  "product",
  "earbud",
  "headphone",
  "charging case",
  "device",
  "hardware",
  "mockup",
  "phone",
  "foldable",
  "hinge",
  "camera",
  "lens",
  "screen",
  "display",
  "chassis",
  "body",
  "wearing",
  "lifestyle",
  "portrait",
  "person",
  "scene",
  "photo",
  "foreground",
  "hero render",
  "vehicle",
  "car",
  "watch",
  "wearable",
];

const PROCEDURAL_STRUCTURE_TYPE_TOKENS = new Set([
  "css_layout",
  "layout",
  "ui_structure",
  "interface_structure",
  "component_structure",
  "decorative_linework",
  "linework",
  "spec_matrix",
  "specs_matrix",
  "card_grid",
  "typography",
]);

const PROCEDURAL_STRUCTURE_KEYWORDS = [
  "navigation",
  "nav",
  "cta",
  "button",
  "buttons",
  "pill",
  "pills",
  "chip",
  "chips",
  "badge",
  "badges",
  "card",
  "cards",
  "glass card",
  "glass cards",
  "connector line",
  "connector lines",
  "line",
  "lines",
  "rail",
  "rails",
  "spec",
  "specs",
  "matrix",
  "footer",
  "disclaimer",
  "layout",
  "grid",
  "panel",
  "panels",
  "pane",
  "panes",
  "typography",
  "label",
  "labels",
];

function isProceduralVisualDecision(record: Record<string, unknown>): boolean {
  const candidates = [
    record.implementation,
    record.decision,
    record.renderMode,
    record.mode,
    record.source,
  ].map(normalizeToken);
  if (candidates.some((token) => PROCEDURAL_VISUAL_TOKENS.has(token))) return true;
  if (candidates.some((token) => ["generate", "public_search", "web_asset_search", "existing_canvas"].includes(token))) {
    return false;
  }
  const text = [
    record.implementation,
    record.decision,
    record.renderMode,
    record.reason,
  ].map(normalizeSearchText).join(" ");
  return /\b(css|html|text|typographic|procedural|handwritten|programmatic)\b/.test(text);
}

function isExplicitProceduralStructureIntent(record: Record<string, unknown>): boolean {
  if (!isProceduralVisualDecision(record)) return false;

  const typeTokens = [
    record.type,
    record.category,
    record.subjectType,
    record.role,
    record.renderMode,
  ].map(normalizeToken);

  const hardNarrativeType = typeTokens.some((token) =>
    NARRATIVE_IMAGE_TYPE_TOKENS.has(token) &&
    !["ui_mockup", "ecosystem_ui"].includes(token)
  );
  if (hardNarrativeType) return false;

  const text = [
    record.slotId,
    record.subjectId,
    record.assetId,
    record.description,
    record.placement,
    record.reason,
    record.implementation,
    record.decision,
    record.renderMode,
    record.intendedWebUsage,
  ].map(normalizeSearchText).join(" ");

  const explicitCodeIntent =
    /\b(css|html|svg|procedural|programmatic|code|dom)\b/.test(text) ||
    /\bnot embedded as (an )?image\b/.test(text) ||
    /\bnot (an )?embedded image\b/.test(text);
  if (!explicitCodeIntent) return false;

  return typeTokens.some((token) => PROCEDURAL_STRUCTURE_TYPE_TOKENS.has(token)) ||
    PROCEDURAL_STRUCTURE_KEYWORDS.some((keyword) => containsSearchKeyword(text, keyword));
}

function isNarrativeImageLikeRequirement(record: Record<string, unknown>): boolean {
  if (isExplicitProceduralStructureIntent(record)) return false;

  const typeTokens = [
    record.type,
    record.category,
    record.subjectType,
    record.role,
    record.renderMode,
  ].map(normalizeToken);
  if (typeTokens.some((token) => NARRATIVE_IMAGE_TYPE_TOKENS.has(token))) return true;

  const searchable = [
    record.slotId,
    record.subjectId,
    record.assetId,
    record.description,
    record.placement,
    record.reason,
    record.implementation,
    record.decision,
  ].map(normalizeSearchText).join(" ");
  return NARRATIVE_IMAGE_KEYWORDS.some((keyword) => containsSearchKeyword(searchable, keyword));
}

function requiresEmbeddedVisualAsset(record: Record<string, unknown>): boolean {
  const explicitRole = normalizeToken(record.webPageAssetCodeRole);
  if (explicitRole && EMBEDDED_ROLE_TOKENS.has(explicitRole)) return true;

  const typeTokens = [
    record.type,
    record.category,
    record.subjectType,
    record.role,
    record.renderMode,
  ].map(normalizeToken);
  if (typeTokens.some((token) => EMBED_REQUIRED_TYPE_TOKENS.has(token))) return true;

  const searchable = [
    record.slotId,
    record.subjectId,
    record.assetId,
    record.description,
    record.placement,
    record.reason,
    record.intendedWebUsage,
  ].map(normalizeSearchText).join(" ");
  return EMBED_REQUIRED_KEYWORDS.some((keyword) => containsSearchKeyword(searchable, keyword));
}

function assetRecordId(record: Record<string, unknown>): string {
  return (
    readTrimmedString(record.assetId) ||
    readTrimmedString(record.id) ||
    readTrimmedString(record.requirementId) ||
    readTrimmedString(record.slotId) ||
    readTrimmedString(record.webPageAssetId)
  );
}

const REFERENCE_ONLY_ROLE_TOKENS = new Set([
  "reference",
  "reference_only",
  "evidence",
  "inspiration",
  "styleguide",
  "styleguide_only",
  "design_reference",
]);

const EMBEDDED_ROLE_TOKENS = new Set([
  "embed",
  "embedded",
  "render",
  "rendered",
  "source",
  "asset",
  "media",
]);

function isReferenceOnlyAssetIntent(record: Record<string, unknown>): boolean {
  const roleToken = normalizeToken(record.webPageAssetCodeRole);
  if (roleToken && EMBEDDED_ROLE_TOKENS.has(roleToken)) return false;
  if (requiresEmbeddedVisualAsset(record)) return false;
  if (roleToken && REFERENCE_ONLY_ROLE_TOKENS.has(roleToken)) return true;

  if (typeof record.intendedWebUsage === "string") {
    const usage = record.intendedWebUsage.toLowerCase();
    if (/\b(reference|evidence|inspiration|guide|styleguide)\b[^.]*\b(css|html|procedural|code|render)\b/.test(usage)) {
      return true;
    }
  }
  return false;
}

function getWebPageAssetRequirementsRecord(data: Record<string, unknown>): Record<string, unknown> {
  return parseMaybeJsonRecord(data.webPageAssetRequirements);
}

function getFlatVisualSlotRecords(data: Record<string, unknown>): Record<string, unknown>[] {
  const requirements = getWebPageAssetRequirementsRecord(data);
  const visualSlots = requirements.visualSlots;
  if (!Array.isArray(visualSlots)) return [];
  return visualSlots.filter((item): item is Record<string, unknown> => {
    return Boolean(item && typeof item === "object" && !Array.isArray(item));
  });
}

function hasVisibleSubjectInventory(data: Record<string, unknown>): boolean {
  const requirements = getWebPageAssetRequirementsRecord(data);
  return hasNonEmptyRecordOrArray(data.visibleSubjectInventory) ||
    hasNonEmptyRecordOrArray(requirements.visibleSubjectInventory) ||
    hasNonEmptyRecordOrArray(data.webPageVisibleSubjectInventory);
}

function flatVisualSlotInventoryIssues(
  data: Record<string, unknown>,
  approvedPreviewNodeIds: string[],
): string[] {
  return diagnoseWebHeroAssetRequirements(data.webPageAssetRequirements, {
    approvedPreviewNodeIds,
  }).issues;
}

function hasResolvedImageAssetForRequirement(resolvedAssets: unknown, assetId: string): boolean {
  if (!assetId) return false;
  return collectRecords(resolvedAssets).some((record) => {
    const resolvedId = assetRecordId(record);
    if (resolvedId !== assetId) return false;
    const source = normalizeToken(record.source || record.sourceType || record.webPageAssetSource);
    const kind = normalizeToken(record.kind || record.type);
    if (source === "icon" || kind === "icon") return false;
    return hasBrowserUsableUrl(record);
  });
}

function resolvedImageAssetUrlsForRequirement(resolvedAssets: unknown, assetId: string): string[] {
  if (!assetId) return [];
  const urls = new Set<string>();
  for (const record of collectRecords(resolvedAssets)) {
    const resolvedId = assetRecordId(record);
    if (resolvedId !== assetId) continue;
    const source = normalizeToken(record.source || record.sourceType || record.webPageAssetSource);
    const kind = normalizeToken(record.kind || record.type);
    if (source === "icon" || kind === "icon") continue;
    collectBrowserUsableUrls(record).forEach((url) => urls.add(url));
  }
  return Array.from(urls);
}

function isSuccessfulCanvasImageAssetData(
  data: Record<string, unknown>,
  nodeId: string,
  assetId?: string,
): boolean {
  if (readTrimmedString(data.webPageAssetForNodeId) !== nodeId) return false;
  if (assetId && readTrimmedString(data.webPageAssetId) !== assetId) return false;
  const status = readTrimmedString(data.status).toLowerCase();
  if (status !== "success" && status !== "succeeded") return false;
  return hasBrowserUsableUrl(data.imageUrl)
    || hasBrowserUsableUrl(data.imageResults);
}

function hasCanvasImageAssetForRequirement(graph: FlowGraphRecord, nodeId: string, assetId: string): boolean {
  if (!assetId) return false;
  return (graph.nodes || []).some((node) =>
    isSuccessfulCanvasImageAssetData(flowNodeData(node), nodeId, assetId),
  );
}

function canvasImageAssetUrlsForRequirement(graph: FlowGraphRecord, nodeId: string, assetId: string): string[] {
  if (!assetId) return [];
  const urls = new Set<string>();
  for (const node of graph.nodes || []) {
    const data = flowNodeData(node);
    if (!isSuccessfulCanvasImageAssetData(data, nodeId, assetId)) continue;
    collectBrowserUsableUrls(data.imageUrl).forEach((url) => urls.add(url));
    collectBrowserUsableUrls(data.imageResults).forEach((url) => urls.add(url));
  }
  return Array.from(urls);
}

function webHeroAssetNodesWithUrl(graph: FlowGraphRecord, nodeId: string): unknown[] {
  return (graph.nodes || []).filter((node) =>
    isSuccessfulCanvasImageAssetData(flowNodeData(node), nodeId),
  );
}

function previewMediaUrls(graph: FlowGraphRecord, nodeId: string): string[] {
  const urls = new Set<string>();
  for (const node of findWebHeroPreviewNodes(graph, nodeId)) {
    const data = flowNodeData(node);
    collectBrowserUsableUrls(data.imageUrl).forEach((url) => urls.add(url));
    collectBrowserUsableUrls(data.imageResults).forEach((url) => urls.add(url));
  }
  return Array.from(urls);
}

function previewMediaUrlSet(graph: FlowGraphRecord, nodeId: string): Set<string> {
  return new Set(previewMediaUrls(graph, nodeId));
}

function nonPreviewUrls(urls: Iterable<string>, previewUrls: Set<string>): string[] {
  const out = new Set<string>();
  for (const url of urls) {
    const trimmed = readTrimmedString(url);
    if (!trimmed || previewUrls.has(trimmed)) continue;
    out.add(trimmed);
  }
  return Array.from(out);
}

function finalCodeText(data: Record<string, unknown>): string {
  return [
    readTrimmedString(data.webHeroHtml ?? data.html),
    readTrimmedString(data.webHeroCss ?? data.css),
    readTrimmedString(data.webHeroDocumentHtml ?? data.documentHtml),
  ].join("\n").replace(/&amp;/g, "&");
}

function finalCodeContainsUrl(finalCode: string, url: string): boolean {
  if (!url) return false;
  if (finalCode.includes(url)) return true;
  const entityEscaped = url.replace(/&/g, "&amp;");
  if (finalCode.includes(entityEscaped)) return true;
  try {
    const decoded = decodeURI(url);
    if (decoded !== url && finalCode.includes(decoded)) return true;
  } catch {
    // Keep the direct string checks above as the source of truth for malformed URLs.
  }
  return false;
}

function finalCodeContainsPreviewBinding(finalCode: string, previewNodeId: string): boolean {
  if (!previewNodeId) return false;
  return finalCode.includes(`data-preview-node-id="${previewNodeId}"`) ||
    finalCode.includes(`data-preview-node-id='${previewNodeId}'`);
}

function requiredResolvedImageAssetUrlGroups(
  graph: FlowGraphRecord,
  nodeId: string,
  targetData: Record<string, unknown>,
): Array<{ assetId: string; urls: string[] }> {
  const previewUrls = previewMediaUrlSet(graph, nodeId);
  const groups: Array<{ assetId: string; urls: string[] }> = [];
  const seen = new Set<string>();
  for (const record of getImageAssetRequirementRecords(targetData)) {
    const assetId = assetRecordId(record);
    if (!assetId || seen.has(assetId)) continue;
    if (isIconAssetRequirement(record)) continue;
    if (isReferenceOnlyAssetIntent(record)) continue;
    seen.add(assetId);
    const urls = new Set<string>();
    resolvedImageAssetUrlsForRequirement(targetData.webPageResolvedAssets, assetId).forEach((url) => urls.add(url));
    canvasImageAssetUrlsForRequirement(graph, nodeId, assetId).forEach((url) => urls.add(url));
    groups.push({ assetId, urls: nonPreviewUrls(urls, previewUrls) });
  }
  return groups;
}

function assertWebHeroFinalCodeReferencesAllowed(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
): void {
  const finalCode = finalCodeText(data);
  if (!finalCode.trim()) return;

  const usedPreviewUrls = previewMediaUrls(graph, nodeId).filter((url) => finalCodeContainsUrl(finalCode, url));
  if (usedPreviewUrls.length > 0) {
    throw new AppError("WebHero final code must not use approved preview screenshots as webpage assets", {
      status: 409,
      code: "webhero_final_code_uses_preview_media",
      details: {
        nodeId,
        previewUrls: usedPreviewUrls.slice(0, 8),
        requiredNextStep:
          "Use approved preview screenshots only as visual references. Resolve or generate independent webpage assets, then reference those asset URLs in final HTML/CSS.",
      },
    });
  }

  const target = findFlowNodeById(graph, nodeId);
  const targetData = flowNodeData(target);
  const missingAssetRefs = requiredResolvedImageAssetUrlGroups(graph, nodeId, targetData)
    .filter((group) => group.urls.length > 0)
    .filter((group) => !group.urls.some((url) => finalCodeContainsUrl(finalCode, url)))
    .map((group) => group.assetId);
  if (missingAssetRefs.length > 0) {
    throw new AppError("WebHero final code must reference resolved webpage image assets", {
      status: 409,
      code: "webhero_final_code_missing_resolved_assets",
      details: {
        nodeId,
        missingAssetIds: missingAssetRefs.slice(0, 12),
        requiredNextStep:
          "Use the URLs from webPageResolvedAssets or matching webPageAssetForNodeId canvas nodes in the final HTML/CSS instead of replacing them with preview screenshots or handwritten placeholders.",
      },
    });
  }

  const missingPreviewBindings = findWebHeroPreviewNodes(graph, nodeId)
    .map(flowNodeId)
    .filter(Boolean)
    .filter((previewNodeId) => !finalCodeContainsPreviewBinding(finalCode, previewNodeId));
  if (missingPreviewBindings.length > 0) {
    throw new AppError("WebHero final code must preserve approved section draft preview bindings", {
      status: 409,
      code: "webhero_final_code_missing_preview_bindings",
      details: {
        nodeId,
        missingPreviewNodeIds: missingPreviewBindings.slice(0, 12),
        requiredNextStep:
          "Assemble final HTML/CSS from targetNode.data.webPageSectionDrafts only. Every approved preview section must remain traceable with data-preview-node-id in the final HTML/document.",
      },
    });
  }
}

function getPreviewOrders(graph: FlowGraphRecord, nodeId: string): Set<string> {
  const orders = new Set<string>();
  findWebHeroPreviewNodes(graph, nodeId).forEach((node, index) => {
    const data = flowNodeData(node);
    const explicit = readScalarString(data.webScreenshotOrder);
    orders.add(explicit || String(index + 1));
  });
  return orders;
}

function getPreviewCoverageKeys(graph: FlowGraphRecord, nodeId: string): Set<string> {
  const keys = new Set<string>();
  findWebHeroPreviewNodes(graph, nodeId).forEach((node, index) => {
    const data = flowNodeData(node);
    const explicitOrder = readScalarString(data.webScreenshotOrder);
    const order = explicitOrder || String(index + 1);
    if (order) keys.add(`order:${order}`);
    const previewNodeId = flowNodeId(node);
    if (previewNodeId) keys.add(`preview:${previewNodeId}`);
    const sectionId = readTrimmedString(data.webScreenshotSectionId);
    if (sectionId) keys.add(`section:${sectionId}`);
  });
  return keys;
}

function screenshotOrderKey(record: Record<string, unknown>): string {
  return (
    readScalarString(record.screenshotOrder) ||
    readScalarString(record.webScreenshotOrder) ||
    readScalarString(record.previewOrder) ||
    readScalarString(record.order)
  );
}

function assetRequirementCoverageKeys(record: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const order = screenshotOrderKey(record);
  if (order) keys.push(`order:${order}`);
  const previewNodeId =
    readTrimmedString(record.previewNodeId) ||
    readTrimmedString(record.sourcePreviewNodeId) ||
    readTrimmedString(record.webPreviewNodeId) ||
    readTrimmedString(record.previewId) ||
    readTrimmedString(record.approvedPreviewNodeId);
  if (previewNodeId) keys.push(`preview:${previewNodeId}`);
  const sectionId =
    readTrimmedString(record.sectionId) ||
    readTrimmedString(record.webScreenshotSectionId) ||
    readTrimmedString(record.section);
  if (sectionId) keys.push(`section:${sectionId}`);
  return keys;
}

function getAssetRequirementRecords(data: Record<string, unknown>): Record<string, unknown>[] {
  return getFlatVisualSlotRecords(data).filter((record) => {
    if (assetRecordId(record)) return true;
    if (readTrimmedString(record.description) || readTrimmedString(record.placement)) return true;
    return Boolean(record.implementation || record.renderMode || record.type);
  });
}

function getImageAssetRequirementRecords(data: Record<string, unknown>): Record<string, unknown>[] {
  return getAssetRequirementRecords(data).filter((record) =>
    isImageAssetRequirement(record) && !isExplicitProceduralStructureIntent(record)
  );
}

function componentSectionDecisionRecords(data: Record<string, unknown>, brief: Record<string, unknown>): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const plans = [parseMaybeJsonRecord(data.componentReferencePlan), parseMaybeJsonRecord(brief.componentReferencePlan)];
  for (const plan of plans) {
    for (const key of [
      "sectionDecisions",
      "sectionReferenceDecisions",
      "perSectionDecisions",
      "approvedPreviewNodes",
      "decisions",
      "sections",
      "sectionPlan",
      "componentRecords",
      "records",
    ]) {
      const value = plan[key];
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) records.push(item as Record<string, unknown>);
      }
    }
  }
  return records;
}

function componentCoverageKeysForPreview(record: Record<string, unknown>): string[] {
  const keys = assetRequirementCoverageKeys(record);
  const nodeId =
    readTrimmedString(record.nodeId) ||
    readTrimmedString(record.previewNodeId) ||
    readTrimmedString(record.sourcePreviewNodeId);
  if (nodeId) keys.push(`preview:${nodeId}`);
  const sectionId =
    readTrimmedString(record.sectionId) ||
    readTrimmedString(record.id) ||
    readTrimmedString(record.section);
  if (sectionId) keys.push(`section:${sectionId}`);
  return keys;
}

function collectWebHeroSectionDrafts(data: Record<string, unknown>): Record<string, unknown>[] {
  const direct = data.webPageSectionDrafts;
  if (Array.isArray(direct)) {
    return direct.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    );
  }
  return [];
}

function collectWebHeroPreviewVisualSpecs(data: Record<string, unknown>): Record<string, unknown>[] {
	const direct = data.webPagePreviewVisualSpecs;
  if (Array.isArray(direct)) {
    return direct.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    );
  }
  return [];
}

function previewVisualSpecCoverageKeys(record: Record<string, unknown>): string[] {
  return assetRequirementCoverageKeys(record);
}

function hasPreviewVisualSpecsForEveryPreview(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
): boolean {
  const previewNodes = findWebHeroPreviewNodes(graph, nodeId);
  if (previewNodes.length < 1) return true;
  const specs = collectWebHeroPreviewVisualSpecs(data);
	if (specs.length !== previewNodes.length) return false;
  return previewNodes.every((node) => {
	const previewId = flowNodeId(node);
	return Boolean(previewId) && specs.filter((record) =>
	  readTrimmedString(record.previewNodeId) === previewId
	).length === 1;
  });
}

function slotHasVisualSpecEvidence(record: Record<string, unknown>): boolean {
  if (
    readTrimmedString(record.visualSpecId) ||
    readTrimmedString(record.sourceVisualSpecId) ||
    readTrimmedString(record.previewVisualSpecId) ||
    readTrimmedString(record.visualSpecSummary) ||
    readTrimmedString(record.previewVisualCue) ||
    readTrimmedString(record.derivedFromPreview)
  ) {
    return true;
  }
  return hasNonEmptyRecordOrArray(record.sourceEvidence) ||
    hasNonEmptyRecordOrArray(record.previewEvidence) ||
    hasNonEmptyRecordOrArray(record.visualSpec);
}

function imageAssetSlotsMissingPreviewVisualSpecEvidence(data: Record<string, unknown>): string[] {
  return getAssetRequirementRecords(data)
    .filter((record) => isImageAssetRequirement(record) && !isExplicitProceduralStructureIntent(record))
    .filter((record) => !slotHasVisualSpecEvidence(record))
    .map((record) =>
      readTrimmedString(record.slotId) ||
      readTrimmedString(record.assetId) ||
      readTrimmedString(record.subjectId) ||
      "unnamed-image-slot"
    )
    .slice(0, 12);
}

function sectionDraftCoverageKeys(record: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const previewNodeId = readTrimmedString(record.previewNodeId);
  if (previewNodeId) keys.push(`preview:${previewNodeId}`);
  const sectionId = readTrimmedString(record.sectionId);
  if (sectionId) keys.push(`section:${sectionId}`);
  const order = readScalarString(record.order);
  if (order) keys.push(`order:${order}`);
  return keys;
}

function isUsableSectionDraft(record: Record<string, unknown>): boolean {
  if (record.blocked === true) return false;
  const html = readTrimmedString(record.html);
  const css = readTrimmedString(record.css);
  return html.length > 20 && css.length > 20;
}

function hasVerifiedSectionDraftProvenance(record: Record<string, unknown>): boolean {
  return diagnoseWebHeroSectionDraft(record).ok;
}

function draftHasPreviewNodeBinding(record: Record<string, unknown>): boolean {
  const previewNodeId = readTrimmedString(record.previewNodeId);
  if (!previewNodeId) return false;
  const html = readTrimmedString(record.html);
  return html.includes(`data-preview-node-id="${previewNodeId}"`) ||
    html.includes(`data-preview-node-id='${previewNodeId}'`);
}

function readStringList(value: unknown): string[] {
  const parsed = parseMaybeJsonValue(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(readScalarString).filter(Boolean);
}

function draftReferencesRequiredImageAssets(
  draft: Record<string, unknown>,
  data: Record<string, unknown>,
): boolean {
  const previewNodeId = readTrimmedString(draft.previewNodeId);
  const sectionId = readTrimmedString(draft.sectionId);
  const requiredAssetIds = getAssetRequirementRecords(data)
    .filter((record) => isImageAssetRequirement(record) && !isExplicitProceduralStructureIntent(record))
    .filter((record) => {
      const slotPreview =
        readTrimmedString(record.previewNodeId) ||
        readTrimmedString(record.sourcePreviewNodeId) ||
        readTrimmedString(record.webPreviewNodeId) ||
        readTrimmedString(record.previewId);
      const slotSection = readTrimmedString(record.sectionId) || readTrimmedString(record.section);
      return (previewNodeId && slotPreview === previewNodeId) || (sectionId && slotSection === sectionId);
    })
    .map(assetRecordId)
    .filter(Boolean);
  if (requiredAssetIds.length < 1) return true;
  const haystack = [
    readTrimmedString(draft.html),
    readTrimmedString(draft.css),
    ...readStringList(draft.usedAssetIds),
    ...readStringList(draft.usedAssetUrls),
  ].join("\n");
  return requiredAssetIds.every((assetId) => haystack.includes(assetId));
}

function missingSectionDraftFidelityEvidence(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
): string[] {
  const previewNodes = findWebHeroPreviewNodes(graph, nodeId);
  if (previewNodes.length < 1) return [];
  const drafts = collectWebHeroSectionDrafts(data).filter(isUsableSectionDraft);
  const missing: string[] = [];
  previewNodes.forEach((node, index) => {
    const previewData = flowNodeData(node);
    const previewId = flowNodeId(node);
    const order = readScalarString(previewData.webScreenshotOrder) || String(index + 1);
    const sectionId = readTrimmedString(previewData.webScreenshotSectionId);
	const draft = drafts.find((candidate) =>
	  previewId && readTrimmedString(candidate.previewNodeId) === previewId
	);
	if (!draft) return;
	if (previewId && !draftHasPreviewNodeBinding(draft)) {
	  missing.push(`webPageSectionDrafts draft for ${previewId} must include data-preview-node-id`);
	}
	if (sectionId && readTrimmedString(draft.sectionId) !== sectionId) {
	  missing.push(`webPageSectionDrafts draft for ${previewId} must match sectionId=${sectionId}`);
	}
	if (readScalarString(draft.order) !== order) {
	  missing.push(`webPageSectionDrafts draft for ${previewId} must match order=${order}`);
	}
    if (!draftReferencesRequiredImageAssets(draft, data)) {
      missing.push(`webPageSectionDrafts draft for ${previewId || sectionId || order} must reference required image asset ids`);
    }
  });
  return missing;
}

function hasRequiredSectionDraftSet(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
): boolean {
  const previewNodes = findWebHeroPreviewNodes(graph, nodeId);
  if (previewNodes.length < 1) return true;
  const drafts = collectWebHeroSectionDrafts(data).filter(isUsableSectionDraft);
	if (drafts.length !== previewNodes.length) return false;
	return previewNodes.every((node) => {
	  const previewId = flowNodeId(node);
	  return Boolean(previewId) && drafts.filter((draft) =>
		readTrimmedString(draft.previewNodeId) === previewId
	  ).length === 1;
	});
}

function missingSectionDraftEvidence(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
): string[] {
  const previewNodes = findWebHeroPreviewNodes(graph, nodeId);
  if (previewNodes.length < 1) return [];
  const drafts = collectWebHeroSectionDrafts(data);
  if (drafts.length < 1) {
    return ["webPageSectionDrafts persisted screenshot-to-code section drafts"];
  }
  const usableDrafts = drafts.filter(isUsableSectionDraft);
  if (usableDrafts.length < previewNodes.length) {
    return ["webPageSectionDrafts must contain one non-blocked html/css draft per approved preview"];
  }
  if (!hasRequiredSectionDraftSet(graph, nodeId, data)) {
	return ["webPageSectionDrafts must contain exactly one usable draft for every approved previewNodeId"];
  }
  if (!drafts.every(hasVerifiedSectionDraftProvenance)) {
    return ["webPageSectionDrafts codegen provenance for every approved preview"];
  }
  return [];
}

function hasComponentPreviewCoverage(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
  brief: Record<string, unknown>,
): boolean {
  const previewNodes = findWebHeroPreviewNodes(graph, nodeId);
  if (previewNodes.length < 1) return true;
  const componentKeys = new Set<string>();
  for (const record of componentSectionDecisionRecords(data, brief)) {
    for (const key of componentCoverageKeysForPreview(record)) componentKeys.add(key);
  }
  if (componentKeys.size < 1) return false;
  const coveredPreviews = new Set<string>();
  previewNodes.forEach((node, index) => {
    const previewData = flowNodeData(node);
    const previewId = flowNodeId(node);
    const keys = [
      `order:${readScalarString(previewData.webScreenshotOrder) || String(index + 1)}`,
      previewId ? `preview:${previewId}` : "",
      `section:${readTrimmedString(previewData.webScreenshotSectionId)}`,
    ].filter((key) => key && !key.endsWith(":"));
    if (keys.some((key) => componentKeys.has(key))) coveredPreviews.add(previewId || String(index + 1));
  });
  return coveredPreviews.size >= previewNodes.length;
}

function hasPreviewLevelAssetSlots(graph: FlowGraphRecord, nodeId: string, data: Record<string, unknown>): boolean {
  const expectedKeys = getPreviewCoverageKeys(graph, nodeId);
  if (expectedKeys.size < 1) return true;
  const expectedPreviewCount = findWebHeroPreviewNodes(graph, nodeId).length;
  const coveredPreviewIdentities = new Set<string>();
  for (const record of getAssetRequirementRecords(data)) {
    for (const key of assetRequirementCoverageKeys(record)) {
      if (!expectedKeys.has(key)) continue;
      coveredPreviewIdentities.add(key);
    }
  }
  const coveredPreviews = new Set<string>();
  for (const node of findWebHeroPreviewNodes(graph, nodeId)) {
    const previewData = flowNodeData(node);
    const previewKeys = [
      `order:${readScalarString(previewData.webScreenshotOrder)}`,
      `preview:${flowNodeId(node)}`,
      `section:${readTrimmedString(previewData.webScreenshotSectionId)}`,
    ].filter((key) => !key.endsWith(":"));
    if (previewKeys.some((key) => coveredPreviewIdentities.has(key))) {
      coveredPreviews.add(flowNodeId(node) || readScalarString(previewData.webScreenshotOrder));
    }
  }
  return coveredPreviews.size >= expectedPreviewCount;
}

function missingImageAssetEvidence(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
): string[] {
  const previewUrls = previewMediaUrlSet(graph, nodeId);
  return getImageAssetRequirementRecords(data)
    .map((record) => assetRecordId(record))
    .filter(Boolean)
    .filter((assetId) => {
      const resolved = nonPreviewUrls(
        resolvedImageAssetUrlsForRequirement(data.webPageResolvedAssets, assetId),
        previewUrls,
      );
      const canvas = nonPreviewUrls(
        canvasImageAssetUrlsForRequirement(graph, nodeId, assetId),
        previewUrls,
      );
      return resolved.length < 1 && canvas.length < 1;
    });
}

function previewBackedResolvedImageAssets(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
): string[] {
  const previewUrls = previewMediaUrlSet(graph, nodeId);
  if (previewUrls.size < 1) return [];
  const offending: string[] = [];
  for (const record of getImageAssetRequirementRecords(data)) {
    const assetId = assetRecordId(record);
    if (!assetId || offending.includes(assetId)) continue;
    const allUrls = [
      ...resolvedImageAssetUrlsForRequirement(data.webPageResolvedAssets, assetId),
      ...canvasImageAssetUrlsForRequirement(graph, nodeId, assetId),
    ];
    if (allUrls.length < 1) continue;
    const usableUrls = nonPreviewUrls(allUrls, previewUrls);
    const previewOnly = usableUrls.length < 1 && allUrls.some((url) => previewUrls.has(readTrimmedString(url)));
    if (previewOnly) offending.push(assetId);
  }
  return offending;
}

function isGeneratedImageAssetRequirement(record: Record<string, unknown>): boolean {
  if (!isImageAssetRequirement(record)) return false;
  const tokens = [
    record.implementation,
    record.decision,
    record.source,
    record.sourceType,
    record.webPageAssetSource,
    record.type,
    record.category,
  ].map(normalizeToken);
  if (tokens.some((token) => [
    "generate",
    "generated",
    "image_generation",
    "text_to_image",
    "generated_image",
    "generated_image_reuse",
    "model_generated",
  ].includes(token))) {
    return true;
  }
  if (tokens.some((token) => ["public_search", "web_asset_search", "existing_canvas", "icon_search"].includes(token))) {
    return false;
  }
  return isNarrativeImageLikeRequirement(record) && !isProceduralVisualDecision(record);
}

function missingGeneratedCanvasAssetNodes(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
): string[] {
  return getAssetRequirementRecords(data)
    .filter(isGeneratedImageAssetRequirement)
    .map((record) => assetRecordId(record))
    .filter(Boolean)
    .filter((assetId) => !hasCanvasImageAssetForRequirement(graph, nodeId, assetId));
}

function proceduralNarrativeImageSlots(data: Record<string, unknown>): string[] {
  const slots: string[] = [];
  for (const record of getAssetRequirementRecords(data)) {
    if (!isProceduralVisualDecision(record)) continue;
    if (!isNarrativeImageLikeRequirement(record)) continue;
    if (isReferenceOnlyAssetIntent(record)) continue;
    const id =
      readTrimmedString(record.slotId) ||
      readTrimmedString(record.subjectId) ||
      readTrimmedString(record.assetId) ||
      readTrimmedString(record.id) ||
      readTrimmedString(record.type) ||
      "unnamed-slot";
    slots.push(id);
  }
  return Array.from(new Set(slots)).slice(0, 12);
}

function flowNodeId(node: unknown): string {
  return node && typeof node === "object" && !Array.isArray(node)
    ? readTrimmedString((node as Record<string, unknown>).id)
    : "";
}

function flowNodeData(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== "object" || Array.isArray(node)) return {};
  const data = (node as Record<string, unknown>).data;
  return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
}

function findFlowNodeById(graph: FlowGraphRecord, nodeId: string): unknown | null {
  return (graph.nodes || []).find((node) => flowNodeId(node) === nodeId) || null;
}

function readApprovedWebHeroPreviewNodeIds(graph: FlowGraphRecord, nodeId: string): string[] {
  const targetData = flowNodeData(findFlowNodeById(graph, nodeId));
  const workflow = parseMaybeJsonRecord(targetData.webPageWorkflowContract);
  if (!Array.isArray(workflow.approvedPreviewNodes)) return [];
  const ids = workflow.approvedPreviewNodes
    .map(readTrimmedString)
    .filter(Boolean);
  if (ids.length !== workflow.approvedPreviewNodes.length || new Set(ids).size !== ids.length) return [];
  return ids;
}

function findWebHeroPreviewNodes(graph: FlowGraphRecord, nodeId: string): unknown[] {
  return readApprovedWebHeroPreviewNodeIds(graph, nodeId)
    .map((previewNodeId) => findFlowNodeById(graph, previewNodeId))
    .filter((node) => {
      if (!node) return false;
      return readTrimmedString(flowNodeData(node).webPreviewForNodeId) === nodeId;
    });
}

function webHeroPreviewReadinessMissing(graph: FlowGraphRecord, nodeId: string): string[] {
  const missing: string[] = [];
  const approvedIds = readApprovedWebHeroPreviewNodeIds(graph, nodeId);
	const targetData = flowNodeData(findFlowNodeById(graph, nodeId));
	const selectedStyle = readSelectedWebHeroStyleReference(targetData);
	const expectedStyleUrls = selectedStyle?.referenceUrls.slice().sort() || [];
	const seenOrders = new Set<number>();
	const seenSectionIds = new Set<string>();
	const validOrders: number[] = [];
  if (approvedIds.length < requiredWebHeroPreviewCount()) {
    missing.push(`webPageWorkflowContract.approvedPreviewNodes (need ${requiredWebHeroPreviewCount()}, have ${approvedIds.length})`);
  }
  if (approvedIds.length > maximumWebHeroPreviewCount()) {
	missing.push(`webPageWorkflowContract.approvedPreviewNodes (maximum ${maximumWebHeroPreviewCount()}, have ${approvedIds.length})`);
  }
  for (const previewNodeId of approvedIds) {
    const node = findFlowNodeById(graph, previewNodeId);
    if (!node || readTrimmedString(flowNodeData(node).webPreviewForNodeId) !== nodeId) {
      missing.push(`approved preview ${previewNodeId} missing or not owned by ${nodeId}`);
      continue;
		}
		const data = flowNodeData(node);
		const order = Number(data.webScreenshotOrder);
		if (!Number.isInteger(order) || order < 1) {
			missing.push(`approved preview ${previewNodeId} requires a positive integer webScreenshotOrder`);
		} else if (seenOrders.has(order)) {
			missing.push(`approved preview order ${order} must be unique`);
		} else {
			seenOrders.add(order);
			validOrders.push(order);
		}
		const sectionId = readTrimmedString(data.webScreenshotSectionId);
		if (!sectionId) {
			missing.push(`approved preview ${previewNodeId} requires webScreenshotSectionId`);
		} else if (seenSectionIds.has(sectionId)) {
			missing.push(`approved preview sectionId ${sectionId} must be unique`);
		} else {
			seenSectionIds.add(sectionId);
		}
    const status = readTrimmedString(data.status).toLowerCase();
    if (status !== "success" && status !== "succeeded") {
      missing.push(`approved preview ${previewNodeId} status=${status || "missing"}`);
    }
    if (!hasBrowserUsableUrl(data.imageUrl) && !hasBrowserUsableUrl(data.imageResults)) {
      missing.push(`approved preview ${previewNodeId} browser-usable image URL`);
    }
		if (expectedStyleUrls.length > 0) {
			const actualStyleUrls = readStringList(data.webPreviewStyleReferenceUrls).slice().sort();
			if (
				actualStyleUrls.length !== expectedStyleUrls.length ||
				actualStyleUrls.some((url, index) => url !== expectedStyleUrls[index])
			) {
				missing.push(`approved preview ${previewNodeId} style reference provenance mismatch`);
			}
		}
  }
	if (
		validOrders.length === approvedIds.length &&
		validOrders.slice().sort((left, right) => left - right)
			.some((order, index) => order !== index + 1)
	) {
		missing.push(`approved preview webScreenshotOrder must be contiguous 1..${approvedIds.length}`);
	}
  return missing;
}

function hasWebHeroWorkflowEvidence(data: Record<string, unknown>): boolean {
  return (
    hasNonEmptyRecordOrArray(data.webHeroGoalContract) ||
    hasNonEmptyRecordOrArray(data.webPageWorkflowContract) ||
    hasMeaningfulValue(data.webPageReferencePrompt) ||
    hasNonEmptyRecordOrArray(data.webPageImplementationBrief) ||
    hasNonEmptyRecordOrArray(data.webPageAssetRequirements) ||
    hasNonEmptyRecordOrArray(data.visibleSubjectInventory) ||
    hasNonEmptyRecordOrArray(data.webPageResolvedAssets) ||
    hasNonEmptyRecordOrArray(data.webPageAssetDecisions)
  );
}

function isLegacyWebHeroWithoutPreviewWorkflow(graph: FlowGraphRecord, nodeId: string, data: Record<string, unknown>): boolean {
  return findWebHeroPreviewNodes(graph, nodeId).length < 1 && !hasWebHeroWorkflowEvidence(data);
}

function requiredWebHeroPreviewCount(): number {
  return 3;
}

function maximumWebHeroPreviewCount(): number {
  return 4;
}

function hasWebHeroAssetNodeWithUrl(graph: FlowGraphRecord, nodeId: string): boolean {
  return (graph.nodes || []).some((node) =>
    isSuccessfulCanvasImageAssetData(flowNodeData(node), nodeId),
  );
}

function hasWebHeroAssetDecisions(data: Record<string, unknown>): boolean {
  return diagnoseWebHeroAssetDecisions(data.webPageAssetDecisions).ok;
}

function hasGeneratedWebPageAssetDecisionEvidence(data: Record<string, unknown>): boolean {
  const decisions = parseMaybeJsonRecord(data.webPageAssetDecisions);
  const generated = decisions.generatedAssets;
  if (Array.isArray(generated) && generated.length > 0) return true;
  return false;
}

function hasBoundGeneratedWebPageAssetDecision(
	graph: FlowGraphRecord,
	nodeId: string,
	data: Record<string, unknown>,
): boolean {
	const decisions = parseMaybeJsonRecord(data.webPageAssetDecisions);
	const generated = decisions.generatedAssets;
	if (!Array.isArray(generated) || generated.length < 1) return false;
	const requirements = getAssetRequirementRecords(data);
	return generated.every((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return false;
		const decision = item as Record<string, unknown>;
		const assetId = assetRecordId(decision);
		const slotId = readTrimmedString(decision.slotId);
		if (!assetId || !slotId) return false;
		if (!requirements.some((requirement) =>
			assetRecordId(requirement) === assetId && readTrimmedString(requirement.slotId) === slotId
		)) return false;
		const generatedNodeId = readTrimmedString(decision.generatedNodeId) || readTrimmedString(decision.sourceNodeId);
		if (!generatedNodeId) return false;
		return (graph.nodes || []).some((node) => {
			if (flowNodeId(node) !== generatedNodeId) return false;
			const nodeData = flowNodeData(node);
			if (readTrimmedString(nodeData.webPageAssetSlotId) !== slotId) return false;
			const source = normalizeToken(
				nodeData.webPageAssetSource || nodeData.source || nodeData.sourceType,
			);
			if (!["generated", "image_generation", "text_to_image", "model_generated"].includes(source)) {
				return false;
			}
			return isSuccessfulCanvasImageAssetData(nodeData, nodeId, assetId);
		});
	});
}

function hasComponentReferenceEvidence(data: Record<string, unknown>, brief: Record<string, unknown>): boolean {
  if (hasNonEmptyRecordOrArray(data.componentReferencePlan)) return true;
  if (hasNonEmptyRecordOrArray(brief.componentReferencePlan)) return true;
  const direct = parseMaybeJsonRecord(data.componentReferencePlan);
  const nested = parseMaybeJsonRecord(brief.componentReferencePlan);
  const candidates = [direct, nested];
  return candidates.some((record) => {
    if (!Object.keys(record).length) return false;
    if (hasNonEmptyRecordOrArray(record.searchRecords)) return true;
    if (hasNonEmptyRecordOrArray(record.retrievalRecords)) return true;
    if (hasNonEmptyRecordOrArray(record.sectionDecisions)) return true;
    if (hasNonEmptyRecordOrArray(record.approvedPreviewNodes)) return true;
    if (hasNonEmptyRecordOrArray(record.decisions)) return true;
    if (hasNonEmptyRecordOrArray(record.sections)) return true;
    if (hasNonEmptyRecordOrArray(record.sectionReferenceDecisions)) return true;
    if (hasNonEmptyRecordOrArray(record.perSectionDecisions)) return true;
    if (hasNonEmptyRecordOrArray(record.sectionPlan)) return true;
    if (hasNonEmptyRecordOrArray(record.componentRecords)) return true;
    if (hasNonEmptyRecordOrArray(record.records)) return true;
    return readTrimmedString(record.decision) === "write_from_scratch";
  });
}

function hasSelectedStyleReferenceEvidence(data: Record<string, unknown>): boolean {
	return Boolean(readSelectedWebHeroStyleReference(data));
}

function buildWebHeroEvidenceReport(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
): WebHeroEvidenceReport {
  const brief = parseMaybeJsonRecord(data.webPageImplementationBrief);
  const assetInventoryMissing: string[] = [];
  const assetResolutionMissing: string[] = [];
  const sectionDraftMissing: string[] = [];
	const previewReadinessMissing = webHeroPreviewReadinessMissing(graph, nodeId);
	const hasRequiredPreviews = previewReadinessMissing.length === 0;
	const approvedPreviewNodeIds = readApprovedWebHeroPreviewNodeIds(graph, nodeId);
  const isLegacyNoPreviewWorkflow = isLegacyWebHeroWithoutPreviewWorkflow(graph, nodeId, data);

  if (!hasRequiredPreviews) {
		assetInventoryMissing.push(...previewReadinessMissing);
  }

  if (!readTrimmedString(data.webPageReferencePrompt)) assetInventoryMissing.push("webPageReferencePrompt");
  if (!diagnoseWebHeroImplementationBrief(data.webPageImplementationBrief).ok) assetInventoryMissing.push("webPageImplementationBrief");
  if (!hasNonEmptyRecordOrArray(data.webPageAssetRequirements)) assetInventoryMissing.push("webPageAssetRequirements");
  if (!hasVisibleSubjectInventory(data)) assetInventoryMissing.push("visibleSubjectInventory");
	const visualSlotInventoryIssues = flatVisualSlotInventoryIssues(data, approvedPreviewNodeIds);
  if (visualSlotInventoryIssues.length > 0) {
    assetInventoryMissing.push("webPageAssetRequirements.visualSlots flat pre-code inventory");
    assetInventoryMissing.push(...visualSlotInventoryIssues);
  }

  if (!hasPreviewVisualSpecsForEveryPreview(graph, nodeId, data)) {
    assetInventoryMissing.push("webPagePreviewVisualSpecs for every approved preview");
  }

  const visualSpeclessImageSlots = imageAssetSlotsMissingPreviewVisualSpecEvidence(data);
  if (visualSpeclessImageSlots.length > 0) {
    assetInventoryMissing.push(
      `image_asset visualSlots must include visualSpecId/sourceEvidence: ${visualSpeclessImageSlots.join(", ")}`,
    );
  }

  const fontPlan = hasNonEmptyRecordOrArray(data.fontPlan) || hasNonEmptyRecordOrArray(brief.fontPlan);
  if (!fontPlan) assetInventoryMissing.push("fontPlan");

  const previewDetailChecklist =
    hasNonEmptyRecordOrArray(data.previewDetailChecklist) ||
    hasNonEmptyRecordOrArray(brief.previewDetailChecklist);
  if (!previewDetailChecklist) assetInventoryMissing.push("previewDetailChecklist");

  if (!hasComponentReferenceEvidence(data, brief)) assetInventoryMissing.push("componentReferencePlan");

  if (!hasPreviewLevelAssetSlots(graph, nodeId, data)) {
    assetInventoryMissing.push("webPageAssetRequirements.visualSlots for every approved preview");
  }

  if (!hasWebHeroAssetDecisions(data)) {
    assetInventoryMissing.push("webPageAssetDecisions sections: icons, searchAssets, generatedAssets, fontPlan, stylePlan");
  }

  assetResolutionMissing.push(...assetInventoryMissing);

  const imageAssetRequirementIds = getImageAssetRequirementRecords(data)
	.map(assetRecordId)
	.filter(Boolean);
  const hasResolvedAssetLedger = imageAssetRequirementIds.every((assetId) =>
	hasUsableWebHeroResolvedAssetReference(graph, nodeId, data.webPageResolvedAssets, assetId)
  );
  if (imageAssetRequirementIds.length > 0 && !hasResolvedAssetLedger) {
    assetResolutionMissing.push("webPageResolvedAssets with browser-usable URLs or valid sourceNodeId references");
  }

  if (!hasGeneratedWebPageAssetDecisionEvidence(data)) {
    assetResolutionMissing.push("webPageAssetDecisions.generatedAssets with real webpage asset records");
	} else if (!hasBoundGeneratedWebPageAssetDecision(graph, nodeId, data)) {
		assetResolutionMissing.push(
			"webPageAssetDecisions.generatedAssets must bind a successful generated canvas asset node",
		);
  }

  const missingImageAssets = missingImageAssetEvidence(graph, nodeId, data);
  if (missingImageAssets.length > 0) {
    assetResolutionMissing.push(`resolved non-icon image assets: ${missingImageAssets.join(", ")}`);
  }

  const missingGeneratedCanvasAssets = missingGeneratedCanvasAssetNodes(graph, nodeId, data);
  if (missingGeneratedCanvasAssets.length > 0) {
    assetResolutionMissing.push(`generated canvas asset nodes: ${missingGeneratedCanvasAssets.join(", ")}`);
  }

  const previewBackedAssets = previewBackedResolvedImageAssets(graph, nodeId, data);
  if (previewBackedAssets.length > 0) {
    assetResolutionMissing.push(
      `resolved webpage image assets must not reuse approved preview screenshot URLs: ${previewBackedAssets.join(", ")}`,
    );
  }

  const proceduralNarrativeSlots = proceduralNarrativeImageSlots(data);
  if (proceduralNarrativeSlots.length > 0) {
    assetResolutionMissing.push(`preview-visible narrative image assets cannot be code_procedural: ${proceduralNarrativeSlots.join(", ")}`);
  }

  sectionDraftMissing.push(...missingSectionDraftEvidence(graph, nodeId, data));
  sectionDraftMissing.push(...missingSectionDraftFidelityEvidence(graph, nodeId, data));
  const hasSectionDrafts = sectionDraftMissing.length === 0;
  const goalContractMissing = goalContractMissingForReport(graph, nodeId, data);
	const hasStyleReference = hasSelectedStyleReferenceEvidence(data);

  return {
    hasRequiredPreviews,
		previewReadinessMissing,
    isLegacyNoPreviewWorkflow,
		hasStyleReference,
    hasSectionDrafts,
    goalContractMissing,
    assetInventoryMissing,
    assetResolutionMissing,
    sectionDraftMissing,
		finalCodeMissing: [
			...(!hasStyleReference ? ["webPageWorkflowContract.selectedStyleReference canonical object"] : []),
			...goalContractMissing,
			...assetResolutionMissing,
			...sectionDraftMissing,
		],
  };
}

function goalContractMissingForReport(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
): string[] {
  if (isLegacyWebHeroWithoutPreviewWorkflow(graph, nodeId, data)) return [];
  return webHeroGoalContractIssues(data);
}

function stepGateMissingForGoalStep(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
  step: WebHeroGoalStep,
): string[] {
  const report = buildWebHeroEvidenceReport(graph, nodeId, data);
  if (report.isLegacyNoPreviewWorkflow) return [];
  const missing: string[] = [];
  if (step !== "style_reference_selection") missing.push(...report.goalContractMissing);
  if (webHeroGoalStepIndex(step) >= webHeroGoalStepIndex("preview_generation") && !report.hasStyleReference) {
		missing.push("webPageWorkflowContract.selectedStyleReference canonical object");
  }
  if (webHeroGoalStepIndex(step) >= webHeroGoalStepIndex("preview_visual_spec")) {
		missing.push(...report.previewReadinessMissing);
  }
  if (webHeroGoalStepIndex(step) >= webHeroGoalStepIndex("asset_inventory")) {
    const specMissing = report.assetInventoryMissing.filter((item) =>
      item.includes("webPagePreviewVisualSpecs") ||
      item.includes("visualSpecId/sourceEvidence")
    );
    missing.push(...specMissing);
  }
  if (webHeroGoalStepIndex(step) >= webHeroGoalStepIndex("asset_resolution")) {
    missing.push(...report.assetInventoryMissing);
  }
  if (webHeroGoalStepIndex(step) >= webHeroGoalStepIndex("section_codegen")) {
    missing.push(...report.assetResolutionMissing);
  }
  if (webHeroGoalStepIndex(step) >= webHeroGoalStepIndex("merge_codegen")) {
    missing.push(...report.sectionDraftMissing);
  }
  return Array.from(new Set(missing));
}

export function assertWebHeroReadyForFinalCode(graph: FlowGraphRecord, nodeId: string): void {
  const target = findFlowNodeById(graph, nodeId);
  if (!target) {
    throw new AppError("Target webHero node not found in flow graph", {
      status: 404,
      code: "webhero_final_code_gate_required",
      details: { nodeId, missing: ["target webHero node"] },
    });
  }
  const data = flowNodeData(target);
	if (!isWebHeroNodeData(data)) {
		throw new AppError("WebHero final code target must have kind=webHero", {
			status: 409,
			code: "webhero_final_code_gate_required",
			details: { nodeId, missing: ["target node kind must be webHero"] },
		});
	}
  const report = buildWebHeroEvidenceReport(graph, nodeId, data);
  if (report.finalCodeMissing.length === 0) return;
  throw new AppError("WebHero final code gate requires persisted preview-first evidence", {
    status: 409,
    code: "webhero_final_code_gate_required",
    details: {
      nodeId,
      missing: report.finalCodeMissing,
      requiredNextStep:
        "Complete asset_inventory and asset_resolution, persist one screenshot-to-code draft per approved preview into webPageSectionDrafts, then retry staging final code.",
    },
  });
}

function mergePatchNodeDataForValidation(
  existing: Record<string, unknown>,
  item: NonNullable<FlowPatchLike["patchNodeData"]>[number],
  allowOverwrite: boolean,
): Record<string, unknown> {
  return mergePublicFlowNodeData({
    existing,
    patch: item.data || {},
    allowOverwrite,
    strategy: item.mergeStrategy ?? "skip-equal",
    nodeId: item.id,
    ...(item.webHeroRewindFromPhase
      ? { webHeroRewindFromPhase: item.webHeroRewindFromPhase }
      : {}),
  });
}

function graphWithPatchedNodeData(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
): FlowGraphRecord {
  return {
    ...graph,
    nodes: (graph.nodes || []).map((node) => {
      if (flowNodeId(node) !== nodeId || !node || typeof node !== "object" || Array.isArray(node)) return node;
      return {
        ...(node as Record<string, unknown>),
        data,
      };
    }),
  };
}

type ProspectivePatchNodeState = {
  item: NonNullable<FlowPatchLike["patchNodeData"]>[number];
  existingData: Record<string, unknown>;
  nextData: Record<string, unknown>;
  graphBefore: FlowGraphRecord;
  graphAfter: FlowGraphRecord;
  wasCreated: boolean;
  wasWebHeroAtRequestStart: boolean;
};

function stateWritesWebHeroFinalCode(state: ProspectivePatchNodeState): boolean {
  const data = state.item.data || {};
  if (["webHeroHtml", "webHeroCss", "webHeroDocumentHtml"].some((field) =>
    Object.prototype.hasOwnProperty.call(data, field)
  )) {
    return true;
  }
  const writesLegacy = ["html", "css", "documentHtml"].some((field) =>
    Object.prototype.hasOwnProperty.call(data, field)
  );
  return writesLegacy && (state.wasWebHeroAtRequestStart || isWebHeroNodeData(state.nextData));
}

function buildProspectivePatchNodeStates(
  graph: FlowGraphRecord,
  patch: FlowPatchLike,
): ProspectivePatchNodeState[] {
  let currentGraph: FlowGraphRecord = {
    ...graph,
    nodes: [...(graph.nodes || [])],
  };
  const originalWebHeroNodeIds = new Set(
    (graph.nodes || [])
      .filter((node) => isWebHeroNodeData(flowNodeData(node)))
      .map(flowNodeId)
      .filter(Boolean),
  );
  const deleteNodeIds = new Set((patch.deleteNodeIds || []).map(readTrimmedString).filter(Boolean));
  if (deleteNodeIds.size > 0) {
    currentGraph = {
      ...currentGraph,
      nodes: (currentGraph.nodes || []).filter((node) => !deleteNodeIds.has(flowNodeId(node))),
    };
  }
  const createdNodeIds = new Set<string>();
  for (const [index, node] of (patch.createNodes || []).entries()) {
    const nodeId = readTrimmedString(node.id);
    let validationNodeId = nodeId;
    if (!validationNodeId || findFlowNodeById(currentGraph, validationNodeId)) {
      validationNodeId = `__prospective_create_${index}`;
      while (findFlowNodeById(currentGraph, validationNodeId)) {
        validationNodeId = `${validationNodeId}_next`;
      }
    }
    const validationNode = { ...node, id: validationNodeId };
    currentGraph = {
      ...currentGraph,
      nodes: [...(currentGraph.nodes || []), validationNode],
    };
    if (nodeId && validationNodeId === nodeId) createdNodeIds.add(nodeId);
  }

  const states: ProspectivePatchNodeState[] = [];
  for (const item of patch.patchNodeData || []) {
    const graphBefore = currentGraph;
    const target = findFlowNodeById(graphBefore, item.id);
    const existingData = flowNodeData(target);
    const nextData = mergePatchNodeDataForValidation(
      existingData,
      item,
      patch.allowOverwrite === true,
    );
    const graphAfter = target
      ? graphWithPatchedNodeData(graphBefore, item.id, nextData)
      : graphBefore;
    states.push({
      item,
      existingData,
      nextData,
      graphBefore,
      graphAfter,
      wasCreated: createdNodeIds.has(item.id),
      wasWebHeroAtRequestStart: originalWebHeroNodeIds.has(item.id),
    });
    currentGraph = graphAfter;
  }
  return states;
}

function assertWebHeroCreationDoesNotWriteFinalCode(patch: FlowPatchLike): void {
  for (const node of patch.createNodes || []) {
    const data = node.data || {};
    if (!isWebHeroNodeData(data) || !dataWritesWebHeroFinalCode(data)) continue;
    throw new AppError("WebHero final code cannot be written during node creation", {
      status: 409,
      code: "webhero_final_code_creation_forbidden",
      details: {
        nodeId: readTrimmedString(node.id) || null,
        requiredNextStep:
          "Create the WebHero node without final code, complete preview-first evidence, then use staged code commit.",
      },
    });
  }
}

function assertWebHeroTransitionDoesNotWriteFinalCode(state: ProspectivePatchNodeState): void {
  if (
    !dataWritesWebHeroFinalCode(state.item.data || {})
    || (state.wasWebHeroAtRequestStart && !state.wasCreated)
    || !isWebHeroNodeData(state.nextData)
  ) {
    return;
  }
  throw new AppError("WebHero final code cannot be written while creating or converting a node", {
    status: 409,
    code: "webhero_final_code_creation_forbidden",
    details: {
      nodeId: state.item.id,
      requiredNextStep:
        "Create or convert the WebHero node without final code, complete preview-first evidence, then use staged code commit.",
    },
  });
}

function webHeroCompletionRequested(data: Record<string, unknown>): boolean {
  const contract = parseMaybeJsonRecord(data.webPageWorkflowContract);
  const stepStatus = parseMaybeJsonRecord(contract.stepStatus);
  const goal = parseMaybeJsonRecord(data.webHeroGoalContract);
  return (
    normalizeWebHeroGoalStep(goal.currentStep) === "completed" ||
    readTrimmedString(contract.currentStep).toLowerCase() === "completed" ||
    readTrimmedString(stepStatus.final_code).toLowerCase() === "completed" ||
    readTrimmedString(stepStatus.finalCode).toLowerCase() === "completed" ||
    readTrimmedString(stepStatus.webhero_code).toLowerCase() === "completed"
  );
}

function webHeroWorkflowStepCompletedRequested(data: Record<string, unknown>, stepName: string): boolean {
  const contract = parseMaybeJsonRecord(data.webPageWorkflowContract);
  const stepStatus = parseMaybeJsonRecord(contract.stepStatus);
  return readTrimmedString(stepStatus[stepName]).toLowerCase() === "completed";
}

function webHeroWorkflowCurrentStep(data: Record<string, unknown>): string {
  const contract = parseMaybeJsonRecord(data.webPageWorkflowContract);
  return readTrimmedString(contract.currentStep).toLowerCase();
}

function webHeroGoalStepPatchRequested(data: Record<string, unknown>): WebHeroGoalStep | "" {
  const goal = parseMaybeJsonRecord(data.webHeroGoalContract);
  const direct = normalizeWebHeroGoalStep(goal.currentStep);
  if (direct) return direct;
  return normalizeWebHeroGoalStep(webHeroWorkflowCurrentStep(data));
}

function webHeroAssetInventoryGateRequested(data: Record<string, unknown>): boolean {
  const currentStep = webHeroWorkflowCurrentStep(data);
  return (
    webHeroWorkflowStepCompletedRequested(data, "asset_inventory") ||
    webHeroWorkflowStepCompletedRequested(data, "asset_inventory_planning") ||
    currentStep === "asset_resolution" ||
    currentStep === "asset_resolution_planning" ||
    currentStep === "asset_resolution_generation" ||
    currentStep === "final_code" ||
    currentStep === "final_codegen" ||
    currentStep === "codegen"
  );
}

function webHeroAssetResolutionGateRequested(data: Record<string, unknown>): boolean {
  const currentStep = webHeroWorkflowCurrentStep(data);
  return (
    webHeroWorkflowStepCompletedRequested(data, "asset_resolution") ||
    webHeroWorkflowStepCompletedRequested(data, "asset_resolution_generation") ||
    currentStep === "final_code" ||
    currentStep === "final_codegen" ||
    currentStep === "codegen"
  );
}

function isWebHeroNodeData(data: Record<string, unknown>): boolean {
  return readTrimmedString(data.kind) === "webHero";
}

function assertWebHeroCompletionHasFinalCode(
	nodeId: string,
	data: Record<string, unknown>,
	graph: FlowGraphRecord,
): void {
  try {
    assertWebHeroFinalCodePayloadUsable(data, { requireComplete: true });
	const workflow = parseMaybeJsonRecord(data.webPageWorkflowContract);
	const approvedPreviewNodeIds = Array.isArray(workflow.approvedPreviewNodes)
	  ? workflow.approvedPreviewNodes.map(readTrimmedString).filter(Boolean).sort()
	  : [];
	const styleReferenceUrls = readSelectedWebHeroStyleReference(data)?.referenceUrls.slice().sort() || [];
	const evidence = parseMaybeJsonRecord(data.webHeroCodeEvidence);
	const evidencePreviewNodeIds = Array.isArray(evidence.previewNodeIds)
	  ? evidence.previewNodeIds.map(readTrimmedString).filter(Boolean).sort()
	  : [];
	const evidenceStyleReferenceUrls = Array.isArray(evidence.styleReferenceUrls)
	  ? evidence.styleReferenceUrls.map(readTrimmedString).filter(Boolean).sort()
	  : [];
	if (
	  data.webHeroFinalCodeStale !== false ||
	  evidence.version !== 2 ||
	  readTrimmedString(evidence.sessionId) !== readTrimmedString(data.webHeroCodeSessionId) ||
	  !/^sha256:[a-f0-9]{64}$/.test(readTrimmedString(evidence.codeInputDigest)) ||
	  readTrimmedString(evidence.codeInputDigest) !== computeWebHeroCodeInputDigest(graph, nodeId) ||
	  approvedPreviewNodeIds.length < requiredWebHeroPreviewCount() ||
	  JSON.stringify(evidencePreviewNodeIds) !== JSON.stringify(approvedPreviewNodeIds) ||
	  styleReferenceUrls.length < 1 ||
	  JSON.stringify(evidenceStyleReferenceUrls) !== JSON.stringify(styleReferenceUrls)
	) {
	  throw new AppError("WebHero final code provenance is stale or does not match the current evidence", {
		status: 409,
		code: "webhero_final_code_evidence_stale",
		details: { nodeId },
	  });
	}
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError("WebHero cannot be marked completed before final code is committed", {
        status: 409,
        code: "webhero_final_code_completion_requires_code",
        details: {
          nodeId,
          originalCode: error.code,
          originalDetails: error.details,
          requiredNextStep:
            "Stage real webHeroHtml and webHeroCss through canvas_webhero_code_stage_raw_chunk, then call canvas_webhero_code_commit so the server derives webHeroDocumentHtml before final-code completion.",
        },
      });
    }
    throw error;
  }
}

function assertWebHeroCompletionPatchAllowed(
  graph: FlowGraphRecord,
  patch: FlowPatchLike,
): void {
  for (const state of buildProspectivePatchNodeStates(graph, patch)) {
    const { item, nextData } = state;
    const patchData = item.data || {};
    if (!webHeroCompletionRequested(patchData)) continue;

    if (!isWebHeroNodeData(nextData)) continue;
    if (!webHeroCompletionRequested(nextData)) continue;

	assertWebHeroCompletionHasFinalCode(item.id, nextData, state.graphAfter);
  }
}

function collectAssetInventoryMissing(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
): string[] {
  return buildWebHeroEvidenceReport(graph, nodeId, data).assetInventoryMissing;
}

function collectAssetResolutionMissing(
  graph: FlowGraphRecord,
  nodeId: string,
  data: Record<string, unknown>,
): string[] {
  return buildWebHeroEvidenceReport(graph, nodeId, data).assetResolutionMissing;
}

function assertWebHeroWorkflowStepPatchAllowed(
  graph: FlowGraphRecord,
  patch: FlowPatchLike,
): void {
  for (const state of buildProspectivePatchNodeStates(graph, patch)) {
    const { item, existingData, nextData, graphBefore, graphAfter } = state;
    const patchData = item.data || {};
    if (!isWebHeroNodeData(nextData)) continue;

    const requestedGoalStep = webHeroGoalStepPatchRequested(patchData);
    if (requestedGoalStep && !isLegacyWebHeroWithoutPreviewWorkflow(graphBefore, item.id, existingData)) {
      const missing = stepGateMissingForGoalStep(graphAfter, item.id, nextData, requestedGoalStep);
      if (missing.length > 0) {
        throw new AppError("WebHero goal contract cannot advance before prerequisite evidence is persisted", {
          status: 409,
          code: "webhero_goal_contract_step_gate_required",
          details: {
            nodeId: item.id,
            requestedStep: requestedGoalStep,
            missing,
            requiredNextStep:
				"Persist every item listed in details.missing, then retry this currentStep transition. Continue from webHeroGoalContract.currentStep and do not rerun completed stages.",
          },
        });
      }
    }

    if (webHeroAssetInventoryGateRequested(patchData)) {
      const missing = collectAssetInventoryMissing(graphAfter, item.id, nextData);
      if (missing.length > 0) {
        throw new AppError("WebHero asset_inventory cannot be marked complete before exact top-level asset evidence is persisted", {
          status: 409,
          code: "webhero_asset_inventory_gate_required",
          details: {
            nodeId: item.id,
            missing,
            requiredNextStep:
              "Persist webPageReferencePrompt, webPageImplementationBrief, fontPlan, previewDetailChecklist, componentReferencePlan, visibleSubjectInventory, webPageAssetRequirements.visualSlots, and webPageAssetDecisions on the target WebHero node top-level before setting asset_inventory completed or moving to asset_resolution/final_code.",
          },
        });
      }
    }

    if (webHeroAssetResolutionGateRequested(patchData)) {
      const missing = collectAssetResolutionMissing(graphAfter, item.id, nextData);
      if (missing.length > 0) {
        throw new AppError("WebHero asset_resolution cannot be marked complete before real webpage assets are resolved", {
          status: 409,
          code: "webhero_asset_resolution_gate_required",
          details: {
            nodeId: item.id,
            missing,
            requiredNextStep:
              "Resolve every image_asset slot through search or generated canvas asset nodes, persist webPageResolvedAssets and webPageAssetDecisions.generatedAssets with real webpage asset records, and do not reuse approved preview screenshot URLs as final webpage assets.",
          },
        });
      }
    }
  }
}

function stripHtmlTags(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEmptyMainOnlyDocument(value: string): boolean {
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  return normalized.includes("<main></main>") && !normalized.includes("<section");
}

export function assertWebHeroFinalCodePayloadUsable(
  data: Record<string, unknown>,
  options: WebHeroFinalCodeValidationOptions = {},
): void {
  const html = readTrimmedString(data.webHeroHtml ?? data.html);
  const css = readTrimmedString(data.webHeroCss ?? data.css);
  const documentHtml = readTrimmedString(data.webHeroDocumentHtml ?? data.documentHtml);
  const provided = {
    webHeroHtml: html.length > 0,
    webHeroCss: css.length > 0,
    webHeroDocumentHtml: documentHtml.length > 0,
  };

  if (options.requireComplete) {
    const missing = Object.entries(provided)
      .filter(([, hasValue]) => !hasValue)
      .map(([field]) => field);
    if (missing.length > 0) {
      throw new AppError("WebHero final code commit requires html, css, and documentHtml", {
        status: 400,
        code: "webhero_final_code_incomplete",
        details: { missing },
      });
    }
  }

  const tooSmall: string[] = [];
  if (provided.webHeroHtml && stripHtmlTags(html).length < 40) tooSmall.push("webHeroHtml");
  if (provided.webHeroCss && css.replace(/\s+/g, "").length < 80) tooSmall.push("webHeroCss");
  if (
    provided.webHeroDocumentHtml &&
    (
      documentHtml.length < 240 ||
      stripHtmlTags(documentHtml).length < 40 ||
      isEmptyMainOnlyDocument(documentHtml) ||
      !/<body\b/i.test(documentHtml) ||
      !/<\/body>/i.test(documentHtml)
    )
  ) {
    tooSmall.push("webHeroDocumentHtml");
  }

  if (tooSmall.length > 0) {
    throw new AppError("WebHero final code is too empty to commit", {
      status: 400,
      code: "webhero_final_code_empty",
      details: {
        fields: tooSmall,
        lengths: {
          webHeroHtml: html.length,
          webHeroCss: css.length,
          webHeroDocumentHtml: documentHtml.length,
          documentTextLength: stripHtmlTags(documentHtml).length,
        },
      },
    });
  }
}

export function checkWebHeroReadiness(
  graph: FlowGraphRecord,
  nodeId: string,
  options?: { force?: boolean },
): {
  ready: boolean;
  stepStatus: Record<string, string>;
  missing: string[];
  previewNodeCount: number;
  previewNodeIds: string[];
	codeInputDigest: string;
  detail: string;
} {
  const previewNodes = findWebHeroPreviewNodes(graph, nodeId);
  const previewNodeIds = readApprovedWebHeroPreviewNodeIds(graph, nodeId).slice().sort();
	const codeInputDigest = computeWebHeroCodeInputDigest(graph, nodeId);
  if (options?.force === true) {
    return {
      ready: false,
      stepStatus: {
        style_reference_selection: 'unknown',
        preview_generation: 'unknown',
        asset_inventory: 'unknown',
        asset_resolution: 'unknown',
        final_code: 'blocked',
      },
      missing: ['force bypass is disabled for WebHero final code readiness'],
      previewNodeCount: previewNodes.length,
      previewNodeIds,
	  codeInputDigest,
      detail: 'Force bypass is disabled. Run readiness without force to inspect missing evidence; code staging should proceed through the staged WebHero code tools once preview media and resolved asset evidence are otherwise present.',
    };
  }
  const previewNodeCount = previewNodes.length;
  const target = findFlowNodeById(graph, nodeId);
  if (!target) {
    return {
      ready: false,
      stepStatus: {},
      missing: ['Target webHero node not found in flow graph'],
      previewNodeCount,
      previewNodeIds,
	  codeInputDigest,
      detail: 'Node not found.',
    };
  }
	if (!isWebHeroNodeData(flowNodeData(target))) {
		return {
			ready: false,
			stepStatus: {},
			missing: ["target node kind must be webHero"],
			previewNodeCount,
			previewNodeIds,
			codeInputDigest,
			detail: "Target node is not a WebHero node.",
		};
	}

  const data = flowNodeData(target);
  const report = buildWebHeroEvidenceReport(graph, nodeId, data);
  const missing: string[] = [];
  const stepStatus: Record<string, string> = {};

  // Step 1: style_reference_selection
  stepStatus.style_reference_selection = report.hasStyleReference ? 'completed' : 'pending';
	if (!report.hasStyleReference) {
		missing.push('[Step 1/5] webPageWorkflowContract.selectedStyleReference — run style_reference_selection first');
	}

  // Step 2: preview_generation
  stepStatus.preview_generation = report.hasRequiredPreviews ? 'completed' : 'pending';
  if (!report.hasRequiredPreviews) {
		missing.push(...report.previewReadinessMissing);
  }

  // Step 3: asset_inventory checks
  const step3Done = report.assetInventoryMissing.length === 0;
  stepStatus.asset_inventory = step3Done ? 'completed' : 'pending';
	for (const item of report.assetInventoryMissing) {
		if (!missing.includes(item)) missing.push(item);
	}

  // Step 4: asset_resolution checks
  const step4Done = report.hasRequiredPreviews && report.assetResolutionMissing.length === 0;
  stepStatus.asset_resolution = step4Done ? 'completed' : 'pending';
  for (const item of report.assetResolutionMissing) {
    if (!missing.includes(item)) missing.push(item);
  }

  const step5DraftsDone = step4Done && report.sectionDraftMissing.length === 0;
  stepStatus.goal_contract = report.goalContractMissing.length === 0 ? 'completed' : 'pending';
  for (const item of report.goalContractMissing) {
    if (!missing.includes(item)) missing.push(item);
  }

	stepStatus.final_code = report.hasStyleReference && step5DraftsDone && report.goalContractMissing.length === 0
		? 'ready'
		: 'blocked';
  for (const item of report.sectionDraftMissing) {
    if (!missing.includes(item)) missing.push(item);
  }

  // Step 5: final_code
	const ready = report.hasStyleReference && step5DraftsDone && report.goalContractMissing.length === 0;

  const detail = ready
    ? 'Diagnostic checks passed. webHeroGoalContract and persisted section drafts were found. BEFORE staging final code, you MUST call canvas_read_node_media_for_context with nodeIds=[<targetNodeId>] so the approved preview screenshots and resolved asset images are loaded as multimodal evidence; then assemble final code strictly from webPageSectionDrafts and proceed to canvas_webhero_code_stage_raw_chunk + canvas_webhero_code_commit.'
    : `Missing ${missing.length} item(s):
${missing.map((m, i) => '  ' + (i + 1) + '. ' + m).join('\n')}
Use canvas_update_node_data to persist the exact target WebHero node fields named above, canvas_image_generate_to_canvas for unresolved asset slots, normalize webHeroGoalContract, and write screenshot-to-code drafts to targetNode.data.webPageSectionDrafts before merge. Readiness is a hard final-code precondition: do not stage or patch final code until this check returns ready=true. Evidence in text nodes, workflow-contract aliases, grouped visualSlots, flatPreCodeInventory aliases, implementation-brief-only copies, or ephemeral section JSON in chat is not accepted as a substitute for targetNode.data.webPageAssetRequirements.visualSlots, targetNode.data.webHeroGoalContract, and targetNode.data.webPageSectionDrafts.`;

  return { ready, stepStatus, missing, previewNodeCount, previewNodeIds, codeInputDigest, detail };
}

export function assertWebHeroFinalCodePatchAllowed(
  graph: FlowGraphRecord,
  patch: FlowPatchLike,
  source: WebHeroFinalCodeMutationSource,
): void {
  assertWebHeroCreationDoesNotWriteFinalCode(patch);
  assertWebHeroWorkflowStepPatchAllowed(graph, patch);
  assertWebHeroCompletionPatchAllowed(graph, patch);

  const prospectiveStates = buildProspectivePatchNodeStates(graph, patch);
  for (const state of prospectiveStates) {
    if (!stateWritesWebHeroFinalCode(state)) continue;
    assertWebHeroTransitionDoesNotWriteFinalCode(state);
  }
  assertWebHeroFinalCodeMutationSource(patch, source, narrowWebHeroPolicyGraph(graph));
	if (source === "webhero_transition") return;

  for (const state of prospectiveStates) {
    const { item, nextData, graphAfter } = state;
    if (!stateWritesWebHeroFinalCode(state)) continue;
    assertWebHeroReadyForFinalCode(graphAfter, item.id);
    assertWebHeroFinalCodePayloadUsable(item.data || {}, { requireComplete: true });
    assertWebHeroFinalCodeReferencesAllowed(graphAfter, item.id, nextData);
  }
}
