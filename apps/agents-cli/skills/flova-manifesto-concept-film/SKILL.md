---
name: flova-manifesto-concept-film
description: Use when 用户要把观点、品牌议题、社会议题或抽象主张制作成宣言式概念短片：英文旁白为骨架、画面零文字、强符号视觉、21:9 电影宽银幕、VO 主时钟、思辨短片。
---

# Manifesto Concept Film

## Mission

用于宣言式概念短片：将一个观点、品牌议题或抽象主张，编译成由英文 VO 驱动、无画面文字、强符号视觉构成的概念影像。

This workflow is not a normal ad, vlog, MV, product demo, or narrative short. It is an argument film: one thesis, one voice, one visual system, and a controlled sequence of symbolic images.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## Hard Rules

- Target aspect ratio: 21:9. If current tools cannot produce 21:9, state the limitation and use the closest supported ratio only with disclosure.
- VO language: English only. Chinese can be used for discussion and planning, but the final VO text must be English.
- On-screen text: none. No subtitles, titles, labels, signs, typography, blackboards, watermarks, or generated words.
- Duration is derived from final VO, not fixed first. VO is the master clock.
- Interaction language can remain Chinese.
- The film should be driven by thesis and symbolic images, not plot exposition.

## When To Use

Use this skill when the user asks for:

- 宣言片,
- manifesto film,
- concept film built around a viewpoint,
- brand belief film,
- philosophical short,
- issue-driven campaign video,
- "把这个观点拍成短片",
- English VO + symbolic visuals.

Do not use this for regular product ads, spokesperson videos, story films, or music videos unless the user explicitly wants a manifesto format.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Use only model choices exposed by this turn's tool list.

Capability mapping:

- strategy and manifesto writing -> planner/writer,
- symbolic image mapping -> storyboard/visual planner,
- keyframes -> current image generation,
- video from keyframes -> current image/video generation,
- VO -> current audio/voice capability if available,
- music/waveform/assembly -> current audio/video assembly capability if available.

If voice, music, waveform analysis, 21:9 generation, or timeline assembly are unavailable, return the best executable prompts and mark unsupported steps.

## Core Standard

The output is qualified only if all four hold:

- viewpoint: a clear thesis, not generic brand sentiment.
- form: each sentence feels named and repeatable.
- emotion: controlled pressure, not sentimental advertising.
- propagation: the line and images are memorable enough to be quoted or screenshotted.

Reject:

- consultant language,
- empty slogans,
- "future is now" language,
- generic empowerment,
- predictable inspirational endings,
- soft sentimental tone,
- anonymous stock-like empty scenes,
- AI-style epic overcomposition,
- decorative particles, flares, bokeh, energy fields, random surrealism.

## Workflow

1. Interpret the need internally.
2. Present 3 one-sentence strategies and get confirmation.
3. Present 3 manifesto text directions and get confirmation.
4. Finalize English manifesto VO.
5. Estimate duration from VO reading pace and mark sentence-to-image method.
6. Build final spec.
7. Map each sentence to keyframes or 2-3-frame montage.
8. Generate or plan VO; actual VO timing becomes master clock.
9. Generate keyframes.
10. Generate videos from keyframes.
11. Generate or plan instrumental music.
12. Analyze music beats/turning points if the harness supports it.
13. Assemble against VO timing.

Required pause points for interactive runs:

- after one-sentence strategy options,
- after manifesto text direction and final VO,
- after keyframes,
- after video clips,
- after final film.

Other steps can run internally or be summarized.

## Strategy Phase

Start from ontology, not execution.

For the user's topic, identify:

- what it is,
- what it has been attached to,
- what it becomes after cutting that attachment,
- its dilemma,
- its irreplaceable advantage,
- the cross-era quality worth naming.

Present three one-sentence strategies:

- the defensible correct one,
- the formally extreme and singular one,
- the sharp/uncomfortable one that says what people hesitate to admit.

After confirmation, collapse to one path. Do not create three films or three storyboards.

## Manifesto Writing

Final VO must be English.

Writing rules:

- each sentence should define or rename something,
- short sentences over clauses,
- one sentence should stand alone,
- no explanatory filler,
- no generic collective "we" unless building a community is the point,
- avoid openings like "In this era", "Technology is", "The future is here",
- avoid endings like "Together we can", "create the future", "infinite possibilities".

Acceptable structures:

- surface-normal statement with final ontological reveal,
- parallel sentences that build pressure then invert,
- wordplay where form participates in the thesis,
- paradox, naming definition, contradiction, reversal.

Approximate duration only after text:

- about 100 English words equals 50-60 seconds with slow delivery and pauses.
- final film length equals actual VO span plus head/tail no-voice space.

Do not stretch or compress content just to hit a fixed runtime.

## Visual Method

Every image must be a symbol, not a filler shot.

Baseline:

- everyday reality,
- one minimal estrangement per frame,
- single method per frame,
- still strong enough to represent the sentence out of context,
- no screen text.

Eight visual translation methods:

- `A_direct_symbol`: literal visual equivalent of an abstract term; use carefully.
- `B_identity_proxy`: a specific role/person/entity carries the value.
- `C_history_pop_reference`: historical, religious, pop-cultural, or classic symbol.
- `D_embodied_metaphor`: turn an abstraction into a physical thing.
- `E_contrast_juxtaposition`: two opposing meanings in one frame.
- `F_reverse_description`: show the world responding to the absent subject.
- `G_extreme_context`: put an ordinary quality in an extreme situation.
- `H_medium_shift`: use medium itself as argument, such as sculpture, mural, archive, oil painting, silhouette.

