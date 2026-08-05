# JarvisHub 上游维护指南

本文说明 Shared Product Trunk 如何快速吸收未来 JarvisHub 上游更新。架构原则见 [`product-architecture.md`](product-architecture.md)，机器可读事实以 [`config/upstream-compatibility.json`](../config/upstream-compatibility.json) 为准。

目标不是追求“与上游零 diff”，而是让每个 diff 都有明确归属、窄接触面、测试和清理路径。

## 1. 两类允许的上游触点

除注册的 Product-owned roots 外，仓库路径默认视为 upstream-derived。对 upstream-derived 文件的修改只能属于以下两类。

### Integration Seam

Integration Seam 是 Shared Product Trunk 与上游 Jarvis 的永久窄连接点，例如：

- 挂载 Product Workspace；
- 把已挂载 Native Chat Controller 注册给 Product-owned Adapter；
- 调用 Public Chat Delivery Adapter；
- 暴露 Product 和 native build/validation entry。

Seam 中只保留调用、注册或数据传递。复杂 Product 行为必须位于 Product-owned Adapter。删除 Seam 后，原生 Jarvis 应继续运行。

### Upstream Patch

Upstream Patch 是对 Jarvis 原生行为的一般性修复。即使没有 Product Host，它仍然有价值，例如 native retry、Session recovery 或稳定资产 hosting 修复。

Patch 必须：

- 与 Product 行为隔离；
- 有独立 native behavior test；
- 标记为等待 upstream review，而不是永久本地定制；
- 在上游合并等价修复后删除本地版本。

不要把 Product feature 命名成 Upstream Patch，也不要因为一个修改“很小”就绕过注册。

## 2. Compatibility Surface 注册内容

`config/upstream-compatibility.json` 记录：

- `upstreamRef`：比较和 replay 基线；
- `productOwnedRoots`：Product 可以独立维护的路径；
- `touchpoints`：每个 upstream-derived 触点；
- touchpoint classification、purpose、Adapter、tests、upstream disposition；
- changed-line warning threshold；
- replay 后运行的验证命令。

changed-line count 只是升级风险提示。真正的合规条件是：每个 native touchpoint 都已注册、语义集中、可移除，并由对应合同保护。

新增 Product 文档、Package 或 Adapter root 时，也要确认它被 `productOwnedRoots` 覆盖；不能为了通过检查而把宽泛的 upstream 目录整体宣布为 Product-owned。

## 3. 日常修改流程

### 修改前

1. 判断目标路径是 Product-owned 还是 upstream-derived。
2. 如果 upstream-derived，判断变化是 Integration Seam 还是 Upstream Patch。
3. 优先寻找已有 Adapter 和 Seam；不要为一个调用再建平行入口。
4. 为外部行为确定最高稳定测试面。

### 修改后

运行：

```bash
pnpm run test:upstream-compatibility
```

该命令会运行 checker/replay 单元测试，并检查 `upstream/main...HEAD` 的已提交差异和当前 worktree 差异。它会：

- 拒绝未注册 upstream-derived 修改；
- 检查 registry 结构；
- 报告 Product-owned paths、Integration Seams 和 Upstream Patches；
- 对超过阈值的触点发出风险 warning。

warning 不等于自动失败，但必须解释为什么 Seam 仍然窄，或继续把 Product 行为迁移到 Adapter。

## 4. 上游升级流程

### 4.1 准备干净、可复现的 Product HEAD

- 完成当前改动并运行相关 focused tests；
- 确认没有混入无关 worktree 修改；
- 确认 remote 和 `upstream/main` 指向预期 JarvisHub 上游；
- 获取最新上游：

```bash
git fetch upstream main
```

### 4.2 先检查当前 Compatibility Surface

```bash
pnpm run test:upstream-compatibility
```

先消除未注册触点和 registry 错误。不要在一个本来就不可解释的 Product diff 上开始升级。

### 4.3 做结构 replay

```bash
pnpm run verify:upstream-replay
```

Replay 工具从 `upstream/main` 创建临时 detached worktree，依次应用：

1. Product-owned files；
2. 每个注册 Integration Seam；
3. 每个注册 Upstream Patch。

然后核对 replay paths 与预期 changed paths 完全一致，并写入 `docs/upstream-compatibility/replay-report.md`。

默认 replay 只验证结构，不运行完整命令组。需要完整验收时使用：

```bash
pnpm run verify:upstream-replay -- --run-tests
```

注意：replay 基于已提交的 `HEAD`。当前未提交 worktree 变化会被 compatibility checker 看见，但不会进入 replay patch；因此正式 replay 前应先形成可复现提交。

### 4.4 上游确有新提交时做真实合并演练

如果报告显示 `upstream/main` 有 Product HEAD 尚未包含的提交，仅有结构 replay 不足以证明可升级。应在临时 worktree 或临时分支执行真实 merge/rebase rehearsal，记录实际冲突集，而不是在主工作树中边试边修。

