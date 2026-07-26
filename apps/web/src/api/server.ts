import type { Edge, Node } from '@xyflow/react'
import type { PublicFlowAnchorBinding } from '@jarvishub/flow-anchor-bindings'
import type { ApprovalStatus, CreationStage, ProductionLayer } from '../canvas/productionMeta'
import { getAuthToken, getAuthTokenFromCookie, type User } from '../auth/store'
import { sanitizeFlowValueForPersistence } from '../canvas/utils/persistenceSanitizer'
import { useUploadRuntimeStore } from '../domain/upload-runtime/store/uploadRuntimeStore'
import { buildFlowUpsertRequestBody } from './flowSaveGuard'
import { createSseEventParser } from './sse'
// self-import guard: only used for type re-export in the same module

const viteEnv = ((import.meta as any).env || {}) as Record<string, any>
const DEFAULT_PRODUCTION_API_BASE = '/api'
const explicitApiBase =
  typeof viteEnv.VITE_API_BASE === 'string' && viteEnv.VITE_API_BASE.trim()
    ? viteEnv.VITE_API_BASE.trim()
    : null
export const API_BASE =
  explicitApiBase ||
  (viteEnv.DEV ? 'http://localhost:8788' : DEFAULT_PRODUCTION_API_BASE)

function buildProxyImageUrl(rawImageUrl: string): string {
  const trimmed = rawImageUrl.trim()
  const suffix = `/assets/proxy-image?url=${encodeURIComponent(trimmed)}`
  if (viteEnv.DEV && !explicitApiBase) {
    return `/api${suffix}`
  }
  const base = (API_BASE || '').trim()
  if (base) {
    return `${base.replace(/\/+$/, '')}${suffix}`
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  if (!origin) return suffix
  return `${origin.replace(/\/+$/, '')}${suffix}`
}

function withAuth(init?: RequestInit): RequestInit {
  const t = getAuthToken() || getAuthTokenFromCookie()
  return {
    credentials: init?.credentials ?? 'include',
    ...(init || {}),
    headers: { ...(init?.headers || {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
  }
}

function withPublicWorkspace(init?: RequestInit): RequestInit {
  return {
    credentials: init?.credentials ?? 'omit',
    ...(init || {}),
    headers: {
      ...(init?.headers || {}),
    },
  }
}

function withoutAuth(init?: RequestInit): RequestInit {
  return {
    credentials: init?.credentials ?? 'omit',
    ...(init || {}),
    headers: { ...(init?.headers || {}) },
  }
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = String(init?.method || 'GET').trim().toUpperCase()
  const shouldRetry = method === 'GET' || method === 'HEAD'
  const maxAttempts = shouldRetry ? 3 : 1
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(input, init)
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message.trim().toLowerCase() : ''
      const transient =
        error instanceof TypeError
        || message.includes('failed to fetch')
        || message.includes('networkerror')
        || message.includes('socket')
      if (!shouldRetry || !transient || attempt >= maxAttempts) {
        throw error
      }
      await new Promise((resolve) => window.setTimeout(resolve, attempt * 250))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('api fetch failed')
}

type ApiRequestError = Error & {
  status?: number
  code?: string
  details?: unknown
  progress?: unknown
}

async function throwApiError(r: Response, fallbackMessage: string): Promise<never> {
  let msg = fallbackMessage
  let body: unknown = null
  try {
    body = await r.json()
    if (body && typeof body === 'object') {
      const candidateMessage = 'message' in body ? body.message : 'error' in body ? body.error : null
      if (typeof candidateMessage === 'string' && candidateMessage.trim()) {
        msg = candidateMessage
      }
    }
  } catch {
    // ignore body parse error
  }
  const err: ApiRequestError = new Error(msg)
  err.status = r.status
  if (body && typeof body === 'object') {
    err.code = 'code' in body && typeof body.code === 'string' ? body.code : undefined
    err.details = 'details' in body ? body.details : undefined
    err.progress = 'progress' in body ? body.progress : undefined
  }
  throw err
}

async function readJsonResponse(response: Response, invalidResponseMessage: string): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error(invalidResponseMessage)
  }
}

export async function fetchProxiedImageBlob(rawImageUrl: string): Promise<Blob> {
  const trimmed = typeof rawImageUrl === 'string' ? rawImageUrl.trim() : ''
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('only http/https image urls are allowed')
  }
  const response = await apiFetch(buildProxyImageUrl(trimmed), withAuth({
    method: 'GET',
    headers: {
      Accept: 'image/*',
    },
  }))
  if (!response.ok) {
    await throwApiError(response, 'image proxy fetch failed')
  }
  const contentType = response.headers.get('content-type') || ''
  if (!/^image\//i.test(contentType)) {
    throw new Error(`proxied resource is not an image: ${contentType || 'unknown'}`)
  }
  return await response.blob()
}

type AuthResponseDto = {
  token: string
  user: User
}

type AuthErrorBody = {
  error?: string
  message?: string
  code?: string
  details?: unknown
  sent?: boolean
  expiresInSeconds?: number
  devCode?: string
  delivery?: 'sms' | 'debug'
}

async function parseAuthErrorBody(response: Response): Promise<AuthErrorBody | null> {
  try {
    return await response.json() as AuthErrorBody
  } catch {
    return null
  }
}

export type FlowDto = {
  id: string
  name: string
  ownerType?: string | null
  ownerId?: string | null
  data: {
    nodes: Node[]
    edges: Edge[]
    viewport?: { x: number; y: number; zoom: number } | null
    sceneCreationProgress?: unknown
  }
  createdAt: string
  updatedAt: string
}
export type ProjectDto = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export type DreaminaAccountDto = {
  id: string
  ownerId: string
  label: string
  cliPath: string | null
  sessionRoot: string
  enabled: boolean
  lastHealthcheckAt: string | null
  lastLoginAt: string | null
  lastError: string | null
  meta?: unknown
  createdAt: string
  updatedAt: string
}

export type DreaminaAccountProbeDto = {
  accountId: string
  ok: boolean
  version?: string | null
  loggedIn: boolean
  creditText?: string | null
  message: string
  stdout?: string | null
  stderr?: string | null
  checkedAt: string
}

export type DreaminaProjectBindingDto = {
  id: string
  ownerId: string
  projectId: string
  accountId: string
  enabled: boolean
  defaultModelVersion?: string | null
  defaultRatio?: string | null
  defaultResolutionType?: string | null
  defaultVideoResolution?: string | null
  createdAt: string
  updatedAt: string
}

export type VendorCallLogStatus = 'running' | 'succeeded' | 'failed'

export type VendorCallLogDto = {
  vendor: string
  taskId: string
  userId: string
  userLogin?: string | null
  userName?: string | null
  taskKind?: string | null
  status: VendorCallLogStatus
  startedAt?: string | null
  finishedAt?: string | null
  durationMs?: number | null
  errorMessage?: string | null
  requestPayload?: string | null
  upstreamResponse?: string | null
  createdAt: string
  updatedAt: string
}

export type VendorCallLogListResponseDto = {
  items: VendorCallLogDto[]
  hasMore: boolean
  nextBefore: string | null
}

export type AgentPipelineStage =
  | 'material_ingest'
  | 'script_breakdown'
  | 'shot_planning'
  | 'image_generation'
  | 'video_generation'
  | 'qc_publish'

export type AgentPipelineRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export type AgentPipelineRunDto = {
  id: string
  ownerId: string
  projectId: string
  title: string
  goal?: string | null
  status: AgentPipelineRunStatus
  stages: AgentPipelineStage[]
  progress?: any
  result?: any
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
  startedAt?: string | null
  finishedAt?: string | null
}

export type MaterialKindDto = 'character' | 'scene' | 'prop' | 'style'

export type MaterialAssetDto = {
  id: string
  projectId: string
  kind: MaterialKindDto
  name: string
  currentVersion: number
  latestVersion?: MaterialAssetVersionDto | null
  createdAt: string
  updatedAt: string
}

export type MaterialAssetVersionDto = {
  id: string
  assetId: string
  projectId: string
  version: number
  data: Record<string, unknown>
  note: string | null
  createdAt: string
}


export type ProfileKind =
  | 'chat'
  | 'prompt_refine'
  | 'text_to_image'
  | 'image_to_prompt'
  | 'image_to_video'
  | 'text_to_video'
  | 'image_edit'

export type ModelProfileDto = {
  id: string
  ownerId: string
  providerId: string
  name: string
  kind: ProfileKind
  modelKey: string
  settings?: any
  provider?: { id: string; name: string; vendor: string }
}

export type AvailableModelDto = {
  value: string
  label: string
  vendor?: string
}

export type PromptSampleDto = {
  id: string
  scene: string
  commandType: string
  title: string
  nodeKind: 'image' | 'composeVideo'
  prompt: string
  description?: string
  inputHint?: string
  outputNote?: string
  keywords: string[]
  source?: 'official' | 'custom'
}

export type PromptSampleInput = {
  scene: string
  commandType: string
  title: string
  nodeKind: 'image' | 'composeVideo'
  prompt: string
  description?: string
  inputHint?: string
  outputNote?: string
  keywords?: string[]
}

export type LlmNodePresetType = 'text' | 'image' | 'video'

export type LlmNodePresetDto = {
  id: string
  title: string
  type: LlmNodePresetType
  prompt: string
  description?: string
  scope: 'base' | 'user'
  enabled?: boolean
  sortOrder?: number | null
  createdAt: string
  updatedAt: string
}

export type CreateLlmNodePresetInput = {
  title: string
  type: LlmNodePresetType
  prompt: string
  description?: string
}

export type PromptGeneratePayload = {
  workflow: 'character_creation' | 'direct_image' | 'merchandise'
  subject: string
  visual_style?: string
  model?: string
  consistency?: string
  language?: 'zh' | 'en'
}

export type PromptGenerateResult = {
  workflow: string
  prompt: string
  negative_prompt: string
  suggested_aspects: string[]
  notes: string[]
}

export type AgentsChatRequestDto = {
  vendor?: string
  vendorCandidates?: string[]
  prompt: string
  displayPrompt?: string
  response_format?: unknown
  sessionKey?: string
  userMessageId: string
  assistantMessageId: string
  canvasProjectId?: string
  canvasFlowId?: string
  canvasNodeId?: string
  chatContext?: {
    currentProjectName?: string
    skill?: {
      key?: string
      name?: string
      content?: string
    }
    selectedNodeLabel?: string
    selectedNodeKind?: string
    selectedNodeTextPreview?: string
    selectedReference?: {
      nodeId?: string
      label?: string
      kind?: string
      anchorBindings?: Array<{
        kind: 'character' | 'scene' | 'prop' | 'shot' | 'story' | 'asset' | 'context'
        refId?: string
        entityId?: string
        label?: string
        sourceBookId?: string
        sourceNodeId?: string
        assetId?: string
        assetRefId?: string
        imageUrl?: string
        referenceView?: 'three_view' | 'role_card'
        category?: string
        note?: string
      }>
      imageUrl?: string
      sourceUrl?: string
      productionLayer?: ProductionLayer
      creationStage?: CreationStage
      approvalStatus?: ApprovalStatus
      hasUpstreamTextEvidence?: boolean
      hasDownstreamComposeVideo?: boolean
    }
  }
  planOnly?: boolean
  forceAssetGeneration?: boolean
  requestedImageCount?: number
  aspectRatio?: string
  systemPrompt?: string
  modelAlias?: string
  modelKey?: string
  temperature?: number
  disableQualityReview?: boolean
  disableMemory?: boolean
  mode?: 'chat' | 'auto'
  referenceImages?: string[]
  selectedMediaReferences?: Array<{
    nodeId?: string
    kind: 'image' | 'video'
    url: string
    thumbnailUrl?: string
    label?: string
  }>
  requiredSkills?: string[]
  stream?: boolean
  assetInputs?: Array<{
    assetId?: string
    assetRefId?: string
    url?: string
    role?: 'target' | 'reference' | 'character' | 'scene' | 'prop' | 'product' | 'style' | 'context' | 'mask'
    weight?: number
    note?: string
    name?: string
  }>
}

export type AgentsChatResponseDto = {
  id: string
  vendor: string
  text: string
  agentDecision?: {
    executionKind: 'plan' | 'execute' | 'generate' | 'answer'
    canvasAction: 'create_canvas_workflow' | 'write_canvas' | 'none'
    assetCount: number
    projectStateRead: boolean
    requiresConfirmation: boolean
    reason: string
  }
  trace?: {
    requestId?: string
    sessionId?: string
    outputMode: 'plan_with_assets' | 'plan_only' | 'direct_assets' | 'text_only'
    toolEvidence?: {
      toolNames: string[]
      readProjectState: boolean
      readNodeContextBundle: boolean
      readVideoReviewBundle: boolean
      readMaterialAssets: boolean
      generatedAssets: boolean
      wroteCanvas: boolean
    }
    toolStatusSummary?: {
      totalToolCalls: number
      succeededToolCalls: number
      failedToolCalls: number
      deniedToolCalls: number
      blockedToolCalls: number
      runMs: number | null
    }
    canvasMutation?: {
      createdNodeIds: string[]
      patchedNodeIds: string[]
      executableNodeIds: string[]
      deletedNodeIds: string[]
      deletedEdgeIds: string[]
    }
    diagnosticFlags?: Array<{
      code: string
      severity: 'high' | 'medium'
      title: string
      detail: string
    }>
    canvasPlan?: {
      tagPresent: boolean
      normalized: boolean
      parseSuccess: boolean
      error: string
      errorCode: string
      errorDetail: string
      schemaIssues: string[]
      detectedTagName: string
      nodeCount: number
      edgeCount: number
      nodeKinds: string[]
      hasAssetUrls: boolean
      action: string
      summary: string
      reason: string
      rawPayload: string
    }
    turnVerdict?: {
      status: 'satisfied' | 'partial' | 'failed'
      reasons: string[]
    }
    todoList?: {
      sourceToolCallId: string
      items: Array<{
        text: string
        completed: boolean
        status: 'pending' | 'in_progress' | 'waiting' | 'blocked' | 'completed'
      }>
      totalCount: number
      completedCount: number
      inProgressCount: number
      waitingCount: number
      blockedCount: number
      pendingCount: number
    }
    todoEvents?: Array<{
      sourceToolCallId: string
      items: Array<{
        text: string
        completed: boolean
        status: 'pending' | 'in_progress' | 'waiting' | 'blocked' | 'completed'
      }>
      totalCount: number
      completedCount: number
      inProgressCount: number
      waitingCount: number
      blockedCount: number
      pendingCount: number
      atMs: number | null
      startedAt: string | null
      finishedAt: string | null
      durationMs: number | null
    }>
  }
  assets?: Array<{
    type?: string
    title?: string
    url?: string
    thumbnailUrl?: string
    assetId?: string
    assetRefId?: string
    vendor?: string
    modelKey?: string
    taskId?: string
  }>
}

export type AgentsChatToolStreamPayload = {
  toolCallId: string
  toolName: string
  phase: 'started' | 'completed'
  status?: 'succeeded' | 'failed' | 'denied' | 'blocked'
  input?: unknown
  outputPreview?: string
  outputJson?: Record<string, unknown>
  canvasMutation?: {
    wroteCanvas: boolean
    flowId: string
    createdNodeIds?: string[]
    updatedNodeIds?: string[]
    deletedNodeIds?: string[]
    deletedEdgeIds?: string[]
    assetUrls?: string[]
  }
  errorMessage?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  agentId?: string
  agentType?: string
  agentDepth?: number
  parentToolCallId?: string
}

export type AgentsChatLifecycleStreamPayload = Record<string, unknown>

export type AgentsChatMediaResultStreamPayload = {
  kind: 'image' | 'video'
  nodeId: string
  taskId: string
  toolCallId: string
  toolName: 'canvas_image_generate_to_canvas' | 'canvas_video_generate_to_canvas'
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  pending: boolean
  progress?: number
  url?: string
  thumbnailUrl?: string
  errorMessage?: string
  flowId: string
  emittedAt: string
}

export type AgentsChatStreamEvent = (
  | { event: 'initial'; data: { requestId: string; messageId: string; runId?: string } }
  | { event: 'session'; data: { sessionId: string } }
  | {
    event: 'thinking'
    data: {
      /** User-visible assistant progress text only; never hidden chain-of-thought. */
      text: string
      turnId?: string
      turnIndex?: number
      toolNames?: string[]
      toolCallCount?: number
      agentId?: string
      agentType?: string
      agentDepth?: number
      parentToolCallId?: string
    }
  }
  | { event: 'tool'; data: AgentsChatToolStreamPayload }
  | { event: 'media_result'; data: AgentsChatMediaResultStreamPayload }
  | {
    event: 'todo_list'
    data: {
      threadId: string
      turnId: string
      sourceToolCallId: string
      items: Array<{
        text: string
        completed: boolean
        status: 'pending' | 'in_progress' | 'waiting' | 'blocked' | 'completed'
      }>
      totalCount: number
      completedCount: number
      inProgressCount: number
      waitingCount: number
      blockedCount: number
      pendingCount: number
      agentId?: string
      agentType?: string
      agentDepth?: number
      parentToolCallId?: string
    }
  }
  | {
    event: 'content'
    data: {
      delta: string
      agentId?: string
      agentType?: string
      agentDepth?: number
      parentToolCallId?: string
    }
  }
  | { event: 'result'; data: { response: AgentsChatResponseDto } }
  | { event: 'error'; data: { message: string; code?: string; details?: unknown } }
  | { event: 'aborted'; data: { reason?: string } }
  | { event: 'done'; data: { reason: 'finished' | 'error' | 'aborted' } }
  | { event: 'thread.started'; data: AgentsChatLifecycleStreamPayload }
  | { event: 'turn.started'; data: AgentsChatLifecycleStreamPayload }
  | { event: 'item.started'; data: AgentsChatLifecycleStreamPayload }
  | { event: 'item.updated'; data: AgentsChatLifecycleStreamPayload }
  | { event: 'item.completed'; data: AgentsChatLifecycleStreamPayload }
  | { event: 'turn.completed'; data: AgentsChatLifecycleStreamPayload }
) & { seq?: number }

export type AgentsChatRunSummaryDto = {
  runId: string
  status: 'running' | 'succeeded' | 'failed' | 'aborted'
  sessionKey: string
  canvasProjectId: string | null
  canvasFlowId: string | null
  requestText: string
  displayText: string
  userMessageId: string
  assistantMessageId: string
  request: unknown
  response: unknown
  error: unknown
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export type AgentsChatActiveRunsResponseDto = {
  runs: AgentsChatRunSummaryDto[]
}

export type PublicVisionRequestDto = {
  vendor?: string
  vendorCandidates?: string[]
  imageUrl?: string
  imageData?: string
  prompt?: string
  modelAlias?: string
  modelKey?: string
  temperature?: number
}

export type PublicVisionResponseDto = {
  id?: string
  vendor?: string
  text?: string
  raw?: any
}

export async function abortAgentsChatRun(input: { runId: string }): Promise<{ aborted: boolean }> {
  const runId = String(input.runId || '').trim()
  if (!runId) return { aborted: false }
  try {
    const response = await apiFetch(
      `${API_BASE}/public/agents/chat/runs/${encodeURIComponent(runId)}/abort`,
      withAuth({
        method: 'POST',
        headers: { Accept: 'application/json', ...getClientPageTraceHeaders() },
      }),
    )
    if (!response.ok) {
      return { aborted: false }
    }
    const body = (await response.json().catch(() => ({}))) as { aborted?: boolean }
    return { aborted: body?.aborted === true }
  } catch {
    return { aborted: false }
  }
}

export async function listActiveAgentsChatRuns(input: {
  sessionKey: string
  canvasProjectId?: string
  canvasFlowId?: string
}): Promise<AgentsChatActiveRunsResponseDto> {
  const params = new URLSearchParams()
  params.set('sessionKey', input.sessionKey)
  if (input.canvasProjectId) params.set('canvasProjectId', input.canvasProjectId)
  if (input.canvasFlowId) params.set('canvasFlowId', input.canvasFlowId)
  const response = await apiFetch(`${API_BASE}/public/agents/chat/runs/active?${params.toString()}`, withAuth({
    method: 'GET',
    headers: { Accept: 'application/json', ...getClientPageTraceHeaders() },
  }))
  if (!response.ok) {
    await throwApiError(response, `agents chat active runs failed: ${response.status}`)
  }
  return await response.json() as AgentsChatActiveRunsResponseDto
}

function parseAgentsChatStreamSeq(rawId: string): number | undefined {
  if (!rawId) return undefined
  const n = Number(rawId)
  return Number.isFinite(n) ? n : undefined
}

function isAgentsChatTerminalEvent(eventName: string): boolean {
  return eventName === 'result' || eventName === 'error' || eventName === 'aborted' || eventName === 'done'
}

export async function agentsChatStream(
  payload: AgentsChatRequestDto,
  handlers: {
    onEvent: (event: AgentsChatStreamEvent) => void
    onOpen?: () => void
    onError?: (error: Error) => void
  },
): Promise<() => void> {
  const controller = new AbortController()
  const response = await apiFetch(resolveAgentsChatEndpoint(payload), withAuth({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...getClientPageTraceHeaders(),
    },
    body: JSON.stringify({ ...payload, stream: true }),
    signal: controller.signal,
  }))

  if (!response.ok) {
    let msg = `agents chat stream failed: ${response.status}`
    try {
      const body: any = await response.json()
      msg = body?.message || body?.error || msg
    } catch {
      // ignore
    }
    throw new Error(msg)
  }

  if (!response.body) {
    throw new Error('agents chat stream missing body')
  }

  handlers.onOpen?.()

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseEventParser()
  let sawTerminalEvent = false

  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const events = parser.push(decoder.decode(value, { stream: true }))
        for (const event of events) {
          const payloadText = String(event.data || '').trim()
          if (!payloadText) continue
          try {
            const payload = JSON.parse(payloadText) as Record<string, unknown>
            if (isAgentsChatTerminalEvent(event.event)) {
              sawTerminalEvent = true
            }
            handlers.onEvent({
              event: event.event as AgentsChatStreamEvent['event'],
              data: payload,
              seq: parseAgentsChatStreamSeq(event.id),
            } as AgentsChatStreamEvent)
          } catch (error) {
            console.warn('[agentsChatStream] invalid payload', error, payloadText.slice(0, 200))
          }
        }
      }
      for (const event of parser.finish()) {
        const payloadText = String(event.data || '').trim()
        if (!payloadText) continue
        try {
          const payload = JSON.parse(payloadText) as Record<string, unknown>
          if (isAgentsChatTerminalEvent(event.event)) {
            sawTerminalEvent = true
          }
          handlers.onEvent({
            event: event.event as AgentsChatStreamEvent['event'],
            data: payload,
            seq: parseAgentsChatStreamSeq(event.id),
          } as AgentsChatStreamEvent)
        } catch (error) {
          console.warn('[agentsChatStream] invalid payload', error, payloadText.slice(0, 200))
        }
      }
      if (!controller.signal.aborted && !sawTerminalEvent) {
        handlers.onError?.(new Error('agents chat stream ended before terminal event'))
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        handlers.onError?.(error instanceof Error ? error : new Error('agents chat stream error'))
      }
    } finally {
      reader.releaseLock()
    }
  }

  void pump()

  return () => controller.abort()
}

