/**
 * Snapshot export trigger + SSE consumer + download trigger.
 *
 * UX:
 *   - User clicks IconCamera → showDialog opens with steps + asset progress
 *   - We capture canvas → POST /flows/:id/snapshot/export → SSE
 *   - On `done` event: trigger download via /flows/:id/snapshot/download/:token
 */
import * as React from 'react'
import { Modal, Progress, Stack, Text, Button, Group } from '@mantine/core'
import type { Node } from '@xyflow/react'
import { captureCanvasHtml } from './captureCanvasHtml'
import { getAuthToken, getAuthTokenFromCookie } from '../../auth/store'
import { API_BASE } from '../../api/server'

export type SnapshotProgressState = {
  step: string
  detail: string
  assetCompleted: number
  assetTotal: number
  failedCount: number
  status: 'idle' | 'capturing' | 'streaming' | 'done' | 'error'
  errorMessage: string | null
  downloadUrl: string | null
}

const INITIAL_STATE: SnapshotProgressState = {
  step: '',
  detail: '',
  assetCompleted: 0,
  assetTotal: 0,
  failedCount: 0,
  status: 'idle',
  errorMessage: null,
  downloadUrl: null,
}

function authToken(): string {
  return getAuthToken() || getAuthTokenFromCookie() || ''
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || 'Error'
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const evt = err as { type?: unknown; target?: unknown }
    if (typeof evt.type === 'string') {
      const tgt = evt.target as { src?: string; tagName?: string } | null
      const src = tgt && typeof tgt.src === 'string' ? tgt.src : ''
      return src ? `Failed to load resource: ${src}` : `Event error: ${evt.type}`
    }
  }
  return String(err)
}

function endpoint(path: string): string {
  const base = (API_BASE || '').replace(/\/+$/, '')
  return base ? `${base}${path}` : path
}

async function streamSnapshotExport(
  flowId: string,
  body: unknown,
  onEvent: (eventName: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const token = authToken()
  const res = await fetch(endpoint(`/flows/${flowId}/snapshot/export`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    let detail = ''
    try { detail = await res.text() } catch { /* ignore */ }
    throw new Error(`POST snapshot/export failed (${res.status}) ${detail.slice(0, 200)}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      let evtName = 'message'
      let dataStr = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) evtName = line.slice(6).trim()
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim()
      }
      if (!dataStr) continue
      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(dataStr)
      } catch {
        // ignore parse failure
      }
      onEvent(evtName, parsed)
    }
  }
}

export function useSnapshotExport(flowId: string | null | undefined) {
  const [open, setOpen] = React.useState(false)
  const [state, setState] = React.useState<SnapshotProgressState>(INITIAL_STATE)

  const trigger = React.useCallback(async (nodes: Node[]) => {
    if (!flowId) {
      setState({ ...INITIAL_STATE, status: 'error', errorMessage: 'No flow is currently open' })
      setOpen(true)
      return
    }
    if (!nodes.length) {
      setState({ ...INITIAL_STATE, status: 'error', errorMessage: 'Canvas is empty — nothing to export' })
      setOpen(true)
      return
    }
    setOpen(true)
    setState({ ...INITIAL_STATE, status: 'capturing', step: 'Capturing canvas snapshot…', detail: '' })
    try {
      const snapshot = await captureCanvasHtml(nodes)
      setState((s) => ({ ...s, status: 'streaming', step: 'Snapshot captured. Collecting assets…', detail: '' }))
      await streamSnapshotExport(
        flowId,
        {
          canvasInnerHtml: snapshot.canvasInnerHtml,
          fontCss: snapshot.fontCss,
          pageCss: snapshot.pageCss,
          canvasBounds: snapshot.bounds,
          nodeMeta: snapshot.nodeMeta,
          videoInlineThresholdBytes: 20 * 1024 * 1024,
        },
        (evtName, data) => {
          setState((s) => {
            if (evtName === 'asset-progress') {
              return {
                ...s,
                assetCompleted: Number(data.completed) || s.assetCompleted,
                assetTotal: Number(data.total) || s.assetTotal,
                step: 'Materializing assets',
                detail: `${Number(data.completed) || 0} / ${Number(data.total) || 0}`,
              }
            }
            if (evtName === 'collected-assets') {
              const payload = (data.payload || data) as { count?: number }
              return { ...s, step: `Collected ${payload?.count ?? 0} asset(s)` }
            }
            if (evtName === 'parse-flow') return { ...s, step: 'Parsing flow data…' }
            if (evtName === 'load-conversation') return { ...s, step: 'Loading conversation history…' }
            if (evtName === 'collect-assets') return { ...s, step: 'Collecting canvas assets…' }
            if (evtName === 'build-html') return { ...s, step: 'Assembling HTML…' }
            if (evtName === 'started') return { ...s, step: 'Starting export…' }
            if (evtName === 'done') {
              const payload = (data.payload || data) as {
                downloadToken?: string
                bytes?: number
                failedCount?: number
              }
              const downloadToken = String(payload?.downloadToken || '')
              if (!downloadToken) return s
              const url = endpoint(`/flows/${flowId}/snapshot/download/${downloadToken}`)
              return {
                ...s,
                status: 'done',
                step: 'Export complete',
                detail: payload?.bytes ? `${(payload.bytes / 1024 / 1024).toFixed(2)} MB` : '',
                failedCount: Number(payload?.failedCount) || 0,
                downloadUrl: url,
              }
            }
            if (evtName === 'error') {
              return {
                ...s,
                status: 'error',
                errorMessage: String((data as { message?: unknown }).message || 'Export failed'),
              }
            }
            return s
          })
        },
      )
    } catch (err) {
      const msg = describeError(err)
      setState((s) => ({ ...s, status: 'error', errorMessage: msg }))
    }
  }, [flowId])

  const close = React.useCallback(() => {
    setOpen(false)
    setState(INITIAL_STATE)
  }, [])

  const triggerDownload = React.useCallback(() => {
    if (!state.downloadUrl) return
    const token = authToken()
    // Use programmatic fetch + Blob to attach Authorization header.
    void fetch(state.downloadUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Download failed (${res.status})`)
        const blob = await res.blob()
        const cd = res.headers.get('Content-Disposition') || ''
        let filename = 'snapshot.html'
        const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i)
        if (m) {
          try { filename = decodeURIComponent(m[1]) } catch { filename = m[1] }
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 5_000)
      })
      .catch((err: unknown) => {
        const msg = describeError(err)
        setState((s) => ({ ...s, status: 'error', errorMessage: msg }))
      })
  }, [state.downloadUrl])

  return { open, state, trigger, close, triggerDownload }
}

