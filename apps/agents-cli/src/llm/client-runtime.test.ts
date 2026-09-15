import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { loadConfig } from "../core/config.js";
import { LLMClient } from "./client.js";
import type { AgentConfig, LLMRequest } from "../types/index.js";

const request: LLMRequest = { system: "", messages: [{ role: "user", content: "ping" }], tools: [] };
const config = {
  apiBaseUrl: "https://example.invalid/v1", apiKey: "test-only", model: "gpt-5.6-terra",
  apiStyle: "responses", stream: true,
} as AgentConfig;
const completed = () => new Response(JSON.stringify({ output_text: "pong", status: "completed" }), {
  headers: { "Content-Type": "application/json" },
});
function stalledFetch(_url: unknown, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init!.signal!;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
function isolateEnv(t: TestContext) {
  const before = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  });
  delete process.env.TRACE_CAPTURE;
  process.env.AGENTS_FETCH_RETRIES = "0";
}

test("nested workspace launch sends root .env reasoning effort on the actual request", async (t) => {
  isolateEnv(t);
  const root = mkdtempSync(path.join(tmpdir(), "agents-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, "apps", "agents-cli");
  mkdirSync(cwd, { recursive: true });
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
  writeFileSync(path.join(root, ".env"), "AGENTS_REASONING_EFFORT=high\n");
  process.env.AGENTS_HOME = path.join(root, ".agents");
  process.env.AGENTS_WORKSPACE_ROOT = root;
  delete process.env.AGENTS_REASONING_EFFORT;
  const runtimeConfig = loadConfig(cwd);
  let body: Record<string, unknown> = {};
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return completed();
  });
  await new LLMClient({ ...runtimeConfig, ...config }).call(request);
  assert.deepEqual(body.reasoning, { effort: "high" });
  process.env.AGENTS_REASONING_EFFORT = "low";
  loadConfig(cwd);
  assert.equal(process.env.AGENTS_REASONING_EFFORT, "low", "explicit environment must win");
});

test("no response headers fails promptly instead of waiting the whole request budget", async (t) => {
  isolateEnv(t);
  process.env.AGENTS_RESPONSE_HEADERS_TIMEOUT_MS = "20";
  process.env.AGENTS_REQUEST_TIMEOUT_MS = "200";
  t.mock.method(globalThis, "fetch", stalledFetch);
  await assert.rejects(new LLMClient(config).call(request), {
    code: "llm_request_timeout", message: /首个 HTTP 响应/,
  });
});

test("request deadline is terminal even when fetch retries are enabled", async (t) => {
  isolateEnv(t);
  process.env.AGENTS_RESPONSE_HEADERS_TIMEOUT_MS = "1000";
  process.env.AGENTS_REQUEST_TIMEOUT_MS = "10";
  process.env.AGENTS_FETCH_RETRIES = "1";
  const fetch = t.mock.method(globalThis, "fetch", stalledFetch);
  // AgentLoop retries only llm_fetch_failed; the terminal code must survive request-summary wrapping.
  await assert.rejects(new LLMClient(config).call(request), {
    code: "llm_request_timeout", message: /10ms/,
  });
  assert.equal(fetch.mock.callCount(), 1, "a timed-out LLM POST must not be sent again");
});

for (const apiStyle of ["responses", "chat"] as const) {
  test(`${apiStyle} preserves a terminal SSE error instead of reporting empty output or retrying`, async (t) => {
    isolateEnv(t);
    const upstreamError = { code: "server_is_overloaded", message: "Our servers are currently overloaded. Please try again later." };
    const event = apiStyle === "responses" ? { type: "error", ...upstreamError } : { error: upstreamError };
    const fetch = t.mock.method(globalThis, "fetch", async () => new Response(
      `event: error\ndata: ${JSON.stringify(event)}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    ));
    await assert.rejects(new LLMClient({ ...config, apiStyle }).call(request), {
      code: "llm_stream_error", message: /servers are currently overloaded/,
    });
    assert.equal(fetch.mock.callCount(), 1, "a terminal stream error must not silently replay the request");
  });
}

test("headers deadline stops after headers; active streams keep their full budget", async (t) => {
  isolateEnv(t);
  process.env.AGENTS_RESPONSE_HEADERS_TIMEOUT_MS = "10";
  process.env.AGENTS_REQUEST_TIMEOUT_MS = "200";
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const timer = setTimeout(() => {
          controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed","response":{"status":"completed","output_text":"pong"}}\n\n'));
          controller.close();
        }, 40);
        init!.signal!.addEventListener("abort", () => {
          clearTimeout(timer);
          controller.error(init!.signal!.reason);
        }, { once: true });
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  });
  const response = await new LLMClient(config).call(request);
  assert.equal(response.text, "pong");
});
