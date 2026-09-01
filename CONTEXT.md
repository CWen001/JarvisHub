# Enterprise Vertical Design Product

A shared professional-design product mainline built on JarvisHub's upstream-derived Agent foundation. It preserves one category-neutral Product infrastructure while independently packaged design verticals supply their own professional authority; the current demo may expose several verticals, while customer activation, authorization, tenancy, and deployment isolation remain future delivery decisions.

## Language

**Jarvis Core**:
The upstream-derived Agent foundation and sole **Execution Authority**. It owns Harness execution, Agent and Sub-agent orchestration, Tool lifecycle, Canvas capabilities, context management, recovery, provider dispatch, persistence, and tracing. Product verticals consume it through stable extension seams and do not replace its behavior.
_Avoid_: Watch backend, product-specific Harness, code snapshot

**Execution Authority**:
The exclusive authority over how work is planned, delegated, executed, retried, persisted, and traced. In this product it belongs to Jarvis Core; a Design Kernel may constrain the work product but must not introduce a parallel hidden Harness or Agent loop.
_Avoid_: Design authority, second orchestration runtime, kernel-owned Agent loop

**Product Chat Shell**:
The primary enterprise- and category-specific Product View centered on one dominant Chat timeline. A permanent branded top bar and collapsible Project Context Rail provide orientation and entry points, while full assets, Memory, and execution detail open as temporary panels and the Canvas remains hidden until the user enters the Professional Workspace. The Shell projects Jarvis-owned professional facts and issues commands through Jarvis interfaces while owning only ephemeral presentation state.
_Avoid_: Multi-category launcher, fixed multi-column dashboard, embedded full asset gallery, Canvas-only UI, frontend workflow engine

**Agent Workspace (Product View)**:
The user-facing institutionally branded Product View over Jarvis-owned conversations, tasks, Knowledge Evidence, Artifacts, assets, approvals, and execution state. It has its own permanent top bar, collapsible Project Context Rail, Product Timeline, and compact composer, all supplied by the Agent Workspace Runtime; native capabilities retain their Jarvis data, behavior, command paths, and persistence. Agent Workspace and Professional Workspace are reciprocal, visually isolated surfaces, and the native Canvas and header are never rendered behind Agent Workspace.
_Avoid_: Native Chat skin, frontend backend, shadow task state, product-owned asset ledger, duplicate workflow, Canvas ghosting behind Agent Workspace

**Reciprocal Workspace Switch**:
The global top-bar navigation between Agent Workspace and Professional Workspace. It preserves the Current Project Context without choosing or focusing an Artifact; precise Artifact navigation belongs to an explicit Artifact Preview action.
_Avoid_: Latest-Artifact shortcut, object deep link, one-way Workspace entry, context-resetting navigation

**Agent Workspace Design System**:
The project-owned `DESIGN.md` visual authority for Agent Workspace, derived from Porsche Design System v4 light-theme principles without importing Porsche components, trademarks, or proprietary fonts. It governs Product View tokens, typography, spacing, shape, icon treatment, states, and responsive behavior, while Professional Workspace retains its native light presentation.
_Avoid_: Ad-hoc CSS theme, Porsche component dependency, marketing-site imitation, Professional Workspace reskin, logo-derived UI palette

**Agent Workspace Runtime**:
The single deep Module through which Agent Workspace receives immutable Product View snapshots, subscribes to authoritative changes, and dispatches Product intents to native commands. Production and in-memory Adapters hide Jarvis Project, Flow, Session, Chat, Tool, node, asset, approval, recovery, and execution differences behind the same Interface; the Runtime owns no durable professional fact or lifecycle state.
_Avoid_: Harness Adapter, frontend backend, public Chat Adapter, public Asset Adapter, copied Jarvis state, shadow Design State, synchronization ledger, direct Store or DTO access

