export type BalancedDagLayoutPoint = { x: number; y: number }
export type BalancedDagLayoutSize = { w: number; h: number }

export type BalancedDagLayoutNode = {
  id: string
  family?: string
  role?: string
  order?: number
  group?: string
  weight?: number
  locked?: boolean
  position: BalancedDagLayoutPoint
  size: BalancedDagLayoutSize
}

export type BalancedDagLayoutEdge = {
  source: string
  target: string
  weight?: number
}

export type BalancedDagLayoutOptions = {
  gapX?: number
  gapY?: number
  rankGapX?: number
  targetGraphAspect?: number
  maxRowsPerColumn?: number
  maxBlankRatio?: number
  orderingPasses?: number
  rankEdgeWeightThreshold?: number
  textDocking?: 'side' | 'inline'
}

export type BalancedDagLayoutResult = {
  positions: Map<string, BalancedDagLayoutPoint>
  sizes: Map<string, BalancedDagLayoutSize>
}

type LayoutOptions = Required<BalancedDagLayoutOptions>
type PackedColumn = { ids: string[]; w: number; h: number; gapBefore: number }
type PackedRank = { columns: PackedColumn[]; w: number; h: number }
type ExtraGapOf = (previousId: string, nextId: string) => number
type WeightedNeighbor = { id: string; weight: number }
type LayoutBounds = { minX: number; minY: number; maxX: number; maxY: number }

// Canonical spacing. rankGapX (between dependency ranks, along the flow) is
// deliberately larger than the within-rank gaps so the left-to-right
// dependency direction reads clearly; gapX (packed sub-columns) sits between
// rankGapX and gapY (stacked siblings). Loosened from a flat 32 for
// readability while staying compact. Shared by the frontend 整理画布 path and
// the backend layout/placement helpers so both ends space nodes identically.
export const LAYOUT_GAP_X = 80
export const LAYOUT_GAP_Y = 72
export const LAYOUT_RANK_GAP_X = 128

const DEFAULT_OPTIONS: LayoutOptions = {
  gapX: LAYOUT_GAP_X,
  gapY: LAYOUT_GAP_Y,
  rankGapX: LAYOUT_RANK_GAP_X,
  targetGraphAspect: 1.2,
  maxRowsPerColumn: 6,
  maxBlankRatio: 0.55,
  orderingPasses: 4,
  rankEdgeWeightThreshold: 0.5,
  textDocking: 'side',
}

const FAMILY_ORDER = new Map<string, number>([
  ['text', 0],
  ['image', 1],
  ['video', 2],
])
const TEXT_FAMILY_PRIORITY = FAMILY_ORDER.get('text') ?? 0
const IMAGE_FAMILY_PRIORITY = FAMILY_ORDER.get('image') ?? 1
const VIDEO_FAMILY_PRIORITY = FAMILY_ORDER.get('video') ?? 2
const NOTE_ROLE_PRIORITY = -1
const TEXT_TEXT_EXTRA_GAP = 24
const READABLE_MEDIA_LIST_MIN_NODES = 5
const READABLE_MEDIA_LIST_MAX_SINGLE_COLUMN_NODES = 8

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function readOptions(options: BalancedDagLayoutOptions | undefined): LayoutOptions {
  const gapX = finiteNumber(options?.gapX, DEFAULT_OPTIONS.gapX)
  const gapY = finiteNumber(options?.gapY, DEFAULT_OPTIONS.gapY)
  const rankGapX = finiteNumber(options?.rankGapX, DEFAULT_OPTIONS.rankGapX)
  const targetGraphAspect = finiteNumber(options?.targetGraphAspect, DEFAULT_OPTIONS.targetGraphAspect)
  const maxRowsPerColumn = Math.max(1, Math.floor(finiteNumber(options?.maxRowsPerColumn, DEFAULT_OPTIONS.maxRowsPerColumn)))
  const maxBlankRatio = finiteNumber(options?.maxBlankRatio, DEFAULT_OPTIONS.maxBlankRatio)
  const orderingPasses = Math.max(1, Math.floor(finiteNumber(options?.orderingPasses, DEFAULT_OPTIONS.orderingPasses)))
  const rankEdgeWeightThreshold = finiteNumber(options?.rankEdgeWeightThreshold, DEFAULT_OPTIONS.rankEdgeWeightThreshold)
  const textDocking = options?.textDocking === 'inline' ? 'inline' : DEFAULT_OPTIONS.textDocking
  return {
    gapX: Math.max(0, gapX),
    gapY: Math.max(0, gapY),
    rankGapX: Math.max(0, rankGapX),
    targetGraphAspect: Math.max(0.25, targetGraphAspect),
    maxRowsPerColumn,
    maxBlankRatio: Math.max(0, maxBlankRatio),
    orderingPasses,
    rankEdgeWeightThreshold: Math.max(0, rankEdgeWeightThreshold),
    textDocking,
  }
}

