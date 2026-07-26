import { create } from 'zustand'
import type { Edge, Node, OnConnect, OnEdgesChange, OnNodesChange, Connection } from '@xyflow/react'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { runNodeMock } from '../runner/mockRunner'
import { runNodeDagToTarget } from '../runner/dag'
import { runFlowDag } from '../runner/dag'
import { getTaskNodeCoreType, getTaskNodeSchema, normalizeTaskNodeKind } from './nodes/taskNodeSchema'
import { formatErrorMessage } from './utils/formatErrorMessage'
import { getNodeAbsPosition, getNodeSize } from './utils/nodeBounds'
import { reconcileById } from './graphReconcile'
import {
  computeTurnAwareCanvasLayout,
  estimateTextNodeSize,
  LAYOUT_GAP_X,
  LAYOUT_GAP_Y,
  readCanvasHarnessOrigin,
} from '@jarvishub/canvas-layout'
import type { NodeRect, NodeSize, XY } from './utils/nodeBounds'
import { estimateNodeRenderSize, getNodeSizeProfile, MEDIA_BASE_W, computeMediaNodeHeight } from './nodeSizes'
import { normalizeWorkflowEdgeMeta, normalizeWorkflowNodeMeta } from './workflowMeta'
import { getNodeProductionMeta, normalizeProductionNodeMeta, normalizeProductionNodeMetaRecord } from './productionMeta'
import { sanitizeFlowValueForPersistence } from './utils/persistenceSanitizer'
import { useUIStore } from '../ui/uiStore'
import { extractCanvasGraph, type CanvasImportData, type SerializedCanvas } from './utils/serialization'
import { getDefaultModel } from '../config/models'
import { buildVideoDurationPatch, readVideoDurationSeconds } from '../utils/videoDuration'
import { sanitizeNodeDataForCanvasClone } from './pptMasterCloneData'

type GroupArrangeDirection = 'grid' | 'column' | 'flow'

type SilentSaveProjectWindow = Window & {
  silentSaveProject?: () => Promise<void>
}

type CanvasNodeWithDragHandle = Node & {
  dragHandle?: unknown
}

type CanvasNodeWithTransientFields = Node & {
  positionAbsolute?: unknown
  dragging?: unknown
}

type CanvasNodeWithParentFields = Node & {
  parentId?: unknown
  parentNode?: unknown
  extent?: unknown
}

type CanvasNodeWithPositionInternals = CanvasNodeWithTransientFields & {
  resizing?: unknown
}

type CanvasNodeWithInternalSizeFields = Node & {
  width?: unknown
  height?: unknown
  measured?: unknown
}

type CanvasConnectionWithStyleFields = Connection & {
  animated?: unknown
  type?: unknown
}

type StoredCanvasGraph = {
  nodes: Node[]
  edges: Edge[]
}

type CanvasLoadLayoutMode = 'preserve' | 'overlapOnly' | 'dagReflow'

export class CanvasLocalStorageRestoreError extends Error {
  readonly storageKey: string

  constructor(storageKey: string, message: string) {
    super(`${message}：${storageKey}`)
    this.name = 'CanvasLocalStorageRestoreError'
    this.storageKey = storageKey
  }
}

function stripNodeDragHandle(node: Node): Node {
  const { dragHandle: _dragHandle, ...rest } = node as CanvasNodeWithDragHandle
  return rest
}

function stripTransientLayoutFields(node: Node): Node {
  const { positionAbsolute: _positionAbsolute, dragging: _dragging, ...rest } = node as CanvasNodeWithTransientFields
  return rest
}

function stripInvalidParentFields(node: Node): Node {
  const {
    parentId: _parentId,
    parentNode: _legacyParentNode,
    extent: _extent,
    ...rest
  } = node as CanvasNodeWithParentFields
  return rest
}

function stripNodePositionInternals(node: Node): Node {
  const {
    positionAbsolute: _positionAbsolute,
    dragging: _dragging,
    resizing: _resizing,
    ...rest
  } = node as CanvasNodeWithPositionInternals
  return rest
}

function readNodeDataRecord(node: Node | null | undefined): Record<string, unknown> {
  const data = node?.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {}
}

function readNodeStyleRecord(node: Node | null | undefined): Record<string, unknown> {
  const style = node?.style
  return style && typeof style === 'object' && !Array.isArray(style)
    ? style as Record<string, unknown>
    : {}
}

function parseMaybeJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function stripNodeInternalSizeFields(node: Node): Node {
  const {
    width: _internalWidth,
    height: _internalHeight,
    measured: _internalMeasured,
    ...rest
  } = node as CanvasNodeWithInternalSizeFields
  return rest
}

function parseStoredCanvasGraph(raw: string, key: string): StoredCanvasGraph {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CanvasLocalStorageRestoreError(key, '本地画布存储不是合法 JSON')
  }

  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as { nodes?: unknown; edges?: unknown }
    : null
  if (!record || !Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
    throw new CanvasLocalStorageRestoreError(key, '本地画布存储结构损坏')
  }

  return { nodes: record.nodes as Node[], edges: record.edges as Edge[] }
}

function scheduleSilentProjectSave(): void {
  if (typeof window === 'undefined') return
  window.setTimeout(() => {
    const saveProject = (window as SilentSaveProjectWindow).silentSaveProject
    if (typeof saveProject === 'function') saveProject()
  }, 100)
}

type RFState = {
  nodes: Node[]
  edges: Edge[]
  nextId: number
  nextGroupId: number
  lastGroupArrangeDirection: GroupArrangeDirection
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  addNode: (type: string, label?: string, extra?: Record<string, unknown>) => void
  reset: () => void
  load: (data: { nodes: Node[]; edges: Edge[] } | null, options?: { layout?: CanvasLoadLayoutMode; history?: 'push' | 'preserve' }) => void
  removeSelected: () => void
  updateNodeLabel: (id: string, label: string) => void
  updateNodeData: (id: string, patch: Record<string, unknown>) => void
  appendImportedNodes: (nodes: Node[]) => void
  patchNodeDataWithoutHistory: (id: string, patch: Record<string, unknown>) => void
  copySelected: () => void
  pasteFromClipboard: () => void
  clipboard: { nodes: Node[]; edges: Edge[] } | null
  // history
  historyPast: { nodes: Node[]; edges: Edge[] }[]
  historyFuture: { nodes: Node[]; edges: Edge[] }[]
  undo: () => void
  redo: () => void
  // mock run
  runSelected: () => Promise<void>
  runDag: (concurrency: number) => Promise<void>
  setNodeStatus: (id: string, status: 'idle'|'queued'|'running'|'success'|'error', patch?: Record<string, unknown>) => void
  aiSessionRunningByNode: Record<string, Record<string, true>>
  markNodeAiSessionRunning: (nodeId: string, sessionKey: string) => void
  clearNodeAiSessionRunning: (nodeId: string, sessionKey: string) => void
  clearAllNodesForAiSession: (sessionKey: string) => void
  appendLog: (id: string, line: string) => void
  beginRunToken: (id: string) => string
  endRunToken: (id: string) => void
  cancelNode: (id: string) => void
  isCanceled: (id: string, runToken?: string | null) => boolean
  deleteNode: (id: string) => void
  deleteEdge: (id: string) => void
  reorderEdgeForTarget: (edgeId: string, direction: 'left' | 'right') => void
  duplicateNode: (id: string) => void
  pasteFromClipboardAt: (pos: { x: number; y: number }) => void
  importWorkflow: (workflowData: CanvasImportData | SerializedCanvas | null | undefined, position?: { x: number; y: number }) => void
  selectAll: () => void
  clearSelection: () => void
  invertSelection: () => void
  // group actions (parentId-based model)
  addGroupForSelection: (name?: string) => void
  createGroupForNodeIds: (nodeIds: string[], name?: string, options?: { preserveLayout?: boolean }) => string | null
  fitGroupToChildren: (groupId: string, nodeIds?: string[]) => void
  createScriptBundleFromSelection: (name?: string) => void
  removeGroupById: (id: string) => void
  findGroupMatchingSelection: () => { id: string; name: string; nodeIds: string[] } | null
  renameGroup: (id: string, name: string) => void
  ungroupGroupNode: (id: string) => void
  arrangeGroupChildren: (groupId: string, direction: GroupArrangeDirection, nodeIds?: string[]) => void
  arrangeGroupChildrenByLastDirection: (groupId: string, nodeIds?: string[]) => void
  formatTree: () => void
  autoLayoutAllDagVertical: () => void
  autoLayoutForParent: (parentId: string|null) => void
  beginBatchInsertMeasurement: (ids: string[]) => void
}

function createRandomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function genNodeId(): string {
  return createRandomId('n')
}

function genRunToken(): string {
  return createRandomId('run')
}

function genGroupId(n: number) {
  return `g${n}`
}

function cloneGraph(nodes: Node[], edges: Edge[]) {
  const snapshot = { nodes, edges }
  if (typeof structuredClone === 'function') {
    return structuredClone(snapshot) as { nodes: Node[]; edges: Edge[] }
  }
  return JSON.parse(JSON.stringify(snapshot)) as { nodes: Node[]; edges: Edge[] }
}

function computeNextGroupId(nodes: Node[]): number {
  let maxId = 0
  for (const node of nodes) {
    if (!node || node.type !== 'groupNode') continue
    const rawId = typeof node.id === 'string' ? node.id : ''
    const match = /^g(\d+)$/.exec(rawId)
    if (!match) continue
    const value = Number.parseInt(match[1], 10)
    if (Number.isFinite(value)) maxId = Math.max(maxId, value)
  }
  return maxId + 1
}

const SCRIPT_BUNDLE_KINDS = new Set(['text'])

function getNodeDataRecord(node: Node): Record<string, unknown> {
  return node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {}
}

function getRecordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function parseAspectRatioField(value: unknown): { w: number; h: number } | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return { w: value, h: 1 }
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)$/i)
  if (!match) return null
  const w = Number.parseFloat(match[1])
  const h = Number.parseFloat(match[2])
  if (w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)) return { w, h }
  return null
}

function getNodeTextField(node: Node, key: string): string {
  const value = getNodeDataRecord(node)[key]
  return typeof value === 'string' ? value.trim() : ''
}

function getScriptBundleNodeContent(node: Node): string {
  const prompt = getNodeTextField(node, 'prompt')
  if (prompt) return prompt
  const text = getNodeTextField(node, 'text')
  if (text) return text
  return ''
}

function stripBundleLabelPrefix(label: string): string {
  const trimmed = label.trim()
  if (!trimmed) return ''
  const parts = trimmed.split('｜')
  return parts.length > 1 ? parts.slice(1).join('｜').trim() : trimmed
}

function compareNodesByCanvasPosition(left: Node, right: Node, nodesById: Map<string, Node>): number {
  const leftPos = getNodeAbsPosition(left, nodesById)
  const rightPos = getNodeAbsPosition(right, nodesById)
  if (leftPos.y !== rightPos.y) return leftPos.y - rightPos.y
  if (leftPos.x !== rightPos.x) return leftPos.x - rightPos.x
  return String(getNodeDataRecord(left).label || left.id).localeCompare(String(getNodeDataRecord(right).label || right.id))
}

function compareNodesByHorizontalPriority(left: Node, right: Node, nodesById: Map<string, Node>): number {
  const leftPos = getNodeAbsPosition(left, nodesById)
  const rightPos = getNodeAbsPosition(right, nodesById)
  if (leftPos.x !== rightPos.x) return leftPos.x - rightPos.x
  if (leftPos.y !== rightPos.y) return leftPos.y - rightPos.y
  return String(getNodeDataRecord(left).label || left.id).localeCompare(String(getNodeDataRecord(right).label || right.id))
}

function orderScriptBundleNodes(nodes: Node[], edges: Edge[]): Node[] {
  const selectedIds = new Set(nodes.map((node) => node.id))
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const))
  const adjacency = new Map<string, string[]>()
  const indegree = new Map<string, number>()

  for (const node of nodes) {
    adjacency.set(node.id, [])
    indegree.set(node.id, 0)
  }

  for (const edge of edges) {
    if (!selectedIds.has(edge.source) || !selectedIds.has(edge.target)) continue
    adjacency.get(edge.source)?.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1)
  }

  const pending = nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .sort((left, right) => compareNodesByCanvasPosition(left, right, nodesById))
  const ordered: Node[] = []

  while (pending.length > 0) {
    const current = pending.shift()
    if (!current) break
    ordered.push(current)
    const nextIds = adjacency.get(current.id) || []
    for (const nextId of nextIds) {
      const nextDegree = (indegree.get(nextId) || 0) - 1
      indegree.set(nextId, nextDegree)
      if (nextDegree === 0) {
        const nextNode = nodesById.get(nextId)
        if (nextNode) {
          pending.push(nextNode)
          pending.sort((left, right) => compareNodesByCanvasPosition(left, right, nodesById))
        }
      }
    }
  }

  if (ordered.length === nodes.length) return ordered

  const remaining = nodes
    .filter((node) => !ordered.some((item) => item.id === node.id))
    .sort((left, right) => compareNodesByCanvasPosition(left, right, nodesById))
  return [...ordered, ...remaining]
}

function buildScriptBundleLabel(nodes: Node[]): string {
  const labels = nodes
    .map((node) => getNodeTextField(node, 'label'))
    .filter(Boolean)
  if (!labels.length) return '脚本合集'
  const prefixParts = labels.map((label) => label.split('｜')[0]?.trim() || '')
  const sharedPrefix = prefixParts.every((item) => item && item === prefixParts[0]) ? prefixParts[0] : ''
  return sharedPrefix ? `${sharedPrefix}｜合集` : '脚本合集'
}

function buildScriptBundlePrompt(nodes: Node[]): string {
  return nodes
    .map((node) => {
      const label = stripBundleLabelPrefix(getNodeTextField(node, 'label')) || getNodeTextField(node, 'label') || '未命名段落'
      const content = getScriptBundleNodeContent(node)
      return `## ${label}\n${content}`.trim()
    })
    .filter(Boolean)
    .join('\n\n')
}

function getTaskNodeHandles(node: Node): { targets: Set<string>; sources: Set<string> } | null {
  if (!node || node.type !== 'taskNode') return null
  const data = (node as { data?: Record<string, unknown> }).data
  const kind = typeof data?.kind === 'string' ? data.kind : null
  const schema = getTaskNodeSchema(kind)
  const handles = schema.handles
  if (!handles || (typeof handles === 'object' && 'dynamic' in handles && handles.dynamic)) {
    return null
  }
  const targets = Array.isArray(handles.targets) ? handles.targets : []
  const sources = Array.isArray(handles.sources) ? handles.sources : []
  const targetIds = new Set<string>(targets.map((h) => String(h.id || '').trim()).filter(Boolean))
  const sourceIds = new Set<string>(sources.map((h) => String(h.id || '').trim()).filter(Boolean))
  const defaultInputType = String(targets[0]?.type || 'any').trim() || 'any'
  const defaultOutputType = String(sources[0]?.type || 'any').trim() || 'any'
  targetIds.add(`in-${defaultInputType}-wide`)
  sourceIds.add(`out-${defaultOutputType}-wide`)
  return { targets: targetIds, sources: sourceIds }
}

function pickLegacyCompatibleHandle(
  knownHandles: Set<string>,
  prefix: 'in-' | 'out-',
): string | null {
  const wideHandle = Array.from(knownHandles).find((handleId) => handleId.startsWith(prefix) && handleId.endsWith('-wide'))
  if (wideHandle) return wideHandle
  const firstKnown = Array.from(knownHandles).find((handleId) => handleId.startsWith(prefix))
  return firstKnown ?? null
}

function normalizeLegacyImportedEdgeHandle(
  handleId: string,
  known: { targets: Set<string>; sources: Set<string> } | null,
  direction: 'source' | 'target',
): string {
  const trimmed = handleId.trim()
  if (!trimmed || !known) return trimmed

  const handleSet = direction === 'source' ? known.sources : known.targets
  if (handleSet.has(trimmed)) return trimmed

  if (direction === 'source' && (trimmed === 'right' || trimmed === 'bottom' || trimmed === 'source')) {
    return pickLegacyCompatibleHandle(known.sources, 'out-') ?? trimmed
  }

  if (direction === 'target' && (trimmed === 'left' || trimmed === 'top' || trimmed === 'target')) {
    return pickLegacyCompatibleHandle(known.targets, 'in-') ?? trimmed
  }

  return trimmed
}

function normalizeImportedEdgeHandles(nodes: Node[], edges: Edge[]): Edge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  return (Array.isArray(edges) ? edges : []).map((edge) => {
    const sourceNode = nodeById.get(edge.source)
    const targetNode = nodeById.get(edge.target)
    const sourceKnown = sourceNode ? getTaskNodeHandles(sourceNode) : null
    const targetKnown = targetNode ? getTaskNodeHandles(targetNode) : null
    const nextSourceHandle =
      typeof edge.sourceHandle === 'string'
        ? normalizeLegacyImportedEdgeHandle(edge.sourceHandle, sourceKnown, 'source')
        : edge.sourceHandle
    const nextTargetHandle =
      typeof edge.targetHandle === 'string'
        ? normalizeLegacyImportedEdgeHandle(edge.targetHandle, targetKnown, 'target')
        : edge.targetHandle
    const targetKind =
      targetNode && targetNode.type === 'taskNode'
        ? getTaskNodeCoreType(typeof (targetNode.data as Record<string, unknown> | undefined)?.kind === 'string' ? String((targetNode.data as Record<string, unknown>).kind) : null)
        : null
    const normalizedTargetHandle =
      targetKind === 'video' &&
      typeof nextTargetHandle === 'string' &&
      (nextTargetHandle === 'in-image' || nextTargetHandle === 'in-video')
        ? 'in-any'
        : nextTargetHandle

    if (nextSourceHandle === edge.sourceHandle && normalizedTargetHandle === edge.targetHandle) return edge

    return {
      ...edge,
      ...(typeof nextSourceHandle === 'string' ? { sourceHandle: nextSourceHandle } : {}),
      ...(typeof normalizedTargetHandle === 'string' ? { targetHandle: normalizedTargetHandle } : {}),
    }
  })
}

function sanitizeEdgesForNodes(nodes: Node[], edges: Edge[]): Edge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  return (Array.isArray(edges) ? edges : []).filter((edge) => {
    const sourceNode = nodeById.get(edge.source)
    const targetNode = nodeById.get(edge.target)
    if (!sourceNode || !targetNode) return false
    const sourceHandle = typeof edge.sourceHandle === 'string' ? edge.sourceHandle.trim() : ''
    const targetHandle = typeof edge.targetHandle === 'string' ? edge.targetHandle.trim() : ''
    const sourceKnown = getTaskNodeHandles(sourceNode)
    const targetKnown = getTaskNodeHandles(targetNode)
    if (sourceHandle && sourceKnown && !sourceKnown.sources.has(sourceHandle)) return false
    if (targetHandle && targetKnown && !targetKnown.targets.has(targetHandle)) return false
    return true
  })
}

function normalizeImportedNodeType(node: Node): Node {
  if (node.type !== 'group') return node
  return { ...node, type: 'groupNode' }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readFirstString(values: unknown[]): string {
  for (const value of values) {
    const trimmed = readTrimmedString(value)
    if (trimmed) return trimmed
  }
  return ''
}

function readStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => readTrimmedString(item))
    .filter(Boolean)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isCoordinateExtentLike(
  value: unknown,
): value is [[number, number], [number, number]] {
  if (!Array.isArray(value) || value.length !== 2) return false
  const first = value[0]
  const second = value[1]
  if (!Array.isArray(first) || first.length !== 2) return false
  if (!Array.isArray(second) || second.length !== 2) return false
  return isFiniteNumber(first[0]) && isFiniteNumber(first[1]) && isFiniteNumber(second[0]) && isFiniteNumber(second[1])
}

function normalizeImportedNodeShape(node: Node): Node {
  const rawSourcePosition = typeof node.sourcePosition === 'string' ? node.sourcePosition.trim() : ''
  const rawTargetPosition = typeof node.targetPosition === 'string' ? node.targetPosition.trim() : ''
  const extent = node.extent === 'parent' || isCoordinateExtentLike(node.extent) ? node.extent : undefined
  const positionX = isFiniteNumber(node.position?.x) ? node.position.x : 0
  const positionY = isFiniteNumber(node.position?.y) ? node.position.y : 0

  return {
    ...node,
    extent,
    position: { x: positionX, y: positionY },
    sourcePosition:
      rawSourcePosition === 'left' ||
      rawSourcePosition === 'right' ||
      rawSourcePosition === 'top' ||
      rawSourcePosition === 'bottom'
        ? node.sourcePosition
        : undefined,
    targetPosition:
      rawTargetPosition === 'left' ||
      rawTargetPosition === 'right' ||
      rawTargetPosition === 'top' ||
      rawTargetPosition === 'bottom'
        ? node.targetPosition
        : undefined,
  }
}

type ImportedAssetResult = { url: string; title?: string }

function normalizeImportedAssetResults(
  urls: string[],
  existing: unknown,
  fallbackTitle: string,
): ImportedAssetResult[] {
  const existingItems = Array.isArray(existing) ? existing : []
  const results: ImportedAssetResult[] = []
  const seen = new Set<string>()

  for (const item of existingItems) {
    const record = readRecord(item)
    const url = readFirstString([record?.url])
    if (!url || seen.has(url)) continue
    seen.add(url)
    const title = readFirstString([record?.title])
    results.push(title ? { url, title } : { url })
  }

  for (const [index, url] of urls.entries()) {
    if (!url || seen.has(url)) continue
    seen.add(url)
    results.push(index === 0 ? { url, title: fallbackTitle } : { url })
  }

  return results
}

