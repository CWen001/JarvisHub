---
status: accepted
---

# Separate portable Design Authority from Harness execution

The Portable Design Kernel is the sole Design Authority: it owns Product Schemas, Knowledge Models and selection rules, Design Interaction Protocols, Artifact BaseModels, and quality evaluation rules independently of any Agent framework. Jarvis Core is the Execution Authority and current persistence carrier: it owns Agent orchestration, native interaction and media Tools, provider execution, recovery, Canvas, assets, sessions, persistence, and tracing. Thin Harness Adapters map Kernel-defined concepts to native Jarvis primitives without redefining them or introducing a second Harness. ADR 0007 remains a valid Native Skill MVP integration experiment, but a Skill package alone is not the long-term Kernel or the organization's competitive core.
