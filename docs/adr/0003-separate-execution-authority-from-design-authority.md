---
status: superseded
superseded-by: 0007-use-a-native-watch-skill-for-the-mvp
---

# Separate execution authority from design authority

Jarvis Core is the sole Execution Authority: it owns Agent and Sub-agent orchestration, Tool execution, provider dispatch, retry, persistence, Canvas integration, and tracing. The Watch Design Kernel is the sole Design Authority: it owns authoritative watch concepts, required design variables, knowledge selection, artifact-specific visual contracts, and deterministic prompt projection. The Kernel must integrate through versioned extension contracts and must not introduce a parallel hidden Harness or Agent loop. This separation preserves Jarvis behavior and upstream mergeability while preventing professional design quality from depending on optional free-form Skill guidance.
