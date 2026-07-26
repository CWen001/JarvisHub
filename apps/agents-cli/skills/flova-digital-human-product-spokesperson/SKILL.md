---
name: flova-digital-human-product-spokesperson
description: "Use when 用户要基于产品图、商品卖点、数字人形象或口播脚本生成数字人商品口播、带货解说、产品介绍短视频、头像口型同步视频或单场景商品讲解。"
---

# Digital Human Product Spokesperson

## Mission

用于数字人商品口播：锁定产品、数字人、单一场景、口播脚本和关键帧，再按 JarvisHub canvas harness 的实际工具列表生成可验证的图片、视频或待合成资产；音频只在本轮工具明确支持时生成真实 URL。

运行边界：主 Agent 负责编排、读画布、写文本节点、资产账本和阶段决策；媒体生成、等待和拼接必须交给 `media` sub-agent；真实评审必须交给 `critic` sub-agent。若当前工具集中没有音频驱动口型同步视频能力，不得声称已完成精准 lip sync，只能交付关键帧、旁白音频、视频 prompt、普通图生视频 clip 或待后期合成资产。

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## Harness Boundary

- `explore`：读取用户产品图、肖像/数字人参考、脚本、已有画布资产和真实 URL。
- `plan`：产出规格、口播脚本、镜头/音频分段、关键帧要求和能力缺口。
- `media`：生成数字人图、产品图、合成关键帧和视频 clip，并等待真实 URL；旁白/BGM 只在本轮工具明确提供音频生成时执行，否则保留为音轨计划。
- `critic`：检查人物一致性、产品可读性、口播节奏、音画对应和能力声明是否真实。

若用户要求多个场景、多段剧情或完整长片，先加载 `canvas-long-video-production`。此流程只处理“数字人 + 产品 + 单一口播场景”的高一致性短视频。

## Intake

先确认：

1. 画幅，默认 `9:16`；可选 `16:9`。
2. 时长，默认 15-30 秒；更长需要分段。
3. 数字人来源：用户肖像/全身参考、已有角色图、或从描述生成。
4. 产品来源：真实产品图优先；无产品图时只能生成演示产品，并明确可替换。
5. 口播来源：用户脚本、产品卖点自动改写、或先让 agent 写脚本。
6. 语言和语气：跟随用户输入，或明确普通话/英文/方言等。

必要证据：

- 产品真实图片 URL，或用户明确接受“演示产品”。
- 数字人参考或清晰形象设定。
- 可分段的口播文本。

缺产品图时，不能承诺真实商品一致性。缺音频驱动视频工具时，不能承诺 lip sync。

## Core Constraints

数字人口播不是多机位广告片。默认规则：

- 一个主场景，不随脚本切换背景。
- 一个主构图，优先 MCU / bust shot，脸部和产品都清楚。
- 一个关键帧或同一 asset id 反复使用，避免人物漂移。
- 不为了节奏变化增加多镜头；只有音频过长时才按完整句子拆段。
- 产品必须清晰可读，不能被手、字幕或背景遮挡。

如果用户要求多机位、剧情切换或复杂产品展示，转交 `creative-video-production` 或 `canvas-long-video-production`。

## Production Flow

### Phase 1: Script And Timing

先把产品卖点写成口播脚本：

- 每句对应一个完整语义，不按固定秒数硬切。
- 15 秒建议 40-60 中文字。
- 30 秒建议 90-140 中文字。
- 60 秒以上建议分段生成，逐段确认。
- 每段标注语气：friendly, confident, natural presenter, clear articulation。

若用户已有脚本，只做长度、句读和卖点顺序优化，不改事实。

### Phase 2: Key Elements

生成或绑定：

- `Digital_Avatar`：数字人头像/半身参考，面部清晰、肤色自然、无重度美颜。
- `Product_Asset`：产品包装/单品/SKU，logo、形状、颜色和关键文字可读。
- `Scene_Base`：固定口播场景，如居家、办公室、书店、健身房或品牌纯色背景。

