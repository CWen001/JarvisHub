import type { ToolRuntimeState } from "./registry.js";
import {
  executeRemoteTool,
  readRemoteToolConfig,
  readRemoteToolDefinitions,
} from "./remote.js";
import type { ToolCatalog } from "../tool-catalog.js";

const CHECKPOINT_CREATE_TOOL_NAME = "canvas_flow_checkpoint_create";

export function isCanvasMutatingToolName(
  name: string | null | undefined,
  catalog?: ToolCatalog,
): boolean {
  if (!name) return false;
  const definition = catalog?.getDefinition(name);
  return definition?.effects?.mutatesCanvas === true;
}

export function hasCanvasMutatingCall(
  calls: ReadonlyArray<{ name: string }>,
  catalog?: ToolCatalog,
): boolean {
  return calls.some((call) => isCanvasMutatingToolName(call.name, catalog));
}

export type AutoSnapshotAttemptResult =
  | { kind: "skipped"; reason: string }
  | {
      kind: "created";
      versionId: string;
      label: string;
      createdAt: string;
    }
  | { kind: "failed"; error: Error; label: string };

export async function maybeAutoSnapshotBeforeTurn(input: {
  state: ToolRuntimeState;
  meta: Record<string, unknown> | undefined;
  turn: number;
  catalog?: ToolCatalog;
  pendingToolCalls: ReadonlyArray<{ name: string }>;
}): Promise<AutoSnapshotAttemptResult> {
  const { state, meta, turn, pendingToolCalls, catalog } = input;
  if (!state.checkpoint.autoSnapshotEnabled) {
    return { kind: "skipped", reason: "auto_snapshot_disabled" };
  }
  if (!hasCanvasMutatingCall(pendingToolCalls, catalog)) {
    return { kind: "skipped", reason: "no_canvas_mutation_pending" };
  }
  const remoteTools = readRemoteToolDefinitions(meta);
  const checkpointToolAvailable = remoteTools.some(
    (tool) => tool.name === CHECKPOINT_CREATE_TOOL_NAME,
  );
  if (!checkpointToolAvailable) {
    return { kind: "skipped", reason: "checkpoint_tool_unavailable" };
  }
  const config = readRemoteToolConfig(meta);
  if (!config?.flowId) {
    return { kind: "skipped", reason: "no_flow_id_in_remote_config" };
  }
  const label = `agent-turn:${turn}`;
  try {
    const result = await executeRemoteTool({
      name: CHECKPOINT_CREATE_TOOL_NAME,
      args: { label, kind: "auto" },
      toolCallId: `auto-snapshot-${turn}-${Date.now()}`,
      meta,
    });
    if (!result) {
      return {
        kind: "failed",
        error: new Error("checkpoint_create_returned_null"),
        label,
      };
    }
    const structured = result.payload?.structuredOutput as
      | Record<string, unknown>
      | undefined;
    const data = (structured?.data ?? structured) as Record<string, unknown> | undefined;
    const versionId =
      typeof data?.versionId === "string" && data.versionId.trim()
        ? data.versionId.trim()
        : null;
    const createdAt =
      typeof data?.createdAt === "string" && data.createdAt.trim()
        ? data.createdAt.trim()
        : new Date().toISOString();
    if (!versionId) {
      return {
        kind: "failed",
        error: new Error("checkpoint_create_missing_version_id"),
        label,
      };
    }
    state.checkpoint.versions.push({
      versionId,
      label,
      turn,
      createdAt,
      trigger: "auto",
    });
    return { kind: "created", versionId, label, createdAt };
  } catch (error) {
    return {
      kind: "failed",
      error: error instanceof Error ? error : new Error(String(error)),
      label,
    };
  }
}
