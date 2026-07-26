#!/usr/bin/env node
import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const DEFAULT_API_BASE_URL = "https://right.codes/codex/v1";
const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_COUNT = 5;
const DEFAULT_TIMEOUT_MS = 30_000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const agentsCliRoot = path.resolve(__dirname, "..");

function usage() {
  return [
    "Usage: node scripts/check-llm-connectivity.mjs [options]",
    "",
    "Options:",
    "  --base-url <url>       Override AGENTS_API_BASE_URL / apiBaseUrl",
    "  --api-key <key>        Override AGENTS_API_KEY / apiKey",
    "  --model <model>        Override AGENTS_MODEL / model",
    "  --count <n>            Authenticated POST attempts (default: 5)",
    "  --timeout-ms <n>       Per-step timeout in ms (default: 30000)",
    "  --skip-post            Only run DNS/TCP/TLS/HTTP probes",
    "  --dns-order <mode>     ipv4first | verbatim",
    "  --help                 Show this help",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    baseUrl: "",
    apiKey: "",
    model: "",
    count: DEFAULT_COUNT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    skipPost: false,
    dnsOrder: "",
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      return argv[i] || "";
    };
    if (arg === "--") continue;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--base-url") out.baseUrl = next();
    else if (arg === "--api-key") out.apiKey = next();
    else if (arg === "--model") out.model = next();
    else if (arg === "--count") out.count = readPositiveInteger(next(), DEFAULT_COUNT);
    else if (arg === "--timeout-ms") out.timeoutMs = readPositiveInteger(next(), DEFAULT_TIMEOUT_MS);
    else if (arg === "--skip-post") out.skipPost = true;
    else if (arg === "--dns-order") out.dnsOrder = next();
    else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function readPositiveInteger(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.trunc(value);
}

function findWorkspaceRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

function getAgentsHomeDir() {
  const explicit = process.env.AGENTS_HOME?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(os.homedir(), ".agents");
}

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    const value = rawValue.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (!process.env[key]) process.env[key] = value;
  }
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
}

