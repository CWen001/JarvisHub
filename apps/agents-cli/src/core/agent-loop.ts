import { randomUUID } from "node:crypto";

import {
  AgentConfig,
  CapabilityGrant,
  Message,
  ToolCall,
  ToolDefinition,
} from "../types/index.js";
import { LLMClient } from "../llm/client.js";
import { GeminiClient } from "../llm/gemini-client.js";
import { AnthropicClient } from "../llm/anthropic-client.js";
import type { LLMAdapter } from "../llm/adapter.js";

export type AgentLlmCredsApiProtocol =
  | "openai-chat"
  | "openai-responses"
  | "google-v1beta"
  | "anthropic-messages";

export type AgentLlmCreds = {
  apiKey: string;
  baseUrl: string;
  model: string;
  apiProtocol?: AgentLlmCredsApiProtocol;
};

function buildClientForCreds(baseConfig: AgentConfig, creds: AgentLlmCreds): LLMAdapter {
  console.log(
    `[diag.buildClientForCreds] apiProtocol=${creds.apiProtocol ?? "<undefined>"} baseUrl=${creds.baseUrl} model=${creds.model || baseConfig.model}`,
  );
  if (creds.apiProtocol === "google-v1beta") {
    console.log(`[diag.buildClientForCreds] → GeminiClient`);
    return new GeminiClient({
      apiKey: creds.apiKey,
      apiBaseUrl: creds.baseUrl,
      model: creds.model || baseConfig.model,
    });
  }
  if (creds.apiProtocol === "anthropic-messages") {
    console.log(`[diag.buildClientForCreds] → AnthropicClient`);
    return new AnthropicClient({
      apiKey: creds.apiKey,
      apiBaseUrl: creds.baseUrl,
      model: creds.model || baseConfig.model,
    });
  }
  console.log(`[diag.buildClientForCreds] → LLMClient (openai-compat)`);
  const nextApiStyle: AgentConfig["apiStyle"] =
    creds.apiProtocol === "openai-chat"
      ? "chat"
      : creds.apiProtocol === "openai-responses"
        ? "responses"
        : baseConfig.apiStyle;
  return new LLMClient({
    ...baseConfig,
    apiStyle: nextApiStyle,
    apiKey: creds.apiKey || baseConfig.apiKey,
    apiBaseUrl: creds.baseUrl || baseConfig.apiBaseUrl,
    model: creds.model || baseConfig.model,
  });
}
import { ToolRegistry, type GenerationAttemptRecord, type ToolRuntimeState } from "./tools/registry.js";
import { AGENT_OUTPUT_REFERENCE_PREFIX } from "./canonical-text-artifacts.js";
import { SkillLoader } from "./skills/loader.js";
import { getAgentDescriptions } from "./subagent/types.js";
import { normalizeToolOutput } from "./message-limits.js";
import { HookRunner } from "./hooks/runner.js";
import type { LlmTurnTrace, RunHookContext, ToolCallTrace } from "./hooks/types.js";
import { evaluateToolPolicy, recordPolicyDecision } from "./policy-engine.js";
import { BackgroundTaskManager } from "./background/manager.js";
import { TaskBoard, type TaskBoardEntry } from "./runtime/task-board.js";
import { buildToolCallTrace } from "./tool-call-trace.js";
import {
  evaluateWebHeroStagePrecondition,
  verifyWebHeroSectionDraftWritePrecondition,
  verifyWebHeroMergeDispatchPrecondition,
  verifyWebHeroPreviewDispatchPrecondition,
} from "./webhero-stage-precondition.js";
import {
  buildCapabilityGrant,
  buildRunEnvelope,
  normalizeWorkspaceResourceRoots,
  readCapabilityGrant,
} from "./capability-resolver.js";
import { resolveAgentRunContext } from "./context-pipeline.js";
import { finalizeRunResult, joinSystemSections, reportRunError } from "./finish-policy.js";
import { extractMemoryInsights } from "./memory/extractor.js";
import { AgentSessionEngine } from "./session/session-engine.js";
import { traceContext } from "../runtime/trace-context.js";
import { resolveCapabilityPlane } from "./capability-plane.js";
import { executeAgentTurn } from "./turn-engine.js";
import { recordToolBatchSummary } from "./tool-batch-summary.js";
import {
  executeRemoteTool,
  normalizeRemoteToolDefinitions,
  readRemoteToolConfig,
  readRemoteToolDefinitions,
  RemoteToolExecutionError,
} from "./tools/remote.js";
import { maybeAutoSnapshotBeforeTurn } from "./tools/canvas-checkpoint.js";
import { drainVisionQueue } from "./tools/vision-queue.js";
import {
  canvasGenerationToolKind,
  getCanvasLayoutSlotKey,
  recordCanvasGenerationAttempt,
  recordCanvasGenerationWaitResult,
} from "./tools/canvas-attempts.js";
import { buildRuntimeChannelSystemFragment, readRuntimeChannelDescriptor } from "../runtime/channel.js";
import { CANVAS_ROOT_AGENT_DENIED_TOOLS } from "../runtime/canvas-tool-set.js";
import { ToolExecutor, type ToolCatalog } from "./tool-catalog.js";
import { buildModelFacingToolResultContent } from "./tools/model-facing-tool-result.js";

type RunSystemMode =
  | { kind: "root" }
  | { kind: "provided"; system: string };

type RunOptions = {
  depth?: number;
  workspaceResourceRoots?: string[];
  systemOverride?: string;
  systemMode?: RunSystemMode;
  sessionId?: string;
  ephemeralUserPrompt?: boolean;
  requiredSkills?: string[];
  maxTurns?: number;
  modelOverride?: string;
  currentLlmCreds?: AgentLlmCreds;
  compactPrelude?: boolean;
  omitSkillCatalog?: boolean;
  allowedTools?: Set<string> | null;
  onToolStart?: (payload: {
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
    startedAt: string;
  }) => void;
  onToolCall?: (toolCall: ToolCallTrace) => void;
  onTurn?: (turn: LlmTurnTrace) => void;
  onTextDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
  history?: Message[];
  toolContextMeta?: Record<string, unknown>;
  state?: ToolRuntimeState;
};

type FinishBlockDecision = {
  reason: string;
  message: string;
};

type AskUserToolPrompt = {
  toolCallId: string;
  question: string;
  options: string[];
  urgency: "info" | "confirmation" | "blocker";
};

function readStructuredOutputFromToolError(error: unknown): Record<string, unknown> | undefined {
  if (error instanceof RemoteToolExecutionError && error.structuredOutput) {
    return error.structuredOutput;
  }
  return undefined;
}

const ASK_USER_TOOL_NAME = "ask_user";
const ASK_USER_TURN_GATE_BLOCK_REASON =
  "未执行：同一轮工具调用中包含 ask_user，runtime 必须先等待用户回复，禁止在确认前执行其它工具。若这些调用仍然需要，请在下一轮重新发起。";

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  const text = typeof reason === "string" ? reason.trim() : "";
  throw new Error(text || "运行已中止。");
}

function isRootCanvasRun(options: RunOptions): boolean {
  return (options.depth ?? 0) === 0 && options.toolContextMeta?.runtimeHarness === "canvas";
}

function buildRootCanvasDeniedTools(options: RunOptions): Set<string> | null {
  if (!isRootCanvasRun(options)) return null;
  return new Set(CANVAS_ROOT_AGENT_DENIED_TOOLS);
}

function filterAllowedTools(
  allowedTools: Set<string> | null,
  disallowedTools: Set<string> | null,
): Set<string> | null {
  if (!allowedTools || !disallowedTools) return allowedTools;
  const out = new Set(allowedTools);
  for (const name of Array.from(out)) {
    if (disallowedTools.has(name)) out.delete(name);
  }
  return out;
}

function isLlmFetchFailedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code === "llm_fetch_failed";
}

function parseTurnFetchRetryCount(): number {
  const raw = process.env.AGENTS_TURN_FETCH_RETRIES;
  if (!raw) return 3;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 3;
  return Math.max(0, Math.min(6, Math.trunc(n)));
}


async function runTurnWithFetchRetry<T>(args: {
  maxOuterRetries: number;
  execute: () => Promise<T>;
  abortSignal?: AbortSignal;
}): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await args.execute();
    } catch (error) {
      if (!isLlmFetchFailedError(error) || attempt >= args.maxOuterRetries) {
        throw error;
      }
      throwIfAborted(args.abortSignal);
      const waitMs = Math.min(60_000, 8_000 + 12_000 * attempt);
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      throwIfAborted(args.abortSignal);
    }
  }
}

function buildSystemBootstrap(
  config: AgentConfig,
  skills: SkillLoader,
  options?: {
    compact?: boolean;
    requiredSkills?: string[];
    capabilityGrant?: CapabilityGrant | null;
    omitSkillCatalog?: boolean;
  }
) {
  const compact = options?.compact === true;
  const requiredSkills = Array.isArray(options?.requiredSkills)
    ? options.requiredSkills.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  const rules = [
    "默认身份是通用型智能体助手与编排器，不要因为具备代码工具就自动把任务收窄成 code agent 工作流。",
    "多阶段任务必须渐进加载 Skill：先加载当前阶段的总控/编排类 Skill 做 stage decision；只有进入对应 phase 后，才加载该 phase 的 specialist Skill。禁止一次性预加载未来 phase 的 Skill。",
    "单阶段任务与某个 Skill 的描述明确匹配时，可以调用 Skill 工具加载该技能。",
    "TodoWrite 用于同步主任务进度。面对多步骤执行任务，先将工作拆成可执行的里程碑 checklist；执行过程中，每完成一个里程碑，立即更新对应 Todo 状态，并将下一项推进为 in_progress；如果任务路径发生变化，及时调整 TodoWrite，使 checklist 反映当前真实执行路径。Skill 只提供知识，不替代你的判断。",
    "你是编排器：素材生成（图像/视频/storyboard/preview 截图）、外部搜索（风格/灵感/图标/资产）、画布资产整理与归档、基于既有节点或文档做的长上下文 summary 这类可独立完成、会污染主上下文的子任务，应优先通过 Agent 工具派给 sub-agent。画布 harness 下 sub-agent 类型按四个动作划分：explore（搜索/读画布事实）→ plan（综合方案/脚本/wireframe）→ media（生成画布素材，可后台）→ critic（多模态评审）。是否派、派几次、什么时候派，根据本轮用户实际范围、当前阶段与依赖判断；不要把 sub-agent 当装饰、也不要为了凑数硬派。",
		"画布 harness 的主 Agent 禁止直接调用媒体生产、等待、拼接或评审读取工具；生成、等待和拼接交给 media sub-agent，成品评审读取交给 critic sub-agent。内部媒体引用必须只传稳定 sourceNodeId/assetId，禁止在 Agent 或 sub-agent 参数、prompt、报告中复制内部 URL。media sub-agent 必须遵循 Generate -> Wait -> status=success/persisted=true 的完成证据链；主 Agent 通过 canvas_flow_inspect、task_board_read 和 sub-agent 结构化报告维护 ID 状态账本与冲突裁决。只有确定重生成时才用 canvas_generation_context_get 读取单节点生成上下文；完整 canvas_flow_get 仅用于确实需要完整业务节点 data 的重型路径。",
    "派发 sub-agent 前必须先看 Capability Grant 的 readableRoots/writableRoots：目标路径不在可读/可写范围、或当前 profile 禁用相应工具时，禁止派 sub-agent 试探；直接把边界回给用户并建议合适的入口（例如代码检查类任务应使用代码 chat 而非画布 chat）。",
    "sub-agent 返回沙箱/权限/路径越界/“out of scope/超出可读范围/不在当前可读权限范围内”等失败时，不得换路径、换措辞重试同一类越界请求；最多确认一次后立即把限制回给用户，列出实际 readableRoots 与所需路径的差异。",
    "多步任务优先使用 task_create/task_update/task_list/task_get 维护持久化任务图。",
    "派发 sub-agent 前，主 Agent 明确当前阶段目标；sub-agent 返回结果后，主 Agent 根据结果更新 TodoWrite，并让最终回复与 TodoWrite、工具结果、画布状态保持一致。",
    "当现有 Skill 无法满足任务质量要求时，可以新增 Skill；但禁止删除、覆盖或修改任何现有 Skill。",
    "优先使用工具解决问题，不要只解释不行动。",
    "只能通过本轮 tools 数组中显式列出的 function tools 执行动作；不要调用 Responses 或网关内置的 hosted tools（例如 image_generation_call）。如果没有合适工具，必须显式说明缺口。",
    "完成后用简洁中文总结产出。",
  ].join("\n- ");
  const capabilityBlock = options?.capabilityGrant
    ? [
        "**Capability Grant**",
        `- readableRoots: ${options.capabilityGrant.readableRoots.join(", ") || "none"}`,
        `- writableRoots: ${options.capabilityGrant.writableRoots.join(", ") || "none"}`,
        `- network: ${options.capabilityGrant.network}`,
      ].join("\n")
    : "";
  const skillBlock = options?.omitSkillCatalog === true
    ? ""
    : skills.renderSkillsSection({ requiredSkills });
  const subagentsBlock = compact
    ? ""
    : [
        "**可用 sub-agent 类型**（通过 Agent 工具的 subagent_type 字段派发同步子代理）：",
        getAgentDescriptions(),
      ].join("\n");
  return [
    config.agentIntro,
    "循环：plan -> 使用工具 act -> report。",
    ...(skillBlock ? ["", skillBlock] : []),
    ...(subagentsBlock ? ["", subagentsBlock] : []),
    "",
    "规则：",
    `- ${rules}`,
  ].join("\n");
}

