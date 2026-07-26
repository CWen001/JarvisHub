---
name: flova-one-shot-continuity-film
description: Use when 用户要生成一镜到底广告短片、影视长镜头、高连贯性故事短片、连续运镜、前一镜头末帧承接下一镜头、顺序生视频或需要逐镜确认的短片。
---

# One-Shot Continuity Film

## Mission

用于一镜到底连续短片：用首帧承接、前置视频参考或物理连续调度，让多个镜头看起来像一个连续长镜头短片。

This is a strict sequential workflow. Do not parallelize shot generation for this skill, because Shot N depends on Shot N-1's final frame or reference video.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## Canvas-Native Boundary

This workflow uses the JarvisHub canvas execution model. Use the JarvisHub canvas harness tools and subagents for asset binding, image/video generation, frame extraction, and final assembly.

If the this turn's tool list cannot extract the last frame, cannot use `reference_video`, or cannot use start/end frames, state the limitation and choose the closest supported execution path. Do not claim seamless continuity when the required reference chain was not actually used.

## When To Use

Use this skill for:

- one-shot advertising films,
- one-shot cinematic shorts,
- continuous story ads,
- high-continuity commercial shorts,
- physical long-take sequences,
- product/brand films that move through spaces without obvious cuts,
- sequential video generation where each shot must inherit the previous shot's end state.

Do not use this skill for high-energy beat-cut montages. Use `flova-beat-cut-motion-video` for that. For long narrative films with many scenes, use `canvas-long-video-production` first and apply this skill to a specific continuous sequence.

## Required Intake

Collect or infer:

- `brief`: brand/product/story goal.
- `duration`: total duration and approximate shot count.
- `aspect_ratio`: platform target; default to 9:16 for short-video ads, 16:9 for cinematic ads.
- `continuity_mode`: `last_frame_bridge` or `reference_video_bridge`.
- `visual_style`: cinematic style, color grade, lighting, tone.
- `language`: exact dialogue/VO language if there is speech.
- `provided_assets`: uploaded product/character/location/music/voice references.
- `confirmation_policy`: whether the user wants to confirm every shot; default yes for production runs.

If the user has not selected a continuity mode, explain the tradeoff briefly:

- `last_frame_bridge`: faster and cheaper; can have slight "brake" or still-frame feeling at seams.
- `reference_video_bridge`: smoother motion continuity; slower and more expensive if supported.

When the user asks for immediate execution and has not chosen, default to `last_frame_bridge` unless they explicitly prioritize maximum smoothness.

## Workflow

1. Define the final video spec.
2. Build a storyboard with key elements, shot list, audio layers, and continuity notes.
3. Bind existing user assets before generating new assets.
4. Generate missing element images only when needed.
5. Generate shots strictly in order.
6. After each shot, review the real video URL and decide whether to continue, regenerate, or adjust.
7. Assemble only after all required shots are accepted.

Never batch-generate Shot 2+ before Shot 1 is accepted.

## Storyboard Rules

Design fewer, longer shots. A "one-shot" effect benefits from internal movement rather than many disconnected cuts.

For each shot include:

- `shot_id`
- `duration_target`
- `scene_element_id`
- `characters_or_products`
- `opening_state`
- `ending_state`
- `camera_movement`
- `subject_action`
- `space_change`
- `dialogue_or_vo`
- `continuity_bridge_from_previous`

From Shot 2 onward, the opening state must explicitly match the previous shot's ending state:

- character/product position,
- gaze and body orientation,
- hand/object state,
- camera angle and scale,
- lighting direction,
- scene layout,
- motion direction.

Avoid teleporting the subject or changing location abruptly unless the transition is an intentional match cut and the prompt states how the visual match is achieved.

## Asset Rules

Before generating:

- Reuse uploaded product, character, location, voice, and music references.
- Bind each asset to the storyboard slot it supports.
- Generate missing characters with consistent identity sheets when needed.
- Generate missing locations/props only if the story requires them.

Character reference images should show the key identity clearly. If one character needs multiple looks, name each look, such as `Look_1_workwear`, `Look_2_evening`.

Do not generate duplicate assets when a user-provided asset already satisfies the slot.

