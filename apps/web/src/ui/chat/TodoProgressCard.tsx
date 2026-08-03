import { useEffect, useState } from 'react'
import { Collapse, Group, Loader, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core'
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconListCheck,
} from '@tabler/icons-react'

import {
  countCompletedTodoItems,
  findBlockedTodoItem,
  findInProgressTodoItem,
  findWaitingTodoItem,
  type ChatTodoItem,
} from './chatTodoTypes'

export type TodoProgressCardProps = {
  items: ChatTodoItem[]
  active?: boolean
  compact?: boolean
  defaultOpen?: boolean
  title?: string
}

function TodoStatusMark({ status }: { status: ChatTodoItem['status'] }) {
  if (status === 'completed') {
    return (
      <ThemeIcon
        className="tc-todo-progress__mark tc-todo-progress__mark--completed"
        size="xs"
        radius="sm"
        color="green"
        variant="filled"
      >
        <IconCheck size={10} stroke={3} />
      </ThemeIcon>
    )
  }
  if (status === 'in_progress') {
    return (
      <ThemeIcon
        className="tc-todo-progress__mark tc-todo-progress__mark--in_progress"
        size="xs"
        radius="xl"
        color="blue"
        variant="light"
      >
        <span
          className="tc-todo-progress__mark-dot"
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'currentColor',
            display: 'block',
          }}
        />
      </ThemeIcon>
    )
  }
  if (status === 'waiting') {
    return (
      <ThemeIcon
        className="tc-todo-progress__mark tc-todo-progress__mark--waiting"
        size="xs"
        radius="xl"
        color="cyan"
        variant="light"
      >
        <span className="tc-todo-progress__mark-symbol" aria-hidden="true">
          ~
        </span>
      </ThemeIcon>
    )
  }
  if (status === 'blocked') {
    return (
      <ThemeIcon
        className="tc-todo-progress__mark tc-todo-progress__mark--blocked"
        size="xs"
        radius="sm"
        color="red"
        variant="light"
      >
        <span className="tc-todo-progress__mark-symbol" aria-hidden="true">
          !
        </span>
      </ThemeIcon>
    )
  }
  return (
    <span
      className="tc-todo-progress__mark tc-todo-progress__mark--pending"
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        borderRadius: 3,
        border: '1px solid var(--mantine-color-dark-4)',
        flexShrink: 0,
        marginTop: 2,
      }}
    />
  )
}

export function TodoProgressCard({
  items,
  active = true,
  compact = false,
  defaultOpen,
  title = 'Progress',
}: TodoProgressCardProps) {
  const total = items.length
  const completed = countCompletedTodoItems(items)
  const hasInProgress = findInProgressTodoItem(items) != null
  const hasWaiting = findWaitingTodoItem(items) != null
  const hasBlocked = findBlockedTodoItem(items) != null
  const showRunningLoader = active && (hasInProgress || hasWaiting)

  const [open, setOpen] = useState<boolean>(() =>
    typeof defaultOpen === 'boolean' ? defaultOpen : hasInProgress || hasWaiting || hasBlocked,
  )

  useEffect(() => {
    if (compact && !active) setOpen(false)
  }, [active, compact])

  if (total === 0) return null

  return (
    <div
      className="tc-todo-progress"
      data-compact={compact ? 'true' : 'false'}
      style={{
        border: '1px solid var(--mantine-color-dark-5)',
        borderRadius: 8,
        padding: 10,
      }}
    >
      <UnstyledButton
        className="tc-todo-progress__header"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={`${open ? '折叠' : '展开'}${title}`}
        style={{ width: '100%' }}
      >
        <Group gap={8} wrap="nowrap" align="center">
          <ThemeIcon
            className="tc-todo-progress__header-icon"
            size="sm"
            radius="sm"
            variant="light"
            color="gray"
          >
            <IconListCheck size={14} />
          </ThemeIcon>
          {compact ? (
            <span className="tc-todo-progress__toggle" aria-hidden="true">
              {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            </span>
          ) : null}
          <Text className="tc-todo-progress__label" size="sm" fw={600}>
            {`${title} ${completed}/${total}`}
          </Text>
          {showRunningLoader ? (
            <Loader className="tc-todo-progress__running-loader" size="xs" />
          ) : null}
          {!compact ? (
            <Group gap={4} ml="auto" wrap="nowrap" align="center">
              {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            </Group>
          ) : null}
        </Group>
      </UnstyledButton>
      <Collapse in={open}>
        <Stack className="tc-todo-progress__list" gap={6} mt={8}>
          {items.map((item, index) => {
            const rowClass = `tc-todo-progress__row tc-todo-progress__row--${item.status}`
            const isCompleted = item.status === 'completed'
            const isBlocked = item.status === 'blocked'
            return (
              <Group
                key={`tc-todo-progress-item-${index}`}
                className={rowClass}
                gap={10}
                align="flex-start"
                wrap="nowrap"
              >
                <TodoStatusMark status={item.status} />
                <Text
                  className="tc-todo-progress__text"
                  size="sm"
                  c={isCompleted ? 'dimmed' : isBlocked ? 'red' : undefined}
                  td={isCompleted ? 'line-through' : undefined}
                  style={{ lineHeight: 1.4 }}
                >
                  {item.content}
                </Text>
              </Group>
            )
          })}
        </Stack>
      </Collapse>
    </div>
  )
}
