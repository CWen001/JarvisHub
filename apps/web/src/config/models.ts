/**
 * 模型配置 - 与TaskNode保持一致
 */
import { isAnthropicModel } from './modelSource'

export interface ModelOption {
  value: string
  label: string
  vendor?: string
  modelKey?: string
  modelAlias?: string | null
  meta?: unknown
}

export const TEXT_MODELS: ModelOption[] = []

const DEFAULT_IMAGE_MODEL_VALUE = ''
const DEFAULT_IMAGE_EDIT_MODEL_VALUE = ''

export const IMAGE_MODELS: ModelOption[] = []

export const VIDEO_MODELS: ModelOption[] = []

export type NodeKind =
  | 'text'
  | 'image'
  | 'imageEdit'
  | 'imageFission'
  | 'mosaic'
  | 'video'
  | 'composeVideo'
  | 'audio'
  | 'subtitle'
  | 'character'

export function getAllowedModelsByKind(kind?: NodeKind): ModelOption[] {
  switch (kind) {
    case 'image':
    case 'imageEdit':
    case 'imageFission':
    case 'mosaic':
      return IMAGE_MODELS
    case 'video':
    case 'composeVideo':
      return VIDEO_MODELS
    case 'character':
    case 'text':
    default:
      return TEXT_MODELS
  }
}

export function getModelLabel(kind: NodeKind | undefined, modelValue: string): string {
  const models = getAllowedModelsByKind(kind)
  const model = models.find(m => m.value === modelValue)
  return model?.label || modelValue
}

export function getDefaultModel(kind?: NodeKind): string {
  if (kind === 'image') {
    return DEFAULT_IMAGE_MODEL_VALUE
  }
  if (kind === 'imageEdit') {
    return DEFAULT_IMAGE_EDIT_MODEL_VALUE
  }
  if (kind === 'video') {
    return ''
  }
  const models = getAllowedModelsByKind(kind)
  return models[0]?.value || ''
}

// Provider映射
export type AIProvider = 'openai' | 'anthropic' | 'google'

export const MODEL_PROVIDER_MAP: Record<string, AIProvider> = {
  'gpt-5.2': 'openai',
  'gpt-5.1': 'openai',
  'gpt-5.1-codex': 'openai',
  'glm-4.6': 'anthropic',
  'glm-4.5': 'anthropic',
  'glm-4.5-air': 'anthropic',
  'gemini-2.5-flash': 'google',
  'gemini-2.5-flash-lite': 'google',
  'gemini-2.5-flash-think': 'google',
  'gemini-2.5-pro': 'google',
  'gemini-3-pro': 'google',
  'models/gemini-3-pro-preview': 'google',
  'qwen-image-plus': 'openai', // 假设使用OpenAI
  'gemini-2.5-flash-image': 'google',
  'nano-banana': 'google',
  'nano-banana-fast': 'google',
  'nano-banana-pro': 'google',
  'gemini-3.1-flash-image-preview': 'google',
  'veo3.1-pro': 'google',
  'veo3.1-fast': 'google',
}

const IMAGE_EDIT_MODELS = new Set([
  'nano-banana',
  'nano-banana-pro',
  'gemini-2.5-flash-image-landscape',
  'gemini-2.5-flash-image-portrait',
  'gemini-3.0-pro-image-landscape',
  'gemini-3.0-pro-image-portrait',
  'imagen-4.0-generate-preview-landscape',
  'imagen-4.0-generate-preview-portrait',
])

const normalizeModelId = (value: string | undefined | null): string => {
  if (!value) return ''
  return value.startsWith('models/') ? value.slice(7) : value
}

export function isImageEditModel(modelValue?: string | null): boolean {
  const normalized = normalizeModelId(modelValue || '')
  return normalized ? IMAGE_EDIT_MODELS.has(normalized) : false
}

export function getModelProvider(modelValue: string): AIProvider {
  if (MODEL_PROVIDER_MAP[modelValue]) return MODEL_PROVIDER_MAP[modelValue]
  const lower = modelValue.toLowerCase()
  // 动态列表（/v1/models）返回的ID会被标记
  if (isAnthropicModel(modelValue)) return 'anthropic'
  if (lower.includes('claude') || lower.includes('glm')) return 'anthropic'
  if (lower.includes('gemini')) return 'google'
  if (lower.includes('gpt') || lower.includes('openai') || lower.includes('o3-')) return 'openai'
  if (lower.includes('qwen')) return 'openai'
  return 'google'
}
