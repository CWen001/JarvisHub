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

## Bounded Design Dialogue

When this Skill is loaded by a caller that can use native `ask_user`:

1. Load `references/design-dialogue.md`, `references/design-judgment-schema.md`, `references/catalog.json`, and the smallest relevant domain resources.
2. Build the unresolved design as a decision tree and ask the current frontier rather than jumping directly to form adjectives. Ask together the consequential decisions whose prerequisites are settled; defer dependent questions.
3. For a new direction, normally use two turns and at most three: first resolve role, maturity prior, and main tension; then construct the Design Spine, resolve a Hero-visible Craft Carrier within the thickness budget, bind its process to the substrate, and compose substrate-compatible secondary echoes. A series request must establish one parent Design Spine, two or three inherited relationships, shared craft syntax, and one primary variation axis per model before local styling. For a local revision, use one turn and at most two.
4. Each turn states the professional reading, offers visibly distinguishable consequences with an honest trade-off, gives a recommendation, and accepts free text. Use `ask_user.options` for one coupled strategy choice; use numbered questions when several independent frontier decisions are ready. Use `optionCards` only with valid image URLs from user-authorized references.
5. Stop asking only when the Design Judgment Schema readiness invariant passes. An explicit request to use recommendations applies the recommended answers at each needed frontier; an explicit waiver permits immediate professional defaults.
6. Before the first Provider call, state the exact batch count, fixed conditions, and deliberate judgment differences, then request one confirmation for that batch. Do not confirm per image or retry a failure without a new user request.
7. Put only user-stated constraints and user-confirmed visible decisions in Media's native `task_contract.userConstraints`. Keep atom IDs, Skill methods, and the final Prompt out of the handoff.

A professional user can request deeper rationale in ordinary Chat. Do not call this interaction “Grill” in user-facing copy.

When loaded inside Media, do not initiate dialogue. Treat visible `userConstraints` as binding, independently select supporting knowledge, author the final Prompt, and return conflicts to Root.

## Non-Jarvis host fallback

When the host has no native `ask_user`, present the same Design Direction Turn as one Markdown question with numbered options, then stop for the user's reply. When the host has no Canvas or image Provider, complete the professional work as a portable generation packet: accepted direction, provider-ready Prompt, exact `sourceEvidence`, and the quality-gate verdict; state plainly that no image was generated. If the user supplies an image directly, review its visible pixels with the same Render Integrity and Brief Fit gates, 2–3 visible evidence points, and one next step without claiming Canvas persistence.

## Required progressive loading for generation

1. Load `references/concept-image-base-model.md` and `references/design-judgment-schema.md`. Both are mandatory for every generated watch image: the BaseModel defines visible completeness; the Schema resolves mature whole-product relationships before prompt authorship.
2. Resolve every line of the Schema's Compact Internal Design State before Prompt authorship. Use its fixed values only for invariants, controlled choices with a precise-alternative escape, bounded composition counts, role-derived defaults, and relational quantities. If its readiness chain is incomplete, return to Design Dialogue instead of sending the direction to the Provider.
3. Load `references/catalog.json` and route the request to the smallest relevant set of domain resources. Usually load 1–3 domains, never all six by default.
4. From those resources, select 2–4 compatible approved atoms that support the accepted visible decisions and materially affect the image. Apply `activation` and `avoid_when`; do not pad the selection.
5. Load `references/approval-ledger.json` and resolve the exact `review_digest` for every selected atom.
6. Translate the resolved Schema judgments and each selected atom's `move.action` and `move.visible_cues` into concrete visible requirements in the final Prompt. Preserve applicable limits and avoid incompatible moves.
7. Complete every mandatory BaseModel section directly in the final Prompt. The Schema organizes whole-product judgment and Knowledge atoms deepen local resolutions; neither replaces the BaseModel.

## Native image Tool contract

Call `canvas_image_generate_to_canvas` with the ordinary Jarvis fields. Do not invent watch-specific Tool arguments.

`sourceEvidence` is mandatory for a watch generation and must contain:

```text
watch-base-model:concept-image@1.0.6
watch-design-judgment-schema@0.6.0
watch-knowledge-catalog@0.2.0
watch-atom:<atom_id>@sha256:<review_digest>
```

Include exactly one BaseModel entry, one Design Judgment Schema entry, one catalog entry, and one entry for each selected atom. The digest must be copied exactly from `approval-ledger.json`. Never fabricate a digest. If evidence cannot be resolved, return blocked instead of generating.

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
    "watch-base-model:concept-image@1.0.6",
    "watch-design-judgment-schema@0.6.0",
    "watch-knowledge-catalog@0.2.0",
    "watch-atom:watch-visual-thickness-layering@sha256:ac9b5da6d6c685cde4dbc25f1df3365393ef4a4cd3341cfc5d3fe628598bf9a4"
  ]
}
```

After dispatch, follow the native Media Agent lifecycle: wait for `status=success` and `persisted=true`; do not claim completion from provider acceptance alone.

## Actual-image review

For every newly persisted Watch Concept Image, Root dispatches one Critic review in the same request. Critic reads the actual pixels from Canvas and reports two separate gates:

- **Render integrity — Pass/Reject:** perspective, geometry, connections, duplicated or missing parts, complete strap and closure.
- **Brief fit — Pass/Reject:** fidelity to the user's confirmed direction and selected visible moves.

Then give 2–3 visible evidence points and one next step. Do not reject from speculative ergonomics, manufacturing, sensing, or durability claims that pixels cannot prove; identify those only as validation needs when relevant. Deliver every valid image regardless of verdict. No automatic retry.

## Feedback learning gate

Apply this section only during an explicitly authorized Skill-learning exercise; ordinary image generation never edits the Skill.

- Treat each user judgment as an experiment observation, not an immediate global rule.
- Promote at most one rule per batch, and only when the user identifies a reusable reason, the issue is an objective render defect, or the same pattern recurs across at least two distinct themes.
- Do not globalize an unexplained aesthetic preference. State that no rule was promoted when evidence is insufficient.
- Update the narrowest existing domain atom first. Reserve the BaseModel for universal frame, completeness, prompt, and render-integrity constraints.

## Prompt quality gate

Before calling the image Tool, verify:

- the Design Judgment Schema readiness invariant passes and its generated relationship chain is preserved in the Prompt;
- every accepted visible userConstraint is preserved without silent substitution;
- one continuous frame and exactly one complete watch;
- case, display/glass, controls/openings, attachment, complete strap/closure, CMF zones, one interface state, detail hierarchy, camera, lighting, and forbidden outcomes are explicit;
- selected knowledge appears as visible design moves, not rationale pasted into the Prompt;
- no logo, brand name, fake specification, medical claim, engineering claim, released-product implication, contact sheet, parallel variants, exploded view, wearer, hand, or wrist unless the user explicitly requests a later contextual artifact;
- `sourceEvidence` contains the exact BaseModel/catalog versions and immutable digests for all selected atoms.

If any required item is missing, repair the Prompt before generation. If a binding user decision conflicts with safety or artifact validity, return blocked to Root rather than changing direction.
