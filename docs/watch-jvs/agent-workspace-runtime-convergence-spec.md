# Agent Workspace Runtime Convergence Specification

## Outcome

Converge Agent Workspace on the accepted ADR-0013 architecture: one deep `AgentWorkspaceRuntime` Interface supplies the Product View while Jarvis Core remains the sole Execution Authority. Professional Workspace keeps the upstream-native Chat, Canvas, persistence, streaming, retry, recovery, and interruption implementation.

## Module and Seam

The external `AgentWorkspaceRuntime` Interface remains:

- `getSnapshot()` — return one immutable Product View snapshot;
- `subscribe(listener)` — publish authoritative snapshot revisions;
- `dispatch(intent)` — map Product intents to native Jarvis commands and return an explicit outcome.

Production and in-memory Adapters remain the two concrete Adapters at this Seam. Execution and Artifact projection are internal implementation concerns, not new public runtimes or ports. Product renderers consume projected views and intents; they never inspect Professional Workspace DOM, raw Tool payloads, Agent traces, or provider details.

## Authority

- Project, Flow, Session, Chat, approval, run, Tool, Canvas node, and asset facts remain Jarvis-owned.
- Agent Workspace may own only ephemeral presentation state.
- Existing Jarvis Chat sending, stream consumption, persistence, recovery, retry, and interruption are reused rather than rewritten.
- Live run events and persisted message Tool snapshots must project to the same product-language execution view.
- Unsent text, selected Skill identity, and stable pending attachment/reference identities follow the current Session across Workspace switches by reusing existing Chat Session state. Focus, menus, dimensions, and scroll remain local to each surface.

## Product Behaviour

### Artifact Preview

- Clicking the current Artifact thumbnail in the Project Context Rail opens the shared enlarged preview and does not change Workspace.
- Timeline, Rail, and Product Asset Panel use the same preview shell.
- A stable Artifact offers continuation, reference, exact Professional Workspace node navigation, and download.
- An Asset without a stable node offers add-to-Workspace, reference, and download. Preview never creates a Canvas node implicitly.

### Reciprocal Workspace Switch

- The Agent Workspace top-bar action switches globally to Professional Workspace without choosing the latest Artifact.
- Artifact preview navigation is a separate deep link that selects and focuses the exact native node.
- Professional Workspace exposes the reciprocal action in the same host action slot and returns to the preserved Project, Flow, and Session context.

### Compact Execution Row

- One collapsed line shows authoritative phase, current product-language activity, progress, and duration.
- Activity advances in place from live events; there is no timer-driven carousel or marquee.
- Completion condenses to a result summary. Failure remains visible.
- Expansion shows only curated product-language tasks, statuses, and failure reasons.
- The row contains no Professional Workspace shortcut.
- Raw Skill instructions, Tool input/output, Agent trace, provider information, and internal identifiers never appear.

### Timeline and Scrolling

- Product Timeline is the only vertical scroll owner in the main Agent Workspace surface.
- Conversation, Decision, Compact Execution Row, Artifact, and Notice entries—including long pending Decision content—live inside that scroll root.
- Only the Composer remains fixed at the bottom.
- New content follows automatically only while the viewport is near the bottom.
- Manual upward scrolling preserves the user's position and exposes one `回到最新` action. Sending, selecting another Session, or invoking that action resumes following.

### Project Context Rail Typography

- History section label: 12px/600.
- Project name: 14px/600 in a 44px row.
- Session name: 12px/400 in a 36px row.
- Selection uses surface, Primary edge, and weight rather than font-size changes.

## Replacement Rule

Replace the Agent Workspace Product Chat presentation path rather than layering a second state system or retaining a long-lived old/new feature flag. Professional Workspace continues to render the native `AiChatDialog`. Shared Jarvis Chat engine behaviour remains behind the production Adapter.

## Completion Gate

This convergence is not complete while Agent Workspace directly mounts `ProductChatTimeline` backed by native `ChatRuntimeController` store reads. Completion requires Timeline, Decision, Compact Execution Row, Artifact, and Composer projections plus their Product intents to cross the `AgentWorkspaceRuntime` Interface; re-exporting the native controller through a thin facade does not satisfy this gate.

## Verification Seams

### Agent Workspace Runtime Interface

Contract tests verify immutable snapshots, subscriptions, intent outcomes, global Workspace switching without an Artifact target, exact Artifact deep links, unified live/persisted execution projection, failure retention, and absence of raw professional details.

### Product View Behaviour

Focused UI tests verify Artifact preview actions, removal of execution-row Workspace shortcuts, one Timeline scroll root, pending Decision placement, auto-follow suspension/resumption, reciprocal navigation, and Rail typography contracts.

### Final Verification

- focused Vitest files during each red/green slice;
- web TypeScript typecheck regularly;
- full web test suite once after implementation;
- production web build;
- one reused browser session for desktop visual and wheel/scroll validation, closed after use.
