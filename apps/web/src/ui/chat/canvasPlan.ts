import type { Node } from '@xyflow/react'
import { CanvasService } from '../../ai/canvasService'
import { useRFStore } from '../../canvas/store'
import { buildTopLevelGroupReflowPositions } from '../../canvas/utils/reflowLayout'
import { getNodeAbsPosition, getNodeSize } from '../../canvas/utils/nodeBounds'
import { estimateNodeRenderSize } from '../../canvas/nodeSizes'
import {
  getNodeProductionMeta,
  normalizeProductionLayer,
  normalizeProductionNodeMetaRecord,
} from '../../canvas/productionMeta'
import {
  normalizeStoryBeatPlan,
  storyBeatPlanToPromptText,
  type StoryBeatPlanItem,
} from '../../canvas/storyBeatPlan'
import { normalizeImagePromptExecutionConfig, resolveCompiledImagePrompt } from '../../canvas/nodes/taskNode/imagePromptSpec'
import { useUIStore } from '../uiStore'
import { resolveCanvasPlanLayout, type LayoutPlanGroup } from './canvasPlanLayout'
import {
  autoConnectReferenceNodesForTargets,
  collectSourceUrls,
  normalizeExactUrl,
  resolveSourceHandle,
} from './referenceNodeAutowire'
import { collectNodeReferenceImageUrls } from '../../runner/nodeReferenceInputs'
import { CANVAS_PLAN_TAG_NAME, canvasPlanSchema, type ChatCanvasPlan } from '@jarvishub/canvas-plan-protocol'

const PLAN_PATTERN = new RegExp(`<${CANVAS_PLAN_TAG_NAME}>([\\s\\S]*?)</${CANVAS_PLAN_TAG_NAME}>`, 'i')

const VISUAL_PROMPT_REQUIRED_KINDS = new Set(['image'])
const VIDEO_PLAN_KINDS = new Set(['video', 'composeVideo'])
const AI_CHAT_NEW_WINDOW_MS = 10 * 60 * 1000
const EXECUTED_PLAN_DEDUPE_WINDOW_MS = 2 * 60 * 1000
const recentExecutedPlanSignatures = new Map<string, number>()

let canvasPlanExecutionChain: Promise<unknown> = Promise.resolve()

function normalizeNodeKind(node: ChatCanvasPlan['nodes'][number]): string {
  const explicitKind = typeof node.config?.kind === 'string' ? node.config.kind.trim() : ''
  return (explicitKind || node.kind || '').trim()
}

function extractNodePrompt(node: ChatCanvasPlan['nodes'][number]): string {
  return resolveCompiledImagePrompt(node.config)
}

function extractVideoExecutionPromptFromConfig(config: Record<string, unknown> | null | undefined): string {
  const prompt = typeof config?.prompt === 'string' ? config.prompt.trim() : ''
  return prompt
}

function extractStoryBeatPlan(node: ChatCanvasPlan['nodes'][number]) {
  return normalizeStoryBeatPlan(node.config?.storyBeatPlan)
}

function extractBeatDuration(item: StoryBeatPlanItem): number {
  if (typeof item === 'string') return 0
  return typeof item.durationSec === 'number' && Number.isFinite(item.durationSec) ? item.durationSec : 0
}

function readTargetVideoDuration(node: ChatCanvasPlan['nodes'][number]): number | null {
  const config = node.config || {}
  const candidates = [config.videoDurationSeconds, config.durationSeconds, config.duration]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value) && value > 0) return value
  }
  return null
}

function splitStoryBeatPlanIntoVideoChunks(input: {
  beats: StoryBeatPlanItem[]
  targetDuration: number
}): StoryBeatPlanItem[][] {
  const maxBeatsPerChunk = input.targetDuration <= 5 ? 3 : 4
  const chunks: StoryBeatPlanItem[][] = []
  let current: StoryBeatPlanItem[] = []
  let currentDuration = 0

  for (const beat of input.beats) {
    const beatDuration = extractBeatDuration(beat)
    const nextDuration = currentDuration + beatDuration
    const exceedsBeatCount = current.length >= maxBeatsPerChunk
    const exceedsDuration = current.length > 0 && beatDuration > 0 && nextDuration > input.targetDuration
    if (exceedsBeatCount || exceedsDuration) {
      chunks.push(current)
      current = []
      currentDuration = 0
    }
    current.push(beat)
    currentDuration += beatDuration
  }

  if (current.length) chunks.push(current)
  return chunks.filter((chunk) => chunk.length > 0)
}

function buildSplitVideoNode(input: {
  node: ChatCanvasPlan['nodes'][number]
  chunk: StoryBeatPlanItem[]
  chunkIndex: number
  chunkCount: number
}): ChatCanvasPlan['nodes'][number] {
  const baseConfig = { ...(input.node.config || {}) }
  const basePrompt = extractVideoExecutionPromptFromConfig(baseConfig)
  const chunkLabelSuffix = `（${input.chunkIndex + 1}/${input.chunkCount}）`
  const chunkPromptText = storyBeatPlanToPromptText(input.chunk)
  const durationSec = input.chunk.reduce((sum, item) => sum + extractBeatDuration(item), 0)
  const nextPrompt = (chunkPromptText || basePrompt).trim()
  return {
    ...input.node,
    clientId: `${input.node.clientId}__part_${input.chunkIndex + 1}`,
    label: `${input.node.label}${chunkLabelSuffix}`,
    config: {
      ...baseConfig,
      ...(nextPrompt ? { prompt: nextPrompt } : null),
      storyBeatPlan: input.chunk,
      ...(durationSec > 0 ? { videoDurationSeconds: durationSec, durationSeconds: durationSec } : null),
    },
  }
}

