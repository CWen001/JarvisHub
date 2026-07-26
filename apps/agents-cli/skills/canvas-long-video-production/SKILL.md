---
name: canvas-long-video-production
description: "JarvisHub 长视频生产编排技能。用户要求从剧情、小说片段、分镜剧本、故事板或画布素材生成 30s+、60s+、多分钟连续视频、批量视频 clip、完整短片或成片拼接时必须使用。本 skill 是总编排层：判断当前阶段，按剧情到分镜剧本、角色/场景资产、故事板、视频 clip、汇总/拼接推进，并检查节点 status/persisted；实际 JarvisHub 工具参数以当前 harness 暴露的 canvas tool schema 为准。默认必须使用故事板作为视频前置视觉资产，keyframe 只在用户明确要求时才可替代。"
---

# JarvisHub Long Video Production

## Mission

把长视频目标拆成可执行的 JarvisHub 生产链路，并让 agent 知道当前应该做哪一步。

长视频不是一个单次视频 prompt 任务。默认生产链路是：

```text
剧情 / 小说片段 / 梗概
-> 分镜剧本
-> 角色图 / 场景 Base 图
-> 每段故事板
-> 每段视频 clip
-> 汇总 / 拼接
```

本 skill 负责阶段判断、前置证据门控、并行提交策略和交付验收。具体剧本写作、视觉资产生成、故事板提示词、视频提示词、生成等待和 API 参数分别交给对应 phase 的 sub-agent / skill / tool。

## Agent-Native Delegation

主代理是编排器：读取真实画布、判断当前阶段、派发一个阶段任务、核对阶段终态、错误回报和最终交付摘要。专业媒体执行由 `media` sub-agent 隔离完成；主代理不替 `media` 编写最终 prompt、storyboard brief 或运行用 manifest。

### Delegation Guidance

| 用户目标含义 | 建议协作 |
|---|---|
| 只要计划 / 流程分析 | 画布很大时委派 `explore` 收集最小事实；否则主代理可直接读取必要事实。 |
| 只要剧本 | 需要长文本结构化时委派 `plan`；简单剧本可主代理完成。 |
| 资产 / 故事板 / 视频 / 成片 | 主代理每次只派发一个当前 phase 给 `media`；`media` 自主加载当前 phase 相关 Skill，生成并等待到终态后返回。 |

### Sub-Agent Roles

- `explore`：只读收集画布事实、已就绪媒体节点 ID、持久化状态、失败状态和缺口清单；返回最小摘要。
- `plan`：只在需要长文本隔离时完成剧情拆解或标准 Markdown 分镜剧本；不草拟媒体 prompt，不维护媒体 manifest。
- `media`：一次只执行一个明确 phase。它根据 phase task 与 Skills catalog 自主加载当前阶段所需的一个或多个 Skill，在内部形成资产锚点、brief、参考选择和最终 prompt，完成 generate + wait 后立即返回；不得自行进入下一 phase。
- 不执行自动多模态评审，也不生成 pass/fail/needs_revision verdict；用户明确要求确认时才暂停交由用户判断。

### 执行守则

