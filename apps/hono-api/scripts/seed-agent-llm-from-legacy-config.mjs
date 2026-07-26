#!/usr/bin/env node
// Seeds the model-catalog DB with the agent backbone LLM credentials
// previously hardcoded in apps/agents-cli/agents.config.json.
//
// Idempotent: re-runs upsert via the same service layer the UI calls.
//
// Usage:
//   node apps/hono-api/scripts/seed-agent-llm-from-legacy-config.mjs
//   API_BASE_URL=http://127.0.0.1:8788 node ... (override default)
//   AGENTS_CONFIG_PATH=/abs/path/agents.config.json node ... (override default)
//
// Prerequisite: hono-api must be running (default http://127.0.0.1:8788).
// After this script reports success, MANUALLY remove apiKey/apiBaseUrl/model
// from apps/agents-cli/agents.config.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8788";
const AGENTS_CONFIG_PATH =
	process.env.AGENTS_CONFIG_PATH ||
	path.resolve(REPO_ROOT, "apps/agents-cli/agents.config.json");

const VENDOR_KEY = "sssaicode";
const VENDOR_NAME = "SSS AI Code";
const DEFAULT_SLOT = "agent";

function readLegacyConfig() {
	if (!fs.existsSync(AGENTS_CONFIG_PATH)) {
		throw new Error(`agents.config.json not found at ${AGENTS_CONFIG_PATH}`);
	}
	const raw = fs.readFileSync(AGENTS_CONFIG_PATH, "utf8");
	const cfg = JSON.parse(raw);
	const apiBaseUrl = typeof cfg.apiBaseUrl === "string" ? cfg.apiBaseUrl.trim() : "";
	const apiKey = typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "";
	const model = typeof cfg.model === "string" ? cfg.model.trim() : "";
	if (!apiBaseUrl || !apiKey || !model) {
		throw new Error(
			`agents.config.json missing one of apiBaseUrl/apiKey/model — already migrated? (file: ${AGENTS_CONFIG_PATH})`,
		);
	}
	return { apiBaseUrl, apiKey, model };
}

async function http(method, pathname, body, query) {
	const url = new URL(pathname, API_BASE_URL);
	if (query) {
		for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
	}
	const res = await fetch(url, {
		method,
		headers: body ? { "content-type": "application/json" } : {},
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	let parsed = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = text;
	}
	if (!res.ok) {
		throw new Error(
			`${method} ${url.pathname} → ${res.status} ${res.statusText}\n${typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)}`,
		);
	}
	return parsed;
}

function redact(key) {
	if (!key) return "";
	if (key.length <= 12) return "***";
	return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

async function main() {
	console.log(`[seed] reading legacy config: ${AGENTS_CONFIG_PATH}`);
	const legacy = readLegacyConfig();
	console.log(`[seed] api base : ${legacy.apiBaseUrl}`);
	console.log(`[seed] api key  : ${redact(legacy.apiKey)}`);
	console.log(`[seed] model    : ${legacy.model}`);
	console.log(`[seed] target   : ${API_BASE_URL}`);

	console.log(`[seed] importing provider+key+model into model catalog...`);
	const importResult = await http(
		"POST",
		"/model-config/import",
		{
			version: 1,
			providers: [
				{
					key: VENDOR_KEY,
					name: VENDOR_NAME,
					enabled: true,
					baseUrl: legacy.apiBaseUrl,
					authType: "bearer",
					apiKey: legacy.apiKey,
				},
			],
			models: [
				{
					providerKey: VENDOR_KEY,
					modelKey: legacy.model,
					modelAlias: legacy.model,
					label: legacy.model,
					kind: "multimodal",
					enabled: true,
				},
			],
		},
		{ includeApiKeys: "true" },
	);
	console.log(
		`[seed]   imported: providers=${importResult?.imported?.providers ?? 0}, apiKeys=${importResult?.imported?.apiKeys ?? 0}, models=${importResult?.imported?.models ?? 0}`,
	);

	console.log(`[seed] setting default slot=${DEFAULT_SLOT} → (${VENDOR_KEY}, ${legacy.model})...`);
	const defaultResult = await http(
		"PUT",
		`/model-config/defaults/${encodeURIComponent(DEFAULT_SLOT)}`,
		{ vendorKey: VENDOR_KEY, modelKey: legacy.model },
	);
	console.log(
		`[seed]   default set: slot=${defaultResult?.slot}, vendor=${defaultResult?.vendorKey}, model=${defaultResult?.modelKey}, kind=${defaultResult?.kind}`,
	);

	console.log(`[seed] verifying via GET /model-config ...`);
	const config = await http("GET", "/model-config");
	const provider = (config.providers || []).find((p) => p.key === VENDOR_KEY);
	const model = (config.models || []).find(
		(m) => m.providerKey === VENDOR_KEY && m.modelKey === legacy.model,
	);
	const agentDefault = (config.defaults || []).find((d) => d.slot === DEFAULT_SLOT);

	console.log(`[seed]   vendor present       : ${!!provider}  (apiKeyConfigured=${provider?.apiKeyConfigured})`);
	console.log(`[seed]   model present        : ${!!model}  (kind=${model?.kind})`);
	console.log(`[seed]   agent default present: ${!!agentDefault}  (${agentDefault?.vendorKey}/${agentDefault?.modelKey})`);

	if (!provider || !provider.apiKeyConfigured || !model || !agentDefault) {
		throw new Error("verification failed — DB state does not match expectations");
	}

	console.log("");
	console.log("[seed] ✅ done. Next manual step:");
	console.log("[seed]    Edit apps/agents-cli/agents.config.json and remove these three keys:");
	console.log("[seed]      - apiBaseUrl");
	console.log("[seed]      - apiKey");
	console.log("[seed]      - model");
	console.log("[seed]    (DO NOT auto-edit; multi-machine setups may need to seed each separately.)");
}

main().catch((err) => {
	console.error("[seed] FAILED:", err.message);
	process.exit(1);
});
