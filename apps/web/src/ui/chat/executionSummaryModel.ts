import type {
  LiveChatRunRecord,
  LiveToolCallRecord,
  LiveToolCallStatus,
} from './liveChatRunStore'
import { resolveToolExecutionStatus } from './agentProgressModel'
import { getLiveToolCallEffectiveStatus } from './mediaToolStatus'
import { parseAgentInput } from './toolCallReaders'

export type ExecutionTaskStatus = 'running' | 'succeeded' | 'failed' | 'blocked'

export type ExecutionSummaryTask = Readonly<{
  key: string
  title: string
  subtitle: string
  status: ExecutionTaskStatus
  childToolCount: number
  completedChildToolCount: number
}>

export type ExecutionSummary = Readonly<{
  phase: 'running' | 'succeeded' | 'failed'
  headline: string
  taskCount: number
  completedTaskCount: number
  failedTaskCount: number
  elapsedLabel: string
  errorMessage: string
  activeTaskLabel: string
  tasks: readonly ExecutionSummaryTask[]
}>

function flattenToolCalls(run: LiveChatRunRecord): LiveToolCallRecord[] {
  const calls: LiveToolCallRecord[] = []
  for (const turnId of run.turnOrder) {
    const bucket = run.toolCallsByTurn[turnId]
    if (bucket) calls.push(...bucket)
  }
  for (const [turnId, bucket] of Object.entries(run.toolCallsByTurn)) {
    if (!run.turnOrder.includes(turnId)) calls.push(...bucket)
  }
  return calls.sort((left, right) => left.startedAtMs - right.startedAtMs)
}

function readBackgroundTaskId(call: LiveToolCallRecord): string {
  const text = `${String(call.outputPreview || '')}\n${String(call.errorMessage || '')}`
  return text.match(/\bid=(sub_bg_[a-z0-9_-]+)\b/i)?.[1] ?? ''
}

function taskStatus(status: LiveToolCallStatus): ExecutionTaskStatus {
  if (status === 'failed') return 'failed'
  if (status === 'blocked' || status === 'denied') return 'blocked'
  if (status === 'succeeded') return 'succeeded'
  return 'running'
}

function truncate(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= 72 ? normalized : `${normalized.slice(0, 72).trimEnd()}...`
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes > 0 ? `${minutes}分${String(remainder).padStart(2, '0')}秒` : `${seconds}秒`
}

export function resolveExecutionSummary(run: LiveChatRunRecord, now = Date.now()): ExecutionSummary {
  const calls = flattenToolCalls(run)
  const childrenByParent = new Map<string, LiveToolCallRecord[]>()
  for (const call of calls) {
    if (!call.parentToolCallId || call.parentToolCallId === call.toolCallId) continue
    const children = childrenByParent.get(call.parentToolCallId) ?? []
    children.push(call)
    childrenByParent.set(call.parentToolCallId, children)
  }

  const tasks = calls
    .filter((call) => call.toolName === 'Agent' && !call.parentToolCallId)
    .map((call): ExecutionSummaryTask => {
      const parsed = parseAgentInput(call.input)
      const children = childrenByParent.get(call.toolCallId) ?? []
      const backgroundTaskId = readBackgroundTaskId(call)
      const resolved = resolveToolExecutionStatus(call, childrenByParent)
      const status = backgroundTaskId && run.status === 'running'
        ? 'running'
        : taskStatus(resolved.runStatus)
      return {
        key: call.toolCallId,
        title: parsed.subagentType
          ? `${parsed.subagentType} agent`
          : backgroundTaskId
            ? 'background agent'
            : 'sub-agent',
        subtitle: parsed.description || parsed.promptPreview || backgroundTaskId || '处理中',
        status,
        childToolCount: children.length,
        completedChildToolCount: children.filter(
          (child) => getLiveToolCallEffectiveStatus(child) !== 'running',
        ).length,
      }
    })

  const completedTaskCount = tasks.filter((task) => task.status !== 'running').length
  const failedTaskCount = tasks.filter((task) => task.status === 'failed' || task.status === 'blocked').length
  const runningTaskCount = tasks.length - completedTaskCount
  const phase = run.status === 'running'
    ? 'running'
    : run.status === 'failed' || failedTaskCount > 0
      ? 'failed'
      : 'succeeded'
  const active = tasks.find((task) => task.status === 'running') ?? tasks[tasks.length - 1]
  const endedAt = run.finishedAt ?? (run.status === 'running' ? now : run.updatedAt)

  return {
    phase,
    headline: runningTaskCount > 0
      ? `${runningTaskCount} 个子任务执行中`
      : failedTaskCount > 0
        ? `${failedTaskCount} 个子任务需要处理`
        : '子任务已完成',
    taskCount: tasks.length,
    completedTaskCount,
    failedTaskCount,
    elapsedLabel: formatElapsed(endedAt - run.startedAt),
    errorMessage: run.errorMessage,
    activeTaskLabel: active
      ? [active.title, active.subtitle ? truncate(active.subtitle) : ''].filter(Boolean).join(' · ')
      : '',
    tasks,
  }
}
