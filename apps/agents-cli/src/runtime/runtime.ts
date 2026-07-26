import path from "node:path";

import { AgentRunner } from "../core/agent-loop.js";
import type { Message, AgentConfig, CapabilityGrant } from "../types/index.js";
import type { LlmTurnTrace, ToolCallTrace } from "../core/hooks/types.js";
import { ToolRegistry } from "../core/tools/registry.js";
import { HookRegistry } from "../core/hooks/registry.js";
import { createFileTraceHook } from "../core/hooks/builtins/file-trace.js";
import { createWireTraceHook } from "../core/hooks/builtins/wire-trace.js";
import { listAttemptsTool } from "../core/tools/canvas-list-attempts.js";
import { askUserTool } from "../core/tools/ask-user.js";
import { TodoManager } from "../core/planner/todo.js";
import { createTodoTool } from "../core/tools/todo.js";
import { TaskStore } from "../core/tasks/store.js";
import {
  createTaskClaimTool,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskListTool,
  createTaskUpdateTool,
} from "../core/tools/tasks.js";
import { BackgroundTaskManager } from "../core/background/manager.js";
import { TerminalSessionManager } from "../core/terminal/session-manager.js";
import { SkillLoader } from "../core/skills/loader.js";
import { createSkillTool } from "../core/tools/skill.js";
import { createAgentTool } from "../core/tools/agent-tool.js";
import { LLMClient } from "../llm/client.js";
import { HookRunner } from "../core/hooks/runner.js";
import { WorldLogger } from "../core/logs/world-logger.js";
import {
  loadAgentDefinitions,
  resolveAgentDefinitionFiles,
  setActiveAgentDefinitions,
} from "../core/subagent/definitions.js";
import { listSessionSummaries, loadSessionMessages, saveSessionMessages, type SessionSummary } from "../core/memory/session.js";
import type { AgentHarnessName } from "../core/root-persona.js";

import { readNodeMediaForContextTool } from "../core/tools/canvas-media-context.js";
import { taskBoardReadTool } from "../core/tools/task-board-read.js";
import { createComponentReferenceSearchTool } from "../core/tools/component-reference.js";
import { createFontRecommendationSearchTool } from "../core/tools/font-recommendation-search.js";
import { createIconSearchTool } from "../core/tools/icon-search.js";
import { createRetrievalRecordGetTool, createRetrievalRecordListTool } from "../core/tools/retrieval-store.js";
import { createWebAssetPublicSearchTool, createWebAssetSearchTool } from "../core/tools/web-asset-search.js";
import { createWebGenerationCodegenPrepareTool } from "../core/tools/web-generation-codegen.js";
import { createWebGenerationRetrievalPrepareTool } from "../core/tools/web-generation-retrieval.js";
import { createWebHeroDebugResumePlanTool } from "../core/tools/webhero-debug-resume.js";

import { buildRuntimeSystemOverride } from "./profile.js";
import { createRuntimeChannelMeta, type RuntimeChannelDescriptor } from "./channel.js";
import { resolveSkillsDirs } from "./skills.js";
import { resolveRuntimeSessionStoreDir } from "./session.js";
import type { RuntimeRunEventSink } from "./events.js";
import { parseRuntimeTodoUpdate } from "./todo-events.js";

export type RuntimeSessionStore = {
  dir: string;
  key: string;
};

export type AssistantRuntime = {
  cwd: string;
  config: AgentConfig;
  harness: AgentHarnessName;
  skills: SkillLoader;
  runner: AgentRunner;
  memoryRoot: string;
  logger?: WorldLogger;
  systemOverride: string;
  backgroundTaskManager: BackgroundTaskManager;
  terminalSessionManager: TerminalSessionManager;
  baseCapabilityGrant: CapabilityGrant;
  registeredToolNames: string[];
  createToolContextMeta: (capabilityGrant?: CapabilityGrant) => Record<string, unknown>;
  resolveSessionStoreDir: () => string;
  createSessionStore: (sessionKey: string) => RuntimeSessionStore;
  loadSessionHistory: (sessionKey: string) => Message[];
  saveSessionHistory: (sessionKey: string, history: Message[]) => void;
  listSessions: (limit?: number) => SessionSummary[];
  run: (prompt: string, options?: AssistantRuntimeRunOptions) => Promise<string>;
  shutdown: (status: "ok" | "stopped" | "error") => Promise<void>;
};

