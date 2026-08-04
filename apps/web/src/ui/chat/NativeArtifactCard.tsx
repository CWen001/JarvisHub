import React from 'react'
import { ActionIcon, Badge, Group, Modal, Text, Tooltip } from '@mantine/core'
import { IconDownload, IconLayoutBoard, IconPaperclip, IconPencil } from '@tabler/icons-react'
import { useRFStore } from '../../canvas/store'
import { dispatchProductWorkspaceCommand } from '../../product-host/productWorkspace'
import { ArtifactPreview, type ArtifactPreviewAction } from '../shared/ArtifactPreview'
import {
  resolveNativeArtifactProjection,
  type NativeArtifactCardProjection,
  type NativeArtifactSource,
} from './nativeArtifactProjection'

export const NATIVE_ARTIFACT_CHAT_COMMAND = 'jarvishub:native-artifact-chat-command'

export type NativeArtifactChatCommand = Readonly<{
  type: 'modify' | 'reference'
  asset: NativeArtifactSource
}>

export function dispatchNativeArtifactChatCommand(command: NativeArtifactChatCommand): void {
  window.dispatchEvent(new CustomEvent(NATIVE_ARTIFACT_CHAT_COMMAND, { detail: command }))
}

export function NativeArtifactCard({
  asset,
  onProductAction,
}: {
  asset: NativeArtifactSource
  onProductAction?: (action: ArtifactPreviewAction, artifact: NativeArtifactCardProjection) => void
}): JSX.Element {
  const [previewOpened, setPreviewOpened] = React.useState(false)
  const nodes = useRFStore((state) => state.nodes)
  const projection = React.useMemo(
    () => resolveNativeArtifactProjection({ asset, nodes }),
    [asset, nodes],
  )

  if (projection.kind === 'native-thumbnail') {
    const preview = String(asset.thumbnailUrl || asset.url).trim()
    return (
      <a
        href={asset.url}
        target="_blank"
        rel="noreferrer"
        className="tc-ai-chat-bubble__asset-link"
      >
        <img
          className="tc-ai-chat-bubble__asset-image"
          src={preview}
          alt={asset.title}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </a>
    )
  }

  const statusColor = projection.status === 'failed'
    ? 'red'
    : projection.status === 'success'
      ? 'green'
      : 'blue'

  const dispatchArtifactAction = (action: ArtifactPreviewAction) => {
    if (onProductAction) {
      onProductAction(action, projection)
      return
    }
    if (action === 'modify') dispatchNativeArtifactChatCommand({ type: 'modify', asset })
    if (action === 'reference') dispatchNativeArtifactChatCommand({ type: 'reference', asset })
    if (action === 'open-node') dispatchProductWorkspaceCommand({ type: 'open-canvas', nodeId: projection.nodeId })
  }

  return (
    <article className="native-artifact-card">
      <button
        type="button"
        className="native-artifact-card__preview"
        aria-label={`放大查看${projection.title}`}
        onClick={() => setPreviewOpened(true)}
      >
        {projection.mediaType === 'video' ? (
          <video src={projection.url} poster={projection.previewUrl} muted playsInline preload="metadata" />
        ) : (
          <img src={projection.previewUrl} alt={projection.title} loading="lazy" referrerPolicy="no-referrer" />
        )}
        <span>点击查看完整尺寸</span>
      </button>
      <div className="native-artifact-card__body">
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Text className="native-artifact-card__title" fw={650} size="sm" lineClamp={1}>
            {projection.title}
          </Text>
          <Badge size="xs" variant="light" color={statusColor}>
            {projection.status === 'success' ? '已完成' : projection.status === 'failed' ? '失败' : '进行中'}
          </Badge>
        </Group>
        <Group className="native-artifact-card__actions" gap={4} mt={8} wrap="nowrap">
          <Tooltip label="继续修改">
            <ActionIcon
              variant="subtle"
              aria-label="继续修改"
              onClick={() => dispatchArtifactAction('modify')}
            >
              <IconPencil size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="作为参考">
            <ActionIcon
              variant="subtle"
              aria-label="作为参考"
              onClick={() => dispatchArtifactAction('reference')}
            >
              <IconPaperclip size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="进入专业工作台">
            <ActionIcon
              variant="subtle"
              aria-label="进入专业工作台"
              onClick={() => dispatchArtifactAction('open-node')}
            >
              <IconLayoutBoard size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="下载">
            <ActionIcon
              component="a"
              href={projection.url}
              download
              target="_blank"
              rel="noreferrer"
              variant="subtle"
              aria-label="下载"
            >
              <IconDownload size={15} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>
      {onProductAction ? (
        <ArtifactPreview
          item={{
            title: projection.title,
            kind: projection.mediaType,
            url: projection.url,
            thumbnailUrl: projection.previewUrl,
            nodeId: projection.nodeId,
          }}
          opened={previewOpened}
          actions={['modify', 'reference', 'open-node']}
          onClose={() => setPreviewOpened(false)}
          onAction={(action) => dispatchArtifactAction(action)}
        />
      ) : (
        <Modal
          className="native-artifact-lightbox"
          opened={previewOpened}
          onClose={() => setPreviewOpened(false)}
          title={projection.title}
          centered
          size="min(94vw, 1120px)"
          zIndex={1000}
        >
          {projection.mediaType === 'video' ? (
            <video src={projection.url} poster={projection.previewUrl} controls autoPlay playsInline />
          ) : (
            <img src={projection.url} alt={projection.title} referrerPolicy="no-referrer" />
          )}
        </Modal>
      )}
    </article>
  )
}