function buildOrderIndex(lanes: string[][]): Map<string, number> {
  const order = new Map<string, number>()
  for (const lane of lanes) {
    lane.forEach((id, index) => order.set(id, index))
  }
  return order
}

function weightedAverageKnownOrder(neighbors: WeightedNeighbor[], order: Map<string, number>): number | null {
  let sum = 0
  let weightSum = 0
  for (const neighbor of neighbors) {
    const value = order.get(neighbor.id)
    if (value == null) continue
    const weight = Math.max(0.05, neighbor.weight)
    sum += value * weight
    weightSum += weight
  }
  return weightSum ? sum / weightSum : null
}

function tokenizeNatural(value: string): Array<string | number> {
  return value
    .split(/(\d+)/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number.parseInt(part, 10) : part.toLowerCase()))
}

function compareNatural(a: string, b: string): number {
  const aa = tokenizeNatural(a)
  const bb = tokenizeNatural(b)
  const length = Math.max(aa.length, bb.length)
  for (let index = 0; index < length; index += 1) {
    const left = aa[index]
    const right = bb[index]
    if (left == null) return -1
    if (right == null) return 1
    if (typeof left === 'number' && typeof right === 'number') {
      if (left !== right) return left - right
      continue
    }
    const diff = String(left).localeCompare(String(right))
    if (diff !== 0) return diff
  }
  return a.localeCompare(b)
}

function sortLaneByScore(
  lane: string[],
  scoreOf: (id: string) => number | null,
  previousOrder: Map<string, number>,
  familyPriorityOf: (id: string) => number,
  explicitOrderOf: (id: string) => number | null,
): void {
  lane.sort((a, b) => {
    const familyDiff = familyPriorityOf(a) - familyPriorityOf(b)
    if (familyDiff !== 0) return familyDiff
    const sa = scoreOf(a)
    const sb = scoreOf(b)
    const aScore = sa == null ? previousOrder.get(a) ?? 0 : sa
    const bScore = sb == null ? previousOrder.get(b) ?? 0 : sb
    if (Math.abs(aScore - bScore) > 0.5) return aScore - bScore
    const aPrev = previousOrder.get(a) ?? 0
    const bPrev = previousOrder.get(b) ?? 0
    if (aPrev !== bPrev) return aPrev - bPrev
    const aExplicit = explicitOrderOf(a)
    const bExplicit = explicitOrderOf(b)
    if (aExplicit != null || bExplicit != null) {
      if (aExplicit == null) return 1
      if (bExplicit == null) return -1
      if (aExplicit !== bExplicit) return aExplicit - bExplicit
    }
    return compareNatural(a, b)
  })
}

function readFamilyPriority(family: unknown, role?: unknown): number {
  const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : ''
  if (normalizedRole === 'note') return NOTE_ROLE_PRIORITY
  const normalized = typeof family === 'string' ? family.trim().toLowerCase() : ''
  return FAMILY_ORDER.get(normalized) ?? 99
}

