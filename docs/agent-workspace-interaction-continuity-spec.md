# Agent Workspace Interaction Continuity

## Status

Accepted product specification. This document refines ADR-0013 without changing its architectural decision.

## Goal

Agent Workspace is the complete primary work surface for a professional design turn. It may simplify presentation, but it must preserve **Interaction Continuity**: immediate request acknowledgement, truthful visible execution, explicit reference media, professional decisions, and timely Artifact delivery without requiring a switch to Professional Workspace.

Agent Workspace and Professional Workspace share Jarvis-owned commands, facts, persistence, and execution. They do not share presentation DOM or visual systems.

## Fixed constraints

- Jarvis Core remains the sole Execution Authority.
- Agent Workspace owns its complete Product View behind one deep **Agent Workspace Runtime** Module.
- Professional Workspace remains upstream-native and visually isolated.
- Agent Workspace must not mount, wrap, hide, or restyle Professional Workspace's `AiChatDialog` presentation.
- The Product View owns no durable conversation, run, attachment, asset, Artifact, decision, or lifecycle fact.
- Stable same-turn identities—not latest-Canvas or URL inference—connect a result to its conversation turn.
- Agent Workspace uses `apps/web/src/product-host/DESIGN.md`; its tokens do not affect Professional Workspace.

## Deep-module design

### External seam

Keep the Agent Workspace Runtime Interface small:

```ts
type AgentWorkspaceRuntime = Readonly<{
  getSnapshot: () => AgentWorkspaceSnapshot
  subscribe: (listener: () => void) => () => void
  dispatch: (intent: AgentWorkspaceIntent) => Promise<AgentWorkspaceIntentOutcome>
}>
```

The Interface remains the only surface used by Agent Workspace Views and their tests. New behavior deepens the Runtime's immutable Snapshot and Intent union rather than adding presentation-specific methods.

### Snapshot

The Runtime projects one disposable `AgentWorkspaceSnapshot` containing:

- Current Project Context and Project/Flow/Session navigation;
- Product Timeline entries for Conversation, Decision, Execution, Artifact, and Notice;
- Product Chat Composer draft, selected Skill, pending references, upload state, send state, and interruption availability;
- Product Asset Panel state;
- temporary panel and preview inputs that are derived from authoritative identities;
- a monotonic revision used only to notify Views of a new projection.

The Snapshot contains Product View language and hierarchy, not native DTOs, Store shapes, raw Tool payloads, or presentation DOM state.

### Intents

The single `dispatch` entry point accepts Product intents for:

- Project, Flow, and Session navigation;
- draft editing and Skill selection;
- local file upload, paste, drag/drop, Asset reference, Artifact reference, and pending-reference removal;
- request submission and interruption;
- decision answering;
- Artifact continuation, preview, download, and exact Professional Workspace navigation;
- Product Asset Panel actions.

Views never call native Stores, browser events, upload endpoints, or Chat execution functions directly.

### Adapters

Two Adapters make the seam real:

- a production Adapter translates between Jarvis Project, Flow, Session, Chat, Tool, node, asset, approval, recovery, and execution mechanisms;
- an in-memory Adapter drives deterministic interface-level tests.

The production Adapter owns subscriptions to every authoritative source required by the Snapshot. React Views must not assemble facts with one-shot effects or compensate with page reloads. Remote asset reads and result reconciliation are hidden inside the Adapter and Runtime implementation.

### Portable Jarvis authority integration

Treat upstream JarvisHub as an updateable dependency. The Agent Workspace production Adapter consumes existing authoritative Chat services, commands, Stores, and events while Product-owned Views remain outside native presentation code. When a required command is not otherwise reachable, expose it through one minimal headless Integration Seam; do not broadly extract, reorganize, or add Product presentation branches to native Chat.

Streaming, persistence, recovery, interruption, approval, attachment submission, and result materialization remain Jarvis-owned. Professional Workspace continues to use native Chat presentation, while Agent Workspace receives only authority and command access through the Adapter seam.

### Internal Artifact delivery reconciliation

Artifact delivery is an internal Runtime concern, not another external Interface. It reconciles authoritative same-turn evidence from the Chat stream, Media result, Tool result, node, and asset persistence into Product View output:

- generation pending: execution remains active;
- provider result received but persistence incomplete: active with activity text `图片已生成，正在保存到项目`;
- stable persisted result: emit an Artifact entry;
- stable result plus a failed downstream step: emit the Artifact and mark the run partially completed;
- authoritative generation failure with no usable result: emit failure and no Artifact.

Elapsed time alone never produces a failure or abnormal status.

## Interaction behavior

### Immediate acknowledgement

After submission:

