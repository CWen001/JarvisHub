import { buildHarnessSystemOverride, type AgentHarnessName } from "../core/root-persona.js";

export type { AgentHarnessName };

export function buildRuntimeSystemOverride(harness: AgentHarnessName): string {
  return buildHarnessSystemOverride(harness);
}
