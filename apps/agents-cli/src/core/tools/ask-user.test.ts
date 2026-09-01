import assert from "node:assert/strict";
import test from "node:test";

import { createToolRuntimeState } from "../session/session-engine.js";
import { askUserTool } from "./ask-user.js";

test("ask_user recovers text choices mistakenly sent as image cards", async () => {
  const meta: Record<string, unknown> = {};
  const result = await askUserTool.execute(
    {
      question: "选择一个设计方向",
      optionCards: [
        { title: "推荐", value: "克制高级", imageUrl: "" },
        { title: "备选", value: "运动锐利", imageUrl: "" },
        { title: "备选", value: "温和圆润", imageUrl: "" },
      ],
    },
    { cwd: process.cwd(), depth: 0, meta, state: createToolRuntimeState() },
    "ask-1",
  );

  const output = result.payload?.structuredOutput as {
    options: string[];
    optionCards: unknown[];
  };
  assert.deepEqual(output.options, ["推荐｜克制高级", "备选｜运动锐利", "备选｜温和圆润"]);
  assert.deepEqual(output.optionCards, []);
});
