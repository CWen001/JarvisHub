import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import type { TraceEvent, TracePayloadRef } from "./trace-events.js";
import type { TraceRunContext } from "./trace-context.js";
import { createTraceBundleStore, writeJsonAtomic } from "./trace-bundle-store.js";

export interface LegacyMigrationReport {
  sourceFile: string;
  rootRunCount: number;
  descendantRunCount: number;
  eventCount: number;
  malformedLineCount: number;
  completedAt: string;
  skipped?: boolean;
}

interface MigrationState {
  version: 1;
  sourceFile: string;
  sourceBytes: number;
  sourceMtimeMs: number;
  report: LegacyMigrationReport;
}

async function forEachLine(filePath: string, visit: (line: string) => void | Promise<void>): Promise<void> {
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) await visit(line);
}

function parseLegacyEvent(line: string): TraceEvent | undefined {
  try {
    const value = JSON.parse(line);
    if (!value || typeof value !== "object" || typeof value.runId !== "string" || typeof value.type !== "string") return undefined;
    return value as TraceEvent;
  } catch {
    return undefined;
  }
}

function findBundleDirs(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(dir, entry.name);
      if (fs.existsSync(path.join(child, "meta.json"))) out.push(child);
      else visit(child);
    }
  };
  visit(root);
  return out;
}

export async function migrateLegacyTrace(options: {
  sourceFile: string;
  traceRoot: string;
}): Promise<LegacyMigrationReport> {
  const sourceFile = path.resolve(options.sourceFile);
  const traceRoot = path.resolve(options.traceRoot);
  const sourceStat = fs.statSync(sourceFile);
  const stateFile = path.join(traceRoot, "migration-state.json");
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as MigrationState;
      if (state.sourceFile === sourceFile && state.sourceBytes === sourceStat.size && state.sourceMtimeMs === sourceStat.mtimeMs) {
        return { ...state.report, skipped: true };
      }
    } catch {
      // A damaged state is not proof that migration completed; rebuild from the source.
    }
  }

  const parentByRunId = new Map<string, string>();
  const runIds = new Set<string>();
  let eventCount = 0;
  let malformedLineCount = 0;
  await forEachLine(sourceFile, (line) => {
    if (!line.trim()) return;
    const event = parseLegacyEvent(line);
    if (!event) {
      malformedLineCount += 1;
      return;
    }
    eventCount += 1;
    runIds.add(event.runId);
    if (event.parentRunId) parentByRunId.set(event.runId, event.parentRunId);
  });

  const rootFor = (runId: string): string => {
    const visited = new Set<string>();
    let current = runId;
    while (parentByRunId.has(current) && !visited.has(current)) {
      visited.add(current);
      current = parentByRunId.get(current)!;
    }
    return current;
  };
  const rootRunIds = new Set([...runIds].map(rootFor));
  const migrationRoot = path.join(traceRoot, `.migration-${process.pid}.migrating`);
  fs.rmSync(migrationRoot, { recursive: true, force: true });
  const store = createTraceBundleStore({ traceRoot: migrationRoot });
  const requestCountByRun = new Map<string, number>();
  const activeCallByRun = new Map<string, string>();
  const streamRefByCall = new Map<string, TracePayloadRef>();

  await forEachLine(sourceFile, (line) => {
    const event = parseLegacyEvent(line);
    if (!event) return;
    const rootRunId = rootFor(event.runId);
    const ctx: TraceRunContext = {
      runId: event.runId,
      rootRunId,
      sessionId: event.sessionId,
      parentRunId: event.parentRunId,
      depth: event.depth,
      seq: event.seq + 1,
    };

    if (event.type === "llm.request") {
      const requestIndex = (requestCountByRun.get(event.runId) ?? 0) + 1;
      requestCountByRun.set(event.runId, requestIndex);
      const llmCallId = `legacy-${event.runId}-${requestIndex}`;
      activeCallByRun.set(event.runId, llmCallId);
      event.payload = { ...event.payload, llmCallId } as TraceEvent["payload"];
    } else if (event.type === "llm.stream.delta") {
      const llmCallId = activeCallByRun.get(event.runId) ?? `legacy-${event.runId}-orphan`;
      const payload = event.payload as any;
      const ref = store.appendStreamRecord(ctx, llmCallId, {
        ts: event.ts,
        eventName: payload.eventName,
        rawLine: String(payload.rawLine ?? ""),
      });
      streamRefByCall.set(llmCallId, ref);
      return;
    } else if (event.type === "llm.response") {
      const llmCallId = activeCallByRun.get(event.runId) ?? `legacy-${event.runId}-orphan`;
      const streamRef = streamRefByCall.get(llmCallId);
      event.payload = {
        ...event.payload,
        llmCallId,
        ...(streamRef ? { body: null, streamRef } : {}),
      } as TraceEvent["payload"];
      activeCallByRun.delete(event.runId);
    }

    store.appendEvent(ctx, event);
    if (event.runId === rootRunId && event.type === "run.finished") store.closeRoot(rootRunId, "finished", event.ts);
    if (event.runId === rootRunId && event.type === "run.errored") store.closeRoot(rootRunId, "errored", event.ts);
  });
  await store.close();

  for (const sourceBundle of findBundleDirs(path.join(migrationRoot, "runs"))) {
    const relative = path.relative(migrationRoot, sourceBundle);
    const targetBundle = path.join(traceRoot, relative);
    fs.mkdirSync(path.dirname(targetBundle), { recursive: true });
    if (fs.existsSync(targetBundle)) fs.rmSync(sourceBundle, { recursive: true, force: true });
    else fs.renameSync(sourceBundle, targetBundle);
  }
  const migrationCatalog = path.join(migrationRoot, "catalog.jsonl");
  if (fs.existsSync(migrationCatalog)) {
    fs.mkdirSync(traceRoot, { recursive: true });
    fs.appendFileSync(path.join(traceRoot, "catalog.jsonl"), fs.readFileSync(migrationCatalog));
  }
  fs.rmSync(migrationRoot, { recursive: true, force: true });

  const report: LegacyMigrationReport = {
    sourceFile,
    rootRunCount: rootRunIds.size,
    descendantRunCount: runIds.size - rootRunIds.size,
    eventCount,
    malformedLineCount,
    completedAt: new Date().toISOString(),
  };
  const state: MigrationState = {
    version: 1,
    sourceFile,
    sourceBytes: sourceStat.size,
    sourceMtimeMs: sourceStat.mtimeMs,
    report,
  };
  writeJsonAtomic(stateFile, state);
  return report;
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function resolveMigrationCliPath(value: string, invocationDirectory: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(invocationDirectory, value);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const sourceFile = readArg("--source");
  const traceRoot = readArg("--trace-root");
  if (!sourceFile || !traceRoot) {
    console.error("Usage: trace:migrate -- --source <events.jsonl> --trace-root <directory>");
    process.exitCode = 1;
  } else {
    const invocationDirectory = process.env.INIT_CWD ?? process.env.PWD ?? process.cwd();
    migrateLegacyTrace({
      sourceFile: resolveMigrationCliPath(sourceFile, invocationDirectory),
      traceRoot: resolveMigrationCliPath(traceRoot, invocationDirectory),
    })
      .then((report) => console.log(JSON.stringify(report, null, 2)))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