**Interaction Continuity**:
The product promise that Agent Workspace remains a complete primary work surface while simplifying presentation: requests receive immediate acknowledgement, authoritative execution remains visibly alive, reference media can accompany the conversation, and completed results arrive without requiring a switch to Professional Workspace. Both Workspaces expose the same underlying professional capabilities and facts while retaining distinct presentation systems.
_Avoid_: Visual parity, duplicated execution, Agent preview mode, switch-to-Professional workaround, silent background work

**Product Timeline View**:
The Agent Workspace-owned Chat-first rendering of projected Conversation, Decision, Execution, Artifact, and Notice entries. It controls Product View hierarchy and density without embedding native Chat presentation, while Professional Workspace retains the complete native Chat and execution UI.
_Avoid_: Native Chat skin, raw Tool stream, full Skill payload, duplicated message state, Professional Workspace customization

**Project Context Rail**:
The collapsible navigation and orientation surface beside the Product Chat Shell. Project is its primary authoritative object; the current Flow appears as the design direction and native Chat Sessions appear as subordinate conversations. It may show stable current Artifact references, timeline anchors, asset entry/count, history, and run status through the Agent Workspace Runtime, but full asset browsing opens in a temporary panel. Its user-facing labels are Chinese and never expose the underlying Harness brand; on narrow screens it collapses into the permanent branded top bar.
_Avoid_: Studio-owned project registry, Design State sidebar, embedded asset gallery, latest-Canvas inference, backend product name in user copy

**Compact Execution Row**:
The Product Timeline projection of one authoritative Jarvis run, whose primary promise is **predictable, truthful progress** rather than complete process exposure. While active, it opens by default to show the main Semantic Work Item, its subordinate items, Actionable Execution Statuses, stable progress when a trustworthy total exists, and elapsed duration. Completion condenses it to a one-line result summary that remains manually expandable; failure and states requiring user action remain visible. Raw Skill text, Tool input/output, payloads, Agent traces, complete native execution detail, and Workspace navigation remain outside the row.
_Avoid_: Timed carousel, marquee, reassuring fiction, raw Skill dump, native Trace clone, always-expanded history, permanently pinned completed run, hidden failure, replacement execution state, Professional Workspace shortcut

**Semantic Work Item**:
A user-goal-oriented projection of authoritative execution facts within a Compact Execution Row. Each user request produces one stable main Semantic Work Item. Jarvis-native Todo content and status are the primary source of subordinate items; authoritative run, Media, error, and timing facts supplement their presentation. Their identity and labels describe meaningful work toward the requested outcome rather than the Agent, Sub-agent, Skill, Tool, or orchestration structure that performed it. When no semantic Todo facts exist, the Runtime exposes only a truthful coarse current activity and never reconstructs a task tree from Tool calls.
_Avoid_: Changing main-task identity, Agent role as task name, Skill row, Tool call row, one-to-one Trace projection, model-generated progress, invented task, implementation-shaped hierarchy

**Actionable Execution Status**:
The user-facing state of a Jarvis run or Semantic Work Item, expressed as one of: queued, active, awaiting user input, recovering, partially completed, completed, failed, or cancelled. Each status communicates whether work is advancing, whether the user must act, and whether a usable result exists; status is never inferred from elapsed time or color alone.
_Avoid_: Generic loading state, success-or-failure-only model, silent retry, ambiguous pause, color-only status

**Ask User Input**:
The category-neutral, turn-stopping Chat interaction projected from Jarvis's native `ask_user` capability for a needed human decision or an active vertical's Design Direction Turn. The question remains an ordinary Markdown conversation turn; native text options appear as clickable suggested replies, while the user may instead answer freely through the Product Chat Composer, and the Product View never interprets their professional meaning.
_Avoid_: Vertical-specific decision card, frontend questionnaire, hidden waiting state, question inside task tree, raw Tool trace, frontend-owned professional decision

**Product Chat Composer**:
The compact, auto-growing request input in Agent Workspace, with bounded height and one consolidated action row for attachments, Skills, and sending. Its unsent text, selected Skill, and stable pending reference attachments follow the current Chat Session across the Reciprocal Workspace Switch, while focus, menus, sizing, scroll, and other presentation state remain local to each Workspace. It is a Product Chat Shell presentation and does not replace or restyle the native Chat retained in Professional Workspace.
_Avoid_: Fixed tall input region, unbounded composer, second Chat runtime, duplicated draft store, shared presentation DOM, Professional Workspace composer customization

