import { randomUUID } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { AgentConfig, LLMRequest, LLMResponse, Message, ToolCall, ToolDefinition } from "../types/index.js";
import { normalizeToolOutput } from "../core/message-limits.js";
import type { LLMAdapter } from "./adapter.js";
import { ALLOWED_INLINE_IMAGE_MIME, fetchInlineMediaData, shouldInlineForCloudModel } from "./inline-media.js";
import { createNativeVideoInputUnsupportedError } from "./video-input.js";
import { redactInlineMediaData } from "./payload-redaction.js";
import { wireTraceFetch, type WireTraceClientKind } from "./wire-trace-fetch.js";

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } };

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ChatContentPart[];
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

type JsonObject = Record<string, unknown>;

type ResponsesContentPart = {
  type?: unknown;
  text?: unknown;
  refusal?: unknown;
};

type ResponsesOutputItem = {
  id?: unknown;
  type?: unknown;
  text?: unknown;
  refusal?: unknown;
  status?: unknown;
  result?: unknown;
  name?: unknown;
  call_id?: unknown;
  arguments?: unknown;
  function?: {
    id?: unknown;
    name?: unknown;
    arguments?: unknown;
  };
  content?: ResponsesContentPart[];
  tool_calls?: ResponsesOutputItem[];
  role?: unknown;
};

type EventStreamState = {
  output?: ResponsesOutputItem[];
  output_text?: string;
  response?: JsonObject;
} & JsonObject;

type LlmRequestMessageSummary = {
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolMessageCount: number;
  assistantToolCallCount: number;
  totalMessageChars: number;
  userMessageChars: number;
  assistantMessageChars: number;
  toolMessageChars: number;
  maxSingleMessageChars: number;
  maxToolMessageChars: number;
  toolMessagesOver16k: number;
  largestToolMessages: Array<{
    toolCallId: string;
    chars: number;
  }>;
};

type LlmRequestToolDefinitionSummary = {
  toolDefinitionChars: number;
  maxToolDefinitionChars: number;
  toolDefinitionsOver16k: number;
  largestToolDefinitions: Array<{
    name: string;
    chars: number;
  }>;
};

type LlmRequestSummary = LlmRequestMessageSummary & {
  apiStyle: "chat" | "responses";
  url: string;
  model: string;
  retry: number;
  stream: boolean;
  systemChars: number;
  toolDefinitions: number;
  approxPayloadChars: number;
  inputItems?: number;
} & LlmRequestToolDefinitionSummary;

type ResponseBodyApiStyle = "chat" | "responses";

type EventStreamParser = {
  pushLine(line: string): void;
  finish(): Record<string, unknown>;
};

type SafeFetchResult = {
  response: Response;
  signal?: AbortSignal;
  cleanup: () => void;
};

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asOutputItems(value: unknown): ResponsesOutputItem[] {
  return Array.isArray(value) ? value.filter((item): item is ResponsesOutputItem => Boolean(asObject(item))) : [];
}

function looksLikeEventStreamPayload(text: string): boolean {
  const start = text.replace(/^\uFEFF/, "").trimStart().toLowerCase();
  return (
    start.startsWith("event:") ||
    start.startsWith("data:") ||
    start.startsWith("id:") ||
    start.startsWith("retry:") ||
    start.startsWith(":")
  );
}

let dnsConfigured = false;
const DEFAULT_AGENTS_REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_AGENTS_FETCH_RETRIES = 1;

function normalizeEndpointUrl(value: string): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

