import type { ToolCallTrace } from "./hooks/types.js";
import {
  canonicalWebHeroSectionDraft,
  computeWebHeroSectionDraftDigest,
  diagnoseWebHeroSectionDraftContent,
} from "../contracts/webhero-evidence-contract.js";

const WEBHERO_STAGE_TOOLS = new Set([
  "canvas_webhero_code_stage_chunk",
  "canvas_webhero_code_stage_raw_chunk",
]);

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readNodeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readMissing(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function findLatestReadinessAttemptWithIndex(
  toolCalls: ToolCallTrace[],
  nodeId: string,
): { trace: ToolCallTrace; index: number } | null {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = toolCalls[index];
    if (
      toolCall?.name === "canvas_webhero_check_readiness"
      && readNodeId(toolCall.args.nodeId) === nodeId
    ) {
      return { trace: toolCall, index };
    }
  }
  return null;
}

function findLatestReadinessAttempt(toolCalls: ToolCallTrace[], nodeId: string): ToolCallTrace | null {
  return findLatestReadinessAttemptWithIndex(toolCalls, nodeId)?.trace ?? null;
}

function isMergeAttemptForTarget(toolCall: ToolCallTrace, nodeId: string): boolean {
  if (toolCall.name !== "Agent" || readNodeId(toolCall.args.subagent_type) !== "webhero_merge_codegen") {
    return false;
  }
  const contract = readRecord(toolCall.args.task_contract);
  return readStringArray(contract?.targetNodeIds).includes(nodeId);
}

function readExactUniqueStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parsed.length !== value.length || new Set(parsed).size !== parsed.length) return null;
  return parsed;
}

function sameStringIdentitySet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

export type WebHeroSectionDraftWriteVerification = {
  error?: string;
  verifiedArgs?: Record<string, unknown>;
};

function exactSectionDraftContentMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalWebHeroSectionDraft(left)) ===
    JSON.stringify(canonicalWebHeroSectionDraft(right));
}

function successfulSectionCodegenMatch(input: {
  draft: Record<string, unknown>;
  targetNodeId: string;
  toolCalls: ToolCallTrace[];
  consumedToolCallIds: Set<string>;
}): { toolCallId: string; subAgentId: string } | null {
  for (let index = input.toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = input.toolCalls[index];
    if (
      !toolCall ||
      input.consumedToolCallIds.has(toolCall.toolCallId) ||
      toolCall.name !== "Agent" ||
      toolCall.status !== "succeeded" ||
      readNodeId(toolCall.args.subagent_type) !== "section_codegen"
    ) {
      continue;
    }
    const contract = readRecord(toolCall.args.task_contract);
    const targetNodeIds = readExactUniqueStringArray(contract?.targetNodeIds);
    const contextNodeIds = readExactUniqueStringArray(contract?.contextNodeIds);
    const allowedNodeIds = readExactUniqueStringArray(contract?.allowedNodeIds);
    const draftPreviewNodeId = readNodeId(input.draft.previewNodeId);
    if (
      readNodeId(contract?.kind) !== "webhero_section_codegen" ||
      targetNodeIds?.length !== 1 ||
      targetNodeIds[0] !== input.targetNodeId ||
      contextNodeIds?.length !== 1 ||
      contextNodeIds[0] !== draftPreviewNodeId ||
      !allowedNodeIds ||
      !sameStringIdentitySet(allowedNodeIds, [input.targetNodeId, draftPreviewNodeId]) ||
      readNodeId(toolCall.args.result_mode) !== "full"
    ) {
      continue;
    }
    const output = readRecord(toolCall.outputJson);
    const structuredOutput = readRecord(output?.structuredOutput);
    const subAgentId = readNodeId(output?.subAgentId);
    if (
      readNodeId(output?.subagentType) !== "section_codegen" ||
      readNodeId(output?.resultMode) !== "full" ||
      !subAgentId ||
      !structuredOutput ||
      !diagnoseWebHeroSectionDraftContent(structuredOutput).ok ||
      !exactSectionDraftContentMatch(input.draft, structuredOutput)
    ) {
      continue;
    }
    const hasLaterInputMutation = input.toolCalls.slice(index + 1).some((laterCall) => {
      if (laterCall?.name !== "canvas_update_node_data" || laterCall.status !== "succeeded") return false;
      if (!Array.isArray(laterCall.args.patchNodeData)) return false;
      return laterCall.args.patchNodeData.some((rawItem) => {
        const item = readRecord(rawItem);
        const data = readRecord(item?.data);
        if (readNodeId(item?.id) !== input.targetNodeId || !data) return false;
        const workflow = readRecord(data.webPageWorkflowContract);
        return [
          "webPagePreviewVisualSpecs",
          "webPageReferencePrompt",
          "webPageImplementationBrief",
          "fontPlan",
          "previewDetailChecklist",
          "componentReferencePlan",
          "visibleSubjectInventory",
          "webPageVisibleSubjectInventory",
          "webPageAssetRequirements",
          "webPageAssetDecisions",
          "webPageResolvedAssets",
          "webHeroResetDownstreamEvidence",
          "webHeroRewindFromPhase",
        ].some((key) => Object.prototype.hasOwnProperty.call(data, key)) || Boolean(
          workflow && ["selectedStyleReference", "sharedStyleBible", "approvedPreviewNodes"]
            .some((key) => Object.prototype.hasOwnProperty.call(workflow, key)),
        );
      });
    });
    if (hasLaterInputMutation) continue;
    return { toolCallId: toolCall.toolCallId, subAgentId };
  }
  return null;
}

