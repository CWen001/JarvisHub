export type AgentWorkspaceProjectFact = Readonly<{
  id: string
  name: string
  updatedAt?: string
}>

export type AgentWorkspaceSessionFact = Readonly<{
  id: string
  title?: string
  updatedAt: number
}>

export type AgentWorkspaceAssetFact = Readonly<{
  nodeId: string
  title: string
  kind: 'image' | 'video'
  url: string
  thumbnailUrl?: string
  assetId?: string
  assetRefId?: string
  status: 'queued' | 'running' | 'success' | 'failed'
  updatedAt: number
  scope?: 'canvas' | 'all'
}>

export type AgentWorkspaceRunFact = Readonly<{
  status: 'idle' | 'running' | 'succeeded' | 'failed' | 'partial'
  label: string
}>

export type AgentWorkspaceAssetState = 'loading' | 'ready' | 'error'

export type AgentWorkspaceFacts = Readonly<{
  projects: readonly AgentWorkspaceProjectFact[]
  currentProjectId?: string | null
  currentFlow?: Readonly<{ id?: string | null; name?: string | null; updatedAt?: string | null }> | null
  sessionsByProject: Readonly<Record<string, readonly AgentWorkspaceSessionFact[]>>
  currentSessionId?: string | null
  assets?: readonly AgentWorkspaceAssetFact[]
  assetsState?: AgentWorkspaceAssetState
  assetsErrorMessage?: string
  run?: AgentWorkspaceRunFact | null
}>

export type AgentWorkspaceAssetView = Readonly<{
  nodeId?: string
  title: string
  kind: 'image' | 'video'
  url: string
  thumbnailUrl?: string
  assetId?: string
  assetRefId?: string
  scope: 'canvas' | 'all'
}>

export type AgentWorkspaceArtifactView = AgentWorkspaceAssetView & Readonly<{ nodeId: string }>

export type AgentWorkspaceViewModel = Readonly<{
  current: Readonly<{
    projectId: string
    projectName: string
    flowId: string
    flowName: string
    sessionId: string
    sessionTitle: string
  }> | null
  projects: readonly Readonly<{
    id: string
    name: string
    current: boolean
    sessions: readonly Readonly<{
      id: string
      title: string
      updatedAt: number
      current: boolean
    }>[]
  }>[]
  assets: Readonly<{
    state: AgentWorkspaceAssetState
    errorMessage: string
    count: number
    current: AgentWorkspaceArtifactView | null
    items: readonly AgentWorkspaceAssetView[]
  }>
  run: AgentWorkspaceRunFact
}>

export type AgentWorkspaceIntent =
  | Readonly<{ type: 'select-project'; projectId: string }>
  | Readonly<{ type: 'select-session'; projectId: string; sessionId: string }>
  | Readonly<{ type: 'new-session'; projectId: string }>
  | Readonly<{ type: 'new-flow'; projectId: string }>
  | Readonly<{ type: 'new-project' }>
  | Readonly<{ type: 'open-assets' }>
  | Readonly<{ type: 'asset.modify'; asset: AgentWorkspaceAssetView }>
  | Readonly<{ type: 'asset.add-to-canvas'; asset: AgentWorkspaceAssetView }>
  | Readonly<{ type: 'asset.reference'; asset: AgentWorkspaceAssetView }>
  | Readonly<{ type: 'open-professional-workspace'; nodeId?: string }>

export type NativeAgentWorkspaceCommand =
  | Readonly<{ type: 'project.select'; projectId: string }>
  | Readonly<{
      type: 'chat.navigate'
      command:
        | Readonly<{ type: 'select-session'; projectId: string; sessionId: string }>
        | Readonly<{ type: 'new-session'; projectId: string }>
    }>
  | Readonly<{ type: 'flow.create'; projectId: string }>
  | Readonly<{ type: 'project.create' }>
  | Readonly<{ type: 'assets.open' }>
  | Readonly<{ type: 'asset.modify'; asset: AgentWorkspaceAssetView }>
  | Readonly<{ type: 'asset.add-to-canvas'; asset: AgentWorkspaceAssetView }>
  | Readonly<{ type: 'asset.reference'; asset: AgentWorkspaceAssetView }>
  | Readonly<{ type: 'workspace.open-professional'; nodeId?: string }>

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stableSuccessfulArtifact(asset: AgentWorkspaceAssetFact): boolean {
  return Boolean(
    text(asset.nodeId)
    && text(asset.url)
    && asset.status === 'success'
    && (text(asset.assetId) || text(asset.assetRefId)),
  )
}

