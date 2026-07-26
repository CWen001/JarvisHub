/**
 * PPT Master step-status gate.
 *
 * Whenever an agent tries to `canvas_update_node_data` to mutate a pptDeck
 * node's `pptMasterWorkflowContract.stepStatus` (or top-level `stepStatus`),
 * we cross-check the desired transition against:
 *
 *   - existing slides/imageUrl/svgUrl/svgPath/projectPath on the node, and
 *   - the immutable SVG artifacts referenced by those persisted slides.
 *
 * If the agent tries to mark a later step "completed" while earlier ones are
 * not actually finished, we throw and refuse the patch — same hard-enforce
 * pattern webHero uses for `final_code`.
 */

import { existsSync } from "node:fs";

import { AppError } from "../../middleware/error";
import {
  assertPptMasterProjectOwnedByScope,
  isMaterializedPptMasterProject,
  isPathInsideConfiguredProjectsRoot,
  type PptMasterSlideArtifact,
} from "./agents-tool-bridge.ppt-master-runtime";
import { assertPptMasterSlideArtifactsValid } from "./agents-tool-bridge.ppt-master-image-prep";

type StepKey =
  | "topic_research"
  | "project_init"
  | "strategist_outline"
  | "image_generation"
  | "svg_authoring"
  | "export_pptx";

const STEP_ORDER: StepKey[] = [
  "topic_research",
  "project_init",
  "strategist_outline",
  "image_generation",
  "svg_authoring",
  "export_pptx",
];

export type FlowGraphRecord = { nodes?: unknown[] };

type FlowPatchLike = {
  patchNodeData?: ReadonlyArray<{ id: string; data?: Record<string, unknown> }>;
  allowOverwrite?: boolean;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStepStatus(value: unknown): Partial<Record<StepKey, string>> {
  const out: Partial<Record<StepKey, string>> = {};
  const record = asObject(value);
  if (!record) return out;
  for (const key of STEP_ORDER) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) out[key] = raw.trim();
  }
  return out;
}

function findNodeById(graph: FlowGraphRecord, nodeId: string): Record<string, unknown> | null {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  for (const raw of nodes) {
    const obj = asObject(raw);
    if (obj && obj.id === nodeId) return obj;
  }
  return null;
}

function readExistingPptStepStatus(
  graph: FlowGraphRecord,
  nodeId: string,
): { isPptDeck: boolean; stepStatus: Partial<Record<StepKey, string>>; data: Record<string, unknown> } {
  const node = findNodeById(graph, nodeId);
  const data = asObject(node?.data) || {};
  const isPptDeck = data.kind === "pptDeck";
  const contract = asObject(data.pptMasterWorkflowContract);
  const fromContract = contract ? readStepStatus(contract.stepStatus) : {};
  const fromTop = readStepStatus(data.stepStatus);
  return {
    isPptDeck,
    stepStatus: { ...fromContract, ...fromTop },
    data,
  };
}

function readIncomingPptStepStatus(
  patchData: Record<string, unknown>,
): Partial<Record<StepKey, string>> {
  const contract = asObject(patchData.pptMasterWorkflowContract);
  const fromContract = contract ? readStepStatus(contract.stepStatus) : {};
  const fromTop = readStepStatus(patchData.stepStatus);
  return { ...fromContract, ...fromTop };
}

function indexPptSlides(
  slides: ReadonlyArray<Record<string, unknown>>,
  step: StepKey,
): ReadonlyArray<{ slide: Record<string, unknown>; index: number }> {
  const seen = new Set<number>();
  const indexed: Array<{ slide: Record<string, unknown>; index: number }> = [];
  const invalid: string[] = [];
  for (const slide of slides) {
    const index = Number(slide.index);
    if (!Number.isInteger(index) || index < 1 || index > 99 || seen.has(index)) {
      invalid.push(String(slide.index ?? "<missing>"));
      continue;
    }
    seen.add(index);
    indexed.push({ slide, index });
  }
  if (invalid.length) {
    throw new AppError(
      `PPT Master step '${step}' requires unique integer slide.index values between 1 and 99. Invalid: ${invalid.join(",")}`,
      {
        status: 409,
        code: "ppt_master_step_missing_evidence",
        details: { step, field: "slides[].index", invalidSlideIndexes: invalid },
      },
    );
  }
  return indexed;
}

