import { createRequire } from "node:module";

import type { RemoteToolDefinition, ToolResult } from "../../types/index.js";

export type RemoteToolConfig = {
  endpoint: string;
  authToken?: string;
  apiKey?: string;
  projectId?: string;
  flowId?: string;
  nodeId?: string;
  publicChatRunId?: string;
  sessionKey?: string;
  timeoutMs?: number;
};

type ExternalToolConfig = RemoteToolConfig;

const requireNodeModule = createRequire(import.meta.url);
const nodeFetchDispatcherCache = new Map<number, unknown>();
const NODE_DEFAULT_HEADERS_TIMEOUT_MS = 300_000;
const MAX_REMOTE_TOOL_TIMEOUT_MS = 7_200_000;

export class RemoteToolExecutionError extends Error {
  readonly status: number;
  readonly structuredOutput?: Record<string, unknown>;

  constructor(message: string, input: { status: number; structuredOutput?: Record<string, unknown> }) {
    super(message);
    this.name = "RemoteToolExecutionError";
    this.status = input.status;
    if (input.structuredOutput) this.structuredOutput = input.structuredOutput;
  }
}

export function normalizeRemoteToolDefinitions(value: unknown): RemoteToolDefinition[] {
  if (!Array.isArray(value)) return [];
  const out: RemoteToolDefinition[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const description =
      typeof record.description === "string" ? record.description.trim() : "";
    const parameters =
      record.parameters && typeof record.parameters === "object" && !Array.isArray(record.parameters)
        ? (record.parameters as Record<string, unknown>)
        : null;
    if (!name || !description || !parameters || seen.has(name)) continue;
    seen.add(name);
    const outputSchema =
      record.outputSchema && typeof record.outputSchema === "object" && !Array.isArray(record.outputSchema)
        ? record.outputSchema as Record<string, unknown>
        : undefined;
    const provider =
      record.provider && typeof record.provider === "object" && !Array.isArray(record.provider)
        ? record.provider as { id?: unknown; kind?: unknown }
        : null;
    const providerKind =
      provider?.kind === "local" || provider?.kind === "remote" || provider?.kind === "mcp" || provider?.kind === "skill"
        ? provider.kind
        : undefined;
    const effects =
      record.effects && typeof record.effects === "object" && !Array.isArray(record.effects)
        ? record.effects as { readOnly?: unknown }
        : null;
    const permission =
      record.permission && typeof record.permission === "object" && !Array.isArray(record.permission)
        ? record.permission as { defaultMode?: unknown }
        : null;
    out.push({
      name,
      description,
      parameters,
      ...(outputSchema ? { outputSchema } : {}),
      ...(provider && typeof provider.id === "string" && provider.id.trim() && providerKind
        ? { provider: { id: provider.id.trim(), kind: providerKind } }
        : {}),
      ...(typeof record.scope === "string" &&
      (record.scope === "workspace" || record.scope === "project" || record.scope === "flow" || record.scope === "node")
        ? { scope: record.scope }
        : {}),
      ...(effects && typeof effects.readOnly === "boolean" ? { effects: record.effects as RemoteToolDefinition["effects"] } : {}),
      ...(permission &&
      (permission.defaultMode === "allow" || permission.defaultMode === "ask" || permission.defaultMode === "deny")
        ? { permission: record.permission as RemoteToolDefinition["permission"] }
        : {}),
    });
  }
  return out;
}

export function readRemoteToolDefinitions(meta?: Record<string, unknown>): RemoteToolDefinition[] {
  return normalizeRemoteToolDefinitions(meta?.remoteTools);
}

export function readMcpToolDefinitions(meta?: Record<string, unknown>): RemoteToolDefinition[] {
  return normalizeRemoteToolDefinitions(meta?.mcpTools);
}

export function readRemoteToolConfig(meta?: Record<string, unknown>): RemoteToolConfig | null {
  return readToolConfig(meta?.remoteToolConfig);
}

export function readMcpToolConfig(meta?: Record<string, unknown>): RemoteToolConfig | null {
  return readToolConfig(meta?.mcpToolConfig);
}

