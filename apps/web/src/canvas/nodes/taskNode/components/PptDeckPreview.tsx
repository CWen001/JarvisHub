import React, { useCallback, useEffect, useState } from 'react'
import { ActionIcon, Badge, Button, Group, Loader, Text, Tooltip } from '@mantine/core'
import { IconDownload, IconFileExport, IconFolder, IconLayoutGrid, IconPresentation } from '@tabler/icons-react'
import { exportPptDeckToPptx } from '../../../../api/server'
import { resolvePptDeckPreviewSlides, type PptSlidePreview } from './pptDeckPreviewSlides'
import { svgMarkupToImageDataUrl } from './pptDeckSvgImage'

type PptDeckPreviewProps = {
  data: Record<string, unknown>
  nodeId?: string
  flowId?: string
  projectId?: string | null
  onPptxReady?: (patch: { pptxUrl?: string; pptxPath?: string; pptMasterStatus?: string }) => void
}

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const FORMAT_RATIOS: Record<string, number> = {
  ppt169: 16 / 9,
  ppt43: 4 / 3,
  xhs: 3 / 4,
  story: 9 / 16,
}

const sanitizeSvgMarkup = (markup: string): string | null => {
  const trimmed = markup.trim()
  if (!trimmed) return null
  if (!trimmed.toLowerCase().startsWith('<svg')) return null
  return trimmed.replace(/<script[\s\S]*?<\/script>/gi, '')
}

const SVG_FETCH_CACHE = new Map<string, Promise<string>>()
const SVG_TEXT_CACHE = new Map<string, string>()

/**
 * Rewrite relative image references against the SVG asset URL before the
 * markup is rendered through an isolated image document.
 */
const rewriteRelativeSvgRefs = (markup: string, baseUrl: string): string => {
  if (!markup || !baseUrl) return markup
  // Trust only http(s) bases; data: / blob: bases are pointless here.
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return markup
  }
  const replaceAttr = (input: string, attr: string): string => {
    const re = new RegExp(`(${attr})\\s*=\\s*"([^"]+)"`, 'g')
    return input.replace(re, (_match, name: string, value: string) => {
      const trimmed = value.trim()
      if (!trimmed) return _match
      if (/^(?:https?:|data:|blob:|#)/i.test(trimmed)) return _match
      try {
        const resolved = new URL(trimmed, base).toString()
        return `${name}="${resolved}"`
      } catch {
        return _match
      }
    })
  }
  let out = replaceAttr(markup, 'href')
  out = replaceAttr(out, 'xlink:href')
  return out
}

const svgCacheKey = (url: string, revision?: string): string => `${url}::${revision || 'current'}`

const IMAGE_HREF_RE = /(href|xlink:href)\s*=\s*"(https?:[^"]+)"/gi
const IMAGE_DATA_URI_CACHE = new Map<string, Promise<string | null>>()

const fetchImageAsDataUri = (url: string): Promise<string | null> => {
  const cached = IMAGE_DATA_URI_CACHE.get(url)
  if (cached) return cached
  const promise = fetch(url, { credentials: 'omit', cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error(`image fetch failed: ${res.status}`)
      return res.blob()
    })
    .then((blob) => new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    }))
    .catch(() => {
      IMAGE_DATA_URI_CACHE.delete(url)
      return null
    })
  IMAGE_DATA_URI_CACHE.set(url, promise)
  return promise
}

/**
 * An SVG rendered through <img>/data: URI runs in the browser's secure static
 * mode, which blocks external resource loads — so <image href="https://…"> never
 * paints. Fetch each external image and inline it as a data: URI so the composed
 * SVG is fully self-contained. Refs that fail to load are left untouched.
 */
const inlineExternalImages = async (markup: string): Promise<string> => {
  if (!markup) return markup
  const urls = new Set<string>()
  for (const match of markup.matchAll(IMAGE_HREF_RE)) {
    const url = match[2]?.trim()
    if (url) urls.add(url)
  }
  if (!urls.size) return markup
  const entries = await Promise.all(
    Array.from(urls).map(async (url) => [url, await fetchImageAsDataUri(url)] as const),
  )
  const dataUriByUrl = new Map(entries.filter((entry): entry is [string, string] => Boolean(entry[1])))
  if (!dataUriByUrl.size) return markup
  return markup.replace(IMAGE_HREF_RE, (whole, attr: string, url: string) => {
    const dataUri = dataUriByUrl.get(url.trim())
    return dataUri ? `${attr}="${dataUri}"` : whole
  })
}