Prefer D/E/G as main methods unless the thesis demands otherwise. Avoid defaulting to direct symbolization.

## Storyboard Mapping

Map final manifesto text to visual beats:

- short sentence -> one image/video beat,
- long sentence that cannot hold as one image -> 2-3 frame montage,
- each montage stays in one scene or one coherent medium logic,
- montage frames should form a small argument, not random variety.

Create an `Element_Beat_Image_Map`:

- sentence,
- VO text,
- visual beat ID,
- single frame or montage,
- method A-H,
- visible subject/action/context,
- shot scale and camera angle,
- expected motion,
- timing source: actual VO duration when available.

Create `Element_Visual_Tone`:

- shared film-still treatment,
- color baseline,
- contrast,
- grain,
- lens/camera restraint,
- how heterogeneous images become one film.

## Image Prompt Rules

Prompt formula:

```text
film still, [subject doing action in concrete scene], [shot scale and camera relation], [light level and light type], [visual method], [controlled color/material details], no text, no typography, no subtitles, no watermark
```

For first image of a sentence, prefer either:

- extreme close-up/macro, or
- extreme wide with a small human figure.

For later montage frames, use the most physically continuous camera shift: medium, close, over-shoulder, profile, side angle, fixed camera, or slow push.

For medium shifts, replace `film still` with the medium, such as:

- editorial illustration,
- oil on canvas,
- marble sculpture,
- silhouette,
- street mural,
- archival photograph.

Do not include decorative or banned words:

- beautiful,
- stunning,
- amazing,
- emotional,
- heartwarming,
- nostalgic,
- masterpiece,
- award-winning,
- 4K,
- 8K,
- atmospheric as a standalone style word,
- standalone cinematic,
- signboard/label/blackboard/slate unless the user explicitly wants diegetic text, which this skill normally forbids.

## Video Prompt Rules

Video is driven from the keyframe start frame.

Prompt formula:

```text
[motion only: subject motion, camera motion, speed, start/end feeling]. Use only the provided image as the starting frame. Do not use or generate an end frame. no music. no subtitles. no text. no watermark.
```

Rules:

- Default to small, meaningful motion.
- Use dolly rather than zoom.
- Do not repeat all still-frame visual details already fixed by the keyframe.
- If the frame has a single object, give the object a meaningful motion rather than generic drifting.
- Empty-looking shots should usually use slow forward movement, but avoid anonymous stock-like emptiness.

## VO And Music

VO:

- English only.
- Mature, restrained, low-frequency, unsentimental delivery.
- One consistent voice/personality.
- Generate per paragraph or per sentence if the harness supports it.
- Text changes only require regenerating affected VO segments.

Music:

- instrumental only,
- no vocals or vocal-like hook,
- begins sparse,
- builds through texture rather than volume,
- resolves into one confident peak,
- cuts to silence before the end.

Suitable families:

- experimental electroacoustic,
- acousmatic drone,
- ritual ambient,
- prepared piano minimal,
- sub-bass ceremonial,
- dark chamber drone,
- modular synth ritual,
- bowed metal ambient,
- pipe organ minimal,
- field-recording electroacoustic.

If music generation or waveform analysis is not available, output a music brief and edit map instead of pretending it was generated/analyzed.

## Assembly Rules

VO is the skeleton:

- place VO sentence by sentence first,
- then attach corresponding keyframe/video to each sentence window,
- picture cuts may lead VO by about 0.2-0.5s when useful,
- keep hard cuts by default,
- no default dissolves,
- no generated clip audio,
- video original audio muted unless intentionally designed.

Music:

- cut visual beats to musical downbeats, chord turns, or texture shifts when available,
- if sentence timing conflicts with music, important cuts may follow music while VO remains intelligible,
- avoid crude hard audio cuts; prefer zero-crossing or phrase boundary edits if the toolchain supports it.

Mixing target if supported:

- VO clearly foregrounded,
- music ducks under VO,
- music rises during VO silence,
- key lines may have near-silence before or after.

## Quality Review

Check:

- English VO is final and confirmed.
- No on-screen text exists.
- 21:9 target is honored or limitation disclosed.
- Each frame maps to a sentence and method.
- No anonymous stock footage.
- No generic inspirational advertising language.
- Visuals use one estrangement, not overloaded surreal effects.
- VO timing drives the video timeline.
- Real media URLs exist before claiming generation complete.

If a frame is replaceable by a stock footage search term, rewrite it.

## Output Contract

Return:

- `strategy_options`: three one-sentence strategies.
- `selected_strategy`.
- `manifesto_vo`: final English VO.
- `duration_estimate`: based on reading pace; actual if VO generated.
- `beat_image_map`: sentence-to-frame/montage mapping.
- `visual_tone`.
- `keyframe_prompts`.
- `video_prompts`.
- `audio_plan`: VO/music status.
- `media`: actual image/video/audio URLs or pending states.
- `assembly_plan`: VO-first timeline.
- `review`: hard-rule pass/fail.

Do not call it complete unless VO, visuals, and assembly outputs exist or are explicitly marked as pending artifacts.
