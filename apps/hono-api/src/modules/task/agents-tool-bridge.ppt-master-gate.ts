import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { Context } from "hono";
import { AppError } from "../../middleware/error";
import type { AppEnv } from "../../types";
import { assertPptMasterSlideArtifactsValid } from "./agents-tool-bridge.ppt-master-image-prep";
import {
  assertPptMasterProjectOwnedByScope,
  isMaterializedPptMasterProject,
  type PptMasterSlideArtifact,
} from "./agents-tool-bridge.ppt-master-runtime";

type FlowGraphRecord = {
  nodes?: unknown[];
};

type PptStepStatus = Record<string, "pending" | "completed" | "blocked">;

type PptReadinessReport = {
  ready: boolean;
  stepStatus: PptStepStatus;
  missing: string[];
  detail: string;
  projectPath: string;
  slideCount: number;
  pptxUrl: string;
  slideIndexes: number[];
  slideArtifacts: PptMasterSlideArtifact[];
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isSuccessImageStatus(value: unknown): boolean {
  const status = trimString(value).toLowerCase();
  return status === "" || status === "success" || status === "succeeded" ||
    status === "completed" || status === "done";
}

/**
 * The authoritative source for "does this slide have an image" is the generated
 * child image node (kind:"image") carrying pptDeckImageForNodeId +
 * pptDeckSlideIndex + a real hosted imageUrl — the same source
 * deriveSlideImageUrls uses. Basing readiness on it (instead of the derived
 * slides[i].imageUrl) makes the gate independent of write ordering.
 */
function collectSlidesWithGeneratedImage(nodes: unknown[], deckId: string): Set<number> {
  const indexes = new Set<number>();
  for (const raw of nodes) {
    const data = asObject((raw as Record<string, unknown> | undefined)?.data);
    if (!data) continue;
    if (trimString(data.pptDeckImageForNodeId) !== deckId) continue;
    if (!isSuccessImageStatus(data.status)) continue;
    const url = trimString(data.imageUrl);
    if (!/^https?:\/\//i.test(url)) continue;
    const slideIndex = Number(data.pptDeckSlideIndex);
    if (Number.isInteger(slideIndex) && slideIndex >= 1) indexes.add(slideIndex);
  }
  return indexes;
}

export function checkPptDeckReadiness(
  flow: FlowGraphRecord,
  nodeId: string,
  scope: { projectId: string; flowId: string },
): PptReadinessReport {
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const target = nodes.find((n) => {
    const obj = asObject(n);
    return obj && obj.id === nodeId;
  });
  const data = asObject((target as Record<string, unknown> | undefined)?.data) || {};
  const missing: string[] = [];
  if (data.kind !== "pptDeck") {
    missing.push("node: target is not a pptDeck");
  }

  const contract = asObject(data.pptMasterWorkflowContract);
  const stepStatus: PptStepStatus = {
    topic_research: "pending",
    project_init: "pending",
    strategist_outline: "pending",
    image_generation: "pending",
    svg_authoring: "pending",
    export_pptx: "pending",
  };
  if (contract) {
    const incoming = asObject(contract.stepStatus);
    if (incoming) {
      for (const [key, value] of Object.entries(incoming)) {
        if (typeof value === "string" && (value === "completed" || value === "pending" || value === "blocked")) {
          stepStatus[key] = value;
        }
      }
    }
  }

  const preExportSteps = [
    "topic_research",
    "project_init",
    "strategist_outline",
    "image_generation",
    "svg_authoring",
  ];
  const incompleteSteps = preExportSteps.filter((step) => stepStatus[step] !== "completed");
  if (incompleteSteps.length) {
    missing.push(`workflow: incomplete pre-export steps: ${incompleteSteps.join(",")}`);
  }

  if (!trimString(data.pptResearch) && stepStatus.topic_research !== "completed") {
    missing.push("topic_research: pptResearch is empty");
  }

  const projectPath = trimString(data.pptMasterProjectPath);
  const workspaceId = trimString(data.pptMasterWorkspaceId);
  let projectOwned = false;
  if (!workspaceId) {
    missing.push("project_init: pptMasterWorkspaceId missing");
  } else if (projectPath) {
    try {
      assertPptMasterProjectOwnedByScope(projectPath, {
        projectId: scope.projectId,
        flowId: scope.flowId,
        nodeId,
        workspaceId,
      });
      projectOwned = true;
    } catch {
      missing.push("project_init: pptMasterProjectPath belongs to another workspace");
    }
  }
  if (!projectPath) {
    missing.push("project_init: pptMasterProjectPath missing");
  } else if (projectOwned && !existsSync(projectPath)) {
    missing.push(`project_init: pptMasterProjectPath does not exist on disk (${projectPath})`);
  } else if (projectOwned && !isMaterializedPptMasterProject(projectPath)) {
    missing.push(`project_init: pptMasterProjectPath is not a materialized project (${projectPath})`);
  }
  const projectUsable = projectOwned && isMaterializedPptMasterProject(projectPath);

  const slides = Array.isArray(data.slides) ? data.slides : [];
  if (!slides.length) {
    missing.push("strategist_outline: slides[] is empty");
  }

  const slidesWithGeneratedImage = collectSlidesWithGeneratedImage(nodes, nodeId);
  const slidesNeedingImage: number[] = [];
  const slidesNeedingSvg: number[] = [];
  const invalidSlideIndexes: string[] = [];
  const seenSlideIndexes = new Set<number>();
  const validSlideIndexes: number[] = [];
  const slideArtifacts: PptMasterSlideArtifact[] = [];
  slides.forEach((raw) => {
    const slide = asObject(raw);
    const slideIndex = Number(slide?.index);
    if (!slide || !Number.isInteger(slideIndex) || slideIndex < 1 || slideIndex > 99 || seenSlideIndexes.has(slideIndex)) {
      invalidSlideIndexes.push(slide ? String(slide.index ?? "<missing>") : "<invalid-slide>");
      return;
    }
    seenSlideIndexes.add(slideIndex);
    validSlideIndexes.push(slideIndex);
    const visualBrief = trimString(slide.visualBrief);
    const svgIntent = slide.svgIntent === true;

    // Image presence is judged by the generated child image node, not the
    // derived slides[i].imageUrl, so the gate never depends on write ordering.
    if (visualBrief && !svgIntent && !slidesWithGeneratedImage.has(slideIndex)) {
      slidesNeedingImage.push(slideIndex);
    }
    const svgUrl = trimString(slide.svgUrl);
    const svgPath = trimString(slide.svgPath);
    if (!projectUsable || !svgUrl || !svgPath) {
      slidesNeedingSvg.push(slideIndex);
    } else {
      slideArtifacts.push({ index: slideIndex, svgPath });
    }
  });

  if (invalidSlideIndexes.length) {
    missing.push(`strategist_outline: slides[] contains invalid or duplicate index values: ${invalidSlideIndexes.join(",")}`);
  }

  if (slidesNeedingImage.length) {
    missing.push(`image_generation: slides without imageUrl: ${slidesNeedingImage.join(",")}`);
  }
  if (slidesNeedingSvg.length) {
    missing.push(`svg_authoring: slides without a persisted immutable SVG artifact: ${slidesNeedingSvg.join(",")}`);
  }
  if (projectUsable && slideArtifacts.length) {
    try {
      assertPptMasterSlideArtifactsValid(projectPath, slideArtifacts);
    } catch (error) {
      missing.push(`svg_authoring: invalid persisted SVG artifacts: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const pptxUrl = trimString(data.pptxUrl);
  const ready = missing.length === 0;
  const detail = ready
    ? `PPT deck ready. project=${projectPath} slides=${slides.length}`
    : `PPT deck not ready. Missing: ${missing.join(" | ")}`;

  return {
    ready,
    stepStatus,
    missing,
    detail,
    projectPath,
    slideCount: slides.length,
    pptxUrl,
    slideIndexes: validSlideIndexes,
    slideArtifacts,
  };
}

export function ensurePptDeckReadinessForExport(
  flow: FlowGraphRecord,
  nodeId: string,
  scope: { projectId: string; flowId: string },
): PptReadinessReport {
  return checkPptDeckReadiness(flow, nodeId, scope);
}

export function assertPptDeckExportProjectPath(
  requestedProjectPath: string,
  persistedProjectPath: string,
): string {
  const requested = resolve(trimString(requestedProjectPath));
  const persistedRaw = trimString(persistedProjectPath);
  const persisted = persistedRaw ? resolve(persistedRaw) : "";
  if (!persisted || requested !== persisted) {
    throw new AppError("PPT Master export projectPath does not match the target deck", {
      status: 409,
      code: "ppt_master_export_project_mismatch",
      details: { requestedProjectPath: requested, persistedProjectPath: persisted },
    });
  }
  return persisted;
}

export type { PptReadinessReport };
export type _UnusedHonoContext = Context<AppEnv>;
