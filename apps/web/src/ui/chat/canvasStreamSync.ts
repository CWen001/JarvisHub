import type {
  AgentsChatMediaResultStreamPayload,
  AgentsChatToolStreamPayload,
} from '../../api/server'
import {
  type GeneratedAssetToolReloadQueue,
  type GroupExistingNodesToolInput,
  type ReflowLayoutToolInput,
  resolveCanvasWriteToolReloadDecision,
  resolveGroupExistingNodesToolDecision,
  resolveReflowLayoutToolDecision,
} from './canvasMutation'

export type CanvasToolStreamSyncAction = 'canvasWriteReload' | 'mediaResultPatch' | 'reflowLayout' | 'groupExistingNodes'

export type CanvasToolStreamSyncResult = {
  action: CanvasToolStreamSyncAction | null
  handled: boolean
  scheduled: boolean
  wroteCurrentFlowCanvas: boolean
}

export type CanvasMediaResultNodeUpdate = {
  nodeId: string
  status: 'queued' | 'running' | 'success' | 'error'
  patch: Record<string, unknown>
}

type CanvasToolStreamReloadInput = {
  flowId: string
  expectedProjectId?: string | null
  expectedFlowId?: string | null
  preserveViewport: true
}

export type CanvasToolStreamSyncInput = {
  payload: AgentsChatToolStreamPayload
  expectedFlowId?: string | null
  expectedProjectId?: string | null
  queue?: GeneratedAssetToolReloadQueue | null
  reloadCanvasFlow: (input: CanvasToolStreamReloadInput) => Promise<unknown>
  reflowLayout: (input: ReflowLayoutToolInput) => Promise<{ success: boolean; error?: unknown }>
  groupExistingNodes: (input: GroupExistingNodesToolInput) => string | null
  saveProject?: (() => Promise<void>) | null
  onWarning?: (message: string, detail?: unknown) => void
  contextLabel?: string
}

export type CanvasMediaResultStreamSyncInput = {
  payload: AgentsChatMediaResultStreamPayload
  expectedFlowId?: string | null
  expectedProjectId?: string | null
  queue?: GeneratedAssetToolReloadQueue | null
  reloadCanvasFlow: (input: CanvasToolStreamReloadInput) => Promise<unknown>
  getNodeData?: (nodeId: string) => Record<string, unknown> | null | undefined
  applyMediaResultToNode?: (update: CanvasMediaResultNodeUpdate) => void
  onWarning?: (message: string, detail?: unknown) => void
  contextLabel?: string
}

function formatCanvasToolSyncWarning(input: {
  contextLabel?: string
  message: string
}): string {
  const contextLabel = String(input.contextLabel || '').trim()
  return contextLabel ? `[ai-chat] ${contextLabel} ${input.message}` : `[ai-chat] ${input.message}`
}

async function saveProjectIfAvailable(input: CanvasToolStreamSyncInput): Promise<void> {
  if (!input.saveProject) return
  await input.saveProject()
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readFiniteProgress(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(100, Math.round(value)))
}

function readResultRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

function mergeResultByUrl(
  existingRaw: unknown,
  item: Record<string, unknown>,
): { results: Record<string, unknown>[]; primaryIndex: number } {
  const url = readTrimmedString(item.url)
  const existing = readResultRecords(existingRaw)
  if (!url) return { results: existing, primaryIndex: existing.length > 0 ? existing.length - 1 : 0 }

  const index = existing.findIndex((entry) => readTrimmedString(entry.url) === url)
  if (index >= 0) {
    const results = existing.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, ...item } : entry
    ))
    return { results, primaryIndex: index }
  }

  return { results: [...existing, item], primaryIndex: existing.length }
}

function buildMediaTaskIdPatch(
  payload: AgentsChatMediaResultStreamPayload,
): Record<string, unknown> {
  const taskId = readTrimmedString(payload.taskId)
  if (!taskId) return {}
  return {
    taskId,
    ...(payload.kind === 'image' ? { imageTaskId: taskId } : { videoTaskId: taskId }),
  }
}

export function resolveMediaResultNodeUpdate(
  payload: AgentsChatMediaResultStreamPayload,
  currentData?: Record<string, unknown> | null,
): CanvasMediaResultNodeUpdate | null {
  const nodeId = readTrimmedString(payload.nodeId)
  if (!nodeId) return null

  const patch: Record<string, unknown> = {
    ...buildMediaTaskIdPatch(payload),
  }
  const progress = readFiniteProgress(payload.progress)
  if (progress !== undefined) patch.progress = progress

  if (payload.status === 'queued') {
    return { nodeId, status: 'queued', patch }
  }
  if (payload.status === 'running') {
    return { nodeId, status: 'running', patch }
  }
  if (payload.status === 'failed') {
    const errorMessage = readTrimmedString(payload.errorMessage)
    if (errorMessage) patch.lastError = errorMessage
    return { nodeId, status: 'error', patch }
  }
  if (payload.status !== 'succeeded') return null

  if (progress === undefined) patch.progress = 100
  const url = readTrimmedString(payload.url)
  const label = readTrimmedString(currentData?.label)
  if (payload.kind === 'image' && url) {
    patch.imageUrl = url
    const { results, primaryIndex } = mergeResultByUrl(currentData?.imageResults, {
      url,
      ...(label ? { title: label } : {}),
    })
    patch.imageResults = results
    patch.imagePrimaryIndex = primaryIndex
  }
  if (payload.kind === 'video' && url) {
    const thumbnailUrl = readTrimmedString(payload.thumbnailUrl)
    patch.videoUrl = url
    if (thumbnailUrl) patch.videoThumbnailUrl = thumbnailUrl
    const { results, primaryIndex } = mergeResultByUrl(currentData?.videoResults, {
      url,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(label ? { title: label } : {}),
    })
    patch.videoResults = results
    patch.videoPrimaryIndex = primaryIndex
  }

  return { nodeId, status: 'success', patch }
}

