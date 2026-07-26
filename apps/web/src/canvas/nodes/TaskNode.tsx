import React from 'react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import { Position, NodeResizeControl, NodeToolbar, useStore } from '@xyflow/react'
import { estimateTextNodeSize } from '@jarvishub/canvas-layout'
import { useRFStore } from '../store'
import { NODE_SIZE_PROFILES, getNodeSizeProfile, type NodeSizeProfile } from '../nodeSizes'
import { deriveDisplayLabel, formatAspectRatio } from '../utils/aspectRatio'
import { useUIStore } from '../../ui/uiStore'
import { ASSET_REFRESH_EVENT, notifyAssetRefresh } from '../../ui/assetEvents'
import { ActionIcon, Group, Paper, Popover, Button, Text, Stack, TextInput, Textarea, Select, Loader, Badge, Slider, Modal, Tooltip, Switch, useMantineColorScheme, useMantineTheme } from '@mantine/core'
import {
  IconAdjustments,
  IconBulb,
  IconCamera,
  IconColorSwatch,
  IconPalette,
  IconPhotoSearch,
  IconRefresh,
  IconUsers,
  IconTarget,
} from '@tabler/icons-react'
import {
  createAgentPipelineRun,
  createServerAsset,
  executeAgentPipelineRun,
  fetchPublicTaskResult,
  listProjectRoleCardAssets,
  listServerAssets,
  markDraftPromptUsed,
  recoverUploadedServerAssetFile,
  runPublicTask,
  suggestDraftPrompts,
  upsertProjectRoleCardAsset,
  updateServerAssetData,
  uploadServerAssetFile,
  createLlmNodePreset,
  listLlmNodePresets,
  type LlmNodePresetDto,
  type LlmNodePresetType,
  type PromptSampleDto,
  type ServerAssetDto,
} from '../../api/server'
import {
  getDefaultModel,
  getModelLabel,
  type ModelOption,
  type NodeKind,
} from '../../config/models'
import {
  parseImageModelCatalogConfig,
  parseVideoModelCatalogConfig,
  type ImageModelControlBinding,
  type ImageModelCatalogConfig,
  type VideoModelControlBinding,
  type VideoModelCatalogConfig,
} from '../../config/modelCatalogMeta'
import {
  getModelOptionRequestAlias,
  findModelOptionByIdentifier,
  resolveExecutableImageModel,
  useModelOptions,
} from '../../config/useModelOptions'
import { getTaskNodeCoreType, getTaskNodeSchema, normalizeTaskNodeKind } from './taskNodeSchema'
import { buildTaskNodeFeatureFlags, type TaskNodeFeatureFlags } from './taskNode/features'
import {
  applyMentionFallback,
  computeHandleLayout,
  extractTextFromTaskResult,
  genTaskNodeId,
  isDynamicHandlesConfig,
  isStaticHandlesConfig,
  MAX_VEO_REFERENCE_IMAGES,
  MAX_FRAME_ANALYSIS_SAMPLES,
  normalizeVeoReferenceUrls,
} from './taskNodeHelpers'
import { PromptSampleDrawer } from '../components/PromptSampleDrawer'
import { toast } from '../../ui/toast'
import { DEFAULT_REVERSE_PROMPT_INSTRUCTION } from '../constants'
import { CANVAS_CONFIG } from '../utils/constants'
import { resourceManager } from '../../domain/resource-runtime'
import { getPendingUploadHandlesByOwnerNodeId, useUploadRuntimeStore } from '../../domain/upload-runtime/store/uploadRuntimeStore'
import { captureFramesAtTimes } from '../../utils/videoFrameExtractor'
import { appendDownloadSuffix, downloadUrl } from '../../utils/download'
import { dedupeLocalFiles } from '../../utils/localUploadDedup'
import { normalizeOrientation, type Orientation } from '../../utils/orientation'
import { buildVideoSpecKey, normalizeVideoResolution } from '../../utils/videoSpec'
import { buildVideoDurationPatch, readVideoDurationSeconds } from '../../utils/videoDuration'
import { decideAnchorToggle } from './taskNode/anchorToggle'
import { usePoseEditor } from './taskNode/PoseEditor'
import { isPoseEditorEligibleKind } from './taskNode/poseEditorVisibility'
import { useImageViewEditor, type ImageViewEditorApplyPayload } from './taskNode/ImageViewEditor'
import { TaskNodeHandles } from './taskNode/components/TaskNodeHandles'
import { TopToolbar } from './taskNode/components/TopToolbar'
import { TaskNodeHeader } from './taskNode/components/TaskNodeHeader'
import { ControlChips } from './taskNode/components/ControlChips'
import { StatusBanner } from './taskNode/components/StatusBanner'
import { GenerationOverlay } from './taskNode/components/GenerationOverlay'
import { PromptSection, type MentionSuggestionItem } from './taskNode/components/PromptSection'
import { StructuredPromptSection } from './taskNode/components/StructuredPromptSection'
import { UpstreamReferenceStrip } from './taskNode/components/UpstreamReferenceStrip'
import { VideoContent } from './taskNode/components/VideoContent'
import { TextContent } from './taskNode/components/TextContent'
import { WebAssetBoardContent } from './taskNode/components/WebAssetBoardContent'
import { WebSectionDraftBoardContent } from './taskNode/components/WebSectionDraftBoardContent'
import {
  buildTextNodeMarkdownPatch,
  resolveTextNodePlainText,
  type TextNodeDisplaySource,
} from './taskNode/textNodeContent'
import { VeoImageModal } from './taskNode/components/VeoImageModal'
import { VideoResultModal } from './taskNode/VideoResultModal'
import { renderFeatureBlocks } from './taskNode/featureRenderers'
import { REMOTE_IMAGE_URL_REGEX, normalizeClipRange, syncDraftWithExternalValue } from './taskNode/utils'
import { runNodeRemote } from '../../runner/remoteRunner'
import {
  appendReferenceAliasSlotPrompt,
  buildAssetRefId,
  buildNamedReferenceEntries,
  mergeReferenceAssetInputs,
} from '../../runner/assetReference'
import { uploadMergedReferenceSheet } from '../../runner/referenceSheet'
import { runNodeDagToTarget } from '../../runner/dag'
import { BASE_DURATION_OPTIONS, MINIMAX_DURATION_OPTIONS, SAMPLE_OPTIONS, VEO_DURATION_OPTIONS } from './taskNode/constants'
import type { FrameSample } from './taskNode/types'
import type { PublicFlowAnchorBindingKind } from '@jarvishub/flow-anchor-bindings'
import {
  getNodeProductionMeta,
  inferProductionNodeMeta,
} from '../productionMeta'
import {
  DEFAULT_CANVAS_RESIZE_SIZE,
  DEFAULT_IMAGE_EDIT_SIZE,
  IMAGE_EDIT_SIZE_OPTIONS,
  normalizeCanvasResizeSize,
  normalizeImageEditSize,
  parseImageEditSizeDimensions,
  resolveImageEditSizeOption,
  toAspectRatioFromImageEditSize,
} from './taskNode/imageEditSize'
import { appendImageEditFocusGuidePrompt } from './taskNode/imageEditFocusGuide'
import {
  collectOrderedUpstreamReferenceItems,
  extractNodePrimaryAssetReference,
  type OrderedUpstreamReferenceItem,
} from './taskNode/upstreamReferences'
import { collectUpstreamVideoTextContext } from './taskNode/videoPromptGeneration'
import { resolveCompiledImagePrompt, resolveImagePromptExecution } from './taskNode/imagePromptSpec'
import { refineStructuredImagePrompt } from './taskNode/structuredPromptRefine'
import imageViewControlsModule from '@jarvishub/image-view-controls'
import {
  resolvePrimarySemanticAnchorBinding,
  resolveSemanticNodeRoleBinding,
  resolveSemanticNodeVisualReferenceBinding,
  upsertSemanticNodeAnchorBinding,
} from '../utils/semanticBindings'
import { useCanvasRenderContext } from '../CanvasRenderContext'
import {
  buildWebPageDocumentHtmlFromParts,
  type WebHeroMediaKind,
} from './taskNode/webHero'
import { readWebHeroRefinementAttachments } from './taskNode/webHeroTweaks'

const {
  hasActiveImageCameraControl,
  hasActiveImageLightingRig,
  normalizeImageCameraControl,
  normalizeImageLightingRig,
} = imageViewControlsModule

type Data = {
  label: string
  kind?: string
  status?: 'idle' | 'queued' | 'running' | 'success' | 'error' | 'canceled'
  progress?: number
  aiChatPlanCreatedAt?: string
  aiChatPlanIsNew?: boolean
  shotNo?: unknown
  shotIndex?: unknown
}

function buildWebHeroCurrentPageHash(input: {
  html: string
  css: string
  documentHtml: string
}): string {
  const raw = [input.html, input.css, input.documentHtml].join('\n@@\n')
  let hash = 2166136261
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `page:${(hash >>> 0).toString(36)}`
}

function rebuildWebHeroDocumentHtml(input: {
  currentDocumentHtml: string
  html: string
  css: string
}): string {
  const fallback = buildWebPageDocumentHtmlFromParts({
    html: input.html,
    css: input.css,
  })
  const currentDocumentHtml = input.currentDocumentHtml.trim()
  if (!currentDocumentHtml) return fallback
  try {
    const parser = new DOMParser()
    const documentNode = parser.parseFromString(currentDocumentHtml, 'text/html')
    const parseError = documentNode.querySelector('parsererror')
    if (parseError || !documentNode.documentElement || !documentNode.head || !documentNode.body) {
      return fallback
    }
    const styleNode = documentNode.head.querySelector('style') ?? documentNode.createElement('style')
    styleNode.textContent = input.css
    if (!styleNode.parentNode) {
      documentNode.head.appendChild(styleNode)
    }
    documentNode.body.innerHTML = input.html
    const nextDocumentHtml = ['<!doctype html>', documentNode.documentElement.outerHTML].join('\n')
    if (!/<style[\s>]/i.test(nextDocumentHtml) || !/<body[\s>]/i.test(nextDocumentHtml)) {
      return fallback
    }
    return nextDocumentHtml
  } catch {
    return fallback
  }
}

function formatImageResolutionOptionLabel(label: string, value: string): string {
  const trimmedValue = String(value || '').trim()
  const trimmedLabel = String(label || '').trim()
  return (
    trimmedLabel.endsWith('输出') && trimmedValue
      ? trimmedValue
      : trimmedLabel || trimmedValue
  )
}

type HeaderMetaBadge = {
  label: string
  color: string
  variant?: 'light' | 'outline' | 'filled'
}

type ToolbarMetaAction = {
  key: string
  label: string
  icon: JSX.Element
  onClick: () => void
  active?: boolean
}

const PRODUCTION_LAYER_LABELS: Record<string, string> = {
  evidence: '证据',
  constraints: '约束',
  anchors: '锚点',
  expansion: '扩展',
  execution: '执行',
  results: '结果',
}

const PRODUCTION_LAYER_BADGE_COLORS: Record<string, string> = {
  evidence: 'gray',
  constraints: 'indigo',
  anchors: 'teal',
  expansion: 'cyan',
  execution: 'orange',
  results: 'grape',
}

const APPROVAL_STATUS_LABELS: Record<string, string> = {
  needs_confirmation: '待确认',
  approved: '已确认',
  rejected: '已拒绝',
}

const APPROVAL_STATUS_BADGE_COLORS: Record<string, string> = {
  needs_confirmation: 'yellow',
  approved: 'green',
  rejected: 'red',
}

export type TaskNodeType = Node<Data, 'taskNode'>
type TaskNodeImageResult = {
  url: string
  title?: string
  assetId?: string | null
  assetRefId?: string | null
  assetName?: string | null
  prompt?: string
  shotNo?: number
}

function normalizePositiveSequenceNo(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value.trim())
      : Number.NaN
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.max(1, Math.trunc(numeric))
}

function resolveTaskNodeImageSequenceNo(input: {
  data?: Data
  imageResults: TaskNodeImageResult[]
  imagePrimaryIndex: number
}): number | null {
  const nodeData = input.data
  const primaryResult = input.imageResults[input.imagePrimaryIndex]
  const candidates: unknown[] = [
    nodeData?.shotNo,
    nodeData?.shotIndex,
    primaryResult?.shotNo,
    input.imageResults[0]?.shotNo,
  ]
  for (const candidate of candidates) {
    const normalized = normalizePositiveSequenceNo(candidate)
    if (normalized !== null) return normalized
  }
  return null
}

type TaskNodeVideoResult = {
  id?: string
  url: string
  thumbnailUrl?: string | null
  title?: string | null
  assetId?: string | null
  assetRefId?: string | null
  assetName?: string | null
  duration?: number
  createdAt?: string
  clipRange?: { start: number; end: number } | null
  model?: string | null
  remixTargetId?: string | null
}

const MAX_VIDEO_UPLOAD_BYTES = 30 * 1024 * 1024

function readServerAssetUrl(asset: ServerAssetDto | null | undefined): string {
  const rawData: unknown = asset?.data
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return ''
  const dataRecord = rawData as Record<string, unknown>
  return typeof dataRecord.url === 'string' ? dataRecord.url.trim() : ''
}

function isSupportedVideoUploadFile(file: File): boolean {
  const mime = typeof file.type === 'string' ? file.type.split(';')[0]?.trim().toLowerCase() || '' : ''
  if (mime.startsWith('video/')) return true
  const normalizedName = typeof file.name === 'string' ? file.name.trim().toLowerCase() : ''
  const ext = normalizedName.includes('.') ? normalizedName.split('.').pop() || '' : ''
  return ext === 'mp4' || ext === 'webm' || ext === 'mov'
}

function getVideoUploadErrorMessage(error: unknown): string {
  const message = error instanceof Error && error.message.trim() ? error.message.trim() : '上传视频失败'
  if (message.includes('413')) return '视频超过 30MB，无法上传'
  return message
}

type AdoptedAssetMetadata = {
  index: number
  url: string
  adoptedAt: string
  progress: number | null
}

type CharacterRef = {
  nodeId: string
  username: string
  displayName: string
  rawLabel: string
  source: 'character' | 'asset'
  assetUrl?: string | null
  assetId?: string | null
  assetRefId?: string | null
  assetName?: string | null
}
const EMPTY_CHARACTER_REFS: CharacterRef[] = []

function readPrimaryReferenceAssetUrl(record: Record<string, unknown>): string {
  const readUrl = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
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

function getTaskNodeModelDisplayLabel(
  option: Pick<ModelOption, 'label' | 'modelAlias' | 'modelKey' | 'value'> | null | undefined,
): string {
  const alias = typeof option?.modelAlias === 'string' ? option.modelAlias.trim() : ''
  if (alias) return alias
  const modelKey = typeof option?.modelKey === 'string' ? option.modelKey.trim() : ''
  if (modelKey) return modelKey
  const label = typeof option?.label === 'string' ? option.label.trim() : ''
  if (label) return label
  return typeof option?.value === 'string' ? option.value.trim() : ''
}

const projectRoleRefsPromiseByProjectId = new Map<string, Promise<CharacterRef[]>>()
const projectAssetMentionRefsPromiseByProjectId = new Map<string, Promise<CharacterRef[]>>()

function normalizeProjectRoleRefs(assets: readonly {
  id?: string | null
  data?: {
    roleName?: string | null
  } | null
}[]): CharacterRef[] {
  const map = new Map<string, CharacterRef>()
  for (const asset of assets) {
    const roleName = String(asset?.data?.roleName || '').trim()
    const username = toMentionUsername(roleName)
    if (!roleName || !username) continue
    const key = username.toLowerCase()
    if (map.has(key)) continue
    map.set(key, {
      nodeId: `project-role:${String(asset?.id || key)}`,
      username,
      displayName: roleName,
      rawLabel: roleName,
      source: 'character',
    })
  }
  return Array.from(map.values())
}

function normalizeProjectAssetMentionRefs(items: readonly ServerAssetDto[]): CharacterRef[] {
  const map = new Map<string, CharacterRef>()
  for (const asset of items) {
    const rawData = asset?.data
    const data = rawData && typeof rawData === 'object' && !Array.isArray(rawData)
      ? rawData as Record<string, unknown>
      : {}
    const username = toMentionUsername(data.assetRefId || asset?.id || '')
    if (!username || map.has(username.toLowerCase())) continue
    const displayName = String(data.assetName || asset?.name || '').trim() || username
    const assetUrl = readPrimaryReferenceAssetUrl(data)
    const assetId = String(asset?.id || '').trim() || null
    const assetRefId = String(data.assetRefId || '').trim() || username
    map.set(username.toLowerCase(), {
      nodeId: `project-asset:${String(asset?.id || username)}`,
      username,
      displayName,
      rawLabel: displayName,
      source: 'asset',
      assetUrl: assetUrl || null,
      assetId,
      assetRefId,
      assetName: displayName,
    })
  }
  return Array.from(map.values())
}

function loadProjectRoleRefs(projectId: string): Promise<CharacterRef[]> {
  const normalizedProjectId = String(projectId || '').trim()
  if (!normalizedProjectId) return Promise.resolve(EMPTY_CHARACTER_REFS)
  const cached = projectRoleRefsPromiseByProjectId.get(normalizedProjectId)
  if (cached) return cached
  const request = listProjectRoleCardAssets(normalizedProjectId)
    .then((assets) => normalizeProjectRoleRefs(Array.isArray(assets) ? assets : []))
    .catch((error: unknown) => {
      projectRoleRefsPromiseByProjectId.delete(normalizedProjectId)
      throw error
    })
  projectRoleRefsPromiseByProjectId.set(normalizedProjectId, request)
  return request
}

function loadProjectAssetMentionRefs(projectId: string): Promise<CharacterRef[]> {
  const normalizedProjectId = String(projectId || '').trim()
  if (!normalizedProjectId) return Promise.resolve(EMPTY_CHARACTER_REFS)
  const cached = projectAssetMentionRefsPromiseByProjectId.get(normalizedProjectId)
  if (cached) return cached
  const request = listServerAssets({ projectId: normalizedProjectId, kind: 'generation', limit: 100 })
    .then((result) => normalizeProjectAssetMentionRefs(Array.isArray(result.items) ? result.items : []))
    .catch((error: unknown) => {
      projectAssetMentionRefsPromiseByProjectId.delete(normalizedProjectId)
      throw error
    })
  projectAssetMentionRefsPromiseByProjectId.set(normalizedProjectId, request)
  return request
}

function invalidateProjectMentionRefCaches(projectId: string): void {
  const normalizedProjectId = String(projectId || '').trim()
  if (!normalizedProjectId) return
  projectRoleRefsPromiseByProjectId.delete(normalizedProjectId)
  projectAssetMentionRefsPromiseByProjectId.delete(normalizedProjectId)
}
const DEFAULT_IMAGE_ASPECT_RATIO = '16:9'
const TEXT_NODE_DEFAULT_WIDTH = NODE_SIZE_PROFILES.text.defaultW
const TEXT_NODE_MIN_WIDTH = NODE_SIZE_PROFILES.text.minW
const TEXT_NODE_MAX_WIDTH = NODE_SIZE_PROFILES.text.maxW
const TEXT_NODE_DEFAULT_HEIGHT = NODE_SIZE_PROFILES.text.defaultH
const TEXT_NODE_MIN_HEIGHT = NODE_SIZE_PROFILES.text.minH
const TEXT_NODE_MAX_HEIGHT = NODE_SIZE_PROFILES.text.maxH
const NODE_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'text',
  'image',
  'imageEdit',
  'imageFission',
  'mosaic',
  'video',
  'composeVideo',
  'audio',
  'subtitle',
  'character',
])
const toNodeKind = (value?: string): NodeKind | undefined => {
  if (!value) return undefined
  return NODE_KINDS.has(value as NodeKind) ? (value as NodeKind) : undefined
}
const areCharacterRefsEqual = (a: CharacterRef[], b: CharacterRef[]) => {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]
    const bi = b[i]
    if (ai.nodeId !== bi.nodeId) return false
    if (ai.username !== bi.username) return false
    if (ai.displayName !== bi.displayName) return false
    if (ai.rawLabel !== bi.rawLabel) return false
  }
  return true
}

const EMPTY_UPSTREAM_REFERENCE_ITEMS: OrderedUpstreamReferenceItem[] = []

type NodeResizeEndParams = {
  width?: number
  height?: number
}

type ToolbarMappedControl = {
  key: string
  binding: VideoModelControlBinding | ImageModelControlBinding
  title: string
  summary: string
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
  onChange: (value: string) => void
}

function isVideoModelControlBinding(
  binding: ToolbarMappedControl['binding'],
): binding is VideoModelControlBinding {
  return (
    binding === 'durationSeconds' ||
    binding === 'size' ||
    binding === 'resolution' ||
    binding === 'orientation' ||
    binding === 'generateAudio' ||
    binding === 'returnLastFrame'
  )
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

function normalizeImageAspect(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.toLowerCase() === 'auto') return DEFAULT_IMAGE_ASPECT_RATIO
  return raw
}

function normalizeImageSizeSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '') : ''
}

function normalizeImageResolutionSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '') : ''
}

function pickImageAspectValue(config: ImageModelCatalogConfig | null, current: string): string | null {
  if (!config) return null
  const normalizedCurrent = normalizeImageAspect(current)
  const allowed = config.aspectRatioOptions.map((option) => option.value)
  if (allowed.length) {
    if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
    if (config.defaultAspectRatio && allowed.includes(config.defaultAspectRatio)) {
      return config.defaultAspectRatio
    }
    return allowed[0] ?? null
  }
  return config.defaultAspectRatio || null
}

function pickImageSizeValue(config: ImageModelCatalogConfig | null, current: string): string | null {
  if (!config) return null
  const normalizedCurrent = normalizeImageSizeSetting(current)
  const allowed = config.imageSizeOptions.map((option) => option.value)
  if (allowed.length) {
    if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
    if (config.defaultImageSize && allowed.includes(config.defaultImageSize)) {
      return config.defaultImageSize
    }
    return allowed[0] ?? null
  }
  return config.defaultImageSize || null
}

function pickImageResolutionValue(config: ImageModelCatalogConfig | null, current: string): string | null {
  if (!config) return null
  const normalizedCurrent = normalizeImageResolutionSetting(current)
  const allowed = config.resolutionOptions.map((option) => option.value)
  if (allowed.length) {
    if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
    return allowed[0] ?? null
  }
  return null
}

function pickVideoDurationValue(config: VideoModelCatalogConfig | null, current: number): number | null {
  if (!config || !config.durationOptions.length) return null
  const allowed = config.durationOptions.map((option) => option.value)
  if (allowed.includes(current)) return current
  if (typeof config.defaultDurationSeconds === 'number' && allowed.includes(config.defaultDurationSeconds)) {
    return config.defaultDurationSeconds
  }
  return allowed[0] ?? null
}

function pickVideoSizeValue(config: VideoModelCatalogConfig | null, current: string): string | null {
  if (!config || !config.sizeOptions.length) return null
  const normalizedCurrent = current.trim().replace(/\s+/g, '')
  const allowed = config.sizeOptions.map((option) => option.value)
  if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
  if (config.defaultSize && allowed.includes(config.defaultSize)) return config.defaultSize
  return allowed[0] ?? null
}

function pickVideoResolutionValue(config: VideoModelCatalogConfig | null, current: string): string | null {
  if (!config || !config.resolutionOptions.length) return null
  const normalizedCurrent = normalizeVideoResolution(current)
  const allowed = config.resolutionOptions.map((option) => option.value)
  if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
  if (config.defaultResolution && allowed.includes(config.defaultResolution)) {
    return config.defaultResolution
  }
  return allowed[0] ?? null
}

function pickVideoOrientationValue(config: VideoModelCatalogConfig | null, current: Orientation): Orientation | null {
  if (!config || !config.orientationOptions.length) return null
  const allowed = config.orientationOptions.map((option) => option.value)
  if (allowed.includes(current)) return current
  if (config.defaultOrientation && allowed.includes(config.defaultOrientation)) return config.defaultOrientation
  return allowed[0] ?? null
}

function inferOrientationFromAspect(value: string): Orientation | null {
  const raw = value.trim()
  if (!raw) return null
  const match = raw.match(/^(\d+)\s*[:/xX]\s*(\d+)$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  return height > width ? 'portrait' : 'landscape'
}

function resolveVideoOrientationValue(params: {
  currentOrientation: unknown
  size: string
  aspect: string
  config: VideoModelCatalogConfig | null
}): Orientation {
  const normalizedSize = params.size.trim().replace(/\s+/g, '')
  const sizeRule = normalizedSize && params.config
    ? params.config.sizeOptions.find((option) => option.value === normalizedSize) || null
    : null
  if (sizeRule?.orientation) return sizeRule.orientation
  if (sizeRule?.aspectRatio) {
    const inferredFromSizeRule = inferOrientationFromAspect(sizeRule.aspectRatio)
    if (inferredFromSizeRule) return inferredFromSizeRule
  }
  const inferredFromAspect = inferOrientationFromAspect(params.aspect)
  if (inferredFromAspect) return inferredFromAspect
  if (typeof params.currentOrientation === 'string' && params.currentOrientation.trim()) {
    return normalizeOrientation(params.currentOrientation)
  }
  return 'landscape'
}

function toMentionUsername(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[，。！？、；：,.!?;:)\]】》〉'"`]+$/g, '')
    .replace(/\s+/g, '')
}

function extractPromptMentionUsernames(raw: unknown): string[] {
  const text = String(raw || '')
  if (!text) return []
  const matches = text.match(/@[^\s@]+/g) || []
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of matches) {
    const username = toMentionUsername(match)
    if (!username) continue
    const key = username.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(username)
    if (out.length >= 12) break
  }
  return out
}

type MentionRefConflictInput = {
  candidate: string
  roleRefs?: readonly CharacterRef[]
  assetRefs?: readonly CharacterRef[]
}

type MentionRefConflict = {
  kind: 'role_name_conflict' | 'asset_ref_conflict'
  mention: string
  displayName: string
}

function findMentionRefConflict(input: MentionRefConflictInput): MentionRefConflict | null {
  const mention = toMentionUsername(input.candidate)
  if (!mention) return null
  const mentionKey = mention.toLowerCase()
  const findDisplayName = (refs: readonly CharacterRef[] | undefined): string | null => {
    if (!Array.isArray(refs)) return null
    for (const ref of refs) {
      const username = toMentionUsername(ref?.username)
      if (!username || username.toLowerCase() !== mentionKey) continue
      const displayName = String(ref?.displayName || ref?.rawLabel || username).trim()
      return displayName || username
    }
    return null
  }
  const roleDisplayName = findDisplayName(input.roleRefs)
  if (roleDisplayName) {
    return {
      kind: 'role_name_conflict',
      mention,
      displayName: roleDisplayName,
    }
  }
  const assetDisplayName = findDisplayName(input.assetRefs)
  if (assetDisplayName) {
    return {
      kind: 'asset_ref_conflict',
      mention,
      displayName: assetDisplayName,
    }
  }
  return null
}

function inferNodePresetType(input: {
  isVideoNode: boolean
  hasImage: boolean
  hasImageResults: boolean
}): LlmNodePresetType {
  if (input.isVideoNode) return 'video'
  if (input.hasImage || input.hasImageResults) return 'image'
  return 'text'
}

function inferRoleNameFromTaskNode(input: { roleName?: unknown; label?: unknown; prompt?: unknown }): string {
  const explicit = String(input?.roleName || '').trim()
  if (explicit) return explicit

  const label = String(input?.label || '').trim()
  const labelPatterns = [
    /^(?:主角角色卡(?:刷新)?|角色卡|角色设定)\s*[·:：-]\s*(.+)$/i,
    /^(.+?)\s*角色卡$/i,
  ]
  for (const re of labelPatterns) {
    const m = label.match(re)
    const name = String(m?.[1] || '').trim()
    if (name) return name
  }

  const prompt = String(input?.prompt || '')
  if (prompt) {
    const lineMatch = prompt.match(/(?:^|\n)\s*角色名\s*[：:]\s*([^\n\r]+)/)
    const name = String(lineMatch?.[1] || '').trim()
    if (name) return name
  }
  return ''
}

function collectDynamicUpstreamReferenceEntriesForNode(
  nodes: Node[],
  edges: Edge[],
  targetId: string,
): Array<{ url: string; label: string; assetId?: string | null; name?: string | null }> {
  const orderedItems = collectOrderedUpstreamReferenceItems(nodes, edges, targetId)
  if (!orderedItems.length) return []
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  const out: Array<{ url: string; label: string; assetId?: string | null; name?: string | null }> = []
  const seen = new Set<string>()

  orderedItems.forEach((item) => {
    if (seen.has(item.previewUrl)) return
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
      return
    }
    const meta = extractNodePrimaryAssetReference(nodeById.get(item.sourceNodeId))
    if (meta) {
      out.push({
        url: meta.url,
        label: meta.assetRefId,
        ...(meta.assetId ? { assetId: meta.assetId } : null),
        name: meta.displayName,
      })
      return
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
  })

  return out
}

