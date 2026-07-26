import React from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  Paper,
  PasswordInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
  IconArrowsSort,
  IconCheck,
  IconKey,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconSearch,
  IconSettings,
  IconTrash,
  IconVideo,
} from '@tabler/icons-react'
import {
  deleteModelConfigDefaultModel,
  deleteModelCatalogVendor,
  deleteModelConfigModel,
  getModelConfig,
  upsertModelConfigDefaultModel,
  upsertModelConfigModel,
  upsertModelConfigProvider,
  upsertModelConfigProviderApiKey,
  type ModelCatalogModelKind,
  type ModelConfigApiProtocol,
  type ModelConfigAuthType,
  type ModelConfigDefaultModelDto,
  type ModelConfigDefaultSlot,
  type ModelConfigDto,
  type ModelConfigModelDto,
  type ModelConfigProviderDto,
} from '../api/server'
import { SLOT_LABEL } from './modelPanel/slotStatus'
import { detectCascadeSelfHeal } from './modelPanel/useUndoableSlotChange'
import { useUIStore } from './uiStore'

type PanelTab = 'image' | 'video' | 'agent' | 'critic'
type PanelMode = 'select' | 'add'
type ProviderPresetGroup = 'media' | 'agent' | 'critic'

type PresetModel = {
  modelKey: string
  modelAlias?: string | null
  label: string
  kind: ModelCatalogModelKind
  enabled?: boolean
  options?: unknown
  meta?: unknown
}

type ProviderPreset = {
  id: string
  group: ProviderPresetGroup
  providerKey: string
  providerName: string
  tagline: string
  description: string
  baseUrl: string
  authType: ModelConfigAuthType
  authHeader?: string | null
  authQueryParam?: string | null
  apiProtocol?: ModelConfigApiProtocol | null
  disabledReason?: string | null
  capabilityNote?: string | null
  apiKeyPlaceholder: string
  models: PresetModel[]
  recommendedDefaults: Array<{ slot: ModelConfigDefaultSlot; modelKey: string }>
}

type DraftModel = {
  id: string
  modelKey: string
  modelAlias?: string | null
  label: string
  kind: ModelCatalogModelKind
  enabled: boolean
  options?: unknown
  meta?: unknown
}

const TAB_OPTIONS = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'agent', label: 'Agent' },
  { value: 'critic', label: 'Critic' },
]

const MODE_OPTIONS = [
  { value: 'select', label: '选择' },
  { value: 'add', label: '添加' },
]

const PANEL_MAX_WIDTH = 760
const MODEL_PANEL_FLOATING_Z_INDEX = 1500
const EMPTY_DEFAULTS: ModelConfigDefaultModelDto[] = []
const NATIVE_VIDEO_API_PROTOCOLS = new Set<ModelConfigApiProtocol>([
  'google-v1beta',
])

const DEFAULT_PROVIDER_PRESET_IDS = new Set([
  'media-apimart',
  'media-rightcode-draw',
  'media-seedance-ark',
  'agent-rightcode',
  'agent-openai',
  'agent-anthropic',
  'agent-google',
  'critic-rightcode',
  'critic-openai',
  'critic-anthropic',
  'critic-google',
])

const AUTH_TYPE_OPTIONS: Array<{ value: ModelConfigAuthType; label: string }> = [
  { value: 'bearer', label: 'Bearer' },
  { value: 'x-api-key', label: 'X-API-Key' },
  { value: 'query', label: 'Query' },
  { value: 'none', label: 'None' },
]

const API_PROTOCOL_OPTIONS: Array<{ value: ModelConfigApiProtocol; label: string }> = [
  { value: 'openai-chat', label: 'OpenAI Chat' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'google-v1beta', label: 'Google Gemini' },
  { value: 'anthropic-messages', label: 'Anthropic Claude' },
]

type AgentModelPreset = {
  modelKey: string
  modelLabel: string
}

const AGENT_PROVIDER_PRESETS: Array<{
  providerKey: string
  providerName: string
  tagline: string
  description: string
  baseUrl: string
  authType: ModelConfigAuthType
  authHeader?: string | null
  authQueryParam?: string | null
  apiProtocol?: ModelConfigApiProtocol | null
  disabledReason?: string | null
  models: AgentModelPreset[]
}> = [
  {
    providerKey: 'rightcode',
    providerName: 'RightCode',
    tagline: 'OpenAI 兼容聚合',
    description: '通过 right.codes 以 OpenAI Chat 协议统一调用 GPT / Claude 等模型。',
    baseUrl: 'https://right.codes/codex/v1',
    authType: 'bearer',
    authHeader: 'Authorization',
    apiProtocol: 'openai-chat',
    models: [
      { modelKey: 'gpt-5.5', modelLabel: 'GPT-5.5' },
    ],
  },
  {
    providerKey: 'openai',
    providerName: 'OpenAI',
    tagline: '官方 OpenAI',
    description: '适合直接使用 OpenAI Chat/Responses。API Key 一次填好即可。',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    authHeader: 'Authorization',
    apiProtocol: 'openai-responses',
    models: [
      { modelKey: 'gpt-5.5', modelLabel: 'GPT-5.5' },
      { modelKey: 'gpt-5.3-codex', modelLabel: 'GPT-5.3 Codex' },
      { modelKey: 'gpt-5.2', modelLabel: 'GPT-5.2' },
      { modelKey: 'gpt-5.2-codex', modelLabel: 'GPT-5.2 Codex' },
      { modelKey: 'gpt-4.1', modelLabel: 'GPT-4.1' },
    ],
  },
  {
    providerKey: 'anthropic',
    providerName: 'Anthropic',
    tagline: 'Claude 系列',
    description: '适合使用 Claude 官方 Messages API。',
    baseUrl: 'https://api.anthropic.com/v1',
    authType: 'x-api-key',
    authHeader: 'x-api-key',
    apiProtocol: 'anthropic-messages',
    models: [
      { modelKey: 'claude-sonnet-5', modelLabel: 'Claude Sonnet 5' },
      { modelKey: 'claude-opus-4-8', modelLabel: 'Claude Opus 4.8' },
      { modelKey: 'claude-haiku-4-5', modelLabel: 'Claude Haiku 4.5' },
      { modelKey: 'claude-sonnet-4-20250514', modelLabel: 'Claude Sonnet 4' },
    ],
  },
  {
    providerKey: 'google',
    providerName: 'Google',
    tagline: 'Gemini',
    description: '适合 Gemini 兼容服务。',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authType: 'x-api-key',
    authHeader: 'x-goog-api-key',
    apiProtocol: 'google-v1beta',
    models: [
      { modelKey: 'gemini-3.5-flash', modelLabel: 'Gemini 3.5 Flash' },
      { modelKey: 'gemini-2.5-pro', modelLabel: 'Gemini 2.5 Pro' },
      { modelKey: 'gemini-2.5-flash', modelLabel: 'Gemini 2.5 Flash' },
    ],
  },
  {
    providerKey: 'openrouter',
    providerName: 'OpenRouter',
    tagline: '统一聚合',
    description: '适合通过 OpenRouter 统一切换多家模型。',
    baseUrl: 'https://openrouter.ai/api/v1',
    authType: 'bearer',
    authHeader: 'Authorization',
    apiProtocol: 'openai-chat',
    models: [
      { modelKey: 'anthropic/claude-sonnet-5', modelLabel: 'Claude Sonnet 5' },
      { modelKey: 'anthropic/claude-opus-4-8', modelLabel: 'Claude Opus 4.8' },
      { modelKey: 'openai/gpt-5.5', modelLabel: 'GPT-5.5' },
      { modelKey: 'google/gemini-3.5-flash', modelLabel: 'Gemini 3.5 Flash' },
      { modelKey: 'qwen/qwen3-coder-480b', modelLabel: 'Qwen3 Coder 480B' },
    ],
  },
  {
    providerKey: 'deepseek',
    providerName: 'DeepSeek',
    tagline: '推理 / 代码',
    description: '适合 DeepSeek 兼容服务。',
    baseUrl: 'https://api.deepseek.com',
    authType: 'bearer',
    authHeader: 'Authorization',
    apiProtocol: 'openai-chat',
    models: [
      { modelKey: 'deepseek-v4-flash', modelLabel: 'DeepSeek V4 Flash' },
      { modelKey: 'deepseek-v4-pro', modelLabel: 'DeepSeek V4 Pro' },
      { modelKey: 'deepseek-chat', modelLabel: 'DeepSeek Chat' },
    ],
  },
  {
    providerKey: 'xai',
    providerName: 'xAI',
    tagline: 'Grok',
    description: '适合 Grok / xAI 服务。',
    baseUrl: 'https://api.x.ai/v1',
    authType: 'bearer',
    authHeader: 'Authorization',
    apiProtocol: 'openai-chat',
    models: [
      { modelKey: 'grok-4', modelLabel: 'Grok 4' },
      { modelKey: 'grok-3', modelLabel: 'Grok 3' },
    ],
  },
  {
    providerKey: 'mistral',
    providerName: 'Mistral',
    tagline: '欧系模型',
    description: '适合 Mistral 官方或兼容服务。',
    baseUrl: 'https://api.mistral.ai/v1',
    authType: 'bearer',
    authHeader: 'Authorization',
    apiProtocol: 'openai-chat',
    models: [
      { modelKey: 'mistral-large-latest', modelLabel: 'Mistral Large' },
      { modelKey: 'codestral-latest', modelLabel: 'Codestral' },
    ],
  },
  {
    providerKey: 'moonshot',
    providerName: 'Moonshot',
    tagline: 'Kimi',
    description: '适合 Moonshot / Kimi 服务。',
    baseUrl: 'https://api.moonshot.ai/v1',
    authType: 'bearer',
    authHeader: 'Authorization',
    apiProtocol: 'openai-chat',
    models: [
      { modelKey: 'kimi-k2.7-code', modelLabel: 'Kimi K2.7 Code' },
      { modelKey: 'kimi-for-coding', modelLabel: 'Kimi for Coding' },
      { modelKey: 'kimi-k2.5', modelLabel: 'Kimi K2.5' },
      { modelKey: 'kimi-k2', modelLabel: 'Kimi K2' },
    ],
  },
  {
    providerKey: 'qwen',
    providerName: 'Qwen',
    tagline: '阿里通义',
    description: '适合 Qwen / DashScope 兼容服务。',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    authType: 'bearer',
    authHeader: 'Authorization',
    apiProtocol: 'openai-chat',
    models: [
      { modelKey: 'qwen3-coder-plus', modelLabel: 'Qwen3 Coder Plus' },
      { modelKey: 'qwen3-max', modelLabel: 'Qwen3 Max' },
      { modelKey: 'qwen-plus', modelLabel: 'Qwen Plus' },
    ],
  },
]

