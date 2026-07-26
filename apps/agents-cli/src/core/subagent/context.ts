import type { Message } from "../../types/index.js";
import type { ToolRuntimeState } from "../tools/registry.js";
import { createSubagentBudget } from "../budget.js";

export type AbortStrategy =
  | { kind: "sync"; parent: AbortSignal }
  | { kind: "async" }
  | { kind: "override"; signal: AbortSignal };

export type SubagentContextOptions = {
  parentMeta: Record<string, unknown> | undefined;
  subAgentId: string;
  subagentType: string;
  parentToolCallId?: string;
  forkHistory: boolean;
  parentMessages?: Message[];
  abortStrategy: AbortStrategy;
};

export type SubagentContext = {
  state: ToolRuntimeState;
  history: Message[];
  toolContextMeta: Record<string, unknown>;
  abortSignal: AbortSignal;
  cleanup: () => void;
};

function createFreshState(): ToolRuntimeState {
  return {
    cache: {
      readFile: new Map(),
      bash: new Map(),
    },
    guard: {
      duplicateToolCallLimit: 3,
      duplicateToolCallCount: new Map(),
      readFileBudgetPerPath: undefined,
      readFileUsageByPath: new Map(),
    },
    checkpoint: {
      autoSnapshotEnabled: true,
      versions: [],
    },
    budget: {
      parent: createSubagentBudget(),
      subagents: new Map(),
    },
    visionQueue: [],
    attempts: [],
  };
}

function cloneMessage(message: Message): Message {
  return {
    ...message,
    contentParts: message.contentParts ? message.contentParts.map((part) => ({ ...part })) : undefined,
    toolCalls: message.toolCalls ? message.toolCalls.map((call) => ({ ...call })) : undefined,
  } as Message;
}

function buildAbortSignal(strategy: AbortStrategy): { signal: AbortSignal; cleanup: () => void } {
  if (strategy.kind === "override") {
    return { signal: strategy.signal, cleanup: () => undefined };
  }
  const controller = new AbortController();
  if (strategy.kind === "async") {
    return { signal: controller.signal, cleanup: () => controller.abort() };
  }
  const parent = strategy.parent;
  if (parent.aborted) {
    controller.abort(parent.reason);
    return { signal: controller.signal, cleanup: () => undefined };
  }
  const onAbort = () => controller.abort(parent.reason);
  parent.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      parent.removeEventListener("abort", onAbort);
      if (!controller.signal.aborted) controller.abort();
    },
  };
}

export function createSubagentContext(options: SubagentContextOptions): SubagentContext {
  const parentMeta = options.parentMeta ?? {};
  const parentDepth = typeof parentMeta.depth === "number" ? parentMeta.depth : 0;
  const { signal, cleanup } = buildAbortSignal(options.abortStrategy);
  const state = createFreshState();
  const history: Message[] = options.forkHistory && Array.isArray(options.parentMessages)
    ? options.parentMessages.map(cloneMessage)
    : [];
  const toolContextMeta: Record<string, unknown> = {
    ...parentMeta,
    currentAgentId: options.subAgentId,
    currentAgentType: options.subagentType,
    parentAgentId: typeof parentMeta.currentAgentId === "string" ? parentMeta.currentAgentId : null,
    ...(options.parentToolCallId ? { parentToolCallId: options.parentToolCallId } : {}),
    depth: parentDepth + 1,
  };
  return { state, history, toolContextMeta, abortSignal: signal, cleanup };
}
