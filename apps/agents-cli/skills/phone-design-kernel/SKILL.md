---
name: phone-design-kernel
description: Mandatory professional industrial-design guidance for smartphone exterior concepts, phone form and CMF exploration, camera architecture, product hero images, and revisions of phone imagery. Use before proposing directions, writing an image prompt, generating, or reviewing a phone design.
---

# Phone Design Kernel

Develop contemporary smartphone exterior concepts from a versioned 2026 maturity floor, with India-market industrial-design judgment as the default orientation. The Kernel remains brand-neutral and provider-neutral; it supplies Design Authority while the current Agent host supplies conversation and image execution.

## Interface

Accept a new-phone brief, a requested Learning Batch, or an existing phone image plus revision instructions. Return the accepted exterior thesis, visible decisions, a complete provider-ready prompt, evidence versions, every generated image, and an image-grounded Pass/Reject review.

Default to an India-oriented mainstream slab smartphone. Use entry, mainstream, upper-mid, or flagship language when product class matters; do not make product strategy or hardware decisions that belong to the brief. Enter foldable or other form factors only when explicitly requested. Do not generate real logos or imitate a named competitor signature.

## 1. Verify and load

Run:

```bash
node <skill-directory>/scripts/validate-kernel.mjs
```

Then read, in order:

1. [`references/phone-base-contract.md`](references/phone-base-contract.md)
2. [`references/contemporary-baseline.md`](references/contemporary-baseline.md)
3. [`references/design-judgment-schema.md`](references/design-judgment-schema.md) and its authoritative nested model [`references/phone-design-judgment.schema.json`](references/phone-design-judgment.schema.json)
4. [`references/design-dialogue.md`](references/design-dialogue.md)
5. the smallest relevant section of [`references/sources.md`](references/sources.md)

Stop if validation fails. The loaded files, not caller assumptions, define the current contract.

## 2. Run bounded design dialogue

Follow `design-dialogue.md`. Treat supplied product requirements as inputs and ask only questions that materially change exterior form. For a new direction, normally use two turns and at most three; for a revision, use one turn and at most two. State a professional exterior reading, name one consequential form tension, and offer visibly different geometric strategies rather than abstract product propositions.

When the user asks to use recommendations, proceed directly with the recommended decisions. One accepted dialogue covers an explicitly requested Learning Batch; its four images may be free exploration, a controlled comparison, several implementations of one theme, or a series.

Dialogue is complete at Generation Readiness: one accepted exterior thesis, a continuous Form Spine, three to five visible decisions, preservation and exclusion constraints, and no unresolved consequential conflict.

## 3. Resolve the exterior concept

Resolve the complete phone even when one surface is less visible:

- product class and supplied shape-critical requirements without redefining the product;
- the relevant India-oriented reading and an approximate 80% Functional Form / 20% Cultural Expression balance unless the brief overrides it;
- one exterior thesis and one Leading Departure;
- a continuous Form Spine linking silhouette, corner and chamfer family, visual thickness, front/back/frame transitions, and grip character;
- Exterior Consequences of supplied functional requirements, without visual performance claims;
- one Cultural Expression source translated through a primary and supporting carrier, plus a restrained culture-bearing Presentation Atmosphere;
- display boundary, bezel logic, front camera treatment, and an evaluation-neutral screen that does not echo the exterior design language;
- rear-surface architecture and Camera Architecture;
- controls, openings, seams, antenna breaks, and assembly boundaries;
- material, finish, colour, reflectivity, and texture by physical zone;
- two or three logo-independent Family Genes;
- composition, camera, lighting, background, and explicit exclusions.

Keep the remaining design at the 2026 Contemporary Baseline. Never turn an image into a claim of optical, structural, thermal, radio, battery, ingress, manufacturing, or market validity.

## 4. Compile the provider-ready prompt

Write one complete visible specification in this order:

1. product class, India-oriented context, title, exterior thesis, Leading Departure, and the Functional Form / Cultural Expression hierarchy;
2. exactly one continuous Phone Dual-View Hero: two consistent representations of the same design and colourway, rear or rear-three-quarter primary and front secondary;
3. shared silhouette, proportions, thickness character, corner radii, matching geometry across both views, and a coherent camera elevation that reveals only physically visible faces;
4. front/display treatment with a neutral low-information screen that stays independent of the exterior design language;
5. rear and Camera Architecture;
6. frame, controls, openings, seams, and transitions;
7. Cultural Expression source, extracted relationship, primary and supporting carriers, CMF zones, and Family Genes;
8. one restrained interface state;
9. culture-bearing presentation atmosphere, camera, lighting, backdrop, occupancy, and shadows;
10. forbidden outcomes from the Base Contract and request.

For a local edit, state what must remain unchanged before describing the change. Do not paste rationale or source prose into the image prompt.

Evidence for the initial learning version:

```text
phone-kernel@1.4.0-learning
phone-base-contract@0.1.3
phone-contemporary-baseline:2026@0.1.0
phone-design-judgment-schema@1.4.0
phone-design-judgment-model@1.4.0
```

Pass these through the native `sourceEvidence` field; if unavailable, return them beside the prompt.

## 5. Gate before generation

Generate only when all are true:

- every explicit constraint and accepted decision is present;
- one thesis and one Leading Departure organize the design;
- Functional Form remains primary while Cultural Expression is visibly carried by the phone itself;
- the Presentation Atmosphere continues rather than substitutes for the phone’s cultural relationship;
- the prompt resolves the complete exterior and Camera Architecture;
- the Dual-View Hero requires exactly two consistent views of one design and colourway;
- front/rear geometry, frame, controls, camera hardware, thickness, CMF, and corner family can agree across views;
- each view has coherent projection and occlusion, without exposing a top or bottom face from an incompatible camera elevation;
- the product reads unmistakably as one bare unaccessorized phone, not a phone inside a bumper or case-like outer shell;
- the neutral screen reveals the front without repeating or competing with the rear design language;
- the result reads as a current smartphone rather than a legacy phone or speculative post-phone object;
- no unsupported claim, real logo, contact sheet, technical board, product lineup, hand, or person appears unless explicitly requested.

Repair the prompt before generation if a gate fails.

## 6. Generate without selection

Use the host's available, user-authorized image-generation capability. Generate exactly once for each authorized direction. A requested three-direction comparison receives three independent prompts sharing the same fixed brief and differing only in the declared strategy axis.

Do not generate extras, cherry-pick, automatically replace, or retry a returned image. If no image capability exists, return the accepted design packet and state that no image was generated.

## 7. Review and deliver every image

Inspect actual pixels. Always show every generated image, including rejected images. For every multi-image Learning Batch, first create and show one numbered comparison board in stable reading order, preserving each complete image without crop or distortion; then keep the individual originals available. Return:

- **Pass** or **Reject**;
- 2–3 visible evidence points covering current identity, structural continuity, cross-view consistency, and instruction adherence;
- the first failed Base Contract rule, if any;
- one next step.

Aesthetic preference remains the user's authority. Reject never means hide, discard, or automatically regenerate.
