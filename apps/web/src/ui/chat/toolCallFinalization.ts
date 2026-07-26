import type { LiveToolCallRecord } from './liveChatRunStore'

export type UnresolvedToolCallFinalization = {
  status: 'failed'
  message: string
  finishedAtMs: number
}

function normalizeFinishedAtMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : Date.now()
}

export function finalizeRunningToolCall(
  call: LiveToolCallRecord,
  finalization: UnresolvedToolCallFinalization,
): LiveToolCallRecord {
  if (call.status !== 'running') return call
  const finishedAtMs = normalizeFinishedAtMs(finalization.finishedAtMs)
  return {
    ...call,
    status: finalization.status,
    errorMessage: finalization.message.trim() || '对话失败',
    finishedAtMs,
    durationMs: Math.max(0, finishedAtMs - call.startedAtMs),
  }
}

export function finalizeRunningToolCallsByTurn(
  byTurn: Record<string, LiveToolCallRecord[]>,
  finalization: UnresolvedToolCallFinalization,
): Record<string, LiveToolCallRecord[]> {
  let changed = false
  const next: Record<string, LiveToolCallRecord[]> = {}
  for (const [turnId, bucket] of Object.entries(byTurn)) {
    const finalizedBucket = bucket.map((call) => {
      const finalized = finalizeRunningToolCall(call, finalization)
      if (finalized !== call) changed = true
      return finalized
    })
    next[turnId] = finalizedBucket
  }
  return changed ? next : byTurn
}
