import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { URL } from "node:url";

import type { AgentLlmCredsApiProtocol, AgentRunner } from "../core/agent-loop.js";
import type {
  CapabilitySnapshot,
  ContextDiagnostics,
  Message,
  ToolPolicySummary,
} from "../types/index.js";
import { loadSessionMessages, saveSessionMessages } from "../core/memory/session.js";
import path from "node:path";
import { createClient } from "redis";
import type { RemoteToolDefinition } from "../types/index.js";
import {
  subscribeToCanvasMutations,
  type CanvasSubscriptionHandle,
} from "../core/runtime/canvas-subscription.js";
import {
  formatGenerationContractPromptLines,
  parseGenerationContract,
  type GenerationContract,
} from "../contracts/generation-contract.js";
import type { RuntimeRunEvent } from "../runtime/events.js";
import { createRuntimeChannelMeta } from "../runtime/channel.js";
import { parseRuntimeTodoUpdate } from "../runtime/todo-events.js";
import type { SkillLoader } from "../core/skills/loader.js";
import { normalizeRemoteToolDefinitions } from "../core/tools/remote.js";
import { renderRepoKnowledgeRuntimeRoots } from "../core/repo-knowledge-policy.js";
import { normalizeMaxAllowedTools } from "../core/config.js";
import { joinSystemSections } from "../core/finish-policy.js";

export type AgentsHttpServerOptions = {
  host: string;
  port: number;
  token?: string;
  bodyLimitBytes?: number;
  maxAllowedTools?: number;
};

export type AgentsChatRequest = {
  prompt: string;
  stream?: boolean;
  diagnosticContext?: Record<string, unknown>;
  canvasCapabilityManifest?: {
    version?: string;
    summary?: string;
    remoteTools?: Array<{
      name?: string;
      description?: string;
      parameters?: Record<string, unknown>;
    }>;
    nodeSpecs?: Record<string, unknown>;
    protocols?: Record<string, unknown>;
  };
  generationContract?: GenerationContract;
  systemPrompt?: string;
  responseFormat?: unknown;
  response_format?: unknown;
  model?: string;
  modelAlias?: string;
  modelKey?: string;
  llmApiKey?: string;
  llmApiBaseUrl?: string;
  llmModel?: string;
  llmApiProtocol?: string;
  multimodalCreds?: { apiKey?: string; baseUrl?: string; model?: string; apiProtocol?: string };
  referenceImages?: string[];
  assetInputs?: Array<{
    assetId?: string;
    assetRefId?: string;
    url?: string;
    role?: string;
    note?: string;
    name?: string;
    weight?: number;
  }>;
  referenceImageSlots?: Array<{
    slot?: string;
    url?: string;
    role?: string;
    label?: string;
    note?: string;
  }>;
  requiredSkills?: string[];
  allowedTools?: string[];
  allowedSubagentTypes?: string[];
  resourceWhitelist?: {
    projectIds?: string[];
    allowUserScopedPublicAssets?: boolean;
    allowSystemPublicMetadata?: boolean;
  };
  maxTurns?: number;
  compactPrelude?: boolean;
  sessionId?: string;
  userId?: string;
  resetSession?: boolean;
  privilegedLocalAccess?: boolean;
  forceLocalResourceViaBash?: boolean;
  disableMemory?: boolean;
  memorySyncUrl?: string;
  memorySyncProjectId?: string;
  localResourcePaths?: string[];
  remoteTools?: RemoteToolDefinition[];
  mcpTools?: RemoteToolDefinition[];
  remoteToolConfig?: {
    endpoint: string;
    authToken?: string;
    apiKey?: string;
    projectId?: string;
    flowId?: string;
    nodeId?: string;
    timeoutMs?: number;
  };
  mcpToolConfig?: {
    endpoint: string;
    authToken?: string;
    apiKey?: string;
  };
};

function isAgentLlmCredsApiProtocol(value: string): value is AgentLlmCredsApiProtocol {
  return (
    value === "openai-chat" ||
    value === "openai-responses" ||
    value === "google-v1beta" ||
    value === "anthropic-messages"
  );
}

type AgentsChatReferenceImageSlot = {
  slot: string;
  url: string;
  role: string | null;
  label: string | null;
  note: string | null;
};

type AgentsChatAssetInput = {
  assetId: string | null;
  assetRefId: string | null;
  url: string;
  role: string | null;
  note: string | null;
  name: string | null;
  weight: number | null;
};

type AgentsChatCanvasCapabilityTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type AgentsChatCanvasCapabilityManifest = {
  version: string | null;
  summary: string | null;
  remoteTools: AgentsChatCanvasCapabilityTool[];
  nodeSpecs: Record<string, Record<string, unknown>>;
  protocols: Record<string, unknown> | null;
};

export type AgentsChatAsset = {
  type: "image" | "video";
  url: string;
  thumbnailUrl?: string;
  vendor?: string;
  taskId?: string;
  toolName?: string;
};

export type AgentsChatToolCall = {
  seq: number;
  atMs: number;
  name: string;
  status: "succeeded" | "failed" | "denied" | "blocked";
  input: unknown;
  outputPreview: string;
  outputJson?: Record<string, unknown>;
  outputChars: number;
  outputHead: string;
  outputTail: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorMessage?: string;
  pathHint?: string;
};

type AgentsChatStreamFailureDiagnostics = {
  requestId: string;
  userId: string;
  sessionId: string | null;
  elapsedMs: number;
  abortReason: string | null;
  responseClosedEarly: boolean;
  sseClosed: boolean;
  toolCallCount: number;
  lastToolCall: {
    seq: number;
    name: string;
    status: AgentsChatToolCall["status"];
    durationMs: number;
    errorMessage?: string;
  } | null;
  lastRuntimeEvent: {
    type: string;
    agentType?: string;
    agentId?: string;
    toolName?: string;
    toolCallId?: string;
    subagentType?: string;
    subagentStatus?: string;
    message?: string;
  } | null;
};

export type AgentsChatTodoListItem = {
  text: string;
  completed: boolean;
  status: "pending" | "in_progress" | "waiting" | "blocked" | "completed";
};

export type AgentsChatTodoListTrace = {
  sourceToolCallId: string;
  items: AgentsChatTodoListItem[];
  totalCount: number;
  completedCount: number;
  inProgressCount: number;
  waitingCount: number;
  blockedCount: number;
  pendingCount: number;
};

export type AgentsChatTodoEventTrace = AgentsChatTodoListTrace & {
  atMs: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export type AgentsChatPlanningTrace = {
  source: "todo_list";
  planningRequired: boolean;
  minimumStepCount: number;
  hasChecklist: boolean;
  latestStepCount: number;
  maxObservedStepCount: number;
  completedCount: number;
  inProgressCount: number;
  waitingCount: number;
  blockedCount: number;
  pendingCount: number;
  meetsMinimumStepCount: boolean;
  checklistComplete: boolean;
};

export type AgentsChatRuntimeTrace = {
  harness: "canvas" | "unknown";
  registeredToolNames: string[];
  requiredSkills: string[];
  loadedSkills: string[];
  allowedSubagentTypes: string[];
  systemSnapshot?: {
    currentDate: string;
    gitBranch: string | null;
    gitStatus: string | null;
    recentCommits: string[];
  };
  toolBatchSummaries?: Array<{
    label: string;
    startedAt: string;
    finishedAt: string;
    toolNames: string[];
    succeededCount: number;
    failedCount: number;
    blockedCount: number;
    deniedCount: number;
  }>;
  compactionEvents?: Array<{
    kind: string;
    originalMessageCount: number;
    compactedMessageCount: number;
    originalChars: number;
    compactedChars: number;
    preserveStartIndex: number;
  }>;
  contextDiagnostics?: ContextDiagnostics;
  capabilitySnapshot?: CapabilitySnapshot;
  policySummary?: ToolPolicySummary;
  canvasCapabilities?: {
    version: string | null;
    remoteToolNames: string[];
    nodeKinds: string[];
  };
};

export type AgentsChatCompletionTrace = {
  source: "deterministic";
  terminal: "success" | "explicit_failure" | "blocked";
  allowFinish: boolean;
  failureReason: string | null;
  rationale: string;
  successCriteria: string[];
  missingCriteria: string[];
  requiredActions: string[];
  retryCount?: number;
  recoveredAfterRetry?: boolean;
};

export type AgentsChatTrace = {
  toolCalls: AgentsChatToolCall[];
  turns: Array<{
    turn: number;
    text: string;
    textPreview: string;
    textChars: number;
    toolCallCount: number;
    toolNames: string[];
    finished: boolean;
  }>;
  output: {
    textChars: number;
    preview: string;
    head: string;
    tail: string;
  };
  summary: {
    totalToolCalls: number;
    succeededToolCalls: number;
    failedToolCalls: number;
    deniedToolCalls: number;
    blockedToolCalls: number;
    runMs: number;
  };
  completion?: AgentsChatCompletionTrace;
  runtime?: AgentsChatRuntimeTrace;
  planning?: AgentsChatPlanningTrace;
  todoList?: AgentsChatTodoListTrace;
  todoEvents?: AgentsChatTodoEventTrace[];
};

export type AgentsChatResponse = {
  id: string;
  text: string;
  assets?: AgentsChatAsset[];
  trace?: AgentsChatTrace;
};

type AgentsChatStreamEvent =
  | {
      event: "thread.started";
      data: {
        threadId: string;
        sessionId: string | null;
        userId: string;
      };
    }
  | {
      event: "turn.started";
      data: {
        threadId: string;
        turnId: string;
        userId: string;
        promptPreview: string;
      };
    }
  | {
      event: "item.started";
      data: {
        threadId: string;
        turnId: string;
        itemId: string;
        itemType: "message" | "tool_call" | "result";
        role?: "assistant";
        toolName?: string;
      };
    }
  | {
      event: "item.updated";
      data: {
        threadId: string;
        turnId: string;
        itemId: string;
        itemType: "message" | "tool_call" | "result";
        delta?: string;
        outputPreview?: string;
        phase?: "started" | "completed";
        status?: "succeeded" | "failed" | "denied" | "blocked";
      };
    }
  | {
      event: "item.completed";
      data: {
        threadId: string;
        turnId: string;
        itemId: string;
        itemType: "message" | "tool_call" | "result";
        role?: "assistant";
        text?: string;
        textChars?: number;
        toolName?: string;
        status?: "succeeded" | "failed" | "denied" | "blocked";
        outputPreview?: string;
      };
    }
  | {
      event: "thinking";
      data: {
        threadId: string;
        turnId: string;
        turnIndex: number;
        text: string;
        toolNames: string[];
        toolCallCount: number;
      };
    }
  | { event: "content"; data: { delta: string } }
  | {
      event: "todo_list";
      data: {
        threadId: string;
        turnId: string;
        sourceToolCallId: string;
        items: AgentsChatTodoListItem[];
        totalCount: number;
        completedCount: number;
        inProgressCount: number;
        waitingCount: number;
        blockedCount: number;
        pendingCount: number;
      };
    }
  | {
      event: "tool";
      data: {
        toolCallId: string;
        toolName: string;
        phase: "started" | "completed";
        status?: "succeeded" | "failed" | "denied" | "blocked";
        input?: unknown;
        outputPreview?: string;
        outputJson?: Record<string, unknown>;
        errorMessage?: string;
        startedAt: string;
        finishedAt?: string;
        durationMs?: number;
      };
    }
  | { event: "result"; data: { response: AgentsChatResponse } }
  | {
      event: "turn.completed";
      data: {
        threadId: string;
        turnId: string;
        responseId: string;
        textChars: number;
        toolCallCount: number;
      };
    }
  | { event: "error"; data: { message: string; code?: string; details?: unknown } }
  | { event: "done"; data: { reason: "finished" | "error" } };

const TRACE_SENSITIVE_KEYS = new Set<string>([
  "apikey",
  "api_key",
  "key",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "password",
  "client_secret",
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "secretToken",
]);

const TRACE_MAX_DEPTH = 6;
const TRACE_MAX_KEYS = 60;
const TRACE_MAX_ARRAY = 40;
const TRACE_MAX_STRING = 800;

function stringifyStructuredOutputSpec(value: unknown, maxChars = 4_000): string {
  try {
    const raw = JSON.stringify(value, null, 2);
    if (raw.length <= maxChars) return raw;
    return `${raw.slice(0, maxChars)}\n...truncated`;
  } catch {
    return String(value);
  }
}

function buildStructuredOutputPrompt(value: unknown): string {
  if (typeof value === "undefined") return "";
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const type = typeof record?.type === "string" ? record.type.trim() : "";
  const jsonSchema =
    record?.json_schema && typeof record.json_schema === "object" && !Array.isArray(record.json_schema)
      ? (record.json_schema as Record<string, unknown>)
      : null;
  const schemaName = typeof jsonSchema?.name === "string" ? jsonSchema.name.trim() : "";
  const lines = [
    "StructuredOutputPreference:",
    "- 上游请求显式提供了结构化输出约束。若你本轮最终返回正文而不是继续工具调用，必须严格遵守该格式。",
    "- 若格式要求 JSON，则只能输出 JSON 本体；禁止 Markdown 代码块、禁止额外解释性前后缀、禁止注释。",
  ];
  if (type) lines.push(`- type: ${type}`);
  if (schemaName) lines.push(`- schemaName: ${schemaName}`);
  lines.push("- rawSpec:");
  lines.push(stringifyStructuredOutputSpec(value));
  return lines.join("\n");
}

function buildHttpPlanningSystemPrompt(diagnosticContext: Record<string, unknown> | null): string {
  if (!diagnosticContext || diagnosticContext.planningRequired !== true) return "";
  const lines: string[] = [];
  const planningChecklistFirst = diagnosticContext.planningChecklistFirst === true;
  const planningMinimumStepsRaw = Number(diagnosticContext.planningMinimumSteps);
  const planningMinimumSteps = Number.isFinite(planningMinimumStepsRaw)
    ? Math.max(2, Math.min(8, Math.trunc(planningMinimumStepsRaw)))
    : 2;
  const planningReason =
    typeof diagnosticContext.planningReason === "string" ? diagnosticContext.planningReason.trim() : "";
  const explicitPlanningChecklistItems = Array.isArray(diagnosticContext.planningChecklistItems)
    ? diagnosticContext.planningChecklistItems
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
  const defaultChecklistItems = [
    "Clarify the target, available inputs, and current canvas/workspace state.",
    "Read or inspect the required source material before making changes.",
    "Perform the requested write/generation/staging work in the required order.",
    "Verify the produced result against the user's request and visible evidence.",
    "Record any remaining blocker explicitly instead of claiming completion.",
    "Summarize the final state and concrete next step if follow-up is needed.",
    "Check that generated or modified assets are persisted and referenceable.",
    "Close the task only after all checklist items are completed or explicitly blocked.",
  ];
  const planningChecklistItems =
    explicitPlanningChecklistItems.length > 0
      ? explicitPlanningChecklistItems
      : planningChecklistFirst
        ? defaultChecklistItems.slice(0, planningMinimumSteps)
        : [];
  lines.push("## Execution Planning");
  lines.push("- PlanningRequired: true");
  lines.push(`- MinimumChecklistSteps: ${planningMinimumSteps}`);
  if (planningChecklistFirst) {
    lines.push("- ChecklistFirstRequirement: true");
    lines.push("- Before any side-effectful write/generation/code-staging action, create or update a concrete Todo checklist that covers the required execution stages in order.");
    lines.push("- Do not skip required middle stages just because later-stage tools are available.");
  }
  if (planningReason) lines.push(`- PlanningReason: ${planningReason}`);
  if (planningChecklistItems.length > 0) {
    lines.push("- RequiredChecklistStages:");
    planningChecklistItems.forEach((item) => lines.push(`  - ${item}`));
  }
  return lines.join("\n").trim();
}

function sanitizeTraceValue(value: unknown): unknown {
  const seen = new WeakSet<object>();

  const sanitizeString = (str: string): string => {
    const trimmed = (str || "").trim();
    if (trimmed.length <= TRACE_MAX_STRING) return trimmed;
    return `${trimmed.slice(0, TRACE_MAX_STRING)}…(truncated,len=${trimmed.length})`;
  };

  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === "string") return sanitizeString(v);
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "bigint") return String(v);
    if (typeof v === "function") return "[Function]";
    if (typeof v !== "object") return String(v);

    const obj = v as object;
    if (seen.has(obj)) return "[Circular]";
    seen.add(obj);

    if (depth >= TRACE_MAX_DEPTH) return `[MaxDepth:${TRACE_MAX_DEPTH}]`;

    if (Array.isArray(v)) {
      const items = v.slice(0, TRACE_MAX_ARRAY).map((item) => walk(item, depth + 1));
      if (v.length > TRACE_MAX_ARRAY) items.push(`[...omitted ${v.length - TRACE_MAX_ARRAY} items]`);
      return items;
    }

    const entries = Object.entries(v as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    let kept = 0;
    for (const [key, val] of entries) {
      if (kept >= TRACE_MAX_KEYS) break;
      const lower = key.toLowerCase();
      out[key] = TRACE_SENSITIVE_KEYS.has(lower) ? "***" : walk(val, depth + 1);
      kept += 1;
    }
    if (entries.length > kept) out.__omittedKeys = entries.length - kept;
    return out;
  };

  return walk(value, 0);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