const fetchSvgMarkup = (url: string, revision?: string): Promise<string> => {
  const key = svgCacheKey(url, revision)
  const cached = SVG_FETCH_CACHE.get(key)
  if (cached) return cached
  const promise = fetch(url, { credentials: 'omit', cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error(`SVG fetch failed: ${res.status}`)
      return res.text()
    })
    .then(async (text) => {
      const cleaned = sanitizeSvgMarkup(text)
      if (!cleaned) return ''
      const rewritten = rewriteRelativeSvgRefs(cleaned, url)
      // Inline external images so the SVG paints through <img> (secure static mode).
      const inlined = await inlineExternalImages(rewritten)
      if (inlined) SVG_TEXT_CACHE.set(key, inlined)
      return inlined
    })
    .catch((err) => {
      SVG_FETCH_CACHE.delete(key)
      throw err
    })
  SVG_FETCH_CACHE.set(key, promise)
  return promise
}

/**
 * Fetch the SVG once, resolve its relative image references, and render the
 * result as an image document. SVG markup never enters the host DOM.
 */
function InlineSvgFromUrl({ url, className, fallbackTitle, revision }: {
  url: string
  className: string
  fallbackTitle?: string
  revision?: string
}) {
  const cacheKey = svgCacheKey(url, revision)
  const [markup, setMarkup] = useState<string | null>(() => SVG_TEXT_CACHE.get(cacheKey) ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    const cachedText = SVG_TEXT_CACHE.get(cacheKey)
    if (cachedText) {
      setMarkup(cachedText)
      return () => { cancelled = true }
    }
    setMarkup(null)
    fetchSvgMarkup(url, revision)
      .then((text) => {
        if (cancelled) return
        if (!text) {
          setFailed(true)
          return
        }
        setMarkup(text)
      })
      .catch(() => {
        if (cancelled) return
        setFailed(true)
      })
    return () => { cancelled = true }
  }, [cacheKey, revision, url])

  if (failed) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>
        SVG 加载失败
      </div>
    )
  }

  if (!markup) {
    return <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>加载中…</div>
  }

  return <img src={svgMarkupToImageDataUrl(markup)} alt={fallbackTitle || ''} className={className} loading="lazy" />
}

function SlideThumb({ slide, ratio, svgRevision }: { slide: PptSlidePreview; ratio: number; svgRevision?: string }) {
  const cleanSvg = slide.svgMarkup ? sanitizeSvgMarkup(slide.svgMarkup) : null
  const hasVisual = Boolean(slide.imageUrl || slide.svgUrl || cleanSvg)

  return (
    <div className="tc-ppt-deck-slide" style={{ aspectRatio: `${ratio}` }}>
      <div className="tc-ppt-deck-slide__index">{String(slide.index + 1).padStart(2, '0')}</div>
      <div className="tc-ppt-deck-slide__canvas">
        {hasVisual ? (
          cleanSvg ? (
            <img src={svgMarkupToImageDataUrl(cleanSvg)} alt={slide.title} className="tc-ppt-deck-slide__svg" loading="lazy" />
          ) : slide.svgUrl ? (
            <InlineSvgFromUrl
              url={slide.svgUrl}
              className="tc-ppt-deck-slide__svg"
              fallbackTitle={slide.title}
              revision={svgRevision}
            />
          ) : slide.imageUrl ? (
            <img src={slide.imageUrl} alt={slide.title} className="tc-ppt-deck-slide__img" loading="lazy" />
          ) : null
        ) : (
          <div className="tc-ppt-deck-slide__placeholder">
            <div className="tc-ppt-deck-slide__title">{slide.title}</div>
            {slide.subtitle ? <div className="tc-ppt-deck-slide__subtitle">{slide.subtitle}</div> : null}
            {slide.bullets.length ? (
              <ul className="tc-ppt-deck-slide__bullets">
                {slide.bullets.map((bullet, i) => <li key={`${slide.index}-b-${i}`}>{bullet}</li>)}
              </ul>
            ) : null}
            <div className="tc-ppt-deck-slide__footer">JarvisHub · PPT Master</div>
          </div>
        )}
      </div>
      <div className="tc-ppt-deck-slide__caption" title={slide.title}>{slide.title}</div>
    </div>
  )
}

