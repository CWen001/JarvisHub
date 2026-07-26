import React from 'react'
import {
  ActionIcon,
  Button,
  Center,
  Group,
  Image,
  Loader,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
  Transition,
  useMantineColorScheme,
} from '@mantine/core'
import { IconAlertTriangle, IconArchive, IconCloudUpload, IconCopy, IconDownload, IconFileText, IconPhoto, IconPlus, IconRefresh, IconVideo, IconWorld } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { calculateSafeMaxHeight } from './utils/panelPosition'
import { exportAssetsZip, listServerAssets, rehostServerAssets, type AssetZipKind, type ServerAssetDto } from '../api/server'
import { toast } from './toast'
import { PanelCard } from './PanelCard'
import { setJarvisHubImageDragData } from '../canvas/dnd/setJarvisHubImageDragData'
import { useRFStore } from '../canvas/store'
import { stopPanelWheelPropagation } from './utils/panelWheel'
import { $ } from '../canvas/i18n'
import { collectCanvasAssetsForZip } from './assetCenterExport'
import { collectCanvasAssets, type CanvasNodeAsset } from './canvasAssetModel'
import { downloadBlob } from '../utils/download'
import { useViewportVisibility } from '../domain/resource-runtime/hooks/useViewportVisibility'

type AssetKind = 'all' | 'image' | 'video' | 'text' | 'webpage'
type Scope = 'canvas' | 'all'

type CanvasAssetItem = CanvasNodeAsset

function parseAssetKind(data: any): AssetKind {
  if (!data) return 'image'
  const mediaType = data.type
  if (mediaType === 'image' || mediaType === 'video') return mediaType
  const kind = data.kind
  if (kind === 'text' || kind === 'webpage') return kind
  if (kind === 'image' || kind === 'video') return kind
  return 'image'
}

function getAssetDisplayUrl(data: any): string | null {
  if (!data) return null
  return data.url || data.thumbnailUrl || null
}

function getAssetDisplayText(data: any): string | null {
  if (!data) return null
  return data.text || data.documentHtml?.slice(0, 100) || null
}

function assetKindToZipKind(kind: AssetKind): AssetZipKind {
  if (kind === 'image' || kind === 'video' || kind === 'text') return kind
  if (kind === 'webpage') return 'html'
  return 'all'
}

const WEB_ASSET_THUMB_DESIGN_WIDTH = 1200
const WEB_ASSET_THUMB_DESIGN_HEIGHT = 900

// Render a webpage asset (full HTML document) as a shrunk, script-disabled
// preview instead of raw source text. sandbox="" renders in normal document
// mode (external imgs/fonts/CDN CSS still load — same opaque-origin behavior as
// WebHeroPreview's iframe) but executes NO JS, so a grid of these stays cheap
// and safe. The iframe is lazy-mounted only once the card scrolls into view.
function WebAssetThumb({ html, isDark }: { html: string | null; isDark: boolean }): JSX.Element {
  const { ref, isVisible } = useViewportVisibility<HTMLDivElement>({ rootMargin: '200px', freezeOnceVisible: true })
  const [wrapperWidth, setWrapperWidth] = React.useState(0)

  const bindRef = React.useCallback((node: HTMLDivElement | null) => {
    ;(ref as React.MutableRefObject<HTMLDivElement | null>).current = node
    if (node) setWrapperWidth(node.getBoundingClientRect().width)
  }, [ref])

  React.useEffect(() => {
    const node = ref.current
    if (node) setWrapperWidth(node.getBoundingClientRect().width)
  }, [ref, isVisible])

  const scale = (wrapperWidth || 178) / WEB_ASSET_THUMB_DESIGN_WIDTH
  const trimmed = typeof html === 'string' ? html.trim() : ''

  return (
    <div
      ref={bindRef}
      className="asset-center-panel-card-web"
      style={{
        position: 'relative',
        width: '100%',
        height: 80,
        overflow: 'hidden',
        background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
      }}
    >
      {isVisible && trimmed ? (
        <iframe
          className="asset-center-panel-card-web-frame"
          srcDoc={trimmed}
          sandbox=""
          scrolling="no"
          tabIndex={-1}
          aria-hidden
          title=""
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            border: 0,
            width: WEB_ASSET_THUMB_DESIGN_WIDTH,
            height: WEB_ASSET_THUMB_DESIGN_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        />
      ) : !trimmed ? (
        <Center className="asset-center-panel-card-web-empty" style={{ height: '100%' }}>
          <Text size="xs" c="dimmed">Web page</Text>
        </Center>
      ) : null}
      <div
        className="asset-center-panel-card-kind-badge"
        style={{ position: 'absolute', top: 4, left: 4, zIndex: 1, background: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 2 }}
      >
        <IconWorld size={10} color="#fff" />
      </div>
    </div>
  )
}

