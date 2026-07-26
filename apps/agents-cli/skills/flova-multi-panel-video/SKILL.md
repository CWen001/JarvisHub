---
name: flova-multi-panel-video
description: Use when 用户要把故事镜头做成多宫格/多面板关键帧拼版，再用拼版作为视频参考生成故事驱动视频、广告短片或剧情短片；适合多面板参考图 + 图生视频工作流。
---

# Multi-Panel Video

## Mission

用于多宫格关键帧转视频：每个视频镜头先生成一张多格关键帧拼版（multi-panel/contact sheet），再把该拼版作为该镜头视频生成的主要参考，指导内部剪辑与节拍。

This is for story-driven clips where one video shot contains several internal cuts or beats. The multi-panel image is a reference map, not the final video.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- multi-panel storyboard frames to video,
- contact sheet reference images for a single video shot,
- story-driven commercial or short-film clips,
- scenes with 2-6 internal beats inside one generated video,
- workflows that need one image reference to encode several shot states.

Do not use it when the user only needs a conventional storyboard table, a single keyframe, or a one-shot continuity workflow. Use `storyboard-image-production`, `flova-one-shot-ad-film`, or `canvas-long-video-production` as appropriate.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Use only tools exposed by this turn's tool list.

Required capability mapping:

- storyboard planning -> agent/storyboard planner,
- multi-panel image -> current image generation/editing capability,
- video from multi-panel image -> current image/video generation capability,
- audio and assembly -> this turn's tool list support or explicit plan.

If current tools cannot render text labels cleanly inside image cells, use separate metadata in the prompt and output table, but state that visible printed indices may be unreliable.

## Workflow

1. Define final video spec.
2. Create storyboard with key elements and shot list.
3. Bind user assets before generating replacements.
4. For each shot, create one multi-panel reference image.
5. Generate the video for that shot using its multi-panel reference image.
6. Plan or attach audio layers if needed; generate real audio only if this turn exposes audio capability.
7. Assemble or return ordered clip URLs and assembly plan.

Pause for confirmation after:

- spec,
- storyboard,
- element assets,
- each batch of multi-panel sheets,
- video clips,
- audio,
- final assembly.

For autonomous runs, replace pauses with critic checks and log decisions.

## Storyboard Design

Prefer a shot that uses the model's reliable clip duration budget and contains multiple internal beats. Do not split a single coherent moment into multiple video shots if it can be represented as one shot with a multi-panel reference sheet.

Each shot should include:

- `shot_id`
- `target_aspect_ratio`
- `duration_target`
- `scene`
- `key_elements`
- `internal_cuts`: numbered 1..N
- `audio_layers`
- `prompt_notes`

Each internal cut must include:

- cut index,
- visible moment,
- subject action,
- camera size/angle,
- camera movement implied into or out of the frame,
- light/color/mood,
- dialogue/SFX if any.

Recommended internal cut count: 2-6 per multi-panel image. If a shot has more than 6 important states, merge minor beats or split the shot.

## Multi-Panel Image Rules

For each video shot, generate one image containing N cells, where N equals the number of internal cuts.

Critical rule:

- The physical layout order on the image is not the timeline order.
- Timeline order is defined only by the printed cut index in each cell and the storyboard `internal_cuts` list.

Image requirements:

- one canvas,
- clear neutral dividers,
- each cell has the same aspect ratio as the target video output,
- each cell shows a distinct key state,
- each cell contains a small readable cut number, usually in the top-left corner,
- all cells share the same visual style, color grade, and character/product identity,
- no extra title, random poster text, watermark, subtitle, or decorative text unless requested.

If visible numbers may pollute final video generation, keep them small, high-contrast, and in a consistent corner, and reinforce in the video prompt that the labels are production metadata.

## Multi-Panel Image Prompt Template

Use this structure:

```text
Single image contact sheet with [N] separated cinematic frames. Every cell is composed in native [target aspect ratio] to match the final video. Thin neutral dividers between cells. Each cell has a small readable production index [1..N] in the top-left corner matching the storyboard cut list. The spatial layout is flexible and does not define time order. Consistent character/product identity, consistent wardrobe, consistent scene logic, consistent color grade.

Cut 1: [visible moment, framing, action, light, style].
Cut 2: [visible moment, framing, action, light, style].
...
Cut N: [visible moment, framing, action, light, style].

No subtitles, no watermark, no random text, no extra logos.
```

When references exist, use image-to-image or equivalent this turn's tool list path and name which reference preserves which element.

## Video Prompt Rules

When the main reference is the multi-panel sheet, start with:

```text
live action
```

Then describe:

- which image is the multi-panel reference,
- which images are character/product/scene references,
- that the video follows printed cut numbers 1 -> 2 -> ... -> N,
- that the grid's spatial arrangement is not the timeline order,
- ordered dynamic flow from cut to cut.

Prompt order:

1. Camera movement and cut rhythm.
2. Subject action and expression.
3. Spatial/background changes.
4. Dialogue/SFX/music only when intended.

Template:

```text
live action. Use <<<image_1>>> as the multi-panel reference sheet. Follow the printed cut indices 1 to [N] as the true story order; do not infer time order from the sheet layout. Cut 1 begins with [dynamic description]. Cut 2 continues with [dynamic description]. ... Cut [N] ends with [dynamic description]. Preserve all character/product identities from the reference assets. [camera/style/light rules]. no subtitles, no watermark, no random text, no music.
```

Avoid precise wall-clock instructions like "at exactly 3.0s." Use ordered cut numbers and relative beat language instead.

If there is a separate narration track, do not put the narration text in the video prompt unless the current model should generate speech.

## Asset Rules

Bind user-provided assets first:

- character images,
- product images,
- scene references,
- music/voice references,
- style/color references.

Generate missing elements only as needed:

- one identity reference for each recurring character,
- one product reference for each recurring product,
- one scene reference for each recurring location,
- one prop reference for recurring props.

Do not generate a separate asset for every cell. The multi-panel sheet already carries per-cut frame states.

## Audio Rules

Plan audio at storyboard level:

- global BGM,
- narration,
- dialogue,
- sound effects.

Use wrappers in prompts only if the current video model is expected to produce those sounds:

- music: `(...)`,
- sound effect: `<...>`,
- dialogue: `{...}`,
- screen title: `【...】`.

Otherwise, keep video prompts clean and attach/assemble audio separately.

## Quality Review

Review the multi-panel image:

- all cut numbers present and readable,
- number count matches storyboard,
- each cell aspect ratio matches target video,
- identities remain consistent,
- no random text/watermark,
- each cell shows a distinct useful state.

Review the generated video:

- follows cut index order,
- does not visibly treat grid layout as timeline order,
- keeps character/product identity,
- includes the planned internal beats,
- avoids unwanted subtitles/text/watermark,
- does not overfit to visible cell dividers or index labels in a way that breaks the video.

If the video follows the wrong order, rewrite the prompt to emphasize the cut index order and reduce layout descriptions.

## Output Contract

Return:

- `spec`: title, ratio, duration, style, language.
- `storyboard`: shot list with internal cut indices.
- `assets`: reused/generated element references.
- `multi_panel_sheets`: one image URL per shot plus cut count.
- `video_prompts`: one prompt per shot.
- `media`: generated clip URLs or pending states.
- `audio`: planned/generated audio layers.
- `assembly`: final video URL or ordered assembly plan.
- `review`: sheet and video checks.

Do not present a multi-panel sheet as the final video.