function normalizeCanvasPlanVideoChunks(plan: ChatCanvasPlan): ChatCanvasPlan {
  const nextNodes: ChatCanvasPlan['nodes'] = []
  const nextEdges: NonNullable<ChatCanvasPlan['edges']> = []
  const splitNodeMap = new Map<string, string[]>()

  for (const node of plan.nodes) {
    const kind = normalizeNodeKind(node)
    if (!VIDEO_PLAN_KINDS.has(kind)) {
      nextNodes.push(node)
      continue
    }
    const targetDuration = readTargetVideoDuration(node)
    const beats = normalizeStoryBeatPlan(node.config?.storyBeatPlan)
    if (targetDuration === null || !beats.length) {
      nextNodes.push(node)
      continue
    }
    const chunks = splitStoryBeatPlanIntoVideoChunks({ beats, targetDuration })
    if (chunks.length <= 1) {
      nextNodes.push(node)
      continue
    }

    const chunkIds: string[] = []
    chunks.forEach((chunk, chunkIndex) => {
      const splitNode = buildSplitVideoNode({
        node,
        chunk,
        chunkIndex,
        chunkCount: chunks.length,
      })
      chunkIds.push(splitNode.clientId)
      nextNodes.push(splitNode)
    })
    splitNodeMap.set(node.clientId, chunkIds)
  }

  for (const edge of plan.edges || []) {
    const splitTargets = splitNodeMap.get(edge.targetClientId)
    const splitSources = splitNodeMap.get(edge.sourceClientId)

    if (!splitTargets && !splitSources) {
      nextEdges.push(edge)
      continue
    }

    if (splitTargets && !splitSources) {
      splitTargets.forEach((targetClientId) => {
        nextEdges.push({ ...edge, targetClientId })
      })
      continue
    }

    if (!splitTargets && splitSources) {
      const lastSourceClientId = splitSources[splitSources.length - 1]
      if (lastSourceClientId) nextEdges.push({ ...edge, sourceClientId: lastSourceClientId })
      continue
    }

    if (splitTargets && splitSources) {
      const lastSourceClientId = splitSources[splitSources.length - 1]
      splitTargets.forEach((targetClientId) => {
        if (!lastSourceClientId) return
        nextEdges.push({ ...edge, sourceClientId: lastSourceClientId, targetClientId })
      })
    }
  }

  for (const chunkIds of splitNodeMap.values()) {
    for (let index = 0; index < chunkIds.length - 1; index += 1) {
      const sourceClientId = chunkIds[index]
      const targetClientId = chunkIds[index + 1]
      if (!sourceClientId || !targetClientId) continue
      nextEdges.push({
        sourceClientId,
        targetClientId,
      })
    }
  }

  return {
    ...plan,
    nodes: nextNodes,
    edges: nextEdges,
  }
}

function hasResolvedImageAsset(config: PlanNodeConfig): boolean {
  if (hasNonEmptyStringField(config, 'imageUrl')) return true
  const resultKeys = ['imageResults', 'results', 'assets', 'outputs'] as const
  return resultKeys.some((key) => {
    const value = config[key]
    return Array.isArray(value) && value.some((item) => {
      if (!item || typeof item !== 'object') return false
      const record = item as Record<string, unknown>
      return typeof record.url === 'string' && record.url.trim().length > 0
    })
  })
}

function hasResolvedVideoAsset(config: PlanNodeConfig): boolean {
  if (hasNonEmptyStringField(config, 'videoUrl')) return true
  const resultKeys = ['videoResults', 'results', 'assets', 'outputs'] as const
  return resultKeys.some((key) => {
    const value = config[key]
    return Array.isArray(value) && value.some((item) => {
      if (!item || typeof item !== 'object') return false
      const record = item as Record<string, unknown>
      return typeof record.url === 'string' && record.url.trim().length > 0
    })
  })
}

function isReferenceOnlyImageNode(node: ChatCanvasPlan['nodes'][number]): boolean {
  const kind = normalizeNodeKind(node)
  if (kind !== 'image') return false
  const config = getNodeConfig(node)
  const runtimeStatus = getStringField(config, 'status').toLowerCase()
  if (ACTIVE_RUNTIME_STATUSES.has(runtimeStatus)) return false
  return hasResolvedImageAsset(config)
}

function isReferenceOnlyVideoNode(node: ChatCanvasPlan['nodes'][number]): boolean {
  const kind = normalizeNodeKind(node)
  if (!VIDEO_PLAN_KINDS.has(kind)) return false
  const config = getNodeConfig(node)
  const runtimeStatus = getStringField(config, 'status').toLowerCase()
  if (ACTIVE_RUNTIME_STATUSES.has(runtimeStatus)) return false
  return hasResolvedVideoAsset(config)
}

