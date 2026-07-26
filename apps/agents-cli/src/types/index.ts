export type Role = "user" | "assistant" | "tool";

export type MessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: string }
  | { type: "media_url"; mediaUrl: string };

export type Message = {
  role: Role;
  content: string;
  contentParts?: MessageContentPart[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
  ephemeral?: boolean;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  provider?: {
    id: string;
    kind: CapabilityProviderKind;
  };
  scope?: "workspace" | "project" | "flow" | "node";
  effects?: {
    readOnly: boolean;
    mutatesCanvas?: boolean;
    generatesMedia?: boolean;
    mediaKind?: "image" | "video";
    destructive?: boolean;
    longRunning?: boolean;
    costBearing?: boolean;
  };
  permission?: {
    defaultMode: "allow" | "ask" | "deny";
    requiresUserIntent?: boolean;
  };
};

export type RemoteToolDefinition = ToolDefinition;

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ArtifactRef = {
  id: string;
  kind: string;
  path?: string;
  summary?: string;
};

export type CapabilityBudget = {
  maxToolCalls: number;
  maxTokens: number;
  maxWallTimeMs: number;
};

export type CapabilityGrant = {
  tools: string[];
  readableRoots: string[];
  writableRoots: string[];
  network: "none" | "approved";
  budgets: CapabilityBudget;
};

export type ContextSourceKind =
  | "persona"
  | "workspace_rules"
  | "system_snapshot"
  | "memory"
  | "runtime_diagnostics"
  | "generation_contract"
  | "canvas_capability"
  | "active_canvas_models"
  | "request_scope";

export type ContextSourceDiagnostic = {
  id: string;
  kind: ContextSourceKind;
  summary: string;
  chars: number;
  budgetChars: number;
  truncated: boolean;
};

export type ContextDiagnostics = {
  totalChars: number;
  totalBudgetChars: number;
  sources: ContextSourceDiagnostic[];
};

export type CapabilityProviderKind = "local" | "remote" | "mcp" | "skill";

export type CapabilityProviderSnapshot = {
  kind: CapabilityProviderKind;
  name: string;
  toolNames: string[];
  toolCount: number;
};

export type CapabilitySnapshot = {
  providers: CapabilityProviderSnapshot[];
  exposedToolNames: string[];
};

export type ToolPolicyVerdict = "allow" | "deny" | "requires_approval";

export type ToolPolicyScope = "tool" | "path" | "command";

export type ToolPolicySource = "system" | "project" | "user" | "request" | "runtime_grant";

export type ToolPolicyDecision = {
  verdict: ToolPolicyVerdict;
  reason: string;
  source: ToolPolicySource;
  scope: ToolPolicyScope;
};

export type ToolPolicySummary = {
  totalDecisions: number;
  allowCount: number;
  denyCount: number;
  requiresApprovalCount: number;
  uniqueDeniedSignatures: string[];
};

export type AgentDefinitionModelPolicy = {
  inheritFromParent?: boolean;
  defaultModel?: string;
};

export type AgentDefinitionModelProvider =
  | "openai-chat"
  | "openai-responses"
  | "google-v1beta"
  | "anthropic-messages";

export type AgentDefinition = {
  name: string;
  description: string;
  tools: string[];
  disallowedTools?: string[];
  prompt: string;
  isReadOnly?: boolean;
  background?: boolean;
  maxTurns?: number;
  timeoutMs?: number;
  modelPolicy?: AgentDefinitionModelPolicy;
  model?: string;
  modelProvider?: AgentDefinitionModelProvider;
  useMultimodalSlot?: boolean;
  requiresNativeVideoInput?: boolean;
  minimalSystemPrompt?: boolean;
};

export type EvidenceBundle = {
  id: string;
  kind:
    | "persona"
    | "workspace_rule"
    | "skill"
    | "file_excerpt"
    | "task_state";
  source: string;
  summary: string;
  content: string;
  visibility: "all";
};

export type RunEnvelope = {
  runId: string;
  entrypoint: "run" | "repl" | "serve";
  userPrompt: string;
  sessionId?: string;
  workspaceRoot: string;
  modelPolicy: {
    defaultModel: string;
    maxTurns: number;
    maxAgentDepth: number;
  };
  capabilityGrant: CapabilityGrant;
  contextRequest: {
    localResourcePaths: string[];
    requiredSkills: string[];
  };
};

export type ToolResultPayload = {
  text: string;
  artifacts?: ArtifactRef[];
  structuredOutput?: unknown;
};

export type ToolResult = {
  toolCallId: string;
  content: string;
  payload?: ToolResultPayload;
  // 结构化失败信号。未设（undefined）= 成功。工具失败时设 true，agent loop 据此判定，
  // 不再嗅探 content 的 "Error:" 前缀或工具名白名单。
  isError?: boolean;
  // 可选：供 trace/UI 展示的简洁失败原因（不含展示噪声）。
  errorMessage?: string;
};

export type AgentConfig = {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  apiStyle: "responses" | "chat";
  stream: boolean;
  memoryDir: string;
  skillsDir: string;
  workspaceRoot: string;
  worldApiUrl: string;
  maxTurns: number;
  maxAllowedTools?: number;
  maxSubagentDepth: number;
  agentIntro: string;
};

export type LLMResponse = {
  text: string;
  toolCalls: ToolCall[];
};

export type LLMRequest = {
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
  model?: string;
  onTextDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
  onPartialFlush?: (partial: { text: string; toolCalls: ToolCall[] }) => void;
};