export function assertPptDeckProjectInitPreconditions(
  graph: FlowGraphRecord,
  nodeId: string,
): void {
  const { isPptDeck, stepStatus, data } = readExistingPptStepStatus(graph, nodeId);
  if (!isPptDeck) {
    throw new AppError("Target pptDeck node not found", {
      status: 404,
      code: "ppt_master_node_missing",
      details: { nodeId },
    });
  }
  if (stepStatus.topic_research !== "completed") {
    throw new AppError(
      "PPT Master step 'project_init' cannot start: previous step 'topic_research' is not completed.",
      {
        status: 409,
        code: "ppt_master_step_out_of_order",
        details: { step: "project_init", requiresPriorCompleted: "topic_research" },
      },
    );
  }
  if (!trim(data.pptResearch)) {
    throw new AppError(
      "PPT Master step 'topic_research' requires pptResearch before project initialization.",
      {
        status: 409,
        code: "ppt_master_step_missing_evidence",
        details: { step: "topic_research", field: "pptResearch" },
      },
    );
  }
}

export function readPptDeckWorkspaceId(
  graph: FlowGraphRecord,
  nodeId: string,
): string {
  const { isPptDeck, data } = readExistingPptStepStatus(graph, nodeId);
  if (!isPptDeck) {
    throw new AppError("Target pptDeck node not found", {
      status: 404,
      code: "ppt_master_node_missing",
      details: { nodeId },
    });
  }
  const workspaceId = trim(data.pptMasterWorkspaceId);
  if (workspaceId) return workspaceId;
  throw new AppError("PPT Master node is missing its server-owned workspace identity", {
    status: 409,
    code: "ppt_master_workspace_identity_missing",
    details: { nodeId },
  });
}

function assertStepCompletable(
  step: StepKey,
  effectiveStatus: Partial<Record<StepKey, string>>,
  evidence: {
    pptResearch: string;
    projectPath: string;
    slides: ReadonlyArray<Record<string, unknown>>;
  },
): void {
  // Prior step must be completed.
  const idx = STEP_ORDER.indexOf(step);
  if (idx > 0) {
    const prev = STEP_ORDER[idx - 1];
    if (effectiveStatus[prev] !== "completed") {
      throw new AppError(
        `PPT Master step '${step}' cannot be marked completed: previous step '${prev}' is not completed.`,
        {
          status: 409,
          code: "ppt_master_step_out_of_order",
          details: { step, requiresPriorCompleted: prev },
        },
      );
    }
  }

  // Per-step evidence checks.
  if (step === "topic_research" && !evidence.pptResearch) {
    throw new AppError(
      "PPT Master step 'topic_research' requires pptResearch to be non-empty (Markdown research summary).",
      { status: 409, code: "ppt_master_step_missing_evidence", details: { step, field: "pptResearch" } },
    );
  }
  if (step === "project_init" && !isMaterializedPptMasterProject(evidence.projectPath)) {
    throw new AppError(
      "PPT Master step 'project_init' requires a materialized PPT Master project; call canvas_ppt_master_project_init first.",
      {
        status: 409,
        code: "ppt_master_step_missing_evidence",
        details: {
          step,
          field: "pptMasterProjectPath",
          path: evidence.projectPath,
          reason: projectEvidenceFailureReason(evidence.projectPath),
        },
      },
    );
  }
  if (step === "strategist_outline") {
    if (evidence.slides.length === 0) {
      throw new AppError(
        "PPT Master step 'strategist_outline' requires slides[] to be non-empty.",
        { status: 409, code: "ppt_master_step_missing_evidence", details: { step, field: "slides" } },
      );
    }
    indexPptSlides(evidence.slides, step);
  }
  if (step === "image_generation") {
    const missingImage: number[] = [];
    indexPptSlides(evidence.slides, step).forEach(({ slide, index }) => {
      const visualBrief = trim((slide as Record<string, unknown>).visualBrief);
      const imageUrl = trim((slide as Record<string, unknown>).imageUrl);
      const svgIntent = (slide as Record<string, unknown>).svgIntent === true;
      if (visualBrief && !svgIntent && !imageUrl) {
        missingImage.push(index);
      }
    });
    if (missingImage.length) {
      throw new AppError(
        `PPT Master step 'image_generation' requires imageUrl or svgIntent=true for every visual slide. Missing: ${missingImage.join(",")}`,
        {
          status: 409,
          code: "ppt_master_step_missing_evidence",
          details: { step, missingSlideIndexes: missingImage },
        },
      );
    }
  }
  if (step === "svg_authoring") {
    const missingSvg: number[] = [];
    const indexedSlides = indexPptSlides(evidence.slides, step);
    const artifacts: PptMasterSlideArtifact[] = [];
    indexedSlides.forEach(({ slide, index }) => {
      const svgUrl = trim(slide.svgUrl);
      const svgPath = trim(slide.svgPath);
      if (!svgUrl || !svgPath) missingSvg.push(index);
      else artifacts.push({ index, svgPath });
    });
    if (missingSvg.length) {
      throw new AppError(
        `PPT Master step 'svg_authoring' requires every slide to reference its persisted immutable SVG artifact. Missing: ${missingSvg.join(",")}`,
        {
          status: 409,
          code: "ppt_master_step_missing_evidence",
          details: { step, missingSlideIndexes: missingSvg },
        },
      );
    }
    assertPptMasterSlideArtifactsValid(evidence.projectPath, artifacts);
  }
  if (step === "export_pptx") {
    // export_pptx completion is set by the export tool itself, not by the
    // agent's free-form update; we still let it through here because the
    // export tool runs the readiness gate first.
  }
}

