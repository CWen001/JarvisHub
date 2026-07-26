---
name: canvas-workflow-orchestrator
description: 基于真实项目状态、节点上下文与章节证据，为 JarvisHub 生成下一步画布编排决策；不依赖 docs、assets 或 ai-metadata。
---

# JarvisHub Workflow Orchestrator

## 何时使用

- 用户要在 JarvisHub 中规划多步创作流程，而不是单次问答
- 用户要把结果落到画布，或要求返回可执行的 `<canvas_canvas_plan>`
- 用户要求续写当前镜头、修复当前节点、围绕选中节点继续推进

## 输入证据

- 当前用户请求
- 当前项目/flow/node 的实时工具结果
- 章节正文、章节索引、连续性、素材、节点 bundle 等实时数据
- 已显式提供的内部参考节点 ID、外部 referenceImages、selectedReference、continuationAnchor

禁止把以下内容当成运行时知识源：

- `docs/`
- `assets/`
- `ai-metadata/`

这些目录可以存在于仓库中，但不属于本 skill 的运行时证据。

## 执行原则

- 先取证，再决策；不要猜项目状态
- 主代理自行意图识别，不使用本地固定 route
- 本 skill 提供方法，不接管全局流程
- 对项目化创作，优先结合 project/node/source bundle 证据定位最相关正文、场景锚点与续写边界；不要等待用户手动补齐所有 checkpoint
- 优先通过当前可用的 source bundle / node bundle / flow 证据判断生成、规划或画布改动
- 若任务需要图片/视频最终提示词，可按需调用 specialist；是否调用、调用顺序如何安排，由主代理决定
- 若用户目标是布局调整，只做结构调整，不改内容语义字段
- 若用户目标是显式、确定性的画布改动，且当前 flow 作用域与目标节点足够明确，优先调用当前可用的窄语义画布工具，而不是输出笼统计划或走 internal/debug patch。
- 窄语义结构编辑工具只用于确定性结构编辑：文本节点、分组、连线、引用绑定、删除节点/边、更新已有节点字段。不要用结构编辑创建 `image` / `imageEdit` / `video` / `composeVideo` 这类可执行媒体节点来触发宿主 auto-run
- 若用户目标是生成图片、故事板图、角色图、场景图或视频，使用当前媒体生成能力。需要成品或下游依赖时等待目标节点达到 `status=success`、`persisted=true`。
- 媒体节点未持久化完成时不要同轮立刻评审。评审只传稳定节点 ID，由 harness 内部读取媒体；有可等待任务时先等待，没有可等待任务时显式报告持久化媒体缺失。
- 删除错误节点或连线时传真实 id；不要假装把节点“清空”。删节点会自动清理相关边。
- 创建节点后还要连线时，先取得创建工具返回的真实 id；不要把 `label` 当成 `source/target`。
- 创建分组或调整组内结构时，使用当前分组工具表达“新建空组”或“把已有节点原子入组”的业务意图；后端按工具结果和 flow graph diff 记录真实副作用。
- 若目标是“镜头拆解/镜头图片脚本/shot list/beat list”且当前还没有镜头图，不要创建 `kind=image sequence` 节点；这类文本上游应落到 `kind=text`
- `kind=image sequence` 只用于镜头图片编辑图片网格；除非你显式提供 `imageCells`，或用户明确要一个空白镜头图片板占位，否则把文本塞进 `image sequence` 视为错误建模
- 若用户明确要求“优化当前图片节点/当前图像节点/这个图片节点”的提示词，且当前选中节点是 `kind=image` / `imageEdit`，优先把它视为“改写既有节点配置”而不是“新建另一条生成链”
- 做图片节点提示词优化前，先读取 `canvas_node_context_bundle_get`，确认当前节点的 `prompt/systemPrompt/negativePrompt`、结果图、参考图、上下游和 diagnostics；若节点已有结果图但提示词缺失，可把结果图当作取证输入，再决定是否需要 specialist
- 对既有图片节点的提示词改写，优先回写原节点；若要覆盖已有提示词字段，必须显式表达要覆盖的业务字段。
- 除非用户明确要求改比例、样张数或分叉新版本，否则图片节点提示词优化默认保留原有执行参数，只改与提示词直接相关的字段；agent 不决定模型，不要在 patch 里写入任何当前 schema 未暴露的模型 / 厂商选择字段。
- 若目标是添加 `kind=text` 节点，允许创建空内容占位节点；不要因为缺少 `prompt` / `text` 而阻止写入
- 若目标是添加空白文本节点，使用当前文本节点工具；空占位时不强行补业务内容。
- 只有在需要批量规划、多节点布局、前端补位执行或当前写入证据不足时，才退回输出合法 `<canvas_canvas_plan>`
- 若证据不足，显式报错；不要编造、不要静默降级

## 输出契约

- 若目标是问答：输出基于证据的自然语言答案
- 若目标是画布规划：输出合法 `<canvas_canvas_plan>`
- 若 `<canvas_canvas_plan>` 中包含 `kind=composeVideo|video` 节点，必须在 `nodes[].config` 中写入可执行 `prompt`；`prompt` 必须是最终生产提示词本体，运行时会继续拼接连入文本节点内容，不要再额外输出平行的 `videoPrompt`。若还想保留拍点拆解，可选写 `storyBeatPlan`，但它不参与实际生成调用
- 若目标是确定性画布执行：优先直接写入画布，并如实说明已执行结果
- 若目标是章节资产补齐或媒体生成：必须通过 direct generate 工具真实提交生成；若需要完成资产，等待 `status=success`、`persisted=true` 后再声明完成
- 若目标是生成：直接使用媒体生成工具写入画布，不要退回到结构编辑工具创建待执行媒体节点
- 若无法继续：清楚列出缺失证据与阻塞原因