function injectBackgroundNotifications(
  messages: Message[],
  meta: Record<string, unknown> | undefined
): void {
  const manager = meta?.backgroundTaskManager;
  if (!(manager instanceof BackgroundTaskManager)) return;
  const currentAgentId = typeof meta?.currentAgentId === "string" ? meta.currentAgentId.trim() : "";
  const audience = currentAgentId || "root";
  const notifications = manager.drainNotifications(audience);
  if (notifications.length === 0) return;
  const lines = notifications.map(
    (item) => `- ${item.taskId} [${item.status}] ${item.summary}`
  );
  messages.push({
    role: "user",
    content: [
      "<background-notifications>",
      ...lines,
      "</background-notifications>",
      "以上后台任务状态已更新，请基于这些真实结果继续决策。",
    ].join("\n"),
  });
}

const TASK_BOARD_MAX_CHARS = 1500;
const TASK_BOARD_MAX_MUTATIONS_PER_ENTRY = 3;
const TASK_BOARD_INJECTED_KEY = "taskBoardInjected";

function readInjectedSet(meta: Record<string, unknown> | undefined): Set<string> {
  if (!meta) return new Set<string>();
  const existing = meta[TASK_BOARD_INJECTED_KEY];
  if (existing instanceof Set) {
    return existing as Set<string>;
  }
  const fresh = new Set<string>();
  meta[TASK_BOARD_INJECTED_KEY] = fresh;
  return fresh;
}

function renderTaskBoardEntry(entry: TaskBoardEntry): string {
  const header = `- ${entry.taskId} [${entry.agentType}] ${entry.status}` +
    (entry.currentTool ? ` tool=${entry.currentTool}` : "");
  const recent = entry.canvasMutations
    .slice()
    .sort((a, b) => 0)
    .slice(-TASK_BOARD_MAX_MUTATIONS_PER_ENTRY);
  const overflow = entry.canvasMutations.length - recent.length;
  const lines: string[] = [header];
  for (const m of recent) {
    const url = m.assetUrl ? ` ${m.assetUrl}` : "";
    lines.push(`    · ${m.kind}:${m.nodeId} [${m.status}]${url}`);
  }
  if (overflow > 0) {
    lines.push(`    · ... +${overflow} more`);
  }
  return lines.join("\n");
}

function renderTaskBoardCompact(entries: TaskBoardEntry[]): string {
  const lines = entries.map(
    (e) => `- ${e.taskId} [${e.agentType}] ${e.status} (${e.canvasMutations.length} nodes)`,
  );
  return ["<task_board>", ...lines, "</task_board>"].join("\n");
}

export function buildTaskBoardSnapshotText(injected: Set<string>): string | null {
  const all = TaskBoard.snapshot();
  const running = all.filter((e) => e.status === "running");
  const newlyFinished = all.filter((e) => e.status !== "running" && !injected.has(e.taskId));
  if (running.length === 0 && newlyFinished.length === 0) return null;
  const ordered = [...running, ...newlyFinished];
  const detailed = ["<task_board>", ...ordered.map(renderTaskBoardEntry), "</task_board>"].join("\n");
  if (detailed.length <= TASK_BOARD_MAX_CHARS) return detailed;
  return renderTaskBoardCompact(ordered).slice(0, TASK_BOARD_MAX_CHARS);
}

export function injectTaskBoardSnapshot(
  messages: Message[],
  meta: Record<string, unknown> | undefined,
): void {
  const injected = readInjectedSet(meta);
  const text = buildTaskBoardSnapshotText(injected);
  if (!text) return;
  messages.push({ role: "user", content: text });
  for (const entry of TaskBoard.snapshot()) {
    if (entry.status !== "running") injected.add(entry.taskId);
  }
}

const FLOW_STATE_HINT_MAX_NODES = 30;
const FLOW_STATE_GET_TOOL_NAME = "canvas_flow_inspect";

export type FlowStateRefreshDeps = {
  executeRemoteTool: typeof executeRemoteTool;
};

const defaultFlowStateRefreshDeps: FlowStateRefreshDeps = {
  executeRemoteTool,
};

const lastSeenCanvasCursorByMeta = new WeakMap<object, number>();

export function resetFlowStateRefreshForTests(): void {
  // WeakMap entries are GC'd with their keys; explicit reset only matters
  // for tests that reuse the same meta reference. New meta objects start at 0.
}

type FlowStateNodeSummary = {
  id: string;
  type: string;
  kind: string;
  label: string;
	status: string;
	persisted: boolean | null;
	taskId: string;
};