- 主代理给 `media` 的 phase task 只包含：phase kind、context/target node ids、稳定输出身份、下游用途、用户原始硬约束和完成证据。不要传 final prompt、negative prompt、storyboard layout、运行用 manifest 或预先写好的媒体 brief。
- 每次派发都把上述边界写入 `Agent.task_contract`：`kind`、`targetNodeIds`、`contextNodeIds`、`outputKeys`、`downstreamPurpose`、`userConstraints`、`completionEvidence`。`prompt` 只保留一句当前阶段执行指令。
- `storyboard_script` 必须同步派发（禁止 `run_in_background`），必须且只能声明一个 `outputKey`，并把它作为权威剧本 text 节点的 `node.id`。Plan 返回正文后，主代理调用 `canvas_create_text_node` 时传对象参数，并优先使用 `node.data.content="@agent-output:<outputKey>"` 让运行时解析完整原文；也可传完全相同的返回正文。禁止摘要、改写或重新整理后替代原文。工具失败时必须复用同一原文重试，不能重写一个短版；成功前不得结束当前 run。
- `downstreamPurpose` 只说明产物的下游用途，不能变成当前阶段生成约束；`userConstraints` 只能逐项保留用户明确表达的原始硬约束。
- 子代理根据 `task_contract.kind`、真实输入和当前目标自主从 Skills catalog 选择当前阶段 Skill；主代理不要指定 Skill 名称，也不要转述 Skill 方法论。
- `storyboard_script` → `plan` 子代理自主加载 `storyboard-script-writer`。
- `visual_assets_generation` → `media` 子代理自主加载 `storyboard-visual-assets`。
- `storyboard_generation` → `media` 子代理自主加载 `storyboard-image-production`。
- `video_clip_generation` → `media` 子代理自主加载 `canvas-video-prompting`。
- `video_concat` → 不加载上游生产 Skill。
- 阶段 prompt 只表达当前需求，不复制 Skill 方法论，使用以下最小语义：
  - `storyboard_script`：读取 `context` 中的原始剧情，生成标准分镜剧本。
  - `visual_assets_generation`：读取 `contextNodeIds` 中的完整分镜剧本，提取并生成必要角色、场景和关键道具素材。
  - `storyboard_generation`：读取 `contextNodeIds` 中的分镜剧本及已持久化角色、场景素材，生成各 clip 对应故事板。
  - `video_clip_generation`：读取 `contextNodeIds` 中各 clip 对应的故事板，生成视频片段并等待持久化完成。
  - `video_concat`：读取契约指定的已持久化视频片段，按既定顺序完成拼接。
- 所有 `media` phase 都同步派发（`run_in_background=false`），让同一个子任务完成 generate + wait 或同步 concat 后再返回；主代理不得在 media 仍运行时提前结束。
- `media` 必须在本轮等待当前 phase 的目标节点达到真实终态；wait 返回 pending 时如实返回 pending，主代理不得把该 phase 当作完成，也不得进入下游。
- wait 达到有界预算并返回 pending 后，主代理先回读画布并输出当前 phase 的 pending handoff；pending 是本次 chat run 的可恢复终态，本轮不得再次重派 `media` 叠加 wait。下一次用户说“继续”或新的 durable run 才用相同 `kind/targetNodeIds/outputKeys` 重派当前 phase，并标记 `resumeExistingTasks=true`；`media` 只继续 wait，不重新提交 generate。
- 任一工具调用报错必须在 sub-agent finalText 中显式回传；主代理不得当作完成。
- 任一上游没有稳定节点 ID 或未达到 `status=success`、`persisted=true`，对应下游必须留在 `blocked`，不允许凭文字 prompt 凑出新画面。
- 同阶段多个互不依赖的生成任务 → 同一次 `media` dispatch 内部 fan-out，不要拆成多次串行 dispatch。
- 每次 `media` 返回后，主代理必须重新读取真实画布并重新执行 Stage Decision；只有稳定 ID、status 和 persisted 证据满足才派下一 phase。
- 权威剧本节点成功持久化前，禁止进入 Phase 2 或派发任何依赖剧本的下游任务；摘要节点、Agent 完成状态和失败的画布写入都不构成 Phase 1 完成证据。

## Goal-Driven Completion

必须先锁定用户本轮最终目标，再判断什么时候可以收口。阶段完成不等于用户目标完成。

目标完成标准：

| 用户目标 | 可以收口的最低证据 |
|---|---|
| 只要长视频方案 / 流程分析 | 输出阶段计划、缺口与下一步，不调用生成工具 |
| 只要分镜剧本 | 最终回复直接包含完整 Markdown 剧本，或画布中有完整 `storyboardScript` 节点 |
| 只要角色/场景资产 | 必要角色与场景都有稳定节点 ID，且 `status=success`、`persisted=true` |
| 只要故事板 | 每个目标 clip 都有稳定故事板节点 ID，且 `status=success`、`persisted=true` |
| 生成视频 clip | 每个目标 clip 都有稳定视频节点 ID，且 `status=success`、`persisted=true`，或明确失败 |
| 生成完整长视频 / 成片 | 所有 clip 与最终拼接/汇总产物均有稳定节点 ID，且 `status=success`、`persisted=true`；若暂不支持拼接，必须明确停在 clip 完成态 |

当用户说“生成视频、生成长视频、做成视频、完整短片、成片”时，默认最终目标是视频，不是剧本、资产或故事板。Phase 1、Phase 2、Phase 3 都只是中间阶段，不允许作为最终完成态，除非用户明确说“先只做到这里”。

## Phase Loop Rule

