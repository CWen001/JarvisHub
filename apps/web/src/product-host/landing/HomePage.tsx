import { IconArrowDown, IconArrowUpRight, IconBulb, IconCheck, IconPlayerPlay, IconRoute, IconSparkles } from '@tabler/icons-react'
import { motion } from 'framer-motion'
import { buildStudioUrl } from '../../utils/appRoutes'
import { CASE_PATH, CASE_ASSET_ROOT } from './indiaPhoneCaseData'
import './homePage.css'

const VIDEO_URL = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_102608_5fa1187d-9ac6-44fb-82ab-54376200abc0.mp4'

const OUTCOMES = [
  { src: '/product-host/landing/outcome-03-tablet-blue.jpg', alt: '蓝色冠军主题平板产品概念', label: '平板设备 / 配色方向' },
  { src: '/product-host/landing/outcome-09-watch-rose.jpg', alt: '玫瑰金智能手表产品概念', label: '智能手表 / 高端细节' },
  { src: '/product-host/landing/outcome-12-tablet-purple.jpg', alt: '紫色支架平板产品概念', label: '平板设备 / 形态探索' },
  { src: '/product-host/landing/outcome-16-watch-black.jpg', alt: '黑色运动智能手表产品概念', label: '智能手表 / 界面与形态' },
  { src: '/product-host/landing/outcome-22-watch-desert.jpg', alt: '沙漠配色户外智能手表产品概念', label: '智能手表 / 户外系统' },
  { src: '/product-host/landing/outcome-25-watch-trail.jpg', alt: '黑橙色极限越野智能手表产品概念', label: '智能手表 / 极限越野' },
] as const

const CAPABILITIES = ['专业设计知识驱动', '多方向概念探索', '真实成图评审', '持续迭代与沉淀'] as const

