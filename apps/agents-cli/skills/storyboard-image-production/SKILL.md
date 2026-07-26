---
name: storyboard-image-production
description: "Use when 用户明确要把已有剧本、分镜剧本、shot list、storyboard brief 或已准备素材组合成故事板图板、分镜图板、storyboard board、panel board、单张/多张镜头图板，或只要可复制的故事板生图提示词；交付物是一张或多张故事板图片，不负责从剧本生成角色/场景/道具素材。"
---

# Storyboard Image Production

## Purpose

把已有剧本、分镜、角色、场景、台词、时长或视觉资产，整理并执行为可生产的故事板图板。用户要求“生成 / 出图 / 做故事板”时，必须推动 JarvisHub 画布生成真实图片节点；提示词、资产锚点表和对账清单是内部依据。

## Boundaries

- 粗略剧情、小说片段、一句话创意：先用 `storyboard-script-writer` 标准化为分镜剧本。
- 缺角色定妆图、场景 Base 或关键视觉资产：先用 `storyboard-visual-assets` 补齐。
- 长视频、完整短片、多 clip 成片：由 `canvas-long-video-production` 编排；本 skill 只负责故事板图阶段。
- 单段视频提示词：用 `canvas-video-prompting`。
- 复刻已有构图或替换主体：结合 `canvas-replicate`。

用户明确要求“生成分镜图 / 故事板 / 单张分镜图板”，且不是长视频总控任务时，可以独立使用本 skill。

## Default Deliverable

故事板的默认交付物是一张完整的黑金电影制片图板，包含 Header、Character、Storyboard 和 Technical & Production 等模块。故事板后续用于视频生成时，仍使用这张完整图板，不把它替换成无文字单帧、keyframe 或额外的干净参考帧。

用户明确要“关键帧 / 干净单帧 / 每镜头单独一张”时，应转入对应的 keyframe 或单图生成任务；不要在默认故事板流程中隐式改变交付物。

## Execution

当用户要求直接生成图片：

- 主 Agent 只判断当前是否进入故事板 phase，并向 media sub-agent 提供剧本/素材上下文节点、稳定目标节点、下游用途、用户原始硬约束和完成证据；不编写最终 prompt、故事板 brief 或运行用 manifest。
- media sub-agent 读取当前 phase 的真实画布范围并加载本 Skill，在内部建立资产锚点、故事板 brief、参考图选择和最终 image prompt；这些内部数据默认不创建 text 节点。
- media sub-agent 只完成当前故事板 phase：按稳定 output key 调用图像生成工具，等待所有目标达到 `status=success`、`persisted=true` 后返回，不自行进入视频生成阶段。
- 每个画布图片节点代表 1 张完整故事板图板。一个 clip 内的多个镜头默认组成同一张多格图板，不拆成一组干净单帧节点。
- 只有图片节点已达到成功持久化终态时，才能汇报“已生成”；只有 taskId 或 queued/running 状态时，只汇报“已提交 / 生成中”。
- 用户只要“提示词”时，输出可复制提示词结构并写入画布文本节点；不派发图片生成。

## Canvas Contract

工具 schema 是事实来源；本 skill 只规定故事板生成意图，不维护低层参数表。调用图像生成工具时表达这些语义即可：

- 稳定目标身份、用户可读标题和故事板用途。
- 完整故事板 image prompt、画幅意图和分辨率意图。
- 真实参考素材清单：稳定 `sourceNodeId`/`assetId`、语义角色、顺序和可读名称；内部 URL 不进入 Agent 参数。
- 每张故事板最多选择 3 个真实参考节点。优先级为：核心主体/角色、主场景/背景、当前剧情最关键的第二主体或道具。其余素材只写入 prompt 的资产锚点或 source evidence，不放入参考图输入。
- 上游证据：剧本、素材账本、提示词节点或用户指定素材。
- 与本任务高相关的失败规避点。

运行时负责把这些语义投影成内部 canvas 节点数据、引用、绑定和自动连线。不要让 skill 复刻内部节点结构、旧字段别名、模型/厂商字段或 adapter 细节。

不要把 taskId、queued/running 状态、节点 label 或文字设定当成可用素材。可用素材必须是已成功持久化的节点；URL 由 Harness/Hono 根据稳定 ID 在执行时解析。

## Input Check

先提取并锁定：

- 剧情段落、场次、镜头顺序、起止秒数。
- 角色身份、外观、服装、表情变化、站位和移动路径。
- 场景空间、时间、天气、光源、主要背景元素。
- 台词、旁白、字幕、环境音提示。
- 关键道具、UI、标识、文字符号。
- 用户指定的画幅、分辨率、风格、切分方式和交付形式。
- 已有角色、场景、道具素材的稳定来源 nodeId/assetId 和持久化成功状态。

不要遗漏用户原文硬信息。可合理补全的细节直接补全；只有题材、角色关系或最终用途不清会明显改变成品时，才问一个简短问题。

## Asset Ledger

生成前建立资产锚点表，用于所有图板和 Part：