function readToolConfig(value: unknown): ExternalToolConfig | null {
  const raw = value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const endpoint = typeof record.endpoint === "string" ? record.endpoint.trim() : "";
  if (!endpoint) return null;
  const authToken =
    typeof record.authToken === "string" && record.authToken.trim()
      ? record.authToken.trim()
      : undefined;
  const apiKey =
    typeof record.apiKey === "string" && record.apiKey.trim()
      ? record.apiKey.trim()
      : undefined;
  const projectId =
    typeof record.projectId === "string" && record.projectId.trim()
      ? record.projectId.trim()
      : undefined;
  const flowId =
    typeof record.flowId === "string" && record.flowId.trim()
      ? record.flowId.trim()
      : undefined;
  const nodeId =
    typeof record.nodeId === "string" && record.nodeId.trim()
      ? record.nodeId.trim()
      : undefined;
  const publicChatRunId =
    typeof record.publicChatRunId === "string" && record.publicChatRunId.trim()
      ? record.publicChatRunId.trim()
      : undefined;
  const sessionKey =
    typeof record.sessionKey === "string" && record.sessionKey.trim()
      ? record.sessionKey.trim()
      : undefined;
  const timeoutMs = normalizeTimeoutMs(record.timeoutMs);
  return {
    endpoint,
    ...(authToken ? { authToken } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(projectId ? { projectId } : {}),
    ...(flowId ? { flowId } : {}),
    ...(nodeId ? { nodeId } : {}),
    ...(publicChatRunId ? { publicChatRunId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readRunId(meta: Record<string, unknown> | undefined): string | undefined {
  const runEnvelope = isRecord(meta?.runEnvelope) ? meta.runEnvelope : null;
  const runId = typeof runEnvelope?.runId === "string" ? runEnvelope.runId.trim() : "";
  return runId || undefined;
}

type HarnessExecutionOrigin = {
  agentId: string;
  parentToolCallId?: string;
  llmTurnIndex: number;
  executionBatchIndex: number;
  executionBatchCallIndex: number;
  executionBatchCallCount: number;
  toolCallIndex: number;
  schemaVersion?: 2;
  invocationPath?: HarnessInvocationSegment[];
  layoutStagePath?: number[];
  layoutItemPath?: HarnessLayoutItemSegment[];
};

type HarnessInvocationSegment = {
  agentId: string;
  layoutStageIndex: number;
  executionBatchCallIndex: number;
  executionBatchCallCount: number;
  toolCallIndex: number;
  toolCallId: string;
};

type HarnessLayoutItemSegment = { index: number; count: number };

function readHarnessInvocationSegment(value: unknown): HarnessInvocationSegment | null {
  if (!isRecord(value)) return null;
  const agentId = typeof value.agentId === "string" ? value.agentId.trim() : "";
  const toolCallId = typeof value.toolCallId === "string" ? value.toolCallId.trim() : "";
  const indices = [
    value.layoutStageIndex,
    value.executionBatchCallIndex,
    value.executionBatchCallCount,
    value.toolCallIndex,
  ];
  if (!agentId || !toolCallId || !indices.every((item) => Number.isSafeInteger(item) && Number(item) >= 0)) {
    return null;
  }
  const executionBatchCallIndex = Number(value.executionBatchCallIndex);
  const executionBatchCallCount = Number(value.executionBatchCallCount);
  if (executionBatchCallCount === 0 || executionBatchCallIndex >= executionBatchCallCount) return null;
  return {
    agentId,
    layoutStageIndex: Number(value.layoutStageIndex),
    executionBatchCallIndex,
    executionBatchCallCount,
    toolCallIndex: Number(value.toolCallIndex),
    toolCallId,
  };
}

function readHarnessLayoutItemSegment(value: unknown): HarnessLayoutItemSegment | null {
  if (!isRecord(value)) return null;
  if (!Number.isSafeInteger(value.index) || !Number.isSafeInteger(value.count)) return null;
  const index = Number(value.index);
  const count = Number(value.count);
  if (index < 0 || count <= 0 || index >= count) return null;
  return { index, count };
}

function readHarnessExecutionOrigin(meta: Record<string, unknown> | undefined): HarnessExecutionOrigin | null {
  const value = isRecord(meta?.harnessExecutionOrigin) ? meta.harnessExecutionOrigin : null;
  if (!value) return null;
  const agentId = typeof value.agentId === "string" ? value.agentId.trim() : "";
  const parentToolCallId = typeof value.parentToolCallId === "string" ? value.parentToolCallId.trim() : "";
  const indices = [
    value.llmTurnIndex,
    value.executionBatchIndex,
    value.executionBatchCallIndex,
    value.executionBatchCallCount,
    value.toolCallIndex,
  ];
  if (!agentId || !indices.every((item) => Number.isSafeInteger(item) && Number(item) >= 0)) return null;
  const executionBatchCallCount = Number(value.executionBatchCallCount);
  const executionBatchCallIndex = Number(value.executionBatchCallIndex);
  if (executionBatchCallCount === 0 || executionBatchCallIndex >= executionBatchCallCount) return null;
  const base: HarnessExecutionOrigin = {
    agentId,
    ...(parentToolCallId ? { parentToolCallId } : {}),
    llmTurnIndex: Number(value.llmTurnIndex),
    executionBatchIndex: Number(value.executionBatchIndex),
    executionBatchCallIndex,
    executionBatchCallCount,
    toolCallIndex: Number(value.toolCallIndex),
  };
  if (
    value.schemaVersion !== 2
    || !Array.isArray(value.invocationPath)
    || !Array.isArray(value.layoutStagePath)
    || !Array.isArray(value.layoutItemPath)
    || value.invocationPath.length === 0
    || value.invocationPath.length > 8
    || value.layoutStagePath.length !== value.invocationPath.length
    || value.layoutItemPath.length !== value.invocationPath.length
  ) {
    return base;
  }
  const invocationPath = value.invocationPath.map(readHarnessInvocationSegment);
  const layoutItemPath = value.layoutItemPath.map(readHarnessLayoutItemSegment);
  if (
    invocationPath.some((segment) => segment == null)
    || layoutItemPath.some((segment) => segment == null)
    || !value.layoutStagePath.every((item) => Number.isSafeInteger(item) && Number(item) >= 0)
  ) {
    return base;
  }
  return {
    ...base,
    schemaVersion: 2,
    invocationPath: invocationPath as HarnessInvocationSegment[],
    layoutStagePath: value.layoutStagePath.map(Number),
    layoutItemPath: layoutItemPath as HarnessLayoutItemSegment[],
  };
}

function requiresRemoteIdempotency(definition: RemoteToolDefinition): boolean {
  const effects = definition.effects;
  return Boolean(effects?.mutatesCanvas || effects?.costBearing || effects?.longRunning);
}

function buildRemoteIdempotencyKey(input: {
  name: string;
  toolCallId: string;
  meta?: Record<string, unknown>;
}): string {
  const toolCallId = input.toolCallId.trim();
  if (!toolCallId) {
    throw new Error(`远程工具 ${input.name} 缺少 toolCallId，无法生成幂等键。`);
  }
  const runId = readRunId(input.meta);
  return runId
    ? `agents:${runId}:${toolCallId}:${input.name}`
    : `agents:${toolCallId}:${input.name}`;
}

function normalizeTimeoutMs(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.max(5_000, Math.min(MAX_REMOTE_TOOL_TIMEOUT_MS, Math.trunc(parsed)));
}

function shouldRequireCustomDispatcher(timeoutMs: number | undefined): boolean {
  return typeof timeoutMs === "number" && timeoutMs > NODE_DEFAULT_HEADERS_TIMEOUT_MS;
}

function createDispatcherConfigurationError(reason: string, cause?: unknown): Error {
  const causeMessage = cause instanceof Error && cause.message.trim() ? ` cause=${cause.message.trim()}` : "";
  return new Error(
    `远程工具长连接需要 undici dispatcher，但 dispatcher 创建失败：${reason}.${causeMessage}`,
  );
}

async function createNodeFetchDispatcher(timeoutMs: number | undefined): Promise<unknown | null> {
  if (typeof process === "undefined" || !timeoutMs) return null;
  const effectiveTimeoutMs = Math.max(5_000, Math.floor(timeoutMs));
  if (nodeFetchDispatcherCache.has(effectiveTimeoutMs)) {
    return nodeFetchDispatcherCache.get(effectiveTimeoutMs) ?? null;
  }
  try {
    const undiciModule = requireNodeModule("undici") as unknown;
    if (!undiciModule || typeof undiciModule !== "object") {
      if (shouldRequireCustomDispatcher(timeoutMs)) {
        throw createDispatcherConfigurationError("undici module is not an object");
      }
      return null;
    }
    const agentCtor = Reflect.get(undiciModule, "Agent");
    if (typeof agentCtor !== "function") {
      if (shouldRequireCustomDispatcher(timeoutMs)) {
        throw createDispatcherConfigurationError("undici Agent constructor is unavailable");
      }
      return null;
    }
    const AgentCtor = agentCtor as new (options: {
      headersTimeout: number;
      bodyTimeout: number;
      connect?: { timeout: number };
    }) => unknown;
    const dispatcher = new AgentCtor({
      headersTimeout: effectiveTimeoutMs + 15_000,
      bodyTimeout: effectiveTimeoutMs + 15_000,
      connect: {
        timeout: effectiveTimeoutMs + 15_000,
      },
    });
    nodeFetchDispatcherCache.set(effectiveTimeoutMs, dispatcher);
    return dispatcher;
  } catch (error) {
    if (error instanceof Error && error.message.includes("远程工具长连接需要 undici dispatcher")) {
      throw error;
    }
    if (shouldRequireCustomDispatcher(timeoutMs)) {
      throw createDispatcherConfigurationError("unable to load undici", error);
    }
    return null;
  }
}

function buildAbortSignal(timeoutMs: number | undefined): { signal?: AbortSignal; cleanup: () => void } {
  if (!timeoutMs) {
    return {
      cleanup() {
        return;
      },
    };
  }
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutHandle);
    },
  };
}

function readErrorName(error: unknown): string {
  return error instanceof Error && error.name.trim() ? error.name.trim() : "UnknownError";
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error || "unknown error");
}

function readErrorCause(error: unknown): string {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : null;
  if (!cause) return "n/a";
  if (cause instanceof Error) {
    const name = cause.name.trim() || "Error";
    const message = cause.message.trim();
    return message ? `${name}: ${message}` : name;
  }
  if (typeof cause === "object" && !Array.isArray(cause)) {
    const record = cause as Record<string, unknown>;
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : "UnknownCause";
    const message =
      typeof record.message === "string" && record.message.trim() ? record.message.trim() : "";
    const code = typeof record.code === "string" && record.code.trim() ? record.code.trim() : "";
    return [name, code, message].filter(Boolean).join(": ");
  }
  return String(cause);
}

function buildRemoteFetchFailureMessage(input: {
  toolName: string;
  endpoint: string;
  timeoutMs: number | undefined;
  elapsedMs: number;
  error: unknown;
}): string {
  const timeout = typeof input.timeoutMs === "number" ? String(input.timeoutMs) : "unset";
  return [
    `远程工具 ${input.toolName} fetch failed`,
    `endpoint=${input.endpoint}`,
    `timeoutMs=${timeout}`,
    `elapsedMs=${input.elapsedMs}`,
    `errorName=${readErrorName(input.error)}`,
    `errorMessage=${readErrorMessage(input.error)}`,
    `cause=${readErrorCause(input.error)}`,
  ].join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

type SchemaIssue = {
  path: string[];
  message: string;
};

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readProperties(schema: Record<string, unknown>): Record<string, unknown> {
  return isRecord(schema.properties) ? schema.properties : {};
}

function schemaPath(path: string[]): string {
  return path.length > 0 ? path.join(".") : "args";
}

function describeSchemaValue(schema: unknown): string {
  if (!isRecord(schema)) return "";
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return `one of ${schema.enum.map((item) => String(item)).join(" | ")}`;
  }
  return typeof schema.type === "string" ? schema.type : "";
}

function valueMatchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return true;
  }
}

