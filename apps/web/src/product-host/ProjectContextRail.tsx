import React from 'react'
import { ActionIcon, Badge, Menu, ScrollArea, Tooltip } from '@mantine/core'
import {
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconHistory,
  IconMessage,
  IconMessagePlus,
  IconPhoto,
  IconPlus,
  IconRoute,
} from '@tabler/icons-react'
import type {
  AgentWorkspaceIntent,
  AgentWorkspaceViewModel,
} from './agentWorkspaceProjection'
import { ArtifactPreview, type ArtifactPreviewAction } from '../ui/shared/ArtifactPreview'

export function ProjectContextRail({
  view,
  collapsed = false,
  onIntent,
  onNavigate,
}: {
  view: AgentWorkspaceViewModel
  collapsed?: boolean
  onIntent: (intent: AgentWorkspaceIntent) => void
  onNavigate?: () => void
}): JSX.Element {
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(view.current?.projectId ? [view.current.projectId] : []),
  )
  const [previewOpened, setPreviewOpened] = React.useState(false)

  React.useEffect(() => {
    const projectId = view.current?.projectId
    if (!projectId) return
    setExpanded((current) => current.has(projectId) ? current : new Set([...current, projectId]))
  }, [view.current?.projectId])

  const dispatch = (intent: AgentWorkspaceIntent) => {
    onIntent(intent)
    onNavigate?.()
  }

  const onPreviewAction = (action: ArtifactPreviewAction) => {
    const artifact = view.assets.current
    if (!artifact) return
    if (action === 'modify') dispatch({ type: 'asset.modify', asset: artifact })
    if (action === 'reference') dispatch({ type: 'asset.reference', asset: artifact })
    if (action === 'open-node') dispatch({ type: 'open-professional-workspace', nodeId: artifact.nodeId })
  }

  return (
    <aside className="project-context-rail" data-collapsed={collapsed} aria-label="项目导航">
      <div className="project-context-rail__primary-actions">
        <Tooltip label="新对话" disabled={!collapsed} position="right">
          <button
            type="button"
            className="project-context-rail__primary-button"
            aria-label="新对话"
            disabled={!view.current?.projectId}
            onClick={() => view.current?.projectId && dispatch({ type: 'new-session', projectId: view.current.projectId })}
          >
            <IconMessagePlus size={18} />
            <span>新对话</span>
          </button>
        </Tooltip>
        <Menu position="bottom-start" withinPortal zIndex={900}>
          <Menu.Target>
            <ActionIcon variant="subtle" aria-label="更多新建选项" size={38}>
              <IconPlus size={18} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<IconRoute size={16} />}
              disabled={!view.current?.projectId}
              onClick={() => view.current?.projectId && dispatch({ type: 'new-flow', projectId: view.current.projectId })}
            >
              新设计方向
            </Menu.Item>
            <Menu.Item leftSection={<IconFolder size={16} />} onClick={() => dispatch({ type: 'new-project' })}>
              新项目
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>

      <ScrollArea className="project-context-rail__scroll" type="auto" scrollbarSize={6}>
        {view.current ? (
          <section className="project-context-rail__section project-context-rail__current">
            <span className="project-context-rail__eyebrow">当前项目</span>
            <strong>{view.current.projectName}</strong>
            {view.current.flowName ? (
              <div className="project-context-rail__context-line">
                <IconRoute size={15} />
                <span><small>设计方向</small>{view.current.flowName}</span>
              </div>
            ) : null}
            {view.current.sessionTitle ? (
              <div className="project-context-rail__context-line">
                <IconMessage size={15} />
                <span><small>对话</small>{view.current.sessionTitle}</span>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="project-context-rail__section project-context-rail__empty">
            <span className="project-context-rail__eyebrow">当前项目</span>
            <p>创建项目后，从一句设计意图开始。</p>
          </section>
        )}

        {view.assets.current ? (
          <section className="project-context-rail__section project-context-rail__artifact">
            <span className="project-context-rail__eyebrow">当前成果</span>
            <button
              type="button"
              className="project-context-rail__artifact-button"
              aria-label={`预览${view.assets.current.title}`}
              onClick={() => setPreviewOpened(true)}
            >
              {view.assets.current.kind === 'image' ? (
                <img src={view.assets.current.thumbnailUrl || view.assets.current.url} alt="" />
              ) : (
                <span className="project-context-rail__artifact-placeholder"><IconPhoto size={20} /></span>
              )}
              <span>{view.assets.current.title}</span>
            </button>
          </section>
        ) : null}

        <section className="project-context-rail__section project-context-rail__history">
          <div className="project-context-rail__section-heading">
            <span className="project-context-rail__eyebrow">项目与历史对话</span>
            <IconHistory size={15} />
          </div>
          <div className="project-context-rail__projects">
            {view.projects.map((project) => {
              const isExpanded = expanded.has(project.id)
              return (
                <div className="project-context-rail__project" key={project.id}>
                  <div className={`project-context-rail__project-row${project.current ? ' is-current' : ''}`}>
                    <ActionIcon
                      size={28}
                      variant="subtle"
                      aria-label={isExpanded ? '收起项目' : '展开项目'}
                      onClick={() => setExpanded((current) => {
                        const next = new Set(current)
                        if (next.has(project.id)) next.delete(project.id)
                        else next.add(project.id)
                        return next
                      })}
                    >
                      {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    </ActionIcon>
                    <button type="button" onClick={() => dispatch({ type: 'select-project', projectId: project.id })}>
                      {project.name}
                    </button>
                  </div>
                  {isExpanded ? (
                    <div className="project-context-rail__sessions">
                      {project.sessions.map((session) => (
                        <button
                          type="button"
                          className={session.current ? 'is-current' : ''}
                          key={session.id}
                          onClick={() => dispatch({ type: 'select-session', projectId: project.id, sessionId: session.id })}
                        >
                          <IconMessage size={13} />
                          <span>{session.title}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>
      </ScrollArea>

      <button
        type="button"
        className="project-context-rail__assets"
        aria-label={`资产，${view.assets.count} 项`}
        onClick={() => dispatch({ type: 'open-assets' })}
      >
        <IconPhoto size={18} />
        <span>资产</span>
        <Badge size="xs" variant="light" color="dark">{view.assets.count}</Badge>
      </button>
      <div className={`project-context-rail__status is-${view.run.status}`} role="status" aria-label={view.run.label}>
        <i aria-hidden="true" />
        <span>{view.run.label}</span>
      </div>
      <ArtifactPreview
        item={view.assets.current}
        opened={previewOpened}
        actions={['modify', 'reference', 'open-node']}
        onClose={() => setPreviewOpened(false)}
        onAction={onPreviewAction}
      />
    </aside>
  )
}