export function verifyWebHeroSectionDraftWritePrecondition(input: {
  toolName: string;
  args: Record<string, unknown>;
  toolCalls: ToolCallTrace[];
}): WebHeroSectionDraftWriteVerification | null {
  if (input.toolName !== "canvas_update_node_data") return null;
  if (!Array.isArray(input.args.patchNodeData)) return null;

  let writesSectionDrafts = false;
  const consumedToolCallIds = new Set<string>();
  const verifiedPatchNodeData: unknown[] = [];
  for (const rawItem of input.args.patchNodeData) {
    const item = readRecord(rawItem);
    const data = readRecord(item?.data);
    if (!item || !data || !Object.prototype.hasOwnProperty.call(data, "webPageSectionDrafts")) {
      verifiedPatchNodeData.push(rawItem);
      continue;
    }
    writesSectionDrafts = true;
    const targetNodeId = readNodeId(item.id);
    const rawDrafts = data.webPageSectionDrafts;
    if (!targetNodeId || !Array.isArray(rawDrafts)) {
      return { error: "WebHero section draft write is invalid: target nodeId and webPageSectionDrafts array are required." };
    }
    const verifiedDrafts: Record<string, unknown>[] = [];
    for (const rawDraft of rawDrafts) {
      const draft = readRecord(rawDraft);
      const contentDiagnosis = diagnoseWebHeroSectionDraftContent(draft);
      if (!draft || !contentDiagnosis.ok) {
        return {
          error: `WebHero section draft write is invalid or blocked: ${contentDiagnosis.issues.join(", ") || "draft must be an object"}.`,
        };
      }
      const match = successfulSectionCodegenMatch({
        draft,
        targetNodeId,
        toolCalls: input.toolCalls,
        consumedToolCallIds,
      });
      if (!match) {
        return {
          error: `WebHero section draft for target ${targetNodeId} must exactly match a successful section_codegen full structured output from this run; failed, timed-out, null-output, blocked, wrong-target, or parent-authored drafts cannot be persisted.`,
        };
      }
      consumedToolCallIds.add(match.toolCallId);
      const { codegenProvenance: _modelSuppliedProvenance, ...draftContent } = draft;
      verifiedDrafts.push({
        ...draftContent,
        codegenProvenance: {
          version: "v1",
          source: "section_codegen",
          agentToolCallId: match.toolCallId,
          subAgentId: match.subAgentId,
          outputDigest: computeWebHeroSectionDraftDigest(draftContent),
        },
      });
    }
    verifiedPatchNodeData.push({
      ...item,
      data: { ...data, webPageSectionDrafts: verifiedDrafts },
    });
  }
  if (!writesSectionDrafts) return null;
  return {
    verifiedArgs: {
      ...input.args,
      patchNodeData: verifiedPatchNodeData,
    },
  };
}

