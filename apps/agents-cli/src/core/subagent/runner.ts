import { randomUUID } from "node:crypto";
import type { Message } from "../../types/index.js";
import type { AgentRunner } from "../agent-loop.js";
import type { ToolCallTrace, LlmTurnTrace } from "../hooks/types.js";
import type { RuntimeRunEventSink } from "../../runtime/events.js";
import { parseRuntimeTodoUpdate } from "../../runtime/todo-events.js";
import { createSubagentContext, type AbortStrategy } from "./context.js";
import { getAgentDefinition } from "./definitions.js";
import { getSystemPromptForAgent, getToolsForAgent } from "./types.js";
import type { AgentLlmCreds } from "../agent-loop.js";
import { TaskBoard, type TaskBoardCanvasMutation } from "../runtime/task-board.js";
import {
  createNativeVideoInputUnsupportedError,
  supportsNativeVideoInputProtocol,
} from "../../llm/video-input.js";

function inferCanvasKindFromToolName(toolName: string): string | null {
  if (toolName.startsWith("canvas_image_")) return "image";
  if (toolName.startsWith("canvas_video_")) return "video";
  if (toolName.startsWith("canvas_storyboard_")) return "storyboard";
  if (toolName.startsWith("canvas_scene_")) return "scene";
  if (toolName.startsWith("canvas_character_")) return "character";
  if (toolName.startsWith("canvas_")) return "canvas";
  return null;
}

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function buildCanvasMutationFromToolCall(toolCall: ToolCallTrace): TaskBoardCanvasMutation | null {
  const kind = inferCanvasKindFromToolName(toolCall.name);
  if (!kind) return null;
  const output = toolCall.outputJson;
  if (!output || typeof output !== "object") return null;
  const nodeId = readStringField(output, "nodeId");
  if (!nodeId) return null;
  const assetUrl =
    readStringField(output, "imageUrl") ??
    readStringField(output, "videoUrl") ??
    readStringField(output, "assetUrl");
  const label = readStringField(output, "label");
  const status: TaskBoardCanvasMutation["status"] =
    toolCall.status === "succeeded" ? "succeeded" : toolCall.status === "failed" ? "failed" : "running";
  const mutation: TaskBoardCanvasMutation = { nodeId, kind, status };
  if (assetUrl) mutation.assetUrl = assetUrl;
  if (label) mutation.label = label;
  return mutation;
}

function readInheritedLlmCreds(
  meta: Record<string, unknown> | undefined,
): AgentLlmCreds | null {
  const raw = meta?.currentLlmCreds;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<AgentLlmCreds>;
  if (
    typeof candidate.apiKey === "string" &&
    typeof candidate.baseUrl === "string" &&
    typeof candidate.model === "string" &&
    candidate.apiKey.length > 0 &&
    candidate.baseUrl.length > 0
  ) {
    return {
      apiKey: candidate.apiKey,
      baseUrl: candidate.baseUrl,
      model: candidate.model,
      ...(typeof candidate.apiProtocol === "string" ? { apiProtocol: candidate.apiProtocol } : {}),
    };
  }
  return null;
}

function readGoogleV1BetaCreds(
  meta: Record<string, unknown> | undefined,
  declaredModel: string | undefined,
): AgentLlmCreds {
  const fromMeta = readMultimodalCredsFromMeta(meta);
  if (!fromMeta.apiKey || !fromMeta.baseUrl) {
    throw new Error(
      "sub-agent 声明 modelProvider='google-v1beta'，但 hono-api bridge 未注入 multimodalCreds.apiKey/baseUrl。" +
        "请在 ModelPanel → multimodal slot 选择一个 google-v1beta 协议的 vendor/model 并配置 API Key。" +
        "no-silent-fallback 原则禁止退化到 process.env 或父 agent 的 OpenAI 兼容 provider。",
    );
  }
  const model = declaredModel || fromMeta.model;
  if (!model) {
    throw new Error(
      "sub-agent 声明 modelProvider='google-v1beta'，但 multimodalCreds.model 与 definition.model 都为空。",
    );
  }
  return { apiKey: fromMeta.apiKey, baseUrl: fromMeta.baseUrl, model, apiProtocol: "google-v1beta" };
}

