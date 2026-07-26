import { randomUUID } from "node:crypto";
import type { LLMRequest, LLMResponse, Message, ToolCall, ToolDefinition } from "../types/index.js";
import { normalizeToolOutput } from "../core/message-limits.js";
import type { LLMAdapter } from "./adapter.js";
import {
  ALLOWED_INLINE_IMAGE_MIME,
  fetchInlineMediaData,
  inferMimeFromUrl,
  shouldInlineForCloudModel,
} from "./inline-media.js";
import { wireTraceFetch } from "./wire-trace-fetch.js";
import { createNativeVideoInputUnsupportedError } from "./video-input.js";

export type AnthropicClientConfig = {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
};

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: AnthropicImageSource }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

type AnthropicImageSource =
  | { type: "base64"; media_type: string; data: string }
  | { type: "url"; url: string };

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

type AnthropicResponse = {
  stop_reason?: unknown;
  content?: Array<{
    type?: unknown;
    text?: unknown;
    id?: unknown;
    name?: unknown;
    input?: unknown;
  }>;
  error?: {
    type?: unknown;
    message?: unknown;
  };
};

const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicClient implements LLMAdapter {
  constructor(private readonly config: AnthropicClientConfig) {
    if (!config.apiKey.trim()) throw new Error("AnthropicClient: apiKey 必填");
    if (!config.apiBaseUrl.trim()) throw new Error("AnthropicClient: apiBaseUrl 必填");
    if (!config.model.trim()) throw new Error("AnthropicClient: model 必填");
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model?.trim() || this.config.model.trim();
    const payload: Record<string, unknown> = {
      model,
      max_tokens: readAnthropicMaxTokens(),
      messages: await buildAnthropicMessages(request.messages, request.abortSignal),
    };
    const tools = buildAnthropicTools(request.tools);
    if (request.system) payload.system = request.system;
    if (tools.length > 0) payload.tools = tools;

    const response = await wireTraceFetch("anthropic", buildAnthropicMessagesUrl(this.config.apiBaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey.trim(),
        "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
      },
      body: JSON.stringify(payload),
      ...(request.abortSignal ? { signal: request.abortSignal } : {}),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Anthropic HTTP ${response.status}: ${truncateDiagnosticText(text, 1500) || "<empty>"}`,
      );
    }

    const body = (await response.json()) as AnthropicResponse;
    if (body.error) {
      const errorType = typeof body.error.type === "string" ? body.error.type : "unknown";
      const message = typeof body.error.message === "string" ? body.error.message : "";
      throw new Error(`Anthropic API error (${errorType}): ${message || "<empty>"}`);
    }

    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of Array.isArray(body.content) ? body.content : []) {
      if (block?.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
        continue;
      }
      if (block?.type === "tool_use" && typeof block.name === "string") {
        toolCalls.push({
          id:
            typeof block.id === "string" && block.id.trim()
              ? block.id
              : `anthropic_${randomUUID()}`,
          name: block.name,
          arguments: JSON.stringify(isRecord(block.input) ? block.input : {}),
        });
      }
    }

    const text = textParts.join("");
    if (text) request.onTextDelta?.(text);
    if (!text && toolCalls.length === 0) {
      throw new Error(
        `Anthropic 返回空响应 (stop_reason=${String(body.stop_reason || "unknown")})。`,
      );
    }
    return { text, toolCalls };
  }
}

async function buildAnthropicMessages(
  messages: Message[],
  abortSignal?: AbortSignal,
): Promise<AnthropicMessage[]> {
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      out.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: message.toolCallId || randomUUID(),
          content: normalizeToolOutput(
            message.content,
            `tool-call:${message.toolCallId || "unknown"}`,
          ),
        }],
      });
      continue;
    }

    const contentParts = await buildAnthropicContent(message, abortSignal);
    out.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content:
        contentParts.length === 1 && contentParts[0]?.type === "text"
          ? contentParts[0].text
          : contentParts,
    });
  }
  return mergeAdjacentAnthropicMessages(out);
}

async function buildAnthropicContent(
  message: Message,
  abortSignal?: AbortSignal,
): Promise<AnthropicContentBlock[]> {
  const blocks: AnthropicContentBlock[] = [];
  if (Array.isArray(message.contentParts) && message.contentParts.length > 0) {
    for (const part of message.contentParts) {
      if (part.type === "text") {
        if (part.text) blocks.push({ type: "text", text: part.text });
        continue;
      }
      if (part.type === "image_url") {
        blocks.push({
          type: "image",
          source: await buildAnthropicImageSource(part.imageUrl, abortSignal),
        });
        continue;
      }
      if (part.type === "media_url") {
        throw createNativeVideoInputUnsupportedError("anthropic-messages");
      }
    }
  } else if (message.content) {
    blocks.push({ type: "text", text: message.content });
  }

  if (message.role === "assistant" && Array.isArray(message.toolCalls)) {
    for (const call of message.toolCalls) {
      if (!call?.name) continue;
      blocks.push({
        type: "tool_use",
        id: call.id || randomUUID(),
        name: call.name,
        input: parseToolArguments(call.arguments),
      });
    }
  }
  return blocks.length ? blocks : [{ type: "text", text: " " }];
}

function mergeAdjacentAnthropicMessages(messages: AnthropicMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    const previous = out[out.length - 1];
    if (!previous || previous.role !== message.role) {
      out.push(message);
      continue;
    }
    previous.content = [
      ...contentToBlocks(previous.content),
      ...contentToBlocks(message.content),
    ];
  }
  return out;
}

function contentToBlocks(content: string | AnthropicContentBlock[]): AnthropicContentBlock[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

async function buildAnthropicImageSource(
  rawUrl: string,
  abortSignal?: AbortSignal,
): Promise<AnthropicImageSource> {
  const url = String(rawUrl || "").trim();
  const dataUrlMatch = url.match(/^data:([^;,]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    const mediaType = dataUrlMatch[1]?.trim().toLowerCase() || "";
    if (!ALLOWED_INLINE_IMAGE_MIME.has(mediaType)) {
      throw new Error(`Anthropic image refused: unsupported MIME ${mediaType || "<unknown>"}`);
    }
    return { type: "base64", media_type: mediaType, data: dataUrlMatch[2] || "" };
  }
  if (shouldInlineForCloudModel(url)) {
    const inline = await fetchInlineMediaData({
      rawUrl: url,
      allowedMimeTypes: ALLOWED_INLINE_IMAGE_MIME,
      maxBytes: readAnthropicImageInlineMaxBytes(),
      timeoutMs: readAnthropicImageInlineTimeoutMs(),
      abortSignal,
      label: "Anthropic image",
    });
    return { type: "base64", media_type: inline.mimeType, data: inline.base64 };
  }
  const inferredMime = inferMimeFromUrl(new URL(url).pathname);
  if (inferredMime && !ALLOWED_INLINE_IMAGE_MIME.has(inferredMime)) {
    throw new Error(`Anthropic image refused: unsupported MIME ${inferredMime}`);
  }
  return { type: "url", url };
}

function buildAnthropicTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools
    .filter((tool) => Boolean(tool?.name))
    .map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      input_schema: sanitizeToolInputSchema(tool.parameters),
    }));
}

function sanitizeToolInputSchema(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) return schema;
  return { type: "object", properties: {} };
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function buildAnthropicMessagesUrl(apiBaseUrl: string): string {
  const base = String(apiBaseUrl || "").trim().replace(/\/+$/, "");
  if (!base || /\/messages$/i.test(base)) return base;
  return `${base}/messages`;
}

function readAnthropicMaxTokens(): number {
  return clampPositiveInt(process.env.AGENTS_ANTHROPIC_MAX_TOKENS, 4096, 1, 64000);
}

function readAnthropicImageInlineTimeoutMs(): number {
  return clampPositiveInt(
    process.env.AGENTS_ANTHROPIC_IMAGE_INLINE_TIMEOUT_MS,
    15000,
    1000,
    120000,
  );
}

function readAnthropicImageInlineMaxBytes(): number {
  return clampPositiveInt(
    process.env.AGENTS_ANTHROPIC_IMAGE_INLINE_MAX_BYTES,
    20 * 1024 * 1024,
    64 * 1024,
    80 * 1024 * 1024,
  );
}

function clampPositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(min, Math.min(Math.trunc(value), max));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function truncateDiagnosticText(value: string, maxChars: number): string {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
