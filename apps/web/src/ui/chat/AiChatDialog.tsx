import React from 'react'
import { ActionIcon, Badge, Button, Collapse, Group, Loader, Menu, Modal, Paper, ScrollArea, Stack, Text, Textarea, Tooltip, UnstyledButton } from '@mantine/core'
import { IconArrowsMaximize, IconArrowsMinimize, IconBook2, IconChevronDown, IconChevronRight, IconChevronUp, IconDownload, IconMessageCircle, IconMessagePlus, IconPaperclip, IconPhoto, IconSend2, IconTrash, IconUpload, IconVideo, IconX } from '@tabler/icons-react'
import { $ } from '../../canvas/i18n'
import { useIsAdmin } from '../../auth/isAdmin'
import {
  API_BASE,
  abortAgentsChatRun,
  agentsChatRunEventsStream,
  agentsChatStream,
  getServerFlow,
  getMemoryContext,
  listActiveAgentsChatRuns,
  listProjectMaterials,
  listRuntimeAgentSkills,
  type AgentsChatRequestDto,
  type AgentsChatRunSummaryDto,
  type AgentsChatStreamEvent,
  type AgentsChatMediaResultStreamPayload,
  type AgentsChatToolStreamPayload,
  uploadServerAssetFile,
  type MemoryConversationItemDto,
  type AgentsChatResponseDto,
} from '../../api/server'
import { toast } from '../toast'
import { resolveNonOverlappingPosition, useRFStore } from '../../canvas/store'
import { isImageKind } from '../../canvas/utils/edgeRules'
import type { Node } from '@xyflow/react'
import { useUIStore } from '../uiStore'
import {
  PENDING_TOOL_CALL_TURN_ID,
  readLiveChatRunBySessionKey,
  useLiveChatRunStore,
  type LiveChatRunRecord,
} from './liveChatRunStore'
import { AgentTraceTimeline } from './AgentTraceTimeline'
import { ChatMarkdownContent } from './ChatMarkdownContent'
import type { ChatTodoItem } from './chatTodoTypes'
import { TodoProgressCard } from './TodoProgressCard'
import { formatAgentsStreamErrorMessage } from './agentsStreamError'
import { executeCanvasPlan, parseCanvasPlanFromReply } from './canvasPlan'
import { CanvasService } from '../../ai/canvasService'
import { autoRunAiChatCanvasNodes, autoRunAiChatPatchedCanvasNodes } from './autoRunCanvasNodes'
import {
  applyTraceCanvasDeletions,
  createGeneratedAssetToolReloadQueue,
  resolveAiChatReloadAutoRunPlan,
  resolveCanvasServerReloadLayoutMode,
  responseTraceIndicatesCanvasWrite,
  type CanvasServerReloadLayoutMode,
} from './canvasMutation'
import {
  scheduleCanvasMediaResultStreamSync,
  scheduleCanvasToolStreamSync,
} from './canvasStreamSync'
import { resolveChatCanvasInsertionScope } from './canvasInsertion'
import {
  resolveChatSessionLane,
  resolveEffectiveChatSessionKey,
  type ChatSessionLane,
} from './chatSessionKey'
import {
  buildRequiredSkillsForChat,
  buildSelectedImageAssetInputs,
	buildStyleReferenceTranscriptAsset,
  resolveChatRequestExecution,
  selectChatRuntimeSkillsForMenu,
  type ChatAssetInput,
  type ChatAssetInputRole,
} from './chatRequestPayload'
import {
  buildMediaCompletionContinuationRequest,
  type MediaCompletionContinuationRequest,
} from './mediaContinuation'
import {
  formatChatTurnVerdictSummary,
  formatTurnVerdictSummary,
  isFailedChatTurn,
  readChatTurnVerdict,
  shouldAutoAddAssistantAssetsToCanvas,
  shouldShowMissingCanvasPlanError,
} from './replyDisposition'
import {
  freezeChatMessageAgentTraceSnapshot,
  freezeChatMessageToolCallSnapshot,
  mergeLoadedHistoryWithLocalMessages,
  normalizeLoadedChatMessageUiSnapshot,
} from './chatMessageState'
import AiChatTabBar from './AiChatTabBar'
import {
  NativeArtifactCard,
  NATIVE_ARTIFACT_CHAT_COMMAND,
  type NativeArtifactChatCommand,
} from './NativeArtifactCard'
import {
  addAiChatTab,
  bindAiChatTabSession,
  closeAiChatTab,
  createAiChatSessionBaseKey,
  readAiChatTabsState,
  selectAiChatTab,
  updateAiChatTabTitle,
  writeAiChatTabsState,
  type AiChatTabsState,
} from './chatTabs'
import {
  NATIVE_CHAT_NAVIGATION_COMMAND,
  notifyNativeChatNavigationChanged,
  type NativeChatNavigationCommand,
} from '../../product-host/nativeChatNavigation'
import {
  buildAttachedDocsPromptBlock,
  classifyUploadedFile,
  formatDocSize,
  parseAttachedDoc,
  type AttachedDoc,
} from './attachedDocs'
import {
  parseAskUserPromptFromToolEvent,
  parseAskUserPromptFromHistory,
  recoverPendingAskUserStateFromMessages,
  type ChatAskUserPrompt,
  type PendingAskUserState,
} from './askUserPrompt'
import {
  clearActiveChatRunPointer,
  hasAppliedChatRunResult,
  markChatRunResultApplied,
  readActiveChatRunPointer,
  resolveRecoverableChatRun,
  writeActiveChatRunPointer,
} from './chatRunRecovery'
import { AskUserPendingCard } from './AskUserPendingCard'
import { buildMergedMessageGroups } from './mergeAskUserGroups'
import { SubagentProgressStrip } from './SubagentProgressStrip'
import {
  createEmptyChatTabRuntime,
  useAiChatRuntimeStore,
  type ChatMessage,
  type ChatRole,
  type ChatSelectableSkill,
  type ChatTabRuntimeState,
  type UploadedReferenceAssetMeta,
} from './chatRuntimeStore'
import { PanelCard } from '../PanelCard'
import {
  getNodeProductionMeta,
  type ApprovalStatus,
  type CreationStage,
  type ProductionLayer,
} from '../../canvas/productionMeta'
import {
  normalizePublicFlowAnchorBindings,
  type PublicFlowAnchorBinding,
} from '@jarvishub/flow-anchor-bindings'
import {
  resolvePrimarySemanticAnchorBinding,
  resolveSemanticNodeAnchorBindings,
  resolveSemanticNodeRoleBinding,
} from '../../canvas/utils/semanticBindings'

export type { ChatMessage } from './chatRuntimeStore'

const CHAT_STREAM_ABORT_ERROR = '__canvas_ai_chat_aborted__'
const CHAT_STREAM_DETACHED_ERROR = '__canvas_ai_chat_detached__'
const CHAT_ABORTED_MESSAGE = '已中断本次对话。'
const AUTO_SCROLL_BOTTOM_THRESHOLD_MIN_PX = 72
const AUTO_SCROLL_BOTTOM_THRESHOLD_MAX_PX = 160
const AUTO_SCROLL_BOTTOM_THRESHOLD_RATIO = 0.18

type SendOptions = {
  text?: string
  displayText?: string
  skill?: ChatSelectableSkill | null
  attachCanvasContext?: boolean
  styleReferenceCard?: {
    value: string
    imageUrl: string
    thumbnailUrl?: string
    title?: string
  }
}

type ProjectTextMaterialState = {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  count: number
  error: string
}

type AgentSkillsErrorState =
  | { kind: 'all' }
  | { kind: 'partial'; count: number }
  | null

function buildSkillDirectedPrompt(input: {
  prompt: string
  skill: ChatSelectableSkill | null
}): string {
  const prompt = String(input.prompt || '').trim()
  const skillKey = String(input.skill?.key || '').trim()
  if (!prompt || !skillKey) return prompt
  return [
    `请先调用 Skill 工具加载技能 "${skillKey}"，然后完成以下任务：`,
    '',
    prompt,
  ].join('\n')
}

function formatSkillMention(skill: ChatSelectableSkill | null): string {
  const key = String(skill?.key || '').trim()
  if (key) return `@${key}`
  const name = String(skill?.name || '').trim()
  return name ? `@${name}` : ''
}

const AI_CHAT_LAYOUT_PREFERENCE_STORAGE_KEY = 'canvas.aiChat.layoutPreference.v1'
const AI_CHAT_MODE_TRANSITION_MS = 220

type AiChatPreferenceMode = 'compact' | 'expanded'

const PANEL_WIDTH_DEFAULT = 480
const PANEL_WIDTH_MIN = 360
const PANEL_WIDTH_HARD_MAX = 1100
const PANEL_WIDTH_VIEWPORT_RESERVE = 200
const PANEL_RESERVED_GUTTER_PX = 24

type AiChatLayoutPreference = {
  dockRight: boolean
  mode: AiChatPreferenceMode
  expandedWidthPx: number
}

const DEFAULT_AI_CHAT_LAYOUT_PREFERENCE: AiChatLayoutPreference = {
  dockRight: true,
  mode: 'compact',
  expandedWidthPx: PANEL_WIDTH_DEFAULT,
}

// kept for future docked-bubble layout
const AI_CHAT_LAYOUT_RESERVED_WIDTH_COMPACT = '96px'
const AI_CHAT_LAYOUT_RESERVED_WIDTH_NONE = '0px'
const AI_CHAT_FLOATING_Z_INDEX = 10050

function clampPanelWidth(px: number): number {
  const rounded = Math.round(Number.isFinite(px) ? px : PANEL_WIDTH_DEFAULT)
  if (typeof window === 'undefined') {
    return Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_HARD_MAX, rounded))
  }
  const viewportMax = Math.max(PANEL_WIDTH_MIN, window.innerWidth - PANEL_WIDTH_VIEWPORT_RESERVE)
  const cap = Math.min(PANEL_WIDTH_HARD_MAX, viewportMax)
  return Math.max(PANEL_WIDTH_MIN, Math.min(cap, rounded))
}

function reservedWidthForExpanded(px: number): string {
  return `${px + PANEL_RESERVED_GUTTER_PX}px`
}

type ChatTooltipProps = React.ComponentPropsWithoutRef<typeof Tooltip>

const ChatTooltip = React.forwardRef<HTMLDivElement, ChatTooltipProps>(function ChatTooltip(
  { className, zIndex, ...props },
  ref,
): JSX.Element {
  return (
    <Tooltip
      ref={ref}
      {...props}
      className={['tc-ai-chat__tooltip', className].filter(Boolean).join(' ')}
      zIndex={zIndex ?? AI_CHAT_FLOATING_Z_INDEX}
    />
  )
})

function normalizeAiChatPreferenceMode(value: unknown): AiChatPreferenceMode {
  return value === 'expanded' ? 'expanded' : 'compact'
}

function readAiChatLayoutPreference(): AiChatLayoutPreference {
  if (typeof window === 'undefined') return DEFAULT_AI_CHAT_LAYOUT_PREFERENCE
  try {
    const raw = window.localStorage.getItem(AI_CHAT_LAYOUT_PREFERENCE_STORAGE_KEY) || ''
    if (!raw.trim()) return DEFAULT_AI_CHAT_LAYOUT_PREFERENCE
    const parsed = JSON.parse(raw) as Partial<AiChatLayoutPreference>
    const widthCandidate = typeof parsed.expandedWidthPx === 'number' && Number.isFinite(parsed.expandedWidthPx)
      ? parsed.expandedWidthPx
      : DEFAULT_AI_CHAT_LAYOUT_PREFERENCE.expandedWidthPx
    return {
      dockRight: typeof parsed.dockRight === 'boolean' ? parsed.dockRight : DEFAULT_AI_CHAT_LAYOUT_PREFERENCE.dockRight,
      mode: normalizeAiChatPreferenceMode(parsed.mode),
      expandedWidthPx: clampPanelWidth(widthCandidate),
    }
  } catch {
    return DEFAULT_AI_CHAT_LAYOUT_PREFERENCE
  }
}

function writeAiChatLayoutPreference(next: AiChatLayoutPreference) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AI_CHAT_LAYOUT_PREFERENCE_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

function resolveInitialBubbleVisualState(preference: AiChatLayoutPreference): 'bubble' | 'panel' {
  return preference.mode === 'compact' ? 'bubble' : 'panel'
}

function formatNowTime(): string {
  try {
    const d = new Date()
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  } catch {
    return ''
  }
}

