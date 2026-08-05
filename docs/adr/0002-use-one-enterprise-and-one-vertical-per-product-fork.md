---
status: superseded by ADR-0014
---

# Use one enterprise and one design vertical per product fork

Each commercial product fork will serve one enterprise in one professional design category, with its own branded Product Chat Shell, private Design Kernel, deployment, and release line. Other enterprises or categories will receive separate forks rather than runtime-selectable vertical slices inside one platform. Vertical extensions remain pluggable at the Jarvis Core seam to preserve upstream upgradeability, but this is a construction and maintenance pattern—not a multi-vertical plugin marketplace or category switch exposed to users.