function buildChatCompletionsUrl(apiBaseUrl: string): string {
  const base = normalizeEndpointUrl(apiBaseUrl);
  if (!base) return base;
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

function buildResponsesUrl(apiBaseUrl: string): string {
  const base = normalizeEndpointUrl(apiBaseUrl);
  if (!base) return base;
  if (/\/responses$/i.test(base)) return base;
  return `${base}/responses`;
}

async function resolveOpenAiImageUrlForModel(rawUrl: string, abortSignal?: AbortSignal): Promise<string> {
  const url = String(rawUrl || "").trim();
  if (!url || /^data:image\//i.test(url)) return url;
  if (!shouldInlineForCloudModel(url)) return url;
  const inline = await fetchInlineMediaData({
    rawUrl: url,
    allowedMimeTypes: ALLOWED_INLINE_IMAGE_MIME,
    maxBytes: readOpenAiImageInlineMaxBytes(),
    timeoutMs: readOpenAiImageInlineTimeoutMs(),
    abortSignal,
    label: "OpenAI-compatible image",
  });
  return inline.dataUrl;
}

function readOpenAiImageInlineTimeoutMs(): number {
  return Math.max(
    1_000,
    Math.min(parsePositiveInt(process.env.AGENTS_OPENAI_IMAGE_INLINE_TIMEOUT_MS, 15_000), 120_000),
  );
}

function readOpenAiImageInlineMaxBytes(): number {
  return Math.max(
    64 * 1024,
    Math.min(parsePositiveInt(process.env.AGENTS_OPENAI_IMAGE_INLINE_MAX_BYTES, 20 * 1024 * 1024), 80 * 1024 * 1024),
  );
}

export class LLMClient implements LLMAdapter {
  private responsesInstructionsKey: "instructions" | "system" = "instructions";
  private responsesToolOutputType: "function_call_output" | "tool_result" = "function_call_output";
  private readonly wireTraceClientKind: WireTraceClientKind;

  constructor(private config: AgentConfig, wireTraceClientKind?: WireTraceClientKind) {
    this.wireTraceClientKind = wireTraceClientKind ?? (config.apiStyle === "chat" ? "openai-chat" : "responses");
    configureDnsResultOrderOnce();
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    const apiStyle = this.config.apiStyle;
    if (apiStyle === "chat") {
      return this.callChat(request);
    }
    return this.callResponses(request);
  }

  private resolveModel(request: LLMRequest): string {
    const requestModel = typeof request.model === "string" ? request.model.trim() : "";
    return requestModel || this.config.model;
  }

  private async buildChatMessages(messages: Message[], abortSignal?: AbortSignal): Promise<ChatMessage[]> {
    const out: ChatMessage[] = [];
    for (const m of messages) {
      const content: string | ChatContentPart[] =
        Array.isArray(m.contentParts) && m.contentParts.length > 0
          ? await Promise.all(m.contentParts.map(async (part): Promise<ChatContentPart> => {
              if (part.type === "image_url") {
                return { type: "image_url", image_url: { url: await resolveOpenAiImageUrlForModel(part.imageUrl, abortSignal) } };
              }
              if (part.type === "media_url") {
                return { type: "video_url", video_url: { url: part.mediaUrl } };
              }
              return { type: "text", text: part.text };
            }))
          : m.content;
      const msg: ChatMessage = {
        role: m.role,
        content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      };
      if (m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls
          .filter((call) => Boolean(call?.name))
          .map((call) => ({
            id: call.id ?? randomUUID(),
            type: "function" as const,
            function: {
              name: call.name,
              arguments: call.arguments ?? "{}",
            },
          }));
      }
      out.push(msg);
    }
    return out;
  }

  private async buildResponsesInput(messages: Message[], abortSignal?: AbortSignal) {
    const items: JsonObject[] = [];
    for (const m of messages) {
      if (m.role === "tool") {
        items.push(this.buildResponsesToolOutputItem(m));
        continue;
      }

      if (Array.isArray(m.contentParts) && m.contentParts.length > 0) {
        const parts: JsonObject[] = [];
        for (const part of m.contentParts) {
          if (part.type === "image_url") {
            parts.push({ type: "input_image", image_url: await resolveOpenAiImageUrlForModel(part.imageUrl, abortSignal) });
            continue;
          }
          if (part.type === "media_url") {
            throw createNativeVideoInputUnsupportedError("openai-responses");
          }
          parts.push({ type: m.role === "assistant" ? "output_text" : "input_text", text: part.text });
        }
        items.push({
          type: "message",
          role: m.role,
          content: parts,
        });
      } else if (m.content) {
        const contentType = m.role === "assistant" ? "output_text" : "input_text";
        items.push({
          type: "message",
          role: m.role,
          content: [{ type: contentType, text: m.content }],
        });
      }

      if (m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
        for (const call of m.toolCalls) {
          if (!call?.name) continue;
          items.push(this.buildResponsesToolCallItem(call));
        }
      }
    }
    return items;
  }

  private buildResponsesToolCallItem(call: ToolCall) {
    if (this.responsesToolOutputType === "function_call_output") {
      return {
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: call.arguments ?? "{}",
      };
    }
    return {
      type: "tool_call",
      id: call.id,
      name: call.name,
      arguments: call.arguments ?? "{}",
    };
  }

  private buildResponsesToolOutputItem(m: Message) {
    const toolCallId = m.toolCallId || randomUUID();
    const output = normalizeToolOutput(m.content, `tool-call:${toolCallId}`);
    if (this.responsesToolOutputType === "function_call_output") {
      return {
        type: "function_call_output",
        call_id: toolCallId,
        output,
      };
    }
    return {
      type: "tool_result",
      tool_call_id: toolCallId,
      content: [{ type: "output_text", text: output }],
    };
  }

  private toChatTools(tools: ToolDefinition[]) {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  private toResponsesTools(tools: ToolDefinition[]) {
    return tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  private async callChat(request: LLMRequest, retry = 0): Promise<LLMResponse> {
    assertToolLinkage(request.messages);
    const toolLinkage = summarizeToolLinkage(request.messages);
    const resolvedModel = this.resolveModel(request);
    const requestUrl = buildChatCompletionsUrl(this.config.apiBaseUrl);
    const payload = {
      model: resolvedModel,
      messages: [{ role: "system", content: request.system }, ...(await this.buildChatMessages(request.messages, request.abortSignal))],
      tools: this.toChatTools(request.tools),
      stream: this.config.stream,
    };
    const requestSummary = buildLlmRequestSummary({
      apiStyle: "chat",
      url: requestUrl,
      model: resolvedModel,
      retry,
      stream: this.config.stream,
      systemChars: String(request.system || "").length,
      messages: request.messages,
      toolDefinitions: payload.tools.length,
      payload,
    });
    this.debugLog("chat.request", {
      ...requestSummary,
      messages: payload.messages.length,
      toolLinkage,
      payloadPreview: shouldLogPayload()
        ? safePreview(payload).slice(0, 4000)
        : undefined,
    });

    let fetched: SafeFetchResult;
    try {
      fetched = await this.safeFetch(requestUrl, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
        ...(request.abortSignal ? { signal: request.abortSignal } : {}),
      });
    } catch (error) {
      throw attachRequestSummaryToError(error, requestSummary);
    }

    try {
      const res = fetched.response;
      if (!res.ok) {
        const text = await readResponseTextWithAbort(res, fetched.signal);
        if (isRetryableHttpStatus(res.status) && retry < 2) {
          await sleep(500 * (retry + 1));
          return this.callChat(request, retry + 1);
        }
        throw createHttpStatusError({
          status: res.status,
          bodyText: text,
          requestSummary,
        });
      }

      const accumulatedTextParts: string[] = [];
      const wrappedDelta = (delta: string) => {
        accumulatedTextParts.push(delta);
        request.onTextDelta?.(delta);
      };
      let json: Record<string, unknown>;
      try {
        json = asObject(await this.parseResponseBody(res, wrappedDelta, {
          apiStyle: "chat",
          streamRequested: this.config.stream,
          abortSignal: fetched.signal,
        })) ?? {};
      } catch (parseErr) {
        if (request.onPartialFlush) {
          const e = parseErr as { name?: string; cause?: { name?: string } };
          const isAbort = e?.name === "AbortError" || e?.cause?.name === "AbortError";
          if (isAbort) {
            try {
              request.onPartialFlush({ text: accumulatedTextParts.join(""), toolCalls: [] });
            } catch {
              // never let partial-flush failure mask the original abort
            }
          }
        }
        throw parseErr;
      }
      const choices = Array.isArray(json.choices) ? json.choices : [];
      const firstChoice = asObject(choices[0]);
      const choiceMessage = asObject(firstChoice?.message);
      const rawToolCalls = Array.isArray(choiceMessage?.tool_calls)
        ? choiceMessage.tool_calls
        : [];
      this.debugLog("chat.response", {
        model: this.config.model,
        hasChoices: Array.isArray(json?.choices) && json.choices.length > 0,
        choiceCount: Array.isArray(json?.choices) ? json.choices.length : 0,
        rawToolCallCount: rawToolCalls.length,
        rawToolCallIds: rawToolCalls
          .map((call) => {
            const record = asObject(call);
            const fn = asObject(record?.function);
            return String(record?.id ?? record?.call_id ?? fn?.id ?? "").trim();
          })
          .filter(Boolean),
      });
      const text = asString(choiceMessage?.content);
      const toolCalls = this.parseChatToolCalls(rawToolCalls);
      this.debugLog("chat.response.tool_calls.normalized", {
        normalizedCount: toolCalls.length,
        normalizedIds: toolCalls.map((call) => call.id),
        normalizedNames: toolCalls.map((call) => call.name),
      });

      return { text, toolCalls };
    } finally {
      fetched.cleanup();
    }
  }

  private async callResponses(request: LLMRequest, retry = 0): Promise<LLMResponse> {
    assertToolLinkage(request.messages);
    const resolvedModel = this.resolveModel(request);
    const upstreamStream = true;
    const requestUrl = buildResponsesUrl(this.config.apiBaseUrl);
    const payload: JsonObject = {
      model: resolvedModel,
      store: false,
      input: await this.buildResponsesInput(request.messages, request.abortSignal),
      tools: this.toResponsesTools(request.tools),
      stream: upstreamStream,
    };

    const reasoningEffort = String(process.env.AGENTS_REASONING_EFFORT || "").trim();
    if (reasoningEffort) {
      payload.reasoning = { effort: reasoningEffort };
    }

    if (request.system) {
      if (this.responsesInstructionsKey === "instructions") {
        payload.instructions = request.system;
      } else {
        payload.system = request.system;
      }
    }
    const requestSummary = buildLlmRequestSummary({
      apiStyle: "responses",
      url: requestUrl,
      model: resolvedModel,
      retry,
      stream: upstreamStream,
      systemChars: String(request.system || "").length,
      messages: request.messages,
      toolDefinitions: Array.isArray(payload.tools) ? payload.tools.length : 0,
      payload,
      inputItems: Array.isArray(payload.input) ? payload.input.length : 0,
    });
    this.debugLog("responses.request", {
      ...requestSummary,
      instructionsKey: this.responsesInstructionsKey,
      toolOutputType: this.responsesToolOutputType,
      payloadPreview: shouldLogPayload()
        ? safePreview(payload).slice(0, 4000)
        : undefined,
    });

    let fetched: SafeFetchResult;
    try {
      fetched = await this.safeFetch(requestUrl, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
        ...(request.abortSignal ? { signal: request.abortSignal } : {}),
      });
    } catch (error) {
      throw attachRequestSummaryToError(error, requestSummary);
    }

    try {
    const res = fetched.response;
    if (!res.ok) {
      const text = await readResponseTextWithAbort(res, fetched.signal);
      if (isRetryableHttpStatus(res.status) && retry < 2) {
        await sleep(500 * (retry + 1));
        return this.callResponses(request, retry + 1);
      }
      if (res.status === 400 && retry < 2) {
        if (request.system && text.includes("Unsupported parameter: system") && this.responsesInstructionsKey === "system") {
          this.responsesInstructionsKey = "instructions";
          return this.callResponses(request, retry + 1);
        }
        if (request.system && text.includes("Unsupported parameter: instructions") && this.responsesInstructionsKey === "instructions") {
          this.responsesInstructionsKey = "system";
          return this.callResponses(request, retry + 1);
        }

        if (
          (text.includes("Unsupported type") || text.includes("Invalid type")) &&
          (text.includes("function_call_output") || text.includes("call_id")) &&
          this.responsesToolOutputType === "tool_result"
        ) {
          this.responsesToolOutputType = "function_call_output";
          return this.callResponses(request, retry + 1);
        }
        if (
          (text.includes("Unsupported type") || text.includes("Invalid type")) &&
          (text.includes("tool_result") || text.includes("tool_call_id")) &&
          this.responsesToolOutputType === "function_call_output"
        ) {
          this.responsesToolOutputType = "tool_result";
          return this.callResponses(request, retry + 1);
        }
      }
      throw createHttpStatusError({
        status: res.status,
        bodyText: text,
        requestSummary,
      });
    }

    const accumulatedTextParts: string[] = [];
    const wrappedDelta = (delta: string) => {
      accumulatedTextParts.push(delta);
      request.onTextDelta?.(delta);
    };
    let json: Record<string, unknown>;
    try {
      const initialJson = (await this.parseResponseBody(res, wrappedDelta, {
        apiStyle: "responses",
        streamRequested: upstreamStream,
        abortSignal: fetched.signal,
      })) as Record<string, unknown>;
      json = await this.resolveResponsesLifecycle(initialJson, {
        abortSignal: fetched.signal,
      });
    } catch (parseErr) {
      if (request.onPartialFlush) {
        const e = parseErr as { name?: string; cause?: { name?: string } };
        const isAbort = e?.name === "AbortError" || e?.cause?.name === "AbortError";
        if (isAbort) {
          try {
            request.onPartialFlush({ text: accumulatedTextParts.join(""), toolCalls: [] });
          } catch {
            // never let partial-flush failure mask the original abort
          }
        }
      }
      throw parseErr;
    }
    this.debugLog("responses.response", {
      model: this.config.model,
      status: String((json as Record<string, unknown>)?.status || ""),
      outputItems: Array.isArray((json as Record<string, unknown>)?.output)
        ? (((json as Record<string, unknown>).output as unknown[]) || []).length
        : 0,
      outputTextChars:
        typeof (json as Record<string, unknown>)?.output_text === "string"
          ? String((json as Record<string, unknown>).output_text).length
          : 0,
    });
    if (json?.error) {
      const errObj = (json as { error?: unknown }).error;
      const errCode = asString(asObject(errObj)?.code).toLowerCase();
      const errMessage = asString(asObject(errObj)?.message).toLowerCase();
      const isRateLimited =
        errCode === "rate_limit_exceeded" ||
        errCode === "rate_limit" ||
        errCode === "concurrency_limit_exceeded" ||
        errMessage.includes("rate limit") ||
        errMessage.includes("concurrency limit");
      // Treat transient upstream/overload errors as retryable. These come back
      // as a structured `{error}` body (so the HTTP layer is 200/4xx) and were
      // previously thrown after the first hit, which led to user-visible
      // failures whenever the vendor or OpenAI was momentarily overloaded.
      const isTransientUpstream =
        errCode === "server_is_overloaded" ||
        errCode === "overloaded" ||
        errCode === "upstream_error" ||
        errCode === "upstream_timeout" ||
        errCode === "service_unavailable" ||
        errCode === "internal_server_error" ||
        errCode === "internal_error" ||
        errCode === "timeout" ||
        errCode === "bad_gateway" ||
        errCode === "gateway_timeout" ||
        errMessage.includes("overloaded") ||
        errMessage.includes("upstream request failed") ||
        errMessage.includes("upstream timeout") ||
        errMessage.includes("temporarily unavailable") ||
        errMessage.includes("try again later") ||
        errMessage.includes("bad gateway") ||
        errMessage.includes("gateway timeout") ||
        errMessage.includes("service unavailable");
      if ((isRateLimited || isTransientUpstream) && retry < 5) {
        // Exponential backoff with jitter, capped at 20s. Upstream incidents
        // typically clear within 1-2 retries; keep the wall-clock cost bounded
        // so we don\'t make the user wait too long if it never recovers.
        const baseMs = isRateLimited ? 2000 : 1500;
        const backoffMs = Math.min(20000, baseMs * Math.pow(2, retry));
        const jitterMs = Math.floor(Math.random() * 400);
        // eslint-disable-next-line no-console
        console.warn(
          `[llm.callResponses] retryable ${isRateLimited ? "rate-limit" : "upstream"} error code=${errCode || "(none)"} retry=${
            retry + 1
          }/5 backoffMs=${backoffMs + jitterMs}`,
        );
        await sleep(backoffMs + jitterMs);
        return this.callResponses(request, retry + 1);
      }
      throw new Error(`LLM 返回错误: ${safePreview(json.error)}`);
    }
    const output = asOutputItems(json.output);

    if (output.some((item) => item.type === "function_call")) {
      this.responsesToolOutputType = "function_call_output";
    } else if (output.some((item) => item.type === "tool_call")) {
      this.responsesToolOutputType = "tool_result";
    }

    const unsupportedHostedOutputTypes = collectUnsupportedHostedOutputTypes(output);
    if (unsupportedHostedOutputTypes.length > 0) {
      throw createUnsupportedResponsesOutputError({
        output,
        unsupportedOutputTypes: unsupportedHostedOutputTypes,
        requestSummary,
      });
    }

    const toolCalls = this.parseResponsesToolCalls(output);
    const extractedText = this.extractResponsesText(output);
    const outputText = typeof json.output_text === "string" ? json.output_text : "";
    const text = extractedText || outputText || "";

    if (!text && toolCalls.length === 0) {
      const status = String((json as Record<string, unknown>)?.status || "").trim().toLowerCase();
      const inProgressRetryMax = parsePositiveInt(process.env.AGENTS_RESPONSES_IN_PROGRESS_RETRIES, 3);
      if ((status === "in_progress" || status === "queued" || status === "processing") && retry < inProgressRetryMax) {
        await sleep(1200 * (retry + 1));
        return this.callResponses(request, retry + 1);
      }
      const preview = safePreview(summarizeResponsesDiagnostic(json, output));
      const outputTypes = readResponsesOutputTypes(output);
      throw new Error(`LLM 返回空响应: outputTypes=${JSON.stringify(outputTypes)} preview=${preview}`);
    }

    return { text, toolCalls };
    } finally {
      fetched.cleanup();
    }
  }

  private async resolveResponsesLifecycle(
    initial: Record<string, unknown>,
    options?: {
      pollBaseUrl?: string;
      pollPathPrefix?: string;
      headers?: Record<string, string>;
      abortSignal?: AbortSignal;
    },
  ): Promise<Record<string, unknown>> {
    const status = String(initial.status || "").trim().toLowerCase();
    const id = String(initial.id || "").trim();
    const hasOutput = Array.isArray(initial.output) && initial.output.length > 0;
    const hasOutputText =
      typeof initial.output_text === "string" && initial.output_text.trim().length > 0;

    if (!id || hasOutput || hasOutputText) return initial;
    if (status === "completed" || status === "failed" || status === "cancelled") return initial;
    if (status !== "in_progress" && status !== "queued" && status !== "processing") return initial;

    // Some gateways return an in_progress shell object first; poll by id for final content.
    const timeoutMs = parsePositiveInt(process.env.AGENTS_RESPONSES_POLL_TIMEOUT_MS, 45_000);
    const intervalMs = parsePositiveInt(process.env.AGENTS_RESPONSES_POLL_INTERVAL_MS, 800);
    const deadline = Date.now() + timeoutMs;
    let latest: Record<string, unknown> = initial;

    while (Date.now() < deadline) {
      throwIfAborted(options?.abortSignal);
      await sleep(intervalMs);
      let fetched: SafeFetchResult | null = null;
      try {
        const base = String(options?.pollBaseUrl || this.config.apiBaseUrl || "").replace(/\/+$/, "");
        const prefix = String(options?.pollPathPrefix || "/responses").replace(/\/+$/, "");
        fetched = await this.safeFetch(`${base}${prefix}/${encodeURIComponent(id)}`, {
          method: "GET",
          headers: options?.headers ?? this.buildHeaders(),
          ...(options?.abortSignal ? { signal: options.abortSignal } : {}),
        });
      } catch {
        continue;
      }
      const res = fetched.response;
      if (!res.ok) {
        fetched.cleanup();
        continue;
      }
      try {
        const polled = (await this.parseResponseBody(res, undefined, {
          apiStyle: "responses",
          streamRequested: false,
          abortSignal: fetched.signal,
        })) as Record<string, unknown>;
        latest = polled;
        const polledStatus = String(polled.status || "").trim().toLowerCase();
        const polledHasOutput = Array.isArray(polled.output) && polled.output.length > 0;
        const polledHasOutputText =
          typeof polled.output_text === "string" && polled.output_text.trim().length > 0;

        if (polledHasOutput || polledHasOutputText) return polled;
        if (polledStatus === "completed" || polledStatus === "failed" || polledStatus === "cancelled") {
          return polled;
        }
      } finally {
        fetched.cleanup();
      }
    }

    return latest;
  }

  private async safeFetch(url: string, init: RequestInit): Promise<SafeFetchResult> {
    const timeoutMs = parseTimeoutMs(process.env.AGENTS_REQUEST_TIMEOUT_MS);
    const retries = parseRetryCount(process.env.AGENTS_FETCH_RETRIES);
    let lastError: unknown;
    const candidateUrls = buildCandidateUrls(url);

    for (const requestUrl of candidateUrls) {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const signal = buildFetchAbortSignal(timeoutMs, init.signal ?? null);
        let returnedResponse = false;
        try {
          const initWithSignal: RequestInit = signal.signal
            ? { ...init, signal: signal.signal }
            : { ...init };
          const response = await wireTraceFetch(this.wireTraceClientKind, requestUrl, initWithSignal);
          returnedResponse = true;
          return {
            response,
            signal: signal.signal,
            cleanup: signal.cleanup,
          };
        } catch (error) {
          lastError = error;
          if (!isRetryableFetchError(error) || attempt >= retries) {
            break;
          }
          const code = asString(asObject(asObject(error)?.cause)?.code);
          const isConnectIssue =
            code === "ETIMEDOUT" ||
            code === "UND_ERR_CONNECT_TIMEOUT" ||
            code === "ECONNRESET" ||
            code === "EAI_AGAIN";
          const backoffMs = isConnectIssue
            ? Math.min(15000, 1500 * (attempt + 1))
            : Math.min(1200, 250 * (attempt + 1));
          await sleep(backoffMs);
        } finally {
          if (!returnedResponse) signal.cleanup();
        }
      }
    }

    throw wrapFetchError(lastError, url, this.config.apiBaseUrl, timeoutMs, retries);
  }

  private extractResponsesText(output: ResponsesOutputItem[]): string {
    const chunks: string[] = [];
    for (const item of output) {
      if (item.type === "output_text" && typeof item.text === "string") {
        chunks.push(item.text);
        continue;
      }
      if (item.type === "text" && typeof item.text === "string") {
        chunks.push(item.text);
        continue;
      }
      if (item.type === "refusal" && typeof item.refusal === "string") {
        chunks.push(item.refusal);
        continue;
      }
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === "output_text" || part.type === "text") {
            if (typeof part.text === "string") {
              chunks.push(part.text);
            }
          }
          if (part.type === "refusal") {
            const refusal = typeof part.refusal === "string" ? part.refusal : typeof part.text === "string" ? part.text : "";
            if (refusal) chunks.push(refusal);
          }
        }
      }
    }
    return chunks.join("");
  }

  private parseResponsesToolCalls(output: ResponsesOutputItem[]): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const item of output) {
      if (item.type === "function_call" || item.type === "tool_call") {
        const id = asString(item.call_id) || asString(item.id) || randomUUID();
        const name = asString(item.name) || asString(item.function?.name);
        const rawArgs = item.arguments ?? item.function?.arguments ?? "{}";
        const args = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs);
        if (name) calls.push({ id, name, arguments: args });
        continue;
      }

      if (item.type === "message" && Array.isArray(item.tool_calls)) {
        for (const call of item.tool_calls) {
          const id = asString(call.id) || asString(call.call_id) || randomUUID();
          const name = asString(call.name) || asString(call.function?.name);
          const rawArgs = call.arguments ?? call.function?.arguments ?? "{}";
          const args = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs);
          if (name) calls.push({ id, name, arguments: args });
        }
      }
    }
    if (calls.length <= 1) return calls;
    const seen = new Set<string>();
    return calls.filter((call) => {
      const key = `${call.name}\x00${call.arguments}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private parseChatToolCalls(toolCalls: unknown[]): ToolCall[] {
    return toolCalls
      .map((call) => {
        const record = asObject(call) ?? {};
        const fn = asObject(record.function) ?? {};
        return {
        // Different gateways may return id under `id`, `call_id`, or nested function.id.
          id: asString(record.id) || asString(record.call_id) || asString(fn.id) || randomUUID(),
          name: asString(fn.name),
          arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
        };
      })
      .filter((call): call is ToolCall => Boolean(call.name));
  }

  private async parseResponseBody(
    res: Response,
    onTextDelta?: (delta: string) => void,
    options: { apiStyle: ResponseBodyApiStyle; streamRequested: boolean; abortSignal?: AbortSignal } = {
      apiStyle: "responses",
      streamRequested: false,
    },
  ) {
    const contentType = res.headers.get("content-type") ?? "";
    const contentTypeLower = contentType.toLowerCase();
    if (!contentTypeLower.includes("text/event-stream")) {
      const raw = await readResponseTextWithAbort(res, options.abortSignal);
      if (!raw.trim()) {
        this.debugLog("response.raw.empty", {
          contentType,
          status: res.status,
          streamRequested: options.streamRequested,
        });
        return {};
      }
      if (options.streamRequested && looksLikeEventStreamPayload(raw)) {
        this.debugLog("response.raw.sse_wrong_content_type", {
          contentType,
          status: res.status,
          apiStyle: options.apiStyle,
          bodyPreview: raw.slice(0, 4000),
        });
        return parseEventStreamForApiStyle(options.apiStyle, raw, onTextDelta);
      }
      try {
        return JSON.parse(raw);
      } catch (err) {
        this.debugLog("response.raw.parse_failed", {
          contentType,
          status: res.status,
          streamRequested: options.streamRequested,
          bodyPreview: raw.slice(0, 4000),
          error: String((err as Error)?.message || err || ""),
        });
        throw err;
      }
    }
    if (!res.body) {
      return {};
    }
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    const parser = createEventStreamParserForApiStyle(options.apiStyle, onTextDelta);
    let chunkChars = 0;
    let pending = "";
    try {
      while (true) {
        const { done, value } = await readStreamChunkWithAbort(reader, options.abortSignal);
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        chunkChars += value?.length ?? 0;
        let newlineIndex = pending.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = pending.slice(0, newlineIndex).replace(/\r$/, "");
          pending = pending.slice(newlineIndex + 1);
          parser.pushLine(line);
          newlineIndex = pending.indexOf("\n");
        }
      }
    } finally {
      reader.releaseLock();
    }
    pending += decoder.decode();
    if (pending) {
      for (const line of pending.replace(/\r\n/g, "\n").split("\n")) {
        parser.pushLine(line.replace(/\r$/, ""));
      }
    }
    const parsed = parser.finish();
    this.debugLog("response.sse.raw", {
      status: res.status,
      bodyChars: chunkChars,
      bodyPreview: shouldLogPayload() ? safePreview(parsed).slice(0, 4000) : undefined,
    });
    return parsed;
  }

  private debugLog(event: string, details: Record<string, unknown>) {
    if (!isLlmDebugEnabled()) return;
    try {
      console.info(`[agents.llm.debug] ${event} ${safePreview(details)}`);
    } catch {
      // ignore log failures
    }
  }

  private buildHeaders() {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
      headers["x-api-key"] = this.config.apiKey;
    }

    return headers;
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function createEventStreamParser(onTextDelta?: (delta: string) => void) {
  let lastJson: EventStreamState = {};
  let outputText = "";
  const outputItems: Array<ResponsesOutputItem | undefined> = [];
  const outputIndexById = new Map<string, number>();
  let buffer: string[] = [];

  const toIndex = (value: unknown, itemId?: unknown) => {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim()) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    if (typeof itemId === "string" && outputIndexById.has(itemId)) {
      return outputIndexById.get(itemId) ?? -1;
    }
    return -1;
  };

  const ensureMessageItem = (index: number, itemId?: unknown) => {
    if (!outputItems[index]) {
      outputItems[index] = {
        id: typeof itemId === "string" && itemId ? itemId : randomUUID(),
        type: "message",
        role: "assistant",
        content: [],
      };
    }
    const item = outputItems[index];
    if (!item) {
      throw new Error(`Missing message item at index ${index}`);
    }
    if (!Array.isArray(item.content)) {
      item.content = [];
    }
    if (typeof item.id === "string") {
      outputIndexById.set(item.id, index);
    }
    return item;
  };

  const ensureFunctionCallItem = (index: number, itemId?: unknown) => {
    if (!outputItems[index]) {
      outputItems[index] = {
        id: typeof itemId === "string" && itemId ? itemId : randomUUID(),
        type: "function_call",
        arguments: "",
      };
    }
    const item = outputItems[index];
    if (!item) {
      throw new Error(`Missing function call item at index ${index}`);
    }
    if (typeof item.arguments !== "string") item.arguments = "";
    if (typeof item.id === "string") {
      outputIndexById.set(item.id, index);
    }
    return item;
  };

  const handleEvent = (parsed: JsonObject) => {
    const response = asObject(parsed.response);
    if (response) {
      lastJson = response as EventStreamState;
      if (typeof response.output_text === "string" && !outputText) {
        outputText = response.output_text;
      }
    }

    const type = asString(parsed.type);

    if (type === "response.output_item.added" || type === "response.output_item.done") {
      const item = asObject(parsed.item) as ResponsesOutputItem | null;
      if (!item) return;
      const itemId = item.id ?? parsed.item_id;
      const index = toIndex(parsed.output_index, itemId);
      if (index >= 0) {
        outputItems[index] = item;
        if (typeof item.id === "string") outputIndexById.set(item.id, index);
      } else if (typeof item.id === "string" && outputIndexById.has(item.id)) {
        const existingIndex = outputIndexById.get(item.id);
        if (typeof existingIndex === "number") {
          outputItems[existingIndex] = item;
        }
      } else {
        const nextIndex = outputItems.length;
        outputItems.push(item);
        if (typeof item.id === "string") outputIndexById.set(item.id, nextIndex);
      }
      return;
    }

    if (type === "response.content_part.added" || type === "response.content_part.done") {
      const part = asObject(parsed.part) as ResponsesContentPart | null;
      if (!part) return;
      const index = toIndex(parsed.output_index, parsed.item_id);
      const contentIndex = toIndex(parsed.content_index, undefined);
      if (index < 0 || contentIndex < 0) return;
      const item = ensureMessageItem(index, parsed.item_id);
      if (!Array.isArray(item.content)) item.content = [];
      item.content[contentIndex] = part;
      const partText = typeof part.text === "string" ? part.text : "";
      if (partText && (!outputText || partText.length >= outputText.length)) {
        outputText = partText;
      }
      return;
    }

    if (type === "response.output_text.delta" && typeof parsed.delta === "string") {
      outputText += parsed.delta;
      onTextDelta?.(parsed.delta);
      const index = toIndex(parsed.output_index, parsed.item_id);
      const contentIndex = toIndex(parsed.content_index, undefined);
      if (index >= 0 && contentIndex >= 0) {
        const item = ensureMessageItem(index, parsed.item_id);
        if (!Array.isArray(item.content)) item.content = [];
        const currentPart = item.content[contentIndex];
        const part: ResponsesContentPart =
          currentPart && typeof currentPart === "object" && !Array.isArray(currentPart)
            ? currentPart
            : { type: "output_text", text: "" };
        const currentText = typeof part.text === "string" ? part.text : "";
        part.text = currentText + parsed.delta;
        item.content[contentIndex] = part;
      }
      return;
    }

    if (type === "response.output_text.done" && typeof parsed.text === "string") {
      if (!outputText || parsed.text.length >= outputText.length) {
        outputText = parsed.text;
      }
      const index = toIndex(parsed.output_index, parsed.item_id);
      const contentIndex = toIndex(parsed.content_index, undefined);
      if (index >= 0 && contentIndex >= 0) {
        const item = ensureMessageItem(index, parsed.item_id);
        const content = Array.isArray(item.content) ? item.content : (item.content = []);
        content[contentIndex] = { type: "output_text", text: parsed.text };
      }
      return;
    }

    if (type.endsWith("arguments.delta") && typeof parsed.delta === "string") {
      const index = toIndex(parsed.output_index, parsed.item_id);
      if (index >= 0) {
        const callItem = ensureFunctionCallItem(index, parsed.item_id);
        callItem.arguments += parsed.delta;
      }
      return;
    }

    if (type.endsWith("arguments.done") && typeof parsed.arguments === "string") {
      const index = toIndex(parsed.output_index, parsed.item_id);
      if (index >= 0) {
        const callItem = ensureFunctionCallItem(index, parsed.item_id);
        callItem.arguments = parsed.arguments;
      }
    }
  };

  const tryParseBuffer = (force: boolean) => {
    if (buffer.length === 0) return;
    const rawWithNewlines = buffer.join("\n").trim();
    const rawNoNewlines = buffer.join("").trim();
    if (!rawWithNewlines) {
      if (force) buffer = [];
      return;
    }
    if (rawWithNewlines === "[DONE]" || rawNoNewlines === "[DONE]") {
      buffer = [];
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawWithNewlines);
    } catch {
      try {
        parsed = JSON.parse(rawNoNewlines);
      } catch {
        if (force) buffer = [];
        return;
      }
    }
    buffer = [];
    const record = asObject(parsed);
    if (!record) return;
    handleEvent(record);
  };

  const finalize = () => {
    tryParseBuffer(true);
    const mergedOutput = outputItems.filter((item): item is ResponsesOutputItem => Boolean(item));
    if (mergedOutput.length > 0) {
      if (!Array.isArray(lastJson.output) || lastJson.output.length === 0) {
        lastJson.output = mergedOutput;
      } else {
        const output = lastJson.output;
        for (let i = 0; i < outputItems.length; i += 1) {
          const item = outputItems[i];
          if (!item) continue;
          if (!output[i]) {
            output[i] = item;
          }
        }
      }
    }

    if (outputText) {
      if (typeof lastJson.output_text !== "string" || !lastJson.output_text) {
        lastJson.output_text = outputText;
      }
      if (!Array.isArray(lastJson.output) || lastJson.output.length === 0) {
        lastJson.output = [{ type: "message", content: [{ type: "output_text", text: outputText }], role: "assistant" }];
      }
    }
    return lastJson;
  };

  return {
    pushLine(line: string) {
      const trimmed = line.trimEnd();
      if (!trimmed) {
        tryParseBuffer(true);
        return;
      }
      if (!trimmed.startsWith("data:")) return;
      buffer.push(trimmed.slice(5).trim());
      tryParseBuffer(false);
    },
    finish() {
      return finalize();
    },
  };
}

function createChatEventStreamParser(onTextDelta?: (delta: string) => void): EventStreamParser {
  type ChatToolCallChunk = {
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  };

  let content = "";
  const toolCallsByIndex = new Map<number, ChatToolCallChunk>();
  let buffer: string[] = [];
  let lastJson: JsonObject = {};

  const toIndex = (value: unknown, fallback: number): number => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return fallback;
  };

  const ensureToolCall = (index: number, id?: string): ChatToolCallChunk => {
    const existing = toolCallsByIndex.get(index);
    if (existing) {
      if (id && !existing.id) existing.id = id;
      return existing;
    }
    const next: ChatToolCallChunk = {
      id: id || randomUUID(),
      type: "function",
      function: {
        name: "",
        arguments: "",
      },
    };
    toolCallsByIndex.set(index, next);
    return next;
  };

  const mergeToolCallChunk = (raw: unknown, fallbackIndex: number) => {
    const record = asObject(raw);
    if (!record) return;
    const index = toIndex(record.index, fallbackIndex);
    const fn = asObject(record.function);
    const id = asString(record.id) || asString(record.call_id);
    const call = ensureToolCall(index, id || undefined);
    const name = asString(fn?.name);
    if (name) call.function.name = name;
    const argsDelta = asString(fn?.arguments);
    if (argsDelta) call.function.arguments += argsDelta;
  };

  const mergeFullToolCalls = (rawToolCalls: unknown) => {
    if (!Array.isArray(rawToolCalls)) return;
    rawToolCalls.forEach((raw, index) => {
      const record = asObject(raw);
      if (!record) return;
      const fn = asObject(record.function);
      const call = ensureToolCall(
        toIndex(record.index, index),
        asString(record.id) || asString(record.call_id) || undefined,
      );
      const name = asString(fn?.name);
      if (name) call.function.name = name;
      const args = asString(fn?.arguments);
      if (args) call.function.arguments = args;
    });
  };

  const handleEvent = (parsed: JsonObject) => {
    lastJson = parsed;
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    for (const rawChoice of choices) {
      const choice = asObject(rawChoice);
      if (!choice) continue;
      const delta = asObject(choice.delta);
      if (delta) {
        const contentDelta = asString(delta.content);
        if (contentDelta) {
          content += contentDelta;
          onTextDelta?.(contentDelta);
        }
        const toolCallDeltas = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
        toolCallDeltas.forEach((raw, index) => mergeToolCallChunk(raw, index));
      }
      const message = asObject(choice.message);
      if (message) {
        const messageContent = asString(message.content);
        if (messageContent) content = messageContent;
        mergeFullToolCalls(message.tool_calls);
      }
    }
  };

  const tryParseBuffer = (force: boolean) => {
    if (buffer.length === 0) return;
    const rawWithNewlines = buffer.join("\n").trim();
    const rawNoNewlines = buffer.join("").trim();
    if (!rawWithNewlines) {
      if (force) buffer = [];
      return;
    }
    if (rawWithNewlines === "[DONE]" || rawNoNewlines === "[DONE]") {
      buffer = [];
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawWithNewlines);
    } catch {
      try {
        parsed = JSON.parse(rawNoNewlines);
      } catch {
        if (force) buffer = [];
        return;
      }
    }
    buffer = [];
    const record = asObject(parsed);
    if (!record) return;
    handleEvent(record);
  };

  return {
    pushLine(line: string) {
      const trimmed = line.trimEnd();
      if (!trimmed) {
        tryParseBuffer(true);
        return;
      }
      if (!trimmed.startsWith("data:")) return;
      buffer.push(trimmed.slice(5).trim());
      tryParseBuffer(false);
    },
    finish() {
      tryParseBuffer(true);
      const toolCalls = Array.from(toolCallsByIndex.entries())
        .sort(([a], [b]) => a - b)
        .map(([, call]) => call)
        .filter((call) => call.function.name);
      if (content || toolCalls.length > 0) {
        return {
          choices: [
            {
              message: {
                content,
                ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
              },
            },
          ],
        };
      }
      return lastJson;
    },
  };
}

function createEventStreamParserForApiStyle(
  apiStyle: ResponseBodyApiStyle,
  onTextDelta?: (delta: string) => void,
): EventStreamParser {
  return apiStyle === "chat"
    ? createChatEventStreamParser(onTextDelta)
    : createEventStreamParser(onTextDelta);
}

function parseEventStreamForApiStyle(
  apiStyle: ResponseBodyApiStyle,
  body: string,
  onTextDelta?: (delta: string) => void,
) {
  const parser = createEventStreamParserForApiStyle(apiStyle, onTextDelta);
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    parser.pushLine(line);
  }
  return parser.finish();
}

function summarizeToolLinkage(messages: Message[]) {
  const assistantCalls = new Map<string, number>();
  const toolOutputs = new Map<string, number>();

  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.toolCalls)) {
      for (const call of msg.toolCalls) {
        const id = String(call?.id || "").trim();
        if (!id) continue;
        assistantCalls.set(id, (assistantCalls.get(id) ?? 0) + 1);
      }
      continue;
    }
    if (msg.role === "tool") {
      const id = String(msg.toolCallId || "").trim();
      if (!id) continue;
      toolOutputs.set(id, (toolOutputs.get(id) ?? 0) + 1);
    }
  }

  const missingOutputForCall: string[] = [];
  for (const [id, callCount] of assistantCalls.entries()) {
    const outputCount = toolOutputs.get(id) ?? 0;
    if (outputCount < callCount) missingOutputForCall.push(id);
  }

  const orphanToolOutputs: string[] = [];
  for (const id of toolOutputs.keys()) {
    if (!assistantCalls.has(id)) orphanToolOutputs.push(id);
  }

  return {
    assistantCallCount: Array.from(assistantCalls.values()).reduce((a, b) => a + b, 0),
    toolOutputCount: Array.from(toolOutputs.values()).reduce((a, b) => a + b, 0),
    assistantCallIds: Array.from(assistantCalls.keys()),
    toolOutputIds: Array.from(toolOutputs.keys()),
    missingOutputForCall,
    orphanToolOutputs,
  };
}

function assertToolLinkage(messages: Message[]): void {
  const linkage = summarizeToolLinkage(messages);
  if (linkage.orphanToolOutputs.length === 0 && linkage.missingOutputForCall.length === 0) return;

  const parts: string[] = ["运行时消息历史 tool_use/tool_result 配对不完整，已在本地阻止发送到 LLM。"];
  if (linkage.missingOutputForCall.length > 0) {
    parts.push(`missingOutputForCallIds=${linkage.missingOutputForCall.join(", ")}`);
  }
  if (linkage.orphanToolOutputs.length > 0) {
    parts.push(`orphanToolOutputIds=${linkage.orphanToolOutputs.join(", ")}`);
  }
  parts.push(`assistantCallIds=${linkage.assistantCallIds.join(", ") || "none"}`);
  parts.push(`toolOutputIds=${linkage.toolOutputIds.join(", ") || "none"}`);
  throw new Error(parts.join(" "));
}

function safePreview(value: unknown) {
  try {
    return JSON.stringify(redactInlineMediaData(value)).slice(0, 2000);
  } catch {
    return String(redactInlineMediaData(value)).slice(0, 2000);
  }
}

function buildLlmRequestSummary(input: {
  apiStyle: "chat" | "responses";
  url: string;
  model: string;
  retry: number;
  stream: boolean;
  systemChars: number;
  messages: Message[];
  toolDefinitions: number;
  payload: unknown;
  inputItems?: number;
}): LlmRequestSummary {
  const messageSummary = summarizeRequestMessages(input.messages);
  const toolDefinitionSummary = summarizePayloadToolDefinitions(input.payload);
  return {
    apiStyle: input.apiStyle,
    url: input.url,
    model: input.model,
    retry: input.retry,
    stream: input.stream,
    systemChars: input.systemChars,
    toolDefinitions: input.toolDefinitions,
    approxPayloadChars: safeJsonLength(input.payload),
    ...toolDefinitionSummary,
    ...messageSummary,
    ...(typeof input.inputItems === "number" ? { inputItems: input.inputItems } : {}),
  };
}

function summarizeRequestMessages(messages: Message[]): LlmRequestMessageSummary {
  const summary: LlmRequestMessageSummary = {
    messageCount: messages.length,
    userMessageCount: 0,
    assistantMessageCount: 0,
    toolMessageCount: 0,
    assistantToolCallCount: 0,
    totalMessageChars: 0,
    userMessageChars: 0,
    assistantMessageChars: 0,
    toolMessageChars: 0,
    maxSingleMessageChars: 0,
    maxToolMessageChars: 0,
    toolMessagesOver16k: 0,
    largestToolMessages: [],
  };

  for (const message of messages) {
    const chars = String(message?.content || "").length;
    summary.totalMessageChars += chars;
    summary.maxSingleMessageChars = Math.max(summary.maxSingleMessageChars, chars);
    if (message.role === "user") {
      summary.userMessageCount += 1;
      summary.userMessageChars += chars;
      continue;
    }
    if (message.role === "assistant") {
      summary.assistantMessageCount += 1;
      summary.assistantMessageChars += chars;
      summary.assistantToolCallCount += Array.isArray(message.toolCalls)
        ? message.toolCalls.length
        : 0;
      continue;
    }
    if (message.role === "tool") {
      summary.toolMessageCount += 1;
      summary.toolMessageChars += chars;
      summary.maxToolMessageChars = Math.max(summary.maxToolMessageChars, chars);
      if (chars > 16_000) summary.toolMessagesOver16k += 1;
      summary.largestToolMessages.push({
        toolCallId: String(message.toolCallId || "").trim() || "unknown",
        chars,
      });
    }
  }

  summary.largestToolMessages = summary.largestToolMessages
    .sort((left, right) => right.chars - left.chars)
    .slice(0, 5);

  return summary;
}

function summarizePayloadToolDefinitions(payload: unknown): LlmRequestToolDefinitionSummary {
  const payloadRecord = asObject(payload);
  const rawTools = Array.isArray(payloadRecord?.tools) ? payloadRecord.tools : [];
  const largestToolDefinitions: Array<{ name: string; chars: number }> = [];
  let toolDefinitionChars = 0;
  let maxToolDefinitionChars = 0;
  let toolDefinitionsOver16k = 0;

  for (const rawTool of rawTools) {
    const chars = safeJsonLength(rawTool);
    toolDefinitionChars += chars;
    maxToolDefinitionChars = Math.max(maxToolDefinitionChars, chars);
    if (chars > 16_000) toolDefinitionsOver16k += 1;
    largestToolDefinitions.push({
      name: readPayloadToolDefinitionName(rawTool),
      chars,
    });
  }

  return {
    toolDefinitionChars,
    maxToolDefinitionChars,
    toolDefinitionsOver16k,
    largestToolDefinitions: largestToolDefinitions
      .sort((left, right) => right.chars - left.chars)
      .slice(0, 5),
  };
}

function readPayloadToolDefinitionName(rawTool: unknown): string {
  const toolRecord = asObject(rawTool);
  if (!toolRecord) return "unknown";
  const directName = typeof toolRecord.name === "string" ? toolRecord.name.trim() : "";
  if (directName) return directName;
  const functionRecord = asObject(toolRecord.function);
  const functionName = typeof functionRecord?.name === "string" ? functionRecord.name.trim() : "";
  return functionName || "unknown";
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

function readResponsesOutputType(item: ResponsesOutputItem): string {
  return typeof item.type === "string" ? item.type.trim() : "";
}

function readResponsesOutputTypes(output: ResponsesOutputItem[]): string[] {
  return output
    .map((item) => readResponsesOutputType(item))
    .filter(Boolean);
}

function isUnsupportedHostedOutputType(type: string): boolean {
  if (!type.endsWith("_call")) return false;
  return type !== "function_call" && type !== "tool_call";
}

function collectUnsupportedHostedOutputTypes(output: ResponsesOutputItem[]): string[] {
  const seen = new Set<string>();
  const unsupported: string[] = [];
  for (const item of output) {
    const type = readResponsesOutputType(item);
    if (!type || !isUnsupportedHostedOutputType(type) || seen.has(type)) continue;
    seen.add(type);
    unsupported.push(type);
  }
  return unsupported;
}

type ResponsesOutputSummaryItem = {
  index: number;
  type: string;
  id?: string;
  status?: string;
  name?: string;
  callId?: string;
  contentTypes?: string[];
  textChars?: number;
  hasResult?: boolean;
  resultKind?: string;
};

function valueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function summarizeResponsesOutput(output: ResponsesOutputItem[]): ResponsesOutputSummaryItem[] {
  return output.map((item, index) => {
    const content = Array.isArray(item.content) ? item.content : [];
    const contentTypes = content
      .map((part) => optionalString(part.type))
      .filter((partType): partType is string => Boolean(partType));
    const textChars = content.reduce((total, part) => {
      const text = typeof part.text === "string" ? part.text : "";
      const refusal = typeof part.refusal === "string" ? part.refusal : "";
      return total + text.length + refusal.length;
    }, typeof item.text === "string" ? item.text.length : 0);
    const summary: ResponsesOutputSummaryItem = {
      index,
      type: readResponsesOutputType(item) || "unknown",
    };
    const id = optionalString(item.id);
    const status = optionalString(item.status);
    const name = optionalString(item.name) || optionalString(item.function?.name);
    const callId = optionalString(item.call_id);
    if (id) summary.id = id;
    if (status) summary.status = status;
    if (name) summary.name = name;
    if (callId) summary.callId = callId;
    if (contentTypes.length > 0) summary.contentTypes = contentTypes;
    if (textChars > 0) summary.textChars = textChars;
    if (typeof item.result !== "undefined") {
      summary.hasResult = true;
      summary.resultKind = valueKind(item.result);
    }
    return summary;
  });
}

function summarizeResponsesDiagnostic(
  json: Record<string, unknown>,
  output: ResponsesOutputItem[],
): Record<string, unknown> {
  return {
    id: optionalString(json.id),
    status: optionalString(json.status),
    outputTextChars: typeof json.output_text === "string" ? json.output_text.length : 0,
    outputTypes: readResponsesOutputTypes(output),
    outputSummary: summarizeResponsesOutput(output),
    ...(json.error ? { error: json.error } : {}),
  };
}

function createUnsupportedResponsesOutputError(input: {
  output: ResponsesOutputItem[];
  unsupportedOutputTypes: string[];
  requestSummary: LlmRequestSummary;
}): Error {
  const error = new Error(
    [
      `LLM 返回了当前 runtime 不支持的 Responses 内置输出: ${input.unsupportedOutputTypes.join(", ")}。`,
      "agents-cli 只接受 assistant 文本，或本轮 tools 数组中显式列出的 function/tool call。",
      "需要生成图片、文件或其他资产时，必须通过显式工具完成；不要依赖 hosted tool 输出。",
    ].join(" "),
  ) as Error & {
    code?: string;
    details?: Record<string, unknown>;
  };
  error.code = "llm_unsupported_responses_output";
  error.details = {
    unsupportedOutputTypes: input.unsupportedOutputTypes,
    outputTypes: readResponsesOutputTypes(input.output),
    outputSummary: summarizeResponsesOutput(input.output),
    requestSummary: input.requestSummary,
  };
  return error;
}

function createHttpStatusError(input: {
  status: number;
  bodyText: string;
  requestSummary: LlmRequestSummary;
}): Error {
  const responsePreview = truncateDiagnosticText(input.bodyText, 1_600);
  const error = new Error(
    `LLM 请求失败: ${input.status} ${responsePreview || "<empty response body>"}`,
  ) as Error & {
    code?: string;
    details?: Record<string, unknown>;
  };
  error.code = `llm_http_${input.status}`;
  error.details = {
    status: input.status,
    responsePreview,
    requestSummary: input.requestSummary,
  };
  return error;
}

function attachRequestSummaryToError(
  error: unknown,
  requestSummary: LlmRequestSummary,
): Error {
  const wrapped =
    error instanceof Error ? error : new Error(String(error || "unknown_llm_error"));
  const record = wrapped as Error & {
    code?: string;
    details?: Record<string, unknown>;
  };
  const existingDetails =
    record.details && typeof record.details === "object" && !Array.isArray(record.details)
      ? record.details
      : {};
  record.code = record.code || "llm_fetch_failed";
  record.details = {
    ...existingDetails,
    requestSummary,
  };
  return wrapped;
}

function truncateDiagnosticText(value: string, maxChars: number): string {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function parseTimeoutMs(raw: string | undefined): number | null {
  if (!raw) return DEFAULT_AGENTS_REQUEST_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseRetryCount(raw: string | undefined): number {
  if (!raw) return DEFAULT_AGENTS_FETCH_RETRIES;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_AGENTS_FETCH_RETRIES;
  return Math.max(0, Math.min(8, Math.trunc(n)));
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function isLlmDebugEnabled(): boolean {
  const raw = String(process.env.AGENTS_LLM_DEBUG_LOG || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function shouldLogPayload(): boolean {
  const raw = String(process.env.AGENTS_LLM_DEBUG_PAYLOAD || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function configureDnsResultOrderOnce() {
  if (dnsConfigured) return;
  dnsConfigured = true;
  const order = (process.env.AGENTS_DNS_RESULT_ORDER || "").trim();
  if (order !== "ipv4first" && order !== "verbatim") return;
  try {
    setDefaultResultOrder(order);
  } catch {
    // Ignore unsupported platforms/runtimes.
  }
}

function isRetryableFetchError(error: unknown): boolean {
  const err = asObject(error);
  const cause = asObject(err?.cause);
  const message = asString(err?.message).toLowerCase();
  const causeMessage = asString(cause?.message).toLowerCase();
  const code = asString(cause?.code);

  if (code === "UND_ERR_CONNECT_TIMEOUT") return true;
  if (code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") return true;
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "EAI_AGAIN") return true;
  if (message.includes("timeout") || causeMessage.includes("timeout")) return true;
  return false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortErrorFromSignal(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  const text = typeof reason === "string" ? reason.trim() : "";
  return new Error(text || "LLM 请求已中止。");
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) return;
  throw abortErrorFromSignal(signal);
}

async function readStreamChunkWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  abortSignal?: AbortSignal | null,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  throwIfAborted(abortSignal);
  if (!abortSignal) return reader.read();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      abortSignal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      void reader.cancel(abortSignal.reason).catch(() => undefined);
      reject(abortErrorFromSignal(abortSignal));
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

async function readResponseTextWithAbort(
  res: Response,
  abortSignal?: AbortSignal | null,
): Promise<string> {
  throwIfAborted(abortSignal);
  if (!res.body) return "";
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let text = "";
  try {
    while (true) {
      const { done, value } = await readStreamChunkWithAbort(reader, abortSignal);
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The reader may still be settling after cancellation.
    }
  }
}

function buildFetchAbortSignal(
  timeoutMs: number | null,
  externalSignal: AbortSignal | null,
): { signal?: AbortSignal; cleanup: () => void } {
  const controller =
    timeoutMs || externalSignal
      ? new AbortController()
      : null;
  if (!controller) {
    return {
      cleanup() {
        return;
      },
    };
  }

  let timeoutHandle: NodeJS.Timeout | null = null;
  const abortFromExternal = () => {
    const reason = externalSignal?.reason;
    controller.abort(reason instanceof Error ? reason : undefined);
  };

  if (timeoutMs) {
    timeoutHandle = setTimeout(() => {
      controller.abort(new Error(`LLM 请求超过 ${timeoutMs}ms 已中止（可设置 AGENTS_REQUEST_TIMEOUT_MS 调整）。`));
    }, timeoutMs);
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      abortFromExternal();
    } else {
      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromExternal);
      }
    },
  };
}

function buildCandidateUrls(url: string): string[] {
  const primary = [url];
  if (/^https:\/\/right\.codes\b/i.test(url)) {
    return [...primary, url.replace(/^https:\/\/right\.codes\b/i, "https://www.right.codes")];
  }
  return primary;
}

function wrapFetchError(
  error: unknown,
  url: string,
  apiBaseUrl: string,
  timeoutMs: number | null,
  retries: number
): Error {
  const err = asObject(error);
  const cause = asObject(err?.cause);
  const isAbort =
    (asString(err?.name) === "AbortError") ||
    (asString(cause?.name) === "AbortError");
  const detail = [
    asString(err?.message) ? `error=${asString(err?.message)}` : null,
    asString(cause?.code) ? `cause.code=${asString(cause?.code)}` : null,
    asString(cause?.message) ? `cause.message=${asString(cause?.message)}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const msg = [
    `LLM 请求失败：fetch ${url} 失败。`,
    `请检查网络/DNS，或修改 apiBaseUrl（当前：${apiBaseUrl}）。`,
    "可通过 agents.config.json 的 apiBaseUrl 或环境变量 AGENTS_API_BASE_URL 覆盖。",
    "示例：AGENTS_API_BASE_URL=https://right.codes/codex/v1（或 https://api.openai.com/v1）。",
    retries > 0 ? `已重试 ${retries} 次（可设置 AGENTS_FETCH_RETRIES 调整，默认 1）。` : null,
    timeoutMs ? `单次请求超时 ${timeoutMs}ms（可设置 AGENTS_REQUEST_TIMEOUT_MS 调整）。` : null,
    "若是偶发连接超时，可尝试 AGENTS_DNS_RESULT_ORDER=ipv4first。",
    isAbort && timeoutMs ? `请求超过 ${timeoutMs}ms 已中止（可设置 AGENTS_REQUEST_TIMEOUT_MS 调整）。` : null,
    detail ? `(${detail})` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const wrapped = new Error(msg);
  return Object.assign(wrapped, { cause: error });
}