export async function agentsChatRunEventsStream(
  input: {
    runId: string
    afterSeq?: number
  },
  handlers: {
    onEvent: (event: AgentsChatStreamEvent) => void
    onOpen?: () => void
    onError?: (error: Error) => void
  },
): Promise<() => void> {
  const controller = new AbortController()
  const params = new URLSearchParams()
  params.set('afterSeq', String(Math.max(0, Math.trunc(Number(input.afterSeq ?? 0)))))
  const response = await apiFetch(
    `${API_BASE}/public/agents/chat/runs/${encodeURIComponent(input.runId)}/events?${params.toString()}`,
    withAuth({
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...getClientPageTraceHeaders(),
      },
      signal: controller.signal,
    }),
  )

  if (!response.ok) {
    await throwApiError(response, `agents chat run events failed: ${response.status}`)
  }

  if (!response.body) {
    throw new Error('agents chat run events stream missing body')
  }

  handlers.onOpen?.()

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseEventParser()
  let sawTerminalEvent = false

  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const events = parser.push(decoder.decode(value, { stream: true }))
        for (const event of events) {
          const payloadText = String(event.data || '').trim()
          if (!payloadText) continue
          try {
            const payload = JSON.parse(payloadText) as Record<string, unknown>
            if (isAgentsChatTerminalEvent(event.event)) {
              sawTerminalEvent = true
            }
            handlers.onEvent({
              event: event.event as AgentsChatStreamEvent['event'],
              data: payload,
              seq: parseAgentsChatStreamSeq(event.id),
            } as AgentsChatStreamEvent)
          } catch (error) {
            console.warn('[agentsChatRunEventsStream] invalid payload', error, payloadText.slice(0, 200))
          }
        }
      }
      for (const event of parser.finish()) {
        const payloadText = String(event.data || '').trim()
        if (!payloadText) continue
        try {
          const payload = JSON.parse(payloadText) as Record<string, unknown>
          if (isAgentsChatTerminalEvent(event.event)) {
            sawTerminalEvent = true
          }
          handlers.onEvent({
            event: event.event as AgentsChatStreamEvent['event'],
            data: payload,
            seq: parseAgentsChatStreamSeq(event.id),
          } as AgentsChatStreamEvent)
        } catch (error) {
          console.warn('[agentsChatRunEventsStream] invalid payload', error, payloadText.slice(0, 200))
        }
      }
      if (!controller.signal.aborted && !sawTerminalEvent) {
        handlers.onError?.(new Error('agents chat run events stream ended before terminal event'))
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        handlers.onError?.(error instanceof Error ? error : new Error('agents chat run events stream error'))
      }
    } finally {
      reader.releaseLock()
    }
  }

  void pump()

  return () => controller.abort()
}

export async function agentsChat(
  payload: AgentsChatRequestDto,
  options?: { signal?: AbortSignal },
): Promise<AgentsChatResponseDto> {
  const r = await apiFetch(resolveAgentsChatEndpoint(payload), withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getClientPageTraceHeaders() },
    body: JSON.stringify(payload),
    signal: options?.signal,
  }))
  if (!r.ok) {
    let msg = `agents chat failed: ${r.status}`
    try {
      const body: any = await r.json()
      msg = body?.message || body?.error || msg
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
  return r.json()
}

function resolveAgentsChatEndpoint(payload: AgentsChatRequestDto): string {
  void payload
  return `${API_BASE}/public/agents/chat`
}

export async function publicVisionWithAuth(payload: PublicVisionRequestDto): Promise<PublicVisionResponseDto> {
  const r = await apiFetch(`${API_BASE}/public/vision`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    let msg = `public vision failed: ${r.status}`
    try {
      const body: any = await r.json()
      msg = body?.message || body?.error || msg
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
  return r.json()
}

export type AgentSkillDto = {
  id: string
  key: string
  name: string
  description?: string | null
  content: string
  enabled: boolean
  visible: boolean
  sortOrder?: number | null
  createdAt: string
  updatedAt: string
}

export type RuntimeAgentSkillDto = {
  id: string
  key: string
  name: string
  description: string
  source: 'agents-cli'
  enabled: true
  visible: true
  sortOrder?: number | null
  createdAt: string
  updatedAt: string
}

export type RuntimeAgentSkillsResponseDto = {
  skills: RuntimeAgentSkillDto[]
  loadErrors: string[]
}

function isAgentSkill(value: unknown): value is AgentSkillDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as {
    id?: unknown
    key?: unknown
    name?: unknown
    description?: unknown
    content?: unknown
    enabled?: unknown
    visible?: unknown
    sortOrder?: unknown
    createdAt?: unknown
    updatedAt?: unknown
  }
  const descriptionValid =
    typeof item.description === 'undefined' ||
    item.description === null ||
    typeof item.description === 'string'
  const sortOrderValid =
    typeof item.sortOrder === 'undefined' ||
    item.sortOrder === null ||
    typeof item.sortOrder === 'number'
  return (
    typeof item.id === 'string' &&
    typeof item.key === 'string' &&
    typeof item.name === 'string' &&
    descriptionValid &&
    typeof item.content === 'string' &&
    typeof item.enabled === 'boolean' &&
    typeof item.visible === 'boolean' &&
    sortOrderValid &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  )
}

export async function getAgentSkill(): Promise<AgentSkillDto | null> {
  const r = await apiFetch(`${API_BASE}/agents/skill`, withAuth())
  if (!r.ok) throw new Error(`get agent skill failed: ${r.status}`)
  const body = await readJsonResponse(r, 'get agent skill failed: invalid response')
  const skill =
    body && typeof body === 'object' && !Array.isArray(body) && 'skill' in body
      ? body.skill
      : null
  if (skill === null || typeof skill === 'undefined') return null
  if (!isAgentSkill(skill)) throw new Error('get agent skill failed: invalid response')
  return skill
}

export async function listPublicAgentSkills(): Promise<AgentSkillDto[]> {
  const r = await apiFetch(`${API_BASE}/agents/skills`, withAuth())
  if (!r.ok) throw new Error(`list public agent skills failed: ${r.status}`)
  const body = await readJsonResponse(r, 'list public agent skills failed: invalid response')
  if (!Array.isArray(body)) throw new Error('list public agent skills failed: invalid response')
  const skills = body.filter(isAgentSkill)
  if (skills.length !== body.length) throw new Error('list public agent skills failed: invalid item')
  return skills
}

function isRuntimeAgentSkill(value: unknown): value is RuntimeAgentSkillDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as {
    id?: unknown
    key?: unknown
    name?: unknown
    description?: unknown
    source?: unknown
    enabled?: unknown
    visible?: unknown
    sortOrder?: unknown
    createdAt?: unknown
    updatedAt?: unknown
  }
  const sortOrderValid =
    typeof item.sortOrder === 'undefined' ||
    item.sortOrder === null ||
    typeof item.sortOrder === 'number'
  return (
    typeof item.id === 'string' &&
    typeof item.key === 'string' &&
    typeof item.name === 'string' &&
    typeof item.description === 'string' &&
    item.source === 'agents-cli' &&
    item.enabled === true &&
    item.visible === true &&
    sortOrderValid &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  )
}

export async function listRuntimeAgentSkills(): Promise<RuntimeAgentSkillsResponseDto> {
  const r = await apiFetch(`${API_BASE}/agents/runtime-skills`, withAuth())
  if (!r.ok) throw new Error(`list runtime agent skills failed: ${r.status}`)
  const body = await readJsonResponse(r, 'list runtime agent skills failed: invalid response')
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('list runtime agent skills failed: invalid response')
  }
  const wrapper = body as { skills?: unknown; loadErrors?: unknown }
  if (!Array.isArray(wrapper.skills) || !Array.isArray(wrapper.loadErrors)) {
    throw new Error('list runtime agent skills failed: invalid response')
  }
  const skills = wrapper.skills.filter(isRuntimeAgentSkill)
  const loadErrors: string[] = []
  for (const entry of wrapper.loadErrors) {
    if (typeof entry !== 'string') {
      throw new Error('list runtime agent skills failed: invalid response')
    }
    loadErrors.push(entry)
  }
  return { skills, loadErrors }
}

export async function listAdminAgentSkills(): Promise<AgentSkillDto[]> {
  const r = await apiFetch(`${API_BASE}/admin/agents/skills`, withAuth())
  if (!r.ok) throw new Error(`list admin agent skills failed: ${r.status}`)
  const body = await readJsonResponse(r, 'list admin agent skills failed: invalid response')
  if (!Array.isArray(body)) throw new Error('list admin agent skills failed: invalid response')
  const skills = body.filter(isAgentSkill)
  if (skills.length !== body.length) throw new Error('list admin agent skills failed: invalid item')
  return skills
}

export async function upsertAdminAgentSkill(payload: Partial<AgentSkillDto> & Pick<AgentSkillDto, 'key' | 'name' | 'content'>): Promise<AgentSkillDto> {
  const r = await apiFetch(`${API_BASE}/admin/agents/skills`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`upsert admin agent skill failed: ${r.status}`)
  return r.json()
}

export async function deleteAdminAgentSkill(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/admin/agents/skills/${id}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete admin agent skill failed: ${r.status}`)
}

export type AgentDiagnosticsTraceDto = {
  id: string
  scopeType: string
  scopeId: string
  taskId: string | null
  requestKind: string
  inputSummary: string
  decisionLog: string[]
  toolCalls: Array<Record<string, unknown>>
  meta: Record<string, unknown> | null
  resultSummary: string | null
  errorCode: string | null
  errorDetail: string | null
  createdAt: string
}

export type AgentDiagnosticsPublicChatRunDto = {
  id: string
  sessionId: string
  sessionKey: string
  requestId: string | null
  projectId: string | null
  label: string | null
  workflowKey: string
  requestKind: string
  userMessageId: string | null
  assistantMessageId: string | null
  outputMode: string
  turnVerdict: 'satisfied' | 'partial' | 'failed'
  turnVerdictReasons: string[]
  runOutcome: 'promote' | 'hold' | 'discard'
  agentDecision: Record<string, unknown> | null
  toolStatusSummary: Record<string, unknown> | null
  diagnosticFlags: Array<Record<string, unknown>>
  canvasPlan: Record<string, unknown> | null
  assetCount: number
  canvasWrite: boolean
  runMs: number | null
  createdAt: string
}

export type AgentDiagnosticsResponseDto = {
  projectId: string | null
  label: string | null
  traces: AgentDiagnosticsTraceDto[]
  publicChatRuns: AgentDiagnosticsPublicChatRunDto[]
}

export async function fetchAdminAgentDiagnostics(params?: {
  projectId?: string
  label?: string
  workflowKey?: string
  turnVerdict?: 'satisfied' | 'partial' | 'failed'
  runOutcome?: 'promote' | 'hold' | 'discard'
  limit?: number
}): Promise<AgentDiagnosticsResponseDto> {
  const qs = new URLSearchParams()
  if (params?.projectId) qs.set('projectId', params.projectId)
  if (params?.label) qs.set('label', params.label)
  if (params?.workflowKey) qs.set('workflowKey', params.workflowKey)
  if (params?.turnVerdict) qs.set('turnVerdict', params.turnVerdict)
  if (params?.runOutcome) qs.set('runOutcome', params.runOutcome)
  if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) qs.set('limit', String(params.limit))
  const url = `${API_BASE}/admin/agents/diagnostics${qs.toString() ? `?${qs.toString()}` : ''}`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`fetch admin agent diagnostics failed: ${r.status}`)
  return r.json()
}
export type ProjectWorkspaceContextFileVersionDto = {
  versionId: string
  fileName: string
  layer: "global" | "project"
  updatedAt: string
  updatedBy: string
}

export type ProjectWorkspaceContextFileVersionContentDto = {
  versionId: string
  fileName: string
  layer: "global" | "project"
  updatedAt: string
  updatedBy: string
  content: string
}

export type ProjectWorkspaceContextFileDto = {
  path: string
  content: string
  layer: "global" | "project"
  updatedAt: string | null
  updatedBy: string | null
  history: ProjectWorkspaceContextFileVersionDto[]
}

export type ProjectWorkspaceContextDto = {
  projectId: string
  ownerId: string
  projectRoot: string
  globalContextDir: string
  projectContextDir: string
  globalFiles: ProjectWorkspaceContextFileDto[]
  projectFiles: ProjectWorkspaceContextFileDto[]
}

export async function fetchAdminProjectWorkspaceContext(params: {
  projectId: string
  refresh?: boolean
}): Promise<ProjectWorkspaceContextDto> {
  const qs = new URLSearchParams()
  qs.set('projectId', params.projectId)
  if (params.refresh === true) qs.set('refresh', 'true')
  const url = `${API_BASE}/agents/project-context?${qs.toString()}`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`fetch admin project workspace context failed: ${r.status}`)
  return r.json()
}

export async function updateProjectWorkspaceContextFile(payload: {
  projectId: string
  fileName: 'PROJECT.md' | 'RULES.md' | 'CHARACTERS.md' | 'STORY_STATE.md'
  content: string
}): Promise<ProjectWorkspaceContextDto> {
  const r = await apiFetch(`${API_BASE}/agents/project-context/file`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`update project workspace context file failed: ${r.status}`)
  return r.json()
}

export async function fetchProjectWorkspaceContextFileVersion(params: {
  projectId: string
  fileName: 'PROJECT.md' | 'RULES.md' | 'CHARACTERS.md' | 'STORY_STATE.md'
  versionId: string
}): Promise<ProjectWorkspaceContextFileVersionContentDto> {
  const qs = new URLSearchParams()
  qs.set('projectId', params.projectId)
  qs.set('fileName', params.fileName)
  qs.set('versionId', params.versionId)
  const url = `${API_BASE}/agents/project-context/version?${qs.toString()}`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`fetch project workspace context file version failed: ${r.status}`)
  return r.json()
}

export async function rollbackProjectWorkspaceContextFile(payload: {
  projectId: string
  fileName: 'PROJECT.md' | 'RULES.md' | 'CHARACTERS.md' | 'STORY_STATE.md'
  versionId: string
}): Promise<ProjectWorkspaceContextFileDto> {
  const r = await apiFetch(`${API_BASE}/agents/project-context/rollback`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`rollback project workspace context file failed: ${r.status}`)
  return r.json()
}

export async function updateAdminGlobalWorkspaceContextFile(payload: {
  fileName: 'GLOBAL_RULES.md'
  content: string
}): Promise<ProjectWorkspaceContextFileDto> {
  const r = await apiFetch(`${API_BASE}/admin/agents/global-context/file`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`update admin global workspace context file failed: ${r.status}`)
  return r.json()
}

export async function fetchAdminGlobalWorkspaceContextFileVersion(params: {
  fileName: 'GLOBAL_RULES.md'
  versionId: string
}): Promise<ProjectWorkspaceContextFileVersionContentDto> {
  const qs = new URLSearchParams()
  qs.set('fileName', params.fileName)
  qs.set('versionId', params.versionId)
  const url = `${API_BASE}/admin/agents/global-context/version?${qs.toString()}`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`fetch admin global workspace context file version failed: ${r.status}`)
  return r.json()
}

export async function rollbackAdminGlobalWorkspaceContextFile(payload: {
  fileName: 'GLOBAL_RULES.md'
  versionId: string
}): Promise<ProjectWorkspaceContextFileDto> {
  const r = await apiFetch(`${API_BASE}/admin/agents/global-context/rollback`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`rollback admin global workspace context file failed: ${r.status}`)
  return r.json()
}

export type ProjectWorkspaceContextVerifyFileDto = {
  layer: "global" | "project"
  path: string
  charCount: number
  truncated: boolean
  updatedAt: string | null
  updatedBy: string | null
}

export type ProjectWorkspaceContextVerifyResponseDto = {
  projectId: string
  ownerId: string
  projectRoot: string
  globalContextDir: string
  projectContextDir: string
  budgets: { maxCharsPerFile: number; maxTotalChars: number }
  totalChars: number
  files: ProjectWorkspaceContextVerifyFileDto[]
  warnings: string[]
}

export async function verifyProjectWorkspaceContext(params: { projectId: string }): Promise<ProjectWorkspaceContextVerifyResponseDto> {
  const qs = new URLSearchParams()
  qs.set('projectId', params.projectId)
  const url = `${API_BASE}/agents/project-context/verify?${qs.toString()}`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`verify project workspace context failed: ${r.status}`)
  return r.json()
}



export async function fetchPromptSamples(params?: { query?: string; nodeKind?: string; source?: 'official' | 'custom' | 'all' }): Promise<{ samples: PromptSampleDto[] }> {
  const qs = new URLSearchParams()
  if (params?.query) qs.set('q', params.query)
  if (params?.nodeKind) qs.set('nodeKind', params.nodeKind)
  if (params?.source) qs.set('source', params.source)
  const query = qs.toString()
  const url = query ? `${API_BASE}/ai/prompt-samples?${query}` : `${API_BASE}/ai/prompt-samples`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`fetch prompt samples failed: ${r.status}`)
  return r.json()
}

export async function parsePromptSample(payload: { rawPrompt: string; nodeKind?: string }): Promise<PromptSampleInput> {
  const r = await apiFetch(`${API_BASE}/ai/prompt-samples/parse`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`parse prompt sample failed: ${r.status}`)
  return r.json()
}

export async function createPromptSample(payload: PromptSampleInput): Promise<PromptSampleDto> {
  const r = await apiFetch(`${API_BASE}/ai/prompt-samples`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`create prompt sample failed: ${r.status}`)
  return r.json()
}

const llmNodePresetCache = new Map<string, LlmNodePresetDto[]>()
const llmNodePresetInFlight = new Map<string, Promise<LlmNodePresetDto[]>>()

function toLlmNodePresetCacheKey(params?: { type?: LlmNodePresetType; query?: string }): string {
  const type = typeof params?.type === 'string' ? params.type.trim() : ''
  const query = typeof params?.query === 'string' ? params.query.trim() : ''
  return `type=${type}|q=${query}`
}

function cloneLlmNodePresets(items: LlmNodePresetDto[]): LlmNodePresetDto[] {
  return items.map((item) => ({ ...item }))
}

function invalidateLlmNodePresetCache(): void {
  llmNodePresetCache.clear()
  llmNodePresetInFlight.clear()
}

export async function listLlmNodePresets(params?: { type?: LlmNodePresetType; query?: string }): Promise<LlmNodePresetDto[]> {
  const cacheKey = toLlmNodePresetCacheKey(params)
  const cached = llmNodePresetCache.get(cacheKey)
  if (cached) return cloneLlmNodePresets(cached)

  const inFlight = llmNodePresetInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const qs = new URLSearchParams()
  if (params?.type) qs.set('type', params.type)
  if (params?.query) qs.set('q', params.query)
  const query = qs.toString()
  const url = query ? `${API_BASE}/ai/node-presets?${query}` : `${API_BASE}/ai/node-presets`
  const request = (async (): Promise<LlmNodePresetDto[]> => {
    const r = await apiFetch(url, withAuth())
    if (!r.ok) throw new Error(`list node presets failed: ${r.status}`)
    const body = await readJsonResponse(r, 'list node presets failed: invalid response')
    if (!Array.isArray(body)) throw new Error('list node presets failed: invalid response')
    const items = body as LlmNodePresetDto[]
    llmNodePresetCache.set(cacheKey, items)
    return cloneLlmNodePresets(items)
  })()
    .finally(() => {
      llmNodePresetInFlight.delete(cacheKey)
    })
  llmNodePresetInFlight.set(cacheKey, request)
  return request
}

export async function createLlmNodePreset(payload: CreateLlmNodePresetInput): Promise<LlmNodePresetDto> {
  const r = await apiFetch(`${API_BASE}/ai/node-presets`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`create node preset failed: ${r.status}`)
  const created = await r.json()
  invalidateLlmNodePresetCache()
  return created
}

export async function deleteLlmNodePreset(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/ai/node-presets/${id}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete node preset failed: ${r.status}`)
  invalidateLlmNodePresetCache()
}

