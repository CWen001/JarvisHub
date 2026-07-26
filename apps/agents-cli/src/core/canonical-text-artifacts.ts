import type { ToolResult } from "../types/index.js";
import type { ToolRuntimeState } from "./tools/registry.js";

export const AGENT_OUTPUT_REFERENCE_PREFIX = "@agent-output:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function validateStoryboardScriptContract(taskContract: unknown): string | null {
  if (!isRecord(taskContract) || taskContract.kind !== "storyboard_script") return null;
  const outputKeys = readStringArray(taskContract.outputKeys);
  if (outputKeys.length === 1) return null;
  return "Error: task_contract.kind=storyboard_script 时必须且只能提供一个 outputKey，作为权威剧本 text 节点的 node.id。";
}

export function isStoryboardScriptTaskContract(taskContract: unknown): boolean {
  return isRecord(taskContract) && taskContract.kind === "storyboard_script";
}

export function listPendingCanonicalTextArtifactKeys(state: ToolRuntimeState): string[] {
  return state.canonicalTextArtifacts ? Array.from(state.canonicalTextArtifacts.keys()) : [];
}

export function registerCanonicalStoryboardScript(input: {
  state: ToolRuntimeState;
  taskContract: unknown;
  text: string;
  sourceToolCallId: string;
}): void {
  if (!isRecord(input.taskContract) || input.taskContract.kind !== "storyboard_script") return;
  const outputKeys = readStringArray(input.taskContract.outputKeys);
  if (outputKeys.length !== 1) return;
  const outputKey = outputKeys[0]!;
  const artifacts = input.state.canonicalTextArtifacts ?? new Map();
  artifacts.set(outputKey, {
    kind: "storyboard_script",
    outputKey,
    text: input.text,
    sourceToolCallId: input.sourceToolCallId,
  });
  input.state.canonicalTextArtifacts = artifacts;
}

type PreparedCanonicalTextWrite = {
  args: Record<string, unknown>;
  outputKey?: string;
  error?: ToolResult;
};

function integrityError(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    content: `Error: ${message}`,
    isError: true,
    errorMessage: message,
  };
}

export function prepareCanonicalTextWrite(input: {
  toolName: string;
  args: Record<string, unknown>;
  state: ToolRuntimeState;
  toolCallId: string;
}): PreparedCanonicalTextWrite {
  if (input.toolName !== "canvas_create_text_node") {
    return { args: input.args };
  }
  const artifacts = input.state.canonicalTextArtifacts;
  const candidateNode = isRecord(input.args.node) ? input.args.node : null;
  const candidateData = candidateNode && isRecord(candidateNode.data) ? candidateNode.data : null;
  const candidateContent = typeof candidateData?.content === "string" ? candidateData.content : "";
  const referencesAgentOutput = candidateContent.startsWith(AGENT_OUTPUT_REFERENCE_PREFIX);
  if ((!artifacts || artifacts.size === 0) && referencesAgentOutput) {
    return {
      args: input.args,
      error: integrityError(
        input.toolCallId,
        `引用 ${candidateContent} 对应的权威 Agent 产物不可用，禁止把引用字面量写入画布。请在当前同步 run 中重新生成 storyboard_script，或直接提供已确认的完整正文。`,
      ),
    };
  }
  if (!artifacts || artifacts.size === 0) {
    return { args: input.args };
  }

  const pendingKeys = Array.from(artifacts.keys());
  if (!isRecord(input.args.node)) {
    return {
      args: input.args,
      error: integrityError(
        input.toolCallId,
        `权威剧本仍待持久化（${pendingKeys.join(", ")}）。canvas_create_text_node.node 必须是对象，不能是字符串；原文已保留，请修正参数后重试。`,
      ),
    };
  }

  const node = input.args.node;
  const nodeId = typeof node.id === "string" ? node.id.trim() : "";
  const artifact = artifacts.get(nodeId);
  if (!artifact) {
    return {
      args: input.args,
      error: integrityError(
        input.toolCallId,
        `必须先持久化待处理的权威剧本；node.id 必须使用 task_contract.outputKey（${pendingKeys.join(", ")}），不能写入其它 text 节点。`,
      ),
    };
  }

  if (!isRecord(node.data) || typeof node.data.content !== "string") {
    return {
      args: input.args,
      error: integrityError(
        input.toolCallId,
        `权威剧本 ${nodeId} 的 node.data.content 必须是完整正文，或精确引用 ${AGENT_OUTPUT_REFERENCE_PREFIX}${nodeId}；原文已保留。`,
      ),
    };
  }

  const content = node.data.content;
  const reference = `${AGENT_OUTPUT_REFERENCE_PREFIX}${nodeId}`;
  if (content !== reference && content !== artifact.text) {
    return {
      args: input.args,
      error: integrityError(
        input.toolCallId,
        `权威剧本 ${nodeId} 必须原样持久化，不得摘要或改写。期望 ${artifact.text.length} 字符，实际 ${content.length} 字符；请用 ${reference} 或复用 Agent 返回原文重试。`,
      ),
    };
  }

  if (content === artifact.text) {
    return { args: input.args, outputKey: nodeId };
  }

  return {
    args: {
      ...input.args,
      node: {
        ...node,
        data: {
          ...node.data,
          content: artifact.text,
        },
      },
    },
    outputKey: nodeId,
  };
}

export function acknowledgeCanonicalTextWrite(state: ToolRuntimeState, outputKey: string): void {
  state.canonicalTextArtifacts?.delete(outputKey);
}
