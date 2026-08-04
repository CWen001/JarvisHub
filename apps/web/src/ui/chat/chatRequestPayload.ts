export type ChatAssetInputRole =
  | 'target'
  | 'reference'
  | 'character'
  | 'scene'
  | 'prop'
  | 'product'
  | 'style'
  | 'context'
  | 'mask'

export type ChatAssetInput = {
  assetId?: string
  assetRefId?: string
  url?: string
  role?: ChatAssetInputRole
  weight?: number
  note?: string
  name?: string
}

type SelectedImageAssetCandidate = {
  assetId?: string
  assetRefId?: string
  url: string
  role?: ChatAssetInputRole
  note?: string
  name?: string
}

type ChatRequestExecution = {
  mode: 'auto'
  forceAssetGeneration: boolean
}

export type ChatSurface = 'native' | 'agent-workspace'

export function resolveCanvasSelectionPolicy(input: {
  surface: ChatSurface
  explicitAttachCanvasContext: boolean
  hasImplicitRequest: boolean
  hasReplicateTarget: boolean
}): {
  includeSelectedCanvasMedia: boolean
  attachSelectedCanvasNodeContext: boolean
} {
  const nativeSurface = input.surface === 'native'
  return {
    includeSelectedCanvasMedia: nativeSurface,
    attachSelectedCanvasNodeContext:
      nativeSurface ||
      input.explicitAttachCanvasContext ||
      input.hasImplicitRequest ||
      input.hasReplicateTarget,
  }
}

type ChatRuntimeSkillMenuItem = {
  key: string
  updatedAt?: string | null
  sortOrder?: number | null
}

type ChatSelectedRuntimeSkill = {
  key?: string | null
}

type SelectedStyleReferenceCard = {
  title?: string
  imageUrl?: string
  thumbnailUrl?: string
}

export type StyleReferenceTranscriptAsset = {
  title: string
  url: string
  thumbnailUrl?: string
  mediaType: 'image'
}

export function buildStyleReferenceTranscriptAsset(
  card: SelectedStyleReferenceCard | null | undefined,
): StyleReferenceTranscriptAsset | null {
  const url = String(card?.imageUrl || '').trim()
  if (!url) return null
  const title = String(card?.title || '').trim() || '已选风格参考图'
  const thumbnailUrl = String(card?.thumbnailUrl || '').trim()
  return {
    title,
    url,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    mediaType: 'image',
  }
}

export function buildSelectedImageAssetInputs(
  items: SelectedImageAssetCandidate[],
): ChatAssetInput[] {
  const out: ChatAssetInput[] = []
  const seen = new Set<string>()

  for (const item of items) {
    const url = String(item.url || '').trim()
    if (!url) continue
    const key = url
    if (seen.has(key)) continue
    seen.add(key)
    const assetId = typeof item.assetId === 'string' ? item.assetId.trim() : ''
    const assetRefId = typeof item.assetRefId === 'string' ? item.assetRefId.trim() : ''
    const role = item.role || 'reference'
    const note = typeof item.note === 'string' ? item.note.trim() : ''
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    out.push({
      ...(assetId ? { assetId } : {}),
      ...(assetRefId ? { assetRefId } : {}),
      url,
      role,
      ...(note ? { note } : {}),
      ...(name ? { name } : {}),
    })
  }

  return out
}

export function selectChatRuntimeSkillsForMenu<T extends ChatRuntimeSkillMenuItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const sa = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER
    const sb = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    const updatedCompare = String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''))
    if (updatedCompare !== 0) return updatedCompare
    return a.key.localeCompare(b.key)
  })
}

export function buildRequiredSkillsForChat(skill: ChatSelectedRuntimeSkill | null | undefined): string[] {
  const key = typeof skill?.key === 'string' ? skill.key.trim() : ''
  return key ? [key] : []
}

export function resolveChatRequestExecution(): ChatRequestExecution {
  return {
    mode: 'auto',
    forceAssetGeneration: false,
  }
}
