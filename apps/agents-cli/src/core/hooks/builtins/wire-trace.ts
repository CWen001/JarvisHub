import path from "node:path";

import type { AgentsHook, AfterRunHookPayload, BeforeRunHookPayload, RunErrorHookPayload, ToolCallHookPayload } from "../types.js";
import { traceContext } from "../../../runtime/trace-context.js";
import type { TraceRunContext } from "../../../runtime/trace-context.js";
import type { TraceEvent, TraceEventPayload, TracePayloadRef } from "../../../runtime/trace-events.js";
import { createTraceBundleStore, type TraceBundleStore } from "../../../runtime/trace-bundle-store.js";

let bundleStore: TraceBundleStore | null = null;

function emit(type: TraceEvent["type"], payload: TraceEventPayload): void {
  if (!bundleStore) return;
  const ctx = traceContext.current();
  if (!ctx) return;
  emitForContext(ctx, type, payload);
}

function emitForContext(ctx: TraceRunContext, type: TraceEvent["type"], payload: TraceEventPayload): void {
  if (!bundleStore) return;
  const event: TraceEvent = {
    ts: new Date().toISOString(),
    runId: ctx.runId,
    sessionId: ctx.sessionId,
    parentRunId: ctx.parentRunId,
    depth: ctx.depth,
    seq: ctx.seq++,
    type,
    payload,
  };
  try {
    bundleStore.appendEvent(ctx, event);
    if (ctx.runId === ctx.rootRunId && type === "run.finished") {
      bundleStore.closeRoot(ctx.rootRunId, "finished", event.ts);
    } else if (ctx.runId === ctx.rootRunId && type === "run.errored") {
      bundleStore.closeRoot(ctx.rootRunId, "errored", event.ts);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[wire-trace] write failed rootRunId=${ctx.rootRunId}: ${msg}`);
  }
}

export function emitTraceEvent(type: TraceEvent["type"], payload: TraceEventPayload): void {
  emit(type, payload);
}

export function emitTraceEventForContext(
  ctx: TraceRunContext,
  type: TraceEvent["type"],
  payload: TraceEventPayload,
): void {
  emitForContext(ctx, type, payload);
}

export function appendTraceStreamRecord(
  ctx: TraceRunContext,
  llmCallId: string,
  record: { ts: string; eventName?: string; rawLine: string },
): TracePayloadRef | undefined {
  if (!bundleStore) return undefined;
  try {
    return bundleStore.appendStreamRecord(ctx, llmCallId, record);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[wire-trace] stream write failed rootRunId=${ctx.rootRunId}: ${msg}`);
    return undefined;
  }
}

export function setTraceRuntimeCwd(cwd: string): void {
  const traceRoot = process.env.TRACE_ROOT?.trim()
    ? path.resolve(process.env.TRACE_ROOT)
    : path.join(cwd, ".agents", "runtime", "traces");
  bundleStore = createTraceBundleStore({ traceRoot });
}

export function createWireTraceHook(runtimeCwd: string): AgentsHook {
  setTraceRuntimeCwd(runtimeCwd);
  const startTimes = new Map<string, number>();

  return {
    name: "wire-trace",
    async beforeRun(payload: BeforeRunHookPayload): Promise<void> {
      startTimes.set(payload.runId, Date.now());
      emit("run.started", {
        type: "run.started",
        prompt: payload.prompt,
        workspaceContextSummary: payload.workspaceContext.summary,
        requiredSkills: payload.requiredSkills,
        modelOverride: payload.modelOverride,
        runtimeMeta: payload.runtimeMeta,
      });
    },
    async afterRun(payload: AfterRunHookPayload): Promise<void> {
      const startTime = startTimes.get(payload.runId) ?? Date.now();
      startTimes.delete(payload.runId);
      emit("run.finished", {
        type: "run.finished",
        resultText: payload.resultText,
        durationMs: Date.now() - startTime,
        toolCallCount: payload.toolCalls.length,
      });
    },
    async onRunError(payload: RunErrorHookPayload): Promise<void> {
      const startTime = startTimes.get(payload.runId) ?? Date.now();
      startTimes.delete(payload.runId);
      emit("run.errored", {
        type: "run.errored",
        errorMessage: payload.errorMessage,
        durationMs: Date.now() - startTime,
      });
    },
    async onToolCall(payload: ToolCallHookPayload): Promise<void> {
      const tc = payload.toolCall;
      emit("tool.start", {
        type: "tool.start",
        toolCallId: tc.toolCallId,
        name: tc.name,
        args: tc.args,
      });
      emit("tool.end", {
        type: "tool.end",
        toolCallId: tc.toolCallId,
        name: tc.name,
        status: tc.status,
        output: tc.output,
        outputJson: tc.outputJson,
        durationMs: tc.durationMs,
        errorMessage: tc.errorMessage,
      });
    },
  };
}
