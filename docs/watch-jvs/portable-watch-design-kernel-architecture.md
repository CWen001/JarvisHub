# Portable Watch Design Kernel Architecture

## Status

The Design Authority / Execution Authority separation remains accepted. The one-fork/one-extension installation shape, three-field Web Descriptor, per-vertical brand shell, and Fixture Extension sections are superseded by ADR-0014 and ADR-0015: Watch and Tablet now coexist as self-contained native Skill Packages behind one shared brand and an ordered Vertical Skill Registry. The current Native Skill packages remain the executable integration form.

## Why this architecture exists

JarvisHub provides a substantially stronger Agent Harness than a product-specific team should attempt to reproduce: Agent and Sub-agent orchestration, Tool execution, turn control, provider dispatch, retry and recovery, Chat sessions, Canvas, assets, persistence, and tracing.

Reusing that Harness must not reduce the organization's own technology to a frontend skin or optional Prompt pack. The durable product advantage lies in professional design research: what a valid product design contains, how domain knowledge is represented and selected, which decisions require human participation, what an Artifact must make visible, and how professional quality is evaluated.

The architecture therefore separates two authorities:

- **Portable Watch Design Kernel — Design Authority**
- **Jarvis Core — Execution Authority and current persistence carrier**

The Kernel determines what professional design work means. Jarvis determines how that work is reliably executed.

## System shape

```text
┌─────────────────────────────────────────────────────────┐
│ Portable Watch Design Kernel                            │
│ Sole Design Authority                                   │
│                                                         │
│ Product Schemas                                         │
│ Knowledge Model and Selection                           │
│ Design Interaction Protocol                             │
│ Artifact BaseModels                                     │
│ Quality and Evaluation Rules                            │
└──────────────────────────┬──────────────────────────────┘
                           │ Kernel concepts
                    Harness Adapter
                           │ Native mappings
┌──────────────────────────▼──────────────────────────────┐
│ Jarvis Core                                             │
│ Sole Execution Authority                                │
│                                                         │
│ Root / Plan / Media / Critic Agents                     │
│ Skill / ask_user / task contracts / media Tools         │
│ Chat sessions / Canvas / Assets / Persistence / Trace   │
│ Provider dispatch / wait / retry / recovery             │
└──────────────────────────┬──────────────────────────────┘
                           │ Jarvis-owned facts and events
                     Product View
                           │
┌──────────────────────────▼──────────────────────────────┐
│ Product Chat Shell                                      │
│ Artifact Cards / Design Dialogues / Asset views         │
│ Optional complete native Professional Workspace         │
└─────────────────────────────────────────────────────────┘
```

A future Harness replaces only the Adapter:

```text
Portable Watch Design Kernel
          ├── Jarvis Harness Adapter
          └── Future Harness Adapter
```

## Vertical Extension deep module

The repeatable product integration is a compile-time Vertical Design Extension, not a one-off Watch shell and not a runtime plugin marketplace. Each deployed enterprise fork installs exactly one Extension into the latest compatible JarvisHub.

Its external Interface is deliberately limited to:

```ts
defineVerticalExtension({
  id: 'watch',
  brand: watchBrand,
  skillRoot: watchSkillRoot,
})
```

The three fields mean:

- `id`: stable installation identity;
- `brand`: product name, marks, and presentation theme;
- `skillRoot`: the one native Skill package containing the thin `SKILL.md` and professional `references/`.

A category-neutral Vertical Product Host consumes that descriptor and provides the dominant native Chat, Project and Session navigation, Native Asset Center, Native Artifact Projection, and transition to the complete Professional Workspace. Agent orchestration, Tools, persistence, and Canvas remain Jarvis-owned.

This is a deep module because Jarvis learns a three-field Interface while receiving the full vertical brand, professional knowledge, Design Dialogue behavior, and generation constraints. Deleting the Extension removes those vertical concerns together while leaving Jarvis Core intact. The Interface intentionally excludes Agent registration, Tool registration, persistence hooks, custom Canvas behavior, knowledge-selection callbacks, Artifact-rendering callbacks, and workflow lifecycle hooks. New fields are added only when another real vertical implementation demonstrates variation that cannot remain hidden behind the existing Interface.

