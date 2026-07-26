import { useEffect, useState } from 'react'
import { getModelConfig, type ModelCatalogModelKind, type ModelConfigModelDto } from '../api/server'
import type { ModelOption, NodeKind } from './models'

export const MODEL_REFRESH_EVENT = 'canvas-models-refresh'

type RefreshDetail = 'openai' | 'anthropic' | 'all' | undefined

const catalogOptionsCache = new Map<string, ModelOption[]>()
const catalogPromiseCache = new Map<string, Promise<ModelOption[]>>()
let enabledVendorKeysCache: Set<string> | null = null
let enabledVendorKeysPromise: Promise<Set<string>> | null = null

const HIDDEN_IMAGE_MODEL_ID_RE = /^(gemini-.*-image(?:-(?:landscape|portrait))?|imagen-.*-(?:landscape|portrait))$/i

function normalizeModelId(value: string): string {
  if (!value) return ''
  return value.startsWith('models/') ? value.slice(7) : value
}

export function filterHiddenOptionsByKind(options: ModelOption[], kind?: NodeKind): ModelOption[] {
  if (kind !== 'image' && kind !== 'imageEdit') return options
  return options.filter((opt) => {
    const normalizedValue = normalizeModelId(opt.value)
    if (!HIDDEN_IMAGE_MODEL_ID_RE.test(normalizedValue)) return true
    const normalizedAlias = normalizeModelId(trimModelIdentifier(opt.modelAlias))
    return Boolean(normalizedAlias && normalizedAlias !== normalizedValue)
  })
}

function invalidateAvailableCache() {
  catalogOptionsCache.clear()
  catalogPromiseCache.clear()
  enabledVendorKeysCache = null
  enabledVendorKeysPromise = null
}

export function notifyModelOptionsRefresh(detail?: RefreshDetail) {
  invalidateAvailableCache()
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent<RefreshDetail>(MODEL_REFRESH_EVENT, { detail }))
  }
}

async function getEnabledVendorKeys(): Promise<Set<string>> {
  if (enabledVendorKeysCache) return enabledVendorKeysCache
  if (!enabledVendorKeysPromise) {
    enabledVendorKeysPromise = (async () => {
      try {
        const config = await getModelConfig()
        const enabled = new Set(
          (Array.isArray(config.providers) ? config.providers : [])
            .filter((v) => Boolean(v?.enabled))
            .map((v) => String(v?.key || '').trim().toLowerCase())
            .filter(Boolean),
        )
        enabledVendorKeysCache = enabled
        return enabled
      } finally {
        enabledVendorKeysPromise = null
      }
    })()
  }
  return enabledVendorKeysPromise
}

function resolveCatalogKind(kind?: NodeKind): ModelCatalogModelKind {
  if (kind === 'image' || kind === 'imageEdit') {
    return 'image'
  }
  if (kind === 'video') {
    return 'video'
  }
  return 'multimodal'
}

