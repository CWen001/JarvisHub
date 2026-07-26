import React from 'react'
import { MarkdownContent } from '../../../../ui/MarkdownContent'
import { PanelCard } from '../../../../ui/PanelCard'

export type TextContentProps = {
  selected: boolean
  isEditing: boolean
  markdownText: string
  draftText: string
  isWebAssetBoardItem?: boolean
  assetBoardAccentColor?: string
  assetBoardSectionLabel?: string
  label?: string
  textBackgroundTint: string
  textColor: string
  textFontSize: number
  textFontWeight: React.CSSProperties['fontWeight']
  contentRef: React.MutableRefObject<HTMLElement | null>
  onStartEditing: () => void
  onDraftChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}

const SCROLL_EPSILON = 1

const canScrollVertically = (element: HTMLElement, deltaY: number): boolean => {
  if (Math.abs(deltaY) < SCROLL_EPSILON) return false
  const maxScrollTop = element.scrollHeight - element.clientHeight
  if (maxScrollTop <= SCROLL_EPSILON) return false
  if (deltaY < 0) return element.scrollTop > SCROLL_EPSILON
  return element.scrollTop < maxScrollTop - SCROLL_EPSILON
}

export function TextContent({
  selected,
  isEditing,
  markdownText,
  draftText,
  isWebAssetBoardItem = false,
  assetBoardAccentColor,
  assetBoardSectionLabel,
  label,
  textBackgroundTint,
  textColor,
  textFontSize,
  textFontWeight,
  contentRef,
  onStartEditing,
  onDraftChange,
  onCommit,
  onCancel,
}: TextContentProps) {
  const composingRef = React.useRef(false)
  const handleWheelCapture: React.WheelEventHandler<HTMLElement> = (event) => {
    const content = contentRef.current
    if (!content || event.ctrlKey || event.metaKey) return
    if (!canScrollVertically(content, event.deltaY)) return
    event.stopPropagation()
  }
  const contentStyle: React.CSSProperties = {
    color: textColor,
    fontSize: textFontSize,
    fontWeight: textFontWeight,
  }
  const setContentRef = (element: HTMLElement | null) => {
    contentRef.current = element
  }
  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (composingRef.current || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      onCommit()
    }
  }
  const body = isEditing ? (
    <textarea
      ref={setContentRef}
      className="tc-task-node__text-source nodrag nopan"
      value={draftText}
      autoFocus
      spellCheck={false}
      onChange={(event) => onDraftChange(event.currentTarget.value)}
      onKeyDown={handleKeyDown}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={() => { composingRef.current = false }}
      onBlur={onCommit}
      onWheelCapture={handleWheelCapture}
      style={contentStyle}
    />
  ) : (
    <div
      ref={setContentRef}
      className={`tc-task-node__text-preview${selected ? ' nodrag nopan' : ''}`}
      onDoubleClick={onStartEditing}
      onWheelCapture={handleWheelCapture}
      onPointerDownCapture={(event) => {
        if (selected) return
        event.preventDefault()
      }}
      style={contentStyle}
    >
      <MarkdownContent markdownText={markdownText} variant="canvas" />
    </div>
  )
  const panelStyle: React.CSSProperties = {
    width: '100%',
    background: textBackgroundTint,
    display: 'flex',
    flex: 1,
    minHeight: 0,
  }

  if (isWebAssetBoardItem) {
    const accent = assetBoardAccentColor || '#339CFF'
    return (
      <PanelCard
        className="tc-task-node__text-editor-panel tc-task-node__asset-board-card"
        padding="compact"
        style={{
          ...panelStyle,
          background: 'var(--web-asset-board-card-bg)',
          borderColor: 'var(--web-asset-board-card-border)',
          boxShadow: 'var(--web-asset-board-card-shadow)',
        }}
        onWheelCapture={handleWheelCapture}
      >
        <div className="tc-task-node__asset-board-card-inner" style={{ ['--asset-board-accent' as string]: accent }}>
          <div className="tc-task-node__asset-board-card-topline">
            <span className="tc-task-node__asset-board-card-dot" aria-hidden="true" />
            <span className="tc-task-node__asset-board-card-section">{assetBoardSectionLabel || 'Asset'}</span>
          </div>
          <div className="tc-task-node__asset-board-card-title" title={label}>
            {label || '资产决策'}
          </div>
          <div className="tc-task-node__asset-board-card-body">{body}</div>
        </div>
      </PanelCard>
    )
  }

  return (
    <PanelCard
      className="tc-task-node__text-editor-panel"
      padding="compact"
      style={panelStyle}
      onWheelCapture={handleWheelCapture}
    >
      {body}
    </PanelCard>
  )
}
