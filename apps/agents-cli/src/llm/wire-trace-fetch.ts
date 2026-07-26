import { randomUUID } from "node:crypto";

import { traceContext } from "../runtime/trace-context.js";
import {
  appendTraceStreamRecord,
  emitTraceEventForContext,
} from "../core/hooks/builtins/wire-trace.js";
import type { LlmRequestPayload, LlmResponsePayload, TracePayloadRef } from "../runtime/trace-events.js";
import { redactInlineMediaData } from "./payload-redaction.js";

const backgroundWork = new Set<Promise<void>>();

function trackBackgroundWork(work: Promise<void>): void {
  backgroundWork.add(work);
  void work.finally(() => backgroundWork.delete(work));
}

export async function waitForTraceBackgroundWorkForTests(): Promise<void> {
  await Promise.all([...backgroundWork]);
}

function isTraceEnabled(): boolean {
  return Boolean(process.env.TRACE_CAPTURE);
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const SENSITIVE_TRACE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "cookie",
  "set-cookie",
]);

export function headersToRecordForTrace(
  headers: Headers | Record<string, string> | [string, string][],
): Record<string, string> {
  const out: Record<string, string> = {};
  const append = (key: string, value: string) => {
    out[key] = SENSITIVE_TRACE_HEADERS.has(key.toLowerCase()) ? "[redacted]" : value;
  };
  if (headers instanceof Headers) {
    headers.forEach((value, key) => append(key, value));
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) append(key, value);
  } else {
    for (const [key, value] of Object.entries(headers)) append(key, value);
  }
  return out;
}

export type WireTraceClientKind =
  | "responses"
  | "openai-chat"
  | "gemini"
  | "anthropic";

export async function wireTraceFetch(
  clientKind: WireTraceClientKind,
  url: string | URL,
  init: RequestInit,
): Promise<Response> {
  if (!isTraceEnabled()) {
    return fetch(url, init);
  }

  const ctx = traceContext.current();
  if (!ctx) {
    return fetch(url, init);
  }

  const urlStr = String(url);
  const llmCallId = randomUUID();
  const method = (init.method ?? "POST").toUpperCase();
  const reqHeaders = headersToRecordForTrace((init.headers ?? {}) as Record<string, string>);
  const bodyRaw = typeof init.body === "string" ? init.body : "";
  const bodyParsed = safeParseJson(bodyRaw);
  const bodyForTrace = redactInlineMediaData(bodyParsed);
  const isStream = typeof bodyParsed === "object" && bodyParsed !== null && (bodyParsed as Record<string, unknown>).stream === true;

  const reqPayload: LlmRequestPayload = {
    type: "llm.request",
    llmCallId,
    url: urlStr,
    method,
    headers: reqHeaders,
    body: bodyForTrace,
    stream: isStream,
    clientKind,
  };
  emitTraceEventForContext(ctx, "llm.request", reqPayload);

  const t0 = performance.now();
  const response = await fetch(url, init);
  const durationMs = Math.round(performance.now() - t0);

  if (isStream && response.body) {
    const [traceBranch, returnBranch] = response.body.tee();
    trackBackgroundWork(processStreamInBackground(traceBranch, response, t0, ctx, llmCallId));
    return new Response(returnBranch, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const cloned = response.clone();
  trackBackgroundWork(cloned.text().then((text) => {
    const respPayload: LlmResponsePayload = {
      type: "llm.response",
      llmCallId,
      status: response.status,
      statusText: response.statusText,
      headers: headersToRecordForTrace(response.headers),
      body: redactInlineMediaData(safeParseJson(text)),
      durationMs,
    };
    emitTraceEventForContext(ctx, "llm.response", respPayload);
  }).catch(() => {}));

  return response;
}

async function processStreamInBackground(
  stream: ReadableStream<Uint8Array>,
  response: Response,
  startTime: number,
  ctx: NonNullable<ReturnType<typeof traceContext.current>>,
  llmCallId: string,
): Promise<void> {
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName: string | undefined;
    let streamRef: TracePayloadRef | undefined;

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.startsWith("event:")) {
        eventName = trimmed.slice(6).trim() || undefined;
      }
      streamRef = appendTraceStreamRecord(ctx, llmCallId, {
        ts: new Date().toISOString(),
        eventName,
        rawLine: trimmed,
      }) ?? streamRef;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    }
    buffer += decoder.decode();
    if (buffer) processLine(buffer);

    const respPayload: LlmResponsePayload = {
      type: "llm.response",
      llmCallId,
      status: response.status,
      statusText: response.statusText,
      headers: headersToRecordForTrace(response.headers),
      body: null,
      ...(streamRef ? { streamRef } : {}),
      durationMs: Math.round(performance.now() - startTime),
    };
    emitTraceEventForContext(ctx, "llm.response", respPayload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[wire-trace] stream processing error: ${msg}`);
  }
}