function readExplicitOrder(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function readEdgeWeight(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 1
}

function isNoteNode(node: BalancedDagLayoutNode): boolean {
  return typeof node.role === 'string' && node.role.trim().toLowerCase() === 'note'
}

function isMediaFamilyPriority(priority: number): boolean {
  return priority === IMAGE_FAMILY_PRIORITY || priority === VIDEO_FAMILY_PRIORITY
}

function isReadableMediaListLane(lane: string[], familyPriorityOf: (id: string) => number): boolean {
  return lane.length >= READABLE_MEDIA_LIST_MIN_NODES && lane.every((id) => isMediaFamilyPriority(familyPriorityOf(id)))
}

function makeColumn(
  ids: string[],
  sizeOf: Map<string, BalancedDagLayoutSize>,
  gapY: number,
  extraGapOf: ExtraGapOf,
): PackedColumn {
  let w = 0
  let h = 0
  ids.forEach((id, index) => {
    const size = sizeOf.get(id) || { w: 1, h: 1 }
    w = Math.max(w, size.w)
    const previousId = index > 0 ? ids[index - 1] : null
    h += size.h + (previousId ? gapY + extraGapOf(previousId, id) : 0)
  })
  return { ids, w, h, gapBefore: 0 }
}

function packWithRows(
  lane: string[],
  rowsPerColumn: number,
  sizeOf: Map<string, BalancedDagLayoutSize>,
  gapX: number,
  gapY: number,
  extraGapOf: ExtraGapOf,
): PackedRank {
  const columns: PackedColumn[] = []
  let previousColumnLastId: string | null = null
  for (let index = 0; index < lane.length; index += rowsPerColumn) {
    const ids = lane.slice(index, index + rowsPerColumn)
    const column = makeColumn(ids, sizeOf, gapY, extraGapOf)
    const firstId = ids[0]
    columns.push({
      ...column,
      gapBefore: previousColumnLastId && firstId ? gapX + extraGapOf(previousColumnLastId, firstId) : 0,
    })
    previousColumnLastId = ids[ids.length - 1] ?? previousColumnLastId
  }
  const w = columns.reduce((sum, column) => sum + column.gapBefore + column.w, 0)
  const h = Math.max(0, ...columns.map((column) => column.h))
  return { columns, w, h }
}

function choosePackedRank(
  lane: string[],
  sizeOf: Map<string, BalancedDagLayoutSize>,
  rankCount: number,
  options: LayoutOptions,
  extraGapOf: ExtraGapOf,
  bandPriorityOf: (id: string) => number,
): PackedRank {
  if (!lane.length) return { columns: [], w: 0, h: 0 }
  if (
    isReadableMediaListLane(lane, bandPriorityOf) &&
    lane.length <= READABLE_MEDIA_LIST_MAX_SINGLE_COLUMN_NODES
  ) {
    return packWithRows(lane, lane.length, sizeOf, options.gapX, options.gapY, extraGapOf)
  }

  const bands: string[][] = []
  if (options.textDocking === 'side') {
    for (const id of lane) {
      const previous = bands[bands.length - 1]
      const previousId = previous?.[previous.length - 1]
      if (!previous || previousId == null || bandPriorityOf(previousId) !== bandPriorityOf(id)) {
        bands.push([id])
      } else {
        previous.push(id)
      }
    }
  }

  if (bands.length > 1) {
    let w = 0
    let h = 0
    const columns: PackedColumn[] = []
    bands.forEach((band, bandIndex) => {
      const packed = choosePackedRank(band, sizeOf, rankCount, options, extraGapOf, bandPriorityOf)
      packed.columns.forEach((column, columnIndex) => {
        columns.push({
          ...column,
          gapBefore:
            bandIndex === 0 && columnIndex === 0
              ? column.gapBefore
              : column.gapBefore + options.gapX,
        })
      })
      w += packed.w + (bandIndex > 0 ? options.gapX : 0)
      h = Math.max(h, packed.h)
    })
    return { columns, w, h }
  }

  if (lane.length <= 4) {
    return packWithRows(lane, lane.length, sizeOf, options.gapX, options.gapY, extraGapOf)
  }

  const targetBlockAspect = options.targetGraphAspect / Math.max(1, rankCount)
  const maxRows = Math.min(lane.length, options.maxRowsPerColumn)
  let best = packWithRows(lane, maxRows, sizeOf, options.gapX, options.gapY, extraGapOf)
  let bestScore = Number.POSITIVE_INFINITY

  for (let rows = 1; rows <= maxRows; rows += 1) {
    const candidate = packWithRows(lane, rows, sizeOf, options.gapX, options.gapY, extraGapOf)
    const aspect = candidate.w / Math.max(1, candidate.h)
    const aspectScore = Math.abs(Math.log(aspect / targetBlockAspect))
    const totalNodeArea = lane.reduce((sum, id) => {
      const size = sizeOf.get(id) || { w: 1, h: 1 }
      return sum + size.w * size.h
    }, 0)
    const blankRatio = Math.max(0, 1 - totalNodeArea / Math.max(1, candidate.w * candidate.h))
    const blankScore = Math.max(0, blankRatio - options.maxBlankRatio)
    const splitPenalty = Math.max(0, candidate.columns.length - 1) * 0.015
    const score = aspectScore + blankScore + splitPenalty
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
  }

  return best
}

function countAdjacentCrossings(
  lanes: string[][],
  edgePairs: Array<{ source: string; target: string }>,
): number {
  let crossings = 0
  const rankOf = new Map<string, number>()
  const orderOf = new Map<string, number>()
  lanes.forEach((lane, rankIndex) => {
    lane.forEach((id, orderIndex) => {
      rankOf.set(id, rankIndex)
      orderOf.set(id, orderIndex)
    })
  })

  for (let i = 0; i < edgePairs.length; i += 1) {
    const a = edgePairs[i]
    const aRank = rankOf.get(a.source)
    const aTargetRank = rankOf.get(a.target)
    if (aRank == null || aTargetRank == null || aTargetRank !== aRank + 1) continue
    const aSourceOrder = orderOf.get(a.source) ?? 0
    const aTargetOrder = orderOf.get(a.target) ?? 0
    for (let j = i + 1; j < edgePairs.length; j += 1) {
      const b = edgePairs[j]
      if (rankOf.get(b.source) !== aRank || rankOf.get(b.target) !== aTargetRank) continue
      const bSourceOrder = orderOf.get(b.source) ?? 0
      const bTargetOrder = orderOf.get(b.target) ?? 0
      if ((aSourceOrder - bSourceOrder) * (aTargetOrder - bTargetOrder) < 0) crossings += 1
    }
  }
  return crossings
}

function cloneLanes(lanes: string[][]): string[][] {
  return lanes.map((lane) => [...lane])
}

function buildMainEdgesThroughNotes(
  edges: BalancedDagLayoutEdge[],
  mainIds: Set<string>,
  noteIds: Set<string>,
): BalancedDagLayoutEdge[] {
  const bySource = new Map<string, BalancedDagLayoutEdge[]>()
  const result = new Map<string, BalancedDagLayoutEdge>()
  const remember = (edge: BalancedDagLayoutEdge) => {
    if (edge.source === edge.target) return
    const key = `${edge.source}\u0000${edge.target}`
    const existing = result.get(key)
    if (!existing || readEdgeWeight(edge.weight) > readEdgeWeight(existing.weight)) {
      result.set(key, edge)
    }
  }

  for (const edge of edges) {
    const bucket = bySource.get(edge.source) ?? []
    bucket.push(edge)
    bySource.set(edge.source, bucket)
    if (mainIds.has(edge.source) && mainIds.has(edge.target)) {
      remember(edge)
    }
  }

  for (const edge of edges) {
    if (!mainIds.has(edge.source) || !noteIds.has(edge.target)) continue
    const queue: Array<{ noteId: string; weight: number }> = [{ noteId: edge.target, weight: readEdgeWeight(edge.weight) }]
    const seen = new Set<string>([edge.target])
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]
      for (const next of bySource.get(current.noteId) ?? []) {
        const weight = Math.min(current.weight, readEdgeWeight(next.weight))
        if (mainIds.has(next.target)) {
          remember({ source: edge.source, target: next.target, weight })
        } else if (noteIds.has(next.target) && !seen.has(next.target)) {
          seen.add(next.target)
          queue.push({ noteId: next.target, weight })
        }
      }
    }
  }

  return Array.from(result.values())
}

