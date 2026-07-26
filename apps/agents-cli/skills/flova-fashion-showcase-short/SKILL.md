---
name: flova-fashion-showcase-short
description: "Use when 用户要基于服装图片、刀版图、面料设定、模特形象或场景风格生成时装展示短片、走秀视频、买家秀街拍、服装六宫格分镜或单套服装 15 秒展示视频。"
---

# Fashion Showcase Short

## Mission

用于时装展示短片：从服装结构和面料物理出发，生成刀版图、模特服饰卡、场景图、六宫格分镜和 15 秒展示视频。

运行边界：真实生成、等待、读写和节点字段以JarvisHub canvas harness 暴露的 canvas tools 为准。

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## Harness Boundary

- `explore`：读取服装图、参考视频、模特图、已有画布资产和真实 URL。
- `plan`：锁定 Runway / Lifestyle 分支、生成轮次计划、六宫格 shot manifest。
- `media`：生成刀版图、模特服饰卡、空场景图、六宫格分镜、视频 clip，并等待真实 URL。
- `critic`：检查服装结构、面料还原、模特一致性、场景匹配、六宫格覆盖和视频服装漂移。

若用户要多套服装合辑、多个场景成片或 30s+ 拼接，先加载 `canvas-long-video-production` 做总控；此流程负责每个“单套服装 + 单场景 + 15s 视频”的创作单元。

## Intake

先确认：

1. 展示类型：`Runway` 秀场走秀，或 `Lifestyle` 买家秀/街拍。
2. 画幅：默认 `9:16`，可选 `16:9`。
3. 目标：只要刀版图、只要服饰卡、只要分镜，还是生成 15s 视频。
4. 服装来源：用户上传服装图/参考视频，或文字描述生成。
5. 模特来源：用户指定模特参考，或根据服装风格生成。
6. 场景来源：从候选中选，或用户自定义。

缺服装图时可先生成概念刀版，但必须说明不保证还原真实衣物。缺真实模特服饰卡或空场景图时，不进入视频阶段。

## Clothing Analysis

若用户上传服装图或视频，先提取：

- 款式与剪裁：廓形、领口、袖型、裙摆/裤型、结构线。
- 面料材质：丝绸、毛呢、皮革、纱、针织等；光泽、透明度、厚重感。
- 色彩图案：主色、辅色、纹样、饱和度。
- 动态物理：垂坠、摆动惯性、折射、褶皱、风中响应。

分析输出要能直接绑定到 `Garment_Flat` 和 `Outfit_Model_Card`；不要把“风格形容词”替代结构事实。

## Branches

### Runway

适用于礼服、晚装、高定、概念装、机能装，或用户明确要求秀场感。

- 场景偏极简、剧场、宴会厅、工业废墟、传统建筑或高反差摄影棚。
- 模特表情克制，步态仪式化，动作少而精准。
- 光影更戏剧化，硬侧光、轮廓光、深阴影。
- 禁止街拍式随意互动、微笑抓拍、生活道具抢戏。

### Lifestyle

适用于休闲、通勤、街头、日常穿搭、保暖、民族/传统服饰，或用户要求真实感。

- 场景可为城市街道、咖啡馆、书店、画廊、公园、海边、居家、夜间街景。
- 模特动作自然：推门、过马路、整理领口、拿咖啡、看书、转头浅笑。
- 光线以自然光或环境混合色温为主。
- 禁止 T 台、过度对称走廊、刻意摆拍。

## Production Flow

### Phase 1: Garment Flat

生成或绑定 `Garment_Flat`：

- 正面/侧面/背面三视图。
- 无模特、无环境，纯白或浅灰背景。
- 清楚表现廓形、缝线、拉链、纽扣、图案和工艺细节。
- 可带面料/工艺短标注，但不得引入无关文字。

用户确认前不要进入服饰卡阶段。

### Phase 2: Outfit Model Card

用已确认的刀版图生成 `Outfit_Model_Card`：

- 左侧：模特面部/半身特写，妆容、骨相、发型、肤色稳定。
- 右侧：穿着服装的正面/侧面/背面全身三视图。
- 重点还原面料垂坠、折叠、反光、纹理和服装比例。
- 多套服装或多角色按 `Outfit_01`、`Outfit_02` 分组，资产隔离。

用户确认模特和面料还原度前不要生成场景或视频。

### Phase 3: Scene Choice

