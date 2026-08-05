---
status: accepted
---

# Maintain upstream compatibility through registered seams

The Shared Product Trunk will treat rapid adoption of future JarvisHub upstream releases as a primary architectural constraint. Product-owned code lives only in explicitly registered Product-owned roots; every other path is upstream-derived by default and may be changed only through a small, contiguous, removable Integration Seam or an independently tested temporary Upstream Patch. A machine-checkable Upstream Compatibility Surface records each touched native file, its purpose, owning Product Adapter, required contract tests, and upstream disposition; changed-line count is a risk warning rather than the definition of compliance.

Public Chat Delivery Reconciliation belongs in a category-neutral Product-owned backend Adapter, with the upstream-derived bridge retaining only one call Seam. Agent Workspace integration will not extract, copy, or replace Native Chat Authority: Product behavior is removed from `AiChatDialog`, while one narrow registration Seam may expose the mounted Native Chat Controller to the Product-owned Adapter. All existing `AiChatDialog` differences are audited as Product behavior, Integration Seam, Upstream Patch, or obsolete; general Jarvis corrections follow an upstream-first workflow and are removed locally when equivalent upstream behavior is adopted.

Implementation proceeds as one architecture initiative in verifiable stages: establish and test the compatibility baseline, deepen the Public Chat Delivery Adapter, shrink the Native Chat contact surface, then replay Product-owned roots, registered seams, and Upstream Patches from `upstream/main` in a temporary worktree. Because upstream currently has no new changes, replayability—not an artificial conflict simulation—is the immediate upgrade acceptance; a real merge rehearsal is required when upstream changes.