function computeLayoutBounds(
  ids: string[],
  positions: Map<string, BalancedDagLayoutPoint>,
  sizes: Map<string, BalancedDagLayoutSize>,
): LayoutBounds {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const id of ids) {
    const position = positions.get(id)
    const size = sizes.get(id)
    if (!position || !size) continue
    minX = Math.min(minX, position.x)
    minY = Math.min(minY, position.y)
    maxX = Math.max(maxX, position.x + size.w)
    maxY = Math.max(maxY, position.y + size.h)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  }
  return { minX, minY, maxX, maxY }
}

function desiredNoteY(
  note: BalancedDagLayoutNode,
  edges: BalancedDagLayoutEdge[],
  mainIds: Set<string>,
  positions: Map<string, BalancedDagLayoutPoint>,
  sizes: Map<string, BalancedDagLayoutSize>,
): number {
  const neighborCenters: number[] = []
  for (const edge of edges) {
    const neighborId = edge.source === note.id ? edge.target : edge.target === note.id ? edge.source : null
    if (!neighborId || !mainIds.has(neighborId)) continue
    const position = positions.get(neighborId)
    const size = sizes.get(neighborId)
    if (!position || !size) continue
    neighborCenters.push(position.y + size.h / 2)
  }
  const noteSize = sizes.get(note.id) ?? note.size
  if (neighborCenters.length) {
    const average = neighborCenters.reduce((sum, value) => sum + value, 0) / neighborCenters.length
    return average - noteSize.h / 2
  }
  return finiteNumber(note.position.y)
}