type FlowStateSnapshot = {
	nodes: FlowStateNodeSummary[];
	totalNodeCount: number;
	truncated: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readWebHeroSectionDraftCheckpoint(input: {
  args: Record<string, unknown>;
  structuredOutput: unknown;
}): { targetNodeId: string; draft: Record<string, unknown> } | null {
  if (
    String(input.args.subagent_type ?? "").trim() !== "section_codegen"
    || String(input.args.result_mode ?? "").trim() !== "full"
  ) {
    return null;
  }
  const taskContract = isRecord(input.args.task_contract) ? input.args.task_contract : null;
  const targetNodeIds = Array.isArray(taskContract?.targetNodeIds)
    ? taskContract.targetNodeIds.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  if (String(taskContract?.kind ?? "").trim() !== "webhero_section_codegen" || targetNodeIds.length !== 1) {
    return null;
  }
  const envelope = isRecord(input.structuredOutput) ? input.structuredOutput : null;
  const draft = isRecord(envelope?.structuredOutput) ? envelope.structuredOutput : null;
  if (
    String(envelope?.subagentType ?? "").trim() !== "section_codegen"
    || String(envelope?.resultMode ?? "").trim() !== "full"
    || !draft
  ) {
    return null;
  }
  return { targetNodeId: targetNodeIds[0], draft };
}

function extractFlowSnapshot(structuredOutput: unknown): FlowStateSnapshot {
	if (!isRecord(structuredOutput)) return { nodes: [], totalNodeCount: 0, truncated: false };
  const root = isRecord(structuredOutput.data) ? structuredOutput.data : structuredOutput;
  const rawNodes = (root as Record<string, unknown>).nodes;
	if (!Array.isArray(rawNodes)) return { nodes: [], totalNodeCount: 0, truncated: false };
  const out: FlowStateNodeSummary[] = [];
  for (const item of rawNodes) {
    if (!isRecord(item)) continue;
		const id = typeof item.nodeId === "string" ? item.nodeId : "";
    if (!id) continue;
    const type = typeof item.type === "string" ? item.type : "";
		const kind = typeof item.kind === "string" ? item.kind : "";
		const label = typeof item.label === "string" ? item.label : "";
		const status = typeof item.status === "string" ? item.status : "";
		const persisted = typeof item.persisted === "boolean" ? item.persisted : null;
		const taskId = typeof item.taskId === "string" ? item.taskId : "";
		out.push({ id, type, kind, label, status, persisted, taskId });
  }
	const totalNodeCountRaw = root.totalNodeCount;
	const totalNodeCount = typeof totalNodeCountRaw === "number" && Number.isFinite(totalNodeCountRaw)
		? Math.max(out.length, Math.trunc(totalNodeCountRaw))
		: out.length;
	return {
		nodes: out,
		totalNodeCount,
		truncated: root.truncated === true,
	};
}

function renderCanvasStateHint(snapshot: FlowStateSnapshot): string {
	const pick = snapshot.nodes.slice(0, FLOW_STATE_HINT_MAX_NODES);
	const overflow = Math.max(0, snapshot.totalNodeCount - pick.length);
  const lines = pick.map((n) => {
    const kindPart = n.kind ? ` kind=${n.kind}` : "";
    const labelPart = n.label ? ` label="${n.label}"` : "";
    const typePart = n.type ? ` type=${n.type}` : "";
		const statusPart = n.status ? ` status=${n.status}` : "";
		const persistedPart = n.persisted === null ? "" : ` persisted=${n.persisted}`;
		const taskPart = n.taskId ? ` taskId=${n.taskId}` : "";
		return `- ${n.id}${typePart}${kindPart}${labelPart}${statusPart}${persistedPart}${taskPart}`;
  });
	const header = `当前画布共 ${snapshot.totalNodeCount} 个节点：`;
	const footer = snapshot.truncated || overflow > 0
		? `... +${overflow || "unknown"} more (canvas_flow_inspect truncated=true，未返回不等于不存在)`
		: "";
  const body = footer ? [...lines, footer] : lines;
  return ["<canvas_state_hint>", header, ...body, "</canvas_state_hint>"].join("\n");
}

export async function injectFlowStateRefresh(
  messages: Message[],
  meta: Record<string, unknown> | undefined,
  deps: FlowStateRefreshDeps = defaultFlowStateRefreshDeps,
): Promise<void> {
  if (!meta) return;
  const config = readRemoteToolConfig(meta);
  const flowId = config?.flowId;
  if (!flowId) return;
  const remoteTools = readRemoteToolDefinitions(meta);
  if (!remoteTools.some((tool) => tool.name === FLOW_STATE_GET_TOOL_NAME)) return;

  const lastSeen = lastSeenCanvasCursorByMeta.get(meta) ?? 0;
  if (!TaskBoard.hasCanvasChangesSince(lastSeen)) return;

  let result;
  try {
    result = await deps.executeRemoteTool({
      name: FLOW_STATE_GET_TOOL_NAME,
		args: { limit: FLOW_STATE_HINT_MAX_NODES },
      toolCallId: `flow-state-refresh-${Date.now()}`,
      meta,
    });
  } catch {
    // bridge unreachable / network error — do not block main loop
    return;
  }
  if (!result) return;
	const snapshot = extractFlowSnapshot(result.payload?.structuredOutput);
	if (snapshot.nodes.length === 0) {
    lastSeenCanvasCursorByMeta.set(meta, TaskBoard.getCanvasMutationCursor());
    return;
  }
	const text = renderCanvasStateHint(snapshot);
  messages.push({ role: "user", content: text });
  lastSeenCanvasCursorByMeta.set(meta, TaskBoard.getCanvasMutationCursor());
}

export class AgentRunner {
  private readonly webHeroSectionDraftCheckpointTails = new Map<string, Promise<void>>();

  constructor(
    private config: AgentConfig,
    private registry: ToolRegistry,
    private client: LLMClient,
    private skills: SkillLoader,
    private hooks: HookRunner,
  ) {}

  private async serializeWebHeroSectionDraftCheckpoint<T>(
    targetNodeId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.webHeroSectionDraftCheckpointTails.get(targetNodeId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(action);
    const tail = result.then(() => undefined, () => undefined);
    this.webHeroSectionDraftCheckpointTails.set(targetNodeId, tail);
    try {
      return await result;
    } finally {
      if (this.webHeroSectionDraftCheckpointTails.get(targetNodeId) === tail) {
        this.webHeroSectionDraftCheckpointTails.delete(targetNodeId);
      }
    }
  }

  async run(prompt: string, cwd: string, options: RunOptions = {}) {
    const userPrompt = String(prompt || "").trim();
    const messages: Message[] = options.history ?? [];
    const requiredSkills = Array.isArray(options.requiredSkills)
      ? options.requiredSkills.map((s) => String(s || "").trim()).filter(Boolean)
      : [];
    const localResourcePaths = normalizeWorkspaceResourceRoots(
      options.workspaceResourceRoots ?? options.toolContextMeta?.localResourcePaths,
    );
    const toolCalls: ToolCallTrace[] = [];
    const effectiveModel = String(
      options.modelOverride || options.currentLlmCreds?.model || this.config.model || "",
    ).trim();
    const effectiveClient: LLMAdapter = options.currentLlmCreds
      ? buildClientForCreds(this.config, options.currentLlmCreds)
      : this.client;
    const allToolNames = this.registry.list().map((tool) => tool.name);
    const dynamicToolNames = [
      ...normalizeRemoteToolDefinitions(options.toolContextMeta?.remoteTools).map((tool) => tool.name),
      ...normalizeRemoteToolDefinitions(options.toolContextMeta?.mcpTools).map((tool) => tool.name),
    ];
    const disallowedTools = buildRootCanvasDeniedTools(options);
    const effectiveAllowedTools = filterAllowedTools(options.allowedTools ?? null, disallowedTools);
    const capabilityGrant = buildCapabilityGrant({
      allToolNames,
      dynamicToolNames,
      allowedTools: effectiveAllowedTools,
      workspaceRoot: this.config.workspaceRoot,
      localResourcePaths,
      existingGrant: readCapabilityGrant(options.toolContextMeta),
    });
    const runEnvelope = buildRunEnvelope({
      config: this.config,
      prompt: userPrompt,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      capabilityGrant,
      localResourcePaths,
      requiredSkills,
    });
    const { memoryRoot, runtimeMeta, hookContext, contextPromptFragment } =
      await resolveAgentRunContext({
        config: this.config,
        cwd,
        prompt: userPrompt,
        requiredSkills,
        capabilityGrant,
        runEnvelope,
        localResourcePaths,
        toolCalls,
      ...(options.toolContextMeta ? { toolContextMeta: options.toolContextMeta } : {}),
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      currentModel: effectiveModel,
      ...(options.currentLlmCreds ? { currentLlmCreds: options.currentLlmCreds } : {}),
    });
    if (options.abortSignal) {
      runtimeMeta.abortSignal = options.abortSignal;
    }
    if (options.toolContextMeta) {
      Object.assign(options.toolContextMeta, runtimeMeta);
    }
    const session = new AgentSessionEngine(messages, runtimeMeta, hookContext, {
      loadedSkills: collectLoadedSkills(messages),
      state: options.state,
      duplicateToolCallLimit: getDuplicateToolCallLimit(),
    });
    const parentTrace = traceContext.current();
    const traceCtx = traceContext.bindToRun(
      hookContext.runId,
      hookContext.sessionId ?? "",
      parentTrace?.runId,
      parentTrace ? parentTrace.depth + 1 : 0,
      parentTrace?.rootRunId ?? hookContext.runId,
    );
    return traceContext.run(traceCtx, async () => {
    await this.hooks.beforeRun(hookContext);
    let pendingPartial: { text: string; toolCalls: ToolCall[] } | null = null;
    const onPartialFlush = (partial: { text: string; toolCalls: ToolCall[] }) => {
      pendingPartial = {
        text: String(partial.text ?? ""),
        toolCalls: Array.isArray(partial.toolCalls) ? partial.toolCalls.slice() : [],
      };
    };
    try {
      session.appendUserPrompt(userPrompt, options.ephemeralUserPrompt === true);
      session.recordCurrentMessages();

      let lastText = "";
      const depth = options.depth ?? 0;
      const maxTurns = Number.isFinite(options.maxTurns)
        ? Math.max(1, Math.min(this.config.maxTurns, Math.trunc(options.maxTurns || 1)))
        : this.config.maxTurns;
      const allowedTools = effectiveAllowedTools;
      const toolContextMeta: Record<string, unknown> = runtimeMeta;
      const runtimeChannelSystem = buildRuntimeChannelSystemFragment(
        readRuntimeChannelDescriptor(toolContextMeta) ?? undefined,
      );
      const baseSystem = options.systemMode?.kind === "provided"
        ? joinSystemSections(
            options.systemMode.system,
            renderProvidedSystemSkillProtocol({
              providedSystem: options.systemMode.system,
              tools: allToolNames,
              allowedTools,
              skills: this.skills,
              requiredSkills,
              omitSkillCatalog: options.omitSkillCatalog === true,
            }),
            runtimeChannelSystem,
          )
        : joinSystemSections(
            buildSystemBootstrap(this.config, this.skills, {
              compact: options.compactPrelude === true,
              requiredSkills,
              capabilityGrant,
              omitSkillCatalog: options.omitSkillCatalog === true,
            }),
            options.systemOverride ?? "",
            contextPromptFragment,
            runtimeChannelSystem,
          );
      const state = session.getState();
      const loadedSkills = session.getLoadedSkills();
      let nextLayoutStageIndex = 0;
      const canvasLayoutSlotByOperationKey = new Map<string, {
        layoutStagePath: number[];
        layoutItemPath: HarnessLayoutItemSegment[];
      }>();
      if (allowedTools && allowedTools.size === 0) {
        session.getMessages().push({
          role: "user",
          content:
            "本轮工具已禁用。禁止输出任何工具调用或伪调用文本（如 TodoWrite/read_file/bash/write_file/edit_file）。只输出最终结果正文。",
        });
      }

      for (let turn = 0; turn < maxTurns; turn += 1) {
        throwIfAborted(options.abortSignal);
        state.budget.parent.consume();
        injectBackgroundNotifications(session.getMessages(), toolContextMeta);
        injectTaskBoardSnapshot(session.getMessages(), toolContextMeta);
        await injectFlowStateRefresh(session.getMessages(), toolContextMeta);
        this.skills.reloadSkills();
        const capabilityPlane = resolveCapabilityPlane({
          registry: this.registry,
          capabilityGrant,
          allowedTools,
          disallowedTools,
          meta: toolContextMeta,
        });
        const toolCatalog = capabilityPlane.catalog;
        toolContextMeta.capabilitySnapshot = capabilityPlane.snapshot;
        const tools = buildPerTurnToolDefinitions(
          filterTools(capabilityPlane.tools, allowedTools),
          this.skills,
          requiredSkills,
        );
        const system = session.buildSystem(
          baseSystem,
          buildCollaborationSystemFragment(toolContextMeta)
        );
        const response = await runTurnWithFetchRetry({
          maxOuterRetries: parseTurnFetchRetryCount(),
          execute: () =>
            executeAgentTurn({
              client: effectiveClient,
              session,
              system,
              tools,
              ...(options.modelOverride ? { modelOverride: options.modelOverride } : {}),
              ...(options.onTextDelta ? { onTextDelta: options.onTextDelta } : {}),
              ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
              onPartialFlush,
            }),
          ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
        });
        throwIfAborted(options.abortSignal);
        const turnText = String(response.text || "");
        session.recordTurn(turnText, response.toolCalls.length);
        const finishBlock =
          response.toolCalls.length === 0
            ? readFinishBlockDecision({
                toolCalls,
                state,
                availableToolNames: new Set(tools.map((tool) => tool.name)),
              })
            : null;
        const allowFinish = response.toolCalls.length === 0 && finishBlock === null;
        const turnTrace: LlmTurnTrace = {
          turn: turn + 1,
          text: turnText,
          textPreview: turnText.trim().length > 1000 ? `${turnText.trim().slice(0, 1000)}…` : turnText.trim(),
          textChars: turnText.length,
          toolCallCount: response.toolCalls.length,
          toolNames: response.toolCalls.map((call) => call.name),
          finished: allowFinish,
        };
        options.onTurn?.(turnTrace);
        if (response.text || response.toolCalls.length > 0) {
          if (response.text) {
            lastText = response.text;
          }
          session.appendAssistantMessage(response.text || "", response.toolCalls);
        }

        if (response.toolCalls.length === 0) {
          if (finishBlock) {
            session.recordCompletionTrace({
              allowFinish: false,
              terminal: "blocked",
              reason: finishBlock.reason,
            });
            session.appendUserPrompt(finishBlock.message, true);
            continue;
          }
          const resultText = lastText || "";
          const extractedInsights = await extractMemoryInsights({
            client: effectiveClient,
            ...(effectiveModel ? { model: effectiveModel } : {}),
            prompt: userPrompt,
            resultText,
            toolSummary: summarizeToolUsageForMemory(toolCalls),
            ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
          });
          session.recordCompletionTrace({ allowFinish: true, terminal: "success" });
          return finalizeRunResult({
            hooks: this.hooks,
            hookContext,
            runtimeMeta,
            memoryRoot,
            prompt: userPrompt,
            resultText,
            messages: session.getMessages(),
            toolCalls,
            ...(options.sessionId ? { sessionId: options.sessionId } : {}),
            requiredSkills,
            ...(effectiveModel ? { model: effectiveModel } : {}),
            ...(extractedInsights.length > 0 ? { extractedInsights } : {}),
          });
        }

        const preparedCalls: PreparedToolCall[] = withPhaseScopedSkillLoadGate(
          response.toolCalls.map((call, toolCallIndex) => {
            const parsedArgs = parseToolArgs(call.arguments);
            const duplicate = parsedArgs.error
              ? { blocked: false, message: "" }
              : trackDuplicateToolCall(state, call.name, parsedArgs.args);
            const blockedError = parsedArgs.error || (duplicate.blocked ? duplicate.message : "");
            return {
              call,
              args: parsedArgs.args,
              toolCallIndex,
              ...(blockedError ? { blockedError } : {}),
            };
          }),
          requiredSkills,
        );
        const askUserGate = buildAskUserTurnGate(preparedCalls);
        if (askUserGate) {
          const askUserToolCallStartIndex = hookContext.toolCalls.length;
          const askUserOutcome = await this.executePreparedCall(askUserGate.askUserCall, {
            cwd,
            depth,
            state,
            toolContextMeta,
            hookContext,
            requiredSkills,
            allowedTools,
            disallowedTools,
            loadedSkills,
            toolCatalog,
            onToolStart: options.onToolStart,
            onToolCall: options.onToolCall,
          });
          session.appendToolMessage(askUserOutcome.message);
          recordToolBatchSummary(
            toolContextMeta,
            hookContext.toolCalls.slice(Math.max(0, hookContext.toolCalls.length - 1)),
          );
          if (askUserGate.blockedCalls.length > 0) {
            const blockedOutcomes = await this.blockPreparedCalls(
              askUserGate.blockedCalls,
              ASK_USER_TURN_GATE_BLOCK_REASON,
              {
                cwd,
                depth,
                state,
                toolContextMeta,
                hookContext,
                requiredSkills,
                allowedTools,
                disallowedTools,
                loadedSkills,
                toolCatalog,
                onToolStart: options.onToolStart,
                onToolCall: options.onToolCall,
              },
            );
            for (const outcome of blockedOutcomes) {
              session.appendToolMessage(outcome.message);
            }
            recordToolBatchSummary(
              toolContextMeta,
              hookContext.toolCalls.slice(Math.max(0, hookContext.toolCalls.length - blockedOutcomes.length)),
            );
          }
          const askUserPrompt = findSuccessfulAskUserToolPrompt(
            hookContext.toolCalls.slice(askUserToolCallStartIndex),
          );
          if (askUserPrompt) {
            const askUserReply = buildAskUserFinalReply(askUserPrompt);
            session.appendAssistantMessage(askUserReply, []);
            lastText = askUserReply;
            session.recordCompletionTrace({
              allowFinish: true,
              terminal: "success",
              reason: "awaiting_user_reply",
            });
            return finalizeRunResult({
              hooks: this.hooks,
              hookContext,
              runtimeMeta,
              memoryRoot,
              prompt: userPrompt,
              resultText: askUserReply,
              messages: session.getMessages(),
              toolCalls,
              ...(options.sessionId ? { sessionId: options.sessionId } : {}),
              requiredSkills,
              ...(effectiveModel ? { model: effectiveModel } : {}),
            });
          }
          continue;
        }

        const autoSnapshotResult = await maybeAutoSnapshotBeforeTurn({
          state,
          meta: toolContextMeta,
          turn: turn + 1,
          catalog: toolCatalog,
          pendingToolCalls: preparedCalls
            .filter((prepared) => !prepared.blockedError)
            .map((prepared) => ({ name: prepared.call.name })),
        });
        if (autoSnapshotResult.kind === "failed") {
          throw new Error(
            `auto_checkpoint_failed before turn ${turn + 1} (label=${autoSnapshotResult.label}): ${autoSnapshotResult.error.message}`,
          );
        }

        const executionBatches = buildExecutionBatches(preparedCalls, this.registry, toolCatalog)
          .map((batch, executionBatchIndex) => {
            const layoutRelevant = batch.calls.some((prepared) => (
              prepared.call.name === "Agent"
              || toolCatalog.getDefinition(prepared.call.name)?.effects?.mutatesCanvas === true
            ));
            const layoutStageIndex = layoutRelevant ? nextLayoutStageIndex++ : null;
            return {
              ...batch,
              calls: batch.calls.map((prepared, executionBatchCallIndex) => {
                const executionOrigin = buildHarnessExecutionOrigin({
                  meta: toolContextMeta,
                  call: prepared.call,
                  llmTurnIndex: turn + 1,
                  executionBatchIndex,
                  executionBatchCallIndex,
                  executionBatchCallCount: batch.calls.length,
                  toolCallIndex: prepared.toolCallIndex,
                  layoutStageIndex,
                });
                const definition = toolCatalog.getDefinition(prepared.call.name);
                const canReuseStableSlot = definition?.effects?.generatesMedia === true
                  || prepared.call.name.toLowerCase().includes("create");
                const stableSlotKey = canReuseStableSlot
                  ? getCanvasLayoutSlotKey(prepared.call.name, prepared.args)
                  : undefined;
                return {
                  ...prepared,
                  executionOrigin: stableSlotKey
                    ? reuseCanvasLayoutSlot(executionOrigin, stableSlotKey, canvasLayoutSlotByOperationKey)
                    : executionOrigin,
                };
              }),
            };
          });
        for (let batchIndex = 0; batchIndex < executionBatches.length; batchIndex += 1) {
          throwIfAborted(options.abortSignal);
          const batch = executionBatches[batchIndex];
          const batchToolCallStartIndex = hookContext.toolCalls.length;
          const outcomes = batch.parallel
            ? await this.executeParallelBatch(
                batch.calls,
                cwd,
                depth,
                state,
                toolContextMeta,
                hookContext,
                requiredSkills,
                allowedTools,
                disallowedTools,
                loadedSkills,
                toolCatalog,
                options.onToolStart,
                options.onToolCall
              )
            : [await this.executePreparedCall(batch.calls[0], {
                cwd,
                depth,
                state,
                toolContextMeta,
                hookContext,
                requiredSkills,
                allowedTools,
                disallowedTools,
                loadedSkills,
                toolCatalog,
                onToolStart: options.onToolStart,
                onToolCall: options.onToolCall,
              })];
          for (const outcome of outcomes) {
            session.appendToolMessage(outcome.message);
          }
          recordToolBatchSummary(
            toolContextMeta,
            hookContext.toolCalls.slice(batchToolCallStartIndex),
          );
          const fatalOutcome = outcomes.find((outcome) => outcome.fatalError);
          if (fatalOutcome?.fatalError) {
            throw fatalOutcome.fatalError;
          }
          const askUserPrompt = findSuccessfulAskUserToolPrompt(
            hookContext.toolCalls.slice(batchToolCallStartIndex),
          );
          if (askUserPrompt) {
            const remainingCalls = executionBatches
              .slice(batchIndex + 1)
              .flatMap((remainingBatch) => remainingBatch.calls);
            if (remainingCalls.length > 0) {
              const blockedRemaining = await this.blockPreparedCalls(
                remainingCalls,
                "未执行：ask_user 已成功向用户发起提问，必须先等待用户回复后才能继续。若这些调用仍然需要，请在下一轮重新发起。",
                {
                  cwd,
                  depth,
                  state,
                  toolContextMeta,
                  hookContext,
                  requiredSkills,
                  allowedTools,
                  disallowedTools,
                  loadedSkills,
                  toolCatalog,
                  onToolStart: options.onToolStart,
                  onToolCall: options.onToolCall,
                },
              );
              for (const outcome of blockedRemaining) {
                session.appendToolMessage(outcome.message);
              }
              recordToolBatchSummary(
                toolContextMeta,
                hookContext.toolCalls.slice(Math.max(0, hookContext.toolCalls.length - blockedRemaining.length)),
              );
            }
            const askUserReply = buildAskUserFinalReply(askUserPrompt);
            session.appendAssistantMessage(askUserReply, []);
            lastText = askUserReply;
            session.recordCompletionTrace({
              allowFinish: true,
              terminal: "success",
              reason: "awaiting_user_reply",
            });
            return finalizeRunResult({
              hooks: this.hooks,
              hookContext,
              runtimeMeta,
              memoryRoot,
              prompt: userPrompt,
              resultText: askUserReply,
              messages: session.getMessages(),
              toolCalls,
              ...(options.sessionId ? { sessionId: options.sessionId } : {}),
              requiredSkills,
              ...(effectiveModel ? { model: effectiveModel } : {}),
            });
          }
        }
        drainVisionQueue(session.getMessages(), state);
      }
      const fallbackText = lastText || "达到最大轮次，未完成。";
      session.recordCompletionTrace({ allowFinish: false, terminal: "blocked", reason: "max_turns" });
      return finalizeRunResult({
        hooks: this.hooks,
        hookContext,
        runtimeMeta,
        memoryRoot,
        prompt: userPrompt,
        resultText: fallbackText,
        messages: session.getMessages(),
        toolCalls,
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        requiredSkills,
        ...(effectiveModel ? { model: effectiveModel } : {}),
      });
    } catch (error) {
      if (options.abortSignal?.aborted) {
        const reason = error instanceof Error ? error.message : String(error);
        session.synthesizeInterruptedTurn({
          reason,
          ...(pendingPartial ? { partial: pendingPartial } : {}),
        });
      }
      await reportRunError({
        hooks: this.hooks,
        hookContext,
        error,
      });
      throw error;
    }
    }); // end traceContext.run
  }

  private async executeParallelBatch(
    batch: PreparedToolCall[],
    cwd: string,
    depth: number,
    state: import("./tools/registry.js").ToolRuntimeState,
    toolContextMeta: Record<string, unknown> | undefined,
    hookContext: RunHookContext,
    requiredSkills: string[],
    allowedTools: Set<string> | null,
    disallowedTools: Set<string> | null,
    loadedSkills: Set<string>,
    toolCatalog: ToolCatalog,
    onToolStart: RunOptions["onToolStart"],
    onToolCall: RunOptions["onToolCall"]
  ): Promise<ToolExecutionOutcome[]> {
    const outcomes: ToolExecutionOutcome[] = new Array(batch.length);
    const concurrency = Math.min(getToolBatchConcurrency(batch), batch.length);
    let cursor = 0;
    const next = () => {
      const current = cursor;
      cursor += 1;
      return current;
    };
    const worker = async () => {
      while (true) {
        const current = next();
        if (current >= batch.length) return;
        try {
          outcomes[current] = await this.executePreparedCall(batch[current], {
            cwd,
            depth,
            state,
            toolContextMeta,
            hookContext,
            requiredSkills,
            allowedTools,
            disallowedTools,
            loadedSkills,
            toolCatalog,
            onToolStart,
            onToolCall,
          });
        } catch (error) {
          outcomes[current] = {
            message: {
              role: "tool",
              content: `工具执行失败: ${(error as Error).message}`,
              toolCallId: batch[current].call.id,
            },
          };
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return outcomes;
  }

  private async blockPreparedCalls(
    batch: PreparedToolCall[],
    reason: string,
    params: {
      cwd: string;
      depth: number;
      state: import("./tools/registry.js").ToolRuntimeState;
      toolContextMeta: Record<string, unknown> | undefined;
      hookContext: RunHookContext;
      requiredSkills: string[];
      allowedTools: Set<string> | null;
      disallowedTools: Set<string> | null;
      loadedSkills: Set<string>;
      toolCatalog: ToolCatalog;
      onToolStart?: (payload: {
        toolCallId: string;
        name: string;
        args: Record<string, unknown>;
        startedAt: string;
      }) => void;
      onToolCall?: (toolCall: ToolCallTrace) => void;
    }
  ): Promise<ToolExecutionOutcome[]> {
    const outcomes: ToolExecutionOutcome[] = [];
    for (const prepared of batch) {
      const blockedPrepared: PreparedToolCall = {
        ...prepared,
        blockedError: reason,
      };
      outcomes.push(await this.executePreparedCall(blockedPrepared, params));
    }
    return outcomes;
  }

  private async executePreparedCall(
    prepared: PreparedToolCall,
    params: {
      cwd: string;
      depth: number;
      state: import("./tools/registry.js").ToolRuntimeState;
      toolContextMeta: Record<string, unknown> | undefined;
      hookContext: RunHookContext;
      requiredSkills: string[];
      allowedTools: Set<string> | null;
      disallowedTools: Set<string> | null;
      loadedSkills: Set<string>;
      toolCatalog: ToolCatalog;
      onToolStart?: (payload: {
        toolCallId: string;
        name: string;
        args: Record<string, unknown>;
        startedAt: string;
      }) => void;
      onToolCall?: (toolCall: ToolCallTrace) => void;
    }
  ): Promise<ToolExecutionOutcome> {
    if (prepared.deferredResult) {
      const deferredStartedAt = new Date().toISOString();
      params.onToolStart?.({
        toolCallId: prepared.call.id,
        name: prepared.call.name,
        args: prepared.args,
        startedAt: deferredStartedAt,
      });
      const deferredToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: prepared.call.id,
          name: prepared.call.name,
          args: prepared.args,
          output: prepared.deferredResult.content,
          status: "succeeded",
          startedAt: deferredStartedAt,
          finishedAt: deferredStartedAt,
          durationMs: 0,
          structuredOutput: prepared.deferredResult.structuredOutput,
        }),
      };
      params.hookContext.toolCalls.push(deferredToolCall);
      await this.hooks.onToolCall({ ...params.hookContext, toolCall: deferredToolCall });
      params.onToolCall?.(deferredToolCall);
      return {
        message: {
          role: "tool",
          content: prepared.deferredResult.content,
          toolCallId: prepared.call.id,
        },
      };
    }
    if (prepared.blockedError) {
      const blockedStartedAt = new Date().toISOString();
      params.onToolStart?.({
        toolCallId: prepared.call.id,
        name: prepared.call.name,
        args: prepared.args,
        startedAt: blockedStartedAt,
      });
      const blockedToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: prepared.call.id,
          name: prepared.call.name,
          args: prepared.args,
          output: prepared.blockedError,
          status: "blocked",
          startedAt: blockedStartedAt,
          finishedAt: blockedStartedAt,
          durationMs: 0,
          errorMessage: prepared.blockedError,
        }),
      };
      params.hookContext.toolCalls.push(blockedToolCall);
      await this.hooks.onToolCall({ ...params.hookContext, toolCall: blockedToolCall });
      params.onToolCall?.(blockedToolCall);
      return {
        message: {
          role: "tool",
          content: `工具执行失败: ${prepared.blockedError}`,
          toolCallId: prepared.call.id,
        },
      };
    }
    return this.executeToolCall({
      call: prepared.call,
      args: prepared.args,
      executionOrigin: prepared.executionOrigin,
      ...params,
    });
  }

  private async executeToolCall(params: {
    call: { id: string; name: string; arguments: string };
    args: Record<string, unknown>;
    executionOrigin?: HarnessExecutionOrigin;
    cwd: string;
    depth: number;
    state: import("./tools/registry.js").ToolRuntimeState;
    toolContextMeta: Record<string, unknown> | undefined;
    hookContext: RunHookContext;
    requiredSkills: string[];
    allowedTools: Set<string> | null;
    disallowedTools: Set<string> | null;
    loadedSkills: Set<string>;
    toolCatalog: ToolCatalog;
    onToolStart?: (payload: {
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      startedAt: string;
    }) => void;
    onToolCall?: (toolCall: ToolCallTrace) => void;
  }): Promise<ToolExecutionOutcome> {
    const {
      call,
      args,
      executionOrigin,
      cwd,
      depth,
      state,
      toolContextMeta,
      hookContext,
      requiredSkills,
      allowedTools,
      disallowedTools,
      loadedSkills,
      toolCatalog,
      onToolStart,
      onToolCall,
    } = params;
    const startedAt = new Date();
    const startedAtIso = startedAt.toISOString();
    onToolStart?.({
      toolCallId: call.id,
      name: call.name,
      args,
      startedAt: startedAtIso,
    });
    if (disallowedTools?.has(call.name)) {
      const blockedToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: call.id,
          name: call.name,
          args,
          output: `Error: Tool reserved for sub-agent role: ${call.name}`,
          status: "blocked",
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorMessage: `Tool reserved for sub-agent role: ${call.name}`,
        }),
      };
      hookContext.toolCalls.push(blockedToolCall);
      await this.hooks.onToolCall({ ...hookContext, toolCall: blockedToolCall });
      onToolCall?.(blockedToolCall);
      return {
        message: {
          role: "tool",
          content: `Error: Tool reserved for sub-agent role: ${call.name}`,
          toolCallId: call.id,
        },
      };
    }
    if (allowedTools && !allowedTools.has(call.name)) {
      const blockedToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: call.id,
          name: call.name,
          args,
          output: `Error: Tool not allowed for this agent: ${call.name}`,
          status: "blocked",
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorMessage: `Tool not allowed for this agent: ${call.name}`,
        }),
      };
      hookContext.toolCalls.push(blockedToolCall);
      await this.hooks.onToolCall({ ...hookContext, toolCall: blockedToolCall });
      onToolCall?.(blockedToolCall);
      return {
        message: {
          role: "tool",
          content: `Error: Tool not allowed for this agent: ${call.name}`,
          toolCallId: call.id,
        },
      };
    }
    const webHeroSectionDraftVerification = verifyWebHeroSectionDraftWritePrecondition({
      toolName: call.name,
      args,
      toolCalls: hookContext.toolCalls,
    });
    if (webHeroSectionDraftVerification?.error) {
      const blockedToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: call.id,
          name: call.name,
          args,
          output: webHeroSectionDraftVerification.error,
          status: "blocked",
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorMessage: webHeroSectionDraftVerification.error,
          structuredOutput: {
            code: "webhero_section_codegen_provenance_required",
          },
        }),
      };
      hookContext.toolCalls.push(blockedToolCall);
      await this.hooks.onToolCall({ ...hookContext, toolCall: blockedToolCall });
      onToolCall?.(blockedToolCall);
      return {
        message: {
          role: "tool",
          content: `工具执行失败: ${webHeroSectionDraftVerification.error}`,
          toolCallId: call.id,
        },
      };
    }
    if (webHeroSectionDraftVerification?.verifiedArgs) {
      for (const key of Object.keys(args)) delete args[key];
      Object.assign(args, webHeroSectionDraftVerification.verifiedArgs);
    }
    const webHeroStagePreconditionError = evaluateWebHeroStagePrecondition({
      toolName: call.name,
      args,
      toolCalls: hookContext.toolCalls,
    });
    if (webHeroStagePreconditionError) {
      const blockedToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: call.id,
          name: call.name,
          args,
          output: webHeroStagePreconditionError,
          status: "blocked",
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorMessage: webHeroStagePreconditionError,
          structuredOutput: {
            code: "webhero_stage_readiness_required",
            nodeId: typeof args.nodeId === "string" ? args.nodeId.trim() : "",
          },
        }),
      };
      hookContext.toolCalls.push(blockedToolCall);
      await this.hooks.onToolCall({ ...hookContext, toolCall: blockedToolCall });
      onToolCall?.(blockedToolCall);
      return {
        message: {
          role: "tool",
          content: `工具执行失败: ${webHeroStagePreconditionError}`,
          toolCallId: call.id,
        },
      };
    }
    const webHeroPreviewVerification = verifyWebHeroPreviewDispatchPrecondition({
      toolName: call.name,
      args,
      toolCalls: hookContext.toolCalls,
    });
    if (webHeroPreviewVerification?.error) {
      const blockedToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: call.id,
          name: call.name,
          args,
          output: webHeroPreviewVerification.error,
          status: "blocked",
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorMessage: webHeroPreviewVerification.error,
          structuredOutput: { code: "webhero_preview_persisted_style_required" },
        }),
      };
      hookContext.toolCalls.push(blockedToolCall);
      await this.hooks.onToolCall({ ...hookContext, toolCall: blockedToolCall });
      onToolCall?.(blockedToolCall);
      return {
        message: {
          role: "tool",
          content: `工具执行失败: ${webHeroPreviewVerification.error}`,
          toolCallId: call.id,
        },
      };
    }
    const webHeroMergeVerification = verifyWebHeroMergeDispatchPrecondition({
      toolName: call.name,
      args,
      toolCalls: hookContext.toolCalls,
    });
    if (webHeroMergeVerification?.error) {
      const blockedToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: call.id,
          name: call.name,
          args,
          output: webHeroMergeVerification.error,
          status: "blocked",
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorMessage: webHeroMergeVerification.error,
          structuredOutput: { code: "webhero_merge_runtime_readiness_required" },
        }),
      };
      hookContext.toolCalls.push(blockedToolCall);
      await this.hooks.onToolCall({ ...hookContext, toolCall: blockedToolCall });
      onToolCall?.(blockedToolCall);
      return {
        message: {
          role: "tool",
          content: `工具执行失败: ${webHeroMergeVerification.error}`,
          toolCallId: call.id,
        },
      };
    }
    const basePerCallToolContextMeta = executionOrigin
      ? {
          ...(toolContextMeta ?? {}),
          harnessExecutionOrigin: executionOrigin,
        }
      : toolContextMeta;
    const perCallToolContextMeta = webHeroMergeVerification?.evidence || webHeroPreviewVerification?.evidence
      ? {
          ...(basePerCallToolContextMeta ?? {}),
          ...(webHeroMergeVerification?.evidence
            ? { webHeroMergeDispatchEvidence: webHeroMergeVerification.evidence }
            : {}),
          ...(webHeroPreviewVerification?.evidence
            ? { webHeroPreviewDispatchEvidence: webHeroPreviewVerification.evidence }
            : {}),
        }
      : basePerCallToolContextMeta;
    const toolDefinition = toolCatalog.getDefinition(call.name) ?? undefined;
    const policyDecision = evaluateToolPolicy({
      toolName: call.name,
      args,
      cwd,
      toolDefinition,
      ...(perCallToolContextMeta ? { meta: perCallToolContextMeta } : {}),
    });
    recordPolicyDecision(toolContextMeta, policyDecision);
    if (policyDecision.verdict !== "allow") {
      const status = policyDecision.verdict === "deny" ? "denied" : "blocked";
      const deniedToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: call.id,
          name: call.name,
          args,
          output: policyDecision.reason,
          status,
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorMessage: policyDecision.reason,
          structuredOutput: {
            policyDecision,
          },
        }),
      };
      hookContext.toolCalls.push(deniedToolCall);
      await this.hooks.onToolCall({ ...hookContext, toolCall: deniedToolCall });
      onToolCall?.(deniedToolCall);
      return {
        message: {
          role: "tool",
          content:
            policyDecision.verdict === "requires_approval"
              ? `工具执行需审批: ${policyDecision.reason}`
              : `工具执行失败: ${policyDecision.reason}`,
          toolCallId: call.id,
        },
      };
    }
    try {
      const result = await new ToolExecutor(toolCatalog).execute({
        name: call.name,
        args,
        toolCallId: call.id,
        ctx: { cwd, depth, state, ...(perCallToolContextMeta ? { meta: perCallToolContextMeta } : {}) },
      });
      if (call.name === "Skill") {
        for (const loaded of collectLoadedSkills([{ role: "tool", content: result.content }])) {
          loadedSkills.add(loaded);
        }
      }
      if (result.isError === true) {
        const errorMessage =
          result.errorMessage || readExplicitToolErrorMessage(result.content) || result.content;
        const generationKind = canvasGenerationToolKind(toolDefinition);
        if (generationKind) {
          recordCanvasGenerationAttempt(state, generationKind, {
            status: "failed",
            error: errorMessage || result.content,
            resultPayload: result.payload,
            args,
          });
        }
        const waitKind = getWaitToolMediaKind(call.name);
        if (waitKind) {
          recordCanvasGenerationWaitResult(state, waitKind, {
            status: readWaitFailureStatus(result.payload?.structuredOutput),
            error: errorMessage || result.content,
            resultPayload: result.payload,
            args,
          });
        }
        const failedToolCall: ToolCallTrace = {
          ...buildToolCallTrace({
            toolCallId: call.id,
            name: call.name,
            args,
            output: result.content,
            status: "failed",
            startedAt: startedAtIso,
            finishedAt: new Date().toISOString(),
            durationMs: Math.max(0, Date.now() - startedAt.getTime()),
            ...(errorMessage ? { errorMessage } : {}),
            structuredOutput: result.payload?.structuredOutput,
          }),
        };
        hookContext.toolCalls.push(failedToolCall);
        await this.hooks.onToolCall({ ...hookContext, toolCall: failedToolCall });
        onToolCall?.(failedToolCall);
        return {
          message: {
            role: "tool",
            content: normalizeToolOutput(
              buildModelFacingToolResultContent({ toolName: call.name, result }),
              `tool:${call.name}`,
              state.budget?.parent,
            ),
            toolCallId: call.id,
          },
        };
      }
      const generationKind = canvasGenerationToolKind(toolDefinition);
      if (generationKind) {
        recordCanvasGenerationAttempt(state, generationKind, {
          status: "ok",
          resultPayload: result.payload,
          args,
        });
      }
      const waitKind = getWaitToolMediaKind(call.name);
      if (waitKind) {
        recordCanvasGenerationWaitResult(state, waitKind, {
          status: "completed",
          resultPayload: result.payload,
          args,
        });
      }
      const toolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: call.id,
          name: call.name,
          args,
          output: result.content,
          status: "succeeded",
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          structuredOutput: result.payload?.structuredOutput,
        }),
      };
      hookContext.toolCalls.push(toolCall);
      await this.hooks.onToolCall({ ...hookContext, toolCall });
      onToolCall?.(toolCall);
      let modelFacingContent = normalizeToolOutput(
        buildModelFacingToolResultContent({ toolName: call.name, result }),
        `tool:${call.name}`,
        state.budget?.parent,
      );
      let fatalError: Error | undefined;
      const sectionDraftCheckpoint = call.name === "Agent"
        ? readWebHeroSectionDraftCheckpoint({
            args,
            structuredOutput: result.payload?.structuredOutput,
          })
        : null;
      if (sectionDraftCheckpoint) {
        const checkpointToolCallId = `${call.id}__section_draft_checkpoint`;
        await this.serializeWebHeroSectionDraftCheckpoint(
          sectionDraftCheckpoint.targetNodeId,
          () => this.executeToolCall({
            call: {
              id: checkpointToolCallId,
              name: "canvas_update_node_data",
              arguments: "",
            },
            args: {
              patchNodeData: [{
                id: sectionDraftCheckpoint.targetNodeId,
                data: { webPageSectionDrafts: [sectionDraftCheckpoint.draft] },
              }],
            },
            cwd,
            depth,
            state,
            toolContextMeta,
            hookContext,
            requiredSkills,
            allowedTools,
            disallowedTools,
            loadedSkills,
            toolCatalog,
            onToolStart,
            onToolCall,
          }),
        );
        const checkpointTrace = hookContext.toolCalls.find(
          (item) => item.toolCallId === checkpointToolCallId,
        );
        const checkpointStatus = checkpointTrace?.status === "succeeded"
          ? "persisted"
          : `failed: ${checkpointTrace?.errorMessage || "unknown checkpoint error"}`;
        modelFacingContent = `${modelFacingContent}\nRuntime section-draft checkpoint ${checkpointStatus}.`;
        if (checkpointTrace?.status !== "succeeded") {
          fatalError = new Error(
            `WebHero section-draft checkpoint failed for ${sectionDraftCheckpoint.targetNodeId}: ${checkpointTrace?.errorMessage || "unknown checkpoint error"}`,
          );
        }
      }
      return {
        message: {
          role: "tool",
          content: modelFacingContent,
          toolCallId: call.id,
        },
        ...(fatalError ? { fatalError } : {}),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const structuredOutput = readStructuredOutputFromToolError(error);
      const generationKind = canvasGenerationToolKind(toolDefinition);
      if (generationKind) {
        recordCanvasGenerationAttempt(state, generationKind, {
          status: "failed",
          error: errorMessage,
          ...(structuredOutput ? { resultPayload: { structuredOutput } } : {}),
          args,
        });
      }
      const waitKind = getWaitToolMediaKind(call.name);
      if (waitKind) {
        recordCanvasGenerationWaitResult(state, waitKind, {
          status: readWaitFailureStatus(structuredOutput),
          error: errorMessage,
          ...(structuredOutput ? { resultPayload: { structuredOutput } } : {}),
          args,
        });
      }
      const failedToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: call.id,
          name: call.name,
          args,
          output: `工具执行失败: ${errorMessage}`,
          status: "failed",
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorMessage,
          structuredOutput,
        }),
      };
      hookContext.toolCalls.push(failedToolCall);
      await this.hooks.onToolCall({ ...hookContext, toolCall: failedToolCall });
      onToolCall?.(failedToolCall);
      return {
        message: {
          role: "tool",
          content: buildModelFacingToolResultContent({
            toolName: call.name,
            result: {
              toolCallId: call.id,
              content: `工具执行失败: ${errorMessage}`,
              isError: true,
              errorMessage,
              ...(structuredOutput
                ? { payload: { text: errorMessage, structuredOutput } }
                : {}),
            },
          }),
          toolCallId: call.id,
        },
      };
    }
  }
}