用户提供的肖像或产品图必须作为最高优先级参考；生成图只能补足构图和光线，不得改掉可识别特征。

### Phase 3: Composite Keyframe

创建一张合成关键帧：

- 数字人中近景或胸像，脸部占比足够大。
- 产品在手中、桌面前景或画面侧前方，必须清晰可读。
- 场景干净，光线自然，智能手机/前置摄像头式真实摄影感。
- 构图稳定，适合后续口播视频；避免广角全身远景。

关键帧通过 critic 后再进入视频阶段。缺真实关键帧 URL 时不要生成视频。

### Phase 4: Audio

当前已知 canvas 工具集不含通用音频生成。只有本轮工具列表额外提供音频能力时，才可生成：

- `Narration_Audio`：按脚本分段，声音性别/年龄/语气按用户要求。
- `BGM`：轻量背景音乐，低存在感，不抢人声。

旁白脚本或用户上传音频是音频事实来源。若没有真实 audio URL 或后续视频工具不能直接使用音频驱动，只能把旁白作为后期合成计划，不能声称完成音频驱动口播。

### Phase 5: Video

根据当前工具能力选择路径：

| 能力 | 可交付 |
| --- | --- |
| 本轮工具支持音频驱动视频 | 关键帧 + 真实 audio URL 生成口播视频，等待真实 `videoUrl` |
| 只支持图生视频 | 生成普通口播感 clip，但必须说明不是精确 lip sync |
| 只支持图片/文本计划 | 交付关键帧、旁白脚本、视频 prompt 和后期合成计划 |

视频 prompt 必须描述：

- 说话状态：clear articulation, speaking to camera, natural presenter。
- 表情：friendly, confident, calm, believable。
- 身体动作：small hand gestures, holding product steadily, subtle head nods。
- 镜头：static or very subtle handheld, MCU/bust shot。
- 禁止：no scene change, no camera angle change, no product deformation, no extra text overlay, no watermark。

## Prompt Rules

图像 prompt 写可见事实，不写角色内心：

- 数字人：年龄段、脸型、发型、肤色、服装、气质、自然皮肤纹理。
- 产品：包装形状、颜色、logo 位置、尺寸比例、材质和持握方式。
- 场景：固定背景、光线方向、色温、简洁程度。

视频 prompt 写动态变化，不重复大段静态描述：

- 角色如何说话。
- 嘴部、眼神、头部和手部如何轻微运动。
- 产品如何稳定保持在画面中。
- 背景保持不变。

若用户中文输入，prompt 主体用中文；旁白文本严格使用用户指定语言。

## Review Checklist

critic 必须检查：

- 数字人是否同一人，脸部是否变形。
- 产品是否清楚、比例合理、无 logo/包装漂移。
- 单场景和单构图是否保持稳定。
- 口播节奏是否完整句切分，不在句中断开。
- 若宣称 lip sync，是否确实使用了音频驱动工具和真实结果。
- 是否误加字幕、水印、无关文字或额外产品。

P0 问题只重试对应阶段：产品不清楚先重做关键帧；人物漂移先重做数字人锚点；口型不同步则回到音频驱动路径，不靠 prompt 硬修。

## Output Contract

根据阶段输出其一：

- `spec`：比例、时长、语言、数字人来源、产品来源、脚本来源。
- `scriptTimeline`：分句口播文本、时长估计、音频分段。
- `elementResults`：数字人、产品、场景真实 `imageUrl`。
- `keyframeResult`：合成关键帧真实 `imageUrl`。
- `audioResults`：仅在本轮有音频工具时记录旁白/BGM 真实 URL；否则记录音轨计划和不可用说明。
- `videoResults`：真实 `videoUrl`，并标明是否为音频驱动口型同步。
- `blocked`：缺少的真实输入或本轮工具列表不支持的能力。

不得把普通图生视频包装成精准口型同步结果。不得把 queued/running、只有 taskId、只有节点存在说成已完成。
