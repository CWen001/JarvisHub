---
status: accepted
supersedes:
  - 0018-require-one-native-design-direction-turn
---

# Use Skill-owned design with minimal host instructions

Jarvis is a category-neutral Professional Design Workbench for mature Skills developed and validated in Pi or other supported hosts: professional dialogue, design reasoning, prompt preparation, generation checks, and review requirements remain in the portable Skill, while Jarvis supplies execution and native asset/Canvas capabilities. ADR-0018's host-wide direction-turn prescription is replaced by following the active Skill's dialogue rules; this does not remove dialogue or actual-image review required by a Skill, authorize generation without user consent, or weaken generation/persistence failure checks.

The first change is instruction-only: narrow mandatory text artifacts to requested or explicitly required deliverables, avoid separately delegating design work already covered by the executing Skill, and batch independent bookkeeping rather than creating extra model turns. Retain existing Agent roles, tool permissions, task contracts, persistence, and upstream integration tracking; do not add category-specific execution paths or a second runtime. Package validation and batch experiments belong to Skill development, not ordinary design requests, and differences in host tools must not create a second professional methodology.

Upstream compatibility remains a maintenance constraint, not a reason to prevent portable Skill execution; broader runtime changes require demonstrated need and separate agreement. The existing category-keyed required-Critic gate in `agent-loop.ts` is a known mismatch with Skill-owned review policy and remains unchanged in this instruction-only stage. Prompt contract tests and dispatch probes do not prove end-to-end image latency; full-chain verification is required before declaring the latency problem fixed.
