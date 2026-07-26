import fs from "node:fs";
import path from "node:path";

export interface SessionSummary {
  sessionId: string;
  runCount: number;
  lastTs: string;
  lastPromptPreview: string;
}

export interface RootRunSummary {
  runId: string;
  rootRunId: string;
  sessionId: string;
  relativeDir: string;
  startedAt: string;
  firstTs: string;
  lastTs: string;
  status: "running" | "finished" | "errored";
  prompt: string;
  promptPreview: string;
  eventCount?: number;
  totalBytes?: number;
  depth: 0;
}

export interface CatalogStore {
  getSessions(): SessionSummary[];
  getRunsForSession(sessionId: string): RootRunSummary[];
  getRun(rootRunId: string): RootRunSummary | undefined;
  isReady(): boolean;
  refresh(): Promise<void>;
}

export function createCatalogStore(traceRootInput: string): CatalogStore {
  const traceRoot = path.resolve(traceRootInput);
  const catalogFile = path.join(traceRoot, "catalog.jsonl");
  const runs = new Map<string, RootRunSummary>();
  let lastOffset = 0;
  let pendingText = "";
  let ready = false;
  let refreshPromise: Promise<void> | null = null;

  async function doRefresh(): Promise<void> {
    if (!fs.existsSync(catalogFile)) {
      ready = false;
      return;
    }
    ready = true;
    const stat = fs.statSync(catalogFile);
    if (stat.size < lastOffset) {
      lastOffset = 0;
      pendingText = "";
      runs.clear();
    }
    if (stat.size === lastOffset) return;
    const fd = fs.openSync(catalogFile, "r");
    try {
      const buffer = Buffer.alloc(stat.size - lastOffset);
      fs.readSync(fd, buffer, 0, buffer.length, lastOffset);
      lastOffset = stat.size;
      const lines = `${pendingText}${buffer.toString("utf8")}`.split("\n");
      pendingText = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          if (record?.op !== "upsert" || typeof record.rootRunId !== "string" || typeof record.relativeDir !== "string") continue;
          const metaPath = path.join(traceRoot, ...record.relativeDir.split("/"), "meta.json");
          if (!fs.existsSync(metaPath)) {
            runs.delete(record.rootRunId);
            continue;
          }
          runs.set(record.rootRunId, {
            runId: record.rootRunId,
            rootRunId: record.rootRunId,
            sessionId: record.sessionId ?? "",
            relativeDir: record.relativeDir,
            startedAt: record.startedAt ?? record.lastTs ?? "",
            firstTs: record.startedAt ?? record.lastTs ?? "",
            lastTs: record.lastTs ?? record.startedAt ?? "",
            status: record.status ?? "running",
            prompt: record.promptPreview ?? "",
            promptPreview: record.promptPreview ?? "",
            eventCount: record.eventCount,
            totalBytes: record.totalBytes,
            depth: 0,
          });
        } catch {
          // Catalog is append-only; one malformed record must not hide valid runs.
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  function refresh(): Promise<void> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function getSessions(): SessionSummary[] {
    const grouped = new Map<string, RootRunSummary[]>();
    for (const run of runs.values()) {
      const group = grouped.get(run.sessionId) ?? [];
      group.push(run);
      grouped.set(run.sessionId, group);
    }
    return [...grouped].map(([sessionId, sessionRuns]) => {
      const ordered = [...sessionRuns].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const lastTs = sessionRuns.reduce((latest, run) => run.lastTs > latest ? run.lastTs : latest, "");
      return { sessionId, runCount: sessionRuns.length, lastTs, lastPromptPreview: ordered[0]?.promptPreview ?? "" };
    }).sort((a, b) => b.lastTs.localeCompare(a.lastTs));
  }

  function getRunsForSession(sessionId: string): RootRunSummary[] {
    return [...runs.values()].filter((run) => run.sessionId === sessionId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  return {
    getSessions,
    getRunsForSession,
    getRun: (rootRunId) => runs.get(rootRunId),
    isReady: () => ready,
    refresh,
  };
}
