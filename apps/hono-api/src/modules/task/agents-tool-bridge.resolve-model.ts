import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import type { PublicFlowPatchRequestDto } from "../flow/flow.public.schemas";
import { resolveModelConfigDefaultModel } from "../model-config/model-config.service";

export type CanvasTaskSlot = "image" | "video";

export type ResolvedCanvasTaskModel = {
  vendorKey: string;
  modelKey: string;
  modelAlias: string | null;
  label: string;
  options?: unknown;
};

const SLOT_DESCRIPTIONS: Record<CanvasTaskSlot, string> = {
  image: "图片",
  video: "视频",
};

export const FORBIDDEN_NODE_DATA_MODEL_KEYS = [
  "modelAlias",
  "modelKey",
  "model",
  "vendor",
  "vendorKey",
  "imageModel",
  "imageModelVendor",
  "videoModel",
  "videoModelVendor",
  "textModel",
  "textModelVendor",
] as const;

export type ForbiddenNodeDataModelKey =
  (typeof FORBIDDEN_NODE_DATA_MODEL_KEYS)[number];

export function findForbiddenModelKeysInNodeData(
  data: Record<string, unknown> | null | undefined,
): ForbiddenNodeDataModelKey[] {
  if (!data || typeof data !== "object") return [];
  const found: ForbiddenNodeDataModelKey[] = [];
  for (const key of FORBIDDEN_NODE_DATA_MODEL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) found.push(key);
  }
  return found;
}

type ForbiddenViolation = {
  path: string;
  keys: ForbiddenNodeDataModelKey[];
};

function collectForbiddenInPatch(
  patch: PublicFlowPatchRequestDto,
): ForbiddenViolation[] {
  const violations: ForbiddenViolation[] = [];
  const createNodes = Array.isArray(patch.createNodes) ? patch.createNodes : [];
  createNodes.forEach((node, index) => {
    if (!node || typeof node !== "object") return;
    const data = (node as Record<string, unknown>).data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    const keys = findForbiddenModelKeysInNodeData(data as Record<string, unknown>);
    if (keys.length > 0) {
      violations.push({ path: `createNodes[${index}].data`, keys });
    }
  });
  const patchNodeData = Array.isArray(patch.patchNodeData) ? patch.patchNodeData : [];
  patchNodeData.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const data = (entry as Record<string, unknown>).data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    const keys = findForbiddenModelKeysInNodeData(data as Record<string, unknown>);
    if (keys.length > 0) {
      violations.push({ path: `patchNodeData[${index}].data`, keys });
    }
  });
  return violations;
}

export function assertAgentPatchHasNoForbiddenModelKeys(
  patch: PublicFlowPatchRequestDto,
): void {
  const violations = collectForbiddenInPatch(patch);
  if (violations.length === 0) return;
  throw new AppError(
    "node.data must not carry model/vendor selection fields; the active model is resolved from server-side default configuration",
    {
      status: 400,
      code: "agents_tool_forbidden_model_field",
      details: {
        forbiddenKeys: FORBIDDEN_NODE_DATA_MODEL_KEYS,
        violations,
      },
    },
  );
}

export async function resolveCanvasTaskModel(
  c: AppContext,
  slot: CanvasTaskSlot,
): Promise<ResolvedCanvasTaskModel> {
  const defaultModel = await resolveModelConfigDefaultModel(c, slot);
  if (!defaultModel) {
    throw new AppError(`未配置全局默认${SLOT_DESCRIPTIONS[slot]}模型`, {
      status: 400,
      code: "default_model_not_configured",
      details: { slot },
    });
  }
  return {
    vendorKey: defaultModel.vendorKey,
    modelKey: defaultModel.modelKey,
    modelAlias: defaultModel.modelAlias,
    label: defaultModel.label,
    options: defaultModel.options,
  };
}