type AgentsHttpError = Error & {
  code: string;
  details?: Record<string, unknown>;
};

function agentsHttpError(
  message: string,
  code: string,
  details?: Record<string, unknown>,
): AgentsHttpError {
  const err = new Error(message) as AgentsHttpError;
  err.code = code;
  if (details) err.details = details;
  return err;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  const raw = (error as { code?: unknown }).code;
  return typeof raw === "string" ? raw.trim() : "";
}

function errorDetails(error: unknown): unknown {
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  const raw = (error as { details?: unknown }).details;
  if (typeof raw === "undefined") return undefined;
  return sanitizeTraceValue(raw);
}

function mergeErrorDetails(
  base: unknown,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const out =
    base && typeof base === "object" && !Array.isArray(base)
      ? { ...(base as Record<string, unknown>) }
      : {};
  return {
    ...out,
    ...extra,
  };
}

function sanitizeToolOutputPreview(output: unknown): { preview: string; chars: number } {
  const text = String(output ?? "");
  const chars = text.length;
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return { preview: "", chars };
  const previewMax = 1200;
  const preview = compact.length > previewMax ? `${compact.slice(0, previewMax)}…(truncated)` : compact;
  return { preview, chars };
}

function extractStructuredOutputJson(output: unknown): Record<string, unknown> | null {
  const text = String(output ?? "").trim();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return sanitizeTraceValue(parsed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractTextEdges(input: unknown, edgeChars: number): { head: string; tail: string } {
  const text = String(input ?? "");
  if (!text) return { head: "", tail: "" };
  const normalized = text.trim();
  if (!normalized) return { head: "", tail: "" };
  if (normalized.length <= edgeChars) {
    return { head: normalized, tail: normalized };
  }
  return {
    head: normalized.slice(0, edgeChars),
    tail: normalized.slice(Math.max(0, normalized.length - edgeChars)),
  };
}

function extractInputPathHint(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const record = input as Record<string, unknown>;
  const candidateKeys = ["path", "filePath", "rawPath", "analysisFile", "sourceCase"];
  for (const key of candidateKeys) {
    const value = typeof record[key] === "string" ? record[key].trim() : "";
    if (value) return value;
  }
  return "";
}

function truncateForLog(input: unknown, maxChars = 800): string {
  const text = String(input ?? "");
  if (!text) return "";
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}...` : compact;
}

function truncateJsonForLog(input: unknown, maxChars = 400): string {
  try {
    return truncateForLog(JSON.stringify(input ?? {}), maxChars);
  } catch {
    return "<unserializable>";
  }
}

function normalizeStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = String(item || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function collectLoadedSkillsForTrace(input: {
  requiredSkills: string[];
  toolCalls: AgentsChatToolCall[];
  messages?: Array<{ content?: unknown }> | null;
}): string[] {
  const out = new Set<string>();
  void input.requiredSkills;
  for (const toolCall of input.toolCalls) {
    if (String(toolCall.name || "").trim() !== "Skill") continue;
    const record = toolCall.input && typeof toolCall.input === "object" && !Array.isArray(toolCall.input)
      ? toolCall.input as Record<string, unknown>
      : null;
    const requested = typeof record?.skill === "string" ? record.skill.trim() : "";
    if (requested) out.add(requested);
  }
  const messages = input.messages;
  if (!Array.isArray(messages) || messages.length === 0) return [...out].slice(0, 64);
  for (const message of messages) {
    const content = typeof message?.content === "string" ? message.content : "";
    if (!content) continue;
    const re = /<skill-loaded\s+name="([^"]+)">/gi;
    let match: RegExpExecArray | null = null;
    while ((match = re.exec(content))) {
      const name = String(match[1] || "").trim();
      if (name) out.add(name);
    }
  }
  return [...out].slice(0, 64);
}

function parseTodoListTraceFromToolCall(input: {
  toolCallId: string;
  toolName: string;
  status: "succeeded" | "failed" | "denied" | "blocked";
  output: string;
}): AgentsChatTodoListTrace | null {
  const parsed = parseRuntimeTodoUpdate({
    toolCallId: input.toolCallId,
    name: input.toolName,
    args: {},
    output: input.output,
    outputChars: String(input.output || "").length,
    outputHead: "",
    outputTail: "",
    status: input.status,
    startedAt: "",
    finishedAt: "",
    durationMs: 0,
  });
  if (!parsed) return null;
  return {
    sourceToolCallId: parsed.sourceToolCallId,
    items: parsed.items,
    totalCount: parsed.totalCount,
    completedCount: parsed.completedCount,
    inProgressCount: parsed.inProgressCount,
    waitingCount: parsed.waitingCount,
    blockedCount: parsed.blockedCount,
    pendingCount: parsed.pendingCount,
  };
}

function toTodoEventTrace(input: {
  todoListTrace: AgentsChatTodoListTrace;
  atMs: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}): AgentsChatTodoEventTrace {
  return {
    ...input.todoListTrace,
    atMs: Math.max(0, Math.trunc(input.atMs)),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: Math.max(0, Math.trunc(input.durationMs)),
  };
}

type RuntimeStreamProjectionContext = {
  threadId: string;
  turnId: string;
  userId: string;
  sessionId: string | null;
  promptPreview: string;
  assistantItemId: string;
  emitStreamEvent: (payload: AgentsChatStreamEvent) => void;
  ensureAssistantItemStarted: () => void;
};

function projectRuntimeEventToStream(
  context: RuntimeStreamProjectionContext,
  event: RuntimeRunEvent,
): void {
  const agentScope = {
    ...(typeof event.agentId === "string" && event.agentId ? { agentId: event.agentId } : {}),
    ...(typeof event.agentType === "string" && event.agentType ? { agentType: event.agentType } : {}),
    ...(typeof event.agentDepth === "number" ? { agentDepth: event.agentDepth } : {}),
    ...(typeof event.parentToolCallId === "string" && event.parentToolCallId
      ? { parentToolCallId: event.parentToolCallId }
      : {}),
  };
  const baseEmit = context.emitStreamEvent;
  const scopedContext: RuntimeStreamProjectionContext = Object.keys(agentScope).length === 0
    ? context
    : {
        ...context,
        emitStreamEvent: (payload) => {
          const next = { ...payload, data: { ...(payload as { data?: object }).data, ...agentScope } };
          baseEmit(next as AgentsChatStreamEvent);
        },
      };
  projectRuntimeEventToStreamInner(scopedContext, event);
}

function projectRuntimeEventToStreamInner(
  context: RuntimeStreamProjectionContext,
  event: RuntimeRunEvent,
): void {
  if (event.type === "run.started") {
    context.emitStreamEvent({
      event: "thread.started",
      data: {
        threadId: context.threadId,
        sessionId: context.sessionId,
        userId: context.userId,
      },
    });
    context.emitStreamEvent({
      event: "turn.started",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        userId: context.userId,
        promptPreview: context.promptPreview,
      },
    });
    context.ensureAssistantItemStarted();
    return;
  }
  if (event.type === "text.delta") {
    if (typeof event.delta !== "string" || !event.delta) return;
    context.ensureAssistantItemStarted();
    context.emitStreamEvent({
      event: "item.updated",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        itemId: context.assistantItemId,
        itemType: "message",
        delta: event.delta,
      },
    });
    return;
  }
  if (event.type === "turn.completed") {
    const text = String(event.turn.text || "");
    if (event.turn.finished) {
      if (text) {
        context.emitStreamEvent({ event: "content", data: { delta: text } });
      }
      return;
    }
    const trimmedText = text.trim();
    if (!trimmedText) return;
    context.emitStreamEvent({
      event: "thinking",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        turnIndex: event.turn.turn,
        text: trimmedText,
        toolNames: [...event.turn.toolNames],
        toolCallCount: event.turn.toolCallCount,
      },
    });
    return;
  }
  if (event.type === "subagent.status") {
    const status = event.status === "failed" ? "failed" : event.status === "succeeded" ? "succeeded" : "running";
    const startedAt = event.createdAt;
    const finishedAt = status === "running" ? undefined : event.createdAt;
    const outputPreview = event.summary || `sub-agent [${event.subagentType}] ${status}`;
    context.emitStreamEvent({
      event: "tool",
      data: {
        toolCallId: event.taskId,
        toolName: "Agent",
        phase: status === "running" ? "started" : "completed",
        ...(status === "running" ? {} : { status }),
        input: {
          subagent_type: event.subagentType,
          description: event.summary || event.subagentType,
        },
        outputPreview,
        ...(status === "failed" ? { errorMessage: outputPreview } : {}),
        startedAt,
        ...(finishedAt ? { finishedAt, durationMs: 0 } : {}),
      },
    });
    return;
  }
  if (event.type === "tool.started") {
    context.emitStreamEvent({
      event: "item.started",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        itemId: event.toolCallId,
        itemType: "tool_call",
        toolName: String(event.name || "").trim() || "tool",
      },
    });
    context.emitStreamEvent({
      event: "item.updated",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        itemId: event.toolCallId,
        itemType: "tool_call",
        phase: "started",
      },
    });
    context.emitStreamEvent({
      event: "tool",
      data: {
        toolCallId: event.toolCallId,
        toolName: String(event.name || "").trim() || "tool",
        phase: "started",
        input: sanitizeTraceValue(event.args),
        startedAt: event.startedAt,
      },
    });
    return;
  }
  if (event.type === "todo.updated") {
    context.emitStreamEvent({
      event: "todo_list",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        sourceToolCallId: event.todo.sourceToolCallId,
        items: event.todo.items,
        totalCount: event.todo.totalCount,
        completedCount: event.todo.completedCount,
        inProgressCount: event.todo.inProgressCount,
        waitingCount: event.todo.waitingCount,
        blockedCount: event.todo.blockedCount,
        pendingCount: event.todo.pendingCount,
      },
    });
    return;
  }
  if (event.type === "tool.completed") {
    const sanitizedOutput = sanitizeToolOutputPreview(event.toolCall.output);
    const outputJson = event.toolCall.outputJson
      ? event.toolCall.name === "ask_user"
        ? event.toolCall.outputJson
        : sanitizeTraceValue(event.toolCall.outputJson)
      : null;
    context.emitStreamEvent({
      event: "item.updated",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        itemId: event.toolCall.toolCallId,
        itemType: "tool_call",
        phase: "completed",
        status: event.toolCall.status,
        ...(sanitizedOutput.preview ? { outputPreview: sanitizedOutput.preview } : {}),
      },
    });
    context.emitStreamEvent({
      event: "item.completed",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        itemId: event.toolCall.toolCallId,
        itemType: "tool_call",
        toolName: String(event.toolCall.name || "").trim() || "tool",
        status: event.toolCall.status,
        ...(sanitizedOutput.preview ? { outputPreview: sanitizedOutput.preview } : {}),
      },
    });
    context.emitStreamEvent({
      event: "tool",
      data: {
        toolCallId: event.toolCall.toolCallId,
        toolName: String(event.toolCall.name || "").trim() || "tool",
        phase: "completed",
        status: event.toolCall.status,
        input: sanitizeTraceValue(event.toolCall.args),
        ...(sanitizedOutput.preview ? { outputPreview: sanitizedOutput.preview } : {}),
        ...(outputJson && typeof outputJson === "object" && !Array.isArray(outputJson)
          ? { outputJson: outputJson as Record<string, unknown> }
          : {}),
        ...(event.toolCall.errorMessage ? { errorMessage: event.toolCall.errorMessage } : {}),
        startedAt: event.toolCall.startedAt,
        finishedAt: event.toolCall.finishedAt,
        durationMs: Math.max(0, Math.trunc(event.toolCall.durationMs)),
      },
    });
    return;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

type CompletionBlockedStateSnapshot = {
  failureReason: string | null;
  planningRequired: boolean;
  planningHasChecklist: boolean;
  planningMeetsMinimumStepCount: boolean;
  planningChecklistComplete: boolean;
  planningLatestStepCount: number;
  planningCompletedCount: number;
  planningInProgressCount: number;
  planningWaitingCount: number;
  planningBlockedCount: number;
  planningPendingCount: number;
};

function buildCompletionBlockedStateSnapshot(input: {
  completion: AgentsChatCompletionTrace;
  planningTrace: AgentsChatPlanningTrace | null;
  toolCalls: AgentsChatToolCall[];
}): CompletionBlockedStateSnapshot | null {
  void input.toolCalls;
  if (input.completion.allowFinish) return null;
  return {
    failureReason: input.completion.failureReason,
    planningRequired: input.planningTrace?.planningRequired === true,
    planningHasChecklist: input.planningTrace?.hasChecklist === true,
    planningMeetsMinimumStepCount: input.planningTrace?.meetsMinimumStepCount === true,
    planningChecklistComplete: input.planningTrace?.checklistComplete === true,
    planningLatestStepCount: input.planningTrace?.latestStepCount ?? 0,
    planningCompletedCount: input.planningTrace?.completedCount ?? 0,
    planningInProgressCount: input.planningTrace?.inProgressCount ?? 0,
    planningWaitingCount: input.planningTrace?.waitingCount ?? 0,
    planningBlockedCount: input.planningTrace?.blockedCount ?? 0,
    planningPendingCount: input.planningTrace?.pendingCount ?? 0,
  };
}

function blockedStateSnapshotEquals(
  left: CompletionBlockedStateSnapshot | null,
  right: CompletionBlockedStateSnapshot | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.failureReason === right.failureReason &&
    left.planningRequired === right.planningRequired &&
    left.planningHasChecklist === right.planningHasChecklist &&
    left.planningMeetsMinimumStepCount === right.planningMeetsMinimumStepCount &&
    left.planningChecklistComplete === right.planningChecklistComplete &&
    left.planningLatestStepCount === right.planningLatestStepCount &&
    left.planningCompletedCount === right.planningCompletedCount &&
    left.planningInProgressCount === right.planningInProgressCount &&
    left.planningWaitingCount === right.planningWaitingCount &&
    left.planningBlockedCount === right.planningBlockedCount &&
    left.planningPendingCount === right.planningPendingCount
  );
}

function hasAwaitingUserReplyToolCall(toolCalls: AgentsChatToolCall[]): boolean {
  return toolCalls.some((toolCall) => {
    if (toolCall.name !== "ask_user" || toolCall.status !== "succeeded") return false;
    const outputJson = toolCall.outputJson;
    if (!outputJson || typeof outputJson !== "object" || Array.isArray(outputJson)) {
      return false;
    }
    const status =
      typeof outputJson.status === "string" ? outputJson.status.trim() : "";
    const question =
      typeof outputJson.question === "string" ? outputJson.question.trim() : "";
    return status === "awaiting_user_reply" && question.length > 0;
  });
}

type RuntimeCompletionTrace = {
  terminal: "success" | "explicit_failure" | "blocked";
  allowFinish: boolean;
  reason: string | null;
};

function readRuntimeCompletionTrace(value: unknown): RuntimeCompletionTrace | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const terminal = record.terminal;
  if (
    terminal !== "success" &&
    terminal !== "explicit_failure" &&
    terminal !== "blocked"
  ) {
    return null;
  }
  if (typeof record.allowFinish !== "boolean") return null;
  const rawReason = typeof record.reason === "string" ? record.reason.trim() : "";
  return {
    terminal,
    allowFinish: record.allowFinish,
    reason: rawReason ? rawReason.slice(0, 160) : null,
  };
}

function buildCompletionTrace(input: {
  responseText: string;
  toolCalls: AgentsChatToolCall[];
  planningTrace: AgentsChatPlanningTrace | null;
  runtimeCompletionTrace?: unknown;
}): AgentsChatCompletionTrace {
  void input.responseText;
  const runtimeCompletionTrace = readRuntimeCompletionTrace(input.runtimeCompletionTrace);
  const planningRequired = input.planningTrace?.planningRequired === true;
  const planningChecklistMissing = planningRequired && input.planningTrace?.hasChecklist !== true;
  const planningTooShort =
    planningRequired &&
    input.planningTrace?.hasChecklist === true &&
    input.planningTrace.meetsMinimumStepCount !== true;
  const planningIncomplete =
    planningRequired &&
    input.planningTrace?.hasChecklist === true &&
    input.planningTrace.checklistComplete !== true;
  const awaitingUserReply = hasAwaitingUserReplyToolCall(input.toolCalls);

  if (runtimeCompletionTrace?.terminal === "blocked") {
    return {
      source: "deterministic",
      terminal: "blocked",
      allowFinish: false,
      failureReason: runtimeCompletionTrace.reason || "runtime_completion_blocked",
      rationale: "agent loop 返回结构化 blocked completionTrace，当前回合不能标记完成。",
      successCriteria: ["agent loop 允许收口或给出可见的结构化失败态"],
      missingCriteria: [runtimeCompletionTrace.reason || "runtime_completion_allowed"],
      requiredActions: ["继续执行缺失步骤或显式暴露阻塞原因"],
    };
  }
  if (awaitingUserReply) {
    return {
      source: "deterministic",
      terminal: "success",
      allowFinish: true,
      failureReason: null,
      rationale: "ask_user 已向用户发起问题，当前回合合法停止并等待用户回复。",
      successCriteria: ["用户问题已结构化记录"],
      missingCriteria: [],
      requiredActions: [],
    };
  }
  if (planningChecklistMissing) {
    return {
      source: "deterministic",
      terminal: "blocked",
      allowFinish: false,
      failureReason: "planning_checklist_missing",
      rationale: "本轮被标记为执行型任务，但 trace 中没有任何 TodoWrite checklist 证据。",
      successCriteria: ["执行前先建立至少一份结构化 checklist"],
      missingCriteria: ["planning_checklist_present"],
      requiredActions: ["先调用 TodoWrite 建立 checklist，再继续执行"],
    };
  }
  if (planningTooShort) {
    return {
      source: "deterministic",
      terminal: "blocked",
      allowFinish: false,
      failureReason: "planning_checklist_too_short",
      rationale: `执行型任务的 checklist 步骤数不足，当前少于 ${input.planningTrace?.minimumStepCount ?? 2} 项。`,
      successCriteria: ["checklist 至少覆盖两个以上可验证步骤"],
      missingCriteria: ["planning_checklist_minimum_depth"],
      requiredActions: ["补足更细的 TodoWrite checklist，再继续执行"],
    };
  }
  if (planningIncomplete) {
    return {
      source: "deterministic",
      terminal: "blocked",
      allowFinish: false,
      failureReason: "planning_checklist_incomplete",
      rationale: "执行型任务的 checklist 仍有 pending 或 in_progress 项，不能直接收口为完成态。",
      successCriteria: ["checklist 中的关键项全部完成"],
      missingCriteria: ["planning_checklist_completed"],
      requiredActions: ["继续推进 checklist，直到所有项完成或显式失败"],
    };
  }
  if (runtimeCompletionTrace?.terminal === "explicit_failure") {
    return {
      source: "deterministic",
      terminal: "explicit_failure",
      allowFinish: true,
      failureReason: runtimeCompletionTrace.reason || "assistant_explicit_failure",
      rationale: "agent loop 返回结构化 explicit_failure completionTrace。",
      successCriteria: ["失败原因对用户可见且可追踪"],
      missingCriteria: [],
      requiredActions: [],
    };
  }
  return {
    source: "deterministic",
    terminal: "success",
    allowFinish: true,
    failureReason: null,
    rationale: "未检测到阻塞态或显式失败信号，按成功收口。",
    successCriteria: ["存在最终用户可见回复"],
    missingCriteria: [],
    requiredActions: [],
  };
}

function getCompletionSelfCheckRetryBudget(): number {
  const raw = Number(process.env.AGENTS_COMPLETION_SELF_CHECK_MAX_RETRIES);
  if (!Number.isFinite(raw)) return 2;
  return Math.max(0, Math.min(4, Math.trunc(raw)));
}

function getCompletionSelfCheckMaxTotalRetries(): number {
  const raw = Number(process.env.AGENTS_COMPLETION_SELF_CHECK_MAX_TOTAL_RETRIES);
  if (!Number.isFinite(raw)) return 6;
  return Math.max(1, Math.min(12, Math.trunc(raw)));
}

function buildCompletionSelfCheckSteerMessage(input: {
  originalPrompt: string;
  completion: AgentsChatCompletionTrace;
  planning: AgentsChatPlanningTrace | null;
  retryIndex: number;
  retryBudget: number;
}): string {
  const lines = [
    "<runtime_completion_self_check>",
    "本轮尚不能结束。上一轮输出未通过 runtime completion gate，请基于当前真实历史与工具证据继续修正，而不是重复宣称已完成。",
    `originalPrompt: ${input.originalPrompt}`,
    `retryIndex: ${input.retryIndex}`,
    `retryBudget: ${input.retryBudget}`,
    `failureReason: ${input.completion.failureReason || "unknown_blocked_completion"}`,
    `rationale: ${input.completion.rationale}`,
  ];
  if (input.completion.missingCriteria.length > 0) {
    lines.push("missingCriteria:");
    input.completion.missingCriteria.forEach((item) => {
      lines.push(`- ${item}`);
    });
  }
  if (input.completion.requiredActions.length > 0) {
    lines.push("requiredActions:");
    input.completion.requiredActions.forEach((item) => {
      lines.push(`- ${item}`);
    });
  }
  if (input.planning) {
    lines.push(
      `planningStatus: required=${input.planning.planningRequired} hasChecklist=${input.planning.hasChecklist} latestStepCount=${input.planning.latestStepCount} completed=${input.planning.completedCount} inProgress=${input.planning.inProgressCount} waiting=${input.planning.waitingCount} blocked=${input.planning.blockedCount} pending=${input.planning.pendingCount}`,
    );
  }
  lines.push(
    "要求：如果仍需执行，请直接继续调用必要工具完成缺失项；如果客观上无法完成，必须显式说明失败原因，禁止继续输出伪完成态。",
  );
  lines.push("</runtime_completion_self_check>");
  return lines.join("\n");
}

function readPlanningRequired(value: Record<string, unknown> | null): boolean {
  return value?.planningRequired === true;
}

function readPlanningMinimumStepCount(value: Record<string, unknown> | null): number {
  const raw = value?.planningMinimumSteps;
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) return 2;
  return Math.max(2, Math.min(8, Math.trunc(num)));
}

function buildPlanningTrace(input: {
  diagnosticContext: Record<string, unknown> | null;
  latestTodoListTrace: AgentsChatTodoListTrace | null;
  todoEvents: AgentsChatTodoEventTrace[];
}): AgentsChatPlanningTrace | null {
  const planningRequired = readPlanningRequired(input.diagnosticContext);
  const minimumStepCount = readPlanningMinimumStepCount(input.diagnosticContext);
  const latest = input.latestTodoListTrace;
  const maxObservedStepCount = input.todoEvents.reduce((max, item) => Math.max(max, item.totalCount), 0);
  const latestStepCount = latest?.totalCount ?? 0;
  const completedCount = latest?.completedCount ?? 0;
  const inProgressCount = latest?.inProgressCount ?? 0;
  const waitingCount = latest?.waitingCount ?? 0;
  const blockedCount = latest?.blockedCount ?? 0;
  const pendingCount = latest?.pendingCount ?? 0;
  const hasChecklist = latestStepCount > 0 || maxObservedStepCount > 0;
  if (!hasChecklist && !planningRequired) {
    return null;
  }
  return {
    source: "todo_list",
    planningRequired,
    minimumStepCount,
    hasChecklist,
    latestStepCount,
    maxObservedStepCount,
    completedCount,
    inProgressCount,
    waitingCount,
    blockedCount,
    pendingCount,
    meetsMinimumStepCount: Math.max(latestStepCount, maxObservedStepCount) >= minimumStepCount,
    checklistComplete:
      hasChecklist &&
      pendingCount <= 0 &&
      inProgressCount <= 0 &&
      waitingCount <= 0 &&
      blockedCount <= 0,
  };
}

function normalizeWhitelistIds(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = String(item || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeDiagnosticContext(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(source)) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) continue;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed) out[normalizedKey] = trimmed.slice(0, 500);
      continue;
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
      out[normalizedKey] = raw;
      continue;
    }
    if (Array.isArray(raw)) {
      const values = raw
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, 20);
      if (values.length) out[normalizedKey] = values;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeCanvasCapabilityTools(value: unknown, limit: number): AgentsChatCanvasCapabilityTool[] {
  if (!Array.isArray(value)) return [];
  const out: AgentsChatCanvasCapabilityTool[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    const parameters =
      record.parameters && typeof record.parameters === "object" && !Array.isArray(record.parameters)
        ? (sanitizeTraceValue(record.parameters) as Record<string, unknown>)
        : {};
    if (!name || !description || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name: name.slice(0, 120),
      description: description.slice(0, 600),
      parameters,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeCanvasNodeSpecs(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = String(rawKey || "").trim();
    if (!key || !(rawValue && typeof rawValue === "object" && !Array.isArray(rawValue))) continue;
    out[key] = sanitizeTraceValue(rawValue) as Record<string, unknown>;
    if (Object.keys(out).length >= 32) break;
  }
  return out;
}

function normalizeCanvasCapabilityManifest(value: unknown): AgentsChatCanvasCapabilityManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const version =
    typeof record.version === "string" && record.version.trim() ? record.version.trim().slice(0, 80) : null;
  const summary =
    typeof record.summary === "string" && record.summary.trim() ? record.summary.trim().slice(0, 1200) : null;
  const remoteTools = normalizeCanvasCapabilityTools(record.remoteTools, 48);
  const nodeSpecs = normalizeCanvasNodeSpecs(record.nodeSpecs);
  const protocols =
    record.protocols && typeof record.protocols === "object" && !Array.isArray(record.protocols)
      ? (sanitizeTraceValue(record.protocols) as Record<string, unknown>)
      : null;
  if (
    !version &&
    !summary &&
    remoteTools.length === 0 &&
    Object.keys(nodeSpecs).length === 0 &&
    !protocols
  ) {
    return null;
  }
  return {
    version,
    summary,
    remoteTools,
    nodeSpecs,
    protocols,
  };
}

function buildCanvasCapabilityPrompt(
  manifest: AgentsChatCanvasCapabilityManifest | null,
  options: { executableRemoteToolNames?: ReadonlySet<string> } = {},
): string {
  if (!manifest) return "";
  const lines: string[] = ["CanvasCapabilityManifest:"];
  if (manifest.version) lines.push(`- version: ${manifest.version}`);
  if (manifest.summary) lines.push(`- summary: ${manifest.summary}`);
  const nodeKinds = Object.keys(manifest.nodeSpecs);
  if (nodeKinds.length) {
    lines.push("- nodeKinds:");
    nodeKinds.slice(0, 24).forEach((kind) => {
      const spec = manifest.nodeSpecs[kind];
      const label = typeof spec.label === "string" ? spec.label : kind;
      const purpose = typeof spec.purpose === "string" ? spec.purpose : "";
      const defaultModel =
        typeof spec.defaultModel === "string" && spec.defaultModel.trim()
          ? spec.defaultModel.trim()
          : "";
      const firstAvailableModel =
        typeof spec.firstAvailableModel === "string" && spec.firstAvailableModel.trim()
          ? spec.firstAvailableModel.trim()
          : "";
      const availableModels = Array.isArray(spec.availableModels)
        ? spec.availableModels
            .map((item) => {
              if (!item || typeof item !== "object" || Array.isArray(item)) return "";
              const record = item as Record<string, unknown>;
              const value =
                typeof record.value === "string" && record.value.trim()
                  ? record.value.trim()
                  : "";
              return value;
            })
            .filter(Boolean)
            .slice(0, 16)
        : [];
      const modelFacts = [
        defaultModel ? `defaultModel=${defaultModel}` : "",
        firstAvailableModel ? `firstAvailableModel=${firstAvailableModel}` : "",
        availableModels.length ? `availableModels=${availableModels.join(", ")}` : "",
      ].filter(Boolean);
      lines.push(
        `  - ${kind} (${label})${purpose ? `: ${purpose}` : ""}${modelFacts.length ? ` [${modelFacts.join("; ")}]` : ""}`,
      );
    });
  }
  if (manifest.protocols) {
    lines.push("- protocols:");
    lines.push(stringifyStructuredOutputSpec(manifest.protocols, 4000));
  }
  if (manifest.remoteTools.length) {
    lines.push("- remoteCanvasTools:");
    manifest.remoteTools.slice(0, 48).forEach((tool) => {
      if (options.executableRemoteToolNames?.has(tool.name)) {
        lines.push(
          `  - ${tool.name}: provided through this turn's executable tools; use the function tool schema as the source of truth.`,
        );
        return;
      }
      lines.push(`  - ${tool.name}: ${tool.description}`);
    });
  }
  lines.push("- Treat this manifest as the source of truth for JarvisHub interfaces and graph contracts.");
  lines.push("- Do not invent unsupported node kinds, handles, remote tools, or write paths outside this manifest.");
  return lines.join("\n");
}

