import type { Node } from '@xyflow/react'
import { estimateNodeRenderSize } from '../nodeSizes'

export type XY = { x: number; y: number }
export type NodeSize = { w: number; h: number }
export type NodeRect = { x: number; y: number; w: number; h: number }

type NodeLikeWithOptionalRuntimeFields = Node & {
  measured?: { width?: unknown; height?: unknown }
  width?: unknown
  height?: unknown
  style?: { width?: unknown; height?: unknown }
  parentId?: unknown
  parentNode?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseNumeric(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number.parseFloat(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function fallbackSizeForNode(node: Node): NodeSize {
  const type = String(node.type || '')
  const data = isRecord(node.data) ? node.data : {}
  const kind = String(data.kind || '')
  if (type === 'taskNode') {
    return estimateNodeRenderSize({ kind })
  }
  if (type === 'groupNode') return { w: 240, h: 160 }
  if (type === 'ioNode') return { w: 104, h: 36 }
  return { w: 220, h: 120 }
}

export function getNodeSize(node: Node, fallback?: NodeSize): NodeSize {
  const runtimeNode = node as NodeLikeWithOptionalRuntimeFields
  const data = isRecord(runtimeNode.data) ? runtimeNode.data : {}

  const measuredW =
    typeof runtimeNode.measured?.width === 'number' && Number.isFinite(runtimeNode.measured.width)
      ? runtimeNode.measured.width
      : undefined
  const measuredH =
    typeof runtimeNode.measured?.height === 'number' && Number.isFinite(runtimeNode.measured.height)
      ? runtimeNode.measured.height
      : undefined

  const widthProp = typeof runtimeNode.width === 'number' && Number.isFinite(runtimeNode.width) ? runtimeNode.width : undefined
  const heightProp = typeof runtimeNode.height === 'number' && Number.isFinite(runtimeNode.height) ? runtimeNode.height : undefined

  const dataW = typeof data?.nodeWidth === 'number' && Number.isFinite(data.nodeWidth) ? data.nodeWidth : undefined
  const dataH = typeof data?.nodeHeight === 'number' && Number.isFinite(data.nodeHeight) ? data.nodeHeight : undefined

  const styleW = parseNumeric(runtimeNode.style?.width)
  const styleH = parseNumeric(runtimeNode.style?.height)

  const resolvedFallback = fallback ?? fallbackSizeForNode(node)
  const w = measuredW ?? widthProp ?? dataW ?? styleW ?? resolvedFallback.w
  const h = measuredH ?? heightProp ?? dataH ?? styleH ?? resolvedFallback.h
  return { w, h }
}

export function getNodeAbsPosition(node: Node, nodesById: Map<string, Node>): XY {
  const visiting = new Set<string>()

  const resolve = (cur: Node): XY => {
    const runtimeNode = cur as NodeLikeWithOptionalRuntimeFields
    const id = typeof cur?.id === 'string' ? cur.id : ''
    if (id) {
      if (visiting.has(id)) return { x: cur.position?.x || 0, y: cur.position?.y || 0 }
      visiting.add(id)
    }

    const base = { x: cur.position?.x || 0, y: cur.position?.y || 0 }
    const parentId =
      typeof runtimeNode.parentId === 'string'
        ? runtimeNode.parentId
        : typeof runtimeNode.parentNode === 'string'
          ? runtimeNode.parentNode
          : null
    if (!parentId) return base
    const parent = nodesById.get(parentId)
    if (!parent) return base
    const p = resolve(parent)
    return { x: p.x + base.x, y: p.y + base.y }
  }

  return resolve(node)
}

export function getNodeAbsRect(node: Node, nodesById: Map<string, Node>, fallback?: NodeSize): NodeRect {
  const pos = getNodeAbsPosition(node, nodesById)
  const size = getNodeSize(node, fallback)
  return { x: pos.x, y: pos.y, w: size.w, h: size.h }
}
