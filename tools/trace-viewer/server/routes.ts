import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { BundleReader } from "./bundle-reader.js";
import type { CatalogStore } from "./catalog-store.js";
import type { TailRegistry } from "./tail.js";

export function createRoutes(options: {
  catalogStore: CatalogStore;
  bundleReader: BundleReader;
  tailRegistry: TailRegistry;
  traceRoot: string;
}): Hono {
  const { catalogStore, bundleReader, tailRegistry } = options;
  const traceRoot = path.resolve(options.traceRoot);
  const app = new Hono();

  app.get("/health", async (c) => {
    await catalogStore.refresh();
    return c.json({ ok: true, ready: catalogStore.isReady(), rootRunCount: catalogStore.getSessions().reduce((sum, item) => sum + item.runCount, 0) });
  });

  app.get("/sessions", async (c) => {
    await catalogStore.refresh();
    if (!catalogStore.isReady()) return c.json({ error: "Trace catalog is missing", rebuildCommand: "pnpm --filter trace-viewer catalog:rebuild" }, 503);
    return c.json(catalogStore.getSessions());
  });

  app.get("/sessions/:sessionId/runs", async (c) => {
    await catalogStore.refresh();
    if (!catalogStore.isReady()) return c.json({ error: "Trace catalog is missing" }, 503);
    return c.json(catalogStore.getRunsForSession(c.req.param("sessionId")));
  });

  app.get("/runs/:rootRunId/view", async (c) => {
    await catalogStore.refresh();
    const run = catalogStore.getRun(c.req.param("rootRunId"));
    if (!run) return c.json({ error: "Run not found" }, 404);
    try { return c.json(bundleReader.getView(run)); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 500); }
  });

  app.get("/runs/:rootRunId/events", async (c) => {
    await catalogStore.refresh();
    const run = catalogStore.getRun(c.req.param("rootRunId"));
    if (!run) return c.json({ error: "Run not found" }, 404);
    const cursor = Number(c.req.query("cursor") ?? 0);
    const limit = Number(c.req.query("limit") ?? 200);
    return c.json(bundleReader.getEvents(run, cursor, limit));
  });

  app.get("/runs/:rootRunId/payload", async (c) => {
    await catalogStore.refresh();
    const run = catalogStore.getRun(c.req.param("rootRunId"));
    if (!run) return c.json({ error: "Run not found" }, 404);
    const ref = c.req.query("ref");
    if (!ref) return c.json({ error: "Missing payload ref" }, 400);
    try { return c.json(bundleReader.readPayload(run, ref)); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });

  const stream = (subscribe: (listener: (event: any) => void) => () => void) => (c: any) => streamSSE(c, async (output) => {
    const unsubscribe = subscribe((event) => { void output.write(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`); });
    const heartbeat = setInterval(() => { void output.write("event: ping\ndata: {}\n\n"); }, 15_000);
    output.onAbort(() => { unsubscribe(); clearInterval(heartbeat); });
    while (!output.aborted) await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  app.get("/catalog/stream", stream((listener) => tailRegistry.subscribeCatalog(listener)));
  app.get("/runs/:rootRunId/stream", (c) => stream((listener) => tailRegistry.subscribeRun(c.req.param("rootRunId"), listener))(c));

  app.get("/projects", async (c) => {
    const apiPort = process.env.HONO_API_PORT ?? "8889";
    try {
      const response = await fetch(`http://localhost:${apiPort}/projects`);
      return c.json(response.ok ? await response.json() : []);
    } catch { return c.json([]); }
  });

  app.get("/legacy/status", (c) => {
    const legacyFile = path.join(traceRoot, "events.jsonl");
    const stateFile = path.join(traceRoot, "migration-state.json");
    const exists = fs.existsSync(legacyFile);
    let migrationCompletedAt: string | undefined;
    if (fs.existsSync(stateFile)) {
      try { migrationCompletedAt = JSON.parse(fs.readFileSync(stateFile, "utf8"))?.report?.completedAt; } catch { /* ignore */ }
    }
    return c.json({ exists, ...(exists ? { bytes: fs.statSync(legacyFile).size } : {}), migrated: Boolean(migrationCompletedAt), ...(migrationCompletedAt ? { migrationCompletedAt } : {}) });
  });

  return app;
}
