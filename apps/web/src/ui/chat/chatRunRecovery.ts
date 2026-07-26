import type { AgentsChatRunSummaryDto } from '../../api/server'

const ACTIVE_RUN_STORAGE_PREFIX = 'canvas.aiChat.activeRun.v1'
const APPLIED_RESULT_STORAGE_PREFIX = 'canvas.aiChat.appliedRunResult.v1'

export type ActiveChatRunPointer = {
  sessionKey: string
  runId: string
  updatedAt: number
  userMessageId?: string
  assistantMessageId?: string
  requestText?: string
  displayText?: string
  canvasProjectId?: string
  canvasFlowId?: string
  request?: unknown
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

function buildActiveRunStorageKey(sessionKey: string): string {
  return `${ACTIVE_RUN_STORAGE_PREFIX}:${encodeURIComponent(sessionKey)}`
}

function buildAppliedResultStorageKey(input: { runId: string; responseId: string }): string {
  return `${APPLIED_RESULT_STORAGE_PREFIX}:${encodeURIComponent(input.runId)}:${encodeURIComponent(input.responseId)}`
}

function parseActiveRunPointer(value: string | null, sessionKey: string): ActiveChatRunPointer | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    const runId = trimString(parsed.runId)
    const storedSessionKey = trimString(parsed.sessionKey)
    const updatedAt = Number(parsed.updatedAt)
    if (!runId || storedSessionKey !== sessionKey || !Number.isFinite(updatedAt)) return null
    return {
      sessionKey: storedSessionKey,
      runId,
      updatedAt,
      ...readPointerStringFields(parsed),
      ...('request' in parsed ? { request: parsed.request } : {}),
    }
  } catch {
    return null
  }
}

function readPointerStringFields(parsed: Record<string, unknown>): Partial<ActiveChatRunPointer> {
  const userMessageId = trimString(parsed.userMessageId)
  const assistantMessageId = trimString(parsed.assistantMessageId)
  const requestText = trimString(parsed.requestText)
  const displayText = trimString(parsed.displayText)
  const canvasProjectId = trimString(parsed.canvasProjectId)
  const canvasFlowId = trimString(parsed.canvasFlowId)
  return {
    ...(userMessageId ? { userMessageId } : {}),
    ...(assistantMessageId ? { assistantMessageId } : {}),
    ...(requestText ? { requestText } : {}),
    ...(displayText ? { displayText } : {}),
    ...(canvasProjectId ? { canvasProjectId } : {}),
    ...(canvasFlowId ? { canvasFlowId } : {}),
  }
}

export function writeActiveChatRunPointer(input: ActiveChatRunPointer): void {
  const storage = getStorage()
  if (!storage) return
  const sessionKey = trimString(input.sessionKey)
  const runId = trimString(input.runId)
  if (!sessionKey || !runId) return
  const payload: ActiveChatRunPointer = {
    sessionKey,
    runId,
    updatedAt: Number.isFinite(input.updatedAt) ? Math.trunc(input.updatedAt) : Date.now(),
    ...readPointerStringFields(input as unknown as Record<string, unknown>),
    ...(typeof input.request !== 'undefined' ? { request: input.request } : {}),
  }
  storage.setItem(buildActiveRunStorageKey(sessionKey), JSON.stringify(payload))
}

export function readActiveChatRunPointer(sessionKey: string): ActiveChatRunPointer | null {
  const storage = getStorage()
  const normalizedSessionKey = trimString(sessionKey)
  if (!storage || !normalizedSessionKey) return null
  return parseActiveRunPointer(storage.getItem(buildActiveRunStorageKey(normalizedSessionKey)), normalizedSessionKey)
}

export function clearActiveChatRunPointer(sessionKey: string): void {
  const storage = getStorage()
  const normalizedSessionKey = trimString(sessionKey)
  if (!storage || !normalizedSessionKey) return
  storage.removeItem(buildActiveRunStorageKey(normalizedSessionKey))
}

export function hasAppliedChatRunResult(input: { runId: string; responseId: string }): boolean {
  const storage = getStorage()
  const runId = trimString(input.runId)
  const responseId = trimString(input.responseId)
  if (!storage || !runId || !responseId) return false
  return storage.getItem(buildAppliedResultStorageKey({ runId, responseId })) === '1'
}

export function markChatRunResultApplied(input: { runId: string; responseId: string }): void {
  const storage = getStorage()
  const runId = trimString(input.runId)
  const responseId = trimString(input.responseId)
  if (!storage || !runId || !responseId) return
  storage.setItem(buildAppliedResultStorageKey({ runId, responseId }), '1')
}

export function resolveRecoverableChatRun(input: {
  pointer: ActiveChatRunPointer | null
  activeRuns: AgentsChatRunSummaryDto[]
  currentProjectId?: string | null
  currentFlowId?: string | null
}): AgentsChatRunSummaryDto | null {
  const activeRuns = Array.isArray(input.activeRuns) ? input.activeRuns : []
  const pointerRunId = trimString(input.pointer?.runId)
  const activePointerRun = pointerRunId
    ? activeRuns.find((run) => run.runId === pointerRunId) ?? null
    : null
  if (activePointerRun) return activePointerRun
  if (activeRuns[0]) return activeRuns[0]
  const pointer = input.pointer
  if (!pointer || !pointerRunId) return null
  const userMessageId = trimString(pointer.userMessageId)
  const assistantMessageId = trimString(pointer.assistantMessageId)
  if (!userMessageId || !assistantMessageId) return null

  const currentProjectId = trimString(input.currentProjectId)
  const currentFlowId = trimString(input.currentFlowId)
  const pointerProjectId = trimString(pointer.canvasProjectId)
  const pointerFlowId = trimString(pointer.canvasFlowId)
  if (currentProjectId && pointerProjectId && currentProjectId !== pointerProjectId) return null
  if (currentFlowId && pointerFlowId && currentFlowId !== pointerFlowId) return null

  const updatedAtMs = Number.isFinite(pointer.updatedAt) ? pointer.updatedAt : Date.now()
  const updatedAtIso = new Date(updatedAtMs).toISOString()
  const requestText = trimString(pointer.requestText) || trimString(pointer.displayText)
  const displayText = trimString(pointer.displayText) || requestText
  return {
    runId: pointerRunId,
    status: 'running',
    sessionKey: pointer.sessionKey,
    canvasProjectId: pointerProjectId || currentProjectId || null,
    canvasFlowId: pointerFlowId || currentFlowId || null,
    requestText,
    displayText,
    userMessageId,
    assistantMessageId,
    request: typeof pointer.request === 'undefined' ? null : pointer.request,
    response: null,
    error: null,
    createdAt: updatedAtIso,
    updatedAt: updatedAtIso,
    finishedAt: null,
  }
}
