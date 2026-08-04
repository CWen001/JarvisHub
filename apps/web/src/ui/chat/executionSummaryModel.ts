import type {
  LiveChatRunRecord,
  LiveToolCallRecord,
  LiveToolCallStatus,
} from './liveChatRunStore'
import { getLiveToolCallEffectiveStatus } from './mediaToolStatus'

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

function productTaskStatusLabel(status: ExecutionTaskStatus): string {
  if (status === 'running') return '正在处理'
  if (status === 'failed' || status === 'blocked') return '需要处理'
  return '已完成'
}

function projectedTaskStatus(
  call: LiveToolCallRecord,
  childrenByParent: Map<string, LiveToolCallRecord[]>,
): ExecutionTaskStatus {
  const descendants: LiveToolCallRecord[] = []
  const visit = (parentId: string) => {
    for (const child of childrenByParent.get(parentId) ?? []) {
      descendants.push(child)
      visit(child.toolCallId)
    }
  }
  visit(call.toolCallId)
  const statuses = [call, ...descendants].map((item) => taskStatus(getLiveToolCallEffectiveStatus(item)))
  if (statuses.includes('failed')) return 'failed'
  if (statuses.includes('blocked')) return 'blocked'
  if (statuses.includes('running')) return 'running'
  return 'succeeded'
}

function truncate(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= 72 ? normalized : `${normalized.slice(0, 72).trimEnd()}...`
}

function productToolTitle(toolName: string): string {
  if (toolName === 'Skill') return '设计能力'
  if (toolName === 'ask_user') return '设计决策'
  if (toolName.includes('image_generate')) return '生成视觉成果'
  if (toolName.includes('video_generate')) return '生成动态成果'
  if (toolName === 'TodoWrite') return '整理任务进度'
  return '执行设计任务'
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
    .filter((call) => !call.parentToolCallId)
    .map((call): ExecutionSummaryTask => {
      const children = childrenByParent.get(call.toolCallId) ?? []
      const projectedStatus = projectedTaskStatus(call, childrenByParent)
      if (call.toolName !== 'Agent') {
        return {
          key: call.toolCallId,
          title: productToolTitle(call.toolName),
          subtitle: productTaskStatusLabel(projectedStatus),
          status: projectedStatus,
          childToolCount: children.length,
          completedChildToolCount: children.filter(
            (child) => getLiveToolCallEffectiveStatus(child) !== 'running',
          ).length,
        }
      }

      const backgroundTaskId = readBackgroundTaskId(call)
      const status = backgroundTaskId && run.status === 'running'
        ? 'running'
        : projectedStatus
      return {
        key: call.toolCallId,
        title: backgroundTaskId ? '后台设计任务' : '专业设计能力',
        subtitle: productTaskStatusLabel(status),
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
    errorMessage: phase === 'failed' ? '本轮设计执行未完成，请重试或调整设计要求。' : '',
    activeTaskLabel: active
      ? [active.title, active.subtitle ? truncate(active.subtitle) : ''].filter(Boolean).join(' · ')
      : '',
    tasks,
  }
}

export function resolvePersistedExecutionSummary(
  toolCallsByTurn: Readonly<Record<string, readonly LiveToolCallRecord[]>>,
): ExecutionSummary {
  const calls = Object.values(toolCallsByTurn).flat()
  const childrenByParent = new Map<string, LiveToolCallRecord[]>()
  for (const call of calls) {
    if (!call.parentToolCallId || call.parentToolCallId === call.toolCallId) continue
    const children = childrenByParent.get(call.parentToolCallId) ?? []
    children.push(call)
    childrenByParent.set(call.parentToolCallId, children)
  }
  const tasks = calls.filter((call) => !call.parentToolCallId).map((call): ExecutionSummaryTask => {
    const children = childrenByParent.get(call.toolCallId) ?? []
    const status = projectedTaskStatus(call, childrenByParent)
    return {
      key: call.toolCallId,
      title: productToolTitle(call.toolName),
      subtitle: productTaskStatusLabel(status),
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
  const phase = runningTaskCount > 0 ? 'running' : failedTaskCount > 0 ? 'failed' : 'succeeded'
  const starts = calls.map((call) => call.startedAtMs).filter((value) => Number.isFinite(value) && value > 0)
  const finishes = calls.map((call) => call.finishedAtMs).filter((value): value is number => Number.isFinite(value) && Number(value) > 0)
  const elapsedFromBounds = starts.length > 0 && finishes.length > 0
    ? Math.max(0, Math.max(...finishes) - Math.min(...starts))
    : 0
  const elapsedFromDurations = calls.reduce((total, call) => total + Math.max(0, call.durationMs ?? 0), 0)
  const elapsed = elapsedFromBounds || elapsedFromDurations
  return {
    phase,
    headline: runningTaskCount > 0
      ? `${runningTaskCount} 项设计任务执行中`
      : failedTaskCount > 0
        ? `${failedTaskCount} 项设计任务需要处理`
        : `已完成 ${tasks.length} 项设计任务`,
    taskCount: tasks.length,
    completedTaskCount,
    failedTaskCount,
    elapsedLabel: elapsed > 0 ? formatElapsed(elapsed) : '已记录',
    errorMessage: failedTaskCount > 0 ? '本轮设计执行未完成，请重试或调整设计要求。' : '',
    activeTaskLabel: runningTaskCount > 0
      ? tasks.find((task) => task.status === 'running')?.title ?? ''
      : '',
    tasks,
  }
}