function adaptImportedCanvasNode(node: Node): Node {
  if (node.type === 'groupNode' || node.type === 'taskNode' || node.type === 'ioNode') return node

  const externalType = readTrimmedString(node.type)
  if (!['image', 'video', 'text'].includes(externalType)) return node

  const data = getNodeDataRecord(node)
  const metadata = readRecord(data.__metadata)
  const label = readFirstString([data.label, data.title, node.id]) || node.id
  const prompt = readFirstString([data.prompt])
  const base = {
    ...node,
    type: 'taskNode' as const,
    data: {
      ...data,
      label,
      kind: externalType,
      prompt,
      nodeWidth: isFiniteNumber(node.measured?.width) ? node.measured.width : undefined,
      nodeHeight: isFiniteNumber(node.measured?.height) ? node.measured.height : undefined,
    },
  }

  if (externalType === 'image') {
    const urls = readStringArray(data.options)
    const primaryUrl = readFirstString([data.imageUrl, data.src, metadata?.url, urls[0]])
    const imageResults = normalizeImportedAssetResults(urls, data.imageResults, label)
    return {
      ...base,
      data: {
        ...base.data,
        imageUrl: primaryUrl || undefined,
        imageResults,
        imagePrimaryIndex: primaryUrl ? Math.max(0, imageResults.findIndex((item) => item.url === primaryUrl)) : 0,
      },
    }
  }

  if (externalType === 'video') {
    const urls = readStringArray(data.options)
    const primaryUrl = readFirstString([data.videoUrl, data.src, metadata?.url, urls[0]])
    const videoResults = normalizeImportedAssetResults(urls, data.videoResults, label)
    return {
      ...base,
      data: {
        ...base.data,
        videoUrl: primaryUrl || undefined,
        videoTitle: label,
        videoResults,
        videoPrimaryIndex: primaryUrl ? Math.max(0, videoResults.findIndex((item) => item.url === primaryUrl)) : 0,
      },
    }
  }

  const textValue = readFirstString([
    data.text,
    Array.isArray(data.textResults) && data.textResults.length > 0
      ? readRecord(data.textResults[data.textResults.length - 1])?.text
      : '',
    data.prompt,
  ])

  return {
    ...base,
    data: {
      ...base.data,
      prompt: textValue,
      textResults: textValue ? [{ text: textValue }] : [],
    },
  }
}

function normalizeImportedTaskTextNode(node: Node): Node {
  if (node.type !== 'taskNode') return node

  const data = getNodeDataRecord(node)
  const kind = normalizeTaskNodeKind(typeof data.kind === 'string' ? data.kind : null)
  if (kind !== 'text') return node

  const prompt = readTrimmedString(data.prompt)
  const text = readTrimmedString(data.text)
  const latestTextResult =
    Array.isArray(data.textResults) && data.textResults.length > 0
      ? readTrimmedString(readRecord(data.textResults[data.textResults.length - 1])?.text)
      : ''
  const textValue = readFirstString([prompt, text, latestTextResult])

  const nextData: Record<string, unknown> = { ...data }
  let changed = false

  if (!prompt && textValue) {
    nextData.prompt = textValue
    changed = true
  }

  if ((!Array.isArray(data.textResults) || data.textResults.length === 0) && textValue) {
    nextData.textResults = [{ text: textValue }]
    changed = true
  }

  return changed ? { ...node, data: nextData } : node
}

function readPositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

function isPlainTextLayoutNode(node: Node): boolean {
  if (node.type !== 'taskNode') return false
  const data = getNodeDataRecord(node)
  if (typeof data.webPageAssetBoardSection === 'string' && typeof data.webPageAssetBoardForNodeId === 'string') {
    return false
  }
  if (data.webPageAssetBoardDisplay === true && typeof data.webPageAssetBoardForNodeId === 'string') {
    return false
  }
  if (data.webPageSectionDraftsDisplay === true && typeof data.webPageSectionDraftsForNodeId === 'string') {
    return false
  }
  const kind = normalizeTaskNodeKind(typeof data.kind === 'string' ? data.kind : null)
  const coreType = kind ? getTaskNodeCoreType(kind) : null
  return coreType === 'text'
}

// Delegates to the shared, dependency-free estimator so the frontend and the
// hono-api backend size text nodes identically (see @jarvishub/canvas-layout).
function estimateTextLayoutSize(node: Node, baseSize?: NodeSize): NodeSize {
  return estimateTextNodeSize(getNodeDataRecord(node), baseSize)
}

function getLayoutSafeNodeSize(node: Node, baseSize?: NodeSize): NodeSize {
  const size = baseSize ?? getNodeSize(node)
  if (!isPlainTextLayoutNode(node)) return size
  return estimateTextLayoutSize(node, size)
}

function normalizeTextNodeLayoutDimensions(node: Node): Node {
  if (!isPlainTextLayoutNode(node)) return node
  const data = getNodeDataRecord(node)
  const nextSize = estimateTextLayoutSize(node)
  if (readPositiveNumber(data.nodeWidth) === nextSize.w && readPositiveNumber(data.nodeHeight) === nextSize.h) {
    return node
  }
  return {
    ...node,
    data: {
      ...data,
      nodeWidth: nextSize.w,
      nodeHeight: nextSize.h,
    },
  }
}

// Normalize media node dimensions on load. Two cases:
//  1) Stale square: height equals MEDIA_BASE_W (or missing) and aspect ratio
//     metadata is available — recompute correct aspect-ratio height.
//  2) Legacy video override: old projects persisted nodeWidth=480 with
//     nodeHeight∈{270, 720}, set when video.defaultW was 480 to fit the toolbar.
//     Per docs/overleap/node-overlap-and-size-fix-plan.md B-3, clear those so
//     the new profile (MEDIA_BASE_W=320) applies. If aspect metadata exists,
//     recompute against the new base width; otherwise drop nodeWidth/nodeHeight
//     and let the runtime fall back to profile defaults.
function normalizeStaleMediaSize(node: Node): Node {
  if (node.type !== 'taskNode') return node
  const data = getNodeDataRecord(node)
  const kind = normalizeTaskNodeKind(typeof data.kind === 'string' ? data.kind : null)
  const coreType = kind ? getTaskNodeCoreType(kind) : null
  if (coreType !== 'image' && coreType !== 'video') return node
  const w = typeof data.nodeWidth === 'number' && Number.isFinite(data.nodeWidth) ? data.nodeWidth : null
  const h = typeof data.nodeHeight === 'number' && Number.isFinite(data.nodeHeight) ? data.nodeHeight : null

  const isLegacyVideoOverride =
    coreType === 'video' && w === 480 && (h === 720 || h === 270)
  const isStaleSquare = h === null || h === MEDIA_BASE_W
  if (!isLegacyVideoOverride && !isStaleSquare) return node

  const baseW = isLegacyVideoOverride
    ? MEDIA_BASE_W
    : (w !== null && w > 0) ? w : MEDIA_BASE_W
  const parsed = parseAspectRatioField(data.aspectRatio ?? data.size ?? data.videoSize)

  if (!parsed) {
    if (!isLegacyVideoOverride) return node
    // Legacy video override with no aspect metadata — drop fields so profile
    // defaults take effect. Auto-sizing will recompute when the video loads.
    const next: Record<string, unknown> = { ...data }
    delete next.nodeWidth
    delete next.nodeHeight
    delete next.mediaAutoSized
    return { ...node, data: next }
  }

  const profile = getNodeSizeProfile({ kind: kind ?? undefined, coreType: coreType ?? undefined })
  const correctH = computeMediaNodeHeight(baseW, parsed.w, parsed.h, profile)
  if (!isLegacyVideoOverride && correctH === h) return node
  const next: Record<string, unknown> = { ...data, nodeWidth: baseW, nodeHeight: correctH }
  delete next.mediaAutoSized
  return { ...node, data: next }
}

// Section Drafts is a read-only visualization of the webHero node's
// data.webPageSectionDrafts (a screenshot-to-code intermediate). It drives no
// downstream logic and is hidden from the canvas by default; strip any
// persisted display node here so it neither loads nor re-persists.
// See docs/plans/section-drafts-hide.md.
function isSectionDraftDisplayNode(node: Node): boolean {
  const data = getNodeDataRecord(node)
  return data.webPageSectionDraftsDisplay === true
    && typeof data.webPageSectionDraftsForNodeId === 'string'
}

export function sanitizeGraphForCanvas(input: CanvasImportData | SerializedCanvas | null | undefined): { nodes: Node[]; edges: Edge[] } {
  const extracted = extractCanvasGraph(input)
  const rawNodes = extracted?.nodes || []
  const rawEdges = extracted?.edges || []

  const normalizedNodes = rawNodes
    .filter((n): n is Node => Boolean(n))
    .map(normalizeImportedNodeType)
    .map(adaptImportedCanvasNode)
    .map(normalizeImportedTaskTextNode)
    .map(normalizeTextNodeLayoutDimensions)
    .map(normalizeStaleMediaSize)
    .map(normalizeImportedNodeShape)
    .map(normalizeNodeParentId)
    .map(normalizeWorkflowNodeMeta)
    .filter((n) => !isSectionDraftDisplayNode(n))

  const groupIds = new Set(normalizedNodes.filter((n) => n.type === 'groupNode').map((n) => n.id))
  const nodeIds = new Set(normalizedNodes.map((n) => n.id))

  const nodes = normalizedNodes.map((node) => {
	    const pid = getNodeParentId(node)
	    if (!pid) return node
	    const invalidParent = pid === node.id || !groupIds.has(pid) || !nodeIds.has(pid)
	    if (!invalidParent) return node
	    return stripInvalidParentFields(node)
	  })

  const finalNodeIds = new Set(nodes.map((n) => n.id))
  const edgesByNode = normalizeImportedEdgeHandles(
    nodes,
    rawEdges.filter((e) => finalNodeIds.has(e.source) && finalNodeIds.has(e.target)),
  )
  const edges = sanitizeEdgesForNodes(nodes, edgesByNode).map(normalizeWorkflowEdgeMeta)
  return { nodes: ensureParentFirstOrder(nodes), edges }
}

type TreeLayoutPoint = { x: number; y: number }
type TreeLayoutSize = { w: number; h: number }

function isSameLayoutPosition(current: Node['position'] | undefined, next: TreeLayoutPoint): boolean {
  const currentX = Number(current?.x ?? 0)
  const currentY = Number(current?.y ?? 0)
  return Math.abs(currentX - next.x) <= 1 && Math.abs(currentY - next.y) <= 1
}

// 允许图像类节点可选中（用于展示提示词/模型等面板与交互）。
// 若未来有确实需要禁用选择的 taskNode kind，可再加入该集合。
const UNSELECTABLE_TASK_NODE_KINDS = new Set<string>()

function getNodeSizeForLayout(node: Node): TreeLayoutSize {
  // Layout must follow actual rendered box first; stale data.nodeWidth/nodeHeight
  // can otherwise create huge phantom gaps between nodes.
  const measured = getNodeSize(node)
  const safe = getLayoutSafeNodeSize(node, measured)
  return { w: safe.w, h: safe.h }
}

const GROUP_PADDING = 20
const GROUP_MIN_WIDTH = 160
const GROUP_MIN_HEIGHT = 90
const LAYOUT_EXCLUDED_GROUP_SOURCES = new Set<string>()

function getNodeParentId(node: Node): string | null {
  const nodeWithParent = node as CanvasNodeWithParentFields
  const raw =
    typeof nodeWithParent.parentId === 'string'
      ? nodeWithParent.parentId
      : typeof nodeWithParent.parentNode === 'string'
        ? nodeWithParent.parentNode
        : ''
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed || null
}

function shouldExcludeNodeFromGroupArrange(node: Node): boolean {
  if (!node || node.type === 'groupNode') return true
  const data = readNodeDataRecord(node)
  const source = String(data?.source || '').trim()
  if (source && LAYOUT_EXCLUDED_GROUP_SOURCES.has(source)) return true
  return false
}

function buildFlowArrangeColumns(nodes: Node[], edges: Edge[]): Node[][] {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const))
  const targetIds = new Set(nodes.map((node) => node.id))
  const outgoing = new Map<string, Set<string>>()
  const incomingCount = new Map<string, number>()

  for (const node of nodes) {
    outgoing.set(node.id, new Set<string>())
    incomingCount.set(node.id, 0)
  }

  for (const edge of edges) {
    if (!targetIds.has(edge.source) || !targetIds.has(edge.target) || edge.source === edge.target) continue
    const nextTargets = outgoing.get(edge.source)
    if (!nextTargets || nextTargets.has(edge.target)) continue
    nextTargets.add(edge.target)
    incomingCount.set(edge.target, (incomingCount.get(edge.target) || 0) + 1)
  }

  const compare = (leftId: string, rightId: string): number => {
    const leftNode = nodesById.get(leftId)
    const rightNode = nodesById.get(rightId)
    if (!leftNode || !rightNode) return leftId.localeCompare(rightId)
    return compareNodesByHorizontalPriority(leftNode, rightNode, nodesById)
  }

  const roots = nodes
    .filter((node) => (incomingCount.get(node.id) || 0) === 0)
    .sort((left, right) => compareNodesByHorizontalPriority(left, right, nodesById))
  const visited = new Set<string>()
  const columns: Node[][] = []

  const visitChain = (startId: string): void => {
    if (visited.has(startId)) return
    const queue: string[] = [startId]
    const orderedIds: string[] = []

    while (queue.length > 0) {
      const currentId = queue.shift()
      if (!currentId || visited.has(currentId)) continue
      visited.add(currentId)
      orderedIds.push(currentId)
      const nextIds = Array.from(outgoing.get(currentId) || []).sort(compare)
      for (const nextId of nextIds) {
        if (!visited.has(nextId)) queue.push(nextId)
      }
    }

    if (!orderedIds.length) return
    columns.push(orderedIds.map((id) => nodesById.get(id)).filter((node): node is Node => Boolean(node)))
  }

  for (const root of roots) visitChain(root.id)

  const remaining = nodes
    .filter((node) => !visited.has(node.id))
    .sort((left, right) => compareNodesByHorizontalPriority(left, right, nodesById))
  for (const node of remaining) visitChain(node.id)

  return columns
}

function arrangeGroupChildrenInNodes(
  nodes: Node[],
  edges: Edge[],
  groupId: string,
  direction: GroupArrangeDirection,
  nodeIds?: string[],
): Node[] {
  const group = nodes.find((n) => n.id === groupId && n.type === 'groupNode')
  if (!group) return nodes

  const allChildren = nodes.filter((n) => getNodeParentId(n) === groupId && !shouldExcludeNodeFromGroupArrange(n))
  if (allChildren.length < 2) return nodes

  const targetIds =
    Array.isArray(nodeIds) && nodeIds.length
      ? new Set(nodeIds.filter((id) => allChildren.some((n) => n.id === id)))
      : new Set(allChildren.map((n) => n.id))
  const targets = allChildren
    .filter((n) => targetIds.has(n.id))
    .sort((a, b) => {
      const ay = Number(a.position?.y ?? 0)
      const by = Number(b.position?.y ?? 0)
      if (Math.abs(ay - by) > 1) return ay - by
      const ax = Number(a.position?.x ?? 0)
      const bx = Number(b.position?.x ?? 0)
      if (Math.abs(ax - bx) > 1) return ax - bx
      return String(a.id).localeCompare(String(b.id))
    })
  if (targets.length < 2) return nodes

  const padding = GROUP_PADDING
  const gapX = 12
  const gapY = 12

  const nodeSizeById = new Map<string, { w: number; h: number }>(
    targets.map((node) => [node.id, getNodeSizeForLayout(node)] as const),
  )

  const layoutPos = new Map<string, { x: number; y: number }>()
  if (direction === 'column') {
    let cursorY = padding
    for (const node of targets) {
      layoutPos.set(node.id, { x: padding, y: cursorY })
      cursorY += (nodeSizeById.get(node.id)?.h ?? 0) + gapY
    }
  } else if (direction === 'flow') {
    const targetIdSet = new Set(targets.map((node) => node.id))
    const scopedEdges = edges.filter((edge) => targetIdSet.has(edge.source) && targetIdSet.has(edge.target))
    const columns = buildFlowArrangeColumns(targets, scopedEdges)
    let cursorX = padding

    for (const column of columns) {
      let cursorY = padding
      let columnWidth = 0
      for (const node of column) {
        const size = nodeSizeById.get(node.id) || { w: 0, h: 0 }
        layoutPos.set(node.id, { x: cursorX, y: cursorY })
        cursorY += size.h + gapY
        columnWidth = Math.max(columnWidth, size.w)
      }
      cursorX += columnWidth + gapX
    }
  } else {
    const cols = Math.max(1, Math.ceil(Math.sqrt(targets.length)))
    const rows = Math.max(1, Math.ceil(targets.length / cols))
    const colWidths = Array.from({ length: cols }, () => 0)
    const rowHeights = Array.from({ length: rows }, () => 0)
    targets.forEach((node, idx) => {
      const row = Math.floor(idx / cols)
      const col = idx % cols
      const size = nodeSizeById.get(node.id) || { w: 0, h: 0 }
      colWidths[col] = Math.max(colWidths[col], size.w)
      rowHeights[row] = Math.max(rowHeights[row], size.h)
    })
    const colOffsets = Array.from({ length: cols }, () => 0)
    const rowOffsets = Array.from({ length: rows }, () => 0)
    let x = padding
    for (let col = 0; col < cols; col += 1) {
      colOffsets[col] = x
      x += colWidths[col] + gapX
    }
    let y = padding
    for (let row = 0; row < rows; row += 1) {
      rowOffsets[row] = y
      y += rowHeights[row] + gapY
    }
    targets.forEach((node, idx) => {
      const row = Math.floor(idx / cols)
      const col = idx % cols
      layoutPos.set(node.id, {
        x: colOffsets[col] ?? padding,
        y: rowOffsets[row] ?? padding,
      })
    })
  }

  const laidOutNodes = nodes.map((node) => {
    const next = layoutPos.get(node.id)
    if (!next) return node
    const stripped = stripNodePositionInternals(node)
    return { ...stripped, position: next }
  })

  return autoFitSingleGroupNode(laidOutNodes, groupId, new Set(allChildren.map((n) => n.id)))
}

function normalizeNodeParentId(node: Node): Node {
  const nodeWithParent = node as CanvasNodeWithParentFields
  const rawParentId = typeof nodeWithParent.parentId === 'string' ? nodeWithParent.parentId : null
  const rawLegacyParentNode = typeof nodeWithParent.parentNode === 'string' ? nodeWithParent.parentNode : null
  const resolved = (rawParentId || rawLegacyParentNode || '').trim()

  const shouldStripLegacy = rawLegacyParentNode != null
  const shouldNormalizeParentId = (rawParentId || '').trim() !== resolved
  const shouldDropEmptyParentId = rawParentId != null && !resolved

  if (!shouldStripLegacy && !shouldNormalizeParentId && !shouldDropEmptyParentId) return node

  const { parentNode: _legacyParentNode, parentId: _existingParentId, ...rest } = nodeWithParent
  return resolved ? ({ ...rest, parentId: resolved } as Node) : (rest as Node)
}

function ensureParentFirstOrder(nodes: Node[]): Node[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const ordered: Node[] = []

  const visit = (node: Node) => {
    if (visited.has(node.id)) return
    if (visiting.has(node.id)) {
      visited.add(node.id)
      ordered.push(node)
      return
    }
    visiting.add(node.id)
    const pid = getNodeParentId(node)
    if (pid && pid !== node.id) {
      const parent = byId.get(pid)
      if (parent) visit(parent)
    }
    visiting.delete(node.id)
    if (!visited.has(node.id)) {
      visited.add(node.id)
      ordered.push(node)
    }
  }

  for (const node of nodes) visit(node)
  return ordered
}

function readStringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumericField(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function readOptionalNumericField(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readParentNodeId(node: Node): string {
  const candidate = node as { parentId?: unknown; parentNode?: unknown }
  return readStringField(candidate.parentId) || readStringField(candidate.parentNode)
}

function readNodeDimensionForWebHeroLayout(node: Node, fallback: NodeSize): NodeSize {
  const data = readNodeDataRecord(node)
  const style = readNodeStyleRecord(node)
  const measured = (node as { measured?: { width?: unknown; height?: unknown }; width?: unknown; height?: unknown }).measured
  const measuredW = readOptionalNumericField(measured?.width)
  const measuredH = readOptionalNumericField(measured?.height)
  const nodeW = readOptionalNumericField((node as { width?: unknown }).width)
  const nodeH = readOptionalNumericField((node as { height?: unknown }).height)
  return {
    w: measuredW ?? nodeW ?? readNumericField(data.nodeWidth, readNumericField(style.width, fallback.w)),
    h: measuredH ?? nodeH ?? readNumericField(data.nodeHeight, readNumericField(style.height, fallback.h)),
  }
}

function fallbackSizeForWebHeroLayoutNode(node: Node): NodeSize {
  const data = readNodeDataRecord(node)
  const kind = readStringField(data.kind)
  const type = readStringField(node.type)
  if (data.webPageAssetBoardDisplay === true) return { w: 980, h: 560 }
  if (data.webPageSectionDraftsDisplay === true) return { w: 980, h: 640 }
  if (kind === 'webHero') return { w: 1480, h: 1180 }
  if (kind === 'pptDeck') return { w: 1000, h: 760 }
  if (kind === 'image' || kind === 'imageEdit') {
    if (readStringField(data.webPreviewForNodeId)) return { w: 700, h: 394 }
    if (readStringField(data.webPageAssetForNodeId)) return { w: 520, h: 420 }
    if (readStringField(data.pptDeckImageForNodeId)) return { w: 360, h: 220 }
    return { w: 420, h: 360 }
  }
  if (kind === 'video') return { w: 480, h: 270 }
  if (type === 'groupNode') return { w: 760, h: 520 }
  return { w: 420, h: 240 }
}

function readWebHeroLayoutImageUrl(value: unknown): string {
  const direct = readStringField(value)
  if (!direct) return ''
  if (/^https?:\/\//i.test(direct) || direct.startsWith('/') || direct.startsWith('blob:') || direct.startsWith('data:image/')) {
    return direct
  }
  return ''
}

function readPrimaryImageUrlFromNodeData(data: Record<string, unknown>): string {
  const directImageUrl = readWebHeroLayoutImageUrl(data.imageUrl)
  if (directImageUrl) return directImageUrl
  const imageResults = Array.isArray(data.imageResults) ? data.imageResults : []
  for (const item of imageResults) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const url = readWebHeroLayoutImageUrl((item as Record<string, unknown>).url)
    if (url) return url
  }
  return ''
}

function readAssetBoardItemTitle(item: Record<string, unknown>, fallback: string): string {
  const fields = [item.label, item.title, item.name, item.assetId, item.iconId, item.webPageAssetId]
  for (const field of fields) {
    const value = readStringField(field).replace(/\s+/g, ' ')
    if (value) return value.slice(0, 96)
  }
  return fallback
}

function readAssetBoardItemBody(item: Record<string, unknown>): string {
  const fields = [item.usage, item.need, item.query, item.decision, item.reason, item.placement, item.url]
  return fields
    .map((field) => readStringField(field).replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, 4)
    .join(' · ')
    .slice(0, 260)
}

function readImageUrlFromAssetBoardItem(item: Record<string, unknown>): string {
  const directFields = [
    item.imageUrl,
    item.thumbnailUrl,
    item.previewUrl,
    item.assetUrl,
    item.generatedImageUrl,
    item.resolvedUrl,
    item.url,
  ]
  for (const field of directFields) {
    const url = readWebHeroLayoutImageUrl(field)
    if (url) return url
  }
  for (const value of Object.values(item)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const url = readImageUrlFromAssetBoardItem(value as Record<string, unknown>)
    if (url) return url
  }
  const bodyUrl = readStringField(item.usage) || readStringField(item.decision) || readStringField(item.reason)
  const match = bodyUrl.match(/https?:\/\/[^\s'"<>]+/i)
  return readWebHeroLayoutImageUrl(match?.[0])
}

function isMeaningfulAssetBoardItem(item: Record<string, unknown>, section: string): boolean {
  const text = [
    item.label,
    item.title,
    item.name,
    item.usage,
    item.need,
    item.query,
    item.decision,
    item.reason,
    item.url,
    item.imageUrl,
    item.thumbnailUrl,
  ].map(readStringField).join(' ').toLowerCase()
  if (!text.trim()) return false
  if (/没有|未使用|无需|为空|no external|no generated|not needed/i.test(text) && !readImageUrlFromAssetBoardItem(item)) {
    return false
  }
  if ((section === 'search' || section === 'generated') && !readImageUrlFromAssetBoardItem(item)) return false
  return true
}

function normalizeAssetBoardDisplayItem(
  item: Record<string, unknown>,
  section: string,
  fallback: string,
): Record<string, unknown> | null {
  if (!isMeaningfulAssetBoardItem(item, section)) return null
  const imageUrl = readImageUrlFromAssetBoardItem(item)
  return {
    title: readAssetBoardItemTitle(item, fallback),
    body: readAssetBoardItemBody(item),
    imageUrl,
    url: readWebHeroLayoutImageUrl(item.url) || imageUrl,
    section,
  }
}

function normalizeFontPlanForAssetBoardDisplay(value: unknown): Record<string, unknown>[] {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const namedFonts = record.namedFonts && typeof record.namedFonts === 'object' && !Array.isArray(record.namedFonts)
    ? record.namedFonts as Record<string, unknown>
    : {}
  const display = readStringField(record.selectedDisplayFont) || readStringField(record.displayFont) || readStringField(namedFonts.displayFont)
  const body = readStringField(record.selectedBodyFont) || readStringField(record.bodyFont) || readStringField(namedFonts.bodyFont)
  const cssUrl = readStringField(record.googleCssUrl) || readStringField(namedFonts.googleCssUrl)
  const usage = readStringField(record.usage)
  const items: Record<string, unknown>[] = []
  if (display) items.push({ title: 'Display', body: display, section: 'fonts' })
  if (body) items.push({ title: 'Body', body, section: 'fonts' })
  if (cssUrl) items.push({ title: 'Source', body: cssUrl, url: cssUrl, section: 'fonts' })
  if (usage) items.push({ title: 'Usage', body: usage, section: 'fonts' })
  return items
}

function readWebPageAssetDecisions(data: Record<string, unknown>): Record<string, unknown> {
  const raw = data.webPageAssetDecisions
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return {}
    }
  }
  return {}
}

function toAssetDecisionList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

function adaptFontDecisionItem(item: Record<string, unknown>): Record<string, unknown> {
  const font = readStringField(item.font) || readStringField(item.family) || readStringField(item.label)
  const role = readStringField(item.role) || readStringField(item.usage)
  return {
    ...item,
    label: font || readStringField(item.label) || role || 'Font',
    usage: [role, readStringField(item.source), readStringField(item.url)].filter(Boolean).join(' · '),
  }
}

function adaptStyleDecisionItem(item: Record<string, unknown>): Record<string, unknown> {
  const label =
    readStringField(item.label) ||
    readStringField(item.title) ||
    readStringField(item.category) ||
    'Style'
  const usage =
    readStringField(item.usage) ||
    readStringField(item.body) ||
    readStringField(item.reason) ||
    readStringField(item.prompt) ||
    readStringField(item.value)
  return {
    ...item,
    label,
    usage,
  }
}

export function hasWebPageAssetDecisions(webHero: Node): boolean {
  const data = readNodeDataRecord(webHero)
  const decisions = readWebPageAssetDecisions(data)
  if (!Object.keys(decisions).length) return false
  return ['icons', 'searchAssets', 'generatedAssets', 'fontPlan', 'stylePlan'].some((key) => {
    const value = decisions[key]
    if (Array.isArray(value)) return true
    if (value && typeof value === 'object') return true
    return false
  })
}

function buildWebAssetBoardDisplayPayload(input: {
  nodes: Node[]
  webHero: Node
}): Record<string, unknown> {
  const webHeroData = readNodeDataRecord(input.webHero)
  const webHeroId = input.webHero.id
  const decisions = readWebPageAssetDecisions(webHeroData)
  const sectionItems: Record<string, Record<string, unknown>[]> = {
    icons: [],
    search: [],
    generated: [],
    fonts: [],
    style: [],
  }

  const pushSectionItem = (section: string, item: Record<string, unknown>, fallback: string): void => {
    const normalized = normalizeAssetBoardDisplayItem(item, section, fallback)
    if (!normalized) return
    sectionItems[section] = [...(sectionItems[section] || []), normalized]
  }

  toAssetDecisionList(decisions.icons).forEach((item) => {
    pushSectionItem('icons', item, readStringField(item.label) || readStringField(item.iconId) || 'Icon')
  })
  toAssetDecisionList(decisions.searchAssets).forEach((item) => {
    pushSectionItem('search', item, readStringField(item.label) || readStringField(item.query) || 'Search asset')
  })
  toAssetDecisionList(decisions.generatedAssets).forEach((item) => {
    pushSectionItem('generated', item, readStringField(item.label) || readStringField(item.assetId) || 'Generated asset')
  })

  input.nodes.forEach((node) => {
    const data = readNodeDataRecord(node)
    if (readStringField(data.webPageAssetForNodeId) !== webHeroId) return
    const imageUrl = readPrimaryImageUrlFromNodeData(data)
    if (!imageUrl) return
    pushSectionItem('generated', {
      label: data.label,
      assetId: data.webPageAssetId,
      usage: data.webPageAssetPlacement || data.webPageAssetRequirement,
      imageUrl,
      url: imageUrl,
    }, readStringField(node.id) || 'Generated asset')
  })

  const fontDecisionItems = toAssetDecisionList(decisions.fontPlan)
  if (fontDecisionItems.length) {
    fontDecisionItems.forEach((item) => {
      const adapted = adaptFontDecisionItem(item)
      pushSectionItem('fonts', adapted, readStringField(adapted.label) || 'Font')
    })
  } else {
    const fontItemsFromPlan = normalizeFontPlanForAssetBoardDisplay(webHeroData.fontPlan || webHeroData.webPageFontPlan)
    if (fontItemsFromPlan.length) sectionItems.fonts = fontItemsFromPlan
  }

  toAssetDecisionList(decisions.stylePlan).forEach((item) => {
    const adapted = adaptStyleDecisionItem(item)
    pushSectionItem('style', adapted, readStringField(adapted.label) || 'Style cue')
  })

  const uniqueByImageOrTitle = (items: Record<string, unknown>[]) => {
    const seen = new Set<string>()
    return items.filter((item) => {
      const key = readStringField(item.imageUrl) || `${readStringField(item.title)}:${readStringField(item.body)}`
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  return {
    title: '网页资产规划',
    subtitle: '最终网页使用的图标、搜索图片、生成素材与字体来源',
    icons: uniqueByImageOrTitle(sectionItems.icons).slice(0, 8),
    searchAssets: uniqueByImageOrTitle(sectionItems.search).slice(0, 8),
    generatedAssets: uniqueByImageOrTitle(sectionItems.generated).slice(0, 12),
    fontPlan: uniqueByImageOrTitle(sectionItems.fonts).slice(0, 6),
    stylePlan: uniqueByImageOrTitle(sectionItems.style).slice(0, 8),
  }
}

function getWebHeroLayoutFootprint(
  node: Node,
  nodesById: Map<string, Node>,
  childrenByParentId: Map<string, Node[]>,
  fallback: NodeSize,
): NodeSize {
  const nodeSize = readNodeDimensionForWebHeroLayout(node, fallback)
  let minX = 0
  let minY = 0
  let maxX = nodeSize.w
  let maxY = nodeSize.h
  const origin = getNodeAbsPosition(node, nodesById)

  const visitChildren = (parentId: string): void => {
    const children = childrenByParentId.get(parentId) || []
    children.forEach((child) => {
      if (child.hidden) return
      const childFallback = fallbackSizeForWebHeroLayoutNode(child)
      const childAbs = getNodeAbsPosition(child, nodesById)
      const childSize = readNodeDimensionForWebHeroLayout(child, childFallback)
      minX = Math.min(minX, childAbs.x - origin.x)
      minY = Math.min(minY, childAbs.y - origin.y)
      maxX = Math.max(maxX, childAbs.x - origin.x + childSize.w)
      maxY = Math.max(maxY, childAbs.y - origin.y + childSize.h)
      visitChildren(child.id)
    })
  }

  visitChildren(node.id)
  return {
    w: Math.max(nodeSize.w, Math.ceil(maxX - minX)),
    h: Math.max(nodeSize.h, Math.ceil(maxY - minY)),
  }
}

function laneSizeForWebHeroLayout(
  items: Node[],
  nodesById: Map<string, Node>,
  childrenByParentId: Map<string, Node[]>,
  fallback: NodeSize,
  gapY = 36,
): NodeSize {
  if (!items.length) return fallback
  let w = 0
  let h = 0
  items.forEach((item, index) => {
    const size = getWebHeroLayoutFootprint(item, nodesById, childrenByParentId, fallback)
    w = Math.max(w, size.w)
    h += size.h + (index > 0 ? gapY : 0)
  })
  return { w, h }
}

function moveLaneForWebHeroLayout(
  items: Node[],
  start: XY,
  nodesById: Map<string, Node>,
  childrenByParentId: Map<string, Node[]>,
  fallback: NodeSize,
  moveNode: (nodeId: string, position: XY) => void,
  gapY = 36,
): void {
  let y = start.y
  items.forEach((item, index) => {
    if (index > 0) y += gapY
    const size = getWebHeroLayoutFootprint(item, nodesById, childrenByParentId, fallback)
    moveNode(item.id, { x: start.x, y })
    y += size.h
  })
}

function patchNodePosition(node: Node, position: XY): Node {
  const stripped = stripNodePositionInternals(node)
  return {
    ...stripped,
    position,
  }
}

function restoreExistingNodePositions(nodes: Node[], sourceNodes: Node[]): Node[] {
  const sourcePositionById = new Map(sourceNodes.map((node) => [node.id, node.position] as const))
  let changed = false
  const nextNodes = nodes.map((node) => {
    const sourcePosition = sourcePositionById.get(node.id)
    if (!sourcePosition) return node
    const currentX = Number(node.position?.x ?? 0)
    const currentY = Number(node.position?.y ?? 0)
    const sourceX = Number(sourcePosition.x ?? 0)
    const sourceY = Number(sourcePosition.y ?? 0)
    if (Math.abs(currentX - sourceX) <= 0.5 && Math.abs(currentY - sourceY) <= 0.5) return node
    changed = true
    return patchNodePosition(node, { x: sourceX, y: sourceY })
  })
  return changed ? nextNodes : nodes
}

export function normalizeWebHeroTopLevelLayout(nodes: Node[]): Node[] {
  const webHeroNodes = nodes.filter((node) => {
    const data = readNodeDataRecord(node)
    return node.type === 'taskNode' && readStringField(data.kind) === 'webHero'
  })
  if (!webHeroNodes.length) return nodes

  const nextById = new Map(nodes.map((node) => [node.id, node] as const))
  const childrenByParentId = new Map<string, Node[]>()
  nodes.forEach((node) => {
    const parentId = readParentNodeId(node)
    if (!parentId) return
    const children = childrenByParentId.get(parentId) || []
    children.push(node)
    childrenByParentId.set(parentId, children)
  })
  const syntheticNodes: Node[] = []
  let changed = false

  const moveNode = (nodeId: string, position: XY): void => {
    const node = nextById.get(nodeId)
    if (!node) return
    const currentX = Number(node.position?.x ?? 0)
    const currentY = Number(node.position?.y ?? 0)
    if (Math.abs(currentX - position.x) <= 1 && Math.abs(currentY - position.y) <= 1) return
    nextById.set(nodeId, patchNodePosition(node, position))
    changed = true
  }

  for (const webHero of webHeroNodes) {
    const webHeroId = readStringField(webHero.id)
    if (!webHeroId) continue

    const previewGroup = nodes.find((node) => {
      const data = readNodeDataRecord(node)
      return node.type === 'groupNode' && readStringField(data.webPagePreviewGroupForNodeId) === webHeroId
    }) ?? null
    const assetGroup = nodes.find((node) => {
      const data = readNodeDataRecord(node)
      return node.type === 'groupNode' && readStringField(data.webPageAssetGroupForNodeId) === webHeroId
    }) ?? null
    const existingDisplayBoard = nodes.find((node) => {
      const data = readNodeDataRecord(node)
      return node.type === 'taskNode'
        && data.webPageAssetBoardDisplay === true
        && readStringField(data.webPageAssetBoardForNodeId) === webHeroId
    }) ?? null
    const hasDecisions = hasWebPageAssetDecisions(webHero)
    const boardForLayout = existingDisplayBoard ?? (hasDecisions
      ? {
          id: `${webHeroId}-asset-board-display`,
          type: 'taskNode',
          position: { x: Number(webHero.position?.x ?? 0), y: Number(webHero.position?.y ?? 0) },
          data: {
            kind: 'text',
            label: '网页资产规划',
            webPageAssetBoardDisplay: true,
            webPageAssetBoardForNodeId: webHeroId,
            webPageAssetBoardPayload: buildWebAssetBoardDisplayPayload({
              nodes,
              webHero,
            }),
            nodeWidth: 980,
            nodeHeight: 560,
          },
          style: {
            width: 980,
            height: 560,
          },
          selected: false,
        } as Node
      : null)
    // Section Drafts board is hidden from the canvas by default (read-only
    // intermediate; see docs/plans/section-drafts-hide.md). Never synthesize it.
    const draftBoardForLayout = null

    if (hasDecisions) {
      if (!existingDisplayBoard && boardForLayout) {
        syntheticNodes.push(boardForLayout)
        nextById.set(boardForLayout.id, boardForLayout)
        changed = true
      } else if (existingDisplayBoard && boardForLayout) {
        const nextData = {
          ...readNodeDataRecord(existingDisplayBoard),
          webPageAssetBoardPayload: buildWebAssetBoardDisplayPayload({
            nodes,
            webHero,
          }),
        }
        nextById.set(existingDisplayBoard.id, {
          ...existingDisplayBoard,
          data: nextData,
        })
        changed = true
      }
    }

    const loosePreviewNodes = nodes
      .filter((node) => {
        if (node.hidden) return false
        const data = readNodeDataRecord(node)
        return node.type === 'taskNode'
          && !readParentNodeId(node)
          && readStringField(data.webPreviewForNodeId) === webHeroId
      })
      .sort((a, b) => readNumericField(readNodeDataRecord(a).webScreenshotOrder, 999) - readNumericField(readNodeDataRecord(b).webScreenshotOrder, 999))
    const looseAssetNodes = nodes
      .filter((node) => {
        if (node.hidden) return false
        const data = readNodeDataRecord(node)
        return node.type === 'taskNode'
          && !readParentNodeId(node)
          && readStringField(data.webPageAssetForNodeId) === webHeroId
      })
      .sort((a, b) => readStringField(readNodeDataRecord(a).webPageAssetId).localeCompare(readStringField(readNodeDataRecord(b).webPageAssetId)))

    const previewLaneNodes = previewGroup ? [previewGroup] : loosePreviewNodes
    const assetLaneNodes = assetGroup ? [assetGroup] : looseAssetNodes
    const boardLaneNodes = [boardForLayout, draftBoardForLayout].filter(Boolean) as Node[]

    if (!previewLaneNodes.length && !assetLaneNodes.length && !boardLaneNodes.length) continue

    const webHeroSize = readNodeDimensionForWebHeroLayout(webHero, fallbackSizeForWebHeroLayoutNode(webHero))
    const previewSize = laneSizeForWebHeroLayout(previewLaneNodes, nextById, childrenByParentId, { w: 700, h: 394 }, 36)
    const assetSize = laneSizeForWebHeroLayout(assetLaneNodes, nextById, childrenByParentId, { w: 520, h: 420 }, 36)
    const boardSize = boardLaneNodes.length
      ? laneSizeForWebHeroLayout(boardLaneNodes, nextById, childrenByParentId, { w: 980, h: 560 }, 36)
      : { w: 980, h: 560 }

    const webHeroX = Number(webHero.position?.x ?? 0)
    const webHeroY = Number(webHero.position?.y ?? 0)
    const baseX = Math.min(
      webHeroX,
      ...previewLaneNodes.map((node) => Number(node.position?.x ?? webHeroX)),
      ...assetLaneNodes.map((node) => Number(node.position?.x ?? webHeroX)),
    )
    const baseY = Math.min(
      webHeroY,
      ...previewLaneNodes.map((node) => Number(node.position?.y ?? webHeroY)),
      ...assetLaneNodes.map((node) => Number(node.position?.y ?? webHeroY)),
    )
    const gapX = 220
    const gapY = 160
    const previewPosition = { x: baseX, y: baseY }
    const assetPosition = {
      x: previewPosition.x + previewSize.w + gapX,
      y: baseY,
    }
    const webHeroPosition = {
      x: assetPosition.x + assetSize.w + gapX,
      y: baseY + Math.max(0, Math.round((assetSize.h - webHeroSize.h) / 2)),
    }
    const boardPosition = {
      x: Math.max(previewPosition.x, Math.min(assetPosition.x, webHeroPosition.x + webHeroSize.w - boardSize.w)),
      y: baseY + Math.max(previewSize.h, assetSize.h, webHeroSize.h) + gapY,
    }

    moveLaneForWebHeroLayout(previewLaneNodes, previewPosition, nextById, childrenByParentId, { w: 700, h: 394 }, moveNode, 48)
    moveLaneForWebHeroLayout(assetLaneNodes, assetPosition, nextById, childrenByParentId, { w: 520, h: 420 }, moveNode, 48)
    moveNode(webHero.id, webHeroPosition)
    if (boardLaneNodes.length) {
      moveLaneForWebHeroLayout(boardLaneNodes, boardPosition, nextById, childrenByParentId, { w: 980, h: 560 }, moveNode, 36)
    }
  }

  if (!changed) return nodes
  return ensureParentFirstOrder([
    ...nodes.map((node) => nextById.get(node.id) ?? node),
    ...syntheticNodes.map((node) => nextById.get(node.id) ?? node),
  ])
}

export function normalizePptDeckTopLevelLayout(nodes: Node[]): Node[] {
  const pptDeckNodes = nodes.filter((node) => {
    const data = readNodeDataRecord(node)
    return node.type === 'taskNode' && readStringField(data.kind) === 'pptDeck'
  })
  if (!pptDeckNodes.length) return nodes

  const nextById = new Map(nodes.map((node) => [node.id, node] as const))
  const childrenByParentId = new Map<string, Node[]>()
  nodes.forEach((node) => {
    const parentId = readParentNodeId(node)
    if (!parentId) return
    const children = childrenByParentId.get(parentId) || []
    children.push(node)
    childrenByParentId.set(parentId, children)
  })
  let changed = false

  const moveNode = (nodeId: string, position: XY): void => {
    const node = nextById.get(nodeId)
    if (!node) return
    const currentX = Number(node.position?.x ?? 0)
    const currentY = Number(node.position?.y ?? 0)
    if (Math.abs(currentX - position.x) <= 1 && Math.abs(currentY - position.y) <= 1) return
    nextById.set(nodeId, patchNodePosition(node, position))
    changed = true
  }

  for (const pptDeck of pptDeckNodes) {
    const pptDeckId = readStringField(pptDeck.id)
    if (!pptDeckId) continue

    const imageGroup = nodes.find((node) => {
      const data = readNodeDataRecord(node)
      return node.type === 'groupNode' && readStringField(data.pptDeckImageGroupForNodeId) === pptDeckId
    }) ?? null

    const looseImageNodes = nodes
      .filter((node) => {
        if (node.hidden) return false
        const data = readNodeDataRecord(node)
        return node.type === 'taskNode'
          && !readParentNodeId(node)
          && readStringField(data.pptDeckImageForNodeId) === pptDeckId
      })
      .sort((a, b) => readNumericField(readNodeDataRecord(a).pptDeckSlideIndex, 999) - readNumericField(readNodeDataRecord(b).pptDeckSlideIndex, 999))

    const imageLaneNodes = imageGroup ? [imageGroup] : looseImageNodes
    if (!imageLaneNodes.length) continue

    const pptDeckSize = readNodeDimensionForWebHeroLayout(pptDeck, fallbackSizeForWebHeroLayoutNode(pptDeck))
    const imageSize = laneSizeForWebHeroLayout(imageLaneNodes, nextById, childrenByParentId, { w: 360, h: 220 }, 24)
    const pptDeckX = Number(pptDeck.position?.x ?? 0)
    const pptDeckY = Number(pptDeck.position?.y ?? 0)
    const baseX = Math.min(
      pptDeckX,
      ...imageLaneNodes.map((node) => Number(node.position?.x ?? pptDeckX)),
    )
    const baseY = Math.min(
      pptDeckY,
      ...imageLaneNodes.map((node) => Number(node.position?.y ?? pptDeckY)),
    )
    const gapX = 120
    // Mirror the WebHero layout: assets (configured images) sit on the LEFT,
    // the primary deck node sits on the RIGHT. This keeps the visual reading
    // order consistent between webHero and pptDeck.
    const imagePosition = {
      x: baseX,
      y: baseY + Math.max(0, Math.round((pptDeckSize.h - imageSize.h) / 2)),
    }
    const pptDeckPosition = {
      x: baseX + imageSize.w + gapX,
      y: baseY,
    }

    moveLaneForWebHeroLayout(imageLaneNodes, imagePosition, nextById, childrenByParentId, { w: 360, h: 220 }, moveNode, 24)
    moveNode(pptDeck.id, pptDeckPosition)
  }

  if (!changed) return nodes
  return ensureParentFirstOrder(nodes.map((node) => nextById.get(node.id) ?? node))
}

function parseViewportTransform(): { tx: number; ty: number; zoom: number } | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
  if (!viewport) return null
  const transform = window.getComputedStyle(viewport).transform
  if (!transform || transform === 'none') return { tx: 0, ty: 0, zoom: 1 }
  const matrixMatch = transform.match(/^matrix\((.+)\)$/)
  if (matrixMatch?.[1]) {
    const values = matrixMatch[1].split(',').map((x) => Number.parseFloat(x.trim()))
    if (values.length >= 6 && values.every((n) => Number.isFinite(n))) {
      return { tx: values[4], ty: values[5], zoom: values[0] || 1 }
    }
  }
  const matrix3dMatch = transform.match(/^matrix3d\((.+)\)$/)
  if (matrix3dMatch?.[1]) {
    const values = matrix3dMatch[1].split(',').map((x) => Number.parseFloat(x.trim()))
    if (values.length >= 16 && values.every((n) => Number.isFinite(n))) {
      return { tx: values[12], ty: values[13], zoom: values[0] || 1 }
    }
  }
  return null
}

function getFlowViewRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
  const host = (viewport?.parentElement as HTMLElement | null) || viewport
  if (!host) return null
  const rect = host.getBoundingClientRect()
  const t = parseViewportTransform() || { tx: 0, ty: 0, zoom: 1 }
  const safeZoom = Number.isFinite(t.zoom) && t.zoom > 0 ? t.zoom : 1
  const left = -t.tx / safeZoom
  const top = -t.ty / safeZoom
  const width = (rect.width || window.innerWidth) / safeZoom
  const height = (rect.height || window.innerHeight) / safeZoom
  return { left, top, right: left + width, bottom: top + height, width, height }
}

export function computeContextAwarePosition(nodes: Node[], preferredSize?: { w: number; h: number }): { x: number; y: number } {
  const view = getFlowViewRect()
  if (!view) return { x: 80, y: 80 }
  const margin = 24
  const gap = 28
  const size = preferredSize || { w: 420, h: 240 }
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

  const nodesById = new Map(nodes.map((n) => [n.id, n] as const))
  const rects = nodes
    .filter((n) => n.type !== 'groupNode')
    .map((n) => {
      const p = getNodeAbsPosition(n, nodesById)
      const s = getNodeSizeForLayout(n)
      return { x: p.x, y: p.y, w: s.w, h: s.h }
    })
    .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h))
  const visible = rects.filter((r) => !(r.x + r.w < view.left || r.x > view.right || r.y + r.h < view.top || r.y > view.bottom))
  if (!visible.length) {
    return {
      x: clamp(view.left + view.width * 0.58, view.left + margin, view.right - size.w - margin),
      y: clamp(view.top + margin, view.top + margin, view.bottom - size.h - margin),
    }
  }
  const source = visible

  const minX = Math.min(...source.map((r) => r.x))
  const minY = Math.min(...source.map((r) => r.y))
  const maxX = Math.max(...source.map((r) => r.x + r.w))
  const maxY = Math.max(...source.map((r) => r.y + r.h))
  const rightX = maxX + gap
  const belowY = maxY + gap
  const canRight = rightX + size.w <= view.right - margin
  const canBelow = belowY + size.h <= view.bottom - margin

  if (canRight) {
    return {
      x: clamp(rightX, view.left + margin, view.right - size.w - margin),
      y: clamp(minY, view.top + margin, view.bottom - size.h - margin),
    }
  }
  if (canBelow) {
    return {
      x: clamp(minX, view.left + margin, view.right - size.w - margin),
      y: clamp(belowY, view.top + margin, view.bottom - size.h - margin),
    }
  }
  return {
    x: clamp(view.right - size.w - margin, view.left + margin, view.right - size.w - margin),
    y: clamp(view.bottom - size.h - margin, view.top + margin, view.bottom - size.h - margin),
  }
}