export async function listAdminLlmNodePresets(params?: { type?: LlmNodePresetType }): Promise<LlmNodePresetDto[]> {
  const qs = new URLSearchParams()
  if (params?.type) qs.set('type', params.type)
  const query = qs.toString()
  const url = query ? `${API_BASE}/admin/ai/node-presets?${query}` : `${API_BASE}/admin/ai/node-presets`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`list admin node presets failed: ${r.status}`)
  const body = await readJsonResponse(r, 'list admin node presets failed: invalid response')
  if (!Array.isArray(body)) throw new Error('list admin node presets failed: invalid response')
  return body as LlmNodePresetDto[]
}

export async function upsertAdminLlmNodePreset(payload: Partial<LlmNodePresetDto> & Pick<LlmNodePresetDto, 'title' | 'type' | 'prompt'>): Promise<LlmNodePresetDto> {
  const r = await apiFetch(`${API_BASE}/admin/ai/node-presets`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`upsert admin node preset failed: ${r.status}`)
  const updated = await r.json()
  invalidateLlmNodePresetCache()
  return updated
}

export async function deleteAdminLlmNodePreset(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/admin/ai/node-presets/${id}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete admin node preset failed: ${r.status}`)
  invalidateLlmNodePresetCache()
}

export type StatsDto = {
  onlineUsers: number
  totalUsers: number
  newUsersToday: number
}

export type AdminProjectDto = {
  id: string
  name: string
  ownerId: string | null
  owner: string | null
  ownerName: string | null
  flowCount: number
  createdAt: string
  updatedAt: string
}

export type DauPointDto = { day: string; activeUsers: number }
export type DauSeriesDto = { days: number; series: DauPointDto[] }
export type RevenueBreakdownSliceDto = {
  label: string
  amountCents: number
  orderCount: number
  quantity: number
  share: number
}
export type RevenueBreakdownDto = {
  days: number
  currency: string | null
  totalAmountCents: number
  paidOrderCount: number
  slices: RevenueBreakdownSliceDto[]
}
export type VendorApiCallHistoryPointDto = { status: 'succeeded' | 'failed'; finishedAt: string }
export type VendorApiCallStatDto = {
  vendor: string
  total: number
  success: number
  successRate: number
  avgDurationMs: number | null
  lastStatus: 'succeeded' | 'failed' | null
  lastAt: string | null
  lastDurationMs: number | null
  history: VendorApiCallHistoryPointDto[]
}
export type VendorApiCallStatsDto = { days: number; points: number; vendors: VendorApiCallStatDto[] }
export type PromptEvolutionRunResponseDto = {
  ok: boolean
  runId?: string
  job: 'prompt-evolution'
  sinceHours: number
  sinceIso: string
  dryRun: boolean
  guardrail: {
    minSamples: number
    hasEnoughSamples: boolean
  }
  metrics: {
    total: number
    succeeded: number
    failed: number
    successRate: number
    avgDurationMs: number
  }
  action: 'ready_for_optimizer' | 'skip'
}
export type PromptEvolutionRunHistoryDto = {
  id: string
  actorUserId: string | null
  sinceHours: number
  minSamples: number
  dryRun: boolean
  action: 'ready_for_optimizer' | 'skip'
  metrics: PromptEvolutionRunResponseDto['metrics']
  createdAt: string
}
export type PromptEvolutionRuntimeDto = {
  activeRunId: string | null
  canaryPercent: number
  status: string
  lastAction: string | null
  note: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export async function getStats(): Promise<StatsDto> {
  const r = await apiFetch(`${API_BASE}/stats`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `get stats failed: ${r.status}`
    throw new Error(msg)
  }
  return {
    onlineUsers: Number(body?.onlineUsers ?? 0) || 0,
    totalUsers: Number(body?.totalUsers ?? 0) || 0,
    newUsersToday: Number(body?.newUsersToday ?? 0) || 0,
  }
}

function mapAdminProjectDto(body: any): AdminProjectDto {
  const name = String(body?.name || '')
  return {
    id: String(body?.id || ''),
    name,
    ownerId: typeof body?.ownerId === 'string' ? body.ownerId : body?.ownerId ?? null,
    owner: typeof body?.owner === 'string' ? body.owner : body?.owner ?? null,
    ownerName: typeof body?.ownerName === 'string' ? body.ownerName : body?.ownerName ?? null,
    flowCount: Number(body?.flowCount ?? 0) || 0,
    createdAt: String(body?.createdAt ?? body?.created_at ?? ''),
    updatedAt: String(body?.updatedAt ?? body?.updated_at ?? ''),
  }
}

export async function listAdminProjects(opts?: { q?: string; ownerId?: string; limit?: number }): Promise<AdminProjectDto[]> {
  const params = new URLSearchParams()
  if (opts?.q && String(opts.q).trim()) params.set('q', String(opts.q).trim())
  if (opts?.ownerId && String(opts.ownerId).trim()) params.set('ownerId', String(opts.ownerId).trim())
  if (typeof opts?.limit === 'number' && Number.isFinite(opts.limit)) params.set('limit', String(Math.floor(opts.limit)))
  const url = `${API_BASE}/admin/projects${params.toString() ? `?${params.toString()}` : ''}`

  const r = await apiFetch(url, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `list projects failed: ${r.status}`
    throw new Error(msg)
  }
  const items = Array.isArray(body) ? body : []
  return items.map(mapAdminProjectDto).filter((p) => p.id && p.name)
}

export async function updateAdminProject(projectId: string, patch: {
  name?: string
}): Promise<AdminProjectDto> {
  const r = await apiFetch(`${API_BASE}/admin/projects/${encodeURIComponent(projectId)}`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `update project failed: ${r.status}`
    throw new Error(msg)
  }
  return mapAdminProjectDto(body)
}

export async function deleteAdminProject(projectId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/admin/projects/${encodeURIComponent(projectId)}`, withAuth({
    method: 'DELETE',
  }))
  if (!r.ok) {
    let body: any = null
    try {
      body = await r.json()
    } catch {
      body = null
    }
    const msg = (body && (body.message || body.error)) || `delete project failed: ${r.status}`
    throw new Error(msg)
  }
}

export async function getDailyActiveUsers(days = 30): Promise<DauSeriesDto> {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(365, Math.floor(days))) : 30
  const r = await apiFetch(`${API_BASE}/stats/dau?days=${encodeURIComponent(String(safeDays))}`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `get dau failed: ${r.status}`
    throw new Error(msg)
  }
  const seriesRaw = Array.isArray(body?.series) ? body.series : []
  const series = seriesRaw
    .map((p: any) => ({ day: String(p?.day || ''), activeUsers: Number(p?.activeUsers ?? 0) || 0 }))
    .filter((p: any) => typeof p.day === 'string' && p.day.length >= 10)
  return { days: Number(body?.days ?? safeDays) || safeDays, series }
}

export async function getRevenueBreakdown(days = 30): Promise<RevenueBreakdownDto> {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(365, Math.floor(days))) : 30
  const r = await apiFetch(`${API_BASE}/stats/revenue?days=${encodeURIComponent(String(safeDays))}`, withAuth())
  let body: unknown = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const errorBody = body && typeof body === 'object' ? body as Record<string, unknown> : null
    const message = typeof errorBody?.message === 'string'
      ? errorBody.message
      : typeof errorBody?.error === 'string'
        ? errorBody.error
        : `get revenue breakdown failed: ${r.status}`
    throw new Error(message)
  }
  const payload = body && typeof body === 'object' ? body as Record<string, unknown> : null
  const slicesRaw = Array.isArray(payload?.slices) ? payload.slices : []
  const slices = slicesRaw
    .map((slice) => {
      const item = slice && typeof slice === 'object' ? slice as Record<string, unknown> : null
      return {
        label: typeof item?.label === 'string' ? item.label : '',
        amountCents: Number(item?.amountCents ?? 0) || 0,
        orderCount: Number(item?.orderCount ?? 0) || 0,
        quantity: Number(item?.quantity ?? 0) || 0,
        share: Number(item?.share ?? 0) || 0,
      } satisfies RevenueBreakdownSliceDto
    })
    .filter((slice) => slice.label && slice.amountCents > 0)
  return {
    days: Number(payload?.days ?? safeDays) || safeDays,
    currency: typeof payload?.currency === 'string' ? payload.currency : null,
    totalAmountCents: Number(payload?.totalAmountCents ?? 0) || 0,
    paidOrderCount: Number(payload?.paidOrderCount ?? 0) || 0,
    slices,
  }
}

export async function getVendorApiCallStats(days = 7, points = 60): Promise<VendorApiCallStatsDto> {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(365, Math.floor(days))) : 7
  const safePoints = Number.isFinite(points) ? Math.max(1, Math.min(180, Math.floor(points))) : 60
  const r = await apiFetch(`${API_BASE}/stats/vendors?days=${encodeURIComponent(String(safeDays))}&points=${encodeURIComponent(String(safePoints))}`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `get vendor stats failed: ${r.status}`
    throw new Error(msg)
  }
  const vendorsRaw = Array.isArray(body?.vendors) ? body.vendors : []
  const vendors = vendorsRaw
    .map((v: any) => {
      const historyRaw = Array.isArray(v?.history) ? v.history : []
      const history = historyRaw
        .map((h: any) => ({
          status: h?.status === 'succeeded' ? 'succeeded' : 'failed',
          finishedAt: String(h?.finishedAt || ''),
        }))
        .filter((h: any) => h.finishedAt && h.finishedAt.length >= 10)
      return {
        vendor: String(v?.vendor || ''),
        total: Number(v?.total ?? 0) || 0,
        success: Number(v?.success ?? 0) || 0,
        successRate: Number(v?.successRate ?? 0) || 0,
        avgDurationMs: typeof v?.avgDurationMs === 'number' ? v.avgDurationMs : null,
        lastStatus: v?.lastStatus === 'succeeded' ? 'succeeded' : v?.lastStatus === 'failed' ? 'failed' : null,
        lastAt: typeof v?.lastAt === 'string' ? v.lastAt : null,
        lastDurationMs: typeof v?.lastDurationMs === 'number' ? v.lastDurationMs : null,
        history,
      } satisfies VendorApiCallStatDto
    })
    .filter((v: any) => v.vendor)

  return {
    days: Number(body?.days ?? safeDays) || safeDays,
    points: Number(body?.points ?? safePoints) || safePoints,
    vendors,
  }
}

export async function runPromptEvolution(input?: {
  sinceHours?: number
  minSamples?: number
  dryRun?: boolean
}): Promise<PromptEvolutionRunResponseDto> {
  const r = await apiFetch(`${API_BASE}/stats/prompt-evolution/run`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(typeof input?.sinceHours === 'number' ? { sinceHours: Math.max(1, Math.min(24 * 30, Math.floor(input.sinceHours))) } : {}),
      ...(typeof input?.minSamples === 'number' ? { minSamples: Math.max(1, Math.min(10_000, Math.floor(input.minSamples))) } : {}),
      ...(typeof input?.dryRun === 'boolean' ? { dryRun: input.dryRun } : {}),
    }),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `run prompt evolution failed: ${r.status}`
    throw new Error(msg)
  }
  const metrics = body?.metrics || {}
  const guardrail = body?.guardrail || {}
  return {
    ok: Boolean(body?.ok),
    runId: typeof body?.runId === 'string' ? body.runId : undefined,
    job: 'prompt-evolution',
    sinceHours: Number(body?.sinceHours ?? 24) || 24,
    sinceIso: String(body?.sinceIso || ''),
    dryRun: Boolean(body?.dryRun),
    guardrail: {
      minSamples: Number(guardrail?.minSamples ?? 0) || 0,
      hasEnoughSamples: Boolean(guardrail?.hasEnoughSamples),
    },
    metrics: {
      total: Number(metrics?.total ?? 0) || 0,
      succeeded: Number(metrics?.succeeded ?? 0) || 0,
      failed: Number(metrics?.failed ?? 0) || 0,
      successRate: Number(metrics?.successRate ?? 0) || 0,
      avgDurationMs: Number(metrics?.avgDurationMs ?? 0) || 0,
    },
    action: body?.action === 'ready_for_optimizer' ? 'ready_for_optimizer' : 'skip',
  }
}

export async function listPromptEvolutionRuns(limit = 30): Promise<PromptEvolutionRunHistoryDto[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 30
  const r = await apiFetch(`${API_BASE}/stats/prompt-evolution/runs?limit=${encodeURIComponent(String(safeLimit))}`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `list prompt evolution runs failed: ${r.status}`
    throw new Error(msg)
  }
  const items = Array.isArray(body?.items) ? body.items : []
  return items
    .map((item: any) => ({
      id: String(item?.id || ''),
      actorUserId: typeof item?.actorUserId === 'string' ? item.actorUserId : null,
      sinceHours: Number(item?.sinceHours ?? 0) || 0,
      minSamples: Number(item?.minSamples ?? 0) || 0,
      dryRun: Boolean(item?.dryRun),
      action: item?.action === 'ready_for_optimizer' ? 'ready_for_optimizer' : 'skip',
      metrics: {
        total: Number(item?.metrics?.total ?? 0) || 0,
        succeeded: Number(item?.metrics?.succeeded ?? 0) || 0,
        failed: Number(item?.metrics?.failed ?? 0) || 0,
        successRate: Number(item?.metrics?.successRate ?? 0) || 0,
        avgDurationMs: Number(item?.metrics?.avgDurationMs ?? 0) || 0,
      },
      createdAt: String(item?.createdAt || ''),
    }))
    .filter((item: PromptEvolutionRunHistoryDto) => !!item.id)
}

export async function getPromptEvolutionRuntime(): Promise<PromptEvolutionRuntimeDto> {
  const r = await apiFetch(`${API_BASE}/stats/prompt-evolution/runtime`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `get prompt evolution runtime failed: ${r.status}`
    throw new Error(msg)
  }
  return {
    activeRunId: typeof body?.activeRunId === 'string' ? body.activeRunId : null,
    canaryPercent: Number(body?.canaryPercent ?? 5) || 5,
    status: typeof body?.status === 'string' ? body.status : 'idle',
    lastAction: typeof body?.lastAction === 'string' ? body.lastAction : null,
    note: typeof body?.note === 'string' ? body.note : null,
    updatedAt: typeof body?.updatedAt === 'string' ? body.updatedAt : null,
    updatedBy: typeof body?.updatedBy === 'string' ? body.updatedBy : null,
  }
}

export async function publishPromptEvolutionRun(input: { runId: string; canaryPercent: number }): Promise<PromptEvolutionRuntimeDto> {
  const r = await apiFetch(`${API_BASE}/stats/prompt-evolution/publish`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: String(input.runId || '').trim(),
      canaryPercent: Math.max(1, Math.min(100, Math.floor(Number(input.canaryPercent) || 0))),
    }),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `publish prompt evolution failed: ${r.status}`
    throw new Error(msg)
  }
  return {
    activeRunId: typeof body?.activeRunId === 'string' ? body.activeRunId : null,
    canaryPercent: Number(body?.canaryPercent ?? input.canaryPercent) || input.canaryPercent,
    status: typeof body?.status === 'string' ? body.status : 'active',
    lastAction: 'publish',
    note: null,
    updatedAt: typeof body?.updatedAt === 'string' ? body.updatedAt : null,
    updatedBy: null,
  }
}