function normalizeReferenceImageSlots(value: unknown): AgentsChatReferenceImageSlot[] {
  if (!Array.isArray(value)) return [];
  const out: AgentsChatReferenceImageSlot[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const slot = typeof record.slot === "string" ? record.slot.trim() : "";
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!slot || !/^https?:\/\//i.test(url)) continue;
    const dedupeKey = `${slot}|${url}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      slot,
      url,
      role: typeof record.role === "string" && record.role.trim() ? record.role.trim().slice(0, 80) : null,
      label: typeof record.label === "string" && record.label.trim() ? record.label.trim().slice(0, 160) : null,
      note: typeof record.note === "string" && record.note.trim() ? record.note.trim().slice(0, 240) : null,
    });
    if (out.length >= 12) break;
  }
  return out;
}

function normalizeAssetInputs(value: unknown): AgentsChatAssetInput[] {
  if (!Array.isArray(value)) return [];
  const out: AgentsChatAssetInput[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;
    const assetId = typeof record.assetId === "string" && record.assetId.trim() ? record.assetId.trim().slice(0, 160) : null;
    const assetRefId =
      typeof record.assetRefId === "string" && record.assetRefId.trim() ? record.assetRefId.trim().slice(0, 160) : null;
    const role = typeof record.role === "string" && record.role.trim() ? record.role.trim().slice(0, 80) : null;
    const note = typeof record.note === "string" && record.note.trim() ? record.note.trim().slice(0, 240) : null;
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 160) : null;
    const weight =
      typeof record.weight === "number" && Number.isFinite(record.weight) ? Number(record.weight) : null;
    const dedupeKey = `${assetId || ""}|${assetRefId || ""}|${url}|${role || ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      assetId,
      assetRefId,
      url,
      role,
      note,
      name,
      weight,
    });
    if (out.length >= 12) break;
  }
  return out;
}

