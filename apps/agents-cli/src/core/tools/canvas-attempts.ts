import type { ToolDefinition } from "../../types/index.js";
import type {
  ToolRuntimeState,
  GenerationAttemptKind,
  GenerationAttemptRecord,
  GenerationAttemptStatus,
} from "./registry.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNestedString(source: unknown, path: string[]): string | undefined {
  let current: unknown = source;
  for (const key of path) {
    if (!isPlainObject(current)) return undefined;
    current = current[key];
  }
  return typeof current === "string" && current.length > 0 ? current : undefined;
}

export function getCanvasLayoutSlotKey(
  toolName: string,
  args: Record<string, unknown>,
): string | undefined {
  const family = toolName.trim();
  if (!family) return undefined;
  const candidates = [
    args.nodeId,
    args.targetNodeId,
    args.outputKey,
    isPlainObject(args.node) ? args.node.id : undefined,
  ];
  const targetId = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof targetId === "string" ? `${family}:${targetId.trim()}` : undefined;
}

function extractStructuredOutput(payload: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(payload)) return undefined;
  const structured = payload.structuredOutput;
  return isPlainObject(structured) ? structured : undefined;
}

function extractStructuredData(payload: unknown): Record<string, unknown> | undefined {
  const structured = extractStructuredOutput(payload);
  const data = structured?.data;
  return isPlainObject(data) ? data : undefined;
}

function extractStructuredDetails(payload: unknown): Record<string, unknown> | undefined {
  const structured = extractStructuredOutput(payload);
  const details = structured?.details;
  return isPlainObject(details) ? details : undefined;
}

function readTaskIdFrom(source: Record<string, unknown> | undefined): string | undefined {
  if (!source) return undefined;
  return readString(source, "taskId") || readString(source, "imageTaskId") || readString(source, "videoTaskId");
}

function readMediaUrlFrom(kind: GenerationAttemptKind, source: Record<string, unknown> | undefined): string | null {
  if (!source) return null;
  return readString(source, kind === "image" ? "imageUrl" : "videoUrl") || null;
}

function readNodeId(input: {
  data?: Record<string, unknown>;
  details?: Record<string, unknown>;
  args: Record<string, unknown>;
}): string {
  return (
    (input.data && readString(input.data, "nodeId")) ||
    (input.details && readString(input.details, "nodeId")) ||
    readString(input.args, "nodeId") ||
    readString(input.args, "targetNodeId") ||
    readString(input.args, "outputKey") ||
    readNestedString(input.args, ["node", "id"]) ||
    "unknown"
  );
}

function readModel(input: { data?: Record<string, unknown>; args: Record<string, unknown> }): string {
  return (
    readString(input.args, "model") ||
    readNestedString(input.args, ["node", "data", "model"]) ||
    readNestedString(input.args, ["node", "data", "imageModel"]) ||
    readNestedString(input.args, ["node", "data", "videoModel"]) ||
    (input.data && (readString(input.data, "model") || readString(input.data, "imageModel") || readString(input.data, "videoModel"))) ||
    ""
  );
}

function readPrompt(input: { data?: Record<string, unknown>; args: Record<string, unknown> }): string {
  return (
    readString(input.args, "prompt") ||
    readNestedString(input.args, ["node", "data", "prompt"]) ||
    (input.data && readString(input.data, "prompt")) ||
    ""
  );
}

export function isCanvasGenerationToolDefinition(definition: ToolDefinition | undefined): boolean {
  return definition?.effects?.generatesMedia === true;
}

export function canvasGenerationToolKind(
  definition: ToolDefinition | undefined
): GenerationAttemptKind | undefined {
  if (definition?.effects?.generatesMedia !== true) return undefined;
  return definition.effects.mediaKind;
}

type RecordOpts =
  | { status: "ok"; resultPayload: unknown; args: Record<string, unknown> }
  | { status: "failed"; error: string; resultPayload?: unknown; args: Record<string, unknown> };

type WaitRecordOpts =
  | { status: "completed"; resultPayload: unknown; args: Record<string, unknown> }
  | {
      status: "failed" | "timed_out";
      error: string;
      resultPayload?: unknown;
      args: Record<string, unknown>;
    };

export function recordCanvasGenerationAttempt(
  state: ToolRuntimeState | undefined,
  kind: GenerationAttemptKind | undefined,
  opts: RecordOpts
): void {
  if (!state) return;
  if (!kind) return;
  if (!Array.isArray(state.attempts)) return;

  const args = isPlainObject(opts.args) ? opts.args : {};
  const data = extractStructuredData(opts.resultPayload);
  const details = extractStructuredDetails(opts.resultPayload);

  const nodeId = readNodeId({ data, details, args });
  const model = readModel({ data, args });
  const prompt = readPrompt({ data, args });
  const taskId = readTaskIdFrom(data) || readTaskIdFrom(details) || readString(args, "taskId");

  const url = opts.status === "ok" ? readMediaUrlFrom(kind, data) : null;
  const status: GenerationAttemptStatus = opts.status === "failed" ? "failed" : url ? "completed" : "submitted";

  const attemptNumber =
    state.attempts.reduce((n, entry) => (entry.nodeId === nodeId ? n + 1 : n), 0) + 1;

  const record: GenerationAttemptRecord = {
    nodeId,
    attempt: attemptNumber,
    kind,
    model,
    prompt,
    ...(taskId ? { taskId } : {}),
    url,
    status,
    ts: new Date().toISOString(),
    ...(opts.status === "failed" ? { error: opts.error } : {}),
  };
  state.attempts.push(record);
}

export function recordCanvasGenerationWaitResult(
  state: ToolRuntimeState | undefined,
  kind: GenerationAttemptKind | undefined,
  opts: WaitRecordOpts
): void {
  if (!state) return;
  if (!kind) return;
  if (!Array.isArray(state.attempts)) return;

  const args = isPlainObject(opts.args) ? opts.args : {};
  const data = extractStructuredData(opts.resultPayload);
  const details = extractStructuredDetails(opts.resultPayload);
  const nodeId = readNodeId({ data, details, args });
  if (!nodeId || nodeId === "unknown") return;
  const taskId = readTaskIdFrom(data) || readTaskIdFrom(details) || readString(args, "taskId");

  for (let i = state.attempts.length - 1; i >= 0; i -= 1) {
    const entry = state.attempts[i]!;
    if (entry.kind !== kind) continue;
    if (entry.nodeId !== nodeId) continue;
    if (taskId && entry.taskId && entry.taskId !== taskId) continue;

    const url = opts.status === "completed" ? readMediaUrlFrom(kind, data) : null;
    if (opts.status === "completed") {
      const { error: _error, ...entryWithoutError } = entry;
      state.attempts[i] = {
        ...entryWithoutError,
        ...(taskId ? { taskId } : {}),
        ...(url ? { url } : {}),
        status: url ? "completed" : "submitted",
        ts: new Date().toISOString(),
      };
    } else {
      state.attempts[i] = {
        ...entry,
        ...(taskId ? { taskId } : {}),
        status: opts.status,
        ts: new Date().toISOString(),
        error: opts.error,
      };
    }
    return;
  }
}
