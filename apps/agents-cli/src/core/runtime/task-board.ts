export type TaskBoardCanvasMutation = {
  nodeId: string;
  kind: string;
  label?: string;
  status: "queued" | "running" | "succeeded" | "failed";
  assetUrl?: string;
};

export type TaskBoardEntryStatus = "running" | "succeeded" | "failed";

export type TaskBoardEntry = {
  taskId: string;
  agentType: string;
  status: TaskBoardEntryStatus;
  currentTool?: string;
  lastSummary?: string;
  canvasMutations: TaskBoardCanvasMutation[];
  startedAt: number;
  updatedAt: number;
};

const entries = new Map<string, TaskBoardEntry>();
const insertionOrder: string[] = [];
let canvasMutationCounter = 0;

function touch(entry: TaskBoardEntry): void {
  entry.updatedAt = Date.now();
}

export const TaskBoard = {
  register(input: { taskId: string; agentType: string }): TaskBoardEntry {
    const existing = entries.get(input.taskId);
    if (existing) return existing;
    const now = Date.now();
    const entry: TaskBoardEntry = {
      taskId: input.taskId,
      agentType: input.agentType,
      status: "running",
      canvasMutations: [],
      startedAt: now,
      updatedAt: now,
    };
    entries.set(input.taskId, entry);
    insertionOrder.push(input.taskId);
    return entry;
  },

  recordCanvasMutation(taskId: string, mutation: TaskBoardCanvasMutation): void {
    const entry = entries.get(taskId);
    if (!entry) return;
    const idx = entry.canvasMutations.findIndex((m) => m.nodeId === mutation.nodeId);
    if (idx >= 0) {
      entry.canvasMutations[idx] = { ...entry.canvasMutations[idx], ...mutation };
    } else {
      entry.canvasMutations.push(mutation);
    }
    touch(entry);
    canvasMutationCounter += 1;
  },

  recordTool(taskId: string, tool: string, summary?: string): void {
    const entry = entries.get(taskId);
    if (!entry) return;
    entry.currentTool = tool;
    entry.lastSummary = summary;
    touch(entry);
  },

  markFinished(taskId: string, status: "succeeded" | "failed"): void {
    const entry = entries.get(taskId);
    if (!entry) return;
    entry.status = status;
    entry.currentTool = undefined;
    touch(entry);
  },

  get(taskId: string): TaskBoardEntry | undefined {
    return entries.get(taskId);
  },

  snapshot(): TaskBoardEntry[] {
    const result: TaskBoardEntry[] = [];
    for (const id of insertionOrder) {
      const entry = entries.get(id);
      if (entry) result.push(entry);
    }
    return result;
  },

  getCanvasMutationCursor(): number {
    return canvasMutationCounter;
  },

  hasCanvasChangesSince(cursor: number): boolean {
    return canvasMutationCounter > cursor;
  },

  recordExternalCanvasMutation(flowId: string, source: string): void {
    canvasMutationCounter += 1;
    console.info(`[task-board] external canvas mutation flowId=${flowId} source=${source} counter=${canvasMutationCounter}`);
  },
};

export function resetTaskBoardForTests(): void {
  entries.clear();
  insertionOrder.length = 0;
  canvasMutationCounter = 0;
}
