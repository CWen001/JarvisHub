import React from 'react'
import { Paper, Text } from '@mantine/core'
import { formatErrorMessage } from '../../../utils/formatErrorMessage'

type StatusBannerProps = {
  status: string
  lastError?: unknown
  httpStatus?: number | null
}

type DiagnosticRow = {
  label: string
  value: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringOrNumber(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function readNestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const nested = value[key]
  return isRecord(nested) ? nested : null
}

function compactJson(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function truncateDiagnostic(value: string, limit = 1200): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`
}

function pushDiagnostic(rows: DiagnosticRow[], label: string, value: unknown): void {
  const normalized = readStringOrNumber(value)
  if (!normalized) return
  rows.push({ label, value: normalized })
}

function resolveUpstreamMessage(details: Record<string, unknown> | null): string {
  if (!details) return ''
  const upstreamData = readNestedRecord(details, 'upstreamData')
  const upstreamError = readNestedRecord(upstreamData, 'error')
  return (
    readString(upstreamError?.message) ||
    readString(upstreamData?.message) ||
    readString(upstreamData?.error) ||
    readString(details.message) ||
    readString(details.upstreamText)
  )
}

function buildDiagnosticRows(input: {
  lastError: unknown
  httpStatus?: number | null
}): DiagnosticRow[] {
  const rows: DiagnosticRow[] = []
  const errorRecord = isRecord(input.lastError) ? input.lastError : null
  const details = readNestedRecord(errorRecord, 'details')

  pushDiagnostic(rows, 'HTTP 状态', input.httpStatus ?? errorRecord?.status)
  pushDiagnostic(rows, '错误代码', errorRecord?.code)
  pushDiagnostic(rows, 'requestId', errorRecord?.requestId)
  pushDiagnostic(rows, '上游状态', details?.upstreamStatus)
  pushDiagnostic(rows, '请求方法', details?.method)
  pushDiagnostic(rows, '上游接口', details?.upstreamUrl)
  const elapsedMs = details?.elapsedMs
  const timeoutMs = details?.timeoutMs
  pushDiagnostic(rows, '耗时', typeof elapsedMs === 'number' ? `${elapsedMs}ms` : '')
  pushDiagnostic(rows, '超时阈值', typeof timeoutMs === 'number' ? `${timeoutMs}ms` : '')
  pushDiagnostic(rows, '底层原因', details?.message)

  const upstreamMessage = resolveUpstreamMessage(details)
  pushDiagnostic(rows, '上游错误', upstreamMessage)

  const rawResponse = readString(errorRecord?.rawResponse)
  pushDiagnostic(rows, '原始响应', rawResponse)

  const upstreamDataText = truncateDiagnostic(compactJson(details?.upstreamData))
  pushDiagnostic(rows, '上游返回', upstreamDataText)

  const requestPayloadText = truncateDiagnostic(compactJson(details?.requestPayload ?? details?.requestBody), 900)
  pushDiagnostic(rows, '请求摘要', requestPayloadText)

  return rows.filter((row, index, list) => (
    list.findIndex((candidate) => candidate.label === row.label && candidate.value === row.value) === index
  ))
}

export function StatusBanner({ status, lastError, httpStatus }: StatusBannerProps) {
  const message = formatErrorMessage(lastError).trim()
  const diagnosticRows = buildDiagnosticRows({ lastError, httpStatus })
  if (!(status === 'error' && message)) return null
  return (
    <Paper
      className="task-node-status-banner"
      radius="md"
      p="xs"
      mb="xs"
      style={{
        background: 'rgba(239,68,68,0.1)',
        borderColor: 'rgba(239,68,68,0.3)',
        border: 'none',
      }}
    >
      <Text className="task-node-status-banner__title" size="xs" c="red.4" style={{ fontWeight: 500 }}>
        执行错误
      </Text>
      <Text className="task-node-status-banner__message" size="xs" c="red.3" mt={4} style={{ wordBreak: 'break-word' }}>
        {message}
      </Text>
      {diagnosticRows.length > 0 && (
        <details className="task-node-status-banner__details">
          <summary className="task-node-status-banner__details-summary">
            诊断详情
          </summary>
          <div className="task-node-status-banner__details-body">
            {diagnosticRows.map((row) => (
              <div className="task-node-status-banner__detail-row" key={`${row.label}:${row.value}`}>
                <Text className="task-node-status-banner__detail-label" size="xs" c="red.2">
                  {row.label}
                </Text>
                <Text className="task-node-status-banner__detail-value" size="xs" c="red.1" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {row.value}
                </Text>
              </div>
            ))}
          </div>
        </details>
      )}
    </Paper>
  )
}
