import assert from "node:assert/strict";
import test from "node:test";

import { buildHarnessSystemOverride, DEFAULT_ROOT_PERSONA_INTRO } from "./root-persona.js";

const system = buildHarnessSystemOverride("canvas");

test("Root delegates Skill execution without an extra design-packet phase", () => {
  assert.match(DEFAULT_ROOT_PERSONA_INTRO, /最短执行路径/);
  assert.match(system, /不要为 Skill 已覆盖的内部设计推理另派 plan/);
  assert.match(system, /用户或当前 Skill 明确要求.*独立方案/);
  assert.match(system, /不要把内部推理、提示词准备或交接摘要创建为文本节点/);
  assert.match(system, /Skill 内部步骤.*独立任务/);
  assert.match(system, /同一轮.*批量/);
});

test("Root follows the loaded Skill instead of hardcoding category dialogue or extra reviews", () => {
  assert.doesNotMatch(system, /Watch|Tablet|Phone|三个简洁文字选项|一次原生 Design Direction Turn/);
  assert.match(system, /对话、设计决策、生成前检查和专业评审.*当前 Skill/);
  assert.match(system, /仅在用户或当前 Skill 要求专业评审时/);
  assert.match(system, /不要额外增加评审轮次/);
  assert.match(system, /Skill 示例 ID 只是命名形状/);
});

test("Root retains native execution, requested text artifacts, persistence and failure safeguards", () => {
  assert.match(system, /用户明确要求的文本交付物.*canvas_create_text_node/);
  assert.match(system, /task_contract.kind=storyboard_script/);
  assert.match(system, /@agent-output:<outputKey>/);
  assert.match(system, /需要生成.*必须派 media sub-agent/);
  assert.match(system, /需要评审成品素材时，必须派 critic sub-agent/);
  assert.match(system, /派发 media 前必须先 canvas_flow_inspect/);
  assert.match(system, /明确用户授权/);
  assert.match(system, /不得扩展 ask_user schema/);
  assert.match(system, /禁止执行 shell|不要执行 shell/);
  assert.match(system, /status=success、persisted=true/);
  assert.match(system, /明确 failed\/timed_out/);
  assert.match(system, /critic 的 Reject 结论本身不授权重生成/);
});
