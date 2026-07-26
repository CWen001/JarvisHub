import type { ToolHandler } from "./registry.js";

/**
 * ask_user — turn-stopping user-question tool.
 *
 * Design contract:
 * - The LLM calls this tool when it needs a human decision that the agent
 *   cannot safely make on its own (conflicting references, destructive
 *   canvas rewrite, 2-strike evaluate failure, genuinely ambiguous intent,
 *   etc.). See AGENTS.md "No silent fallback" + canvas-eval 2-strike rule.
 * - The tool records the question into ctx.meta.pendingAskUser so hosts
 *   (http-server, CLI wrappers) can surface it as a structured event when
 *   they choose to. The tool itself never blocks or polls — it simply
 *   instructs the model to end the turn immediately with a clear question
 *   to the user. The natural turn boundary is the actual stop; the user's
 *   reply arrives as the next chat message.
 * - Fails loud on missing/empty question (consistent with the rest of the
 *   runtime: no silent fallback, no default stub text).
 */

const URGENCY_VALUES = ["info", "confirmation", "blocker"] as const;
type AskUserUrgency = (typeof URGENCY_VALUES)[number];

type AskUserOptionCard = {
  value: string;
  imageUrl: string;
  thumbnailUrl?: string;
  title?: string;
  displayValue?: string;
};

type AskUserRecord = {
  id: string;
  question: string;
  options: string[];
  optionCards: AskUserOptionCard[];
  urgency: AskUserUrgency;
  reason: string;
  contextSummary: string;
  askedAt: string;
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const trimmed = readString(item);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

function readOptionCards(value: unknown, limit: number): AskUserOptionCard[] {
  if (!Array.isArray(value)) return [];
  const out: AskUserOptionCard[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const valueText = readString(rec.value);
    const imageUrl = readString(rec.imageUrl);
    if (!valueText || !imageUrl || seen.has(valueText)) continue;
    seen.add(valueText);
    const card: AskUserOptionCard = { value: valueText, imageUrl };
    const thumb = readString(rec.thumbnailUrl);
    if (thumb) card.thumbnailUrl = thumb;
    const title = readString(rec.title);
    if (title) card.title = title;
    const displayValue = readString(rec.displayValue);
    if (displayValue) card.displayValue = displayValue;
    out.push(card);
    if (out.length >= limit) break;
  }
  return out;
}

function readUrgency(value: unknown): AskUserUrgency {
  const normalized = readString(value).toLowerCase();
  return (URGENCY_VALUES as readonly string[]).includes(normalized)
    ? (normalized as AskUserUrgency)
    : "confirmation";
}

function appendPendingAskUser(
  meta: Record<string, unknown> | undefined,
  record: AskUserRecord,
): void {
  if (!meta || typeof meta !== "object") return;
  const current = (meta as Record<string, unknown>).pendingAskUser;
  if (Array.isArray(current)) {
    current.push(record);
    return;
  }
  (meta as Record<string, unknown>).pendingAskUser = [record];
}

export const askUserTool: ToolHandler = {
  definition: {
    name: "ask_user",
    description: [
      "Ask the end user a clarifying or confirmation question and STOP the current turn.",
      "Use when the agent cannot safely proceed without a human decision: ambiguous intent, conflicting references,",
      "destructive canvas rewrite, 2-strike evaluate failure (same nodeId failed twice), or other irrecoverable states.",
      "Turn-stopping protocol: after calling this tool, emit your final assistant message containing the question",
      "verbatim for the user and DO NOT call any more tools this turn. Wait for the user's reply on the next turn.",
      "Fails loud when question is empty — never call with a placeholder.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "The exact question to show the user. Must be concrete, specific, and self-contained — avoid vague prompts like 'what do you want?'.",
          minLength: 1,
        },
        options: {
          type: "array",
          description:
            "Optional ordered list of concrete choices to present to the user (e.g. ['regenerate node X', 'pick reference A', 'cancel']). Max 8 items.",
          items: { type: "string" },
          maxItems: 8,
        },
        optionCards: {
          type: "array",
          description:
            "Optional ordered list of image-backed option cards. Each card has: value (choice text), imageUrl (REQUIRED, direct image URL for preview), thumbnailUrl (optional smaller thumbnail), title (optional label), displayValue (optional formatted text). Use this when showing visual style references so the user sees image thumbnails, not just text. Max 8 items.",
          items: {
            type: "object",
            properties: {
              value: { type: "string", description: "Choice identifier text." },
              imageUrl: { type: "string", description: "Direct image URL for preview display." },
              thumbnailUrl: { type: "string", description: "Optional smaller thumbnail URL." },
              title: { type: "string", description: "Optional label/title for the card." },
              displayValue: { type: "string", description: "Optional formatted display text." },
            },
            required: ["value", "imageUrl"],
            additionalProperties: false,
          },
          maxItems: 8,
        },
        urgency: {
          type: "string",
          description:
            "info: informational update awaiting low-stakes acknowledgement. confirmation (default): normal confirmation before proceeding. blocker: cannot proceed without user input (e.g. repeated failure).",
          enum: [...URGENCY_VALUES],
        },
        reason: {
          type: "string",
          description:
            "Short explanation of why the agent is asking rather than deciding autonomously. Used for diagnostics/trace, not shown verbatim to the user.",
        },
        contextSummary: {
          type: "string",
          description:
            "Optional compact recap of the current situation (e.g. 'regenerated nodeId=foo twice, both failed criterion-2'). Used for diagnostics/trace.",
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  async execute(args, ctx, toolCallId) {
    const question = readString(args.question);
    if (!question) {
      throw new Error("ask_user: question is required (non-empty).");
    }
    const options = readStringArray(args.options, 8);
    const optionCards = readOptionCards(args.optionCards, 8);
    const urgency = readUrgency(args.urgency);
    const reason = readString(args.reason);
    const contextSummary = readString(args.contextSummary);

    const record: AskUserRecord = {
      id: toolCallId,
      question,
      options,
      optionCards,
      urgency,
      reason,
      contextSummary,
      askedAt: new Date().toISOString(),
    };
    appendPendingAskUser(ctx.meta, record);

    const payload = {
      ok: true as const,
      status: "awaiting_user_reply" as const,
      protocol: [
        "END this turn immediately.",
        "Do NOT call any more tools this turn.",
        "Your final assistant message MUST contain the question verbatim (and the options list when provided).",
        "Wait for the user's reply on the next turn before resuming.",
      ].join(" "),
      question: record.question,
      options: record.options,
      optionCards: record.optionCards,
      urgency: record.urgency,
      ...(record.reason ? { reason: record.reason } : {}),
      ...(record.contextSummary ? { contextSummary: record.contextSummary } : {}),
      askedAt: record.askedAt,
    };
    const content = JSON.stringify(payload);
    return {
      toolCallId,
      content,
      payload: { text: content, structuredOutput: payload },
    };
  },
};

export type { AskUserRecord, AskUserUrgency };