export default function AssetCenterPanel(): JSX.Element | null {
  const active = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const anchorY = useUIStore((s) => s.panelAnchorY)
  const addNode = useRFStore((s) => s.addNode)
  const nodes = useRFStore((s) => s.nodes)
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'

  const mounted = active === 'gallery'
  const [scope, setScope] = React.useState<Scope>('canvas')
  const [kindFilter, setKindFilter] = React.useState<AssetKind>('all')
  const [serverAssets, setServerAssets] = React.useState<ServerAssetDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [rehosting, setRehosting] = React.useState(false)
  const [exportingScope, setExportingScope] = React.useState<Scope | null>(null)

  const maxHeight = calculateSafeMaxHeight(anchorY, 150)

  const canvasAssets = React.useMemo(() => {
    if (!mounted || scope !== 'canvas') return []
    return collectCanvasAssets(nodes)
  }, [mounted, scope, nodes])

  const loadServerAssets = React.useCallback(async () => {
    setLoading(true)
    try {
      const kindParam = kindFilter === 'all' ? undefined : kindFilter
      const { items } = await listServerAssets({ limit: 50, kind: kindParam })
      setServerAssets(items)
    } catch (err: any) {
      console.error(err)
      toast(err?.message || 'Failed to load assets', 'error')
      setServerAssets([])
    } finally {
      setLoading(false)
    }
  }, [kindFilter])

  const handleRehost = React.useCallback(async () => {
    setRehosting(true)
    try {
      const result = await rehostServerAssets()
      if (result.total === 0) {
        toast('All assets persisted', 'success')
      } else {
        const expired = result.results.filter((r) => r.status === 'expired').length
        const parts: string[] = []
        if (result.succeeded > 0) parts.push(`${result.succeeded} persisted`)
        if (expired > 0) parts.push(`${expired} expired & removed`)
        if (result.failed - expired > 0) parts.push(`${result.failed - expired} failed`)
        const level = (result.failed - expired > 0) ? 'warning' : 'success'
        toast(parts.join(', '), level as any)
      }
      await loadServerAssets()
    } catch (err: any) {
      toast(err?.message || 'Persist failed', 'error')
    } finally {
      setRehosting(false)
    }
  }, [loadServerAssets])

  React.useEffect(() => {
    if (!mounted || scope !== 'all') return
    loadServerAssets().catch(() => {})
  }, [mounted, scope, loadServerAssets])

  const filteredCanvasAssets = React.useMemo(() => {
    if (kindFilter === 'all') return canvasAssets
    return canvasAssets.filter((a) => a.kind === kindFilter)
  }, [canvasAssets, kindFilter])

  const zipKind = assetKindToZipKind(kindFilter)
  const canvasZipAssets = React.useMemo(() => {
    if (!mounted) return []
    return collectCanvasAssetsForZip(nodes, zipKind)
  }, [mounted, nodes, zipKind])

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('Copied', 'success')
    } catch {
      toast('Copy failed', 'error')
    }
  }

  const handleExportZip = React.useCallback(async (targetScope: Scope) => {
    if (targetScope === 'canvas' && canvasZipAssets.length === 0) {
      toast('No exportable assets', 'warning')
      return
    }
    setExportingScope(targetScope)
    try {
      const result = await exportAssetsZip(
        targetScope === 'canvas'
          ? { scope: 'canvas', kind: zipKind, assets: canvasZipAssets }
          : { scope: 'all', kind: zipKind },
      )
      downloadBlob(result.blob, result.filename)
      toast('ZIP export started', 'success')
    } catch (err: any) {
      toast(err?.message || 'ZIP export failed', 'error')
    } finally {
      setExportingScope(null)
    }
  }, [canvasZipAssets, zipKind])

  const handleAddToCanvas = (item: CanvasAssetItem | ServerAssetDto, kind: AssetKind) => {
    const isServerAsset = 'data' in item && 'createdAt' in item
    if (kind === 'image') {
      const url = isServerAsset ? getAssetDisplayUrl((item as ServerAssetDto).data) : (item as CanvasAssetItem).url
      if (url) {
        addNode('taskNode', undefined, { kind: 'image', imageUrl: url })
        toast('Added to canvas', 'success')
      }
    } else if (kind === 'video') {
      const url = isServerAsset ? getAssetDisplayUrl((item as ServerAssetDto).data) : (item as CanvasAssetItem).url
      const thumbUrl = isServerAsset ? ((item as ServerAssetDto).data?.thumbnailUrl || null) : ((item as CanvasAssetItem).thumbnailUrl || null)
      if (url) {
        addNode('taskNode', undefined, {
          kind: 'video',
          videoUrl: url,
          videoThumbnailUrl: thumbUrl,
          videoResults: [{ url, thumbnailUrl: thumbUrl }],
        })
        toast('Added to canvas', 'success')
      }
    } else if (kind === 'text') {
      const text = isServerAsset ? getAssetDisplayText((item as ServerAssetDto).data) : (item as CanvasAssetItem).text
      if (text) {
        addNode('taskNode', undefined, { kind: 'text', textResults: [{ text }] })
        toast('Added to canvas', 'success')
      }
    } else if (kind === 'webpage') {
      const html = isServerAsset ? ((item as ServerAssetDto).data?.documentHtml || '') : (item as CanvasAssetItem).text
      if (html) {
        addNode('taskNode', undefined, { kind: 'webHero', webHeroDocumentHtml: html })
        toast('Added to canvas', 'success')
      }
    }
  }

  const kindIcons: Record<AssetKind, JSX.Element> = {
    all: <IconPhoto size={14} />,
    image: <IconPhoto size={14} />,
    video: <IconVideo size={14} />,
    text: <IconFileText size={14} />,
    webpage: <IconWorld size={14} />,
  }

  return (
    <Transition mounted={mounted} transition="pop" duration={150}>
      {(styles) => (
        <div
          className="asset-center-panel-root"
          style={{
            ...styles,
            position: 'fixed',
            left: 76,
            top: Math.max(40, (anchorY || 200) - 200),
            zIndex: 290,
            width: 380,
          }}
          data-ux-floating
          onWheel={stopPanelWheelPropagation}
        >
          <PanelCard className="asset-center-panel-card" padding="compact">
            <Stack className="asset-center-panel-stack" gap={8} style={{ maxHeight, overflow: 'hidden' }}>
              <Group className="asset-center-panel-header" justify="space-between" px={8} pt={4}>
                <Title className="asset-center-panel-title" order={5} fw={600}>{$('我的资产')}</Title>
                <Group className="asset-center-panel-actions" gap={4}>
                  <Tooltip label="Persist all assets" zIndex={400}>
                    <ActionIcon className="asset-center-panel-rehost" variant="subtle" size="sm" loading={rehosting} onClick={handleRehost}>
                      <IconCloudUpload size={14} />
                    </ActionIcon>
                  </Tooltip>
                  {scope === 'all' && (
                    <Tooltip label="Refresh" zIndex={400}>
                      <ActionIcon className="asset-center-panel-refresh" variant="subtle" size="sm" onClick={() => loadServerAssets()}>
                        <IconRefresh size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  <ActionIcon className="asset-center-panel-close" variant="subtle" size="sm" onClick={() => setActivePanel(null)}>
                    ✕
                  </ActionIcon>
                </Group>
              </Group>

              <Group className="asset-center-panel-scope" px={8} gap={4}>
                <SegmentedControl
                  className="asset-center-panel-scope-control"
                  size="xs"
                  value={scope}
                  onChange={(v) => setScope(v as Scope)}
                  data={[
                    { label: 'Canvas', value: 'canvas' },
                    { label: 'All', value: 'all' },
                  ]}
                />
              </Group>

              <Group className="asset-center-panel-export-actions" px={8} gap={6} wrap="nowrap">
                <Button
                  className="asset-center-panel-export-canvas"
                  size="xs"
                  variant="light"
                  leftSection={<IconDownload size={12} />}
                  loading={exportingScope === 'canvas'}
                  disabled={exportingScope !== null || canvasZipAssets.length === 0}
                  onClick={() => void handleExportZip('canvas')}
                >
                  Canvas ZIP
                </Button>
                <Button
                  className="asset-center-panel-export-all"
                  size="xs"
                  variant="light"
                  leftSection={<IconArchive size={12} />}
                  loading={exportingScope === 'all'}
                  disabled={exportingScope !== null}
                  onClick={() => void handleExportZip('all')}
                >
                  All ZIP
                </Button>
              </Group>

              <Group className="asset-center-panel-kind-filter" px={8} gap={4}>
                <SegmentedControl
                  className="asset-center-panel-kind-control"
                  size="xs"
                  value={kindFilter}
                  onChange={(v) => setKindFilter(v as AssetKind)}
                  data={[
                    { label: 'All', value: 'all' },
                    { label: 'Image', value: 'image' },
                    { label: 'Video', value: 'video' },
                    { label: 'Text', value: 'text' },
                    { label: 'Web', value: 'webpage' },
                  ]}
                />
              </Group>

              <div
                className="asset-center-panel-grid-container"
                style={{ overflowY: 'auto', maxHeight: Math.max(120, maxHeight - 154), padding: '0 8px 8px' }}
              >
                {loading && (
                  <Center className="asset-center-panel-loader" py={20}>
                    <Loader size="sm" />
                  </Center>
                )}

                {!loading && scope === 'canvas' && filteredCanvasAssets.length === 0 && (
                  <Center className="asset-center-panel-empty" py={20}>
                    <Text className="asset-center-panel-empty-text" size="xs" c="dimmed">No matching assets on canvas</Text>
                  </Center>
                )}

                {!loading && scope === 'all' && serverAssets.length === 0 && (
                  <Center className="asset-center-panel-empty" py={20}>
                    <Text className="asset-center-panel-empty-text" size="xs" c="dimmed">No assets</Text>
                  </Center>
                )}

                {scope === 'canvas' && (
                  <div className="asset-center-panel-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {filteredCanvasAssets.map((item) => (
                      <div
                        className="asset-center-panel-card-item"
                        key={item.nodeId}
                        style={{
                          borderRadius: 6,
                          overflow: 'hidden',
                          background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
                          cursor: 'pointer',
                        }}
                      >
                        {item.kind === 'image' && item.url && (
                          <div className="asset-center-panel-card-media" style={{ position: 'relative' }}>
                            <Image
                              className="asset-center-panel-card-image"
                              src={item.thumbnailUrl || item.url}
                              alt={item.label}
                              h={80}
                              fit="cover"
                              draggable
                              onDragStart={(evt) => item.url && setJarvisHubImageDragData(evt as any, item.url)}
                            />
                            <div className="asset-center-panel-card-kind-badge" style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 2 }}>
                              <IconPhoto size={10} color="#fff" />
                            </div>
                          </div>
                        )}
                        {item.kind === 'video' && item.url && (
                          <div className="asset-center-panel-card-media" style={{ position: 'relative' }}>
                            <video
                              className="asset-center-panel-card-video"
                              src={item.url}
                              poster={item.thumbnailUrl || undefined}
                              muted
                              loop
                              playsInline
                              draggable
                              style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }}
                              onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                              onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }}
                              onDragStart={(evt) => item.url && setJarvisHubImageDragData(evt as any, item.url)}
                            />
                            <div className="asset-center-panel-card-kind-badge" style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 2 }}>
                              <IconVideo size={10} color="#fff" />
                            </div>
                          </div>
                        )}
                        {item.kind === 'text' && (
                          <div className="asset-center-panel-card-text" style={{ padding: 6, height: 80, overflow: 'hidden' }}>
                            <Text className="asset-center-panel-card-text-content" size="xs" lineClamp={4}>{item.label}</Text>
                          </div>
                        )}
                        {item.kind === 'webpage' && (
                          <WebAssetThumb html={item.text ?? null} isDark={isDark} />
                        )}
                        <div className="asset-center-panel-card-label" style={{ padding: '4px 6px', overflow: 'hidden' }}>
                          <Text className="asset-center-panel-card-label-text" size="xs" lineClamp={1} c="dimmed">{item.label}</Text>
                        </div>
                        <Group className="asset-center-panel-card-actions" px={4} py={2} gap={2} justify="flex-end">
                          <Tooltip label="Add to canvas">
                            <ActionIcon className="asset-center-panel-card-add" variant="subtle" size="xs" onClick={() => handleAddToCanvas(item, item.kind)}>
                              <IconPlus size={12} />
                            </ActionIcon>
                          </Tooltip>
                          {item.url && (
                            <Tooltip label="Copy link">
                              <ActionIcon className="asset-center-panel-card-copy" variant="subtle" size="xs" onClick={() => handleCopy(item.url!)}>
                                <IconCopy size={12} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          {item.text && !item.url && (
                            <Tooltip label="Copy text">
                              <ActionIcon className="asset-center-panel-card-copy" variant="subtle" size="xs" onClick={() => handleCopy(item.text!)}>
                                <IconCopy size={12} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </Group>
                      </div>
                    ))}
                  </div>
                )}

                {scope === 'all' && !loading && (
                  <div className="asset-center-panel-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {serverAssets.map((asset) => {
                      const data = asset.data || {}
                      const kind = parseAssetKind(data)
                      const url = getAssetDisplayUrl(data)
                      const text = getAssetDisplayText(data)
                      const hostingStatus = data?.hosting?.status as string | undefined
                      const isUnhosted = hostingStatus === 'pending' || hostingStatus === 'failed'
                      if (kindFilter !== 'all' && kind !== kindFilter) return null
                      return (
                        <div
                          className="asset-center-panel-card-item"
                          key={asset.id}
                          style={{
                            position: 'relative',
                            borderRadius: 6,
                            overflow: 'hidden',
                            background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
                            cursor: 'pointer',
                          }}
                        >
                          {isUnhosted && (
                            <Tooltip label={hostingStatus === 'failed' ? 'Persist failed' : 'Not persisted'} zIndex={400}>
                              <div className="asset-center-panel-card-badge" style={{
                                position: 'absolute', top: 4, right: 4, zIndex: 1,
                                background: 'rgba(0,0,0,0.6)', borderRadius: '50%',
                                width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}>
                                <IconAlertTriangle size={11} color={hostingStatus === 'failed' ? '#ff6b6b' : '#fab005'} />
                              </div>
                            </Tooltip>
                          )}
                          {kind === 'image' && url && (
                            <div className="asset-center-panel-card-media" style={{ position: 'relative' }}>
                              <Image
                                className="asset-center-panel-card-image"
                                src={data.thumbnailUrl || url}
                                alt={asset.name}
                                h={80}
                                fit="cover"
                                draggable
                                onDragStart={(evt) => url && setJarvisHubImageDragData(evt as any, url)}
                              />
                              <div className="asset-center-panel-card-kind-badge" style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 2 }}>
                                <IconPhoto size={10} color="#fff" />
                              </div>
                            </div>
                          )}
                          {kind === 'video' && url && (
                            <div className="asset-center-panel-card-media" style={{ position: 'relative' }}>
                              <video
                                className="asset-center-panel-card-video"
                                src={url}
                                poster={data.thumbnailUrl || undefined}
                                muted
                                loop
                                playsInline
                                draggable
                                style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }}
                                onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                                onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }}
                                onDragStart={(evt) => url && setJarvisHubImageDragData(evt as any, url)}
                              />
                              <div className="asset-center-panel-card-kind-badge" style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 2 }}>
                                <IconVideo size={10} color="#fff" />
                              </div>
                            </div>
                          )}
                          {kind === 'text' && (
                            <div className="asset-center-panel-card-text" style={{ padding: 6, height: 80, overflow: 'hidden' }}>
                              <Text className="asset-center-panel-card-text-content" size="xs" lineClamp={4}>{text || asset.name}</Text>
                            </div>
                          )}
                          {kind === 'webpage' && (
                            <WebAssetThumb html={data.documentHtml ?? null} isDark={isDark} />
                          )}
                          <div className="asset-center-panel-card-label" style={{ padding: '4px 6px', overflow: 'hidden' }}>
                            <Text className="asset-center-panel-card-label-text" size="xs" lineClamp={1} c="dimmed">{asset.name || data.prompt || ''}</Text>
                          </div>
                          <Group className="asset-center-panel-card-actions" px={4} py={2} gap={2} justify="flex-end">
                            <Tooltip label="Add to canvas">
                              <ActionIcon className="asset-center-panel-card-add" variant="subtle" size="xs" onClick={() => handleAddToCanvas(asset, kind)}>
                                <IconPlus size={12} />
                              </ActionIcon>
                            </Tooltip>
                            {url && (
                              <Tooltip label="Copy link">
                                <ActionIcon className="asset-center-panel-card-copy" variant="subtle" size="xs" onClick={() => handleCopy(url)}>
                                  <IconCopy size={12} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                            {text && !url && (
                              <Tooltip label="Copy text">
                                <ActionIcon className="asset-center-panel-card-copy" variant="subtle" size="xs" onClick={() => handleCopy(text)}>
                                  <IconCopy size={12} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </Group>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </Stack>
          </PanelCard>
        </div>
      )}
    </Transition>
  )
}
