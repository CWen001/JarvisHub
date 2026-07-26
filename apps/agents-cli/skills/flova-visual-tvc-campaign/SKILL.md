---
name: flova-visual-tvc-campaign
description: Use when 用户要基于代言人图与场景调性图制作新品视觉 TVC、全球 Campaign、高奢/时尚/运动/汽车/3C 大牌广告宣传片，并需要视觉反推、品牌调性、15 秒分段分镜、资产三视图和 视频生成提示词。
---

# Visual TVC Campaign

## Mission

用于新品视觉 TVC 与高端 campaign：基于用户上传的代言人图和场景调性参考图，完成视觉 DNA 反推、品牌调性与理念分析、TVC 创意方向、15 秒分段表格分镜、全局资产三视图、视频 prompt 与片段生成计划。

This workflow is for premium visual campaign production, not a generic product clip. It should feel like high-fashion, luxury, sports, automotive, 3C launch film, or global campaign advertising.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## Hard Preconditions

Do not start the workflow unless the user provides at least:

- `spokesperson_reference`: a spokesperson/person image.
- `scene_tone_reference`: a scene/mood/visual tone reference image.

Optional but useful:

- product reference,
- brand visual reference,
- brand color reference,
- material reference,
- space reference,
- existing ad reference,
- logo/brand rules,
- music/VO preference.

If either required reference is missing, stop and ask for the missing material. Do not generate a reverse-engineering document, brand analysis, story direction, script, storyboard, assets, prompts, or video.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Use only tools exposed in this turn's tool list.

Map source responsibilities as:

- visual analysis -> current vision/canvas analysis capability.
- planning -> agent planner output.
- storyboard registration -> current storyboard/canvas workflow.
- image assets -> current image generation capability, through media sub-agent using canvas image generation when available.
- video clips -> current image/video generation capability, through media sub-agent using canvas video generation when available.
- timeline assembly -> current video/canvas assembly ability.

If image generation, 15s video clips, or final assembly are not available, provide the runnable artifact that is available and mark the unsupported step explicitly.

## Workflow Gates

This workflow has strict gates:

1. References verified.
2. Visual DNA analysis completed.
3. Brand tone and planning parameters confirmed.
4. Three TVC creative directions presented and one selected.
5. Story script confirmed.
6. Full 15s storyboard tables confirmed.
7. Final spec written.
8. Global asset list and generated assets confirmed.
9. Video prompts built.
10. Video segments generated or queued.
11. Timeline assembled or assembly plan returned.

Do not skip from analysis directly to video generation.

## Phase 1: Visual DNA Analysis

Analyze all provided visual references and produce a compact, structured document. Cover:

- medium type: flat design, photography, realistic CG, product render, fashion editorial, automotive ad, 3C launch visual, hybrid.
- spokesperson: body structure, pose, gaze, expression, hair, makeup, clothing, accessories, visual identity constraints.
- scene: spatial layout, depth, light direction, color system, material palette, atmosphere, camera grammar.
- product if present: structure, material, finish, proportions, interaction potential, three-view needs.
- brand visual cues: luxury, fashion, sport, technology, engineering, performance, global campaign tone.
- composition: foreground/midground/background, visual center, guide lines, negative space, subject scale.
- color/light/material: dominant colors, accent colors, light quality, shadow logic, PBR/material behavior.
- dynamic potential: 3s visual hooks, 7s climax candidates, camera moves, transitions, emotional beats.
- asset needs: spokesperson three-view, product three-view, scene assets, recurring props/looks.
- visual taboos: logo rules, unauthorized text, watermark, random typography, brand-inconsistent colors.

Analysis should be practical and generation-oriented. Avoid empty aesthetic words unless they are backed by visible details.

## Phase 2: Brand Tone And Parameters

Use the analysis to infer and ask the user to confirm:

- brand category: luxury, fashion, sport, automotive, 3C, mixed.
- campaign tone: global, cinematic, editorial, launch-film, performance, narrative, CG, live-action.
- target platform and aspect ratio.
- total duration.
- brand name and logo permission.
- subtitle permission.
- narration/dialogue needs.
- product three-view needs.
- vehicle motion, sport action, 3C interaction, luxury still life, or spokesperson performance needs.
- audio strategy.
- forbidden elements.

Pause after this phase. Continue only after the user confirms or provides enough direction for an autonomous run.

## Phase 3: Creative Directions

Present 3 one-sentence TVC directions. Each direction should include:

- title,
- type tendency,
- one-sentence story,
- brand idea,
- spokesperson emotion/action,
- product role,
- scene tone,
- core visual symbol,
- purchase or brand memory cue,
- 3s hook,
- 7s climax.

Directions should be meaningfully different, such as luxury emotion film, fashion global campaign, performance/sport film, automotive engineering film, 3C launch film, CG concept ad, live-action texture TVC, or short narrative ad.

Pause for selection, mixing, or revision.

## Phase 4: Story Script

After direction confirmation, output a story script with:

- title,
- type,
- total duration,
- aspect ratio,
- visual style,
- brand claim,
- core narrative,
- spokesperson action line,
- product action line,
- scene action line,
- emotional rhythm,
- commercial memory point,
- VO/dialogue draft if needed,
- music atmosphere,
- every 15s narrative unit,
- how each unit begins from the previous unit,
- how each unit ends into the next unit.

This is not yet the final storyboard. Pause for confirmation.

## Phase 5: 15s Storyboard Tables

After the script is confirmed, create one table per 15s segment.

Each 15s table must include 5-12 shots and these columns:

- shot number,
- time range,
- framing and angle,
- camera movement,
- image content and performance,
- brand/product/spokesperson relationship,
- light and material,
- SFX,
- music and emotion curve,
- transition logic,
- opening/ending continuity strategy,
- commercial function.

Each 15s segment should include:

- a visual feedback point about every 3s,
- a visual/emotional climax about every 7s,
- all four commercial goals: spokesperson charisma, brand world, product desire, brand memory.

Continuity between segments must be planned with motion direction, sound bridge, visual geometry, lighting carryover, action overlap, or material match.

Pause after the complete tables. If the user requests changes, output the complete revised table again before moving on.

## Phase 6: Final Spec

Only after storyboard confirmation, create the final spec:

- title,
- type,
- aspect ratio,
- total duration,
- segment duration,
- brand tone,
- brand idea,
- visual style,
- language,
- model preference,
- resolution preference,
- asset strategy,
- audio strategy as plan or bound asset unless a real audio tool is exposed,
- segment continuity strategy.

Defaults:

- image preference: route image assets through media sub-agent using canvas image generation.
- video preference: route video clips through media sub-agent using canvas video generation.
- resolution: use the best this turn's tool list supports; do not fake 720p/1080p if not returned by the tool.
- ratio: 9:16 for short social video, 16:9 for global campaign/website/big-screen, 1:1 or 4:5 for social/KV-adjacent use.

## Phase 7: Asset Strategy

Generate or register only global reusable assets, not per-shot keyframes.

Allowed assets:

- spokesperson clean-background full-body three-view: front, side, back.
- product clean-background three-view if a product reference exists.
- scene asset: one image per distinct recurring scene.
- recurring cross-segment prop, outfit, look, vehicle interior, 3C interaction interface, installation, or visual motif not covered by uploads.

Forbidden assets:

- per-shot asset images,
- storyboard keyframes,
- one-off action assets,
- temporary atmosphere images,
- unconfirmed visual elements.

All generated assets must reference the visual DNA document and user references. After asset generation, pause for user confirmation before video prompts.

## Phase 8: Video Prompts

Build one video prompt per 15s storyboard segment.

Each prompt must preserve:

- table shot order,
- 3s feedback,
- 7s climax,
- action chain,
- transition logic,
- spokesperson action,
- product demonstration,
- brand emotion,
- light/material behavior,
- sound markers,
- opening continuity,
- ending continuity,
- negative constraints.

Use Chinese for prompts when user context is Chinese; retain necessary English model syntax and negative phrases when useful.

Prompt structure:

1. reference assets and visual root,
2. opening continuity from previous segment,
3. ordered internal shot beats,
4. brand/product/spokesperson relationship,
5. light/material/color rules,
6. sound/VO handling,
7. ending continuity into next segment,
8. negative constraints.

Default negative constraints:

```text
无字幕、无随机文字、无水印、无未经授权品牌 Logo、no random typography, no identity drift, no product deformation, no music if audio is handled separately
```

## Phase 9: Video And Assembly

Generate each 15s segment using the confirmed prompt and confirmed assets when the harness supports it.

For each generated segment:

- verify a real video URL exists,
- check spokesperson identity,
- check product structure,
- check scene tone,
- check segment opening/ending continuity,
- check no unwanted text/logo/watermark.

Then assemble segments in storyboard order if the harness supports timeline assembly. Otherwise, return segment URLs and an assembly plan.

Do not generate independent BGM/VO/SFX unless the user explicitly asks or the current plan contains audio generation.

## Quality Review

Review against:

- reference fidelity: spokesperson, scene tone, product identity.
- brand tone: luxury/fashion/sport/auto/3C intent is visible.
- commercial clarity: product or brand memory appears in each segment.
- continuity: each 15s segment has a planned opening and ending bridge.
- asset discipline: no per-shot random assets were introduced.
- text discipline: no random text, subtitles, watermarks, unauthorized logos.
- completion evidence: real URLs exist for generated media.

If any required reference, asset confirmation, or video URL is missing, mark that stage incomplete.

## Output Contract

Return:

- `references`: required and optional references received.
- `visual_dna`: structured visual reverse-engineering summary.
- `brand_plan`: tone, ideology, parameters, constraints.
- `directions`: 3 TVC direction options or selected direction.
- `script`: confirmed story script.
- `storyboard_tables`: 15s tables.
- `final_spec`: production spec.
- `assets`: global assets and confirmation status.
- `prompts`: per-segment video prompts.
- `media`: video URLs or pending states.
- `review`: issues and regeneration recommendations.

Do not present the campaign as generated until confirmed media URLs exist.