function SingleSlideView({ slide, ratio, onPrev, onNext, hasPrev, hasNext, svgRevision }: {
  slide: PptSlidePreview
  ratio: number
  onPrev: () => void
  onNext: () => void
  hasPrev: boolean
  hasNext: boolean
  svgRevision?: string
}) {
  const cleanSvg = slide.svgMarkup ? sanitizeSvgMarkup(slide.svgMarkup) : null
  const hasVisual = Boolean(slide.imageUrl || slide.svgUrl || cleanSvg)
  const stop = (event: React.MouseEvent | React.PointerEvent) => {
    event.stopPropagation()
  }
  // Swallow double-clicks on the entire slide surface so a fast double-tap on
  // either side hot zone cannot bubble up to React Flow's onNodeDoubleClick,
  // which would otherwise focus into the node's subgraph mid-navigation.
  const handleDoubleClick = (event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
  }
  const handlePrev = (event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    onPrev()
  }
  const handleNext = (event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    onNext()
  }

  return (
    <div
      className="tc-ppt-deck-single nodrag nopan"
      style={{ aspectRatio: `${ratio}` }}
      onPointerDown={stop}
      onMouseDown={stop}
      onDoubleClick={handleDoubleClick}
    >
      {hasVisual ? (
        slide.imageUrl && !cleanSvg && !slide.svgUrl ? (
          <img src={slide.imageUrl} alt={slide.title} className="tc-ppt-deck-single__img" loading="lazy" />
        ) : cleanSvg ? (
          <img src={svgMarkupToImageDataUrl(cleanSvg)} alt={slide.title} className="tc-ppt-deck-single__svg" loading="lazy" />
        ) : slide.svgUrl ? (
          <InlineSvgFromUrl
            url={slide.svgUrl}
            className="tc-ppt-deck-single__svg"
            fallbackTitle={slide.title}
            revision={svgRevision}
          />
        ) : null
      ) : (
        <div className="tc-ppt-deck-single__fallback">
          <div className="tc-ppt-deck-single__title">{slide.title}</div>
          {slide.subtitle ? <div className="tc-ppt-deck-single__subtitle">{slide.subtitle}</div> : null}
          {slide.bullets.length ? (
            <ul className="tc-ppt-deck-single__bullets">
              {slide.bullets.map((bullet, i) => <li key={`${slide.index}-b-${i}`}>{bullet}</li>)}
            </ul>
          ) : null}
        </div>
      )}
      {/* Wide gradient hot zones on the left/right edges. Clicking anywhere
          inside the zone navigates; the explicit chevron button is just a
          visual affordance. This keeps the touch/click target large while the
          slide content underneath stays readable. */}
      {hasPrev && (
        <button
          type="button"
          className="tc-ppt-deck-single__nav-zone tc-ppt-deck-single__nav-zone--prev nodrag nopan"
          onPointerDown={stop}
          onMouseDown={stop}
          onClick={handlePrev}
          onDoubleClick={handleDoubleClick}
          aria-label="上一页"
        >
          <span className="tc-ppt-deck-single__nav-chevron" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 4 7 12 15 20"/></svg>
          </span>
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          className="tc-ppt-deck-single__nav-zone tc-ppt-deck-single__nav-zone--next nodrag nopan"
          onPointerDown={stop}
          onMouseDown={stop}
          onClick={handleNext}
          onDoubleClick={handleDoubleClick}
          aria-label="下一页"
        >
          <span className="tc-ppt-deck-single__nav-chevron" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 4 17 12 9 20"/></svg>
          </span>
        </button>
      )}
      <div className="tc-ppt-deck-single__counter">{slide.index + 1}</div>
    </div>
  )
}

