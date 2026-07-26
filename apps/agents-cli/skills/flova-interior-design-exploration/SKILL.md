---
name: flova-interior-design-exploration
description: Use when creating a canvas-native immersive interior design exploration video from room photos, design renders, floor-plan context, mood references, or a request like "室内设计漫游", "沉浸式看房", or "空间探索视频".
---

# Interior Design Exploration

## Overview

Use this workflow for immersive interior walkthroughs, design concept previews, real-estate viewing clips, hospitality interiors, retail spaces, and residential room mood films.

The goal is not generic architecture fantasy. Preserve spatial logic, furniture placement, material continuity, and human eye-level movement while producing a polished exploration video.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## Canvas-Native Contract

- Do not redefine tool parameters. Use the canvas tools exposed in this turn and the current project node context.
- Bind uploaded reference images, renders, floor plans, material boards, and existing canvas assets before generating new spatial views.
- Prefer image or storyboard approval before final video, especially when layout fidelity matters.
- Use subagents as optional specialists: spatial analyst, interior art director, storyboard director, video prompt specialist, and continuity reviewer.
- Do not treat generated media as available until a real imageUrl or videoUrl exists.

## Intake

Collect or infer:

- Space type: living room, bedroom, kitchen, cafe, showroom, hotel lobby, office, retail, gallery, bathroom, exterior-to-interior route.
- Source assets: room photo, render, floor plan, reference style, material palette, furniture list, brand requirements.
- Design style: modern minimal, wabi-sabi, Japandi, French, Bauhaus, new Chinese, industrial, warm wood, luxury hospitality, or user-defined.
- Target route: entrance-to-center, door-to-window, sofa-to-dining, bed-to-wardrobe, lobby-to-feature wall, retail aisle.
- Aspect ratio, duration, camera mode, and whether text overlays or captions are needed.

Default when under-specified: 9:16, 15 seconds, one continuous human eye-level walkthrough, no people, ambient sound only.

## Production Flow

1. Analyze spatial evidence.
   - Identify room boundaries, entrance, windows, focal wall, furniture anchor, lighting sources, and walkable path.
   - Note what must remain fixed: sofa orientation, bed position, cabinet line, floor material, ceiling feature, artwork, view outside window.
   - If references conflict, surface the conflict before generating layout-dependent media.

2. Create the design spec.
   - Lock aspect ratio, route, camera height, speed, style, material palette, and no-go constraints.
   - Define 3-5 spatial beats: threshold, reveal, focal detail, material close-up, resting composition.

3. Generate or bind master spatial image.
   - Use the best uploaded render or photo as the master reference when available.
   - If generating from scratch, first create a wide establishing image or panoramic-feeling keyframe that defines layout.
   - Do not generate final video from isolated decor references without a room layout anchor.

4. Create storyboard frames.
   - Use multi-panel storyboard when the route has more than one spatial beat.
   - Each frame needs: camera position, viewing direction, foreground object, midground anchor, background destination, and light continuity.
   - For one-take walkthroughs, ensure frames can connect physically.

5. Generate video.
   - Prefer a single continuous shot only when the route is simple and layout is stable.
   - For complex spaces, generate short clips by connected zones and assemble with motivated cuts.
   - Use camera motion that matches human movement: slow walk-in, gentle pan, slight turn, small dolly, pause at focal detail.

6. Assemble and review.
   - Add restrained ambient sound: soft room tone, footsteps, fabric movement, distant city, fireplace, cafe murmur, water, or air system.
   - Keep captions minimal and placed after visual composition is stable.
   - Review the final piece for layout jumps, scale errors, and material drift.

## Camera Rules

Use physically plausible interior camera language:

- Human eye height: roughly 155-170 cm unless the user asks for child, seated, or overhead perspective.
- Lens feel: 20-28 mm equivalent for exploration, 35-50 mm for detail pauses.
- Movement: slow threshold reveal, controlled pan, walking dolly, soft orbit around furniture, micro push-in to material.
- Speed: calm and continuous. Avoid rapid FPV, drone racing, ground-level crawl, or impossible ceiling passes.
- Keep verticals stable. Do not add chaotic roll unless the brief is explicitly experimental.

## Visual Direction

Prioritize:

- Real material behavior: wood grain, stone veining, linen texture, brushed metal, plaster, glass reflections, soft carpet, ceramic glaze.
- Practical light: window daylight, warm sconces, pendant pools, hidden LED strips, reflected ceiling bounce.
- Spatial hierarchy: foreground frame, midground furniture anchor, background focal wall or view.
- Subtle lived-in detail if appropriate: folded throw, book stack, cup, plant, rug edge, cushion compression.

Avoid:

- Floating furniture, warped doors, impossible staircases, changing windows, random extra rooms.
- Showroom over-gloss that erases material texture.
- People blocking the design unless requested.
- Text baked into generated frames when captions can be added later.

## Prompt Requirements

For image prompts, include:

- Room type and exact spatial anchor.
- Camera position and direction.
- Fixed furniture or architectural elements.
- Material palette and lighting source.
- Required reference-binding instructions.

For video prompts, describe in this order:

1. Camera path.
2. Stable room layout and focal anchors.
3. Material and lighting changes visible during motion.
4. Ambient sound and subtitle boundary.

Use "no subtitles" in video prompts unless the current step is intentionally generating title cards.

## Quality Gate

Before handoff:

- The route can be walked physically.
- Main furniture, windows, doors, flooring, and focal wall stay consistent.
- Camera height and movement match the intended viewing experience.
- Materials remain faithful to references.
- Generated imageUrl or videoUrl values are present on the correct canvas nodes.
- The result has a clear next action: approve route, approve storyboard, generate video, assemble, revise, or export.
