import { create } from 'zustand'
import type { ChatAssetInput } from './chatRequestPayload'

export type AiChatExternalRequest = {
  id: string
  text: string
  displayText?: string
  skillKey?: string
  attachCanvasContext?: boolean
  extraReferenceImages?: string[]
  extraAssetInputs?: ChatAssetInput[]
}

type EnqueueAiChatExternalRequestInput = Omit<AiChatExternalRequest, 'id'>

type AiChatExternalRequestStore = {
  pendingRequest: AiChatExternalRequest | null
  enqueueRequest: (input: EnqueueAiChatExternalRequestInput) => string
  consumeRequest: (id: string) => void
  clearRequest: () => void
}

function createRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // ignore
  }
  return `ai-chat-request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeUrlList(input: readonly string[] | undefined): string[] | undefined {
  if (!Array.isArray(input)) return undefined
  const next: string[] = []
  const seen = new Set<string>()
  input.forEach((item) => {
    const normalized = String(item || '').trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    next.push(normalized)
  })
  return next.length > 0 ? next : undefined
}

export const useAiChatExternalRequestStore = create<AiChatExternalRequestStore>((set) => ({
  pendingRequest: null,
  enqueueRequest: (input) => {
    const text = String(input.text || '').trim()
    if (!text) return ''
    const id = createRequestId()
    const normalizedReferenceImages = normalizeUrlList(input.extraReferenceImages)
    set({
      pendingRequest: {
        id,
        text,
        ...(typeof input.displayText === 'string' && input.displayText.trim()
          ? { displayText: input.displayText.trim() }
          : {}),
        ...(typeof input.skillKey === 'string' && input.skillKey.trim()
          ? { skillKey: input.skillKey.trim() }
          : {}),
        ...(input.attachCanvasContext === true ? { attachCanvasContext: true } : {}),
        ...(normalizedReferenceImages ? { extraReferenceImages: normalizedReferenceImages } : {}),
        ...(Array.isArray(input.extraAssetInputs) && input.extraAssetInputs.length > 0
          ? { extraAssetInputs: input.extraAssetInputs }
          : {}),
      },
    })
    return id
  },
  consumeRequest: (id) => set((state) => {
    if (!state.pendingRequest || state.pendingRequest.id !== id) return {}
    return { pendingRequest: null }
  }),
  clearRequest: () => set({ pendingRequest: null }),
}))