function validateJsonSchemaValue(value: unknown, schema: unknown, path: string[] = []): SchemaIssue[] {
  if (!isRecord(schema)) return [];
  const issues: SchemaIssue[] = [];

  // JSON Schema `not`: the value must NOT match the given sub-schema. An empty
  // sub-schema ({}) matches everything, so a present value always violates it —
  // this is how the server marks a field as forbidden at this location (e.g. a
  // WebHero workflow field that must be nested under webPageWorkflowContract).
  if (Object.prototype.hasOwnProperty.call(schema, "not")) {
    const matchesNot = validateJsonSchemaValue(value, schema.not, path).length === 0;
    if (matchesNot) {
      const described = typeof schema.description === "string" && schema.description.trim()
        ? schema.description.trim()
        : `${schemaPath(path)} is not allowed here`;
      issues.push({ path, message: described });
      return issues;
    }
  }

  const type = typeof schema.type === "string" ? schema.type : "";
  const behavesLikeObject = type === "object" || isRecord(schema.properties) || Array.isArray(schema.required);

  if (type && !valueMatchesType(value, type)) {
    issues.push({
      path,
      message: `expected ${schemaPath(path)} to be ${type}`,
    });
    return issues;
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    issues.push({
      path,
      message: `expected ${schemaPath(path)} to be one of ${schema.enum.map((item) => String(item)).join(" | ")}`,
    });
  }

  if (behavesLikeObject) {
    if (!isRecord(value)) {
      issues.push({
        path,
        message: `expected ${schemaPath(path)} to be object`,
      });
      return issues;
    }
    const properties = readProperties(schema);
    for (const key of readStringArray(schema.required)) {
      if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined) continue;
      const expected = describeSchemaValue(properties[key]);
      issues.push({
        path: [...path, key],
        message: expected
          ? `missing required field ${schemaPath([...path, key])} (${expected})`
          : `missing required field ${schemaPath([...path, key])}`,
      });
    }
    for (const [key, childValue] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        issues.push(...validateJsonSchemaValue(childValue, properties[key], [...path, key]));
      } else if (schema.additionalProperties === false) {
        issues.push({
          path: [...path, key],
          message: `unexpected field ${schemaPath([...path, key])}`,
        });
      }
    }
  }

  if (type === "array" && Array.isArray(value)) {
    const minItems = typeof schema.minItems === "number" ? schema.minItems : undefined;
    const maxItems = typeof schema.maxItems === "number" ? schema.maxItems : undefined;
    if (typeof minItems === "number" && value.length < minItems) {
      issues.push({ path, message: `expected ${schemaPath(path)} to contain at least ${minItems} item(s)` });
    }
    if (typeof maxItems === "number" && value.length > maxItems) {
      issues.push({ path, message: `expected ${schemaPath(path)} to contain at most ${maxItems} item(s)` });
    }
    if (schema.items) {
      value.forEach((item, index) => {
        issues.push(...validateJsonSchemaValue(item, schema.items, [...path, String(index)]));
      });
    }
  }

  if (type === "string" && typeof value === "string") {
    const minLength = typeof schema.minLength === "number" ? schema.minLength : undefined;
    const maxLength = typeof schema.maxLength === "number" ? schema.maxLength : undefined;
    if (typeof minLength === "number" && value.length < minLength) {
      issues.push({ path, message: `expected ${schemaPath(path)} to contain at least ${minLength} character(s)` });
    }
    if (typeof maxLength === "number" && value.length > maxLength) {
      issues.push({ path, message: `expected ${schemaPath(path)} to contain at most ${maxLength} character(s)` });
    }
  }

  return issues;
}

