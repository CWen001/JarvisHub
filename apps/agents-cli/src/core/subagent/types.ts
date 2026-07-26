import type { AgentDefinition } from "../../types/index.js";
import {
  getActiveAgentDefinitions,
  getAgentDefinition,
} from "./definitions.js";

type GetToolsForAgentOptions = {
  availableTools?: Iterable<string>;
};

export type AgentType = string;

export function getAgentDefinitions(): Record<string, AgentDefinition> {
  return Object.fromEntries(getActiveAgentDefinitions().entries());
}

export const AGENT_TYPES: Record<string, AgentDefinition> = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      return getAgentDefinition(prop) ?? undefined;
    },
    ownKeys() {
      return Array.from(getActiveAgentDefinitions().keys());
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const value = getAgentDefinition(prop);
      if (!value) return undefined;
      return {
        enumerable: true,
        configurable: true,
        value,
      };
    },
  },
);

export function getAgentDescriptions(): string {
  return Array.from(getActiveAgentDefinitions().values())
    .map((cfg) => `- ${cfg.name}: ${cfg.description}`)
    .join("\n");
}

export function getAgentTypeNames(): AgentType[] {
  return Array.from(getActiveAgentDefinitions().keys());
}

function expandWildcardTools(
  declared: string[],
  availableTools: string[] | null,
  disallowed: string[]
): string[] {
  const positives: string[] = [];
  const negatives = new Set<string>();
  for (const item of declared) {
    const trimmed = String(item || "").trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("!")) {
      const name = trimmed.slice(1).trim();
      if (name) negatives.add(name);
      continue;
    }
    positives.push(trimmed);
  }
  for (const item of disallowed) {
    const trimmed = String(item || "").trim();
    if (trimmed) negatives.add(trimmed);
  }
  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const item of positives) {
    if (item === "*") {
      if (!availableTools) continue;
      for (const name of availableTools) {
        if (!seen.has(name)) {
          seen.add(name);
          expanded.push(name);
        }
      }
      continue;
    }
    if (!seen.has(item)) {
      seen.add(item);
      expanded.push(item);
    }
  }
  return expanded.filter((name) => !negatives.has(name));
}

export function getToolsForAgent(agentType: AgentType, options?: GetToolsForAgentOptions): Set<string> {
  const definition = getAgentDefinition(agentType);
  const baseTools = definition?.tools ?? [];
  const disallowedTools = definition?.disallowedTools ?? [];
  const availableTools = options?.availableTools ? Array.from(options.availableTools) : null;
  return new Set(expandWildcardTools(baseTools, availableTools, disallowedTools));
}

export function getMissingDeclaredTools(
  agentType: AgentType,
  availableTools: Iterable<string>,
): string[] {
  const definition = getAgentDefinition(agentType);
  if (!definition) return [];
  const available = new Set<string>();
  for (const name of availableTools) {
    const trimmed = String(name || "").trim();
    if (trimmed) available.add(trimmed);
  }
  const declared = definition.tools ?? [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const item of declared) {
    const trimmed = String(item || "").trim();
    if (!trimmed || trimmed === "*" || trimmed.startsWith("!")) continue;
    if (available.has(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    missing.push(trimmed);
  }
  return missing;
}

export function getSystemPromptForAgent(agentType: AgentType): string {
  return String(getAgentDefinition(agentType)?.prompt || "").trim();
}

export function isAgentType(value: string): value is AgentType {
  return getActiveAgentDefinitions().has(String(value || "").trim());
}
