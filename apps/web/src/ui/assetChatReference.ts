import type { NativeArtifactSource } from './chat/nativeArtifactProjection'

export function buildAssetChatReference(input: Readonly<{
  kind: 'image' | 'video' | 'text' | 'webpage'
  title: string
  url?: string | null
  thumbnailUrl?: string | null
  assetId?: string | null
  assetRefId?: string | null
  nodeId?: string | null
}>): NativeArtifactSource | null {
  if (input.kind !== 'image' && input.kind !== 'video') return null
  const url = String(input.url || '').trim()
  if (!url) return null
  const thumbnailUrl = String(input.thumbnailUrl || '').trim()
  const assetId = String(input.assetId || '').trim()
  const assetRefId = String(input.assetRefId || '').trim()
  const nodeId = String(input.nodeId || '').trim()
  return {
    title: String(input.title || '').trim() || 'Asset reference',
    url,
    mediaType: input.kind,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(assetId ? { assetId } : {}),
    ...(assetRefId ? { assetRefId } : {}),
    ...(nodeId ? { nodeId } : {}),
  }
}
