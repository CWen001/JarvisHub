import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { isAbsolute, relative as relativePath } from "node:path";
import type { AppEnv } from "../../types";
import { AppError } from "../../middleware/error";
import { optionalNonEmptyString } from "../flow/flow.public.schemas";
import {
  getFlowForOwner,
  getFlowByIdUnsafe,
  mapFlowRowToDto,
  updateFlow,
  updateFlowIfUpdatedAtMatches,
  updateFlowByIdUnsafe,
  updateFlowByIdUnsafeIfUpdatedAtMatches,
  createFlowVersion,
  listFlowsByOwner,
  listFlowsByProject,
} from "../flow/flow.repo";
import {
  PublicFlowGetResponseSchema,
  PublicFlowGraphSchema,
  PublicFlowPatchRequestSchema,
} from "../flow/flow.public.schemas";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import { applyPublicFlowGraphPatch, GROUP_MIN_WIDTH, GROUP_MIN_HEIGHT } from "../flow/flow.public.service";
import { getProjectById, getProjectForOwner } from "../project/project.repo";
import { isHostedAssetUrl } from "../asset/asset.hosting";
import {
  AgentPipelineRunSchema,
  ProjectWorkspaceContextSchema,
} from "../agents/agents.schemas";
import {
  getUserAgentPipelineRunById,
  getNodeContextBundle,
  getUserProjectWorkspaceContext,
  getVideoReviewBundle,
  listUserAgentPipelineRuns,
} from "../agents/agents.service";
import { generateImageToCanvas } from "./agents-tool-bridge.generate-image-to-canvas";
import { waitForImageResultToCanvas } from "./agents-tool-bridge.wait-image-result";
import { generateVideoToCanvas } from "./agents-tool-bridge.generate-video-to-canvas";
import { waitForVideoResultToCanvas } from "./agents-tool-bridge.wait-video-result";
import { concatVideoToCanvas } from "./agents-tool-bridge.concat-video-to-canvas";
import { inspectCanvasFlowGraph } from "./agents-tool-bridge.flow-inspect";
import { getCanvasGenerationContextFromGraph } from "./agents-tool-bridge.generation-context";
import { stripAgentPositions } from "./agents-tool-bridge.sanitize-args";
import {
  createAgentCheckpoint,
  listAgentCheckpoints,
  restoreAgentCheckpoint,
} from "./agents-tool-bridge.flow-checkpoint";
import { evaluateNodeReadMedia } from "./agents-tool-bridge.evaluate-node-read";
import { searchWebAssets } from "./agents-tool-bridge.web-asset-search";
import { searchWebStyleReferences } from "./agents-tool-bridge.web-style-reference-search";
import {
  assertPptMasterProjectOwnedByScope,
  exportPptMasterProject,
  getPptMasterProjectsRoot,
  writePptMasterSlideSvg,
} from "./agents-tool-bridge.ppt-master-runtime";
import { initializePptMasterProjectForDeck } from "./agents-tool-bridge.ppt-master-project-init";
import {
  assertPptDeckExportProjectPath,
  checkPptDeckReadiness,
} from "./agents-tool-bridge.ppt-master-gate";

function findNodeDataInGraph(graph: unknown, nodeId: string): Record<string, unknown> {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return {};
  const nodes = (graph as { nodes?: unknown[] }).nodes;
  if (!Array.isArray(nodes)) return {};
  const node = nodes.find((item) => {
    return Boolean(item) &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      String((item as { id?: unknown }).id || "") === nodeId;
  });
  if (!node || typeof node !== "object" || Array.isArray(node)) return {};
  const data = (node as { data?: unknown }).data;
  return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
}

function buildPptMasterPublicAssetUrl(origin: string, absolutePath: string): string {
  const projectsRoot = getPptMasterProjectsRoot();
  const relative = relativePath(projectsRoot, absolutePath);
  if (!relative || relative === ".." || relative.startsWith("../") || isAbsolute(relative)) {
    throw new AppError("PPT Master asset path is outside the configured projects root", {
      status: 409,
      code: "ppt_master_asset_outside_root",
      details: { absolutePath, projectsRoot },
    });
  }
  const encodedPath = relative.split("/").map(encodeURIComponent).join("/");
  return `${origin}/public/ppt-master/projects/${encodedPath}`;
}

function requirePptMasterFlowProjectId(value: string | null | undefined): string {
  const projectId = readTrimmedString(value);
  if (projectId) return projectId;
  throw new AppError("PPT Master flow is missing its project identity", {
    status: 409,
    code: "ppt_master_workspace_identity_missing",
    details: { field: "projectId" },
  });
}

function buildWebHeroCommitResponse(input: {
	nodeId: string;
	sessionId: string;
	committedAt: string;
	idempotent: boolean;
	nodeData: Record<string, unknown>;
}): Record<string, unknown> {
	return {
		ok: true,
		idempotent: input.idempotent,
		nodeId: input.nodeId,
		sessionId: input.sessionId,
		committedAt: input.committedAt,
		committedNodeData: input.nodeData,
	};
}

function buildCompletedWebHeroWorkflowContract(graph: unknown, nodeId: string): Record<string, unknown> {
  const data = findNodeDataInGraph(graph, nodeId);
  const current = data.webPageWorkflowContract &&
    typeof data.webPageWorkflowContract === "object" &&
    !Array.isArray(data.webPageWorkflowContract)
    ? data.webPageWorkflowContract as Record<string, unknown>
    : {};
  const stepStatus = current.stepStatus &&
    typeof current.stepStatus === "object" &&
    !Array.isArray(current.stepStatus)
    ? current.stepStatus as Record<string, unknown>
    : {};
  return {
    ...current,
    currentStep: "completed",
    stepStatus: {
      ...stepStatus,
      style_reference_selection: "completed",
      preview_generation: "completed",
      preview_visual_spec: "completed",
      asset_inventory: "completed",
      asset_resolution: "completed",
      section_codegen: "completed",
      merge_codegen: "completed",
      final_codegen: "completed",
      final_code: "completed",
    },
    missingItems: [],
  };
}

function buildCompletedWebHeroGoalContract(graph: unknown, nodeId: string): Record<string, unknown> {
  const data = findNodeDataInGraph(graph, nodeId);
  return buildDefaultWebHeroGoalContract({
    nodeId,
    goal:
      readTrimmedString(data.prompt) ||
      readTrimmedString(data.label) ||
      readTrimmedString(data.content) ||
      "WebHero preview-first website workflow",
    currentStep: "completed",
  });
}

import {
  assertPptMasterSlideArtifactsValid,
  materializePptMasterSlideImage,
} from "./agents-tool-bridge.ppt-master-image-prep";
import {
  WorkflowExecutionEventSchema,
  WorkflowExecutionSchema,
  WorkflowNodeRunSchema,
} from "../execution/execution.schemas";
import {
  getExecutionForOwner,
  listExecutionEvents,
  listExecutionsForOwnerFlow,
  listNodeRunsForExecutionOwner,
  mapExecutionEventRow,
  mapExecutionRow,
  mapNodeRunRow,
} from "../execution/execution.repo";
import {
  buildEffectsForToolResult,
  getCanvasToolSpec,
} from "./canvas-tools/catalog";
import { assertAgentPatchHasNoForbiddenModelKeys } from "./agents-tool-bridge.resolve-model";
import {
  assertNonEmptyCanvasDelete,
  deriveFlowGraphEffects,
  mergeToolResultEffects,
} from "./canvas-tools/effects";
import {
  buildToolInvocationContextHash,
  completeToolInvocation,
  createRunningToolInvocation,
  decideToolInvocation,
  failToolInvocation,
  findToolInvocationByKey,
  requiresToolInvocationIdempotency,
} from "./canvas-tools/idempotency";
import { assertFlowProjectScope } from "./canvas-tools/scope";
import { assertWebHeroFinalCodePatchAllowed, assertWebHeroReadyForFinalCode, buildDefaultWebHeroGoalContract, checkWebHeroReadiness, computeWebHeroCodeInputDigest } from "./agents-tool-bridge.webhero-gate";
import { materializeWebHeroAssetReferences } from "./agents-tool-bridge.webhero-asset-references";
import {
  assertPptDeckProjectInitPreconditions,
  assertPptDeckStepStatusTransition,
  readPptDeckWorkspaceId,
} from "./agents-tool-bridge.ppt-master-step-gate";
import {
	assertWebHeroCodeReadinessSnapshotMatches,
  assertWebHeroCommittedNodeData,
  beginWebHeroCodeCommitCommand,
	buildWebHeroDocumentHtml,
	buildWebHeroMergeDispatchSnapshotText,
  completeWebHeroCodeCommitCommand,
	nextWebHeroFlowRevision,
	readWebHeroCodeReadinessSnapshot,
  readWebHeroCodeStageIdentity,
	replaceWebHeroCodeStageContent,
  stageWebHeroCodeChunkCommand,
} from "./agents-tool-bridge.webhero-code-stage";
import {
  commitWebHeroFlowAndStageSession,
  deleteExpiredWebHeroCodeStageSessions,
  findWebHeroCodeStageSession,
  saveWebHeroCodeStageSession,
  type WebHeroCodeStageCommitting,
} from "./agents-tool-bridge.webhero-stage-session.repo";
import type {
  CanvasToolHandler,
  CanvasToolSpec,
  ToolResultEnvelope,
  ToolResultEffects,
} from "./canvas-tools/types";
import { buildUpdateNodeDataSemanticPatch } from "./agents-tool-bridge.update-node-data";
import {
  findMisplacedWebHeroWorkflowFields,
  requiredWebHeroWorkflowFieldPaths,
  WEBHERO_WORKFLOW_FIELD_PATH_ERROR,
  WEBHERO_WORKFLOW_FIELD_PATH_ISSUE_PARAM,
} from "./agents-tool-bridge.webhero-workflow-contract";
import {
  assertCanonicalWebHeroStyleReferencePatch,
  readSelectedWebHeroStyleReference,
  type WebHeroPatchAuthority,
} from "../flow/flow.webhero-style-reference";
import { narrowWebHeroPolicyGraph } from "../flow/flow.webhero-code-policy";

const HarnessInvocationSegmentSchema = z.object({
  agentId: z.string().min(1),
  layoutStageIndex: z.number().int().nonnegative(),
  executionBatchCallIndex: z.number().int().nonnegative(),
  executionBatchCallCount: z.number().int().positive(),
  toolCallIndex: z.number().int().nonnegative(),
  toolCallId: z.string().min(1),
});

const HarnessLayoutItemSegmentSchema = z.object({
  index: z.number().int().nonnegative(),
  count: z.number().int().positive(),
});

