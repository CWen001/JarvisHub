import { useEffect, useMemo, useState } from 'react'
import { ActionIcon, Collapse, Group, Progress, Text, Tooltip, UnstyledButton } from '@mantine/core'
import { IconCheck, IconChevronDown, IconChevronUp, IconClock, IconLayoutBoard, IconProgress } from '@tabler/icons-react'
import type { LiveChatRunRecord } from '../ui/chat/liveChatRunStore'
import { resolveExecutionSummary } from '../ui/chat/executionSummaryModel'
import { dispatchProductWorkspaceCommand } from './productWorkspace'

function readableTaskTitle(title: string): string {
  if (title.includes('background')) return '后台设计任务'
  if (title.includes('agent')) return '专业设计能力'
  return title || '设计任务'
}

export function ExecutionSummary({ run }: { run: LiveChatRunRecord | null }): JSX.Element | null {
  const [now, setNow] = useState(() => Date.now())
  const [expanded, setExpanded] = useState(false)
  const summary = useMemo(() => run ? resolveExecutionSummary(run, now) : null, [now, run])

  useEffect(() => setExpanded(false), [run?.runId])
  useEffect(() => {
    if (summary?.phase !== 'running') return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [summary?.phase])

  if (!summary || summary.taskCount === 0) return null
  const failed = summary.phase === 'failed'
  const progress = Math.round((summary.completedTaskCount / summary.taskCount) * 100)

  return (
    <section className="compact-execution" data-phase={summary.phase}>
      <div className="compact-execution__row">
        <UnstyledButton
          className="compact-execution__toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={expanded ? '折叠执行摘要' : '展开执行摘要'}
        >
          <span className="compact-execution__status" aria-hidden="true">
            {summary.phase === 'running' ? <IconProgress size={16} /> : failed ? <IconClock size={16} /> : <IconCheck size={16} />}
          </span>
          <strong>{summary.headline}</strong>
          <span>{summary.completedTaskCount}/{summary.taskCount}</span>
          <span>{summary.elapsedLabel}</span>
          {expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
        </UnstyledButton>
        <Tooltip label="在专业工作台查看完整运行详情">
          <ActionIcon
            variant="subtle"
            size={40}
            aria-label="在专业工作台查看完整运行详情"
            onClick={() => dispatchProductWorkspaceCommand({ type: 'open-canvas' })}
          >
            <IconLayoutBoard size={18} />
          </ActionIcon>
        </Tooltip>
      </div>
      <Collapse in={expanded}>
        <div className="compact-execution__summary">
          <Progress value={progress} size={4} color={failed ? 'red' : 'dark'} />
          {summary.activeTaskLabel ? <Text size="sm">{summary.activeTaskLabel}</Text> : null}
          {summary.errorMessage ? <Text size="sm" c="red">{summary.errorMessage}</Text> : null}
          <ul>
            {summary.tasks.map((task) => (
              <li key={task.key}>
                <span>{readableTaskTitle(task.title)}</span>
                <small>{task.subtitle}</small>
              </li>
            ))}
          </ul>
        </div>
      </Collapse>
    </section>
  )
}
