import React from 'react'
import { Badge, Collapse, Group, Loader, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core'
import {
  IconBook2,
  IconChevronDown,
  IconChevronRight,
  IconMessageQuestion,
  IconMessageCircle,
  IconTool,
} from '@tabler/icons-react'

import type { ChatAskUserPrompt } from './askUserPrompt'
import type { ChatTodoItem } from './chatTodoTypes'
import type { LiveChatRunRecord, LiveChatTraceItem, LiveToolCallRecord } from './liveChatRunStore'
import { ChatMarkdownContent } from './ChatMarkdownContent'
import {
  formatAskUserQuestionForDisplay,
  getAskUserUrgencyBadgeColor,
  getAskUserUrgencyLabel,
} from './askUserPrompt'
import { TodoProgressCard } from './TodoProgressCard'
import { resolveToolExecutionStatus } from './agentProgressModel'
import { getLiveToolCallEffectiveStatus } from './mediaToolStatus'
import { formatDurationMsForDisplay, formatUnknownForDisplay, getAgentRowDisplay, toolStatusColor } from './toolCallReaders'

type AgentTraceTimelineProps = {
  items: LiveChatTraceItem[]
  toolCallRecord?: Pick<LiveChatRunRecord, 'toolCallsByTurn'> | null
  todoItems?: ChatTodoItem[]
  askUserPrompt?: ChatAskUserPrompt | null
  askUserAnswered?: boolean
  askUserReplyText?: string
  responseNode?: React.ReactNode
  active?: boolean
  showTodoProgress?: boolean
}

type ToolPayloadSection = {
  key: string
  label: string
  value: unknown
}

type AskUserTraceItem = {
  id: string
  kind: 'ask'
  prompt: ChatAskUserPrompt
  at: number
}

type RenderableTraceItem = LiveChatTraceItem | AskUserTraceItem

function findToolCall(
  record: Pick<LiveChatRunRecord, 'toolCallsByTurn'> | null | undefined,
  item: Extract<LiveChatTraceItem, { kind: 'tool' }>,
): LiveToolCallRecord | null {
  const directBucket = record?.toolCallsByTurn[item.turnId]
  const direct = directBucket?.find((call) => call.toolCallId === item.toolCallId)
  if (direct) return direct
  const buckets = Object.values(record?.toolCallsByTurn ?? {})
  for (const bucket of buckets) {
    const found = bucket.find((call) => call.toolCallId === item.toolCallId)
    if (found) return found
  }
  return null
}

const TODO_STATUS_VALUES = new Set<ChatTodoItem['status']>([
  'pending',
  'in_progress',
  'waiting',
  'blocked',
  'completed',
])

function extractTodoItemsFromTodoWriteInput(input: unknown): ChatTodoItem[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  const rawItems = (input as { items?: unknown }).items
  if (!Array.isArray(rawItems)) return []
  const out: ChatTodoItem[] = []
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as { content?: unknown; status?: unknown }
    const content = typeof record.content === 'string' ? record.content.trim() : ''
    const status = record.status
    if (!content || typeof status !== 'string') continue
    if (!TODO_STATUS_VALUES.has(status as ChatTodoItem['status'])) continue
    out.push({ status: status as ChatTodoItem['status'], content })
  }
  return out
}

function extractTodoItemsFromTodoWriteOutput(output: string): ChatTodoItem[] {
  const out: ChatTodoItem[] = []
  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(/^\[(x|>|~|!| )\]\s+(.+)$/iu)
    if (!match) continue
    const marker = (match[1] ?? ' ').toLowerCase()
    const content = (match[2] ?? '').trim()
    if (!content) continue
    const status: ChatTodoItem['status'] =
      marker === 'x'
        ? 'completed'
        : marker === '>'
          ? 'in_progress'
          : marker === '~'
            ? 'waiting'
            : marker === '!'
              ? 'blocked'
              : 'pending'
    out.push({ status, content })
  }
  return out
}

function extractTodoItemsFromTodoWriteCall(call: LiveToolCallRecord): ChatTodoItem[] {
  const fromInput = extractTodoItemsFromTodoWriteInput(call.input)
  if (fromInput.length > 0) return fromInput
  return extractTodoItemsFromTodoWriteOutput(call.outputPreview)
}