function resolveViewportImportPosition(preferredSize?: NodeSize): XY {
  const view = getFlowViewRect()
  if (!view) return { x: 120, y: 120 }
  const size = preferredSize ?? { w: 420, h: 240 }
  return clampPositionToView(
    { x: view.left + 48, y: view.top + 48 },
    size,
    view,
  )
}

function getRootImportBounds(nodes: Node[]): NodeRect | null {
  const roots = nodes.filter((node) => !getNodeParentId(node))
  const targets = roots.length ? roots : nodes
  if (!targets.length) return null

  const rects = targets
    .map((node) => {
      const x = Number(node.position?.x ?? 0)
      const y = Number(node.position?.y ?? 0)
      const size = getNodeSizeForLayout(node)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return { x, y, w: size.w, h: size.h }
    })
    .filter((rect): rect is NodeRect => Boolean(rect))

  if (!rects.length) return null

  const minX = Math.min(...rects.map((rect) => rect.x))
  const minY = Math.min(...rects.map((rect) => rect.y))
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.w))
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.h))

  return {
    x: minX,
    y: minY,
    w: Math.max(0, maxX - minX),
    h: Math.max(0, maxY - minY),
  }
}

function toNodeRect(position: XY, size: NodeSize): NodeRect {
  return { x: position.x, y: position.y, w: size.w, h: size.h }
}

function rectsOverlap(a: NodeRect, b: NodeRect, padding: number): boolean {
  return !(
    a.x + a.w + padding <= b.x ||
    b.x + b.w + padding <= a.x ||
    a.y + a.h + padding <= b.y ||
    b.y + b.h + padding <= a.y
  )
}

// --- Generic flow-aware sibling layout (no-overlap + symmetric, see docs/canvas-no-overlap-layout.md) ---

export type LayoutScope =
  | { kind: 'topLevel' }
  | { kind: 'group'; groupId: string }

const TOP_LEVEL_GAP_MAIN = 64
const TOP_LEVEL_GAP_PERP = 48
const GROUP_INNER_GAP = 16

function findTopLevelAncestor(
  node: Node,
  nodesById: Map<string, Node>,
): Node | null {
  let cur: Node | undefined = node
  const visited = new Set<string>()
  while (cur) {
    if (visited.has(cur.id)) return null
    visited.add(cur.id)
    const pid = readParentNodeId(cur)
    if (!pid) return cur
    const parent = nodesById.get(pid)
    if (!parent) return cur
    cur = parent
  }
  return null
}

export function relayoutSiblingsAlongFlow(
  nodes: Node[],
  edges: Edge[],
  scope: LayoutScope,
): Node[] {
  const nodesById = new Map(nodes.map((n) => [n.id, n] as const))

  const siblings: Node[] = scope.kind === 'topLevel'
    ? nodes.filter(
        (n) => !readParentNodeId(n) && (n.type === 'groupNode' || n.type === 'taskNode'),
      )
    : nodes.filter(
        (n) =>
          readParentNodeId(n) === scope.groupId
          && n.type !== 'groupNode'
          && !shouldExcludeNodeFromGroupArrange(n),
      )
  if (siblings.length < 2) return nodes

  type Box = { id: string; x: number; y: number; w: number; h: number }
  const boxes: Box[] = siblings.map((n) => {
    const pos = scope.kind === 'topLevel'
      ? getNodeAbsPosition(n, nodesById)
      : { x: Number(n.position?.x ?? 0), y: Number(n.position?.y ?? 0) }
    const size = getNodeSizeForLayout(n)
    return { id: n.id, x: pos.x, y: pos.y, w: size.w, h: size.h }
  })

  // Preserve user intent: if no two siblings overlap, return unchanged.
  let hasOverlap = false
  for (let i = 0; i < boxes.length && !hasOverlap; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (rectsOverlap(boxes[i], boxes[j], 0)) {
        hasOverlap = true
        break
      }
    }
  }
  if (!hasOverlap) return nodes

  // Map every node id (including descendants) to its sibling box id within the current scope.
  const idToSibling = new Map<string, string>()
  if (scope.kind === 'topLevel') {
    const siblingIds = new Set(boxes.map((b) => b.id))
    for (const n of nodes) {
      const top = findTopLevelAncestor(n, nodesById)
      if (top && siblingIds.has(top.id)) idToSibling.set(n.id, top.id)
    }
  } else {
    for (const b of boxes) idToSibling.set(b.id, b.id)
  }

  // Build sibling-level DAG from edges.
  const adj = new Map<string, Set<string>>()
  const inDeg = new Map<string, number>()
  for (const b of boxes) {
    adj.set(b.id, new Set())
    inDeg.set(b.id, 0)
  }
  for (const e of edges) {
    const s = idToSibling.get(String(e.source ?? ''))
    const t = idToSibling.get(String(e.target ?? ''))
    if (!s || !t || s === t) continue
    if (!adj.has(s) || !adj.has(t)) continue
    if (adj.get(s)!.has(t)) continue
    adj.get(s)!.add(t)
    inDeg.set(t, (inDeg.get(t) ?? 0) + 1)
  }

  // Determine flow axis from edge-direction sums (default x when no edges).
  const center = new Map<string, { cx: number; cy: number }>()
  for (const b of boxes) center.set(b.id, { cx: b.x + b.w / 2, cy: b.y + b.h / 2 })
  let dxSum = 0
  let dySum = 0
  for (const [u, vs] of adj) {
    const c1 = center.get(u)!
    for (const v of vs) {
      const c2 = center.get(v)!
      dxSum += c2.cx - c1.cx
      dySum += c2.cy - c1.cy
    }
  }
  const axis: 'x' | 'y' = Math.abs(dxSum) >= Math.abs(dySum) ? 'x' : 'y'

  // Longest-path topological rank via Kahn.
  const rank = new Map<string, number>()
  for (const b of boxes) rank.set(b.id, 0)
  const indegMut = new Map(inDeg)
  const queue: string[] = []
  for (const [id, d] of indegMut) if (d === 0) queue.push(id)
  let qi = 0
  while (qi < queue.length) {
    const u = queue[qi++]
    const ru = rank.get(u) ?? 0
    for (const v of adj.get(u) ?? []) {
      if (ru + 1 > (rank.get(v) ?? 0)) rank.set(v, ru + 1)
      const d = (indegMut.get(v) ?? 0) - 1
      indegMut.set(v, d)
      if (d === 0) queue.push(v)
    }
  }

  // Bucket into rank lanes; sort within rank by perp-axis position then id (idempotent).
  const lanes = new Map<number, Box[]>()
  for (const b of boxes) {
    const r = rank.get(b.id) ?? 0
    const arr = lanes.get(r) ?? []
    arr.push(b)
    lanes.set(r, arr)
  }
  const sortedRanks = Array.from(lanes.keys()).sort((a, b) => a - b)
  const perpKey: 'x' | 'y' = axis === 'x' ? 'y' : 'x'
  for (const r of sortedRanks) {
    lanes.get(r)!.sort((a, b) => {
      const ap = a[perpKey]
      const bp = b[perpKey]
      if (Math.abs(ap - bp) > 0.5) return ap - bp
      return a.id.localeCompare(b.id)
    })
  }

  const gapMain = scope.kind === 'topLevel' ? TOP_LEVEL_GAP_MAIN : GROUP_INNER_GAP
  const gapPerp = scope.kind === 'topLevel' ? TOP_LEVEL_GAP_PERP : GROUP_INNER_GAP

  // Per-rank extents.
  const rankMainExtent = new Map<number, number>() // max along main axis within rank
  const rankPerpExtent = new Map<number, number>() // total along perp axis (with gaps)
  for (const r of sortedRanks) {
    const items = lanes.get(r)!
    let maxMain = 0
    let totalPerp = 0
    items.forEach((it, idx) => {
      const main = axis === 'x' ? it.w : it.h
      const perp = axis === 'x' ? it.h : it.w
      if (main > maxMain) maxMain = main
      totalPerp += perp + (idx > 0 ? gapPerp : 0)
    })
    rankMainExtent.set(r, maxMain)
    rankPerpExtent.set(r, totalPerp)
  }
  const maxPerp = Math.max(0, ...rankPerpExtent.values())

  // Origin: preserve overall bbox top-left for top-level; honor group padding for group scope.
  let originMain: number
  let originPerp: number
  if (scope.kind === 'group') {
    originMain = GROUP_PADDING
    originPerp = GROUP_PADDING
  } else {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    for (const b of boxes) {
      if (b.x < minX) minX = b.x
      if (b.y < minY) minY = b.y
    }
    if (!Number.isFinite(minX)) minX = 0
    if (!Number.isFinite(minY)) minY = 0
    originMain = axis === 'x' ? minX : minY
    originPerp = axis === 'x' ? minY : minX
  }

  // Place each rank along main axis; center perp around shared midline.
  const placed = new Map<string, { x: number; y: number }>()
  let mainCursor = originMain
  for (const r of sortedRanks) {
    const items = lanes.get(r)!
    const totalPerp = rankPerpExtent.get(r) ?? 0
    let perpCursor = originPerp + (maxPerp - totalPerp) / 2
    const rankMain = rankMainExtent.get(r) ?? 0
    for (const it of items) {
      const main = axis === 'x' ? it.w : it.h
      const perp = axis === 'x' ? it.h : it.w
      // Center each box along main axis within its rank lane.
      const mainOffset = (rankMain - main) / 2
      if (axis === 'x') {
        placed.set(it.id, { x: mainCursor + mainOffset, y: perpCursor })
      } else {
        placed.set(it.id, { x: perpCursor, y: mainCursor + mainOffset })
      }
      perpCursor += perp + gapPerp
    }
    mainCursor += rankMain + gapMain
  }

  return nodes.map((n) => {
    const next = placed.get(n.id)
    if (!next) return n
    const cur = { x: Number(n.position?.x ?? 0), y: Number(n.position?.y ?? 0) }
    if (Math.abs(cur.x - next.x) < 0.5 && Math.abs(cur.y - next.y) < 0.5) return n
    return { ...stripNodePositionInternals(n), position: { x: next.x, y: next.y } }
  })
}

function clampPositionToView(position: XY, size: NodeSize, view: ReturnType<typeof getFlowViewRect>): XY {
  if (!view) return position
  const margin = 24
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
  return {
    x: clamp(position.x, view.left + margin, view.right - size.w - margin),
    y: clamp(position.y, view.top + margin, view.bottom - size.h - margin),
  }
}

function collectOccupiedRects(nodes: Node[], parentId: string | null): NodeRect[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const))
  if (parentId) {
    return nodes
      .filter((node) => node.type !== 'groupNode' && String(node.parentId || '').trim() === parentId)
      .map((node) => toNodeRect({ x: Number(node.position?.x ?? 0), y: Number(node.position?.y ?? 0) }, getNodeSizeForLayout(node)))
      .filter((rect) => [rect.x, rect.y, rect.w, rect.h].every((value) => Number.isFinite(value)))
  }

  return nodes
    .filter((node) => node.type !== 'groupNode')
    .map((node) => toNodeRect(getNodeAbsPosition(node, nodesById), getNodeSizeForLayout(node)))
    .filter((rect) => [rect.x, rect.y, rect.w, rect.h].every((value) => Number.isFinite(value)))
}

export function resolveNonOverlappingPosition(
  nodes: Node[],
  preferredPosition: XY,
  preferredSize: NodeSize,
  parentId: string | null,
): XY {
  const occupiedRects = collectOccupiedRects(nodes, parentId)
  if (!occupiedRects.length) return preferredPosition

  const collisionPadding = 32
  const stepX = Math.max(180, Math.round(preferredSize.w + collisionPadding))
  const stepY = Math.max(140, Math.round(preferredSize.h + collisionPadding))
  const view = parentId ? null : getFlowViewRect()
  const origin = parentId ? preferredPosition : clampPositionToView(preferredPosition, preferredSize, view)
  const offsets: XY[] = [{ x: 0, y: 0 }]

  for (let radius = 1; radius <= 8; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        offsets.push({ x: dx, y: dy })
      }
    }
  }

  for (const offset of offsets) {
    const rawCandidate = {
      x: origin.x + offset.x * stepX,
      y: origin.y + offset.y * stepY,
    }
    const candidate = parentId ? rawCandidate : clampPositionToView(rawCandidate, preferredSize, view)
    const candidateRect = toNodeRect(candidate, preferredSize)
    const overlaps = occupiedRects.some((rect) => rectsOverlap(candidateRect, rect, collisionPadding))
    if (!overlaps) return candidate
  }

  return parentId
    ? { x: origin.x, y: origin.y + stepY * 2 }
    : clampPositionToView({ x: origin.x, y: origin.y + stepY * 2 }, preferredSize, view)
}

function applyGroupMembershipOnDragStop(nodes: Node[], movedNodeIds: Set<string>): Node[] {
  if (!movedNodeIds.size) return nodes

  const nodesById = new Map(nodes.map(n => [n.id, n] as const))
  const groupNodes = nodes.filter(n => n.type === 'groupNode')

  const groupRects = groupNodes
    .map((group) => {
      const pos = getNodeAbsPosition(group, nodesById)
      const { w, h } = getNodeSize(group)
      const area = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w * h : Number.POSITIVE_INFINITY
      return { id: group.id, x: pos.x, y: pos.y, w, h, area }
    })
    .filter((g) => Number.isFinite(g.x) && Number.isFinite(g.y) && Number.isFinite(g.w) && Number.isFinite(g.h) && g.w > 0 && g.h > 0)

  if (!groupRects.length) return nodes

  const isCenterInside = (child: Node, group: { x: number; y: number; w: number; h: number }) => {
    const epsilon = 2
    const pos = getNodeAbsPosition(child, nodesById)
    const { w, h } = getNodeSizeForLayout(child)
    const cx = pos.x + w / 2
    const cy = pos.y + h / 2
    const left = group.x - epsilon
    const top = group.y - epsilon
    const right = group.x + group.w + epsilon
    const bottom = group.y + group.h + epsilon
    if (![cx, cy, left, top, right, bottom].every(Number.isFinite)) return false
    return cx >= left && cx <= right && cy >= top && cy <= bottom
  }

  const updates = new Map<string, Node>()
  for (const nodeId of movedNodeIds) {
    const node = nodesById.get(nodeId)
    if (!node) continue
    if (node.type === 'groupNode') continue

    let bestGroupId: string | null = null
    let bestArea = Number.POSITIVE_INFINITY
    for (const group of groupRects) {
      if (group.id === node.id) continue
      if (!isCenterInside(node, group)) continue
      if (bestGroupId === null || group.area < bestArea || (group.area === bestArea && group.id < bestGroupId)) {
        bestGroupId = group.id
        bestArea = group.area
      }
    }

	    const currentParent = getNodeParentId(node)
	    const nextParent = bestGroupId
	    const shouldStripExtent = (node as CanvasNodeWithParentFields).extent != null

    if (nextParent === currentParent && !shouldStripExtent) continue

    const cleanNode = stripNodePositionInternals(normalizeNodeParentId(node))
    const absPos = getNodeAbsPosition(node, nodesById)

    if (!nextParent) {
      updates.set(nodeId, {
        ...cleanNode,
        parentId: undefined,
        extent: undefined,
        position: { x: absPos.x, y: absPos.y },
      })
      continue
    }

    const group = nodesById.get(nextParent)
    if (!group) continue
    const groupAbs = getNodeAbsPosition(group, nodesById)
    updates.set(nodeId, {
      ...cleanNode,
      parentId: nextParent,
      extent: undefined,
      position: { x: absPos.x - groupAbs.x, y: absPos.y - groupAbs.y },
    })
  }

  if (!updates.size) return nodes
  return ensureParentFirstOrder(nodes.map((n) => updates.get(n.id) || n))
}

function resolveIntraGroupOverlaps(nodes: Node[]): Node[] {
  const groupNodes = nodes.filter(n => n.type === 'groupNode')
  if (!groupNodes.length) return nodes

  const GAP = 12
  let result = nodes
  let changed = false

  for (const group of groupNodes) {
    const groupData = getNodeDataRecord(group)
    if (groupData.manualSize === true) continue

    const children = result.filter(
      n => getNodeParentId(n) === group.id && !shouldExcludeNodeFromGroupArrange(n),
    )
    if (children.length < 2) continue

    // Group children into visual rows (nodes within 40px vertical distance)
    const sorted = [...children].sort((a, b) => {
      const ay = Number(a.position?.y ?? 0)
      const by = Number(b.position?.y ?? 0)
      if (Math.abs(ay - by) > 1) return ay - by
      return (Number(a.position?.x ?? 0)) - (Number(b.position?.x ?? 0))
    })

    const rows: Node[][] = []
    for (const node of sorted) {
      const ny = Number(node.position?.y ?? 0)
      const lastRow = rows[rows.length - 1]
      if (lastRow && Math.abs(ny - Number(lastRow[0].position?.y ?? 0)) < 40) {
        lastRow.push(node)
      } else {
        rows.push([node])
      }
    }

    // Sort each row by x
    for (const row of rows) {
      row.sort((a, b) => (Number(a.position?.x ?? 0)) - (Number(b.position?.x ?? 0)))
    }

    // Fix horizontal overlap within each row
    const updates = new Map<string, { x: number; y: number }>()
    for (const row of rows) {
      if (row.length < 2) continue
      let cursor = Number(row[0].position?.x ?? 0)
      for (const node of row) {
        const nodeX = Number(node.position?.x ?? 0)
        const resolvedX = Math.max(nodeX, cursor)
        if (Math.abs(resolvedX - nodeX) > 0.5) {
          updates.set(node.id, { x: resolvedX, y: Number(node.position?.y ?? 0) })
        }
        const size = getNodeSizeForLayout(node)
        cursor = resolvedX + size.w + GAP
      }
    }

    if (updates.size > 0) {
      changed = true
      result = result.map(n => {
        const pos = updates.get(n.id)
        if (!pos) return n
        return { ...stripNodePositionInternals(n), position: pos }
      })
    }
  }

  return changed ? result : nodes
}

