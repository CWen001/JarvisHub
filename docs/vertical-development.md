# Vertical Design Extension 开发指南

本文说明如何新增或修改一个与 Watch、Tablet 平行的专业垂类。开始前先阅读 [`product-architecture.md`](product-architecture.md)；专业术语以 [`CONTEXT.md`](../CONTEXT.md) 为准。

目标不是开发一个拥有自己 Runtime 的“小产品”，而是把一套专业 Design Authority 封装成 Jarvis 可原生加载的自包含 Skill Package，并复用 Shared Product Trunk。

## 1. 一个 Vertical 应该包含什么

Vertical Design Extension 通常由两部分组成：

1. **Portable Design Kernel 内容**：专业 Schema、BaseModel、知识、选择规则、Design Dialogue、Artifact 要求、质量规则和 provenance。
2. **原生 Skill Package 外壳**：`SKILL.md`、渐进加载的 `references/`、manifest、validator，以及调用 Jarvis 原生能力的说明。

Package 可以参考当前 Watch 与 Tablet 的形态：

```text
<vertical-skill>/
├── SKILL.md
├── references/
│   ├── kernel-manifest.json
│   ├── design-dialogue.md
│   ├── <artifact>-base-model.md
│   ├── catalog.json / knowledge files
│   ├── approval-ledger.json
│   └── quality or artifact guidance
└── scripts/
    └── validate-kernel.mjs
```

这是指导性结构，不是要求所有垂类共享一个 super-schema。不同专业领域可以拥有不同知识组织，只需满足共同的接入和验收合同。

## 2. 哪些内容不能放进 Vertical

Vertical 不应拥有：

- Agent 或 Sub-agent orchestration；
- Tool lifecycle、provider dispatch、retry、recovery 或 Trace；
- Project、Flow、Session、Canvas node、asset 或 Artifact 数据库；
- Agent Workspace Runtime 或垂类专属 Product View；
- 自己的上传、Gallery、Chat、Canvas 或 Session 实现；
- 前端关键词意图分类器；
- activation callback registry；
- 客户权限、租户或部署策略。

从已有外部项目迁移时，吸收其专业知识与质量判断，不吸收它为了独立运行而建立的 frontend、provider、Session state machine 或 Gallery。Tablet Package 即采用这种方式：保留来源 revision 和专业材料，去除对 `tablet_pi` 的 build-time/runtime 依赖，改用 Jarvis 原生执行和持久化。

## 3. 接入步骤

### 第一步：确定专业边界

写清楚：

- 该垂类设计的对象和首个可验收 Artifact；
- 最低输入事实与 Generation Readiness；
- BaseModel 的不可妥协约束；
- 可选择的 Knowledge Atom 或专业策略；
- 用户必须看见并确认的 Design Dialogue；
- 质量如何评价；
- 一次生成需要记录哪些 Knowledge Evidence。

这些属于 Design Authority。不要把“由哪个 Agent 调用哪个 Tool”写成专业真理。

### 第二步：制作自包含 Package

将专业内容放入 Package 的 `references/`，使用 manifest 记录至少：

- Package 与专业资料版本；
- BaseModel ID、版本和资源；
- Knowledge catalog 与 approval ledger；
- Design Dialogue 资源；
- 首个 acceptance-backed Artifact target；
- provenance / `sourceEvidence` 规则；
- 若由外部项目迁移，记录来源仓库、revision、文件和许可/使用范围。

`SKILL.md` 应保持较薄：说明何时加载、按什么顺序读取 references、怎样通过 Jarvis 原生 Agent/Tool 工作。专业内容的唯一来源应在 Package references 中，而不是同时维护一份源项目运行时和一份 Jarvis prompt 副本。

### 第三步：复用 Jarvis 原生执行

Package 通过 Jarvis 已有能力完成工作：

- 原生 `Skill` Tool 加载 Package；
- Jarvis Agent / Sub-agent 进行推理和委派；
- 原生 Media 与 Canvas Tool 生成并持久化 Artifact；
- 原生 `ask_user` 承载 Design Dialogue；
- 原生 Session 保持上下文；
- 原生 `sourceEvidence` 记录实际使用的专业证据。

如果接入需要另建“Vertical Runtime”，先停下来判断缺的是共享 Adapter 还是 Package 内容，而不是直接复制 Harness。

### 第四步：注册 Vertical identity

将 Skill key 加入 compile-time Vertical Skill Registry。Registry 只应包含有序 key，不加入：

- brand；
- prompt；
- filesystem path；
- recognition keyword；
- callback；
- workflow configuration；
- persistence hook。

启动时必须通过原生 Skill discovery 验证 key 确实存在。不能注册一个未安装或无法加载的 Vertical。

