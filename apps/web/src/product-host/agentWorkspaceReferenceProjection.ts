import type { AgentWorkspacePendingReferenceFact } from './agentWorkspaceProjection'

type NativeReferenceVideo = Readonly<{
  url: string
  thumbnailUrl?: string
  label: string
  nodeId?: string
}>

type NativeReferenceAssetMeta = Readonly<{
  assetId?: string
  assetRefId?: string
  name?: string
}>

export type AgentWorkspaceNativeReferenceState = Readonly<{
  replicateTargetImage: string
  manualReferenceImages: readonly string[]
  manualReferenceVideos: readonly NativeReferenceVideo[]
  uploadedReferenceAssetMeta: Readonly<Record<string, NativeReferenceAssetMeta>>
}>

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function projectAgentWorkspacePendingReferences(
  state: AgentWorkspaceNativeReferenceState,
): readonly AgentWorkspacePendingReferenceFact[] {
  const references: AgentWorkspacePendingReferenceFact[] = []
  const seen = new Set<string>()
  const targetUrl = text(state.replicateTargetImage)
  if (targetUrl) {
    seen.add(targetUrl)
    references.push(Object.freeze({ kind: 'image', url: targetUrl, label: '目标效果图' }))
  }
  for (const rawUrl of state.manualReferenceImages) {
    const url = text(rawUrl)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const metadata = state.uploadedReferenceAssetMeta[url]
    references.push(Object.freeze({
      kind: 'image',
      url,
      label: text(metadata?.name) || '参考图片',
      ...(text(metadata?.assetId) ? { assetId: text(metadata?.assetId) } : {}),
      ...(text(metadata?.assetRefId) ? { assetRefId: text(metadata?.assetRefId) } : {}),
    }))
  }
  for (const video of state.manualReferenceVideos) {
    const url = text(video.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    references.push(Object.freeze({
      kind: 'video',
      url,
      label: text(video.label) || '参考视频',
      ...(text(video.thumbnailUrl) ? { thumbnailUrl: text(video.thumbnailUrl) } : {}),
      ...(text(video.nodeId) ? { nodeId: text(video.nodeId) } : {}),
    }))
  }
  return Object.freeze(references)
}

export function removeAgentWorkspacePendingReference<T extends AgentWorkspaceNativeReferenceState>(
  state: T,
  rawUrl: string,
): T {
  const url = text(rawUrl)
  if (!url) return state
  const nextMetadata = Object.fromEntries(
    Object.entries(state.uploadedReferenceAssetMeta).filter(([candidate]) => candidate !== url),
  )
  return {
    ...state,
    replicateTargetImage: text(state.replicateTargetImage) === url ? '' : state.replicateTargetImage,
    manualReferenceImages: state.manualReferenceImages.filter((candidate) => text(candidate) !== url),
    manualReferenceVideos: state.manualReferenceVideos.filter((candidate) => text(candidate.url) !== url),
    uploadedReferenceAssetMeta: nextMetadata,
  }
}

export function clearSubmittedAgentWorkspaceReferences<T extends AgentWorkspaceNativeReferenceState>(state: T): T {
  return {
    ...state,
    replicateTargetImage: '',
    manualReferenceImages: [],
    manualReferenceVideos: [],
    uploadedReferenceAssetMeta: {},
  }
}
