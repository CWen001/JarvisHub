import React from 'react'

type DraftItem = {
  sectionId?: unknown
  previewNodeId?: unknown
  order?: unknown
  html?: unknown
  css?: unknown
  usedAssetIds?: unknown
  usedAssetUrls?: unknown
  motionHooks?: unknown
  consistencyNotes?: unknown
  blocked?: unknown
}

type WebSectionDraftBoardPayload = {
  title?: unknown
  subtitle?: unknown
  drafts?: unknown
}

type WebSectionDraftBoardContentProps = {
  payload?: unknown
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => readText(item))
    .filter(Boolean)
}

function readDrafts(value: unknown): DraftItem[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

function clipCode(value: unknown, limit = 520): string {
  const text = readText(value)
  if (text.length <= limit) return text
  return `${text.slice(0, limit).trim()}…`
}

function readOrder(value: unknown, fallback: number): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  const text = readText(value)
  return text || String(fallback)
}

export function WebSectionDraftBoardContent({ payload }: WebSectionDraftBoardContentProps) {
  const data = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as WebSectionDraftBoardPayload
    : {}
  const drafts = readDrafts(data.drafts)
  const title = readText(data.title) || 'Section Drafts'
  const subtitle = readText(data.subtitle) || 'Merge 前的 screenshot-to-code 分区 HTML/CSS 草稿'

  return (
    <div className="tc-web-asset-board tc-web-section-draft-board">
      <div className="tc-web-asset-board__header">
        <div>
          <div className="tc-web-asset-board__kicker">SECTION DRAFTS</div>
          <div className="tc-web-asset-board__title">{title}</div>
        </div>
        <div className="tc-web-asset-board__subtitle">{subtitle}</div>
      </div>

      {drafts.length > 0 ? (
        <div className="tc-web-section-draft-board__grid">
          {drafts.map((draft, index) => {
            const sectionId = readText(draft.sectionId) || `section-${index + 1}`
            const previewNodeId = readText(draft.previewNodeId)
            const html = clipCode(draft.html)
            const css = clipCode(draft.css)
            const usedAssetIds = readStringList(draft.usedAssetIds)
            const usedAssetUrls = readStringList(draft.usedAssetUrls)
            const motionHooks = readStringList(draft.motionHooks)
            const consistencyNotes = readStringList(draft.consistencyNotes)
            const blocked = draft.blocked === true

            return (
              <section key={`${sectionId}-${previewNodeId}-${index}`} className="tc-web-asset-board__section tc-web-section-draft-board__section">
                <div className="tc-web-asset-board__section-head">
                  <span>{`${readOrder(draft.order, index + 1)} · ${sectionId}`}</span>
                  <small>{blocked ? 'blocked' : 'ready'}</small>
                </div>
                {previewNodeId ? (
                  <div className="tc-web-section-draft-board__meta">{previewNodeId}</div>
                ) : null}
                <div className="tc-web-section-draft-board__code-grid">
                  <div className="tc-web-section-draft-board__code-block">
                    <div className="tc-web-section-draft-board__code-label">HTML</div>
                    <pre>{html || '暂无 HTML 草稿'}</pre>
                  </div>
                  <div className="tc-web-section-draft-board__code-block">
                    <div className="tc-web-section-draft-board__code-label">CSS</div>
                    <pre>{css || '暂无 CSS 草稿'}</pre>
                  </div>
                </div>
                <div className="tc-web-section-draft-board__pill-row">
                  {usedAssetIds.map((item) => <div key={`asset-id-${sectionId}-${item}`} className="tc-web-asset-board__pill"><span>{item}</span></div>)}
                  {motionHooks.map((item) => <div key={`motion-${sectionId}-${item}`} className="tc-web-asset-board__pill"><strong>{item}</strong></div>)}
                </div>
                {usedAssetUrls.length > 0 ? (
                  <div className="tc-web-section-draft-board__urls">
                    {usedAssetUrls.map((item) => <div key={`asset-url-${sectionId}-${item}`} className="tc-web-section-draft-board__url" title={item}>{item}</div>)}
                  </div>
                ) : null}
                {consistencyNotes.length > 0 ? (
                  <div className="tc-web-section-draft-board__notes">
                    {consistencyNotes.map((item) => <div key={`note-${sectionId}-${item}`}>{item}</div>)}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      ) : (
        <div className="tc-web-asset-board__empty">
          还没有可展示的 section draft
        </div>
      )}
    </div>
  )
}