export type WebHeroMergeDispatchEvidence = {
  targetNodeId: string;
  readinessToolCallId: string;
  previewNodeCount: number;
  previewNodeIds: string[];
  flowUpdatedAt: string;
	codeInputDigest: string;
};

export type WebHeroPreviewDispatchEvidence = {
  targetNodeId: string;
  flowReadToolCallId: string;
  flowUpdatedAt: string;
  styleReferencePersisted: true;
};

const CANONICAL_WEBHERO_PREVIEW_CONTRACT_KIND = "webPreview_generation";

function readWebHeroPreviewDispatchKind(
  toolName: string,
  args: Record<string, unknown>,
): { canonical: boolean; looksLikeWebHeroPreview: boolean; raw: string } | null {
  if (toolName !== "Agent" || readNodeId(args.subagent_type) !== "media") return null;
  const contract = readRecord(args.task_contract);
  const raw = readNodeId(contract?.kind);
  const tokens = raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return {
    canonical: raw === CANONICAL_WEBHERO_PREVIEW_CONTRACT_KIND,
    looksLikeWebHeroPreview:
      (tokens.includes("webpreview") || (tokens.includes("web") && tokens.includes("preview")) || tokens.includes("webhero"))
      && tokens.includes("generation"),
    raw,
  };
}

