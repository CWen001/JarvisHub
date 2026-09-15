import assert from "node:assert/strict";
import test from "node:test";
import { summarizeHttpErrorBody } from "./client.js";

test("summarizes an upstream 524 HTML page without leaking markup", () => {
  const summary = summarizeHttpErrorBody(
    524,
    '<!DOCTYPE html><html><head><title>xxxx.fun | 524: A timeout occurred</title></head><body>...</body></html>',
  );

  assert.equal(summary, "上游 LLM 网关超时（524）");
  assert.doesNotMatch(summary, /<html|DOCTYPE|xxxx\.fun/i);
});

test("preserves concise non-HTML error bodies", () => {
  assert.equal(summarizeHttpErrorBody(429, '{"error":"rate limit"}'), '{"error":"rate limit"}');
});
