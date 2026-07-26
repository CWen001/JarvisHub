---
name: flova-static-visual-to-motion
description: Use when 用户上传静态图片、海报、概念图、国风画面或超现实波普视觉，希望分析视觉基因、生成分镜、转成短片或延展为动态图。
---

# Static Visual To Motion

## Mission

用于静态视觉转动态短片：从静态视觉出发，先解构视觉基因，再选择是原图锁定转动态、原创超现实概念延展，还是纯国风意境氛围短片。

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- one image to short video,
- poster/concept image to motion,
- static art to 15s cinematic clip,
- surreal pop visual concept,
- giant-object concept photo/video,
- guofeng pure mood short,
- music visual mood video without story.

Do not use it for script-heavy narrative, product ecommerce kits, or reference-video replacement.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Use only model choices exposed by this turn's tool list. If exact image-to-video control is not available, return storyboard and prompts anchored to the static image.

## Required Intake

Collect:

- source image if required by mode,
- output type: image, image series, video, or prompts,
- aspect ratio,
- duration,
- whether audio/BGM/SFX is needed,
- whether new assets may be generated,
- whether story/narrative is allowed.

For strict one-image-to-video mode, require a source image. For surreal concept mode, source image is optional.

## Modes

| Mode | Use For | Core Rule |
| --- | --- | --- |
| `one_image_to_film` | uploaded visual becomes video | source image is the only visual anchor |
| `surreal_pop_concept` | giant object, minimal set, pop color | create original visual language, not direct copy |
| `guofeng_pure_mood` | Chinese-style atmosphere, pure music/mood | no plot, no romance/CP interaction |

## Workflow

1. Classify mode and intent.
2. Analyze source image or guide concept.
3. Lock final spec.
4. Draft storyboard.
5. Confirm storyboard.
6. Generate video clips or image variants.
7. Assemble and QA.

Pause after visual analysis/spec, storyboard, first clip/batch, and final assembly.

## Visual DNA Analysis

Extract:

- subject structure,
- composition,
- foreground/midground/background,
- color palette ratio,
- light source and contrast,
- texture/material,
- geometry and visual tension,
- possible motion paths,
- occlusion/transition opportunities,
- audio/SFX potential.

This analysis guides motion. Do not use it as permission to replace the original image.

## One Image To Film

Use when the user uploads one visual and wants it animated or turned into a short.

Rules:

- uploaded image is the primary reference,
- do not generate new character/scene assets unless user authorizes,
- do not invent a new plot unless user requests it,
- every 15s unit can contain internal micro-cuts only if the video model supports it,
- motion should come from existing visible elements or plausible camera moves.

Storyboard each 15s table with:

- 7-12 micro-shots only when high-density style is requested,
- every 3s a clear visual focus,
- around 7s a highlight/peak,
- motion-match or physical occlusion transitions,
- no black/white/fade transitions unless user asks.

Shot registration:

- each 15s table becomes one generated shot if the tool supports internal cuts,
- do not discard details when condensing into a prompt.

## Surreal Pop Concept

Use with or without a reference image.

Core formula:

```text
real person or subject + giant everyday object/creature/plant + serious daily action + minimal color-block space + high-saturation contrast + hard shadow + advertising photography finish
```

If a reference is supplied:

- analyze the method,
- do not copy the exact subject, object, pose, composition, or color combination,
- propose original directions.

Creative direction must include:

- theme title,
- main subject,
- giant object,
- action relationship,
- set/background,
- color plan,
- lighting,
- image/video suitability.

Visual rules:

- 2-4 dominant colors,
- clean background,
- strong shadow,
- readable scale contrast,
- precise material description,
- no random text/logos.

## Guofeng Pure Mood

Use for pure atmosphere, Chinese-style mood, music visualization, moonlit scenes, cloud/mountain/water/courtyard imagery.

Hard rules:

- no plot line,
- no character relationship,
- no romantic/CP interaction,
- no eye-contact across characters,
- no hand-reaching, running-toward, embrace, or narrative reunion,
- characters are only atmosphere/scale accents.

Storyboard rhythm:

- opening: wide landscape or space,
- middle: details of light, water, architecture, fabric, moon/cloud,
- transition: light, mist, petals, water, shadow,
- ending: wide hold or quiet empty frame.

Motion:

- robe hem, hair, mist, water, cloud, candle, leaves,
- very small body movement,
- no expressive close-up unless user asks and it stays non-narrative.

Audio:

- follow pure music sections,
- do not force beat cuts,
- no VO unless user explicitly asks.

## Prompt Rules

Use Chinese prompts when the user works in Chinese unless the harness performs better in English.

One-image-to-film video prompt:

```text
Use <<<image_1>>> as the only visual reference. Preserve composition, subject identity, palette, material, and lighting. Add [specific motion/camera]. No new characters, no random text, no subtitles, no logo.
```

Surreal pop prompt:

```text
original surreal pop advertising photograph/video concept, [subject], giant [object], minimal [color] background, hard sunlight shadow, high-saturation color blocks, precise material texture, no logos, no random text
```

Guofeng prompt:

```text
pure Chinese-style mood scene, no story, no character interaction, [scene], [light], [gentle atmospheric motion], character only as distant silhouette/accent if present, no romance, no subtitles
```

## Assembly and QA

Check:

- source image preserved where required,
- no unauthorized new assets,
- visual DNA remains consistent,
- mode constraints respected,
- no unwanted story in pure mood mode,
- surreal concept is original,
- transitions are physically motivated,
- no random text/watermarks/subtitles,
- aspect ratio correct.

Fix the smallest affected clip or prompt.
