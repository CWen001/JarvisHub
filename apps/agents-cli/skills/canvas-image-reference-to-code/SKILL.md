---
name: canvas-image-reference-to-code
description: Use when converting approved JarvisHub webpage preview screenshots or image references into final `webHero` HTML/CSS/JS code.
---

# JarvisHub Image Reference To Code

Convert approved reference images into final code only after the model has real visual context.

## Required Inputs

- Target `webHero` node id.
- Approved preview screenshot node ids.
- Any resolved webpage asset node ids or URLs.
- User approval evidence for the preview set.

## Execution Rules

1. Call `canvas_read_node_media_for_context` with every approved preview screenshot node id before writing final code.
2. Generate code section by section in the same order as the preview screenshots.
3. Construct complete `webHeroHtml` and `webHeroCss`; do not construct or stage `webHeroDocumentHtml` because the server derives it.
4. In an Agent canvas workflow, call `canvas_webhero_check_readiness`, copy its exact `flowUpdatedAt` and `previewNodeIds`, stage only HTML/CSS with one stable session ID, then call `canvas_webhero_code_commit`.
5. When the frontend WebHero runner explicitly requests strict JSON and owns tool execution, return the requested HTML/CSS JSON to that runner; the runner must use the same readiness/stage/commit transaction before reporting success.
6. Never use `canvas_update_node_data` or a generic Flow patch for final WebHero code.
7. Ensure the final DOM contains at least one real `<section>` per approved preview screenshot.
8. Check that every CSS/JS `#section-id` reference exists in the DOM.

## Prohibited

- Do not put final HTML/CSS/JS into a text node.
- Do not rely only on preview prompts or URLs; the model must read the actual images through multimodal context.
- Do not collapse multiple approved preview sections into a single generic section.
- Do not finish if the code contains CSS/JS for a section but no matching DOM section.
- Do not persist a model-produced `webHeroDocumentHtml`; accept only the server-derived document returned by commit.
