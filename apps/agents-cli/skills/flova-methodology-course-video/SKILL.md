---
name: flova-methodology-course-video
description: Use when converting a methodology, SOP, training document, framework, lecture outline, PDF, deck, or dense internal note into a canvas-native course, explainer, or training video workflow.
---

# Methodology Course Video

## Overview

Use this workflow for instructional videos where structure, readability, and exact concepts matter more than cinematic spectacle.

Use it for methodology training, onboarding courses, internal SOP explainers, framework breakdowns, AI workflow tutorials, product education, and policy or compliance learning clips.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## Canvas-Native Contract

- This workflow uses the JarvisHub canvas execution model. Use the tools exposed in this turn and the current project node model.
- Treat source documents and uploaded decks as authoritative. Preserve exact terminology, formulas, warnings, and step order unless the user asks for rewriting.
- If generated images cannot render exact text reliably, produce clean visual backgrounds or diagrams and put exact text into editable post-production text layers, slide nodes, or HTML/CSS assets.
- Use subagents as optional specialists: document analyst, course designer, visual system designer, video prompt specialist, and readability reviewer.
- For any generated image or clip, require a real returned URL before using it as downstream reference.

## Intake

Collect or infer:

- Source material: pasted outline, PDF, markdown, document, deck, mind map, or meeting notes.
- Audience: beginner, operator, manager, customer, sales, engineer, executive.
- Learning goal: awareness, procedural training, certification, sales enablement, product education, change management.
- Duration and format: 60s social explainer, 3-5 minute course segment, long training chapter, vertical short, horizontal lesson.
- Required language, voiceover style, subtitle behavior, brand style, and whether exact screen text is required.

If the user provides only a topic, first create a compact course outline and ask for approval before producing media.

## Workflow

1. Parse the source.
   - Extract chapters, concepts, steps, definitions, decision points, examples, risks, and metrics.
   - Separate factual content from presentation advice.
   - Preserve official names, formulas, values, and compliance language exactly.

2. Create the learning spec.
   - Define audience, prerequisite knowledge, learning objective, duration, output language, tone, and required artifacts.
   - Convert the material into a 3-level structure: chapter, scene, beat.
   - Mark any missing information or ambiguous claims.

3. Build the course script.
   - Use short voiceover paragraphs. Keep each sentence easy to speak.
   - Move dense tables, formulas, and lists into visual layers instead of overloading narration.
   - Add instructor cues only when needed: pause, recap, example, warning, checklist.

4. Design visual pages or scenes.
   - Use clear instructional layouts: title plus diagram, two-column compare, step ladder, timeline, process map, checklist, before/after, dashboard mockup, alert panel.
   - Keep text readable on mobile. Prefer fewer lines and larger type.
   - For exact text, use editable overlay layers rather than asking image models to draw text.

5. Generate storyboard or slide frames.
   - Create one frame per concept beat.
   - Each frame must specify visual hierarchy, text layer content, diagram content, animation intent, and voiceover range.
   - If the harness supports storyboard panels, use them to approve the course flow before video generation.

6. Animate or generate clips.
   - Use motion only to support comprehension: reveal, highlight, zoom, trace path, compare, toggle, sequence.
   - Avoid decorative motion that distracts from the methodology.
   - For screencast-like content, prefer mock UI states and callouts rather than unstable generated interface text.

7. Assemble lesson.
   - Align narration, subtitle layers, slide visuals, callouts, music, and transitions.
   - Keep music low or omit it for serious training.
   - Add chapter markers or section titles when the video exceeds about 90 seconds.

## Content Transformation Rules

- Do not turn training content into a marketing landing-page script unless requested.
- Do not invent case studies, metrics, legal advice, policy names, or customer claims.
- Use examples only when they are supplied, clearly generic, or explicitly requested.
- Keep one idea per visual beat.
- Convert long paragraphs into voiceover plus diagram, not into tiny slide text.
- If source content is contradictory, preserve the contradiction in a reviewer note and ask before resolving it.

## Visual System

Recommended course styles:

- Clean whiteboard plus diagram.
- Calm SaaS training UI.
- Brand-colored slide system.
- Minimal editorial explainer.
- Instructor-led chapter cards.
- Dashboard and callout walkthrough.

Avoid:

- Cinematic dark mood that harms readability.
- Random stock-photo backgrounds behind dense text.
- Tiny text, fake UI labels, unreadable charts, and decorative 3D objects.
- Long text burned into generated images when it should remain editable.

## Prompt Requirements

For slide or frame generation, include:

- Layout type and hierarchy.
- Exact editable text separately from image-generation description.
- Diagram primitives: boxes, arrows, lanes, icons, chart placeholders.
- Safe margins and target aspect ratio.
- Brand or course visual style, only if provided or inferred from existing assets.

For video generation, describe:

1. Camera or canvas motion.
2. Element reveal or highlight.
3. Concept transition.
4. Voiceover/subtitle boundary.

Do not place full narration inside the video prompt if separate audio or subtitle layers will be assembled later.

## Quality Gate

Before handoff:

- Every source chapter or required concept is covered or explicitly deferred.
- Exact terms, formulas, numbers, and compliance warnings are preserved.
- Text is readable at the target aspect ratio.
- Motion supports explanation instead of distracting from it.
- Generated media URLs are present and mapped to the correct canvas nodes.
- The result has a clear next action: approve outline, approve storyboard, generate clips, assemble, revise, or export.