function validateCanvasPlan(plan: ChatCanvasPlan): ChatCanvasPlan {
  const normalizedPlan = normalizeCanvasPlanVideoChunks(plan)
  for (const node of normalizedPlan.nodes) {
    const kind = normalizeNodeKind(node)
    const prompt = extractNodePrompt(node)
    if (!VISUAL_PROMPT_REQUIRED_KINDS.has(kind)) continue
    if (isReferenceOnlyImageNode(node)) continue
    if (!prompt) {
      throw new Error(`画布计划校验失败：节点「${node.label}」(${kind}) 缺少 config.prompt；图像节点必须提供可执行视觉提示词，禁止用 label 兜底。`)
    }
  }
  for (const node of normalizedPlan.nodes) {
    const kind = normalizeNodeKind(node)
    if (!VIDEO_PLAN_KINDS.has(kind)) continue
    if (isReferenceOnlyVideoNode(node)) continue
    const prompt = extractVideoExecutionPromptFromConfig(node.config || {})
    const storyBeatPlan = extractStoryBeatPlan(node)
    if (!prompt) {
      throw new Error(`画布计划校验失败：节点「${node.label}」(${kind}) 缺少 config.prompt；视频节点必须提供唯一可执行 prompt。`)
    }
    const targetDuration = readTargetVideoDuration(node)
    if (storyBeatPlan.length > 0) {
      const beatDurationSum = storyBeatPlan.reduce((sum, item) => sum + extractBeatDuration(item), 0)
      if (targetDuration !== null && targetDuration <= 5 && storyBeatPlan.length > 3) {
        throw new Error(`画布计划校验失败：节点「${node.label}」(${kind}) 在 ${targetDuration} 秒短视频里塞入了 ${storyBeatPlan.length} 个拍点；请拆成多个视频节点或压缩到 2-3 个强拍点。`)
      }
      if (targetDuration !== null && targetDuration > 5 && targetDuration <= 10 && storyBeatPlan.length > 4) {
        throw new Error(`画布计划校验失败：节点「${node.label}」(${kind}) 在 ${targetDuration} 秒短视频里塞入了 ${storyBeatPlan.length} 个拍点；请拆成多个视频节点或压缩到 3-4 个强拍点。`)
      }
      if (targetDuration !== null && beatDurationSum > 0 && beatDurationSum > targetDuration + 1) {
        throw new Error(`画布计划校验失败：节点「${node.label}」(${kind}) 的 storyBeatPlan 总时长约 ${beatDurationSum} 秒，已超过目标视频时长 ${targetDuration} 秒；请减少镜头或拆分为多个视频节点。`)
      }
    }
  }
  return {
    ...normalizedPlan,
    nodes: normalizedPlan.nodes.map((node) => ({
      ...node,
      config: normalizePlanExecutionConfig(node),
    })),
  }
}


type PlanPosition = { x: number; y: number }
type PlanInsertionScope = {
  parentId: string | null
  anchor: PlanPosition
  existingNodes: Node[]
}

// Fallback cell size — used when a row/column has no nodes (defensive). Real sizes come from estimatePlanNodeSize per node.
const PLAN_FALLBACK_SIZE = estimateNodeRenderSize({})
const PLAN_GAP_X = 56
const PLAN_GAP_Y = 40
const PLAN_MIN_DISTANCE_X = 220
const PLAN_MIN_DISTANCE_Y = 140

function estimatePlanNodeSize(node: ChatCanvasPlan['nodes'][number]): { w: number; h: number } {
  const kind = normalizeNodeKind(node)
  if (kind === 'composeVideo') return estimateNodeRenderSize({ coreType: 'video' })
  return estimateNodeRenderSize({ kind })
}


type PlanNode = ChatCanvasPlan['nodes'][number]
type PlanNodeConfig = NonNullable<PlanNode['config']>

const PLAN_TEXTUAL_KINDS = new Set(['text'])
const PLAN_INPUT_KINDS = new Set(['input', 'text', 'prompt', 'character', 'audio'])
const PLAN_OUTPUT_KINDS = new Set(['image', 'video'])
const PLAN_PLACEHOLDER_EXECUTION_KINDS = new Set(['image', 'video', 'composeVideo'])
const ACTIVE_RUNTIME_STATUSES = new Set(['queued', 'running'])

function getPlanNodeKind(node: PlanNode): string {
  return normalizeNodeKind(node)
}

function getPlanNodePriority(node: PlanNode): number {
  const kind = getPlanNodeKind(node)
  if (PLAN_INPUT_KINDS.has(kind)) return 0
  if (PLAN_OUTPUT_KINDS.has(kind)) return 2
  return 1
}

function comparePlanNodes(a: PlanNode, b: PlanNode): number {
  const priorityDelta = getPlanNodePriority(a) - getPlanNodePriority(b)
  if (priorityDelta !== 0) return priorityDelta
  return a.clientId.localeCompare(b.clientId)
}

function resolveBatchPlanAnchor(plan: ChatCanvasPlan): PlanPosition {
  const explicit = plan.nodes
    .map((node) => node.position)
    .find((position): position is PlanPosition => Boolean(position && Number.isFinite(position.x) && Number.isFinite(position.y)))
  if (explicit) return explicit

  const selected = useRFStore.getState().nodes.find((node) => node.selected)
  const baseX = Number(selected?.position?.x ?? 120)
  const baseY = Number(selected?.position?.y ?? 120)
  return { x: baseX + 480, y: baseY }
}

function getParentId(node: Node | undefined): string | null {
  if (!node) return null
  const raw = typeof node.parentId === 'string' ? node.parentId.trim() : ''
  return raw || null
}

function resolveFocusedInsertionScope(): PlanInsertionScope | null {
  const focusedNodeId = useUIStore.getState().focusedNodeId
  if (!focusedNodeId) return null
  const nodes = useRFStore.getState().nodes
  const focusedNode = nodes.find((node) => node.id === focusedNodeId)
  if (!focusedNode) return null

  const nodesById = new Map(nodes.map((node) => [node.id, node] as const))
  const focusedGroup =
    focusedNode.type === 'groupNode'
      ? focusedNode
      : (() => {
          const parentId = getParentId(focusedNode)
          return parentId ? nodes.find((node) => node.id === parentId && node.type === 'groupNode') ?? null : null
        })()

  if (focusedGroup) {
    const parentId = focusedGroup.id
    const siblingNodes = nodes.filter((node) => getParentId(node) === parentId)
    if (!siblingNodes.length) {
      return {
        parentId,
        anchor: { x: 24, y: 24 },
        existingNodes: siblingNodes,
      }
    }

    const maxBottom = siblingNodes.reduce((acc, node) => {
      const positionY = Number(node.position?.y ?? 0)
      const size = getNodeSize(node)
      return Math.max(acc, positionY + size.h)
    }, 24)
    return {
      parentId,
      anchor: { x: 24, y: maxBottom + 40 },
      existingNodes: siblingNodes,
    }
  }

  const focusedAbsPosition = getNodeAbsPosition(focusedNode, nodesById)
  const focusedSize = getNodeSize(focusedNode)
  return {
    parentId: null,
    anchor: {
      x: focusedAbsPosition.x + focusedSize.w + 96,
      y: focusedAbsPosition.y,
    },
    existingNodes: nodes,
  }
}

