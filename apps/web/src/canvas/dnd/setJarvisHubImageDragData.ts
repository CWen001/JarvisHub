export type JarvisHubImageDragMeta = {
  label?: string
  prompt?: string
  sourceKind?: string
  sourceNodeId?: string
  sourceIndex?: number
  shotNo?: number
}

export type JarvisHubImageDragPayload = {
  url: string
  label?: string
  prompt?: string
  sourceKind?: string
  sourceNodeId?: string
  sourceIndex?: number
  shotNo?: number
}

const trimString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const parseJarvisHubImageDragPayload = (raw: string): JarvisHubImageDragPayload | null => {
  const trimmed = trimString(raw)
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === 'string') {
      const url = trimString(parsed)
      return url ? { url } : null
    }
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    const url = trimString(record.url)
    if (!url) return null
    const payload: JarvisHubImageDragPayload = { url }
    const label = trimString(record.label)
    const prompt = trimString(record.prompt)
    const sourceKind = trimString(record.sourceKind)
    const sourceNodeId = trimString(record.sourceNodeId)
    const sourceIndexRaw = Number(record.sourceIndex)
    const shotNoRaw = Number(record.shotNo)
    if (label) payload.label = label
    if (prompt) payload.prompt = prompt
    if (sourceKind) payload.sourceKind = sourceKind
    if (sourceNodeId) payload.sourceNodeId = sourceNodeId
    if (Number.isFinite(sourceIndexRaw)) payload.sourceIndex = Math.max(0, Math.trunc(sourceIndexRaw))
    if (Number.isFinite(shotNoRaw)) payload.shotNo = Math.max(1, Math.trunc(shotNoRaw))
    return payload
  } catch {
    return trimmed ? { url: trimmed } : null
  }
}

export const getJarvisHubImageDragPayload = (dataTransfer: DataTransfer | null | undefined): JarvisHubImageDragPayload | null => {
  if (!dataTransfer) return null
  const raw = dataTransfer.getData('application/jarvishub-image-url')
  if (raw) return parseJarvisHubImageDragPayload(raw)
  const fallback = dataTransfer.getData('text/plain')
  return parseJarvisHubImageDragPayload(fallback)
}

export function setJarvisHubImageDragData(
  evt: React.DragEvent,
  url: string,
  meta?: JarvisHubImageDragMeta,
): void {
  const trimmed = (url || '').trim()
  if (!trimmed) return
  if (!evt.dataTransfer) return

  try {
    evt.dataTransfer.effectAllowed = 'copy'
  } catch {
    // ignore
  }

  // Used by canvas drop handler.
  try {
    const payload: JarvisHubImageDragPayload = { url: trimmed }
    const label = trimString(meta?.label)
    const prompt = trimString(meta?.prompt)
    const sourceKind = trimString(meta?.sourceKind)
    const sourceNodeId = trimString(meta?.sourceNodeId)
    if (label) payload.label = label
    if (prompt) payload.prompt = prompt
    if (sourceKind) payload.sourceKind = sourceKind
    if (sourceNodeId) payload.sourceNodeId = sourceNodeId
    if (Number.isFinite(meta?.sourceIndex)) payload.sourceIndex = Math.max(0, Math.trunc(Number(meta?.sourceIndex)))
    if (Number.isFinite(meta?.shotNo)) payload.shotNo = Math.max(1, Math.trunc(Number(meta?.shotNo)))
    evt.dataTransfer.setData('application/jarvishub-image-url', JSON.stringify(payload))
  } catch {
    // ignore
  }

  // Safari / generic fallbacks.
  try {
    evt.dataTransfer.setData('text/plain', trimmed)
  } catch {
    // ignore
  }
}
