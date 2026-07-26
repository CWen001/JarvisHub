// Incremental, move-only-new node placement shared by the backend agent-write
// path (and available to the frontend). Given the current top-level boxes and
// the dependency edges, it seeds ONLY the new nodes from their neighbours and
// stacks them into the first free vertical slot of their column. Existing nodes
// are NEVER moved.
//
// Pure & deterministic (tie-break by id, no Date/Math.random) so it is safe to
// re-run under optimistic-write retries. Zero runtime dependencies.

import { LAYOUT_GAP_Y, LAYOUT_RANK_GAP_X } from './balancedDagLayout'
import {
  compareCanvasHarnessCalls,
  compareCanvasLayoutItemPaths,
  compareCanvasLayoutStagePaths,
  getCanvasExecutionWaveKey,
  getCanvasLayoutStageKey,
  isCanvasHarnessOriginV2,
  type CanvasHarnessOrigin,
  type CanvasHarnessOriginV2,
} from './harnessOrigin'

export const LAYOUT_WAVE_SLOT_STRIDE_Y = 800
export const LAYOUT_TURN_GAP_X = 256

export type PlacementBox = {
  id: string
  x: number
  y: number
  w: number
  h: number
  origin?: CanvasHarnessOrigin | null
}
export type PlacementEdge = { source: string; target: string }
export type IncrementalPlacementOptions = { rankGapX?: number; gapY?: number }

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0
}

function compareHarnessBoxes(left: PlacementBox, right: PlacementBox): number {
  const a = left.origin
  const b = right.origin
  if (!a && !b) return left.id.localeCompare(right.id)
  if (!a) return 1
  if (!b) return -1
  return a.conversationTurnIndex - b.conversationTurnIndex
    || a.llmTurnIndex - b.llmTurnIndex
    || a.executionBatchIndex - b.executionBatchIndex
    || a.agentId.localeCompare(b.agentId)
    || compareCanvasHarnessCalls(a, b)
    || left.id.localeCompare(right.id)
}

function assignActiveHierarchicalStages(
  boxes: readonly PlacementBox[],
  newIds: ReadonlySet<string>,
  rankGapX: number,
  gapY: number,
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>()
  const working = boxes.map((box) => ({ ...box }))
  const activeStageByKey = new Map<string, CanvasHarnessOriginV2>()
  for (const box of working) {
    if (!newIds.has(box.id) || !box.origin || !isCanvasHarnessOriginV2(box.origin)) continue
    activeStageByKey.set(getCanvasLayoutStageKey(box.origin), box.origin)
  }
  const activeStages = [...activeStageByKey.values()].sort((left, right) => (
    left.conversationTurnIndex - right.conversationTurnIndex
    || left.conversationTurnId.localeCompare(right.conversationTurnId)
    || compareCanvasLayoutStagePaths(left.layoutStagePath, right.layoutStagePath)
  ))

  for (const activeOrigin of activeStages) {
    const activeKey = getCanvasLayoutStageKey(activeOrigin)
    const members = working.filter((box) => (
      box.origin
      && isCanvasHarnessOriginV2(box.origin)
      && getCanvasLayoutStageKey(box.origin) === activeKey
    ))
    const existingMembers = members.filter((box) => !newIds.has(box.id))
    const sameTurnPredecessors = working.filter((box) => {
      const origin = box.origin
      if (!origin || origin.conversationTurnId !== activeOrigin.conversationTurnId) return false
      if (!isCanvasHarnessOriginV2(origin)) return true
      return compareCanvasLayoutStagePaths(origin.layoutStagePath, activeOrigin.layoutStagePath) < 0
    })
    const earlierTurnBoxes = working.filter((box) => (
      box.origin && box.origin.conversationTurnIndex < activeOrigin.conversationTurnIndex
    ))
    const originlessBoxes = working.filter((box) => !box.origin && !newIds.has(box.id))

    let stageX = 0
    if (existingMembers.length > 0) {
      stageX = Math.min(...existingMembers.map((box) => box.x))
    } else if (sameTurnPredecessors.length > 0) {
      stageX = Math.max(...sameTurnPredecessors.map((box) => box.x + box.w)) + rankGapX
    } else if (earlierTurnBoxes.length > 0) {
      stageX = Math.max(...earlierTurnBoxes.map((box) => box.x + box.w)) + LAYOUT_TURN_GAP_X
    } else if (originlessBoxes.length > 0) {
      stageX = Math.max(...originlessBoxes.map((box) => box.x + box.w)) + rankGapX
    }

    const stageTop = existingMembers.length > 0
      ? Math.min(...existingMembers.map((box) => box.y))
      : sameTurnPredecessors.length > 0
        ? Math.min(...sameTurnPredecessors.map((box) => box.y))
        : earlierTurnBoxes.length > 0
          ? Math.min(...earlierTurnBoxes.map((box) => box.y))
          : 0

    members.sort((left, right) => {
      const leftOrigin = left.origin as CanvasHarnessOriginV2
      const rightOrigin = right.origin as CanvasHarnessOriginV2
      return compareCanvasLayoutItemPaths(leftOrigin.layoutItemPath, rightOrigin.layoutItemPath)
        || compareCanvasHarnessCalls(leftOrigin, rightOrigin)
        || left.id.localeCompare(right.id)
    })
    let y = stageTop
    for (const member of members) {
      member.x = stageX
      member.y = y
      result.set(member.id, { x: member.x, y: member.y })
      y += member.h + gapY
    }
  }
  return result
}

