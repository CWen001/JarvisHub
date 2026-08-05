# Native Chat upstream-difference audit

Baseline: `upstream/main` at `5bedb8728f433addb4518ff225b735954d0f2835`.

This audit classifies every retained Native Chat difference by semantic responsibility. Line count is a risk signal, not ownership authority. The machine-readable source of truth for file ownership and required tests is `config/upstream-compatibility.json`.

## Product behavior to migrate behind Agent Workspace Adapter

- Product surface lifecycle and headless mounting.
- Agent Workspace draft, submit, interrupt, decision, Skill, and Session commands.
- Product reference upload, add, remove, successful-submit clearing, and Artifact continuation.
- Agent Workspace Project and Session navigation notifications.
- Product-only suppression of implicit Professional Canvas selection and automatic references.
- Product delivery of successful Media results into the owned Timeline.

These differences must leave Native Chat presentation during the contact-surface reduction. Native Chat Authority remains mounted and continues to execute every command.

## Permanent Integration Seam

- One mounted-controller registration from Native Chat to the Product-owned Agent Workspace Adapter.
- One headless lifecycle choice allowing Agent Workspace to consume authority without rendering native presentation.
- Stable Session-scoped state facts required by the existing Agent Workspace Runtime.

The final Native Chat file should contain only this narrow semantic contact plus independently justified Upstream Patches.

## Upstream Patches

- Chinese IME composition and visible-draft submission correctness.
- General retry behavior where a failed transport must not corrupt the native turn.
- General recovered decision and execution truth retained after persistence or stream recovery.

Each patch requires behavior coverage independent of Product Host mode and remains a candidate for upstream submission.

## Obsolete after migration

- Distributed Product-mode rendering branches that have no effect when the mounted controller is headless.
- Window-event command paths superseded by the registered Product-owned Adapter.
- Product-specific state mutation duplicated in Native Chat presentation.

## Protected external behavior

The following behavior is the migration baseline:

- IME composition does not submit early and Enter sends the visible composed draft.
- Draft, send, interruption, decision answer, Skill selection, and Session navigation use Native Chat Authority.
- Explicit references remain visible, removable, stable across Workspace switches, and clear only after successful submission.
- Hidden Professional Canvas selection never becomes an Agent Workspace reference.
- A stable Artifact can be continued as a reference or modification request.
- Professional Workspace retains native Chat, Canvas, assets, persistence, recovery, structure, and styling.
- Disabling Product registration leaves native Jarvis operational.

## Required verification groups

- Upstream Compatibility Surface checker.
- Agent Workspace Runtime and Chat Integration contracts.
- Native Chat request, retry, Session, IME, reference, decision, Skill, and Artifact tests.
- Professional Workspace native build and Product Workspace production build.

## Contact-surface reduction result

The Product command switch, explicit reference mutation, Artifact continuation listener, and obsolete window-navigation listener now live behind the Product-owned Native Chat Workspace Adapter. Native Chat retains a generic headless controller lifecycle and one mounted-authority registration call. The remaining broad diff against the old upstream baseline is explicitly tracked as native capability evolution and the three independently named Upstream Patch groups above; it is still reported as a size warning and remains future upstream-submission work rather than being disguised as Product implementation.
