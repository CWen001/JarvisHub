import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function rebuildCatalog(traceRootInput: string): number {
  const traceRoot = path.resolve(traceRootInput);
  const runsRoot = path.join(traceRoot, "runs");
  const records: unknown[] = [];
  const visit = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(dir, entry.name);
      const metaFile = path.join(child, "meta.json");
      if (fs.existsSync(metaFile)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
          records.push({ version: 1, op: "upsert", ...meta });
        } catch { /* skip malformed metadata */ }
      } else visit(child);
    }
  };
  visit(runsRoot);
  fs.mkdirSync(traceRoot, { recursive: true });
  const temp = path.join(traceRoot, "catalog.jsonl.tmp");
  fs.writeFileSync(temp, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""));
  fs.renameSync(temp, path.join(traceRoot, "catalog.jsonl"));
  return records.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const traceRoot = process.env.TRACE_ROOT ?? process.argv[2];
  if (!traceRoot) {
    console.error("Set TRACE_ROOT or pass the trace root as the first argument");
    process.exitCode = 1;
  } else {
    console.log(`rebuilt ${rebuildCatalog(traceRoot)} catalog records`);
  }
}
