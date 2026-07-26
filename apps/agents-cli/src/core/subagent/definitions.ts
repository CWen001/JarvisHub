import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentDefinition, AgentDefinitionModelProvider } from "../../types/index.js";
import type { AgentHarnessName } from "../root-persona.js";

const MODEL_PROVIDERS: ReadonlyArray<AgentDefinitionModelProvider> = [
  "openai-chat",
  "openai-responses",
  "google-v1beta",
  "anthropic-messages",
];

function isModelProvider(value: unknown): value is AgentDefinitionModelProvider {
  return typeof value === "string" && MODEL_PROVIDERS.includes(value as AgentDefinitionModelProvider);
}

let activeDefinitions = new Map<string, AgentDefinition>();

const DEFINITIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "agent-definitions",
);

const HARNESS_DEFINITION_FILE: Record<AgentHarnessName, string> = {
  canvas: path.join(DEFINITIONS_DIR, "canvas.json"),
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = String(item || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeAgentDefinition(value: unknown): AgentDefinition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  const tools = normalizeStringArray(record.tools);
  if (!name || !description || !prompt || tools.length === 0) return null;
  const disallowedTools = normalizeStringArray(record.disallowedTools);
  const modelPolicy =
    record.modelPolicy && typeof record.modelPolicy === "object" && !Array.isArray(record.modelPolicy)
      ? record.modelPolicy as Record<string, unknown>
      : null;
  return {
    name,
    description,
    prompt,
    tools,
    ...(disallowedTools.length > 0 ? { disallowedTools } : {}),
    ...(record.isReadOnly === true ? { isReadOnly: true } : {}),
    ...(record.background === true ? { background: true } : {}),
    ...(typeof record.maxTurns === "number" && Number.isFinite(record.maxTurns) && record.maxTurns > 0
      ? { maxTurns: Math.trunc(record.maxTurns) }
      : {}),
    ...(typeof record.timeoutMs === "number" && Number.isFinite(record.timeoutMs) && record.timeoutMs > 0
      ? { timeoutMs: Math.trunc(record.timeoutMs) }
      : {}),
    ...(modelPolicy
      ? {
          modelPolicy: {
            ...(modelPolicy.inheritFromParent === true ? { inheritFromParent: true } : {}),
            ...(typeof modelPolicy.defaultModel === "string" && modelPolicy.defaultModel.trim()
              ? { defaultModel: modelPolicy.defaultModel.trim() }
              : {}),
          },
        }
      : {}),
    ...(typeof record.model === "string" && record.model.trim()
      ? { model: record.model.trim() }
      : {}),
    ...(isModelProvider(record.modelProvider) ? { modelProvider: record.modelProvider } : {}),
    ...(record.useMultimodalSlot === true ? { useMultimodalSlot: true } : {}),
    ...(record.requiresNativeVideoInput === true ? { requiresNativeVideoInput: true } : {}),
    ...(record.minimalSystemPrompt === true ? { minimalSystemPrompt: true } : {}),
  };
}

function readDefinitionFile(filePath: string): AgentDefinition[] {
  if (!fs.existsSync(filePath)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const definitions: AgentDefinition[] = [];
  for (const item of items) {
    const normalized = normalizeAgentDefinition(item);
    if (normalized) definitions.push(normalized);
  }
  return definitions;
}

export function resolveAgentDefinitionFiles(
  harness: AgentHarnessName,
  workspaceRoot: string,
): string[] {
  const cwd = process.cwd();
  const fileName = `${harness}.json`;
  const candidates = [
    HARNESS_DEFINITION_FILE[harness],
    path.join(workspaceRoot, ".agents", "agent-definitions", fileName),
    path.join(workspaceRoot, "agent-definitions", fileName),
    path.join(cwd, "agent-definitions", fileName),
  ];
  const seen = new Set<string>();
  const files: string[] = [];
  for (const candidate of candidates) {
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (fs.existsSync(normalized)) files.push(normalized);
  }
  return files;
}

export function loadAgentDefinitions(files: string[]): Map<string, AgentDefinition> {
  const merged = new Map<string, AgentDefinition>();
  for (const filePath of files) {
    for (const definition of readDefinitionFile(filePath)) {
      merged.set(definition.name, definition);
    }
  }
  return merged;
}

export function setActiveAgentDefinitions(definitions: Map<string, AgentDefinition>): void {
  activeDefinitions = new Map(definitions);
}

export function getActiveAgentDefinitions(): Map<string, AgentDefinition> {
  if (activeDefinitions.size === 0) {
    activeDefinitions = loadAgentDefinitions([HARNESS_DEFINITION_FILE.canvas]);
  }
  return activeDefinitions;
}

export function getAgentDefinition(name: string): AgentDefinition | null {
  return getActiveAgentDefinitions().get(String(name || "").trim()) ?? null;
}
