import fs from "node:fs";
import path from "node:path";

import { buildRunTree, type RunNode, type TraceEventLike } from "../shared/runTree.js";
import { buildRunTranscript } from "../shared/traceMessages.js";
import type { TraceRunView, TraceTreeView } from "../shared/runView.js";
import type { RootRunSummary } from "./catalog-store.js";

export interface RawEventsPage {
  events: unknown[];
  nextCursor?: number;
}

export interface BundleReader {
  getView(summary: RootRunSummary): TraceTreeView;
  getEvents(summary: RootRunSummary, cursor?: number, limit?: number): RawEventsPage;
  readPayload(summary: RootRunSummary, ref: string): unknown;
}

function safeBundlePath(bundleDir: string, ref: string): string {
  if (path.isAbsolute(ref)) throw new Error("payload path is outside trace bundle");
  const root = path.resolve(bundleDir);
  const resolved = path.resolve(root, ref);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("payload path is outside trace bundle");
  return resolved;
}

function readJsonl(filePath: string): any[] {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return [];
  return fs.readFileSync(filePath, "utf8").split("\n").filter((line) => line.trim()).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function streamChunks(filePath: string): unknown[] {
  return readJsonl(filePath).flatMap((record) => {
    const rawLine = typeof record?.rawLine === "string" ? record.rawLine : "";
    if (!rawLine.startsWith("data:")) return [];
    const data = rawLine.slice(5).trimStart();
    if (!data || data === "[DONE]") return [];
    try { return [JSON.parse(data)]; } catch { return []; }
  });
}

export function createBundleReader(traceRootInput: string): BundleReader {
  const traceRoot = path.resolve(traceRootInput);
  const bundleDirFor = (summary: RootRunSummary) => safeBundlePath(traceRoot, summary.relativeDir);

  function compactEvents(summary: RootRunSummary): any[] {
    return readJsonl(path.join(bundleDirFor(summary), "events.jsonl"));
  }

  function hydrateEvent(bundleDir: string, event: any): any {
    let payload = event?.payload;
    if (payload?.payloadRef?.path) {
      const payloadPath = safeBundlePath(bundleDir, payload.payloadRef.path);
      try { payload = JSON.parse(fs.readFileSync(payloadPath, "utf8")); }
      catch { payload = { type: event.type, warning: "payload missing" }; }
    }
    if (event?.type === "llm.response" && payload?.streamRef?.path) {
      const chunks = streamChunks(safeBundlePath(bundleDir, payload.streamRef.path));
      payload = { ...payload, body: chunks };
    }
    return { ...event, payload };
  }

  function nodeView(node: RunNode): TraceRunView {
    const started = node.events.find((event) => event.type === "run.started");
    const status = node.events.some((event) => event.type === "run.errored")
      ? "errored"
      : node.events.some((event) => event.type === "run.finished") ? "finished" : "running";
    return {
      runId: node.runId,
      ...(node.parentRunId ? { parentRunId: node.parentRunId } : {}),
      depth: node.depth,
      ...(node.subagentName ? { subagentName: node.subagentName } : {}),
      ...(started?.ts ? { startedAt: started.ts } : {}),
      status,
      transcript: buildRunTranscript(node.events),
      children: node.children.map(nodeView),
    };
  }

  function getView(summary: RootRunSummary): TraceTreeView {
    const bundleDir = bundleDirFor(summary);
    const compact = compactEvents(summary);
    const hydrated = compact.map((event) => hydrateEvent(bundleDir, event)) as TraceEventLike[];
    return { rootRunId: summary.rootRunId, roots: buildRunTree(hydrated).map(nodeView), rawEventCount: compact.length };
  }

  function getEvents(summary: RootRunSummary, cursor = 0, requestedLimit = 200): RawEventsPage {
    const events = compactEvents(summary);
    const safeCursor = Math.max(0, Math.trunc(cursor));
    const limit = Math.max(1, Math.min(500, Math.trunc(requestedLimit || 200)));
    const page = events.slice(safeCursor, safeCursor + limit);
    const next = safeCursor + page.length;
    return { events: page, ...(next < events.length ? { nextCursor: next } : {}) };
  }

  function readPayload(summary: RootRunSummary, ref: string): unknown {
    const filePath = safeBundlePath(bundleDirFor(summary), ref);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error("payload not found");
    if (filePath.endsWith(".jsonl")) return readJsonl(filePath);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  return { getView, getEvents, readPayload };
}
