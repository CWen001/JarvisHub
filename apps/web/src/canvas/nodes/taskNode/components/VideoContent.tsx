import React from 'react'
import { ActionIcon, Button, Group, Text, Tooltip } from '@mantine/core'
import { IconCheck, IconClock, IconPhotoSearch, IconScissors, IconUpload } from '@tabler/icons-react'
import { setJarvisHubImageDragData } from '../../../dnd/setJarvisHubImageDragData'
import { computeMediaNodeHeight, getNodeSizeProfile } from '../../../nodeSizes'

const VIDEO_UPLOAD_ACCEPT = 'video/mp4,video/webm,video/quicktime,video/*'

type FrameSample = {
  url: string
  time: number
}

type VideoResult = {
  url: string
  thumbnailUrl?: string | null
  title?: string | null
  duration?: number
}

type VideoContentProps = {
  videoResults: VideoResult[]
  videoPrimaryIndex: number
  adoptedVideoIndex: number | null
  isPrimaryVideoAdopted: boolean
  videoUrl: string | null
  videoThumbnailUrl?: string | null
  videoTitle?: string | null
  videoSurface: string
  mediaOverlayBackground: string
  mediaOverlayText: string
  mediaFallbackText: string
  mediaFallbackSurface: string
  inlineDividerColor: string
  accentPrimary: string
  rgba: (color: string, alpha: number) => string
  frameSamples: FrameSample[]
  frameCaptureLoading: boolean
  handleCaptureVideoFrames: () => void
  cleanupFrameSamples: () => void
  onAdoptVideo: (index: number) => void
  onRequestSelect: (event: React.PointerEvent<HTMLElement>) => void
  onOpenVideoModal: () => void
  onOpenWebCut?: () => void
  canUpload: boolean
  uploading: boolean
  onUploadVideo: (file: File) => void
  nodeWidth: number
  nodeHeight: number
  onUpdateNodeData: (patch: Record<string, unknown>) => void
  mediaAutoSized?: string | null
}