function findLatestTodoWriteInSubtree(
  children: ChildTraceItem[],
  childrenByParent: Map<string, ChildTraceItem[]>,
  toolCallRecord: Pick<LiveChatRunRecord, 'toolCallsByTurn'> | null | undefined,
): LiveToolCallRecord | null {
  let latest: LiveToolCallRecord | null = null
  const visit = (nodes: ChildTraceItem[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'tool') continue
      const call = findToolCall(toolCallRecord, node)
      if (call && call.toolName === 'TodoWrite') {
        if (!latest || call.startedAtMs >= latest.startedAtMs) latest = call
      }
      const grand = childrenByParent.get(node.toolCallId)
      if (grand && grand.length > 0) visit(grand)
    }
  }
  visit(children)
  return latest
}

function buildToolPayloadSections(call: LiveToolCallRecord): ToolPayloadSection[] {
  const sections: ToolPayloadSection[] = []
  if (typeof call.input !== 'undefined') {
    sections.push({ key: 'input', label: 'Input', value: call.input })
  }
  if (call.outputJson) {
    sections.push({ key: 'output-json', label: 'Output JSON', value: call.outputJson })
  } else if (call.outputPreview) {
    sections.push({ key: 'output-preview', label: 'Output Preview', value: call.outputPreview })
  }
  if (call.media) {
    sections.push({ key: 'media', label: 'Media', value: call.media })
  }
  if (call.errorMessage) {
    sections.push({ key: 'error', label: 'Error', value: call.errorMessage })
  }
  return sections
}

function ToolPayloadBlock({ section }: { section: ToolPayloadSection }) {
  const text = React.useMemo(() => formatUnknownForDisplay(section.value), [section.value])
  if (!text) return null
  return (
    <Stack className="tc-agent-trace-tool-payload" gap={4}>
      <Text className="tc-agent-trace-tool-payload__label" size="xs" c="dimmed" fw={600}>
        {section.label}
      </Text>
      <pre className="tc-agent-trace-tool-payload__pre">
        {text}
      </pre>
    </Stack>
  )
}

type ToolItem = Extract<LiveChatTraceItem, { kind: 'tool' }>
type ThinkingItem = Extract<LiveChatTraceItem, { kind: 'thinking' }>
type ResponseItem = Extract<LiveChatTraceItem, { kind: 'response' }>
type ChildTraceItem = ToolItem | ThinkingItem | ResponseItem

function countToolDescendants(
  items: ChildTraceItem[],
  childrenByParent: Map<string, ChildTraceItem[]>,
): number {
  let count = 0
  for (const item of items) {
    if (item.kind !== 'tool') continue
    count += 1
    const grand = childrenByParent.get(item.toolCallId)
    if (grand && grand.length > 0) count += countToolDescendants(grand, childrenByParent)
  }
  return count
}

