import type { Edge, Node } from '@xyflow/react'
import { normalizePublicFlowAnchorBindings, type PublicFlowAnchorBinding } from '@jarvishub/flow-anchor-bindings'
import type { ProjectRoleCardAssetDto, TaskKind, TaskRequestDto, TaskResultDto } from '../api/server'
import {
  agentsChat,
  listProjectRoleCardAssets,
  listServerAssets,
  runPublicTask,
  uploadServerAssetFile,
  fetchPublicTaskResult,
  upsertProjectRoleCardAsset,
} from '../api/server'
import { useUIStore } from '../ui/uiStore'
import { toast } from '../ui/toast'
import { runWebHeroNode } from './webHeroRunner'
import { notifyAssetRefresh } from '../ui/assetEvents'
import { isAnthropicModel } from '../config/modelSource'
import { getDefaultModel } from '../config/models'
import { resolveExecutableImageModel } from '../config/useModelOptions'
import { normalizeOrientation, type Orientation } from '../utils/orientation'
import { buildVideoSpecKey, normalizeVideoResolution } from '../utils/videoSpec'
import {
  buildVideoDurationPatch,
  parseVideoDurationFromSpecKey,
  readVideoDurationSeconds,
} from '../utils/videoDuration'
import { isRemoteUrl } from '../canvas/nodes/taskNode/utils'
import { buildTaskDiagnosticError, resolveTaskErrorDisplay } from './taskErrorClassifier'
import {
  mergeExecutionPromptSequence,
  shouldInheritInboundPromptForExecution,
} from './promptAssembly'
import {
  collectNodeReferenceImageUrls,
} from './nodeReferenceInputs'
import {
  doesRoleCardStateMatchQuery,
  extractRoleCardMentionTokens,
  type RoleCardMentionToken,
} from './roleCardMention'
import {
  type PreparedVideoReferenceAsset,
} from './videoReferenceAssetPrep'
import {
  appendReferenceAliasSlotPrompt,
  buildAssetRefId,
  buildImageAssetResultItem,
  buildNamedReferenceEntries,
  buildVideoAssetResultItem,
  mergeReferenceAssetInputs,
  type AssetResultItem,
} from './assetReference'
import {
  composeLabeledReferenceSheetBlob,
  uploadMergedReferenceSheet,
  type UploadedReferenceSheet,
} from './referenceSheet'
import { parseImageEditSizeDimensions } from '../canvas/nodes/taskNode/imageEditSize'
import { appendImageEditFocusGuidePrompt } from '../canvas/nodes/taskNode/imageEditFocusGuide'
import {
  collectOrderedUpstreamMediaSources,
  collectOrderedUpstreamReferenceItems,
  collectPoseReferenceUrlsFromNode,
  extractNodePrimaryAssetReference,
  pickPrimaryImageFromNode,
} from '../canvas/nodes/taskNode/upstreamReferences'
import {
  resolveCompiledImagePrompt,
  resolveImagePromptExecution,
} from '../canvas/nodes/taskNode/imagePromptSpec'
import { resolveImageResolutionSetting } from './imageResolution'
import imageViewControlsModule from '@jarvishub/image-view-controls'
import {
  resolveSemanticNodeRoleBinding,
  resolveSemanticNodeVisualReferenceBinding,
  upsertSemanticNodeAnchorBinding,
} from '../canvas/utils/semanticBindings'

const { appendImageViewPrompt } = imageViewControlsModule

type Getter = () => any
type Setter = (fn: (s: any) => any) => void
type NodeStatusValue = 'idle' | 'queued' | 'running' | 'success' | 'error'

interface RunnerHandlers {
  setNodeStatus: (id: string, status: NodeStatusValue, patch?: Partial<any>) => void
  appendLog: (id: string, line: string) => void
  beginToken: (id: string) => string
  endRunToken: (id: string) => void
  isCanceled: (id: string, runToken?: string | null) => boolean
}

interface RunnerContext extends RunnerHandlers {
  id: string
  state: any
  data: any
  kind: string
  taskKind: TaskKind
  prompt: string
  sampleCount: number
  supportsSamples: boolean
  isImageTask: boolean
  isVideoTask: boolean
  modelKey?: string
  getState: Getter
}

function nowLabel() {
  return new Date().toLocaleTimeString()
}

const DEFAULT_TASK_POLL_TIMEOUT_MS = 600_000
const MAX_VIDEO_DURATION_SECONDS = 15
const SORA2_PRO_MAX_VIDEO_DURATION_SECONDS = 25
const IMAGE_NODE_KINDS = new Set(['image', 'imageEdit'])
const VIDEO_RENDER_NODE_KINDS = new Set(['video', 'composeVideo'])
const NON_EXECUTABLE_REMOTE_NODE_KINDS = new Set(['text'])
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
const DEFAULT_IMAGE_MODEL = getDefaultModel('image')
const DEFAULT_IMAGE_EDIT_MODEL = getDefaultModel('imageEdit')

function isVideoRenderKind(kind: string | null | undefined): boolean {
  return typeof kind === 'string' && VIDEO_RENDER_NODE_KINDS.has(kind)
}

function resolveDefaultImageModelForTask(taskKind: 'text_to_image' | 'image_edit'): string {
  return taskKind === 'image_edit' ? DEFAULT_IMAGE_EDIT_MODEL : DEFAULT_IMAGE_MODEL
}

function resolveImageTaskVendor(selectedModel: string, explicitVendor?: string | null): string {
  const normalizedExplicitVendor = String(explicitVendor || '').trim().toLowerCase()
  if (normalizedExplicitVendor) return normalizedExplicitVendor
  const modelLower = selectedModel.toLowerCase()
  if (modelLower.includes('gemini')) return 'gemini'
  if (modelLower.includes('gpt') || modelLower.includes('openai') || modelLower.includes('dall') || modelLower.includes('o3-')) {
    return 'openai'
  }
  return 'qwen'
}
type RoleCardRef = {
  roleName: string
  roleNameKey: string
  roleIdKey: string
  cardIdKey: string
  imageUrl: string
  ageDescription?: string
  stateLabel?: string
  stateDescription: string
  stateKey: string
  updatedAtTs: number
}

const ROLE_CARD_INDEX_CACHE = new Map<string, { at: number; roleNameMap: Map<string, RoleCardRef[]> }>()
const ROLE_CARD_INDEX_CACHE_TTL_MS = 60_000
type RoleCardMentionResult = { urls: string[]; matched: string[]; missing: string[]; ambiguous: string[] }
type PromptAssetRef = {
  assetRefId: string
  assetRefIdKey: string
  url: string
  assetId: string | null
  name: string
  updatedAtTs: number
}
type PromptAssetMentionResult = { urls: string[]; matched: string[]; missing: string[]; ambiguous: string[] }
const PROJECT_ASSET_MENTION_CACHE = new Map<string, { at: number; refs: PromptAssetRef[] }>()
const PROJECT_ASSET_MENTION_CACHE_TTL_MS = 60_000

function normalizeMentionToken(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[，。！？、；：,.!?;:)\]】》〉'"`]+$/g, '')
    .toLowerCase()
}

function normalizeMentionTokenCompact(raw: string): string {
  return normalizeMentionToken(raw).replace(/\s+/g, '')
}

function extractPromptMentionTokens(raw: string): string[] {
  const matches = String(raw || '').match(/@[^\s@]+/g) || []
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of matches) {
    const normalized = normalizeMentionToken(match)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function readPromptAssetReferenceUrl(record: Record<string, unknown>): string {
  const readUrl = (value: unknown): string => {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    return trimmed ? toAbsoluteHttpUrl(trimmed) || trimmed : ''
  }
  const imageResults = Array.isArray(record.imageResults) ? record.imageResults : []
  for (const item of imageResults) {
    if (!item || typeof item !== 'object') continue
    const url = readUrl((item as Record<string, unknown>).url)
    if (url) return url
  }
  const directImageUrl = readUrl(record.imageUrl)
  if (directImageUrl) return directImageUrl
  const videoResults = Array.isArray(record.videoResults) ? record.videoResults : []
  for (const item of videoResults) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const thumbnailUrl = readUrl(row.thumbnailUrl)
    if (thumbnailUrl) return thumbnailUrl
    const url = readUrl(row.url)
    if (url) return url
  }
  return readUrl(record.videoThumbnailUrl) || readUrl(record.videoUrl)
}

function normalizeRoleCardStateKey(raw: string): string {
  return normalizeMentionToken(String(raw || '').replace(/\s+/g, ' '))
}

function normalizePositiveChapter(value: unknown): number | undefined {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return Math.trunc(numeric)
}

function readRunnerChapter(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  return normalizePositiveChapter(record.chapter) ?? normalizePositiveChapter(record.materialChapter) ?? null
}

function buildProjectAssetRoleCardRefs(cards: ProjectRoleCardAssetDto[]): RoleCardRef[] {
  const refs: RoleCardRef[] = []
  for (const asset of cards) {
    const card = asset.data
    const status = String(card?.status || '').trim().toLowerCase()
    const imageUrl = String(card?.threeViewImageUrl || card?.imageUrl || '').trim()
    const roleName = String(card?.roleName || '').trim()
    const roleNameKey = normalizeMentionToken(roleName)
    if (status !== 'generated' || !imageUrl || !roleNameKey) continue
    refs.push({
      roleName,
      roleNameKey,
      roleIdKey: normalizeMentionToken(String(card?.roleId || '')),
      cardIdKey: normalizeMentionToken(String(card?.cardId || asset.id || '')),
      imageUrl,
      ageDescription: String(card?.ageDescription || card?.age || card?.ageLabel || '').trim(),
      stateLabel: String(card?.stateLabel || card?.currentState || card?.healthStatus || card?.injuryStatus || '').trim(),
      stateDescription: String(card?.stateDescription || '').trim(),
      stateKey: normalizeRoleCardStateKey(String(card?.stateKey || card?.stateDescription || '')),
      updatedAtTs: Date.parse(String(card?.updatedAt || asset.updatedAt || asset.createdAt || '')) || 0,
    })
  }
  return refs
}


async function resolveRoleCardImagesByMentions(input: {
  prompt?: string | null
}): Promise<RoleCardMentionResult> {
  const empty: RoleCardMentionResult = { urls: [], matched: [], missing: [], ambiguous: [] }
  const projectId = String((useUIStore.getState() as any)?.currentProject?.id || '').trim()
  const prompt = String(input.prompt || '').trim()
  if (!projectId || !prompt) return empty
  const mentions = extractRoleCardMentionTokens(prompt)
  if (!mentions.length) return empty

  const cacheKey = `${projectId}`
  const cached = await refreshRoleCardCacheIfNeeded({ cacheKey, projectId })
  return buildRoleCardMatchResult(mentions, cached.roleNameMap)
}

function sortRoleCardsByPriority(cards: RoleCardRef[]): RoleCardRef[] {
  return cards.slice().sort((a, b) => b.updatedAtTs - a.updatedAtTs)
}

function buildRoleCardNameMap(cards: RoleCardRef[]): Map<string, RoleCardRef[]> {
  const roleNameMap = new Map<string, RoleCardRef[]>()
  for (const asset of sortRoleCardsByPriority(cards)) {
    const keySet = new Set<string>([asset.roleNameKey, normalizeMentionTokenCompact(asset.roleName)])
    for (const key of keySet) {
      const normalizedKey = String(key || '').trim()
      if (!normalizedKey) continue
      const list = roleNameMap.get(normalizedKey) || []
      list.push(asset)
      roleNameMap.set(normalizedKey, list)
    }
  }
  return roleNameMap
}

async function refreshRoleCardCacheIfNeeded(input: {
  cacheKey: string
  projectId: string
}): Promise<{ at: number; roleNameMap: Map<string, RoleCardRef[]> }> {
  const now = Date.now()
  const cached = ROLE_CARD_INDEX_CACHE.get(input.cacheKey)
  if (cached && now - cached.at <= ROLE_CARD_INDEX_CACHE_TTL_MS) return cached
  const cards = await listProjectRoleCardAssets(input.projectId)
  const refreshed = { at: now, roleNameMap: buildRoleCardNameMap(buildProjectAssetRoleCardRefs(cards)) }
  ROLE_CARD_INDEX_CACHE.set(input.cacheKey, refreshed)
  return refreshed
}

function buildCanvasPromptAssetRefs(nodes: Node[]): PromptAssetRef[] {
  const out: PromptAssetRef[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    const primaryAsset = extractNodePrimaryAssetReference(node)
    if (!primaryAsset) continue
    const assetRefIdKey = normalizeMentionToken(primaryAsset.assetRefId)
    if (!assetRefIdKey || seen.has(assetRefIdKey)) continue
    seen.add(assetRefIdKey)
    out.push({
      assetRefId: primaryAsset.assetRefId,
      assetRefIdKey,
      url: primaryAsset.url,
      assetId: primaryAsset.assetId,
      name: primaryAsset.displayName,
      updatedAtTs: 0,
    })
  }
  return out
}

async function refreshProjectAssetMentionCacheIfNeeded(input: {
  cacheKey: string
  projectId: string
}): Promise<{ at: number; refs: PromptAssetRef[] }> {
  const now = Date.now()
  const cached = PROJECT_ASSET_MENTION_CACHE.get(input.cacheKey)
  if (cached && now - cached.at <= PROJECT_ASSET_MENTION_CACHE_TTL_MS) return cached
  const result = await listServerAssets({ projectId: input.projectId, kind: 'generation', limit: 200 })
  const refs = (Array.isArray(result.items) ? result.items : [])
    .map((asset) => {
      const rawData = asset?.data
      const data = rawData && typeof rawData === 'object' && !Array.isArray(rawData)
        ? rawData as Record<string, unknown>
        : {}
      const assetRefId = String(data.assetRefId || asset.name || asset.id || '').trim()
      const assetRefIdKey = normalizeMentionToken(assetRefId)
      const url = readPromptAssetReferenceUrl(data)
      if (!assetRefIdKey || !url) return null
      return {
        assetRefId,
        assetRefIdKey,
        url,
        assetId: String(asset.id || '').trim() || null,
        name: String(data.assetName || asset.name || assetRefId).trim() || assetRefId,
        updatedAtTs: Date.parse(String(asset.updatedAt || asset.createdAt || '')) || 0,
      } satisfies PromptAssetRef
    })
    .filter((item): item is PromptAssetRef => item !== null)
    .sort((left, right) => right.updatedAtTs - left.updatedAtTs)
  const refreshed = { at: now, refs }
  PROJECT_ASSET_MENTION_CACHE.set(input.cacheKey, refreshed)
  return refreshed
}

async function resolveAssetImagesByMentions(input: {
  prompt?: string | null
  nodes?: Node[]
}): Promise<PromptAssetMentionResult> {
  const empty: PromptAssetMentionResult = { urls: [], matched: [], missing: [], ambiguous: [] }
  const projectId = String((useUIStore.getState() as { currentProject?: { id?: string | null } })?.currentProject?.id || '').trim()
  const prompt = String(input.prompt || '').trim()
  if (!projectId || !prompt) return empty
  const mentions = extractPromptMentionTokens(prompt)
  if (!mentions.length) return empty

  const canvasRefs = buildCanvasPromptAssetRefs(Array.isArray(input.nodes) ? input.nodes : [])
  const projectCache = await refreshProjectAssetMentionCacheIfNeeded({ cacheKey: projectId, projectId })
  const candidatesByMention = new Map<string, PromptAssetRef[]>()
  for (const ref of [...canvasRefs, ...projectCache.refs]) {
    const key = ref.assetRefIdKey
    if (!key) continue
    const list = candidatesByMention.get(key) || []
    if (!list.some((item) => item.url === ref.url && item.assetId === ref.assetId)) {
      list.push(ref)
      candidatesByMention.set(key, list)
    }
  }

  const urls: string[] = []
  const urlSeen = new Set<string>()
  const matched: string[] = []
  const missing: string[] = []
  const ambiguous: string[] = []

  for (const mention of mentions) {
    const candidates = candidatesByMention.get(mention) || []
    if (candidates.length === 0) {
      missing.push(`@${mention}`)
      continue
    }
    if (candidates.length > 1) {
      ambiguous.push(`@${mention}`)
      continue
    }
    const candidate = candidates[0]!
    matched.push(`@${candidate.assetRefId}`)
    if (!urlSeen.has(candidate.url)) {
      urlSeen.add(candidate.url)
      urls.push(candidate.url)
    }
  }

  return { urls, matched, missing, ambiguous }
}

function pickRoleCardCandidate(mention: RoleCardMentionToken, candidates: RoleCardRef[]): RoleCardRef | 'missing' | 'ambiguous' {
  if (!candidates.length) return 'missing'
  const narrowedByState = mention.stateKey
    ? candidates.filter((candidate) =>
        doesRoleCardStateMatchQuery({
          queryStateKey: mention.stateKey,
          ageDescription: candidate.ageDescription,
          stateDescription: candidate.stateDescription,
          stateLabel: candidate.stateLabel,
          stateKey: candidate.stateKey,
        }),
      )
    : candidates
  if (!narrowedByState.length) return 'missing'
  if (!mention.disambiguatorKey) return narrowedByState.length === 1 ? narrowedByState[0] : 'ambiguous'
  const picked =
    narrowedByState.find((x) => x.roleIdKey && x.roleIdKey.startsWith(mention.disambiguatorKey)) ||
    narrowedByState.find((x) => x.cardIdKey && x.cardIdKey.startsWith(mention.disambiguatorKey)) ||
    null
  return picked || 'missing'
}

function pushUniqueUrl(target: string[], seen: Set<string>, url: string) {
  if (!seen.has(url)) {
    seen.add(url)
    target.push(url)
  }
}

function buildRoleCardMatchResult(mentions: RoleCardMentionToken[], roleNameMap: Map<string, RoleCardRef[]>): RoleCardMentionResult {
  const urls: string[] = []
  const matched: string[] = []
  const missing: string[] = []
  const ambiguous: string[] = []
  const seenUrl = new Set<string>()
  for (const mention of mentions) {
    const picked = pickRoleCardCandidate(mention, roleNameMap.get(mention.roleNameKey) || [])
    if (picked === 'missing') {
      missing.push(mention.rawDisplay)
      continue
    }
    if (picked === 'ambiguous') {
      ambiguous.push(mention.rawDisplay)
      continue
    }
    const url = String(picked.imageUrl || '').trim()
    if (!url) {
      missing.push(mention.rawDisplay)
      continue
    }
    matched.push(mention.rawDisplay)
    pushUniqueUrl(urls, seenUrl, url)
  }
  return { urls: urls.slice(0, 3), matched, missing, ambiguous }
}

