import type { AgentsChatResponseDto, AgentsChatToolStreamPayload } from '../../api/server'

type TraceCanvasMutation = NonNullable<NonNullable<AgentsChatResponseDto['trace']>['canvasMutation']>

export type { TraceCanvasMutation }

export type CanvasServerReloadLayoutMode = 'preserve' | 'dagReflow'

export function resolveCanvasServerReloadLayoutMode(input?: {
  layout?: CanvasServerReloadLayoutMode | null
}): CanvasServerReloadLayoutMode {
  return input?.layout === 'dagReflow' ? 'dagReflow' : 'preserve'
}

export function payloadIsBackendCanvasWrite(payload: AgentsChatToolStreamPayload): boolean {
  if (payload.phase !== 'completed') return false
  if (payload.status !== 'succeeded') return false
  const mutation = payload.canvasMutation
  return Boolean(mutation?.wroteCanvas === true && typeof mutation.flowId === 'string' && mutation.flowId.trim())
}

const CANVAS_WRITE_RELOAD_TOOL_CALL_LIMIT = 200

export type CanvasWriteToolReloadDecision = {
  toolCallId: string
  flowId: string
}

export type GeneratedAssetToolReloadQueueTask = {
  key: string
  run: () => Promise<void>
  onError?: (error: unknown) => void
}

export type GeneratedAssetToolReloadQueue = {
  schedule: (task: GeneratedAssetToolReloadQueueTask) => boolean
  reset: () => void
}

export type GeneratedAssetToolReloadQueueOptions = {
  debounceMs?: number
}

const DEFAULT_CANVAS_WRITE_RELOAD_DEBOUNCE_MS = 120

function readRecordString(source: Record<string, unknown> | undefined, key: string): string {
  const value = source?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function resolveCanvasWriteToolReloadDecision(input: {
  payload: AgentsChatToolStreamPayload
  expectedFlowId?: string | null
}): CanvasWriteToolReloadDecision | null {
  if (input.payload.phase !== 'completed') return null
  if (input.payload.status !== 'succeeded') return null

  const mutation = input.payload.canvasMutation
  if (mutation?.wroteCanvas !== true) return null
  const flowId = typeof mutation.flowId === 'string' ? mutation.flowId.trim() : ''
  const expectedFlowId = typeof input.expectedFlowId === 'string' ? input.expectedFlowId.trim() : ''
  if (!flowId || (expectedFlowId && flowId !== expectedFlowId)) return null

  const rawToolCallId = typeof input.payload.toolCallId === 'string'
    ? input.payload.toolCallId.trim()
    : ''
  if (!rawToolCallId) return null

  return {
    toolCallId: rawToolCallId,
    flowId,
  }
}

export function createGeneratedAssetToolReloadQueue(
  options?: GeneratedAssetToolReloadQueueOptions,
): GeneratedAssetToolReloadQueue {
  let running = false
  let pending = false
  let latestTask: GeneratedAssetToolReloadQueueTask | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const seenToolCallIds = new Set<string>()
  const debounceMs = typeof options?.debounceMs === 'number' && Number.isFinite(options.debounceMs)
    ? Math.max(0, Math.round(options.debounceMs))
    : DEFAULT_CANVAS_WRITE_RELOAD_DEBOUNCE_MS

  const rememberToolCall = (key: string): boolean => {
    const normalized = String(key || '').trim()
    if (!normalized) return false
    if (seenToolCallIds.has(normalized)) return false
    if (seenToolCallIds.size >= CANVAS_WRITE_RELOAD_TOOL_CALL_LIMIT) {
      seenToolCallIds.clear()
    }
    seenToolCallIds.add(normalized)
    return true
  }

  const startDrain = (): void => {
    debounceTimer = null
    if (running || !pending) return
    running = true
    void drain()
  }

  const scheduleDrain = (): void => {
    if (running || debounceTimer) return
    if (debounceMs <= 0) {
      startDrain()
      return
    }
    debounceTimer = setTimeout(startDrain, debounceMs)
  }

  const drain = async (): Promise<void> => {
    try {
      pending = false
      const task = latestTask
      if (!task) return
      try {
        await task.run()
      } catch (error: unknown) {
        task.onError?.(error)
      }
    } finally {
      running = false
      if (pending) scheduleDrain()
    }
  }

  return {
    schedule: (task) => {
      if (!rememberToolCall(task.key)) return false
      latestTask = task
      pending = true
      scheduleDrain()
      return true
    },
    reset: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      running = false
      pending = false
      latestTask = null
      seenToolCallIds.clear()
    },
  }
}

export type ReflowLayoutToolInput = {
  scope: 'canvas' | 'topLevelGroups' | 'group'
  targetGroupId?: string
  focusNodeId?: string
}

export type ReflowLayoutToolDecision = {
  toolCallId: string
  input: ReflowLayoutToolInput
}

export function resolveReflowLayoutToolDecision(
  payload: AgentsChatToolStreamPayload,
): ReflowLayoutToolDecision | null {
  if (payload.toolName !== 'canvas_reflow_layout') return null
  if (payload.phase !== 'completed') return null
  if (payload.status !== 'succeeded') return null

  const inputRecord = isRecord(payload.input) ? payload.input : undefined
  if (!inputRecord) return null

  const rawScope = inputRecord.scope
  if (rawScope !== 'canvas' && rawScope !== 'topLevelGroups' && rawScope !== 'group') return null

  const targetGroupId = readRecordString(inputRecord, 'targetGroupId')
  if (rawScope === 'group' && !targetGroupId) return null

  const focusNodeId = readRecordString(inputRecord, 'focusNodeId')
  const rawToolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId.trim() : ''
  const toolCallId = rawToolCallId || `canvas_reflow_layout:${rawScope}:${targetGroupId}:${focusNodeId}`

  const input: ReflowLayoutToolInput = { scope: rawScope }
  if (targetGroupId) input.targetGroupId = targetGroupId
  if (focusNodeId && rawScope === 'canvas') input.focusNodeId = focusNodeId

  return { toolCallId, input }
}

