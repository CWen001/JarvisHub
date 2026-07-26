import { useMemo, useState } from 'react'
import { Badge, Collapse, Group, Loader, Progress, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core'
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconShieldLock,
  IconTool,
  IconX,
} from '@tabler/icons-react'

import type {
  LiveChatRunRecord,
  LiveToolCallRecord,
  LiveToolCallStatus,
} from './liveChatRunStore'
import { getLiveToolCallEffectiveStatus } from './mediaToolStatus'
import {
  collectToolCalls,
  formatDurationMsForDisplay,
  formatUnknownForDisplay,
  getAgentRowDisplay,
  mediaStatusColor,
  mediaStatusLabel,
  toolStatusColor,
} from './toolCallReaders'

export type ToolCallsCoworkViewProps = {
  turnIds: string[]
  record: Pick<LiveChatRunRecord, 'toolCallsByTurn'>
  defaultOpen?: boolean
}

type ToolCallPayloadSection = {
  key: string
  label: string
  value: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readNestedRecord(
  source: Record<string, unknown> | undefined,
  path: string[],
): Record<string, unknown> | undefined {
  let cursor: unknown = source
  for (const segment of path) {
    if (!isRecord(cursor)) return undefined
    cursor = cursor[segment]
  }
  return isRecord(cursor) ? cursor : undefined
}

function hasRenderableValue(value: unknown): boolean {
  if (value === null || typeof value === 'undefined') return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) return Object.keys(value).length > 0
  return true
}

function buildPayloadSections(call: LiveToolCallRecord): ToolCallPayloadSection[] {
  const outputJson = call.outputJson
  const normalizedTaskRequest = readNestedRecord(outputJson, ['debug', 'normalizedTaskRequest'])
  const vendorRequest = readNestedRecord(outputJson, ['debug', 'vendorRequest'])
  const sections: ToolCallPayloadSection[] = []
  if (hasRenderableValue(call.input)) {
    sections.push({ key: 'agent-input', label: 'Agent 入参', value: call.input })
  }
  if (normalizedTaskRequest) {
    sections.push({
      key: 'normalized-task-request',
      label: '后端归一化参数',
      value: normalizedTaskRequest,
    })
  }
  if (vendorRequest) {
    sections.push({ key: 'vendor-request', label: '供应商请求体', value: vendorRequest })
  }
  if (outputJson) {
    sections.push({ key: 'tool-output-json', label: '工具输出 JSON', value: outputJson })
  }
  if (call.outputPreview) {
    sections.push({ key: 'output-preview', label: '输出预览', value: call.outputPreview })
  } else if (call.errorMessage) {
    sections.push({ key: 'error-summary', label: '错误摘要', value: call.errorMessage })
  }
  return sections
}

function ToolCallPayloadBlock({ section }: { section: ToolCallPayloadSection }) {
  const text = useMemo(() => formatUnknownForDisplay(section.value), [section.value])
  if (!text) return null
  return (
    <Stack className="canvas-cowork-toolcall-payload-block" gap={2}>
      <Text className="canvas-cowork-toolcall-payload-label" size="xs" c="dimmed" fw={600}>
        {section.label}
      </Text>
      <pre className="canvas-cowork-toolcall-payload-pre">
        {text}
      </pre>
    </Stack>
  )
}

function statusIcon(status: LiveToolCallStatus) {
  switch (status) {
    case 'succeeded':
      return <IconCheck size={12} />
    case 'failed':
      return <IconX size={12} />
    case 'denied':
    case 'blocked':
      return <IconShieldLock size={12} />
    case 'running':
    default:
      return <IconTool size={12} />
  }
}