## Authority model

| Concern | Authority | Current carrier or executor |
|---|---|---|
| Valid watch product structure | Portable Watch Design Kernel | Jarvis may persist instances |
| Knowledge meaning, revisions and conflicts | Portable Watch Design Kernel | Jarvis Skill/resources may deliver it |
| Knowledge-selection semantics | Portable Watch Design Kernel | Jarvis Agents may perform constrained reasoning |
| Human design questions and trade-offs | Portable Watch Design Kernel | Jarvis `ask_user` may present them |
| Artifact-visible requirements | Portable Watch Design Kernel | Jarvis Media Agent and image Tool execute them |
| Quality rubric and pass/fail meaning | Portable Watch Design Kernel | Jarvis Critic may evaluate media |
| Agent orchestration and context | Jarvis Core | Jarvis runtime |
| Turn stopping and resumption | Jarvis Core | Chat session and `ask_user` |
| Provider selection and generation | Jarvis Core | Native media lifecycle |
| Canvas, assets and persistence | Jarvis Core | Native repositories and node graph |
| Product-specific presentation | Product View | Frontend-only ephemeral state |

Authority and storage are deliberately separate. In the current Jarvis Adapter, the native Jarvis Flow is used directly as the scope of one coherent design direction. The Adapter does not force Kernel Design State into a standalone persistent object. Accepted choices remain in native Chat, while the executed Prompt, `generationContext`, Knowledge Evidence, generated Artifact node, Tool Trace, and Flow versions preserve the observable execution result. Materially different directions use another native Flow; no separate Design Direction entity, Design State node, Watch-specific database table, Canvas node type, or parallel version system is introduced. The Kernel retains authority over decision meaning and transformation rules; Jarvis owns every persisted fact.

## The organization's core technologies

### 1. Product Schemas

Product Schemas define the professional design truth for a smart watch. They are not Jarvis Tool argument schemas and are not UI form schemas.

A Watch Concept may include:

```text
Watch Concept
├── product and portfolio role
├── target user and scenario
├── primary design tension
├── architecture and proportions
├── wearability
├── controls and interaction
├── CMF and signature identity
├── accepted design decisions
├── preserved variables
├── avoided outcomes
├── assumptions
└── validation needs
```

The Kernel owns:

- field meaning and invariants;
- required versus optional decisions;
- explicit omission and not-applicable semantics;
- versioning and successor-state rules;
- cross-field consistency;
- promotion of human decisions into accepted design truth.

Jarvis may use an Agent to propose values and may persist a Watch Concept, but it cannot redefine what the fields mean or silently omit required design truth.

### 2. Knowledge Model

Knowledge is not merely Markdown embedded in a Skill. The Knowledge Model defines reusable, reviewable professional design moves.

A Knowledge Atom includes at least:

- stable identity and immutable revision;
- approval status;
- activation and avoid-when conditions;
- decision targets;
- one concrete design move;
- visible cues;
- limits and trade-offs;
- conflicts and compatibility;
- validation needs;
- evidence and provenance.

The content and structure remain portable. For the current product, there is deliberately one physical package rather than a canonical package plus generated mirror: `apps/agents-cli/skills/watch-design-kernel/references/` is the sole professional knowledge source, and its files remain free of Jarvis Agent, Tool, Canvas, and task-contract concepts. The adjacent thin `SKILL.md` is the Jarvis-specific loading and usage entry. A future Harness reuses the same reference files and supplies another entry rather than requiring a source-generation pipeline.

### 3. Knowledge Selection

Knowledge Selection is a professional design operation rather than unrestricted Agent intuition.

Its inputs may include:

```text
user context
+ product stage
+ current Design State
+ unresolved design tension
+ requested Artifact
+ prior accepted decisions
+ activation, conflict and avoid-when rules
```

