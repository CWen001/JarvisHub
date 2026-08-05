import React from 'react'
import { ActionIcon, Drawer, Tooltip } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import {
  IconLayoutBoard,
  IconMenu2,
  IconPhoto,
  IconX,
} from '@tabler/icons-react'
import type { AgentWorkspaceRuntime } from './agentWorkspaceRuntime'
import type { AgentWorkspaceIntent } from './agentWorkspaceProjection'
import { ProjectContextRail } from './ProjectContextRail'
import { ProductAssetPanel } from './ProductAssetPanel'
import { ProductChat } from './ProductChat'
import type { VerticalBrand } from './productHost'
import './agentWorkspace.css'

export type AgentWorkspaceProps = Readonly<{
  brand: VerticalBrand
  runtime: AgentWorkspaceRuntime
  railCollapsed: boolean
  onRailCollapsedChange: (collapsed: boolean) => void
}>

export function AgentWorkspace({
  brand,
  runtime,
  railCollapsed,
  onRailCollapsedChange,
}: AgentWorkspaceProps): JSX.Element {
  const [mobileRailOpened, setMobileRailOpened] = React.useState(false)
  const [assetPanelOpened, setAssetPanelOpened] = React.useState(false)
  const narrow = useMediaQuery('(max-width: 760px)') ?? false
  const view = React.useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)

  const onIntent = React.useCallback((intent: AgentWorkspaceIntent) => {
    void runtime.dispatch(intent)
  }, [runtime])

  const toggleRail = () => {
    if (narrow) setMobileRailOpened((opened) => !opened)
    else onRailCollapsedChange(!railCollapsed)
  }
  return (
    <div
      className="agent-workspace"
      data-rail-collapsed={railCollapsed}
    >
      <header className="product-host-header">
        <ActionIcon
          className="product-host-rail-toggle"
          variant="subtle"
          size={40}
          aria-label={narrow ? '打开项目栏' : (railCollapsed ? '展开项目栏' : '收起项目栏')}
          aria-hidden={narrow && mobileRailOpened ? true : undefined}
          tabIndex={narrow && mobileRailOpened ? -1 : undefined}
          onClick={toggleRail}
        >
          {narrow && mobileRailOpened ? <IconX size={20} /> : <IconMenu2 size={20} />}
        </ActionIcon>
        <div className="product-host-institution-lockup">
          <picture>
            <source media="(max-width: 760px)" srcSet="/product-host/hust-design-logo-wordmark-compact.png" />
            <img src="/product-host/hust-design-logo-wordmark.png" alt="华中科技大学设计学院" />
          </picture>
          <span aria-hidden="true" />
          <small>{brand.name}</small>
        </div>
        <div className="product-host-current-project">
          <span>当前项目</span>
          <strong>{view.current?.projectName || '尚未创建项目'}</strong>
        </div>
        <div className="product-host-header__actions">
          <Tooltip label="打开资产">
            <ActionIcon variant="subtle" size={40} aria-label="打开资产" onClick={() => setAssetPanelOpened(true)}>
              <IconPhoto size={19} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="进入专业工作台">
            <ActionIcon
              className="product-host-professional-action"
              variant="light"
              size={40}
              aria-label="进入专业工作台"
              onClick={() => onIntent({ type: 'open-professional-workspace' })}
            >
              <IconLayoutBoard size={19} />
            </ActionIcon>
          </Tooltip>
        </div>
      </header>

      <div className="agent-workspace__desktop-rail">
        <ProjectContextRail
          view={view}
          collapsed={railCollapsed}
          onIntent={onIntent}
          onOpenAssets={() => setAssetPanelOpened(true)}
        />
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
          <div className="agent-workspace-rail-drawer__content">
            <div className="agent-workspace-rail-drawer__header">
              <strong>项目导航</strong>
              <ActionIcon
                variant="subtle"
                size={44}
                aria-label="关闭项目栏"
                onClick={() => setMobileRailOpened(false)}
              >
                <IconX size={20} />
              </ActionIcon>
            </div>
            <ProjectContextRail
              view={view}
              onIntent={onIntent}
              onOpenAssets={() => setAssetPanelOpened(true)}
              onNavigate={() => setMobileRailOpened(false)}
            />
          </div>
        ) : null}
      </Drawer>

      <ProductChat view={view} onIntent={onIntent} />
      <ProductAssetPanel
        runtime={runtime}
        opened={assetPanelOpened}
        onClose={() => setAssetPanelOpened(false)}
      />
    </div>
  )
}
