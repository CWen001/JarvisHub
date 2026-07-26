---
name: flova-jewelry-12-shot-ad
description: "Use when 用户要基于模特、首饰、环境或品牌参考图生成 9:16/16:9 的首饰广告 Vlog、珠宝短片、轻奢饰品产品视频、12 镜头广告分镜或首饰图生视频。"
---

# Jewelry 12-Shot Ad

## Mission

用于 12 镜首饰广告：先锁定参考图职责，再生成元素锚点、12 个关键帧/故事板、视频 clip 和品牌收尾帧。

运行边界：只定义创作方法和验收标准，不复制工具参数，不写接口地址。真实画布读写、图片生成、视频生成、等待结果和节点字段以本轮工具列表暴露的 canvas tools 为准。

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## Harness Boundary

- 主代理负责阶段判断、缺口说明、subagent 派发和最终汇总。
- `explore` 读取画布、用户上传图、已有 `imageUrl` / `videoUrl`，不生成。
- `plan` 产出输入分类、12 镜头 manifest、参考图职责、候选数量和验收清单。
- `media` 执行图片/视频生成与 wait；fan-out 前必须读取 flow，跳过已有真实 URL 的节点。
- `critic` 检查模特一致性、首饰还原、镜头顺序、产品清晰度、视频漂移和品牌收尾。

若用户要 60s+ 完整成片、批量 clip 拼接或最终合成总控，先加载 `canvas-long-video-production`。此流程可作为其中的产品广告路线，不替代长视频总控。

## Intake

执行前先确认两项，不要直接开跑：

1. 画面比例：`9:16` 竖屏或 `16:9` 横屏。
2. 每镜头候选数：`1` 个省成本，或 `3` 个供逐镜筛选。

参考图按职责分组。不要依赖文件名猜测，必须从用户说明、节点上下文或视觉分析中确认：

| 分组 | 用途 | 缺失时 |
| --- | --- | --- |
| `Character_Input` | 模特外貌、发型、肤色、体型、服装 | 可由用户描述生成，但要声明一致性风险 |
| `Jewelry_Input` | 首饰形态、材质、结构、佩戴状态 | 必须补充；没有首饰参考不应进入产品广告生成 |
| `Environment_Input` | 建筑/街景/室内/自然空间、光线、色调 | 询问用户描述环境，或让 agent 基于产品调性设计 |
| `Brand_Input` | logo、slogan、品牌色、包装/橱窗调性 | 缺失时跳过第 13 镜品牌收尾 |

真实可执行证据只包括 `imageUrl`、`imageResults[].url`、用户本轮上传的可访问图片 URL，或当前 canvas tool parameters 支持的真实参考图 URL。`taskId`、queued/running 状态、文字设定和占位节点都不是可执行参考图。

## Production Flow

### Phase 1: Visual Analysis

用 `explore` 或视觉分析能力提取以下事实，不做审美脑补：

- 模特：脸型、五官比例、发型、肤色、体型、可见服装。
- 首饰：类型、主石/吊坠形态、金属色、镶嵌/雕刻、链条结构、佩戴位置。
- 环境：空间类型、建筑风格、主色调、光线方向、纵深层次、可识别材质。
- 品牌：品牌名、logo 形态、slogan、品牌色、可复用品牌视觉元素。

输出要能直接变成 reference map，例如：

```json
{
  "aspectRatio": "9:16",
  "shotCandidates": 1,
  "references": {
    "character": ["image-url"],
    "jewelry": ["image-url"],
    "environment": ["image-url"],
    "brand": []
  }
}
```

### Phase 2: Elements

在生成 12 镜头前，先补齐可复用元素图。若用户已给满意的真实图，可直接绑定，不重复生成。

- `Character_Main`：模特正面/侧面/背面或至少一个稳定角色锚点图。
- `Jewelry_Hero`：首饰正面细节图、佩戴状态图，必须能读出工艺和材质。
- `Environment_Ref`：空景全景、中景纵深、可用于微距的环境材质。
- `Brand_Ref`：仅当有品牌输入时生成或绑定，用于第 13 镜。

元素阶段完成前不要生成视频。缺真实元素 URL 时，后续关键帧必须保持 blocked。

### Phase 3: 12-Shot Storyboard / Keyframes

默认生成 12 个关键帧或故事板镜头。第 13 镜仅在有 `Brand_Input` 时出现。

