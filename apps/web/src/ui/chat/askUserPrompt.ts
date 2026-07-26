import type {
  AgentsChatToolStreamPayload,
  MemoryConversationAskUserPromptDto,
} from '../../api/server'

const ASK_USER_TOOL_NAME = 'ask_user'
const AWAITING_USER_REPLY_STATUS = 'awaiting_user_reply'

export type ChatAskUserUrgency = 'info' | 'confirmation' | 'blocker'

export type ChatAskUserPrompt = {
  toolCallId: string
  question: string
  options: string[]
  optionCards: ChatAskUserOptionCard[]
  urgency: ChatAskUserUrgency
  askedAt: string | null
  awaitingReply: boolean
}

export type ChatAskUserOptionCard = {
  value: string
  imageUrl: string
  thumbnailUrl?: string
  title?: string
  displayValue?: string
}

export type PendingAskUserState = {
  toolCallId: string
  question: string
  options: string[]
  optionCards: ChatAskUserOptionCard[]
  urgency: ChatAskUserUrgency
  askedAt: string | null
  awaitingReply: boolean
  sourceMessageId: string
  selectedOption: string | null
}

type PendingAskUserMessageLike = {
  id: string
  role: string
  askUserPrompt?: ChatAskUserPrompt | null
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const options: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const text = readTrimmedString(item)
    if (!text || seen.has(text)) continue
    seen.add(text)
    options.push(text)
    if (options.length >= 8) break
  }
  return options
}

