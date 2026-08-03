import React from 'react'
import { ActionIcon, Badge, Group, Text, Tooltip } from '@mantine/core'
import { IconDownload, IconLayoutBoard, IconPaperclip, IconPencil } from '@tabler/icons-react'
import { useRFStore } from '../../canvas/store'
import { dispatchProductWorkspaceCommand } from '../../product-host/productWorkspace'
import {
  resolveNativeArtifactProjection,
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

export function NativeArtifactCard({ asset }: { asset: NativeArtifactSource }): JSX.Element {
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

  return (
    <article className="native-artifact-card">
      <a
        className="native-artifact-card__preview"
        href={projection.url}
        target="_blank"
        rel="noreferrer"
      >
        {projection.mediaType === 'video' ? (
          <video src={projection.url} poster={projection.previewUrl} muted playsInline preload="metadata" />
        ) : (
          <img src={projection.previewUrl} alt={projection.title} loading="lazy" referrerPolicy="no-referrer" />
        )}
      </a>
      <div className="native-artifact-card__body">
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Text className="native-artifact-card__title" fw={650} size="sm" lineClamp={1}>
            {projection.title}
          </Text>
          <Badge size="xs" variant="light" color={statusColor}>
            {projection.status}
          </Badge>
        </Group>
        <Group className="native-artifact-card__actions" gap={4} mt={8} wrap="nowrap">
          <Tooltip label="Continue modifying">
            <ActionIcon
              variant="subtle"
              aria-label="Continue modifying"
              onClick={() => dispatchNativeArtifactChatCommand({ type: 'modify', asset })}
            >
              <IconPencil size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Use as reference">
            <ActionIcon
              variant="subtle"
              aria-label="Use as reference"
              onClick={() => dispatchNativeArtifactChatCommand({ type: 'reference', asset })}
            >
              <IconPaperclip size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="View in Canvas">
            <ActionIcon
              variant="subtle"
              aria-label="View in Canvas"
              onClick={() => dispatchProductWorkspaceCommand({
                type: 'open-canvas',
                nodeId: projection.nodeId,
              })}
            >
              <IconLayoutBoard size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Download">
            <ActionIcon
              component="a"
              href={projection.url}
              download
              target="_blank"
              rel="noreferrer"
              variant="subtle"
              aria-label="Download"
            >
              <IconDownload size={15} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>
    </article>
  )
}
