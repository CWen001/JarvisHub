import type {
  LiveToolCallRecord,
  LiveToolCallStatus,
  LiveToolCallMediaRecord,
  LiveMediaResultStatus,
} from './liveChatRunStore'

export function formatUnknownForDisplay(value: unknown): string {
  if (value === null || typeof value === 'undefined') return ''
  if (typeof value === 'string') return value.trim()
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function formatInputForDisplay(input: unknown): string {
  if (input === null || typeof input === 'undefined') return ''
  return formatUnknownForDisplay(input)
}

export function toolStatusColor(status: LiveToolCallStatus | string | null | undefined): string {
  switch (status) {
    case 'succeeded':
      return 'teal'
    case 'failed':
      return 'red'
    case 'denied':
    case 'blocked':
      return 'orange'
    case 'running':
      return 'blue'
    default:
      return 'gray'
  }
}

export function formatDurationMsForDisplay(durationMs: number | null | undefined): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return ''
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  const seconds = durationMs / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds - minutes * 60)
  return `${minutes}m${remainingSeconds}s`
}

export function countToolCalls(
  record: { toolCallsByTurn: Record<string, LiveToolCallRecord[]> },
  turnIds: string[],
): number {
  let total = 0
  for (const turnId of turnIds) {
    total += record.toolCallsByTurn[turnId]?.length ?? 0
  }
  return total
}

export function collectToolCalls(
  record: { toolCallsByTurn: Record<string, LiveToolCallRecord[]> },
  turnIds: string[],
): LiveToolCallRecord[] {
  const out: LiveToolCallRecord[] = []
  for (const turnId of turnIds) {
    const bucket = record.toolCallsByTurn[turnId]
    if (bucket) out.push(...bucket)
  }
  return out
}

export function hasRunningToolCall(calls: LiveToolCallRecord[]): boolean {
  return calls.some((call) => call.status === 'running')
}

export type ParsedAgentInput = {
  subagentType: string | null
  description: string | null
  promptPreview: string | null
}

const AGENT_PROMPT_PREVIEW_LIMIT = 80

function pickTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function parseAgentInput(input: unknown): ParsedAgentInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { subagentType: null, description: null, promptPreview: null }
  }
  const record = input as Record<string, unknown>
  const subagentType = pickTrimmedString(record.subagent_type)
  const description = pickTrimmedString(record.description)
  const prompt = pickTrimmedString(record.prompt)
  const promptPreview = prompt
    ? prompt.length > AGENT_PROMPT_PREVIEW_LIMIT
      ? `${prompt.slice(0, AGENT_PROMPT_PREVIEW_LIMIT).trimEnd()}…`
      : prompt
    : null
  return { subagentType, description, promptPreview }
}

export function getAgentRowDisplay(
  toolName: string,
  input: unknown,
  toolCount?: number,
): {
  isAgent: boolean
  title: string
  subtitle: string | null
  parsed: ParsedAgentInput | null
} {
  const isAgent = toolName === 'Agent'
  if (!isAgent) {
    return { isAgent: false, title: toolName, subtitle: null, parsed: null }
  }
  const parsed = parseAgentInput(input)
  const segments: string[] = ['Subagent']
  if (parsed.subagentType) segments.push(parsed.subagentType)
  if (typeof toolCount === 'number' && Number.isFinite(toolCount) && toolCount > 0) {
    segments.push(`${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}`)
  }
  const title = segments.join(' · ')
  const subtitle = parsed.description ?? parsed.promptPreview
  return { isAgent: true, title, subtitle, parsed }
}

export function mediaStatusColor(status: LiveMediaResultStatus): string {
  switch (status) {
    case 'succeeded':
      return 'teal'
    case 'failed':
      return 'red'
    case 'running':
      return 'blue'
    case 'queued':
    default:
      return 'gray'
  }
}

export function mediaStatusLabel(media: LiveToolCallMediaRecord): string {
  switch (media.status) {
    case 'succeeded':
      return '已完成'
    case 'failed':
      return '失败'
    case 'running':
      return typeof media.progress === 'number' ? `生成中 ${media.progress}%` : '生成中'
    case 'queued':
    default:
      return '排队中'
  }
}
