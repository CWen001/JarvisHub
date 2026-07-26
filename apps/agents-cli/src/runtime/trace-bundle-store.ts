import fs from "node:fs";
import path from "node:path";

import type { TraceRunContext } from "./trace-context.js";
import type {
  ExternalTracePayload,
  TraceCatalogRecord,
  TraceEvent,
  TraceEventV2,
  TracePayloadRef,
} from "./trace-events.js";

export const TRACE_INLINE_PAYLOAD_MAX_BYTES = 256 * 1024;

export interface TraceBundleMeta {
  version: 1;
  rootRunId: string;
  sessionId: string;
  relativeDir: string;
  startedAt: string;
  lastTs: string;
  status: "running" | "finished" | "errored";
  promptPreview: string;
  eventCount: number;
  totalBytes: number;
}

interface BundleWriter {
  bundleDir: string;
  eventsFile: string;
  meta: TraceBundleMeta;
}

export interface TraceBundleStore {
  appendEvent(ctx: TraceRunContext, event: TraceEvent): TraceEventV2;
  appendStreamRecord(
    ctx: TraceRunContext,
    llmCallId: string,
    record: { ts: string; eventName?: string; rawLine: string },
  ): TracePayloadRef;
  closeRoot(rootRunId: string, status: "finished" | "errored", lastTs: string): void;
  close(): Promise<void>;
}

export function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 64) || "unknown";
}

export function sessionSlug(sessionId: string): string {
  const conversation = sessionId.match(/(?:^|:)conversation:([^:]+)/)?.[1];
  return sanitizePathSegment(conversation ?? sessionId).slice(0, 48);
}

export function bundleRelativeDir(ts: string, sessionId: string, rootRunId: string): string {
  const date = ts.slice(0, 10);
  const timestamp = ts.replace(/[-:]/g, "").replace("T", "-").replace("Z", "");
  return path.posix.join(
    "runs",
    sanitizePathSegment(date),
    `${sanitizePathSegment(timestamp)}__${sessionSlug(sessionId)}__${sanitizePathSegment(rootRunId).slice(0, 12)}`,
  );
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

export function resolveBundlePath(bundleDir: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new Error("payload ref is outside trace bundle");
  const root = path.resolve(bundleDir);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("payload ref is outside trace bundle");
  }
  return resolved;
}

function promptPreview(event: TraceEvent): string {
  if (event.type !== "run.started" || event.payload.type !== "run.started") return "";
  return event.payload.prompt.slice(0, 240);
}

function payloadPreview(event: TraceEvent, bytes: number): Record<string, unknown> {
  const payload = event.payload;
  if (payload.type === "run.started") return { prompt: payload.prompt.slice(0, 240), bytes };
  if (payload.type === "run.finished") return { resultText: payload.resultText.slice(0, 240), durationMs: payload.durationMs, bytes };
  if (payload.type === "run.errored") return { errorMessage: payload.errorMessage.slice(0, 240), durationMs: payload.durationMs, bytes };
  if (payload.type === "llm.request") {
    return { method: payload.method, url: payload.url, clientKind: payload.clientKind, bytes };
  }
  if (payload.type === "llm.response") {
    return { status: payload.status, durationMs: payload.durationMs, bytes };
  }
  if (payload.type === "tool.start") return { name: payload.name, bytes };
  if (payload.type === "tool.end") {
    return { name: payload.name, status: payload.status, durationMs: payload.durationMs, bytes };
  }
  return { bytes };
}