每完成一个 phase 后，必须立即重新执行 Stage Decision，并继续推进下一 phase，直到达到用户目标完成标准或遇到真实阻塞。

允许停止的情况只有：

- 已达到本轮用户目标的完成证据。
- 用户明确要求只做当前阶段。
- 工具真实失败、权限不足、画布 scope 缺失或必要输入缺失。
- 用户明确允许“先提交，之后再看结果”，此时必须说明仍是 queued/running，不能说已生成。
- 当前 phase 的有界 wait 返回 pending；回读并交付可恢复 handoff 后结束本次 chat run，等待新的“继续”运行，不在同一 run 内重复 wait。
- 迭代预算耗尽；此时必须报告当前 phase、已完成产物和未完成阻塞。

禁止：

- 因为分镜剧本已生成，就结束“生成视频”任务。
- 因为角色/场景资产已生成，就结束“生成视频”任务。
- 因为故事板已生成，就结束“生成视频”任务。
- 因为节点已创建、工具调用 succeeded、checklist 完成，就声明长视频完成。

## When To Use

- 用户要求生成长视频、完整短片、多段连续视频、批量视频片段或最终成片。
- 用户输入只有剧情，但目标是“做成视频”“生成 60 秒视频”“生成完整短片”。
- 用户已有角色图、场景图或故事板，想继续生成视频。
- 用户要求把多个故事板转为视频 clip，或把多个 clip 汇总成完整视频。

## Role Boundaries

本 skill 是主代理读取的总编排 Skill，不独占下游专业能力。主代理只根据下面的路由选择下一 phase；对应专业 Skill 由该 phase 的 `media` 自主加载：

- 剧情到分镜剧本：派 `plan` 加载 `storyboard-script-writer` 完成标准剧本；主代理只负责把返回的完整正文无损写入用户需要的画布 text 节点并继续阶段判断。若写入失败，重试必须引用或复用同一份 Plan 原文，不得重新摘要。
- 分镜剧本到角色/场景资产：使用 `storyboard-visual-assets`。
- 角色/场景资产到故事板图板：使用 `storyboard-image-production`，或按项目已有故事板流程执行。
- 单段视频 prompt：使用 `canvas-video-prompting`，复杂视频提示词可结合 `canvas-prompt-specialists`。
- 真实画布读写、图片/视频生成、等待结果：遵循当前 harness 暴露的 canvas tool schema。
- 章节续写、尾帧承接、storyboardChunks：结合 `canvas-continuity`。

不要把本 skill 写成平行 API skill；不要在这里复制完整工具 schema。

下游 Skill 的使用顺序也受本 skill 约束：当用户最终目标是视频，`storyboard-image-production` 只能由 Phase 3 的 `media` 使用；在 Phase 1 标准分镜剧本完成前、Phase 2 角色/场景节点持久化完成前，禁止派发故事板 phase。

## Hard Evidence Gate

每进入下一阶段前，必须读取用户输入和当前真实画布状态，确认可执行证据。

可作为完成证据：

- 分镜剧本：用户本轮给出的完整 Markdown 剧本，或画布中承载完整剧本的 `storyboardScript` / text 节点。
- 图片资产：稳定 `nodeId`（必要时加 `assetId`），且 `status=success`、`persisted=true`。
- 分镜格资产：稳定故事板节点 ID，且 `status=success`、`persisted=true`。
- 视频资产：稳定 `nodeId`（必要时加 `assetId`），且 `status=success`、`persisted=true`。

长视频默认必须使用故事板作为视频前置视觉资产。`keyframe` 只在用户明确说“用关键帧 / 不要故事板 / 只要 keyframe”时才可替代；否则不能用 keyframe 跳过故事板阶段。

不构成完成证据：

- 只有节点存在。
- 只有 prompt / label / 文字说明。
- 只有 `taskId`。
- 只有 `status=queued` / `status=running`。
- 只有连线。
- 只有锚点语义。
- 只有角色/场景文字设定。
- 只有 planned metadata。

如果下一阶段依赖尚未持久化的媒体，而当前只有 queued/running 任务，必须等待结果；等待失败就显式报告失败，不得把“已提交”说成“已生成”。

## Image Readiness Gate Before Video

进入视频生成前，只执行技术就绪检查，不执行自动视觉评审：

