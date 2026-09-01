---
status: accepted
supersedes:
  - 0017-keep-vertical-design-dialogue-inside-native-skills
---

# Require one native design direction turn before vertical image generation

Every Watch or Tablet image-generation request will enter one lightweight Design Direction Turn before Provider execution unless the user explicitly asks to use the recommendation or proceed without discussion. The active Vertical Skill uses Jarvis's unchanged `ask_user` interaction to offer three concise, coherent, task-appropriate directions by default, mark one recommendation, and accept either a clicked option or free-text revision; one turn covers the user's whole generation request rather than each Provider call, and only a real conflict permits a second question.

New concepts receive whole-product strategy and aesthetic alternatives, while local edits, derivative views, and retries receive a narrower implementation-strength or trade-off choice. Text options are the default; image-backed choices use only user-authorized existing references or an explicit request to compare images, never a mandatory search or generation step. The rule belongs only to the Watch and Tablet native Skills and reuses native Chat history, generation authorization, Media, Critic, Canvas, and Session behavior without adding a Tool, schema, state machine, Adapter, keyword list, frontend questionnaire, or vertical UI.