- 项目风格和质感。
- 角色 `CH-01 / CH-02`：外观、服装、配饰、特殊标记、来源 nodeId/assetId、持久化状态。
- 场景 `BG-01 / BG-02`：空间结构、门窗位置、家具、地标、材质、时间、天气、来源 nodeId/assetId、持久化状态。
- 道具 `PR-01 / PR-02`：尺寸、材质、颜色、磨损、发光方式、文字或符号位置、来源 nodeId/assetId、持久化状态（若已有）。
- 色彩 `CP-01 / CP-02`：主色、辅助色、情绪功能。
- 空间锚点 `A / B / C / D / E`：门、窗、沙发、桌面、走廊、车辆、祭坛等固定点。
- 镜头轴线、主光方向、角色移动路径。

跨图板允许变化的是动作、表情、景别、光线强弱、角色位置推进和剧情状态；不要漂移身份、服装、道具款式、空间左右关系和固定锚点。

## Scene And Part Rules

- 默认按“场 / clip”出图：一场或一个 clip 生成一张完整故事板图板，多场或多 clip 生成多张；一个 clip 内的多个镜头合成在同一张图板中。
- 用户明确要求“每镜头一张 / 每分镜一张 / 每 10 秒一张”时，按用户指定的单位切分。
- 超过 15 秒的内容切成连续 `Part 1 / Part 2 / Part 3`；每个 Part 继承同一套角色、场景、道具、光线和空间锚点。
- 多 Part 没有真实图片依赖时可以并行派发；明确依赖上一 Part 节点时，等待上一 Part 成功持久化后，以其 `sourceNodeId` 生成下一 Part。

## Storyboard Board Layout

默认图板结构：

1. Header：场次名称、核心情境、场景标签、纯环境概念图。
2. Character：核心角色定妆或角色识别区，标注 CH 编号。
3. Storyboard：默认 2x3 六格；每格顶部短状态栏、中间画面、底部一句短 caption。
4. Technical & Production：机位运动、灯光色彩、关键道具、节奏曲线。

格数按镜头密度调整：6 镜头用 2x3，8 镜头用 2x4，10 镜头以上优先拆 Part。优先保证画面和短 caption 清晰；镜头细节写进 prompt 指导画面，不把每格文字扩成多行字段表。

## Storyboard Board Visual Style

除非用户明确指定其他图板包装风格，故事板外框固定为黑金电影制片图板；分镜格内部画面仍按真实素材、剧情场景和光线执行。

- 用户未指定时，默认 16:9、2K、四周保留安全边距；用户指定 4:3、竖屏、2K、4K 等参数时，以用户参数为准。
- 图板包装层固定使用深夜蓝黑底版 `#0B101A` 与暗金模块边框/强调色 `#BCA672`。这约束 storyboard board chrome、标题栏、模块边框、分隔线、镜号牌、标签、Technical & Production 区，不改变分镜格内部真实场景光线。
- 每次直接出图的 brief 和最终 image prompt 必须显式包含：`black-gold storyboard board chrome`、`deep navy black #0B101A board background`、`dark gold #BCA672 module borders`、`dark gold title bars and dividers`、`black-gold Technical & Production panel`。
- 字体意向：标题用宋体风格，正文/标签用黑体风格；中文镜号、时间码、台词栏清晰可读。
- Header 区约占图板上方 25% 高度，左侧为场次名称、核心情境、场景标签和纯环境宽图，右侧为核心角色识别区或角色定妆区。
- Storyboard 核心区默认 2x3 六格，格与格之间可用箭头串联。每格可见文字结构：顶部短状态栏 `S01 · 0-3s · 全景/甩出`，中间画面区，底部一句短 caption。
- Technical & Production 区放在底部，包含机位&运动、灯光&色彩、关键道具缩略图和节奏曲线。
- 节奏曲线提取约 5 个情绪波峰或叙事节点并标注秒数，例如 `0-2s 闯入 | 2-6s 对峙 | 6-8s 试探 | 8-12s 触动 | 12-15s 留钩`。
- 机位运动可使用远景、中近景、特写、大特写、半主观、低机位、俯视、微推、对切、轻摇、甩切、并行侧移、白闪、压黑。
- 灯光色彩写叙事功能，例如冷蓝压抑、暗红危险、淡银灵息破局、冷白 UI 审查感。
- 关键道具区提炼 1-3 个独立缩略图，呈现 PR 编号和名称标签；道具单体居中，避免人物、手、场景和杂物抢占。

## Header Background Rule

Header 场景图和独立背景资产必须是纯环境：只表达空间、光源、材质、天气、建筑、地形、色彩和氛围。Storyboard 分镜画面区可以按剧情出现人物、动物、怪物和道具；纯环境规则只约束 Header、背景图和场景 Base。

## Caption Rule

每个分镜格底部使用旧版简短 caption 栏，优先放用户给出的中文台词；无台词时放一句短旁白、短字幕或短环境音提示。

- 用户给出的台词优先保留关键一句，可压缩成单行但保持原意。
- 无台词镜头用一句短 caption 承接剧情，例如 `字幕：门猛地弹开`、`环境音：远处怪叫逼近`。
- 每格底部 caption 控制为一行，约 12-24 个中文字。
- 机位、运动、动作、情绪和音效作为画面生成依据写入 prompt；不要在每格下面展示“动作 / 情绪 / 台词 / 音效”多行字段标签。

