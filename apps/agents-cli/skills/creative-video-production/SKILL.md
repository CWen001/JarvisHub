---
name: creative-video-production
description: "Use when 用户要做 JarvisHub 创作视频路线：storyboard-first、商业/产品广告、角色动作/试镜、音乐 MV/短片、游戏概念/HUD trailer、分镜图转视频或 GPT Image 2 + Seedance 风格工作流。它是创作任务的轻量路由与 SOP 合并层；30s+、多 clip 连续成片或完整短片交给 canvas-long-video-production 总控。"
---

# Creative Video Production

## Mission

把高度相近的创作视频任务统一成一个入口，先判断任务类型、证据状态和应交付物，再委派到现有 canvas harness、subagents 和下游 production skills。

本 skill 只定义创作路线和检查点，不复制工具 schema，不维护 API key、endpoint 或公共接口脚本。真实生成、等待、读写与节点字段以当前 agent harness 暴露的 canvas tools 为准。

## When To Use

- 用户要把 storyboard、3x3/4x3 grid、comic panel、pitch storyboard 或分镜图转视频。
- 用户要做商业广告、产品视频、App demo、奢侈品/食品/电商短片。
- 用户要让角色图、三视图、character sheet、舞蹈动作格或原创 IP 角色动起来。
- 用户要做 casting grid、角色试镜、多候选表演对比或选角后继续产出视频。
- 用户要做 MV、歌词驱动短片、beat-synced shotlist、旁白对白短片。
- 用户要做游戏概念视频、假实机演示、HUD 动画、开放世界 trailer 或角色技能展示。

若用户目标是 30s+、多分钟、连续多段成片、完整短片或需要拼接总控，先加载 `canvas-long-video-production`，本 skill 只作为其中某个创作路线的参考。

## Routing

| 用户意图 | 主路线 | 下游 skill |
| --- | --- | --- |
| 只有剧情、广告想法或小说片段 | 先标准化为可生产 shot manifest / 分镜剧本 | `storyboard-script-writer` |
| 已有分镜剧本，需要角色/场景锚点图 | 生成角色定妆、场景 Base、关键道具 | `storyboard-visual-assets` |
| 已有持久化完成的角色/场景节点，需要故事板图 | 生成 storyboard/grid/panel board | `storyboard-image-production` |
| 已有持久化完成的 storyboard/grid/关键帧节点，需要单段视频 prompt | 写最小可执行图生视频 prompt | `canvas-video-prompting` |
| 要保持构图替换主体、复刻产品或角色 | 参考图顺序 + prompt 文字声明职责 | `canvas-replicate` |
| 复杂图片/视频提示词质量不够 | 交给 prompt specialist 做可执行提示词 | `canvas-prompt-specialists` |

## Common Gates

执行前必须区分三种证据：

- 真实资产：稳定 `nodeId`（必要时加 `assetId`），且 `status=success`、`persisted=true`。
- 可执行引用：内部画布素材使用当前 canvas tool schema 支持的 `sourceNodeId`；只有非画布外部素材允许 URL-only 引用。
- 非证据：文字设定、taskId、queued/running 状态、占位节点、历史 docs、推测 metadata。

需要生成视频时，不得把无图的剧情直接丢给视频工具。除非用户明确要求纯文生视频，否则默认先做 storyboard 或关键帧，再用图生视频。

## Route Playbooks

### Storyboard-First Video

适用于 storyboard、panel grid、multi-frame reference、漫画页或 pitch deck storyboard。

1. 若输入只是剧情，先用 `storyboard-script-writer` 产出可生产剧本。
2. 若缺持久化完成的角色/场景节点，先用 `storyboard-visual-assets` 补齐。
3. 用 `storyboard-image-production` 生成故事板图板，保持 panel 顺序、镜头编号和视觉锚点。
4. 用 `canvas-video-prompting` 把每张 storyboard 转为视频 prompt；必须写明 follow storyboard sequence, preserve panel order, no reordering。
5. 生成多个 clip 时按 storyboard `sourceNodeId` 并行提交，等待节点持久化完成后交给 `critic` 或长视频总控汇总。

