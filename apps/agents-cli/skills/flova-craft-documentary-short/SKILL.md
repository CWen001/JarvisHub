---
name: flova-craft-documentary-short
description: Use when creating a canvas-native traditional craft documentary short from craft notes, heritage process material, workshop references, product photos, or a request like "天工开物", "非遗纪录片", "传统工艺短片", or "craft process film".
---

# Craft Documentary Short

## Overview

Use this workflow for traditional craft documentaries. It defines the production method while actual execution follows JarvisHub canvas harness tools and configured subagents.

Use it to turn a traditional craft, product-making process, regional material, workshop reference, or heritage brief into a short documentary with credible process evidence, restrained cinematic beauty, and usable canvas assets.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## Canvas-Native Contract

- Do not redefine canvas tool parameters or system prompt constraints inside the skill output.
- Bind uploaded images, video references, documents, and existing canvas nodes before generating replacements.
- Prefer storyboard-first execution when the final deliverable is video. Create or reuse key assets, then generate shot clips, then assemble.
- Use subagents only for role separation, not as hard dependencies: craft researcher, storyboard director, image prompt specialist, video prompt specialist, and continuity reviewer are useful roles.
- Every generated image or video node must have a real returned URL before it is treated as usable evidence for the next step.

## Required Intake

Collect or infer:

- Craft name, region, era or living context.
- Finished object, raw material, tools, key process steps, and any forbidden inaccuracies.
- Reference media, if provided: maker portrait, workshop, raw material, finished product, historical photo, sound reference.
- Target format: aspect ratio, duration, language, subtitle style, and whether voiceover is needed.
- Output goal: documentary, museum explainer, brand heritage film, social short, course insert, or product process vignette.

If a user only provides a short topic, choose a conservative default: 45 seconds, 16:9, Chinese voiceover, documentary tone, 6-9 shots.

## Production Flow

1. Create the craft spec.
   - Summarize the verifiable facts and user-provided evidence.
   - Mark uncertain cultural, historical, or technical claims as "待确认" instead of presenting them as fact.
   - Identify the process spine: origin, material, hand skill, transformation, finished use.

2. Build the asset map.
   - Subject assets: maker hands, raw material, tool, semi-finished state, finished product.
   - Scene assets: workshop wide shot, bench/table close zone, drying/firing/weaving/cutting zone, final display location.
   - Texture assets: fibers, clay, metal, lacquer, wood grain, glaze, paper, stone, dye, smoke, steam, dust, water.

3. Write the documentary structure.
   - Opening: establish region, material, or finished object without overexplaining.
   - Process: show tactile steps in physical order.
   - Transformation: emphasize hand pressure, temperature, rhythm, waiting, polishing, inspection.
   - Closing: finished object enters use, display, ritual, packaging, or contemporary context.

4. Create storyboard panels.
   - Keep each shot visually executable: subject, scene, action, camera, light, and audio cue.
   - For 30-60 seconds, use 6-12 shots. For longer pieces, split into chapters and delegate to long-video production orchestration.
   - Generate multi-panel storyboard boards when the harness supports board generation, then use approved frames as video references.

5. Generate or bind visual assets.
   - Preserve user-provided craft evidence. Do not replace a real craft reference with a prettier but inaccurate object.
   - For generated assets, lock material texture, tool geometry, hand position, and workshop layout before video generation.

6. Produce video clips.
   - Convert approved keyframes or asset references into short clips.
   - Prompt motion by physical cause: blade cuts, brush lays pigment, loom shuttle passes, wheel turns, steam rises, glaze pools.
   - Avoid impossible craft mechanics, arbitrary magical transformation, and modern factory machinery unless the user asked for it.

7. Assemble and review.
   - Align voiceover, foley, ambient sound, and subtitles after clips are stable.
   - Mute unwanted generated clip audio when separate narration or music is used.
   - Check final continuity before export.

## Visual Direction

Use a quiet documentary vocabulary:

- Natural side light, workshop shadow, practical lamps, morning dust, kiln glow, paper-window diffusion.
- Macro tactile shots: fingertips, tool edge, powder, fiber tension, wet surface, drying crack, polished highlight.
- Mineral and material palette: clay red, soot black, indigo, raw linen, aged brass, rice paper, wood brown, ash gray.
- Camera language: slow push-in, locked-off process observation, over-shoulder hand work, macro insert, low table-level tracking.

Avoid:

- Generic fantasy "ancient China" visuals when the craft requires specific local evidence.
- Random calligraphy, fake historical dates, unreadable plaques, or invented master names.
- Beauty shots that skip the craft process.
- Overly glossy luxury commercial lighting unless the output goal is explicitly a brand film.

## Prompt Requirements

For key images, include:

- The craft object or process step.
- The exact material state.
- Tool and hand relationship.
- Scene location and practical light.
- Documentary texture and camera framing.

For video prompts, describe motion in this order:

1. Camera movement.
2. Maker or tool action.
3. Material transformation.
4. Ambient sound, foley, voiceover boundary, and subtitle boundary.

When separate voiceover is planned, do not place narration text inside the video-generation prompt. Use "no subtitles" unless the current step is explicitly producing title cards.

## Quality Gate

Before handing off the result:

- Craft steps are physically plausible and ordered.
- Main object, tools, and material remain visually consistent across shots.
- No unsupported cultural or historical claim is stated as fact.
- Process shots outweigh generic atmosphere shots.
- Generated media URLs exist and are assigned to the right canvas nodes.
- The final deliverable has a clear next action: approve storyboard, generate clips, assemble, revise, or export.