const CRITIC_SHARED_PROVIDER_KEYS = new Set(['rightcode', 'openai', 'anthropic', 'google'])

function toLlmProviderPreset(
  preset: (typeof AGENT_PROVIDER_PRESETS)[number],
  group: 'agent' | 'critic',
): ProviderPreset {
  const isCritic = group === 'critic'
  return {
    id: `${group}-${preset.providerKey}`,
    group,
    providerKey: preset.providerKey,
    providerName: preset.providerName,
    tagline: preset.tagline,
    description: preset.description,
    baseUrl: preset.baseUrl,
    authType: preset.authType,
    authHeader: preset.authHeader ?? null,
    authQueryParam: preset.authQueryParam ?? null,
    apiProtocol: preset.apiProtocol ?? null,
    disabledReason: preset.disabledReason ?? null,
    capabilityNote: isCritic ? nativeVideoCapabilityNote(preset.apiProtocol) : null,
    apiKeyPlaceholder: `${preset.providerName} API Key`,
    models: preset.models.map((model) => ({
      modelKey: model.modelKey,
      modelAlias: null,
      label: model.modelLabel,
      kind: 'multimodal' as const,
      meta: { useCases: [isCritic ? 'Critic' : 'Agent 大脑', preset.providerName] },
    })),
    recommendedDefaults: [{
      slot: isCritic ? 'multimodal' as const : 'agent' as const,
      modelKey: preset.models[0]?.modelKey ?? '',
    }],
  }
}

const APIMART_IMAGE_OPTIONS = {
  defaultAspectRatio: '1:1',
  defaultImageSize: '2k',
  aspectRatioOptions: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '21:9', '9:21'],
  imageSizeOptions: [{ value: '1k', label: '1K' }, { value: '2k', label: '2K' }, { value: '4k', label: '4K' }],
  resolutionOptions: ['1k', '2k', '4k'],
  supportsReferenceImages: true,
  supportsTextToImage: true,
  supportsImageToImage: true,
}

const SEEDANCE_VIDEO_OPTIONS = {
  defaultDurationSeconds: 5,
  defaultSize: '16:9',
  defaultResolution: '720p',
  durationOptions: Array.from({ length: 12 }, (_item, index) => {
    const value = index + 4
    return { value, label: `${value}s` }
  }),
  sizeOptions: [
    { value: '16:9', label: '16:9 横屏', orientation: 'landscape', aspectRatio: '16:9' },
    { value: '9:16', label: '9:16 竖屏', orientation: 'portrait', aspectRatio: '9:16' },
    { value: '1:1', label: '1:1 方形', orientation: 'landscape', aspectRatio: '1:1' },
    { value: '4:3', label: '4:3 传统', orientation: 'landscape', aspectRatio: '4:3' },
    { value: '3:4', label: '3:4 竖向传统', orientation: 'portrait', aspectRatio: '3:4' },
    { value: '21:9', label: '21:9 超宽屏', orientation: 'landscape', aspectRatio: '21:9' },
    { value: 'adaptive', label: '自适应', orientation: 'landscape', aspectRatio: '16:9' },
  ],
  resolutionOptions: [{ value: '720p', label: '720p 高清' }],
  orientationOptions: [
    { value: 'landscape', label: '横屏', size: '16:9', aspectRatio: '16:9' },
    { value: 'portrait', label: '竖屏', size: '9:16', aspectRatio: '9:16' },
  ],
  controls: [
    { key: 'duration', binding: 'durationSeconds', label: '时长' },
    { key: 'size', binding: 'size', label: '画幅' },
  ],
  defaults: { generateAudio: true },
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'media-apimart',
    group: 'media',
    providerKey: 'apimart',
    providerName: 'APIMart',
    tagline: '图片生成 + 图生视频',
    description: '适合先快速跑通画布图片节点，也可作为视频默认供应商。',
    baseUrl: 'https://api.apimart.ai',
    authType: 'bearer',
    authHeader: null,
    authQueryParam: null,
    apiProtocol: null,
    apiKeyPlaceholder: '填入 APIMart API Key',
    models: [
      {
        modelKey: 'gpt-image-2',
        modelAlias: 'gpt-image-2',
        label: 'GPT Image 2',
        kind: 'image',
        meta: {
          useCases: ['文本生图', '参考图改图', '画布图片节点'],
          imageOptions: APIMART_IMAGE_OPTIONS,
        },
        options: APIMART_IMAGE_OPTIONS,
      },
      {
        modelKey: 'doubao-seedance-2.0',
        modelAlias: 'seedance2',
        label: 'Seedance 2.0',
        kind: 'video',
        meta: {
          useCases: ['图生视频', '有声视频', '画布视频节点'],
          videoOptions: SEEDANCE_VIDEO_OPTIONS,
        },
        options: SEEDANCE_VIDEO_OPTIONS,
      },
    ],
    recommendedDefaults: [
      { slot: 'image', modelKey: 'gpt-image-2' },
      { slot: 'video', modelKey: 'doubao-seedance-2.0' },
    ],
  },
  {
    id: 'media-rightcode-draw',
    group: 'media',
    providerKey: 'rightcode-draw',
    providerName: 'RightCode Draw',
    tagline: 'GPT Image 2 图片生成',
    description: '通过 right.codes/draw 以 OpenAI Images 协议生成图片。',
    baseUrl: 'https://www.right.codes/draw',
    authType: 'bearer',
    authHeader: null,
    authQueryParam: null,
    apiProtocol: null,
    apiKeyPlaceholder: '填入 RightCode Draw API Key',
    models: [
      {
        modelKey: 'gpt-image-2',
        modelAlias: 'gpt-image-2',
        label: 'GPT Image 2',
        kind: 'image',
        meta: {
          useCases: ['文本生图', '参考图改图', '画布图片节点'],
          imageOptions: APIMART_IMAGE_OPTIONS,
        },
        options: APIMART_IMAGE_OPTIONS,
      },
    ],
    recommendedDefaults: [{ slot: 'image', modelKey: 'gpt-image-2' }],
  },
  {
    id: 'media-seedance-ark',
    group: 'media',
    providerKey: 'seedance-ark',
    providerName: '火山引擎',
    tagline: 'Seedance Ark 视频',
    description: '适合把火山引擎作为画布视频节点默认供应商。',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    authType: 'bearer',
    authHeader: null,
    authQueryParam: null,
    apiProtocol: null,
    apiKeyPlaceholder: '填入火山引擎 Ark API Key',
    models: [
      {
        modelKey: 'doubao-seedance-2-0-260128',
        modelAlias: 'seedance2',
        label: 'Seedance 2.0',
        kind: 'video',
        meta: {
          useCases: ['图生视频', '火山引擎 Ark', '画布视频节点'],
          videoOptions: SEEDANCE_VIDEO_OPTIONS,
        },
        options: SEEDANCE_VIDEO_OPTIONS,
      },
    ],
    recommendedDefaults: [{ slot: 'video', modelKey: 'doubao-seedance-2-0-260128' }],
  },
  ...AGENT_PROVIDER_PRESETS.map((preset) => toLlmProviderPreset(preset, 'agent')),
  ...AGENT_PROVIDER_PRESETS
    .filter((preset) => CRITIC_SHARED_PROVIDER_KEYS.has(preset.providerKey))
    .map((preset) => toLlmProviderPreset(preset, 'critic')),
]

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback
}