function TaskNodeInner({ id, data, selected, dragging }: NodeProps<TaskNodeType>): JSX.Element {
  const status = data?.status ?? 'idle'
  const showGenerationOverlay = status === 'running' || status === 'queued'
  const color =
    status === 'success' ? '#16a34a' :
    status === 'error' ? '#ef4444' :
    status === 'canceled' ? '#475569' :
    status === 'running' ? '#8b5cf6' :
    status === 'queued' ? '#f59e0b' : 'rgba(127,127,127,.6)'
  const statusLabel =
    status === 'success' ? '已完成' :
    status === 'error' ? '异常' :
    status === 'canceled' ? '已取消' :
    status === 'running' ? '生成中' :
    status === 'queued' ? '排队中' : '待命'
  const { colorScheme } = useMantineColorScheme()
  const theme = useMantineTheme()
  const isDarkUi = colorScheme === 'dark'
  const rgba = (color: string, alpha: number) => typeof theme.fn?.rgba === 'function' ? theme.fn.rgba(color, alpha) : color
  const accentPrimary = theme.colors.blue?.[isDarkUi ? 4 : 6] || '#4c6ef5'
  const accentSecondary = theme.colors.cyan?.[isDarkUi ? 4 : 5] || '#339CFF'
  const nodeShellBackground = isDarkUi ? 'rgba(15,20,28,0.96)' : 'rgba(255,255,255,0.98)'
  const nodeShellBorder = isDarkUi ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.08)'
  const nodeShellShadow = isDarkUi
    ? '0 18px 36px rgba(0, 0, 0, 0.5)'
    : '0 16px 32px rgba(15, 23, 42, 0.12)'
  const nodeShellGlow = '0 0 0 rgba(0, 0, 0, 0)'
  const nodeShellText = isDarkUi ? theme.white : (theme.colors.gray?.[9] || '#111321')
  const quickActionBackgroundActive = isDarkUi ? rgba(accentPrimary, 0.25) : rgba(accentPrimary, 0.12)
  const quickActionIconColor = rgba(nodeShellText, 0.55)
  const quickActionIconActive = accentPrimary
  const quickActionHint = rgba(nodeShellText, 0.55)
  const mediaOverlayBackground = isDarkUi ? 'rgba(4, 7, 16, 0.92)' : 'rgba(246, 248, 255, 0.95)'
  const mediaOverlayText = nodeShellText
  const toolbarBackground = isDarkUi ? 'rgba(4, 7, 16, 0.9)' : 'rgba(255,255,255,0.96)'
  const toolbarShadow = isDarkUi ? '0 22px 45px rgba(0,0,0,0.6)' : '0 22px 50px rgba(15,23,42,0.14)'
  const subtleOverlayBackground = isDarkUi ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.05)'
  const mediaFallbackSurface = isDarkUi ? 'rgba(3,6,12,0.92)' : 'rgba(244,247,255,0.95)'
  const mediaFallbackText = isDarkUi ? rgba(theme.colors.gray?.[4] || '#94a3b8', 0.85) : rgba(theme.colors.gray?.[6] || '#64748b', 0.85)
  const videoSurface = isDarkUi ? 'rgba(11, 16, 28, 0.9)' : 'rgba(236, 241, 255, 0.9)'
  const inlineDividerColor = rgba(nodeShellText, 0.12)
  const sleekChipBorderColor = rgba(nodeShellText, 0.08)
  const toolbarButtonBorderColor = rgba(nodeShellText, 0.12)
  const summaryChipStyles = React.useMemo(() => ({
    borderRadius: 999,
    background: isDarkUi ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)',
    color: nodeShellText,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    fontWeight: 600,
    fontSize: 12,
    height: 30,
    lineHeight: 1.1,
    letterSpacing: 0.25,
  }), [isDarkUi, nodeShellText])
  const controlValueStyle = React.useMemo(() => ({
    fontSize: 12,
    fontWeight: 600,
    color: nodeShellText,
  }), [nodeShellText])
  const sleekChipBase = React.useMemo(() => ({
    padding: '6px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 500,
    color: nodeShellText,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    borderRadius: 999,
    background: isDarkUi ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
  }), [isDarkUi, nodeShellText, sleekChipBorderColor])
  const toolbarActionIconStyles = React.useMemo(() => ({
    root: {
      width: 32,
      height: 32,
      borderRadius: 12,
      background: isDarkUi ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
      color: nodeShellText,
      padding: 0,
    },
    icon: {
      fontSize: 16,
    },
  }), [isDarkUi, nodeShellText, toolbarButtonBorderColor])
  const galleryCardBackground = isDarkUi ? 'rgba(7,12,24,0.96)' : 'rgba(255,255,255,0.96)'

  const placeholderIconColor = nodeShellText
  const iconBadgeBackground = isDarkUi ? rgba(accentPrimary, 0.2) : rgba(accentPrimary, 0.12)
  const iconBadgeShadow = isDarkUi ? '0 10px 20px rgba(0,0,0,0.35)' : '0 10px 20px rgba(15,23,42,0.1)'
  const darkContentBackground = isDarkUi ? 'rgba(9,13,20,0.92)' : 'rgba(246,248,255,0.95)'
  const darkCardShadow = isDarkUi ? '0 12px 24px rgba(0, 0, 0, 0.4)' : '0 12px 24px rgba(15, 23, 42, 0.1)'
  const lightContentBackground = isDarkUi ? 'rgba(9,14,28,0.3)' : 'rgba(227,235,255,0.7)'

  const kind = normalizeTaskNodeKind(typeof data?.kind === 'string' ? data.kind : null) || 'text'
  const coreKind = getTaskNodeCoreType(kind)
  const productionMeta = React.useMemo(
    () => getNodeProductionMeta({ type: 'taskNode', data }),
    [data],
  )
  const schema = React.useMemo(() => getTaskNodeSchema(kind), [kind])
  const NodeIcon = schema.icon
  const featureFlags = React.useMemo<TaskNodeFeatureFlags>(
    () => buildTaskNodeFeatureFlags(schema, kind),
    [schema, kind],
  )
  const {
    isComposerNode,
    isMosaicNode,
    hasImage,
    hasImageResults,
    hasAnchorBinding,
    hasImageUpload: supportsImageUpload,
    hasReversePrompt: supportsReversePrompt,
    hasVideo,
    hasVideoUpload: supportsVideoUpload,
    hasVideoResults,
    hasAudio: isAudioNode,
    hasSubtitle: isSubtitleNode,
    hasCharacter: isCharacterNode,
    hasSystemPrompt,
    hasModelSelect,
    hasSampleCount,
    hasAspect,
    hasImageSize,
    hasOrientation,
    hasDuration,
    hasTextResults,
    supportsSubflowHandles,
  } = featureFlags
  const isPlainTextNode = coreKind === 'text'
  const isWebAssetBoardItem = typeof (data as any)?.webPageAssetBoardSection === 'string'
    && typeof (data as any)?.webPageAssetBoardForNodeId === 'string'
  const isWebAssetBoardDisplay = (data as any)?.webPageAssetBoardDisplay === true
    && typeof (data as any)?.webPageAssetBoardForNodeId === 'string'
  const isWebSectionDraftBoardDisplay = (data as any)?.webPageSectionDraftsDisplay === true
    && typeof (data as any)?.webPageSectionDraftsForNodeId === 'string'
  const isVideoNode = coreKind === 'video'
  const isWebHeroNode = kind === 'webHero'
  const isPptDeckNode = kind === 'pptDeck'
  const isOrdinaryTextNode = isPlainTextNode
    && !isWebAssetBoardItem
    && !isWebAssetBoardDisplay
    && !isWebSectionDraftBoardDisplay
    && !isWebHeroNode
    && !isPptDeckNode
  const presetType = React.useMemo<LlmNodePresetType>(
    () => inferNodePresetType({ isVideoNode, hasImage, hasImageResults }),
    [hasImage, hasImageResults, isVideoNode],
  )
  const targets: { id: string; type: string; pos: Position }[] = []
  const sources: { id: string; type: string; pos: Position }[] = []
  const schemaHandles = schema.handles
  if (isDynamicHandlesConfig(schemaHandles)) {
    if (supportsSubflowHandles) {
      const io = (data as any)?.io as {
        inputs?: { id: string; type: string; label?: string }[]
        outputs?: { id: string; type: string; label?: string }[]
      } | undefined
      if (io?.inputs?.length) {
        io.inputs.forEach((p) => targets.push({ id: `in-${p.type}`, type: p.type, pos: Position.Left }))
      }
      if (io?.outputs?.length) {
        io.outputs.forEach((p) => sources.push({ id: `out-${p.type}`, type: p.type, pos: Position.Right }))
      }
    }
  } else if (isStaticHandlesConfig(schemaHandles)) {
    schemaHandles.targets?.forEach((handle) => {
      targets.push({
        id: handle.id,
        type: handle.type,
        pos: handle.position ?? Position.Left,
      })
    })
    schemaHandles.sources?.forEach((handle) => {
      sources.push({
        id: handle.id,
        type: handle.type,
        pos: handle.position ?? Position.Right,
      })
    })
  } else {
    targets.push({ id: 'in-any', type: 'any', pos: Position.Left })
    sources.push({ id: 'out-any', type: 'any', pos: Position.Right })
  }
  const handleLayoutMap = computeHandleLayout([...targets, ...sources])
  const wideHandleBase: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
    width: 16,
    height: 'calc(100% - 12px)',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    border: '1px dashed rgba(255,255,255,0.12)',
    background: 'transparent',
    opacity: 0,
    boxShadow: 'none',
  }
  const defaultInputType = targets[0]?.type || 'any'
  const defaultOutputType = sources[0]?.type || 'any'

  const [editing, setEditing] = React.useState(false)
  const updateNodeLabel = useRFStore(s => s.updateNodeLabel)
  const openSubflow = useUIStore(s => s.openSubflow)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const currentProject = useUIStore(s => s.currentProject)
  const openWebCutVideoEditModal = useUIStore(s => s.openWebCutVideoEditModal)
  const edgeRoute = useUIStore(s => s.edgeRoute)
  const viewOnly = useUIStore(s => s.viewOnly)
  const canvasReferencePicker = useUIStore(s => s.canvasReferencePicker)
  const openCanvasReferencePicker = useUIStore(s => s.openCanvasReferencePicker)
  const closeCanvasReferencePicker = useUIStore(s => s.closeCanvasReferencePicker)
  const syncCreationSessionCheckpoint = useUIStore(s => s.syncCreationSessionCheckpoint)
  const failCreationSession = useUIStore(s => s.failCreationSession)
  const runSelected = useRFStore(s => s.runSelected)
  const cancelNodeExecution = useRFStore(s => s.cancelNode)
  const setNodeStatus = useRFStore(s => s.setNodeStatus)
  const updateNodeData = useRFStore(s => s.updateNodeData)
  const deleteEdge = useRFStore(s => s.deleteEdge)
  const appendLog = useRFStore(s => s.appendLog)
  const addNode = useRFStore(s => s.addNode)
  const aiSessionRunningSlot = useRFStore(s => s.aiSessionRunningByNode[id])
  const isAiSessionRunning = !!aiSessionRunningSlot && Object.keys(aiSessionRunningSlot).length > 0
  const rawPrompt = (data as any)?.prompt as string | undefined
  const imagePromptExecutionState = React.useMemo(() => {
    try {
      return {
        execution: resolveImagePromptExecution(data),
        errorMessage: '',
      }
    } catch (error) {
      return {
        execution: {
          prompt: rawPrompt || '',
          structuredPrompt: null,
          normalizedFromLegacy: false,
          mode: 'text' as const,
        },
        errorMessage: error instanceof Error ? error.message : 'structuredPrompt 解析失败',
      }
    }
  }, [data, rawPrompt])
  const canUseStructuredPromptEditor = coreKind === 'image'
  const isStructuredPromptMode = canUseStructuredPromptEditor && imagePromptExecutionState.execution.mode === 'structured'
  const structuredPromptValue = imagePromptExecutionState.execution.structuredPrompt
  const structuredPromptErrorMessage = imagePromptExecutionState.errorMessage
  const [prompt, setPrompt] = React.useState<string>(rawPrompt || '')
  const [structuredPromptRefineLoading, setStructuredPromptRefineLoading] = React.useState(false)
  // 当节点数据中的 prompt 发生变化（例如由 AI 自动生成）时，同步到本地输入框状态
  React.useEffect(() => {
    if (typeof rawPrompt === 'string' && rawPrompt !== prompt) {
      setPrompt(rawPrompt)
    }
  }, [rawPrompt])
  const textFontSize = Math.max(12, Math.min(48, Number((data as any)?.textFontSize) || 16))
  const textFontWeight = Math.max(300, Math.min(800, Number((data as any)?.textFontWeight) || 500))
  const textColor = String((data as any)?.textColor || (isDarkUi ? '#f8fafc' : '#0f172a'))
  const textBackgroundColor = String((data as any)?.textBackgroundColor || (isDarkUi ? 'rgba(12,17,28,0.88)' : 'rgba(248,250,255,0.95)'))
  const [aspect, setAspect] = React.useState<string>(normalizeImageAspect((data as any)?.aspect))
  const [imageSize, setImageSize] = React.useState<string>((data as any)?.imageSize || '2K')
  const [imageResolution, setImageResolution] = React.useState<string>(
    normalizeImageResolutionSetting((data as any)?.imageResolution ?? (data as any)?.resolution ?? ''),
  )
  const [imageEditSize, setImageEditSize] = React.useState<string>(() =>
    kind === 'imageEdit'
      ? normalizeImageEditSize((data as Record<string, unknown>)?.imageEditSize ?? (data as Record<string, unknown>)?.size)
      : DEFAULT_IMAGE_EDIT_SIZE,
  )
  const [canvasResizeSize, setCanvasResizeSize] = React.useState<string>(() =>
    normalizeCanvasResizeSize((data as Record<string, unknown>)?.canvasResizeSize ?? DEFAULT_CANVAS_RESIZE_SIZE),
  )
  const [scale, setScale] = React.useState<number>((data as any)?.scale || 1)
  const [sampleCount, setSampleCount] = React.useState<number>((data as any)?.sampleCount || 1)
  const rawSystemPrompt = (data as any)?.systemPrompt as string | undefined
  const [systemPrompt, setSystemPrompt] = React.useState<string>(() => {
    if (typeof rawSystemPrompt === 'string' && rawSystemPrompt.trim().length > 0) {
      return rawSystemPrompt
    }
    return '你是一个提示词优化助手。请在保持核心意图不变的前提下，把下面的提示词补全为更具体、更可执行的版本；优先明确主体数量、空间关系、前中后景、镜头与构图、光线与材质细节。除非用户明确要求精简，否则不要主动缩短；避免引入血腥、残酷暴力或肢解等直观血腥描写，可用暗示和留白代替。'
  })

  const rawShowSystemPrompt = (data as any)?.showSystemPrompt as boolean | undefined
  const [showSystemPrompt, setShowSystemPrompt] = React.useState<boolean>(() => {
    if (typeof rawShowSystemPrompt === 'boolean') return rawShowSystemPrompt
    // 默认关闭系统提示词，由用户手动开启
    return false
  })

  React.useEffect(() => {
    if (typeof rawSystemPrompt === 'string') {
      setSystemPrompt(rawSystemPrompt)
    }
  }, [rawSystemPrompt])

  React.useEffect(() => {
    if (typeof rawShowSystemPrompt === 'boolean' && rawShowSystemPrompt !== showSystemPrompt) {
      setShowSystemPrompt(rawShowSystemPrompt)
    }
  }, [rawShowSystemPrompt, showSystemPrompt])

  React.useEffect(() => {
    if (typeof rawSystemPrompt !== 'string' || !rawSystemPrompt.trim()) {
      if (systemPrompt && systemPrompt.trim()) {
        updateNodeData(id, { systemPrompt })
      }
    }
  }, [id, updateNodeData])

  const handleSystemPromptChange = React.useCallback(
    (next: string) => {
      setSystemPrompt(next)
      updateNodeData(id, { systemPrompt: next })
    },
    [id, updateNodeData],
  )

  const handleSystemPromptToggle = React.useCallback(
    (next: boolean) => {
      setShowSystemPrompt(next)
      updateNodeData(id, { showSystemPrompt: next })
    },
    [id, updateNodeData],
  )
  const edgesForCharacters = useRFStore(s => s.edges)
  const fileRef = React.useRef<HTMLInputElement|null>(null)
  const imageUrl = (data as any)?.imageUrl as string | undefined
  const nodeHasUploadIntent = useUploadRuntimeStore(
    React.useCallback((state) => state.activeNodeImageUploadIds.includes(id), [id]),
  )
  const nodePendingUploadCount = useUploadRuntimeStore(
    React.useCallback(
      (state) => {
        void state.handlesById
        return getPendingUploadHandlesByOwnerNodeId(id).length
      },
      [id],
    ),
  )
  const nodeHasPendingUploads = nodePendingUploadCount > 0
  const isUploadingImage = nodeHasUploadIntent || nodeHasPendingUploads
  const [reversePromptLoading, setReversePromptLoading] = React.useState(false)
  const poseStickmanUrl = (data as any)?.poseStickmanUrl as string | undefined
  const poseReferenceImages = (data as any)?.poseReferenceImages as string[] | undefined
  const imageResults = React.useMemo<TaskNodeImageResult[]>(() => {
    const raw = (data as any)?.imageResults as Array<Record<string, unknown>> | undefined
    if (raw && Array.isArray(raw) && raw.length > 0) {
      return raw.map((item) => ({
        url: typeof item.url === 'string' ? item.url : '',
        title: typeof item.title === 'string' ? item.title : undefined,
        assetId: typeof item.assetId === 'string' && item.assetId.trim() ? item.assetId.trim() : null,
        assetRefId: typeof item.assetRefId === 'string' && item.assetRefId.trim() ? item.assetRefId.trim() : null,
        assetName: typeof item.assetName === 'string' && item.assetName.trim() ? item.assetName.trim() : undefined,
        prompt: typeof item.prompt === 'string' ? item.prompt : undefined,
        shotNo: typeof item.shotNo === 'number' && Number.isFinite(item.shotNo) ? Math.max(1, Math.trunc(item.shotNo)) : undefined,
      }))
        .filter((item) => item.url.trim().length > 0)
    }
    const single = imageUrl || null
    return single ? [{ url: single }] : []
  }, [data, imageUrl])
  const persistedImagePrimaryIndexRaw = (data as any)?.imagePrimaryIndex
  const persistedImagePrimaryIndex =
    typeof persistedImagePrimaryIndexRaw === 'number' ? persistedImagePrimaryIndexRaw : null
  const [imageExpanded, setImageExpanded] = React.useState(false)
  const [imagePrimaryIndex, setImagePrimaryIndex] = React.useState<number>(() =>
    persistedImagePrimaryIndex !== null ? persistedImagePrimaryIndex : 0,
  )
  const [imageSelectedIndex, setImageSelectedIndex] = React.useState(0)
  const hasPrimaryImage = React.useMemo(
    () => imageResults.some((img) => typeof img?.url === 'string' && img.url.trim().length > 0),
    [imageResults]
  )
  const primaryImageUrl = React.useMemo(() => {
    if (!hasPrimaryImage) return null
    const current = imageResults[imagePrimaryIndex]?.url
    if (typeof current === 'string' && current.trim().length > 0) {
      return current
    }
    const fallback = imageResults.find((img) => typeof img?.url === 'string' && img.url.trim().length > 0)
    return fallback?.url ?? null
  }, [hasPrimaryImage, imagePrimaryIndex, imageResults])
  const adoptedImageMetadata = React.useMemo<AdoptedAssetMetadata | null>(() => {
    const raw = (data as { adoptedImageAsset?: unknown } | undefined)?.adoptedImageAsset
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const candidate = raw as Record<string, unknown>
    const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''
    if (!url) return null
    const rawIndex = typeof candidate.index === 'number' && Number.isFinite(candidate.index) ? Math.max(0, Math.trunc(candidate.index)) : -1
    const resolvedIndex = imageResults[rawIndex]?.url === url
      ? rawIndex
      : imageResults.findIndex((item) => item.url === url)
    if (resolvedIndex < 0) return null
    return {
      index: resolvedIndex,
      url,
      adoptedAt: typeof candidate.adoptedAt === 'string' ? candidate.adoptedAt : '',
      progress: typeof candidate.progress === 'number' && Number.isFinite(candidate.progress) ? candidate.progress : null,
    }
  }, [data, imageResults])
  const adoptedImageIndex = adoptedImageMetadata?.index ?? null
  const isPrimaryImageAdopted = adoptedImageIndex !== null && adoptedImageIndex === imagePrimaryIndex
  const [assetBindingId, setAssetBindingId] = React.useState<string>(() => {
    const explicit = String((data as any)?.assetRefId || '').trim()
    if (explicit) return explicit
    const primaryImage = Array.isArray((data as any)?.imageResults) ? (data as any).imageResults[0] : null
    const primaryVideo = Array.isArray((data as any)?.videoResults) ? (data as any).videoResults[0] : null
    return String(primaryImage?.assetRefId || primaryVideo?.assetRefId || (data as any)?.assetId || '').trim()
  })
  const primarySemanticAnchor = React.useMemo(() => resolvePrimarySemanticAnchorBinding(data), [data])
  const semanticRoleBinding = React.useMemo(() => resolveSemanticNodeRoleBinding(data), [data])
  const [anchorBindingKind, setAnchorBindingKind] = React.useState<PublicFlowAnchorBindingKind>(
    () => primarySemanticAnchor?.kind || 'character',
  )
  const [anchorBindingLabel, setAnchorBindingLabel] = React.useState<string>(
    () => String(primarySemanticAnchor?.label || resolveSemanticNodeRoleBinding(data).roleName || '').trim(),
  )
  const [bindAnchorLoading, setBindAnchorLoading] = React.useState(false)
  const autoRoleResolvedRef = React.useRef<string>('')
  const lastAnchorBindingExternalLabelRef = React.useRef<string>(
    String(primarySemanticAnchor?.label || resolveSemanticNodeRoleBinding(data).roleName || '').trim(),
  )
  const lastAnchorBindingExternalKindRef = React.useRef<PublicFlowAnchorBindingKind>(
    primarySemanticAnchor?.kind || 'character',
  )
  const rawRoleName = String(semanticRoleBinding.roleName || '').trim()
  const rawAnchorLabel = String(primarySemanticAnchor?.label || rawRoleName || '').trim()
  const inferredRoleName = React.useMemo(() => inferRoleNameFromTaskNode({
    roleName: semanticRoleBinding.roleName,
    label: (data as any)?.label,
    prompt: (data as any)?.prompt,
  }), [semanticRoleBinding.roleName, (data as any)?.label, (data as any)?.prompt])

  React.useEffect(() => {
    const nextDraft = syncDraftWithExternalValue({
      previousExternalValue: lastAnchorBindingExternalLabelRef.current,
      nextExternalValue: rawAnchorLabel,
      currentDraft: anchorBindingLabel,
    })
    lastAnchorBindingExternalLabelRef.current = rawAnchorLabel
    if (nextDraft !== anchorBindingLabel) {
      setAnchorBindingLabel(nextDraft)
    }
  }, [anchorBindingLabel, rawAnchorLabel])

  React.useEffect(() => {
    const nextKind = primarySemanticAnchor?.kind || 'character'
    if (lastAnchorBindingExternalKindRef.current !== nextKind) {
      lastAnchorBindingExternalKindRef.current = nextKind
      setAnchorBindingKind(nextKind)
    }
  }, [primarySemanticAnchor?.kind])

  React.useEffect(() => {
    const rawImageResults = Array.isArray((data as any)?.imageResults) ? (data as any).imageResults : []
    const rawVideoResults = Array.isArray((data as any)?.videoResults) ? (data as any).videoResults : []
    const primaryImage = rawImageResults[0] || null
    const primaryVideo = rawVideoResults[0] || null
    const nextBindingId =
      String((data as any)?.assetRefId || '').trim() ||
      String(primaryImage?.assetRefId || primaryVideo?.assetRefId || (data as any)?.assetId || '').trim()
    if (nextBindingId && nextBindingId !== assetBindingId) {
      setAssetBindingId(nextBindingId)
    }
  }, [assetBindingId, data])

  React.useEffect(() => {
    if (!inferredRoleName) return
    if (!anchorBindingLabel.trim()) {
      setAnchorBindingLabel(inferredRoleName)
    }
    if (!rawRoleName) {
      updateNodeData(id, {
        roleName: inferredRoleName,
        anchorBindings: upsertSemanticNodeAnchorBinding({
          existing: (data as Record<string, unknown>)?.anchorBindings,
          next: {
            kind: 'character',
            label: inferredRoleName,
            sourceBookId: String((data as Record<string, unknown>)?.sourceBookId || '').trim() || null,
          },
        }),
      })
    }
  }, [anchorBindingLabel, data, id, inferredRoleName, rawRoleName, updateNodeData])

  React.useEffect(() => {
    const projectId = String(currentProject?.id || '').trim()
    const roleNameRaw = inferRoleNameFromTaskNode({
      roleName: semanticRoleBinding.roleName,
      label: (data as any)?.label,
      prompt: (data as any)?.prompt,
    })
    const roleName = roleNameRaw.trim()
    const promptMentionUsernames = extractPromptMentionUsernames((data as any)?.prompt)
    if (!projectId || (!roleName && promptMentionUsernames.length === 0)) return

    const existingRoleId = String(semanticRoleBinding.roleId || '').trim()
    const existingRoleCardId = String(semanticRoleBinding.roleCardId || '').trim()
    const mentionKey = promptMentionUsernames.map((item) => item.toLowerCase()).join(',')
    const refKey = `${projectId}::${roleName.toLowerCase()}::${mentionKey}::${existingRoleId}::${existingRoleCardId}`
    if (autoRoleResolvedRef.current === refKey) return
    autoRoleResolvedRef.current = refKey

    let canceled = false
    ;(async () => {
      try {
        const cards = await listProjectRoleCardAssets(projectId)
        if (canceled || !Array.isArray(cards)) return
        const mentionMatchedCards = promptMentionUsernames.length
          ? cards.filter((asset) => {
              const card = asset?.data || {}
              const roleNameCandidate = toMentionUsername(card?.roleName)
              const hasGenerated = String(card?.status || '').toLowerCase() === 'generated'
              return !!roleNameCandidate && hasGenerated && promptMentionUsernames.some((item) => item.toLowerCase() === roleNameCandidate.toLowerCase())
            })
          : []
        const matchedCards = cards
          .filter((asset) => {
            const card = asset?.data || {}
            const byId = existingRoleId && String(card?.roleId || '').trim() === existingRoleId
            const byCardId = existingRoleCardId && String(card?.cardId || asset?.id || '').trim() === existingRoleCardId
            const byName = roleName && String(card?.roleName || '').trim().toLowerCase() === roleName.toLowerCase()
            const hasGenerated = String(card?.status || '').toLowerCase() === 'generated'
            if (!hasGenerated) return false
            return byId || byCardId || byName
          })
          .sort((a, b) => {
            const ac = a?.data || {}
            const bc = b?.data || {}
            const ap = Boolean(ac.cardId && existingRoleCardId && String(ac.cardId).trim() === existingRoleCardId)
            const bp = Boolean(bc.cardId && existingRoleCardId && String(bc.cardId).trim() === existingRoleCardId)
            if (ap !== bp) return (bp ? 1 : 0) - (ap ? 1 : 0)
            const at = Date.parse(String(ac?.updatedAt || a?.updatedAt || ''))
            const bt = Date.parse(String(bc?.updatedAt || b?.updatedAt || ''))
            return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0)
          })
        const bestCard =
          matchedCards[0] ||
          (mentionMatchedCards.length === 1 ? mentionMatchedCards[0] || null : null)
        const resolvedRoleName =
          roleName ||
          (mentionMatchedCards.length === 1
            ? String(mentionMatchedCards[0]?.data?.roleName || '').trim()
            : '')
        if (!bestCard && !resolvedRoleName) return
        const bestData = bestCard?.data || {}
        const roleId = String(bestData?.roleId || existingRoleId || '').trim()
        const roleCardId = String(bestData?.cardId || bestCard?.id || existingRoleCardId || '').trim()
        const roleImage = String(bestData?.threeViewImageUrl || bestData?.imageUrl || '').trim()
        const patch: Record<string, unknown> = {}
        if (resolvedRoleName && !String(semanticRoleBinding.roleName || '').trim()) patch.roleName = resolvedRoleName
        if (roleId && !existingRoleId) patch.roleId = roleId
        if (roleCardId && !existingRoleCardId) patch.roleCardId = roleCardId
        if (
          roleImage &&
          !Array.isArray((data as any)?.roleCardReferenceImages)
        ) {
          patch.roleCardReferenceImages = [roleImage]
        }
        if (roleImage) {
          const currentImageUrl = String((data as any)?.imageUrl || '').trim()
          const currentImageResults = Array.isArray((data as any)?.imageResults) ? (data as any).imageResults : []
          if (!currentImageUrl && currentImageResults.length === 0) {
            patch.imageUrl = roleImage
            patch.imageResults = [{ url: roleImage }]
            patch.imagePrimaryIndex = 0
            patch.status = 'success'
          }
        }
        if (resolvedRoleName || roleCardId || roleId || roleImage) {
          patch.anchorBindings = upsertSemanticNodeAnchorBinding({
            existing: (data as Record<string, unknown>)?.anchorBindings,
            next: {
              kind: 'character',
              label: resolvedRoleName || rawRoleName || null,
              refId: roleCardId || null,
              entityId: roleId || null,
              imageUrl: roleImage || null,
              sourceBookId: String((data as Record<string, unknown>)?.sourceBookId || '').trim() || null,
              referenceView: 'three_view',
            },
          })
        }
        if (Object.keys(patch).length > 0) {
          updateNodeData(id, patch)
        }
      } catch {
        // ignore auto-bind failures; manual bind remains available
      }
    })()

    return () => {
      canceled = true
    }
  }, [currentProject?.id, data, id, semanticRoleBinding.roleCardId, semanticRoleBinding.roleId, semanticRoleBinding.roleName, updateNodeData])

  const primaryImageForAnchorBinding = React.useMemo(() => {
    const fromResults =
      imageResults[imagePrimaryIndex] && typeof imageResults[imagePrimaryIndex].url === 'string'
        ? String(imageResults[imagePrimaryIndex].url).trim()
        : ''
    const fromNode = typeof (data as any)?.imageUrl === 'string' ? String((data as any).imageUrl).trim() : ''
    return fromResults || fromNode || ''
  }, [data, imagePrimaryIndex, imageResults])

  const anchorBindStatusText = React.useMemo(() => {
    const anchorKind = String(primarySemanticAnchor?.kind || '').trim()
    const anchorLabel = String(primarySemanticAnchor?.label || '').trim()
    const anchorRefId = String(primarySemanticAnchor?.refId || '').trim()
    if (!anchorKind && !anchorLabel && !anchorRefId) return ''
    const anchorKindLabel =
      anchorKind === 'character'
        ? '角色'
        : anchorKind === 'scene'
          ? '场景'
          : anchorKind === 'prop'
            ? '道具'
            : anchorKind === 'shot'
              ? '镜头'
              : anchorKind === 'story'
                ? '剧情'
                : anchorKind === 'asset'
                  ? '资产'
                  : anchorKind === 'context'
                    ? '上下文'
                    : anchorKind
    const parts: string[] = []
    if (anchorKindLabel) parts.push(`当前锚点：${anchorKindLabel}`)
    if (anchorLabel) parts.push(`名称：${anchorLabel}`)
    if (primarySemanticAnchor?.referenceView === 'three_view') parts.push('参考视图：三视图')
    if (anchorRefId) parts.push(`引用ID：${anchorRefId}`)
    return parts.join(' · ')
  }, [primarySemanticAnchor])

  const legacyImagePrimaryIndex = React.useMemo(() => {
    if (!imageUrl) return null
    const match = imageResults.findIndex((img) => img?.url === imageUrl)
    return match >= 0 ? match : null
  }, [imageUrl, imageResults])

  React.useEffect(() => {
    const total = imageResults.length
    if (total === 0) {
      setImagePrimaryIndex(0)
      return
    }
    if (persistedImagePrimaryIndex !== null) {
      const clamped = Math.max(0, Math.min(total - 1, persistedImagePrimaryIndex))
      setImagePrimaryIndex((prev) => (prev === clamped ? prev : clamped))
      return
    }
    if (legacyImagePrimaryIndex !== null) {
      const clamped = Math.max(0, Math.min(total - 1, legacyImagePrimaryIndex))
      setImagePrimaryIndex((prev) => (prev === clamped ? prev : clamped))
      return
    }
    setImagePrimaryIndex((prev) => Math.max(0, Math.min(total - 1, prev)))
  }, [persistedImagePrimaryIndex, legacyImagePrimaryIndex, imageResults.length])

  const onReversePrompt = React.useCallback(async () => {
    if (!supportsReversePrompt) return

    const targetUrl = (
      primaryImageUrl ||
      imageResults[imagePrimaryIndex]?.url ||
      imageResults[0]?.url ||
      imageUrl ||
      ''
    ).trim()
    if (!targetUrl) {
      toast('请先上传或生成图片', 'error')
      return
    }

    try {
      setReversePromptLoading(true)
      const ui = useUIStore.getState()
      const resolveRemoteImageUrl = async (raw: string): Promise<{ url: string; assetId?: string } | null> => {
        const normalized = (raw || '').trim()
        if (!normalized) return null
        if (REMOTE_IMAGE_URL_REGEX.test(normalized)) {
          return { url: normalized }
        }
        if (normalized.startsWith('blob:')) {
          try {
            const res = await fetch(normalized)
            if (!res.ok) return null
            const blob = await res.blob()
            const mime = blob.type || 'image/png'
            const ext = mime.includes('jpeg') || mime.includes('jpg')
              ? 'jpg'
              : mime.includes('webp')
                ? 'webp'
                : 'png'
            const fileName = `reverse-${Date.now()}.${ext}`
            const file = new File([blob], fileName, { type: mime })
            const hosted = await uploadServerAssetFile(file, fileName, { taskKind: 'image_to_prompt' })
            const url = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
            if (!url) return null
            return { url, assetId: hosted.id }
          } catch {
            return null
          }
        }
        // 禁止 data:*;base64,... 进入后端：必须先托管到 OSS 后再使用 URL
        return null
      }

      const resolved = await resolveRemoteImageUrl(targetUrl)
      if (!resolved?.url) {
        const hint = targetUrl.startsWith('blob:')
          ? '本地图片需要先上传到 OSS 才能反推提示词'
          : '反推提示词仅支持 http(s) 图片链接（请先上传到 OSS）'
        toast(hint, 'error')
        return
      }
      if (resolved.assetId) {
        updateNodeData(id, { imageUrl: resolved.url, serverAssetId: resolved.assetId })
      }
      const persist = ui.assetPersistenceEnabled
      const taskRes = await runPublicTask({
        request: {
          kind: 'image_to_prompt',
          prompt: DEFAULT_REVERSE_PROMPT_INSTRUCTION,
          extras: {
            imageUrl: resolved.url,
            nodeId: id,
            persistAssets: persist,
          },
        },
      })
      const nextPrompt = extractTextFromTaskResult(taskRes.result)
      if (nextPrompt) {
        setPrompt(nextPrompt)
        updateNodeData(id, { prompt: nextPrompt })
        toast('已根据图片生成提示词', 'success')
      } else {
        toast('模型未返回提示词，请稍后重试', 'error')
      }
    } catch (error: any) {
      const message = typeof error?.message === 'string' ? error.message : '反推提示词失败'
      toast(message, 'error')
    } finally {
      setReversePromptLoading(false)
    }
  }, [supportsReversePrompt, primaryImageUrl, imageResults, imagePrimaryIndex, imageUrl, id, updateNodeData, setPrompt])

  const basePoseImage = React.useMemo(
    () => primaryImageUrl || imageResults[imagePrimaryIndex]?.url || imageResults[0]?.url || '',
    [imagePrimaryIndex, imageResults, primaryImageUrl],
  )

  const videoUrl = ((data as any)?.videoUrl as string | undefined) ?? null
  const videoThumbnailUrl = ((data as any)?.videoThumbnailUrl as string | undefined) ?? null
  const videoTitle = ((data as any)?.videoTitle as string | undefined) ?? null
  const videoTokenId = ((data as any)?.videoTokenId as string | undefined) || null
  const [videoPromptGenerationLoading, setVideoPromptGenerationLoading] = React.useState(false)

  // Video history results (similar to imageResults)
  const videoResults = React.useMemo<TaskNodeVideoResult[]>(() => {
    const raw = (data as any)?.videoResults as TaskNodeVideoResult[] | undefined
    if (raw && Array.isArray(raw) && raw.length > 0) {
      return raw.map((item): TaskNodeVideoResult => ({
        ...item,
        assetId: typeof item?.assetId === 'string' && item.assetId.trim() ? item.assetId.trim() : null,
        assetRefId: typeof item?.assetRefId === 'string' && item.assetRefId.trim() ? item.assetRefId.trim() : null,
        assetName: typeof item?.assetName === 'string' && item.assetName.trim() ? item.assetName.trim() : null,
        clipRange: normalizeClipRange(item?.clipRange),
      }))
    }
    const single = videoUrl
      ? {
          url: videoUrl,
          thumbnailUrl: videoThumbnailUrl,
          title: videoTitle,
          duration: (data as any)?.videoDuration,
          clipRange: normalizeClipRange((data as any)?.clipRange),
          remixTargetId: (data as any)?.remixTargetId || null,
        }
      : null
    return single ? [single] : []
  }, [data, videoUrl, videoThumbnailUrl, videoTitle])

  const persistedVideoPrimaryIndexRaw = (data as any)?.videoPrimaryIndex
  const persistedVideoPrimaryIndex = typeof persistedVideoPrimaryIndexRaw === 'number' ? persistedVideoPrimaryIndexRaw : null
  const [videoExpanded, setVideoExpanded] = React.useState(false)
  const [videoPrimaryIndex, setVideoPrimaryIndex] = React.useState<number>(() => (persistedVideoPrimaryIndex !== null ? persistedVideoPrimaryIndex : 0))
  React.useEffect(() => {
    const total = videoResults.length
    const clamped =
      persistedVideoPrimaryIndex !== null && total > 0
        ? Math.max(0, Math.min(total - 1, persistedVideoPrimaryIndex))
        : persistedVideoPrimaryIndex ?? 0
    setVideoPrimaryIndex((prev) => (prev === clamped ? prev : clamped))
  }, [persistedVideoPrimaryIndex, videoResults.length])
  const hasPrimaryVideo = Boolean(videoResults[videoPrimaryIndex]?.url || videoUrl)
  const adoptedVideoMetadata = React.useMemo<AdoptedAssetMetadata | null>(() => {
    const raw = (data as { adoptedVideoAsset?: unknown } | undefined)?.adoptedVideoAsset
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const candidate = raw as Record<string, unknown>
    const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''
    if (!url) return null
    const rawIndex = typeof candidate.index === 'number' && Number.isFinite(candidate.index) ? Math.max(0, Math.trunc(candidate.index)) : -1
    const resolvedIndex = videoResults[rawIndex]?.url === url
      ? rawIndex
      : videoResults.findIndex((item) => item.url === url)
    if (resolvedIndex < 0) return null
    return {
      index: resolvedIndex,
      url,
      adoptedAt: typeof candidate.adoptedAt === 'string' ? candidate.adoptedAt : '',
      progress: typeof candidate.progress === 'number' && Number.isFinite(candidate.progress) ? candidate.progress : null,
    }
  }, [data, videoResults])
  const adoptedVideoIndex = adoptedVideoMetadata?.index ?? null
  const isPrimaryVideoAdopted = adoptedVideoIndex !== null && adoptedVideoIndex === videoPrimaryIndex
  const videoClipRange = React.useMemo(() => {
    const fromResult = normalizeClipRange((videoResults[videoPrimaryIndex] as any)?.clipRange)
    if (fromResult) return fromResult
    return normalizeClipRange((data as any)?.clipRange)
  }, [data, videoPrimaryIndex, videoResults])
  const [videoSelectedIndex, setVideoSelectedIndex] = React.useState(0)
  const frameSampleUrlsRef = React.useRef<string[]>([])
  const [frameSamples, setFrameSamples] = React.useState<FrameSample[]>([])
  const [frameCaptureLoading, setFrameCaptureLoading] = React.useState(false)
  const [videoUploadLoading, setVideoUploadLoading] = React.useState(false)

  const cleanupFrameSamples = React.useCallback(() => {
    frameSampleUrlsRef.current.forEach((u) => {
      try {
        URL.revokeObjectURL(u)
      } catch {
        // ignore
      }
    })
    frameSampleUrlsRef.current = []
    setFrameSamples([])
  }, [])

  React.useEffect(() => {
    return () => {
      cleanupFrameSamples()
    }
  }, [cleanupFrameSamples])

	  const handleCaptureVideoFrames = React.useCallback(async () => {
	    const src = videoResults[videoPrimaryIndex]?.url || videoUrl
	    if (!src) {
	      toast('当前没有可用的视频链接', 'error')
	      return
	    }
    const duration = videoResults[videoPrimaryIndex]?.duration
    const sampleTimes = (() => {
      if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
        const durationSeconds = Math.max(1, duration)
        const floorSeconds = Math.floor(durationSeconds)
        const times: number[] = []
        const step = floorSeconds + 1 > MAX_FRAME_ANALYSIS_SAMPLES
          ? Math.ceil((floorSeconds + 1) / MAX_FRAME_ANALYSIS_SAMPLES)
          : 1
        for (let t = 0; t <= floorSeconds; t += step) {
          times.push(Number(t.toFixed(2)))
        }
        if (!times.includes(Number(durationSeconds.toFixed(2)))) {
          times.push(Number(durationSeconds.toFixed(2)))
        }
        return times
      }
      return [1]
    })().filter((t, idx, arr) => Number.isFinite(t) && t >= 0 && arr.indexOf(t) === idx)

    setFrameCaptureLoading(true)
    cleanupFrameSamples()
    try {
      const { frames } = await captureFramesAtTimes({ type: 'url', url: src }, sampleTimes)
      frameSampleUrlsRef.current = frames.map((f) => f.objectUrl)
      setFrameSamples(
        frames.map((f) => ({
          url: f.objectUrl,
          time: f.time,
          blob: f.blob,
          remoteUrl: null,
          description: null,
          describing: false,
        })),
      )
      if (!frames.length) {
        toast('未能抽取到有效帧，可能受跨域或视频格式限制', 'error')
      } else {
        toast(`已抽取 ${frames.length} 帧`, 'success')
      }
    } catch (err: any) {
      console.error('captureFramesAtTimes error', err)
      const message =
        (err?.message as string | undefined) ||
        '抽帧失败，可能是跨域或视频格式不支持'
      toast(message, 'error')
	    } finally {
	      setFrameCaptureLoading(false)
	    }
	  }, [cleanupFrameSamples, videoPrimaryIndex, videoResults, videoUrl])

	  // 旧版基于 Sora 的角色创建能力已移除（不再依赖前端配置 Token/厂商）。

  const persistedCharacterRewriteModel = (data as any)?.characterRewriteModel
  const [characterRewriteModel, setCharacterRewriteModel] = React.useState<string>(() => {
    const stored = persistedCharacterRewriteModel
    return typeof stored === 'string' && stored.trim() ? stored : 'glm-4.6'
  })
  const [characterRewriteLoading, setCharacterRewriteLoading] = React.useState(false)
  const [characterRewriteError, setCharacterRewriteError] = React.useState<string | null>(null)

  const promptSuggestMode = useUIStore(s => s.promptSuggestMode)
  const [promptSuggestions, setPromptSuggestions] = React.useState<string[]>([])
  const [activeSuggestion, setActiveSuggestion] = React.useState(0)
  const suggestionsAllowed = promptSuggestMode !== 'off' && !isVideoNode
  const [suggestionsEnabled, setSuggestionsEnabled] = React.useState(() => suggestionsAllowed)
  const [promptSamplesOpen, setPromptSamplesOpen] = React.useState(false)
  const [mediaFocusOptionsOpen, setMediaFocusOptionsOpen] = React.useState(false)
  const [presetModalOpen, setPresetModalOpen] = React.useState(false)
  const [presetSaving, setPresetSaving] = React.useState(false)
  const [presetItems, setPresetItems] = React.useState<LlmNodePresetDto[]>([])
  const [presetLoading, setPresetLoading] = React.useState(false)
  const [selectedPresetId, setSelectedPresetId] = React.useState<string | null>(
    () => {
      const value = (data as any)?.llmPresetId
      return typeof value === 'string' && value.trim() ? value : null
    },
  )
  const [newPresetTitle, setNewPresetTitle] = React.useState('')
  const [newPresetPrompt, setNewPresetPrompt] = React.useState('')
  const [newPresetType, setNewPresetType] = React.useState<LlmNodePresetType>('text')
  const suggestTimeout = React.useRef<number | null>(null)
  const lastResult = (data as any)?.lastResult as { preview?: { type?: string; value?: string } } | undefined
  const lastText =
    lastResult && lastResult.preview && lastResult.preview.type === 'text'
      ? String(lastResult.preview.value || '')
      : ''
  const rawTextResults =
    ((data as any)?.textResults as { text: string }[] | undefined) || []
  const textResults =
    rawTextResults.length > 0
      ? rawTextResults
      : lastText
        ? [{ text: lastText }]
        : []
  const latestTextResult =
    textResults.length > 0 && typeof textResults[textResults.length - 1]?.text === 'string'
      ? String(textResults[textResults.length - 1].text).trim()
      : ''
  const [compareOpen, setCompareOpen] = React.useState(false)
  const [modelKey, setModelKey] = React.useState<string>(
    (data as any)?.geminiModel || getDefaultModel((coreKind === 'image' ? 'image' : coreKind) as NodeKind),
  )
  const defaultCanvasImageModel = kind === 'imageEdit' ? getDefaultModel('imageEdit') : getDefaultModel('image')
  const [imageModel, setImageModel] = React.useState<string>((data as any)?.imageModel || defaultCanvasImageModel)
  const [videoModel, setVideoModel] = React.useState<string>(() => {
    const raw = typeof (data as Record<string, unknown>)?.videoModel === 'string'
      ? String((data as Record<string, unknown>).videoModel).trim()
      : ''
    return raw
  })
  const [videoDuration, setVideoDuration] = React.useState<number>(() => {
    const dataRecord =
      data && typeof data === 'object'
        ? (data as Record<string, unknown>)
        : {}
    return readVideoDurationSeconds(dataRecord, 5)
  })
  const [videoGenerateAudio, setVideoGenerateAudio] = React.useState<boolean>(() => {
    const dataRecord = data as Record<string, unknown>
    return readBooleanFlag(dataRecord, ['generateAudio', 'generate_audio'], false)
  })
  const [videoSize, setVideoSize] = React.useState<string>(() => {
    const raw = typeof (data as any)?.videoSize === 'string' ? String((data as any).videoSize).trim() : ''
    return raw.replace(/\s+/g, '')
  })
  const [videoResolution, setVideoResolution] = React.useState<string>(() => {
    const dataRecord = data as Record<string, unknown>
    return normalizeVideoResolution(dataRecord.videoResolution ?? dataRecord.resolution)
  })
  const [orientation, setOrientation] = React.useState<Orientation>(() => {
    const dataRecord = data as Record<string, unknown>
    const rawVideoSize = typeof dataRecord.videoSize === 'string' ? dataRecord.videoSize.trim() : ''
    const rawAspect = typeof dataRecord.aspect === 'string' ? dataRecord.aspect.trim() : ''
    return resolveVideoOrientationValue({
      currentOrientation: dataRecord.orientation,
      size: rawVideoSize,
      aspect: rawAspect,
      config: null,
    })
  })
  const orientationRef = React.useRef<Orientation>(orientation)
  React.useEffect(() => {
    const dataRecord = data as Record<string, unknown>
    const rawVideoSize = typeof dataRecord.videoSize === 'string' ? dataRecord.videoSize.trim() : ''
    const rawAspect = typeof dataRecord.aspect === 'string' ? dataRecord.aspect.trim() : ''
    const normalized = resolveVideoOrientationValue({
      currentOrientation: dataRecord.orientation,
      size: rawVideoSize,
      aspect: rawAspect,
      config: null,
    })
    setOrientation((prev) => (prev === normalized ? prev : normalized))
    orientationRef.current = normalized
  }, [(data as any)?.orientation, (data as any)?.videoSize, (data as any)?.aspect])
  React.useEffect(() => {
    const raw = typeof (data as any)?.videoSize === 'string' ? String((data as any).videoSize).trim() : ''
    const normalized = raw.replace(/\s+/g, '')
    setVideoSize((prev) => (prev === normalized ? prev : normalized))
  }, [(data as any)?.videoSize])
  React.useEffect(() => {
    const dataRecord = data as Record<string, unknown>
    const normalized = normalizeVideoResolution(dataRecord.videoResolution ?? dataRecord.resolution)
    setVideoResolution((prev) => (prev === normalized ? prev : normalized))
  }, [(data as Record<string, unknown>)?.videoResolution, (data as Record<string, unknown>)?.resolution])
  React.useEffect(() => {
    const dataRecord = data as Record<string, unknown>
    const next = readBooleanFlag(dataRecord, ['generateAudio', 'generate_audio'], false)
    setVideoGenerateAudio((prev) => (prev === next ? prev : next))
  }, [(data as Record<string, unknown>)?.generateAudio, (data as Record<string, unknown>)?.generate_audio])
  React.useEffect(() => {
    if (kind !== 'imageEdit') return
    const next = normalizeImageEditSize((data as Record<string, unknown>)?.imageEditSize ?? (data as Record<string, unknown>)?.size)
    setImageEditSize((prev) => (prev === next ? prev : next))
  }, [(data as Record<string, unknown>)?.imageEditSize, (data as Record<string, unknown>)?.size, kind])
  React.useEffect(() => {
    if (kind !== 'imageEdit') return
    const dataRecord = data as Record<string, unknown>
    const storedImageEditSize = typeof dataRecord.imageEditSize === 'string' ? dataRecord.imageEditSize.trim() : ''
    const storedSize = typeof dataRecord.size === 'string' ? dataRecord.size.trim() : ''
    if (storedImageEditSize && storedSize) return
    const nextSize = normalizeImageEditSize(storedImageEditSize || storedSize || imageEditSize)
    updateNodeData(id, {
      imageEditSize: nextSize,
      size: nextSize,
      aspect: toAspectRatioFromImageEditSize(nextSize),
    })
  }, [data, id, imageEditSize, kind, updateNodeData])
  React.useEffect(() => {
    const next = normalizeCanvasResizeSize((data as Record<string, unknown>)?.canvasResizeSize ?? canvasResizeSize)
    setCanvasResizeSize((prev) => (prev === next ? prev : next))
  }, [(data as Record<string, unknown>)?.canvasResizeSize, canvasResizeSize])
  const [veoReferenceImages, setVeoReferenceImages] = React.useState<string[]>(() =>
    normalizeVeoReferenceUrls((data as any)?.veoReferenceImages),
  )
  const [veoFirstFrameUrl, setVeoFirstFrameUrl] = React.useState<string>(
    ((data as any)?.veoFirstFrameUrl as string | undefined) || '',
  )
  const [veoLastFrameUrl, setVeoLastFrameUrl] = React.useState<string>(
    ((data as any)?.veoLastFrameUrl as string | undefined) || '',
  )
  const [veoCustomImageInput, setVeoCustomImageInput] = React.useState('')
  const activeVideoDuration = React.useMemo(() => {
    const candidate = videoResults[videoPrimaryIndex]?.duration ?? videoDuration
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return candidate
    }
    return null
  }, [videoResults, videoPrimaryIndex, videoDuration])

  React.useEffect(() => {
    const next = normalizeVeoReferenceUrls((data as any)?.veoReferenceImages)
    setVeoReferenceImages((prev) => {
      if (prev.length === next.length && prev.every((item, index) => item === next[index])) {
        return prev
      }
      return next
    })
  }, [(data as any)?.veoReferenceImages])

  React.useEffect(() => {
    const next = ((data as any)?.veoFirstFrameUrl as string | undefined) || ''
    setVeoFirstFrameUrl((prev) => (prev === next ? prev : next))
  }, [(data as any)?.veoFirstFrameUrl])

  React.useEffect(() => {
    const next = ((data as any)?.veoLastFrameUrl as string | undefined) || ''
    setVeoLastFrameUrl((prev) => (prev === next ? prev : next))
  }, [(data as any)?.veoLastFrameUrl])

  const primaryMedia = React.useMemo(() => {
    if (hasPrimaryImage || hasImageResults) return 'image' as const
    if (isVideoNode && (videoResults[videoPrimaryIndex]?.url || (data as any)?.videoUrl)) return 'video' as const
    if (isAudioNode && (data as any)?.audioUrl) return 'audio' as const
    return null
  }, [
    hasPrimaryImage,
    hasImageResults,
    isVideoNode,
    videoResults,
    videoPrimaryIndex,
    data,
    isAudioNode,
  ])
  const { selectedNodeCount } = useCanvasRenderContext()
  const isSingleSelectionActive = Boolean(selected && !dragging && selectedNodeCount <= 1)
  const wantsCharacterRefs = isSingleSelectionActive
  const characterRefs = useRFStore(
    React.useCallback((s): CharacterRef[] => {
      if (!wantsCharacterRefs) return EMPTY_CHARACTER_REFS
      const results: CharacterRef[] = []
      s.nodes.forEach((node) => {
        const payload = typeof node.data === 'object' && node.data !== null
          ? node.data as Record<string, unknown>
          : {}
        const nodeKind = typeof payload.kind === 'string' ? payload.kind : null
        const nodeSchema = getTaskNodeSchema(nodeKind)
        if (!nodeSchema.features.includes('character')) return
        const usernameRaw =
          payload.characterUsername ||
          payload.username ||
          payload.soraCharacterUsername ||
          ''
        const username = typeof usernameRaw === 'string' ? usernameRaw.replace(/^@/, '') : ''
        const displayName =
          payload.characterDisplayName ||
          payload.displayName ||
          payload.label ||
          (username ? `@${username}` : node.id)
        const displayNameText = typeof displayName === 'string' ? displayName : String(displayName || '')
        const rawLabel = typeof payload.label === 'string' ? payload.label : ''
        results.push({ nodeId: node.id, username, displayName: displayNameText, rawLabel, source: 'character' })
      })
      return results.filter((ref) => ref.username || ref.displayName)
    }, [wantsCharacterRefs]),
    areCharacterRefsEqual,
  )
  const characterRefMap = React.useMemo(() => {
    const map = new Map<string, { nodeId: string; username: string; displayName: string }>()
    characterRefs.forEach((ref) => map.set(ref.nodeId, ref))
    return map
  }, [characterRefs])
  const [projectRoleRefs, setProjectRoleRefs] = React.useState<CharacterRef[]>(EMPTY_CHARACTER_REFS)
  const [projectRoleRefsVersion, setProjectRoleRefsVersion] = React.useState(0)
  React.useEffect(() => {
    if (typeof window === 'undefined' || !wantsCharacterRefs) return
    const projectId = String(currentProject?.id || '').trim()
    const onRefresh = () => {
      invalidateProjectMentionRefCaches(projectId)
      setProjectRoleRefsVersion((v) => v + 1)
    }
    window.addEventListener(ASSET_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(ASSET_REFRESH_EVENT, onRefresh)
  }, [currentProject?.id, wantsCharacterRefs])
  React.useEffect(() => {
    const projectId = String(currentProject?.id || '').trim()
    if (!projectId || !wantsCharacterRefs) {
      setProjectRoleRefs(EMPTY_CHARACTER_REFS)
      return
    }
    let canceled = false
    ;(async () => {
      try {
        const refs = await loadProjectRoleRefs(projectId)
        if (canceled) return
        setProjectRoleRefs(refs)
      } catch {
        if (canceled) return
        setProjectRoleRefs(EMPTY_CHARACTER_REFS)
      }
    })()
    return () => {
      canceled = true
    }
  }, [currentProject?.id, projectRoleRefsVersion, wantsCharacterRefs])
  const mergedCharacterRefs = React.useMemo(() => {
    if (!projectRoleRefs.length) return characterRefs
    const byUsername = new Map<string, CharacterRef>()
    for (const ref of characterRefs) {
      const key = String(ref.username || '').trim().toLowerCase()
      if (!key) continue
      byUsername.set(key, ref)
    }
    for (const ref of projectRoleRefs) {
      const key = String(ref.username || '').trim().toLowerCase()
      if (!key || byUsername.has(key)) continue
      byUsername.set(key, ref)
    }
    return Array.from(byUsername.values())
  }, [characterRefs, projectRoleRefs])
  const canvasAssetMentionRefs = useRFStore(
    React.useCallback((s): CharacterRef[] => {
      if (!wantsCharacterRefs) return EMPTY_CHARACTER_REFS
      const results: CharacterRef[] = []
      s.nodes.forEach((node) => {
        if (node.id === id) return
        const payload: any = node.data || {}
        const imageResults = Array.isArray(payload.imageResults) ? payload.imageResults : []
        const videoResults = Array.isArray(payload.videoResults) ? payload.videoResults : []
        const primaryImage = imageResults[0] || null
        const primaryVideo = videoResults[0] || null
        const assetUrl = readPrimaryReferenceAssetUrl(payload)
        const usernameRaw =
          payload.assetRefId ||
          primaryImage?.assetRefId ||
          primaryVideo?.assetRefId ||
          payload.assetId ||
          primaryImage?.assetId ||
          primaryVideo?.assetId ||
          ''
        const username = toMentionUsername(usernameRaw)
        if (!username) return
        const displayName =
          payload.assetName ||
          primaryImage?.assetName ||
          primaryVideo?.assetName ||
          primaryImage?.title ||
          primaryVideo?.title ||
          payload.label ||
          username
        results.push({
          nodeId: node.id,
          username,
          displayName,
          rawLabel: payload.label || displayName,
          source: 'asset',
          assetUrl: assetUrl || null,
          assetId:
            String(
              payload.assetId ||
              primaryImage?.assetId ||
              primaryVideo?.assetId ||
              '',
            ).trim() || null,
          assetRefId:
            String(
              payload.assetRefId ||
              primaryImage?.assetRefId ||
              primaryVideo?.assetRefId ||
              username,
            ).trim() || username,
          assetName: String(displayName || username).trim() || username,
        })
      })
      return results.filter((ref) => ref.username)
    }, [id, wantsCharacterRefs]),
    areCharacterRefsEqual,
  )
  const [projectAssetMentionRefs, setProjectAssetMentionRefs] = React.useState<CharacterRef[]>(EMPTY_CHARACTER_REFS)
  React.useEffect(() => {
    const projectId = String(currentProject?.id || '').trim()
    if (!projectId || !wantsCharacterRefs) {
      setProjectAssetMentionRefs(EMPTY_CHARACTER_REFS)
      return
    }
    let canceled = false
    ;(async () => {
      try {
        const refs = await loadProjectAssetMentionRefs(projectId)
        if (canceled) return
        setProjectAssetMentionRefs(refs)
      } catch {
        if (!canceled) setProjectAssetMentionRefs(EMPTY_CHARACTER_REFS)
      }
    })()
    return () => {
      canceled = true
    }
  }, [currentProject?.id, projectRoleRefsVersion, wantsCharacterRefs])
  const mergedAssetMentionRefs = React.useMemo(() => {
    const byUsername = new Map<string, CharacterRef>()
    for (const ref of canvasAssetMentionRefs) {
      const key = String(ref.username || '').trim().toLowerCase()
      if (!key) continue
      byUsername.set(key, ref)
    }
    for (const ref of projectAssetMentionRefs) {
      const key = String(ref.username || '').trim().toLowerCase()
      if (!key || byUsername.has(key)) continue
      byUsername.set(key, ref)
    }
    return Array.from(byUsername.values())
  }, [canvasAssetMentionRefs, projectAssetMentionRefs])
  const handleBindPrimaryAnchor = React.useCallback(async () => {
    const projectId = typeof currentProject?.id === 'string' ? currentProject.id.trim() : ''
    const anchorKind = anchorBindingKind
    const anchorLabel = anchorBindingLabel.trim()
    const imageUrl = primaryImageForAnchorBinding
    const nodeData = data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : {}
    const sourceBookId = typeof nodeData.sourceBookId === 'string' ? nodeData.sourceBookId.trim() : ''
    const stateDescription =
      typeof nodeData.stateDescription === 'string' && nodeData.stateDescription.trim()
        ? nodeData.stateDescription.trim()
        : undefined
    const semanticRoleBinding = resolveSemanticNodeRoleBinding(nodeData)
    const semanticVisualBinding = resolveSemanticNodeVisualReferenceBinding(nodeData)
    if (!anchorLabel) {
      toast('请先填写锚点名称', 'warning')
      return
    }
    if (!imageUrl) {
      toast('当前节点还没有可用主图，请先生成图片后再绑定', 'warning')
      return
    }
    if (bindAnchorLoading) return
    setBindAnchorLoading(true)
    try {
      let resolvedSourceBookId = sourceBookId

      if (anchorKind === 'character') {
        const assetConflict = findMentionRefConflict({
          candidate: anchorLabel,
          assetRefs: mergedAssetMentionRefs,
        })
        if (assetConflict) {
          toast(`绑定失败：@${assetConflict.mention} 已被资产引用占用（${assetConflict.displayName}）`, 'error')
          return
        }

        const referenceView = semanticRoleBinding.referenceView || 'three_view'
        const nextRoleRefUrls = Array.from(
          new Set([
            ...(Array.isArray(nodeData.roleCardReferenceImages)
              ? (nodeData.roleCardReferenceImages as unknown[]).map((item) => String(item || '').trim()).filter(Boolean)
              : []),
            imageUrl,
          ]),
        ).slice(0, 8)

        if (!projectId) {
          updateNodeData(id, {
            roleName: anchorLabel,
            ...(resolvedSourceBookId ? { sourceBookId: resolvedSourceBookId } : null),
            referenceView,
            roleCardReferenceImages: nextRoleRefUrls,
            anchorBindings: upsertSemanticNodeAnchorBinding({
              existing: nodeData.anchorBindings,
              next: {
                kind: 'character',
                label: anchorLabel,
                sourceBookId: resolvedSourceBookId || null,
                sourceNodeId: id,
                imageUrl,
                referenceView,
              },
            }),
          })
          toast(`已绑定角色锚点：${anchorLabel}`, 'success')
          return
        }

        const saved = await upsertProjectRoleCardAsset(projectId, {
          cardId: String(nodeData.roleCardId || '').trim() || undefined,
          roleId: String(nodeData.roleId || '').trim() || undefined,
          roleName: anchorLabel,
          nodeId: id,
          prompt: prompt?.trim() || undefined,
          status: 'generated',
          modelKey: String(nodeData.modelKey || nodeData.imageModel || '').trim() || undefined,
          imageUrl,
          ...(referenceView === 'three_view' ? { threeViewImageUrl: imageUrl } : null),
        })
        let syncedRoleCardId = String(saved?.data?.cardId || saved?.id || '').trim()

        updateNodeData(id, {
          roleName: anchorLabel,
          ...(saved?.data?.roleId ? { roleId: saved.data.roleId } : null),
          ...(syncedRoleCardId ? { roleCardId: syncedRoleCardId } : null),
          ...(resolvedSourceBookId ? { sourceBookId: resolvedSourceBookId } : null),
          referenceView,
          roleCardReferenceImages: nextRoleRefUrls,
          anchorBindings: upsertSemanticNodeAnchorBinding({
            existing: nodeData.anchorBindings,
            next: {
              kind: 'character',
              label: anchorLabel,
              refId: syncedRoleCardId || null,
              entityId: String(saved?.data?.roleId || '').trim() || null,
              sourceBookId: resolvedSourceBookId || null,
              sourceNodeId: id,
              imageUrl,
              referenceView,
            },
          }),
        })
        notifyAssetRefresh()
        toast(`已绑定角色锚点：${anchorLabel}`, 'success')
        return
      }

      if (anchorKind === 'scene' || anchorKind === 'prop') {

        updateNodeData(id, {
          ...(resolvedSourceBookId ? { sourceBookId: resolvedSourceBookId } : null),
          scenePropRefName: anchorLabel,
          visualRefName: anchorLabel,
          visualRefCategory: 'scene_prop',
          anchorBindings: upsertSemanticNodeAnchorBinding({
            existing: nodeData.anchorBindings,
            next: {
              kind: anchorKind,
              label: anchorLabel,
              sourceBookId: resolvedSourceBookId || null,
              sourceNodeId: id,
              imageUrl,
              category: 'scene_prop',
            },
          }),
        })
        toast(`已绑定${anchorKind === 'scene' ? '场景' : '道具'}锚点：${anchorLabel}`, 'success')
        return
      }

      updateNodeData(id, {
        ...(resolvedSourceBookId ? { sourceBookId: resolvedSourceBookId } : null),
        anchorBindings: upsertSemanticNodeAnchorBinding({
          existing: nodeData.anchorBindings,
          next: {
            kind: anchorKind,
            label: anchorLabel,
            sourceBookId: resolvedSourceBookId || null,
            sourceNodeId: id,
            imageUrl,
          },
        }),
      })
      toast(`已绑定锚点：${anchorLabel}`, 'success')
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '绑定锚点失败'
      toast(errorMessage || '绑定锚点失败', 'error')
    } finally {
      setBindAnchorLoading(false)
    }
  }, [anchorBindingKind, anchorBindingLabel, bindAnchorLoading, currentProject?.id, data, id, mergedAssetMentionRefs, primaryImageForAnchorBinding, prompt, updateNodeData])
  const primaryMediaUrl = React.useMemo(() => {
    switch (primaryMedia) {
      case 'image':
        return (
          imageResults[imagePrimaryIndex]?.url ||
          imageUrl ||
          (data as any)?.imageUrl ||
          null
        )
      case 'video':
        return (
          videoResults[videoPrimaryIndex]?.url ||
          (data as any)?.videoUrl ||
          null
        )
      case 'audio':
        return (data as any)?.audioUrl || null
      default:
        return null
    }
  }, [
    primaryMedia,
    imageResults,
    imagePrimaryIndex,
    imageUrl,
    data,
    videoResults,
    videoPrimaryIndex,
  ])
  const primaryBindableAsset = React.useMemo(() => {
    if (primaryMedia === 'image') {
      const current = imageResults[imagePrimaryIndex] || imageResults[0] || null
      const directUrl = typeof (data as any)?.imageUrl === 'string' ? String((data as any).imageUrl).trim() : ''
      const directAssetId = typeof (data as any)?.assetId === 'string' ? String((data as any).assetId).trim() : ''
      const directAssetRefId = typeof (data as any)?.assetRefId === 'string' ? String((data as any).assetRefId).trim() : ''
      const directAssetName = typeof (data as any)?.assetName === 'string' ? String((data as any).assetName).trim() : ''
      const url = current?.url || directUrl
      if (!url) return null
      return {
        kind: 'image' as const,
        url,
        assetId: current?.assetId || directAssetId || null,
        assetRefId: current?.assetRefId || directAssetRefId || null,
        assetName: current?.assetName || current?.title || directAssetName || String((data as any)?.label || '').trim() || null,
      }
    }
    if (primaryMedia === 'video') {
      const current = videoResults[videoPrimaryIndex] || videoResults[0] || null
      const directUrl = typeof (data as any)?.videoUrl === 'string' ? String((data as any).videoUrl).trim() : ''
      const directAssetId = typeof (data as any)?.assetId === 'string' ? String((data as any).assetId).trim() : ''
      const directAssetRefId = typeof (data as any)?.assetRefId === 'string' ? String((data as any).assetRefId).trim() : ''
      const directAssetName = typeof (data as any)?.assetName === 'string' ? String((data as any).assetName).trim() : ''
      const url = current?.url || directUrl
      if (!url) return null
      return {
        kind: 'video' as const,
        url,
        assetId: current?.assetId || directAssetId || null,
        assetRefId: current?.assetRefId || directAssetRefId || null,
        assetName: current?.assetName || current?.title || directAssetName || String((data as any)?.label || '').trim() || null,
      }
    }
    return null
  }, [data, imagePrimaryIndex, imageResults, primaryMedia, videoPrimaryIndex, videoResults])
  const assetBindStatusText = React.useMemo(() => {
    const parts: string[] = []
    const currentRefId = String((data as any)?.assetRefId || primaryBindableAsset?.assetRefId || '').trim()
    const currentAssetId = String((data as any)?.assetId || primaryBindableAsset?.assetId || '').trim()
    if (currentRefId) parts.push(`引用ID：${currentRefId}`)
    if (currentAssetId) parts.push(`资产ID：${currentAssetId}`)
    return parts.join(' · ')
  }, [data, primaryBindableAsset])
  const handleBindPrimaryAssetReference = React.useCallback(() => {
    const nextRefId = toMentionUsername(assetBindingId)
    if (!nextRefId) {
      toast('请先填写引用ID', 'warning')
      return
    }
    if (!primaryBindableAsset?.url) {
      toast('当前节点还没有可绑定的图片或视频结果', 'warning')
      return
    }
    const roleConflict = findMentionRefConflict({
      candidate: nextRefId,
      roleRefs: projectRoleRefs,
    })
    if (roleConflict) {
      toast(`绑定失败：@${roleConflict.mention} 已被角色卡占用（${roleConflict.displayName}）`, 'error')
      return
    }
    const nextAssetName = primaryBindableAsset.assetName || String((data as any)?.label || '').trim() || nextRefId
    const patch: Record<string, unknown> = {
      assetRefId: nextRefId,
      ...(primaryBindableAsset.assetId ? { assetId: primaryBindableAsset.assetId } : null),
      assetName: nextAssetName,
    }
    if (primaryBindableAsset.kind === 'image') {
      const nextResults = imageResults.length
        ? imageResults.map((item, index) => index === imagePrimaryIndex
          ? {
              ...item,
              ...(primaryBindableAsset.assetId ? { assetId: primaryBindableAsset.assetId } : null),
              assetRefId: nextRefId,
              assetName: nextAssetName,
            }
          : item)
        : [{
            url: primaryBindableAsset.url,
            ...(primaryBindableAsset.assetId ? { assetId: primaryBindableAsset.assetId } : null),
            assetRefId: nextRefId,
            assetName: nextAssetName,
          }]
      patch.imageResults = nextResults
    } else if (primaryBindableAsset.kind === 'video') {
      const nextResults = videoResults.length
        ? videoResults.map((item, index) => index === videoPrimaryIndex
          ? {
              ...item,
              ...(primaryBindableAsset.assetId ? { assetId: primaryBindableAsset.assetId } : null),
              assetRefId: nextRefId,
              assetName: nextAssetName,
            }
          : item)
        : [{
            url: primaryBindableAsset.url,
            ...(primaryBindableAsset.assetId ? { assetId: primaryBindableAsset.assetId } : null),
            assetRefId: nextRefId,
            assetName: nextAssetName,
          }]
      patch.videoResults = nextResults
    }
    updateNodeData(id, patch)
    setAssetBindingId(nextRefId)
    toast(`已绑定引用ID：@${nextRefId}`, 'success')
  }, [assetBindingId, data, id, imagePrimaryIndex, imageResults, primaryBindableAsset, projectRoleRefs, updateNodeData, videoPrimaryIndex, videoResults])
  const handleMentionApplied = React.useCallback((item: MentionSuggestionItem) => {
    if (item.source !== 'asset') return
    const assetBinding = item.assetBinding
    if (!assetBinding?.url) return
    const nodeData = data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : {}
    const existingReferenceImages = Array.isArray(nodeData.referenceImages)
      ? nodeData.referenceImages
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter(Boolean)
      : []
    const nextReferenceImages = existingReferenceImages.includes(assetBinding.url)
      ? existingReferenceImages
      : [...existingReferenceImages, assetBinding.url].slice(0, 12)
    const existingAssetInputs = Array.isArray(nodeData.assetInputs)
      ? nodeData.assetInputs.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      : []
    const existingIndex = existingAssetInputs.findIndex((entry) => {
      const record = entry as Record<string, unknown>
      return typeof record.url === 'string' && record.url.trim() === assetBinding.url
    })
    const nextAssetInput = {
      url: assetBinding.url,
      role: 'reference',
      ...(assetBinding.assetId ? { assetId: assetBinding.assetId } : null),
      ...(assetBinding.assetRefId ? { assetRefId: assetBinding.assetRefId } : null),
      ...(assetBinding.assetName ? { name: assetBinding.assetName } : null),
    }
    const nextAssetInputs =
      existingIndex >= 0
        ? existingAssetInputs.map((entry, index) => (index === existingIndex ? { ...(entry as Record<string, unknown>), ...nextAssetInput } : entry))
        : [...existingAssetInputs, nextAssetInput].slice(0, 12)
    updateNodeData(id, {
      referenceImages: nextReferenceImages,
      assetInputs: nextAssetInputs,
    })
  }, [data, id, updateNodeData])

  const activeModelKey = isVideoNode
    ? videoModel
    : coreKind === 'image' || kind === 'imageEdit'
      ? imageModel
      : modelKey
  const catalogModelKind = isVideoNode ? 'video' : kind as NodeKind
  const catalogModelList = useModelOptions(catalogModelKind)
  const modelList = React.useMemo<ModelOption[]>(
    () => catalogModelList,
    [catalogModelList],
  )
  const modelMenuOptions = React.useMemo<ModelOption[]>(() => {
    if (modelList.length) {
      return modelList.map((option) => ({
        ...option,
        label: getTaskNodeModelDisplayLabel(option),
      }))
    }
    return []
  }, [modelList])
  const selectedActiveModelOption = React.useMemo(
    () => findModelOptionByIdentifier(modelMenuOptions, activeModelKey),
    [activeModelKey, modelMenuOptions],
  )
  const findVendorForModel = React.useCallback(
    (value: string | null | undefined) => {
      if (!value) return null
      const match = findModelOptionByIdentifier(modelList, value)
      return match?.vendor || null
    },
    [modelList],
  )
  const resolveRequestedModelIdentifier = React.useCallback(
    (value: string | null | undefined) => {
      const identifier = String(value || '').trim()
      if (!identifier) return ''
      return getModelOptionRequestAlias(modelList.length ? modelList : modelMenuOptions, identifier) || identifier
    },
    [modelList, modelMenuOptions],
  )
  const handleApplyImageViewEdit = React.useCallback(
    ({ cameraControl, lightingRig, applyTarget }: ImageViewEditorApplyPayload) => {
      const normalizedBaseImageUrl = String(basePoseImage || '').trim()
      if (!normalizedBaseImageUrl) {
        toast('请先上传或生成图片', 'warning')
        return
      }

      const normalizedCameraControl = normalizeImageCameraControl(cameraControl)
      const normalizedLightingRig = normalizeImageLightingRig(lightingRig)
      const shouldPersistCamera = hasActiveImageCameraControl(normalizedCameraControl)
      const shouldPersistLighting = hasActiveImageLightingRig(normalizedLightingRig)

      if (!shouldPersistCamera && !shouldPersistLighting) {
        toast('请先启用角度或灯光控制', 'warning')
        return
      }

      if (applyTarget === 'inPlace') {
        updateNodeData(id, {
          ...(shouldPersistCamera ? { imageCameraControl: normalizedCameraControl } : null),
          ...(shouldPersistLighting ? { imageLightingRig: normalizedLightingRig } : null),
        })
        runNodeDagToTarget(id, useRFStore.getState, useRFStore.setState, { concurrency: 1 }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : '原地重跑图片编辑失败'
          console.error('auto run image view edit (in-place) failed', error)
          toast(message, 'error')
        })
        return
      }

      const stateBefore = useRFStore.getState()
      const beforeIds = new Set(stateBefore.nodes.map((node) => node.id))
      const sourceDataRecord = data as Record<string, unknown>
      const nextImageEditSize = normalizeImageEditSize(
        kind === 'imageEdit'
          ? (sourceDataRecord.imageEditSize ?? sourceDataRecord.size)
          : imageEditSize,
      )
      const nextImageEditAspect = toAspectRatioFromImageEditSize(nextImageEditSize)
      const fallbackModel = getDefaultModel('imageEdit')
      const editableModel = String(imageModel || fallbackModel).trim() || fallbackModel

      addNode('taskNode', undefined, {
        kind: 'imageEdit',
        prompt: prompt.trim(),
        aspect: nextImageEditAspect,
        sampleCount,
        imageModel: editableModel,
        imageModelVendor: null,
        imageEditSize: nextImageEditSize,
        size: nextImageEditSize,
        referenceImages: [normalizedBaseImageUrl],
        ...(Array.isArray(sourceDataRecord.anchorBindings) ? { anchorBindings: sourceDataRecord.anchorBindings } : null),
        ...(Array.isArray(sourceDataRecord.assetInputs) ? { assetInputs: sourceDataRecord.assetInputs } : null),
        ...(shouldPersistCamera ? { imageCameraControl: normalizedCameraControl } : null),
        ...(shouldPersistLighting ? { imageLightingRig: normalizedLightingRig } : null),
      })

      const afterAdd = useRFStore.getState()
      const newNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
      if (!newNode) {
        toast('图片编辑配置已生成，但未能创建新节点', 'error')
        return
      }

      const sourceNode = afterAdd.nodes.find((node) => node.id === id)
      const targetPos = {
        x: (sourceNode?.position?.x || 0) + 380,
        y: sourceNode?.position?.y || 0,
      }
      afterAdd.onNodesChange([
        { id: newNode.id, type: 'position', position: targetPos, dragging: false },
        { id: newNode.id, type: 'select', selected: true },
      ])
      afterAdd.onConnect({
        source: id,
        sourceHandle: 'out-image',
        target: newNode.id,
        targetHandle: 'in-image',
      })

      runNodeDagToTarget(newNode.id, useRFStore.getState, useRFStore.setState, { concurrency: 1 }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '新图片编辑生成启动失败'
        console.error('auto run image view edit failed', error)
        toast(message, 'error')
      })
    },
    [addNode, basePoseImage, data, id, imageEditSize, imageModel, kind, prompt, sampleCount, updateNodeData],
  )
  const { openCameraEditor, openLightingEditor, modal: imageViewEditorModal } = useImageViewEditor({
    baseImageUrl: basePoseImage,
    cameraControl: (data as Record<string, unknown>)?.imageCameraControl,
    lightingRig: (data as Record<string, unknown>)?.imageLightingRig,
    hasImages: imageResults.length > 0,
    isDarkUi,
    inlineDividerColor,
    nodeKind: kind,
    onApply: handleApplyImageViewEdit,
  })
  const existingModelVendor = (data as any)?.modelVendor
  const existingVideoVendor = (data as any)?.videoModelVendor
  const resolvedVideoVendor = React.useMemo(() => {
    return findVendorForModel(videoModel) || existingVideoVendor || null
  }, [existingVideoVendor, findVendorForModel, videoModel])
  const selectedVideoModelOption = React.useMemo(() => {
    if (!isVideoNode) return null
    return selectedActiveModelOption
  }, [isVideoNode, selectedActiveModelOption])
  const selectedImageModelOption = React.useMemo(() => {
    if (isVideoNode) return null
    return selectedActiveModelOption
  }, [isVideoNode, selectedActiveModelOption])
  const selectedVideoModelMeta = React.useMemo(() => {
    if (!selectedVideoModelOption || !('meta' in selectedVideoModelOption)) return undefined
    return selectedVideoModelOption.meta
  }, [selectedVideoModelOption])
  const selectedImageModelMeta = React.useMemo(() => {
    if (!selectedImageModelOption || !('meta' in selectedImageModelOption)) return undefined
    return selectedImageModelOption.meta
  }, [selectedImageModelOption])
  const imageModelConfig = React.useMemo(
    () => parseImageModelCatalogConfig(selectedImageModelMeta),
    [selectedImageModelMeta],
  )
  const videoModelConfig = React.useMemo(
    () => parseVideoModelCatalogConfig(selectedVideoModelMeta),
    [selectedVideoModelMeta],
  )
  const configuredImageAspectOptions = React.useMemo(
    () =>
      (imageModelConfig?.aspectRatioOptions || []).map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [imageModelConfig],
  )
  const configuredImageSizeOptions = React.useMemo(
    () =>
      (imageModelConfig?.imageSizeOptions || []).map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [imageModelConfig],
  )
  const configuredImageResolutionOptions = React.useMemo(
    () =>
      (imageModelConfig?.resolutionOptions || []).map((option) => ({
        value: option.value,
        label: formatImageResolutionOptionLabel(option.label, option.value),
      })),
    [imageModelConfig],
  )
  const effectiveVideoResolution = React.useMemo(
    () => pickVideoResolutionValue(videoModelConfig, videoResolution) || videoResolution,
    [videoModelConfig, videoResolution],
  )
  const configuredDurationOptions = React.useMemo(
    () =>
      (videoModelConfig?.durationOptions || []).map((option) => ({
        value: String(option.value),
        label: option.label,
      })),
    [videoModelConfig],
  )
  const configuredSizeOptions = React.useMemo(
    () =>
      (videoModelConfig?.sizeOptions || []).map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [videoModelConfig],
  )
  const configuredVideoResolutionOptions = React.useMemo(
    () =>
      (videoModelConfig?.resolutionOptions || []).map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [videoModelConfig],
  )
  const isImageEditNode = kind === 'imageEdit'
  const imageEditSizeOption = React.useMemo(
    () => resolveImageEditSizeOption(imageEditSize),
    [imageEditSize],
  )
  const imageEditPreview = React.useMemo(
    () =>
      isImageEditNode
        ? {
            label: imageEditSizeOption.value,
            width: imageEditSizeOption.width,
            height: imageEditSizeOption.height,
          }
        : null,
    [imageEditSizeOption.height, imageEditSizeOption.value, imageEditSizeOption.width, isImageEditNode],
  )
  const imageEditResolutionOptions = React.useMemo(
    () =>
      IMAGE_EDIT_SIZE_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [],
  )
  const configuredOrientationOptions = React.useMemo(
    () => (videoModelConfig?.orientationOptions || []).map((option) => ({ value: option.value, label: option.label })),
    [videoModelConfig],
  )
  const selectedConfiguredDurationOption = React.useMemo(
    () => configuredDurationOptions.find((option) => Number(option.value) === videoDuration) || null,
    [configuredDurationOptions, videoDuration],
  )
  const selectedConfiguredSizeOption = React.useMemo(
    () => configuredSizeOptions.find((option) => option.value === videoSize) || null,
    [configuredSizeOptions, videoSize],
  )
  const selectedConfiguredResolutionOption = React.useMemo(
    () =>
      configuredVideoResolutionOptions.find((option) => option.value === effectiveVideoResolution) || null,
    [configuredVideoResolutionOptions, effectiveVideoResolution],
  )
  const selectedConfiguredImageAspectOption = React.useMemo(
    () => configuredImageAspectOptions.find((option) => option.value === aspect) || null,
    [aspect, configuredImageAspectOptions],
  )
  const selectedConfiguredImageSizeOption = React.useMemo(
    () => configuredImageSizeOptions.find((option) => option.value === imageSize) || null,
    [configuredImageSizeOptions, imageSize],
  )
  const selectedConfiguredImageResolutionOption = React.useMemo(
    () => configuredImageResolutionOptions.find((option) => option.value === imageResolution) || null,
    [configuredImageResolutionOptions, imageResolution],
  )
  const imageSizeMatchesResolutionOptions = React.useMemo(() => {
    if (!configuredImageSizeOptions.length || !configuredImageResolutionOptions.length) {
      return false
    }
    if (configuredImageSizeOptions.length !== configuredImageResolutionOptions.length) {
      return false
    }
    return configuredImageSizeOptions.every((option, index) => {
      const resolutionOption = configuredImageResolutionOptions[index]
      return (
        resolutionOption?.value === option.value &&
        resolutionOption.label === option.label
      )
    })
  }, [configuredImageResolutionOptions, configuredImageSizeOptions])
  const videoSpecKey = React.useMemo(
    () => buildVideoSpecKey(effectiveVideoResolution, videoDuration),
    [effectiveVideoResolution, videoDuration],
  )
  const [editingShotSourceIndex, setEditingShotSourceIndex] = React.useState<number | null>(null)
  const editingShotSourceIndexRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    editingShotSourceIndexRef.current = editingShotSourceIndex
  }, [editingShotSourceIndex])
  const handlePoseSaved = React.useCallback(
    ({ mode, poseStickmanUrl: stickmanUrl, poseReferenceImages: refs, baseImageUrl, maskUrl, prompt: posePrompt, imageEditSize: nextImageEditSizeRaw, resizedImageUrl }: { mode: 'pose' | 'depth' | 'size'; poseStickmanUrl: string | null; poseReferenceImages: string[]; baseImageUrl: string; maskUrl?: string | null; prompt?: string; imageEditSize?: string; resizedImageUrl?: string | null }) => {
      const normalizedBaseImageUrl = String(baseImageUrl || '').trim()
      const normalizedRefs = Array.from(
        new Set(
          [
            normalizedBaseImageUrl,
            ...(refs || []).map((x) => String(x || '').trim()),
          ].filter(Boolean),
        ),
      )
      const effectivePrompt = (posePrompt || prompt || (data as any)?.prompt || '').trim()
      const normalizedMaskGuideUrl = mode === 'depth' ? String(maskUrl || '').trim() : ''
      const normalizedEditRefs = normalizedMaskGuideUrl
        ? [...normalizedRefs.filter((url) => url !== normalizedMaskGuideUrl).slice(0, 7), normalizedMaskGuideUrl]
        : normalizedRefs.slice(0, 8)
      const imageEditPrompt = appendImageEditFocusGuidePrompt(
        effectivePrompt || '保持原构图，修复不合理细节并提升质量',
        Boolean(normalizedMaskGuideUrl),
      )
      const nextImageEditSize = normalizeImageEditSize(nextImageEditSizeRaw || imageEditSize)
      const nextImageEditAspect = toAspectRatioFromImageEditSize(nextImageEditSize)
      const nextImageEditDimensions = parseImageEditSizeDimensions(nextImageEditSize)
      const normalizedResizedImageUrl = String(resizedImageUrl || '').trim()
      const requestedTargetIndex =
        typeof editingShotSourceIndexRef.current === 'number' && editingShotSourceIndexRef.current >= 0
          ? editingShotSourceIndexRef.current
          : (typeof (data as any)?.imagePrimaryIndex === 'number' && (data as any).imagePrimaryIndex >= 0
              ? (data as any).imagePrimaryIndex
              : 0)
      const shouldOverwriteInPlace =
        typeof editingShotSourceIndexRef.current === 'number'

      if (mode === 'size' && shouldOverwriteInPlace) {
        if (!normalizedResizedImageUrl) {
          toast('尺寸调整失败：未返回新图地址', 'error')
          return
        }
        const currentResults = Array.isArray((data as any)?.imageResults) ? ([...(data as any).imageResults] as any[]) : []
        const resolvedTargetIndex = currentResults[requestedTargetIndex]
          ? requestedTargetIndex
          : (typeof (data as any)?.imagePrimaryIndex === 'number' && currentResults[(data as any).imagePrimaryIndex]
              ? (data as any).imagePrimaryIndex
              : 0)
        const prev = currentResults[resolvedTargetIndex] || {}
        if (currentResults.length > 0) {
          currentResults[resolvedTargetIndex] = { ...prev, url: normalizedResizedImageUrl }
        } else {
          currentResults.push({ url: normalizedResizedImageUrl })
        }
        updateNodeData(id, {
          imageResults: currentResults,
          imageUrl: normalizedResizedImageUrl,
          imagePrimaryIndex: resolvedTargetIndex,
          imageEditSize: nextImageEditSize,
          size: nextImageEditSize,
          aspect: nextImageEditAspect,
        })
        toast(`镜头 ${resolvedTargetIndex + 1} 已按 ${nextImageEditSize} 尺寸更新`, 'success')
        return
      }

      if (shouldOverwriteInPlace) {
        const run = async () => {
          try {
            const ui = useUIStore.getState()
            const persist = ui.assetPersistenceEnabled
            const resolvedImageModel = await resolveExecutableImageModel({
              kind: 'imageEdit',
              value: imageModel,
              allowBackendDefault: true,
            })
            const modelKey = resolvedImageModel.value
            if (resolvedImageModel.shouldWriteBack) {
              setImageModel(modelKey)
              updateNodeData(id, {
                imageModel: modelKey,
                imageModelVendor: null,
              })
            }
            const aspectRatio = nextImageEditAspect || normalizeImageAspect((data as any)?.aspect)
            let effectiveEditReferenceImages = normalizedEditRefs
            let referenceSheetMeta: Record<string, unknown> | null = null
            const { nodes, edges } = useRFStore.getState()
            const runtimeReferenceAssetInputs = mergeReferenceAssetInputs({
              assetInputs: (data as Record<string, unknown>)?.assetInputs,
              dynamicEntries: collectDynamicUpstreamReferenceEntriesForNode(nodes, edges, id),
              referenceImages: effectiveEditReferenceImages,
              limit: 8,
            })
            if (normalizedEditRefs.length > 2) {
              try {
                const mergedReferenceSheet = await uploadMergedReferenceSheet({
                  id,
                  entries: buildNamedReferenceEntries({
                    assetInputs: runtimeReferenceAssetInputs,
                    referenceImages: normalizedEditRefs,
                    fallbackPrefix: 'ref',
                    limit: 8,
                  }),
                  prompt: imageEditPrompt,
                  vendor: resolvedImageModel.vendor || 'auto',
                  modelKey,
                  taskKind: 'image_edit',
                })
                if (mergedReferenceSheet) {
                  effectiveEditReferenceImages = [mergedReferenceSheet.url]
                  referenceSheetMeta = {
                    kind: 'collage',
                    url: mergedReferenceSheet.url,
                    sourceUrls: mergedReferenceSheet.sourceUrls,
                    entries: mergedReferenceSheet.entries.map((entry) => ({
                      id: entry.label,
                      sourceUrl: entry.sourceUrl,
                      ...(entry.assetId ? { assetId: entry.assetId } : null),
                      ...(entry.note ? { note: entry.note } : null),
                    })),
                  }
                }
              } catch (error) {
                console.warn('[TaskNode] merge image edit references failed', error)
              }
            }
            const effectiveEditAssetInputs = mergeReferenceAssetInputs({
              assetInputs: runtimeReferenceAssetInputs,
              dynamicEntries: collectDynamicUpstreamReferenceEntriesForNode(nodes, edges, id),
              referenceImages: effectiveEditReferenceImages,
              limit: 8,
            })
            const internalImageEditPrompt = appendReferenceAliasSlotPrompt({
              prompt: imageEditPrompt,
              assetInputs: effectiveEditAssetInputs,
              referenceImages: effectiveEditReferenceImages,
              enabled: effectiveEditReferenceImages.length > 0 && !referenceSheetMeta,
            })
            let nextUrl = ''

            if (!nextUrl) {
              const taskRes = await runPublicTask({
                request: {
                  kind: 'image_edit',
                  prompt: internalImageEditPrompt,
                  ...nextImageEditDimensions,
                  extras: {
                    nodeKind: kind,
                    nodeId: id,
                    modelKey,
                    aspectRatio,
                    imageEditSize: nextImageEditSize,
                    size: nextImageEditSize,
                    resolution: nextImageEditSize,
                    image_size: nextImageEditSize,
                    referenceImages: effectiveEditReferenceImages,
                    ...(effectiveEditAssetInputs.length ? { assetInputs: effectiveEditAssetInputs } : {}),
                    ...(referenceSheetMeta ? { referenceSheet: referenceSheetMeta } : {}),
                    persistAssets: persist,
                  },
                },
              })

              let result = taskRes.result
              const taskId = String(result?.id || '').trim()
              if ((result.status === 'queued' || result.status === 'running') && taskId) {
                for (let i = 0; i < 24; i += 1) {
                  await new Promise((r) => window.setTimeout(r, 1500))
                  const polled = await fetchPublicTaskResult({
                    taskId,
                    vendor: taskRes.vendor,
                    taskKind: 'image_edit',
                    prompt: internalImageEditPrompt,
                  })
                  result = polled.result
                  if (result.status === 'succeeded' || result.status === 'failed') break
                }
              }

              if (result.status !== 'succeeded') {
                throw new Error('单镜头微调失败：任务未成功完成')
              }
              const imageAsset =
                (Array.isArray(result.assets) ? result.assets.find((a) => a.type === 'image' && a.url) : null) ||
                (Array.isArray(result.assets) ? result.assets.find((a) => !!a?.url) : null) ||
                null
              nextUrl = typeof imageAsset?.url === 'string' ? imageAsset.url.trim() : ''
            }
            if (!nextUrl) {
              throw new Error('单镜头微调失败：未返回图片地址')
            }

            const currentResults = Array.isArray((data as any)?.imageResults) ? ([...(data as any).imageResults] as any[]) : []
            const resolvedTargetIndex = currentResults[requestedTargetIndex]
              ? requestedTargetIndex
              : (typeof (data as any)?.imagePrimaryIndex === 'number' && currentResults[(data as any).imagePrimaryIndex]
                  ? (data as any).imagePrimaryIndex
                  : 0)
            const prev = currentResults[resolvedTargetIndex] || {}
            if (currentResults.length > 0) {
              currentResults[resolvedTargetIndex] = { ...prev, url: nextUrl }
            } else {
              currentResults.push({ url: nextUrl })
            }
            const currentPrimary = typeof (data as any)?.imagePrimaryIndex === 'number' ? (data as any).imagePrimaryIndex : 0
            updateNodeData(id, {
              imageResults: currentResults,
              ...(currentPrimary === resolvedTargetIndex || !((data as any)?.imageUrl)
                ? { imageUrl: nextUrl, imagePrimaryIndex: resolvedTargetIndex }
                : {}),
              poseStickmanUrl: stickmanUrl || null,
              poseReferenceImages: normalizedRefs,
              poseMaskUrl: normalizedMaskGuideUrl || null,
              ...(effectivePrompt ? { prompt: effectivePrompt } : {}),
              imageEditSize: nextImageEditSize,
              size: nextImageEditSize,
              aspect: nextImageEditAspect,
            })
            toast(`镜头 ${resolvedTargetIndex + 1} 已更新（覆盖当前节点）`, 'success')
          } catch (err: any) {
            toast(err?.message || '单镜头更新失败', 'error')
          } finally {
            editingShotSourceIndexRef.current = null
            setEditingShotSourceIndex(null)
          }
        }
        void run()
        return
      }

      const stateBefore = useRFStore.getState()
      const beforeIds = new Set(stateBefore.nodes.map((n) => n.id))
      if (mode === 'size') {
        if (!normalizedResizedImageUrl) {
          toast('尺寸调整失败：未返回新图地址', 'error')
          return
        }
        const stateBefore = useRFStore.getState()
        const beforeIds = new Set(stateBefore.nodes.map((n) => n.id))
        addNode('taskNode', undefined, {
          kind: 'image',
          prompt: effectivePrompt,
          aspect: nextImageEditAspect,
          sampleCount: 1,
          imageUrl: normalizedResizedImageUrl,
          imageResults: [{ url: normalizedResizedImageUrl }],
          imagePrimaryIndex: 0,
          imageModel: String(imageModel || getDefaultModel('image')).trim() || getDefaultModel('image'),
          imageModelVendor: null,
          imageEditSize: nextImageEditSize,
          size: nextImageEditSize,
        })
        const afterAdd = useRFStore.getState()
        const newNode = afterAdd.nodes.find((n) => !beforeIds.has(n.id))
        if (!newNode) {
          toast('尺寸调整已完成，但未能创建新图像节点', 'error')
          return
        }
        const sourceNode = afterAdd.nodes.find((n) => n.id === id)
        const targetPos = {
          x: (sourceNode?.position?.x || 0) + 380,
          y: sourceNode?.position?.y || 0,
        }
        afterAdd.onNodesChange([
          { id: newNode.id, type: 'position', position: targetPos, dragging: false },
          { id: newNode.id, type: 'select', selected: true },
        ])
        afterAdd.onConnect({
          source: id,
          sourceHandle: 'out-image',
          target: newNode.id,
          targetHandle: 'in-image',
        })
        toast(`已生成 ${nextImageEditSize} 新图`, 'success')
        return
      }

      const targetKind = 'imageEdit'
      const fallbackModel = getDefaultModel('imageEdit')
      const editableModel = String(imageModel || fallbackModel).trim() || fallbackModel

      addNode('taskNode', undefined, {
        kind: targetKind,
        prompt: effectivePrompt,
        aspect: nextImageEditAspect,
        sampleCount,
        imageModel: editableModel,
        imageModelVendor: null,
        imageEditSize: nextImageEditSize,
        size: nextImageEditSize,
        poseStickmanUrl: stickmanUrl || null,
        poseReferenceImages: normalizedRefs.slice(0, 8),
        poseMaskUrl: normalizedMaskGuideUrl || null,
      })

      const afterAdd = useRFStore.getState()
      const newNode = afterAdd.nodes.find((n) => !beforeIds.has(n.id))
      if (!newNode) {
        toast('图片编辑已保存，但未能创建新图像节点', 'error')
        return
      }

      const sourceNode = afterAdd.nodes.find((n) => n.id === id)
      const targetPos = {
        x: (sourceNode?.position?.x || 0) + 380,
        y: sourceNode?.position?.y || 0,
      }
      afterAdd.onNodesChange([
        { id: newNode.id, type: 'position', position: targetPos, dragging: false },
        { id: newNode.id, type: 'select', selected: true },
      ])
      afterAdd.onConnect({
        source: id,
        sourceHandle: 'out-image',
        target: newNode.id,
        targetHandle: 'in-image',
      })

      if (!effectivePrompt) {
        toast('已创建新图片编辑节点，请填写提示词后再运行', 'info')
        return
      }

      runNodeDagToTarget(newNode.id, useRFStore.getState, useRFStore.setState, { concurrency: 1 }).catch((err) => {
        console.error('auto run pose image failed', err)
        toast(err?.message || '新图片编辑生成启动失败', 'error')
      })
    },
    [addNode, currentProject?.id, data, editingShotSourceIndex, findVendorForModel, id, imageEditSize, imageModel, kind, prompt, sampleCount, updateNodeData],
  )

  const { open: openPoseEditor, modal: poseEditorModal } = usePoseEditor({
    nodeId: id,
    baseImageUrl: basePoseImage,
    poseReferenceImages,
    poseStickmanUrl,
    promptValue: prompt,
    onPromptSave: (next) => {
      setPrompt(next)
      updateNodeData(id, { prompt: next })
    },
    imageEditSize,
    imageEditSizeOptions: imageEditResolutionOptions,
    onImageEditSizeChange: (next) => {
      const normalized = normalizeImageEditSize(next)
      setImageEditSize(normalized)
      updateNodeData(id, {
        imageEditSize: normalized,
        size: normalized,
        aspect: toAspectRatioFromImageEditSize(normalized),
      })
    },
    canvasResizeSize,
    onCanvasResizeSizeChange: (next) => {
      const normalized = normalizeCanvasResizeSize(next)
      setCanvasResizeSize(normalized)
      updateNodeData(id, { canvasResizeSize: normalized })
    },
    hasImages: imageResults.length > 0,
    isDarkUi,
    inlineDividerColor,
    updateNodeData,
    onPoseSaved: handlePoseSaved,
  })

  const [mosaicModalOpen, setMosaicModalOpen] = React.useState(false)
  const [mosaicInvalidUrls, setMosaicInvalidUrls] = React.useState<string[]>([])
  const [mosaicLayoutMode, setMosaicLayoutMode] = React.useState<'square' | 'columns'>(() => (
    (data as any)?.mosaicLayoutMode === 'columns' ? 'columns' : 'square'
  ))
  const [mosaicGrid, setMosaicGrid] = React.useState<number>(() => {
    const stored = (data as any)?.mosaicGrid
    return typeof stored === 'number' && stored >= 1 && stored <= 3 ? stored : 2
  })
  const [mosaicColumns, setMosaicColumns] = React.useState<number>(() => {
    const raw = Number((data as any)?.mosaicColumns)
    return Number.isFinite(raw) && raw >= 1 && raw <= 6 ? Math.trunc(raw) : 3
  })
  const [mosaicSelected, setMosaicSelected] = React.useState<string[]>(() => {
    const imgs = Array.isArray((data as any)?.mosaicImages)
      ? ((data as any)?.mosaicImages as any[]).map((i) => (typeof i?.url === 'string' ? i.url : null)).filter(Boolean)
      : []
    return imgs.length ? imgs.slice(0, 30) : []
  })
  const [mosaicCellSize, setMosaicCellSize] = React.useState<number>(() => {
    const raw = Number((data as any)?.mosaicCellSize)
    return Number.isFinite(raw) && raw >= 256 && raw <= 2048 ? Math.trunc(raw) : 480
  })
  const [mosaicDividerWidth, setMosaicDividerWidth] = React.useState<number>(() => {
    const raw = Number((data as any)?.mosaicDividerWidth)
    return Number.isFinite(raw) && raw >= 0 && raw <= 24 ? raw : 0
  })
  const [mosaicDividerColor, setMosaicDividerColor] = React.useState<string>(() => {
    const raw = String((data as any)?.mosaicDividerColor || '').trim()
    return raw || '#ffffff'
  })
  const [mosaicBackgroundColor, setMosaicBackgroundColor] = React.useState<string>(() => {
    const raw = String((data as any)?.mosaicBackgroundColor || '').trim()
    return raw || '#0b1224'
  })
  const [mosaicTitle, setMosaicTitle] = React.useState<string>(() => String((data as any)?.mosaicTitle || ''))
  const [mosaicSubtitle, setMosaicSubtitle] = React.useState<string>(() => String((data as any)?.mosaicSubtitle || ''))
  const [mosaicTitleColor, setMosaicTitleColor] = React.useState<string>(() => {
    const raw = String((data as any)?.mosaicTitleColor || '').trim()
    return raw || '#f8fafc'
  })
  const [mosaicSubtitleColor, setMosaicSubtitleColor] = React.useState<string>(() => {
    const raw = String((data as any)?.mosaicSubtitleColor || '').trim()
    return raw || '#cbd5e1'
  })
  const mosaicLimit = mosaicLayoutMode === 'columns' ? 30 : mosaicGrid * mosaicGrid
  const allImages = React.useMemo(() => {
    if (!isMosaicNode || !mosaicModalOpen) return []
    const urls: string[] = []
    const push = (url: unknown) => {
      if (typeof url !== 'string') return
      const trimmed = url.trim()
      if (trimmed) urls.push(trimmed)
    }
    const stateNodes = useRFStore.getState().nodes
    stateNodes.forEach((node) => {
      const nodeData = node.data || {}
      push((nodeData as any).imageUrl)
      if (Array.isArray((nodeData as any).imageResults)) {
        ;((nodeData as any).imageResults as Array<{ url?: unknown }>).forEach((item) => push(item?.url))
      }
    })
    return Array.from(new Set(urls))
  }, [isMosaicNode, mosaicModalOpen])
  const availableImages = React.useMemo(() => {
    const filtered = allImages.filter((url) => !mosaicInvalidUrls.includes(url))
    if (mosaicSelected.length) {
      const selectedSet = new Set(mosaicSelected)
      const rest = filtered.filter((url) => !selectedSet.has(url))
      return [...mosaicSelected, ...rest]
    }
    return filtered
  }, [allImages, mosaicInvalidUrls, mosaicSelected])
  const [mosaicPreviewUrl, setMosaicPreviewUrl] = React.useState<string | null>(null)
  const [mosaicPreviewError, setMosaicPreviewError] = React.useState<string | null>(null)
  const [mosaicPreviewLoading, setMosaicPreviewLoading] = React.useState(false)
  const buildMosaicPreview = React.useCallback(async (
    urls: string[],
    grid: number,
    options?: {
      cellSize?: number
      dividerWidth?: number
      dividerColor?: string
      layoutMode?: 'square' | 'columns'
      columns?: number
      backgroundColor?: string
      title?: string
      subtitle?: string
      titleColor?: string
      subtitleColor?: string
    },
  ) => {
    const { buildMosaicCanvas } = await import('../../runner/mosaicRunner')
    setMosaicPreviewLoading(true)
    setMosaicPreviewError(null)
    try {
      const { canvas, failedUrls } = await buildMosaicCanvas(urls, grid || 2, {
        cellSize: options?.cellSize,
        dividerWidth: options?.dividerWidth,
        dividerColor: options?.dividerColor,
        layoutMode: options?.layoutMode,
        columns: options?.columns,
        backgroundColor: options?.backgroundColor,
        title: options?.title,
        subtitle: options?.subtitle,
        titleColor: options?.titleColor,
        subtitleColor: options?.subtitleColor,
      })
      setMosaicPreviewUrl(canvas.toDataURL('image/png'))
      if (failedUrls.length) {
        setMosaicPreviewError(`已移除 ${failedUrls.length} 张过期或不可访问的图片`)
        setMosaicSelected((prev) => prev.filter((url) => !failedUrls.includes(url)))
        setMosaicInvalidUrls((prev) => Array.from(new Set([...prev, ...failedUrls])))
      }
    } catch (error: unknown) {
      console.warn('mosaic preview failed', error)
      setMosaicPreviewUrl(null)
      const failedUrls = Array.isArray((error as { failedUrls?: unknown })?.failedUrls)
        ? ((error as { failedUrls: string[] }).failedUrls)
        : []
      if (failedUrls.length) {
        setMosaicSelected((prev) => prev.filter((url) => !failedUrls.includes(url)))
        setMosaicInvalidUrls((prev) => Array.from(new Set([...prev, ...failedUrls])))
      }
      const message = error instanceof Error ? error.message : '预览生成失败，请检查图片是否可跨域访问'
      setMosaicPreviewError(message)
    } finally {
      setMosaicPreviewLoading(false)
    }
  }, [])
  const handleMosaicToggle = React.useCallback(
    (url: string, checked?: boolean) => {
      if (!url) return
      if (mosaicInvalidUrls.includes(url)) {
        toast('该图片已失效，请选择其他图片', 'error')
        return
      }
      setMosaicSelected((prev) => {
        const nextChecked = typeof checked === 'boolean' ? checked : !prev.includes(url)
        if (nextChecked) {
          if (prev.includes(url)) return prev
          const next = [...prev, url]
          if (next.length > mosaicLimit) return prev
          return next
        }
        return prev.filter((item) => item !== url)
      })
    },
    [mosaicInvalidUrls, mosaicLimit],
  )
  const moveMosaicItem = React.useCallback((url: string, dir: number) => {
    setMosaicSelected((prev) => {
      const idx = prev.findIndex((item) => item === url)
      if (idx < 0) return prev
      const nextIdx = idx + dir
      if (nextIdx < 0 || nextIdx >= prev.length) return prev
      const next = [...prev]
      const current = next[idx]
      next[idx] = next[nextIdx]
      next[nextIdx] = current
      return next
    })
  }, [])
  const handleMosaicSave = React.useCallback(async () => {
    const picked = mosaicSelected.slice(0, mosaicLimit)
    if (!picked.length) {
      toast('请至少选择 1 张图片', 'error')
      return
    }
    try {
      const { buildMosaicCanvas } = await import('../../runner/mosaicRunner')
      const result = await buildMosaicCanvas(picked, mosaicGrid, {
        cellSize: mosaicCellSize,
        dividerWidth: mosaicDividerWidth,
        dividerColor: mosaicDividerColor,
        layoutMode: mosaicLayoutMode,
        columns: mosaicColumns,
        backgroundColor: mosaicBackgroundColor,
        title: mosaicTitle,
        subtitle: mosaicSubtitle,
        titleColor: mosaicTitleColor,
        subtitleColor: mosaicSubtitleColor,
      })
      if (result.failedUrls.length) {
        setMosaicSelected((prev) => prev.filter((url) => !result.failedUrls.includes(url)))
        setMosaicInvalidUrls((prev) => Array.from(new Set([...prev, ...result.failedUrls])))
        toast(`已移除 ${result.failedUrls.length} 张过期图片，已用剩余图片拼图`, 'info')
      }
      const blob: Blob = await new Promise((resolve, reject) => {
        try {
          result.canvas.toBlob((canvasBlob) => {
            if (canvasBlob) resolve(canvasBlob)
            else reject(new Error('未生成拼图结果'))
          }, 'image/png')
        } catch (error) {
          reject(error)
        }
      })
      const fileName = `mosaic-${Date.now()}.png`
      const file = new File([blob], fileName, { type: 'image/png' })
      const hosted = await uploadServerAssetFile(file, fileName, { taskKind: 'mosaic' })
      const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
      if (!hostedUrl) throw new Error('拼图已生成，但上传到 OSS 失败')

      const existing = Array.isArray((data as any)?.imageResults) ? (data as any)?.imageResults : []
      const sanitizedExisting = existing.filter((item: unknown) => {
        const url = typeof (item as { url?: unknown })?.url === 'string' ? String((item as { url: string }).url).trim() : ''
        return Boolean(url) && REMOTE_IMAGE_URL_REGEX.test(url)
      })
      const merged = [...sanitizedExisting, { url: hostedUrl, title: mosaicTitle || '拼图' }]
      const primaryIndex = merged.length - 1
      setNodeStatus(id, 'success', {
        progress: 100,
        imageUrl: hostedUrl,
        imageResults: merged,
        imagePrimaryIndex: primaryIndex,
        serverAssetId: hosted.id,
        mosaicImages: picked.map((url) => ({ url })),
        mosaicGrid,
        mosaicColumns,
        mosaicLimit,
        mosaicLayoutMode,
        mosaicCellSize,
        mosaicDividerWidth,
        mosaicDividerColor,
        mosaicBackgroundColor,
        mosaicTitle,
        mosaicSubtitle,
        mosaicTitleColor,
        mosaicSubtitleColor,
        lastResult: {
          id,
          at: Date.now(),
          kind: 'mosaic',
          preview: { type: 'image', src: hostedUrl },
        },
      })
      setMosaicModalOpen(false)
      toast('拼图已更新', 'success')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '拼图生成失败'
      toast(message, 'error')
    }
  }, [
    data,
    id,
    mosaicBackgroundColor,
    mosaicCellSize,
    mosaicColumns,
    mosaicDividerColor,
    mosaicDividerWidth,
    mosaicGrid,
    mosaicLayoutMode,
    mosaicLimit,
    mosaicSelected,
    mosaicSubtitle,
    mosaicSubtitleColor,
    mosaicTitle,
    mosaicTitleColor,
    setNodeStatus,
  ])

  React.useEffect(() => {
    const picked = mosaicSelected.slice(0, mosaicLimit)
    if (!picked.length) {
      setMosaicPreviewUrl(null)
      setMosaicPreviewError(null)
      return
    }
    buildMosaicPreview(picked, mosaicGrid, {
      cellSize: mosaicCellSize,
      dividerWidth: mosaicDividerWidth,
      dividerColor: mosaicDividerColor,
      layoutMode: mosaicLayoutMode,
      columns: mosaicColumns,
      backgroundColor: mosaicBackgroundColor,
      title: mosaicTitle,
      subtitle: mosaicSubtitle,
      titleColor: mosaicTitleColor,
      subtitleColor: mosaicSubtitleColor,
    })
  }, [
    buildMosaicPreview,
    mosaicBackgroundColor,
    mosaicCellSize,
    mosaicColumns,
    mosaicDividerColor,
    mosaicDividerWidth,
    mosaicGrid,
    mosaicLayoutMode,
    mosaicLimit,
    mosaicSelected,
    mosaicSubtitle,
    mosaicSubtitleColor,
    mosaicTitle,
    mosaicTitleColor,
  ])
  React.useEffect(() => {
    setMosaicSelected((prev) => prev.slice(0, mosaicLimit))
  }, [mosaicLimit])

  React.useEffect(() => {
    if (!mosaicModalOpen) return
    setMosaicLayoutMode((data as any)?.mosaicLayoutMode === 'columns' ? 'columns' : 'square')
    const storedGrid = (data as any)?.mosaicGrid
    setMosaicGrid(typeof storedGrid === 'number' && storedGrid >= 1 && storedGrid <= 3 ? storedGrid : 2)
    const storedColumns = Number((data as any)?.mosaicColumns)
    setMosaicColumns(Number.isFinite(storedColumns) && storedColumns >= 1 && storedColumns <= 6 ? Math.trunc(storedColumns) : 3)
    const storedCellSize = Number((data as any)?.mosaicCellSize)
    setMosaicCellSize(Number.isFinite(storedCellSize) && storedCellSize >= 256 && storedCellSize <= 2048 ? Math.trunc(storedCellSize) : 480)
    const storedDividerWidth = Number((data as any)?.mosaicDividerWidth)
    setMosaicDividerWidth(Number.isFinite(storedDividerWidth) && storedDividerWidth >= 0 && storedDividerWidth <= 24 ? storedDividerWidth : 0)
    const storedDividerColor = String((data as any)?.mosaicDividerColor || '').trim()
    setMosaicDividerColor(storedDividerColor || '#ffffff')
    const storedBackgroundColor = String((data as any)?.mosaicBackgroundColor || '').trim()
    setMosaicBackgroundColor(storedBackgroundColor || '#0b1224')
    setMosaicTitle(String((data as any)?.mosaicTitle || ''))
    setMosaicSubtitle(String((data as any)?.mosaicSubtitle || ''))
    const storedTitleColor = String((data as any)?.mosaicTitleColor || '').trim()
    setMosaicTitleColor(storedTitleColor || '#f8fafc')
    const storedSubtitleColor = String((data as any)?.mosaicSubtitleColor || '').trim()
    setMosaicSubtitleColor(storedSubtitleColor || '#cbd5e1')
    const imgs = Array.isArray((data as any)?.mosaicImages)
      ? ((data as any)?.mosaicImages as any[]).map((i) => (typeof i?.url === 'string' ? i.url : null)).filter(Boolean)
      : []
    if (imgs.length) {
      setMosaicSelected(imgs.slice(0, (data as any)?.mosaicLayoutMode === 'columns' ? 30 : ((typeof storedGrid === 'number' && storedGrid >= 1 && storedGrid <= 3 ? storedGrid : 2) ** 2)))
    }
  }, [data, mosaicModalOpen])

  const rewriteModelOptions = useModelOptions('text')
  const rewriteModelSelectOptions = React.useMemo<ModelOption[]>(
    () => rewriteModelOptions.map((option) => ({
      ...option,
      label: getTaskNodeModelDisplayLabel(option),
    })),
    [rewriteModelOptions],
  )
  const resolvePromptRefineModelAlias = React.useCallback(() => {
    const candidates = [
      String((data as any)?.geminiModel || '').trim(),
      String(modelKey || '').trim(),
    ].filter(Boolean)
    for (const candidate of candidates) {
      const matched = findModelOptionByIdentifier(rewriteModelOptions, candidate)
      if (!matched) continue
      const resolved = getModelOptionRequestAlias(rewriteModelOptions, matched.value)
      if (resolved) return resolved
    }
    const firstTextModel = rewriteModelOptions.find((opt) => typeof opt?.value === 'string' && opt.value.trim())
    return getModelOptionRequestAlias(rewriteModelOptions, firstTextModel?.value) || ''
  }, [data, modelKey, rewriteModelOptions])
  const refineStructuredPromptFromText = React.useCallback(async (basePrompt?: string) => {
    const nextPrompt = typeof basePrompt === 'string' ? basePrompt.trim() : prompt.trim()
    if (!nextPrompt) {
      throw new Error('请先输入提示词，再切到 JSON 模式')
    }

    return refineStructuredImagePrompt({
      prompt: nextPrompt,
      negativePrompt: String((data as Record<string, unknown>)?.negativePrompt || '').trim(),
      systemPrompt,
      modelAlias: resolvePromptRefineModelAlias(),
    })
  }, [data, prompt, resolvePromptRefineModelAlias, systemPrompt])
  const handleCommitStructuredPrompt = React.useCallback((patch: {
    structuredPrompt: Record<string, unknown>
    prompt: string
  }) => {
    setPrompt(patch.prompt)
    updateNodeData(id, {
      structuredPrompt: patch.structuredPrompt,
      prompt: patch.prompt,
      promptEditorMode: 'structured',
    })
  }, [id, updateNodeData])
  const handleEnableStructuredPromptMode = React.useCallback(async () => {
    if (!canUseStructuredPromptEditor || structuredPromptRefineLoading) return

    const currentPrompt = prompt.trim()
    const existingCompiledPrompt = structuredPromptValue
      ? resolveCompiledImagePrompt({
        structuredPrompt: structuredPromptValue,
        promptEditorMode: 'structured',
      }).trim()
      : ''

    if (!currentPrompt && existingCompiledPrompt) {
      setPrompt(existingCompiledPrompt)
      updateNodeData(id, {
        structuredPrompt: structuredPromptValue,
        prompt: existingCompiledPrompt,
        promptEditorMode: 'structured',
      })
      return
    }

    if (!currentPrompt) {
      toast('请先输入提示词，再切到 JSON 模式', 'warning')
      return
    }

    if (
      structuredPromptValue &&
      existingCompiledPrompt &&
      existingCompiledPrompt === currentPrompt
    ) {
      updateNodeData(id, {
        structuredPrompt: structuredPromptValue,
        prompt: existingCompiledPrompt,
        promptEditorMode: 'structured',
      })
      return
    }

    try {
      setStructuredPromptRefineLoading(true)
      const nextStructuredPrompt = await refineStructuredPromptFromText(currentPrompt)
      const nextCompiledPrompt = resolveCompiledImagePrompt({
        structuredPrompt: nextStructuredPrompt,
        promptEditorMode: 'structured',
      }).trim()
      setPrompt(nextCompiledPrompt)
      updateNodeData(id, {
        structuredPrompt: nextStructuredPrompt,
        prompt: nextCompiledPrompt,
        promptEditorMode: 'structured',
      })
      toast('已切换为 JSON 提示词模式', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成结构化 JSON 失败'
      toast(message, 'error')
    } finally {
      setStructuredPromptRefineLoading(false)
    }
  }, [
    canUseStructuredPromptEditor,
    id,
    prompt,
    refineStructuredPromptFromText,
    structuredPromptRefineLoading,
    structuredPromptValue,
    updateNodeData,
  ])
  const handleStructuredPromptModeChange = React.useCallback((next: boolean) => {
    if (next) {
      void handleEnableStructuredPromptMode()
      return
    }
    updateNodeData(id, { promptEditorMode: 'text' })
  }, [handleEnableStructuredPromptMode, id, updateNodeData])
  const baseShowTimeMenu = hasDuration
  const baseShowResolutionMenu = isVideoNode
    ? configuredSizeOptions.length > 0 || hasAspect
    : imageModelConfig
      ? configuredImageAspectOptions.length > 0
      : hasAspect
  const videoFramingControlledBySize = Boolean(isVideoNode && baseShowResolutionMenu)
  const baseShowOrientationMenu = isVideoNode
    ? !videoFramingControlledBySize && (hasOrientation || configuredOrientationOptions.length > 0)
    : hasOrientation
  React.useEffect(() => {
    if (!modelList.length) return
    const matched = findModelOptionByIdentifier(modelList, activeModelKey)
    const next = matched || modelList[0]
    if (!next) return
    const nextRequestedModel = resolveRequestedModelIdentifier(next.value)
    if (!nextRequestedModel) return
    if (String(activeModelKey || '').trim() === nextRequestedModel) return
    setModelKey(nextRequestedModel)
    setImageModel(nextRequestedModel)
    setVideoModel(nextRequestedModel)
    updateNodeData(id, {
      geminiModel: nextRequestedModel,
      imageModel: nextRequestedModel,
      videoModel: nextRequestedModel,
      modelVendor: next.vendor || null,
      imageModelVendor: null,
      videoModelVendor: next.vendor || null,
    })
  }, [activeModelKey, modelList, id, resolveRequestedModelIdentifier, updateNodeData])

  React.useEffect(() => {
    if (!isVideoNode) return
    const dataRecord =
      data && typeof data === 'object'
        ? (data as Record<string, unknown>)
        : {}
    const nextDuration = readVideoDurationSeconds(dataRecord, 5)
    setVideoDuration((prev) => (prev === nextDuration ? prev : nextDuration))
  }, [data, isVideoNode])

  React.useEffect(() => {
    if (!isVideoNode || !videoModelConfig) return

    const patch: Record<string, unknown> = {}
    const nextDuration = pickVideoDurationValue(videoModelConfig, videoDuration)
    if (nextDuration !== null && nextDuration !== videoDuration) {
      setVideoDuration(nextDuration)
      Object.assign(patch, buildVideoDurationPatch(nextDuration))
    }

    const nextSize = pickVideoSizeValue(videoModelConfig, videoSize)
    if (nextSize !== null && nextSize !== videoSize) {
      setVideoSize(nextSize)
      patch.videoSize = nextSize
    }

    const nextResolution = pickVideoResolutionValue(videoModelConfig, videoResolution)
    if (nextResolution !== null && nextResolution !== videoResolution) {
      setVideoResolution(nextResolution)
      patch.videoResolution = nextResolution
    }
    const resolvedDuration = nextDuration ?? videoDuration
    const resolvedResolution = normalizeVideoResolution(nextResolution ?? videoResolution)
    const nextSpecKey = buildVideoSpecKey(resolvedResolution, resolvedDuration)
    if (nextSpecKey) {
      patch.videoSpecKey = nextSpecKey
      patch.specKey = nextSpecKey
    }

    const sizeRule = nextSize
      ? videoModelConfig.sizeOptions.find((option) => option.value === nextSize) || null
      : null

    const nextAspectFromConfig = sizeRule?.aspectRatio
      ? normalizeImageAspect(sizeRule.aspectRatio)
      : null
    const nextOrientationFromConfig = resolveVideoOrientationValue({
      currentOrientation: pickVideoOrientationValue(videoModelConfig, orientationRef.current),
      size: nextSize || videoSize,
      aspect: nextAspectFromConfig || aspect,
      config: videoModelConfig,
    })
    if (nextOrientationFromConfig && nextOrientationFromConfig !== orientationRef.current) {
      orientationRef.current = nextOrientationFromConfig
      setOrientation(nextOrientationFromConfig)
      patch.orientation = nextOrientationFromConfig
    }

    if (nextAspectFromConfig && nextAspectFromConfig !== aspect) {
      setAspect(nextAspectFromConfig)
      patch.aspect = nextAspectFromConfig
    }

    if (Object.keys(patch).length) {
      updateNodeData(id, patch)
    }
  }, [aspect, id, isVideoNode, updateNodeData, videoDuration, videoModelConfig, videoResolution, videoSize])

  React.useEffect(() => {
    if (isVideoNode || !imageModelConfig) return

    const patch: Record<string, unknown> = {}
    const nextAspect = pickImageAspectValue(imageModelConfig, aspect)
    if (nextAspect && nextAspect !== aspect) {
      setAspect(nextAspect)
      patch.aspect = nextAspect
    }

    const nextImageSize = pickImageSizeValue(imageModelConfig, imageSize)
    if (nextImageSize && nextImageSize !== imageSize) {
      setImageSize(nextImageSize)
      patch.imageSize = nextImageSize
    }

    const nextImageResolution = pickImageResolutionValue(imageModelConfig, imageResolution)
    if (nextImageResolution && nextImageResolution !== imageResolution) {
      setImageResolution(nextImageResolution)
      patch.imageResolution = nextImageResolution
      patch.resolution = nextImageResolution
    }

    if (Object.keys(patch).length) {
      updateNodeData(id, patch)
    }
  }, [aspect, id, imageModelConfig, imageResolution, imageSize, isVideoNode, updateNodeData])

  React.useEffect(() => {
    if (!isVideoNode) return
    const storedVideoResolution = typeof (data as Record<string, unknown>)?.videoResolution === 'string'
      ? normalizeVideoResolution((data as Record<string, unknown>)?.videoResolution)
      : ''
    const storedVideoSpecKey = typeof (data as any)?.videoSpecKey === 'string' ? String((data as any).videoSpecKey).trim() : ''
    const storedSpecKey = typeof (data as any)?.specKey === 'string' ? String((data as any).specKey).trim() : ''
    if (
      storedVideoResolution === effectiveVideoResolution &&
      storedVideoSpecKey === videoSpecKey &&
      storedSpecKey === videoSpecKey
    ) {
      return
    }
    updateNodeData(id, {
      videoResolution: effectiveVideoResolution || null,
      videoSpecKey: videoSpecKey || null,
      specKey: videoSpecKey || null,
    })
  }, [data, effectiveVideoResolution, id, isVideoNode, updateNodeData, videoSpecKey])

  const trimmedFirstFrameUrl = veoFirstFrameUrl.trim()
  const trimmedLastFrameUrl = veoLastFrameUrl.trim()
  const firstFrameLocked = Boolean(trimmedFirstFrameUrl)
  const veoReferenceLimitReached = veoReferenceImages.length >= MAX_VEO_REFERENCE_IMAGES
  const [veoImageModalMode, setVeoImageModalMode] = React.useState<'first' | 'last' | 'reference' | null>(null)

  React.useEffect(() => {
    if (existingModelVendor || !modelKey) return
    const vendor = findVendorForModel(modelKey)
    if (vendor) {
      updateNodeData(id, { modelVendor: vendor })
    }
  }, [existingModelVendor, modelKey, findVendorForModel, id, updateNodeData])

  React.useEffect(() => {
    if (!isVideoNode) return
    if (!videoModel) return
    const vendor = findVendorForModel(videoModel)
    if (vendor && vendor !== existingVideoVendor) {
      updateNodeData(id, { videoModelVendor: vendor })
    }
  }, [existingVideoVendor, videoModel, findVendorForModel, updateNodeData, id, isVideoNode])
  const summaryModelLabel =
    findModelOptionByIdentifier(modelMenuOptions, activeModelKey)?.label ||
    getModelLabel(toNodeKind(coreKind === 'image' ? 'image' : kind), activeModelKey) ||
    '未配置模型'
  const summaryDuration =
    isVideoNode
      ? selectedConfiguredDurationOption?.label || `${videoDuration}s`
      : `${sampleCount}x`
  const naturalWidthRaw = (data as any)?.naturalWidth
  const naturalHeightRaw = (data as any)?.naturalHeight
  const naturalWidth = typeof naturalWidthRaw === 'number' && Number.isFinite(naturalWidthRaw) && naturalWidthRaw > 0 ? naturalWidthRaw : undefined
  const naturalHeight = typeof naturalHeightRaw === 'number' && Number.isFinite(naturalHeightRaw) && naturalHeightRaw > 0 ? naturalHeightRaw : undefined
  const naturalAspectLabel = naturalWidth && naturalHeight ? formatAspectRatio(naturalWidth, naturalHeight) : ''
  const summaryVideoSize = isVideoNode
    ? naturalAspectLabel || selectedConfiguredSizeOption?.label || videoSize || aspect
    : isImageEditNode
      ? imageEditSizeOption.label
      : naturalAspectLabel || selectedConfiguredImageAspectOption?.label || aspect
  const summaryVideoResolution = React.useMemo(() => {
    if (!isVideoNode) return ''
    return selectedConfiguredResolutionOption?.label || effectiveVideoResolution || '未设定'
  }, [effectiveVideoResolution, isVideoNode, selectedConfiguredResolutionOption])
  const summaryResolution = summaryVideoSize
  const summaryOrientation = React.useMemo(() => {
    const configuredLabel =
      configuredOrientationOptions.find((option) => option.value === orientation)?.label || ''
    if (configuredLabel) return configuredLabel
    return orientation === 'portrait' ? '竖屏' : '横屏'
  }, [configuredOrientationOptions, orientation])
  const summaryGenerateAudio = videoGenerateAudio ? '有声' : '无声'
  const summaryExec = `${sampleCount} x`
  const promptPresetOptions = React.useMemo(
    () =>
      presetItems.map((item) => ({
        value: item.id,
        label: `${item.title}${item.scope === 'base' ? '（基础）' : ''}`,
      })),
    [presetItems],
  )
  const durationOptions = React.useMemo(() => {
    if (configuredDurationOptions.length) return configuredDurationOptions
    if (resolvedVideoVendor === 'veo') {
      return [...VEO_DURATION_OPTIONS]
    }
    return BASE_DURATION_OPTIONS
  }, [configuredDurationOptions, resolvedVideoVendor])

  React.useEffect(() => {
    if (!isVideoNode || !hasDuration) return
    const allowed = durationOptions
      .map((opt) => Number(opt.value))
      .filter((v) => Number.isFinite(v) && v > 0)
    if (!allowed.length) return
    const current =
      typeof videoDuration === 'number' && Number.isFinite(videoDuration) && videoDuration > 0
        ? videoDuration
        : allowed[0]
    if (allowed.includes(current) && current === videoDuration) return

    let best = allowed[0]
    let bestDiff = Math.abs(current - best)
    for (const candidate of allowed) {
      const diff = Math.abs(current - candidate)
      if (diff < bestDiff || (diff === bestDiff && candidate > best)) {
        best = candidate
        bestDiff = diff
      }
    }

    if (best !== videoDuration) {
      setVideoDuration(best)
      updateNodeData(id, buildVideoDurationPatch(best))
    }
  }, [durationOptions, hasDuration, id, isVideoNode, updateNodeData, videoDuration])

  const handleToolbarModelChange = React.useCallback((value: string) => {
    const requestedValue = resolveRequestedModelIdentifier(value) || value
    setModelKey(requestedValue)
    setImageModel(requestedValue)
    setVideoModel(requestedValue)
    const option = findModelOptionByIdentifier(modelMenuOptions, value)
    updateNodeData(id, {
      geminiModel: requestedValue,
      imageModel: requestedValue,
      videoModel: requestedValue,
      modelVendor: option?.vendor || null,
      imageModelVendor: null,
      videoModelVendor: option?.vendor || null,
    })
  }, [findModelOptionByIdentifier, id, modelMenuOptions, resolveRequestedModelIdentifier, updateNodeData])

  const handleToolbarDurationChange = React.useCallback((num: number) => {
    const nextSpecKey = buildVideoSpecKey(effectiveVideoResolution, num)
    setVideoDuration(num)
    updateNodeData(id, {
      ...buildVideoDurationPatch(num),
      videoResolution: effectiveVideoResolution || null,
      videoSpecKey: nextSpecKey || null,
      specKey: nextSpecKey || null,
    })
  }, [effectiveVideoResolution, id, updateNodeData])

  const handleToolbarSizeChange = React.useCallback((value: string) => {
    if (isVideoNode) {
      const normalizedSize = value.trim().replace(/\s+/g, '')
      const matchedOption =
        videoModelConfig?.sizeOptions.find((option) => option.value === normalizedSize) || null
      const nextSpecKey = buildVideoSpecKey(effectiveVideoResolution, videoDuration)
      const nextAspect = matchedOption?.aspectRatio ? normalizeImageAspect(matchedOption.aspectRatio) : aspect
      const nextOrientation = resolveVideoOrientationValue({
        currentOrientation: matchedOption?.orientation ?? orientationRef.current,
        size: normalizedSize,
        aspect: nextAspect,
        config: videoModelConfig,
      })
      setVideoSize(normalizedSize)
      updateNodeData(id, {
        videoSize: normalizedSize,
        videoResolution: effectiveVideoResolution || null,
        videoSpecKey: nextSpecKey || null,
        specKey: nextSpecKey || null,
        ...(matchedOption?.aspectRatio ? { aspect: nextAspect } : {}),
        orientation: nextOrientation,
      })
      if (matchedOption?.aspectRatio) {
        setAspect(nextAspect)
      }
      orientationRef.current = nextOrientation
      setOrientation(nextOrientation)
      return
    }
    const normalizedAspect = normalizeImageAspect(value)
    setAspect(normalizedAspect)
    updateNodeData(id, { aspect: normalizedAspect })
  }, [aspect, effectiveVideoResolution, id, isVideoNode, updateNodeData, videoDuration, videoModelConfig])

  const handleToolbarVideoResolutionChange = React.useCallback((value: string) => {
    const normalizedResolution = normalizeVideoResolution(value)
    const nextSpecKey = buildVideoSpecKey(normalizedResolution, videoDuration)
    setVideoResolution(normalizedResolution)
    updateNodeData(id, {
      videoResolution: normalizedResolution || null,
      videoSpecKey: nextSpecKey || null,
      specKey: nextSpecKey || null,
    })
  }, [id, updateNodeData, videoDuration])

  const handleToolbarGenerateAudioChange = React.useCallback((value: string) => {
    const next = value === 'true'
    setVideoGenerateAudio(next)
    updateNodeData(id, {
      generateAudio: next,
      generate_audio: next,
    })
  }, [id, updateNodeData])

  const handleToolbarOrientationChange = React.useCallback((value: Orientation) => {
    const normalized = normalizeOrientation(value)
    const matchedOption =
      videoModelConfig?.orientationOptions.find((option) => option.value === normalized) || null
    const nextSize = matchedOption?.size ? matchedOption.size : videoSize
    const nextSpecKey = buildVideoSpecKey(effectiveVideoResolution, videoDuration)
    orientationRef.current = normalized
    setOrientation(normalized)
    updateNodeData(id, {
      orientation: normalized,
      videoResolution: effectiveVideoResolution || null,
      videoSpecKey: nextSpecKey || null,
      specKey: nextSpecKey || null,
      ...(matchedOption?.size ? { videoSize: matchedOption.size } : {}),
      ...(matchedOption?.aspectRatio ? { aspect: normalizeImageAspect(matchedOption.aspectRatio) } : {}),
    })
    if (matchedOption?.size) {
      setVideoSize(matchedOption.size)
    }
    if (matchedOption?.aspectRatio) {
      setAspect(normalizeImageAspect(matchedOption.aspectRatio))
    }
  }, [effectiveVideoResolution, id, updateNodeData, videoDuration, videoModelConfig, videoSize])

  const mappedVideoControls = React.useMemo<ReadonlyArray<ToolbarMappedControl>>(() => {
    if (!isVideoNode || !videoModelConfig) return []
    const controls = videoModelConfig.controls.flatMap<ToolbarMappedControl>((control): ToolbarMappedControl[] => {
      if (control.binding === 'durationSeconds') {
        if (!durationOptions.length) return []
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: summaryDuration,
          options: durationOptions.map((option) => ({ value: option.value, label: option.label })),
          onChange: (value: string) => {
            const parsed = Number(value)
            if (Number.isFinite(parsed) && parsed > 0) {
              handleToolbarDurationChange(parsed)
            }
          },
        }]
      }
      if (control.binding === 'resolution') {
        const options = configuredVideoResolutionOptions
        if (!options.length) return []
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: summaryVideoResolution,
          options,
          onChange: handleToolbarVideoResolutionChange,
        }]
      }
      if (control.binding === 'size') {
        const options = configuredSizeOptions
        if (!options.length) return []
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: summaryVideoSize,
          options,
          onChange: handleToolbarSizeChange,
        }]
      }
      if (control.binding === 'generateAudio') {
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: summaryGenerateAudio,
          options: [
            { value: 'false', label: '无声' },
            { value: 'true', label: '有声' },
          ],
          onChange: handleToolbarGenerateAudioChange,
        }]
      }
      if (control.binding === 'returnLastFrame') {
        return []
      }
      const options = configuredOrientationOptions
      if (!options.length) return []
      return [{
        key: control.key,
        binding: control.binding,
        title: control.label,
        summary: summaryOrientation,
        options,
        onChange: (value: string) => {
          if (value === 'portrait' || value === 'landscape') {
            handleToolbarOrientationChange(value)
          }
        },
      }]
    })
    const hasSizeControl = controls.some((control) => control.binding === 'size')
    const hasResolutionControl = controls.some((control) => control.binding === 'resolution')
    const autoResolutionControl: ToolbarMappedControl[] = !hasResolutionControl && configuredVideoResolutionOptions.length
      ? [{
          key: 'video_resolution',
          binding: 'resolution' as const,
          title: '分辨率',
          summary: summaryVideoResolution,
          options: configuredVideoResolutionOptions,
          onChange: handleToolbarVideoResolutionChange,
        }]
      : []
    return hasSizeControl
      ? [...controls.filter((control) => control.binding !== 'orientation'), ...autoResolutionControl]
      : [...controls, ...autoResolutionControl]
  }, [
    configuredVideoResolutionOptions,
    configuredOrientationOptions,
    configuredSizeOptions,
    durationOptions,
    handleToolbarDurationChange,
    handleToolbarGenerateAudioChange,
    handleToolbarOrientationChange,
    handleToolbarSizeChange,
    handleToolbarVideoResolutionChange,
    isVideoNode,
    summaryDuration,
    summaryGenerateAudio,
    summaryOrientation,
    summaryVideoResolution,
    summaryVideoSize,
    videoModelConfig,
  ])

  const mappedVideoControlBindings = React.useMemo(() => {
    return new Set<VideoModelControlBinding>(
      mappedVideoControls
        .map((control) => control.binding)
        .filter(isVideoModelControlBinding),
    )
  }, [mappedVideoControls])

  const mappedImageControls = React.useMemo<ReadonlyArray<ToolbarMappedControl>>(() => {
    if (isVideoNode || !imageModelConfig) return []
    return imageModelConfig.controls.flatMap<ToolbarMappedControl>((control): ToolbarMappedControl[] => {
      if (control.binding === 'aspectRatio') {
        if (!configuredImageAspectOptions.length) return []
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: selectedConfiguredImageAspectOption?.label || aspect,
          options: configuredImageAspectOptions,
          onChange: handleToolbarSizeChange,
        }]
      }
      if (control.binding === 'imageSize') {
        if (imageSizeMatchesResolutionOptions) return []
        if (!configuredImageSizeOptions.length) return []
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: selectedConfiguredImageSizeOption?.label || imageSize,
          options: configuredImageSizeOptions,
          onChange: (value: string) => {
            setImageSize(value)
            updateNodeData(id, { imageSize: value })
          },
        }]
      }
      if (control.binding === 'resolution') {
        if (!configuredImageResolutionOptions.length) return []
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: selectedConfiguredImageResolutionOption?.label || imageResolution || '分辨率',
          options: configuredImageResolutionOptions,
          onChange: (value: string) => {
            setImageResolution(value)
            updateNodeData(id, { imageResolution: value, resolution: value })
          },
        }]
      }
      return []
    })
  }, [
    aspect,
    configuredImageAspectOptions,
    configuredImageResolutionOptions,
    configuredImageSizeOptions,
    handleToolbarSizeChange,
    id,
    imageModelConfig,
    imageResolution,
    imageSize,
    imageSizeMatchesResolutionOptions,
    isVideoNode,
    selectedConfiguredImageAspectOption,
    selectedConfiguredImageResolutionOption,
    selectedConfiguredImageSizeOption,
    updateNodeData,
  ])

  const mappedImageControlBindings = React.useMemo(() => {
    return new Set<ImageModelControlBinding>(
      mappedImageControls
        .map((control) => control.binding)
        .filter(
          (binding): binding is ImageModelControlBinding =>
            binding === 'aspectRatio' || binding === 'imageSize' || binding === 'resolution',
        ),
    )
  }, [mappedImageControls])

  const showTimeMenu = baseShowTimeMenu && !mappedVideoControlBindings.has('durationSeconds')
  const showResolutionMenu = isVideoNode
    ? baseShowResolutionMenu && !mappedVideoControlBindings.has('size')
    : baseShowResolutionMenu && !mappedImageControlBindings.has('aspectRatio')
  const showOrientationMenu =
    baseShowOrientationMenu &&
    !mappedVideoControlBindings.has('orientation') &&
    !mappedVideoControlBindings.has('size')
  const showImageSizeMenu =
    hasImageSize &&
    !imageSizeMatchesResolutionOptions &&
    (imageModelConfig ? configuredImageSizeOptions.length > 0 : true) &&
    !mappedImageControlBindings.has('imageSize')
  React.useEffect(() => {
    if (typeof persistedCharacterRewriteModel === 'string' && persistedCharacterRewriteModel.trim() && persistedCharacterRewriteModel !== characterRewriteModel) {
      setCharacterRewriteModel(persistedCharacterRewriteModel)
    }
  }, [persistedCharacterRewriteModel, characterRewriteModel])
  React.useEffect(() => {
    if (!rewriteModelOptions.length) return
    if (!rewriteModelOptions.some((opt) => opt.value === characterRewriteModel)) {
      const fallback = rewriteModelOptions[0].value
      setCharacterRewriteModel(fallback)
      updateNodeData(id, { characterRewriteModel: fallback })
    }
  }, [rewriteModelOptions, characterRewriteModel, updateNodeData, id])
  const handleRewriteModelChange = React.useCallback((value: string | null) => {
    if (!value) return
    setCharacterRewriteModel(value)
    updateNodeData(id, { characterRewriteModel: value })
  }, [id, updateNodeData])

  const handleApplyPromptSample = React.useCallback((sample: PromptSampleDto) => {
    if (!sample?.prompt) return
    setPrompt(sample.prompt)
    updateNodeData(id, { prompt: sample.prompt })
    setPromptSamplesOpen(false)
  }, [id, updateNodeData])

  React.useEffect(() => {
    const fromData = (data as any)?.llmPresetId
    const next = typeof fromData === 'string' && fromData.trim() ? fromData : null
    setSelectedPresetId((prev) => (prev === next ? prev : next))
  }, [(data as any)?.llmPresetId])

  React.useEffect(() => {
    setNewPresetType(presetType)
  }, [presetType])

  const reloadNodePresets = React.useCallback(async () => {
    setPresetLoading(true)
    try {
      const list = await listLlmNodePresets({ type: presetType })
      setPresetItems(Array.isArray(list) ? list : [])
    } catch (err: any) {
      setPresetItems([])
      toast(err?.message || '加载节点预设失败', 'error')
    } finally {
      setPresetLoading(false)
    }
  }, [presetType])

  React.useEffect(() => {
    void reloadNodePresets()
  }, [reloadNodePresets])

  const handlePresetChange = React.useCallback((presetId: string | null) => {
    setSelectedPresetId(presetId)
    if (!presetId) {
      updateNodeData(id, { llmPresetId: null })
      return
    }
    const selectedPreset = presetItems.find((item) => item.id === presetId)
    if (!selectedPreset) {
      updateNodeData(id, { llmPresetId: presetId })
      return
    }
    setPrompt(selectedPreset.prompt)
    updateNodeData(id, {
      prompt: selectedPreset.prompt,
      llmPresetId: selectedPreset.id,
      llmPresetType: selectedPreset.type,
      llmPresetTitle: selectedPreset.title,
    })
  }, [id, presetItems, updateNodeData])

  const handleCreateNodePreset = React.useCallback(async () => {
    const title = newPresetTitle.trim()
    const promptText = newPresetPrompt.trim()
    if (!title || !promptText) {
      toast('请填写预设名称和提示词', 'error')
      return
    }
    setPresetSaving(true)
    try {
      const created = await createLlmNodePreset({
        title,
        prompt: promptText,
        type: newPresetType,
      })
      setPresetModalOpen(false)
      setNewPresetTitle('')
      setNewPresetPrompt('')
      await reloadNodePresets()
      const shouldApplyPrompt = created.type === presetType
      if (shouldApplyPrompt) {
        setSelectedPresetId(created.id)
        setPrompt(created.prompt)
        updateNodeData(id, {
          prompt: created.prompt,
          llmPresetId: created.id,
          llmPresetType: created.type,
          llmPresetTitle: created.title,
        })
      }
      toast('预设创建成功', 'success')
    } catch (err: any) {
      toast(err?.message || '创建预设失败', 'error')
    } finally {
      setPresetSaving(false)
    }
  }, [id, newPresetPrompt, newPresetTitle, newPresetType, presetType, reloadNodePresets, updateNodeData])

  const applyVeoReferenceImages = React.useCallback((next: string[]) => {
    const normalized = normalizeVeoReferenceUrls(next)
    setVeoReferenceImages(normalized)
    updateNodeData(id, { veoReferenceImages: normalized })
  }, [id, updateNodeData])

  const handleReferenceToggle = React.useCallback((url: string) => {
    if (firstFrameLocked) return
    const exists = veoReferenceImages.includes(url)
    if (!exists && veoReferenceLimitReached) return
    const next = exists
      ? veoReferenceImages.filter((item) => item !== url)
      : [...veoReferenceImages, url]
    applyVeoReferenceImages(next)
  }, [applyVeoReferenceImages, firstFrameLocked, veoReferenceImages, veoReferenceLimitReached])

  const handleAddCustomReferenceImage = React.useCallback(() => {
    if (firstFrameLocked) return
    const trimmed = veoCustomImageInput.trim()
    if (!trimmed) return
    applyVeoReferenceImages([...veoReferenceImages, trimmed])
    setVeoCustomImageInput('')
  }, [applyVeoReferenceImages, firstFrameLocked, veoCustomImageInput, veoReferenceImages])

  const handleSetFirstFrameUrl = React.useCallback((value: string) => {
    setVeoFirstFrameUrl(value)
    const trimmed = value.trim()
    updateNodeData(id, { veoFirstFrameUrl: trimmed || null })
    if (!trimmed) {
      setVeoLastFrameUrl('')
      updateNodeData(id, { veoLastFrameUrl: null })
      return
    }
    if (veoReferenceImages.length) {
      applyVeoReferenceImages([])
    }
  }, [applyVeoReferenceImages, id, updateNodeData, veoReferenceImages.length])

  const handleSetLastFrameUrl = React.useCallback((value: string) => {
    if (!firstFrameLocked) return
    setVeoLastFrameUrl(value)
    const trimmed = value.trim()
    updateNodeData(id, { veoLastFrameUrl: trimmed || null })
  }, [firstFrameLocked, id, updateNodeData])

  const handleRemoveReferenceImage = React.useCallback((url: string) => {
    applyVeoReferenceImages(veoReferenceImages.filter((item) => item !== url))
  }, [applyVeoReferenceImages, veoReferenceImages])

  const openVeoModal = React.useCallback((mode: 'first' | 'last' | 'reference') => {
    setVeoImageModalMode(mode)
  }, [])
  const closeVeoModal = React.useCallback(() => setVeoImageModalMode(null), [])

  const showUpstreamPreview = Boolean(isSingleSelectionActive && isComposerNode)
  const upstreamSourceId = useRFStore(
    React.useCallback((s) => {
      if (!showUpstreamPreview) return null
      let lastSource: string | null = null
      s.edges.forEach((edge) => {
        if (edge.target === id) lastSource = edge.source
      })
      return lastSource
    }, [id, showUpstreamPreview]),
  )
  const upstreamSourceData = useRFStore(
    React.useCallback((s) => {
      if (!upstreamSourceId) return null
      const src = s.nodes.find((n) => n.id === upstreamSourceId)
      return src ? (src.data as any) : null
    }, [upstreamSourceId]),
  )
  const { upstreamText, upstreamImageUrl, upstreamVideoUrl } = React.useMemo(() => {
    if (!showUpstreamPreview || !upstreamSourceData) {
      return {
        upstreamText: null as string | null,
        upstreamImageUrl: null as string | null,
        upstreamVideoUrl: null as string | null,
      }
    }

    const sd: any = upstreamSourceData || {}
    const skind: string | undefined = sd.kind
    const sourceSchema = getTaskNodeSchema(skind)
    const sourceFeatures = new Set(sourceSchema.features)
    const sourceIsImageNode =
      sourceSchema.category === 'image' || sourceFeatures.has('image') || sourceFeatures.has('imageResults')
    const sourceHasVideoResults =
      sourceFeatures.has('videoResults') ||
      sourceFeatures.has('video') ||
      sourceSchema.category === 'video'

    // 获取最新的主文本 / 提示词
    const uText =
      sd.prompt && typeof sd.prompt === 'string'
        ? sd.prompt
        : sourceFeatures.has('textResults') && sd.textResults && sd.textResults.length > 0
          ? sd.textResults[sd.textResults.length - 1]
          : sourceSchema.category === 'document'
            ? (sd.prompt as string | undefined) || (sd.label as string | undefined) || null
            : null

    // 获取最新的主图片 URL
    let uImg = null as string | null
    if (sourceIsImageNode) {
      uImg = (sd.imageUrl as string | undefined) || null
    } else if (sourceHasVideoResults && sd.videoResults && sd.videoResults.length > 0 && sd.videoPrimaryIndex !== undefined) {
      uImg = sd.videoResults[sd.videoPrimaryIndex]?.thumbnailUrl || sd.videoResults[0]?.thumbnailUrl
    }

    // 获取当前展示的视频 URL
    let uVideo = null as string | null
    if (sourceHasVideoResults) {
      if (sd.videoResults && sd.videoResults.length > 0 && sd.videoPrimaryIndex !== undefined) {
        uVideo = sd.videoResults[sd.videoPrimaryIndex]?.url || sd.videoResults[0]?.url
      } else {
        uVideo = (sd.videoUrl as string | undefined) || null
      }
    }

    return { upstreamText: uText, upstreamImageUrl: uImg, upstreamVideoUrl: uVideo }
  }, [showUpstreamPreview, upstreamSourceData])

  const buildFeaturePatch = React.useCallback((nextPrompt: string) => {
    const patch: Record<string, unknown> = { prompt: nextPrompt }
    if (hasAspect) patch.aspect = aspect
    if (hasImageSize) patch.imageSize = imageSize
    if (hasImageResults) {
      patch.imageModel = imageModel
      patch.imageModelVendor = null
    }
    if (hasSampleCount) patch.sampleCount = sampleCount
    if (isVideoNode || hasVideo || hasVideoResults) {
      patch.videoModel = videoModel
      patch.videoModelVendor = findVendorForModel(videoModel)
      if (hasDuration) Object.assign(patch, buildVideoDurationPatch(videoDuration))
      if (hasOrientation) patch.orientation = orientationRef.current
      if (videoSize) patch.videoSize = videoSize
      if (effectiveVideoResolution) patch.videoResolution = effectiveVideoResolution
      patch.generateAudio = videoGenerateAudio
      patch.generate_audio = videoGenerateAudio
      if (videoSpecKey) {
        patch.videoSpecKey = videoSpecKey
        patch.specKey = videoSpecKey
      }
    }
    patch.modelVendor = findVendorForModel(modelKey)
    return patch
  }, [
    aspect,
    imageSize,
    findVendorForModel,
    hasAspect,
    hasImageSize,
    hasDuration,
    hasImageResults,
    hasOrientation,
    hasSampleCount,
    hasVideo,
    hasVideoResults,
    imageModel,
    isVideoNode,
    modelKey,
    sampleCount,
    videoDuration,
    videoGenerateAudio,
    videoModel,
    effectiveVideoResolution,
    videoSpecKey,
    videoSize,
    orientationRef,
  ])

  const runNode = () => {
    if (isPlainTextNode) {
      updateNodeData(id, { prompt })
      return
    }
    let nextPrompt = (prompt || (data as any)?.prompt || '').trim()
    const patch: Record<string, unknown> = {}
    const featurePatch = buildFeaturePatch(nextPrompt)
    Object.assign(patch, featurePatch)
    if (hasImage) {
      setPrompt(nextPrompt)
    }
    updateNodeData(id, patch)
    if (isWebHeroNode) {
      void runNodeDagToTarget(id, useRFStore.getState, useRFStore.setState, { concurrency: 1 }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        toast(message || '网页节点执行失败', 'error')
      })
      return
    }
    runSelected()
  }

  const handleVideoUpload = React.useCallback(async (file: File) => {
    if (!supportsVideoUpload || viewOnly) return
    if (videoUploadLoading) {
      toast('当前节点仍有视频上传中，请等待完成后再试', 'info')
      return
    }

    if (!isSupportedVideoUploadFile(file)) {
      toast('仅支持视频文件上传', 'error')
      return
    }

    const fileSize = typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : 0
    if (fileSize > MAX_VIDEO_UPLOAD_BYTES) {
      toast('视频超过 30MB，无法上传', 'error')
      return
    }

    const title = typeof file.name === 'string' && file.name.trim() ? file.name.trim() : '上传视频'
    setVideoUploadLoading(true)
    try {
      const hosted = await uploadServerAssetFile(file, title, { ownerNodeId: id })
      const uploadedUrl = readServerAssetUrl(hosted)
      if (!uploadedUrl) {
        throw new Error('视频上传成功但未返回资产 URL')
      }

      const uploadedVideo: TaskNodeVideoResult = {
        url: uploadedUrl,
        title,
        assetId: hosted.id,
        assetName: title,
        createdAt: new Date().toISOString(),
      }
      updateNodeData(id, {
        videoUrl: uploadedUrl,
        videoResults: [uploadedVideo],
        videoPrimaryIndex: 0,
        videoTitle: title,
        videoThumbnailUrl: null,
        videoDuration: null,
        clipRange: null,
        serverAssetId: hosted.id,
        taskId: null,
        videoTaskId: null,
        videoTokenId: null,
        status: 'success',
        progress: 100,
        error: null,
      })
      setVideoPrimaryIndex(0)
      notifyAssetRefresh()
      const saveProject = (window as unknown as { silentSaveProject?: () => void }).silentSaveProject
      if (typeof saveProject === 'function') {
        saveProject()
      }
      toast('视频已上传', 'success')
    } catch (error: unknown) {
      console.error('Failed to upload video:', error)
      toast(getVideoUploadErrorMessage(error), 'error')
    } finally {
      setVideoUploadLoading(false)
    }
  }, [id, supportsVideoUpload, updateNodeData, videoUploadLoading, viewOnly])

  const handleAdoptVideo = React.useCallback((idx: number) => {
    const target = videoResults[idx]
    if (!target) return
    updateNodeData(id, {
      adoptedVideoAsset: {
        index: idx,
        url: target.url,
        adoptedAt: new Date().toISOString(),
        progress: typeof data?.progress === 'number' && Number.isFinite(data.progress) ? data.progress : null,
      } satisfies AdoptedAssetMetadata,
    })
    toast(`已采纳第 ${idx + 1} 个视频`, 'success')
  }, [data?.progress, id, updateNodeData, videoResults])

  const handleRequestVideoNodeSelect = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (viewOnly) return
    if (event.button !== 0) return
    const multiSelect = event.metaKey || event.ctrlKey || event.shiftKey
    const state = useRFStore.getState()
    const changes = state.nodes.flatMap((node) => {
      if (node.selectable === false) {
        return node.selected ? [{ id: node.id, type: 'select' as const, selected: false }] : []
      }
      const nextSelected = node.id === id
        ? (multiSelect ? !node.selected : true)
        : (multiSelect ? Boolean(node.selected) : false)
      return node.selected === nextSelected ? [] : [{ id: node.id, type: 'select' as const, selected: nextSelected }]
    })
    if (changes.length) state.onNodesChange(changes)
  }, [id, viewOnly])

  const videoNodeDims = React.useMemo(() => {
    const p = getNodeSizeProfile({ coreType: 'video' })
    const rawW = Number((data as any)?.nodeWidth)
    const rawH = Number((data as any)?.nodeHeight)
    return {
      w: Number.isFinite(rawW) ? Math.max(p.minW, Math.min(p.maxW, Math.round(rawW))) : p.defaultW,
      h: Number.isFinite(rawH) ? Math.max(p.minH, Math.min(p.maxH, Math.round(rawH))) : p.defaultH,
    }
  }, [(data as any)?.nodeWidth, (data as any)?.nodeHeight])

	  const videoContent = !isVideoNode
	    ? null
	    : (
	      <VideoContent
        videoResults={videoResults}
        videoPrimaryIndex={videoPrimaryIndex}
        adoptedVideoIndex={adoptedVideoIndex}
        isPrimaryVideoAdopted={isPrimaryVideoAdopted}
        videoUrl={videoUrl}
        videoThumbnailUrl={videoThumbnailUrl}
        videoTitle={videoTitle}
        frameCaptureLoading={frameCaptureLoading}
        frameSamples={frameSamples}
        handleCaptureVideoFrames={handleCaptureVideoFrames}
        cleanupFrameSamples={cleanupFrameSamples}
        mediaOverlayBackground={mediaOverlayBackground}
        mediaOverlayText={mediaOverlayText}
        mediaFallbackSurface={mediaFallbackSurface}
        mediaFallbackText={mediaFallbackText}
		        inlineDividerColor={inlineDividerColor}
		        accentPrimary={accentPrimary}
		        rgba={rgba}
		        videoSurface={videoSurface}
		        onAdoptVideo={handleAdoptVideo}
            onRequestSelect={handleRequestVideoNodeSelect}
		        onOpenVideoModal={() => setVideoExpanded(true)}
            canUpload={supportsVideoUpload && !viewOnly}
            uploading={videoUploadLoading}
            onUploadVideo={handleVideoUpload}
            nodeWidth={videoNodeDims.w}
            nodeHeight={videoNodeDims.h}
            onUpdateNodeData={(patch: Record<string, unknown>) => updateNodeData(id, patch)}
            mediaAutoSized={(data as any)?.mediaAutoSized ?? null}
		        onOpenWebCut={
		          viewOnly
		            ? undefined
		            : () => {
	              const src = videoResults[videoPrimaryIndex]?.url || videoUrl || ''
              if (!src) {
                toast('暂无可剪辑的视频', 'error')
                return
              }

              const baseTitle =
                (videoResults[videoPrimaryIndex]?.title || videoTitle || '').trim() ||
                'clip'
              const nextTitle = `${baseTitle}-剪辑`

              openWebCutVideoEditModal({
                nodeId: id,
                videoUrl: src,
                videoTitle: baseTitle,
                onApply: async (result) => {
                  const before = useRFStore.getState()
                  const beforeIds = new Set(before.nodes.map((n) => n.id))

                  addNode('taskNode', undefined, {
                    kind: 'video',
                    videoUrl: result.url,
                    videoThumbnailUrl: result.thumbnailUrl || null,
                    videoTitle: nextTitle,
                    serverAssetId: result.assetId,
                  })

                  const after = useRFStore.getState()
                  const newNode = after.nodes.find((n) => !beforeIds.has(n.id))
                  if (!newNode) {
                    toast('剪辑已上传，但未能创建新视频节点', 'error')
                    return
                  }

                  const sourceNode = after.nodes.find((n) => n.id === id)
                  const targetPos = {
                    x: (sourceNode?.position?.x || 0) + 520,
                    y: sourceNode?.position?.y || 0,
                  }
                  after.onNodesChange([
                    { id: newNode.id, type: 'position', position: targetPos, dragging: false },
                    { id: newNode.id, type: 'select', selected: true },
                  ])
                  after.onConnect({
                    source: id,
                    sourceHandle: 'out-video',
                    target: newNode.id,
                    targetHandle: 'in-any',
                  })
                },
              })
            }
	        }
	      />
	    )

	  const characterContentProps = null

	  const mosaicProps = {
	    imageResults,
	    imagePrimaryIndex,
	    placeholderColor: placeholderIconColor,
    mosaicGrid,
    onOpenModal: () => setMosaicModalOpen(true),
    onSave: handleMosaicSave,
  }

  const handleImageUpload = React.useCallback(async (files: File[]) => {
    if (!supportsImageUpload) return
    if (nodeHasUploadIntent || nodeHasPendingUploads) {
      toast('当前节点仍有图片上传中，请等待完成后再试', 'info')
      return
    }

    try {
      useUploadRuntimeStore.getState().beginNodeImageUpload(id)

      const picked = (files || []).filter((f): f is File => Boolean(f))
      if (!picked.length) return

      const deduped = dedupeLocalFiles(picked, (file) => file.name || 'Image')
      if (deduped.skippedCount > 0) {
        useUploadRuntimeStore.getState().recordDuplicateBlocked(deduped.skippedCount)
        toast(`已跳过 ${deduped.skippedCount} 个同批次重复文件`, 'info')
      }

      const MAX_BYTES = 30 * 1024 * 1024
      const tooLarge = deduped.uniqueFiles.filter((f) => (typeof f.size === 'number' ? f.size : 0) > MAX_BYTES)
      if (tooLarge.length) toast(`有 ${tooLarge.length} 张图片超过 30MB，已跳过`, 'error')
      const valid = deduped.uniqueFiles.filter((f) => (typeof f.size === 'number' ? f.size : 0) <= MAX_BYTES)
      if (!valid.length) return

      const allNodes = useRFStore.getState().nodes
      const self = allNodes.find((n) => n.id === id) as any
      const basePos = self?.position || { x: 0, y: 0 }
      const parentId = self?.parentId as string | undefined
      const extent = self?.extent as any

      const spacingX = CANVAS_CONFIG.NODE_SPACING_X + 60
      const spacingY = CANVAS_CONFIG.NODE_SPACING_Y + 40
      const cols = 3

      const extraFiles = valid.slice(1)
      const extraPrepared = extraFiles.map((file, idx) => {
        const newId = genTaskNodeId()
        const localUrl = URL.createObjectURL(file)
        const col = idx % cols
        const row = Math.floor(idx / cols)
        const position = {
          x: basePos.x + spacingX * (col + 1),
          y: basePos.y + spacingY * row,
        }
        return { id: newId, file, localUrl, position }
      })

      if (extraPrepared.length) {
        useRFStore.setState((s: any) => {
          const newNodes = extraPrepared.map((p) => ({
            id: p.id,
            type: 'taskNode' as const,
            position: p.position,
            parentId,
            extent,
            data: { label: 'Image', kind: 'image', imageUrl: p.localUrl },
            selected: false,
          }))
          return { nodes: [...s.nodes, ...newNodes], nextId: s.nextId + newNodes.length }
        })
      }

      const uploadIntoNode = async (nodeId: string, file: File, localUrl: string): Promise<boolean> => {
        const imageTitle = typeof file?.name === 'string' && file.name.trim() ? file.name.trim() : '上传图片'
        const requestKey = `${nodeId}:${file.name}:${file.size}:${file.lastModified}`
        const localPreviewResourceId = resourceManager.buildResourceId({
          url: localUrl,
          kind: 'preview',
          variantKey: 'preview',
        })
        useUploadRuntimeStore.getState().registerUploadIntent({
          id: requestKey,
          requestKey,
          fileName: imageTitle,
          ownerNodeId: nodeId,
          localPreviewResourceId,
          localPreviewUrl: localUrl,
        })
        updateNodeData(nodeId, {
          imageUrl: localUrl,
          imageResults: [{ url: localUrl, title: imageTitle }],
          imagePrimaryIndex: 0,
        })

        let hostedUrl: string | null = null
        let hostedAssetId: string | null = null
        try {
          useUploadRuntimeStore.getState().markUploadStarted(requestKey)
          const hosted = await uploadServerAssetFile(file, file.name || 'Image', { ownerNodeId: nodeId })
          const url = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
          if (url) {
            hostedUrl = url
            hostedAssetId = hosted.id
          }
        } catch (error) {
          console.error('Failed to upload image to OSS:', error)
          const msg = String((error as any)?.message || '').trim()
          const statusMatch = msg.match(/upload asset failed:\\s*(\\d+)/i)
          const status = statusMatch && statusMatch[1] ? Number(statusMatch[1]) : NaN
          const mayHaveSucceeded = !Number.isFinite(status) || status >= 500
          if (mayHaveSucceeded) {
            const recovered = await recoverUploadedServerAssetFile(file)
            const recoveredUrl = typeof recovered?.data?.url === 'string' ? recovered.data.url.trim() : ''
            if (recovered && recoveredUrl) {
              hostedUrl = recoveredUrl
              hostedAssetId = recovered.id
            }
          }
        }

        const remoteUrl = hostedUrl || localUrl
        updateNodeData(nodeId, {
          imageUrl: remoteUrl,
          imageResults: [{ url: remoteUrl, title: imageTitle }],
          imagePrimaryIndex: 0,
          serverAssetId: hostedAssetId,
        })
        if (remoteUrl !== localUrl) {
          const remoteResourceId = resourceManager.buildResourceId({
            url: remoteUrl,
            kind: 'image',
            variantKey: 'original',
          })
          useUploadRuntimeStore.getState().commitUploadHosted({
            handleId: requestKey,
            remoteResourceId,
            remoteUrl,
          })
          resourceManager.replaceLocalPreview(localPreviewResourceId)
          URL.revokeObjectURL(localUrl)
        } else {
          useUploadRuntimeStore.getState().failUpload({
            handleId: requestKey,
            error: 'remote upload unavailable; local preview only',
          })
        }
        useUploadRuntimeStore.getState().finishUpload(requestKey)

        if ((window as any).silentSaveProject) {
          (window as any).silentSaveProject()
        }
        return Boolean(hostedUrl)
      }

      let successCount = 0
      const firstFile = valid[0]
      const firstLocalUrl = URL.createObjectURL(firstFile)
      try {
        if (await uploadIntoNode(id, firstFile, firstLocalUrl)) successCount += 1
      } catch (error) {
        console.error('Failed to upload image:', error)
        toast('上传图片失败，请稍后再试', 'error')
      }

      for (const p of extraPrepared) {
        try {
          if (await uploadIntoNode(p.id, p.file, p.localUrl)) successCount += 1
        } catch (error) {
          console.error('Failed to upload image:', error)
          toast('上传图片失败，请稍后再试', 'error')
        }
      }

      if (successCount === 0) {
        toast('已添加图片，但未能托管到 OSS/R2，将仅使用本地预览（无法用于远程任务）', 'error')
      }

      if (successCount > 0 && extraPrepared.length) {
        useRFStore.setState((s: any) => {
          const ids = new Set(extraPrepared.map((p) => p.id))
          const posById = new Map(
            extraPrepared.map((p, idx) => {
              const col = idx % cols
              const row = Math.floor(idx / cols)
              return [
                p.id,
                { x: basePos.x + spacingX * (col + 1), y: basePos.y + spacingY * row },
              ] as const
            }),
          )
          const past = [...s.historyPast, JSON.parse(JSON.stringify({ nodes: s.nodes, edges: s.edges }))].slice(-50)
          return {
            nodes: s.nodes.map((n: any) => (ids.has(n.id) ? { ...n, position: posById.get(n.id)! } : n)),
            historyPast: past,
            historyFuture: [],
          }
        })
      }
    } catch (error) {
      console.error('Failed to upload image:', error)
      toast('上传图片失败，请稍后再试', 'error')
    } finally {
      useUploadRuntimeStore.getState().finishNodeImageUpload(id)
    }
  }, [supportsImageUpload, nodeHasUploadIntent, nodeHasPendingUploads, id, updateNodeData])

  const isImageNode = coreKind === 'image'
  const hideImageMeta = isImageNode && !selected
  const isImageExpired = Boolean((data as any)?.expired || (data as any)?.imageExpired)
  // GenerationOverlay 已覆盖 running/queued 状态；本地上传仍需独立提示，避免组件 remount 后丢失“上传中”事实。
  const showImageStateOverlay = Boolean(isImageNode && (isImageExpired || isUploadingImage))
  const imageStateLabel = isUploadingImage ? '上传中' : isImageExpired ? '已过期' : null

  const isCanvasMediaNode = coreKind === 'image' || coreKind === 'video'
  const isResizableVisualNode = isCanvasMediaNode || isWebHeroNode || isPptDeckNode
  const useMediaFocusToolbar = isCanvasMediaNode
  const showBottomToolbar = isSingleSelectionActive && !isPlainTextNode && !isWebHeroNode && !isPptDeckNode
  const showUpstreamReferenceStrip = Boolean(useMediaFocusToolbar && (isImageNode || isVideoNode) && isSingleSelectionActive)
  const serializedUpstreamReferenceItems = useRFStore(
    React.useCallback((state) => {
      if (!showUpstreamReferenceStrip) return ''
      const items = collectOrderedUpstreamReferenceItems(state.nodes, state.edges, id)
      if (items.length === 0) return ''
      return items.map((item) => JSON.stringify(item)).join('\n')
    }, [id, showUpstreamReferenceStrip]),
  )
  const upstreamReferenceItems = React.useMemo<OrderedUpstreamReferenceItem[]>(() => {
    if (!serializedUpstreamReferenceItems) return EMPTY_UPSTREAM_REFERENCE_ITEMS
    return serializedUpstreamReferenceItems
      .split('\n')
      .filter(Boolean)
      .map((item) => JSON.parse(item) as OrderedUpstreamReferenceItem)
  }, [serializedUpstreamReferenceItems])
  const canvasReferencePickerActive = canvasReferencePicker?.targetNodeId === id
  const handleToggleCanvasReferencePicker = React.useCallback(() => {
    if (canvasReferencePickerActive) {
      closeCanvasReferencePicker()
      return
    }
    openCanvasReferencePicker({
      targetNodeId: id,
      blockedSourceNodeIds: upstreamReferenceItems.map((item) => item.sourceNodeId),
    })
  }, [canvasReferencePickerActive, closeCanvasReferencePicker, id, openCanvasReferencePicker, upstreamReferenceItems])
  const handleRemoveUpstreamReference = React.useCallback((edgeId: string) => {
    deleteEdge(edgeId)
  }, [deleteEdge])
  const handleReorderUpstreamReference = React.useCallback((draggedEdgeId: string, targetEdgeId: string) => {
    const currentIndex = upstreamReferenceItems.findIndex((item) => item.edgeId === draggedEdgeId)
    const targetIndex = upstreamReferenceItems.findIndex((item) => item.edgeId === targetEdgeId)
    if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) return
    const reordered = upstreamReferenceItems.slice()
    const [moved] = reordered.splice(currentIndex, 1)
    if (!moved) return
    reordered.splice(targetIndex, 0, moved)
    updateNodeData(id, {
      upstreamReferenceOrder: reordered.map((item) => item.sourceNodeId),
    })
  }, [id, updateNodeData, upstreamReferenceItems])
  const canvasZoom = useStore((state) => {
    if (!showBottomToolbar) return 1
    const zoom = state.transform[2]
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  })

  const clampFinite = (value: unknown, min: number, max: number, fallback: number) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, Math.round(n)))
  }

  const visualNodeDefaults = React.useMemo(() => {
    if (isWebHeroNode) return { width: 1480, height: 1180, minWidth: 820, maxWidth: 2200, minHeight: 820, maxHeight: 2200 }
    if (isPptDeckNode) return { width: 1000, height: 760, minWidth: 720, maxWidth: 1600, minHeight: 580, maxHeight: 1200 }
    const profile: NodeSizeProfile =
      coreKind === 'video'
        ? getNodeSizeProfile({ coreType: 'video' })
        : kind === 'imageEdit'
          ? getNodeSizeProfile({ kind: 'imageEdit' })
          : getNodeSizeProfile({ coreType: 'image' })
    return {
      width: profile.defaultW,
      height: profile.defaultH,
      minWidth: profile.minW,
      maxWidth: profile.maxW,
      minHeight: profile.minH,
      maxHeight: profile.maxH,
    }
  }, [coreKind, isPptDeckNode, isWebHeroNode, kind])

  const textManualSized = (data as any)?.textManualSized === true
  const [textResizePreview, setTextResizePreview] = React.useState<{ width: number; height: number } | null>(null)
  const resolvedTextNodeSize = isOrdinaryTextNode
    ? estimateTextNodeSize(data as Record<string, unknown>)
    : null
  const persistedTextNodeWidth = resolvedTextNodeSize?.w
    ?? clampFinite((data as any)?.nodeWidth, TEXT_NODE_MIN_WIDTH, TEXT_NODE_MAX_WIDTH, TEXT_NODE_DEFAULT_WIDTH)
  const persistedTextNodeHeight = resolvedTextNodeSize?.h
    ?? clampFinite((data as any)?.nodeHeight, TEXT_NODE_MIN_HEIGHT, TEXT_NODE_MAX_HEIGHT, TEXT_NODE_DEFAULT_HEIGHT)

  const nodeWidth = isResizableVisualNode
    ? clampFinite((data as any)?.nodeWidth, visualNodeDefaults.minWidth, visualNodeDefaults.maxWidth, visualNodeDefaults.width)
    : isPlainTextNode
      ? isWebAssetBoardItem
        ? clampFinite((data as any)?.nodeWidth, 160, 320, 248)
        : isWebAssetBoardDisplay
          ? clampFinite((data as any)?.nodeWidth, 720, 1240, 980)
          : textResizePreview?.width ?? persistedTextNodeWidth
    : typeof (data as any)?.nodeWidth === 'number' && Number.isFinite((data as any)?.nodeWidth)
      ? Math.max(320, Math.min(720, Number((data as any)?.nodeWidth)))
      : coreKind === 'video' ? 400 : 360

  const nodeHeight = isResizableVisualNode
    ? clampFinite((data as any)?.nodeHeight, visualNodeDefaults.minHeight, visualNodeDefaults.maxHeight, visualNodeDefaults.height)
    : null
  const toolbarBaseWidth = useMediaFocusToolbar ? 650 : 380
  const toolbarMinScale = 220 / toolbarBaseWidth
  const toolbarScale = Math.max(toolbarMinScale, canvasZoom)
  const toolbarWidthCss = `min(${toolbarBaseWidth}px, calc((100vw - 48px) / ${toolbarScale}))`
  const toolbarMaxHeightCss = `calc(60vh / ${toolbarScale})`
  const textNodeHeight = isPlainTextNode
      ? isWebAssetBoardItem
        ? clampFinite((data as any)?.nodeHeight, 72, 128, 104)
        : isWebAssetBoardDisplay
          ? clampFinite((data as any)?.nodeHeight, 420, 760, 560)
          : textResizePreview?.height ?? persistedTextNodeHeight
    : null

  const variantsOpen = Boolean((data as any)?.variantsOpen)
  const variantsBaseWidthRaw = Number((data as any)?.variantsBaseWidth)
  const variantsBaseHeightRaw = Number((data as any)?.variantsBaseHeight)
  const variantsBaseWidth = Number.isFinite(variantsBaseWidthRaw) && variantsBaseWidthRaw > 0 ? variantsBaseWidthRaw : null
  const variantsBaseHeight = Number.isFinite(variantsBaseHeightRaw) && variantsBaseHeightRaw > 0 ? variantsBaseHeightRaw : null

  const handleMediaResizeEnd = React.useCallback(
    (_event: unknown, params: NodeResizeEndParams) => {
      const nextWidth = clampFinite(params?.width, visualNodeDefaults.minWidth, visualNodeDefaults.maxWidth, nodeWidth)
      const nextHeight = clampFinite(params?.height, visualNodeDefaults.minHeight, visualNodeDefaults.maxHeight, nodeHeight ?? visualNodeDefaults.height)
      if (Math.abs(nextWidth - nodeWidth) <= 1 && Math.abs(nextHeight - (nodeHeight ?? visualNodeDefaults.height)) <= 1) {
        return
      }
      updateNodeData(id, {
        nodeWidth: nextWidth,
        nodeHeight: nextHeight,
        mediaAutoSized: null,
      })
    },
    [clampFinite, id, nodeHeight, nodeWidth, updateNodeData, visualNodeDefaults.height, visualNodeDefaults.maxHeight, visualNodeDefaults.maxWidth, visualNodeDefaults.minHeight, visualNodeDefaults.minWidth],
  )

  const handleTextResizeEnd = React.useCallback(
    (_event: unknown, params: NodeResizeEndParams) => {
      const nextSize = estimateTextNodeSize({
        ...(data as Record<string, unknown>),
        nodeWidth: params?.width ?? persistedTextNodeWidth,
        nodeHeight: params?.height ?? persistedTextNodeHeight,
        textManualSized: true,
      })
      setTextResizePreview(null)
      if (
        textManualSized
        && Math.abs(nextSize.w - persistedTextNodeWidth) <= 1
        && Math.abs(nextSize.h - persistedTextNodeHeight) <= 1
      ) {
        return
      }
      updateNodeData(id, {
        nodeWidth: nextSize.w,
        nodeHeight: nextSize.h,
        textManualSized: true,
      })
    },
    [data, id, persistedTextNodeHeight, persistedTextNodeWidth, textManualSized, updateNodeData],
  )

  const handleTextResize = React.useCallback(
    (_event: unknown, params: NodeResizeEndParams) => {
      const width = clampFinite(params?.width, TEXT_NODE_MIN_WIDTH, TEXT_NODE_MAX_WIDTH, persistedTextNodeWidth)
      const height = clampFinite(params?.height, TEXT_NODE_MIN_HEIGHT, TEXT_NODE_MAX_HEIGHT, persistedTextNodeHeight)
      setTextResizePreview((current) => (
        current?.width === width && current.height === height
          ? current
          : { width, height }
      ))
    },
    [clampFinite, persistedTextNodeHeight, persistedTextNodeWidth],
  )

  const imageNodeOverlayLabel = deriveDisplayLabel(
    typeof data?.label === 'string' ? data.label : '',
    naturalWidth,
    naturalHeight,
  )
  const imageNodeSequenceNo = React.useMemo(() => (
    resolveTaskNodeImageSequenceNo({
      data,
      imageResults,
      imagePrimaryIndex,
    })
  ), [data, imagePrimaryIndex, imageResults])

  const imageProps = {
    nodeId: id,
    nodeKind: kind,
    nodeLabel: imageNodeOverlayLabel,
    sequenceNo: imageNodeSequenceNo,
    selected: isSingleSelectionActive,
    nodeWidth,
    nodeHeight: nodeHeight ?? visualNodeDefaults.height,
    variantsOpen,
    variantsBaseWidth,
    variantsBaseHeight,
    hasPrimaryImage,
    imageResults,
    imagePrimaryIndex,
    primaryImageUrl,
    fileRef,
    canUpload: supportsImageUpload,
    uploading: isUploadingImage,
    onUpload: handleImageUpload,
    onSelectPrimary: (idx: number, url: string) => {
      setImagePrimaryIndex(idx)
      updateNodeData(id, { imageUrl: url, imagePrimaryIndex: idx })
    },
    adoptedImageIndex,
    isPrimaryImageAdopted,
    onAdoptImage: (idx: number) => {
      const target = imageResults[idx]
      if (!target) return
      updateNodeData(id, {
        adoptedImageAsset: {
          index: idx,
          url: target.url,
          adoptedAt: new Date().toISOString(),
          progress: typeof data?.progress === 'number' && Number.isFinite(data.progress) ? data.progress : null,
        } satisfies AdoptedAssetMetadata,
      })
      toast(`已采纳第 ${idx + 1} 张图片`, 'success')
    },
    compact: hideImageMeta,
    showStateOverlay: showImageStateOverlay,
    stateLabel: imageStateLabel,
    onUpdateNodeData: (patch: Record<string, unknown>) => updateNodeData(id, patch),
    mediaAutoSized: (data as any)?.mediaAutoSized ?? null,
    nodeShellText,
    darkCardShadow,
    mediaOverlayText,
    subtleOverlayBackground,
    imageUrl,
    themeWhite: theme.white,
    imageEditPreview,
  }

  const isRunning = status === 'running' || status === 'queued'

  const toolbarPreview = React.useMemo(() => {
    if (primaryMedia && primaryMediaUrl) {
      return { url: primaryMediaUrl, kind: primaryMedia as any }
    }
    // Fallbacks for legacy nodes
    if (hasImageResults) return { url: imageUrl || (data as any)?.imageUrl || null, kind: 'image' as const }
    if (isVideoNode) {
      const url = (data as any)?.videoUrl || videoResults[videoPrimaryIndex]?.url || null
      return { url, kind: 'video' as const }
    }
    if (isAudioNode) return { url: (data as any)?.audioUrl || null, kind: 'audio' as const }
    return { url: null, kind: 'image' as const }
  }, [
    primaryMedia,
    primaryMediaUrl,
    hasImageResults,
    imageUrl,
    data,
    isVideoNode,
    videoResults,
    videoPrimaryIndex,
    isAudioNode,
  ])

  const handlePreview = React.useCallback(() => {
    if (!toolbarPreview.url) return
    useUIStore.getState().openPreview({ url: toolbarPreview.url, kind: toolbarPreview.kind as any, name: data?.label })
  }, [data?.label, toolbarPreview])

  const handleDownload = React.useCallback(() => {
    if (!toolbarPreview.url) return
    void downloadUrl({
      url: toolbarPreview.url,
      filename: appendDownloadSuffix(data?.label || kind || 'node', Date.now()),
      preferBlob: true,
      fallbackTarget: '_blank',
    })
  }, [data?.label, kind, toolbarPreview])

  const webHeroPreviewState = React.useMemo(() => {
    const record = data as Record<string, unknown>
    const documentHtml = typeof record.webHeroDocumentHtml === 'string' ? record.webHeroDocumentHtml : ''
    const html = typeof record.webHeroHtml === 'string' ? record.webHeroHtml : ''
    const css = typeof record.webHeroCss === 'string' ? record.webHeroCss : ''
    const rawMediaKind = typeof record.webHeroMediaKind === 'string' ? record.webHeroMediaKind : ''
    const mediaKind: WebHeroMediaKind | null = rawMediaKind === 'video' || rawMediaKind === 'image' ? rawMediaKind : null
    const mediaUrl = typeof record.webHeroMediaUrl === 'string' ? record.webHeroMediaUrl : ''
    const sourceLabel = typeof record.webHeroSourceLabel === 'string' ? record.webHeroSourceLabel : ''
    return {
      documentHtml,
      html,
      css,
      mediaKind,
      mediaUrl,
      sourceLabel,
    }
  }, [data])

  const webHeroRefinementAttachments = React.useMemo(
    () => readWebHeroRefinementAttachments((data as Record<string, unknown>).webHeroRefinementAttachments),
    [data],
  )

  const handleDownloadWebHeroHtml = React.useCallback(() => {
    const documentHtml = webHeroPreviewState.documentHtml.trim()
    if (!documentHtml) return
    const blob = new Blob([documentHtml], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${appendDownloadSuffix(data?.label || 'canvas-hero', Date.now())}.html`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [data?.label, webHeroPreviewState.documentHtml])

  const [webHeroSavingToAssets, setWebHeroSavingToAssets] = React.useState(false)
  const handleSaveWebHeroToAssets = React.useCallback(async () => {
    const documentHtml = webHeroPreviewState.documentHtml.trim()
    if (!documentHtml) {
      toast('当前没有可保存的网页内容', 'warning')
      return
    }
    setWebHeroSavingToAssets(true)
    try {
      // Why this exists: webHero pages are auto-synced to assets on canvas save
      // (sync-canvas-assets.ts upserts one entry per nodeId). This manual save
      // creates a separate point-in-time snapshot. We deliberately omit
      // `sourceNodeId` so the auto-sync's dedupe marker doesn't overwrite us.
      const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
      await createServerAsset({
        name: `${data?.label || '网页'}-${timestamp}`,
        projectId: currentProject?.id || null,
        data: {
          kind: 'webpage',
          documentHtml,
          html: webHeroPreviewState.html,
          css: webHeroPreviewState.css,
        },
      })
      toast('已保存到我的资产', 'success')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '保存到我的资产失败'
      toast(message, 'error')
    } finally {
      setWebHeroSavingToAssets(false)
    }
  }, [currentProject?.id, data?.label, webHeroPreviewState.css, webHeroPreviewState.documentHtml, webHeroPreviewState.html])

  const handleRunWebHeroNode = React.useCallback(() => {
    void runNodeDagToTarget(id, useRFStore.getState, useRFStore.setState, { concurrency: 1 }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      toast(message || '网页节点执行失败', 'error')
    })
  }, [id])

  const handleApplyWebHeroTweaks = React.useCallback(() => {
    if (!webHeroRefinementAttachments.length) {
      toast('请先添加至少一条 Tweaks 评论', 'error')
      return
    }
    if (!webHeroPreviewState.html.trim() || !webHeroPreviewState.css.trim() || !webHeroPreviewState.documentHtml.trim()) {
      toast('当前网页节点还没有可调优的网页代码，请先生成一次网页', 'error')
      return
    }
    handleRunWebHeroNode()
  }, [handleRunWebHeroNode, webHeroPreviewState.css, webHeroPreviewState.documentHtml, webHeroPreviewState.html, webHeroRefinementAttachments])

  const handleUpdateWebHeroCode = React.useCallback((value: { html: string; css: string }) => {
    const htmlValue = value.html.replace(/\r\n/g, '\n')
    const cssValue = value.css.replace(/\r\n/g, '\n')
    const nextDocumentHtml = rebuildWebHeroDocumentHtml({
      currentDocumentHtml: webHeroPreviewState.documentHtml,
      html: htmlValue,
      css: cssValue,
    })
    updateNodeData(id, {
      webHeroHtml: htmlValue,
      webHeroCss: cssValue,
      webHeroDocumentHtml: nextDocumentHtml,
      webHeroCodegenSessionPageHash: buildWebHeroCurrentPageHash({
        html: htmlValue,
        css: cssValue,
        documentHtml: nextDocumentHtml,
      }),
      status: 'success',
      progress: 100,
      webHeroProgressLabel: '已应用本地代码修改',
      lastError: null,
    })
  }, [id, updateNodeData, webHeroPreviewState.documentHtml])

  const webHeroProps = {
    documentHtml: webHeroPreviewState.documentHtml,
    html: webHeroPreviewState.html,
    css: webHeroPreviewState.css,
    mediaKind: webHeroPreviewState.mediaKind,
    mediaUrl: webHeroPreviewState.mediaUrl,
    sourceLabel: webHeroPreviewState.sourceLabel,
    refinementAttachments: webHeroRefinementAttachments,
    prompt,
    nodeShellText,
    isDarkUi,
    isRunning,
    isResizing: isWebHeroNode && dragging,
    onPromptChange: (value: string) => {
      setPrompt(value)
      updateNodeData(id, { prompt: value })
    },
    onChangeCode: handleUpdateWebHeroCode,
    onChangeRefinementAttachments: (nextAttachments: ReturnType<typeof readWebHeroRefinementAttachments>) => {
      updateNodeData(id, { webHeroRefinementAttachments: nextAttachments })
    },
    onRun: handleRunWebHeroNode,
    onApplyTweaks: handleApplyWebHeroTweaks,
    onDownloadHtml: handleDownloadWebHeroHtml,
    onSaveToAssets: handleSaveWebHeroToAssets,
    isSavingToAssets: webHeroSavingToAssets,
  }

  const pptDeckFlowId = useUIStore((s) => (s.currentFlow?.id ? String(s.currentFlow.id) : ''))
  const pptDeckProjectId = useUIStore((s) => (s.currentProject?.id ? String(s.currentProject.id) : null))
  const featureBlocks = renderFeatureBlocks(schema.features, {
    featureFlags,
    videoContent,
    imageProps,
    webHeroProps,
    pptDeckProps: {
      data: data as Record<string, unknown>,
      nodeId: id,
      flowId: pptDeckFlowId,
      projectId: pptDeckProjectId,
      onPptxReady: (patch) => {
        if (!patch || typeof patch !== 'object') return
        const next: Record<string, unknown> = {}
        if (typeof patch.pptxUrl === 'string' && patch.pptxUrl) next.pptxUrl = patch.pptxUrl
        if (typeof patch.pptxPath === 'string' && patch.pptxPath) next.pptxPath = patch.pptxPath
        if (typeof patch.pptMasterStatus === 'string' && patch.pptMasterStatus) next.pptMasterStatus = patch.pptMasterStatus
        if (Object.keys(next).length) updateNodeData(id, next)
      },
    },
  })
	  const [mentionOpen, setMentionOpen] = React.useState(false)
	  const [mentionFilter, setMentionFilter] = React.useState('')
	  const [mentionItems, setMentionItems] = React.useState<MentionSuggestionItem[]>([])
	  const [mentionLoading, setMentionLoading] = React.useState(false)
	  const mentionMetaRef = React.useRef<{
	    at: number
	    caret: number
	    target?: 'prompt'
	    sceneId?: string
	  } | null>(null)
  const rewriteRequestIdRef = React.useRef(0)

  const autoCharacterOptions = React.useMemo(() => {
    if (!mergedCharacterRefs.length) return []
    const connected = new Set<string>()
    edgesForCharacters.forEach((edge) => {
      if (edge.target === id && characterRefMap.has(edge.source)) {
        connected.add(edge.source)
      }
    })
    return mergedCharacterRefs
      .map((ref) => ({
        value: ref.nodeId,
        label: ref.username ? `${ref.displayName} · @${ref.username}` : ref.displayName,
        connected: connected.has(ref.nodeId),
        username: ref.username,
        displayName: ref.displayName,
        rawLabel: ref.rawLabel,
      }))
      .sort((a, b) => Number(b.connected) - Number(a.connected))
  }, [characterRefMap, edgesForCharacters, id, mergedCharacterRefs])
  const connectedCharacterOptions = React.useMemo(() => {
    const withUsername = autoCharacterOptions.filter((opt) => opt.username)
    const direct = withUsername.filter((opt) => opt.connected)
    return direct.length > 0 ? direct : withUsername
  }, [autoCharacterOptions])
  const upstreamReferenceMentionRefs = useRFStore(
    React.useCallback((s): CharacterRef[] => {
      if (!wantsCharacterRefs) return EMPTY_CHARACTER_REFS
      const refs: CharacterRef[] = []
      collectDynamicUpstreamReferenceEntriesForNode(s.nodes, s.edges, id).forEach((entry) => {
        const username = toMentionUsername(entry.label)
        if (!username) return
        refs.push({
          nodeId: `upstream-ref:${id}:${username}`,
          username,
          displayName: String(entry.name || entry.label).trim() || username,
          rawLabel: String(entry.name || entry.label).trim() || username,
          source: 'character',
        })
      })
      return refs
    }, [id, wantsCharacterRefs]),
    areCharacterRefsEqual,
  )
  const mentionSuggestionOptions = React.useMemo(() => {
    const byUsername = new Map<string, CharacterRef>()
      const push = (item: {
        username?: string
        displayName?: string
        rawLabel?: string
        source?: 'character' | 'asset'
        assetUrl?: string | null
        assetId?: string | null
        assetRefId?: string | null
        assetName?: string | null
      }) => {
      const username = toMentionUsername(item.username)
      if (!username) return
      const key = username.toLowerCase()
      if (byUsername.has(key)) return
      const displayName = String(item.displayName || '').trim() || username
      byUsername.set(key, {
        nodeId: `mention:${key}`,
        username,
        displayName,
        rawLabel: String(item.rawLabel || displayName).trim() || displayName,
        source: item.source === 'asset' ? 'asset' : 'character',
        assetUrl: item.assetUrl || null,
        assetId: item.assetId || null,
        assetRefId: item.assetRefId || null,
        assetName: item.assetName || null,
      })
    }
    connectedCharacterOptions.forEach(push)
    upstreamReferenceMentionRefs.forEach(push)
    canvasAssetMentionRefs.forEach(push)
    projectAssetMentionRefs.forEach(push)
    return Array.from(byUsername.values())
  }, [canvasAssetMentionRefs, connectedCharacterOptions, projectAssetMentionRefs, upstreamReferenceMentionRefs])
  const isUsingWorkflowCharacters = React.useMemo(
    () => connectedCharacterOptions.length > 0 && connectedCharacterOptions.every((opt) => !opt.connected),
    [connectedCharacterOptions],
  )

  const handleSmartGenerateVideoPrompt = React.useCallback(async () => {
    if (viewOnly || !isVideoNode) return
    if (videoPromptGenerationLoading) return
    if (status === 'running' || status === 'queued') return

    const { nodes, edges } = useRFStore.getState()
    const upstreamContext = collectUpstreamVideoTextContext(nodes, edges, id)
    if (!upstreamContext.combinedText.trim()) {
      toast('请先连接上游文本节点，再智能生成视频提示词', 'warning')
      return
    }

    const mentionList = connectedCharacterOptions
      .map((opt) => String(opt.username || '').replace(/^@/, '').trim())
      .filter(Boolean)
      .map((username) => `@${username}`)
      .join(' ')

    const systemPrompt = [
      '你是 JarvisHub 的视频提示词生成助手。',
      '你的唯一任务是根据上游文本上下文，输出当前视频节点唯一的最终执行 prompt。',
      '只输出最终 prompt 正文，不要解释、不要标题、不要 Markdown、不要 JSON。',
      '若上游文本冲突严重或信息不足以生成稳定 prompt，必须只输出一行：ERROR: 具体原因。',
    ].join('\n')

    const promptText = [
      '请基于以下上下文，生成当前视频节点的最终执行 prompt。',
      `视频参数：时长=${videoDuration}s；画幅=${aspect || '16:9'}`,
      mentionList ? `可用角色引用：${mentionList}` : null,
      prompt.trim() ? `当前节点已有 prompt 草稿（可参考但不要机械复述）：\n${prompt.trim()}` : null,
      '上游文本上下文（按画布连接顺序拼接）：',
      upstreamContext.combinedText,
      '输出要求：',
      '- 只输出最终视频 prompt 正文。',
      '- 把明确的镜头顺序、动作、场景、节奏、台词线索和连续性约束压缩进一条连贯 prompt。',
      '- 不要返回“Shot 1/镜头 1/分点列表/说明文字”。',
      '- 如果证据冲突或不足，请输出 ERROR。',
    ]
      .filter(Boolean)
      .join('\n\n')

    try {
      setVideoPromptGenerationLoading(true)
      const ui = useUIStore.getState()
      const promptRefineModelAlias = resolvePromptRefineModelAlias()
      const taskRes = await runPublicTask({
        request: {
          kind: 'prompt_refine',
          prompt: promptText,
          extras: {
            systemPrompt,
            ...(promptRefineModelAlias ? { modelAlias: promptRefineModelAlias } : {}),
            persistAssets: false,
          },
        },
      })
      const nextPrompt = extractTextFromTaskResult(taskRes.result).trim()
      if (!nextPrompt) {
        throw new Error('模型未返回视频提示词')
      }
      if (/^ERROR\s*:/i.test(nextPrompt)) {
        throw new Error(nextPrompt.replace(/^ERROR\s*:\s*/i, '').trim() || '上游文本不足，无法生成视频提示词')
      }
      setPrompt(nextPrompt)
      updateNodeData(id, { prompt: nextPrompt })
      toast('已根据上游文本生成视频提示词', 'success')
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : '生成视频提示词失败'
      toast(message, 'error')
    } finally {
      setVideoPromptGenerationLoading(false)
    }
  }, [
    aspect,
    connectedCharacterOptions,
    id,
    isVideoNode,
    orientation,
    prompt,
    resolvePromptRefineModelAlias,
    status,
    updateNodeData,
    videoDuration,
    videoPromptGenerationLoading,
    viewOnly,
  ])

const rewritePromptWithCharacters = React.useCallback(
  async ({
    basePrompt,
    roles,
    modelValue,
  }: {
    basePrompt: string
    roles: Array<{ mention: string; displayName: string; aliases: string[] }>
    modelValue: string
  }) => {
    const summary = roles
      .map((role, idx) => {
        const aliasDesc = role.aliases.length ? role.aliases.join(' / ') : '无'
        return [
          `角色 ${idx + 1}`,
          `- 统一引用：${role.mention}`,
          `- 名称：${role.displayName || role.mention}`,
          `- 可能的别名/同音：${aliasDesc}`,
        ].join('\n')
      })
      .join('\n\n')
    const instructions = [
      '【角色设定】',
      summary,
      '',
      '【任务说明】',
      '请在保持原文语气、内容和结构不变的前提下，完成以下操作：',
      '1. 将所有与上述角色相关的称呼（包含别名、同音写法）替换为对应的 @username；',
      '2. 如果某个角色在原文未出现，也请在合适的位置补上一处 @username；',
      '3. 只输出替换后的脚本正文，不要添加解释、前缀或 Markdown；',
      '4. 全文保持中文。',
      '5. 确保每个 @username 前后至少保留一个空格，避免紧贴其他字符。',
      '',
      '【原始脚本】',
      basePrompt,
    ].join('\n')
    const systemPrompt =
      '你是一个提示词修订助手。请根据用户提供的角色映射，统一替换或补充脚本中的角色引用，只输出修改后的脚本文本。务必确保每个 @username 前后至少保留一个空格。'
    const ui = useUIStore.getState()
    const persist = ui.assetPersistenceEnabled
    const taskRes = await runPublicTask({
      request: {
        kind: 'prompt_refine',
        prompt: instructions,
        extras: { systemPrompt, modelAlias: modelValue, persistAssets: persist },
      },
    })
    const text = extractTextFromTaskResult(taskRes.result)
    return text.trim()
  },
  [],
)

  const handleApplyCharacterMentions = React.useCallback(async () => {
    if (!connectedCharacterOptions.length) return
    const mentionList = connectedCharacterOptions
      .map((opt) => `@${String(opt.username || '').replace(/^@/, '')}`)
      .filter(Boolean)
    const appendedMentions = mentionList.join(' ')
    const roles = connectedCharacterOptions.map((opt) => {
      const username = String(opt.username || '').replace(/^@/, '')
      const mention = `@${username}`
      const aliasList = [
        opt.displayName,
        opt.rawLabel,
        username,
        opt.displayName?.replace(/\s+/g, ''),
        opt.rawLabel?.replace(/\s+/g, ''),
      ].filter((alias): alias is string => Boolean(alias && alias.trim().length > 0))
      return { mention, displayName: opt.displayName || mention, aliases: aliasList }
    })

    if (!prompt.trim()) {
      if (appendedMentions) {
        setPrompt(appendedMentions)
        updateNodeData(id, { prompt: appendedMentions })
      }
      setCharacterRewriteError(null)
      return
    }

    setCharacterRewriteError(null)
    const currentRequestId = ++rewriteRequestIdRef.current
    setCharacterRewriteLoading(true)
    try {
      let rewritten = ''
      try {
        rewritten = await rewritePromptWithCharacters({
          basePrompt: prompt,
          roles,
          modelValue: characterRewriteModel,
        })
      } catch (err) {
        console.warn('[TaskNode] rewrite via AI failed', err)
        setCharacterRewriteError(err instanceof Error ? err.message : 'AI 替换失败，使用本地规则处理')
      }
      let nextText = (rewritten || '').trim()
      if (!nextText) {
        nextText = roles.reduce((acc, role) => {
          const fallback = applyMentionFallback(acc, role.mention, role.aliases)
          return fallback.text
        }, prompt)
      }
      setPrompt(nextText)
      updateNodeData(id, { prompt: nextText })
    } finally {
      if (rewriteRequestIdRef.current === currentRequestId) {
        setCharacterRewriteLoading(false)
      }
    }
  }, [
    connectedCharacterOptions,
    prompt,
    characterRewriteModel,
    rewritePromptWithCharacters,
    id,
    updateNodeData,
  ])
  const handleSetPrimaryVideo = React.useCallback((idx: number) => {
    const target = videoResults[idx]
    if (!target) return
    setVideoPrimaryIndex(idx)
    const shouldUpdateRemixTarget = Object.prototype.hasOwnProperty.call(target, 'remixTargetId')
    const nextRemixTargetId =
      typeof target.remixTargetId === 'string' && target.remixTargetId.trim()
        ? target.remixTargetId.trim()
        : null
    const patch: any = {
      videoPrimaryIndex: idx,
      videoUrl: target.url,
      videoThumbnailUrl: target.thumbnailUrl,
      videoTitle: target.title,
      videoDuration: target.duration,
    }
    if (shouldUpdateRemixTarget) {
      patch.remixTargetId = nextRemixTargetId
      patch.videoPostId = nextRemixTargetId
    }
    updateNodeData(id, patch)
    setVideoExpanded(false)
  }, [id, updateNodeData, videoResults])

  // Define node-specific tools and overflow calculation
  const uniqueDefs = React.useMemo(() => {
    if (hasImageResults) {
      const tools: { key: string; label: string; icon: JSX.Element; onClick: () => void }[] = [
      ]
      if (isPoseEditorEligibleKind(kind)) {
        tools.push(
          {
            key: 'image-edit',
            label: '图片编辑',
            icon: <IconAdjustments size={16} />,
            onClick: () => openPoseEditor(),
          },
        )
      }
      if (kind === 'image' || kind === 'imageEdit') {
        tools.push(
          {
            key: 'camera-angle',
            label: '角度',
            icon: <IconCamera size={16} />,
            onClick: () => openCameraEditor(),
          },
          {
            key: 'lighting-edit',
            label: '打光',
            icon: <IconBulb size={16} />,
            onClick: () => openLightingEditor(),
          },
        )
      }
      if (supportsReversePrompt) {
        tools.push({
          key: 'reverse',
          label: '反推提示词',
          icon: <IconPhotoSearch size={16} />,
          onClick: () => onReversePrompt(),
        })
      }
      return tools
    }
    // No extra tools for non-image kinds (video etc.) — preview/download are still rendered by TopToolbar.
    return [] as { key: string; label: string; icon: JSX.Element; onClick: () => void }[]
  }, [
    hasImageResults,
    kind,
    openCameraEditor,
    openLightingEditor,
    openPoseEditor,
    onReversePrompt,
    supportsReversePrompt,
  ])

  type VeoCandidateImage = { url: string; label: string; sourceType: 'image' | 'video' }
  const veoCandidateImages = React.useMemo(() => {
    if (!veoImageModalMode) return [] as VeoCandidateImage[]
    if (!isVideoNode || resolvedVideoVendor !== 'veo') return [] as VeoCandidateImage[]

    const seen = new Set<string>()
    const results: VeoCandidateImage[] = []
    const { nodes, edges } = useRFStore.getState()

    nodes.forEach((node) => {
      const sd: any = node.data || {}
      const kind: string | undefined = sd.kind
      const schema = getTaskNodeSchema(kind)
      const features = new Set(schema.features)
      const label = (sd.label as string | undefined) || node.id
      const isImageProducer =
        schema.category === 'image' ||
        features.has('image') ||
        features.has('imageResults')
      const isVideoProducer =
        schema.category === 'video' ||
        features.has('videoResults')

      const collect = (value?: string | null, sourceType: 'image' | 'video' = 'image') => {
        if (typeof value !== 'string') return
        const trimmed = value.trim()
        if (!trimmed || seen.has(trimmed)) return
        seen.add(trimmed)
        results.push({ url: trimmed, label, sourceType })
      }

      if (isImageProducer) {
        collect(sd.imageUrl, 'image')
        const imgs = Array.isArray(sd.imageResults) ? sd.imageResults : []
        imgs.forEach((img: any) => collect(img?.url, 'image'))
      }

      if (isVideoProducer) {
        collect(sd.videoThumbnailUrl, 'video')
        collect(sd.videoUrl, 'video')
        const videos = Array.isArray(sd.videoResults) ? sd.videoResults : []
        videos.forEach((video: any) => {
          collect(video?.thumbnailUrl, 'video')
          collect(video?.url, 'video')
        })
      }
    })

    return results.slice(0, 20)
  }, [isVideoNode, resolvedVideoVendor, veoImageModalMode])



  React.useEffect(() => {
    if (!suggestionsAllowed && suggestionsEnabled) {
      setSuggestionsEnabled(false)
    }
  }, [suggestionsAllowed, suggestionsEnabled])

  React.useEffect(() => {
    if (suggestTimeout.current) {
      window.clearTimeout(suggestTimeout.current)
      suggestTimeout.current = null
    }
    const value = prompt.trim()
    if (!value || value.length < 6 || !suggestionsEnabled || !suggestionsAllowed) {
      setPromptSuggestions([])
      setActiveSuggestion(0)
      return
    }
    suggestTimeout.current = window.setTimeout(async () => {
      try {
        const mode = promptSuggestMode === 'semantic' ? 'semantic' : 'history'
        const res = await suggestDraftPrompts(value, 'sora', mode)
        setPromptSuggestions(res.prompts || [])
        setActiveSuggestion(0)
      } catch {
        setPromptSuggestions([])
        setActiveSuggestion(0)
      }
    }, 260)
    return () => {
      if (suggestTimeout.current) {
        window.clearTimeout(suggestTimeout.current)
        suggestTimeout.current = null
      }
    }
  }, [prompt, suggestionsEnabled, suggestionsAllowed, promptSuggestMode])

  // 输入 @ 时，基于工作流内连接的角色引用做本地联想（不依赖厂商/Token）。
  React.useEffect(() => {
    if (!mentionOpen) return
    const q = (mentionFilter || '').trim().toLowerCase()
    const items = mentionSuggestionOptions
      .filter((opt) => {
        const username = String(opt.username || '').toLowerCase()
        const displayName = String(opt.displayName || '').toLowerCase()
        return !q || username.includes(q) || displayName.includes(q)
      })
      .slice(0, 12)
      .map((opt): MentionSuggestionItem => ({
        username: opt.username,
        display_name: opt.displayName,
        source: opt.source,
        ...(opt.source === 'asset' && opt.assetUrl
          ? {
              assetBinding: {
                url: opt.assetUrl,
                assetId: opt.assetId || null,
                assetRefId: opt.assetRefId || opt.username,
                assetName: opt.assetName || opt.displayName,
              },
            }
          : null),
      }))
    setMentionItems(items)
    setMentionLoading(false)
  }, [mentionFilter, mentionOpen, mentionSuggestionOptions])

  const hasContent = React.useMemo(() => {
    if (hasImageResults) return Boolean(imageUrl || imageResults.length)
    if (isVideoNode || hasVideoResults) return Boolean((data as any)?.videoUrl)
    if (isAudioNode) return Boolean((data as any)?.audioUrl)
    return false
  }, [hasImageResults, isVideoNode, hasVideoResults, isAudioNode, imageUrl, imageResults.length, data])

  const defaultLabel = React.useMemo(() => {
    if (isComposerNode || hasVideo || hasVideoResults || schema.category === 'video') return '文生视频'
    if (hasImageResults) return '图像节点'
    if (isAudioNode) return '音频节点'
    if (isSubtitleNode) return '字幕节点'
    return 'Task'
  }, [hasImageResults, hasVideo, hasVideoResults, isComposerNode, isAudioNode, isSubtitleNode, schema.category])
  const currentLabel = React.useMemo(() => {
    const text = (data?.label ?? '').trim()
    return text || defaultLabel
  }, [data?.label, defaultLabel])
  const [labelDraft, setLabelDraft] = React.useState(currentLabel)
  const labelInputRef = React.useRef<HTMLInputElement | null>(null)
  React.useEffect(() => {
    setLabelDraft(currentLabel)
  }, [currentLabel])
  React.useEffect(() => {
    if (editing && labelInputRef.current) {
      labelInputRef.current.focus()
      labelInputRef.current.select()
    }
  }, [editing])
  const commitLabel = React.useCallback(() => {
    const next = (labelDraft || '').trim() || defaultLabel
    updateNodeLabel(id, next)
    setEditing(false)
  }, [labelDraft, defaultLabel, id, updateNodeLabel])
  const handleCancelRun = React.useCallback(() => {
    cancelNodeExecution(id)
    setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
  }, [cancelNodeExecution, id, setNodeStatus])
  const shellOutline = 'none'
  const shellShadow = selected ? `${nodeShellShadow}, ${nodeShellGlow}` : nodeShellShadow
  const subtitle = schema.label || defaultLabel
  const inferredProductionMeta = React.useMemo(() => inferProductionNodeMeta(kind), [kind])
  const anchorToggleDecision = decideAnchorToggle({
    kind,
    productionLayer: productionMeta.productionLayer,
    approvalStatus: productionMeta.approvalStatus,
  })
  const isExplicitAnchor = productionMeta.productionLayer === 'anchors'
  const canToggleAnchor = anchorToggleDecision.visible
  const headerMetaBadges = React.useMemo<HeaderMetaBadge[]>(() => {
    const badges: HeaderMetaBadge[] = []
    const productionLayer = productionMeta.productionLayer
    if (productionLayer && PRODUCTION_LAYER_LABELS[productionLayer]) {
      badges.push({
        label: PRODUCTION_LAYER_LABELS[productionLayer],
        color: PRODUCTION_LAYER_BADGE_COLORS[productionLayer] || 'gray',
        variant: 'light',
      })
    }
    const approvalStatus = productionMeta.approvalStatus
    if (approvalStatus && APPROVAL_STATUS_LABELS[approvalStatus]) {
      badges.push({
        label: APPROVAL_STATUS_LABELS[approvalStatus],
        color: APPROVAL_STATUS_BADGE_COLORS[approvalStatus] || 'gray',
        variant: approvalStatus === 'approved' ? 'light' : 'outline',
      })
    }
    return badges
  }, [productionMeta.approvalStatus, productionMeta.productionLayer])
  const handleUnsetAnchor = React.useCallback(() => {
    updateNodeData(id, {
      productionLayer: inferredProductionMeta.productionLayer,
      creationStage: inferredProductionMeta.creationStage,
    })
    appendLog(id, `[${new Date().toLocaleTimeString()}] 已取消锚点`)
    toast('已取消锚点', 'info')
  }, [appendLog, id, inferredProductionMeta.creationStage, inferredProductionMeta.productionLayer, updateNodeData])
  const handleApproveAnchor = React.useCallback(() => {
    updateNodeData(id, {
      productionLayer: 'anchors',
      creationStage: 'world_anchor_lock',
      approvalStatus: 'approved',
    })
    appendLog(id, `[${new Date().toLocaleTimeString()}] 已确认为锚点`)
    toast('已确认为锚点', 'success')
  }, [appendLog, id, updateNodeData])
  const toolbarMetaActions = React.useMemo(() => {
    const actions: ToolbarMetaAction[] = []
    if (anchorToggleDecision.visible) {
      const isAnchorActive = anchorToggleDecision.active
      actions.push({
        key: 'toggle-anchor',
        label: isAnchorActive ? '取消锚点' : '锚点',
        icon: <IconTarget size={16} />,
        onClick: isAnchorActive ? handleUnsetAnchor : handleApproveAnchor,
        active: isAnchorActive,
      })
    }
    return actions
  }, [
    anchorToggleDecision.active,
    anchorToggleDecision.visible,
    handleApproveAnchor,
    handleUnsetAnchor,
  ])

  const visibleDefs = uniqueDefs

  const shellBackground = 'transparent'
  const shellBorder = 'none'
  const shellShadowResolved = 'none'
  const shellPadding = 0
  const shellBackdrop = 'none'
  const textNodePlainText = React.useMemo(
    () => resolveTextNodePlainText({
      data: data as TextNodeDisplaySource,
      latestTextResult,
    }),
    [data, latestTextResult],
  )
  const nodeShellRef = React.useRef<HTMLDivElement | null>(null)
  const textContentRef = React.useRef<HTMLElement | null>(null)
  const textEditingRef = React.useRef(false)
  const [textEditing, setTextEditing] = React.useState(false)
  const [textDraft, setTextDraft] = React.useState(textNodePlainText)
  const [textColorPickerOpen, setTextColorPickerOpen] = React.useState(false)
  const [textBgPickerOpen, setTextBgPickerOpen] = React.useState(false)
  const TEXT_COLOR_PRESETS = React.useMemo(
    () => ['#0f172a', '#f8fafc', '#1d4ed8', '#b91c1c', '#047857', '#7c3aed'],
    [],
  )
  const TEXT_BG_PRESETS = React.useMemo(
    () => ['rgba(248,250,255,0.95)', 'rgba(12,17,28,0.88)', '#fff7ed', '#eff6ff', '#ecfeff', '#f5f3ff'],
    [],
  )
  const blurActiveEditableElement = React.useCallback(() => {
    const activeElement = document.activeElement
    if (!(activeElement instanceof HTMLElement)) return
    if (nodeShellRef.current?.contains(activeElement)) return
    if (
      activeElement.isContentEditable ||
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement ||
      activeElement instanceof HTMLSelectElement
    ) {
      activeElement.blur()
    }
  }, [])
  const withAlpha = React.useCallback((colorValue: string, alpha: number): string => {
    const raw = String(colorValue || '').trim()
    if (!raw) return `rgba(15,23,42,${alpha})`
    const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (hex) {
      const v = hex[1]
      const full = v.length === 3 ? v.split('').map((c) => `${c}${c}`).join('') : v
      const r = parseInt(full.slice(0, 2), 16)
      const g = parseInt(full.slice(2, 4), 16)
      const b = parseInt(full.slice(4, 6), 16)
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
    const rgb = raw.match(/^rgba?\(([^)]+)\)$/i)
    if (rgb) {
      const parts = rgb[1].split(',').map((p) => p.trim())
      const r = Number(parts[0] || 0)
      const g = Number(parts[1] || 0)
      const b = Number(parts[2] || 0)
      if ([r, g, b].every((n) => Number.isFinite(n))) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`
      }
    }
    return raw
  }, [])
  const textBackgroundTint = withAlpha(textBackgroundColor, 0.125)
  React.useEffect(() => {
    if (!textEditingRef.current) setTextDraft(textNodePlainText)
  }, [textNodePlainText])
  const startTextEditing = React.useCallback(() => {
    if (viewOnly) return
    setTextDraft(textNodePlainText)
    textEditingRef.current = true
    setTextEditing(true)
  }, [textNodePlainText, viewOnly])
  const commitTextEditing = React.useCallback(() => {
    if (!textEditingRef.current) return
    textEditingRef.current = false
    setTextEditing(false)
    setPrompt(textDraft)
    updateNodeData(id, buildTextNodeMarkdownPatch(textDraft))
  }, [id, textDraft, updateNodeData])
  const cancelTextEditing = React.useCallback(() => {
    if (!textEditingRef.current) return
    textEditingRef.current = false
    setTextEditing(false)
    setTextDraft(textNodePlainText)
  }, [textNodePlainText])
  React.useLayoutEffect(() => {
    if (!isOrdinaryTextNode || textManualSized || textResizePreview) return
    const shellEl = nodeShellRef.current
    const contentEl = textContentRef.current
    if (!shellEl || !contentEl) return

    const frameId = window.requestAnimationFrame(() => {
      const shellRect = shellEl.getBoundingClientRect()
      const contentRect = contentEl.getBoundingClientRect()
      const horizontalChrome = Math.max(0, Math.round(shellRect.width - contentRect.width))
      const verticalChrome = Math.max(0, Math.round(shellRect.height - contentRect.height))
      const currentWidth = nodeWidth
      const currentHeight = textNodeHeight ?? TEXT_NODE_DEFAULT_HEIGHT
      const nextWidth = clampFinite(
        Math.ceil(contentEl.scrollWidth + horizontalChrome),
        TEXT_NODE_DEFAULT_WIDTH,
        TEXT_NODE_MAX_WIDTH,
        currentWidth,
      )
      const nextHeight = clampFinite(
        Math.ceil(contentEl.scrollHeight + verticalChrome),
        TEXT_NODE_MIN_HEIGHT,
        TEXT_NODE_MAX_HEIGHT,
        currentHeight,
      )

      if (Math.abs(nextWidth - currentWidth) <= 1 && Math.abs(nextHeight - currentHeight) <= 1) {
        return
      }

      updateNodeData(id, {
        nodeWidth: nextWidth,
        nodeHeight: nextHeight,
      })
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [
    clampFinite,
    id,
    isOrdinaryTextNode,
    nodeWidth,
    textDraft,
    textEditing,
    textNodeHeight,
    textNodePlainText,
    textManualSized,
    textResizePreview,
    updateNodeData,
  ])
  const isFreshAiChatNode = React.useMemo(() => {
    const enabled = (data as any)?.aiChatPlanIsNew !== false
    if (!enabled) return false
    const createdAt = typeof (data as any)?.aiChatPlanCreatedAt === 'string'
      ? String((data as any).aiChatPlanCreatedAt).trim()
      : ''
    if (!createdAt) return false
    const createdAtMs = Date.parse(createdAt)
    if (!Number.isFinite(createdAtMs)) return false
    return Date.now() - createdAtMs <= 10 * 60 * 1000
  }, [data])
  const smartVideoPromptAction = isVideoNode
    ? {
        title: '智能生成当前视频提示词',
        onClick: () => {
          void handleSmartGenerateVideoPrompt()
        },
        loading: videoPromptGenerationLoading,
        disabled: viewOnly,
      }
    : null
  const controlChipsNode = !isPlainTextNode ? (
    <ControlChips
      summaryChipStyles={summaryChipStyles}
      controlValueStyle={controlValueStyle}
      summaryModelLabel={summaryModelLabel}
      summaryDuration={summaryDuration}
      summaryResolution={summaryResolution}
      summaryExec={summaryExec}
      showModelMenu={hasModelSelect && modelMenuOptions.length > 0}
      modelList={modelMenuOptions}
      onModelChange={handleToolbarModelChange}
      showTimeMenu={showTimeMenu}
      durationOptions={durationOptions}
      onDurationChange={handleToolbarDurationChange}
      showResolutionMenu={showResolutionMenu}
      resolutionTitle={isVideoNode ? '画幅' : '比例'}
      resolutionOptions={isVideoNode
        ? configuredSizeOptions
        : configuredImageAspectOptions.length
          ? configuredImageAspectOptions
          : undefined}
      onResolutionChange={handleToolbarSizeChange}
      showImageSizeMenu={showImageSizeMenu}
      imageSize={selectedConfiguredImageSizeOption?.label || imageSize}
      imageSizeOptions={configuredImageSizeOptions.length ? configuredImageSizeOptions : undefined}
      onImageSizeChange={(value) => {
        setImageSize(value)
        updateNodeData(id, { imageSize: value })
      }}
      showOrientationMenu={showOrientationMenu}
      orientation={orientation}
      orientationOptions={configuredOrientationOptions.length ? configuredOrientationOptions : undefined}
      onOrientationChange={handleToolbarOrientationChange}
      showSampleMenu={hasSampleCount}
      sampleOptions={SAMPLE_OPTIONS}
      sampleCount={sampleCount}
      onSampleChange={(value) => {
        setSampleCount(value)
        updateNodeData(id, { sampleCount: value })
      }}
      mappedControls={isVideoNode ? mappedVideoControls : mappedImageControls}
      isCharacterNode={isCharacterNode}
      isRunning={isRunning}
      smartAction={smartVideoPromptAction}
      onCancelRun={handleCancelRun}
      onRun={runNode}
    />
  ) : null
  const mediaFocusControlChipsNode = useMediaFocusToolbar && !isPlainTextNode ? (
    <ControlChips
      summaryChipStyles={summaryChipStyles}
      controlValueStyle={controlValueStyle}
      summaryModelLabel={summaryModelLabel}
      summaryDuration={summaryDuration}
      summaryResolution={summaryResolution}
      summaryExec={summaryExec}
      showModelMenu={hasModelSelect && modelMenuOptions.length > 0}
      modelList={modelMenuOptions}
      onModelChange={handleToolbarModelChange}
      showTimeMenu={false}
      showResolutionMenu={showResolutionMenu}
      resolutionTitle={isVideoNode ? '画幅' : '比例'}
      resolutionOptions={isVideoNode
        ? configuredSizeOptions
        : configuredImageAspectOptions.length
          ? configuredImageAspectOptions
          : undefined}
      onResolutionChange={handleToolbarSizeChange}
      showImageSizeMenu={showImageSizeMenu}
      imageSize={selectedConfiguredImageSizeOption?.label || imageSize}
      imageSizeOptions={configuredImageSizeOptions.length ? configuredImageSizeOptions : undefined}
      onImageSizeChange={(value) => {
        setImageSize(value)
        updateNodeData(id, { imageSize: value })
      }}
      showOrientationMenu={showOrientationMenu}
      orientation={orientation}
      orientationOptions={configuredOrientationOptions.length ? configuredOrientationOptions : undefined}
      onOrientationChange={handleToolbarOrientationChange}
      showSampleMenu={false}
      sampleOptions={SAMPLE_OPTIONS}
      sampleCount={sampleCount}
      onSampleChange={(value) => {
        setSampleCount(value)
        updateNodeData(id, { sampleCount: value })
      }}
      mappedControls={isVideoNode ? mappedVideoControls : mappedImageControls}
      isCharacterNode={isCharacterNode}
      isRunning={isRunning}
      smartAction={smartVideoPromptAction}
      onCancelRun={handleCancelRun}
      onRun={runNode}
    />
  ) : null
  const showVeoImageControls = Boolean(isVideoNode && resolvedVideoVendor === 'veo')
  const showMediaFocusSettings = Boolean(useMediaFocusToolbar)
  const mediaFocusSettingsTrigger = showMediaFocusSettings ? (
    <Popover
      opened={mediaFocusOptionsOpen}
      onChange={setMediaFocusOptionsOpen}
      position="bottom-start"
      offset={10}
      withArrow
      shadow="md"
      withinPortal
    >
      <Popover.Target>
        <ActionIcon
          className="tc-task-node__media-focus-settings-trigger"
          variant="subtle"
          size="sm"
          onClick={() => setMediaFocusOptionsOpen((current) => !current)}
          aria-label="打开媒体节点高级设置"
          title="更多设置"
        >
          <IconAdjustments size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown className="tc-task-node__media-focus-settings-dropdown">
        <Stack className="tc-task-node__media-focus-settings-stack" gap="sm">
          {showVeoImageControls && (
            <div className="tc-task-node__media-focus-settings-group">
              <Group className="tc-task-node__media-focus-settings-header" justify="space-between" gap={6}>
                <Text className="tc-task-node__media-focus-settings-label" size="xs" fw={700}>
                  Veo 图像控制
                </Text>
                <Badge className="tc-task-node__media-focus-settings-badge" size="xs" color="grape">
                  Veo3
                </Badge>
              </Group>
              <Group className="tc-task-node__media-focus-settings-actions" gap={6} wrap="wrap">
                <Button
                  className="tc-task-node__media-focus-settings-button"
                  size="compact-xs"
                  variant={trimmedFirstFrameUrl ? 'light' : 'subtle'}
                  onClick={() => openVeoModal('first')}
                >
                  {trimmedFirstFrameUrl ? '更换首帧' : '选择首帧'}
                </Button>
                <Button
                  className="tc-task-node__media-focus-settings-button"
                  size="compact-xs"
                  variant={trimmedLastFrameUrl ? 'light' : 'subtle'}
                  disabled={!firstFrameLocked}
                  onClick={() => openVeoModal('last')}
                >
                  {trimmedLastFrameUrl ? '更换尾帧' : '选择尾帧'}
                </Button>
                <Button
                  className="tc-task-node__media-focus-settings-button"
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => openVeoModal('reference')}
                >
                  管理参考图
                </Button>
              </Group>
              <Group className="tc-task-node__media-focus-settings-actions" gap={6} wrap="wrap">
                <Text className="tc-task-node__media-focus-settings-help" size="xs" c="dimmed">
                  参考图 {veoReferenceImages.length}/{MAX_VEO_REFERENCE_IMAGES}
                </Text>
                {trimmedFirstFrameUrl && (
                  <Button
                    className="tc-task-node__media-focus-settings-button"
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    onClick={() => handleSetFirstFrameUrl('')}
                  >
                    清除首帧
                  </Button>
                )}
                {trimmedLastFrameUrl && (
                  <Button
                    className="tc-task-node__media-focus-settings-button"
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    onClick={() => handleSetLastFrameUrl('')}
                  >
                    清除尾帧
                  </Button>
                )}
              </Group>
              {(trimmedFirstFrameUrl || trimmedLastFrameUrl) && (
                <div className="tc-task-node__media-focus-settings-preview-list">
                  {trimmedFirstFrameUrl && (
                    <Paper
                      className="tc-task-node__media-focus-settings-preview-card"
                      radius="md"
                      p="xs"
                      withBorder
                    >
                      <div className="tc-task-node__media-focus-settings-preview-thumb">
                        <img
                          className="tc-task-node__media-focus-settings-preview-image nodrag nopan"
                          src={trimmedFirstFrameUrl}
                          alt="首帧"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>
                      <Text className="tc-task-node__media-focus-settings-preview-label" size="xs" c="dimmed">
                        首帧
                      </Text>
                    </Paper>
                  )}
                  {trimmedLastFrameUrl && (
                    <Paper
                      className="tc-task-node__media-focus-settings-preview-card"
                      radius="md"
                      p="xs"
                      withBorder
                    >
                      <div className="tc-task-node__media-focus-settings-preview-thumb">
                        <img
                          className="tc-task-node__media-focus-settings-preview-image nodrag nopan"
                          src={trimmedLastFrameUrl}
                          alt="尾帧"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>
                      <Text className="tc-task-node__media-focus-settings-preview-label" size="xs" c="dimmed">
                        尾帧
                      </Text>
                    </Paper>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="tc-task-node__media-focus-settings-group">
            <Text className="tc-task-node__media-focus-settings-label" size="xs" fw={700}>
              预设能力
            </Text>
            <Select
              className="tc-task-node__media-focus-settings-select"
              size="xs"
              data={promptPresetOptions}
              value={selectedPresetId}
              onChange={handlePresetChange}
              placeholder={promptPresetOptions.length ? '选择预设能力' : '暂无预设能力'}
              searchable
              clearable
              disabled={viewOnly}
              nothingFoundMessage="没有匹配的预设"
            />
            {!viewOnly && (
              <Group className="tc-task-node__media-focus-settings-actions" gap={6}>
                <Button
                  className="tc-task-node__media-focus-settings-button"
                  size="compact-xs"
                  variant="light"
                  onClick={() => {
                    setMediaFocusOptionsOpen(false)
                    setPresetModalOpen(true)
                  }}
                >
                  新增预设
                </Button>
                <Button
                  className="tc-task-node__media-focus-settings-button"
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => {
                    setMediaFocusOptionsOpen(false)
                    setPromptSamplesOpen(true)
                  }}
                >
                  提示词示例
                </Button>
              </Group>
            )}
          </div>

          {hasAnchorBinding && (
            <div className="tc-task-node__media-focus-settings-group">
              <Text className="tc-task-node__media-focus-settings-label" size="xs" fw={700}>
                锚点绑定
              </Text>
              <Select
                className="tc-task-node__media-focus-settings-select"
                size="xs"
                data={[
                  { value: 'character', label: '角色' },
                  { value: 'scene', label: '场景' },
                  { value: 'prop', label: '道具' },
                  { value: 'shot', label: '镜头' },
                  { value: 'story', label: '剧情' },
                  { value: 'asset', label: '资产' },
                  { value: 'context', label: '上下文' },
                ]}
                value={anchorBindingKind}
                onChange={(value) => {
                  if (!value) return
                  setAnchorBindingKind(value as PublicFlowAnchorBindingKind)
                }}
                allowDeselect={false}
              />
              <TextInput
                className="tc-task-node__media-focus-settings-input"
                size="xs"
                value={anchorBindingLabel}
                onChange={(e) => setAnchorBindingLabel(e.currentTarget.value)}
                placeholder="例如：方源 / 青茅山宗祠 / 春秋蝉"
              />
              <Button
                className="tc-task-node__media-focus-settings-button"
                size="compact-xs"
                variant="light"
                color="grape"
                loading={bindAnchorLoading}
                disabled={bindAnchorLoading || !primaryImageForAnchorBinding}
                onClick={() => { void handleBindPrimaryAnchor() }}
              >
                绑定当前主图
              </Button>
              {!!anchorBindStatusText && (
                <Text className="tc-task-node__media-focus-settings-help" size="xs" c="dimmed">
                  {anchorBindStatusText}
                </Text>
              )}
            </div>
          )}

          {connectedCharacterOptions.length > 0 && (
            <div className="tc-task-node__media-focus-settings-group">
              <Text className="tc-task-node__media-focus-settings-label" size="xs" fw={700}>
                角色替换
              </Text>
              <Select
                className="tc-task-node__media-focus-settings-select"
                size="xs"
                withinPortal
                data={
                  rewriteModelSelectOptions.length
                    ? rewriteModelSelectOptions
                    : (characterRewriteModel
                        ? [{ value: characterRewriteModel, label: characterRewriteModel }]
                        : [])
                }
                value={characterRewriteModel}
                onChange={handleRewriteModelChange}
              />
              <Button
                className="tc-task-node__media-focus-settings-button"
                size="compact-xs"
                variant="light"
                loading={characterRewriteLoading}
                onClick={() => { void handleApplyCharacterMentions() }}
              >
                一键替换 @引用
              </Button>
              {characterRewriteError && (
                <Text className="tc-task-node__media-focus-settings-help" size="xs" c="red">
                  {characterRewriteError}
                </Text>
              )}
            </div>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  ) : null

  return (
    <div
      ref={nodeShellRef}
      className={[
        'tc-task-node',
        isWebAssetBoardItem ? 'tc-task-node--web-asset-board-item' : '',
        isWebAssetBoardDisplay || isWebSectionDraftBoardDisplay ? 'tc-task-node--web-asset-board-display' : '',
      ].filter(Boolean).join(' ')}
      onPointerDownCapture={blurActiveEditableElement}
      style={{
        border: shellBorder,
        borderRadius: isWebAssetBoardItem ? 12 : isWebAssetBoardDisplay || isWebSectionDraftBoardDisplay ? 28 : 22,
        padding: isWebAssetBoardDisplay || isWebSectionDraftBoardDisplay ? 0 : shellPadding,
        background: isWebAssetBoardItem || isWebAssetBoardDisplay || isWebSectionDraftBoardDisplay ? 'transparent' : isPlainTextNode ? textBackgroundTint : shellBackground,
        color: nodeShellText,
        boxShadow: shellShadowResolved,
        backdropFilter: shellBackdrop,
        transition: 'box-shadow 180ms ease',
        position: 'relative',
        outline: shellOutline,
        boxSizing: 'border-box',
        display: isPlainTextNode || isVideoNode || isWebHeroNode || isPptDeckNode ? 'flex' : undefined,
        flexDirection: isPlainTextNode || isVideoNode || isWebHeroNode || isPptDeckNode ? 'column' : undefined,
        minHeight: 0,
        width: nodeWidth,
        maxWidth: isWebAssetBoardDisplay || isWebSectionDraftBoardDisplay
          ? 1240
          : isResizableVisualNode
            ? visualNodeDefaults.maxWidth
            : isPlainTextNode
              ? TEXT_NODE_MAX_WIDTH
              : 720,
        ...(isPlainTextNode && textNodeHeight ? { height: textNodeHeight } : null),
        ...(isResizableVisualNode && nodeHeight ? { height: nodeHeight } : null),
      } as React.CSSProperties}
    >
      <GenerationOverlay
        visible={showGenerationOverlay}
        status={status}
        progress={(data as any)?.progress}
        progressLabel={(data as any)?.webHeroProgressLabel}
      />
      {!hideImageMeta && !isCanvasMediaNode && !isWebHeroNode && !isPptDeckNode && !isWebAssetBoardItem && (
        <TaskNodeHeader
          NodeIcon={NodeIcon}
          editing={editing}
          labelDraft={labelDraft}
          currentLabel={currentLabel}
          subtitle={subtitle}
          metaBadges={headerMetaBadges}
          statusLabel={statusLabel}
          statusColor={color}
          nodeShellText={nodeShellText}
          iconBadgeBackground={iconBadgeBackground}
          iconBadgeShadow={iconBadgeShadow}
          sleekChipBase={sleekChipBase}
          labelSingleLine={isImageNode}
          isNew={isFreshAiChatNode}
          isAiSessionRunning={isAiSessionRunning}
        showMeta={false}
        showIcon={false}
        showStatus={false}
          onLabelDraftChange={setLabelDraft}
          onCommitLabel={commitLabel}
          onCancelEdit={() => {
            setLabelDraft(currentLabel)
            setEditing(false)
          }}
          onStartEdit={() => setEditing(true)}
          labelInputRef={labelInputRef}
        />
      )}
      <TopToolbar
        isVisible={isSingleSelectionActive}
        hasContent={hasContent}
        toolbarBackground={toolbarBackground}
        toolbarShadow={toolbarShadow}
        toolbarActionIconStyles={toolbarActionIconStyles}
        inlineDividerColor={inlineDividerColor}
        visibleDefs={visibleDefs}
        extraActions={toolbarMetaActions}
        onPreview={handlePreview}
        onDownload={handleDownload}
      />
      {isPlainTextNode && isSingleSelectionActive && !isWebAssetBoardItem && !isWebHeroNode && !isPptDeckNode && (
        <NodeToolbar className="tc-task-node__text-inline-toolbar" position={Position.Top} align="center">
          <div
            className="tc-task-node__text-inline-toolbar-content"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderRadius: 999,
              background: toolbarBackground,
              boxShadow: toolbarShadow,
              backdropFilter: 'blur(18px)',
              maxWidth: 'min(95vw, 980px)',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
            }}
          >
            <Button
              className="tc-task-node__text-inline-edit"
              variant="subtle"
              size="compact-xs"
              disabled={viewOnly}
              onMouseDown={(event) => event.preventDefault()}
              onClick={textEditing ? commitTextEditing : startTextEditing}
            >
              {textEditing ? '完成' : '编辑 Markdown'}
            </Button>
            <div className="tc-task-node__text-inline-divider" style={{ width: 1, height: 20, background: inlineDividerColor }} />
            <Popover
              opened={textColorPickerOpen}
              onChange={setTextColorPickerOpen}
              position="bottom"
              withArrow
              withinPortal
              shadow="md"
            >
              <Popover.Target>
                <div>
                  <Tooltip label="文字颜色" position="bottom" withArrow>
                    <ActionIcon
                      className="tc-task-node__text-inline-action"
                      variant="transparent"
                      size="sm"
                      onClick={() => setTextColorPickerOpen((prev) => !prev)}
                    >
                      <IconPalette size={16} color={textColor} />
                    </ActionIcon>
                  </Tooltip>
                </div>
              </Popover.Target>
              <Popover.Dropdown>
                <Group className="tc-task-node__text-inline-palette" gap={4} wrap="nowrap">
                  {TEXT_COLOR_PRESETS.map((colorValue) => (
                    <ActionIcon
                      key={colorValue}
                      className="tc-task-node__text-inline-color"
                      size="sm"
                      variant="subtle"
                      onClick={() => {
                        updateNodeData(id, { textColor: colorValue })
                        setTextColorPickerOpen(false)
                      }}
                    >
                      <span className="tc-task-node__text-inline-color-dot" style={{ width: 12, height: 12, borderRadius: 999, background: colorValue }} />
                    </ActionIcon>
                  ))}
                </Group>
              </Popover.Dropdown>
            </Popover>
            <Popover
              opened={textBgPickerOpen}
              onChange={setTextBgPickerOpen}
              position="bottom"
              withArrow
              withinPortal
              shadow="md"
            >
              <Popover.Target>
                <div>
                  <Tooltip label="背景色" position="bottom" withArrow>
                    <ActionIcon
                      className="tc-task-node__text-inline-action"
                      variant="transparent"
                      size="sm"
                      onClick={() => setTextBgPickerOpen((prev) => !prev)}
                    >
                      <IconColorSwatch size={16} />
                    </ActionIcon>
                  </Tooltip>
                </div>
              </Popover.Target>
              <Popover.Dropdown>
                <Group className="tc-task-node__text-inline-palette" gap={4} wrap="nowrap">
                  {TEXT_BG_PRESETS.map((colorValue) => (
                    <ActionIcon
                      key={colorValue}
                      className="tc-task-node__text-inline-color"
                      size="sm"
                      variant="subtle"
                      onClick={() => {
                        updateNodeData(id, { textBackgroundColor: colorValue })
                        setTextBgPickerOpen(false)
                      }}
                    >
                      <span className="tc-task-node__text-inline-color-dot" style={{ width: 12, height: 12, borderRadius: 999, background: colorValue, border: '1px solid rgba(255,255,255,0.25)' }} />
                    </ActionIcon>
                  ))}
                </Group>
              </Popover.Dropdown>
            </Popover>
          </div>
        </NodeToolbar>
      )}
      <TaskNodeHandles
        targets={targets}
        sources={sources}
        layout={handleLayoutMap}
        defaultInputType={defaultInputType}
        defaultOutputType={defaultOutputType}
        wideHandleBase={wideHandleBase}
        showHandles
        showWideHandles
      />
      {isResizableVisualNode && isSingleSelectionActive && !variantsOpen && (
        <NodeResizeControl
          className="tc-task-node__media-resize nodrag"
          position="bottom-right"
          keepAspectRatio
          minWidth={visualNodeDefaults.minWidth}
          minHeight={visualNodeDefaults.minHeight}
          onResizeEnd={handleMediaResizeEnd}
        >
          <div className="tc-task-node__media-resize-handle" style={{ width: 10, height: 10, borderRight: '2px solid rgba(255,255,255,0.55)', borderBottom: '2px solid rgba(255,255,255,0.55)' }} />
        </NodeResizeControl>
      )}
      {isOrdinaryTextNode && isSingleSelectionActive && !viewOnly && !textEditing && !variantsOpen && (
        <NodeResizeControl
          className="tc-task-node__text-resize nodrag"
          position="bottom-right"
          title="拖拽调整文本节点大小"
          minWidth={TEXT_NODE_MIN_WIDTH}
          minHeight={TEXT_NODE_MIN_HEIGHT}
          maxWidth={TEXT_NODE_MAX_WIDTH}
          maxHeight={TEXT_NODE_MAX_HEIGHT}
          onResize={handleTextResize}
          onResizeEnd={handleTextResizeEnd}
        >
          <div className="tc-task-node__text-resize-handle" style={{ width: 10, height: 10, borderRight: '2px solid currentColor', borderBottom: '2px solid currentColor', opacity: 0.55 }} />
        </NodeResizeControl>
      )}
      {isWebAssetBoardDisplay ? (
        <WebAssetBoardContent payload={(data as any)?.webPageAssetBoardPayload} />
      ) : isWebSectionDraftBoardDisplay ? (
        <WebSectionDraftBoardContent payload={(data as any)?.webPageSectionDraftsPayload} />
      ) : isPlainTextNode && !isWebHeroNode && !isPptDeckNode && (
        <TextContent
          selected={isSingleSelectionActive}
          isEditing={textEditing}
          markdownText={textNodePlainText}
          draftText={textDraft}
          isWebAssetBoardItem={isWebAssetBoardItem}
          assetBoardAccentColor={String((data as any)?.assetBoardAccentColor || '')}
          assetBoardSectionLabel={String((data as any)?.assetBoardSectionLabel || '')}
          label={currentLabel}
          textBackgroundTint={textBackgroundTint}
          textColor={textColor}
          textFontSize={textFontSize}
          textFontWeight={textFontWeight as React.CSSProperties['fontWeight']}
          contentRef={textContentRef}
          onStartEditing={startTextEditing}
          onDraftChange={setTextDraft}
          onCommit={commitTextEditing}
          onCancel={cancelTextEditing}
        />
      )}
      {/* Content Area for Character/Image/Video/Text kinds */}
      {featureBlocks}
            {/* remove bottom kind text for all nodes */}
      {/* Removed bottom tag list; top-left label identifies node type */}
      {/* Bottom detail panel near node */}
      {showBottomToolbar && (
        <NodeToolbar className="tc-task-node__toolbar" position={Position.Bottom} align="center">
          <div
            className={[
              'tc-task-node__toolbar-frame',
              useMediaFocusToolbar ? 'tc-task-node__toolbar-frame--media' : '',
            ].filter(Boolean).join(' ')}
            style={{
              position: 'relative',
              zIndex: 3001,
              width: toolbarWidthCss,
              maxHeight: toolbarMaxHeightCss,
              overflowY: 'auto',
              overflowX: 'visible',
              transformOrigin: 'top center',
              transform: `scale(${toolbarScale})`,
            }}
          >
            <div
              className={[
                'tc-task-node__toolbar-content',
                useMediaFocusToolbar ? 'tc-task-node__toolbar-content--media' : '',
              ].filter(Boolean).join(' ')}
            >
              {!useMediaFocusToolbar && controlChipsNode ? (
                <div className="tc-task-node__toolbar-controls">
                  {controlChipsNode}
                </div>
              ) : null}

              <div className="tc-task-node__toolbar-body">

                {!useMediaFocusToolbar && (
                  <StatusBanner status={status} lastError={(data as any)?.lastError} httpStatus={(data as any)?.httpStatus} />
                )}

                {isVideoNode && upstreamImageUrl && !useMediaFocusToolbar && (
                  <div className="tc-task-node__composer-upstream">
                    <div
                      className="tc-task-node__composer-upstream-media"
                      style={{
                        position: 'relative',
                        width: '100%',
                        maxHeight: 180,
                        borderRadius: 8,
                        overflow: 'hidden',
                        marginBottom: 0,
                        border: 'none',
                        background: darkContentBackground,
                      }}
                    >
                      <img
                        className="tc-task-node__composer-upstream-image"
                        src={upstreamImageUrl}
                        alt="上游图片素材"
                        style={{
                          width: '100%',
                          height: 'auto',
                          maxHeight: 180,
                          objectFit: 'contain',
                          display: 'block',
                          backgroundColor: mediaFallbackSurface,
                        }}
                      />
                    </div>
                  </div>
                )}

                {connectedCharacterOptions.length > 0 && !useMediaFocusToolbar && (
                  <Paper className="tc-task-node__character-summary" radius="md" p="xs">
                    <Group className="tc-task-node__character-summary-actions" align="flex-end" gap="xs" wrap="wrap">
                      <Select
                        className="tc-task-node__character-summary-select"
                        label="替换模型"
                        size="xs"
                        withinPortal
                        data={
                          rewriteModelSelectOptions.length
                            ? rewriteModelSelectOptions
                            : (characterRewriteModel
                                ? [{ value: characterRewriteModel, label: characterRewriteModel }]
                                : [])
                        }
                        value={characterRewriteModel}
                        onChange={handleRewriteModelChange}
                        style={{ minWidth: 180 }}
                      />
                      <Button
                        className="tc-task-node__character-summary-action"
                        size="xs"
                        variant="light"
                        loading={characterRewriteLoading}
                        onClick={() => { void handleApplyCharacterMentions() }}
                      >
                        一键替换 @引用
                      </Button>
                    </Group>
                    {characterRewriteError && (
                      <Text className="tc-task-node__character-summary-error" size="xs" c="red" mt={4}>
                        {characterRewriteError}
                      </Text>
                    )}
                  </Paper>
                )}

                {showUpstreamReferenceStrip && (
                  <UpstreamReferenceStrip
                    targetNodeId={id}
                    items={upstreamReferenceItems}
                    onReorder={handleReorderUpstreamReference}
                    onRemove={handleRemoveUpstreamReference}
                    onToggleCanvasReferencePicker={handleToggleCanvasReferencePicker}
                    canvasReferencePickerActive={canvasReferencePickerActive}
                  />
                )}

                {canUseStructuredPromptEditor && !isPlainTextNode && (
                  <Group className="tc-task-node__prompt-mode-switch" justify="space-between" gap={8}>
                    <Text className="tc-task-node__prompt-mode-switch-label" size="xs" c="dimmed">
                      提示词编辑模式
                    </Text>
                    <Group className="tc-task-node__prompt-mode-switch-control" gap={8}>
                      {structuredPromptRefineLoading ? (
                        <Loader className="tc-task-node__prompt-mode-switch-loader" size="xs" />
                      ) : null}
                      <Switch
                        className="tc-task-node__prompt-mode-switch-input"
                        size="xs"
                        checked={isStructuredPromptMode}
                        disabled={viewOnly || structuredPromptRefineLoading}
                        label="JSON"
                        onChange={(event) => handleStructuredPromptModeChange(event.currentTarget.checked)}
                      />
                    </Group>
                  </Group>
                )}

                {isPlainTextNode ? null : isStructuredPromptMode ? (
                  <StructuredPromptSection
                    structuredValue={structuredPromptValue}
                    loading={structuredPromptRefineLoading}
                    externalError={structuredPromptErrorMessage}
                    onCommit={handleCommitStructuredPrompt}
                    onRefine={
                      viewOnly
                        ? undefined
                        : () => {
                            void handleEnableStructuredPromptMode()
                          }
                    }
                  />
                ) : (
                  <PromptSection
                    layout={useMediaFocusToolbar ? 'media-focus' : 'default'}
                    hideBrainButton={useMediaFocusToolbar || isVideoNode}
                    hidePresetSection={useMediaFocusToolbar}
                    hideAnchorBindingSection={useMediaFocusToolbar}
                    isCharacterNode={isCharacterNode}
                    isComposerNode={isComposerNode}
                    prompt={prompt}
                    setPrompt={setPrompt}
                    onUpdateNodeData={(patch) => updateNodeData(id, patch)}
                    placeholder={
                      isVideoNode
                        ? '描述这条视频要生成的画面、动作和情绪'
                        : undefined
                    }
                    minRows={isVideoNode ? 3 : 2}
                    maxRows={6}
                    suggestionsAllowed={suggestionsAllowed}
                    suggestionsEnabled={suggestionsEnabled}
                    setSuggestionsEnabled={setSuggestionsEnabled}
                    promptSuggestions={promptSuggestions}
                    activeSuggestion={activeSuggestion}
                    setActiveSuggestion={setActiveSuggestion}
                    setPromptSuggestions={setPromptSuggestions}
                    markPromptUsed={(value) => markDraftPromptUsed(value, 'sora').catch(() => {})}
                    mentionOpen={mentionOpen}
                    mentionItems={mentionItems}
                    mentionLoading={mentionLoading}
                    mentionFilter={mentionFilter}
                    setMentionFilter={setMentionFilter}
                    setMentionOpen={setMentionOpen}
                    mentionMetaRef={mentionMetaRef}
                    onMentionApplied={handleMentionApplied}
                    showAssetBinding={Boolean(primaryBindableAsset?.url)}
                    assetBindingId={assetBindingId}
                    setAssetBindingId={setAssetBindingId}
                    onBindPrimaryAssetReference={handleBindPrimaryAssetReference}
                    bindAssetDisabled={!primaryBindableAsset?.url}
                    bindAssetStatusText={assetBindStatusText}
                    showAnchorBinding={hasAnchorBinding}
                    anchorBindingKind={anchorBindingKind}
                    setAnchorBindingKind={(value) => {
                      if (!value) return
                      setAnchorBindingKind(value as PublicFlowAnchorBindingKind)
                    }}
                    anchorBindingLabel={anchorBindingLabel}
                    setAnchorBindingLabel={setAnchorBindingLabel}
                    onBindPrimaryAnchor={() => { void handleBindPrimaryAnchor() }}
                    bindAnchorLoading={bindAnchorLoading}
                    bindAnchorDisabled={bindAnchorLoading || !primaryImageForAnchorBinding}
                    bindAnchorStatusText={anchorBindStatusText}
                    isDarkUi={isDarkUi}
                    nodeShellText={nodeShellText}
                    onOpenPromptSamples={
                      useMediaFocusToolbar
                        ? undefined
                        : () => setPromptSamplesOpen(true)
                    }
                    presetOptions={promptPresetOptions}
                    presetValue={selectedPresetId}
                    presetDisabled={viewOnly}
                    onPresetChange={handlePresetChange}
                    onOpenCreatePresetModal={
                      !viewOnly
                        ? () => setPresetModalOpen(true)
                        : undefined
                    }
                  />
                )}

              </div>

              {useMediaFocusToolbar && (
                <div className="tc-task-node__toolbar-footer">
                  <StatusBanner status={status} lastError={(data as any)?.lastError} httpStatus={(data as any)?.httpStatus} />
                  {mediaFocusControlChipsNode || mediaFocusSettingsTrigger ? (
                    <div className="tc-task-node__toolbar-controls tc-task-node__toolbar-controls--footer tc-task-node__toolbar-controls--media-footer">
                      {mediaFocusSettingsTrigger ? (
                        <div className="tc-task-node__toolbar-settings">
                          {mediaFocusSettingsTrigger}
                        </div>
                      ) : null}
                      {mediaFocusControlChipsNode ? (
                        <div className="tc-task-node__toolbar-controls-main">
                          {mediaFocusControlChipsNode}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </NodeToolbar>
      )}
	      <PromptSampleDrawer
	        opened={promptSamplesOpen}
	        nodeKind={kind}
	        onClose={() => setPromptSamplesOpen(false)}
        onApplySample={handleApplyPromptSample}
      />
      <Modal
        className="task-node-preset-modal"
        opened={presetModalOpen}
        onClose={() => setPresetModalOpen(false)}
        title="新增预设能力"
        centered
        size="md"
      >
        <Stack className="task-node-preset-modal__stack" gap="sm">
          <Select
            className="task-node-preset-modal__type"
            label="类型"
            data={[
              { value: 'text', label: '文本' },
              { value: 'image', label: '图片' },
              { value: 'video', label: '视频' },
            ]}
            value={newPresetType}
            onChange={(value) => setNewPresetType((value as LlmNodePresetType) || 'text')}
            allowDeselect={false}
          />
          <TextInput
            className="task-node-preset-modal__title"
            label="预设名称"
            placeholder="例如：产品卖点增强"
            value={newPresetTitle}
            onChange={(e) => setNewPresetTitle(e.currentTarget.value)}
          />
          <Textarea
            className="task-node-preset-modal__prompt"
            label="提示词"
            placeholder="输入该预设的提示词模板"
            minRows={5}
            value={newPresetPrompt}
            onChange={(e) => setNewPresetPrompt(e.currentTarget.value)}
          />
          <Group className="task-node-preset-modal__actions" justify="flex-end" gap="xs">
            <Button
              className="task-node-preset-modal__cancel"
              variant="subtle"
              onClick={() => setPresetModalOpen(false)}
            >
              取消
            </Button>
            <Button
              className="task-node-preset-modal__save"
              onClick={() => { void handleCreateNodePreset() }}
              loading={presetSaving}
            >
              保存预设
            </Button>
          </Group>
          {presetLoading && (
            <Text className="task-node-preset-modal__loading" size="xs" c="dimmed">
              正在同步预设列表...
            </Text>
          )}
        </Stack>
      </Modal>

      {veoImageModalMode && (
        <VeoImageModal
          opened
          mode={veoImageModalMode}
          statusColor={color}
          firstFrameLocked={firstFrameLocked}
          trimmedFirstFrameUrl={trimmedFirstFrameUrl}
          trimmedLastFrameUrl={trimmedLastFrameUrl}
          veoReferenceImages={veoReferenceImages}
          veoReferenceLimitReached={veoReferenceLimitReached}
          veoCustomImageInput={veoCustomImageInput}
          veoCandidateImages={veoCandidateImages}
          mediaFallbackSurface={mediaFallbackSurface}
          inlineDividerColor={inlineDividerColor}
          onClose={closeVeoModal}
          onCustomImageInputChange={setVeoCustomImageInput}
          onAddCustomReferenceImage={handleAddCustomReferenceImage}
          onRemoveReferenceImage={handleRemoveReferenceImage}
          onSetFirstFrameUrl={handleSetFirstFrameUrl}
          onSetLastFrameUrl={handleSetLastFrameUrl}
          onToggleReference={handleReferenceToggle}
        />
      )}

      {poseEditorModal}
      {imageViewEditorModal}

      {isVideoNode && videoExpanded && (
        <VideoResultModal
          opened={videoExpanded}
          onClose={() => setVideoExpanded(false)}
          videos={videoResults}
          primaryIndex={videoPrimaryIndex}
          adoptedIndex={adoptedVideoIndex}
          onSelectPrimary={handleSetPrimaryVideo}
          onAdopt={handleAdoptVideo}
          onPreview={(video) => {
            const openPreview = useUIStore.getState().openPreview
            openPreview({
              url: video.url,
              kind: 'video',
              name: video.title || data?.label || 'Video',
            })
          }}
          galleryCardBackground={galleryCardBackground}
          mediaFallbackSurface={mediaFallbackSurface}
          mediaFallbackText={mediaFallbackText}
        />
      )}

      {/* More panel rendered directly under the top toolbar with 4px gap */}
    </div>
  )
}

const areTaskNodePropsEqual = (prev: NodeProps<TaskNodeType>, next: NodeProps<TaskNodeType>) => {
  if (prev.id !== next.id) return false
  if (prev.selected !== next.selected) return false
  if (prev.dragging !== next.dragging) return false
  if (prev.data !== next.data) return false
  if (prev.width !== next.width) return false
  if (prev.height !== next.height) return false
  if (prev.isConnectable !== next.isConnectable) return false
  if (prev.parentId !== next.parentId) return false
  return true
}

export default React.memo(TaskNodeInner, areTaskNodePropsEqual)
