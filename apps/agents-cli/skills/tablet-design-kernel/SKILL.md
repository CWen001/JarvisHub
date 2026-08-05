---
name: tablet-design-kernel
description: Mandatory professional design guidance for any tablet-computer concept sketch, tablet product render, tablet CMF exploration, tablet form-state design, or tablet image revision. Use before directional design dialogue, writing the final image prompt, or calling canvas_image_generate_to_canvas.
---

# Tablet Design Kernel

Use this Skill for every tablet-computer design image. Stay inside Jarvis's native workflow: this Kernel supplies Tablet Design Authority; Jarvis remains the Execution Authority, writes the final Prompt, and uses the existing media Tool.

## Operating rules

- Do not create another Agent, workflow, Contract, Tool, state record, Tablet Concept database, user-facing knowledge browser, Provider path, Session system, Gallery, or Canvas type.
- Treat only atoms with `review_status: approved` as Curated Knowledge.
- Keep Studio Design Judgment central. Knowledge may deepen a local resolution but never replaces whole-product coherence or the Tablet Quality Benchmark.
- Keep model inference distinct from Curated Knowledge. Never turn an image into a claim of engineering, manufacturing, durability, thermal, battery, radio, structural, or dimensional validity.
- Do not expose atom IDs, review digests, relevance scores, approval fields, benchmark internals, or raw resource content in user-facing copy.
- The imported corpus is approved for the current internal demo package; do not represent its source material as separately commercially cleared.

## Directional Design Dialogue

When this Skill is loaded by a caller that can use the native `ask_user` tool:

1. Load `references/design-dialogue.md`, `references/quality-benchmark.md`, `references/catalog.json`, and `references/knowledge.json`.
2. Judge Design Brief Sufficiency. Ask one concise clarification only when a decisive product fact is missing, a requirement conflicts, or the intended form/use state cannot be responsibly inferred.
3. For a new core concept or material direction change, select 3–6 compatible professional moves and project them as Markdown Professional Design Strategy Cards. Every card must show **Strategy**, **Why this direction**, **Visible impact**, and **Trade-off**. The composition must cover the whole product rather than merely list Knowledge Atoms.
4. Present one Recommended Strategy Composition through the unchanged `ask_user` schema. The `question` itself must literally contain all 3–6 complete Markdown cards; a short composition name or summary is not a substitute. Before calling the Tool, count 3–6 occurrences of every required card field. The initial options must be exactly `按此策略生成` and `调整策略`; do not dispatch Media in the same turn because `ask_user` stops the turn.
5. On `调整策略`, interpret natural language, show a visibly revised composition, and ask again. Show replacement candidates only when a real decision remains.
6. On `按此策略生成`, acceptance is also Generation Authorization. Put only accepted visible decisions into Media's native `task_contract.userConstraints`. Do not pass atom IDs, digests, a Skill name, Kernel method, benchmark terminology, or a Root-authored final Prompt.
7. Ask another question only for a missing required design fact, substantive strategy conflict, incompatible requirement, unsafe claim, or direction-defining decision that cannot be responsibly inferred.

Skip this dialogue for local edits, derivative scenes, detail images, alternate views, and continuations grounded by native `generationContext`. Also skip it when the user already stated the relevant strategies explicitly.

When loaded inside the Media sub-agent, do not initiate dialogue. Treat accepted visible `userConstraints` as binding, independently select supporting knowledge, author the final Prompt, and never silently reverse an accepted decision. Return conflicts to Root.

## Required progressive loading for Concept Sketch generation

1. Load `references/concept-sketch-base-model.md`. It is mandatory for every generated tablet Concept Sketch.
2. Load `references/quality-benchmark.md`; it is the implicit whole-product quality floor, not a selectable option or automatic Critic.
3. Load `references/catalog.json` and `references/knowledge.json`.
4. Select 2–4 compatible approved atoms that support accepted visible decisions and materially alter perceptible form, proportion, CMF, handling, state, input, accessory, or process evidence. Apply `limits` and `explicit_tension_pairs`; do not pad the selection.
5. Load `references/approval-ledger.json` and resolve the exact `review_digest` for every selected atom.
6. Translate every selected atom's `action` and `cues` into visible requirements in the final Prompt. Preserve applicable limits and explicitly resolve declared tensions.
7. Complete every mandatory BaseModel section directly in the final Prompt. Knowledge strengthens the BaseModel; it does not replace it.

