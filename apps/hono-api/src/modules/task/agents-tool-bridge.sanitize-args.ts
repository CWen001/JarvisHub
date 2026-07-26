/**
 * Canvas tool argument sanitization — the coordinate boundary.
 *
 * Coordinates are a layout-engine concern, never part of the agent contract
 * (single source of truth for coordinates). The canvas tool schemas no longer
 * expose `position`, so this boundary strips any residual coordinate from the
 * incoming tool args BEFORE zod validation — a stale or in-flight caller that
 * still sends one is tolerated (silently dropped) rather than rejected by the
 * strict schemas. The backend layout engine stays the only producer of {x, y}.
 */
export function stripAgentPositions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAgentPositions);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "position") continue;
      out[key] = stripAgentPositions(child);
    }
    return out;
  }
  return value;
}
