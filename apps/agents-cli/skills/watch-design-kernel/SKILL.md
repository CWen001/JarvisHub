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

## Lightweight Design Dialogue

When this Skill is loaded by a caller that can use native `ask_user`:

1. Load `references/design-dialogue.md`, `references/catalog.json`, and the smallest relevant domain resources.
2. Before every Watch image-generation request, run one native **Design Direction Turn** unless the user explicitly waives it by asking to use the recommendation or proceed without discussion. One turn covers one user request, including a same-direction batch; never ask once per Provider call.
3. Use safe professional defaults inside each direction. Call unchanged native `ask_user` with one concise question and three concise text options by default; put them in `ask_user.options` and clearly mark the first option as recommended. Do not use `optionCards` unless every card has valid image URLs from user-authorized references or an explicit request to compare images. New concepts get coherent product-strategy and aesthetic bundles. Local edits, derivatives, alternate views, and retries get a narrower implementation-strength or trade-off choice. Use fewer options rather than inventing weak alternatives.
4. Accept either a clicked option or a free-text reply and continue without another confirmation. Ask once more only when the reply creates a real conflict, unsafe claim, or unresolved consequential choice. Text choices are the default; never create empty or text-only image cards.
5. The initial image request authorizes the Design Direction Turn; its answer or explicit waiver authorizes Provider execution. Put only user-stated constraints and user-confirmed visible decisions in Media's native `task_contract.userConstraints`. Keep atom IDs, Skill methods, and the final Prompt out of the handoff.

A professional user can request deeper rationale in ordinary Chat. Do not call this interaction “Grill” in user-facing copy.

When loaded inside Media, do not initiate dialogue. Treat visible `userConstraints` as binding, independently select supporting knowledge, author the final Prompt, and return conflicts to Root.

## Non-Jarvis host fallback

When the host has no native `ask_user`, present the same Design Direction Turn as one Markdown question with numbered options, then stop for the user's reply. When the host has no Canvas or image Provider, complete the professional work as a portable generation packet: accepted direction, provider-ready Prompt, exact `sourceEvidence`, and the quality-gate verdict; state plainly that no image was generated. If the user supplies an image directly, review its visible pixels and return Pass or Reject, 2–3 visible evidence points, and one next step without claiming Canvas persistence.

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

## Actual-image review

For every newly persisted Watch Concept Image, Root dispatches one Critic review in the same request. Critic loads this Skill and the relevant quality resources, reads the actual pixels from Canvas, and returns **Pass** or **Reject**, 2–3 visible evidence points, and one next step. Deliver the image with either verdict. No automatic retry; regenerate only when the user explicitly requests it.

## Prompt quality gate

Before calling the image Tool, verify:

- every accepted visible userConstraint is preserved without silent substitution;
- one continuous frame and exactly one complete watch;
- case, display/glass, controls/openings, attachment, complete strap/closure, CMF zones, one interface state, detail hierarchy, camera, lighting, and forbidden outcomes are explicit;
- selected knowledge appears as visible design moves, not rationale pasted into the Prompt;
- no logo, brand name, fake specification, medical claim, engineering claim, released-product implication, contact sheet, parallel variants, exploded view, wearer, hand, or wrist unless the user explicitly requests a later contextual artifact;
- `sourceEvidence` contains the exact BaseModel/catalog versions and immutable digests for all selected atoms.

If any required item is missing, repair the Prompt before generation. If a binding user decision conflicts with safety or artifact validity, return blocked to Root rather than changing direction.