function buildAssetInputsPrompt(
  assetInputs: AgentsChatAssetInput[],
  referenceImageSlots: AgentsChatReferenceImageSlot[],
): string {
  if (assetInputs.length === 0 && referenceImageSlots.length === 0) return "";
  const lines: string[] = [
    "AssetInputs:",
    "- Use these assets as explicit semantic anchors for this turn.",
    "- @assetRefId or @name semantics: when the user mentions an @ identifier or asset name, bind it to the matching asset below.",
    "- Do not invent new @ identifiers; if a referenced asset is missing, report the gap instead of guessing.",
  ];
  if (assetInputs.length) {
    lines.push("- assets:");
    assetInputs.forEach((asset, index) => {
      const facts = [
        `index=${index + 1}`,
        asset.assetId ? `assetId=${asset.assetId}` : "",
        asset.assetRefId ? `assetRefId=${asset.assetRefId}` : "",
        asset.name ? `name=${asset.name}` : "",
        asset.role ? `role=${asset.role}` : "",
        asset.weight !== null ? `weight=${asset.weight}` : "",
        `url=${asset.url}`,
        asset.note ? `note=${asset.note}` : "",
      ].filter(Boolean);
      lines.push(`  - ${facts.join("; ")}`);
    });
  }
  if (referenceImageSlots.length) {
    lines.push("- referenceImageSlots:");
    referenceImageSlots.forEach((slot) => {
      const facts = [
        `slot=${slot.slot}`,
        slot.role ? `role=${slot.role}` : "",
        slot.label ? `label=${slot.label}` : "",
        slot.note ? `note=${slot.note}` : "",
        `url=${slot.url}`,
      ].filter(Boolean);
      lines.push(`  - ${facts.join("; ")}`);
    });
  }
  return lines.join("\n");
}

