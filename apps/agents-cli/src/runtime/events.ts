import type { LlmTurnTrace, ToolCallTrace } from "../core/hooks/types.js";
import type { RuntimeTodoUpdate } from "./todo-events.js";

type AgentScope = {
  agentId?: string;
  agentType?: string;
  agentDepth?: number;
  parentToolCallId?: string;
};

export type RuntimeRunStartedEvent = AgentScope & {
  type: "run.started";
  prompt: string;
  sessionId?: string;
};

export type RuntimeTextDeltaEvent = AgentScope & {
  type: "text.delta";
  delta: string;
};

export type RuntimeToolStartedEvent = AgentScope & {
  type: "tool.started";
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  startedAt: string;
};

export type RuntimeTodoUpdatedEvent = AgentScope & {
  type: "todo.updated";
  todo: RuntimeTodoUpdate;
};

export type RuntimeTurnCompletedEvent = AgentScope & {
  type: "turn.completed";
  turn: LlmTurnTrace;
};

export type RuntimeToolCompletedEvent = AgentScope & {
  type: "tool.completed";
  toolCall: ToolCallTrace;
};

export type RuntimeRunCompletedEvent = AgentScope & {
  type: "run.completed";
  result: string;
};

export type RuntimeRunFailedEvent = AgentScope & {
  type: "run.failed";
  message: string;
};

export type RuntimeSubagentStatusEvent = AgentScope & {
  type: "subagent.status";
  taskId: string;
  subagentType: string;
  status: "running" | "succeeded" | "failed";
  summary?: string;
  parentToolCallId?: string;
  createdAt: string;
};

export type RuntimeRunEvent =
  | RuntimeRunStartedEvent
  | RuntimeTextDeltaEvent
  | RuntimeToolStartedEvent
  | RuntimeTodoUpdatedEvent
  | RuntimeTurnCompletedEvent
  | RuntimeToolCompletedEvent
  | RuntimeRunCompletedEvent
  | RuntimeRunFailedEvent
  | RuntimeSubagentStatusEvent;

export type RuntimeRunEventSink = (event: RuntimeRunEvent) => void | Promise<void>;