// Longest-path rank over the whole graph (nodes in a cycle stay at rank 0).
// Used ONLY to order placement so a new node's sources — existing or new — are
// positioned before it.
function computeRanks(
  boxes: readonly PlacementBox[],
  incoming: Map<string, string[]>,
  outgoing: Map<string, string[]>,
): Map<string, number> {
  const indeg = new Map<string, number>()
  const rank = new Map<string, number>()
  for (const box of boxes) {
    indeg.set(box.id, (incoming.get(box.id) ?? []).length)
    rank.set(box.id, 0)
  }
  const ready: string[] = []
  indeg.forEach((degree, id) => {
    if (degree === 0) ready.push(id)
  })
  let cursor = 0
  while (cursor < ready.length) {
    const source = ready[cursor++]
    const sourceRank = rank.get(source) ?? 0
    for (const target of outgoing.get(source) ?? []) {
      if (sourceRank + 1 > (rank.get(target) ?? 0)) rank.set(target, sourceRank + 1)
      const nextDegree = (indeg.get(target) ?? 0) - 1
      indeg.set(target, nextDegree)
      if (nextDegree === 0) ready.push(target)
    }
  }
  return rank
}

// Push `node` down from `startY` past every already-placed box that shares its
// horizontal span. Sorting the column by top edge makes a single forward sweep
// sufficient (we only ever move down, so lower boxes can't re-collide) — the
// result is independent of the input order of `placed`, which keeps placement
// deterministic/idempotent regardless of how nodes are persisted.
function resolveColumnY(
  node: PlacementBox,
  startY: number,
  placed: readonly PlacementBox[],
  gapY: number,
): number {
  const column = placed
    .filter((other) => node.x < other.x + other.w && other.x < node.x + node.w)
    .sort((a, b) => a.y - b.y)
  let y = startY
  for (const other of column) {
    const verticalOverlap = y < other.y + other.h + gapY && other.y < y + node.h + gapY
    if (verticalOverlap) y = other.y + other.h + gapY
  }
  return y
}