export async function rollbackPromptEvolution(input?: { toRunId?: string; reason?: string }): Promise<PromptEvolutionRuntimeDto> {
  const r = await apiFetch(`${API_BASE}/stats/prompt-evolution/rollback`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(typeof input?.toRunId === 'string' && input.toRunId.trim() ? { toRunId: input.toRunId.trim() } : {}),
      ...(typeof input?.reason === 'string' && input.reason.trim() ? { reason: input.reason.trim() } : {}),
    }),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `rollback prompt evolution failed: ${r.status}`
    throw new Error(msg)
  }
  return {
    activeRunId: typeof body?.activeRunId === 'string' ? body.activeRunId : null,
    canaryPercent: 0,
    status: typeof body?.status === 'string' ? body.status : 'rolled_back',
    lastAction: 'rollback',
    note: typeof input?.reason === 'string' ? input.reason : null,
    updatedAt: typeof body?.updatedAt === 'string' ? body.updatedAt : null,
    updatedBy: null,
  }
}

export type AgentContinueInput = {
  sessionId: string
  planId?: string
  intent?: string
  goals?: string[]
  guardrails?: {
    acceptance?: string[]
    checkpoints?: string[]
    extras?: string[]
    failureHandling?: string[]
  }
  toolResult: {
    sessionId: string
    toolCallId?: string
    toolName?: string
    nodeId?: string
    nodeKind?: string
    output?: any
    errorText?: string
  }
  model?: string
  provider?: string
}

export type AgentContinueOutput = {
  reply?: string
  followUp?: string
  shouldContinue?: boolean
}

export async function agentContinue(payload: AgentContinueInput): Promise<AgentContinueOutput> {
  const r = await apiFetch(`${API_BASE}/ai/agent/continue`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `agent continue failed: ${r.status}`
    throw new Error(msg)
  }
  return body as AgentContinueOutput
}

export async function deletePromptSample(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/ai/prompt-samples/${id}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete prompt sample failed: ${r.status}`)
}

export async function listServerFlows(): Promise<FlowDto[]> {
  const r = await apiFetch(`${API_BASE}/flows`, withAuth())
  if (!r.ok) throw new Error(`list flows failed: ${r.status}`)
  return r.json()
}

export async function getServerFlow(id: string): Promise<FlowDto> {
  const r = await apiFetch(`${API_BASE}/flows/${id}`, withAuth())
  if (!r.ok) throw new Error(`get flow failed: ${r.status}`)
  return r.json()
}

function sanitizeFlowDataForPersistence(value: unknown): unknown {
  return sanitizeFlowValueForPersistence(value, { stripBinaryUrls: true })
}

export async function saveServerFlow(payload: {
  id?: string
  name: string
  ownerType?: string
  ownerId?: string | null
  nodes: Node[]
  edges: Edge[]
  viewport?: { x: number; y: number; zoom: number } | null
  sceneCreationProgress?: unknown
}): Promise<FlowDto> {
  const data = sanitizeFlowDataForPersistence({
    nodes: payload.nodes,
    edges: payload.edges,
    viewport: payload.viewport ?? null,
    ...(typeof payload.sceneCreationProgress === 'undefined' ? null : { sceneCreationProgress: payload.sceneCreationProgress }),
  })
  const r = await apiFetch(`${API_BASE}/flows`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: payload.id, name: payload.name, data, ownerType: payload.ownerType, ownerId: payload.ownerId ?? undefined })
  }))
  if (!r.ok) throw new Error(`save flow failed: ${r.status}`)
  return r.json()
}

export async function deleteServerFlow(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/flows/${id}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete flow failed: ${r.status}`)
}

export async function exchangeGithub(code: string): Promise<AuthResponseDto> {
  const r = await apiFetch(`${API_BASE}/auth/github/exchange`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`exchange failed: ${r.status} ${text}`.trim())
  }
  return r.json()
}

export async function createGuestSession(nickname?: string): Promise<AuthResponseDto> {
  const body = nickname ? { nickname } : {}
  const r = await apiFetch(`${API_BASE}/auth/guest`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`guest login failed: ${r.status}`)
  return r.json()
}

export async function requestEmailLoginCode(email: string): Promise<{ sent: boolean; expiresInSeconds?: number }> {
  const r = await apiFetch(`${API_BASE}/auth/email/request`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.error || body.message)) || `email request failed: ${r.status}`
    throw new Error(msg)
  }
  return {
    sent: Boolean(body?.sent),
    expiresInSeconds: typeof body?.expiresInSeconds === 'number' ? body.expiresInSeconds : undefined,
  }
}

export async function verifyEmailLogin(email: string, code: string): Promise<AuthResponseDto> {
  const r = await apiFetch(`${API_BASE}/auth/email/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  })
  const body = await parseAuthErrorBody(r)
  if (!r.ok) {
    const msg = (body && (body.error || body.message)) || `email login failed: ${r.status}`
    throw new Error(msg)
  }
  return body as AuthResponseDto
}

export async function requestPhoneLoginCode(phone: string): Promise<{ sent: boolean; expiresInSeconds?: number; devCode?: string; delivery?: 'sms' | 'debug' }> {
  const r = await apiFetch(`${API_BASE}/auth/phone/request`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  })
  const body = await parseAuthErrorBody(r)
  if (!r.ok) {
    const msg = (body && (body.error || body.message)) || `phone request failed: ${r.status}`
    throw new Error(msg)
  }
  return {
    sent: Boolean(body?.sent),
    expiresInSeconds: typeof body?.expiresInSeconds === 'number' ? body.expiresInSeconds : undefined,
    devCode: typeof body?.devCode === 'string' ? body.devCode : undefined,
    delivery: body?.delivery === 'debug' ? 'debug' : 'sms',
  }
}

export async function verifyPhoneLogin(phone: string, code: string): Promise<AuthResponseDto> {
  const r = await apiFetch(`${API_BASE}/auth/phone/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code }),
  })
  const body = await parseAuthErrorBody(r)
  if (!r.ok) {
    const msg = (body && (body.error || body.message)) || `phone login failed: ${r.status}`
    throw new Error(msg)
  }
  return body as AuthResponseDto
}

export async function loginWithPhonePassword(phone: string, password: string): Promise<AuthResponseDto> {
  const r = await apiFetch(`${API_BASE}/auth/phone/password-login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  })
  const body = await parseAuthErrorBody(r)
  if (!r.ok) {
    const msg = (body && (body.error || body.message)) || `phone password login failed: ${r.status}`
    throw new Error(msg)
  }
  return body as AuthResponseDto
}

export async function setAccountPassword(password: string): Promise<AuthResponseDto> {
  const r = await apiFetch(`${API_BASE}/auth/password/set`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  }))
  const body = await parseAuthErrorBody(r)
  if (!r.ok) {
    const msg = (body && (body.error || body.message)) || `set password failed: ${r.status}`
    throw new Error(msg)
  }
  return body as AuthResponseDto
}

export type FlowVersionReason =
  | 'manual_save'
  | 'agent_turn'
  | 'agent_explicit'
  | 'rollback'
  | 'execution'
  | 'internal_cleanup'
  | 'legacy'

export interface FlowVersionDto {
  id: string
  name: string
  label: string | null
  reason: FlowVersionReason
  createdAt: string
}

export async function listFlowVersions(flowId: string): Promise<FlowVersionDto[]> {
  const r = await apiFetch(`${API_BASE}/flows/${flowId}/versions`, withAuth())
  if (!r.ok) throw new Error(`list versions failed: ${r.status}`)
  return r.json()
}

export async function createFlowVersion(flowId: string, label: string): Promise<FlowVersionDto> {
  const r = await apiFetch(`${API_BASE}/flows/${flowId}/versions`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  }))
  if (!r.ok) await throwApiError(r, `create version failed: ${r.status}`)
  return r.json()
}

export async function rollbackFlow(
  flowId: string,
  params: { versionId: string; baseUpdatedAt: string },
) {
  const r = await apiFetch(`${API_BASE}/flows/${flowId}/rollback`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId: params.versionId, baseUpdatedAt: params.baseUpdatedAt }),
  }))
  if (!r.ok) await throwApiError(r, `rollback failed: ${r.status}`)
  return r.json()
}
export async function listProjects(): Promise<ProjectDto[]> {
  const r = await apiFetch(`${API_BASE}/projects`, withAuth())
  if (!r.ok) throw new Error(`list projects failed: ${r.status}`)
  return r.json()
}

export async function upsertProject(payload: { id?: string; name: string }): Promise<ProjectDto> {
  const r = await apiFetch(`${API_BASE}/projects`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))
  if (!r.ok) await throwApiError(r, `save project failed: ${r.status}`)
  return r.json()
}

export async function listProjectFlows(projectId: string): Promise<FlowDto[]> {
  const params = new URLSearchParams({
    projectId,
    ownerType: 'project',
    ownerId: projectId,
  })
  const r = await apiFetch(`${API_BASE}/flows?${params.toString()}`, withAuth())
  if (!r.ok) throw new Error(`list flows failed: ${r.status}`)
  return r.json()
}


export async function saveProjectFlow(payload: { id?: string; projectId: string; name: string; nodes: Node[]; edges: Edge[]; viewport?: { x: number; y: number; zoom: number } | null; sceneCreationProgress?: unknown; baseUpdatedAt?: string | null; allowEmptyGraphOverwrite?: true }): Promise<FlowDto> {
  const data = sanitizeFlowDataForPersistence({
    nodes: payload.nodes,
    edges: payload.edges,
    viewport: payload.viewport ?? null,
    ...(typeof payload.sceneCreationProgress === 'undefined' ? null : { sceneCreationProgress: payload.sceneCreationProgress }),
  })
  const body = buildFlowUpsertRequestBody({
    id: payload.id,
    projectId: payload.projectId,
    name: payload.name,
    data,
    ownerType: 'project',
    ownerId: payload.projectId,
    baseUpdatedAt: payload.baseUpdatedAt,
    ...(payload.allowEmptyGraphOverwrite === true ? { allowEmptyGraphOverwrite: true as const } : {}),
  })
  const r = await apiFetch(`${API_BASE}/flows`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  if (!r.ok) await throwApiError(r, `save flow failed: ${r.status}`)
  return r.json()
}


export async function createAgentPipelineRun(payload: {
  projectId: string
  title: string
  goal?: string | null
  stages: AgentPipelineStage[]
}): Promise<AgentPipelineRunDto> {
  const r = await apiFetch(`${API_BASE}/agents/pipeline/runs`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`create agent pipeline run failed: ${r.status}`)
  return r.json()
}

export async function getAgentPipelineRun(id: string): Promise<AgentPipelineRunDto> {
  const r = await apiFetch(`${API_BASE}/agents/pipeline/runs/${encodeURIComponent(id)}`, withAuth())
  if (!r.ok) throw new Error(`get agent pipeline run failed: ${r.status}`)
  return r.json()
}

export async function updateAgentPipelineRunStatus(
  id: string,
  payload: { status: AgentPipelineRunStatus; progress?: any; result?: any; errorMessage?: string | null },
): Promise<AgentPipelineRunDto> {
  const r = await apiFetch(`${API_BASE}/agents/pipeline/runs/${encodeURIComponent(id)}/status`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`update agent pipeline run status failed: ${r.status}`)
  return r.json()
}

export async function executeAgentPipelineRun(
  id: string,
  payload?: {
    force?: boolean
    skipMediaGeneration?: boolean
    systemPrompt?: string
    progress?: {
      mode?: 'single' | 'full'
      groupSize?: 1 | 4 | 9 | 25
      totalShots?: number
      completedShots?: number
      nextShotStart?: number
      nextShotEnd?: number
      totalGroups?: number
      completedGroups?: number
    }
  },
): Promise<AgentPipelineRunDto> {
  const r = await apiFetch(`${API_BASE}/agents/pipeline/runs/${encodeURIComponent(id)}/execute`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-JarvisHub-Source': 'canvas' },
    body: JSON.stringify(payload || {}),
  }))
  if (!r.ok) await throwApiError(r, `execute agent pipeline run failed: ${r.status}`)
  return r.json()
}

export async function createMaterialAsset(payload: {
  projectId: string
  kind: MaterialKindDto
  name: string
  initialData: Record<string, unknown>
  note?: string
}): Promise<{ asset: MaterialAssetDto; version: MaterialAssetVersionDto }> {
  const r = await apiFetch(`${API_BASE}/materials/assets`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `create material asset failed: ${r.status}`)
  return r.json()
}

export async function listMaterialAssets(input: {
  projectId: string
  kind?: MaterialKindDto
}): Promise<MaterialAssetDto[]> {
  const params = new URLSearchParams({ projectId: input.projectId })
  if (input.kind) params.set('kind', input.kind)
  const r = await apiFetch(`${API_BASE}/materials/assets?${params.toString()}`, withAuth())
  if (!r.ok) await throwApiError(r, `list material assets failed: ${r.status}`)
  return r.json()
}

export async function createMaterialVersion(assetId: string, payload: {
  data: Record<string, unknown>
  note?: string
}): Promise<MaterialAssetVersionDto> {
  const r = await apiFetch(`${API_BASE}/materials/assets/${encodeURIComponent(assetId)}/versions`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `create material version failed: ${r.status}`)
  return r.json()
}

const inflightMaterialVersionListRequests = new Map<string, Promise<MaterialAssetVersionDto[]>>()

export async function listMaterialVersions(assetId: string, limit = 20): Promise<MaterialAssetVersionDto[]> {
  const normalizedAssetId = String(assetId || '').trim()
  if (!normalizedAssetId) {
    throw new Error('assetId is required')
  }
  const normalizedLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 20)))
  const requestKey = `${normalizedAssetId}::${normalizedLimit}`
  const inflight = inflightMaterialVersionListRequests.get(requestKey)
  if (inflight) return inflight

  const request = (async (): Promise<MaterialAssetVersionDto[]> => {
    const r = await apiFetch(
      `${API_BASE}/materials/assets/${encodeURIComponent(normalizedAssetId)}/versions?limit=${normalizedLimit}`,
      withAuth(),
    )
    if (!r.ok) await throwApiError(r, `list material versions failed: ${r.status}`)
    return r.json()
  })()

  inflightMaterialVersionListRequests.set(requestKey, request)
  try {
    return await request
  } finally {
    inflightMaterialVersionListRequests.delete(requestKey)
  }
}

// Public project APIs
export async function cloneProject(projectId: string, newName?: string): Promise<ProjectDto> {
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/clone`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName })
  }))
  if (!r.ok) throw new Error(`clone project failed: ${r.status}`)
  return r.json()
}

export async function deleteProject(projectId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete project failed: ${r.status}`)
}

export async function listDreaminaAccounts(): Promise<DreaminaAccountDto[]> {
  const r = await apiFetch(`${API_BASE}/dreamina/accounts`, withAuth())
  if (!r.ok) await throwApiError(r, `list dreamina accounts failed: ${r.status}`)
  return r.json()
}

export async function upsertDreaminaAccount(payload: {
  id?: string
  label: string
  cliPath?: string | null
  enabled?: boolean
  meta?: unknown
}): Promise<DreaminaAccountDto> {
  const r = await apiFetch(`${API_BASE}/dreamina/accounts`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `save dreamina account failed: ${r.status}`)
  return r.json()
}

export async function deleteDreaminaAccount(accountId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/dreamina/accounts/${encodeURIComponent(accountId)}`, withAuth({
    method: 'DELETE',
  }))
  if (!r.ok) await throwApiError(r, `delete dreamina account failed: ${r.status}`)
}

export async function probeDreaminaAccount(accountId: string): Promise<DreaminaAccountProbeDto> {
  const r = await apiFetch(`${API_BASE}/dreamina/accounts/${encodeURIComponent(accountId)}/probe`, withAuth({
    method: 'POST',
  }))
  if (!r.ok) await throwApiError(r, `probe dreamina account failed: ${r.status}`)
  return r.json()
}

export async function importDreaminaLoginResponse(accountId: string, loginResponseJson: string): Promise<DreaminaAccountProbeDto> {
  const r = await apiFetch(`${API_BASE}/dreamina/accounts/${encodeURIComponent(accountId)}/import-login`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginResponseJson }),
  }))
  if (!r.ok) await throwApiError(r, `import dreamina login failed: ${r.status}`)
  return r.json()
}

export async function getDreaminaProjectBinding(projectId: string): Promise<DreaminaProjectBindingDto | null> {
  const r = await apiFetch(`${API_BASE}/dreamina/projects/${encodeURIComponent(projectId)}/binding`, withAuth())
  if (!r.ok) await throwApiError(r, `get dreamina project binding failed: ${r.status}`)
  return r.json()
}

export async function upsertDreaminaProjectBinding(projectId: string, payload: {
  accountId: string
  enabled?: boolean
  defaultModelVersion?: string | null
  defaultRatio?: string | null
  defaultResolutionType?: string | null
  defaultVideoResolution?: string | null
}): Promise<DreaminaProjectBindingDto> {
  const r = await apiFetch(`${API_BASE}/dreamina/projects/${encodeURIComponent(projectId)}/binding`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `save dreamina project binding failed: ${r.status}`)
  return r.json()
}