### 第五步：验证互斥激活

验证以下外部行为：

- 普通 Skill load 不改变 Vertical selection；
- incomplete、failed 或未注册 Skill load 不激活 Vertical；
- completed successful registered Skill load 激活对应 Vertical；
- 新 Vertical 替换旧 Vertical；
- 手动选择使用同一个 Composer Skill slot；
- 手动关闭回到无 Vertical 的通用 Jarvis；
- selection 在已有 Chat Session scope 中恢复；
- Project 不获得 Vertical binding；
- Agent Workspace brand 不随 Vertical 改变。

不要通过 frontend keyword classifier 让测试“看起来通过”。真实 authority 是 Jarvis 完成的原生 Skill load。

## 4. 什么时候修改 Shared Product Trunk

默认先在 Vertical Package 内完成专业能力。只有同时满足以下条件，才考虑修改共享主线：

1. 需求与具体品类无关；
2. Watch、Tablet 或第二个真实垂类已经证明存在相同基础设施需求；
3. 变化可以放在现有 Runtime Interface、Product-owned Adapter 或通用 projection 后面；
4. 不会把某个 Kernel 的 Schema 强加给其他 Kernel；
5. 不会扩大 Professional Workspace 或上游派生文件中的 Product 行为。

例如，互斥 Skill selection 和通用 Artifact projection 可以共享；Tablet 的 Maturity Anchor 和 Watch 的 wearability knowledge 不应共享。

如果确实需要新的 Seam，应优先选择最高、最稳定的测试面，并将复杂度藏在一个深 Product-owned Module 后面。一个垂类的单独需求通常不足以证明一个通用扩展框架。

## 5. 验收标准

### Package 与专业内容

- Package 可被原生 `/skills` discovery 发现并无错误加载；
- 无来源项目 build-time/runtime 依赖；
- manifest、BaseModel、knowledge、approval ledger 和 guidance 相互一致；
- validator 拒绝缺失版本、未批准知识、无效引用和不完整 evidence；
- 用户可见内容不泄漏内部 digest、存储字段或实现细节。

### 交互与执行

- Directional Generation 在需要时先给出专业策略组合；
- Design Dialogue 只追问真正阻碍 Generation Readiness 的事实；
- 用户确认后，约束进入可观察的生成输入；
- local revision 或 derivative view 不机械重复完整对话；
- Jarvis 原生 Agent、Media、Canvas、Session 和 Trace 完成执行；
- 没有 Vertical-owned lifecycle 或 durable state。

### Artifact 与 evidence

- 至少一个 Artifact target 完成真实端到端生成验收；
- 产物成功持久化为稳定 Canvas node / asset；
- Public Chat 或 Agent Workspace 能投影同一权威 Artifact；
- `sourceEvidence` 精确记录实际使用的 BaseModel、catalog/benchmark 和 selected knowledge revisions；
- 质量验收既检查技术成功，也检查专业要求；技术成功不能替代专业通过。

### 架构兼容性

- Agent Workspace Runtime 未被垂类复制或专门化；
- Professional Workspace 保持原生；
- 删除该 Package 后其他 Vertical 与通用 Jarvis 仍运行；
- 若修改上游派生文件，触点已按 [`upstream-maintenance.md`](upstream-maintenance.md) 注册和验证；
- 自动测试不调用真实 provider，真实生成单独记录为验收证据。

当前完整的产品级验收基线见 [`vertical-product-mvp-acceptance.md`](vertical-product-mvp-acceptance.md)。

## 6. 修改已有 Vertical

修改知识或 BaseModel 时：

1. 保持来源和 revision 可追溯；
2. 提升受影响资源版本；
3. 更新 catalog / approval ledger / manifest 引用；
4. 更新 validator，使错误在加载或 CI 阶段暴露；
5. 重跑离线合同测试；
6. 当专业输出语义明显变化时，重做真实 Artifact 验收。

不要直接修补生成 prompt 而不更新专业来源。Prompt 是 Kernel 约束在当前 Harness 中的执行表达，不是 Design Authority 的唯一存储位置。

## 7. 开发完成前的校准

提交前确认：

- 新内容是专业分支，还是被误放进分支的共享基础设施？
- Package 是否只提供专业能力，而没有接管 Jarvis 执行？
- 第二个 Vertical 是否仍能原样使用 Agent Workspace？
- 用户看见的是专业判断，而不是 Skill、Tool 和 Agent 内部结构？
- 真实 Artifact 和 Knowledge Evidence 是否可从 Jarvis 权威状态追溯？

如果答案明确，新的 Vertical 就是共享主线上的一条平行分支，而不是新的产品 fork。
