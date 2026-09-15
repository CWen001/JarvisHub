# Landing presentation prototype — throwaway

Question: which structure best supports a 10–12 minute client walkthrough from India-market research to phone experiments, watch design and the workbench?

Run from this worktree's root: `pnpm prototype:landing`.

Existing `/` route, development-only `?variant=A|B|C`; `view=home|india|watch|workbench` selects the preview surface. The normal route without `variant` is unchanged. No backend requests or generation are needed for the preview.

- A — research/editorial: equal case tiles followed by a continuous illustrated report.
- B — guided tour: explicit presentation itinerary with a focused first-stop panel; case pages use a side index.
- C — visual portfolio: large product spreads lead to evidence and process.

Use the bottom arrows or keyboard left/right to compare variants. Open case tiles, section navigation, evidence details and image previews. All images come from local experiments, resized without cropping. Market numbers are excerpts from `chuanyin/docs/research/india-smartphone-market-2026.md`; this prototype does not replace the full content-assembly and source-verification pass.

Full archive import, bilingual copy and live-workbench navigation are intentionally outside this rough structure preview. No winning variant has been selected yet.

Branch: `prototype/transsion-landing-preview`. Production `main` is unchanged. Keep this branch as the primary source when implementing the chosen structure; do not merge the switcher or losing variants into production.
