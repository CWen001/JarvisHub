import { create } from 'zustand'
import type {
  AgentsChatMediaResultStreamPayload,
  AgentsChatResponseDto,
  AgentsChatStreamEvent,
  AgentsChatToolStreamPayload,
} from '../../api/server'
import { formatAgentsStreamErrorMessage } from './agentsStreamError'
import type { ChatTodoItem } from './chatTodoTypes'
import {
  buildMediaRecordFromToolOutput,
  mediaIdentityMatches,
  shouldApplyMediaRecord,
} from './mediaToolStatus'
import { finalizeRunningToolCallsByTurn } from './toolCallFinalization'

const MAX_LIVE_CHAT_LOGS = 120
const MAX_ASSISTANT_PREVIEW_CHARS = 4_000
const MAX_TOOL_CALL_ENTRIES = 200
const MAX_AGENT_TRACE_ITEMS = 300

type LiveChatRunStatus = 'running' | 'succeeded' | 'failed'

type LiveChatLifecycleEventName =
  | 'thread.started'
  | 'turn.started'
  | 'item.started'
  | 'item.updated'
  | 'item.completed'
  | 'turn.completed'

export type LiveToolCallStatus = 'running' | 'succeeded' | 'failed' | 'denied' | 'blocked'
export type LiveMediaResultStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type LiveToolCallMediaRecord = {
  kind: 'image' | 'video'
  status: LiveMediaResultStatus
  pending: boolean
  nodeId: string
  taskId: string
  progress?: number
  url?: string
  thumbnailUrl?: string
  errorMessage?: string
}

export type LiveToolCallRecord = {
  toolCallId: string
  toolName: string
  status: LiveToolCallStatus
  media?: LiveToolCallMediaRecord
  input?: unknown
  outputJson?: Record<string, unknown>
  outputPreview: string
  errorMessage: string
  startedAtMs: number
  finishedAtMs: number | null
  durationMs: number | null
  turnId: string
  agentId?: string
  agentType?: string
  agentDepth?: number
  parentToolCallId?: string
}

export const PENDING_TOOL_CALL_TURN_ID = '__pending__'

export type LiveChatTodoItem = ChatTodoItem

export type LiveChatLogEntry = {
  id: string
  event: string
  title: string
  detail: string
  at: number
}

export type LiveChatTraceItem =
  | {
    id: string
    kind: 'thinking'
    turnId: string
    turnIndex: number | null
    text: string
    at: number
    parentToolCallId?: string
    agentId?: string
  }
  | {
    id: string
    kind: 'tool'
    turnId: string
    toolCallId: string
    at: number
  }
  | {
    id: string
    kind: 'todo'
    turnId: string
    sourceToolCallId: string
    at: number
    parentToolCallId?: string
    agentId?: string
  }
  | {
    id: string
    kind: 'response'
    turnId: string
    text: string
    at: number
    parentToolCallId?: string
    agentId?: string
  }

export type LiveChatRunRecord = {
  runId: string
  status: LiveChatRunStatus
  requestText: string
  displayText: string
  projectId: string
  projectName: string
  flowId: string
  sessionKey: string
  skillName: string
  requestId: string
  sessionId: string
  userMessageId: string
  assistantMessageId: string
  startedAt: number
  updatedAt: number
  finishedAt: number | null
  errorMessage: string
  doneReason: string
  assistantPreview: string
  assetCount: number
  todoItems: LiveChatTodoItem[]
  logs: LiveChatLogEntry[]
  agentTraceItems: LiveChatTraceItem[]
  toolCallsByTurn: Record<string, LiveToolCallRecord[]>
  turnOrder: string[]
  currentTurnId: string | null
  lastAppliedSeq: number
}

type StartLiveChatRunInput = {
  runId: string
  requestText?: string
  displayText?: string
  projectId?: string
  projectName?: string
  flowId?: string
  sessionKey?: string
  skillName?: string
  userMessageId?: string
  assistantMessageId?: string
}

type LiveChatRunStore = {
  runsBySessionKey: Record<string, LiveChatRunRecord>
  mostRecentSessionKey: string | null
  activeRun: LiveChatRunRecord | null
  startRun: (input: StartLiveChatRunInput) => void
  recordEvent: (sessionKey: string, event: AgentsChatStreamEvent) => void
  completeRun: (sessionKey: string, response: AgentsChatResponseDto, finalReplyText?: string, seq?: number) => void
  failRun: (sessionKey: string, message: string, seq?: number) => void
  clearRun: (sessionKey?: string) => void
}

function resolveSessionStoreKey(input: { sessionKey?: string | null; runId?: string | null }): string {
  const sessionKey = typeof input.sessionKey === 'string' ? input.sessionKey.trim() : ''
  if (sessionKey) return sessionKey
  const runId = typeof input.runId === 'string' ? input.runId.trim() : ''
  return runId
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(text.length - maxChars)
}

function summarizeUnknownRecord(value: Record<string, unknown>): string {
  const pairs = Object.entries(value)
    .map(([key, raw]) => {
      if (raw === null || typeof raw === 'undefined') return ''
      if (typeof raw === 'string') {
        const trimmed = raw.trim()
        return trimmed ? `${key}: ${trimmed}` : ''
      }
      if (typeof raw === 'number' || typeof raw === 'boolean') {
        return `${key}: ${String(raw)}`
      }
      if (Array.isArray(raw)) {
        return raw.length > 0 ? `${key}: [${raw.length}]` : ''
      }
      if (typeof raw === 'object') {
        return `${key}: {…}`
      }
      return ''
    })
    .filter(Boolean)
  return pairs.join('\n')
}

