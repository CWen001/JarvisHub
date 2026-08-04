import React from 'react'
import { ActionIcon, Group, Modal, Tooltip } from '@mantine/core'
import {
  IconDownload,
  IconLayoutBoard,
  IconPaperclip,
  IconPencil,
  IconPlus,
} from '@tabler/icons-react'

export type ArtifactPreviewItem = Readonly<{
  title: string
  kind: 'image' | 'video'
  url: string
  thumbnailUrl?: string
  nodeId?: string
}>

export type ArtifactPreviewAction = 'modify' | 'reference' | 'add-to-workspace' | 'open-node'

const actionPresentation: Readonly<Record<ArtifactPreviewAction, Readonly<{
  label: string
  icon: typeof IconPencil
}>>> = Object.freeze({
  modify: { label: '继续修改', icon: IconPencil },
  reference: { label: '作为参考', icon: IconPaperclip },
  'add-to-workspace': { label: '添加到专业工作台', icon: IconPlus },
  'open-node': { label: '在专业工作台打开此节点', icon: IconLayoutBoard },
})

export function ArtifactPreview({
  item,
  opened,
  actions,
  onClose,
  onAction,
}: Readonly<{
  item: ArtifactPreviewItem | null
  opened: boolean
  actions: readonly ArtifactPreviewAction[]
  onClose: () => void
  onAction: (action: ArtifactPreviewAction, item: ArtifactPreviewItem) => void
}>): JSX.Element {
  return (
    <Modal
      className="artifact-preview"
      opened={opened && Boolean(item)}
      onClose={onClose}
      title={item?.title || '成果预览'}
      centered
      size="min(94vw, 1120px)"
      zIndex={1000}
    >
      {item ? (
        <div className="artifact-preview__content">
          {item.kind === 'video' ? (
            <video src={item.url} poster={item.thumbnailUrl} controls autoPlay playsInline />
          ) : (
            <img src={item.url} alt={item.title} referrerPolicy="no-referrer" />
          )}
          <Group className="artifact-preview__actions" gap={4} wrap="nowrap" aria-label="成果操作">
            {actions.map((action) => {
              if (action === 'open-node' && !item.nodeId) return null
              const presentation = actionPresentation[action]
              const Icon = presentation.icon
              return (
                <Tooltip label={presentation.label} key={action}>
                  <ActionIcon
                    variant="subtle"
                    size={40}
                    aria-label={presentation.label}
                    onClick={() => onAction(action, item)}
                  >
                    <Icon size={18} />
                  </ActionIcon>
                </Tooltip>
              )
            })}
            <Tooltip label="下载">
              <ActionIcon
                component="a"
                href={item.url}
                download
                target="_blank"
                rel="noreferrer"
                variant="subtle"
                size={40}
                aria-label="下载"
              >
                <IconDownload size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </div>
      ) : null}
    </Modal>
  )
}
