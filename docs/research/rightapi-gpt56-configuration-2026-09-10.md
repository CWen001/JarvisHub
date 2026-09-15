# RightAPI GPT-5.6 configuration — official-site review

Checked 2026-09-10. This is a documentation review, not proof of current inference availability. No model calls or application configuration changes were made during this review.

## Official configuration

[Manual Codex configuration](https://docs.rightapi.ai/docs/rc_cli_config/codex) currently shows:

```toml
model_provider = "rightcode"
model = "gpt-5.6-sol"
model_reasoning_effort = "xhigh"
disable_response_storage = true
model_verbosity = "high"

[model_providers.rightcode]
name = "rightcode"
base_url = "https://rightapi.ai/codex/v1"
wire_api = "responses"
requires_openai_auth = true
```

The page instructs Codex users to restart after changing configuration and avoid changing models inside an active session. Those are Codex-client instructions, not a stated requirement for standalone HTTP requests.

## Conflicting reasoning examples

The [Codex FAQ](https://docs.rightapi.ai/docs/rc_questions/codex) instead gives:

```sh
codex -m gpt-5.6-sol -c model_reasoning_effort="ultra"
```

Thus the two official pages disagree between `xhigh` and `ultra`. Neither fetched page explicitly states that `medium` or `high` is unsupported. Do not infer a required API reasoning value from one CLI example or silently change the user's selected setting.

## Raw API contract

The [official curl examples](https://docs.rightapi.ai/docs/rc_extension/curl) document:

- `POST https://www.rightapi.ai/codex/v1/responses`.
- `Authorization: Bearer <API_KEY>` or `x-api-key: <API_KEY>`; either may be used.
- Message/input_text content with `stream: true`.
- `/chat/completions` is translated from `/responses`, can have compatibility limitations, does not support cache, and replaces the system prompt with default Codex instructions.

The current JarvisHub base path and Responses protocol match these instructions. The raw curl page still uses GPT-5.2 as its example; it does not establish Sol/Terra's full accepted parameter matrix.

## Availability and limits of the evidence

The [documentation homepage](https://docs.rightapi.ai/) advertises 99.9% service availability, intelligent routing, and failover. These are general product claims, not incident-level evidence or proof that our model call works.

No public official notice specifically explaining our current Terra 401/timeouts or Sol parsed-empty responses was found in the searched/fetched sources. The main account website is JavaScript-rendered; private/dashboard announcements were not inspected. Search-index absence is not proof that no incident exists.

Earlier probes established model-dependent results using the same client and credential, but the client's `LLM 返回空响应` error means its parsed result had no usable output. It does not, by itself, prove that the raw HTTP/SSE body was empty or exclude a parser incompatibility.

## Next diagnostic

If authorized, test the manual page's Sol + xhigh combination with one no-tool request and capture sanitized raw SSE event types/status/error fields. Compare raw transport output with the actual JarvisHub parser. Distinguish inference failure from parser failure before attributing the empty output to the provider or changing application defaults.
