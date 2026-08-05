---
name: watch-design-kernel
description: Mandatory professional design guidance for any smartwatch/watch concept image, product hero render, watch CMF exploration, or watch image revision. Use before directional design dialogue, writing the final image prompt, or calling canvas_image_generate_to_canvas.
---

# Watch Design Kernel

Use this Skill for every smart-watch design image. Stay inside Jarvis's native workflow: the Kernel supplies Design Authority; Jarvis remains the Execution Authority, writes the final Prompt, and uses the existing media Tool.

## Operating rules

- Do not create another Agent, workflow, Contract, Tool, state record, or user-facing knowledge browser.
- Treat only atoms with `review_status: approved` as Curated Knowledge.
- Keep model inference distinct from Curated Knowledge. Never turn an image into a claim of engineering, medical, manufacturing, waterproofing, sensing, thermal, or battery validity.
- Do not expose atom IDs, review digests, matching scores, approval fields, or raw resource content in user-facing copy.
- The current knowledge approval covers internal development, testing, and learning only. Do not represent it as commercially cleared content.

## Directional Design Dialogue

When this Skill is loaded by a caller that can use the native `ask_user` tool:

1. Load `references/design-dialogue.md`, `references/catalog.json`, and the smallest relevant domain resources.
2. For a new core concept or material direction change, select 3–6 compatible approved moves and project them as Markdown Professional Design Strategy Cards. Every card must show **Strategy**, **Why this direction**, **Visible impact**, and **Trade-off**. Never show internal IDs or approval metadata.
3. Present one Recommended Strategy Composition through the unchanged `ask_user` schema. The `question` itself must literally contain all 3–6 complete Markdown cards; a short composition name or summary is not a substitute. Before calling the Tool, count 3–6 occurrences of each required card field (`**Strategy**`, `**Why this direction**`, `**Visible impact**`, `**Trade-off**`). The initial options must be exactly `按此策略生成` and `调整策略`; do not dispatch Media in the same turn because `ask_user` stops the turn.
4. On `调整策略`, interpret natural language, show a visibly revised composition, and ask again. Show a small replacement candidate set only when replacement truly requires a choice.
5. On `按此策略生成`, acceptance is also Generation Authorization. Put only the accepted visible decisions into Media's native `task_contract.userConstraints`. Do not pass atom IDs, a Skill name, Kernel method, or a Root-authored final Prompt.
6. Ask another question only for a required missing product fact, substantive conflict, incompatible requirement, unsafe claim, or direction-defining decision that cannot be responsibly inferred.

Skip this dialogue for local edits, derivative scenes, detail images, alternate views, and continuations grounded by native `generationContext`. Also skip it when the user already stated the relevant strategies explicitly.

When loaded inside the Media sub-agent, do not initiate dialogue. Treat accepted visible `userConstraints` as binding, independently select supporting knowledge, author the final Prompt, and never silently reverse an accepted decision. Return conflicts to Root.

## Required progressive loading for generation

1. Load `references/concept-image-base-model.md`. It is mandatory for every generated watch image.
2. Load `references/catalog.json` and route the request to the smallest relevant set of domain resources. Usually load 1–3 domains, never all six by default.
3. From those resources, select 2–4 compatible approved atoms that support the accepted visible decisions and materially affect the image. Apply `activation` and `avoid_when`; do not pad the selection.
4. Load `references/approval-ledger.json` and resolve the exact `review_digest` for every selected atom.
5. Translate each selected atom's `move.action` and `move.visible_cues` into concrete visible requirements in the final Prompt. Preserve applicable limits and avoid incompatible moves.
6. Complete every mandatory BaseModel section directly in the final Prompt. Knowledge atoms strengthen the BaseModel; they do not replace it.

## Native image Tool contract

Call `canvas_image_generate_to_canvas` with the ordinary Jarvis fields. Do not invent watch-specific Tool arguments.

`sourceEvidence` is mandatory for a watch generation and must contain:

```text
watch-base-model:concept-image@1.0.0
watch-knowledge-catalog@0.2.0
watch-atom:<atom_id>@sha256:<review_digest>
```

Include exactly one BaseModel entry, one catalog entry, and one entry for each selected atom. The digest must be copied exactly from `approval-ledger.json`. Never fabricate a digest. If evidence cannot be resolved, return blocked instead of generating.

For output identity and references:

- A new directional generation must allocate a fresh outputKey that is stable for that requested direction but does not collide with a historical Artifact. The example below is a naming shape, not one canonical reusable ID.
- A historical Canvas image must not become a visual reference merely because it exists, shares a prefix, was returned by `canvas_flow_inspect`, or appeared in an earlier failed recovery. Use an existing image only when the user explicitly selected/attached it or explicitly requested modification of that Artifact.
- For a new direction, keep image `contextNodeIds` empty unless the user supplied an explicit visual reference. A follow-up such as “图呢？” resumes the authorized fresh generation; it does not authorize converting an unrelated historical image into an image-edit source.

Example shape:

```json
{
  "outputKey": "watch_concept_sculpted_lug_01",
  "label": "Professional smartwatch concept",
  "prompt": "<complete provider-ready prompt>",
  "sourceEvidence": [
    "watch-base-model:concept-image@1.0.0",
    "watch-knowledge-catalog@0.2.0",
    "watch-atom:watch-visual-thickness-layering@sha256:ac9b5da6d6c685cde4dbc25f1df3365393ef4a4cd3341cfc5d3fe628598bf9a4"
  ]
}
```

After dispatch, follow the native Media Agent lifecycle: wait for `status=success` and `persisted=true`; do not claim completion from provider acceptance alone.

## Prompt quality gate

Before calling the image Tool, verify:

- every accepted visible userConstraint is preserved without silent substitution;
- one continuous frame and exactly one complete watch;
- case, display/glass, controls/openings, attachment, complete strap/closure, CMF zones, one interface state, detail hierarchy, camera, lighting, and forbidden outcomes are explicit;
- selected knowledge appears as visible design moves, not rationale pasted into the Prompt;
- no logo, brand name, fake specification, medical claim, engineering claim, released-product implication, contact sheet, parallel variants, exploded view, wearer, hand, or wrist unless the user explicitly requests a later contextual artifact;
- `sourceEvidence` contains the exact BaseModel/catalog versions and immutable digests for all selected atoms.

If any required item is missing, repair the Prompt before generation. If a binding user decision conflicts with safety or artifact validity, return blocked to Root rather than changing direction.
