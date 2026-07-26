---
name: flova-beat-cut-motion-video
description: Use when 用户上传单张参考图并要求生成高能卡点运镜、18 秒中心锁焦快剪、产品 TVC、车辆/宠物/建筑/风景/人像的 360 运镜、beat cut、TETO 动感视频或平滑产品展示。
---

# Beat-Cut Motion Video

## Mission

用于高能卡点运镜视频：基于一张参考图，先识别主体类型与中心锚点，再选择 TETO 高能卡点模式或产品 TVC 模式，最后产出可交给当前 canvas harness 执行的分镜、关键帧/视频提示词、音频节奏计划与质检标准。

运行边界：不重新定义工具参数。真实请求必须使用 JarvisHub canvas harness 暴露的 canvas tools、subagents 和 media pipeline；如果某项能力在本轮工具列表中不存在，只能输出明确的执行假设或待确认项，不能伪造已完成结果。

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for requests like:

- "用这张图生成高能卡点运镜视频"
- "做一个 18 秒 360 度快节奏产品/车辆/宠物/建筑展示"
- "锁定主体中心，跟着音乐卡点推拉旋转"
- "做 TETO 风格暗黑冷青高对比短片"
- "产品图做高级 TVC 展示，不要太炸，平滑一点"

Do not use it for long narrative videos, multi-character plot videos, or multi-scene story films. Those should route to `canvas-long-video-production` or `creative-video-production` first, then optionally use this skill for a single clip style.

## Canvas-Native Boundaries

The agent should keep four roles separate:

- `explore`: understand user intent, reference image, product/category, aspect ratio, duration, music/audio availability, and desired intensity.
- `plan`: select mode, subject type, anchor point, timeline structure, and clip count.
- `media`: generate or edit images/videos only through the media sub-agent and exposed canvas media tools.
- `critic`: verify actual imageUrl/videoUrl outputs, visual consistency, anchor visibility, motion fit, and whether pending/running jobs are still incomplete.

Never call non-registered workflow names such as `text_editor`, `media_generator`, `video_assembler`, or `resource_prepare_and_analyze` as if they exist. Translate each step into JarvisHub roles: main Agent, `explore`, `plan`, `media`, `critic`, and available canvas tools.

## Required Intake

Before media generation, collect or infer:

- `reference_image`: required. It is the visual root for the subject.
- `aspect_ratio`: default to original image ratio; use 9:16 if user asks for short-video/TikTok/Reels style and no ratio is provided.
- `duration`: default 18s. Product TVC may be 15-30s when user asks.
- `audio_source`: user-uploaded audio, user-described BPM/style, generate/choose background music, or silent.
- `subject_type`: one of `PRODUCT`, `VEHICLE`, `ANIMAL`, `ARCHITECTURE`, `LANDSCAPE`, `HUMAN`.
- `anchor_point`: a single visible visual point, not a region or axis.
- `mode`: `TETO_MOTION` or `PRODUCT_TVC`.
- `intensity`: `normal`, `high`, or `wild`; default `high` for TETO, `normal` for TVC.

For `PRODUCT`, ask or infer whether the user wants:

- `PRODUCT_TVC`: premium smooth product ad, low-saturation, slow orbit, no hard cuts.
- `TETO_MOTION`: explosive beat-cut, high contrast, glitch/flash/motion impact.

For non-product subjects, default to `TETO_MOTION` unless the user explicitly asks for soft/premium/smooth.

## Evidence Gate

Proceed only when you can name the current visual root:

- original reference image URL or local uploaded image handle,
- optional composited image URL if the background is replaced,
- selected subject type,
- selected anchor point description and coordinate if the harness can provide one,
- selected mode and target duration.

Queued, running, or missing media jobs are not finished outputs. If the tool returns job state instead of a real `imageUrl` or `videoUrl`, report that generation is still in progress and continue polling or leave the item as pending.

## Subject Analysis

Classify the reference image and choose camera grammar from this table:

