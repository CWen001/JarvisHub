import type { AssetZipCanvasAssetInput, AssetZipKind, AssetZipMediaType } from '../api/server'
import { getTaskNodeCoreType, normalizeTaskNodeKind } from '../canvas/nodes/taskNodeSchema'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function shouldKeep(mediaType: AssetZipMediaType, kind: AssetZipKind): boolean {
  return kind === 'all' || mediaType === kind
}

function pushUrlAsset(
  out: AssetZipCanvasAssetInput[],
  seen: Set<string>,
  input: {
    nodeId: string
    label: string
    mediaType: 'image' | 'video' | 'audio'
    url: unknown
    source: string
    kind: AssetZipKind
  },
): void {
  const url = normalizeString(input.url)
  if (!url || !shouldKeep(input.mediaType, input.kind)) return
  const key = `${input.mediaType}:url:${url}`
  if (seen.has(key)) return
  seen.add(key)
  out.push({
    nodeId: input.nodeId,
    label: input.label,
    mediaType: input.mediaType,
    url,
    source: input.source,
  })
}

function pushInlineAsset(
  out: AssetZipCanvasAssetInput[],
  seen: Set<string>,
  input: {
    nodeId: string
    label: string
    mediaType: 'text' | 'html'
    value: unknown
    source: string
    kind: AssetZipKind
  },
): void {
  const value = normalizeString(input.value)
  if (!value || !shouldKeep(input.mediaType, input.kind)) return
  const key = `${input.mediaType}:inline:${value}`
  if (seen.has(key)) return
  seen.add(key)
  out.push({
    nodeId: input.nodeId,
    label: input.label,
    mediaType: input.mediaType,
    ...(input.mediaType === 'html' ? { html: value } : { text: value }),
    source: input.source,
  })
}

function readNodeLabel(nodeId: string, data: UnknownRecord): string {
  return normalizeString(data.label) || normalizeString(data.prompt) || nodeId
}

export function collectCanvasAssetsForZip(nodes: unknown[], kind: AssetZipKind = 'all'): AssetZipCanvasAssetInput[] {
  const out: AssetZipCanvasAssetInput[] = []
  const seen = new Set<string>()

  for (const node of nodes) {
    if (!isRecord(node)) continue
    const nodeId = normalizeString(node.id)
    const data = isRecord(node.data) ? node.data : null
    if (!nodeId || !data) continue

    const nodeKind = normalizeString(data.kind)
    const normalizedKind = normalizeTaskNodeKind(nodeKind)
    const nodeCoreType = getTaskNodeCoreType(nodeKind)
    const label = readNodeLabel(nodeId, data)

    pushUrlAsset(out, seen, {
      nodeId,
      label,
      mediaType: 'image',
      url: data.imageUrl,
      source: 'imageUrl',
      kind,
    })
    const imageResults = Array.isArray(data.imageResults) ? data.imageResults : []
    imageResults.forEach((item, index) => {
      if (!isRecord(item)) return
      pushUrlAsset(out, seen, {
        nodeId,
        label,
        mediaType: 'image',
        url: item.url,
        source: `imageResults[${index}].url`,
        kind,
      })
    })

    pushUrlAsset(out, seen, {
      nodeId,
      label,
      mediaType: 'video',
      url: data.videoUrl,
      source: 'videoUrl',
      kind,
    })
    const videoResults = Array.isArray(data.videoResults) ? data.videoResults : []
    videoResults.forEach((item, index) => {
      if (!isRecord(item)) return
      pushUrlAsset(out, seen, {
        nodeId,
        label,
        mediaType: 'video',
        url: item.url,
        source: `videoResults[${index}].url`,
        kind,
      })
    })

    pushUrlAsset(out, seen, {
      nodeId,
      label,
      mediaType: 'audio',
      url: data.audioUrl,
      source: 'audioUrl',
      kind,
    })
    const audioResults = Array.isArray(data.audioResults) ? data.audioResults : []
    audioResults.forEach((item, index) => {
      if (!isRecord(item)) return
      pushUrlAsset(out, seen, {
        nodeId,
        label,
        mediaType: 'audio',
        url: item.url,
        source: `audioResults[${index}].url`,
        kind,
      })
    })

    if (normalizedKind !== 'webHero' && nodeCoreType === 'text') {
      const textResults = Array.isArray(data.textResults) ? data.textResults : []
      let pushedText = false
      textResults.forEach((item, index) => {
        if (!isRecord(item)) return
        const before = out.length
        pushInlineAsset(out, seen, {
          nodeId,
          label,
          mediaType: 'text',
          value: item.text,
          source: `textResults[${index}].text`,
          kind,
        })
        if (out.length > before) pushedText = true
      })
      if (!pushedText) {
        pushInlineAsset(out, seen, {
          nodeId,
          label,
          mediaType: 'text',
          value: data.prompt,
          source: 'prompt',
          kind,
        })
      }
    }

    if (normalizedKind === 'webHero') {
      pushInlineAsset(out, seen, {
        nodeId,
        label,
        mediaType: 'html',
        value: data.webHeroDocumentHtml,
        source: 'webHeroDocumentHtml',
        kind,
      })
    }
  }

  return out
}
