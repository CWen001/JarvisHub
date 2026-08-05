---
status: accepted
---

# Keep durable product state authoritative in Jarvis

Product-specific frontends are Product Views over Jarvis-owned conversations, tasks, Knowledge Evidence, Artifacts, assets, approvals, and execution state. They may own ephemeral presentation state, including active panels and whether Canvas is visible, but every durable professional design fact must be written through and read from Jarvis's native interfaces. This accepts tighter coupling to Jarvis's state model in exchange for avoiding a shadow backend, divergent asset ledger, or second workflow authority.