1. the user message appears immediately;
2. within one second, a Compact Execution Row appears with at least an accepted/preparing activity;
3. authoritative events advance the row through Actionable Execution Statuses;
4. elapsed duration and current truthful activity remain visible;
5. when no Semantic Todo facts exist, the Runtime shows one coarse activity rather than inventing work items;
6. the send action becomes an explicit interruption action while the run is active.

The execution row provides the immediate response. Agent Workspace does not manufacture assistant filler such as “好的，正在处理.” Model-authored content appears only when it actually exists.

### Reference media

Agent Workspace supports explicit references from:

- local file selection;
- image paste;
- drag and drop;
- Product Asset Panel `作为参考`;
- Artifact Card `作为参考`.

All sources become visible pending-reference items in the current Session composer. Each item can be previewed and removed. Upload and submission failures are explicit. Pending stable reference identities follow the current Session through the Reciprocal Workspace Switch and clear after successful submission.

A hidden or previously selected Professional Canvas node never becomes an implicit Agent Workspace attachment.

### Result timing

When an authoritative provider result arrives before stable project persistence, both Workspaces expose the saving phase from the same completion chain. The normal target from provider success receipt to visible stable Artifact is at most 20 seconds.

Exceeding 20 seconds triggers internal reconciliation, telemetry, and recovery. It does not by itself show an “异常” or failure message. Only an authoritative failure may produce a failed status. A delay of two to three minutes is an engineering defect, not intended product behavior.

### Partial completion

A usable persisted Artifact takes precedence over a later generic turn error:

- show the Artifact;
- mark the run `partially completed` when another step failed;
- state precisely what succeeded and what did not;
- never describe an already usable image as a generation failure.

### Markdown and long decisions

Model-, Tool-, Notice-, and Decision-authored Markdown uses one safe Product View renderer. It supports headings, paragraphs, lists, emphasis, block quotes, tables, links, and code. Raw HTML is disabled and links are sanitized. User messages remain plain text.

For long Product Decision Cards:

- the recommendation and required question remain immediately visible;
- each strategy shows its title, rationale, and key visible consequence;
- supporting trade-offs and validation detail may be expanded per strategy;
- `展开全部` reveals the complete source without truncation;
- actions remain easy to reach at the bottom of the card;
- disclosure is generic presentation behavior and must not create or persist professional strategy state.

## Brand header

The Agent Workspace top bar uses the Design School / d.school HUST lockup without the separate circular university crest, which is illegible at product-header size. Narrow layouts use a compact version of the same crest-free lockup. `Watch Design Studio` remains a subordinate product subtitle.

## Delivery slice

Implement one end-to-end vertical slice rather than unrelated UI patches:

1. text and explicit reference input;
2. immediate acknowledgement;
3. truthful live execution;
4. professional decision and answer;
5. resumed execution;
6. provider result and saving phase;
7. stable Artifact delivery in both Workspaces;
8. partial completion where applicable;
9. refresh and Reciprocal Workspace recovery.

Unrelated visual redesign is outside this slice.

## Migration

1. Expand the Agent Workspace Runtime Snapshot and Intent Interface while retaining its three external entry points.
2. Implement production and in-memory Runtime Adapters over existing Jarvis authority; add only a minimal headless command Integration Seam where authority is not already reachable.
3. Build Product-owned Timeline, Composer, Decision, Execution, Artifact, Markdown, and reference Views against the Runtime Interface.
4. Switch the Agent product surface to those Views while preserving the native execution implementation behind the headless seam.
5. Delete Agent-specific native presentation branches and Product CSS coupling; retain native Chat presentation only for Professional Workspace.
6. Replace shallow implementation-detail tests with behavior tests at the Runtime Interface and Product View seams.

Do not layer the new Product View over the old wrapped Chat indefinitely.

## Acceptance

Automated, provider-free acceptance covers:

- user message plus truthful execution feedback within one second of submission;
- local upload, paste/drag-drop, Asset reference, and Artifact reference submission;
- no implicit attachment from hidden Professional Canvas selection;
- provider success followed by delayed persistence and normal Artifact delivery within the 20-second target;
- internal recovery after the target without a false user-facing failure;
- usable Artifact plus downstream failure rendered as partial completion;
- authoritative generation failure rendered without a false Artifact;
- safe Markdown rendering and long Decision disclosure;
- refresh reconstruction of messages, decisions, execution, and Artifacts;
- Agent ↔ Professional round-trip preserving Project, Flow, Session, run, draft, Skill, and pending stable references;
- proof that the Agent surface does not render or depend on `AiChatDialog` presentation DOM;
- proof that Professional Workspace structure, style, behavior, and native Chat remain unchanged.

After automated acceptance passes, run one real-provider smoke test to confirm that a completed image no longer takes two to three minutes to appear.
