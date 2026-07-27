import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRoutes } from "./routes.js";
import { createCatalogStore } from "./catalog-store.js";
import { createBundleReader } from "./bundle-reader.js";
import { createTailRegistry } from "./tail.js";
import path from "node:path";

const port = parseInt(process.env.TRACE_VIEWER_PORT ?? "5781", 10);
const host = process.env.TRACE_VIEWER_HOST ?? "127.0.0.1";
const serverDir = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(serverDir, "../../..");
const traceRoot = path.resolve(
  process.env.TRACE_ROOT ??
  path.dirname(process.env.TRACE_VIEWER_EVENTS_FILE ?? path.join(repoRoot, "apps/agents-cli/.agents/runtime/traces/events.jsonl")),
);

const app = new Hono();
app.use("*", cors());

const catalogStore = createCatalogStore(traceRoot);
void catalogStore.refresh();
const bundleReader = createBundleReader(traceRoot);
const tailRegistry = createTailRegistry(traceRoot, catalogStore);
const routes = createRoutes({ catalogStore, bundleReader, tailRegistry, traceRoot });

app.route("/api", routes);

// Serve static web files in production
import fs from "node:fs";
const webDist = path.resolve(import.meta.dirname ?? __dirname, "../web/dist");
if (fs.existsSync(webDist)) {
  app.get("*", async (c) => {
    const filePath = path.join(webDist, c.req.path === "/" ? "index.html" : c.req.path);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const mimeTypes: Record<string, string> = {
        ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
        ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
      };
      return c.body(content, 200, { "Content-Type": mimeTypes[ext] ?? "application/octet-stream" });
    }
    const html = fs.readFileSync(path.join(webDist, "index.html"));
    return c.body(html, 200, { "Content-Type": "text/html" });
  });
}

console.log(`[trace-viewer] server starting on http://${host}:${port}`);
console.log(`[trace-viewer] trace root: ${traceRoot}`);

serve({ fetch: app.fetch, hostname: host, port });
