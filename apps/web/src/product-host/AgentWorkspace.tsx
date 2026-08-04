import React from 'react'
import { ActionIcon, Drawer, Tooltip } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import {
  IconLayoutBoard,
  IconMenu2,
  IconPhoto,
  IconX,
} from '@tabler/icons-react'
import type { ProjectDto } from '../api/server'
import { ProductChatTimeline } from '../ui/chat/AiChatDialog'
import { dispatchNativeChatNavigation } from './nativeChatNavigation'
import { useAuthoritativeAgentWorkspaceViewModel } from './agentWorkspaceAdapter'
import {
  resolveAgentWorkspaceIntent,
  type AgentWorkspaceIntent,
} from './agentWorkspaceProjection'
import { ProjectContextRail } from './ProjectContextRail'
import type { VerticalBrand } from './productHost'
import './agentWorkspace.css'

export type AgentWorkspaceProps = Readonly<{
  brand: VerticalBrand
  projects: readonly ProjectDto[]
  currentProject: Readonly<{ id?: string | null; name: string }> | null
  currentFlow: Readonly<{ id?: string | null; name?: string | null; updatedAt?: string | null }> | null
  onSelectProject: (project: ProjectDto) => void
  onCreateProject: () => void
  onCreateFlow: (projectId: string) => void | Promise<void>
  onOpenAssets: () => void
  onOpenProfessionalWorkspace: (nodeId?: string) => void
}>

export function AgentWorkspace({
  brand,
  projects,
  currentProject,
  currentFlow,
  onSelectProject,
  onCreateProject,
  onCreateFlow,
  onOpenAssets,
  onOpenProfessionalWorkspace,
}: AgentWorkspaceProps): JSX.Element {
  const [railCollapsed, setRailCollapsed] = React.useState(false)
  const [mobileRailOpened, setMobileRailOpened] = React.useState(false)
  const narrow = useMediaQuery('(max-width: 760px)') ?? false
  const view = useAuthoritativeAgentWorkspaceViewModel({ projects, currentProject, currentFlow })

  const onIntent = React.useCallback((intent: AgentWorkspaceIntent) => {
    const command = resolveAgentWorkspaceIntent(intent)
    if (command.type === 'project.select') {
      const project = projects.find((candidate) => candidate.id === command.projectId)
      if (project) onSelectProject(project)
      return
    }
    if (command.type === 'chat.navigate') {
      const project = projects.find((candidate) => candidate.id === command.command.projectId)
      if (project && project.id !== view.current?.projectId) onSelectProject(project)
      dispatchNativeChatNavigation(command.command)
      return
    }
    if (command.type === 'flow.create') {
      void onCreateFlow(command.projectId)
      return
    }
    if (command.type === 'project.create') {
      onCreateProject()
      return
    }
    if (command.type === 'assets.open') {
      onOpenAssets()
      return
    }
    onOpenProfessionalWorkspace(command.nodeId)
  }, [onCreateFlow, onCreateProject, onOpenAssets, onOpenProfessionalWorkspace, onSelectProject, projects, view.current?.projectId])

  const toggleRail = () => {
    if (narrow) setMobileRailOpened((opened) => !opened)
    else setRailCollapsed((collapsed) => !collapsed)
  }
  const currentArtifactNodeId = view.assets.current?.nodeId

  return (
    <div
      className="agent-workspace"
      data-rail-collapsed={railCollapsed}
      style={{ '--product-brand-accent': brand.accentColor } as React.CSSProperties}
    >
      <header className="product-host-header">
        <ActionIcon
          className="product-host-rail-toggle"
          variant="subtle"
          size={40}
          aria-label={narrow ? (mobileRailOpened ? '关闭项目栏' : '打开项目栏') : (railCollapsed ? '展开项目栏' : '收起项目栏')}
          onClick={toggleRail}
        >
          {narrow && mobileRailOpened ? <IconX size={20} /> : <IconMenu2 size={20} />}
        </ActionIcon>
        <div className="product-host-academy-lockup">
          <img src="/product-host/hust-design-logo.png" alt="设计学院 d.school HUST" />
          <span aria-hidden="true" />
          <div className="product-host-brand-copy">
            <strong>{brand.name}</strong>
            <small>专业智能手表设计工作台</small>
          </div>
        </div>
        <div className="product-host-current-project">
          <span>当前项目</span>
          <strong>{view.current?.projectName || '尚未创建项目'}</strong>
        </div>
        <div className="product-host-header__actions">
          <Tooltip label="打开资产">
            <ActionIcon variant="subtle" size={40} aria-label="打开资产" onClick={onOpenAssets}>
              <IconPhoto size={19} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="进入专业工作台">
            <ActionIcon
              className="product-host-professional-action"
              variant="light"
              size={40}
              aria-label="进入专业工作台"
              onClick={() => onOpenProfessionalWorkspace(currentArtifactNodeId)}
            >
              <IconLayoutBoard size={19} />
            </ActionIcon>
          </Tooltip>
        </div>
      </header>

      <div className="agent-workspace__desktop-rail">
        <ProjectContextRail view={view} collapsed={railCollapsed} onIntent={onIntent} />
      </div>

      <Drawer
        className="agent-workspace-rail-drawer"
        opened={mobileRailOpened}
        onClose={() => setMobileRailOpened(false)}
        position="left"
        size="min(88vw, 340px)"
        zIndex={800}
        withCloseButton={false}
        overlayProps={{ backgroundOpacity: 0.18, blur: 1 }}
      >
        {mobileRailOpened ? (
          <ProjectContextRail view={view} onIntent={onIntent} onNavigate={() => setMobileRailOpened(false)} />
        ) : null}
      </Drawer>

      <main className="agent-workspace__timeline" aria-label="设计时间线">
        <ProductChatTimeline className="app-ai-chat-dialog" />
      </main>
    </div>
  )
}
