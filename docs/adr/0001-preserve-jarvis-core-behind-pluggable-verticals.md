---
status: accepted
---

# Preserve Jarvis Core behind pluggable design verticals

The current JarvisHub fork will serve as the product monorepo because it gives the fastest and deepest reuse of the proven Harness, but Jarvis Core will remain as close to upstream as practical so later upstream improvements can be absorbed. Organization-owned frontends and Design Kernels will enter through category-neutral extension seams as pluggable Vertical Design Extensions; watch-specific contracts, knowledge, projections, and UI behavior must not be embedded in the Agent loop or other Core implementation. This accepts the cost of designing and testing stable extension seams in exchange for upstream mergeability, multi-category reuse, and independent ownership of proprietary design assets.
