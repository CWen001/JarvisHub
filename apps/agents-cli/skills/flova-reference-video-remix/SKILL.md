---
name: flova-reference-video-remix
description: Use when 用户上传参考视频并要求拉片复刻、换脸、换人、换背景、换主体、复用运镜节奏、保留原视频剪辑结构或生成同款但不同主题的视频。
---

# Reference Video Remix

## Mission

用于参考视频复刻与主体替换：先把参考视频拆成可执行镜头证据，再根据用户意图做结构复刻、主体替换或背景替换。

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- reference video breakdown,
- remake this video with another subject,
- replace face/person/body/background in a video,
- keep original camera motion and rhythm,
- use source video as structural template,
- recreate shot language with new characters/assets.

Do not use it for creating a new story from scratch unless a reference video is the main constraint.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Do not assume direct video-to-video editing is available. If precise video modification is unavailable, return shot-by-shot prompts using the reference video as structural evidence and mark true replacement as blocked.

## Required Intake

Collect:

- source/reference video,
- goal: structural remake, subject replacement, background replacement, or combined,
- replacement reference images,
- which elements must stay unchanged,
- which elements may change,
- output duration/aspect ratio,
- whether original audio should be kept, replaced, or ignored.

If reference images are low quality, flag risk before proceeding.

## Modes

| Mode | Use For | Core Rule |
| --- | --- | --- |
| `structure_remake` | new subject/story using same shot grammar | copy rhythm and camera, not pixels |
| `subject_replace` | replace face/person/body/product | preserve motion and timing |
| `background_replace` | replace scene/background | preserve foreground action and camera |
| `combined_replace` | person + background | confirm priority and risk per shot |

## Workflow

1. Analyze source video.
2. Produce shot breakdown table.
3. Confirm user edits to timing/camera/action.
4. Analyze replacement references.
5. Build storyboard from confirmed breakdown.
6. Bind source video segments and reference assets.
7. Generate or edit shot by shot.
8. Assemble using source timing.
9. QA against source.

Pause after breakdown, reference analysis, storyboard, each generated shot/batch, and final QA.

## Source Video Breakdown

For each segment, output:

- `shot_id`,
- `time_range`,
- `duration`,
- `cut_type`,
- `camera_movement`,
- `movement_speed`,
- `framing`,
- `subject_action`,
- `background`,
- `audio/dialogue`,
- `reference_keyframes`,
- `replacement_difficulty`: low/medium/high,
- `risk_reason`.

Segment by story beat, not every tiny cut, but no generated segment should exceed the current video model's reliable duration.

Let the user edit the table. Do not proceed until the timing/camera interpretation is confirmed.

## Replacement Reference Analysis

For people:

- face visibility,
- head angle,
- hair,
- skin tone,
- outfit,
- body proportion,
- occlusion,
- lighting compatibility.

For background:

- scene type,
- depth,
- light source,
- color temperature,
- perspective,
- moving elements.

Risk gate:

- low-res face,
- heavy motion blur,
- side angle >45 degrees,
- occlusion,
- incompatible lighting,
- complex hair/transparent edges,
- moving foreground crossing the replacement zone.

Ask for better references or permission to generate supplemental references when risk is high.

## Storyboard Rules

Each shot must directly map to a source-video segment.

Fields:

- `source_shot_id`,
- `source_time_range`,
- `replacement_mode`,
- `camera_inheritance`,
- `action_inheritance`,
- `target_elements`,
- `reference_assets`,
- `color_match_notes`,
- `audio_policy`,
- `generation_prompt`.

Do not add new camera movement or new action. If the user wants creative changes, label it as a remake rather than replacement.

## Prompt Rules

For replacement:

```text
Use the source video segment as motion and camera reference. Replace [target] with <<<image_1>>>. Preserve the original camera movement, action timing, body motion, cut rhythm, lighting direction, and color tone. Do not add new camera movement. No subtitles.
```

For structure remake:

```text
Follow the reference segment's camera grammar and editing rhythm: [confirmed breakdown]. Replace the subject/story content with [new content]. Preserve shot length, framing, and movement logic, but do not copy protected logos or exact branded content.
```

For background:

```text
Replace only the background with <<<image_2>>> while preserving the foreground subject motion and original camera movement. Match color temperature, contrast, and perspective to the source video.
```

## Audio Rules

Default:

- keep original audio for replacement unless user says otherwise,
- for structural remake, design new audio layers,
- if dialogue is replaced, note lip-sync risk unless supported.

## QA

Compare against source:

- shot count and timing,
- camera motion,
- action rhythm,
- color/contrast,
- edge integration,
- identity similarity,
- background perspective,
- audio sync,
- total duration.

If a shot fails, regenerate only that shot or ask whether the user accepts the artifact. Do not silently shift timing to hide problems.