export async function deleteDreaminaProjectBinding(projectId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/dreamina/projects/${encodeURIComponent(projectId)}/binding`, withAuth({
    method: 'DELETE',
  }))
  if (!r.ok) await throwApiError(r, `delete dreamina project binding failed: ${r.status}`)
}

// Model catalog (admin dashboard)
export type ModelCatalogModelKind = 'multimodal' | 'image' | 'video'

export type ModelCatalogVendorAuthType = 'none' | 'bearer' | 'x-api-key' | 'query'
export type ModelCatalogVendorApiProtocol = string

export type ModelCatalogVendorDto = {
  key: string
  name: string
  enabled: boolean
  hasApiKey?: boolean
  apiKey?: string | null
  baseUrlHint?: string | null
  authType?: ModelCatalogVendorAuthType
  authHeader?: string | null
  authQueryParam?: string | null
  apiProtocol?: ModelCatalogVendorApiProtocol | null
  meta?: any
  createdAt: string
  updatedAt: string
}

export type ModelCatalogVendorApiKeyStatusDto = {
  vendorKey: string
  hasApiKey: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type ModelCatalogModelDto = {
  modelKey: string
  vendorKey: string
  modelAlias?: string | null
  labelZh: string
  kind: ModelCatalogModelKind
  enabled: boolean
  meta?: any
  createdAt: string
  updatedAt: string
}

export type ModelCatalogMappingDto = {
  id: string
  vendorKey: string
  taskKind: ProfileKind
  name: string
  enabled: boolean
  requestMapping?: any
  responseMapping?: any
  createdAt: string
  updatedAt: string
}

export type ModelCatalogImportPackageDto = {
  version: string
  exportedAt?: string
  vendors: Array<{
    vendor: {
      key: string
      name: string
      enabled?: boolean
      baseUrlHint?: string | null
      authType?: ModelCatalogVendorAuthType
      authHeader?: string | null
      authQueryParam?: string | null
      apiProtocol?: ModelCatalogVendorApiProtocol | null
      meta?: any
    }
    apiKey?: {
      apiKey: string
      enabled?: boolean
    }
    models?: Array<{
      modelKey: string
      vendorKey?: string
      modelAlias?: string | null
      labelZh: string
      kind: ModelCatalogModelKind
      enabled?: boolean
      meta?: any
    }>
    mappings?: Array<{
      taskKind: ProfileKind
      name: string
      enabled?: boolean
      requestProfile?: unknown
      requestMapping?: any
      responseMapping?: any
    }>
  }>
}

export type ModelCatalogImportResultDto = {
  imported: { vendors: number; models: number; mappings: number }
  errors: string[]
}

export type ModelConfigAuthType = 'none' | 'bearer' | 'x-api-key' | 'query'
export type ModelConfigApiProtocol = ModelCatalogVendorApiProtocol

export type ModelConfigProviderDto = {
  key: string
  name: string
  enabled: boolean
  baseUrl: string | null
  authType: ModelConfigAuthType
  authHeader: string | null
  authQueryParam: string | null
  apiProtocol?: ModelConfigApiProtocol | null
  apiKeyConfigured: boolean
  apiKey: string | null
  meta?: unknown
}

export type ModelConfigModelDto = {
  modelKey: string
  providerKey: string
  modelAlias: string | null
  label: string
  kind: ModelCatalogModelKind
  enabled: boolean
  meta?: unknown
  options?: unknown
}

export type ModelConfigDefaultSlot = ModelCatalogModelKind | 'agent'

export type ModelConfigDefaultModelDto = {
  slot: ModelConfigDefaultSlot
  vendorKey: string
  modelKey: string
  modelAlias: string | null
  label: string
  kind: ModelCatalogModelKind
  createdAt: string
  updatedAt: string
}

export type ModelConfigDto = {
  providers: ModelConfigProviderDto[]
  models: ModelConfigModelDto[]
  defaults: ModelConfigDefaultModelDto[]
}

export type ModelConfigApiKeyStatusDto = {
  providerKey: string
  apiKeyConfigured: boolean
  enabled: boolean
}

function extractModelConfigOptions(meta: unknown): unknown | undefined {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return meta ?? undefined
  const record = meta as Record<string, unknown>
  if ('imageOptions' in record) return record.imageOptions
  if ('videoOptions' in record) return record.videoOptions
  return meta
}

function buildModelCatalogMeta(kind: ModelCatalogModelKind, options: unknown): unknown {
  if (typeof options === 'undefined') return undefined
  if (kind === 'image') return { imageOptions: options }
  if (kind === 'video') return { videoOptions: options }
  return options
}

function mapModelCatalogVendorToConfigProvider(vendor: ModelCatalogVendorDto): ModelConfigProviderDto {
  return {
    key: vendor.key,
    name: vendor.name,
    enabled: vendor.enabled,
    baseUrl: vendor.baseUrlHint ?? null,
    authType: vendor.authType ?? 'bearer',
    authHeader: vendor.authHeader ?? null,
    authQueryParam: vendor.authQueryParam ?? null,
    apiProtocol: vendor.apiProtocol ?? null,
    apiKeyConfigured: vendor.hasApiKey ?? false,
    apiKey: null,
    meta: vendor.meta,
  }
}

function mapModelCatalogModelToConfigModel(model: ModelCatalogModelDto): ModelConfigModelDto {
  return {
    modelKey: model.modelKey,
    providerKey: model.vendorKey,
    modelAlias: model.modelAlias ?? null,
    label: model.labelZh,
    kind: model.kind,
    enabled: model.enabled,
    meta: model.meta,
    options: extractModelConfigOptions(model.meta),
  }
}

export async function getModelConfig(): Promise<ModelConfigDto> {
  const [vendors, models, defaultsConfig] = await Promise.all([
    listModelCatalogVendors(),
    listModelCatalogModels(),
    getModelConfigDefaults(),
  ])
  return {
    providers: vendors.map(mapModelCatalogVendorToConfigProvider),
    models: models.map(mapModelCatalogModelToConfigModel),
    defaults: defaultsConfig.defaults,
  }
}

async function getModelConfigDefaults(): Promise<Pick<ModelConfigDto, 'defaults'>> {
  const r = await apiFetch(`${API_BASE}/model-config`, withAuth())
  if (!r.ok) throw new Error(`get model config defaults failed: ${r.status}`)
  const config = await r.json() as ModelConfigDto
  return { defaults: Array.isArray(config.defaults) ? config.defaults : [] }
}

export async function upsertModelConfigProvider(
  providerKey: string,
  payload: {
    name?: string
    enabled?: boolean
    baseUrl?: string | null
    authType?: ModelConfigAuthType
    authHeader?: string | null
    authQueryParam?: string | null
    apiProtocol?: ModelConfigApiProtocol | null
    meta?: unknown
  },
): Promise<ModelConfigProviderDto> {
  const key = providerKey.trim()
  const vendor = await upsertModelCatalogVendor({
    key,
    name: payload.name?.trim() || key,
    enabled: payload.enabled ?? true,
    baseUrlHint: payload.baseUrl ?? null,
    authType: payload.authType ?? 'bearer',
    authHeader: payload.authHeader ?? null,
    authQueryParam: payload.authQueryParam ?? null,
    ...(typeof payload.apiProtocol === 'undefined' ? {} : { apiProtocol: payload.apiProtocol }),
    ...(typeof payload.meta === 'undefined' ? {} : { meta: payload.meta }),
  })
  return mapModelCatalogVendorToConfigProvider(vendor)
}

export async function upsertModelConfigProviderApiKey(
  providerKey: string,
  payload: { apiKey: string },
): Promise<ModelConfigApiKeyStatusDto> {
  const status = await upsertModelCatalogVendorApiKey(providerKey, {
    apiKey: payload.apiKey,
    enabled: true,
  })
  return {
    providerKey: status.vendorKey,
    apiKeyConfigured: status.hasApiKey,
    enabled: status.enabled,
  }
}

export async function deleteModelConfigProviderApiKey(providerKey: string): Promise<ModelConfigApiKeyStatusDto> {
  const status = await clearModelCatalogVendorApiKey(providerKey)
  return {
    providerKey: status.vendorKey,
    apiKeyConfigured: status.hasApiKey,
    enabled: status.enabled,
  }
}

export async function upsertModelConfigModel(
  providerKey: string,
  modelKey: string,
  payload: {
    modelAlias?: string | null
    label?: string
    kind?: ModelCatalogModelKind
    enabled?: boolean
    meta?: unknown
    options?: unknown
  },
): Promise<ModelConfigModelDto> {
  const kind = payload.kind ?? 'multimodal'
  const meta = typeof payload.meta === 'undefined'
    ? buildModelCatalogMeta(kind, payload.options)
    : payload.meta
  const model = await upsertModelCatalogModel({
    modelKey,
    vendorKey: providerKey,
    ...(typeof payload.modelAlias === 'undefined' ? {} : { modelAlias: payload.modelAlias }),
    labelZh: payload.label?.trim() || modelKey,
    kind,
    enabled: payload.enabled ?? true,
    meta,
  })
  return mapModelCatalogModelToConfigModel(model)
}

export async function deleteModelConfigModel(providerKey: string, modelKey: string): Promise<{ ok: boolean }> {
  await deleteModelCatalogModel(providerKey, modelKey)
  return { ok: true }
}

export async function upsertModelConfigDefaultModel(
  slot: ModelConfigDefaultSlot,
  payload: { vendorKey: string; modelKey: string },
): Promise<ModelConfigDefaultModelDto> {
  const r = await apiFetch(`${API_BASE}/model-config/defaults/${encodeURIComponent(slot)}`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch((): unknown => null)
    const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
    const msg = (
      (typeof record?.message === 'string' && record.message)
      || (typeof record?.error === 'string' && record.error)
      || `upsert model config default failed: ${r.status}`
    )
    throw new Error(msg)
  }
  return r.json()
}

export async function deleteModelConfigDefaultModel(slot: ModelConfigDefaultSlot): Promise<{ ok: true }> {
  const r = await apiFetch(`${API_BASE}/model-config/defaults/${encodeURIComponent(slot)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) {
    const body = await r.json().catch((): unknown => null)
    const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
    const msg = (
      (typeof record?.message === 'string' && record.message)
      || (typeof record?.error === 'string' && record.error)
      || `delete model config default failed: ${r.status}`
    )
    throw new Error(msg)
  }
  return r.json()
}

export async function listModelCatalogVendors(): Promise<ModelCatalogVendorDto[]> {
  const r = await apiFetch(`${API_BASE}/model-catalog/vendors`, withAuth())
  if (!r.ok) throw new Error(`list model catalog vendors failed: ${r.status}`)
  return r.json()
}

export async function exportModelCatalogPackage(params?: { includeApiKeys?: boolean }): Promise<ModelCatalogImportPackageDto> {
  const u = new URL(`${API_BASE}/model-catalog/export`)
  if (params?.includeApiKeys) u.searchParams.set('includeApiKeys', 'true')
  const r = await apiFetch(u.toString(), withAuth())
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `export model catalog failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function upsertModelCatalogVendor(payload: {
  key: string
  name: string
  enabled?: boolean
  baseUrlHint?: string | null
  authType?: ModelCatalogVendorAuthType
  authHeader?: string | null
  authQueryParam?: string | null
  apiProtocol?: ModelCatalogVendorApiProtocol | null
  meta?: any
}): Promise<ModelCatalogVendorDto> {
  const r = await apiFetch(`${API_BASE}/model-catalog/vendors`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `upsert model catalog vendor failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function deleteModelCatalogVendor(key: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/model-catalog/vendors/${encodeURIComponent(key)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `delete model catalog vendor failed: ${r.status}`
    throw new Error(msg)
  }
}

export async function upsertModelCatalogVendorApiKey(vendorKey: string, payload: { apiKey: string; enabled?: boolean }): Promise<ModelCatalogVendorApiKeyStatusDto> {
  const r = await apiFetch(`${API_BASE}/model-catalog/vendors/${encodeURIComponent(vendorKey)}/api-key`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `upsert model catalog vendor api key failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function clearModelCatalogVendorApiKey(vendorKey: string): Promise<ModelCatalogVendorApiKeyStatusDto> {
  const r = await apiFetch(`${API_BASE}/model-catalog/vendors/${encodeURIComponent(vendorKey)}/api-key`, withAuth({ method: 'DELETE' }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `clear model catalog vendor api key failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function listModelCatalogModels(params?: { vendorKey?: string; kind?: ModelCatalogModelKind; enabled?: boolean }): Promise<ModelCatalogModelDto[]> {
  const u = new URL(`${API_BASE}/model-catalog/models`)
  if (params?.vendorKey) u.searchParams.set('vendorKey', params.vendorKey)
  if (params?.kind) u.searchParams.set('kind', params.kind)
  if (typeof params?.enabled === 'boolean') u.searchParams.set('enabled', params.enabled ? 'true' : 'false')
  const r = await apiFetch(u.toString(), withAuth())
  if (!r.ok) throw new Error(`list model catalog models failed: ${r.status}`)
  return r.json()
}

export async function upsertModelCatalogModel(payload: {
  modelKey: string
  vendorKey: string
  modelAlias?: string | null
  labelZh: string
  kind: ModelCatalogModelKind
  enabled?: boolean
  meta?: any
}): Promise<ModelCatalogModelDto> {
  const r = await apiFetch(`${API_BASE}/model-catalog/models`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `upsert model catalog model failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function deleteModelCatalogModel(vendorKey: string, modelKey: string): Promise<void> {
  const u = new URL(`${API_BASE}/model-catalog/models/${encodeURIComponent(modelKey)}`)
  u.searchParams.set('vendorKey', vendorKey)
  const r = await apiFetch(u.toString(), withAuth({ method: 'DELETE' }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `delete model catalog model failed: ${r.status}`
    throw new Error(msg)
  }
}

export async function listModelCatalogMappings(params?: { vendorKey?: string; taskKind?: ProfileKind; enabled?: boolean }): Promise<ModelCatalogMappingDto[]> {
  const u = new URL(`${API_BASE}/model-catalog/mappings`)
  if (params?.vendorKey) u.searchParams.set('vendorKey', params.vendorKey)
  if (params?.taskKind) u.searchParams.set('taskKind', params.taskKind)
  if (typeof params?.enabled === 'boolean') u.searchParams.set('enabled', params.enabled ? 'true' : 'false')
  const r = await apiFetch(u.toString(), withAuth())
  if (!r.ok) throw new Error(`list model catalog mappings failed: ${r.status}`)
  return r.json()
}

export async function upsertModelCatalogMapping(payload: {
  id?: string
  vendorKey: string
  taskKind: ProfileKind
  name: string
  enabled?: boolean
  requestMapping?: any
  responseMapping?: any
}): Promise<ModelCatalogMappingDto> {
  const r = await apiFetch(`${API_BASE}/model-catalog/mappings`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `upsert model catalog mapping failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function deleteModelCatalogMapping(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/model-catalog/mappings/${encodeURIComponent(id)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `delete model catalog mapping failed: ${r.status}`
    throw new Error(msg)
  }
}

export async function importModelCatalogPackage(payload: ModelCatalogImportPackageDto): Promise<ModelCatalogImportResultDto> {
  const r = await apiFetch(`${API_BASE}/model-catalog/import`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `import model catalog package failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function listTaskLogs(params?: {
  limit?: number
  before?: string | null
  vendor?: string | null
  status?: VendorCallLogStatus | null
  taskKind?: string | null
}): Promise<VendorCallLogListResponseDto> {
  const u = new URL(`${API_BASE}/tasks/logs`)
  if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) u.searchParams.set('limit', String(params.limit))
  if (params?.before) u.searchParams.set('before', params.before)
  if (params?.vendor) u.searchParams.set('vendor', params.vendor)
  if (params?.status) u.searchParams.set('status', params.status)
  if (params?.taskKind) u.searchParams.set('taskKind', params.taskKind)

  const r = await apiFetch(u.toString(), withAuth())
  if (!r.ok) throw new Error(`list task logs failed: ${r.status}`)
  return r.json()
}

export async function listModelProfiles(params?: { providerId?: string; kinds?: ProfileKind[] }): Promise<ModelProfileDto[]> {
  const qs = new URLSearchParams()
  if (params?.providerId) qs.set('providerId', params.providerId)
  if (params?.kinds?.length) {
    params.kinds.forEach((kind) => qs.append('kind', kind))
  }
  const query = qs.toString()
  const url = query ? `${API_BASE}/models/profiles?${query}` : `${API_BASE}/models/profiles`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`list profiles failed: ${r.status}`)
  return r.json()
}

export async function upsertModelProfile(payload: {
  id?: string
  providerId: string
  name: string
  kind: ProfileKind
  modelKey: string
  settings?: any
}): Promise<ModelProfileDto> {
  const r = await apiFetch(`${API_BASE}/models/profiles`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`save profile failed: ${r.status}`)
  return r.json()
}

export async function deleteModelProfile(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/models/profiles/${encodeURIComponent(id)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete profile failed: ${r.status}`)
}

export async function listAvailableModels(vendor?: string): Promise<AvailableModelDto[]> {
  const qs = vendor ? `?vendor=${encodeURIComponent(vendor)}` : ''
  const r = await apiFetch(`${API_BASE}/models/available${qs}`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `list available models failed: ${r.status}`
    throw new Error(msg)
  }
  if (Array.isArray(body)) return body as AvailableModelDto[]
  if (Array.isArray(body?.models)) return body.models as AvailableModelDto[]
  return []
}

export async function suggestDraftPrompts(
  query: string,
  provider = 'sora',
  mode?: 'history' | 'semantic',
): Promise<{ prompts: string[] }> {
  const qs = new URLSearchParams({ q: query })
  if (provider) qs.set('provider', provider)
  if (mode === 'semantic') qs.set('mode', 'semantic')
  const r = await apiFetch(`${API_BASE}/drafts/suggest?${qs.toString()}`, withAuth())
  if (!r.ok) throw new Error(`suggest prompts failed: ${r.status}`)
  return r.json()
}

export async function markDraftPromptUsed(prompt: string, provider = 'sora'): Promise<void> {
  const qs = new URLSearchParams({ prompt })
  if (provider) qs.set('provider', provider)
  const r = await apiFetch(`${API_BASE}/drafts/mark-used?${qs.toString()}`, withAuth())
  if (!r.ok) throw new Error(`mark prompt used failed: ${r.status}`)
}

export async function generatePrompt(payload: PromptGeneratePayload): Promise<PromptGenerateResult> {
  const r = await apiFetch(`${API_BASE}/prompt/generate`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`generate prompt failed: ${r.status}`)
  return await r.json() as PromptGenerateResult
}

// Assets API - 用户级别资产
export type ServerAssetDto = {
  id: string
  name: string
  data: any
  createdAt: string
  updatedAt: string
  userId: string
  projectId?: string | null
}

export type AssetZipMediaType = 'image' | 'video' | 'audio' | 'text' | 'html'
export type AssetZipKind = 'all' | AssetZipMediaType

export type AssetZipCanvasAssetInput = {
  nodeId?: string
  assetId?: string
  label?: string
  mediaType: AssetZipMediaType
  url?: string
  text?: string
  html?: string
  source?: string
}

export type AssetZipExportInput =
  | {
      scope: 'canvas'
      kind?: AssetZipKind
      assets: AssetZipCanvasAssetInput[]
    }
  | {
      scope: 'all'
      kind?: AssetZipKind
      maxAssets?: number
    }

export type ProjectMaterialKind = 'text' | 'visualManualDoc' | 'directorManualDoc'

export type AiCharacterLibraryCharacterDto = {
  id: string
  name: string
  projectId: string | null
  character_id: string
  group_number: string
  era: string
  cultural_region: string
  genre: string
  time_period: string
  appearance_background: string
  scene: string
  gender: string
  age_group: string
  species: string
  physique: string
  height_level: string
  skin_color: string
  hair_length: string
  hair_color: string
  temperament: string
  outfit: string
  distinctive_features: string
  identity_hint: string
  full_body_image_url: string
  three_view_image_url: string
  expression_image_url: string
  closeup_image_url: string
  filter_worldview: string
  filter_theme: string
  filter_scene: string
  imported_at: string
  updated_at: string
}

export type AiCharacterLibraryListResponseDto = {
  characters: AiCharacterLibraryCharacterDto[]
  total: number
  page?: number
  pageSize?: number
  syncState: AiCharacterLibrarySyncStateDto | null
}

export type AiCharacterLibraryListParams = {
  q?: string
  page?: number
  pageSize?: number
  offset?: number
  limit?: number
  projectId?: string
  withTotal?: boolean
  filterWorldview?: string | string[]
  filterTheme?: string | string[]
  gender?: string | string[]
  ageGroup?: string | string[]
  species?: string | string[]
  physique?: string | string[]
  heightLevel?: string | string[]
  skinColor?: string | string[]
  hairLength?: string | string[]
  hairColor?: string | string[]
  temperament?: string | string[]
}

export type AiCharacterLibrarySyncStateDto = {
  totalCharacters: number
  importedCharacters: number
  lastSyncedAt: string
}

export type AiCharacterLibraryImportPayload = {
  projectId?: string | null
  sourceAuthorization: string
  sourceDeviceId?: string
  sourceTimezone?: string
  sourceLanguage?: string
  sourceBrowserLocale?: string
  filterWorldview?: string | string[]
  filterTheme?: string | string[]
  gender?: string | string[]
  ageGroup?: string | string[]
  species?: string | string[]
  physique?: string | string[]
  heightLevel?: string | string[]
  skinColor?: string | string[]
  hairLength?: string | string[]
  hairColor?: string | string[]
  temperament?: string | string[]
}

export type AiCharacterLibraryImportResultDto = {
  ok: true
  totalCharacters: number
  importedCharacters: number
  updatedCharacters: number
  storedCharacters: number
  lastSyncedAt: string
}

export type AiCharacterLibraryUpsertPayload = {
  name?: string
  projectId?: string | null
  sourceCharacterUid?: string
  character_id?: string
  group_number?: string
  era?: string
  cultural_region?: string
  genre?: string
  time_period?: string
  appearance_background?: string
  scene?: string
  gender?: string
  age_group?: string
  species?: string
  physique?: string
  height_level?: string
  skin_color?: string
  hair_length?: string
  hair_color?: string
  temperament?: string
  outfit?: string
  distinctive_features?: string
  identity_hint?: string
  filter_worldview?: string
  filter_theme?: string
  filter_scene?: string
  full_body_image_url?: string
  three_view_image_url?: string
  expression_image_url?: string
  closeup_image_url?: string
}

export type AiCharacterLibraryUpsertResponseDto = {
  character: AiCharacterLibraryCharacterDto
}

export type AiCharacterLibraryJsonImportPayload = {
  projectId?: string | null
  characters: AiCharacterLibraryUpsertPayload[]
}

export type AiCharacterLibraryJsonImportResultDto = {
  ok: true
  importedCharacters: number
  updatedCharacters: number
  storedCharacters: number
  lastSyncedAt: string
}

function getClientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  } catch {
    return 'Asia/Shanghai'
  }
}

function getClientLocale(): string {
  if (typeof navigator === 'undefined') return 'zh-CN'
  return String(navigator.language || 'zh-CN').trim() || 'zh-CN'
}

const AI_CHARACTER_LIBRARY_DEVICE_ID_STORAGE_KEY = 'canvas_ai_character_library_device_id'

function getAiCharacterLibraryDeviceId(): string {
  if (typeof window === 'undefined') return 'canvas-web'
  try {
    const existing = window.localStorage.getItem(AI_CHARACTER_LIBRARY_DEVICE_ID_STORAGE_KEY)
    if (existing && existing.trim()) return existing.trim()
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    window.localStorage.setItem(AI_CHARACTER_LIBRARY_DEVICE_ID_STORAGE_KEY, generated)
    return generated
  } catch {
    return 'canvas-web'
  }
}

function buildAiCharacterLibraryHeaders(): Record<string, string> {
  const locale = getClientLocale()
  return {
    'X-Device-ID': getAiCharacterLibraryDeviceId(),
    'X-Timezone': getClientTimezone(),
    'X-Device-Type': 'web',
    'User-Lang': locale,
    'X-Browser-Locale': locale,
  }
}

export async function listServerAssets(input?: {
  limit?: number
  cursor?: string | null
  projectId?: string | null
  kind?: string | null
}): Promise<{ items: ServerAssetDto[]; cursor: string | null }> {
  const qs = new URLSearchParams()
  if (input?.limit) qs.set('limit', String(input.limit))
  if (input?.cursor) qs.set('cursor', input.cursor)
  if (input?.projectId) qs.set('projectId', input.projectId)
  if (input?.kind) qs.set('kind', input.kind)
  const url = qs.toString() ? `${API_BASE}/assets?${qs.toString()}` : `${API_BASE}/assets`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`list assets failed: ${r.status}`)
  return r.json()
}

export async function listAiCharacterLibraryCharacters(
  input?: AiCharacterLibraryListParams,
): Promise<AiCharacterLibraryListResponseDto> {
  const appendMultiValueParam = (
    searchParams: URLSearchParams,
    key: string,
    value?: string | string[],
  ): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = String(item || '').trim()
        if (!text) continue
        searchParams.append(key, text)
      }
      return
    }
    const text = String(value || '').trim()
    if (text) searchParams.set(key, text)
  }
  const qs = new URLSearchParams()
  if (typeof input?.q === 'string' && input.q.trim()) qs.set('q', input.q.trim())
  if (typeof input?.page === 'number' && Number.isFinite(input.page)) qs.set('page', String(Math.max(1, Math.trunc(input.page))))
  if (typeof input?.pageSize === 'number' && Number.isFinite(input.pageSize)) qs.set('pageSize', String(Math.max(1, Math.trunc(input.pageSize))))
  if (typeof input?.offset === 'number' && Number.isFinite(input.offset)) qs.set('offset', String(Math.max(0, Math.trunc(input.offset))))
  if (typeof input?.limit === 'number' && Number.isFinite(input.limit)) qs.set('limit', String(Math.max(1, Math.trunc(input.limit))))
  if (input?.projectId) qs.set('projectId', input.projectId)
  if (typeof input?.withTotal === 'boolean') qs.set('with_total', input.withTotal ? 'true' : 'false')
  appendMultiValueParam(qs, 'filter_worldview', input?.filterWorldview)
  appendMultiValueParam(qs, 'filter_theme', input?.filterTheme)
  appendMultiValueParam(qs, 'gender', input?.gender)
  appendMultiValueParam(qs, 'age_group', input?.ageGroup)
  appendMultiValueParam(qs, 'species', input?.species)
  appendMultiValueParam(qs, 'physique', input?.physique)
  appendMultiValueParam(qs, 'height_level', input?.heightLevel)
  appendMultiValueParam(qs, 'skin_color', input?.skinColor)
  appendMultiValueParam(qs, 'hair_length', input?.hairLength)
  appendMultiValueParam(qs, 'hair_color', input?.hairColor)
  appendMultiValueParam(qs, 'temperament', input?.temperament)
  const url = `${API_BASE}/assets/character-library/characters?${qs.toString()}`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) {
    await throwApiError(r, `list ai character library failed: ${r.status}`)
  }
  const body = await r.json() as {
    characters?: AiCharacterLibraryCharacterDto[]
    total?: number
    page?: number
    pageSize?: number
    syncState?: AiCharacterLibrarySyncStateDto | null
  }
  return {
    characters: Array.isArray(body?.characters) ? body.characters : [],
    total: typeof body?.total === 'number' && Number.isFinite(body.total) ? body.total : 0,
    page: typeof body?.page === 'number' && Number.isFinite(body.page) ? body.page : undefined,
    pageSize: typeof body?.pageSize === 'number' && Number.isFinite(body.pageSize) ? body.pageSize : undefined,
    syncState: body?.syncState ?? null,
  }
}