async function resolveFallbackRoleCardImages(input: {
  limit?: number
}): Promise<{ urls: string[]; names: string[] }> {
  const projectId = String((useUIStore.getState() as any)?.currentProject?.id || '').trim()
  const limit = Math.max(1, Math.min(8, Math.trunc(Number(input.limit || 3))))
  if (!projectId) return { urls: [], names: [] }
  try {
    const projectOrdered = buildProjectAssetRoleCardRefs(await listProjectRoleCardAssets(projectId))
    const sorted = sortRoleCardsByPriority(projectOrdered)
    const urls: string[] = []
    const names: string[] = []
    const seen = new Set<string>()
    for (const asset of sorted) {
      const url = String(asset.imageUrl || '').trim()
      const roleName = String(asset.roleName || '').trim()
      if (!url || !roleName || seen.has(url)) continue
      seen.add(url)
      urls.push(url)
      names.push(roleName)
      if (urls.length >= limit) break
    }
    return { urls, names }
  } catch {
    return { urls: [], names: [] }
  }
}

function readSemanticAnchorBindings(nodeData: Record<string, unknown>): PublicFlowAnchorBinding[] {
  return normalizePublicFlowAnchorBindings(nodeData.anchorBindings)
}

function normalizeSemanticIdPart(input: unknown): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function inferSemanticShotNo(input: {
  explicitShotNo?: number
  nodeData: Record<string, unknown>
}): number | null {
  if (typeof input.explicitShotNo === 'number' && Number.isFinite(input.explicitShotNo) && input.explicitShotNo > 0) {
    return Math.trunc(input.explicitShotNo)
  }
  const candidates = [
    Number(input.nodeData.sourceShotNo),
    Number(input.nodeData.shotNo),
  ]
  for (const value of candidates) {
    if (Number.isFinite(value) && value > 0) return Math.trunc(value)
  }
  return null
}

function buildStableSemanticAssetId(input: {
  nodeId: string
  mediaKind: 'image' | 'video'
  explicitSemanticId?: string
  explicitShotNo?: number
  nodeData: Record<string, unknown>
}): string {
  const explicit = normalizeSemanticIdPart(input.explicitSemanticId)
  if (explicit) return explicit
  const sourceEntityKey = normalizeSemanticIdPart(input.nodeData.sourceEntityKey)
  if (sourceEntityKey) return `entity-${sourceEntityKey}-${input.mediaKind}`
  const sourceShotId = normalizeSemanticIdPart(input.nodeData.sourceShotId)
  if (sourceShotId) return `shot-${sourceShotId}-${input.mediaKind}`
  const shotNo = inferSemanticShotNo({
    explicitShotNo: input.explicitShotNo,
    nodeData: input.nodeData,
  })
  const chapter = readRunnerChapter(input.nodeData)
  if (shotNo && typeof chapter === 'number') {
    return `chapter-${chapter}-shot-${shotNo}-${input.mediaKind}`
  }
  if (shotNo) {
    return `shot-no-${shotNo}-${input.mediaKind}`
  }
  return `node-${normalizeSemanticIdPart(input.nodeId) || 'unknown'}-${input.mediaKind}`
}


async function persistSemanticAssetMetadata(input: {
  nodeId: string
  nodeKind: string
  nodeData: Record<string, unknown>
  mediaKind: 'image' | 'video'
  imageUrl?: string
  videoUrl?: string
  thumbnailUrl?: string
  prompt?: string
  shotNo?: number
  semanticId?: string
}): Promise<{
  semanticId: string
  sourceBookId: string | null
  metadataSynced: boolean
  bookScopeStatus: 'explicit' | 'single_project_book' | 'missing_or_ambiguous'
} | null> {
  const projectId = String((useUIStore.getState() as any)?.currentProject?.id || '').trim()
  if (!projectId) return null
  const imageUrl = String(input.imageUrl || '').trim()
  const videoUrl = String(input.videoUrl || '').trim()
  if (input.mediaKind === 'image' && !imageUrl) return null
  if (input.mediaKind === 'video' && !videoUrl) return null

  return {
    semanticId: String(input.semanticId || `node-${input.nodeId}-${input.mediaKind}`).trim(),
    sourceBookId: null,
    metadataSynced: false,
    bookScopeStatus: 'missing_or_ambiguous' as const,
  }
}

async function persistRoleCardImageBinding(input: {
  nodeId: string
  nodeData: Record<string, unknown>
  imageUrl: string
  prompt?: string
  modelKey?: string
}): Promise<{
  roleName: string
  roleId: string | null
  roleCardId: string | null
  sourceBookId: string | null
  metadataSynced: boolean
  bookScopeStatus: 'explicit' | 'single_project_book' | 'missing_or_ambiguous'
} | null> {
  const projectId = String((useUIStore.getState() as any)?.currentProject?.id || '').trim()
  const semanticRoleBinding = resolveSemanticNodeRoleBinding(input.nodeData)
  const roleName = String(semanticRoleBinding.roleName || '').trim()
  if (!projectId || !roleName) return null
  const bookScopeStatus = 'missing_or_ambiguous' as const

  const chapter = readRunnerChapter(input.nodeData)
  const stateDescription = String(input.nodeData.stateDescription || '').trim()
  const stateKey = normalizeRoleCardStateKey(String(input.nodeData.stateKey || stateDescription))
  const ageDescription = String(input.nodeData.ageDescription || '').trim()
  const stateLabel = String(input.nodeData.stateLabel || '').trim()
  const healthStatus = String(input.nodeData.healthStatus || '').trim()
  const injuryStatus = String(input.nodeData.injuryStatus || '').trim()
  const threeViewImageUrl =
    semanticRoleBinding.referenceView === 'three_view'
      ? String(input.imageUrl || '').trim()
      : ''
  const saved = await upsertProjectRoleCardAsset(projectId, {
    cardId: String(input.nodeData.roleCardId || '').trim() || undefined,
    roleId: String(input.nodeData.roleId || '').trim() || undefined,
    roleName,
    ...(stateDescription ? { stateDescription } : {}),
    ...(stateKey ? { stateKey } : {}),
    ...(ageDescription ? { ageDescription } : {}),
    ...(stateLabel ? { stateLabel } : {}),
    ...(healthStatus ? { healthStatus } : {}),
    ...(injuryStatus ? { injuryStatus } : {}),
    ...(typeof chapter === 'number' ? { chapter } : {}),
    nodeId: input.nodeId,
    prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
    status: 'generated',
    modelKey: String(input.modelKey || '').trim() || undefined,
    imageUrl: String(input.imageUrl || '').trim() || undefined,
    ...(threeViewImageUrl ? { threeViewImageUrl } : {}),
  })
  let resolvedRoleId = String(saved?.data?.roleId || '').trim()
  let resolvedRoleCardId = String(saved?.data?.cardId || saved?.id || '').trim()

  return {
    roleName,
    roleId: resolvedRoleId || null,
    roleCardId: resolvedRoleCardId || null,
    sourceBookId: null,
    metadataSynced: false,
    bookScopeStatus,
  }
}

async function persistVisualReferenceImageBinding(_input: {
  nodeId: string
  nodeData: Record<string, unknown>
  imageUrl: string
  prompt?: string
  modelKey?: string
}): Promise<{
  refId: string
  refName: string
  category: 'scene_prop' | 'spell_fx'
  sourceBookId: string
  bookScopeStatus: 'explicit' | 'single_project_book' | 'missing_or_ambiguous'
} | null> {
  return null
}

function buildSemanticProjectTaskBindingPatch(input: {
  nodeData: Record<string, unknown>
  taskKind: TaskKind
}): Record<string, unknown> {
  if (input.taskKind !== 'text_to_image') return {}
  const roleBinding = resolveSemanticNodeRoleBinding(input.nodeData)
  const visualBinding = resolveSemanticNodeVisualReferenceBinding(input.nodeData)
  const patch: Record<string, unknown> = {}

  const existingRoleName = String(input.nodeData.roleName || '').trim()
  const existingRoleId = String(input.nodeData.roleId || '').trim()
  const existingRoleCardId = String(input.nodeData.roleCardId || '').trim()
  const existingReferenceView = String(input.nodeData.referenceView || '').trim()
  const existingSourceBookId = String(input.nodeData.sourceBookId || input.nodeData.bookId || '').trim()
  const existingVisualRefId =
    String(input.nodeData.scenePropRefId || input.nodeData.visualRefId || '').trim()
  const existingVisualRefName =
    String(input.nodeData.scenePropRefName || input.nodeData.visualRefName || '').trim()
  const existingVisualRefCategory = String(input.nodeData.visualRefCategory || '').trim()

  if (roleBinding.roleName && !existingRoleName) patch.roleName = roleBinding.roleName
  if (roleBinding.roleId && !existingRoleId) patch.roleId = roleBinding.roleId
  if (roleBinding.roleCardId && !existingRoleCardId) patch.roleCardId = roleBinding.roleCardId
  if (roleBinding.referenceView && !existingReferenceView) patch.referenceView = roleBinding.referenceView
  if (roleBinding.sourceBookId && !existingSourceBookId) patch.sourceBookId = roleBinding.sourceBookId

  if (visualBinding.refId && !existingVisualRefId) {
    patch.visualRefId = visualBinding.refId
    if (!String(input.nodeData.scenePropRefId || '').trim()) patch.scenePropRefId = visualBinding.refId
  }
  if (visualBinding.refName && !existingVisualRefName) {
    patch.visualRefName = visualBinding.refName
    if (!String(input.nodeData.scenePropRefName || '').trim()) patch.scenePropRefName = visualBinding.refName
  }
  if (visualBinding.category && !existingVisualRefCategory) {
    patch.visualRefCategory = visualBinding.category
  }
  if (visualBinding.sourceBookId && !existingSourceBookId) {
    patch.sourceBookId = visualBinding.sourceBookId
  }
  if (
    roleBinding.roleName ||
    roleBinding.roleCardId ||
    roleBinding.roleId ||
    visualBinding.refName ||
    visualBinding.refId
  ) {
    let nextAnchorBindings = input.nodeData.anchorBindings
    if (roleBinding.roleName || roleBinding.roleCardId || roleBinding.roleId) {
      nextAnchorBindings = upsertSemanticNodeAnchorBinding({
        existing: nextAnchorBindings,
        next: {
          kind: 'character',
          label: roleBinding.roleName,
          refId: roleBinding.roleCardId,
          entityId: roleBinding.roleId,
          sourceBookId: roleBinding.sourceBookId,
          referenceView: roleBinding.referenceView,
        },
      })
    }
    if (visualBinding.refName || visualBinding.refId) {
      nextAnchorBindings = upsertSemanticNodeAnchorBinding({
        existing: nextAnchorBindings,
        next: {
          kind: 'scene',
          label: visualBinding.refName,
          refId: visualBinding.refId,
          sourceBookId: visualBinding.sourceBookId,
          category: visualBinding.category,
        },
        replaceKinds: ['scene', 'prop'],
      })
    }
    patch.anchorBindings = nextAnchorBindings
  }

  return patch
}

function readNodeRunToken(getState: Getter, id: string): string | null {
  const s = getState()
  const nodes = (s?.nodes || []) as any[]
  const node = nodes.find((n) => n?.id === id)
  const token = (node?.data as any)?.runToken
  if (typeof token !== 'string') return null
  const trimmed = token.trim()
  return trimmed ? trimmed : null
}

function isRunTokenActive(getState: Getter, id: string, runToken: string): boolean {
  if (!runToken) return true
  return readNodeRunToken(getState, id) === runToken
}

const TASK_LOG_REQUEST_MAX_CHARS = 12000

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function looksLikeBase64DataUrl(value: string): boolean {
  return /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i.test(value.trim())
}

function looksLikeBareBase64(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  if (!compact || compact.length < 256) return false
  if (compact.length % 4 !== 0) return false
  return /^[a-z0-9+/=]+$/i.test(compact)
}

function buildReferenceSheetLogMeta(sheet: UploadedReferenceSheet | null | undefined): Record<string, unknown> | undefined {
  if (!sheet?.url) return undefined
  return {
    kind: 'collage',
    url: sheet.url,
    sourceUrls: sheet.sourceUrls,
    entries: sheet.entries.map((entry) => ({
      id: entry.label,
      sourceUrl: entry.sourceUrl,
      ...(entry.assetId ? { assetId: entry.assetId } : null),
      ...(entry.note ? { note: entry.note } : null),
    })),
  }
}

function sanitizeTaskLogValue(value: unknown): unknown {
  const seen = new WeakSet<object>()

  const walk = (input: unknown): unknown => {
    if (input === null || input === undefined) return input
    if (typeof input === 'string') {
      const trimmed = input.trim()
      if (looksLikeBase64DataUrl(trimmed)) {
        return `[stripped-data-url len=${trimmed.length}]`
      }
      if (looksLikeBareBase64(trimmed)) {
        return `[stripped-base64 len=${trimmed.replace(/\s+/g, '').length}]`
      }
      return input
    }
    if (typeof input !== 'object') return input
    if (seen.has(input)) return '[Circular]'
    seen.add(input)
    if (Array.isArray(input)) return input.map((item) => walk(item))
    if (!isPlainRecord(input)) return input

    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(input)) {
      if (typeof child === 'string' && looksLikeBase64DataUrl(child)) {
        out[key] = `[stripped-data-url len=${child.trim().length}]`
        continue
      }
      if (typeof child === 'string' && looksLikeBareBase64(child)) {
        out[key] = `[stripped-base64 len=${child.replace(/\s+/g, '').length}]`
        continue
      }
      out[key] = walk(child)
    }
    return out
  }

  return walk(value)
}

function formatTaskLogJson(value: unknown): string {
  const text = JSON.stringify(sanitizeTaskLogValue(value), null, 2)
  if (typeof text !== 'string' || !text.trim()) return 'null'
  if (text.length <= TASK_LOG_REQUEST_MAX_CHARS) return text
  return `${text.slice(0, TASK_LOG_REQUEST_MAX_CHARS)}\n…[truncated]`
}

function appendRequestPayloadLog(input: {
  appendLog: RunnerHandlers['appendLog']
  nodeId: string
  result: TaskResultDto
  fallbackVendor: string
  fallbackRequest?: TaskRequestDto
}): void {
  const raw = isPlainRecord(input.result.raw) ? input.result.raw : null
  const provider = raw && typeof raw.provider === 'string' ? raw.provider.trim() : ''
  const upstreamRequest = raw && 'request' in raw ? raw.request : undefined

  if (typeof upstreamRequest !== 'undefined') {
    input.appendLog(
      input.nodeId,
      `[${nowLabel()}] 上游请求体（${provider || input.fallbackVendor}）:\n${formatTaskLogJson(upstreamRequest)}`,
    )
    return
  }

  if (input.fallbackRequest) {
    input.appendLog(
      input.nodeId,
      `[${nowLabel()}] 请求体（${input.fallbackVendor}）:\n${formatTaskLogJson({ vendor: input.fallbackVendor, request: input.fallbackRequest })}`,
    )
  }
}

async function runAutoTask(request: TaskRequestDto): Promise<TaskResultDto> {
  const res = await runPublicTask({ request })
  return res.result
}

function beginPendingRequestProgress(
  ctx: Pick<RunnerContext, 'id' | 'setNodeStatus' | 'isCanceled'>,
  options: {
    status?: 'queued' | 'running'
    startProgress: number
    maxProgress: number
    statusPatch?: Record<string, unknown>
    stepMs?: number
  },
): () => number {
  const status = options.status ?? 'running'
  const startProgress = Math.max(0, Math.min(95, Math.round(options.startProgress)))
  const maxProgress = Math.max(startProgress, Math.min(95, Math.round(options.maxProgress)))
  const stepMs = Math.max(600, Math.round(options.stepMs ?? 1800))
  let lastProgress = startProgress
  if (maxProgress <= startProgress) {
    return () => lastProgress
  }

  const timer = setInterval(() => {
    if (ctx.isCanceled(ctx.id)) {
      clearInterval(timer)
      return
    }
    const nextProgress = Math.min(maxProgress, lastProgress + 1)
    if (nextProgress <= lastProgress) return
    lastProgress = nextProgress
    ctx.setNodeStatus(ctx.id, status, {
      ...(options.statusPatch || {}),
      progress: lastProgress,
    })
  }, stepMs)

  return () => {
    clearInterval(timer)
    return lastProgress
  }
}

async function runTaskByVendorWithPendingProgress(
  ctx: Pick<RunnerContext, 'id' | 'setNodeStatus' | 'isCanceled'>,
  options: {
    request: TaskRequestDto
    startProgress: number
    maxProgress: number
    status?: 'queued' | 'running'
    statusPatch?: Record<string, unknown>
    stepMs?: number
  },
): Promise<{ result: TaskResultDto; requestProgress: number }> {
  const stopProgress = beginPendingRequestProgress(ctx, {
    status: options.status,
    startProgress: options.startProgress,
    maxProgress: options.maxProgress,
    statusPatch: options.statusPatch,
    stepMs: options.stepMs,
  })
  try {
    const result = await runAutoTask(options.request)
    return {
      result,
      requestProgress: stopProgress(),
    }
  } catch (error) {
    stopProgress()
    throw error
  }
}

async function runAutoChat(payload: {
  prompt: string
  systemPrompt?: string
  modelAlias?: string
  referenceImages?: string[]
}): Promise<TaskResultDto> {
  const res = await agentsChat({
    prompt: payload.prompt,
    userMessageId: `m_user_runner_${crypto.randomUUID()}`,
    assistantMessageId: `m_ai_runner_${crypto.randomUUID()}`,
    ...(payload.systemPrompt ? { systemPrompt: payload.systemPrompt } : {}),
    ...(payload.modelAlias ? { modelAlias: payload.modelAlias } : {}),
    ...(Array.isArray(payload.referenceImages) && payload.referenceImages.length
      ? { referenceImages: payload.referenceImages }
      : {}),
    mode: 'auto',
  })
  const assets = Array.isArray(res.assets)
    ? res.assets
        .map((a) => {
          const type = String(a?.type || '').trim().toLowerCase()
          const url = typeof a?.url === 'string' ? a.url.trim() : ''
          if (!url) return null
          if (type === 'video') return { type: 'video' as const, url, thumbnailUrl: a?.thumbnailUrl || null }
          return { type: 'image' as const, url, thumbnailUrl: a?.thumbnailUrl || null }
        })
        .filter(Boolean) as Array<{ type: 'image' | 'video'; url: string; thumbnailUrl?: string | null }>
    : []
  return {
    id: res.id,
    kind: 'chat',
    status: 'succeeded',
    assets,
    raw: {
      ...(res as any),
      text: typeof res.text === 'string' ? res.text : '',
    },
  }
}

async function fetchTaskResult(
  taskId: string,
  taskKind?: TaskKind,
  prompt?: string | null,
): Promise<TaskResultDto> {
  const res = await fetchPublicTaskResult({
    taskId: taskId.trim(),
    ...(taskKind ? { taskKind } : {}),
    ...(typeof prompt === 'string' ? { prompt } : {}),
  })
  return res.result
}

