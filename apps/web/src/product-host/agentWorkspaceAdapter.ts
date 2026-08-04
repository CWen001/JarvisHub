import React from 'react'
import type { ProjectDto } from '../api/server'
import { useRFStore } from '../canvas/store'
import { collectCanvasAssets } from '../ui/canvasAssetModel'
import { peekAiChatTabsState } from '../ui/chat/chatTabs'
import { useLiveChatRunStore } from '../ui/chat/liveChatRunStore'
import { NATIVE_CHAT_NAVIGATION_CHANGED } from './nativeChatNavigation'
import {
  projectAgentWorkspace,
  type AgentWorkspaceAssetFact,
  type AgentWorkspaceRunFact,
  type AgentWorkspaceViewModel,
} from './agentWorkspaceProjection'

type CurrentProject = Readonly<{ id?: string | null; name: string }> | null
type CurrentFlow = Readonly<{ id?: string | null; name?: string | null; updatedAt?: string | null }> | null

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

function projectRunFact(status: 'running' | 'succeeded' | 'failed' | undefined): AgentWorkspaceRunFact {
  if (status === 'running') return { status, label: '设计任务正在进行' }
  if (status === 'failed') return { status, label: '本轮设计需要处理' }
  if (status === 'succeeded') return { status, label: '本轮设计已经完成' }
  return { status: 'idle', label: '等待你的设计意图' }
}

export function useAuthoritativeAgentWorkspaceViewModel(input: Readonly<{
  projects: readonly ProjectDto[]
  currentProject: CurrentProject
  currentFlow: CurrentFlow
}>): AgentWorkspaceViewModel {
  const nodes = useRFStore((state) => state.nodes)
  const runsBySessionKey = useLiveChatRunStore((state) => state.runsBySessionKey)
  const [, refreshNavigation] = React.useReducer((value) => value + 1, 0)

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

    const assets: AgentWorkspaceAssetFact[] = collectCanvasAssets(nodes as unknown[])
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
      }))

    const currentFlowId = String(input.currentFlow?.id || '').trim()
    const currentRun = Object.values(runsBySessionKey)
      .filter((run) => (
        (!currentProjectId || run.projectId === currentProjectId)
        && (!currentFlowId || run.flowId === currentFlowId)
        && (!currentSessionKey || run.sessionKey === currentSessionKey)
      ))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]

    return projectAgentWorkspace({
      projects: input.projects,
      currentProjectId,
      currentFlow: input.currentFlow,
      sessionsByProject,
      currentSessionId,
      assets,
      run: projectRunFact(currentRun?.status),
    })
  }, [input.currentFlow, input.currentProject?.id, input.projects, nodes, runsBySessionKey])
}