function findNodeDataInStructuredOutput(
  value: unknown,
  targetNodeId: string,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 8 || !value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNodeDataInStructuredOutput(item, targetNodeId, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (readNodeId(record.id) === targetNodeId) {
    const data = readRecord(record.data);
    if (data) return data;
  }
  for (const child of Object.values(record)) {
    const found = findNodeDataInStructuredOutput(child, targetNodeId, depth + 1);
    if (found) return found;
  }
  return null;
}

function hasPersistedStyleReference(data: Record<string, unknown>): boolean {
	return readPersistedStyleReferenceUrls(data).length > 0;
}

function readPersistedStyleReferenceUrls(data: Record<string, unknown>): string[] {
  const workflow = readRecord(data.webPageWorkflowContract);
	const value = workflow?.selectedStyleReference;
	const record = readRecord(value);
	if (!record) return [];
	return [
		record.modelInputImageUrl,
		record.vendorReferenceImageUrl,
		record.originalImageUrl,
		record.sourceImageUrl,
		record.remoteImageUrl,
		record.imageUrl,
		record.thumbnailUrl,
	].flatMap((candidate) => {
		if (typeof candidate !== "string" || !candidate.trim()) return [];
		try {
			const url = new URL(candidate.trim());
			if (url.protocol !== "http:" && url.protocol !== "https:") return [];
			const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
			const isIpv6 = host.includes(":");
			const usable = !(
				host === "localhost" ||
				host.endsWith(".localhost") ||
				host.endsWith(".local") ||
				host.startsWith("127.") ||
				host === "::1" ||
				host.startsWith("10.") ||
				host.startsWith("169.254.") ||
				host.startsWith("0.") ||
				host.startsWith("192.168.") ||
				/^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
				host.startsWith("::ffff:") ||
				(isIpv6 && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")))
			);
			return usable ? [url.toString()] : [];
		} catch {
			return [];
		}
	}).filter((value): value is string => typeof value === "string");
}

function structuredOutputWroteCanvas(value: unknown, depth = 0): boolean {
  if (depth > 6 || !value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => structuredOutputWroteCanvas(item, depth + 1));
  const record = value as Record<string, unknown>;
  if (record.wroteCanvas === true) return true;
  return Object.values(record).some((item) => structuredOutputWroteCanvas(item, depth + 1));
}

function readFlowUpdatedAt(value: unknown, depth = 0): string {
  if (depth > 6 || !value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = readFlowUpdatedAt(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  const record = value as Record<string, unknown>;
  const direct = readNodeId(record.updatedAt);
  if (direct) return direct;
  for (const child of Object.values(record)) {
    const found = readFlowUpdatedAt(child, depth + 1);
    if (found) return found;
  }
  return "";
}

export function verifyWebHeroPreviewDispatchPrecondition(input: {
  toolName: string;
  args: Record<string, unknown>;
  toolCalls: ToolCallTrace[];
}): { error?: string; evidence?: WebHeroPreviewDispatchEvidence } | null {
  const dispatchKind = readWebHeroPreviewDispatchKind(input.toolName, input.args);
  if (!dispatchKind) return null;
  if (!dispatchKind.canonical) {
    if (!dispatchKind.looksLikeWebHeroPreview) return null;
    return {
      error: `WebHero preview dispatch 被阻断：task_contract.kind 必须精确为 ${CANONICAL_WEBHERO_PREVIEW_CONTRACT_KIND}，当前为 ${dispatchKind.raw || "(missing)"}。`,
    };
  }
  const contract = readRecord(input.args.task_contract);
  const targetNodeIds = readExactUniqueStringArray(contract?.targetNodeIds);
  if (!targetNodeIds || targetNodeIds.length !== 1) {
    return { error: "WebHero preview dispatch 被阻断：task_contract.targetNodeIds 必须且只能包含一个 target WebHero nodeId。" };
  }
  const targetNodeId = targetNodeIds[0]!;
  let latestFlowRead: ToolCallTrace | null = null;
  let latestFlowReadIndex = -1;
  for (let index = input.toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = input.toolCalls[index];
    if (toolCall?.name === "canvas_flow_get") {
      latestFlowRead = toolCall;
      latestFlowReadIndex = index;
      break;
    }
  }
  if (!latestFlowRead) {
    return {
      error: `WebHero preview dispatch 被阻断：持久化风格选择后，必须先调用 canvas_flow_get 并验证 target nodeId=${targetNodeId} 的 selectedStyleReference 已真实落盘。`,
    };
  }
  if (latestFlowRead.status !== "succeeded") {
    return {
      error: `WebHero preview dispatch 被阻断：最新 canvas_flow_get 状态=${latestFlowRead.status}，无法证明 selectedStyleReference 已落盘。`,
    };
  }
  const laterCanvasWrite = input.toolCalls
    .slice(latestFlowReadIndex + 1)
    .find((toolCall) => toolCall.status === "succeeded" && structuredOutputWroteCanvas(toolCall.outputJson));
  if (laterCanvasWrite) {
    return {
      error: `WebHero preview dispatch 被阻断：canvas_flow_get 之后工具 ${laterCanvasWrite.name} 又写入了画布；必须重新读取后再派发。`,
    };
  }
  const nodeData = findNodeDataInStructuredOutput(latestFlowRead.outputJson, targetNodeId);
  if (!nodeData || !hasPersistedStyleReference(nodeData)) {
    return {
      error: `WebHero preview dispatch 被阻断：最新 canvas_flow_get 未证明 target nodeId=${targetNodeId} 存在持久化 selectedStyleReference。`,
    };
  }
  const flowUpdatedAt = readFlowUpdatedAt(latestFlowRead.outputJson);
  const contractFlowUpdatedAt = readNodeId(contract?.flowUpdatedAt);
  if (!flowUpdatedAt || flowUpdatedAt !== contractFlowUpdatedAt) {
    return {
      error: "WebHero preview dispatch 被阻断：task_contract.flowUpdatedAt 必须精确复制最新 canvas_flow_get 的 updatedAt。",
    };
  }
  return {
    evidence: {
      targetNodeId,
      flowReadToolCallId: latestFlowRead.toolCallId,
      flowUpdatedAt,
      styleReferencePersisted: true,
    },
  };
}

export function verifyWebHeroMergeDispatchPrecondition(input: {
  toolName: string;
  args: Record<string, unknown>;
  toolCalls: ToolCallTrace[];
}): { error?: string; evidence?: WebHeroMergeDispatchEvidence } | null {
  if (
    input.toolName !== "Agent"
    || readNodeId(input.args.subagent_type) !== "webhero_merge_codegen"
  ) {
    return null;
  }

  const contract = readRecord(input.args.task_contract);
  const targetNodeIds = readStringArray(contract?.targetNodeIds);
  if (targetNodeIds.length !== 1) {
    return { error: "WebHero merge dispatch 被阻断：task_contract.targetNodeIds 必须且只能包含一个 target WebHero nodeId。" };
  }
  const targetNodeId = targetNodeIds[0]!;
  const readinessMatch = findLatestReadinessAttemptWithIndex(input.toolCalls, targetNodeId);
  if (!readinessMatch) {
    return {
      error: `WebHero merge dispatch 被阻断：必须先对同一 nodeId=${targetNodeId} 调用 canvas_webhero_check_readiness，并取得 ready=true。`,
    };
  }
  const readiness = readinessMatch.trace;
  if (
    input.toolCalls
      .slice(readinessMatch.index + 1)
      .some((toolCall) => isMergeAttemptForTarget(toolCall, targetNodeId))
  ) {
    return {
      error: `WebHero merge dispatch 被阻断：nodeId=${targetNodeId} 的最新 readiness 已被一次 merge dispatch 消费；请重新执行 readiness。`,
    };
  }
  if (readiness.status !== "succeeded") {
    return {
      error: `WebHero merge dispatch 被阻断：同一 nodeId=${targetNodeId} 的最新 readiness 执行状态=${readiness.status}；必须重新检查并取得 ready=true。`,
    };
  }
  const data = readRecord(readiness.outputJson?.data);
  if (data?.ready !== true) {
    const missing = readMissing(data?.missing);
    const detail = missing.length > 0 ? ` 缺失项：${missing.join(", ")}。` : "";
    return {
      error: `WebHero merge dispatch 被阻断：同一 nodeId=${targetNodeId} 的最新 readiness 不是 ready=true${data?.ready === false ? "（ready=false）" : ""}。${detail}`,
    };
  }

  const previewNodeCount = data.previewNodeCount;
  if (!Number.isInteger(previewNodeCount) || Number(previewNodeCount) <= 0) {
    return { error: "WebHero merge dispatch 被阻断：readiness 返回缺少有效 previewNodeCount。" };
  }
  const persistedDraftCount = contract?.persistedDraftCount;
  const approvedPreviewNodes = readExactUniqueStringArray(contract?.approvedPreviewNodes);
  const previewNodeIds = readExactUniqueStringArray(data.previewNodeIds);
  if (!previewNodeIds || previewNodeIds.length !== previewNodeCount) {
    return { error: "WebHero merge dispatch 被阻断：readiness 返回缺少有效且唯一的 previewNodeIds。" };
  }
  if (!approvedPreviewNodes || !sameStringIdentitySet(approvedPreviewNodes, previewNodeIds)) {
    return {
      error: "WebHero merge dispatch 被阻断：runtime readiness previewNodeIds 与 task_contract approved preview node identities 不一致。",
    };
  }
  const flowUpdatedAt = readNodeId(data.flowUpdatedAt);
  const contractFlowUpdatedAt = readNodeId(contract?.flowUpdatedAt);
  if (!flowUpdatedAt || flowUpdatedAt !== contractFlowUpdatedAt) {
    return {
      error: "WebHero merge dispatch 被阻断：runtime readiness flowUpdatedAt 与 task_contract flowUpdatedAt 不一致。",
    };
  }
	const codeInputDigest = readNodeId(data.codeInputDigest);
	const contractCodeInputDigest = readNodeId(contract?.codeInputDigest);
	if (!/^sha256:[a-f0-9]{64}$/.test(codeInputDigest) || codeInputDigest !== contractCodeInputDigest) {
		return {
			error: "WebHero merge dispatch 被阻断：runtime readiness codeInputDigest 与 task_contract 不一致。",
		};
	}
  if (
    persistedDraftCount !== previewNodeCount
    || approvedPreviewNodes.length !== previewNodeCount
  ) {
    return {
      error: `WebHero merge dispatch 被阻断：runtime readiness previewNodeCount=${previewNodeCount} 与 task_contract 的 persistedDraftCount/approvedPreviewNodes 不一致。`,
    };
  }

  return {
    evidence: {
      targetNodeId,
      readinessToolCallId: readiness.toolCallId,
      previewNodeCount: Number(previewNodeCount),
      previewNodeIds,
      flowUpdatedAt,
	  codeInputDigest,
    },
  };
}

export function evaluateWebHeroStagePrecondition(input: {
  toolName: string;
  args: Record<string, unknown>;
  toolCalls: ToolCallTrace[];
}): string | null {
  if (!WEBHERO_STAGE_TOOLS.has(input.toolName)) return null;
  const nodeId = readNodeId(input.args.nodeId);
  if (!nodeId) return null;

  const latestReadiness = findLatestReadinessAttempt(input.toolCalls, nodeId);
  if (!latestReadiness) {
    return `WebHero code stage 被阻断：必须先对同一 nodeId=${nodeId} 调用 canvas_webhero_check_readiness，并取得 ready=true。`;
  }
  if (latestReadiness.status !== "succeeded") {
    return `WebHero code stage 被阻断：同一 nodeId=${nodeId} 的最新 readiness 执行状态=${latestReadiness.status}；必须重新检查并取得 ready=true。`;
  }

  const data = readRecord(latestReadiness.outputJson?.data);
  if (data?.ready === true) {
    const readinessPreviewNodeIds = readExactUniqueStringArray(data.previewNodeIds);
    const requestedPreviewNodeIds = readExactUniqueStringArray(input.args.previewNodeIds);
    const readinessFlowUpdatedAt = readNodeId(data.flowUpdatedAt);
    const requestedFlowUpdatedAt = readNodeId(input.args.flowUpdatedAt);
	const readinessCodeInputDigest = readNodeId(data.codeInputDigest);
	const requestedCodeInputDigest = readNodeId(input.args.codeInputDigest);
	if (!readinessPreviewNodeIds || !readinessFlowUpdatedAt || !/^sha256:[a-f0-9]{64}$/.test(readinessCodeInputDigest)) {
	  return "WebHero code stage 被阻断：最新 readiness 缺少有效 flowUpdatedAt、codeInputDigest 或唯一 previewNodeIds，不能建立提交快照。";
    }
	if (!requestedPreviewNodeIds || !requestedFlowUpdatedAt || !requestedCodeInputDigest) {
	  return "WebHero code stage 被阻断：每个 stage 分片必须原样携带最新 readiness 的 flowUpdatedAt、codeInputDigest 与 previewNodeIds。";
    }
    if (
      readinessFlowUpdatedAt !== requestedFlowUpdatedAt
	  || readinessCodeInputDigest !== requestedCodeInputDigest
      || !sameStringIdentitySet(readinessPreviewNodeIds, requestedPreviewNodeIds)
    ) {
      return "WebHero code stage 被阻断：stage 参数与最新 runtime readiness snapshot 不一致。";
    }
    return null;
  }
  const missing = readMissing(data?.missing);
  const detail = missing.length > 0 ? ` 缺失项：${missing.join(", ")}。` : "";
  return `WebHero code stage 被阻断：同一 nodeId=${nodeId} 的最新 readiness 结果不是 ready=true${data?.ready === false ? "（ready=false）" : ""}。${detail}`;
}
