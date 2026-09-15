// THROWAWAY: three presentation structures on /?variant=A|B|C; no backend or persistence.
import { useEffect, useState } from 'react'
import { IconArrowLeft, IconArrowRight, IconArrowUpRight, IconX, IconMaximize } from '@tabler/icons-react'
import { CASE_ASSET_ROOT } from './indiaPhoneCaseData'
import './homePage.css'
import './landingPrototype.css'

type Variant = 'A' | 'B' | 'C'
type View = 'home' | 'india' | 'watch' | 'workbench'
const variants: Variant[] = ['A', 'B', 'C']
const names = { A: '研究报告式', B: '演示导览式', C: '视觉案例集式' }
const viewNames = { home: '首页', india: '印度手机', watch: '智能手表', workbench: '进入工作台' }
const image = (name: string) => `/product-host/landing/prototype/${name}.jpg`
const url = (variant: Variant, view: View = 'home', hash = '') => `/?variant=${variant}&view=${view}${hash}`

function Brand({ variant }: { variant: Variant }) {
  return <a className="studio-brand-lockup" href={url(variant)} aria-label="回到首页">
    <img className="studio-brand-lockup__institution" src="/product-host/hust-design-logo.png" alt="华中科技大学设计学院" />
    <span className="studio-brand-lockup__project"><img src="/product-host/landing/brand/wowsa-logo-black.png" alt="WOWSA" /><img src="/product-host/landing/brand/service-design-engineering-center-logo-black.svg" alt="服务设计工程中心" /></span>
  </a>
}
function Header({ variant, view }: { variant: Variant; view: View }) {
  return <header className="proto-header"><Brand variant={variant} /><nav aria-label="主导航">
    <a className={view === 'india' ? 'active' : ''} href={url(variant, 'india')}>印度手机</a>
    <a className={view === 'watch' ? 'active' : ''} href={url(variant, 'watch')}>智能手表</a>
    <a className="studio-button" href={url(variant, 'workbench')}>进入工作台 <IconArrowUpRight size={17} /></a>
  </nav></header>
}
function Link({ variant, view, children }: { variant: Variant; view: View; children: React.ReactNode }) {
  return <a className="proto-link" href={url(variant, view)}>{children}<IconArrowUpRight size={20} /></a>
}
function CaseTiles({ variant }: { variant: Variant }) {
  return <div className="proto-case-tiles">
    <a href={url(variant, 'india')} className="proto-case-tile"><img src={image('phone-hero')} alt="玄银承脊手机正背概念图" /><div><span>01 / 手机设计</span><h3>理解印度，<br />再定义设计方向。</h3><p>市场研究 → 基础水准提升 → 独立主题试验</p><b>进入印度案例 <IconArrowUpRight size={19} /></b></div></a>
    <a href={url(variant, 'watch')} className="proto-case-tile"><img src={image('watch-hero')} alt="印度丛林八角智能手表" /><div><span>02 / 手表设计</span><h3>从佩戴尺度，<br />到完整系列。</h3><p>设计判断 → 场景验证 → 系列应用</p><b>进入手表案例 <IconArrowUpRight size={19} /></b></div></a>
  </div>
}
export function VariantA() {
  return <div className="proto-shell"><section className="proto-a-intro"><div><p className="proto-kicker">专业设计智能工作室 / 研究与实践</p><h1>让研究，<br />成为设计能力。</h1></div><div className="proto-intro-note"><p>从市场理解到可讨论的产品方案，<br />再到可以反复使用的专业判断。</p><span>市场研究 / 方法迭代 / 跨品类应用</span></div></section><CaseTiles variant="A" /><div className="proto-method"><span>我们的工作方式</span><p>研究提供方向</p><i>→</i><p>试验形成判断</p><i>→</i><p>方法进入工作台</p></div></div>
}
const route = [
  { number: '01', title: '理解市场', sub: '印度市场与设计机会', time: '2–3 分钟', view: 'india' as View, hash: '' },
  { number: '02', title: '看见迭代', sub: '手机：提档与独立主题', time: '4–5 分钟', view: 'india' as View, hash: '#ramp' },
  { number: '03', title: '跨越品类', sub: '手表：判断、场景与系列', time: '约 3 分钟', view: 'watch' as View, hash: '' },
  { number: '04', title: '开始设计', sub: '把方法带入实际工作', time: '现场演示', view: 'workbench' as View, hash: '' },
]
export function VariantB() {
  return <div className="proto-shell proto-b-home"><aside><p className="proto-kicker">一次完整的设计之旅</p><h1>从理解，<br />到创造。</h1><p className="proto-lead">用两个品类，讲清专业设计<br />如何成为可复用的能力。</p><div className="proto-itinerary">{route.map(item => <a key={item.number} href={url('B', item.view, item.hash)}><span>{item.number}</span><div><strong>{item.title}</strong><p>{item.sub}</p></div><small>{item.time}</small><IconArrowUpRight size={18} /></a>)}</div></aside><section className="proto-b-stage"><div className="proto-b-stage-label"><span>从这里开始</span><span>01 / 04</span></div><img src={image('phone-hero')} alt="印度文化手机设计概念" /><div className="proto-b-stage-copy"><p className="proto-kicker">第一站 · 印度手机</p><h2>为什么是这样的设计？</h2><p>先看市场，再看我们怎样把研究转成产品语言。</p><a className="studio-button" href={url('B', 'india')}>开始讲解 <IconArrowRight size={18} /></a></div><Link variant="B" view="watch">也可以直接查看手表系列</Link></section></div>
}
export function VariantC() {
  return <div className="proto-shell"><section className="proto-c-intro"><p className="proto-kicker">华中科技大学设计学院 · 专业设计智能工作室</p><h1>判断，在设计中显形。</h1><p>市场、文化与工艺，成为可以看见、比较和继续推进的产品方案。</p></section><section className="proto-c-spread"><a href={url('C', 'india')}><div className="proto-spread-top"><span>01 / 手机</span><IconArrowUpRight /></div><img src={image('phone-hero')} alt="玄银承脊印度手机" /><div><h2>印度设计研究</h2><p>从市场洞察到主题探索</p></div></a><a href={url('C', 'watch')}><div className="proto-spread-top"><span>02 / 手表</span><IconArrowUpRight /></div><img src={image('watch-hero')} alt="丛林主题八角智能手表" /><div><h2>腕上设计实践</h2><p>从细节判断到系列语言</p></div></a></section><div className="proto-c-caption"><span>不只展示最后一张图。</span><p>点开每个案例，看见方案背后的问题、选择与迭代。</p></div></div>
}
const indiaSamples = [
  { title: '孔雀隐喻', tag: '主题探索', file: 'phone-peacock', text: '不是把孔雀画在手机上，而是比较轮廓、光泽和光学细节如何承载同一个文化来源。', points: ['收翎：纵向秩序', '颈光：局部蓝青光泽', '羽序：节奏与边缘', '藏睛：镜头内层细节'] },
  { title: '阶井：两种深浅秩序', tag: '10 × 2 · 主题 01', file: 'phone-stepwell', text: '同样的阶井来源，一种成为精密细阶，一种成为宽浅平台。重点不再是分数，而是哪一种关系值得继续设计。', points: ['A 精密细阶', 'B 宽阶留白'] },
  { title: '相机与整机的关系', tag: '候选方法探索', file: 'phone-six', text: '横肩、侧降、承脊、柔丘、折面与弧张：让相机、背板和中框成为同一组造型判断。', points: ['台阶与退面', '刚性连接与柔面承托', '折面与弧面张力'] },
]
const watchSamples = [
  { title: '同一个问题，三种工艺层级', tag: '设计判断探索', file: 'watch-contrast', text: '从安静织纹、织锦边界到珠宝镶嵌，比较材质主次如何改变整表气质。', points: ['安静织纹', '织锦边界', '珠宝镶嵌'] },
  { title: '高山救援：保护怎样成为形态', tag: '场景与可信度验证', file: 'watch-rescue', text: '把救援场景落实为框体层次、侧向护轨与角部连接，而不是给普通手表换一个户外背景。', points: ['分层框体', '侧向护轨', '角部连接'] },
  { title: '中秋系列：共享语言，不同角色', tag: '系列应用', file: 'watch-series', text: '围绕共同的月窗关系，展开城市、正式、户外与收藏角色，让系列差异超出换色。', points: ['城市', '正式', '户外', '收藏'] },
]
function Research() {
  return <section id="research" className="proto-research"><div className="proto-section-title"><span>01 / 市场研究</span><h2>可负担的高级感，<br />要在上手时成立。</h2><p>印度的机会，不是把旗舰外观缩小，而是让成熟设计进入主流价位。</p></div><div className="proto-research-grid"><div className="proto-fact-main"><span>量平 · 价升</span><strong>+9<small>%</small></strong><h3>市场价值增长</h3><p>2025 年出货量增长 0.5%，产品价值与体验的竞争更突出。</p><div className="proto-bars"><div><span>出货量</span><i style={{ width: '8%' }} /><b>+0.5%</b></div><div><span>市场价值</span><i style={{ width: '76%' }} /><b>+9%</b></div></div></div><div className="proto-fact"><span>购买现场</span><strong>57<small>%</small></strong><h3>出货来自线下渠道</h3><p>颜色、相机识别与握持，在柜台上共同形成第一印象。</p><div className="proto-channel"><i /><span>线下 57%</span><span>线上 43%</span></div></div><div className="proto-fact"><span>主流价格带</span><strong>67<small>%</small></strong><h3>出货集中在 $100–400</h3><p>有限成本下，精确的比例、清楚的零件关系和材料层次更重要。</p><div className="proto-price"><span>$100–200 <b>41%</b></span><span>$200–400 <b>26%</b></span></div></div></div><p className="proto-source">2025 全年 · IDC 印度智能手机市场统计 · 出货口径。<a href="https://www.idc.com/resource-center/press-releases/india-smartphone-market-2025-2026/" target="_blank" rel="noreferrer">查看来源 ↗</a>　原型选用现有研究摘要</p><div className="proto-opportunities"><header><span>从研究到设计</span><h3>三项具体的设计任务</h3></header><article><b>01</b><h4>把可靠做得可见</h4><p>连贯框体、明确保护边界、可信的相机落座。</p></article><article><b>02</b><h4>让高级感来自整体</h4><p>比例、握持转面和材料关系先成立，再精修细节。</p></article><article><b>03</b><h4>让文化进入产品</h4><p>把来源转成结构、光泽与工艺，不止停留在图案。</p></article></div><a className="proto-link" href="#ramp">这些判断，怎样进入试验？ <IconArrowRight size={20} /></a></section>
}
function Ramp({ enlarge }: { enlarge: (src: string, title: string) => void }) {
  return <section id="ramp" className="proto-ramp"><div><p className="proto-kicker">02 / 基础水准提升 · Batch 01–16</p><h2>先把方案，<br />提升到值得讨论。</h2><p>前期用快速迭代和固定评价识别共性问题：从差异太小，到形态、工艺与相机关系能够被看见、被比较。</p><div className="proto-ramp-steps"><span>可见差异</span><i>→</i><span>系列与文化</span><i>→</i><span>工艺表达</span><i>→</i><span>整体关系</span></div><details><summary>展开早期批次与评分记录</summary><p>原有 Batch 01–16 完整记录将在正式版本中保留于此。评分只在这一阶段作为迭代参照。</p><img src={`${CASE_ASSET_ROOT}/06/comparison-board.jpg`} alt="第六批系列基线" /></details></div><button className="proto-board" onClick={() => enlarge(`${CASE_ASSET_ROOT}/15/comparison-board.jpg`, 'Batch 15 · 功能部件上的连续节奏')}><img src={`${CASE_ASSET_ROOT}/15/comparison-board.jpg`} alt="第十五批功能部件上的连续节奏" /><span>Batch 15 · 功能部件上的连续节奏 <IconMaximize size={17} /></span></button></section>
}
function Experiments({ watch, enlarge }: { watch?: boolean; enlarge: (src: string, title: string) => void }) {
  const samples = watch ? watchSamples : indiaSamples
  return <section id="themes" className="proto-experiments"><div className="proto-section-title"><span>{watch ? '迭代案例 / 三类证据' : '03 / 独立主题试验'}</span><h2>{watch ? '不同设计问题，\n不同判断方式。' : '不再追逐同一个分数，\n开始讨论具体的设计。'}</h2><p>{watch ? '从局部选择到场景验证，再到完整系列。' : '方法成为起点，主题成为新的问题。选一个方向，展开看。'}</p></div>{samples.map((sample, index) => <article className="proto-experiment" key={sample.file}><button className="proto-board" onClick={() => enlarge(image(sample.file), sample.title)}><img src={image(sample.file)} alt={sample.title + '对比板'} loading="lazy" /><span>查看完整对比板 <IconMaximize size={17} /></span></button><div className="proto-experiment-copy"><p className="proto-kicker">{String(index + 1).padStart(2, '0')} / {sample.tag}</p><h3>{sample.title}</h3><p>{sample.text}</p><div className="proto-tags">{sample.points.map(point => <span key={point}>{point}</span>)}</div><details><summary>展开设计判断与过程资料</summary><h4>讨论重点</h4><p>{sample.text}</p><h4>比较方向</h4><ul>{sample.points.map(point => <li key={point}>{point}</li>)}</ul><p className="proto-source">本原型演示展开层级；完整 Prompt、Schema、原图和评审在正式整理时接入。</p></details></div></article>)}</section>
}
function CasePage({ variant, watch, enlarge }: { variant: Variant; watch: boolean; enlarge: (src: string, title: string) => void }) {
  return <div className="proto-shell"><div className="proto-case-heading"><a className="proto-back" href={url(variant)}><IconArrowLeft size={17} /> 返回首页</a><p className="proto-kicker">{watch ? '智能手表 / 设计迭代案例' : '印度手机 / 市场研究与设计实践'}</p><h1>{watch ? '从腕上细节，\n到系列语言。' : '理解市场，\n让设计有据可循。'}</h1><p>{watch ? '让佩戴、控制、结构与文化表达，形成完整的产品判断。' : '先看印度市场的设计机会，再看我们怎样把研究转成可讨论的方案。'}</p></div><nav className="proto-section-nav" aria-label="案例目录">{!watch && <><a href="#research">01 市场研究</a><a href="#ramp">02 基础水准提升</a></>}<a href="#themes">{watch ? '设计判断 / 场景验证 / 系列应用' : '03 独立主题试验'}</a><span>约 {watch ? '3' : '7'} 分钟</span></nav>{watch ? <div className="proto-watch-intro"><img src={image('watch-hero')} alt="印度丛林八角表" /><div><p className="proto-kicker">精选应用 / 印度丛林</p><h2>不是换一个表盘，<br />而是重新组织整表。</h2><p>八角框体、金属外骨架与表带连接，共同承担户外气质。文化与场景进入结构，而不是只出现在屏幕里。</p></div></div> : <><Research /><Ramp enlarge={enlarge} /></>}<Experiments watch={watch} enlarge={enlarge} /><footer className="proto-next"><span>{watch ? '下一步 / 进入系统' : '下一站 / 跨品类设计'}</span><h2>{watch ? '把这些判断，带入下一次设计。' : '同样的方法，来到腕上。'}</h2><Link variant={variant} view={watch ? 'workbench' : 'watch'}>{watch ? '进入工作台' : '继续看手表案例'}</Link></footer></div>
}
export default function LandingPrototype() {
  const params = new URLSearchParams(window.location.search)
  const initial = params.get('variant') as Variant
  const [variant, setVariant] = useState<Variant>(variants.includes(initial) ? initial : 'A')
  const rawView = params.get('view') as View
  const view: View = rawView && Object.hasOwn(viewNames, rawView) ? rawView : 'home'
  const [opened, setOpened] = useState<{ src: string; title: string }>()
  function cycle(direction: number) {
    const next = variants[(variants.indexOf(variant) + direction + variants.length) % variants.length]
    setVariant(next)
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.set('variant', next)
    window.history.replaceState(null, '', nextUrl)
  }
  useEffect(() => {
    document.title = `${names[variant]} · ${viewNames[view]} · JVS 页面原型`
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpened(undefined); return }
      if (opened || event.altKey || event.ctrlKey || event.metaKey || (event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant, view, opened])
  useEffect(() => {
    if (window.location.hash) requestAnimationFrame(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView())
  }, [])
  const enlarge = (src: string, title: string) => setOpened({ src, title })
  return <main className={`studio-landing scheme-light landing-prototype proto-${variant.toLowerCase()} proto-view-${view}`}><Header variant={variant} view={view} />{view === 'home' ? variant === 'A' ? <VariantA /> : variant === 'B' ? <VariantB /> : <VariantC /> : view === 'workbench' ? <section className="proto-shell proto-workbench"><p className="proto-kicker">讲解路线终点 / 工作台入口</p><h1>接下来，<br />现场提出一个设计问题。</h1><p>正式页面会进入现有 JVS 工作台。这个原型只预览页面与讲解路线，不发起生成。</p><Link variant={variant} view="home">回到首页</Link></section> : <CasePage variant={variant} watch={view === 'watch'} enlarge={enlarge} />}{import.meta.env.DEV && <div className="proto-switcher" aria-label="原型方案切换"><button onClick={() => cycle(-1)} aria-label="上一个方案"><IconArrowLeft size={18} /></button><div><strong>{variant} · {names[variant]}</strong><small>结构原型 · {viewNames[view]} · ← → 切换</small></div><button onClick={() => cycle(1)} aria-label="下一个方案"><IconArrowRight size={18} /></button></div>}{opened && <div className="proto-lightbox" role="dialog" aria-modal="true" aria-label={opened.title} onClick={() => setOpened(undefined)}><header><span>{opened.title}</span><button autoFocus aria-label="关闭大图" onClick={() => setOpened(undefined)}><IconX /></button></header><img src={opened.src} alt={opened.title} onClick={event => event.stopPropagation()} /></div>}</main>
}
