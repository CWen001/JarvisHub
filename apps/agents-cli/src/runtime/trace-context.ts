import { AsyncLocalStorage } from "node:async_hooks";

export interface TraceRunContext {
  runId: string;
  rootRunId: string;
  sessionId: string;
  parentRunId?: string;
  depth: number;
  seq: number;
}

const storage = new AsyncLocalStorage<TraceRunContext>();

function current(): TraceRunContext | undefined {
  return storage.getStore();
}

function run<T>(ctx: TraceRunContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

function nextSeq(): number {
  const ctx = storage.getStore();
  if (!ctx) return -1;
  return ctx.seq++;
}

function bindToRun(
  runId: string,
  sessionId: string,
  parentRunId?: string,
  depth = 0,
  rootRunId = runId,
): TraceRunContext {
  return { runId, rootRunId, sessionId, parentRunId, depth, seq: 0 };
}

export const traceContext = { current, run, nextSeq, bindToRun };
