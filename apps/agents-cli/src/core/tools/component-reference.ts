import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { ToolHandler } from "./registry.js";
import { persistToolRetrievalRecord } from "./retrieval-store.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 30;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 90_000;
const AGENTS_CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

type ComponentReferenceSearchPayload = {
  query: string;
  topK: number;
  filters: {
    category: string | null;
    dependency: string | null;
    assetSlot: string | null;
  };
  results: unknown[];
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown): string | null {
  const text = readString(value);
  return text ? text : null;
}

function readPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function componentReferenceRoot(): string {
  return AGENTS_CLI_ROOT;
}

function findComponentCardSearchPaths(): {
  scriptPath: string;
  indexPath: string;
} | null {
  const root = componentReferenceRoot();
  const scriptPath = path.join(root, "emp_code", "scrape", "component_card_index.py");
  const indexPath = path.join(root, "emp_code", "scrape", "21st-component-card-index.json");
  if (fs.existsSync(scriptPath) && fs.existsSync(indexPath)) {
    return { scriptPath, indexPath };
  }
  return null;
}

function readWorkspaceRoot(ctx: { cwd: string; meta?: Record<string, unknown> }): string {
  const value = ctx.meta?.workspaceRoot;
  return typeof value === "string" && value.trim() ? value.trim() : ctx.cwd;
}

function isSearchPayload(value: unknown): value is ComponentReferenceSearchPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const filters = record.filters;
  return (
    typeof record.query === "string" &&
    typeof record.topK === "number" &&
    Array.isArray(record.results) &&
    Boolean(filters) &&
    typeof filters === "object" &&
    !Array.isArray(filters)
  );
}

function parseSearchPayload(stdout: string): ComponentReferenceSearchPayload {
  const parsed = JSON.parse(stdout) as unknown;
  if (!isSearchPayload(parsed)) {
    throw new Error("component_card_index.py returned an unexpected JSON shape.");
  }
  return parsed;
}

