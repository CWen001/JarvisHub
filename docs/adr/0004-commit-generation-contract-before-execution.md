---
status: superseded
superseded-by: 0007-use-a-native-watch-skill-for-the-mvp
---

# Commit a Generation Contract before media execution

The Watch Design Kernel must produce, validate, version, and persist a structured Generation Contract before image generation. A versioned deterministic Projector converts that committed contract into the final provider-ready Prompt and execution parameters. Jarvis Core then executes the result through its existing media lifecycle without allowing a model to rewrite the final Prompt. This adds an explicit commit boundary and contract management cost, but prevents required watch-design knowledge and variables from being silently omitted or reinterpreted while preserving Jarvis as the sole Execution Authority.