export type GroupExistingNodesToolInput = {
  nodeIds: string[]
  label?: string
}

export type GroupExistingNodesToolDecision = {
  toolCallId: string
  input: GroupExistingNodesToolInput
}

export function resolveGroupExistingNodesToolDecision(
  payload: AgentsChatToolStreamPayload,
): GroupExistingNodesToolDecision | null {
  if (payload.toolName !== 'canvas_group_existing_nodes') return null
  if (payload.phase !== 'completed') return null
  if (payload.status !== 'succeeded') return null

  const inputRecord = isRecord(payload.input) ? payload.input : undefined
  if (!inputRecord) return null

  const rawNodeIds = inputRecord.nodeIds
  if (!Array.isArray(rawNodeIds)) return null
  const nodeIds = Array.from(
    new Set(
      rawNodeIds
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean),
    ),
  )
  if (nodeIds.length <= 0) return null

  const labelRaw = readRecordString(inputRecord, 'label')
  const label = labelRaw && labelRaw.length <= 80 ? labelRaw : ''

  const rawToolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId.trim() : ''
  const toolCallId =
    rawToolCallId ||
    `canvas_group_existing_nodes:${nodeIds.length}:${nodeIds.slice(0, 3).join(',')}:${label}`

  const input: GroupExistingNodesToolInput = { nodeIds }
  if (label) input.label = label

  return { toolCallId, input }
}

export function dedupeNodeIds(nodeIds: readonly string[]): string[] {
  return Array.from(new Set(nodeIds.map((nodeId) => String(nodeId || '').trim()).filter(Boolean)))
}

export function collectTracePatchedNodeIds(
  traceCanvasMutation?: TraceCanvasMutation | null,
): string[] {
  return dedupeNodeIds([
    ...(Array.isArray(traceCanvasMutation?.patchedNodeIds) ? traceCanvasMutation.patchedNodeIds : []),
    ...(Array.isArray(traceCanvasMutation?.executableNodeIds) ? traceCanvasMutation.executableNodeIds : []),
  ])
}

export function resolveAiChatReloadAutoRunPlan(input: {
  newNodeIds: readonly string[]
  traceCanvasMutation?: TraceCanvasMutation | null
  failedTurn: boolean
}): {
  focusNodeIds: string[]
  autoRunNewNodeIds: string[]
  autoRunPatchedNodeIds: string[]
} {
  const focusNodeIds = dedupeNodeIds(input.newNodeIds)
  if (input.failedTurn) {
    return {
      focusNodeIds,
      autoRunNewNodeIds: [],
      autoRunPatchedNodeIds: [],
    }
  }

  return {
    focusNodeIds,
    autoRunNewNodeIds: focusNodeIds,
    autoRunPatchedNodeIds: collectTracePatchedNodeIds(input.traceCanvasMutation),
  }
}

export function collectTraceDeletedNodeIds(
  traceCanvasMutation?: TraceCanvasMutation | null,
): string[] {
  return dedupeNodeIds(
    Array.isArray(traceCanvasMutation?.deletedNodeIds) ? traceCanvasMutation.deletedNodeIds : [],
  )
}

export function collectTraceDeletedEdgeIds(
  traceCanvasMutation?: TraceCanvasMutation | null,
): string[] {
  return dedupeNodeIds(
    Array.isArray(traceCanvasMutation?.deletedEdgeIds) ? traceCanvasMutation.deletedEdgeIds : [],
  )
}

export function collectTraceCreatedNodeIds(
  traceCanvasMutation?: TraceCanvasMutation | null,
): string[] {
  return dedupeNodeIds(
    Array.isArray(traceCanvasMutation?.createdNodeIds) ? traceCanvasMutation.createdNodeIds : [],
  )
}

// recover-run / end-of-turn 兜底使用 server 归一化后的语义字段。
// 前端不再根据工具名推断画布写入，避免和后端 tool catalog 漂移。
export function responseTraceIndicatesCanvasWrite(
  trace: { toolEvidence?: { wroteCanvas?: boolean; toolNames?: readonly string[] } | null } | null | undefined,
): boolean {
  return trace?.toolEvidence?.wroteCanvas === true
}

export type ApplyTraceDeletionsResult = {
  deletedNodes: number
  deletedEdges: number
}

export type TraceDeletionStore = {
  deleteNode: (id: string) => void
  deleteEdge: (id: string) => void
}

// 增量应用 trace 中的删除指令到本地 store。
// 与 useUIStore.isDirty 完全解耦——无论 dirty 是否为 true,删除都会立即生效。
// 顺序:先删边再删节点,避免 store 联级清理影响计数语义。
export function applyTraceCanvasDeletions(
  traceCanvasMutation: TraceCanvasMutation | null | undefined,
  store: TraceDeletionStore,
): ApplyTraceDeletionsResult {
  const nodeIds = collectTraceDeletedNodeIds(traceCanvasMutation)
  const edgeIds = collectTraceDeletedEdgeIds(traceCanvasMutation)
  for (const edgeId of edgeIds) store.deleteEdge(edgeId)
  for (const nodeId of nodeIds) store.deleteNode(nodeId)
  return { deletedNodes: nodeIds.length, deletedEdges: edgeIds.length }
}