// 仅作展示兜底：当结构化 ToolResult.errorMessage 缺失时，剥离 content 的 "Error:" 前缀。
// 失败判定本身已改为读 ToolResult.isError 结构化信号，不再依赖此前缀。
function readExplicitToolErrorMessage(content: string): string {
  const trimmed = String(content || "").trim();
  return trimmed.startsWith("Error:") ? trimmed.slice("Error:".length).trim() : "";
}

function buildCollaborationSystemFragment(meta: Record<string, unknown> | undefined): string {
  const lines: string[] = [];
  const diagnosticContext =
    meta?.diagnosticContext && typeof meta.diagnosticContext === "object" && !Array.isArray(meta.diagnosticContext)
      ? (meta.diagnosticContext as Record<string, unknown>)
      : null;
  const planningRequired = diagnosticContext?.planningRequired === true;
  const planningChecklistFirst = diagnosticContext?.planningChecklistFirst === true;
  const planningMinimumStepsRaw = Number(diagnosticContext?.planningMinimumSteps);
  const planningMinimumSteps = Number.isFinite(planningMinimumStepsRaw)
    ? Math.max(2, Math.min(8, Math.trunc(planningMinimumStepsRaw)))
    : 2;
  const planningReason =
    typeof diagnosticContext?.planningReason === "string" ? diagnosticContext.planningReason.trim() : "";
  const planningChecklistItems = Array.isArray(diagnosticContext?.planningChecklistItems)
    ? diagnosticContext.planningChecklistItems
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
  if (planningRequired) {
    lines.push("## Execution Planning");
    lines.push(`- PlanningRequired: true`);
    lines.push(`- MinimumChecklistSteps: ${planningMinimumSteps}`);
    if (planningChecklistFirst) {
      lines.push("- ChecklistFirstRequirement: true");
      lines.push(
        "- Before any side-effectful write/generation/code-staging action, create or update a concrete Todo checklist that covers the required execution stages in order."
      );
      lines.push(
        "- Do not skip required middle stages just because later-stage tools are available."
      );
    }
    if (planningReason) {
      lines.push(`- PlanningReason: ${planningReason}`);
    }
    if (planningChecklistItems.length > 0) {
      lines.push("- RequiredChecklistStages:");
      planningChecklistItems.forEach((item) => lines.push(`  - ${item}`));
    }
  }
  if (Array.isArray(meta?.localResourcePaths) && meta.localResourcePaths.length > 0) {
    lines.push("## Scoped Local Evidence");
    for (const item of meta.localResourcePaths) {
      const pathValue = String(item || "").trim();
      if (!pathValue) continue;
      lines.push(`- allowedLocalPath: ${pathValue}`);
    }
    lines.push(
      "Only gather local evidence from the allowedLocalPath entries above.",
      "Do not say the allowed local paths were missing; they are listed above.",
      "If those paths do not contain enough evidence, stop and report the gap instead of searching .agents, apps, packages, or other workspace directories."
    );
  }
  return lines.join("\n").trim();
}

