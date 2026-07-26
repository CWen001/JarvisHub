---
name: flova-dialogue-interview-video
description: Use when 用户要制作多人对话、访谈、采访、圆桌、谈话节目、角色正反打或音频驱动口型/表演视频，并需要发言镜头、反应镜头、音轨和时间线控制。
---

# Dialogue Interview Video

## Mission

用于多人对话与访谈视频：为采访、圆桌访谈和角色谈话场景设计 key elements、对话音频层、关键帧、发言镜头、反应镜头和最终时间线。

This workflow is dialogue-first. Audio and speaker turns control the edit.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- interviews,
- multi-person dialogue,
- talk-show style videos,
- roundtable clips,
- scripted conversations,
- voice/audio-driven talking-head shots,
- reaction inserts during dialogue.

Use `flova-scripted-short-production` for broader drama scenes with action-heavy story structure. Use this skill when the problem is specifically dialogue performance and conversational editing.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Use audio-driven dialogue video only when this turn exposes a real audio-driven tool.

If this turn exposes audio-driven image-to-video, use it for dialogue shots. If not, generate visual performance clips and preserve dialogue as script/timeline metadata or bind user-provided audio assets.

## Workflow

1. Create final video spec.
2. Build storyboard with characters, setting, shot list, and audio layers.
3. Generate or bind character/location/prop assets.
4. Create dialogue/audio layer plan; generate real audio only when a dedicated audio tool is exposed.
5. Generate keyframes per shot.
6. Generate dialogue shots or non-dialogue reaction shots.
7. Assemble with audio as the master timeline.

Pause after:

- spec,
- script/storyboard,
- character and scene assets,
- keyframes,
- dialogue audio,
- video clips,
- final assembly.

## Required Intake

Collect:

- participants and roles,
- dialogue script or interview outline,
- language,
- target format,
- aspect ratio,
- setting,
- visual style,
- whether lip sync/audio-driven generation is needed,
- voice references,
- BGM preference,
- subtitle policy.

If dialogue is not scripted, ask whether to generate an interview script or use bullet points.

## Key Elements

For each speaker:

- identity and visual reference,
- current look/wardrobe,
- seating/standing position,
- voice/tone if available,
- relationship to other speakers,
- recognizable expression habits.

For the set/location:

- seating layout,
- camera directions,
- key props,
- background depth,
- light direction,
- visual anchors.

Provided assets must be reused and bound before generating substitutes.

## Storyboard Rules

Each shot should be one of:

- `speaker_single`: active speaker close/medium close.
- `two_shot`: two speakers in one frame.
- `over_the_shoulder`: foreground listener, focus on speaker.
- `reaction`: listener reaction while another speaker talks.
- `host_or_moderator`: question/transition.
- `cutaway`: prop, audience, notes, environment.

For alternating dialogue, split into separate shots if two people speak back and forth. Do not pack many alternating speakers into one shot unless the current tool can reliably handle it.

Shot fields:

- `shot_id`,
- `speaker`,
- `dialogue_text`,
- `audio_asset_or_plan`,
- `shot_type`,
- `framing`,
- `camera_angle`,
- `listener_reaction`,
- `body_action`,
- `keyframe_goal`,
- `duration_target`,
- `timeline_position`.

Use reaction shots to prevent flat talking-head sequences.

## Audio Rules

Audio layers are the master when real audio exists; otherwise the dialogue script and timing plan are the master:

- dialogue/voice,
- narration if applicable,
- BGM if desired,
- room tone,
- SFX if needed.

If using audio-driven video:

- align the exact audio segment to the dialogue shot,
- use a clear keyframe with face visible enough,
- avoid wide shots where lips are too small.

If not using audio-driven video:

- keep dialogue in separate audio layers,
- do not ask the video model to generate precise mouth movements,
- use reaction/gesture shots to reduce lip-sync dependence.

BGM should stay low under speech or be omitted.

## Keyframe Rules

For dialogue keyframes:

- face must be clear,
- chest-up, medium close-up, or close-up preferred,
- avoid very wide shots for active speaker,
- maintain eyeline between speakers,
- use two-shots and OTS for spatial context.

For reaction keyframes:

- no speaking required,
- capture micro-expression,
- use listener's face and body tension,
- keep reaction short and specific.

Generate later keyframes in the same setting using earlier similar keyframes as continuity references when supported.

## Prompt Rules

Dialogue shot prompt should describe dynamic change, not re-describe the static keyframe.

Template for audio-driven dialogue shot:

```text
Camera [movement or hold] on [speaker]. [Speaker] speaks the attached audio with [emotional state], [face/body action], while [listener/background action]. Keep the speaker identity and eyeline from the keyframe. no music, no subtitles, no random text, no watermark.
```

Template for non-dialogue reaction shot:

```text
[Listener] remains silent, [specific micro-expression and body reaction], eyes shift toward [speaker/object], [small camera behavior]. no dialogue, no music, no subtitles, no random text, no watermark.
```

Avoid:

- generic "talking naturally" with no expression/action,
- asking the video model to burn subtitles,
- adding BGM inside every video prompt when timeline audio handles it.

## Editing Rules

Audio controls pacing:

- cut to the next speaker just before or at the line start,
- allow tail audio to overlap reaction shot when natural,
- add reaction inserts during important lines,
- tighten dead pauses unless silence is intentional,
- duck BGM under speech.

Use visual variation:

- single -> OTS -> reaction -> two-shot,
- gradually tighten shot scale as tension increases,
- return to two-shot when the conversation resets.

## Quality Review

Check:

- speaker identity is stable,
- face visibility is adequate for dialogue shots,
- audio/text matches the intended speaker,
- reaction shots are meaningful,
- eyelines make spatial sense,
- no random subtitles/text/watermark,
- BGM does not conflict with speech,
- real media URLs exist before claiming generation.

If lip sync is poor, reduce reliance on active-mouth closeups and use reaction/OTS/cutaway edits.

## Output Contract

Return:

- `spec`,
- `participants`,
- `dialogue_or_interview_outline`,
- `shot_list`,
- `audio_layers`,
- `keyframes`,
- `video_prompts`,
- `media`,
- `assembly_plan`,
- `review`.

Do not present audio-less keyframes as a finished interview video.
