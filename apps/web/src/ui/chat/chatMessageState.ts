import { PENDING_TOOL_CALL_TURN_ID, type LiveChatRunRecord, type LiveChatTraceItem, type LiveToolCallMediaRecord, type LiveToolCallRecord } from './liveChatRunStore'
import type { ChatAskUserPrompt } from './askUserPrompt'
import { finalizeRunningToolCall, type UnresolvedToolCallFinalization } from './toolCallFinalization'

export type ChatMessageToolCallSnapshot = {
  turnIds: string[]
  record: Pick<LiveChatRunRecord, 'toolCallsByTurn'>
}

export type ChatMessageAgentTraceSnapshot = {
  items: LiveChatTraceItem[]
}

type ChatMessageAssetLike = {
  title?: string
  url?: string
  thumbnailUrl?: string
}

type ChatMessageTodoLike = {
  status: string
  content: string
}

type LoadedChatMessageTodoSnapshotItem = {
  status: 'pending' | 'in_progress' | 'waiting' | 'blocked' | 'completed'
  content: string
}

type LoadedChatMessageDiagnosticFlag = {
  code: string
  severity: 'high' | 'medium'
  title: string
  detail: string
}

type LoadedChatMessageTurnVerdict = {
  status: 'satisfied' | 'partial' | 'failed'
  reasons: string[]
}

export type LoadedChatMessageUiSnapshot = {
  todoSnapshot?: LoadedChatMessageTodoSnapshotItem[]
  toolCallSnapshot?: ChatMessageToolCallSnapshot
  agentTraceSnapshot?: ChatMessageAgentTraceSnapshot
  diagnosticFlags?: LoadedChatMessageDiagnosticFlag[]
  turnVerdict?: LoadedChatMessageTurnVerdict
}

export type MergeableChatMessage = {
  id: string
  role: 'assistant' | 'user'
  content: string
  phase?: 'thinking' | 'final'
  kind?: 'progress' | 'result' | 'error'
  skillMention?: string
  assets?: ChatMessageAssetLike[]
  todoSnapshot?: ChatMessageTodoLike[]
  toolCallSnapshot?: ChatMessageToolCallSnapshot
  agentTraceSnapshot?: ChatMessageAgentTraceSnapshot
  diagnosticFlags?: unknown[]
  turnVerdict?: {
    status: 'satisfied' | 'partial' | 'failed'
    reasons: string[]
  }
  askUserPrompt?: ChatAskUserPrompt
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTodoStatus(value: unknown): LoadedChatMessageTodoSnapshotItem['status'] | null {
  return value === 'pending' ||
    value === 'in_progress' ||
    value === 'waiting' ||
    value === 'blocked' ||
    value === 'completed'
    ? value
    : null
}

function normalizeLoadedTodoSnapshot(value: unknown): LoadedChatMessageTodoSnapshotItem[] {
  if (!Array.isArray(value)) return []
  const out: LoadedChatMessageTodoSnapshotItem[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    const status = normalizeTodoStatus(record.status)
    const content = readTrimmedString(record.content)
    if (!status || !content) continue
    out.push({ status, content })
    if (out.length >= 20) break
  }
  return out
}

function normalizeLoadedTurnVerdict(value: unknown): LoadedChatMessageTurnVerdict | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const status = record.status
  if (status !== 'satisfied' && status !== 'partial' && status !== 'failed') return undefined
  const reasons = Array.isArray(record.reasons)
    ? record.reasons
        .map((item) => readTrimmedString(item))
        .filter(Boolean)
        .slice(0, 12)
    : []
  return { status, reasons }
}

function normalizeLoadedDiagnosticFlags(value: unknown): LoadedChatMessageDiagnosticFlag[] {
  if (!Array.isArray(value)) return []
  const out: LoadedChatMessageDiagnosticFlag[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    const severity = record.severity === 'high' ? 'high' : record.severity === 'medium' ? 'medium' : null
    const code = readTrimmedString(record.code)
    const title = readTrimmedString(record.title)
    const detail = readTrimmedString(record.detail)
    if (!severity || !code || !title || !detail) continue
    out.push({ code, severity, title, detail })
    if (out.length >= 20) break
  }
  return out
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : fallback
}

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null
}