type PreparedToolCall = {
  call: { id: string; name: string; arguments: string };
  args: Record<string, unknown>;
  toolCallIndex: number;
  executionOrigin?: HarnessExecutionOrigin;
  blockedError?: string;
  deferredResult?: {
    content: string;
    structuredOutput: Record<string, unknown>;
  };
};

type HarnessExecutionOrigin = {
  agentId: string;
  parentToolCallId?: string;
  llmTurnIndex: number;
  executionBatchIndex: number;
  executionBatchCallIndex: number;
  executionBatchCallCount: number;
  toolCallIndex: number;
  schemaVersion?: 2;
  invocationPath?: HarnessInvocationSegment[];
  layoutStagePath?: number[];
  layoutItemPath?: HarnessLayoutItemSegment[];
};

type HarnessInvocationSegment = {
  agentId: string;
  layoutStageIndex: number;
  executionBatchCallIndex: number;
  executionBatchCallCount: number;
  toolCallIndex: number;
  toolCallId: string;
};

type HarnessLayoutItemSegment = {
  index: number;
  count: number;
};

function isHarnessIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readInheritedInvocationPath(meta: Record<string, unknown>): HarnessInvocationSegment[] {
  const value = meta.harnessExecutionOrigin;
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const origin = value as Record<string, unknown>;
  if (
    origin.schemaVersion !== 2
    || !Array.isArray(origin.invocationPath)
    || !Array.isArray(origin.layoutStagePath)
    || !Array.isArray(origin.layoutItemPath)
    || origin.invocationPath.length === 0
    || origin.invocationPath.length > 8
    || origin.layoutStagePath.length !== origin.invocationPath.length
    || origin.layoutItemPath.length !== origin.invocationPath.length
  ) {
    return [];
  }
  const segments: HarnessInvocationSegment[] = [];
  for (let index = 0; index < origin.invocationPath.length; index += 1) {
    const rawSegment = origin.invocationPath[index];
    const rawItem = origin.layoutItemPath[index];
    if (
      !rawSegment || typeof rawSegment !== "object" || Array.isArray(rawSegment)
      || !rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)
    ) {
      return [];
    }
    const segment = rawSegment as Record<string, unknown>;
    const item = rawItem as Record<string, unknown>;
    const agentId = typeof segment.agentId === "string" ? segment.agentId.trim() : "";
    const toolCallId = typeof segment.toolCallId === "string" ? segment.toolCallId.trim() : "";
    if (
      !agentId
      || !toolCallId
      || !isHarnessIndex(segment.layoutStageIndex)
      || !isHarnessIndex(segment.executionBatchCallIndex)
      || !isHarnessIndex(segment.executionBatchCallCount)
      || segment.executionBatchCallCount === 0
      || segment.executionBatchCallIndex >= segment.executionBatchCallCount
      || !isHarnessIndex(segment.toolCallIndex)
      || origin.layoutStagePath[index] !== segment.layoutStageIndex
      || item.index !== segment.executionBatchCallIndex
      || item.count !== segment.executionBatchCallCount
    ) {
      return [];
    }
    segments.push({
      agentId,
      layoutStageIndex: segment.layoutStageIndex,
      executionBatchCallIndex: segment.executionBatchCallIndex,
      executionBatchCallCount: segment.executionBatchCallCount,
      toolCallIndex: segment.toolCallIndex,
      toolCallId,
    });
  }
  return segments;
}