function summarizeLifecycleEvent(event: LiveChatLifecycleEventName, data: Record<string, unknown>): {
  title: string
  detail: string
} {
  switch (event) {
    case 'thread.started':
      return {
        title: 'thread started',
        detail: summarizeUnknownRecord(data),
      }
    case 'turn.started':
      return {
        title: 'turn started',
        detail: summarizeUnknownRecord(data),
      }
    case 'item.started':
      return {
        title: `item started ${trimString(data.itemType || data.type || '')}`.trim(),
        detail: summarizeUnknownRecord(data),
      }
    case 'item.updated':
      return {
        title: `item updated ${trimString(data.itemType || data.type || '')}`.trim(),
        detail: summarizeUnknownRecord(data),
      }
    case 'item.completed':
      return {
        title: `item completed ${trimString(data.itemType || data.type || '')}`.trim(),
        detail: summarizeUnknownRecord(data),
      }
    case 'turn.completed':
      return {
        title: 'turn completed',
        detail: summarizeUnknownRecord(data),
      }
  }
}

function summarizeToolEvent(data: AgentsChatToolStreamPayload): { title: string; detail: string } {
  const toolName = trimString(data.toolName) || 'tool'
  const phase = trimString(data.phase) || 'event'
  const status = trimString(data.status)
  const detailParts = [
    status ? `status: ${status}` : '',
    typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) ? `durationMs: ${data.durationMs}` : '',
    trimString(data.outputPreview),
    trimString(data.errorMessage),
  ].filter(Boolean)
  return {
    title: `${toolName} ${phase}`.trim(),
    detail: detailParts.join('\n'),
  }
}

function parseEpochMs(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function narrowToolStatus(value: unknown, fallback: LiveToolCallStatus): LiveToolCallStatus {
  return value === 'succeeded' ||
    value === 'failed' ||
    value === 'denied' ||
    value === 'blocked' ||
    value === 'running'
    ? value
    : fallback
}

function normalizeMediaProgress(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(0, Math.min(100, Math.trunc(parsed)))
}

function buildMediaRecord(payload: AgentsChatMediaResultStreamPayload): LiveToolCallMediaRecord {
  const progress = normalizeMediaProgress(payload.progress)
  const url = trimString(payload.url)
  const thumbnailUrl = trimString(payload.thumbnailUrl)
  const errorMessage = trimString(payload.errorMessage)
  return {
    kind: payload.kind,
    status: payload.status,
    pending: payload.pending === true || payload.status === 'queued' || payload.status === 'running',
    nodeId: trimString(payload.nodeId),
    taskId: trimString(payload.taskId),
    ...(typeof progress === 'number' ? { progress } : {}),
    ...(url ? { url } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  }
}

function mediaStatusToToolStatus(media: LiveToolCallMediaRecord): LiveToolCallStatus {
  if (media.pending || media.status === 'queued' || media.status === 'running') return 'running'
  if (media.status === 'failed') return 'failed'
  return 'succeeded'
}

function mergeMediaIntoToolCall(
  call: LiveToolCallRecord,
  media: LiveToolCallMediaRecord,
): LiveToolCallRecord {
  if (!shouldApplyMediaRecord(call.media, media)) return call
  return {
    ...call,
    media,
    errorMessage: call.errorMessage || media.errorMessage || '',
  }
}

function applyMediaToMatchingCalls(
  byTurn: Record<string, LiveToolCallRecord[]>,
  media: LiveToolCallMediaRecord,
  sourceToolCallId?: string,
): { byTurn: Record<string, LiveToolCallRecord[]>; matched: boolean } {
  const normalizedToolCallId = trimString(sourceToolCallId)
  let nextByTurn = byTurn
  let matched = false

  for (const turnId of Object.keys(byTurn)) {
    const bucket = byTurn[turnId] ?? []
    let bucketChanged = false
    const nextBucket = bucket.map((entry) => {
      const directMatch = normalizedToolCallId !== '' && entry.toolCallId === normalizedToolCallId
      const identityMatch = mediaIdentityMatches(entry, media)
      if (!directMatch && !identityMatch) return entry
      matched = true
      const updated = mergeMediaIntoToolCall(entry, media)
      if (updated !== entry) bucketChanged = true
      return updated
    })
    if (bucketChanged) {
      if (nextByTurn === byTurn) nextByTurn = { ...byTurn }
      nextByTurn[turnId] = nextBucket
    }
  }

  return { byTurn: nextByTurn, matched }
}

function generateTurnId(seed: string | number): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `turn-${String(seed)}-${Math.random().toString(36).slice(2, 10)}`
}

function countToolCallsAcrossTurns(
  byTurn: Record<string, LiveToolCallRecord[]>,
): number {
  let total = 0
  for (const key of Object.keys(byTurn)) {
    total += byTurn[key]?.length ?? 0
  }
  return total
}

function enforceToolCallCap(
  byTurn: Record<string, LiveToolCallRecord[]>,
  turnOrder: string[],
): { byTurn: Record<string, LiveToolCallRecord[]>; turnOrder: string[] } {
  let nextByTurn = byTurn
  let nextOrder = turnOrder
  while (countToolCallsAcrossTurns(nextByTurn) > MAX_TOOL_CALL_ENTRIES && nextOrder.length > 0) {
    const oldestTurnId = nextOrder[0]
    const { [oldestTurnId]: _drop, ...rest } = nextByTurn
    nextByTurn = rest
    nextOrder = nextOrder.slice(1)
  }
  return { byTurn: nextByTurn, turnOrder: nextOrder }
}

function buildStartedToolCallRecord(
  payload: AgentsChatToolStreamPayload,
  turnId: string,
  nowMs: number,
): LiveToolCallRecord {
  const toolCallId = trimString(payload.toolCallId)
  const toolName = trimString(payload.toolName) || 'tool'
  const startedAtMs = parseEpochMs(payload.startedAt, nowMs)
  return {
    toolCallId: toolCallId || `anon-${startedAtMs}-${Math.random().toString(36).slice(2, 6)}`,
    toolName,
    status: 'running',
    input: payload.input,
    outputJson: payload.outputJson,
    outputPreview: trimString(payload.outputPreview),
    errorMessage: trimString(payload.errorMessage),
    startedAtMs,
    finishedAtMs: null,
    durationMs: null,
    turnId,
    ...(typeof payload.agentId === 'string' && payload.agentId ? { agentId: payload.agentId } : {}),
    ...(typeof payload.agentType === 'string' && payload.agentType ? { agentType: payload.agentType } : {}),
    ...(typeof payload.agentDepth === 'number' ? { agentDepth: payload.agentDepth } : {}),
    ...(typeof payload.parentToolCallId === 'string' && payload.parentToolCallId
      ? { parentToolCallId: payload.parentToolCallId }
      : {}),
  }
}

function applyCompletedToolCallPayload(
  base: LiveToolCallRecord,
  payload: AgentsChatToolStreamPayload,
  nowMs: number,
): LiveToolCallRecord {
  const finishedAtMs = parseEpochMs(payload.finishedAt, nowMs)
  const durationMs =
    typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)
      ? payload.durationMs
      : finishedAtMs - base.startedAtMs
  return {
    ...base,
    status: narrowToolStatus(payload.status, 'succeeded'),
    input: typeof payload.input === 'undefined' ? base.input : payload.input,
    outputJson: payload.outputJson ?? base.outputJson,
    outputPreview: trimString(payload.outputPreview) || base.outputPreview,
    errorMessage: trimString(payload.errorMessage) || base.errorMessage,
    finishedAtMs,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : null,
  }
}

