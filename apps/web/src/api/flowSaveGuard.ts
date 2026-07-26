export const FLOW_BASE_UPDATED_AT_MISSING_MESSAGE = '当前画布缺少服务端版本，请刷新后再保存'
export const FLOW_SNAPSHOT_STALE_MESSAGE = '服务端画布已被更新，请刷新画布后再保存，避免覆盖已生成节点。'

export type FlowSaveOwnerType = 'project' | 'chapter' | 'shot'

export type FlowUpsertRequestBody = {
  id?: string
  projectId: string
  name: string
  data: unknown
  ownerType: FlowSaveOwnerType
  ownerId: string
  baseUpdatedAt?: string
  allowEmptyGraphOverwrite?: true
}

type FlowUpsertRequestInput = Omit<FlowUpsertRequestBody, 'baseUpdatedAt'> & {
  baseUpdatedAt?: string | null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function isFlowSnapshotStaleError(error: unknown): boolean {
  const record = readRecord(error)
  if (!record) return false
  const code = typeof record.code === 'string' ? record.code.trim() : ''
  const statusRaw = typeof record.status === 'number' ? record.status : Number(record.status)
  return statusRaw === 409 && code === 'flow_snapshot_stale'
}

export function buildFlowUpsertRequestBody(input: FlowUpsertRequestInput): FlowUpsertRequestBody {
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : ''
  const baseUpdatedAt =
    typeof input.baseUpdatedAt === 'string' && input.baseUpdatedAt.trim()
      ? input.baseUpdatedAt.trim()
      : ''
  if (id && !baseUpdatedAt) {
    throw new Error(FLOW_BASE_UPDATED_AT_MISSING_MESSAGE)
  }
  return {
    ...(id ? { id } : {}),
    projectId: input.projectId,
    name: input.name,
    data: input.data,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    ...(baseUpdatedAt ? { baseUpdatedAt } : {}),
    ...(input.allowEmptyGraphOverwrite === true ? { allowEmptyGraphOverwrite: true as const } : {}),
  }
}
