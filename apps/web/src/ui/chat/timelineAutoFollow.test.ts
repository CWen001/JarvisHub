// @vitest-environment jsdom

import type { RefObject } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  resolveTimelineAutoFollowAfterScroll,
  resumeTimelineAutoFollow,
  useTimelineAutoFollow,
} from './timelineAutoFollow'

describe('Product Timeline auto-follow', () => {
  it('suspends away from the near-bottom threshold and exposes one resume action', () => {
    expect(resolveTimelineAutoFollowAfterScroll(false)).toEqual({
      following: false,
      showJumpToLatest: true,
    })
  })

  it('keeps following near the bottom', () => {
    expect(resolveTimelineAutoFollowAfterScroll(true)).toEqual({
      following: true,
      showJumpToLatest: false,
    })
  })

  it.each(['send', 'session-change', 'jump-to-latest'])('resumes for %s', () => {
    expect(resumeTimelineAutoFollow()).toEqual({
      following: true,
      showJumpToLatest: false,
    })
  })

  it('preserves viewport position while suspending and wires every resume reason', () => {
    const viewport = document.createElement('div')
    let scrollTop = 100
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => { scrollTop = value },
      },
    })
    const viewportRef = { current: viewport } as RefObject<HTMLDivElement>
    const { result } = renderHook(() => useTimelineAutoFollow(viewportRef))

    act(() => result.current.syncFromViewport())
    expect(result.current.shouldAutoScrollRef.current).toBe(false)
    expect(result.current.showJumpToLatest).toBe(true)
    expect(scrollTop).toBe(100)

    for (const reason of ['send', 'session-change', 'jump-to-latest'] as const) {
      act(() => result.current.resume(reason))
      expect(result.current.shouldAutoScrollRef.current).toBe(true)
      expect(result.current.showJumpToLatest).toBe(false)
      scrollTop = 100
      act(() => result.current.syncFromViewport())
    }

    scrollTop = 550
    act(() => result.current.syncFromViewport())
    expect(result.current.shouldAutoScrollRef.current).toBe(true)
    expect(result.current.showJumpToLatest).toBe(false)
  })
})