- 每个 clip 所需的故事板、角色图、场景 Base 图和关键道具图都必须有稳定节点 ID，并达到 `status=success`、`persisted=true`。
- 依赖节点为 `queued` / `running` 时先等待；`failed` / `error` 时阻止对应 clip 并报告真实失败原因。
- 所有依赖达到 `success` 且 `persisted=true` 后直接进入 Phase 4，不等待任何评审报告，也不生成质量 verdict。
- 只有用户明确要求逐阶段人工确认时才调用 `ask_user` 暂停；自主运行默认继续。

## Script Normalization Gate

只有“标准分镜剧本”才算 Phase 1 完成。用户给出的剧情分段、15s 分段版、小说片段、口述剧情、带对白的段落大纲，都不自动等同于标准分镜剧本。

标准分镜剧本必须至少包含：

- `Basic Info`
- `Characters`
- `Fixed Scenes`
- `Script` / Shot 表，且每个 Shot 有时间段、Visual、Dialogue、Audio、Emotional Beat
- `Production Notes` 或 `Medium Lock`
- 角色卡与场景 Base 生成计划
- 视频片段生成计划，逐 Clip 对应时间段、角色 ref、场景 ref、关键内容

不算标准分镜剧本：

- 只有“第1段/第2段/第3段/第4段”的剧情分段。
- 只有 `0-15s / 15-30s` 时间段和对白。
- 只有故事梗概、章节正文或广告创意。
- 只有画布里的 text 节点，但内容缺少 Characters / Fixed Scenes / Script 表 / 资产计划 / 视频计划。

如果用户目标是生成视频，而输入只是 15s 分段剧情，必须先使用 `storyboard-script-writer` 把它标准化为完整 Markdown 分镜剧本，再进入 Phase 2。不得直接把分段剧情交给故事板 skill。

## Persisted Asset Gate Before Storyboard

进入 Phase 3 前，必须从标准分镜剧本和视频片段生成计划中列出本轮要用的角色与场景：

```json
{
  "requiredCharacters": [
    { "refId": "CH-01", "label": "角色名", "neededByClips": ["Clip 1"] }
  ],
  "requiredScenes": [
    { "refId": "BG-01", "label": "场景名", "neededByClips": ["Clip 1"] }
  ]
}
```

然后读取真实画布状态，验证每个必要角色与场景都有稳定节点 ID，并达到 `status=success`、`persisted=true`。

只要任一必要角色或场景缺稳定节点 ID，或未持久化完成：

- 禁止调用 `storyboard-image-production` 故事板阶段。
- 必须先运行 Phase 2，使用 `storyboard-visual-assets` 生成缺失角色/场景资产。
- 若资产生成返回 pending，必须等待到 `status=success`、`persisted=true`，或报告失败。

故事板的参考图闭集只能从这些已验证节点中选择。Agent 只传按语义顺序排列的 `sourceNodeId`（必要时传 `assetId`）；不得读取、复制或传递内部媒体 URL。后端在每次供应商调用前把 ID 解析为该节点当前资产的最新持久化 URL。只有节点存在、prompt、anchorBindings、连线、taskId 或 queued/running 状态都不能替代持久化完成证据。

## Phase 0: State Intake

先判断当前处在哪个阶段，而不是直接调用视频工具。

必须收集：

- 用户目标：只要计划、生成分镜、生成资产、生成视频 clip，还是最终成片。
- 当前输入类型：剧情、分镜剧本、视觉资产、故事板、视频 clip。
- 当前画布状态：已有节点 ID、媒体类型、`status`、`persisted`、任务状态和失败信息。
- 目标总时长、画幅、声音需求、是否需要拼接。
- 已确认角色、场景、故事板与 clip 的对应关系。
- 输入文本是否满足 Script Normalization Gate；不要把 15s 分段剧情误判为标准分镜剧本。
- 进入故事板前是否满足 Persisted Asset Gate Before Storyboard。

若画布上下文存在，实际状态以当前画布读取工具结果为准；不要只凭对话历史判断。画布很大或需要多节点盘点时，优先委派 `explore` sub-agent 做事实收集；主代理只保留决策所需的最小摘要。

## Phase 1: Plot -> Storyboard Script

如果当前只有剧情、梗概、小说片段、广告创意或口述想法，不能直接生成视频。

如果当前输入是“15s 分段版剧情”或已经分成 0-15s / 15-30s 等段落，但不满足 Script Normalization Gate，也仍然视为剧情输入，必须先标准化成完整分镜剧本。

下一步：