export async function importAiCharacterLibraryCharacters(
  payload: AiCharacterLibraryImportPayload,
): Promise<AiCharacterLibraryImportResultDto> {
  const headers = buildAiCharacterLibraryHeaders()
  const r = await apiFetch(
    `${API_BASE}/assets/character-library/import`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        sourceDeviceId: payload.sourceDeviceId || headers['X-Device-ID'],
        sourceTimezone: payload.sourceTimezone || headers['X-Timezone'],
        sourceLanguage: payload.sourceLanguage || headers['User-Lang'],
        sourceBrowserLocale: payload.sourceBrowserLocale || headers['X-Browser-Locale'],
      }),
    }),
  )
  if (!r.ok) {
    await throwApiError(r, `import ai character library failed: ${r.status}`)
  }
  return await r.json() as AiCharacterLibraryImportResultDto
}

export async function createAiCharacterLibraryCharacter(
  payload: AiCharacterLibraryUpsertPayload,
): Promise<AiCharacterLibraryCharacterDto> {
  const r = await apiFetch(
    `${API_BASE}/assets/character-library/characters`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  if (!r.ok) {
    await throwApiError(r, `create ai character library character failed: ${r.status}`)
  }
  const body = await r.json() as AiCharacterLibraryUpsertResponseDto
  return body.character
}

export async function updateAiCharacterLibraryCharacter(
  id: string,
  payload: AiCharacterLibraryUpsertPayload,
): Promise<AiCharacterLibraryCharacterDto> {
  const r = await apiFetch(
    `${API_BASE}/assets/character-library/characters/${encodeURIComponent(id)}`,
    withAuth({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  if (!r.ok) {
    await throwApiError(r, `update ai character library character failed: ${r.status}`)
  }
  const body = await r.json() as AiCharacterLibraryUpsertResponseDto
  return body.character
}

export async function deleteAiCharacterLibraryCharacter(id: string): Promise<void> {
  const r = await apiFetch(
    `${API_BASE}/assets/character-library/characters/${encodeURIComponent(id)}`,
    withAuth({ method: 'DELETE' }),
  )
  if (!r.ok) {
    await throwApiError(r, `delete ai character library character failed: ${r.status}`)
  }
}

export async function importAiCharacterLibraryJson(
  payload: AiCharacterLibraryJsonImportPayload,
): Promise<AiCharacterLibraryJsonImportResultDto> {
  const r = await apiFetch(
    `${API_BASE}/assets/character-library/import-json`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  if (!r.ok) {
    await throwApiError(r, `import ai character library json failed: ${r.status}`)
  }
  return await r.json() as AiCharacterLibraryJsonImportResultDto
}

export async function createServerAsset(payload: { name: string; data: any; projectId?: string | null }): Promise<ServerAssetDto> {
  const r = await apiFetch(`${API_BASE}/assets`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))
  if (!r.ok) throw new Error(`create asset failed: ${r.status}`)
  return r.json()
}

export type ProjectRoleCardAssetData = {
  kind: 'projectRoleCard'
  roleName: string
  roleNameKey: string
  stateDescription?: string
  stateKey?: string
  ageDescription?: string
  stateLabel?: string
  healthStatus?: string
  injuryStatus?: string
  roleId?: string
  cardId?: string
  chapter?: number
  chapterStart?: number
  chapterEnd?: number
  chapterSpan?: number[]
  nodeId?: string
  prompt?: string
  status?: 'draft' | 'generated'
  modelKey?: string
  imageUrl?: string
  threeViewImageUrl?: string
  confirmationMode?: 'auto' | 'manual' | null
  confirmedAt?: string | null
  confirmedBy?: string | null
  createdAt?: string
  updatedAt?: string
}

export type ProjectRoleCardAssetDto = ServerAssetDto & {
  data: ProjectRoleCardAssetData
}

function normalizeRoleKey(raw: string): string {
  return String(raw || '').trim().toLowerCase()
}

function normalizeRoleCardStateKey(raw: string): string {
  return normalizeRoleKey(String(raw || '').replace(/\s+/g, ' '))
}

function normalizePositiveChapterNumber(value: unknown): number | undefined {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return Math.trunc(numeric)
}

function normalizeChapterHintsArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.trunc(item))
}

function buildProjectRoleCardScopeKey(input: {
  roleNameKey: string
  roleId?: string
  stateKey?: string
  chapter?: number
  chapterStart?: number
  chapterEnd?: number
  chapterSpan?: number[]
}): string {
  const roleKey = normalizeRoleKey(String(input.roleId || '').trim() || input.roleNameKey)
  const stateKey = normalizeRoleCardStateKey(input.stateKey || '')
  const chapterSpan = normalizeChapterHintsArray(input.chapterSpan)
  const chapterScope = chapterSpan.length > 0
    ? `span:${chapterSpan.join(',')}`
    : (() => {
        const chapter = normalizePositiveChapterNumber(input.chapter)
        const chapterStart = normalizePositiveChapterNumber(input.chapterStart) ?? chapter
        const chapterEnd = normalizePositiveChapterNumber(input.chapterEnd) ?? chapterStart
        if (typeof chapterStart === 'number' && typeof chapterEnd === 'number') return `range:${chapterStart}-${chapterEnd}`
        if (typeof chapter === 'number') return `chapter:${chapter}`
        return 'range:0-0'
      })()
  return `${roleKey}#state:${stateKey || 'default'}#${chapterScope}`
}

function parseProjectRoleCardData(data: unknown): ProjectRoleCardAssetData | null {
  if (!data || typeof data !== 'object') return null
  const raw = data as Record<string, unknown>
  const kind = String(raw.kind || '').trim()
  const roleName = String(raw.roleName || '').trim()
  if (kind !== 'projectRoleCard' || !roleName) return null
  const roleNameKey = normalizeRoleKey(String(raw.roleNameKey || roleName))
  if (!roleNameKey) return null
  const stateDescription = String(raw.stateDescription || '').trim()
  const stateKey = normalizeRoleCardStateKey(String(raw.stateKey || stateDescription))
  const ageDescription = String(raw.ageDescription || '').trim()
  const stateLabel = String(raw.stateLabel || '').trim()
  const healthStatus = String(raw.healthStatus || '').trim()
  const injuryStatus = String(raw.injuryStatus || '').trim()
  const chapter = normalizePositiveChapterNumber(raw.chapter)
  const chapterStart = normalizePositiveChapterNumber(raw.chapterStart)
  const chapterEnd = normalizePositiveChapterNumber(raw.chapterEnd)
  const chapterSpan = normalizeChapterHintsArray(raw.chapterSpan)
  return {
    kind: 'projectRoleCard',
    roleName,
    roleNameKey,
    ...(stateDescription ? { stateDescription } : {}),
    ...(stateKey ? { stateKey } : {}),
    ...(ageDescription ? { ageDescription } : {}),
    ...(stateLabel ? { stateLabel } : {}),
    ...(healthStatus ? { healthStatus } : {}),
    ...(injuryStatus ? { injuryStatus } : {}),
    ...(String(raw.roleId || '').trim() ? { roleId: String(raw.roleId).trim() } : {}),
    ...(String(raw.cardId || '').trim() ? { cardId: String(raw.cardId).trim() } : {}),
    ...(typeof chapter === 'number' ? { chapter } : {}),
    ...(typeof chapterStart === 'number' ? { chapterStart } : {}),
    ...(typeof chapterEnd === 'number' ? { chapterEnd } : {}),
    ...(chapterSpan.length > 0 ? { chapterSpan } : {}),
    ...(String(raw.nodeId || '').trim() ? { nodeId: String(raw.nodeId).trim() } : {}),
    ...(String(raw.prompt || '').trim() ? { prompt: String(raw.prompt).trim() } : {}),
    ...(String(raw.status || '').trim() === 'generated' ? { status: 'generated' as const } : {}),
    ...(String(raw.modelKey || '').trim() ? { modelKey: String(raw.modelKey).trim() } : {}),
    ...(String(raw.imageUrl || '').trim() ? { imageUrl: String(raw.imageUrl).trim() } : {}),
    ...(String(raw.threeViewImageUrl || '').trim() ? { threeViewImageUrl: String(raw.threeViewImageUrl).trim() } : {}),
    ...(raw.confirmationMode === 'auto' || raw.confirmationMode === 'manual'
      ? { confirmationMode: raw.confirmationMode }
      : {}),
    ...(typeof raw.confirmedAt === 'string' ? { confirmedAt: String(raw.confirmedAt).trim() || null } : {}),
    ...(typeof raw.confirmedBy === 'string' ? { confirmedBy: String(raw.confirmedBy).trim() || null } : {}),
    ...(String(raw.createdAt || '').trim() ? { createdAt: String(raw.createdAt).trim() } : {}),
    ...(String(raw.updatedAt || '').trim() ? { updatedAt: String(raw.updatedAt).trim() } : {}),
  }
}

const projectRoleCardAssetsCache = new Map<string, ProjectRoleCardAssetDto[]>()
const projectRoleCardAssetsInFlight = new Map<string, Promise<ProjectRoleCardAssetDto[]>>()

function cloneProjectRoleCardAssets(items: ProjectRoleCardAssetDto[]): ProjectRoleCardAssetDto[] {
  return items.map((item) => ({
    ...item,
    data: item?.data ? { ...item.data } : item.data,
  }))
}

function invalidateProjectRoleCardAssetsCache(projectId?: string): void {
  const key = String(projectId || '').trim()
  if (key) {
    projectRoleCardAssetsCache.delete(key)
    projectRoleCardAssetsInFlight.delete(key)
    return
  }
  projectRoleCardAssetsCache.clear()
  projectRoleCardAssetsInFlight.clear()
}

export async function listProjectRoleCardAssets(projectId: string): Promise<ProjectRoleCardAssetDto[]> {
  const projectIdTrimmed = String(projectId || '').trim()
  if (!projectIdTrimmed) return []
  const cached = projectRoleCardAssetsCache.get(projectIdTrimmed)
  if (cached) return cloneProjectRoleCardAssets(cached)

  const inFlight = projectRoleCardAssetsInFlight.get(projectIdTrimmed)
  if (inFlight) return inFlight

  const request = (async (): Promise<ProjectRoleCardAssetDto[]> => {
    const { items } = await listServerAssets({ projectId: projectIdTrimmed, kind: 'projectRoleCard', limit: 200 })
    const normalized = items
      .map((item) => {
        const parsed = parseProjectRoleCardData(item?.data)
        if (!parsed) return null
        return { ...item, data: parsed } as ProjectRoleCardAssetDto
      })
      .filter(Boolean) as ProjectRoleCardAssetDto[]
    projectRoleCardAssetsCache.set(projectIdTrimmed, normalized)
    return cloneProjectRoleCardAssets(normalized)
  })().finally(() => {
    projectRoleCardAssetsInFlight.delete(projectIdTrimmed)
  })
  projectRoleCardAssetsInFlight.set(projectIdTrimmed, request)
  return request
}

export async function upsertProjectRoleCardAsset(
  projectId: string,
  payload: {
    cardId?: string
    roleId?: string
    roleName: string
    stateDescription?: string
    stateKey?: string
    ageDescription?: string
    stateLabel?: string
    healthStatus?: string
    injuryStatus?: string
    chapter?: number
    chapterStart?: number
    chapterEnd?: number
    chapterSpan?: number[]
    nodeId?: string
    prompt?: string
    status?: 'draft' | 'generated'
    modelKey?: string
    imageUrl?: string
    threeViewImageUrl?: string
  },
): Promise<ProjectRoleCardAssetDto> {
  const projectIdTrimmed = String(projectId || '').trim()
  const roleName = String(payload.roleName || '').trim()
  if (!projectIdTrimmed) throw new Error('projectId is required')
  if (!roleName) throw new Error('roleName is required')

  const roleNameKey = normalizeRoleKey(roleName)
  const stateDescription = String(payload.stateDescription || '').trim()
  const stateKey = normalizeRoleCardStateKey(String(payload.stateKey || stateDescription))
  const ageDescription = String(payload.ageDescription || '').trim()
  const stateLabel = String(payload.stateLabel || '').trim()
  const healthStatus = String(payload.healthStatus || '').trim()
  const injuryStatus = String(payload.injuryStatus || '').trim()
  const chapter = normalizePositiveChapterNumber(payload.chapter)
  const chapterStart = normalizePositiveChapterNumber(payload.chapterStart)
  const chapterEnd = normalizePositiveChapterNumber(payload.chapterEnd)
  const chapterSpan = normalizeChapterHintsArray(payload.chapterSpan)
  const roleIdKey = normalizeRoleKey(String(payload.roleId || ''))
  const cardIdKey = normalizeRoleKey(String(payload.cardId || ''))
  const targetScopeKey = buildProjectRoleCardScopeKey({
    roleNameKey,
    ...(roleIdKey ? { roleId: roleIdKey } : {}),
    ...(stateKey ? { stateKey } : {}),
    ...(typeof chapter === 'number' ? { chapter } : {}),
    ...(typeof chapterStart === 'number' ? { chapterStart } : {}),
    ...(typeof chapterEnd === 'number' ? { chapterEnd } : {}),
    ...(chapterSpan.length > 0 ? { chapterSpan } : {}),
  })
  const all = await listProjectRoleCardAssets(projectIdTrimmed)
  const matched =
    all.find((item) => cardIdKey && normalizeRoleKey(String(item.data?.cardId || '')) === cardIdKey) ||
    all.find((item) => roleIdKey && buildProjectRoleCardScopeKey({
      roleNameKey: normalizeRoleKey(String(item.data?.roleNameKey || item.data?.roleName || '')),
      roleId: normalizeRoleKey(String(item.data?.roleId || '')),
      stateKey: String(item.data?.stateKey || item.data?.stateDescription || ''),
      chapter: item.data?.chapter,
      chapterStart: item.data?.chapterStart,
      chapterEnd: item.data?.chapterEnd,
      chapterSpan: item.data?.chapterSpan,
    }) === targetScopeKey) ||
    all.find((item) => buildProjectRoleCardScopeKey({
      roleNameKey: normalizeRoleKey(String(item.data?.roleNameKey || item.data?.roleName || '')),
      roleId: normalizeRoleKey(String(item.data?.roleId || '')),
      stateKey: String(item.data?.stateKey || item.data?.stateDescription || ''),
      chapter: item.data?.chapter,
      chapterStart: item.data?.chapterStart,
      chapterEnd: item.data?.chapterEnd,
      chapterSpan: item.data?.chapterSpan,
    }) === targetScopeKey) ||
    null

  const nowIso = new Date().toISOString()
  const prev = matched?.data || null
  const hasExecutableAsset = Boolean(
    String(payload.threeViewImageUrl || payload.imageUrl || prev?.threeViewImageUrl || prev?.imageUrl || '').trim(),
  )
  const nextStatus = payload.status || prev?.status || 'generated'
  const nextConfirmationMode =
    prev?.confirmationMode === 'manual' && prev?.confirmedAt
      ? 'manual'
      : nextStatus === 'generated' && hasExecutableAsset
        ? 'auto'
        : prev?.confirmationMode || null
  const nextData: ProjectRoleCardAssetData = {
    kind: 'projectRoleCard',
    roleName,
    roleNameKey,
    ...(stateDescription || prev?.stateDescription ? { stateDescription: stateDescription || String(prev?.stateDescription || '').trim() } : {}),
    ...(stateKey || prev?.stateKey ? { stateKey: stateKey || String(prev?.stateKey || '').trim() } : {}),
    ...(ageDescription || prev?.ageDescription ? { ageDescription: ageDescription || String(prev?.ageDescription || '').trim() } : {}),
    ...(stateLabel || prev?.stateLabel ? { stateLabel: stateLabel || String(prev?.stateLabel || '').trim() } : {}),
    ...(healthStatus || prev?.healthStatus ? { healthStatus: healthStatus || String(prev?.healthStatus || '').trim() } : {}),
    ...(injuryStatus || prev?.injuryStatus ? { injuryStatus: injuryStatus || String(prev?.injuryStatus || '').trim() } : {}),
    ...(String(payload.roleId || prev?.roleId || '').trim() ? { roleId: String(payload.roleId || prev?.roleId).trim() } : {}),
    ...(String(payload.cardId || prev?.cardId || matched?.id || '').trim() ? { cardId: String(payload.cardId || prev?.cardId || matched?.id).trim() } : {}),
    ...(typeof chapter === 'number' ? { chapter } : typeof prev?.chapter === 'number' ? { chapter: prev.chapter } : {}),
    ...(typeof chapterStart === 'number' ? { chapterStart } : typeof prev?.chapterStart === 'number' ? { chapterStart: prev.chapterStart } : {}),
    ...(typeof chapterEnd === 'number' ? { chapterEnd } : typeof prev?.chapterEnd === 'number' ? { chapterEnd: prev.chapterEnd } : {}),
    ...(chapterSpan.length > 0 ? { chapterSpan } : Array.isArray(prev?.chapterSpan) && prev.chapterSpan.length > 0 ? { chapterSpan: prev.chapterSpan } : {}),
    ...(String(payload.nodeId || prev?.nodeId || '').trim() ? { nodeId: String(payload.nodeId || prev?.nodeId).trim() } : {}),
    ...(String(payload.prompt || prev?.prompt || '').trim() ? { prompt: String(payload.prompt || prev?.prompt).trim() } : {}),
    ...(String(payload.modelKey || prev?.modelKey || '').trim() ? { modelKey: String(payload.modelKey || prev?.modelKey).trim() } : {}),
    ...(String(payload.imageUrl || prev?.imageUrl || '').trim() ? { imageUrl: String(payload.imageUrl || prev?.imageUrl).trim() } : {}),
    ...(String(payload.threeViewImageUrl || prev?.threeViewImageUrl || '').trim() ? { threeViewImageUrl: String(payload.threeViewImageUrl || prev?.threeViewImageUrl).trim() } : {}),
    status: nextStatus,
    ...(nextConfirmationMode ? { confirmationMode: nextConfirmationMode } : {}),
    ...(nextStatus === 'generated' && hasExecutableAsset
      ? { confirmedAt: prev?.confirmationMode === 'manual' && prev?.confirmedAt ? prev.confirmedAt : nowIso }
      : typeof prev?.confirmedAt === 'string'
        ? { confirmedAt: prev.confirmedAt }
        : {}),
    ...(nextStatus === 'generated' && hasExecutableAsset
      ? { confirmedBy: prev?.confirmationMode === 'manual' && prev?.confirmedBy ? prev.confirmedBy : 'system' }
      : typeof prev?.confirmedBy === 'string'
        ? { confirmedBy: prev.confirmedBy }
        : {}),
    createdAt: prev?.createdAt || nowIso,
    updatedAt: nowIso,
  }

  if (matched?.id) {
    const updated = await updateServerAssetData(matched.id, nextData)
    invalidateProjectRoleCardAssetsCache(projectIdTrimmed)
    return { ...updated, data: nextData } as ProjectRoleCardAssetDto
  }

  const created = await createServerAsset({
    projectId: projectIdTrimmed,
    name: `角色卡 · ${roleName}`,
    data: nextData,
  })
  const createdData: ProjectRoleCardAssetData = {
    ...nextData,
    cardId: nextData.cardId || created.id,
  }
  if (!nextData.cardId) {
    const patched = await updateServerAssetData(created.id, createdData)
    invalidateProjectRoleCardAssetsCache(projectIdTrimmed)
    return { ...patched, data: createdData } as ProjectRoleCardAssetDto
  }
  invalidateProjectRoleCardAssetsCache(projectIdTrimmed)
  return { ...created, data: createdData } as ProjectRoleCardAssetDto
}

export async function ingestProjectMaterial(payload: {
  projectId: string
  kind: 'text'
  name: string
  content: string
  chapter?: number | null
}): Promise<{ ok: boolean; mode?: string; baseAssetId?: string; chaptersCreated?: number }> {
  const r = await apiFetch(`${API_BASE}/assets/ingest-material`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    let msg = `ingest material failed: ${r.status}`
    try {
      const body: any = await r.json()
      msg = body?.message || body?.error || msg
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
  return r.json()
}

export async function updateServerAssetData(id: string, data: any): Promise<ServerAssetDto> {
  const r = await apiFetch(`${API_BASE}/assets/${id}/data`, withAuth({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }))
  if (!r.ok) throw new Error(`update asset data failed: ${r.status}`)
  return r.json()
}

export async function renameServerAsset(id: string, name: string): Promise<ServerAssetDto> {
  const r = await apiFetch(`${API_BASE}/assets/${id}`, withAuth({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }))
  if (!r.ok) throw new Error(`rename asset failed: ${r.status}`)
  return r.json()
}

export async function deleteServerAsset(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/assets/${id}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete asset failed: ${r.status}`)
}

export type RehostResult = {
  total: number
  succeeded: number
  failed: number
  results: Array<{ id: string; status: string; message?: string }>
}

export async function rehostServerAssets(): Promise<RehostResult> {
  const r = await apiFetch(`${API_BASE}/assets/rehost`, withAuth({ method: 'POST' }))
  if (!r.ok) throw new Error(`持久化失败: ${r.status}`)
  return r.json()
}

function stripHeaderQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseAttachmentFilename(contentDisposition: string | null, fallback: string): string {
  const header = String(contentDisposition || '')
  const filenameStar = header.match(/filename\*\s*=\s*([^;]+)/i)
  if (filenameStar?.[1]) {
    const raw = stripHeaderQuotes(filenameStar[1])
    const encoded = raw.includes("''") ? raw.slice(raw.indexOf("''") + 2) : raw
    try {
      const decoded = decodeURIComponent(encoded)
      if (decoded.trim()) return decoded.trim()
    } catch {
      // fall through
    }
  }

  const filename = header.match(/filename\s*=\s*([^;]+)/i)
  if (filename?.[1]) {
    const decoded = stripHeaderQuotes(filename[1]).trim()
    if (decoded) return decoded
  }
  return fallback
}

export async function exportAssetsZip(input: AssetZipExportInput): Promise<{ blob: Blob; filename: string }> {
  const body = input.scope === 'canvas'
    ? {
        scope: 'canvas',
        kind: input.kind,
        assets: input.assets,
      }
    : {
        scope: 'all',
        kind: input.kind,
        maxAssets: input.maxAssets,
      }
  const r = await apiFetch(`${API_BASE}/assets/export-zip`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
  if (!r.ok) {
    await throwApiError(r, `asset zip export failed: ${r.status}`)
  }
  const bytes = await r.arrayBuffer()
  const blob = new Blob([bytes], {
    type: r.headers.get('Content-Type') || 'application/zip',
  })
  if (typeof blob.text !== 'function') {
    Object.defineProperty(blob, 'text', {
      value: async () => new TextDecoder().decode(bytes),
    })
  }
  return {
    blob,
    filename: parseAttachmentFilename(
      r.headers.get('Content-Disposition'),
      input.scope === 'canvas' ? 'canvas-assets.zip' : 'all-assets.zip',
    ),
  }
}

export async function listProjectMaterials(projectId: string, kind?: ProjectMaterialKind): Promise<ServerAssetDto[]> {
  const res = await listServerAssets({ projectId, kind: kind || undefined, limit: 50 })
  return (res.items || []).filter((item) => {
    const k = typeof item?.data?.kind === 'string' ? item.data.kind : ''
    return k === 'text'
  })
}

export type UploadServerAssetMeta = {
  prompt?: string | null
  vendor?: string | null
  modelKey?: string | null
  taskKind?: TaskKind | string | null
  projectId?: string | null
  ownerNodeId?: string | null
}

const inflightAssetUploadRequests = new Map<string, Promise<ServerAssetDto>>()

export function buildAssetUploadRequestKey(file: File, name?: string, meta?: UploadServerAssetMeta): string {
  const fileName = typeof file.name === 'string' ? file.name.trim() : ''
  const fileSize = typeof file.size === 'number' && Number.isFinite(file.size) ? String(file.size) : ''
  const lastModified =
    typeof file.lastModified === 'number' && Number.isFinite(file.lastModified)
      ? String(file.lastModified)
      : ''
  const fileType = typeof file?.type === 'string' ? file.type.trim().toLowerCase() : ''
  const uploadName = typeof name === 'string' ? name.trim() : ''
  const prompt = typeof meta?.prompt === 'string' ? meta.prompt.trim() : ''
  const vendor = typeof meta?.vendor === 'string' ? meta.vendor.trim() : ''
  const modelKey = typeof meta?.modelKey === 'string' ? meta.modelKey.trim() : ''
  const taskKind = typeof meta?.taskKind === 'string' ? String(meta.taskKind).trim() : ''
  const projectId = typeof meta?.projectId === 'string' ? meta.projectId.trim() : ''
  return [
    fileName,
    fileSize,
    lastModified,
    fileType,
    uploadName,
    prompt,
    vendor,
    modelKey,
    taskKind,
    projectId,
  ].join('|')
}

export async function uploadServerAssetFile(file: File, name?: string, meta?: UploadServerAssetMeta): Promise<ServerAssetDto> {
  const requestKey = buildAssetUploadRequestKey(file, name, meta)
  const effectiveFileName =
    (typeof name === 'string' && name.trim()) ||
    (typeof file.name === 'string' && file.name.trim()) ||
    '未命名文件'
  const trimmedProjectId = typeof meta?.projectId === 'string' && meta.projectId.trim() ? meta.projectId.trim() : ''
  const ownerNodeId = typeof meta?.ownerNodeId === 'string' && meta.ownerNodeId.trim() ? meta.ownerNodeId.trim() : ''
  const existing = inflightAssetUploadRequests.get(requestKey)
  if (existing) {
    useUploadRuntimeStore.getState().beginPendingUpload({
      id: requestKey,
      fileName: effectiveFileName,
      projectId: trimmedProjectId || null,
      ownerNodeId: ownerNodeId || null,
      startedAt: Date.now(),
    })
    return existing
  }
  useUploadRuntimeStore.getState().beginPendingUpload({
    id: requestKey,
    fileName: effectiveFileName,
    projectId: trimmedProjectId || null,
    ownerNodeId: ownerNodeId || null,
    startedAt: Date.now(),
  })

  const uploadPromise = (async (): Promise<ServerAssetDto> => {
    const trimmedPrompt = typeof meta?.prompt === 'string' && meta.prompt.trim() ? meta.prompt.trim() : ''
    const trimmedVendor = typeof meta?.vendor === 'string' && meta.vendor.trim() ? meta.vendor.trim() : ''
    const trimmedModelKey = typeof meta?.modelKey === 'string' && meta.modelKey.trim() ? meta.modelKey.trim() : ''
    const trimmedTaskKind = typeof meta?.taskKind === 'string' && String(meta.taskKind).trim() ? String(meta.taskKind).trim() : ''

    const hasMeta = Boolean(trimmedPrompt || trimmedVendor || trimmedModelKey || trimmedTaskKind || trimmedProjectId)
    if (hasMeta) {
      const form = new FormData()
      form.set('file', file)
      if (typeof name === 'string' && name.trim()) {
        form.set('name', name.trim())
      }
      if (trimmedPrompt) form.set('prompt', trimmedPrompt)
      if (trimmedVendor) form.set('vendor', trimmedVendor)
      if (trimmedModelKey) form.set('modelKey', trimmedModelKey)
      if (trimmedTaskKind) form.set('taskKind', trimmedTaskKind)
      if (trimmedProjectId) form.set('projectId', trimmedProjectId)

      const r = await apiFetch(`${API_BASE}/assets/upload`, withAuth({
        method: 'POST',
        headers: { 'x-jarvishub-no-retry': '1' },
        body: form,
      }))
      if (!r.ok) throw new Error(`upload asset failed: ${r.status}`)
      return r.json()
    }

    const qs = new URLSearchParams()
    if (typeof name === 'string' && name.trim()) {
      qs.set('name', name.trim())
    }
    if (trimmedProjectId) {
      qs.set('projectId', trimmedProjectId)
    }
    const url = qs.toString() ? `${API_BASE}/assets/upload?${qs.toString()}` : `${API_BASE}/assets/upload`
    const contentType = (file?.type || '').split(';')[0].trim() || 'application/octet-stream'
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'x-jarvishub-no-retry': '1',
    }
    if (typeof file.name === 'string' && file.name.trim()) {
      const fileName = file.name.trim()
      if (isIso88591HeaderValue(fileName)) {
        headers['X-File-Name'] = fileName
      }
    }
    if (typeof file.size === 'number' && Number.isFinite(file.size)) {
      headers['X-File-Size'] = String(file.size)
    }
    const body: RequestInit['body'] = file
    const r = await apiFetch(url, withAuth({ method: 'POST', headers, body }))
    if (!r.ok) throw new Error(`upload asset failed: ${r.status}`)
    return r.json()
  })()

  inflightAssetUploadRequests.set(requestKey, uploadPromise)
  try {
    return await uploadPromise
  } finally {
    inflightAssetUploadRequests.delete(requestKey)
    useUploadRuntimeStore.getState().finishPendingUpload(requestKey)
  }
}

function isIso88591HeaderValue(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code > 0xff) return false
  }
  return true
}

function sanitizeServerAssetUploadName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .trim()
    .slice(0, 160)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/]/g, '_')
}

function normalizeMimeType(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : ''
  return (s.split(';')[0] || '').trim().toLowerCase()
}

/**
 * Best-effort recovery for a completed upload when the client didn't get a usable response
 * (e.g. proxy/CORS/network hiccups after the server already persisted the asset row).
 */
export async function recoverUploadedServerAssetFile(
  file: File,
  options?: { withinMs?: number },
): Promise<ServerAssetDto | null> {
  const withinMsRaw = options?.withinMs
  const withinMs = Number.isFinite(withinMsRaw) ? Math.max(1000, Math.min(10 * 60 * 1000, Math.trunc(withinMsRaw!))) : 2 * 60 * 1000

  const wantedOriginalName = sanitizeServerAssetUploadName((file as any)?.name || '')
  const wantedSize =
    typeof (file as any)?.size === 'number' && Number.isFinite((file as any).size)
      ? Number((file as any).size)
      : null
  const wantedContentType = normalizeMimeType((file as any)?.type || '')

  if (!wantedOriginalName && wantedSize == null) return null

  let listed: { items: ServerAssetDto[]; cursor: string | null } | null = null
  try {
    listed = await listServerAssets({ limit: 10 })
  } catch {
    return null
  }

  const now = Date.now()
  const items = Array.isArray(listed?.items) ? listed!.items : []
  for (const asset of items) {
    if (!asset || typeof asset !== 'object') continue

    const createdAtMs = Date.parse((asset as any).createdAt)
    if (Number.isFinite(createdAtMs) && withinMs > 0 && now - createdAtMs > withinMs) continue

    const data = (asset as any).data || {}
    const kind = typeof data?.kind === 'string' ? data.kind.trim().toLowerCase() : ''
    if (kind && kind !== 'upload') continue

    const originalName = sanitizeServerAssetUploadName(data?.originalName || '')
    const size =
      typeof data?.size === 'number' && Number.isFinite(data.size) ? Number(data.size) : null
    const contentType = normalizeMimeType(data?.contentType || '')

    if (wantedSize != null) {
      if (size == null) continue
      if (size !== wantedSize) continue
    }
    if (wantedOriginalName) {
      if (!originalName) continue
      if (originalName !== wantedOriginalName) continue
    }
    if (wantedContentType && contentType && contentType !== wantedContentType) continue

    const url = typeof data?.url === 'string' ? String(data.url).trim() : ''
    if (!url) continue
    return asset
  }

  return null
}

// Unified task API
export type TaskKind =
  | 'chat'
  | 'prompt_refine'
  | 'text_to_image'
  | 'image_to_prompt'
  | 'image_to_video'
  | 'text_to_video'
  | 'image_edit'

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type TaskAssetDto = {
  type: 'image' | 'video'
  url: string
  thumbnailUrl?: string | null
  assetId?: string | null
  assetRefId?: string | null
  assetName?: string | null
}

export type TaskResultDto = {
  id: string
  kind: TaskKind
  status: TaskStatus
  assets: TaskAssetDto[]
  raw: any
}

export type TaskRequestDto = {
  kind: TaskKind
  prompt: string
  negativePrompt?: string
  seed?: number
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  extras?: Record<string, any>
}

// Public API (/public/*): open single-workspace calls. Provider auth is resolved server-side from model config.
export type PublicRunTaskRequestDto = {
  vendor?: string
  vendorCandidates?: string[]
  request: TaskRequestDto
}

export type PublicRunTaskResponseDto = {
  vendor: string
  result: TaskResultDto
}

type PublicDrawRequestDto = {
  vendor?: string
  vendorCandidates?: string[]
  async?: boolean
  kind?: 'text_to_image' | 'image_edit'
  prompt: string
  negativePrompt?: string
  seed?: number
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  extras?: Record<string, unknown>
}

export type PublicFetchTaskResultRequestDto = {
  taskId: string
  vendor?: string
  taskKind?: TaskKind
  prompt?: string | null
}

export type PublicFetchTaskResultResponseDto = {
  vendor: string
  result: TaskResultDto
}

export type TaskProgressSnapshotDto = {
  taskId?: string
  nodeId?: string
  nodeKind?: string
  taskKind?: TaskKind
  vendor?: string
  status: TaskStatus
  progress?: number
  message?: string
  assets?: TaskAssetDto[]
  raw?: any
  timestamp?: number
}

type PublicTaskError = Error & {
  status?: number
  code?: unknown
  details?: unknown
  requestId?: string
  rawResponse?: string
}

const PUBLIC_TASK_TRACE_HEADER_KEYS = ['x-request-id', 'x-trace-id', 'cf-ray'] as const

function isApiRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readApiErrorText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!isApiRecord(value)) return ''
  return (
    readApiErrorText(value.message) ||
    readApiErrorText(value.error) ||
    readApiErrorText(value.reason) ||
    readApiErrorText(value.detail)
  )
}

function getClientPageTraceHeaders(): Record<string, string> {
  try {
    if (typeof window === 'undefined') return {}
    const pagePath = `${window.location.pathname || ''}${window.location.search || ''}${window.location.hash || ''}`.trim()
    const referrerRaw = typeof document !== 'undefined' ? String(document.referrer || '').trim() : ''
    const referrerPath = (() => {
      if (!referrerRaw) return ''
      try {
        const u = new URL(referrerRaw)
        const currentOrigin = window.location.origin
        if (u.origin === currentOrigin) return `${u.pathname || ''}${u.search || ''}${u.hash || ''}`.trim()
        return referrerRaw
      } catch {
        return referrerRaw
      }
    })()
    return {
      ...(pagePath ? { 'x-canvas-page-path': pagePath } : {}),
      ...(referrerPath ? { 'x-canvas-referrer-path': referrerPath } : {}),
    }
  } catch {
    return {}
  }
}

function isPublicDrawKind(kind: TaskKind): kind is 'text_to_image' | 'image_edit' {
  return kind === 'text_to_image' || kind === 'image_edit'
}

function toPublicDrawPayload(payload: PublicRunTaskRequestDto): PublicDrawRequestDto | null {
  const request = payload.request
  if (!request || !isPublicDrawKind(request.kind)) return null
  return {
    vendor: payload.vendor,
    vendorCandidates: payload.vendorCandidates,
    async: true,
    kind: request.kind,
    prompt: request.prompt,
    ...(typeof request.negativePrompt === 'string' ? { negativePrompt: request.negativePrompt } : {}),
    ...(typeof request.seed === 'number' ? { seed: request.seed } : {}),
    ...(typeof request.width === 'number' ? { width: request.width } : {}),
    ...(typeof request.height === 'number' ? { height: request.height } : {}),
    ...(typeof request.steps === 'number' ? { steps: request.steps } : {}),
    ...(typeof request.cfgScale === 'number' ? { cfgScale: request.cfgScale } : {}),
    ...(request.extras && typeof request.extras === 'object' ? { extras: request.extras as Record<string, unknown> } : {}),
  }
}

function readPublicTaskTraceId(r: Response): string | null {
  for (const key of PUBLIC_TASK_TRACE_HEADER_KEYS) {
    const value = String(r.headers.get(key) || '').trim()
    if (value) return value
  }
  return null
}

async function readPublicTaskErrorBody(r: Response): Promise<{
  message?: string
  code?: unknown
  details?: unknown
  rawResponse?: string
}> {
  const contentType = String(r.headers.get('content-type') || '').toLowerCase()
  let text = ''
  try {
    text = (await r.text()).trim()
  } catch {
    return {}
  }
  if (!text) return {}
  const compact = text.replace(/\s+/g, ' ').trim()

  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(text) as unknown
      if (isApiRecord(parsed)) {
        const body = parsed
        const message = readApiErrorText(body.message) || readApiErrorText(body.error) || undefined
        return { message, code: body.code, details: body.details, rawResponse: compact.slice(0, 800) }
      }
    } catch {
      return { message: compact.slice(0, 240), rawResponse: compact.slice(0, 800) }
    }
  }
  return { message: compact.slice(0, 240), rawResponse: compact.slice(0, 800) }
}

async function throwPublicTaskError(r: Response, fallbackMessage: string): Promise<never> {
  const body = await readPublicTaskErrorBody(r)
  const traceId = readPublicTaskTraceId(r)
  const messageCore = body.message || fallbackMessage
  const message = traceId ? `${messageCore} (requestId: ${traceId})` : messageCore
  const err = new Error(message) as PublicTaskError
  err.status = r.status
  err.code = body.code
  err.details = body.details
  err.requestId = traceId || undefined
  err.rawResponse = body.rawResponse
  throw err
}

export async function runTaskByVendor(vendor: string, request: TaskRequestDto): Promise<TaskResultDto> {
  const normalizedVendor = String(vendor || '').trim()
  if (!normalizedVendor) throw new Error('vendor is required')
  const r = await apiFetch(`${API_BASE}/tasks`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendor: normalizedVendor, request }),
  }))
  if (!r.ok) {
    let errorMessage = `run task failed: ${r.status}`
    let errorData: unknown = null
    try {
      errorData = await r.json()
      const parsedMessage = isApiRecord(errorData)
        ? readApiErrorText(errorData.message) || readApiErrorText(errorData.error)
        : ''
      errorMessage = parsedMessage || errorMessage
    } catch {
      // ignore
    }
    const error = new Error(errorMessage) as PublicTaskError
    error.status = r.status
    if (isApiRecord(errorData)) {
      error.code = errorData.code
      error.details = errorData.details
    }
    throw error
  }
  return r.json()
}

export async function runPublicTask(payload: PublicRunTaskRequestDto): Promise<PublicRunTaskResponseDto> {
  const drawPayload = toPublicDrawPayload(payload)
  const run = (endpoint: '/public/tasks' | '/public/draw', bodyPayload: PublicRunTaskRequestDto | PublicDrawRequestDto) => apiFetch(`${API_BASE}${endpoint}`, withPublicWorkspace({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getClientPageTraceHeaders() },
    body: JSON.stringify(bodyPayload),
  }))
  let r = await run('/public/tasks', payload)
  // Keep original behavior by default; only switch to async draw path when gateway times out.
  if (!r.ok && r.status === 504 && drawPayload) {
    r = await run('/public/draw', drawPayload)
  }
  if (!r.ok) {
    try {
      await throwPublicTaskError(r, `run public task failed: ${r.status}`)
    } catch (error) {
      throw error
    }
  }
  return r.json()
}

// Same public task contract, with optional auth headers for existing project workbench callers.
export async function runPublicTaskWithAuth(payload: PublicRunTaskRequestDto): Promise<PublicRunTaskResponseDto> {
  const drawPayload = toPublicDrawPayload(payload)
  const run = (endpoint: '/public/tasks' | '/public/draw', bodyPayload: PublicRunTaskRequestDto | PublicDrawRequestDto) => apiFetch(`${API_BASE}${endpoint}`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getClientPageTraceHeaders() },
    body: JSON.stringify(bodyPayload),
  }))
  let r = await run('/public/tasks', payload)
  // Keep original behavior by default; only switch to async draw path when gateway times out.
  if (!r.ok && r.status === 504 && drawPayload) {
    r = await run('/public/draw', drawPayload)
  }
  if (!r.ok) {
    await throwPublicTaskError(r, `run public task(with auth) failed: ${r.status}`)
  }
  return r.json()
}

export async function fetchPublicTaskResult(payload: PublicFetchTaskResultRequestDto): Promise<PublicFetchTaskResultResponseDto> {
  const r = await apiFetch(`${API_BASE}/public/tasks/result`, withPublicWorkspace({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    let msg = `fetch public task result failed: ${r.status}`
    let body: unknown = null
    try {
      body = await r.json()
      if (isApiRecord(body)) {
        msg = readApiErrorText(body.message) || readApiErrorText(body.error) || msg
      }
    } catch {
      body = null
    }
    const err = new Error(msg) as PublicTaskError
    err.status = r.status
    if (isApiRecord(body)) {
      err.code = body.code
      err.details = body.details
    }
    throw err
  }
  return r.json()
}

// Same public task-result contract, with optional auth headers for existing project workbench callers.
export async function fetchPublicTaskResultWithAuth(payload: PublicFetchTaskResultRequestDto): Promise<PublicFetchTaskResultResponseDto> {
  const r = await apiFetch(`${API_BASE}/public/tasks/result`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    let msg = `fetch public task result(with auth) failed: ${r.status}`
    let body: unknown = null
    try {
      body = await r.json()
      if (typeof body === 'object' && body) {
        const b = body as { message?: unknown; error?: unknown }
        if (typeof b.message === 'string' && b.message.trim()) msg = b.message
        else if (typeof b.error === 'string' && b.error.trim()) msg = b.error
      }
    } catch {
      body = null
    }
    const err = new Error(msg) as Error & { status?: number; code?: unknown; details?: unknown }
    err.status = r.status
    if (typeof body === 'object' && body) {
      const b = body as { code?: unknown; details?: unknown }
      err.code = b.code
      err.details = b.details
    }
    throw err
  }
  return r.json()
}

export async function listPendingTasks(vendor?: string): Promise<TaskProgressSnapshotDto[]> {
  const qs = new URLSearchParams()
  if (vendor) qs.set('vendor', vendor)
  const url = qs.toString()
    ? `${API_BASE}/tasks/pending?${qs.toString()}`
    : `${API_BASE}/tasks/pending`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) {
    throw new Error(`list pending tasks failed: ${r.status}`)
  }
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!body) return []
  if (Array.isArray(body)) return body as TaskProgressSnapshotDto[]
  if (Array.isArray(body?.items)) return body.items as TaskProgressSnapshotDto[]
  return []
}

export type MemoryScopeType = 'user' | 'project' | 'session' | 'task'
export type MemoryEntryType = 'preference' | 'domain_fact' | 'artifact_ref' | 'summary'
export type MemoryStatus = 'active' | 'archived' | 'superseded'

export type MemoryEntryDto = {
  id: string
  scopeType: MemoryScopeType
  scopeId: string
  memoryType: MemoryEntryType
  title: string | null
  summaryText: string | null
  content: Record<string, unknown>
  importance: number
  status: MemoryStatus
  createdAt: string
  updatedAt: string
  tags: string[]
}

export type MemorySearchRequestDto = {
  query?: string
  scopes?: Array<{ scopeType: MemoryScopeType; scopeId: string }>
  memoryTypes?: MemoryEntryType[]
  tags?: string[]
  status?: MemoryStatus
  limit?: number
}

export type MemorySearchResponseDto = {
  items: MemoryEntryDto[]
}

export async function searchMemoryEntries(payload: MemorySearchRequestDto): Promise<MemorySearchResponseDto> {
  const r = await apiFetch(`${API_BASE}/memory/search`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, '查询记忆失败')
  return await r.json() as MemorySearchResponseDto
}

export type MemoryContextRequestDto = {
  sessionKey?: string
  projectId?: string
  limitPerScope?: number
  recentConversationLimit?: number
}

export type MemoryContextResponseDto = {
  entries: MemoryEntryDto[]
  promptText: string
  context: {
    recentConversation: MemoryConversationItemDto[]
  }
}

export type MemoryConversationAskUserPromptDto = {
  toolCallId: string
  question: string
  options: string[]
  optionCards?: Array<{
    value: string
    imageUrl: string
    thumbnailUrl?: string
    title?: string
    displayValue?: string
  }>
  urgency: 'info' | 'confirmation' | 'blocker'
  askedAt: string | null
  awaitingReply: boolean
}

export type MemoryConversationItemDto = {
  id: string
  role: string
  content: string
  assets: unknown[]
  skillMention?: string | null
  askUserPrompt?: MemoryConversationAskUserPromptDto | null
  uiSnapshot?: unknown | null
  createdAt: string
}

export async function getMemoryContext(payload: MemoryContextRequestDto): Promise<MemoryContextResponseDto> {
  const r = await apiFetch(`${API_BASE}/memory/context`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, '获取记忆上下文失败')
  return await r.json() as MemoryContextResponseDto
}

export type ProjectChatArtifactAssetDto = {
  type: string | null
  title: string | null
  url: string
  thumbnailUrl: string | null
  vendor: string | null
  modelKey: string | null
  taskId: string | null
}

export type ProjectChatArtifactTurnDto = {
  assistantMessageId: string
  createdAt: string
  userText: string | null
  assistantText: string
  assets: ProjectChatArtifactAssetDto[]
}

export type ProjectChatArtifactSessionDto = {
  sessionId: string
  sessionKey: string
  updatedAt: string
  lane: string
  skillId: string
  turns: ProjectChatArtifactTurnDto[]
}

export type ProjectChatArtifactSessionsRequestDto = {
  projectId: string
  flowId?: string
  limitSessions?: number
  limitTurns?: number
}

export type ProjectChatArtifactSessionsResponseDto = {
  items: ProjectChatArtifactSessionDto[]
}

export async function listProjectChatArtifactSessions(
  payload: ProjectChatArtifactSessionsRequestDto,
): Promise<ProjectChatArtifactSessionsResponseDto> {
  const r = await apiFetch(`${API_BASE}/memory/project-chat-artifacts`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, '获取项目对话产物历史失败')
  return await r.json() as ProjectChatArtifactSessionsResponseDto
}

export type MemoryEntry = {
  id: string
  scopeType: string
  scopeId: string
  memoryType: string
  title: string | null
  summaryText: string | null
  content: Record<string, unknown>
  sourceKind: string
  importance: number
  status: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export async function searchMemoryEntriesForPanel(input: {
  query?: string
  scopes?: Array<{ scopeType: string; scopeId: string }>
  memoryTypes?: string[]
  tags?: string[]
  limit?: number
}): Promise<MemoryEntry[]> {
  const r = await apiFetch(`${API_BASE}/memory/search`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
  if (!r.ok) await throwApiError(r, '搜索记忆失败')
  const data = await r.json() as { items: MemoryEntry[] }
  return data.items
}

export async function updateMemoryEntry(input: {
  id: string
  title?: string
  summaryText?: string
  content?: Record<string, unknown>
  importance?: number
  status?: string
  pinned?: boolean
  tags?: string[]
}): Promise<MemoryEntry> {
  const r = await apiFetch(`${API_BASE}/memory/entry`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
  if (!r.ok) await throwApiError(r, '更新记忆失败')
  const data = await r.json() as { item: MemoryEntry }
  return data.item
}

export async function deleteMemoryEntry(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/memory/entry`, withAuth({
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  }))
  if (!r.ok) await throwApiError(r, '删除记忆失败')
}

export async function createMemoryEntry(input: {
  scopeType: string
  scopeId: string
  memoryType: string
  title?: string
  summaryText?: string
  content: Record<string, unknown>
  sourceKind: string
  importance?: number
  tags?: string[]
}): Promise<string> {
  const r = await apiFetch(`${API_BASE}/memory/write`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [input] }),
  }))
  if (!r.ok) await throwApiError(r, '创建记忆失败')
  const data = await r.json() as { items: Array<{ id: string }> }
  return data.items[0]?.id ?? ''
}

