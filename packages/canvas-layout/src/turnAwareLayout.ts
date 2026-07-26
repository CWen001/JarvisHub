import {
  computeBalancedDagLayout,
  LAYOUT_GAP_Y,
  LAYOUT_RANK_GAP_X,
  type BalancedDagLayoutEdge,
  type BalancedDagLayoutNode,
  type BalancedDagLayoutOptions,
  type BalancedDagLayoutResult,
  type BalancedDagLayoutSize,
} from './balancedDagLayout'
import {
  compareCanvasHarnessCalls,
  compareCanvasLayoutItemPaths,
  compareCanvasLayoutStagePaths,
  getCanvasLayoutStageKey,
  isCanvasHarnessOriginV2,
  type CanvasHarnessOrigin,
  type CanvasHarnessOriginV2,
} from './harnessOrigin'
import { LAYOUT_TURN_GAP_X } from './incrementalPlacement'

export type TurnAwareLayoutNode = BalancedDagLayoutNode & {
  origin?: CanvasHarnessOrigin | null
}

type Turn = {
  id: string
  index: number
  nodes: TurnAwareLayoutNode[]
}

type HierarchicalStage = {
  key: string
  origin: CanvasHarnessOriginV2
  nodes: TurnAwareLayoutNode[]
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function finiteCoordinate(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function normalizedSize(node: TurnAwareLayoutNode): BalancedDagLayoutSize {
  return {
    w: Math.max(1, finiteCoordinate(node.size.w) || 1),
    h: Math.max(1, finiteCoordinate(node.size.h) || 1),
  }
}

function compareNatural(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function internalEdges(
  nodes: TurnAwareLayoutNode[],
  edges: BalancedDagLayoutEdge[],
): BalancedDagLayoutEdge[] {
  const ids = new Set(nodes.map((node) => node.id))
  return edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
}

function placeDagBlock(input: {
  nodes: TurnAwareLayoutNode[]
  edges: BalancedDagLayoutEdge[]
  options?: BalancedDagLayoutOptions
  startX: number
  startY: number
  positions: Map<string, { x: number; y: number }>
  sizes: Map<string, BalancedDagLayoutSize>
}): number {
  if (input.nodes.length === 0) return 0
  const layout = computeBalancedDagLayout(
    input.nodes,
    internalEdges(input.nodes, input.edges),
    input.options,
  )
  const bounds = input.nodes.map((node) => {
    const position = layout.positions.get(node.id) ?? node.position
    const size = layout.sizes.get(node.id) ?? normalizedSize(node)
    return { node, position, size }
  })
  const minX = Math.min(...bounds.map(({ position }) => position.x))
  const minY = Math.min(...bounds.map(({ position }) => position.y))
  const maxRight = Math.max(...bounds.map(({ position, size }) => position.x + size.w))
  for (const { node, position, size } of bounds) {
    input.positions.set(node.id, {
      x: input.startX + position.x - minX,
      y: input.startY + position.y - minY,
    })
    input.sizes.set(node.id, size)
  }
  return maxRight - minX
}

function buildTurns(nodes: TurnAwareLayoutNode[]): Turn[] {
  const turns = new Map<string, Turn>()
  for (const node of nodes) {
    const origin = node.origin!
    const key = JSON.stringify([origin.conversationTurnIndex, origin.conversationTurnId])
    const turn = turns.get(key) ?? {
      id: origin.conversationTurnId,
      index: origin.conversationTurnIndex,
      nodes: [],
    }
    turn.nodes.push(node)
    turns.set(key, turn)
  }
  return [...turns.values()].sort((left, right) => (
    left.index - right.index || left.id.localeCompare(right.id)
  ))
}

function buildHierarchicalStages(nodes: TurnAwareLayoutNode[]): HierarchicalStage[] {
  const stages = new Map<string, HierarchicalStage>()
  for (const node of nodes) {
    const origin = node.origin!
    if (!isCanvasHarnessOriginV2(origin)) continue
    const key = getCanvasLayoutStageKey(origin)
    const stage = stages.get(key) ?? { key, origin, nodes: [] }
    stage.nodes.push(node)
    stages.set(key, stage)
  }
  return [...stages.values()].sort((left, right) => (
    compareCanvasLayoutStagePaths(left.origin.layoutStagePath, right.origin.layoutStagePath)
    || left.key.localeCompare(right.key)
  ))
}

export function computeTurnAwareCanvasLayout(
  nodes: TurnAwareLayoutNode[],
  edges: BalancedDagLayoutEdge[],
  options?: BalancedDagLayoutOptions,
): BalancedDagLayoutResult {
  const provenanceNodes = nodes.filter((node) => Boolean(node.origin))
  if (provenanceNodes.length === 0) return computeBalancedDagLayout(nodes, edges, options)

  const gapY = finiteNonNegative(options?.gapY, LAYOUT_GAP_Y)
  const rankGapX = finiteNonNegative(options?.rankGapX, LAYOUT_RANK_GAP_X)
  const positions = new Map<string, { x: number; y: number }>()
  const sizes = new Map<string, BalancedDagLayoutSize>()
  nodes.forEach((node) => sizes.set(node.id, normalizedSize(node)))

  const minX = nodes.length > 0 ? Math.min(...nodes.map((node) => finiteCoordinate(node.position.x))) : 0
  const minY = nodes.length > 0 ? Math.min(...nodes.map((node) => finiteCoordinate(node.position.y))) : 0
  let cursorX = minX

  const originlessNodes = nodes.filter((node) => !node.origin)
  if (originlessNodes.length > 0) {
    cursorX += placeDagBlock({
      nodes: originlessNodes,
      edges,
      options,
      startX: cursorX,
      startY: minY,
      positions,
      sizes,
    }) + LAYOUT_TURN_GAP_X
  }

  for (const turn of buildTurns(provenanceNodes)) {
    const legacyNodes = turn.nodes.filter((node) => !isCanvasHarnessOriginV2(node.origin!))
    const hierarchicalNodes = turn.nodes.filter((node) => isCanvasHarnessOriginV2(node.origin!))
    if (legacyNodes.length > 0) {
      cursorX += placeDagBlock({
        nodes: legacyNodes,
        edges,
        options,
        startX: cursorX,
        startY: minY,
        positions,
        sizes,
      })
      if (hierarchicalNodes.length > 0) cursorX += rankGapX
    }

    const stages = buildHierarchicalStages(hierarchicalNodes)
    for (const [stageIndex, stage] of stages.entries()) {
      stage.nodes.sort((left, right) => {
        const leftOrigin = left.origin as CanvasHarnessOriginV2
        const rightOrigin = right.origin as CanvasHarnessOriginV2
        return compareCanvasLayoutItemPaths(leftOrigin.layoutItemPath, rightOrigin.layoutItemPath)
          || compareCanvasHarnessCalls(leftOrigin, rightOrigin)
          || compareNatural(left.id, right.id)
      })
      const stageWidth = Math.max(...stage.nodes.map((node) => (
        sizes.get(node.id) ?? normalizedSize(node)
      ).w))
      let nodeY = minY
      for (const node of stage.nodes) {
        const size = sizes.get(node.id) ?? normalizedSize(node)
        positions.set(node.id, { x: cursorX, y: nodeY })
        nodeY += size.h + gapY
      }
      cursorX += stageWidth
      if (stageIndex < stages.length - 1) cursorX += rankGapX
    }
    cursorX += LAYOUT_TURN_GAP_X
  }

  for (const node of nodes) {
    if (!node.locked) continue
    positions.set(node.id, {
      x: finiteCoordinate(node.position.x),
      y: finiteCoordinate(node.position.y),
    })
  }

  return { positions, sizes }
}