export function createComponentReferenceSearchTool(): ToolHandler {
  return {
    definition: {
      name: "component_reference_search",
      description:
        "Search the existing local ComponentCard index built from 21st.dev component cards. Use this for staged web componentReferencePlan queries after Reference Prompt extraction and before asset planning. Returns real indexed component references with codeEvidence, styleCarryover, motionCarryover, assetSlots, and implementationNotes. If no result fits, record write_from_scratch instead of inventing references.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Section/component query combining layout, material, motion, and asset-slot needs, e.g. technical performance section metric strip engineering dashboard dark glass panels animated stats product showcase.",
          },
          topK: {
            type: "number",
            description: "Number of indexed component results to return. Default 10, max 30.",
          },
          category: {
            type: "string",
            description: "Optional exact category filter from the index.",
          },
          dependency: {
            type: "string",
            description: "Optional exact dependency filter, e.g. framer-motion.",
          },
          assetSlot: {
            type: "string",
            description: "Optional exact asset slot filter.",
          },
          timeoutMs: {
            type: "number",
            description: "Search timeout in milliseconds. Default 30000, max 90000.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    async execute(args, ctx, toolCallId) {
      const query = readString(args.query);
      if (!query) {
        throw new Error("component_reference_search query is required.");
      }
      const paths = findComponentCardSearchPaths();
      if (!paths) {
        const rootsChecked = [path.relative(ctx.cwd, componentReferenceRoot()) || "."];
        const contentPayload = {
          ok: false,
          query,
          reason: "component_card_index_not_found",
          expectedScript: "emp_code/scrape/component_card_index.py",
          expectedIndex: "emp_code/scrape/21st-component-card-index.json",
          rootsChecked,
          resultCount: 0,
          results: [],
        };
        const retrievalRecord = await persistToolRetrievalRecord(ctx, {
          kind: "component_reference_search",
          query,
          source: "emp_code/scrape/21st-component-card-index.json",
          resultCount: 0,
          payload: contentPayload,
        });
        return {
          toolCallId,
          content: JSON.stringify({
            ...contentPayload,
            retrievalRecord,
          }),
        };
      }

      const topK = readPositiveInteger(args.topK ?? args.limit, DEFAULT_TOP_K, MAX_TOP_K);
      const timeoutMs = readPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
      const category = readOptionalString(args.category);
      const dependency = readOptionalString(args.dependency);
      const assetSlot = readOptionalString(args.assetSlot);
      const commandArgs = [
        paths.scriptPath,
        "search",
        "--index",
        paths.indexPath,
        "--query",
        query,
        "--top-k",
        String(topK),
      ];
      if (category) commandArgs.push("--category", category);
      if (dependency) commandArgs.push("--dependency", dependency);
      if (assetSlot) commandArgs.push("--asset-slot", assetSlot);

      try {
        const { stdout } = await execFileAsync("python3", commandArgs, {
          cwd: path.dirname(paths.scriptPath),
          timeout: timeoutMs,
          maxBuffer: 20 * 1024 * 1024,
        });
        const payload = parseSearchPayload(stdout);
        const contentPayload = {
          ok: true,
          librarySource: "emp_code/scrape/21st-component-card-index.json",
          scriptPath: paths.scriptPath,
          indexPath: paths.indexPath,
          usageContract: {
            retrievalRecordPath: "retrievalRecord.id",
            retrievalRecordRule:
              "Store this id in componentReferencePlan.searchRecords[] or the relevant sectionDecision so later codegen can call retrieval_record_get instead of relying on long context.",
            componentReferencePlanPath: "webPageImplementationBrief.componentReferencePlan.sectionDecisions[].topReferences[]",
            selectedReferenceSource:
              "Copy each selected result.componentReferencePlanCandidate as an object, then set matchedSectionId to the owning section id.",
            requiredSelectedReferenceFields: [
              "referenceId",
              "source",
              "matchedSectionId",
              "componentRole",
              "styleCarryover",
              "motionCarryover",
              "assetSlots",
              "implementationNotes",
              "codeEvidence",
            ],
            noMatchRule:
              "If no returned result is structurally and visually useful, set selectionDecision='write_from_scratch' with topReferences=[] and a concrete fallback implementation spec. Do not convert references into strings and do not invent references.",
          },
          ...payload,
          resultCount: payload.results.length,
        };
        const retrievalRecord = await persistToolRetrievalRecord(ctx, {
          kind: "component_reference_search",
          query,
          source: "emp_code/scrape/21st-component-card-index.json",
          resultCount: payload.results.length,
          payload: contentPayload,
        });
        return {
          toolCallId,
          content: JSON.stringify({
            ...contentPayload,
            retrievalRecord,
          }),
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const contentPayload = {
          ok: false,
          query,
          librarySource: "emp_code/scrape/21st-component-card-index.json",
          scriptPath: paths.scriptPath,
          indexPath: paths.indexPath,
          resultCount: 0,
          results: [],
          error: message,
          usageContract: {
            retrievalRecordPath: "retrievalRecord.id",
            retrievalRecordRule:
              "Store this id even when ComponentCard search fails, so later codegen can distinguish failed retrieval from omitted retrieval.",
            failureRule:
              "A failed component search does not authorize generic templates. Repair the search/index issue or explicitly write_from_scratch from preview details.",
          },
        };
        const retrievalRecord = await persistToolRetrievalRecord(
          { ...ctx, cwd: readWorkspaceRoot(ctx) },
          {
            kind: "component_reference_search",
            query,
            source: "emp_code/scrape/21st-component-card-index.json",
            resultCount: 0,
            payload: contentPayload,
          },
        );
        return {
          toolCallId,
          content: JSON.stringify({
            ...contentPayload,
            retrievalRecord,
          }),
        };
      }
    },
  };
}