| Subject | Camera Grammar | Avoid |
| --- | --- | --- |
| `PRODUCT` | 45-degree slightly top-down product angle, macro details, logo/material closeups, small-radius orbit | vertical overhead, huge wide-angle distance, random new product shape |
| `VEHICLE` | low ground angle, front/side tracking, wheel/logo/headlight details, side profile speed | high aerial-only view, distorted chassis shape |
| `ANIMAL` | ground-level eye-height camera, nose/eye/fur details, tracking movement | harsh distortion, unnatural body deformation |
| `ARCHITECTURE` | low-angle upward camera, depth push, facade/line/light closeups | warped architecture, extreme fisheye bending |
| `LANDSCAPE` | aerial wide, high-altitude orbit, sky/horizon/depth movement | macro closeup, ground-level face-like shots |
| `HUMAN` | portrait framing, eye/face/half-body/full-body balance, small-radius body orbit | ultra-wide close face distortion, body proportion damage |

If background quality is poor and the subject is not `LANDSCAPE`, ask whether to replace it. Poor background includes clutter, watermarks, unrelated text, flat lighting, color conflict, or no depth. Generate replacement backgrounds only when the user or existing plan permits it; show/select/confirm the composite before treating it as the new visual root.

## Anchor Rules

The anchor is a single visible point that should stay near the screen center during motion.

General priority:

1. High-contrast edge or corner, such as logo corner, headlight edge, product bevel, building vertex.
2. Highlight point, such as metal specular, water glint, pupil highlight.
3. Geometric point, such as wheel hub, screw center, eye pupil, logo center.
4. Visual center fallback, such as animal nose, human brow center, product front center, main facade center.

Landscape fallback order:

1. Landmark tip or center, such as peak, tower, island, waterfall impact point.
2. Light convergence, such as sun-horizon contact, water reflection center, god-ray landing point.
3. Geometric convergence, such as river/road/terrace vanishing point.
4. Color-density center in the highest contrast 100px-ish region.
5. Upper-left golden ratio point, roughly 38.2% width and 38.2% height, with a note that the image lacks a strong anchor.

If the harness can visually mark or ask for a click, ask the user to confirm or override the anchor. If not, state the chosen anchor in words and use that description consistently in prompts.

## Mode Decision

### TETO_MOTION

Use for high-energy, dark, beat-driven motion videos.

Defaults:

- Duration: 18s.
- Style: high contrast, cold cyan cinematic grade, crushed blacks, harsh highlights, mild film grain.
- Editing: hard cuts, jump cuts, fast push/pull, whip pans, incomplete orbit, handheld micro-shake.
- Audio: beat-driven if audio is available; otherwise use assumed 120 BPM electronic/trap timing or ask the user for music.
- Forbidden: soft dissolves as the main cut language, slow uniform dolly for the whole video, overly polished beauty smoothing, losing the anchor.

### PRODUCT_TVC

Use for premium, smooth product presentation.

Defaults:

- Duration: 15-30s, default 18s if unspecified.
- Style: low-saturation Morandi palette, soft diffused light, elegant gray tone, clean material detail.
- Editing: slow orbit, smooth dolly, macro lockoff, fade/dissolve transitions.
- Audio: ambient, piano, soft cinematic, low tempo, no strong beat dependence.
- Forbidden: hard beat cuts, RGB glitch, white flashes, heavy camera shake, aggressive motion blur, cyberpunk TETO background unless user asks.

## Timeline Planning

### TETO Timeline

Use a two-part structure:

| Audio/BPM | Establishing Segment | Montage Segment | Approximate Shot Count |
| --- | --- | --- | --- |
| BPM > 120 | 0-3s, 1-2 slower shots | 3-18s, 0.3-0.4s cuts | 35-38 |
| BPM 80-120 | 0-3s | 3-18s, 0.5-0.7s cuts | 22-25 |
| BPM < 80 | 0-5s | 5-18s, 0.7-0.9s cuts | 16-18 |
| 93 BPM dark trap / slow intro | 0-5s slow intro | 5-11s buildup, 11-18s climax | 20-26 |

Required climax beats for the plan when no better audio analysis exists:

- Around 11s: strongest inward push or aerial dive.
- Around 13.5s: fastest orbit or whip-pan cluster.
- Around 16s: large pull-out or reveal ending.
- At 18s: closed ending frame, not a random mid-motion cutoff.

Motion palette:

- explosive push toward anchor,
- fast pull out from macro to mid/wide,
- horizontal whip pan through anchor,
- vertical punch/dive,
- 15-90 degree incomplete orbit with sudden stop,
- handheld micro-shake while anchor stays readable.

### Product TVC Timeline

Use a three-part structure:

| Segment | Duration Share | Content |
| --- | --- | --- |
| Establishing | 0-30% | product and environment, slow push or lateral slide |
| Selling Points | 30-80% | 4-8 shots alternating mid shot, material macro, logo/function closeup |
| Ending | 80-100% | clean hero frame, slow pull-out or static premium closeup |

Single shots should usually last 0.8-2.5s. Selling-point details may hold up to 3s. Avoid cuts below 0.8s.

## Prompt Construction

Every video prompt should include:

- Reference binding: use the current visual root as the locked subject.
- Anchor sentence: "`[anchor description]` remains centered and visible; camera motion orbits/pushes/pulls around this point."
- Subject-specific camera grammar from the analysis table.
- Mode-specific style language.
- Negative constraints: no subtitles, no text, no watermark, no random subject redesign, no music inside the video prompt if audio is handled separately.

TETO prompt tail:

```text
anchor zone remains sharp and readable, foreground/background motion blur follows fast camera movement, explosive acceleration, hard cuts, cold cyan cinematic grade, crushed blacks, harsh highlights, subtle film grain, no subtitles, no text, no watermark, no music
```

Product TVC prompt tail:

```text
slow smooth dolly, steady camera, low-saturation Morandi color, soft diffused light, ultra-sharp product detail, no sudden movement, no hard cut, no heavy motion blur, no shake, no flash, no subtitles, no text, no watermark, no music
```

For `HUMAN`, avoid "ultra-wide close face" and keep push-in intensity below other categories. For `LANDSCAPE`, phrase the anchor as a visible landmark/light/geometric focus and keep all motion aerial.

## Audio Handling

If the harness can analyze uploaded audio:

- Extract or estimate BPM, intro end, heavy beats, climax points, and useful timestamps.
- Align storyboard and clip timing to those timestamps.
- Do not promise sample-accurate beat sync unless the current toolchain actually supports timeline assembly.

If the harness cannot analyze audio:

- Ask for BPM/style if important, or use a declared assumption such as "assume 120 BPM electronic beat, intro 0-3s."
- Output a beat map as a planning artifact, not as a verified analysis.

If the harness can generate or attach music:

- TETO: dark trap, electronic, heavy bass, cinematic cold atmosphere; 18s unless the user says otherwise.
- TVC: ambient, soft cinematic, piano, luxury product feel; same duration as video.

If no audio capability is available, deliver the visual video plan and prompts, and mark audio as post-production pending.

## Media Execution

Use the JarvisHub canvas execution model. Typical execution order:

1. Register or reference the user image as the visual root.
2. Optional background replacement: generate 3 candidates, select/confirm, composite, then make the composite the visual root.
3. Generate keyframes or short clips according to storyboard.
4. If the target duration exceeds one tool call's reliable clip limit, split into clips and route concatenation/long-form assembly through `canvas-long-video-production`.
5. Review each real output URL before calling it complete.

For TETO, prefer more short generated clips if the system can assemble them. If the harness only supports a single image-to-video request, compress the storyboard into one prompt with internal beats and clearly state the limitations.

For TVC, fewer longer clips are acceptable because motion should be smoother and less edit-heavy.

## Quality Review

Check every real output:

- The subject remains recognizably the same object/person/animal/place.
- The chosen anchor remains visible enough to read as the center of action.
- The camera grammar matches subject type.
- TETO outputs feel energetic and beat-cut, not a slow uniform camera drift.
- Product TVC outputs feel smooth and premium, not glitchy or harsh.
- No unwanted text, watermark, subtitles, logos, extra limbs, melted product edges, or warped architecture.
- If a clip fails, regenerate with narrower prompt emphasis before changing the plan.

For `wild` TETO intensity, do not lower intensity silently. If output breaks subject integrity, tell the user and offer a lower-intensity rerun or a tighter prompt.

## Output Contract

When using this skill, return a structured result:

- `analysis`: subject type, visual root, background decision, anchor point, mode.
- `timeline`: segment plan with duration, shot count, and beat assumptions.
- `prompts`: ready-to-run image/video prompt set or per-shot prompt table.
- `media`: actual generated `imageUrl`/`videoUrl` values, or clear pending states.
- `review`: pass/fail notes and what should be regenerated if needed.

Do not present an ungenerated storyboard as a completed video. Do not hide missing tool capability; name it and provide the best runnable artifact available.