| Shot | 类型 | 内容与功能 | 参考职责 |
| --- | --- | --- | --- |
| 001 | ECU 首饰局部 | 锁骨/手/耳颈局部，首饰首次曝光 | jewelry + character |
| 002 | MS 环境站姿 | 模特与环境建立，首饰可见但非焦点 | character + environment |
| 003 | 低角度 CU | 脚步/手部/衣摆与环境地面细节 | character + environment |
| 004 | MCU 情绪光晕 | 侧脸、发丝、逆光、光泄漏 | character + environment |
| 005 | MS 逆光剪影 | 虚焦人物前景与环境散景 | character + environment |
| 006 | ECU 环境微距 | 纯环境材质呼吸镜头 | environment |
| 007 | LS 纯环境空镜 | 建筑/空间全貌，叙事降速 | environment |
| 008 | MS 复合景别 | 虚焦人物前景 + 实焦纵深环境 | character + environment |
| 009 | FS 全身造型 | 模特全身造型，首饰清晰可读 | character + jewelry + environment |
| 010 | MCU 产品核心帧 | 首饰实焦，面部局部可见 | jewelry + character |
| 011 | CU 面孔揭示 | 面部特写，首饰仍可见 | character + jewelry |
| 012 | LS 背影离场 | 模特走向环境纵深，开放结尾 | character + environment |
| 013 | 品牌收尾 | logo / slogan / 品牌色收束 | brand |

12 镜头顺序固定，不要调换。若用户只要静态视觉方案，可在 Phase 3 收口；若用户要视频，继续 Phase 4。

### Phase 4: Video Clips

每个视频 clip 必须引用对应关键帧或故事板真实 URL。推荐时长：

- `001 / 006 / 008 / 012`：3-4 秒。
- `002 / 003 / 005 / 007 / 009 / 011`：4-5 秒。
- `004 / 010`：3 秒。
- `013`：3-4 秒，可淡入淡出。

视频 prompt 必须包含：

- 主体动作和镜头运动，例如 slow dolly in、tracking shot、subtle handheld。
- 产品不漂移约束：首饰形态、金属色、主石/吊坠结构、佩戴位置。
- 模特不漂移约束：脸型、发型、肤色、服装轮廓。
- 环境不漂移约束：光线方向、色温、空间纵深和主要材质。
- 禁止项：no subtitles, no watermark, no text overlay, no hard studio flash, no direct ad pose。

不要写 `zoom`，改写为 dolly、push-in、tracking 或 arc move。

### Phase 5: Candidate Review

若 `shotCandidates = 3`，每个镜头生成候选后必须暂停或进入 critic 汇总，不能自动选最终版。critic 至少按以下维度评分：

- 首饰是否清楚且与参考一致。
- 模特是否保持同一人。
- 环境是否延续同一视觉世界。
- 镜头是否符合 12 镜头功能。
- 是否有字幕、水印、错误 logo、广告硬摆拍。
- 视频动作是否出现首饰变形、面部漂移、手指异常或产品消失。

若 `shotCandidates = 1`，仍需 critic 检查失败项；有 P0 问题时重试对应镜头，不重跑全片。

## Visual Rules

核心美学是“半遮半现”：首饰清楚，人物不过度直给。优先使用侧脸、虚焦前景、发丝遮挡、逆光光晕、环境纵深和自然抓拍感。

全片统一风格：

- cinematic film still
- analog photography
- 35mm film grain
- editorial fashion photography
- natural candid moment
- visible skin texture
- no harsh flash

首饰材质词按参考选择：

- silver: cool metallic sheen, mirror polish
- gold: warm metallic glow, polished surface
- rose gold: warm pink metallic tone
- gemstone: gemstone sparkle, point light reflections
- leather/fabric: leather texture, fabric weave detail, matte surface

## Output Contract

根据阶段输出其一：

- `referenceMap`：参考图职责、缺口、是否可执行。
- `shotManifest`：13 镜头以内的镜头表、参考图职责、候选数、比例。
- `imageResults`：每个元素/关键帧的真实 `imageUrl` 或失败原因。
- `videoResults`：每个 clip 的真实 `videoUrl`、taskId、节点 id、失败原因。
- `review`：可用镜头、需重试镜头、最小重试建议。

不得把 queued/running、只有 taskId、只有节点存在说成已完成。缺少真实 URL 时必须继续等待、显式失败或说明阻塞。
