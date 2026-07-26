import React, { useCallback, useEffect, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  Transition,
} from '@mantine/core'
import {
  IconBrain,
  IconEdit,
  IconPin,
  IconPinFilled,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import {
  deleteMemoryEntry,
  searchMemoryEntriesForPanel,
  updateMemoryEntry,
  type MemoryEntry,
} from '../../api/server'
import { useUIStore } from '../uiStore'
import { PanelCard } from '../PanelCard'
import { calculateSafeMaxHeight } from '../utils/panelPosition'

export const MEMORY_ENABLED_STORAGE_KEY = 'jarvis_memory_enabled'

export function isMemoryEnabled(): boolean {
  return localStorage.getItem(MEMORY_ENABLED_STORAGE_KEY) !== 'false'
}

const MEMORY_TYPE_LABELS: Record<string, string> = {
  preference: 'Preference',
  fact: 'Fact',
  reference: 'Reference',
  feedback: 'Feedback',
}

const MEMORY_TYPE_COLORS: Record<string, string> = {
  preference: 'blue',
  fact: 'gray',
  reference: 'green',
  feedback: 'orange',
}

function isPinned(entry: MemoryEntry): boolean {
  return (entry.content as Record<string, unknown>)?.__pinned === true
}

export default function MemoryPanel(): JSX.Element | null {
  const activePanel = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const projectId = useUIStore(s => s.currentProject?.id) ?? ''
  const anchorY = useUIStore(s => s.panelAnchorY)

  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [editingEntry, setEditingEntry] = useState<MemoryEntry | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [memoryEnabled, setMemoryEnabled] = useState(isMemoryEnabled)

  const handleToggleMemory = useCallback((checked: boolean) => {
    localStorage.setItem(MEMORY_ENABLED_STORAGE_KEY, checked ? 'true' : 'false')
    setMemoryEnabled(checked)
  }, [])

  const isOpen = activePanel === 'memory'

  const loadEntries = useCallback(async () => {
    if (!projectId || !memoryEnabled) return
    setLoading(true)
    try {
      const items = await searchMemoryEntriesForPanel({
        ...(searchQuery.trim() ? { query: searchQuery.trim() } : {}),
        scopes: [
          { scopeType: 'project', scopeId: projectId },
          { scopeType: 'user', scopeId: '_self' },
        ],
        limit: 50,
      })
      setEntries(items.filter(e => e.status === 'active' && e.memoryType !== 'summary'))
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [projectId, searchQuery, memoryEnabled])

  useEffect(() => {
    if (isOpen) void loadEntries()
  }, [isOpen, loadEntries])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteMemoryEntry(id)
      setEntries(prev => prev.filter(e => e.id !== id))
    } catch {}
  }, [])

  const handlePin = useCallback(async (entry: MemoryEntry) => {
    const pinned = !isPinned(entry)
    try {
      await updateMemoryEntry({ id: entry.id, pinned })
      setEntries(prev =>
        prev.map(e => e.id === entry.id ? { ...e, content: { ...e.content, __pinned: pinned } } : e)
      )
    } catch {}
  }, [])

  const handleEditSave = useCallback(async () => {
    if (!editingEntry) return
    try {
      await updateMemoryEntry({
        id: editingEntry.id,
        title: editTitle,
        summaryText: editSummary,
      })
      setEntries(prev =>
        prev.map(e => e.id === editingEntry.id ? { ...e, title: editTitle, summaryText: editSummary } : e)
      )
      setEditingEntry(null)
    } catch {}
  }, [editingEntry, editTitle, editSummary])

  const filtered = filter === 'all'
    ? entries
    : entries.filter(e => e.memoryType === filter)

  if (!isOpen) return null

  const maxHeight = calculateSafeMaxHeight(anchorY, 150)

  return (
    <div
      className="memory-panel-anchor"
      style={{ position: 'fixed', left: 82, top: anchorY ? anchorY - 150 : 140, zIndex: 200 }}
      data-ux-panel
    >
      <Transition mounted={isOpen} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <PanelCard
            className="memory-panel"
            style={{ ...styles, width: 380, maxHeight: `${maxHeight}px`, display: 'flex', flexDirection: 'column' }}
          >
      <div className="memory-panel__header">
        <Group className="memory-panel__title-row" justify="space-between">
          <Group className="memory-panel__title-group" gap="xs">
            <IconBrain size={18} />
            <Text className="memory-panel__title" fw={600} size="sm">Project Memory</Text>
            {memoryEnabled && (
              <Badge className="memory-panel__count" size="xs" variant="light">{filtered.length}</Badge>
            )}
          </Group>
          <Group className="memory-panel__header-actions" gap="xs">
            <Switch
              className="memory-panel__toggle"
              size="xs"
              checked={memoryEnabled}
              onChange={e => handleToggleMemory(e.currentTarget.checked)}
              aria-label="启用 Memory"
            />
            <ActionIcon
              className="memory-panel__close-btn"
              variant="subtle"
              size="sm"
              onClick={() => setActivePanel(null)}
            >
              <IconX size={14} />
            </ActionIcon>
          </Group>
        </Group>

        {memoryEnabled && (
          <>
            <TextInput
              className="memory-panel__search"
              placeholder="Search memories..."
              size="xs"
              leftSection={<IconSearch size={14} />}
              value={searchQuery}
              onChange={e => setSearchQuery(e.currentTarget.value)}
              onKeyDown={e => { if (e.key === 'Enter') void loadEntries() }}
            />

            <SegmentedControl
              className="memory-panel__filter"
              size="xs"
              value={filter}
              onChange={setFilter}
              data={[
                { label: 'All', value: 'all' },
                { label: 'Preference', value: 'preference' },
                { label: 'Fact', value: 'fact' },
                { label: 'Reference', value: 'reference' },
                { label: 'Feedback', value: 'feedback' },
              ]}
            />
          </>
        )}
      </div>

      {!memoryEnabled ? (
        <Stack className="memory-panel__disabled" align="center" py="xl" px="md">
          <Text className="memory-panel__disabled-text" size="sm" c="dimmed" ta="center">
            Memory 已关闭，AI 对话不会读取或保存记忆。
          </Text>
        </Stack>
      ) : (
      <ScrollArea className="memory-panel__scroll" style={{ flex: 1 }}>
        {loading ? (
          <Stack className="memory-panel__loading" align="center" py="xl">
            <Loader size="sm" />
          </Stack>
        ) : filtered.length === 0 ? (
          <Stack className="memory-panel__empty" align="center" py="xl">
            <Text className="memory-panel__empty-text" size="sm" c="dimmed">
              No memories yet. Chat with the AI to build project memory.
            </Text>
          </Stack>
        ) : (
          <Stack className="memory-panel__list" gap="xs" p="xs">
            {filtered.map(entry => (
              <div key={entry.id} className="memory-panel__entry">
                <Group className="memory-panel__entry-header" justify="space-between" wrap="nowrap">
                  <Group className="memory-panel__entry-meta" gap={4} wrap="nowrap">
                    <Badge
                      className="memory-panel__entry-type-badge"
                      size="xs"
                      variant="light"
                      color={MEMORY_TYPE_COLORS[entry.memoryType] ?? 'gray'}
                    >
                      {MEMORY_TYPE_LABELS[entry.memoryType] ?? entry.memoryType}
                    </Badge>
                    {isPinned(entry) && (
                      <IconPinFilled size={12} style={{ color: 'var(--mantine-color-blue-5)' }} />
                    )}
                  </Group>
                  <Group className="memory-panel__entry-actions" gap={2}>
                    <Tooltip label={isPinned(entry) ? 'Unpin' : 'Pin'}>
                      <ActionIcon
                        className="memory-panel__pin-btn"
                        variant="subtle"
                        size="xs"
                        onClick={() => void handlePin(entry)}
                      >
                        {isPinned(entry) ? <IconPinFilled size={12} /> : <IconPin size={12} />}
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Edit">
                      <ActionIcon
                        className="memory-panel__edit-btn"
                        variant="subtle"
                        size="xs"
                        onClick={() => {
                          setEditingEntry(entry)
                          setEditTitle(entry.title ?? '')
                          setEditSummary(entry.summaryText ?? '')
                        }}
                      >
                        <IconEdit size={12} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete">
                      <ActionIcon
                        className="memory-panel__delete-btn"
                        variant="subtle"
                        size="xs"
                        color="red"
                        onClick={() => void handleDelete(entry.id)}
                      >
                        <IconTrash size={12} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
                <Text className="memory-panel__entry-title" size="xs" fw={500} lineClamp={1}>
                  {entry.title || entry.summaryText || '(untitled)'}
                </Text>
                {entry.summaryText && entry.title && (
                  <Text className="memory-panel__entry-summary" size="xs" c="dimmed" lineClamp={2}>
                    {entry.summaryText}
                  </Text>
                )}
              </div>
            ))}
          </Stack>
        )}
      </ScrollArea>
      )}

      <Modal
        className="memory-panel__edit-modal"
        opened={!!editingEntry}
        onClose={() => setEditingEntry(null)}
        title="Edit Memory"
        size="sm"
      >
        <Stack className="memory-panel__edit-form" gap="sm">
          <TextInput
            className="memory-panel__edit-title-input"
            label="Title"
            value={editTitle}
            onChange={e => setEditTitle(e.currentTarget.value)}
          />
          <Textarea
            className="memory-panel__edit-summary-input"
            label="Content"
            value={editSummary}
            onChange={e => setEditSummary(e.currentTarget.value)}
            minRows={3}
          />
          <Group className="memory-panel__edit-actions" justify="flex-end">
            <Button className="memory-panel__edit-cancel" variant="subtle" size="xs" onClick={() => setEditingEntry(null)}>
              Cancel
            </Button>
            <Button className="memory-panel__edit-save" size="xs" onClick={() => void handleEditSave()}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>
          </PanelCard>
        )}
      </Transition>
    </div>
  )
}