function extractTaskProgressPercent(snapshot: TaskResultDto): number | null {
  const raw = snapshot.raw as any
  const rawProgress =
    (typeof raw?.progress === 'number' ? raw.progress : null) ??
    (typeof raw?.response?.progress === 'number' ? raw.response.progress : null) ??
    (typeof raw?.response?.progress_pct === 'number' ? raw.response.progress_pct * 100 : null)
  if (typeof rawProgress !== 'number' || !Number.isFinite(rawProgress)) return null
  const pct = rawProgress <= 1 ? rawProgress * 100 : rawProgress
  return Math.max(0, Math.min(100, pct))
}

function extractTaskFailureMessage(snapshot: TaskResultDto): string {
  const raw = snapshot.raw as any
  return (
    (typeof raw?.failureReason === 'string' && raw.failureReason.trim()) ||
    (typeof raw?.response?.error === 'string' && raw.response.error.trim()) ||
    (typeof raw?.response?.message === 'string' && raw.response.message.trim()) ||
    (typeof raw?.error === 'string' && raw.error.trim()) ||
    (typeof raw?.message === 'string' && raw.message.trim()) ||
    '任务失败'
  )
}

function updateTaskPollingProgress(
  ctx: Pick<RunnerContext, 'id' | 'setNodeStatus'>,
  snapshot: TaskResultDto,
  options: {
    progressRange?: { min: number; max: number }
    statusPatch?: Record<string, any>
    lastProgress: number
  },
): number {
  const pct = extractTaskProgressPercent(snapshot)
  const progressMin = options.progressRange?.min
  const progressMax = options.progressRange?.max
  if (pct == null || typeof progressMin !== 'number' || typeof progressMax !== 'number') {
    return options.lastProgress
  }
  const mapped = progressMin + Math.round(((progressMax - progressMin) * pct) / 100)
  const normalized = Math.min(95, Math.max(options.lastProgress, Math.max(progressMin, mapped)))
  ctx.setNodeStatus(ctx.id, snapshot.status === 'queued' ? 'queued' : 'running', {
    ...(options.statusPatch || {}),
    progress: normalized,
  })
  return normalized
}

async function pollTaskResultUntilDone(
  ctx: RunnerContext,
  options: {
    taskId: string
    taskKind: TaskKind
    prompt: string
    vendor?: string
    progressRange?: { min: number; max: number }
    initialProgress?: number
    pollIntervalMs?: number
    pollTimeoutMs?: number
    statusPatch?: Record<string, any>
  },
): Promise<TaskResultDto> {
  const { id, setNodeStatus, appendLog, isCanceled } = ctx
  const pollIntervalMs = options.pollIntervalMs ?? 2500
  const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_TASK_POLL_TIMEOUT_MS
  const progressMin = options.progressRange?.min
  let lastProgress = typeof progressMin === 'number' ? progressMin : 10
  if (typeof options.initialProgress === 'number' && Number.isFinite(options.initialProgress)) {
    lastProgress = Math.max(lastProgress, Math.min(95, Math.round(options.initialProgress)))
  }
  const startedAt = Date.now()

  while (Date.now() - startedAt < pollTimeoutMs) {
    if (isCanceled(id)) throw new Error('任务已取消')

    let snapshot: TaskResultDto
    try {
      snapshot = await fetchTaskResult(options.taskId, options.taskKind, options.prompt)
    } catch (err: any) {
      const msg = err?.message || '查询任务进度失败'
      appendLog(id, `[${nowLabel()}] error: ${msg}`)
      await sleep(pollIntervalMs)
      continue
    }

    if (snapshot.status === 'queued' || snapshot.status === 'running') {
      lastProgress = updateTaskPollingProgress(
        { id, setNodeStatus },
        snapshot,
        {
          progressRange: options.progressRange,
          statusPatch: options.statusPatch,
          lastProgress,
        },
      )
      await sleep(pollIntervalMs)
      continue
    }

    if (snapshot.status === 'failed') {
      throw new Error(extractTaskFailureMessage(snapshot))
    }

    return snapshot
  }

  throw new Error('任务轮询超时，服务端任务可能仍在继续，请稍后在历史或资产中确认结果')
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function toAbsoluteHttpUrl(raw: string): string | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (typeof window === 'undefined') return null
  try {
    const u = new URL(trimmed, window.location.href)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString()
    return null
  } catch {
    return null
  }
}

async function fetchBlob(url: string, init?: RequestInit): Promise<Blob> {
  const resp = await fetch(url, init)
  if (!resp.ok) throw new Error(`下载失败（${resp.status}）`)
  return await resp.blob()
}

async function fetchImageBlob(url: string): Promise<Blob> {
  const trimmed = (url || '').trim()
  if (!trimmed) throw new Error('缺少图片 URL')
  return await fetchBlob(trimmed)
}

async function splitGridToBlobs(options: {
  url: string
  rows: number
  cols: number
  take: number
}): Promise<Blob[]> {
  const { url, rows, cols, take } = options
  const blob = await fetchImageBlob(url)
  const bitmap = await createImageBitmap(blob)
  const w = bitmap.width
  const h = bitmap.height
  if (!w || !h) {
    bitmap.close()
    throw new Error('图片尺寸异常')
  }

  const out: Blob[] = []
  const total = Math.max(0, Math.min(rows * cols, Math.floor(take)))
  for (let idx = 0; idx < total; idx++) {
    const r = Math.floor(idx / cols)
    const c = idx % cols
    const sx = Math.floor((w * c) / cols)
    const ex = Math.floor((w * (c + 1)) / cols)
    const sy = Math.floor((h * r) / rows)
    const ey = Math.floor((h * (r + 1)) / rows)
    const sw = Math.max(1, ex - sx)
    const sh = Math.max(1, ey - sy)

    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      throw new Error('Canvas 初始化失败')
    }
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
    // eslint-disable-next-line no-await-in-loop
    const part = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出图片失败'))), 'image/png')
    })
    out.push(part)
  }
  bitmap.close()
  return out
}

function extractFirstImageAssetUrl(res: any): string | null {
  const urls = extractImageUrlsFromTaskResult(res)
  return urls[0] || null
}

function findTaskAssetIdByUrl(result: TaskResultDto | null | undefined, url: string): string | null {
  const normalizedUrl = String(url || '').trim()
  if (!normalizedUrl) return null
  const assets = Array.isArray(result?.assets) ? result.assets : []
  for (const asset of assets) {
    if (String(asset?.url || '').trim() !== normalizedUrl) continue
    const assetId = typeof asset?.assetId === 'string' ? asset.assetId.trim() : ''
    if (assetId) return assetId
  }
  return null
}

function normalizePossibleImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^data:image\/[^;]+;base64,/i.test(trimmed)) return trimmed
  const compact = trimmed.replace(/\s+/g, '')
  const looksLikeBase64 =
    compact.length > 256 &&
    /^[A-Za-z0-9+/_-]+=*$/.test(compact) &&
    (
      compact.startsWith('/9j/') ||
      compact.startsWith('iVBORw0KGgo') ||
      compact.startsWith('R0lGOD') ||
      compact.startsWith('UklGR') ||
      compact.startsWith('Qk0')
    )
  if (!looksLikeBase64) return null
  const mime = compact.startsWith('/9j/')
    ? 'image/jpeg'
    : compact.startsWith('R0lGOD')
      ? 'image/gif'
      : compact.startsWith('UklGR')
        ? 'image/webp'
        : compact.startsWith('Qk0')
          ? 'image/bmp'
          : 'image/png'
  return `data:${mime};base64,${compact}`
}

function extractImageUrlsFromTaskResult(res: any): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: unknown) => {
    const u = normalizePossibleImageUrl(raw)
    if (!u || seen.has(u)) return
    seen.add(u)
    out.push(u)
  }
  const visit = (value: any) => {
    if (!value) return
    const arr = Array.isArray(value) ? value : [value]
    for (const item of arr) {
      if (!item) continue
      if (typeof item === 'string') {
        push(item)
        continue
      }
      if (typeof item !== 'object') continue
      push((item as any).url)
      push((item as any).imageUrl)
      push((item as any).image_url)
      push((item as any).resultUrl)
      push((item as any).result_url)
      push((item as any).b64_json)
      push((item as any).base64)
      push((item as any).image_base64)
    }
  }

  const assets = Array.isArray(res?.assets) ? res.assets : []
  visit(assets.filter((a: any) => String(a?.type || '').toLowerCase() === 'image'))
  const raw = (res as any)?.raw || {}
  const candidates = [
    raw?.data,
    raw?.results,
    raw?.images,
    raw?.imageUrls,
    raw?.output?.data,
    raw?.output?.results,
    raw?.output?.images,
    raw?.response?.data,
    raw?.response?.results,
    raw?.response?.images,
    raw?.response?.output?.data,
    raw?.response?.output?.results,
    raw?.response?.output?.images,
  ]
  candidates.forEach(visit)
  return out.slice(0, 8)
}

async function ensureHostedImageUrl(url: string, meta?: {
  prompt?: string
  vendor?: string
  modelKey?: string
  taskKind?: TaskKind
  fileName?: string
}): Promise<string> {
  const normalized = String(url || '').trim()
  if (!/^data:image\/[^;]+;base64,/i.test(normalized)) return normalized
  try {
    const resp = await fetch(normalized)
    if (!resp.ok) return normalized
    const blob = await resp.blob()
    const mime = blob.type || 'image/png'
    const ext = mime.includes('jpeg') || mime.includes('jpg')
      ? 'jpg'
      : mime.includes('webp')
        ? 'webp'
        : mime.includes('gif')
          ? 'gif'
          : 'png'
    const file = new File([blob], meta?.fileName || `task-image-${Date.now()}.${ext}`, { type: mime })
    const uploaded = await uploadServerAssetFile(file, file.name, {
      prompt: meta?.prompt,
      vendor: meta?.vendor,
      modelKey: meta?.modelKey,
      taskKind: meta?.taskKind,
    })
    const hosted = typeof (uploaded as any)?.data?.url === 'string' ? String((uploaded as any).data.url).trim() : ''
    return hosted || normalized
  } catch {
    return normalized
  }
}

function getRemixTargetIdFromNodeData(data?: any): string | null {
  if (!data) return null
  const kind = String(data.kind || '').toLowerCase()
  const isVideoKind = kind === 'video' || kind === 'composevideo'
  if (!isVideoKind) return null

  const sanitize = (val: any) => {
    if (typeof val !== 'string') return null
    const trimmed = val.trim()
    if (!trimmed) return null
    const lower = trimmed.toLowerCase()
    // 仅允许 postId / p/ 形态
    if (lower.startsWith('s_') || lower.startsWith('p/')) return trimmed
    return null
  }

  const videoResults = Array.isArray(data.videoResults) ? data.videoResults : []
  const primaryIndex =
    typeof data.videoPrimaryIndex === 'number' &&
    data.videoPrimaryIndex >= 0 &&
    data.videoPrimaryIndex < videoResults.length
      ? data.videoPrimaryIndex
      : videoResults.length > 0
        ? 0
        : -1
  const primaryResult = primaryIndex >= 0 ? videoResults[primaryIndex] : null

  const candidates = [
    sanitize(data.videoPostId),
    sanitize(primaryResult?.remixTargetId),
    sanitize(primaryResult?.pid),
    sanitize(primaryResult?.postId),
    sanitize(primaryResult?.post_id),
  ]

  return candidates.find(Boolean) || null
}

function collectReferenceImages(
  state: any,
  targetId: string,
): string[] {
  if (!state) return []
  const edges = Array.isArray(state.edges) ? (state.edges as Edge[]) : []
  const nodes = Array.isArray(state.nodes) ? (state.nodes as Node[]) : []
  const orderedItems = collectOrderedUpstreamReferenceItems(nodes, edges, targetId)
  if (orderedItems.length === 0) return []

  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  const collected: string[] = []
  for (const item of orderedItems) {
    if (item.sourceKind === 'video') {
      collected.push(item.previewUrl)
      continue
    }
    const sourceNode = nodeById.get(item.sourceNodeId)
    const primary = pickPrimaryImageFromNode(sourceNode)
    if (primary) collected.push(primary)
  }

  const mostRecentImageItem = orderedItems.find((item) => item.sourceKind === 'image' || item.sourceKind === 'imageEdit')
  const mostRecentImageNode = mostRecentImageItem ? nodeById.get(mostRecentImageItem.sourceNodeId) : null
  collectPoseReferenceUrlsFromNode(mostRecentImageNode).forEach((url) => collected.push(url))

  return Array.from(new Set(collected)).filter((url) => isRemoteUrl(url))
}

function collectDynamicUpstreamReferenceEntries(
  state: unknown,
  targetId: string,
): Array<{ url: string; label: string; assetId?: string | null; name?: string | null }> {
  if (!state || typeof state !== 'object') return []
  const record = state as { edges?: unknown; nodes?: unknown }
  const edges = Array.isArray(record.edges) ? (record.edges as Edge[]) : []
  const nodes = Array.isArray(record.nodes) ? (record.nodes as Node[]) : []
  const orderedItems = collectOrderedUpstreamReferenceItems(nodes, edges, targetId)
  if (!orderedItems.length) return []

  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  const out: Array<{ url: string; label: string; assetId?: string | null; name?: string | null }> = []
  const seen = new Set<string>()
  for (const item of orderedItems) {
    if (seen.has(item.previewUrl)) continue
    seen.add(item.previewUrl)
    if (item.sourceKind === 'video') {
      out.push({
        url: item.previewUrl,
        label: buildAssetRefId({
          name: item.label,
          fallbackPrefix: 'ref',
          index: out.length,
        }),
        name: item.label,
      })
      continue
    }
    const meta = extractNodePrimaryAssetReference(nodeById.get(item.sourceNodeId))
    if (meta) {
      out.push({
        url: meta.url,
        label: meta.assetRefId,
        ...(meta.assetId ? { assetId: meta.assetId } : null),
        name: meta.displayName,
      })
      continue
    }
    out.push({
      url: item.previewUrl,
      label: buildAssetRefId({
        name: item.label,
        fallbackPrefix: 'ref',
        index: out.length,
      }),
      name: item.label,
    })
  }
  return out
}

type RoleReferenceEntry = import('./assetReference').NamedReferenceEntry

function normalizeRoleReferenceEntries(value: any): RoleReferenceEntry[] {
  if (!Array.isArray(value)) return []
  const out: RoleReferenceEntry[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const name = String((item as any)?.name || (item as any)?.label || '').trim()
    const url = String((item as any)?.url || '').trim()
    if (!name || !url || seen.has(url)) continue
    seen.add(url)
    out.push({ label: buildAssetRefId({ name, fallbackPrefix: 'role', index: out.length }), url })
    if (out.length >= 10) break
  }
  return out
}

function normalizeImageResultItems(value: unknown): AssetResultItem[] {
  if (!Array.isArray(value)) return []
  const out: AssetResultItem[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (!url) continue
    out.push(
      buildImageAssetResultItem({
        url,
        title: typeof record.title === 'string' ? record.title.trim() : null,
        assetId: typeof record.assetId === 'string' ? record.assetId.trim() : null,
        assetName: typeof record.assetName === 'string' ? record.assetName.trim() : null,
        assetRefId: typeof record.assetRefId === 'string' ? record.assetRefId.trim() : null,
      }),
    )
    if (out.length >= 512) break
  }
  return out
}


function buildRunnerContext(id: string, get: Getter): RunnerContext | null {
  const state = get()
  const nodes = (state.nodes || []) as Node[]
  const node = nodes.find((n: Node) => n.id === id)
  if (!node) return null

  const data: any = node.data || {}
  const kind: string = data.kind || 'task'
  const taskKind = resolveTaskKind(kind)
  const prompt = buildPromptFromState(kind, data, state, id)
  const { sampleCount, supportsSamples, isImageTask, isVideoTask } =
    computeSampleMeta(kind, data)
  const handlers: RunnerHandlers = {
    setNodeStatus: state.setNodeStatus as RunnerHandlers['setNodeStatus'],
    appendLog: state.appendLog as RunnerHandlers['appendLog'],
    beginToken: state.beginRunToken as RunnerHandlers['beginToken'],
    endRunToken: state.endRunToken as RunnerHandlers['endRunToken'],
    isCanceled: state.isCanceled as RunnerHandlers['isCanceled'],
  }

  const textModelKey =
    (data.geminiModel as string | undefined) ||
    (data.modelKey as string | undefined)
  const imageModelKey = data.imageModel as string | undefined
  const videoModelKey = data.videoModel as string | undefined
  const modelKey = (
    IMAGE_NODE_KINDS.has(kind)
      ? imageModelKey
      : VIDEO_RENDER_NODE_KINDS.has(kind)
        ? videoModelKey
        : textModelKey
  ) || undefined

  return {
    id,
    state,
    data,
    kind,
    taskKind,
    prompt,
    sampleCount,
    supportsSamples,
    isImageTask,
    isVideoTask,
    modelKey,
    getState: get,
    ...handlers,
  }
}

function patchNodeImagePromptExecutionConfig(
  set: Setter,
  id: string,
  patch: {
    prompt?: string
    structuredPrompt?: unknown
    promptEditorMode?: 'structured'
  },
): void {
  set((state: { nodes?: Node[] }) => {
    const nodes = Array.isArray(state.nodes) ? state.nodes : []
    let changed = false
    const nextNodes = nodes.map((node) => {
      if (node.id !== id) return node
      const currentData =
        typeof node.data === 'object' && node.data !== null
          ? node.data as Record<string, unknown>
          : {}
      const nextPatch: Record<string, unknown> = {}

      if (typeof patch.prompt === 'string') {
        const currentPrompt =
          typeof currentData.prompt === 'string'
            ? currentData.prompt.trim()
            : ''
        if (currentPrompt !== patch.prompt) {
          nextPatch.prompt = patch.prompt
        }
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'structuredPrompt')) {
        const currentSpecJson = JSON.stringify(currentData.structuredPrompt ?? null)
        const nextSpecJson = JSON.stringify(patch.structuredPrompt ?? null)
        if (currentSpecJson !== nextSpecJson) {
          nextPatch.structuredPrompt = patch.structuredPrompt
        }
      }

      if (patch.promptEditorMode === 'structured' && currentData.promptEditorMode !== 'structured') {
        nextPatch.promptEditorMode = 'structured'
      }

      if (Object.keys(nextPatch).length === 0) return node
      changed = true
      return {
        ...node,
        data: {
          ...currentData,
          ...nextPatch,
        },
      }
    })

    return changed ? { nodes: nextNodes } : {}
  })
}

