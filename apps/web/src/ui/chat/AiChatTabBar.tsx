import React from 'react'
import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import { IconHistory, IconMessagePlus, IconX } from '@tabler/icons-react'
import { $ } from '../../canvas/i18n'
import type { AiChatTabRecord } from './chatTabs'

type AiChatTabBarProps = {
  tabs: AiChatTabRecord[]
  activeTabId: string
  sendingTabId: string | null
  floatingZIndex: number
  onSelectTab: (tabId: string) => void
  onAddTab: () => void
  onCloseTab: (tabId: string) => void
}

type HistoryMenuTargetProps = React.ComponentPropsWithoutRef<typeof ActionIcon> & {
  className?: string
  floatingZIndex: number
  tooltip: string
}

const HistoryMenuTarget = React.forwardRef<HTMLButtonElement, HistoryMenuTargetProps>(function HistoryMenuTarget(
  { className, floatingZIndex, tooltip, ...props },
  ref,
): JSX.Element {
  return (
    <Tooltip className="tc-ai-chat-tabs__tooltip" label={tooltip} withArrow zIndex={floatingZIndex}>
      <ActionIcon
        ref={ref}
        className={['tc-ai-chat-tabs__action', className].filter(Boolean).join(' ')}
        variant="subtle"
        aria-label={tooltip}
        size={30}
        {...props}
      >
        <IconHistory className="tc-ai-chat-tabs__action-icon" size={16} />
      </ActionIcon>
    </Tooltip>
  )
})

export default function AiChatTabBar({
  tabs,
  activeTabId,
  sendingTabId,
  floatingZIndex,
  onSelectTab,
  onAddTab,
  onCloseTab,
}: AiChatTabBarProps): JSX.Element {
  const canCloseTabs = tabs.length > 1

  return (
    <div className="tc-ai-chat-tabs" role="tablist" aria-label={$('AI 对话标签')}>
      <div className="tc-ai-chat-tabs__track">
        {tabs.map((tab) => {
          const selected = tab.id === activeTabId
          const running = tab.id === sendingTabId
          return (
            <div
              key={tab.id}
              className={[
                'tc-ai-chat-tabs__item',
                selected ? 'tc-ai-chat-tabs__item--active' : '',
                running ? 'tc-ai-chat-tabs__item--running' : '',
              ].filter(Boolean).join(' ')}
              role="presentation"
            >
              <button
                type="button"
                className="tc-ai-chat-tabs__select"
                role="tab"
                aria-selected={selected}
                aria-label={tab.title}
                onClick={() => onSelectTab(tab.id)}
              >
                <span className="tc-ai-chat-tabs__title">{tab.title}</span>
                {running ? <span className="tc-ai-chat-tabs__status" aria-hidden="true" /> : null}
              </button>
              <Tooltip className="tc-ai-chat-tabs__tooltip" label={canCloseTabs ? $('关闭标签') : $('至少保留一个标签')} withArrow zIndex={floatingZIndex}>
                <ActionIcon
                  className="tc-ai-chat-tabs__close"
                  variant="subtle"
                  size={24}
                  aria-label={$('关闭标签')}
                  disabled={!canCloseTabs}
                  onClick={(event) => {
                    event.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                >
                  <IconX className="tc-ai-chat-tabs__close-icon" size={13} />
                </ActionIcon>
              </Tooltip>
            </div>
          )
        })}
      </div>

      <div className="tc-ai-chat-tabs__actions">
        <Menu className="tc-ai-chat-tabs__history-menu" position="bottom-end" withinPortal zIndex={floatingZIndex}>
          <Menu.Target>
            <HistoryMenuTarget floatingZIndex={floatingZIndex} tooltip={$('本地标签')} />
          </Menu.Target>
          <Menu.Dropdown className="tc-ai-chat-tabs__history-dropdown">
            <Menu.Label className="tc-ai-chat-tabs__history-label">{$('本地标签')}</Menu.Label>
            {tabs.map((tab) => (
              <Menu.Item
                key={tab.id}
                className="tc-ai-chat-tabs__history-item"
                onClick={() => onSelectTab(tab.id)}
              >
                <span className="tc-ai-chat-tabs__history-title">
                  {tab.id === activeTabId ? `✓ ${tab.title}` : tab.title}
                </span>
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
        <Tooltip className="tc-ai-chat-tabs__tooltip" label={$('开启新对话')} withArrow zIndex={floatingZIndex}>
          <ActionIcon className="tc-ai-chat-tabs__action" variant="subtle" aria-label={$('开启新对话')} size={30} onClick={onAddTab}>
            <IconMessagePlus className="tc-ai-chat-tabs__action-icon" size={17} />
          </ActionIcon>
        </Tooltip>
      </div>
    </div>
  )
}