function pickTurnId(currentTurnId: string | null, turnOrder: readonly string[]): string {
  if (currentTurnId) return currentTurnId
  if (turnOrder.length > 0) return turnOrder[turnOrder.length - 1]
  return PENDING_TOOL_CALL_TURN_ID
}

function applyToolEventToBuckets(
  current: {
    byTurn: Record<string, LiveToolCallRecord[]>
    turnOrder: string[]
    currentTurnId: string | null
  },
  payload: AgentsChatToolStreamPayload,
  nowMs: number,
): {
  byTurn: Record<string, LiveToolCallRecord[]>
  turnOrder: string[]
} {
  const toolCallId = trimString(payload.toolCallId)
  const phase = trimString(payload.phase)
  const { byTurn, turnOrder, currentTurnId } = current

  if (phase === 'started') {
    const turnId = pickTurnId(currentTurnId, turnOrder)
    const record = buildStartedToolCallRecord(payload, turnId, nowMs)
    const existingBucket = byTurn[turnId] ?? []
    const nextBucket = [...existingBucket, record].sort(
      (a, b) => a.startedAtMs - b.startedAtMs,
    )
    const nextByTurn = { ...byTurn, [turnId]: nextBucket }
    const nextOrder = turnOrder.includes(turnId) ? turnOrder : [...turnOrder, turnId]
    return enforceToolCallCap(nextByTurn, nextOrder)
  }

  if (phase === 'completed') {
    const nextByTurn: Record<string, LiveToolCallRecord[]> = { ...byTurn }
    let foundTurnId: string | null = null
    let foundIndex = -1
    if (toolCallId) {
      for (const turnId of turnOrder) {
        const bucket = nextByTurn[turnId]
        if (!bucket) continue
        const idx = bucket.findIndex((entry) => entry.toolCallId === toolCallId)
        if (idx >= 0) {
          foundTurnId = turnId
          foundIndex = idx
          break
        }
      }
    }

    if (foundTurnId && foundIndex >= 0) {
      const bucket = nextByTurn[foundTurnId]
      const base = bucket[foundIndex]
      const updated = applyCompletedToolCallPayload(base, payload, nowMs)
      const shouldMigrate =
        foundTurnId === PENDING_TOOL_CALL_TURN_ID &&
        currentTurnId &&
        currentTurnId !== PENDING_TOOL_CALL_TURN_ID
      if (shouldMigrate) {
        const sourceBucket = bucket.filter((_, i) => i !== foundIndex)
        if (sourceBucket.length > 0) {
          nextByTurn[foundTurnId] = sourceBucket
        } else {
          delete nextByTurn[foundTurnId]
        }
        const targetBucket = nextByTurn[currentTurnId] ?? []
        nextByTurn[currentTurnId] = [...targetBucket, { ...updated, turnId: currentTurnId }].sort(
          (a, b) => a.startedAtMs - b.startedAtMs,
        )
      } else {
        nextByTurn[foundTurnId] = bucket.map((entry, idx) => (idx === foundIndex ? updated : entry))
      }
      const nextOrder =
        shouldMigrate && !turnOrder.includes(currentTurnId as string)
          ? [...turnOrder, currentTurnId as string]
          : turnOrder
      const prunedOrder =
        shouldMigrate && !(PENDING_TOOL_CALL_TURN_ID in nextByTurn)
          ? nextOrder.filter((id) => id !== PENDING_TOOL_CALL_TURN_ID)
          : nextOrder
      const media = buildMediaRecordFromToolOutput(updated.toolName, updated.outputJson)
      const reconciledByTurn = media
        ? applyMediaToMatchingCalls(nextByTurn, media, updated.toolCallId).byTurn
        : nextByTurn
      return enforceToolCallCap(reconciledByTurn, prunedOrder)
    }

    const turnId = pickTurnId(currentTurnId, turnOrder)
    const started = buildStartedToolCallRecord(payload, turnId, nowMs)
    const fallback = applyCompletedToolCallPayload(started, payload, nowMs)
    const bucket = nextByTurn[turnId] ?? []
    nextByTurn[turnId] = [...bucket, fallback].sort((a, b) => a.startedAtMs - b.startedAtMs)
    const nextOrder = turnOrder.includes(turnId) ? turnOrder : [...turnOrder, turnId]
    const media = buildMediaRecordFromToolOutput(fallback.toolName, fallback.outputJson)
    const reconciledByTurn = media
      ? applyMediaToMatchingCalls(nextByTurn, media, fallback.toolCallId).byTurn
      : nextByTurn
    return enforceToolCallCap(reconciledByTurn, nextOrder)
  }

  return { byTurn, turnOrder }
}