**Artifact Card**:
The lightweight inline rendering of a successfully persisted, usable Artifact produced by a Native Artifact Projection inside the Agent Workspace Chat timeline. It appears only after generation succeeds and only from stable same-turn Jarvis message, Tool, node, and asset references, with a larger preview, asset title, and direct continuation, reference, Professional Workspace, and download actions; pending or failed generation never creates a placeholder card, and Professional Workspace retains native rendering.
_Avoid_: New Chat message type, pending placeholder, failed result card, latest-Canvas-result inference, duplicated design summary, embedded review dashboard, frontend-owned result, Mini Canvas, Professional Workspace customization

**Artifact Preview**:
The shared Agent Workspace inspection surface opened by an Artifact thumbnail in the Product Timeline, Project Context Rail, or Product Asset Panel. The thumbnail opens the enlarged Artifact rather than changing Workspace; continuation, reference, Professional Workspace node navigation, and download remain explicit adjacent actions.
_Avoid_: Thumbnail-as-navigation, automatic Workspace switch, separate preview behavior per Product surface, Mini Canvas

**Native Artifact Projection**:
A Product View projection derived from an existing Jarvis Chat message, Tool snapshot, and stable Flow, node, and asset references. It may present preview, native execution status, Kernel-owned Design State facts when available, and navigation to the native Canvas; it creates no Artifact record, lifecycle state, or duplicate persistence. When reliable native references are unavailable, it falls back to Jarvis's original asset rendering.
_Avoid_: Artifact backend, shadow message protocol, frontend inference of professional facts, copied asset state

**Product Asset Panel**:
The Agent Workspace-owned asset View projected from authoritative Jarvis asset facts. It may reorganize filtering, preview, download, Canvas insertion, and Chat reference actions through native commands, but owns no asset catalog, record, upload pipeline, identity, or lifecycle.
_Avoid_: Styled native Asset Center DOM, copied gallery state, Product-owned asset database, separate upload pipeline, frontend reference ledger

**Native Asset Center**:
Jarvis's upstream-native asset-library presentation retained unchanged inside Professional Workspace. Agent Workspace consumes the same authoritative asset capability through the Product Asset Panel rather than embedding or restyling this native View.
_Avoid_: Product View reskin, shared presentation DOM, second asset authority

**Current Project Context**:
The Jarvis-owned Project and current Flow context shared by the Product Chat Shell, Product Asset Panel, history, and Professional Workspace. Product launch resumes the most recent Jarvis Project; when none exists, the Product View guides creation through Jarvis's native project path. The collapsible Project Context Rail treats Projects as the primary history unit, with Flows as design directions and multiple Jarvis-native Chat Sessions subordinate to their owning Project; selecting a Project resumes its most recent Session, and native new-conversation behavior preserves the current Flow. Project identity, membership, lifecycle, conversation identity, and persistence never belong to the Product View.
_Avoid_: Global unscoped Chat, one forced lifetime conversation, conversation-first cross-project history, frontend project or session registry, copied metadata

**Shared Product Trunk**:
The common foundation from which every professional design capability grows: upstream-compatible Jarvis Core and Professional Workspace form the execution layer, while the category-neutral Agent Workspace and Product View infrastructure form the shared product layer. A vertical may consume this trunk but never copy, specialize, or bypass it.
_Avoid_: Watch infrastructure, Tablet Workspace fork, vertical-specific Runtime, copied Product View, modified Professional Workspace

**Shared Vertical Product Mainline**:
The single maintained product codebase containing the Shared Product Trunk and independently packaged design verticals that may coexist for development and demo use. Customer-specific activation, authorization, tenancy, and deployment isolation are deliberately deferred until a delivery agreement requires them.
_Avoid_: Long-lived product fork, copied Agent Workspace, frontend-only security claim, premature multi-tenant platform