const AgentsToolExecuteRequestSchema = z.object({
  toolName: z.string().min(1),
  providerKind: z.enum(["remote", "mcp"]).optional(),
  args: z.record(z.string(), z.unknown()).default({}),
  context: z
    .object({
      projectId: optionalNonEmptyString,
      flowId: optionalNonEmptyString,
      nodeId: optionalNonEmptyString,
    })
    .optional(),
  run: z
    .object({
      runId: optionalNonEmptyString,
      toolCallId: z.string().min(1),
      idempotencyKey: optionalNonEmptyString,
      publicChatRunId: optionalNonEmptyString,
      sessionKey: optionalNonEmptyString,
      agentId: optionalNonEmptyString,
      parentToolCallId: optionalNonEmptyString,
      llmTurnIndex: z.number().int().nonnegative().optional(),
      executionBatchIndex: z.number().int().nonnegative().optional(),
      executionBatchCallIndex: z.number().int().nonnegative().optional(),
      executionBatchCallCount: z.number().int().positive().optional(),
      toolCallIndex: z.number().int().nonnegative().optional(),
      schemaVersion: z.literal(2).optional(),
      invocationPath: z.array(HarnessInvocationSegmentSchema).max(8).optional(),
      layoutStagePath: z.array(z.number().int().nonnegative()).max(8).optional(),
      layoutItemPath: z.array(HarnessLayoutItemSegmentSchema).max(8).optional(),
    })
    .optional(),
});

const AgentsToolExecuteResponseSchema = z.object({
  ok: z.literal(true),
  content: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  effects: z.record(z.string(), z.unknown()).optional(),
});

function requireUserId(c: Context<AppEnv>): string {
  const userId = c.get("userId");
  if (!userId) {
    throw new AppError("Unauthorized", {
      status: 401,
      code: "unauthorized",
    });
  }
  return String(userId);
}

function isDevBypassEnabled(c: Context<AppEnv>): boolean {
  return Boolean(c.get("devPublicBypass"));
}

function isNodeRuntime(): boolean {
  const processRef = globalThis.process;
  return Boolean(processRef?.versions?.node);
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nextPptMasterFlowRevision(baseUpdatedAt: string, candidateIso: string): string {
  const baseMs = Date.parse(baseUpdatedAt);
  const candidateMs = Date.parse(candidateIso);
  if (!Number.isFinite(baseMs) || !Number.isFinite(candidateMs)) {
    throw new AppError("PPT Master flow revision timestamps must be valid ISO dates", {
      status: 500,
      code: "ppt_master_flow_revision_invalid",
      details: { baseUpdatedAt, candidateIso },
    });
  }
  return new Date(Math.max(candidateMs, baseMs + 1)).toISOString();
}

type SemanticPatchResult = {
  patch: Record<string, unknown>;
  effects: ToolResultEffects;
};

function buildDefaultWebPageWorkflowContract(input: {
  nodeId: string;
  data: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    version: 1,
    goal: readTrimmedString(input.data.prompt) || readTrimmedString(input.data.label) || "WebHero preview-first website workflow",
    targetWebHeroNodeId: input.nodeId,
    currentStep: "style_reference_selection",
    stepStatus: {
      style_reference_selection: "pending",
      preview_generation: "pending",
	  preview_visual_spec: "pending",
      asset_inventory: "pending",
      asset_resolution: "pending",
      final_code: "pending",
    },
    approvedPreviewNodes: [],
    missingItems: [],
    sharedStyleBible: input.data.webPagePreviewStyleBible ?? null,
		selectedStyleReference: null,
    flatVisualSlotsContract: {
      storage: "webPageAssetRequirements.visualSlots",
      shape: "flat_array",
      requiredFields: [
        "sectionId",
        "previewNodeId_or_screenshotOrder",
        "subjectId",
        "slotId",
        "description",
        "implementation",
        "assetId",
        "renderMode",
        "status",
        "intendedWebUsage",
      ],
      groupedSlotsAllowed: false,
    },
    acceptanceCriteria: {
      style_reference_selection: [
		"[REQUIRED Step 1/6] Run canvas_web_style_reference_search with the website topic/brand as query. DO NOT SKIP this step.",
        "[REQUIRED] If search returns 1+ usable image results, MUST call ask_user with 5 optionCards. Each optionCard MUST include: value (choice label), imageUrl (direct image URL for thumbnail preview). DO NOT use plain text options — use optionCards so the user sees image previews. DO NOT create canvas nodes for style references.",
        "[REQUIRED] After user selects, persist the choice as a canonical object in webPageWorkflowContract.selectedStyleReference, including title plus at least one executable HTTP(S) imageUrl/originalImageUrl/vendorReferenceImageUrl; a bare URL string or text-only custom style is invalid. This exact canvas_update_node_data item MUST also pass webHeroResetDownstreamEvidence=true and MUST NOT include downstream specs/assets/briefs/checklists/drafts. Derive sharedStyleBible and set stepStatus.style_reference_selection=completed there; later status patches must be partial and must not resend selectedStyleReference.",
        "[REQUIRED] If search returns 0 results or all are degraded, STOP and report the search failure with provider warnings. Do not mark style_reference_selection completed, do not dispatch preview image generation, and do not proceed to Step 2 until a real searched style reference is selected and persisted.",
      ],
      preview_generation: [
		"[REQUIRED Step 2/6] ONLY run after stepStatus.style_reference_selection=completed. If still pending, STOP and complete Step 1 first. DO NOT SKIP this step.",
        "[REQUIRED] Generate exactly 3-4 separate canvas image nodes with aspectRatio=16:9. Omit imageResolution by default so the backend uses the configured image model defaultImageSize; APIMart/GPT-Image-2 WebHero media falls back to 1K. Each preview represents a different website section. CRITICAL: Generate AT MOST 2 images concurrently — call canvas_image_generate_to_canvas for 2 images, then wait for both to complete via canvas_image_wait_for_result before starting the next batch. Never generate more than 2 concurrent image tasks. If canvas_image_wait_for_result times out after 20 min, retry waiting (some vendor images take 12+ min), or regenerate the image via canvas_image_generate_to_canvas.",
		"[REQUIRED] Every preview canvas_image_generate_to_canvas call must pass purpose.kind=webPreview, purpose.forNodeId=targetWebHeroNodeId, purpose.sectionId unique within the approved set, and purpose.order exactly contiguous 1..N. Never pass purpose.slotId for webPreview; slotId is reserved for webPageAsset. The server persists section/order atomically as webScreenshotSectionId/webScreenshotOrder, so do not add a post-generation metadata patch. The backend reads the target node's current persisted selectedStyleReference at generation time; you do not pass any Flow revision. Missing identity or a missing/unexecutable style reference is rejected before image generation.",
		"[REQUIRED] Any change to webPageWorkflowContract.approvedPreviewNodes is its own canvas_update_node_data transition with webHeroResetDownstreamEvidence=true and no downstream evidence in the same item. Do not resend approvedPreviewNodes in later status patches.",
        "[REQUIRED] All previews MUST share the sharedStyleBible (consistent colors/lighting/materials). No brightness/palette outlier.",
        "[REQUIRED] After previews are approved, update webPageWorkflowContract: append preview node IDs to approvedPreviewNodes, set stepStatus.preview_generation=completed.",
      ],
	  preview_visual_spec: [
		"[REQUIRED Step 3/6] ONLY run after stepStatus.preview_generation=completed and the canonical approvedPreviewNodes transition has persisted exactly 3-4 previews. DO NOT SKIP.",
		"[REQUIRED] In one preview_visual_spec canvas_update_node_data call, persist exactly these target-node top-level fields: webPageReferencePrompt, webPageImplementationBrief, fontPlan, previewDetailChecklist, webPagePreviewVisualSpecs, componentReferencePlan.",
		"[REQUIRED] Do not include visibleSubjectInventory, webPageAssetRequirements, webPageAssetDecisions, webPageResolvedAssets, or webPageSectionDrafts in that call. Persist those later phases separately.",
		"[REQUIRED] Set stepStatus.preview_visual_spec=completed only with that evidence or in a later partial contract patch after all six fields exist.",
	  ],
      asset_inventory: [
		"[REQUIRED Step 4/6] ONLY run after stepStatus.preview_visual_spec=completed. DO NOT SKIP.",
        "[REQUIRED] In the WebHero webpage-code workflow, webpage asset planning is mandatory. Do NOT write plans that say no webpage assets are needed, no additional image assets are needed, or all visuals are procedural-only.",
        "[REQUIRED] List every preview-visible non-text subject in visibleSubjectInventory. Each preview gets its own entries.",
        "[REQUIRED] Convert each subject into flat webPageAssetRequirements.visualSlots records with ALL requiredFields: sectionId, previewNodeId_or_screenshotOrder, subjectId, slotId, description, implementation, assetId, renderMode, status, intendedWebUsage. For each slot that needs a generated asset, record the stable preview image nodeId that shows the reference style; generation references must pass sourceNodeId, never a copied internal preview URL.",
        "[REQUIRED] For every image_asset visualSlot, persist intendedWebUsage.surfaceTreatment/cardPolicy from the approved preview: carded_panel only when the preview visibly puts that subject inside a rounded/square card, bordered frame, shadowed tile, or glass panel; otherwise use transparent_cutout, background_matched_media, full_bleed_media, masked_media, or inline_icon. Do not let a model default convert standalone/transparent/product media into generic rounded cards.",
        "[REQUIRED] Product/device/hardware/camera/hinge/screen/lifestyle/scene/portrait hero visuals are image_asset slots by default. Do not mark these subjects code_procedural or reference_only; they must be searched/generated and embedded in final code. Reference-only is only for abstract layout/decorative/UI-structure evidence.",
        "[REQUIRED] Do NOT cover a whole preview with one generic slot. Each visible element (product, UI screen, illustration, hero visual) gets its own slot.",
		"[REQUIRED] Persist these asset_inventory fields on the target WebHero node top-level only: visibleSubjectInventory, webPageAssetRequirements.visualSlots, webPageAssetDecisions. Text nodes, workflow-contract nested copies, or flatPreCodeInventory aliases are not accepted as substitutes.",
        "[REQUIRED] webPageAssetDecisions must be one object with five meaningful sections: icons, searchAssets, generatedAssets, fontPlan, stylePlan. generatedAssets must be a non-empty array of real records containing assetId, slotId, and sourceNodeId or generatedNodeId; do not overwrite this object with a later array.",
        "[REQUIRED] Only set stepStatus.asset_inventory=completed in the same canvas_update_node_data patch that writes the exact top-level fields above, or in a later patch after they already exist. The server rejects completed status if visualSlots are grouped, nested, aliased, missing required fields, or not on targetNode.data.webPageAssetRequirements.visualSlots.",
      ],
      asset_resolution: [
		"[REQUIRED Step 5/6] ONLY run after stepStatus.asset_inventory=completed. DO NOT SKIP.",
        "[REQUIRED] WebHero webpage code requires real webpage assets. Do not claim asset_resolution completed with zero generated webpage assets, zero resolved image assets, or an empty generatedAssets decision section.",
        "[REQUIRED] Search icons individually via canvas_web_asset_search(kind=icon). For transparent cutouts (single isolated product/device/logo/sticker foregrounds only), use kind=image, format=png, requireTransparent or preferTransparent. When generating image assets via canvas_image_generate_to_canvas, set transparentPng=true only for a single isolated cutout that must layer over live HTML/CSS. Do NOT set transparentPng=true for full hero scenes, illustration clusters, dashboards, maps, background art, or composed section artwork; those are embedded image assets with their own matched background.",
        "[REQUIRED] EVERY visual slot with implementation=generate MUST have a matching canvas image node created BEFORE final code. No exceptions. 100% resolve rate required.",
        "[REQUIRED] Prefer dispatching Agent({subagent_type:\"webhero_asset_generator\"}) once per preview section or visualSlot for generated webpage assets. Do not send the entire page asset ledger to one generic media subagent unless there are only 1-2 trivial slots. This keeps context small and makes each generated asset traceable to one preview/slot.",
        "[REQUIRED] If public search returns 0 results or unsuitable results for an image_asset slot, call canvas_image_generate_to_canvas for that same assetId. Pass approved preview nodes (from webPageWorkflowContract.approvedPreviewNodes) as references[{sourceNodeId, role:'style'}]; never copy their internal image URLs. The backend resolves each node's latest persisted URL for the vendor request. The generated asset should match the preview's aesthetic, colors, and lighting. For true single cutout assets, set transparentPng=true; for scenes/clusters/dashboards/maps/backgrounds, set transparentPng=false or omit it. The generated prompt must obey intendedWebUsage.surfaceTreatment/cardPolicy: add a rounded/square card, border, drop shadow, glass tile, or frame only when the preview itself shows that subject inside that exact container; otherwise generate the foreground cutout or background-matched media directly. NEVER leave a slot unresolved.",
        "[REQUIRED] Persist intendedWebUsage into webPageAssetRequirement.intendedWebUsage for every generated asset.",
        "[REQUIRED] After ALL slots are resolved (searched or generated), persist webPageResolvedAssets on the target WebHero node top-level and ensure generated image_asset slots have matching canvas asset nodes with webPageAssetForNodeId/webPageAssetId/webPageAssetSlotId. Only then set stepStatus.asset_resolution=completed; the server rejects completed status if any slot is unresolved.",
      ],
      final_code: [
		"[REQUIRED Step 6/6 DEBUG/RESUME FIRST] Before any final-code retry or continuation, call canvas_flow_get, then webhero_debug_resume_plan({targetNodeId, flow}). Obey nextAction exactly. This is the breakpoint mechanism: do not rerun style search, preview generation, preview visual spec, asset inventory, or asset generation when the resume plan says those artifacts already exist.",
        "[REQUIRED] If nextAction=dispatch_codegen_only, DO NOT dispatch the coarse codegen sub-agent. Root/main must call web_generation_codegen_prepare, compare sectionCodegenContract.sections with existing targetNode.data.webPageSectionDrafts, and dispatch Agent({subagent_type:\"section_codegen\", result_mode:\"full\", task_contract:{kind:\"webhero_section_codegen\", ...}}) only for missing or invalid sections. Persist the exact successful structuredOutput for each section; the runtime injects codegenProvenance. Never hand-author, edit, or normalize drafts in the parent. A timeout, failure, blocked/null output, legacy htmlDraft/cssDraft alias, or provenance mismatch requires rerunning only that section. After all required sections are persisted, call webhero_debug_resume_plan again.",
        "[REQUIRED] If nextAction=dispatch_merge_only, do NOT dispatch codegen again. The root agent must directly dispatch Agent({subagent_type:\"webhero_merge_codegen\", result_mode:\"compact\"}) for final merge/stage/commit.",
        "[REQUIRED] canvas_webhero_check_readiness(nodeId=targetNodeId).ready=true is required before staging final code. Readiness is a hard WebHero code gate for the exact target-node field shape; do not rely on equivalent metadata in text nodes, workflowContract aliases, implementation brief aliases, or htmlDraft/cssDraft aliases.",
        "[REQUIRED] Use a section-draft-plus-merge final path to control context size: root directly runs section_codegen per section ONLY when webhero_debug_resume_plan says dispatch_codegen_only; then root directly dispatches webhero_merge_codegen ONLY when it says dispatch_merge_only. Do NOT wrap all sections inside the coarse codegen sub-agent, and do NOT ask codegen to call webhero_merge_codegen as a nested child.",
        "[REQUIRED] BEFORE writing webHeroHtml/webHeroCss, you MUST call canvas_read_node_media_for_context with nodeIds=[<targetWebHeroNodeId>] so the approved preview screenshots and resolved asset images are loaded as multimodal input on the NEXT turn. Then visually inspect those preview images and treat them as the authoritative spec for layout, typography, color, and section composition. Do NOT write final code from prose-only memory. If canvas_read_node_media_for_context returns evaluate_node_media_missing, instead call it with nodeIds=[<each approvedPreviewNodes id>] explicitly.",
        "[REQUIRED] Read webPageResolvedAssets and reference independent asset URLs as img src / CSS background-image. Approved preview image URLs (from approvedPreviewNodes in webPageWorkflowContract) are reference-only multimodal evidence for style and layout; they MUST NEVER appear in final HTML/CSS as webpage media URLs. Match the previews' colors, layout proportions, typography, and overall aesthetic 1:1, but embed only resolved asset URLs or generated asset node URLs. DO NOT replace required resolved assets with handwritten CSS/SVG shapes.",
        "[REQUIRED] Stage only final webHeroHtml and webHeroCss through canvas_webhero_code_stage_raw_chunk, then call canvas_webhero_code_commit; the server derives and atomically persists webHeroDocumentHtml. Generic node patches cannot write final code.",
      ],
    },
  };
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(`${label} must be an object`, {
      status: 400,
      code: "invalid_tool_args",
    });
  }
  return value as Record<string, unknown>;
}