## Shot Density

每个镜头同时承担信息任务和情绪任务。镜头描述至少包含景别、机位、镜头运动、视觉焦点、光影氛围、人物状态、动作结果和台词/旁白落点。

默认节奏：开场钩子、信息压缩、情绪转折、悬念留钩。最后一镜优先设计未解释的眼神、系统提示、转身、黑屏标题、无法打开的门或一句钩子台词。

## Prompt Shape

用户要“提示词”时，输出可复制的黑金故事板结构：

1. 资料汇总。
2. 资产锚点表：CH / BG / CP / PR / A-E。
3. Header 模块。
4. Character 模块。
5. Storyboard 模块：逐镜头、时间码、台词/旁白。
6. Technical & Production 模块。
7. 审美和一致性要求。
8. 失败规避点。
9. 可复制完整生图提示词。

用户要“直接生成”时，这些内容仅作为内部依据；不要创建提示词文本节点，最终交付必须包含图片节点或明确的提交状态。

## Failure Avoidance

最终 prompt 和 `negativePrompt` 只覆盖与本任务高相关的失败风险。优先处理：

- 角色身份、服装、发型、关键标志漂移。
- 场景镜像、门窗漂移、家具迁移、左右关系反转。
- 道具换款、颜色/大小/材质变化、文字或符号错位。
- Header 或背景资产混入主体、可读文字或非环境元素。
- 台词栏缺失、台词错位、中文乱码、底部道具区只有文字标签。
- 普通动物替代怪物、参考图身份漂移。
- 水印、logo、随机可读招牌、乱码文本、过度血腥、裸露器官、肢解。

空泛词必须绑定具体画面元素。“高级感、电影感、震撼、唯美”要落到机位、光源、材质、动作、色彩或情绪功能上。

## Phase Task Input And Internal Brief

主 Agent 派发故事板 phase 时只需提供：

- phase kind、剧本/素材 context node ids、稳定 target node ids 与目标数量。
- 下游用途（例如供对应 clip 生成视频，或独立故事板交付）、用户原始剧情范围、起止时间、clip 对应关系和明确的画幅、分辨率、交付形式。
- 完成证据：所有目标必须等待到 `status=success`、`persisted=true`；可用时记录 assetId。

运行本 Skill 的 media sub-agent 自己完成以下内部工作，不要求主 Agent预写：

- 从 scoped context 选择参考素材闭集：每张故事板最多 3 个真实参考节点，并记录 CH / BG / PR 职责、来源 nodeId/assetId 和严格顺序。
- 形成 Header、2x3/2x4、简洁分镜标注和 Technical & Production 的完整图板。
- 在最终 image prompt 中注入黑金图板包装短语。
- 按当前工具 schema 表达真实素材引用，fan-out 生成独立目标并对互不依赖的节点并行 wait。
- 返回输出 nodeId/assetId、status、persisted、taskId、使用的参考节点 ID 和最终 prompt；不要输出内部 URL。完成后立即停止，不进入下一 phase。

## Completion Reconcile

交付前必须回读画布对账：

- 目标故事板节点存在，key 与本轮计划一致。
- 若声称“已生成”，节点必须为成功持久化终态。
- 若只有 taskId 或 queued/running 状态，只能汇报 queued / generating。
- 本轮使用的参考 `sourceNodeId`/`assetId`、角色和顺序已持久化为该故事板的引用 provenance，未复制内部 URL。
- 已有素材来源能追溯到原节点或原资产；如画布暴露引用边，确认素材到故事板的边存在。
- 只有用户明确要求查看/交付提示词时才创建提示词文本节点；它应作为上游说明连接到目标图片节点，不能作为图片生成 target。内部 brief、资产对账和 prompt 草稿默认不落画布。

## Completion Criteria

交付前必须满足：

- 场数、Part 数和用户要求一致。
- 每个 Part 的剧情时间线连续。
- CH / BG / CP / PR / A-E 没有漂移。
- 每格都有台词、旁白、字幕或环境音提示，视觉节拍与原始时间线一致。
- Header / 背景资产保持纯环境。
- 关键道具外观和位置稳定。
- 体现 Header / Character / Storyboard / Technical & Production 的完整图板结构，并写入黑金图板包装短语。
- 最后一镜有明确叙事功能，不是空镜堆砌。
- 直接出图任务已区分 generated 与 queued，最终汇报不夸大状态。

## Priority

冲突时按顺序处理：

1. 用户原文硬信息。
2. 当前 JarvisHub 工具能力与 schema。
3. 用户指定切分单位、画幅、分辨率和交付形式。
4. 长视频总控边界。
5. 一场一图、超 15 秒切 Part。
6. 稳定 ID、持久化状态与素材引用完整性。
7. 资产锚点一致性。
8. 台词栏和关键剧情信息完整。
9. 黑金包装、纯环境 Header / 背景规则和完整图板布局。

口吻：制片美术指导 + 导演 + AIGC 视觉设计师，中文专业、清晰、可复制。
