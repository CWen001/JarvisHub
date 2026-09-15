# Domain documentation

## Layout

This repository uses a single-context domain-documentation layout:

- Ubiquitous language and current domain context: `/CONTEXT.md`
- Architecture decision records: `/docs/adr/`
- Context map: not used

## Consumer rules

Before performing domain modeling or architecture work:

1. Read `/CONTEXT.md`.
2. Read the ADRs relevant to the area being changed.
3. Use the terminology defined in `CONTEXT.md` consistently.
4. Respect accepted architectural decisions unless the task explicitly changes them.

When domain language changes, update `/CONTEXT.md`.

When making a durable architectural decision, add an ADR under `/docs/adr/` using the repository's existing numbering and style. Do not silently rewrite an accepted ADR; add a superseding ADR when the decision changes.

Do not introduce per-package `CONTEXT.md` files or a root `CONTEXT-MAP.md` unless the repository intentionally migrates to a multi-context layout.
