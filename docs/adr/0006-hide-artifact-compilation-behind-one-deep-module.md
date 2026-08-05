---
status: superseded
superseded-by: 0007-use-a-native-watch-skill-for-the-mvp
---

# Hide Artifact compilation behind one deep Module

The Vertical Design Extension presents one primary Contract Tool for Artifact generation. Its Interface accepts an immutable Watch Concept reference, an Artifact kind, and a small set of constrained presentation directives. A deep Watch Artifact Module hides knowledge resolution, BaseModel application, Generation Contract compilation and validation, persistence, deterministic projection, and delegation to the Core Media Execution Seam. Jarvis Agents must not orchestrate those internal steps individually. This reduces flexibility at individual compilation stages, but concentrates design invariants, upgrade work, and verification behind one testable Seam.