export default function HomePage(): JSX.Element {
  const workspaceUrl = buildStudioUrl()

  return (
    <main className="studio-landing scheme-light">
      <section className="studio-hero" aria-labelledby="studio-hero-title">
        <div className="studio-shell">
          <nav className="studio-nav" aria-label="主要导航">
            <a className="studio-brand-lockup" href="/" aria-label="华中科技大学设计学院专业设计工作室首页">
              <img className="studio-brand-lockup__institution" src="/product-host/hust-design-logo.png" alt="华中科技大学设计学院" />
              <span className="studio-brand-lockup__project">
                <img src="/product-host/landing/brand/wowsa-logo-black.png" alt="WOWSA" />
                <img src="/product-host/landing/brand/service-design-engineering-center-logo-black.svg" alt="服务设计工程中心" />
              </span>
            </a>
            <div className="studio-nav__links">
              <a className="studio-text-link" href="#outcomes">设计成果</a>
              <a className="studio-button" href={workspaceUrl}>开始设计 <IconArrowUpRight aria-hidden="true" /></a>
            </div>
          </nav>

          <div className="studio-hero__grid">
            <motion.header
              className="studio-hero__heading"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0, 0, 0.2, 1] }}
            >
              <div className="studio-kicker studio-kicker--hero">
                <span className="studio-icon-badge" aria-hidden="true"><IconSparkles /></span>
                <p className="studio-eyebrow">专业设计智能工作室</p>
              </div>
              <h1 id="studio-hero-title" aria-label="专业设计，由此生成"><span>专业设计，</span><span>由此生成</span></h1>
              <p className="studio-hero__lead">让专业设计知识进入每一次生成。</p>
              <p className="studio-hero__copy">从一句设计意图到可评审的产品概念，由专业设计内核驱动探索、生成与迭代。</p>
              <div className="studio-hero__actions">
                <a className="studio-button" href={workspaceUrl}>开始设计 <IconArrowUpRight aria-hidden="true" /></a>
                <a className="studio-text-link studio-text-link--icon" href="#outcomes">查看设计成果 <IconArrowDown aria-hidden="true" /></a>
              </div>
            </motion.header>

            <motion.figure
              className="studio-hero__media"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.6, ease: [0, 0, 0.2, 1] }}
            >
              {/* ponytail: temporary reference video; replace with an owned render before production. */}
              <video
                src={VIDEO_URL}
                poster="/product-host/landing/outcome-25-watch-trail.jpg"
                autoPlay
                loop
                muted
                playsInline
                aria-label="生成式产品设计动态视觉"
              />
              <figcaption><span><IconPlayerPlay aria-hidden="true" />设计动态</span><span>01 / 01</span></figcaption>
            </motion.figure>
          </div>

          <motion.div
            className="studio-capability-grid"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6, ease: [0, 0, 0.2, 1] }}
          >
            <article className="studio-capability-card">
              <div>
                <div className="studio-kicker">
                  <span className="studio-icon-badge" aria-hidden="true"><IconBulb /></span>
                  <p className="studio-eyebrow">专业设计内核</p>
                </div>
                <h2>专业能力，不止于生成</h2>
                <p>以手表与平板设计知识为内核，将专业判断带入概念探索与方案表达。</p>
              </div>
              <div className="studio-tags"><span>智能手表</span><span>平板设备</span></div>
            </article>

            <article className="studio-capability-card studio-capability-card--process">
              <div>
                <div className="studio-kicker">
                  <span className="studio-icon-badge" aria-hidden="true"><IconRoute /></span>
                  <p className="studio-eyebrow">从设计意图到产品概念</p>
                </div>
                <p className="studio-process-mark">01 → ∞</p>
              </div>
              <div className="studio-process-footer"><span>一句设计意图</span><span>可评审概念</span></div>
            </article>

            <article className="studio-capability-card studio-capability-card--actions">
              <ul>
                {CAPABILITIES.map((capability) => (
                  <li key={capability}><IconCheck aria-hidden="true" />{capability}</li>
                ))}
              </ul>
              <a className="studio-button studio-button--wide" href={workspaceUrl}>开始设计 <IconArrowUpRight aria-hidden="true" /></a>
            </article>
          </motion.div>
        </div>
      </section>

      <section className="studio-outcomes" id="outcomes" aria-labelledby="outcomes-title">
        <div className="studio-shell">
          <header className="studio-outcomes__header">
            <p className="studio-eyebrow">精选设计成果 · 2026</p>
            <h2 id="outcomes-title">设计成果</h2>
            <p>从产品形态、材质配色到使用情境，让每个方向成为可讨论、可评审、可继续推进的设计资产。</p>
          </header>

          <a className="studio-case-feature" href={CASE_PATH}>
            <div className="studio-case-feature__copy">
              <p className="studio-eyebrow">设计迭代案例 · 2026</p>
              <h3>印度市场手机外观设计迭代</h3>
              <p>19 个 Learning Batches，76 个设计方向。从文化研究与 Prompt Engineering，到 Comparison Board 和固定评价门禁。</p>
              <dl>
                <div><dt>19</dt><dd>Learning Batches</dd></div>
                <div><dt>76</dt><dd>Design Directions</dd></div>
                <div><dt>1</dt><dd>Fixed Rubric</dd></div>
              </dl>
              <span>查看完整案例 <IconArrowUpRight aria-hidden="true" /></span>
            </div>
            <img src={`${CASE_ASSET_ROOT}/15/comparison-board.jpg`} alt="印度市场手机外观设计 Batch 15 对比板" loading="lazy" />
          </a>

          <div className="studio-gallery">
            {OUTCOMES.map((outcome, index) => (
              <motion.figure
                className={`studio-gallery__item studio-gallery__item--${index + 1}`}
                key={outcome.src}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.18 }}
                transition={{ duration: 0.4, delay: (index % 3) * 0.05 }}
              >
                <img src={outcome.src} alt={outcome.alt} loading="lazy" />
                <figcaption><span>{String(index + 1).padStart(2, '0')}</span>{outcome.label}</figcaption>
              </motion.figure>
            ))}
          </div>

          <footer className="studio-outcomes__footer">
            <p>开启下一个设计方向</p>
            <a className="studio-button" href={workspaceUrl}>开始设计 <IconArrowUpRight aria-hidden="true" /></a>
          </footer>
        </div>
      </section>
    </main>
  )
}
