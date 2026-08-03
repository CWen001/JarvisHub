import { collectNodeCanvasAsset } from '../canvasAssetModel'

export type NativeArtifactSource = Readonly<{
  title: string
  url: string
  thumbnailUrl?: string
  mediaType?: 'image' | 'video'
  assetId?: string
  assetRefId?: string
  nodeId?: string
}>

export type NativeArtifactProjection =
  | Readonly<{ kind: 'native-thumbnail' }>
  | Readonly<{
      kind: 'artifact-card'
      title: string
      url: string
      previewUrl: string
      mediaType: 'image' | 'video'
      assetId?: string
      assetRefId?: string
      nodeId: string
      status: 'queued' | 'running' | 'success' | 'failed'
    }>

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveNativeArtifactProjection(input: Readonly<{
  asset: NativeArtifactSource
  nodes: readonly unknown[]
}>): NativeArtifactProjection {
  const assetId = text(input.asset.assetId)
  const assetRefId = text(input.asset.assetRefId)
  const requestedNodeId = text(input.asset.nodeId)
  if (!assetId && !assetRefId) return { kind: 'native-thumbnail' }

  const url = text(input.asset.url)
  const node = input.nodes.find((candidate) => {
    const record = candidate as { id?: unknown } | null
    const canvasAsset = collectNodeCanvasAsset(candidate)
    if (!canvasAsset) return false
    if (requestedNodeId && text(record?.id) !== requestedNodeId) return false
    const assetIdMatches = assetId && text(canvasAsset.assetId) === assetId
    const assetRefIdMatches = assetRefId && text(canvasAsset.assetRefId) === assetRefId
    return Boolean(assetIdMatches || assetRefIdMatches)
  }) as { id?: unknown; data?: Record<string, unknown> } | undefined
  const nodeId = text(node?.id)
  if (!url || !nodeId || text(node?.data?.status) !== 'success') {
    return { kind: 'native-thumbnail' }
  }

  const inferredVideo = input.asset.mediaType === 'video' || /\.(mp4|mov|webm|mkv)(\?|$)/i.test(url)
  return {
    kind: 'artifact-card',
    title: text(input.asset.title) || (inferredVideo ? 'Generated video' : 'Generated image'),
    url,
    previewUrl: text(input.asset.thumbnailUrl) || url,
    mediaType: inferredVideo ? 'video' : 'image',
    ...(assetId ? { assetId } : {}),
    ...(assetRefId ? { assetRefId } : {}),
    nodeId,
    status: 'success',
  }
}
