import { expect, it } from 'vitest'
import { resolveNativeRetryText } from './chatRetry'

it('replays the nearest preceding native user request for a failed assistant message', () => {
  expect(resolveNativeRetryText([
    { id: 'u1', role: 'user', content: 'first' },
    { id: 'a1', role: 'assistant', content: 'done' },
    { id: 'u2', role: 'user', content: 'generate the watch' },
    { id: 'a2', role: 'assistant', content: 'failed' },
  ], 'a2')).toBe('generate the watch')
})

it('fails closed when the failed message has no preceding user request', () => {
  expect(resolveNativeRetryText([
    { id: 'a1', role: 'assistant', content: 'failed' },
  ], 'a1')).toBeNull()
})
