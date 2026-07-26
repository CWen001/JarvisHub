import fs from "node:fs";
import path from "node:path";

import type { CatalogStore } from "./catalog-store.js";

export interface TailInvalidation {
  kind: "catalog.changed" | "run.changed";
  rootRunId?: string;
}

type Listener = (event: TailInvalidation) => void;

export interface TailRegistry {
  subscribeCatalog(listener: Listener): () => void;
  subscribeRun(rootRunId: string, listener: Listener): () => void;
  close(): void;
}

export function createTailRegistry(traceRootInput: string, catalogStore: CatalogStore): TailRegistry {
  const traceRoot = path.resolve(traceRootInput);
  const catalogFile = path.join(traceRoot, "catalog.jsonl");
  const catalogListeners = new Set<Listener>();
  const runListeners = new Map<string, Set<Listener>>();
  const watched = new Set<string>();

  function watch(filePath: string, notify: () => void): void {
    if (watched.has(filePath)) return;
    watched.add(filePath);
    fs.watchFile(filePath, { persistent: false, interval: 500 }, (current, previous) => {
      if (current.size !== previous.size || current.mtimeMs !== previous.mtimeMs) notify();
    });
  }

  function subscribeCatalog(listener: Listener): () => void {
    catalogListeners.add(listener);
    watch(catalogFile, () => {
      void catalogStore.refresh();
      for (const current of catalogListeners) current({ kind: "catalog.changed" });
    });
    return () => { catalogListeners.delete(listener); };
  }

  function subscribeRun(rootRunId: string, listener: Listener): () => void {
    const listeners = runListeners.get(rootRunId) ?? new Set<Listener>();
    listeners.add(listener);
    runListeners.set(rootRunId, listeners);
    const run = catalogStore.getRun(rootRunId);
    if (run) {
      const eventsFile = path.join(traceRoot, ...run.relativeDir.split("/"), "events.jsonl");
      watch(eventsFile, () => {
        for (const current of runListeners.get(rootRunId) ?? []) current({ kind: "run.changed", rootRunId });
      });
    }
    return () => { listeners.delete(listener); };
  }

  function close(): void {
    for (const filePath of watched) fs.unwatchFile(filePath);
    watched.clear();
    catalogListeners.clear();
    runListeners.clear();
  }

  return { subscribeCatalog, subscribeRun, close };
}
