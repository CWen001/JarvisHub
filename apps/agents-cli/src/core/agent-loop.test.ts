import assert from "node:assert/strict";
import test from "node:test";

import { readPendingRequiredCriticReviews } from "./agent-loop.js";
import type { ToolCallTrace } from "./hooks/types.js";

function skillCall(skill: string): ToolCallTrace {
  return {
    toolCallId: `skill-${skill}`,
    name: "Skill",
    args: { skill },
    output: "loaded",
    outputChars: 6,
    outputHead: "loaded",
    outputTail: "loaded",
    status: "succeeded",
    startedAt: "2026-09-01T00:00:00.000Z",
    finishedAt: "2026-09-01T00:00:01.000Z",
    durationMs: 1,
  };
}

function agentCall(
  subagentType: "media" | "critic",
  kind: string,
  targetNodeIds: string[],
  structuredOutput?: Record<string, unknown>,
  outputKeys: string[] = [],
): ToolCallTrace {
  const outputJson = structuredOutput
    ? { subagentType, structuredOutput }
    : { subagentType };
  return {
    toolCallId: `${subagentType}-${kind}-${targetNodeIds.join("-")}`,
    name: "Agent",
    args: {
      subagent_type: subagentType,
      task_contract: { kind, targetNodeIds, outputKeys },
    },
    output: JSON.stringify(outputJson),
    outputJson,
    outputChars: 0,
    outputHead: "",
    outputTail: "",
    status: "succeeded",
    startedAt: "2026-09-01T00:00:00.000Z",
    finishedAt: "2026-09-01T00:00:01.000Z",
    durationMs: 1,
  };
}

const completedWatch = {
  status: "completed",
  completed: [{ nodeId: "watch-01", status: "success", persisted: true }],
};

test("requires one Critic after the generic media contract emitted by a loaded vertical Skill", () => {
  assert.deepEqual(
    readPendingRequiredCriticReviews([
      skillCall("phone-design-kernel"),
      agentCall("media", "visualAsset", [], {
        status: "completed",
        completed: [{ nodeId: "phone-live-01", status: "success", persisted: true }],
      }, ["phone-live-01"]),
    ]),
    [{ kind: "phone_concept_image", nodeId: "phone-live-01" }],
  );
});

test("requires one Critic after a persisted Watch, Tablet, or Phone artifact", () => {
  assert.deepEqual(
    readPendingRequiredCriticReviews([
      agentCall("media", "watch_concept_image", ["watch-01"], completedWatch),
      agentCall("media", "phone_concept_image", ["phone-01"], {
        status: "completed",
        completed: [{ nodeId: "phone-01", status: "success", persisted: true }],
      }),
      agentCall("media", "unrelated_image", ["other-01"], {
        status: "completed",
        completed: [{ nodeId: "other-01", status: "success", persisted: true }],
      }),
    ]),
    [
      { kind: "watch_concept_image", nodeId: "watch-01" },
      { kind: "phone_concept_image", nodeId: "phone-01" },
    ],
  );
});

test("a failed Critic does not satisfy the review requirement", () => {
  const failedCritic = agentCall("critic", "watch_concept_review", ["watch-01"]);
  failedCritic.status = "failed";

  assert.deepEqual(
    readPendingRequiredCriticReviews([
      agentCall("media", "watch_concept_image", ["watch-01"], completedWatch),
      failedCritic,
    ]),
    [{ kind: "watch_concept_image", nodeId: "watch-01" }],
  );
});

test("a later scoped Critic satisfies the review requirement", () => {
  assert.deepEqual(
    readPendingRequiredCriticReviews([
      agentCall("media", "watch_concept_image", ["watch-01"], completedWatch),
      agentCall("critic", "watch_concept_review", ["watch-01"]),
    ]),
    [],
  );
});

test("a new revision after Critic requires a new review", () => {
  assert.deepEqual(
    readPendingRequiredCriticReviews([
      agentCall("media", "watch_concept_image", ["watch-01"], completedWatch),
      agentCall("critic", "watch_concept_review", ["watch-01"]),
      agentCall("media", "watch_concept_image", ["watch-01"], completedWatch),
    ]),
    [{ kind: "watch_concept_image", nodeId: "watch-01" }],
  );
});