不要直接生成场景。先由 `plan` 给 3 个场景候选，每个包含：

- 场景类型。
- 1-2 句氛围描述。
- 主光源方向和色温。
- 为什么匹配这套服装。

用户选择后再生成 `Scene_Base` 空场景图：无人物、无服装，只呈现空间结构、光线、明暗比例、景深和留白。

### Phase 4: Six-Panel Storyboard

基于真实 `Outfit_Model_Card` 和 `Scene_Base` URL 生成六宫格分镜预览。

六格固定覆盖：

| 格 | 功能 |
| --- | --- |
| 1 | 全景建立场景与模特入场 |
| 2 | 中景展示步态、转身或生活动作 |
| 3 | 近景展示妆造、上身细节、配件 |
| 4 | 特写展示面料纹理、针脚、拉链、刺绣 |
| 5 | 动态定格展示裙摆、外套、风、互动或情绪动作 |
| 6 | 收尾全景或侧背镜，留白收束 |

六宫格默认 `9:16` 竖屏视角，3 行 x 2 列。若用户要求横屏，仍保留六格功能，但每格构图改为横屏预览。

### Phase 5: Video

用户确认六宫格后，生成一条 15 秒视频。参考图顺序建议：

1. 六宫格分镜图：构图和节奏主锚。
2. 模特服饰卡：人物和服装一致性锚点。
3. 空场景图：光线和空间锚点。

若本轮工具列表不适合单次 15 秒全片生成，可拆成 2-3 个 clip，但必须保持同一 outfit 和 scene，不跨组混用资产。

## Prompt Rules

### Garment Flat

必须写清：

- technical fashion flat, front side back views
- white or light gray background
- no human model
- silhouette, seams, zipper, buttons, pattern, fabric labels

### Outfit Model Card

必须写清：

- reference the garment flat as clothing structure source
- editorial fashion model
- stable face, hair, makeup, body proportion
- full-body front side back views wearing the garment
- fabric physics: drape, fold, sheen, thickness, transparency

### Six-Panel Storyboard

必须写清：

- six-panel cinematic storyboard grid
- each panel keeps the same model, outfit and scene
- panel order follows the six functions
- film color continuity and lighting continuity
- no clothing morphing, no identity drift

### Video

Runway prompt 强调：

- controlled runway walk
- precise turn
- severe expression
- garment movement under hard side light
- Foley 可用 high heel steps / fabric friction，但不要把 BGM 写进视频 prompt。

Lifestyle prompt 强调：

- natural walking or interaction
- candid handheld feel
- realistic fabric response to gravity and wind
- warm or ambient environment light
- optional city/cafe/home ambience。

禁止项：

- no clothing morphing
- no extra outfit
- no wrong model face
- no subtitles unless requested
- no watermark
- no logo hallucination
- no background change within the clip

## Rerun Rules

一轮等于一套服装、一套场景、一张六宫格、一条 15s 视频。

- 换场景：复用已确认 `Outfit_Model_Card`，从 Scene Choice 重新开始。
- 换服装：从 Garment Flat 重新开始。
- 多套服装：每套资产独立，不跨 outfit 复用模特服饰卡。
- 合并多条视频：交给 `canvas-long-video-production` 或本轮工具列表支持的拼接工具，不在此流程内假设已完成。

## Review Checklist

critic 必须检查：

- 刀版图是否清楚呈现正侧背结构。
- 模特服饰卡是否忠实还原服装剪裁和面料。
- 场景是否符合 Runway / Lifestyle 分支。
- 六宫格是否覆盖 6 个功能格。
- 视频中服装是否变形、换款、换色、消失。
- 模特是否同一人，场景是否稳定。
- 单轮资产是否没有串到其它 outfit / scene。

## Output Contract

根据阶段输出其一：

- `clothingAnalysis`：款式、面料、色彩、动态物理。
- `styleBranch`：Runway / Lifestyle 及理由。
- `assetResults`：刀版图、服饰卡、场景图真实 `imageUrl`。
- `storyboardResult`：六宫格真实 `imageUrl`。
- `videoResult`：15s clip 真实 `videoUrl`、taskId、节点 id、失败原因。
- `nextRound`：换场景、换服装或合并的建议。

不得把 queued/running、只有 taskId、只有节点存在说成已完成。缺少真实 URL 时必须等待、失败或说明阻塞。