function resolvePlanInsertionScope(plan: ChatCanvasPlan): PlanInsertionScope {
  return resolveFocusedInsertionScope() ?? {
    parentId: null,
    anchor: resolveBatchPlanAnchor(plan),
    existingNodes: useRFStore.getState().nodes,
  }
}

function hasDenseOrMissingPlanPositions(plan: ChatCanvasPlan): boolean {
  if (plan.nodes.length <= 1) return false
  const positions = plan.nodes.map((node) => node.position)
  if (positions.some((position) => !position || !Number.isFinite(position.x) || !Number.isFinite(position.y))) return true

  for (let i = 0; i < positions.length; i += 1) {
    const left = positions[i]
    if (!left) continue
    for (let j = i + 1; j < positions.length; j += 1) {
      const right = positions[j]
      if (!right) continue
      const dx = Math.abs(left.x - right.x)
      const dy = Math.abs(left.y - right.y)
      if (dx < PLAN_MIN_DISTANCE_X && dy < PLAN_MIN_DISTANCE_Y) return true
    }
  }
  return false
}

function applyGridPlanLayout(plan: ChatCanvasPlan, anchor: PlanPosition): ChatCanvasPlan {
  const cols = Math.max(2, Math.ceil(Math.sqrt(plan.nodes.length)))
  const rows = Math.ceil(plan.nodes.length / cols)
  const sizes = plan.nodes.map((node) => estimatePlanNodeSize(node))
  const colWidths = new Array<number>(cols).fill(PLAN_FALLBACK_SIZE.w)
  const rowHeights = new Array<number>(rows).fill(PLAN_FALLBACK_SIZE.h)
  for (let i = 0; i < plan.nodes.length; i += 1) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const size = sizes[i] ?? PLAN_FALLBACK_SIZE
    if (size.w > (colWidths[col] ?? 0)) colWidths[col] = size.w
    if (size.h > (rowHeights[row] ?? 0)) rowHeights[row] = size.h
  }
  const colOffsets: number[] = []
  let cursorX = 0
  for (let c = 0; c < cols; c += 1) {
    colOffsets.push(cursorX)
    cursorX += (colWidths[c] ?? PLAN_FALLBACK_SIZE.w) + PLAN_GAP_X
  }
  const rowOffsets: number[] = []
  let cursorY = 0
  for (let r = 0; r < rows; r += 1) {
    rowOffsets.push(cursorY)
    cursorY += (rowHeights[r] ?? PLAN_FALLBACK_SIZE.h) + PLAN_GAP_Y
  }
  return {
    ...plan,
    nodes: plan.nodes.map((node, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      return {
        ...node,
        position: {
          x: anchor.x + (colOffsets[col] ?? 0),
          y: anchor.y + (rowOffsets[row] ?? 0),
        },
      }
    }),
  }
}

function applyDirectedPlanLayout(plan: ChatCanvasPlan, anchor: PlanPosition): ChatCanvasPlan | null {
  const edges = Array.isArray(plan.edges) ? plan.edges : []
  if (!edges.length || plan.nodes.length <= 1) return null

  const nodeIds = new Set(plan.nodes.map((node) => node.clientId))
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  const reverseAdjacency = new Map<string, string[]>()
  const levels = new Map<string, number>()

  for (const node of plan.nodes) {
    inDegree.set(node.clientId, 0)
    adjacency.set(node.clientId, [])
    reverseAdjacency.set(node.clientId, [])
    levels.set(node.clientId, 0)
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceClientId) || !nodeIds.has(edge.targetClientId)) continue
    adjacency.get(edge.sourceClientId)?.push(edge.targetClientId)
    reverseAdjacency.get(edge.targetClientId)?.push(edge.sourceClientId)
    inDegree.set(edge.targetClientId, (inDegree.get(edge.targetClientId) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const node of plan.nodes) {
    if ((inDegree.get(node.clientId) ?? 0) === 0) queue.push(node.clientId)
  }
  if (!queue.length) return null

  const visited = new Set<string>()
  while (queue.length) {
    const current = queue.shift() ?? ''
    if (!current || visited.has(current)) continue
    visited.add(current)
    const currentLevel = levels.get(current) ?? 0
    for (const next of adjacency.get(current) ?? []) {
      const nextLevel = Math.max(levels.get(next) ?? 0, currentLevel + 1)
      levels.set(next, nextLevel)
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1)
      if ((inDegree.get(next) ?? 0) === 0) queue.push(next)
    }
  }

  if (visited.size !== plan.nodes.length) return null

  const maxLevel = Math.max(...Array.from(levels.values()))
  const columns = new Map<number, ChatCanvasPlan['nodes']>()
  for (const node of [...plan.nodes].sort(comparePlanNodes)) {
    const level = levels.get(node.clientId) ?? 0
    const list = columns.get(level) ?? []
    list.push(node)
    columns.set(level, list)
  }

  const rowById = new Map<string, number>()
  const barycenter = (ids: string[]): number => {
    const rows = ids.map((id) => rowById.get(id)).filter((value): value is number => typeof value === 'number')
    if (!rows.length) return Number.POSITIVE_INFINITY
    return rows.reduce((sum, value) => sum + value, 0) / rows.length
  }

  for (let level = 0; level <= maxLevel; level += 1) {
    const current = [...(columns.get(level) ?? [])]
    current.sort((left, right) => {
      const leftPred = barycenter(reverseAdjacency.get(left.clientId) ?? [])
      const rightPred = barycenter(reverseAdjacency.get(right.clientId) ?? [])
      if (Number.isFinite(leftPred) || Number.isFinite(rightPred)) {
        const delta = leftPred - rightPred
        if (delta !== 0) return delta
      }

      const leftSucc = barycenter(adjacency.get(left.clientId) ?? [])
      const rightSucc = barycenter(adjacency.get(right.clientId) ?? [])
      if (Number.isFinite(leftSucc) || Number.isFinite(rightSucc)) {
        const delta = leftSucc - rightSucc
        if (delta !== 0) return delta
      }

      return comparePlanNodes(left, right)
    })
    columns.set(level, current)
    current.forEach((node, row) => {
      rowById.set(node.clientId, row)
    })
  }

  // Compute column widths (max width in column) and row heights (max height in row) so video columns aren't squeezed.
  const maxRow = Math.max(0, ...Array.from(rowById.values()))
  const sizeByClientId = new Map<string, { w: number; h: number }>()
  for (const node of plan.nodes) {
    sizeByClientId.set(node.clientId, estimatePlanNodeSize(node))
  }
  const colWidths = new Map<number, number>()
  const rowHeights = new Map<number, number>()
  for (const node of plan.nodes) {
    const level = levels.get(node.clientId) ?? 0
    const row = rowById.get(node.clientId) ?? 0
    const size = sizeByClientId.get(node.clientId) ?? PLAN_FALLBACK_SIZE
    colWidths.set(level, Math.max(colWidths.get(level) ?? 0, size.w))
    rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, size.h))
  }
  const levelOffsets = new Map<number, number>()
  let cursorX = 0
  for (let l = 0; l <= maxLevel; l += 1) {
    levelOffsets.set(l, cursorX)
    cursorX += (colWidths.get(l) ?? PLAN_FALLBACK_SIZE.w) + PLAN_GAP_X
  }
  const rowOffsets = new Map<number, number>()
  let cursorY = 0
  for (let r = 0; r <= maxRow; r += 1) {
    rowOffsets.set(r, cursorY)
    cursorY += (rowHeights.get(r) ?? PLAN_FALLBACK_SIZE.h) + PLAN_GAP_Y
  }
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      const level = levels.get(node.clientId) ?? 0
      const row = rowById.get(node.clientId) ?? 0
      return {
        ...node,
        position: {
          x: anchor.x + (levelOffsets.get(level) ?? 0),
          y: anchor.y + (rowOffsets.get(row) ?? 0),
        },
      }
    }),
  }
}