Its outputs include relevant candidate moves, compatibility and conflict information, recommendation rationale, trade-offs, and immutable Knowledge Evidence.

A Harness model may help rank or synthesize candidates, but the Kernel defines the selection problem, eligible knowledge, constraints, and required output semantics.

### 4. Design Interaction Protocol

Human participation is part of the design technology, not a frontend embellishment.

A framework-independent Design Dialogue presents a selected set of Professional Design Strategy Cards to the professional user:

```text
Design Dialogue
├── current interpretation
├── relevant Professional Design Strategy Cards
│   ├── design strategy
│   ├── applicability and selection rationale
│   ├── visible design consequences
│   ├── compatibility and conflicts
│   ├── trade-offs and limits
│   ├── validation needs
│   └── recommendation strength
├── adopt / exclude / adjust decisions
└── continuation policy
```

A Professional Design Strategy Card is a user-facing projection of a Knowledge Atom, not its raw persistence record. Internal IDs, digests, approval mechanics, and storage fields remain hidden, while professional content and consequences remain inspectable.

The Kernel organizes cards as a layered Strategy Candidate Set. The default interaction presents a Recommended Strategy Composition of approximately three to six highly relevant cards as one professional proposal. The initial interaction has only two paths: use “generate with these strategies” to accept the composition and authorize generation in one action, or adjust it. It does not require per-card status management or a second redundant generation confirmation.

Only adjustment progressively reveals deeper information and a simple dual input channel. Each card offers lightweight replace and remove actions; nuanced changes are expressed in natural language through Chat. Both channels enter the same Kernel decision interface rather than creating separate frontend and conversational workflows. The Kernel returns a revised Recommended Strategy Composition for confirmation, making the interpreted change visible before it becomes Design State.

During adjustment, the professional user may expand into a broader pool that is still relevant to the current brief and Design State and inspect compatibility, conflicts, and validation needs. The complete knowledge catalog is not dumped into each interaction, and unrelated knowledge remains outside the candidate set until the design context changes. Neither the recommended composition nor any card silently becomes Design State or Prompt input before explicit acceptance.

The Kernel determines:

- which strategies enter the broader relevant candidate pool;
- which approximately three to six strategies appear in the initial recommended subset;
- why each strategy was selected and how strongly it is recommended;
- what each strategy changes visibly;
- compatibility, conflicts, limits, and validation needs;
- how adopt, exclude, and adjust decisions evolve Design State;
- whether the accepted composition establishes Generation Readiness.

Generation Readiness follows a minimum-necessary-turn rule. Normally, one accepted Recommended Strategy Composition permits generation. The Kernel requests another Design Dialogue only when a required Product Schema fact is missing, selected strategies have a substantive conflict, the user's requirements are incompatible, or an unresolved decision would materially change the product direction and cannot be safely inferred. Ordinary uncertainty does not justify another question, and there is no fixed questionnaire or frontend step count.

The strategy interaction is required only for Directional Generation: a new core product concept or a request that materially changes product identity or direction. Local edits, derivative scenes, detail images, alternate views, and continuations adequately grounded by native `generationContext` proceed through Jarvis's normal flow without repeating strategy selection. Explicit user strategy choices also remove the need to ask the user to select the same direction again.

The Jarvis Adapter maps this without extending the native `ask_user` Tool schema. The Recommended Strategy Composition appears in the existing Markdown question body; the initial native text options are only “generate with these strategies” and “adjust strategies.” Natural-language adjustment uses normal Chat input, while replacements can be returned through another native `ask_user` turn. Product View styling may improve the existing Markdown and options but does not parse them into professional state. `ask_user` owns turn stopping, persistence, and recovery; it does not own the strategy content or decision semantics.

### 5. Artifact BaseModels

Each Artifact type requires its own visible expression model. The Concept Image BaseModel currently covers composition, case architecture, proportions, glass/display, controls/openings, attachment and strap, CMF zones, interface state, detail hierarchy, lighting, evidence priorities, and forbidden outcomes.

The Kernel owns:

