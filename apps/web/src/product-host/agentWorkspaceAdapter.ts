import React from 'react'
import { listRuntimeAgentSkills, listServerAssets, type ProjectDto, type RuntimeAgentSkillDto, type ServerAssetDto } from '../api/server'
import { useRFStore } from '../canvas/store'
import { collectCanvasAssets } from '../ui/canvasAssetModel'
import { peekAiChatTabsState } from '../ui/chat/chatTabs'
import { useLiveChatRunStore } from '../ui/chat/liveChatRunStore'
import { createEmptyChatTabRuntime, useAiChatRuntimeStore, type ChatMessage } from '../ui/chat/chatRuntimeStore'
import { resolveSuccessfulToolSnapshotArtifacts } from '../ui/chat/mediaResultArtifactProjection'
import { NATIVE_CHAT_NAVIGATION_CHANGED } from './nativeChatNavigation'
import {
  projectAgentWorkspace,
  type AgentWorkspaceAssetFact,
  type AgentWorkspaceFacts,
  type AgentWorkspaceViewModel,
  type NativeAgentWorkspaceCommand,
} from './agentWorkspaceProjection'
import {
  createAgentWorkspaceRuntime,
  type AgentWorkspaceRuntime,
  type AgentWorkspaceRuntimeAdapter,
} from './agentWorkspaceRuntime'
import {
  executeAgentWorkspaceChatCommand,
  isAgentWorkspaceChatIntegrationReady,
  subscribeAgentWorkspaceChatIntegration,
} from './agentWorkspaceChatIntegration'
import { reconcileArtifactDelivery } from './artifactDeliveryReconciliation'

type CurrentProject = Readonly<{ id?: string | null; name: string }> | null
type CurrentFlow = Readonly<{ id?: string | null; name?: string | null; updatedAt?: string | null }> | null

type AuthoritativeInput = Readonly<{
  enabled?: boolean
  projects: readonly ProjectDto[]
  currentProject: CurrentProject
  currentFlow: CurrentFlow
}>

export type ProductionAgentWorkspaceCommands = Readonly<{
  onSelectProject: (project: ProjectDto) => void
  onCreateProject: () => void
  onCreateFlow: (projectId: string) => void | Promise<void>
  onOpenAssets: () => void
  onOpenProfessionalWorkspace: (nodeId?: string) => void
}>

function readNodeStatus(nodes: readonly unknown[], nodeId: string): AgentWorkspaceAssetFact['status'] {
  const node = nodes.find((candidate) => String((candidate as { id?: unknown } | null)?.id || '').trim() === nodeId) as {
    data?: Record<string, unknown>
  } | undefined
  const status = String(node?.data?.status || '').trim()
  if (status === 'success') return 'success'
  if (status === 'error' || status === 'failed') return 'failed'
  if (status === 'running') return 'running'
  return 'queued'
}

