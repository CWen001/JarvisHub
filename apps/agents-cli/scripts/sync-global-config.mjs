import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cwd = process.cwd();
const localConfigPath = path.join(cwd, "agents.config.json");
const localEnvPath = path.join(cwd, ".env");

const localConfig = readJson(localConfigPath);
const envConfig = readEnv(localEnvPath);
const globalDir = resolveAgentsHome(envConfig);
const globalConfigPath = path.join(globalDir, "agents.config.json");
const shouldSyncGlobal = isTruthy(process.env.AGENTS_SYNC_GLOBAL ?? envConfig.AGENTS_SYNC_GLOBAL);

const apiKey = localConfig?.apiKey ?? envConfig.AGENTS_API_KEY ?? envConfig.RIGHT_CODES_API_KEY;
const globalConfig = {
  apiBaseUrl: localConfig?.apiBaseUrl ?? envConfig.AGENTS_API_BASE_URL,
  apiKey,
  model: localConfig?.model ?? envConfig.AGENTS_MODEL,
  apiStyle: localConfig?.apiStyle ?? envConfig.AGENTS_API_STYLE,
  stream: localConfig?.stream ?? (envConfig.AGENTS_STREAM === "true"),
  worldApiUrl: localConfig?.worldApiUrl ?? envConfig.AGENTS_WORLD_API_URL,
  canvasApiBaseUrl:
    localConfig?.canvasApiBaseUrl ??
    envConfig.canvasApiBaseUrl ??
    envConfig.CANVAS_API_BASE_URL,
  canvasApiKey:
    localConfig?.canvasApiKey ??
    envConfig.canvasApiKey ??
    envConfig.CANVAS_API_KEY,
  canvasAuthorization:
    localConfig?.jarvishubAuthorization ??
    envConfig.jarvishubAuthorization ??
    envConfig.JARVISHUB_AUTHORIZATION,
};

try {
  if (!shouldSyncGlobal) {
    process.exit(0);
  }
  fs.mkdirSync(globalDir, { recursive: true });
  if (apiKey) {
    fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig, null, 2), "utf-8");
  }
  syncDir(path.join(cwd, "dist"), path.join(globalDir, "dist"));
  syncDir(path.join(cwd, "skills"), path.join(globalDir, "skills"));
} catch {
  process.exit(0);
}

function resolveAgentsHome(envConfig) {
  const envHome = process.env.AGENTS_HOME;
  if (typeof envHome === "string" && envHome.trim()) {
    return path.resolve(envHome.trim());
  }
  const fileHome = envConfig.AGENTS_HOME;
  if (typeof fileHome === "string" && fileHome.trim()) {
    return path.resolve(fileHome.trim());
  }
  return path.join(os.homedir(), ".agents");
}

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function syncDir(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    const value = rawValue.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    env[key] = value;
  }
  return env;
}
