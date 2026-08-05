import React from 'react'
import { ActionIcon, Textarea, Tooltip } from '@mantine/core'
import { IconPaperclip, IconSend2, IconX } from '@tabler/icons-react'
import { MarkdownContent } from '../ui/MarkdownContent'
import type {
  AgentWorkspaceIntent,
  AgentWorkspaceTimelineAsset,
  AgentWorkspaceTimelineEntryFact,
} from './agentWorkspaceProjection'
import type { AgentWorkspaceRuntimeSnapshot } from './agentWorkspaceRuntime'

const runStatusLabel = {
  running: '进行中',
  succeeded: '已完成',
  failed: '需要处理',
  partial: '部分完成',
} as const

const todoStatusLabel = {
  pending: '排队中',
  in_progress: '进行中',
  waiting: '等待输入',
  blocked: '需要处理',
  completed: '已完成',
} as const

function ProductExecutionRow({ view }: { view: AgentWorkspaceRuntimeSnapshot }): JSX.Element | null {
  const run = view.run
  const active = run.status === 'running'
  const keepDetailVisible = active || run.status === 'failed' || run.status === 'partial'
  const [now, setNow] = React.useState(Date.now())
  const [expanded, setExpanded] = React.useState(keepDetailVisible)
  React.useEffect(() => {
    setExpanded(keepDetailVisible)
  }, [keepDetailVisible, run.id, run.status])
  React.useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [active])
  if (run.status === 'idle') return null
  const elapsed = run.startedAt ? Math.max(0, Math.floor((now - run.startedAt) / 1000)) : null
  const items = run.todoItems ?? []
  const completedCount = items.filter((item) => item.status === 'completed').length
  const statusLabel = runStatusLabel[run.status]
  return (
    <section className={`product-execution-row is-${run.status}`} role="status" aria-label={run.label}>
      <button type="button" className="product-execution-row__summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span className="product-execution-row__pulse" aria-hidden="true" />
        <strong>{run.label}</strong>
        <span className="product-execution-row__summary-status">{statusLabel}</span>
        {items.length ? <span className="product-execution-row__count">{completedCount}/{items.length}</span> : null}
        {elapsed !== null ? <time>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</time> : null}
      </button>
      {expanded ? (
        <div className="product-execution-row__details">
          <div className="product-execution-row__main-item">
            <span>当前任务</span>
            <strong>{run.goal || run.label}</strong>
            <small>{statusLabel}</small>
          </div>
          {items.length ? (
            <>
              <div className="product-execution-row__progress">
                <progress aria-label="任务进度" max={items.length} value={completedCount} />
                <span>{completedCount}/{items.length} 项完成</span>
              </div>
              <ul className="product-execution-row__items">
                {items.map((item, index) => (
                  <li key={`${item.content}:${index}`} data-status={item.status}>
                    <span>{item.content}</span>
                    <small>{todoStatusLabel[item.status]}</small>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="product-execution-row__coarse-activity">{run.label}</p>}
        </div>
      ) : null}
    </section>
  )
}

function ProductArtifact({
  asset,
  onIntent,
}: {
  asset: AgentWorkspaceTimelineAsset
  onIntent: (intent: AgentWorkspaceIntent) => void
}): JSX.Element | null {
  if (!asset.nodeId || (!asset.assetId && !asset.assetRefId)) return null
  const projected = {
    nodeId: asset.nodeId,
    title: asset.title,
    kind: asset.kind,
    url: asset.url,
    ...(asset.thumbnailUrl ? { thumbnailUrl: asset.thumbnailUrl } : {}),
    ...(asset.assetId ? { assetId: asset.assetId } : {}),
    ...(asset.assetRefId ? { assetRefId: asset.assetRefId } : {}),
    scope: 'canvas' as const,
  }
  return (
    <article className="product-artifact-card">
      {asset.kind === 'video'
        ? <video src={asset.url} poster={asset.thumbnailUrl} controls playsInline />
        : <img src={asset.thumbnailUrl || asset.url} alt={asset.title} loading="lazy" referrerPolicy="no-referrer" />}
      <div className="product-artifact-card__body">
        <strong>{asset.title}</strong>
        <div>
          <button type="button" onClick={() => onIntent({ type: 'asset.modify', asset: projected })}>继续修改</button>
          <button type="button" onClick={() => onIntent({ type: 'asset.reference', asset: projected })}>作为参考</button>
          <button type="button" onClick={() => onIntent({ type: 'open-professional-workspace', nodeId: asset.nodeId })}>专业工作台</button>
          <a href={asset.url} download target="_blank" rel="noreferrer">下载</a>
        </div>
      </div>
    </article>
  )
}

function ProductDecision({
  entry,
  onIntent,
}: {
  entry: AgentWorkspaceTimelineEntryFact
  onIntent: (intent: AgentWorkspaceIntent) => void
}): JSX.Element | null {
  const decision = entry.decision
  const [expanded, setExpanded] = React.useState(false)
  if (!decision) return null
  return (
    <section className="product-decision-card" aria-label="设计决策">
      <header><span>设计决策</span><strong>{decision.awaitingReply ? '等待你的选择' : '已确认'}</strong></header>
      <div className={expanded ? 'product-decision-card__content is-expanded' : 'product-decision-card__content'}>
        <MarkdownContent markdownText={decision.question} variant="chat" />
      </div>
      <button type="button" className="product-decision-card__expand" onClick={() => setExpanded((value) => !value)}>
        {expanded ? '收起详细内容' : '展开全部'}
      </button>
      {decision.awaitingReply ? (
        <div className="product-decision-card__actions" role="group" aria-label="设计决策选项">
          {decision.options.map((option) => (
            <button key={option} type="button" onClick={() => onIntent({ type: 'decision.answer', option })}>
              <MarkdownContent markdownText={option} variant="chat" />
            </button>
          ))}
        </div>
      ) : decision.selectedOption ? <p>你的选择：{decision.selectedOption}</p> : null}
    </section>
  )
}

function ProductTimelineEntry({
  entry,
  onIntent,
}: {
  entry: AgentWorkspaceTimelineEntryFact
  onIntent: (intent: AgentWorkspaceIntent) => void
}): JSX.Element | null {
  const user = entry.role === 'user'
  if (!user && entry.phase === 'thinking' && !entry.content && !entry.decision && !entry.assets?.length) return null
  return (
    <article className={`product-timeline-entry product-timeline-entry--${user ? 'user' : 'assistant'}`} data-entry-kind={entry.decision ? 'decision' : entry.result || 'message'}>
      <header className="product-timeline-entry__meta"><strong>{user ? '你' : '设计顾问'}</strong><time>{entry.timestamp}</time></header>
      <ProductDecision entry={entry} onIntent={onIntent} />
      {!entry.decision && entry.content ? (
        <div className="product-timeline-entry__content">
          {user ? <p>{entry.content}</p> : <MarkdownContent markdownText={entry.content} variant="chat" />}
        </div>
      ) : null}
      {entry.result === 'partial' ? <div className="product-timeline-entry__notice">结果已生成；部分后续步骤未完成。</div> : null}
      {entry.result === 'error' ? <div className="product-timeline-entry__notice is-failed">本轮未能完成，请查看说明后重试。</div> : null}
      {entry.assets?.length ? <div className="product-timeline-entry__artifacts">{entry.assets.map((asset, index) => <ProductArtifact key={`${entry.id}:${asset.nodeId || index}`} asset={asset} onIntent={onIntent} />)}</div> : null}
    </article>
  )
}

export function ProductChat({
  view,
  onIntent,
}: {
  view: AgentWorkspaceRuntimeSnapshot
  onIntent: (intent: AgentWorkspaceIntent) => void
}): JSX.Element {
  const fileInput = React.useRef<HTMLInputElement | null>(null)
  const viewport = React.useRef<HTMLDivElement | null>(null)
  const nearBottom = React.useRef(true)
  const composingDraft = React.useRef(false)
  const pendingDraft = React.useRef<string | null>(null)
  const lastDispatchedDraft = React.useRef(view.composer.draft)
  const sessionIdentity = `${view.current?.projectId || ''}:${view.current?.sessionId || ''}`
  const previousSessionIdentity = React.useRef(sessionIdentity)
  const [draftBuffer, setDraftBuffer] = React.useState(view.composer.draft)

  React.useEffect(() => {
    if (previousSessionIdentity.current !== sessionIdentity) {
      previousSessionIdentity.current = sessionIdentity
      composingDraft.current = false
      pendingDraft.current = null
      lastDispatchedDraft.current = view.composer.draft
      setDraftBuffer(view.composer.draft)
      return
    }
    if (composingDraft.current) return
    if (pendingDraft.current !== null) {
      if (view.composer.draft !== pendingDraft.current) return
      pendingDraft.current = null
    }
    lastDispatchedDraft.current = view.composer.draft
    setDraftBuffer(view.composer.draft)
  }, [sessionIdentity, view.composer.draft])

  const updateDraft = (text: string) => {
    setDraftBuffer(text)
    pendingDraft.current = text
    if (lastDispatchedDraft.current === text) return
    lastDispatchedDraft.current = text
    onIntent({ type: 'chat.set-draft', text })
  }

  React.useEffect(() => {
    if (!nearBottom.current) return
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight
  }, [view.revision, view.timeline.length])

  const attach = (files: FileList | readonly File[] | null) => {
    const items = files ? Array.from(files).filter((file) => file.type.startsWith('image/')) : []
    if (items.length) onIntent({ type: 'chat.attach-files', files: items })
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    <main className="agent-workspace__timeline" aria-label="设计时间线">
      <input ref={fileInput} className="product-chat-surface__file-input" type="file" accept="image/*" multiple onChange={(event) => attach(event.currentTarget.files)} />
      <div
        ref={viewport}
        className="product-chat-surface__scroll"
        onScroll={(event) => {
          const element = event.currentTarget
          nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
        }}
        onPaste={(event) => attach(event.clipboardData?.files)}
        onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
        onDrop={(event) => { event.preventDefault(); attach(event.dataTransfer.files) }}
      >
        <div className="product-timeline">
          {view.composer.errorMessage ? <div className="product-timeline__state is-error">{view.composer.errorMessage}</div> : null}
          {!view.timeline.length ? <div className="product-timeline__empty"><strong>从一句设计意图开始</strong><span>描述产品、场景、用户或希望探索的设计方向。</span></div> : null}
          {view.timeline.map((entry) => (
            <React.Fragment key={entry.id}>
              {entry.role === 'assistant' && entry.phase === 'thinking' ? <ProductExecutionRow view={view} /> : null}
              <ProductTimelineEntry entry={entry} onIntent={onIntent} />
            </React.Fragment>
          ))}
          {!view.timeline.some((entry) => entry.role === 'assistant' && entry.phase === 'thinking') ? <ProductExecutionRow view={view} /> : null}
        </div>
      </div>
      <div className="product-composer-shell">
        {view.composer.pendingReferences.length ? (
          <div className="product-reference-strip" aria-label="待发送参考图">
            {view.composer.pendingReferences.map((reference) => (
              <div key={reference.url} className="product-reference-strip__item">
                {reference.kind === 'video' ? <video src={reference.url} muted /> : <img src={reference.thumbnailUrl || reference.url} alt={reference.label} />}
                <span>{reference.label}</span>
                <button type="button" aria-label={`移除${reference.label}`} onClick={() => onIntent({ type: 'chat.remove-reference', url: reference.url })}><IconX size={14} /></button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="product-composer">
          <div className="product-composer__tools">
            <Tooltip label="添加参考图"><ActionIcon variant="subtle" size={44} aria-label="添加参考图" onClick={() => fileInput.current?.click()}><IconPaperclip size={20} /></ActionIcon></Tooltip>
            <select
              className="product-composer__skill"
              aria-label="选择技能"
              value={view.composer.selectedSkill?.id || ''}
              onChange={(event) => {
                const skill = view.composer.availableSkills?.find((item) => item.id === event.currentTarget.value) ?? null
                onIntent({ type: 'chat.select-skill', skill })
              }}
            >
              <option value="">自动</option>
              {view.composer.availableSkills?.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
            </select>
          </div>
          <div className="product-composer__input">
            <Textarea
              autosize minRows={1} maxRows={6}
              placeholder={view.composer.ready ? '请输入你的设计需求' : '正在准备对话能力…'}
              value={draftBuffer}
              disabled={!view.composer.ready}
              onCompositionStart={() => { composingDraft.current = true }}
              onCompositionEnd={(event) => {
                composingDraft.current = false
                updateDraft(event.currentTarget.value)
              }}
              onChange={(event) => updateDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  if (view.composer.sending) onIntent({ type: 'chat.interrupt' })
                  else if (draftBuffer.trim() || view.composer.pendingReferences.length) onIntent({ type: 'chat.submit' })
                }
              }}
            />
          </div>
          <Tooltip label={view.composer.sending ? '中断' : '发送'}>
            <ActionIcon
              className="product-composer__send" variant="filled" aria-label={view.composer.sending ? '中断' : '发送'}
              disabled={!view.composer.sending && (!view.composer.ready || (!draftBuffer.trim() && !view.composer.pendingReferences.length))}
              onClick={() => onIntent({ type: view.composer.sending ? 'chat.interrupt' : 'chat.submit' })}
            >{view.composer.sending ? <IconX size={20} /> : <IconSend2 size={20} />}</ActionIcon>
          </Tooltip>
        </div>
      </div>
    </main>
  )
}