function readMultimodalSlotCreds(
  meta: Record<string, unknown> | undefined,
  declaredModel: string | undefined,
): AgentLlmCreds {
  const fromMeta = readMultimodalCredsFromMeta(meta);
  if (!fromMeta.apiKey || !fromMeta.baseUrl) {
    throw new Error(
      "sub-agent 声明 useMultimodalSlot=true，但 hono-api bridge 未注入 multimodalCreds（apiKey/baseUrl）。" +
        "请在 ModelPanel → multimodal slot 选择一个已配置 API Key 的 vendor/model。" +
        "no-silent-fallback 原则禁止退化到父 agent 的 Agent slot creds。",
    );
  }
  const model = declaredModel || fromMeta.model;
  if (!model) {
    throw new Error(
      "sub-agent 声明 useMultimodalSlot=true，但 multimodalCreds.model 与 definition.model 都为空。",
    );
  }
  const apiProtocol = fromMeta.apiProtocol;
  return {
    apiKey: fromMeta.apiKey,
    baseUrl: fromMeta.baseUrl,
    model,
    ...(apiProtocol ? { apiProtocol } : {}),
  };
}

function readMultimodalCredsFromMeta(meta: Record<string, unknown> | undefined): {
  apiKey: string;
  baseUrl: string;
  model: string;
  apiProtocol?: AgentLlmCreds["apiProtocol"];
} {
  const raw = meta?.multimodalCreds;
  if (!raw || typeof raw !== "object") return { apiKey: "", baseUrl: "", model: "" };
  const record = raw as Record<string, unknown>;
  const protocolRaw = typeof record.apiProtocol === "string" ? record.apiProtocol : "";
  let apiProtocol: AgentLlmCreds["apiProtocol"] | undefined;
  if (
    protocolRaw === "openai-chat" ||
    protocolRaw === "openai-responses" ||
    protocolRaw === "google-v1beta" ||
    protocolRaw === "anthropic-messages"
  ) {
    apiProtocol = protocolRaw;
  } else if (protocolRaw.length > 0) {
    throw new Error(
      `multimodalCreds.apiProtocol='${protocolRaw}' 不是受支持的协议（openai-chat / openai-responses / google-v1beta / anthropic-messages）。` +
        "no-silent-fallback 原则禁止悄悄丢弃未知协议。",
    );
  }
  return {
    apiKey: typeof record.apiKey === "string" ? record.apiKey : "",
    baseUrl: typeof record.baseUrl === "string" ? record.baseUrl : "",
    model: typeof record.model === "string" ? record.model : "",
    ...(apiProtocol ? { apiProtocol } : {}),
  };
}

export type RunSubagentOptions = {
  runner: AgentRunner;
  cwd: string;
  agentType: string;
  prompt: string;
  context?: string;
  parentMeta: Record<string, unknown> | undefined;
  parentMessages?: Message[];
  forkHistory?: boolean;
  abortStrategy: AbortStrategy;
  availableTools: string[];
  description?: string;
  parentToolCallId?: string;
  subAgentIdOverride?: string;
};

export type RunSubagentResult = {
  subAgentId: string;
  agentType: string;
  finalText: string;
  structuredOutput?: unknown;
};

function readEventSink(meta: Record<string, unknown> | undefined): RuntimeRunEventSink | null {
  const candidate = meta?.eventSink;
  return typeof candidate === "function" ? (candidate as RuntimeRunEventSink) : null;
}

function buildSubagentAbortSignal(input: {
  parentSignal: AbortSignal | undefined;
  timeoutMs: number | undefined;
  agentType: string;
}): { signal?: AbortSignal; cleanup: () => void } {
  const timeoutMs =
    typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
      ? Math.trunc(input.timeoutMs)
      : 0;
  if (!input.parentSignal && timeoutMs <= 0) {
    return { cleanup() { return; } };
  }
  const controller = new AbortController();
  let timeoutHandle: NodeJS.Timeout | null = null;
  const abortFromParent = () => {
    const reason = input.parentSignal?.reason;
    controller.abort(reason instanceof Error ? reason : undefined);
  };
  if (input.parentSignal) {
    if (input.parentSignal.aborted) {
      abortFromParent();
    } else {
      input.parentSignal.addEventListener("abort", abortFromParent, { once: true });
    }
  }
  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      controller.abort(new Error(`sub-agent ${input.agentType} 执行超过 ${timeoutMs}ms 已中止。`));
    }, timeoutMs);
  }
  return {
    signal: controller.signal,
    cleanup() {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (input.parentSignal) input.parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}

function extractStructuredOutput(text: string): unknown | undefined {
  const pattern = /```json\s*\n([\s\S]*?)\n```/g;
  let lastMatch: string | undefined;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    lastMatch = match[1];
  }
  if (!lastMatch) return undefined;
  try {
    return JSON.parse(lastMatch);
  } catch {
    return undefined;
  }
}