function autoFitGroupNodes(nodes: Node[]): Node[] {
  const groupNodes = nodes.filter(n => n.type === 'groupNode')
  if (!groupNodes.length) return nodes

  const byId = new Map(nodes.map(n => [n.id, n] as const))
  const updates = new Map<string, Node>()
  let changed = false

  const updateNode = (id: string, patch: Partial<Node>) => {
    const base = updates.get(id) || byId.get(id)
    if (!base) return
    updates.set(id, { ...stripNodePositionInternals(base), ...patch })
    changed = true
  }

  for (const group of groupNodes) {
    // Respect explicit user resize: once a user has manually sized a group, keep it.
    const groupData = getNodeDataRecord(group)
    if (groupData.manualSize === true) continue

    const children = nodes.filter(n => getNodeParentId(n) === group.id)
    if (!children.length) continue

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const child of children) {
      const { w, h } = getNodeSizeForLayout(child)
      const cx = child.position?.x ?? 0
      const cy = child.position?.y ?? 0
      minX = Math.min(minX, cx)
      minY = Math.min(minY, cy)
      maxX = Math.max(maxX, cx + w)
      maxY = Math.max(maxY, cy + h)
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) continue

    const desiredPos = {
      x: (group.position?.x ?? 0) + (minX - GROUP_PADDING),
      y: (group.position?.y ?? 0) + (minY - GROUP_PADDING),
    }
    const desiredSize = {
      w: Math.max(GROUP_MIN_WIDTH, (maxX - minX) + GROUP_PADDING * 2),
      h: Math.max(GROUP_MIN_HEIGHT, (maxY - minY) + GROUP_PADDING * 2),
    }

    const { w: currentW, h: currentH } = getNodeSize(group, { w: desiredSize.w, h: desiredSize.h })

    const dx = desiredPos.x - (group.position?.x ?? 0)
    const dy = desiredPos.y - (group.position?.y ?? 0)
    const posChanged = Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1
    const sizeChanged = Math.abs(desiredSize.w - currentW) > 0.1 || Math.abs(desiredSize.h - currentH) > 0.1

    if (!posChanged && !sizeChanged) continue

    updateNode(group.id, {
      position: { x: desiredPos.x, y: desiredPos.y },
      width: desiredSize.w,
      height: desiredSize.h,
      data: {
        ...(group.data || {}),
        nodeWidth: desiredSize.w,
        nodeHeight: desiredSize.h,
      },
      style: {
        ...(group.style || {}),
        width: desiredSize.w,
        height: desiredSize.h,
      },
    })

    if (posChanged) {
      for (const child of children) {
        updateNode(child.id, {
          position: {
            x: (child.position?.x ?? 0) - dx,
            y: (child.position?.y ?? 0) - dy,
          },
        })
      }
    }
  }

  if (!changed) return nodes
  return nodes.map(n => updates.get(n.id) || n)
}

function autoFitSingleGroupNode(nodes: Node[], groupId: string, childIds?: Set<string>): Node[] {
  const group = nodes.find((n) => n.id === groupId && n.type === 'groupNode')
  if (!group) return nodes

  const children = nodes.filter((n) => {
    if (getNodeParentId(n) !== groupId) return false
    if (childIds && !childIds.has(n.id)) return false
    return true
  })
  if (!children.length) return nodes

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const child of children) {
    const { w, h } = getNodeSizeForLayout(child)
    const cx = child.position?.x ?? 0
    const cy = child.position?.y ?? 0
    minX = Math.min(minX, cx)
    minY = Math.min(minY, cy)
    maxX = Math.max(maxX, cx + w)
    maxY = Math.max(maxY, cy + h)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return nodes
  }

  const desiredPos = {
    x: (group.position?.x ?? 0) + (minX - GROUP_PADDING),
    y: (group.position?.y ?? 0) + (minY - GROUP_PADDING),
  }
  const desiredSize = {
    w: Math.max(GROUP_MIN_WIDTH, (maxX - minX) + GROUP_PADDING * 2),
    h: Math.max(GROUP_MIN_HEIGHT, (maxY - minY) + GROUP_PADDING * 2),
  }
  const currentSize = getNodeSize(group, { w: desiredSize.w, h: desiredSize.h })
  const dx = desiredPos.x - (group.position?.x ?? 0)
  const dy = desiredPos.y - (group.position?.y ?? 0)
  const posChanged = Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1
  const sizeChanged = Math.abs(desiredSize.w - currentSize.w) > 0.1 || Math.abs(desiredSize.h - currentSize.h) > 0.1
  if (!posChanged && !sizeChanged) return nodes

  return ensureParentFirstOrder(
    nodes.map((node) => {
      if (node.id === groupId) {
        return {
          ...stripNodePositionInternals(node),
          position: { x: desiredPos.x, y: desiredPos.y },
          width: desiredSize.w,
          height: desiredSize.h,
          data: {
            ...(node.data || {}),
            nodeWidth: desiredSize.w,
            nodeHeight: desiredSize.h,
          },
          style: {
            ...(node.style || {}),
            width: desiredSize.w,
            height: desiredSize.h,
          },
        }
      }
      if (!posChanged) return node
      if (getNodeParentId(node) !== groupId) return node
      return {
        ...stripNodePositionInternals(node),
        position: {
          x: (node.position?.x ?? 0) - dx,
          y: (node.position?.y ?? 0) - dy,
        },
      }
    }),
  )
}

function createGroupForNodeIdsInNodes(
  nodes: Node[],
  nextGroupId: number,
  nodeIds: string[],
  name?: string,
  options?: { preserveLayout?: boolean },
): { nodes: Node[]; nextGroupId: number; groupId: string | null } {
  const targetIds = new Set(nodeIds.map((id) => String(id || '').trim()).filter(Boolean))
  if (!targetIds.size) return { nodes, nextGroupId, groupId: null }

  const targetNodes = nodes.filter((node) => targetIds.has(String(node.id || '')) && node.type !== 'groupNode')
  if (!targetNodes.length) return { nodes, nextGroupId, groupId: null }

  const parentIds = new Set(targetNodes.map((node) => getNodeParentId(node) || ''))
  if (parentIds.size !== 1) return { nodes, nextGroupId, groupId: null }

  const parentKey = Array.from(parentIds)[0] || ''
  const parentId = parentKey || null
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const))
  const parentNode = parentId ? nodesById.get(parentId) : null
  if (parentId && !parentNode) return { nodes, nextGroupId, groupId: null }

  if (parentNode?.type === 'groupNode' && typeof name === 'string' && name.trim()) {
    const parentLabel = (parentNode.data as Record<string, unknown> | undefined)?.label
    if (typeof parentLabel === 'string' && parentLabel.trim() === name.trim()) {
      return { nodes, nextGroupId, groupId: null }
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const targetAbsById = new Map<string, { x: number; y: number; w: number; h: number }>()

  for (const node of targetNodes) {
    const abs = getNodeAbsPosition(node, nodesById)
    const { w, h } = getNodeSizeForLayout(node)
    targetAbsById.set(node.id, { x: abs.x, y: abs.y, w, h })
    minX = Math.min(minX, abs.x)
    minY = Math.min(minY, abs.y)
    maxX = Math.max(maxX, abs.x + w)
    maxY = Math.max(maxY, abs.y + h)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { nodes, nextGroupId, groupId: null }
  }

  let nextGroupNo = nextGroupId
  let groupId = genGroupId(nextGroupNo)
  const existingIds = new Set(nodes.map((node) => node.id))
  while (existingIds.has(groupId)) {
    nextGroupNo += 1
    groupId = genGroupId(nextGroupNo)
  }

  const padding = GROUP_PADDING
  const groupAbsX = minX - padding
  const groupAbsY = minY - padding
  const groupWidth = Math.max(GROUP_MIN_WIDTH, (maxX - minX) + padding * 2)
  const groupHeight = Math.max(GROUP_MIN_HEIGHT, (maxY - minY) + padding * 2)
  const parentAbs = parentNode ? getNodeAbsPosition(parentNode, nodesById) : { x: 0, y: 0 }
  const groupLabel = typeof name === 'string' && name.trim() ? name.trim() : `组 ${nextGroupNo}`

  const groupNode = enforceNodeSelectability({
    id: groupId,
    type: 'groupNode',
    position: { x: groupAbsX - parentAbs.x, y: groupAbsY - parentAbs.y },
    parentId: parentId || undefined,
    draggable: true,
    selectable: true,
    focusable: true,
    data: {
      label: groupLabel,
      isGroup: true,
    },
    selected: false,
    style: {
      width: groupWidth,
      height: groupHeight,
    },
  } as Node)

  const nextNodes = nodes.map((node) => {
    if (!targetIds.has(node.id) || node.type === 'groupNode') return node
    const box = targetAbsById.get(node.id)
    if (!box) return node
    const normalized = stripNodePositionInternals(normalizeNodeParentId(node))
    return enforceNodeSelectability({
      ...normalized,
      parentId: groupId,
      extent: undefined,
      selected: false,
      position: {
        x: box.x - groupAbsX,
        y: box.y - groupAbsY,
      },
    } as Node)
  })

  const firstSelectedIndex = nodes.findIndex((node) => targetIds.has(node.id))
  const insertIndex = firstSelectedIndex >= 0 ? firstSelectedIndex : 0
  const nextNodesWithGroup = [
    ...nextNodes.slice(0, insertIndex),
    groupNode,
    ...nextNodes.slice(insertIndex),
  ]
  const nextNodesRaw = ensureParentFirstOrder(nextNodesWithGroup)
  const preserveLayout = options?.preserveLayout !== false
  const arrangedNodes = preserveLayout
    ? autoFitSingleGroupNode(nextNodesRaw, groupId, targetIds)
    : arrangeGroupChildrenInNodes(nextNodesRaw, [], groupId, 'grid', Array.from(targetIds))

  return {
    nodes: arrangedNodes,
    nextGroupId: nextGroupNo + 1,
    groupId,
  }
}

function scaleNodeByGroupResize(node: Node, scale: number): Node {
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 1e-6) return node

	  const stripped = stripNodePositionInternals(node)
	  const currentX = Number(stripped.position.x)
	  const currentY = Number(stripped.position.y)
	  const nextPos = {
	    x: Number.isFinite(currentX) ? currentX * scale : stripped.position.x,
	    y: Number.isFinite(currentY) ? currentY * scale : stripped.position.y,
	  }

	  const data = readNodeDataRecord(stripped)
	  const style = readNodeStyleRecord(stripped)

  // Media nodes (image/video) maintain canonical dimensions regardless of group resize
  // to ensure all same-aspect-ratio media displays at uniform size on the canvas.
  const kind = typeof data.kind === 'string' ? normalizeTaskNodeKind(data.kind) : null
  const coreType = kind ? getTaskNodeCoreType(kind) : null
  const isMediaNode = coreType === 'image' || coreType === 'video'

  const scaledNodeWidth = !isMediaNode && Number.isFinite(Number(data.nodeWidth)) && Number(data.nodeWidth) > 0
    ? Math.max(24, Math.round(Number(data.nodeWidth) * scale))
    : undefined
  const scaledNodeHeight = !isMediaNode && Number.isFinite(Number(data.nodeHeight)) && Number(data.nodeHeight) > 0
    ? Math.max(24, Math.round(Number(data.nodeHeight) * scale))
    : undefined

  const scaledStyleWidth = !isMediaNode && Number.isFinite(Number(style.width)) && Number(style.width) > 0
    ? Math.max(24, Math.round(Number(style.width) * scale))
    : undefined
  const scaledStyleHeight = !isMediaNode && Number.isFinite(Number(style.height)) && Number(style.height) > 0
    ? Math.max(24, Math.round(Number(style.height) * scale))
    : undefined

	  // Keep React Flow internal measurement fields unmanaged here to avoid hitbox drift.
	  const nodeWithoutInternalSize = stripNodeInternalSizeFields(stripped)

	  return {
	    ...nodeWithoutInternalSize,
	    position: nextPos,
    style: {
      ...style,
      ...(scaledStyleWidth ? { width: scaledStyleWidth } : null),
      ...(scaledStyleHeight ? { height: scaledStyleHeight } : null),
    },
    data: {
      ...data,
      ...(scaledNodeWidth ? { nodeWidth: scaledNodeWidth } : null),
      ...(scaledNodeHeight ? { nodeHeight: scaledNodeHeight } : null),
    },
  }
}

function computeTreeLayout(
  nodesInScope: Node[],
  edgesInScope: Edge[],
  gapX: number,
  gapY: number
): { positions: Map<string, TreeLayoutPoint>; sizes: Map<string, TreeLayoutSize> } {
  const degreeById = computeLayoutDegrees(nodesInScope, edgesInScope)
  const roleById = new Map<string, string>()
  const layoutNodes = nodesInScope.map((node) => {
    const role = inferNodeLayoutRole(node, degreeById.get(node.id) ?? { incoming: 0, outgoing: 0 })
    roleById.set(node.id, role)
    return {
      id: node.id,
      family: getNodeLayoutFamily(node),
      role,
      order: inferNodeLayoutOrder(node),
      group: inferNodeLayoutGroup(node),
      weight: inferNodeLayoutWeight(node),
      locked: isNodeLayoutLocked(node),
      position: {
        x: Number(node.position?.x ?? 0),
        y: Number(node.position?.y ?? 0),
      },
      size: getNodeSizeForLayout(node),
      origin: readCanvasHarnessOrigin(readNodeDataRecord(node).canvasOrigin),
    }
  })
  const nodeById = new Map(nodesInScope.map((node) => [node.id, node] as const))
  const layoutEdges = edgesInScope.map((edge) => ({
    source: edge.source,
    target: edge.target,
    weight: inferEdgeLayoutWeight(edge, nodeById, roleById),
  }))
  return computeTurnAwareCanvasLayout(layoutNodes, layoutEdges, { gapX, gapY })
}

function getNodeLayoutFamily(node: Node): string {
  if (node.type !== 'taskNode') return 'other'
  const data = readNodeDataRecord(node)
  const kind = normalizeTaskNodeKind(typeof data.kind === 'string' ? data.kind : null)
  const coreType = kind ? getTaskNodeCoreType(kind) : null
  return coreType === 'text' || coreType === 'image' || coreType === 'video' ? coreType : 'other'
}

function computeLayoutDegrees(nodes: Node[], edges: Edge[]): Map<string, { incoming: number; outgoing: number }> {
  const result = new Map<string, { incoming: number; outgoing: number }>(
    nodes.map((node) => [node.id, { incoming: 0, outgoing: 0 }])
  )
  for (const edge of edges) {
    const source = result.get(edge.source)
    const target = result.get(edge.target)
    if (!source || !target || edge.source === edge.target) continue
    source.outgoing += 1
    target.incoming += 1
  }
  return result
}

function readLayoutNumber(value: unknown): number | undefined {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

function readLayoutString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function inferNaturalOrderFromText(value: unknown): number | undefined {
  const text = typeof value === 'string' ? value : ''
  if (!text) return undefined
  const match = /(?:^|[^\d])(\d{1,5})(?!\d)/.exec(text)
  if (!match) return undefined
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function inferNodeLayoutOrder(node: Node): number | undefined {
  const data = readNodeDataRecord(node)
  return (
    readLayoutNumber(data.layoutOrder) ??
    readLayoutNumber(data.order) ??
    inferNaturalOrderFromText(data.label) ??
    inferNaturalOrderFromText(node.id)
  )
}

function inferNodeLayoutGroup(node: Node): string | undefined {
  const data = readNodeDataRecord(node)
  return (
    readLayoutString(data.layoutGroup) ??
    readLayoutString(data.branchGroupId) ??
    readLayoutString(data.experimentGroupId) ??
    readLayoutString(data.workflowStage)
  )
}

function inferNodeLayoutWeight(node: Node): number | undefined {
  const data = readNodeDataRecord(node)
  return readLayoutNumber(data.layoutWeight)
}

function isNodeLayoutLocked(node: Node): boolean {
  const data = readNodeDataRecord(node)
  return data.layoutLocked === true || data.locked === true
}

function inferNodeLayoutRole(node: Node, degree: { incoming: number; outgoing: number }): string {
  const data = readNodeDataRecord(node)
  const explicit = readLayoutString(data.layoutRole)
  if (explicit) return explicit

  const family = getNodeLayoutFamily(node)
  const size = getNodeSizeForLayout(node)
  const productionLayer = getNodeProductionMeta({ type: node.type, data }).productionLayer
  const isLargeText = size.h >= 520 || size.w >= 560
  if (
    family === 'text' &&
    (productionLayer === 'evidence' ||
      isLargeText ||
      (productionLayer === 'constraints' && degree.outgoing === 0))
  ) {
    return 'note'
  }

  if (degree.incoming === 0 && degree.outgoing > 0) return 'source'
  if (degree.incoming > 0 && degree.outgoing === 0) return 'output'
  if (degree.incoming > 0 && degree.outgoing > 0) return 'process'
  return family === 'text' ? 'note' : 'process'
}

function inferEdgeLayoutWeight(edge: Edge, nodeById: Map<string, Node>, roleById: Map<string, string>): number {
  const data = edge.data && typeof edge.data === 'object' ? edge.data as Record<string, unknown> : {}
  const explicit = readLayoutNumber(data.layoutWeight)
  if (explicit != null) return Math.max(0, explicit)
  if (data.relationshipKind === 'reference') return 0.2
  if (data.relationshipKind === 'primary' || data.relationshipKind === 'aggregation') return 1

  const source = nodeById.get(edge.source)
  const target = nodeById.get(edge.target)
  if (!source || !target) return 1
  const sourceRole = roleById.get(source.id)
  const sourceFamily = getNodeLayoutFamily(source)
  const targetFamily = getNodeLayoutFamily(target)

  if (sourceRole === 'note' && (targetFamily === 'image' || targetFamily === 'video')) return 0.35
  if (sourceFamily === 'text' && (targetFamily === 'image' || targetFamily === 'video')) return 0.75
  return 1
}

// DAG layout over a node set: bucket by parent, run computeTreeLayout per scope, and return the
// repositioned nodes plus whether anything moved. Store actions and load({ layout: 'dagReflow' })
// share this path so Agent sync, format, and parent layout stay consistent.
function applyDagTreeLayout(
  nodes: Node[],
  edges: Edge[],
  gapX = LAYOUT_GAP_X,
  gapY = LAYOUT_GAP_Y,
): { nodes: Node[]; changed: boolean } {
  const byParent = new Map<string, Node[]>()
  nodes.forEach((n) => {
    const p = getNodeParentId(n) || ''
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(n)
  })
  const updated = [...nodes]
  const indexById = new Map(updated.map((node, index) => [node.id, index] as const))
  let changed = false
  byParent.forEach((nodesInParent) => {
    const idSet = new Set(nodesInParent.map((n) => n.id))
    const edgesInScope = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target))
    const { positions } = computeTreeLayout(nodesInParent, edgesInScope, gapX, gapY)
    nodesInParent.forEach((n) => {
      const next = positions.get(n.id)
      if (!next) return
      const i = indexById.get(n.id) ?? -1
      if (i < 0) return
      if (isSameLayoutPosition(updated[i].position, next)) return
      const rest = stripTransientLayoutFields(updated[i])
      updated[i] = { ...rest, position: { x: next.x, y: next.y } }
      changed = true
    })
  })
  return { nodes: updated, changed }
}

function upgradeVideoKind(node: Node): Node {
  if (node.type !== 'taskNode') return node
  const data = node.data && typeof node.data === 'object'
    ? node.data as Record<string, unknown>
    : {}
  const normalizedKind = normalizeTaskNodeKind(typeof data.kind === 'string' ? data.kind : null)
  if (!normalizedKind) return node

  const nextData: Record<string, unknown> = {
    ...data,
    kind: normalizedKind,
  }

  if (normalizedKind === 'video') {
    Object.assign(nextData, buildVideoDurationPatch(readVideoDurationSeconds(data, 5)))
  }

  if (normalizedKind === 'image' || normalizedKind === 'imageEdit') {
    if (typeof nextData.imageModel !== 'string' || !nextData.imageModel.trim()) {
      nextData.imageModel = getDefaultModel(normalizedKind === 'imageEdit' ? 'imageEdit' : 'image')
    }
  }

  return { ...node, data: nextData }
}

function upgradeImageFissionModel(node: Node): Node {
  return node
}

function enforceNodeSelectability(node: Node): Node {
  if (node.type !== 'taskNode') return node
  const data = getNodeDataRecord(node)
  const kind = typeof data.kind === 'string' ? data.kind.trim() : ''
  if (!kind) return node
  if (UNSELECTABLE_TASK_NODE_KINDS.has(kind)) {
    return {
      ...node,
      selectable: false,
      focusable: false,
      selected: false,
    }
  }

  // 兼容旧数据：之前部分节点会被强制设置为不可选中；这里在加载/创建时恢复可选中状态。
  const nextSelectable = node.selectable === false ? true : undefined
  const nextFocusable = node.focusable === false ? true : undefined
  if (nextSelectable == null && nextFocusable == null) return node
  return {
    ...node,
    ...(nextSelectable != null ? { selectable: nextSelectable } : null),
    ...(nextFocusable != null ? { focusable: nextFocusable } : null),
  }
}

function getRemixTargetIdFromNode(node?: Node) {
  if (!node) return null
  const data = getNodeDataRecord(node)
  const kind = typeof data.kind === 'string' ? data.kind.trim().toLowerCase() : ''
  const isVideoKind = kind === 'video'
  if (!isVideoKind) return null

  const sanitize = (val: unknown) => {
    if (typeof val !== 'string') return null
    const trimmed = val.trim()
    if (!trimmed) return null
    const lower = trimmed.toLowerCase()
    if (lower.startsWith('s_') || lower.startsWith('p/')) return trimmed
    return null
  }

  const videoResults = Array.isArray(data.videoResults) ? data.videoResults : []
  const primaryIndex =
    typeof data.videoPrimaryIndex === 'number' &&
    data.videoPrimaryIndex >= 0 &&
    data.videoPrimaryIndex < videoResults.length
      ? data.videoPrimaryIndex
      : videoResults.length > 0
        ? 0
        : -1
  const primaryResult = getRecordValue(primaryIndex >= 0 ? videoResults[primaryIndex] : null)

  const candidates = [
    sanitize(data.videoPostId),
    sanitize(primaryResult?.remixTargetId),
    sanitize(primaryResult?.pid),
    sanitize(primaryResult?.postId),
    sanitize(primaryResult?.post_id),
  ]

  for (const cand of candidates) {
    if (cand) return cand
  }
  return null
}

