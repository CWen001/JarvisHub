import React from 'react'
import { Button, Drawer, Group } from '@mantine/core'
import { IconLayoutBoard, IconPhoto } from '@tabler/icons-react'
import type { ProjectDto } from '../api/server'
import AiChatDialog from '../ui/chat/AiChatDialog'
import { ProductHistoryNavigation } from './ProductHistoryNavigation'
import type { VerticalBrand } from './productHost'

export type AgentWorkspaceProps = Readonly<{
  brand: VerticalBrand
  projects: readonly ProjectDto[]
  currentProject: Readonly<{ id?: string | null; name: string }> | null
  onSelectProject: (project: ProjectDto) => void
  onOpenAssets: () => void
  onOpenProfessionalWorkspace: () => void
}>

export function AgentWorkspace({
  brand,
  projects,
  currentProject,
  onSelectProject,
  onOpenAssets,
  onOpenProfessionalWorkspace,
}: AgentWorkspaceProps): JSX.Element {
  const [historyOpened, setHistoryOpened] = React.useState(false)

  return (
    <div className="agent-workspace" style={{ '--product-brand-accent': brand.accentColor } as React.CSSProperties}>
      <header className="product-host-header">
        <div className="product-host-brand-mark" aria-hidden="true">{brand.mark}</div>
        <button
          type="button"
          className="product-host-brand-copy product-host-project-trigger"
          aria-label="Open project and conversation history"
          aria-expanded={historyOpened}
          onClick={() => setHistoryOpened(true)}
        >
          <strong>{brand.name}</strong>
          <span>{currentProject?.name || 'Create your first project'}</span>
        </button>
        <Group className="product-host-header__actions" gap="xs">
          <Button
            variant="subtle"
            leftSection={<IconPhoto size={16} />}
            onClick={onOpenAssets}
          >
            Assets
          </Button>
          <Button
            variant="light"
            leftSection={<IconLayoutBoard size={16} />}
            onClick={onOpenProfessionalWorkspace}
          >
            Professional Workspace
          </Button>
        </Group>
      </header>

      <Drawer
        className="agent-workspace-history-drawer"
        opened={historyOpened}
        onClose={() => setHistoryOpened(false)}
        position="left"
        size={320}
        title="Project history"
        overlayProps={{ backgroundOpacity: 0.22, blur: 1 }}
      >
        <ProductHistoryNavigation
          projects={projects}
          currentProjectId={String(currentProject?.id || '')}
          onSelectProject={(project) => {
            onSelectProject(project)
            setHistoryOpened(false)
          }}
          onNavigate={() => setHistoryOpened(false)}
        />
      </Drawer>

      <AiChatDialog className="app-ai-chat-dialog" surface="agent-workspace" />
    </div>
  )
}
