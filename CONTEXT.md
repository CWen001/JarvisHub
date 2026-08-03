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
The primary enterprise- and category-specific Product View centered on one dominant Chat timeline. Native supporting capabilities such as assets, history, and Memory open as temporary panels, while the Canvas remains hidden until the user enters the Professional Workspace. The Shell projects Jarvis-owned professional facts and issues commands through Jarvis interfaces while owning only ephemeral presentation state.
_Avoid_: Multi-category launcher, fixed multi-column dashboard, always-visible asset rail, Canvas-only UI, frontend workflow engine

**Agent Workspace (Product View)**:
The user-facing Agent Workspace and enterprise-specific projection of Jarvis-owned conversations, tasks, Knowledge Evidence, Artifacts, assets, approvals, and execution state. Native capabilities retain their Jarvis data, behavior, and execution paths while the Product View may change their layout, styling, and entry points. It may own ephemeral presentation choices such as active panels or workspace visibility, but no durable professional design fact. Agent Workspace and Professional Workspace are reciprocal, visually isolated surfaces: the native Canvas and its header are not rendered behind Agent Workspace, even translucently.
_Avoid_: Pixel-copy requirement, second frontend backend, shadow task state, product-owned asset ledger, duplicate workflow, Canvas ghosting behind Agent Workspace

**Execution Summary**:
The compact, collapsed-by-default projection of a Jarvis run in Agent Workspace. It remains pinned as one status line only while execution is active, then becomes an ordinary scrollable Chat timeline record when completed or failed; detailed Task, Skill, Sub-agent, and Tool traces open temporarily on demand, and Professional Workspace remains native.
_Avoid_: Always-expanded execution trace, permanently pinned completed run, task dashboard, hidden trace, replacement execution state, Professional Workspace customization

**Product Chat Composer**:
The compact, auto-growing request input in Agent Workspace, with bounded height and one consolidated action row for attachments, Skills, and sending. It is a Product Chat Shell presentation and does not replace or restyle the native Chat retained in Professional Workspace.
_Avoid_: Fixed tall input region, unbounded composer, Professional Workspace composer customization

**Artifact Card**:
The lightweight inline rendering of a successfully persisted, usable Artifact produced by a Native Artifact Projection inside the Agent Workspace Chat timeline. It appears only after generation succeeds and only from stable same-turn Jarvis message, Tool, node, and asset references, with a larger preview, asset title, and direct continuation, reference, Professional Workspace, and download actions; pending or failed generation never creates a placeholder card, and Professional Workspace retains native rendering.
_Avoid_: New Chat message type, pending placeholder, failed result card, latest-Canvas-result inference, duplicated design summary, embedded review dashboard, frontend-owned result, Mini Canvas, Professional Workspace customization

**Native Artifact Projection**:
A Product View projection derived from an existing Jarvis Chat message, Tool snapshot, and stable Flow, node, and asset references. It may present preview, native execution status, Kernel-owned Design State facts when available, and navigation to the native Canvas; it creates no Artifact record, lifecycle state, or duplicate persistence. When reliable native references are unavailable, it falls back to Jarvis's original asset rendering.
_Avoid_: Artifact backend, shadow message protocol, frontend inference of professional facts, copied asset state

**Native Asset Center**:
Jarvis's existing asset-library capability presented inside the Product View without a second asset catalog or lifecycle. It retains the native Canvas/All scopes, media filters, persistence, export, Canvas insertion, copying, and stable asset facts; selecting a usable asset may additionally attach it to the existing Chat composer as a native reference input.
_Avoid_: Product-owned asset database, copied gallery, separate upload pipeline, frontend reference ledger

**Current Project Context**:
The Jarvis-owned Project and current Flow context shared by the Product Chat Shell, Native Asset Center, history, and Professional Workspace. Product launch resumes the most recent Jarvis Project; when none exists, the Product View guides creation through Jarvis's native project path. A temporary history drawer treats Projects as the primary history unit, with multiple Jarvis-native Chat Sessions subordinate to their owning Project; the drawer is closed by default, selecting a Project resumes its most recent Session, and native new-conversation behavior preserves the current Flow. Project identity, membership, lifecycle, conversation identity, and persistence never belong to the Product View.
_Avoid_: Global unscoped Chat, fixed history rail, one forced lifetime conversation, conversation-first cross-project history, frontend project or session registry, copied metadata

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
The category-neutral Jarvis Product View host that consumes one Extension Descriptor and exposes the shared product experience: dominant native Chat, Project and Session navigation, Native Asset Center, Native Artifact Projection, and transition to the complete Professional Workspace. It changes presentation without becoming another Harness or source of durable facts.
_Avoid_: Watch shell, multi-extension runtime, duplicated Jarvis frontend, extension-owned orchestration

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
The complete native Jarvis Canvas revealed on explicit user request, with Chat retained and the current Flow and node selection preserved. It exposes a reciprocal Agent Workspace action, and switching surfaces does not layer one workspace visually beneath the other. It is currently a Product View transition—not a simplified Canvas, separate application, or alternate execution mode—but remains a distinct product capability that may later be entitlement- or payment-gated without changing Jarvis ownership of Project and Flow state.
_Avoid_: Default Canvas, Mini Canvas, rebuilt Artifact editor, visually layered workspaces, duplicated Project or Flow state