- 派发一个脚本标准化 `plan` 任务；由它根据当前阶段自主加载 `storyboard-script-writer` 并生成完整 Markdown 分镜剧本，主代理不代写脚本方法论。
- 剧本必须包含角色、固定场景、按时间轴拆分的 Shot / Clip、对白/旁白/声音信息、Production Notes、视频片段生成计划。
- 若用户要求落画布，应把完整剧本写入 `storyboardScript` 或 text 类节点。

完成标准：

- 用户可见完整剧本正文，不能只回复“已完成”。
- 或画布中存在承载完整标准分镜剧本的节点。
- 剧本中每个 clip 的时间段、角色、场景和关键内容可被后续阶段引用。

若用户最终目标是视频，Phase 1 完成后必须继续进入 Phase 2；不得把剧本节点写入画布后结束。

## Phase 2: Script -> Character And Scene Assets

如果已有分镜剧本，但缺少必要角色图或场景 Base 图，不能进入故事板或视频生成。

这里的“已有分镜剧本”必须满足 Script Normalization Gate；否则回到 Phase 1。

下一步：

- 派发一个 `visual_assets_generation` phase 给 `media`；由它根据当前阶段自主加载 `storyboard-visual-assets`，从剧本提取角色、场景与必要道具并完成生成和 wait。
- 生成主要角色定妆图。
- 生成主要场景 Base 图；场景 Base 必须是纯环境图。
- 关键道具图是可选增强，除非用户明确要求或后续故事板必须引用。

完成标准：

- 每个必要角色都有稳定节点 ID，且 `status=success`、`persisted=true`。
- 每个必要场景都有稳定节点 ID，且 `status=success`、`persisted=true`。
- 只有资产节点、prompt、taskId 或 queued/running 状态不算完成。

若用户最终目标是视频，Phase 2 完成后必须继续进入 Phase 3；不得把角色/场景图完成当成长视频交付。

## Phase 3: Assets + Script -> Storyboard

如果已有角色/场景图片，但没有每个 clip 对应的故事板，不能生成视频。

进入本阶段前必须先通过 Persisted Asset Gate Before Storyboard。若没有逐项列出 requiredCharacters / requiredScenes 并验证稳定节点 ID 与持久化完成状态，本阶段不能开始。

下一步：

- 派发一个 `storyboard_generation` phase 给 `media`；由它根据当前阶段自主加载 `storyboard-image-production`。下游用途写明 `storyboard_for_video`；这只说明故事板将供对应 clip 生成视频，不改变黑金完整故事板的交付形态，也不能引入视频阶段的无标题、无镜号、无台词栏约束。
- 按剧本节拍拆 clip；默认每个视频 clip 不超过当前视频模型可执行上限。
- 当前 Seedance2 单段视频按当前 harness 的有效参数执行，常用范围为 4..15 秒；不要把长视频一次性塞进单个视频节点。
- 每个 clip 生成一张完整黑金故事板图板；clip 内的进入、转折、离开等镜头节拍组成该图板的多个分镜格，默认不拆成独立 keyframe 或干净单帧节点。
- 故事板的参考图闭集只包含本段实际需要的角色图和场景 Base 图；不要机械引用上一张故事板。
- 多个互不依赖的 clip 默认 fan-out 并行提交图片任务。
- **稳定输出身份**：fan-out 提交故事板必须使用稳定输出 key，每个 clip 命名 `storyboard_clip_<n:02d>_<slug>`。同一输出 key 重提应更新原目标，避免重复节点。
- **fan-out 前 precheck**：先读取真实画布状态。已有稳定节点且 `status=success`、`persisted=true` 的 clip 跳过；`status=error` 或持久化未完成的对**同一输出 key**恢复/重提；只对完全不存在的稳定输出 key 派发新 generate。
- 若图片任务返回 pending，必须等待到 `status=success`、`persisted=true` 后再进入视频阶段。

完成标准：

- 每个 clip 绑定一个完整故事板节点。
- 每个绑定节点都是黑金多格故事板图板，并有稳定节点 ID，且 `status=success`、`persisted=true`。

若用户最终目标是视频，Phase 3 完成后必须继续进入 Phase 4；不得把故事板完成当成长视频交付。

## Phase 4: Storyboard -> Video Clips

只有当每个 clip 都有持久化完成的故事板节点后，才能生成视频。

视频输入规则：