function buildHarnessExecutionOrigin(input: {
  meta: Record<string, unknown>;
  call: { id: string };
  llmTurnIndex: number;
  executionBatchIndex: number;
  executionBatchCallIndex: number;
  executionBatchCallCount: number;
  toolCallIndex: number;
  layoutStageIndex: number | null;
}): HarnessExecutionOrigin {
  const agentId = typeof input.meta.currentAgentId === "string" && input.meta.currentAgentId.trim()
    ? input.meta.currentAgentId.trim()
    : "root";
  const parentToolCallId = typeof input.meta.parentToolCallId === "string"
    ? input.meta.parentToolCallId.trim()
    : "";
  const base: HarnessExecutionOrigin = {
    agentId,
    ...(parentToolCallId ? { parentToolCallId } : {}),
    llmTurnIndex: input.llmTurnIndex,
    executionBatchIndex: input.executionBatchIndex,
    executionBatchCallIndex: input.executionBatchCallIndex,
    executionBatchCallCount: input.executionBatchCallCount,
    toolCallIndex: input.toolCallIndex,
  };
  if (input.layoutStageIndex == null) return base;

  const inheritedPath = readInheritedInvocationPath(input.meta);
  if (inheritedPath.length >= 8) return base;
  const currentSegment: HarnessInvocationSegment = {
    agentId,
    layoutStageIndex: input.layoutStageIndex,
    executionBatchCallIndex: input.executionBatchCallIndex,
    executionBatchCallCount: input.executionBatchCallCount,
    toolCallIndex: input.toolCallIndex,
    toolCallId: input.call.id,
  };
  const invocationPath = [...inheritedPath, currentSegment];
  return {
    ...base,
    schemaVersion: 2,
    invocationPath,
    layoutStagePath: invocationPath.map((segment) => segment.layoutStageIndex),
    layoutItemPath: invocationPath.map((segment) => ({
      index: segment.executionBatchCallIndex,
      count: segment.executionBatchCallCount,
    })),
  };
}