function dockNoteNodes(
  noteNodes: BalancedDagLayoutNode[],
  edges: BalancedDagLayoutEdge[],
  mainIds: Set<string>,
  options: LayoutOptions,
  positions: Map<string, BalancedDagLayoutPoint>,
  sizes: Map<string, BalancedDagLayoutSize>,
): void {
  if (!noteNodes.length) return
  noteNodes.forEach((node) => {
    sizes.set(node.id, {
      w: Math.max(1, finiteNumber(node.size.w, 1)),
      h: Math.max(1, finiteNumber(node.size.h, 1)),
    })
  })

  const mainBounds = computeLayoutBounds(Array.from(mainIds), positions, sizes)
  const maxNoteWidth = Math.max(1, ...noteNodes.map((node) => sizes.get(node.id)?.w ?? 1))
  const dockX = mainBounds.minX - maxNoteWidth - options.rankGapX
  const sorted = [...noteNodes].sort((a, b) => {
    const aOrder = readExplicitOrder(a.order)
    const bOrder = readExplicitOrder(b.order)
    if (aOrder != null || bOrder != null) {
      if (aOrder == null) return 1
      if (bOrder == null) return -1
      if (aOrder !== bOrder) return aOrder - bOrder
    }
    const ay = desiredNoteY(a, edges, mainIds, positions, sizes)
    const by = desiredNoteY(b, edges, mainIds, positions, sizes)
    if (Math.abs(ay - by) > 0.5) return ay - by
    return compareNatural(a.id, b.id)
  })

  let cursorY = Math.min(
    mainBounds.minY,
    ...sorted.map((node) => desiredNoteY(node, edges, mainIds, positions, sizes)),
  )
  for (const node of sorted) {
    if (node.locked) {
      positions.set(node.id, {
        x: finiteNumber(node.position.x),
        y: finiteNumber(node.position.y),
      })
      continue
    }
    const size = sizes.get(node.id) ?? node.size
    const y = Math.max(desiredNoteY(node, edges, mainIds, positions, sizes), cursorY)
    positions.set(node.id, {
      x: dockX + (maxNoteWidth - size.w) / 2,
      y,
    })
    cursorY = y + size.h + options.gapY
  }
}

