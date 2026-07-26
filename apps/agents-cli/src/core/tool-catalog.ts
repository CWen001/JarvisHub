import type {
  CapabilityProviderKind,
  ToolDefinition,
  ToolResult,
} from "../types/index.js";
import type { ToolContext, ToolRegistry } from "./tools/registry.js";
import { executeRemoteTool } from "./tools/remote.js";
import {
  acknowledgeCanonicalTextWrite,
  prepareCanonicalTextWrite,
} from "./canonical-text-artifacts.js";

export type RuntimeToolProvider = {
  id: string;
  kind: CapabilityProviderKind;
};

export type RuntimeTool = {
  definition: ToolDefinition;
  provider: RuntimeToolProvider;
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
    toolCallId: string,
  ) => Promise<ToolResult>;
};

export type ToolExecutionInput = {
  name: string;
  args: Record<string, unknown>;
  ctx: ToolContext;
  toolCallId: string;
};

export class ToolCatalog {
  private readonly toolsByName = new Map<string, RuntimeTool>();

  constructor(tools: RuntimeTool[]) {
    for (const tool of tools) {
      const existing = this.toolsByName.get(tool.definition.name);
      if (existing) {
        throw new Error(
          `重复工具定义: ${tool.definition.name} (${existing.provider.kind}:${existing.provider.id} / ${tool.provider.kind}:${tool.provider.id})`,
        );
      }
      this.toolsByName.set(tool.definition.name, tool);
    }
  }

  list(): ToolDefinition[] {
    return Array.from(this.toolsByName.values()).map((tool) => tool.definition);
  }

  get(name: string): RuntimeTool | null {
    return this.toolsByName.get(name) ?? null;
  }

  getDefinition(name: string): ToolDefinition | null {
    return this.get(name)?.definition ?? null;
  }
}

export class ToolExecutor {
  constructor(private readonly catalog: ToolCatalog) {}

  async execute(input: ToolExecutionInput): Promise<ToolResult> {
    const tool = this.catalog.get(input.name);
    if (!tool) {
      throw new Error(`未知工具: ${input.name}`);
    }
    const prepared = prepareCanonicalTextWrite({
      toolName: input.name,
      args: input.args,
      state: input.ctx.state,
      toolCallId: input.toolCallId,
    });
    if (prepared.error) return prepared.error;
    const result = await tool.execute(prepared.args, input.ctx, input.toolCallId);
    if (prepared.outputKey && result.isError !== true) {
      acknowledgeCanonicalTextWrite(input.ctx.state, prepared.outputKey);
    }
    return result;
  }
}

export function createLocalRuntimeTools(
  registry: ToolRegistry,
  definitions: ToolDefinition[],
): RuntimeTool[] {
  const localProvider: RuntimeToolProvider = { id: "local", kind: "local" };
  return definitions.map((definition) => ({
    definition: {
      ...definition,
      provider: definition.provider ?? localProvider,
    },
    provider: localProvider,
    execute: (args, ctx, toolCallId) => registry.execute(definition.name, args, ctx, toolCallId),
  }));
}

export function createRemoteRuntimeTools(input: {
  definitions: ToolDefinition[];
  providerKind: "remote" | "mcp";
  providerId: string;
  meta?: Record<string, unknown>;
}): RuntimeTool[] {
  const provider: RuntimeToolProvider = {
    id: input.providerId,
    kind: input.providerKind,
  };
  return input.definitions.map((definition) => ({
    definition: {
      ...definition,
      provider: definition.provider ?? provider,
    },
    provider,
    execute: async (args, ctx, toolCallId) => {
      const result = await executeRemoteTool({
        name: definition.name,
        args,
        toolCallId,
        providerKind: input.providerKind,
        meta: ctx.meta ?? input.meta,
      });
      if (!result) {
        throw new Error(`${input.providerKind} 工具 ${definition.name} 未返回执行结果。`);
      }
      return result;
    },
  }));
}
