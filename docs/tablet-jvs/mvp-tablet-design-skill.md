# Tablet Design Skill MVP

## Source and package

`apps/agents-cli/skills/tablet-design-kernel/` is a source-faithful, vendored professional package adapted from `tablet_pi` revision `6b597de27ad8718bce6176eba7048730f416a279`. It has no build-time or runtime dependency on that repository.

Imported professional sources:

- `pure-pi/contracts.ts` — `TabletConceptSchema` / four-authority model;
- `pure-pi/knowledge-corpus.ts` — 12 approved atoms across eight design areas;
- `docs/specs/tablet-design-quality-v2.md` — whole-product quality benchmark;
- `pure-pi/visual-artifact-recipes.ts` — nine registered Artifact targets;
- `CONTEXT.md` — bounded professional process and terminology.

Excluded implementation concerns:

- Pure Pi runtime and clean-session orchestration;
- Tablet frontend, Archive, Gallery, Provider, and Session state;
- retired Python Tablet Studio;
- custom Tablet Tool, database, Canvas type, or workflow engine.

## Native execution path

```text
Tablet request
→ Jarvis loads tablet-design-kernel
→ registered native Skill load selects the existing Composer Skill
→ Tablet Directional Design Dialogue through ask_user
→ accepted visible strategy becomes task_contract.userConstraints
→ Media loads Tablet references and writes the provider-ready Prompt
→ canvas_image_generate_to_canvas
→ native wait, persistence, Canvas, assets, and Trace
→ Agent Workspace projects the native Artifact
```

The first acceptance-backed executable target is `concept_sketch`. The package preserves professional guidance for the other eight targets without creating target-specific Runtime state.

## Mandatory generation evidence

Each Tablet generation records exactly one BaseModel revision, one Quality Benchmark revision, one Knowledge Catalog revision, and one immutable digest for every selected atom through native `sourceEvidence`:

```text
tablet-base-model:concept-sketch@2.0.0
tablet-quality-benchmark@2.0.0
tablet-knowledge-catalog@tablet-knowledge-2026-07
tablet-atom:<atom_id>@sha256:<review_digest>
```

Provider success does not imply professional approval and does not automatically invoke Critic.

## Verification

```bash
pnpm --filter agents validate:tablet-skill
pnpm --filter agents validate:agent-defs
pnpm --filter agents build
pnpm --filter @jarvishub/web test
pnpm --filter @jarvishub/web build
```

Live native Skill discovery must list both `watch-design-kernel` and `tablet-design-kernel` with no load errors.
