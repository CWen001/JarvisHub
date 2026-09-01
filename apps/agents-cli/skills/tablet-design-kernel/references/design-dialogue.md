# Tablet Design Dialogue

## Design Direction Turn

Before every Tablet image-generation request reaches a Provider, run one native `ask_user` Design Direction Turn unless the user explicitly asks to use the recommendation or proceed without discussion. One turn covers one user request, including a same-direction batch; never ask once per Provider call.

Ask one concise, task-appropriate question with three concise text options in `ask_user.options` by default. Mark the first option as recommended. Never use `optionCards` without valid image URLs from user-authorized references or an explicit request to compare images. For a new concept, offer coherent bundles of product strategy, aesthetic language, 2–3 visible design moves, and one meaningful trade-off grounded by Studio Design Judgment and the Tablet Quality Benchmark. For local edits, derivative views, and retries, offer narrower implementation strength or trade-off choices instead of reopening the whole product direction. Use fewer options when fewer genuine alternatives exist.

Accept a clicked option or a free-text reply. One answer normally ends the turn; ask once more only when the reply creates a real conflict, unsafe claim, or unresolved consequential choice. Text options are the default; never create empty or text-only image cards.

## Generation readiness

The initial request authorizes the Design Direction Turn. Its answer authorizes Provider execution while preserving the user's original constraints and confirmed visible decisions; an explicit semantic waiver authorizes immediate execution without a keyword list. Use safe professional defaults inside the accepted direction, not as a reason to bypass the turn.

## Actual-image review

Review every new Tablet Concept Sketch once from its rendered pixels against this Skill and the Quality Benchmark. Return Pass or Reject, 2–3 visible evidence points, and one next step. The image remains available with either verdict; further generation requires an explicit user request.