function normalizeToolCallStatus(value: unknown): LiveToolCallRecord['status'] | null {
  return value === 'running' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'denied' ||
    value === 'blocked'
    ? value
    : null
}

function normalizeOutputJson(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value)
  return record ?? undefined
}

function normalizeLoadedToolCallMedia(value: unknown): LiveToolCallMediaRecord | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const kind = record.kind === 'image' || record.kind === 'video' ? record.kind : null
  const status =
    record.status === 'queued' ||
    record.status === 'running' ||
    record.status === 'succeeded' ||
    record.status === 'failed'
      ? record.status
      : null
  const nodeId = readTrimmedString(record.nodeId)
  const taskId = readTrimmedString(record.taskId)
  if (!kind || !status || !nodeId || !taskId) return undefined
  const progress = typeof record.progress === 'number' && Number.isFinite(record.progress)
    ? Math.max(0, Math.min(100, Math.trunc(record.progress)))
    : null
  const url = readTrimmedString(record.url)
  const thumbnailUrl = readTrimmedString(record.thumbnailUrl)
  const errorMessage = readTrimmedString(record.errorMessage)
  return {
    kind,
    status,
    pending: record.pending === true,
    nodeId,
    taskId,
    ...(progress !== null ? { progress } : {}),
    ...(url ? { url } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  }
}

function normalizeLoadedToolCall(value: unknown, turnId: string): LiveToolCallRecord | null {
  const record = asRecord(value)
  if (!record) return null
  const toolCallId = readTrimmedString(record.toolCallId)
  const toolName = readTrimmedString(record.toolName)
  const status = normalizeToolCallStatus(record.status)
  if (!toolCallId || !toolName || !status) return null
  const outputJson = normalizeOutputJson(record.outputJson)
  const media = normalizeLoadedToolCallMedia(record.media)
  const agentId = readTrimmedString(record.agentId)
  const agentType = readTrimmedString(record.agentType)
  const parentToolCallId = readTrimmedString(record.parentToolCallId)
  const agentDepth = typeof record.agentDepth === 'number' && Number.isFinite(record.agentDepth)
    ? record.agentDepth
    : null
  return {
    toolCallId,
    toolName,
    status,
    ...(media ? { media } : {}),
    ...(typeof record.input !== 'undefined' ? { input: record.input } : {}),
    ...(outputJson ? { outputJson } : {}),
    outputPreview: readTrimmedString(record.outputPreview),
    errorMessage: readTrimmedString(record.errorMessage),
    startedAtMs: normalizeNumber(record.startedAtMs, 0),
    finishedAtMs: normalizeNullableNumber(record.finishedAtMs),
    durationMs: normalizeNullableNumber(record.durationMs),
    turnId: readTrimmedString(record.turnId) || turnId,
    ...(agentId ? { agentId } : {}),
    ...(agentType ? { agentType } : {}),
    ...(agentDepth !== null ? { agentDepth } : {}),
    ...(parentToolCallId ? { parentToolCallId } : {}),
  }
}

function normalizeLoadedToolCallSnapshot(value: unknown): ChatMessageToolCallSnapshot | undefined {
  const snapshot = asRecord(value)
  const record = asRecord(snapshot?.record)
  const rawByTurn = asRecord(record?.toolCallsByTurn)
  if (!snapshot || !rawByTurn || !Array.isArray(snapshot.turnIds)) return undefined
  const turnIds: string[] = []
  const toolCallsByTurn: Record<string, LiveToolCallRecord[]> = {}
  for (const rawTurnId of snapshot.turnIds) {
    const turnId = readTrimmedString(rawTurnId)
    if (!turnId || turnIds.includes(turnId)) continue
    const rawCalls = rawByTurn[turnId]
    if (!Array.isArray(rawCalls)) continue
    const calls = rawCalls
      .map((item) => normalizeLoadedToolCall(item, turnId))
      .filter((item): item is LiveToolCallRecord => item !== null)
    if (!calls.length) continue
    turnIds.push(turnId)
    toolCallsByTurn[turnId] = calls
  }
  if (!turnIds.length) return undefined
  return {
    turnIds,
    record: {
      toolCallsByTurn,
    },
  }
}

