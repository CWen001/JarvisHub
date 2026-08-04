# Enterprise Vertical Design Product

A single-enterprise, single-category professional design product built on JarvisHub's upstream-derived Agent foundation. Another enterprise or design category receives a separate product fork rather than becoming a selectable vertical inside the same running product.

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

**Product Decision Card**:
The Product Timeline interaction for a professional decision or other required user input. While a run awaits input, its related Semantic Work Item carries the awaiting-user Actionable Execution Status and an adjacent Product Decision Card holds the question and actions. After the user answers, the card condenses to the accepted choice while the run resumes; the question is never buried inside execution detail or reduced to an ordinary assistant message.
_Avoid_: Question inside task tree, raw `ask_user` trace, detached waiting status, disappearing answer, frontend-owned professional decision

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

**Vertical Product Fork**:
An independently branded and deployed product for one enterprise and one professional design category. It tracks Jarvis Core upstream while owning exactly one Product Chat Shell, one Design Kernel, and their integration adapters.
_Avoid_: Runtime vertical switch, plugin marketplace, multi-tenant category catalog

**Vertical Design Extension**:
A compile-time deep module that turns the generic Vertical Product Host into one enterprise design product. Its entire external Interface is an Extension Descriptor containing `id`, `brand`, and `skillRoot`; behind that Interface it owns the category brand, thin Skill entry, and framework-independent professional references. Each deployed fork installs exactly one Extension.
_Avoid_: Runtime plugin marketplace, callback registry, Jarvis Core patch, parallel Harness, prompt pack

**Extension Descriptor**:
The small Interface presented by a Vertical Design Extension to Jarvis: one stable installation `id`, one `brand` definition, and one `skillRoot`. It does not expose Agent, Tool, persistence, Canvas, knowledge-selection, or Artifact-rendering callbacks; new fields require evidence from another real vertical implementation.
_Avoid_: Plugin SDK, lifecycle hooks, vertical workflow configuration, speculative optional callbacks

**Vertical Product Host**:
The category-neutral Product View host that consumes one Extension Descriptor and exposes the shared product experience: a projected Product Timeline, Project/Flow/Session navigation, Product Asset Panel entry, Native Artifact Projection, and transition to the complete Professional Workspace. It changes presentation through the Agent Workspace Runtime without becoming another Harness or source of durable facts.
_Avoid_: Watch-only workflow, multi-extension runtime, copied Jarvis state, extension-owned orchestration

**Fixture Extension**:
A non-production test Adapter satisfying the same three-field Extension Descriptor as the Watch Extension. It proves that the Vertical Product Host and its tests depend only on the Extension Interface and contain no hidden Watch assumptions; it is never exposed as a selectable category or deployed product.
_Avoid_: Demo vertical, runtime plugin, second product, test-only callback interface

**Harness Adapter**:
The thin translation between framework-independent Kernel concepts and one Harness's native primitives. It maps rather than redefines Design State, Design Dialogue, Artifact requirements, Knowledge Evidence, and evaluation rules.
_Avoid_: Second backend, workflow engine, domain authority, Jarvis fork logic

**Watch Design Skill**:
The single native Jarvis package for the Watch Design Kernel. Its `references/` directory is the sole professional knowledge source and remains free of Jarvis Agent, Tool, Canvas, and task-contract concepts; its thin `SKILL.md` is the Jarvis-specific loading and usage entry. No duplicate Kernel package or generated Skill copy exists.
_Avoid_: Duplicated knowledge source, generated mirror package, second Agent, custom Harness, Jarvis concepts inside professional references

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
A Kernel-defined professional decision interaction that exposes relevant Professional Design Strategy Cards, their recommendation rationale, visible consequences, compatibility, conflicts, limits, and validation needs. In the Jarvis Adapter, the Recommended Strategy Composition is rendered through the existing `ask_user` Markdown question with only “generate with these strategies” and “adjust strategies” as native options; adjustment continues through normal Chat or another native `ask_user` turn. The Adapter does not extend the Tool schema, and the Product View neither parses nor persists professional state.
_Avoid_: Generic clarification, consumer questionnaire, frontend wizard, raw Knowledge Atom picker, custom `strategyCards` Tool field