function applyBatchPlanLayout(plan: ChatCanvasPlan): ChatCanvasPlan {
  if (!hasDenseOrMissingPlanPositions(plan)) return plan
  const anchor = resolveBatchPlanAnchor(plan)
  return applyDirectedPlanLayout(plan, anchor) ?? applyGridPlanLayout(plan, anchor)
}

export function parseCanvasPlanFromReply(replyText: string): {
  displayText: string
  plan: ChatCanvasPlan | null
} {
  const raw = String(replyText || '')
  const match = raw.match(PLAN_PATTERN)
  if (!match) return { displayText: raw.trim(), plan: null }

  const jsonText = String(match[1] || '').trim()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { displayText: raw.replace(PLAN_PATTERN, '').trim(), plan: null }
  }

  const result = canvasPlanSchema.safeParse(parsed)
  return {
    displayText: raw.replace(PLAN_PATTERN, '').trim(),
    plan: result.success ? validateCanvasPlan(result.data) : null,
  }
}

export function verifyCanvasPlanDependencyFreshness(plan: ChatCanvasPlan): void {
  const planReferenceUrls = new Set<string>()
  for (const node of plan.nodes) {
    const urls = collectNodeReferenceImageUrls(node.config, 12)
    for (const url of urls) {
      const exact = normalizeExactUrl(url)
      if (exact) planReferenceUrls.add(exact)
    }
  }
  if (planReferenceUrls.size === 0) return

  const currentNodes = useRFStore.getState().nodes
  const activeRuntimeSources: { url: string; nodeId: string; status: string }[] = []
  for (const node of currentNodes) {
    if (!resolveSourceHandle(node)) continue
    const data = (node.data || {}) as Record<string, unknown>
    const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : ''
    if (!ACTIVE_RUNTIME_STATUSES.has(status)) continue
    const sourceUrls = collectSourceUrls(node)
    for (const url of sourceUrls) {
      const exact = normalizeExactUrl(url)
      if (!exact) continue
      if (planReferenceUrls.has(exact)) {
        activeRuntimeSources.push({ url: exact, nodeId: String(node.id || ''), status })
      }
    }
  }

  if (activeRuntimeSources.length > 0) {
    const first = activeRuntimeSources[0]!
    throw new Error(
      `画布计划执行被阻止：依赖节点「${first.nodeId}」仍在 ${first.status} 状态，需等其完成后再执行（共 ${activeRuntimeSources.length} 个依赖未就绪）。`,
    )
  }
}

type ExecuteCanvasPlanResult = {
  createdNodeIds: string[]
  resolvedNodeIds: string[]
  createdEdgeCount: number
  skipReason: 'none' | 'deduped' | 'matched_existing'
}

export async function executeCanvasPlan(plan: ChatCanvasPlan): Promise<ExecuteCanvasPlanResult> {
  const run = canvasPlanExecutionChain.then(
    () => executeCanvasPlanSerialized(plan),
    () => executeCanvasPlanSerialized(plan),
  )
  canvasPlanExecutionChain = run.catch(() => undefined)
  return run
}

