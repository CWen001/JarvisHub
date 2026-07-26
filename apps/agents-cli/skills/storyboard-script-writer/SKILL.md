---
name: storyboard-script-writer
description: "分镜剧本写作技能。用户输入一段剧情、粗略想法、短剧梗概、小说片段、广告创意、角色关系或一句话概念时，用这个 skill 将其扩展成类似《星光便利店》格式的可生产 Markdown 分镜剧本：Basic Info、Characters、Fixed Scenes、按时间轴分 Shot 的 Visual/Dialogue/Audio/Emotional Beat 表格、Production Notes、Medium Lock、角色卡与场景 Base 生成计划、视频片段生成计划。凡是用户说“写成分镜剧本、分镜脚本、storyboard script、按上面格式、生成类似这种格式、把这段变成短剧分镜、拆成镜头剧本、60 秒短片脚本”等，都应优先使用本 skill。"
---

# Storyboard Script Writer

## Mission

把用户提供的原始文本转成可直接进入 JarvisHub / 视频生产前置流程的分镜剧本 Markdown。这个 skill 只负责“剧本结构化与生产准备”，不直接生成图片、视频或调用画布工具。

默认输出中文。用户明确要求英文或双语时再切换语言。

## Success Definition

一次合格交付必须满足：

- 故事有清晰起承转合，情绪曲线能在目标时长内完成。
- 所有角色、年龄变体、场景、关键道具都在前置资产计划里闭环。
- 每个 Shot 有明确时间戳、场景标签、可见画面、对白/旁白、声音设计和情绪功能。
- Dialogue 字段包含全部对白、旁白、屏幕文字建议；不要把台词藏在 Visual 里。
- 每个 15 秒 Shot 的动作数量可执行，不把过多事件塞进一个镜头段。
- Markdown 表格可稳定解析：多句对白用 `<br>` 分隔，不使用字面量 `\n`。
- 生产计划与正文一致：出现过的角色/场景/道具必须能在角色卡、场景 Base 或 Clip plan 中找到。
- 最终 assistant 回复本身必须直接包含完整 Markdown 分镜剧本正文；只写“已完成”“剧本已交付”“可以继续生成资产”“下面可以做什么”不算交付。

## Default Assumptions

用户没有指定时，采用：

- **Type**: 动画短剧 / 叙事短片
- **Aspect Ratio**: 9:16 (竖屏)
- **Duration**: 60s（4 个片段 x 15s）
- **Dialogue Language**: 中文
- **Shot Count**: 4
- **Clip Length**: 每段 15 秒
- **Style**: 2D anime / cinematic short / dreamy realism，按题材调整
- **Video Model Note**: Seedance 2.0, 480p, generate_audio=true

用户给出其他时长、比例、风格、平台或模型时，以用户为准。若用户只给“一段剧情”，不要先追问，直接基于合理假设生成，并在 Basic Info 或 Production Notes 中写清楚假设。

## Workflow

1. **提取事实**
   - 保留用户原文里的角色、关系、地点、核心冲突、关键台词、情绪、结局、品牌/产品信息。
   - 区分“已给事实”和“合理补全”。补全可以做，但不要改写用户明确设定。

2. **确定生产规格**
   - 计算目标总时长和 Shot 数。
   - 默认按 15 秒一个 Shot 拆分。
   - 若内容明显超过 15 秒承载量，增加 Shot 或把单 Shot 内部拆成更少、更清晰的 beats，而不是硬塞。

3. **建立资产锚点**
   - 人物：主角、配角、年龄变体、怪物/动物/拟人角色、群演中有持续叙事功能者。
   - 场景：每个会复现或承担情绪转折的地点。
   - 道具：剧情转折、身份识别、动作触发、屏幕文字载体。
   - 每个资产给稳定名称，后文必须复用同一名称。

4. **写 Shot**
   - 每个 Shot 对应一个连续时间段。
   - Visual 写可见画面、人物动作、镜头运动、光线、构图、关键转场。
   - Dialogue 只放对白、旁白、内心独白、屏幕文字建议，逐句保留或忠实改写。
   - Audio 写环境声、音乐、物理声、停顿、音效进入/退出。
   - Emotional Beat 写这个 Shot 对故事情绪的功能。

5. **补齐生产计划**
   - Production Notes 汇总镜头数、总时长、场景数、角色数、比例、风格、模型建议。
   - Medium Lock 写正向风格和负面约束，避免互相冲突。
   - 角色卡 & 场景 Base 生成计划必须覆盖所有正文资产。
   - 视频片段生成计划必须逐 Clip 对应 Shot 时间段。

6. **最终 Review**
   - 检查正文、资产计划、Clip plan 是否互相一致。
   - 检查没有对白遗漏、重复台词、未定义角色/场景、表格破损、字面量 `\n`。
   - 若发现缺口，先修正再输出。
   - Review 通过后，最终回复必须输出完整 Markdown 剧本正文；不要用 checklist 完成态、摘要、后续建议或“已生成但不展示”替代剧本正文。

## Output Template

除非用户要求其他格式，始终输出一个完整 Markdown 文档，结构如下。最终回复可以在文档后追加极短的后续建议，但不能省略文档本体，不能只输出完成说明：

