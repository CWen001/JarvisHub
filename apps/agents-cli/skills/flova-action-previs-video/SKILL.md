---
name: flova-action-previs-video
description: Use when 用户要把动作构思、打斗动作、已有动作分镜/PREVIS 板、角色三视图和场景参考转成连续动作视频，重点控制动作节拍、镜头衔接、角色一致性和多板连续性。
---

# Action Previs Video

## Mission

用于动作预演视频：从动作构思或已有 PREVIS 分镜图出发，生成或解析动作分镜板，并结合角色三视图、场景参考和逐板视频生成，制作连续动作预演片段。

This workflow is for action choreography and previs, not general narrative production.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## Modes

Ask which entry mode applies:

- `idea_to_previs_to_video`: user has action idea or written choreography; generate PREVIS boards first, confirm, then video.
- `previs_to_video`: user already has PREVIS/storyboard images; analyze boards, map them into storyboard shots, then video.

Do not silently downgrade `previs_to_video` to idea mode if the user says they already have boards but has not uploaded them yet. Ask for the boards.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Use only model and parameter choices exposed by this turn's tool list.

Map responsibilities:

- board/image analysis -> current vision analysis,
- PREVIS board generation -> current image generation,
- character/scene asset binding -> current asset system,
- action video clips -> current image/video generation,
- final assembly -> current timeline/video capability.

If a current tool cannot parse boards, generate 15s clips, use reference_video, or assemble timelines, mark the limitation and return the best runnable plan/prompts.

## Required Intake

Collect:

- mode,
- action concept or uploaded PREVIS boards,
- total board count,
- aspect ratio, default 16:9,
- visual target for final video,
- character three-view references,
- scene references or whether scene images should be generated,
- whether continuity between boards is strict or montage-like.

Before video generation, character three-view or sufficiently strong character reference is required for each recurring character. If missing, pause and ask.

## Workflow

1. Lock final spec.
2. Analyze uploaded assets and register/bind them as soon as they are understood.
3. Build storyboard.
4. If mode A, generate PREVIS boards and confirm each board.
5. Get or generate scene references.
6. Bind PREVIS boards, character references, and scenes to shots.
7. Generate action videos board by board in order.
8. Assemble in order or return edit decision list.

Important: video board generation is sequential, not parallel, because later boards may depend on prior board continuity and confirmed outcomes.

## Asset Registration Rules

Register and bind immediately after analysis:

- each character three-view -> `element character`,
- each scene reference -> `element scene`,
- each PREVIS board -> corresponding `shot`,
- unresolved assets -> mark `[pending binding]` and ask user to assign.

Do not postpone asset registration until the end of storyboard work. It creates avoidable mismatch risk.

## PREVIS Board Analysis

For uploaded boards, parse each panel:

- frame index,
- shot scale,
- camera movement,
- main action beat,
- reaction/impact action,
- visible labels or notes,
- movement arrows,
- impact markers,
- overall board motion direction,
- cut points,
- continuity from previous board.

If a panel is unreadable, mark it `[needs user supplement]`. Do not invent missing action.

Storyboard mapping per board:

- `board_id`,
- `frame_range`,
- `action_beat_sequence`,
- `camera_choreography`,
- `continuity_note`,
- `density`: high-density action or low-density transition,
- `target_duration`.

Duration:

- high-density action board: about 6-8s.
- low-density transition board: about 10-15s.
- never exceed current tool limit.

## PREVIS Board Generation

When generating boards from an idea:

- one board is one image,
- up to 8 action frames by default,
- stick-figure or rough hand-drawn PREVIS style unless user asks otherwise,
- simple spatial geometry,
- visible motion arrows,
- impact markers,
- camera info bar,
- character labels stable across panels.

Board prompt should encode:

- frame count,
- frame layout,
- character labels,
- movement vectors,
- impact/contact points,
- camera info,
- frame-to-frame transition cues.

Keep PREVIS boards readable. Do not render realistic character detail in the PREVIS board unless the user explicitly wants final-style storyboard frames.

## Storyboard Rules

Each board becomes one video shot.

Each shot must include:

- associated PREVIS board asset,
- action beat sequence,
- camera start/end,
- character labels and roles,
- scene,
- continuity from previous board,
- target duration,
- references required,
- whether previous video reference is allowed.

Continuity:

- if the previous board ends with Character A on right facing left, next board should begin accordingly unless a cut/montage break is intended.
- if board shows hit -> fall, next board must begin from impact/fall posture.
- if no continuity note exists, do not over-constrain it.

## Video Generation Rules

Reference priority for each board:

1. PREVIS board: primary choreography and action timing reference.
2. Character three-views: identity and costume reference.
3. Scene image: space and tone reference.
4. Previous final video: optional, only for strong continuity.

Use previous video reference sparingly. For many boards, reference-chain errors can compound.

For projects with 5+ boards:

- generate in storyboard order,
- after every 5 boards, run a consistency precheck,
- fix current batch issues before continuing,
- if one board fails, keep it in a retry list but do not assemble with an empty placeholder.

If the same failure appears across 3 consecutive boards, pause and treat it as systemic: character reference too weak, scene unclear, or prompt overcomplicated.

## Prompt Rules

Video prompt should not repeat everything visible in the PREVIS board. Use it to add:

- speed quality,
- force/weight,
- causality,
- starting state,
- ending state,
- spatial continuity,
- character identity preservation,
- final visual style.

Template:

```text
Use the PREVIS board <<<image_1>>> as the primary action choreography reference. Follow the panel order and movement arrows. Preserve Character A/B/C identities from the attached character reference images. The clip begins with [starting posture/location], performs [action sequence and force quality], camera [movement], and ends with [ending state for next board]. [scene/light/style]. no subtitles, no random text, no watermark, no music.
```

If PREVIS board has labels/text, state that labels are production metadata and should not appear as final in-scene text.

## Failure Handling

Current board quality failure:

- stop,
- show issue,
- regenerate current board/clip with tighter prompt.

Continuity break:

- add explicit starting position constraints,
- regenerate current board,
- after repeated failure, ask whether to accept jump cut, provide transition frame, or revise storyboard.

Character drift:

- strengthen character reference and description,
- do not keep generating later boards with weak identity.

Skipped board:

- keep in retry list,
- never enter final assembly as blank.

## Quality Review

Check each board video:

- real video URL exists,
- action order matches PREVIS,
- character identity remains stable,
- scene reference is preserved,
- impact/reaction causality is clear,
- board-to-board continuity is acceptable,
- no random subtitles/text/watermarks,
- unresolved boards are marked.

Before final assembly, produce a board list with status and total duration.

## Output Contract

Return:

- `mode`,
- `final_spec`,
- `assets`: board, character, scene bindings,
- `storyboard`: board-to-shot mapping,
- `prompts`: per-board prompts,
- `media`: per-board video URLs or pending states,
- `retry_list`,
- `assembly_plan`,
- `review`.

Do not present PREVIS boards as final action video.
