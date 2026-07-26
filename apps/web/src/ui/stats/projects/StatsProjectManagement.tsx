import React from 'react'
import { ActionIcon, Button, Divider, Group, Loader, Modal, Stack, Table, Text, TextInput, Tooltip, Title } from '@mantine/core'
import { IconPencil, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react'
import { deleteAdminProject, listAdminProjects, updateAdminProject, type AdminProjectDto } from '../../../api/server'
import { PanelCard } from '../../PanelCard'
import { toast } from '../../toast'

function formatTime(value?: string | null): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '—'
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return raw
  return new Date(t).toLocaleString()
}

function normalizeQuery(value: string): string {
  return String(value || '').trim().slice(0, 128)
}

export default function StatsProjectManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-projects', className].filter(Boolean).join(' ')

  const [q, setQ] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [items, setItems] = React.useState<AdminProjectDto[]>([])
  const [updatingIds, setUpdatingIds] = React.useState(() => new Set<string>())

  const [editOpen, setEditOpen] = React.useState(false)
  const [editId, setEditId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState('')
  const [editSubmitting, setEditSubmitting] = React.useState(false)

  const markUpdating = (projectId: string, next: boolean) => {
    setUpdatingIds((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(projectId); else copy.delete(projectId)
      return copy
    })
  }

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const next = await listAdminProjects({ q: normalizeQuery(q), limit: 500 })
      setItems(Array.isArray(next) ? next : [])
    } catch (err: unknown) {
      console.error('list admin projects failed', err)
      setItems([])
      toast(err instanceof Error && err.message ? err.message : '加载项目列表失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [q])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const openEdit = (p: AdminProjectDto) => {
    setEditId(p.id)
    setEditName(p.name || '')
    setEditOpen(true)
  }

  const submitEdit = async () => {
    const projectId = editId
    if (!projectId) return
    if (editSubmitting) return
    const name = editName.trim()
    if (!name) {
      toast('请输入项目名称', 'error')
      return
    }
    setEditSubmitting(true)
    try {
      const updated = await updateAdminProject(projectId, { name })
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      setEditOpen(false)
      toast('已保存', 'success')
    } catch (err: unknown) {
      console.error('rename project failed', err)
      toast(err instanceof Error && err.message ? err.message : '更新失败', 'error')
    } finally {
      setEditSubmitting(false)
    }
  }

  const onDeleteProject = async (p: AdminProjectDto) => {
    if (!p?.id) return
    if (updatingIds.has(p.id)) return
    if (!window.confirm(`确定删除项目「${p.name}」？删除后该项目下的 flows / versions 也会被删除（不可恢复）。`)) return
    markUpdating(p.id, true)
    try {
      await deleteAdminProject(p.id)
      toast('已删除', 'success')
      await reload()
    } catch (err: unknown) {
      console.error('delete project failed', err)
      toast(err instanceof Error && err.message ? err.message : '删除失败', 'error')
    } finally {
      markUpdating(p.id, false)
    }
  }

  return (
    <PanelCard className={rootClassName}>
      <Group className="stats-projects-header" justify="space-between" align="center">
        <Stack className="stats-projects-header-left" gap={2}>
          <Title className="stats-projects-title" order={4}>项目管理</Title>
          <Text className="stats-projects-subtitle" size="xs" c="dimmed">管理所有用户项目</Text>
        </Stack>
        <Group className="stats-projects-header-right" gap={8} align="center" wrap="wrap" justify="flex-end">
          <TextInput
            className="stats-projects-search"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            placeholder="搜索项目名 / owner / projectId"
            leftSection={<IconSearch className="stats-projects-search-icon" size={14} />}
            w={260}
          />
          <Tooltip className="stats-projects-refresh-tooltip" label="刷新" withArrow>
            <ActionIcon className="stats-projects-refresh" size="sm" variant="subtle" aria-label="刷新" onClick={() => void reload()} loading={loading}>
              <IconRefresh className="stats-projects-refresh-icon" size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Divider className="stats-projects-divider" my="sm" />

      {loading ? (
        <Group className="stats-projects-loading" justify="center" py="xl">
          <Loader className="stats-projects-loading-icon" size="sm" />
          <Text className="stats-projects-loading-text" size="sm" c="dimmed">加载中…</Text>
        </Group>
      ) : (
        <Stack className="stats-projects-body" gap="sm">
          <Group className="stats-projects-meta" justify="space-between" align="center">
            <Text className="stats-projects-count" size="xs" c="dimmed">共 {items.length} 个项目</Text>
            <Button className="stats-projects-reload" size="xs" variant="light" onClick={() => void reload()}>重新加载</Button>
          </Group>

          <div className="stats-projects-table-wrap" style={{ overflowX: 'auto' }}>
            <Table className="stats-projects-table" striped highlightOnHover withTableBorder withColumnBorders>
              <Table.Thead className="stats-projects-table-head">
                <Table.Tr className="stats-projects-table-head-row">
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 260 }}>项目</Table.Th>
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 220 }}>Owner</Table.Th>
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 90 }}>Flows</Table.Th>
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 190 }}>更新时间</Table.Th>
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 190 }}>创建时间</Table.Th>
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 220 }}>ID</Table.Th>
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 140 }}>操作</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="stats-projects-table-body">
                {items.length === 0 ? (
                  <Table.Tr className="stats-projects-table-row-empty">
                    <Table.Td className="stats-projects-table-cell-empty" colSpan={7}>
                      <Text className="stats-projects-empty" size="sm" c="dimmed">暂无项目</Text>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  items.map((p) => {
                    const busy = updatingIds.has(p.id)
                    const ownerLabel = String((p.owner || '').trim() || (p.ownerId || '').trim() || '—')
                    const ownerName = String((p.ownerName || '').trim() || '')
                    return (
                      <Table.Tr className="stats-projects-table-row" key={p.id}>
                        <Table.Td className="stats-projects-table-cell">
                          <Text className="stats-projects-project-name" size="sm" fw={600} lineClamp={1}>{p.name || '—'}</Text>
                        </Table.Td>
                        <Table.Td className="stats-projects-table-cell">
                          <Stack className="stats-projects-owner" gap={0}>
                            <Text className="stats-projects-owner-login" size="sm">{ownerLabel}</Text>
                            <Text className="stats-projects-owner-name" size="xs" c="dimmed">{ownerName || '—'}</Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td className="stats-projects-table-cell">
                          <Text className="stats-projects-flows" size="sm">{Number(p.flowCount ?? 0) || 0}</Text>
                        </Table.Td>
                        <Table.Td className="stats-projects-table-cell">
                          <Text className="stats-projects-updated" size="sm" c="dimmed">{formatTime(p.updatedAt)}</Text>
                        </Table.Td>
                        <Table.Td className="stats-projects-table-cell">
                          <Text className="stats-projects-created" size="sm" c="dimmed">{formatTime(p.createdAt)}</Text>
                        </Table.Td>
                        <Table.Td className="stats-projects-table-cell">
                          <Text className="stats-projects-id" size="xs" c="dimmed">{p.id}</Text>
                        </Table.Td>
                        <Table.Td className="stats-projects-table-cell">
                          <Group className="stats-projects-actions" gap={6} justify="flex-end" wrap="nowrap">
                            <Tooltip className="stats-projects-action-tooltip" label="重命名" withArrow>
                              <ActionIcon className="stats-projects-action" size="sm" variant="subtle" aria-label="重命名" onClick={() => openEdit(p)} disabled={busy}>
                                <IconPencil className="stats-projects-action-icon" size={14} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip className="stats-projects-action-tooltip" label="删除" withArrow>
                              <ActionIcon className="stats-projects-action stats-projects-action-delete" size="sm" variant="subtle" color="red" aria-label="删除" onClick={() => void onDeleteProject(p)} disabled={busy} loading={busy}>
                                <IconTrash className="stats-projects-action-icon" size={14} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    )
                  })
                )}
              </Table.Tbody>
            </Table>
          </div>
        </Stack>
      )}

      <Modal
        className="stats-projects-edit-modal"
        opened={editOpen}
        onClose={() => setEditOpen(false)}
        title="重命名项目"
        centered
        radius="md"
        lockScroll={false}
      >
        <Stack className="stats-projects-edit-modal-body" gap="sm">
          <TextInput
            className="stats-projects-edit-name"
            label="项目名称"
            placeholder="输入新的项目名称"
            value={editName}
            onChange={(e) => setEditName(e.currentTarget.value)}
            maxLength={200}
          />
          <Group className="stats-projects-edit-actions" justify="flex-end" gap={8}>
            <Button className="stats-projects-edit-cancel" variant="subtle" onClick={() => setEditOpen(false)}>取消</Button>
            <Button className="stats-projects-edit-save" onClick={() => void submitEdit()} loading={editSubmitting}>保存</Button>
          </Group>
        </Stack>
      </Modal>
    </PanelCard>
  )
}
