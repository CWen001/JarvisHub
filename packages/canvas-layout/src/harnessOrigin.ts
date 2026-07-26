export type CanvasHarnessOrigin = {
  conversationTurnId: string
  conversationTurnIndex: number
  agentRunId: string
  agentId: string
  parentToolCallId?: string
  llmTurnIndex: number
  executionBatchIndex: number
  executionBatchCallIndex: number
  executionBatchCallCount: number
  toolCallIndex: number
  toolCallId: string
}

export type CanvasInvocationSegment = {
  agentId: string
  layoutStageIndex: number
  executionBatchCallIndex: number
  executionBatchCallCount: number
  toolCallIndex: number
  toolCallId: string
}

export type CanvasLayoutItemSegment = {
  index: number
  count: number
}

export type CanvasHarnessOriginV2 = CanvasHarnessOrigin & {
  schemaVersion: 2
  invocationPath: CanvasInvocationSegment[]
  layoutStagePath: number[]
  layoutItemPath: CanvasLayoutItemSegment[]
}

const MAX_INVOCATION_DEPTH = 8

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function readInvocationSegment(value: unknown): CanvasInvocationSegment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (
    !isNonEmptyString(record.agentId)
    || !isIndex(record.layoutStageIndex)
    || !isIndex(record.executionBatchCallIndex)
    || !isIndex(record.executionBatchCallCount)
    || record.executionBatchCallCount === 0
    || record.executionBatchCallIndex >= record.executionBatchCallCount
    || !isIndex(record.toolCallIndex)
    || !isNonEmptyString(record.toolCallId)
  ) {
    return null
  }
  return {
    agentId: record.agentId,
    layoutStageIndex: record.layoutStageIndex,
    executionBatchCallIndex: record.executionBatchCallIndex,
    executionBatchCallCount: record.executionBatchCallCount,
    toolCallIndex: record.toolCallIndex,
    toolCallId: record.toolCallId,
  }
}

function readLayoutItemSegment(value: unknown): CanvasLayoutItemSegment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (
    !isIndex(record.index)
    || !isIndex(record.count)
    || record.count === 0
    || record.index >= record.count
  ) {
    return null
  }
  return { index: record.index, count: record.count }
}

export function readCanvasHarnessOrigin(value: unknown): CanvasHarnessOrigin | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const parentToolCallId = record.parentToolCallId

  if (
    !isNonEmptyString(record.conversationTurnId)
    || !isIndex(record.conversationTurnIndex)
    || !isNonEmptyString(record.agentRunId)
    || !isNonEmptyString(record.agentId)
    || (parentToolCallId != null && !isNonEmptyString(parentToolCallId))
    || !isIndex(record.llmTurnIndex)
    || !isIndex(record.executionBatchIndex)
    || !isIndex(record.executionBatchCallIndex)
    || !isIndex(record.executionBatchCallCount)
    || record.executionBatchCallCount === 0
    || record.executionBatchCallIndex >= record.executionBatchCallCount
    || !isIndex(record.toolCallIndex)
    || !isNonEmptyString(record.toolCallId)
  ) {
    return null
  }

  const base: CanvasHarnessOrigin = {
    conversationTurnId: record.conversationTurnId,
    conversationTurnIndex: record.conversationTurnIndex,
    agentRunId: record.agentRunId,
    agentId: record.agentId,
    ...(parentToolCallId == null ? {} : { parentToolCallId }),
    llmTurnIndex: record.llmTurnIndex,
    executionBatchIndex: record.executionBatchIndex,
    executionBatchCallIndex: record.executionBatchCallIndex,
    executionBatchCallCount: record.executionBatchCallCount,
    toolCallIndex: record.toolCallIndex,
    toolCallId: record.toolCallId,
  }

  if (
    record.schemaVersion !== 2
    || !Array.isArray(record.invocationPath)
    || !Array.isArray(record.layoutStagePath)
    || !Array.isArray(record.layoutItemPath)
    || record.invocationPath.length === 0
    || record.invocationPath.length > MAX_INVOCATION_DEPTH
    || record.layoutStagePath.length !== record.invocationPath.length
    || record.layoutItemPath.length !== record.invocationPath.length
  ) {
    return base
  }

  const invocationPath = record.invocationPath.map(readInvocationSegment)
  const layoutItemPath = record.layoutItemPath.map(readLayoutItemSegment)
  if (
    invocationPath.some((segment) => segment == null)
    || layoutItemPath.some((segment) => segment == null)
    || !record.layoutStagePath.every(isIndex)
  ) {
    return base
  }

  const validInvocationPath = invocationPath as CanvasInvocationSegment[]
  const validLayoutItemPath = layoutItemPath as CanvasLayoutItemSegment[]
  return {
    ...base,
    schemaVersion: 2,
    invocationPath: validInvocationPath,
    layoutStagePath: [...record.layoutStagePath] as number[],
    layoutItemPath: validLayoutItemPath,
  }
}

export function isCanvasHarnessOriginV2(
  origin: CanvasHarnessOrigin,
): origin is CanvasHarnessOriginV2 {
  return (origin as Partial<CanvasHarnessOriginV2>).schemaVersion === 2
}

export function getCanvasLayoutStageKey(origin: CanvasHarnessOriginV2): string {
  return JSON.stringify([origin.conversationTurnId, origin.layoutStagePath])
}

export function compareCanvasLayoutStagePaths(left: number[], right: number[]): number {
  const sharedLength = Math.min(left.length, right.length)
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left[index] - right[index]
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

export function compareCanvasLayoutItemPaths(
  left: CanvasLayoutItemSegment[],
  right: CanvasLayoutItemSegment[],
): number {
  const sharedLength = Math.min(left.length, right.length)
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left[index].index - right[index].index
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

export function getCanvasExecutionWaveKey(origin: CanvasHarnessOrigin): string {
  return JSON.stringify([
    origin.conversationTurnId,
    origin.agentId,
    origin.llmTurnIndex,
    origin.executionBatchIndex,
  ])
}

function compareNatural(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

export function compareCanvasHarnessCalls(left: CanvasHarnessOrigin, right: CanvasHarnessOrigin): number {
  return left.executionBatchCallIndex - right.executionBatchCallIndex
    || left.toolCallIndex - right.toolCallIndex
    || compareNatural(left.toolCallId, right.toolCallId)
}
