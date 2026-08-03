import { useEffect, useMemo, useState } from 'react'
import { Badge, Drawer, Group, Progress, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core'
import { IconCheck, IconClock, IconPlayerPlay, IconProgress, IconX } from '@tabler/icons-react'
import type { LiveChatRunRecord } from '../ui/chat/liveChatRunStore'
import {
  resolveExecutionSummary,
  type ExecutionTaskStatus,
} from '../ui/chat/executionSummaryModel'

function statusLabel(status: ExecutionTaskStatus): string {
  if (status === 'succeeded') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'blocked') return '受阻'
  return '执行中'
}

function statusColor(status: ExecutionTaskStatus): string {
  if (status === 'succeeded') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'blocked') return 'orange'
  return 'blue'
}

export function ExecutionSummary({ run }: { run: LiveChatRunRecord | null }): JSX.Element | null {
  const [now, setNow] = useState(() => Date.now())
  const [traceOpened, setTraceOpened] = useState(false)
  const summary = useMemo(() => run ? resolveExecutionSummary(run, now) : null, [now, run])

  useEffect(() => {
    setTraceOpened(false)
  }, [run?.runId])

  useEffect(() => {
    if (summary?.phase !== 'running') return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [summary?.phase])

  if (!summary || summary.taskCount === 0) return null
  const failed = summary.phase === 'failed'
  const progress = Math.round((summary.completedTaskCount / summary.taskCount) * 100)

  return (
    <>
      <UnstyledButton
        className="product-execution-summary"
        data-phase={summary.phase}
        onClick={() => setTraceOpened(true)}
        aria-label="Open execution trace"
      >
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Group wrap="nowrap" gap={8} className="product-execution-summary__main">
            <ThemeIcon variant="light" color={failed ? 'orange' : summary.phase === 'running' ? 'blue' : 'green'} size={24} radius="md">
              {summary.phase === 'running' ? <IconProgress size={14} /> : failed ? <IconClock size={14} /> : <IconCheck size={14} />}
            </ThemeIcon>
            <Text size="sm" fw={650} lineClamp={1}>{summary.headline}</Text>
          </Group>
          <Text className="product-execution-summary__meta" size="xs" c="dimmed">
            {summary.taskCount} 个任务 · {summary.elapsedLabel}
          </Text>
        </Group>
      </UnstyledButton>

      <Drawer
        className="product-execution-trace-drawer"
        opened={traceOpened}
        onClose={() => setTraceOpened(false)}
        position="right"
        size={420}
        title="Execution trace"
      >
        <Stack gap="md">
          <div>
            <Text fw={700}>{summary.headline}</Text>
            <Text size="xs" c="dimmed">
              {summary.completedTaskCount}/{summary.taskCount} completed · {summary.elapsedLabel}
            </Text>
            {summary.errorMessage ? <Text size="sm" c="red" mt="xs">{summary.errorMessage}</Text> : null}
          </div>
          <Progress value={progress} size={5} radius="xl" color={failed ? 'orange' : 'blue'} />
          <Stack gap={6}>
            {summary.tasks.map((task) => (
              <Group key={task.key} className="product-execution-trace__task" justify="space-between" wrap="nowrap" gap="sm">
                <Group wrap="nowrap" gap={8} className="product-execution-trace__task-main">
                  <ThemeIcon variant="light" color={statusColor(task.status)} size={22} radius="xl">
                    {task.status === 'running'
                      ? <IconPlayerPlay size={12} />
                      : task.status === 'succeeded'
                        ? <IconCheck size={12} />
                        : <IconX size={12} />}
                  </ThemeIcon>
                  <div className="product-execution-trace__task-copy">
                    <Text size="sm" fw={650} lineClamp={1}>{task.title}</Text>
                    <Text size="xs" c="dimmed" lineClamp={2}>{task.subtitle}</Text>
                  </div>
                </Group>
                <Badge size="xs" variant="light" color={statusColor(task.status)}>{statusLabel(task.status)}</Badge>
              </Group>
            ))}
          </Stack>
        </Stack>
      </Drawer>
    </>
  )
}
