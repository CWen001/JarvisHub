---
status: superseded by ADR-0014
---

# Use a compile-time Vertical Extension deep module

Each enterprise product fork installs exactly one compile-time Vertical Design Extension into the latest compatible JarvisHub. Jarvis consumes the Extension through a deliberately small Extension Descriptor containing only `id`, `brand`, and `skillRoot`; a category-neutral Vertical Product Host supplies the shared native Chat-first product experience and complete Canvas transition. The Extension hides its professional references, thin Skill entry, design-interaction content, generation constraints, and brand behind that Interface.

This accepts a small stable integration seam in exchange for high leverage across future design categories and locality of vertical changes. It rejects both a one-off Watch Product Shell, which would repeat integration work in every future category, and a broad plugin SDK with Agent, Tool, persistence, Canvas, workflow, or rendering callbacks, which would duplicate Jarvis responsibilities and make the Interface shallow. Each deployment still serves one enterprise and one category; this is a construction and upgrade mechanism, not a runtime plugin marketplace.