export function VideoContent({
  videoResults,
  videoPrimaryIndex,
  adoptedVideoIndex,
  isPrimaryVideoAdopted,
  videoUrl,
  videoThumbnailUrl,
  videoTitle,
  videoSurface,
  mediaOverlayBackground,
  mediaOverlayText,
  mediaFallbackText,
  mediaFallbackSurface,
  inlineDividerColor,
  accentPrimary,
  rgba,
  frameSamples,
  frameCaptureLoading,
  handleCaptureVideoFrames,
  cleanupFrameSamples,
  onAdoptVideo,
  onRequestSelect,
  onOpenVideoModal,
  onOpenWebCut,
  canUpload,
  uploading,
  onUploadVideo,
  nodeWidth,
  nodeHeight,
  onUpdateNodeData,
  mediaAutoSized,
}: VideoContentProps) {
  const didDragFrameRef = React.useRef(false)
  const uploadInputRef = React.useRef<HTMLInputElement | null>(null)
  const canClip = Boolean(videoResults[videoPrimaryIndex]?.url || videoUrl)
  const handleVideoMetadata = React.useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget
    const { videoWidth, videoHeight } = video
    const currentSrc = videoResults[videoPrimaryIndex]?.url || videoUrl || ''
    if (videoWidth > 0 && videoHeight > 0 && currentSrc && currentSrc !== mediaAutoSized) {
      const profile = getNodeSizeProfile({ coreType: 'video' })
      const targetHeight = computeMediaNodeHeight(nodeWidth, videoWidth, videoHeight, profile)
      const patch: Record<string, unknown> = {
        mediaAutoSized: currentSrc,
        naturalWidth: videoWidth,
        naturalHeight: videoHeight,
      }
      if (Math.abs(targetHeight - nodeHeight) > 1) {
        patch.nodeHeight = targetHeight
      }
      onUpdateNodeData(patch)
    }
  }, [videoResults, videoPrimaryIndex, videoUrl, mediaAutoSized, nodeWidth, nodeHeight, onUpdateNodeData])
  const handleUploadClick = React.useCallback(() => {
    uploadInputRef.current?.click()
  }, [])
  const handleUploadChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null
    event.currentTarget.value = ''
    if (!file) return
    onUploadVideo(file)
  }, [onUploadVideo])
  const handleSelectionModifierBoundary = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey) return
    event.stopPropagation()
  }, [])
  return (
    <div
      className="video-content"
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        borderRadius: 10,
        background: mediaOverlayBackground,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        gap: 6,
        color: mediaOverlayText,
      }}
      onPointerDownCapture={onRequestSelect}
      onMouseDownCapture={handleSelectionModifierBoundary}
      onClick={handleSelectionModifierBoundary}
    >
      <input
        className="video-content-upload-input"
        ref={uploadInputRef}
        type="file"
        accept={VIDEO_UPLOAD_ACCEPT}
        style={{ display: 'none' }}
        onChange={handleUploadChange}
      />
      <Group className="video-content-header" justify="space-between" gap={4} wrap="nowrap">
        <Text className="video-content-header-text" size="xs" c="dimmed" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
          {videoResults.length > 0
            ? `共 ${videoResults.length} 个${videoPrimaryIndex >= 0 ? `（第 ${videoPrimaryIndex + 1}）` : ''}`
            : '生成中...'}
        </Text>
	        <Group className="video-content-header-actions" gap={2} wrap="nowrap">
            {canUpload && (
              <Tooltip label={videoUrl ? '替换视频' : '上传视频'} position="top" withArrow>
                <ActionIcon
                  className="video-content-upload-button"
                  size="sm"
                  variant="subtle"
                  loading={uploading}
                  disabled={uploading}
                  onClick={handleUploadClick}
                  aria-label={videoUrl ? '替换视频' : '上传视频'}
                >
                  <IconUpload className="video-content-upload-icon" size={14} />
                </ActionIcon>
              </Tooltip>
            )}
            {videoResults[videoPrimaryIndex]?.url && (
              <Tooltip label={isPrimaryVideoAdopted ? '当前视频已采纳' : '采纳当前视频'} position="top" withArrow>
                <ActionIcon
                  className="video-content-adopt-button"
                  size="sm"
                  variant={isPrimaryVideoAdopted ? 'filled' : 'subtle'}
                  color="red"
                  onClick={() => onAdoptVideo(videoPrimaryIndex)}
                  aria-label={isPrimaryVideoAdopted ? '当前视频已采纳' : '采纳当前视频'}
                >
                  <IconCheck className="video-content-adopt-icon" size={14} />
                </ActionIcon>
              </Tooltip>
            )}
		          <Tooltip label="剪辑视频" position="top" withArrow>
		            <ActionIcon
		              className="video-content-clip-button"
		              size="sm"
		              variant="subtle"
		              disabled={!canClip || !onOpenWebCut}
		              onClick={onOpenWebCut}
		              aria-label="剪辑视频"
		            >
		              <IconScissors className="video-content-clip-icon" size={14} />
		            </ActionIcon>
		          </Tooltip>
		          <Tooltip label={videoResults.length > 0 ? '视频历史' : '查看历史'} position="top" withArrow>
		            <ActionIcon
		              className="video-content-history-button"
		              size="sm"
		              variant="subtle"
		              onClick={onOpenVideoModal}
		              aria-label={videoResults.length > 0 ? '视频历史' : '查看历史'}
		            >
		              <IconClock className="video-content-history-icon" size={14} />
		            </ActionIcon>
		          </Tooltip>
        </Group>
      </Group>

      <Group className="video-content-actions-row" gap={6} justify="space-between" wrap="nowrap">
        <Group className="video-content-actions-left" gap={6} wrap="nowrap">
          <Tooltip label="抽帧预览" position="top" withArrow>
            <ActionIcon
              className="video-content-capture-button"
              size="sm"
              variant="light"
              loading={frameCaptureLoading}
              onClick={handleCaptureVideoFrames}
              aria-label="抽帧预览"
            >
              <IconPhotoSearch className="video-content-capture-icon" size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
        {frameSamples.length > 0 && (
          <Button className="video-content-clear-frames" size="compact-xs" variant="subtle" onClick={cleanupFrameSamples}>
            清空帧
          </Button>
        )}
      </Group>

      {videoUrl ? (
        <video
          className="video-content-player nodrag nopan"
          src={videoResults[videoPrimaryIndex]?.url || videoUrl}
          poster={videoResults[videoPrimaryIndex]?.thumbnailUrl || videoThumbnailUrl || undefined}
          controls
          loop
          muted
          playsInline
          onLoadedMetadata={handleVideoMetadata}
          style={{
            borderRadius: 8,
            width: '100%',
            flex: 1,
            minHeight: 120,
            height: '100%',
            objectFit: 'contain',
            backgroundColor: videoSurface,
            boxShadow: isPrimaryVideoAdopted ? '0 0 0 2px rgba(220,38,38,0.92)' : undefined,
          }}
        />
      ) : (
        <div
          className="video-content-placeholder"
          style={{
            flex: 1,
            minHeight: 120,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: mediaFallbackText,
            fontSize: 12,
          }}
        >
          等待视频生成完成…
        </div>
      )}

      {videoTitle && (
        <Text className="video-content-title" size="xs" lineClamp={1} c="dimmed">
          {videoTitle}
        </Text>
      )}

      {frameSamples.length > 0 && (
        <div className="video-content-frames" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 6 }}>
          {frameSamples.map((frame) => (
            <div
              className="video-content-frame-card nodrag nopan"
              key={`${frame.url}-${frame.time}`}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, cursor: 'grab' }}
              title="拖拽到画布生成图片节点"
              draggable
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onDragStart={(evt) => {
                didDragFrameRef.current = true
                evt.dataTransfer.effectAllowed = 'copy'
                evt.dataTransfer.setData(
                  'application/jarvishub-frame-sample',
                  JSON.stringify({ url: frame.url, remoteUrl: null, time: frame.time }),
                )
                setJarvisHubImageDragData(evt, frame.url)
              }}
              onDragEnd={() => {
                didDragFrameRef.current = false
              }}
            >
              <div
                className="video-content-frame-thumb nodrag nopan"
                style={{
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: mediaFallbackSurface,
                  border: `1px solid ${inlineDividerColor}`,
                  width: '100%',
                  aspectRatio: '4 / 3',
                  boxShadow: adoptedVideoIndex !== null && adoptedVideoIndex === videoPrimaryIndex
                    ? '0 0 0 2px rgba(220,38,38,0.0)'
                    : `0 0 0 2px ${rgba(accentPrimary, 0.0)}`,
                }}
              >
                <img
                  className="video-content-frame-img nodrag nopan"
                  src={frame.url}
                  alt={`frame-${frame.time.toFixed(2)}s`}
                  draggable
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDragStart={(evt) => {
                    didDragFrameRef.current = true
                    evt.dataTransfer.effectAllowed = 'copy'
                    evt.dataTransfer.setData(
                      'application/jarvishub-frame-sample',
                      JSON.stringify({ url: frame.url, remoteUrl: null, time: frame.time }),
                    )
                    setJarvisHubImageDragData(evt, frame.url)
                  }}
                  onDragEnd={() => {
                    didDragFrameRef.current = false
                  }}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </div>
              <Text className="video-content-frame-time" size="xs" c="dimmed">
                {frame.time.toFixed(2)}s
              </Text>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
