import type { Node } from '@xyflow/react'
import {
  PUBLIC_FLOW_APPROVAL_STATUS_VALUES,
  PUBLIC_FLOW_CREATION_STAGE_VALUES,
  PUBLIC_FLOW_PRODUCTION_LAYER_VALUES,
  type PublicFlowApprovalStatus,
  type PublicFlowCreationStage,
  type PublicFlowProductionLayer,
} from '@jarvishub/flow-production-metadata'

export const PRODUCTION_LAYER_VALUES = PUBLIC_FLOW_PRODUCTION_LAYER_VALUES
export type ProductionLayer = PublicFlowProductionLayer

export const CREATION_STAGE_VALUES = PUBLIC_FLOW_CREATION_STAGE_VALUES
export type CreationStage = PublicFlowCreationStage

export const APPROVAL_STATUS_VALUES = PUBLIC_FLOW_APPROVAL_STATUS_VALUES
export type ApprovalStatus = PublicFlowApprovalStatus

export type ProductionNodeMeta = {
  productionLayer?: ProductionLayer
  creationStage?: CreationStage
  approvalStatus?: ApprovalStatus
  sourceEvidence?: string[]
}

const PRODUCTION_LAYER_SET = new Set<string>(PRODUCTION_LAYER_VALUES)
const CREATION_STAGE_SET = new Set<string>(CREATION_STAGE_VALUES)
const APPROVAL_STATUS_SET = new Set<string>(APPROVAL_STATUS_VALUES)

const IMAGE_KIND_SET = new Set<string>([
  'image',
  'imageedit',
  'texttoimage',
  'imagefission',
])

const VIDEO_KIND_SET = new Set<string>(['composevideo', 'video'])
const EVIDENCE_KIND_SET = new Set<string>(['noveldoc', 'scriptdoc'])
const CONSTRAINT_KIND_SET = new Set<string>(['text'])
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function normalizeStringArray(value: unknown, limit: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const normalized = value
    .map((item) => readTrimmedString(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, limit)
  return normalized.length ? normalized : undefined
}

export function normalizeProductionLayer(value: unknown): ProductionLayer | undefined {
  const normalized = readTrimmedString(value)
  if (!normalized || !PRODUCTION_LAYER_SET.has(normalized)) return undefined
  return normalized as ProductionLayer
}

export function normalizeCreationStage(value: unknown): CreationStage | undefined {
  const normalized = readTrimmedString(value)
  if (!normalized || !CREATION_STAGE_SET.has(normalized)) return undefined
  return normalized as CreationStage
}

export function normalizeApprovalStatus(value: unknown): ApprovalStatus | undefined {
  const normalized = readTrimmedString(value)
  if (!normalized || !APPROVAL_STATUS_SET.has(normalized)) return undefined
  return normalized as ApprovalStatus
}

export function normalizeSourceEvidence(value: unknown): string[] | undefined {
  return normalizeStringArray(value, 24)
}

function normalizeKind(kind: unknown): string {
  return readTrimmedString(kind)?.toLowerCase() || ''
}

export function inferProductionNodeMeta(kind: unknown): Pick<ProductionNodeMeta, 'productionLayer' | 'creationStage'> {
  const normalizedKind = normalizeKind(kind)
  if (EVIDENCE_KIND_SET.has(normalizedKind)) {
    return {
      productionLayer: 'evidence',
      creationStage: 'source_understanding',
    }
  }
  if (CONSTRAINT_KIND_SET.has(normalizedKind)) {
    return {
      productionLayer: 'constraints',
      creationStage: 'constraint_definition',
    }
  }
  if (IMAGE_KIND_SET.has(normalizedKind)) {
    return {
      productionLayer: 'expansion',
      creationStage: 'single_variable_expansion',
    }
  }
  if (VIDEO_KIND_SET.has(normalizedKind)) {
    return {
      productionLayer: 'execution',
      creationStage: 'video_plan',
    }
  }
  return {}
}

function inferDefaultApprovalStatus(layer: ProductionLayer | undefined): ApprovalStatus | undefined {
  if (layer === 'anchors' || layer === 'expansion' || layer === 'execution') {
    return 'needs_confirmation'
  }
  return undefined
}

export function normalizeProductionNodeMetaRecord(
  input: Record<string, unknown>,
  options?: {
    kind?: unknown
  },
): Record<string, unknown> {
  const kind = options?.kind ?? input.kind
  const inferred = inferProductionNodeMeta(kind)
  const productionLayer = normalizeProductionLayer(input.productionLayer) ?? inferred.productionLayer
  const creationStage = normalizeCreationStage(input.creationStage) ?? inferred.creationStage
  const approvalStatus =
    normalizeApprovalStatus(input.approvalStatus) ??
    normalizeApprovalStatus(input.status) ??
    inferDefaultApprovalStatus(productionLayer)
  const sourceEvidence = normalizeSourceEvidence(input.sourceEvidence)

  return {
    ...input,
    ...(productionLayer ? { productionLayer } : null),
    ...(creationStage ? { creationStage } : null),
    ...(approvalStatus ? { approvalStatus } : null),
    ...(sourceEvidence ? { sourceEvidence } : null),
  }
}

export function normalizeProductionNodeMeta(node: Node): Node {
  const data = asRecord(node.data)
  return {
    ...node,
    data: normalizeProductionNodeMetaRecord(data, {
      kind: data.kind ?? node.type,
    }),
  }
}

export function getNodeProductionMeta(node: { type?: string; data?: unknown }): ProductionNodeMeta {
  const data = asRecord(node.data)
  const inferred = inferProductionNodeMeta(data.kind ?? node.type)
  const productionLayer = normalizeProductionLayer(data.productionLayer) ?? inferred.productionLayer
  const creationStage = normalizeCreationStage(data.creationStage) ?? inferred.creationStage
  const approvalStatus =
    normalizeApprovalStatus(data.approvalStatus) ??
    normalizeApprovalStatus(data.status) ??
    inferDefaultApprovalStatus(productionLayer)
  const sourceEvidence = normalizeSourceEvidence(data.sourceEvidence)
  return {
    ...(productionLayer ? { productionLayer } : null),
    ...(creationStage ? { creationStage } : null),
    ...(approvalStatus ? { approvalStatus } : null),
    ...(sourceEvidence ? { sourceEvidence } : null),
  }
}
