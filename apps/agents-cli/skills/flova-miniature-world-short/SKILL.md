---
name: flova-miniature-world-short
description: Use when 用户要制作微缩世界创意短片、移轴摄影美学、微型模型场景、温柔情感故事、节日祝福视频、60-90 秒竖屏微缩生活故事。
---

# Miniature World Short

## Mission

用于微缩世界创意短片：以微型道具、模型场景和移轴摄影美学讲一个有情绪弧光的温柔小故事，适合节日祝福、生活故事、暖调情感短片。

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- miniature world stories,
- tilt-shift model-scene films,
- tiny character emotional shorts,
- holiday blessing videos,
- warm 60-90s social shorts,
- handcrafted miniature scene storytelling.

Do not use it for real documentary, regular drama, or wool felt full-size animation.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Do not assume a fixed model menu, membership state, or exact duration support. If exact ratios/durations are unsupported, disclose and provide closest runnable prompts.

## Required Intake

Confirm first:

- aspect ratio: default 9:16, alternatives 16:9 or 1:1.
- duration: 60s, 90s, or custom.
- target resolution supported by this turn's tool list.
- story theme or greeting occasion.
- whether there is narration.
- visual tone: warm/soft, cool/moonlit, festive, nostalgic, playful.
- image/video model preference only if the harness exposes choices.

Do not plan the story before these production specs are known.

## Workflow

1. Confirm production specs.
2. Build story arc.
3. Design key elements.
4. Generate character/scene/prop references.
5. Generate shots in storyboard order.
6. Plan BGM/narration if needed; generate real audio only if this turn exposes a real audio tool.
7. Assemble rough cut and review.
8. Final output.

Pause after specs, storyboard, elements, completed clips/audio plan or assets, and rough cut.

## Story Structure

Build 4-6 story beats:

- establish miniature world,
- trigger event,
- action/progress,
- emotional high point,
- afterglow ending.

Each beat should define:

- scene,
- characters,
- key action/prop,
- emotion.

Typical 60s film: 10-12 shots.
Typical 90s film: 14-18 shots.

## Miniature Visual Rules

All images and video should feel like miniature model photography:

- tilt-shift shallow depth of field,
- strong foreground/background scale separation,
- delicate material texture,
- tiny props and model-scale environments,
- soft diffused light,
- warm cream/tea/gold or cool mint/moonlight palettes.

Characters:

- miniature figure scale,
- slightly stylized but emotionally readable,
- consistent clothing/hair across shots.

Scenes:

- model-like streets, rooms, tables, gardens, workshops,
- fixed prop placement,
- handmade material detail.

Props:

- core story props get their own element.
- oversized props require multiple characters to move them.
- avoid impossible glowing/floating props unless the story is explicitly magical.

## Shot Rules

Each shot should include:

- shot ID,
- duration,
- scene,
- characters,
- action,
- emotion,
- camera movement,
- narrative link to previous/next shot.

Default shot duration: 4-8s.
Emotional high point may hold up to 10s.

Camera:

- opening wide/overhead miniature world establish,
- mid shots for interactions,
- closeups for props/faces,
- slow push/pull,
- gentle pan,
- restrained tracking.

Avoid fast cuts and aggressive handheld motion.

## Prompt Rules

Image prompt should include:

```text
miniature model photography, tilt-shift lens look, shallow depth of field, handmade miniature set, [characters/action/scene], delicate material texture, soft diffused lighting, warm muted palette, no full-size real-world scale confusion, no random text, no watermark
```

Video prompt should include:

```text
Use the miniature character and scene references. [shot action and emotion]. Gentle [camera move], tilt-shift miniature depth of field, soft diffused light, delicate model texture, warm quiet pacing, no subtitles, no random text, no watermark, no music unless audio is intended in the clip.
```

Maintain scale logic:

- if prop is larger than a character, describe multiple characters cooperating.
- every action must name the actor.
- keep fixed scene props consistent.

## Audio

BGM:

- gentle piano,
- light strings,
- warm instrumental,
- no vocals by default,
- fade in/out.

Narration optional:

- gentle,
- simple,
- matched to shot IDs,
- avoid overexplaining the emotion.

If video clips include built-in audio and separate narration exists, avoid overlapping unwanted speech/noise.

## Quality Review

Check:

- true miniature/tilt-shift feel,
- story has an emotional arc,
- scale is consistent,
- actions have named actors,
- no impossible giant-object handling,
- no random text/watermark,
- references remain consistent,
- actual media URLs exist.

If it reads as full-size live action, regenerate with stronger miniature model and tilt-shift constraints.

## Output Contract

Return:

- `spec`,
- `story_beats`,
- `key_elements`,
- `shot_list`,
- `prompts`,
- `audio_plan`,
- `media`,
- `assembly_plan`,
- `review`.

Do not present element images as finished video.
