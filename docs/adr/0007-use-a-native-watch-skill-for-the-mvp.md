---
status: accepted
supersedes:
  - 0003-separate-execution-authority-from-design-authority
  - 0004-commit-generation-contract-before-execution
  - 0005-keep-vertical-contracts-out-of-core-media-schemas
  - 0006-hide-artifact-compilation-behind-one-deep-module
---

# Use a native Watch Design Skill for the MVP

The MVP integrates the Watch Design Kernel as one progressively disclosed native Jarvis Skill containing the Concept Image BaseModel and Curated Knowledge. Jarvis's existing Root and Media Agents select and load the Skill, select a small relevant set of approved Knowledge Atoms, author the final Prompt, and call the unchanged `canvas_image_generate_to_canvas` Tool. Every generation records the BaseModel version and selected immutable Atom revisions through the Tool's existing `sourceEvidence` field, so automatic knowledge selection is inspectable without a new schema or user-confirmation workflow. The existing Hono provider, persistence, Canvas, and trace lifecycle remains untouched. The MVP adds no Generation Contract, Watch Concept state machine, custom Contract Tool, knowledge-selection UI, or parallel Agent loop. Only output tests demonstrating recurring omission of non-negotiable BaseModel requirements may justify a later versioned Prompt Profile Adapter at Jarvis's existing Prompt-transform Seam.