function applyMediaResultEventToBuckets(
  current: {
    byTurn: Record<string, LiveToolCallRecord[]>
    turnOrder: string[]
    currentTurnId: string | null
  },
  payload: AgentsChatMediaResultStreamPayload,
  nowMs: number,
): {
  byTurn: Record<string, LiveToolCallRecord[]>
  turnOrder: string[]
} {
  const toolCallId = trimString(payload.toolCallId)
  const media = buildMediaRecord(payload)
  const nextByTurn: Record<string, LiveToolCallRecord[]> = { ...current.byTurn }
  const { byTurn: reconciledByTurn, matched } = applyMediaToMatchingCalls(
    nextByTurn,
    media,
    toolCallId,
  )

  if (matched) return { byTurn: reconciledByTurn, turnOrder: current.turnOrder }

  const turnId = pickTurnId(current.currentTurnId, current.turnOrder)
  const startedAtMs = parseEpochMs(payload.emittedAt, nowMs)
  const status = mediaStatusToToolStatus(media)
  const fallbackToolCallId = toolCallId || media.taskId || media.nodeId
  if (!fallbackToolCallId) return { byTurn: current.byTurn, turnOrder: current.turnOrder }
  const fallback: LiveToolCallRecord = {
    toolCallId: fallbackToolCallId,
    toolName: trimString(payload.toolName) || 'media_result',
    status,
    media,
    outputPreview: '',
    errorMessage: media.errorMessage ?? '',
    startedAtMs,
    finishedAtMs: status === 'running' ? null : startedAtMs,
    durationMs: null,
    turnId,
  }
  const bucket = nextByTurn[turnId] ?? []
  nextByTurn[turnId] = [...bucket, fallback].sort((a, b) => a.startedAtMs - b.startedAtMs)
  const nextOrder = current.turnOrder.includes(turnId) ? current.turnOrder : [...current.turnOrder, turnId]
  return enforceToolCallCap(nextByTurn, nextOrder)
}

function readTurnIdFromEvent(data: Record<string, unknown>, fallbackSeed: number): string {
  const raw = trimString(data.turnId)
  if (raw) return raw
  const nested = data.turn
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const nestedId = trimString((nested as Record<string, unknown>).id)
    if (nestedId) return nestedId
  }
  return generateTurnId(fallbackSeed)
}

function summarizeTodoItems(items: LiveChatTodoItem[]): string {
  if (!items.length) return ''
  return items
    .slice(0, 8)
    .map((item) => `[${item.status}] ${item.content}`)
    .join('\n')
}

function normalizeTodoItems(input: unknown): LiveChatTodoItem[] {
  if (!Array.isArray(input)) return []
  const items: LiveChatTodoItem[] = []
  for (const entry of input) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const content = trimString(record.text) || trimString(record.content)
    if (!content) continue
    const statusRaw = trimString(record.status)
    const status: LiveChatTodoItem['status'] =
      statusRaw === 'completed' ||
      statusRaw === 'in_progress' ||
      statusRaw === 'waiting' ||
      statusRaw === 'blocked' ||
      statusRaw === 'pending'
        ? statusRaw
        : record.completed === true
          ? 'completed'
          : 'pending'
    items.push({ content, status })
    if (items.length >= 20) break
  }
  return items
}

function buildLogEntry(event: string, title: string, detail: string): LiveChatLogEntry {
  const now = Date.now()
  return {
    id: `${event}-${now}-${Math.random().toString(36).slice(2, 8)}`,
    event,
    title: title || event,
    detail,
    at: now,
  }
}

function pushLog(logs: LiveChatLogEntry[], next: LiveChatLogEntry): LiveChatLogEntry[] {
  const merged = [...logs, next]
  if (merged.length <= MAX_LIVE_CHAT_LOGS) return merged
  return merged.slice(merged.length - MAX_LIVE_CHAT_LOGS)
}

function pushAgentTraceItem(items: LiveChatTraceItem[], next: LiveChatTraceItem): LiveChatTraceItem[] {
  const merged = [...items, next]
  if (merged.length <= MAX_AGENT_TRACE_ITEMS) return merged
  return merged.slice(merged.length - MAX_AGENT_TRACE_ITEMS)
}

function upsertThinkingTraceItem(
  items: LiveChatTraceItem[],
  next: Extract<LiveChatTraceItem, { kind: 'thinking' }>,
): LiveChatTraceItem[] {
  const existingIndex = items.findIndex((item) =>
    item.kind === 'thinking' &&
    item.turnId === next.turnId &&
    item.turnIndex === next.turnIndex &&
    (item.agentId ?? null) === (next.agentId ?? null))
  if (existingIndex >= 0) {
    return items.map((item, index) => {
      if (index !== existingIndex || item.kind !== 'thinking') return item
      return { ...item, text: next.text, at: next.at }
    })
  }
  return pushAgentTraceItem(items, next)
}