## Sequential Generation Modes

### Mode A: last_frame_bridge

Use when the harness can extract a still image from the previous video and pass it as the next shot's start frame or reference image.

Shot 1:

- Generate from the relevant key elements and initial scene prompt.
- Review the actual video.

Shot N where N > 1:

- Extract a clean final frame from Shot N-1.
- Reject frames that are black, glitched, faded out, or motion-smeared beyond recognition.
- Register the extracted frame as Shot N's start reference.
- Generate Shot N with the extracted frame plus required key elements.
- Prompt must say the video starts from the referenced frame.

### Mode B: reference_video_bridge

Use when the harness can pass the previous shot video as a reference video.

Shot 1:

- Generate from key elements and initial scene prompt.
- Review the actual video.

Shot N where N > 1:

- Bind Shot N-1's final video as the reference video for Shot N.
- Include any required key elements for identity preservation.
- Prompt must say the video continues from the end of the previous video.

This mode should be selected only when the this turn's tool list supports reference-video conditioning and the user accepts higher cost/latency.

## Regenerating A Middle Shot

When the user dislikes Shot N after later shots already exist:

- Preserve Shot N's original start reference.
- Use Shot N+1's start reference as the target end reference if the harness supports end-frame generation.
- Regenerate Shot N as a bridge between the original start and the next shot's start.
- Re-review the new Shot N before assembly.

If end-frame generation is not supported, regenerate Shot N and then consider regenerating Shot N+1, because continuity may no longer match.

## Video Prompt Rules

For every video prompt, describe motion in this order:

1. Camera movement.
2. Subject action and facial/body detail.
3. Spatial change and background continuity.
4. Dialogue/sound effects only when generated by the video model.

For `last_frame_bridge` Shot N > 1, include:

```text
The video starts from <<<image_1>>>, which is the final frame of the previous shot. Preserve the subject position, camera scale, lighting direction, and motion direction from <<<image_1>>> before continuing the camera move.
```

For `reference_video_bridge` Shot N > 1, include:

```text
Continue from the ending of <<<video_1>>>. Preserve the last visible subject pose, camera direction, lighting, and spatial momentum, then continue the one-shot camera movement naturally.
```

For a regenerated middle shot with start/end references, include:

```text
Start from <<<image_1>>> and transition smoothly so the final frame matches <<<image_2>>>. Maintain character/product identity, lighting continuity, camera direction, and spatial layout between both references.
```

Always include negative constraints:

- no subtitles,
- no unwanted text,
- no watermark,
- no random identity change,
- no music if audio is handled separately.

If the storyboard has separate narration, do not put the narration script inside the video prompt unless the current video model is meant to generate speech.

## Assembly Rules

The visual seam should be a pure cut when start/end continuity was generated correctly. Do not add dissolves, white flashes, or decorative transitions to hide errors unless the user asks for stylized transitions.

Audio should remain continuous across shot seams:

- global BGM should not restart per shot,
- narration should follow the storyboard timeline,
- sound effects should not pop or cut at seams.

If the harness supports timeline assembly, assemble only accepted shots. If not, return the accepted shot URLs and an explicit assembly plan.

## Quality Review

For each generated shot, verify:

- real video URL exists and is playable,
- subject identity/product shape remains stable,
- opening state matches the bridge reference,
- ending state is clean enough to bridge forward,
- camera movement continues naturally,
- no black/faded/glitched final frame,
- dialogue/VO handling matches the plan,
- no unwanted subtitles/text/watermarks.

Before moving from Shot N to Shot N+1, ask for confirmation when doing an interactive production run. For fully autonomous runs, use the critic result as the confirmation substitute and log the decision.

## Output Contract

Return:

- `spec`: title, duration, aspect ratio, style, language.
- `continuity_mode`: chosen bridge mode and why.
- `storyboard`: ordered shot table with opening/ending continuity notes.
- `assets`: reused and generated assets.
- `shot_generation_log`: per-shot input references, video URL, review result.
- `assembly`: final video URL or assembly plan.
- `issues`: any failed bridge, missing harness capability, or shot needing regeneration.

Do not describe the film as "one-shot" if shots were generated independently without frame/video bridging.
