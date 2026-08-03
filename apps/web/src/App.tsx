import React from 'react'
import { AppShell, ActionIcon, Group, Box, Button, TextInput, Badge, Text, useMantineColorScheme, Tooltip, Modal, Stack } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconBrandGithub, IconMoonStars, IconSun, IconHelpCircle, IconRefresh, IconCamera, IconMessageCircle } from '@tabler/icons-react'
import Canvas from './canvas/Canvas'
import { sanitizeGraphForCanvas, useRFStore } from './canvas/store'
import { SnapshotProgressDialog, useSnapshotExport } from './canvas/snapshot/SnapshotProgressDialog'
import './styles.css'
import KeyboardShortcuts from './KeyboardShortcuts'
import { applyTemplate, captureCurrentSelection, deleteTemplate, listTemplateNames, saveTemplate, renameTemplate } from './templates'
import { ToastHost, toast } from './ui/toast'
import {
  serializeCreationSessionForPersistence,
  useUIStore,
} from './ui/uiStore'
import {
  saveProjectFlow,
  listProjects,
  listProjectFlows,
  getServerFlow,
  upsertProject,
  type FlowDto,
  type ProjectDto,
} from './api/server'
import { FLOW_SNAPSHOT_STALE_MESSAGE, isFlowSnapshotStaleError } from './api/flowSaveGuard'
import { useAuth } from './auth/store'
import { $, $t } from './canvas/i18n'
import SubflowEditor from './subflow/Editor'
import LibraryEditor from './flows/LibraryEditor'
import { listFlows, saveFlow, deleteFlow as deleteLibraryFlow, renameFlow, scanCycles } from './flows/registry'
import FloatingNav from './ui/FloatingNav'
import BodyPortal from './ui/BodyPortal'
import AddNodePanel from './ui/AddNodePanel'
import AssetCenterPanel from './ui/AssetCenterPanel'
import ProjectPanel from './ui/ProjectPanel'
import PendingUploadsBar from './ui/PendingUploadsBar'
import { WebCutVideoEditModalHost } from './ui/WebCutVideoEditModalHost'
import ModelPanel from './ui/ModelPanel'
import HistoryPanel from './ui/HistoryPanel'
import { useDeferredSilentSave } from './ui/hooks/useDeferredSilentSave'
import MemoryPanel from './ui/memory/MemoryPanel'
import ParamModal from './ui/ParamModal'
import PreviewModal from './ui/PreviewModal'
import AiChatDialog from './ui/chat/AiChatDialog'
import { AgentWorkspace } from './product-host/AgentWorkspace'
import { runNodeRemote } from './runner/remoteRunner'
import { Background } from '@xyflow/react'
import { FeatureTour, type FeatureTourStep } from './ui/tour/FeatureTour'
import ProjectManagerPage from './projects/ProjectManagerPage'
import ProjectDefaultEntryRedirectPage from './projects/ProjectDefaultEntryRedirectPage'
import {
  isCurrentFlowScopedToProjectTarget,
  isRequestedProjectFlowMissing,
  normalizeProjectCanvasOwnerType,
  pickProjectEntryFlow,
  resolveStudioProjectSelection,
  resolveRequestedProjectFlowIdForLoad,
} from './projects/projectCanvasEntry'
import { consumeSkipProjectFlowLoad, markSkipNextProjectFlowLoad } from './projects/skipProjectFlowLoad'
import HomePage from './ui/HomePage'
import ProjectIdentityCell from './ui/ProjectIdentityCell'
import { hasPendingUploads } from './ui/pendingUploadGuard'
import { buildStudioUrl, isGithubOauthCallbackRoute, isStudioRoute, type StudioOwnerType } from './utils/appRoutes'
import { spaReplace } from './utils/spaNavigate'
import { preloadModelOptions } from './config/useModelOptions'
import CanvasEmptyGuide from './ui/CanvasEmptyGuide'
import type { VerticalBrand, VerticalExtensionDescriptor } from './product-host/productHost'
import {
  dispatchProductWorkspaceCommand,
  PRODUCT_WORKSPACE_COMMAND,
  type ProductWorkspaceCommand,
} from './product-host/productWorkspace'

const FEATURE_TOUR_VERSION = 'v2'


type CanvasGlobalWindow = Window & {
  __tcAutoResumedTaskNodes?: Set<string>
  silentSaveProject?: () => Promise<void>
  __tcFocusNode?: (id: string) => void
}

function isEmptyGraphSnapshot(payload: { nodes: readonly unknown[]; edges: readonly unknown[] }): boolean {
  return payload.nodes.length === 0 && payload.edges.length === 0
}

function confirmEmptyGraphOverwrite(flowName: string): boolean {
  if (typeof window === 'undefined') return false
  const normalizedName = flowName.trim() || '当前流程'
  return window.confirm(`当前画布为空。继续保存会清空服务端流程「${normalizedName}」中的所有节点和连线。确认保存空画布？`)
}

function confirmServerCanvasRefresh(flowName: string): boolean {
  if (typeof window === 'undefined') return false
  const normalizedName = flowName.trim() || '当前流程'
  return window.confirm(`当前画布有未保存修改。刷新会用服务端流程「${normalizedName}」覆盖本地画布。确认刷新？`)
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return fallback
}

type StudioOwnerContext = {
  ownerType: StudioOwnerType
  ownerId: string
}

function readStudioOwnerContext(): StudioOwnerContext | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    const ownerTypeRaw = String(url.searchParams.get('ownerType') || '').trim()
    const ownerType =
      ownerTypeRaw === 'chapter' || ownerTypeRaw === 'shot' || ownerTypeRaw === 'project'
        ? ownerTypeRaw
        : null
    const ownerId = String(url.searchParams.get('ownerId') || '').trim()
    if (!ownerType || !ownerId) return null
    return { ownerType, ownerId }
  } catch {
    return null
  }
}

function readStudioFlowId(): string {
  if (typeof window === 'undefined') return ''
  try {
    return String(new URL(window.location.href).searchParams.get('flowId') || '').trim()
  } catch {
    return ''
  }
}

function readStudioProjectId(): string {
  if (typeof window === 'undefined') return ''
  try {
    return String(new URL(window.location.href).searchParams.get('projectId') || '').trim()
  } catch {
    return ''
  }
}

