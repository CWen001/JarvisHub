export type WebHeroRefinementSelectionKind = 'element' | 'pod'

export type WebHeroRefinementExecutionScope = 'node-only'

export type WebHeroRefinementBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type WebHeroRefinementPodMember = {
  elementId: string
  selector: string
  label: string
  text: string
  htmlHint: string
  position: WebHeroRefinementBounds
  sourceLocation?: WebHeroRefinementSourceLocation
}

export type WebHeroRefinementSourceLocation = {
  file: string
  line?: number
  column?: number
  componentName?: string
}

export type WebHeroRefinementTarget = {
  elementId: string
  selector: string
  label: string
  text: string
  htmlHint: string
  position: WebHeroRefinementBounds
  selectionKind: WebHeroRefinementSelectionKind
  sourceLocation?: WebHeroRefinementSourceLocation
  memberCount?: number
  podMembers?: WebHeroRefinementPodMember[]
}

export type WebHeroRefinementAttachment = WebHeroRefinementTarget & {
  id: string
  note: string
  createdAt: string
  executionScope: WebHeroRefinementExecutionScope
  source: 'web-preview'
}

type WebHeroRefinementPromptAttachment = {
  id: string
  selectionKind: WebHeroRefinementSelectionKind
  label: string
  selector: string
  note: string
  position: string
  currentText: string
  htmlHint: string
  executionScope: WebHeroRefinementExecutionScope
  sourceLocation?: WebHeroRefinementSourceLocation
  memberCount?: number
  podMembers?: Array<{
    elementId: string
    label: string
    selector: string
    sourceLocation?: WebHeroRefinementSourceLocation
  }>
}

const TEXT_LIMIT = 180
const HTML_HINT_LIMIT = 220
const SELECTOR_LIMIT = 220
const LABEL_LIMIT = 120
const NOTE_LIMIT = 320
const POD_MEMBER_LIMIT = 8

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function compactText(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trim()}…`
}

function readFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.round(numeric)
}

function normalizeBounds(value: unknown): WebHeroRefinementBounds | null {
  const record = isRecord(value) ? value : {}
  const x = readFiniteNumber(record.x)
  const y = readFiniteNumber(record.y)
  const width = readFiniteNumber(record.width)
  const height = readFiniteNumber(record.height)
  if (x === null || y === null || width === null || height === null) return null
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

function normalizeSourceLocation(value: unknown): WebHeroRefinementSourceLocation | undefined {
  const record = isRecord(value) ? value : {}
  const file = compactText(readString(record.file), SELECTOR_LIMIT)
  if (!file) return undefined
  const line = readFiniteNumber(record.line)
  const column = readFiniteNumber(record.column)
  return {
    file,
    line: line !== null && line > 0 ? line : undefined,
    column: column !== null && column > 0 ? column : undefined,
    componentName: compactText(readString(record.componentName), LABEL_LIMIT) || undefined,
  }
}

function normalizePodMembers(value: unknown): WebHeroRefinementPodMember[] {
  if (!Array.isArray(value)) return []
  const members: WebHeroRefinementPodMember[] = []
  value.forEach((item) => {
    if (!isRecord(item)) return
    const elementId = compactText(readString(item.elementId), LABEL_LIMIT)
    const selector = compactText(readString(item.selector), SELECTOR_LIMIT)
    const label = compactText(readString(item.label), LABEL_LIMIT)
    const position = normalizeBounds(item.position)
    if (!elementId || !selector || !position) return
    members.push({
      elementId,
      selector,
      label,
      text: compactText(readString(item.text), TEXT_LIMIT),
      htmlHint: compactText(readString(item.htmlHint), HTML_HINT_LIMIT),
      position,
      sourceLocation: normalizeSourceLocation(item.sourceLocation),
    })
  })
  return members
}

function normalizeTarget(value: unknown): WebHeroRefinementTarget | null {
  const record = isRecord(value) ? value : {}
  const elementId = compactText(readString(record.elementId), LABEL_LIMIT)
  const selector = compactText(readString(record.selector), SELECTOR_LIMIT)
  const position = normalizeBounds(record.position)
  if (!elementId || !selector || !position) return null
  const selectionKind: WebHeroRefinementSelectionKind = record.selectionKind === 'pod' ? 'pod' : 'element'
  const podMembers = selectionKind === 'pod' ? normalizePodMembers(record.podMembers) : []
  const rawMemberCount = readFiniteNumber(record.memberCount)
  const memberCount = selectionKind === 'pod'
    ? Math.max(0, podMembers.length > 0 ? podMembers.length : rawMemberCount ?? 0)
    : undefined
  return {
    elementId,
    selector,
    label: compactText(readString(record.label), LABEL_LIMIT) || elementId,
    text: compactText(readString(record.text), TEXT_LIMIT),
    htmlHint: compactText(readString(record.htmlHint), HTML_HINT_LIMIT),
    position,
    selectionKind,
    sourceLocation: normalizeSourceLocation(record.sourceLocation),
    memberCount,
    podMembers: podMembers.length > 0 ? podMembers : undefined,
  }
}

export function createWebHeroRefinementAttachment(input: {
  target: WebHeroRefinementTarget
  note: string
}): WebHeroRefinementAttachment {
  const note = compactText(input.note, NOTE_LIMIT)
  if (!note) {
    throw new Error('网页调优评论不能为空')
  }
  return {
    ...input.target,
    id: `webhero-refine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    note,
    createdAt: new Date().toISOString(),
    executionScope: 'node-only',
    source: 'web-preview',
  }
}