function normalizeLoadedTraceItem(value: unknown): LiveChatTraceItem | null {
  const record = asRecord(value)
  if (!record) return null
  const id = readTrimmedString(record.id)
  const kind = readTrimmedString(record.kind)
  const at = normalizeNumber(record.at, 0)
  if (kind === 'thinking') {
    const text = readTrimmedString(record.text)
    if (!id || !text) return null
    const parentToolCallId = readTrimmedString(record.parentToolCallId)
    const agentId = readTrimmedString(record.agentId)
    return {
      id,
      kind,
      turnId: readTrimmedString(record.turnId),
      turnIndex: normalizeNullableNumber(record.turnIndex),
      text,
      at,
      ...(parentToolCallId ? { parentToolCallId } : {}),
      ...(agentId ? { agentId } : {}),
    }
  }
  if (kind === 'tool') {
    const toolCallId = readTrimmedString(record.toolCallId)
    if (!id || !toolCallId) return null
    return {
      id,
      kind,
      turnId: readTrimmedString(record.turnId),
      toolCallId,
      at,
    }
  }
  if (kind === 'todo') {
    const sourceToolCallId = readTrimmedString(record.sourceToolCallId)
    if (!id || !sourceToolCallId) return null
    const parentToolCallId = readTrimmedString(record.parentToolCallId)
    const agentId = readTrimmedString(record.agentId)
    return {
      id,
      kind,
      turnId: readTrimmedString(record.turnId),
      sourceToolCallId,
      at,
      ...(parentToolCallId ? { parentToolCallId } : {}),
      ...(agentId ? { agentId } : {}),
    }
  }
  if (kind === 'response') {
    const text = readTrimmedString(record.text)
    if (!id || !text) return null
    return {
      id,
      kind,
      turnId: readTrimmedString(record.turnId),
      text,
      at,
    }
  }
  return null
}

const MAX_AGENT_TRACE_ITEMS = 300

function buildAgentTraceSnapshot(
  items: readonly LiveChatTraceItem[],
): ChatMessageAgentTraceSnapshot | null {
  if (items.length === 0) return null
  const out = items.slice(0, MAX_AGENT_TRACE_ITEMS).map((item) => ({ ...item }))
  return out.length > 0 ? { items: out } : null
}

function buildToolTraceItemFilter(
  snapshot: ChatMessageToolCallSnapshot | undefined,
): (item: LiveChatTraceItem) => boolean {
  const known = new Map<string, string>()
  if (snapshot) {
    for (const turnId of snapshot.turnIds) {
      const bucket = snapshot.record.toolCallsByTurn[turnId]
      if (!Array.isArray(bucket)) continue
      for (const call of bucket) known.set(call.toolCallId, call.toolName)
    }
  }
  return (item) => {
    if (item.kind !== 'tool') return true
    const toolName = known.get(item.toolCallId)
    if (toolName === undefined) return false
    if (toolName === 'ask_user') return false
    return true
  }
}

function normalizeLoadedAgentTraceSnapshot(
  value: unknown,
  toolCallSnapshot: ChatMessageToolCallSnapshot | undefined,
): ChatMessageAgentTraceSnapshot | undefined {
  const record = asRecord(value)
  if (!record || !Array.isArray(record.items)) return undefined
  const accept = buildToolTraceItemFilter(toolCallSnapshot)
  const items = record.items
    .map((item) => normalizeLoadedTraceItem(item))
    .filter((item): item is LiveChatTraceItem => item !== null)
    .filter(accept)
  return buildAgentTraceSnapshot(items) ?? undefined
}

export function normalizeLoadedChatMessageUiSnapshot(value: unknown): LoadedChatMessageUiSnapshot {
  const record = asRecord(value)
  if (!record) return {}
  const todoSnapshot = normalizeLoadedTodoSnapshot(record.todoSnapshot)
  const toolCallSnapshot = normalizeLoadedToolCallSnapshot(record.toolCallSnapshot)
  const agentTraceSnapshot = normalizeLoadedAgentTraceSnapshot(record.agentTraceSnapshot, toolCallSnapshot)
  const turnVerdict = normalizeLoadedTurnVerdict(record.turnVerdict)
  const diagnosticFlags = normalizeLoadedDiagnosticFlags(record.diagnosticFlags)
  return {
    ...(todoSnapshot.length > 0 ? { todoSnapshot } : {}),
    ...(toolCallSnapshot ? { toolCallSnapshot } : {}),
    ...(agentTraceSnapshot ? { agentTraceSnapshot } : {}),
    ...(turnVerdict ? { turnVerdict } : {}),
    ...(diagnosticFlags.length > 0 ? { diagnosticFlags } : {}),
  }
}

