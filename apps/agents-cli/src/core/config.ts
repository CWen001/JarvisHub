import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentConfig } from "../types/index.js";
import { DEFAULT_ROOT_PERSONA_INTRO } from "./root-persona.js";

export const DEFAULT_MAX_ALLOWED_TOOLS = 128;
export const MAX_ALLOWED_TOOLS_HARD_LIMIT = 1024;

const DEFAULT_CONFIG: AgentConfig = {
  apiBaseUrl: "https://right.codes/codex/v1",
  apiKey: "",
  // model: "gpt-5.3-codex",
  model: "gpt-5.5",
  apiStyle: "responses",
  stream: true,
  memoryDir: ".agents/memory",
  skillsDir: "skills",
  workspaceRoot: "",
  worldApiUrl: "",
  maxTurns: 64,
  maxAllowedTools: DEFAULT_MAX_ALLOWED_TOOLS,
  maxSubagentDepth: 2,
  agentIntro: [
    DEFAULT_ROOT_PERSONA_INTRO,
    "遵循：计划（plan）→ 使用工具行动（act）→ 汇报（report）。需要领域知识时优先用 Skill 加载技能；多步任务优先用 task_* 维护持久化任务图；需要并行子任务时用 Agent 工具按 subagent_type 派发同步子代理。",
  ].join(" "),
};

export function loadConfig(cwd: string): AgentConfig {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const globalDir = getAgentsHomeDir();
  loadDotEnv(globalDir);
  loadDotEnv(cwd);
  const globalConfigPath = path.join(globalDir, "agents.config.json");
  const configPath = path.join(cwd, "agents.config.json");
  let globalConfig: Partial<AgentConfig> = {};
  let fileConfig: Partial<AgentConfig> = {};
  if (fs.existsSync(globalConfigPath)) {
    const raw = fs.readFileSync(globalConfigPath, "utf-8");
    globalConfig = JSON.parse(raw) as Partial<AgentConfig>;
  }
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf-8");
    fileConfig = JSON.parse(raw) as Partial<AgentConfig>;
  }

  const envConfig = pickDefined<Partial<AgentConfig>>({
    apiBaseUrl: process.env.AGENTS_API_BASE_URL,
    apiKey: process.env.AGENTS_API_KEY,
    model: process.env.AGENTS_MODEL,
    apiStyle: process.env.AGENTS_API_STYLE as AgentConfig["apiStyle"],
    stream: process.env.AGENTS_STREAM
      ? process.env.AGENTS_STREAM === "true"
      : undefined,
    memoryDir: process.env.AGENTS_MEMORY_DIR,
    skillsDir: process.env.AGENTS_SKILLS_DIR,
    worldApiUrl: process.env.AGENTS_WORLD_API_URL,
    workspaceRoot: process.env.AGENTS_WORKSPACE_ROOT,
    maxAllowedTools:
      typeof process.env.AGENTS_MAX_ALLOWED_TOOLS === "string" &&
      process.env.AGENTS_MAX_ALLOWED_TOOLS.trim()
        ? normalizeMaxAllowedTools(process.env.AGENTS_MAX_ALLOWED_TOOLS, "AGENTS_MAX_ALLOWED_TOOLS")
        : undefined,
  });

  const merged = {
    ...DEFAULT_CONFIG,
    ...globalConfig,
    ...fileConfig,
    ...envConfig,
  } as AgentConfig;
  merged.workspaceRoot =
    typeof merged.workspaceRoot === "string" && merged.workspaceRoot.trim()
      ? path.resolve(cwd, merged.workspaceRoot.trim())
      : workspaceRoot;
  merged.apiBaseUrl = normalizeApiBaseUrl(merged.apiBaseUrl);
  merged.maxAllowedTools = normalizeMaxAllowedTools(merged.maxAllowedTools, "maxAllowedTools");

  if (!merged.apiKey) {
    const altKey = process.env.AGENTS_API_KEY;
    if (altKey) {
      merged.apiKey = altKey;
    }
  }

  return merged;
}

export function resolveWorkspaceRoot(cwd: string): string {
  const envRoot = typeof process.env.AGENTS_WORKSPACE_ROOT === "string"
    ? process.env.AGENTS_WORKSPACE_ROOT.trim()
    : "";
  if (envRoot) {
    return path.resolve(cwd, envRoot);
  }

  const start = path.resolve(cwd);
  let current = start;
  let skillsOnlyCandidate = "";
  while (true) {
    const projectMarkers = [
      path.join(current, "pnpm-workspace.yaml"),
      path.join(current, "agents.config.json"),
    ];
    if (projectMarkers.some((marker) => fs.existsSync(marker))) {
      return current;
    }
    if (!skillsOnlyCandidate && fs.existsSync(path.join(current, "skills"))) {
      skillsOnlyCandidate = current;
    }
    const parent = path.dirname(current);
    if (parent === current) return skillsOnlyCandidate || start;
    current = parent;
  }
}

export function ensureConfig(cwd: string): AgentConfig {
  const config = loadConfig(cwd);
  if (!config.apiKey) {
    throw new Error("缺少 API Key，请在 agents.config.json 或 AGENTS_API_KEY 中配置。");
  }
  return config;
}

export function loadServeConfig(cwd: string): AgentConfig {
  return loadConfig(cwd);
}

function normalizeApiBaseUrl(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return trimmed;
  return trimmed.replace(/\/+$/, "");
}

export function normalizeMaxAllowedTools(raw: unknown, label: string): number {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw.trim())
        : DEFAULT_MAX_ALLOWED_TOOLS;
  if (!Number.isInteger(value) || value < 1 || value > MAX_ALLOWED_TOOLS_HARD_LIMIT) {
    throw new Error(`${label} 必须是 1 到 ${MAX_ALLOWED_TOOLS_HARD_LIMIT} 之间的整数。`);
  }
  return value;
}

function loadDotEnv(cwd: string) {
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    const value = rawValue.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const entries = Object.entries(obj).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as Partial<T>;
}

export function writeGlobalConfig(config: AgentConfig) {
  tryWriteGlobalConfig(config);
}

function tryWriteGlobalConfig(config: AgentConfig) {
  const globalDir = getAgentsHomeDir();
  const globalConfigPath = path.join(globalDir, "agents.config.json");
  try {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      globalConfigPath,
      JSON.stringify(
        pickDefined({
          apiBaseUrl: config.apiBaseUrl,
          apiKey: config.apiKey,
          model: config.model,
          apiStyle: config.apiStyle,
          stream: config.stream,
          worldApiUrl: config.worldApiUrl,
          maxAllowedTools: config.maxAllowedTools,
        }),
        null,
        2
      ),
      "utf-8"
    );
  } catch {
    // Ignore global cache failures to avoid blocking runtime.
  }
}

export function getAgentsHomeDir(): string {
  const fromEnv = typeof process.env.AGENTS_HOME === "string" ? process.env.AGENTS_HOME.trim() : "";
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), ".agents");
}