export type AssistantRuntimeRunOptions = {
  sessionId?: string;
  history?: Message[];
  channel?: RuntimeChannelDescriptor;
  eventSink?: RuntimeRunEventSink;
  onToolStart?: (payload: {
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
    startedAt: string;
  }) => void;
  onTextDelta?: (delta: string) => void;
  onTurn?: (turn: LlmTurnTrace) => void;
  onToolCall?: (toolCall: ToolCallTrace) => void;
};

export type CreateAssistantRuntimeBaseInput = {
  cwd: string;
  config: AgentConfig;
  harness: AgentHarnessName;
  registerHarnessSpecificTools?: (input: {
    registry: ToolRegistry;
    cwd: string;
    config: AgentConfig;
    memoryRoot: string;
  }) => void;
};

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function createCapabilityGrant(input: {
  tools: string[];
  workspaceRoot: string;
  readableRoots?: string[];
  writableRoots?: string[];
}): CapabilityGrant {
  return {
    tools: uniqueStrings(input.tools),
    readableRoots: uniqueStrings([input.workspaceRoot, ...(input.readableRoots ?? [])]),
    writableRoots: uniqueStrings(input.writableRoots ?? [input.workspaceRoot]),
    network: "approved",
    budgets: {
      maxToolCalls: 64,
      maxTokens: 120000,
      maxWallTimeMs: 300000,
    },
  };
}

function logRuntimeMeta(harness: AgentHarnessName, logger?: WorldLogger): void {
  if (!logger) return;
  const entries: [string, string | undefined][] = [
    ["task", process.env.AGENTS_TASK_ID],
    ["task_title", process.env.AGENTS_TASK_TITLE],
    ["worktree", process.env.AGENTS_WORKTREE_PATH],
    ["repo", process.env.AGENTS_REPO_PATH],
    ["branch", process.env.AGENTS_TASK_BRANCH],
    ["harness", harness],
  ];
  for (const [key, value] of entries) {
    if (!value) continue;
    void logger.log("event", `${key}: ${value}`);
  }
}