function cloneToolCallRecord(call: LiveToolCallRecord): LiveToolCallRecord {
  return {
    ...call,
  }
}

export function freezeChatMessageToolCallSnapshot(input: {
  record: Pick<LiveChatRunRecord, 'toolCallsByTurn'> | null | undefined
  turnIds: string[] | null | undefined
  finalizeUnresolved?: UnresolvedToolCallFinalization
}): ChatMessageToolCallSnapshot | null {
  if (!input.record || !Array.isArray(input.turnIds) || input.turnIds.length === 0) {
    return null
  }

  const turnIds: string[] = []
  const toolCallsByTurn: Record<string, LiveToolCallRecord[]> = {}
  const finalization = input.finalizeUnresolved

  for (const rawTurnId of input.turnIds) {
    const turnId = String(rawTurnId || '').trim()
    if (!turnId || turnId === PENDING_TOOL_CALL_TURN_ID || turnIds.includes(turnId)) continue

    const bucket = input.record.toolCallsByTurn[turnId]
    if (!Array.isArray(bucket) || bucket.length === 0) continue

    turnIds.push(turnId)
    const calls = bucket.map(cloneToolCallRecord)
    toolCallsByTurn[turnId] = finalization
      ? calls.map((call) => finalizeRunningToolCall(call, finalization))
      : calls
  }

  if (turnIds.length === 0) return null

  return {
    turnIds,
    record: {
      toolCallsByTurn,
    },
  }
}

export function freezeChatMessageAgentTraceSnapshot(
  items: LiveChatTraceItem[] | null | undefined,
  _turnIds: readonly string[] | null | undefined,
): ChatMessageAgentTraceSnapshot | null {
  if (!Array.isArray(items)) return null
  return buildAgentTraceSnapshot(items)
}

function countMetadataRichness(message: MergeableChatMessage): number {
  let score = 0
  if (message.agentTraceSnapshot && message.agentTraceSnapshot.items.length > 0) score += 10
  if (message.toolCallSnapshot && message.toolCallSnapshot.turnIds.length > 0) score += 8
  if (message.turnVerdict) score += 4
  if (message.askUserPrompt) score += 3
  if (Array.isArray(message.diagnosticFlags) && message.diagnosticFlags.length > 0) score += 2
  if (Array.isArray(message.todoSnapshot) && message.todoSnapshot.length > 0) score += 1
  if (typeof message.skillMention === 'string' && message.skillMention.trim()) score += 1
  return score
}

function shouldPreferLocalChatMessage(
  localMessage: MergeableChatMessage,
  existingMessage: MergeableChatMessage,
): boolean {
  return countMetadataRichness(localMessage) > countMetadataRichness(existingMessage)
}

function extractMessageTimestamp(id: string): number {
  const match = /(\d+)$/.exec(id)
  return match ? Number(match[1]) : 0
}

export function mergeLoadedHistoryWithLocalMessages<T extends MergeableChatMessage>(
  history: T[],
  localMessages: T[],
): T[] {
  if (!localMessages.length) return history
  if (!history.length) return localMessages

  const insertionOrder: string[] = []
  const byId = new Map<string, T>()
  for (const message of history) {
    const id = String(message.id || '').trim()
    if (!id || byId.has(id)) continue
    byId.set(id, message)
    insertionOrder.push(id)
  }
  for (const message of localMessages) {
    const id = String(message.id || '').trim()
    if (!id) continue
    const existing = byId.get(id)
    if (!existing) {
      byId.set(id, message)
      insertionOrder.push(id)
      continue
    }
    if (shouldPreferLocalChatMessage(message, existing)) {
      byId.set(id, message)
    }
  }

  return insertionOrder
    .map((id) => ({ id, ts: extractMessageTimestamp(id) }))
    .sort((a, b) => a.ts - b.ts)
    .map(({ id }) => byId.get(id) as T)
}