function findProvider(config: ModelConfigDto | null, providerKey: string): ModelConfigProviderDto | null {
  const normalizedKey = providerKey.trim()
  if (!normalizedKey || !config) return null
  return config.providers.find((provider) => provider.key === normalizedKey) || null
}

function findDefault(defaults: ModelConfigDefaultModelDto[], slot: ModelConfigDefaultSlot): ModelConfigDefaultModelDto | null {
  return defaults.find((item) => item.slot === slot) || null
}

function findOtherDefaultReference(
  defaults: ModelConfigDefaultModelDto[],
  tab: PanelTab,
  providerKey: string,
  modelKey?: string,
): ModelConfigDefaultModelDto | null {
  const currentSlot = defaultSlotForTab(tab)
  return defaults.find((item) => (
    item.slot !== currentSlot
    && item.vendorKey === providerKey
    && (typeof modelKey === 'undefined' || item.modelKey === modelKey)
  )) || null
}

function isAuthType(value: string | null): value is ModelConfigAuthType {
  return value === 'none' || value === 'bearer' || value === 'x-api-key' || value === 'query'
}

function isApiProtocol(value: string | null): value is ModelConfigApiProtocol {
  return value === 'openai-chat'
    || value === 'openai-responses'
    || value === 'google-v1beta'
    || value === 'anthropic-messages'
}

function supportsNativeVideoProtocol(value: ModelConfigApiProtocol | null | undefined): boolean {
  return Boolean(value && NATIVE_VIDEO_API_PROTOCOLS.has(value))
}

function nativeVideoCapabilityNote(value: ModelConfigApiProtocol | null | undefined): string | null {
  if (supportsNativeVideoProtocol(value)) return null
  return `支持图片和文本评审；当前协议 ${value || '未配置'} 不支持完整视频输入，完整视频 Critic 请选 Google Gemini。`
}

function modelsByKind<T extends Pick<PresetModel, 'kind'>>(models: T[], kind: ModelCatalogModelKind): T[] {
  return models.filter((model) => model.kind === kind)
}

function isApiConfigured(provider: ModelConfigProviderDto | null): boolean {
  return provider?.apiKeyConfigured === true
}

function apiConfigurationLabel(provider: ModelConfigProviderDto | null): string {
  return isApiConfigured(provider) ? 'API 已配置' : 'API 未配置'
}

function providerInitial(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return trimmed.slice(0, 2).toUpperCase()
}

function modelKindsForTab(tab: PanelTab): ModelCatalogModelKind[] {
  return [modelKindForTab(tab)]
}

function modelKindForTab(tab: PanelTab): ModelCatalogModelKind {
  if (tab === 'image') return 'image'
  if (tab === 'video') return 'video'
  return 'multimodal'
}

function defaultSlotForTab(tab: PanelTab): ModelConfigDefaultSlot {
  if (tab === 'agent') return 'agent'
  if (tab === 'critic') return 'multimodal'
  return tab
}

function modelMatchesTab(model: Pick<ModelConfigModelDto, 'kind'> | PresetModel, tab: PanelTab): boolean {
  return modelKindsForTab(tab).includes(model.kind)
}

function modelKindLabel(kind: ModelCatalogModelKind, tab: PanelTab): string {
  if (kind === 'image') return '图片'
  if (kind === 'video') return '视频'
  if (tab === 'critic') return 'Critic'
  return 'Agent'
}

function presetMatchesTab(preset: ProviderPreset, tab: PanelTab): boolean {
  if (tab === 'agent') return preset.group === 'agent'
  if (tab === 'critic') return preset.group === 'critic'
  return preset.group === 'media'
}

function isDefaultPreset(preset: ProviderPreset): boolean {
  return DEFAULT_PROVIDER_PRESET_IDS.has(preset.id)
}

function modelToPresetModel(model: ModelConfigModelDto): PresetModel {
  return {
    modelKey: model.modelKey,
    modelAlias: model.modelAlias ?? null,
    label: model.label || model.modelAlias || model.modelKey,
    kind: model.kind,
    enabled: model.enabled,
    meta: model.meta,
    options: model.options,
  }
}

function mergeConfiguredModels(
  preset: ProviderPreset,
  config: ModelConfigDto | null,
  tab: PanelTab,
  options?: { preferConfigured?: boolean },
): ProviderPreset {
  const scopedPreset: ProviderPreset = {
    ...preset,
    models: preset.models.filter((model) => modelMatchesTab(model, tab)),
    recommendedDefaults: preset.recommendedDefaults.filter((item) => item.slot === defaultSlotForTab(tab)),
  }
  if (!config) return scopedPreset
  const configuredProvider = findProvider(config, preset.providerKey)
  const configuredModels = config.models
    .filter((model) => model.providerKey === preset.providerKey && modelMatchesTab(model, tab))
    .map(modelToPresetModel)
  if (options?.preferConfigured && configuredProvider && configuredModels.length) {
    return {
      ...scopedPreset,
      models: configuredModels,
    }
  }
  const missingModels = configuredModels.filter(
    (model) => !scopedPreset.models.some((presetModel) => presetModel.modelKey === model.modelKey),
  )
  if (!missingModels.length) return scopedPreset
  return {
    ...scopedPreset,
    models: [...scopedPreset.models, ...missingModels],
  }
}

function presetFromConfigProvider(
  provider: ModelConfigProviderDto,
  models: ModelConfigModelDto[],
  tab: PanelTab,
): ProviderPreset | null {
  const presetModels = models
    .filter((model) => model.providerKey === provider.key && modelMatchesTab(model, tab))
    .map(modelToPresetModel)
  if (!presetModels.length) return null
  const recommendedDefaults = modelKindsForTab(tab)
    .map((kind) => {
      const model = presetModels.find((item) => item.kind === kind)
      if (!model) return null
      return {
        slot: defaultSlotForTab(tab),
        modelKey: model.modelKey,
      }
    })
    .filter((item): item is { slot: ModelConfigDefaultSlot; modelKey: string } => Boolean(item))
  return {
    id: `${tab}-configured-${provider.key}`,
    group: tab === 'agent' ? 'agent' : tab === 'critic' ? 'critic' : 'media',
    providerKey: provider.key,
    providerName: provider.name || provider.key,
    tagline: '已保存供应商',
    description: provider.baseUrl || '已保存的自定义供应商',
    baseUrl: provider.baseUrl || '',
    authType: provider.authType,
    authHeader: provider.authHeader,
    authQueryParam: provider.authQueryParam,
    apiProtocol: provider.apiProtocol ?? null,
    capabilityNote: tab === 'critic' ? nativeVideoCapabilityNote(provider.apiProtocol) : null,
    apiKeyPlaceholder: `${provider.name || provider.key} API Key`,
    models: presetModels,
    recommendedDefaults,
  }
}