```markdown
# 《标题》· 分镜剧本

## Basic Info
- **Type**: ...
- **Aspect Ratio**: ...
- **Duration**: ...
- **Dialogue Language**: ...
- **Theme**: ...

## Characters

### 角色名（English Alias 可选）
- 身份、年龄、关系
- 外观：发型、服装、体态、标志物
- 表情/情绪变化：...
- 生产备注：...

## Fixed Scenes

### Scene A: 场景名
- 时间 / 地点 / 天气
- 空间结构与固定元素
- 色彩与光线
- 氛围与叙事功能

## Script

---

### Shot 1 (0:00-0:15) · 场景 / 事件

| 字段 | 内容 |
|---|---|
| **时间戳** | 0:00-0:15 |
| **场景标签** | Scene A: 场景名 |
| **Visual** | 可见画面、构图、动作、镜头运动、光线、转场。 |
| **Dialogue** | **角色**（语气）：“台词。”<br>**旁白**（声线）：“旁白。” |
| **Audio** | 环境声、音乐、物理声、音效、静默。 |
| **Emotional Beat** | 情绪变化与叙事功能。 |

---

## Production Notes
- **镜头数**: ...
- **总时长**: ...
- **场景数**: ...
- **角色数**: ...
- **比例**: ...
- **风格**: ...
- **模型**: ...
- **generate_audio**: true/false

## Medium Lock（所有生成必须遵守）
**Positive Style**: ...
**Style Negatives**: ...

## 角色卡 & 场景 Base 生成计划

| Asset | 内容 | 模型/用途 |
|---|---|---|
| ... | ... | ... |

## 视频片段生成计划

| Clip | 时间 | 角色 ref | 场景 ref | 关键内容 |
|---|---|---|---|---|
| Clip 1 | 0-15s | ... | ... | ... |
```

## Writing Rules

- 标题要从素材主题里提炼；用户给了标题就沿用。
- Basic Info 必须短，不写长篇解释。
- Characters 里不要只写性格，要写可生成的视觉特征。
- Fixed Scenes 里不要只写“室内/街道”，要写空间结构、固定物、光线方向和氛围。
- Visual 必须是“模型能看到的画面”，不要只写抽象情绪。
- Dialogue 必须独立成字段；禁止把对白只写在 Visual 中。
- 多句 Dialogue 在 Markdown 表格里用 `<br>`，不要用字面量 `\n`。
- 屏幕文字、信件文字、招牌文字必须标为“后期字幕/屏幕文字建议”，除非用户明确要求模型直接生成文字。
- 15 秒内建议 2-4 个主要 beat；超过 5 个动作点时优先拆分或压缩。
- 同一句关键台词不要在相邻 Shot 重复，除非用户明确要求回声/复现。
- 避免直接要求完全复制特定在世艺术家或具体商业 IP 的风格；可转写成可执行风格特征，例如“温暖手绘动画、柔和水彩背景、低饱和治愈色彩”。

## Asset Closure Rules

生成完成前必须做资产闭环：

- 正文出现的每个持续角色都必须在 Characters 中定义。
- 角色存在年龄变化、梦境形态、伪装形态、怪物形态时，资产计划必须单独列出。
- 正文出现的每个场景标签都必须在 Fixed Scenes 中定义。
- Clip plan 里引用的角色 ref 和场景 ref 必须来自 Characters / Fixed Scenes。
- 若 Shot 里使用了关键道具，Production Notes 或资产计划里必须体现。

## Failure / Ask Rules

只有在以下情况才问用户一个简短问题：

- 输入完全没有题材或故事目标，无法判断是广告、剧情短片、教学、MV 还是产品展示。
- 用户要求精确商业交付，但缺少必须遵守的品牌、产品或合规信息。
- 用户明确要求“不要补全，先问我”。

其他情况下直接输出完整分镜剧本，并在文档中标注合理假设。

## Anti-Patterns

禁止：

- 只输出大纲，不给完整 Script 表格。
- 只输出“已完成 checklist / 剧本已交付 / 可以继续生成角色图或视频提示词”等完成摘要，而不展示完整剧本正文。
- 声称已经生成剧本，但把剧本留在内部、TodoWrite、工具输出、记忆或画布外部位置不展示给用户。
- 给一堆泛泛建议而不是成稿。
- 为了凑 60 秒制造无意义镜头。
- 资产计划漏掉正文里出现的角色、场景、年龄变体或关键道具。
- 把声音设计写成“后期可加”，但不进入 Audio 字段。
- 用互相冲突的风格约束，例如同时写 `2D anime` 和 `NOT cartoon` 却不解释边界。
- 表格中写字面量 `\n`。

## Completion Criteria

输出前必须满足：

1. 标题、Basic Info、Characters、Fixed Scenes、Script、Production Notes、Medium Lock、资产计划、视频计划都存在。
2. Shot 时间段连续且总时长匹配。
3. 每个 Shot 都有 Visual / Dialogue / Audio / Emotional Beat。
4. Dialogue 字段不为空；无对白段也要写环境字幕、旁白或“无对白，环境声承担情绪”。
5. Characters / Fixed Scenes / 资产计划 / Clip plan 没有互相引用不存在的名字。
6. 没有字面量 `\n`。
7. 没有明显过密的 15 秒段落。
8. 最终 assistant 回复里已经直接包含完整 Markdown 剧本；如果只看到完成摘要、checklist 或后续建议，必须继续输出剧本正文，不能结束。