export function formatAskUserQuestionForDisplay(
  question: string,
  options: string[],
): string {
  const normalizedQuestion = String(question || '').replace(/\r\n?/g, '\n').trim()
  const normalizedOptions = options
    .map((option) => String(option || '').trim())
    .filter(Boolean)
  if (!normalizedQuestion || normalizedOptions.length === 0) return normalizedQuestion

  const lines = normalizedQuestion.split('\n')
  let lastContentIndex = lines.length - 1
  while (lastContentIndex >= 0 && !lines[lastContentIndex].trim()) lastContentIndex -= 1

  const optionBlockStart = lastContentIndex - normalizedOptions.length + 1
  if (optionBlockStart < 0) return normalizedQuestion

  const hasExactTrailingOptionBlock = normalizedOptions.every((option, index) => {
    const line = lines[optionBlockStart + index]?.trim() ?? ''
    const match = line.match(/^(\d+)[.)、]\s*(.+)$/)
    return Boolean(
      match &&
      Number(match[1]) === index + 1 &&
      match[2].trim() === option,
    )
  })
  if (!hasExactTrailingOptionBlock) return normalizedQuestion

  let prefixEnd = optionBlockStart
  while (prefixEnd > 0 && !lines[prefixEnd - 1].trim()) prefixEnd -= 1

  if (prefixEnd > 0) {
    const promptLineIndex = prefixEnd - 1
    const promptLabel = lines[prefixEnd - 1]
      .replace(/[*_`~]/g, '')
      .trim()
    const hasEarlierQuestionContext = lines
      .slice(0, promptLineIndex)
      .some((line) => Boolean(line.trim()))
    if (
      hasEarlierQuestionContext &&
      promptLabel.length <= 40 &&
      /[:：]$/.test(promptLabel)
    ) {
      prefixEnd -= 1
      while (prefixEnd > 0 && !lines[prefixEnd - 1].trim()) prefixEnd -= 1
    }
  }

  return lines.slice(0, prefixEnd).join('\n').trim()
}

function readOptionCards(value: unknown): ChatAskUserOptionCard[] {
  if (!Array.isArray(value)) return []
  const cards: ChatAskUserOptionCard[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const record = normalizeRecord(item)
    if (!record) continue
    const valueText = readTrimmedString(record.value)
    const imageUrl = readTrimmedString(record.imageUrl)
    if (!valueText || !imageUrl || seen.has(valueText)) continue
    seen.add(valueText)
    const thumbnailUrl = readTrimmedString(record.thumbnailUrl)
    const title = readTrimmedString(record.title)
    const displayValue = readTrimmedString(record.displayValue)
    cards.push({
      value: valueText,
      imageUrl,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(title ? { title } : {}),
      ...(displayValue ? { displayValue } : {}),
    })
    if (cards.length >= 8) break
  }
  return cards
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  const trimmed = readTrimmedString(text)
  if (!trimmed || !trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return normalizeRecord(parsed)
  } catch {
    return null
  }
}

function parseAskUserRecord(
  value: unknown,
  toolCallId: string,
  options?: {
    requireAwaitingStatus?: boolean
  },
): ChatAskUserPrompt | null {
  const record = normalizeRecord(value)
  if (!record) return null
  const status = readTrimmedString(record.status)
  if (options?.requireAwaitingStatus !== false && status !== AWAITING_USER_REPLY_STATUS) {
    return null
  }
  const question = readTrimmedString(record.question)
  if (!question) return null
  const urgencyRaw = readTrimmedString(record.urgency)
  const urgency: ChatAskUserUrgency =
    urgencyRaw === 'info' || urgencyRaw === 'confirmation' || urgencyRaw === 'blocker'
      ? urgencyRaw
      : 'confirmation'
  return {
    toolCallId,
    question,
    options: readOptions(record.options),
    optionCards: readOptionCards(record.optionCards),
    urgency,
    askedAt: readTrimmedString(record.askedAt) || null,
    awaitingReply: record.awaitingReply !== false,
  }
}

export function parseAskUserPromptFromToolEvent(
  payload: Pick<AgentsChatToolStreamPayload, 'toolCallId' | 'toolName' | 'phase' | 'status' | 'outputJson' | 'outputPreview'>,
): ChatAskUserPrompt | null {
  if (readTrimmedString(payload.toolName) !== ASK_USER_TOOL_NAME) return null
  if (payload.phase !== 'completed') return null
  if (payload.status && payload.status !== 'succeeded') return null
  const toolCallId = readTrimmedString(payload.toolCallId)
  return (
    parseAskUserRecord(payload.outputJson, toolCallId, { requireAwaitingStatus: true }) ??
    parseAskUserRecord(parseJsonRecord(readTrimmedString(payload.outputPreview)), toolCallId, { requireAwaitingStatus: true })
  )
}

export function parseAskUserPromptFromHistory(
  prompt: MemoryConversationAskUserPromptDto | null | undefined,
): ChatAskUserPrompt | null {
  const record = normalizeRecord(prompt)
  const toolCallId = readTrimmedString(record?.toolCallId)
  if (!toolCallId) return null
  return parseAskUserRecord(record, toolCallId, { requireAwaitingStatus: false })
}

export function createPendingAskUserState(input: {
  prompt: ChatAskUserPrompt
  sourceMessageId: string
}): PendingAskUserState {
  return {
    toolCallId: input.prompt.toolCallId,
    question: input.prompt.question,
    options: [...input.prompt.options],
    optionCards: Array.isArray(input.prompt.optionCards) ? [...input.prompt.optionCards] : [],
    urgency: input.prompt.urgency,
    askedAt: input.prompt.askedAt,
    awaitingReply: input.prompt.awaitingReply,
    sourceMessageId: input.sourceMessageId,
    selectedOption: null,
  }
}

export function recoverPendingAskUserStateFromMessages(
  messages: PendingAskUserMessageLike[],
): PendingAskUserState | null {
  if (!messages.length) return null
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role === 'user') return null
    if (message.role !== 'assistant') continue
    const prompt = message.askUserPrompt ?? null
    if (!prompt) continue
    if (prompt.awaitingReply !== true) continue
    return createPendingAskUserState({
      prompt,
      sourceMessageId: message.id,
    })
  }
  return null
}

export function getAskUserUrgencyBadgeColor(
  urgency: ChatAskUserPrompt['urgency'],
): 'blue' | 'yellow' | 'red' {
  if (urgency === 'blocker') return 'red'
  if (urgency === 'info') return 'blue'
  return 'yellow'
}

export function getAskUserUrgencyLabel(urgency: ChatAskUserPrompt['urgency']): string {
  if (urgency === 'blocker') return '等待你的决定'
  if (urgency === 'info') return '等待确认'
  return '需要确认'
}
