import type { Message } from "../types/index.js";

export type MessageCompactionEvent = {
  kind: "preflight" | "recovery";
  event: "context_compressed";
  originalMessageCount: number;
  compactedMessageCount: number;
  originalChars: number;
  compactedChars: number;
  preserveStartIndex: number;
  headProtectCount: number;
};

function readEnvInt(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.trunc(raw));
}

function estimateMessageChars(messages: Message[]): number {
  return messages.reduce((sum, message) => {
    const textChars = String(message.content || "").length;
    const toolChars = Array.isArray(message.toolCalls)
      ? message.toolCalls.reduce(
          (toolSum, toolCall) =>
            toolSum + String(toolCall.name || "").length + String(toolCall.arguments || "").length,
          0,
        )
      : 0;
    return sum + textChars + toolChars;
  }, 0);
}

function buildCompactionSummary(prefix: Message[]): string {
  const lines: string[] = [
    "<runtime_compaction_summary>",
    "Earlier conversation history was compacted to stay within runtime context budget.",
  ];
  const recent = prefix.slice(-12);
  for (const message of recent) {
    const role = String(message.role || "unknown").trim();
    const content = String(message.content || "").replace(/\s+/g, " ").trim();
    const preview = content.length > 220 ? `${content.slice(0, 220)}…` : content;
    const toolNames = Array.isArray(message.toolCalls)
      ? message.toolCalls.map((toolCall) => String(toolCall.name || "").trim()).filter(Boolean)
      : [];
    lines.push(`- ${role}: ${preview || "(empty)"}`);
    if (toolNames.length > 0) {
      lines.push(`  tools: ${toolNames.join(", ")}`);
    }
  }
  lines.push("</runtime_compaction_summary>");
  return lines.join("\n");
}

function buildAssistantToolCallIndex(messages: Message[]): Map<string, number> {
  const indexByToolCallId = new Map<string, number>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "assistant" || !Array.isArray(message.toolCalls)) continue;
    for (const toolCall of message.toolCalls) {
      const id = String(toolCall?.id || "").trim();
      if (!id || indexByToolCallId.has(id)) continue;
      indexByToolCallId.set(id, index);
    }
  }
  return indexByToolCallId;
}

type MessageRound = {
  startIndex: number;
  endIndex: number;
  messages: Message[];
};

function groupMessagesByApiRound(messages: Message[]): MessageRound[] {
  const groups: MessageRound[] = [];
  let current: Message[] = [];
  let currentStartIndex = 0;
  let seenAssistantInCurrentGroup = false;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === "assistant" && current.length > 0 && seenAssistantInCurrentGroup) {
      groups.push({
        startIndex: currentStartIndex,
        endIndex: index - 1,
        messages: current,
      });
      current = [message];
      currentStartIndex = index;
      seenAssistantInCurrentGroup = true;
      continue;
    }
    current.push(message);
    if (message?.role === "assistant") {
      seenAssistantInCurrentGroup = true;
    }
  }

  if (current.length > 0) {
    groups.push({
      startIndex: currentStartIndex,
      endIndex: messages.length - 1,
      messages: current,
    });
  }
  return groups;
}

function hasToolLinkedHistory(messages: Message[]): boolean {
  return messages.some(
    (message) =>
      message?.role === "tool" ||
      (message?.role === "assistant" &&
        Array.isArray(message.toolCalls) &&
        message.toolCalls.length > 0),
  );
}

function resolvePreserveStartIndex(messages: Message[], preserveLastMessages: number): number {
  const rounds = groupMessagesByApiRound(messages);
  const preserveLastRounds = Math.max(1, preserveLastMessages);
  const floorRoundIndex = Math.max(0, rounds.length - preserveLastRounds);
  const assistantToolCallIndex = buildAssistantToolCallIndex(messages);
  let preserveStartIndex =
    rounds[floorRoundIndex]?.startIndex ?? Math.max(0, messages.length - preserveLastMessages);
  for (let index = preserveStartIndex; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === "tool") {
      const toolCallId = String(message.toolCallId || "").trim();
      const linkedAssistantIndex = assistantToolCallIndex.get(toolCallId);
      if (typeof linkedAssistantIndex === "number") {
        preserveStartIndex = Math.min(preserveStartIndex, linkedAssistantIndex);
      } else {
        preserveStartIndex = Math.min(preserveStartIndex, index);
      }
      continue;
    }
    if (message?.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
      preserveStartIndex = Math.min(preserveStartIndex, index);
    }
  }
  if (preserveStartIndex === 0 && floorRoundIndex === 0 && rounds.length > 1) {
    if (!hasToolLinkedHistory(messages)) {
      return rounds[1]?.startIndex ?? 1;
    }
  }
  return preserveStartIndex;
}

