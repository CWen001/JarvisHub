---
name: flova-interactive-pov-vlog
description: Use when 用户要第一人称互动短片、陪伴感 POV、宠物/角色互动、双主体抓包喜剧、低角度手持 POV 或多段沉浸式 Vlog。
---

# Interactive POV Vlog

## Mission

用于第一人称互动短片：用严格 POV 约束设计陪伴、宠物、虚拟角色或双主体喜剧互动短片，重点控制镜头身份、可见主体、台词/SFX、跨段连续和合规边界。

This workflow is about viewpoint and interaction. It can be combined with `flova-immersive-camera-language` when detailed POV/handheld camera grammar is needed.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- first-person interactive vlog,
- companion POV scene,
- pet or mascot interacting with the camera,
- two-subject caught-in-the-act comedy,
- adult relationship POV with safe non-explicit affection,
- handheld low-angle POV,
- multi-segment POV continuity.

Do not use it for generic cinematic narratives, third-person dialogue scenes, or explicit sexual content.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model for reference analysis, character/scene assets, video clips, covers, and assembly. Treat audio and start-frame carryover as available only when exposed by this turn's tool list. If exact cross-segment frame carryover is unavailable, return explicit continuity prompts and reference-frame instructions.

## Intake

Collect:

- subject type: adult person, pet, mascot/IP-like original character, or two-subject comedy,
- reference images or text description,
- scene/theme,
- duration: 15s / 30s / 45s / 60s,
- aspect ratio,
- output language,
- whether dialogue, off-camera voice, SFX, cover images, or social copy are needed,
- interaction boundaries and forbidden actions.

If the user provides a real person reference for affectionate/romantic POV, confirm the scene is non-explicit and consensual. Do not use public figures for intimate content.

## Modes

| Mode | Use For | Core Rule |
| --- | --- | --- |
| `single_subject_pov` | one person/pet/character interacts with camera | only one main subject visible |
| `two_subject_comedy_pov` | pet + child-like fictional character, two pets, two mascots | camera is adult/observer POV; observer body not visible |
| `multi_segment_pov` | 30s+ across 2-4 segments | plan full arc before splitting |

## POV Rules

For `single_subject_pov`:

- The camera is the observer's eyes or phone.
- Only one main subject appears in frame.
- Observer may appear only as partial hand/sleeve if necessary.
- No full second person, no observer face/body, no third-person objective shot.

For `two_subject_comedy_pov`:

- Camera is the adult/observer viewpoint.
- Two subjects remain visible and interact in the scene.
- Observer body should not appear.
- Off-camera adult voice may be included if requested or central to the gag.

## Content Boundaries

Allowed:

- warm daily affection,
- playful teasing,
- safe closeness,
- pet/mascot interaction,
- light comedy conflict,
- caught-in-the-act reactions.

Not allowed:

- explicit sexual content,
- nudity,
- coercion, intoxicated incapacity, threats, or non-consensual framing,
- underage romantic/sexual implication,
- public figure intimate imitation,
- realistic harm to children, pets, or vulnerable subjects.

Rewrite risky user phrasing into safe, affectionate, daily-life interaction before generating prompts.

## Workflow

1. Analyze references and classify subject type.
2. Lock final POV spec.
3. Generate or bind character/subject references.
4. Plan full story arc.
5. Draft segment storyboard.
6. Generate scene/prop references if needed.
7. Generate POV clips.
8. Extract/carry final frame for next segment when supported.
9. Generate cover/social assets if requested.
10. Assemble and QA.

Pause after spec, reference character sheet, storyboard, scene/prop assets, first clip/batch, cover, and final assembly.

## Subject References

For a person:

- extract face, hair, outfit, style, light mood, but avoid oversexualized body detail,
- create/bind a stable character sheet if needed,
- preserve adult, consensual, non-explicit framing.

For a pet:

- extract species, fur/coat, face, size, temperament,
- prefer natural interaction: pet approaches, looks up, gets fed, plays, tilts head.

For mascot/original IP-like character:

- extract shape, material, palette, texture,
- avoid protected character names/logos unless user owns/permits them.

For two-subject comedy:

- create separate subject cards plus a scale relationship card if same-frame proportion matters.

## Story Arc

For 15s single-subject POV:

- 0-2s: establish environment and subject noticing camera,
- 2-5s: first interaction,
- 5-10s: escalation or turn,
- 10-15s: emotional/comedy landing.

For 30s+:

- plan the full timeline before writing segment details,
- each 15s segment must have a complete mini-beat,
- adjacent segments need clear continuity: pose, prop state, subject position, emotional state.

## Two-Subject Comedy Structure

Before storyboard, answer:

- What visible trouble happened?
- Where is the evidence?
- What does the off-camera observer react to?

A good gag has:

- visible physical evidence,
- two subjects' conflicting reactions,
- a final caught-in-the-act freeze or reaction.

Examples:

- food scattered,
- toy dismantled,
- forbidden place occupied,
- blanket pulled apart,
- spilled flour,
- stolen snack.

Keep it harmless and light. No injury or danger.

## Segment Fields

Each segment/shot must include:

- `segment_id`,
- `duration`,
- `pov_type`,
- `subject_ids`,
- `scene_element_id`,
- `visible_action_timeline`,
- `camera_behavior`,
- `dialogue_or_offscreen_voice`,
- `sfx`,
- `continuity_in`,
- `continuity_out`,
- `references`.

If dialogue is generated in-video, write exact lines and timing. If exact lip-sync is not supported, mark dialogue for audio/assembly.

## Camera Language

Single-subject:

- handheld phone POV,
- eye-level or seated POV,
- gentle push-in,
- small reactions from camera,
- close framing but no incoherent body occlusion.

Pet/mascot:

- low-angle handheld at subject height,
- small forward/backward camera reactions,
- hand enters only for feeding/petting/toy interaction.

Two-subject comedy:

- low observer viewpoint,
- action-driven pan/tilt/follow,
- quick push-in at the caught moment,
- visible evidence in the same frame as subject reaction.

Avoid aimless drifting. Camera movement must respond to the subject.

## Prompt Rules

Use reference placeholders. Keep prompts concrete and visible.

Single-subject template:

```text
<<<image_1>>> first-person POV from the observer, only the main subject visible, [scene], [subject action and expression], [camera movement], [dialogue/SFX if any], no subtitles, no random text, no full second person, no third-person shot.
```

Two-subject template:

```text
<<<image_1>>> <<<image_2>>> low-angle handheld POV from the adult observer, observer not visible, both subjects in frame, [visible trouble evidence], [interaction beats], [off-camera line/SFX], no subtitles, no random text, no harm.
```

For multi-segment continuity:

- include previous final state in the next prompt,
- use previous final frame/start frame if tool supports it,
- do not reset clothing, prop state, or emotion between segments.

## Audio Rules

Use in-video audio only when the selected tool supports it reliably.

Otherwise separate:

- SFX layer,
- off-camera voice,
- dialogue/VO,
- BGM if requested.

Do not add background music by default for POV realism unless user requests it.

## QA

Check:

- POV perspective not broken,
- observer does not appear beyond allowed partial hand/sleeve,
- only intended subjects appear,
- content stays safe and non-explicit,
- two-subject comedy has visible evidence,
- segment continuity holds,
- no random subtitles/text,
- audio/dialogue aligns with action,
- references remain consistent.

Fix the smallest failed unit: reference sheet, single segment prompt, one audio line, or one transition.