function readRecordArray(value: unknown, label: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new AppError(`${label} must be an array`, {
      status: 400,
      code: "invalid_tool_args",
    });
  }
  return value.map((item, index) => readRecord(item, `${label}[${index}]`));
}

function optionalNumberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = readTrimmedString(record[key]);
  return value || undefined;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === "boolean" ? record[key] : undefined;
}

function optionalRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!value) return {};
  return readRecord(value, key);
}

function readStringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const parsed = readTrimmedString(item);
    if (!parsed) {
      throw new AppError(`${key}[${index}] must be a non-empty string`, {
        status: 400,
        code: "invalid_tool_args",
      });
    }
    return parsed;
  });
}

function definedObjectEntries(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function trimToLength(value: unknown, limit: number): string {
  const text = readTrimmedString(value).replace(/\s+/g, " ");
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function readRequiredTrimmedString(record: Record<string, unknown>, key: string): string {
  const value = readTrimmedString(record[key]);
  if (!value) {
    throw new AppError(`${key} is required`, {
      status: 400,
      code: "invalid_tool_args",
      details: { field: key },
    });
  }
  return value;
}

function parseToolArgs(
  toolSpec: CanvasToolSpec,
  rawArgs: Record<string, unknown>,
): Record<string, unknown> {
  const sanitizedArgs = stripAgentPositions(rawArgs) as Record<string, unknown>;
  const parsed = toolSpec.zodInputSchema.safeParse(sanitizedArgs);
  if (!parsed.success) {
    const hasWorkflowFieldPathIssue = toolSpec.name === "canvas_update_node_data" &&
      parsed.error.issues.some((issue) =>
        issue.code === z.ZodIssueCode.custom &&
        issue.params?.[WEBHERO_WORKFLOW_FIELD_PATH_ISSUE_PARAM] === WEBHERO_WORKFLOW_FIELD_PATH_ERROR.code,
      );
    if (hasWorkflowFieldPathIssue && Array.isArray(sanitizedArgs.patchNodeData)) {
      for (const item of sanitizedArgs.patchNodeData) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const record = item as Record<string, unknown>;
        const data = record.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) continue;
        const fields = findMisplacedWebHeroWorkflowFields(data as Record<string, unknown>);
        if (fields.length < 1) continue;
        throw new AppError(WEBHERO_WORKFLOW_FIELD_PATH_ERROR.message, {
          status: 400,
          code: WEBHERO_WORKFLOW_FIELD_PATH_ERROR.code,
          details: {
            nodeId: typeof record.id === "string" ? record.id : null,
            fields,
            requiredPaths: requiredWebHeroWorkflowFieldPaths(fields),
          },
        });
      }
    }
    throw new AppError("Invalid tool arguments", {
      status: 400,
      code: "invalid_tool_args",
      details: {
        toolName: toolSpec.name,
        issues: parsed.error.issues,
      },
    });
  }
  const data = parsed.data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
}


function buildSemanticFlowPatch(handler: CanvasToolHandler, args: Record<string, unknown>): SemanticPatchResult | null {
  if (handler === "create_text_node") {
    const node = readRecord(args.node, "node");
    const id = optionalString(node, "id");
    const data = optionalRecord(node, "data");
    return {
      patch: {
        createNodes: [
          definedObjectEntries({
            ...(id ? { id } : {}),
            type: "taskNode",
            parentId: optionalString(node, "parentId"),
            selected: optionalBoolean(node, "selected"),
            data: {
              ...data,
              kind: "text",
            },
          }),
        ],
      },
      effects: {
        ...(id ? { createdNodeIds: [id] } : {}),
        wroteCanvas: true,
      },
    };
  }
  if (handler === "create_webhero_node") {
    const node = readRecord(args.node, "node");
    const id = optionalString(node, "id");
    const data = optionalRecord(node, "data");
    const nodeId = id || crypto.randomUUID();
    const existingContract = data.webPageWorkflowContract &&
      typeof data.webPageWorkflowContract === "object" &&
      !Array.isArray(data.webPageWorkflowContract)
      ? data.webPageWorkflowContract
      : null;
    const existingGoalContract = data.webHeroGoalContract &&
      typeof data.webHeroGoalContract === "object" &&
      !Array.isArray(data.webHeroGoalContract)
      ? data.webHeroGoalContract
      : null;
    return {
      patch: {
        createNodes: [
          definedObjectEntries({
            id: nodeId,
            type: "taskNode",
            parentId: optionalString(node, "parentId"),
            selected: optionalBoolean(node, "selected"),
            data: {
              ...data,
              kind: "webHero",
              webPageWorkflowContract: existingContract || buildDefaultWebPageWorkflowContract({ nodeId, data }),
              webHeroGoalContract: existingGoalContract || buildDefaultWebHeroGoalContract({
                nodeId,
                goal: readTrimmedString(data.prompt) || readTrimmedString(data.label),
                currentStep: "style_reference_selection",
              }),
            },
          }),
        ],
      },
      effects: {
        createdNodeIds: [nodeId],
        wroteCanvas: true,
      },
    };
  }
  if (handler === "create_ppt_node") {
    const node = readRecord(args.node, "node");
    const id = optionalString(node, "id");
    const data = optionalRecord(node, "data");
    const nodeId = id || crypto.randomUUID();
    const slideCount = typeof data.slideCount === "number" && Number.isFinite(data.slideCount)
      ? Math.max(1, Math.min(80, Math.round(data.slideCount)))
      : undefined;
    return {
      patch: {
        createNodes: [
          definedObjectEntries({
            id: nodeId,
            type: "taskNode",
            parentId: optionalString(node, "parentId"),
            selected: optionalBoolean(node, "selected"),
            data: {
              ...data,
              kind: "pptDeck",
              label: readTrimmedString(data.label) || "PPT Deck",
              format: readTrimmedString(data.format) || "ppt169",
              ...(slideCount ? { slideCount } : {}),
            },
          }),
        ],
      },
      effects: {
        createdNodeIds: [nodeId],
        wroteCanvas: true,
      },
    };
  }
  if (handler === "create_group") {
    const group = readRecord(args.group, "group");
    const id = optionalString(group, "id");
    return {
      patch: {
        createNodes: [
          definedObjectEntries({
            ...(id ? { id } : {}),
            type: "groupNode",
            parentId: optionalString(group, "parentId"),
            selected: optionalBoolean(group, "selected"),
            data: definedObjectEntries({
              label: optionalString(group, "label") || "",
              isGroup: true,
              groupKind: optionalString(group, "groupKind"),
            }),
            style: {
              width: optionalNumberField(group, "width") ?? GROUP_MIN_WIDTH,
              height: optionalNumberField(group, "height") ?? GROUP_MIN_HEIGHT,
            },
          }),
        ],
      },
      effects: {
        ...(id ? { createdNodeIds: [id] } : {}),
        wroteCanvas: true,
      },
    };
  }
  if (handler === "connect_nodes") {
    return {
      patch: {
        createEdges: readRecordArray(args.edges, "edges"),
      },
      effects: { wroteCanvas: true },
    };
  }
  if (handler === "bind_references") {
    const bindings = readRecordArray(args.bindings, "bindings");
    const patchNodeData = bindings.map((binding) => {
      const nodeId = readTrimmedString(binding.nodeId);
      if (!nodeId) {
        throw new AppError("bindings[].nodeId is required", {
          status: 400,
          code: "invalid_tool_args",
        });
      }
      return {
        id: nodeId,
        data: definedObjectEntries({
          referenceImages: binding.referenceImages,
          assetInputs: binding.assetInputs,
          anchorBindings: binding.anchorBindings,
        }),
      };
    });
    return {
      patch: { patchNodeData },
      effects: {
        updatedNodeIds: patchNodeData.map((item) => item.id),
        wroteCanvas: true,
      },
    };
  }
  if (handler === "update_node_data") {
	return buildUpdateNodeDataSemanticPatch(readRecordArray(args.patchNodeData, "patchNodeData"));
  }
  if (handler === "delete_canvas_items") {
    const nodeIds = readStringArrayField(args, "nodeIds");
    const edgeIds = readStringArrayField(args, "edgeIds");
    assertNonEmptyCanvasDelete({ nodeIds, edgeIds });
    return {
      patch: {
        ...(nodeIds.length > 0 ? { deleteNodeIds: nodeIds } : {}),
        ...(edgeIds.length > 0 ? { deleteEdgeIds: edgeIds } : {}),
      },
      effects: {
        ...(nodeIds.length > 0 ? { deletedNodeIds: nodeIds } : {}),
        ...(edgeIds.length > 0 ? { deletedEdgeIds: edgeIds } : {}),
        wroteCanvas: true,
      },
    };
  }
  return null;
}

