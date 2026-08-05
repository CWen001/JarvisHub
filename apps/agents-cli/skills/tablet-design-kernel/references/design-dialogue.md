# Tablet Directional Design Dialogue

## When dialogue is required

Use one bounded Directional Design Dialogue for a new tablet concept or a substantive change to product identity, form system, state model, accessory relationship, or CMF direction. Do not reopen it for local edits, derivative scenes, detail images, alternate views, or continuations supported by native `generationContext`.

First judge Design Brief Sufficiency. A brief is sufficient when it contains a coherent intent, a plausible user/use situation, and one meaningful pressure or constraint from which professional judgment can form a direction. It need not specify every detail. Ask one concise clarification only when a missing fact would materially change product form or make responsible inference impossible.

## Professional Design Strategy Card

Translate the brief, Tablet Quality Benchmark, relevant Knowledge Atoms, and Studio Design Judgment into 3–6 complete user-facing cards. The cards collectively resolve the whole-product direction; they are not raw atoms or a requirements questionnaire.

Every card must contain exactly these visible fields:

```markdown
### <short strategy title>
**Strategy**: <the coordinated professional move>
**Why this direction**: <why it answers this brief and product pressure>
**Visible impact**: <what will visibly or tactually change in the tablet>
**Trade-off**: <what is deliberately accepted or constrained>
```

A strong composition normally covers:

- Design Identity and portfolio/Maturity Anchor;
- whole-product proportions and enclosure hierarchy;
- Hero State, carrying, contact, support, or accessory relationships;
- one bounded Leading Departure and its Identity Boundary;
- concrete CMF/touch and process-detail discipline.

Do not expose atom IDs, review state, relevance, digests, benchmark language, source products, or internal selection rationale.

## Recommended Strategy Composition

Put all 3–6 complete cards literally in the native `ask_user.question`. Then provide exactly two initial actions:

1. `按此策略生成`
2. `调整策略`

Do not add a third action and do not generate in the same turn. On adjustment, preserve accepted parts, visibly revise disputed parts, and present the complete updated composition again.

## Generation readiness

Acceptance establishes Generation Readiness when the composition provides enough truth to author one coherent Concept Sketch. Acceptance also authorizes generation. Carry only accepted visible decisions into native `task_contract.userConstraints`; Media independently loads this Skill, applies the BaseModel and professional references, selects supporting atoms, writes the final provider-ready Prompt, and records exact `sourceEvidence`.

Ask again only when there is a missing required product fact, a substantive conflict between strategies, an incompatible requirement, an unsafe/unverifiable claim, or a direction-defining decision that cannot be responsibly inferred.