function migratePendingTraceItems(items: LiveChatTraceItem[], turnId: string): LiveChatTraceItem[] {
  return items.map((item) => {
    if (item.turnId !== PENDING_TOOL_CALL_TURN_ID) return item
    if (item.kind === 'thinking') return { ...item, turnId }
    if (item.kind === 'tool') return { ...item, turnId }
    if (item.kind === 'todo') return { ...item, turnId }
    if (item.kind === 'response') return { ...item, turnId }
    return item
  })
}

function readOptionalTurnIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null
}

function findToolCallTurnId(
  byTurn: Record<string, LiveToolCallRecord[]>,
  toolCallId: string,
  fallback: string,
): string {
  for (const turnId of Object.keys(byTurn)) {
    const bucket = byTurn[turnId]
    if (bucket?.some((call) => call.toolCallId === toolCallId)) return turnId
  }
  return fallback
}

function upsertToolTraceItem(input: {
  items: LiveChatTraceItem[]
  byTurn: Record<string, LiveToolCallRecord[]>
  toolCallId: string
  fallbackTurnId: string
  nowMs: number
}): LiveChatTraceItem[] {
  const toolCallId = trimString(input.toolCallId)
  if (!toolCallId) return input.items
  const turnId = findToolCallTurnId(input.byTurn, toolCallId, input.fallbackTurnId)
  const existingIndex = input.items.findIndex(
    (item) => item.kind === 'tool' && item.toolCallId === toolCallId,
  )
  if (existingIndex >= 0) {
    return input.items.map((item, index) => {
      if (index !== existingIndex || item.kind !== 'tool') return item
      return { ...item, turnId }
    })
  }
  return pushAgentTraceItem(input.items, {
    id: `tool:${toolCallId}`,
    kind: 'tool',
    toolCallId,
    turnId,
    at: input.nowMs,
  })
}

function upsertTodoTraceItem(input: {
  items: LiveChatTraceItem[]
  sourceToolCallId: string
  turnId: string
  nowMs: number
  parentToolCallId?: string
  agentId?: string
}): LiveChatTraceItem[] {
  const sourceToolCallId = trimString(input.sourceToolCallId) || 'todo'
  const turnId = trimString(input.turnId) || PENDING_TOOL_CALL_TURN_ID
  const parentToolCallId = input.parentToolCallId
  const agentId = input.agentId
  const existingIndex = input.items.findIndex(
    (item) => item.kind === 'todo' && (item.agentId ?? null) === (agentId ?? null),
  )
  const idSuffix = agentId ? `:${agentId}` : ''
  if (existingIndex >= 0) {
    return input.items.map((item, index) => {
      if (index !== existingIndex || item.kind !== 'todo') return item
      return {
        ...item,
        id: `todo:${sourceToolCallId}${idSuffix}`,
        sourceToolCallId,
        turnId,
        at: input.nowMs,
        ...(parentToolCallId ? { parentToolCallId } : {}),
        ...(agentId ? { agentId } : {}),
      }
    })
  }
  return pushAgentTraceItem(input.items, {
    id: `todo:${sourceToolCallId}${idSuffix}`,
    kind: 'todo',
    sourceToolCallId,
    turnId,
    at: input.nowMs,
    ...(parentToolCallId ? { parentToolCallId } : {}),
    ...(agentId ? { agentId } : {}),
  })
}

function upsertResponseTraceItem(
  items: LiveChatTraceItem[],
  text: string,
  nowMs: number,
  turnId: string,
  parentToolCallId?: string,
  agentId?: string,
): LiveChatTraceItem[] {
  const responseText = trimString(text)
  if (!responseText) return items
  const resolvedTurnId = trimString(turnId) || PENDING_TOOL_CALL_TURN_ID
  const normalizedParentId = parentToolCallId && parentToolCallId.length > 0 ? parentToolCallId : null
  const existingIndex = items.findIndex(
    (item) => item.kind === 'response' && (item.parentToolCallId ?? null) === normalizedParentId,
  )
  if (existingIndex >= 0) {
    return items.map((item, index) => {
      if (index !== existingIndex || item.kind !== 'response') return item
      return { ...item, text: responseText, at: nowMs, turnId: resolvedTurnId }
    })
  }
  return pushAgentTraceItem(items, {
    id: normalizedParentId ? `response:${normalizedParentId}` : `response:${nowMs}`,
    kind: 'response',
    turnId: resolvedTurnId,
    text: responseText,
    at: nowMs,
    ...(normalizedParentId ? { parentToolCallId: normalizedParentId } : {}),
    ...(agentId && agentId.length > 0 ? { agentId } : {}),
  })
}

function resolveTrailingTurnId(run: Pick<LiveChatRunRecord, 'currentTurnId' | 'turnOrder'>): string {
  if (run.currentTurnId) return run.currentTurnId
  if (run.turnOrder.length > 0) return run.turnOrder[run.turnOrder.length - 1]
  return PENDING_TOOL_CALL_TURN_ID
}

function readResponseAssetCount(response: AgentsChatResponseDto): number {
  return Array.isArray(response.assets) ? response.assets.length : 0
}

function mutateSessionRun(
  state: LiveChatRunStore,
  sessionKey: string,
  updater: (run: LiveChatRunRecord) => LiveChatRunRecord,
  opts?: { seq?: number },
): Partial<LiveChatRunStore> {
  const key = trimString(sessionKey)
  if (!key) return {}
  const existing = state.runsBySessionKey[key]
  if (!existing) return {}
  const seq = opts?.seq
  if (typeof seq === 'number' && seq <= existing.lastAppliedSeq) return {}
  const updated = updater(existing)
  const next =
    typeof seq === 'number' && updated !== existing && updated.lastAppliedSeq !== seq
      ? { ...updated, lastAppliedSeq: seq }
      : updated
  const runsBySessionKey =
    next === existing
      ? state.runsBySessionKey
      : { ...state.runsBySessionKey, [key]: next }
  return {
    runsBySessionKey,
    mostRecentSessionKey: key,
    activeRun: next,
  }
}

