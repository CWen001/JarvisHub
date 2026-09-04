import { useEffect, useState } from 'react'
import { IconArrowLeft, IconArrowUpRight, IconDownload, IconExternalLink, IconMaximize, IconX } from '@tabler/icons-react'
import { buildStudioUrl } from '../../utils/appRoutes'
import { batches, CASE_ASSET_ROOT, copy, phases, type CaseLanguage } from './indiaPhoneCaseData'
import './homePage.css'
import './indiaPhoneCase.css'

const statusCopy = {
  review: { zh: '定性评审', en: 'Qualitative review' },
  baseline: { zh: '量化基线', en: 'Scored baseline' },
  pass: { zh: '通过', en: 'Pass' },
  reject: { zh: '拒绝', en: 'Reject' },
} as const

function EvidenceFile({ url, label }: { url: string; label: string }): JSX.Element {
  const [content, setContent] = useState<string>()
  const [error, setError] = useState(false)

  async function load(open: boolean): Promise<void> {
    if (!open || content || error) return
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(String(response.status))
      setContent(await response.text())
    } catch {
      setError(true)
    }
  }

  return (
    <details className="india-case-file" onToggle={(event) => void load(event.currentTarget.open)}>
      <summary>{label}<IconExternalLink aria-hidden="true" /></summary>
      <div className="india-case-file__body">
        {error ? <p>Unable to load this file.</p> : content ? <pre>{content}</pre> : <p>Loading…</p>}
        <a href={url} download>Download <IconDownload aria-hidden="true" /></a>
      </div>
    </details>
  )
}

function ScoreChart({ language }: { language: CaseLanguage }): JSX.Element {
  const scored = batches.filter((batch): batch is typeof batch & { score: number } => typeof batch.score === 'number')
  const width = 960
  const height = 300
  const left = 48
  const right = 24
  const top = 28
  const bottom = 48
  const min = 55
  const max = 90
  const x = (index: number) => left + index * ((width - left - right) / (scored.length - 1))
  const y = (score: number) => top + (max - score) * ((height - top - bottom) / (max - min))
  const scorePoints = scored.map((batch, index) => `${x(index)},${y(batch.score)}`).join(' ')
  let best = 0
  const bestPoints = scored.map((batch, index) => {
    best = Math.max(best, batch.score)
    return `${x(index)},${y(best)}`
  }).join(' ')

  return (
    <div className="india-case-chart" role="img" aria-label={language === 'zh' ? 'Batch 06 至 16 的设计评分趋势' : 'Design-score trend from Batch 06 to 16'}>
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {[60, 70, 80, 90].map((score) => (
          <g key={score}>
            <line x1={left} x2={width - right} y1={y(score)} y2={y(score)} />
            <text x="8" y={y(score) + 5}>{score}</text>
          </g>
        ))}
        <polyline className="india-case-chart__best" points={bestPoints} />
        <polyline className="india-case-chart__score" points={scorePoints} />
        {scored.map((batch, index) => (
          <g key={batch.number}>
            <circle className={`is-${batch.status}`} cx={x(index)} cy={y(batch.score)} r="7" />
            <text className="india-case-chart__value" x={x(index)} y={y(batch.score) - 14}>{batch.score}</text>
            <text className="india-case-chart__batch" x={x(index)} y={height - 16}>{String(batch.number).padStart(2, '0')}</text>
          </g>
        ))}
      </svg>
      <div className="india-case-chart__legend">
        <span><i className="is-score" />{language === 'zh' ? '批次评分' : 'Batch score'}</span>
        <span><i className="is-best" />{language === 'zh' ? '当时最佳' : 'Best to date'}</span>
        <span><i className="is-reject" />{language === 'zh' ? 'Base Contract 拒绝' : 'Base Contract reject'}</span>
      </div>
    </div>
  )
}

