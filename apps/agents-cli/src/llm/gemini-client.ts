import { randomUUID } from "node:crypto";
import type { LLMRequest, LLMResponse, Message, ToolCall, ToolDefinition } from "../types/index.js";
import type { LLMAdapter } from "./adapter.js";
import { ALLOWED_INLINE_MEDIA_MIME, fetchInlineMediaData } from "./inline-media.js";
import { wireTraceFetch } from "./wire-trace-fetch.js";

export type GeminiClientConfig = {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
};

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type GeminiToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type GeminiResponseCandidate = {
  content?: { role?: string; parts?: GeminiPart[] };
  finishReason?: string;
};

type GeminiResponseBody = {
  candidates?: GeminiResponseCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
};

const MAX_INLINE_BYTES = Math.max(
  64 * 1024,
  Math.min(parseEnvInt(process.env.AGENTS_GEMINI_MAX_INLINE_BYTES, 20 * 1024 * 1024), 80 * 1024 * 1024),
);

const INLINE_FETCH_TIMEOUT_MS = Math.max(
  2000,
  Math.min(parseEnvInt(process.env.AGENTS_GEMINI_INLINE_TIMEOUT_MS, 15_000), 60_000),
);

const GENERATE_CONTENT_TIMEOUT_MS = Math.max(
  5_000,
  Math.min(parseEnvInt(process.env.AGENTS_GEMINI_REQUEST_TIMEOUT_MS, 90_000), 600_000),
);

function parseEnvInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function parseEnvNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

export class GeminiClient implements LLMAdapter {
  constructor(private readonly config: GeminiClientConfig) {
    if (!config.apiKey) throw new Error("GeminiClient: apiKey 必填");
    if (!config.apiBaseUrl) throw new Error("GeminiClient: apiBaseUrl 必填");
    if (!config.model) throw new Error("GeminiClient: model 必填");
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    const model = (request.model && request.model.trim()) || this.config.model;
    const contents = await buildGeminiContents(request.messages);
    const tools = buildGeminiTools(request.tools);
    const body: Record<string, unknown> = {
      contents,
      ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
      ...(tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}),
    };
    const url = buildGenerateContentUrl(this.config.apiBaseUrl, model);
    const res = await this.fetchWithRetry(url, body, request.abortSignal);
    if (!res.ok) {
      const text = await res.text();
      throw createGeminiHttpError(res.status, text);
    }
    const json = (await res.json()) as GeminiResponseBody;
    if (json.error) {
      throw createGeminiApiError(json.error);
    }
    if (json.promptFeedback?.blockReason) {
      throw new Error(`Gemini 请求被安全策略阻断: ${json.promptFeedback.blockReason}`);
    }
    const candidate = Array.isArray(json.candidates) ? json.candidates[0] : undefined;
    const parts = candidate?.content?.parts ?? [];
    const textChunks: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const part of parts) {
      if ("text" in part && typeof part.text === "string") {
        textChunks.push(part.text);
        continue;
      }
      if ("functionCall" in part && part.functionCall && typeof part.functionCall.name === "string") {
        const args =
          part.functionCall.args && typeof part.functionCall.args === "object"
            ? part.functionCall.args
            : {};
        toolCalls.push({
          id: `gemini_${randomUUID()}`,
          name: part.functionCall.name,
          arguments: JSON.stringify(args),
        });
      }
    }
    const text = textChunks.join("");
    if (text && request.onTextDelta) request.onTextDelta(text);
    if (!text && toolCalls.length === 0) {
      throw new Error(
        `Gemini 返回空响应 (finishReason=${candidate?.finishReason ?? "unknown"})。` +
          `不允许静默兜底——请检查 prompt 长度、安全策略或模型可用性。`,
      );
    }
    return { text, toolCalls };
  }

  private async fetchWithRetry(
    url: string,
    body: Record<string, unknown>,
    abortSignal: AbortSignal | undefined,
  ): Promise<Response> {
    const maxRetries = parseEnvNonNegativeInt(process.env.AGENTS_GEMINI_RETRIES, 2);
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const requestAbort = buildRequestAbortSignal(GENERATE_CONTENT_TIMEOUT_MS, abortSignal);
      try {
        const res = await wireTraceFetch("gemini", url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.config.apiKey,
          },
          body: JSON.stringify(body),
          signal: requestAbort.signal,
        });
        requestAbort.cleanup();
        if (res.ok) return res;
        if (!isRetryableStatus(res.status) || attempt >= maxRetries) return res;
      } catch (err) {
        requestAbort.cleanup();
        lastError = err;
        if (attempt >= maxRetries) throw err;
      }
      await sleep(500 * (attempt + 1));
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error("Gemini 请求失败 (no response)");
  }
}