### Commercial And Product Video

适用于产品广告、App demo、食品制作、电商图转视频、15 秒社媒广告。

1. 锁定销售对象：产品、服务、App UI、食品过程或品牌资产。
2. 先生成 hero product / UI / process key visual，必要时用 `canvas-replicate` 保留构图或产品外观。
3. shotlist 默认 3-6 镜：hook、功能/质感、使用场景、证明点、收束画面。
4. 视频 prompt 必须写清产品不可漂移项：logo、形状、材质、包装、屏幕 UI、尺寸比例。
5. 15 秒以上或多 clip 广告片交给 `canvas-long-video-production` 管理节奏和拼接。

### Character Motion And Casting

适用于角色图转动作、character sheet、舞蹈动作格、角色 intro、casting grid、试镜片段。

1. 先判断是“选角色”还是“让已选角色动起来”。
2. casting 阶段先做候选图板或同一句台词表演短片，不直接进入完整视频生产。
3. 已选角色必须有持久化完成的角色锚点节点；动作视频 prompt 明确身体动作、表情变化、镜头运动和不可漂移外观。
4. 舞蹈或武打动作拆成短 clip，不把多段 choreography 塞进单段 15 秒视频。
5. 角色选定后，完整剧情或连续成片转交 `canvas-long-video-production`。

### Music Video And Short Film

适用于歌词、音乐结构、beat map、旁白对白、短片 shotlist。

1. 先把音乐结构拆成 beat map：intro、verse、pre-chorus、hook、bridge、outro。
2. 每个 beat 绑定视觉主题、情绪、镜头类型和参考图需求。
3. 用 storyboard/key visual 承载空间、人物和美术风格；视频 prompt 只承载短时运动。
4. MV 的剪辑节奏要写进 clip manifest，不要要求单个视频节点完成完整歌曲。
5. 若要多 clip 成片，交给 `canvas-long-video-production` 管控总时长、拼接和审片。

### Gameplay Concept And HUD Trailer

适用于假实机、游戏角色展示、开放世界/ARPG/MMO/GTA-style trailer、HUD/UI 动画。

1. 先确认要生成的是 concept screenshot、HUD state、角色技能镜头还是 trailer clip。
2. 参考图职责要写清：角色外观、场景构图、HUD/UI、风格参考分别对应哪张图。
3. HUD 文字和 UI 布局必须稳定，避免视频 prompt 要求大段可读小字变化。
4. gameplay prompt 明确第三人称/第一人称、镜头高度、角色输入动作、反馈结果和环境物理。
5. 多镜头 trailer 交给 `canvas-long-video-production`，不要一次性塞入单段视频。

## Subagent Use

- `explore`：读取画布、用户素材、参考图与项目状态，不生成。
- `plan`：输出 route、shot manifest、证据缺口与下游 skill 顺序。
- `media`：执行图片/视频生成和 wait；fan-out 前必须读取 flow，跳过已有稳定节点且 `status=success`、`persisted=true` 的目标。
- `critic`：检查角色/产品一致性、panel 顺序、视频漂移、物理动作和交付完整性。

主代理不要把工具字段或 API 协议写进本 skill 的 prompt 里。工具参数按当前 harness schema 传入；SOP 只决定“何时生成什么、用哪些证据、交给哪个 subagent”。

## Output Contract

根据当前阶段输出其一：

- 路由决策：任务类型、当前证据、缺口、下游 skill 顺序。
- 生产清单：shot manifest、参考图片职责、节点/clip 目标。
- 生成结果：`nodeId`、`assetId`（如有）、`status`、`persisted`、taskId 和失败原因；不输出内部媒体 URL。
- 审片结论：通过项、需要重试的 clip、重试 prompt 的最小修改点。

不得把 “queued/running/taskId 已有” 写成 “已生成完成”。缺少稳定节点 ID 或 `persisted=true` 时必须明确失败或等待，不做完成声明。
