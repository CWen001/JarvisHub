import React from 'react'
import { ActionIcon, Badge, Button, Divider, Group, Stack, Text, TextInput, Textarea, Tooltip } from '@mantine/core'
import { IconRefresh, IconSparkles } from '@tabler/icons-react'
import { getMemoryContext, type MemoryEntryDto } from '../../../api/server'
import { toast } from '../../toast'
import { PanelCard } from '../../PanelCard'
import { InlinePanel } from '../../InlinePanel'

function prettyJson(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input ?? '')
  }
}

function formatTime(value: string): string {
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return value
  return new Date(ts).toLocaleString()
}

function EntryList({ title, items }: { title: string; items: MemoryEntryDto[] }): JSX.Element {
  return (
    <Stack className="stats-memory-context-debugger__section" gap="xs">
      <Group className="stats-memory-context-debugger__section-header" justify="space-between" align="center">
        <Text className="stats-memory-context-debugger__section-title" size="sm" fw={600}>{title}</Text>
        <Badge className="stats-memory-context-debugger__section-badge" size="xs" variant="light">{items.length}</Badge>
      </Group>
      {items.length === 0 ? (
        <Text className="stats-memory-context-debugger__section-empty" size="xs" c="dimmed">No entries</Text>
      ) : (
        items.map((item) => (
          <InlinePanel className="stats-memory-context-debugger__entry" key={item.id} padding="compact">
            <Text className="stats-memory-context-debugger__entry-title" size="sm" fw={500}>{item.title || item.summaryText || item.id}</Text>
            <Text className="stats-memory-context-debugger__entry-meta" size="xs" c="dimmed">
              {item.scopeType}:{item.scopeId} &middot; {item.memoryType} &middot; {formatTime(item.updatedAt)}
            </Text>
            <Textarea
              className="stats-memory-context-debugger__entry-content"
              value={prettyJson(item.content)}
              readOnly
              autosize
              minRows={2}
              mt={6}
            />
          </InlinePanel>
        ))
      )}
    </Stack>
  )
}

export default function StatsMemoryContextDebugger({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-memory-context-debugger', className].filter(Boolean).join(' ')
  const [sessionKey, setSessionKey] = React.useState('')
  const [projectId, setProjectId] = React.useState('')
  const [limitPerScope, setLimitPerScope] = React.useState('8')
  const [loading, setLoading] = React.useState(false)
  const [entries, setEntries] = React.useState<MemoryEntryDto[]>([])
  const [responseText, setResponseText] = React.useState('')

  const runLoad = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await getMemoryContext({
        ...(sessionKey.trim() ? { sessionKey: sessionKey.trim() } : {}),
        ...(projectId.trim() ? { projectId: projectId.trim() } : {}),
        ...(Number.isFinite(Number(limitPerScope)) ? { limitPerScope: Number(limitPerScope) } : {}),
      })
      setEntries(result.entries ?? [])
      setResponseText(prettyJson(result))
      toast('Memory context loaded', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load memory context'
      setEntries([])
      setResponseText(message)
      toast(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [limitPerScope, projectId, sessionKey])

  return (
    <PanelCard className={rootClassName}>
      <Group className="stats-memory-context-debugger__header" justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group className="stats-memory-context-debugger__header-left" gap={8} align="center">
          <Text className="stats-memory-context-debugger__title" fw={700} size="sm">Memory Context Debug</Text>
          <Badge className="stats-memory-context-debugger__badge" size="xs" variant="light">/memory/context</Badge>
        </Group>
        <Tooltip className="stats-memory-context-debugger__refresh-tooltip" label="Load" withArrow>
          <ActionIcon className="stats-memory-context-debugger__refresh" variant="light" onClick={() => void runLoad()} loading={loading}>
            <IconRefresh className="stats-memory-context-debugger__refresh-icon" size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Divider className="stats-memory-context-debugger__divider" my="sm" />

      <Stack className="stats-memory-context-debugger__body" gap="sm">
        <Group className="stats-memory-context-debugger__filters" align="flex-end" wrap="wrap" gap="sm">
          <TextInput className="stats-memory-context-debugger__session-key" label="Session Key" value={sessionKey} onChange={(e) => setSessionKey(e.currentTarget.value)} w={220} />
          <TextInput className="stats-memory-context-debugger__project-id" label="Project Id" value={projectId} onChange={(e) => setProjectId(e.currentTarget.value)} w={180} />
          <TextInput className="stats-memory-context-debugger__limit" label="Limit / Scope" value={limitPerScope} onChange={(e) => setLimitPerScope(e.currentTarget.value)} w={100} />
          <Button className="stats-memory-context-debugger__submit" leftSection={<IconSparkles className="stats-memory-context-debugger__submit-icon" size={14} />} onClick={() => void runLoad()} loading={loading}>Load Context</Button>
        </Group>

        {entries.length > 0 ? (
          <Stack className="stats-memory-context-debugger__content" gap="sm">
            <EntryList title="Memory Entries" items={entries} />
          </Stack>
        ) : (
          <Text className="stats-memory-context-debugger__empty" size="sm" c="dimmed">Enter scope and click Load to see memory context.</Text>
        )}

        <Textarea className="stats-memory-context-debugger__response" label="Raw Response" value={responseText} readOnly autosize minRows={8} />
      </Stack>
    </PanelCard>
  )
}
