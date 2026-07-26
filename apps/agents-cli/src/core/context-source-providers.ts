import type { ContextSourceDiagnostic } from "../types/index.js";

import type { WorkspaceContext } from "./workspace-context/types.js";

export type ContextSourceFragment = {
  id: string;
  kind: ContextSourceDiagnostic["kind"];
  summary: string;
  content: string;
  budgetChars: number;
};

export type ContextSourceProviderInput = {
  workspaceContext: WorkspaceContext;
  memoryPromptFragment: string;
  toolContextMeta?: Record<string, unknown>;
  localResourcePaths: string[];
};

type ContextSourceProvider = {
  id: string;
  collect: (input: ContextSourceProviderInput) => ContextSourceFragment[];
};

const CONTEXT_BUDGETS: Record<ContextSourceDiagnostic["kind"], number> = {
  persona: 6_000,
  workspace_rules: 8_000,
  system_snapshot: 2_500,
  memory: 6_000,
  runtime_diagnostics: 2_000,
  generation_contract: 2_000,
  canvas_capability: 200_000,
  active_canvas_models: 600,
  request_scope: 2_500,
};

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function compactList(values: string[], max = 12): string[] {
  return values
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildMarkdownSection(title: string, body: string): string {
  const trimmed = String(body || "").trim();
  if (!trimmed) return "";
  return `## ${title}\n${trimmed}`;
}

const personaContextProvider: ContextSourceProvider = {
  id: "persona",
  collect(input) {
    const personaFiles = input.workspaceContext.evidenceBundles.filter((item) => item.kind === "persona");
    if (personaFiles.length === 0) return [];
    const lines = [
      "以下文件定义助手身份、判断方式与协作风格；它们不是项目资料，必须持续优先生效：",
    ];
    for (const file of personaFiles) {
      lines.push(`### ${file.source}`);
      lines.push(file.content);
    }
    return [{
      id: "persona",
      kind: "persona",
      summary: `${personaFiles.length} persona context file(s)`,
      content: buildMarkdownSection("Persona Context", lines.join("\n\n")),
      budgetChars: CONTEXT_BUDGETS.persona,
    }];
  },
};

const workspaceRulesContextProvider: ContextSourceProvider = {
  id: "workspace_rules",
  collect(input) {
    const workspaceFiles = input.workspaceContext.evidenceBundles.filter((item) => item.kind !== "persona");
    if (workspaceFiles.length === 0) return [];
    const lines = [
      `workspaceRoot: ${input.workspaceContext.rootDir}`,
      "以下文件为本次运行的项目/工作区上下文，优先视为项目事实与约束：",
    ];
    for (const file of workspaceFiles) {
      lines.push(`### ${file.source}`);
      lines.push(file.content);
    }
    return [{
      id: "workspace_rules",
      kind: "workspace_rules",
      summary: `${workspaceFiles.length} workspace context file(s)`,
      content: buildMarkdownSection("Workspace Context", lines.join("\n\n")),
      budgetChars: CONTEXT_BUDGETS.workspace_rules,
    }];
  },
};

const memoryContextProvider: ContextSourceProvider = {
  id: "memory",
  collect(input) {
    const content = String(input.memoryPromptFragment || "").trim();
    if (!content) return [];
    return [{
      id: "memory",
      kind: "memory",
      summary: "layered memory prompt fragment",
      content,
      budgetChars: CONTEXT_BUDGETS.memory,
    }];
  },
};

const systemSnapshotContextProvider: ContextSourceProvider = {
  id: "system_snapshot",
  collect(input) {
    const content = typeof input.toolContextMeta?.systemSnapshot === "string"
      ? input.toolContextMeta.systemSnapshot.trim()
      : "";
    if (!content) return [];
    return [{
      id: "system_snapshot",
      kind: "system_snapshot",
      summary: "current runtime system snapshot",
      content,
      budgetChars: CONTEXT_BUDGETS.system_snapshot,
    }];
  },
};

const runtimeDiagnosticsContextProvider: ContextSourceProvider = {
  id: "runtime_diagnostics",
  collect(input) {
    const meta = input.toolContextMeta ?? {};
    const diagnostics: Record<string, unknown> = {};
    if (typeof meta.diagnosticContext !== "undefined") {
      diagnostics.diagnosticContext = meta.diagnosticContext;
    }
    if (typeof meta.sessionAssetInputs !== "undefined") {
      diagnostics.sessionAssetInputs = meta.sessionAssetInputs;
    }
    if (typeof meta.policySummary !== "undefined") {
      diagnostics.policySummary = meta.policySummary;
    }
    if (Object.keys(diagnostics).length === 0) return [];
    return [{
      id: "runtime_diagnostics",
      kind: "runtime_diagnostics",
      summary: "runtime diagnostic metadata",
      content: buildMarkdownSection("Runtime Diagnostics", stringifyJson(diagnostics)),
      budgetChars: CONTEXT_BUDGETS.runtime_diagnostics,
    }];
  },
};

const generationContractContextProvider: ContextSourceProvider = {
  id: "generation_contract",
  collect(input) {
    if (typeof input.toolContextMeta?.generationContract === "undefined") return [];
    return [{
      id: "generation_contract",
      kind: "generation_contract",
      summary: "requested generation contract",
      content: buildMarkdownSection("Generation Contract", stringifyJson(input.toolContextMeta.generationContract)),
      budgetChars: CONTEXT_BUDGETS.generation_contract,
    }];
  },
};

const canvasCapabilityContextProvider: ContextSourceProvider = {
  id: "canvas_capability",
  collect(input) {
    if (typeof input.toolContextMeta?.canvasCapabilityManifest === "undefined") return [];
    return [{
      id: "canvas_capability",
      kind: "canvas_capability",
      summary: "canvas capability manifest",
      content: buildMarkdownSection("Canvas Capability Context", stringifyJson(input.toolContextMeta.canvasCapabilityManifest)),
      budgetChars: CONTEXT_BUDGETS.canvas_capability,
    }];
  },
};

const activeCanvasModelsContextProvider: ContextSourceProvider = {
  id: "active_canvas_models",
  collect(input) {
    if (typeof input.toolContextMeta?.activeCanvasModels === "undefined") return [];
    return [{
      id: "active_canvas_models",
      kind: "active_canvas_models",
      summary: "active canvas model selection",
      content: buildMarkdownSection("Active Canvas Models", stringifyJson(input.toolContextMeta.activeCanvasModels)),
      budgetChars: CONTEXT_BUDGETS.active_canvas_models,
    }];
  },
};

const requestScopeContextProvider: ContextSourceProvider = {
  id: "request_scope",
  collect(input) {
    const localResourcePaths = compactList(input.localResourcePaths, 24);
    const sessionAssetInputs = Array.isArray(input.toolContextMeta?.sessionAssetInputs)
      ? input.toolContextMeta.sessionAssetInputs
      : [];
    const requestScope: Record<string, unknown> = {};
    if (localResourcePaths.length > 0) requestScope.localResourcePaths = localResourcePaths;
    if (sessionAssetInputs.length > 0) requestScope.sessionAssetInputs = sessionAssetInputs;
    if (isRecord(input.toolContextMeta?.chatContext)) requestScope.chatContext = input.toolContextMeta.chatContext;
    if (Object.keys(requestScope).length === 0) return [];
    return [{
      id: "request_scope",
      kind: "request_scope",
      summary: "request-scoped resources and assets",
      content: buildMarkdownSection("Request Scope", stringifyJson(requestScope)),
      budgetChars: CONTEXT_BUDGETS.request_scope,
    }];
  },
};

const DEFAULT_CONTEXT_SOURCE_PROVIDERS: ContextSourceProvider[] = [
  personaContextProvider,
  workspaceRulesContextProvider,
  systemSnapshotContextProvider,
  memoryContextProvider,
  runtimeDiagnosticsContextProvider,
  generationContractContextProvider,
  canvasCapabilityContextProvider,
  activeCanvasModelsContextProvider,
  requestScopeContextProvider,
];

export function resolveContextSourceFragments(input: ContextSourceProviderInput): ContextSourceFragment[] {
  return DEFAULT_CONTEXT_SOURCE_PROVIDERS.flatMap((provider) => provider.collect(input));
}
