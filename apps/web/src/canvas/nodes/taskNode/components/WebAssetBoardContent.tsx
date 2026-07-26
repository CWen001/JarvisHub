import React from 'react'

type BoardItem = {
  title?: unknown
  body?: unknown
  imageUrl?: unknown
  url?: unknown
}

type WebAssetBoardPayload = {
  title?: unknown
  subtitle?: unknown
  icons?: unknown
  searchAssets?: unknown
  generatedAssets?: unknown
  fontPlan?: unknown
  stylePlan?: unknown
}

type WebAssetBoardContentProps = {
  payload?: unknown
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readItems(value: unknown): BoardItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      title: item.title,
      body: item.body,
      imageUrl: item.imageUrl,
      url: item.url,
    }))
}

function hasImage(item: BoardItem): boolean {
  return Boolean(readText(item.imageUrl))
}

function AssetThumb({ item }: { item: BoardItem }) {
  const imageUrl = readText(item.imageUrl)
  const title = readText(item.title) || '网页素材'
  const body = readText(item.body)
  return (
    <div className="tc-web-asset-board__thumb-card">
      <div className="tc-web-asset-board__thumb">
        <img src={imageUrl} alt={title} loading="lazy" />
      </div>
      <div className="tc-web-asset-board__thumb-meta">
        <div className="tc-web-asset-board__item-title" title={title}>{title}</div>
        {body ? <div className="tc-web-asset-board__item-body" title={body}>{body}</div> : null}
      </div>
    </div>
  )
}

function TextPill({ item }: { item: BoardItem }) {
  const title = readText(item.title) || '字体'
  const body = readText(item.body)
  return (
    <div className="tc-web-asset-board__pill">
      <span>{title}</span>
      {body ? <strong title={body}>{body}</strong> : null}
    </div>
  )
}

function BoardSection({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  if (count <= 0) return null
  return (
    <section className="tc-web-asset-board__section">
      <div className="tc-web-asset-board__section-head">
        <span>{title}</span>
        <small>{count}</small>
      </div>
      {children}
    </section>
  )
}

export function WebAssetBoardContent({ payload }: WebAssetBoardContentProps) {
  const data = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as WebAssetBoardPayload
    : {}
  const icons = readItems(data.icons)
  const searchAssets = readItems(data.searchAssets).filter(hasImage)
  const generatedAssets = readItems(data.generatedAssets).filter(hasImage)
  const fontPlan = readItems(data.fontPlan)
  const stylePlan = readItems(data.stylePlan)
  const title = readText(data.title) || '网页资产规划'
  const subtitle = readText(data.subtitle) || '已解析并可追踪到最终网页的视觉资产'
  const visibleSectionCount = [
    icons.length,
    searchAssets.length,
    generatedAssets.length,
    fontPlan.length,
    stylePlan.length,
  ].filter((count) => count > 0).length

  return (
    <div className="tc-web-asset-board">
      <div className="tc-web-asset-board__header">
        <div>
          <div className="tc-web-asset-board__kicker">WEB ASSET PLAN</div>
          <div className="tc-web-asset-board__title">{title}</div>
        </div>
        <div className="tc-web-asset-board__subtitle">{subtitle}</div>
      </div>

      {visibleSectionCount > 0 ? (
        <div className="tc-web-asset-board__grid">
          <BoardSection title="图标决策" count={icons.length}>
            <div className="tc-web-asset-board__pill-grid">
              {icons.map((item, index) => <TextPill key={`${readText(item.title)}-${index}`} item={item} />)}
            </div>
          </BoardSection>

          <BoardSection title="搜索复用资产" count={searchAssets.length}>
            <div className="tc-web-asset-board__thumb-grid">
              {searchAssets.map((item, index) => <AssetThumb key={`${readText(item.imageUrl)}-${index}`} item={item} />)}
            </div>
          </BoardSection>

          <BoardSection title="生成资产" count={generatedAssets.length}>
            <div className="tc-web-asset-board__thumb-grid tc-web-asset-board__thumb-grid--generated">
              {generatedAssets.map((item, index) => <AssetThumb key={`${readText(item.imageUrl)}-${index}`} item={item} />)}
            </div>
          </BoardSection>

          <BoardSection title="字体规划" count={fontPlan.length}>
            <div className="tc-web-asset-board__pill-grid">
              {fontPlan.map((item, index) => <TextPill key={`${readText(item.title)}-${index}`} item={item} />)}
            </div>
          </BoardSection>

          <BoardSection title="风格规划" count={stylePlan.length}>
            <div className="tc-web-asset-board__pill-grid">
              {stylePlan.map((item, index) => <TextPill key={`${readText(item.title)}-${index}`} item={item} />)}
            </div>
          </BoardSection>
        </div>
      ) : (
        <div className="tc-web-asset-board__empty">
          还没有可展示的网页资产记录
        </div>
      )}
    </div>
  )
}
