import { randomUUID } from "node:crypto";
import type { ToolResult } from "../../types/index.js";
import type { ToolHandler } from "./registry.js";
import type { AgentRunner } from "../agent-loop.js";
import type { ToolRegistry } from "./registry.js";
import { runSubagent } from "../subagent/runner.js";
import { getActiveAgentDefinitions, getAgentDefinition } from "../subagent/definitions.js";
import { getMissingDeclaredTools } from "../subagent/types.js";
import { readRemoteToolDefinitions, readMcpToolDefinitions } from "./remote.js";
import { BackgroundTaskManager } from "../background/manager.js";
import { TaskBoard } from "../runtime/task-board.js";
import { emitTraceEvent } from "../hooks/builtins/wire-trace.js";
import { traceContext } from "../../runtime/trace-context.js";
import type { RuntimeRunEventSink } from "../../runtime/events.js";
import {
  AGENT_OUTPUT_REFERENCE_PREFIX,
  isStoryboardScriptTaskContract,
  listPendingCanonicalTextArtifactKeys,
  registerCanonicalStoryboardScript,
  validateStoryboardScriptContract,
} from "../canonical-text-artifacts.js";

function formatSubagentTypes(): string {
  const out: string[] = [];
  for (const def of getActiveAgentDefinitions().values()) {
    const toolsLine = def.tools.includes("*")
      ? "全部已注册工具"
      : def.tools.slice(0, 8).join(", ") + (def.tools.length > 8 ? ", ..." : "");
    const readonlyTag = def.isReadOnly ? "（只读）" : "";
    const disallowedLine =
      def.disallowedTools && def.disallowedTools.length > 0
        ? `\n  禁用工具: ${def.disallowedTools.join(", ")}`
        : "";
    out.push(`- **${def.name}**${readonlyTag}: ${def.description}\n  授权工具: ${toolsLine}${disallowedLine}`);
  }
  return out.length > 0 ? out.join("\n") : "（暂无可用 subagent_type）";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function sameStringIdentitySet(left: string[], right: string[]): boolean {
  if (left.length !== right.length || new Set(left).size !== left.length || new Set(right).size !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clipText(value: string, max = 1200): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

function summarizeArray(value: unknown): unknown {
  if (!Array.isArray(value)) return undefined;
  return {
    count: value.length,
    sample: value.slice(0, 6),
  };
}

function compactStructuredOutput(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const keys = [
    "status",
    "ok",
    "committed",
    "blocked",
    "verdict",
    "overall_score",
    "targetNodeId",
    "nodeId",
    "sectionId",
    "previewNodeId",
    "order",
    "sessionId",
    "taskId",
    "assetId",
    "slotId",
    "nextSubagentType",
    "codegenPrepareRecordId",
    "persistedDraftCount",
    "sectionDraftsPersisted",
    "reason",
    "nextStep",
  ];
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) out[key] = value[key];
  }
  for (const key of [
    "completed",
    "pending",
    "failed",
    "blocked",
    "skipped",
    "dispatched",
    "issues",
    "approvedPreviewNodes",
    "missingEvidence",
  ]) {
    const summary = summarizeArray(value[key]);
    if (summary) out[key] = summary;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildSubagentToolContent(input: {
  subagentType: string;
  subAgentId: string;
  finalText: string;
  structuredOutput?: unknown;
  mode: "compact" | "full";
}): { content: string; payload: { text: string; structuredOutput: unknown } } {
  const structured = input.structuredOutput ?? parseJsonObject(input.finalText) ?? undefined;
  const compact = compactStructuredOutput(structured);
  const textPreview = clipText(input.finalText);
  const payloadStructured = {
    subAgentId: input.subAgentId,
    subagentType: input.subagentType,
    resultMode: input.mode,
    structuredOutput: structured,
    fullText: input.finalText,
    compact,
  };
  if (input.mode === "full") {
    return {
      content: input.finalText,
      payload: { text: input.finalText, structuredOutput: payloadStructured },
    };
  }
  const lines = [
    `sub-agent [${input.subagentType}] completed.`,
    `subAgentId: ${input.subAgentId}`,
  ];
  if (compact) {
    lines.push(`compactResult: ${JSON.stringify(compact)}`);
  } else {
    lines.push(`textPreview: ${textPreview}`);
  }
  lines.push("full result is stored in tool payload/trace; request result_mode=\"full\" only when the parent must inspect the entire text.");
  const content = lines.join("\n");
  return {
    content,
    payload: { text: content, structuredOutput: payloadStructured },
  };
}

function isWebHeroResultCompactByDefault(subagentType: string): boolean {
  return new Set([
    "webhero_asset_generator",
    "codegen",
    "section_codegen",
    "webhero_merge_codegen",
  ]).has(subagentType);
}

function resolveResultMode(input: {
  requestedMode: unknown;
  subagentType: string;
}): "compact" | "full" {
  if (input.requestedMode === "compact" || input.requestedMode === "full") {
    return input.requestedMode;
  }
  return isWebHeroResultCompactByDefault(input.subagentType) ? "compact" : "full";
}

function readCurrentAgentType(meta: Record<string, unknown> | undefined): string {
  return typeof meta?.currentAgentType === "string" ? meta.currentAgentType.trim() : "";
}

function validateWebHeroSubagentDispatch(input: {
  parentAgentType: string;
  subagentType: string;
  taskContract: unknown;
  runtimeMergeEvidence: unknown;
  runtimeStyleEvidence: unknown;
}): string | null {
  const contract = isRecord(input.taskContract) ? input.taskContract : null;
  const rawContractKind = String(contract?.kind ?? "").trim();
  const contractKind = rawContractKind.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const webPreviewKindTokens = rawContractKind.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const looksLikeWebHeroPreview =
    (webPreviewKindTokens.includes("webpreview")
      || (webPreviewKindTokens.includes("web") && webPreviewKindTokens.includes("preview"))
      || webPreviewKindTokens.includes("webhero"))
    && webPreviewKindTokens.includes("generation");
  if (input.subagentType === "media" && looksLikeWebHeroPreview && rawContractKind !== "webPreview_generation") {
    return "Error: WebHero preview media 派发时 task_contract.kind 必须精确为 webPreview_generation。";
  }
  if (input.subagentType === "media" && rawContractKind === "webPreview_generation") {
    const targetNodeIds = readStringArray(contract?.targetNodeIds);
    if (targetNodeIds.length !== 1) {
      return "Error: WebHero preview media 派发时 task_contract.targetNodeIds 必须且只能包含一个 target WebHero nodeId。";
    }
    const evidence = isRecord(input.runtimeStyleEvidence) ? input.runtimeStyleEvidence : null;
    if (
      !evidence
      || String(evidence.targetNodeId ?? "").trim() !== targetNodeIds[0]
      || String(evidence.flowReadToolCallId ?? "").trim().length === 0
      || String(evidence.flowUpdatedAt ?? "").trim() !== String(contract?.flowUpdatedAt ?? "").trim()
      || evidence.styleReferencePersisted !== true
    ) {
      return "Error: WebHero preview media 派发缺少匹配的 runtime persisted-style verification；task_contract 中的 URL 或文字声明不能替代 target node 上真实落盘的 selectedStyleReference。";
    }
  }
  if (input.subagentType === "section_codegen" && input.parentAgentType !== "codegen") {
    if (!input.parentAgentType && contractKind === "webhero_section_codegen") {
      return null;
    }
    return "Error: section_codegen 只能由 WebHero codegen sub-agent，或 root/main agent 携带 task_contract.kind=\"webhero_section_codegen\" 直接派发。root 直接派发时必须负责收集完整 section draft 并写入 target WebHero 顶层 webPageSectionDrafts；其它直接派发会绕过落盘流程。";
  }
  if (input.subagentType === "webhero_merge_codegen") {
    if (input.parentAgentType) {
      return "Error: webhero_merge_codegen 只能由 root/main agent 在 codegen 已落盘 webPageSectionDrafts 后直接派发，不能由 codegen 或其它 sub-agent 嵌套派发。请等待 codegen 返回 directMergeHandoff 后再由 root 派发 merge。";
    }
    if (!contract || String(contract.kind ?? "").trim() !== "webhero_merge_codegen") {
      return "Error: root 派发 webhero_merge_codegen 必须携带 task_contract.kind=\"webhero_merge_codegen\"。";
    }
    if (contract.sectionDraftsPersisted !== true) {
      return "Error: root 派发 webhero_merge_codegen 前必须确认 task_contract.sectionDraftsPersisted=true。";
    }
    const persistedDraftCount = contract.persistedDraftCount;
    if (!Number.isInteger(persistedDraftCount) || Number(persistedDraftCount) <= 0) {
      return "Error: root 派发 webhero_merge_codegen 必须提供正整数 task_contract.persistedDraftCount。";
    }
    const rawApprovedPreviewNodes = contract.approvedPreviewNodes;
    const approvedPreviewNodes = readStringArray(rawApprovedPreviewNodes);
    if (
      !Array.isArray(rawApprovedPreviewNodes)
      || approvedPreviewNodes.length !== rawApprovedPreviewNodes.length
      || approvedPreviewNodes.length !== persistedDraftCount
    ) {
      return "Error: task_contract.approvedPreviewNodes 必须是无空值、无重复的节点 ID 列表，且长度必须等于 persistedDraftCount。";
    }
    const targetNodeIds = readStringArray(contract.targetNodeIds);
    if (targetNodeIds.length !== 1) {
      return "Error: root 派发 webhero_merge_codegen 时 task_contract.targetNodeIds 必须且只能包含一个 target WebHero nodeId。";
    }
    const contractFlowUpdatedAt = String(contract.flowUpdatedAt ?? "").trim();
    if (!contractFlowUpdatedAt) {
      return "Error: root 派发 webhero_merge_codegen 时 task_contract.flowUpdatedAt 必须匹配最新 readiness flow revision。";
    }
	const contractCodeInputDigest = String(contract.codeInputDigest ?? "").trim();
	if (!/^sha256:[a-f0-9]{64}$/.test(contractCodeInputDigest)) {
	  return "Error: root 派发 webhero_merge_codegen 时 task_contract.codeInputDigest 必须精确复制最新 readiness digest。";
	}
    const runtimeEvidence = isRecord(input.runtimeMergeEvidence) ? input.runtimeMergeEvidence : null;
    const runtimePreviewNodeIds = readStringArray(runtimeEvidence?.previewNodeIds);
    if (
      !runtimeEvidence
      || String(runtimeEvidence.targetNodeId ?? "").trim() !== targetNodeIds[0]
      || String(runtimeEvidence.readinessToolCallId ?? "").trim().length === 0
      || runtimeEvidence.previewNodeCount !== persistedDraftCount
      || runtimePreviewNodeIds.length !== approvedPreviewNodes.length
      || runtimePreviewNodeIds.some((nodeId) => !approvedPreviewNodes.includes(nodeId))
      || String(runtimeEvidence.flowUpdatedAt ?? "").trim() !== contractFlowUpdatedAt
	  || String(runtimeEvidence.codeInputDigest ?? "").trim() !== contractCodeInputDigest
    ) {
      return "Error: webhero_merge_codegen 缺少匹配的 runtime readiness verification；自报 sectionDraftsPersisted 不能作为已落盘证据。";
    }
  }
  return null;
}

function normalizeMediaUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
  if (!/\.(png|jpe?g|webp|gif|heic|heif|mp4|webm)$/i.test(parsed.pathname)) return "";
  return parsed.toString();
}

function readMediaUrlArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const url = normalizeMediaUrl(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function isInternalCanvasMediaUrl(value: string): boolean {
  try {
    return /\/(?:assets\/r2\/)?gen\/(?:images|videos|thumbnails)\//i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

function extractMediaUrlsFromPrompt(prompt: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of prompt.matchAll(/https?:\/\/[^\s<>"'，。；、)）\]}]+/g)) {
    const url = normalizeMediaUrl(match[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function normalizeTaskContract(value: unknown, prompt: string): {
  contract: Record<string, unknown>;
  allowedCanvasNodeIds: string[];
  allowedMediaUrls: string[];
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const contract = { ...(value as Record<string, unknown>) };
  const allowedCanvasNodeIds = [
    ...readStringArray(contract.allowedNodeIds),
    ...readStringArray(contract.targetNodeIds),
    ...readStringArray(contract.contextNodeIds),
  ].filter((nodeId, index, all) => all.indexOf(nodeId) === index);
  const allowedNodeIds = readStringArray(contract.allowedNodeIds);
  const targetNodeIds = readStringArray(contract.targetNodeIds);
  const contextNodeIds = readStringArray(contract.contextNodeIds);
  const hasNodeScope = allowedNodeIds.length > 0 || targetNodeIds.length > 0 || contextNodeIds.length > 0;
  const targetMediaUrls = readMediaUrlArray(contract.targetMediaUrls);
  const contextMediaUrls = readMediaUrlArray(contract.contextMediaUrls);
  const allowedMediaUrls = [
    ...readMediaUrlArray(contract.allowedMediaUrls),
    ...targetMediaUrls,
    ...contextMediaUrls,
    ...(hasNodeScope ? [] : extractMediaUrlsFromPrompt(prompt)),
  ].filter((url, index, all) => all.indexOf(url) === index);
  if (allowedNodeIds.length > 0) {
    contract.allowedNodeIds = allowedNodeIds;
  }
  if (targetNodeIds.length > 0) {
    contract.targetNodeIds = targetNodeIds;
  }
  if (contextNodeIds.length > 0) {
    contract.contextNodeIds = contextNodeIds;
  }
  if (targetMediaUrls.length > 0) {
    contract.targetMediaUrls = targetMediaUrls;
  }
  if (contextMediaUrls.length > 0) {
    contract.contextMediaUrls = contextMediaUrls;
  }
  if (allowedMediaUrls.length > 0) {
    contract.allowedMediaUrls = allowedMediaUrls;
  }
  return { contract, allowedCanvasNodeIds, allowedMediaUrls };
}

function isStyleReferenceReadRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /selectedStyleReference/i.test(text) ||
    /style[_\s-]*reference/i.test(normalized) ||
    /风格参考/.test(text) ||
    /读取风格/.test(text) ||
    /观察绑定参考图/.test(text)
  );
}

function collectCriticScopeMediaUrls(input: { prompt: string; context?: string }): string[] {
  const combined = [input.prompt, input.context ?? ""].filter(Boolean).join("\n");
  if (isStyleReferenceReadRequest(combined)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const source of [input.prompt, input.context ?? ""]) {
    for (const url of extractMediaUrlsFromPrompt(source)) {
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

function stripErrorPrefix(content: string): string {
  const trimmed = (content || "").trim();
  return trimmed.startsWith("Error:") ? trimmed.slice("Error:".length).trim() : trimmed;
}

function readEventSink(meta: Record<string, unknown> | undefined): RuntimeRunEventSink | null {
  const candidate = meta?.eventSink;
  return typeof candidate === "function" ? (candidate as RuntimeRunEventSink) : null;
}

// 统一构造结构化失败结果：失败是 ToolResult 上的一等信号（isError），不靠 content 前缀嗅探。
function agentErrorResult(toolCallId: string, content: string, errorMessage?: string): ToolResult {
  return {
    toolCallId,
    content,
    isError: true,
    errorMessage: errorMessage ?? stripErrorPrefix(content),
  };
}

function buildAgentToolDescription(): string {
  return [
    "派发子 agent 完成自包含子任务。子 agent 独立跑 LLM 多轮循环，返回最终结果文本。",
    "",
    "使用场景：独立可并行子任务、需隔离上下文的重任务、有明确交付物的子问题。",
    "不用场景：单步操作直接调工具、需多轮交互、需父上下文判断的任务。",
    "",
    "同一轮中互不依赖的 Agent 调用会并发执行；storyboard_script 是阶段屏障，必须同步串行完成并持久化权威剧本后，才能派发下游 Agent。普通链路默认返回完整结果；WebHero 长链路专用 subagent 默认只返回 compact result，完整结果保留在 trace/payload。需要覆盖默认策略时显式设置 result_mode。",
    "阶段型派发必须保持最小 handoff：prompt 只保留一句当前阶段执行目标，并明确读取什么输入、生成什么当前阶段产物；已落画布的剧本/素材只通过 contextNodeIds 交接，未落节点的原始剧本才逐字放入 context。",
    "sub-agent 根据 task_contract.kind、真实输入和当前目标，自主从 Skills catalog 选择并加载当前阶段需要的 Skill；主 Agent 不要指定 Skill 名称，也不要转述 Skill 方法论。父 agent 的 required skills 不会传给 sub-agent。",
    "userConstraints 只允许用户原始硬约束；downstreamPurpose 只说明下游用途，不能变成当前阶段约束。",
    "禁止把 final prompt、negative prompt、storyboard layout、运行 manifest、未来阶段规则或从其它 Skill 推导出的禁止项塞进 handoff。",
    `storyboard_script 必须声明且只声明一个 outputKey，它同时是目标 text 节点 ID。Plan 返回的完整正文是不可有损改写的权威产物；用 canvas_create_text_node 的对象参数写入，并优先把 node.data.content 设为 ${AGENT_OUTPUT_REFERENCE_PREFIX}<outputKey>，运行时会解析为完整原文。写入失败时复用同一原文重试，禁止重新摘要或重构。`,
    "",
    "## 可用 subagent_type",
    "",
    formatSubagentTypes(),
  ].join("\n");
}

export function createAgentTool(deps: {
  runner: AgentRunner;
  registry: ToolRegistry;
}): ToolHandler {
  return {
    definition: {
      name: "Agent",
      description: buildAgentToolDescription(),
      parameters: {
        type: "object",
        properties: {
          subagent_type: {
            type: "string",
            description: "要派发的 sub-agent 类型名称。",
          },
          description: {
            type: "string",
            description: "3-5 词描述任务用途，便于追踪。",
          },
          prompt: {
            type: "string",
            description: "传给 sub-agent 的当前阶段执行目标；阶段型派发只写一句，并明确读取什么输入、生成什么当前阶段产物，具体事实与边界放 context/task_contract。",
          },
          context: {
            type: "string",
            description: "可选上下文块（项目风格、方向约束、scope 限定等），会与 prompt 合并为 sub-agent 的 user message。",
          },
          fork_context: {
            type: "boolean",
            description: "是否拷贝父对话历史；默认 false。",
          },
          run_in_background: {
            type: "boolean",
            description: "true 表示后台异步派发，立即返回任务 ID，结果通过 background-notification 通知。仅在父 agent 还有别的独立工作可做时使用。storyboard_script 禁止后台派发；默认 false（同步等结果）。",
          },
          result_mode: {
            type: "string",
            enum: ["compact", "full"],
            description: "返回给父 agent 的内容模式。普通 subagent 默认 full；WebHero 长链路专用 subagent 默认 compact，以避免父上下文过长。显式设置后覆盖默认策略。",
          },
          task_contract: {
            type: "object",
            description:
              "可选结构化任务契约。内部画布媒体必须使用 targetNodeIds/contextNodeIds/allowedNodeIds 交接，后续生成通过 sourceNodeId 引用，禁止复制内部素材 URL。allowedMediaUrls/targetMediaUrls/contextMediaUrls 仅用于真正的外部 URL-only critic 证据。",
            properties: {
              kind: { type: "string" },
              targetNodeIds: { type: "array", items: { type: "string" } },
              contextNodeIds: { type: "array", items: { type: "string" } },
              allowedNodeIds: { type: "array", items: { type: "string" } },
              targetMediaUrls: { type: "array", items: { type: "string" } },
              contextMediaUrls: { type: "array", items: { type: "string" } },
              allowedMediaUrls: { type: "array", items: { type: "string" } },
              outputKeys: {
                type: "array",
                items: { type: "string" },
                description: "稳定输出身份。storyboard_script 必须且只能提供一个 outputKey，并将它用作权威剧本 text 节点的 node.id。",
              },
              downstreamPurpose: { type: "string" },
              userConstraints: { type: "array", items: { type: "string" } },
              completionEvidence: { type: "array", items: { type: "string" } },
              resumeExistingTasks: { type: "boolean" },
              sectionDraftsPersisted: {
                type: "boolean",
                description: "WebHero merge 专用：只有 section drafts 已写入目标 WebHero 节点时才能为 true。",
              },
              persistedDraftCount: {
                type: "integer",
                minimum: 1,
                description: "WebHero merge 专用：目标 WebHero 节点中已持久化的 section draft 数量。",
              },
              approvedPreviewNodes: {
                type: "array",
                items: { type: "string" },
                description: "WebHero merge 专用：与已持久化 section drafts 一一对应的已批准 preview node ID。",
              },
              flowUpdatedAt: {
                type: "string",
                description: "WebHero preview/merge 专用：preview 必须精确复制持久化风格后 canvas_flow_get 返回的 updatedAt；merge 必须精确复制最新 readiness 返回的 flowUpdatedAt。",
              },
			  codeInputDigest: {
				type: "string",
				description: "WebHero merge 专用：精确复制最新 readiness 返回的 canonical codegen input digest，并原样传给每个 stage chunk。",
			  },
              checks: { type: "array", items: { type: "string" } },
              rubricFocus: { type: "array", items: { type: "string" } },
            },
            additionalProperties: true,
          },
        },
        required: ["subagent_type", "description", "prompt"],
      },
    },
    isConcurrencySafe: (args) =>
      !isStoryboardScriptTaskContract(args.task_contract)
      && String(args.subagent_type ?? "").trim() !== "webhero_merge_codegen",
    async execute(args, ctx, toolCallId) {
      const callId = toolCallId || randomUUID();
      const subagentType = String(args.subagent_type ?? "").trim();
      const prompt = String(args.prompt ?? "").trim();
      if (!subagentType) {
        return agentErrorResult(callId, "Error: subagent_type 必填。");
      }
      if (!prompt) {
        return agentErrorResult(callId, "Error: prompt 必填。");
      }
      const definition = getAgentDefinition(subagentType);
      if (!definition) {
        return agentErrorResult(callId, `Error: 未知 subagent_type '${subagentType}'。`);
      }
      const pendingCanonicalKeys = listPendingCanonicalTextArtifactKeys(ctx.state);
      if (pendingCanonicalKeys.length > 0) {
        return agentErrorResult(
          callId,
          `Error: 权威剧本仍待持久化（${pendingCanonicalKeys.join(", ")}）。必须先用 canvas_create_text_node 原样写入对应 outputKey，禁止继续派发下游 Agent。`,
        );
      }
      const storyboardScriptContractError = validateStoryboardScriptContract(args.task_contract);
      if (storyboardScriptContractError) {
        return agentErrorResult(callId, storyboardScriptContractError);
      }
      if (
        isStoryboardScriptTaskContract(args.task_contract) &&
        (definition.background === true || args.run_in_background === true)
      ) {
        return agentErrorResult(
          callId,
          "Error: storyboard_script 不支持后台派发；必须同步取得完整正文并在同一 run 内持久化权威剧本节点。",
        );
      }
      const dispatchError = validateWebHeroSubagentDispatch({
        parentAgentType: readCurrentAgentType(ctx.meta),
        subagentType,
        taskContract: args.task_contract,
        runtimeMergeEvidence: ctx.meta?.webHeroMergeDispatchEvidence,
        runtimeStyleEvidence: ctx.meta?.webHeroPreviewDispatchEvidence,
      });
      if (dispatchError) {
        return agentErrorResult(callId, dispatchError);
      }
      const MAX_SUBAGENT_DEPTH = 5;
      const currentDepth = typeof ctx.meta?.depth === "number" ? ctx.meta.depth : 0;
      if (currentDepth >= MAX_SUBAGENT_DEPTH) {
        return agentErrorResult(
          callId,
          `Error: 已达到最大嵌套深度 (${MAX_SUBAGENT_DEPTH})，无法继续派发 sub-agent。`,
        );
      }
      const parentAbort = ctx.meta?.abortSignal;
      const abortSignal =
        parentAbort instanceof AbortSignal ? parentAbort : undefined;
      const parentMeta = ctx.meta;
      const remoteToolNames = readRemoteToolDefinitions(parentMeta).map((tool) => tool.name);
      const mcpToolNames = readMcpToolDefinitions(parentMeta).map((tool) => tool.name);
      const availableToolNames = Array.from(
        new Set([
          ...deps.registry.listAllToolNames(),
          ...remoteToolNames,
          ...mcpToolNames,
        ]),
      );
      const missingTools = getMissingDeclaredTools(subagentType, availableToolNames);
      if (missingTools.length > 0) {
        return agentErrorResult(
          callId,
          `Error: sub-agent '${subagentType}' 在当前 runtime 下不可用。` +
            `定义声明需要工具 [${missingTools.join(", ")}]，但这些工具未在父 agent 注册。` +
            `这通常意味着当前 profile 不支持该 sub-agent（例如画布/general profile 下没有 read_file/write_file/bash 等本地工具）。` +
            `请改用其它 sub-agent 类型，或把这类任务交给 code profile 的入口处理；不要换路径换措辞重试派发。`,
        );
      }
      try {
        const context = typeof args.context === "string" ? args.context.trim() : undefined;
        const scopeText = [prompt, context].filter(Boolean).join("\n");
        const contractText = args.task_contract && typeof args.task_contract === "object"
          ? JSON.stringify(args.task_contract)
          : "";
        const copiedInternalMediaUrls = extractMediaUrlsFromPrompt([scopeText, contractText].join("\n"))
          .filter(isInternalCanvasMediaUrl);
        if (copiedInternalMediaUrls.length > 0) {
          return agentErrorResult(
            callId,
            "Error: sub-agent handoff contains internal canvas media URLs. Replace them with task_contract targetNodeIds/contextNodeIds and use sourceNodeId in generation references; the backend resolves the latest persisted URL.",
          );
        }
        const isBackground = definition.background === true || args.run_in_background === true;
        const implicitCriticMediaUrls =
          subagentType === "critic" ? collectCriticScopeMediaUrls({ prompt, context }) : [];
        const taskContractInput =
          args.task_contract ??
          (implicitCriticMediaUrls.length > 0
            ? { kind: "resource_scoped_review", allowedMediaUrls: implicitCriticMediaUrls }
            : undefined);
        const mediaScopeText = isStyleReferenceReadRequest(scopeText) ? "" : scopeText;
        const normalizedTaskContract = normalizeTaskContract(taskContractInput, mediaScopeText);
        const subagentParentMeta = normalizedTaskContract
          ? {
              ...(ctx.meta ?? {}),
              subagentTaskContract: normalizedTaskContract.contract,
              ...(normalizedTaskContract.allowedCanvasNodeIds.length > 0
                ? { allowedCanvasNodeIds: normalizedTaskContract.allowedCanvasNodeIds }
                : {}),
              ...(normalizedTaskContract.allowedMediaUrls.length > 0
                ? { allowedMediaUrls: normalizedTaskContract.allowedMediaUrls }
                : {}),
            }
          : ctx.meta;

        const subagentOptions = {
          runner: deps.runner,
          cwd: ctx.cwd,
          agentType: subagentType,
          prompt,
          context,
          parentMeta: subagentParentMeta,
          forkHistory: args.fork_context === true,
          abortStrategy: abortSignal
            ? { kind: "sync" as const, parent: abortSignal }
            : { kind: "async" as const },
          availableTools: availableToolNames,
          parentToolCallId: callId,
        };

        if (isBackground) {
          const subAgentId = `sub_bg_${randomUUID().slice(0, 8)}`;
          const currentAgentId = typeof ctx.meta?.currentAgentId === "string"
            ? ctx.meta.currentAgentId
            : "root";
          const manager = ctx.meta?.backgroundTaskManager instanceof BackgroundTaskManager
            ? ctx.meta.backgroundTaskManager as BackgroundTaskManager
            : null;
          const eventSink = readEventSink(ctx.meta);
          const createdAt = new Date().toISOString();

          TaskBoard.register({ taskId: subAgentId, agentType: subagentType });
          void eventSink?.({
            type: "subagent.status",
            taskId: subAgentId,
            subagentType,
            status: "running",
            summary: `sub-agent [${subagentType}] 已启动`,
            parentToolCallId: callId,
            createdAt,
          });

          void (async () => {
            try {
              emitTraceEvent("subagent.dispatch", {
                type: "subagent.dispatch",
                toolCallId: callId,
                subagentName: subagentType,
                childRunId: subAgentId,
                childPrompt: prompt,
              });
              const result = await runSubagent({ ...subagentOptions, subAgentIdOverride: subAgentId });
              registerCanonicalStoryboardScript({
                state: ctx.state,
                taskContract: normalizedTaskContract?.contract ?? taskContractInput,
                text: result.finalText,
                sourceToolCallId: callId,
              });
              TaskBoard.markFinished(subAgentId, "succeeded");
              const finishedAt = new Date().toISOString();
              const summary = `sub-agent [${subagentType}] 完成: ${result.finalText.slice(0, 300)}`;
              void eventSink?.({
                type: "subagent.status",
                taskId: subAgentId,
                subagentType,
                status: "succeeded",
                summary,
                parentToolCallId: callId,
                createdAt: finishedAt,
              });
              manager?.emitAgentNotification({
                taskId: subAgentId,
                audience: currentAgentId,
                status: "completed",
                summary,
                createdAt: finishedAt,
              });
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              TaskBoard.markFinished(subAgentId, "failed");
              const failedAt = new Date().toISOString();
              const summary = `sub-agent [${subagentType}] 失败: ${msg}`;
              void eventSink?.({
                type: "subagent.status",
                taskId: subAgentId,
                subagentType,
                status: "failed",
                summary,
                parentToolCallId: callId,
                createdAt: failedAt,
              });
              manager?.emitAgentNotification({
                taskId: subAgentId,
                audience: currentAgentId,
                status: "failed",
                summary,
                createdAt: failedAt,
              });
            }
          })();

          return {
            toolCallId: callId,
            content: `后台 sub-agent [${subagentType}] 已启动 (id=${subAgentId})。完成后将通过 background-notification 通知你结果。`,
          };
        }

        emitTraceEvent("subagent.dispatch", {
          type: "subagent.dispatch",
          toolCallId: callId,
          subagentName: subagentType,
          childRunId: callId,
          childPrompt: prompt,
        });
        const result = await runSubagent(subagentOptions);
        registerCanonicalStoryboardScript({
          state: ctx.state,
          taskContract: normalizedTaskContract?.contract ?? taskContractInput,
          text: result.finalText,
          sourceToolCallId: callId,
        });
        const mode = resolveResultMode({
          requestedMode: args.result_mode,
          subagentType,
        });
        const rendered = buildSubagentToolContent({
          subagentType,
          subAgentId: result.subAgentId,
          finalText: result.finalText,
          structuredOutput: result.structuredOutput,
          mode,
        });
        return { toolCallId: callId, content: rendered.content, payload: rendered.payload };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const directive =
          `子代理 [${subagentType}] 执行失败：${message}\n` +
          `这是硬失败：该子任务没有产出任何有效结果。` +
          `严禁据此伪造完成——不要创建任何声称"评审/质检/审核/评估已完成"的节点，` +
          `也不要在交付汇总或回复里把该步骤标记为已完成。` +
          `请如实告知用户该步骤失败及原因；若属可恢复的外部故障（如模型网关不可用），可在修复后重试，` +
          `但不要仅靠换措辞重复派发同一子任务。`;
        return agentErrorResult(callId, directive, `sub-agent 执行失败：${message}`);
      }
    },
  };
}
