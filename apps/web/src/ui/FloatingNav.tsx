import React from 'react'
import { ActionIcon, Badge, Stack, Tooltip, useMantineColorScheme } from '@mantine/core'
import { IconPlus, IconFolders, IconMovie, IconSettings, IconBrain, IconHistory } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { PanelCard } from './PanelCard'
import { $ } from '../canvas/i18n'
import { spaNavigate } from '../utils/spaNavigate'
import { isMemoryEnabled } from './memory/MemoryPanel'

type FloatingNavItemProps = {
  label: string
  icon: React.ReactNode
  onHover?: (y: number) => void
  onClick?: () => void
  badge?: string
  tooltipLabel?: string
  active?: boolean
  activeStyle?: React.CSSProperties
}

const FloatingNavItem = React.memo(function FloatingNavItem({
  label,
  icon,
  onHover,
  onClick,
  badge,
  tooltipLabel,
  active = false,
  activeStyle,
}: FloatingNavItemProps): JSX.Element {
  return (
    <div
      className="floating-nav-item-wrap"
      style={{ position: 'relative' }}
      data-ux-floating
      onMouseEnter={(e) => {
        if (!onHover) return
        const rect = e.currentTarget.getBoundingClientRect()
        onHover(rect.top + rect.height / 2)
      }}
    >
      <Tooltip
        className="floating-nav-item-tooltip"
        label={tooltipLabel}
        position="right"
        withArrow
        disabled={!tooltipLabel}
      >
        <ActionIcon
          className="floating-nav-item"
          variant="subtle"
          size={28}
          radius="md"
          aria-label={label}
          onClick={onClick}
          style={active ? activeStyle : undefined}
        >
          {icon}
        </ActionIcon>
      </Tooltip>
      {badge ? (
        <Badge
          className="floating-nav-item-badge"
          color="gray"
          size="xs"
          variant="light"
          style={{ position: 'absolute', top: -6, right: -6, borderRadius: 999 }}
        >
          {badge}
        </Badge>
      ) : null}
    </div>
  )
})

export default function FloatingNav({ className }: { className?: string }): JSX.Element {
  const activePanel = useUIStore((state) => state.activePanel)
  const setActivePanel = useUIStore((state) => state.setActivePanel)
  const setPanelAnchorY = useUIStore((state) => state.setPanelAnchorY)
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme !== 'light'
  const activeItemBackground = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17, 24, 39, 0.06)'
  const activeItemColor = isDark ? '#f4f4f5' : '#0f172a'
  const activeItemBorder = isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(17,24,39,0.14)'
  const activeItemShadow = isDark ? 'inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 18px rgba(0,0,0,0.28)' : '0 10px 18px rgba(15,23,42,0.14)'
  const activeItemStyle = React.useMemo<React.CSSProperties>(() => ({
    background: activeItemBackground,
    color: activeItemColor,
    border: activeItemBorder,
    boxShadow: activeItemShadow,
  }), [activeItemBackground, activeItemBorder, activeItemShadow])

  // Removed presence ping heartbeat: Cloudflare Workers does not need keep-alive and this endpoint isn't used elsewhere.

  const navClassName = ['floating-nav', className].filter(Boolean).join(' ')

  return (
    <div className={navClassName} style={{ position: 'fixed', left: 16, top: '50%', transform: 'translateY(-50%)', zIndex: 300 }} data-ux-floating data-tour="floating-nav">
      <PanelCard className="floating-nav-card" padding="compact" data-ux-floating>
        <Stack className="floating-nav-stack" align="center" gap={6}>
          <Tooltip className="floating-nav-add-tooltip" label={$('添加节点')} position="right" withArrow>
            <ActionIcon
              className="floating-nav-add"
              size={42}
              radius={999}
              aria-label={$('添加节点')}
              title={$('添加节点')}
              variant="subtle"
              data-active={activePanel === 'add' ? 'true' : 'false'}
              onMouseEnter={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setPanelAnchorY(r.top + r.height/2);
                setActivePanel('add')
              }}
              onClick={() => setActivePanel(activePanel === 'add' ? null : 'add')}
              data-ux-floating
              data-tour="add-button">
              <IconPlus className="floating-nav-add-icon" size={22} stroke={2.2} />
            </ActionIcon>
          </Tooltip>
          <div className="floating-nav-divider" />
          <FloatingNavItem
            label={$('项目')}
            icon={<IconFolders className="floating-nav-item-icon" size={18} />}
            tooltipLabel="项目管理"
            onHover={() => { setActivePanel(null) }}
            onClick={() => { setActivePanel(null); spaNavigate('/projects') }}
            active={false}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label={$('资产')}
            icon={<IconMovie className="floating-nav-item-icon" size={18} />}
            tooltipLabel="我的资产"
            onHover={(y) => { setPanelAnchorY(y); setActivePanel('gallery') }}
            onClick={() => { setActivePanel(activePanel === 'gallery' ? null : 'gallery') }}
            active={activePanel === 'gallery'}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label={$('历史记录')}
            icon={<IconHistory className="floating-nav-item-icon" size={18} />}
            onHover={(y) => { setPanelAnchorY(y); setActivePanel('history') }}
            active={activePanel === 'history'}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label="Memory"
            icon={<IconBrain className="floating-nav-item-icon" size={18} style={!isMemoryEnabled() ? { opacity: 0.4 } : undefined} />}
            tooltipLabel="Project Memory"
            onHover={(y) => { setPanelAnchorY(y); setActivePanel('memory') }}
            onClick={() => setActivePanel(activePanel === 'memory' ? null : 'memory')}
            active={activePanel === 'memory'}
            activeStyle={activeItemStyle}
          />
          <div className="floating-nav-divider floating-nav-divider--bottom" />
          <FloatingNavItem
            label="模型配置"
            icon={<IconSettings className="floating-nav-item-icon" size={18} />}
            tooltipLabel="模型配置"
            onClick={() => setActivePanel(activePanel === 'models' ? null : 'models')}
            active={activePanel === 'models'}
            activeStyle={activeItemStyle}
          />
        </Stack>
      </PanelCard>
    </div>
  )
}