**Vertical Design Extension**:
A deep, self-contained native Skill Package that supplies one professional design capability to the shared Product Host. Its Skill entry and progressively loaded references package portable BaseModels, professional knowledge, quality standards, process guidance, provenance, and validation without owning a brand shell, Runtime callback, or Jarvis execution concern.
_Avoid_: Separate product runtime, Web descriptor object, callback registry, Jarvis Core patch, parallel Harness, copied Product View, prompt pack

**Exclusive Composer Vertical Activation**:
The Session-visible rule that a completed native load of a registered supported-category Skill selects exactly one matching vertical in the existing Composer Skill slot, replacing any previously selected vertical. Selection persists in the existing Chat Session scope until the user closes or switches it or Jarvis visibly loads another vertical for clearly changed intent; ordinary native Skills remain available independently, and with no selected vertical Jarvis retains unrestricted general capability.
_Avoid_: New activation Runtime, optional quality hint, hidden one-turn loading, simultaneous verticals, Project vertical binding, permanently locked Session, frontend keyword classifier

**Vertical Skill Registry**:
The ordered compile-time list of native Skill keys that identify mutually exclusive professional verticals. Startup validates every key through native Skill discovery; the registry contains no brand, path, Prompt, recognition keywords, callbacks, workflow configuration, or persistence hooks.
_Avoid_: Extension Descriptor, plugin SDK, lifecycle hooks, per-vertical callback, duplicate Skill identity

**Vertical Product Host**:
The category-neutral Product View host that supplies one shared brand and product experience while validating the Vertical Skill Registry. It owns no professional Design Authority, intent classifier, Jarvis execution, or durable product fact, and it reuses the existing Agent Workspace Runtime and Composer Skill Interface unchanged.
_Avoid_: Watch-only workflow, per-vertical shell, copied Jarvis state, extension-owned orchestration, deployment authorization policy

**Harness Adapter**:
The thin translation between framework-independent Kernel concepts and one Harness's native primitives. It maps rather than redefines Design State, Design Dialogue, Artifact requirements, Knowledge Evidence, and evaluation rules.
_Avoid_: Second backend, workflow engine, domain authority, Jarvis fork logic

**Watch Design Skill**:
The single native Jarvis package for the Watch Design Kernel. Its `references/` directory is the sole professional knowledge source and remains free of Jarvis Agent, Tool, Canvas, and task-contract concepts; its thin `SKILL.md` is the Jarvis-specific loading and usage entry. No duplicate Kernel package or generated Skill copy exists.
_Avoid_: Duplicated knowledge source, generated mirror package, second Agent, custom Harness, Jarvis concepts inside professional references

**Tablet Design Skill**:
The self-contained native Jarvis package adapted from the `tablet_pi` TypeScript mainline. It owns the Tablet Concept Sketch BaseModel, Tablet Quality Benchmark, versioned professional Knowledge Corpus, lightweight Design Dialogue, actual-image review rules, and downstream Artifact guidance while relying exclusively on Jarvis-native Skill, Media, Critic, Canvas, assets, Session, persistence, and Trace execution. Concept Sketch is its first acceptance-backed executable target.
_Avoid_: Runtime dependency on `tablet_pi`, copied Pure Pi frontend, Tablet Session state machine, custom image Tool, custom Critic runtime

**Knowledge Evidence**:
The internal, persisted list of the BaseModel version and approved Knowledge Atom revision IDs actually used for one generation. The MVP records it through the native image Tool's existing `sourceEvidence` field, making automatic Agent selection inspectable without adding a user-confirmation workflow or new schema.
_Avoid_: User-facing atom IDs, hidden knowledge selection, new provenance database

**Prompt Profile Adapter**:
An optional future Adapter at Jarvis's existing requested-Prompt to effective-Prompt transform Seam. It may deterministically add only repeatedly omitted non-negotiable BaseModel constraints and record its version in `promptTransforms`; it is not part of the MVP until output tests justify it.
_Avoid_: Prompt-refinement Agent, vertical state machine, speculative abstraction