async function executeCanvasPlanSerialized(plan: ChatCanvasPlan): Promise<ExecuteCanvasPlanResult> {
  const clientIdToNodeId = new Map<string, string>()
  const createdNodeIds: string[] = []
  const planSignature = buildCanvasPlanSignature(plan)
  if (wasPlanExecutedRecently(planSignature)) {
    return { createdNodeIds: [], resolvedNodeIds: [], createdEdgeCount: 0, skipReason: 'deduped' }
  }
  verifyCanvasPlanDependencyFreshness(plan)
  const insertionScope = resolvePlanInsertionScope(plan)
  const currentNodes = useRFStore.getState().nodes
  const anchor = insertionScope.anchor
  const layoutResult = resolveCanvasPlanLayout({
    plan,
    existingNodes: insertionScope.existingNodes,
    anchor,
  })
  const layoutedPlan = applyBatchPlanLayout(layoutResult.plan)
  const planCreatedAt = new Date().toISOString()

  for (const node of layoutedPlan.nodes) {
    const currentNodes = useRFStore.getState().nodes
    const matchedNodeId = findEquivalentExistingNodeId(currentNodes, node)
    if (matchedNodeId) {
      clientIdToNodeId.set(node.clientId, matchedNodeId)
      continue
    }
    const createResult = await CanvasService.createNode({
      type: node.nodeType || node.kind,
      label: node.label,
      ...(insertionScope.parentId ? { parentId: insertionScope.parentId } : null),
      config: {
        kind: node.kind,
        aiChatPlanCreatedAt: planCreatedAt,
        aiChatPlanIsNew: true,
        aiChatPlanNodeSignature: buildPlanNodeSignature(node),
        ...normalizePlanExecutionConfig(node),
      },
      ...(node.position ? { position: node.position } : {}),
    })

    if (!createResult.success) {
      throw new Error(createResult.error || `创建节点失败：${node.label}`)
    }

    const data = createResult.data as Record<string, unknown>
    const nodeId = typeof data.nodeId === 'string' ? data.nodeId.trim() : ''
    if (!nodeId) {
      throw new Error(`创建节点成功但缺少 nodeId：${node.label}`)
    }

    clientIdToNodeId.set(node.clientId, nodeId)
    createdNodeIds.push(nodeId)
  }

  rememberExecutedPlanSignature(planSignature)

  createCanvasPlanGroups(
    layoutResult.groups,
    clientIdToNodeId,
    createdNodeIds,
    { preserveTopLevelDependencyOrder: layoutResult.usesDirectedGroupLayout },
  )

  let createdEdgeCount = 0
  for (const edge of plan.edges || []) {
    const sourceNodeId = clientIdToNodeId.get(edge.sourceClientId) || ''
    const targetNodeId = clientIdToNodeId.get(edge.targetClientId) || ''
    if (!sourceNodeId || !targetNodeId) {
      throw new Error(`创建连线失败：缺少节点映射 ${edge.sourceClientId} -> ${edge.targetClientId}`)
    }

    const connectResult = await CanvasService.connectNodes({
      sourceNodeId,
      targetNodeId,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    })
    if (!connectResult.success && !String(connectResult.error || '').includes('已存在连接')) {
      throw new Error(connectResult.error || `创建连线失败：${sourceNodeId} -> ${targetNodeId}`)
    }
    createdEdgeCount += 1
  }

  const resolvedNodeIds = Array.from(new Set(clientIdToNodeId.values()))
  if (resolvedNodeIds.length > 0) {
    const autoConnected = await autoConnectReferenceNodesForTargets(resolvedNodeIds)
    createdEdgeCount += autoConnected.connectedEdgeCount
  }

  hydrateCanvasPlanNodeProductionMeta(layoutedPlan, clientIdToNodeId)

  if (createdNodeIds.length >= 2) {
    useRFStore.getState().beginBatchInsertMeasurement(createdNodeIds)
  }

  return {
    createdNodeIds,
    resolvedNodeIds,
    createdEdgeCount,
    skipReason: createdNodeIds.length === 0 && clientIdToNodeId.size > 0 ? 'matched_existing' : 'none',
  }
}

function createCanvasPlanGroups(
  groups: LayoutPlanGroup[],
  clientIdToNodeId: Map<string, string>,
  createdNodeIds: string[],
  options?: {
    preserveTopLevelDependencyOrder?: boolean
  },
): void {
  const createdIdSet = new Set(createdNodeIds)
  const store = useRFStore.getState()
  const createdGroupIds: string[] = []
  for (const group of groups) {
    const nodeIds = group.nodeClientIds
      .map((clientId) => clientIdToNodeId.get(clientId) || '')
      .filter((nodeId): nodeId is string => Boolean(nodeId) && createdIdSet.has(nodeId))
    if (nodeIds.length < 2) continue
    const groupId = store.createGroupForNodeIds(nodeIds, group.label, { preserveLayout: true })
    if (!groupId) continue
    createdGroupIds.push(groupId)
    scheduleGroupAutoArrangeAndFit(groupId, nodeIds)
  }
  if (options?.preserveTopLevelDependencyOrder) return
  scheduleTopLevelGroupAutoArrange(createdGroupIds)
}

function scheduleGroupAutoArrangeAndFit(groupId: string, nodeIds: string[]): void {
  const run = () => {
    const store = useRFStore.getState()
    if (nodeIds.length > 1) {
      store.arrangeGroupChildren(groupId, 'grid', nodeIds)
    }
    store.fitGroupToChildren(groupId, nodeIds)
  }
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run)
    })
    return
  }
  setTimeout(run, 32)
}

function scheduleTopLevelGroupAutoArrange(groupIds: string[]): void {
  if (groupIds.length < 2) return
  const targetGroupIds = new Set(groupIds)

  const run = () => {
    useRFStore.setState((state) => {
      const nextPositionById = buildTopLevelGroupReflowPositions(state.nodes, Array.from(targetGroupIds))
      if (nextPositionById.size < 2) return {}

      return {
        nodes: state.nodes.map((node) => {
          const next = nextPositionById.get(String(node.id))
          if (!next) return node
          const currentNode = node as typeof node & {
            positionAbsolute?: unknown
            dragging?: unknown
          }
          const { positionAbsolute: _positionAbsolute, dragging: _dragging, ...rest } = currentNode
          return {
            ...rest,
            position: next,
          }
        }),
      }
    })
  }

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(run)
      })
    })
    return
  }

  setTimeout(run, 64)
}

