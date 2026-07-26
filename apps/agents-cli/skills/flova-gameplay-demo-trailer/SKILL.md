---
name: flova-gameplay-demo-trailer
description: Use when 用户要生成游戏 Demo、伪实机演示、玩法预告、开放世界概念片、HUD/UI 关键帧、角色 Boss 战或游戏短片 trailer。
---

# Gameplay Demo Trailer

## Mission

用于游戏 Demo 与玩法预告：为原创游戏概念生成角色、场景、UI/HUD、三段式玩法演示或短 trailer。

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- gameplay demo video,
- fake/AI game capture,
- game trailer concept,
- RPG/action/boss battle demo,
- open-world city gameplay slice,
- UI/HUD keyframes,
- character select / dialogue / combat sequence,
- gameplay-style short with third-person camera.

Do not use it to reproduce commercial game names, official logos, UI, map icons, brand assets, exact trailer shots, or protected characters. Use original worlds and visual grammar.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Do not assume exact image/video model choices or UI lock capabilities. If exact UI text/position cannot be preserved by video generation, keep UI in still keyframes or add UI in assembly/post.

## Required Intake

Collect:

- game genre and core fantasy,
- visual style,
- protagonist and antagonist,
- setting,
- gameplay pillars,
- target duration,
- aspect ratio,
- whether HUD/UI should appear,
- whether dialogue, SFX, BGM, or VO are needed,
- reference images/assets if any.

If the user uploads a person photo to make a custom protagonist, use it only as identity/style reference and ask whether they want stylized game character conversion.

## Modes

| Mode | Use For | Core Rule |
| --- | --- | --- |
| `three-part_game_demo` | 45s demo with onboarding, narrative, combat | A/B/C 15s segments |
| `open_world_slice` | city/exploration/crime/chase/gameplay feel | original open-world grammar, no official IP |
| `single_gameplay_moment` | 5-15s simple action | one readable action and camera |

## Workflow

1. Lock final game/video spec.
2. Build gameplay structure.
3. Design key elements: protagonist, antagonist, scene, props, UI.
4. Generate/bind character and scene assets.
5. Generate UI/HUD or keyframe stills.
6. Generate video clips.
7. Add audio layers.
8. Assemble and QA.

Pause after spec, storyboard, character/scene assets, UI keyframes, first clip/batch, and final assembly.

## Three-Part Demo Structure

Default 45s:

- `Video_A_onboarding` 15s: title/start screen, character selection, loading, first playable scene.
- `Video_B_narrative` 15s: NPC interaction, objective reveal, world movement.
- `Video_C_combat` 15s: core combat, boss move, ultimate skill, victory/settlement UI.

Each segment should be internally coherent and not depend on random montage.

Required shot fields:

- `segment_id`,
- `gameplay_function`,
- `start_keyframe`,
- `end_keyframe_if_needed`,
- `character_refs`,
- `scene_refs`,
- `ui_layer_plan`,
- `camera_type`,
- `player_action`,
- `npc/enemy_action`,
- `audio/SFX`,
- `continuity`.

## Open-World Slice Rules

Use original visual grammar:

- tropical or humid city,
- wet asphalt reflections,
- street crowds,
- vehicle interiors/exteriors,
- phone/live-stream fragments,
- surveillance/bodycam inserts,
- motel/gas-station/harbor/swamp/industrial outskirts,
- social-media chaos without real app UI.

Do not mention protected game titles in final prompts unless the user specifically asks for reference language and the system policy allows it. Prefer:

```text
original open-world crime-action game trailer concept
```

Single-take slice:

- one simple action,
- one location,
- one camera behavior,
- 5-12s,
- no cuts.

Multi-cut event:

- one event in one place/time,
- 4-5 internal cuts,
- each cut carries one information point,
- preserve same character, vehicle, direction, lighting.

## UI and HUD Rules

Treat UI as a controlled design asset.

Plan:

- title/start screen,
- character select,
- skill panel,
- dialogue box,
- HUD with health/skill/currency,
- combat result/victory screen.

If exact UI must be readable:

- generate still UI frames,
- keep text short,
- prefer post/assembly overlay,
- avoid asking the video model to preserve tiny text across motion.

UI lock checklist:

- HUD locations,
- safe margins,
- no jitter,
- no changing icons unless planned,
- no random readable text.

## Character and Scene Assets

Character sheet:

- face closeup,
- full body front/back/side if continuity matters,
- outfit, material, silhouette,
- equipment/weapon,
- rig/game render style.

Scene asset:

- playable path,
- landmarks,
- light source,
- texture/material,
- gameplay obstacles,
- scale.

Boss/enemy:

- threat silhouette,
- weak-point visual if needed,
- attack style,
- defeat pose/result.

## Camera Types

Use only what fits the gameplay:

- third-person trailing camera with slight delay,
- over-the-shoulder aim,
- low vehicle chase camera,
- phone vertical spectator view,
- CCTV/bodycam insert,
- fixed menu/UI screen,
- cinematic boss reveal.

Do not combine too many camera grammars in a single short segment.

## Prompt Rules

Use original game terms and visible actions.

Video prompt structure:

```text
[camera type] <<<image_1>>> [character/action], <<<image_2>>> [scene], [UI plan if any], [enemy/environment motion], [SFX/audio], no subtitles, no random text, no official logos, no real brands.
```

For single gameplay slice:

```text
one continuous gameplay-like shot, one simple readable action, no cuts, no montage
```

For multi-cut event:

```text
multi-shot sequence with 4 quick cuts, same characters, same location, same time of day, same movement direction
```

For UI-heavy segments:

```text
keep HUD positions stable; if text cannot stay readable, reserve clean overlay zones for post-production UI.
```

## Audio

Plan separate layers when available:

- UI bleeps/clicks,
- ambient environment,
- combat impact SFX,
- crowd/radio/vehicle noise,
- dialogue/VO,
- BGM.

When clips are later assembled under dedicated audio, add `no music` to video prompts to avoid embedded music conflicts.

## QA

Check:

- game concept is original,
- no protected logos/official UI,
- protagonist/boss identity consistent,
- HUD not jittering or randomly changing,
- scene and movement direction remain continuous,
- gameplay action is readable,
- audio events align with action,
- clip lengths match final structure.

Fix one UI frame, one prompt, or one segment at a time.