建议顺序：

1. 从当前 Product HEAD 建立临时 worktree；
2. merge 或 rebase 最新 `upstream/main`；
3. 按下节分类处理冲突；
4. 运行 registry 中的完整 validation commands；
5. 验证 Product build 与 native build；
6. 更新 replay report 和必要的 audit；
7. 演练通过后，再采用明确的正式升级策略。

仓库当前上游没有新变化时，验收目标是 replayability，不制造虚假的冲突模拟。

## 5. 怎样处理冲突

### Product-owned file 与上游冲突

正常情况下，真正 Product-owned root 不应与上游同路径演进。若发生冲突，先检查 root 是否划得过宽，或上游是否新增了同名能力。不要机械保留 Product 版本。

### Integration Seam 冲突

1. 先理解上游新 Interface 和生命周期；
2. 保留上游原生行为；
3. 重新接上最小注册/调用 Seam；
4. 必要的翻译放回 Product-owned Adapter；
5. 运行该 touchpoint 注册的 contract tests；
6. 如果新上游已提供正式 extension point，优先迁移到它并缩小或删除本地 Seam。

升级后若必须在多个 native 文件复制 Product 逻辑，说明 Adapter 或 Seam 需要重新深化，而不是说明 registry 应放宽。

### Upstream Patch 冲突

先判断上游是否已包含等价修复：

- **已完全包含**：删除本地 Patch 和 registry touchpoint，保留/调整测试以保护上游行为。
- **部分包含**：以新上游语义为准，只保留最小未覆盖修复，并更新 purpose/tests/disposition。
- **尚未包含**：在新上游实现上重新应用独立 Patch，确认它仍是通用 Jarvis 修复。
- **上游有不同设计**：测试外部行为，不强行保留旧实现；必要时重新评估原 Patch 是否还成立。

不要把已被上游吸收的 Patch 永久留在本地，哪怕它当前没有产生文本冲突。

## 6. 验收顺序

完整 replay 的命令来源是 registry，不应在文档中维护另一份易漂移清单。当前大类顺序为：

1. Upstream Compatibility checker 与 replay tests；
2. Public Chat Delivery 和相关 API focused tests；
3. Web contract/full tests；
4. API build；
5. Product Workspace build；
6. native Professional Workspace build；
7. Agent definitions 与 Vertical Skill validators；
8. Agents build。

需要人工确认的重点：

- Professional Workspace 的 Chat、Canvas、asset、Session 和 recovery 保持原生；
- Agent Workspace 仍通过 Runtime/Adapter 使用同一权威事实；
- Watch 与 Tablet 都能发现、互斥激活和执行；
- Public Chat 中成功持久化的 Artifact 进入响应，partial/failed 语义真实；
- 未注册 native diff 为零；
- 每个 warning 都有明确风险解释。

## 7. 常见错误

### 只看 merge 是否无冲突

Git 无冲突不代表语义兼容。上游可能改变 Native Chat 生命周期、Flow 结构或资产身份，而文本仍可自动合并。必须运行合同和两个 Workspace build。

### 把整个目录标成 Product-owned

这会让 checker 安静，却摧毁 Compatibility Surface 的意义。Product-owned root 应具有清晰 Product ownership；native 目录中的接触仍逐文件注册。

### 在 replay 前依赖未提交工作树

Checker 会检查 worktree，replay 只应用 committed `HEAD`。用未提交状态生成“升级通过”结论不可复现。

### 用 no-tests 结果覆盖完整验收报告

结构 replay 和完整 validation 是不同证据。发布升级结论时，报告应来自正式验收 invocation，而不是之后一次快捷 `--no-tests` 运行。

### 看到 warning 就移动代码而不看 Authority

降低 changed lines 不是唯一目标。不要为了数字好看而复制 Native Chat Authority 或破坏 locality。正确方向是把 Product 行为集中到 Adapter，同时保留最小 native registration Seam。

## 8. 升级完成的判定

一次升级只有在以下条件同时成立时才完成：

- 所有 upstream-derived diff 均被注册并正确分类；
- Product-owned roots 没有吞并新的 native ownership；
- 临时 worktree replay coverage 为 PASS；
- 有上游变化时，真实 merge/rebase rehearsal 已通过；
- registry 声明的 validation commands 通过；
- native Professional Workspace 和 Product Workspace 都通过验收；
- 已被上游吸收的 Patch 已删除；
- replay report 记录实际 baseline、Product HEAD、touchpoint 数量和验证结果。

相关资料：

- 当前 registry：[`config/upstream-compatibility.json`](../config/upstream-compatibility.json)
- Native Chat audit：[`upstream-compatibility/native-chat-audit.md`](upstream-compatibility/native-chat-audit.md)
- 最近 replay report：[`upstream-compatibility/replay-report.md`](upstream-compatibility/replay-report.md)
- 架构决策：[ADR-0016](adr/0016-maintain-upstream-compatibility-through-registered-seams.md)
