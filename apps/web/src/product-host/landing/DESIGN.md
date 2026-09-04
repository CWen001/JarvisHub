# HUST Design Studio Landing — PDS v4 Light

> Scope: Landing and public case-study files under `apps/web/src/product-host/landing/`, plus assets under `public/product-host/landing/`. Agent Workspace keeps its own `product-host/DESIGN.md`; Professional Workspace remains upstream-native.

## Direction

Precise, calm, spacious, and optically balanced. Use typography, alignment, product imagery, and tonal surfaces for hierarchy. Force light mode. This derives from current Porsche Design System v4 foundations without importing Porsche branding, components, icons, trademarks, or proprietary fonts.

## Tokens

- Canvas: `#FFFFFF`
- Surface: `hsl(240 10% 95%)`
- Primary: `hsl(225 66.7% 1.2%)`
- Contrast high: `hsl(240 7.1% 11% / 0.7)`
- Contrast medium: `hsl(240 6.1% 7% / 0.6)`
- Border: `hsl(234 6% 32.9% / 0.324)`
- Focus: `#1A44EA`
- Control radius: `12px`
- Tile radius: `24px`
- Shadow: `0 3px 8px rgb(0 0 0 / 16%)`, overlays only
- Motion: `250ms` short, `400ms` moderate

## Typography

Use one Chinese-first family across marketing copy because Porsche Next is not bundled:

`'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif`

- Display: `clamp(2.28rem, 5.2vw + 1.24rem, 7.48rem)`, Chinese optical weight 500
- Section title: `clamp(2.03rem, 3.58vw + 1.31rem, 5.61rem)`, Chinese optical weight 500
- Lead: `clamp(1.13rem, .21vw + 1.08rem, 1.33rem)`, weight 600
- Body: `1rem`, weight 400/500
- Supporting: `.875rem`, weight 400
- Label: `.75rem`, weight 600
- Line height: `calc(6px + 2.125ex)`

## Layout

- Header and content share one responsive max-width container.
- The top-left lockup aligns HUST Design School and the established WOWSA + Service Design Engineering Center pair on one optical centerline, separated by a quiet vertical rule.
- Hero is text beside one large media tile, then three capability tiles.
- Use the official fluid spacing rhythm: 8–16, 16–36, 32–76, 48–96, and 80–200px.
- Product imagery remains dominant and uncropped where identity matters.
- Gallery uses an editorial grid on desktop and one column on narrow screens.
- Interactive targets are at least 44px.

## Components

- Primary navigation CTA: near-black fill, white text, 12px radius.
- Secondary navigation: text link with a precise underline on hover.
- Small line icons sit in quiet 32–36px circular badges and communicate context; they never compete with the brand or headline.
- Capability and gallery tiles: 24px radius, flat tonal surface.
- Gallery captions: white surface with readable primary/contrast text.
- Focus is always a visible 2px blue outline.

## Design Iteration Cases

- A Design Iteration Case is a client-facing evidence narrative, not a gallery or raw log.
- Lead with the design question, Comparison Board, evaluation verdict, learning, and what changed next.
- Preserve failed batches and fixed-rubric gates; identify internal evaluation without implying consumer or market validation.
- Keep raw Prompt, Schema, and Evaluation evidence available through progressive disclosure and direct download.
- In Chinese UI, unfamiliar cultural sources use a plain Chinese name followed by the original English term in parentheses.
- Use factual section labels rather than conversational slogans at display sizes.
- Keep Applied Validation separate from the causal Schema-evolution mainline and never invent missing aggregate scores.
- Long cases use a compact sticky phase index; individual batches remain generous editorial cards rather than dashboard rows.

## Guardrails

- Keep the page light from header through footer, except a deliberate near-black closing or featured-case surface.
- Visible marketing copy is Chinese-only; official logo artwork may retain its embedded bilingual identity.
- Use one near-black action color; institutional logo colors remain brand assets, not UI tokens.
- Keep type within the token scale. Headings follow the PDS regular-heading principle; use 500 only as an optical correction for Chinese glyph density.
- Prefer flat surfaces and whitespace; reserve blur and shadow for overlays.
- Motion changes opacity, color, or position and respects reduced motion.

Research basis: `docs/research/porsche-design-system-v4-landing-foundations.md`.