export function createAssistantRuntimeBase(input: CreateAssistantRuntimeBaseInput): AssistantRuntime {
  const { cwd, config, harness, registerHarnessSpecificTools } = input;
  const systemOverride = buildRuntimeSystemOverride(harness);
  setActiveAgentDefinitions(loadAgentDefinitions(resolveAgentDefinitionFiles(harness, config.workspaceRoot)));

  const registry = new ToolRegistry();
  const hookRegistry = new HookRegistry();
  hookRegistry.register(createFileTraceHook(cwd));
  if (process.env.TRACE_CAPTURE) {
    hookRegistry.register(createWireTraceHook(cwd));
  }
  const memoryRoot = path.join(cwd, config.memoryDir);

  // Layer A canvas tools (always registered for both harnesses).
  const todoManager = new TodoManager();
  registry.register(createTodoTool(todoManager));
  const taskStore = new TaskStore(path.join(config.workspaceRoot, ".agents", "runtime", "tasks"));
  registry.register(createTaskCreateTool(taskStore));
  registry.register(createTaskUpdateTool(taskStore));
  registry.register(createTaskGetTool(taskStore));
  registry.register(createTaskListTool(taskStore));
  registry.register(createTaskClaimTool(taskStore));
  const backgroundTaskManager = new BackgroundTaskManager(
    path.join(config.workspaceRoot, ".agents", "runtime", "background"),
  );
  const terminalSessionManager = new TerminalSessionManager();

  const skills = new SkillLoader(resolveSkillsDirs(cwd, config.workspaceRoot, config.skillsDir));
  skills.assertNoLoadErrors();
  registry.register(createSkillTool(skills));

  registry.register(listAttemptsTool);
  registry.register(askUserTool);

  registry.register(createComponentReferenceSearchTool());
  registry.register(createIconSearchTool());
  registry.register(createFontRecommendationSearchTool());
  registry.register(createWebAssetSearchTool());
  registry.register(createWebAssetPublicSearchTool());
  registry.register(createWebGenerationRetrievalPrepareTool());
  registry.register(createWebGenerationCodegenPrepareTool());
  registry.register(createWebHeroDebugResumePlanTool());
  registry.register(createRetrievalRecordGetTool());
  registry.register(createRetrievalRecordListTool());
  registry.register(readNodeMediaForContextTool);
  registry.register(taskBoardReadTool);

  registerHarnessSpecificTools?.({ registry, cwd, config, memoryRoot });

  const client = new LLMClient(config);
  const runner = new AgentRunner(config, registry, client, skills, new HookRunner(hookRegistry.list()));
  registry.register(createAgentTool({ runner, registry }));
  const registeredToolNames = registry.list().map((tool) => tool.name);
  const baseCapabilityGrant = createCapabilityGrant({
    tools: registeredToolNames,
    workspaceRoot: config.workspaceRoot,
  });
  const logger =
    config.worldApiUrl && config.worldApiUrl.length > 0
      ? new WorldLogger({
          apiUrl: config.worldApiUrl,
          processName: path.basename(cwd),
        })
      : undefined;

  logger?.start();
  logRuntimeMeta(harness, logger);

  const createToolContextMeta = (
    capabilityGrant = baseCapabilityGrant,
    extraMeta?: Record<string, unknown>,
  ): Record<string, unknown> => ({
    backgroundTaskManager,
    terminalSessionManager,
    maxSubagentDepth: config.maxSubagentDepth,
    workspaceRoot: config.workspaceRoot,
    defaultMemoryRoot: memoryRoot,
    runtimeHarness: harness,
    registeredToolNames,
    capabilityGrant,
    ...(extraMeta ?? {}),
  });

  const resolveSessionStoreDir = (): string =>
    resolveRuntimeSessionStoreDir({
      cwd,
      memoryDir: config.memoryDir,
    });

  const createSessionStore = (sessionKey: string): RuntimeSessionStore => ({
    dir: resolveSessionStoreDir(),
    key: sessionKey,
  });

  const loadSessionHistory = (sessionKey: string): Message[] => loadSessionMessages(createSessionStore(sessionKey));
  const persistSessionHistory = (sessionKey: string, history: Message[]): void => {
    saveSessionMessages(createSessionStore(sessionKey), history);
  };
  const listSessions = (limit = 20): SessionSummary[] => listSessionSummaries(resolveSessionStoreDir(), limit);
  const run = async (prompt: string, options?: AssistantRuntimeRunOptions): Promise<string> => {
    const eventSink = options?.eventSink;
    await Promise.resolve(eventSink?.({
      type: "run.started",
      prompt,
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
    }));
    try {
      const result = await runner.run(prompt, cwd, {
        depth: 0,
        ...(options?.history ? { history: options.history } : {}),
        ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
        systemOverride,
        toolContextMeta: createToolContextMeta(
          baseCapabilityGrant,
          {
            ...createRuntimeChannelMeta(options?.channel),
            ...(eventSink ? { eventSink } : {}),
          },
        ),
        onToolStart: (toolStart) => {
          options?.onToolStart?.(toolStart);
          void eventSink?.({
            type: "tool.started",
            toolCallId: toolStart.toolCallId,
            name: toolStart.name,
            args: toolStart.args,
            startedAt: toolStart.startedAt,
          });
        },
        onTextDelta: (delta) => {
          options?.onTextDelta?.(delta);
          void eventSink?.({ type: "text.delta", delta });
        },
        onTurn: (turn) => {
          options?.onTurn?.(turn);
          void eventSink?.({ type: "turn.completed", turn });
        },
        onToolCall: (toolCall) => {
          options?.onToolCall?.(toolCall);
          const todoUpdate = parseRuntimeTodoUpdate(toolCall);
          if (todoUpdate) {
            void eventSink?.({ type: "todo.updated", todo: todoUpdate });
          }
          void eventSink?.({ type: "tool.completed", toolCall });
        },
      });
      await Promise.resolve(eventSink?.({ type: "run.completed", result }));
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await Promise.resolve(eventSink?.({ type: "run.failed", message }));
      throw error;
    }
  };

  const shutdown = async (status: "ok" | "stopped" | "error"): Promise<void> => {
    terminalSessionManager.closeAll();
    await logger?.updateStatus(status);
  };

  return {
    cwd,
    config,
    harness,
    skills,
    runner,
    memoryRoot,
    logger,
    systemOverride,
    backgroundTaskManager,
    terminalSessionManager,
    baseCapabilityGrant,
    registeredToolNames,
    createToolContextMeta,
    resolveSessionStoreDir,
    createSessionStore,
    loadSessionHistory,
    saveSessionHistory: persistSessionHistory,
    listSessions,
    run,
    shutdown,
  };
}
