import { createHash } from "node:crypto";
import type { ToolHandler } from "./registry.js";
import {
  diagnoseWebHeroAssetDecisions,
  diagnoseWebHeroAssetRequirements,
  diagnoseWebHeroImplementationBrief,
  diagnoseWebHeroSectionDraft,
} from "../../contracts/webhero-evidence-contract.js";

type RecordValue = Record<string, unknown>;

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

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToken(value: unknown): string {
  return readString(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
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

function asRecordArray(value: unknown): RecordValue[] {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isRecord);
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

function nodeId(node: unknown): string {
  return isRecord(node) ? readString(node.id) : "";
}

function nodeData(node: unknown): RecordValue {
  return isRecord(node) && isRecord(node.data) ? node.data : {};
}

function graphNodes(value: unknown): RecordValue[] {
  const parsed = parseMaybeJson(value);
  if (isRecord(parsed) && isRecord(parsed.data) && Array.isArray(parsed.data.nodes)) {
    return parsed.data.nodes.filter(isRecord);
  }
  if (isRecord(parsed) && Array.isArray(parsed.nodes)) {
    return parsed.nodes.filter(isRecord);
  }
  return [];
}

function findTargetData(input: {
  targetNodeId: string;
  flow: unknown;
  targetNodeData: unknown;
}): RecordValue {
  const direct = parseMaybeJson(input.targetNodeData);
  if (isRecord(direct)) {
    if (isRecord(direct.data) && nodeId(direct) === input.targetNodeId) return direct.data;
    if (!Array.isArray(direct.nodes)) return direct;
  }
  for (const node of graphNodes(input.flow)) {
    if (nodeId(node) === input.targetNodeId) return nodeData(node);
  }
  return {};
}

function readWorkflow(data: RecordValue): RecordValue {
  const parsed = parseMaybeJson(data.webPageWorkflowContract);
  return isRecord(parsed) ? parsed : {};
}

function readGoalContract(data: RecordValue): RecordValue {
  const parsed = parseMaybeJson(data.webHeroGoalContract);
  return isRecord(parsed) ? parsed : {};
}

function readStepStatus(data: RecordValue): RecordValue {
  const status = readWorkflow(data).stepStatus;
  return isRecord(status) ? status : {};
}

function goalCurrentStep(data: RecordValue): WebHeroGoalStep | "" {
  const direct = normalizeWebHeroGoalStep(readGoalContract(data).currentStep);
  if (direct) return direct;
  return normalizeWebHeroGoalStep(readWorkflow(data).currentStep);
}

function buildGoalContract(input: {
  targetNodeId: string;
  data: RecordValue;
  currentStep: WebHeroGoalStep;
}): RecordValue {
  return {
    kind: "webHeroGoalContract",
    version: 1,
    targetWebHeroNodeId: input.targetNodeId,
    goal: readString(input.data.prompt) || readString(input.data.label) || "WebHero preview-first website workflow",
    currentStep: input.currentStep,
    steps: WEBHERO_GOAL_STEPS.map((step) => ({
      id: step,
      status:
        step === input.currentStep
          ? "in_progress"
          : webHeroGoalStepIndex(step) < webHeroGoalStepIndex(input.currentStep)
            ? "completed"
            : "pending",
    })),
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

function readApprovedPreviewIds(data: RecordValue): string[] {
  const workflow = readWorkflow(data);
  const raw = Array.isArray(workflow.approvedPreviewNodes)
    ? workflow.approvedPreviewNodes
    : [];
  return raw.map(readString).filter(Boolean);
}

function findGeneratedPreviewIds(flow: unknown, targetNodeId: string): string[] {
  const ids = new Set<string>();
  for (const node of graphNodes(flow)) {
    const id = nodeId(node);
    const d = nodeData(node);
    if (!id) continue;
    if (readString(d.webPreviewForNodeId) === targetNodeId) ids.add(id);
  }
  return Array.from(ids);
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as RecordValue)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJsonValue(item)]),
  );
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isIpv6 = host.includes(":");
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    || host.startsWith("127.") || host === "::1" || host.startsWith("10.")
    || host.startsWith("169.254.") || host.startsWith("0.") || host.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) || host.startsWith("::ffff:")
    || (isIpv6 && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")));
}

function canonicalStyleReferenceUrls(data: RecordValue): string[] {
  const selected = readWorkflow(data).selectedStyleReference;
  if (!isRecord(selected)) return [];
  const urls = [
    selected.vendorReferenceImageUrl,
    selected.originalImageUrl,
    selected.sourceImageUrl,
    selected.remoteImageUrl,
    selected.imageUrl,
    selected.thumbnailUrl,
  ].flatMap((candidate) => {
    const raw = readString(candidate);
    if (!raw) return [];
    try {
      const url = new URL(raw);
      return (url.protocol === "http:" || url.protocol === "https:") && !isLocalOrPrivateHost(url.hostname)
        ? [url.toString()]
        : [];
    } catch {
      return [];
    }
  });
  return Array.from(new Set(urls)).sort();
}