function reconcileRunnerImagePromptExecutionConfig(id: string, get: Getter, set: Setter): void {
  const state = get()
  const nodes = Array.isArray(state.nodes) ? state.nodes : []
  const node = nodes.find((candidate: Node) => candidate.id === id)
  if (!node) return

  const data =
    typeof node.data === 'object' && node.data !== null
      ? node.data as Record<string, unknown>
      : null
  if (!data) return

  const kind = typeof data.kind === 'string' ? data.kind.trim() : ''
  if (!IMAGE_NODE_KINDS.has(kind)) return

  const hasStructuredPromptSource =
    Object.prototype.hasOwnProperty.call(data, 'structuredPrompt') ||
    Object.prototype.hasOwnProperty.call(data, 'imagePromptSpecV2') ||
    Object.prototype.hasOwnProperty.call(data, 'imagePromptSpec') ||
    Object.prototype.hasOwnProperty.call(data, 'promptSpec')
  if (!hasStructuredPromptSource) return

  const resolved = resolveImagePromptExecution(data)
  const patch: {
    prompt?: string
    structuredPrompt?: unknown
    promptEditorMode?: 'structured'
  } = {}

  if (resolved.prompt) patch.prompt = resolved.prompt
  if (resolved.structuredPrompt) patch.structuredPrompt = resolved.structuredPrompt
  if (resolved.mode === 'structured') patch.promptEditorMode = 'structured'
  if (Object.keys(patch).length === 0) return

  patchNodeImagePromptExecutionConfig(set, id, patch)
  if (resolved.normalizedFromLegacy) {
    state.appendLog?.(id, `[${nowLabel()}] 已将旧版结构化图片提示词归一化到 structuredPrompt`)
  }
}

function patchNodeExecutionModel(
  set: Setter,
  id: string,
  patch: {
    imageModel: string
    imageModelVendor: string | null
  },
): void {
  set((state: { nodes?: Node[] }) => {
    const nodes = Array.isArray(state.nodes) ? state.nodes : []
    let changed = false
    const nextNodes = nodes.map((node) => {
      if (node.id !== id) return node
      const currentData =
        typeof node.data === 'object' && node.data !== null
          ? node.data as Record<string, unknown>
          : {}
      const currentModel =
        typeof currentData.imageModel === 'string'
          ? currentData.imageModel.trim()
          : ''
      const currentVendor =
        typeof currentData.imageModelVendor === 'string'
          ? currentData.imageModelVendor.trim()
          : ''
      const nextVendor = patch.imageModelVendor ? patch.imageModelVendor.trim() : ''
      if (currentModel === patch.imageModel && currentVendor === nextVendor) {
        return node
      }
      changed = true
      return {
        ...node,
        data: {
          ...currentData,
          imageModel: patch.imageModel,
          imageModelVendor: patch.imageModelVendor,
        },
      }
    })
    return changed ? { nodes: nextNodes } : {}
  })
}

async function resolveRunnerImageModelBeforeExecution(ctx: RunnerContext, set: Setter): Promise<void> {
  if (!ctx.isImageTask) return
  const requestedModel =
    typeof ctx.data.imageModel === 'string'
      ? ctx.data.imageModel.trim()
      : ''
  const resolution = await resolveExecutableImageModel({
    kind: ctx.kind === 'imageEdit' ? 'imageEdit' : 'image',
    value: typeof ctx.data.imageModel === 'string' ? ctx.data.imageModel : undefined,
    allowBackendDefault: true,
  })
  if (resolution.shouldWriteBack) {
    patchNodeExecutionModel(set, ctx.id, {
      imageModel: resolution.value,
      imageModelVendor: null,
    })
  }
  ctx.data = {
    ...ctx.data,
    imageModel: resolution.value,
    imageModelVendor: null,
  }
  ctx.modelKey = resolution.value
  if (resolution.reason === 'unavailable') {
    const fallbackDesc =
      resolution.source === 'firstAvailable'
        ? `当前默认模型也不可用，已切到首个可用模型 ${resolution.value}`
        : `已回退到默认模型 ${resolution.value}`
    ctx.appendLog(ctx.id, `[${nowLabel()}] 当前图片模型 ${requestedModel || '(empty)'} 不在可用列表，${fallbackDesc}`)
  } else if (resolution.reason === 'missing') {
    ctx.appendLog(ctx.id, `[${nowLabel()}] 图片节点未配置模型，已补全为 ${resolution.value}`)
  } else if (resolution.reason === 'catalogUnavailable') {
    ctx.appendLog(ctx.id, `[${nowLabel()}] 系统模型目录未返回可用 image 模型，改由后端固定图片路由执行 ${resolution.value}`)
  } else if (resolution.reason === 'canonicalized' && requestedModel !== resolution.value) {
    ctx.appendLog(ctx.id, `[${nowLabel()}] 图片模型 ${requestedModel} 已规范化为 ${resolution.value}`)
  }
}

function resolveTaskKind(kind: string): TaskKind {
  if (IMAGE_NODE_KINDS.has(kind)) return 'text_to_image'
  if (isVideoRenderKind(kind)) return 'image_to_video'
  return 'prompt_refine'
}

type PromptBucketItem = { text: string; fromImage: boolean }

function collectImageSourcePrompts(input: {
  sd: any
  skind: string
  targetIsVideoRender: boolean
  upstreamPromptItems: PromptBucketItem[]
}): string[] {
  const { sd } = input
  const promptCandidates: string[] = []
  if (typeof sd.prompt === 'string') {
    promptCandidates.push(sd.prompt)
  }
  return promptCandidates
}

function collectVideoSourcePrompts(sd: any): string[] {
  const promptCandidates: string[] = []
  if (typeof sd.prompt === 'string') promptCandidates.push(sd.prompt)
  return promptCandidates
}

function collectTextSourcePrompts(sd: any): string[] {
  const promptCandidates: string[] = []
  if (typeof sd.prompt === 'string') promptCandidates.push(sd.prompt)
  if (typeof sd.text === 'string') promptCandidates.push(sd.text)
  if (Array.isArray(sd.textResults) && sd.textResults.length) {
    const latest = sd.textResults[sd.textResults.length - 1] as { text?: string } | undefined
    if (typeof latest?.text === 'string') promptCandidates.push(latest.text)
  }
  return promptCandidates
}

function appendNormalizedPromptCandidates(input: {
  sourceIsImage: boolean
  promptCandidates: string[]
  upstreamPromptItems: PromptBucketItem[]
}) {
  input.promptCandidates
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .forEach((p) => {
      input.upstreamPromptItems.push({ text: p, fromImage: input.sourceIsImage })
    })
}

function collectInboundSourcePrompts(input: {
  kind: string
  skind: string
  sd: any
  upstreamPromptItems: PromptBucketItem[]
}): string[] {
  const targetIsVideoRender = VIDEO_RENDER_NODE_KINDS.has(input.kind)
  if (IMAGE_NODE_KINDS.has(input.skind)) {
    return collectImageSourcePrompts({
      sd: input.sd,
      skind: input.skind,
      targetIsVideoRender,
      upstreamPromptItems: input.upstreamPromptItems,
    })
  }
  if (VIDEO_RENDER_NODE_KINDS.has(input.skind)) {
    return collectVideoSourcePrompts(input.sd)
  }
  if (input.skind === 'text') {
    return collectTextSourcePrompts(input.sd)
  }
  return []
}

