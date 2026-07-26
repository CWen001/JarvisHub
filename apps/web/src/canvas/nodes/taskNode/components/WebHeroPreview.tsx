import React from 'react'
import { ActionIcon, Button, Collapse, Group, Tabs, Text, Textarea, Tooltip } from '@mantine/core'
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconCheck,
  IconCopy,
  IconDeviceFloppy,
  IconDownload,
  IconMinus,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconX,
} from '@tabler/icons-react'
import { createPortal } from 'react-dom'
import type { WebHeroMediaKind } from '../webHero'
import {
  decorateWebHeroPreviewDocument,
  readWebHeroPreviewBridgeEvent,
  type WebHeroPreviewTrackedTarget,
  type WebHeroTweakStrokePoint,
  type WebHeroTweakToolMode,
} from '../webHeroPreviewBridge'
import {
  createWebHeroRefinementAttachment,
  summarizeWebHeroRefinementTarget,
  type WebHeroRefinementAttachment,
  type WebHeroRefinementBounds,
  type WebHeroRefinementTarget,
} from '../webHeroTweaks'

type WebHeroPreviewProps = {
  documentHtml?: string | null
  html?: string | null
  css?: string | null
  mediaKind?: WebHeroMediaKind | null
  mediaUrl?: string | null
  sourceLabel?: string | null
  refinementAttachments: WebHeroRefinementAttachment[]
  prompt: string
  nodeShellText: string
  isDarkUi: boolean
  isRunning: boolean
  isResizing: boolean
  onPromptChange: (value: string) => void
  onChangeCode: (value: { html: string; css: string }) => void
  onChangeRefinementAttachments: (attachments: WebHeroRefinementAttachment[]) => void
  onRun: () => void
  onApplyTweaks: () => void
  onDownloadHtml: () => void
  onSaveToAssets: () => void
  isSavingToAssets: boolean
}

type PreviewTab = 'preview' | 'code'

const WEB_HERO_PREVIEW_CANVAS_WIDTH = 1440
const WEB_HERO_PREVIEW_CANVAS_HEIGHT = 1200
const WEB_HERO_PREVIEW_MIN_WIDTH = 320
const WEB_HERO_PREVIEW_MIN_HEIGHT = 520
const WEB_HERO_PREVIEW_MIN_SCALE = 0.18
const WEB_HERO_FOCUS_MIN_ZOOM = 50
const WEB_HERO_FOCUS_MAX_ZOOM = 160
const WEB_HERO_FOCUS_ZOOM_STEP = 10

type WebHeroPreviewFrameLayout = {
  viewportWidth: number
  viewportHeight: number
  scale: number
  scrollWidth: number
  scrollHeight: number
}

type WebHeroPreviewShellMeasurement = {
  clientWidth: number
  clientHeight: number
  offsetWidth: number
  offsetHeight: number
  boundingWidth: number
  boundingHeight: number
}

function finitePositiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

function firstPositiveInteger(values: number[]): number {
  for (const value of values) {
    if (Number.isFinite(value) && value > 0) return Math.round(value)
  }
  return 0
}

export function resolveWebHeroPreviewShellSize(input: WebHeroPreviewShellMeasurement): { width: number; height: number } {
  return {
    width: firstPositiveInteger([input.clientWidth, input.offsetWidth, input.boundingWidth]),
    height: firstPositiveInteger([input.clientHeight, input.offsetHeight, input.boundingHeight]),
  }
}

export function resolveWebHeroPreviewFrameLayout(input: {
  shellWidth: number
  shellHeight: number
  contentScrollWidth: number
  contentClientWidth: number
  contentHeight: number
  tweakInteractionEnabled: boolean
}): WebHeroPreviewFrameLayout {
  const shellWidth = Math.max(
    WEB_HERO_PREVIEW_MIN_WIDTH,
    finitePositiveInteger(input.shellWidth, WEB_HERO_PREVIEW_MIN_WIDTH),
  )
  const shellHeight = Math.max(
    WEB_HERO_PREVIEW_MIN_HEIGHT,
    finitePositiveInteger(input.shellHeight, WEB_HERO_PREVIEW_MIN_HEIGHT),
  )
  const contentClientWidth = Math.max(
    WEB_HERO_PREVIEW_MIN_WIDTH,
    finitePositiveInteger(input.contentClientWidth, shellWidth),
  )
  const contentScrollWidth = Math.max(
    WEB_HERO_PREVIEW_MIN_WIDTH,
    finitePositiveInteger(input.contentScrollWidth, shellWidth),
  )
  const contentHeight = Math.max(
    WEB_HERO_PREVIEW_MIN_HEIGHT,
    finitePositiveInteger(input.contentHeight, WEB_HERO_PREVIEW_CANVAS_HEIGHT),
  )
  const hasHorizontalOverflow = contentScrollWidth > contentClientWidth + 2
  const viewportWidth = input.tweakInteractionEnabled
    ? shellWidth
    : hasHorizontalOverflow
      ? Math.max(shellWidth, contentScrollWidth)
      : shellWidth
  const scale = input.tweakInteractionEnabled
    ? 1
    : Math.max(WEB_HERO_PREVIEW_MIN_SCALE, Math.min(1, shellWidth / viewportWidth))
  const viewportHeight = input.tweakInteractionEnabled
    ? Math.max(shellHeight, contentHeight)
    : contentHeight
  return {
    viewportWidth,
    viewportHeight,
    scale,
    scrollWidth: shellWidth,
    scrollHeight: Math.max(shellHeight, Math.ceil(viewportHeight * scale)),
  }
}