export type CanvasAgentToolExecutionInput = {
	toolName: string
	args: Record<string, unknown>
	flowId: string
	nodeId: string
	projectId?: string | null
}

export async function executeCanvasAgentTool(
	input: CanvasAgentToolExecutionInput,
): Promise<Record<string, unknown>> {
	const toolCallId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
		? crypto.randomUUID()
		: `canvas-tool-${Date.now()}-${Math.random().toString(16).slice(2)}`
	const response = await apiFetch(`${API_BASE}/public/agents/tools/execute`, withAuth({
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...getClientPageTraceHeaders(),
		},
		body: JSON.stringify({
			toolName: input.toolName,
			args: input.args,
			context: {
				flowId: input.flowId,
				nodeId: input.nodeId,
				...(input.projectId ? { projectId: input.projectId } : {}),
			},
			run: {
				toolCallId,
				idempotencyKey: toolCallId,
			},
		}),
	}))
	if (!response.ok) await throwApiError(response, `${input.toolName} failed: ${response.status}`)
	const payload = await response.json().catch(() => null)
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		throw new Error(`${input.toolName} returned an invalid response`)
	}
	return payload as Record<string, unknown>
}

// ===========================================================================
// PPT Master — manual export trigger.
// Drives `canvas_ppt_master_export_to_pptx` from the canvas UI button so the
// user can re-export without going through chat.
// ===========================================================================

