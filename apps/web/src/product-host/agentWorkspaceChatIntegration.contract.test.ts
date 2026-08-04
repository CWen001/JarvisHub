import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  executeAgentWorkspaceChatCommand,
  isAgentWorkspaceChatIntegrationReady,
  registerAgentWorkspaceChatIntegration,
} from './agentWorkspaceChatIntegration'

let unregister: (() => void) | null = null

afterEach(() => {
  unregister?.()
  unregister = null
})

describe('Agent Workspace Chat Integration Seam', () => {
  it('routes Product intents through one active Jarvis authority integration', async () => {
    const execute = vi.fn()
    unregister = registerAgentWorkspaceChatIntegration({ execute })

    expect(isAgentWorkspaceChatIntegrationReady()).toBe(true)
    await executeAgentWorkspaceChatCommand({ type: 'request.submit' })
    expect(execute).toHaveBeenCalledWith({ type: 'request.submit' })
  })

  it('fails explicitly while the native authority integration is unavailable', async () => {
    await expect(executeAgentWorkspaceChatCommand({ type: 'request.submit' }))
      .rejects.toThrow('Agent 对话能力尚未就绪')
  })
})
