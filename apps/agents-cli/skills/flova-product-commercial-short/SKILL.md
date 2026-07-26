---
name: flova-product-commercial-short
description: Use when 用户基于上传的产品图片制作商品宣传短片、电商产品视频、产品在使用场景中的商业广告、功能氛围混剪或需要产品元素、场景元素、镜头视频逐步确认的短片。
---

# Product Commercial Short

## Mission

用于商品宣传短片：从用户上传的产品图出发，设计产品展示、使用场景、功能氛围镜头与商业节奏，逐步生成元素资产、视频片段和最终合成计划。

This workflow is a general product commercial workflow. It is lighter than `flova-visual-tvc-campaign` and more narrative/environmental than `flova-beat-cut-motion-video`.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill when the user wants:

- product image to short commercial video,
- e-commerce SKU promotional video,
- product-in-environment demo,
- feature/lifestyle montage,
- product ad with staged confirmation,
- short product film using provided product assets.

Use a more specific skill when applicable:

- jewelry ad -> `flova-jewelry-12-shot-ad`
- fashion garment showcase -> `flova-fashion-showcase-short`
- industrial/technical product promo -> `flova-industrial-product-promo`
- beat-cut center-locked motion -> `flova-beat-cut-motion-video`
- spokesperson/global campaign -> `flova-visual-tvc-campaign`

## Canvas-Native Boundary

Follow the JarvisHub Execution Model for asset binding, image generation, video generation, review, and assembly. Audio is a plan or bound user asset unless this turn exposes a real audio generation tool.

If current tools can generate scene images, video clips, or assemble timelines, use them through the proper sub-agent. If audio generation is not exposed, return an audio plan instead of claiming generated audio.

## Required Intake

Collect or infer:

- `product_reference`: required. Use uploaded product image if available.
- `product_category`: SKU type and key selling points.
- `aspect_ratio`: default 9:16 for social commerce, 16:9 for brand/website video, 1:1 or 4:5 for feed ads.
- `duration`: default 15-30s unless user specifies.
- `style`: premium, energetic, lifestyle, technical, outdoors, minimalist, etc.
- `platform`: ecommerce detail page, Douyin/TikTok, Xiaohongshu/Reels, website hero, paid social.
- `must_show`: logo/package, feature, material, usage scene, price/promo text if allowed.
- `forbidden`: unauthorized logo/text, claims, unsafe usage, style taboos.
- `audio`: BGM, VO, SFX, or silent.

If the product image is missing, ask for it before media generation. You may still draft a generic plan, but do not claim product-faithful output.

## Workflow

1. Write a final video spec.
2. Design storyboard and key elements.
3. Bind user-provided assets before generating anything.
4. Generate missing scene/prop/product-support assets only when needed.
5. Optionally generate keyframes if the current video model benefits from locked first frames.
6. Generate video clips.
7. Plan or attach audio if required; generate audio only when a dedicated audio tool is exposed.
8. Assemble or return an assembly plan.

Pause for confirmation after important stages in interactive runs:

- spec,
- storyboard,
- element images,
- keyframes if used,
- video clips,
- audio,
- final assembly.

For autonomous agent runs, replace user confirmation with critic review and make the decision explicit.

## Storyboard Strategy

A good product commercial should not be only "a package on a table." Mix two shot types.

### Product-In-Environment

The product appears clearly in a real or stylized usage scene.

Use for:

- proving use case,
- showing scale,
- showing deployment,
- building desire,
- establishing SKU clarity.

Examples:

- action camera mounted on helmet underwater,
- skincare bottle on wet stone beside soft morning light,
- headphones worn during commute,
- portable power station at a campsite,
- smart device in a desk setup.

### Support / Feature / Atmosphere

The product may be absent or partially visible, but the shot sells the benefit.

Use for:

- environment action,
- lifestyle rhythm,
- macro UI/material detail,
- emotional payoff,
- function implication.

Examples:

- skateboard wheels cutting across pavement to imply stabilization,
- concert crowd to imply audio power,
- water splash to imply waterproofing,
- close macro of texture, mount, lens, clasp, button, fabric, screen.

The storyboard should alternate shot scale and purpose:

- establish wide,
- product mid shot,
- macro detail,
- lifestyle action,
- feature proof,
- hero/logo/package ending.

## Shot Design

For every shot include:

- `shot_id`
- `type`: product-in-environment or support/feature/atmosphere
- `scene_element`
- `product_presence`: full, partial, macro, absent
- `commercial_point`
- `framing`
- `camera_movement`
- `action`
- `lighting_material`
- `audio_or_sfx`
- `transition`
- `duration_target`

Prefer short, purposeful shots for energy. A shot can be 5-15s if it contains internal beats, but each internal beat must have a clear visual change.

Use varied camera grammar:

- push-in,
- pull-out reveal,
- orbit,
- tilt,
- Dutch angle when appropriate,
- lateral slide,
- controlled whip pan sparingly,
- macro lockoff for product detail.

Keep the product visually faithful: structure, color, material, package markings, and recognizability should not drift.

## Element Asset Rules

Before generation:

- Bind the uploaded product image as the product visual root.
- Reuse any uploaded scene/brand/reference assets.
- Generate scene assets only for scenes that the storyboard actually needs.
- Generate props only when they recur or materially support the product story.

Do not regenerate the product itself if the uploaded image is already usable. Generate product views or clean asset boards only when required by the video model or user request.

Useful element asset categories:

- `Product_Root`
- `Scene_UseCase_01`
- `Scene_UseCase_02`
- `Macro_Material_Detail`
- `Recurring_Prop`
- `End_Card_Background`

Avoid per-shot random assets; they break continuity and product identity.

## Video Prompt Rules

Use Chinese prompts when the user is working in Chinese, while retaining necessary model tokens and negative phrases if useful.

Each prompt should follow:

1. reference assets,
2. camera movement,
3. product or subject action,
4. environment motion,
5. commercial point,
6. light/material/color style,
7. audio handling,
8. negative constraints.

For product-in-environment shots:

```text
以产品参考图作为唯一产品外观依据，保持产品结构、颜色、材质和包装识别点一致。镜头展示产品在[使用场景]中的真实部署，[摄像机运动]，[动作/功能表现]，[光影材质]，突出[商业卖点]。无字幕、无随机文字、无水印、no music。
```

For support/feature/atmosphere shots:

```text
围绕产品卖点[功能/情绪]设计氛围镜头，[场景动作]，[镜头运动]，[材质/光影]，画面服务于产品价值暗示。若产品不出现，明确保持该镜头为辅助功能/情绪镜头。无字幕、无随机文字、无水印、no music。
```

If the shot has separate VO or narration, do not put narration text inside the video prompt unless the current model is expected to generate speech.

## Audio Rules

Plan at least one global BGM direction unless the user asks for silent output. Bind a real BGM asset when the user provides one; generate one only when this turn exposes an audio tool.

For VO:

- define voice tone,
- exact script,
- target language,
- which shots it covers,
- where BGM should duck.

For product ads, useful SFX include:

- click,
- snap,
- splash,
- fabric movement,
- engine/electric hum,
- UI beep,
- whoosh,
- package open.

Do not let generated video clips create uncontrolled music if audio will be assembled separately.

## Assembly Rules

Assemble in the storyboard order.

Maintain:

- product identity,
- color grade consistency,
- logical progression from problem/scene to feature to payoff,
- clean ending with product/package/logo if permitted.

Respect brand or platform requirements:

- logo duration,
- package visibility,
- prohibited claims,
- subtitle policy,
- end-card policy.

If timeline assembly is unavailable, return ordered clip URLs and an assembly plan with shot durations and audio placement.

## Quality Review

Check:

- real image/video URLs exist before claiming completion,
- product shape and material are consistent,
- product appears in enough shots to sell the SKU,
- support shots clearly imply a benefit,
- scenes match the product category,
- visual style is coherent,
- no unauthorized text/logo/watermark,
- no false claim or unsafe product use,
- audio plan does not conflict with video prompt audio.

If a clip fails product fidelity, narrow the prompt around the product reference and regenerate before changing the storyboard.

## Output Contract

Return:

- `spec`: title, ratio, duration, style, platform, language.
- `product_analysis`: product category, selling points, visual constraints.
- `storyboard`: shot table with shot type and commercial function.
- `assets`: uploaded/reused/generated assets and status.
- `prompts`: image prompts and video prompts.
- `media`: generated URLs or pending states.
- `audio`: BGM/VO/SFX plan, bound user assets, or generated assets only when a real audio tool is exposed.
- `assembly`: final video URL or ordered assembly plan.
- `review`: issues, regeneration needs, and what was verified.

Do not treat a prompt table or storyboard as a generated commercial.
