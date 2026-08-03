import { getTaskNodeCoreType, normalizeTaskNodeKind } from '../canvas/nodes/taskNodeSchema'

export type CanvasAssetMediaKind = 'image' | 'video' | 'text' | 'webpage'

export type CanvasNodeAsset = {
  nodeId: string
  kind: CanvasAssetMediaKind
  label: string
  url?: string
  thumbnailUrl?: string
  assetId?: string
  assetRefId?: string
  text?: string
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// Same precedence as Canvas.tsx resolveNodePrimaryImageUrl / webHero.ts readResultUrl:
// prefer the primary-index result, then any result carrying a url.
function readResultUrl(list: unknown, primaryIndex: unknown): string {
  if (!Array.isArray(list)) return ''
  const raw = typeof primaryIndex === 'number' ? primaryIndex : Number(primaryIndex)
  const idx = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
  const preferred = str((list[idx] as { url?: unknown } | undefined)?.url)
  if (preferred) return preferred
  for (const item of list) {
    const url = str((item as { url?: unknown } | null)?.url)
    if (url) return url
  }
  return ''
}

function readResultItem(list: unknown, primaryIndex: unknown): Record<string, unknown> | null {
  if (!Array.isArray(list)) return null
  const raw = typeof primaryIndex === 'number' ? primaryIndex : Number(primaryIndex)
  const idx = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
  const preferred = list[idx]
  if (preferred && str((preferred as { url?: unknown }).url)) return preferred as Record<string, unknown>
  for (const item of list) {
    if (item && str((item as { url?: unknown }).url)) return item as Record<string, unknown>
  }
  return null
}

// Single source of truth: resolve one canvas node into a displayable/exportable
// asset (or null). Node kind is normalized via the schema kernel so imageEdit
// maps to image and legacy aliases (imageedit / texttoimage / ppt / ...) are
// handled the same way the rest of the app treats them.
export function collectNodeCanvasAsset(node: unknown): CanvasNodeAsset | null {
  const n = node as { id?: unknown; data?: Record<string, unknown> } | null
  const data = n?.data
  if (!data || typeof data !== 'object') return null
  const nodeId = str(n?.id)
  if (!nodeId) return null

  const rawKind = str(data.kind)
  const normalizedKind = normalizeTaskNodeKind(rawKind)
  const coreType = getTaskNodeCoreType(rawKind)
  const label = str(data.label) || str(data.prompt) || 'Asset'

  // webHero carries page semantics even though its coreType is text.
  if (normalizedKind === 'webHero') {
    const html = str(data.webHeroDocumentHtml)
    if (html) {
      return { nodeId, kind: 'webpage', label: str(data.label) || 'Web Page', text: html }
    }
    return null
  }

  if (coreType === 'image') {
    const url = str(data.imageUrl) || readResultUrl(data.imageResults, data.imagePrimaryIndex)
    if (!url) return null
    const item = readResultItem(data.imageResults, data.imagePrimaryIndex)
    const thumbnailUrl = str((item as { thumbnailUrl?: unknown } | null)?.thumbnailUrl) || url
    const assetId = str(item?.assetId) || str(data.assetId)
    const assetRefId = str(item?.assetRefId) || str(data.assetRefId)
    return {
      nodeId,
      kind: 'image',
      label,
      url,
      thumbnailUrl,
      ...(assetId ? { assetId } : {}),
      ...(assetRefId ? { assetRefId } : {}),
    }
  }

  if (coreType === 'video') {
    const url = str(data.videoUrl) || readResultUrl(data.videoResults, data.videoPrimaryIndex)
    if (!url) return null
    const item = readResultItem(data.videoResults, data.videoPrimaryIndex)
    const thumbnailUrl =
      str((item as { thumbnailUrl?: unknown } | null)?.thumbnailUrl) || str(data.videoThumbnailUrl)
    const assetId = str(item?.assetId) || str(data.assetId)
    const assetRefId = str(item?.assetRefId) || str(data.assetRefId)
    return {
      nodeId,
      kind: 'video',
      label,
      url,
      thumbnailUrl: thumbnailUrl || undefined,
      ...(assetId ? { assetId } : {}),
      ...(assetRefId ? { assetRefId } : {}),
    }
  }

  // Remaining text-family nodes (text, character, pptDeck without page HTML).
  const textResult = Array.isArray(data.textResults)
    ? str((data.textResults[0] as { text?: unknown } | undefined)?.text)
    : ''
  const text = textResult || str(data.prompt)
  if (text) {
    return { nodeId, kind: 'text', label: text.slice(0, 40) || label, text }
  }
  return null
}

export function collectCanvasAssets(nodes: unknown[]): CanvasNodeAsset[] {
  const out: CanvasNodeAsset[] = []
  for (const node of nodes) {
    const asset = collectNodeCanvasAsset(node)
    if (asset) out.push(asset)
  }
  return out
}
