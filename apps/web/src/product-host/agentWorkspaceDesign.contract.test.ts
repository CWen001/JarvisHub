import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const design = fs.readFileSync(new URL('./DESIGN.md', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('./agentWorkspace.css', import.meta.url), 'utf8')
const nativeCss = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

describe('Agent Workspace Design System', () => {
  it('uses one PDS light visual authority and excludes legacy visual directions', () => {
    expect(design).toContain('Porsche Design System v4 light-theme principles')
    expect(design).toContain('Professional Workspace remains upstream-native light')
    expect(design).toContain('No Lamborghini visual language')
    expect(design).toContain('Inter')
    expect(design).toContain('Noto Sans SC')
    expect(design).toContain('No warm-paper, sage, terracotta, brass')
  })

  it('keeps Product color literals inside the centralized token declaration', () => {
    const tokenBlock = css.match(/:root\[data-product-host='true'\]\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(tokenBlock).toContain('--pds-canvas: #ffffff')
    const implementation = css.replace(tokenBlock, '')
    expect(implementation.match(/#[0-9a-f]{3,8}/gi) ?? []).toEqual([])
    expect(implementation).not.toContain('linear-gradient')
    expect(implementation).not.toContain('radial-gradient')
  })

  it('ships full and compact institutional lockups', () => {
    expect(fs.existsSync(new URL('../../public/product-host/hust-design-logo-full.png', import.meta.url))).toBe(true)
    expect(fs.existsSync(new URL('../../public/product-host/hust-design-logo-compact.png', import.meta.url))).toBe(true)
  })

  it('does not retain obsolete Product wrappers over native Chat presentation', () => {
    expect(nativeCss).not.toContain('.tc-ai-chat--product-host')
    expect(nativeCss).not.toContain('.product-history-nav')
    expect(nativeCss).not.toContain('.product-execution-trace-drawer')
    expect(nativeCss).toContain('.product-workspace-return')
  })
})
