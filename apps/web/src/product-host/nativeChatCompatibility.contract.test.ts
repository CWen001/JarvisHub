import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const nativeChatSource = fs.readFileSync(new URL('../ui/chat/AiChatDialog.tsx', import.meta.url), 'utf8')

const productImplementationTokens = [
  'registerAgentWorkspaceChatIntegration',
  'NATIVE_ARTIFACT_CHAT_COMMAND',
  'NATIVE_CHAT_NAVIGATION_COMMAND',
  "command.type === 'reference.add'",
  "command.type === 'session.select'",
]

describe('Native Chat Upstream Compatibility Surface', () => {
  it('retains one native adapter without Product command implementation', () => {
    expect(nativeChatSource).toContain('useNativeChatWorkspaceAdapter({')
    expect(nativeChatSource).toContain('export function NativeChatAuthorityHost')
    expect(nativeChatSource.match(/from '\.\.\/\.\.\/product-host\//g)).toHaveLength(1)
    for (const token of productImplementationTokens) expect(nativeChatSource).not.toContain(token)
  })

  it('keeps Authority lifecycle available without native presentation DOM', () => {
    expect(nativeChatSource).toContain("const headless = presentation === 'none'")
    expect(nativeChatSource).toContain('if (headless) return null')
    expect(nativeChatSource).not.toContain('productMode')
  })
})
