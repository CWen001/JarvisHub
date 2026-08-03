import React from 'react'
import { ActionIcon, Button, ScrollArea, Text, Tooltip } from '@mantine/core'
import { IconChevronDown, IconChevronRight, IconMessage, IconMessagePlus } from '@tabler/icons-react'
import type { ProjectDto } from '../api/server'
import { readAiChatTabsState } from '../ui/chat/chatTabs'
import {
  dispatchNativeChatNavigation,
  NATIVE_CHAT_NAVIGATION_CHANGED,
} from './nativeChatNavigation'

export function ProductHistoryNavigation({
  projects,
  currentProjectId,
  onSelectProject,
}: {
  projects: readonly ProjectDto[]
  currentProjectId: string
  onSelectProject: (project: ProjectDto) => void
}): JSX.Element {
  const [expandedProjectIds, setExpandedProjectIds] = React.useState<Set<string>>(
    () => new Set(currentProjectId ? [currentProjectId] : []),
  )
  const [, refresh] = React.useReducer((value) => value + 1, 0)

  React.useEffect(() => {
    if (!currentProjectId) return
    setExpandedProjectIds((current) => {
      if (current.has(currentProjectId)) return current
      return new Set([...current, currentProjectId])
    })
  }, [currentProjectId])

  React.useEffect(() => {
    const onChanged = () => refresh()
    window.addEventListener(NATIVE_CHAT_NAVIGATION_CHANGED, onChanged)
    window.addEventListener('storage', onChanged)
    return () => {
      window.removeEventListener(NATIVE_CHAT_NAVIGATION_CHANGED, onChanged)
      window.removeEventListener('storage', onChanged)
    }
  }, [])

  return (
    <aside className="product-history-nav" aria-label="Project and conversation history">
      <div className="product-history-nav__heading">
        <div>
          <Text fw={700} size="sm">Projects</Text>
          <Text c="dimmed" size="xs">Native Jarvis history</Text>
        </div>
        {currentProjectId ? (
          <Tooltip label="New conversation">
            <ActionIcon
              variant="subtle"
              aria-label="New conversation"
              onClick={() => dispatchNativeChatNavigation({
                type: 'new-session',
                projectId: currentProjectId,
              })}
            >
              <IconMessagePlus size={17} />
            </ActionIcon>
          </Tooltip>
        ) : null}
      </div>
      <ScrollArea className="product-history-nav__scroll" type="auto">
        <div className="product-history-nav__projects">
          {projects.map((project) => {
            const expanded = expandedProjectIds.has(project.id)
            const current = project.id === currentProjectId
            const chatState = readAiChatTabsState(project.id)
            return (
              <section className="product-history-nav__project" key={project.id}>
                <div className={`product-history-nav__project-row${current ? ' is-current' : ''}`}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label={expanded ? 'Collapse project' : 'Expand project'}
                    onClick={() => setExpandedProjectIds((ids) => {
                      const next = new Set(ids)
                      if (next.has(project.id)) next.delete(project.id)
                      else next.add(project.id)
                      return next
                    })}
                  >
                    {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  </ActionIcon>
                  <Button
                    className="product-history-nav__project-button"
                    variant="subtle"
                    onClick={() => onSelectProject(project)}
                  >
                    {project.name}
                  </Button>
                </div>
                {expanded ? (
                  <div className="product-history-nav__sessions">
                    {[...chatState.tabs]
                      .sort((left, right) => right.updatedAt - left.updatedAt)
                      .map((session) => (
                        <button
                          type="button"
                          key={session.id}
                          className={`product-history-nav__session${current && chatState.activeTabId === session.id ? ' is-current' : ''}`}
                          onClick={() => {
                            if (!current) onSelectProject(project)
                            dispatchNativeChatNavigation({
                              type: 'select-session',
                              projectId: project.id,
                              sessionId: session.id,
                            })
                          }}
                        >
                          <IconMessage size={13} />
                          <span>{session.title}</span>
                        </button>
                      ))}
                    {current ? (
                      <button
                        type="button"
                        className="product-history-nav__session product-history-nav__session--new"
                        onClick={() => dispatchNativeChatNavigation({
                          type: 'new-session',
                          projectId: project.id,
                        })}
                      >
                        <IconMessagePlus size={13} />
                        <span>New conversation</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      </ScrollArea>
    </aside>
  )
}