// Dragging generates high-frequency `position` updates. Track active drag node IDs so we can:
// - snapshot history only once per drag (better perf + better undo UX)
// - avoid expensive group auto-fit work during drag moves
const activeDragNodeIds = new Set<string>()

// Batch-insert reflow: when a canvas plan inserts multiple nodes at once, sizes are estimated
// before measurement. After React Flow reports real `dimensions`, we relax positions row-by-row
// to clear residual overlaps without disturbing previously placed nodes.
type PendingBatchReflow = {
  batchId: string
  pendingIds: Set<string>
  allIds: Set<string>
  scheduled: boolean
}
let pendingBatchReflow: PendingBatchReflow | null = null

const BATCH_REFLOW_EXTERNAL_PADDING = 24
const BATCH_REFLOW_EXTERNAL_MAX_ATTEMPTS = 8

function reflowBatchAfterMeasurement(batchIds: Set<string>): void {
  if (!batchIds.size) return
  if (activeDragNodeIds.size > 0) return

  const { nodes: initialNodes, edges } = useRFStore.getState()
  if (!initialNodes.length) return

  // canvasPlan 走 createCanvasPlanGroups 后大部分节点会有 parentId（group 内）。
  // 按 parentId 分桶：group 内的 batch 用 grid 重排（measured 已到位，能正确计入工具栏宽度）；
  // top-level 的 batch 走右向松弛 + 外部碰撞规避。
  const batchByParent = new Map<string, string[]>()
  let batchCountInLayout = 0
  for (const node of initialNodes) {
    if (!batchIds.has(node.id)) continue
    if (node.type === 'groupNode') continue
    const parentId = getNodeParentId(node) || ''
    const bucket = batchByParent.get(parentId)
    if (bucket) bucket.push(node.id)
    else batchByParent.set(parentId, [node.id])
    batchCountInLayout += 1
  }
  if (batchCountInLayout < 2) return

  let nextNodes: Node[] = initialNodes
  let changed = false

  for (const [parentId, ids] of batchByParent.entries()) {
    if (ids.length < 2) continue
    if (parentId) {
      // arrangeGroupChildrenInNodes 内部已经会通过 autoFitSingleGroupNode 调整 group 自身尺寸
      const arranged = arrangeGroupChildrenInNodes(nextNodes, edges, parentId, 'grid', ids)
      if (arranged !== nextNodes) {
        nextNodes = arranged
        changed = true
      }
    } else {
      const relaxed = gridReflowParentlessBatchInNodes(nextNodes, ids, edges)
      if (relaxed !== nextNodes) {
        nextNodes = relaxed
        changed = true
      }
    }
  }

  if (!changed) return

  // reflow 不进 history（与 isPureDragMove 同处理）
  useRFStore.setState({ nodes: nextNodes })
}

export function gridReflowParentlessBatchInNodes(nodes: Node[], parentlessIds: string[], edges: Edge[]): Node[] {
  const idSet = new Set(parentlessIds)
  const batchNodes = nodes.filter((n) => idSet.has(n.id))
  if (batchNodes.length < 2) return nodes

  // Real measured sizes are in by now, so lay the batch out as a compact grid via
  // the same engine group children use — top-level nodes carry absolute positions,
  // so the returned coordinates apply directly.
  const edgesInScope = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target))
  const { positions } = computeTreeLayout(batchNodes, edgesInScope, LAYOUT_GAP_X, LAYOUT_GAP_Y)
  if (!positions.size) return nodes

  const sizeById = new Map(batchNodes.map((n) => [n.id, getNodeSizeForLayout(n)] as const))
  let gridLeft = Infinity
  let gridTop = Infinity
  let gridRight = -Infinity
  let gridBottom = -Infinity
  positions.forEach((p, id) => {
    const size = sizeById.get(id)
    if (!size) return
    gridLeft = Math.min(gridLeft, p.x)
    gridTop = Math.min(gridTop, p.y)
    gridRight = Math.max(gridRight, p.x + size.w)
    gridBottom = Math.max(gridBottom, p.y + size.h)
  })
  if (!Number.isFinite(gridTop)) return nodes

  // Pre-existing top-level nodes the grid must not cover.
  const externalRects: NodeRect[] = []
  for (const node of nodes) {
    if (idSet.has(node.id)) continue
    if (node.type === 'groupNode') continue
    if (getNodeParentId(node)) continue
    const x = Number(node.position?.x ?? 0)
    const y = Number(node.position?.y ?? 0)
    const size = getNodeSizeForLayout(node)
    if (![x, y, size.w, size.h].every(Number.isFinite)) continue
    externalRects.push({ x, y, w: size.w, h: size.h })
  }

  // Push the whole grid straight down until it clears every external node.
  let shiftY = 0
  for (let attempt = 0; externalRects.length && attempt < BATCH_REFLOW_EXTERNAL_MAX_ATTEMPTS; attempt += 1) {
    const gridRect: NodeRect = { x: gridLeft, y: gridTop + shiftY, w: gridRight - gridLeft, h: gridBottom - gridTop }
    const hits = externalRects.filter((ext) => rectsOverlap(gridRect, ext, BATCH_REFLOW_EXTERNAL_PADDING))
    if (!hits.length) break
    const lowest = Math.max(...hits.map((ext) => ext.y + ext.h))
    shiftY = lowest + BATCH_REFLOW_EXTERNAL_PADDING - gridTop
  }

  return nodes.map((n) => {
    const next = positions.get(n.id)
    if (!next) return n
    const nextX = next.x
    const nextY = next.y + shiftY
    const curX = Number(n.position?.x ?? 0)
    const curY = Number(n.position?.y ?? 0)
    if (Math.abs(curX - nextX) < 0.5 && Math.abs(curY - nextY) < 0.5) return n
    return { ...n, position: { x: nextX, y: nextY } }
  })
}

// Per-drag intent set by GroupNode's NodeResizeControl.
// 'frame' = resize the group only, do not scale children (default).
// 'scale' = scale children by dominant axis (Shift held at resize start).
// 'idle'  = no active group resize.
export type GroupResizeIntent = 'frame' | 'scale' | 'idle'
const groupResizeIntentRef: { current: GroupResizeIntent } = { current: 'idle' }
export function setGroupResizeIntent(next: GroupResizeIntent): void {
  groupResizeIntentRef.current = next
}
export function getGroupResizeIntent(): GroupResizeIntent {
  return groupResizeIntentRef.current
}

// Module-scope live Shift tracker. The per-frame dim change in onNodesChange
// reads this directly, so users can press/release Shift mid-drag and have
// child scaling toggle on/off accordingly — not just at resize start.
const shiftHeldRef: { current: boolean } = { current: false }
if (typeof window !== 'undefined') {
  const onShiftKey = (e: KeyboardEvent) => {
    if (e.key !== 'Shift') return
    shiftHeldRef.current = e.type === 'keydown'
  }
  window.addEventListener('keydown', onShiftKey)
  window.addEventListener('keyup', onShiftKey)
}
export function isShiftHeld(): boolean {
  return shiftHeldRef.current
}

