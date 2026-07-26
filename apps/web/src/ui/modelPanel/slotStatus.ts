import type {
  ModelConfigDefaultModelDto,
  ModelConfigDefaultSlot,
  ModelConfigDto,
  ModelConfigModelDto,
  ModelConfigProviderDto,
} from '../../api/server'

export const AGENT_REQUIRED_KIND = 'multimodal' as const

export const SLOT_ORDER: readonly ModelConfigDefaultSlot[] = ['agent', 'image', 'video', 'multimodal']

export const SLOT_LABEL: Record<ModelConfigDefaultSlot, string> = {
  agent: 'Agent 大脑',
  image: 'Image 默认',
  video: 'Video 默认',
  multimodal: 'Multimodal 默认',
}

export const SLOT_HINT: Record<ModelConfigDefaultSlot, string> = {
  agent: '驱动 plan→tool→report 的多模态主模型；要求 baseUrl + apiKey + multimodal',
  image: '生成图片节点的默认模型',
  video: '生成视频节点的默认模型',
  multimodal: '多模态生成节点的默认模型',
}

export type SlotInvalidReason =
  | 'default_slot_unset'
  | 'vendor_missing'
  | 'vendor_disabled'
  | 'model_missing'
  | 'model_disabled'
  | 'kind_mismatch'
  | 'base_url_missing'
  | 'api_key_missing'

export const REASON_TEXT: Record<SlotInvalidReason, string> = {
  default_slot_unset: '未设置',
  vendor_missing: 'Provider 已被删除',
  vendor_disabled: 'Provider 已禁用',
  model_missing: '模型已被删除',
  model_disabled: '模型已禁用',
  kind_mismatch: '模型 kind 不匹配槽位',
  base_url_missing: 'Provider 缺少 Base URL',
  api_key_missing: 'Provider 未配置 API Key',
}

export type SlotStatus =
  | { state: 'unset' }
  | {
      state: 'invalid'
      reason: SlotInvalidReason
      vendorKey: string
      modelKey: string
    }
  | {
      state: 'healthy'
      vendorKey: string
      modelKey: string
      label: string
      providerName: string
    }

function expectedKind(slot: ModelConfigDefaultSlot): ModelConfigModelDto['kind'] {
  if (slot === 'agent') return AGENT_REQUIRED_KIND
  return slot
}

/**
 * Mirror of backend resolveAgentLlmCredentials / resolveModelConfigDefaultModel.
 * Agent slot enforces baseUrl + apiKey; image/video/multimodal only check vendor/model state
 * (matches the leniency the resolver is allowed to keep).
 */
export function deriveSlotStatus(
  slot: ModelConfigDefaultSlot,
  config: ModelConfigDto | null,
): SlotStatus {
  if (!config) return { state: 'unset' }
  const def = (config.defaults ?? []).find((d) => d.slot === slot)
  if (!def) return { state: 'unset' }

  const provider = (config.providers ?? []).find((p) => p.key === def.vendorKey) ?? null
  const model = (config.models ?? []).find(
    (m) => m.providerKey === def.vendorKey && m.modelKey === def.modelKey,
  ) ?? null

  const ctx = { vendorKey: def.vendorKey, modelKey: def.modelKey }

  if (!provider) return { state: 'invalid', reason: 'vendor_missing', ...ctx }
  if (!provider.enabled) return { state: 'invalid', reason: 'vendor_disabled', ...ctx }
  if (!model) return { state: 'invalid', reason: 'model_missing', ...ctx }
  if (!model.enabled) return { state: 'invalid', reason: 'model_disabled', ...ctx }
  if (model.kind !== expectedKind(slot)) return { state: 'invalid', reason: 'kind_mismatch', ...ctx }

  if (slot === 'agent') {
    if (!(provider.baseUrl ?? '').trim()) return { state: 'invalid', reason: 'base_url_missing', ...ctx }
    if (!provider.apiKeyConfigured) return { state: 'invalid', reason: 'api_key_missing', ...ctx }
  }

  return {
    state: 'healthy',
    vendorKey: def.vendorKey,
    modelKey: def.modelKey,
    label: model.label,
    providerName: provider.name,
  }
}

export type SlotEligibility =
  | { eligible: true }
  | { eligible: false; reason: SlotInvalidReason }

/**
 * Can this (model, provider) be bound to `slot` right now? Used to decide whether
 * the inline chip on a model row is clickable.
 */
export function deriveSlotEligibility(
  slot: ModelConfigDefaultSlot,
  model: ModelConfigModelDto,
  provider: ModelConfigProviderDto | null,
): SlotEligibility {
  if (model.kind !== expectedKind(slot)) return { eligible: false, reason: 'kind_mismatch' }
  if (!model.enabled) return { eligible: false, reason: 'model_disabled' }
  if (!provider) return { eligible: false, reason: 'vendor_missing' }
  if (!provider.enabled) return { eligible: false, reason: 'vendor_disabled' }
  if (slot === 'agent') {
    if (!(provider.baseUrl ?? '').trim()) return { eligible: false, reason: 'base_url_missing' }
    if (!provider.apiKeyConfigured) return { eligible: false, reason: 'api_key_missing' }
  }
  return { eligible: true }
}

/**
 * For a model row, list the slots it could potentially bind to (regardless of eligibility).
 * Ordering matches SLOT_ORDER for stable chip placement.
 */
export function candidateSlotsForModel(model: ModelConfigModelDto): ModelConfigDefaultSlot[] {
  if (model.kind === 'multimodal') return ['agent', 'multimodal']
  if (model.kind === 'image') return ['image']
  if (model.kind === 'video') return ['video']
  return []
}

/**
 * Slots currently bound to (vendorKey, modelKey).
 */
export function slotsBoundToModel(
  defaults: readonly ModelConfigDefaultModelDto[],
  vendorKey: string,
  modelKey: string,
): Set<ModelConfigDefaultSlot> {
  const out = new Set<ModelConfigDefaultSlot>()
  for (const d of defaults) {
    if (d.vendorKey === vendorKey && d.modelKey === modelKey) out.add(d.slot)
  }
  return out
}

/**
 * For a Provider header chip "服务: Agent · Image"
 */
export function slotsServedByProvider(
  defaults: readonly ModelConfigDefaultModelDto[],
  vendorKey: string,
): ModelConfigDefaultSlot[] {
  const set = new Set<ModelConfigDefaultSlot>()
  for (const d of defaults) {
    if (d.vendorKey === vendorKey) set.add(d.slot)
  }
  return SLOT_ORDER.filter((s) => set.has(s))
}