function readNodeUpdatedAt(nodes: readonly unknown[], nodeId: string, fallback: number): number {
  const node = nodes.find((candidate) => String((candidate as { id?: unknown } | null)?.id || '').trim() === nodeId) as {
    data?: Record<string, unknown>
  } | undefined
  const raw = node?.data?.updatedAt ?? node?.data?.finishedAt ?? node?.data?.createdAt
  const parsed = typeof raw === 'number' ? raw : Date.parse(String(raw || ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function projectServerAssetFact(asset: ServerAssetDto): AgentWorkspaceAssetFact | null {
  const data = asset.data && typeof asset.data === 'object' ? asset.data as Record<string, unknown> : {}
  const url = String(data.url || data.imageUrl || data.videoUrl || '').trim()
  if (!url) return null
  const rawKind = String(data.kind || data.type || '').toLowerCase()
  const kind: 'image' | 'video' = rawKind.includes('video') || /\.(mp4|mov|webm)(\?|$)/i.test(url)
    ? 'video'
    : 'image'
  const updatedAt = Date.parse(asset.updatedAt || asset.createdAt)
  const thumbnailUrl = String(data.thumbnailUrl || '').trim()
  const nodeId = String(data.nodeId || '').trim()
  const assetRefId = String(data.assetRefId || '').trim()
  return {
    nodeId,
    title: asset.name || (kind === 'video' ? '视频资产' : '图片资产'),
    kind,
    url,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    assetId: String(data.assetId || asset.id),
    ...(assetRefId ? { assetRefId } : {}),
    status: 'success',
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    scope: 'all',
  }
}

function projectTimelineAsset(asset: NonNullable<ChatMessage['assets']>[number]) {
  const url = String(asset.url || '').trim()
  if (!url) return null
  const rawKind = String(asset.mediaType || '').trim()
  return {
    title: String(asset.title || '').trim() || (rawKind === 'video' ? '生成视频' : '生成图片'),
    kind: rawKind === 'video' ? 'video' as const : 'image' as const,
    url,
    ...(asset.thumbnailUrl ? { thumbnailUrl: asset.thumbnailUrl } : {}),
    ...(asset.nodeId ? { nodeId: asset.nodeId } : {}),
    ...(asset.assetId ? { assetId: asset.assetId } : {}),
    ...(asset.assetRefId ? { assetRefId: asset.assetRefId } : {}),
  }
}

function projectTimelineMessage(message: ChatMessage, nodes: readonly unknown[]) {
  const projected = message.toolCallSnapshot
    ? resolveSuccessfulToolSnapshotArtifacts({
        toolCallsByTurn: message.toolCallSnapshot.record.toolCallsByTurn,
        nodes,
      })
    : []
  const candidates = [...projected, ...(message.assets ?? [])]
  const seen = new Set<string>()
  const assets = candidates.map(projectTimelineAsset).filter((asset): asset is NonNullable<typeof asset> => {
    if (!asset) return false
    const identity = asset.nodeId || asset.assetId || asset.assetRefId || asset.url
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
  const decision = message.askUserPrompt ? {
    toolCallId: message.askUserPrompt.toolCallId,
    question: message.askUserPrompt.question,
    options: message.askUserPrompt.options,
    awaitingReply: message.askUserPrompt.awaitingReply,
  } : null
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.ts,
    ...(message.phase ? { phase: message.phase } : {}),
    ...(message.kind ? { result: message.turnVerdict?.status === 'partial' ? 'partial' as const : message.kind } : {}),
    ...(assets.length ? { assets } : {}),
    ...(decision ? { decision } : {}),
  }
}

function projectTimeline(messages: readonly ChatMessage[], nodes: readonly unknown[]) {
  return messages.map((message, index) => {
    const entry = projectTimelineMessage(message, nodes)
    if (!entry.decision || entry.decision.awaitingReply) return entry
    const nextUser = messages.slice(index + 1).find((candidate) => candidate.role === 'user')
    return nextUser ? {
      ...entry,
      decision: { ...entry.decision, selectedOption: nextUser.content },
    } : entry
  })
}

function useAuthoritativeAgentWorkspaceFacts(input: AuthoritativeInput): AgentWorkspaceFacts {
  const nodes = useRFStore((state) => state.nodes)
  const runsBySessionKey = useLiveChatRunStore((state) => state.runsBySessionKey)
  const tabRuntimeById = useAiChatRuntimeStore((state) => state.tabRuntimeById)
  const chatReady = React.useSyncExternalStore(
    subscribeAgentWorkspaceChatIntegration,
    isAgentWorkspaceChatIntegrationReady,
    isAgentWorkspaceChatIntegrationReady,
  )
  const shouldRefreshAssetsContinuously = Object.values(runsBySessionKey).some((run) => run.status === 'running')
  const [serverAssets, setServerAssets] = React.useState<ServerAssetDto[]>([])
  const [runtimeSkills, setRuntimeSkills] = React.useState<RuntimeAgentSkillDto[]>([])
  const [serverAssetState, setServerAssetState] = React.useState<Readonly<{
    status: 'loading' | 'ready' | 'error'
    message: string
  }>>({ status: 'loading', message: '' })
  const [, refreshNavigation] = React.useReducer((value) => value + 1, 0)

  React.useEffect(() => {
    if (input.enabled === false) {
      setServerAssets([])
      setServerAssetState({ status: 'ready', message: '' })
      return
    }
    let cancelled = false
    let firstRead = true
    const refresh = async () => {
      if (firstRead) setServerAssetState({ status: 'loading', message: '' })
      try {
        const projectId = String(input.currentProject?.id || '').trim()
        const result = await listServerAssets({ ...(projectId ? { projectId } : {}), limit: 80 })
        if (cancelled) return
        setServerAssets(result.items)
        setServerAssetState({ status: 'ready', message: '' })
      } catch {
        if (cancelled) return
        if (firstRead) setServerAssets([])
        setServerAssetState({ status: 'error', message: '无法读取项目资产，请稍后重试。' })
      } finally {
        firstRead = false
      }
    }
    void refresh()
    const intervalId = shouldRefreshAssetsContinuously
      ? window.setInterval(() => void refresh(), 5_000)
      : null
    return () => {
      cancelled = true
      if (intervalId !== null) window.clearInterval(intervalId)
    }
  }, [input.currentProject?.id, input.enabled, shouldRefreshAssetsContinuously])

  React.useEffect(() => {
    if (input.enabled === false) {
      setRuntimeSkills([])
      return
    }
    let cancelled = false
    void listRuntimeAgentSkills()
      .then((result) => { if (!cancelled) setRuntimeSkills(result.skills) })
      .catch(() => { if (!cancelled) setRuntimeSkills([]) })
    return () => { cancelled = true }
  }, [input.enabled])

  React.useEffect(() => {
    const refresh = () => refreshNavigation()
    window.addEventListener(NATIVE_CHAT_NAVIGATION_CHANGED, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(NATIVE_CHAT_NAVIGATION_CHANGED, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  return React.useMemo(() => {
    const currentProjectId = String(input.currentProject?.id || '').trim()
    const sessionsByProject: Record<string, Array<{ id: string; title: string; updatedAt: number }>> = {}
    let currentSessionId = ''
    let currentSessionKey = ''
    for (const project of input.projects) {
      const tabs = peekAiChatTabsState(project.id)
      sessionsByProject[project.id] = (tabs?.tabs ?? []).map((session) => ({
        id: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
      }))
      if (project.id === currentProjectId) {
        currentSessionId = tabs?.activeTabId ?? ''
        currentSessionKey = tabs?.tabs.find((tab) => tab.id === currentSessionId)?.sessionKey ?? ''
      }
    }

    const canvasAssets: AgentWorkspaceAssetFact[] = collectCanvasAssets(nodes as unknown[])
      .filter((asset) => asset.kind === 'image' || asset.kind === 'video')
      .map((asset, index) => ({
        nodeId: asset.nodeId,
        title: asset.label,
        kind: asset.kind as 'image' | 'video',
        url: asset.url || '',
        ...(asset.thumbnailUrl ? { thumbnailUrl: asset.thumbnailUrl } : {}),
        ...(asset.assetId ? { assetId: asset.assetId } : {}),
        ...(asset.assetRefId ? { assetRefId: asset.assetRefId } : {}),
        status: readNodeStatus(nodes, asset.nodeId),
        updatedAt: readNodeUpdatedAt(nodes, asset.nodeId, index + 1),
        scope: 'canvas' as const,
      }))
    const serverAssetFacts = serverAssets
      .map(projectServerAssetFact)
      .filter((asset): asset is AgentWorkspaceAssetFact => asset !== null)
    const canvasAssetIds = new Set(canvasAssets.flatMap((asset) => [asset.assetId, asset.assetRefId].filter(Boolean)))
    const assets = [
      ...canvasAssets,
      ...serverAssetFacts.filter((asset) => !canvasAssetIds.has(asset.assetId) && !canvasAssetIds.has(asset.assetRefId)),
    ]

    const currentFlowId = String(input.currentFlow?.id || '').trim()
    const currentRun = Object.values(runsBySessionKey)
      .filter((run) => (
        (!currentProjectId || run.projectId === currentProjectId)
        && (!currentFlowId || run.flowId === currentFlowId)
        && (!currentSessionKey || run.sessionKey === currentSessionKey)
      ))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
    const tabRuntime = currentSessionId
      ? tabRuntimeById[currentSessionId] ?? createEmptyChatTabRuntime()
      : createEmptyChatTabRuntime()
    const delivery = reconcileArtifactDelivery({
      timeline: projectTimeline(tabRuntime.messages, nodes),
      assets,
      run: currentRun ? {
        status: currentRun.status,
        assistantMessageId: currentRun.assistantMessageId,
        startedAt: currentRun.startedAt,
        updatedAt: currentRun.updatedAt,
        todoItems: currentRun.todoItems,
        media: Object.values(currentRun.toolCallsByTurn)
          .flat()
          .flatMap((call) => call.media ? [{
            nodeId: call.media.nodeId,
            status: call.media.status,
            pending: call.media.pending,
          }] : []),
      } : null,
    })
    const pendingReferences = [
      ...tabRuntime.manualReferenceImages.map((url) => {
        const metadata = tabRuntime.uploadedReferenceAssetMeta[url]
        return {
          kind: 'image' as const,
          url,
          label: metadata?.name || '参考图片',
          ...(metadata?.assetId ? { assetId: metadata.assetId } : {}),
          ...(metadata?.assetRefId ? { assetRefId: metadata.assetRefId } : {}),
        }
      }),
      ...(tabRuntime.manualReferenceVideos ?? []).map((item) => ({
        kind: 'video' as const,
        url: item.url,
        label: item.label || '参考视频',
        ...(item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : {}),
        ...(item.nodeId ? { nodeId: item.nodeId } : {}),
      })),
    ]

    return {
      projects: input.projects,
      currentProjectId,
      currentFlow: input.currentFlow,
      sessionsByProject,
      currentSessionId,
      assets,
      assetsState: serverAssetState.status,
      assetsErrorMessage: serverAssetState.message,
      run: delivery.run,
      timeline: delivery.timeline,
      composer: {
        draft: tabRuntime.draft,
        pendingReferences,
        sending: currentRun?.status === 'running',
        ready: chatReady,
        selectedSkill: tabRuntime.activeSkill ? {
          id: tabRuntime.activeSkill.id,
          key: tabRuntime.activeSkill.key,
          name: tabRuntime.activeSkill.name,
        } : null,
        availableSkills: runtimeSkills.map((skill) => ({ id: skill.id, key: skill.key, name: skill.name })),
        ...(tabRuntime.historyLoadError ? { errorMessage: tabRuntime.historyLoadError } : {}),
      },
    }
  }, [chatReady, input.currentFlow, input.currentProject?.id, input.projects, nodes, runsBySessionKey, runtimeSkills, serverAssets, serverAssetState, tabRuntimeById])
}

export function useAuthoritativeAgentWorkspaceViewModel(input: AuthoritativeInput): AgentWorkspaceViewModel {
  return projectAgentWorkspace(useAuthoritativeAgentWorkspaceFacts(input))
}

export function useAuthoritativeAgentWorkspaceRuntime(
  input: AuthoritativeInput & ProductionAgentWorkspaceCommands,
): AgentWorkspaceRuntime {
  const facts = useAuthoritativeAgentWorkspaceFacts(input)
  const factsRef = React.useRef<AgentWorkspaceFacts>(facts)
  const commandRef = React.useRef(input)
  factsRef.current = facts
  commandRef.current = input

  const listenersRef = React.useRef(new Set<() => void>())
  const runtimeRef = React.useRef<AgentWorkspaceRuntime | null>(null)
  if (!runtimeRef.current) {
    const adapter: AgentWorkspaceRuntimeAdapter = {
      readFacts: () => factsRef.current,
      subscribe: (listener) => {
        listenersRef.current.add(listener)
        return () => listenersRef.current.delete(listener)
      },
      execute: async (command: NativeAgentWorkspaceCommand) => {
        const current = commandRef.current
        if (command.type === 'project.select') {
          const project = current.projects.find((candidate) => candidate.id === command.projectId)
          if (!project) throw new Error('项目不存在')
          current.onSelectProject(project)
          return
        }
        if (command.type === 'chat.navigate') {
          const project = current.projects.find((candidate) => candidate.id === command.command.projectId)
          if (project && project.id !== String(current.currentProject?.id || '')) current.onSelectProject(project)
          await executeAgentWorkspaceChatCommand(command.command.type === 'new-session'
            ? { type: 'session.create', projectId: command.command.projectId }
            : { type: 'session.select', projectId: command.command.projectId, sessionId: command.command.sessionId })
          return
        }
        if (command.type === 'flow.create') {
          await current.onCreateFlow(command.projectId)
          return
        }
        if (command.type === 'project.create') {
          current.onCreateProject()
          return
        }
        if (command.type === 'assets.open') {
          current.onOpenAssets()
          return
        }
        if (command.type === 'asset.add-to-canvas') {
          const asset = command.asset
          if (asset.kind === 'video') {
            useRFStore.getState().addNode('taskNode', asset.title, {
              kind: 'video',
              videoUrl: asset.url,
              videoThumbnailUrl: asset.thumbnailUrl || null,
              videoResults: [{ url: asset.url, thumbnailUrl: asset.thumbnailUrl || null }],
            })
          } else {
            useRFStore.getState().addNode('taskNode', asset.title, { kind: 'image', imageUrl: asset.url })
          }
          return
        }
        if (command.type === 'asset.modify' || command.type === 'asset.reference') {
          await executeAgentWorkspaceChatCommand({
            type: 'reference.add',
            reference: {
              kind: command.asset.kind,
              url: command.asset.url,
              ...(command.asset.thumbnailUrl ? { thumbnailUrl: command.asset.thumbnailUrl } : {}),
              label: command.asset.title,
              ...(command.asset.nodeId ? { nodeId: command.asset.nodeId } : {}),
              ...(command.asset.assetId ? { assetId: command.asset.assetId } : {}),
              ...(command.asset.assetRefId ? { assetRefId: command.asset.assetRefId } : {}),
            },
            continuation: command.type === 'asset.modify' ? 'modify' : 'reference',
          })
          return
        }
        if (command.type === 'chat.draft.set') {
          await executeAgentWorkspaceChatCommand({ type: 'draft.set', text: command.text })
          return
        }
        if (command.type === 'chat.request.submit') {
          await executeAgentWorkspaceChatCommand({ type: 'request.submit' })
          return
        }
        if (command.type === 'chat.request.interrupt') {
          await executeAgentWorkspaceChatCommand({ type: 'request.interrupt' })
          return
        }
        if (command.type === 'chat.references.upload') {
          await executeAgentWorkspaceChatCommand({ type: 'references.upload', files: command.files })
          return
        }
        if (command.type === 'chat.reference.remove') {
          await executeAgentWorkspaceChatCommand({ type: 'reference.remove', url: command.url })
          return
        }
        if (command.type === 'chat.decision.answer') {
          await executeAgentWorkspaceChatCommand({ type: 'decision.answer', option: command.option })
          return
        }
        if (command.type === 'chat.skill.select') {
          await executeAgentWorkspaceChatCommand({ type: 'skill.select', skill: command.skill })
          return
        }
        current.onOpenProfessionalWorkspace(command.nodeId)
      },
    }
    runtimeRef.current = createAgentWorkspaceRuntime(adapter)
  }

  React.useEffect(() => {
    for (const listener of listenersRef.current) listener()
  }, [facts])

  return runtimeRef.current
}
