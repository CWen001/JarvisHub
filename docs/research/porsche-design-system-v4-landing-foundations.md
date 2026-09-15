# Porsche Design System foundations for the Landing Page

Checked: 2026-09-01

The canonical Porsche Design System URL currently redirects to the v4 documentation, so v4 is the current public foundation used here.

## Findings

- Theme selection is controlled by CSS `color-scheme`; this Landing Page forces `light`.
- Light tokens use a white canvas (`#fff`), a light neutral surface (`hsl(240 10% 95%)`), near-black primary (`hsl(225 66.7% 1.2%)`), and blue focus (`#1A44EA`).
- The current type scale is relative and fluid. Display `5xl` is `clamp(2.28rem, 5.2vw + 1.24rem, 7.48rem)`; body `sm` is `1rem`; supporting text `xs` is `.875rem`.
- Supported weights are 400, 600, and 700. Porsche Next is proprietary; the documented fallback stack is `'Arial Narrow', Arial, 'Heiti SC', SimHei, sans-serif`.
- PDS specifies regular (400) headings and reserves display type for high-impact hero statements. The Chinese landing uses 500 only as an optical correction for denser glyphs.
- Official PDS and Porsche headers keep the main wordmark compact, align utilities on one centerline, and use small line icons or circular icon controls rather than enlarging the brand block.
- Primary radii are 12px for controls and 24px for tiles.
- Fluid spacing runs from `clamp(4px, .25vw + 3px, 8px)` through `clamp(80px, 7.5vw + 56px, 200px)`.
- Motion tokens are 250/400/600/1200ms. The Landing Page uses only the short and moderate values and respects reduced motion.

## Sources

- [Color tokens](https://designsystem.porsche.com/v4/tokens/color/)
- [Font tokens](https://designsystem.porsche.com/v4/tokens/font/)
- [Display usage](https://designsystem.porsche.com/v4/components/display/usage/)
- [Icon](https://designsystem.porsche.com/v4/components/icon/configurator/)
- [Porsche homepage](https://www.porsche.com/)
- [Border tokens](https://designsystem.porsche.com/v4/tokens/border/)
- [Spacing tokens](https://designsystem.porsche.com/v4/tokens/spacing/)
- [Motion tokens](https://designsystem.porsche.com/v4/tokens/motion/)
- [Color scheme](https://designsystem.porsche.com/v4/stylesheets/color-scheme/introduction/)
