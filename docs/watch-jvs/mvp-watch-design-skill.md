# Watch Design Skill MVP

## Scope

The MVP leaves the Jarvis Root/Media Agent Harness and image Tool unchanged. Professional watch capability enters as the bundled native Skill at:

`apps/agents-cli/skills/watch-design-kernel/`

The Skill contains:

- Concept Image BaseModel 1.0.0;
- six progressively loaded knowledge domains with 60 approved atoms;
- the 0.2.0 catalog and immutable approval digests;
- internal usage-status documentation;
- a deterministic asset validator.

## Runtime sequence

1. A user asks Jarvis for a smart-watch concept image.
2. The Media Agent matches and loads `watch-design-kernel` from the native Skill catalog.
3. It always loads `references/concept-image-base-model.md`.
4. It uses `references/catalog.json` to load only 1–3 relevant domains.
5. It selects 2–4 compatible approved atoms and resolves their exact digests from `references/approval-ledger.json`.
6. It writes one complete provider-ready Prompt and calls the existing `canvas_image_generate_to_canvas` Tool.
7. It records the BaseModel, catalog, and selected immutable atom revisions in the existing `sourceEvidence` field.
8. Jarvis performs its unchanged model resolution, provider dispatch, wait, persistence, Canvas, and trace lifecycle.

No Generation Contract, custom image Tool, Watch Concept state machine, knowledge-selection UI, or second Agent loop is part of this MVP.

## Validation

```bash
pnpm --filter agents validate:watch-skill
pnpm --filter agents validate:agent-defs
pnpm --filter agents build
```

The Skill validator checks domain/resource consistency, 60 approved unique atoms, complete approval-ledger coverage, digest format, version agreement, and required BaseModel sections.

## Internal test prompt

```text
设计一只面向城市通勤与轻运动的轻薄圆角矩形智能手表。整体安静、现代、易搭配，通过精确的壳体层次、近壳表带连接和一处低饱和蓝绿色交互重音形成原创身份。生成一张完整产品英雄概念图，作为后续场景图的产品参考。
```

Inspect the generated Canvas node's `sourceEvidence` and generation context to verify the exact knowledge revisions, requested Prompt, effective Prompt, provider, and model.

## Usage restriction

The copied knowledge approval ledger currently permits personal development, testing, and learning use. Complete a separate commercial-content rights review before an external enterprise demonstration.
