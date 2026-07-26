import type {
  CapabilityGrant,
  CapabilityProviderKind,
  CapabilityProviderSnapshot,
  CapabilitySnapshot,
  ToolDefinition,
} from "../types/index.js";
import type { ToolRegistry } from "./tools/registry.js";
import { normalizeRemoteToolDefinitions } from "./tools/remote.js";
import {
  createLocalRuntimeTools,
  createRemoteRuntimeTools,
  ToolCatalog,
  type RuntimeTool,
} from "./tool-catalog.js";

export type CapabilityProviderContext = {
  registry: ToolRegistry;
  capabilityGrant: CapabilityGrant;
  allowedTools: Set<string> | null;
  disallowedTools?: Set<string> | null;
  meta?: Record<string, unknown>;
};

export type CapabilityProvider = {
  kind: CapabilityProviderKind;
  name: string;
  listTools: () => ToolDefinition[];
  listRuntimeTools?: () => RuntimeTool[];
};

export type CapabilityProviderFactory = {
  kind: CapabilityProviderKind;
  name: string;
  create: (context: CapabilityProviderContext) => CapabilityProvider;
};

function normalizeCapabilityProviderKinds(value: Iterable<string> | undefined): CapabilityProviderKind[] {
  if (!value) return [];
  const out: CapabilityProviderKind[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = String(item || "").trim();
    if (
      (normalized !== "local" &&
        normalized !== "remote" &&
        normalized !== "mcp" &&
        normalized !== "skill") ||
      seen.has(normalized)
    ) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function filterDefinitions(
  tools: ToolDefinition[],
  grant: CapabilityGrant,
  allowedTools: Set<string> | null,
  disallowedTools?: Set<string> | null,
): ToolDefinition[] {
  const grantTools = new Set(grant.tools);
  return tools.filter((tool) => {
    if (!grantTools.has(tool.name)) return false;
    if (allowedTools && !allowedTools.has(tool.name)) return false;
    if (disallowedTools?.has(tool.name)) return false;
    return true;
  });
}

function createLocalCapabilityProvider(context: CapabilityProviderContext): CapabilityProvider {
  return {
    kind: "local",
    name: "local_registry",
    listTools: () =>
      filterDefinitions(context.registry.list(), context.capabilityGrant, context.allowedTools, context.disallowedTools),
    listRuntimeTools: () =>
      createLocalRuntimeTools(
        context.registry,
        filterDefinitions(context.registry.list(), context.capabilityGrant, context.allowedTools, context.disallowedTools),
      ),
  };
}

function createRemoteCapabilityProvider(context: CapabilityProviderContext): CapabilityProvider {
  return {
    kind: "remote",
    name: "remote_tools",
    listTools: () =>
      filterDefinitions(
        normalizeRemoteToolDefinitions(context.meta?.remoteTools),
        context.capabilityGrant,
        context.allowedTools,
        context.disallowedTools,
      ),
    listRuntimeTools: () =>
      createRemoteRuntimeTools({
        definitions: filterDefinitions(
          normalizeRemoteToolDefinitions(context.meta?.remoteTools),
          context.capabilityGrant,
          context.allowedTools,
          context.disallowedTools,
        ),
        providerKind: "remote",
        providerId: "canvas",
        ...(context.meta ? { meta: context.meta } : {}),
      }),
  };
}

function createMcpCapabilityProvider(context: CapabilityProviderContext): CapabilityProvider {
  return {
    kind: "mcp",
    name: "mcp_tools",
    listTools: () =>
      filterDefinitions(
        normalizeRemoteToolDefinitions(context.meta?.mcpTools),
        context.capabilityGrant,
        context.allowedTools,
        context.disallowedTools,
      ),
    listRuntimeTools: () =>
      createRemoteRuntimeTools({
        definitions: filterDefinitions(
          normalizeRemoteToolDefinitions(context.meta?.mcpTools),
          context.capabilityGrant,
          context.allowedTools,
          context.disallowedTools,
        ),
        providerKind: "mcp",
        providerId: "mcp",
        ...(context.meta ? { meta: context.meta } : {}),
      }),
  };
}

const DEFAULT_CAPABILITY_PROVIDER_FACTORIES: CapabilityProviderFactory[] = [
  {
    kind: "local",
    name: "local_registry",
    create: createLocalCapabilityProvider,
  },
  {
    kind: "remote",
    name: "remote_tools",
    create: createRemoteCapabilityProvider,
  },
  {
    kind: "mcp",
    name: "mcp_tools",
    create: createMcpCapabilityProvider,
  },
];

export function resolveCapabilityProviders(
  context: CapabilityProviderContext,
  factories: CapabilityProviderFactory[] = DEFAULT_CAPABILITY_PROVIDER_FACTORIES,
  allowedProviderKinds?: Iterable<CapabilityProviderKind>,
): CapabilityProvider[] {
  const providerKinds = normalizeCapabilityProviderKinds(allowedProviderKinds);
  const allowedKindSet = providerKinds.length > 0 ? new Set(providerKinds) : null;
  return factories
    .filter((factory) => !allowedKindSet || allowedKindSet.has(factory.kind))
    .map((factory) => factory.create(context));
}

export function resolveCapabilityPlane(input: {
  registry: ToolRegistry;
  capabilityGrant: CapabilityGrant;
  allowedTools: Set<string> | null;
  disallowedTools?: Set<string> | null;
  meta?: Record<string, unknown>;
  providerFactories?: CapabilityProviderFactory[];
  providerKinds?: Iterable<CapabilityProviderKind>;
}): {
  tools: ToolDefinition[];
  catalog: ToolCatalog;
  snapshot: CapabilitySnapshot;
} {
  const providers = resolveCapabilityProviders(
    {
      registry: input.registry,
      capabilityGrant: input.capabilityGrant,
      allowedTools: input.allowedTools,
      disallowedTools: input.disallowedTools ?? null,
      ...(input.meta ? { meta: input.meta } : {}),
    },
    input.providerFactories,
    input.providerKinds,
  );
  const snapshotProviders: CapabilityProviderSnapshot[] = [];
  const mergedRuntimeTools: RuntimeTool[] = [];
  const merged: ToolDefinition[] = [];
  const seenProviderByToolName = new Map<string, string>();
  for (const provider of providers) {
    const providerRuntimeTools = provider.listRuntimeTools
      ? provider.listRuntimeTools()
      : provider.listTools().map((definition) => ({
          definition,
          provider: { id: provider.name, kind: provider.kind },
          async execute() {
            throw new Error(`provider ${provider.name} did not supply executor for ${definition.name}`);
          },
        }));
    const providerTools = providerRuntimeTools.map((tool) => tool.definition);
    const uniqueProviderToolNames = providerTools.map((tool) => tool.name);
    snapshotProviders.push({
      kind: provider.kind,
      name: provider.name,
      toolNames: uniqueProviderToolNames,
      toolCount: providerTools.length,
    });
    for (const runtimeTool of providerRuntimeTools) {
      const previousProviderName = seenProviderByToolName.get(runtimeTool.definition.name);
      if (previousProviderName) {
        throw new Error(
          `重复工具定义: ${runtimeTool.definition.name} (${previousProviderName} / ${provider.name})`,
        );
      }
      seenProviderByToolName.set(runtimeTool.definition.name, provider.name);
      mergedRuntimeTools.push(runtimeTool);
      merged.push(runtimeTool.definition);
    }
  }
  return {
    tools: merged,
    catalog: new ToolCatalog(mergedRuntimeTools),
    snapshot: {
      providers: snapshotProviders,
      exposedToolNames: merged.map((tool) => tool.name),
    },
  };
}

export function getDefaultCapabilityProviderFactories(): CapabilityProviderFactory[] {
  return DEFAULT_CAPABILITY_PROVIDER_FACTORIES.slice();
}
