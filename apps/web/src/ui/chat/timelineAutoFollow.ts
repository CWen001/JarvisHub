import React from 'react'

export type TimelineAutoFollowState = Readonly<{
  following: boolean
  showJumpToLatest: boolean
}>

export type TimelineAutoFollowResumeReason = 'send' | 'session-change' | 'jump-to-latest' | 'programmatic'

const BOTTOM_THRESHOLD_MIN_PX = 72
const BOTTOM_THRESHOLD_MAX_PX = 160
const BOTTOM_THRESHOLD_RATIO = 0.18

function isViewportNearBottom(element: HTMLDivElement): boolean {
  const distance = Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight)
  const threshold = Math.min(
    BOTTOM_THRESHOLD_MAX_PX,
    Math.max(BOTTOM_THRESHOLD_MIN_PX, Math.round(element.clientHeight * BOTTOM_THRESHOLD_RATIO)),
  )
  return distance <= threshold
}

export function resolveTimelineAutoFollowAfterScroll(isNearBottom: boolean): TimelineAutoFollowState {
  return Object.freeze({
    following: isNearBottom,
    showJumpToLatest: !isNearBottom,
  })
}

export function resumeTimelineAutoFollow(): TimelineAutoFollowState {
  return Object.freeze({ following: true, showJumpToLatest: false })
}

export function useTimelineAutoFollow(viewportRef: React.RefObject<HTMLDivElement>): Readonly<{
  shouldAutoScrollRef: React.MutableRefObject<boolean>
  showJumpToLatest: boolean
  syncFromViewport: () => void
  resume: (reason: TimelineAutoFollowResumeReason) => void
}> {
  const shouldAutoScrollRef = React.useRef(true)
  const [showJumpToLatest, setShowJumpToLatest] = React.useState(false)

  const apply = React.useCallback((state: TimelineAutoFollowState) => {
    shouldAutoScrollRef.current = state.following
    setShowJumpToLatest(state.showJumpToLatest)
  }, [])
  const syncFromViewport = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    apply(resolveTimelineAutoFollowAfterScroll(isViewportNearBottom(viewport)))
  }, [apply, viewportRef])
  const resume = React.useCallback((_reason: TimelineAutoFollowResumeReason) => {
    apply(resumeTimelineAutoFollow())
  }, [apply])

  return { shouldAutoScrollRef, showJumpToLatest, syncFromViewport, resume }
}