export function createTraceBundleStore(options: { traceRoot: string }): TraceBundleStore {
  const traceRoot = path.resolve(options.traceRoot);
  const catalogFile = path.join(traceRoot, "catalog.jsonl");
  const writers = new Map<string, BundleWriter>();

  function appendCatalog(meta: TraceBundleMeta): void {
    const record: TraceCatalogRecord = {
      version: 1,
      op: "upsert",
      rootRunId: meta.rootRunId,
      sessionId: meta.sessionId,
      relativeDir: meta.relativeDir,
      startedAt: meta.startedAt,
      lastTs: meta.lastTs,
      status: meta.status,
      promptPreview: meta.promptPreview,
      eventCount: meta.eventCount,
      totalBytes: meta.totalBytes,
    };
    fs.mkdirSync(traceRoot, { recursive: true });
    fs.appendFileSync(catalogFile, `${JSON.stringify(record)}\n`, "utf8");
  }

  function ensureWriter(ctx: TraceRunContext, event: TraceEvent): BundleWriter {
    const existing = writers.get(ctx.rootRunId);
    if (existing) return existing;

    const relativeDir = bundleRelativeDir(event.ts, ctx.sessionId, ctx.rootRunId);
    const bundleDir = path.join(traceRoot, ...relativeDir.split("/"));
    fs.mkdirSync(bundleDir, { recursive: true });
    const writer: BundleWriter = {
      bundleDir,
      eventsFile: path.join(bundleDir, "events.jsonl"),
      meta: {
        version: 1,
        rootRunId: ctx.rootRunId,
        sessionId: ctx.sessionId,
        relativeDir,
        startedAt: event.ts,
        lastTs: event.ts,
        status: "running",
        promptPreview: promptPreview(event),
        eventCount: 0,
        totalBytes: 0,
      },
    };
    writers.set(ctx.rootRunId, writer);
    return writer;
  }

  function appendEvent(ctx: TraceRunContext, event: TraceEvent): TraceEventV2 {
    const writer = ensureWriter(ctx, event);
    if (!writer.meta.promptPreview) writer.meta.promptPreview = promptPreview(event);
    const serializedPayload = JSON.stringify(event.payload);
    const payloadBytes = Buffer.byteLength(serializedPayload);
    let storedPayload: TraceEventV2["payload"] = event.payload;
    if (payloadBytes > TRACE_INLINE_PAYLOAD_MAX_BYTES) {
      const relativePath = path.posix.join(
        "payloads",
        `event-${sanitizePathSegment(event.runId).slice(0, 12)}-${event.seq}.json`,
      );
      const payloadPath = resolveBundlePath(writer.bundleDir, relativePath);
      fs.mkdirSync(path.dirname(payloadPath), { recursive: true });
      fs.writeFileSync(payloadPath, serializedPayload, "utf8");
      const external: ExternalTracePayload = {
        type: event.type,
        preview: payloadPreview(event, payloadBytes),
        payloadRef: { path: relativePath, mediaType: "application/json", bytes: payloadBytes },
      };
      storedPayload = external;
      writer.meta.totalBytes += payloadBytes;
    }
    const compactEvent: TraceEventV2 = {
      ...event,
      version: 2,
      rootRunId: ctx.rootRunId,
      payload: storedPayload,
      ...("llmCallId" in event.payload && typeof event.payload.llmCallId === "string"
        ? { llmCallId: event.payload.llmCallId }
        : {}),
    };
    const line = `${JSON.stringify(compactEvent)}\n`;
    fs.appendFileSync(writer.eventsFile, line, "utf8");
    writer.meta.lastTs = event.ts;
    writer.meta.eventCount += 1;
    writer.meta.totalBytes += Buffer.byteLength(line);
    writeJsonAtomic(path.join(writer.bundleDir, "meta.json"), writer.meta);
    if (ctx.runId === ctx.rootRunId && event.type === "run.started") appendCatalog(writer.meta);
    return compactEvent;
  }

  function appendStreamRecord(
    ctx: TraceRunContext,
    llmCallId: string,
    record: { ts: string; eventName?: string; rawLine: string },
  ): TracePayloadRef {
    const writer = writers.get(ctx.rootRunId);
    if (!writer) throw new Error(`trace bundle is not open for rootRunId=${ctx.rootRunId}`);
    const relativePath = path.posix.join(
      "payloads",
      `llm-${sanitizePathSegment(llmCallId)}-stream.jsonl`,
    );
    const streamPath = resolveBundlePath(writer.bundleDir, relativePath);
    fs.mkdirSync(path.dirname(streamPath), { recursive: true });
    const line = `${JSON.stringify(record)}\n`;
    fs.appendFileSync(streamPath, line, "utf8");
    const bytes = fs.statSync(streamPath).size;
    writer.meta.lastTs = record.ts;
    writer.meta.totalBytes += Buffer.byteLength(line);
    writeJsonAtomic(path.join(writer.bundleDir, "meta.json"), writer.meta);
    return { path: relativePath, mediaType: "application/x-ndjson", bytes };
  }

  function closeRoot(rootRunId: string, status: "finished" | "errored", lastTs: string): void {
    const writer = writers.get(rootRunId);
    if (!writer) return;
    writer.meta.status = status;
    writer.meta.lastTs = lastTs;
    writeJsonAtomic(path.join(writer.bundleDir, "meta.json"), writer.meta);
    appendCatalog(writer.meta);
  }

  return {
    appendEvent,
    appendStreamRecord,
    closeRoot,
    async close(): Promise<void> {},
  };
}