function reuseCanvasLayoutSlot(
  origin: HarnessExecutionOrigin,
  operationKey: string,
  slots: Map<string, { layoutStagePath: number[]; layoutItemPath: HarnessLayoutItemSegment[] }>,
): HarnessExecutionOrigin {
  if (
    origin.schemaVersion !== 2
    || !origin.layoutStagePath
    || !origin.layoutItemPath
  ) {
    return origin;
  }
  const existing = slots.get(operationKey);
  if (existing) {
    return {
      ...origin,
      layoutStagePath: [...existing.layoutStagePath],
      layoutItemPath: existing.layoutItemPath.map((segment) => ({ ...segment })),
    };
  }
  slots.set(operationKey, {
    layoutStagePath: [...origin.layoutStagePath],
    layoutItemPath: origin.layoutItemPath.map((segment) => ({ ...segment })),
  });
  return origin;
}

type ToolExecutionOutcome = {
  message: { role: "tool"; content: string; toolCallId: string };
  fatalError?: Error;
};

function getDuplicateToolCallLimit(): number {
  const raw = Number(process.env.AGENTS_DUPLICATE_TOOL_CALL_LIMIT ?? 3);
  if (!Number.isFinite(raw)) return 3;
  return Math.max(1, Math.trunc(raw));
}

function getSkillToolConcurrency(): number {
  const raw = Number(process.env.AGENTS_SKILL_CONCURRENCY ?? 4);
  if (!Number.isFinite(raw)) return 4;
  return Math.max(1, Math.trunc(raw));
}

const DEFERRED_SKILL_LOAD_CODE = "deferred_skill_load_phase_scoped";

function readPreparedSkillName(item: PreparedToolCall): string {
  if (item.call.name !== "Skill") return "";
  const skill = item.args.skill;
  return typeof skill === "string" ? skill.trim() : "";
}

function withPhaseScopedSkillLoadGate(
  calls: PreparedToolCall[],
  requiredSkills: string[],
): PreparedToolCall[] {
  const required = new Set(
    requiredSkills.map((skill) => skill.trim()).filter(Boolean),
  );
  let nonRequiredSkillLoadedThisTurn = false;
  return calls.map((item) => {
    if (
      item.call.name !== "Skill" ||
      item.blockedError ||
      item.deferredResult
    ) {
      return item;
    }
    const skillName = readPreparedSkillName(item);
    if (skillName && required.has(skillName)) return item;
    if (!nonRequiredSkillLoadedThisTurn) {
      nonRequiredSkillLoadedThisTurn = true;
      return item;
    }
    const structuredOutput = {
      ok: true,
      code: DEFERRED_SKILL_LOAD_CODE,
      skill: skillName || null,
      message:
        "Skill load deferred: only one non-required automatic Skill may be loaded in a single assistant turn. Finish the current phase or stage decision first, then request this Skill in a later turn if it is still needed.",
    };
    return {
      ...item,
      deferredResult: {
        content: JSON.stringify(structuredOutput),
        structuredOutput,
      },
    };
  });
}

const MAX_PARALLEL_IMAGE_GENERATIONS = 2;

function getToolConcurrency(): number {
  const raw = Number(process.env.AGENTS_TOOL_CONCURRENCY ?? 6);
  if (!Number.isFinite(raw)) return 6;
  return Math.max(1, Math.trunc(raw));
}

function getToolBatchConcurrency(batch: PreparedToolCall[]): number {
  const toolLimit = getToolConcurrency();
  const onlySkill = batch.every((item) => item.call.name === "Skill");
  if (onlySkill) return Math.min(toolLimit, getSkillToolConcurrency());
  const containsImageGeneration = batch.some(
    (item) => item.call.name === "canvas_image_generate_to_canvas",
  );
  return containsImageGeneration
    ? Math.min(toolLimit, MAX_PARALLEL_IMAGE_GENERATIONS)
    : toolLimit;
}

function readEnvMs(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.trunc(raw));
}

function trackDuplicateToolCall(
  state: import("./tools/registry.js").ToolRuntimeState,
  toolName: string,
  args: Record<string, unknown>
): { blocked: boolean; message: string } {
  if (toolName !== "bash" && toolName !== "read_file" && toolName !== "read_file_range") {
    return { blocked: false, message: "" };
  }
  const signature = `${toolName}:${stableStringify(args)}`;
  const current = (state.guard.duplicateToolCallCount.get(signature) ?? 0) + 1;
  state.guard.duplicateToolCallCount.set(signature, current);
  if (current > 1) {
    console.warn(
      `[agents] duplicate tool call detected tool=${toolName} count=${current} limit=${state.guard.duplicateToolCallLimit} signature=${signature}`
    );
  }
  if (current <= state.guard.duplicateToolCallLimit) {
    return { blocked: false, message: "" };
  }
  return {
    blocked: true,
    message: `重复工具调用超过阈值(${state.guard.duplicateToolCallLimit})：${toolName} args=${stableStringify(
      args
    )}`,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

function collectLoadedSkills(messages: Message[]): Set<string> {
  const out = new Set<string>();
  for (const msg of messages) {
    const content = String(msg?.content || "");
    if (!content) continue;
    const re = /<skill-loaded\s+name="([^"]+)">/gi;
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(content))) {
      const name = String(m[1] || "").trim();
      if (name) out.add(name);
    }
  }
  return out;
}

function readUnknownErrorMessage(error: unknown): string {
  return error instanceof Error && typeof error.message === "string"
    ? error.message
    : String(error);
}

function parseToolArgs(raw: string): { args: Record<string, unknown>; error?: string } {
  const input = typeof raw === "string" && raw.trim() ? raw : "{}";
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        args: {},
        error: "工具参数必须是 JSON object，已阻止本次工具执行。",
      };
    }
    return { args: parsed as Record<string, unknown> };
  } catch (err: unknown) {
    return {
      args: {},
      error: `工具参数不是合法 JSON，已阻止本次工具执行: ${readUnknownErrorMessage(err)}`,
    };
  }
}

function readFinishBlockDecision(input: {
  toolCalls: ToolCallTrace[];
  state?: ToolRuntimeState;
  availableToolNames?: ReadonlySet<string>;
}): FinishBlockDecision | null {
  const pendingCanonicalArtifacts = input.state?.canonicalTextArtifacts
    ? Array.from(input.state.canonicalTextArtifacts.keys())
    : [];
  if (pendingCanonicalArtifacts.length > 0) {
    return {
      reason: "pending_canonical_text_persistence",
      message: [
        "<runtime_completion_self_check>",
        "本轮尚不能结束：Plan 已返回完整分镜剧本，但权威正文尚未成功持久化到画布。",
        "pendingCanonicalTextArtifacts:",
        ...pendingCanonicalArtifacts.map((outputKey) => `- outputKey=${outputKey}`),
        "requiredActions:",
        "- 调用 canvas_create_text_node，node 必须传对象，node.id 使用对应 outputKey。",
        `- node.data.content 使用 ${AGENT_OUTPUT_REFERENCE_PREFIX}<outputKey>，或完全复用 Agent 返回的原文；禁止摘要、改写或重构。`,
        "- 写入失败时继续复用同一原文重试；成功前不得派发任何下游 Agent，也不得声明 Phase 1 完成。",
        "</runtime_completion_self_check>",
      ].join("\n"),
    };
  }
  const pendingMediaAttempts = summarizeUnresolvedPendingMediaAttempts({
    attempts: input.state?.attempts,
    toolCalls: input.toolCalls,
    availableToolNames: input.availableToolNames,
  });
  if (pendingMediaAttempts.length === 0) return null;

  const waitableAttempts = pendingMediaAttempts.filter((item) => item.waitToolAvailable);
  return {
    reason: "pending_direct_media_generation",
    message: [
      "<runtime_completion_self_check>",
      "本轮尚不能结束：存在已提交但尚未解析出最终 URL 的直接媒体生成任务。",
      "pendingMedia:",
      ...pendingMediaAttempts.map(
        (item) =>
          `- kind=${item.kind} nodeId=${item.nodeId} waitTool=${item.waitToolName} waitToolAvailable=${item.waitToolAvailable ? "true" : "false"}`,
      ),
      "requiredActions:",
      ...(waitableAttempts.length > 0
        ? [
            "- 调用对应 wait tool 轮询并回填真实媒体 URL；不要声称该 wait tool 不可用。",
            `- 当前可执行 wait tools: ${waitableAttempts
              .map((item) => item.waitToolName)
              .join(", ")}`,
          ]
        : [
            "- 当前 tools 数组缺少对应 wait tool，必须基于该事实显式报告 blocked/needs-input，不能把 queued/running 当作完成。",
          ]),
      "</runtime_completion_self_check>",
    ].join("\n"),
  };
}