**Professional Design Strategy Card**:
A user-facing professional projection of a selected Knowledge Atom. It exposes the strategy, applicability, selection rationale, visible design consequences, compatibility and conflicts, trade-offs, validation needs, and recommendation strength without exposing internal IDs, digests, approval mechanics, or storage fields. A user's adopt, exclude, or adjust decision becomes Kernel-interpreted Design State rather than frontend-only selection state.
_Avoid_: Raw Knowledge Atom record, inspiration tag, unexplained recommendation, frontend filter chip

**Strategy Candidate Set**:
A Kernel-selected, ranked set of Professional Design Strategy Cards relevant to the current brief and Design State. It presents a concise recommended subset first while allowing the professional user to expand into a broader relevant pool; unrelated knowledge remains outside the interaction unless the design context changes.
_Avoid_: Entire knowledge catalog, opaque top result, fixed frontend menu, unbounded atom search

**Recommended Strategy Composition**:
The Kernel's proposed combination of the most relevant Professional Design Strategy Cards for the current design turn. It is presented as one confirmable direction rather than as a set of initially independent selection states. The professional user either accepts the composition as a whole or enters adjustment, where individual strategies and deeper evidence become available; only the accepted or adjusted result may influence the Kernel's Design State interpretation and the resulting Prompt.
_Avoid_: Silently active recommendation, mandatory per-card triage, preselected frontend checkboxes, unconfirmed Prompt input

**Strategy Adjustment**:
A professional revision request against a Recommended Strategy Composition. The user may replace or remove a card through lightweight structured actions or describe a more nuanced change in natural language; both paths are interpreted by the Kernel through the same decision interface and return a revised composition for confirmation.
_Avoid_: Frontend-authored design mutation, separate form workflow, silent card toggle, direct Prompt editing

**Generation Readiness**:
A Kernel judgment that the accepted strategy composition and current Design State contain the minimum professional truth needed for the requested Artifact. Readiness normally follows one confirmation turn; another Design Dialogue is required only for a missing required design fact, a substantive strategy conflict, an incompatible user requirement, or a direction-changing decision that cannot be safely inferred.
_Avoid_: Fixed questionnaire completion, asking about every uncertainty, provider availability, frontend step counter

**Generation Authorization**:
The user's explicit acceptance of a Recommended Strategy Composition and request to generate the Artifact in one action. The accepted visible design decisions become binding native user constraints for Media, while internal Knowledge Atom selection, Skill loading, Prompt authorship, and Tool execution remain autonomous Jarvis responsibilities. Authorization proceeds only if the Kernel establishes Generation Readiness.
_Avoid_: Binding Atom IDs, Root-authored final Prompt, repeated confirmation, Media silently changing user decisions, frontend-owned readiness decision

**Directional Generation**:
A generation request that establishes or materially changes product identity or the design direction in the current Jarvis Flow. It requires a prior Recommended Strategy Composition unless the user has already specified the strategies explicitly. Local edits, derivative scenes, detail images, alternate views, and continuations adequately grounded by native `generationContext` do not repeat the knowledge-selection interaction.
_Avoid_: Every media call, fixed first-turn gate, minor revision, derivative Artifact

**Artifact Review**:
An optional Jarvis-native Critic evaluation of a generated Artifact against Kernel-owned quality rules. Ordinary Media completion does not imply or automatically trigger review; review runs only when explicitly requested by the user or required by a Kernel-delivered Skill quality gate. It appears as the normal output of that review turn rather than as a standing Artifact Card status or default Product View concept.
_Avoid_: Mandatory review after every generation, unreviewed badge, fixed review button, Media self-review, inferred quality pass, frontend evaluator

**Professional Workspace**:
The complete upstream-native Jarvis Canvas revealed on explicit user request, with Chat retained and the current Flow and node selection preserved. Its structure, styling, behavior, and update path remain untouched by the Product View; only the Workspace Integration Seam may add the reciprocal Agent Workspace action.
_Avoid_: Default Canvas, Mini Canvas, rebuilt Artifact editor, Product View reskin, maintained upstream UI patch, duplicated Project or Flow state

**Workspace Integration Seam**:
The single minimal Product Host integration point that injects reciprocal Agent Workspace navigation into Professional Workspace without changing native Canvas, Chat, layout, theme, components, or persistence. It carries only workspace-switch intent and authoritative context, keeping the fork compatible with upstream Professional Workspace updates.
_Avoid_: Professional Workspace redesign, copied header, CSS override, parallel navigation state, broad upstream patch