function buildRequestAbortSignal(timeoutMs: number, externalSignal: AbortSignal | undefined): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  if (externalSignal?.aborted) return { signal: externalSignal, cleanup: () => undefined };
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Gemini generateContent 请求超过 ${timeoutMs}ms 已中止（可设置 AGENTS_GEMINI_REQUEST_TIMEOUT_MS 调整）。`));
  }, timeoutMs);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  };
  const onExternalAbort = () => {
    cleanup();
    controller.abort(externalSignal?.reason ?? new Error("Gemini generateContent 请求已被上游中止。"));
  };
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  controller.signal.addEventListener("abort", cleanup, { once: true });
  return { signal: controller.signal, cleanup };
}

async function buildGeminiContents(messages: Message[]): Promise<GeminiContent[]> {
  const out: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      const responsePayload = parseToolResponse(m.content);
      out.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: responsePayload.name,
              response: responsePayload.response,
            },
          },
        ],
      });
      continue;
    }
    const role: GeminiContent["role"] = m.role === "assistant" ? "model" : "user";
    const parts: GeminiPart[] = [];
    if (Array.isArray(m.contentParts) && m.contentParts.length > 0) {
      for (const part of m.contentParts) {
        if (part.type === "text") {
          if (part.text) parts.push({ text: part.text });
        } else if (part.type === "image_url") {
          const inline = await fetchInlineMedia(part.imageUrl);
          parts.push({ inlineData: { mimeType: inline.mimeType, data: inline.base64 } });
        } else if (part.type === "media_url") {
          const inline = await fetchInlineMedia(part.mediaUrl);
          parts.push({ inlineData: { mimeType: inline.mimeType, data: inline.base64 } });
        }
      }
    } else if (m.content) {
      parts.push({ text: m.content });
    }
    if (m.role === "assistant" && Array.isArray(m.toolCalls)) {
      for (const call of m.toolCalls) {
        if (!call?.name) continue;
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(call.arguments || "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          args = { raw: call.arguments };
        }
        parts.push({ functionCall: { name: call.name, args } });
      }
    }
    if (parts.length > 0) out.push({ role, parts });
  }
  return out;
}

function parseToolResponse(content: string): { name: string; response: Record<string, unknown> } {
  const trimmed = (content || "").trim();
  if (!trimmed) return { name: "tool", response: { content: "" } };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "tool";
      const response =
        record.response && typeof record.response === "object" && !Array.isArray(record.response)
          ? (record.response as Record<string, unknown>)
          : { content: parsed };
      return { name, response };
    }
  } catch {
    // fall through to text wrapping
  }
  return { name: "tool", response: { content: trimmed } };
}

function buildGeminiTools(tools: ToolDefinition[]): GeminiToolDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: sanitizeParameters(t.parameters),
  }));
}

function sanitizeParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeSchema(parameters);
  if (!sanitized || sanitized.type !== "object") return { type: "object", properties: {}, required: [] };
  if (!Array.isArray(sanitized.required)) sanitized.required = [];
  return sanitized;
}

function sanitizeSchema(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const type = normalizeSchemaType(input.type);
  if (type) out.type = type;
  if (typeof input.description === "string" && input.description.trim()) {
    out.description = input.description;
  }
  if (Array.isArray(input.enum)) {
    out.enum = input.enum.filter((item) => ["string", "number", "boolean"].includes(typeof item));
  }

  if (input.properties && typeof input.properties === "object" && !Array.isArray(input.properties)) {
    const properties: Record<string, unknown> = {};
    const propertyNames = new Set<string>();
    for (const [key, rawProperty] of Object.entries(input.properties as Record<string, unknown>)) {
      const sanitized = sanitizeSchema(rawProperty);
      if (!sanitized) continue;
      properties[key] = sanitized;
      propertyNames.add(key);
    }
    out.properties = properties;
    const required = Array.isArray(input.required)
      ? input.required.filter((item): item is string => typeof item === "string" && propertyNames.has(item))
      : [];
    out.required = required;
  }

  if (input.items) {
    const items = sanitizeSchema(input.items);
    if (items) out.items = items;
  }

  if (!out.type) {
    out.type = out.properties ? "object" : "string";
  }
  if (out.type === "object" && !out.properties) {
    out.properties = {};
    out.required = [];
  }
  if (out.type === "object" && !Array.isArray(out.required)) {
    out.required = [];
  }
  return out;
}

function normalizeSchemaType(value: unknown): string {
  if (typeof value !== "string") return "";
  const type = value.toLowerCase();
  switch (type) {
    case "object":
    case "array":
    case "string":
    case "number":
    case "integer":
    case "boolean":
      return type;
    default:
      return "";
  }
}

function buildGenerateContentUrl(apiBase: string, model: string): string {
  const trimmed = apiBase.replace(/\/+$/, "");
  const safeModel = encodeURIComponent(model);
  const url = `${trimmed}/models/${safeModel}:generateContent`;
  return url;
}

async function fetchInlineMedia(rawUrl: string): Promise<{ mimeType: string; base64: string }> {
  const inline = await fetchInlineMediaData({
    rawUrl,
    allowedMimeTypes: ALLOWED_INLINE_MEDIA_MIME,
    maxBytes: MAX_INLINE_BYTES,
    timeoutMs: INLINE_FETCH_TIMEOUT_MS,
    label: "Gemini inline_data",
  });
  return { mimeType: inline.mimeType, base64: inline.base64 };
}

function createGeminiHttpError(status: number, bodyText: string): Error {
  const preview = (bodyText || "").slice(0, 1500);
  const relay = parseRelayGatewayError(preview);
  const message = relay
    ? `Gemini 中转网关错误 (HTTP ${status}, type=${relay.errorType}): ${relay.message || "<空>"}。` +
      `此错误来自中转网关而非 Google 原生 API（原生格式为 {"error":{"code","status"}}），` +
      `通常是网关上游 Gemini 账号/配额耗尽或该 model 路由暂不可用（如 "暂无可用账号 请稍后重试"），` +
      `空的 "请求参数错误" 也属此类，并非你的请求体/工具 schema 格式问题。` +
      `应对：稍后重试，或在 ModelPanel→multimodal slot 切换到有可用账号的 model/网关，不要反复改 prompt 或 schema。`
    : `Gemini HTTP ${status}: ${preview || "<empty>"}`;
  const err = new Error(message) as Error & {
    code?: string;
  };
  err.code = `gemini_http_${status}`;
  return err;
}

// 中转网关（new-api/one-api 类）的错误信封为 {"type":"error","error":{"type","message"}}，
// 与 Google 原生 {"error":{"code","status"}} 不同。识别后给出可执行诊断，避免把网关
// 上游容量问题误判为我方请求参数错误。
function parseRelayGatewayError(bodyText: string): { errorType: string; message: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  if (root.type !== "error") return null;
  const inner = root.error;
  if (!inner || typeof inner !== "object" || Array.isArray(inner)) return null;
  const e = inner as Record<string, unknown>;
  if (typeof e.code === "number" || typeof e.status === "string") return null;
  return {
    errorType: typeof e.type === "string" ? e.type : "unknown",
    message: typeof e.message === "string" ? e.message.trim() : "",
  };
}

function createGeminiApiError(error: GeminiResponseBody["error"]): Error {
  const code = error?.code ? String(error.code) : "unknown";
  const status = error?.status ?? "";
  const msg = error?.message ?? "";
  return new Error(`Gemini 返回错误: code=${code} status=${status} message=${msg}`);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