function mediaResultEffects(
  result: unknown,
  mode: "created" | "updated",
  options?: { includePendingTask?: boolean; pendingWritesCanvas?: boolean },
): ToolResultEffects {
  const record = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
  const nodeId = readTrimmedString(record.nodeId);
  const taskId = readTrimmedString(record.taskId);
  const imageUrl = readTrimmedString(record.imageUrl);
  const videoUrl = readTrimmedString(record.videoUrl);
  const status = readTrimmedString(record.status);
  const pending = record.pending === true || status === "pending";
  const wroteCanvas = !pending || options?.pendingWritesCanvas === true;
  return {
    ...(wroteCanvas && nodeId && mode === "created" ? { createdNodeIds: [nodeId] } : {}),
    ...(wroteCanvas && nodeId && mode === "updated" ? { updatedNodeIds: [nodeId] } : {}),
    ...(wroteCanvas && taskId && options?.includePendingTask ? { pendingTaskIds: [taskId] } : {}),
    ...(wroteCanvas && (imageUrl || videoUrl) ? { createdAssetUrls: [imageUrl || videoUrl] } : {}),
    wroteCanvas,
  };
}

type ToolInvocationRuntime = {
  id: string;
} | null;

async function prepareToolInvocation(input: {
  c: Context<AppEnv>;
  toolSpec: CanvasToolSpec;
  body: z.infer<typeof AgentsToolExecuteRequestSchema>;
  ownerId: string;
  projectId: string;
  flowId: string;
  nodeId: string;
}): Promise<
  | { kind: "none"; invocation: null }
  | { kind: "execute"; invocation: ToolInvocationRuntime }
  | { kind: "cached"; envelope: ToolResultEnvelope }
> {
  if (!requiresToolInvocationIdempotency(input.toolSpec.effects)) {
    return { kind: "none", invocation: null };
  }
  const idempotencyKey = readTrimmedString(input.body.run?.idempotencyKey);
  if (!idempotencyKey) {
    throw new AppError("Idempotency key required", {
      status: 400,
      code: "idempotency_key_required",
      details: { toolName: input.toolSpec.name },
    });
  }
  const contextHash = await buildToolInvocationContextHash({
    toolName: input.toolSpec.name,
    providerKind: input.body.providerKind,
    context: {
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.flowId ? { flowId: input.flowId } : {}),
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    },
    args: input.body.args,
  });
  const existing = await findToolInvocationByKey(input.c.env.DB, {
    principalKey: input.ownerId,
    idempotencyKey,
  });
  const decision = decideToolInvocation({ existing, contextHash });
  if (decision.kind === "cached") {
    return { kind: "cached", envelope: decision.envelope };
  }
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const created = await createRunningToolInvocation(input.c.env.DB, {
    id,
    principalKey: input.ownerId,
    idempotencyKey,
    toolName: input.toolSpec.name,
    contextHash,
    nowIso,
  });
  if (!created) {
    // 并发下另一个请求已抢先占用同一 idempotency key：重查后交给 decideToolInvocation，
    // 命中缓存则返回结果，仍在运行则优雅抛出"进行中"(409 tool_idempotency_in_progress)。
    const raced = await findToolInvocationByKey(input.c.env.DB, {
      principalKey: input.ownerId,
      idempotencyKey,
    });
    const racedDecision = decideToolInvocation({ existing: raced, contextHash });
    if (racedDecision.kind === "cached") {
      return { kind: "cached", envelope: racedDecision.envelope };
    }
    throw new AppError("Unable to reserve tool invocation idempotency key", {
      status: 409,
      code: "tool_idempotency_reservation_failed",
    });
  }
  return { kind: "execute", invocation: { id } };
}

function resolveFlowVersionUserId(input: { devBypass: boolean; requestUserId: string; flowOwnerId: string | null }): string {
  if (!input.devBypass) return input.requestUserId;
  const ownerId = String(input.flowOwnerId || "").trim();
  if (!ownerId) {
    throw new AppError("Flow owner missing", {
      status: 500,
      code: "flow_owner_missing",
    });
  }
  return ownerId;
}

function resolveProjectOwnerUserId(input: {
  devBypass: boolean;
  requestUserId: string;
  projectOwnerId: string | null;
}): string {
  if (!input.devBypass) return input.requestUserId;
  const ownerId = String(input.projectOwnerId || "").trim();
  if (!ownerId) {
    throw new AppError("Project owner missing", {
      status: 500,
      code: "project_owner_missing",
    });
  }
  return ownerId;
}

const PublicAgentsToolExecuteRoute = createRoute({
  method: "post",
  path: "/agents/tools/execute",
  tags: ["Public API"],
  summary: "Execute project-scoped agents bridge tools",
  request: {
    body: {
      content: {
        "application/json": {
          schema: AgentsToolExecuteRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: AgentsToolExecuteResponseSchema,
        },
      },
      description: "OK",
    },
  },
});

function mergePptContractStepStatus(
  graph: unknown,
  nodeId: string,
  patch: Record<string, "completed" | "pending" | "blocked">,
): Record<string, unknown> {
  const contract = findNodeDataInGraph(graph, nodeId).pptMasterWorkflowContract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new AppError("PPT Master workflow contract is missing from the export snapshot", {
      status: 409,
      code: "ppt_master_not_ready",
      details: { nodeId },
    });
  }
  const cloned = JSON.parse(JSON.stringify(contract)) as Record<string, unknown>;
  const stepStatus = cloned.stepStatus && typeof cloned.stepStatus === "object" && !Array.isArray(cloned.stepStatus)
    ? cloned.stepStatus as Record<string, unknown>
    : {};
  cloned.stepStatus = { ...stepStatus, ...patch };
  return cloned;
}

