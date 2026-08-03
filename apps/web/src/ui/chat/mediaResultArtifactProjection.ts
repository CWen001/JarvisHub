import type { AgentsChatMediaResultStreamPayload } from '../../api/server'
import { collectNodeCanvasAsset } from '../canvasAssetModel'
import type { NativeArtifactSource } from './nativeArtifactProjection'

function resolveSuccessfulNodeArtifact(input: Readonly<{
  nodeId: string
  nodes: readonly unknown[]
}>): NativeArtifactSource | null {
  const nodeId = String(input.nodeId || '').trim()
  if (!nodeId) return null
  const node = input.nodes.find((candidate) => {
    const record = candidate as { id?: unknown } | null
    return String(record?.id || '').trim() === nodeId
  }) as { data?: Record<string, unknown> } | undefined
  if (!node || String(node.data?.status || '').trim() !== 'success') return null

  const asset = collectNodeCanvasAsset({ id: nodeId, data: node.data })
  if (!asset?.url || (!asset.assetId && !asset.assetRefId)) return null
  return {
    title: asset.label,
    url: asset.url,
    thumbnailUrl: asset.thumbnailUrl || asset.url,
    mediaType: asset.kind === 'video' ? 'video' : 'image',
    ...(asset.assetId ? { assetId: asset.assetId } : {}),
    ...(asset.assetRefId ? { assetRefId: asset.assetRefId } : {}),
    nodeId: asset.nodeId,
  }
}

export function resolveSuccessfulMediaResultArtifact(input: Readonly<{
  result: AgentsChatMediaResultStreamPayload
  nodes: readonly unknown[]
}>): NativeArtifactSource | null {
  if (input.result.pending === true || input.result.status !== 'succeeded') return null
  return resolveSuccessfulNodeArtifact({ nodeId: input.result.nodeId, nodes: input.nodes })
}

const MEDIA_GENERATION_TOOL_NAMES = new Set([
  'canvas_image_generate_to_canvas',
  'canvas_video_generate_to_canvas',
])

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function resolveSuccessfulSnapshotNodeId(candidate: unknown): string {
  const call = readRecord(candidate)
  if (!call || call.status !== 'succeeded') return ''

  const media = readRecord(call.media)
  if (media) {
    const nodeId = String(media.nodeId || '').trim()
    return media.status === 'succeeded' && media.pending !== true ? nodeId : ''
  }

  if (!MEDIA_GENERATION_TOOL_NAMES.has(String(call.toolName || '').trim())) return ''
  const outputJson = readRecord(call.outputJson)
  const output = readRecord(outputJson?.data) ?? outputJson
  const outputStatus = String(output?.status || '').trim()
  if (!output || output.pending === true || (outputStatus !== 'success' && outputStatus !== 'succeeded')) return ''
  return String(output.nodeId || '').trim()
}

export function resolveSuccessfulToolSnapshotArtifacts(input: Readonly<{
  toolCallsByTurn: Readonly<Record<string, readonly unknown[]>>
  nodes: readonly unknown[]
}>): NativeArtifactSource[] {
  const out: NativeArtifactSource[] = []
  const seenNodeIds = new Set<string>()
  for (const calls of Object.values(input.toolCallsByTurn)) {
    for (const candidate of calls) {
      const nodeId = resolveSuccessfulSnapshotNodeId(candidate)
      if (!nodeId || seenNodeIds.has(nodeId)) continue
      const asset = resolveSuccessfulNodeArtifact({ nodeId, nodes: input.nodes })
      if (!asset) continue
      seenNodeIds.add(nodeId)
      out.push(asset)
    }
  }
  return out
}
