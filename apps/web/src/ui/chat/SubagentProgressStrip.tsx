import { useEffect, useMemo, useState } from 'react'
import { ActionIcon, Badge, Group, Loader, Progress, Stack, Text, ThemeIcon, Tooltip } from '@mantine/core'
import {
  IconChevronDown,
  IconChevronRight,
  IconCheck,
  IconClock,
  IconPlayerPlay,
  IconProgress,
  IconRobot,
  IconX,
} from '@tabler/icons-react'

import type {
  LiveChatRunRecord,
  LiveToolCallRecord,
  LiveToolCallStatus,
} from './liveChatRunStore'
import { resolveToolExecutionStatus } from './agentProgressModel'
import { getLiveToolCallEffectiveStatus } from './mediaToolStatus'
import { parseAgentInput, toolStatusColor } from './toolCallReaders'

type SubagentStatus = 'running' | 'succeeded' | 'failed' | 'blocked'

type SubagentProgressItem = {
  key: string
  title: string
  subtitle: string
  status: SubagentStatus
  childToolCount: number
  completedChildToolCount: number
  backgroundTaskId: string
  startedAtMs: number
}

type SubagentProgressStripProps = {
  run: LiveChatRunRecord | null
}

function flattenToolCalls(run: LiveChatRunRecord): LiveToolCallRecord[] {
  const calls: LiveToolCallRecord[] = []
  for (const turnId of run.turnOrder) {
    const bucket = run.toolCallsByTurn[turnId]
    if (bucket) calls.push(...bucket)
  }
  for (const [turnId, bucket] of Object.entries(run.toolCallsByTurn)) {
    if (run.turnOrder.includes(turnId)) continue
    calls.push(...bucket)
  }
  return calls.sort((left, right) => left.startedAtMs - right.startedAtMs)
}

function readBackgroundTaskId(call: LiveToolCallRecord): string {
  const text = `${String(call.outputPreview || '')}\n${String(call.errorMessage || '')}`
  const match = text.match(/\bid=(sub_bg_[a-z0-9_-]+)\b/i)
  return match?.[1] ?? ''
}

function mapToolStatusToSubagentStatus(status: LiveToolCallStatus): SubagentStatus {
  if (status === 'failed') return 'failed'
  if (status === 'blocked' || status === 'denied') return 'blocked'
  if (status === 'succeeded') return 'succeeded'
  return 'running'
}

function buildSubagentItems(run: LiveChatRunRecord): SubagentProgressItem[] {
  const calls = flattenToolCalls(run)
  const childrenByParent = new Map<string, LiveToolCallRecord[]>()
  for (const call of calls) {
    const parentId = call.parentToolCallId
    if (!parentId || parentId === call.toolCallId) continue
    const bucket = childrenByParent.get(parentId) ?? []
    bucket.push(call)
    childrenByParent.set(parentId, bucket)
  }

  return calls
    .filter((call) => call.toolName === 'Agent' && !call.parentToolCallId)
    .map((call) => {
      const parsed = parseAgentInput(call.input)
      const childCalls = childrenByParent.get(call.toolCallId) ?? []
      const completedChildToolCount = childCalls.filter(
        (child) => getLiveToolCallEffectiveStatus(child) !== 'running',
      ).length
      const backgroundTaskId = readBackgroundTaskId(call)
      const executionStatus = resolveToolExecutionStatus(call, childrenByParent)
      const status = backgroundTaskId && run.status === 'running'
        ? 'running'
        : mapToolStatusToSubagentStatus(executionStatus.runStatus)
      const title = parsed.subagentType
        ? `${parsed.subagentType} agent`
        : backgroundTaskId
          ? 'background agent'
          : 'sub-agent'
      const subtitle = parsed.description || parsed.promptPreview || backgroundTaskId || '处理中'
      return {
        key: call.toolCallId,
        title,
        subtitle,
        status,
        childToolCount: childCalls.length,
        completedChildToolCount,
        backgroundTaskId,
        startedAtMs: call.startedAtMs,
      }
    })
}

function statusLabel(status: SubagentStatus): string {
  switch (status) {
    case 'succeeded':
      return '已完成'
    case 'failed':
      return '失败'
    case 'blocked':
      return '受阻'
    case 'running':
    default:
      return '执行中'
  }
}

function statusColor(status: SubagentStatus): string {
  if (status === 'blocked') return 'orange'
  return toolStatusColor(status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : 'running')
}

function statusIcon(status: SubagentStatus) {
  switch (status) {
    case 'succeeded':
      return <IconCheck size={13} />
    case 'failed':
      return <IconX size={13} />
    case 'blocked':
      return <IconClock size={13} />
    case 'running':
    default:
      return <IconPlayerPlay size={13} />
  }
}

function truncateSubtitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 72) return normalized
  return `${normalized.slice(0, 72).trimEnd()}...`
}

function currentTaskLabel(items: SubagentProgressItem[]): string {
  const running = items.find((item) => item.status === 'running')
  const fallback = items[items.length - 1]
  const item = running ?? fallback
  if (!item) return ''
  return [item.title, item.subtitle ? truncateSubtitle(item.subtitle) : '']
    .filter(Boolean)
    .join(' · ')
}

export function SubagentProgressStrip({ run }: SubagentProgressStripProps) {
  const items = useMemo(() => (run ? buildSubagentItems(run) : []), [run])
  const [expanded, setExpanded] = useState(() => items.some((item) => item.status === 'running'))
  const [userToggled, setUserToggled] = useState(false)
  const runId = run?.runId ?? ''

  useEffect(() => {
    setUserToggled(false)
    setExpanded(items.some((item) => item.status === 'running'))
  }, [runId])

  useEffect(() => {
    if (!userToggled && items.some((item) => item.status === 'running')) {
      setExpanded(true)
    }
  }, [items, userToggled])

  if (!run || items.length === 0) return null

  const finishedCount = items.filter((item) => item.status !== 'running').length
  const failedCount = items.filter((item) => item.status === 'failed' || item.status === 'blocked').length
  const runningCount = items.length - finishedCount
  const progressValue = items.length > 0 ? Math.round((finishedCount / items.length) * 100) : 0
  const headline = runningCount > 0
    ? `${runningCount} 个子任务执行中`
    : failedCount > 0
      ? `${failedCount} 个子任务需要处理`
      : '子任务已完成'
  const activeTask = currentTaskLabel(items)

  const toggleExpanded = () => {
    setUserToggled(true)
    setExpanded((value) => !value)
  }

  return (
    <Stack className="tc-subagent-progress" gap={expanded ? 8 : 0} data-expanded={expanded ? 'true' : 'false'}>
      <Group className="tc-subagent-progress__header" justify="space-between" wrap="nowrap" gap={10}>
        <Group gap={8} wrap="nowrap" className="tc-subagent-progress__title-group">
          <Tooltip label={expanded ? '折叠子任务' : '展开子任务'} withArrow>
            <ActionIcon
              aria-label={expanded ? '折叠子任务' : '展开子任务'}
              className="tc-subagent-progress__toggle"
              variant="subtle"
              color="gray"
              size={24}
              radius="md"
              onClick={toggleExpanded}
            >
              {expanded ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
            </ActionIcon>
          </Tooltip>
          <ThemeIcon className="tc-subagent-progress__icon" variant="light" color={failedCount > 0 ? 'orange' : 'blue'} size={24} radius="md">
            {runningCount > 0 ? <IconProgress size={14} /> : <IconRobot size={14} />}
          </ThemeIcon>
          <Stack gap={0} className="tc-subagent-progress__headline">
            <Text size="sm" fw={650} className="tc-subagent-progress__title">
              {headline}
            </Text>
            <Text size="xs" c="dimmed" className="tc-subagent-progress__summary">
              {expanded ? `${finishedCount}/${items.length} completed` : activeTask}
            </Text>
          </Stack>
        </Group>
        {runningCount > 0 ? <Loader size="xs" className="tc-subagent-progress__loader" /> : null}
      </Group>
      {expanded ? (
        <>
          <Progress
            value={progressValue}
            size={5}
            radius="xl"
            color={failedCount > 0 ? 'orange' : 'blue'}
            className="tc-subagent-progress__bar"
          />
          <div className="tc-subagent-progress__items">
            {items.map((item) => (
              <div key={item.key} className="tc-subagent-progress__item" data-status={item.status}>
                <Group gap={7} wrap="nowrap" className="tc-subagent-progress__item-main">
                  <ThemeIcon
                    className="tc-subagent-progress__status-icon"
                    size={20}
                    radius="xl"
                    variant="light"
                    color={statusColor(item.status)}
                  >
                    {statusIcon(item.status)}
                  </ThemeIcon>
                  <Stack gap={0} className="tc-subagent-progress__item-text">
                    <Text size="xs" fw={650} className="tc-subagent-progress__item-title">
                      {item.title}
                    </Text>
                    <Text size="xs" c="dimmed" className="tc-subagent-progress__item-subtitle">
                      {truncateSubtitle(item.subtitle)}
                    </Text>
                  </Stack>
                </Group>
                <Badge
                  className="tc-subagent-progress__badge"
                  size="xs"
                  radius="sm"
                  variant="light"
                  color={statusColor(item.status)}
                >
                  {statusLabel(item.status)}
                </Badge>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Stack>
  )
}