function CanvasApp({
  routeKey,
  initialSurface = 'canvas',
  productBrand = { name: 'JarvisHub', mark: 'J', accentColor: '#4967dc' },
}: {
  routeKey?: string
  initialSurface?: 'product' | 'canvas'
  productBrand?: VerticalBrand
}): JSX.Element {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  const addNode = useRFStore((s) => s.addNode)
  const subflowNodeId = useUIStore(s => s.subflowNodeId)
  const closeSubflow = useUIStore(s => s.closeSubflow)
  const libraryFlowId = useUIStore(s => s.libraryFlowId)
  const closeLibraryFlow = useUIStore(s => s.closeLibraryFlow)
  const [refresh, setRefresh] = React.useState(0)
  const [featureTourOpen, setFeatureTourOpen] = React.useState(false)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const currentFlow = useUIStore(s => s.currentFlow)
  const isDirty = useUIStore(s => s.isDirty)
  const currentProject = useUIStore(s => s.currentProject)
  const setCurrentProject = useUIStore(s => s.setCurrentProject)
  const [projects, setProjects] = React.useState<ProjectDto[]>([])
  const setDirty = useUIStore(s => s.setDirty)
  const setCurrentFlow = useUIStore(s => s.setCurrentFlow)
  const restoreCreationSession = useUIStore(s => s.restoreCreationSession)
  const creationSession = useUIStore(s => s.creationSession)
  const auth = useAuth()
  const [saving, setSaving] = React.useState(false)
  const [refreshingCanvas, setRefreshingCanvas] = React.useState(false)
  const loadProjectRequestSeq = React.useRef(0)
  const isHydratingProjectFlowRef = React.useRef(false)
  const [isHydrating, setIsHydrating] = React.useState(false)
  const lastSilentSaveErrorRef = React.useRef('')
  const [projectSelectionReady, setProjectSelectionReady] = React.useState(false)
  const [firstProjectName, setFirstProjectName] = React.useState('我的第一个项目')
  const [firstProjectCreating, setFirstProjectCreating] = React.useState(false)
  const [firstProjectError, setFirstProjectError] = React.useState('')
  const studioOwnerContext = React.useMemo(() => readStudioOwnerContext(), [routeKey])
  const studioFlowId = React.useMemo(() => readStudioFlowId(), [routeKey])
  const studioProjectId = React.useMemo(() => readStudioProjectId(), [routeKey])
  const [hasCanvasNodes, setHasCanvasNodes] = React.useState(() => useRFStore.getState().nodes.length > 0)
  const [workspaceSurface, setWorkspaceSurface] = React.useState<'product' | 'canvas'>(
    initialSurface,
  )

  React.useEffect(() => {
    const onWorkspaceCommand = (event: Event) => {
      const command = (event as CustomEvent<ProductWorkspaceCommand>).detail
      if (!command) return
      if (command.type === 'return-to-chat') {
        setActivePanel(null)
        if (initialSurface === 'product') setWorkspaceSurface('product')
        return
      }
      const nodeId = String(command.nodeId || '').trim()
      if (nodeId) {
        useRFStore.setState((state) => ({
          nodes: state.nodes.map((node) => ({ ...node, selected: node.id === nodeId })),
          edges: state.edges.map((edge) => ({ ...edge, selected: false })),
        }))
      }
      setActivePanel(null)
      if (initialSurface === 'product') setWorkspaceSurface('canvas')
      if (nodeId) {
        window.setTimeout(() => {
          ;(window as CanvasGlobalWindow).__tcFocusNode?.(nodeId)
        }, 0)
      }
    }
    window.addEventListener(PRODUCT_WORKSPACE_COMMAND, onWorkspaceCommand)
    return () => window.removeEventListener(PRODUCT_WORKSPACE_COMMAND, onWorkspaceCommand)
  }, [initialSurface, setActivePanel])

  const detachCurrentFlowFromProject = React.useCallback(() => {
    const uiState = useUIStore.getState()
    const nextFlowName = String(uiState.currentFlow.name || uiState.currentProject?.name || '未命名').trim() || '未命名'
    if (!uiState.currentFlow.id && uiState.currentFlow.source === 'local' && uiState.currentFlow.name === nextFlowName) {
      return
    }
    setCurrentFlow({ id: null, name: nextFlowName, source: 'local', ownerType: null, ownerId: null, updatedAt: null })
  }, [setCurrentFlow])

  const notifySilentSaveError = React.useCallback((error: unknown) => {
    if (isFlowSnapshotStaleError(error)) {
      if (lastSilentSaveErrorRef.current === FLOW_SNAPSHOT_STALE_MESSAGE) return
      lastSilentSaveErrorRef.current = FLOW_SNAPSHOT_STALE_MESSAGE
      toast(FLOW_SNAPSHOT_STALE_MESSAGE, 'error')
      return
    }
    const typedError = error as { message?: unknown; code?: unknown; status?: unknown }
    const code = typeof typedError?.code === 'string' ? typedError.code.trim() : ''
    const status = typeof typedError?.status === 'number' ? typedError.status : Number(typedError?.status)
    const message =
      code === 'project_not_found' || status === 404
        ? '当前项目已不存在，自动保存失败。请重新选择项目或新建项目。'
        : typeof typedError?.message === 'string' && typedError.message.trim()
          ? typedError.message.trim()
          : '自动保存失败'
    if (lastSilentSaveErrorRef.current === message) return
    lastSilentSaveErrorRef.current = message
    toast(message, 'error')
  }, [])

  React.useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      const state = useUIStore.getState()
      if (state.isDirty || hasPendingUploads()) {
        e.preventDefault(); e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  React.useEffect(() => {
    if (!auth.user) return
    void Promise.all([
      preloadModelOptions('image'),
      preloadModelOptions('imageEdit'),
    ]).catch((error: unknown) => {
      console.warn('[App] preload image model options failed', error)
    })
  }, [auth.user?.sub])

  // 初始化时：根据 URL 中的 projectId 选择项目；否则默认第一个项目
  React.useEffect(() => {
    setProjectSelectionReady(false)
    // 根据当前登录用户加载其项目；退出登录时清空项目和画布
    if (!auth.user) {
      setProjects([])
      setCurrentProject(null)
      useRFStore.setState({ nodes: [], edges: [], nextId: 1, nextGroupId: 1 })
      restoreCreationSession(null)
        setCurrentFlow({ id: null, name: '未命名', source: 'local', ownerType: null, ownerId: null, updatedAt: null })
      setDirty(false)
      setProjectSelectionReady(true)
      return
    }
    let cancelled = false
    const loadProjects = async () => {
      try {
        const listedProjects = await listProjects()
        const normalizedProjects = initialSurface === 'product'
          ? [...listedProjects].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
          : listedProjects
        if (cancelled) return
        setProjects(normalizedProjects)
        const existing = useUIStore.getState().currentProject
        const url = new URL(window.location.href)
        const pidFromUrl = url.searchParams.get('projectId')
        const selectedProject = resolveStudioProjectSelection({
          projects: normalizedProjects,
          requestedProjectId: pidFromUrl,
          existingProject: existing,
        })

        if (selectedProject) {
          if (!existing || existing.id !== selectedProject.id || existing.name !== selectedProject.name) {
            setCurrentProject({ id: selectedProject.id, name: selectedProject.name })
          }
          return
        }

        setCurrentProject(null)
        detachCurrentFlowFromProject()
      } catch (error: unknown) {
        if (!cancelled) {
          setCurrentProject(null)
          detachCurrentFlowFromProject()
          notifications.show({
            title: '项目初始化失败',
            message: resolveErrorMessage(error, '网络或服务器错误'),
            color: 'red',
          })
        }
      } finally {
        if (!cancelled) {
          setProjectSelectionReady(true)
        }
      }
    }
    void loadProjects()
    return () => {
      cancelled = true
    }
  }, [auth.user?.sub, detachCurrentFlowFromProject, initialSurface, setCurrentProject, setCurrentFlow, setDirty])

  // 当 currentProject/currentFlow 变化时，将项目与 server flow scope 同步到 URL
  React.useEffect(() => {
    if (!projectSelectionReady) return
    const pid = currentProject?.id
    const url = new URL(window.location.href)
    let changed = false
    const current = url.searchParams.get('projectId')
    if (pid) {
      if (current !== pid) {
        url.searchParams.set('projectId', pid)
        changed = true
      }
    } else if (current) {
      url.searchParams.delete('projectId')
      changed = true
    }

    const flowId = currentFlow.source === 'server' && currentFlow.id && pid && isCurrentFlowScopedToProjectTarget({
      currentFlow,
      projectId: pid,
      ownerContext: studioOwnerContext,
    })
      ? String(currentFlow.id).trim()
      : ''
    const currentUrlFlowId = url.searchParams.get('flowId')
    if (flowId) {
      if (currentUrlFlowId !== flowId) {
        url.searchParams.set('flowId', flowId)
        changed = true
      }
    } else if (currentUrlFlowId) {
      url.searchParams.delete('flowId')
      changed = true
    }

    if (changed) {
      window.history.replaceState(null, '', url.toString())
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  }, [
    projectSelectionReady,
    currentProject?.id,
    currentFlow.id,
    currentFlow.source,
    currentFlow.ownerType,
    currentFlow.ownerId,
    studioOwnerContext,
  ])

  const autoResumePendingTasks = React.useCallback(() => {
    try {
      const state = useRFStore.getState()
      const nodes = state.nodes || []
      if (!nodes.length) return
      const canvasWindow = window as CanvasGlobalWindow
      if (!canvasWindow.__tcAutoResumedTaskNodes) {
        canvasWindow.__tcAutoResumedTaskNodes = new Set<string>()
      }
      const resumed = canvasWindow.__tcAutoResumedTaskNodes

      nodes.forEach((n) => {
        const data = typeof n.data === 'object' && n.data !== null
          ? n.data as Record<string, unknown>
          : {}
        const status = (data.status as string | undefined) || ''
        const isPendingStatus = status === 'running' || status === 'queued'
        if (!isPendingStatus) return

        const taskIdCandidates = [
          typeof data.videoTaskId === 'string' ? data.videoTaskId.trim() : '',
          typeof data.imageTaskId === 'string' ? data.imageTaskId.trim() : '',
        ].filter(Boolean)
        const taskId = taskIdCandidates[0] || ''
        if (!taskId || !taskId.startsWith('task_')) return
        if (resumed.has(n.id)) return
        resumed.add(n.id)
        // 自动重启该节点的远程任务（runNodeRemote 会内部复用既有 taskId）
        void runNodeRemote(n.id, useRFStore.getState, useRFStore.setState).catch((error: unknown) => {
          resumed.delete(n.id)
          notifications.show({
            title: '自动恢复任务失败',
            message: resolveErrorMessage(error, `节点 ${n.id} 的远程任务恢复失败`),
            color: 'red',
          })
        })
      })
    } catch (error: unknown) {
      notifications.show({
        title: '自动恢复任务失败',
        message: resolveErrorMessage(error, '恢复画布远程任务时发生错误'),
        color: 'red',
      })
    }
  }, [])

  const loadLatestProjectFlow = React.useCallback(
    async (project: { id: string; name: string }) => {
      const projectId = project.id
      const projectName = project.name
      const seq = ++loadProjectRequestSeq.current
      isHydratingProjectFlowRef.current = true
      setIsHydrating(true)
      const requestedFlowId = resolveRequestedProjectFlowIdForLoad({
        requestedFlowId: studioFlowId,
        projectId,
        currentFlow: useUIStore.getState().currentFlow,
        ownerContext: studioOwnerContext,
      })

      // 先清空画布，避免异步加载期间把上个项目的图误保存到当前项目
      useRFStore.setState({ nodes: [], edges: [], nextId: 1, nextGroupId: 1 })
      useUIStore.getState().setPendingInitialView(null)
      restoreCreationSession(null)
      setCurrentFlow({
        id: requestedFlowId || null,
        name: projectName,
        source: 'server',
        ownerType: studioOwnerContext?.ownerType || 'project',
        ownerId: studioOwnerContext?.ownerId || projectId,
        updatedAt: null,
      })
      setDirty(false)

      try {
        const list = await listProjectFlows(projectId)
        const activeProjectId = String(useUIStore.getState().currentProject?.id || '')
        if (loadProjectRequestSeq.current !== seq) return
        if (!activeProjectId || activeProjectId !== String(projectId)) return

        if (isRequestedProjectFlowMissing(list, requestedFlowId)) {
          throw new Error(`URL 指定的画布不存在或无权访问：${requestedFlowId}`)
        }

        const f = pickProjectEntryFlow(list, requestedFlowId)

        if (f) {
          const data = f.data || { nodes: [], edges: [] }
          const viewport = data?.viewport
          const sanitized = sanitizeGraphForCanvas({
            nodes: Array.isArray(data.nodes) ? data.nodes : [],
            edges: Array.isArray(data.edges) ? data.edges : [],
          })
          const nextNodes = sanitized.nodes
          const nextEdges = sanitized.edges

          useRFStore.getState().load({
            nodes: nextNodes,
            edges: nextEdges,
          })
          useUIStore.getState().setPendingInitialView(viewport && typeof viewport.zoom === 'number' ? { kind: 'viewport', value: viewport } : { kind: 'fit' })
          restoreCreationSession(data?.sceneCreationProgress)
          setCurrentFlow({
            id: f.id,
            name: f.name,
            source: 'server',
            ownerType: normalizeProjectCanvasOwnerType(f.ownerType) || studioOwnerContext?.ownerType || 'project',
            ownerId: f.ownerId || studioOwnerContext?.ownerId || projectId,
            updatedAt: f.updatedAt,
          })
          setDirty(false)
        } else {
          const emptyFlowName = projectName
          try {
            const created = await saveProjectFlow({
                  projectId,
                  name: emptyFlowName,
                  nodes: [],
                  edges: [],
                })
            const latestProjectId = String(useUIStore.getState().currentProject?.id || '')
            if (loadProjectRequestSeq.current !== seq) return
            if (!latestProjectId || latestProjectId !== String(projectId)) return

            useRFStore.setState({ nodes: [], edges: [], nextId: 1, nextGroupId: 1 })
            useUIStore.getState().setPendingInitialView(null)
            restoreCreationSession(null)
            setCurrentFlow({
              id: created.id,
              name: created.name,
              source: 'server',
              ownerType: normalizeProjectCanvasOwnerType(created.ownerType) || studioOwnerContext?.ownerType || 'project',
              ownerId: created.ownerId || studioOwnerContext?.ownerId || projectId,
              updatedAt: created.updatedAt,
            })
            setDirty(false)
          } catch (error: unknown) {
            useRFStore.setState({ nodes: [], edges: [], nextId: 1, nextGroupId: 1 })
            useUIStore.getState().setPendingInitialView(null)
            restoreCreationSession(null)
            setCurrentFlow({
              id: null,
              name: emptyFlowName,
              source: 'server',
              ownerType: studioOwnerContext?.ownerType || 'project',
              ownerId: studioOwnerContext?.ownerId || projectId,
              updatedAt: null,
            })
            setDirty(false)
            if (loadProjectRequestSeq.current === seq) {
              notifications.show({
                title: '创建画布失败',
                message: resolveErrorMessage(error, '未能创建项目空画布，请稍后重试。'),
                color: 'red',
              })
            }
          }
        }

        // 项目流加载完成后，自动恢复未完成的远程任务（queued/running）
        autoResumePendingTasks()
      } catch (error: unknown) {
        if (loadProjectRequestSeq.current === seq) {
          notifications.show({
            title: '加载画布失败',
            message: resolveErrorMessage(error, '读取服务端流程失败，当前画布未能恢复。'),
            color: 'red',
          })
        }
      } finally {
        if (loadProjectRequestSeq.current === seq) {
          isHydratingProjectFlowRef.current = false
          setIsHydrating(false)
        }
      }
    },
    [autoResumePendingTasks, restoreCreationSession, setCurrentFlow, setDirty, studioFlowId, studioOwnerContext],
  )

  // 页面 onload + 项目切换时都拉取当前项目最新工作流。
  // 项目记录先由 listProjects 水合为完整 { id, name }，再允许加载画布；
  // 避免 URL projectId 先写入一个缺少 name 的 currentProject。
  React.useEffect(() => {
    if (!auth.user || !projectSelectionReady) return
    const pid = studioProjectId
    if (!pid) return
    const activeProject = useUIStore.getState().currentProject
    if (!activeProject || activeProject.id !== pid || !activeProject.name.trim()) return
    if (consumeSkipProjectFlowLoad(pid)) return
    void loadLatestProjectFlow({ id: activeProject.id, name: activeProject.name })
  }, [
    auth.user?.sub,
    projectSelectionReady,
    studioProjectId,
    currentProject?.id,
    currentProject?.name,
    loadLatestProjectFlow,
    routeKey,
  ])

  React.useEffect(() => {
    return useRFStore.subscribe((state, prevState) => {
      if (state.nodes === prevState.nodes && state.edges === prevState.edges) return

      const nextHasCanvasNodes = state.nodes.length > 0
      setHasCanvasNodes((prev) => (prev === nextHasCanvasNodes ? prev : nextHasCanvasNodes))

      if (!isHydratingProjectFlowRef.current && !useUIStore.getState().isDirty) {
        useUIStore.getState().setDirty(true)
      }
    })
  }, [])

  const shouldShowFirstProjectModal = Boolean(
    auth.user && projectSelectionReady && projects.length === 0 && !currentProject?.id,
  )

  const handleCreateFirstProject = React.useCallback(async () => {
    if (firstProjectCreating) return
    const requestedName = firstProjectName.trim() || '我的第一个项目'
    let createdProject: ProjectDto | null = null
    setFirstProjectCreating(true)
    setFirstProjectError('')
    try {
      const created = await upsertProject({ name: requestedName })
      const projectId = String(created.id || '').trim()
      if (!projectId) {
        throw new Error('服务端未返回项目 ID')
      }
      createdProject = created
      const projectName = String(created.name || requestedName).trim() || requestedName
      const createdFlow = await saveProjectFlow({
        projectId,
        name: projectName,
        nodes: [],
        edges: [],
        allowEmptyGraphOverwrite: true,
      })
      const flowId = String(createdFlow.id || '').trim()
      if (!flowId) {
        throw new Error('服务端未返回画布 ID')
      }

      setProjects((prev) => [created, ...prev.filter((item) => item.id !== projectId)])
      markSkipNextProjectFlowLoad(projectId)
      useRFStore.setState({ nodes: [], edges: [], nextId: 1, nextGroupId: 1 })
      useUIStore.getState().setPendingInitialView(null)
      restoreCreationSession(null)
      setCurrentProject({ id: projectId, name: projectName })
      setCurrentFlow({
        id: flowId,
        name: createdFlow.name || projectName,
        source: 'server',
        ownerType: normalizeProjectCanvasOwnerType(createdFlow.ownerType) || 'project',
        ownerId: createdFlow.ownerId || projectId,
        updatedAt: createdFlow.updatedAt,
      })
      setDirty(false)
      if (initialSurface === 'canvas') {
        spaReplace(buildStudioUrl({ projectId, flowId }))
      }
    } catch (error: unknown) {
      const title = createdProject ? '创建画布失败' : '创建项目失败'
      setFirstProjectError(`${title}：${resolveErrorMessage(error, '网络或服务器错误')}`)
    } finally {
      setFirstProjectCreating(false)
    }
  }, [
    firstProjectCreating,
    firstProjectName,
    initialSurface,
    restoreCreationSession,
    setCurrentFlow,
    setCurrentProject,
    setDirty,
  ])

  const doSave = async () => {
    if (saving) return
    const readUiSnapshot = () => {
      const uiState = useUIStore.getState()
      return {
        currentProject: uiState.currentProject,
        currentFlow: uiState.currentFlow,
        canvasViewport: uiState.canvasViewport,
      }
    }

    // 确保项目存在；若无则直接在此创建
    let { currentProject: proj } = readUiSnapshot()
    if (!proj?.id) {
      const name = (readUiSnapshot().currentProject?.name || `未命名项目 ${new Date().toLocaleString()}`).trim()
      try {
        const p = await upsertProject({ name })
        setProjects(prev => [p, ...prev])
        markSkipNextProjectFlowLoad(p.id)
        setCurrentProject({ id: p.id, name: p.name })
        setCurrentFlow({
          id: null,
          name: p.name,
          source: 'local',
          ownerType: studioOwnerContext?.ownerType || 'project',
          ownerId: studioOwnerContext?.ownerId || p.id,
          updatedAt: null,
        })
        proj = { id: p.id, name: p.name }
      } catch (error: unknown) {
        notifications.show({ title: '创建项目失败', message: resolveErrorMessage(error, '网络或服务器错误'), color: 'red' })
        return
      }
    }
    // 项目即工作流：名称使用项目名
    const flowName = proj!.name || '未命名'
    const nodes = useRFStore.getState().nodes
    const edges = useRFStore.getState().edges
    const { currentFlow: flow, canvasViewport: viewport } = readUiSnapshot()
    const sceneCreationProgress = serializeCreationSessionForPersistence(useUIStore.getState().creationSession)
    const shouldOverwriteWithEmptyGraph = Boolean(flow.id) && isEmptyGraphSnapshot({ nodes, edges })
    if (shouldOverwriteWithEmptyGraph && !confirmEmptyGraphOverwrite(flowName)) return
    const nid = 'saving-' + Date.now()
    notifications.show({ id: nid, title: $('保存中'), message: $('正在保存当前项目…'), loading: true, autoClose: false, withCloseButton: false })
    setSaving(true)
    try {
      const saved = await saveProjectFlow({
            id: flow.id || undefined,
            projectId: proj!.id!,
            name: flowName,
            nodes,
            edges,
            viewport,
            sceneCreationProgress,
            baseUpdatedAt: flow.updatedAt ?? null,
            ...(shouldOverwriteWithEmptyGraph ? { allowEmptyGraphOverwrite: true as const } : {}),
          })
      setCurrentFlow({
        id: saved.id,
        name: flowName,
        source: 'server',
        ownerType: normalizeProjectCanvasOwnerType(saved.ownerType) || flow.ownerType || studioOwnerContext?.ownerType || 'project',
        ownerId: saved.ownerId || flow.ownerId || studioOwnerContext?.ownerId || proj!.id!,
        updatedAt: saved.updatedAt,
      })
      setDirty(false)
      lastSilentSaveErrorRef.current = ''
      notifications.update({ id: nid, title: $('已保存'), message: $t('项目「{{name}}」已保存', { name: proj!.name }), loading: false, autoClose: 1500, color: 'green' })
    } catch (error: unknown) {
      notifications.update({
        id: nid,
        title: isFlowSnapshotStaleError(error) ? '保存被拒绝' : $('保存失败'),
        message: isFlowSnapshotStaleError(error) ? FLOW_SNAPSHOT_STALE_MESSAGE : resolveErrorMessage(error, $('网络或服务器错误')),
        loading: false,
        autoClose: 3000,
        color: 'red',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleRefreshCanvasFlow = async () => {
    if (refreshingCanvas) return
    const uiState = useUIStore.getState()
    const flowId = String(uiState.currentFlow.id || '').trim()
    const flowName = String(uiState.currentFlow.name || uiState.currentProject?.name || '当前流程').trim() || '当前流程'
    if (!flowId) {
      notifications.show({
        title: '无法刷新',
        message: '当前画布还没有服务端流程，请先保存一次。',
        color: 'red',
      })
      return
    }
    if (uiState.isDirty && !confirmServerCanvasRefresh(flowName)) return

    const nid = `refresh-flow-${Date.now()}`
    notifications.show({
      id: nid,
      title: '刷新画布',
      message: '正在从服务端读取当前流程…',
      loading: true,
      autoClose: false,
      withCloseButton: false,
    })
    setRefreshingCanvas(true)
    isHydratingProjectFlowRef.current = true
    setIsHydrating(true)
    try {
      const flow = await getServerFlow(flowId)
      const liveFlowId = String(useUIStore.getState().currentFlow.id || '').trim()
      if (liveFlowId !== flowId) {
        notifications.update({
          id: nid,
          title: '刷新已取消',
          message: '当前画布已切换，未覆盖本地内容。',
          loading: false,
          autoClose: 1800,
          color: 'yellow',
        })
        return
      }

      const flowData = flow.data || { nodes: [], edges: [] }
      const sanitized = sanitizeGraphForCanvas({
        nodes: Array.isArray(flowData.nodes) ? flowData.nodes : [],
        edges: Array.isArray(flowData.edges) ? flowData.edges : [],
      })
      useRFStore.getState().load({
        nodes: sanitized.nodes,
        edges: sanitized.edges,
      })
      useUIStore.getState().setPendingInitialView(
        flowData.viewport && typeof flowData.viewport.zoom === 'number'
          ? { kind: 'viewport', value: flowData.viewport }
          : { kind: 'fit' },
      )
      restoreCreationSession(flowData.sceneCreationProgress)
      setCurrentFlow({
        id: flow.id,
        name: flow.name,
        source: 'server',
        ownerType: normalizeProjectCanvasOwnerType(flow.ownerType) || uiState.currentFlow.ownerType || studioOwnerContext?.ownerType || 'project',
        ownerId: flow.ownerId || uiState.currentFlow.ownerId || studioOwnerContext?.ownerId || uiState.currentProject?.id || null,
        updatedAt: flow.updatedAt,
      })
      setDirty(false)
      notifications.update({
        id: nid,
        title: '画布已刷新',
        message: `已同步 ${sanitized.nodes.length} 个节点、${sanitized.edges.length} 条连线。`,
        loading: false,
        autoClose: 1800,
        color: 'green',
      })
    } catch (error: unknown) {
      notifications.update({
        id: nid,
        title: '刷新失败',
        message: resolveErrorMessage(error, '读取服务端流程失败'),
        loading: false,
        autoClose: 3000,
        color: 'red',
      })
    } finally {
      isHydratingProjectFlowRef.current = false
      setIsHydrating(false)
      setRefreshingCanvas(false)
    }
  }

  // 静默保存函数，不显示通知
  const silentSave = async () => {
    if (saving) return
    const readUiSnapshot = () => {
      const uiState = useUIStore.getState()
      return {
        currentProject: uiState.currentProject,
        currentFlow: uiState.currentFlow,
        canvasViewport: uiState.canvasViewport,
      }
    }
    if (isHydratingProjectFlowRef.current) return

    // 确保项目存在
    let { currentProject: proj } = readUiSnapshot()
    if (!proj?.id) {
      const name = (readUiSnapshot().currentProject?.name || `未命名项目 ${new Date().toLocaleString()}`).trim()
      try {
        const p = await upsertProject({ name })
        setProjects(prev => [p, ...prev])
        markSkipNextProjectFlowLoad(p.id)
        setCurrentProject({ id: p.id, name: p.name })
        setCurrentFlow({
          id: null,
          name: p.name,
          source: 'local',
          ownerType: studioOwnerContext?.ownerType || 'project',
          ownerId: studioOwnerContext?.ownerId || p.id,
          updatedAt: null,
        })
        proj = { id: p.id, name: p.name }
      } catch (error) {
        notifySilentSaveError(error)
        return
      }
    }

    const flowName = proj!.name || '未命名'
    const nodes = useRFStore.getState().nodes
    const edges = useRFStore.getState().edges
    const { currentFlow: flow, canvasViewport: viewport } = readUiSnapshot()
    if (flow.id && isEmptyGraphSnapshot({ nodes, edges })) return
    const sceneCreationProgress = serializeCreationSessionForPersistence(useUIStore.getState().creationSession)
    try {
      const saved = await saveProjectFlow({
            id: flow.id || undefined,
            projectId: proj!.id!,
            name: flowName,
            nodes,
            edges,
            viewport,
            sceneCreationProgress,
            baseUpdatedAt: flow.updatedAt ?? null,
          })
      setCurrentFlow({
        id: saved.id,
        name: flowName,
        source: 'server',
        ownerType: normalizeProjectCanvasOwnerType(saved.ownerType) || flow.ownerType || studioOwnerContext?.ownerType || 'project',
        ownerId: saved.ownerId || flow.ownerId || studioOwnerContext?.ownerId || proj!.id!,
        updatedAt: saved.updatedAt,
      })
      setDirty(false)
      lastSilentSaveErrorRef.current = ''
    } catch (error) {
      notifySilentSaveError(error)
    }
  }

  // 导出静默保存函数供其他组件使用
  React.useEffect(() => {
    // 将 silentSave 函数挂载到全局，供其他组件调用
    ;(window as CanvasGlobalWindow).silentSaveProject = silentSave
  }, [saving, currentFlow, currentProject, studioOwnerContext])

  const persistedSceneProgressKey = React.useMemo(() => {
    const current = serializeCreationSessionForPersistence(creationSession)
    return JSON.stringify(current)
  }, [creationSession])

  useDeferredSilentSave({
    enabled:
      !!currentProject?.id
      && currentFlow.source === 'server'
      && !!currentFlow.id
      && !isHydratingProjectFlowRef.current,
    saving,
    changeKey: persistedSceneProgressKey,
    delayMs: 120,
    onTrigger: () => {
      if (typeof window === 'undefined') return
      const fn = (window as unknown as { silentSaveProject?: () => void }).silentSaveProject
      if (typeof fn !== 'function') return
      fn()
    },
  })

  const tourSeenKey = React.useMemo(() => {
    const sub = auth.user?.sub
    if (sub === undefined || sub === null) return null
    return `canvas-feature-tour-seen:${FEATURE_TOUR_VERSION}:${String(sub)}`
  }, [auth.user?.sub])

  React.useEffect(() => {
    if (initialSurface === 'product') {
      setFeatureTourOpen(false)
      return
    }
    if (!auth.user) return
    if (!tourSeenKey) return
    try {
      const seen = localStorage.getItem(tourSeenKey) === '1'
      if (!seen) setFeatureTourOpen(true)
    } catch {
      setFeatureTourOpen(true)
    }
  }, [auth.user?.sub, initialSurface, tourSeenKey])

  const closeFeatureTour = React.useCallback(() => {
    setFeatureTourOpen(false)
    if (!tourSeenKey) return
    try {
      localStorage.setItem(tourSeenKey, '1')
    } catch {
      // ignore
    }
  }, [tourSeenKey])

  const featureTourSteps: FeatureTourStep[] = React.useMemo(() => {
    const steps: FeatureTourStep[] = [
      {
        id: 'floating-nav',
        target: 'floating-nav',
        title: $('浮动菜单'),
        description: $('左侧是主要入口：把鼠标移到图标上会展开对应面板。点击“+”可以快速添加节点。'),
      },
      {
        id: 'add-node',
        target: 'add-button',
        title: $('添加节点'),
        description: $('悬停“+”打开添加面板，先加 image / 视频等节点，然后在画布上连线组合成工作流。'),
      },
      {
        id: 'canvas',
        target: 'canvas',
        title: $('画布操作'),
        description: $('拖拽移动节点，拖出连线建立依赖。框选多个节点后按 ⌘/Ctrl+G 打组，按 ⌘/Ctrl+Enter 运行选中。'),
      },
    ]

    if (!hasCanvasNodes) {
      steps.push({
        id: 'quick-start',
        target: 'empty-quickstart',
        title: $('快速起步'),
        description: $('空画布中间会先让你选择目标，比如一句话出图、首帧转视频，或先上传项目文本再从文本开场景。选一个后会直接进入对应 Starter 或入口。'),
      })
    }

    steps.push(
      {
        id: 'project',
        target: 'project-name',
        title: $('项目保存'),
        description: $('右上角可以修改项目名并手动保存。保存后可随时继续编辑。'),
      },
      {
        id: 'help',
        target: 'help-tour',
        title: $('随时重开引导'),
        description: $('点右上角“帮助”图标可随时重新打开本引导浮层。'),
      },
    )

    return steps
  }, [hasCanvasNodes])

  const headerHeight = 0
  const isProductHost = initialSurface === 'product'
  const isProductSurface = isProductHost && workspaceSurface === 'product'
  const selectProductProject = React.useCallback((project: ProjectDto) => {
    const projectId = String(project.id || '').trim()
    if (!projectId) return
    const url = new URL(window.location.href)
    url.searchParams.set('projectId', projectId)
    url.searchParams.delete('flowId')
    window.history.pushState(null, '', url.toString())
    setCurrentProject({ id: projectId, name: project.name })
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [setCurrentProject])

  React.useEffect(() => {
    if (typeof document === 'undefined') return
    if (isProductSurface) document.documentElement.dataset.productHost = 'true'
    else delete document.documentElement.dataset.productHost
    return () => {
      delete document.documentElement.dataset.productHost
    }
  }, [isProductSurface])

  const snapshotFlowId = currentFlow?.source === 'server' && currentFlow?.id ? String(currentFlow.id) : null
  const snapshotExport = useSnapshotExport(snapshotFlowId)
  const handleExportSnapshot = React.useCallback(() => {
    const { nodes } = useRFStore.getState()
    void snapshotExport.trigger(nodes)
  }, [snapshotExport])

  const showEmptyGuide = Boolean(
    auth.user &&
    projectSelectionReady &&
    !shouldShowFirstProjectModal &&
    !isHydrating &&
    ((!currentProject?.id && projects.length > 0) ||
     (currentProject?.id && !hasCanvasNodes && currentFlow.source === 'server'))
  )
  const emptyGuideMode = !currentProject?.id ? 'no-project' as const : 'empty-canvas' as const

  return (
    <AppShell
      data-compact={'false'}
      header={{ height: headerHeight, offset: false }}
      padding={0}
      styles={{
        main: { paddingTop: 0, paddingLeft: 0, paddingRight: 0, background: 'var(--mantine-color-body)', overflow: 'hidden' }
      }}
    >
      <AppShell.Header className="app-shell-header" />

      {/* 移除左侧固定栏，改为悬浮灵动岛样式 */}

      <AppShell.Main className={`app-shell-main${isProductSurface ? ' app-shell-main--product-host' : ''}`}>
        <Box className={`app-shell-main-box${isProductSurface ? ' app-shell-main-box--product-host' : ''}`} onClick={(e)=>{
          const el = e.target as HTMLElement
          if (
            !el.closest('[data-ux-floating]') &&
            !el.closest('[data-ux-panel]') &&
            !el.closest('.mantine-Modal-content') &&
            !el.closest('.mantine-Modal-root')
          ) {
            setActivePanel(null)
          }
        }}>
          {!isProductSurface ? (
            <>
              <Canvas className="app-canvas" />
              {showEmptyGuide && (
                <CanvasEmptyGuide
                  mode={emptyGuideMode}
                  onGoToProjects={() => spaReplace('/projects')}
                />
              )}
            </>
          ) : null}
        </Box>
      </AppShell.Main>

      {/* 右侧属性栏已移除：节点采取顶部操作条 + 参数弹窗 */}

      <KeyboardShortcuts className="app-keyboard-shortcuts" />
      <ToastHost className="app-toast-host" />
      <SnapshotProgressDialog
        open={snapshotExport.open}
        state={snapshotExport.state}
        onClose={snapshotExport.close}
        onDownload={snapshotExport.triggerDownload}
      />
      <FeatureTour className="app-feature-tour" opened={featureTourOpen} steps={featureTourSteps} onClose={closeFeatureTour} />
      <BodyPortal>
        {!isProductSurface ? (
          <div className="app-header-overlay">
          <Group className="app-header" p="sm" wrap="nowrap" gap="md">
            <ProjectIdentityCell
              projectName={currentProject?.name || ''}
              canEdit={Boolean(currentProject?.id)}
              onRename={async (next) => {
                if (!currentProject?.id) return
                await upsertProject({ id: currentProject.id, name: next })
                setCurrentProject({ ...(currentProject || {}), name: next })
              }}
              canvasSaveState={saving ? 'saving' : isDirty ? 'dirty' : 'idle'}
            />
            <div id="tc-canvas-visibility-slot" className="app-header-visibility-slot" />
            <div className="app-header-divider" aria-hidden="true" />
            <Group className="app-header-actions" gap="xs" wrap="nowrap">
              {isProductHost ? (
                <Button
                  className="product-workspace-return"
                  size="xs"
                  variant="light"
                  leftSection={<IconMessageCircle size={16} />}
                  onClick={() => dispatchProductWorkspaceCommand({ type: 'return-to-chat' })}
                >
                  Agent Workspace
                </Button>
              ) : null}
              <Button className="app-save-button" size="xs" onClick={doSave} disabled={!isDirty} loading={saving} data-tour="save-button">Save</Button>
              <Tooltip className="app-refresh-flow-tooltip" label="Refresh canvas from server">
                <ActionIcon
                  className="app-refresh-flow-action"
                  size="lg"
                  variant="subtle"
                  aria-label="Refresh canvas from server"
                  loading={refreshingCanvas}
                  disabled={!currentFlow.id}
                  onClick={() => void handleRefreshCanvasFlow()}
                >
                  <IconRefresh className="app-refresh-flow-icon" size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip className="app-snapshot-tooltip" label="Export canvas">
                <ActionIcon
                  className="app-snapshot-action"
                  size="lg"
                  variant="subtle"
                  aria-label="Export canvas"
                  disabled={!snapshotFlowId}
                  onClick={handleExportSnapshot}
                >
                  <IconCamera className="app-snapshot-icon" size={18} />
                </ActionIcon>
              </Tooltip>
              <ActionIcon
                className="app-theme-toggle"
                variant="subtle"
                aria-label={colorScheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                onClick={() => toggleColorScheme()}
              >
                {colorScheme === 'dark' ? <IconSun className="app-theme-toggle-icon" size={18} /> : <IconMoonStars className="app-theme-toggle-icon" size={18} />}
              </ActionIcon>
              <ActionIcon
                className="app-help-toggle"
                variant="subtle"
                aria-label={$('帮助')}
                onClick={() => setFeatureTourOpen(true)}
                data-tour="help-tour"
              >
                <IconHelpCircle className="app-help-toggle-icon" size={18} />
              </ActionIcon>
              <ActionIcon className="app-github-link" component="a" href="https://github.com/anymouschina/JarvisHub" target="_blank" rel="noopener noreferrer" variant="subtle" aria-label="GitHub">
                <IconBrandGithub className="app-github-icon" size={18} />
              </ActionIcon>
            </Group>
          </Group>
          <div className="app-header-secondary-row">
            <div id="tc-canvas-breadcrumb-slot" className="app-header-secondary-slot app-header-secondary-slot--center" />
          </div>
          </div>
        ) : null}
        {!isProductSurface ? <FloatingNav className="app-floating-nav" /> : null}
        <AddNodePanel className="app-add-node-panel" />
        <ProjectPanel />
        <AssetCenterPanel />
        <PendingUploadsBar />
        <ModelPanel />
        <HistoryPanel />
        <MemoryPanel />
        {isProductSurface ? (
          <AgentWorkspace
            brand={productBrand}
            projects={projects}
            currentProject={currentProject}
            onSelectProject={selectProductProject}
            onOpenAssets={() => setActivePanel('gallery')}
            onOpenProfessionalWorkspace={() => dispatchProductWorkspaceCommand({ type: 'open-canvas' })}
          />
        ) : (
          <AiChatDialog className="app-ai-chat-dialog" surface="native" />
        )}
      </BodyPortal>
      <ParamModal />
      <PreviewModal />
      <WebCutVideoEditModalHost />
      <Modal
        className="app-first-project-modal"
        opened={shouldShowFirstProjectModal}
        onClose={() => undefined}
        closeOnClickOutside={false}
        closeOnEscape={false}
        withCloseButton={false}
        centered
        title="创建第一个画布项目"
      >
        <Stack className="app-first-project-modal-stack" gap="sm">
          <Text className="app-first-project-modal-description" size="sm" c="dimmed">
            先创建一个项目和空白画布，AI 才能绑定画布并调用生成工具。
          </Text>
          <TextInput
            className="app-first-project-modal-name"
            label="项目名"
            value={firstProjectName}
            onChange={(event) => {
              setFirstProjectName(event.currentTarget.value)
              if (firstProjectError) setFirstProjectError('')
            }}
            disabled={firstProjectCreating}
            autoFocus
          />
          {firstProjectError ? (
            <Text className="app-first-project-modal-error" size="sm" c="red">
              {firstProjectError}
            </Text>
          ) : null}
          <Group className="app-first-project-modal-actions" justify="flex-end" gap="xs">
            <Button
              className="app-first-project-modal-projects"
              variant="subtle"
              disabled={firstProjectCreating}
              onClick={() => spaReplace('/projects')}
            >
              去项目入口
            </Button>
            <Button
              className="app-first-project-modal-create"
              loading={firstProjectCreating}
              disabled={!firstProjectName.trim()}
              onClick={() => void handleCreateFirstProject()}
            >
              创建画布
            </Button>
          </Group>
        </Stack>
      </Modal>
      {subflowNodeId && (<SubflowEditor nodeId={subflowNodeId} onClose={closeSubflow} />)}
      {libraryFlowId && (<LibraryEditor flowId={libraryFlowId} onClose={closeLibraryFlow} />)}
    </AppShell>
  )
}

function isProjectsRoute(): boolean {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname || ''
  return path === '/projects' || path.startsWith('/projects/')
}

function matchProjectEntryRoute(): { projectId: string } | null {
  if (typeof window === 'undefined') return null
  const path = window.location.pathname || ''
  const projectOnlyMatch = path.match(/^\/projects\/([^/]+)\/?$/)
  if (!projectOnlyMatch) return null
  return {
    projectId: decodeURIComponent(projectOnlyMatch[1]),
  }
}

function RootEntryPage({
  routeKey,
  extension,
}: {
  routeKey: string
  extension?: VerticalExtensionDescriptor
}): JSX.Element {
  const auth = useAuth()
  if (!auth.user) return <HomePage />
  return (
    <CanvasApp
      routeKey={routeKey}
      initialSurface={extension ? 'product' : 'canvas'}
      productBrand={extension?.brand}
    />
  )
}

export default function App({
  extension,
}: {
  extension?: VerticalExtensionDescriptor
} = {}): JSX.Element {
  // Re-render on SPA navigation.
  const [, forceRender] = React.useState(0)
  const routeKey = typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : ''
  React.useEffect(() => {
    const onPop = () => forceRender((x) => x + 1)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/workspace')) {
    const workspaceRedirectUrl = `${buildStudioUrl()}${window.location.search || ''}`
    spaReplace(workspaceRedirectUrl)
    return (
      <AppShell padding="md">
        <AppShell.Main>
          <Group justify="center" align="center" style={{ minHeight: '100vh' }}>
            <Badge variant="light" color="gray">正在进入画布…</Badge>
          </Group>
        </AppShell.Main>
      </AppShell>
    )
  }
  const projectEntryRoute = matchProjectEntryRoute()
  if (projectEntryRoute) {
    return <ProjectDefaultEntryRedirectPage projectId={projectEntryRoute.projectId} />
  }
  if (isProjectsRoute()) {
    return <ProjectManagerPage />
  }
  if (isGithubOauthCallbackRoute()) {
    return <CanvasApp routeKey={routeKey} />
  }
  if (isStudioRoute()) {
    return <CanvasApp routeKey={routeKey} />
  }
  return <RootEntryPage routeKey={routeKey} extension={extension} />
}
