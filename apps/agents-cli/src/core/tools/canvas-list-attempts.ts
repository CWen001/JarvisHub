import type { ToolHandler } from "./registry.js";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export const listAttemptsTool: ToolHandler = {
  definition: {
    name: "canvas_list_attempts",
    description:
      "Read the in-memory canvas generation attempts recorded during this session (image/video generations per nodeId). Status values are submitted, completed, failed, or timed_out; only completed has a final URL. Use BEFORE a retry to check the 2-strike rule: if the same nodeId already has two failed attempts, call ask_user instead of retrying a third time.",
    parameters: {
      type: "object",
      properties: {
        nodeId: {
          type: "string",
          description: "Optional: filter to a single nodeId.",
        },
      },
      additionalProperties: false,
    },
  },
  isReadOnly: true,
  isConcurrencySafe: () => true,
  async execute(args, ctx, toolCallId) {
    const filter = readString(args.nodeId);
    const attempts = filter
      ? ctx.state.attempts.filter((entry) => entry.nodeId === filter)
      : ctx.state.attempts.slice();
    const summary = {
      ok: true as const,
      count: attempts.length,
      attempts,
    };
    return {
      toolCallId,
      content: JSON.stringify(summary),
      payload: { text: JSON.stringify(summary), structuredOutput: summary },
    };
  },
};
