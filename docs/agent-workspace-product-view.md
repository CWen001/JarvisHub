# Agent Workspace Product View

> Superseded by ADR-0013 and GitHub issue #16 where this document retains a wrapped native Chat presentation or the former warm academy visual system. The authority, identity, and Professional Workspace preservation rules remain applicable.

## Goal

Reproduce the interaction quality and academy visual language of the local Watch OpenAI frontend while keeping JarvisHub as the only authority for execution, persistence, Projects, Flows, Sessions, Chat, Tools, nodes, assets, approvals, and runs. Professional Workspace remains the complete native JarvisHub workspace.

Visual reference: `/Users/cwen/Projects/watch-openai/frontend/`. Academy logo source: `/Users/cwen/Projects/chairs-dspy/public/chair-studio-assets/hust-design-logo.png` with its white variant for dark image surfaces. The user-facing product name is **Watch Design Studio** with the Chinese subtitle **专业智能手表设计工作台**. User copy never exposes the underlying Harness brand.

## Page structure

### Permanent top bar

- academy logo and product name;
- current Project name from the authoritative Project context;
- Project Context Rail toggle;
- Assets entry;
- icon action for the complete Professional Workspace.

### Project Context Rail

The desktop Rail is collapsible; on narrow screens the permanent top bar opens it as a left drawer. Project is the primary object, Flow is labelled as a design direction, and Session is labelled as a conversation.

The expanded Rail may show:

- current Project, Flow, and Session;
- native new-conversation action;
- separate native actions for a new design direction and a new Project;
- stable current Artifact reference and timeline anchors;
- subordinate conversation and Project history;
- asset count/latest stable thumbnail plus an entry to the full temporary Asset panel;
- current authoritative run status.

The Rail never stores a Project/Flow/Session index or embeds a second asset gallery.

### Product Timeline

The timeline uses the Watch OpenAI visual grammar—Conversation, Decision, Execution, Artifact, and concise Notice cards—but every card is recomputed from authoritative facts. The Projection may combine multiple related Chat, Tool, media, node, asset, and run facts into one Product Timeline Card when stable source identities establish the relationship. Complete native execution detail remains available through progressive disclosure.

Native `ask_user` decisions render as academy-styled design decision cards. Their text, options, pause state, answer, persistence, and recovery remain backend-owned. The Product View does not maintain strategy checkbox state or convert frontend selections into Design State.

Artifact cards lead with a large inspectable preview and universal native actions: continue modification, use as reference, download, and open Professional Workspace. Additional continuations appear only when authoritative backend facts or metadata provide them. Failed or pending generation never produces a successful Artifact card.

### Composer and temporary panels

The compact, auto-growing composer remains attached to the timeline and sends through the native Chat path. Attachments, references, Skills, pending decisions, retry, and interruption retain their native command behavior. Full Assets, Memory, and execution details open as temporary panels rather than permanent columns.

## Projection contract

One deep Agent Workspace Projection owns translation between heterogeneous Jarvis facts and the Product View. Its external Interface consists conceptually of:

```ts
projectAgentWorkspace(authoritativeFacts): AgentWorkspaceViewModel
resolveAgentWorkspaceIntent(intent, authoritativeContext): NativeCommand
```

The View Model is immutable and disposable. It may reorganize, merge, label, localize, and progressively disclose facts, but it must not:

- persist Design State, lifecycle state, history, or asset records;
- infer completion independently of native run/tool/node facts;
- parse Prompt prose to invent concept name, thesis, signature, or Product Family;
- scan the latest Canvas result or match assets by URL when stable same-turn identity is absent;
- synthesize backend options, Artifact workflows, or professional facts;
- bypass native commands for Project, Flow, Session, Chat, assets, approval, retry, or workspace navigation.

When an old Watch OpenAI field has no authoritative Jarvis equivalent, omit or relabel that slot instead of fabricating it.

## Visual system

Agent Workspace uses the Watch OpenAI light academy system: warm drafting paper, porcelain cards, dark ink, quiet sage, deep green, restrained terracotta, and brass accents; fine rules and tonal separation carry hierarchy. The product fork is fixed to light appearance. Professional Workspace keeps its native JarvisHub structure and behavior while using the native light theme rather than automatic dark-mode switching.

## Acceptance

Visual and authority acceptance covers:

- desktop expanded and collapsed Rail;
- narrow-screen top bar and Rail drawer;
- empty Project and empty conversation;
- running execution with compact product-language status;
- native `ask_user` decision and resumed answer;
- successful Artifact with stable node/asset identity;
- failed and partial completion without false Artifact success;
- switching Sessions, Flows, and Projects through native commands;
- temporary authoritative Asset panel;
- Agent Workspace ↔ Professional Workspace round trip with context preserved;
- page refresh reconstructing the same Product View solely from backend facts;
- deletion/replacement tests proving Product View modules do not modify Professional Workspace.

Reference screenshots should be captured from the Watch OpenAI frontend for desktop and narrow layouts, then compared against deterministic Jarvis-backed fixtures. Automated tests must remain provider-free.