function getAttachmentTrackId(attachment: WebHeroRefinementAttachment): string {
  return attachment.id
}

function getDraftTrackId(target: WebHeroRefinementTarget): string {
  return `draft:${target.selectionKind}:${target.elementId}`
}

function boundsStyle(bounds: WebHeroRefinementBounds): React.CSSProperties {
  return {
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
  }
}

function summarizeAttachment(attachment: WebHeroRefinementAttachment): string {
  return summarizeWebHeroRefinementTarget(attachment)
}

function renderOverlayBox(input: {
  key: string
  bounds: WebHeroRefinementBounds
  color: string
  background: string
  label: string
  badge?: string
}): React.ReactNode {
  const { key, bounds, color, background, label, badge } = input
  return (
    <div
      key={key}
      className="tc-web-hero-preview__overlay-box"
      aria-label={label}
      style={{
        position: 'absolute',
        ...boundsStyle(bounds),
        border: `1.5px solid ${color}`,
        background,
        boxShadow: `0 0 0 1px ${color}`,
        borderRadius: 8,
      }}
    >
      {badge ? (
        <div
          className="tc-web-hero-preview__overlay-badge"
          style={{
            position: 'absolute',
            left: 6,
            top: 6,
            padding: '1px 6px',
            borderRadius: 999,
            background: color,
            color: '#ffffff',
            fontSize: 10,
            lineHeight: 1.5,
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          {badge}
        </div>
      ) : null}
    </div>
  )
}

export function WebHeroPreview({
  documentHtml,
  html,
  css,
  mediaKind,
  mediaUrl,
  sourceLabel,
  refinementAttachments,
  prompt,
  nodeShellText,
  isDarkUi,
  isRunning,
  isResizing,
  onPromptChange,
  onChangeCode,
  onChangeRefinementAttachments,
  onRun,
  onApplyTweaks,
  onDownloadHtml,
  onSaveToAssets,
  isSavingToAssets,
}: WebHeroPreviewProps) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const frameShellRef = React.useRef<HTMLDivElement | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [focusOpen, setFocusOpen] = React.useState(false)
  const [focusZoom, setFocusZoom] = React.useState(100)
  const [frameKey, setFrameKey] = React.useState(0)
  const [frameShellRect, setFrameShellRect] = React.useState({ width: 0, height: 0 })
  const [frameContentSize, setFrameContentSize] = React.useState({
    scrollWidth: WEB_HERO_PREVIEW_MIN_WIDTH,
    clientWidth: WEB_HERO_PREVIEW_MIN_WIDTH,
    height: WEB_HERO_PREVIEW_CANVAS_HEIGHT,
  })
  const [activeTab, setActiveTab] = React.useState<PreviewTab>('preview')
  const [tweakEnabled, setTweakEnabled] = React.useState(false)
  const [tweakMode, setTweakMode] = React.useState<WebHeroTweakToolMode>('picker')
  const [hoverTarget, setHoverTarget] = React.useState<WebHeroRefinementTarget | null>(null)
  const [draftTarget, setDraftTarget] = React.useState<WebHeroRefinementTarget | null>(null)
  const [liveTrackedTargets, setLiveTrackedTargets] = React.useState<Record<string, WebHeroRefinementTarget>>({})
  const [podStroke, setPodStroke] = React.useState<WebHeroTweakStrokePoint[]>([])
  const [noteDraft, setNoteDraft] = React.useState('')
  const [htmlDraft, setHtmlDraft] = React.useState(typeof html === 'string' ? html : '')
  const [cssDraft, setCssDraft] = React.useState(typeof css === 'string' ? css : '')
  const previewDocument = typeof documentHtml === 'string' && documentHtml.trim() ? documentHtml : ''
  const decoratedPreviewDocument = React.useMemo(
    () => decorateWebHeroPreviewDocument(previewDocument),
    [previewDocument],
  )
  const hasPreview = Boolean(previewDocument)
  const inputBg = isDarkUi ? 'rgba(255,255,255,0.055)' : 'rgba(15,23,42,0.055)'
  const tweakInteractionEnabled = tweakEnabled && hasPreview && activeTab === 'preview' && !isResizing
  const frameLayout = React.useMemo(
    () => resolveWebHeroPreviewFrameLayout({
      shellWidth: frameShellRect.width,
      shellHeight: frameShellRect.height,
      contentScrollWidth: frameContentSize.scrollWidth,
      contentClientWidth: frameContentSize.clientWidth,
      contentHeight: frameContentSize.height,
      tweakInteractionEnabled,
    }),
    [
      frameContentSize.clientWidth,
      frameContentSize.height,
      frameContentSize.scrollWidth,
      frameShellRect.height,
      frameShellRect.width,
      tweakInteractionEnabled,
    ],
  )
  const trackedTargets = React.useMemo<WebHeroPreviewTrackedTarget[]>(() => {
    const savedTargets = refinementAttachments.map((attachment) => ({
      trackId: getAttachmentTrackId(attachment),
      target: attachment,
    }))
    if (!draftTarget) return savedTargets
    return [
      ...savedTargets,
      {
        trackId: getDraftTrackId(draftTarget),
        target: draftTarget,
      },
    ]
  }, [draftTarget, refinementAttachments])
  const currentDraftTrackId = draftTarget ? getDraftTrackId(draftTarget) : null
  const resolvedDraftTarget = currentDraftTrackId ? liveTrackedTargets[currentDraftTrackId] ?? draftTarget : null
  const selectedTargetSummary = resolvedDraftTarget ? summarizeWebHeroRefinementTarget(resolvedDraftTarget) : ''
  const persistedHtml = typeof html === 'string' ? html : ''
  const persistedCss = typeof css === 'string' ? css : ''
  const isCodeDirty = htmlDraft !== persistedHtml || cssDraft !== persistedCss

  React.useEffect(() => {
    if (!hasPreview) {
      setSettingsOpen(true)
      setTweakEnabled(false)
      setHoverTarget(null)
      setDraftTarget(null)
      setLiveTrackedTargets({})
      setPodStroke([])
      setNoteDraft('')
      setActiveTab('preview')
    }
  }, [hasPreview])

  React.useEffect(() => {
    if (!hasPreview) return
    setSettingsOpen(false)
  }, [hasPreview, previewDocument])

  React.useLayoutEffect(() => {
    if (!hasPreview || activeTab !== 'preview' || isResizing) return
    const shell = frameShellRef.current
    if (!shell) return
    const updateFrameShellRect = () => {
      const rect = shell.getBoundingClientRect()
      setFrameShellRect(resolveWebHeroPreviewShellSize({
        clientWidth: shell.clientWidth,
        clientHeight: shell.clientHeight,
        offsetWidth: shell.offsetWidth,
        offsetHeight: shell.offsetHeight,
        boundingWidth: rect.width,
        boundingHeight: rect.height,
      }))
    }
    updateFrameShellRect()
    const animationFrameId = window.requestAnimationFrame(updateFrameShellRect)
    if (typeof ResizeObserver === 'undefined') {
      return () => window.cancelAnimationFrame(animationFrameId)
    }
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setFrameShellRect(resolveWebHeroPreviewShellSize({
          clientWidth: shell.clientWidth,
          clientHeight: shell.clientHeight,
          offsetWidth: shell.offsetWidth,
          offsetHeight: shell.offsetHeight,
          boundingWidth: entry.contentRect.width,
          boundingHeight: entry.contentRect.height,
        }))
        return
      }
      updateFrameShellRect()
    })
    resizeObserver.observe(shell)
    return () => {
      window.cancelAnimationFrame(animationFrameId)
      resizeObserver.disconnect()
    }
  }, [activeTab, hasPreview, isResizing])

  const measureFrameContentSize = React.useCallback(() => {
    const frameDocument = iframeRef.current?.contentDocument
    if (!frameDocument) return
    const root = frameDocument.documentElement
    const body = frameDocument.body
    const contentScrollWidth = Math.max(
      root?.scrollWidth || 0,
      body?.scrollWidth || 0,
      WEB_HERO_PREVIEW_MIN_WIDTH,
    )
    const contentClientWidth = Math.max(
      root?.clientWidth || 0,
      body?.clientWidth || 0,
      WEB_HERO_PREVIEW_MIN_WIDTH,
    )
    const contentHeight = Math.max(
      root?.scrollHeight || 0,
      root?.clientHeight || 0,
      body?.scrollHeight || 0,
      body?.clientHeight || 0,
      WEB_HERO_PREVIEW_CANVAS_HEIGHT,
    )
    setFrameContentSize({
      scrollWidth: Math.max(WEB_HERO_PREVIEW_MIN_WIDTH, Math.round(contentScrollWidth)),
      clientWidth: Math.max(WEB_HERO_PREVIEW_MIN_WIDTH, Math.round(contentClientWidth)),
      height: Math.max(WEB_HERO_PREVIEW_MIN_HEIGHT, Math.round(contentHeight)),
    })
  }, [])

  React.useEffect(() => {
    setFrameKey((value) => value + 1)
  }, [previewDocument])

  React.useEffect(() => {
    setHtmlDraft(persistedHtml)
  }, [persistedHtml])

  React.useEffect(() => {
    setCssDraft(persistedCss)
  }, [persistedCss])

  React.useEffect(() => {
    if (tweakEnabled) return
    setHoverTarget(null)
    setPodStroke([])
  }, [tweakEnabled])

  React.useEffect(() => {
    if (hasPreview && activeTab === 'preview' && !isResizing) return
    setLiveTrackedTargets({})
  }, [activeTab, hasPreview, isResizing])

  const postFrameBridgeState = React.useCallback(() => {
    const frameWindow = iframeRef.current?.contentWindow
    if (!frameWindow) return
    frameWindow.postMessage({
      type: 'tc:webhero-tweak-mode',
      enabled: tweakInteractionEnabled,
      mode: tweakMode,
    }, '*')
    frameWindow.postMessage({
      type: 'tc:webhero-tweak-track',
      targets: trackedTargets,
    }, '*')
  }, [trackedTargets, tweakInteractionEnabled, tweakMode])

  React.useEffect(() => {
    if (!hasPreview) return
    const timer = window.setTimeout(() => {
      postFrameBridgeState()
      measureFrameContentSize()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [frameKey, frameLayout.viewportWidth, hasPreview, measureFrameContentSize, postFrameBridgeState])

  React.useEffect(() => {
    if (!hasPreview || activeTab !== 'preview' || isResizing) return
    postFrameBridgeState()
  }, [activeTab, hasPreview, isResizing, postFrameBridgeState])

  const handleCopy = React.useCallback(async () => {
    const htmlValue = htmlDraft.trim()
    const cssValue = cssDraft.trim()
    const code = [cssValue ? `<style>\n${cssValue}\n</style>` : '', htmlValue].filter(Boolean).join('\n\n')
    if (!code) return
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }, [cssDraft, htmlDraft])

  const navigateFrame = React.useCallback((action: 'back' | 'forward') => {
    const frameWindow = iframeRef.current?.contentWindow
    if (!frameWindow) return
    try {
      if (action === 'back') frameWindow.history.back()
      if (action === 'forward') frameWindow.history.forward()
    } catch {
      // Sandbox/history access can be denied after cross-origin navigation.
    }
  }, [])

  const reloadFrame = React.useCallback(() => {
    setFrameKey((value) => value + 1)
  }, [])

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const bridgeEvent = readWebHeroPreviewBridgeEvent(event.data)
      if (!bridgeEvent) return
      if (bridgeEvent.type === 'tc:webhero-tweak-track-update') {
        setLiveTrackedTargets(() => Object.fromEntries(
          bridgeEvent.targets.map((entry) => [entry.trackId, entry.target]),
        ))
        return
      }
      if (!tweakEnabled && bridgeEvent.type !== 'tc:webhero-tweak-pod-clear') return
      switch (bridgeEvent.type) {
        case 'tc:webhero-tweak-hover':
          if (tweakMode !== 'picker') return
          setHoverTarget(bridgeEvent.target)
          return
        case 'tc:webhero-tweak-leave':
          setHoverTarget(null)
          return
        case 'tc:webhero-tweak-select':
          setHoverTarget(null)
          setPodStroke([])
          setDraftTarget(bridgeEvent.target)
          return
        case 'tc:webhero-tweak-pod-stroke':
          if (tweakMode !== 'pod') return
          setPodStroke(bridgeEvent.points)
          return
        case 'tc:webhero-tweak-pod-clear':
          setPodStroke([])
          return
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [tweakEnabled, tweakMode])

  const handleSelectTweakMode = React.useCallback((nextMode: WebHeroTweakToolMode) => {
    if (!hasPreview) return
    setActiveTab('preview')
    setTweakEnabled(true)
    setTweakMode(nextMode)
  }, [hasPreview])

  const handleToggleTweak = React.useCallback(() => {
    if (!hasPreview) return
    setActiveTab('preview')
    setTweakEnabled((value) => !value)
  }, [hasPreview])

  const handleClearDraftTarget = React.useCallback(() => {
    setDraftTarget(null)
    setHoverTarget(null)
    setPodStroke([])
    setNoteDraft('')
  }, [])

  const handleAddAttachment = React.useCallback(() => {
    if (!resolvedDraftTarget) return
    const note = noteDraft.trim()
    if (!note) return
    const nextAttachment = createWebHeroRefinementAttachment({
      target: resolvedDraftTarget,
      note,
    })
    onChangeRefinementAttachments([...refinementAttachments, nextAttachment])
    setDraftTarget(null)
    setPodStroke([])
    setHoverTarget(null)
    setNoteDraft('')
  }, [noteDraft, onChangeRefinementAttachments, refinementAttachments, resolvedDraftTarget])

  const handleRemoveAttachment = React.useCallback((attachmentId: string) => {
    onChangeRefinementAttachments(
      refinementAttachments.filter((attachment) => attachment.id !== attachmentId),
    )
  }, [onChangeRefinementAttachments, refinementAttachments])

  const handleClearAttachments = React.useCallback(() => {
    onChangeRefinementAttachments([])
  }, [onChangeRefinementAttachments])

  const handleRun = React.useCallback(() => {
    onRun()
  }, [onRun])

  const handleApplyTweaks = React.useCallback(() => {
    onApplyTweaks()
  }, [onApplyTweaks])

  const handleResetCode = React.useCallback(() => {
    setHtmlDraft(persistedHtml)
    setCssDraft(persistedCss)
  }, [persistedCss, persistedHtml])

  const handleApplyCode = React.useCallback(() => {
    onChangeCode({
      html: htmlDraft,
      css: cssDraft,
    })
  }, [cssDraft, htmlDraft, onChangeCode])

  const clampFocusZoom = React.useCallback((value: number): number => {
    if (!Number.isFinite(value)) return 100
    return Math.max(WEB_HERO_FOCUS_MIN_ZOOM, Math.min(WEB_HERO_FOCUS_MAX_ZOOM, Math.round(value)))
  }, [])

  const handleOpenFocusPreview = React.useCallback(() => {
    if (!hasPreview) return
    setFocusZoom(100)
    setFocusOpen(true)
  }, [hasPreview])

  const handleCloseFocusPreview = React.useCallback(() => {
    setFocusOpen(false)
  }, [])

  const handleZoomFocusPreview = React.useCallback((delta: number) => {
    setFocusZoom((value) => clampFocusZoom(value + delta))
  }, [clampFocusZoom])

  React.useEffect(() => {
    if (!focusOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setFocusOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusOpen])

  const focusPreview = focusOpen && hasPreview && typeof document !== 'undefined'
    ? createPortal(
        <div className="tc-web-hero-preview__focus-layer nodrag nopan" role="dialog" aria-modal="false" aria-label="网页全屏预览">
          <div className="tc-web-hero-preview__focus-toolbar">
            <Group className="tc-web-hero-preview__focus-toolbar-left" gap={6} wrap="nowrap">
              <Tooltip label="缩小" withArrow position="bottom">
                <ActionIcon
                  className="tc-web-hero-preview__focus-icon-action"
                  size="sm"
                  variant="subtle"
                  disabled={focusZoom <= WEB_HERO_FOCUS_MIN_ZOOM}
                  aria-label="缩小网页预览"
                  onClick={() => handleZoomFocusPreview(-WEB_HERO_FOCUS_ZOOM_STEP)}
                >
                  <IconMinus className="tc-web-hero-preview__focus-icon" size={15} />
                </ActionIcon>
              </Tooltip>
              <Text className="tc-web-hero-preview__focus-zoom" size="xs" fw={700}>
                {focusZoom}%
              </Text>
              <Tooltip label="放大" withArrow position="bottom">
                <ActionIcon
                  className="tc-web-hero-preview__focus-icon-action"
                  size="sm"
                  variant="subtle"
                  disabled={focusZoom >= WEB_HERO_FOCUS_MAX_ZOOM}
                  aria-label="放大网页预览"
                  onClick={() => handleZoomFocusPreview(WEB_HERO_FOCUS_ZOOM_STEP)}
                >
                  <IconPlus className="tc-web-hero-preview__focus-icon" size={15} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="重置为 100%" withArrow position="bottom">
                <ActionIcon
                  className="tc-web-hero-preview__focus-icon-action"
                  size="sm"
                  variant="subtle"
                  disabled={focusZoom === 100}
                  aria-label="重置网页预览缩放"
                  onClick={() => setFocusZoom(100)}
                >
                  <IconArrowsMinimize className="tc-web-hero-preview__focus-icon" size={15} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <Tooltip label="退出全屏预览" withArrow position="bottom">
              <ActionIcon
                className="tc-web-hero-preview__focus-close"
                size="sm"
                variant="subtle"
                aria-label="退出全屏预览"
                onClick={handleCloseFocusPreview}
              >
                <IconX className="tc-web-hero-preview__focus-icon" size={15} />
              </ActionIcon>
            </Tooltip>
          </div>
          <div className="tc-web-hero-preview__focus-viewport">
            <div
              className="tc-web-hero-preview__focus-scale-spacer"
              style={{
                width: `${focusZoom}%`,
                height: `${focusZoom}%`,
              }}
            >
              <div
                className="tc-web-hero-preview__focus-scale"
                style={{
                  width: `${10000 / focusZoom}%`,
                  height: `${10000 / focusZoom}%`,
                  transform: focusZoom === 100 ? 'none' : `scale(${focusZoom / 100})`,
                }}
              >
                <iframe
                  className="tc-web-hero-preview__focus-iframe"
                  title="网页全屏预览"
                  srcDoc={decoratedPreviewDocument}
                  sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
                />
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <div
      className="tc-web-hero-preview"
      style={{ color: nodeShellText }}
    >
      <Group className="tc-web-hero-preview__header" justify="space-between" gap={14} wrap="nowrap">
        <div className="tc-web-hero-preview__meta" style={{ minWidth: 0 }}>
          <div className="tc-web-hero-preview__kicker">WEB HERO</div>
          <Text className="tc-web-hero-preview__title" size="xs" fw={700}>
            网页代码
          </Text>
          <Text className="tc-web-hero-preview__source" size="xs" c="dimmed" lineClamp={1}>
            {sourceLabel ? `${mediaKind === 'video' ? '视频' : '图片'}来源：${sourceLabel}` : '连接已生成图片或视频后运行'}
          </Text>
        </div>
        <Group className="tc-web-hero-preview__actions" gap={4} wrap="nowrap">
          <Button
            className="tc-web-hero-preview__tweak-toggle nodrag nopan"
            size="compact-xs"
            variant={tweakEnabled ? 'filled' : 'light'}
            disabled={!hasPreview}
            onClick={handleToggleTweak}
          >
            {refinementAttachments.length > 0 ? `Tweaks ${refinementAttachments.length}` : 'Tweaks'}
          </Button>
          <Tooltip label="后退" withArrow position="top">
            <ActionIcon className="tc-web-hero-preview__icon-action nodrag nopan" size="sm" variant="subtle" disabled={!hasPreview} onClick={() => navigateFrame('back')}>
              <IconArrowLeft className="tc-web-hero-preview__icon" size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="前进" withArrow position="top">
            <ActionIcon className="tc-web-hero-preview__icon-action nodrag nopan" size="sm" variant="subtle" disabled={!hasPreview} onClick={() => navigateFrame('forward')}>
              <IconArrowRight className="tc-web-hero-preview__icon" size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="刷新预览" withArrow position="top">
            <ActionIcon className="tc-web-hero-preview__icon-action nodrag nopan" size="sm" variant="subtle" disabled={!hasPreview} onClick={reloadFrame}>
              <IconRefresh className="tc-web-hero-preview__icon" size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="全屏预览" withArrow position="top">
            <ActionIcon className="tc-web-hero-preview__icon-action nodrag nopan" size="sm" variant="subtle" disabled={!hasPreview} onClick={handleOpenFocusPreview}>
              <IconArrowsMaximize className="tc-web-hero-preview__icon" size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="输入设置" withArrow position="top">
            <ActionIcon className="tc-web-hero-preview__icon-action nodrag nopan" size="sm" variant={settingsOpen ? 'light' : 'subtle'} onClick={() => setSettingsOpen((value) => !value)}>
              <IconSettings className="tc-web-hero-preview__icon" size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="生成/刷新网页代码" withArrow position="top">
            <ActionIcon className="tc-web-hero-preview__icon-action nodrag nopan" size="sm" variant="subtle" loading={isRunning} onClick={handleRun}>
              <IconPlayerPlay className="tc-web-hero-preview__icon" size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={copied ? '已复制' : '复制 HTML/CSS'} withArrow position="top">
            <ActionIcon className="tc-web-hero-preview__icon-action nodrag nopan" size="sm" variant="subtle" disabled={!htmlDraft.trim() && !cssDraft.trim()} onClick={() => { void handleCopy() }}>
              {copied ? <IconCheck className="tc-web-hero-preview__icon" size={15} /> : <IconCopy className="tc-web-hero-preview__icon" size={15} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="下载 HTML" withArrow position="top">
            <ActionIcon className="tc-web-hero-preview__icon-action nodrag nopan" size="sm" variant="subtle" disabled={!previewDocument} onClick={onDownloadHtml}>
              <IconDownload className="tc-web-hero-preview__icon" size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="保存到我的资产" withArrow position="top">
            <ActionIcon
              className="tc-web-hero-preview__icon-action nodrag nopan"
              size="sm"
              variant="subtle"
              disabled={!previewDocument || isSavingToAssets}
              loading={isSavingToAssets}
              onClick={onSaveToAssets}
            >
              <IconDeviceFloppy className="tc-web-hero-preview__icon" size={15} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Collapse className="tc-web-hero-preview__settings-collapse" in={settingsOpen}>
        <div
          className="tc-web-hero-preview__settings nodrag nopan"
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'stretch',
          }}
        >
          {mediaUrl ? (
            <div
              className="tc-web-hero-preview__asset-chip"
              style={{
                width: 42,
                height: 42,
                flex: '0 0 42px',
                overflow: 'hidden',
              }}
            >
              {mediaKind === 'video' ? (
                <video
                  className="tc-web-hero-preview__asset-chip-video"
                  src={mediaUrl}
                  muted
                  loop
                  playsInline
                  autoPlay
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <img
                  className="tc-web-hero-preview__asset-chip-image"
                  src={mediaUrl}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              )}
            </div>
          ) : null}
          <Textarea
            className="tc-web-hero-preview__prompt-input nodrag nopan"
            value={prompt}
            autosize
            minRows={2}
            maxRows={4}
            placeholder="描述网页目标、结构、品牌气质和需要强调的内容"
            onChange={(event) => onPromptChange(event.currentTarget.value)}
            styles={{
              root: { flex: 1, minWidth: 0 },
              input: {
                background: inputBg,
                border: 0,
                color: nodeShellText,
                fontSize: 12,
                lineHeight: 1.42,
              },
            }}
          />
          <Button className="tc-web-hero-preview__run-button nodrag nopan" size="compact-xs" variant="light" loading={isRunning} leftSection={<IconPlayerPlay className="tc-web-hero-preview__run-icon" size={14} />} onClick={handleRun}>
            生成
          </Button>
        </div>
      </Collapse>

      <Collapse className="tc-web-hero-preview__tweak-collapse" in={tweakEnabled || refinementAttachments.length > 0}>
        <div
          className="tc-web-hero-preview__tweak-panel nodrag nopan"
          data-tc-webhero-tweak-ignore="true"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <Group className="tc-web-hero-preview__tweak-toolbar" justify="space-between" gap={8} wrap="wrap">
            <Group className="tc-web-hero-preview__tweak-toolbar-left" gap={6} wrap="wrap">
              <Button
                className="tc-web-hero-preview__tweak-mode-button nodrag nopan"
                size="compact-xs"
                variant={tweakEnabled && tweakMode === 'picker' ? 'filled' : 'light'}
                disabled={!hasPreview}
                onClick={() => handleSelectTweakMode('picker')}
              >
                Picker
              </Button>
              <Button
                className="tc-web-hero-preview__tweak-mode-button nodrag nopan"
                size="compact-xs"
                variant={tweakEnabled && tweakMode === 'pod' ? 'filled' : 'light'}
                disabled={!hasPreview}
                onClick={() => handleSelectTweakMode('pod')}
              >
                Pods
              </Button>
              <Text className="tc-web-hero-preview__tweak-scope" size="xs" c="dimmed">
                只重跑当前网页代码节点
              </Text>
            </Group>
            <Group className="tc-web-hero-preview__tweak-toolbar-right" gap={6} wrap="wrap">
              <Button
                className="tc-web-hero-preview__tweak-apply nodrag nopan"
                size="compact-xs"
                variant="light"
                disabled={!refinementAttachments.length}
                loading={isRunning}
                onClick={handleApplyTweaks}
              >
                应用调优
              </Button>
              <Button
                className="tc-web-hero-preview__tweak-clear-all nodrag nopan"
                size="compact-xs"
                variant="subtle"
                disabled={!refinementAttachments.length}
                onClick={handleClearAttachments}
              >
                清空
              </Button>
            </Group>
          </Group>

          {draftTarget ? (
            <div
              className="tc-web-hero-preview__tweak-draft"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 10,
              }}
            >
              <div className="tc-web-hero-preview__tweak-draft-meta">
                <Text className="tc-web-hero-preview__tweak-draft-label" size="xs" fw={700}>
                  当前选区
                </Text>
                <Text className="tc-web-hero-preview__tweak-draft-summary" size="xs" c="dimmed">
                  {selectedTargetSummary}
                </Text>
              </div>
              <Textarea
                className="tc-web-hero-preview__tweak-note-input nodrag nopan"
                value={noteDraft}
                autosize
                minRows={2}
                maxRows={4}
                placeholder="例如：这一组卡片太重，减弱阴影并收紧间距；不要动首屏标题和主 CTA。"
                onChange={(event) => setNoteDraft(event.currentTarget.value)}
                styles={{
                  input: {
                    background: inputBg,
                    border: 0,
                    color: nodeShellText,
                    fontSize: 12,
                    lineHeight: 1.42,
                  },
                }}
              />
              <Group className="tc-web-hero-preview__tweak-draft-actions" justify="space-between" gap={8} wrap="wrap">
                <Text className="tc-web-hero-preview__tweak-draft-hint" size="xs" c="dimmed">
                  这条评论会作为本轮网页代码重跑的局部调优目标。
                </Text>
                <Group className="tc-web-hero-preview__tweak-draft-buttons" gap={6} wrap="wrap">
                  <Button className="tc-web-hero-preview__tweak-draft-clear nodrag nopan" size="compact-xs" variant="subtle" onClick={handleClearDraftTarget}>
                    清除选区
                  </Button>
                  <Button
                    className="tc-web-hero-preview__tweak-draft-add nodrag nopan"
                    size="compact-xs"
                    variant="light"
                    disabled={!noteDraft.trim()}
                    onClick={handleAddAttachment}
                  >
                    添加评论
                  </Button>
                </Group>
              </Group>
            </div>
          ) : tweakEnabled ? (
            <Text className="tc-web-hero-preview__tweak-empty-hint" size="xs" c="dimmed">
              {tweakMode === 'pod' ? '在预览里画一个闭合圈选出一组区域，然后添加评论。' : '在预览里点选一个元素，然后添加评论。'}
            </Text>
          ) : null}

          {refinementAttachments.length > 0 ? (
            <div
              className="tc-web-hero-preview__tweak-list"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 170,
                overflowY: 'auto',
              }}
            >
              {refinementAttachments.map((attachment, index) => (
                <div
                  key={attachment.id}
                  className="tc-web-hero-preview__tweak-item"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '8px 10px',
                  }}
                >
                  <div className="tc-web-hero-preview__tweak-item-copy" style={{ minWidth: 0, flex: 1 }}>
                    <Text className="tc-web-hero-preview__tweak-item-title" size="xs" fw={700}>
                      {index + 1}. {summarizeAttachment(attachment)}
                    </Text>
                    <Text className="tc-web-hero-preview__tweak-item-note" size="xs" c="dimmed" lineClamp={2}>
                      {attachment.note}
                    </Text>
                  </div>
                  <Button
                    className="tc-web-hero-preview__tweak-item-remove nodrag nopan"
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => handleRemoveAttachment(attachment.id)}
                  >
                    移除
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Collapse>

      {hasPreview ? (
        <Tabs
          className="tc-web-hero-preview__tabs"
          value={activeTab}
          keepMounted={false}
          onChange={(value) => setActiveTab(value === 'code' ? 'code' : 'preview')}
          style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', alignSelf: 'stretch' }}
        >
          <Tabs.List className="tc-web-hero-preview__tab-list" grow>
            <Tabs.Tab className="tc-web-hero-preview__tab" value="preview">预览</Tabs.Tab>
            <Tabs.Tab className="tc-web-hero-preview__tab" value="code">代码</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel className="tc-web-hero-preview__tab-panel" value="preview" style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column' }}>
            {isResizing ? (
              <div
                className="tc-web-hero-preview__resize-ghost"
                style={{
                  width: '100%',
                  height: '100%',
                  minHeight: 220,
                }}
              />
            ) : (
              <div
                className="tc-web-hero-preview__frame-shell"
                ref={frameShellRef}
                style={{
                  position: 'relative',
                  flex: '1 1 auto',
                  width: '100%',
                  height: '100%',
                  minWidth: WEB_HERO_PREVIEW_MIN_WIDTH,
                  minHeight: WEB_HERO_PREVIEW_MIN_HEIGHT,
                  maxWidth: '100%',
                  maxHeight: '100%',
                  overflow: 'hidden',
                  overflowY: 'auto',
                  overflowX: 'hidden',
                }}
              >
                <div
                  className="tc-web-hero-preview__frame-scroll-size"
                  style={{
                    position: 'relative',
                    width: frameLayout.scrollWidth,
                    height: frameLayout.scrollHeight,
                  }}
                >
                  <div
                    className="tc-web-hero-preview__frame-viewport"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: frameLayout.viewportWidth,
                      height: frameLayout.viewportHeight,
                      transform: frameLayout.scale === 1 ? 'none' : `scale(${frameLayout.scale})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    <iframe
                      key={frameKey}
                      ref={iframeRef}
                      className="tc-web-hero-preview__iframe nodrag nopan"
                      title="网页代码预览"
                      srcDoc={decoratedPreviewDocument}
                      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
                      onLoad={() => {
                        postFrameBridgeState()
                        window.setTimeout(() => {
                          measureFrameContentSize()
                        }, 0)
                      }}
                      style={{
                        width: '100%',
                        height: '100%',
                        minHeight: 220,
                        border: 0,
                        display: 'block',
                      }}
                    />
                    <div
                      className="tc-web-hero-preview__overlay"
                      data-tc-webhero-tweak-ignore="true"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        overflow: 'hidden',
                      }}
                    >
                      {refinementAttachments.map((attachment, index) =>
                        renderOverlayBox({
                          key: attachment.id,
                          bounds: liveTrackedTargets[getAttachmentTrackId(attachment)]?.position ?? attachment.position,
                          color: 'rgba(59,130,246,0.92)',
                          background: 'rgba(59,130,246,0.12)',
                          label: attachment.note,
                          badge: String(index + 1),
                        }),
                      )}
                      {hoverTarget
                        ? renderOverlayBox({
                            key: `hover-${hoverTarget.elementId}`,
                            bounds: hoverTarget.position,
                            color: 'rgba(245,158,11,0.9)',
                            background: 'rgba(245,158,11,0.08)',
                            label: hoverTarget.label,
                          })
                        : null}
                      {draftTarget
                        ? renderOverlayBox({
                            key: `draft-${draftTarget.elementId}`,
                            bounds: resolvedDraftTarget?.position ?? draftTarget.position,
                            color: 'rgba(16,185,129,0.94)',
                            background: 'rgba(16,185,129,0.12)',
                            label: selectedTargetSummary,
                            badge: 'Draft',
                          })
                        : null}
                      {podStroke.length > 1 ? (
                        <svg
                          className="tc-web-hero-preview__pod-stroke"
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            overflow: 'visible',
                          }}
                        >
                          <polyline
                            fill="none"
                            stroke="rgba(16,185,129,0.95)"
                            strokeWidth="1.6"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                            points={podStroke.map((point) => `${point.x},${point.y}`).join(' ')}
                          />
                        </svg>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Tabs.Panel>
          <Tabs.Panel className="tc-web-hero-preview__tab-panel" value="code" style={{ flex: 1, minHeight: 0 }}>
            <div
              className="tc-web-hero-preview__code-panel nodrag nopan"
              style={{
                height: '100%',
                minHeight: 220,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <Group className="tc-web-hero-preview__code-toolbar" justify="space-between" gap={8} wrap="wrap" style={{ flex: '0 0 auto' }}>
                <Text className="tc-web-hero-preview__code-summary" size="xs" c="dimmed">
                  直接修改 HTML / CSS 后可立即回写到当前网页节点并刷新预览
                </Text>
                <Group className="tc-web-hero-preview__code-actions" gap={6} wrap="wrap">
                  <Button
                    className="tc-web-hero-preview__code-reset nodrag nopan"
                    size="compact-xs"
                    variant="subtle"
                    disabled={!isCodeDirty}
                    onClick={handleResetCode}
                  >
                    重置
                  </Button>
                  <Button
                    className="tc-web-hero-preview__code-apply nodrag nopan"
                    size="compact-xs"
                    variant="light"
                    disabled={!isCodeDirty}
                    onClick={handleApplyCode}
                  >
                    应用到预览
                  </Button>
                </Group>
              </Group>
              <div
                className="tc-web-hero-preview__code-editors"
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: 'grid',
                  gridTemplateColumns: '1fr',
                  gap: 8,
                }}
              >
                <div
                  className="tc-web-hero-preview__code-section"
                  style={{
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <Text className="tc-web-hero-preview__code-section-title" size="xs" fw={700}>
                    HTML
                  </Text>
                  <textarea
                    className="tc-web-hero-preview__code-editor tc-web-hero-preview__code-editor--html nodrag nopan"
                    value={htmlDraft}
                    spellCheck={false}
                    onChange={(event) => setHtmlDraft(event.currentTarget.value)}
                    style={{
                      flex: 1,
                      minHeight: 140,
                      resize: 'vertical',
                      border: 0,
                      color: nodeShellText,
                      padding: 12,
                      fontSize: 11,
                      lineHeight: 1.45,
                      fontFamily: 'ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace',
                    }}
                  />
                </div>
                <div
                  className="tc-web-hero-preview__code-section"
                  style={{
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <Text className="tc-web-hero-preview__code-section-title" size="xs" fw={700}>
                    CSS
                  </Text>
                  <textarea
                    className="tc-web-hero-preview__code-editor tc-web-hero-preview__code-editor--css nodrag nopan"
                    value={cssDraft}
                    spellCheck={false}
                    onChange={(event) => setCssDraft(event.currentTarget.value)}
                    style={{
                      flex: 1,
                      minHeight: 140,
                      resize: 'vertical',
                      border: 0,
                      color: nodeShellText,
                      padding: 12,
                      fontSize: 11,
                      lineHeight: 1.45,
                      fontFamily: 'ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace',
                    }}
                  />
                </div>
              </div>
            </div>
          </Tabs.Panel>
        </Tabs>
      ) : (
        <div
          className="tc-web-hero-preview__empty"
          style={{
            flex: 1,
            minHeight: 220,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 10,
            textAlign: 'center',
            padding: 18,
          }}
        >
          <Text className="tc-web-hero-preview__empty-title" size="sm" fw={700}>
            等待生成网页代码
          </Text>
          <Text className="tc-web-hero-preview__empty-copy" size="xs" c="dimmed">
            先把图片或视频节点连到这里，再运行生成完整网页。
          </Text>
          <Button className="tc-web-hero-preview__empty-button" size="compact-xs" variant="light" loading={isRunning} onClick={handleRun}>
            生成预览
          </Button>
        </div>
      )}
      {focusPreview}
    </div>
  )
}
