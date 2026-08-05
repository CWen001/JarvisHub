import type {
  AgentWorkspaceAssetFact,
  AgentWorkspaceRunFact,
  AgentWorkspaceTimelineAsset,
  AgentWorkspaceTimelineEntryFact,
} from './agentWorkspaceProjection'

export type AgentWorkspaceArtifactDeliveryRunEvidence = Readonly<{
  status: 'running' | 'succeeded' | 'failed'
  assistantMessageId?: string
  startedAt?: number
  updatedAt?: number
  todoItems?: AgentWorkspaceRunFact['todoItems']
  media: readonly Readonly<{
    nodeId: string
    status: 'queued' | 'running' | 'succeeded' | 'failed'
    pending: boolean
  }>[]
}>

export type AgentWorkspaceArtifactDeliveryResult = Readonly<{
  timeline: readonly AgentWorkspaceTimelineEntryFact[]
  run: AgentWorkspaceRunFact
}>

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stableTimelineAsset(asset: AgentWorkspaceTimelineAsset): boolean {
  return Boolean(text(asset.nodeId) && text(asset.url) && (text(asset.assetId) || text(asset.assetRefId)))
}

function timelineAssetIdentity(asset: AgentWorkspaceTimelineAsset): string {
  return text(asset.nodeId) || text(asset.assetId) || text(asset.assetRefId) || text(asset.url)
}

function projectStableArtifact(asset: AgentWorkspaceAssetFact): AgentWorkspaceTimelineAsset {
  return Object.freeze({
    title: text(asset.title) || (asset.kind === 'video' ? '生成视频' : '生成图片'),
    kind: asset.kind,
    url: text(asset.url),
    ...(text(asset.thumbnailUrl) ? { thumbnailUrl: text(asset.thumbnailUrl) } : {}),
    nodeId: text(asset.nodeId),
    ...(text(asset.assetId) ? { assetId: text(asset.assetId) } : {}),
    ...(text(asset.assetRefId) ? { assetRefId: text(asset.assetRefId) } : {}),
  })
}

function mergeStableArtifacts(
  existing: readonly AgentWorkspaceTimelineAsset[],
  stable: readonly AgentWorkspaceTimelineAsset[],
): readonly AgentWorkspaceTimelineAsset[] {
  const seen = new Set<string>()
  return Object.freeze([...stable, ...existing].filter((asset) => {
    const identity = timelineAssetIdentity(asset)
    if (!identity || seen.has(identity)) return false
    seen.add(identity)
    return true
  }).map((asset) => Object.freeze({ ...asset })))
}

function targetAssistantIndex(
  timeline: readonly AgentWorkspaceTimelineEntryFact[],
  assistantMessageId?: string,
): number {
  const requestedId = text(assistantMessageId)
  if (requestedId) {
    const requested = timeline.findIndex((entry) => entry.id === requestedId && entry.role === 'assistant')
    if (requested >= 0) return requested
  }
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (timeline[index]?.role === 'assistant') return index
  }
  return -1
}

function runFact(
  evidence: AgentWorkspaceArtifactDeliveryRunEvidence | null | undefined,
  target?: AgentWorkspaceTimelineEntryFact,
): AgentWorkspaceRunFact {
  if (!evidence) return Object.freeze({ status: 'idle', label: '等待你的设计意图' })
  const hasUsableArtifact = (target?.assets ?? []).some(stableTimelineAsset)
  const partial = target?.result === 'partial' || (evidence.status === 'failed' && hasUsableArtifact)
  const common = {
    ...(evidence.startedAt !== undefined ? { startedAt: evidence.startedAt } : {}),
    ...(evidence.updatedAt !== undefined ? { updatedAt: evidence.updatedAt } : {}),
    ...(evidence.todoItems ? { todoItems: evidence.todoItems } : {}),
  }
  if (partial) return Object.freeze({ status: 'partial', label: '结果已生成，后续步骤部分完成', ...common })

  const providerComplete = evidence.media.some((media) => media.status === 'succeeded' && media.pending !== true)
  if (providerComplete && !hasUsableArtifact && evidence.status !== 'failed') {
    return Object.freeze({ status: 'running', label: '图片已生成，正在保存到项目', ...common })
  }
  if (evidence.status === 'running') return Object.freeze({ status: 'running', label: '设计任务正在进行', ...common })
  if (evidence.status === 'failed') return Object.freeze({ status: 'failed', label: '本轮设计需要处理', ...common })
  return Object.freeze({ status: 'succeeded', label: '本轮设计已经完成', ...common })
}

export function reconcileArtifactDelivery(input: Readonly<{
  timeline: readonly AgentWorkspaceTimelineEntryFact[]
  assets: readonly AgentWorkspaceAssetFact[]
  run?: AgentWorkspaceArtifactDeliveryRunEvidence | null
}>): AgentWorkspaceArtifactDeliveryResult {
  const terminalNodeIds = new Set(
    (input.run?.media ?? [])
      .filter((media) => media.status === 'succeeded' && media.pending !== true)
      .map((media) => text(media.nodeId))
      .filter(Boolean),
  )
  const stableArtifacts = input.assets
    .filter((asset) => (
      terminalNodeIds.has(text(asset.nodeId))
      && asset.status === 'success'
      && Boolean(text(asset.nodeId) && text(asset.url) && (text(asset.assetId) || text(asset.assetRefId)))
    ))
    .map(projectStableArtifact)
  const assistantIndex = targetAssistantIndex(input.timeline, input.run?.assistantMessageId)
  const timeline = Object.freeze(input.timeline.map((entry, index) => Object.freeze(index === assistantIndex && stableArtifacts.length
    ? { ...entry, assets: mergeStableArtifacts(entry.assets ?? [], stableArtifacts) }
    : { ...entry, assets: Object.freeze([...(entry.assets ?? [])].map((asset) => Object.freeze({ ...asset }))) })))

  return Object.freeze({
    timeline,
    run: runFact(input.run, assistantIndex >= 0 ? timeline[assistantIndex] : undefined),
  })
}