**Portable Design Kernel**:
The private, versioned, Harness-independent body of Product Schemas, Knowledge Models and selection rules, Design Interaction Protocols, Artifact BaseModels, and quality evaluation rules for one professional domain. It contains the organization's durable design research and remains portable across Agent frameworks.
_Avoid_: Skill package, Agent Harness, frontend theme, prompt collection, provider integration

**Watch Design Kernel**:
The Portable Design Kernel for professional smart-watch concept development and sole Design Authority in this product fork. Its Product Schemas, knowledge semantics, interaction content, Artifact requirements, and quality rules remain authoritative regardless of the Harness used to execute them.
_Avoid_: Watch Agent Harness, one image BaseModel alone, Watch Design Skill

**Design Authority**:
The exclusive authority over what constitutes a valid design state, relevant knowledge, meaningful human design decisions, required Artifact evidence, and professional quality. It belongs to the Portable Design Kernel; a Harness may reason over and persist Kernel-defined facts but cannot redefine their semantics.
_Avoid_: Execution authority, provider orchestration, Harness prompt behavior

**Design State**:
The Kernel's semantic interpretation of accepted product decisions and unresolved tensions for the current design turn. The Jarvis Adapter does not force it into a standalone persistent object: accepted choices remain in native Chat, while the executed Prompt, `generationContext`, Knowledge Evidence, Artifact node, Trace, and Flow versions preserve the observable result. The Kernel owns the meaning and transformation rules; Jarvis owns every persisted fact.
_Avoid_: Dedicated Design State node, frontend state, separate design-direction entity, custom Watch database, custom Canvas node type, parallel version system

**Jarvis Flow**:
The native Jarvis work scope used directly as one coherent design direction inside a Project. It owns the Canvas graph, nodes, Agent checkpoints and versions, and participates in Chat Session scope. A materially different direction uses another native Flow rather than a Kernel-specific branch entity.
_Avoid_: Design Direction entity, Kernel branch, frontend workspace record, cross-Flow Design State

**Design Dialogue**:
A lightweight professional conversation owned by the active Vertical Design Extension. It applies the Skill's professional knowledge through concise proposals, native Ask User Input, and ordinary follow-up rather than exposing a questionnaire, knowledge dump, or separate interaction engine; detailed rationale appears only on request or when needed to expose a real conflict, risk, or unverifiable claim.
_Avoid_: Separate interview engine, persisted decision tree, mandatory category question, strategy-card workflow, fixed confirmation ceremony, proactive knowledge dump, frontend wizard, custom Tool schema

**Design Direction Turn**:
The default-required, user-waivable professional turn before each Watch or Tablet image-generation request reaches a Provider. The Agent asks one task-appropriate question with three concise clickable directions by default, marks its recommendation, and continues after one clicked or free-text reply; a second question is permitted only for a real conflict, while an explicit request to use the recommendation or generate without discussion waives the turn.
_Avoid_: Grill in user-facing copy, one turn per Provider call, multi-step questionnaire, independent style configurator, mandatory image search, repeated confirmation, keyword allowlist

**Generation Readiness**:
A Kernel judgment that the current brief and accepted Design State contain enough coherent professional truth to produce the requested Artifact without silently inventing a consequential decision. For Watch and Tablet image generation it also requires a completed or explicitly waived Design Direction Turn; it does not require a questionnaire, fixed step count, or exhaustive uncertainty review.
_Avoid_: Fixed questionnaire completion, asking about every uncertainty, provider availability, frontend step counter, hidden generation without direction alignment

**Generation Authorization**:
The user's explicit request to produce an Artifact, including ordinary product verbs such as design, make, generate, draw, render, or create a concept image. For Watch and Tablet, the request authorizes the Design Direction Turn and the reply authorizes Provider execution; an explicit instruction to use the recommendation or proceed without discussion authorizes immediate execution. Exploratory requests authorize only conversation, visible user constraints remain binding for Media, and professional knowledge selection, Skill loading, Prompt authorship, and Tool execution remain autonomous Jarvis responsibilities.
_Avoid_: Repeated confirmation, magic option text, frontend keyword classifier, binding Atom IDs, Root-authored final Prompt, Media silently changing user decisions, frontend-owned authorization

