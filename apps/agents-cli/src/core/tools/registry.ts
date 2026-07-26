import { CapabilityGrant, ToolDefinition, ToolResult } from "../../types/index.js";
import type { IterationBudget } from "../budget.js";

export type ToolContext = {
  cwd: string;
  depth: number;
  meta?: Record<string, unknown>;
  // Mutable per-run state shared across tool calls.
  state: ToolRuntimeState;
};

export type ToolRuntimeState = {
  cache: {
    readFile: Map<string, ToolCacheEntry>;
    bash: Map<string, ToolCacheEntry>;
  };
  guard: {
    duplicateToolCallLimit: number;
    duplicateToolCallCount: Map<string, number>;
    readFileBudgetPerPath?: number;
    readFileUsageByPath?: Map<string, FileReadUsage>;
  };
  checkpoint: CheckpointRuntimeState;
  budget: BudgetRuntimeState;
  visionQueue: VisionQueueEntry[];
  attempts: GenerationAttemptRecord[];
  canonicalTextArtifacts?: Map<string, CanonicalTextArtifact>;
};

export type CanonicalTextArtifact = {
  kind: "storyboard_script";
  outputKey: string;
  text: string;
  sourceToolCallId: string;
};

export type VisionQueueEntry =
  | { kind: "image"; url: string; label?: string; nodeId?: string }
  | { kind: "video"; url: string; label?: string; nodeId?: string }
  | { kind: "text"; text: string; label?: string };

export type GenerationAttemptKind = "image" | "video";

export type GenerationAttemptStatus = "submitted" | "completed" | "failed" | "timed_out";

export type GenerationAttemptRecord = {
  nodeId: string;
  attempt: number;
  kind: GenerationAttemptKind;
  model: string;
  prompt: string;
  taskId?: string;
  url: string | null;
  status: GenerationAttemptStatus;
  error?: string;
  ts: string;
};

export type BudgetRuntimeState = {
  parent: IterationBudget;
  subagents: Map<string, IterationBudget>;
};

export type CheckpointRuntimeEntry = {
  versionId: string;
  label: string;
  turn: number;
  createdAt: string;
  trigger: "auto" | "manual" | "pre_restore";
};

export type CheckpointRuntimeState = {
  autoSnapshotEnabled: boolean;
  versions: CheckpointRuntimeEntry[];
};

export type FileReadWindow = {
  startLine: number;
  endLine: number | null;
};

export type FileReadUsage = {
  reads: number;
  windows: FileReadWindow[];
};

export type ToolCacheEntry = {
  content: string;
  expiresAt: number;
};

export type ToolHandler = {
  definition: ToolDefinition;
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
    toolCallId: string
  ) => Promise<ToolResult>;
  // 是否可与同批其他 isConcurrencySafe 工具并发执行。返回 false 触发批次切分、串行执行。
  // 不写默认 false，保守。bash 这类参数相关的（read-only vs mutating）按 args 判断。
  isConcurrencySafe?: (args: Record<string, unknown>) => boolean;
  // 只读标记。给 explore-style sub-agent 筛工具用。
  isReadOnly?: boolean;
};

export class ToolRegistry {
  private handlers = new Map<string, ToolHandler>();

  register(handler: ToolHandler) {
    const toolName = handler.definition.name;
    if (this.handlers.has(toolName)) {
      throw new Error(`重复工具定义: ${toolName}`);
    }
    this.handlers.set(toolName, handler);
  }

  list(): ToolDefinition[] {
    return Array.from(this.handlers.values()).map((h) => h.definition);
  }

  listForGrant(grant?: CapabilityGrant | null): ToolDefinition[] {
    if (!grant) return this.list();
    const allowed = new Set(grant.tools);
    return Array.from(this.handlers.values())
      .filter((handler) => allowed.has(handler.definition.name))
      .map((handler) => handler.definition);
  }

  getHandler(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  listAllToolNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
    toolCallId: string
  ) {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new Error(`未知工具: ${name}`);
    }
    return handler.execute(args, ctx, toolCallId);
  }
}
