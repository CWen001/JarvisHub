import type { LiveChatRunRecord, LiveToolCallRecord, LiveToolCallStatus } from './liveChatRunStore'

const TRACE_DEFAULT_TURN_ID = 'trace:all'

type TraceToolCallInput = Record<string, unknown>

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function narrowStatus(value: unknown): LiveToolCallStatus {
  if (
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'denied' ||
    value === 'blocked' ||
    value === 'running'
  ) {
    return value
  }
  return 'succeeded'
}

function readOutputPreview(call: TraceToolCallInput): string {
  const preview = trimString(call.outputPreview)
  if (preview) return preview
  const output = call.output
  if (typeof output === 'string') return output.trim()
  if (output != null) {
    try {
      return JSON.stringify(output, null, 2)
    } catch {
      return String(output)
    }
  }
  return ''
}

function readStartedAtMs(call: TraceToolCallInput, fallback: number): number {
  const atMs = readFiniteNumber(call.atMs)
  if (atMs != null) return atMs
  const startedAt = trimString(call.startedAt)
  if (startedAt) {
    const parsed = Date.parse(startedAt)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function buildToolCallRecordFromTrace(
  call: TraceToolCallInput,
  index: number,
  turnId: string,
): LiveToolCallRecord {
  const startedAtMs = readStartedAtMs(call, index)
  const durationMs = readFiniteNumber(call.durationMs)
  const toolCallIdRaw = trimString(call.toolCallId) || trimString(call.id) || `trace-tool-${index}`
  const toolName = trimString(call.name) || trimString(call.toolName) || 'tool'
  return {
    toolCallId: toolCallIdRaw,
    toolName,
    status: narrowStatus(call.status),
    input: call.input,
    outputJson: readRecord(call.outputJson),
    outputPreview: readOutputPreview(call),
    errorMessage: trimString(call.errorMessage),
    startedAtMs,
    finishedAtMs: durationMs != null ? startedAtMs + durationMs : null,
    durationMs,
    turnId,
  }
}

export type TraceLiveRecord = Pick<LiveChatRunRecord, 'toolCallsByTurn' | 'turnOrder'>

export type TraceAdapterResult = {
  record: TraceLiveRecord
  turnIds: string[]
}

export function buildLiveRecordFromTrace(
  toolCalls: ReadonlyArray<TraceToolCallInput> | null | undefined,
): TraceAdapterResult {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return {
      record: { toolCallsByTurn: {}, turnOrder: [] },
      turnIds: [],
    }
  }
  const entries: LiveToolCallRecord[] = toolCalls.map((call, index) =>
    buildToolCallRecordFromTrace(call, index, TRACE_DEFAULT_TURN_ID),
  )
  entries.sort((a, b) => a.startedAtMs - b.startedAtMs)
  return {
    record: {
      toolCallsByTurn: { [TRACE_DEFAULT_TURN_ID]: entries },
      turnOrder: [TRACE_DEFAULT_TURN_ID],
    },
    turnIds: [TRACE_DEFAULT_TURN_ID],
  }
}
