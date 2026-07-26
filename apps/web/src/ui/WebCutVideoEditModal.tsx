import React from 'react'
import { ActionIcon, Alert, Button, Group, Loader, Modal, RangeSlider, Stack, Text } from '@mantine/core'
import { IconX } from '@tabler/icons-react'

export type WebCutVideoEditModalProps = {
  opened: boolean
  videoUrl: string
  videoTitle?: string | null
  busy: boolean
  busyLabel?: string | null
  errorMessage?: string | null
  onApply: (range: { start: number; end: number }) => void
  onCancel: () => void
}

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${mm}:${ss.toString().padStart(2, '0')}`
}

export function WebCutVideoEditModal(props: WebCutVideoEditModalProps): JSX.Element | null {
  const { opened, videoUrl, videoTitle, busy, busyLabel, errorMessage, onApply, onCancel } = props
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = React.useState(0)
  const [range, setRange] = React.useState<[number, number]>([0, 0])
  const rangeRef = React.useRef<[number, number]>([0, 0])
  const [videoError, setVideoError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!opened) {
      setDuration(0)
      setRange([0, 0])
      rangeRef.current = [0, 0]
      setVideoError(null)
    }
  }, [opened])

  const handleLoadedMetadata = React.useCallback(() => {
    const d = videoRef.current?.duration ?? 0
    if (!Number.isFinite(d) || d <= 0) {
      setVideoError('无法读取视频时长（duration 不可用）')
      return
    }
    setDuration(d)
    const initial: [number, number] = [0, Number(d.toFixed(2))]
    setRange(initial)
    rangeRef.current = initial
  }, [])

  const handleVideoError = React.useCallback(() => {
    setVideoError('视频加载失败：网络错误或浏览器无法解码该视频')
  }, [])

  const handleRangeChange = React.useCallback((v: [number, number]) => {
    const prev = rangeRef.current
    const next: [number, number] = [v[0], v[1]]
    rangeRef.current = next
    setRange(next)
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
    const startMoved = Math.abs(next[0] - prev[0]) > 1e-3
    const endMoved = Math.abs(next[1] - prev[1]) > 1e-3
    const seekTo = startMoved ? next[0] : endMoved ? next[1] : null
    if (seekTo == null) return
    if (!video.paused) {
      try { video.pause() } catch { /* ignore */ }
    }
    try { video.currentTime = seekTo } catch { /* ignore */ }
  }, [])

  const canApply = !busy && duration > 0 && range[1] > range[0] && !videoError
  const clipDuration = Math.max(0, range[1] - range[0])

  if (!opened) return null

  return (
    <Modal
      className="webcut-video-edit-modal"
      opened={opened}
      onClose={onCancel}
      fullScreen
      withCloseButton={false}
      padding={0}
      styles={{
        content: { background: 'var(--mantine-color-body)', overflow: 'hidden' },
        body: {
          padding: 0,
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--mantine-color-body)',
          color: 'var(--mantine-color-text)',
        },
      }}
    >
      <div
        className="webcut-video-edit-modal__topbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          color: 'var(--mantine-color-text)',
        }}
      >
        <Text className="webcut-video-edit-modal__title" size="sm" c="dimmed">
          剪辑视频{videoTitle ? `:${videoTitle}` : ''}
        </Text>
        <ActionIcon
          className="webcut-video-edit-modal__close"
          variant="subtle"
          color="gray"
          onClick={onCancel}
          disabled={busy}
          title="关闭"
        >
          <IconX className="webcut-video-edit-modal__close-icon" size={18} />
        </ActionIcon>
      </div>

      <div
        className="webcut-video-edit-modal__stage"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 24px',
        }}
      >
        <video
          ref={videoRef}
          className="webcut-video-edit-modal__video"
          src={videoUrl}
          controls
          onLoadedMetadata={handleLoadedMetadata}
          onError={handleVideoError}
          style={{ maxWidth: '100%', maxHeight: '100%', background: 'black' }}
        />
      </div>

      <Stack
        className="webcut-video-edit-modal__panel"
        gap={12}
        style={{
          padding: '16px 24px 20px',
          background: 'var(--mantine-color-body)',
          color: 'var(--mantine-color-text)',
          borderTop: '1px solid var(--mantine-color-default-border)',
        }}
      >
        {(videoError || errorMessage) && (
          <Alert
            className="webcut-video-edit-modal__alert"
            color="red"
            variant="filled"
            withCloseButton={false}
          >
            {videoError || errorMessage}
          </Alert>
        )}

        <Group className="webcut-video-edit-modal__times" justify="space-between">
          <Text className="webcut-video-edit-modal__time-start" size="sm" c="dimmed">
            起始 {fmtTime(range[0])}
          </Text>
          <Text className="webcut-video-edit-modal__time-clip" size="sm" c="blue.6">
            片段 {fmtTime(clipDuration)}
          </Text>
          <Text className="webcut-video-edit-modal__time-end" size="sm" c="dimmed">
            结束 {fmtTime(range[1])} / 时长 {fmtTime(duration)}
          </Text>
        </Group>

        <RangeSlider
          className="webcut-video-edit-modal__slider"
          min={0}
          max={Math.max(duration, 0.1)}
          step={0.1}
          minRange={0.1}
          value={range}
          onChange={handleRangeChange}
          disabled={busy || duration === 0 || !!videoError}
          label={(v) => fmtTime(v)}
        />

        <Group className="webcut-video-edit-modal__actions" justify="flex-end" gap={8}>
          {busy && (
            <Group className="webcut-video-edit-modal__busy" gap={6}>
              <Loader size="xs" />
              <Text size="xs" c="dimmed">
                {busyLabel || '处理中…'}
              </Text>
            </Group>
          )}
          <Button
            className="webcut-video-edit-modal__cancel"
            variant="subtle"
            color="gray"
            onClick={onCancel}
            disabled={busy}
          >
            取消
          </Button>
          <Button
            className="webcut-video-edit-modal__apply"
            color="blue"
            onClick={() => onApply({ start: range[0], end: range[1] })}
            disabled={!canApply}
            loading={busy}
          >
            应用
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
