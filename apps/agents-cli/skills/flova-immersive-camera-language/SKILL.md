---
name: flova-immersive-camera-language
description: Use when 用户要第一人称 POV、FPV 穿越视角、沉浸式手持跟拍、肩后跟拍、呼吸感手持、低空穿梭、主观视线运动或真人叙事镜头语言设计。
---

# Immersive Camera Language

## Mission

用于沉浸式镜头语言设计：为短片、广告、Vlog、剧情片段提供严格 POV、FPV 飞行轨迹或手持跟拍的镜头约束和提示词规则。

This workflow is usually a module inside a larger creative workflow. Use it to design or review camera language for a segment, not necessarily to own the entire film pipeline.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## Modes

Choose exactly one primary mode per segment:

- `strict_pov`: camera is the protagonist's eyes.
- `fpv_flythrough`: drone-like first-person flight through space.
- `handheld_follow`: human operator handheld follow, shoulder/behind/near-subject.

Optional:

- `one_shot_mode`: reduce cuts and use physical transition continuity.
- `short_vertical_mode`: 9:16 social-video framing.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Use only durations and model choices exposed by this turn's tool list.

If current tools cannot honor reference video, frame extraction, long clips, or exact aspect ratio, state the limitation and return the closest runnable prompts/shot plan.

## When To Use

Use this skill for:

- "严格第一视角",
- "不要出现主角正脸",
- "FPV 穿越机俯冲穿门",
- "低空贴地穿梭",
- "手持跟拍有呼吸感",
- "肩后跟拍",
- "像人眼视线被声音牵引",
- "Vlog/微电影真人跟拍镜头".

Do not use this for generic story breakdown. Combine with `flova-scripted-short-production` or `canvas-long-video-production` when narrative structure is needed.

## Shared Intake

Collect:

- desired mode,
- reference images/videos,
- subject type,
- location/space,
- action,
- emotional beat,
- aspect ratio,
- duration/clip count,
- whether audio/dialogue drives camera movement.

For uploaded references, assign clear responsibilities:

- character identity,
- scene structure,
- prop detail,
- hand/POV partial body reference,
- motion style,
- color/light tone.

If references conflict in lighting, style, or identity, stop and ask which reference is authoritative.

## Anti-Lottery Gate

Before generating any clip, check:

- What is this clip proving?
- What is not being tested in this run?
- Is the subject unique?
- Is the camera mode unambiguous?
- Does each reference have one clear responsibility?
- Are abstract style words translated into visible anchors?
- What will the model most likely compensate incorrectly?
- What physical anchors must be visible?
- Are there terms that pollute the prompt?
- Does the shot violate POV/FPV/handheld mode?

If identity, space, material, or camera mode is unstable, simplify the prompt before adding more style language.

## Strict POV Mode

Hard rules:

- Camera is the protagonist's eyes.
- No external shot of the protagonist.
- No protagonist face asset unless seen as partial reflection.
- Visible protagonist body parts may include hands, sleeves, shoes, chest-edge object, partial reflection.
- Information counts only when it enters the protagonist's field of view.
- Major story events require visible anchors, not only sound.
- Dialogue can be dubbed later; do not rely on accurate model lip sync unless the current tool supports it.
- Phone screens, papers, names, and readable text should usually be handled in post, not generated in-video.

POV motion chain:

1. view starts at a visible anchor,
2. sound/action triggers attention,
3. view turns,
4. hand/body action occurs,
5. view lands on the important object/person,
6. final visible state is inherited by the next clip.

Prompt must explicitly say:

```text
strict first-person POV from the protagonist's eyes, no external view of the protagonist, no third-person camera
```

Use physical evidence for emotion:

- oppression -> low eye level, closed boundaries, compressed space, hesitant hand motion,
- loneliness -> empty frame, no stable gaze target, room tone/breath,
- warmth -> heat haze, reflected warm light, tactile contact,
- fear -> shallow breath, fast glance, hand recoil.

## FPV Flythrough Mode

Use for drone-like travel through space:

- dive,
- low pass,
- gap/threading movement,
- spiral orbit,
- high-speed flythrough,
- ground-skimming movement,
- vehicle/building/landscape traversal.

Analyze:

- subject type: people, architecture, landscape, vehicle,
- space depth,
- light direction,
- pass-through structures: doors, arches, alleys, bridge gaps, corridors, windows,
- safe trajectory and collision risks,
- aspect ratio: 16:9 default, 9:16 for vertical/social or vertical reference.

Default style by subject:

- people -> spiral orbit or shoulder-height pass,
- architecture -> high dive and facade orbit,
- landscape -> low ground/aerial traversal,
- vehicle -> fast tracking/flyby.

Complexity:

- `simple`: one major motion, no tight gaps.
- `standard`: 2-3 motions, one clear pass-through or orbit.
- `hard`: dive + gap + orbit + speed change, only when reference has enough spatial depth.

