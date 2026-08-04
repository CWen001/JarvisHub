---
status: superseded by ADR-0013
---

# Project Agent Workspace through one read-only Projection

Agent Workspace will replace the embedded native Chat shell with a Watch OpenAI–inspired Product View: a permanent academy-branded top bar, collapsible Project Context Rail, continuous product timeline, large Artifact cards, and compact composer. One deep Agent Workspace Projection transforms authoritative Jarvis Project, Flow, Session, Chat, Tool, node, asset, approval, and run facts into an immutable View Model and maps user intents back to native Jarvis commands; it may combine many backend facts into one Product Timeline Card but owns no durable professional state, lifecycle, history registry, inferred completion, or missing design fact.

This accepts a dedicated Product View shell and a small Product Timeline Interface over the retained native Chat controller, rather than rendering native workspace chrome or DTOs directly in Agent Workspace. The controller continues to own native command, streaming, persistence, approval, retry, and recovery behavior; Product View presentation remains isolated behind its Interface. Project is the primary navigation object, Flow is presented as design direction, and Session as conversation. Full assets and execution detail remain temporary panels; Artifact continuations appear only when supplied by authoritative metadata or as universal native actions. The complete Professional Workspace remains native and visually isolated. The product fork uses its existing light appearance permanently: Agent Workspace adopts the warm academy design system, while Professional Workspace uses JarvisHub's native light theme rather than automatic dark-mode switching.
