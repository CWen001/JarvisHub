import type {
  LiveMediaResultStatus,
  LiveToolCallMediaRecord,
  LiveToolCallRecord,
  LiveToolCallStatus,
} from './liveChatRunStore'

export type LiveMediaIdentity = {
  kind?: 'image' | 'video'
  nodeId?: string
  taskId?: string
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readOutputRecord(outputJson: unknown): Record<string, unknown> | null {
  const record = asRecord(outputJson)
  if (!record) return null
  const data = asRecord(record.data)
  return data ?? record
}

function readMediaKindFromToolName(toolName: string): 'image' | 'video' | null {
  if (toolName.startsWith('canvas_image_')) return 'image'
  if (toolName.startsWith('canvas_video_')) return 'video'
  return null
}

function readTaskId(kind: 'image' | 'video', record: Record<string, unknown>): string {
  return (
    trimString(record.taskId) ||
    trimString(kind === 'image' ? record.imageTaskId : record.videoTaskId)
  )
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

function readMediaUrl(kind: 'image' | 'video', record: Record<string, unknown>): string {
  return trimString(kind === 'image' ? record.imageUrl : record.videoUrl) || trimString(record.url)
}

function normalizeMediaStatus(record: Record<string, unknown>, hasUrl: boolean): LiveMediaResultStatus | null {
  const rawStatus = trimString(record.status).toLowerCase()
  if (record.pending === true || rawStatus === 'pending') return 'running'
  if (rawStatus === 'queued') return 'queued'
  if (rawStatus === 'running') return 'running'
  if (rawStatus === 'failed' || rawStatus === 'error') return 'failed'
  if (rawStatus === 'success' || rawStatus === 'succeeded' || rawStatus === 'completed') return 'succeeded'
  if (hasUrl) return 'succeeded'
  return null
}

export function readMediaIdentityFromToolOutput(
  toolName: string,
  outputJson: unknown,
): LiveMediaIdentity | null {
  const kind = readMediaKindFromToolName(toolName)
  if (!kind) return null
  const record = readOutputRecord(outputJson)
  if (!record) return null
  const nodeId = trimString(record.nodeId)
  const taskId = readTaskId(kind, record)
  if (!nodeId && !taskId) return null
  return {
    kind,
    ...(nodeId ? { nodeId } : {}),
    ...(taskId ? { taskId } : {}),
  }
}

export function readMediaIdentityFromToolCall(call: LiveToolCallRecord): LiveMediaIdentity | null {
  if (call.media) {
    return {
      kind: call.media.kind,
      ...(call.media.nodeId ? { nodeId: call.media.nodeId } : {}),
      ...(call.media.taskId ? { taskId: call.media.taskId } : {}),
    }
  }
  return readMediaIdentityFromToolOutput(call.toolName, call.outputJson)
}

export function buildMediaRecordFromToolOutput(
  toolName: string,
  outputJson: unknown,
): LiveToolCallMediaRecord | null {
  const kind = readMediaKindFromToolName(toolName)
  if (!kind) return null
  const record = readOutputRecord(outputJson)
  if (!record) return null
  const nodeId = trimString(record.nodeId)
  const taskId = readTaskId(kind, record)
  if (!nodeId && !taskId) return null
  const url = readMediaUrl(kind, record)
  const status = normalizeMediaStatus(record, Boolean(url))
  if (!status) return null
  const progress = normalizeMediaProgress(record.progress)
  const thumbnailUrl = kind === 'video' ? trimString(record.thumbnailUrl) : ''
  const errorMessage = trimString(record.errorMessage) || trimString(record.message)
  return {
    kind,
    status,
    pending: status === 'queued' || status === 'running',
    nodeId,
    taskId,
    ...(typeof progress === 'number' ? { progress } : {}),
    ...(url ? { url } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  }
}

export function mediaIdentityMatches(call: LiveToolCallRecord, identity: LiveMediaIdentity): boolean {
  const candidate = readMediaIdentityFromToolCall(call)
  if (!candidate) return false
  if (identity.kind && candidate.kind && identity.kind !== candidate.kind) return false
  if (identity.taskId && candidate.taskId) return identity.taskId === candidate.taskId
  if (!identity.nodeId || !candidate.nodeId || identity.nodeId !== candidate.nodeId) return false
  if (identity.taskId && candidate.taskId && identity.taskId !== candidate.taskId) return false
  return true
}

export function shouldApplyMediaRecord(
  current: LiveToolCallMediaRecord | undefined,
  next: LiveToolCallMediaRecord,
): boolean {
  if (!current) return true
  if (current.taskId && next.taskId && current.taskId !== next.taskId) return false
  if (!current.pending && next.pending) return false
  return true
}

export function getLiveToolCallEffectiveStatus(call: LiveToolCallRecord): LiveToolCallStatus {
  if (!call.media) return call.status
  if (call.media.pending || call.media.status === 'queued' || call.media.status === 'running') return 'running'
  if (call.media.status === 'failed') return 'failed'
  return 'succeeded'
}