function computeSafeHeadProtectCount(
  messages: Message[],
  requested: number,
  preserveStartIndex: number,
): number {
  const upper = Math.min(requested, Math.max(0, preserveStartIndex));
  if (upper <= 0) return 0;
  const toolIdsInHead = new Set<string>();
  const toolOutputIdsInHead = new Set<string>();
  for (let i = 0; i < upper; i += 1) {
    const message = messages[i];
    if (!message) continue;
    if (message.role === "assistant" && Array.isArray(message.toolCalls)) {
      for (const call of message.toolCalls) {
        const id = String(call?.id || "").trim();
        if (id) toolIdsInHead.add(id);
      }
    } else if (message.role === "tool") {
      const id = String(message.toolCallId || "").trim();
      if (id) toolOutputIdsInHead.add(id);
    }
  }
  let safeUpper = upper;
  for (const id of toolIdsInHead) {
    if (toolOutputIdsInHead.has(id)) continue;
    for (let i = 0; i < safeUpper; i += 1) {
      const message = messages[i];
      if (
        message?.role === "assistant" &&
        Array.isArray(message.toolCalls) &&
        message.toolCalls.some((call) => String(call?.id || "").trim() === id)
      ) {
        safeUpper = i;
        break;
      }
    }
  }
  for (const id of toolOutputIdsInHead) {
    if (toolIdsInHead.has(id)) continue;
    for (let i = 0; i < safeUpper; i += 1) {
      const message = messages[i];
      if (message?.role === "tool" && String(message.toolCallId || "").trim() === id) {
        safeUpper = i;
        break;
      }
    }
  }
  return Math.max(0, safeUpper);
}

export function compactMessagesForTurn(input: {
  messages: Message[];
  kind: MessageCompactionEvent["kind"];
  maxChars?: number;
  preserveLastMessages?: number;
  headProtect?: number;
}): { messages: Message[]; event: MessageCompactionEvent | null } {
  const maxChars = input.maxChars ?? readEnvInt("AGENTS_MESSAGE_HISTORY_MAX_CHARS", 45_000);
  const preserveLastMessages = input.preserveLastMessages ?? readEnvInt("AGENTS_MESSAGE_HISTORY_PRESERVE_MESSAGES", 10);
  const headProtect = Math.max(
    0,
    input.headProtect ?? readEnvInt("AGENTS_COMPRESS_HEAD_PROTECT", 4),
  );
  const originalChars = estimateMessageChars(input.messages);
  if (originalChars <= maxChars) {
    return { messages: input.messages, event: null };
  }
  const preserveStartIndex = resolvePreserveStartIndex(input.messages, preserveLastMessages);
  if (preserveStartIndex <= 0) {
    return { messages: input.messages, event: null };
  }
  const effectiveHeadProtect = computeSafeHeadProtectCount(
    input.messages,
    headProtect,
    preserveStartIndex,
  );
  const head = input.messages.slice(0, effectiveHeadProtect);
  const middle = input.messages.slice(effectiveHeadProtect, preserveStartIndex);
  if (middle.length === 0) {
    return { messages: input.messages, event: null };
  }
  const suffix = input.messages.slice(preserveStartIndex);
  const compactedMessages: Message[] = [
    ...head,
    {
      role: "user",
      content: buildCompactionSummary(middle),
      ephemeral: true,
    },
    ...suffix,
  ];
  const compactedChars = estimateMessageChars(compactedMessages);
  return {
    messages: compactedMessages,
    event: {
      kind: input.kind,
      event: "context_compressed",
      originalMessageCount: input.messages.length,
      compactedMessageCount: compactedMessages.length,
      originalChars,
      compactedChars,
      preserveStartIndex,
      headProtectCount: effectiveHeadProtect,
    },
  };
}

export function shouldRetryWithCompaction(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  if (
    normalized.includes("request too large") ||
    normalized.includes("context length") ||
    normalized.includes("context_length_exceeded") ||
    normalized.includes("context window") ||
    normalized.includes("maximum context") ||
    normalized.includes("too many tokens") ||
    normalized.includes("prompt too long") ||
    normalized.includes("413")
  ) {
    return true;
  }
  const code = readErrorCode(error);
  if (code === "llm_http_413" || code === "llm_http_400") {
    return normalized.includes("context") || normalized.includes("too large") || normalized.includes("too many");
  }
  return false;
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function recordCompactionEvent(
  meta: Record<string, unknown> | undefined,
  event: MessageCompactionEvent | null,
): void {
  if (!meta || !event) return;
  const current = Array.isArray(meta.compactionEvents)
    ? meta.compactionEvents.filter((item) => item && typeof item === "object" && !Array.isArray(item))
    : [];
  meta.compactionEvents = [...current, event].slice(-8);
}