function computeRankedBalancedDagLayout(
  nodes: BalancedDagLayoutNode[],
  edges: BalancedDagLayoutEdge[],
  options: LayoutOptions,
): BalancedDagLayoutResult {
  const positions = new Map<string, BalancedDagLayoutPoint>()
  const sizes = new Map<string, BalancedDagLayoutSize>()
  if (!nodes.length) return { positions, sizes }

  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  const familyPriorityById = new Map(nodes.map((node) => [node.id, readFamilyPriority(node.family, node.role)] as const))
  const explicitOrderById = new Map(nodes.map((node) => [node.id, readExplicitOrder(node.order)] as const))
  const familyPriorityOf = (id: string) => familyPriorityById.get(id) ?? 99
  const explicitOrderOf = (id: string) => explicitOrderById.get(id) ?? null
  const extraGapOf = (previousId: string, nextId: string) =>
    familyPriorityOf(previousId) === TEXT_FAMILY_PRIORITY && familyPriorityOf(nextId) === TEXT_FAMILY_PRIORITY
      ? TEXT_TEXT_EXTRA_GAP
      : 0
  const idSet = new Set(nodeById.keys())
  nodes.forEach((node) => {
    sizes.set(node.id, {
      w: Math.max(1, finiteNumber(node.size.w, 1)),
      h: Math.max(1, finiteNumber(node.size.h, 1)),
    })
  })

  const incoming = new Map<string, WeightedNeighbor[]>()
  const outgoing = new Map<string, WeightedNeighbor[]>()
  const incomingRank = new Map<string, string[]>()
  const outgoingRank = new Map<string, string[]>()
  const edgePairs: Array<{ source: string; target: string }> = []
  nodes.forEach((node) => {
    incoming.set(node.id, [])
    outgoing.set(node.id, [])
    incomingRank.set(node.id, [])
    outgoingRank.set(node.id, [])
  })
  edges.forEach((edge) => {
    if (!idSet.has(edge.source) || !idSet.has(edge.target) || edge.source === edge.target) return
    const weight = readEdgeWeight(edge.weight)
    incoming.get(edge.target)!.push({ id: edge.source, weight })
    outgoing.get(edge.source)!.push({ id: edge.target, weight })
    edgePairs.push({ source: edge.source, target: edge.target })
    if (weight >= options.rankEdgeWeightThreshold) {
      incomingRank.get(edge.target)!.push(edge.source)
      outgoingRank.get(edge.source)!.push(edge.target)
    }
  })

  const indeg = new Map<string, number>()
  const rank = new Map<string, number>()
  nodes.forEach((node) => {
    indeg.set(node.id, incomingRank.get(node.id)!.length)
    rank.set(node.id, 0)
  })
  const ready: string[] = []
  indeg.forEach((degree, id) => {
    if (degree === 0) ready.push(id)
  })
  let cursor = 0
  while (cursor < ready.length) {
    const source = ready[cursor++]
    const sourceRank = rank.get(source) ?? 0
    for (const target of outgoingRank.get(source) ?? []) {
      if (sourceRank + 1 > (rank.get(target) ?? 0)) rank.set(target, sourceRank + 1)
      const nextDegree = (indeg.get(target) ?? 0) - 1
      indeg.set(target, nextDegree)
      if (nextDegree === 0) ready.push(target)
    }
  }

  const maxRank = Math.max(0, ...nodes.map((node) => rank.get(node.id) ?? 0))
  const lanes: string[][] = Array.from({ length: maxRank + 1 }, () => [])
  nodes.forEach((node) => lanes[rank.get(node.id) ?? 0].push(node.id))

  lanes.forEach((lane) => {
    lane.sort((a, b) => {
      const familyDiff = familyPriorityOf(a) - familyPriorityOf(b)
      if (familyDiff !== 0) return familyDiff
      const na = nodeById.get(a)!
      const nb = nodeById.get(b)!
      const ay = finiteNumber(na.position.y)
      const by = finiteNumber(nb.position.y)
      if (Math.abs(ay - by) > 0.5) return ay - by
      const ax = finiteNumber(na.position.x)
      const bx = finiteNumber(nb.position.x)
      if (Math.abs(ax - bx) > 0.5) return ax - bx
      const aExplicit = explicitOrderOf(a)
      const bExplicit = explicitOrderOf(b)
      if (aExplicit != null || bExplicit != null) {
        if (aExplicit == null) return 1
        if (bExplicit == null) return -1
        if (aExplicit !== bExplicit) return aExplicit - bExplicit
      }
      return compareNatural(a, b)
    })
  })

  const readableListLanes = new Set<number>()
  lanes.forEach((lane, index) => {
    if (isReadableMediaListLane(lane, familyPriorityOf)) readableListLanes.add(index)
  })

  let bestLanes = cloneLanes(lanes)
  let bestCrossings = countAdjacentCrossings(bestLanes, edgePairs)
  let order = buildOrderIndex(lanes)
  const rememberIfBetter = () => {
    const crossings = countAdjacentCrossings(lanes, edgePairs)
    if (crossings <= bestCrossings) {
      bestLanes = cloneLanes(lanes)
      bestCrossings = crossings
    }
  }
  for (let pass = 0; pass < options.orderingPasses; pass += 1) {
    for (let laneIndex = 1; laneIndex < lanes.length; laneIndex += 1) {
      if (!readableListLanes.has(laneIndex)) {
        sortLaneByScore(
          lanes[laneIndex],
          (id) => weightedAverageKnownOrder(incoming.get(id) ?? [], order),
          order,
          familyPriorityOf,
          explicitOrderOf,
        )
        order = buildOrderIndex(lanes)
      }
    }
    rememberIfBetter()
    for (let laneIndex = lanes.length - 2; laneIndex >= 0; laneIndex -= 1) {
      if (!readableListLanes.has(laneIndex)) {
        sortLaneByScore(
          lanes[laneIndex],
          (id) => weightedAverageKnownOrder(outgoing.get(id) ?? [], order),
          order,
          familyPriorityOf,
          explicitOrderOf,
        )
        order = buildOrderIndex(lanes)
      }
    }
    rememberIfBetter()
  }
  lanes.splice(0, lanes.length, ...bestLanes)

  const nonEmptyLanes = lanes.filter((lane) => lane.length > 0)
  const rankCount = Math.max(1, nonEmptyLanes.length)
  const packedRanks = lanes.map((lane) => choosePackedRank(lane, sizes, rankCount, options, extraGapOf, familyPriorityOf))
  const maxHeight = Math.max(0, ...packedRanks.map((rankBlock) => rankBlock.h))
  const finiteXs = nodes.map((node) => finiteNumber(node.position.x)).filter(Number.isFinite)
  const finiteYs = nodes.map((node) => finiteNumber(node.position.y)).filter(Number.isFinite)
  const minX = finiteXs.length ? Math.min(...finiteXs) : 0
  const minY = finiteYs.length ? Math.min(...finiteYs) : 0

  let rankX = minX
  packedRanks.forEach((rankBlock, rankIndex) => {
    const rankY = minY + (maxHeight - rankBlock.h) / 2
    let columnX = rankX
    for (const column of rankBlock.columns) {
      columnX += column.gapBefore
      let nodeY = rankY + (rankBlock.h - column.h) / 2
      column.ids.forEach((id, index) => {
        const previousId = index > 0 ? column.ids[index - 1] : null
        if (previousId) nodeY += options.gapY + extraGapOf(previousId, id)
        const size = sizes.get(id) || { w: 1, h: 1 }
        positions.set(id, {
          x: columnX + (column.w - size.w) / 2,
          y: nodeY,
        })
        nodeY += size.h
      })
      columnX += column.w
    }
    rankX += rankBlock.w + (rankIndex < packedRanks.length - 1 ? options.rankGapX : 0)
  })

  nodes.forEach((node) => {
    if (!node.locked) return
    positions.set(node.id, {
      x: finiteNumber(node.position.x),
      y: finiteNumber(node.position.y),
    })
  })

  return { positions, sizes }
}

export function computeBalancedDagLayout(
  nodes: BalancedDagLayoutNode[],
  edges: BalancedDagLayoutEdge[],
  rawOptions?: BalancedDagLayoutOptions,
): BalancedDagLayoutResult {
  const options = readOptions(rawOptions)
  if (options.textDocking === 'inline') {
    return computeRankedBalancedDagLayout(nodes, edges, options)
  }

  const noteNodes = nodes.filter(isNoteNode)
  const mainNodes = nodes.filter((node) => !isNoteNode(node))
  if (!noteNodes.length || !mainNodes.length) {
    return computeRankedBalancedDagLayout(nodes, edges, options)
  }

  const mainIds = new Set(mainNodes.map((node) => node.id))
  const noteIds = new Set(noteNodes.map((node) => node.id))
  const mainEdges = buildMainEdgesThroughNotes(edges, mainIds, noteIds)
  const result = computeRankedBalancedDagLayout(mainNodes, mainEdges, options)
  dockNoteNodes(noteNodes, edges, mainIds, options, result.positions, result.sizes)
  return result
}
