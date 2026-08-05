import React from 'react'
import {
  ActionIcon,
  Drawer,
  Group,
  Loader,
  SegmentedControl,
  Text,
  Tooltip,
} from '@mantine/core'
import {
  IconDownload,
  IconAlertTriangle,
  IconLayoutBoard,
  IconPaperclip,
  IconPencil,
  IconPhoto,
  IconPlus,
  IconVideo,
  IconX,
} from '@tabler/icons-react'
import { toast } from '../ui/toast'
import type { AgentWorkspaceAssetView } from './agentWorkspaceProjection'
import type { AgentWorkspaceRuntime } from './agentWorkspaceRuntime'
import { ArtifactPreview, type ArtifactPreviewAction } from '../ui/shared/ArtifactPreview'

type AssetKind = 'all' | 'image' | 'video'
type Scope = 'canvas' | 'all'

type ProductAssetItem = AgentWorkspaceAssetView & Readonly<{ key: string }>

function productAssetItem(asset: AgentWorkspaceAssetView, index: number): ProductAssetItem {
  return {
    ...asset,
    key: `${asset.scope}:${asset.nodeId || asset.assetId || asset.assetRefId || index}:${asset.url}`,
  }
}

export function ProductAssetPanel({
  runtime,
  opened,
  onClose,
}: {
  runtime: AgentWorkspaceRuntime
  opened: boolean
  onClose: () => void
}): JSX.Element {
  const snapshot = React.useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const [scope, setScope] = React.useState<Scope>('canvas')
  const [kind, setKind] = React.useState<AssetKind>('all')
  const [preview, setPreview] = React.useState<ProductAssetItem | null>(null)

  const items = React.useMemo(() => snapshot.assets.items
    .filter((asset) => scope === 'all' || asset.scope === 'canvas')
    .filter((asset) => kind === 'all' || asset.kind === kind)
    .map(productAssetItem), [kind, scope, snapshot.assets.items])

  const dispatchAssetIntent = async (
    type: 'asset.modify' | 'asset.add-to-canvas' | 'asset.reference',
    item: ProductAssetItem,
  ) => {
    const outcome = await runtime.dispatch({ type, asset: item })
    if (!outcome.accepted) {
      toast(outcome.message, 'error')
      return
    }
    toast(
      type === 'asset.reference'
        ? '已添加到当前对话'
        : type === 'asset.modify'
          ? '已添加为继续修改目标'
          : '已添加到专业工作台',
      'success',
    )
  }

  const openProfessional = async (item: ProductAssetItem) => {
    const outcome = await runtime.dispatch({
      type: 'open-professional-workspace',
      ...(item.nodeId ? { nodeId: item.nodeId } : {}),
    })
    if (!outcome.accepted) toast(outcome.message, 'error')
  }

  const onPreviewAction = (action: ArtifactPreviewAction, item: ProductAssetItem) => {
    if (action === 'add-to-workspace') void dispatchAssetIntent('asset.add-to-canvas', item)
    if (action === 'modify') void dispatchAssetIntent('asset.modify', item)
    if (action === 'reference') void dispatchAssetIntent('asset.reference', item)
    if (action === 'open-node') void openProfessional(item)
  }

  return (
    <>
      <Drawer
        className="product-asset-panel"
        opened={opened}
        onClose={onClose}
        position="right"
        size="min(92vw, 760px)"
        withCloseButton={false}
        zIndex={850}
      >
        <header className="product-asset-panel__header">
          <div>
            <Text fw={700} size="lg">资产</Text>
            <Text size="xs" c="dimmed">权威项目资产与当前画布成果</Text>
          </div>
          <ActionIcon variant="subtle" size={44} aria-label="关闭资产" onClick={onClose}>
            <IconX size={20} />
          </ActionIcon>
        </header>
        <div className="product-asset-panel__filters">
          <SegmentedControl
            value={scope}
            onChange={(value) => setScope(value as Scope)}
            data={[{ value: 'canvas', label: '当前画布' }, { value: 'all', label: '全部资产' }]}
          />
          <SegmentedControl
            value={kind}
            onChange={(value) => setKind(value as AssetKind)}
            data={[
              { value: 'all', label: '全部' },
              { value: 'image', label: '图片' },
              { value: 'video', label: '视频' },
            ]}
          />
        </div>
        {snapshot.assets.state === 'error' && items.length > 0 ? (
          <div className="product-asset-panel__notice" role="status">
            <IconAlertTriangle size={18} />
            <span>{snapshot.assets.errorMessage}</span>
          </div>
        ) : null}
        {snapshot.assets.state === 'loading' && items.length === 0 ? (
          <div className="product-asset-panel__state" role="status"><Loader size={22} /><span>正在读取资产</span></div>
        ) : snapshot.assets.state === 'error' && items.length === 0 ? (
          <div className="product-asset-panel__state is-error" role="alert"><IconAlertTriangle size={24} /><span>{snapshot.assets.errorMessage}</span></div>
        ) : items.length === 0 ? (
          <div className="product-asset-panel__state"><IconPhoto size={24} /><span>当前范围暂无可用资产</span></div>
        ) : (
          <div className="product-asset-panel__grid">
            {items.map((item) => (
              <article className="product-asset-card" key={item.key}>
                <button type="button" className="product-asset-card__preview" onClick={() => setPreview(item)} aria-label={`预览${item.title}`}>
                  {item.kind === 'video' ? (
                    <video src={item.url} poster={item.thumbnailUrl} muted playsInline preload="metadata" />
                  ) : (
                    <img src={item.thumbnailUrl || item.url} alt={item.title} loading="lazy" />
                  )}
                  <span>{item.kind === 'video' ? <IconVideo size={14} /> : <IconPhoto size={14} />}</span>
                </button>
                <Text className="product-asset-card__title" size="sm" fw={600} lineClamp={1}>{item.title}</Text>
                <Group className="product-asset-card__actions" gap={2} wrap="nowrap">
                  {item.nodeId ? (
                    <Tooltip label="继续修改"><ActionIcon variant="subtle" aria-label="继续修改" onClick={() => void dispatchAssetIntent('asset.modify', item)}><IconPencil size={18} /></ActionIcon></Tooltip>
                  ) : (
                    <Tooltip label="添加到专业工作台"><ActionIcon variant="subtle" aria-label="添加到专业工作台" onClick={() => void dispatchAssetIntent('asset.add-to-canvas', item)}><IconPlus size={18} /></ActionIcon></Tooltip>
                  )}
                  <Tooltip label="作为对话参考"><ActionIcon variant="subtle" aria-label="作为对话参考" onClick={() => void dispatchAssetIntent('asset.reference', item)}><IconPaperclip size={18} /></ActionIcon></Tooltip>
                  {item.nodeId ? (
                    <Tooltip label="在专业工作台打开"><ActionIcon variant="subtle" aria-label="在专业工作台打开" onClick={() => void openProfessional(item)}><IconLayoutBoard size={18} /></ActionIcon></Tooltip>
                  ) : null}
                  <Tooltip label="下载"><ActionIcon component="a" href={item.url} download target="_blank" rel="noreferrer" variant="subtle" aria-label="下载"><IconDownload size={18} /></ActionIcon></Tooltip>
                </Group>
              </article>
            ))}
          </div>
        )}
      </Drawer>
      <ArtifactPreview
        item={preview}
        opened={Boolean(preview)}
        actions={preview?.nodeId
          ? ['modify', 'reference', 'open-node']
          : ['add-to-workspace', 'reference']}
        onClose={() => setPreview(null)}
        onAction={(action) => preview && onPreviewAction(action, preview)}
      />
    </>
  )
}
