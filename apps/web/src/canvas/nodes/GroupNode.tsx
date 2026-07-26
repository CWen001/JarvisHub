import React from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { NodeResizeControl } from '@xyflow/react'
import { IconEdit, IconGripVertical } from '@tabler/icons-react'
import { useRFStore, setGroupResizeIntent, isShiftHeld } from '../store'

const GROUP_MIN_WIDTH = 160
const GROUP_MIN_HEIGHT = 90
const GROUP_RESIZE_PADDING = 8

type GroupNodeData = {
  label?: string
  groupKind?: string
  boardTitle?: string
  boardSubtitle?: string
  manualSize?: boolean
  visualStyle?: {
    accent?: string
  }
}

type GroupCanvasNode = Node<GroupNodeData, 'groupNode'>

export default function GroupNode({ id, data, selected, dragging }: NodeProps<GroupCanvasNode>): JSX.Element {
  const label = String(data?.label || '组').trim() || '组'
  const groupKind = String(data?.groupKind || '').trim()
  const isWebAssetBoard = groupKind === 'webPageAssetBoard'
  const isWebAssetBoardSection = [
    'webPageIconAssets',
    'webPageSearchedAssets',
    'webPageGeneratedAssets',
    'webPageFontPlan',
  ].includes(groupKind)
  const accentColor = String(data?.visualStyle?.accent || (isWebAssetBoard ? '#007aff' : '#64748b'))
  const borderColor = selected ? 'var(--canvas-group-border-selected)' : 'var(--canvas-group-border)'
  const effectiveBorderColor = isWebAssetBoard || isWebAssetBoardSection ? accentColor : borderColor
  const renameGroup = useRFStore((s) => s.renameGroup)
  const updateNodeData = useRFStore((s) => s.updateNodeData)
  const [editing, setEditing] = React.useState(false)
  const [draftLabel, setDraftLabel] = React.useState(label)

  // Compute the minimum size that still encloses all direct children + padding.
  // Subscribed to nodes so it updates as children move/resize.
  const childrenMin = useRFStore(React.useCallback((s: { nodes: Node[] }) => {
    let maxRight = 0
    let maxBottom = 0
    for (const n of s.nodes) {
      const parentId = (n as { parentId?: string | null }).parentId
      if (parentId !== id) continue
      const measured = (n as { measured?: { width?: number; height?: number } }).measured
      const styleSize = (n.style ?? {}) as { width?: number | string; height?: number | string }
      const w =
        (typeof measured?.width === 'number' && Number.isFinite(measured.width) ? measured.width : 0) ||
        (typeof n.width === 'number' && Number.isFinite(n.width) ? n.width : 0) ||
        (typeof styleSize.width === 'number' && Number.isFinite(styleSize.width) ? styleSize.width : 0)
      const h =
        (typeof measured?.height === 'number' && Number.isFinite(measured.height) ? measured.height : 0) ||
        (typeof n.height === 'number' && Number.isFinite(n.height) ? n.height : 0) ||
        (typeof styleSize.height === 'number' && Number.isFinite(styleSize.height) ? styleSize.height : 0)
      const x = n.position?.x ?? 0
      const y = n.position?.y ?? 0
      if (w > 0) maxRight = Math.max(maxRight, x + w)
      if (h > 0) maxBottom = Math.max(maxBottom, y + h)
    }
    return {
      width: Math.max(GROUP_MIN_WIDTH, maxRight + GROUP_RESIZE_PADDING),
      height: Math.max(GROUP_MIN_HEIGHT, maxBottom + GROUP_RESIZE_PADDING),
    }
  }, [id]))

  const handleResizeStart = React.useCallback(
    (event: { sourceEvent?: { shiftKey?: boolean } } | undefined) => {
      const fromEvent = event?.sourceEvent?.shiftKey === true
      const intent = fromEvent || isShiftHeld() ? 'scale' : 'frame'
      setGroupResizeIntent(intent)
    },
    [],
  )

  const handleResizeEnd = React.useCallback(() => {
    setGroupResizeIntent('idle')
    if (data?.manualSize !== true) {
      updateNodeData(id, { manualSize: true })
    }
  }, [data?.manualSize, id, updateNodeData])

  React.useEffect(() => {
    if (!editing) setDraftLabel(label)
  }, [editing, label])

  const submitRename = React.useCallback(() => {
    const next = draftLabel.trim()
    if (next && next !== label) {
      renameGroup(id, next)
    }
    setEditing(false)
  }, [draftLabel, id, label, renameGroup])

  return (
    <div
      className={[
        'tc-group-node',
        isWebAssetBoard ? 'tc-group-node--web-asset-board' : '',
        isWebAssetBoardSection ? 'tc-group-node--web-asset-section' : '',
      ].filter(Boolean).join(' ')}
      style={{ width: '100%', height: '100%' }}
    >
      <div
        className="tc-group-node__shell"
        style={{
          width: '100%',
          height: '100%',
          border: isWebAssetBoard || isWebAssetBoardSection
            ? `1px solid ${effectiveBorderColor}66`
            : `1.5px dashed ${effectiveBorderColor}`,
          borderRadius: isWebAssetBoard ? 22 : isWebAssetBoardSection ? 18 : 12,
          background: isWebAssetBoard
            ? 'var(--web-asset-board-bg)'
            : isWebAssetBoardSection
              ? 'var(--web-asset-board-section-bg)'
              : 'var(--canvas-group-bg)',
          boxShadow: isWebAssetBoard
            ? 'var(--web-asset-board-shadow)'
            : isWebAssetBoardSection
              ? 'var(--web-asset-board-section-shadow)'
              : selected ? 'var(--canvas-group-shadow-selected)' : 'var(--canvas-group-shadow)',
          boxSizing: 'border-box',
          position: 'relative',
          transition: 'border-color 120ms ease, box-shadow 120ms ease, background 120ms ease',
          pointerEvents: 'auto',
          overflow: 'visible',
        }}
        >
        {isWebAssetBoard && (
          <div className="tc-group-node__asset-board-header">
            <div className="tc-group-node__asset-board-kicker">WEB ASSET FLOW</div>
            <div className="tc-group-node__asset-board-title">
              {String(data?.boardTitle || label)}
            </div>
            <div className="tc-group-node__asset-board-subtitle">
              {String(data?.boardSubtitle || '资产来源、失败降级与生成决策集中展示')}
            </div>
          </div>
        )}
        <div
          className="tc-group-node__drag-handle"
          style={{
            position: 'absolute',
            left: isWebAssetBoardSection ? 12 : 0,
            top: isWebAssetBoard ? -30 : isWebAssetBoardSection ? 10 : -26,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            lineHeight: '18px',
            fontWeight: isWebAssetBoardSection ? 800 : 600,
            color: isWebAssetBoard || isWebAssetBoardSection ? 'var(--web-asset-board-title-color)' : 'var(--canvas-node-subtext)',
            userSelect: 'none',
            pointerEvents: 'auto',
            cursor: dragging ? 'grabbing' : 'grab',
            maxWidth: 'calc(100% - 8px)',
            zIndex: 5,
            padding: isWebAssetBoardSection ? '3px 10px' : '2px 8px',
            borderRadius: 999,
            border: isWebAssetBoard || isWebAssetBoardSection
              ? `1px solid ${effectiveBorderColor}66`
              : `1px solid ${selected ? 'var(--canvas-group-border-selected)' : 'var(--canvas-group-border)'}`,
            background: isWebAssetBoard || isWebAssetBoardSection
              ? 'var(--web-asset-board-chip-bg)'
              : 'var(--canvas-group-bg)',
            boxShadow: selected || isWebAssetBoardSection ? '0 6px 16px rgba(15, 23, 42, 0.14)' : 'none',
            overflow: 'hidden',
          }}
          title="拖这里移动组"
        >
          <IconGripVertical size={13} stroke={2} style={{ flex: '0 0 auto', opacity: 0.72 }} />
          {editing ? (
            <input
              className="tc-group-node__title-input nodrag nopan"
              value={draftLabel}
              autoFocus
              onChange={(e) => setDraftLabel(e.currentTarget.value)}
              onBlur={submitRename}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitRename()
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setDraftLabel(label)
                  setEditing(false)
                }
              }}
              style={{
                width: '100%',
                minWidth: 96,
                fontSize: 12,
                lineHeight: '18px',
                height: 18,
                fontWeight: 600,
                color: 'var(--canvas-node-subtext)',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                padding: 0,
                margin: 0,
              }}
            />
          ) : (
            <div
              className="tc-group-node__title-text"
              style={{
                minWidth: 0,
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
              }}
            >
              {label}
            </div>
          )}
          {!editing && (
            <button
              className="tc-group-node__title-edit nodrag nopan"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setEditing(true)
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                padding: 0,
                marginLeft: 2,
                border: 'none',
                borderRadius: 999,
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                flex: '0 0 auto',
              }}
              title="编辑组名"
            >
              <IconEdit size={12} stroke={2} />
            </button>
          )}
        </div>

        {selected && !dragging && (
          <NodeResizeControl
            className="tc-group-node__resize-control nodrag"
            position="bottom-right"
            minWidth={childrenMin.width}
            minHeight={childrenMin.height}
            onResizeStart={handleResizeStart}
            onResizeEnd={handleResizeEnd}
          >
            <div className="tc-group-node__resize-handle" />
          </NodeResizeControl>
        )}
      </div>
    </div>
  )
}