function trimModelIdentifier(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function trimVendorIdentifier(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function inferImageModelVendor(value: string | null | undefined): string | null {
  const normalized = trimModelIdentifier(value).toLowerCase()
  if (!normalized) return null
  if (
    normalized.includes('gpt') ||
    normalized.includes('openai') ||
    normalized.includes('dall') ||
    normalized.includes('o3-')
  ) {
    return 'openai'
  }
  if (normalized.includes('qwen')) {
    return 'qwen'
  }
  if (
    normalized.includes('gemini') ||
    normalized.includes('banana') ||
    normalized.includes('imagen')
  ) {
    return 'gemini'
  }
  return null
}

export function findModelOptionByIdentifier(
  options: readonly ModelOption[],
  value: string | null | undefined,
): ModelOption | null {
  const identifier = trimModelIdentifier(value)
  const normalizedIdentifier = normalizeModelId(identifier)
  if (!identifier) return null
  return (
    options.find((option) => {
      const rawValue = trimModelIdentifier(option.value)
      const rawModelKey = trimModelIdentifier(option.modelKey)
      const rawModelAlias = trimModelIdentifier(option.modelAlias)
      const normalizedValue = normalizeModelId(rawValue)
      const normalizedModelKey = normalizeModelId(rawModelKey)
      const normalizedModelAlias = normalizeModelId(rawModelAlias)
      return (
        identifier === rawValue ||
        identifier === rawModelKey ||
        identifier === rawModelAlias ||
        normalizedIdentifier === normalizedValue ||
        normalizedIdentifier === normalizedModelKey ||
        normalizedIdentifier === normalizedModelAlias
      )
    }) || null
  )
}

export function getModelOptionRequestAlias(
  options: readonly ModelOption[],
  value: string | null | undefined,
): string {
  const identifier = trimModelIdentifier(value)
  const matched = findModelOptionByIdentifier(options, identifier)
  const alias = trimModelIdentifier(matched?.modelAlias)
  if (alias) return alias
  const modelKey = trimModelIdentifier(matched?.modelKey)
  if (modelKey) return modelKey
  const fallbackValue = trimModelIdentifier(matched?.value)
  if (fallbackValue) return fallbackValue
  return identifier
}

export function toCatalogModelOptions(items: ModelConfigModelDto[]): ModelOption[] {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const out: ModelOption[] = []
  for (const item of items) {
    const alias = typeof item?.modelAlias === 'string' ? item.modelAlias.trim() : ''
    const modelKey = typeof item?.modelKey === 'string' ? item.modelKey.trim() : ''
    const value = modelKey || alias
    if (!value || seen.has(value)) continue
    seen.add(value)
    const labelText = typeof item?.label === 'string' ? item.label.trim() : ''
    const label = alias || labelText || value
    const vendor = typeof item?.providerKey === 'string' ? item.providerKey : undefined
    out.push({
      value,
      label,
      vendor,
      modelKey: modelKey || value,
      modelAlias: alias || null,
      meta: item?.options,
    })
  }
  return out
}

export type ResolvedExecutableImageModel = {
  value: string
  vendor: string | null
  didFallback: boolean
  shouldWriteBack: boolean
  reason: 'missing' | 'unavailable' | 'canonicalized' | 'catalogUnavailable' | null
  source: 'requested' | 'default' | 'firstAvailable' | 'backendDefault'
}

type ResolveExecutableImageModelParams = {
  kind: 'image' | 'imageEdit'
  value: string | null | undefined
  vendor?: string | null | undefined
  allowBackendDefault?: boolean
}

function resolveModelOptionVendor(
  option: ModelOption | null,
  explicitVendor: string | null,
  resolvedValue: string,
): string | null {
  const optionVendor = trimVendorIdentifier(option?.vendor)
  if (optionVendor) return optionVendor
  if (explicitVendor) return explicitVendor
  return inferImageModelVendor(resolvedValue)
}

export function resolveExecutableImageModelFromOptions(
  options: readonly ModelOption[],
  params: ResolveExecutableImageModelParams,
): ResolvedExecutableImageModel {
  const requestedValue = trimModelIdentifier(params.value)
  const requestedVendor = trimVendorIdentifier(params.vendor)
  const requestedOption = findModelOptionByIdentifier(options, requestedValue)

  if (requestedOption) {
    const resolvedValue = trimModelIdentifier(requestedOption.value)
    const resolvedVendor = resolveModelOptionVendor(requestedOption, requestedVendor || null, resolvedValue)
    const reason =
      requestedValue && requestedValue !== resolvedValue
        ? 'canonicalized'
        : null
    return {
      value: resolvedValue,
      vendor: resolvedVendor,
      didFallback: false,
      shouldWriteBack: reason !== null || requestedVendor !== trimVendorIdentifier(resolvedVendor),
      reason,
      source: 'requested',
    }
  }

  if (options.length === 0) {
    throw new Error('未找到可用图片模型：请先在系统模型管理中启用 image 模型。')
  }

  if (requestedValue) {
    throw new Error(`图片模型不可用：${requestedValue} 不在系统模型管理启用列表中。`)
  }
  throw new Error('图片模型未配置：请先在节点中选择系统模型管理中已启用的 image 模型。')
}

async function getCatalogModelOptions(kind?: NodeKind): Promise<ModelOption[]> {
  const catalogKind = resolveCatalogKind(kind)
  const cacheKey = catalogKind
  const cached = catalogOptionsCache.get(cacheKey)
  if (cached) return cached
  const inflight = catalogPromiseCache.get(cacheKey)
  if (inflight) return inflight
  const promise = (async () => {
    try {
      const config = await getModelConfig()
      const enabledVendorKeys = await getEnabledVendorKeys()
      const filteredRows = (Array.isArray(config.models) ? config.models : []).filter((row) => {
        if (row.kind !== catalogKind || row.enabled !== true) return false
        const vendorKey = String(row?.providerKey || '').trim().toLowerCase()
        if (!vendorKey) return false
        if (!enabledVendorKeys.size) return true
        return enabledVendorKeys.has(vendorKey)
      })
      const normalized = toCatalogModelOptions(filteredRows)
      catalogOptionsCache.set(cacheKey, normalized)
      return normalized
    } finally {
      catalogPromiseCache.delete(cacheKey)
    }
  })()
  catalogPromiseCache.set(cacheKey, promise)
  return promise
}

export async function preloadModelOptions(kind?: NodeKind): Promise<ModelOption[]> {
  const catalogOptions = await getCatalogModelOptions(kind)
  return filterHiddenOptionsByKind(catalogOptions, kind)
}

export async function resolveExecutableImageModel(params: {
  kind: 'image' | 'imageEdit'
  value: string | null | undefined
  vendor?: string | null | undefined
  allowBackendDefault?: boolean
}): Promise<ResolvedExecutableImageModel> {
  const options = await preloadModelOptions(params.kind)
  return resolveExecutableImageModelFromOptions(options, params)
}

export function useModelOptions(kind?: NodeKind): ModelOption[] {
  const [options, setOptions] = useState<ModelOption[]>([])
  const [refreshSeq, setRefreshSeq] = useState(0)

  useEffect(() => {
    setOptions([])
  }, [kind])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setRefreshSeq((prev) => prev + 1)
    window.addEventListener(MODEL_REFRESH_EVENT, handler)
    return () => window.removeEventListener(MODEL_REFRESH_EVENT, handler)
  }, [])

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        const catalogOptions = await preloadModelOptions(kind)
        if (!canceled) setOptions(catalogOptions)
      } catch {
        if (!canceled) setOptions([])
      }
    })()

    return () => {
      canceled = true
    }
  }, [kind, refreshSeq])

  return options
}