type PendingMediaCompletionIssue = {
  kind: "image" | "video";
  nodeId: string;
  waitToolName: string;
  waitToolAvailable: boolean;
};

function summarizeUnresolvedPendingMediaAttempts(input: {
  attempts?: GenerationAttemptRecord[];
  toolCalls: ToolCallTrace[];
  availableToolNames?: ReadonlySet<string>;
}): PendingMediaCompletionIssue[] {
  const attempts = Array.isArray(input.attempts) ? input.attempts : [];
  if (attempts.length === 0) return [];

  const resolvedWaitKeys = buildResolvedMediaWaitKeys(input.toolCalls);
  const issues: PendingMediaCompletionIssue[] = [];
  for (const attempt of attempts) {
    if (attempt.status !== "submitted") continue;
    if (attempt.url) continue;

    const kind = attempt.kind === "image" || attempt.kind === "video" ? attempt.kind : null;
    if (!kind) continue;

    const nodeId = String(attempt.nodeId || "").trim();
    if (!nodeId || nodeId === "unknown") continue;

    const key = buildMediaWaitKey(kind, nodeId);
    if (resolvedWaitKeys.has(key)) continue;

    const waitToolName = getMediaWaitToolName(kind);
    issues.push({
      kind,
      nodeId,
      waitToolName,
      waitToolAvailable: input.availableToolNames?.has(waitToolName) === true,
    });
  }
  return issues;
}

function buildResolvedMediaWaitKeys(toolCalls: ToolCallTrace[]): Set<string> {
  const out = new Set<string>();
  for (const toolCall of toolCalls) {
    if (toolCall.status !== "succeeded") continue;

    const kind = getWaitToolMediaKind(toolCall.name);
    if (!kind) continue;

    const record =
      normalizeJsonRecord(toolCall.outputJson) ??
      parseJsonRecord(toolCall.output) ??
      parseJsonRecord(toolCall.outputHead) ??
      parseJsonRecord(toolCall.outputTail);
    const nodeId = readRecordString(toolCall.args, "nodeId") || readRecordString(record, "nodeId");
    if (!nodeId) continue;

    const mediaUrl = readMediaUrl(record, kind);
    if (!mediaUrl) continue;

    out.add(buildMediaWaitKey(kind, nodeId));
  }
  return out;
}

function readWaitFailureStatus(structuredOutput: unknown): "failed" | "timed_out" {
  const record = normalizeJsonRecord(structuredOutput);
  const code = readRecordString(record, "code");
  return code === "agents_tool_image_wait_timeout" || code === "agents_tool_video_wait_timeout"
    ? "timed_out"
    : "failed";
}

function getWaitToolMediaKind(toolName: string): "image" | "video" | null {
  if (toolName === "canvas_image_wait_for_result") return "image";
  if (toolName === "canvas_video_wait_for_result") return "video";
  return null;
}

function getMediaWaitToolName(kind: "image" | "video"): string {
  return kind === "image" ? "canvas_image_wait_for_result" : "canvas_video_wait_for_result";
}

function buildMediaWaitKey(kind: "image" | "video", nodeId: string): string {
  return `${kind}:${nodeId}`;
}

function readMediaUrl(record: Record<string, unknown> | null, kind: "image" | "video"): string {
  const key = kind === "image" ? "imageUrl" : "videoUrl";
  const direct = readRecordString(record, key);
  if (direct) return direct;
  const data = normalizeJsonRecord(record?.data);
  return readRecordString(data, key);
}

function readRecordString(record: Record<string, unknown> | null | undefined, key: string): string {
  if (!record) return "";
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function buildExecutionBatches(
  calls: PreparedToolCall[],
  registry: ToolRegistry,
  toolCatalog: ToolCatalog,
): ExecutionBatch[] {
  const batches: ExecutionBatch[] = [];
  let currentParallel: PreparedToolCall[] = [];
  let currentParallelConflictKeys = new Set<string>();
  const flushParallel = () => {
    if (currentParallel.length === 0) return;
    batches.push({ parallel: true, calls: currentParallel });
    currentParallel = [];
    currentParallelConflictKeys = new Set();
  };
  for (const item of calls) {
    const decision = shouldParallelizeTool(item, registry, toolCatalog);
    if (decision.safe) {
      if (decision.conflictKey && currentParallelConflictKeys.has(decision.conflictKey)) {
        flushParallel();
      }
      currentParallel.push(item);
      if (decision.conflictKey) currentParallelConflictKeys.add(decision.conflictKey);
      continue;
    }
    flushParallel();
    batches.push({ parallel: false, calls: [item] });
  }
  flushParallel();
  return batches;
}

function buildAskUserTurnGate(calls: PreparedToolCall[]): {
  askUserCall: PreparedToolCall;
  blockedCalls: PreparedToolCall[];
} | null {
  const askUserIndex = calls.findIndex((call) => call.call.name === ASK_USER_TOOL_NAME);
  if (askUserIndex < 0) return null;
  const askUserCall = calls[askUserIndex];
  if (!askUserCall) return null;
  return {
    askUserCall,
    blockedCalls: calls.filter((_call, index) => index !== askUserIndex),
  };
}

function findSuccessfulAskUserToolPrompt(toolCalls: ToolCallTrace[]): AskUserToolPrompt | null {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const prompt = readAskUserToolPrompt(toolCalls[index]);
    if (prompt) return prompt;
  }
  return null;
}

function readAskUserToolPrompt(toolCall: ToolCallTrace | undefined): AskUserToolPrompt | null {
  if (!toolCall) return null;
  if (String(toolCall.name || "").trim() !== ASK_USER_TOOL_NAME) return null;
  if (toolCall.status !== "succeeded") return null;
  const record =
    normalizeJsonRecord(toolCall.outputJson) ??
    parseJsonRecord(toolCall.output) ??
    parseJsonRecord(toolCall.outputHead) ??
    parseJsonRecord(toolCall.outputTail);
  if (!record) return null;
  const status = typeof record.status === "string" ? record.status.trim() : "";
  if (status !== "awaiting_user_reply") return null;
  const question = typeof record.question === "string" ? record.question.trim() : "";
  if (!question) return null;
  const urgencyRaw = typeof record.urgency === "string" ? record.urgency.trim() : "";
  const urgency: AskUserToolPrompt["urgency"] =
    urgencyRaw === "info" || urgencyRaw === "confirmation" || urgencyRaw === "blocker"
      ? urgencyRaw
      : "confirmation";
  return {
    toolCallId: toolCall.toolCallId,
    question,
    options: readAskUserOptions(record.options),
    urgency,
  };
}

function parseJsonRecord(input: unknown): Record<string, unknown> | null {
  const text = String(input || "").trim();
  if (!text || !text.startsWith("{") || !text.endsWith("}")) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return normalizeJsonRecord(parsed);
  } catch {
    return null;
  }
}

function normalizeJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readAskUserOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const options: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = typeof item === "string" ? item.trim() : "";
    if (!text || seen.has(text)) continue;
    seen.add(text);
    options.push(text);
    if (options.length >= 8) break;
  }
  return options;
}

function buildAskUserFinalReply(prompt: AskUserToolPrompt): string {
  const lines = [prompt.question];
  if (prompt.options.length > 0) {
    lines.push("", "可选回复：");
    prompt.options.forEach((option, index) => {
      lines.push(`${index + 1}. ${option}`);
    });
  }
  return lines.join("\n");
}

type ToolParallelizationDecision = {
  safe: boolean;
  conflictKey?: string;
};

const PARALLEL_REMOTE_MEDIA_TOOLS = new Set([
  "canvas_image_generate_to_canvas",
  "canvas_video_generate_to_canvas",
  "canvas_image_wait_for_result",
  "canvas_video_wait_for_result",
]);

function readToolArgString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRemoteMediaNodeId(args: Record<string, unknown>): string {
  const direct =
    readToolArgString(args.nodeId) ||
    readToolArgString(args.targetNodeId) ||
    readToolArgString(args.outputKey);
  if (direct) return direct;
  const node = normalizeJsonRecord(args.node);
  return readToolArgString(node?.id);
}

function shouldParallelizeRemoteMediaTool(
  item: PreparedToolCall,
  toolCatalog: ToolCatalog,
): ToolParallelizationDecision {
  if (!PARALLEL_REMOTE_MEDIA_TOOLS.has(item.call.name)) return { safe: false };
  const runtimeTool = toolCatalog.get(item.call.name);
  if (runtimeTool?.provider.kind !== "remote") return { safe: false };
  const nodeId = readRemoteMediaNodeId(item.args);
  if (!nodeId) return { safe: false };
  return {
    safe: true,
    conflictKey: `remote-media-node:${nodeId}`,
  };
}

function shouldParallelizeTool(
  item: PreparedToolCall,
  registry: ToolRegistry,
  toolCatalog: ToolCatalog,
): ToolParallelizationDecision {
  const handler = registry.getHandler(item.call.name);
  if (handler?.isConcurrencySafe) {
    try {
      if (handler.isConcurrencySafe(item.args)) return { safe: true };
    } catch {
      return { safe: false };
    }
  }
  return shouldParallelizeRemoteMediaTool(item, toolCatalog);
}

function filterTools(tools: ToolDefinition[], allowed: Set<string> | null) {
  if (!allowed) return tools;
  return tools.filter((tool) => allowed.has(tool.name));
}

function buildPerTurnToolDefinitions(
  tools: ToolDefinition[],
  skills: SkillLoader,
  requiredSkills: string[],
): ToolDefinition[] {
  return tools.map((tool) =>
    tool.name === "Skill"
      ? { ...tool, description: buildSkillToolDescription(skills, requiredSkills) }
      : tool,
  );
}

function summarizeToolUsageForMemory(toolCalls: ToolCallTrace[]): string[] {
  return toolCalls
    .filter((toolCall) => toolCall.status === "succeeded")
    .slice(-8)
    .map((toolCall) => `${toolCall.name}:${toolCall.outputHead || toolCall.outputTail || "ok"}`)
    .map((item) => item.trim())
    .filter(Boolean);
}

type ExecutionBatch = {
  parallel: boolean;
  calls: PreparedToolCall[];
};

function buildSkillToolDescription(skills: SkillLoader, requiredSkills: string[] = []) {
  return skills.renderSkillToolDescription({ requiredSkills });
}

function renderProvidedSystemSkillProtocol(input: {
  providedSystem: string;
  tools: string[];
  allowedTools: Set<string> | null;
  skills: SkillLoader;
  requiredSkills: string[];
  omitSkillCatalog: boolean;
}): string {
  if (input.omitSkillCatalog) return "";
  if (input.providedSystem.includes("## Skills")) return "";
  const available = input.allowedTools ?? new Set(input.tools);
  if (!available.has("Skill")) return "";
  return input.skills.renderSkillsSection({ requiredSkills: input.requiredSkills });
}