export function registerPublicAgentsToolBridgeRoutes(publicApiRouter: OpenAPIHono<AppEnv>) {
  publicApiRouter.openapi(PublicAgentsToolExecuteRoute, async (c) => {
    let activeInvocation: ToolInvocationRuntime = null;
    let activeWebHeroCommit: { session: WebHeroCodeStageCommitting } | null = null;
	let completedWebHeroCommitResponse: Record<string, unknown> | null = null;
    let webHeroVersionCreatedInTransaction = false;
    try {
      const requestUserId = requireUserId(c);
      const devBypass = isDevBypassEnabled(c);
      const body = AgentsToolExecuteRequestSchema.parse(await c.req.json());
      const toolSpec = getCanvasToolSpec(body.toolName);
    if (!toolSpec) {
      throw new AppError("Unknown agents tool", {
        status: 404,
        code: "agents_tool_unknown",
      });
    }
    if (toolSpec.exposure !== "agent" && !devBypass) {
      throw new AppError("Tool is internal only", {
        status: 403,
        code: "agents_tool_internal_only",
      });
    }
    const toolArgs = parseToolArgs(toolSpec, body.args);
    const parsedBody = { ...body, args: toolArgs };
    const projectId = String(body.context?.projectId || "").trim();
    const flowId = String(body.context?.flowId || "").trim();
    const requestNodeId = String(body.context?.nodeId || "").trim();
    const handler = toolSpec.handler;
    const flowScopedToolRequested = toolSpec.scope === "flow" || toolSpec.scope === "node";
    if (flowScopedToolRequested && !flowId) {
      throw new AppError("Flow id required", {
        status: 400,
        code: "flow_id_required",
      });
    }
    if (toolSpec.scope === "project" && !projectId) {
      throw new AppError("Project id required", {
        status: 400,
        code: "project_id_required",
      });
    }
    if (
      (handler === "node_context_bundle_get" ||
        handler === "video_review_bundle_get" ||
        handler === "image_wait_for_result" ||
        handler === "video_wait_for_result") &&
      !requestNodeId &&
      !readTrimmedString(toolArgs.nodeId)
    ) {
      throw new AppError("Node id required", {
        status: 400,
        code: "node_id_required",
      });
    }

    const respond = (
      contentValue: unknown,
      dataValue: Record<string, unknown>,
      effects?: ToolResultEffects,
    ) => {
      const envelope = AgentsToolExecuteResponseSchema.parse({
        ok: true,
        content: typeof contentValue === "string" ? contentValue : JSON.stringify(contentValue),
        data: dataValue,
        effects: buildEffectsForToolResult(toolSpec, effects),
      }) as ToolResultEnvelope;
      const complete = async () => {
        if (activeInvocation) {
          await completeToolInvocation(c.env.DB, {
            id: activeInvocation.id,
            envelope,
            nowIso: new Date().toISOString(),
          });
        }
        return c.json(envelope, 200);
      };
      return complete();
    };

    if (handler === "project_flows_list") {
      const rows = devBypass
        ? await listFlowsByProject(c.env.DB, projectId)
        : await listFlowsByOwner(c.env.DB, requestUserId, projectId);
      const response = {
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          updatedAt: row.updated_at,
        })),
      };
      return respond(response, response);
    }

    if (handler === "project_context_get") {
      const context = await getUserProjectWorkspaceContext(c as never, requestUserId, {
        projectId,
        ...(toolArgs.refresh === true ? { refresh: true } : {}),
      });
      const parsed = ProjectWorkspaceContextSchema.parse(context);
      return respond(parsed, parsed as Record<string, unknown>);
    }

    const project = devBypass
      ? await getProjectById(c.env.DB, projectId)
      : await getProjectForOwner(c.env.DB, projectId, requestUserId);
    if (toolSpec.scope === "project") {
      if (!project) {
        throw new AppError("Project not found", {
          status: 404,
          code: "project_not_found",
        });
      }
      if (!isNodeRuntime()) {
        throw new AppError("Node runtime required", {
          status: 400,
          code: "node_runtime_required",
        });
      }
    }
    const projectOwnerUserId = flowScopedToolRequested
      ? requestUserId
	      : resolveProjectOwnerUserId({
	          devBypass,
	          requestUserId,
	          projectOwnerId: requestUserId,
	        });

    if (handler === "node_context_bundle_get") {
      const nodeId = readTrimmedString(toolArgs.nodeId) || requestNodeId;
      if (!nodeId) {
        throw new AppError("Node id required", {
          status: 400,
          code: "node_id_required",
        });
      }
      const bundle = await getNodeContextBundle({
        c: c as never,
        ownerId: projectOwnerUserId,
        projectId,
        flowId,
        nodeId,
      });
      return respond(bundle, bundle as unknown as Record<string, unknown>);
    }

    if (handler === "video_review_bundle_get") {
      const nodeId = readTrimmedString(toolArgs.nodeId) || requestNodeId;
      if (!nodeId) {
        throw new AppError("Node id required", {
          status: 400,
          code: "node_id_required",
        });
      }
      const bundle = await getVideoReviewBundle({
        c: c as never,
        ownerId: projectOwnerUserId,
        projectId,
        flowId,
        nodeId,
      });
      return respond(bundle, bundle as unknown as Record<string, unknown>);
    }

    if (handler === "pipeline_runs_list") {
      const limitRaw = Number(toolArgs.limit || 20);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 20;
      const runs = await listUserAgentPipelineRuns(c as never, requestUserId, { projectId, limit });
      const parsed = runs.map((item) => AgentPipelineRunSchema.parse(item));
      return respond(parsed, { items: parsed });
    }

    if (handler === "web_asset_search") {
      const result = await searchWebAssets({ bodyArgs: toolArgs });
      return respond(result, result as unknown as Record<string, unknown>);
    }

    if (handler === "web_style_reference_search") {
      const result = await searchWebStyleReferences({
        bodyArgs: toolArgs,
        c: c as never,
        requestUserId,
      });
      return respond(result, result as unknown as Record<string, unknown>);
    }

    if (handler === "pipeline_run_get") {
      const runId = readTrimmedString(toolArgs.runId);
      if (!runId) {
        throw new AppError("runId is required", {
          status: 400,
          code: "pipeline_run_id_required",
        });
      }
      const run = await getUserAgentPipelineRunById(c as never, requestUserId, runId);
      const parsed = AgentPipelineRunSchema.parse(run);
      return respond(parsed, parsed as Record<string, unknown>);
    }

    const row = devBypass
      ? await getFlowByIdUnsafe(c.env.DB, flowId)
      : await getFlowForOwner(c.env.DB, flowId, requestUserId);
    if (!row) {
      throw new AppError("Flow not found", {
        status: 404,
        code: "flow_not_found",
      });
    }
    assertFlowProjectScope({
      requestProjectId: projectId,
      flowProjectId: row.project_id,
    });
	let rowForPatch = row;

    const invocation = await prepareToolInvocation({
      c,
      toolSpec,
      body: parsedBody,
      ownerId: requestUserId,
      projectId,
      flowId,
      nodeId: requestNodeId,
    });
    if (invocation.kind === "cached") {
      return c.json(AgentsToolExecuteResponseSchema.parse(invocation.envelope), 200);
    }
    activeInvocation = invocation.invocation;

    if (handler === "executions_list") {
      const limitRaw = Number(toolArgs.limit || 20);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 20;
      const rows = await listExecutionsForOwnerFlow(c.env.DB, {
        ownerId: requestUserId,
        flowId,
        limit,
      });
      const parsed = rows.map((item) => WorkflowExecutionSchema.parse(mapExecutionRow(item)));
      return respond(parsed, { items: parsed });
    }

    if (handler === "execution_get") {
      const executionId = readTrimmedString(toolArgs.executionId);
      if (!executionId) {
        throw new AppError("executionId is required", {
          status: 400,
          code: "execution_id_required",
        });
      }
      const execution = await getExecutionForOwner(c.env.DB, executionId, requestUserId);
      if (!execution) {
        throw new AppError("Execution not found", {
          status: 404,
          code: "execution_not_found",
        });
      }
      const parsed = WorkflowExecutionSchema.parse(mapExecutionRow(execution));
      return respond(parsed, parsed as Record<string, unknown>);
    }

    if (handler === "execution_node_runs_get") {
      const executionId = readTrimmedString(toolArgs.executionId);
      if (!executionId) {
        throw new AppError("executionId is required", {
          status: 400,
          code: "execution_id_required",
        });
      }
      const rows = await listNodeRunsForExecutionOwner(c.env.DB, {
        ownerId: requestUserId,
        executionId,
      });
      const parsed = rows.map((item) => WorkflowNodeRunSchema.parse(mapNodeRunRow(item)));
      return respond(parsed, { items: parsed });
    }

    if (handler === "execution_events_list") {
      const executionId = readTrimmedString(toolArgs.executionId);
      if (!executionId) {
        throw new AppError("executionId is required", {
          status: 400,
          code: "execution_id_required",
        });
      }
      const afterSeqRaw = Number(toolArgs.afterSeq || 0);
      const afterSeq = Number.isFinite(afterSeqRaw) ? Math.max(0, Math.trunc(afterSeqRaw)) : 0;
      const limitRaw = Number(toolArgs.limit || 50);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 50;
      const rows = await listExecutionEvents(c.env.DB, {
        executionId,
        afterSeq,
        limit,
      });
      const parsed = rows.map((item) => WorkflowExecutionEventSchema.parse(mapExecutionEventRow(item)));
      return respond(parsed, { items: parsed });
    }

    if (handler === "flow_get" || handler === "flow_inspect" || handler === "generation_context_get") {
      const dto = mapFlowRowToDto(row);
      const data = sanitizeFlowDataForStorage(dto.data ?? {});
      const parsed = PublicFlowGraphSchema.safeParse(data);
      if (!parsed.success) {
        throw new AppError("Flow data invalid", {
          status: 500,
          code: "flow_data_invalid",
          details: { issues: parsed.error.issues },
        });
      }

      if (handler === "flow_inspect") {
        const result = inspectCanvasFlowGraph({
          flowId,
          updatedAt: dto.updatedAt,
          graph: parsed.data,
          args: toolArgs,
        });
        return respond(result, result as unknown as Record<string, unknown>);
      }

      if (handler === "generation_context_get") {
        const nodeId = readTrimmedString(toolArgs.nodeId);
        const result = nodeId
          ? getCanvasGenerationContextFromGraph({ flowId, graph: parsed.data, nodeId })
          : null;
        if (!result) {
          throw new AppError("Node not found", {
            status: 404,
            code: "node_not_found",
          });
        }
        return respond(result, result as unknown as Record<string, unknown>);
      }

      const response = PublicFlowGetResponseSchema.parse({ ...dto, data: parsed.data });
      return respond(response, response as unknown as Record<string, unknown>);
    }

    if (handler === "evaluate_node_read_media") {
      const result = await evaluateNodeReadMedia({
        c: c as never,
        flowId,
        row,
        bodyArgs: toolArgs,
        runContext: body.run,
      });
      return respond(result, result as unknown as Record<string, unknown>);
    }

    if (handler === "flow_checkpoint_create") {
      const result = await createAgentCheckpoint({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: toolArgs,
      });
      return respond(result, result as unknown as Record<string, unknown>);
    }

    if (handler === "flow_checkpoint_restore") {
      const result = await restoreAgentCheckpoint({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: toolArgs,
      });
      return respond(result, result as unknown as Record<string, unknown>);
    }

    if (handler === "flow_checkpoint_list") {
      const result = await listAgentCheckpoints({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: toolArgs,
      });
      return respond(result, result as unknown as Record<string, unknown>);
    }

    if (handler === "image_generate_to_canvas") {
      const generated = await generateImageToCanvas({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: toolArgs,
        runContext: body.run,
      });
      return respond(generated, generated as unknown as Record<string, unknown>, mediaResultEffects(generated, "created", { includePendingTask: true, pendingWritesCanvas: true }));
    }

    if (handler === "image_wait_for_result") {
      const result = await waitForImageResultToCanvas({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        requestNodeId,
        bodyArgs: toolArgs,
      });
      return respond(result, result as unknown as Record<string, unknown>, mediaResultEffects(result, "updated"));
    }

    if (handler === "video_generate_to_canvas") {
      const generated = await generateVideoToCanvas({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: toolArgs,
        runContext: body.run,
      });
      return respond(generated, generated as unknown as Record<string, unknown>, mediaResultEffects(generated, "created", { includePendingTask: true, pendingWritesCanvas: true }));
    }

    if (handler === "video_wait_for_result") {
      const result = await waitForVideoResultToCanvas({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        requestNodeId,
        bodyArgs: toolArgs,
      });
      return respond(result, result as unknown as Record<string, unknown>, mediaResultEffects(result, "updated"));
    }

    if (handler === "video_concat_to_canvas") {
      const result = await concatVideoToCanvas({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: toolArgs,
        runContext: body.run,
      });
      return respond(result, result as unknown as Record<string, unknown>, mediaResultEffects(result, "created"));
    }

    if (handler === "reflow_layout") {
      const rawScope = toolArgs.scope;
      if (rawScope !== "canvas" && rawScope !== "topLevelGroups" && rawScope !== "group") {
        throw new AppError("reflow_layout requires scope to be one of canvas | topLevelGroups | group", {
          status: 400,
          code: "reflow_layout_invalid_args",
          details: { field: "scope", got: rawScope },
        });
      }
      const targetGroupIdRaw = toolArgs.targetGroupId;
      const targetGroupId =
        typeof targetGroupIdRaw === "string" ? targetGroupIdRaw.trim() : "";
      if (rawScope === "group" && !targetGroupId) {
        throw new AppError("reflow_layout scope=group requires non-empty targetGroupId", {
          status: 400,
          code: "reflow_layout_invalid_args",
          details: { field: "targetGroupId" },
        });
      }
      if (
        rawScope !== "group" &&
        targetGroupIdRaw !== undefined &&
        typeof targetGroupIdRaw !== "string"
      ) {
        throw new AppError("reflow_layout targetGroupId must be a string when provided", {
          status: 400,
          code: "reflow_layout_invalid_args",
          details: { field: "targetGroupId" },
        });
      }
      const focusNodeIdRaw = toolArgs.focusNodeId;
      if (focusNodeIdRaw !== undefined && typeof focusNodeIdRaw !== "string") {
        throw new AppError("reflow_layout focusNodeId must be a string when provided", {
          status: 400,
          code: "reflow_layout_invalid_args",
          details: { field: "focusNodeId" },
        });
      }
      const focusNodeId =
        typeof focusNodeIdRaw === "string" ? focusNodeIdRaw.trim() : "";
      const echo: Record<string, unknown> = { scope: rawScope };
      if (rawScope === "group" && targetGroupId) echo.targetGroupId = targetGroupId;
      if (rawScope === "canvas" && focusNodeId) echo.focusNodeId = focusNodeId;
      const messageZh =
        rawScope === "group"
          ? `已请求重排组 ${targetGroupId} 的内部布局`
          : rawScope === "topLevelGroups"
            ? "已请求重排顶层分组布局"
            : focusNodeId
              ? `已请求重排画布并聚焦节点 ${focusNodeId}`
              : "已请求重排画布布局";
      return respond(messageZh, { message: messageZh, ...echo });
    }

    if (handler === "group_existing_nodes") {
      const rawNodeIds = toolArgs.nodeIds;
      if (!Array.isArray(rawNodeIds)) {
        throw new AppError("group_existing_nodes requires nodeIds to be an array of strings", {
          status: 400,
          code: "group_existing_nodes_invalid_args",
          details: { field: "nodeIds" },
        });
      }
      if (rawNodeIds.length < 1 || rawNodeIds.length > 200) {
        throw new AppError("group_existing_nodes requires nodeIds length between 1 and 200", {
          status: 400,
          code: "group_existing_nodes_invalid_args",
          details: { field: "nodeIds", length: rawNodeIds.length },
        });
      }
      const seenNodeIds = new Set<string>();
      const nodeIds: string[] = [];
      for (const raw of rawNodeIds) {
        if (typeof raw !== "string") {
          throw new AppError("group_existing_nodes nodeIds must be non-empty strings", {
            status: 400,
            code: "group_existing_nodes_invalid_args",
            details: { field: "nodeIds.item" },
          });
        }
        const trimmed = raw.trim();
        if (!trimmed) continue;
        if (seenNodeIds.has(trimmed)) continue;
        seenNodeIds.add(trimmed);
        nodeIds.push(trimmed);
      }
      if (nodeIds.length < 1) {
        throw new AppError("group_existing_nodes requires at least one non-empty node id", {
          status: 400,
          code: "group_existing_nodes_invalid_args",
          details: { field: "nodeIds" },
        });
      }
      const labelRaw = toolArgs.label;
      if (labelRaw !== undefined && typeof labelRaw !== "string") {
        throw new AppError("group_existing_nodes label must be a string when provided", {
          status: 400,
          code: "group_existing_nodes_invalid_args",
          details: { field: "label" },
        });
      }
      const label = typeof labelRaw === "string" ? labelRaw.trim() : "";
      if (labelRaw !== undefined && (label.length < 1 || label.length > 80)) {
        throw new AppError("group_existing_nodes label must be 1..80 chars after trimming", {
          status: 400,
          code: "group_existing_nodes_invalid_args",
          details: { field: "label", length: label.length },
        });
      }
      const groupEcho: Record<string, unknown> = { nodeIds };
      if (label) groupEcho.label = label;
      const groupMessageZh = label
        ? `已请求把 ${nodeIds.length} 个节点包入新组「${label}」`
        : `已请求把 ${nodeIds.length} 个节点包入新组`;
      return respond(groupMessageZh, { message: groupMessageZh, ...groupEcho });
    }

    if (handler === "ppt_master_check_readiness") {
      const nodeId = readTrimmedString(body.args.nodeId);
      if (!nodeId) {
        throw new AppError("nodeId is required", {
          status: 400,
          code: "invalid_tool_args",
          details: { field: "nodeId" },
        });
      }
      const row = await getFlowByIdUnsafe(c.env.DB, flowId);
      if (!row) {
        throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
      }
      assertFlowProjectScope({ requestProjectId: projectId, flowProjectId: row.project_id });
      const dto = mapFlowRowToDto(row);
      const current = sanitizeFlowDataForStorage(dto.data ?? {});
      const currentParsed = PublicFlowGraphSchema.safeParse(current);
      if (!currentParsed.success) {
        throw new AppError("Flow data invalid", {
          status: 500,
          code: "flow_data_invalid",
        });
      }
      const report = checkPptDeckReadiness(
        currentParsed.data as { nodes?: unknown[] },
        nodeId,
        { projectId: requirePptMasterFlowProjectId(row.project_id), flowId },
      );
      return respond(
        report.ready
          ? `PPT Master readiness PASSED: ${report.detail}`
          : `PPT Master readiness FAILED: ${report.detail}`,
        {
          ok: true,
          ready: report.ready,
          stepStatus: report.stepStatus,
          missing: report.missing,
          projectPath: report.projectPath,
          slideCount: report.slideCount,
          pptxUrl: report.pptxUrl,
          detail: report.detail,
        },
        undefined,
      );
    }

    if (handler === "webhero_check_readiness") {
      const nodeId = readTrimmedString(body.args.nodeId);
      if (!nodeId) {
        throw new AppError("nodeId is required", {
          status: 400,
          code: "invalid_tool_args",
          details: { field: "nodeId" },
        });
      }
      const dto = mapFlowRowToDto(row);
      const current = sanitizeFlowDataForStorage(dto.data ?? {});
      const currentParsed = PublicFlowGraphSchema.safeParse(current);
      if (!currentParsed.success) {
        throw new AppError("Flow data invalid", {
          status: 500,
          code: "flow_data_invalid",
        });
      }
      const result = checkWebHeroReadiness(currentParsed.data, nodeId);
      const content = result.ready
        ? "WebHero readiness check PASSED: " + result.detail + "\n\n" +
          buildWebHeroMergeDispatchSnapshotText({
            flowUpdatedAt: row.updated_at,
            codeInputDigest: result.codeInputDigest,
            previewNodeIds: result.previewNodeIds,
          })
        : "WebHero readiness check FAILED: " + result.detail;
      return respond(
        content,
        {
          ok: true,
          ready: result.ready,
          stepStatus: result.stepStatus,
          missing: result.missing,
          previewNodeCount: result.previewNodeCount,
          previewNodeIds: result.previewNodeIds,
		  codeInputDigest: result.codeInputDigest,
          flowUpdatedAt: row.updated_at,
          detail: result.detail,
        },
        undefined,
      );
    }

    if (handler === "webhero_code_stage_chunk" || handler === "webhero_code_stage_raw_chunk") {
      const identity = readWebHeroCodeStageIdentity(toolArgs);
      const requestedSnapshot = readWebHeroCodeReadinessSnapshot(toolArgs);
      const dto = mapFlowRowToDto(row);
      const current = sanitizeFlowDataForStorage(dto.data ?? {});
      const currentParsed = PublicFlowGraphSchema.safeParse(current);
      if (!currentParsed.success) {
        throw new AppError("Flow data invalid", {
          status: 500,
          code: "flow_data_invalid",
          details: { issues: currentParsed.error.issues },
        });
      }
      assertWebHeroReadyForFinalCode(currentParsed.data, identity.nodeId);
      const readiness = checkWebHeroReadiness(currentParsed.data, identity.nodeId);
      assertWebHeroCodeReadinessSnapshotMatches(requestedSnapshot, {
        flowUpdatedAt: row.updated_at,
        previewNodeIds: readiness.previewNodeIds,
		codeInputDigest: readiness.codeInputDigest,
      });
      await deleteExpiredWebHeroCodeStageSessions(c.env.DB, {
        beforeIso: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        excludeIdentity: { flowId, ...identity },
      });
      const existing = await findWebHeroCodeStageSession(c.env.DB, {
        flowId,
        nodeId: identity.nodeId,
        sessionId: identity.sessionId,
      });
      const command = stageWebHeroCodeChunkCommand(existing, flowId, toolArgs);
      const saved = await saveWebHeroCodeStageSession(c.env.DB, {
        session: command.session,
        expectedVersion: existing?.version ?? null,
      });
      const staged = { ...command.result, version: saved.version };
      const messageZh = `已暂存 WebHero 代码分片 ${staged.field} ${staged.index + 1}/${staged.total}`;
      return respond(messageZh, { ok: true, message: messageZh, ...staged }, {
        updatedNodeIds: [staged.nodeId],
        wroteCanvas: false,
      });
    }

    let semanticPatch: SemanticPatchResult | null = null;
    if (handler === "ppt_master_write_slide_svg") {
      const nodeId = readRequiredTrimmedString(body.args, "nodeId");
      const slideIndex = Number(body.args.slideIndex);
      const svgMarkup = readTrimmedString(body.args.svgMarkup);
      if (!svgMarkup) {
        throw new AppError("svgMarkup is required", {
          status: 400,
          code: "invalid_tool_args",
          details: { field: "svgMarkup" },
        });
      }
      // Resolve projectPath from the node.
      const row = await getFlowByIdUnsafe(c.env.DB, flowId);
      if (!row) {
        throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
      }
      assertFlowProjectScope({ requestProjectId: projectId, flowProjectId: row.project_id });
      rowForPatch = row;
      const dtoLocal = mapFlowRowToDto(row);
      const dataLocal = sanitizeFlowDataForStorage(dtoLocal.data ?? {});
      const parsedLocal = PublicFlowGraphSchema.safeParse(dataLocal);
      if (!parsedLocal.success) {
        throw new AppError("Flow data invalid", { status: 500, code: "flow_data_invalid" });
      }
      const nodesLocal = (parsedLocal.data as { nodes?: Array<{ id?: string; data?: Record<string, unknown> }> }).nodes ?? [];
      const targetNode = nodesLocal.find((node) => node && node.id === nodeId);
      if (!targetNode || !targetNode.data) {
        throw new AppError("Target pptDeck node not found", {
          status: 404,
          code: "ppt_master_node_missing",
          details: { nodeId },
        });
      }
      const projectPath = readTrimmedString(targetNode.data.pptMasterProjectPath);
      if (!projectPath) {
        throw new AppError(
          "pptMasterProjectPath missing on node; run canvas_ppt_master_project_init first",
          { status: 409, code: "ppt_master_project_path_missing" },
        );
      }
      const workspaceId = readPptDeckWorkspaceId(parsedLocal.data, nodeId);
      assertPptMasterProjectOwnedByScope(projectPath, {
        projectId: requirePptMasterFlowProjectId(row.project_id),
        flowId,
        nodeId,
        workspaceId,
      });
      const origin = new URL(c.req.url).origin;
      const matchedSlides = Array.isArray(targetNode.data.slides)
        ? (targetNode.data.slides as Array<Record<string, unknown>>).filter((slide) => {
            const index = Number(slide && slide.index);
            return Number.isFinite(index) && index === slideIndex;
          })
        : [];
      if (matchedSlides.length !== 1) {
        throw new AppError("slideIndex must match exactly one persisted PPT slide", {
          status: 409,
          code: "ppt_master_slide_index_invalid",
          details: { nodeId, slideIndex, matches: matchedSlides.length },
        });
      }
      const matchedSlide = matchedSlides[0] as Record<string, unknown>;
      // Invariant guard: slides[i].imageUrl is backend-derived from the generated
      // image node (see deriveSlideImageUrls) and therefore always a hosted URL.
      // This should never fire; it stays as a fail-loud regression tripwire in
      // case the derivation invariant is ever broken upstream.
      const slideImageUrl = readTrimmedString(matchedSlide.imageUrl);
      if (slideImageUrl && !isHostedAssetUrl(c, slideImageUrl)) {
        throw new AppError("PPT Master slide imageUrl must reference a persisted hosted asset", {
          status: 409,
          code: "ppt_master_slide_image_source_untrusted",
          details: { nodeId, slideIndex },
        });
      }
      const materialized = await materializePptMasterSlideImage({
        projectPath,
        slideIndex,
        svgMarkup,
        imageUrl: slideImageUrl,
      });
      const writeResult = await writePptMasterSlideSvg({
        projectPath,
        scope: { projectId: requirePptMasterFlowProjectId(row.project_id), flowId, nodeId, workspaceId },
        slideIndex,
        svg: materialized.svgMarkup,
      });

      const slideAbsolutePath = readTrimmedString(writeResult.absolutePath);
      const slideSvgUrl = buildPptMasterPublicAssetUrl(origin, slideAbsolutePath);

      // Patch the unique persisted slide entry that authorized this write.
      const existingSlides = Array.isArray(targetNode.data.slides) ? (targetNode.data.slides as Record<string, unknown>[]).slice() : [];
      const slot = existingSlides.indexOf(matchedSlide);
      const baseSlide = existingSlides[slot] as Record<string, unknown>;
      const nextSlide = {
        ...(baseSlide as Record<string, unknown>),
        svgUrl: slideSvgUrl,
        svgPath: slideAbsolutePath,
      };
      existingSlides[slot] = nextSlide;

      semanticPatch = {
        patch: {
          allowOverwrite: true,
          patchNodeData: [
            {
              id: nodeId,
              data: {
                slides: existingSlides,
                pptMasterStatus: "svg_in_progress",
                lastPptMasterSvgWrite: {
                  slideIndex: writeResult.slideIndex,
                  fileName: writeResult.fileName,
                  bytes: writeResult.bytes,
                },
              },
            },
          ],
        },
        effects: {
          updatedNodeIds: [nodeId],
          wroteCanvas: true,
        },
      };
    } else if (handler === "ppt_master_project_init") {
      const nodeId = readRequiredTrimmedString(body.args, "nodeId");
      const projectName = readRequiredTrimmedString(body.args, "projectName");
      const flowBeforeInit = sanitizeFlowDataForStorage(mapFlowRowToDto(row).data ?? {});
      const parsedFlowBeforeInit = PublicFlowGraphSchema.safeParse(flowBeforeInit);
      if (!parsedFlowBeforeInit.success) {
        throw new AppError("Flow data invalid", {
          status: 500,
          code: "flow_data_invalid",
          details: { issues: parsedFlowBeforeInit.error.issues },
        });
      }
      const result = await initializePptMasterProjectForDeck({
        graph: parsedFlowBeforeInit.data,
        projectId: requirePptMasterFlowProjectId(row.project_id),
        flowId,
        nodeId,
        projectName,
        format: readTrimmedString(body.args.format) || "ppt169",
        timeoutMs: typeof body.args.timeoutMs === "number" ? body.args.timeoutMs : undefined,
      });
	  const latestRowAfterInit = devBypass
		? await getFlowByIdUnsafe(c.env.DB, flowId)
		: await getFlowForOwner(c.env.DB, flowId, requestUserId);
	  if (!latestRowAfterInit) {
		throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
	  }
	  assertFlowProjectScope({
		requestProjectId: projectId,
		flowProjectId: latestRowAfterInit.project_id,
	  });
	  const latestFlowAfterInit = sanitizeFlowDataForStorage(
		mapFlowRowToDto(latestRowAfterInit).data ?? {},
	  );
	  const parsedLatestFlowAfterInit = PublicFlowGraphSchema.safeParse(latestFlowAfterInit);
	  if (!parsedLatestFlowAfterInit.success) {
		throw new AppError("Flow data invalid", {
		  status: 500,
		  code: "flow_data_invalid",
		  details: { issues: parsedLatestFlowAfterInit.error.issues },
		});
	  }
	  assertPptDeckProjectInitPreconditions(parsedLatestFlowAfterInit.data, nodeId);
	  rowForPatch = latestRowAfterInit;
      const resolvedProjectPath = readTrimmedString(result.projectPath);
      semanticPatch = {
        patch: {
          allowOverwrite: true,
          patchNodeData: [
            {
              id: nodeId,
              data: {
                pptMasterProjectPath: resolvedProjectPath,
                pptMasterRuntime: result.runtime,
                pptMasterStatus: "project_ready",
				pptMasterWorkflowContract: { stepStatus: { project_init: "completed" } },
                lastPptMasterStdout: trimToLength(result.stdout, 1600),
                lastPptMasterStderr: trimToLength(result.stderr, 1600),
              },
            },
          ],
        },
        effects: {
          updatedNodeIds: [nodeId],
          wroteCanvas: true,
        },
      };
    } else if (handler === "ppt_master_export_to_pptx") {
      const nodeId = readRequiredTrimmedString(body.args, "nodeId");
      const requestedProjectPath = readRequiredTrimmedString(body.args, "projectPath");

      // Readiness gate — must satisfy 6-step contract before export.
      const flowRow = await getFlowByIdUnsafe(c.env.DB, flowId);
      if (!flowRow) {
        throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
      }
      assertFlowProjectScope({ requestProjectId: projectId, flowProjectId: flowRow.project_id });
      rowForPatch = flowRow;
      const flowDtoForGate = mapFlowRowToDto(flowRow);
      const flowDataForGate = sanitizeFlowDataForStorage(flowDtoForGate.data ?? {});
      const gateParsed = PublicFlowGraphSchema.safeParse(flowDataForGate);
      if (!gateParsed.success) {
        throw new AppError("Flow data invalid", {
          status: 500,
          code: "flow_data_invalid",
          details: { issues: gateParsed.error.issues },
        });
      }
      const gateReport = checkPptDeckReadiness(
        gateParsed.data as { nodes?: unknown[] },
        nodeId,
        { projectId: requirePptMasterFlowProjectId(flowRow.project_id), flowId },
      );
      if (!gateReport.ready) {
        throw new AppError(
          "PPT Master readiness check failed; refusing to export",
          {
            status: 409,
            code: "ppt_master_not_ready",
            details: {
              ready: false,
              stepStatus: gateReport.stepStatus,
              missing: gateReport.missing,
              detail: gateReport.detail,
            },
          },
        );
      }
      const projectPath = assertPptDeckExportProjectPath(
        requestedProjectPath,
        gateReport.projectPath,
      );

      assertPptMasterSlideArtifactsValid(projectPath, gateReport.slideArtifacts);
      const result = await exportPptMasterProject({
        projectPath,
        scope: {
          projectId: requirePptMasterFlowProjectId(flowRow.project_id),
          flowId,
          nodeId,
          workspaceId: readPptDeckWorkspaceId(gateParsed.data, nodeId),
        },
        slideArtifacts: gateReport.slideArtifacts,
        timeoutMs: typeof body.args.timeoutMs === "number" ? body.args.timeoutMs : undefined,
      });
      const exportedPptxPath = readTrimmedString(result.pptxPath);
      const exportedPptxUrl = exportedPptxPath
        ? buildPptMasterPublicAssetUrl(new URL(c.req.url).origin, exportedPptxPath)
        : "";
      semanticPatch = {
        patch: {
          allowOverwrite: true,
          patchNodeData: [
            {
              id: nodeId,
              data: {
                pptMasterProjectPath: readTrimmedString(result.projectPath),
                pptxPath: exportedPptxPath,
                pptxUrl: exportedPptxUrl,
                pptMasterRuntime: result.runtime,
                pptMasterStatus: exportedPptxPath ? "exported" : "export_checked",
                pptMasterWorkflowContract: mergePptContractStepStatus(gateParsed.data, nodeId, {
                  export_pptx: exportedPptxPath ? "completed" : "blocked",
                }),
                lastPptMasterStdout: trimToLength(result.stdout, 1600),
                lastPptMasterStderr: trimToLength(result.stderr, 1600),
              },
            },
          ],
        },
        effects: {
          updatedNodeIds: [nodeId],
          createdAssetUrls: exportedPptxUrl ? [exportedPptxUrl] : [],
          wroteCanvas: true,
        },
      };
    } else if (handler === "webhero_code_commit") {
      const identity = readWebHeroCodeStageIdentity(toolArgs);
      const existing = await findWebHeroCodeStageSession(c.env.DB, {
        flowId,
        nodeId: identity.nodeId,
        sessionId: identity.sessionId,
      });
      const command = beginWebHeroCodeCommitCommand(existing, flowId, toolArgs);
      const outcome = command.outcome;
      if (outcome.kind === "idempotent") {
        if (command.session.status !== "committed") {
          throw new AppError("webHero idempotent commit returned a non-committed session", {
            status: 500,
            code: "webhero_code_commit_state_invalid",
          });
        }
		const committedFlowRow = devBypass
			? await getFlowByIdUnsafe(c.env.DB, flowId)
			: await getFlowForOwner(c.env.DB, flowId, requestUserId);
		if (!committedFlowRow) {
			throw new AppError("Flow not found after idempotent WebHero commit", {
				status: 404,
				code: "flow_not_found",
			});
		}
		const committedFlowData = sanitizeFlowDataForStorage(mapFlowRowToDto(committedFlowRow).data ?? {});
		const committedFlowParsed = PublicFlowGraphSchema.safeParse(committedFlowData);
		if (!committedFlowParsed.success) {
			throw new AppError("Flow data invalid after idempotent WebHero commit", {
				status: 500,
				code: "flow_data_invalid",
				details: { issues: committedFlowParsed.error.issues },
			});
		}
		if (computeWebHeroCodeInputDigest(committedFlowParsed.data, outcome.nodeId) !== command.session.codeInputDigest) {
			throw new AppError("Persisted WebHero inputs changed after the committed stage session", {
				status: 409,
				code: "webhero_code_commit_state_mismatch",
			});
		}
		const committedNodeData = findNodeDataInGraph(committedFlowParsed.data, outcome.nodeId);
		assertWebHeroCommittedNodeData(command.session, committedNodeData);
        const messageZh = `WebHero 代码已于 ${outcome.committedAt} 提交,本次重复请求按幂等处理`;
        return respond(
          messageZh,
          {
			...buildWebHeroCommitResponse({
				nodeId: outcome.nodeId,
				sessionId: outcome.sessionId,
				committedAt: outcome.committedAt,
				idempotent: true,
				nodeData: committedNodeData,
			}),
			message: messageZh,
			committedNodeIds: outcome.committedNodeIds,
			flowId,
			updatedAt: committedFlowRow.updated_at,
          },
          {
            updatedNodeIds: outcome.committedNodeIds,
            wroteCanvas: false,
          },
        );
      }
      if (command.session.status !== "committing") {
        throw new AppError("webHero code commit command did not enter committing state", {
          status: 500,
          code: "webhero_code_commit_state_invalid",
        });
      }
      const currentFlowData = sanitizeFlowDataForStorage(mapFlowRowToDto(row).data ?? {});
      const currentFlowParsed = PublicFlowGraphSchema.safeParse(currentFlowData);
      if (!currentFlowParsed.success) {
        throw new AppError("Flow data invalid", {
          status: 500,
          code: "flow_data_invalid",
          details: { issues: currentFlowParsed.error.issues },
        });
      }
      assertWebHeroReadyForFinalCode(currentFlowParsed.data, command.session.nodeId);
      const readiness = checkWebHeroReadiness(currentFlowParsed.data, command.session.nodeId);
      assertWebHeroCodeReadinessSnapshotMatches(command.session, {
        flowUpdatedAt: row.updated_at,
        previewNodeIds: readiness.previewNodeIds,
		codeInputDigest: readiness.codeInputDigest,
      });
      const patchNodeData = Array.isArray((outcome.patch as { patchNodeData?: unknown }).patchNodeData)
        ? (outcome.patch as { patchNodeData: Array<{ id?: unknown; data?: Record<string, unknown> }> }).patchNodeData
        : [];
      const targetPatch = patchNodeData.find((item) => readTrimmedString(item.id) === outcome.nodeId);
	  if (!targetPatch) {
		throw new AppError("WebHero commit patch is missing its target node", {
		  status: 500,
		  code: "webhero_code_commit_state_invalid",
		});
	  }
	  const materializedHtml = materializeWebHeroAssetReferences(
		currentFlowParsed.data,
		outcome.nodeId,
		typeof targetPatch.data?.webHeroHtml === "string" ? targetPatch.data.webHeroHtml : "",
	  );
	  const materializedCss = materializeWebHeroAssetReferences(
		currentFlowParsed.data,
		outcome.nodeId,
		typeof targetPatch.data?.webHeroCss === "string" ? targetPatch.data.webHeroCss : "",
	  );
	  const materializedSession = replaceWebHeroCodeStageContent(command.session, {
		html: materializedHtml,
		css: materializedCss,
	  });
	  activeWebHeroCommit = { session: materializedSession };
	  {
		const currentTargetData = findNodeDataInGraph(currentFlowData, outcome.nodeId);
		const styleReferenceUrls = readSelectedWebHeroStyleReference(currentTargetData)?.referenceUrls
		  .slice()
		  .sort() || [];
        targetPatch.data = {
          ...(targetPatch.data || {}),
		  webHeroHtml: materializedHtml,
		  webHeroCss: materializedCss,
		  webHeroDocumentHtml: buildWebHeroDocumentHtml(materializedHtml, materializedCss),
          webPageWorkflowContract: buildCompletedWebHeroWorkflowContract(currentFlowData, outcome.nodeId),
          webHeroGoalContract: buildCompletedWebHeroGoalContract(currentFlowData, outcome.nodeId),
		  webHeroFinalCodeStale: false,
		  webHeroCodeEvidence: {
			version: 2,
			sessionId: command.session.sessionId,
			styleReferenceUrls,
			previewNodeIds: command.session.previewNodeIds.slice().sort(),
			codeInputDigest: command.session.codeInputDigest,
		  },
        };
      }
      semanticPatch = { patch: outcome.patch, effects: outcome.effects };
    } else {
      semanticPatch = buildSemanticFlowPatch(handler, toolArgs);
    }
    const patchInput = semanticPatch?.patch || (handler === "flow_patch" ? toolArgs : null);
    if (!patchInput) {
      throw new AppError("Tool handler not implemented", {
        status: 500,
        code: "agents_tool_handler_not_implemented",
        details: { toolName: toolSpec.name, handler },
      });
    }
    const parsedPatch = PublicFlowPatchRequestSchema.safeParse(patchInput);
    if (!parsedPatch.success) {
      throw new AppError("Invalid flow patch request", {
        status: 400,
        code: "invalid_flow_patch_request",
        details: { issues: parsedPatch.error.issues },
      });
    }
    assertAgentPatchHasNoForbiddenModelKeys(parsedPatch.data);
    const dto = mapFlowRowToDto(rowForPatch);
    const current = sanitizeFlowDataForStorage(dto.data ?? {});
    const currentParsed = PublicFlowGraphSchema.safeParse(current);
    if (!currentParsed.success) {
      throw new AppError("Flow data invalid", {
        status: 500,
        code: "flow_data_invalid",
        details: { issues: currentParsed.error.issues },
      });
    }
    const webHeroPatchAuthority: WebHeroPatchAuthority =
      handler === "webhero_code_commit"
        ? "webhero_code_commit"
        : handler === "update_node_data"
          ? "webhero_transition"
          : "generic";
    assertCanonicalWebHeroStyleReferencePatch(
      narrowWebHeroPolicyGraph(currentParsed.data),
      parsedPatch.data,
      webHeroPatchAuthority,
    );
    assertWebHeroFinalCodePatchAllowed(
      currentParsed.data,
      parsedPatch.data,
      webHeroPatchAuthority,
    );
    assertPptDeckStepStatusTransition(currentParsed.data, parsedPatch.data, {
      projectId: requirePptMasterFlowProjectId(rowForPatch.project_id),
      flowId,
    });
    const applied = applyPublicFlowGraphPatch({
      current,
      patch: parsedPatch.data,
      origin: body.run,
      webHeroPatchAuthority,
      ...(handler === "ppt_master_project_init"
        ? { pptMasterWriteAuthority: "project_init" as const }
        : handler === "ppt_master_write_slide_svg"
          ? { pptMasterWriteAuthority: "svg_write" as const }
          : handler === "ppt_master_export_to_pptx"
            ? { pptMasterWriteAuthority: "export" as const }
            : {}),
    });
    const pptMasterRequiresCas = handler === "ppt_master_project_init"
      || handler === "ppt_master_write_slide_svg"
      || handler === "ppt_master_export_to_pptx";
    const candidateNowIso = new Date().toISOString();
    const nowIso = activeWebHeroCommit
		  ? nextWebHeroFlowRevision(activeWebHeroCommit.session.flowUpdatedAt, candidateNowIso)
		  : pptMasterRequiresCas
			  ? nextPptMasterFlowRevision(rowForPatch.updated_at, candidateNowIso)
			  : candidateNowIso;
    const sanitizedNext = sanitizeFlowDataForStorage(applied.data);
    const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
    if (!nextParsed.success) {
      throw new AppError("Flow patch produced invalid data", {
        status: 500,
        code: "flow_patch_invalid",
        details: { issues: nextParsed.error.issues },
      });
    }
    const nextJson = JSON.stringify(sanitizedNext ?? {});
    let updated;
    if (activeWebHeroCommit) {
		const completedSession = completeWebHeroCodeCommitCommand(activeWebHeroCommit.session, nowIso);
		const completedNodeData = findNodeDataInGraph(nextParsed.data, completedSession.nodeId);
		assertWebHeroCommittedNodeData(
		  completedSession,
		  completedNodeData,
		);
		completedWebHeroCommitResponse = buildWebHeroCommitResponse({
			nodeId: completedSession.nodeId,
			sessionId: completedSession.sessionId,
			committedAt: completedSession.committedAt,
			idempotent: false,
			nodeData: completedNodeData,
		});
      const committed = await commitWebHeroFlowAndStageSession(c.env.DB, {
        session: completedSession,
        expectedVersion: activeWebHeroCommit.session.version,
        flow: {
          id: flowId,
			name: rowForPatch.name,
			data: nextJson,
			projectId: rowForPatch.project_id,
          baseUpdatedAt: activeWebHeroCommit.session.flowUpdatedAt,
          nowIso,
        },
        version: {
          id: crypto.randomUUID(),
          reason: "agent_turn",
          label: "node-mutation",
        },
      });
      updated = committed.flow;
      webHeroVersionCreatedInTransaction = true;
      activeWebHeroCommit = null;
    } else if (pptMasterRequiresCas) {
	  updated = devBypass
		? await updateFlowByIdUnsafeIfUpdatedAtMatches(c.env.DB, {
			id: flowId,
			name: rowForPatch.name,
			data: nextJson,
			baseUpdatedAt: rowForPatch.updated_at,
			nowIso,
		  })
		: await updateFlowIfUpdatedAtMatches(c.env.DB, {
			id: flowId,
			name: rowForPatch.name,
			data: nextJson,
			ownerId: requestUserId,
			projectId: rowForPatch.project_id,
			baseUpdatedAt: rowForPatch.updated_at,
			nowIso,
		  });
    } else {
      updated = devBypass
        ? await updateFlowByIdUnsafe(c.env.DB, {
            id: flowId,
            name: rowForPatch.name,
            data: nextJson,
            nowIso,
          })
        : await updateFlow(c.env.DB, {
            id: flowId,
            name: rowForPatch.name,
            data: nextJson,
            ownerId: requestUserId,
            projectId: rowForPatch.project_id,
            nowIso,
          });
    }
	if (!updated && pptMasterRequiresCas) {
	  throw new AppError("Flow changed while the PPT Master operation was completing", {
		status: 409,
		code: "flow_snapshot_stale",
		details: { flowId, baseUpdatedAt: rowForPatch.updated_at },
	  });
	}
    if (!updated) {
      throw new AppError("Flow not found", {
        status: 404,
        code: "flow_not_found",
      });
    }
    if (!webHeroVersionCreatedInTransaction) {
	    const versionUserId = resolveFlowVersionUserId({
	      devBypass,
	      requestUserId,
	      flowOwnerId: requestUserId,
	    });
      await createFlowVersion(c.env.DB, {
        id: crypto.randomUUID(),
        flowId: updated.id,
        name: updated.name,
        data: updated.data,
        userId: versionUserId,
        nowIso,
        reason: "agent_turn",
        label: "node-mutation",
      });
    }
	const response = {
	  ...(completedWebHeroCommitResponse || {}),
	  ok: true,
      flowId: updated.id,
      updatedAt: updated.updated_at,
      stats: applied.stats,
    };
	const diffEffects = deriveFlowGraphEffects({
      before: currentParsed.data,
      after: nextParsed.data,
	});
	const responseContent = completedWebHeroCommitResponse
	  ? {
		  ok: true,
		  flowId: updated.id,
		  updatedAt: updated.updated_at,
		  nodeId: completedWebHeroCommitResponse.nodeId,
		  sessionId: completedWebHeroCommitResponse.sessionId,
		  committedAt: completedWebHeroCommitResponse.committedAt,
		}
	  : response;
	return respond(
	  responseContent,
	  response,
      semanticPatch?.effects ? mergeToolResultEffects(diffEffects, semanticPatch.effects) : diffEffects,
    );
    } catch (error) {
      if (activeInvocation) {
        await failToolInvocation(c.env.DB, {
          id: activeInvocation.id,
          error,
          nowIso: new Date().toISOString(),
        });
      }
      throw error;
    }
  });
}