function ToolTraceRow({
  call,
  children,
  toolCallRecord,
  childrenByParent,
  childToolCallsByParent,
}: {
  call: LiveToolCallRecord | null
  children: ChildTraceItem[]
  toolCallRecord: Pick<LiveChatRunRecord, 'toolCallsByTurn'> | null | undefined
  childrenByParent: Map<string, ChildTraceItem[]>
  childToolCallsByParent: Map<string, LiveToolCallRecord[]>
}) {
  const hasChildren = children.length > 0
  const [open, setOpen] = React.useState(hasChildren)
  const [payloadOpen, setPayloadOpen] = React.useState(false)
  if (!call) return null
  const toolName = call.toolName
  const isSkill = toolName === 'Skill'
  const toolDescendantCount = countToolDescendants(children, childrenByParent)
  const agentDisplay = getAgentRowDisplay(toolName, call.input, toolDescendantCount)
  const isAgent = agentDisplay.isAgent
  const executionStatus = isAgent
    ? resolveToolExecutionStatus(call, childToolCallsByParent)
    : {
        dispatchStatus: call.status,
        runStatus: getLiveToolCallEffectiveStatus(call),
        hasDescendants: false,
        shouldShowDispatchStatus: false,
      }
  const status = executionStatus.runStatus
  const duration = formatDurationMsForDisplay(call.durationMs ?? null)
  const showDuration = Boolean(duration && status !== 'running' && !executionStatus.shouldShowDispatchStatus)
  const sections = buildToolPayloadSections(call)
  const hasPayload = sections.length > 0
  const subagentTodoItems = isAgent && hasChildren
    ? (() => {
        const todoCall = findLatestTodoWriteInSubtree(children, childrenByParent, toolCallRecord)
        return todoCall ? extractTodoItemsFromTodoWriteCall(todoCall) : []
      })()
    : []

  return (
    <Stack className="tc-agent-trace-tool" gap={4}>
      <UnstyledButton
        className="tc-agent-trace-tool__header"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        style={{ width: '100%' }}
      >
        <Group className="tc-agent-trace-tool__header-inner" gap={8} wrap="nowrap" align="center">
          <ThemeIcon
            className="tc-agent-trace-tool__icon"
            aria-label={`${isSkill ? 'skill' : 'tool'} icon: ${toolName}`}
            size="sm"
            variant="light"
            color={isSkill ? 'cyan' : toolStatusColor(status)}
          >
            {isSkill ? <IconBook2 className="tc-agent-trace-tool__icon-svg" size={14} /> : <IconTool className="tc-agent-trace-tool__icon-svg" size={14} />}
          </ThemeIcon>
          <Stack className="tc-agent-trace-tool__name-stack" gap={0}>
            <Text className="tc-agent-trace-tool__name" size="sm" fw={650}>
              {agentDisplay.title}
            </Text>
            {agentDisplay.subtitle ? (
              <Text
                className="tc-agent-trace-tool__subtitle"
                size="xs"
                c="dimmed"
                title={agentDisplay.subtitle}
              >
                {agentDisplay.subtitle}
              </Text>
            ) : null}
          </Stack>
          {status === 'running' ? (
            <Loader className="tc-agent-trace-tool__loader" size="xs" />
          ) : null}
          <Badge className="tc-agent-trace-tool__status" size="xs" variant="light" color={toolStatusColor(status)}>
            {status}
          </Badge>
          {isAgent && executionStatus.shouldShowDispatchStatus ? (
            <Badge
              className="tc-agent-trace-tool__dispatch-status"
              size="xs"
              variant="outline"
              color={toolStatusColor(executionStatus.dispatchStatus)}
            >
              {`dispatch ${executionStatus.dispatchStatus}`}
            </Badge>
          ) : null}
          {showDuration ? (
            <Badge className="tc-agent-trace-tool__duration" size="xs" variant="outline">
              {duration}
            </Badge>
          ) : null}
          <span className="tc-agent-trace-tool__spacer" />
          {open ? <IconChevronDown className="tc-agent-trace-tool__chevron" size={14} /> : <IconChevronRight className="tc-agent-trace-tool__chevron" size={14} />}
        </Group>
      </UnstyledButton>
      <Collapse className="tc-agent-trace-tool__collapse" in={open}>
        <Stack className="tc-agent-trace-tool__details" gap={8} aria-label={`agent-trace-tool-details-${call.toolCallId}`}>
          {isAgent && subagentTodoItems.length > 0 ? (
            <TodoProgressCard
              items={subagentTodoItems}
              active={status === 'running'}
              defaultOpen
              title="Todo"
            />
          ) : null}
          {hasChildren && hasPayload ? (
            <UnstyledButton
              className="tc-agent-trace-tool__payload-toggle"
              aria-expanded={payloadOpen}
              onClick={() => setPayloadOpen((prev) => !prev)}
            >
              <Group gap={6} wrap="nowrap" align="center">
                {payloadOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                <Text size="xs" c="dimmed" fw={600}>
                  {payloadOpen ? '隐藏 Input / Output' : '显示 Input / Output'}
                </Text>
              </Group>
            </UnstyledButton>
          ) : null}
          {hasPayload && (!hasChildren || payloadOpen)
            ? sections.map((section) => (
                <ToolPayloadBlock key={section.key} section={section} />
              ))
            : null}
          {sections.length === 0 && !hasChildren ? (
            <Text className="tc-agent-trace-tool__empty" size="xs" c="dimmed">
              No payload captured.
            </Text>
          ) : null}
          {hasChildren ? (
            <Stack
              className="tc-agent-trace-tool__children"
              gap={6}
              aria-label={`agent-trace-tool-children-${call.toolCallId}`}
            >
              {children.map((childItem) => {
                if (childItem.kind === 'thinking') {
                  return <ThinkingTraceRow key={childItem.id} item={childItem} />
                }
                if (childItem.kind === 'response') {
                  return <SubAgentResponseRow key={childItem.id} item={childItem} />
                }
                const childCall = findToolCall(toolCallRecord, childItem)
                const grandChildren = childrenByParent.get(childItem.toolCallId) ?? []
                return (
                  <ToolTraceRow
                    key={childItem.id}
                    call={childCall}
                    children={grandChildren}
                    toolCallRecord={toolCallRecord}
                    childrenByParent={childrenByParent}
                    childToolCallsByParent={childToolCallsByParent}
                  />
                )
              })}
            </Stack>
          ) : null}
        </Stack>
      </Collapse>
    </Stack>
  )
}

function ThinkingTraceRow({
  item,
}: {
  item: Extract<LiveChatTraceItem, { kind: 'thinking' }>
}) {
  return (
    <Stack className="tc-agent-trace-thinking" gap={8}>
      <Group className="tc-agent-trace-row__heading" gap={8} wrap="nowrap" align="center">
        <ThemeIcon className="tc-agent-trace-row__icon" size="sm" variant="light" color="gray">
          <IconMessageCircle className="tc-agent-trace-row__icon-svg" size={14} />
        </ThemeIcon>
        <Text className="tc-agent-trace-row__title" size="sm" fw={650}>
          Thinking
        </Text>
      </Group>
      <div className="tc-agent-trace-thinking__text">
        <ChatMarkdownContent markdownText={item.text} />
      </div>
    </Stack>
  )
}

function SubAgentResponseRow({
  item,
}: {
  item: Extract<LiveChatTraceItem, { kind: 'response' }>
}) {
  return (
    <Stack className="tc-agent-trace-subagent-response" gap={8}>
      <Group className="tc-agent-trace-row__heading" gap={8} wrap="nowrap" align="center">
        <ThemeIcon className="tc-agent-trace-row__icon" size="sm" variant="light" color="gray">
          <IconMessageCircle className="tc-agent-trace-row__icon-svg" size={14} />
        </ThemeIcon>
        <Text className="tc-agent-trace-row__title" size="sm" fw={650}>
          Response
        </Text>
      </Group>
      <div className="tc-agent-trace-subagent-response__text">
        <ChatMarkdownContent markdownText={item.text} />
      </div>
    </Stack>
  )
}

function ResponseTraceRow({ responseNode }: { responseNode: React.ReactNode }) {
  return (
    <Stack className="tc-agent-trace-response" gap={8}>
      <Group className="tc-agent-trace-row__heading" gap={8} wrap="nowrap" align="center">
        <ThemeIcon className="tc-agent-trace-row__icon" size="sm" variant="light" color="gray">
          <IconMessageCircle className="tc-agent-trace-row__icon-svg" size={14} />
        </ThemeIcon>
        <Text className="tc-agent-trace-row__title" size="sm" fw={650}>
          Response
        </Text>
      </Group>
      <div className="tc-agent-trace-response__body">
        {responseNode}
      </div>
    </Stack>
  )
}

function AskUserTraceRow({
  prompt,
  toolCall,
  answered,
  userReplyText,
}: {
  prompt: ChatAskUserPrompt
  toolCall: LiveToolCallRecord | null
  answered: boolean
  userReplyText?: string
}) {
  const status = toolCall?.status ?? null
  const duration = formatDurationMsForDisplay(toolCall?.durationMs ?? null)
  const rootClassName = [
    'tc-agent-trace-ask-user',
    answered ? 'tc-agent-trace-ask-user--answered' : '',
  ].filter(Boolean).join(' ')
  const displayQuestion = formatAskUserQuestionForDisplay(prompt.question, prompt.options)

  return (
    <Stack className={rootClassName} gap={8}>
      <Group className="tc-agent-trace-ask-user__header-inner" gap={8} wrap="nowrap" align="center">
        <ThemeIcon className="tc-agent-trace-row__icon" size="sm" variant="light" color="yellow">
          <IconMessageQuestion className="tc-agent-trace-row__icon-svg" size={14} />
        </ThemeIcon>
        <Text className="tc-agent-trace-row__title" size="sm" fw={650}>
          向用户提问
        </Text>
        {answered ? (
          <>
            <Badge
              className="tc-agent-trace-ask-user__answered-badge"
              size="xs"
              radius="sm"
              variant="light"
              color="teal"
            >
              已回答
            </Badge>
            {status ? (
              <Badge
                className="tc-agent-trace-ask-user__status"
                size="xs"
                variant="light"
                color={toolStatusColor(status)}
              >
                {status}
              </Badge>
            ) : null}
            {duration ? (
              <Badge
                className="tc-agent-trace-ask-user__duration"
                size="xs"
                variant="outline"
              >
                {duration}
              </Badge>
            ) : null}
          </>
        ) : (
          <Badge
            className="tc-agent-trace-ask-user__badge"
            size="xs"
            radius="sm"
            variant="light"
            color={getAskUserUrgencyBadgeColor(prompt.urgency)}
          >
            {getAskUserUrgencyLabel(prompt.urgency)}
          </Badge>
        )}
      </Group>
      {answered ? (
        <div className="tc-agent-trace-ask-user__answer-record">
          <div className="tc-agent-trace-ask-user__question-section">
            <Text className="tc-agent-trace-ask-user__section-label" size="xs" fw={700}>
              问题
            </Text>
            <div className="tc-agent-trace-ask-user__question">
              <ChatMarkdownContent markdownText={displayQuestion} />
            </div>
          </div>
          {userReplyText ? (
            <div className="tc-agent-trace-ask-user__reply">
              <Text className="tc-agent-trace-ask-user__section-label" size="xs" fw={700}>
                你的回答
              </Text>
              <div className="tc-agent-trace-ask-user__reply-text">
                <ChatMarkdownContent markdownText={userReplyText} />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Stack>
  )
}

function isTopLevelResponse(item: RenderableTraceItem): boolean {
  return item.kind === 'response' && !item.parentToolCallId
}

function insertTraceItemBeforeResponse<T extends RenderableTraceItem>(items: T[], item: T): T[] {
  const responseIndex = items.findIndex((existingItem) => isTopLevelResponse(existingItem))
  if (responseIndex < 0) return [...items, item]
  return [
    ...items.slice(0, responseIndex),
    item,
    ...items.slice(responseIndex),
  ]
}

function isThinkingDuplicateOfAskQuestion(
  text: string | null | undefined,
  question: string,
): boolean {
  const trimmedText = String(text ?? '').trim()
  if (!trimmedText) return false
  const trimmedQuestion = question.trim()
  if (!trimmedQuestion) return false
  if (trimmedText === trimmedQuestion) return true
  const head = trimmedText.slice(0, trimmedQuestion.length)
  if (head !== trimmedQuestion) return false
  const tail = trimmedText.slice(trimmedQuestion.length)
  return tail.length === 0 || /^[\s\n\r]/.test(tail)
}

export function mergeAskUserTraceItem(
  items: RenderableTraceItem[],
  prompt: ChatAskUserPrompt | null | undefined,
): RenderableTraceItem[] {
  if (!prompt) return items
  const dedupedItems = items.filter((item) => {
    if (item.kind === 'tool' && item.toolCallId === prompt.toolCallId) return false
    if (item.kind !== 'thinking') return true
    return !isThinkingDuplicateOfAskQuestion(item.text, prompt.question)
  })
  const askItem: AskUserTraceItem = {
    id: `ask:${prompt.toolCallId}`,
    kind: 'ask',
    prompt,
    at: Number.MAX_SAFE_INTEGER - 2,
  }
  return insertTraceItemBeforeResponse(dedupedItems, askItem)
}

function buildRenderableItems(
  items: LiveChatTraceItem[],
  hasTodoItems: boolean,
  hasResponseNode: boolean,
  askUserPrompt: ChatAskUserPrompt | null | undefined,
): RenderableTraceItem[] {
  let nextItems: RenderableTraceItem[] = mergeAskUserTraceItem(items, askUserPrompt)
  if (hasTodoItems && !nextItems.some((item) => item.kind === 'todo')) {
    nextItems = insertTraceItemBeforeResponse(nextItems, {
      id: 'todo:implicit',
      kind: 'todo',
      turnId: '',
      sourceToolCallId: 'todo:implicit',
      at: Number.MAX_SAFE_INTEGER - 1,
    })
  }
  if (!hasResponseNode || nextItems.some((item) => isTopLevelResponse(item))) return nextItems
  return [
    ...nextItems,
    {
      id: 'response:implicit',
      kind: 'response',
      turnId: '',
      text: '',
      at: Number.MAX_SAFE_INTEGER,
    },
  ]
}

export function AgentTraceTimeline({
  items,
  toolCallRecord,
  todoItems = [],
  askUserPrompt = null,
  askUserAnswered = false,
  askUserReplyText,
  responseNode,
  active = false,
  showTodoProgress = true,
}: AgentTraceTimelineProps) {
  const renderableItems = React.useMemo(
    () => buildRenderableItems(items, showTodoProgress && todoItems.length > 0, Boolean(responseNode), askUserPrompt),
    [askUserPrompt, items, responseNode, showTodoProgress, todoItems.length],
  )

  const { childrenByParent, childToolCallsByParent, skippedItemIds } = React.useMemo(() => {
    const childMap = new Map<string, ChildTraceItem[]>()
    const childToolCallMap = new Map<string, LiveToolCallRecord[]>()
    const skipped = new Set<string>()
    const toolItemIds = new Set<string>()
    for (const item of items) {
      if (item.kind === 'tool') toolItemIds.add(item.toolCallId)
    }
    for (const item of items) {
      if (item.kind === 'tool') {
        const call = findToolCall(toolCallRecord, item)
        const parentId = call?.parentToolCallId
        if (!parentId || !toolItemIds.has(parentId)) continue
        const bucket = childMap.get(parentId)
        if (bucket) bucket.push(item)
        else childMap.set(parentId, [item])
        if (call) {
          const callBucket = childToolCallMap.get(parentId)
          if (callBucket) callBucket.push(call)
          else childToolCallMap.set(parentId, [call])
        }
        skipped.add(item.id)
        continue
      }
      if (item.kind === 'thinking') {
        const parentId = item.parentToolCallId
        if (!parentId || !toolItemIds.has(parentId)) continue
        const bucket = childMap.get(parentId)
        if (bucket) bucket.push(item)
        else childMap.set(parentId, [item])
        skipped.add(item.id)
        continue
      }
      if (item.kind === 'response') {
        const parentId = item.parentToolCallId
        if (!parentId || !toolItemIds.has(parentId)) continue
        const bucket = childMap.get(parentId)
        if (bucket) bucket.push(item)
        else childMap.set(parentId, [item])
        skipped.add(item.id)
        continue
      }
      if (item.kind === 'todo') {
        // todo items emitted by subagents are dropped from top-level rendering
        // (parent's todo is shown via TodoProgressCard, subagent todos lack items context)
        if (item.parentToolCallId && toolItemIds.has(item.parentToolCallId)) {
          skipped.add(item.id)
        }
      }
    }
    return { childrenByParent: childMap, childToolCallsByParent: childToolCallMap, skippedItemIds: skipped }
  }, [items, toolCallRecord])

  if (renderableItems.length === 0) return null

  return (
    <Stack className="tc-agent-trace" gap={10} aria-label="agent-trace-timeline">
      {renderableItems.map((item) => {
        if (item.kind === 'thinking') {
          if (skippedItemIds.has(item.id)) return null
          return <ThinkingTraceRow key={item.id} item={item} />
        }
        if (item.kind === 'tool') {
          if (skippedItemIds.has(item.id)) return null
          const call = findToolCall(toolCallRecord, item)
          const children = childrenByParent.get(item.toolCallId) ?? []
          return (
            <ToolTraceRow
              key={item.id}
              call={call}
              children={children}
              toolCallRecord={toolCallRecord}
              childrenByParent={childrenByParent}
              childToolCallsByParent={childToolCallsByParent}
            />
          )
        }
        if (item.kind === 'todo') {
          if (skippedItemIds.has(item.id)) return null
          if (!showTodoProgress) return null
          return <TodoProgressCard key={item.id} items={todoItems} active={active} defaultOpen={active} title="主任务 Todo" />
        }
        if (item.kind === 'ask') {
          const call = findToolCall(toolCallRecord, {
            id: `tool:${item.prompt.toolCallId}`,
            kind: 'tool',
            turnId: '',
            toolCallId: item.prompt.toolCallId,
            at: 0,
          })
          return (
            <AskUserTraceRow
              key={item.id}
              prompt={item.prompt}
              toolCall={call}
              answered={askUserAnswered}
              userReplyText={askUserReplyText}
            />
          )
        }
        if (skippedItemIds.has(item.id)) return null
        if (!responseNode) return null
        return <ResponseTraceRow key={item.id} responseNode={responseNode} />
      })}
    </Stack>
  )
}