export default function IndiaPhoneCasePage(): JSX.Element {
  const [language, setLanguage] = useState<CaseLanguage>('zh')
  const [openBoard, setOpenBoard] = useState<{ src: string; label: string }>()
  const studioUrl = buildStudioUrl()

  useEffect(() => {
    const previousTitle = document.title
    document.title = language === 'zh' ? '印度市场手机外观设计迭代｜HUST Design Studio' : 'India Phone Design Iteration | HUST Design Studio'
    return () => { document.title = previousTitle }
  }, [language])

  return (
    <main className="studio-landing india-case scheme-light">
      <header className="india-case-nav">
        <div className="studio-shell india-case-nav__inner">
          <a className="india-case-nav__home" href="/"><IconArrowLeft aria-hidden="true" />{language === 'zh' ? '返回首页' : 'Back home'}</a>
          <div className="india-case-nav__actions">
            <div className="india-case-language" aria-label="Language">
              <button className={language === 'zh' ? 'is-active' : ''} onClick={() => setLanguage('zh')}>中文</button>
              <button className={language === 'en' ? 'is-active' : ''} onClick={() => setLanguage('en')}>EN</button>
            </div>
            <a className="studio-button" href={studioUrl}>{language === 'zh' ? '开始设计' : 'Start designing'}<IconArrowUpRight aria-hidden="true" /></a>
          </div>
        </div>
      </header>

      <section className="india-case-hero">
        <div className="studio-shell">
          <p className="studio-eyebrow">DESIGN ITERATION CASE · 2026</p>
          <div className="india-case-hero__grid">
            <div>
              <h1>{language === 'zh' ? '印度市场手机外观设计迭代' : 'India-market smartphone exterior design iteration'}</h1>
              <p className="india-case-hero__lead">{language === 'zh'
                ? '通过 19 个 Learning Batches、76 个设计方向，建立从文化研究、Prompt Engineering 到可见图像评价的设计工程方法。'
                : 'Nineteen Learning Batches and 76 design directions build a traceable method from cultural research and Prompt Engineering to visible-image evaluation.'}</p>
              <p className="india-case-hero__note">{language === 'zh'
                ? '评分来自固定 Rubric 下的内部工程评价，用于保持跨批次判断一致性，不代表消费者研究或市场验证。'
                : 'Scores are internal engineering evaluations under a fixed rubric. They maintain cross-batch consistency and are not consumer research or market validation.'}</p>
              <dl className="india-case-stats">
                <div><dt>19</dt><dd>Learning Batches</dd></div>
                <div><dt>76</dt><dd>Design Directions</dd></div>
                <div><dt>1</dt><dd>Fixed Evaluation Rubric</dd></div>
              </dl>
            </div>
            <button className="india-case-hero__board" onClick={() => setOpenBoard({ src: `${CASE_ASSET_ROOT}/15/comparison-board.jpg`, label: 'Batch 15 Comparison Board' })}>
              <img src={`${CASE_ASSET_ROOT}/15/comparison-board.jpg`} alt="Batch 15 阿育王法轮（Ashoka Chakra）Comparison Board" />
              <span><IconMaximize aria-hidden="true" />Batch 15 · {language === 'zh' ? '最终最佳' : 'Final best'} · 87</span>
            </button>
          </div>
        </div>
      </section>

      <section className="india-case-score-section" aria-labelledby="score-title">
        <div className="studio-shell">
          <div className="india-case-section-heading">
            <p className="studio-eyebrow">EVALUATION</p>
            <h2 id="score-title">{language === 'zh' ? '设计质量的迭代变化' : 'Design quality across iterations'}</h2>
            <p>{language === 'zh'
              ? '前五批使用定性评审；固定量化 Rubric 从 Batch 06 基线开始。59 分表示 Base Contract 门禁封顶，并非四张图的视觉平均分。'
              : 'The first five batches used qualitative review; fixed quantitative scoring begins with the Batch 06 baseline. A score of 59 is a Base Contract cap, not a visual average of four images.'}</p>
          </div>
          <ScoreChart language={language} />
        </div>
      </section>

      <nav className="india-case-phase-nav" aria-label={language === 'zh' ? '案例阶段' : 'Case phases'}>
        <div className="studio-shell">
          {phases.map((phase) => <a key={phase.number} href={`#phase-${phase.number}`}><span>0{phase.number}</span>{copy(phase.title, language)}</a>)}
        </div>
      </nav>

      {phases.map((phase) => (
        <section className="india-case-phase" id={`phase-${phase.number}`} key={phase.number}>
          <div className="studio-shell">
            <header className="india-case-phase__header">
              <p className="studio-eyebrow">PHASE 0{phase.number} · BATCH {phase.range}</p>
              <h2>{copy(phase.title, language)}</h2>
              <p>{copy(phase.description, language)}</p>
            </header>

            <div className="india-case-batches">
              {batches.filter((batch) => batch.phase === phase.number).map((batch) => {
                const number = String(batch.number).padStart(2, '0')
                const displayNumber = batch.displayNumber ?? number
                const root = `${CASE_ASSET_ROOT}/${number}`
                const boardLabel = `${batch.displayNumber ? displayNumber : `Batch ${number}`} · ${copy(batch.title, language)}`
                return (
                  <article className={`india-case-batch is-${batch.status}`} id={`batch-${number}`} key={batch.number}>
                    <header className="india-case-batch__header">
                      <div>
                        <p className="studio-eyebrow">{batch.displayNumber ?? `LEARNING BATCH ${number}`}</p>
                        <h3>{copy(batch.title, language)}</h3>
                        <p className="india-case-intent">{language === 'zh' ? '文化意向' : 'Cultural intent'} · {copy(batch.intent, language)}</p>
                      </div>
                      <div className="india-case-batch__result">
                        <span>{copy(statusCopy[batch.status], language)}</span>
                        {batch.score && <strong>{batch.score}</strong>}
                      </div>
                    </header>

                    <div className="india-case-batch__grid">
                      <button className="india-case-board" onClick={() => setOpenBoard({ src: `${root}/comparison-board.jpg`, label: boardLabel })}>
                        <img src={`${root}/comparison-board.jpg`} alt={`${boardLabel} Comparison Board`} loading="lazy" />
                        <span><IconMaximize aria-hidden="true" />{language === 'zh' ? '查看 Comparison Board' : 'View Comparison Board'}</span>
                      </button>

                      <div className="india-case-batch__story">
                        <section><h4>{language === 'zh' ? '探索问题' : 'Exploration question'}</h4><p>{copy(batch.question, language)}</p></section>
                        <section><h4>{language === 'zh' ? '评价结论' : 'Evaluation verdict'}</h4><p>{copy(batch.verdict, language)}</p></section>
                        <section><h4>{language === 'zh' ? '本轮学习' : 'Learning'}</h4><p>{copy(batch.learning, language)}</p></section>
                        <section className="india-case-next"><h4>{language === 'zh' ? '推动下一轮' : 'Carried forward'}</h4><p>{copy(batch.next, language)}</p></section>
                        {batch.note && <p className="india-case-note">{copy(batch.note, language)}</p>}
                      </div>
                    </div>

                    <div className="india-case-strategies" aria-label={language === 'zh' ? '四个策略' : 'Four strategies'}>
                      {batch.strategies.map((strategy, index) => <span key={strategy.en}><b>{index + 1}</b>{copy(strategy, language)}</span>)}
                    </div>

                    <details className="india-case-evidence">
                      <summary>{language === 'zh' ? '查看 Prompt、Schema 与完整 Evaluation' : 'View Prompts, Schema and full Evaluation'}</summary>
                      <div className="india-case-evidence__grid">
                        <section>
                          <h4>Prompts</h4>
                          {batch.promptFiles.map((file) => <EvidenceFile key={file} label={file} url={`${root}/${file}`} />)}
                        </section>
                        <section>
                          <h4>Schema</h4>
                          {batch.schemaFiles.length > 0
                            ? batch.schemaFiles.map((file) => <EvidenceFile key={file} label={file} url={`${root}/${file}`} />)
                            : <p className="india-case-note">{language === 'zh' ? '该早期批次没有独立保存 Schema 快照。' : 'No standalone Schema snapshot was preserved for this early batch.'}</p>}
                        </section>
                        <section>
                          <h4>{language === 'zh' ? '批次记录与评价' : 'Batch record and evaluation'}</h4>
                          <EvidenceFile label="batch.md" url={`${root}/batch.md`} />
                          <EvidenceFile label="evaluation.json" url={`${root}/evaluation.json`} />
                        </section>
                      </div>
                    </details>
                  </article>
                )
              })}
            </div>
          </div>
        </section>
      ))}

      <footer className="india-case-footer">
        <div className="studio-shell">
          <div className="india-case-footer__actions"><a className="studio-text-link" href="/"><IconArrowLeft aria-hidden="true" />{language === 'zh' ? '返回首页' : 'Back home'}</a><a className="studio-button" href={studioUrl}>{language === 'zh' ? '开始设计' : 'Start designing'}<IconArrowUpRight aria-hidden="true" /></a></div>
        </div>
      </footer>

      {openBoard && (
        <div className="india-case-lightbox" role="dialog" aria-modal="true" aria-label={openBoard.label} onClick={() => setOpenBoard(undefined)}>
          <div className="india-case-lightbox__inner" onClick={(event) => event.stopPropagation()}>
            <div><span>{openBoard.label}</span><a href={openBoard.src} download><IconDownload aria-hidden="true" />{language === 'zh' ? '下载高清图' : 'Download'}</a><button aria-label={language === 'zh' ? '关闭' : 'Close'} onClick={() => setOpenBoard(undefined)}><IconX aria-hidden="true" /></button></div>
            <img src={openBoard.src} alt={openBoard.label} />
          </div>
        </div>
      )}
    </main>
  )
}