function buildPromptFromState(
  kind: string,
  data: any,
  state: any,
  id: string,
): string {
  const ownPrompt = IMAGE_NODE_KINDS.has(kind)
    ? resolveCompiledImagePrompt(data)
    : typeof data.prompt === 'string'
      ? data.prompt
      : ''
  if (isVideoRenderKind(kind)) {
    const edges = (state.edges || []) as Edge[]
    const inbound = edges.filter((edge) => edge.target === id)
    const upstreamPromptItems: PromptBucketItem[] = []

    if (inbound.length) {
      inbound.forEach((edge) => {
        const sourceNode = (state.nodes as Node[]).find((node: Node) => node.id === edge.source)
        if (!sourceNode) return
        const sourceData = sourceNode.data || {}
        const sourceKind: string | undefined = (sourceData as any).kind
        if (!sourceKind) return
        if (!shouldInheritInboundPromptForExecution({ targetKind: kind, sourceKind })) return
        const promptCandidates = collectInboundSourcePrompts({
          kind,
          skind: sourceKind,
          sd: sourceData,
          upstreamPromptItems,
        })
        appendNormalizedPromptCandidates({
          sourceIsImage: IMAGE_NODE_KINDS.has(sourceKind),
          promptCandidates,
          upstreamPromptItems,
        })
      })
    }

    const mergedPrompts = mergeExecutionPromptSequence({
      kind,
      ownPrompt: ownPrompt.trim(),
      upstreamPrompts: upstreamPromptItems.map((item) => item.text),
    })
    const seen = new Set<string>()
    const dedupedPrompts = mergedPrompts.filter((value) => {
      if (typeof value !== 'string') return false
      const normalized = value.trim()
      if (!normalized) return false
      const key = normalizeTextDedupKey(normalized)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    const mergedPrompt = dedupedPrompts.join('\n\n')
    const firstFrameUrl =
      (typeof data.firstFrameUrl === 'string' && data.firstFrameUrl.trim()) ||
      (typeof data.veoFirstFrameUrl === 'string' && data.veoFirstFrameUrl.trim()) ||
      ''
    return optimizePromptForVideo({
      prompt: mergedPrompt,
      firstFrameUrl,
    })
  }

  if (IMAGE_NODE_KINDS.has(kind)) {
    const edges = (state.edges || []) as any[]
    const inbound = edges.filter((e) => e.target === id)
    const upstreamPromptItems: PromptBucketItem[] = []
    const inboundHasImage = inbound.some((edge) => {
      const src = (state.nodes as Node[]).find((n: Node) => n.id === edge.source)
      const skind: string | undefined = (src?.data as any)?.kind
      return skind ? IMAGE_NODE_KINDS.has(skind) : false
    })
    if (inbound.length) {
      inbound.forEach((edge) => {
        const src = (state.nodes as Node[]).find((n: Node) => n.id === edge.source)
        if (!src) return
        const sd: any = src.data || {}
        const skind: string | undefined = sd.kind
        if (!skind) return
        const sourceIsImage = IMAGE_NODE_KINDS.has(skind)
        const sourceIsVideoRender = VIDEO_RENDER_NODE_KINDS.has(skind)
        if (sourceIsVideoRender) {
          // 当视频继续连接视频节点时，避免继承上游完整提示词以免重复堆叠
          return
        }
        const promptCandidates = collectInboundSourcePrompts({
          kind,
          skind,
          sd,
          upstreamPromptItems,
        })
        appendNormalizedPromptCandidates({
          sourceIsImage,
          promptCandidates,
          upstreamPromptItems,
        })
      })
    }
    const hasOwnPromptField = Object.prototype.hasOwnProperty.call(data, 'prompt')
    const own = hasOwnPromptField ? ownPrompt : ''
    const upstreamPrompts = inboundHasImage
      ? upstreamPromptItems.filter((it) => !it.fromImage).map((it) => it.text) // 参考图场景下：保留上游非图像提示词，避免混入图像节点的提示词
      : upstreamPromptItems.map((it) => it.text)
    const combinedBase = mergeExecutionPromptSequence({
      kind,
      ownPrompt: own,
      upstreamPrompts,
    })
    const dedupeKey = (value: string) =>
      String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .toLowerCase()
    const seen = new Set<string>()
    const combined = combinedBase.filter((p) => {
      if (typeof p !== 'string') return false
      const normalized = p.trim()
      if (!normalized) return false
      const key = dedupeKey(normalized)
      if (!key) return false
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const basePrompt = combined.length ? combined.join('\n') : ((data.label as string) || '')
    return appendImageViewPrompt(basePrompt, {
      cameraControl: (data as Record<string, unknown>)?.imageCameraControl,
      lightingRig: (data as Record<string, unknown>)?.imageLightingRig,
    })
  }

  return (data.prompt as string) || (data.label as string) || ''
}

function normalizeTextDedupKey(value: string): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .toLowerCase()
}

function optimizePromptForVideo(input: {
  prompt: string
  firstFrameUrl?: string
}): string {
  const raw = String(input.prompt || '').replace(/\r\n/g, '\n')
  if (!raw.trim()) return ''

  const removeLinePatterns = [
    /可裁切/i,
    /网格图/i,
    /4格|四宫格|9格|九宫格/i,
    /referenceImages/i,
    /说明：角色参考图/i,
    /当前镜头[:：]?$/i,
    /^\[[^\]]+\]$/,
  ]
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !removeLinePatterns.some((re) => re.test(line)))

  const dedupedLines: string[] = []
  const seenLine = new Set<string>()
  for (const line of lines) {
    const key = normalizeTextDedupKey(line)
    if (!key || seenLine.has(key)) continue
    seenLine.add(key)
    dedupedLines.push(line)
  }

  const chapterLine = dedupedLines.find((line) => /^章节[:：]/.test(line)) || ''
  const titleLine = dedupedLines.find((line) => /^标题[:：]/.test(line)) || ''
  const shotLines = dedupedLines.filter((line) => /^镜头\s*\d+\s*[:：]/.test(line))
  const styleGoalLine =
    input.firstFrameUrl
      ? '目标：使用图中画风，让视频自然运动起来；保持角色外观、服装、光线与美术风格连续，不切换写实/非写实体系。'
      : ''

  if (shotLines.length > 0) {
    const intro = [
      chapterLine,
      titleLine,
      styleGoalLine,
      '任务：将以下镜头生成一条连续视频，镜头间自然衔接，保持角色外观/服装/光线连续。',
      input.firstFrameUrl
        ? '已提供首帧图：必须从首帧构图起步，镜头1与首帧严格承接，再推进后续镜头。'
        : '',
      '要求：避免重复镜头文案，不要生成拼贴画面。',
    ].filter(Boolean)
    return [...intro, ...shotLines.slice(0, 12)].join('\n')
  }

  const collapsedBody = dedupedLines.join('\n')
  const collapsed = [styleGoalLine, collapsedBody].filter(Boolean).join('\n')
  return collapsed.length > 2200 ? collapsed.slice(0, 2200) : collapsed
}

function computeSampleMeta(kind: string, data: any) {
  const isImageTask = IMAGE_NODE_KINDS.has(kind)
  const isVideoTask = isVideoRenderKind(kind)
  const rawSampleCount = typeof data.sampleCount === 'number' ? data.sampleCount : 1
  const supportsSamples = isImageTask || isVideoTask
  const sampleCount = supportsSamples
    ? Math.max(1, Math.min(5, Math.floor(rawSampleCount || 1)))
    : 1

  return { sampleCount, supportsSamples, isImageTask, isVideoTask }
}

function ensurePrompt(ctx: RunnerContext): boolean {
  if (ctx.prompt.trim()) return true
  ctx.appendLog(ctx.id, `[${nowLabel()}] 缺少提示词，已终止`)
  ctx.setNodeStatus(ctx.id, 'error', {
    progress: 0,
    lastError: '缺少提示词',
    taskId: '',
    imageTaskId: '',
    videoTaskId: '',
  })
  return false
}

function beginQueuedRun(ctx: RunnerContext) {
  const rawSetNodeStatus = ctx.setNodeStatus
  const rawAppendLog = ctx.appendLog
  const rawIsCanceled = ctx.isCanceled

  const runToken = ctx.beginToken(ctx.id)

  ctx.setNodeStatus = (id, status, patch) => {
    if (!isRunTokenActive(ctx.getState, id, runToken)) return
    rawSetNodeStatus(id, status, patch)
  }
  ctx.appendLog = (id, line) => {
    if (!isRunTokenActive(ctx.getState, id, runToken)) return
    rawAppendLog(id, line)
  }
  ctx.isCanceled = (id) => rawIsCanceled(id, runToken)

  const priorStatus = typeof (ctx.data as any)?.status === 'string' ? String((ctx.data as any).status) : ''
  const shouldClearStaleTaskIds = priorStatus !== 'running' && priorStatus !== 'queued'
  ctx.setNodeStatus(ctx.id, 'queued', {
    progress: 0,
    ...(shouldClearStaleTaskIds ? { taskId: '', imageTaskId: '', videoTaskId: '' } : {}),
  })
  ctx.appendLog(
    ctx.id,
    `[${nowLabel()}] queued (AI, ${ctx.taskKind}${
      ctx.supportsSamples && ctx.sampleCount > 1 ? `, x${ctx.sampleCount}` : ''
    })`,
  )
}

export async function runNodeRemote(id: string, get: Getter, set: Setter) {
  let ctx: RunnerContext | null = null
  try {
    reconcileRunnerImagePromptExecutionConfig(id, get, set)
    ctx = buildRunnerContext(id, get)
  } catch (error: unknown) {
    const state = get()
    const message =
      error instanceof Error && error.message
        ? error.message
        : '执行前解析图片提示词失败'
    state.setNodeStatus?.(id, 'error', { progress: 0, lastError: message })
    state.appendLog?.(id, `[${nowLabel()}] error: ${message}`)
    if (!state.isCanceled?.(id)) {
      toast(message, 'error')
    }
    return
  }
  if (!ctx) return
  if (NON_EXECUTABLE_REMOTE_NODE_KINDS.has(ctx.kind)) return
  if (ctx.kind === 'webHero') {
    await runWebHeroNode(id, get, set)
    return
  }

  if (!ensurePrompt(ctx)) return

  try {
    await resolveRunnerImageModelBeforeExecution(ctx, set)
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : '执行前解析图片模型失败'
    ctx.setNodeStatus(ctx.id, 'error', { progress: 0, lastError: message })
    ctx.appendLog(ctx.id, `[${nowLabel()}] error: ${message}`)
    if (!ctx.isCanceled(ctx.id)) {
      toast(message, 'error')
    }
    return
  }

  beginQueuedRun(ctx)

  if (ctx.isVideoTask) {
    await runVideoTask(ctx)
    return
  }

  await runGenericTask(ctx)
}

function pickNonEmptyText(value: any): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getFirstTaskResult(rawResponse: any): any {
  if (Array.isArray(rawResponse?.results) && rawResponse.results.length) return rawResponse.results[0]
  if (Array.isArray(rawResponse?.data?.results) && rawResponse.data.results.length) return rawResponse.data.results[0]
  return null
}

function extractVideoUrlFromRawResponse(rawResponse: any): string | null {
  const fromVideoUrlField = rawResponse?.video_url
  const fromVideoUrl =
    pickNonEmptyText(fromVideoUrlField?.url) ||
    pickNonEmptyText(fromVideoUrlField) ||
    pickNonEmptyText(rawResponse?.videoUrl?.url) ||
    pickNonEmptyText(rawResponse?.videoUrl) ||
    null
  if (fromVideoUrl) return fromVideoUrl
  const firstResult = getFirstTaskResult(rawResponse)
  const fromResult =
    pickNonEmptyText(firstResult?.url) ||
    pickNonEmptyText(firstResult?.video_url) ||
    pickNonEmptyText(firstResult?.videoUrl) ||
    null
  if (fromResult) return fromResult
  const content = pickNonEmptyText(rawResponse?.content)
  if (!content) return null
  const match = content.match(/<video[^>]+src=['"]([^'"]+)['"][^>]*>/i)
  return match && match[1] && match[1].trim() ? match[1].trim() : null
}

function extractVideoThumbnailFromRawResponse(rawResponse: any): string | null {
  const fromRoot = pickNonEmptyText(rawResponse?.thumbnail_url) || pickNonEmptyText(rawResponse?.thumbnailUrl)
  if (fromRoot) return fromRoot
  const firstResult = getFirstTaskResult(rawResponse)
  return pickNonEmptyText(firstResult?.thumbnailUrl) || pickNonEmptyText(firstResult?.thumbnail_url) || null
}

function extractVideoAssetFromRawResponse(rawResponse: any): { url: string; thumbnailUrl: string | null } | null {
  if (!rawResponse) return null
  const url = extractVideoUrlFromRawResponse(rawResponse)
  if (!url) return null
  return {
    url,
    thumbnailUrl: extractVideoThumbnailFromRawResponse(rawResponse),
  }
}

function parseInitialProgress(rawData: any): number {
  const raw = typeof rawData?.progress === 'number' && Number.isFinite(rawData.progress) ? rawData.progress : 10
  return Math.max(5, Math.min(95, Math.round(raw)))
}

type GenericVideoTaskOptions = {
  prompt: string
  model: string
  aspectRatio: string
  orientation: Orientation
  size?: string | null
  resolution?: string | null
  specKey?: string | null
  generateAudio: boolean
  returnLastFrame: boolean
  referenceImages: string[]
  durationSeconds: number
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  uploadedReferenceAssets?: PreparedVideoReferenceAsset[]
  uploadedFirstFrameAsset?: PreparedVideoReferenceAsset | null
  uploadedLastFrameAsset?: PreparedVideoReferenceAsset | null
  referenceSheet?: UploadedReferenceSheet | null
}

type PreparedVideoTaskInput = {
  videoModelValue: string
  finalPrompt: string
  videoDurationSeconds: number
  orientation: Orientation
  aspectRatioSetting: string
  videoSize: string
  videoResolution: string
  videoSpecKey: string
  referenceImagesForVideo: string[]
  generateAudio: boolean
  returnLastFrame: boolean
  effectiveFirstFrameUrl: string
  lastFrameUrlValue: string
  autoReferenceImages: string[]
  uploadedReferenceAssets: PreparedVideoReferenceAsset[]
  uploadedFirstFrameAsset: PreparedVideoReferenceAsset | null
  uploadedLastFrameAsset: PreparedVideoReferenceAsset | null
  referenceSheet: UploadedReferenceSheet | null
  remixTargetId: string | null
}

function readFirstTrimmedString(source: unknown, keys: readonly string[]): string {
  if (!source || typeof source !== 'object') return ''
  const record = source as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function readNodeVideoModel(data: unknown): string {
  return readFirstTrimmedString(data, ['videoModel', 'modelAlias', 'modelKey'])
}

function assertVideoModelConfigured(model: string): void {
  if (!model) {
    throw new Error('视频模型未配置：请先在「系统管理 → 模型管理（Model Catalog）→ 模型（video）」启用至少 1 个视频模型，并在节点中选择。')
  }
}

function readBooleanFlag(
  dataRecord: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  fallback: boolean,
): boolean {
  for (const key of keys) {
    const value = dataRecord[key]
    if (typeof value === 'boolean') return value
  }
  return fallback
}

function resolveVideoDurationSeconds(input: {
  data: unknown
  videoModelValue?: string
}): number {
  const dataRecord =
    input.data && typeof input.data === 'object'
      ? (input.data as Record<string, unknown>)
      : {}
  const normalized = readVideoDurationSeconds(dataRecord, 5)
  const specDuration =
    parseVideoDurationFromSpecKey(dataRecord.videoSpecKey) ??
    parseVideoDurationFromSpecKey(dataRecord.specKey)
  const resolved = specDuration ?? normalized
  return resolved > 0 ? resolved : 5
}

async function prepareVideoTaskInput(ctx: RunnerContext): Promise<PreparedVideoTaskInput> {
  const { id, data, state, prompt, appendLog } = ctx
  const orientation: Orientation = normalizeOrientation((data as any)?.orientation)
  const aspectRatioSetting =
    typeof (data as any)?.aspect === 'string' && (data as any).aspect.trim() ? (data as any).aspect.trim() : '16:9'
  const videoModelValue = readNodeVideoModel(data)
  assertVideoModelConfigured(videoModelValue)
  const videoDurationSeconds = resolveVideoDurationSeconds({
    data,
    videoModelValue,
  })
  const videoSize =
    typeof (data as any)?.videoSize === 'string' ? String((data as any).videoSize).trim().replace(/\s+/g, '') : ''
  const videoResolution = normalizeVideoResolution(
    (data as Record<string, unknown>)?.videoResolution ?? (data as Record<string, unknown>)?.resolution,
  )
  const dataRecord = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const generateAudio = readBooleanFlag(dataRecord, ['generateAudio', 'generate_audio'], false)
  const returnLastFrame = readBooleanFlag(dataRecord, ['returnLastFrame', 'return_last_frame'], false)
  const videoSpecKey =
    typeof (data as any)?.videoSpecKey === 'string' && String((data as any).videoSpecKey).trim()
      ? String((data as any).videoSpecKey).trim()
      : buildVideoSpecKey(videoResolution, videoDurationSeconds)
  const finalPrompt = String(prompt || '').trim()
  const collectedReferenceImages = Array.from(
    new Set([
      ...collectNodeReferenceImageUrls(data, 8),
      ...collectReferenceImages(state, id)
        .map((u) => String(u || '').trim())
        .filter(Boolean),
    ]),
  ).slice(0, 8)
  const nodes = Array.isArray((state as { nodes?: unknown }).nodes)
    ? ((state as { nodes?: unknown }).nodes as Node[])
    : []
  const mentionAssetRefs = await resolveAssetImagesByMentions({
    prompt: finalPrompt,
    nodes,
  }).catch(() => ({ urls: [] as string[], matched: [] as string[], missing: [] as string[], ambiguous: [] as string[] }))
  if (mentionAssetRefs.matched.length) {
    appendLog(id, `[${nowLabel()}] 检测到资产引用：${mentionAssetRefs.matched.join('、')}，已自动注入参考资产`)
  }
  if (mentionAssetRefs.missing.length) {
    appendLog(id, `[${nowLabel()}] 未找到资产引用：${mentionAssetRefs.missing.join('、')}`)
  }
  if (mentionAssetRefs.ambiguous.length) {
    appendLog(id, `[${nowLabel()}] 资产引用存在同名冲突：${mentionAssetRefs.ambiguous.join('、')}，请保证引用ID唯一`)
  }
  let autoReferenceImages = Array.from(new Set([...collectedReferenceImages, ...mentionAssetRefs.urls])).slice(0, 8)
  let uploadedReferenceAssets: PreparedVideoReferenceAsset[] = []
  let uploadedFirstFrameAsset: PreparedVideoReferenceAsset | null = null
  let uploadedLastFrameAsset: PreparedVideoReferenceAsset | null = null
  let referenceSheet: UploadedReferenceSheet | null = null

  if (autoReferenceImages.length) {
    appendLog(id, `[${nowLabel()}] 已收集参考图 ${autoReferenceImages.length} 张`)
  }
  return {
    videoModelValue,
    finalPrompt,
    videoDurationSeconds,
    orientation,
    aspectRatioSetting,
    videoSize,
    videoResolution,
    videoSpecKey,
    referenceImagesForVideo: uploadedReferenceAssets.length > 0 ? [] : autoReferenceImages,
    generateAudio,
    returnLastFrame,
    effectiveFirstFrameUrl: '',
    lastFrameUrlValue: '',
    autoReferenceImages,
    uploadedReferenceAssets,
    uploadedFirstFrameAsset,
    uploadedLastFrameAsset,
    referenceSheet,
    remixTargetId: null,
  }
}

function normalizeVideoVendor(value: string | undefined | null): string {
  return String(value || '').trim().toLowerCase()
}

function resolveActiveVideoTaskIdByVendor(data: any, vendor?: string | null): string | null {
  const status = (data as any)?.status as NodeStatusValue | undefined
  if (status !== 'running' && status !== 'queued') return null
  if (vendor && normalizeVideoVendor((data as any)?.videoModelVendor) !== normalizeVideoVendor(vendor)) return null
  const taskId = String((data as any)?.videoTaskId || '').trim()
  return taskId || null
}

function isTaskRunningSnapshot(snapshot: TaskResultDto): boolean {
  return snapshot.status === 'running' || snapshot.status === 'queued'
}

function resolveGenericVideoFailureMessage(snapshot: TaskResultDto, vendor: string): string {
  const fallbackVendor = vendor.trim() || '视频'
  return (
    (typeof (snapshot.raw as any)?.failureReason === 'string' && (snapshot.raw as any).failureReason.trim()) ||
    (typeof (snapshot.raw as any)?.response?.error === 'string' && (snapshot.raw as any).response.error.trim()) ||
    (typeof (snapshot.raw as any)?.response?.message === 'string' && (snapshot.raw as any).response.message.trim()) ||
    (typeof (snapshot.raw as any)?.error === 'string' && (snapshot.raw as any).error.trim()) ||
    (typeof (snapshot.raw as any)?.message === 'string' && (snapshot.raw as any).message.trim()) ||
    `${fallbackVendor} 视频任务失败`
  )
}

function resolveGenericVideoAsset(snapshot: TaskResultDto): {
  url: string
  thumbnailUrl: string | null
  assetId: string | null
} | null {
  const primaryAsset = (snapshot.assets || []).find((asset) => asset.type === 'video' && asset.url) || (snapshot.assets || []).find((asset) => asset.url)
  if (primaryAsset?.url) {
    return {
      url: primaryAsset.url,
      thumbnailUrl: primaryAsset.thumbnailUrl || null,
      assetId: typeof primaryAsset.assetId === 'string' && primaryAsset.assetId.trim() ? primaryAsset.assetId.trim() : null,
    }
  }
  const extracted = extractVideoAssetFromRawResponse((snapshot.raw as any)?.response || snapshot.raw)
  return extracted
    ? {
        url: extracted.url,
        thumbnailUrl: extracted.thumbnailUrl,
        assetId: null,
      }
    : null
}

async function finalizeGenericVideoSuccess(input: {
  snapshot: TaskResultDto
  taskId: string
  ctx: RunnerContext
  prompt: string
  durationSeconds: number
  modelKey?: string | null
}) {
  const { snapshot, taskId, ctx, prompt, durationSeconds, modelKey } = input
  const { id, data, kind, setNodeStatus, appendLog, isCanceled } = ctx
  const resolvedAsset = resolveGenericVideoAsset(snapshot)
  if (!resolvedAsset?.url) {
    const msg = '视频任务执行失败：未返回有效视频地址'
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
    return
  }
  const existingResults = ((data as any)?.videoResults as Array<Record<string, unknown>> | undefined) || []
  const updatedVideoResults = [
    ...existingResults,
    {
      id: snapshot.id || taskId,
      ...buildVideoAssetResultItem({
        url: resolvedAsset.url,
        thumbnailUrl: resolvedAsset.thumbnailUrl,
        title: (data as any)?.videoTitle || null,
        duration: durationSeconds,
        assetId: resolvedAsset.assetId,
      }),
      ...(modelKey ? { model: modelKey } : null),
      remixTargetId: null,
    },
  ]
  setNodeStatus(id, 'success', {
    progress: 100,
    lastResult: {
      id: snapshot.id || taskId,
      at: Date.now(),
      kind,
      preview: { type: 'video', src: resolvedAsset.url },
    },
    prompt,
    videoUrl: resolvedAsset.url,
    videoThumbnailUrl: resolvedAsset.thumbnailUrl || (data as any)?.videoThumbnailUrl || null,
    videoResults: updatedVideoResults,
    videoPrimaryIndex: updatedVideoResults.length - 1,
    ...buildVideoDurationPatch(durationSeconds),
    ...(modelKey ? { videoModel: modelKey } : null),
    videoModelVendor: null,
    videoTaskId: taskId,
  })
  appendLog(id, `[${nowLabel()}] 视频生成完成。`)
  try {
    const semanticResult = await persistSemanticAssetMetadata({
      nodeId: id,
      nodeKind: kind,
      nodeData: {
        ...(data as Record<string, unknown>),
        prompt,
        videoUrl: resolvedAsset.url,
        videoThumbnailUrl: resolvedAsset.thumbnailUrl || (data as any)?.videoThumbnailUrl || null,
        ...buildVideoDurationPatch(durationSeconds),
        ...(modelKey ? { videoModel: modelKey } : null),
        videoModelVendor: null,
        videoTaskId: taskId,
      },
      mediaKind: 'video',
      videoUrl: resolvedAsset.url,
      thumbnailUrl: resolvedAsset.thumbnailUrl || undefined,
      prompt,
    })
    if (semanticResult?.metadataSynced && semanticResult.sourceBookId) {
      appendLog(
        id,
        `[${nowLabel()}] 视频语义资产已同步到章节元数据（book=${semanticResult.sourceBookId}, semantic=${semanticResult.semanticId}）`,
      )
    } else if (semanticResult) {
      appendLog(
        id,
        `[${nowLabel()}] 视频语义资产未写入书籍 semanticAssets（bookScope=${semanticResult.bookScopeStatus}）`,
      )
    }
  } catch (error: unknown) {
    const message = error instanceof Error && error.message ? error.message : '视频语义资产回填失败'
    appendLog(id, `[${nowLabel()}] ${message}`)
    if (!isCanceled(id)) {
      toast(message, 'warning')
    }
  }
  if (snapshot.assets && snapshot.assets.length && !isCanceled(id)) notifyAssetRefresh()
}

function buildVeoTaskExtras(input: {
  kind: string
  id: string
  model: string
  aspectRatio: string
  size?: string | null
  resolution?: string | null
  specKey?: string | null
  generateAudio: boolean
  returnLastFrame: boolean
  referenceImages: string[]
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  uploadedReferenceAssets?: PreparedVideoReferenceAsset[]
  uploadedFirstFrameAsset?: PreparedVideoReferenceAsset | null
  uploadedLastFrameAsset?: PreparedVideoReferenceAsset | null
  referenceSheet?: UploadedReferenceSheet | null
}): Record<string, unknown> {
  const extras: Record<string, unknown> = {
    nodeKind: input.kind,
    nodeId: input.id,
    modelAlias: input.model,
    aspectRatio: input.aspectRatio,
    awaitResult: false,
    generateAudio: input.generateAudio,
    generate_audio: input.generateAudio,
  }
  if (input.returnLastFrame) {
    extras.returnLastFrame = true
    extras.return_last_frame = true
  }
  if (input.size && input.size.trim()) {
    extras.size = input.size.trim()
  }
  if (input.resolution && input.resolution.trim()) {
    extras.resolution = input.resolution.trim()
  }
  if (input.specKey && input.specKey.trim()) {
    extras.specKey = input.specKey.trim()
    extras.videoSpecKey = input.specKey.trim()
  }
  const referenceSheetMeta = buildReferenceSheetLogMeta(input.referenceSheet)
  if (referenceSheetMeta) {
    extras.referenceSheet = referenceSheetMeta
  }
  if (input.uploadedReferenceAssets?.length) {
    extras.referenceAssetIds = input.uploadedReferenceAssets.map((item) => item.assetId)
    extras.assetInputs = input.uploadedReferenceAssets.map((item) => ({
      assetId: item.assetId,
      role: item.role,
    }))
  } else if (input.referenceImages.length) {
    extras.referenceImages = input.referenceImages
  }
  return extras
}

function resolvePendingTaskIdFromResult(res: TaskResultDto): string | null {
  const pendingTaskIdRaw = (res.raw && ((res.raw as any).taskId as string | undefined)) || res.id || null
  const pendingTaskId =
    typeof pendingTaskIdRaw === 'string' ? pendingTaskIdRaw.trim() : String(pendingTaskIdRaw || '').trim() || null
  return pendingTaskId
}

function trySilentSaveProject() {
  if (typeof window !== 'undefined' && typeof (window as any).silentSaveProject === 'function') {
    try {
      ;(window as any).silentSaveProject()
    } catch {
      // ignore save errors here
    }
  }
}

async function pollGenericVideoResultClient(ctx: RunnerContext, options: {
  taskId: string
  prompt: string
  model: string
  durationSeconds: number
}) {
  const { id, data, setNodeStatus, appendLog, isCanceled } = ctx
  const pollIntervalMs = 3000
  const pollTimeoutMs = 600_000
  const startedAt = Date.now()
  let lastProgress = typeof (data as any)?.progress === 'number' ? (data as any).progress : 10

  while (Date.now() - startedAt < pollTimeoutMs) {
    if (isCanceled(id)) {
      setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
      appendLog(id, `[${nowLabel()}] 已取消视频任务`)
      return
    }

    let snapshot: TaskResultDto
    try {
      snapshot = await fetchTaskResult(options.taskId, 'image_to_video', options.prompt)
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : '查询视频任务进度失败'
      appendLog(id, `[${nowLabel()}] error: ${message}`)
      await sleep(pollIntervalMs)
      continue
    }

    if (isTaskRunningSnapshot(snapshot)) {
      lastProgress = updateTaskPollingProgress(ctx, snapshot, {
        lastProgress,
        progressRange: { min: 10, max: 95 },
        statusPatch: {
          videoTaskId: options.taskId,
          videoModel: options.model,
          videoModelVendor: null,
        },
      })
      await sleep(pollIntervalMs)
      continue
    }

    if (snapshot.status === 'failed') {
      const msg = resolveGenericVideoFailureMessage(snapshot, '视频')
      setNodeStatus(id, 'error', { progress: 0, lastError: msg })
      appendLog(id, `[${nowLabel()}] error: ${msg}`)
      return
    }

    await finalizeGenericVideoSuccess({
      snapshot,
      taskId: options.taskId,
      ctx,
      prompt: options.prompt,
      durationSeconds: options.durationSeconds,
      modelKey: options.model,
    })
    return
  }

  const timeoutMsg = '视频任务查询超时，请稍后在控制台确认结果'
  setNodeStatus(id, 'error', { progress: 0, lastError: timeoutMsg })
  appendLog(id, `[${nowLabel()}] error: ${timeoutMsg}`)
}

async function runVideoTask(ctx: RunnerContext) {
  const { id, setNodeStatus, appendLog } = ctx
  try {
    const prepared = await prepareVideoTaskInput(ctx)
    if (prepared.referenceImagesForVideo.length) {
      appendLog(
        id,
        `[${nowLabel()}] 视频参考图已注入 ${prepared.referenceImagesForVideo.length} 张`,
      )
    }
    if (prepared.uploadedFirstFrameAsset || prepared.uploadedLastFrameAsset || prepared.uploadedReferenceAssets.length) {
      const uploadedCount =
        (prepared.uploadedFirstFrameAsset ? 1 : 0) +
        (prepared.uploadedLastFrameAsset ? 1 : 0) +
        prepared.uploadedReferenceAssets.length
      appendLog(id, `[${nowLabel()}] 视频参考图已按 ${prepared.videoSize || prepared.aspectRatioSetting} 预处理并上传 ${uploadedCount} 个文件`)
    }
    if (!prepared.referenceImagesForVideo.length && !prepared.uploadedReferenceAssets.length) {
      throw new Error('视频生成需要至少一张真实参考图 URL，请先连接/上传/生成参考图')
    }
    await runGenericVideoTask(ctx, {
      prompt: prepared.finalPrompt,
      model: prepared.videoModelValue,
      aspectRatio: prepared.aspectRatioSetting,
      size: prepared.videoSize,
      resolution: prepared.videoResolution,
      specKey: prepared.videoSpecKey,
      orientation: prepared.orientation,
      referenceImages: prepared.referenceImagesForVideo,
      durationSeconds: prepared.videoDurationSeconds,
      generateAudio: prepared.generateAudio,
      returnLastFrame: prepared.returnLastFrame,
      firstFrameUrl: prepared.effectiveFirstFrameUrl,
      lastFrameUrl: prepared.effectiveFirstFrameUrl ? prepared.lastFrameUrlValue : '',
      uploadedReferenceAssets: prepared.uploadedReferenceAssets,
      uploadedFirstFrameAsset: prepared.uploadedFirstFrameAsset,
      uploadedLastFrameAsset: prepared.uploadedLastFrameAsset,
      referenceSheet: prepared.referenceSheet,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error && error.message ? error.message : '视频任务执行失败'
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
    ctx.endRunToken(id)
  }
}

export async function syncImageNodeOnce(_id: string, _get: Getter) {
  return
}

async function runGenericVideoTask(ctx: RunnerContext, options: GenericVideoTaskOptions) {
  const { id, kind, setNodeStatus, appendLog, endRunToken } = ctx
  try {
    const modelKey = String(options.model || '').trim()
    assertVideoModelConfigured(modelKey)

    setNodeStatus(id, 'running', { progress: 5 })
    appendLog(id, `[${nowLabel()}] 调用自动路由视频模型 ${modelKey}…`)

    const extras = buildVeoTaskExtras({
      kind,
      id,
      model: modelKey,
      aspectRatio: options.aspectRatio,
      size: options.size,
      resolution: options.resolution,
      specKey: options.specKey,
      generateAudio: options.generateAudio,
      returnLastFrame: options.returnLastFrame,
      referenceImages: options.referenceImages,
      firstFrameUrl: options.firstFrameUrl,
      lastFrameUrl: options.lastFrameUrl,
      uploadedReferenceAssets: options.uploadedReferenceAssets,
      uploadedFirstFrameAsset: options.uploadedFirstFrameAsset,
      uploadedLastFrameAsset: options.uploadedLastFrameAsset,
      referenceSheet: options.referenceSheet,
    })
    extras.durationSeconds = options.durationSeconds
    extras.orientation = options.orientation

    const request: TaskRequestDto = {
      kind: 'image_to_video',
      prompt: options.prompt,
      extras,
    }
    const { result: res, requestProgress } = await runTaskByVendorWithPendingProgress(ctx, {
      request,
      startProgress: 5,
      maxProgress: 95,
      status: 'running',
    })
    appendRequestPayloadLog({
      appendLog,
      nodeId: id,
      result: res,
      fallbackVendor: 'auto',
      fallbackRequest: request,
    })

    const pendingTaskId = resolvePendingTaskIdFromResult(res)
    if (res.status === 'queued' || res.status === 'running') {
      if (!pendingTaskId) {
        throw new Error('视频任务创建失败：未返回任务 ID')
      }

      setNodeStatus(id, res.status === 'queued' ? 'queued' : 'running', {
        progress: Math.max(10, requestProgress),
        videoTaskId: pendingTaskId,
        videoModel: modelKey,
        videoModelVendor: null,
        lastResult: {
          id: pendingTaskId,
          at: Date.now(),
          kind,
          preview: { type: 'text', value: `已创建视频任务（ID: ${pendingTaskId}）` },
        },
      })
      trySilentSaveProject()
      await pollGenericVideoResultClient(ctx, {
        taskId: pendingTaskId,
        prompt: options.prompt,
        model: modelKey,
        durationSeconds: options.durationSeconds,
      })
      return
    }

    await finalizeGenericVideoSuccess({
      snapshot: res,
      taskId: pendingTaskId || String(res.id || '').trim(),
      ctx,
      prompt: options.prompt,
      durationSeconds: options.durationSeconds,
      modelKey,
    })
  } catch (error: unknown) {
    const message = error instanceof Error && error.message ? error.message : '视频任务执行失败'
    setNodeStatus(id, 'error', { progress: 0, lastError: message })
    appendLog(id, `[${nowLabel()}] error: ${message}`)
  } finally {
    endRunToken(id)
  }
}

export async function syncGenericVideoNodeOnce(id: string, get: Getter) {
  const runTokenAtStart = readNodeRunToken(get, id)
  const ctx = buildRunnerContext(id, get)
  if (!ctx || !ctx.isVideoTask) return

  const isAborted = () => ctx.isCanceled(id) || readNodeRunToken(get, id) !== runTokenAtStart
  if (isAborted()) return

  const { data, prompt, setNodeStatus: setNodeStatusRaw, appendLog: appendLogRaw } = ctx
  const setNodeStatus: RunnerHandlers['setNodeStatus'] = (nodeId, status, patch) => {
    if (isAborted()) return
    setNodeStatusRaw(nodeId, status, patch)
  }
  const appendLog: RunnerHandlers['appendLog'] = (nodeId, line) => {
    if (isAborted()) return
    appendLogRaw(nodeId, line)
  }
  const taskId = resolveActiveVideoTaskIdByVendor(data)
  if (!taskId) return

  let snapshot: TaskResultDto
  try {
    snapshot = await fetchTaskResult(taskId, 'image_to_video', prompt)
  } catch (error: unknown) {
    const message = error instanceof Error && error.message ? error.message : '查询视频任务进度失败'
    appendLog(id, `[${nowLabel()}] error: ${message}`)
    return
  }
  if (isAborted()) return

  if (isTaskRunningSnapshot(snapshot)) {
    const current = typeof (data as any)?.progress === 'number' ? (data as any).progress : 10
    const modelKey = readNodeVideoModel(data)
    updateTaskPollingProgress({ id, setNodeStatus }, snapshot, {
      lastProgress: current,
      progressRange: { min: 10, max: 95 },
      statusPatch: {
        videoTaskId: taskId,
        ...(modelKey ? { videoModel: modelKey } : null),
        videoModelVendor: null,
      },
    })
    return
  }

  if (snapshot.status === 'failed') {
    const msg = resolveGenericVideoFailureMessage(snapshot, '视频')
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
    return
  }

  await finalizeGenericVideoSuccess({
    snapshot,
    taskId,
    ctx,
    prompt,
    durationSeconds: resolveVideoDurationSeconds({
      data,
      videoModelValue: readNodeVideoModel(data),
    }),
    modelKey: readNodeVideoModel(data) || null,
  })
}

type ImageFissionMode = 'model' | 'creative' | 'detail' | 'all'
type ImageFissionConfig = {
  mode?: ImageFissionMode
  count?: 1 | 2 | 3 | 4
  aspectRatio?: '3:4' | '4:3'
  hd?: boolean
}

type ImageFissionSettings = {
  desiredGrids: number
  selectedModel: string
  vendor: string
  mode: ImageFissionMode
  resolvedAspect: '3:4' | '4:3'
  resolvedImageSize: '2K' | '4K'
  imageSizeSetting?: string
  imageResolutionSetting?: string
  systemPromptOpt?: string
}

const IMAGE_FISSION_TEMPLATES: Record<ImageFissionMode, string> = {
  model:
    'You are an efficient image variation engine. Generate a single 2x2 grid image (4 equal quadrants) containing 4 unique variations. The output MUST be a {RES} resolution image. Each quadrant should strictly follow the aspect ratio of {AR}.\nCRITICAL: Do NOT include the original reference image in the grid. Generate 4 NEW and DISTINCT variations that differ from the reference image in terms of pose, angle, or framing. MODE: Model Shot. Analyze the reference model\'s face, body, and clothing. Each quadrant shows the same character from different camera angles, in different shot sizes, and in different professional poses. Maintain exact detail fidelity but ensure all 4 poses differ from the reference.',
  creative:
    'You are an efficient image variation engine. Generate a single 2x2 grid image (4 equal quadrants) containing 4 unique variations. The output MUST be a {RES} resolution image. Each quadrant should strictly follow the aspect ratio of {AR}.\nCRITICAL: Do NOT include the original reference image in the grid. Generate 4 NEW and DISTINCT variations that differ from the reference image in terms of pose, angle, or framing. MODE: Clothing Creative. Keep the model, background, and lighting identical to the reference. Each quadrant shows different logical states of the garment (e.g. open vs closed, sleeves up vs down, different accessorizing). Fixed camera perspective. All 4 quadrants must be variations.',
  detail:
    'You are an efficient image variation engine. Generate a single 2x2 grid image (4 equal quadrants) containing 4 unique variations. The output MUST be a {RES} resolution image. Each quadrant should strictly follow the aspect ratio of {AR}.\nCRITICAL: Do NOT include the original reference image in the grid. Generate 4 NEW and DISTINCT variations that differ from the reference image in terms of pose, angle, or framing. MODE: Clothing Detail. Macro/Close-up focus. Quadrants show collar, fabric texture, prints, and stitching. Professional e-commerce detail photography.',
  all:
    'You are an efficient image variation engine. Generate a single 2x2 grid image (4 equal quadrants) containing 4 unique variations. The output MUST be a {RES} resolution image. Each quadrant should strictly follow the aspect ratio of {AR}.\nCRITICAL: Do NOT include the original reference image in the grid. Generate 4 NEW and DISTINCT variations that differ from the reference image in terms of pose, angle, or framing. MODE: Product Detail. High focus on product logos, material textures (brushed metal, wood grain), and component details. Sharp industrial product photography.',
}

function resolveImageFissionVendor(_selectedModel: string, _explicitVendor: string | null): string {
  return 'auto'
}

function resolveImageFissionSettings(ctx: RunnerContext): ImageFissionSettings {
  const { data, sampleCount } = ctx
  const cfg: ImageFissionConfig = ((data as any)?.imageFission || {}) as ImageFissionConfig
  const desiredGrids = clampInt(cfg.count ?? sampleCount, 1, 4, 1)
  const selectedModel =
    typeof data.imageModel === 'string' && data.imageModel.trim()
      ? data.imageModel.trim()
      : DEFAULT_IMAGE_EDIT_MODEL
  const mode: ImageFissionMode = (cfg.mode ?? 'creative') as ImageFissionMode
  const resolvedAspect =
    cfg.aspectRatio === '4:3' || cfg.aspectRatio === '3:4'
      ? cfg.aspectRatio
      : typeof (data as any)?.aspect === 'string' && (data as any).aspect.trim() === '4:3'
        ? '4:3'
        : '3:4'
  const resolvedImageSize: '2K' | '4K' = cfg.hd ? '4K' : '2K'
  const imageSizeSetting =
    resolvedImageSize ||
    (typeof (data as any)?.imageSize === 'string' && (data as any).imageSize.trim()
      ? (data as any).imageSize.trim()
      : undefined)
  const imageResolutionSetting = resolveImageResolutionSetting({
    imageResolution: (data as Record<string, unknown>).imageResolution,
    resolution: (data as Record<string, unknown>).resolution,
    prompt: ctx.prompt,
  })
  const systemPromptOpt =
    (data as any)?.showSystemPrompt && typeof (data as any)?.systemPrompt === 'string'
      ? (data as any).systemPrompt
      : undefined
  return {
    desiredGrids,
    selectedModel,
    vendor: resolveImageFissionVendor(selectedModel, null),
    mode,
    resolvedAspect,
    resolvedImageSize,
    imageSizeSetting,
    imageResolutionSetting,
    systemPromptOpt,
  }
}

function collectSelfPrimaryImage(data: any): string {
  const results = Array.isArray((data as any)?.imageResults) ? (data as any).imageResults : []
  const primaryIndex =
    typeof (data as any)?.imagePrimaryIndex === 'number' &&
    (data as any).imagePrimaryIndex >= 0 &&
    (data as any).imagePrimaryIndex < results.length
      ? (data as any).imagePrimaryIndex
      : 0
  const fromResults =
    results[primaryIndex] && typeof results[primaryIndex].url === 'string'
      ? String(results[primaryIndex].url).trim()
      : ''
  const fromNode = typeof (data as any)?.imageUrl === 'string' ? String((data as any).imageUrl).trim() : ''
  return fromResults || fromNode || ''
}

async function resolveImageFissionRoleReferences(ctx: RunnerContext): Promise<RoleCardMentionResult> {
  const { data, prompt, id, appendLog } = ctx
  const empty: RoleCardMentionResult = { urls: [], matched: [], missing: [], ambiguous: [] }
  const refs = await resolveRoleCardImagesByMentions({
    prompt,
  }).catch(() => empty)
  if (refs.matched.length) {
    appendLog(id, `[${nowLabel()}] 检测到角色提及：${refs.matched.join('、')}，已自动注入角色卡参考图`)
  }
  if (refs.missing.length) {
    appendLog(id, `[${nowLabel()}] 未找到角色卡：${refs.missing.join('、')}`)
  }
  if (refs.ambiguous.length) {
    appendLog(id, `[${nowLabel()}] 角色名存在同名冲突：${refs.ambiguous.join('、')}，请使用 @角色名#roleId前缀 或 @角色名#cardId前缀`)
  }
  return refs
}

function resolveImageFissionReferences(ctx: RunnerContext, mentionUrls: string[]): string[] {
  const { state, id, data } = ctx
  const upstreamRefs = Array.from(
    new Set([
      ...collectNodeReferenceImageUrls(data, 3),
      ...collectReferenceImages(state, id),
    ]),
  ).slice(0, 3)
  const selfPrimary = collectSelfPrimaryImage(data)
  const roleCardRefImages =
    Array.isArray((data as any)?.roleCardReferenceImages)
      ? ((data as any).roleCardReferenceImages as unknown[]).map((x) => String(x || '').trim()).filter(Boolean)
      : []
  return Array.from(
    new Set(
      [...upstreamRefs, ...(selfPrimary ? [selfPrimary] : [])]
        .concat(mentionUrls)
        .concat(roleCardRefImages)
        .filter((u) => typeof u === 'string' && u.trim())
        .map((u) => u.trim()),
    ),
  ).slice(0, 3)
}

function failImageFissionTask(ctx: RunnerContext, message: string, level: 'warning' | 'error' = 'warning') {
  const { id, setNodeStatus, appendLog, isCanceled } = ctx
  setNodeStatus(id, 'error', { progress: 0, lastError: message })
  appendLog(id, `[${nowLabel()}] error: ${message}`)
  if (!isCanceled(id)) toast(message, level)
}

function ensureImageFissionInputReady(ctx: RunnerContext, referenceImages: string[]): boolean {
  if (referenceImages.length === 0) {
    failImageFissionTask(ctx, '图像裂变需要至少一张参考图：请连接一个上游图像节点，或先在本节点上传/选择一张图片。')
    return false
  }
  return true
}

function buildImageFissionPrompt(ctx: RunnerContext, settings: ImageFissionSettings): string {
  const template = IMAGE_FISSION_TEMPLATES[settings.mode] || IMAGE_FISSION_TEMPLATES.creative
  const compiled = template
    .split('{AR}')
    .join(settings.resolvedAspect)
    .split('{RES}')
    .join(settings.resolvedImageSize)
  const userHint = ctx.prompt.trim()
  const gridPrompt = userHint ? `${compiled}\n\nAdditional constraints:\n${userHint}` : compiled
  return settings.systemPromptOpt ? `${settings.systemPromptOpt}\n\n${gridPrompt}` : gridPrompt
}

function buildImageFissionBaseResults(data: any): any[] {
  const existing = Array.isArray((data as any)?.imageResults) ? (data as any).imageResults : []
  if (existing.length) return existing
  if (typeof (data as any)?.imageUrl === 'string' && (data as any).imageUrl.trim()) {
    return [{ url: String((data as any).imageUrl).trim(), title: '参考图' }]
  }
  return []
}

async function runSingleFissionGrid(input: {
  ctx: RunnerContext
  settings: ImageFissionSettings
  referenceImages: string[]
  assetInputs?: unknown
  promptForModel: string
  gridIdx: number
}): Promise<{ items: { url: string; title?: string }[]; firstUrl: string; res: any }> {
  const { ctx, settings, referenceImages, assetInputs, promptForModel, gridIdx } = input
  const { id, kind, desiredGrids, selectedModel, imageSizeSetting, imageResolutionSetting, vendor, systemPromptOpt } = {
    id: ctx.id,
    kind: ctx.kind,
    desiredGrids: settings.desiredGrids,
    selectedModel: settings.selectedModel,
    imageSizeSetting: settings.imageSizeSetting,
    imageResolutionSetting: settings.imageResolutionSetting,
    vendor: settings.vendor,
    systemPromptOpt: settings.systemPromptOpt,
  }
  const progressBase = 5 + Math.floor((45 * gridIdx) / Math.max(1, desiredGrids))
  const sliceSpan = Math.max(5, Math.floor(45 / Math.max(1, desiredGrids)))
  const progressMax = Math.min(50, progressBase + sliceSpan)
  ctx.setNodeStatus(id, 'running', { progress: progressBase })
  ctx.appendLog(id, `[${nowLabel()}] 生成裂变网格（${gridIdx + 1}/${desiredGrids}）…`)

  const request: TaskRequestDto = {
    kind: 'image_edit',
    prompt: promptForModel,
    extras: {
      nodeKind: kind,
      nodeId: id,
      modelKey: selectedModel,
      aspectRatio: settings.resolvedAspect,
      ...(imageSizeSetting ? { imageSize: imageSizeSetting } : {}),
      ...(imageResolutionSetting ? { imageResolution: imageResolutionSetting, resolution: imageResolutionSetting } : {}),
      referenceImages,
      ...(Array.isArray(assetInputs) && assetInputs.length ? { assetInputs } : {}),
      ...(systemPromptOpt ? { systemPrompt: systemPromptOpt } : {}),
      persistAssets: useUIStore.getState().assetPersistenceEnabled,
    },
  }
  const pendingTask = await runTaskByVendorWithPendingProgress(ctx, {
    request,
    startProgress: progressBase,
    maxProgress: progressMax,
    status: 'running',
  })
  let res = pendingTask.result
  const requestProgress = pendingTask.requestProgress
  ctx.appendLog(id, `[${nowLabel()}] 请求已发送，记录任务请求体…`)
  appendRequestPayloadLog({
    appendLog: ctx.appendLog,
    nodeId: id,
    result: res,
    fallbackVendor: vendor,
    fallbackRequest: request,
  })

  if (res.status === 'queued' || res.status === 'running') {
    const taskId = typeof res.id === 'string' ? res.id.trim() : String(res.id || '').trim()
    if (!taskId) throw new Error('裂变任务创建失败：未返回任务 ID')
    ctx.appendLog(id, `[${nowLabel()}] 已创建裂变任务（ID: ${taskId}），开始轮询进度…`)
    res = await pollTaskResultUntilDone(ctx, {
      taskId,
      taskKind: 'image_edit',
      prompt: promptForModel,
      progressRange: { min: progressBase, max: progressMax },
      initialProgress: Math.max(progressBase, requestProgress),
      statusPatch: { taskId, imageTaskId: taskId, imageTaskKind: 'image_edit' },
    })
  }

  const gridRawUrl = extractFirstImageAssetUrl(res)
  const gridUrl = gridRawUrl
    ? await ensureHostedImageUrl(gridRawUrl, {
        prompt: promptForModel,
        vendor,
        modelKey: selectedModel,
        taskKind: 'image_edit',
        fileName: `fission-grid-${id}-${Date.now()}-${gridIdx + 1}.png`,
      })
    : null
  if (!gridUrl) throw new Error('裂变失败：未返回网格图')

  const quadrants = await splitGridToBlobs({ url: gridUrl, rows: 2, cols: 2, take: 4 })
  const items: { url: string; title?: string }[] = []
  const now = Date.now()
  for (let i = 0; i < quadrants.length; i++) {
    if (ctx.isCanceled(id)) throw new Error('任务已取消')
    const blob = quadrants[i]!
    const file = new File([blob], `fission-${id}-${now}-${gridIdx + 1}-${i + 1}.png`, { type: 'image/png' })
    // eslint-disable-next-line no-await-in-loop
    const asset = await uploadServerAssetFile(file, `裂变-${gridIdx + 1}-${i + 1}`, {
      prompt: promptForModel,
      vendor,
      modelKey: selectedModel,
      taskKind: 'image_edit',
    })
    const uploadedUrl = typeof (asset?.data as any)?.url === 'string' ? String((asset.data as any).url).trim() : ''
    if (!uploadedUrl) throw new Error('裂变上传失败：未返回 url')
    items.push({ url: uploadedUrl, title: `裂变 ${gridIdx + 1}-${i + 1}` })
    const doneParts = gridIdx * 4 + (i + 1)
    const totalParts = desiredGrids * 4
    const p = 50 + Math.round((doneParts / Math.max(1, totalParts)) * 45)
    ctx.setNodeStatus(id, 'running', { progress: Math.max(50, Math.min(95, p)) })
  }
  return { items, firstUrl: String(items[0]?.url || '').trim(), res }
}

async function runImageFissionTask(ctx: RunnerContext) {
  const { id, kind, setNodeStatus, appendLog, isCanceled, data } = ctx
  try {
    const settings = resolveImageFissionSettings(ctx)
    const mentionRoleRefs = await resolveImageFissionRoleReferences(ctx)
    const referenceImages = resolveImageFissionReferences(ctx, mentionRoleRefs.urls)
    if (!ensureImageFissionInputReady(ctx, referenceImages)) return
    const runtimeReferenceAssetInputs = mergeReferenceAssetInputs({
      assetInputs: (data as Record<string, unknown>)?.assetInputs,
      dynamicEntries: collectDynamicUpstreamReferenceEntries(ctx.state, id),
      referenceImages,
      limit: 8,
    })

    const promptForModel = appendReferenceAliasSlotPrompt({
      prompt: buildImageFissionPrompt(ctx, settings),
      assetInputs: runtimeReferenceAssetInputs,
      referenceImages,
      enabled: referenceImages.length > 0,
    })
    const baseResults = buildImageFissionBaseResults(data)
    setNodeStatus(id, 'running', { progress: 5, lastError: undefined })
    appendLog(
      id,
      `[${nowLabel()}] 图像裂变：${settings.mode} / ${settings.resolvedAspect} / ${settings.resolvedImageSize}，生成 2x2 变体网格 x${settings.desiredGrids}…`,
    )

    const newItems: { url: string; title?: string }[] = []
    let primaryUrl = ''
    let lastRes: any = null
    for (let gridIdx = 0; gridIdx < settings.desiredGrids; gridIdx++) {
      if (isCanceled(id)) throw new Error('任务已取消')
      // eslint-disable-next-line no-await-in-loop
      const one = await runSingleFissionGrid({
        ctx,
        settings,
        referenceImages,
        assetInputs: runtimeReferenceAssetInputs,
        promptForModel,
        gridIdx,
      })
      if (!primaryUrl) primaryUrl = one.firstUrl
      newItems.push(...one.items)
      lastRes = one.res
    }

    if (!primaryUrl || newItems.length === 0) throw new Error('裂变失败：未产出候选图')
    setNodeStatus(id, 'success', {
      progress: 100,
      imageUrl: primaryUrl,
      imageResults: [...newItems, ...baseResults],
      imagePrimaryIndex: 0,
      lastResult: {
        id: lastRes?.id,
        at: Date.now(),
        kind,
        preview: { type: 'image', src: primaryUrl },
      },
    })
    if (!isCanceled(id)) notifyAssetRefresh()
    appendLog(id, `[${nowLabel()}] 图像裂变完成：生成候选 ${newItems.length} 张。`)
  } catch (err: any) {
    const msg = err?.message || '图像裂变失败'
    if (!isCanceled(id)) toast(msg, 'error')
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
  } finally {
    ctx.endRunToken(id)
  }
}

function readCanvasNodesFromState(state: unknown): Node[] {
  const record = isPlainRecord(state) ? state : {}
  const nodes = Array.isArray(record.nodes) ? record.nodes : []
  return nodes.filter((node): node is Node => isPlainRecord(node) && typeof node.id === 'string')
}

function readCanvasEdgesFromState(state: unknown): Edge[] {
  const record = isPlainRecord(state) ? state : {}
  const edges = Array.isArray(record.edges) ? record.edges : []
  return edges.filter((edge): edge is Edge => isPlainRecord(edge) && typeof edge.id === 'string')
}

function readCurrentCanvasScope(): { projectId: string; flowId: string } {
  const ui = useUIStore.getState() as {
    currentProject?: { id?: string | null } | null
    currentFlow?: { id?: string | null } | null
  }
  return {
    projectId: String(ui.currentProject?.id || '').trim(),
    flowId: String(ui.currentFlow?.id || '').trim(),
  }
}

async function runGenericTask(ctx: RunnerContext) {
  const {
    id,
    data,
    taskKind,
    sampleCount,
    setNodeStatus,
    appendLog,
    isCanceled,
    isImageTask,
    kind,
    prompt,
    state,
  } = ctx

  try {
    const storedImageModel =
      typeof data.imageModel === 'string' && data.imageModel.trim()
        ? data.imageModel.trim()
        : ''
    const storedTextModel =
      typeof data.geminiModel === 'string' && data.geminiModel.trim()
        ? data.geminiModel.trim()
        : typeof data.model === 'string' && data.model.trim()
          ? data.model.trim()
          : 'gemini-2.5-flash'
    const focusGuideUrl =
      typeof (data as any)?.poseMaskUrl === 'string' && (data as any)?.poseMaskUrl.trim()
        ? (data as any).poseMaskUrl.trim()
        : null
    const systemPromptOpt =
      (data as any)?.showSystemPrompt && typeof (data as any)?.systemPrompt === 'string'
        ? (data as any).systemPrompt
        : undefined
    const mentionRoleRefs = isImageTask
      ? await resolveRoleCardImagesByMentions({
          prompt,
        }).catch(() => ({ urls: [] as string[], matched: [] as string[], missing: [] as string[], ambiguous: [] as string[] }))
      : { urls: [] as string[], matched: [] as string[], missing: [] as string[], ambiguous: [] as string[] }
    const mentionAssetRefs = isImageTask
      ? await resolveAssetImagesByMentions({
          prompt,
          nodes: Array.isArray((state as { nodes?: unknown }).nodes)
            ? ((state as { nodes?: unknown }).nodes as Node[])
            : [],
        }).catch(() => ({ urls: [] as string[], matched: [] as string[], missing: [] as string[], ambiguous: [] as string[] }))
      : { urls: [] as string[], matched: [] as string[], missing: [] as string[], ambiguous: [] as string[] }
    if (isImageTask && mentionRoleRefs.matched.length) {
      appendLog(id, `[${nowLabel()}] 检测到角色提及：${mentionRoleRefs.matched.join('、')}，已自动注入角色卡参考图`)
    }
    if (isImageTask && mentionRoleRefs.missing.length) {
      appendLog(id, `[${nowLabel()}] 未找到角色卡：${mentionRoleRefs.missing.join('、')}`)
    }
    if (isImageTask && mentionRoleRefs.ambiguous.length) {
      appendLog(
        id,
        `[${nowLabel()}] 角色名存在同名冲突：${mentionRoleRefs.ambiguous.join('、')}，请使用 @角色名#roleId前缀 或 @角色名#cardId前缀`,
      )
    }
    if (isImageTask && mentionAssetRefs.matched.length) {
      appendLog(id, `[${nowLabel()}] 检测到资产引用：${mentionAssetRefs.matched.join('、')}，已自动注入参考资产`)
    }
    if (isImageTask && mentionAssetRefs.missing.length) {
      appendLog(id, `[${nowLabel()}] 未找到资产引用：${mentionAssetRefs.missing.join('、')}`)
    }
    if (isImageTask && mentionAssetRefs.ambiguous.length) {
      appendLog(id, `[${nowLabel()}] 资产引用存在同名冲突：${mentionAssetRefs.ambiguous.join('、')}，请保证引用ID唯一`)
    }
    const roleCardRefImages = isImageTask
      ? (
          Array.isArray((data as any)?.roleCardReferenceImages)
            ? ((data as any).roleCardReferenceImages as unknown[])
                .map((x) => String(x || '').trim())
                .filter(Boolean)
            : []
        )
      : []
    const sourceBookId = String((data as any)?.sourceBookId || '').trim()
    const sourceTag = String((data as any)?.source || '').trim()
    const nodeLabel = String((data as any)?.label || '').trim()
    const semanticRoleBinding = resolveSemanticNodeRoleBinding(data)
    const roleNameHint = String(semanticRoleBinding.roleName || '').trim()
    const roleCardIdHint = String(semanticRoleBinding.roleCardId || '').trim()
    const isRoleCardTask =
      isImageTask &&
      (
        !!roleNameHint ||
        !!roleCardIdHint ||
        /角色卡|角色设定|主角角色卡/i.test(nodeLabel) ||
        sourceTag === 'novel_character_meta' ||
        sourceTag === 'main_role_card_confirmation' ||
        sourceTag === 'novel_upload_autoflow'
      )
    const selfPoseRefs = isImageTask
      ? (
          Array.isArray((data as any)?.poseReferenceImages)
            ? ((data as any).poseReferenceImages as unknown[])
                .map((x) => String(x || '').trim())
                .filter(Boolean)
            : []
        )
      : []
    const selfStickmanRef =
      isImageTask && typeof (data as any)?.poseStickmanUrl === 'string' && (data as any).poseStickmanUrl.trim()
        ? String((data as any).poseStickmanUrl).trim()
        : ''
    const referenceImagesRaw = isImageTask
      ? (
        isRoleCardTask
          ? [
              ...roleCardRefImages,
              ...mentionRoleRefs.urls,
              ...selfPoseRefs,
              ...(selfStickmanRef ? [selfStickmanRef] : []),
              ...collectNodeReferenceImageUrls(data, 8),
              ...collectReferenceImages(state, id),
              ...mentionAssetRefs.urls,
            ]
          : [
              ...selfPoseRefs,
              ...(selfStickmanRef ? [selfStickmanRef] : []),
              ...collectNodeReferenceImageUrls(data, 3),
              ...collectReferenceImages(state, id),
              ...mentionAssetRefs.urls,
              ...mentionRoleRefs.urls,
              ...roleCardRefImages,
            ]
      )
      : []
    const deduped = Array.from(new Set(referenceImagesRaw.filter((u) => typeof u === 'string' && u.trim())))
    const prioritized: string[] = []
    const hardLimit = isRoleCardTask ? 8 : 3
    const baseReferenceLimit = focusGuideUrl ? Math.max(1, hardLimit - 1) : hardLimit
    deduped.forEach((url) => {
      if (prioritized.length >= baseReferenceLimit) return
      if (url === focusGuideUrl) return
      prioritized.push(url)
    })
    let referenceImages = focusGuideUrl
      ? [...prioritized.slice(0, Math.max(0, hardLimit - 1)), focusGuideUrl]
      : prioritized.slice(0, hardLimit)
    const dynamicReferenceEntries = collectDynamicUpstreamReferenceEntries(state, id)
    let runtimeReferenceAssetInputs = mergeReferenceAssetInputs({
      assetInputs: (data as Record<string, unknown>)?.assetInputs,
      dynamicEntries: dynamicReferenceEntries,
      referenceImages,
      limit: 8,
    })
    if (isRoleCardTask && referenceImages.length) {
      appendLog(id, `[${nowLabel()}] 角色卡任务已启用风格锚定：注入参考图 x${referenceImages.length}`)
    }
    if (isImageTask && focusGuideUrl && referenceImages.length) {
      appendLog(id, `[${nowLabel()}] 已注入局部编辑区域引导图，模型仅允许修改高亮区域`)
    }
    const wantsImageEdit = isImageTask && referenceImages.length > 0
    const effectiveTaskKind: TaskKind = wantsImageEdit ? 'image_edit' : taskKind
    const selectedModel = isImageTask
      ? storedImageModel || resolveDefaultImageModelForTask(effectiveTaskKind === 'image_edit' ? 'image_edit' : 'text_to_image')
      : storedTextModel
    const modelLower = selectedModel.toLowerCase()

    const explicitVendor = isImageTask
      ? null
      : ((data as any)?.modelVendor as string | undefined)
    const vendor = isImageTask
      ? 'auto'
      : explicitVendor || (
          isAnthropicModel(selectedModel) ||
          modelLower.includes('claude') ||
          modelLower.includes('glm')
            ? 'anthropic'
            : modelLower.includes('gpt') ||
                modelLower.includes('openai') ||
                modelLower.includes('o3-') ||
                modelLower.includes('codex')
              ? 'openai'
              : 'gemini'
        )
    let referenceSheet: UploadedReferenceSheet | null = null
    if (isImageTask && referenceImages.length > 2) {
      try {
        const mergedReferenceSheet = await uploadMergedReferenceSheet({
          id,
          entries: buildNamedReferenceEntries({
            assetInputs: runtimeReferenceAssetInputs,
            referenceImages,
            fallbackPrefix: 'ref',
            limit: 8,
          }),
          prompt,
          vendor,
          modelKey: selectedModel,
          taskKind: 'image_edit',
        })
        if (mergedReferenceSheet) {
          referenceSheet = mergedReferenceSheet
          referenceImages = [mergedReferenceSheet.url]
          runtimeReferenceAssetInputs = mergeReferenceAssetInputs({
            assetInputs: runtimeReferenceAssetInputs,
            dynamicEntries: dynamicReferenceEntries,
            referenceImages,
            limit: 8,
          })
          appendLog(id, `[${nowLabel()}] 参考资产超过 2 张，已自动合成带 id 标记的拼图参考板`)
        }
      } catch (err) {
        console.warn('[remoteRunner] merge image references failed', err)
      }
    }
    const rawAspectRatio =
      typeof (data as any)?.aspect === 'string' && (data as any)?.aspect.trim()
        ? (data as any).aspect.trim()
        : ''
    const aspectRatio =
      rawAspectRatio && rawAspectRatio.toLowerCase() !== 'auto'
        ? rawAspectRatio
        : '16:9'
    const imageSizeSetting =
      typeof (data as any)?.imageSize === 'string' && (data as any)?.imageSize.trim()
        ? (data as any).imageSize.trim()
        : undefined
    const imageResolutionSetting = resolveImageResolutionSetting({
      imageResolution: (data as Record<string, unknown>).imageResolution,
      resolution: (data as Record<string, unknown>).resolution,
      prompt,
    })
    const imageEditSizeSetting =
      effectiveTaskKind === 'image_edit' && typeof (data as any)?.imageEditSize === 'string' && (data as any).imageEditSize.trim()
        ? (data as any).imageEditSize.trim()
        : undefined
    const imageEditDimensions = imageEditSizeSetting
      ? parseImageEditSizeDimensions(imageEditSizeSetting)
      : null

    const allImageAssets: AssetResultItem[] = []
    const allTexts: string[] = []
    let lastRes: any = null

    const promptForModel =
      isImageTask && systemPromptOpt
        ? `${systemPromptOpt}\n\n${prompt}`
        : prompt
    const roleCardStyleLockHint =
      isRoleCardTask
        ? '角色卡强约束：必须严格沿用 referenceImages 的画风锚点（线条/材质/光影/色温），保持角色外观一致；不得擅自切换风格。'
        : ''
    const promptWithAliasSlotBinding = appendReferenceAliasSlotPrompt({
      prompt: [promptForModel, roleCardStyleLockHint].filter(Boolean).join('\n\n'),
      assetInputs: runtimeReferenceAssetInputs,
      referenceImages,
      enabled: wantsImageEdit && !referenceSheet,
    })
    const effectivePromptForModel = appendImageEditFocusGuidePrompt(
      promptWithAliasSlotBinding,
      Boolean(focusGuideUrl),
    )

    for (let i = 0; i < sampleCount; i++) {
      if (isCanceled(id)) {
        setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
        appendLog(id, `[${nowLabel()}] 已取消`)
        ctx.endRunToken(id)
        return
      }

      const progressBase = 5 + Math.floor((90 * i) / sampleCount)
      setNodeStatus(id, 'running', { progress: progressBase })
      const vendorName =
        vendor === 'qwen'
          ? 'Qwen'
          : vendor === 'anthropic'
            ? 'Claude'
            : vendor === 'openai'
              ? 'OpenAI'
              : vendor === 'veo'
                ? 'Veo'
                : 'Gemini'
      const modelType =
        effectiveTaskKind === 'image_edit'
          ? '图像编辑'
          : effectiveTaskKind === 'text_to_image'
            ? '图像'
            : '文案'
      appendLog(
        id,
        `[${nowLabel()}] 调用${vendorName} ${modelType}模型 ${sampleCount > 1 ? `(${i + 1}/${sampleCount})` : ''}…`,
      )

      const imageRequest: TaskRequestDto | null = isImageTask
        ? {
            kind: effectiveTaskKind,
            prompt: effectivePromptForModel,
            ...(imageEditDimensions ? imageEditDimensions : {}),
            extras: {
              nodeKind: kind,
              nodeId: id,
              modelKey: selectedModel,
              aspectRatio,
              ...(imageEditSizeSetting
                ? {
                    size: imageEditSizeSetting,
                    resolution: imageEditSizeSetting,
                    image_size: imageEditSizeSetting,
                  }
                : {}),
              ...(imageSizeSetting ? { imageSize: imageSizeSetting } : {}),
              ...(imageResolutionSetting ? { imageResolution: imageResolutionSetting, resolution: imageResolutionSetting } : {}),
              ...(wantsImageEdit ? { referenceImages } : {}),
              ...(runtimeReferenceAssetInputs.length ? { assetInputs: runtimeReferenceAssetInputs } : {}),
              ...(referenceSheet ? { referenceSheet: buildReferenceSheetLogMeta(referenceSheet) } : {}),
              ...(systemPromptOpt ? { systemPrompt: systemPromptOpt } : {}),
            },
          }
        : null
      const requestProgressCap = Math.max(
        progressBase + 1,
        Math.min(95, 5 + Math.floor((90 * (i + 1)) / sampleCount) - 2),
      )
      const pendingTask = imageRequest
        ? await runTaskByVendorWithPendingProgress(ctx, {
            request: imageRequest,
            startProgress: progressBase,
            maxProgress: requestProgressCap,
            status: 'running',
          })
        : null
      let res = imageRequest
        ? pendingTask!.result
        : await runAutoChat({
            prompt,
            ...(systemPromptOpt ? { systemPrompt: systemPromptOpt } : {}),
            ...(selectedModel ? { modelAlias: selectedModel } : {}),
          })
      const requestProgress = imageRequest ? pendingTask!.requestProgress : progressBase

      if (isImageTask) {
        appendRequestPayloadLog({
          appendLog,
          nodeId: id,
          result: res,
          fallbackVendor: vendor,
          fallbackRequest: imageRequest!,
        })
      }

      if (isImageTask && (res.status === 'queued' || res.status === 'running')) {
        const taskId = typeof res.id === 'string' ? res.id.trim() : String(res.id || '').trim()
        if (!taskId) {
          throw new Error('图像任务创建失败：未返回任务 ID')
        }
        const semanticBindingPatch = buildSemanticProjectTaskBindingPatch({
          nodeData: (data as Record<string, unknown>) || {},
          taskKind: effectiveTaskKind,
        })

        setNodeStatus(id, 'running', {
          progress: Math.max(10, progressBase, requestProgress),
          taskId,
          imageTaskId: taskId,
          imageTaskKind: effectiveTaskKind,
          imageModel: selectedModel,
          imageModelVendor: null,
          ...semanticBindingPatch,
          lastResult: {
            id: taskId,
            at: Date.now(),
            kind,
            preview: { type: 'text', value: `已创建图像任务（ID: ${taskId}）` },
          },
        })
        appendLog(id, `[${nowLabel()}] 已创建图像任务（ID: ${taskId}），开始轮询进度…`)

        if (typeof window !== 'undefined' && typeof (window as any).silentSaveProject === 'function') {
          try {
            ;(window as any).silentSaveProject()
          } catch {}
        }

        const pollIntervalMs = 2500
        const pollTimeoutMs = DEFAULT_TASK_POLL_TIMEOUT_MS
        const startedAt = Date.now()
        let lastProgress = Math.max(10, progressBase, requestProgress)

        while (Date.now() - startedAt < pollTimeoutMs) {
          if (isCanceled(id)) {
            setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
            appendLog(id, `[${nowLabel()}] 已取消图像任务`)
            ctx.endRunToken(id)
            return
          }

          let snapshot: TaskResultDto
          try {
            snapshot = await fetchTaskResult(taskId, effectiveTaskKind, effectivePromptForModel)
          } catch (err: any) {
            const msg = err?.message || '查询图像任务进度失败'
            appendLog(id, `[${nowLabel()}] error: ${msg}`)
            await sleep(pollIntervalMs)
            continue
          }

          if (snapshot.status === 'queued' || snapshot.status === 'running') {
            const raw = snapshot.raw as any
            const rawProgress =
              (typeof raw?.progress === 'number' ? raw.progress : null) ??
              (typeof raw?.response?.progress === 'number' ? raw.response.progress : null) ??
              (typeof raw?.response?.progress_pct === 'number' ? raw.response.progress_pct * 100 : null)
            if (typeof rawProgress === 'number') {
              const normalized = Math.min(95, Math.max(lastProgress, Math.max(5, Math.round(rawProgress))))
              lastProgress = normalized
              setNodeStatus(id, snapshot.status === 'queued' ? 'queued' : 'running', {
                progress: normalized,
                taskId,
                imageTaskId: taskId,
              })
            }
            await sleep(pollIntervalMs)
            continue
          }

          if (snapshot.status === 'failed') {
            const msg =
              (snapshot.raw && ((snapshot.raw as any)?.failureReason as string | undefined)) ||
              (snapshot.raw && ((snapshot.raw as any)?.response?.error as string | undefined)) ||
              (snapshot.raw && ((snapshot.raw as any)?.response?.message as string | undefined)) ||
              '图像任务失败'
            throw new Error(msg)
          }

          // succeeded
          res = snapshot
          break
        }

        if (res.status === 'queued' || res.status === 'running') {
          throw new Error('图像任务轮询超时，服务端任务可能仍在继续，请稍后在历史或资产中确认结果')
        }
      }

      lastRes = res

      if (vendor === 'qwen' && res.status === 'failed') {
        const rawResponse = res.raw?.response
        const errMsg =
          rawResponse?.output?.error_message ||
          rawResponse?.error_message ||
          rawResponse?.message ||
          res.raw?.message ||
          'Qwen 图像生成失败'
        throw new Error(errMsg)
      }

      if ((vendor === 'gemini' || vendor === 'google') && res.status === 'failed') {
        const rawResponse = (res.raw as any)?.response || res.raw
        const errMsg =
          rawResponse?.failure_reason ||
          rawResponse?.error ||
          rawResponse?.message ||
          'Banana 图像生成失败'
        throw new Error(errMsg)
      }

      const textOut = (res.raw && (res.raw.text as string)) || ''
      if (textOut.trim()) {
        allTexts.push(textOut.trim())
      }

      const imageAssets = (Array.isArray(res.assets) ? res.assets : [])
        .filter((asset) => asset?.type === 'image' && typeof asset.url === 'string' && asset.url.trim().length > 0)
        .map((asset, index) => {
          const ordinal = allImageAssets.length + index + 1
          const roleNameHint = String(resolveSemanticNodeRoleBinding(data).roleName || '').trim()
          const labelHint = String((data as Record<string, unknown>)?.label || '').trim()
          const fallbackName = roleNameHint || labelHint || `image_${ordinal}`
          const fallbackTitle = labelHint ? `${labelHint} ${ordinal}` : `图像 ${ordinal}`
          return buildImageAssetResultItem({
            url: String(asset.url).trim(),
            title:
              typeof asset.assetName === 'string' && asset.assetName.trim()
                ? asset.assetName.trim()
                : fallbackTitle,
            assetId: typeof asset.assetId === 'string' ? asset.assetId.trim() : null,
            assetName:
              typeof asset.assetName === 'string' && asset.assetName.trim()
                ? asset.assetName.trim()
                : fallbackName,
            assetRefId: typeof asset.assetRefId === 'string' ? asset.assetRefId.trim() : null,
          })
        })
      if (imageAssets.length) {
        allImageAssets.push(...imageAssets)
      }

      if (isCanceled(id)) {
        setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
        appendLog(id, `[${nowLabel()}] 已取消`)
        ctx.endRunToken(id)
        return
      }
    }

    const res = lastRes
    const text = (res?.raw && (res.raw.text as string)) || ''
    const firstImage =
      isImageTask && allImageAssets.length ? allImageAssets[0] : null
    const preview =
      IMAGE_NODE_KINDS.has(kind) && firstImage
        ? { type: 'image', src: firstImage.url }
        : text.trim().length > 0
          ? { type: 'text', value: text }
          : { type: 'text', value: 'AI 调用成功' }

    let patchExtra: any = {}
    const existingPrompt =
      typeof (data as any)?.prompt === 'string'
        ? (data as any).prompt.trim()
        : ''
    if (isImageTask && res?.id) {
      const completedTaskId = String(res.id).trim()
      patchExtra = {
        ...patchExtra,
        ...(completedTaskId ? { taskId: completedTaskId, imageTaskId: completedTaskId } : {}),
        ...buildSemanticProjectTaskBindingPatch({
          nodeData: (data as Record<string, unknown>) || {},
          taskKind: effectiveTaskKind,
        }),
      }
    }
    if (isImageTask && allImageAssets.length) {
      const existing = normalizeImageResultItems((data as Record<string, unknown>)?.imageResults)
      const merged = [...existing, ...allImageAssets]
      const newPrimaryIndex = existing.length
      patchExtra = {
        ...patchExtra,
        imageUrl: firstImage!.url,
        imageResults: merged,
        imagePrimaryIndex: newPrimaryIndex,
      }
    }
    if (allTexts.length) {
      const existingTexts =
        (data.textResults as { text: string }[] | undefined) || []
      const mergedTexts = [
        ...existingTexts,
        ...allTexts.map((t) => ({ text: t })),
      ]
      patchExtra = {
        ...patchExtra,
        textResults: mergedTexts,
      }
    }

    // 将本次使用的提示词写回节点数据（仅在节点原本没有提示词，或本次使用的提示词与原值一致时）
    if (typeof prompt === 'string' && prompt.trim().length > 0) {
      const usedPrompt = prompt.trim()
      const shouldWritePromptBack = !existingPrompt || existingPrompt === usedPrompt
      if (shouldWritePromptBack) {
        patchExtra = {
          ...patchExtra,
          prompt: usedPrompt,
        }
      }
    }

    setNodeStatus(id, 'success', {
      progress: 100,
      lastResult: {
        id: res?.id,
        at: Date.now(),
        kind,
        preview,
      },
      ...patchExtra,
    })
    if (isImageTask && firstImage?.url) {
      const nextNodeData: Record<string, unknown> = {
        ...(data as Record<string, unknown>),
        ...patchExtra,
      }
      let semanticNodeData: Record<string, unknown> = { ...nextNodeData }
      try {
        const bindingResult = await persistRoleCardImageBinding({
          nodeId: id,
          nodeData: nextNodeData,
          imageUrl: String(firstImage.url),
          prompt: typeof prompt === 'string' ? prompt : undefined,
          modelKey: String(selectedModel || '').trim() || undefined,
        })
        if (bindingResult && !isCanceled(id)) {
          const existingRoleRefUrls = Array.isArray((data as Record<string, unknown>)?.roleCardReferenceImages)
            ? ((data as Record<string, unknown>).roleCardReferenceImages as unknown[])
                .map((item) => String(item || '').trim())
                .filter(Boolean)
            : []
          const nextRoleRefUrls = firstImage?.url
            ? Array.from(new Set<string>([...existingRoleRefUrls, String(firstImage.url).trim()])).slice(0, 8)
            : existingRoleRefUrls
          const existingRoleReferenceEntries = Array.isArray((data as Record<string, unknown>)?.roleReferenceEntries)
            ? ((data as Record<string, unknown>).roleReferenceEntries as unknown[])
                .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
                .map((item) => ({
                  name: String(item.name || '').trim(),
                  url: String(item.url || '').trim(),
                }))
                .filter((item) => item.name && item.url)
            : []
          const nextRoleReferenceEntries = (() => {
            if (!firstImage?.url || !bindingResult.roleName) return existingRoleReferenceEntries
            const imageUrl = String(firstImage.url).trim()
            const deduped = existingRoleReferenceEntries.filter((item) => item.url !== imageUrl)
            deduped.unshift({
              name: bindingResult.roleName,
              url: imageUrl,
            })
            return deduped.slice(0, 10)
          })()
          const nextAnchorBindings = upsertSemanticNodeAnchorBinding({
            existing: semanticNodeData.anchorBindings,
            next: {
              kind: 'character',
              label: bindingResult.roleName,
              refId: bindingResult.roleCardId,
              entityId: bindingResult.roleId,
              sourceBookId: bindingResult.sourceBookId,
              imageUrl: String(firstImage.url).trim(),
              referenceView: 'three_view',
            },
          })
          semanticNodeData = {
            ...semanticNodeData,
            ...(bindingResult.sourceBookId ? { sourceBookId: bindingResult.sourceBookId } : {}),
            anchorBindings: nextAnchorBindings,
          }
          setNodeStatus(id, 'success', {
            roleName: bindingResult.roleName,
            ...(bindingResult.roleId ? { roleId: bindingResult.roleId } : null),
            ...(bindingResult.roleCardId ? { roleCardId: bindingResult.roleCardId } : null),
            ...(bindingResult.sourceBookId ? { sourceBookId: bindingResult.sourceBookId } : null),
            ...(nextRoleRefUrls.length ? { roleCardReferenceImages: nextRoleRefUrls } : null),
            ...(nextRoleReferenceEntries.length ? { roleReferenceEntries: nextRoleReferenceEntries } : null),
            anchorBindings: nextAnchorBindings,
            roleBindingSyncError: null,
            roleBindingBookScope: bindingResult.bookScopeStatus,
            roleBindingMetadataSynced: bindingResult.metadataSynced,
            roleBindingMetadataSyncedAt: bindingResult.metadataSynced ? new Date().toISOString() : null,
          })
          if (bindingResult.metadataSynced && bindingResult.sourceBookId) {
            appendLog(id, `[${nowLabel()}] 角色主图已同步到章节元数据（book=${bindingResult.sourceBookId}）`)
          } else {
            appendLog(
              id,
              `[${nowLabel()}] 角色主图已绑定到项目资产，但未同步到书籍 roleCards（bookScope=${bindingResult.bookScopeStatus}）`,
            )
          }
          notifyAssetRefresh()
        }
      } catch (err: any) {
        const syncError = String(err?.message || err || 'unknown')
        appendLog(id, `[${nowLabel()}] 角色卡回填失败：${syncError}`)
        setNodeStatus(id, 'success', {
          roleBindingSyncError: syncError,
          roleBindingMetadataSynced: false,
        })
        if (!isCanceled(id)) {
          toast(`角色绑定回填失败：${syncError}`, 'warning')
        }
      }

      try {
        const visualBindingResult = await persistVisualReferenceImageBinding({
          nodeId: id,
          nodeData: semanticNodeData,
          imageUrl: String(firstImage.url),
          prompt: typeof prompt === 'string' ? prompt : undefined,
          modelKey: String(selectedModel || '').trim() || undefined,
        })
        if (visualBindingResult && !isCanceled(id)) {
          const nextAnchorBindings = upsertSemanticNodeAnchorBinding({
            existing: semanticNodeData.anchorBindings,
            next: {
              kind: 'scene',
              label: visualBindingResult.refName,
              refId: visualBindingResult.refId,
              sourceBookId: visualBindingResult.sourceBookId,
              imageUrl: String(firstImage.url).trim(),
              category: visualBindingResult.category,
            },
            replaceKinds: ['scene', 'prop'],
          })
          semanticNodeData = {
            ...semanticNodeData,
            sourceBookId: visualBindingResult.sourceBookId,
            anchorBindings: nextAnchorBindings,
          }
          setNodeStatus(id, 'success', {
            visualRefId: visualBindingResult.refId,
            visualRefName: visualBindingResult.refName,
            visualRefCategory: visualBindingResult.category,
            ...(visualBindingResult.category === 'scene_prop'
              ? {
                  scenePropRefId: visualBindingResult.refId,
                  scenePropRefName: visualBindingResult.refName,
                }
              : null),
            sourceBookId: visualBindingResult.sourceBookId,
            anchorBindings: nextAnchorBindings,
          })
          appendLog(
            id,
            `[${nowLabel()}] 场景/道具参考已同步到章节元数据（book=${visualBindingResult.sourceBookId}, ref=${visualBindingResult.refName}）`,
          )
          notifyAssetRefresh()
        }
      } catch (err: any) {
        const syncError = String(err?.message || err || 'unknown')
        appendLog(id, `[${nowLabel()}] 场景/道具参考回填失败：${syncError}`)
        if (!isCanceled(id)) {
          toast(`场景/道具参考回填失败：${syncError}`, 'warning')
        }
      }

      try {
        const semanticResult = await persistSemanticAssetMetadata({
          nodeId: id,
          nodeKind: kind,
          nodeData: semanticNodeData,
          mediaKind: 'image',
          imageUrl: String(firstImage.url).trim(),
          prompt: typeof prompt === 'string' ? prompt : undefined,
        })
        if (semanticResult?.metadataSynced && semanticResult.sourceBookId) {
          appendLog(
            id,
            `[${nowLabel()}] 通用语义资产已同步到章节元数据（book=${semanticResult.sourceBookId}, semantic=${semanticResult.semanticId}）`,
          )
        } else if (semanticResult) {
          appendLog(
            id,
            `[${nowLabel()}] 通用语义资产未写入书籍 semanticAssets（bookScope=${semanticResult.bookScopeStatus}）`,
          )
        }
      } catch (err: any) {
        const syncError = String(err?.message || err || 'unknown')
        appendLog(id, `[${nowLabel()}] 通用语义资产回填失败：${syncError}`)
        if (!isCanceled(id)) {
          toast(`通用语义资产回填失败：${syncError}`, 'warning')
        }
      }
    }

    if (res?.assets && res.assets.length) {
      if (!isCanceled(id)) notifyAssetRefresh()
    }

    if (text.trim()) {
      appendLog(id, `[${nowLabel()}] AI: ${text.slice(0, 120)}`)
    } else {
      appendLog(id, `[${nowLabel()}] 文案模型调用成功`)
    }
  } catch (err: unknown) {
    const diagnosticError = buildTaskDiagnosticError(err, '图像模型调用失败')
    const { enhancedMsg } = resolveTaskErrorDisplay(err, '图像模型调用失败')
    const httpStatus = typeof diagnosticError.status === 'number' ? diagnosticError.status : null

    if (!isCanceled(id)) toast(enhancedMsg, 'error')

    setNodeStatus(id, 'error', {
      progress: 0,
      lastError: diagnosticError,
      httpStatus,
      isQuotaExceeded: false,
    })
    appendLog(id, `[${nowLabel()}] error: ${enhancedMsg}`)
  } finally {
    ctx.endRunToken(id)
  }
}