export const useLiveChatRunStore = create<LiveChatRunStore>((set) => ({
  runsBySessionKey: {},
  mostRecentSessionKey: null,
  activeRun: null,
  startRun: (input) =>
    set((state) => {
      const storeKey = resolveSessionStoreKey({
        sessionKey: input.sessionKey,
        runId: input.runId,
      })
      if (!storeKey) return state
      const runId = trimString(input.runId) || `live-chat-${Date.now()}`
      const existing = state.runsBySessionKey[storeKey]
      if (existing && existing.runId === runId) {
        // 幂等：相同 runId 已在跑，保留累积的 trace / toolCalls / lastAppliedSeq
        return state
      }
      const incomingAssistantMessageId = trimString(input.assistantMessageId)
      if (
        existing &&
        existing.status === 'running' &&
        incomingAssistantMessageId !== '' &&
        incomingAssistantMessageId === existing.assistantMessageId
      ) {
        // 同一条 assistant 消息的 runId 切换（pendingId → durableRunId）：
        // 保留累积；assistantMessageId 不同 = 新一轮新消息，落到下面 fresh record。
        const patched: LiveChatRunRecord = {
          ...existing,
          runId,
          requestText: trimString(input.requestText) || existing.requestText,
          displayText: trimString(input.displayText) || existing.displayText,
          projectId: trimString(input.projectId) || existing.projectId,
          projectName: trimString(input.projectName) || existing.projectName,
          flowId: trimString(input.flowId) || existing.flowId,
          sessionKey: trimString(input.sessionKey) || existing.sessionKey,
          skillName: trimString(input.skillName) || existing.skillName,
          userMessageId: trimString(input.userMessageId) || existing.userMessageId,
          assistantMessageId: trimString(input.assistantMessageId) || existing.assistantMessageId,
          updatedAt: Date.now(),
        }
        return {
          runsBySessionKey: { ...state.runsBySessionKey, [storeKey]: patched },
          mostRecentSessionKey: storeKey,
          activeRun: patched,
        }
      }
      const startedAt = Date.now()
      const next: LiveChatRunRecord = {
        runId,
        status: 'running',
        requestText: trimString(input.requestText),
        displayText: trimString(input.displayText),
        projectId: trimString(input.projectId),
        projectName: trimString(input.projectName),
        flowId: trimString(input.flowId),
        sessionKey: trimString(input.sessionKey),
        skillName: trimString(input.skillName),
        requestId: '',
        sessionId: '',
        userMessageId: trimString(input.userMessageId),
        assistantMessageId: trimString(input.assistantMessageId) || runId,
        startedAt,
        updatedAt: startedAt,
        finishedAt: null,
        errorMessage: '',
        doneReason: '',
        assistantPreview: '',
        assetCount: 0,
        todoItems: [],
        logs: [
          buildLogEntry(
            'run.started',
            'chat started',
            [
              trimString(input.displayText) || trimString(input.requestText),
              trimString(input.projectName),
              trimString(input.skillName),
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        ],
        agentTraceItems: [],
        toolCallsByTurn: {},
        turnOrder: [],
        currentTurnId: null,
        lastAppliedSeq: 0,
      }
      return {
        runsBySessionKey: { ...state.runsBySessionKey, [storeKey]: next },
        mostRecentSessionKey: storeKey,
        activeRun: next,
      }
    }),
  recordEvent: (sessionKey, event) =>
    set((state) =>
      mutateSessionRun(state, sessionKey, (run) => {
        const updatedAt = Date.now()

        if (event.event === 'initial') {
          const serverRunId = trimString(event.data.runId)
          return {
            ...run,
            runId: serverRunId || run.runId,
            requestId: trimString(event.data.requestId),
            userMessageId: trimString(event.data.messageId),
            updatedAt,
            logs: pushLog(
              run.logs,
              buildLogEntry(
                'initial',
                'request accepted',
                summarizeUnknownRecord(event.data as Record<string, unknown>),
              ),
            ),
          }
        }

        if (event.event === 'session') {
          return {
            ...run,
            sessionId: trimString(event.data.sessionId),
            updatedAt,
            logs: pushLog(
              run.logs,
              buildLogEntry(
                'session',
                'session assigned',
                summarizeUnknownRecord(event.data as Record<string, unknown>),
              ),
            ),
          }
        }

        if (event.event === 'thinking') {
          const text = trimString(event.data.text)
          if (!text) return { ...run, updatedAt }
          const turnId =
            trimString(event.data.turnId) || pickTurnId(run.currentTurnId, run.turnOrder)
          const turnIndex = readOptionalTurnIndex(event.data.turnIndex)
          const parentToolCallId =
            typeof event.data.parentToolCallId === 'string' && event.data.parentToolCallId.length > 0
              ? event.data.parentToolCallId
              : undefined
          const agentId =
            typeof event.data.agentId === 'string' && event.data.agentId.length > 0
              ? event.data.agentId
              : undefined
          return {
            ...run,
            updatedAt,
            agentTraceItems: upsertThinkingTraceItem(run.agentTraceItems, {
              id: `thinking:${turnId}:${turnIndex ?? run.agentTraceItems.length}${agentId ? `:${agentId}` : ''}`,
              kind: 'thinking',
              turnId,
              turnIndex,
              text,
              at: updatedAt,
              ...(parentToolCallId ? { parentToolCallId } : {}),
              ...(agentId ? { agentId } : {}),
            }),
            logs: pushLog(run.logs, buildLogEntry('thinking', 'thinking', text)),
          }
        }

        if (event.event === 'tool') {
          const summary = summarizeToolEvent(event.data)
          const { byTurn, turnOrder } = applyToolEventToBuckets(
            {
              byTurn: run.toolCallsByTurn,
              turnOrder: run.turnOrder,
              currentTurnId: run.currentTurnId,
            },
            event.data,
            updatedAt,
          )
          const toolCallId = trimString(event.data.toolCallId)
          const fallbackTurnId = pickTurnId(run.currentTurnId, run.turnOrder)
          const isAskUserTool = trimString(event.data.toolName) === 'ask_user'
          return {
            ...run,
            updatedAt,
            toolCallsByTurn: byTurn,
            turnOrder,
            agentTraceItems: isAskUserTool
              ? run.agentTraceItems
              : upsertToolTraceItem({
                items: run.agentTraceItems,
                byTurn,
                toolCallId,
                fallbackTurnId,
                nowMs: updatedAt,
              }),
            logs: pushLog(run.logs, buildLogEntry('tool', summary.title, summary.detail)),
          }
        }

        if (event.event === 'media_result') {
          const { byTurn, turnOrder } = applyMediaResultEventToBuckets(
            {
              byTurn: run.toolCallsByTurn,
              turnOrder: run.turnOrder,
              currentTurnId: run.currentTurnId,
            },
            event.data,
            updatedAt,
          )
          const toolCallId = trimString(event.data.toolCallId)
          const fallbackTurnId = pickTurnId(run.currentTurnId, run.turnOrder)
          const detail = [
            `kind: ${event.data.kind}`,
            `status: ${event.data.status}`,
            typeof event.data.progress === 'number' ? `progress: ${event.data.progress}` : '',
            trimString(event.data.errorMessage),
          ].filter(Boolean).join('\n')
          return {
            ...run,
            updatedAt,
            toolCallsByTurn: byTurn,
            turnOrder,
            agentTraceItems: upsertToolTraceItem({
              items: run.agentTraceItems,
              byTurn,
              toolCallId,
              fallbackTurnId,
              nowMs: updatedAt,
            }),
            logs: pushLog(
              run.logs,
              buildLogEntry('media_result', `${event.data.toolName} ${event.data.status}`, detail),
            ),
          }
        }

        if (event.event === 'todo_list') {
          const todoItems = normalizeTodoItems(event.data.items)
          if (todoItems.length === 0) return { ...run, updatedAt }
          const turnId =
            trimString(event.data.turnId) || pickTurnId(run.currentTurnId, run.turnOrder)
          const fromSubagent =
            typeof event.data.agentId === 'string' && event.data.agentId.length > 0
          const parentToolCallId =
            typeof event.data.parentToolCallId === 'string' && event.data.parentToolCallId.length > 0
              ? event.data.parentToolCallId
              : undefined
          const agentId =
            typeof event.data.agentId === 'string' && event.data.agentId.length > 0
              ? event.data.agentId
              : undefined
          const nextAgentTraceItems = upsertTodoTraceItem({
            items: run.agentTraceItems,
            sourceToolCallId: event.data.sourceToolCallId,
            turnId,
            nowMs: updatedAt,
            ...(parentToolCallId ? { parentToolCallId } : {}),
            ...(agentId ? { agentId } : {}),
          })
          if (fromSubagent) {
            return {
              ...run,
              updatedAt,
              agentTraceItems: nextAgentTraceItems,
            }
          }
          return {
            ...run,
            updatedAt,
            todoItems,
            agentTraceItems: nextAgentTraceItems,
            logs: pushLog(
              run.logs,
              buildLogEntry(
                'todo_list',
                `todo ${event.data.completedCount}/${event.data.totalCount}`,
                summarizeTodoItems(todoItems),
              ),
            ),
          }
        }

        if (event.event === 'content') {
          const delta = typeof event.data.delta === 'string' ? event.data.delta : ''
          const parentToolCallId =
            typeof event.data.parentToolCallId === 'string' && event.data.parentToolCallId.length > 0
              ? event.data.parentToolCallId
              : undefined
          if (parentToolCallId) {
            const agentId =
              typeof event.data.agentId === 'string' && event.data.agentId.length > 0
                ? event.data.agentId
                : undefined
            return {
              ...run,
              updatedAt,
              agentTraceItems: upsertResponseTraceItem(
                run.agentTraceItems,
                delta,
                updatedAt,
                pickTurnId(run.currentTurnId, run.turnOrder),
                parentToolCallId,
                agentId,
              ),
            }
          }
          const assistantPreview = clipText(
            `${run.assistantPreview}${delta}`,
            MAX_ASSISTANT_PREVIEW_CHARS,
          )
          return { ...run, updatedAt, assistantPreview }
        }

        if (
          event.event === 'thread.started' ||
          event.event === 'turn.started' ||
          event.event === 'item.started' ||
          event.event === 'item.updated' ||
          event.event === 'item.completed' ||
          event.event === 'turn.completed'
        ) {
          const summary = summarizeLifecycleEvent(event.event, event.data)
          if (event.event === 'turn.started') {
            const data = event.data as Record<string, unknown>
            const turnId = readTurnIdFromEvent(data, updatedAt)
            const alreadyInOrder = run.turnOrder.includes(turnId)
            const nextTurnOrder = alreadyInOrder ? run.turnOrder : [...run.turnOrder, turnId]
            const nextByTurn = run.toolCallsByTurn[turnId]
              ? run.toolCallsByTurn
              : { ...run.toolCallsByTurn, [turnId]: [] }
            return {
              ...run,
              updatedAt,
              currentTurnId: turnId,
              turnOrder: nextTurnOrder,
              toolCallsByTurn: nextByTurn,
              agentTraceItems: migratePendingTraceItems(run.agentTraceItems, turnId),
              logs: pushLog(run.logs, buildLogEntry(event.event, summary.title, summary.detail)),
            }
          }
          if (event.event === 'turn.completed') {
            return {
              ...run,
              updatedAt,
              currentTurnId: null,
              logs: pushLog(run.logs, buildLogEntry(event.event, summary.title, summary.detail)),
            }
          }
          return {
            ...run,
            updatedAt,
            logs: pushLog(run.logs, buildLogEntry(event.event, summary.title, summary.detail)),
          }
        }

        if (event.event === 'done') {
          const reason = trimString(event.data.reason)
          const isFailureReason = reason === 'error' || reason === 'aborted' || reason === 'stale_timeout'
          const status: LiveChatRunStatus = isFailureReason ? 'failed' : 'succeeded'
          return {
            ...run,
            status,
            updatedAt,
            finishedAt: updatedAt,
            doneReason: reason,
            toolCallsByTurn: isFailureReason
              ? finalizeRunningToolCallsByTurn(run.toolCallsByTurn, {
                status: 'failed',
                message: reason || '对话失败',
                finishedAtMs: updatedAt,
              })
              : run.toolCallsByTurn,
            logs: pushLog(
              run.logs,
              buildLogEntry(
                'done',
                `stream done ${reason || 'finished'}`.trim(),
                '',
              ),
            ),
          }
        }

        if (event.event === 'error') {
          const message = formatAgentsStreamErrorMessage(event.data)
          return {
            ...run,
            status: 'failed',
            updatedAt,
            finishedAt: updatedAt,
            errorMessage: message,
            toolCallsByTurn: finalizeRunningToolCallsByTurn(run.toolCallsByTurn, {
              status: 'failed',
              message,
              finishedAtMs: updatedAt,
            }),
            logs: pushLog(run.logs, buildLogEntry('error', 'stream error', message)),
          }
        }

        if (event.event === 'result') {
          const responseText = trimString(event.data.response?.text)
          return {
            ...run,
            status: 'succeeded',
            updatedAt,
            finishedAt: updatedAt,
            assistantPreview: clipText(
              responseText || run.assistantPreview,
              MAX_ASSISTANT_PREVIEW_CHARS,
            ),
            assetCount: readResponseAssetCount(event.data.response),
            agentTraceItems: upsertResponseTraceItem(
              run.agentTraceItems,
              responseText,
              updatedAt,
              resolveTrailingTurnId(run),
            ),
            logs: pushLog(
              run.logs,
              buildLogEntry(
                'result',
                'result received',
                `assets: ${readResponseAssetCount(event.data.response)}`,
              ),
            ),
          }
        }

        return { ...run, updatedAt }
      }, { seq: event.seq }),
    ),
  completeRun: (sessionKey, response, finalReplyText, seq) =>
    set((state) =>
      mutateSessionRun(state, sessionKey, (run) => {
        if (run.status === 'succeeded' || run.status === 'failed') return run
        const finishedAt = Date.now()
        const previewSource =
          trimString(finalReplyText) || trimString(response.text) || run.assistantPreview
        return {
          ...run,
          status: 'succeeded',
          updatedAt: finishedAt,
          finishedAt,
          errorMessage: '',
          assistantPreview: clipText(previewSource, MAX_ASSISTANT_PREVIEW_CHARS),
          assetCount: readResponseAssetCount(response),
          agentTraceItems: upsertResponseTraceItem(
            run.agentTraceItems,
            previewSource,
            finishedAt,
            resolveTrailingTurnId(run),
          ),
          logs: pushLog(
            run.logs,
            buildLogEntry(
              'run.completed',
              'chat completed',
              `assets: ${readResponseAssetCount(response)}\noutputMode: ${trimString(response.trace?.outputMode)}`,
            ),
          ),
        }
      }, { seq }),
    ),
  failRun: (sessionKey, message, seq) =>
    set((state) =>
      mutateSessionRun(state, sessionKey, (run) => {
        if (run.status === 'succeeded' || run.status === 'failed') return run
        const finishedAt = Date.now()
        const normalized = trimString(message) || '对话失败'
        return {
          ...run,
          status: 'failed',
          updatedAt: finishedAt,
          finishedAt,
          errorMessage: normalized,
          toolCallsByTurn: finalizeRunningToolCallsByTurn(run.toolCallsByTurn, {
            status: 'failed',
            message: normalized,
            finishedAtMs: finishedAt,
          }),
          logs: pushLog(run.logs, buildLogEntry('run.failed', 'chat failed', normalized)),
        }
      }, { seq }),
    ),
  clearRun: (sessionKey) =>
    set((state) => {
      const key = trimString(sessionKey)
      if (!key) {
        return { runsBySessionKey: {}, mostRecentSessionKey: null, activeRun: null }
      }
      if (!(key in state.runsBySessionKey)) return state
      const { [key]: _drop, ...rest } = state.runsBySessionKey
      const fallbackKey =
        state.mostRecentSessionKey && state.mostRecentSessionKey !== key
          ? state.mostRecentSessionKey
          : Object.keys(rest)[0] ?? null
      return {
        runsBySessionKey: rest,
        mostRecentSessionKey: fallbackKey,
        activeRun: fallbackKey ? rest[fallbackKey] ?? null : null,
      }
    }),
}))

export function readLiveChatRunBySessionKey(sessionKey: string): LiveChatRunRecord | null {
  const key = trimString(sessionKey)
  if (!key) return null
  return useLiveChatRunStore.getState().runsBySessionKey[key] ?? null
}
