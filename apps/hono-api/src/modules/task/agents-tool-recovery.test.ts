import { describe, expect, it } from "vitest";

import { countRecoveredAgentDispatchValidationFailures } from "./agents-tool-recovery";

type Call = Parameters<typeof countRecoveredAgentDispatchValidationFailures>[0][number];

function call(input: Partial<Call> & Pick<Call, "name" | "status">): Call {
  return {
    name: input.name,
    status: input.status,
    errorMessage: input.errorMessage ?? "",
    inputJson: input.inputJson ?? null,
  };
}

describe("countRecoveredAgentDispatchValidationFailures", () => {
  it("recognizes a missing subagent_type call recovered by a later equivalent dispatch", () => {
    const calls = [
      call({
        name: "Agent",
        status: "failed",
        errorMessage: "subagent_type 必填。",
        inputJson: { description: "生成手表英雄概念图", prompt: "生成并等待完成" },
      }),
      call({
        name: "Agent",
        status: "succeeded",
        inputJson: {
          subagent_type: "media",
          description: "生成手表英雄概念图",
          prompt: "生成并等待完成",
        },
      }),
    ];

    expect(countRecoveredAgentDispatchValidationFailures(calls)).toBe(1);
  });

  it("does not recover a malformed dispatch without a later equivalent success", () => {
    const calls = [
      call({
        name: "Agent",
        status: "failed",
        errorMessage: "subagent_type 必填。",
        inputJson: { description: "生成手表英雄概念图", prompt: "生成并等待完成" },
      }),
      call({
        name: "Agent",
        status: "succeeded",
        inputJson: {
          subagent_type: "critic",
          description: "评审手表图片",
          prompt: "评审最终图片",
        },
      }),
    ];

    expect(countRecoveredAgentDispatchValidationFailures(calls)).toBe(0);
  });

  it("never treats provider or media tool failures as recovered dispatch validation", () => {
    const calls = [
      call({
        name: "canvas_image_generate_to_canvas",
        status: "failed",
        errorMessage: "provider unavailable",
      }),
      call({ name: "canvas_image_generate_to_canvas", status: "succeeded" }),
    ];

    expect(countRecoveredAgentDispatchValidationFailures(calls)).toBe(0);
  });
});