export const useRFStore = create<RFState>((set, get) => ({
  nodes: [],
  edges: [],
  nextId: 1,
  nextGroupId: 1,
  lastGroupArrangeDirection: 'grid',
  historyPast: [],
  historyFuture: [],
  clipboard: null,
  aiSessionRunningByNode: {},
  onNodesChange: (changes) => set((s) => {
    const dimChanges = new Map<string, { width?: number; height?: number }>()
    const safeEdgeInvariantChangeTypes = new Set(['position', 'select', 'dimensions'])
    // Dimension changes can come from:
    // - NodeResizer (explicit user resize): contains `resizing: boolean`
    // - internal measurement updates (no `resizing` flag)
    // Only the former should trigger "scale children by group resize"; otherwise it causes drift/flicker.
    const resizerDimChangeIds = new Set<string>()
    const movedNodeIds = new Set<string>()
    const dragStopNodeIds = new Set<string>()
    let hasDragMove = false
    let hasDragStop = false
    let isDragStart = false
    let hasNonDragRelatedChange = false
    let hasContentChange = false
    let needsEdgeSanitize = false

    for (const change of changes) {
      if (!change || typeof change !== 'object') continue
      const changeRecord = change as Record<string, unknown>
      const id = typeof changeRecord.id === 'string' ? changeRecord.id : ''
      const changeType = typeof changeRecord.type === 'string' ? changeRecord.type : ''

      if (!safeEdgeInvariantChangeTypes.has(changeType)) {
        needsEdgeSanitize = true
      }

      if (change.type === 'position') {
        if (id) movedNodeIds.add(id)
        const draggingFlag = changeRecord.dragging
        if (draggingFlag === true) {
          hasDragMove = true
          if (id && !activeDragNodeIds.has(id)) {
            activeDragNodeIds.add(id)
            isDragStart = true
          }
          continue
        }
        if (draggingFlag === false) {
          hasDragStop = true
          if (id) {
            activeDragNodeIds.delete(id)
            dragStopNodeIds.add(id)
          }
          continue
        }
        // Programmatic or non-drag position change: treat as normal update.
        hasNonDragRelatedChange = true
        hasContentChange = true
        continue
      }

      const isSelectionChange = change.type === 'select'

      if (change.type === 'dimensions') {
        if (!id) continue
        const dimensions = getRecordValue(changeRecord.dimensions)
        const width = Number(dimensions.width)
        const height = Number(dimensions.height)
        dimChanges.set(id, {
          ...(Number.isFinite(width) && width > 0 ? { width: Math.round(width) } : null),
          ...(Number.isFinite(height) && height > 0 ? { height: Math.round(height) } : null),
        })
        if (typeof changeRecord.resizing === 'boolean') {
          resizerDimChangeIds.add(id)
          hasContentChange = true
        }
        if (pendingBatchReflow && pendingBatchReflow.pendingIds.has(id)) {
          pendingBatchReflow.pendingIds.delete(id)
          if (pendingBatchReflow.pendingIds.size === 0 && !pendingBatchReflow.scheduled) {
            const ids = new Set(pendingBatchReflow.allIds)
            pendingBatchReflow.scheduled = true
            const consumed = pendingBatchReflow
            queueMicrotask(() => {
              if (pendingBatchReflow === consumed) pendingBatchReflow = null
              reflowBatchAfterMeasurement(ids)
            })
          }
        }
        continue
      }

      if (!isSelectionChange) {
        // Any remaining non-position change is a graph-content change, e.g. add/remove/replace.
        hasNonDragRelatedChange = true
        hasContentChange = true
      }
    }

    const rawUpdated = applyNodeChanges(changes, s.nodes)

    const updatedWithDims = dimChanges.size
      ? rawUpdated.map((node) => {
        const dims = dimChanges.get(node.id)
        if (!dims) return node
        const data = getNodeDataRecord(node)
        const kind = typeof data.kind === 'string' ? data.kind : ''
        const coreType = getTaskNodeCoreType(kind)
        const isCanvasMediaKind = coreType === 'image' || coreType === 'video'
        if (!isCanvasMediaKind) return node

        return {
          ...node,
          data: {
            ...node.data,
            ...(typeof dims.width === 'number' ? { nodeWidth: dims.width } : null),
            ...(typeof dims.height === 'number' ? { nodeHeight: dims.height } : null),
          },
        }
      })
      : rawUpdated

    const isPureDragMove =
      hasDragMove &&
      !hasDragStop &&
      !hasNonDragRelatedChange &&
      dimChanges.size === 0 &&
      !needsEdgeSanitize

    if (isPureDragMove) {
      if (!isDragStart) {
        return { nodes: updatedWithDims }
      }
      const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
      return { nodes: updatedWithDims, historyPast: past, historyFuture: [] }
    }

    const prevById = new Map(s.nodes.map((n) => [n.id, n] as const))
    // Treat "group resize" only when it comes from NodeResizer (has `resizing` flag).
    // This avoids scaling children on measurement-driven dimension updates.
    const hasGroupResize = Array.from(resizerDimChangeIds).some((id) => {
      const prev = prevById.get(id)
      return !!prev && prev.type === 'groupNode'
    })
    const childScaleById = new Map<string, number>()
    // Child scaling fires when EITHER:
    //   - GroupNode declared 'scale' intent at resize start (Shift held at mousedown), OR
    //   - Shift is currently held during this dim change (live toggle mid-drag).
    // Default 'frame' intent without Shift leaves children untouched.
    if (hasGroupResize && (groupResizeIntentRef.current === 'scale' || shiftHeldRef.current)) {
      const updatedById = new Map(updatedWithDims.map((n) => [n.id, n] as const))
      for (const [id, dims] of dimChanges.entries()) {
        if (!resizerDimChangeIds.has(id)) continue
        const prev = prevById.get(id)
        const next = updatedById.get(id)
        if (!prev || !next || prev.type !== 'groupNode') continue

        const oldSize = getNodeSize(prev)
        const nextWidth = typeof dims.width === 'number' ? dims.width : oldSize.w
        const nextHeight = typeof dims.height === 'number' ? dims.height : oldSize.h

        if (!Number.isFinite(oldSize.w) || !Number.isFinite(oldSize.h) || oldSize.w <= 0 || oldSize.h <= 0) continue
        if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight) || nextWidth <= 0 || nextHeight <= 0) continue

        const scaleX = nextWidth / oldSize.w
        const scaleY = nextHeight / oldSize.h
        // Use the dominant axis delta for uniform child scaling.
        // Using min(scaleX, scaleY) causes counter-intuitive shrink when one axis
        // is slightly reduced (or jittering) while the other axis is being enlarged.
        const scale =
          Math.abs(scaleX - 1) >= Math.abs(scaleY - 1)
            ? scaleX
            : scaleY
        if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 1e-6) continue

        for (const node of updatedWithDims) {
          if (getNodeParentId(node) !== id) continue
          if (node.type === 'groupNode') continue
          if (dimChanges.has(node.id)) continue
          if (!childScaleById.has(node.id)) childScaleById.set(node.id, scale)
        }
      }
    }

	    const updatedAfterGroupResize = childScaleById.size
	      ? updatedWithDims.map((node) => {
	        const scale = childScaleById.get(node.id)
	        if (!scale) return node
	        return scaleNodeByGroupResize(node, scale)
	      })
	      : updatedWithDims
	
	    const membershipMovedNodeIds = new Set<string>()
	    if (hasDragStop && dragStopNodeIds.size) {
	      for (const id of dragStopNodeIds) membershipMovedNodeIds.add(id)
	    }

	    const updatedWithGroupMembership =
	      membershipMovedNodeIds.size
	        ? applyGroupMembershipOnDragStop(updatedAfterGroupResize, membershipMovedNodeIds)
	        : updatedAfterGroupResize

	    const updatedAfterMembershipLayout = ensureParentFirstOrder(updatedWithGroupMembership)

	    // Auto-fit non-manual groups whenever something has settled:
	    //   - drag stop (child moved into/out of a group, or a child within a group resettled)
	    //   - explicit group resize end (`hasGroupResize` covers NodeResizer events)
	    //   - dimension measurement updates (image loaded, content height changed)
	    // We skip auto-fit during pure drag-move (already short-circuited above by isPureDragMove).
	    // Auto-fit is idempotent and bails out when no group changes — safe to call here.
	    const shouldAutoFitGroups = hasDragStop || hasGroupResize || dimChanges.size > 0
	    const updatedBeforeSanitize = shouldAutoFitGroups
	      ? autoFitGroupNodes(updatedAfterMembershipLayout).map(enforceNodeSelectability)
	      : updatedAfterMembershipLayout
	    const updated = ensureParentFirstOrder(updatedBeforeSanitize.map(stripNodePositionInternals))
    const shouldCaptureHistory = hasContentChange || isDragStart
    const sanitizedEdges = needsEdgeSanitize ? sanitizeEdgesForNodes(updated, s.edges) : s.edges
    if (!shouldCaptureHistory) {
      return sanitizedEdges === s.edges ? { nodes: updated } : { nodes: updated, edges: sanitizedEdges }
    }

    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: updated, edges: sanitizedEdges, historyPast: past, historyFuture: [] }
  }),
  onEdgesChange: (changes) => set((s) => {
    const updated = applyEdgeChanges(changes, s.edges)
    const hasContentChange = changes.some((change) => change.type !== 'select')
    const sanitized = hasContentChange ? sanitizeEdgesForNodes(s.nodes, updated) : updated
    if (!hasContentChange) {
      return { edges: sanitized }
    }
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { edges: sanitized, historyPast: past, historyFuture: [] }
  }),
	  onConnect: (connection: Connection) => set((s) => {
	    const connectionWithStyle = connection as CanvasConnectionWithStyleFields
	    const exists = s.edges.some((e) =>
	      e.source === connection.source &&
      e.target === connection.target &&
      e.sourceHandle === connection.sourceHandle &&
      e.targetHandle === connection.targetHandle
    )
    const nextEdges = exists
      ? s.edges
      : addEdge(
	          {
	            ...connection,
	            animated: connectionWithStyle.animated === true,
	            type: typeof connectionWithStyle.type === 'string' && connectionWithStyle.type.trim()
	              ? connectionWithStyle.type
	              : 'typed',
	          },
          s.edges,
        )
    const sanitizedEdges = sanitizeEdgesForNodes(s.nodes, nextEdges)
    const past = exists ? s.historyPast : [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    if (exists) {
      return { edges: sanitizedEdges }
    }

    let updatedNodes = s.nodes
    if (connection.target && connection.source) {
      const targetNode = s.nodes.find((n) => n.id === connection.target)
      const sourceNode = s.nodes.find((n) => n.id === connection.source)
      if (
        targetNode &&
        getTaskNodeCoreType(typeof (targetNode.data as Record<string, unknown> | undefined)?.kind === 'string' ? String((targetNode.data as Record<string, unknown>).kind) : null) === 'video' &&
        sourceNode &&
        getTaskNodeCoreType(typeof (sourceNode.data as Record<string, unknown> | undefined)?.kind === 'string' ? String((sourceNode.data as Record<string, unknown>).kind) : null) === 'video'
      ) {
        const remixId = getRemixTargetIdFromNode(sourceNode)
        if (remixId) {
          updatedNodes = s.nodes.map((n) =>
            n.id === connection.target
              ? { ...n, data: { ...n.data, remixTargetId: remixId } }
              : n,
          )
        }
      }
    }

    return {
      nodes: updatedNodes,
      edges: sanitizedEdges,
      historyPast: past,
      historyFuture: [],
    }
  }),
  addNode: (type, label, extra) => set((s) => {
    if (type === 'groupNode') return {}
    const id = genNodeId()
    const rawExtra: Record<string, unknown> = extra || {}
    const { label: extraLabel, autoLabel, position: preferredPosition, parentId: requestedParentIdRaw, ...restExtra } = rawExtra
    const requestedParentId =
      typeof requestedParentIdRaw === 'string' && requestedParentIdRaw.trim()
        ? requestedParentIdRaw.trim()
        : null
    const desiredParentId = requestedParentId
    const parentId =
      desiredParentId && s.nodes.some((n) => n.type === 'groupNode' && n.id === desiredParentId)
        ? desiredParentId
        : null
    let finalLabel = label ?? extraLabel ?? type
    const allowAutoLabel = type === 'taskNode' && autoLabel !== false
    if (allowAutoLabel) {
      const kind = normalizeTaskNodeKind(typeof restExtra.kind === 'string' ? restExtra.kind : null) || null
      const schema = getTaskNodeSchema(kind)
      const schemaLabel = schema.label || kind || '节点'
      const sameKindCount = s.nodes.filter((n) => {
        if (n.type !== 'taskNode') return false
        const nodeKind = readNodeDataRecord(n).kind
        return normalizeTaskNodeKind(typeof nodeKind === 'string' ? nodeKind : null) === kind
      }).length
      const autoGeneratedLabel = `${schemaLabel}-${sameKindCount + 1}`
      const normalizedLabel = typeof finalLabel === 'string' ? finalLabel.trim() : ''
      const normalizedLabelLower = normalizedLabel.toLowerCase()
      const kindLower = typeof kind === 'string' ? kind.toLowerCase() : null
      const shouldUseAutoLabel =
        !normalizedLabel ||
        normalizedLabel === type ||
        normalizedLabel === schemaLabel ||
        (kindLower ? normalizedLabelLower === kindLower : false)
      if (shouldUseAutoLabel) {
        finalLabel = autoGeneratedLabel
      }
    }
    const taskKind =
      type === 'taskNode'
        ? normalizeTaskNodeKind(typeof restExtra.kind === 'string' ? restExtra.kind : null) || null
        : null
    const taskCoreType = taskKind ? getTaskNodeCoreType(taskKind) : null
    const taskFallbackSize =
      type === 'taskNode'
        ? estimateNodeRenderSize({
            kind: taskKind ?? undefined,
            coreType: taskCoreType ?? undefined,
          })
        : null
    const fallbackW = taskFallbackSize ? taskFallbackSize.w : 220
    const fallbackH = taskFallbackSize ? taskFallbackSize.h : 120
    const defaultPosition = computeContextAwarePosition(s.nodes, { w: fallbackW, h: fallbackH })
    const preferredPositionRecord = getRecordValue(preferredPosition)
    const preferredX = Number(preferredPositionRecord.x)
    const preferredY = Number(preferredPositionRecord.y)
    const hasPreferred = Number.isFinite(preferredX) && Number.isFinite(preferredY)
    let position: XY = hasPreferred ? { x: preferredX, y: preferredY } : defaultPosition
	    if (!hasPreferred && parentId) {
	      const siblings = s.nodes
	        .filter((n) => getNodeParentId(n) === parentId && n.type === 'taskNode')
	        .sort((a, b) => {
          const ay = Number(a.position?.y ?? 0)
          const by = Number(b.position?.y ?? 0)
          if (ay !== by) return ay - by
          const ax = Number(a.position?.x ?? 0)
          const bx = Number(b.position?.x ?? 0)
          return ax - bx
        })
      if (!siblings.length) {
        position = { x: 24, y: 24 }
      } else {
        const last = siblings[siblings.length - 1]
        const lastY = Number(last.position?.y ?? 24)
        position = { x: 24, y: Number.isFinite(lastY) ? lastY + 96 : 120 }
      }
    }
    position = resolveNonOverlappingPosition(s.nodes, position, { w: fallbackW, h: fallbackH }, parentId)

    let dataExtra = restExtra
    if (type === 'taskNode') {
      const hasResolvedAssetUrl = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0
      const hasResolvedAssetList = (value: unknown): boolean =>
        Array.isArray(value) &&
        value.some((item) => {
          if (!item || typeof item !== 'object') return false
          const record = item as Record<string, unknown>
          return typeof record.url === 'string' && record.url.trim().length > 0
        })
      const taskNodeData = dataExtra as Record<string, unknown>
      const runtimeStatus = typeof taskNodeData.status === 'string' ? taskNodeData.status.trim().toLowerCase() : ''
      const isReferenceOnlyTaskNode =
        runtimeStatus !== 'queued' &&
        runtimeStatus !== 'running' &&
        (
          hasResolvedAssetUrl(taskNodeData.imageUrl) ||
          hasResolvedAssetUrl(taskNodeData.videoUrl) ||
          hasResolvedAssetUrl(taskNodeData.audioUrl) ||
          hasResolvedAssetList(taskNodeData.imageResults) ||
          hasResolvedAssetList(taskNodeData.videoResults) ||
          hasResolvedAssetList(taskNodeData.audioResults) ||
          hasResolvedAssetList(taskNodeData.results) ||
          hasResolvedAssetList(taskNodeData.assets) ||
          hasResolvedAssetList(taskNodeData.outputs)
        )
      const rawKindValue = typeof taskNodeData.kind === 'string' ? taskNodeData.kind.trim() : ''
      const kindValue =
        normalizeTaskNodeKind(rawKindValue) || null
      if (kindValue && kindValue !== dataExtra.kind) {
        dataExtra = {
          ...dataExtra,
          kind: kindValue,
        }
      }
      if (kindValue === 'video' && !isReferenceOnlyTaskNode && taskNodeData.videoModel == null) {
        dataExtra = {
          ...dataExtra,
          videoModelVendor:
            taskNodeData.videoModelVendor ?? null,
        }
      }

      if (kindValue === 'video' && !isReferenceOnlyTaskNode) {
        dataExtra = {
          ...dataExtra,
          ...buildVideoDurationPatch(
            readVideoDurationSeconds(dataExtra as Record<string, unknown>, 5),
          ),
        }
      }

      if (kindValue === 'imageEdit' && !isReferenceOnlyTaskNode && taskNodeData.imageModel == null) {
        dataExtra = {
          ...dataExtra,
          imageModel: getDefaultModel('imageEdit'),
          imageModelVendor:
            taskNodeData.imageModelVendor ?? null,
        }
      }

      if (kindValue === 'text') {
        const latestTaskNodeData = dataExtra as Record<string, unknown>
        const profile = getNodeSizeProfile({ coreType: 'text' })
        const hasNodeWidth =
          typeof latestTaskNodeData.nodeWidth === 'number' && Number.isFinite(latestTaskNodeData.nodeWidth)
        const hasNodeHeight =
          typeof latestTaskNodeData.nodeHeight === 'number' && Number.isFinite(latestTaskNodeData.nodeHeight)
        dataExtra = {
          ...dataExtra,
          ...(hasNodeWidth ? null : { nodeWidth: profile.defaultW }),
          ...(hasNodeHeight ? null : { nodeHeight: profile.defaultH }),
        }
      }

      const kindCoreType = kindValue ? getTaskNodeCoreType(kindValue) : null
      const isCanvasMediaKind = kindCoreType === 'image' || kindCoreType === 'video'
      if (isCanvasMediaKind) {
        const latestTaskNodeData = dataExtra as Record<string, unknown>
        const hasNodeWidth =
          typeof latestTaskNodeData.nodeWidth === 'number' && Number.isFinite(latestTaskNodeData.nodeWidth)
        const hasNodeHeight =
          typeof latestTaskNodeData.nodeHeight === 'number' && Number.isFinite(latestTaskNodeData.nodeHeight)
        const profile = getNodeSizeProfile({
          kind: kindValue ?? undefined,
          coreType: kindCoreType,
        })
        const baseW = hasNodeWidth ? (latestTaskNodeData.nodeWidth as number) : profile.defaultW
        let baseH = profile.defaultH
        if (!hasNodeHeight) {
          const parsed = parseAspectRatioField(latestTaskNodeData.aspectRatio ?? latestTaskNodeData.size ?? latestTaskNodeData.videoSize)
          if (parsed) baseH = computeMediaNodeHeight(baseW, parsed.w, parsed.h, profile)
        }
        dataExtra = {
          ...dataExtra,
          ...(hasNodeWidth ? null : { nodeWidth: baseW }),
          ...(hasNodeHeight ? null : { nodeHeight: baseH }),
        }
      }

    }

      const node: Node = {
      id,
	      type,
      position,
      ...(parentId ? { parentId } : {}),
      data: normalizeProductionNodeMetaRecord({ label: finalLabel, ...dataExtra }, { kind: dataExtra.kind ?? type }),
    }
    const nextNodesRaw = [...s.nodes, enforceNodeSelectability(node)]
    const nextNodes = ensureParentFirstOrder(nextNodesRaw)
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: nextNodes, nextId: s.nextId + 1, historyPast: past, historyFuture: [] }
  }),
  reset: () => set({ nodes: [], edges: [], nextId: 1, nextGroupId: 1, lastGroupArrangeDirection: 'grid' }),
  load: (data, options) => {
    if (!data) return
    const sanitized = sanitizeGraphForCanvas(data)
	    // load and normalize graph payload
		    const upgradedNodes = (sanitized.nodes || [])
	      .map(normalizeNodeParentId)
	      .map(upgradeVideoKind)
	      .map(upgradeImageFissionModel)
        .map(normalizeWorkflowNodeMeta)
	      .map(normalizeProductionNodeMeta)
	      .map(enforceNodeSelectability)
    const layoutMode = options?.layout ?? 'preserve'
    const historyMode = options?.history ?? 'push'
    const webHeroLayoutNodes = normalizePptDeckTopLevelLayout(normalizeWebHeroTopLevelLayout(upgradedNodes))
    const baseNodes = layoutMode === 'preserve'
      ? ensureParentFirstOrder(restoreExistingNodePositions(webHeroLayoutNodes, upgradedNodes))
      : webHeroLayoutNodes
    const layoutResolvedNodes = (() => {
      if (layoutMode === 'preserve') return baseNodes

      // Explicit layout modes may repair or rewrite positions. Plain load/refresh must not, because
      // it represents persisted server coordinates rather than a user/Agent layout command.
      const intraGroupFixed = resolveIntraGroupOverlaps(baseNodes)
      const fittedNodes = autoFitGroupNodes(intraGroupFixed)
      return layoutMode === 'dagReflow'
        ? applyDagTreeLayout(fittedNodes, sanitized.edges).nodes
        : relayoutSiblingsAlongFlow(fittedNodes, sanitized.edges, { kind: 'topLevel' })
    })()
	    set((s) => ({
      // 按 id 协调：未变节点/边复用旧引用，使 React Flow 的 memo 成立、不重渲染（去闪烁）。
      nodes: reconcileById(s.nodes, layoutResolvedNodes),
      edges: reconcileById(s.edges, sanitized.edges),
      nextId: layoutResolvedNodes.length + 1,
      nextGroupId: computeNextGroupId(layoutResolvedNodes),
      historyPast: historyMode === 'preserve'
        ? s.historyPast
        : [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: historyMode === 'preserve' ? s.historyFuture : [],
    }))
  },
  removeSelected: () => set((s) => {
    const selectedNodes = s.nodes.filter(n => n.selected)
    const selectedIds = new Set(selectedNodes.map(n => n.id))

    // 收集所有需要删除的节点ID：包括选中的节点和它们的子节点
    const idsToDelete = new Set<string>()
    selectedIds.forEach(id => {
      idsToDelete.add(id)

	      // 如果选中的是组节点，添加所有子节点
	      const node = selectedNodes.find(n => n.id === id)
	      if (node?.type === 'groupNode') {
	        const childNodes = s.nodes.filter(n => getNodeParentId(n) === id)
	        childNodes.forEach(child => idsToDelete.add(child.id))
	      }
	    })

	    // 如果选中的是子节点，也检查是否需要删除父节点（如果父节点的所有子节点都被选中）
	    const selectedChildNodes = selectedNodes.filter(n => {
	      const pid = getNodeParentId(n)
	      return pid != null && selectedIds.has(pid)
	    })
	    selectedChildNodes.forEach(child => {
	      const pid = getNodeParentId(child)
	      const parentNode = pid ? s.nodes.find(n => n.id === pid) : undefined
	      if (parentNode && parentNode.type === 'groupNode') {
	        const allChildren = s.nodes.filter(n => getNodeParentId(n) === parentNode.id)
	        const allChildrenSelected = allChildren.every(child => selectedIds.has(child.id))

	        // 如果所有子节点都被选中，也删除父节点
	        if (allChildrenSelected) {
          idsToDelete.add(parentNode.id)
        }
      }
    })

    // 删除节点和相关边
    const remainingNodes = s.nodes.filter(n => !idsToDelete.has(n.id))
    const remainingEdges = s.edges.filter(e =>
      !idsToDelete.has(e.source) && !idsToDelete.has(e.target)
    )
    const nextNodes = ensureParentFirstOrder(remainingNodes)

    return {
      nodes: nextNodes,
      edges: remainingEdges,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  updateNodeLabel: (id, label) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)),
    historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
    historyFuture: [],
  })),
  updateNodeData: (id, patch) => set((s) => {
    const normalizedPatch =
      patch && typeof patch === 'object'
        ? { ...(patch as Record<string, unknown>) }
        : {}
    if (typeof normalizedPatch.kind === 'string') {
      const normalizedKind = normalizeTaskNodeKind(normalizedPatch.kind)
      if (normalizedKind) normalizedPatch.kind = normalizedKind
    }
    if (Object.keys(normalizedPatch).length === 0) return s

    let changed = false
    const nextNodes = s.nodes.map((node) => {
      if (node.id !== id) return node
      const currentData =
        node.data && typeof node.data === 'object'
          ? (node.data as Record<string, unknown>)
          : {}
      const nextData = {
        ...currentData,
        ...normalizedPatch,
      }
      const nextEntries = Object.entries(nextData)
      for (const [key, value] of nextEntries) {
        if (!Object.is(currentData[key], value)) {
          changed = true
          break
        }
      }
      if (!changed && nextEntries.length !== Object.keys(currentData).length) {
        changed = true
      }
      if (!changed) return node
      return {
        ...node,
        data: nextData,
      }
    })

    if (!changed) return s

    return {
      nodes: nextNodes,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  appendImportedNodes: (nodes) => set((s) => {
    if (!nodes.length) return {}
    return {
      nodes: [...s.nodes, ...nodes],
      nextId: s.nextId + nodes.length,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  patchNodeDataWithoutHistory: (id, patch) => set((s) => {
    const normalizedPatch =
      patch && typeof patch === 'object'
        ? { ...(patch as Record<string, unknown>) }
        : {}
    if (Object.keys(normalizedPatch).length === 0) return {}

    let changed = false
    const nextNodes = s.nodes.map((node) => {
      if (node.id !== id) return node
      const currentData =
        node.data && typeof node.data === 'object'
          ? (node.data as Record<string, unknown>)
          : {}
      const nextData = {
        ...currentData,
        ...normalizedPatch,
      }
      const nextEntries = Object.entries(nextData)
      for (const [key, value] of nextEntries) {
        if (!Object.is(currentData[key], value)) {
          changed = true
          break
        }
      }
      if (!changed && nextEntries.length !== Object.keys(currentData).length) {
        changed = true
      }
      return changed ? { ...node, data: nextData } : node
    })

    return changed ? { nodes: nextNodes } : {}
  }),
  setNodeStatus: (id, status, patch) => {
    const sanitizedPatch: Record<string, unknown> =
      patch && typeof patch === 'object'
        ? { ...(patch as Record<string, unknown>) }
        : {}

    if ('lastError' in sanitizedPatch) {
      const message = formatErrorMessage(sanitizedPatch.lastError).trim()
      const rawLastError = sanitizedPatch.lastError
      if (message && rawLastError && typeof rawLastError === 'object' && !Array.isArray(rawLastError)) {
        sanitizedPatch.lastError = {
          ...(rawLastError as Record<string, unknown>),
          message,
        }
      } else {
        sanitizedPatch.lastError = message || undefined
      }
    }

    // Prevent stale error metadata from leaking into unrelated errors/success states.
    const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(sanitizedPatch, key)
    if (status === 'error') {
      if (!hasOwn('httpStatus')) sanitizedPatch.httpStatus = null
      if (!hasOwn('isQuotaExceeded')) sanitizedPatch.isQuotaExceeded = false
    } else {
      if (!hasOwn('lastError')) sanitizedPatch.lastError = undefined
      if (!hasOwn('httpStatus')) sanitizedPatch.httpStatus = null
      if (!hasOwn('isQuotaExceeded')) sanitizedPatch.isQuotaExceeded = false
    }
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== id) return n
        const currentData =
          n.data && typeof n.data === 'object'
            ? (n.data as Record<string, unknown>)
            : {}
        const nextDataBase: Record<string, unknown> = {
          ...currentData,
          status,
          ...sanitizedPatch,
        }
        return {
          ...n,
          data: nextDataBase,
        }
      })
    }))

    // 终态必须持久化，后端 wait/review 才能读取到同一节点的真实完成或失败事实。
    if (status === 'success' || status === 'error') {
      scheduleSilentProjectSave()
    }
  },
  markNodeAiSessionRunning: (nodeId, sessionKey) => {
    const id = (nodeId || '').trim()
    const key = (sessionKey || '').trim()
    if (!id || !key) return
    set((s) => {
      const current = s.aiSessionRunningByNode[id]
      if (current && current[key]) return {}
      const nextForNode: Record<string, true> = { ...(current || {}), [key]: true }
      return { aiSessionRunningByNode: { ...s.aiSessionRunningByNode, [id]: nextForNode } }
    })
  },
  clearNodeAiSessionRunning: (nodeId, sessionKey) => {
    const id = (nodeId || '').trim()
    const key = (sessionKey || '').trim()
    if (!id || !key) return
    set((s) => {
      const current = s.aiSessionRunningByNode[id]
      if (!current || !current[key]) return {}
      const { [key]: _removed, ...rest } = current
      const nextMap = { ...s.aiSessionRunningByNode }
      if (Object.keys(rest).length === 0) delete nextMap[id]
      else nextMap[id] = rest
      return { aiSessionRunningByNode: nextMap }
    })
  },
  clearAllNodesForAiSession: (sessionKey) => {
    const key = (sessionKey || '').trim()
    if (!key) return
    set((s) => {
      let changed = false
      const next: Record<string, Record<string, true>> = {}
      for (const [nodeId, sessions] of Object.entries(s.aiSessionRunningByNode)) {
        if (!sessions[key]) {
          next[nodeId] = sessions
          continue
        }
        changed = true
        const { [key]: _removed, ...rest } = sessions
        if (Object.keys(rest).length > 0) next[nodeId] = rest
      }
      if (!changed) return {}
      return { aiSessionRunningByNode: next }
    })
  },
	  appendLog: (id, line) => set((s) => ({
	    nodes: s.nodes.map((n) => {
	      if (n.id !== id) return n
	      const data = readNodeDataRecord(n)
	      const logs = Array.isArray(data.logs) ? data.logs : []
	      return { ...n, data: { ...data, logs: [...logs, line] } }
	    })
	  })),
  beginRunToken: (id) => {
    const runToken = genRunToken()
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== id) return n
        const currentData =
          n.data && typeof n.data === 'object' && !Array.isArray(n.data)
            ? (n.data as Record<string, unknown>)
            : {}
        return {
          ...n,
          data: {
            ...currentData,
            canceled: false,
            runToken,
            lastError: undefined,
            lastResult: undefined,
            httpStatus: null,
            isQuotaExceeded: false,
            imageTaskId: '',
            imageTaskKind: '',
            videoTaskId: '',
          },
        }
      }),
    }))
    return runToken
  },
  endRunToken: (id) => set((s) => s),
  cancelNode: (id) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, canceled: true } } : n))
  })),
  isCanceled: (id, runToken) => {
    const n = get().nodes.find((x) => x.id === id)
    if (!n) return true
    const data = readNodeDataRecord(n)
    const canceled = Boolean(data.canceled)
    if (canceled) return true
    if (runToken == null) return false
    const currentToken = data.runToken
    if (typeof currentToken !== 'string' || !currentToken.trim()) return true
    return currentToken !== runToken
  },
  runSelected: async () => {
    const s = get()
    const selected = s.nodes.find((n) => n.selected)
    if (!selected) return
    const selectedKind = readNodeDataRecord(selected).kind
    const kind = normalizeTaskNodeKind(typeof selectedKind === 'string' ? selectedKind : undefined)
    if (!kind) return
    const coreType = getTaskNodeCoreType(kind)
    if (coreType === 'text') return
    if (coreType === 'image' || coreType === 'video') {
      await runNodeDagToTarget(selected.id, get, set, { concurrency: 1 })
      return
    }
    await runNodeMock(selected.id, get, set)
  },
  runDag: async (concurrency: number) => {
    await runFlowDag(Math.max(1, Math.min(8, Math.floor(concurrency || 2))), get, set)
  },
  copySelected: () => set((s) => {
    const selNodes = s.nodes.filter((n) => n.selected)
    if (!selNodes.length) return { clipboard: null }
    const selIds = new Set(selNodes.map((n) => n.id))
    const selEdges = s.edges.filter((e) => selIds.has(e.source) && selIds.has(e.target) && e.selected)
    const graph = { nodes: selNodes, edges: selEdges }
    // 尝试同时复制到系统剪贴板，便于粘贴到外部文档
    try {
      const text = JSON.stringify(graph, null, 2)
      void navigator.clipboard?.writeText(text)
    } catch {
      // ignore clipboard errors
    }
    return { clipboard: graph }
  }),
  pasteFromClipboard: () => set((s) => {
    if (!s.clipboard || !s.clipboard.nodes.length) return {}
    const offset = { x: 24, y: 24 }
    const idMap = new Map<string, string>()
    const newNodes: Node[] = s.clipboard.nodes.map((n) => {
      const newId = genNodeId()
      idMap.set(n.id, newId)
      return {
        ...n,
        id: newId,
        selected: false,
        position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
      }
    })
    const newEdges: Edge[] = s.clipboard.edges
      .map((e) => ({
        ...e,
        id: `${idMap.get(e.source)}-${idMap.get(e.target)}-${Math.random().toString(36).slice(2, 6)}`,
        source: idMap.get(e.source) || e.source,
        target: idMap.get(e.target) || e.target,
        selected: false,
      }))
      .filter((e) => e.source !== e.target)

    const nextNodesRaw = [...s.nodes, ...newNodes.map(enforceNodeSelectability)]
    const nextNodes = ensureParentFirstOrder(nextNodesRaw)

    return {
      nodes: nextNodes,
      edges: [...s.edges, ...newEdges],
      nextId: s.nextId + newNodes.length,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  undo: () => set((s) => {
    if (!s.historyPast.length) return {}
    const previous = s.historyPast[s.historyPast.length - 1]
    const rest = s.historyPast.slice(0, -1)
    const future = [cloneGraph(s.nodes, s.edges), ...s.historyFuture].slice(0, 50)
    return { nodes: previous.nodes, edges: previous.edges, historyPast: rest, historyFuture: future }
  }),
  redo: () => set((s) => {
    if (!s.historyFuture.length) return {}
    const next = s.historyFuture[0]
    const future = s.historyFuture.slice(1)
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: next.nodes, edges: next.edges, historyPast: past, historyFuture: future }
  }),
  deleteNode: (id) => set((s) => {
    const nextNodesRaw = s.nodes.filter(n => n.id !== id)
    const nextNodes = ensureParentFirstOrder(nextNodesRaw)
    return {
      nodes: nextNodes,
      edges: s.edges.filter(e => e.source !== id && e.target !== id),
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  deleteEdge: (id) => set((s) => ({
    edges: s.edges.filter(e => e.id !== id),
    historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
    historyFuture: [],
  })),
  reorderEdgeForTarget: (edgeId, direction) => set((s) => {
    const targetEdge = s.edges.find((edge) => edge.id === edgeId)
    if (!targetEdge) return {}

    const inboundIndices = s.edges
      .map((edge, index) => ({ edge, index }))
      .filter(({ edge }) => edge.target === targetEdge.target)
    if (inboundIndices.length < 2) return {}

    const displayOrdered = inboundIndices.map(({ edge }) => edge).reverse()
    const currentIndex = displayOrdered.findIndex((edge) => edge.id === edgeId)
    if (currentIndex < 0) return {}

    const delta = direction === 'left' ? -1 : 1
    const nextIndex = currentIndex + delta
    if (nextIndex < 0 || nextIndex >= displayOrdered.length) return {}

    const reorderedDisplay = displayOrdered.slice()
    const [moved] = reorderedDisplay.splice(currentIndex, 1)
    if (!moved) return {}
    reorderedDisplay.splice(nextIndex, 0, moved)
    const reorderedInbound = reorderedDisplay.reverse()

    const nextEdges = s.edges.slice()
    inboundIndices.forEach(({ index }, inboundIndex) => {
      const replacement = reorderedInbound[inboundIndex]
      if (replacement) nextEdges[index] = replacement
    })

    return {
      edges: nextEdges,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  duplicateNode: (id) => set((s) => {
    const n = s.nodes.find(n => n.id === id)
    if (!n) return {}
    const newId = genNodeId()
    const dup: Node = {
      ...n,
      id: newId,
      data: sanitizeNodeDataForCanvasClone(n.data) as Node['data'],
      position: { x: n.position.x + 24, y: n.position.y + 24 },
      selected: false,
    }
    const nextNodesRaw = [...s.nodes, enforceNodeSelectability(dup)]
    const nextNodes = ensureParentFirstOrder(nextNodesRaw)
    return { nodes: nextNodes, nextId: s.nextId + 1, historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50), historyFuture: [] }
  }),
  pasteFromClipboardAt: (pos) => set((s) => {
    if (!s.clipboard || !s.clipboard.nodes.length) return {}
    const importBounds = getRootImportBounds(s.clipboard.nodes)
    const anchor = importBounds
      ? { x: importBounds.x, y: importBounds.y }
      : { x: 0, y: 0 }
    const shift = { x: pos.x - anchor.x, y: pos.y - anchor.y }
    const idMap = new Map<string, string>()
    const newNodes: Node[] = s.clipboard.nodes.map((n) => {
      const newId = genNodeId()
      idMap.set(n.id, newId)
      const upgraded = normalizeNodeParentId(upgradeVideoKind(upgradeImageFissionModel(n)))
      const oldParentId = getNodeParentId(upgraded)
      const mappedParentId = oldParentId ? idMap.get(oldParentId) : undefined
      const basePos = upgraded.position || { x: 0, y: 0 }
      return enforceNodeSelectability({
        ...upgraded,
        id: newId,
        data: sanitizeNodeDataForCanvasClone(upgraded.data) as Node['data'],
        parentId: mappedParentId,
        selected: false,
        position: mappedParentId
          ? { x: basePos.x, y: basePos.y }
          : { x: basePos.x + shift.x, y: basePos.y + shift.y },
      })
    })
    const newEdges: Edge[] = s.clipboard.edges.map((e) => ({
      ...e,
      id: `${idMap.get(e.source)}-${idMap.get(e.target)}-${Math.random().toString(36).slice(2, 6)}`,
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
      selected: false,
    }))
    const nextNodes = ensureParentFirstOrder([...s.nodes, ...newNodes])

    return {
      nodes: nextNodes,
      edges: [...s.edges, ...newEdges],
      nextId: s.nextId + newNodes.length,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  importWorkflow: (workflowData, position) => set((s) => {
    const sanitized = sanitizeGraphForCanvas(workflowData)
    if (!sanitized.nodes.length) return {}

    const importBounds = getRootImportBounds(sanitized.nodes)
    const pos = position || resolveViewportImportPosition(
      importBounds ? { w: importBounds.w, h: importBounds.h } : undefined,
    )
    const anchor = importBounds
      ? { x: importBounds.x, y: importBounds.y }
      : { x: 0, y: 0 }
    const shift = { x: pos.x - anchor.x, y: pos.y - anchor.y }

    const idMap = new Map<string, string>()
    const newNodes: Node[] = sanitized.nodes.map((n) => {
      const newId = genNodeId()
      idMap.set(n.id, newId)
      const upgraded = normalizeNodeParentId(upgradeVideoKind(upgradeImageFissionModel(n)))
      const oldParentId = getNodeParentId(upgraded)
      const mappedParentId = oldParentId ? idMap.get(oldParentId) || undefined : undefined
      const basePos = upgraded.position || { x: 0, y: 0 }
      const clonedData = sanitizeNodeDataForCanvasClone(upgraded.data) as Record<string, unknown>
      return enforceNodeSelectability({
        ...upgraded,
        id: newId,
        parentId: mappedParentId,
        selected: false,
        dragging: false,
        position: mappedParentId
          ? { x: basePos.x, y: basePos.y }
          : { x: basePos.x + shift.x, y: basePos.y + shift.y },
        // 清理状态相关的数据
        data: {
          ...clonedData,
          status: undefined,
          progress: undefined,
          logs: undefined,
          canceled: undefined,
          lastError: undefined
        }
      })
    })
    const newEdges: Edge[] = sanitized.edges.map((e) => ({
      ...e,
      id: `${idMap.get(e.source)}-${idMap.get(e.target)}-${Math.random().toString(36).slice(2, 6)}`,
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
      selected: false,
      animated: false
    }))
    const nextNodes = ensureParentFirstOrder([...s.nodes, ...newNodes])

    return {
      nodes: nextNodes,
      edges: [...s.edges, ...newEdges],
      nextId: s.nextId + newNodes.length,
      nextGroupId: Math.max(s.nextGroupId, computeNextGroupId([...s.nodes, ...newNodes])),
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  selectAll: () => set((s) => ({
    nodes: s.nodes.map(n => ({ ...n, selected: n.selectable === false ? false : true })),
    edges: s.edges.map(e => ({ ...e, selected: true })),
  })),
  clearSelection: () => set((s) => ({
    nodes: s.nodes.map(n => ({ ...n, selected: false })),
    edges: s.edges.map(e => ({ ...e, selected: false })),
  })),
  invertSelection: () => set((s) => ({
    nodes: s.nodes.map(n => ({ ...n, selected: n.selectable === false ? false : !n.selected })),
    edges: s.edges.map(e => ({ ...e, selected: !e.selected })),
  })),
  createScriptBundleFromSelection: (name) => set((s) => {
    const selectedNodes = s.nodes.filter((node) => node.selected && node.type !== 'groupNode')
    const textualNodes = selectedNodes.filter((node) => {
      const kind = getNodeTextField(node, 'kind')
      return SCRIPT_BUNDLE_KINDS.has(kind) && Boolean(getScriptBundleNodeContent(node))
    })
    if (textualNodes.length < 2) return {}

    const orderedNodes = orderScriptBundleNodes(textualNodes, s.edges)
    const bundlePrompt = buildScriptBundlePrompt(orderedNodes)
    if (!bundlePrompt.trim()) return {}

    const bundleId = genNodeId()
    const bundleLabel = typeof name === 'string' && name.trim() ? name.trim() : buildScriptBundleLabel(orderedNodes)
    const parentIds = new Set(orderedNodes.map((node) => getNodeParentId(node) || ''))
    const parentId = parentIds.size === 1 ? (Array.from(parentIds)[0] || null) : null
    const nodesById = new Map(s.nodes.map((node) => [node.id, node] as const))
    const boxes = orderedNodes.map((node) => {
      const abs = getNodeAbsPosition(node, nodesById)
      const size = getNodeSizeForLayout(node)
      return {
        x: abs.x,
        y: abs.y,
        width: size.w,
        height: size.h,
      }
    })
    const minY = Math.min(...boxes.map((box) => box.y))
    const maxX = Math.max(...boxes.map((box) => box.x + box.width))
    const parentNode = parentId ? s.nodes.find((node) => node.id === parentId && node.type === 'groupNode') : null
    const parentAbs = parentNode ? getNodeAbsPosition(parentNode, nodesById) : { x: 0, y: 0 }
    const preferredAbsPosition = { x: maxX + 96, y: minY }
    const resolvedPosition = resolveNonOverlappingPosition(
      s.nodes,
      { x: preferredAbsPosition.x - parentAbs.x, y: preferredAbsPosition.y - parentAbs.y },
      { w: 420, h: 240 },
      parentId,
    )

    const bundleNode = enforceNodeSelectability({
      id: bundleId,
      type: 'taskNode' as const,
      position: resolvedPosition,
      ...(parentId ? { parentId } : {}),
      selected: true,
      data: {
        label: bundleLabel,
        kind: 'text',
        prompt: bundlePrompt,
        content: bundlePrompt,
        bundleMode: 'concat',
        bundleSourceNodeIds: orderedNodes.map((node) => node.id),
        bundleSourceLabels: orderedNodes.map((node) => getNodeTextField(node, 'label')),
        nodeWidth: 420,
      },
    } as Node)

    const nextNodesRaw = [
      ...s.nodes.map((node) => (node.selected ? { ...node, selected: false } : node)),
      bundleNode,
    ]
    const nextEdges = [...s.edges]
    const existingEdgeIds = new Set(nextEdges.map((edge) => edge.id))
    for (const sourceNode of orderedNodes) {
      const edgeId = `xy-edge__${sourceNode.id}-${bundleId}`
      if (existingEdgeIds.has(edgeId)) continue
      nextEdges.push({
        id: edgeId,
        source: sourceNode.id,
        target: bundleId,
        animated: false,
        type: 'typed',
        selected: false,
      })
      existingEdgeIds.add(edgeId)
    }

    const nextNodes = ensureParentFirstOrder(nextNodesRaw)
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return {
      nodes: nextNodes,
      edges: nextEdges,
      nextId: s.nextId + 1,
      historyPast: past,
      historyFuture: [],
    }
  }),
  addGroupForSelection: (name) => set((s) => {
    const selectedNodes = s.nodes.filter((n) => n.selected && n.type !== 'groupNode')
    if (selectedNodes.length < 2) return {}

    const parentIds = new Set(selectedNodes.map((n) => getNodeParentId(n) || ''))
    if (parentIds.size !== 1) return {}

    const existingGroupId = Array.from(parentIds)[0] || ''
    if (existingGroupId) {
      const siblingIds = s.nodes
        .filter((n) => getNodeParentId(n) === existingGroupId)
        .map((n) => n.id)
      const selectedIds = new Set(selectedNodes.map((n) => n.id))
      if (siblingIds.length === selectedIds.size && siblingIds.every((nodeId) => selectedIds.has(nodeId))) {
        return {}
      }
    }

    const parentKey = Array.from(parentIds)[0] || ''
    const parentId = parentKey || null
    const nodesById = new Map(s.nodes.map((n) => [n.id, n] as const))
    const parentNode = parentId ? nodesById.get(parentId) : null
    if (parentId && !parentNode) return {}

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    const selectedAbsById = new Map<string, { x: number; y: number; w: number; h: number }>()

    for (const node of selectedNodes) {
      const abs = getNodeAbsPosition(node, nodesById)
      const { w, h } = getNodeSizeForLayout(node)
      selectedAbsById.set(node.id, { x: abs.x, y: abs.y, w, h })
      minX = Math.min(minX, abs.x)
      minY = Math.min(minY, abs.y)
      maxX = Math.max(maxX, abs.x + w)
      maxY = Math.max(maxY, abs.y + h)
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return {}

    let nextGroupNo = s.nextGroupId
    let groupId = genGroupId(nextGroupNo)
    const existingIds = new Set(s.nodes.map((n) => n.id))
    while (existingIds.has(groupId)) {
      nextGroupNo += 1
      groupId = genGroupId(nextGroupNo)
    }

    const padding = GROUP_PADDING
    const groupAbsX = minX - padding
    const groupAbsY = minY - padding
    const groupWidth = Math.max(GROUP_MIN_WIDTH, (maxX - minX) + padding * 2)
    const groupHeight = Math.max(GROUP_MIN_HEIGHT, (maxY - minY) + padding * 2)
    const parentAbs = parentNode ? getNodeAbsPosition(parentNode, nodesById) : { x: 0, y: 0 }
    const groupLabel = typeof name === 'string' && name.trim() ? name.trim() : `组 ${nextGroupNo}`

	    const groupNode = enforceNodeSelectability({
	      id: groupId,
	      type: 'groupNode',
      position: { x: groupAbsX - parentAbs.x, y: groupAbsY - parentAbs.y },
      parentId: parentId || undefined,
      draggable: true,
      selectable: true,
	      focusable: true,
      data: {
        label: groupLabel,
        isGroup: true,
      },
      selected: true,
      style: {
        width: groupWidth,
        height: groupHeight,
      },
    } as Node)

    const selectedIds = new Set(selectedNodes.map((n) => n.id))
    const nextNodes = s.nodes.map((node) => {
      if (!selectedIds.has(node.id)) {
        return node.selected ? { ...node, selected: false } : node
      }
      const box = selectedAbsById.get(node.id)
      if (!box) return node
      const normalized = stripNodePositionInternals(normalizeNodeParentId(node))
      return enforceNodeSelectability({
        ...normalized,
        parentId: groupId,
        extent: undefined,
        selected: false,
        position: {
          x: box.x - groupAbsX,
          y: box.y - groupAbsY,
        },
      } as Node)
    })

    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    const firstSelectedIndex = s.nodes.findIndex((n) => selectedIds.has(n.id))
    const insertIndex = firstSelectedIndex >= 0 ? firstSelectedIndex : 0
    const nextNodesWithGroup = [
      ...nextNodes.slice(0, insertIndex),
      groupNode,
      ...nextNodes.slice(insertIndex),
    ]
    const arrangedNodes = autoFitSingleGroupNode(ensureParentFirstOrder(nextNodesWithGroup), groupId, selectedIds)
    const dedup = relayoutSiblingsAlongFlow(arrangedNodes, s.edges, { kind: 'topLevel' })
    return {
      nodes: dedup,
      nextGroupId: nextGroupNo + 1,
      historyPast: past,
      historyFuture: [],
    }
  }),
  createGroupForNodeIds: (nodeIds, name, options) => {
    let createdGroupId: string | null = null
    set((s) => {
      const result = createGroupForNodeIdsInNodes(s.nodes, s.nextGroupId, nodeIds, name, options)
      if (!result.groupId || result.nodes === s.nodes) return {}
      createdGroupId = result.groupId
      const dedup = relayoutSiblingsAlongFlow(result.nodes, s.edges, { kind: 'topLevel' })
      const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
      return {
        nodes: dedup,
        nextGroupId: result.nextGroupId,
        historyPast: past,
        historyFuture: [],
      }
    })
    return createdGroupId
  },
  fitGroupToChildren: (groupId, nodeIds) => set((s) => {
    const childIds = Array.isArray(nodeIds) && nodeIds.length
      ? new Set(nodeIds.map((id) => String(id || '').trim()).filter(Boolean))
      : undefined
    const fitted = autoFitSingleGroupNode(s.nodes, groupId, childIds)
    if (fitted === s.nodes) return {}
    const dedup = relayoutSiblingsAlongFlow(fitted, s.edges, { kind: 'topLevel' })
    return { nodes: dedup }
  }),
  removeGroupById: (id) => set((s) => {
    const group = s.nodes.find((n) => n.id === id && n.type === 'groupNode')
    if (!group) return {}

    const childIds = new Set(s.nodes.filter((n) => getNodeParentId(n) === id).map((n) => n.id))
    const idsToDelete = new Set<string>([id, ...childIds])
    const nextNodes = s.nodes.filter((n) => !idsToDelete.has(n.id))
    const nextEdges = s.edges.filter((e) => !idsToDelete.has(e.source) && !idsToDelete.has(e.target))
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return {
      nodes: nextNodes,
      edges: nextEdges,
      historyPast: past,
      historyFuture: [],
    }
  }),
  findGroupMatchingSelection: () => {
    const s = get()
    const selectedNodes = s.nodes.filter((n) => n.selected && n.type !== 'groupNode')
    if (!selectedNodes.length) return null

    const parentIds = new Set(selectedNodes.map((n) => getNodeParentId(n) || ''))
    if (parentIds.size !== 1) return null

    const parentId = Array.from(parentIds)[0] || ''
    if (!parentId) return null

    const parentGroup = s.nodes.find((n) => n.id === parentId && n.type === 'groupNode')
    if (!parentGroup) return null

    const childIds = s.nodes.filter((n) => getNodeParentId(n) === parentId).map((n) => n.id)
    const selectedIds = new Set(selectedNodes.map((n) => n.id))
    if (childIds.length !== selectedIds.size) return null
    if (!childIds.every((id) => selectedIds.has(id))) return null

    const groupName = String(readNodeDataRecord(parentGroup).label || '').trim() || parentId
    return {
      id: parentId,
      name: groupName,
      nodeIds: childIds,
    }
  },
  renameGroup: (id, name) => set((s) => {
    const group = s.nodes.find((n) => n.id === id && n.type === 'groupNode')
    const nextName = String(name || '').trim()
    if (!group || !nextName) return {}

    const nextNodes = s.nodes.map((n) =>
      n.id === id
        ? { ...n, data: { ...(n.data || {}), label: nextName } }
        : n,
    )
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return {
      nodes: nextNodes,
      historyPast: past,
      historyFuture: [],
    }
  }),
  ungroupGroupNode: (id) => set((s) => {
    const group = s.nodes.find((n) => n.id === id && n.type === 'groupNode')
    if (!group) return {}

    const nodesById = new Map(s.nodes.map((n) => [n.id, n] as const))
    const nextNodes: Node[] = []
    for (const node of s.nodes) {
      if (node.id === id) continue
      if (getNodeParentId(node) !== id) {
        nextNodes.push(node)
        continue
      }
      const absPos = getNodeAbsPosition(node, nodesById)
      const normalized = stripNodePositionInternals(normalizeNodeParentId(node))
      nextNodes.push(enforceNodeSelectability({
        ...normalized,
        parentId: undefined,
        extent: undefined,
        selected: true,
        position: { x: absPos.x, y: absPos.y },
      } as Node))
    }

    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return {
      nodes: nextNodes,
      historyPast: past,
      historyFuture: [],
    }
  }),
  arrangeGroupChildren: (groupId, direction, nodeIds) => set((s) => {
    const arranged = arrangeGroupChildrenInNodes(s.nodes, s.edges, groupId, direction, nodeIds)
    if (arranged === s.nodes) {
      if (s.lastGroupArrangeDirection === direction) return {}
      return { lastGroupArrangeDirection: direction }
    }
    const dedup = relayoutSiblingsAlongFlow(arranged, s.edges, { kind: 'topLevel' })
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return {
      nodes: dedup,
      historyPast: past,
      historyFuture: [],
      lastGroupArrangeDirection: direction,
    }
  }),
  arrangeGroupChildrenByLastDirection: (groupId, nodeIds) => {
    const s = get()
    s.arrangeGroupChildren(groupId, s.lastGroupArrangeDirection, nodeIds)
  },
  formatTree: () => {
    const s = get()
    const sel = s.nodes.filter(n => n.selected)
    if (sel.length < 2) {
      s.autoLayoutAllDagVertical()
      return
    }
    set((state) => {
      const selected = state.nodes.filter(n => n.selected)
      if (selected.length < 2) return {}
      const selectedIds = new Set(selected.map(n => n.id))
      const edgesBySel = state.edges.filter(e => selectedIds.has(e.source) && selectedIds.has(e.target))
      const { nodes: laidOutSelected, changed } = applyDagTreeLayout(selected, edgesBySel)
      if (!changed) return {}
      const selectedById = new Map(laidOutSelected.map((node) => [node.id, node] as const))
      const updated = state.nodes.map((node) => selectedById.get(node.id) ?? node)
      const past = [...state.historyPast, cloneGraph(state.nodes, state.edges)].slice(-50)
      return { nodes: updated, historyPast: past, historyFuture: [] }
    })
  },
  // DAG auto layout for the whole graph.
  autoLayoutAllDagVertical: () => set((s) => {
    const { nodes: updated, changed } = applyDagTreeLayout(s.nodes, s.edges)
    if (!changed) return {}
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: updated, historyPast: past, historyFuture: [] }
  }),
  autoLayoutForParent: (parentId) => set((s) => {
    const nodesInParent = s.nodes.filter(n => (getNodeParentId(n) || null) === parentId)
    if (!nodesInParent.length) return {}
    const idSet = new Set(nodesInParent.map(n => n.id))
    const edgesInScope = s.edges.filter(e => idSet.has(e.source) && idSet.has(e.target))
    const { nodes: laidOutChildren, changed } = applyDagTreeLayout(nodesInParent, edgesInScope)
    if (!changed) return {}
    const laidOutById = new Map(laidOutChildren.map((node) => [node.id, node] as const))
    const updated = s.nodes.map((node) => laidOutById.get(node.id) ?? node)
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: updated, historyPast: past, historyFuture: [] }
  }),
  beginBatchInsertMeasurement: (ids) => {
    if (!Array.isArray(ids) || ids.length < 2) return
    const filtered = ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (filtered.length < 2) return
    const batchId = `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const allIds = new Set(filtered)

    // 节点在 plan 执行过程中陆续 push 进 store，dimensions 可能比本调用更早到达（onNodesChange
    // 看不到 pendingBatchReflow 就丢掉）。这里把"已经 measured"的节点立刻从 pending 中排除，
    // 避免 reflow 永远等不到 dimensions。
    const state = useRFStore.getState()
    const nodesById = new Map(state.nodes.map((n) => [n.id, n] as const))
    const pendingIds = new Set<string>()
    for (const id of filtered) {
      const node = nodesById.get(id)
      if (!node) {
        pendingIds.add(id)
        continue
      }
      const measured = (node as { measured?: { width?: unknown; height?: unknown } }).measured
      const w = typeof measured?.width === 'number' ? measured.width : NaN
      const h = typeof measured?.height === 'number' ? measured.height : NaN
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        pendingIds.add(id)
      }
    }

    if (pendingIds.size === 0) {
      // 所有 measured 已就绪——可能因为 plan 节点都被 createCanvasPlanGroups 提前 reparent 并
      // 已经渲染完成。直接微任务调度 reflow。
      queueMicrotask(() => reflowBatchAfterMeasurement(allIds))
      return
    }

    pendingBatchReflow = {
      batchId,
      pendingIds,
      allIds,
      scheduled: false,
    }

    // 极端情况兜底：节点可能因为某种原因永远不再发 dimensions（例如已经卸载）。250ms 后
    // 强制跑一次 reflow，避免 batch 状态永久卡住。
    setTimeout(() => {
      if (pendingBatchReflow && pendingBatchReflow.batchId === batchId && !pendingBatchReflow.scheduled) {
        pendingBatchReflow.scheduled = true
        const ids = new Set(pendingBatchReflow.allIds)
        pendingBatchReflow = null
        reflowBatchAfterMeasurement(ids)
      }
    }, 250)
  },
}))

export function persistToLocalStorage(key = 'canvas-flow') {
  const state = useRFStore.getState()
  // Never persist `dragHandle`: it can make nodes appear "undraggable" if the selector is missing.
  const nodes = (state.nodes || []).map(stripNodeDragHandle)
  const sanitized = sanitizeGraphForCanvas({ nodes, edges: state.edges })
  const payload = JSON.stringify(
    sanitizeFlowValueForPersistence({ nodes: sanitized.nodes, edges: sanitized.edges }),
  )
  localStorage.setItem(key, payload)
}

export function restoreFromLocalStorage(key = 'canvas-flow') {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  const parsed = parseStoredCanvasGraph(raw, key)
  const nodes = parsed.nodes.map(stripNodeDragHandle)
  const sanitized = sanitizeGraphForCanvas({ nodes, edges: parsed.edges })
  return { nodes: sanitized.nodes, edges: sanitized.edges }
}