function formatMessageTime(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return formatNowTime()
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return formatNowTime()
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function formatTraceExportTimestamp(date: Date): string {
  const yyyy = String(date.getFullYear()).padStart(4, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`
}

function sanitizeTraceExportNamePart(value: string, fallback: string): string {
  const normalized = String(value || '').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return normalized || fallback
}

function downloadTraceExportJson(filename: string, payload: unknown): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json;charset=utf-8' })
  const objectUrl = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 0)
}

function buildChatTraceMessageExport(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages
    .filter((message) => message.role === 'assistant' || message.role === 'user')
    .map((message) => ({
      id: message.id,
      role: message.role,
      ts: message.ts,
      phase: message.phase ?? null,
      kind: message.kind ?? null,
      content: message.content,
      skillMention: message.skillMention ?? null,
      assets: Array.isArray(message.assets) ? message.assets : [],
      askUserPrompt: message.askUserPrompt ?? null,
      todoSnapshot: Array.isArray(message.todoSnapshot) ? message.todoSnapshot : [],
      diagnosticFlags: Array.isArray(message.diagnosticFlags) ? message.diagnosticFlags : [],
      turnVerdict: message.turnVerdict ?? null,
      traceItemCount: message.agentTraceSnapshot?.items?.length ?? 0,
      toolTurnCount: message.toolCallSnapshot?.turnIds?.length ?? 0,
      agentTraceSnapshot: message.agentTraceSnapshot ?? null,
      toolCallSnapshot: message.toolCallSnapshot ?? null,
    }))
}

function isLocalDebugTraceHost(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const host = String(window.location?.hostname || '').toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0'
  } catch {
    return false
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeComparableKind(value: unknown): string {
  return readTrimmedString(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function inferSelectedImageAssetRole(node: Node): ChatAssetInputRole {
  const data = asRecord(node.data)
  const source = readTrimmedString(data?.source)
  const primaryAnchor = resolvePrimarySemanticAnchorBinding(data)
  const semanticRoleBinding = resolveSemanticNodeRoleBinding(data)
  const roleCardId = readTrimmedString(data?.roleCardId) || String(semanticRoleBinding.roleCardId || '').trim()
  const roleName = readTrimmedString(data?.roleName) || String(semanticRoleBinding.roleName || '').trim()
  if (primaryAnchor?.kind === 'scene') return 'scene'
  if (primaryAnchor?.kind === 'prop') return 'prop'
  if (primaryAnchor?.kind && primaryAnchor.kind !== 'character') return 'context'
  if (
    roleCardId ||
    (roleName && (source === 'role_card_library' || source === 'asset_confirm'))
  ) {
    return 'character'
  }
  const productionMeta = getNodeProductionMeta(node)
  if (productionMeta.productionLayer === 'anchors') {
    return 'context'
  }
  return 'reference'
}

function buildSelectedImageAssetNote(node: Node, role: ChatAssetInputRole): string {
  const data = asRecord(node.data)
  const source = readTrimmedString(data?.source)
  if (role === 'character') {
    if (source === 'asset_confirm') return '已确认角色卡锚点'
    if (source === 'role_card_library') return '角色卡库锚点'
    return '角色锚点'
  }
  if (role === 'scene') return '场景锚点'
  if (role === 'prop') return '道具锚点'
  if (role === 'context') return '场景/镜头锚点'
  return ''
}

function buildSelectedImageAssetCandidate(node: Node, url: string): {
  assetId?: string
  assetRefId?: string
  url: string
  role: ChatAssetInputRole
  note?: string
  name?: string
} {
  const data = asRecord(node.data)
  const primaryResult = readCurrentCanvasNodeImageResult(node)
  const assetId = readTrimmedString(primaryResult?.assetId || data?.assetId)
  const assetRefId = readTrimmedString(primaryResult?.assetRefId || data?.assetRefId)
  const role = inferSelectedImageAssetRole(node)
  const note = buildSelectedImageAssetNote(node, role)
  const primaryAnchor = resolvePrimarySemanticAnchorBinding(data)
  const roleName = readTrimmedString(primaryAnchor?.label || data?.roleName || primaryResult?.assetName || primaryResult?.assetRefId)
  return {
    ...(assetId ? { assetId } : {}),
    ...(assetRefId ? { assetRefId } : {}),
    url,
    role,
    ...(note ? { note } : {}),
    ...(role === 'character' && roleName ? { name: roleName } : {}),
  }
}

type CanvasNodeImageResult = {
  url: string | null
  title: string | null
  assetId: string | null
  assetRefId: string | null
  assetName: string | null
  prompt: string | null
  shotNo: number | null
}

function readCanvasNodeImageResults(node: Node | undefined): CanvasNodeImageResult[] {
  const data = node ? asRecord(node.data) : null
  if (!data) return []
  const rawResults = Array.isArray(data.imageResults) ? data.imageResults : []
  return rawResults
    .map((item): CanvasNodeImageResult | null => {
      const record = asRecord(item)
      if (!record) return null
      const url = typeof record.url === 'string' && record.url.trim() ? record.url.trim() : null
      if (!url) return null
      const shotNoRaw = typeof record.shotNo === 'number' ? record.shotNo : Number(record.shotNo)
      return {
        url,
        title: typeof record.title === 'string' && record.title.trim() ? record.title.trim() : null,
        assetId: typeof record.assetId === 'string' && record.assetId.trim() ? record.assetId.trim() : null,
        assetRefId: typeof record.assetRefId === 'string' && record.assetRefId.trim() ? record.assetRefId.trim() : null,
        assetName:
          typeof record.assetName === 'string' && record.assetName.trim()
            ? record.assetName.trim()
            : typeof record.title === 'string' && record.title.trim()
              ? record.title.trim()
              : null,
        prompt: typeof record.prompt === 'string' && record.prompt.trim() ? record.prompt.trim() : null,
        shotNo:
          Number.isFinite(shotNoRaw) && shotNoRaw > 0
            ? Math.trunc(shotNoRaw)
            : null,
      }
    })
    .filter((item): item is CanvasNodeImageResult => Boolean(item))
}

function readCurrentCanvasNodeImageResult(node: Node | undefined): CanvasNodeImageResult | null {
  if (!node) return null
  const data = asRecord(node.data)
  if (!data) return null
  const imageResults = readCanvasNodeImageResults(node)
  if (!imageResults.length) return null
  const primaryIndexRaw = typeof data.imagePrimaryIndex === 'number' ? data.imagePrimaryIndex : Number(data.imagePrimaryIndex)
  const primaryIndex =
    Number.isFinite(primaryIndexRaw) && primaryIndexRaw >= 0 && primaryIndexRaw < imageResults.length
      ? Math.trunc(primaryIndexRaw)
      : 0
  return imageResults[primaryIndex] || imageResults[0] || null
}

function readImageUrlFromCanvasNode(node: Node | undefined): string {
  if (!node) return ''
  const data = asRecord(node.data)
  if (!data) return ''

  const directImageUrl = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''
  if (directImageUrl) return directImageUrl

  const imageResults = Array.isArray(data.imageResults) ? data.imageResults : []
  const primaryIndexRaw = typeof data.imagePrimaryIndex === 'number' ? data.imagePrimaryIndex : Number(data.imagePrimaryIndex)
  const primaryIndex =
    Number.isFinite(primaryIndexRaw) && primaryIndexRaw >= 0 && primaryIndexRaw < imageResults.length
      ? Math.trunc(primaryIndexRaw)
      : 0
  const primaryItem = asRecord(imageResults[primaryIndex])
  if (primaryItem && typeof primaryItem.url === 'string' && primaryItem.url.trim()) {
    return primaryItem.url.trim()
  }
  const fallbackItem = imageResults
    .map((item) => asRecord(item))
    .find((item) => item && typeof item.url === 'string' && item.url.trim())
  return fallbackItem && typeof fallbackItem.url === 'string' ? fallbackItem.url.trim() : ''
}

function pickPrimaryCreationNodeId(nodeIds: string[]): string {
  const nodes = useRFStore.getState().nodes
  const rankByKind = (kind: string): number => {
    if (kind === 'video') return 4
    if (kind === 'image') return 2
    if (kind === 'text') return 1
    return 0
  }
  const created = nodeIds
    .map((id) => nodes.find((node) => String(node.id || '').trim() === String(id || '').trim()))
    .filter(Boolean)
  const primaryWithImage = created.find((node) => Boolean(readImageUrlFromCanvasNode(node)))
  if (primaryWithImage?.id) return String(primaryWithImage.id)
  const primary = created
    .slice()
    .sort((left, right) => {
      const leftKind = String(((left as { data?: { kind?: unknown } }).data?.kind) || '').trim()
      const rightKind = String(((right as { data?: { kind?: unknown } }).data?.kind) || '').trim()
      return rankByKind(rightKind) - rankByKind(leftKind)
    })[0]
  return primary?.id ? String(primary.id) : ''
}

function buildSceneCreationSummary(reply: string, nextIndex: number): string {
  const normalized = String(reply || '').trim()
  if (!normalized) return `第 ${nextIndex} 个场景已生成。`
  const firstLine = normalized
    .split('\n')
    .map((line) => line.trim())
    .find((line) => {
      if (!line) return false
      if (/^plan_only[:：]/i.test(line)) return false
      if (/^以下为规划/i.test(line)) return false
      if (/^不代表已执行/i.test(line)) return false
      return true
    }) || ''
  return firstLine ? `第 ${nextIndex} 个场景已生成：${firstLine}` : `第 ${nextIndex} 个场景已生成。`
}

function pickPrimaryImageUrlFromNode(node: Node): string {
  const data = asRecord(node.data)
  if (!data) return ''
  const imageUrl = readTrimmedString(data.imageUrl)
  if (imageUrl) return imageUrl
  const results = Array.isArray(data.imageResults) ? data.imageResults : []
  const idx =
    typeof data.imagePrimaryIndex === 'number' && data.imagePrimaryIndex >= 0 && data.imagePrimaryIndex < results.length
      ? data.imagePrimaryIndex
      : 0
  const selectedResult = asRecord(results[idx])
  const fromResults = readTrimmedString(selectedResult?.url)
  return fromResults || ''
}

type CanvasNodeVideoResult = {
  url: string | null
  thumbnailUrl: string | null
  title: string | null
}

function readCanvasNodeVideoResults(node: Node | undefined): CanvasNodeVideoResult[] {
  const data = node ? asRecord(node.data) : null
  if (!data) return []
  const rawResults = Array.isArray(data.videoResults) ? data.videoResults : []
  return rawResults
    .map((item): CanvasNodeVideoResult | null => {
      const record = asRecord(item)
      if (!record) return null
      const url = readTrimmedString(record.url)
      if (!url) return null
      return {
        url,
        thumbnailUrl: readTrimmedString(record.thumbnailUrl) || null,
        title: readTrimmedString(record.title) || null,
      }
    })
    .filter((item): item is CanvasNodeVideoResult => Boolean(item))
}

function readCurrentCanvasNodeVideoResult(node: Node | undefined): CanvasNodeVideoResult | null {
  if (!node) return null
  const data = asRecord(node.data)
  if (!data) return null
  const videoResults = readCanvasNodeVideoResults(node)
  if (!videoResults.length) return null
  const currentIndexRaw = typeof data.videoPrimaryIndex === 'number' ? data.videoPrimaryIndex : Number(data.videoPrimaryIndex)
  const currentIndex =
    Number.isFinite(currentIndexRaw) && currentIndexRaw >= 0 && currentIndexRaw < videoResults.length
      ? Math.trunc(currentIndexRaw)
      : 0
  return videoResults[currentIndex] || videoResults[0] || null
}

function pickDisplayVideoUrlFromNode(node: Node): string {
  const data = asRecord(node.data)
  if (!data) return ''
  const fromResult = readCurrentCanvasNodeVideoResult(node)?.url || ''
  if (fromResult) return fromResult
  return readTrimmedString(data.videoUrl)
}

function pickDisplayVideoThumbnailUrlFromNode(node: Node): string {
  const data = asRecord(node.data)
  if (!data) return ''
  return (
    readCurrentCanvasNodeVideoResult(node)?.thumbnailUrl
    || readTrimmedString(data.videoThumbnailUrl)
    || readTrimmedString(data.thumbnailUrl)
    || ''
  )
}

function readCanvasNodeLabel(node: Node, fallback: string): string {
  const data = asRecord(node.data)
  const label = readTrimmedString(data?.label)
  return label || fallback
}

function isVideoMediaNodeKind(value: unknown): boolean {
  const kind = normalizeComparableKind(value)
  return kind === 'video' || kind === 'composevideo'
}

function toAbsoluteApiUrl(rawUrl: string): string | null {
  const trimmed = String(rawUrl || '').trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/')) {
    const base = String(API_BASE || '').trim().replace(/\/+$/, '')
    if (base) return `${base}${trimmed}`
    try {
      const origin = typeof window !== 'undefined' ? String(window.location?.origin || '').trim() : ''
      if (origin) return `${origin}${trimmed}`
    } catch {
      // ignore
    }
  }
  return null
}

function isPlaceholderAssetUrl(rawUrl: string): boolean {
  const value = String(rawUrl || '').trim()
  if (!value) return true
  if (!/^https?:\/\//i.test(value)) return true
  try {
    const u = new URL(value)
    const host = String(u.hostname || '').toLowerCase()
    return (
      host === 'example.com' ||
      host === 'www.example.com' ||
      host === 'example.org' ||
      host === 'www.example.org' ||
      host === 'example.net' ||
      host === 'www.example.net' ||
      host === 'localhost' ||
      host === '127.0.0.1'
    )
  } catch {
    return true
  }
}

const blobReferenceImageResolutionCache = new Map<string, string>()
const blobReferenceImageResolutionInflight = new Map<string, Promise<string | null>>()

async function resolveReferenceImageUrl(rawUrl: string): Promise<string | null> {
  const trimmed = String(rawUrl || '').trim()
  if (!trimmed) return null

  const abs = toAbsoluteApiUrl(trimmed)
  if (abs) return abs

  if (trimmed.startsWith('blob:')) {
    const cached = blobReferenceImageResolutionCache.get(trimmed)
    if (cached) return cached

    const inflight = blobReferenceImageResolutionInflight.get(trimmed)
    if (inflight) return inflight

    const resolvePromise = (async (): Promise<string | null> => {
    try {
      const res = await fetch(trimmed)
      if (!res.ok) return null
      const blob = await res.blob()
      const mime = blob.type || 'image/png'
      const ext =
        mime.includes('jpeg') || mime.includes('jpg')
          ? 'jpg'
          : mime.includes('webp')
            ? 'webp'
            : 'png'
      const stableBlobId = `${blob.size}-${mime.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'image'}`
      const fileName = `selection-${stableBlobId}.${ext}`
      const file = new File([blob], fileName, { type: mime, lastModified: 0 })
      const hosted = await uploadServerAssetFile(file, fileName, { taskKind: 'image_edit' })
      const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
      const resolved = hostedUrl ? toAbsoluteApiUrl(hostedUrl) : null
      if (resolved) {
        blobReferenceImageResolutionCache.set(trimmed, resolved)
      }
      return resolved
    } catch {
      return null
    } finally {
      blobReferenceImageResolutionInflight.delete(trimmed)
    }
    })()

    blobReferenceImageResolutionInflight.set(trimmed, resolvePromise)
    return resolvePromise
  }

  return null
}

type CanvasAutoGeneratedImage = { title: string; url: string }
type AssistantAsset = {
  title: string
  url: string
  thumbnailUrl?: string
  mediaType: 'image' | 'video'
  assetId?: string
  assetRefId?: string
  nodeId?: string
}
type ChatReferenceMediaKind = 'image' | 'video'
type ChatReferenceMedia = {
  key: string
  kind: ChatReferenceMediaKind
  url: string
  label: string
  nodeId?: string
  thumbnailUrl?: string
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getScrollDistanceToBottom(element: HTMLDivElement): number {
  return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight)
}

function getAutoScrollBottomThreshold(element: HTMLDivElement): number {
  return clampNumber(
    Math.round(element.clientHeight * AUTO_SCROLL_BOTTOM_THRESHOLD_RATIO),
    AUTO_SCROLL_BOTTOM_THRESHOLD_MIN_PX,
    AUTO_SCROLL_BOTTOM_THRESHOLD_MAX_PX,
  )
}

function isViewportNearBottom(element: HTMLDivElement): boolean {
  return getScrollDistanceToBottom(element) <= getAutoScrollBottomThreshold(element)
}

function extractCanvasAutoGeneratedImages(replyText: string): CanvasAutoGeneratedImage[] {
  const raw = String(replyText || '')
  const startTag = '<canvas_auto_json>'
  const endTag = '</canvas_auto_json>'
  const start = raw.indexOf(startTag)
  const end = raw.indexOf(endTag)
  if (start < 0 || end < 0 || end <= start) return []
  const jsonText = raw.slice(start + startTag.length, end).trim()
  if (!jsonText) return []
  try {
    const parsed: unknown = JSON.parse(jsonText)
    const items =
      parsed && typeof parsed === 'object' && Array.isArray((parsed as { generatedImages?: unknown }).generatedImages)
        ? (parsed as { generatedImages: Array<{ title?: unknown; url?: unknown }> }).generatedImages
        : []
    const out: CanvasAutoGeneratedImage[] = []
    const seen = new Set<string>()
    for (const item of items) {
      const urlRaw = typeof item?.url === 'string' ? item.url.trim() : ''
      const url = urlRaw ? (toAbsoluteApiUrl(urlRaw) || urlRaw) : ''
      if (!url || !/^https?:\/\//i.test(url) || isPlaceholderAssetUrl(url) || seen.has(url)) continue
      seen.add(url)
      const title = typeof item?.title === 'string' ? item.title.trim() : ''
      out.push({ title, url })
      if (out.length >= 12) break
    }
    return out
  } catch {
    return []
  }
}

function mergeAssistantAssets(
  base: AssistantAsset[],
  extraImages: CanvasAutoGeneratedImage[],
): AssistantAsset[] {
  const out: AssistantAsset[] = []
  const seen = new Set<string>()

  for (const asset of Array.isArray(base) ? base : []) {
    const url = String(asset?.url || '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(asset)
  }

  for (const image of Array.isArray(extraImages) ? extraImages : []) {
    const url = String(image?.url || '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({
      title: String(image?.title || '').trim() || `生成图-${out.length + 1}`,
      url,
      mediaType: 'image',
    })
  }

  return out.slice(0, 12)
}

function addAutoGeneratedImagesToCanvas(images: CanvasAutoGeneratedImage[]) {
  if (!images.length) return
  const store = useRFStore.getState()
  if (images.length === 1) {
    const imageSize = { w: 420, h: 280 }
    const insertion = resolveChatCanvasInsertionScope(imageSize)
    images.forEach((img, idx) => {
      const liveNodes = useRFStore.getState().nodes
      const position = resolveNonOverlappingPosition(
        liveNodes,
        {
          x: insertion.anchor.x,
          y: insertion.anchor.y + idx * 240,
        },
        imageSize,
        null,
      )
      store.addNode('taskNode', img.title || `生成图-${idx + 1}`, {
        kind: 'image',
        imageUrl: img.url,
        status: 'success',
        position,
        autoLabel: false,
      })
    })
  } else {
    const genId = (): string => {
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID()
        }
      } catch {
        // ignore
      }
      return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    }
    useRFStore.setState((s) => {
      const usedIds = new Set((s.nodes || []).map((n) => String(n.id || '').trim()).filter(Boolean))
      let groupNo = Math.max(1, Number(s.nextGroupId || 1))
      let groupId = `g${groupNo}`
      while (usedIds.has(groupId)) {
        groupNo += 1
        groupId = `g${groupNo}`
      }

      const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(images.length))))
      const cardW = 180
      const cardH = 140
      const gapX = 12
      const gapY = 12
      const padding = 16
      const rows = Math.ceil(images.length / cols)
      const groupW = Math.max(560, padding * 2 + cols * cardW + Math.max(0, cols - 1) * gapX)
      const groupH = Math.max(220, padding * 2 + rows * cardH + Math.max(0, rows - 1) * gapY)
      const insertion = resolveChatCanvasInsertionScope({ w: groupW, h: groupH })

      const children: Node[] = images.map((img, idx) => {
        const col = idx % cols
        const row = Math.floor(idx / cols)
        const label = String(img.title || '').trim() || `生成图-${idx + 1}`
        return {
          id: genId(),
          type: 'taskNode',
          parentId: groupId,
          position: {
            x: padding + col * (cardW + gapX),
            y: padding + row * (cardH + gapY),
          },
          data: {
            label,
            kind: 'image',
            imageUrl: img.url,
            status: 'success',
            nodeWidth: cardW,
            nodeHeight: cardH,
          },
          selected: false,
        } as Node
      })
      const groupNode: Node = {
        id: groupId,
        type: 'groupNode',
        position: insertion.anchor,
        data: {
          label: `AI多图-${images.length}张`,
          isGroup: true,
          groupKind: 'ai_chat_multi_images',
        },
        style: {
          width: groupW,
          height: groupH,
        },
        selected: true,
      } as Node

      const nextNodes = [
        ...s.nodes.map((n) => ({ ...n, selected: false })),
        groupNode,
        ...children,
      ]
      return {
        nodes: nextNodes,
        edges: s.edges.map((e) => ({ ...e, selected: false })),
        nextGroupId: groupNo + 1,
      }
    })
  }

  try {
    const nextStore = useRFStore.getState()
    const byUrl = new Set(images.map((img) => String(img.url || '').trim()).filter(Boolean))
    const matchedIds = nextStore.nodes
      .filter((node) => {
        const data = (node?.data || {}) as Record<string, unknown>
        const url = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''
        return isImageKind(String(data.kind || '')) && !!url && byUrl.has(url)
      })
      .map((node) => node.id)

    if (matchedIds.length >= 1) {
      const idSet = new Set(matchedIds)
      const parentGroup = nextStore.nodes.find((node) => {
        if (node?.type !== 'groupNode') return false
        const groupId = String(node?.id || '').trim()
        if (!groupId) return false
        const children = nextStore.nodes.filter((n) => String(n?.parentId || '').trim() === groupId)
        if (!children.length) return false
        return children.every((n) => idSet.has(String(n?.id || '').trim()))
      })
      const finalSelection = parentGroup?.id ? new Set([String(parentGroup.id)]) : idSet
      useRFStore.setState((s) => ({
        nodes: s.nodes.map((n) => ({ ...n, selected: finalSelection.has(n.id) })),
        edges: s.edges.map((e) => ({ ...e, selected: false })),
      }))
    }
  } catch {
    // ignore selection errors
  }
}

function addAssistantAssetsToCanvasAsImages(
  assets: AssistantAsset[],
) {
  const images = assets
    .filter((asset) => asset.mediaType === 'image')
    .map((asset) => ({ title: asset.title, url: asset.url }))
  if (!images.length) return
  addAutoGeneratedImagesToCanvas(images)
}

function countAssistantAssetsByMediaType(assets: AssistantAsset[]): { imageCount: number; videoCount: number } {
  let imageCount = 0
  let videoCount = 0
  for (const asset of Array.isArray(assets) ? assets : []) {
    if (asset.mediaType === 'image') imageCount += 1
    if (asset.mediaType === 'video') videoCount += 1
  }
  return { imageCount, videoCount }
}

function addAssistantAssetsToCanvas(assets: AssistantAsset[]): { imageCount: number; videoCount: number } {
  const { imageCount, videoCount } = countAssistantAssetsByMediaType(assets)
  if (imageCount > 0) addAssistantAssetsToCanvasAsImages(assets)
  if (videoCount > 0) addAssistantVideoAssetsToCanvas(assets)
  return { imageCount, videoCount }
}

function addAssistantVideoAssetsToCanvas(
  assets: AssistantAsset[],
) {
  const videos = assets.filter((asset) => asset.mediaType === 'video')
  if (!videos.length) return

  const store = useRFStore.getState()
  const videoSize = { w: 460, h: 260 }
  const insertion = resolveChatCanvasInsertionScope({
    w: videoSize.w,
    h: Math.max(videoSize.h, videos.length * 280),
  })

  videos.forEach((asset, idx) => {
    const url = String(asset.url || '').trim()
    if (!url) return
    const thumbnailUrl = String(asset.thumbnailUrl || '').trim()
    const liveNodes = useRFStore.getState().nodes
    const position = resolveNonOverlappingPosition(
      liveNodes,
      {
        x: insertion.anchor.x,
        y: insertion.anchor.y + idx * 280,
      },
      videoSize,
      null,
    )
    store.addNode('taskNode', asset.title || `视频-${idx + 1}`, {
      kind: 'video',
      videoUrl: url,
      videoResults: [{
        url,
        ...(thumbnailUrl ? { thumbnailUrl } : null),
        title: asset.title || `视频-${idx + 1}`,
      }],
      videoPrimaryIndex: 0,
      status: 'success',
      position,
      autoLabel: false,
    })
  })
}

function normalizeAssistantAssets(input: unknown): AssistantAsset[] {
  const items = Array.isArray(input) ? input : []
  const out: AssistantAsset[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const rawUrl = typeof record.url === 'string' ? record.url.trim() : ''
    const absUrl = rawUrl ? (toAbsoluteApiUrl(rawUrl) || rawUrl) : ''
    if (!absUrl || !/^https?:\/\//i.test(absUrl) || isPlaceholderAssetUrl(absUrl) || seen.has(absUrl)) continue
    seen.add(absUrl)

    const rawThumb = typeof record.thumbnailUrl === 'string' ? record.thumbnailUrl.trim() : ''
    const absThumb = rawThumb ? (toAbsoluteApiUrl(rawThumb) || rawThumb) : ''
    const rawType = typeof record.type === 'string' ? record.type.trim().toLowerCase() : ''
    const mediaType: 'image' | 'video' =
      rawType.includes('video') || /\.(mp4|mov|webm|mkv)(\?|$)/i.test(absUrl)
        ? 'video'
        : 'image'
    const title =
      typeof record.title === 'string' && record.title.trim()
        ? record.title.trim()
        : `${mediaType === 'video' ? '生成视频' : '生成图'}-${out.length + 1}`

    const assetId = typeof record.assetId === 'string' ? record.assetId.trim() : ''
    const assetRefId = typeof record.assetRefId === 'string' ? record.assetRefId.trim() : ''
    const nodeId = typeof record.nodeId === 'string' ? record.nodeId.trim() : ''
    out.push({
      title,
      url: absUrl,
      mediaType,
      ...(absThumb ? { thumbnailUrl: absThumb } : null),
      ...(assetId ? { assetId } : null),
      ...(assetRefId ? { assetRefId } : null),
      ...(nodeId ? { nodeId } : null),
    })
    if (out.length >= 12) break
  }
  return out
}

function normalizeChatRole(input: string): ChatRole | null {
  if (input === 'user' || input === 'assistant') return input
  return null
}

type UserAttachedAsset = {
  title: string
  url: string
  thumbnailUrl?: string
  mediaType?: 'image' | 'video'
}

function buildUserAttachedAssets(
  referenceMedia: readonly ChatReferenceMedia[],
  selectedAssetInputs: readonly ChatAssetInput[],
): UserAttachedAsset[] {
  const out: UserAttachedAsset[] = []
  const seen = new Set<string>()

  for (const item of referenceMedia) {
    const url = String(item.url || '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    const thumb = String(item.thumbnailUrl || '').trim()
    const title = String(item.label || '').trim() || `参考-${out.length + 1}`
    out.push({
      title,
      url,
      ...(thumb ? { thumbnailUrl: thumb } : null),
      mediaType: item.kind,
    })
  }

  for (const input of selectedAssetInputs) {
    const url = String(input.url || '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    const title = String(input.name || input.note || '').trim() || `参考-${out.length + 1}`
    out.push({ title, url, mediaType: 'image' })
  }

  return out
}

export function mapMemoryConversationItemToChatMessage(item: MemoryConversationItemDto, _index: number): ChatMessage | null {
  const role = normalizeChatRole(String(item.role || '').trim())
  const id = String(item.id || '').trim()
  if (!id) return null
  const askUserPrompt = role === 'assistant'
    ? parseAskUserPromptFromHistory(item.askUserPrompt)
    : null
  const uiSnapshot = role === 'assistant'
    ? normalizeLoadedChatMessageUiSnapshot(item.uiSnapshot)
    : {}
  const assets = role === 'assistant' || role === 'user'
    ? normalizeAssistantAssets(item.assets)
    : []
  const skillMention = role === 'user'
    ? String(item.skillMention || '').trim()
    : ''
  const content = String(item.content || '').trim()
  const hasAssistantState =
    role === 'assistant' &&
    (
      assets.length > 0 ||
      Boolean(askUserPrompt) ||
      Object.keys(uiSnapshot).length > 0
    )
  if (!role || (!content && !hasAssistantState)) return null
  const createdAt = String(item.createdAt || '').trim()
  return {
    id,
    role,
    content,
    ts: formatMessageTime(createdAt),
    phase: 'final',
    kind: 'result',
    ...(role === 'assistant'
      ? {
          assets,
          ...(askUserPrompt ? { askUserPrompt } : null),
          ...uiSnapshot,
        }
      : assets.length > 0
        ? {
            assets,
            ...(skillMention ? { skillMention } : null),
          }
        : skillMention
          ? { skillMention }
          : null),
  }
}

function extractRecoveredUserAssets(request: unknown): UserAttachedAsset[] {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return []
  const record = request as Record<string, unknown>

  const referenceMedia: ChatReferenceMedia[] = []
  const rawSelected = record.selectedMediaReferences
  if (Array.isArray(rawSelected)) {
    for (const raw of rawSelected) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const r = raw as Record<string, unknown>
      const url = typeof r.url === 'string' ? r.url.trim() : ''
      if (!url) continue
      const kind: ChatReferenceMediaKind = r.kind === 'video' ? 'video' : 'image'
      const thumbnailUrl = typeof r.thumbnailUrl === 'string' ? r.thumbnailUrl.trim() : ''
      const label = typeof r.label === 'string' ? r.label.trim() : ''
      const nodeId = typeof r.nodeId === 'string' ? r.nodeId.trim() : ''
      referenceMedia.push({
        key: `${kind}:${url}`,
        kind,
        url,
        label,
        ...(nodeId ? { nodeId } : {}),
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
      })
    }
  }

  const selectedAssetInputs: ChatAssetInput[] = []
  const rawInputs = record.assetInputs
  if (Array.isArray(rawInputs)) {
    for (const raw of rawInputs) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const r = raw as Record<string, unknown>
      const url = typeof r.url === 'string' ? r.url.trim() : ''
      if (!url) continue
      const name = typeof r.name === 'string' ? r.name.trim() : ''
      const note = typeof r.note === 'string' ? r.note.trim() : ''
      selectedAssetInputs.push({
        url,
        ...(name ? { name } : {}),
        ...(note ? { note } : {}),
      })
    }
  }

  return buildUserAttachedAssets(referenceMedia, selectedAssetInputs)
}


function patchChatMessageById(
  messages: ChatMessage[],
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  let changed = false
  const next = messages.map((message) => {
    if (message.id !== messageId) return message
    changed = true
    return updater(message)
  })
  return changed ? next : messages
}

function isChatAbortError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof DOMException) return error.name === 'AbortError'
  if (error instanceof Error) {
    return (
      error.message === CHAT_STREAM_ABORT_ERROR ||
      error.name === 'AbortError'
    )
  }
  return false
}

function isChatDetachError(error: unknown): boolean {
  return error instanceof Error && error.message === CHAT_STREAM_DETACHED_ERROR
}

function readAiChatErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return fallback
}

function normalizeChatTodoItems(
  value: unknown,
): ChatTodoItem[] {
  if (!Array.isArray(value)) return []
  const items: ChatTodoItem[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const content = String(record.text || record.content || '').trim()
    if (!content) continue
    const statusRaw = String(record.status || '').trim()
    const status: ChatTodoItem['status'] =
      statusRaw === 'completed' ||
      statusRaw === 'in_progress' ||
      statusRaw === 'waiting' ||
      statusRaw === 'blocked' ||
      statusRaw === 'pending'
        ? statusRaw
        : record.completed === true
          ? 'completed'
          : 'pending'
    items.push({ status, content })
    if (items.length >= 20) break
  }
  return items
}

function finalizeChatMessageToolState(
  message: ChatMessage,
  sessionKey?: string,
  options?: {
    finalizeUnresolved?: {
      status: 'failed'
      message: string
      finishedAtMs?: number
    }
  },
): Pick<ChatMessage, 'toolCallSnapshot' | 'toolCallTurnIds' | 'agentTraceSnapshot'> {
  const run = sessionKey ? readLiveChatRunBySessionKey(sessionKey) : null
  const finalizeUnresolved = options?.finalizeUnresolved
    ? {
        status: options.finalizeUnresolved.status,
        message: options.finalizeUnresolved.message,
        finishedAtMs: options.finalizeUnresolved.finishedAtMs ?? Date.now(),
      }
    : undefined
  const snapshot = freezeChatMessageToolCallSnapshot({
    record: run,
    turnIds: message.toolCallTurnIds,
    finalizeUnresolved,
  })
  const agentTraceSnapshot = freezeChatMessageAgentTraceSnapshot(
    run?.agentTraceItems,
    message.toolCallTurnIds ?? [],
  )
  if (!snapshot) {
    return {
      toolCallSnapshot: undefined,
      toolCallTurnIds: undefined,
      agentTraceSnapshot: agentTraceSnapshot ?? undefined,
    }
  }
  return {
    toolCallSnapshot: snapshot,
    toolCallTurnIds: snapshot.turnIds,
    agentTraceSnapshot: agentTraceSnapshot ?? undefined,
  }
}

export function refreshChatMessageToolStateFromLiveRun(
  message: ChatMessage,
  sessionKey?: string,
): Pick<ChatMessage, 'toolCallSnapshot' | 'toolCallTurnIds' | 'agentTraceSnapshot'> {
  return finalizeChatMessageToolState(message, sessionKey)
}

function extractLatestTodoBlock(content: string): { markdownText: string; todoItems: ChatTodoItem[] } {
  const raw = String(content || '')
  if (!raw.trim()) return { markdownText: '', todoItems: [] }

  const marker = '\nTodo\n'
  const normalized = raw.startsWith('Todo\n') ? `\n${raw}` : raw
  const startIndex = normalized.lastIndexOf(marker)
  if (startIndex < 0) return { markdownText: raw.trim(), todoItems: [] }

  const todoText = normalized.slice(startIndex + 1).trim()
  const todoLines = todoText.split('\n')
  if (todoLines[0] !== 'Todo') return { markdownText: raw.trim(), todoItems: [] }

  const todoItems: ChatTodoItem[] = []
  for (const line of todoLines.slice(1)) {
    const trimmed = line.trim()
    if (!trimmed || /^\(\d+\/\d+\s+done\)$/i.test(trimmed) || /^note:/i.test(trimmed)) continue
    const match = trimmed.match(/^\[( |>|~|!|x)\]\s+(.+)$/i)
    if (!match) continue
    const marker = match[1]
    todoItems.push({
      status:
        marker === 'x'
          ? 'completed'
          : marker === '>'
            ? 'in_progress'
            : marker === '~'
              ? 'waiting'
              : marker === '!'
                ? 'blocked'
                : 'pending',
      content: match[2]!.trim(),
    })
  }

  if (!todoItems.length) return { markdownText: raw.trim(), todoItems: [] }

  const markdownText = normalized.slice(0, startIndex).trim()
  return { markdownText, todoItems }
}

type ReloadCanvasFlowResult = {
  reloaded: boolean
  newNodeIds: string[]
}

function focusCanvasNodeAfterReload(nodeIds: string[]): void {
  const targetNodeId = pickPrimaryCreationNodeId(nodeIds)
  if (!targetNodeId || typeof window === 'undefined') return

  const focus = () => {
    const focusNode = (window as Window & { __tcFocusNode?: (id: string) => void }).__tcFocusNode
    focusNode?.(targetNodeId)
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(focus)
  })
}

async function reloadCanvasFlowFromServer(input: {
  flowId: string
  expectedProjectId?: string
  expectedFlowId?: string
  layout?: CanvasServerReloadLayoutMode
  preserveViewport?: boolean
}): Promise<ReloadCanvasFlowResult> {
  const flowId = String(input.flowId || '').trim()
  if (!flowId) {
    return { reloaded: false, newNodeIds: [] }
  }

  const uiState = useUIStore.getState()
  const liveProjectId = String(uiState.currentProject?.id || '').trim()
  const liveFlowId = String(uiState.currentFlow?.id || '').trim()
  const expectedProjectId = String(input.expectedProjectId || '').trim()
  const expectedFlowId = String(input.expectedFlowId || '').trim()

  if (expectedProjectId && liveProjectId && liveProjectId !== expectedProjectId) {
    return { reloaded: false, newNodeIds: [] }
  }
  if (expectedFlowId && liveFlowId && liveFlowId !== expectedFlowId) {
    console.warn('[ai-chat] reloadCanvasFlowFromServer skipped: user switched flow during agent turn', { expectedFlowId, liveFlowId })
    return { reloaded: false, newNodeIds: [] }
  }

  const localNodeIds = new Set(
    useRFStore.getState().nodes
      .map((node) => String(node.id || '').trim())
      .filter(Boolean),
  )
  const flow = await getServerFlow(flowId)
  const flowData = flow?.data || { nodes: [], edges: [] }
  const nextNodes = Array.isArray(flowData.nodes) ? flowData.nodes : []
  const newNodeIds = nextNodes
    .map((node) => String(node?.id || '').trim())
    .filter((nodeId) => Boolean(nodeId) && !localNodeIds.has(nodeId))
  useRFStore.getState().load({
    nodes: nextNodes,
    edges: Array.isArray(flowData.edges) ? flowData.edges : [],
  }, {
    layout: resolveCanvasServerReloadLayoutMode({ layout: input.layout }),
    history: 'preserve',
  })
  // preserveViewport: AI 写画布的增量同步,保留当前 viewport(避免 fitView 跳视角)。
  // 但 currentFlow 元信息(尤其 updatedAt)必须始终与服务端对齐——否则后续 silentSave
  // 用本地 baseUpdatedAt 提交会被服务端乐观锁拒绝(flow.service.ts:285),形成死锁。
  if (!input.preserveViewport) {
    useUIStore.getState().setPendingInitialView(
      flowData.viewport && typeof flowData.viewport.zoom === 'number'
        ? { kind: 'viewport', value: flowData.viewport }
        : { kind: 'fit' },
    )
  }
  useUIStore.getState().setCurrentFlow({ id: flow.id, name: flow.name, source: 'server', updatedAt: flow.updatedAt })
  useUIStore.getState().setDirty(false)
  return { reloaded: true, newNodeIds }
}

function scheduleAiChatCanvasToolStreamSync(input: {
  payload: AgentsChatToolStreamPayload
  expectedFlowId?: string | null
  expectedProjectId?: string | null
  queue: ReturnType<typeof createGeneratedAssetToolReloadQueue> | null
  contextLabel: string
}) {
  return scheduleCanvasToolStreamSync({
    payload: input.payload,
    expectedFlowId: input.expectedFlowId,
    expectedProjectId: input.expectedProjectId,
    queue: input.queue,
    reloadCanvasFlow: (reloadInput) => reloadCanvasFlowFromServer({
      flowId: reloadInput.flowId,
      expectedProjectId: reloadInput.expectedProjectId || undefined,
      expectedFlowId: reloadInput.expectedFlowId || undefined,
      preserveViewport: reloadInput.preserveViewport,
    }),
    reflowLayout: (reflowInput) => CanvasService.reflowLayout(reflowInput),
    groupExistingNodes: (groupInput) => {
      const store = useRFStore.getState()
      return store.createGroupForNodeIds(groupInput.nodeIds, groupInput.label)
    },
    saveProject: (window as Window & { silentSaveProject?: () => Promise<void> }).silentSaveProject ?? null,
    onWarning: (message, detail) => {
      console.warn(message, detail)
    },
    contextLabel: input.contextLabel,
  })
}

function scheduleAiChatCanvasMediaResultStreamSync(input: {
  payload: AgentsChatMediaResultStreamPayload
  expectedFlowId?: string | null
  expectedProjectId?: string | null
  queue: ReturnType<typeof createGeneratedAssetToolReloadQueue> | null
  contextLabel: string
}) {
  return scheduleCanvasMediaResultStreamSync({
    payload: input.payload,
    expectedFlowId: input.expectedFlowId,
    expectedProjectId: input.expectedProjectId,
    queue: input.queue,
    reloadCanvasFlow: (reloadInput) => reloadCanvasFlowFromServer({
      flowId: reloadInput.flowId,
      expectedProjectId: reloadInput.expectedProjectId || undefined,
      expectedFlowId: reloadInput.expectedFlowId || undefined,
      preserveViewport: reloadInput.preserveViewport,
    }),
    getNodeData: (nodeId) => {
      const node = useRFStore.getState().nodes.find((item) => item.id === nodeId)
      return node?.data && typeof node.data === 'object' && !Array.isArray(node.data)
        ? node.data as Record<string, unknown>
        : null
    },
    applyMediaResultToNode: (update) => {
      useRFStore.getState().setNodeStatus(update.nodeId, update.status, update.patch)
    },
    onWarning: (message, detail) => {
      console.warn(message, detail)
    },
    contextLabel: input.contextLabel,
  })
}

const MEDIA_GENERATION_TOOL_NAMES = new Set([
  'canvas_image_generate_to_canvas',
  'canvas_video_generate_to_canvas',
])

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readToolMediaOutput(payload: AgentsChatToolStreamPayload): Record<string, unknown> | null {
  const outputJson = readRecord(payload.outputJson)
  const data = readRecord(outputJson?.data)
  return data ?? outputJson
}

function uniqueNonEmptyNodeIds(nodeIds: readonly string[]): string[] {
  return Array.from(new Set(
    nodeIds
      .map((nodeId) => String(nodeId || '').trim())
      .filter(Boolean),
  ))
}

function appendCanvasMutationCreatedNodeIds(target: string[], payload: AgentsChatToolStreamPayload): void {
  const createdNodeIds = Array.isArray(payload.canvasMutation?.createdNodeIds)
    ? payload.canvasMutation.createdNodeIds
    : []
  target.push(...createdNodeIds)
}

function readPendingMediaKeyFromToolEvent(payload: AgentsChatToolStreamPayload): string | null {
  if (!MEDIA_GENERATION_TOOL_NAMES.has(String(payload.toolName || '').trim())) return null
  const output = readToolMediaOutput(payload)
  if (!output || output.pending !== true) return null
  return (
    String(payload.toolCallId || '').trim() ||
    String(output.taskId || '').trim() ||
    String(output.nodeId || '').trim() ||
    null
  )
}

function applyPendingMediaStreamEvent(
  pendingMediaKeys: Set<string>,
  event: AgentsChatStreamEvent,
): void {
  if (event.event === 'tool') {
    const key = readPendingMediaKeyFromToolEvent(event.data)
    if (key) pendingMediaKeys.add(key)
    return
  }
  if (event.event !== 'media_result') return
  const key =
    String(event.data.toolCallId || '').trim() ||
    String(event.data.taskId || '').trim() ||
    String(event.data.nodeId || '').trim()
  if (!key) return
  if (event.data.pending === true) {
    pendingMediaKeys.add(key)
    return
  }
  pendingMediaKeys.delete(key)
}

type FocusedNodeResourceContext = {
  nodeId: string
  label: string
  kind: string | null
  imageCandidates: string[]
}

type SelectedCanvasNodeContext = {
  nodeId: string
  label: string
  kind: string | null
  anchorBindings: PublicFlowAnchorBinding[]
  roleName: string | null
  roleCardId: string | null
  textPreview: string | null
  imageUrl: string | null
  sourceUrl: string | null
  shotNo: number | null
  productionLayer: ProductionLayer | null
  creationStage: CreationStage | null
  approvalStatus: ApprovalStatus | null
  hasInlinePromptText: boolean
  hasUpstreamTextEvidence: boolean
  hasDownstreamComposeVideo: boolean
}

type AgentsChatSelectedReferencePayload = NonNullable<NonNullable<AgentsChatRequestDto['chatContext']>['selectedReference']>
type AgentsChatSelectedReferenceAnchorBinding =
  NonNullable<AgentsChatSelectedReferencePayload['anchorBindings']>[number]

function normalizeSelectedReferenceAnchorBindings(
  bindings: readonly PublicFlowAnchorBinding[],
): AgentsChatSelectedReferencePayload['anchorBindings'] {
  const normalizedBindings = normalizePublicFlowAnchorBindings(bindings)
  if (!normalizedBindings.length) return undefined
  return normalizedBindings.map((binding): AgentsChatSelectedReferenceAnchorBinding => ({
    kind: binding.kind,
    ...(readTrimmedString(binding.refId) ? { refId: readTrimmedString(binding.refId) } : {}),
    ...(readTrimmedString(binding.entityId) ? { entityId: readTrimmedString(binding.entityId) } : {}),
    ...(readTrimmedString(binding.label) ? { label: readTrimmedString(binding.label) } : {}),
    ...(readTrimmedString(binding.sourceBookId) ? { sourceBookId: readTrimmedString(binding.sourceBookId) } : {}),
    ...(readTrimmedString(binding.sourceNodeId) ? { sourceNodeId: readTrimmedString(binding.sourceNodeId) } : {}),
    ...(readTrimmedString(binding.assetId) ? { assetId: readTrimmedString(binding.assetId) } : {}),
    ...(readTrimmedString(binding.assetRefId) ? { assetRefId: readTrimmedString(binding.assetRefId) } : {}),
    ...(readTrimmedString(binding.imageUrl) ? { imageUrl: readTrimmedString(binding.imageUrl) } : {}),
    ...(binding.referenceView ? { referenceView: binding.referenceView } : {}),
    ...(readTrimmedString(binding.category) ? { category: readTrimmedString(binding.category) } : {}),
    ...(readTrimmedString(binding.note) ? { note: readTrimmedString(binding.note) } : {}),
  }))
}

type ImplicitChatRequest = {
  prompt: string
  displayText: string
}

const SELECTED_NODE_TEXT_PREVIEW_MAX_CHARS = 1200

function clipChatPreview(value: string, maxChars: number): string {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  if (normalized.length <= maxChars) return normalized
  if (maxChars <= 1) return normalized.slice(0, maxChars)
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`
}

function readTrimmedNodeStringField(node: Node, field: string): string | null {
  const data = node.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const value = (data as Record<string, unknown>)[field]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readFiniteNodeNumberField(node: Node, field: string): number | null {
  const data = node.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const value = (data as Record<string, unknown>)[field]
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.trunc(numeric)
}

function readLatestNodeTextResult(node: Node): string | null {
  const data = asRecord(node.data)
  if (!data) return null
  const textResults = Array.isArray(data.textResults) ? data.textResults : []
  const latest = textResults.length > 0 ? asRecord(textResults[textResults.length - 1]) : null
  if (!latest) return null
  const text = typeof latest.text === 'string' ? latest.text.trim() : ''
  return text || null
}

function extractSelectedNodeTextPreview(node: Node): string | null {
  const data = asRecord(node.data)
  if (!data) return null
  const kind = typeof data.kind === 'string' ? data.kind.trim().toLowerCase() : ''
  const lastResult = asRecord(data.lastResult)
  const currentImageResult = readCurrentCanvasNodeImageResult(node)
  const orderedCandidates =
    kind === 'text' || kind === 'scriptdoc'
      ? [
          typeof data.text === 'string' ? data.text : '',
          typeof data.content === 'string' ? data.content : '',
          readLatestNodeTextResult(node) || '',
          typeof data.prompt === 'string' ? data.prompt : '',
          typeof lastResult?.text === 'string' ? lastResult.text : '',
        ]
      : [
          typeof data.prompt === 'string' ? data.prompt : '',
          typeof data.text === 'string' ? data.text : '',
          typeof data.content === 'string' ? data.content : '',
          readLatestNodeTextResult(node) || '',
          typeof lastResult?.text === 'string' ? lastResult.text : '',
        ]
  const firstNonEmpty = orderedCandidates
    .map((value) => String(value || '').trim())
    .find(Boolean)
  if (!firstNonEmpty) return null
  const clipped = clipChatPreview(firstNonEmpty, SELECTED_NODE_TEXT_PREVIEW_MAX_CHARS)
  return clipped || null
}

function extractFocusedNodeResourceContext(node: Node): FocusedNodeResourceContext | null {
  const data = (node?.data || {}) as Record<string, unknown>
  const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : String(node?.id || '').trim() || '节点'
  const kind = typeof data.kind === 'string' && data.kind.trim() ? data.kind.trim() : null

  const imageCandidates = (() => {
    const out: string[] = []
    const seen = new Set<string>()
    const push = (value: unknown) => {
      if (typeof value !== 'string') return
      const trimmed = value.trim()
      if (!trimmed || seen.has(trimmed)) return
      seen.add(trimmed)
      out.push(trimmed)
    }

    push(pickPrimaryImageUrlFromNode(node))
    push(data.imageUrl)
    const imageResults = Array.isArray(data.imageResults) ? data.imageResults : []
    imageResults.forEach((img) => {
      const record = img && typeof img === 'object' && !Array.isArray(img) ? img as Record<string, unknown> : null
      push(record?.url)
    })

    push(data.videoThumbnailUrl)
    const videoResults = Array.isArray(data.videoResults) ? data.videoResults : []
    videoResults.forEach((video) => {
      const record = video && typeof video === 'object' && !Array.isArray(video) ? video as Record<string, unknown> : null
      push(record?.thumbnailUrl)
    })

    return out.slice(0, 8)
  })()

  if (!imageCandidates.length) return null

  return {
    nodeId: String(node?.id || '').trim(),
    label,
    kind,
    imageCandidates,
  }
}

function extractSelectedCanvasNodeContext(node: Node): SelectedCanvasNodeContext | null {
  const normalizedNodeId = String(node?.id || '').trim()
  if (!normalizedNodeId) return null
  const data = (node?.data || {}) as { label?: unknown; kind?: unknown }
  const label =
    typeof data.label === 'string' && data.label.trim()
      ? data.label.trim()
      : normalizedNodeId
  const kind = typeof data.kind === 'string' && data.kind.trim() ? data.kind.trim() : null
  const productionMeta = getNodeProductionMeta(node)
  const selectedImageResult = readCurrentCanvasNodeImageResult(node)
  const anchorBindings = resolveSemanticNodeAnchorBindings(data)
  const semanticRoleBinding = resolveSemanticNodeRoleBinding(data)
  return {
    nodeId: normalizedNodeId,
    label,
    kind,
    anchorBindings,
    roleName: readTrimmedNodeStringField(node, 'roleName') || semanticRoleBinding.roleName,
    roleCardId: readTrimmedNodeStringField(node, 'roleCardId') || semanticRoleBinding.roleCardId,
    textPreview: extractSelectedNodeTextPreview(node),
    imageUrl: readImageUrlFromCanvasNode(node) || null,
    sourceUrl: readTrimmedNodeStringField(node, 'sourceUrl'),
    shotNo:
      readFiniteNodeNumberField(node, 'shotNo')
      ?? selectedImageResult?.shotNo
      ?? null,
    productionLayer: productionMeta.productionLayer ?? null,
    creationStage: productionMeta.creationStage ?? null,
    approvalStatus: productionMeta.approvalStatus ?? null,
    hasInlinePromptText: Boolean(
      selectedImageResult?.prompt
      || readTrimmedNodeStringField(node, 'prompt')
      || readTrimmedNodeStringField(node, 'text')
      || readTrimmedNodeStringField(node, 'content'),
    ),
    hasUpstreamTextEvidence: false,
    hasDownstreamComposeVideo: false,
  }
}

function normalizeNodeKind(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isTextEvidenceNodeKind(kind: string): boolean {
  return kind === 'text' || kind === 'scriptdoc'
}

function isComposeVideoNodeKind(kind: string): boolean {
  return kind === 'composevideo' || kind === 'video'
}

function extractSelectedCanvasNodeContextFromGraph(
  node: Node,
  nodes: Node[],
  edges: Array<{ source?: string | null; target?: string | null }>,
): SelectedCanvasNodeContext | null {
  const base = extractSelectedCanvasNodeContext(node)
  if (!base) return null
  const nodeId = String(node.id || '').trim()
  if (!nodeId) return base

  const nodeMap = new Map<string, Node>(
    nodes.map((item) => [String(item.id || '').trim(), item] as const).filter(([id]) => Boolean(id)),
  )

  const incomingSourceKinds = edges
    .filter((edge) => String(edge.target || '').trim() === nodeId)
    .map((edge) => nodeMap.get(String(edge.source || '').trim()))
    .filter((item): item is Node => Boolean(item))
    .map((item) => normalizeNodeKind((item.data as { kind?: unknown } | undefined)?.kind))
    .filter(Boolean)

  const outgoingTargetKinds = edges
    .filter((edge) => String(edge.source || '').trim() === nodeId)
    .map((edge) => nodeMap.get(String(edge.target || '').trim()))
    .filter((item): item is Node => Boolean(item))
    .map((item) => normalizeNodeKind((item.data as { kind?: unknown } | undefined)?.kind))
    .filter(Boolean)

  const nodeData = asRecord(node.data)
  const anchorBindings = resolveSemanticNodeAnchorBindings(nodeData)
  const semanticRoleBinding = resolveSemanticNodeRoleBinding(nodeData)

  return {
    ...base,
    anchorBindings,
    roleName: readTrimmedString(nodeData?.roleName) || semanticRoleBinding.roleName,
    roleCardId: readTrimmedString(nodeData?.roleCardId) || semanticRoleBinding.roleCardId,
    hasUpstreamTextEvidence: incomingSourceKinds.some(isTextEvidenceNodeKind),
    hasDownstreamComposeVideo: outgoingTargetKinds.some(isComposeVideoNodeKind),
  }
}

function shouldShowProjectTextMaterialHint(input: {
  currentProjectId: string
  projectTextMaterialState: ProjectTextMaterialState
  selectedCanvasNodeContext: SelectedCanvasNodeContext | null
}): boolean {
  if (!input.currentProjectId) return false
  if (input.projectTextMaterialState.status !== 'ready') return false
  if (input.projectTextMaterialState.count <= 1) return false
  const selected = input.selectedCanvasNodeContext
  if (!selected) return true
  if (selected.hasInlinePromptText) return false
  if (selected.hasUpstreamTextEvidence) return false
  if (typeof selected.shotNo === 'number') return false
  return true
}

function buildImplicitChatRequest(input: {
  selectedCanvasNodeContext: SelectedCanvasNodeContext | null
  referenceMediaCount: number
  hasTargetImage: boolean
  activeSkillName: string | null
}): ImplicitChatRequest | null {
  const contextLabels: string[] = []
  if (input.selectedCanvasNodeContext?.nodeId) contextLabels.push('当前选中节点')
  if (input.referenceMediaCount > 0) contextLabels.push(`参考素材 ${input.referenceMediaCount} 个`)
  if (input.hasTargetImage) contextLabels.push('目标效果图')
  if (input.activeSkillName) contextLabels.push(`已启用能力 ${input.activeSkillName}`)
  if (contextLabels.length === 0) return null

  const displayText = input.selectedCanvasNodeContext?.label
    ? `基于「${clipChatPreview(input.selectedCanvasNodeContext.label, 24)}」继续`
    : input.referenceMediaCount > 0 || input.hasTargetImage
      ? '基于当前参考继续'
      : input.activeSkillName
        ? `基于「${clipChatPreview(input.activeSkillName, 24)}」继续`
        : '基于当前上下文继续'

  const lines = [
    '用户本轮没有额外输入文本，但主动发送了当前上下文。',
    `当前可用上下文：${contextLabels.join('、')}。`,
    '请先基于本轮真实上下文做最小必要取证，然后：',
    '1. 简要说明你当前确认到的上下文事实；',
    '2. 明确指出你建议的下一步，或仍然缺少的关键信息；',
    '3. 若这是显式、确定性的画布改动且证据已经充分，可以直接执行；否则不要臆造用户意图。',
  ]

  return {
    prompt: lines.join('\n'),
    displayText,
  }
}

type AttachMenuTargetProps = React.ComponentPropsWithoutRef<typeof ActionIcon> & {
  tooltip: string
}

const AttachMenuTarget = React.forwardRef<HTMLButtonElement, AttachMenuTargetProps>(function AttachMenuTarget(
  { tooltip, ...props },
  ref,
): JSX.Element {
  return (
    <ChatTooltip label={tooltip} withArrow>
      <ActionIcon ref={ref} className="tc-ai-chat__attach" variant="subtle" aria-label="参考素材" {...props}>
        <IconPaperclip className="tc-ai-chat__attach-icon" size={16} />
      </ActionIcon>
    </ChatTooltip>
  )
})

function ReferenceMediaStrip({
  items,
  onClear,
  disabled,
  className,
}: {
  items: ChatReferenceMedia[]
  onClear: () => void
  disabled?: boolean
  className?: string
}): JSX.Element | null {
  if (!items.length) return null

  const refsClassName = ['tc-ai-chat__refs', className].filter(Boolean).join(' ')

  return (
    <Group className={refsClassName} gap={8} mt={8} align="center" wrap="wrap">
      {items.map((item, idx) => {
        const previewUrl = item.kind === 'video' ? item.thumbnailUrl || item.url : item.url
        const labelPrefix = item.kind === 'video' ? '参考视频' : '参考图'
        return (
          <div key={item.key} className="tc-ai-chat__ref">
            <button
              type="button"
              className="tc-ai-chat__ref-button"
              aria-label={`${labelPrefix}-${idx + 1}`}
              onClick={() => {
                try {
                  window.open(item.url, '_blank', 'noopener,noreferrer')
                } catch {
                  // ignore
                }
              }}
              disabled={disabled}
            >
              {item.kind === 'video' && !item.thumbnailUrl ? (
                <video
                  className="tc-ai-chat__ref-thumb tc-ai-chat__ref-thumb--video"
                  src={item.url}
                  preload="metadata"
                  muted
                  playsInline
                />
              ) : (
                <img
                  className={['tc-ai-chat__ref-thumb', item.kind === 'video' ? 'tc-ai-chat__ref-thumb--video' : ''].filter(Boolean).join(' ')}
                  src={previewUrl}
                  alt={`${labelPrefix}-${idx + 1}`}
                  loading="lazy"
                />
              )}
              {item.kind === 'video' ? (
                <span className="tc-ai-chat__ref-kind" aria-hidden="true">
                  <IconVideo className="tc-ai-chat__ref-kind-icon" size={12} />
                </span>
              ) : null}
            </button>
          </div>
        )
      })}

      <ActionIcon
        className="tc-ai-chat__refs-clear"
        size={42}
        radius="xs"
        variant="subtle"
        aria-label={$('清空参考素材')}
        onClick={onClear}
        disabled={disabled}
      >
        <IconTrash className="tc-ai-chat__refs-clear-icon" size={14} />
      </ActionIcon>
    </Group>
  )
}

function AttachedDocsStrip({
  docs,
  onRemove,
  disabled,
}: {
  docs: readonly AttachedDoc[]
  onRemove: (docId: string) => void
  disabled?: boolean
}): JSX.Element | null {
  if (!docs.length) return null
  return (
    <Group className="tc-ai-chat__attached-docs" gap={8} mt={8} align="center" wrap="wrap">
      {docs.map((doc) => {
        const sizeLabel = formatDocSize(doc.sizeBytes)
        const charLabel = `${doc.contentText.length.toLocaleString()} 字符`
        const tooltipText = `${doc.name}\n${doc.kind.toUpperCase()} · ${sizeLabel || charLabel}`
        return (
          <div key={doc.id} className="tc-ai-chat__attached-doc">
            <Tooltip label={tooltipText} withArrow openDelay={200}>
              <div className="tc-ai-chat__attached-doc-body">
                <IconBook2 className="tc-ai-chat__attached-doc-icon" size={14} />
                <span className="tc-ai-chat__attached-doc-name" title={doc.name}>{doc.name}</span>
                <span className="tc-ai-chat__attached-doc-meta">{doc.kind.toUpperCase()}</span>
              </div>
            </Tooltip>
            <ActionIcon
              className="tc-ai-chat__attached-doc-remove"
              size={18}
              radius="xs"
              variant="subtle"
              aria-label={$('移除附件')}
              onClick={() => onRemove(doc.id)}
              disabled={disabled}
            >
              <IconX size={12} />
            </ActionIcon>
          </div>
        )
      })}
    </Group>
  )
}

type ChatBubbleAttachmentItem = NonNullable<ChatMessage['assets']>[number]

function ChatBubbleAttachmentStrip({
  items,
  ariaLabel,
}: {
  items: readonly ChatBubbleAttachmentItem[]
  ariaLabel: string
}): JSX.Element | null {
  if (!items.length) return null
  return (
    <Group className="tc-ai-chat__refs tc-ai-chat-bubble__attachments" gap={8} mb={8} align="center" wrap="wrap" aria-label={ariaLabel}>
      {items.map((item, idx) => {
        const url = String(item.url || '').trim()
        if (!url) return null
        const thumb = String(item.thumbnailUrl || '').trim()
        const inferredVideo =
          item.mediaType === 'video' || /\.(mp4|mov|webm|mkv)(\?|$)/i.test(url)
        const labelPrefix = inferredVideo ? '参考视频' : '参考图'
        const altText = String(item.title || '').trim() || `${labelPrefix}-${idx + 1}`
        return (
          <div key={`${url}_${idx}`} className="tc-ai-chat__ref">
            <button
              type="button"
              className="tc-ai-chat__ref-button"
              aria-label={altText}
              onClick={() => {
                try {
                  window.open(url, '_blank', 'noopener,noreferrer')
                } catch {
                  // ignore
                }
              }}
            >
              {inferredVideo && !thumb ? (
                <video
                  className="tc-ai-chat__ref-thumb tc-ai-chat__ref-thumb--video"
                  src={url}
                  preload="metadata"
                  muted
                  playsInline
                />
              ) : (
                <img
                  className={['tc-ai-chat__ref-thumb', inferredVideo ? 'tc-ai-chat__ref-thumb--video' : ''].filter(Boolean).join(' ')}
                  src={thumb || url}
                  alt={altText}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              )}
              {inferredVideo ? (
                <span className="tc-ai-chat__ref-kind" aria-hidden="true">
                  <IconVideo className="tc-ai-chat__ref-kind-icon" size={12} />
                </span>
              ) : null}
            </button>
          </div>
        )
      })}
    </Group>
  )
}

type MergedAskUserBubbleProps = {
  group: Extract<import('./mergeAskUserGroups').MergedMessageGroup, { kind: 'ask-user-merged' }>
  activeRun?: LiveChatRunRecord | null
  sessionKey?: string
}

export function MergedAskUserBubble({ group, activeRun = null, sessionKey = '' }: MergedAskUserBubbleProps): JSX.Element {
  const { askMessage, userReply, continuation } = group

  const activeRunForContinuation = React.useMemo(() => {
    const normalizedSessionKey = String(sessionKey || '').trim()
    if (
      !activeRun ||
      activeRun.status !== 'running' ||
      !normalizedSessionKey ||
      activeRun.sessionKey !== normalizedSessionKey ||
      !isActiveRunBoundToChatMessage(activeRun, continuation.id)
    ) {
      return null
    }
    return activeRun
  }, [activeRun, continuation.id, sessionKey])

  const liveAgentTraceItems = activeRunForContinuation?.agentTraceItems ?? []
  const liveToolCallsByTurn = activeRunForContinuation?.toolCallsByTurn ?? {}
  const liveTodoItems = activeRunForContinuation?.todoItems ?? []

  // --- ask message section ---
  const askTraceItems = React.useMemo(
    () => askMessage.agentTraceSnapshot?.items ?? [],
    [askMessage.agentTraceSnapshot?.items],
  )
  const askToolCallSnapshot = React.useMemo(
    () => askMessage.toolCallSnapshot ?? null,
    [askMessage.toolCallSnapshot],
  )
  const askAgentTraceToolRecord = React.useMemo(
    () => askToolCallSnapshot?.record ?? null,
    [askToolCallSnapshot?.record],
  )
  const { todoItems: askTodoItems } = React.useMemo(
    () => extractLatestTodoBlock(askMessage.content),
    [askMessage.content],
  )
  const askResolvedTodoItems = React.useMemo(() => {
    const snapshot = askMessage.todoSnapshot
    if (snapshot && snapshot.length > 0) return snapshot
    return askTodoItems
  }, [askMessage.todoSnapshot, askTodoItems])

  // --- continuation section ---
  const isContinuationThinking = continuation.phase === 'thinking'
  const { markdownText: contMarkdownText, todoItems: contTodoItems } = React.useMemo(
    () => extractLatestTodoBlock(continuation.content),
    [continuation.content],
  )
  const contResolvedTodoItems = React.useMemo(() => {
    const snapshot = continuation.todoSnapshot
    if (snapshot && snapshot.length > 0) return snapshot
    return contTodoItems
  }, [continuation.todoSnapshot, contTodoItems])
  const contAgentTraceItems = React.useMemo(
    () => isContinuationThinking ? liveAgentTraceItems : (continuation.agentTraceSnapshot?.items ?? []),
    [isContinuationThinking, liveAgentTraceItems, continuation.agentTraceSnapshot?.items],
  )
  const contAgentTraceToolRecord = React.useMemo(() => {
    if (isContinuationThinking) return { toolCallsByTurn: liveToolCallsByTurn }
    return continuation.toolCallSnapshot?.record ?? null
  }, [isContinuationThinking, liveToolCallsByTurn, continuation.toolCallSnapshot?.record])
  const contTopTodoItems = isContinuationThinking ? liveTodoItems : contResolvedTodoItems
  const contResponseNode = Boolean(String(contMarkdownText || '').trim())
    ? <ChatMarkdownContent markdownText={contMarkdownText} />
    : null
  const shouldShowContLoader = Boolean(activeRunForContinuation)
  const contShouldRenderInlineTrace = isContinuationThinking || (contAgentTraceItems.length > 0 && !contResponseNode)
  const contShouldRenderFoldedTrace = !contShouldRenderInlineTrace && contAgentTraceItems.length > 0

  const contTraceNode = (
    <AgentTraceTimeline
      items={contAgentTraceItems}
      toolCallRecord={contAgentTraceToolRecord}
      todoItems={[]}
      active={false}
      showTodoProgress={false}
    />
  )

  return (
    <Group className="tc-ai-chat-bubble tc-ai-chat-bubble--assistant" justify="flex-start" align="flex-start" gap={10} wrap="nowrap">
      <PanelCard className="tc-ai-chat-bubble__card" padding="compact">
        <Group className="tc-ai-chat-bubble__meta" justify="space-between" align="center" gap={10} mb={6} wrap="nowrap">
          <Group className="tc-ai-chat-bubble__meta-left" gap={6} align="center" wrap="nowrap">
            <Badge className="tc-ai-chat-bubble__role" size="xs" radius="sm" variant="light" color="blue">
              JarvisHub
            </Badge>
            {shouldShowContLoader ? (
              <Loader className="tc-ai-chat-bubble__run-loader" size="xs" />
            ) : null}
          </Group>
          <Text className="tc-ai-chat-bubble__time" size="xs" c="dimmed">
            {askMessage.ts}
          </Text>
        </Group>

        {askResolvedTodoItems.length > 0 ? (
          <div className="tc-ai-chat-bubble__todo-progress">
            <TodoProgressCard items={askResolvedTodoItems} active={false} defaultOpen={false} title="主任务 Todo" />
          </div>
        ) : null}

        <AgentTraceTimeline
          items={askTraceItems}
          toolCallRecord={askAgentTraceToolRecord}
          todoItems={[]}
          askUserPrompt={askMessage.askUserPrompt}
          askUserAnswered={true}
          askUserReplyText={userReply.content}
          active={false}
          showTodoProgress={false}
        />

        <div className="tc-ai-chat-bubble__merge-divider" />

        {contTopTodoItems.length > 0 ? (
          <div className="tc-ai-chat-bubble__todo-progress">
            <TodoProgressCard items={contTopTodoItems} active={Boolean(activeRunForContinuation)} defaultOpen={isContinuationThinking} title="主任务 Todo" />
          </div>
        ) : null}

        {contResponseNode}
        {contShouldRenderInlineTrace ? contTraceNode : null}
        {contShouldRenderFoldedTrace ? (
          <RunTraceDisclosure>
            {contTraceNode}
          </RunTraceDisclosure>
        ) : null}

        {!isContinuationThinking && Array.isArray(continuation.assets) && continuation.assets.length > 0 ? (
          <Group className="tc-ai-chat-bubble__assets" gap={8} mt={8} align="flex-start" wrap="wrap">
            {continuation.assets.map((asset, idx) => {
              const url = String(asset?.url || '').trim()
              if (!url) return null
              return <NativeArtifactCard key={`${continuation.id}_asset_${idx}`} asset={asset} />
            })}
          </Group>
        ) : null}
      </PanelCard>
    </Group>
  )
}

type ChatBubbleProps = {
  message: ChatMessage
  activeRun?: LiveChatRunRecord | null
  sessionKey?: string
  askUserAnswered?: boolean
}

function normalizeChatMessageId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isActiveRunBoundToChatMessage(run: LiveChatRunRecord, messageId: string): boolean {
  const normalizedMessageId = normalizeChatMessageId(messageId)
  if (!normalizedMessageId) return false
  const assistantMessageId = normalizeChatMessageId(run.assistantMessageId)
  return Boolean(assistantMessageId && assistantMessageId === normalizedMessageId)
}

export function ChatBubble({
  message,
  activeRun = null,
  sessionKey = '',
  askUserAnswered = false,
}: ChatBubbleProps): JSX.Element | null {
  const isUser = message.role === 'user'
  const isThinkingMessage = !isUser && message.phase === 'thinking'
  const activeRunForMessage = React.useMemo(() => {
    const normalizedSessionKey = String(sessionKey || '').trim()
    if (
      isUser ||
      !isThinkingMessage ||
      !activeRun ||
      activeRun.status !== 'running' ||
      !normalizedSessionKey ||
      activeRun.sessionKey !== normalizedSessionKey ||
      !isActiveRunBoundToChatMessage(activeRun, message.id)
    ) {
      return null
    }
    return activeRun
  }, [activeRun, isThinkingMessage, isUser, message.id, sessionKey])
  const liveAgentTraceItems = activeRunForMessage?.agentTraceItems ?? []
  const liveToolCallsByTurn = activeRunForMessage?.toolCallsByTurn ?? {}
  const liveTodoItems = activeRunForMessage?.todoItems ?? []
  const { markdownText, todoItems } = React.useMemo(
    () => extractLatestTodoBlock(message.content),
    [message.content],
  )
  const askUserPrompt = React.useMemo(
    () => (!isUser ? message.askUserPrompt ?? null : null),
    [isUser, message.askUserPrompt],
  )
  const resolvedTodoItems = React.useMemo<ChatTodoItem[]>(() => {
    const snapshot = message.todoSnapshot
    if (snapshot && snapshot.length > 0) return snapshot
    return todoItems
  }, [message.todoSnapshot, todoItems])
  const verdictSummary = React.useMemo(
    () => formatTurnVerdictSummary(message.turnVerdict ?? null),
    [message.turnVerdict],
  )
  const diagnosticFlags = React.useMemo(
    () => Array.isArray(message.diagnosticFlags) ? message.diagnosticFlags : [],
    [message.diagnosticFlags],
  )
  const toolCallSnapshot = React.useMemo(
    () => (!isUser && message.phase !== 'thinking' && message.toolCallSnapshot)
      ? message.toolCallSnapshot
      : null,
    [isUser, message.phase, message.toolCallSnapshot],
  )
  const shouldRenderMarkdown = Boolean(String(markdownText || '').trim()) && !askUserPrompt
  const agentTraceItems = React.useMemo(
    () => (!isUser && message.phase === 'thinking')
      ? liveAgentTraceItems
      : message.agentTraceSnapshot?.items ?? [],
    [isUser, liveAgentTraceItems, message.agentTraceSnapshot?.items, message.phase],
  )
  const agentTraceToolRecord = React.useMemo(
    () => {
      if (isUser) return null
      if (message.phase === 'thinking') return { toolCallsByTurn: liveToolCallsByTurn }
      return toolCallSnapshot?.record ?? null
    },
    [isUser, liveToolCallsByTurn, message.phase, toolCallSnapshot?.record],
  )
  const responseNode = shouldRenderMarkdown
    ? <ChatMarkdownContent markdownText={markdownText} />
    : null
  const shouldRenderInlineTrace = !isUser && (isThinkingMessage || (Boolean(askUserPrompt) && !responseNode))
  const topTodoItems = !isUser && isThinkingMessage ? liveTodoItems : resolvedTodoItems
  const isAskUserPending = !isUser && Boolean(message.askUserPrompt) && !askUserAnswered
  const topTodoActive = Boolean(activeRunForMessage) && !isAskUserPending
  const topTodoNode = !isUser && topTodoItems.length > 0 ? (
    <div className="tc-ai-chat-bubble__todo-progress">
      <TodoProgressCard
        items={topTodoItems}
        active={topTodoActive}
        defaultOpen={isThinkingMessage}
        title="主任务 Todo"
      />
    </div>
  ) : null
  const shouldRenderFoldedTrace =
    !isUser &&
    !shouldRenderInlineTrace &&
    (
      agentTraceItems.length > 0 ||
      Boolean(askUserPrompt)
    )
  const traceNode = !isUser ? (
    <AgentTraceTimeline
      items={agentTraceItems}
      toolCallRecord={agentTraceToolRecord}
      todoItems={[]}
      askUserPrompt={askUserPrompt}
      askUserAnswered={askUserAnswered}
      active={false}
      showTodoProgress={false}
    />
  ) : null
  const shouldShowRunLoader = Boolean(activeRunForMessage) && !isAskUserPending

  if (
    !isUser &&
    !verdictSummary &&
    !topTodoNode &&
    !responseNode &&
    !askUserPrompt &&
    agentTraceItems.length === 0 &&
    diagnosticFlags.length === 0 &&
    !(Array.isArray(message.assets) && message.assets.length > 0) &&
    !shouldShowRunLoader &&
    !message.turnVerdict
  ) {
    return null
  }

  const wrapClassName = [
    'tc-ai-chat-bubble',
    isUser ? 'tc-ai-chat-bubble--user' : 'tc-ai-chat-bubble--assistant',
  ].join(' ')

  return (
    <Group className={wrapClassName} justify={isUser ? 'flex-end' : 'flex-start'} align="flex-start" gap={10} wrap="nowrap">
      <PanelCard className="tc-ai-chat-bubble__card" padding="compact">
        {isUser && Array.isArray(message.assets) && message.assets.length > 0 ? (
          <ChatBubbleAttachmentStrip items={message.assets} ariaLabel="user-attachments" />
        ) : null}
        <Group className="tc-ai-chat-bubble__meta" justify="space-between" align="center" gap={10} mb={6} wrap="nowrap">
          <Group className="tc-ai-chat-bubble__meta-left" gap={6} align="center" wrap="nowrap">
            <Badge className="tc-ai-chat-bubble__role" size="xs" radius="sm" variant="light" color={isUser ? 'gray' : 'blue'}>
              {isUser ? 'user' : 'JarvisHub'}
            </Badge>
            {shouldShowRunLoader ? (
              <Loader className="tc-ai-chat-bubble__run-loader" size="xs" />
            ) : null}
            {!isUser && message.turnVerdict?.status === 'partial' ? (
              <Badge className="tc-ai-chat-bubble__verdict-badge" size="xs" radius="sm" variant="light" color="yellow">
                {$('部分完成')}
              </Badge>
            ) : null}
            {!isUser && message.turnVerdict?.status === 'failed' ? (
              <Badge className="tc-ai-chat-bubble__verdict-badge" size="xs" radius="sm" variant="light" color="red">
                {$('结构失败')}
              </Badge>
            ) : null}
          </Group>
          <Text className="tc-ai-chat-bubble__time" size="xs" c="dimmed">
            {message.ts}
          </Text>
        </Group>
        {!isUser && verdictSummary ? (
          <div className="tc-ai-chat-bubble__verdict">
            <Text className="tc-ai-chat-bubble__verdict-text" size="xs" c={message.turnVerdict?.status === 'failed' ? 'red' : 'yellow'}>
              {verdictSummary}
            </Text>
          </div>
        ) : null}
        {isUser ? (
          <div className="tc-ai-chat-bubble__user-content">
            {message.skillMention ? (
              <span className="tc-ai-chat-bubble__skill-mention">{message.skillMention}</span>
            ) : null}
            {responseNode}
          </div>
        ) : (
          <>
            {topTodoNode}
            {responseNode}
            {shouldRenderInlineTrace ? traceNode : null}
            {shouldRenderFoldedTrace && traceNode ? (
              <RunTraceDisclosure>
                {traceNode}
              </RunTraceDisclosure>
            ) : null}
          </>
        )}
        {!isUser && diagnosticFlags.length > 0 ? (
          <div className="tc-ai-chat-bubble__diagnostics" aria-label="chat-diagnostics">
            <Stack className="tc-ai-chat-bubble__diagnostics-list" gap={6} mt={8}>
              {diagnosticFlags.map((flag, index) => (
                <div key={`${message.id}_diagnostic_${flag.code}_${index}`} className="tc-ai-chat-bubble__diagnostic-item">
                  <Group className="tc-ai-chat-bubble__diagnostic-header" gap={8} align="center" wrap="nowrap">
                    <Badge
                      className="tc-ai-chat-bubble__diagnostic-badge"
                      size="xs"
                      radius="sm"
                      variant="light"
                      color={flag.severity === 'high' ? 'red' : 'yellow'}
                    >
                      {flag.severity === 'high' ? $('高风险') : $('提示')}
                    </Badge>
                    <Text className="tc-ai-chat-bubble__diagnostic-title" size="xs" fw={700}>
                      {flag.title}
                    </Text>
                  </Group>
                  <Text className="tc-ai-chat-bubble__diagnostic-detail" size="xs" c="dimmed">
                    {flag.detail}
                  </Text>
                </div>
              ))}
            </Stack>
          </div>
        ) : null}
        {!isUser && Array.isArray(message.assets) && message.assets.length > 0 ? (
          <Group className="tc-ai-chat-bubble__assets" gap={8} mt={8} align="flex-start" wrap="wrap">
            {message.assets.map((asset, idx) => {
              const url = String(asset?.url || '').trim()
              if (!url) return null
              return <NativeArtifactCard key={`${message.id}_asset_${idx}`} asset={asset} />
            })}
          </Group>
        ) : null}
      </PanelCard>
    </Group>
  )
}

function RunTraceDisclosure({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)

  return (
    <div className="tc-ai-chat-run-trace">
      <UnstyledButton
        className="tc-ai-chat-run-trace__toggle"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Group className="tc-ai-chat-run-trace__toggle-inner" gap={8} align="center" wrap="nowrap">
          <IconMessageCircle className="tc-ai-chat-run-trace__icon" size={14} />
          <Text className="tc-ai-chat-run-trace__label" size="xs" fw={700}>
            运行过程
          </Text>
          <span className="tc-ai-chat-run-trace__spacer" />
          {open ? (
            <IconChevronDown className="tc-ai-chat-run-trace__chevron" size={14} />
          ) : (
            <IconChevronRight className="tc-ai-chat-run-trace__chevron" size={14} />
          )}
        </Group>
      </UnstyledButton>
      <Collapse className="tc-ai-chat-run-trace__collapse" in={open}>
        {open ? (
          <div className="tc-ai-chat-run-trace__body">
            {children}
          </div>
        ) : null}
      </Collapse>
    </div>
  )
}

export default function AiChatDialog({
  className,
  productMode = false,
}: {
  className?: string
  productMode?: boolean
}): JSX.Element | null {
  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const initialLayoutPreference = React.useMemo(() => readAiChatLayoutPreference(), [])
  const [mode, setMode] = React.useState<'compact' | 'expanded' | 'maximized'>(
    productMode ? 'maximized' : initialLayoutPreference.mode,
  )
  const [expandedWidthPx, setExpandedWidthPx] = React.useState<number>(
    () => clampPanelWidth(initialLayoutPreference.expandedWidthPx),
  )
  const expandedWidthRef = React.useRef<number>(expandedWidthPx)
  React.useEffect(() => {
    expandedWidthRef.current = expandedWidthPx
  }, [expandedWidthPx])
  const [bubbleVisualState, setBubbleVisualState] = React.useState<'bubble' | 'panel'>(() => resolveInitialBubbleVisualState(initialLayoutPreference))
  const modeBeforeMaximizeRef = React.useRef<'compact' | 'expanded'>(initialLayoutPreference.mode)
  const previousModeRef = React.useRef<'compact' | 'expanded' | 'maximized'>(initialLayoutPreference.mode)
  const previousProductModeRef = React.useRef(productMode)
  React.useEffect(() => {
    const wasProductMode = previousProductModeRef.current
    previousProductModeRef.current = productMode
    if (productMode) {
      setMode('maximized')
    } else if (wasProductMode) {
      setMode('expanded')
    }
  }, [productMode])
  const bubbleTransitionTimerRef = React.useRef<number | null>(null)
  const dockRight = true
  const [autoReferenceImages, setAutoReferenceImages] = React.useState<string[]>(() => [])
  const [autoReferenceVideos, setAutoReferenceVideos] = React.useState<ChatReferenceMedia[]>(() => [])
  const referenceImagesRef = React.useRef<string[]>([])
  const autoReferenceResolveCacheRef = React.useRef<Map<string, string>>(new Map())
  const [refsLoading, setRefsLoading] = React.useState(false)
  const [isDragOver, setIsDragOver] = React.useState(false)
  const dragDepthRef = React.useRef(0)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const targetFileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [replicatePickerOpened, setReplicatePickerOpened] = React.useState(false)

  const initialChatTabsProjectIdRef = React.useRef<string>((() => {
    const initialState = useUIStore.getState()
    const pid = initialState.currentProject?.id ? String(initialState.currentProject.id).trim() : ''
    return pid
  })())
  const [chatTabsState, setChatTabsState] = React.useState<AiChatTabsState>(() => {
    return readAiChatTabsState(initialChatTabsProjectIdRef.current)
  })
  const lastLoadedChatTabsProjectIdRef = React.useRef<string>(initialChatTabsProjectIdRef.current)
  const skipNextChatTabsPersistRef = React.useRef<boolean>(true)
  const tabRuntimeById = useAiChatRuntimeStore((s) => s.tabRuntimeById)
  const setTabRuntimeById = useAiChatRuntimeStore((s) => s.setTabRuntimeById)
  const updateStoredTabRuntime = useAiChatRuntimeStore((s) => s.updateTabRuntime)
  const [sending, setSending] = React.useState(false)
  const [sendingTabId, setSendingTabId] = React.useState<string | null>(null)
  const [queuedMediaContinuation, setQueuedMediaContinuation] = React.useState<MediaCompletionContinuationRequest | null>(null)
  const queuedMediaContinuationKeysRef = React.useRef<Set<string>>(new Set())

  const [agentLoading, setAgentLoading] = React.useState(false)
  const [agentSkills, setAgentSkills] = React.useState<ChatSelectableSkill[]>([])
  const [agentSkillsError, setAgentSkillsError] = React.useState<AgentSkillsErrorState>(null)
  const activePanel = useUIStore((s) => s.activePanel)
  const currentProjectId = useUIStore((s) => (s.currentProject?.id ? String(s.currentProject.id).trim() : ''))
  const currentProjectName = useUIStore((s) => (s.currentProject?.name ? String(s.currentProject.name).trim() : ''))
  const currentFlowId = useUIStore((s) => (s.currentFlow?.id ? String(s.currentFlow.id).trim() : ''))
  const isAdmin = useIsAdmin()
  const aiChatWatchAssetsEnabled = useUIStore((s) => s.aiChatWatchAssetsEnabled)
  const setAiChatWatchAssetsEnabled = useUIStore((s) => s.setAiChatWatchAssetsEnabled)
  const clearCreationSession = useUIStore((s) => s.clearCreationSession)
  const startLiveChatRun = useLiveChatRunStore((s) => s.startRun)
  const recordLiveChatRunEvent = useLiveChatRunStore((s) => s.recordEvent)
  const completeLiveChatRun = useLiveChatRunStore((s) => s.completeRun)
  const failLiveChatRun = useLiveChatRunStore((s) => s.failRun)
  const [projectTextMaterialState, setProjectTextMaterialState] = React.useState<ProjectTextMaterialState>({
    status: 'idle',
    count: 0,
    error: '',
  })
  const refreshProjectTextMaterialState = React.useCallback(async (projectId: string) => {
    const normalizedProjectId = String(projectId || '').trim()
    if (!normalizedProjectId) {
      setProjectTextMaterialState({ status: 'ready', count: 0, error: '' })
      return
    }
    setProjectTextMaterialState((prev) => ({ ...prev, status: 'loading', error: '' }))
    try {
      const items = await listProjectMaterials(normalizedProjectId)
      setProjectTextMaterialState({
        status: 'ready',
        count: Array.isArray(items) ? items.length : 0,
        error: '',
      })
    } catch (error: unknown) {
      setProjectTextMaterialState({
        status: 'failed',
        count: 0,
        error: error instanceof Error ? error.message : '加载项目文本素材失败',
      })
    }
  }, [])
  React.useEffect(() => {
    void refreshProjectTextMaterialState(currentProjectId)
  }, [currentProjectId, refreshProjectTextMaterialState])

  const selectedCanvasImageSignature = useRFStore(
    React.useCallback((s) => {
      const selectedImages = s.nodes
        .filter((n) => n.selected && isImageKind(String((n.data as { kind?: string } | undefined)?.kind || '')))
        .map((n) => `${String(n.id || '').trim()}:${pickPrimaryImageUrlFromNode(n as Node)}`)
        .filter(Boolean)
      return selectedImages.join('|')
    }, []),
  )
  const selectedCanvasVideoSignature = useRFStore(
    React.useCallback((s) => {
      const selectedVideos = s.nodes
        .filter((n) => n.selected && isVideoMediaNodeKind((n.data as { kind?: unknown } | undefined)?.kind))
        .map((n) => [
          String(n.id || '').trim(),
          pickDisplayVideoUrlFromNode(n as Node),
          pickDisplayVideoThumbnailUrlFromNode(n as Node),
        ].join(':'))
        .filter(Boolean)
      return selectedVideos.join('|')
    }, []),
  )
  const canvasImageCandidates = useRFStore(
    React.useCallback((s) => {
      const out: Array<{ id: string; url: string; label: string }> = []
      const seen = new Set<string>()
      for (const node of s.nodes) {
        if (!isImageKind(String((node.data as { kind?: string } | undefined)?.kind || ''))) continue
        const url = pickPrimaryImageUrlFromNode(node as Node)
        const trimmed = String(url || '').trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        const data = (node.data || {}) as { label?: unknown }
        const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : `图片-${out.length + 1}`
        out.push({ id: String(node.id || '').trim(), url: trimmed, label })
        if (out.length >= 120) break
      }
      return out
    }, []),
  )
  const selectedCanvasNodeContext = useRFStore(
    React.useCallback((s) => {
      const selectedNodes = s.nodes.filter((node) => node.selected)
      if (!selectedNodes.length) return null
      const prioritized = selectedNodes.find((node) => String((node.data as { kind?: unknown } | undefined)?.kind || '').trim())
        || selectedNodes[0]
      return extractSelectedCanvasNodeContextFromGraph(prioritized as Node, s.nodes as Node[], s.edges)
    }, []),
  )
  const agentSkillsAbortRef = React.useRef<AbortController | null>(null)
  const historyLoadVersionRef = React.useRef(0)
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const messagesContentRef = React.useRef<HTMLDivElement | null>(null)
  const compactInputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const expandedInputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const activeStreamInterruptRef = React.useRef<Map<string, () => void>>(new Map())
  const activeStreamDetachRef = React.useRef<Map<string, () => void>>(new Map())
  const recoveryStreamInterruptRef = React.useRef<Map<string, () => void>>(new Map())
  const recoveryStreamDetachRef = React.useRef<Map<string, () => void>>(new Map())
  const typewriterRunIdRef = React.useRef<Map<string, number>>(new Map())
  const shouldAutoScrollRef = React.useRef(true)
  const generatedAssetToolReloadQueueRef = React.useRef<ReturnType<typeof createGeneratedAssetToolReloadQueue> | null>(null)
  const closedTabIdsRef = React.useRef<Set<string>>(new Set())
  if (!generatedAssetToolReloadQueueRef.current) {
    generatedAssetToolReloadQueueRef.current = createGeneratedAssetToolReloadQueue()
  }

  const activeChatTab = React.useMemo(() => (
    chatTabsState.tabs.find((tab) => tab.id === chatTabsState.activeTabId)
    || chatTabsState.tabs[0]
  ), [chatTabsState.activeTabId, chatTabsState.tabs])
  const activeTabId = activeChatTab?.id || ''
  const isLocalActiveTabSending = sending && sendingTabId === activeTabId
  const activeTabRuntime = activeTabId
    ? tabRuntimeById[activeTabId] || createEmptyChatTabRuntime()
    : createEmptyChatTabRuntime()
  const draft = activeTabRuntime.draft
  const messages = activeTabRuntime.messages
  const replicateTargetImage = activeTabRuntime.replicateTargetImage
  const activeSkill = activeTabRuntime.activeSkill
  const chatSessionLane = activeTabRuntime.chatSessionLane
  const historyLoadError = activeTabRuntime.historyLoadError
  const manualReferenceImages = activeTabRuntime.manualReferenceImages
  const manualReferenceVideos = activeTabRuntime.manualReferenceVideos || []
  const hiddenAutoReferenceUrls = activeTabRuntime.hiddenAutoReferenceUrls
  const hiddenAutoReferenceVideoUrls = activeTabRuntime.hiddenAutoReferenceVideoUrls
  const uploadedReferenceAssetMeta = activeTabRuntime.uploadedReferenceAssetMeta
  const attachedDocs = activeTabRuntime.attachedDocs

  const updateTabRuntime = React.useCallback((
    tabId: string,
    updater: (current: ChatTabRuntimeState) => ChatTabRuntimeState,
  ) => {
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId) return
    if (closedTabIdsRef.current.has(normalizedTabId)) return
    updateStoredTabRuntime(normalizedTabId, updater)
  }, [updateStoredTabRuntime])

  const setDraft = React.useCallback((nextDraft: React.SetStateAction<string>) => {
    const tabId = activeTabId
    updateTabRuntime(tabId, (current) => {
      const value = typeof nextDraft === 'function' ? nextDraft(current.draft) : nextDraft
      return current.draft === value ? current : { ...current, draft: value }
    })
  }, [activeTabId, updateTabRuntime])

  const setMessages = React.useCallback((nextMessages: React.SetStateAction<ChatMessage[]>, targetTabId?: string) => {
    const tabId = String(targetTabId || '').trim() || activeTabId
    updateTabRuntime(tabId, (current) => {
      const value = typeof nextMessages === 'function' ? nextMessages(current.messages) : nextMessages
      return current.messages === value ? current : { ...current, messages: value }
    })
  }, [activeTabId, updateTabRuntime])

  const refreshMessageToolSnapshot = React.useCallback((messageId: string, sessionKey: string, targetTabId: string) => {
    const normalizedMessageId = normalizeChatMessageId(messageId)
    const normalizedSessionKey = String(sessionKey || '').trim()
    if (!normalizedMessageId || !normalizedSessionKey) return
    setMessages((prev) =>
      patchChatMessageById(prev, normalizedMessageId, (message) => ({
        ...message,
        ...refreshChatMessageToolStateFromLiveRun(message, normalizedSessionKey),
      })),
      targetTabId,
    )
  }, [setMessages])

  const setReplicateTargetImage = React.useCallback((nextTarget: React.SetStateAction<string>) => {
    const tabId = activeTabId
    updateTabRuntime(tabId, (current) => {
      const value = typeof nextTarget === 'function' ? nextTarget(current.replicateTargetImage) : nextTarget
      return current.replicateTargetImage === value ? current : { ...current, replicateTargetImage: value }
    })
  }, [activeTabId, updateTabRuntime])

  const setActiveSkill = React.useCallback((nextSkill: React.SetStateAction<ChatSelectableSkill | null>) => {
    const tabId = activeTabId
    updateTabRuntime(tabId, (current) => {
      const value = typeof nextSkill === 'function' ? nextSkill(current.activeSkill) : nextSkill
      return current.activeSkill?.id === value?.id ? current : { ...current, activeSkill: value }
    })
  }, [activeTabId, updateTabRuntime])

  const setChatSessionLane = React.useCallback((nextLane: React.SetStateAction<ChatSessionLane>) => {
    const tabId = activeTabId
    updateTabRuntime(tabId, (current) => {
      const value = typeof nextLane === 'function' ? nextLane(current.chatSessionLane) : nextLane
      return current.chatSessionLane === value ? current : { ...current, chatSessionLane: value }
    })
  }, [activeTabId, updateTabRuntime])

  const setHistoryLoadError = React.useCallback((nextError: string) => {
    const tabId = activeTabId
    updateTabRuntime(tabId, (current) => (
      current.historyLoadError === nextError ? current : { ...current, historyLoadError: nextError }
    ))
  }, [activeTabId, updateTabRuntime])

  const isCompact = mode === 'compact'
  const isMaximized = mode === 'maximized'
  const canShowHistory = mode === 'expanded' || mode === 'maximized'
  const useScrollableHistory = canShowHistory
  const showProjectTextMaterialHint = shouldShowProjectTextMaterialHint({
    currentProjectId,
    projectTextMaterialState,
    selectedCanvasNodeContext,
  })
  const hasExplicitTargetImage = Boolean(String(replicateTargetImage || '').trim())
  const visibleMessages = messages
  const answeredAskUserMessageIds = React.useMemo(() => {
    const set = new Set<string>()
    for (let i = 0; i < visibleMessages.length; i += 1) {
      const candidate = visibleMessages[i]
      if (candidate.role !== 'assistant' || !candidate.askUserPrompt) continue
      for (let j = i + 1; j < visibleMessages.length; j += 1) {
        if (visibleMessages[j].role === 'user') {
          set.add(candidate.id)
          break
        }
      }
    }
    return set
  }, [visibleMessages])
  const mergedGroups = React.useMemo(
    () => buildMergedMessageGroups(visibleMessages),
    [visibleMessages],
  )
  const askUserSelectedOptionRef = React.useRef<{ messageId: string; option: string } | null>(null)
  const [askUserSelectedOptionVersion, setAskUserSelectedOptionVersion] = React.useState(0)
  const pendingAskUser = React.useMemo<PendingAskUserState | null>(() => {
    void askUserSelectedOptionVersion
    const derived = recoverPendingAskUserStateFromMessages(visibleMessages)
    if (!derived) return null
    const cached = askUserSelectedOptionRef.current
    if (cached && cached.messageId === derived.sourceMessageId) {
      return { ...derived, selectedOption: cached.option }
    }
    if (cached) askUserSelectedOptionRef.current = null
    return derived
  }, [visibleMessages, askUserSelectedOptionVersion])
  const showDockedBubble = dockRight && bubbleVisualState === 'bubble' && !pendingAskUser
  const effectiveChatSessionKey = React.useMemo(() => {
    return resolveEffectiveChatSessionKey({
      tab: activeChatTab,
      projectId: currentProjectId,
      flowId: currentFlowId,
      lane: chatSessionLane,
    })
  }, [activeChatTab, chatSessionLane, currentFlowId, currentProjectId])
  const activeLiveRun = useLiveChatRunStore(
    React.useCallback(
      (s) => s.runsBySessionKey[effectiveChatSessionKey] ?? null,
      [effectiveChatSessionKey],
    ),
  )
  const isActiveTabSending = isLocalActiveTabSending || (
    activeLiveRun?.status === 'running' &&
    activeLiveRun.sessionKey === effectiveChatSessionKey
  )
  const effectiveSendingTabId = sendingTabId || (isActiveTabSending ? activeTabId : null)
  const showDebugTraceExport = isAdmin || isLocalDebugTraceHost()

  const handleExportCurrentChatTrace = React.useCallback(() => {
    const now = new Date()
    const sessionPart = sanitizeTraceExportNamePart(effectiveChatSessionKey, 'session')
    const projectPart = sanitizeTraceExportNamePart(currentProjectName || currentProjectId, 'project')
    const filename = `ai-chat-trace-${projectPart}-${sessionPart}-${formatTraceExportTimestamp(now)}.json`
    const payload = {
      exportedAt: now.toISOString(),
      project: {
        id: currentProjectId || null,
        name: currentProjectName || null,
      },
      flow: {
        id: currentFlowId || null,
      },
      chat: {
        activeTabId: activeTabId || null,
        activeSkill: activeSkill ? {
          id: activeSkill.id,
          key: activeSkill.key,
          name: activeSkill.name,
        } : null,
        lane: chatSessionLane,
        sessionKey: effectiveChatSessionKey || null,
        pendingAskUser,
        visibleMessageCount: visibleMessages.length,
        visibleMessages: buildChatTraceMessageExport(visibleMessages),
      },
      liveRun: activeLiveRun ? {
        runId: activeLiveRun.runId,
        status: activeLiveRun.status,
        requestText: activeLiveRun.requestText,
        displayText: activeLiveRun.displayText,
        projectId: activeLiveRun.projectId,
        projectName: activeLiveRun.projectName,
        flowId: activeLiveRun.flowId,
        sessionKey: activeLiveRun.sessionKey,
        skillName: activeLiveRun.skillName,
        requestId: activeLiveRun.requestId,
        sessionId: activeLiveRun.sessionId,
        userMessageId: activeLiveRun.userMessageId,
        assistantMessageId: activeLiveRun.assistantMessageId,
        startedAt: activeLiveRun.startedAt,
        updatedAt: activeLiveRun.updatedAt,
        finishedAt: activeLiveRun.finishedAt,
        errorMessage: activeLiveRun.errorMessage,
        doneReason: activeLiveRun.doneReason,
        assistantPreview: activeLiveRun.assistantPreview,
        assetCount: activeLiveRun.assetCount,
        todoItems: activeLiveRun.todoItems,
        logs: activeLiveRun.logs,
        turnOrder: activeLiveRun.turnOrder,
        currentTurnId: activeLiveRun.currentTurnId,
        agentTraceItems: activeLiveRun.agentTraceItems,
        toolCallsByTurn: activeLiveRun.toolCallsByTurn,
      } : null,
    }
    downloadTraceExportJson(filename, payload)
    toast('已导出当前 AI Chat 轨迹', 'success')
  }, [
    activeChatTab,
    activeLiveRun,
    activeSkill,
    activeTabId,
    chatSessionLane,
    currentFlowId,
    currentProjectId,
    currentProjectName,
    effectiveChatSessionKey,
    pendingAskUser,
    visibleMessages,
  ])

  React.useEffect(() => {
    if (mode === 'maximized') return
    writeAiChatLayoutPreference({ dockRight: true, mode, expandedWidthPx })
  }, [mode, expandedWidthPx])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => {
      setExpandedWidthPx((prev) => {
        const next = clampPanelWidth(prev)
        return next === prev ? prev : next
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  React.useEffect(() => {
    if (lastLoadedChatTabsProjectIdRef.current === currentProjectId) return
    lastLoadedChatTabsProjectIdRef.current = currentProjectId
    skipNextChatTabsPersistRef.current = true
    const loaded = readAiChatTabsState(currentProjectId)
    setChatTabsState(loaded)
    notifyNativeChatNavigationChanged(currentProjectId)
  }, [currentProjectId])

  React.useEffect(() => {
    if (skipNextChatTabsPersistRef.current) {
      skipNextChatTabsPersistRef.current = false
      return
    }
    const persistProjectId = lastLoadedChatTabsProjectIdRef.current
    if (!persistProjectId) return
    writeAiChatTabsState(chatTabsState, persistProjectId)
    notifyNativeChatNavigationChanged(persistProjectId)
  }, [chatTabsState])

  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const rootStyle = document.documentElement.style
    rootStyle.setProperty('--tc-ai-chat-panel-width', `${expandedWidthPx}px`)
    const reservedWidth =
      mode === 'maximized' || mode === 'compact'
        ? AI_CHAT_LAYOUT_RESERVED_WIDTH_NONE
        : reservedWidthForExpanded(expandedWidthPx)
    rootStyle.setProperty('--tc-ai-chat-reserved-width', reservedWidth)
    return () => {
      rootStyle.setProperty('--tc-ai-chat-reserved-width', AI_CHAT_LAYOUT_RESERVED_WIDTH_NONE)
    }
  }, [mode, expandedWidthPx])

  React.useEffect(() => {
    const sessionKey = String(effectiveChatSessionKey || '').trim()
    shouldAutoScrollRef.current = true
    const requestVersion = historyLoadVersionRef.current + 1
    historyLoadVersionRef.current = requestVersion
    if (!sessionKey) {
      setHistoryLoadError('')
      return
    }
    if (!activeChatTab?.sessionKey && activeTabId && currentProjectId) {
      setChatTabsState((prev) => bindAiChatTabSession(prev, activeTabId, {
        sessionKey,
        scope: {
          projectId: currentProjectId,
          flowId: currentFlowId,
          lane: chatSessionLane,
          skill: null,
        },
      }))
    }
    setHistoryLoadError('')

    let cancelled = false
    void (async () => {
      try {
        const response = await getMemoryContext({
          sessionKey,
          recentConversationLimit: 20,
          limitPerScope: 4,
        })
        if (cancelled || historyLoadVersionRef.current !== requestVersion) {
          return
        }
        const recentConversation = Array.isArray(response.context.recentConversation)
          ? response.context.recentConversation
          : []
        const history = recentConversation
          .map((item, index) => mapMemoryConversationItemToChatMessage(item, index))
          .filter((item): item is ChatMessage => Boolean(item))
        for (let i = 0; i < recentConversation.length; i += 1) {
          const raw = recentConversation[i]
          if (!raw || raw.role !== 'assistant') continue
          const mapped = history.find((m) => m.id === String(raw.id || '').trim())
          const looksLikeAskUserMarkdown = /可选回复\s*[:：]|^Options\s*[:：]/im.test(String(raw.content || ''))
          if (looksLikeAskUserMarkdown && mapped && !mapped.askUserPrompt) {
            console.warn(
              '[ai-chat] history item looks like ask_user but askUserPrompt is missing',
              { id: mapped.id, sessionKey },
            )
          }
        }
        setMessages((prev) => mergeLoadedHistoryWithLocalMessages(history, prev))
        setHistoryLoadError('')
      } catch (error: unknown) {
        if (cancelled || historyLoadVersionRef.current !== requestVersion) return
        console.warn('[ai-chat] load conversation history failed', error)
        setHistoryLoadError(error instanceof Error && error.message.trim() ? error.message.trim() : '加载对话历史失败')
        if (messages.length === 0) {
          setMessages([])
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [effectiveChatSessionKey])

  React.useEffect(() => {
    const sessionKey = String(effectiveChatSessionKey || '').trim()
    const requestTabId = String(activeTabId || '').trim()
    if (!sessionKey || !requestTabId) return
    let cancelled = false
    let stopStream: (() => void) | null = null
    let recoveryBackendWroteCanvas = false
    const recoveryStreamCreatedNodeIds: string[] = []

    const ensureRecoveredMessages = (run: AgentsChatRunSummaryDto): string | null => {
      const assistantMessageId = String(run.assistantMessageId || '').trim()
      const userMessageId = String(run.userMessageId || '').trim()
      if (!assistantMessageId || !userMessageId) {
        console.error('[ai-chat] active run missing stable message IDs; skip recovery', {
          runId: run.runId,
        })
        return null
      }
      setMessages((prev) => {
        const hasAssistant = prev.some((message) => message.id === assistantMessageId)
        if (hasAssistant) return prev
        const hasUser = prev.some((message) => message.id === userMessageId)
        const now = formatNowTime()
        const recoveredUserAssets = extractRecoveredUserAssets(run.request)
        const additions: ChatMessage[] = []
        if (!hasUser) {
          additions.push({
            id: userMessageId,
            role: 'user',
            ts: now,
            content: run.displayText || run.requestText || '继续恢复中的 AI 运行',
            ...(recoveredUserAssets.length ? { assets: recoveredUserAssets } : {}),
          })
        }
        additions.push({
          id: assistantMessageId,
          role: 'assistant',
          ts: now,
          content: '',
          phase: 'thinking',
          kind: 'progress',
          toolCallTurnIds: [PENDING_TOOL_CALL_TURN_ID],
        })
        return [...prev, ...additions]
      }, requestTabId)
      return assistantMessageId
    }

    const finishRecoveredRun = async (
      messageId: string,
      runId: string,
      resp: AgentsChatResponseDto,
      seq?: number,
      options?: { keepRunPointer?: boolean },
    ) => {
      const rawReply = typeof resp?.text === 'string' ? resp.text.trim() : ''
      const { displayText: parsedReply } = parseCanvasPlanFromReply(rawReply)
      const reply = parsedReply || rawReply || '（空响应）'
      const parsedAutoImages = extractCanvasAutoGeneratedImages(reply)
      const assistantAssets = mergeAssistantAssets(normalizeAssistantAssets(resp.assets), parsedAutoImages)
      const turnVerdict = readChatTurnVerdict(resp)
      const resultApplied = hasAppliedChatRunResult({ runId, responseId: resp.id })
      if (!resultApplied) {
        if (currentFlowId) {
          const traceMutation = resp.trace?.canvasMutation ?? null
          const rfStore = useRFStore.getState()
          applyTraceCanvasDeletions(traceMutation, {
            deleteNode: rfStore.deleteNode,
            deleteEdge: rfStore.deleteEdge,
          })
          if (recoveryBackendWroteCanvas) {
            const focusNodeIds = uniqueNonEmptyNodeIds(recoveryStreamCreatedNodeIds)
            if (focusNodeIds.length > 0) {
              focusCanvasNodeAfterReload(focusNodeIds)
            }
          } else if (responseTraceIndicatesCanvasWrite(resp.trace)) {
            try {
              const reloaded = await reloadCanvasFlowFromServer({
                flowId: currentFlowId,
                expectedProjectId: currentProjectId,
                expectedFlowId: currentFlowId,
              })
              if (reloaded.reloaded && reloaded.newNodeIds.length > 0) {
                focusCanvasNodeAfterReload(reloaded.newNodeIds)
              }
            } catch (error: unknown) {
              console.warn('[ai-chat] recover run reload flow failed', error)
            }
          }
        }
        markChatRunResultApplied({ runId, responseId: resp.id })
      }
      setMessages((prev) =>
        patchChatMessageById(prev, messageId, (message) => ({
          ...message,
          content: reply,
          assets: assistantAssets,
          ts: formatNowTime(),
          phase: 'final',
          kind: 'result',
          ...(Array.isArray(resp.trace?.todoList?.items)
            ? { todoSnapshot: normalizeChatTodoItems(resp.trace.todoList.items) }
            : null),
          ...(turnVerdict ? { turnVerdict } : null),
          ...(Array.isArray(resp.trace?.diagnosticFlags) ? { diagnosticFlags: resp.trace.diagnosticFlags } : null),
          ...finalizeChatMessageToolState(message, sessionKey),
        })),
        requestTabId,
      )
      completeLiveChatRun(sessionKey, resp, reply, seq)
      if (options?.keepRunPointer !== true) {
        clearActiveChatRunPointer(sessionKey)
      }
      recoveryStreamInterruptRef.current.delete(requestTabId)
      recoveryStreamDetachRef.current.delete(requestTabId)
      setSending(false)
      setSendingTabId(null)
    }

    void (async () => {
      const pointer = readActiveChatRunPointer(sessionKey)
      let activeRuns: AgentsChatRunSummaryDto[] = []
      try {
        const response = await listActiveAgentsChatRuns({
          sessionKey,
          ...(currentProjectId ? { canvasProjectId: currentProjectId } : {}),
          ...(currentFlowId ? { canvasFlowId: currentFlowId } : {}),
        })
        activeRuns = Array.isArray(response.runs) ? response.runs : []
      } catch (error: unknown) {
        console.warn('[ai-chat] list active chat runs failed', error)
      }
      if (cancelled) return
      const activeRun = resolveRecoverableChatRun({
        pointer,
        activeRuns,
        currentProjectId,
        currentFlowId,
      })
      if (!activeRun) return

      const messageId = ensureRecoveredMessages(activeRun)
      if (!messageId) return
      startLiveChatRun({
        runId: activeRun.runId,
        userMessageId: activeRun.userMessageId,
        assistantMessageId: messageId,
        requestText: activeRun.requestText,
        displayText: activeRun.displayText,
        projectId: currentProjectId,
        projectName: currentProjectName,
        flowId: currentFlowId,
        sessionKey,
      })
      writeActiveChatRunPointer({
        sessionKey,
        runId: activeRun.runId,
        userMessageId: activeRun.userMessageId,
        assistantMessageId: activeRun.assistantMessageId,
        requestText: activeRun.requestText,
        displayText: activeRun.displayText,
        ...(activeRun.canvasProjectId ? { canvasProjectId: activeRun.canvasProjectId } : {}),
        ...(activeRun.canvasFlowId ? { canvasFlowId: activeRun.canvasFlowId } : {}),
        ...(typeof activeRun.request !== 'undefined' ? { request: activeRun.request } : {}),
        updatedAt: Date.now(),
      })
      setSending(true)
      setSendingTabId(requestTabId)
      let streamSettled = false
      let keepRecoveredRunPointerForMedia = false
      const recoveryPendingMediaKeys = new Set<string>()

      const markRecoveredRunInterrupted = () => {
        if (streamSettled) return
        streamSettled = true
        failLiveChatRun(sessionKey, CHAT_ABORTED_MESSAGE)
        clearActiveChatRunPointer(sessionKey)
        recoveryStreamInterruptRef.current.delete(requestTabId)
        recoveryStreamDetachRef.current.delete(requestTabId)
        setMessages((prev) =>
          patchChatMessageById(prev, messageId, (chatMessage) => ({
            ...chatMessage,
            content: CHAT_ABORTED_MESSAGE,
            ts: formatNowTime(),
            phase: 'final',
            kind: 'error',
            ...finalizeChatMessageToolState(chatMessage, sessionKey, {
              finalizeUnresolved: {
                status: 'failed',
                message: CHAT_ABORTED_MESSAGE,
              },
            }),
          })),
          requestTabId,
        )
        setSending(false)
        setSendingTabId(null)
      }

      const scheduleRecoveryCanvasToolSync = (payload: AgentsChatToolStreamPayload) => {
        const result = scheduleAiChatCanvasToolStreamSync({
          payload,
          expectedFlowId: currentFlowId,
          expectedProjectId: currentProjectId,
          queue: generatedAssetToolReloadQueueRef.current,
          contextLabel: 'recovery',
        })
        if (result.wroteCurrentFlowCanvas) {
          recoveryBackendWroteCanvas = true
          appendCanvasMutationCreatedNodeIds(recoveryStreamCreatedNodeIds, payload)
        }
      }
      const scheduleRecoveryMediaResultSync = (payload: AgentsChatMediaResultStreamPayload) => {
        const result = scheduleAiChatCanvasMediaResultStreamSync({
          payload,
          expectedFlowId: currentFlowId,
          expectedProjectId: currentProjectId,
          queue: generatedAssetToolReloadQueueRef.current,
          contextLabel: 'recovery',
        })
        if (result.wroteCurrentFlowCanvas) recoveryBackendWroteCanvas = true
      }

      stopStream = await agentsChatRunEventsStream(
        { runId: activeRun.runId, afterSeq: 0 },
        {
          onEvent: (event) => {
            if (cancelled) return
            applyPendingMediaStreamEvent(recoveryPendingMediaKeys, event)
            recordLiveChatRunEvent(sessionKey, event)
            if (event.event === 'initial') {
              const durableRunId = String(event.data.runId || activeRun.runId).trim()
              if (durableRunId) {
                writeActiveChatRunPointer({
                  sessionKey,
                  runId: durableRunId,
                  userMessageId: activeRun.userMessageId,
                  assistantMessageId: activeRun.assistantMessageId,
                  requestText: activeRun.requestText,
                  displayText: activeRun.displayText,
                  ...(activeRun.canvasProjectId ? { canvasProjectId: activeRun.canvasProjectId } : {}),
                  ...(activeRun.canvasFlowId ? { canvasFlowId: activeRun.canvasFlowId } : {}),
                  ...(typeof activeRun.request !== 'undefined' ? { request: activeRun.request } : {}),
                  updatedAt: Date.now(),
                })
              }
              return
            }
            if (event.event === 'turn.started') {
              const turnId = readLiveChatRunBySessionKey(sessionKey)?.currentTurnId
              if (turnId) {
                setMessages((prev) =>
                  patchChatMessageById(prev, messageId, (message) => {
                    const existing = Array.isArray(message.toolCallTurnIds) ? message.toolCallTurnIds : []
                    return existing.includes(turnId) ? message : { ...message, toolCallTurnIds: [...existing, turnId] }
                  }),
                  requestTabId,
                )
              }
              return
            }
            if (event.event === 'thinking') {
              return
            }
            if (event.event === 'media_result') {
              scheduleRecoveryMediaResultSync(event.data)
              refreshMessageToolSnapshot(messageId, sessionKey, requestTabId)
              if (streamSettled && recoveryPendingMediaKeys.size === 0) {
                if (keepRecoveredRunPointerForMedia) {
                  clearActiveChatRunPointer(sessionKey)
                  keepRecoveredRunPointerForMedia = false
                }
                stopStream?.()
                stopStream = null
              }
              return
            }
            if (event.event === 'tool') {
              const askUserPrompt = parseAskUserPromptFromToolEvent(event.data)
              if (askUserPrompt) {
                setMessages((prev) =>
                  patchChatMessageById(prev, messageId, (message) => {
                    if (
                      message.askUserPrompt &&
                      message.askUserPrompt.toolCallId === askUserPrompt.toolCallId
                    ) {
                      return message
                    }
                    return { ...message, askUserPrompt }
                  }),
                  requestTabId,
                )
                return
              }
              scheduleRecoveryCanvasToolSync(event.data)
              return
            }
            if (event.event === 'todo_list') {
              const todoItems = normalizeChatTodoItems(event.data.items)
              setMessages((prev) =>
                patchChatMessageById(prev, messageId, (message) => ({
                  ...message,
                  todoSnapshot: todoItems,
                })),
                requestTabId,
              )
              return
            }
            if (event.event === 'content') {
              return
            }
            if (event.event === 'result') {
              streamSettled = true
              keepRecoveredRunPointerForMedia = recoveryPendingMediaKeys.size > 0
              void finishRecoveredRun(messageId, activeRun.runId, event.data.response, event.seq, {
                keepRunPointer: keepRecoveredRunPointerForMedia,
              })
              return
            }
            if (event.event === 'error') {
              streamSettled = true
              const message = formatAgentsStreamErrorMessage(event.data)
              failLiveChatRun(sessionKey, message, event.seq)
              clearActiveChatRunPointer(sessionKey)
              recoveryStreamInterruptRef.current.delete(requestTabId)
              recoveryStreamDetachRef.current.delete(requestTabId)
              setMessages((prev) =>
                patchChatMessageById(prev, messageId, (chatMessage) => ({
                  ...chatMessage,
                  content: `（错误）${message}`,
                  ts: formatNowTime(),
                  phase: 'final',
                  kind: 'error',
                  ...finalizeChatMessageToolState(chatMessage, sessionKey, {
                    finalizeUnresolved: {
                      status: 'failed',
                      message,
                    },
                  }),
                })),
                requestTabId,
              )
              setSending(false)
              setSendingTabId(null)
              return
            }
            if (event.event === 'aborted') {
              markRecoveredRunInterrupted()
              return
            }
            if (event.event === 'done' && !streamSettled) {
              const message = event.data.reason === 'aborted'
                ? CHAT_ABORTED_MESSAGE
                : event.data.reason === 'error'
                  ? '对话流异常结束'
                  : '对话流已结束，但未返回最终结果'
              failLiveChatRun(sessionKey, message, event.seq)
              clearActiveChatRunPointer(sessionKey)
              recoveryStreamInterruptRef.current.delete(requestTabId)
              recoveryStreamDetachRef.current.delete(requestTabId)
              setMessages((prev) =>
                patchChatMessageById(prev, messageId, (chatMessage) => ({
                  ...chatMessage,
                  content: `（错误）${message}`,
                  ts: formatNowTime(),
                  phase: 'final',
                  kind: 'error',
                  ...finalizeChatMessageToolState(chatMessage, sessionKey, {
                    finalizeUnresolved: {
                      status: 'failed',
                      message,
                    },
                  }),
                })),
                requestTabId,
              )
              setSending(false)
              setSendingTabId(null)
            }
          },
          onError: (error) => {
            if (cancelled) return
            console.warn('[ai-chat] recover run stream failed', error)
            const message = error instanceof Error && error.message ? error.message : '续接对话流失败'
            failLiveChatRun(sessionKey, message)
            clearActiveChatRunPointer(sessionKey)
            recoveryStreamInterruptRef.current.delete(requestTabId)
            recoveryStreamDetachRef.current.delete(requestTabId)
            setMessages((prev) =>
              patchChatMessageById(prev, messageId, (chatMessage) => ({
                ...chatMessage,
                content: `（错误）${message}`,
                ts: formatNowTime(),
                phase: 'final',
                kind: 'error',
                ...finalizeChatMessageToolState(chatMessage, sessionKey, {
                  finalizeUnresolved: {
                    status: 'failed',
                    message,
                  },
                }),
              })),
              requestTabId,
            )
            setSending(false)
            setSendingTabId(null)
          },
        },
      )
      if (cancelled) {
        stopStream()
        recoveryStreamDetachRef.current.delete(requestTabId)
        return
      }
      recoveryStreamInterruptRef.current.set(requestTabId, () => {
        stopStream?.()
        stopStream = null
        markRecoveredRunInterrupted()
      })
      recoveryStreamDetachRef.current.set(requestTabId, () => {
        stopStream?.()
        stopStream = null
        recoveryStreamInterruptRef.current.delete(requestTabId)
        recoveryStreamDetachRef.current.delete(requestTabId)
        setSending(false)
        setSendingTabId(null)
      })
    })()

    return () => {
      cancelled = true
      stopStream?.()
      stopStream = null
      recoveryStreamInterruptRef.current.delete(requestTabId)
      recoveryStreamDetachRef.current.delete(requestTabId)
    }
  }, [
    activeTabId,
    completeLiveChatRun,
    currentFlowId,
    currentProjectId,
    currentProjectName,
    effectiveChatSessionKey,
    failLiveChatRun,
    recordLiveChatRunEvent,
    refreshMessageToolSnapshot,
    setMessages,
    startLiveChatRun,
  ])

  const scrollToBottom = React.useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    try {
      el.scrollTop = el.scrollHeight
      shouldAutoScrollRef.current = true
    } catch {
      // ignore
    }
  }, [])

  const syncAutoScrollPreference = React.useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    shouldAutoScrollRef.current = isViewportNearBottom(el)
  }, [])

  const messageScrollKey = React.useMemo(
    () => [
      visibleMessages.map((message) => `${message.id}:${message.ts}:${message.content}:${message.assets?.map((asset) => `${asset.title}:${asset.url}:${asset.thumbnailUrl || ''}`).join('|') || ''}`).join('\n'),
      pendingAskUser
        ? `${pendingAskUser.toolCallId}:${pendingAskUser.question}:${pendingAskUser.selectedOption || ''}`
        : '',
    ].join('\n'),
    [pendingAskUser, visibleMessages],
  )

  React.useLayoutEffect(() => {
    if (!canShowHistory) return
    const raf = window.requestAnimationFrame(() => {
      if (!shouldAutoScrollRef.current) return
      scrollToBottom()
    })
    return () => window.cancelAnimationFrame(raf)
  }, [canShowHistory, messageScrollKey, scrollToBottom])

  React.useEffect(() => {
    if (!canShowHistory) return
    const contentEl = messagesContentRef.current
    if (!contentEl || typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(() => {
      if (!shouldAutoScrollRef.current) return
      scrollToBottom()
    })

    resizeObserver.observe(contentEl)
    return () => {
      resizeObserver.disconnect()
    }
  }, [canShowHistory, scrollToBottom])

  React.useEffect(() => {
    if (!canShowHistory) return
    const viewportEl = viewportRef.current
    if (!viewportEl) return

    shouldAutoScrollRef.current = isViewportNearBottom(viewportEl)
    const handleScroll = () => {
      syncAutoScrollPreference()
    }

    viewportEl.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      viewportEl.removeEventListener('scroll', handleScroll)
    }
  }, [canShowHistory, messageScrollKey, syncAutoScrollPreference])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    if (!canShowHistory) return
    if (messages.length === 0) return
    shouldAutoScrollRef.current = true
    let rafId = 0
    let timeoutId = 0
    rafId = window.requestAnimationFrame(() => {
      scrollToBottom()
      timeoutId = window.setTimeout(() => {
        scrollToBottom()
      }, 40)
    })
    return () => {
      window.cancelAnimationFrame(rafId)
      window.clearTimeout(timeoutId)
    }
  }, [canShowHistory, mode, scrollToBottom, visibleMessages.length, pendingAskUser])

  const reloadAgentSkill = React.useCallback(async () => {
    agentSkillsAbortRef.current?.abort()
    const controller = new AbortController()
    agentSkillsAbortRef.current = controller
    setAgentLoading(true)
    try {
      const result = await listRuntimeAgentSkills()
      if (controller.signal.aborted) return
      const skills: ChatSelectableSkill[] = selectChatRuntimeSkillsForMenu(result.skills)

      setAgentSkills(skills)
      setTabRuntimeById((prev) => {
        let changed = false
        const next: Record<string, ChatTabRuntimeState> = {}
        Object.entries(prev).forEach(([tabId, runtime]) => {
          if (!runtime.activeSkill) {
            next[tabId] = runtime
            return
          }
          const matched = skills.find((skill) => skill.id === runtime.activeSkill?.id) || null
          if (matched === runtime.activeSkill) {
            next[tabId] = runtime
            return
          }
          changed = true
          next[tabId] = { ...runtime, activeSkill: matched }
        })
        return changed ? next : prev
      })
      setAgentSkillsError(
        result.loadErrors.length > 0
          ? { kind: 'partial', count: result.loadErrors.length }
          : null,
      )
    } catch (err: unknown) {
      if (controller.signal.aborted) return
      console.warn('[ai-chat] get agent skill failed', err)
      const message = err instanceof Error ? err.message : '加载 Skill 失败'
      setAgentSkillsError({ kind: 'all' })
      toast(message, 'error')
    } finally {
      if (!controller.signal.aborted) {
        setAgentLoading(false)
      }
    }
  }, [])

  React.useEffect(() => {
    return () => {
      agentSkillsAbortRef.current?.abort()
    }
  }, [])

  const visibleAutoReferenceImages = React.useMemo(() => {
    if (!autoReferenceImages.length) return []
    const hidden = new Set(hiddenAutoReferenceUrls)
    return autoReferenceImages.filter((url) => !hidden.has(url))
  }, [autoReferenceImages, hiddenAutoReferenceUrls])

  const visibleAutoReferenceVideos = React.useMemo(() => {
    if (!autoReferenceVideos.length) return []
    const hidden = new Set(hiddenAutoReferenceVideoUrls)
    return autoReferenceVideos.filter((item) => !hidden.has(item.url))
  }, [autoReferenceVideos, hiddenAutoReferenceVideoUrls])

  const referenceImages = React.useMemo(() => {
    const merged: string[] = []
    const seen = new Set<string>()
    const push = (url: string) => {
      const trimmed = String(url || '').trim()
      if (!trimmed || seen.has(trimmed)) return
      seen.add(trimmed)
      merged.push(trimmed)
    }

    visibleAutoReferenceImages.forEach(push)
    manualReferenceImages.forEach(push)
    return merged
  }, [manualReferenceImages, visibleAutoReferenceImages])

  const referenceMedia = React.useMemo<ChatReferenceMedia[]>(() => {
    const merged: ChatReferenceMedia[] = []
    const seen = new Set<string>()
    const push = (item: ChatReferenceMedia) => {
      const url = String(item.url || '').trim()
      const key = `${item.kind}:${url}`
      if (!url || seen.has(key)) return
      seen.add(key)
      merged.push({ ...item, url })
    }

    referenceImages.forEach((url, index) => {
      push({
        key: `image:${url}`,
        kind: 'image',
        url,
        label: `参考图-${index + 1}`,
      })
    })
    visibleAutoReferenceVideos.forEach(push)
    manualReferenceVideos.forEach((item, index) => push({
      key: `video:manual:${item.nodeId || index}:${item.url}`,
      kind: 'video',
      url: item.url,
      label: item.label,
      ...(item.nodeId ? { nodeId: item.nodeId } : {}),
      ...(item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : {}),
    }))
    return merged
  }, [manualReferenceVideos, referenceImages, visibleAutoReferenceVideos])

  React.useEffect(() => {
    referenceImagesRef.current = referenceImages
  }, [referenceImages])

  React.useEffect(() => {
    if (!activeTabId) return
    const autoSet = new Set(autoReferenceImages)
    updateTabRuntime(activeTabId, (current) => {
      const next = current.hiddenAutoReferenceUrls.filter((url) => autoSet.has(url))
      if (next.length === current.hiddenAutoReferenceUrls.length) return current
      return { ...current, hiddenAutoReferenceUrls: next }
    })
  }, [activeTabId, autoReferenceImages, updateTabRuntime])

  React.useEffect(() => {
    if (!activeTabId) return
    const autoVideoSet = new Set(autoReferenceVideos.map((item) => item.url))
    updateTabRuntime(activeTabId, (current) => {
      const next = current.hiddenAutoReferenceVideoUrls.filter((url) => autoVideoSet.has(url))
      if (next.length === current.hiddenAutoReferenceVideoUrls.length) return current
      return { ...current, hiddenAutoReferenceVideoUrls: next }
    })
  }, [activeTabId, autoReferenceVideos, updateTabRuntime])

  React.useEffect(() => {
    let cancelled = false

    const loadAutoReferenceImages = async () => {
      const { nodes } = useRFStore.getState()
      const selectedImages = nodes
        .filter((n) => n.selected && isImageKind(String((n.data as { kind?: string } | undefined)?.kind || '')))

      const out: string[] = []
      const seen = new Set<string>()
      for (const node of selectedImages) {
        const raw = pickPrimaryImageUrlFromNode(node as Node)
        if (!raw) continue
        const cached = autoReferenceResolveCacheRef.current.get(raw)
        const resolved = cached || (await resolveReferenceImageUrl(raw))
        if (!resolved || seen.has(resolved)) continue
        autoReferenceResolveCacheRef.current.set(raw, resolved)
        seen.add(resolved)
        out.push(resolved)
      }

      if (!cancelled) {
        setAutoReferenceImages(out)
      }
    }

    void loadAutoReferenceImages()
    return () => {
      cancelled = true
    }
  }, [selectedCanvasImageSignature])

  React.useEffect(() => {
    const { nodes } = useRFStore.getState()
    const selectedVideos = nodes
      .filter((n) => n.selected && isVideoMediaNodeKind((n.data as { kind?: unknown } | undefined)?.kind))

    const out: ChatReferenceMedia[] = []
    const seen = new Set<string>()
    for (const node of selectedVideos) {
      const rawVideoUrl = pickDisplayVideoUrlFromNode(node as Node)
      const resolvedVideoUrl = toAbsoluteApiUrl(rawVideoUrl)
      if (!resolvedVideoUrl || seen.has(resolvedVideoUrl)) continue
      seen.add(resolvedVideoUrl)
      const rawThumbnailUrl = pickDisplayVideoThumbnailUrlFromNode(node as Node)
      const resolvedThumbnailUrl = rawThumbnailUrl ? toAbsoluteApiUrl(rawThumbnailUrl) : null
      const nodeId = String(node.id || '').trim()
      out.push({
        key: `video:${nodeId || out.length}:${resolvedVideoUrl}`,
        kind: 'video',
        url: resolvedVideoUrl,
        label: readCanvasNodeLabel(node as Node, `视频-${out.length + 1}`),
        ...(nodeId ? { nodeId } : {}),
        ...(resolvedThumbnailUrl ? { thumbnailUrl: resolvedThumbnailUrl } : {}),
      })
    }
    setAutoReferenceVideos(out)
  }, [selectedCanvasVideoSignature])

  const addReferenceImagesSafe = React.useCallback((urls: string[], opts?: { source?: string }) => {
    const raw = Array.isArray(urls) ? urls : []
    const incoming = raw.map((u) => String(u || '').trim()).filter(Boolean)
    if (!incoming.length) return
    if (!activeTabId) return

    let added = 0
    updateTabRuntime(activeTabId, (current) => {
      const prevManual = current.manualReferenceImages
      const hiddenAuto = new Set(current.hiddenAutoReferenceUrls)
      const visibleAuto = autoReferenceImages.filter((url) => !hiddenAuto.has(url))
      const seen = new Set<string>([...visibleAuto, ...prevManual])
      const nextManual = [...prevManual]
      for (const url of incoming) {
        if (seen.has(url)) continue
        seen.add(url)
        nextManual.push(url)
        added += 1
      }
      if (added === 0) return current
      return { ...current, manualReferenceImages: nextManual }
    })

    if (added > 0) {
      const sourceLabel = String(opts?.source || '').trim()
      toast(sourceLabel ? `已添加 ${added} 张参考图（${sourceLabel}）` : `已添加 ${added} 张参考图`, 'success')
    }
  }, [activeTabId, autoReferenceImages, updateTabRuntime])

  React.useEffect(() => {
    const onArtifactCommand = (event: Event) => {
      const command = (event as CustomEvent<NativeArtifactChatCommand>).detail
      const url = String(command?.asset?.url || '').trim()
      if (!command || !url || !activeTabId) return
      const assetId = String(command.asset.assetId || '').trim()
      const assetRefId = String(command.asset.assetRefId || '').trim()
      const name = String(command.asset.title || '').trim()
      updateTabRuntime(activeTabId, (current) => ({
        ...current,
        uploadedReferenceAssetMeta: {
          ...current.uploadedReferenceAssetMeta,
          [url]: {
            ...(assetId ? { assetId } : {}),
            ...(assetRefId ? { assetRefId } : {}),
            ...(name ? { name } : {}),
          },
        },
      }))
      if (command.asset.mediaType === 'video') {
        updateTabRuntime(activeTabId, (current) => {
          const currentVideos = current.manualReferenceVideos || []
          if (currentVideos.some((item) => item.url === url)) return current
          return {
            ...current,
            manualReferenceVideos: [
              ...currentVideos,
              {
                url,
                label: name || 'Reference video',
                ...(command.asset.thumbnailUrl ? { thumbnailUrl: command.asset.thumbnailUrl } : {}),
                ...(command.asset.nodeId ? { nodeId: command.asset.nodeId } : {}),
              },
            ],
          }
        })
        toast('已添加 1 个参考视频（Artifact）', 'success')
      } else {
        addReferenceImagesSafe([url], { source: 'Artifact' })
      }
      if (command.type === 'modify') {
        setDraft((current) => current || `请基于「${name || '当前资产'}」继续修改：`)
      }
    }
    window.addEventListener(NATIVE_ARTIFACT_CHAT_COMMAND, onArtifactCommand)
    return () => window.removeEventListener(NATIVE_ARTIFACT_CHAT_COMMAND, onArtifactCommand)
  }, [activeTabId, addReferenceImagesSafe, setDraft, updateTabRuntime])

  const clearReferenceImages = React.useCallback(() => {
    if (!activeTabId) return
    const autoNow = Array.isArray(autoReferenceImages) ? autoReferenceImages : []
    const autoVideosNow = Array.isArray(autoReferenceVideos) ? autoReferenceVideos.map((item) => item.url) : []
    updateTabRuntime(activeTabId, (current) => ({
      ...current,
      manualReferenceImages: [],
      manualReferenceVideos: [],
      uploadedReferenceAssetMeta: {},
      hiddenAutoReferenceUrls: autoNow,
      hiddenAutoReferenceVideoUrls: autoVideosNow,
    }))
  }, [activeTabId, autoReferenceImages, autoReferenceVideos, updateTabRuntime])

  const openReplicateTargetPicker = React.useCallback(() => {
    if (!canvasImageCandidates.length) {
      toast('画布里没有可选图片，请先上传或生成图片', 'error')
      return
    }
    setReplicatePickerOpened(true)
  }, [canvasImageCandidates.length])

  const chooseReplicateTargetFromCanvas = React.useCallback(async (raw: string) => {
    const source = String(raw || '').trim()
    if (!source) return
    if (!raw) {
      toast('选中的目标效果图无效', 'error')
      return
    }
    const resolved = await resolveReferenceImageUrl(source)
    if (!resolved) {
      toast('目标效果图解析失败，请重试或重新上传', 'error')
      return
    }
    setReplicateTargetImage(resolved)
    setReplicatePickerOpened(false)
    toast('已设置目标效果图', 'success')
  }, [])

  const onUploadReplicateTargetFile = React.useCallback(async (files: FileList | null) => {
    const file = files && files[0] ? files[0] : null
    if (!file) return
    try {
      const name = typeof file?.name === 'string' && file.name.trim() ? file.name.trim() : `target-${Date.now()}`
      const hosted = await uploadServerAssetFile(file, name, { taskKind: 'image_edit' })
      const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
      const abs = hostedUrl ? toAbsoluteApiUrl(hostedUrl) : null
      if (!abs) {
        toast('上传目标效果图失败：未获得可用 URL', 'error')
        return
      }
      setReplicateTargetImage(abs)
      toast('目标效果图上传成功', 'success')
    } catch (err: unknown) {
      toast(readAiChatErrorMessage(err, '上传目标效果图失败'), 'error')
    } finally {
      if (targetFileInputRef.current) targetFileInputRef.current.value = ''
    }
  }, [])

  const addSelectedCanvasImagesAsReferences = React.useCallback(async () => {
    if (refsLoading) return
    setRefsLoading(true)
    try {
      const { nodes } = useRFStore.getState()
      const selected = nodes.filter((n) => n.selected)
      const selectedImages = selected.filter((n) => isImageKind(String((n.data as { kind?: unknown } | undefined)?.kind || '')))
      if (!selectedImages.length) {
        toast('请先在画布中选中 1 张图片节点', 'error')
        return
      }

      const resolvedUrls: string[] = []
      for (const node of selectedImages) {
        const primary = pickPrimaryImageUrlFromNode(node as Node)
        if (!primary) continue
        const resolved = await resolveReferenceImageUrl(primary)
        if (!resolved) continue
        resolvedUrls.push(resolved)
      }

      if (!resolvedUrls.length) {
        toast('选中的图片节点没有可用的图片 URL（请先上传/生成）', 'error')
        return
      }

      addReferenceImagesSafe(resolvedUrls, { source: '画布' })
    } finally {
      setRefsLoading(false)
    }
  }, [addReferenceImagesSafe, refsLoading])

  const onUploadReferenceFiles = React.useCallback(async (files: FileList | null) => {
    const list = files ? Array.from(files) : []
    if (!list.length) return

    if (refsLoading) return
    if (!activeTabId) return
    const uploadTabId = activeTabId
    setRefsLoading(true)
    try {
      const imageFiles: File[] = []
      const docTasks: Promise<AttachedDoc>[] = []
      const unsupportedNames: string[] = []
      for (const file of list) {
        const classified = classifyUploadedFile(file)
        if (classified.kind === 'image') {
          imageFiles.push(classified.file)
        } else if (classified.kind === 'doc') {
          docTasks.push(parseAttachedDoc(classified.file, classified.docKind))
        } else {
          unsupportedNames.push(String(file?.name || '').trim() || '未知文件')
        }
      }

      if (unsupportedNames.length) {
        toast(`暂不支持的文件类型：${unsupportedNames.join('、')}`, 'error')
      }

      if (imageFiles.length) {
        const urls: string[] = []
        const metaUpdates: Record<string, UploadedReferenceAssetMeta> = {}
        for (const file of imageFiles) {
          const name = typeof file?.name === 'string' && file.name.trim() ? file.name.trim() : `upload-${Date.now()}`
          const hosted = await uploadServerAssetFile(file, name, { taskKind: 'image_edit' })
          const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
          const abs = hostedUrl ? toAbsoluteApiUrl(hostedUrl) : null
          if (abs) {
            urls.push(abs)
            metaUpdates[abs] = {
              ...(hosted.id ? { assetId: hosted.id } : null),
              ...(name ? { name } : null),
            }
          }
        }
        if (urls.length) {
          updateTabRuntime(uploadTabId, (current) => ({
            ...current,
            uploadedReferenceAssetMeta: {
              ...current.uploadedReferenceAssetMeta,
              ...metaUpdates,
            },
          }))
          addReferenceImagesSafe(urls, { source: '上传' })
        } else {
          toast('上传失败：未获得图片 URL', 'error')
        }
      }

      if (docTasks.length) {
        const settled = await Promise.allSettled(docTasks)
        const parsedDocs: AttachedDoc[] = []
        for (const result of settled) {
          if (result.status === 'fulfilled') parsedDocs.push(result.value)
          else toast(readAiChatErrorMessage(result.reason, '解析文件失败'), 'error')
        }
        if (parsedDocs.length) {
          updateTabRuntime(uploadTabId, (current) => ({
            ...current,
            attachedDocs: [...current.attachedDocs, ...parsedDocs],
          }))
        }
      }
    } catch (err: unknown) {
      toast(readAiChatErrorMessage(err, '上传文件失败'), 'error')
    } finally {
      setRefsLoading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }, [activeTabId, addReferenceImagesSafe, refsLoading, updateTabRuntime])

  const removeAttachedDoc = React.useCallback((docId: string) => {
    if (!activeTabId) return
    updateTabRuntime(activeTabId, (current) => ({
      ...current,
      attachedDocs: current.attachedDocs.filter((doc) => doc.id !== docId),
    }))
  }, [activeTabId, updateTabRuntime])

  const clearAttachedDocs = React.useCallback(() => {
    if (!activeTabId) return
    updateTabRuntime(activeTabId, (current) => (
      current.attachedDocs.length === 0 ? current : { ...current, attachedDocs: [] }
    ))
  }, [activeTabId, updateTabRuntime])

  const expandChat = React.useCallback(() => {
    setMode((m) => {
      if (m !== 'compact') return m
      return 'expanded'
    })
  }, [])

  const collapseChat = React.useCallback(() => {
    if (productMode) return
    setMode((m) => {
      if (m === 'compact') return m
      return 'compact'
    })
  }, [productMode])

  const toggleMaximized = React.useCallback(() => {
    if (productMode) return
    setMode((m) => {
      if (m === 'maximized') return modeBeforeMaximizeRef.current
      modeBeforeMaximizeRef.current = m === 'expanded' ? 'expanded' : 'compact'
      return 'maximized'
    })
  }, [productMode])

  const onResizeHandlePointerDown = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'expanded') return
    if (e.button !== 0) return
    e.preventDefault()
    const handleEl = e.currentTarget
    const startX = e.clientX
    const startWidth = expandedWidthRef.current
    const pointerId = e.pointerId
    const rootEl = handleEl.closest('.tc-ai-chat') as HTMLElement | null
    const rootStyle = document.documentElement.style

    handleEl.setPointerCapture(pointerId)
    if (rootEl) rootEl.setAttribute('data-resizing', 'true')
    document.body.classList.add('tc-ai-chat-resizing')

    const onMove = (ev: PointerEvent) => {
      // 面板贴右边缘：鼠标向左移动 → 宽度增加
      const delta = startX - ev.clientX
      const next = clampPanelWidth(startWidth + delta)
      expandedWidthRef.current = next
      rootStyle.setProperty('--tc-ai-chat-panel-width', `${next}px`)
      rootStyle.setProperty('--tc-ai-chat-reserved-width', reservedWidthForExpanded(next))
    }

    const onUp = () => {
      handleEl.removeEventListener('pointermove', onMove)
      handleEl.removeEventListener('pointerup', onUp)
      handleEl.removeEventListener('pointercancel', onUp)
      if (rootEl) rootEl.removeAttribute('data-resizing')
      document.body.classList.remove('tc-ai-chat-resizing')
      setExpandedWidthPx(expandedWidthRef.current)
    }

    handleEl.addEventListener('pointermove', onMove)
    handleEl.addEventListener('pointerup', onUp)
    handleEl.addEventListener('pointercancel', onUp)
  }, [mode])

  React.useEffect(() => {
    const previousMode = previousModeRef.current
    previousModeRef.current = mode

    if (typeof window === 'undefined') {
      setBubbleVisualState(mode === 'compact' ? 'bubble' : 'panel')
      return
    }

    if (bubbleTransitionTimerRef.current !== null) {
      window.clearTimeout(bubbleTransitionTimerRef.current)
      bubbleTransitionTimerRef.current = null
    }

    if (mode === 'compact') {
      if (previousMode === 'expanded' || previousMode === 'maximized') {
        setBubbleVisualState('panel')
        bubbleTransitionTimerRef.current = window.setTimeout(() => {
          setBubbleVisualState('bubble')
          bubbleTransitionTimerRef.current = null
        }, AI_CHAT_MODE_TRANSITION_MS)
        return
      }
      setBubbleVisualState('bubble')
      return
    }

    setBubbleVisualState('panel')
  }, [mode])

  React.useEffect(() => {
    return () => {
      if (bubbleTransitionTimerRef.current === null || typeof window === 'undefined') return
      window.clearTimeout(bubbleTransitionTimerRef.current)
    }
  }, [])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    if (mode !== 'expanded' && mode !== 'maximized') return
    const rafId = window.requestAnimationFrame(() => {
      expandedInputRef.current?.focus({ preventScroll: true })
    })
    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [clearCreationSession, mode])

  React.useEffect(() => {
    const interruptMap = activeStreamInterruptRef.current
    const detachMap = activeStreamDetachRef.current
    const recoveryMap = recoveryStreamInterruptRef.current
    const recoveryDetachMap = recoveryStreamDetachRef.current
    const typewriterMap = typewriterRunIdRef.current
    return () => {
      typewriterMap.clear()
      detachMap.forEach((fn) => {
        try { fn() } catch (err) { console.warn('[ai-chat] detach on unmount failed', err) }
      })
      detachMap.clear()
      interruptMap.clear()
      recoveryDetachMap.forEach((fn) => {
        try { fn() } catch (err) { console.warn('[ai-chat] recovery detach on unmount failed', err) }
      })
      recoveryDetachMap.clear()
      recoveryMap.clear()
    }
  }, [])

  const animateAssistantReply = React.useCallback(async (tabId: string, messageId: string, text: string) => {
    const normalized = String(text || '').trim() || '（空响应）'
    const runId = (typewriterRunIdRef.current.get(tabId) ?? 0) + 1
    typewriterRunIdRef.current.set(tabId, runId)

    let visibleLength = 0
    while (visibleLength < normalized.length) {
      if (typewriterRunIdRef.current.get(tabId) !== runId) return
      const remaining = normalized.length - visibleLength
      const nextStep = remaining > 160 ? 20 : remaining > 80 ? 10 : remaining > 32 ? 6 : 3
      visibleLength = Math.min(normalized.length, visibleLength + nextStep)
      const partial = normalized.slice(0, visibleLength)
      setMessages((prev) =>
        patchChatMessageById(prev, messageId, (message) => ({
          ...message,
          content: partial,
        })),
        tabId,
      )
      if (visibleLength < normalized.length) {
        await sleepMs(16)
      }
    }
  }, [setMessages])

  const interruptActiveChat = React.useCallback(() => {
    if (!activeTabId) return
    const sendFn = activeStreamInterruptRef.current.get(activeTabId)
    const recoveryFn = recoveryStreamInterruptRef.current.get(activeTabId)
    const hasLocalStreamControl = Boolean(sendFn || recoveryFn)
    activeStreamInterruptRef.current.delete(activeTabId)
    activeStreamDetachRef.current.delete(activeTabId)
    recoveryStreamInterruptRef.current.delete(activeTabId)
    recoveryStreamDetachRef.current.delete(activeTabId)
    const tab = chatTabsState.tabs.find((item) => item.id === activeTabId)
    const sessionKey = String(tab?.sessionKey || '').trim()
    if (!sessionKey && !hasLocalStreamControl) return
    if (sessionKey) {
      const pointer = readActiveChatRunPointer(sessionKey)
      const runIdToAbort = String(pointer?.runId || activeLiveRun?.runId || '').trim()
      if (runIdToAbort) {
        void abortAgentsChatRun({ runId: runIdToAbort }).catch((err) => {
          console.warn('[ai-chat] abort run on interrupt failed', err)
        })
      }
      clearActiveChatRunPointer(sessionKey)
      if (!hasLocalStreamControl && activeLiveRun?.status === 'running') {
        failLiveChatRun(sessionKey, CHAT_ABORTED_MESSAGE)
        const messageId = String(activeLiveRun.assistantMessageId || '').trim()
        if (messageId) {
          setMessages((prev) =>
            patchChatMessageById(prev, messageId, (message) => ({
              ...message,
              content: CHAT_ABORTED_MESSAGE,
              phase: 'final',
              kind: 'error',
              ...finalizeChatMessageToolState(message, sessionKey, {
                finalizeUnresolved: {
                  status: 'failed',
                  message: CHAT_ABORTED_MESSAGE,
                },
              }),
            })),
            activeTabId,
          )
        }
        setSending(false)
        setSendingTabId(null)
      }
    }
    sendFn?.()
    recoveryFn?.()
  }, [activeLiveRun, activeTabId, chatTabsState.tabs, failLiveChatRun, setMessages])

  const normalizedDraft = React.useMemo(() => String(draft || '').trim(), [draft])
  const isAwaitingAskUserReply = Boolean(pendingAskUser)
  const activeSkillContextName = React.useMemo(() => {
    const name = String(activeSkill?.name || activeSkill?.key || '').trim()
    return name || null
  }, [activeSkill?.key, activeSkill?.name])
  const implicitSendRequest = React.useMemo<ImplicitChatRequest | null>(() => {
    if (pendingAskUser) return null
    if (normalizedDraft) return null
    return buildImplicitChatRequest({
      selectedCanvasNodeContext,
      referenceMediaCount: referenceMedia.length,
      hasTargetImage: hasExplicitTargetImage,
      activeSkillName: activeSkillContextName,
    })
  }, [activeSkillContextName, hasExplicitTargetImage, normalizedDraft, pendingAskUser, referenceMedia.length, selectedCanvasNodeContext])
  const canSendMessage = isAwaitingAskUserReply
    ? Boolean(pendingAskUser?.selectedOption || normalizedDraft)
    : Boolean(normalizedDraft || implicitSendRequest)

  const send = React.useCallback(async (options?: SendOptions) => {
    if (isActiveTabSending) return
    const requestTabId = activeTabId
    if (!requestTabId) return
    const askUserReplyText = pendingAskUser
      ? String(pendingAskUser.selectedOption || '').trim() || String(draft || '').trim()
      : ''
    const selectedStyleReferenceCard = options?.styleReferenceCard ?? null
	const selectedStyleReferenceTranscriptAsset = buildStyleReferenceTranscriptAsset(selectedStyleReferenceCard)
    const explicitText = String(options?.text ?? (pendingAskUser ? askUserReplyText : draft) ?? '').trim()
    const explicitDisplayText = String(options?.displayText ?? '').trim()
    const requestText = explicitText || implicitSendRequest?.prompt || ''
    const displayText = explicitDisplayText || explicitText || implicitSendRequest?.displayText || ''
    if (!requestText) return
    if (!currentProjectId || !currentFlowId) {
      toast(
        !currentProjectId
          ? '请先创建或打开项目画布，再使用 AI 对话。'
          : '当前项目还没有绑定画布，请先创建或保存画布后再使用 AI 对话。',
        'error',
      )
      return
    }
    const preSendSave = (window as Window & { silentSaveProject?: () => Promise<void> }).silentSaveProject
    if (typeof preSendSave === 'function') {
      try { await preSendSave() } catch {}
    }
    void (async () => {
      try {
        const materials = await listProjectMaterials(currentProjectId)
        setProjectTextMaterialState({
          status: 'ready',
          count: materials.length,
          error: '',
        })
      } catch (error: unknown) {
        console.warn('[ai-chat] pre-send listProjectMaterials failed, continue sending', error)
        setProjectTextMaterialState((prev) => ({
          status: 'failed',
          count: prev.count,
          error: error instanceof Error ? error.message : '加载项目文本素材失败',
        }))
      }
    })()
    const effectiveSkill = options?.skill === undefined ? activeSkill : options.skill
    const explicitAttachCanvasContext = options?.attachCanvasContext === true
    const targetEffectUrl = String(replicateTargetImage || '').trim()
    const selectedReplicateMode = Boolean(targetEffectUrl)
    const hasCanvasScope =
      Boolean(currentProjectId) ||
      Boolean(currentFlowId) ||
      Boolean(selectedCanvasNodeContext?.nodeId)
    const shouldAttachCanvasContext =
      explicitAttachCanvasContext ||
      (!pendingAskUser && !explicitText && Boolean(implicitSendRequest)) ||
      selectedReplicateMode ||
      hasCanvasScope
    // Keep chat send path deterministic: project text material hints should not block
    // or alter reference collection unless an explicit isolation rule is introduced.
    const shouldUseProjectTextIsolation = false
    const nextSessionLane = resolveChatSessionLane({
      hasReplicateTarget: selectedReplicateMode,
    })
    const requestSessionKey = resolveEffectiveChatSessionKey({
      tab: activeChatTab,
      projectId: currentProjectId,
      flowId: currentFlowId,
      lane: nextSessionLane,
    })
    const requestProjectId = String(currentProjectId || '').trim()
    const requestFlowId = String(currentFlowId || '').trim()
    if (chatSessionLane !== nextSessionLane) {
      setChatSessionLane(nextSessionLane)
    }
    setChatTabsState((prev) => bindAiChatTabSession(prev, requestTabId, {
      sessionKey: requestSessionKey,
      scope: {
        projectId: requestProjectId,
        flowId: requestFlowId,
        lane: nextSessionLane,
        skill: null,
      },
    }))
    const requestSelectedCanvasNodeContext = shouldAttachCanvasContext
      ? selectedCanvasNodeContext
      : null

    let pendingId = ''
    setSending(true)
    setSendingTabId(requestTabId)
    typewriterRunIdRef.current.set(
      requestTabId,
      (typewriterRunIdRef.current.get(requestTabId) ?? 0) + 1,
    )
    historyLoadVersionRef.current += 1
    let resultEventSeq: number | undefined
    let errorEventSeq: number | undefined
    try {
      let streamedReply = ''
      const manualReferenceImagesPayload = Array.isArray(referenceImages)
        ? referenceImages.map((u) => String(u || '').trim()).filter(Boolean)
        : []
      const focusedNodeContext = shouldUseProjectTextIsolation ? null : (() => {
        try {
          const { nodes } = useRFStore.getState()
          const selected = nodes.filter((n) => n.selected)
          if (selected.length !== 1) return null
          return extractFocusedNodeResourceContext(selected[0] as Node)
        } catch {
          return null
        }
      })()
      const selectedMediaReferencesPayload = shouldUseProjectTextIsolation
        ? []
        : referenceMedia
            .map((item) => ({
              kind: item.kind,
              url: String(item.url || '').trim(),
              ...(item.nodeId ? { nodeId: item.nodeId } : {}),
              ...(item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : {}),
              ...(item.label ? { label: item.label } : {}),
            }))
            .filter((item) => Boolean(item.url))

      const referenceImagesPayloadRaw = await (async (): Promise<string[]> => {
        const merged: string[] = []
        const seen = new Set<string>()
        const push = (url: string) => {
          const trimmed = String(url || '').trim()
          if (!trimmed || seen.has(trimmed)) return
          seen.add(trimmed)
          merged.push(trimmed)
        }

        manualReferenceImagesPayload.forEach(push)
        const rawCandidates = focusedNodeContext?.imageCandidates || []
        if (!rawCandidates.length) return merged
        for (const raw of rawCandidates) {
          const resolved = await resolveReferenceImageUrl(raw)
          if (!resolved) continue
          push(resolved)
        }

        return merged
      })()
      const referenceImagesPayload = selectedReplicateMode && targetEffectUrl
        ? referenceImagesPayloadRaw.filter((u) => u !== targetEffectUrl)
        : referenceImagesPayloadRaw
      const selectedAssetInputs: ChatAssetInput[] = shouldUseProjectTextIsolation ? [] : await (async (): Promise<ChatAssetInput[]> => {
        const { nodes } = useRFStore.getState()
        const selectedImages = nodes
          .filter((n) => n.selected && isImageKind(String((n.data as { kind?: string } | undefined)?.kind || '')))

        const candidates: Array<{
          assetId?: string
          url: string
          role?: ChatAssetInputRole
          note?: string
          name?: string
        }> = []
        for (let i = 0; i < selectedImages.length; i += 1) {
          const node = selectedImages[i]
          const primary = pickPrimaryImageUrlFromNode(node as Node)
          if (!primary) continue
          const resolved = await resolveReferenceImageUrl(primary)
          if (!resolved) continue
          candidates.push(buildSelectedImageAssetCandidate(node as Node, resolved))
        }
        return buildSelectedImageAssetInputs(candidates)
      })()
      const assetInputsPayload = (() => {
        const merged: ChatAssetInput[] = []
        const seenUrl = new Set<string>()
        const push = (item: ChatAssetInput) => {
          const role = String(item?.role || 'reference').trim() as ChatAssetInputRole
          const url = String(item?.url || '').trim()
          if (!url) return
          if (seenUrl.has(url)) return
          seenUrl.add(url)
          merged.push(item)
        }
        selectedAssetInputs.forEach(push)
        referenceMedia.forEach((reference) => {
          const url = String(reference.url || '').trim()
          const uploadedMeta = uploadedReferenceAssetMeta[url] || null
          push({
            url,
            role: 'reference',
            ...(uploadedMeta?.assetId ? { assetId: uploadedMeta.assetId } : {}),
            ...(uploadedMeta?.assetRefId ? { assetRefId: uploadedMeta.assetRefId } : {}),
            ...(uploadedMeta?.name ? { name: uploadedMeta.name } : {}),
          })
        })
        if (selectedReplicateMode && targetEffectUrl) {
          merged.unshift({
            url: targetEffectUrl,
            role: 'target',
            note: '目标效果图：保持版式与模块布局',
          })
        }
        return merged
      })()
      const now = formatNowTime()
      const userSkillMention = formatSkillMention(effectiveSkill)
      const userMessageId = `m_user_${Date.now()}`
      const userAttachedAssets = shouldUseProjectTextIsolation
        ? []
        : buildUserAttachedAssets(referenceMedia, selectedAssetInputs)
	  if (selectedStyleReferenceTranscriptAsset) {
		userAttachedAssets.unshift(selectedStyleReferenceTranscriptAsset)
      }
      const userMsg: ChatMessage = {
        id: userMessageId,
        role: 'user',
        ts: now,
        content: displayText || requestText,
        ...(userSkillMention ? { skillMention: userSkillMention } : {}),
        ...(userAttachedAssets.length ? { assets: userAttachedAssets } : {}),
      }
      if (activeChatTab?.title === '新对话') {
        setChatTabsState((prev) => updateAiChatTabTitle(prev, requestTabId, displayText || requestText))
      }
      pendingId = `m_ai_pending_${Date.now() + 1}`
      const pendingMsg: ChatMessage = {
        id: pendingId,
        role: 'assistant',
        ts: now,
        content: '',
        phase: 'thinking',
        kind: 'progress',
        toolCallTurnIds: [PENDING_TOOL_CALL_TURN_ID],
      }

      setMessages((prev) => [...prev, userMsg, pendingMsg], requestTabId)

      setDraft('')
      const attachedDocsForRequest: AttachedDoc[] = attachedDocs.slice()
      if (attachedDocsForRequest.length) {
        updateTabRuntime(requestTabId, (current) => (
          current.attachedDocs.length === 0 ? current : { ...current, attachedDocs: [] }
        ))
      }
      if (!pendingAskUser && mode === 'compact') setMode('expanded')

      const docsBlock = buildAttachedDocsPromptBlock(attachedDocsForRequest)
      const requestTextWithDocs = docsBlock
        ? `${docsBlock}\n\n${requestText}`.trim()
        : requestText
      const promptPayload = buildSkillDirectedPrompt({
        prompt: requestTextWithDocs,
        skill: effectiveSkill,
      })
      const requiredSkillsPayload = buildRequiredSkillsForChat(effectiveSkill)
      const requestExecution = resolveChatRequestExecution()
      const selectedReferenceAnchorBindings = requestSelectedCanvasNodeContext
        ? normalizeSelectedReferenceAnchorBindings(requestSelectedCanvasNodeContext.anchorBindings)
        : undefined
      const requestPayload: AgentsChatRequestDto = {
        vendor: 'agents',
        prompt: promptPayload,
        ...(requiredSkillsPayload.length ? { requiredSkills: requiredSkillsPayload } : {}),
        ...(displayText ? { displayPrompt: displayText } : {}),
        ...(requestSessionKey ? { sessionKey: requestSessionKey } : {}),
        ...(currentProjectId ? { canvasProjectId: currentProjectId } : {}),
        ...(currentFlowId ? { canvasFlowId: currentFlowId } : {}),
        ...(requestSelectedCanvasNodeContext?.nodeId ? { canvasNodeId: requestSelectedCanvasNodeContext.nodeId } : {}),
        chatContext: {
          ...(effectiveSkill
            ? {
                skill: {
                  ...(effectiveSkill.key ? { key: effectiveSkill.key } : {}),
                  ...(effectiveSkill.name ? { name: effectiveSkill.name } : {}),
                },
              }
            : {}),
          ...(requestSelectedCanvasNodeContext?.kind ? { selectedNodeKind: requestSelectedCanvasNodeContext.kind } : {}),
          ...(requestSelectedCanvasNodeContext
            ? {
                selectedReference: {
                  nodeId: requestSelectedCanvasNodeContext.nodeId,
                  label: requestSelectedCanvasNodeContext.label,
                  ...(requestSelectedCanvasNodeContext.kind ? { kind: requestSelectedCanvasNodeContext.kind } : {}),
                  ...(selectedReferenceAnchorBindings?.length
                    ? { anchorBindings: selectedReferenceAnchorBindings }
                    : {}),
                  ...(requestSelectedCanvasNodeContext.roleName ? { roleName: requestSelectedCanvasNodeContext.roleName } : {}),
                  ...(requestSelectedCanvasNodeContext.roleCardId ? { roleCardId: requestSelectedCanvasNodeContext.roleCardId } : {}),
                  ...(requestSelectedCanvasNodeContext.imageUrl ? { imageUrl: requestSelectedCanvasNodeContext.imageUrl } : {}),
                  ...(requestSelectedCanvasNodeContext.sourceUrl ? { sourceUrl: requestSelectedCanvasNodeContext.sourceUrl } : {}),
                  ...(typeof requestSelectedCanvasNodeContext.shotNo === 'number' ? { shotNo: requestSelectedCanvasNodeContext.shotNo } : {}),
                  ...(requestSelectedCanvasNodeContext.productionLayer ? { productionLayer: requestSelectedCanvasNodeContext.productionLayer } : {}),
                  ...(requestSelectedCanvasNodeContext.creationStage ? { creationStage: requestSelectedCanvasNodeContext.creationStage } : {}),
                  ...(requestSelectedCanvasNodeContext.approvalStatus ? { approvalStatus: requestSelectedCanvasNodeContext.approvalStatus } : {}),
                  ...(requestSelectedCanvasNodeContext.hasUpstreamTextEvidence ? { hasUpstreamTextEvidence: true } : {}),
                  ...(requestSelectedCanvasNodeContext.hasDownstreamComposeVideo ? { hasDownstreamComposeVideo: true } : {}),
                },
              }
            : {}),
        },
        mode: requestExecution.mode,
        temperature: 0.7,
        ...(referenceImagesPayload.length ? { referenceImages: referenceImagesPayload } : {}),
        ...(assetInputsPayload.length ? { assetInputs: assetInputsPayload } : {}),
        ...(selectedMediaReferencesPayload.length ? { selectedMediaReferences: selectedMediaReferencesPayload } : {}),
        ...(localStorage.getItem('jarvis_memory_enabled') === 'false' ? { disableMemory: true } : {}),
        userMessageId,
        assistantMessageId: pendingId,
      }
      startLiveChatRun({
        runId: pendingId,
        userMessageId,
        assistantMessageId: pendingId,
        requestText,
        displayText,
        projectId: currentProjectId,
        projectName: currentProjectName,
        flowId: currentFlowId,
        sessionKey: requestSessionKey,
        skillName: effectiveSkill?.name || effectiveSkill?.key || '',
      })
      let resultEventSeq: number | undefined
      let errorEventSeq: number | undefined
      generatedAssetToolReloadQueueRef.current?.reset()
      let backendWroteCanvas = false
      let keepRunPointerForMediaTail = false
      const streamCreatedNodeIds: string[] = []
      const resp = await new Promise<AgentsChatResponseDto>((resolve, reject) => {
        let stopStream: (() => void) | null = null
        let settled = false
        let resultReceived = false
        let keepStreamAfterSettled = false
        const pendingMediaKeys = new Set<string>()
        const terminalMediaResults: AgentsChatMediaResultStreamPayload[] = []
        let mediaContinuationQueued = false
        const scheduleCanvasToolSync = (payload: AgentsChatToolStreamPayload) => {
          const result = scheduleAiChatCanvasToolStreamSync({
            payload,
            expectedFlowId: requestFlowId,
            expectedProjectId: requestProjectId,
            queue: generatedAssetToolReloadQueueRef.current,
            contextLabel: 'immediate',
          })
          if (result.wroteCurrentFlowCanvas) {
            backendWroteCanvas = true
            appendCanvasMutationCreatedNodeIds(streamCreatedNodeIds, payload)
          }
        }
        const scheduleMediaResultSync = (payload: AgentsChatMediaResultStreamPayload) => {
          const result = scheduleAiChatCanvasMediaResultStreamSync({
            payload,
            expectedFlowId: requestFlowId,
            expectedProjectId: requestProjectId,
            queue: generatedAssetToolReloadQueueRef.current,
            contextLabel: 'immediate',
          })
          if (result.wroteCurrentFlowCanvas) backendWroteCanvas = true
        }
        const queueMediaContinuationIfReady = () => {
          if (!settled || pendingMediaKeys.size > 0 || terminalMediaResults.length === 0 || mediaContinuationQueued) return
          const runId = readLiveChatRunBySessionKey(requestSessionKey)?.runId || pendingId
          const continuation = buildMediaCompletionContinuationRequest({
            tabId: requestTabId,
            sessionKey: requestSessionKey,
            runId,
            results: terminalMediaResults,
          })
          if (!continuation) return
          if (queuedMediaContinuationKeysRef.current.has(continuation.key)) return
          queuedMediaContinuationKeysRef.current.add(continuation.key)
          mediaContinuationQueued = true
          setQueuedMediaContinuation(continuation)
        }

        const stopMediaTailIfComplete = () => {
          if (!settled || pendingMediaKeys.size > 0 || !stopStream) return
          stopStream()
          stopStream = null
          if (keepRunPointerForMediaTail) {
            clearActiveChatRunPointer(requestSessionKey)
            keepRunPointerForMediaTail = false
          }
        }

        const finalize = (resolver: () => void, options?: { keepStreamForMedia?: boolean }) => {
          if (settled) return
          settled = true
          keepStreamAfterSettled = options?.keepStreamForMedia === true
          activeStreamInterruptRef.current.delete(requestTabId)
          activeStreamDetachRef.current.delete(requestTabId)
          if (stopStream && options?.keepStreamForMedia !== true) stopStream()
          resolver()
        }

        activeStreamInterruptRef.current.set(requestTabId, () => {
          finalize(() => reject(new Error(CHAT_STREAM_ABORT_ERROR)))
        })
        activeStreamDetachRef.current.set(requestTabId, () => {
          finalize(() => reject(new Error(CHAT_STREAM_DETACHED_ERROR)))
        })

        void agentsChatStream(requestPayload, {
          onEvent: (event) => {
            if (settled && event.event !== 'media_result') return
            applyPendingMediaStreamEvent(pendingMediaKeys, event)
            recordLiveChatRunEvent(requestSessionKey, event)
            if (event.event === 'media_result') {
              if (event.data.pending !== true) terminalMediaResults.push(event.data)
              scheduleMediaResultSync(event.data)
              refreshMessageToolSnapshot(pendingId, requestSessionKey, requestTabId)
              queueMediaContinuationIfReady()
              stopMediaTailIfComplete()
              return
            }
            if (event.event === 'initial') {
              const durableRunId = String(event.data.runId || '').trim()
              if (durableRunId) {
                writeActiveChatRunPointer({
                  sessionKey: requestSessionKey,
                  runId: durableRunId,
                  userMessageId,
                  assistantMessageId: pendingId,
                  requestText,
                  displayText,
                  ...(requestProjectId ? { canvasProjectId: requestProjectId } : {}),
                  ...(requestFlowId ? { canvasFlowId: requestFlowId } : {}),
                  request: {
                    ...(requestProjectId ? { canvasProjectId: requestProjectId } : {}),
                    ...(requestFlowId ? { canvasFlowId: requestFlowId } : {}),
                    ...(requestSelectedCanvasNodeContext?.nodeId ? { canvasNodeId: requestSelectedCanvasNodeContext.nodeId } : {}),
                    ...(effectiveSkill?.key || effectiveSkill?.name
                      ? { skill: effectiveSkill.key || effectiveSkill.name }
                      : {}),
                  },
                  updatedAt: Date.now(),
                })
              }
              return
            }
            if (event.event === 'turn.started') {
              const turnId = readLiveChatRunBySessionKey(requestSessionKey)?.currentTurnId
              if (turnId) {
                setMessages((prev) =>
                  patchChatMessageById(prev, pendingId, (message) => {
                    const existing = Array.isArray(message.toolCallTurnIds) ? message.toolCallTurnIds : []
                    if (existing.includes(turnId)) return message
                    return { ...message, toolCallTurnIds: [...existing, turnId] }
                  }),
                  requestTabId,
                )
              }
              return
            }
            if (event.event === 'thinking') {
              return
            }
            if (event.event === 'tool') {
              const askUserPrompt = parseAskUserPromptFromToolEvent(event.data)
              if (askUserPrompt) {
                setMessages((prev) =>
                  patchChatMessageById(prev, pendingId, (message) => {
                    if (
                      message.askUserPrompt &&
                      message.askUserPrompt.toolCallId === askUserPrompt.toolCallId
                    ) {
                      return message
                    }
                    return { ...message, askUserPrompt }
                  }),
                  requestTabId,
                )
                return
              }
              scheduleCanvasToolSync(event.data)
              return
            }
            if (event.event === 'todo_list') {
              const todoItems = normalizeChatTodoItems(event.data.items)
              if (!todoItems.length) return
              setMessages((prev) =>
                patchChatMessageById(prev, pendingId, (message) => ({
                  ...message,
                  todoSnapshot: todoItems,
                })),
                requestTabId,
              )
              return
            }
            if (event.event === 'content') {
              const delta = String(event.data.delta || '')
              if (!delta) return
              streamedReply += delta
              return
            }
            if (event.event === 'result') {
              resultReceived = true
              resultEventSeq = event.seq
              keepRunPointerForMediaTail = pendingMediaKeys.size > 0
              finalize(() => resolve(event.data.response), {
                keepStreamForMedia: pendingMediaKeys.size > 0,
              })
              return
            }
            if (event.event === 'error') {
              errorEventSeq = event.seq
              finalize(() => reject(new Error(formatAgentsStreamErrorMessage(event.data))))
              return
            }
            if (event.event === 'done') {
              if (resultReceived) return
              const reason = String(event.data.reason || '').trim()
              const message =
                reason === 'error'
                  ? '对话流异常结束'
                  : '对话流已结束，但未返回最终结果'
              errorEventSeq = event.seq
              finalize(() => reject(new Error(message)))
            }
          },
          onError: (error) => {
            finalize(() => reject(error))
          },
        })
          .then((abort) => {
            if (settled) {
              if (keepStreamAfterSettled && pendingMediaKeys.size > 0) {
                stopStream = abort
              } else {
                abort()
                if (keepRunPointerForMediaTail) {
                  clearActiveChatRunPointer(requestSessionKey)
                  keepRunPointerForMediaTail = false
                }
              }
              return
            }
            stopStream = abort
          })
          .catch((error) => {
            finalize(() => reject(error instanceof Error ? error : new Error('对话流失败')))
          })
      })
      const rawReply = typeof resp?.text === 'string' ? resp.text.trim() : ''
      const { displayText: parsedReply, plan: canvasPlan } = parseCanvasPlanFromReply(rawReply)
      const hasWrongCanvasPlanTag = /<tcanvas_canvas_plan>/i.test(rawReply) || /tcanvas_canvas_plan/i.test(rawReply)
      const turnVerdict = readChatTurnVerdict(resp)
      const turnVerdictSummary = formatChatTurnVerdictSummary(resp)
      const failedTurn = isFailedChatTurn(resp)
      const failedTurnMessage = turnVerdictSummary || '结构失败：本轮没有形成有效结果'
      const missingCanvasPlan = shouldShowMissingCanvasPlanError({
        hasCanvasPlan: Boolean(canvasPlan),
        hasWrongCanvasPlanTag,
        response: resp,
      })
      const reply = parsedReply || rawReply || '（空响应）'
      const parsedAutoImages = extractCanvasAutoGeneratedImages(reply)
      const assistantAssetsRaw = normalizeAssistantAssets(resp.assets)
      const assistantAssets = mergeAssistantAssets(assistantAssetsRaw, parsedAutoImages)
      let canvasPlanExecuted = false
      let failedTurnHandled = false
      const durableRunId = readLiveChatRunBySessionKey(requestSessionKey)?.runId || pendingId
      const resultAlreadyApplied = hasAppliedChatRunResult({
        runId: durableRunId,
        responseId: resp.id,
      })
      if (canvasPlan && !resultAlreadyApplied) {
        setMessages((prev) =>
          patchChatMessageById(prev, pendingId, (message) => ({
            ...message,
            content: '正在应用节点方案',
          })),
          requestTabId,
        )
        try {
          const executed = await executeCanvasPlan(canvasPlan)
          canvasPlanExecuted = executed.createdNodeIds.length > 0
          if (!failedTurn && executed.createdNodeIds.length > 0) {
            autoRunAiChatCanvasNodes(executed.createdNodeIds, requestSessionKey)
          }
          const executedPrimaryNodeId = pickPrimaryCreationNodeId(
            executed.createdNodeIds.length > 0 ? executed.createdNodeIds : executed.resolvedNodeIds,
          )
          const saveProject = (window as Window & { silentSaveProject?: () => Promise<void> }).silentSaveProject
          if (typeof saveProject === 'function') {
            await saveProject()
          }
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : '执行画布计划失败'
          console.warn('[ai-chat] executeCanvasPlan failed', error)
          setMessages((prev) =>
            patchChatMessageById(prev, pendingId, (message) => ({
              ...message,
              content: `节点方案未能落地：${reason}`,
            })),
            requestTabId,
          )
        }
      } else if (missingCanvasPlan) {
        failedTurnHandled = true
      }
      if (failedTurn && !failedTurnHandled) failedTurnHandled = true
      // AI 写画布的收尾同步:
      //   步骤 1 — 增量删除永远先做(mid-stream UX 优化:删除立刻可见,与网络/落盘无关)。
      //   步骤 2 — stream 已处理当前 flow 写入时,不再在 final 阶段重复整图 reload。
      //   步骤 3 — 若没有 stream 写入证据,但最终 trace 表示后端写过画布,才用整图 reload 兜底。
      if (!resultAlreadyApplied && requestFlowId) {
        const traceMutation = resp.trace?.canvasMutation ?? null
        const rfStore = useRFStore.getState()
        applyTraceCanvasDeletions(traceMutation, {
          deleteNode: rfStore.deleteNode,
          deleteEdge: rfStore.deleteEdge,
        })
        if (backendWroteCanvas) {
          const reloadAutoRunPlan = resolveAiChatReloadAutoRunPlan({
            newNodeIds: uniqueNonEmptyNodeIds(streamCreatedNodeIds),
            traceCanvasMutation: traceMutation,
            failedTurn,
          })
          if (reloadAutoRunPlan.focusNodeIds.length > 0) {
            focusCanvasNodeAfterReload(reloadAutoRunPlan.focusNodeIds)
          }
          if (reloadAutoRunPlan.autoRunNewNodeIds.length > 0) {
            autoRunAiChatCanvasNodes(reloadAutoRunPlan.autoRunNewNodeIds, requestSessionKey)
          }
          if (reloadAutoRunPlan.autoRunPatchedNodeIds.length > 0) {
            autoRunAiChatPatchedCanvasNodes(reloadAutoRunPlan.autoRunPatchedNodeIds, requestSessionKey)
          }
        } else if (responseTraceIndicatesCanvasWrite(resp.trace)) {
          try {
            const reloaded = await reloadCanvasFlowFromServer({
              flowId: requestFlowId,
              expectedProjectId: requestProjectId,
              expectedFlowId: requestFlowId,
              preserveViewport: true,
            })
            if (reloaded.reloaded) {
              const reloadAutoRunPlan = resolveAiChatReloadAutoRunPlan({
                newNodeIds: reloaded.newNodeIds,
                traceCanvasMutation: traceMutation,
                failedTurn,
              })
              if (reloadAutoRunPlan.focusNodeIds.length > 0) {
                focusCanvasNodeAfterReload(reloadAutoRunPlan.focusNodeIds)
              }
              if (reloadAutoRunPlan.autoRunNewNodeIds.length > 0) {
                autoRunAiChatCanvasNodes(reloadAutoRunPlan.autoRunNewNodeIds, requestSessionKey)
              }
              if (reloadAutoRunPlan.autoRunPatchedNodeIds.length > 0) {
                autoRunAiChatPatchedCanvasNodes(reloadAutoRunPlan.autoRunPatchedNodeIds, requestSessionKey)
              }
            }
          } catch (error: unknown) {
            console.warn('[ai-chat] reload flow after backend canvas write failed', error)
            const notice = '画布同步失败,请手动刷新页面查看最新节点'
            setMessages((prev) =>
              patchChatMessageById(prev, pendingId, (message) => ({
                ...message,
                content: message.content ? `${message.content}\n\n${notice}` : notice,
              })),
              requestTabId,
            )
          }
        }
      }
      const shouldWatchAssets = shouldAutoAddAssistantAssetsToCanvas({
        canvasPlanExecuted,
        aiChatWatchAssetsEnabled,
        assistantAssetCount: assistantAssets.length,
        response: resp,
      })
      if (shouldWatchAssets && !resultAlreadyApplied) {
        setMessages((prev) =>
          patchChatMessageById(prev, pendingId, (message) => ({
            ...message,
            content: '正在整理最终结果',
          })),
          requestTabId,
        )
        addAssistantAssetsToCanvas(assistantAssets)
      }
      if (!resultAlreadyApplied) {
        markChatRunResultApplied({
          runId: durableRunId,
          responseId: resp.id,
        })
      }
      if (!streamedReply) {
        await animateAssistantReply(requestTabId, pendingId, reply || '（空响应）')
      }
      setMessages((prev) =>
        patchChatMessageById(prev, pendingId, (message) => ({
          ...message,
          content: reply || '（空响应）',
          assets: assistantAssets,
          ts: formatNowTime(),
          phase: 'final',
          kind: 'result',
          ...(Array.isArray(resp.trace?.todoList?.items)
            ? { todoSnapshot: normalizeChatTodoItems(resp.trace.todoList.items) }
            : null),
          ...(turnVerdict ? { turnVerdict } : null),
          ...(Array.isArray(resp.trace?.diagnosticFlags) ? { diagnosticFlags: resp.trace?.diagnosticFlags } : null),
          ...finalizeChatMessageToolState(message, requestSessionKey),
        })),
        requestTabId,
      )
      completeLiveChatRun(requestSessionKey, resp, reply || '（空响应）', resultEventSeq)
      if (!keepRunPointerForMediaTail) {
        clearActiveChatRunPointer(requestSessionKey)
      }
    } catch (err: unknown) {
      activeStreamInterruptRef.current.delete(requestTabId)
      activeStreamDetachRef.current.delete(requestTabId)
      if (isChatDetachError(err)) {
        return
      }
      const msg = err instanceof Error ? err.message : '对话失败'
      if (isChatAbortError(err)) {
        failLiveChatRun(requestSessionKey, CHAT_ABORTED_MESSAGE)
        clearActiveChatRunPointer(requestSessionKey)
        setMessages((prev) =>
          patchChatMessageById(prev, pendingId, (message) => ({
            ...message,
            content: CHAT_ABORTED_MESSAGE,
            phase: 'final',
            kind: 'error',
            ...finalizeChatMessageToolState(message, requestSessionKey, {
              finalizeUnresolved: {
                status: 'failed',
                message: CHAT_ABORTED_MESSAGE,
              },
            }),
          })),
          requestTabId,
        )
        return
      }
      failLiveChatRun(requestSessionKey, msg, errorEventSeq)
      clearActiveChatRunPointer(requestSessionKey)
      if (pendingId) {
        setMessages((prev) =>
          patchChatMessageById(prev, pendingId, (message) => ({
            ...message,
            content: `（错误）${msg}`,
            ts: formatNowTime(),
            phase: 'final',
            kind: 'error',
            ...finalizeChatMessageToolState(message, requestSessionKey, {
              finalizeUnresolved: {
                status: 'failed',
                message: msg,
              },
            }),
          })),
          requestTabId,
        )
      }
    } finally {
      activeStreamInterruptRef.current.delete(requestTabId)
      activeStreamDetachRef.current.delete(requestTabId)
      setSending(false)
      setSendingTabId(null)
    }
  }, [activeChatTab, activeSkill, activeTabId, aiChatWatchAssetsEnabled, animateAssistantReply, attachedDocs, chatSessionLane, completeLiveChatRun, currentFlowId, currentProjectId, currentProjectName, draft, failLiveChatRun, implicitSendRequest, isActiveTabSending, mode, pendingAskUser, recordLiveChatRunEvent, referenceImages, referenceMedia, refreshMessageToolSnapshot, reloadAgentSkill, replicateTargetImage, selectedCanvasNodeContext, startLiveChatRun, updateTabRuntime, uploadedReferenceAssetMeta])

  React.useEffect(() => {
    const continuation = queuedMediaContinuation
    if (!continuation || sending) return
    if (activeTabId !== continuation.tabId) return
    setQueuedMediaContinuation(null)
    void send({
      text: continuation.prompt,
      displayText: continuation.displayText,
      attachCanvasContext: true,
      skill: null,
    })
  }, [activeTabId, queuedMediaContinuation, send, sending])

  const createConversationTab = React.useCallback((input?: {
    skill?: ChatSelectableSkill | null
    showToast?: boolean
  }) => {
    const nextBaseKey = createAiChatSessionBaseKey()
    const nextTabId = `tab-${nextBaseKey}`
    const nextSkill = input && 'skill' in input ? input.skill ?? null : activeSkill
    historyLoadVersionRef.current += 1
    closedTabIdsRef.current.delete(nextTabId)
    clearCreationSession()
    setChatTabsState((prev) => addAiChatTab(prev, {
      createBaseKey: () => nextBaseKey,
      createTabId: () => nextTabId,
    }))
    setTabRuntimeById((prev) => ({
      ...prev,
      [nextTabId]: createEmptyChatTabRuntime(nextSkill),
    }))
    if (mode === 'compact') setMode('expanded')
    if (input?.showToast) toast('已开启新对话', 'success')
  }, [activeSkill, clearCreationSession, mode])

  const selectSkillById = React.useCallback((skillId: string) => {
    const id = String(skillId || '').trim()
    if (!id) return
    const skill = agentSkills.find((item) => item.id === id)
    if (!skill) {
      toast('暂无可用 Skill（请在后台设置为可见）', 'error')
      void reloadAgentSkill()
      return
    }

    const nextSkill = activeSkill?.id === id ? null : skill
    setActiveSkill(nextSkill)
  }, [activeSkill?.id, agentSkills, reloadAgentSkill, setActiveSkill])

  const clearSkill = React.useCallback(() => {
    setActiveSkill(null)
  }, [setActiveSkill])

  const startNewConversation = React.useCallback(() => {
    createConversationTab({ showToast: true })
  }, [createConversationTab])

  const selectConversationTab = React.useCallback((tabId: string) => {
    shouldAutoScrollRef.current = true
    setChatTabsState((prev) => selectAiChatTab(prev, tabId))
  }, [])

  React.useEffect(() => {
    const onNavigationCommand = (event: Event) => {
      const command = (event as CustomEvent<NativeChatNavigationCommand>).detail
      if (!command || command.projectId !== currentProjectId) {
        if (command?.type === 'select-session' && command.projectId) {
          const projectState = readAiChatTabsState(command.projectId)
          const next = selectAiChatTab(projectState, command.sessionId)
          writeAiChatTabsState(next, command.projectId)
          notifyNativeChatNavigationChanged(command.projectId)
        }
        return
      }
      if (command.type === 'new-session') {
        startNewConversation()
      } else {
        selectConversationTab(command.sessionId)
      }
    }
    window.addEventListener(NATIVE_CHAT_NAVIGATION_COMMAND, onNavigationCommand)
    return () => window.removeEventListener(NATIVE_CHAT_NAVIGATION_COMMAND, onNavigationCommand)
  }, [currentProjectId, selectConversationTab, startNewConversation])

  const closeConversationTab = React.useCallback((tabId: string) => {
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId) return
    const canCloseTab = chatTabsState.tabs.length > 1 && chatTabsState.tabs.some((tab) => tab.id === normalizedTabId)
    if (!canCloseTab) return
    const closingTab = chatTabsState.tabs.find((tab) => tab.id === normalizedTabId)
    const closingSessionKey = String(closingTab?.sessionKey || '').trim()
    closedTabIdsRef.current.add(normalizedTabId)
    const closingInterrupt = activeStreamInterruptRef.current.get(normalizedTabId)
    if (closingInterrupt) {
      activeStreamInterruptRef.current.delete(normalizedTabId)
      activeStreamDetachRef.current.delete(normalizedTabId)
      closingInterrupt()
    }
    const closingRecoveryInterrupt = recoveryStreamInterruptRef.current.get(normalizedTabId)
    if (closingRecoveryInterrupt) {
      recoveryStreamInterruptRef.current.delete(normalizedTabId)
      recoveryStreamDetachRef.current.delete(normalizedTabId)
      closingRecoveryInterrupt()
    }
    if (closingSessionKey) {
      const pointer = readActiveChatRunPointer(closingSessionKey)
      const runIdToAbort = String(pointer?.runId || '').trim()
      if (runIdToAbort) {
        void abortAgentsChatRun({ runId: runIdToAbort }).catch((err) => {
          console.warn('[ai-chat] abort run on close failed', err)
        })
      }
      clearActiveChatRunPointer(closingSessionKey)
    }
    historyLoadVersionRef.current += 1
    setChatTabsState((prev) => closeAiChatTab(prev, normalizedTabId))
    setTabRuntimeById((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, normalizedTabId)) return prev
      const next: Record<string, ChatTabRuntimeState> = {}
      for (const [key, value] of Object.entries(prev)) {
        if (key !== normalizedTabId) next[key] = value
      }
      return next
    })
  }, [chatTabsState.tabs])

  const applyAskUserOption = React.useCallback((option: string) => {
    const normalizedOption = String(option || '').trim()
    if (!normalizedOption) return
    const current = pendingAskUser
    if (!current) return
    const nextOption = current.selectedOption === normalizedOption ? '' : normalizedOption
    askUserSelectedOptionRef.current = nextOption
      ? { messageId: current.sourceMessageId, option: nextOption }
      : null
    setAskUserSelectedOptionVersion((v) => v + 1)
  }, [pendingAskUser])
  const pendingAskUserCard = pendingAskUser ? (
    <AskUserPendingCard
      pendingAskUser={pendingAskUser}
      layout={mode}
      disabled={isActiveTabSending}
      canContinue={canSendMessage}
      onSelectOption={applyAskUserOption}
      onSubmitOption={(option) => {
        const card = pendingAskUser.optionCards.find((item) => item.value === option)
        const displayValue = String(card?.displayValue || '').trim()
        void send({
          text: displayValue || option,
          ...(card ? { styleReferenceCard: card } : {}),
        })
      }}
      onContinue={() => {
        void send()
      }}
    />
  ) : null

  const isEmptyConversation = visibleMessages.length === 0 && !pendingAskUser
  const composerPlaceholder = pendingAskUser ? $('请输入对这个问题的回复') : $('请输入你的设计需求')
  const composerHintText = pendingAskUser
    ? $('选择一个答案，或输入自定义回复后继续')
    : isActiveTabSending
      ? $('对话中…点击右侧可中断')
      : $('仅支持点击发送，Enter 可换行')
  const sendActionLabel = pendingAskUser ? $('继续') : $('发送')
  const taskEntryLabel = $('Skills')
  const activeSkillMention = React.useMemo(() => {
    return formatSkillMention(activeSkill)
  }, [activeSkill])
  const renderInputSkillToken = React.useCallback(() => {
    if (!activeSkill || !activeSkillMention) return null
    return (
      <div className="tc-ai-chat__input-skill-row">
        <ChatTooltip className="tc-ai-chat__input-skill-tooltip" label={$('关闭当前能力')} withArrow>
          <button
            type="button"
            className="tc-ai-chat__input-skill-token"
            onClick={clearSkill}
            aria-label={$('关闭当前能力')}
          >
            <span className="tc-ai-chat__input-skill-name">{activeSkillMention}</span>
            <IconX className="tc-ai-chat__input-skill-clear-icon" size={12} />
          </button>
        </ChatTooltip>
      </div>
    )
  }, [activeSkill, activeSkillMention, clearSkill])

  const onRootKeyDownCapture = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    if (mode === 'maximized') {
      e.preventDefault()
      e.stopPropagation()
      toggleMaximized()
    }
  }, [mode, toggleMaximized])

  const onRootKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (mode !== 'maximized') return
    e.stopPropagation()
  }, [mode])

  const rootClassName = [
    'tc-ai-chat',
    `tc-ai-chat--${mode}`,
    dockRight ? 'tc-ai-chat--dock-right' : '',
    isDragOver ? 'tc-ai-chat--drag-over' : '',
    productMode ? 'tc-ai-chat--product-host' : '',
    className,
  ].filter(Boolean).join(' ')

  const auraClassName = [
    'tc-ai-chat__aura',
    mode === 'compact' ? 'tc-ai-chat__aura--compact' : '',
    mode === 'maximized' ? 'tc-ai-chat__aura--maximized' : '',
  ].filter(Boolean).join(' ')
  const composerShellClassName = [
    'tc-ai-chat__composer-shell',
    referenceMedia.length > 0 ? 'tc-ai-chat__composer-shell--with-refs' : '',
  ].filter(Boolean).join(' ')

  const attachMenu = (
    <Menu className="tc-ai-chat__attach-menu" position="top-start" zIndex={10050}>
      <Menu.Target>
        <AttachMenuTarget tooltip={$('添加参考素材（从画布选择或上传图片/文档）')} />
      </Menu.Target>
      <Menu.Dropdown className="tc-ai-chat__attach-dropdown">
        <Menu.Label className="tc-ai-chat__attach-label">{$('参考素材')}</Menu.Label>
        <Menu.Item
          className="tc-ai-chat__attach-item"
          leftSection={<IconPhoto className="tc-ai-chat__attach-item-icon" size={16} />}
          onClick={() => void addSelectedCanvasImagesAsReferences()}
          disabled={isActiveTabSending || refsLoading}
        >
          {$('使用画布选中图片')}
        </Menu.Item>
        <Menu.Item
          className="tc-ai-chat__attach-item"
          leftSection={<IconUpload className="tc-ai-chat__attach-item-icon" size={16} />}
          onClick={() => fileInputRef.current?.click()}
          disabled={isActiveTabSending || refsLoading}
        >
          {$('上传文件（图片 / TXT / Markdown / PDF）')}
        </Menu.Item>
        <Menu.Divider className="tc-ai-chat__attach-divider" />
        <Menu.Item
          className="tc-ai-chat__attach-item"
          leftSection={<IconTrash className="tc-ai-chat__attach-item-icon" size={16} />}
          onClick={() => {
            clearReferenceImages()
            clearAttachedDocs()
          }}
          disabled={isActiveTabSending || refsLoading || (referenceMedia.length === 0 && attachedDocs.length === 0)}
        >
          {$('清空参考素材')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )

  const taskEntryMenuButton = (
    <Menu
      className="tc-ai-chat__experience-menu"
      withinPortal
      position="top-start"
      shadow="md"
      zIndex={10050}
      onChange={(opened) => {
        if (opened) void reloadAgentSkill()
      }}
    >
      <Menu.Target>
        <ChatTooltip label={$('选择快捷任务或能力')} withArrow>
          <Button
            className="tc-ai-chat__experience-toggle"
            size="xs"
            radius="sm"
            variant="light"
            color={activeSkill ? 'blue' : 'gray'}
            rightSection={<IconChevronDown className="tc-ai-chat__experience-toggle-icon" size={14} />}
            disabled={agentLoading}
          >
            <IconBook2 className="tc-ai-chat__experience-toggle-spark" size={14} />
            {taskEntryLabel}
          </Button>
        </ChatTooltip>
      </Menu.Target>
      <Menu.Dropdown className="tc-ai-chat__experience-dropdown">
        <div className="tc-ai-chat__experience-skill-section">
          <ScrollArea.Autosize
            className="tc-ai-chat__experience-skills-scroll"
            type="auto"
            scrollbarSize={6}
            offsetScrollbars
          >
            <div className="tc-ai-chat__experience-skills-list">
              {agentSkills.map((skill) => {
                const selected = activeSkill?.id === skill.id
                return (
                  <Menu.Item
                    key={skill.id}
                    className="tc-ai-chat__experience-menu-item"
                    onClick={() => selectSkillById(skill.id)}
                    disabled={agentLoading}
                  >
                    <div className="tc-ai-chat__experience-menu-content">
                      <span className="tc-ai-chat__experience-menu-title">{selected ? `✓ ${skill.name || skill.key || '能力'}` : (skill.name || skill.key || '能力')}</span>
                      <span className="tc-ai-chat__experience-menu-description">{skill.description || $('启用后后续对话将优先按该能力处理')}</span>
                    </div>
                  </Menu.Item>
                )
              })}
              {agentSkillsError !== null ? (
                <Menu.Item
                  className="tc-ai-chat__experience-menu-item tc-ai-chat__experience-skill-error"
                  onClick={() => { void reloadAgentSkill() }}
                  disabled={agentLoading}
                  closeMenuOnClick={false}
                >
                  <div className="tc-ai-chat__experience-menu-content">
                    <span className="tc-ai-chat__experience-menu-title">
                      {agentSkillsError.kind === 'all'
                        ? $('能力加载失败 · 点击重试')
                        : `${agentSkillsError.count} ${$('个能力加载失败 · 点击重试')}`}
                    </span>
                  </div>
                </Menu.Item>
              ) : null}
            </div>
          </ScrollArea.Autosize>
        </div>
      </Menu.Dropdown>
    </Menu>
  )

  const panelFooterActions = (
    <Group className="tc-ai-chat__hint-actions" gap={4} align="center" wrap="nowrap">
      {showDebugTraceExport ? (
        <Button
          className="tc-ai-chat__debug-export-button"
          size="compact-xs"
          radius="sm"
          variant="light"
          leftSection={<IconDownload size={12} />}
          onClick={handleExportCurrentChatTrace}
        >
          导出轨迹
        </Button>
      ) : null}
      {!isMaximized && (
        <ChatTooltip label={$('收起')} withArrow>
          <ActionIcon className="tc-ai-chat__icon tc-ai-chat__hint-action" variant="subtle" aria-label="收起" onClick={collapseChat}>
            <IconChevronDown className="tc-ai-chat__icon-svg" size={16} />
          </ActionIcon>
        </ChatTooltip>
      )}
      <ChatTooltip label={mode === 'maximized' ? $('退出聚焦') : $('聚焦')} withArrow>
        <ActionIcon className="tc-ai-chat__icon tc-ai-chat__hint-action" variant="subtle" aria-label={mode === 'maximized' ? '退出聚焦' : '聚焦'} onClick={toggleMaximized}>
          {mode === 'maximized' ? (
            <IconArrowsMinimize className="tc-ai-chat__icon-svg" size={16} />
          ) : (
            <IconArrowsMaximize className="tc-ai-chat__icon-svg" size={16} />
          )}
        </ActionIcon>
      </ChatTooltip>
      {isMaximized && (
        <ChatTooltip label={$('关闭')} withArrow>
          <ActionIcon className="tc-ai-chat__icon tc-ai-chat__hint-action" variant="subtle" aria-label="关闭" onClick={collapseChat}>
            <IconX className="tc-ai-chat__icon-svg" size={16} />
          </ActionIcon>
        </ChatTooltip>
      )}
      <Badge className="tc-ai-chat__hint-badge" size="xs" radius="sm" variant="outline" color="gray">
        {activeSkill ? $('Agent') : $('Chat')}
      </Badge>
    </Group>
  )

  const handleRootDragEnter = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer) return
    const types = Array.from(e.dataTransfer.types || [])
    if (!types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current += 1
    setIsDragOver(true)
  }, [])

  const handleRootDragOver = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer) return
    const types = Array.from(e.dataTransfer.types || [])
    if (!types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleRootDragLeave = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer) return
    const types = Array.from(e.dataTransfer.types || [])
    if (!types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragOver(false)
  }, [])

  const handleRootDrop = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer) return
    const files = e.dataTransfer.files
    if (!files || !files.length) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = 0
    setIsDragOver(false)
    void onUploadReferenceFiles(files)
  }, [onUploadReferenceFiles])

  return (
    <div
      className={rootClassName}
      data-ux-floating
      onKeyDownCapture={onRootKeyDownCapture}
      onKeyDown={onRootKeyDown}
      onDragEnter={handleRootDragEnter}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
    >
      <input
        ref={fileInputRef}
        className="tc-ai-chat__file-input"
        type="file"
        accept="image/*,.txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf"
        multiple
        onChange={(e) => void onUploadReferenceFiles(e.currentTarget.files)}
      />
      <input
        ref={targetFileInputRef}
        className="tc-ai-chat__file-input tc-ai-chat__target-file-input"
        type="file"
        accept="image/*"
        onChange={(e) => void onUploadReplicateTargetFile(e.currentTarget.files)}
      />
      <Modal
        opened={replicatePickerOpened}
        onClose={() => setReplicatePickerOpened(false)}
        centered
        title={$('从画布中选择目标效果图')}
        size="lg"
      >
        <div className="tc-ai-chat__replicate-picker-grid">
          {canvasImageCandidates.map((item) => {
            const selected = replicateTargetImage === item.url
            return (
              <button
                key={`${item.id}_${item.url}`}
                type="button"
                className={`tc-ai-chat__replicate-picker-item${selected ? ' tc-ai-chat__replicate-picker-item--selected' : ''}`}
                onClick={() => void chooseReplicateTargetFromCanvas(item.url)}
              >
                <img className="tc-ai-chat__replicate-picker-thumb" src={item.url} alt={item.label} />
                <span className="tc-ai-chat__replicate-picker-label">{item.label}</span>
              </button>
            )
          })}
        </div>
      </Modal>
      {isMaximized && !productMode && (
        <div
          aria-hidden="true"
          className="tc-ai-chat__backdrop"
          onMouseDown={(e) => {
            e.preventDefault()
            toggleMaximized()
          }}
        />
      )}
      <div aria-hidden="true" className={auraClassName} />
      {mode === 'expanded' && (
        <div
          className="tc-ai-chat__resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={$('拖拽改变面板宽度')}
          onPointerDown={onResizeHandlePointerDown}
        />
      )}
      <Paper
        ref={cardRef}
        className={[
          'tc-ai-chat__card',
          showDockedBubble ? 'tc-ai-chat__card--bubble' : '',
        ].filter(Boolean).join(' ')}
        radius="sm"
        p={showDockedBubble ? 0 : isCompact ? 'sm' : 'md'}
      >
        {!showDockedBubble && (
          <button
            type="button"
            className="tc-ai-chat__handle"
            aria-label={$('展开对话')}
            title={$('点击展开')}
            onClick={expandChat}
          >
            <span className="tc-ai-chat__handle-pill" />
          </button>
        )}

        {isCompact ? (
          <>
            {showDockedBubble ? (
              <ChatTooltip label={isActiveTabSending ? $('AI 对话中…点击展开') : $('展开 AI 对话')} withArrow position="left">
                <button
                  type="button"
                  className="tc-ai-chat__bubble-button"
                  aria-label={$('展开 AI 对话')}
                  onClick={expandChat}
                >
                  <span className="tc-ai-chat__bubble-core">
                    <img className="tc-ai-chat__bubble-logo" src="/logo.png" alt="" aria-hidden="true" />
                    {isActiveTabSending && <span className="tc-ai-chat__bubble-status" aria-hidden="true" />}
                  </span>
                </button>
              </ChatTooltip>
            ) : (
              <>
                {pendingAskUserCard}
                <ReferenceMediaStrip
                  className={pendingAskUser ? undefined : 'tc-ai-chat__refs--compact-corner'}
                  items={referenceMedia}
                  onClear={clearReferenceImages}
                  disabled={isActiveTabSending || refsLoading}
                />
                <AttachedDocsStrip
                  docs={attachedDocs}
                  onRemove={removeAttachedDoc}
                  disabled={isActiveTabSending || refsLoading}
                />
                <Group
                  className="tc-ai-chat__compact-row"
                  justify="space-between"
                  align="center"
                  gap={10}
                  wrap="nowrap"
                  mt={referenceMedia.length > 0 && !pendingAskUser ? 50 : 0}
                >
                  <button
                    type="button"
                    className="tc-ai-chat__title-button"
                    aria-label={$('展开对话')}
                    onClick={expandChat}
                  >
                    <Group className="tc-ai-chat__title-group tc-ai-chat__compact-left" gap={10} align="center" wrap="nowrap">
                      <img className="tc-ai-chat__title-logo" src="/logo.png" alt="" aria-hidden="true" />
                      <Text className="tc-ai-chat__title" size="sm" fw={700}>
                        {$('AI 对话')}
                      </Text>
                    </Group>
                  </button>

                  <div className={composerShellClassName}>
                    <PanelCard className="tc-ai-chat__compact-composer tc-ai-chat__composer" padding="compact">
                      <Group className="tc-ai-chat__composer-row" gap={10} align="center" wrap="nowrap">
                        <div className="tc-ai-chat__composer-tools">
                          {attachMenu}
                          {taskEntryMenuButton}
                        </div>

                        <div className="tc-ai-chat__input-slot">
                          {renderInputSkillToken()}
                          <Textarea
                            ref={compactInputRef}
                            className="tc-ai-chat__input"
                            autosize
                            minRows={1}
                            maxRows={4}
                            placeholder={composerPlaceholder}
                            value={draft}
                            onChange={(e) => setDraft(e.currentTarget.value)}
                            onFocus={() => {
                              if (mode !== 'compact') return
                              setMode('expanded')
                            }}
                          />
                        </div>

                        <div className="tc-ai-chat__composer-actions">
                          <ChatTooltip label={isActiveTabSending ? $('中断') : sendActionLabel} withArrow>
                            <ActionIcon
                              className="tc-ai-chat__send"
                              variant="light"
                              color={isActiveTabSending ? 'red' : undefined}
                              aria-label={isActiveTabSending ? '中断' : sendActionLabel}
                              onClick={isActiveTabSending ? interruptActiveChat : () => void send()}
                              disabled={isActiveTabSending ? false : !canSendMessage}
                            >
                              {isActiveTabSending ? <IconX className="tc-ai-chat__send-icon" size={18} /> : <IconSend2 className="tc-ai-chat__send-icon" size={18} />}
                            </ActionIcon>
                          </ChatTooltip>
                        </div>
                      </Group>
                    </PanelCard>
                  </div>

                  <Group className="tc-ai-chat__compact-right" gap={6} align="center" wrap="nowrap">
                    {showDebugTraceExport ? (
                      <Button
                        className="tc-ai-chat__debug-export-button"
                        size="compact-xs"
                        radius="sm"
                        variant="light"
                        leftSection={<IconDownload size={12} />}
                        onClick={handleExportCurrentChatTrace}
                      >
                        导出轨迹
                      </Button>
                    ) : null}
                    <ChatTooltip label={$('开启新对话')} withArrow>
                      <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="开启新对话" onClick={startNewConversation}>
                        <IconMessagePlus className="tc-ai-chat__icon-svg" size={16} />
                      </ActionIcon>
                    </ChatTooltip>
                    <ChatTooltip label={$('展开')} withArrow>
                      <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="展开" onClick={expandChat}>
                        <IconChevronUp className="tc-ai-chat__icon-svg" size={16} />
                      </ActionIcon>
                    </ChatTooltip>
                    <ChatTooltip label={$('聚焦')} withArrow>
                      <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="聚焦" onClick={toggleMaximized}>
                        <IconArrowsMaximize className="tc-ai-chat__icon-svg" size={16} />
                      </ActionIcon>
                    </ChatTooltip>
                  </Group>
                </Group>
              </>
            )}
          </>
        ) : (
          <>
            <AiChatTabBar
              tabs={chatTabsState.tabs}
              activeTabId={chatTabsState.activeTabId}
              sendingTabId={effectiveSendingTabId}
              floatingZIndex={AI_CHAT_FLOATING_Z_INDEX}
              onSelectTab={selectConversationTab}
              onAddTab={startNewConversation}
              onCloseTab={closeConversationTab}
            />

            <div className="tc-ai-chat__body">
              {canShowHistory && historyLoadError ? (
                <Text className="tc-ai-chat__history-load-error" size="xs" c="red">
                  {historyLoadError}
                </Text>
              ) : null}
              <SubagentProgressStrip run={activeLiveRun} />
              {canShowHistory && !isEmptyConversation && (
                useScrollableHistory ? (
                  <ScrollArea className="tc-ai-chat__messages-scroll" viewportRef={viewportRef} type="auto" scrollbarSize={8}>
                    <Stack ref={messagesContentRef} className="tc-ai-chat__messages" gap={10}>
                      {mergedGroups.map((group) =>
                        group.kind === 'single' ? (
                          <ChatBubble
                            key={group.message.id}
                            message={group.message}
                            activeRun={activeLiveRun}
                            sessionKey={effectiveChatSessionKey}
                            askUserAnswered={answeredAskUserMessageIds.has(group.message.id)}
                          />
                        ) : (
                          <MergedAskUserBubble
                            key={group.askMessage.id}
                            group={group}
                            activeRun={activeLiveRun}
                            sessionKey={effectiveChatSessionKey}
                          />
                        ),
                      )}
                    </Stack>
                  </ScrollArea>
                ) : (
                  <Stack ref={messagesContentRef} className="tc-ai-chat__messages tc-ai-chat__messages--expanded" gap={10}>
                    {mergedGroups.map((group) =>
                      group.kind === 'single' ? (
                        <ChatBubble
                          key={group.message.id}
                          message={group.message}
                          activeRun={activeLiveRun}
                          sessionKey={effectiveChatSessionKey}
                          askUserAnswered={answeredAskUserMessageIds.has(group.message.id)}
                        />
                      ) : (
                        <MergedAskUserBubble
                          key={group.askMessage.id}
                          group={group}
                          activeRun={activeLiveRun}
                          sessionKey={effectiveChatSessionKey}
                        />
                      ),
                    )}
                  </Stack>
                )
              )}

            </div>

            {pendingAskUserCard ? (
              <div className="tc-ai-chat__pending-decision">
                {pendingAskUserCard}
              </div>
            ) : null}

            <div className={composerShellClassName}>
              <ReferenceMediaStrip items={referenceMedia} onClear={clearReferenceImages} disabled={isActiveTabSending || refsLoading} />
              <AttachedDocsStrip
                docs={attachedDocs}
                onRemove={removeAttachedDoc}
                disabled={isActiveTabSending || refsLoading}
              />
              <PanelCard className="tc-ai-chat__composer" padding="compact">
                {showProjectTextMaterialHint ? (
                  <Text className="tc-ai-chat__creation-warning" size="xs" c="yellow" mb={8}>
                    当前项目检测到 {projectTextMaterialState.count} 个文本素材。AI 对话不会因此被拦截；如果你希望基于某一份文本继续，优先在消息里说明书名/章节，或先选中关联节点。
                  </Text>
                ) : null}
                {currentProjectId && projectTextMaterialState.status === 'failed' ? (
                  <Text className="tc-ai-chat__creation-warning" size="xs" c="red" mb={8}>
                    {projectTextMaterialState.error || '项目文本素材状态读取失败'}
                  </Text>
                ) : null}
                <Group className="tc-ai-chat__composer-row" gap={10} align="flex-end" wrap="nowrap">
                  <div className="tc-ai-chat__composer-tools">
                    {attachMenu}
                    {taskEntryMenuButton}
                  </div>

                  <div className="tc-ai-chat__input-slot">
                    {renderInputSkillToken()}
                    <Textarea
                      ref={expandedInputRef}
                      className="tc-ai-chat__input"
                      autosize
                      minRows={2}
                      maxRows={6}
                      placeholder={composerPlaceholder}
                      value={draft}
                      onChange={(e) => setDraft(e.currentTarget.value)}
                    />
                  </div>

                  <div className="tc-ai-chat__composer-actions">
                    <ChatTooltip label={isActiveTabSending ? $('中断') : sendActionLabel} withArrow>
                      <ActionIcon
                        className="tc-ai-chat__send"
                        variant="light"
                        color={isActiveTabSending ? 'red' : undefined}
                        aria-label={isActiveTabSending ? '中断' : sendActionLabel}
                        onClick={isActiveTabSending ? interruptActiveChat : () => void send()}
                        disabled={isActiveTabSending ? false : !canSendMessage}
                      >
                        {isActiveTabSending ? <IconX className="tc-ai-chat__send-icon" size={18} /> : <IconSend2 className="tc-ai-chat__send-icon" size={18} />}
                      </ActionIcon>
                    </ChatTooltip>
                  </div>
                </Group>

                <Group className="tc-ai-chat__hint" justify="space-between" align="center" gap={10} mt={8} wrap="nowrap">
                  <Text className="tc-ai-chat__hint-text" size="xs" c="dimmed" lineClamp={1}>
                    {composerHintText}
                  </Text>
                  {panelFooterActions}
                </Group>
              </PanelCard>
            </div>
          </>
        )}
      </Paper>
    </div>
  )
}