export function computeWebHeroCodeInputDigestForDebug(
  flow: unknown,
  targetNodeId: string,
  fallbackTargetData?: RecordValue,
): string {
  const nodes = graphNodes(flow);
  const targetData = nodes.find((node) => nodeId(node) === targetNodeId)
    ? nodeData(nodes.find((node) => nodeId(node) === targetNodeId))
    : fallbackTargetData || {};
  const workflow = readWorkflow(targetData);
  const previewNodeIds = Array.from(new Set(readApprovedPreviewIds(targetData))).sort();
  const previewEvidence = previewNodeIds.map((previewNodeId) => {
    const data = nodeData(nodes.find((node) => nodeId(node) === previewNodeId));
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
    nodeId: targetNodeId,
    selectedStyleReferenceUrls: canonicalStyleReferenceUrls(targetData),
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

function findAssetNodeIds(flow: unknown, targetNodeId: string): string[] {
  const ids: string[] = [];
  for (const node of graphNodes(flow)) {
    const id = nodeId(node);
    const d = nodeData(node);
    const status = readString(d.status).toLowerCase();
    if (
      id &&
      readString(d.webPageAssetForNodeId) === targetNodeId &&
      ["success", "succeeded"].includes(status)
    ) ids.push(id);
  }
  return ids;
}

function generatedAssetDecisionBindingIssues(
  flow: unknown,
  targetNodeId: string,
  data: RecordValue,
): string[] {
  const decisions = parseMaybeJson(data.webPageAssetDecisions);
  if (!isRecord(decisions) || !Array.isArray(decisions.generatedAssets)) return [];
  const nodes = graphNodes(flow);
  const visualSlots = readVisualSlots(data);
  const issues: string[] = [];
  decisions.generatedAssets.forEach((rawDecision, index) => {
    if (!isRecord(rawDecision)) {
      issues.push(`webPageAssetDecisions.generatedAssets[${index}] must be a record.`);
      return;
    }
    const assetId = readString(rawDecision.assetId);
    const slotId = readString(rawDecision.slotId);
    const sourceNodeId = readString(rawDecision.generatedNodeId) || readString(rawDecision.sourceNodeId);
    if (
      !assetId ||
      !slotId ||
      !sourceNodeId ||
      !visualSlots.some((slot) => slotAssetId(slot) === assetId && readString(slot.slotId) === slotId)
    ) {
      issues.push(`webPageAssetDecisions.generatedAssets[${index}] must bind an exact visualSlot assetId/slotId.`);
      return;
    }
    const sourceData = nodeData(nodes.find((node) => nodeId(node) === sourceNodeId));
    const status = readString(sourceData.status).toLowerCase();
    const source = readString(
      sourceData.webPageAssetSource || sourceData.source || sourceData.sourceType,
    ).toLowerCase();
    const hasOutputUrl = collectBrowserUrls(sourceData.imageUrl).length > 0 ||
      collectBrowserUrls(sourceData.imageResults).length > 0;
    if (
      readString(sourceData.webPageAssetForNodeId) !== targetNodeId ||
      readString(sourceData.webPageAssetId) !== assetId ||
      readString(sourceData.webPageAssetSlotId) !== slotId ||
      !["generated", "image_generation", "text_to_image", "model_generated"].includes(source) ||
      !["success", "succeeded"].includes(status) ||
      !hasOutputUrl
    ) {
      issues.push(`webPageAssetDecisions.generatedAssets[${index}] must bind successful generated asset node ${sourceNodeId} for ${assetId}/${slotId} with a browser-usable output URL.`);
    }
  });
  return issues;
}

function readVisualSlots(data: RecordValue): RecordValue[] {
  const requirements = parseMaybeJson(data.webPageAssetRequirements);
  if (Array.isArray(requirements)) return requirements.filter(isRecord);
  if (isRecord(requirements)) return asRecordArray(requirements.visualSlots);
  return [];
}

function readResolvedAssets(data: RecordValue): RecordValue[] {
  const resolved = parseMaybeJson(data.webPageResolvedAssets);
  if (Array.isArray(resolved)) return resolved.filter(isRecord);
  if (isRecord(resolved)) {
    const arrays = [resolved.assets, resolved.resolvedAssets, resolved.generatedAssets];
    return arrays.flatMap(asRecordArray);
  }
  return [];
}

function readPreviewVisualSpecs(data: RecordValue): RecordValue[] {
  const direct = parseMaybeJson(data.webPagePreviewVisualSpecs);
  if (Array.isArray(direct)) return direct.filter(isRecord);
  const brief = parseMaybeJson(data.webPageImplementationBrief);
  if (isRecord(brief)) {
    const candidates = [
      brief.previewVisualSpecs,
      brief.webPagePreviewVisualSpecs,
      brief.previewStructureArtifacts,
      brief.previewDetailChecklist,
    ];
    for (const candidate of candidates) {
      const specs = asRecordArray(candidate);
      if (specs.length) return specs;
    }
  }
  return [];
}

function readDrafts(data: RecordValue): RecordValue[] {
  return asRecordArray(data.webPageSectionDrafts);
}

function draftHtml(draft: RecordValue): string {
  return readString(draft.html) || readString(draft.htmlDraft) || readString(draft.markup);
}

function draftCss(draft: RecordValue): string {
  return readString(draft.css) || readString(draft.cssDraft) || readString(draft.styles);
}

function isUsableDraft(draft: RecordValue): boolean {
  return draft.blocked !== true && draftHtml(draft).length > 20 && draftCss(draft).length > 20;
}

function hasCanonicalDraftShape(draft: RecordValue): boolean {
  return readString(draft.html).length > 20 && readString(draft.css).length > 20;
}

function draftCoverageKeys(draft: RecordValue): string[] {
  return [
    readString(draft.previewNodeId) ? `preview:${readString(draft.previewNodeId)}` : "",
    readString(draft.sectionId) ? `section:${readString(draft.sectionId)}` : "",
    readString(draft.order) ? `order:${readString(draft.order)}` : "",
  ].filter(Boolean);
}

function previewCoveredByDrafts(previewIds: string[], drafts: RecordValue[]): boolean {
  if (previewIds.length < 1) return false;
  const coverage = new Set<string>();
  drafts.filter(isUsableDraft).forEach((draft) => draftCoverageKeys(draft).forEach((key) => coverage.add(key)));
  return previewIds.every((id, index) => coverage.has(`preview:${id}`) || coverage.has(`order:${index + 1}`));
}

function specCoverageKeys(record: RecordValue): string[] {
  return [
    readString(record.previewNodeId) ? `preview:${readString(record.previewNodeId)}` : "",
    readString(record.sourcePreviewNodeId) ? `preview:${readString(record.sourcePreviewNodeId)}` : "",
    readString(record.sectionId) ? `section:${readString(record.sectionId)}` : "",
    readString(record.order) ? `order:${readString(record.order)}` : "",
    readString(record.screenshotOrder) ? `order:${readString(record.screenshotOrder)}` : "",
  ].filter(Boolean);
}

function previewCoveredBySpecs(previewIds: string[], specs: RecordValue[]): boolean {
  if (previewIds.length < 1) return false;
  const coverage = new Set<string>();
  specs.forEach((spec) => specCoverageKeys(spec).forEach((key) => coverage.add(key)));
  return previewIds.every((id, index) => coverage.has(`preview:${id}`) || coverage.has(`order:${index + 1}`));
}

function slotHasPreviewBinding(slot: RecordValue): boolean {
  return Boolean(
    readString(slot.previewNodeId) ||
    readString(slot.sourcePreviewNodeId) ||
    readString(slot.webPreviewNodeId) ||
    readString(slot.previewId) ||
    readString(slot.sectionId) ||
    readString(slot.screenshotOrder),
  );
}

function slotHasVisualSpecBinding(slot: RecordValue): boolean {
  if (
    readString(slot.visualSpecId) ||
    readString(slot.sourceVisualSpecId) ||
    readString(slot.previewVisualSpecId) ||
    readString(slot.visualSpecSummary) ||
    readString(slot.previewVisualCue) ||
    readString(slot.derivedFromPreview)
  ) {
    return true;
  }
  const evidence = parseMaybeJson(slot.sourceEvidence);
  if (isRecord(evidence) || Array.isArray(evidence)) return true;
  return false;
}

function slotAssetId(slot: RecordValue): string {
  return (
    readString(slot.assetId) ||
    readString(slot.webPageAssetId) ||
    readString(slot.slotId) ||
    readString(slot.subjectId)
  );
}

function slotNeedsImageAsset(slot: RecordValue): boolean {
  const implementation = [slot.implementation, slot.decision]
    .map((value) => readString(value).toLowerCase())
    .join(" ");
  if (/\b(code_procedural|procedural_only|reference_only|html_css|css)\b/.test(implementation)) return false;
  const text = [
    slot.implementation,
    slot.decision,
    slot.renderMode,
    slot.type,
    slot.category,
    slot.description,
    slot.intendedWebUsage,
  ].map((value) => readString(value).toLowerCase()).join(" ");
  return /\b(generate|image_asset|generated_image|photo|product|device|hardware|display|screen|scene|lifestyle|portrait)\b/.test(text);
}

function collectBrowserUrls(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || typeof value === "undefined") return [];
  if (typeof value === "string") {
    if (value.trim().startsWith("data:image/")) return [value.trim()];
    try {
      const url = new URL(value.trim());
      return (url.protocol === "http:" || url.protocol === "https:") && !isLocalOrPrivateHost(url.hostname)
        ? [url.toString()]
        : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectBrowserUrls(item, depth + 1));
  if (!isRecord(value)) return [];
  return ["url", "imageUrl", "src", "outputUrl", "hostedUrl", "imageResults", "results", "images", "outputs"]
    .flatMap((key) => collectBrowserUrls(value[key], depth + 1));
}

function assetResolutionCoverageIssues(input: {
  flow: unknown;
  targetNodeId: string;
  visualSlots: RecordValue[];
  resolvedAssets: RecordValue[];
}): string[] {
  const nodes = graphNodes(input.flow);
  const previewUrls = new Set(
    nodes
      .filter((node) => readString(nodeData(node).webPreviewForNodeId) === input.targetNodeId)
      .flatMap((node) => collectBrowserUrls([
        nodeData(node).imageUrl,
        nodeData(node).imageResults,
      ])),
  );
  const issues: string[] = [];
  for (const slot of input.visualSlots.filter(slotNeedsImageAsset)) {
    const assetId = slotAssetId(slot);
    const slotId = readString(slot.slotId);
    const resolved = input.resolvedAssets.some((record) => {
      if (slotAssetId(record) !== assetId) return false;
      const urls = collectBrowserUrls(record);
      return urls.some((url) => !previewUrls.has(url));
    });
    const generatedNode = nodes.some((node) => {
      const data = nodeData(node);
      const status = readString(data.status).toLowerCase();
      const source = readString(data.webPageAssetSource || data.source || data.sourceType).toLowerCase();
      return readString(data.webPageAssetForNodeId) === input.targetNodeId &&
        readString(data.webPageAssetId) === assetId &&
        (!slotId || readString(data.webPageAssetSlotId) === slotId) &&
        ["generated", "image_generation", "text_to_image", "model_generated"].includes(source) &&
        ["success", "succeeded"].includes(status) &&
        (
          collectBrowserUrls(data.imageUrl).length > 0 ||
          collectBrowserUrls(data.imageResults).length > 0
        );
    });
    if (!resolved && !generatedNode) {
      issues.push(`image visualSlot ${slotId || assetId || "unknown"} has no resolved non-preview URL or successful matching asset node.`);
    }
  }
  return issues;
}

function assetInventoryIssues(previewIds: string[], visualSlots: RecordValue[], visualSpecs: RecordValue[]): string[] {
  const issues: string[] = [];
  if (!previewCoveredBySpecs(previewIds, visualSpecs)) {
    issues.push("webPagePreviewVisualSpecs must cover every approved preview before asset planning.");
  }
  visualSlots.forEach((slot, index) => {
    if (!slotHasPreviewBinding(slot)) issues.push(`visualSlots[${index}] lacks preview/section/order binding.`);
    if (slotNeedsImageAsset(slot) && !slotHasVisualSpecBinding(slot)) {
      issues.push(`visualSlots[${index}] image asset lacks visualSpecId/sourceEvidence binding.`);
    }
  });
  return issues;
}

function draftUsesPreviewAttr(draft: RecordValue): boolean {
  const previewNodeId = readString(draft.previewNodeId);
  if (!previewNodeId) return false;
  const html = draftHtml(draft);
  return html.includes(`data-preview-node-id="${previewNodeId}"`) ||
    html.includes(`data-preview-node-id='${previewNodeId}'`);
}

function draftUsesRequiredAssets(draft: RecordValue, visualSlots: RecordValue[]): boolean {
  const previewNodeId = readString(draft.previewNodeId);
  const sectionId = readString(draft.sectionId);
  const requiredAssetIds = visualSlots
    .filter(slotNeedsImageAsset)
    .filter((slot) => {
      const slotPreview = readString(slot.previewNodeId) || readString(slot.sourcePreviewNodeId);
      const slotSection = readString(slot.sectionId);
      return (previewNodeId && slotPreview === previewNodeId) || (sectionId && slotSection === sectionId);
    })
    .map(slotAssetId)
    .filter(Boolean);
  if (requiredAssetIds.length < 1) return true;
  const html = draftHtml(draft);
  const css = draftCss(draft);
  const usedIds = new Set<string>();
  asRecordArray(draft.usedAssetIds).forEach((record) => Object.values(record).forEach((value) => usedIds.add(readString(value))));
  if (Array.isArray(draft.usedAssetIds)) {
    draft.usedAssetIds.map(readString).filter(Boolean).forEach((id) => usedIds.add(id));
  }
  return requiredAssetIds.every((assetId) =>
    usedIds.has(assetId) || html.includes(assetId) || css.includes(assetId)
  );
}

function sectionDraftQualityIssues(previewIds: string[], drafts: RecordValue[], visualSlots: RecordValue[]): string[] {
  const issues: string[] = [];
  const usableDrafts = drafts.filter(isUsableDraft);
  for (const previewId of previewIds) {
    const draft = usableDrafts.find((candidate) => readString(candidate.previewNodeId) === previewId);
    if (!draft) {
      issues.push(`missing canonical draft for ${previewId}`);
      continue;
    }
    if (!draftUsesPreviewAttr(draft)) {
      issues.push(`draft for ${previewId} lacks data-preview-node-id binding`);
    }
    if (!draftUsesRequiredAssets(draft, visualSlots)) {
      issues.push(`draft for ${previewId} does not reference required image asset ids`);
    }
  }
  return issues;
}

function hasFinalCode(data: RecordValue, previewIds: string[], flow: unknown, targetNodeId: string): boolean {
  const html = readString(data.webHeroHtml);
  const css = readString(data.webHeroCss);
  const documentHtml = readString(data.webHeroDocumentHtml);
  const workflow = readWorkflow(data);
  const status = isRecord(workflow.stepStatus) ? workflow.stepStatus : {};
  const goal = readGoalContract(data);
  const evidence = isRecord(data.webHeroCodeEvidence) ? data.webHeroCodeEvidence : {};
  const evidencePreviewIds = Array.isArray(evidence.previewNodeIds)
    ? evidence.previewNodeIds.map(readString).filter(Boolean).sort()
    : [];
  const evidenceStyleUrls = Array.isArray(evidence.styleReferenceUrls)
    ? evidence.styleReferenceUrls.map(readString).filter(Boolean).sort()
    : [];
	const expectedCodeInputDigest = computeWebHeroCodeInputDigestForDebug(flow, targetNodeId, data);
  const selectedStyle = isRecord(workflow.selectedStyleReference) ? workflow.selectedStyleReference : {};
  const selectedStyleUrls = [
    selectedStyle.vendorReferenceImageUrl,
    selectedStyle.originalImageUrl,
    selectedStyle.sourceImageUrl,
    selectedStyle.remoteImageUrl,
    selectedStyle.imageUrl,
    selectedStyle.thumbnailUrl,
  ].map(readString).filter(Boolean).sort();
  return (
    html.length > 20 &&
    css.length > 20 &&
    documentHtml.length > 40 &&
    documentHtml.includes(css) &&
    readString(data.webHeroCodeSessionId).length > 0 &&
    readString(data.webHeroCodeCommittedAt).length > 0 &&
    data.webHeroFinalCodeStale === false &&
    evidence.version === 2 &&
    readString(evidence.sessionId) === readString(data.webHeroCodeSessionId) &&
	readString(evidence.codeInputDigest) === expectedCodeInputDigest &&
    JSON.stringify(evidencePreviewIds) === JSON.stringify(previewIds.slice().sort()) &&
    selectedStyleUrls.length > 0 &&
    JSON.stringify(evidenceStyleUrls) === JSON.stringify(selectedStyleUrls) &&
    readString(status.final_code).toLowerCase() === "completed" &&
    normalizeWebHeroGoalStep(goal.currentStep) === "completed"
  );
}

function hasStyleMetadata(data: RecordValue): boolean {
  const workflow = readWorkflow(data);
	if (!isRecord(workflow.selectedStyleReference)) return false;
	return [
		workflow.selectedStyleReference.vendorReferenceImageUrl,
		workflow.selectedStyleReference.originalImageUrl,
		workflow.selectedStyleReference.sourceImageUrl,
		workflow.selectedStyleReference.remoteImageUrl,
		workflow.selectedStyleReference.imageUrl,
		workflow.selectedStyleReference.thumbnailUrl,
	].some((candidate) => {
		if (typeof candidate !== "string" || !candidate.trim()) return false;
		try {
			const url = new URL(candidate.trim());
			if (url.protocol !== "http:" && url.protocol !== "https:") return false;
			const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
			const isIpv6 = host.includes(":");
			return !(
				host === "localhost" ||
				host.endsWith(".localhost") ||
				host.endsWith(".local") ||
				host.startsWith("127.") ||
				host === "::1" ||
				host.startsWith("10.") ||
				host.startsWith("169.254.") ||
				host.startsWith("0.") ||
				host.startsWith("192.168.") ||
				/^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
				host.startsWith("::ffff:") ||
				(isIpv6 && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")))
			);
		} catch {
			return false;
		}
	});
}

function statusCompleted(status: RecordValue, keys: string[]): boolean {
  return keys.some((key) => readString(status[key]).toLowerCase() === "completed");
}

function actionForStep(step: WebHeroGoalStep): string {
  switch (step) {
    case "style_reference_selection":
      return "resume_style_reference_selection";
    case "preview_generation":
      return "resume_preview_generation";
    case "preview_visual_spec":
      return "resume_preview_visual_spec_only";
    case "asset_inventory":
      return "resume_asset_inventory_only";
    case "asset_resolution":
      return "resume_asset_resolution_only";
    case "section_codegen":
      return "dispatch_codegen_only";
    case "merge_codegen":
      return "dispatch_merge_only";
    case "completed":
      return "done";
  }
}

function stepForAction(action: string): WebHeroGoalStep {
  switch (action) {
    case "resume_style_reference_selection":
      return "style_reference_selection";
    case "resume_preview_generation":
    case "resume_preview_approval_only":
      return "preview_generation";
    case "resume_preview_visual_spec_only":
      return "preview_visual_spec";
    case "resume_asset_inventory_only":
      return "asset_inventory";
    case "resume_asset_resolution_only":
      return "asset_resolution";
    case "dispatch_codegen_only":
      return "section_codegen";
    case "dispatch_merge_only":
      return "merge_codegen";
    case "done":
      return "completed";
    default:
      return "style_reference_selection";
  }
}

function goalContractIssues(data: RecordValue): string[] {
  const contract = readGoalContract(data);
  if (Object.keys(contract).length < 1) return ["webHeroGoalContract persistent state machine"];
  const issues: string[] = [];
  if (readString(contract.kind) && readString(contract.kind) !== "webHeroGoalContract") {
    issues.push("webHeroGoalContract.kind must be webHeroGoalContract");
  }
  if (!normalizeWebHeroGoalStep(contract.currentStep)) {
    issues.push("webHeroGoalContract.currentStep must be a known WebHero goal step");
  }
  const stepIds = new Set(asRecordArray(contract.steps).map((step) => normalizeWebHeroGoalStep(step.id)).filter(Boolean));
  for (const step of WEBHERO_GOAL_STEPS) {
    if (!stepIds.has(step)) issues.push(`webHeroGoalContract.steps missing ${step}`);
  }
  const hardRules = isRecord(contract.hardRules) ? contract.hardRules : {};
  for (const rule of [
    "previewVisualSpecsRequired",
    "imageAssetsRequireVisualSpecEvidence",
    "sectionDraftsRequirePreviewBinding",
    "mergeFromPersistedDraftsOnly",
    "noPreviewScreenshotsAsFinalAssets",
  ]) {
    if (hardRules[rule] !== true) issues.push(`webHeroGoalContract.hardRules.${rule}=true`);
  }
  return issues;
}

export function createWebHeroDebugResumePlanTool(): ToolHandler {
  return {
    definition: {
      name: "webhero_debug_resume_plan",
      description:
        "WebHero-only breakpoint/resume diagnostic. Given current canvas_flow_get output and targetNodeId, decide the cheapest next step without regenerating completed previews/assets. Use this before WebHero final-code debugging or after any timeout.",
      parameters: {
        type: "object",
        properties: {
          targetNodeId: { type: "string" },
          flow: {
            description: "Current canvas_flow_get response or flow graph object/string.",
            oneOf: [{ type: "object", additionalProperties: true }, { type: "string" }],
          },
          targetNodeData: {
            description: "Optional target node data object/string. If omitted, it is extracted from flow.",
            oneOf: [{ type: "object", additionalProperties: true }, { type: "string" }],
          },
        },
        required: ["targetNodeId", "flow"],
        additionalProperties: false,
      },
    },
    isReadOnly: true,
    isConcurrencySafe: () => true,
    async execute(args, _ctx, toolCallId) {
      const targetNodeId = readString(args.targetNodeId);
      if (!targetNodeId) {
        return {
          toolCallId,
          isError: true,
          errorMessage: "targetNodeId is required",
          content: "Error: targetNodeId is required.",
        };
      }
      const data = findTargetData({ targetNodeId, flow: args.flow, targetNodeData: args.targetNodeData });
      const status = readStepStatus(data);
      const approvedPreviewIds = Array.from(new Set(readApprovedPreviewIds(data)));
      const generatedPreviewIds = findGeneratedPreviewIds(args.flow, targetNodeId);
      const assetNodeIds = findAssetNodeIds(args.flow, targetNodeId);
      const visualSlots = readVisualSlots(data);
      const visualSpecs = readPreviewVisualSpecs(data);
      const assetIssues = Array.from(new Set([
        ...assetInventoryIssues(approvedPreviewIds, visualSlots, visualSpecs),
        ...diagnoseWebHeroImplementationBrief(data.webPageImplementationBrief).issues,
        ...diagnoseWebHeroAssetRequirements(data.webPageAssetRequirements, {
          approvedPreviewNodeIds: approvedPreviewIds,
        }).issues,
        ...diagnoseWebHeroAssetDecisions(data.webPageAssetDecisions).issues,
      ]));
      const resolvedAssets = readResolvedAssets(data);
      const assetResolutionIssues = Array.from(new Set([
        ...generatedAssetDecisionBindingIssues(args.flow, targetNodeId, data),
        ...assetResolutionCoverageIssues({
          flow: args.flow,
          targetNodeId,
          visualSlots,
          resolvedAssets,
        }),
      ]));
      const drafts = readDrafts(data);
      const usableDrafts = drafts.filter(isUsableDraft);
      const canonicalDrafts = usableDrafts
        .filter(hasCanonicalDraftShape)
        .filter((draft) => diagnoseWebHeroSectionDraft(draft).ok);
      const draftsCoverPreviews = previewCoveredByDrafts(approvedPreviewIds, usableDrafts);
      const canonicalDraftsCoverPreviews = previewCoveredByDrafts(approvedPreviewIds, canonicalDrafts);
      const draftIssues = sectionDraftQualityIssues(approvedPreviewIds, canonicalDrafts, visualSlots);
      const finalCodeCommitted = hasFinalCode(data, approvedPreviewIds, args.flow, targetNodeId);
      const assetInventoryComplete =
        visualSlots.length > 0 &&
        assetIssues.length === 0 &&
        (statusCompleted(status, ["asset_inventory"]) || Boolean(data.webPageAssetRequirements));
      const assetResolutionComplete =
        (resolvedAssets.length > 0 || assetNodeIds.length > 0) &&
        assetResolutionIssues.length === 0 &&
        (statusCompleted(status, ["asset_resolution"]) || Boolean(data.webPageResolvedAssets));
      const styleMetadataPresent = hasStyleMetadata(data);
      const goalIssues = goalContractIssues(data);
      const currentGoalStep = goalCurrentStep(data);

      let evidenceAction = "inspect";
      const reasons: string[] = [];
      const forbiddenActions = [
        "Do not rerun style reference search when previews already exist.",
        "Do not regenerate generated or approved preview screenshots unless their persisted media failed.",
        "Do not regenerate webpage assets when resolvedAssets or asset nodes already exist.",
        "Do not dispatch webhero_merge_codegen from inside codegen.",
      ];

      if (finalCodeCommitted) {
        evidenceAction = "done";
        reasons.push("Complete session-backed webHeroHtml/webHeroCss/webHeroDocumentHtml already exist on the target node.");
      } else if (approvedPreviewIds.length < 1 && generatedPreviewIds.length > 0) {
        evidenceAction = "resume_preview_approval_only";
        reasons.push("Generated preview candidates exist, but webPageWorkflowContract.approvedPreviewNodes has not been persisted.");
      } else if (approvedPreviewIds.length < 1) {
        evidenceAction = "resume_preview_generation";
        reasons.push("No approved preview nodes were found; preview generation is the earliest missing breakpoint.");
      } else if (!previewCoveredBySpecs(approvedPreviewIds, visualSpecs)) {
        evidenceAction = "resume_preview_visual_spec_only";
        reasons.push("Approved previews exist, but persistent webPagePreviewVisualSpecs do not cover every preview.");
      } else if (!assetInventoryComplete) {
        evidenceAction = "resume_asset_inventory_only";
        reasons.push(assetIssues.length ? assetIssues.join(" ") : "Previews exist, but flat webPageAssetRequirements.visualSlots are missing or incomplete.");
      } else if (!assetResolutionComplete) {
        evidenceAction = "resume_asset_resolution_only";
        reasons.push(
          assetResolutionIssues.length
            ? assetResolutionIssues.join(" ")
            : "Asset inventory exists, but resolved webpage asset URLs or successful asset nodes are missing.",
        );
      } else if (!styleMetadataPresent) {
        evidenceAction = "backfill_style_metadata_only";
        reasons.push("Preview/assets exist, but canonical webPageWorkflowContract.selectedStyleReference is missing; restore a real selection before resuming downstream work.");
      } else if (!canonicalDraftsCoverPreviews || draftIssues.length > 0) {
        evidenceAction = "dispatch_codegen_only";
        reasons.push(
          draftIssues.length
            ? `Persisted webPageSectionDrafts are present but fail section fidelity bindings: ${draftIssues.join("; ")}.`
            : "Previews and assets are present, but canonical webPageSectionDrafts do not cover every preview.",
        );
      } else {
        evidenceAction = "dispatch_merge_only";
        reasons.push("Canonical webPageSectionDrafts cover every preview; skip codegen and dispatch webhero_merge_codegen directly from root.");
      }

      let nextAction = evidenceAction;
      const evidenceStep = stepForAction(evidenceAction);
      let goalPatch: RecordValue | null = null;
      if (goalIssues.length > 0) {
        nextAction = "normalize_goal_contract_only";
        goalPatch = buildGoalContract({ targetNodeId, data, currentStep: evidenceStep });
        reasons.unshift(`webHeroGoalContract must be normalized before resuming: ${goalIssues.join("; ")}`);
      } else if (
        currentGoalStep &&
        webHeroGoalStepIndex(currentGoalStep) > webHeroGoalStepIndex(evidenceStep)
      ) {
        nextAction = "normalize_goal_contract_only";
        goalPatch = buildGoalContract({ targetNodeId, data, currentStep: evidenceStep });
        reasons.unshift(`webHeroGoalContract.currentStep=${currentGoalStep} is ahead of persisted evidence; rewind to ${evidenceStep}.`);
      } else if (
        currentGoalStep &&
        webHeroGoalStepIndex(currentGoalStep) < webHeroGoalStepIndex(evidenceStep) &&
        evidenceAction !== "done"
      ) {
        nextAction = "normalize_goal_contract_only";
        goalPatch = buildGoalContract({ targetNodeId, data, currentStep: evidenceStep });
        reasons.unshift(`webHeroGoalContract.currentStep=${currentGoalStep} is behind persisted evidence; advance it to ${evidenceStep} without regenerating prior stages.`);
      }

      const suggestedPatch =
        nextAction === "normalize_goal_contract_only" && goalPatch
          ? {
              patchNodeData: [
                {
                  id: targetNodeId,
                  data: {
                    webHeroGoalContract: goalPatch,
                  },
                },
              ],
            }
          : null;

      const result = {
        ok: true,
        targetNodeId,
        nextAction,
        reasons,
        resumeFromCurrentFlow: true,
        rerunPolicy: {
          styleSearch: approvedPreviewIds.length < 1 && generatedPreviewIds.length < 1,
          previewGeneration: approvedPreviewIds.length < 1 && generatedPreviewIds.length < 1,
          assetGeneration:
            nextAction !== "normalize_goal_contract_only" &&
            nextAction !== "resume_preview_approval_only" &&
            !assetResolutionComplete,
          sectionCodegen: nextAction === "dispatch_codegen_only",
          mergeCodegen: nextAction === "dispatch_merge_only",
        },
        evidence: {
          goalCurrentStep: currentGoalStep || null,
          goalIssues,
          evidenceAction,
          evidenceStep,
          approvedPreviewCount: approvedPreviewIds.length,
          approvedPreviewIds,
          generatedPreviewCount: generatedPreviewIds.length,
          generatedPreviewIds,
          previewVisualSpecCount: visualSpecs.length,
          previewVisualSpecsCoverPreviews: previewCoveredBySpecs(approvedPreviewIds, visualSpecs),
          visualSlotCount: visualSlots.length,
          assetInventoryIssues: assetIssues,
          resolvedAssetCount: resolvedAssets.length,
          assetNodeCount: assetNodeIds.length,
          assetResolutionIssues,
          draftCount: drafts.length,
          usableDraftCount: usableDrafts.length,
          canonicalDraftCount: canonicalDrafts.length,
          draftsCoverPreviews,
          canonicalDraftsCoverPreviews,
          sectionDraftQualityIssues: draftIssues,
          finalCodeCommitted,
          styleMetadataPresent,
        },
        suggestedPatch,
        nextInstructions:
          nextAction === "normalize_goal_contract_only"
            ? "Apply suggestedPatch with canvas_update_node_data, then call webhero_debug_resume_plan again. Do not regenerate previews/assets/sections."
            : nextAction === "dispatch_codegen_only"
            ? "Do not dispatch the coarse codegen sub-agent. Root/main must call web_generation_codegen_prepare, compare sectionCodegenContract.sections with existing webPageSectionDrafts, dispatch Agent({subagent_type:\"section_codegen\", result_mode:\"full\", task_contract:{kind:\"webhero_section_codegen\", ...}}) only for missing/invalid sections, and immediately upsert each returned full JSON draft to targetNode.data.webPageSectionDrafts with canvas_update_node_data. Then call webhero_debug_resume_plan again. Do not dispatch merge until nextAction becomes dispatch_merge_only."
            : nextAction === "dispatch_merge_only"
              ? `Call canvas_webhero_check_readiness({nodeId:${JSON.stringify(targetNodeId)}}) first. Only when it returns data.ready=true and data.previewNodeIds has ${approvedPreviewIds.length} exact IDs, dispatch Agent({subagent_type:"webhero_merge_codegen",result_mode:"compact",task_contract:{kind:"webhero_merge_codegen",targetNodeIds:${JSON.stringify([targetNodeId])},sectionDraftsPersisted:true,persistedDraftCount:${approvedPreviewIds.length},approvedPreviewNodes:data.previewNodeIds,flowUpdatedAt:data.flowUpdatedAt,codeInputDigest:data.codeInputDigest}}) directly from root/main agent. Copy all three readiness fields exactly and consume this readiness once. Do not dispatch codegen again.`
              : nextAction === "resume_preview_approval_only"
                  ? `Inspect generatedPreviewIds=${JSON.stringify(generatedPreviewIds)} and persist exactly one transition at targetNode.data.webPageWorkflowContract.approvedPreviewNodes with webHeroResetDownstreamEvidence=true after 3-4 candidates satisfy the preview gate. Do not write approvedPreviewNodes at targetNode.data top level and do not regenerate successful candidates.`
                : nextAction === "resume_preview_visual_spec_only"
                  ? "Read the approved preview media and persist targetNode.data.webPagePreviewVisualSpecs with one visual spec per preview. Do not regenerate previews or assets."
                : "Resume only the named missing breakpoint. Reuse all existing evidence listed above.",
        forbiddenActions,
      };
      return {
        toolCallId,
        content: JSON.stringify(result),
        payload: { text: JSON.stringify(result), structuredOutput: result },
      };
    },
  };
}