- 视频节点的图像参考只传对应 clip 的故事板 `sourceNodeId`；Agent 不传内部 URL，后端在供应商调用前解析该节点当前资产的最新持久化 URL。
- 角色图、场景 Base、道具图等上游素材只用于生成故事板，不再直接加入视频生成的参考图数组；角色、场景和道具一致性应先折叠进故事板。
- 视频 prompt 必须明确故事板只提供主体、场景、动作、镜头顺序与运动意图，禁止把标题、镜号、时间码、caption、分格边框、箭头、UI 和 Technical & Production 版式复制进视频画面。
- 视频 prompt 必须写入 `prompt` 本体；对白、旁白、声音、动作、镜头运动和禁止项不能只放在备注里。

执行顺序：

1. 主代理派发一个 `video_clip_generation` phase 给 `media`；由它根据当前阶段自主加载 `canvas-video-prompting`，只有本阶段才应用视频画面不复制故事板版式的规则。
2. 为每个 clip 构造视频节点。视频节点必须使用稳定输出 key（命名 `video_clip_<n:02d>_<slug>`），同一输出 key 重提应更新原目标，避免重复节点。
3. **fan-out 前 precheck**：先读取真实画布。已有稳定节点且 `status=success`、`persisted=true` 的 clip 跳过；`status=error` 或持久化未完成的对**同一输出 key**恢复/重提；仅对完全不存在的稳定输出 key 派发新 generate。
4. 所有 clip 的故事板节点持久化完成后，fan-out 提交全部视频任务；每个 clip 只绑定自己的故事板 `sourceNodeId`。
5. 全部提交完成后，再统一 wait 收集各 clip 结果。跨 clip 衔接意图由剧本、故事板和视频 prompt 承载，不向下游 clip 参考图数组追加上一段尾帧或任何上游素材。

禁止：

- 对没有真实依赖的 clip 使用 `提交 Clip 1 -> 等 Clip 1 完成 -> 再提交 Clip 2` 的无意义串行模式。
- 某个 clip 的故事板节点未达到 `status=success`、`persisted=true` 时继续生成视频。
- 视频生成失败后换模型或换供应商静默重试。

完成标准：

- 每个 clip 都有稳定视频节点 ID，且 `status=success`、`persisted=true`。
- 若任一 clip 失败，必须报告具体 clip、nodeId、失败原因，并保留已成功 clip。

## Phase 5: Aggregate And Concatenate

如果用户只要求视频片段，汇总每个 clip 的 `nodeId`、`status` 和 `persisted` 即可。

如果用户要求完整成片：

- 只有所有待拼接 clip 都有稳定节点 ID，且 `status=success`、`persisted=true` 后才能进入拼接；拼接输入只传有序 `sourceNodeIds`。
- 主代理派发一个独立 `video_concat` phase 给 `media`；该 phase 只拼接并等待最终节点终态，不重新生成 clip，也不加载上游生产 Skill。
- 任一 clip 缺失或失败时，不得伪造完整成片。
- 已成功 clip 必须保留并列出。
- 拼接后以最终视频节点的稳定 ID、`status=success`、`persisted=true` 作为完成证据。

如果用户要求质量确认：

- 只对已有稳定节点 ID 且持久化完成的节点做评估；视觉读取由 harness 内部完成，不把 URL 暴露给 Agent。
- 缺媒体时不要先评估再生成。

## Stage Decision Table

| 当前真实证据 | 下一步 |
|---|---|
| 只有剧情 / 梗概 / 小说片段 / 15s 分段剧情 / 非标准剧本文本 | 生成标准分镜剧本 |
| 有标准分镜剧本，角色/场景节点缺失或未持久化完成 | 生成角色图与场景 Base 图 |
| 角色/场景节点已持久化完成，故事板节点缺失或未持久化完成 | 生成每个 clip 的黑金完整故事板 |
| 故事板节点已持久化完成，视频节点缺失或未持久化完成 | 仅以对应故事板 `sourceNodeId` 生成视频 clip |
| 所有 clip 节点均持久化完成，用户要求成片 | 按有序 `sourceNodeIds` 拼接/汇总 |
| 用户只要求计划或提示词 | 输出计划或 prompt，不调用生成工具 |

使用方式：

1. 先按用户目标确定最终完成标准。
2. 再按当前真实证据选择下一步。
3. 完成下一步后回到本表重新判断。
4. 只有最终完成标准满足时，才能结束。