**Directional Generation**:
A generation request that establishes or materially changes product identity or the design direction in the current Jarvis Flow. It receives whole-direction alternatives in the Design Direction Turn, while local edits, derivative scenes, detail images, alternate views, and retries receive a narrower implementation-strength or trade-off question instead of reopening the whole design direction.
_Avoid_: Every Provider call, fixed strategy composition, treating a minor revision as a new Flow, repeating the complete design interview

**Artifact Review**:
One concise evaluation by the existing Jarvis Critic of the actual persisted pixels against Skill-owned quality rules. Every newly generated Watch Concept Image and Tablet Concept Sketch receives this review in the same request after Media succeeds; the Agent delivers the image whether it passes or is rejected, alongside the judgment, two or three visible evidence points, and one suggested next step so the professional user can continue the discussion naturally. The result remains in native Chat, Critic output, and Trace: it creates no Artifact quality field, frontend state, retry loop, or automatic replacement. Later derivative or unsupported Artifact types follow their Skill-defined policy.
_Avoid_: Prompt-only approval, full checklist by default, automatic retry loop, hidden or discarded rejection, Media self-review, frontend evaluator, custom vertical Critic runtime

**Professional Workspace**:
The complete upstream-native Jarvis Canvas revealed on explicit user request, with Chat retained and the current Flow and node selection preserved. Its structure, styling, behavior, and update path remain untouched by the Product View; only the Workspace Integration Seam may add the reciprocal Agent Workspace action.
_Avoid_: Default Canvas, Mini Canvas, rebuilt Artifact editor, Product View reskin, maintained upstream UI patch, duplicated Project or Flow state

**Workspace Integration Seam**:
The single minimal Product Host integration point that injects reciprocal Agent Workspace navigation into Professional Workspace without changing native Canvas, Chat, layout, theme, components, or persistence. It carries only workspace-switch intent and authoritative context, keeping the fork compatible with upstream Professional Workspace updates.
_Avoid_: Professional Workspace redesign, copied header, CSS override, parallel navigation state, broad upstream patch

**Upstream Compatibility Surface**:
The complete, explicitly registered set of narrow integration seams where the Shared Product Trunk touches upstream-derived Jarvis files. Each touchpoint is a small contiguous connection to a Product-owned Adapter, contains no Product behavior, moves or copies no Jarvis Authority, and can be removed without damaging native Jarvis operation. Its size is governed primarily by touchpoint count and semantic scope, with changed-line count used only as an upgrade-risk warning; automated review reports the native-file delta against `upstream/main`, and contract tests protect native behavior across upgrades.
_Avoid_: Unregistered native edit, Product logic in native presentation, copied Chat runtime, broad upstream refactor, line-count-only compliance

**Public Chat Delivery Adapter**:
The category-neutral Product-owned Adapter that reconciles one Public Chat turn's nested Media completion claims with authoritative Jarvis Flow, Canvas node, and asset persistence before materializing response assets and the final delivery verdict. It owns no generation, asset record, Canvas state, retry policy, or professional meaning; the upstream-derived Public Chat bridge contains only one narrow, removable call through the Upstream Compatibility Surface. If a usable persisted Artifact exists but a later step fails, the Adapter preserves the Artifact and reports usable partial completion.
_Avoid_: Latest-Canvas inference, Product asset database, copied Media runtime, vertical-specific delivery rule, reconciliation logic spread through the upstream bridge

**Upstream Patch**:
A small, independently tested correction to upstream-derived Jarvis behavior that benefits native Jarvis independently of the Product Host. It remains isolated from Product behavior, is prepared for upstream submission, is temporarily registered in the Upstream Compatibility Surface while unmerged, and is deleted locally once an equivalent upstream correction is adopted.
_Avoid_: Permanent local bugfix pile, Product feature disguised as upstream fix, untested native edit, patch mixed with an integration seam
