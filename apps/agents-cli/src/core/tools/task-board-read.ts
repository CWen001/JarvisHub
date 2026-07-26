import type { ToolHandler } from "./registry.js";
import { TaskBoard, type TaskBoardEntry, type TaskBoardEntryStatus } from "../runtime/task-board.js";

const STATUS_VALUES: readonly TaskBoardEntryStatus[] = ["running", "succeeded", "failed"];

function readStatusFilter(value: unknown): TaskBoardEntryStatus | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return (STATUS_VALUES as readonly string[]).includes(normalized)
    ? (normalized as TaskBoardEntryStatus)
    : undefined;
}

function readStringFilter(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function applyFilter(
  entries: TaskBoardEntry[],
  filter: { status?: TaskBoardEntryStatus; taskId?: string; agentType?: string },
): TaskBoardEntry[] {
  return entries.filter((entry) => {
    if (filter.status && entry.status !== filter.status) return false;
    if (filter.taskId && entry.taskId !== filter.taskId) return false;
    if (filter.agentType && entry.agentType !== filter.agentType) return false;
    return true;
  });
}

export const taskBoardReadTool: ToolHandler = {
  definition: {
    name: "task_board_read",
    description: [
      "查看当前进程内所有 main / sub-agent 的实时执行状态、当前调用的工具，以及它们在画布上创建/更新的节点（含资产 URL）。",
      "返回结构化 JSON：{ entries: [{ taskId, agentType, status, currentTool?, lastSummary?, canvasMutations: [...], startedAt, updatedAt }] }。",
      "可选 filter：按 status / taskId / agentType 过滤。",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        filter: {
          type: "object",
          properties: {
            status: { type: "string", enum: [...STATUS_VALUES] },
            taskId: { type: "string" },
            agentType: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  isReadOnly: true,
  isConcurrencySafe: () => true,
  async execute(args, _ctx, toolCallId) {
    const rawFilter = (args.filter ?? {}) as Record<string, unknown>;
    const filter = {
      status: readStatusFilter(rawFilter.status),
      taskId: readStringFilter(rawFilter.taskId),
      agentType: readStringFilter(rawFilter.agentType),
    };
    const entries = applyFilter(TaskBoard.snapshot(), filter);
    const payload = { entries };
    const content = JSON.stringify(payload);
    return {
      toolCallId,
      content,
      payload: { text: content, structuredOutput: payload },
    };
  },
};
