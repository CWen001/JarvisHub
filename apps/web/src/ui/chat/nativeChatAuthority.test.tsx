// @vitest-environment jsdom

import React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  NativeChatAuthorityProvider,
  useNativeChatAuthority,
  type NativeChatAuthority,
} from './nativeChatAuthority'

function CommandProbe(): JSX.Element {
  const authority = useNativeChatAuthority()
  return <button onClick={() => authority?.execute({ type: 'request.submit' })}>submit</button>
}

describe('Native Chat Authority', () => {
  it('executes commands through the Authority in the current application context', () => {
    const execute = vi.fn()
    const view = render(
      <NativeChatAuthorityProvider authority={{ execute }}>
        <CommandProbe />
      </NativeChatAuthorityProvider>,
    )

    view.getByRole('button', { name: 'submit' }).click()
    expect(execute).toHaveBeenCalledWith({ type: 'request.submit' })
  })

  it('rejects a second lifecycle instead of silently replacing the first', () => {
    const authority: NativeChatAuthority = { execute: vi.fn() }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(
        <NativeChatAuthorityProvider authority={authority}>
          <NativeChatAuthorityProvider authority={authority}>
            <CommandProbe />
          </NativeChatAuthorityProvider>
        </NativeChatAuthorityProvider>,
      )).toThrow('Native Chat Authority 已经挂载')
    } finally {
      consoleError.mockRestore()
    }
  })
})
