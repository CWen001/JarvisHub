import assert from "node:assert/strict";
import test from "node:test";

import { buildHarnessSystemOverride } from "./root-persona.js";

test("Root requires one native Design Direction Turn before Watch and Tablet Media dispatch", () => {
  const system = buildHarnessSystemOverride("canvas");

  assert.match(system, /每个 Watch 或 Tablet 生图请求/);
  assert.match(system, /派发 media 前.*Design Direction Turn/);
  assert.match(system, /一次用户请求.*不是每次 Provider 调用/);
  assert.match(system, /三个简洁文字选项.*第一个标为推荐/);
  assert.match(system, /ask_user\.options.*禁止使用 optionCards/);
  assert.match(system, /局部修改.*实施强度或取舍/);
  assert.match(system, /点击选项或自由文本.*不再确认/);
  assert.match(system, /明确要求采用推荐方向或直接生成.*跳过/);
});
