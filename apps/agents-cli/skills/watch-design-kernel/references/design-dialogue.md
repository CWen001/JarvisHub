# Watch Design Dialogue 0.3.0

Dialogue must improve the design state before generation, not collect fields or offer adjective-only style choices.

## Decision tree and frontier

Treat the unresolved design as a tree. In each turn, ask the current frontier: every consequential decision whose prerequisites are already settled. Do not ask downstream form or CMF questions while product role or thesis is unresolved.

A frontier question must:

- state the professional reading and why the decision matters;
- offer visibly distinguishable whole-product consequences, not mood words;
- include the recommended answer and its trade-off;
- accept free text;
- avoid asking for facts the Agent can derive from the brief, references, or loaded knowledge.

When several independent frontier decisions are ready, ask them together as numbered questions. When they form one coupled design choice, offer up to three coherent strategy bundles in `ask_user.options`, with the first recommended. Use numbered Markdown in hosts without native `ask_user`.

## New direction

Normally use two turns and at most three.

### Turn 1 — Product thesis

Resolve the wearer, dominant occasion, portfolio role, desired visual presence, maturity anchor, and highest-leverage tension. Offer three coherent positions. Each position states:

- the whole-product relationship;
- two or three visible consequences;
- what remains deliberately conventional;
- one honest trade-off.

Do not propose case geometry merely to make the options look different.

### Turn 2 — Form system

Build on the accepted role and maturity prior. Construct the Design Spine, set the thickness budget, resolve one Hero-visible Craft Carrier, bind its process to the substrate, and then resolve functional, construction, and subordinate ornamental detail. Use the Schema's controlled choices or an equally precise alternative; pair every soft quantity with its reference and visible consequence. When a scale is needed, use a Physical Functional Scale of short geometric marks machined, engraved, etched, or inlaid into a permanent non-display metal inner carrier, bezel, or rehaut; keep the replaceable electronic watch face independent. Keep the strap quiet with at most one low-contrast substrate-compatible echo. Complete every line of the Compact Internal Design State before Prompt authorship.

### Turn 3 — Conflict only

Ask only when the answer creates a real conflict or leaves one consequential relationship unresolved. Otherwise use professional defaults and run the Design Judgment Schema pre-generation synthesis.

## Portfolio or free exploration

Treat a multi-concept request as a portfolio, not a novelty contest. When the request is a series:

1. construct one parent Design Spine and shared craft syntax;
2. lock two or three identity-bearing structural relationships across every model;
3. give each model a role, one primary variation axis, and a distinct Craft Resolution;
4. keep the primary carrier visible at product distance and translate every secondary echo into a process compatible with its substrate.

“Style and aesthetics are free” delegates choices inside this inheritance model. It does not authorize four unrelated architectures or one exotic silhouette per concept.

## Revision

Use one turn and at most two. State what must remain, identify the requested change's main trade-off, and offer implementation strengths or relationships. Do not reopen the product role unless the requested change conflicts with it.

## References and quality anchors

When the user approves a visual quality reference, ask only what is ambiguous about its authority. Translate the accepted reference into specific relationships—proportion restraint, surface-transition discipline, part-boundary precision, material hierarchy, attachment resolution, or detail density—and preserve those relationships in Design State. Do not copy its styling unless requested.

## Generation readiness

Generation is ready only when every line of the Compact Internal Design State is resolved or explicitly non-applicable and the Design Judgment Schema readiness invariant passes: role-derived maturity prior + thickness budget → Design Spine → selected cultural relationships and abstraction operation → Hero-visible structural carrier → substrate-bound process → composed echoes and quiet zones → functional detail → construction detail → subordinate ornament → Hero proof. A series must additionally resolve parent Design Spine → shared relationships → shared craft syntax → role variation.

After readiness, state once for the batch:

1. the exact image count;
2. the conditions held fixed;
3. the deliberate design judgments varied between concepts.

Then request one confirmation and stop. One confirmation authorizes the whole explicit batch. Do not ask before each Provider call and do not retry a failure without a new user request.

## Actual-image review

Review every generated image once from its pixels. Report Render Integrity and Brief Fit separately, with 2–3 visible evidence points and one next step. Preserve all valid generated images regardless of verdict. Review diagnoses the result; it is not the mechanism for completing an under-resolved design state.
