import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRunner } from "../agent-loop.js";
import type { ToolCallTrace } from "../hooks/types.js";
import { runSubagent } from "./runner.js";

type RunOptions = NonNullable<Parameters<AgentRunner["run"]>[2]>;

const target = {
  nodeId: "watch_concept_extreme_trail_01",
  assetId: "asset-01",
  taskId: "task-01",
};

function toolCall(
  name: string,
  data: Record<string, unknown>,
  args: Record<string, unknown> = {},
): ToolCallTrace {
  return {
    toolCallId: `${name}-call`,
    name,
    args,
    output: JSON.stringify(data),
    outputJson: { ok: true, data },
    outputChars: 0,
    outputHead: "",
    outputTail: "",
    status: "succeeded",
    startedAt: "2026-09-01T00:00:00.000Z",
    finishedAt: "2026-09-01T00:00:01.000Z",
    durationMs: 1,
  };
}

function mediaRunOptions(runner: AgentRunner) {
  return {
    runner,
    cwd: process.cwd(),
    agentType: "media",
    prompt: "Generate the requested watch concept.",
    parentMeta: {
      subagentTaskContract: {
        kind: "watch_concept_image",
        targetNodeIds: [target.nodeId],
        outputKeys: [target.nodeId],
      },
    },
    abortStrategy: { kind: "async" as const },
    availableTools: ["canvas_image_generate_to_canvas", "canvas_flow_inspect"],
  };
}

test("media completion is recovered from this invocation's persisted Canvas evidence", async () => {
  let runCount = 0;
  const runner = {
    async run(_prompt: string, _cwd: string, options: RunOptions) {
      runCount += 1;
      options.onToolCall?.(toolCall("canvas_image_generate_to_canvas", {
        nodeId: target.nodeId,
        assetId: target.assetId,
        taskId: target.taskId,
        status: "success",
        pending: false,
      }, { outputKey: target.nodeId }));
      options.onToolCall?.(toolCall("canvas_flow_inspect", {
        nodes: [{ ...target, status: "success", persisted: true }],
      }));
      return "图片已经生成并持久化。";
    },
  } as unknown as AgentRunner;

  const result = await runSubagent(mediaRunOptions(runner));

  assert.equal(runCount, 1);
  assert.deepEqual(result.structuredOutput, {
    phase: "watch_concept_image",
    status: "completed",
    dispatched: [{
      nodeId: target.nodeId,
      assetId: target.assetId,
      outputKey: target.nodeId,
      taskId: target.taskId,
      status: "success",
      persisted: true,
    }],
    completed: [{
      nodeId: target.nodeId,
      assetId: target.assetId,
      outputKey: target.nodeId,
      taskId: target.taskId,
      status: "success",
      persisted: true,
    }],
    pending: [],
    failed: [],
    blocked: [],
    skipped: [],
  });
});

test("historical persisted Canvas evidence cannot recover a media completion", async () => {
  let runCount = 0;
  const runner = {
    async run(_prompt: string, _cwd: string, options: RunOptions) {
      runCount += 1;
      if (runCount === 1) {
        options.onToolCall?.(toolCall("canvas_flow_inspect", {
          nodes: [{ ...target, status: "success", persisted: true }],
        }));
      } else {
        assert.deepEqual(options.allowedTools, new Set());
      }
      return "图片已经生成并持久化。";
    },
  } as unknown as AgentRunner;

  await assert.rejects(
    runSubagent(mediaRunOptions(runner)),
    /未按终态契约返回结构化结果/,
  );
  assert.equal(runCount, 2);
});

test("mismatched persisted identity cannot recover a media completion", async () => {
  const runner = {
    async run(_prompt: string, _cwd: string, options: RunOptions) {
      options.onToolCall?.(toolCall("canvas_image_generate_to_canvas", {
        nodeId: target.nodeId,
        assetId: target.assetId,
        taskId: target.taskId,
        status: "success",
        pending: false,
      }, { outputKey: target.nodeId }));
      options.onToolCall?.(toolCall("canvas_flow_inspect", {
        nodes: [{ ...target, assetId: "different-asset", status: "success", persisted: true }],
      }));
      return "图片已经生成并持久化。";
    },
  } as unknown as AgentRunner;

  await assert.rejects(
    runSubagent(mediaRunOptions(runner)),
    /未按终态契约返回结构化结果/,
  );
});
