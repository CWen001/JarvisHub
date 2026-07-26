---
name: flova-ecommerce-visual-kit
description: Use when 用户要基于产品图生成电商产品视觉全案、主图、详情页、卖点图、白底 KV、材质特写、对比验证图或平台电商静态图集；默认不进入视频流程。
---

# Ecommerce Visual Kit

## Mission

用于电商产品视觉全案：基于产品图生成一套静态电商视觉资产，包括 3 张核心主图和 6-8 张详情页图，并用产品基线审计保证形态、颜色、材质、Logo 和朝向一致。

This workflow is static-image-first. Unless the user explicitly asks for video, do not route to video generation or timeline assembly.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- ecommerce product visual kits,
- product hero images,
- product detail page images,
- white-background product KV,
- feature-benefit images,
- material macro images,
- before/after comparison images,
- product size/spec layout,
- static product campaign image set.

Use `flova-product-commercial-short` if the user wants product video. Use `canvas-brand-web-design` if the user wants a webpage, not a product image kit.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model for product analysis, image generation or editing, review, and gallery output.

If the harness cannot compute exact HSL/logo coordinates, produce a best-effort visual baseline and review checklist. Do not claim numeric precision that was not actually measured.

## Required Intake

Required:

- `product_reference`: uploaded product image.

Useful optional inputs:

- product name,
- target platform,
- target aspect ratios,
- brand colors,
- style direction,
- selling points,
- forbidden colors/props/claims,
- whether Logo/text may be visible,
- whether white-background images are required,
- number of detail-page images.

If no product image exists, ask for it before generation. You may draft a shot list from text, but do not claim product-faithful visuals.

## Workflow

1. Analyze product baseline.
2. Create ecommerce product spec.
3. Plan 3 hero images and 6-8 detail images.
4. Bind uploaded product as `Product_Asset_01`.
5. Generate images in storyboard order.
6. Audit consistency.
7. Return image set and review report.

Pause for confirmation after:

- spec,
- storyboard/image plan,
- first generated hero image or first batch,
- completed kit/audit.

For autonomous runs, use critic review instead of user confirmation and state that decision.

## Product Baseline

Extract and store:

- outline and proportions,
- primary/secondary/highlight color,
- material and finish,
- reflectivity/gloss behavior,
- logo/text location and style if present,
- structure zones,
- default facing direction,
- key functional feature,
- image quality issues.

Baseline example:

```text
Product_Asset_01: cylindrical bottle, height:width about 2.4:1, brushed metallic cap, matte body, logo centered upper front, default facing left-oblique around 30 degrees, primary cool blue-gray, soft vertical specular highlight.
```

## Image Kit Structure

### Hero Images

Generate three platform main images in this order:

| ID | Type | Purpose |
| --- | --- | --- |
| `Hero_01` | scene atmosphere | establish product world and desire |
| `Hero_02` | feature structure | show main selling point with product dominant |
| `Hero_03` | white-background KV | clean SKU recognition and platform compliance |

### Detail Images

Generate 6-8 detail images in this suggested order:

| ID | Type | Purpose |
| --- | --- | --- |
| `Detail_01` | usage scene | product in lifestyle/use context |
| `Detail_02` | material macro | craftsmanship or texture proof |
| `Detail_03` | second macro/detail | second key surface/component |
| `Detail_04` | feature explanation | visual callout without random text unless allowed |
| `Detail_05` | comparison proof | before/after or scenario comparison |
| `Detail_06` | second comparison/proof | reinforce decision |
| `Detail_07` | size/spec flat lay | proportions/accessories if needed |
| `Detail_08` | optional closing image | bundle, usage summary, or brand atmosphere |

Do not change this order unless the user or platform needs a different kit.

## Shot Fields

Each planned image must include:

- `Shot ID`,
- `Shot Type`,
- `Aspect Ratio`,
- `Focus`: normalized approximate coordinate `(X, Y)`,
- `Visual Intent`,
- `Key References`,
- `Product Angle`,
- `Background/Props`,
- `Lighting`,
- `Failure Avoidance`.

Focus guidance:

- Hero images should not all have the same focus point.
- Detail images can follow a Z/F reading path for scroll behavior.
- White-background KV should keep product centered and clean.

## Aspect Ratios

Default:

- hero/main images: 1:1 unless platform says otherwise.
- detail-page images: 3:4 for mobile scroll, 16:9 for banner/detail modules, or platform-specific.
- white-background KV: 1:1 with seamless white background.

If the current image tool cannot produce the exact ratio, disclose and use closest supported ratio.

## Prompt Rules

Use English prompts by default for ecommerce image generation unless the this turn's tool list performs better with Chinese. Keep prompts concise, usually 120-200 words.

Start image-to-image prompts with the product reference:

```text
<<<image_1>>> inherit the exact product form, proportions, surface finish, color, logo placement, and core structure.
```

Then describe:

1. camera distance and angle,
2. product placement and pose,
3. environment/props,
4. light direction and shadow behavior,
5. material detail,
6. ratio and quality,
7. negative constraints.

Default negative tail:

```text
no product morphing, no distorted proportions, no messy reflections, no floating artifacts, no random on-screen text, no watermarks, no brand identifiers, no subtitles, no oversaturated colors, no physically impossible shadows, no ugly digital noise
```

For white-background KV add:

```text
white seamless background only, no environment props, no colored cast
```

For feature/callout images add:

```text
no decorative clutter outside designated callout zones
```

Do not include new marketing claims in generated text unless the user explicitly provided exact approved wording and the current image tool can render it reliably.

## Visual Style Rules

Maintain:

- product contour consistency,
- product color consistency,
- material finish consistency,
- logo/text consistency,
- physically plausible lighting,
- restrained color palette,
- product category-appropriate props,
- platform readability.

Use a 90:10 color discipline:

- about 90% of the image should remain in the core visual palette,
- contrast/accent colors should support only the product or key selling point.

Avoid:

- random extra logos,
- visual claims not provided by user,
- oversaturated AI look,
- physically impossible shadows/reflections,
- props that contradict product category,
- product mirrored/flipped without reason.

## Consistency Audit

After generation, review every image against the product baseline.

Audit dimensions:

- `outline_proportion`: product length/width and major silhouette.
- `color_arc`: dominant hue/saturation/lightness consistency.
- `material_finish`: matte/gloss/metal/glass/fabric behavior.
- `logo_text`: position, clarity, no invented marks.
- `orientation_structure`: facing direction and functional zones.
- `background_pollution`: white-background cleanliness and prop relevance.

Mark warnings if:

- product proportion visibly changes,
- color shifts noticeably,
- material finish changes,
- logo moves or mutates,
- product flips unexpectedly,
- white background has colored cast or props,
- scene props conflict with product tone.

If a warning affects the hero image or white-background KV, recommend regeneration before considering the kit complete.

## Output Contract

Return:

- `product_baseline`: product visual and structural summary.
- `ecommerce_spec`: platform, ratios, style, color, claims, constraints.
- `image_plan`: hero/detail shot table.
- `prompts`: prompt per image.
- `media`: generated image URLs or pending states.
- `audit`: consistency report with pass/warning/fail.
- `export_notes`: ordered image kit usage.

Do not route to video unless the user explicitly requests video.
