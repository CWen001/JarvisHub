import type { LLMAdapter } from "../llm/adapter.js";
import type { LLMResponse, ToolCall, ToolDefinition } from "../types/index.js";
import { compactMessagesForTurn, recordCompactionEvent, shouldRetryWithCompaction } from "./message-compaction.js";
import type { AgentSessionEngine } from "./session/session-engine.js";
import { sanitizeModelContext } from "./model-context-sanitizer.js";

const UNSUPPORTED_RESPONSES_OUTPUT_ERROR_CODE = "llm_unsupported_responses_output";

export async function executeAgentTurn(input: {
  client: LLMAdapter;
  session: AgentSessionEngine;
  system: string;
  tools: ToolDefinition[];
  modelOverride?: string;
  onTextDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
  onPartialFlush?: (partial: { text: string; toolCalls: ToolCall[] }) => void;
}): Promise<LLMResponse> {
  const preflight = compactMessagesForTurn({
    messages: input.session.getMessages(),
    kind: "preflight",
  });
  recordCompactionEvent(input.session.getRuntimeMeta(), preflight.event);
  const preflightContext = sanitizeModelContext({
    system: input.system,
    messages: preflight.messages,
  });
  try {
    return await input.client.call({
      system: preflightContext.system,
      messages: preflightContext.messages,
      tools: input.tools,
      ...(input.modelOverride ? { model: input.modelOverride } : {}),
      ...(input.onTextDelta ? { onTextDelta: input.onTextDelta } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      ...(input.onPartialFlush ? { onPartialFlush: input.onPartialFlush } : {}),
    });
  } catch (error) {
    if (!shouldRetryWithCompaction(error)) {
      if (shouldRetryUnsupportedHostedResponsesOutput(error)) {
        input.session.appendUserPrompt(
          buildUnsupportedHostedResponsesOutputRecoveryPrompt({
            error,
            tools: input.tools,
          }),
          true,
        );
        const recovery = compactMessagesForTurn({
          messages: input.session.getMessages(),
          kind: "recovery",
          preserveLastMessages: 8,
        });
        recordCompactionEvent(input.session.getRuntimeMeta(), recovery.event);
        const recoveryContext = sanitizeModelContext({
          system: input.system,
          messages: recovery.messages,
        });
        return input.client.call({
          system: recoveryContext.system,
          messages: recoveryContext.messages,
          tools: input.tools,
          ...(input.modelOverride ? { model: input.modelOverride } : {}),
          ...(input.onTextDelta ? { onTextDelta: input.onTextDelta } : {}),
          ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
          ...(input.onPartialFlush ? { onPartialFlush: input.onPartialFlush } : {}),
        });
      }
      throw error;
    }
    const recovery = compactMessagesForTurn({
      messages: preflightContext.messages,
      kind: "recovery",
      maxChars: Math.max(8_000, Math.trunc((preflight.event?.compactedChars ?? 24_000) * 0.7)),
      preserveLastMessages: 6,
    });
    recordCompactionEvent(input.session.getRuntimeMeta(), recovery.event);
    const recoveryContext = sanitizeModelContext({
      system: preflightContext.system,
      messages: recovery.messages,
    });
    return input.client.call({
      system: recoveryContext.system,
      messages: recoveryContext.messages,
      tools: input.tools,
      ...(input.modelOverride ? { model: input.modelOverride } : {}),
      ...(input.onTextDelta ? { onTextDelta: input.onTextDelta } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      ...(input.onPartialFlush ? { onPartialFlush: input.onPartialFlush } : {}),
    });
  }
}

function shouldRetryUnsupportedHostedResponsesOutput(error: unknown): boolean {
  const record = asErrorRecord(error);
  return record?.code === UNSUPPORTED_RESPONSES_OUTPUT_ERROR_CODE;
}

function buildUnsupportedHostedResponsesOutputRecoveryPrompt(input: {
  error: unknown;
  tools: ToolDefinition[];
}): string {
  const unsupportedOutputTypes = readUnsupportedOutputTypes(input.error);
  const toolNames = input.tools
    .map((tool) => tool.name.trim())
    .filter((name) => name.length > 0);
  return [
    "上一轮模型输出包含当前 runtime 不支持的 Responses hosted output，runtime 已丢弃该输出，不能把它视为完成。",
    `unsupportedOutputTypes: ${unsupportedOutputTypes.length > 0 ? unsupportedOutputTypes.join(", ") : "unknown"}`,
    "请在同一执行链内重新决策：只能输出 assistant 文本，或调用本轮 tools 数组中显式列出的 function tool。",
    `当前可用 function tools: ${toolNames.length > 0 ? toolNames.join(", ") : "none"}`,
    "如果用户目标需要生成图片、文件或其他资产，必须选择合适的显式 function tool 完成；如果没有合适工具，必须直接说明缺口和失败原因。禁止再次使用 Responses hosted output。",
  ].join("\n");
}

function readUnsupportedOutputTypes(error: unknown): string[] {
  const details = asErrorRecord(asErrorRecord(error)?.details);
  const rawTypes = details?.unsupportedOutputTypes;
  if (!Array.isArray(rawTypes)) return [];
  return rawTypes
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0);
}

function asErrorRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