- required visible variables;
- cross-variable consistency;
- Artifact-specific salience;
- what must remain visible;
- what cannot be invented or omitted;
- the relation between accepted design decisions and generated evidence.

Jarvis owns the Media Agent and provider call, not these professional requirements.

### 6. Quality and Evaluation Rules

Provider success and Canvas persistence prove execution success, not design quality.

Kernel evaluation rules determine whether an Artifact visibly demonstrates:

- intended silhouette and product identity;
- credible visual thickness and proportion;
- coherent attachment and complete strap construction;
- complete and correctly prioritized controls;
- CMF hierarchy and material credibility;
- interaction and information hierarchy;
- selected Knowledge Atom evidence;
- preserved decisions and avoided outcomes.

Jarvis Critic may inspect the actual image and execute the rubric. The rubric's meaning and pass criteria remain Kernel-owned.

Review follows Jarvis's native orchestration policy rather than becoming an automatic second workflow. Ordinary Media completion does not trigger Critic by default. Root dispatches the native Critic only when the user explicitly requests review or when a Kernel-delivered Skill defines a quality gate for the current stage. Media does not self-review, and the Product View never infers a quality verdict from provider success. The default Artifact Card contains no review label, “unreviewed” badge, or fixed review action. If review is actually requested, its Critic result appears through the normal native Chat output for that turn rather than creating a standing quality-status system.

## Harness Adapter responsibilities

A Harness Adapter is intentionally thin. It translates Kernel concepts into existing native primitives without moving domain semantics into the Harness.

### Current Jarvis mapping

| Kernel concept | Jarvis native primitive |
|---|---|
| Knowledge resources | `Skill` package and progressively loaded resources |
| Design Dialogue | `ask_user` question and options |
| Accepted design decisions | Native Chat plus generated-node Prompt, `generationContext`, Knowledge Evidence and Trace |
| Knowledge Evidence | `sourceEvidence` |
| Artifact generation intent | Native Agent handoff and task context |
| Image generation | `canvas_image_generate_to_canvas` |
| Evaluation rubric | Native `critic` task context |
| Artifact identity | `flowId`, `nodeId`, `assetId` |
| Execution evidence | Generation context and Trace |

The Adapter must not:

- create another Agent scheduler;
- create a shadow conversation or task database;
- duplicate Canvas nodes or asset lifecycle state;
- own professional Schema semantics;
- contain watch-design knowledge that belongs in the Kernel;
- make a Jarvis-specific payload the canonical Kernel representation.

## Product View responsibilities

The Product View projects Jarvis-owned persistent facts and Kernel-defined semantics. “Native-equivalent” means capability, data semantics, behavior, and execution paths remain Jarvis-native; layout, styling, and entry points may be redesigned for the enterprise product. It does not require a pixel-identical copy of upstream UI.

It may:

- present Design Dialogues in enterprise-specific visual language;
- render Artifact Cards through a Native Artifact Projection;
- translate internal Knowledge Evidence into user-readable design rationale;
- expose revisions, evaluation and actions;
- present the Native Asset Center and attach selected assets through Chat's existing reference-input path;
- reveal the complete native Canvas as the Professional Workspace;
- own ephemeral layout, panel, selection and visibility state.

It must not:

- own Design State;
- save knowledge choices in a frontend-only store;
- create an independent asset ledger;
- infer task completion separately from Jarvis;
- implement a second design workflow.

### Native Artifact Projection

The Artifact Card is not a new backend Artifact, Chat message type, or lifecycle protocol. It is a rendering seam inside the existing Jarvis Chat bubble's native asset region:

```text
existing Jarvis Chat message
+ existing Tool snapshot and media result
+ stable Flow / node / asset references
+ persisted Kernel facts when available
              ↓
       Artifact Card rendering
```

The projection preserves the surrounding native Jarvis message, Todo progress, turn verdict, diagnostics, Tool disclosure, and Agent Trace. It remains lightweight: a larger asset preview, asset title, native generation status, and actions for continuing modification, using the asset as a reference, opening the complete native Canvas, and downloading. Agent-authored design conclusions and strategy explanations remain in the surrounding native Assistant Markdown rather than being duplicated inside the Artifact Card. Review is absent from the default card; any requested Critic result remains part of that review turn's normal native Chat output. Prompt, Tool payload, diagnostics, and Trace remain available through native disclosures rather than being copied into a new detail system.