export function PptDeckPreview({ data, nodeId, flowId, projectId, onPptxReady }: PptDeckPreviewProps) {
  const title = readString(data.label) || 'PPT Deck'
  const prompt = readString(data.prompt)
  const outline = readString(data.outline)
  const format = readString(data.format) || 'ppt169'
  const ratio = FORMAT_RATIOS[format] || 16 / 9
  const status = readString(data.pptMasterStatus) || readString(data.status) || 'draft'
  const audience = readString(data.audience)
  const tone = readString(data.tone)
  const projectPath = readString(data.pptMasterProjectPath)
  const pptxUrl = readString(data.pptxUrl) || readString(data.downloadUrl)
  const lastSvgWrite = data.lastPptMasterSvgWrite && typeof data.lastPptMasterSvgWrite === 'object' && !Array.isArray(data.lastPptMasterSvgWrite)
    ? data.lastPptMasterSvgWrite as Record<string, unknown>
    : null
  const runtimeRecord = data.pptMasterRuntime && typeof data.pptMasterRuntime === 'object' && !Array.isArray(data.pptMasterRuntime)
    ? data.pptMasterRuntime as Record<string, unknown>
    : null
  const runtimeAvailable = runtimeRecord?.available === true
  const runtimeReason = readString(runtimeRecord?.reason)
  const requestedSlideCount = Number(data.slideCount)
  const resolvedSlides = resolvePptDeckPreviewSlides({ slides: data.slides, outline })
  const svgPreviewRevision = [
    status,
    pptxUrl,
    readString(lastSvgWrite?.fileName),
    String(lastSvgWrite?.bytes ?? ''),
    resolvedSlides.length ? resolvedSlides.map((slide) => `${slide.index}:${slide.svgUrl || ''}:${slide.imageUrl || ''}`).join('|') : '',
  ].join('::')
  const slideCount = Number.isFinite(requestedSlideCount) && requestedSlideCount > 0
    ? Math.round(requestedSlideCount)
    : resolvedSlides.length

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const canTriggerExport = Boolean(flowId && nodeId && projectPath)
  const handleExportClick = useCallback(async () => {
    if (!canTriggerExport || exporting) return
    setExporting(true)
    setExportError(null)
    try {
      const result = await exportPptDeckToPptx({
        flowId: flowId as string,
        nodeId: nodeId as string,
        projectId: projectId ?? null,
        projectPath,
      })
      const nextUrl = result.pptxUrl || pptxUrl
      if (nextUrl) {
        onPptxReady?.({
          pptxUrl: result.pptxUrl,
          pptxPath: result.pptxPath,
          pptMasterStatus: 'exported',
        })
        try {
          window.open(nextUrl, '_blank', 'noopener,noreferrer')
        } catch {
          // pop-up blocked; user can still click the now-visible "导出 PPTX" link.
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setExportError(message || '导出失败')
    } finally {
      setExporting(false)
    }
  }, [canTriggerExport, exporting, flowId, nodeId, onPptxReady, projectId, projectPath, pptxUrl])

  const [activeSlide, setActiveSlide] = useState(0)
  const [showGrid, setShowGrid] = useState(false)

  const goPrev = useCallback(() => {
    setActiveSlide((prev) => (prev > 0 ? prev - 1 : resolvedSlides.length - 1))
  }, [resolvedSlides.length])

  const goNext = useCallback(() => {
    setActiveSlide((prev) => (prev < resolvedSlides.length - 1 ? prev + 1 : 0))
  }, [resolvedSlides.length])

  const currentSlide = resolvedSlides[activeSlide]

  return (
    <div className="tc-ppt-deck-preview">
      <div className="tc-ppt-deck-preview__header">
        <div className="tc-ppt-deck-preview__mark">
          <IconPresentation size={19} />
        </div>
        <div className="tc-ppt-deck-preview__title-wrap">
          <div className="tc-ppt-deck-preview__kicker">PPT MASTER</div>
          <Text className="tc-ppt-deck-preview__title" size="sm" fw={800} lineClamp={1}>{title}</Text>
        </div>
        <Group className="tc-ppt-deck-preview__actions" gap={6} wrap="nowrap">
          <Badge className="tc-ppt-deck-preview__badge" variant="light">{format}</Badge>
          <Badge className="tc-ppt-deck-preview__badge" variant="outline">{status}</Badge>
          <Badge className="tc-ppt-deck-preview__badge" color={runtimeAvailable ? 'green' : 'yellow'} variant="light">
            {runtimeAvailable ? 'runtime' : 'setup'}
          </Badge>
          {resolvedSlides.length > 1 && (
            <Tooltip label={showGrid ? '单页模式' : '概览模式'} withArrow>
              <ActionIcon className="tc-ppt-deck-preview__icon-action nodrag nopan" onClick={() => setShowGrid((v) => !v)} size="sm" variant={showGrid ? 'filled' : 'subtle'}>
                <IconLayoutGrid size={15} />
              </ActionIcon>
            </Tooltip>
          )}
          {pptxUrl ? (
            <Tooltip label="下载已生成的 PPTX" withArrow>
              <Button
                className="tc-ppt-deck-preview__export-btn nodrag nopan"
                component="a"
                href={pptxUrl}
                target="_blank"
                rel="noreferrer"
                size="xs"
                variant="filled"
                color="blue"
                leftSection={<IconDownload size={14} />}
              >
                下载 PPTX
              </Button>
            </Tooltip>
          ) : null}
          {canTriggerExport ? (
            <Tooltip label={exportError || (pptxUrl ? '重新导出 PPTX' : '导出 PPTX')} withArrow>
              <Button
                className="tc-ppt-deck-preview__export-btn nodrag nopan"
                onClick={handleExportClick}
                size="xs"
                variant={pptxUrl ? 'outline' : 'filled'}
                color={exportError ? 'red' : pptxUrl ? 'gray' : 'orange'}
                disabled={exporting}
                leftSection={exporting ? <Loader size={12} color={pptxUrl ? 'gray' : 'white'} /> : <IconFileExport size={14} />}
              >
                {exporting ? '导出中…' : pptxUrl ? '重新导出' : '导出 PPTX'}
              </Button>
            </Tooltip>
          ) : null}
        </Group>
      </div>

      <div className="tc-ppt-deck-preview__summary">
        <div className="tc-ppt-deck-preview__metric">
          <strong>{slideCount || '-'}</strong>
          <span>slides</span>
        </div>
        {!showGrid && currentSlide && (
          <div className="tc-ppt-deck-preview__chip">{currentSlide.title}</div>
        )}
        {audience ? <div className="tc-ppt-deck-preview__chip">{audience}</div> : null}
        {tone ? <div className="tc-ppt-deck-preview__chip">{tone}</div> : null}
        {projectPath ? (
          <div className="tc-ppt-deck-preview__path" title={projectPath}>
            <IconFolder size={13} />
            <span>{projectPath}</span>
          </div>
        ) : null}
        {!runtimeAvailable && runtimeReason ? <div className="tc-ppt-deck-preview__chip" title={runtimeReason}>需配置 PPT_MASTER_HOME</div> : null}
      </div>

      {prompt ? <Text className="tc-ppt-deck-preview__brief" size="xs" lineClamp={2}>{prompt}</Text> : null}

      {resolvedSlides.length > 0 && (
        showGrid ? (
          <div className="tc-ppt-deck-preview__viewport nodrag nopan">
            <div className="tc-ppt-deck-preview__grid">
              {resolvedSlides.map((slide) => <SlideThumb key={`slide-${slide.index}`} slide={slide} ratio={ratio} svgRevision={svgPreviewRevision} />)}
            </div>
          </div>
        ) : currentSlide ? (
          <SingleSlideView
            slide={currentSlide}
            ratio={ratio}
            onPrev={goPrev}
            onNext={goNext}
            hasPrev={resolvedSlides.length > 1}
            hasNext={resolvedSlides.length > 1}
            svgRevision={svgPreviewRevision}
          />
        ) : null
      )}
      {resolvedSlides.length === 0 && (
        <div className="tc-ppt-deck-preview__empty">
          <Text size="xs" fw={700}>等待生成 slide</Text>
          <Text size="xs" c="dimmed">大纲、SVG/图片或 PPTX 会依次回填到这里。</Text>
        </div>
      )}
    </div>
  )
}