function normalizeAllowedToolNames(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const name = String(item || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function startAgentsHttpServer(
  input: {
    runner: AgentRunner;
    cwd: string;
    skills?: SkillLoader;
    systemOverride?: string;
    toolContextMeta?: Record<string, unknown>;
    memoryDir?: string;
  },
  options: AgentsHttpServerOptions
): Promise<{ url: string; close: () => Promise<void> }> {
  const host = String(options.host || "127.0.0.1").trim() || "127.0.0.1";
  const port = Number(options.port);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("无效的端口号。");
  }

  const token = typeof options.token === "string" ? options.token.trim() : "";
  const bodyLimitBytes =
    typeof options.bodyLimitBytes === "number" && Number.isFinite(options.bodyLimitBytes)
      ? Math.max(1024, Math.min(32_000_000, Math.trunc(options.bodyLimitBytes)))
      : 8_000_000;
  const maxAllowedTools = normalizeMaxAllowedTools(options.maxAllowedTools, "maxAllowedTools");

  const sanitizeKey = (key: string) => {
    const trimmed = String(key || "").trim();
    if (!trimmed) return "default";
    const normalized = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
    const prefix = normalized.slice(0, 48) || "session";
    const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 24);
    return `${prefix}__${digest}`;
  };

  const resolveUserSessionKey = (userId: string, sessionId: string) =>
    `${sanitizeKey(userId || "anon")}:${sanitizeKey(sessionId || "default")}`;

  const resolveSessionStoreDir = (userId: string) => {
    const memoryDir = typeof input.memoryDir === "string" && input.memoryDir.trim() ? input.memoryDir.trim() : ".agents/memory";
    // Scope to user id; upstream is authenticated so we trust it, but still sanitize for filesystem.
    return path.join(input.cwd, memoryDir, "users", sanitizeKey(userId || "anon"), "sessions");
  };

  const redisUrl = String(process.env.AGENTS_REDIS_URL || process.env.REDIS_URL || "").trim();
  const redisKeyPrefix = String(process.env.AGENTS_SESSION_CACHE_PREFIX || "agents:chat:session").trim();
  const redisTtlSeconds = (() => {
    const raw = Number(process.env.AGENTS_SESSION_CACHE_TTL_SECONDS ?? 600);
    if (!Number.isFinite(raw) || raw <= 0) return 600;
    return Math.max(30, Math.trunc(raw));
  })();
  let redisClient: ReturnType<typeof createClient> | null = null;

  const redisCacheKey = (userId: string, sessionId: string) =>
    `${redisKeyPrefix}:${resolveUserSessionKey(userId, sessionId)}`;

  const inflightSessionLocks = new Set<string>();

  const tryAcquireSessionLock = (
    userId: string,
    sessionId: string,
  ): { acquired: boolean; release: () => void } => {
    const key = resolveUserSessionKey(userId, sessionId);
    if (inflightSessionLocks.has(key)) {
      return { acquired: false, release: () => {} };
    }
    inflightSessionLocks.add(key);
    let released = false;
    return {
      acquired: true,
      release: () => {
        if (released) return;
        released = true;
        inflightSessionLocks.delete(key);
      },
    };
  };

  const parseMessageArray = (raw: string): Message[] | null => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return null;
      const valid = parsed.filter((msg): msg is Message => {
        if (!msg || typeof msg !== "object") return false;
        const rec = msg as Record<string, unknown>;
        return typeof rec.role === "string" && typeof rec.content === "string";
      });
      return valid;
    } catch {
      return null;
    }
  };

  const getRedisClient = async (): Promise<ReturnType<typeof createClient> | null> => {
    if (!redisUrl) return null;
    if (redisClient && redisClient.isOpen) return redisClient;
    try {
      const client = createClient({ url: redisUrl });
      client.on("error", (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[agents] redis runtime error: ${message}`);
      });
      await client.connect();
      redisClient = client;
      console.log(`[agents] redis connected sessionTtlSeconds=${redisTtlSeconds}`);
      return redisClient;
    } catch (err: unknown) {
      const message = errorMessage(err);
      console.error(`[agents] redis init failed. reason=${message}`);
      throw agentsHttpError(
        `Redis session store unavailable: ${message}`,
        "agents_session_store_unavailable",
        { action: "redis_connect" },
      );
    }
  };

  const loadSessionFromRedis = async (userId: string, sessionId: string): Promise<Message[] | null> => {
    const client = await getRedisClient();
    if (!client) return null;
    const key = redisCacheKey(userId, sessionId);
    try {
      const raw = await client.getEx(key, { EX: redisTtlSeconds });
      if (!raw) return null;
      const parsed = parseMessageArray(raw);
      if (!parsed) {
        console.warn(`[agents] redis session parse failed key=${key}`);
        throw agentsHttpError(
          "Redis session store returned invalid session payload",
          "agents_session_store_unavailable",
          { action: "redis_read", key },
        );
      }
      console.log(`[agents] redis session hit key=${key} messages=${parsed.length}`);
      return parsed;
    } catch (err: unknown) {
      const message = errorMessage(err);
      console.error(`[agents] redis session read failed key=${key} reason=${message}`);
      throw agentsHttpError(
        `Redis session store read failed: ${message}`,
        "agents_session_store_unavailable",
        { action: "redis_read", key },
      );
    }
  };

  const saveSessionToRedis = async (userId: string, sessionId: string, history: Message[]): Promise<void> => {
    const client = await getRedisClient();
    if (!client) return;
    const key = redisCacheKey(userId, sessionId);
    try {
      await client.setEx(
        key,
        redisTtlSeconds,
        JSON.stringify(history.filter((message) => message.ephemeral !== true)),
      );
      console.log(`[agents] redis session saved key=${key} messages=${history.length} ttlSeconds=${redisTtlSeconds}`);
    } catch (err: unknown) {
      const message = errorMessage(err);
      console.error(`[agents] redis session write failed key=${key} reason=${message}`);
      throw agentsHttpError(
        `Redis session store write failed: ${message}`,
        "agents_session_store_unavailable",
        { action: "redis_write", key },
      );
    }
  };

  const deleteSessionFromRedis = async (userId: string, sessionId: string): Promise<void> => {
    const client = await getRedisClient();
    if (!client) return;
    const key = redisCacheKey(userId, sessionId);
    try {
      await client.del(key);
      console.log(`[agents] redis session deleted key=${key}`);
    } catch (err: unknown) {
      const message = errorMessage(err);
      console.error(`[agents] redis session delete failed key=${key} reason=${message}`);
      throw agentsHttpError(
        `Redis session store delete failed: ${message}`,
        "agents_session_store_unavailable",
        { action: "redis_delete", key },
      );
    }
  };

  const saveSessionToFile = (userId: string, sessionId: string, history: Message[]) => {
    try {
      saveSessionMessages({ dir: resolveSessionStoreDir(userId), key: sessionId }, history);
    } catch (err: unknown) {
      const message = errorMessage(err);
      throw agentsHttpError(
        `File session store write failed: ${message}`,
        "agents_session_store_unavailable",
        {
          action: "file_write",
          userId: sanitizeKey(userId || "anon"),
          sessionId: sanitizeKey(sessionId || "default"),
        },
      );
    }
  };

  const json = (res: ServerResponse, status: number, data: unknown) => {
    const body = JSON.stringify(data);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(body));
    res.end(body);
  };

  const text = (res: ServerResponse, status: number, body: string) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(body));
    res.end(body);
  };

  const beginSse = (res: ServerResponse) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
  };

  const writeSse = (res: ServerResponse, payload: AgentsChatStreamEvent) =>
    new Promise<void>((resolve, reject) => {
      if (res.writableEnded || res.destroyed) {
        reject(new Error("SSE response already closed."));
        return;
      }
      try {
        res.write(`event: ${payload.event}\ndata: ${JSON.stringify(payload.data)}\n\n`, (error) => {
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

  const createResponseAbortController = (req: IncomingMessage, res: ServerResponse) => {
    const controller = new AbortController();
    let responseFinished = false;
    const abort = (reason: string) => {
      if (controller.signal.aborted) return;
      controller.abort(new Error(reason));
    };
    const onFinish = () => {
      responseFinished = true;
    };
    const onAborted = () => {
      abort("客户端在响应完成前中断了请求。");
    };
    const onClose = () => {
      if (!responseFinished) {
        abort("客户端在响应完成前关闭了连接。");
      }
    };
    res.on("finish", onFinish);
    req.on("aborted", onAborted);
    res.on("close", onClose);
    return {
      signal: controller.signal,
      abort,
      cleanup() {
        res.off("finish", onFinish);
        req.off("aborted", onAborted);
        res.off("close", onClose);
      },
    };
  };

  const notFound = (res: ServerResponse) => {
    json(res, 404, { error: "not_found" });
  };

  const unauthorized = (res: ServerResponse) => {
    json(res, 401, { error: "unauthorized" });
  };

  const badRequest = (res: ServerResponse, message: string) => {
    json(res, 400, { error: "invalid_request", message });
  };

  const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    let size = 0;

    for await (const chunk of req) {
      const buf =
        Buffer.isBuffer(chunk)
          ? chunk
          : typeof chunk === "string"
            ? Buffer.from(chunk)
            : ArrayBuffer.isView(chunk)
              ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
              : chunk instanceof ArrayBuffer
                ? Buffer.from(new Uint8Array(chunk))
                : Buffer.from(String(chunk));
      size += buf.length;
      if (size > bodyLimitBytes) {
        throw new Error(`请求体过大。size=${size} limit=${bodyLimitBytes}`);
      }
      chunks.push(buf);
    }

    const raw = Buffer.concat(chunks).toString("utf-8").trim();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("请求体不是合法 JSON。");
    }
  };

  const requireAuth = (req: IncomingMessage): boolean => {
    if (!token) return true;
    const headerRaw =
      typeof req.headers["authorization"] === "string"
        ? req.headers["authorization"]
        : Array.isArray(req.headers["authorization"])
          ? req.headers["authorization"][0] || ""
          : "";
    const xTokenRaw =
      typeof req.headers["x-agents-token"] === "string"
        ? req.headers["x-agents-token"]
        : Array.isArray(req.headers["x-agents-token"])
          ? req.headers["x-agents-token"][0] || ""
          : "";

    const bearer = headerRaw.toLowerCase().startsWith("bearer ")
      ? headerRaw.slice(7).trim()
      : "";
    const provided = bearer || String(xTokenRaw || "").trim();
    return provided === token;
  };

  const server = createServer(async (req, res) => {
    let requestClosedEarly = false;
    try {
      const method = (req.method || "GET").toUpperCase();
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const pathname = url.pathname || "/";

      if (method === "GET" && pathname === "/health") {
        return json(res, 200, { ok: true });
      }

      if (!requireAuth(req)) {
        return unauthorized(res);
      }

      if (method === "GET" && pathname === "/skills") {
        if (!input.skills) {
          return json(res, 503, {
            error: "skills_unavailable",
            message: "runtime skill loader is not attached",
          });
        }
        input.skills.reloadSkills();
        return json(res, 200, {
          source: "agents-cli",
          refreshedAt: new Date().toISOString(),
          skills: input.skills.listSkillSummaries(),
          loadErrors: input.skills.getLoadErrors(),
        });
      }

      if (method === "POST" && pathname === "/chat") {
        const startedAt = Date.now();
        const body = (await readJsonBody(req)) as AgentsChatRequest;
        const contentLength = (() => {
          const raw: unknown = (req.headers as Record<string, unknown>)["content-length"];
          if (typeof raw === "string") return raw.trim();
          if (Array.isArray(raw)) return String(raw[0] || "").trim();
          return "";
        })();
        const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
        if (!prompt) return badRequest(res, "prompt 不能为空。");

        const userIdFromBody = typeof body?.userId === "string" ? body.userId.trim() : "";
        const userIdFromHeader =
          typeof req.headers["x-agents-user-id"] === "string"
            ? req.headers["x-agents-user-id"].trim()
            : Array.isArray(req.headers["x-agents-user-id"])
              ? (req.headers["x-agents-user-id"][0] || "").trim()
              : "";
        const userId = userIdFromBody || userIdFromHeader || "anon";
        const systemPrompt = typeof body?.systemPrompt === "string" ? body.systemPrompt.trim() : "";
        const responseFormat =
          typeof body?.responseFormat !== "undefined"
            ? body.responseFormat
            : typeof body?.response_format !== "undefined"
              ? body.response_format
              : undefined;
        const wantsStream = body?.stream === true;
        const modelOverride =
          typeof body?.modelAlias === "string" && body.modelAlias.trim()
            ? body.modelAlias.trim()
            : typeof body?.model === "string" && body.model.trim()
              ? body.model.trim()
              : typeof body?.modelKey === "string" && body.modelKey.trim()
                ? body.modelKey.trim()
                : "";
        const llmProtocolRaw =
          typeof body?.llmApiProtocol === "string" ? body.llmApiProtocol.trim() : "";
        if (llmProtocolRaw && !isAgentLlmCredsApiProtocol(llmProtocolRaw)) {
          return badRequest(
            res,
            `unsupported Agent protocol: ${llmProtocolRaw}（支持 openai-chat / openai-responses / google-v1beta / anthropic-messages）`,
          );
        }
        const multimodalProtocolRaw =
          body?.multimodalCreds && typeof body.multimodalCreds.apiProtocol === "string"
            ? body.multimodalCreds.apiProtocol.trim()
            : "";
        if (multimodalProtocolRaw && !isAgentLlmCredsApiProtocol(multimodalProtocolRaw)) {
          return badRequest(
            res,
            `unsupported multimodal Agent protocol: ${multimodalProtocolRaw}（支持 openai-chat / openai-responses / google-v1beta / anthropic-messages）`,
          );
        }
        const injectedLlmCreds = (() => {
          const apiKey = typeof body?.llmApiKey === "string" ? body.llmApiKey.trim() : "";
          const baseUrl = typeof body?.llmApiBaseUrl === "string" ? body.llmApiBaseUrl.trim() : "";
          const model = typeof body?.llmModel === "string" ? body.llmModel.trim() : "";
          if (!apiKey || !baseUrl) return null;
          const apiProtocol = isAgentLlmCredsApiProtocol(llmProtocolRaw)
            ? llmProtocolRaw
            : undefined;
          return { apiKey, baseUrl, model, ...(apiProtocol ? { apiProtocol } : {}) };
        })();
        const injectedMultimodalCreds = (() => {
          const raw = body?.multimodalCreds;
          if (!raw || typeof raw !== "object") return null;
          const apiKey = typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
          const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
          const model = typeof raw.model === "string" ? raw.model.trim() : "";
          const apiProtocol = isAgentLlmCredsApiProtocol(multimodalProtocolRaw)
            ? multimodalProtocolRaw
            : undefined;
          if (!apiKey || !baseUrl) return null;
          return { apiKey, baseUrl, model, ...(apiProtocol ? { apiProtocol } : {}) };
        })();
        if (!injectedLlmCreds) {
          return badRequest(
            res,
            "agent_llm_credentials_missing: 请求缺少 llmApiKey/llmApiBaseUrl。HTTP 服务模式要求 hono-api bridge 在每次 /chat 注入 Agent 大脑凭证（见 ModelPanel → Agent 大脑）。"
          );
        }
        console.log(
          `[agents] /chat request started user=${userId} promptChars=${prompt.length} systemChars=${systemPrompt.length} model=${modelOverride || "default"} llmCreds=${injectedLlmCreds.baseUrl}#${injectedLlmCreds.model || "default"} contentLength=${contentLength || "n/a"} bodyLimit=${bodyLimitBytes}`
        );

        const requiredSkills = Array.isArray(body?.requiredSkills)
          ? body.requiredSkills.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 8)
          : [];
        const allowedToolNames = normalizeAllowedToolNames(body?.allowedTools);
        if (allowedToolNames && allowedToolNames.length > maxAllowedTools) {
          return badRequest(
            res,
            `allowedTools 过多：收到 ${allowedToolNames.length} 个，最多允许 ${maxAllowedTools} 个。`,
          );
        }
        const allowedTools = allowedToolNames ? new Set(allowedToolNames) : null;
        const maxTurnsRaw = Number(body?.maxTurns);
        const maxTurns =
          Number.isFinite(maxTurnsRaw) && maxTurnsRaw > 0
            ? Math.max(1, Math.min(128, Math.trunc(maxTurnsRaw)))
            : undefined;
        const allowedSubagentTypes = Array.isArray(body?.allowedSubagentTypes)
          ? body.allowedSubagentTypes
              .map((item: unknown) => String(item || "").trim())
              .filter(Boolean)
              .slice(0, 12)
          : [];
        const compactPrelude = body?.compactPrelude === true || requiredSkills.length > 0;
        const userSessionStoreDir = resolveSessionStoreDir(userId);
        const userMemoryRoot = path.dirname(userSessionStoreDir);
        const novelsRoot = path.join(userMemoryRoot, "novels");
        const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
        const shouldReset = body?.resetSession === true;
        let releaseSessionLock: (() => void) | null = null;
        if (sessionId) {
          const acquire = tryAcquireSessionLock(userId, sessionId);
          if (!acquire.acquired) {
            console.warn(
              `[agents] /chat rejected: session busy user=${userId} sessionId=${sessionId}`,
            );
            return json(res, 409, {
              error: "agents_session_busy",
              message: `Session ${sessionId} 已有处理中的请求，请等其完成后再试`,
              code: "agents_session_busy",
            });
          }
          releaseSessionLock = acquire.release;
        }
        try {
        if (sessionId && shouldReset) {
          await deleteSessionFromRedis(userId, sessionId);
        }

        const privilegedLocalAccess = body?.privilegedLocalAccess === true;
        const forceLocalResourceViaBash = body?.forceLocalResourceViaBash === true;
        const disableMemory = body?.disableMemory === true;
        const localResourcePaths = normalizeStringList(body?.localResourcePaths, 12);
        const resourceWhitelistRaw =
          body?.resourceWhitelist && typeof body.resourceWhitelist === "object"
            ? (body.resourceWhitelist as {
                projectIds?: unknown;
                allowUserScopedPublicAssets?: unknown;
                allowSystemPublicMetadata?: unknown;
                allowRepoKnowledgeRead?: unknown;
                restrictRepoKnowledgeRead?: unknown;
              })
            : null;
        const allowedProjectIds = normalizeWhitelistIds(resourceWhitelistRaw?.projectIds, 8);
        const resourceWhitelist =
          allowedProjectIds.length ||
          resourceWhitelistRaw?.allowUserScopedPublicAssets === true ||
          resourceWhitelistRaw?.allowSystemPublicMetadata === true ||
          resourceWhitelistRaw?.allowRepoKnowledgeRead === true ||
          resourceWhitelistRaw?.restrictRepoKnowledgeRead === true
            ? {
                ...(allowedProjectIds.length ? { allowedProjectIds } : {}),
                ...(resourceWhitelistRaw?.allowUserScopedPublicAssets === true
                  ? { allowUserScopedPublicAssets: true }
                  : {}),
                ...(resourceWhitelistRaw?.allowSystemPublicMetadata === true
                  ? { allowSystemPublicMetadata: true }
                  : {}),
                ...(resourceWhitelistRaw?.allowRepoKnowledgeRead === true
                  ? { allowRepoKnowledgeRead: true }
                  : {}),
                ...(resourceWhitelistRaw?.restrictRepoKnowledgeRead === true
                  ? { restrictRepoKnowledgeRead: true }
                  : {}),
              }
            : null;
        const referenceImages = Array.isArray(body?.referenceImages)
          ? body.referenceImages
              .map((item) => String(item || "").trim())
              .filter((item) => /^https?:\/\//i.test(item))
              .slice(0, 3)
          : [];
        const assetInputs = normalizeAssetInputs(body?.assetInputs);
        const referenceImageSlots = normalizeReferenceImageSlots(body?.referenceImageSlots);
        const diagnosticContext = normalizeDiagnosticContext(body?.diagnosticContext);
        const canvasCapabilityManifest = normalizeCanvasCapabilityManifest(body?.canvasCapabilityManifest);
        const executableRemoteToolNames = new Set(
          normalizeRemoteToolDefinitions(body?.remoteTools)
            .map((tool) => tool.name)
            .filter((name) => !allowedTools || allowedTools.has(name)),
        );
        const parsedGenerationContract = parseGenerationContract(body?.generationContract);
        if (!parsedGenerationContract.ok) {
          return badRequest(res, `generationContract 无效: ${parsedGenerationContract.error}`);
        }
        const generationContract = parsedGenerationContract.value;
        const hasUpstreamSystemPrompt = systemPrompt.trim().length > 0;
        const resourceHint = resourceWhitelist
          ? [
              "ResourceWhitelist:",
              ...(resourceWhitelist.allowedProjectIds?.length
                ? [`- allowedProjectIds: ${resourceWhitelist.allowedProjectIds.join(", ")}`]
                : []),
              ...(resourceWhitelist.allowUserScopedPublicAssets
                ? ["- allowUserScopedPublicAssets: true"]
                : []),
              ...(resourceWhitelist.allowSystemPublicMetadata
                ? ["- allowSystemPublicMetadata: true"]
                : []),
              ...((resourceWhitelist as Record<string, unknown>).allowRepoKnowledgeRead === true
                ? ["- allowRepoKnowledgeRead: true (read-only under runtime skill roots)"]
                : []),
              ...((resourceWhitelist as Record<string, unknown>).restrictRepoKnowledgeRead === true
                ? ["- restrictRepoKnowledgeRead: true (only runtime skill roots are readable)"]
                : []),
              ...((resourceWhitelist as Record<string, unknown>).restrictRepoKnowledgeRead === true
                ? [
                    `- repoKnowledgeRoots: ${renderRepoKnowledgeRuntimeRoots()}`,
                  ]
                : []),
              "Only access resources inside this whitelist. Treat repository source code and arbitrary local files as forbidden unless upstream explicitly grants them.",
            ]
          : [];
        const userHint = [
          ...(canvasCapabilityManifest
            ? [
                buildCanvasCapabilityPrompt(canvasCapabilityManifest, {
                  executableRemoteToolNames,
                }),
              ]
            : []),
          buildAssetInputsPrompt(assetInputs, referenceImageSlots),
          formatGenerationContractPromptLines(generationContract).join("\n"),
          ...resourceHint,
        ].filter(Boolean).join("\n");
        const structuredOutputPrompt = buildStructuredOutputPrompt(responseFormat);
        const combinedSystem = joinSystemSections(
          String(input.systemOverride || "").trim(),
          buildHttpPlanningSystemPrompt(diagnosticContext),
          userHint,
          structuredOutputPrompt,
          systemPrompt,
        );
        const effectiveSystem = combinedSystem;
        const toolContextMeta: Record<string, unknown> = {
          ...(input.toolContextMeta ? input.toolContextMeta : {}),
          ...createRuntimeChannelMeta({
            kind: "http",
            transport: wantsStream ? "stream" : "request_response",
            surface: "/chat",
            ...(sessionId ? { sessionId } : {}),
            ...(userId ? { userId } : {}),
          }),
          workspaceRoot:
            typeof input.toolContextMeta?.workspaceRoot === "string" && input.toolContextMeta.workspaceRoot.trim()
              ? input.toolContextMeta.workspaceRoot.trim()
              : input.cwd,
          userId,
          userMemoryRoot,
          novelsRoot,
          ...(referenceImages.length ? { sessionReferenceImages: referenceImages } : {}),
          ...(assetInputs.length ? { sessionAssetInputs: assetInputs } : {}),
          ...(allowedSubagentTypes.length ? { allowedSubagentTypes } : {}),
          ...(injectedMultimodalCreds ? { multimodalCreds: injectedMultimodalCreds } : {}),
          ...(privilegedLocalAccess ? { privilegedLocalAccess: true } : {}),
          ...(forceLocalResourceViaBash ? { forceLocalResourceViaBash: true } : {}),
          ...(disableMemory ? { disableMemory: true } : {}),
          ...(typeof body?.memorySyncUrl === "string" && body.memorySyncUrl.trim() ? { memorySyncUrl: body.memorySyncUrl.trim() } : {}),
          ...(typeof body?.memorySyncProjectId === "string" && body.memorySyncProjectId.trim() ? { memorySyncProjectId: body.memorySyncProjectId.trim() } : {}),
          ...(localResourcePaths.length ? { localResourcePaths } : {}),
          ...(diagnosticContext ? { diagnosticContext } : {}),
          ...(generationContract ? { generationContract } : {}),
          ...(referenceImageSlots.length ? { referenceImageSlots } : {}),
          ...(resourceWhitelist ? { resourceWhitelist } : {}),
          ...(canvasCapabilityManifest ? { canvasCapabilityManifest } : {}),
          ...(Array.isArray(body?.remoteTools) ? { remoteTools: body.remoteTools } : {}),
          ...(Array.isArray(body?.mcpTools) ? { mcpTools: body.mcpTools } : {}),
          ...(body?.remoteToolConfig && typeof body.remoteToolConfig === "object" && !Array.isArray(body.remoteToolConfig)
            ? { remoteToolConfig: body.remoteToolConfig }
            : {}),
          ...(body?.mcpToolConfig && typeof body.mcpToolConfig === "object" && !Array.isArray(body.mcpToolConfig)
            ? { mcpToolConfig: body.mcpToolConfig }
            : {}),
        };

        const canvasFlowId = (() => {
          const cfg = body?.remoteToolConfig;
          if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return "";
          const fid = (cfg as Record<string, unknown>).flowId;
          return typeof fid === "string" ? fid.trim() : "";
        })();
        let canvasSubscription: CanvasSubscriptionHandle | null = null;
        if (canvasFlowId && redisUrl) {
          canvasSubscription = await subscribeToCanvasMutations({
            redisUrl,
            flowId: canvasFlowId,
            ownSessionId: sessionId || undefined,
          });
        }

        const history =
          sessionId
            ? ((await loadSessionFromRedis(userId, sessionId)) ??
                loadSessionMessages({ dir: userSessionStoreDir, key: sessionId }))
            : [];
        const responseAbort = createResponseAbortController(req, res);
        responseAbort.signal.addEventListener("abort", () => {
          requestClosedEarly = true;
        }, { once: true });

        const toolCalls: AgentsChatToolCall[] = [];
        const turns: AgentsChatTrace["turns"] = [];
        let latestTodoListTrace: AgentsChatTodoListTrace | null = null;
        const todoEvents: AgentsChatTodoEventTrace[] = [];
        let lastRuntimeEvent: RuntimeRunEvent | null = null;
        let toolSeq = 0;
        let sseClosed = false;
        let sseWriteQueue = Promise.resolve();
        const threadId = sessionId || `thread_${randomUUID()}`;
        const turnId = `turn_${randomUUID()}`;
        const assistantItemId = `message_${randomUUID()}`;
        const resultItemId = `result_${randomUUID()}`;
        let assistantItemStarted = false;
        if (wantsStream) {
          beginSse(res);
          responseAbort.signal.addEventListener("abort", () => {
            sseClosed = true;
          }, { once: true });
        }
        const emitStreamEvent = (payload: AgentsChatStreamEvent) => {
          if (!wantsStream || sseClosed) return;
          sseWriteQueue = sseWriteQueue
            .then(async () => {
              if (sseClosed) return;
              await writeSse(res, payload);
            })
            .catch(() => {
              sseClosed = true;
              responseAbort.abort("SSE 写入失败，客户端连接已断开。");
            });
        };
        const ensureAssistantItemStarted = () => {
          if (!wantsStream || assistantItemStarted) return;
          assistantItemStarted = true;
          emitStreamEvent({
            event: "item.started",
            data: {
              threadId,
              turnId,
              itemId: assistantItemId,
              itemType: "message",
              role: "assistant",
            },
          });
        };
        const emitRuntimeEvent = (event: RuntimeRunEvent) => {
          lastRuntimeEvent = event;
          if (!wantsStream) return;
          projectRuntimeEventToStream(
            {
              threadId,
              turnId,
              userId,
              sessionId,
              promptPreview: truncateForLog(prompt, 240),
              assistantItemId,
              emitStreamEvent,
              ensureAssistantItemStarted,
            },
            event,
          );
        };
        toolContextMeta.eventSink = emitRuntimeEvent;
        const buildStreamFailureDiagnostics = (): AgentsChatStreamFailureDiagnostics => {
          const abortReason = responseAbort.signal.aborted
            ? errorMessage(responseAbort.signal.reason)
            : null;
          const lastToolCall = toolCalls.length ? toolCalls[toolCalls.length - 1] : null;
          const runtimeEvent = lastRuntimeEvent;
          return {
            requestId: turnId,
            userId,
            sessionId,
            elapsedMs: Math.max(0, Date.now() - startedAt),
            abortReason,
            responseClosedEarly: requestClosedEarly,
            sseClosed,
            toolCallCount: toolCalls.length,
            lastToolCall: lastToolCall
              ? {
                  seq: lastToolCall.seq,
                  name: lastToolCall.name,
                  status: lastToolCall.status,
                  durationMs: lastToolCall.durationMs,
                  ...(lastToolCall.errorMessage ? { errorMessage: lastToolCall.errorMessage } : {}),
                }
              : null,
            lastRuntimeEvent: runtimeEvent
              ? {
                  type: runtimeEvent.type,
                  ...(typeof runtimeEvent.agentType === "string" && runtimeEvent.agentType
                    ? { agentType: runtimeEvent.agentType }
                    : {}),
                  ...(typeof runtimeEvent.agentId === "string" && runtimeEvent.agentId
                    ? { agentId: runtimeEvent.agentId }
                    : {}),
                  ...(runtimeEvent.type === "tool.started"
                    ? { toolName: runtimeEvent.name, toolCallId: runtimeEvent.toolCallId }
                    : {}),
                  ...(runtimeEvent.type === "tool.completed"
                    ? {
                        toolName: runtimeEvent.toolCall.name,
                        toolCallId: runtimeEvent.toolCall.toolCallId,
                      }
                    : {}),
                  ...(runtimeEvent.type === "subagent.status"
                    ? {
                        subagentType: runtimeEvent.subagentType,
                        subagentStatus: runtimeEvent.status,
                      }
                    : {}),
                  ...(runtimeEvent.type === "run.failed" ? { message: runtimeEvent.message } : {}),
                }
              : null,
          };
        };

        try {
          if (wantsStream) {
            emitRuntimeEvent({
              type: "run.started",
              prompt,
              ...(sessionId ? { sessionId } : {}),
            });
          }
          let currentPrompt = prompt;

          let responseText = "";
          let planningTrace: AgentsChatPlanningTrace | null = null;
          let completionTrace: AgentsChatCompletionTrace | null = null;
          const completionSelfCheckRetryBudget = getCompletionSelfCheckRetryBudget();
          const completionSelfCheckMaxTotalRetries = getCompletionSelfCheckMaxTotalRetries();
          let completionRetryCount = 0;
          let consecutiveBlockedFinishCount = 0;
          let previousBlockedCompletionState: CompletionBlockedStateSnapshot | null = null;

          while (true) {
            const toolCallCountBeforeAttempt = toolCalls.length;
            let attemptResultText: string;
            try {
              attemptResultText = await input.runner.run(currentPrompt, input.cwd, {
              depth: 0,
              ...(sessionId ? { sessionId } : {}),
              history,
              ...(completionRetryCount > 0 ? { ephemeralUserPrompt: true } : {}),
              systemOverride: effectiveSystem,
              ...(modelOverride ? { modelOverride } : {}),
              ...(injectedLlmCreds ? { currentLlmCreds: injectedLlmCreds } : {}),
              ...(requiredSkills.length ? { requiredSkills } : {}),
              ...(allowedTools ? { allowedTools } : {}),
              ...(typeof maxTurns === "number" ? { maxTurns } : {}),
              ...(compactPrelude ? { compactPrelude: true } : {}),
              ...(Object.keys(toolContextMeta).length ? { toolContextMeta } : {}),
              abortSignal: responseAbort.signal,
              onTurn: (turn) => {
                turns.push({
                  turn: turn.turn,
                  text: turn.text,
                  textPreview: turn.textPreview,
                  textChars: turn.textChars,
                  toolCallCount: turn.toolCallCount,
                  toolNames: [...turn.toolNames],
                  finished: turn.finished,
                });
                emitRuntimeEvent({ type: "turn.completed", turn });
              },
              onToolStart: (toolStart) => {
                emitRuntimeEvent({
                  type: "tool.started",
                  toolCallId: toolStart.toolCallId,
                  name: toolStart.name,
                  args: toolStart.args,
                  startedAt: toolStart.startedAt,
                });
              },
              onTextDelta: (delta) => {
                emitRuntimeEvent({ type: "text.delta", delta });
              },
              onToolCall: (toolCall) => {
                const toolStartedAt = Date.parse(toolCall.startedAt);
                const atMs = Number.isFinite(toolStartedAt)
                  ? Math.max(0, toolStartedAt - startedAt)
                  : Math.max(0, Date.now() - startedAt);
                toolSeq += 1;
                const sanitizedInput = sanitizeTraceValue(toolCall.args);
                const sanitizedOutput = sanitizeToolOutputPreview(toolCall.output);
                const structuredOutputJson = toolCall.outputJson ?? extractStructuredOutputJson(toolCall.output);
                const fallbackOutputEdges = extractTextEdges(toolCall.output, 400);
                const outputEdges = {
                  head: toolCall.outputHead.trim() || fallbackOutputEdges.head,
                  tail: toolCall.outputTail.trim() || fallbackOutputEdges.tail,
                };
                const outputChars =
                  Number.isFinite(toolCall.outputChars) && toolCall.outputChars >= 0
                    ? Math.max(0, Math.trunc(toolCall.outputChars))
                    : sanitizedOutput.chars;
                const pathHint = extractInputPathHint(toolCall.args);
                toolCalls.push({
                  seq: toolSeq,
                  atMs,
                  name: String(toolCall.name || "").trim() || "tool",
                  status: toolCall.status,
                  input: sanitizedInput,
                  outputPreview: sanitizedOutput.preview,
                  ...(structuredOutputJson ? { outputJson: structuredOutputJson } : {}),
                  outputChars,
                  outputHead: outputEdges.head,
                  outputTail: outputEdges.tail,
                  startedAt: toolCall.startedAt,
                  finishedAt: toolCall.finishedAt,
                  durationMs: Math.max(0, Math.trunc(toolCall.durationMs)),
                  ...(toolCall.errorMessage ? { errorMessage: toolCall.errorMessage } : {}),
                  ...(pathHint ? { pathHint } : {}),
                });
                const todoListTrace = parseTodoListTraceFromToolCall({
                  toolCallId: toolCall.toolCallId,
                  toolName: String(toolCall.name || "").trim(),
                  status: toolCall.status,
                  output: String(toolCall.output || ""),
                });
                if (todoListTrace) {
                  latestTodoListTrace = todoListTrace;
                  todoEvents.push(toTodoEventTrace({
                    todoListTrace,
                    atMs,
                    startedAt: toolCall.startedAt,
                    finishedAt: toolCall.finishedAt,
                    durationMs: toolCall.durationMs,
                  }));
                }
                const runtimeTodoUpdate = parseRuntimeTodoUpdate(toolCall);
                if (runtimeTodoUpdate) {
                  emitRuntimeEvent({ type: "todo.updated", todo: runtimeTodoUpdate });
                }
                emitRuntimeEvent({ type: "tool.completed", toolCall });
                console.log(
                  `[agents] /chat tool user=${userId} name=${toolCall.name} status=${toolCall.status} args=${truncateJsonForLog(toolCall.args)} outputPreview=${truncateForLog(toolCall.output)}`,
                );
              },
            });
            } catch (runErr) {
              if (sessionId && responseAbort.signal.aborted) {
                try {
                  saveSessionToFile(userId, sessionId, history);
                  await saveSessionToRedis(userId, sessionId, history);
                  console.log(
                    `[agents] session saved on abort key=${sessionId} messages=${history.length}`,
                  );
                } catch (saveErr) {
                  console.warn(
                    `[agents] failed to save session on abort: ${(saveErr as Error)?.message ?? saveErr}`,
                  );
                }
              }
              const message = errorMessage(runErr);
              const code = errorCode(runErr) || (responseAbort.signal.aborted ? "agents_http_request_aborted" : "agents_http_run_failed");
              const details = mergeErrorDetails(errorDetails(runErr), {
                streamFailure: buildStreamFailureDiagnostics(),
              });
              throw agentsHttpError(message, code, details);
            }

            responseText = String(attemptResultText || "");
            planningTrace = buildPlanningTrace({
              diagnosticContext,
              latestTodoListTrace,
              todoEvents,
            });
            const completionCandidate = buildCompletionTrace({
              responseText,
              toolCalls,
              planningTrace,
              runtimeCompletionTrace: toolContextMeta.completionTrace,
            });
            if (completionCandidate.allowFinish) {
              completionTrace = {
                ...completionCandidate,
                ...(completionRetryCount > 0
                  ? { retryCount: completionRetryCount, recoveredAfterRetry: true }
                  : {}),
              };
              break;
            }

            const toolCorrectionObserved = toolCalls.length > toolCallCountBeforeAttempt;
            const currentBlockedCompletionState = buildCompletionBlockedStateSnapshot({
              completion: completionCandidate,
              planningTrace,
              toolCalls,
            });
            const blockedStateAdvanced =
              toolCorrectionObserved &&
              !blockedStateSnapshotEquals(
                previousBlockedCompletionState,
                currentBlockedCompletionState,
              );
            if (blockedStateAdvanced) {
              consecutiveBlockedFinishCount = 0;
            }
            consecutiveBlockedFinishCount += 1;
            previousBlockedCompletionState = currentBlockedCompletionState;

            const totalRetryBudgetExceeded =
              completionRetryCount >= completionSelfCheckMaxTotalRetries;
            const consecutiveRetryBudgetExceeded =
              consecutiveBlockedFinishCount > completionSelfCheckRetryBudget;
            if (totalRetryBudgetExceeded || consecutiveRetryBudgetExceeded) {
              completionTrace = {
                ...completionCandidate,
                ...(completionRetryCount > 0 ? { retryCount: completionRetryCount } : {}),
              };
              console.warn(
                `[agents] /chat completion blocked after retry budget exhausted user=${userId} failureReason=${completionCandidate.failureReason || "unknown"} retries=${completionRetryCount}/${completionSelfCheckRetryBudget} totalLimit=${completionSelfCheckMaxTotalRetries}`,
              );
              break;
            }

            completionRetryCount += 1;
            currentPrompt = buildCompletionSelfCheckSteerMessage({
              originalPrompt: prompt,
              completion: completionCandidate,
              planning: planningTrace,
              retryIndex: completionRetryCount,
              retryBudget: completionSelfCheckRetryBudget,
            });
            console.warn(
              `[agents] /chat completion blocked; retrying self-check user=${userId} failureReason=${completionCandidate.failureReason || "unknown"} retry=${completionRetryCount}/${completionSelfCheckRetryBudget}`,
            );
          }

          if (sessionId) {
            saveSessionToFile(userId, sessionId, history);
            await saveSessionToRedis(userId, sessionId, history);
          }

          const outputPreview = sanitizeToolOutputPreview(responseText);
          const outputEdges = extractTextEdges(responseText, 1200);
          const toolStatusCounts = toolCalls.reduce(
            (acc, item) => {
              if (item.status === "succeeded") acc.succeededToolCalls += 1;
              if (item.status === "failed") acc.failedToolCalls += 1;
              if (item.status === "denied") acc.deniedToolCalls += 1;
              if (item.status === "blocked") acc.blockedToolCalls += 1;
              return acc;
            },
            {
              succeededToolCalls: 0,
              failedToolCalls: 0,
              deniedToolCalls: 0,
              blockedToolCalls: 0,
            }
          );
          const runtimeMeta = toolContextMeta;
          const registeredToolNames = normalizeStringList(runtimeMeta.registeredToolNames, 256);
          const loadedSkills = collectLoadedSkillsForTrace({
            requiredSkills,
            toolCalls,
            messages: history,
          });
          const traceCanvasCapabilities = canvasCapabilityManifest
            ? {
                version: canvasCapabilityManifest.version,
                remoteToolNames: canvasCapabilityManifest.remoteTools.map((tool) => tool.name),
                nodeKinds: Object.keys(canvasCapabilityManifest.nodeSpecs),
              }
            : undefined;
          const runtimeTrace: AgentsChatRuntimeTrace = {
            harness:
              runtimeMeta.runtimeHarness === "canvas"
                ? "canvas"
                : "unknown",
            registeredToolNames,
            requiredSkills,
            loadedSkills,
            allowedSubagentTypes,
            ...(runtimeMeta.systemSnapshot &&
            typeof runtimeMeta.systemSnapshot === "object" &&
            !Array.isArray(runtimeMeta.systemSnapshot)
              ? {
                  systemSnapshot: runtimeMeta.systemSnapshot as AgentsChatRuntimeTrace["systemSnapshot"],
                }
              : {}),
            ...(Array.isArray(runtimeMeta.toolBatchSummaries)
              ? {
                  toolBatchSummaries: runtimeMeta.toolBatchSummaries as NonNullable<
                    AgentsChatRuntimeTrace["toolBatchSummaries"]
                  >,
                }
              : {}),
            ...(Array.isArray(runtimeMeta.compactionEvents)
              ? {
                  compactionEvents: runtimeMeta.compactionEvents as NonNullable<
                    AgentsChatRuntimeTrace["compactionEvents"]
                  >,
                }
              : {}),
            ...(runtimeMeta.contextDiagnostics &&
            typeof runtimeMeta.contextDiagnostics === "object" &&
            !Array.isArray(runtimeMeta.contextDiagnostics)
              ? { contextDiagnostics: runtimeMeta.contextDiagnostics as ContextDiagnostics }
              : {}),
            ...(runtimeMeta.capabilitySnapshot &&
            typeof runtimeMeta.capabilitySnapshot === "object" &&
            !Array.isArray(runtimeMeta.capabilitySnapshot)
              ? { capabilitySnapshot: runtimeMeta.capabilitySnapshot as CapabilitySnapshot }
              : {}),
            ...(runtimeMeta.policySummary &&
            typeof runtimeMeta.policySummary === "object" &&
            !Array.isArray(runtimeMeta.policySummary)
              ? { policySummary: runtimeMeta.policySummary as ToolPolicySummary }
              : {}),
            ...(traceCanvasCapabilities ? { canvasCapabilities: traceCanvasCapabilities } : {}),
          };
          const finalPlanningTrace = planningTrace;
          const finalCompletionTrace =
            completionTrace ??
            buildCompletionTrace({
              responseText,
              toolCalls,
              planningTrace: finalPlanningTrace,
              runtimeCompletionTrace: runtimeMeta.completionTrace,
            });
          const responseId = `agents_${randomUUID()}`;
          const resp: AgentsChatResponse = {
            id: responseId,
            text: responseText,
            trace: {
              toolCalls,
              turns,
              output: {
                textChars: responseText.length,
                preview: outputPreview.preview,
                head: outputEdges.head,
                tail: outputEdges.tail,
              },
              summary: {
                totalToolCalls: toolCalls.length,
                ...toolStatusCounts,
                runMs: Math.max(0, Date.now() - startedAt),
              },
              completion: finalCompletionTrace,
              runtime: runtimeTrace,
              ...(finalPlanningTrace ? { planning: finalPlanningTrace } : {}),
              ...(latestTodoListTrace ? { todoList: latestTodoListTrace } : {}),
              ...(todoEvents.length > 0 ? { todoEvents } : {}),
            },
          };
          console.log(
            `[agents] /chat request finished status=200 user=${userId} elapsedMs=${Date.now() - startedAt} textChars=${resp.text.length} outputPreview=${truncateForLog(resp.text)}`
          );
          if (wantsStream) {
            ensureAssistantItemStarted();
            emitStreamEvent({
              event: "item.completed",
              data: {
                threadId,
                turnId,
                itemId: assistantItemId,
                itemType: "message",
                role: "assistant",
                text: responseText,
                textChars: responseText.length,
              },
            });
            emitStreamEvent({
              event: "item.started",
              data: {
                threadId,
                turnId,
                itemId: resultItemId,
                itemType: "result",
              },
            });
            emitStreamEvent({
              event: "item.completed",
              data: {
                threadId,
                turnId,
                itemId: resultItemId,
                itemType: "result",
                text: responseText,
                textChars: responseText.length,
              },
            });
            emitStreamEvent({ event: "result", data: { response: resp } });
            emitStreamEvent({
              event: "turn.completed",
              data: {
                threadId,
                turnId,
                responseId,
                textChars: responseText.length,
                toolCallCount: toolCalls.length,
              },
            });
            emitStreamEvent({ event: "done", data: { reason: "finished" } });
            await sseWriteQueue.catch(() => {});
            if (!sseClosed) res.end();
            return;
          }
          return json(res, 200, resp);
        } finally {
          responseAbort.cleanup();
          if (canvasSubscription) {
            void canvasSubscription.unsubscribe();
          }
        }
        } finally {
          releaseSessionLock?.();
        }
      }

      return notFound(res);
    } catch (err: unknown) {
      if (requestClosedEarly) {
        return;
      }
      const message = errorMessage(err);
      const code = errorCode(err);
      const details = errorDetails(err);
      const isBodyTooLarge = message.includes("请求体过大");
      const status = isBodyTooLarge ? 413 : 500;
      const stack = err instanceof Error && typeof err.stack === "string" ? err.stack : "";
      console.error(`[agents] request failed status=${status} message=${message}${stack ? ` stack=${truncateForLog(stack, 2000)}` : ""}`);
      if (!res.headersSent) {
        return json(res, status, {
          error: "internal_error",
          message,
          ...(code ? { code } : {}),
          ...(typeof details !== "undefined" ? { details } : {}),
        });
      }
      if (res.writableEnded || res.destroyed) {
        return;
      }
      try {
        await writeSse(res, {
          event: "error",
          data: {
            message,
            ...(code ? { code } : {}),
            ...(typeof details !== "undefined" ? { details } : {}),
          },
        });
        await writeSse(res, { event: "done", data: { reason: "error" } });
      } catch {
        // ignore secondary stream failures
      }
      res.end();
      return;
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => reject(err));
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort =
        addr && typeof addr === "object" ? (addr as AddressInfo).port : port;
      const url = `http://${host}:${actualPort}`;
      resolve({
        url,
        close: () =>
          new Promise((r) => {
            server.close(async () => {
              if (redisClient && redisClient.isOpen) {
                try {
                  await redisClient.quit();
                } catch {
                  // ignore close failures
                }
              }
              r();
            });
          }),
      });
    });
  });
}