export function SnapshotProgressDialog(props: {
  open: boolean
  state: SnapshotProgressState
  onClose: () => void
  onDownload: () => void
}) {
  const { open, state, onClose, onDownload } = props
  const pct = state.assetTotal > 0
    ? Math.min(100, Math.round((state.assetCompleted / state.assetTotal) * 100))
    : (state.status === 'done' ? 100 : (state.status === 'capturing' ? 5 : 30))

  const closable = state.status === 'done' || state.status === 'error' || state.status === 'idle'

  return (
    <Modal
      className="snapshot-export-modal"
      opened={open}
      onClose={onClose}
      title={<span className="snapshot-export-modal-title">Export canvas snapshot</span>}
      withCloseButton={closable}
      closeOnClickOutside={closable}
      closeOnEscape={closable}
      size="lg"
      centered
    >
      <Stack className="snapshot-export-modal-stack" gap="sm">
        <Text className="snapshot-export-step" size="sm">{state.step || 'Preparing…'}</Text>
        {state.detail ? (
          <Text className="snapshot-export-detail" size="xs" c="dimmed">{state.detail}</Text>
        ) : null}
        <Progress className="snapshot-export-progress" value={pct} animated={state.status !== 'done' && state.status !== 'error'} />
        {state.status === 'done' && state.failedCount > 0 ? (
          <Text className="snapshot-export-failure-note" size="xs" c="orange">
            {state.failedCount} asset(s) failed to export — see notes inside the HTML
          </Text>
        ) : null}
        {state.status === 'error' ? (
          <Text className="snapshot-export-error" size="sm" c="red">
            {state.errorMessage || 'Unknown error'}
          </Text>
        ) : null}
        <Group className="snapshot-export-modal-actions" justify="flex-end" mt="xs">
          {state.status === 'done' && state.downloadUrl ? (
            <Button className="snapshot-export-download-btn" onClick={onDownload}>
              Download .html
            </Button>
          ) : null}
          <Button
            className="snapshot-export-close-btn"
            variant="subtle"
            onClick={onClose}
            disabled={!closable}
          >
            {closable ? 'Close' : 'Processing…'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
