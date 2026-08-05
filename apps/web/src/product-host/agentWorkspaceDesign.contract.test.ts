import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const design = fs.readFileSync(new URL('./DESIGN.md', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('./agentWorkspace.css', import.meta.url), 'utf8')
const nativeCss = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
const chatSource = fs.readFileSync(new URL('../ui/chat/AiChatDialog.tsx', import.meta.url), 'utf8')
const agentWorkspaceSource = fs.readFileSync(new URL('./AgentWorkspace.tsx', import.meta.url), 'utf8')
const productChatSource = fs.readFileSync(new URL('./ProductChat.tsx', import.meta.url), 'utf8')
const appSource = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

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

  it('pins the Project Context Rail history hierarchy to the approved type scale', () => {
    expect(css).toMatch(/\.project-context-rail__history\s+\.project-context-rail__eyebrow\s*\{[^}]*font-size:\s*12px/)
    expect(css).toMatch(/\.project-context-rail__project-row\s*>\s*button\s*\{[^}]*min-height:\s*44px[^}]*font-size:\s*14px[^}]*font-weight:\s*600/)
    expect(css).toMatch(/\.project-context-rail__sessions\s+button\s*\{[^}]*min-height:\s*36px[^}]*font-size:\s*12px[^}]*font-weight:\s*400/)
  })

  it('keeps decisions inside the sole Product-owned timeline scroll root', () => {
    expect(css).toMatch(/\.product-chat-surface__scroll\s*\{[^}]*overflow:\s*auto/)
    expect(css).toMatch(/\.product-composer-shell\s*\{[^}]*position:\s*absolute/)
    expect(productChatSource).toContain('className="product-decision-card"')
    expect(productChatSource).toContain('className="product-chat-surface__scroll"')
    expect(productChatSource).toContain('展开全部')
  })

  it('uses a confidently sized crest-free Design School lockup at every Agent header size', () => {
    expect(agentWorkspaceSource).toContain('hust-design-logo-wordmark.png')
    expect(agentWorkspaceSource).toContain('hust-design-logo-wordmark-compact.png')
    expect(agentWorkspaceSource).not.toContain('hust-design-logo-full.png')
    expect(css).toMatch(/\.product-host-institution-lockup img\s*\{[^}]*width:\s*248px[^}]*height:\s*56px/)
    expect(css).toMatch(/\.product-host-institution-lockup\s*>\s*small\s*\{[^}]*font-size:\s*14px[^}]*font-weight:\s*600/)
  })

  it('renders Product-owned Agent presentation over a headless native authority seam', () => {
    expect(agentWorkspaceSource).not.toContain('AiChatDialog')
    expect(agentWorkspaceSource).toContain('ProductChat')
    expect(appSource).toContain('<AiChatDialog surface="agent-workspace" headless />')
    expect(appSource).toContain('<AiChatDialog className="app-ai-chat-dialog" surface="native" />')
  })

  it('keeps Product timeline typography, focus, artifacts, and responsive geometry on Product-owned surfaces', () => {
    expect(css).toContain('.agent-workspace-surface button:focus-visible')
    expect(css).toContain('.product-artifact-card > img')
    expect(css).toMatch(/\.product-artifact-card > img,[\s\S]*object-fit:\s*contain/)
    expect(css).not.toContain('.agent-workspace-surface .native-artifact-card')
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.agent-workspace-surface\s*\{\s*--agent-header-height:\s*64px;\s*--agent-rail-width:\s*0px;/)
  })
})
