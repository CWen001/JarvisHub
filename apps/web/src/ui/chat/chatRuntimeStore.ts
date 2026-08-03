import { create } from 'zustand'
import type {
  AgentSkillDto,
  RuntimeAgentSkillDto,
} from '../../api/server'
import type { ChatSessionLane } from './chatSessionKey'
import type { AttachedDoc } from './attachedDocs'
import type { ChatAskUserPrompt } from './askUserPrompt'
import type {
  ChatMessageAgentTraceSnapshot,
  ChatMessageToolCallSnapshot,
} from './chatMessageState'
import type { ChatTodoItem } from './chatTodoTypes'

export type ChatRole = 'assistant' | 'user'

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  ts: string
  phase?: 'thinking' | 'final'
  kind?: 'progress' | 'result' | 'error'
  assets?: Array<{
    title: string
    url: string
    thumbnailUrl?: string
    mediaType?: 'image' | 'video'
    assetId?: string
    assetRefId?: string
    nodeId?: string
  }>
  turnVerdict?: {
    status: 'satisfied' | 'partial' | 'failed'
    reasons: string[]
  }
  diagnosticFlags?: Array<{
    code: string
    severity: 'high' | 'medium'
    title: string
    detail: string
  }>
  askUserPrompt?: ChatAskUserPrompt
  todoSnapshot?: ChatTodoItem[]
  toolCallTurnIds?: string[]
  toolCallSnapshot?: ChatMessageToolCallSnapshot
  agentTraceSnapshot?: ChatMessageAgentTraceSnapshot
  skillMention?: string
}

export type UploadedReferenceAssetMeta = {
  assetId?: string
  assetRefId?: string
  name?: string
}

export type ChatSelectableSkill = AgentSkillDto | RuntimeAgentSkillDto

export type ChatTabRuntimeState = {
  draft: string
  messages: ChatMessage[]
  replicateTargetImage: string
  activeSkill: ChatSelectableSkill | null
  chatSessionLane: ChatSessionLane
  historyLoadError: string
  manualReferenceImages: string[]
  hiddenAutoReferenceUrls: string[]
  hiddenAutoReferenceVideoUrls: string[]
  uploadedReferenceAssetMeta: Record<string, UploadedReferenceAssetMeta>
  attachedDocs: AttachedDoc[]
}

export function createEmptyChatTabRuntime(activeSkill: ChatSelectableSkill | null = null): ChatTabRuntimeState {
  return {
    draft: '',
    messages: [],
    replicateTargetImage: '',
    activeSkill,
    chatSessionLane: 'general',
    historyLoadError: '',
    manualReferenceImages: [],
    hiddenAutoReferenceUrls: [],
    hiddenAutoReferenceVideoUrls: [],
    uploadedReferenceAssetMeta: {},
    attachedDocs: [],
  }
}

type ChatRuntimeById = Record<string, ChatTabRuntimeState>
type ChatRuntimeSetter = ChatRuntimeById | ((prev: ChatRuntimeById) => ChatRuntimeById)

type AiChatRuntimeStore = {
  tabRuntimeById: ChatRuntimeById
  setTabRuntimeById: (next: ChatRuntimeSetter) => void
  updateTabRuntime: (
    tabId: string,
    updater: (current: ChatTabRuntimeState) => ChatTabRuntimeState,
  ) => void
  clearTabRuntime: (tabId: string) => void
  clearAll: () => void
}

export const useAiChatRuntimeStore = create<AiChatRuntimeStore>((set) => ({
  tabRuntimeById: {},
  setTabRuntimeById: (next) => {
    set((state) => ({
      tabRuntimeById: typeof next === 'function' ? next(state.tabRuntimeById) : next,
    }))
  },
  updateTabRuntime: (tabId, updater) => {
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId) return
    set((state) => {
      const current = state.tabRuntimeById[normalizedTabId] || createEmptyChatTabRuntime()
      const next = updater(current)
      if (next === current) return state
      return {
        tabRuntimeById: {
          ...state.tabRuntimeById,
          [normalizedTabId]: next,
        },
      }
    })
  },
  clearTabRuntime: (tabId) => {
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId) return
    set((state) => {
      if (!Object.prototype.hasOwnProperty.call(state.tabRuntimeById, normalizedTabId)) return state
      const next: ChatRuntimeById = {}
      for (const [key, value] of Object.entries(state.tabRuntimeById)) {
        if (key !== normalizedTabId) next[key] = value
      }
      return { tabRuntimeById: next }
    })
  },
  clearAll: () => {
    set({ tabRuntimeById: {} })
  },
}))

export function clearAiChatRuntimeState(): void {
  useAiChatRuntimeStore.getState().clearAll()
}
