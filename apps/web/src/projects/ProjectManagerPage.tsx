import React from 'react'
import {
  AppShell,
  Group,
  Title,
  ActionIcon,
  Box,
  Text,
  Stack,
  TextInput,
  Button,
  Modal,
  Menu,
  Checkbox,
  Pagination,
} from '@mantine/core'
import {
  IconArrowLeft,
  IconFilePlus,
  IconSearch,
  IconLayoutGrid,
  IconDots,
  IconTrash,
  IconEdit,
  IconPhoto,
  IconX,
} from '@tabler/icons-react'
import { useAuth } from '../auth/store'
import {
  listProjectFlows,
  listProjects,
  saveProjectFlow,
  upsertProject,
  deleteProject,
  type FlowDto,
  type ProjectDto,
} from '../api/server'
import { buildStudioUrl } from '../utils/appRoutes'
import { spaNavigate } from '../utils/spaNavigate'
import ProjectAssetsViewer from './ProjectAssetsViewer'
import { toast } from '../ui/toast'
import { PanelCard } from '../ui/PanelCard'
import { normalizeProjectCanvasOwnerType, pickProjectEntryFlow } from './projectCanvasEntry'
import { markSkipNextProjectFlowLoad } from './skipProjectFlowLoad'
import { useUIStore } from '../ui/uiStore'
import { useRFStore } from '../canvas/store'
import './projectManager.css'

type CreateProjectStage = 'idle' | 'creating-project' | 'creating-canvas'

type ProjectEntryCard = {
  project: ProjectDto
  flowCount: number
  recentFlow: FlowDto | null
}

function getCreateProjectStageLabel(stage: CreateProjectStage): string {
  if (stage === 'creating-project') return '正在创建项目…'
  if (stage === 'creating-canvas') return '正在创建默认画布…'
  return ''
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return fallback
}

function parseProjectIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const u = new URL(window.location.href)
    const pid = u.searchParams.get('projectId')
    return pid ? String(pid) : null
  } catch {
    return null
  }
}

const PAGE_SIZE = 24

function parsePageFromUrl(): number {
  if (typeof window === 'undefined') return 1
  try {
    const u = new URL(window.location.href)
    const raw = u.searchParams.get('page')
    if (!raw) return 1
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n >= 1 ? n : 1
  } catch {
    return 1
  }
}

function formatRelativeUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return ''
  const diffMs = Date.now() - ts
  if (diffMs < 0) return '刚刚更新'
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return '刚刚更新'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前更新`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前更新`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前更新`
  const month = Math.floor(day / 30)
  if (month < 12) return `${month} 个月前更新`
  const year = Math.floor(month / 12)
  return `${year} 年前更新`
}

function getCardUpdatedAt(card: ProjectEntryCard): number {
  const ts = Date.parse(String(card.recentFlow?.updatedAt || card.project.updatedAt || ''))
  return Number.isFinite(ts) ? ts : 0
}

export default function ProjectManagerPage(): JSX.Element {
  const auth = useAuth()
  const [projectEntryCards, setProjectEntryCards] = React.useState<ProjectEntryCard[]>([])
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [createOpen, setCreateOpen] = React.useState(false)
  const [nameDraft, setNameDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [createStage, setCreateStage] = React.useState<CreateProjectStage>('idle')
  const [createError, setCreateError] = React.useState<string>('')
  const [renameBusy, setRenameBusy] = React.useState(false)
  const [renameProjectId, setRenameProjectId] = React.useState<string | null>(null)
  const [renameDraft, setRenameDraft] = React.useState('')
  const [assetsViewerProject, setAssetsViewerProject] = React.useState<{ id: string; name: string } | null>(null)
  const [focusedProjectId, setFocusedProjectId] = React.useState<string | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = React.useState<number>(() => parsePageFromUrl())
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false)
  const [bulkDeleteBusy, setBulkDeleteBusy] = React.useState(false)
  const [bulkDeleteProgress, setBulkDeleteProgress] = React.useState<{ done: number; total: number; failed: number }>({ done: 0, total: 0, failed: 0 })
  const lastClickedIndexRef = React.useRef<number>(-1)
  const lastShiftKeyRef = React.useRef<boolean>(false)

  React.useEffect(() => {
    if (!auth.user) {
      setProjectEntryCards([])
      setLoadError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError('')
    listProjects()
      .then(async (projects) => {
        const cards = await Promise.all(
          projects.map(async (project) => {
            const flows = await listProjectFlows(project.id)
            const recentFlow = pickProjectEntryFlow(flows)
            return {
              project,
              flowCount: flows.length,
              recentFlow,
            }
          }),
        )
        if (cancelled) return
        cards.sort((left, right) => getCardUpdatedAt(right) - getCardUpdatedAt(left))
        setProjectEntryCards(cards)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('加载项目列表失败', error)
        setLoadError(resolveErrorMessage(error, '项目列表加载失败，请稍后重试'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [auth.user?.sub])

  React.useEffect(() => {
    if (!auth.user) return
    const syncFocusedProjectId = () => {
      const pid = parseProjectIdFromUrl()
      setFocusedProjectId(pid && pid.trim() ? pid.trim() : null)
    }
    syncFocusedProjectId()
    window.addEventListener('popstate', syncFocusedProjectId)
    return () => {
      window.removeEventListener('popstate', syncFocusedProjectId)
    }
  }, [auth.user?.sub])

  const filteredCards = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projectEntryCards
    return projectEntryCards.filter((item) => {
      const name = item.project.name.toLowerCase()
      const id = item.project.id.toLowerCase()
      return name.includes(q) || id.includes(q)
    })
  }, [projectEntryCards, query])

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE))
  const safePage = Math.min(Math.max(1, currentPage), totalPages)
  const pagedCards = React.useMemo(
    () => filteredCards.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredCards, safePage],
  )

  React.useEffect(() => {
    setCurrentPage(1)
    lastClickedIndexRef.current = -1
  }, [query])

  React.useEffect(() => {
    if (currentPage !== safePage) {
      setCurrentPage(safePage)
      return
    }
    if (typeof window === 'undefined') return
    try {
      const u = new URL(window.location.href)
      const beforeSearch = u.search
      if (safePage <= 1) u.searchParams.delete('page')
      else u.searchParams.set('page', String(safePage))
      if (u.search !== beforeSearch) {
        window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash)
      }
    } catch {}
  }, [currentPage, safePage])

  const visibleSelectedCount = React.useMemo(
    () => pagedCards.reduce((acc, c) => acc + (selectedIds.has(c.project.id) ? 1 : 0), 0),
    [pagedCards, selectedIds],
  )
  const allVisibleSelected = pagedCards.length > 0 && visibleSelectedCount === pagedCards.length

  const toggleSelected = React.useCallback(
    (id: string, indexOnPage: number, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (shiftKey && lastClickedIndexRef.current >= 0 && lastClickedIndexRef.current < pagedCards.length) {
          const start = Math.min(lastClickedIndexRef.current, indexOnPage)
          const end = Math.max(lastClickedIndexRef.current, indexOnPage)
          const targetState = !prev.has(id)
          for (let i = start; i <= end; i++) {
            const card = pagedCards[i]
            if (!card) continue
            if (targetState) next.add(card.project.id)
            else next.delete(card.project.id)
          }
        } else if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        return next
      })
      lastClickedIndexRef.current = indexOnPage
    },
    [pagedCards],
  )

  const toggleSelectAllOnPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) pagedCards.forEach((c) => next.delete(c.project.id))
      else pagedCards.forEach((c) => next.add(c.project.id))
      return next
    })
  }

  const exitSelection = () => {
    setSelectedIds(new Set())
    lastClickedIndexRef.current = -1
  }

  const openCreate = () => {
    setNameDraft('')
    setCreateStage('idle')
    setCreateError('')
    setCreateOpen(true)
  }

  const openProject = (card: ProjectEntryCard) => {
    spaNavigate(buildStudioUrl({ projectId: card.project.id, flowId: card.recentFlow?.id }))
  }

  const handleCreate = async () => {
    const name = nameDraft.trim()
    if (!name) return
    if (busy) return
    setBusy(true)
    setCreateError('')
    try {
      setCreateStage('creating-project')
      const p = await upsertProject({ name })

      try {
        setCreateStage('creating-canvas')
        const flow = await saveProjectFlow({
          projectId: p.id,
          name: p.name || name,
          nodes: [],
          edges: [],
          allowEmptyGraphOverwrite: true,
        })
        setProjectEntryCards((prev) => [
          { project: p, flowCount: 1, recentFlow: flow },
          ...prev.filter((item) => item.project.id !== p.id),
        ])

        const uiStore = useUIStore.getState()
        markSkipNextProjectFlowLoad(p.id)
        useRFStore.setState({ nodes: [], edges: [], nextId: 1, nextGroupId: 1 })
        uiStore.setPendingInitialView(null)
        uiStore.restoreCreationSession(null)
        uiStore.setCurrentProject({ id: p.id, name: p.name })
        uiStore.setCurrentFlow({
          id: flow.id,
          name: flow.name || p.name || name,
          source: 'server',
          ownerType: normalizeProjectCanvasOwnerType(flow.ownerType) || 'project',
          ownerId: flow.ownerId || p.id,
          updatedAt: flow.updatedAt,
        })
        uiStore.setDirty(false)

        setCreateStage('idle')
        setCreateOpen(false)
        toast('项目已创建。', 'success')
        spaNavigate(buildStudioUrl({ projectId: p.id, flowId: flow.id }))
      } catch (flowError) {
        const message = resolveErrorMessage(flowError, '默认画布创建失败')
        console.error('创建项目默认画布失败', flowError)
        setProjectEntryCards((prev) => [
          { project: p, flowCount: 0, recentFlow: null },
          ...prev.filter((item) => item.project.id !== p.id),
        ])
        useRFStore.setState({ nodes: [], edges: [], nextId: 1, nextGroupId: 1 })
        useUIStore.getState().setCurrentProject({ id: p.id, name: p.name })
        setCreateStage('idle')
        setCreateOpen(false)
        toast(`项目“${p.name}”已创建，但画布创建失败：${message}。进入后会再次尝试创建默认画布。`, 'warning')
        spaNavigate(buildStudioUrl({ projectId: p.id }))
      }
    } catch (error) {
      const message = resolveErrorMessage(error, '创建项目失败，请稍后重试')
      console.error('创建项目失败', error)
      setCreateStage('idle')
      setCreateError(message)
    } finally {
      setCreateStage('idle')
      setBusy(false)
    }
  }

  const startRename = (projectId: string, currentName: string) => {
    setRenameProjectId(projectId)
    setRenameDraft(currentName)
  }

  const commitRename = async () => {
    if (!renameProjectId) return
    const nextName = renameDraft.trim()
    if (!nextName) return
    if (renameBusy) return
    setRenameBusy(true)
    try {
      const updated = await upsertProject({ id: renameProjectId, name: nextName })
      setProjectEntryCards((prev) =>
        prev.map((item) =>
          item.project.id === renameProjectId
            ? { ...item, project: { ...item.project, name: updated.name } }
            : item,
        ),
      )
      setRenameProjectId(null)
      setRenameDraft('')
    } catch (error) {
      console.error('重命名失败', error)
      toast(resolveErrorMessage(error, '重命名失败，请稍后重试'), 'error')
    } finally {
      setRenameBusy(false)
    }
  }

  const handleDelete = async (projectId: string, name: string) => {
    const ok = window.confirm(`删除项目「${name}」？（会删除项目及其数据）`)
    if (!ok) return
    try {
      await deleteProject(projectId)
      setProjectEntryCards((prev) => prev.filter((item) => item.project.id !== projectId))
      setSelectedIds((prev) => {
        if (!prev.has(projectId)) return prev
        const next = new Set(prev)
        next.delete(projectId)
        return next
      })
      const pidFromUrl = parseProjectIdFromUrl()
      if (pidFromUrl && pidFromUrl === projectId) {
        spaNavigate('/projects')
      }
    } catch (error) {
      console.error('删除项目失败', error)
      toast(resolveErrorMessage(error, '删除项目失败，请稍后重试'), 'error')
    }
  }

  const selectedProjectsInfo = React.useMemo(() => {
    const idToName = new Map<string, string>()
    for (const c of projectEntryCards) idToName.set(c.project.id, c.project.name)
    const items: Array<{ id: string; name: string }> = []
    for (const id of selectedIds) items.push({ id, name: idToName.get(id) || id })
    return items
  }, [projectEntryCards, selectedIds])

  const handleBulkDeleteConfirm = async () => {
    if (bulkDeleteBusy) return
    const ids = selectedProjectsInfo.map((it) => it.id)
    if (ids.length === 0) return
    setBulkDeleteBusy(true)
    setBulkDeleteProgress({ done: 0, total: ids.length, failed: 0 })
    let failed = 0
    const remainingFailed = new Set<string>()
    const pidFromUrl = parseProjectIdFromUrl()
    for (let i = 0; i < ids.length; i++) {
      const pid = ids[i]
      try {
        await deleteProject(pid)
        setProjectEntryCards((prev) => prev.filter((item) => item.project.id !== pid))
      } catch (err) {
        console.error('批量删除：删除项目失败', pid, err)
        failed += 1
        remainingFailed.add(pid)
        const info = selectedProjectsInfo.find((it) => it.id === pid)
        toast(resolveErrorMessage(err, `删除「${info?.name || pid}」失败`), 'error')
      }
      setBulkDeleteProgress({ done: i + 1, total: ids.length, failed })
    }
    setSelectedIds(remainingFailed)
    lastClickedIndexRef.current = -1
    setBulkDeleteBusy(false)
    setBulkDeleteOpen(false)
    const successCount = ids.length - failed
    if (successCount > 0 && failed === 0) toast(`已删除 ${successCount} 个项目。`, 'success')
    else if (successCount > 0 && failed > 0) toast(`已删除 ${successCount} 个，失败 ${failed} 个。`, 'warning')
    if (pidFromUrl && ids.includes(pidFromUrl) && !remainingFailed.has(pidFromUrl)) {
      spaNavigate('/projects')
    }
  }

  const totalCount = projectEntryCards.length
  const showEmptyState = !loading && !loadError && filteredCards.length === 0
  const isFirstRunEmpty = totalCount === 0 && !query.trim()

  return (
    <AppShell className="tc-pm__shell" header={{ height: 56 }} padding={0}>
      <AppShell.Header className="tc-pm__header">
        <Group className="tc-pm__header-inner" justify="space-between" h="100%" px={16}>
          <Group className="tc-pm__header-left" gap={10}>
            <ActionIcon
              className="tc-pm__back"
              variant="subtle"
              onClick={() => spaNavigate(buildStudioUrl())}
              aria-label="返回画布"
            >
              <IconArrowLeft className="tc-pm__back-icon" size={18} />
            </ActionIcon>
            <Title className="tc-pm__title" order={3}>
              项目
              <Text component="span" className="tc-pm__title-count" size="sm" c="dimmed" ml={8}>
                · {loading ? '同步中' : `${totalCount} 个`}
              </Text>
            </Title>
          </Group>

          <Group className="tc-pm__header-right" gap={10}>
            {selectedIds.size > 0 ? (
              <Group className="tc-pm__selection-bar" gap={8}>
                <Text className="tc-pm__selection-count" size="sm">
                  已选 {selectedIds.size} 项
                </Text>
                <Button
                  className="tc-pm__selection-all"
                  variant="subtle"
                  size="xs"
                  onClick={toggleSelectAllOnPage}
                  disabled={pagedCards.length === 0}
                >
                  {allVisibleSelected ? '取消全选当前页' : '全选当前页'}
                </Button>
                <Button
                  className="tc-pm__selection-delete"
                  color="red"
                  size="xs"
                  leftSection={<IconTrash size={14} />}
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  批量删除
                </Button>
                <ActionIcon
                  className="tc-pm__selection-exit"
                  variant="subtle"
                  size="md"
                  aria-label="退出多选"
                  onClick={exitSelection}
                >
                  <IconX size={16} />
                </ActionIcon>
              </Group>
            ) : (
              <>
                <TextInput
                  className="tc-pm__search"
                  value={query}
                  onChange={(e) => setQuery(e.currentTarget.value)}
                  leftSection={<IconSearch className="tc-pm__search-icon" size={14} />}
                  placeholder="搜索项目"
                  size="sm"
                  w={280}
                />
                <Button
                  className="tc-pm__new-project"
                  variant="filled"
                  size="sm"
                  leftSection={<IconFilePlus className="tc-pm__new-project-icon" size={14} />}
                  onClick={openCreate}
                  data-tour="project-manager-create"
                >
                  新建项目
                </Button>
              </>
            )}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main className="tc-pm__main">
        <div className="tc-pm__content">
          {loadError ? (
            <PanelCard className="tc-pm__load-error-card" padding="compact">
              <Text className="tc-pm__load-error" size="sm" c="red">{loadError}</Text>
            </PanelCard>
          ) : null}

          {!loadError && !showEmptyState ? (
            <div className="tc-pm__grid" data-tour="project-manager-grid">
              {pagedCards.map((card, idx) => {
                const isFocused = focusedProjectId === card.project.id
                const isSelected = selectedIds.has(card.project.id)
                return (
                  <PanelCard
                    className={['tc-pm__card', isFocused ? 'is-focused' : '', isSelected ? 'is-selected' : ''].filter(Boolean).join(' ')}
                    key={card.project.id}
                    role="button"
                    tabIndex={0}
                    onClick={(event: React.MouseEvent<HTMLDivElement>) => {
                      const target = event.target as HTMLElement
                      if (target.closest('.tc-pm__card-menu-area')) return
                      if (target.closest('.tc-pm__card-checkbox-area')) return
                      openProject(card)
                    }}
                    onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openProject(card)
                      }
                    }}
                  >
                    <div className="tc-pm__card-row">
                      <div
                        className="tc-pm__card-checkbox-area"
                        onMouseDown={(e) => {
                          lastShiftKeyRef.current = e.shiftKey
                          e.stopPropagation()
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          className="tc-pm__card-checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelected(card.project.id, idx, lastShiftKeyRef.current)}
                          aria-label={`选择项目 ${card.project.name}`}
                        />
                      </div>
                      <div className="tc-pm__card-left">
                        <div className="tc-pm__card-icon-wrap">
                          <IconLayoutGrid className="tc-pm__node-icon tc-pm__node-icon--project" size={16} />
                        </div>
                        <div className="tc-pm__card-meta">
                          <div className="tc-pm__card-title">{card.project.name}</div>
                          <div className="tc-pm__card-sub">
                            {card.flowCount > 0 ? `${card.flowCount} 个画布` : '将创建默认画布'}
                            {(() => {
                              const rel = formatRelativeUpdatedAt(
                                card.recentFlow?.updatedAt || card.project.updatedAt,
                              )
                              return rel ? ` · ${rel}` : ''
                            })()}
                          </div>
                        </div>
                      </div>
                      <div className="tc-pm__card-menu-area">
                        <Menu
                          classNames={{
                            dropdown: 'tc-pm__card-menu-dropdown',
                            item: 'tc-pm__card-menu-item',
                          }}
                          withinPortal
                          position="bottom-end"
                          withArrow
                          shadow="md"
                        >
                          <Menu.Target>
                            <ActionIcon
                              className="tc-pm__card-menu"
                              variant="subtle"
                              aria-label="项目菜单"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <IconDots className="tc-pm__card-menu-icon" size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
                            <Menu.Item
                              leftSection={<IconPhoto className="tc-pm__menu-icon" size={14} />}
                              onClick={() =>
                                setAssetsViewerProject({ id: card.project.id, name: card.project.name })
                              }
                            >
                              项目素材
                            </Menu.Item>
                            <Menu.Item
                              leftSection={<IconEdit className="tc-pm__menu-icon" size={14} />}
                              onClick={() => startRename(card.project.id, card.project.name)}
                            >
                              重命名
                            </Menu.Item>
                            <Menu.Item
                              className="tc-pm__card-menu-item--danger"
                              color="red"
                              leftSection={<IconTrash className="tc-pm__menu-icon" size={14} />}
                              onClick={() => void handleDelete(card.project.id, card.project.name)}
                            >
                              删除
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </div>
                    </div>
                  </PanelCard>
                )
              })}
            </div>
          ) : null}

          {!loadError && !showEmptyState && filteredCards.length > PAGE_SIZE ? (
            <div className="tc-pm__pagination">
              <Text className="tc-pm__pagination-summary" size="xs" c="dimmed">
                共 {filteredCards.length} 项 · 第 {safePage} / {totalPages} 页
              </Text>
              <Pagination
                className="tc-pm__pagination-control"
                total={totalPages}
                value={safePage}
                onChange={setCurrentPage}
                size="sm"
                withEdges
              />
            </div>
          ) : null}

          {showEmptyState ? (
            <div className="tc-pm__empty">
              <Text className="tc-pm__empty-title">
                {isFirstRunEmpty ? '先创建第一个项目' : '没有匹配的项目'}
              </Text>
              <Text className="tc-pm__empty-sub" c="dimmed" size="sm">
                {isFirstRunEmpty
                  ? '项目隔离上下文、素材和 agent 运行记录。'
                  : '换一个关键词或清空搜索条件。'}
              </Text>
              {isFirstRunEmpty ? (
                <Group justify="center" mt="md">
                  <Button
                    className="tc-pm__empty-create-project-button"
                    size="sm"
                    onClick={openCreate}
                    leftSection={<IconFilePlus size={14} />}
                  >
                    新建项目
                  </Button>
                </Group>
              ) : null}
            </div>
          ) : null}
        </div>

        <Modal
          className="tc-pm__modal"
          opened={createOpen}
          onClose={() => setCreateOpen(false)}
          title="新建项目"
          centered
        >
          <Stack className="tc-pm__modal-stack" gap="sm">
            <TextInput
              className="tc-pm__modal-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.currentTarget.value)}
              label="项目名称"
              placeholder="请输入项目名称"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate()
              }}
            />
            <Text size="sm" c="dimmed">
              创建后会初始化一个默认画布，并进入多模态 agent 工作区。
            </Text>
            {busy && createStage !== 'idle' ? (
              <Text size="sm" c="dimmed">{getCreateProjectStageLabel(createStage)}</Text>
            ) : null}
            {createError ? (
              <Text size="sm" c="red">{createError}</Text>
            ) : null}
            <Group className="tc-pm__modal-actions" justify="flex-end">
              <Button className="tc-pm__modal-cancel" variant="subtle" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button
                className="tc-pm__modal-create"
                onClick={() => void handleCreate()}
                loading={busy}
                disabled={!nameDraft.trim()}
              >
                创建并进入画布
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal
          className="tc-pm__modal"
          opened={Boolean(renameProjectId)}
          onClose={() => setRenameProjectId(null)}
          title="重命名"
          centered
        >
          <Stack className="tc-pm__modal-stack" gap="sm">
            <TextInput
              className="tc-pm__modal-input"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename()
              }}
            />
            <Group className="tc-pm__modal-actions" justify="flex-end">
              <Button className="tc-pm__modal-cancel" variant="subtle" onClick={() => setRenameProjectId(null)}>取消</Button>
              <Button
                className="tc-pm__modal-create"
                onClick={() => void commitRename()}
                loading={renameBusy}
                disabled={!renameDraft.trim() || renameBusy}
              >
                保存
              </Button>
            </Group>
          </Stack>
        </Modal>

        <ProjectAssetsViewer
          opened={Boolean(assetsViewerProject)}
          projectId={assetsViewerProject?.id || ''}
          projectName={assetsViewerProject?.name || ''}
          onClose={() => setAssetsViewerProject(null)}
        />

        <Modal
          className="tc-pm__modal tc-pm__bulk-delete-modal"
          opened={bulkDeleteOpen}
          onClose={() => { if (!bulkDeleteBusy) setBulkDeleteOpen(false) }}
          title={`删除 ${selectedProjectsInfo.length} 个项目？`}
          centered
          closeOnClickOutside={!bulkDeleteBusy}
          closeOnEscape={!bulkDeleteBusy}
          withCloseButton={!bulkDeleteBusy}
        >
          <Stack className="tc-pm__modal-stack" gap="sm">
            <Text size="sm" c="dimmed">
              将删除以下项目及其全部画布数据，此操作不可恢复。
            </Text>
            <ul className="tc-pm__bulk-delete-list">
              {selectedProjectsInfo.slice(0, 10).map((it) => (
                <li key={it.id} className="tc-pm__bulk-delete-list-item">{it.name}</li>
              ))}
              {selectedProjectsInfo.length > 10 ? (
                <li className="tc-pm__bulk-delete-list-more">…还有 {selectedProjectsInfo.length - 10} 个</li>
              ) : null}
            </ul>
            {bulkDeleteBusy ? (
              <Text size="sm" c="dimmed">
                正在删除 {bulkDeleteProgress.done} / {bulkDeleteProgress.total}
                {bulkDeleteProgress.failed > 0 ? `（失败 ${bulkDeleteProgress.failed}）` : ''}…
              </Text>
            ) : null}
            <Group className="tc-pm__modal-actions" justify="flex-end">
              <Button
                className="tc-pm__modal-cancel"
                variant="subtle"
                onClick={() => setBulkDeleteOpen(false)}
                disabled={bulkDeleteBusy}
              >
                取消
              </Button>
              <Button
                className="tc-pm__modal-bulk-delete"
                color="red"
                onClick={() => void handleBulkDeleteConfirm()}
                loading={bulkDeleteBusy}
                disabled={bulkDeleteBusy || selectedProjectsInfo.length === 0}
              >
                确认删除
              </Button>
            </Group>
          </Stack>
        </Modal>
      </AppShell.Main>
    </AppShell>
  )
}
