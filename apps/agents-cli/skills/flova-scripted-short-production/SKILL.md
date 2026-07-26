---
name: flova-scripted-short-production
description: Use when 用户上传剧本、小说片段、半结构化分镜或短剧设定，要把文本工业化拆解为剧情短片/微短剧视频，包含剧本分析、角色场景设定图、分镜、逐镜视频、音色参考、音频和时间线合成。
---

# Scripted Short Production

## Mission

用于剧本/故事文本到短片生产：从剧本或故事文本出发，拆解角色、场景、道具、镜头、音轨和视频片段，形成可执行的短片生产流程。

This workflow is the narrative/scripted short-film production layer. For 30s+ multi-clip final assembly, coordinate with `canvas-long-video-production`.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- uploaded script to video,
- short drama / micro-drama production,
- story-driven video,
- screenplay breakdown,
- script with voice references,
- storyboard-first narrative clip,
- generating character sheets, location sheets, shot videos, audio layers, and timeline plan.

Do not use it for purely visual product ads, manifesto films, or one-shot continuity sequences unless the user has a script/story that needs dramatic decomposition.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Use only tools and model choices exposed by this turn's tool list.

Map responsibilities:

- script analysis -> current text/vision/file analysis capability,
- storyboard -> `storyboard-script-writer` or current storyboard planner if available,
- long multi-clip orchestration -> `canvas-long-video-production`,
- character/scene assets -> current image generation tools,
- shot videos -> current image/video generation tools,
- audio -> current audio/voice tools if exposed,
- assembly -> current canvas/video assembly capability.

If a capability is unavailable, return the closest runnable artifact and mark the blocked stage.

## Input Classification

Classify the user input:

- `A_mature_shot_script`: already divided by scenes/shots, with camera language, actions, dialogue.
- `B_prose_or_dialogue_only`: novel prose, raw dialogue, synopsis, or idea without shot structure.
- `C_semi_structured_script`: has scene/action/dialogue but incomplete camera grammar.

Rules:

- A can move directly into storyboard refinement.
- C can move into storyboard with missing camera fields completed.
- B should be flagged as needing adaptation. You may offer a short-drama adaptation plan, but do not silently invent character appearance, location details, or plot events as if they were in the source.

## Required Intake

Collect or infer:

- current stage: from scratch, existing script, existing storyboard, existing assets, or existing clips.
- source text/file.
- target duration and platform.
- aspect ratio.
- output language.
- visual style.
- whether dialogue, narration, BGM, SFX are needed.
- voice references, if any.
- existing character/location/product/reference assets.

When character appearance, setting details, or style is missing, ask for the missing information or mark it as a user-confirmation item. Avoid silent creative invention for important continuity elements.

## Workflow

1. Analyze source script.
2. Create final video spec.
3. Build key elements and storyboard.
4. Generate or bind key element images.
5. Optionally create shot planning sheets or trajectory diagrams.
6. Generate shot videos.
7. Plan audio layers; bind or generate real audio only if this turn exposes audio capability.
8. Assemble timeline or return assembly plan.

Pause after:

- script analysis,
- storyboard draft,
- key element assets,
- shot planning sheets if used,
- shot videos,
- audio,
- final assembly.

For autonomous runs, use critic review as the confirmation substitute and state the decision.

## Script Analysis

Extract:

- logline / one-sentence summary,
- genre and tone,
- scene list,
- character list,
- character appearance/wardrobe only when explicitly provided,
- dialogue/VO,
- props,
- locations,
- act/beat structure,
- missing information,
- continuity risks.

Do not rewrite confirmed dialogue unless the user requests rewriting.

## Final Video Spec

Define:

- title,
- type,
- target duration,
- aspect ratio,
- visual style,
- language,
- model/tool preference if relevant,
- output structure,
- audio strategy,
- continuity strategy,
- confirmation policy.

This spec controls all later prompts. If user changes it, revise dependent storyboard/prompts.

## Key Elements

Register key elements for:

- main characters,
- recurring locations,
- key props,
- recurring vehicles/creatures/devices,
- voice references if supported.

Character element should include:

- age range only if provided or necessary,
- face/hair/wardrobe,
- body language,
- recognizable details,
- voice tone if relevant,
- multiple looks if story requires.

Location element should include:

- spatial structure,
- fixed landmarks,
- material,
- light source,
- color temperature,
- atmosphere,
- action zones.

Use uploaded assets when provided; do not regenerate equivalent assets unless user asks.

## Storyboard Rules

