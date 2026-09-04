import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachNativeChatAuthority,
  executeNativeChatCommand,
  isNativeChatAuthorityReady,
  type NativeChatAuthority,
} from './nativeChatAuthority'

let detach: (() => void) | null = null

afterEach(() => {
  detach?.()
  detach = null
})

describe('Native Chat Authority', () => {
  it('executes commands through one attached lifecycle', async () => {
    const execute = vi.fn()
    detach = attachNativeChatAuthority({ execute })

    expect(isNativeChatAuthorityReady()).toBe(true)
    await executeNativeChatCommand({ type: 'request.submit' })
    expect(execute).toHaveBeenCalledWith({ type: 'request.submit' })
  })

  it('rejects a second lifecycle instead of silently replacing the first', () => {
    const first: NativeChatAuthority = { execute: vi.fn() }
    detach = attachNativeChatAuthority(first)

    expect(() => attachNativeChatAuthority({ execute: vi.fn() }))
      .toThrow('Native Chat Authority 已经挂载')
  })
})