function providerUpdatePayload(
  providerKey: string,
  input: {
    providerName: string
    baseUrl: string
    authType: ModelConfigAuthType
    authHeader?: string | null
    authQueryParam?: string | null
    apiProtocol?: ModelConfigApiProtocol | null
  },
  existingProvider: ModelConfigProviderDto | null,
  preserveExistingConnection: boolean,
) {
  const preservedProvider = preserveExistingConnection && existingProvider
    ? existingProvider
    : null
  return {
    name: preservedProvider?.name || input.providerName.trim() || providerKey,
    enabled: existingProvider?.enabled ?? true,
    baseUrl: preservedProvider ? preservedProvider.baseUrl : input.baseUrl.trim() || null,
    authType: preservedProvider?.authType ?? input.authType,
    authHeader: preservedProvider ? preservedProvider.authHeader : input.authHeader?.trim() || null,
    authQueryParam: preservedProvider ? preservedProvider.authQueryParam : input.authQueryParam?.trim() || null,
    apiProtocol: preservedProvider ? preservedProvider.apiProtocol : input.apiProtocol ?? null,
    ...(typeof existingProvider?.meta === 'undefined' ? {} : { meta: existingProvider.meta }),
  }
}

export default function ModelPanel(): JSX.Element | null {
  const active = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const mounted = active === 'models'

  const [config, setConfig] = React.useState<ModelConfigDto | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [tab, setTab] = React.useState<PanelTab>('image')
  const [mode, setMode] = React.useState<PanelMode>('select')
  const [selectedPresetId, setSelectedPresetId] = React.useState('media-apimart')
  const [apiKey, setApiKey] = React.useState('')
  const [selectedImageModel, setSelectedImageModel] = React.useState('gpt-image-2')
  const [selectedVideoModel, setSelectedVideoModel] = React.useState('doubao-seedance-2.0')
  const [selectedAgentModel, setSelectedAgentModel] = React.useState('gpt-5.5')
  const [selectedCriticModel, setSelectedCriticModel] = React.useState('')
  const [customProviderKey, setCustomProviderKey] = React.useState('')
  const [customProviderName, setCustomProviderName] = React.useState('')
  const [customBaseUrl, setCustomBaseUrl] = React.useState('')
  const [customAuthType, setCustomAuthType] = React.useState<ModelConfigAuthType>('bearer')
  const [customAuthHeader, setCustomAuthHeader] = React.useState('Authorization')
  const [customAuthQueryParam, setCustomAuthQueryParam] = React.useState('')
  const [customApiProtocol, setCustomApiProtocol] = React.useState<ModelConfigApiProtocol>('openai-chat')
  const [modelDrafts, setModelDrafts] = React.useState<DraftModel[]>([])
  const [customModelKey, setCustomModelKey] = React.useState('')
  const [addModelOpen, setAddModelOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [presetSearchOpen, setPresetSearchOpen] = React.useState(false)
  const [presetSearch, setPresetSearch] = React.useState('')
  const [presetSortAlpha, setPresetSortAlpha] = React.useState(false)
  const previousDefaultsRef = React.useRef<ModelConfigDefaultModelDto[]>([])
  const userInitiatedClearRef = React.useRef(false)
  const initializedSelectionScopeRef = React.useRef<string | null>(null)

  const loadConfig = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const nextConfig = await getModelConfig()
      const cascadeSlot = detectCascadeSelfHeal(
        previousDefaultsRef.current,
        nextConfig.defaults,
        { userInitiatedClear: userInitiatedClearRef.current },
      )
      previousDefaultsRef.current = nextConfig.defaults
      userInitiatedClearRef.current = false
      setConfig(nextConfig)
      if (cascadeSlot) {
        notifications.show({
          color: 'orange',
          title: `${SLOT_LABEL[cascadeSlot]} 已自动清除`,
          message: '凭证不再满足绑定条件，请重新选择供应商。',
        })
      }
    } catch (loadError: unknown) {
      const message = getErrorMessage(loadError, '模型配置加载失败')
      setError(message)
      notifications.show({ title: '模型配置加载失败', message, color: 'red' })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!mounted) return
    void loadConfig()
  }, [mounted, loadConfig])

  const defaults = config?.defaults ?? EMPTY_DEFAULTS
  const activeDefault = React.useMemo(
    () => findDefault(defaults, defaultSlotForTab(tab)),
    [defaults, tab],
  )
  const selectionScope = [
    tab,
    activeDefault?.vendorKey ?? '',
    activeDefault?.modelKey ?? '',
  ].join(':')
  const basePresets = React.useMemo(() => PROVIDER_PRESETS.filter((preset) => presetMatchesTab(preset, tab)), [tab])
  const selectablePresets = React.useMemo(() => {
    const configuredProviderKeys = new Set((config?.providers ?? []).map((provider) => provider.key))
    const baseSelectable = basePresets
      .filter((preset) => isDefaultPreset(preset) || configuredProviderKeys.has(preset.providerKey))
      .map((preset) => mergeConfiguredModels(preset, config, tab, { preferConfigured: true }))
      .filter((preset) => preset.models.length > 0)
    const baseProviderKeys = new Set(basePresets.map((preset) => preset.providerKey))
    const configuredOnly = (config?.providers ?? [])
      .filter((provider) => !baseProviderKeys.has(provider.key))
      .map((provider) => presetFromConfigProvider(provider, config?.models ?? [], tab))
      .filter((preset): preset is ProviderPreset => Boolean(preset))
    return [...baseSelectable, ...configuredOnly]
  }, [basePresets, config, tab])
  const addPresets = React.useMemo(
    () => basePresets
      .filter((preset) => !isDefaultPreset(preset))
      .map((preset) => mergeConfiguredModels(preset, config, tab))
      .filter((preset) => preset.models.length > 0),
    [basePresets, config, tab],
  )
  const presets = mode === 'select' ? selectablePresets : addPresets
  const selectedPreset = React.useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) || presets[0] || null,
    [presets, selectedPresetId],
  )
  const isCustom = mode === 'add' && selectedPresetId === 'custom'
  const activeProviderKey = isCustom ? customProviderKey.trim().toLowerCase() : selectedPreset?.providerKey ?? ''
  const activeProvider = React.useMemo(() => findProvider(config, activeProviderKey), [activeProviderKey, config])
  const otherDefaultUsingActiveProvider = React.useMemo(
    () => findOtherDefaultReference(defaults, tab, activeProviderKey),
    [activeProviderKey, defaults, tab],
  )

  const startCustomProvider = React.useCallback((providerKey?: string) => {
    const existingProvider = providerKey ? findProvider(config, providerKey) : null
    const existingModels = providerKey
      ? (config?.models ?? []).filter((model) => model.providerKey === providerKey && modelMatchesTab(model, tab))
      : []
    setMode('add')
    setSelectedPresetId('custom')
    setApiKey('')
    setError(null)
    setCustomProviderKey(providerKey || (tab === 'agent'
      ? 'openai-compatible'
      : tab === 'critic'
        ? 'custom-critic-provider'
        : 'custom-media-provider'))
    setCustomProviderName(existingProvider?.name || (
      tab === 'agent'
        ? 'OpenAI 兼容服务'
        : tab === 'critic'
          ? '自定义 Critic 服务'
          : tab === 'video'
            ? '自定义视频服务'
            : '自定义图片服务'
    ))
    setCustomBaseUrl(existingProvider?.baseUrl || '')
    setCustomAuthType(existingProvider?.authType || 'bearer')
    setCustomAuthHeader(existingProvider?.authHeader || 'Authorization')
    setCustomAuthQueryParam(existingProvider?.authQueryParam || '')
    setCustomApiProtocol(existingProvider?.apiProtocol || (tab === 'critic' ? 'google-v1beta' : 'openai-chat'))
    setAddModelOpen(false)
    setModelDrafts(existingModels.map((model) => ({
      id: `${model.kind}:${model.modelKey}`,
      modelKey: model.modelKey,
      modelAlias: model.modelAlias ?? null,
      label: model.label || model.modelKey,
      kind: model.kind,
      enabled: model.enabled,
      options: model.options,
      meta: model.meta,
    })))
    setCustomModelKey('')
  }, [config, tab])

  const setPresetByTab = React.useCallback((preset: ProviderPreset) => {
    setSelectedPresetId(preset.id)
    setApiKey('')
    setError(null)
    setAddModelOpen(false)
  }, [])

  React.useEffect(() => {
    if (!mounted) {
      initializedSelectionScopeRef.current = null
      return
    }
    if (mode === 'select') {
      if (initializedSelectionScopeRef.current === selectionScope) return
      initializedSelectionScopeRef.current = selectionScope
      const persistedPreset = activeDefault
        ? presets.find((preset) => preset.providerKey === activeDefault.vendorKey)
        : null
      const nextPreset = persistedPreset || presets[0]
      if (nextPreset) setPresetByTab(nextPreset)
      return
    }
    initializedSelectionScopeRef.current = null
    const currentStillVisible = selectedPresetId === 'custom'
      || presets.some((preset) => preset.id === selectedPresetId)
    if (currentStillVisible) return
    const firstPreset = presets[0]
    if (firstPreset) {
      setPresetByTab(firstPreset)
      return
    }
    if (mode === 'add') {
      startCustomProvider()
    }
  }, [activeDefault, mode, mounted, presets, selectedPresetId, selectionScope, setPresetByTab, startCustomProvider])

  React.useEffect(() => {
    setCustomProviderKey('')
    setCustomProviderName('')
    setCustomBaseUrl('')
    setCustomAuthType('bearer')
    setCustomAuthHeader('Authorization')
    setCustomAuthQueryParam('')
    setCustomApiProtocol(tab === 'critic' ? 'google-v1beta' : 'openai-chat')
    setModelDrafts([])
    setCustomModelKey(tab === 'agent' ? 'gpt-5.5' : tab === 'critic' ? 'gemini-model-id' : '')
    setAddModelOpen(false)
    setPresetSearch('')
    setPresetSearchOpen(false)
  }, [tab])

  React.useEffect(() => {
    if (!mounted || !selectedPreset) return
    const presetImageModels = modelsByKind(selectedPreset.models, 'image')
    const presetVideoModels = modelsByKind(selectedPreset.models, 'video')
    const presetAgentModels = modelsByKind(selectedPreset.models, 'multimodal')
    const imageDefault = findDefault(defaults, 'image')
    const videoDefault = findDefault(defaults, 'video')
    const agentDefault = findDefault(defaults, 'agent')
    const criticDefault = findDefault(defaults, 'multimodal')
    const imageModel = imageDefault?.vendorKey === selectedPreset.providerKey
      ? presetImageModels.find((model) => model.modelKey === imageDefault.modelKey) || presetImageModels[0]
      : presetImageModels[0]
    const videoModel = videoDefault?.vendorKey === selectedPreset.providerKey
      ? presetVideoModels.find((model) => model.modelKey === videoDefault.modelKey) || presetVideoModels[0]
      : presetVideoModels[0]
    const agentModel = agentDefault?.vendorKey === selectedPreset.providerKey
      ? presetAgentModels.find((model) => model.modelKey === agentDefault.modelKey) || presetAgentModels[0]
      : presetAgentModels[0]
    const criticModel = criticDefault?.vendorKey === selectedPreset.providerKey
      ? presetAgentModels.find((model) => model.modelKey === criticDefault.modelKey) || presetAgentModels[0]
      : presetAgentModels[0]
    setSelectedImageModel(imageModel?.modelKey || '')
    setSelectedVideoModel(videoModel?.modelKey || '')
    setSelectedAgentModel(agentModel?.modelKey || '')
    setSelectedCriticModel(criticModel?.modelKey || '')
    setCustomProviderKey(selectedPreset.providerKey)
    setCustomProviderName(selectedPreset.providerName)
    setCustomBaseUrl(selectedPreset.baseUrl)
    setCustomAuthType(selectedPreset.authType)
    setCustomAuthHeader(selectedPreset.authHeader || 'Authorization')
    setCustomAuthQueryParam(selectedPreset.authQueryParam || '')
    setCustomApiProtocol(selectedPreset.apiProtocol || 'openai-chat')
    setModelDrafts(selectedPreset.models.map((model) => ({
      id: `${model.kind}:${model.modelKey}`,
      modelKey: model.modelKey,
      modelAlias: model.modelAlias ?? null,
      label: model.label || model.modelKey,
      kind: model.kind,
      enabled: model.enabled ?? true,
      options: model.options,
      meta: model.meta,
    })))
    setCustomModelKey('')
    setAddModelOpen(false)
  }, [defaults, mounted, selectedPreset])

  const handleDeleteProvider = React.useCallback(async () => {
    const key = activeProviderKey
    if (!key) return
    if (otherDefaultUsingActiveProvider) {
      const message = `该供应商仍被 ${SLOT_LABEL[otherDefaultUsingActiveProvider.slot]} 使用，请先切换对应默认模型。`
      setError(message)
      notifications.show({ title: '无法删除', message, color: 'orange' })
      return
    }
    setSaving(true)
    setError(null)
    try {
      await deleteModelCatalogVendor(key)
      setApiKey('')
      notifications.show({ title: '已删除', message: '供应商已删除', color: 'teal' })
      await loadConfig()
    } catch (deleteError: unknown) {
      const message = getErrorMessage(deleteError, '供应商删除失败')
      setError(message)
      notifications.show({ title: '删除失败', message, color: 'red' })
    } finally {
      setSaving(false)
    }
  }, [activeProviderKey, loadConfig, otherDefaultUsingActiveProvider])

  const getSelectedModelForKind = React.useCallback((kind: ModelCatalogModelKind): string => {
    if (kind === 'image') return selectedImageModel
    if (kind === 'video') return selectedVideoModel
    if (tab === 'critic') return selectedCriticModel
    return selectedAgentModel
  }, [selectedAgentModel, selectedCriticModel, selectedImageModel, selectedVideoModel, tab])

  const setSelectedModelForKind = React.useCallback((kind: ModelCatalogModelKind, modelKey: string) => {
    if (kind === 'image') {
      setSelectedImageModel(modelKey)
      return
    }
    if (kind === 'video') {
      setSelectedVideoModel(modelKey)
      return
    }
    if (tab === 'critic') {
      setSelectedCriticModel(modelKey)
      return
    }
    setSelectedAgentModel(modelKey)
  }, [tab])

  const handleAddDraftModel = React.useCallback(async () => {
    const modelKey = customModelKey.trim()
    if (!modelKey) {
      setError('请填写模型 ID')
      return
    }
    if (modelDrafts.some((model) => model.modelKey === modelKey)) {
      setError('当前供应商已存在该模型 ID')
      return
    }
    const modelKind = modelKindForTab(tab)
    const isFirstKindModel = !modelDrafts.some((model) => model.kind === modelKind)
    const draftModel: DraftModel = {
      id: `${modelKind}:${modelKey}:${Date.now()}`,
      modelKey,
      modelAlias: null,
      label: modelKey,
      kind: modelKind,
      enabled: true,
    }
    if (isFirstKindModel) setSelectedModelForKind(modelKind, modelKey)
    setModelDrafts((items) => [...items, draftModel])
    setCustomModelKey('')
    setAddModelOpen(false)
    setError(null)
    if (isCustom || !selectedPreset) return

    setSaving(true)
    try {
      const providerKey = selectedPreset.providerKey
      const existingProvider = findProvider(config, providerKey)
      await upsertModelConfigProvider(
        providerKey,
        providerUpdatePayload(providerKey, selectedPreset, existingProvider, true),
      )
      const normalizedKey = apiKey.trim()
      if (normalizedKey) {
        await upsertModelConfigProviderApiKey(providerKey, { apiKey: normalizedKey })
      }
      await upsertModelConfigModel(providerKey, modelKey, {
        modelAlias: null,
        label: modelKey,
        kind: modelKind,
        enabled: true,
      })
      if (isFirstKindModel) {
        await upsertModelConfigDefaultModel(defaultSlotForTab(tab), {
          vendorKey: providerKey,
          modelKey,
        })
      }
      notifications.show({ title: '已添加', message: '模型已保存到当前供应商', color: 'teal' })
      await loadConfig()
    } catch (saveError: unknown) {
      const message = getErrorMessage(saveError, '模型添加失败')
      setError(message)
      notifications.show({ title: '添加失败', message, color: 'red' })
    } finally {
      setSaving(false)
    }
  }, [apiKey, config, customModelKey, isCustom, loadConfig, modelDrafts, selectedPreset, setSelectedModelForKind, tab])

  const handleRemoveDraftModel = React.useCallback(async (model: DraftModel) => {
    const providerKey = activeProviderKey
    const isPersisted = Boolean(
      providerKey &&
      config?.models.some((item) => item.providerKey === providerKey && item.modelKey === model.modelKey),
    )
    if (!isPersisted || !providerKey) {
      if (getSelectedModelForKind(model.kind) === model.modelKey) {
        const replacement = modelDrafts.find((item) => item.id !== model.id && item.kind === model.kind)
        setSelectedModelForKind(model.kind, replacement?.modelKey || '')
      }
      setModelDrafts((items) => items.filter((item) => item.id !== model.id))
      return
    }
    const otherDefaultReference = findOtherDefaultReference(defaults, tab, providerKey, model.modelKey)
    if (otherDefaultReference) {
      const message = `该模型仍被 ${SLOT_LABEL[otherDefaultReference.slot]} 使用，请先切换对应默认模型。`
      setError(message)
      notifications.show({ title: '无法删除', message, color: 'orange' })
      return
    }
    setSaving(true)
    setError(null)
    try {
      const defaultSlot = model.kind === 'multimodal'
        ? defaultSlotForTab(tab)
        : model.kind as ModelConfigDefaultSlot
      const currentDefault = findDefault(defaults, defaultSlot)
      if (currentDefault?.vendorKey === providerKey && currentDefault.modelKey === model.modelKey) {
        userInitiatedClearRef.current = true
        await deleteModelConfigDefaultModel(defaultSlot)
      }
      await deleteModelConfigModel(providerKey, model.modelKey)
      notifications.show({ title: '已删除', message: '模型已从当前供应商移除', color: 'teal' })
      await loadConfig()
    } catch (deleteError: unknown) {
      userInitiatedClearRef.current = false
      const message = getErrorMessage(deleteError, '模型删除失败')
      setError(message)
      notifications.show({ title: '删除失败', message, color: 'red' })
    } finally {
      setSaving(false)
    }
  }, [activeProviderKey, config, defaults, getSelectedModelForKind, loadConfig, modelDrafts, setSelectedModelForKind, tab])

  const saveProviderAndModels = React.useCallback(async (input: {
    providerKey: string
    providerName: string
    baseUrl: string
    authType: ModelConfigAuthType
    authHeader?: string | null
    authQueryParam?: string | null
    apiProtocol?: ModelConfigApiProtocol | null
    apiKey?: string
    models: PresetModel[]
    defaults: Array<{ slot: ModelConfigDefaultSlot; modelKey: string }>
    preserveExistingConnection: boolean
  }) => {
    const providerKey = input.providerKey.trim().toLowerCase()
    if (!providerKey) throw new Error('请填写供应商标识')
    const existingProvider = findProvider(config, providerKey)
    await upsertModelConfigProvider(
      providerKey,
      providerUpdatePayload(providerKey, input, existingProvider, input.preserveExistingConnection),
    )
    const normalizedKey = input.apiKey?.trim() || ''
    if (normalizedKey) {
      await upsertModelConfigProviderApiKey(providerKey, { apiKey: normalizedKey })
    }
    for (const model of input.models) {
      const existingModel = config?.models.find(
        (item) => item.providerKey === providerKey && item.modelKey === model.modelKey,
      )
      await upsertModelConfigModel(providerKey, model.modelKey, {
        modelAlias: existingModel ? existingModel.modelAlias : null,
        label: existingModel?.label || model.label || model.modelKey,
        kind: model.kind,
        enabled: existingModel?.enabled ?? model.enabled ?? true,
        ...(existingModel
          ? typeof existingModel.meta === 'undefined'
            ? { options: existingModel.options }
            : { meta: existingModel.meta }
          : typeof model.meta === 'undefined'
            ? { options: model.options }
            : { meta: model.meta }),
      })
    }
    for (const item of input.defaults) {
      await upsertModelConfigDefaultModel(item.slot, {
        vendorKey: providerKey,
        modelKey: item.modelKey,
      })
    }
  }, [config])

  const handleSavePreset = React.useCallback(async () => {
    if (!selectedPreset) return
    if (selectedPreset.disabledReason) {
      setError(selectedPreset.disabledReason)
      notifications.show({ title: '暂不可用', message: selectedPreset.disabledReason, color: 'orange' })
      return
    }
    setSaving(true)
    setError(null)
    try {
      const shouldReturnToSelect = mode === 'add'
      const activeKind = modelKindForTab(tab)
      const selectedDefaultModel = getSelectedModelForKind(activeKind).trim()
      const modelsToSave = modelDrafts.map((model) => ({
        modelKey: model.modelKey,
        modelAlias: model.modelAlias,
        label: model.label,
        kind: model.kind,
        enabled: model.enabled,
        options: model.options,
        meta: model.meta,
      }))
      if (!modelsToSave.length) throw new Error('请至少添加一个模型')
      const credentialApiKey = apiKey.trim()
      const defaultsToApply: Array<{ slot: ModelConfigDefaultSlot; modelKey: string }> = []
      if (selectedDefaultModel && modelsToSave.some((model) => model.kind === activeKind && model.modelKey === selectedDefaultModel)) {
        defaultsToApply.push({ slot: defaultSlotForTab(tab), modelKey: selectedDefaultModel })
      }
      await saveProviderAndModels({
        providerKey: selectedPreset.providerKey,
        providerName: selectedPreset.providerName,
        baseUrl: selectedPreset.baseUrl,
        authType: selectedPreset.authType,
        authHeader: selectedPreset.authHeader,
        authQueryParam: selectedPreset.authQueryParam,
        apiProtocol: selectedPreset.apiProtocol ?? null,
        apiKey: credentialApiKey,
        models: modelsToSave,
        defaults: defaultsToApply,
        preserveExistingConnection: true,
      })
      notifications.show({
        title: '已保存',
        message: credentialApiKey ? '供应商、API Key 和默认模型已更新' : '供应商和默认模型已更新',
        color: 'teal',
      })
      setApiKey('')
      await loadConfig()
      if (shouldReturnToSelect) setMode('select')
    } catch (saveError: unknown) {
      const message = getErrorMessage(saveError, '保存失败')
      setError(message)
      notifications.show({ title: '保存失败', message, color: 'red' })
    } finally {
      setSaving(false)
    }
  }, [activeProvider?.apiKeyConfigured, apiKey, getSelectedModelForKind, loadConfig, mode, modelDrafts, saveProviderAndModels, selectedPreset, tab])

  const handleSaveCustom = React.useCallback(async () => {
    const providerKey = customProviderKey.trim().toLowerCase()
    if (!providerKey) {
      setError('请填写供应商标识')
      return
    }
    if (!modelDrafts.length) {
      setError('请至少添加一个模型')
      return
    }
    const activeKind = modelKindForTab(tab)
    const activeModels = modelsByKind(modelDrafts, activeKind)
    const selectedDefaultModel = getSelectedModelForKind(activeKind).trim()
    const activeDefault = activeModels.find((model) => model.modelKey === selectedDefaultModel) || activeModels[0]
    const defaultsToApply: Array<{ slot: ModelConfigDefaultSlot; modelKey: string }> = []
    if (activeDefault) defaultsToApply.push({ slot: defaultSlotForTab(tab), modelKey: activeDefault.modelKey })
    setSaving(true)
    setError(null)
    try {
      await saveProviderAndModels({
        providerKey,
        providerName: customProviderName.trim() || providerKey,
        baseUrl: customBaseUrl,
        authType: customAuthType,
        authHeader: customAuthHeader,
        authQueryParam: customAuthQueryParam,
        apiProtocol: tab === 'agent' || tab === 'critic' ? customApiProtocol : null,
        apiKey,
        models: modelDrafts.map((model) => ({
          modelKey: model.modelKey,
          modelAlias: model.modelAlias,
          label: model.label,
          kind: model.kind,
          enabled: model.enabled,
          options: model.options,
          meta: model.meta,
        })),
        defaults: defaultsToApply,
        preserveExistingConnection: false,
      })
      notifications.show({ title: '已保存', message: '自定义供应商已启用', color: 'teal' })
      setApiKey('')
      await loadConfig()
      setSelectedPresetId(`${tab}-configured-${providerKey}`)
      setMode('select')
    } catch (saveError: unknown) {
      const message = getErrorMessage(saveError, '自定义供应商保存失败')
      setError(message)
      notifications.show({ title: '保存失败', message, color: 'red' })
    } finally {
      setSaving(false)
    }
  }, [apiKey, customApiProtocol, customAuthHeader, customAuthQueryParam, customAuthType, customBaseUrl, customProviderKey, customProviderName, getSelectedModelForKind, loadConfig, modelDrafts, saveProviderAndModels, tab])

  const visiblePresets = React.useMemo(() => {
    const keyword = presetSearch.trim().toLowerCase()
    const filtered = keyword
      ? presets.filter((preset) => {
          return [
            preset.providerName,
            preset.providerKey,
            preset.tagline,
            preset.description,
          ].join(' ').toLowerCase().includes(keyword)
        })
      : presets
    return presetSortAlpha
      ? [...filtered].sort((a, b) => a.providerName.localeCompare(b.providerName))
      : filtered
  }, [presets, presetSearch, presetSortAlpha])

  const renderPresetIcon = React.useCallback((preset: ProviderPreset | null, custom = false) => {
    if (custom) return <IconSettings size={16} />
    if (!preset) return <IconRobot size={16} />
    if (preset.group === 'agent' || preset.group === 'critic') return null
    return preset.models.some((model) => model.kind === 'video') ? <IconVideo size={16} /> : <IconPhoto size={16} />
  }, [])
  const renderModelEditor = (disabled = false) => (
    <Stack gap={6} className="tc-model-config-modal__model-editor">
      <div className="tc-model-config-modal__model-list">
        {modelDrafts.length ? modelDrafts.map((model) => {
          const isSelected = getSelectedModelForKind(model.kind) === model.modelKey
          const otherDefaultReference = findOtherDefaultReference(defaults, tab, activeProviderKey, model.modelKey)
          const removeDisabled = disabled || Boolean(otherDefaultReference)
          const persistedDefault = findDefault(
            defaults,
            model.kind === 'multimodal' ? defaultSlotForTab(tab) : model.kind,
          )
          const isPersistedDefault = persistedDefault?.vendorKey === activeProviderKey
            && persistedDefault.modelKey === model.modelKey
          const modelStatus = isPersistedDefault ? '默认' : isSelected ? '待保存' : null
          return (
            <div
              key={model.id}
              role={!isSelected && !disabled ? 'button' : undefined}
              tabIndex={!isSelected && !disabled ? 0 : undefined}
              className="tc-model-config-modal__model-row"
              data-default-kind={isSelected ? model.kind : undefined}
              data-model-status={modelStatus || undefined}
              data-clickable={!isSelected && !disabled ? 'true' : undefined}
              onClick={() => {
                if (!isSelected) setSelectedModelForKind(model.kind, model.modelKey)
              }}
              onKeyDown={(event) => {
                if (isSelected || disabled) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedModelForKind(model.kind, model.modelKey)
                }
              }}
            >
              {modelStatus ? <span className="tc-model-config-modal__model-default-corner">{modelStatus}</span> : null}
              <Badge size="xs" variant="light" color={model.kind === 'image' ? 'blue' : model.kind === 'video' ? 'grape' : 'teal'}>
                {modelKindLabel(model.kind, tab)}
              </Badge>
              <Text size="xs" className="tc-model-config-modal__model-id" title={model.modelKey}>
                {model.modelKey}
              </Text>
              <Tooltip
                label={otherDefaultReference
                  ? `该模型仍被 ${SLOT_LABEL[otherDefaultReference.slot]} 使用`
                  : '删除该模型'}
                withArrow
                zIndex={MODEL_PANEL_FLOATING_Z_INDEX}
              >
                <ActionIcon
                  aria-label="删除该模型"
                  size="sm"
                  variant="subtle"
                  color="red"
                  disabled={removeDisabled}
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleRemoveDraftModel(model)
                  }}
                >
                  <IconTrash size={13} />
                </ActionIcon>
              </Tooltip>
            </div>
          )
        }) : (
          <div className="tc-model-config-modal__model-empty">暂无模型，请先添加模型 ID。</div>
        )}
      </div>
      <div className="tc-model-config-modal__model-add">
        <Button
          size="xs"
          fullWidth
          variant={addModelOpen ? 'light' : 'subtle'}
          leftSection={<IconPlus size={13} />}
          disabled={disabled}
          onClick={() => setAddModelOpen((open) => !open)}
        >
          添加模型
        </Button>
        {addModelOpen ? (
          <div className="tc-model-config-modal__model-add-panel" data-layout={tab === 'agent' || tab === 'critic' ? 'agent' : 'media'}>
            <TextInput
              size="xs"
              label="模型 ID"
              placeholder={tab === 'agent' ? 'gpt-5.5' : tab === 'critic' ? 'multimodal-model-id' : 'model-id'}
              value={customModelKey}
              onChange={(e) => setCustomModelKey(e.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleAddDraftModel()
                }
              }}
              disabled={disabled}
            />
            <Button size="xs" variant="light" disabled={disabled} onClick={() => void handleAddDraftModel()}>
              确认添加
            </Button>
          </div>
        ) : null}
      </div>
    </Stack>
  )

  if (!mounted) return null

  return (
    <Modal
      opened={mounted}
      onClose={() => setActivePanel(null)}
      title={(
        <Group gap="xs" wrap="nowrap">
          <IconSettings size={16} />
          <Title order={6}>模型配置</Title>
        </Group>
      )}
      size="auto"
      radius="sm"
      className="tc-model-config-modal"
      withOverlay={false}
      lockScroll={false}
      trapFocus={false}
      returnFocus={false}
      classNames={{ inner: 'tc-model-config-modal__inner', content: 'tc-model-config-modal__content' }}
      centered={false}
      styles={{
        inner: {
          position: 'fixed',
          inset: '0 var(--tc-ai-chat-reserved-width, 0px) 0 0',
          width: 'auto',
          padding: '88px 16px 32px 98px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 700,
        },
        content: {
          width: `min(${PANEL_MAX_WIDTH}px, calc(100vw - var(--tc-ai-chat-reserved-width, 0px) - 32px))`,
          maxWidth: 'calc(100vw - var(--tc-ai-chat-reserved-width, 0px) - 32px)',
          maxHeight: 'calc(100vh - 120px)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 700,
        },
      }}
    >
      <Stack gap="xs" className="tc-model-config-modal__body">
        <Text size="xs" c="dimmed">
          选择模块用于配置默认/已添加供应商；添加模块用于从候选供应商或自定义配置中新增。
        </Text>

        <Group justify="space-between" align="center" wrap="wrap" className="tc-model-config-modal__toolbar">
          <Group gap="xs" wrap="wrap">
            <SegmentedControl
              className="tc-model-config-modal__tabs"
              value={tab}
              onChange={(value) => setTab(value as PanelTab)}
              data={TAB_OPTIONS}
            />
            <SegmentedControl
              className="tc-model-config-modal__tabs"
              value={mode}
              onChange={(value) => setMode(value as PanelMode)}
              data={MODE_OPTIONS}
            />
          </Group>
          <Tooltip label="刷新配置" withArrow zIndex={MODEL_PANEL_FLOATING_Z_INDEX}>
            <ActionIcon aria-label="刷新配置" variant="subtle" loading={loading} onClick={() => void loadConfig()}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>

        <div className="tc-model-config-modal__preset-section">
          <Group justify="space-between" align="center" wrap="nowrap" className="tc-model-config-modal__preset-header">
            <Stack gap={0}>
              <Text size="sm" fw={700}>{mode === 'select' ? '默认 / 已添加供应商' : '添加供应商'}</Text>
              <Text size="xs" c="dimmed">
                {mode === 'select'
                  ? '官方和默认供应商会直接显示；新增后的供应商也会出现在这里。'
                  : '从候选供应商添加，或使用自定义配置。'}
              </Text>
            </Stack>
            <Group gap={4} wrap="nowrap">
              {presetSearchOpen ? (
                <TextInput
                  className="tc-model-config-modal__preset-search"
                  size="xs"
                  value={presetSearch}
                  onChange={(event) => setPresetSearch(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setPresetSearch('')
                      setPresetSearchOpen(false)
                    }
                  }}
                  placeholder="搜索"
                  leftSection={<IconSearch size={13} />}
                  autoFocus
                />
              ) : null}
              <Tooltip label="搜索供应商" withArrow zIndex={MODEL_PANEL_FLOATING_Z_INDEX}>
                <ActionIcon
                  aria-label="搜索供应商"
                  size="sm"
                  variant={presetSearchOpen || presetSearch.trim() ? 'light' : 'subtle'}
                  onClick={() => {
                    setPresetSearchOpen((open) => !open)
                    if (presetSearchOpen) setPresetSearch('')
                  }}
                >
                  <IconSearch size={15} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={presetSortAlpha ? '恢复默认排序' : '按名称排序'} withArrow zIndex={MODEL_PANEL_FLOATING_Z_INDEX}>
                <ActionIcon
                  aria-label={presetSortAlpha ? '恢复默认排序' : '按名称排序'}
                  size="sm"
                  variant={presetSortAlpha ? 'light' : 'subtle'}
                  onClick={() => setPresetSortAlpha((value) => !value)}
                >
                  <IconArrowsSort size={15} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          <div className="tc-model-config-modal__preset-grid">
            {mode === 'add' ? (
              <button
                type="button"
                className="tc-model-config-modal__preset-button"
                data-selected={isCustom ? 'true' : undefined}
                onClick={() => startCustomProvider()}
              >
                <span className="tc-model-config-modal__preset-icon" data-kind="custom">
                  {renderPresetIcon(null, true)}
                </span>
                <span className="tc-model-config-modal__preset-label">自定义配置</span>
                {isCustom ? (
                  <span className="tc-model-config-modal__preset-badge" aria-label="当前选中">
                    <IconCheck size={11} stroke={3} />
                  </span>
                ) : null}
              </button>
            ) : null}

            {visiblePresets.map((preset) => {
              const selected = selectedPresetId === preset.id
              const provider = findProvider(config, preset.providerKey)
              const apiConfigured = isApiConfigured(provider)
              return (
                <button
                  key={preset.id}
                  type="button"
                  className="tc-model-config-modal__preset-button"
                  data-selected={selected ? 'true' : undefined}
                  title={preset.providerName}
                  onClick={() => setPresetByTab(preset)}
                >
                  <span className="tc-model-config-modal__preset-icon" data-kind={preset.group}>
                    {renderPresetIcon(preset)}
                    <span className="tc-model-config-modal__preset-initial">{providerInitial(preset.providerName)}</span>
                  </span>
                  <span className="tc-model-config-modal__preset-copy">
                    <span className="tc-model-config-modal__preset-label">{preset.providerName}</span>
                    <span
                      className="tc-model-config-modal__preset-api-status"
                      data-configured={apiConfigured ? 'true' : 'false'}
                    >
                      {apiConfigurationLabel(provider)}
                    </span>
                  </span>
                  {selected ? (
                    <span className="tc-model-config-modal__preset-badge" aria-label="当前选中">
                      <IconCheck size={11} stroke={3} />
                    </span>
                  ) : null}
                </button>
              )
            })}

            {visiblePresets.length === 0 ? (
              <div className="tc-model-config-modal__preset-empty">
                {mode === 'select' ? '暂无可选供应商，请先到添加模块新增。' : '没有匹配的候选供应商，可使用自定义配置。'}
              </div>
            ) : null}
          </div>
        </div>

        <Paper className="tc-model-config-modal__form" withBorder p="xs" radius="sm">
          {isCustom ? (
            <Stack gap={6}>
              <Group grow>
                <TextInput size="xs" label="供应商标识" placeholder="例如 openai-compatible" value={customProviderKey} onChange={(e) => setCustomProviderKey(e.currentTarget.value)} disabled={saving} />
                <TextInput size="xs" label="显示名称" placeholder="例如 My Gateway" value={customProviderName} onChange={(e) => setCustomProviderName(e.currentTarget.value)} disabled={saving} />
              </Group>
              <TextInput size="xs" label="Base URL" placeholder="https://api.example.com/v1" value={customBaseUrl} onChange={(e) => setCustomBaseUrl(e.currentTarget.value)} disabled={saving} />
              <Group grow align="flex-end">
                <Select size="xs" label="鉴权方式" data={AUTH_TYPE_OPTIONS} value={customAuthType} onChange={(value) => { if (isAuthType(value)) setCustomAuthType(value) }} disabled={saving} comboboxProps={{ withinPortal: true, zIndex: MODEL_PANEL_FLOATING_Z_INDEX }} />
                <TextInput size="xs" label="Header" placeholder="Authorization" value={customAuthHeader} onChange={(e) => setCustomAuthHeader(e.currentTarget.value)} disabled={saving || customAuthType !== 'x-api-key'} />
                <TextInput size="xs" label="Query 参数" placeholder="key" value={customAuthQueryParam} onChange={(e) => setCustomAuthQueryParam(e.currentTarget.value)} disabled={saving || customAuthType !== 'query'} />
                {tab === 'agent' || tab === 'critic' ? (
                  <Select
                    size="xs"
                    label="调用协议"
                    data={API_PROTOCOL_OPTIONS}
                    value={customApiProtocol}
                    onChange={(value) => { if (isApiProtocol(value)) setCustomApiProtocol(value) }}
                    disabled={saving}
                    comboboxProps={{ withinPortal: true, zIndex: MODEL_PANEL_FLOATING_Z_INDEX }}
                  />
                ) : null}
              </Group>
              {tab === 'critic' && !supportsNativeVideoProtocol(customApiProtocol) ? (
                <Text size="xs" c="orange">{nativeVideoCapabilityNote(customApiProtocol)}</Text>
              ) : null}
              <Divider label="模型列表" labelPosition="left" />
              {renderModelEditor(saving)}
              <PasswordInput size="xs" label="API Key" placeholder="只需要填这一个密钥" value={apiKey} onChange={(e) => setApiKey(e.currentTarget.value)} disabled={saving} leftSection={<IconKey size={14} />} />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  保存后会启用供应商，并使用列表中标记为默认的模型。
                </Text>
                <Button loading={saving} onClick={() => void handleSaveCustom()}>保存并启用</Button>
              </Group>
            </Stack>
          ) : selectedPreset ? (
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Stack gap={0}>
                  <Text fw={700} size="sm">{selectedPreset.providerName}</Text>
                  <Text size="xs" c="dimmed">{selectedPreset.baseUrl || '自定义 Base URL'}</Text>
                </Stack>
                <Group gap={6}>
                  <Badge className="tc-model-config-modal__provider-origin" color={mode === 'select' ? 'blue' : 'gray'} variant="light">
                    {mode === 'select' ? (isDefaultPreset(selectedPreset) ? '内置' : '已添加') : '候选'}
                  </Badge>
                  <Badge
                    className="tc-model-config-modal__provider-api-status"
                    color={isApiConfigured(activeProvider) ? 'teal' : 'orange'}
                    variant="light"
                  >
                    {apiConfigurationLabel(activeProvider)}
                  </Badge>
                  {activeProvider ? (
                    <Tooltip
                      label={otherDefaultUsingActiveProvider
                        ? `该供应商仍被 ${SLOT_LABEL[otherDefaultUsingActiveProvider.slot]} 使用`
                        : '删除当前供应商（影响所有模块）'}
                      withArrow
                      zIndex={MODEL_PANEL_FLOATING_Z_INDEX}
                    >
                      <ActionIcon
                        aria-label="删除当前供应商"
                        color="red"
                        variant="subtle"
                        disabled={saving || Boolean(otherDefaultUsingActiveProvider)}
                        onClick={() => void handleDeleteProvider()}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  ) : null}
                </Group>
              </Group>

              <PasswordInput
                label={activeProvider?.apiKeyConfigured ? 'API Key（已配置，留空则不覆盖）' : 'API Key'}
                placeholder={selectedPreset.apiKeyPlaceholder}
                value={apiKey}
                onChange={(e) => setApiKey(e.currentTarget.value)}
                disabled={saving}
                leftSection={<IconKey size={14} />}
              />

              {selectedPreset.disabledReason ? (
                <Text size="xs" c="orange">{selectedPreset.disabledReason}</Text>
              ) : null}

              {selectedPreset.capabilityNote ? (
                <Text size="xs" c="orange">{selectedPreset.capabilityNote}</Text>
              ) : null}

              <Divider label="模型列表" labelPosition="left" />
              {renderModelEditor(saving || Boolean(selectedPreset.disabledReason))}

              <Group justify="flex-end" align="center">
                <Button loading={saving} disabled={Boolean(selectedPreset.disabledReason)} onClick={() => void handleSavePreset()}>
                  {mode === 'select' ? '保存配置' : '添加并启用'}
                </Button>
              </Group>
            </Stack>
          ) : null}
        </Paper>

        {error ? <Text size="xs" c="red">{error}</Text> : null}
      </Stack>
    </Modal>
  )
}