For a downstream visual target, additionally load `references/artifact-guidance.md`. Those targets are packaged professional guidance, but Concept Sketch is the first acceptance-backed executable path.

## Native image Tool contract

Call `canvas_image_generate_to_canvas` with ordinary Jarvis fields. Do not invent Tablet-specific Tool arguments.

`sourceEvidence` is mandatory for Tablet generation and must contain:

```text
tablet-base-model:concept-sketch@2.0.0
tablet-quality-benchmark@2.0.0
tablet-knowledge-catalog@tablet-knowledge-2026-07
tablet-atom:<atom_id>@sha256:<review_digest>
```

Include exactly one BaseModel entry, one quality-benchmark entry, one catalog entry, and one entry for each selected atom. Copy every digest exactly from `approval-ledger.json`. Never fabricate a digest. If evidence cannot be resolved, return blocked instead of generating.

For output identity and references:

- A new directional generation must allocate a fresh outputKey that is stable for that requested direction but does not collide with a historical Artifact. The example below is a naming shape, not one canonical reusable ID.
- A historical Canvas image must not become a visual reference merely because it exists, shares a prefix, was returned by `canvas_flow_inspect`, or appeared in an earlier failed recovery. Use an existing image only when the user explicitly selected/attached it or explicitly requested modification of that Artifact.
- For a new direction, keep image `contextNodeIds` empty unless the user supplied an explicit visual reference. A follow-up such as “图呢？” resumes the authorized fresh generation; it does not authorize converting an unrelated historical image into an image-edit source.

Example shape:

```json
{
  "outputKey": "tablet_concept_jade_axis_01",
  "label": "Professional tablet Concept Sketch",
  "prompt": "<complete provider-ready prompt>",
  "sourceEvidence": [
    "tablet-base-model:concept-sketch@2.0.0",
    "tablet-quality-benchmark@2.0.0",
    "tablet-knowledge-catalog@tablet-knowledge-2026-07",
    "tablet-atom:edge-section-continuity@sha256:<exact review_digest>"
  ]
}
```

After dispatch, follow the native Media Agent lifecycle: wait for `status=success` and `persisted=true`; do not claim completion from Provider acceptance alone.

## Concept Sketch quality gate

Before calling the image Tool, verify:

- every accepted visible user constraint is preserved without silent substitution;
- one continuous frame contains one unmistakable, complete, bare-tablet Hero;
- Design Identity, Portfolio Position, Maturity Anchor, one bounded Leading Departure, and Identity Boundaries form one coherent proposition;
- the Hero State has credible element relationships, support/contact/load/input behavior, qualitative dimensional intent, and a legible carry relationship;
- enclosure, display/front, rear nodes, controls/openings, human contact, input feedback, accessory relationship when applicable, concrete CMF, process boundaries, hierarchy, camera, and lighting are explicit;
- one primary perceptible outcome leads, with zero or one subordinate evidence item only when necessary;
- selected knowledge appears as visible or tactile design evidence, not rationale pasted into the Prompt;
- no invented dimensions, logo, brand mark, fake specification, engineering claim, protective case disguised as the enclosure, contact sheet, equal-weight view board, story sequence, exploded view, parameter table, portrait-led scene, or text-heavy presentation;
- `sourceEvidence` contains exact BaseModel, benchmark, catalog, and immutable selected-atom revisions.

If any required item is missing, repair the Prompt before generation. If a binding user decision conflicts with safety or Artifact validity, return blocked to Root rather than changing direction. Ordinary successful generation does not automatically invoke Critic; review remains explicit unless a later delivery stage defines a concrete quality gate.
