import type { AgentsChatMediaResultStreamPayload } from '../../api/server'

export type MediaCompletionContinuationRequest = {
  key: string
  tabId: string
  prompt: string
  displayText: string
}

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isTerminalMediaResult(value: AgentsChatMediaResultStreamPayload): boolean {
  return value.pending !== true && (value.status === 'succeeded' || value.status === 'failed')
}

function mediaResultIdentity(value: AgentsChatMediaResultStreamPayload): string {
  return [
    trim(value.toolCallId),
    trim(value.taskId),
    trim(value.nodeId),
    value.status,
  ].filter(Boolean).join(':')
}

function formatMediaResultLine(value: AgentsChatMediaResultStreamPayload): string {
  const parts = [
    `kind=${value.kind}`,
    `nodeId=${trim(value.nodeId) || '<unknown>'}`,
    `taskId=${trim(value.taskId) || '<unknown>'}`,
    `status=${value.status}`,
  ]
  const url = trim(value.url)
  const errorMessage = trim(value.errorMessage)
  if (url) parts.push(`url=${url}`)
  if (errorMessage) parts.push(`error=${errorMessage}`)
  return `- ${parts.join(' ')}`
}

export function buildMediaCompletionContinuationRequest(input: {
  tabId: string
  runId: string
  sessionKey: string
  results: AgentsChatMediaResultStreamPayload[]
}): MediaCompletionContinuationRequest | null {
  const tabId = trim(input.tabId)
  const runId = trim(input.runId)
  const sessionKey = trim(input.sessionKey)
  const terminalResults = input.results.filter(isTerminalMediaResult)
  if (!tabId || !sessionKey || terminalResults.length === 0) return null

  const identities = terminalResults.map(mediaResultIdentity).filter(Boolean).sort()
  if (identities.length === 0) return null
  const failedCount = terminalResults.filter((item) => item.status === 'failed').length
  const displayText = failedCount > 0
    ? '后台媒体任务失败，继续处理'
    : '后台媒体已完成，继续主任务'
  const prompt = [
    '后台媒体生成任务已有终态，请继续完成上一轮未完成的主任务。',
    '请先调用 canvas_flow_get 读取最新画布，并用 task_board_read 对账后台任务状态；不要重新生成已有真实 URL 的媒体节点。',
    '如果有失败项，更新主任务 Todo 并明确失败/重试决策；如果全部成功，继续推进下一步。',
    '',
    '<media_results>',
    ...terminalResults.map(formatMediaResultLine),
    '</media_results>',
  ].join('\n')

  return {
    key: [sessionKey, runId, ...identities].filter(Boolean).join('|'),
    tabId,
    prompt,
    displayText,
  }
}