function renderTaskContractSystemFragment(meta: Record<string, unknown> | undefined): string {
  const contract = meta?.subagentTaskContract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return "";
  let serialized: string;
  try {
    serialized = JSON.stringify(contract, null, 2);
  } catch {
    serialized = String(contract);
  }
  return [
    "## Task Contract",
    "Treat this task_contract as the authoritative task scope. If the caller prompt conflicts with task_contract, keep the task_contract scope and report the conflict.",
    "Only operate on nodes or media URLs explicitly allowed by allowedNodeIds/targetNodeIds/targetMediaUrls/contextMediaUrls/allowedMediaUrls when present. Do not broaden scope to the whole canvas or arbitrary URLs.",
    "When task_contract.kind is present, it defines the current phase. Use only skills and production rules relevant to that phase.",
    "contextNodeIds are required input references, not the input content itself. Before producing output, use the available scoped read tool to read every context node whose text or media content is needed. canvas_flow_inspect is state-only and does not return script text or media content. If required input cannot be read, return blocked instead of guessing.",
    "userConstraints may contain only explicit user constraints. downstreamPurpose describes downstream use only and must never become a current-phase constraint or import rules from a later phase.",
    "For storyboard_generation, downstreamPurpose=storyboard_for_video does not mean removing headers, shot numbers, timecodes, dialogue/caption areas, panel borders, or production layout. Only an explicit userConstraint may override the storyboard deliverable.",
    "For internal canvas media, use targetNodeIds/contextNodeIds and pass sourceNodeId to generation tools. Never copy an internal image/video URL into prompts or tool arguments; the backend resolves the latest persisted URL from the node ID.",
    "```json",
    serialized,
    "```",
  ].join("\n");
}

const SUBAGENT_RUNTIME_CONTRACT = [
  "## Runtime Contract",
  "本轮是受限执行任务。",
  "内部画布媒体硬约束：只使用 sourceNodeId/assetId 和 targetNodeIds/contextNodeIds 传递引用；禁止把内部 imageUrl/videoUrl 写入 prompt、task_contract、工具参数或最终报告。任何 role prompt 或 Skill 中要求内部真实 URL 的旧说明均由本约束覆盖。Harness/Hono 会在执行时解析最新持久化 URL。完成证据使用 nodeId、assetId、taskId、status=success 与 persisted=true。",
  "",
  "优先级：",
  "1. 本 system 中的角色定义与工具约束",
  "2. Task Contract（如有）",
  "3. user message（包括当前任务上下文与本轮任务）",
  "",
  "严格在上述范围内执行，不要扩大 scope，不要新增未指定产物。",
  "只能调用本轮 tools 数组中显式提供的工具。",
  "如果输入、权限、工具、外部任务状态或生成结果阻塞，明确返回 blocked/failed/pending 与原因，不要伪造完成。",
].join("\n");

function buildSubagentSystemPrompt(input: {
  rolePrompt: string;
  taskContractFragment: string;
}): string {
  return [
    SUBAGENT_RUNTIME_CONTRACT,
    input.rolePrompt,
    input.taskContractFragment,
  ].filter(Boolean).join("\n\n");
}

function buildSubagentUserPrompt(input: { context?: string; prompt: string }): string {
  const context = String(input.context || "").trim();
  const prompt = String(input.prompt || "").trim();
  if (!context) return prompt;
  return [
    "## 当前任务上下文",
    "",
    context,
    "",
    "## 本轮任务",
    "",
    prompt,
  ].join("\n");
}

