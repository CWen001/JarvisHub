---
name: flova-east-asian-arthouse-short
description: Use when 用户要创作东亚文艺片风格短片、情绪氛围驱动视频、克制表演、长镜头、留白、声画分离、物件隐喻或内收情感表达。
---

# East Asian Arthouse Short

## Mission

用于东亚文艺片式短片：以情绪轨迹而非剧情事件为核心，设计克制表演、长镜头、留白、物件转喻和声画分离。

The goal is not "what happened" but "what is slowly changing inside someone."

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- East Asian arthouse short films,
- restrained emotional shorts,
- mood-first narrative,
- slow cinema,
- daily-life melancholy,
- unspoken relationship tension,
- films inspired by quiet domestic or urban East Asian emotional grammar.

Do not use it for fast plot-driven dramas, product ads, documentaries, or social montage.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model for assets, video clips, review, and assembly. Treat audio as plan or bound asset unless a real audio tool is exposed.

If the current video model struggles with intense action or facial emotion, use the replacement strategies in this skill instead of forcing direct generation.

## Workflow

1. Confirm emotional trajectory first.
2. Write final video spec.
3. Design elements and shot list.
4. Generate or bind key element images.
5. Generate restrained video shots.
6. Create audio layer plan; bind or generate real audio only if this turn exposes audio capability.
7. Assemble with breath, silence, and sound-image separation.

Pause after:

- emotional direction,
- storyboard,
- key elements,
- video shots,
- final assembly.

## Emotional Trajectory

Before plot, define:

- starting emotion,
- hidden pressure,
- point of suspension,
- release or non-release,
- final residue.

Use a breathing structure:

- inhale: emotional setup,
- hold: emotional high point or suspended silence,
- exhale: release, empty frame, or unresolved aftertaste.

If a proposed scene is only plot information, convert it into an emotion beat or remove it.

## Element Design

Characters:

- stable natural appearance,
- ordinary clothing,
- not over-styled,
- emotional trait described through habits, not slogans.

Scenes:

- lived-in East Asian spaces,
- window light, narrow apartment corridors, old stairs, convenience store light, rainy arcades, rooftops, kitchens, balconies, markets,
- visible daily objects and use marks.

Objects:

- register recurring symbolic objects,
- track state changes: hot tea -> cold tea -> removed cup, paired chairs -> one empty chair, closed window -> opened window.

Provided references must be preserved.

## Shot Grammar

Allowed camera:

- static camera,
- very slow push-in,
- subtle handheld breathing,
- slow lateral tracking,
- static close-up.

Recommended duration:

- minimum 6s per shot,
- 3-4 shots per emotional unit,
- 30-50s per emotional unit.

Avoid:

- fast push/pull,
- whip pan,
- orbit,
- drone dive,
- complex internal cut changes,
- frequent shot scale changes inside one shot.

Every shot must include:

- scene anchor and light direction,
- micro action,
- camera choice,
- emotional phase,
- duration,
- sound or silence note.

## Emotional Expression

Use internalized expression:

- sadness -> lowered gaze, breathing, turning toward window.
- love -> serving extra rice, fixing scarf, waiting without saying.
- anger -> chopsticks placed harder, silence, leaving the room.
- longing -> old photo, familiar road, repeated object.
- release -> opening a window, looking away, putting something down.

Avoid:

- shouting,
- melodramatic crying,
- direct confession unless user asks,
- explanatory dialogue,
- broad theatrical gestures.

If strong emotion is necessary, use:

- sound-image separation,
- pre-explosion second,
- post-explosion aftermath,
- symbolic object/environment change.

## Visual Tone

Use:

- medium-low saturation,
- soft highlights,
- detailed shadows,
- real uneven skin,
- warm yellow interiors or blue-gray evenings,
- window side light,
- dusk/morning directional light,
- overcast soft light,
- practical lamps or TV glow.

References may include broad qualities of Kore-eda, Hou Hsiao-hsien, Lee Chang-dong, Wong Kar-wai mood color, without copying exact scenes.

Avoid:

- exoticized tourist Asia,
- glossy commercial beauty,
- neon cyberpunk by default,
- studio lighting,
- perfectly cleaned spaces.

## Prompt Rules

Image/keyframe prompt:

```text
[character or object micro action] in [lived-in East Asian space], [time/light source], [shot scale], [composition and negative space], [soft color/film texture], restrained emotion, no melodrama, no subtitles, no random text, no watermark
```

Video prompt:

```text
[allowed camera movement]. [subject performs a small continuous action]. [environment/light changes slightly]. [emotional phase]. slow pacing, breathing space, no fast cuts, no subtitles, no random text, no watermark, no music unless audio is intentionally generated inside clip
```

Do not describe plot summaries in video prompts. Describe visible behavior.

## Audio And Assembly

Audio is emotional continuity:

- room tone,
- rain,
- train,
- refrigerator hum,
- distant street,
- kettle,
- TV,
- footsteps,
- one sparse music layer if necessary.

Use sound-image separation:

- emotion can happen offscreen,
- image can remain on a cup/window/hallway/object,
- music or sound carries the emotional pressure.

Editing:

- allow black frames or empty shots between emotion units,
- use 1-2s silence or room tone,
- avoid hard information cuts,
- preserve aftertaste.

## Quality Review

Check:

- emotional trajectory exists before plot,
- no overacting,
- no fast commercial movement,
- each shot has enough duration,
- objects/spaces carry emotion,
- no tourist/exotic framing,
- audio/silence is planned,
- real media URLs exist before claiming completion.

If a shot feels too explanatory, replace it with object, silence, or aftermath.

## Output Contract

Return:

- `emotional_trajectory`,
- `final_spec`,
- `key_elements`,
- `shot_list`,
- `keyframe_prompts`,
- `video_prompts`,
- `audio_plan`,
- `media`,
- `assembly_plan`,
- `review`.

Do not present a plot outline as a finished arthouse film.
