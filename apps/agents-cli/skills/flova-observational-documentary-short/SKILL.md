---
name: flova-observational-documentary-short
description: Use when 用户要做人文纪录短片、城市记忆、小城旧街区叙事、普通人生活观察、低戏剧性日常事件链、自然光长镜头、生活流纪录影像。
---

# Observational Documentary Short

## Mission

用于观察性纪录与城市记忆短片：聚焦真实的人、真实空间、低戏剧性的日常事件链，用自然光、长镜头、微小动作和环境声制作纪录影像。

This skill observes life. It does not make city propaganda, influencer travel videos, or motivational ads.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- human documentary shorts,
- city memory narratives,
- old neighborhood stories,
- ordinary people's lives,
- low-drama slice-of-life films,
- market/tea house/railway/village/street observations,
- documentary-style visuals with natural light and environmental sound.

Do not use it for highly plotted drama, product ads, brand campaigns, or fast social montage.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Do not assume a specific documentary video model exists.

Typical mapping:

- start frames -> current image generation,
- slow documentary clips -> current first-frame/video generation,
- dynamic shots -> current image/video generation only when necessary,
- audio -> current ambient/BGM/narration tools if available,
- assembly -> current timeline capability.

If a model/tool cannot produce slow documentary motion, return start frames, prompts, and edit plan as artifacts.

## Modes

Choose one:

- `global_human_documentary`: international observational human-life documentary.
- `city_memory`: small city, old neighborhood, concrete people and spaces, low-drama narrative chain.

Both modes share visual grammar: restraint, natural light, ordinary actions, imperfect reality.

## Required Intake

Collect:

- region/location,
- topic/person/community,
- target duration,
- aspect ratio,
- language,
- whether a script exists,
- visual references,
- whether narration is allowed,
- whether BGM is allowed,
- key person/place/object.

If no material exists, ask for:

- where and when it happens,
- who the protagonist is,
- one small dilemma/decision,
- one other key person,
- one recurring object or place.

## Core Principles

- Start with people, not city views.
- Show life, do not explain it.
- Avoid big dramatic conflict unless the user provided it.
- Let space act as a character.
- Use small actions: cooking, sewing, washing, waiting, smoking, tea, looking out a window, folding clothes, wiping a table.
- Prefer backs, hands, side profiles, and pauses over frontal performance.
- Let environment sound carry meaning.
- Keep endings open.

Avoid:

- city-promo language,
- motivational summary,
- poverty spectacle,
- value judgment,
- heavy sentimentality,
- TikTok pacing,
- decorative drone shots,
- fast push/pull/orbit,
- polished commercial lighting.

## Story Design

For `city_memory`, build a low-drama event chain:

- opening unresolved line: one action, object, or glance creates a question.
- hidden history between people or place.
- recurring object appears at least twice and changes state/location/meaning.
- later scenes retain traces of earlier events.
- at least one expectation fails quietly.
- final action has double meaning but no explicit answer.

For `global_human_documentary`, build observational sequence:

- ordinary person in real work/life routine,
- place and environment revealed through activity,
- 6-12 second observational shots,
- no forced plot twist,
- human dignity over exoticism.

## Shot Rhythm

Use a mix:

- short shot 2-3s: object insert, environmental detail, reaction cut.
- medium shot 6-10s: main behavior and interaction.
- long shot 11-15s: opening space, emotional settling, ending aftertaste.

For pure documentary mode, avoid shots under 5s unless necessary.

Recommended full short:

- 10-16 shots for 1-3 minutes,
- 60%+ mid/wide observation shots,
- 80% calm/narrative shots,
- 20% or less high-dynamic shots for travel/search/urgent movement.

## Shot Design

Each shot must include:

- `Scene`: location element, time of day, light.
- `Subject action`: specific body/hand/face action.
- `Camera`: shot scale, movement, focus strategy.
- `Sound`: environment or diegetic sound.
- `Route`: calm/observational or dynamic.

Camera grammar:

- fixed camera,
- slight handheld breathing,
- extremely slow push-in,
- extremely slow pan,
- restrained follow only when the person moves.

Forbidden unless user explicitly asks:

- fast cuts,
- music beat edits,
- spin/orbit,
- decorative aerial shots,
- aggressive slow motion,
- commercial beauty lighting.

## Visual Texture

Use:

- natural light: morning, dusk, overcast, window side light, fluorescent interior.
- air: dust, steam, dampness, heat haze, wind.
- low saturation,
- soft highlights,
- detailed shadows,
- real skin tone,
- slight grain,
- imperfect focus/exposure when natural.

City memory details:

- faded slogans,
- QR payment stickers,
- old posters,
- price lists,
- construction noise,
- TV news,
- square-dance music,
- dialect radio,
- plastic stools,
- old tiles,
- wires,
- worn shop signs.

Do not clean the frame too much. Mess can be truth when it belongs to the place.

## Prompt Rules

Start-frame prompt formula:

```text
[subject and small action] + [space and social/environment detail] + [air texture] + [natural light] + [shot scale/composition] + [film/documentary color texture] + [reference style]
```

Video prompt formula:

```text
[restrained camera movement] + [continuous small action] + [small environmental/light change] + [documentary color texture] + [slow observational pacing] + [sound feeling if relevant] + no fast cuts, no subtitles, no random text, no watermark, no music unless audio is intentionally generated inside the clip
```

Useful references:

- Magnum Photos,
- Leica documentary,
- National Geographic observational,
- Kodak Vision3,
- Fuji Eterna,
- ARRI Alexa Natural,
- Kore-eda-like restraint,
- Jia Zhangke-like city observation.

Avoid copying exact scenes, characters, or dialogue from known films.

## Audio

Prefer location sound:

- market noise,
- wind,
- rain,
- bus reverse signal,
- radio,
- TV,
- kitchen sound,
- street vendor,
- distant construction,
- footsteps,
- plastic bag rustle.

BGM is optional and should be minimal:

- ambient,
- sparse instrumental,
- no pop beat,
- low volume,
- never explaining emotion.

Avoid narration that explains the theme. If narration exists, it should be sparse and observational.

## Assembly

Editing rules:

- long takes over fast cuts,
- preserve time flow,
- allow 0.5-1s black/sound bridge if useful,
- no flashy transitions,
- no music beat cutting,
- keep environmental sound alive across cuts.

For city memory:

- preserve traces between scenes,
- insert recurring object closeups,
- avoid concluding moral statement.

## Quality Review

Check:

- people are central, not city promotion,
- actions are concrete and observable,
- shots are not over-dramatized,
- natural light and air texture are present,
- environmental sound is planned,
- no fast commercial rhythm,
- no over-clean AI look,
- recurring object/space continuity works if using city-memory mode,
- actual media URLs exist before claiming generated.

If a shot feels like generic stock footage, rewrite with person, place, object, and action specificity.

## Output Contract

Return:

- `mode`,
- `story_premise`,
- `final_spec`,
- `key_elements`,
- `shot_list`,
- `start_frame_prompts`,
- `video_prompts`,
- `audio_plan`,
- `media`,
- `assembly_plan`,
- `review`.

Do not present start-frame prompts as a completed documentary.