export async function runSubagent(options: RunSubagentOptions): Promise<RunSubagentResult> {
  const definition = getAgentDefinition(options.agentType);
  if (!definition) {
    throw new Error(`未知 sub-agent 类型：${options.agentType}`);
  }
  if (
    definition.modelProvider &&
    definition.modelProvider !== "openai-chat" &&
    definition.modelProvider !== "openai-responses" &&
    definition.modelProvider !== "google-v1beta" &&
    definition.modelProvider !== "anthropic-messages"
  ) {
    throw new Error(
      `sub-agent '${options.agentType}' 声明 modelProvider='${definition.modelProvider}'，但该 provider 尚未在 LLMClient 中实现。` +
      `按 no-silent-fallback 原则禁止退化到父 agent 的 OpenAI 兼容 provider。请先实现该 provider 的 adapter，或暂停派发该 sub-agent。`,
    );
  }
  const subAgentId = options.subAgentIdOverride ?? `sub_${randomUUID()}`;
  const ctx = createSubagentContext({
    parentMeta: options.parentMeta,
    subAgentId,
    subagentType: options.agentType,
    parentToolCallId: options.parentToolCallId,
    forkHistory: options.forkHistory === true,
    parentMessages: options.parentMessages,
    abortStrategy: options.abortStrategy,
  });

  const allowedTools = getToolsForAgent(options.agentType, {
    availableTools: options.availableTools,
  });
  const requiredSkills: string[] = [];
  ctx.toolContextMeta.currentRequiredSkills = requiredSkills;

  const systemPrompt = buildSubagentSystemPrompt({
    rolePrompt: getSystemPromptForAgent(options.agentType),
    taskContractFragment: renderTaskContractSystemFragment(ctx.toolContextMeta),
  });
  const userPrompt = buildSubagentUserPrompt({
    context: options.context,
    prompt: options.prompt,
  });
  const eventSink = readEventSink(options.parentMeta);
  const agentDepth = typeof ctx.toolContextMeta.depth === "number" ? ctx.toolContextMeta.depth : 1;
  const scope = {
    agentId: subAgentId,
    agentType: options.agentType,
    agentDepth,
    ...(options.parentToolCallId ? { parentToolCallId: options.parentToolCallId } : {}),
  };

  const inheritedLlmCreds = readInheritedLlmCreds(options.parentMeta);
  const effectiveLlmCreds: AgentLlmCreds | null =
    definition.useMultimodalSlot === true
      ? readMultimodalSlotCreds(options.parentMeta, definition.model)
      : definition.modelProvider === "google-v1beta"
        ? readGoogleV1BetaCreds(options.parentMeta, definition.model)
        : inheritedLlmCreds;
  if (
    definition.requiresNativeVideoInput === true &&
    !supportsNativeVideoInputProtocol(effectiveLlmCreds?.apiProtocol)
  ) {
    throw createNativeVideoInputUnsupportedError(
      effectiveLlmCreds?.apiProtocol ?? "unconfigured",
    );
  }
  void eventSink?.({ type: "run.started", prompt: userPrompt, ...scope });
  console.log(
    `[diag.runSubagent] agentType=${options.agentType} useMultimodalSlot=${definition.useMultimodalSlot === true} modelProvider=${definition.modelProvider ?? "<none>"} effective.apiProtocol=${effectiveLlmCreds?.apiProtocol ?? "<undefined>"} effective.baseUrl=${effectiveLlmCreds?.baseUrl ?? "<n/a>"} effective.model=${effectiveLlmCreds?.model ?? "<n/a>"}`,
  );

  try {
    const abort = buildSubagentAbortSignal({
      parentSignal: ctx.abortSignal,
      timeoutMs: definition.timeoutMs,
      agentType: options.agentType,
    });
    const finalText = await options.runner.run(userPrompt, options.cwd, {
      depth: agentDepth,
      systemMode: { kind: "provided", system: systemPrompt },
      allowedTools,
      requiredSkills,
      history: ctx.history,
      toolContextMeta: ctx.toolContextMeta,
      state: ctx.state,
      abortSignal: abort.signal,
      ephemeralUserPrompt: false,
      ...(typeof definition.maxTurns === "number" && Number.isFinite(definition.maxTurns) && definition.maxTurns > 0
        ? { maxTurns: definition.maxTurns }
        : {}),
      ...(effectiveLlmCreds ? { currentLlmCreds: effectiveLlmCreds } : {}),
      onToolStart: (toolStart) => {
        void eventSink?.({
          type: "tool.started",
          toolCallId: toolStart.toolCallId,
          name: toolStart.name,
          args: toolStart.args,
          startedAt: toolStart.startedAt,
          ...scope,
        });
      },
      onTextDelta: (delta) => {
        void eventSink?.({ type: "text.delta", delta, ...scope });
      },
      onTurn: (turn: LlmTurnTrace) => {
        void eventSink?.({ type: "turn.completed", turn, ...scope });
      },
      onToolCall: (toolCall: ToolCallTrace) => {
        const todoUpdate = parseRuntimeTodoUpdate(toolCall);
        if (todoUpdate) {
          void eventSink?.({ type: "todo.updated", todo: todoUpdate, ...scope });
        }
        const mutation = buildCanvasMutationFromToolCall(toolCall);
        if (mutation) {
          TaskBoard.recordCanvasMutation(subAgentId, mutation);
        }
        TaskBoard.recordTool(subAgentId, toolCall.name);
        void eventSink?.({ type: "tool.completed", toolCall, ...scope });
      },
    }).finally(() => abort.cleanup());
    void eventSink?.({ type: "run.completed", result: finalText, ...scope });
    const structuredOutput = extractStructuredOutput(finalText);
    return { subAgentId, agentType: options.agentType, finalText, ...(structuredOutput !== undefined ? { structuredOutput } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void eventSink?.({ type: "run.failed", message, ...scope });
    throw error;
  } finally {
    ctx.cleanup();
  }
}
