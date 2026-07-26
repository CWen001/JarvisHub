---
name: flova-lifestyle-vlog-and-food-film
description: Use when 用户要治愈系日常 Vlog、独居生活短片、旅拍、风景人像、旅行旁白片、美食美学短片或生活方式短视频。
---

# Lifestyle Vlog and Food Film

## Mission

用于生活方式、旅拍与美食短片：先锁定人物、场景、食物资产，再以舒缓或电影化分镜生成可连续的短视频。

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- healing daily vlog,
- solo living / cozy life short,
- travel film,
- scenic lifestyle video,
- food documentary short,
- cooking macro video,
- poetic travel VO video,
- creator-style short with cover/post copy.

Do not use this for music-led MV, pet anthropomorphic stories, or product-first commercials.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model for analysis, image generation, video generation, review, and assembly. Treat audio as plan or bound asset unless a real audio tool is exposed. If a capability such as voice audition, exact subtitle overlay, or poster matrix is unavailable, return the closest runnable artifact and mark the blocked stage.

## Required Intake

Collect:

- theme: daily vlog, travel, food, or mixed,
- reference images: person, place, food, style,
- target duration,
- aspect ratio and platform,
- whether VO, BGM, subtitles, cover images, or social copy are needed,
- visual style,
- output language,
- any real location or dish names that must be respected.

For travel with a real place, ask whether the user has location reference images. Use uploaded references as stronger anchors than generic location stereotypes.

## Mode Selection

Choose one primary mode:

| Mode | Use For | Core Rule |
| --- | --- | --- |
| `healing_daily_vlog` | quiet life, room, morning/night routine | stable character and scene elements; slow camera |
| `travel_poetic_film` | travel, scenery, person in destination, VO | real location anchors and emotional route |
| `food_aesthetic_short` | ingredients, cooking, plating, food story | food physics, texture, steam, sound details |

## Workflow

1. Analyze references and theme.
2. Lock final video spec.
3. Register or generate key elements.
4. Draft storyboard.
5. Confirm assets and shot plan.
6. Generate video clips.
7. Plan BGM, VO, and SFX if requested; bind or generate real audio only if this turn exposes audio capability.
8. Assemble timeline.
9. Run QA and optionally generate cover/social copy.

Pause after final spec, storyboard, key assets, first clip/batch, and final assembly. For autonomous runs, use critic review as confirmation substitute.

## Key Elements

Register:

- `Character_Main` if a person/creator appears,
- location/room/restaurant/kitchen scenes,
- recurring props,
- food/ingredient/dish assets,
- style references,
- master BGM or VO if present.

Character rule:

- If a user uploads a person reference, preserve identity anchors and outfit unless they ask for a restyle.
- If only a partial body image is available and full-body continuity matters, generate or request a full-body reference before video.

Scene rule:

- For daily vlog, store fixed furniture, light direction, color temperature, and object placement.
- For travel, store recognizable landmarks, vegetation, architecture, weather, terrain, and time of day.
- For food, store ingredient structure, color, surface moisture/oil, cooking state, vessel, tableware, and kitchen/restaurant light.

## Storyboard Rules

Each shot must include:

- `shot_id`,
- `duration`,
- `scene_element_id`,
- `visible_action`,
- `framing`,
- `camera_movement`,
- `light_and_color`,
- `audio_notes`,
- `continuity_from_previous`,
- `continuity_to_next`,
- `generation_references`.

Default timing:

- healing vlog: 6-10s per shot, no abrupt cutting,
- travel film: 5-15s per segment, use 15s units only when the model supports internal cuts,
- food film: one 15s unit may contain 5-12 micro-shots if the selected video tool supports internal cutting.

If adjacent travel or vlog segments continue the same scene, use the previous final frame/start frame strategy when supported.

## Healing Daily Vlog

Rules:

- Keep camera fixed, gently handheld, or very slow push/pull.
- Avoid high-energy transitions, aggressive music, and heavy plot.
- Use concrete actions: making coffee, opening curtains, watering plants, reading, cooking, rain at window, night lamp.
- Keep character appearance and room layout stable across shots.
- BGM should be instrumental and low-key. No VO unless user requests it.

Prompt focus:

- action + tactile details,
- light direction and softness,
- quiet ambient sound,
- no subtitles, no random text.

## Travel Poetic Film

Rules:

- Confirm duration, aspect ratio, VO need, and real location reference.
- If a person appears, bind a stable character reference first.
- Design an emotional route: arrival -> wandering -> encounter/detail -> wide reveal -> reflective close.
- VO text must be confirmed before final audio generation.
- Avoid inventing real-world claims about a place. Use visible geography from references or user-provided details.

Useful structure:

1. opening sensory hook,
2. first movement through place,
3. local detail or human-scale action,
4. wide scenic reveal,
5. reflective ending.

For VO:

- keep it concise,
- write in first person only if the user wants creator narration,
- align VO paragraphs to shot groups,
- do not burn subtitles into generated video unless exact text overlay is supported and requested.

## Food Aesthetic Short

Rules:

- Food physics matters: steam, oil, moisture, cutting, simmering, melting, plating.
- Use macro shots and sensory SFX.
- Prefer motion-match or physical-occlusion transitions: steam, spoon movement, knife motion, sauce pour, lid opening.
- Avoid plastic texture, impossible cooking transformations, fake text/logos, and dirty AI artifacts.

Storyboard each 15s food unit as:

- first 2-3s: visual hook, macro texture, steam, slicing, pour,
- middle: cooking action, hand movement, heat, liquid, seasoning,
- final: plating, taste reaction, table reveal, or human context.

Audio:

- retain useful generated SFX when clean,
- add/align sizzling, chopping, boiling, pouring, ceramic contact,
- use VO only if requested.

## Prompt Rules

Use the user's language for prompts unless this turn's tool list performs better in English. Exact VO/dialogue stays in the target output language.

Image prompts:

- reference placeholders,
- visible content only,
- stable identity/scene/food anchors,
- light, lens, material, texture,
- no random text or watermarks.

Video prompts:

- start from the confirmed storyboard,
- describe motion and sound, not abstract feelings,
- specify camera movement,
- keep embedded audio intent clear,
- include `no subtitles`, `no random text`, and `no extra music` when BGM/VO is assembled separately.

## Assembly and QA

Check:

- aspect ratio and platform safe areas,
- character/scene/food continuity,
- VO and BGM alignment,
- physical plausibility of cooking/food motion,
- no unwanted subtitles or watermarks,
- smooth transitions between same-scene clips,
- final mood matches chosen mode.

If QA fails, fix the smallest affected unit. Do not regenerate a whole film because one food macro or travel transition failed.
