import React from 'react'
import { API_BASE, uploadServerAssetFile } from '../api/server'
import { getAuthToken, getAuthTokenFromCookie } from '../auth/store'
import { useAuth } from '../auth/store'
import { toast } from './toast'
import { useUIStore } from './uiStore'
import { useFFmpegTrim } from './webcut/useFFmpegTrim'
import { WebCutVideoEditModal } from './WebCutVideoEditModal'

function buildProxyVideoFetchUrl(rawVideoUrl: string): string {
  const base = (API_BASE || '').trim().replace(/\/+$/, '')
  const origin = typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') : ''
  const root = base || origin
  if (!root) return rawVideoUrl
  return `${root}/assets/proxy-video?url=${encodeURIComponent(rawVideoUrl)}`
}

async function fetchVideoArrayBuffer(rawVideoUrl: string, token: string | null): Promise<ArrayBuffer> {
  const url = buildProxyVideoFetchUrl(rawVideoUrl)
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, { headers, credentials: 'include' })
  if (!res.ok) {
    throw new Error(`拉取原视频失败:HTTP ${res.status}`)
  }
  return await res.arrayBuffer()
}

export function WebCutVideoEditModalHost(): JSX.Element | null {
  const { open, payload } = useUIStore((s) => s.webcutVideoEditModal)
  const close = useUIStore((s) => s.closeWebCutVideoEditModal)
  const token = useAuth((s) => s.token)
  const trim = useFFmpegTrim()

  const [busy, setBusy] = React.useState(false)
  const [busyLabel, setBusyLabel] = React.useState<string | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setBusy(false)
      setBusyLabel(null)
      setErrorMessage(null)
    }
  }, [open])

  React.useEffect(() => {
    if (typeof document === 'undefined') return
    if (open) {
      document.body.setAttribute('data-webcut-modal-open', 'true')
    } else {
      document.body.removeAttribute('data-webcut-modal-open')
    }
    return () => {
      document.body.removeAttribute('data-webcut-modal-open')
    }
  }, [open])

  const handleCancel = React.useCallback(() => {
    if (busy) return
    payload?.onClose?.()
    close()
  }, [busy, close, payload])

  const handleApply = React.useCallback(
    async (range: { start: number; end: number }) => {
      if (!payload) return
      if (busy) return

      const jhToken =
        token ||
        getAuthToken() ||
        getAuthTokenFromCookie() ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('jh_token') : null)

      setErrorMessage(null)

      try {
        setBusy(true)
        setBusyLabel('正在加载原视频…')
        const sourceBuffer = await fetchVideoArrayBuffer(payload.videoUrl, jhToken)

        setBusyLabel('正在剪辑(首次会下载 ffmpeg-core ~30MB)…')
        const outBlob = await trim.run({ source: sourceBuffer, start: range.start, end: range.end })

        setBusyLabel('正在上传剪辑结果…')
        const fileBase = (payload.videoTitle || 'clip').trim() || 'clip'
        const filename = `${fileBase}.trim.mp4`
        const file = new File([outBlob], filename, { type: 'video/mp4' })
        const asset = await uploadServerAssetFile(file, filename)
        const nextUrl = typeof asset?.data?.url === 'string' ? asset.data.url.trim() : ''
        if (!nextUrl) throw new Error('上传成功但未返回可用的 url')
        const nextThumb = typeof asset?.data?.thumbnailUrl === 'string' ? asset.data.thumbnailUrl : null

        await payload.onApply({ url: nextUrl, thumbnailUrl: nextThumb, assetId: asset.id })
        toast('已应用剪辑结果', 'success')
        payload?.onClose?.()
        close()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '剪辑失败'
        setErrorMessage(msg)
        toast(msg, 'error')
      } finally {
        setBusy(false)
        setBusyLabel(null)
      }
    },
    [busy, close, payload, token, trim],
  )

  if (!open || !payload) return null

  return (
    <WebCutVideoEditModal
      opened={open}
      videoUrl={payload.videoUrl}
      videoTitle={payload.videoTitle ?? null}
      busy={busy}
      busyLabel={busyLabel}
      errorMessage={errorMessage}
      onApply={handleApply}
      onCancel={handleCancel}
    />
  )
}