function ToolCallRow({
  call,
  childrenByParent,
}: {
  call: LiveToolCallRecord
  childrenByParent: Map<string, LiveToolCallRecord[]>
}) {
  const [open, setOpen] = useState(false)
  const duration = formatDurationMsForDisplay(call.durationMs)
  const effectiveStatus = getLiveToolCallEffectiveStatus(call)
  const payloadSections = useMemo(() => buildPayloadSections(call), [call])
  const childCalls = childrenByParent.get(call.toolCallId) ?? []
  const agentDisplay = useMemo(() => getAgentRowDisplay(call.toolName, call.input), [call.input, call.toolName])

  return (
    <Stack className="canvas-cowork-toolcall-row" gap={4}>
      <UnstyledButton
        className="canvas-cowork-toolcall-row-header"
        onClick={() => setOpen((prev) => !prev)}
        style={{ width: '100%' }}
      >
        <Group gap={8} wrap="nowrap" align="center">
          <ThemeIcon
            className="canvas-cowork-toolcall-status-icon"
            size="xs"
            variant="light"
            color={toolStatusColor(effectiveStatus)}
          >
            {statusIcon(effectiveStatus)}
          </ThemeIcon>
          <Stack className="canvas-cowork-toolcall-name-stack" gap={0}>
            <Text className="canvas-cowork-toolcall-name" size="xs" fw={600}>
              {agentDisplay.title}
            </Text>
            {agentDisplay.subtitle ? (
              <Text
                className="canvas-cowork-toolcall-subtitle"
                size="xs"
                c="dimmed"
                title={agentDisplay.subtitle}
              >
                {agentDisplay.subtitle}
              </Text>
            ) : null}
          </Stack>
          {effectiveStatus === 'running' ? (
            <Loader className="canvas-cowork-toolcall-running-loader" size="xs" />
          ) : null}
          <Badge
            className="canvas-cowork-toolcall-status-chip"
            size="xs"
            variant="light"
            color={toolStatusColor(effectiveStatus)}
          >
            {effectiveStatus}
          </Badge>
          {duration && effectiveStatus !== 'running' ? (
            <Badge className="canvas-cowork-toolcall-duration-chip" size="xs" variant="outline">
              {duration}
            </Badge>
          ) : null}
          {childCalls.length > 0 ? (
            <Badge
              className="canvas-cowork-toolcall-children-chip"
              size="xs"
              variant="light"
              color="grape"
            >
              {`${childCalls.length} sub`}
            </Badge>
          ) : null}
          <Group gap={4} ml="auto" wrap="nowrap" align="center">
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </Group>
        </Group>
      </UnstyledButton>
      {call.media ? (
        <Group className="canvas-cowork-toolcall-media" gap={8} wrap="nowrap" align="center" pl={22}>
          <Text
            className="canvas-cowork-toolcall-media-node"
            size="xs"
            ff="monospace"
            c="dimmed"
            truncate
            style={{ flex: 1, minWidth: 0 }}
          >
            {call.media.nodeId || call.media.taskId}
          </Text>
          {call.media.status === 'running' && typeof call.media.progress === 'number' ? (
            <Progress
              className="canvas-cowork-toolcall-media-progress"
              value={call.media.progress}
              size="xs"
              w={64}
              color={mediaStatusColor(call.media.status)}
              aria-label="生成进度"
            />
          ) : null}
          {call.media.status === 'running' ? (
            <Loader size="xs" color={mediaStatusColor(call.media.status)} />
          ) : null}
          {call.media.status === 'succeeded' && (call.media.thumbnailUrl || call.media.url) ? (
            <img
              className="canvas-cowork-toolcall-media-thumb"
              src={call.media.thumbnailUrl || call.media.url}
              alt={call.media.nodeId}
              width={24}
              height={24}
              style={{ borderRadius: 4, objectFit: 'cover' }}
            />
          ) : null}
          <Badge
            className="canvas-cowork-toolcall-media-status"
            size="xs"
            variant="light"
            color={mediaStatusColor(call.media.status)}
            title={call.media.status === 'failed' ? call.media.errorMessage : undefined}
          >
            {mediaStatusLabel(call.media)}
          </Badge>
        </Group>
      ) : null}
      <Collapse in={open}>
        <Stack className="canvas-cowork-toolcall-detail" gap={6} pl={22}>
          {payloadSections.map((section) => (
            <ToolCallPayloadBlock key={section.key} section={section} />
          ))}
          {payloadSections.length === 0 && childCalls.length === 0 ? (
            <Text className="canvas-cowork-toolcall-empty" size="xs" c="dimmed">
              （no payload captured）
            </Text>
          ) : null}
          {childCalls.length > 0 ? (
            <Stack
              className="canvas-cowork-toolcall-subagent"
              gap={6}
              mt={4}
              pl={8}
              style={{ borderLeft: '2px solid var(--mantine-color-grape-3, #cda7e8)' }}
            >
              <Text
                className="canvas-cowork-toolcall-subagent-label"
                size="xs"
                c="dimmed"
                fw={600}
              >
                {`sub-agent 轨迹（${childCalls.length} 个工具调用）`}
              </Text>
              {childCalls.map((child) => (
                <ToolCallRow
                  key={child.toolCallId}
                  call={child}
                  childrenByParent={childrenByParent}
                />
              ))}
            </Stack>
          ) : null}
        </Stack>
      </Collapse>
    </Stack>
  )
}

export function ToolCallsCoworkView({ turnIds, record, defaultOpen = false }: ToolCallsCoworkViewProps) {
  const [open, setOpen] = useState(defaultOpen)
  const calls = useMemo(() => collectToolCalls(record, turnIds), [record, turnIds])
  const { rootCalls, childrenByParent } = useMemo(() => {
    const rootIds = new Set(calls.map((c) => c.toolCallId))
    const childMap = new Map<string, LiveToolCallRecord[]>()
    for (const call of calls) {
      const parentId = call.parentToolCallId
      if (!parentId || !rootIds.has(parentId) || parentId === call.toolCallId) continue
      const bucket = childMap.get(parentId) ?? []
      bucket.push(call)
      childMap.set(parentId, bucket)
    }
    for (const bucket of childMap.values()) {
      bucket.sort((a, b) => a.startedAtMs - b.startedAtMs)
    }
    const childIds = new Set<string>()
    for (const bucket of childMap.values()) {
      for (const c of bucket) childIds.add(c.toolCallId)
    }
    const roots = calls.filter((c) => !childIds.has(c.toolCallId))
    return { rootCalls: roots, childrenByParent: childMap }
  }, [calls])

  if (calls.length === 0) return null
  const running = calls.some((call) => getLiveToolCallEffectiveStatus(call) === 'running')

  return (
    <Stack
      className="canvas-cowork-toolcalls"
      gap={4}
      p={8}
    >
      <UnstyledButton
        className="canvas-cowork-toolcalls-header"
        onClick={() => setOpen((prev) => !prev)}
        style={{ width: '100%' }}
      >
        <Group gap={8} wrap="nowrap" align="center">
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <Text className="canvas-cowork-toolcalls-label" size="xs" fw={600}>
            {`已调用 ${calls.length} 个工具`}
          </Text>
          {running ? <Loader className="canvas-cowork-toolcalls-running-loader" size="xs" /> : null}
        </Group>
      </UnstyledButton>
      <Collapse in={open}>
        <Stack className="canvas-cowork-toolcalls-list" gap={6} mt={4}>
          {rootCalls.map((call) => (
            <ToolCallRow
              key={call.toolCallId}
              call={call}
              childrenByParent={childrenByParent}
            />
          ))}
        </Stack>
      </Collapse>
    </Stack>
  )
}
