---
status: superseded
superseded-by: 0007-use-a-native-watch-skill-for-the-mvp
---

# Keep vertical contracts out of Core media schemas

Each Vertical Design Extension exposes its own domain-specific Contract Tools. Those tools validate and commit Generation Contracts and deterministically project provider-ready generation artifacts. They then hand those artifacts to a thin, category-neutral Core Media Execution Seam that reuses Jarvis provider dispatch, retry, persistence, Canvas integration, and tracing. Watch-specific fields must not be added to Jarvis Core's generic image-generation schema. This introduces a maintained adapter boundary, but confines upstream upgrade work to a small seam and prevents vertical design logic from contaminating the Harness.
