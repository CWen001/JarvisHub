import React from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

const CORE_VERSION = '0.12.9'
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`

export type TrimRunInput = {
  source: ArrayBuffer
  start: number
  end: number
  inputName?: string
}

export type UseFFmpegTrim = {
  loading: boolean
  ready: boolean
  loadError: string | null
  run: (input: TrimRunInput) => Promise<Blob>
  terminate: () => void
}

export function useFFmpegTrim(): UseFFmpegTrim {
  const ffmpegRef = React.useRef<FFmpeg | null>(null)
  const loadingRef = React.useRef(false)
  const [loading, setLoading] = React.useState(false)
  const [ready, setReady] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const ensureLoaded = React.useCallback(async (): Promise<FFmpeg> => {
    if (ffmpegRef.current && ready) return ffmpegRef.current
    if (loadingRef.current) {
      await new Promise<void>((resolve) => {
        const t = setInterval(() => {
          if (!loadingRef.current) {
            clearInterval(t)
            resolve()
          }
        }, 50)
      })
      if (ffmpegRef.current) return ffmpegRef.current
    }

    loadingRef.current = true
    setLoading(true)
    setLoadError(null)
    try {
      const ffmpeg = new FFmpeg()
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      ])
      await ffmpeg.load({ coreURL, wasmURL })
      ffmpegRef.current = ffmpeg
      setReady(true)
      return ffmpeg
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setLoadError(msg)
      throw new Error(`FFmpeg 加载失败：${msg}`)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [ready])

  const run = React.useCallback(
    async (input: TrimRunInput): Promise<Blob> => {
      if (!Number.isFinite(input.start) || !Number.isFinite(input.end)) {
        throw new Error('起始/结束时间必须是有限数字')
      }
      if (input.start < 0) throw new Error('起始时间不能小于 0')
      if (input.end <= input.start) throw new Error('结束时间必须大于起始时间')

      const ffmpeg = await ensureLoaded()
      const inputName = input.inputName || 'input.mp4'
      const outputName = 'output.mp4'

      await ffmpeg.writeFile(inputName, new Uint8Array(input.source))
      try {
        await ffmpeg.exec([
          '-ss',
          input.start.toFixed(3),
          '-to',
          input.end.toFixed(3),
          '-i',
          inputName,
          '-c',
          'copy',
          '-avoid_negative_ts',
          'make_zero',
          outputName,
        ])
        const data = await ffmpeg.readFile(outputName)
        if (!(data instanceof Uint8Array)) {
          throw new Error('FFmpeg readFile 返回了非二进制数据')
        }
        // Force-copy into a fresh ArrayBuffer so the Blob constructor type accepts it
        // (`Uint8Array<ArrayBufferLike>` may include SharedArrayBuffer in TS dom lib).
        const out = new Uint8Array(data.byteLength)
        out.set(data)
        return new Blob([out.buffer], { type: 'video/mp4' })
      } finally {
        try {
          await ffmpeg.deleteFile(inputName)
        } catch {
          // ignore cleanup errors
        }
        try {
          await ffmpeg.deleteFile(outputName)
        } catch {
          // ignore cleanup errors
        }
      }
    },
    [ensureLoaded],
  )

  const terminate = React.useCallback(() => {
    const ff = ffmpegRef.current
    if (ff) {
      try {
        ff.terminate()
      } catch {
        // ignore
      }
    }
    ffmpegRef.current = null
    setReady(false)
    setLoading(false)
    loadingRef.current = false
  }, [])

  React.useEffect(() => {
    return () => {
      const ff = ffmpegRef.current
      if (ff) {
        try {
          ff.terminate()
        } catch {
          // ignore
        }
      }
      ffmpegRef.current = null
    }
  }, [])

  return { loading, ready, loadError, run, terminate }
}
