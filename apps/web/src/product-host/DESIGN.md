# Agent Workspace — PDS Light

> Product-owned visual authority derived from Porsche Design System v4 light-theme principles. This is not Porsche branding and does not import Porsche components, trademarks, icons, or proprietary fonts. It applies only to Agent Workspace and Product-owned temporary panels. Professional Workspace remains upstream-native light.

## Principles

- **Precise, calm, useful.** Hierarchy comes from typography, alignment, spacing, and tonal surfaces—not decoration.
- **Chat first.** The Product Timeline is the dominant surface. Chrome and temporary panels must not compete with it.
- **One visual authority.** Product UI values come from the tokens below; do not introduce ad-hoc colors, radii, shadows, spacing, or type scales.
- **Authority remains visible.** Success, partial completion, failure, disabled state, and focus are explicit and never color-only.

## Color

- Canvas: `#FFFFFF`
- Surface: `#F2F2F3`
- Surface raised: `#FFFFFF`
- Surface hover: `#E9E9EB`
- Primary: `#010205`
- Secondary text: `#62646A`
- Muted text: `#8A8D93`
- Border: `#D8D9DC`
- Border strong: `#B8BBC0`
- Focus: `#1A44EA`
- Success: `#197A45`
- Warning: `#9A5B00`
- Error: `#C21B17`
- Info: `#1769AA`

The full HUST and d.school lockup is the only multicolor brand asset. Its colors are not UI tokens.

## Typography

- Latin and numerals: `Inter`
- Chinese: `Noto Sans SC`
- Fallback: `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `PingFang SC`, `Microsoft YaHei`, sans-serif
- Weights: 400, 600, 700 only
- Scale: 12, 14, 16, 20, 24, 32px
- Body line-height: 1.55
- Display line-height: 1.2
- Micro labels may use `0.04em` tracking; body copy uses normal tracking.
- Do not use serif type in Product UI.

## Spacing and layout

- Base rhythm: 8px
- Allowed primary spacing: 4, 8, 12, 16, 24, 32, 48px
- Top bar: 72px desktop, 64px narrow
- Rail: 280px expanded, 64px collapsed
- Product Timeline: maximum 960px content width
- Interactive targets: at least 44×44px even when the visible icon is 20px
- Prefer whitespace over extra dividers. Align to a predictable grid.

## Shape, borders, and elevation

- Radius: 2px micro, 4px controls, 6px cards, 8px Dialogs and Drawers
- Borders: 1px tonal borders; selected state may use a 2px Primary edge
- Elevation: flat by default; one restrained overlay shadow for temporary panels only
- No glassmorphism, gradients, ornamental texture, glowing edges, or soft pill-shaped product cards

## Icons

- Use the existing Tabler family only.
- Base glyph: 20px with consistent stroke weight.
- Top-bar actions use the same 44px container, hover, active, and focus treatment.
- Agent → Professional uses a Layout/Canvas glyph. Professional → Agent uses a Message glyph in the same host action slot.
- The top-bar action is a global reciprocal Workspace switch and never selects the latest Artifact. Artifact-specific node navigation appears only as an explicit preview action.
- Every icon action has Chinese Tooltip and accessible name.

## Product surfaces

### Top bar

- Full institutional lockup on desktop.
- Watch Design Studio appears once as a compact subtitle.
- Narrow screens use the compact lockup derived from the same source.
- Current Project is quiet metadata, not a competing title.

### Project Context Rail

- Project is primary; design direction and conversation are subordinate.
- Selected state uses tonal Surface plus a precise Primary edge.
- Collapsed state preserves only essential icon actions.
- The history section label is 12px/600, Project names are 14px/600 in 44px rows, and subordinate Session names are 12px/400 in 36px rows. Selection changes surface, edge, and weight rather than font size.
- Clicking the current Artifact thumbnail opens the shared Artifact Preview; it never switches Workspace directly.

### Product Timeline

- Conversation, Decision, Compact Execution Row, Artifact, and Notice are distinct but share one grid and type system.
- User entries use a subtle Surface treatment; assistant entries stay white with a fine border.
- Raw Skill text, Tool payload, and complete native Trace never render here.
- The Timeline is the only vertical scroll owner in the main surface. Conversation, long Decision content, execution state, Artifacts, and Notices all scroll inside it; only the Composer remains fixed.
- Live updates follow the viewport only while the user is near the bottom. Manual upward scrolling preserves position and exposes one restrained “回到最新” action; sending, changing Session, or using that action resumes following.

### Compact Execution Row

- One line by default: authoritative status, current product-language activity, progress, and duration. Activity advances in place rather than using a timed carousel or marquee.
- Completion condenses to a result summary; failure remains visible rather than rotating away.
- Expanded state is a curated readable list of product-language tasks, statuses, and failure reasons only.
- The row contains no Professional Workspace action. Full native detail remains available through the global reciprocal Workspace switch.

### Artifact Card

- Preview dominates, uses `object-fit: contain`, and never crops product identity.
- Actions are compact, literal, and adjacent to the result.
- Pending or failed generation never masquerades as a successful Artifact.
- Artifact thumbnails in Timeline, Rail, and Product Asset Panel share one preview shell. A stable Artifact offers continuation, reference, exact Professional Workspace node navigation, and download; an Asset without a stable node offers add-to-Workspace, reference, and download without inventing or disabling a node action.

### Product Asset Panel

- Product-owned Drawer/Dialog presentation, not styled native Asset Center DOM.
- Uses the same surfaces, filters, cards, actions, empty/error/loading states, and responsive rules.

### Composer

- Compact and auto-growing with one action row.
- Input, references, attachments, Skills, send, and interruption share one coherent focus order.
- Only unsent text, selected Skill identity, and stable pending attachment/reference identities follow the current Session across Workspace switches. Focus, menus, dimensions, and scroll remain local presentation state.

## Motion

- 150–220ms, purposeful, and limited to opacity, color, and panel position.
- Respect `prefers-reduced-motion`.
- No scale-on-hover or decorative continuous animation.

## Responsive behavior

- Desktop: permanent top bar and collapsible Rail.
- Narrow: 64px top bar, compact lockup, Rail as left Drawer, full-width Timeline, 16px page gutters.
- Temporary panels must not permanently reduce Timeline width.

## Prohibited outcomes

- No Lamborghini visual language or yellow accent system.
- No warm-paper, sage, terracotta, brass, or serif-led legacy theme.
- No Product CSS overrides inside Professional Workspace.
- No copied native Chat or Asset Center presentation DOM.
- No ad-hoc hex values, arbitrary radii, or one-off shadows in Product View styles.