export function readWebHeroRefinementAttachments(value: unknown): WebHeroRefinementAttachment[] {
  if (!Array.isArray(value)) return []
  const attachments: WebHeroRefinementAttachment[] = []
  value.forEach((item, index) => {
    if (!isRecord(item)) return
    const target = normalizeTarget(item)
    const note = compactText(readString(item.note), NOTE_LIMIT)
    if (!target || !note) return
    const executionScope: WebHeroRefinementExecutionScope = 'node-only'
    const createdAt = readString(item.createdAt) || new Date(0).toISOString()
    attachments.push({
      ...target,
      id: readString(item.id) || `webhero-refine-${index + 1}`,
      note,
      createdAt,
      executionScope,
      source: 'web-preview',
    })
  })
  return attachments
}

export function summarizeWebHeroRefinementTarget(target: WebHeroRefinementTarget): string {
  const kindLabel = target.selectionKind === 'pod'
    ? `Pods${target.memberCount ? ` · ${target.memberCount}` : ''}`
    : 'Picker'
  const label = compactText(target.label || target.elementId, LABEL_LIMIT)
  return [kindLabel, label].filter(Boolean).join(' · ')
}

function formatBounds(bounds: WebHeroRefinementBounds): string {
  return `x${bounds.x} y${bounds.y} ${bounds.width}x${bounds.height}`
}

export function summarizeWebHeroRefinementAttachmentsForPrompt(
  attachments: WebHeroRefinementAttachment[],
): WebHeroRefinementPromptAttachment[] {
  return attachments.slice(0, 8).map((attachment) => ({
    id: attachment.id,
    selectionKind: attachment.selectionKind,
    label: compactText(attachment.label, LABEL_LIMIT),
    selector: compactText(attachment.selector, SELECTOR_LIMIT),
    note: compactText(attachment.note, NOTE_LIMIT),
    position: formatBounds(attachment.position),
    currentText: compactText(attachment.text, TEXT_LIMIT),
    htmlHint: compactText(attachment.htmlHint, HTML_HINT_LIMIT),
    executionScope: attachment.executionScope,
    sourceLocation: attachment.sourceLocation,
    memberCount: attachment.selectionKind === 'pod' ? attachment.memberCount ?? attachment.podMembers?.length ?? 0 : undefined,
    podMembers: attachment.selectionKind === 'pod'
      ? (attachment.podMembers ?? []).slice(0, POD_MEMBER_LIMIT).map((member) => ({
          elementId: compactText(member.elementId, LABEL_LIMIT),
          label: compactText(member.label, LABEL_LIMIT),
          selector: compactText(member.selector, SELECTOR_LIMIT),
          sourceLocation: member.sourceLocation,
        }))
      : undefined,
  }))
}