The frontend does not infer missing Design State, evaluation, completion, or provenance. If reliable native node or asset references cannot be resolved, rendering falls back to Jarvis's original asset thumbnail rather than inventing a shadow Artifact.

### Default Product View layout

The Product Chat Shell uses one dominant Chat timeline as its default workspace. Assets, history, Memory, and other Jarvis-native supporting capabilities open only as temporary panels or drawers. The Canvas is not rendered as a reduced preview or permanent side region; it remains hidden until the user explicitly enters the complete native Professional Workspace. The default is therefore neither a fixed multi-column layout nor a project Dashboard.

Product launch resumes the most recent Jarvis-owned Current Project Context. If no Project exists, the Product View guides the user through Jarvis's native creation path. Chat, current Flow, assets, history, and the Professional Workspace all resolve from that same authoritative Jarvis Project. A left-side history/navigation surface projects Jarvis Projects as its primary history units. Each Project retains multiple Jarvis-native Chat Sessions; selecting a Project resumes its most recent Session, an expanded Project can expose its native conversation history, and the native new-conversation capability remains available. Conversations do not become one cross-project feed, and the Product View maintains neither a project index nor a session model.

### Native Asset Center

The Product View reuses Jarvis's existing Asset Center capability and authoritative asset sources rather than implementing another gallery. Native Canvas/All scopes, image/video/text/web filters, persistence/rehosting, ZIP export, Canvas insertion, copy behavior, and asset identity remain intact. A Product View selection may additionally attach a usable asset to the existing Chat composer through its native reference input and `assetInputs` path, preserving `assetId` or `assetRefId` when available. This is an additional presentation entry into the existing Chat request, not a new reference store or asset workflow.

## Native Design Dialogue flow

The intended interaction is participatory while still using native Jarvis execution:

```text
1. User submits a design brief.
2. Jarvis asks the Kernel, through the Adapter, for the current Design Dialogue.
3. Kernel selection semantics produce relevant Professional Design Strategy Cards with rationale, consequences, conflicts, limits, validation needs, and recommendation strength.
4. Adapter maps the Dialogue to native `ask_user` option cards or an equivalent native interaction primitive.
5. Product View renders the Recommended Strategy Composition before generation, with only “generate with these strategies” and “adjust strategies” as the initial actions.
6. The first action simultaneously accepts the composition and grants Generation Authorization; the second enters progressive adjustment of individual strategies and deeper evidence.
7. Jarvis persists the reply in the native Chat session.
8. Kernel semantics interpret only the accepted or adjusted result into the current-turn Design State and evaluate Generation Readiness under the minimum-necessary-turn rule; the Adapter creates no standalone state object.
9. If a hard unresolved issue remains, Generation Authorization does not bypass it: the Kernel returns one new confirmable composition or focused Design Dialogue. Otherwise Jarvis dispatches native Media execution immediately without another confirmation step.
10. The Adapter conveys the user's accepted visible design decisions as native user constraints, not as Knowledge Atom IDs, a prescribed Skill name, or a final Prompt. Media remains autonomous in Skill loading, eligible knowledge selection, Prompt authorship, and Tool execution, but it may not silently reverse the user's confirmed design decisions. Actual knowledge revisions used by Media remain observable through native `sourceEvidence`.
```

This is not a fixed frontend wizard. The conversation may close in one turn through an accepted recommendation or continue through additional alignment turns. The user explicitly authorizes generation; the frontend does not maintain a step counter.

## Current Native Skill MVP

The current implementation proves:

- one native Skill directory can separate framework-independent professional `references/` from a thin Jarvis-specific `SKILL.md` entry without duplicating content or adding a generation pipeline;
- Jarvis can discover and progressively load Watch Design knowledge;
- the Concept Image BaseModel can guide a native Media Agent;
- selected immutable knowledge revisions can be recorded in `sourceEvidence`;
- the existing image provider, Canvas and persistence lifecycle can produce an Artifact;
- the Adapter can remain small.

It does not yet prove or enforce:

- a runtime Product Schema;
- Kernel-governed Design State evolution;
- structured Knowledge Selection;
- framework-independent Design Dialogue output;
- per-generation BaseModel completeness validation;
- Kernel-owned visual quality evaluation.

These are target Kernel capabilities, not reasons to replace Jarvis's Harness.

## Product View MVP scope

The first implementation is a structural validation build, not a complete visual redesign. It includes:

- registration of the three-field Watch Extension Descriptor;
- the category-neutral Vertical Product Host;
- native Chat as the default dominant surface;
- Jarvis Project and Session history in the left navigation;
- the Native Asset Center with attachment through Chat's existing reference path;
- the lightweight Native Artifact Projection;
- transition to the same Project and Flow in the complete native Professional Workspace;
- basic Watch product name, mark, and theme tokens from `brand`.

Large motion systems, exhaustive responsive polish, a complete visual-language rewrite, and redesign of unrelated administration surfaces remain outside this structural MVP. They follow only after native capability parity and Extension isolation have been demonstrated.

## MVP acceptance

### User journey

Within one native Jarvis Project and Flow, the user can:

1. resume the most recent Project and Chat Session;
2. submit a Directional Generation request;
3. inspect and confirm a Recommended Strategy Composition through native `ask_user`;
4. receive an Artifact through native Media execution;
5. view it through the lightweight Native Artifact Projection;
6. attach that Artifact or a Native Asset Center item as a native Chat reference;
7. enter the complete Professional Workspace and find the same Flow nodes and assets;
8. return to the Product View without losing Project, Flow, Session, or selection context.

### Architectural constraints

- no new Agent, Tool, Harness, or persistence system;
- no Watch-specific database table or Canvas node type;
- no durable professional facts owned by the Product View;
- Watch-specific behavior and content remain local to the Extension;
- no scattered `if watch` conditions in Jarvis Core;
- deleting the Extension leaves native Jarvis operational.

### Deep-module replacement test

A non-production Fixture Extension satisfies the same three-field Extension Descriptor with a different `id`, `brand`, and `skillRoot`. Vertical Product Host tests run against both the Watch and Fixture Adapters through the Extension Interface and assert only observable host behavior. The Fixture is not shipped, exposed as a category, or turned into a second product. The replacement test proves that the Host contains no hidden Watch assumptions and that swapping an Extension does not require Host edits.

## Upgrade and portability discipline

To keep Jarvis upgrades absorbable:

1. Prefer documented native Jarvis Tool and persistence interfaces.
2. Keep watch semantics outside Jarvis Agent loops and generic media schemas.
3. Concentrate Jarvis-specific translation in the Harness Adapter.
4. Keep canonical Kernel models independent of Jarvis `task_contract`, Canvas node, and Chat DTO types.
5. Test Adapter behavior through native observable outcomes: pending Design Dialogue, accepted native Chat reply, generated-node Prompt and `generationContext`, `sourceEvidence`, Artifact identity, optional Critic result and Trace.
6. Treat Product View changes as projections over stable identities, not new sources of truth.
7. Maintain a second in-memory or test Adapter for Kernel verification; portability is only real when Kernel behavior can be tested without Jarvis.

## Competitive boundary

Jarvis may be replaced by another capable Harness. The following must survive that replacement unchanged in meaning:

- what constitutes a valid Watch Concept;
- how design knowledge is authored, reviewed, selected and combined;
- how human design decisions are framed;
- how decisions evolve Design State;
- what each Artifact must visibly express;
- how professional quality is evaluated.

If replacing Jarvis causes those concepts to be rewritten, they were not truly part of a Portable Design Kernel. If replacing Jarvis only requires a new Adapter for tools, persistence and views, the architecture is preserving the organization's core technology.