function readString(source, key) {
  const value = source?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(raw) {
  return String(raw || "").trim().replace(/\/+$/, "");
}

function loadConfig(overrides) {
  const workspaceRoot = findWorkspaceRoot(process.cwd()) || findWorkspaceRoot(agentsCliRoot);
  const agentsHome = getAgentsHomeDir();
  const envDirs = [
    agentsHome,
    workspaceRoot,
    agentsCliRoot,
    process.cwd(),
  ].filter(Boolean);
  for (const dir of envDirs) loadDotEnvFile(path.join(dir, ".env"));

  const globalConfig = readJsonFile(path.join(agentsHome, "agents.config.json"));
  const workspaceConfig = workspaceRoot
    ? readJsonFile(path.join(workspaceRoot, "agents.config.json"))
    : {};
  const localConfig = readJsonFile(path.join(agentsCliRoot, "agents.config.json"));
  const cwdConfig = readJsonFile(path.join(process.cwd(), "agents.config.json"));

  const fileConfig = {
    ...globalConfig,
    ...workspaceConfig,
    ...localConfig,
    ...cwdConfig,
  };

  const envBaseUrl = process.env.AGENTS_API_BASE_URL || "";
  const envApiKey = process.env.AGENTS_API_KEY || process.env.RIGHT_CODES_API_KEY || "";
  const envModel = process.env.AGENTS_MODEL || "";

  return {
    apiBaseUrl: normalizeBaseUrl(
      overrides.baseUrl ||
        envBaseUrl ||
        readString(fileConfig, "apiBaseUrl") ||
        DEFAULT_API_BASE_URL,
    ),
    apiKey:
      overrides.apiKey ||
      envApiKey ||
      readString(fileConfig, "apiKey") ||
      readString(fileConfig, "AGENTS_API_KEY"),
    model: overrides.model || envModel || readString(fileConfig, "model") || DEFAULT_MODEL,
  };
}

function redactSecret(value) {
  const text = String(value || "");
  if (!text) return "(missing)";
  if (text.length <= 10) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

async function timed(label, fn) {
  const started = performance.now();
  try {
    const value = await fn();
    return {
      ok: true,
      label,
      durationMs: Math.round(performance.now() - started),
      value,
    };
  } catch (error) {
    return {
      ok: false,
      label,
      durationMs: Math.round(performance.now() - started),
      error,
    };
  }
}

function formatError(error) {
  const err = error instanceof Error ? error : new Error(String(error));
  const cause = err.cause;
  const causeRecord =
    cause && typeof cause === "object" && !Array.isArray(cause) ? cause : {};
  const causeCode = typeof causeRecord.code === "string" ? causeRecord.code : "";
  const causeMessage =
    causeRecord instanceof Error
      ? causeRecord.message
      : typeof causeRecord.message === "string"
        ? causeRecord.message
        : "";
  return [
    err.message,
    causeCode ? `cause.code=${causeCode}` : "",
    causeMessage ? `cause.message=${causeMessage}` : "",
  ].filter(Boolean).join(" ");
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${ms}ms`)), ms);
  return {
    signal: controller.signal,
    done: () => clearTimeout(timer),
  };
}

async function probeDns(hostname) {
  return dns.promises.lookup(hostname, { all: true });
}

async function probeTcp(hostname, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: hostname, port });
    const timer = setTimeout(() => {
      socket.destroy(new Error(`tcp timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      const info = {
        localAddress: socket.localAddress || "",
        remoteAddress: socket.remoteAddress || "",
        remotePort: socket.remotePort || port,
      };
      socket.end();
      resolve(info);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function probeTls(hostname, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: hostname,
      port,
      servername: hostname,
      rejectUnauthorized: true,
    });
    const timer = setTimeout(() => {
      socket.destroy(new Error(`tls timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      const cert = socket.getPeerCertificate();
      const info = {
        authorized: socket.authorized,
        authorizationError: socket.authorizationError || "",
        protocol: socket.getProtocol() || "",
        cipher: socket.getCipher()?.name || "",
        certificateSubject: cert && typeof cert.subject === "object" ? cert.subject.CN || "" : "",
        validTo: cert && typeof cert.valid_to === "string" ? cert.valid_to : "",
      };
      socket.end();
      resolve(info);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function fetchText(url, init, timeoutMs) {
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: timeout.signal,
    });
    const text = await response.text().catch((error) => `<<body read failed: ${formatError(error)}>>`);
    return {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type") || "",
      requestId:
        response.headers.get("x-request-id") ||
        response.headers.get("cf-ray") ||
        response.headers.get("x-amzn-requestid") ||
        "",
      bodyPreview: text.trim().slice(0, 500),
    };
  } finally {
    timeout.done();
  }
}

function buildResponsesPayload(model) {
  return {
    model,
    store: false,
    stream: false,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Connectivity check. Reply with pong.",
          },
        ],
      },
    ],
    tools: [],
  };
}

function printProbe(result) {
  const prefix = result.ok ? "OK " : "ERR";
  if (result.ok) {
    console.log(`${prefix} ${result.label} ${result.durationMs}ms ${JSON.stringify(result.value)}`);
  } else {
    console.log(`${prefix} ${result.label} ${result.durationMs}ms ${formatError(result.error)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const dnsOrder = args.dnsOrder || process.env.AGENTS_DNS_RESULT_ORDER || "";
  if (dnsOrder === "ipv4first" || dnsOrder === "verbatim") {
    dns.setDefaultResultOrder(dnsOrder);
  }

  const config = loadConfig(args);
  const baseUrl = normalizeBaseUrl(config.apiBaseUrl);
  const responsesUrl = `${baseUrl}/responses`;
  const parsedUrl = new URL(baseUrl);
  const hostname = parsedUrl.hostname;
  const port = Number(parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80));
  const timeoutMs = args.timeoutMs;

  console.log("LLM connectivity diagnostics");
  console.log(`baseUrl=${baseUrl}`);
  console.log(`responsesUrl=${responsesUrl}`);
  console.log(`model=${config.model}`);
  console.log(`apiKey=${redactSecret(config.apiKey)}`);
  console.log(`count=${args.skipPost ? 0 : args.count} timeoutMs=${timeoutMs} dnsOrder=${dns.getDefaultResultOrder()}`);

  printProbe(await timed("dns.lookup", () => probeDns(hostname)));
  printProbe(await timed("tcp.connect", () => probeTcp(hostname, port, timeoutMs)));
  if (parsedUrl.protocol === "https:") {
    printProbe(await timed("tls.connect", () => probeTls(hostname, port, timeoutMs)));
  }
  printProbe(await timed("http.get.base", () => fetchText(baseUrl, { method: "GET" }, timeoutMs)));

  if (args.skipPost) return;
  if (!config.apiKey) {
    console.log("ERR responses.post skipped: missing AGENTS_API_KEY / apiKey");
    process.exitCode = 2;
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
    "x-api-key": config.apiKey,
  };
  const payload = buildResponsesPayload(config.model);
  const failures = [];
  for (let index = 1; index <= args.count; index += 1) {
    const result = await timed(`responses.post#${index}`, () =>
      fetchText(
        responsesUrl,
        {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        },
        timeoutMs,
      ),
    );
    printProbe(result);
    if (!result.ok || !result.value?.ok) {
      failures.push(result.ok ? `http_${result.value.status}` : formatError(result.error));
    }
  }

  const okCount = args.count - failures.length;
  console.log(`summary responses.post ok=${okCount} failed=${failures.length} total=${args.count}`);
  if (failures.length) {
    const grouped = new Map();
    for (const failure of failures) grouped.set(failure, (grouped.get(failure) || 0) + 1);
    for (const [failure, count] of grouped.entries()) {
      console.log(`failure ${count}x ${failure}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
