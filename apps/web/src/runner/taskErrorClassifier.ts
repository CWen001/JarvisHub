export type TaskErrorDisplay = {
  enhancedMsg: string
}

export type TaskDiagnosticError = {
  message: string
  status?: number | string | null
  code?: string | number | null
  requestId?: string | null
  details?: unknown
  rawResponse?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readStringOrNumber(value: unknown): string | number | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const nested = value[key]
  return isRecord(nested) ? nested : null
}

function readLowerText(value: unknown): string {
  const normalized = readStringOrNumber(value)
  return normalized == null ? '' : String(normalized).toLowerCase()
}

export function isSafetyBlockedError(err: unknown): boolean {
  const errorRecord = isRecord(err) ? err : null
  const details = readNestedRecord(errorRecord, 'details')
  const upstreamData = readNestedRecord(details, 'upstreamData')
  const upstreamError = readNestedRecord(upstreamData, 'error')
  const message = readLowerText(errorRecord?.message)
  const code = readLowerText(errorRecord?.code)
  const upstreamCode = readLowerText(upstreamError?.code)
  const upstreamType = readLowerText(upstreamError?.type)
  const upstreamMessage = readLowerText(upstreamError?.message)
  const upstreamText = readLowerText(details?.upstreamText)
  const joined = [message, code, upstreamCode, upstreamType, upstreamMessage, upstreamText].join(' ')
  return (
    joined.includes('image_safety') ||
    joined.includes('safety') ||
    joined.includes('policy') ||
    joined.includes('content_filter') ||
    joined.includes('moderation') ||
    joined.includes('unsafe')
  )
}

export function resolveTaskErrorDisplay(err: unknown, fallbackMsg: string): TaskErrorDisplay {
  const errorRecord = isRecord(err) ? err : null
  const msg = readString(errorRecord?.message) || fallbackMsg || '图像模型调用失败'
  return {
    enhancedMsg: msg,
  }
}

export function buildTaskDiagnosticError(error: unknown, fallbackMsg: string): TaskDiagnosticError {
  const { enhancedMsg } = resolveTaskErrorDisplay(error, fallbackMsg)
  if (!isRecord(error)) {
    return { message: enhancedMsg }
  }

  return {
    message: enhancedMsg,
    status: readStringOrNumber(error.status),
    code: readStringOrNumber(error.code),
    requestId: readString(error.requestId),
    details: error.details,
    rawResponse: readString(error.rawResponse),
  }
}