function validateToolArgs(toolName: string, args: Record<string, unknown>, parameters: Record<string, unknown>): ToolResult | null {
  const issues = validateJsonSchemaValue(args, parameters);
  if (issues.length === 0) return null;
  const errorMessage = `工具参数不符合 ${toolName} 的 runtime schema：${issues.map((issue) => issue.message).join("; ")}`;
  return {
    toolCallId: "",
    content: `${errorMessage}。请重新调用该工具并按 schema 补齐/修正参数。`,
    isError: true,
    errorMessage,
    payload: {
      text: errorMessage,
      structuredOutput: {
        ok: false,
        code: "invalid_tool_args",
        toolName,
        issues,
      },
    },
  };
}

export async function executeRemoteTool(input: {
  name: string;
  args: Record<string, unknown>;
  toolCallId: string;
  providerKind?: "remote" | "mcp";
  meta?: Record<string, unknown>;
}): Promise<ToolResult | null> {
  const remoteTools = readRemoteToolDefinitions(input.meta);
  const mcpTools = readMcpToolDefinitions(input.meta);
  const remoteDefinition = remoteTools.find((tool) => tool.name === input.name) ?? null;
  const mcpDefinition = mcpTools.find((tool) => tool.name === input.name) ?? null;
  const isRemote = input.providerKind ? input.providerKind === "remote" && Boolean(remoteDefinition) : Boolean(remoteDefinition);
  const isMcp = input.providerKind ? input.providerKind === "mcp" && Boolean(mcpDefinition) : !isRemote && Boolean(mcpDefinition);
  if (!isRemote && !isMcp) return null;
  const definition = isRemote ? remoteDefinition : mcpDefinition;
  if (!definition?.effects) {
    throw new Error(`${isRemote ? "远程" : "MCP"} 工具 ${input.name} 缺少 effects 元数据。`);
  }
  const argsError = validateToolArgs(input.name, input.args, definition.parameters);
  if (argsError) {
    return {
      ...argsError,
      toolCallId: input.toolCallId,
    };
  }
  const config = isRemote ? readRemoteToolConfig(input.meta) : readMcpToolConfig(input.meta);
  if (!config) {
    throw new Error(`${isRemote ? "远程" : "MCP"} 工具 ${input.name} 缺少执行配置。`);
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.authToken) {
    headers.Authorization = config.authToken.startsWith("Bearer ")
      ? config.authToken
      : `Bearer ${config.authToken}`;
  }
  if (config.apiKey) {
    headers["x-api-key"] = config.apiKey;
  }
  const dispatcher = await createNodeFetchDispatcher(config.timeoutMs);
  const abortSignal = buildAbortSignal(config.timeoutMs);
  const idempotencyKey = definition && requiresRemoteIdempotency(definition)
    ? buildRemoteIdempotencyKey({
        name: input.name,
        toolCallId: input.toolCallId,
        meta: input.meta,
      })
    : undefined;
  const harnessExecutionOrigin = readHarnessExecutionOrigin(input.meta);
  const requestInit: RequestInit & { dispatcher?: unknown } = {
    method: "POST",
    headers,
    body: JSON.stringify({
      toolName: input.name,
      providerKind: isRemote ? "remote" : "mcp",
      args: input.args,
      context: {
        ...(config.projectId ? { projectId: config.projectId } : {}),
        ...(config.flowId ? { flowId: config.flowId } : {}),
        ...(config.nodeId ? { nodeId: config.nodeId } : {}),
      },
      run: {
        toolCallId: input.toolCallId,
        ...(readRunId(input.meta) ? { runId: readRunId(input.meta) } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(config.publicChatRunId ? { publicChatRunId: config.publicChatRunId } : {}),
        ...(config.sessionKey ? { sessionKey: config.sessionKey } : {}),
        ...(harnessExecutionOrigin ?? {}),
      },
    }),
    ...(abortSignal.signal ? { signal: abortSignal.signal } : {}),
  };
  if (dispatcher) requestInit.dispatcher = dispatcher;
  let response: Response;
  const startedAt = Date.now();
  try {
    response = await fetch(config.endpoint, requestInit);
  } catch (error) {
    throw new Error(buildRemoteFetchFailureMessage({
      toolName: input.name,
      endpoint: config.endpoint,
      timeoutMs: config.timeoutMs,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      error,
    }));
  } finally {
    abortSignal.cleanup();
  }
  const text = await response.text();
  const payload = parseJsonObject(text);
  if (!response.ok) {
    const content =
      typeof payload?.content === "string" && payload.content.trim()
        ? payload.content.trim()
        : text.trim();
    throw new RemoteToolExecutionError(
      `远程工具 ${input.name} 执行失败: ${response.status} ${content}`,
      {
        status: response.status,
        ...(payload ? { structuredOutput: payload } : {}),
      },
    );
  }
  const content =
    typeof payload?.content === "string" && payload.content.trim()
      ? payload.content
      : text;
  if (!payload) {
    throw new Error(`${isRemote ? "远程" : "MCP"} 工具 ${input.name} 返回不是有效 JSON envelope。`);
  }
  const effects = payload.effects;
  if (!effects || typeof effects !== "object" || Array.isArray(effects)) {
    throw new Error(`${isRemote ? "远程" : "MCP"} 工具 ${input.name} 返回缺少 effects。`);
  }
  return {
    toolCallId: input.toolCallId,
    content,
    ...(payload ? { payload: { text: content, structuredOutput: payload } } : {}),
  };
}
