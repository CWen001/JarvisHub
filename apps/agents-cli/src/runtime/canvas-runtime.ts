import { createAssistantRuntimeBase, type AssistantRuntime } from "./runtime.js";
import type { AgentConfig } from "../types/index.js";
import { createMemoryTools } from "../core/tools/memory.js";

/**
 * 画布 harness runtime：注册 LOCAL_CANVAS_TOOLS（Layer A 静态集合）+ memory 工具。
 * 画布生成 / patch / checkpoint 类工具属于 hono-api Layer B，由每次 chat 请求动态注入。
 *
 * 入口：`agents serve` HTTP bridge。
 *
 * 显式不注册：fs / shell / exec_command / write_stdin / exec_session_list /
 * background_run / background_get / background_list。
 */
export function createCanvasRuntime(input: { cwd: string; config: AgentConfig }): AssistantRuntime {
  return createAssistantRuntimeBase({
    cwd: input.cwd,
    config: input.config,
    harness: "canvas",
    registerHarnessSpecificTools: ({ registry, memoryRoot }) => {
      for (const memoryTool of createMemoryTools(memoryRoot)) {
        registry.register(memoryTool);
      }
    },
  });
}