export type PptMasterExportResponse = {
  ok: boolean
  pptxPath?: string
  pptxUrl?: string
  stepStatus?: Record<string, string>
  detail?: string
  ready?: boolean
  missing?: string[]
}

export async function exportPptDeckToPptx(input: {
  flowId: string
  nodeId: string
  projectId?: string | null
  projectPath: string
  timeoutMs?: number
}): Promise<PptMasterExportResponse> {
  // Tool-invocation idempotency is required for canvas write tools. Use a fresh
  // UUID per click so the API does not reject repeat exports as duplicate.
  const toolCallId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `ppt-export-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const body = {
    toolName: 'canvas_ppt_master_export_to_pptx',
    args: {
      nodeId: input.nodeId,
      projectPath: input.projectPath,
      ...(typeof input.timeoutMs === 'number' ? { timeoutMs: input.timeoutMs } : {}),
    },
    context: {
      flowId: input.flowId,
      nodeId: input.nodeId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
    },
    run: {
      toolCallId,
      idempotencyKey: toolCallId,
    },
  }
  const r = await apiFetch(`${API_BASE}/public/agents/tools/execute`, withAuth({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...getClientPageTraceHeaders(),
    },
    body: JSON.stringify(body),
  }))
  if (!r.ok) await throwApiError(r, `PPT export failed: ${r.status}`)
  const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>
  const data = (payload?.data && typeof payload.data === 'object' ? payload.data : {}) as Record<string, unknown>
  // The patch result echoes the updated node; pull pptxUrl/pptxPath from there
  // if present, but fall back to the top-level effects.
  const nodes = Array.isArray((data as { data?: { nodes?: unknown[] } }).data?.nodes)
    ? ((data as { data: { nodes: Array<{ id?: string; data?: Record<string, unknown> }> } }).data.nodes)
    : []
  const target = nodes.find((n) => n && n.id === input.nodeId)
  const td = (target?.data && typeof target.data === 'object') ? target.data as Record<string, unknown> : {}
  const pptxUrl = typeof td.pptxUrl === 'string' ? td.pptxUrl.trim() : ''
  const pptxPath = typeof td.pptxPath === 'string' ? td.pptxPath.trim() : ''
  return {
    ok: true,
    pptxUrl: pptxUrl || undefined,
    pptxPath: pptxPath || undefined,
  }
}
