type BuildEffectiveChatSessionKeyInput = {
  persistedBaseKey: string | null | undefined
  projectId: string | null | undefined
  flowId: string | null | undefined
  lane: ChatSessionLane
}

export type ChatSessionLane = 'general'

type BoundChatSessionTab = {
  baseKey: string
  sessionKey?: string
  sessionScope?: {
    projectId: string
    flowId: string
    lane: ChatSessionLane
    skill: {
      id: string
      key: string
      name: string
    } | null
  }
}

type ResolveEffectiveChatSessionKeyInput = {
  tab: BoundChatSessionTab | null | undefined
  projectId: string | null | undefined
  flowId: string | null | undefined
  lane: ChatSessionLane
}

function normalizeSegment(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildProjectScopedChatSessionBaseKey(input: {
  projectId: string | null | undefined
  flowId: string | null | undefined
}): string {
  const projectId = normalizeSegment(input.projectId)
  if (!projectId) return ''
  const flowId = normalizeSegment(input.flowId)
  return flowId ? `project:${projectId}:flow:${flowId}` : `project:${projectId}`
}

export function buildEffectiveChatSessionKey(input: BuildEffectiveChatSessionKeyInput): string {
  const projectScopedBaseKey = buildProjectScopedChatSessionBaseKey({
    projectId: input.projectId,
    flowId: input.flowId,
  })
  const persistedBaseKey = normalizeSegment(input.persistedBaseKey)
  const baseKey = projectScopedBaseKey
    ? persistedBaseKey
      ? `${projectScopedBaseKey}:conversation:${persistedBaseKey}`
      : projectScopedBaseKey
    : persistedBaseKey
  if (!baseKey) return ''
  const lane = normalizeSegment(input.lane) || 'general'
  return `${baseKey}:lane:${lane}`
}

function canUseBoundChatSessionKey(input: ResolveEffectiveChatSessionKeyInput): boolean {
  const sessionKey = normalizeSegment(input.tab?.sessionKey)
  const scope = input.tab?.sessionScope
  if (!sessionKey || !scope) return false

  const currentProjectId = normalizeSegment(input.projectId)
  const boundProjectId = normalizeSegment(scope.projectId)
  if (!currentProjectId || boundProjectId !== currentProjectId) return false

  const currentLane = normalizeSegment(input.lane) || 'general'
  if (normalizeSegment(scope.lane) !== currentLane) return false

  return true
}

export function resolveEffectiveChatSessionKey(input: ResolveEffectiveChatSessionKeyInput): string {
  if (canUseBoundChatSessionKey(input)) {
    return normalizeSegment(input.tab?.sessionKey)
  }
  return buildEffectiveChatSessionKey({
    persistedBaseKey: input.tab?.baseKey || '',
    projectId: input.projectId,
    flowId: input.flowId,
    lane: input.lane,
  })
}

export function resolveChatSessionLane(input: {
  hasReplicateTarget: boolean
}): ChatSessionLane {
  void input.hasReplicateTarget
  return 'general'
}