export function scheduleCanvasToolStreamSync(
  input: CanvasToolStreamSyncInput,
): CanvasToolStreamSyncResult {
  const warn = input.onWarning ?? (() => {})
  const queue = input.queue

  const reflowDecision = resolveReflowLayoutToolDecision(input.payload)
  if (reflowDecision) {
    const scheduled = Boolean(queue?.schedule({
      key: reflowDecision.toolCallId,
      run: async () => {
        const result = await input.reflowLayout(reflowDecision.input)
        if (!result.success) {
          warn(formatCanvasToolSyncWarning({
            contextLabel: input.contextLabel,
            message: 'reflow_layout failed',
          }), result.error)
          return
        }
        await saveProjectIfAvailable(input)
      },
      onError: (error: unknown) => {
        warn(formatCanvasToolSyncWarning({
          contextLabel: input.contextLabel,
          message: 'reflow_layout schedule failed',
        }), error)
      },
    }))
    return { action: 'reflowLayout', handled: true, scheduled, wroteCurrentFlowCanvas: false }
  }

  const groupDecision = resolveGroupExistingNodesToolDecision(input.payload)
  if (groupDecision) {
    const scheduled = Boolean(queue?.schedule({
      key: groupDecision.toolCallId,
      run: async () => {
        const groupId = input.groupExistingNodes(groupDecision.input)
        if (!groupId) {
          warn(formatCanvasToolSyncWarning({
            contextLabel: input.contextLabel,
            message: 'group_existing_nodes did not create a group',
          }), { nodeIds: groupDecision.input.nodeIds })
          return
        }
        await saveProjectIfAvailable(input)
      },
      onError: (error: unknown) => {
        warn(formatCanvasToolSyncWarning({
          contextLabel: input.contextLabel,
          message: 'group_existing_nodes schedule failed',
        }), error)
      },
    }))
    return { action: 'groupExistingNodes', handled: true, scheduled, wroteCurrentFlowCanvas: false }
  }

  const reloadDecision = resolveCanvasWriteToolReloadDecision({
    payload: input.payload,
    expectedFlowId: input.expectedFlowId,
  })
  if (reloadDecision) {
    const reload = () => input.reloadCanvasFlow({
      flowId: reloadDecision.flowId,
      expectedProjectId: input.expectedProjectId,
      expectedFlowId: input.expectedFlowId,
      preserveViewport: true,
    })
    const scheduled = Boolean(queue?.schedule({
      key: reloadDecision.toolCallId,
      run: reload,
      onError: (error: unknown) => {
        warn(formatCanvasToolSyncWarning({
          contextLabel: input.contextLabel,
          message: 'flow reload after canvas-write tool failed',
        }), error)
      },
    }))
    return { action: 'canvasWriteReload', handled: true, scheduled, wroteCurrentFlowCanvas: true }
  }

  return { action: null, handled: false, scheduled: false, wroteCurrentFlowCanvas: false }
}

export function scheduleCanvasMediaResultStreamSync(
  input: CanvasMediaResultStreamSyncInput,
): CanvasToolStreamSyncResult {
  const flowId = String(input.payload.flowId || '').trim()
  if (!flowId || flowId !== String(input.expectedFlowId || '').trim()) {
    return { action: null, handled: false, scheduled: false, wroteCurrentFlowCanvas: false }
  }
  const update = resolveMediaResultNodeUpdate(
    input.payload,
    input.getNodeData?.(String(input.payload.nodeId || '').trim()),
  )
  if (update) input.applyMediaResultToNode?.(update)

  const terminal = input.payload.pending !== true && (
    input.payload.status === 'succeeded' ||
    input.payload.status === 'failed'
  )
  if (!terminal) {
    return {
      action: update ? 'mediaResultPatch' : null,
      handled: Boolean(update),
      scheduled: false,
      wroteCurrentFlowCanvas: false,
    }
  }

  const keySource =
    String(input.payload.toolCallId || '').trim() ||
    String(input.payload.taskId || '').trim() ||
    String(input.payload.nodeId || '').trim()
  if (!keySource) {
    return { action: null, handled: false, scheduled: false, wroteCurrentFlowCanvas: false }
  }
  const warn = input.onWarning ?? (() => {})
  const reload = () => input.reloadCanvasFlow({
    flowId,
    expectedProjectId: input.expectedProjectId,
    expectedFlowId: input.expectedFlowId,
    preserveViewport: true,
  })
  const scheduled = Boolean(input.queue?.schedule({
    key: `media:${keySource}:${input.payload.status}:${input.payload.pending === true ? 'pending' : 'settled'}`,
    run: reload,
    onError: (error: unknown) => {
      warn(formatCanvasToolSyncWarning({
        contextLabel: input.contextLabel,
        message: 'flow reload after media result failed',
      }), error)
    },
  }))
  return { action: 'canvasWriteReload', handled: true, scheduled, wroteCurrentFlowCanvas: true }
}