function normalizeComparableString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeComparableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null
}

function normalizeComparableStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeComparableString(item))
    .filter(Boolean)
    .slice(0, limit)
}

function normalizeComparableAnchorBindings(value: unknown): Array<{
  kind: string
  label: string
  refId: string
  imageUrl: string
}> {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const record = item as Record<string, unknown>
      return {
        kind: normalizeComparableString(record.kind),
        label: normalizeComparableString(record.label),
        refId: normalizeComparableString(record.refId),
        imageUrl: normalizeComparableString(record.imageUrl),
      }
    })
    .filter((item): item is { kind: string; label: string; refId: string; imageUrl: string } => Boolean(item))
    .slice(0, 12)
}

function buildComparableNodePayload(input: { kind: string; label: string; data: Record<string, unknown> }): Record<string, unknown> {
  const meta = getNodeProductionMeta({
    type: input.kind,
    data: input.data,
  })
  const comparablePrompt =
    VIDEO_PLAN_KINDS.has(normalizeComparableString(input.kind).toLowerCase())
      ? extractVideoExecutionPromptFromConfig(input.data)
      : normalizeComparableString(input.data.prompt)
  return {
    kind: normalizeComparableString(input.kind).toLowerCase(),
    label: normalizeComparableString(input.label),
    productionLayer: normalizeComparableString(meta.productionLayer),
    creationStage: normalizeComparableString(meta.creationStage),
    approvalStatus: normalizeComparableString(meta.approvalStatus),
    sourceEvidence: normalizeComparableStringArray(meta.sourceEvidence, 24),
    prompt: comparablePrompt,
    text: normalizeComparableString(input.data.text),
    sourceBookId: normalizeComparableString(input.data.sourceBookId || input.data.bookId),
    chapter: normalizeComparableNumber(input.data.chapter),
    materialChapter: normalizeComparableNumber(input.data.materialChapter),
    imageUrl: normalizeComparableString(input.data.imageUrl),
    videoUrl: normalizeComparableString(input.data.videoUrl),
    anchorBindings: normalizeComparableAnchorBindings(input.data.anchorBindings),
    roleCardReferenceImages: normalizeComparableStringArray(input.data.roleCardReferenceImages, 8),
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function buildPlanNodeSignature(node: PlanNode): string {
  const config = getNodeConfig(node)
  return stableStringify(buildComparableNodePayload({
    kind: getPlanNodeKind(node),
    label: node.label,
    data: config,
  }))
}

function buildCanvasPlanSignature(plan: ChatCanvasPlan): string {
  return stableStringify({
    nodes: plan.nodes.map((node) => ({
      clientId: node.clientId,
      signature: buildPlanNodeSignature(node),
    })),
    edges: (plan.edges || []).map((edge) => ({
      sourceClientId: edge.sourceClientId,
      targetClientId: edge.targetClientId,
      sourceHandle: edge.sourceHandle || '',
      targetHandle: edge.targetHandle || '',
    })),
  })
}

function wasPlanExecutedRecently(signature: string): boolean {
  const now = Date.now()
  for (const [key, timestamp] of recentExecutedPlanSignatures) {
    if (now - timestamp > EXECUTED_PLAN_DEDUPE_WINDOW_MS) recentExecutedPlanSignatures.delete(key)
  }
  const previous = recentExecutedPlanSignatures.get(signature)
  return typeof previous === 'number' && now - previous <= EXECUTED_PLAN_DEDUPE_WINDOW_MS
}

function rememberExecutedPlanSignature(signature: string): void {
  recentExecutedPlanSignatures.set(signature, Date.now())
}

function findEquivalentExistingNodeId(nodes: Array<{ id: string; data?: unknown }>, node: PlanNode): string | null {
  const targetSignature = buildPlanNodeSignature(node)
  for (const existing of nodes) {
    const existingData = existing.data && typeof existing.data === 'object'
      ? (existing.data as Record<string, unknown>)
      : null
    if (!existingData) continue
    const existingSignature = stableStringify(buildComparableNodePayload({
      kind: normalizeComparableString(existingData.kind),
      label: normalizeComparableString(existingData.label || existing.id),
      data: existingData,
    }))
    if (existingSignature === targetSignature) return existing.id
  }
  return null
}

function getNodeConfig(node: PlanNode): PlanNodeConfig {
  return node.config && typeof node.config === 'object' ? { ...node.config } : {}
}

function getStringField(config: PlanNodeConfig, key: string): string {
  const value = config[key]
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTextualPlanConfig(node: PlanNode): PlanNodeConfig {
  const config = getNodeConfig(node)
  const kind = getPlanNodeKind(node)
  if (!PLAN_TEXTUAL_KINDS.has(kind)) return config
  const {
    status: _status,
    aiChatPlanStatus: _aiChatPlanStatus,
    skipDagRun: _skipDagRun,
    progress: _progress,
    canceled: _canceled,
    lastError: _lastError,
    httpStatus: _httpStatus,
    isQuotaExceeded: _isQuotaExceeded,
    textHtml: _textHtml,
    ...restConfig
  } = config

  const prompt = getStringField(restConfig, 'prompt')
  const text = getStringField(restConfig, 'text')
  const content = getStringField(restConfig, 'content')
  const normalizedText = prompt || text || content
  if (!normalizedText) return restConfig

  return {
    ...restConfig,
    prompt: normalizedText,
    content: normalizedText,
  }
}

function getNumberField(config: PlanNodeConfig, key: string): number | undefined {
  const value = config[key]
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  return undefined
}

function hasNonEmptyStringField(config: PlanNodeConfig, key: string): boolean {
  const value = config[key]
  return typeof value === 'string' && value.trim().length > 0
}

function hasGeneratedOutputsOrTaskIds(config: PlanNodeConfig): boolean {
  if (
    hasNonEmptyStringField(config, 'imageUrl') ||
    hasNonEmptyStringField(config, 'videoUrl') ||
    hasNonEmptyStringField(config, 'audioUrl') ||
    hasNonEmptyStringField(config, 'taskId') ||
    hasNonEmptyStringField(config, 'imageTaskId') ||
    hasNonEmptyStringField(config, 'videoTaskId')
  ) {
    return true
  }
  const resultKeys = ['imageResults', 'videoResults', 'audioResults', 'results', 'assets', 'outputs'] as const
  return resultKeys.some((key) => {
    const value = config[key]
    return Array.isArray(value) && value.some((item) => {
      if (!item || typeof item !== 'object') return false
      const record = item as Record<string, unknown>
      return typeof record.url === 'string' && record.url.trim().length > 0
    })
  })
}

function stripPlanRuntimePlaceholderFields(config: PlanNodeConfig): PlanNodeConfig {
  const {
    aiChatPlanStatus: _aiChatPlanStatus,
    skipDagRun: _skipDagRun,
    status: _status,
    progress: _progress,
    canceled: _canceled,
    lastError: _lastError,
    httpStatus: _httpStatus,
    isQuotaExceeded: _isQuotaExceeded,
    ...restConfig
  } = config

  return restConfig
}

function normalizePlanExecutionConfig(node: PlanNode): PlanNodeConfig {
  const normalizedInputConfig = normalizeProductionNodeMetaRecord(normalizeTextualPlanConfig(node), {
    kind: getPlanNodeKind(node),
  })
  const kind = getPlanNodeKind(node)
  const runtimeStatus = getStringField(normalizedInputConfig, 'status').toLowerCase()
  const config =
    PLAN_PLACEHOLDER_EXECUTION_KINDS.has(kind) &&
    ACTIVE_RUNTIME_STATUSES.has(runtimeStatus) &&
    !hasGeneratedOutputsOrTaskIds(normalizedInputConfig)
      ? stripPlanRuntimePlaceholderFields(normalizedInputConfig)
      : normalizedInputConfig
  const normalizedConfig =
    VIDEO_PLAN_KINDS.has(kind)
      ? (() => {
          const {
            videoPrompt: _videoPrompt,
            storyBeatPlan: _storyBeatPlan,
            ...restConfig
          } = config
          const prompt = extractVideoExecutionPromptFromConfig(config)
          return {
            ...restConfig,
            ...(prompt ? { prompt } : null),
          }
        })()
      : VISUAL_PROMPT_REQUIRED_KINDS.has(kind)
        ? normalizeImagePromptExecutionConfig(config)
        : config
  return normalizedConfig
}

function collectPlanSourceEvidenceClientIds(plan: ChatCanvasPlan): Map<string, string[]> {
  const nodeById = new Map(plan.nodes.map((node) => [node.clientId, node] as const))
  const upstreamById = new Map<string, string[]>()
  for (const node of plan.nodes) upstreamById.set(node.clientId, [])
  for (const edge of plan.edges || []) {
    const existing = upstreamById.get(edge.targetClientId)
    if (existing) existing.push(edge.sourceClientId)
  }

  const cache = new Map<string, string[]>()
  const visit = (clientId: string, trail = new Set<string>()): string[] => {
    const cached = cache.get(clientId)
    if (cached) return cached
    if (trail.has(clientId)) return []
    trail.add(clientId)
    const node = nodeById.get(clientId)
    if (!node) return []
    const config = normalizeProductionNodeMetaRecord(getNodeConfig(node), {
      kind: getPlanNodeKind(node),
    })
    const explicit = normalizeSourceEvidenceClientIds(config.sourceEvidence)
    if (explicit.length) {
      cache.set(clientId, explicit)
      trail.delete(clientId)
      return explicit
    }
    const ownLayer = normalizeProductionLayer(config.productionLayer)
    if (ownLayer === 'evidence') {
      cache.set(clientId, [clientId])
      trail.delete(clientId)
      return [clientId]
    }
    const collected = new Set<string>()
    for (const upstreamId of upstreamById.get(clientId) || []) {
      for (const evidenceId of visit(upstreamId, trail)) collected.add(evidenceId)
    }
    const result = Array.from(collected)
    cache.set(clientId, result)
    trail.delete(clientId)
    return result
  }

  const result = new Map<string, string[]>()
  for (const node of plan.nodes) result.set(node.clientId, visit(node.clientId))
  return result
}

function normalizeSourceEvidenceClientIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 24)
}

function hydrateCanvasPlanNodeProductionMeta(
  plan: ChatCanvasPlan,
  clientIdToNodeId: Map<string, string>,
): void {
  const sourceEvidenceByClientId = collectPlanSourceEvidenceClientIds(plan)
  const { updateNodeData } = useRFStore.getState()

  for (const node of plan.nodes) {
    const nodeId = clientIdToNodeId.get(node.clientId)
    if (!nodeId) continue
    const normalizedConfig = normalizeProductionNodeMetaRecord(getNodeConfig(node), {
      kind: getPlanNodeKind(node),
    })
    const sourceEvidence = (sourceEvidenceByClientId.get(node.clientId) || [])
      .map((clientId) => clientIdToNodeId.get(clientId) || '')
      .filter(Boolean)
    const patch = normalizeProductionNodeMetaRecord(
      {
        ...normalizedConfig,
        ...(sourceEvidence.length ? { sourceEvidence } : null),
      },
      { kind: getPlanNodeKind(node) },
    )
    updateNodeData(nodeId, patch)
  }
}