FPV prompt must include:

- starting altitude,
- path direction,
- key pass-through structure,
- speed change,
- camera height,
- final landing/reveal point,
- visible light direction.

If the reference lacks depth or pass-through structure, ask for a better environment image or simplify to orbit/push-in.

## Handheld Follow Mode

Use for realistic human-operated camera:

- handheld follow,
- shoulder-behind follow,
- Vlog-like pursuit,
- breath-like camera movement,
- emotional dialogue following,
- micro-film realism.

Rules:

- Avoid perfectly fixed/static camera unless user explicitly requests surveillance/locked tripod.
- If the scene is still, use breathing micro-movement rather than artificial drift.
- Camera movement must be motivated by action or emotion.
- Same scene should maintain light direction and color temperature.
- Track prop states across shots.
- Background people should have natural varied behavior when relevant.

Useful camera actions:

- handheld follow with footstep rise/fall,
- slow push/pull,
- whip pan for sudden attention shifts,
- orbit for confrontation/inner tension,
- crash zoom for shock,
- inertial overshoot after sudden stop,
- shoulder-behind FPV follow.

Do not use all movements in one clip. Choose based on emotion and story.

## Emotion To Camera Mapping

Use emotion as the reason for motion:

- anxiety/awaiting weak -> breathing micro-shake or slow push.
- anxiety medium -> handheld pacing follow.
- sadness weak -> slow push, low movement.
- sadness strong -> slow orbit or lowering camera.
- suppressed anger weak -> slow push locked on face.
- anger medium -> tense handheld follow and inertial overshoot.
- anger strong -> whip pan plus crash push.
- shock -> crash push or whip pan.
- warmth -> very light breathing movement or gentle push.
- confrontation -> orbit; tighten and speed up with intensity.
- release/ending -> slow pull-back and weakening micro-shake.

If dialogue contains pauses, align camera speed:

- short pause -> slow camera slightly.
- long pause -> almost hold with breathing micro-motion.
- inhale/choked pause -> slight camera dip.
- key word -> camera motion peak or cut lands on that word.

## Dialogue And Camera Sync

For dialogue scenes:

- mark speaker IDs,
- map lines to camera reactions,
- cut or reframe before the next speaker begins,
- include reaction shots with physical micro-actions,
- vary shot scale as emotion rises,
- avoid generic "sadly says" and instead write face/body/voice cues.

Dialogue cue format:

```text
Speaker: [Character_ID]
[face + body + voice cue] {exact line}
Camera behavior: [push / hold / cut / reaction / over-shoulder]
```

If audio is post-produced, keep lines in the storyboard/audio layer and avoid asking the video model to render accurate lip sync.

## Prompt Templates

### Strict POV

```text
Strict first-person POV from the protagonist's eyes. The protagonist is never shown from outside; only [hands/sleeves/shoes/reflection detail] may enter frame. The view starts on [visible anchor], reacts to [sound/action trigger], turns toward [target], [hand/body action], then lands on [final visual anchor]. [space/light/material details]. no third-person shot, no protagonist face, no subtitles, no random text, no music.
```

### FPV Flythrough

```text
First-person FPV flythrough. Camera starts at [height/distance], accelerates toward [path], passes through [gap/door/arch/corridor], [dive/orbit/ground-skim/whip movement], keeps [subject/landmark] readable, then ends at [reveal/landing point]. [light direction and environment depth]. no subtitles, no random text, no watermark, no music.
```

### Handheld Follow

```text
Realistic handheld follow camera. Camera stays [behind/near/over-shoulder/beside] [subject], with subtle breathing movement and step-based rise/fall. [subject action], [emotion-driven camera behavior], [dialogue or sound cue if intended], [space continuity and light direction]. no locked tripod feel, no subtitles, no random text, no watermark, no music.
```

## Quality Review

Check:

- selected mode is not contradicted by shot language,
- POV has no third-person protagonist shot,
- FPV path has real spatial depth and plausible trajectory,
- handheld motion is motivated and not random wobble,
- references are not conflicting,
- critical visual anchors are visible,
- dialogue/VO/audio plan does not conflict with video prompt,
- no unwanted subtitles/text/watermark,
- actual clip URL exists before marking generated.

If the output violates mode, reduce prompt complexity and regenerate that clip.

## Output Contract

Return:

- `mode`: strict_pov, fpv_flythrough, or handheld_follow.
- `reference_roles`: what each reference controls.
- `shot_plan`: camera path, visual anchors, action stages.
- `prompt`: ready-to-run video prompt.
- `media`: clip URLs or pending states.
- `review`: pass/fail against mode rules.
- `handoff`: how this segment plugs into the larger storyboard or timeline.

Do not present camera-language prompts as a full finished film unless a larger workflow has generated and assembled the clips.