export function assignIncrementalPositions(
  boxes: readonly PlacementBox[],
  edges: readonly PlacementEdge[],
  newIds: ReadonlySet<string>,
  options?: IncrementalPlacementOptions,
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>()
  if (newIds.size === 0) return result

  const rankGapX = finitePositive(options?.rankGapX, LAYOUT_RANK_GAP_X)
  const gapY = finitePositive(options?.gapY, LAYOUT_GAP_Y)

  const boxById = new Map(boxes.map((box) => [box.id, box] as const))
  const placed: PlacementBox[] = []
  const newBoxes: PlacementBox[] = []
  for (const box of boxes) {
    const copy = { ...box }
    if (newIds.has(box.id)) newBoxes.push(copy)
    else placed.push(copy)
  }
  if (newBoxes.length === 0) return result

  if (newBoxes.every((box) => box.origin && isCanvasHarnessOriginV2(box.origin))) {
    return assignActiveHierarchicalStages(boxes, newIds, rankGapX, gapY)
  }

  // Snapshot of the existing graph's right/top edges, taken BEFORE any new node
  // is placed, so a batch of isolated new nodes shares one column and stacks
  // vertically rather than marching rightward.
  const existingRight = placed.length ? Math.max(...placed.map((b) => b.x + b.w)) : null
  const existingTop = placed.length ? Math.min(...placed.map((b) => b.y)) : 0

  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  for (const box of boxes) {
    incoming.set(box.id, [])
    outgoing.set(box.id, [])
  }
  for (const edge of edges) {
    if (edge.source === edge.target) continue
    if (!boxById.has(edge.source) || !boxById.has(edge.target)) continue
    outgoing.get(edge.source)!.push(edge.target)
    incoming.get(edge.target)!.push(edge.source)
  }

  const rank = computeRanks(boxes, incoming, outgoing)
  newBoxes.sort((a, b) => {
    if (a.origin || b.origin) return compareHarnessBoxes(a, b)
    const rankDiff = (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)
    if (rankDiff !== 0) return rankDiff
    return a.id.localeCompare(b.id)
  })

  const placedById = new Map(placed.map((box) => [box.id, box] as const))

  for (const node of newBoxes) {
    const sources = (incoming.get(node.id) ?? [])
      .map((id) => placedById.get(id))
      .filter((box): box is PlacementBox => Boolean(box))
    const targets = (outgoing.get(node.id) ?? [])
      .map((id) => placedById.get(id))
      .filter((box): box is PlacementBox => Boolean(box))

    let anchorX: number
    let desiredY: number
    if (node.origin) {
      const waveKey = getCanvasExecutionWaveKey(node.origin)
      const waveSiblings = placed.filter((candidate) =>
        candidate.origin && getCanvasExecutionWaveKey(candidate.origin) === waveKey
      )
      if (waveSiblings.length > 0) {
        anchorX = Math.min(...waveSiblings.map((candidate) => candidate.x))
        const baseY = Math.min(...waveSiblings.map((candidate) =>
          candidate.y - candidate.origin!.executionBatchCallIndex * LAYOUT_WAVE_SLOT_STRIDE_Y
        ))
        desiredY = baseY + node.origin.executionBatchCallIndex * LAYOUT_WAVE_SLOT_STRIDE_Y
      } else {
        const sameTurn = placed.filter((candidate) =>
          candidate.origin?.conversationTurnId === node.origin!.conversationTurnId
        )
        if (sameTurn.length > 0) {
          anchorX = Math.max(...sameTurn.map((candidate) => candidate.x + candidate.w)) + rankGapX
          const turnTop = Math.min(...sameTurn.map((candidate) => candidate.y))
          desiredY = turnTop + node.origin.executionBatchCallIndex * LAYOUT_WAVE_SLOT_STRIDE_Y
        } else {
          const earlierTurns = placed.filter((candidate) =>
            candidate.origin && candidate.origin.conversationTurnIndex < node.origin!.conversationTurnIndex
          )
          const priorBoxes = earlierTurns.length > 0 ? earlierTurns : placed
          anchorX = priorBoxes.length > 0
            ? Math.max(...priorBoxes.map((candidate) => candidate.x + candidate.w)) + LAYOUT_TURN_GAP_X
            : 0
          const turnTop = priorBoxes.length > 0
            ? Math.min(...priorBoxes.map((candidate) => candidate.y))
            : 0
          desiredY = turnTop + node.origin.executionBatchCallIndex * LAYOUT_WAVE_SLOT_STRIDE_Y
        }
      }
    } else if (sources.length > 0) {
      // One rank to the right of the furthest-right upstream source.
      anchorX = Math.max(...sources.map((s) => s.x + s.w)) + rankGapX
      desiredY = average(sources.map((s) => s.y + s.h / 2)) - node.h / 2
    } else if (targets.length > 0) {
      // One rank to the left of the nearest downstream target.
      anchorX = Math.min(...targets.map((t) => t.x)) - rankGapX - node.w
      desiredY = average(targets.map((t) => t.y + t.h / 2)) - node.h / 2
    } else if (existingRight !== null) {
      // Isolated: a fresh column to the right of the existing graph.
      anchorX = existingRight + rankGapX
      desiredY = existingTop
    } else {
      anchorX = 0
      desiredY = 0
    }

    node.x = anchorX
    node.y = resolveColumnY(node, desiredY, placed, gapY)
    placed.push(node)
    placedById.set(node.id, node)
    result.set(node.id, { x: node.x, y: node.y })
  }

  return result
}