function projectAsset(asset: AgentWorkspaceAssetFact): AgentWorkspaceAssetView {
  return Object.freeze({
    ...(text(asset.nodeId) ? { nodeId: text(asset.nodeId) } : {}),
    title: text(asset.title) || (asset.kind === 'video' ? '生成视频' : '生成图片'),
    kind: asset.kind,
    url: text(asset.url),
    ...(text(asset.thumbnailUrl) ? { thumbnailUrl: text(asset.thumbnailUrl) } : {}),
    ...(text(asset.assetId) ? { assetId: text(asset.assetId) } : {}),
    ...(text(asset.assetRefId) ? { assetRefId: text(asset.assetRefId) } : {}),
    scope: asset.scope === 'all' ? 'all' : 'canvas',
  })
}

export function projectAgentWorkspace(facts: AgentWorkspaceFacts): AgentWorkspaceViewModel {
  const currentProjectId = text(facts.currentProjectId)
  const currentSessionId = text(facts.currentSessionId)
  const projects = facts.projects.map((project) => {
    const id = text(project.id)
    const current = Boolean(id && id === currentProjectId)
    const sessions = Object.freeze(
      [...(facts.sessionsByProject[id] ?? [])]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((session) => Object.freeze({
          id: text(session.id),
          title: text(session.title) || '新对话',
          updatedAt: session.updatedAt,
          current: current && text(session.id) === currentSessionId,
        })),
    )
    return Object.freeze({ id, name: text(project.name) || '未命名项目', current, sessions })
  })
  const currentProject = projects.find((project) => project.current) ?? null
  const currentSession = currentProject?.sessions.find((session) => session.current) ?? null
  const usableAssets = [...(facts.assets ?? [])]
    .filter((asset) => (
      asset.status === 'success'
      && Boolean(text(asset.url))
      && Boolean(text(asset.assetId) || text(asset.assetRefId))
    ))
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const projectedAssets = Object.freeze(usableAssets.map(projectAsset))
  const currentArtifactFact = usableAssets.find(stableSuccessfulArtifact)
  const currentArtifact = currentArtifactFact
    ? Object.freeze({ ...projectAsset(currentArtifactFact), nodeId: text(currentArtifactFact.nodeId) })
    : null
  const flowId = text(facts.currentFlow?.id)
  const flowName = text(facts.currentFlow?.name)

  return Object.freeze({
    current: currentProject
      ? Object.freeze({
          projectId: currentProject.id,
          projectName: currentProject.name,
          flowId,
          flowName,
          sessionId: currentSession?.id ?? '',
          sessionTitle: currentSession?.title ?? '',
        })
      : null,
    projects: Object.freeze(projects),
    assets: Object.freeze({
      state: facts.assetsState ?? 'ready',
      errorMessage: text(facts.assetsErrorMessage),
      count: projectedAssets.length,
      current: currentArtifact,
      items: projectedAssets,
    }),
    run: Object.freeze(facts.run ?? { status: 'idle', label: '等待你的设计意图' }),
  })
}

export function resolveAgentWorkspaceIntent(intent: AgentWorkspaceIntent): NativeAgentWorkspaceCommand {
  if (intent.type === 'select-project') {
    return Object.freeze({ type: 'project.select', projectId: text(intent.projectId) })
  }
  if (intent.type === 'select-session') {
    return Object.freeze({
      type: 'chat.navigate',
      command: Object.freeze({
        type: 'select-session',
        projectId: text(intent.projectId),
        sessionId: text(intent.sessionId),
      }),
    })
  }
  if (intent.type === 'new-session') {
    return Object.freeze({
      type: 'chat.navigate',
      command: Object.freeze({ type: 'new-session', projectId: text(intent.projectId) }),
    })
  }
  if (intent.type === 'new-flow') {
    return Object.freeze({ type: 'flow.create', projectId: text(intent.projectId) })
  }
  if (intent.type === 'new-project') return Object.freeze({ type: 'project.create' })
  if (intent.type === 'open-assets') return Object.freeze({ type: 'assets.open' })
  if (intent.type === 'asset.modify' || intent.type === 'asset.add-to-canvas' || intent.type === 'asset.reference') {
    return Object.freeze({ type: intent.type, asset: intent.asset })
  }
  return Object.freeze({
    type: 'workspace.open-professional',
    ...(text(intent.nodeId) ? { nodeId: text(intent.nodeId) } : {}),
  })
}