Each generated video shot should be <=15s unless current tool capability differs.

Prefer medium-length shots with internal cuts when the scene is continuous. Do not over-fragment a coherent action.

Each shot must include:

- `shot_id`,
- `scene_element_id`,
- `duration_target`,
- `space_anchor_card`,
- `characters_and_state`,
- `story_action`,
- `exact_dialogue`,
- `framing`,
- `camera_angle`,
- `camera_movement`,
- `internal_cuts`,
- `audio_notes`,
- `continuity_from_previous`,
- `continuity_to_next`.

Space anchor card:

```text
Scene: [scene name]
Fixed landmarks: [non-moving visual anchors]
Character states:
- [Character A]: position + facing + held object
- [Character B]: position + facing + held object
Light: [source + color temperature + mood]
```

Storyboard self-check:

- all source actions covered,
- all source dialogue preserved,
- no invented plot facts,
- shot duration <= supported limit,
- no cross-space movement inside one shot unless intentionally staged,
- adjacent shots preserve position/facing/held objects,
- no jump-axis issue unless intentional,
- character IDs remain stable,
- audio cues align with action.

## Prompt Modes

### Mode 1: Prompt Reuses Storyboard

Use when the creator wants to lock prompts before generation.

Rules:

- The shot description in the confirmed storyboard is the creative body of the video prompt.
- Do not write a new creative prompt that changes content.
- Only append technical constraints and reference placeholders.

### Mode 2: Prompt Engineering From Storyboard

Use when the storyboard is planning-level and needs model-ready wording.

Rules:

- Preserve story facts, dialogue, action order, and camera plan.
- Translate into camera -> subject -> space -> audio order.
- Add reference placeholders and negative constraints.
- Do not alter plot or dialogue.

## Asset Generation

Useful assets:

- character turnaround sheet,
- location sheet,
- prop sheet,
- outfit/look variants,
- shot planning sheet or camera trajectory diagram.

Character turnaround:

- one image with front/side/back if the tool supports it,
- consistent clothing/accessories/body proportions,
- neutral background.

Location sheet:

- multiple angles of same space if useful,
- no people,
- fixed landmarks visible.

Shot planning sheets are optional. They are for human confirmation and camera logic, not necessarily video reference.

## Video Prompt Rules

Order:

1. camera movement/cuts,
2. subject actions and expressions,
3. spatial/background changes,
4. audio/dialogue/SFX.

Dialogue:

- include exact character dialogue if the video model should render speech,
- use the target language,
- if separate voice/audio generation is planned, do not embed VO text in video prompt.

Always append:

```text
no music, no subtitles, no random text, no watermark
```

Use `reference_video` only when continuity is truly strong: same action, same scene, same motion thread, or direct carryover. Do not add previous video reference by default; it can over-constrain new camera design.

## Voice And Audio

Audio layers may include:

- character dialogue,
- narration,
- BGM,
- SFX,
- voice reference mapping.

If voice references are available and the this turn's tool list supports them, map each voice to a character. If not supported, preserve voice notes as production metadata.

BGM:

- at least one global track for narrative films unless user requests silent.
- multiple tracks only when story has clear emotional chapters.

Narration:

- use only when narration spans multiple shots or drives story.
- do not use narration layer for one or two short inner monologue lines unless helpful.

## Assembly Rules

Assemble in storyboard order.

Keep:

- scene continuity,
- character continuity,
- dialogue timing,
- BGM ducking under dialogue/VO,
- SFX aligned to visible action,
- no duplicate subtitles if subtitles are handled later.

If timeline assembly is unavailable, return ordered shot URLs, audio plan, and edit decision list.

## Quality Review

Check:

- script facts preserved,
- dialogue preserved,
- no unconfirmed character/scene invention,
- key elements match uploaded references,
- each shot has real URL before claiming generated,
- continuity across adjacent shots,
- audio strategy does not conflict with video prompt,
- no random text/subtitles/watermark,
- unsupported capabilities are marked.

If a shot fails continuity, regenerate that shot or adjust adjacent shot plan; do not silently modify the story.

## Output Contract

Return:

- `script_analysis`: classification, summary, characters, scenes, props, missing info.
- `final_spec`.
- `key_elements`.
- `storyboard`: shot table with space anchor cards.
- `asset_plan`: existing and generated assets.
- `prompts`: image/video/audio prompts.
- `media`: real URLs or pending states.
- `assembly`: final URL or edit decision list.
- `review`: pass/fail and regeneration needs.

Do not present a storyboard or prompt list as a finished short film.
