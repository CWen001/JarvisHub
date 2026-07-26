import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
  createFlowVersion,
  getFlowVersion,
  listFlowVersions,
  updateFlowByIdUnsafe,
  updateFlowIfUpdatedAtMatches,
  type FlowRow,
  type FlowVersionReason,
} from "../flow/flow.repo";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import { reconcilePptMasterGraphIdentities } from "./agents-tool-bridge.ppt-master-node-create";

const DEFAULT_CHECKPOINT_LABEL = "agent-checkpoint";
const MAX_LABEL_LENGTH = 120;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLabel(value: unknown): string {
  const raw = readTrimmedString(value);
  if (!raw) return DEFAULT_CHECKPOINT_LABEL;
  return raw.length > MAX_LABEL_LENGTH ? raw.slice(0, MAX_LABEL_LENGTH) : raw;
}

function normalizeLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_LIST_LIMIT;
  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(numeric)));
}

function normalizeCheckpointKind(value: unknown): "auto" | "explicit" {
  return value === "auto" ? "auto" : "explicit";
}

type CheckpointCallContext = {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  row: FlowRow;
  bodyArgs: Record<string, unknown>;
};

function resolveVersionUserId(input: {
  devBypass: boolean;
  requestUserId: string;
  flowOwnerId: string | null;
}): string {
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

export type CreateAgentCheckpointResult = {
  ok: true;
  versionId: string;
  flowId: string;
  name: string;
  createdAt: string;
};

export async function createAgentCheckpoint(
  input: CheckpointCallContext,
): Promise<CreateAgentCheckpointResult> {
  const label = normalizeLabel(input.bodyArgs.label);
  const kind = normalizeCheckpointKind(input.bodyArgs.kind);
  const reason: FlowVersionReason = kind === "auto" ? "agent_turn" : "agent_explicit";
  const nowIso = new Date().toISOString();
  const versionUserId = resolveVersionUserId({
    devBypass: input.devBypass,
    requestUserId: input.requestUserId,
    flowOwnerId: input.requestUserId,
  });
  const versionId = crypto.randomUUID();
  await createFlowVersion(input.c.env.DB, {
    id: versionId,
    flowId: input.row.id,
    name: input.row.name,
    data: input.row.data,
    userId: versionUserId,
    nowIso,
    reason,
    label,
  });
  return {
    ok: true,
    versionId,
    flowId: input.row.id,
    name: label,
    createdAt: nowIso,
  };
}

export type RestoreAgentCheckpointResult = {
  ok: true;
  versionId: string;
  restoredVersionId: string;
  flowId: string;
  name: string;
  restoredAt: string;
  restoredFromCreatedAt: string;
};

export async function restoreAgentCheckpoint(
  input: CheckpointCallContext,
): Promise<RestoreAgentCheckpointResult> {
  const versionId = readTrimmedString(input.bodyArgs.versionId);
  if (!versionId) {
    throw new AppError("versionId is required", {
      status: 400,
      code: "flow_checkpoint_version_id_required",
    });
  }
  const version = await getFlowVersion(input.c.env.DB, versionId, input.row.id, input.requestUserId);
  if (!version) {
    throw new AppError("Flow version not found", {
      status: 404,
      code: "flow_checkpoint_version_not_found",
      details: { flowId: input.row.id, versionId },
    });
  }
  const nowIso = new Date().toISOString();
  const baseUpdatedAt = input.row.updated_at;
  let sanitizedVersionData: string;
  try {
    const parsed = JSON.parse(version.data ?? "{}");
    const current = JSON.parse(input.row.data ?? "{}");
    sanitizedVersionData = JSON.stringify(reconcilePptMasterGraphIdentities(
      current,
      sanitizeFlowDataForStorage(parsed) ?? {},
    ));
  } catch (err: unknown) {
    const reason = err instanceof Error && err.message ? err.message : "unknown parse error";
    throw new AppError("Flow version data is invalid; restore aborted", {
      status: 500,
      code: "flow_version_data_invalid",
      details: { flowId: input.row.id, versionId: version.id, reason },
    });
  }
  const updated = input.devBypass
    ? await updateFlowByIdUnsafe(input.c.env.DB, {
        id: input.row.id,
        name: version.name,
        data: sanitizedVersionData,
        nowIso,
      })
    : await updateFlowIfUpdatedAtMatches(input.c.env.DB, {
        id: input.row.id,
        name: version.name,
        data: sanitizedVersionData,
        ownerId: input.requestUserId,
        projectId: input.row.project_id,
        baseUpdatedAt,
        nowIso,
      });
  if (!updated) {
    throw new AppError("Flow snapshot stale or not found", {
      status: 409,
      code: "flow_snapshot_stale",
      details: { flowId: input.row.id, baseUpdatedAt },
    });
  }
  const versionUserId = resolveVersionUserId({
    devBypass: input.devBypass,
    requestUserId: input.requestUserId,
    flowOwnerId: input.requestUserId,
  });
  const restoredVersionId = crypto.randomUUID();
  const restoredLabel = `agent-restore:${version.id.slice(0, 8)}`;
  await createFlowVersion(input.c.env.DB, {
    id: restoredVersionId,
    flowId: updated.id,
    name: updated.name,
    data: updated.data,
    userId: versionUserId,
    nowIso,
    reason: "rollback",
    label: restoredLabel,
  });
  return {
    ok: true,
    versionId: version.id,
    restoredVersionId,
    flowId: input.row.id,
    name: version.name,
    restoredAt: nowIso,
    restoredFromCreatedAt: version.created_at,
  };
}

export type ListAgentCheckpointsResult = {
  ok: true;
  flowId: string;
  items: Array<{
    versionId: string;
    name: string;
    label: string | null;
    reason: FlowVersionReason;
    createdAt: string;
  }>;
};

export async function listAgentCheckpoints(
  input: CheckpointCallContext,
): Promise<ListAgentCheckpointsResult> {
  const limit = normalizeLimit(input.bodyArgs.limit);
  const labelFilter = readTrimmedString(input.bodyArgs.labelPrefix);
  const rows = await listFlowVersions(input.c.env.DB, input.row.id, { audience: "agent" });
  const filtered = labelFilter
    ? rows.filter((item) => {
        const haystack = item.label ?? item.name ?? "";
        return haystack.startsWith(labelFilter);
      })
    : rows;
  return {
    ok: true,
    flowId: input.row.id,
    items: filtered.slice(0, limit).map((item) => ({
      versionId: item.id,
      name: item.name,
      label: item.label,
      reason: item.reason as FlowVersionReason,
      createdAt: item.created_at,
    })),
  };
}
