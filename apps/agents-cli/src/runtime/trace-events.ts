export type TraceEventType =
  | "run.started"
  | "run.finished"
  | "run.errored"
  | "llm.request"
  | "llm.response"
  | "llm.stream.delta"
  | "tool.start"
  | "tool.end"
  | "subagent.dispatch"
  | "skill.load";

export interface TraceEvent {
  ts: string;
  runId: string;
  sessionId: string;
  parentRunId?: string;
  depth: number;
  seq: number;
  type: TraceEventType;
  payload: TraceEventPayload;
}

export interface TracePayloadRef {
  path: string;
  mediaType: "application/json" | "application/x-ndjson";
  bytes: number;
}

export interface ExternalTracePayload {
  type: TraceEventType;
  preview?: Record<string, unknown>;
  payloadRef: TracePayloadRef;
}

export interface TraceEventV2 extends Omit<TraceEvent, "payload"> {
  version: 2;
  rootRunId: string;
  llmCallId?: string;
  payload: TraceEventPayload | ExternalTracePayload;
}

export interface TraceCatalogRecord {
  version: 1;
  op: "upsert";
  rootRunId: string;
  sessionId: string;
  relativeDir: string;
  startedAt: string;
  lastTs: string;
  status: "running" | "finished" | "errored";
  promptPreview: string;
  eventCount?: number;
  totalBytes?: number;
}

export type TraceEventPayload =
  | RunStartedPayload
  | RunFinishedPayload
  | RunErroredPayload
  | LlmRequestPayload
  | LlmResponsePayload
  | LlmStreamDeltaPayload
  | ToolStartPayload
  | ToolEndPayload
  | SubagentDispatchPayload
  | SkillLoadPayload;

export interface RunStartedPayload {
  type: "run.started";
  prompt: string;
  workspaceContextSummary: string;
  requiredSkills: string[];
  modelOverride?: string;
  runtimeMeta?: Record<string, unknown>;
}

export interface RunFinishedPayload {
  type: "run.finished";
  resultText: string;
  durationMs: number;
  toolCallCount: number;
}

export interface RunErroredPayload {
  type: "run.errored";
  errorMessage: string;
  durationMs: number;
}

export interface LlmRequestPayload {
  type: "llm.request";
  llmCallId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  stream: boolean;
  clientKind:
    | "responses"
    | "openai-chat"
    | "gemini"
    | "anthropic";
}

export interface LlmResponsePayload {
  type: "llm.response";
  llmCallId: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  streamRef?: TracePayloadRef;
  durationMs: number;
}

export interface LlmStreamDeltaPayload {
  type: "llm.stream.delta";
  eventName?: string;
  data: unknown;
  rawLine: string;
}

export interface ToolStartPayload {
  type: "tool.start";
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolEndPayload {
  type: "tool.end";
  toolCallId: string;
  name: string;
  status: "succeeded" | "failed" | "denied" | "blocked";
  output: string;
  outputJson?: Record<string, unknown>;
  durationMs: number;
  errorMessage?: string;
}

export interface SubagentDispatchPayload {
  type: "subagent.dispatch";
  toolCallId: string;
  subagentName: string;
  childRunId: string;
  childPrompt: string;
}

export interface SkillLoadPayload {
  type: "skill.load";
  skillName: string;
  charsLoaded: number;
  deferred: boolean;
  reason?: string;
}