function projectEvidenceFailureReason(projectPath: string): string {
  if (!projectPath) return "path_missing";
  if (!isPathInsideConfiguredProjectsRoot(projectPath)) return "outside_projects_root";
  if (!existsSync(projectPath)) return "directory_missing";
  return "project_not_initialized";
}

function assertMaterializedProjectEvidence(projectPath: string): void {
  if (isMaterializedPptMasterProject(projectPath)) return;
  throw new AppError(
    "PPT Master project evidence is stale or invalid; run canvas_ppt_master_project_init first.",
    {
      status: 409,
      code: "ppt_master_step_missing_evidence",
      details: {
        step: "project_init",
        field: "pptMasterProjectPath",
        path: projectPath,
        reason: projectEvidenceFailureReason(projectPath),
      },
    },
  );
}

/**
 * Validate a pptDeck update_node_data / flow_patch payload against the
 * step-status pipeline. Throws AppError on any out-of-order or
 * evidence-missing transition. Storage overwrite semantics never bypass
 * workflow evidence validation.
 */
export function assertPptDeckStepStatusTransition(
  graph: FlowGraphRecord,
  patch: FlowPatchLike,
  scope: { projectId: string; flowId: string },
): void {
  const items = Array.isArray(patch.patchNodeData) ? patch.patchNodeData : [];
  if (!items.length) return;

  for (const item of items) {
    const nodeId = trim(item?.id);
    if (!nodeId) continue;
    const patchData = asObject(item?.data) || {};
    const incoming = readIncomingPptStepStatus(patchData);
    const hasProjectPathPatch = Object.prototype.hasOwnProperty.call(patchData, "pptMasterProjectPath");
    const { isPptDeck, stepStatus: existing, data } = readExistingPptStepStatus(graph, nodeId);
    if (!isPptDeck) continue;

    const hasWorkspaceIdPatch = Object.prototype.hasOwnProperty.call(
      patchData,
      "pptMasterWorkspaceId",
    );
    if (
      hasWorkspaceIdPatch &&
      trim(patchData.pptMasterWorkspaceId) !== trim(data.pptMasterWorkspaceId)
    ) {
      throw new AppError("PPT Master workspace identity is immutable", {
        status: 409,
        code: "ppt_master_workspace_identity_immutable",
        details: { nodeId },
      });
    }
    if (Object.keys(incoming).length === 0 && !hasProjectPathPatch) continue;

    const effective: Partial<Record<StepKey, string>> = { ...existing, ...incoming };

    // Build merged evidence (existing data overridden by incoming patch).
    const mergedData = { ...data, ...patchData };
    const evidence = {
      pptResearch: trim(mergedData.pptResearch),
      projectPath: trim(mergedData.pptMasterProjectPath),
      slides: Array.isArray(mergedData.slides) ? (mergedData.slides as unknown[]).filter((s): s is Record<string, unknown> => Boolean(asObject(s))) : [],
    };

    const completesDependentStep = STEP_ORDER.slice(2).some(
      (step) => incoming[step] === "completed",
    );
    const completesProjectStep = incoming.project_init === "completed";
    if (
      effective.project_init === "completed" &&
      (hasProjectPathPatch || completesDependentStep || completesProjectStep)
    ) {
      const workspaceId = trim(data.pptMasterWorkspaceId);
      if (!workspaceId) {
        throw new AppError("PPT Master node is missing its server-owned workspace identity", {
          status: 409,
          code: "ppt_master_workspace_identity_missing",
          details: { nodeId },
        });
      }
      assertPptMasterProjectOwnedByScope(evidence.projectPath, {
        projectId: scope.projectId,
        flowId: scope.flowId,
        nodeId,
        workspaceId,
      });
      assertMaterializedProjectEvidence(evidence.projectPath);
    }

    for (const step of STEP_ORDER) {
      const next = incoming[step];
      if (next !== "completed") continue;
      if (existing[step] === "completed") continue; // already completed; idempotent.
      assertStepCompletable(step, effective, evidence);
    }
  }
}