## Runtime Progress Reconciliation

运行进度的事实来源是稳定 output key、phase task、画布节点的 `nodeId/assetId/status/persisted/taskId`、素材引用关系和拼接源 ID 顺序。每次 phase 返回后重新读取这些事实即可恢复进度；内部媒体 URL 不是 Agent 状态源。

内部资产对账、prompt 草稿和 phase brief 默认只存在于当前执行上下文，不创建 `manifest_*`、`storyboard_brief_*` 或类似 text 节点。只有用户明确要求查看生产清单或调试报告时，才把派生摘要写成用户可见交付物；该摘要不是工作流的状态源。

## Canvas Execution Rules

有 `canvasFlowId` 或用户显然在画布中工作时：

- 画布读写、图片生成、视频生成和等待结果都遵循当前 harness 暴露的 canvas tool schema。
- 若当前阶段需要继续下游，必须用能拿到真实结果的生成/等待链路，不能只创建 queued 节点后宣称完成。
- 普通结构性画布编辑使用窄语义工具，不用于创建可执行图片/故事板/视频节点交给宿主 auto-run。
- 图片、故事板、视频和拼接由当前 phase 的 `media` 通过 direct generate/concat 工具提交；`media` 必须等待目标节点达到 `status=success`、`persisted=true`。
- 多 clip 图片和视频都由同一个 phase `media` 执行；故事板与视频任务在各自前置节点持久化完成后 fan-out 提交并 wait。

节点数据要求：

- 图片 / 故事板节点应有清晰 label、稳定顺序、prompt、画幅意图和必要资产身份说明；调用工具时只使用当前 schema 支持的字段。
- 视频节点必须通过 `sourceNodeId` 引用对应故事板；视频参考数组只包含该故事板节点 ID，不包含上游角色、场景或道具素材，也不包含任何内部 URL。引用方式以当前 canvas tool schema 为准。
- 资产职责说明应写入 prompt / label / 生产清单，不新增未暴露的工具参数。

## User Intent Handling

根据用户目标决定停止点：

- “帮我分析 / 规划长视频流程” -> 输出阶段计划和缺口，不调用生成工具。
- “基于这个剧情生成长视频” -> 从 Phase 1 开始推进，不能跳到视频。
- “基于这个剧情生成视频” -> 从 Phase 1 开始，完成剧本后继续资产、故事板、视频 clip；不能在 storyboardScript 阶段收口。
- “基于这个 15s 分段版生成视频” -> 仍然从 Phase 1 开始，先标准化完整分镜剧本；不能把分段剧情直接当成故事板输入。
- “生成视频”且当前只有剧本 -> 从 Phase 2 开始，补齐角色/场景资产后继续故事板和视频。
- “这些故事板继续生成视频” -> 从 Phase 4 开始，但先确认每个故事板都有稳定节点 ID，且 `status=success`、`persisted=true`。
- “只生成视频提示词” -> 用 `canvas-video-prompting` 输出 prompt，不创建视频节点。
- “先提交，之后我自己看结果” -> 可以在 pending handoff 后结束，但必须说清仍是 queued/running，不说已生成。

## Failure Policy

失败必须停在真实阶段：

- 缺剧本：说明需要先生成分镜剧本。
- 缺角色/场景图：说明需要先生成视觉资产。
- 缺故事板稳定节点 ID或故事板未持久化完成：说明不能生成视频，并列出缺失 clip。
- 视频 wait 失败：报告失败 task/node 和上游错误，不重试掩盖。
- 拼接前 clip 节点缺失或未持久化完成：保留已完成 clip，报告未完成 clip，不生成假成片。

禁止把“工具调用 succeeded”“节点已创建”“checklist 完成”直接当作长视频完成证据。完成证据只能来自稳定节点映射、`status=success`、`persisted=true` 与引用/拼接顺序对齐。

## Final Response Contract

最终回复必须说明：

- 用户本轮目标和对应完成标准。
- 当前完成到哪个 phase。
- 已生成或已提交的 clip 清单。
- 每个 clip 的 `nodeId`、`assetId`（如有）、`status` 与 `persisted` 状态。
- 若未完成，具体阻塞在哪个阶段和哪个 clip。
- 下一步应该执行什么。

如果用户要求长视频成片，但当前只完成到故事板或视频 clip，不能说“长视频已完成”。
