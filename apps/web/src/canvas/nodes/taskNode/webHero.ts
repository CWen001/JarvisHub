import type { Edge, Node } from '@xyflow/react'
import {
  readWebHeroRefinementAttachments,
  summarizeWebHeroRefinementAttachmentsForPrompt,
  type WebHeroRefinementAttachment,
} from './webHeroTweaks'

export type UnknownRecord = Record<string, unknown>

export type WebHeroMediaKind = 'image' | 'video'

export type WebHeroMediaAsset = {
  kind: WebHeroMediaKind
  url: string
  sourceNodeId: string
  sourceLabel: string
  prompt: string
  meaning: string
  width: number | null
  height: number | null
  aspectRatio: string | null
}

export type WebHeroCopy = {
  eyebrow: string
  title: string
  subtitle: string
  primaryCta: string
  secondaryCta: string
}

export type WebHeroBuildResult = {
  html: string
  css: string
  documentHtml: string
  media: WebHeroMediaAsset
  copy: WebHeroCopy
}

export type WebPagePlannedAssetRole =
  | 'hero_object'
  | 'portrait'
  | 'product_mockup'
  | 'section_illustration'
  | 'background_motif'
  | 'logo_mark'
  | 'photo'
  | 'other'

export type WebPagePlannedAssetSource =
  | 'screenshot'
  | 'supporting'
  | 'public_search'
  | 'web_asset_search'
  | 'icon_search'

export type WebPagePlannedAsset = {
  id: string
  name: string
  role: WebPagePlannedAssetRole
  source: WebPagePlannedAssetSource
  placement: string
  prompt: string
  aspectRatio: string
  transparentPng: boolean
  reason: string
  mustKeep: string[]
  avoid: string[]
}

export type WebPageVisualSlotImplementation =
  | 'generate'
  | 'public_search'
  | 'web_asset_search'
  | 'icon_search'
  | 'code_procedural'
  | 'existing_canvas'

export type WebPageVisualSlot = {
  sectionId: string
  screenshotOrder: number | null
  slotId: string
  description: string
  implementation: WebPageVisualSlotImplementation
  assetId: string | null
  searchQuery: string | null
  reason: string
}

export type WebPageAssetPlan = {
  summary: string
  visualSlots: WebPageVisualSlot[]
  items: WebPagePlannedAsset[]
  iconStrategy: string
  implementationNotes: string[]
  coverageChecklist: string[]
}

export type WebPageScreenshotAnalysis = {
  summary: string
  styleBible: string[]
  consistencyWarnings: string[]
  layout: string[]
  spacing: string[]
  typography: string[]
  colorAndGradient: string[]
  imageTreatment: string[]
  shapeAndRadius: string[]
  componentDetails: string[]
  responsiveNotes: string[]
  implementationPriorities: string[]
}

export type WebPageGeneratedAsset = {
  id: string
  sourceNodeId: string
  url: string
  name: string
  aspectRatio: string
  transparentPng: boolean
}

export type WebPageCurrentCode = {
  html: string
  css: string
  documentHtml: string
}

export type WebPageRefinementAssetAction = {
  assetId: string
  reason: string
  prompt: string
}

export type WebPageRefinementPlan = {
  summary: string
  changeMode: 'style_only' | 'asset_regeneration'
  requiresAssetRegeneration: boolean
  styleDirectives: string[]
  preserveDirectives: string[]
  assetActions: WebPageRefinementAssetAction[]
}

export type WebPageCodeGenerationContext = {
  styleBible: string[]
  brandPatternSeed: string[]
  refinementAttachments: WebHeroRefinementAttachment[]
  request: {
    prompt: string
    label: string
    pageKind: 'landing_page'
    target: string
  }
  media: WebHeroMediaAsset
  referenceScreenshots: WebHeroMediaAsset[]
  copy: WebHeroCopy
  screenshotAnalysis: WebPageScreenshotAnalysis | null
  assetPlan: WebPageAssetPlan | null
  generatedAssets: WebPageGeneratedAsset[]
  currentPage: WebPageCurrentCode | null
  refinementPlan: WebPageRefinementPlan | null
  designGuidelines: string[]
  generationWorkflow: string[]
  outputContract: {
    format: 'json'
    requiredFields: string[]
  }
}

export type WebPageCodeGenerationResult = {
  html: string
  css: string
  documentHtml: string
  pagePlan: string[]
  assetUsage: string
  notes: string[]
}

export type WebPageSearchReplaceEdit = {
  search: string
  replace: string
}

export type WebPageStyleOnlyPatchResult = {
  summary: string
  htmlEdits: WebPageSearchReplaceEdit[]
  cssEdits: WebPageSearchReplaceEdit[]
  notes: string[]
}

type WebPageCurrentPagePromptMode = 'inline' | 'session_history'
type WebPagePromptDetailMode = 'full' | 'codegen_compact'

type WebPageCurrentPagePromptOptions = {
  currentPageMode?: WebPageCurrentPagePromptMode
  currentPageHash?: string | null
  promptDetailMode?: WebPagePromptDetailMode
}

const DEFAULT_COPY: WebHeroCopy = {
  eyebrow: 'JarvisHub',
  title: 'AIGC 创作资产驱动的网页 Hero',
  subtitle: '把画布里的图片与循环视频直接变成可嵌入页面的首屏体验。',
  primaryCta: '开始创作',
  secondaryCta: '查看方案',
}

const WEB_PAGE_DESIGN_GUIDELINES = [
  '先生成完整网页，不要只生成 Hero。默认结构为 Navigation、Hero、Features、Social Proof 或 Use Cases、CTA、Footer；用户明确要求单屏时才收敛为单 Hero。',
  '遵循 reference-first 原则：网页截图/预览图是主要视觉事实源。先分析图像，再抽取设计系统，最后实现代码；不要在证据不足时替换成通用 SaaS/agency 模板。',
  '采用 OpenPencil 风格的推进式思路：先规划 section 与组件边界，再输出代码；最终结果仍必须一次返回完整 HTML/CSS/documentHtml，方便当前节点预览和下载。',
  '参考 hue 的设计模型思想：先把输入资产抽象成 hero stage、色彩、版式密度、字体气质、圆角/阴影/动效约束，再写代码；不要复制固定模板。',
  '图片或视频资产不是盲目铺背景：必须根据资产尺寸、宽高比与语义决定是全屏背景、右侧产品视觉、卡片媒体、局部装饰还是章节插图。',
  '复杂主视觉应优先考虑分层实现：背景场景/材质/环境单独作为背景资产，主体产品/人物/设备/车辆等以透明 PNG 抠图资产叠放，便于 Hover、视差、浮动和入场动效。',
  '如需 JavaScript 动效，优先原生 HTML/CSS/JavaScript 方案；也允许通过 CDN、importmap 或 module script 引入可直接浏览器运行的外部库或框架 runtime，只要最终 documentHtml 仍可直接在 iframe srcDoc 中运行。',
  '允许外部公共资源，包括字体、图片、图标、CSS/JS 库与框架 runtime；但它们必须服务于截图还原、页面层级和交互质量，不能反客为主或把页面带偏成另一个设计系统。',
  'Hero 首屏可以使用循环视频或图片，但文字必须有可读性；通过布局、安全区、遮罩或 sibling media 解决，不要让文字压住主体。',
  '若资产是 video，必须 autoplay muted loop playsinline；若资产是 image，必须提供基于语义的 alt。',
  '内容密度要像真实产品站：同屏显示有效信息，避免大段说明、伪文案、营销空话和装饰性容器堆叠。',
  '若截图中存在清晰可读的导航、标题、CTA 或 section heading，优先沿用其层级与措辞；若文本不可读，用长度和层级相近的克制占位文案，不要擅自补长篇营销文案。',
  '使用语义 HTML：nav/header/main/section/article/footer/button/a；每个可见元素都要有清晰 className，CSS 选择器必须稳定。',
  'CSS 必须自包含、响应式、移动优先；允许使用外部字体、外部图片、图标 CDN、CSS/JS 库或框架 runtime，但输出仍必须是可直接运行的完整 documentHtml，不能依赖本地构建流程。',
  '视觉规则：禁止一味紫蓝渐变，禁止装饰性圆角套圆角，边框只能承担信息层级，默认靠留白、对齐、明度和文字层级组织。',
  '组件一致性优先于截图瑕疵复刻：同一组 Tabs、卡片、按钮、标签、统计块、图标必须使用统一样式；Tabs 若带下标/箭头/图标则全组一致，否则全组都不带。',
  '不要使用图片作为纯背景填充；如果作为背景，必须说明主体安全区和遮罩策略。更常见的优秀方案是文本与媒体作为 sibling section。',
  '输出代码必须可直接放进 iframe srcDoc 预览；documentHtml 必须包含 <!doctype html>、viewport meta、style 和 body。',
]

const WEB_PAGE_GENERATION_WORKFLOW = [
  '1. 读取用户目标、节点 prompt、上游网页截图含义与尺寸；若存在多张网页截图，运行器会按顺序把原始图片 URL 作为多图视觉输入传给 agent，不做前端合成长图或 base64 转换。',
  '2. 先由视觉资产规划步骤判断哪些素材应该单独生成，哪些应由 HTML/CSS/inline SVG 实现。',
  '3. 根据资产计划规划完整 landing page sections 和每个 section 的作用。',
  '4. 将上游截图仅作为视觉参考，不要把整张截图作为页面中的 img、background-image 或 video。',
  '5. 对计划中的图片资产使用稳定 data-asset-id / className 占位，等待后续资产生成链路替换；不要制造不存在的远程 URL。',
  '6. 生成完整 HTML/CSS/documentHtml。',
  '7. 自检：代码可预览、响应式不重叠、没有复用整张截图、外部依赖均为浏览器可直接运行且理由明确、资产占位可追踪。',
]

const WEB_PAGE_ASSET_PLAN_ROLES: WebPagePlannedAssetRole[] = [
  'hero_object',
  'portrait',
  'product_mockup',
  'section_illustration',
  'background_motif',
  'logo_mark',
  'photo',
  'other',
]

const WEB_PAGE_ASSET_PLAN_SOURCES: WebPagePlannedAssetSource[] = [
  'screenshot',
  'supporting',
  'public_search',
  'web_asset_search',
  'icon_search',
]


const WEB_PROMPT_TEXT_LIMIT = 420
const WEB_PROMPT_LIST_ITEM_LIMIT = 220
const WEB_PROMPT_LIST_LIMIT = 8
const WEB_PROMPT_GUIDELINE_LIMIT = 8
const WEB_PROMPT_ASSET_PROMPT_LIMIT = 260

function compactText(value: string, limit = WEB_PROMPT_TEXT_LIMIT): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized || normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trim()}…`
}

function compactStringList(items: string[] | undefined, limit = WEB_PROMPT_LIST_LIMIT, itemLimit = WEB_PROMPT_LIST_ITEM_LIMIT): string[] {
  if (!Array.isArray(items)) return []
  return items.slice(0, limit).map((item) => compactText(item, itemLimit)).filter(Boolean)
}

function summarizeMediaForPrompt(media: WebHeroMediaAsset): Omit<WebHeroMediaAsset, 'url'> & { urlRef: string } {
  return {
    kind: media.kind,
    urlRef: 'provided-by-assetInputs',
    sourceNodeId: media.sourceNodeId,
    sourceLabel: compactText(media.sourceLabel, 120),
    prompt: compactText(media.prompt, 260),
    meaning: compactText(media.meaning, 260),
    width: media.width,
    height: media.height,
    aspectRatio: media.aspectRatio,
  }
}

function summarizeScreenshotForPrompt(media: WebHeroMediaAsset): Omit<WebHeroMediaAsset, 'url'> & { urlRef: string } {
  return {
    ...summarizeMediaForPrompt(media),
    urlRef: 'metadata-only-do-not-reference-url',
  }
}

function summarizeMediaForCodegenPrompt(media: WebHeroMediaAsset): {
  kind: WebHeroMediaKind
  urlRef: string
  sourceNodeId: string
  aspectRatio: string | null
} {
  return {
    kind: media.kind,
    urlRef: 'metadata-only-do-not-reference-url',
    sourceNodeId: media.sourceNodeId,
    aspectRatio: media.aspectRatio,
  }
}

function summarizeReferenceScreenshotsForCodegenPrompt(items: WebHeroMediaAsset[]): {
  count: number
  order: Array<{
    index: number
    kind: WebHeroMediaKind
    sourceNodeId: string
    aspectRatio: string | null
  }>
} {
  return {
    count: items.length,
    order: items.slice(0, 6).map((item, index) => ({
      index: index + 1,
      kind: item.kind,
      sourceNodeId: item.sourceNodeId,
      aspectRatio: item.aspectRatio,
    })),
  }
}

function summarizeAnalysisForPrompt(analysis: WebPageScreenshotAnalysis | null): WebPageScreenshotAnalysis | null {
  if (!analysis) return null
  return {
    summary: compactText(analysis.summary),
    styleBible: compactStringList(analysis.styleBible, 10, 220),
    consistencyWarnings: compactStringList(analysis.consistencyWarnings, 6, 180),
    layout: compactStringList(analysis.layout),
    spacing: compactStringList(analysis.spacing, 6),
    typography: compactStringList(analysis.typography, 6),
    colorAndGradient: compactStringList(analysis.colorAndGradient, 6),
    imageTreatment: compactStringList(analysis.imageTreatment, 6),
    shapeAndRadius: compactStringList(analysis.shapeAndRadius, 6),
    componentDetails: compactStringList(analysis.componentDetails, 6),
    responsiveNotes: compactStringList(analysis.responsiveNotes, 5),
    implementationPriorities: compactStringList(analysis.implementationPriorities, 8),
  }
}

function summarizeAnalysisForCodegenPrompt(analysis: WebPageScreenshotAnalysis | null): Record<string, unknown> | null {
  if (!analysis) return null
  return {
    summary: compactText(analysis.summary, 260),
    styleBible: compactStringList(analysis.styleBible, 8, 180),
    consistencyWarnings: compactStringList(analysis.consistencyWarnings, 4, 140),
    layout: compactStringList(analysis.layout, 4, 150),
    typography: compactStringList(analysis.typography, 4, 150),
    colorAndGradient: compactStringList(analysis.colorAndGradient, 4, 150),
    imageTreatment: compactStringList(analysis.imageTreatment, 4, 150),
    responsiveNotes: compactStringList(analysis.responsiveNotes, 3, 140),
    implementationPriorities: compactStringList(analysis.implementationPriorities, 6, 170),
  }
}

function buildBrandPatternSeed(record: UnknownRecord): string[] {
  const template = readString(record.webDesignTemplate)
  const styleBibleRaw = resolveWebPageStyleBible(record)
  const styleBible = styleBibleRaw.slice(0, 6)
  const intent = readString(record.webDesignIntent)
  const seed: string[] = []
  if (template) seed.push(`template: ${template}`)
  if (intent) seed.push(`intent: ${intent}`)
  seed.push('constraint: keep the same website-wide themeMode, color tokens, typography mood, radius/shadow/material, icon language, image treatment, and spacing rhythm')
  seed.push('constraint: screenshot visual style must be translated into HTML/CSS, not copied as a raw image')
  seed.push('constraint: if the screenshot style contains a brand pattern, preserve that pattern consistently across all sections and components')
  seed.push(...styleBible)
  return seed.slice(0, 10)
}

function summarizeBrandPatternSeed(seed: string[]): string[] {
  return seed.slice(0, 10).map((item) => compactText(item, 220))
}

function summarizeAssetPlanForPrompt(plan: WebPageAssetPlan | null): WebPageAssetPlan | null {
  if (!plan) return null
  return {
    summary: compactText(plan.summary),
    visualSlots: plan.visualSlots.slice(0, 20).map((slot) => ({
      sectionId: compactText(slot.sectionId, 80),
      screenshotOrder: slot.screenshotOrder,
      slotId: compactText(slot.slotId, 80),
      description: compactText(slot.description, 180),
      implementation: slot.implementation,
      assetId: slot.assetId ? compactText(slot.assetId, 100) : null,
      searchQuery: slot.searchQuery ? compactText(slot.searchQuery, 140) : null,
      reason: compactText(slot.reason, 180),
    })),
    items: plan.items.slice(0, 8).map((item) => ({
      id: item.id,
      name: compactText(item.name, 120),
      role: item.role,
      source: item.source,
      placement: compactText(item.placement, 180),
      prompt: compactText(item.prompt, WEB_PROMPT_ASSET_PROMPT_LIMIT),
      aspectRatio: item.aspectRatio,
      transparentPng: item.transparentPng,
      reason: compactText(item.reason, 180),
      mustKeep: compactStringList(item.mustKeep, 5, 160),
      avoid: compactStringList(item.avoid, 4, 160),
    })),
    iconStrategy: compactText(plan.iconStrategy, 360),
    implementationNotes: compactStringList(plan.implementationNotes, 6),
    coverageChecklist: compactStringList(plan.coverageChecklist, 8, 180),
  }
}

function summarizeAssetPlanForCodegenPrompt(plan: WebPageAssetPlan | null): Record<string, unknown> | null {
  if (!plan) return null
  return {
    summary: compactText(plan.summary, 220),
    visualSlots: plan.visualSlots.slice(0, 20).map((slot) => ({
      sectionId: compactText(slot.sectionId, 60),
      screenshotOrder: slot.screenshotOrder,
      slotId: compactText(slot.slotId, 70),
      description: compactText(slot.description, 120),
      implementation: slot.implementation,
      assetId: slot.assetId ? compactText(slot.assetId, 80) : null,
      searchQuery: slot.searchQuery ? compactText(slot.searchQuery, 110) : null,
    })),
    items: plan.items.slice(0, 10).map((item) => ({
      id: item.id,
      name: compactText(item.name, 100),
      role: item.role,
      source: item.source,
      placement: compactText(item.placement, 150),
      aspectRatio: item.aspectRatio,
      transparentPng: item.transparentPng,
      reason: compactText(item.reason, 140),
    })),
    iconStrategy: compactText(plan.iconStrategy, 220),
    implementationNotes: compactStringList(plan.implementationNotes, 4, 160),
    coverageChecklist: compactStringList(plan.coverageChecklist, 4, 150),
  }
}

type AssetAspectCategory = 'wide' | 'square' | 'tall' | 'unknown'

function parseAspectRatioValue(value: string): { width: number; height: number } | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  const match = raw.match(/^(\d+)\s*[:/xX]\s*(\d+)$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

function classifyAssetAspectRatio(aspectRatio: string): AssetAspectCategory {
  const parsed = parseAspectRatioValue(aspectRatio)
  if (!parsed) return 'unknown'
  const ratio = parsed.width / parsed.height
  if (Math.abs(ratio - 1) <= 0.12) return 'square'
  if (ratio > 1) return 'wide'
  return 'tall'
}

function isForegroundAssetRole(role: WebPagePlannedAssetRole): boolean {
  return role === 'hero_object' || role === 'portrait' || role === 'product_mockup' || role === 'logo_mark'
}

function isBackgroundOnlyAssetRole(role: WebPagePlannedAssetRole): boolean {
  return role === 'background_motif' || role === 'photo'
}

function normalizeAssetPlanText(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[×✕]/g, 'x')
}

function isGalleryLikeText(value: string | null | undefined): boolean {
  const text = normalizeAssetPlanText(value)
  return /\b(gallery|grid|masonry|carousel|portfolio|selected work|selected works|photo wall|image wall|case studies|showcase|lookbook)\b/.test(text) ||
    /(?:3\s*x\s*3|2\s*x\s*2|4\s*x\s*4|九宫格|相册|多图片|作品墙|摄影集|图片墙|案例展示|作品展示|照片墙|图集)/.test(text)
}

function isAggregateGalleryText(value: string | null | undefined): boolean {
  const text = normalizeAssetPlanText(value)
  return isGalleryLikeText(text) && (
    /\b(entire|whole|full|complete|combined|aggregate|single image|one image|one asset|all tiles|all cards|all images)\b/.test(text) ||
    /(?:整[个张]|完整|一整张|一张图|单张|拼图|合成|总图|全部格子|所有图片|所有卡片|九宫格)/.test(text)
  )
}

function isShowcaseGalleryText(value: string | null | undefined): boolean {
  const text = normalizeAssetPlanText(value)
  return isGalleryLikeText(text) && (
    /\b(photography|portfolio|selected work|selected works|work grid|case study|case studies|showcase|lookbook|editorial|artwork|project card|project cards)\b/.test(text) ||
    /(?:摄影|个人作品|作品集|案例|艺术作品|项目卡|展示图|样片|照片)/.test(text)
  )
}

function extractExpectedGalleryTileCount(text: string): number | null {
  const normalized = normalizeAssetPlanText(text)
  const gridMatch = normalized.match(/(\d+)\s*x\s*(\d+)/)
  if (gridMatch) {
    const cols = Number(gridMatch[1])
    const rows = Number(gridMatch[2])
    if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 1 && rows > 1) return cols * rows
  }
  if (/(?:九宫格|3\s*x\s*3)/.test(normalized)) return 9
  return null
}

function normalizeVisualSlotImplementation(value: string): WebPageVisualSlotImplementation | null {
  switch (String(value || '').trim()) {
    case 'generate':
    case 'public_search':
    case 'web_asset_search':
    case 'icon_search':
    case 'code_procedural':
    case 'existing_canvas':
      return value as WebPageVisualSlotImplementation
    default:
      return null
  }
}

export function assessWebPageAssetPlanQuality(input: {
  assetPlan: WebPageAssetPlan
  referenceScreenshotCount: number
}): string[] {
  const issues: string[] = []
  const itemCount = input.assetPlan.items.length
  const referenceCount = Math.max(0, Math.trunc(input.referenceScreenshotCount))
  const visualSlots = Array.isArray(input.assetPlan.visualSlots) ? input.assetPlan.visualSlots : []
  const visualSlotSectionIds = new Set(visualSlots.map((slot) => String(slot.sectionId || '').trim()).filter(Boolean))
  const visualSlotOrders = new Set(
    visualSlots
      .map((slot) => typeof slot.screenshotOrder === 'number' ? Math.trunc(slot.screenshotOrder) : null)
      .filter((order): order is number => order !== null && order > 0),
  )
  const assetItemIds = new Set(input.assetPlan.items.map((item) => item.id))
  const generatedSlotAssetIds = visualSlots
    .filter((slot) => slot.implementation === 'generate')
    .map((slot) => String(slot.assetId || '').trim())
  const missingGeneratedSlotAssets = generatedSlotAssetIds.filter((assetId) => !assetId || !assetItemIds.has(assetId))
  const codeProceduralSlotCount = visualSlots.filter((slot) => slot.implementation === 'code_procedural').length
  const reusableSearchSlotCount = visualSlots.filter((slot) =>
    slot.implementation === 'public_search' ||
    slot.implementation === 'web_asset_search' ||
    slot.implementation === 'icon_search',
  ).length
  const nonCodeSlotCount = visualSlots.length - codeProceduralSlotCount
  const aspectCategories = input.assetPlan.items.map((item) => classifyAssetAspectRatio(item.aspectRatio))
  const distinctAspectCategories = new Set(aspectCategories.filter((category) => category !== 'unknown'))
  const hasForegroundAsset = input.assetPlan.items.some((item) => isForegroundAssetRole(item.role))
  const hasTransparentForeground = input.assetPlan.items.some(
    (item) => isForegroundAssetRole(item.role) && item.transparentPng,
  )
  const hasOnlyBackgroundAssets =
    itemCount > 0 && input.assetPlan.items.every((item) => isBackgroundOnlyAssetRole(item.role))
  const hasSparseAssetDescriptors = input.assetPlan.items.some((item) => {
    const promptLength = compactText(item.prompt, 1000).length
    return item.mustKeep.length < 2 || item.avoid.length < 1 || promptLength < 120
  })
  const coverageText = input.assetPlan.coverageChecklist.join('\n').toLowerCase()
  const visualSlotCoverageCount = input.assetPlan.coverageChecklist.filter((item) => {
    const text = item.toLowerCase()
    return text.includes('asset:') ||
      text.includes('generate:') ||
      text.includes('public_search:') ||
      text.includes('web_asset_search:') ||
      text.includes('icon_search:') ||
      text.includes('code_procedural:') ||
      text.includes('css_only:')
  }).length
  const galleryEvidenceText = [
    input.assetPlan.summary,
    ...visualSlots.flatMap((slot) => [
      slot.sectionId,
      slot.slotId,
      slot.description,
      slot.searchQuery || '',
      slot.reason,
    ]),
    ...input.assetPlan.items.flatMap((item) => [
      item.id,
      item.name,
      item.role,
      item.source,
      item.placement,
      item.prompt,
      item.reason,
      ...item.mustKeep,
      ...item.avoid,
    ]),
    ...input.assetPlan.implementationNotes,
    ...input.assetPlan.coverageChecklist,
  ].join('\n')
  const hasGalleryEvidence = isGalleryLikeText(galleryEvidenceText)
  const hasShowcaseGalleryEvidence = isShowcaseGalleryText(galleryEvidenceText)
  const expectedGalleryTileCount = extractExpectedGalleryTileCount(galleryEvidenceText)
  const gallerySlots = visualSlots.filter((slot) => isGalleryLikeText([
    slot.sectionId,
    slot.slotId,
    slot.description,
    slot.searchQuery || '',
    slot.reason,
  ].join(' ')))
  const gallerySearchSlotCount = gallerySlots.filter((slot) =>
    slot.implementation === 'public_search' || slot.implementation === 'web_asset_search',
  ).length
  const aggregateGeneratedGallerySlots = gallerySlots.filter((slot) =>
    slot.implementation === 'generate' && isAggregateGalleryText([
      slot.sectionId,
      slot.slotId,
      slot.description,
      slot.reason,
    ].join(' ')),
  )
  const aggregateGeneratedGalleryItems = input.assetPlan.items.filter((item) =>
    isAggregateGalleryText([
      item.id,
      item.name,
      item.placement,
      item.prompt,
      item.reason,
      ...item.mustKeep,
      ...item.avoid,
    ].join(' ')),
  )
  const repeatedAggregateGalleryAssetIds = new Set(
    gallerySlots
      .filter((slot) => slot.implementation === 'generate')
      .map((slot) => String(slot.assetId || '').trim())
      .filter(Boolean),
  )

  if (referenceCount >= 3 && visualSlots.length < referenceCount) {
    issues.push('visualSlots 没有逐张覆盖所有网页预览图；必须先列出每张预览图的主要视觉槽位，再决定生成/搜索/CSS 实现')
  }
  if (referenceCount >= 3 && visualSlotOrders.size < referenceCount && visualSlotSectionIds.size < referenceCount) {
    issues.push('visualSlots 没有按截图顺序或 sectionId 覆盖每一页预览')
  }
  if (referenceCount >= 3 && nonCodeSlotCount < referenceCount) {
    issues.push('非代码视觉槽位过少；每张已确认预览至少要有一个生成/搜索/复用/图标资产决策')
  }
  if (missingGeneratedSlotAssets.length > 0) {
    issues.push(`visualSlots 中 generate 槽位缺少对应 assetPlan.items：${missingGeneratedSlotAssets.join(', ')}`)
  }
  if (referenceCount >= 3 && itemCount < referenceCount) {
    issues.push('生成资产数量过少；多张网页预览至少需要逐页覆盖 hero 主视觉、人物/产品/场景/作品图等主要非代码视觉主体')
  }
  if (referenceCount >= 3 && itemCount < 4) {
    issues.push('资产计划偏少；4 张 section 预览不能只生成 1 个泛用素材，至少要覆盖 Hero 主视觉、About 肖像/人物、Work 项目媒体、Contact/品牌氛围中的关键非代码视觉')
  }
  if (referenceCount >= 3 && input.assetPlan.coverageChecklist.length < referenceCount) {
    issues.push('coverageChecklist 没有逐张覆盖所有网页预览图')
  }
  if (referenceCount >= 3 && visualSlotCoverageCount < referenceCount) {
    issues.push('coverageChecklist 没有按 section/visual slot 标出 asset/public_search/web_asset_search/icon_search/code_procedural 覆盖方式')
  }
  if (itemCount >= 3 && !coverageText.includes('public_search') && !coverageText.includes('web_asset_search') && !coverageText.includes('icon_search')) {
    issues.push('资产计划没有记录公共素材/图标/网络资产检索路径；通用图片和图标不应全部依赖重新生成')
  }
  if (referenceCount >= 3 && reusableSearchSlotCount < 1) {
    issues.push('没有为可复用素材记录 public_search/web_asset_search/icon_search 槽位；例如作品展示摄影图、通用图标或字体/公网素材应先搜索再决定是否生成')
  }
  if (itemCount >= 3 && distinctAspectCategories.size <= 1 && distinctAspectCategories.has('wide')) {
    issues.push('资产比例过于单一，不能全部都是宽图背景板；需要拆出前景主体、透明主体或更贴合角色的比例')
  }
  if (itemCount >= 3 && hasOnlyBackgroundAssets) {
    issues.push('资产角色过于粗糙，不能只返回背景类资产；需要把 hero 主体、产品主体或 section 重点主体单独拆出来')
  }
  if (hasForegroundAsset && !hasTransparentForeground && aspectCategories.every((category) => category === 'wide')) {
    issues.push('存在前景主体角色，但没有透明前景资产且全部都是宽图；需要把主视觉主体拆成可叠放的独立资产')
  }
  if (hasSparseAssetDescriptors) {
    issues.push('部分资产描述过于稀薄；每个资产都需要更具体的 prompt、至少 2 条 mustKeep 和至少 1 条 avoid')
  }
  if (aggregateGeneratedGallerySlots.length > 0 || aggregateGeneratedGalleryItems.length > 0) {
    issues.push('gallery/作品墙不能作为一整张 generate 资产；必须按每个可见 tile/card 拆成独立 visualSlots，并让最终代码逐格引用不同资产或公网 URL')
  }
  if (hasGalleryEvidence && expectedGalleryTileCount && gallerySlots.length < expectedGalleryTileCount) {
    issues.push(`gallery visualSlots 数量不足；检测到约 ${expectedGalleryTileCount} 个可见 tile/card，但只规划了 ${gallerySlots.length} 个 gallery 槽位`)
  }
  if (hasGalleryEvidence && repeatedAggregateGalleryAssetIds.size > 0 && gallerySlots.length > repeatedAggregateGalleryAssetIds.size && gallerySlots.length >= 4) {
    issues.push('gallery 多个 tile/card 不能共用同一个 generate assetId；需要逐格搜索公网图片或逐张生成独立资产')
  }
  if (hasShowcaseGalleryEvidence && gallerySlots.length >= 3 && gallerySearchSlotCount < Math.min(3, gallerySlots.length)) {
    issues.push('摄影/作品集/案例展示类 gallery 应优先为每个 tile 规划 public_search 或 web_asset_search，不应默认全部 AI 生图')
  }

  return issues
}

export function buildGeneratedAssetUrlToken(assetId: string): string {
  return `__WEB_ASSET_URL_${assetId.replace(/[^a-zA-Z0-9_-]/g, '_')}__`
}

export function listUnusedWebPageGeneratedAssetIds(
  result: Pick<WebPageCodeGenerationResult, 'html' | 'css' | 'documentHtml'>,
  assets: WebPageGeneratedAsset[],
): string[] {
  const combined = [result.html, result.css, result.documentHtml].join('\n')
  return assets
    .filter((asset) => !combined.includes(buildGeneratedAssetUrlToken(asset.id)))
    .map((asset) => asset.id)
}

function summarizeGeneratedAssetsForPrompt(assets: WebPageGeneratedAsset[]): Array<Omit<WebPageGeneratedAsset, 'url'> & { urlToken: string }> {
  return assets.slice(0, 12).map((asset) => ({
    id: asset.id,
    sourceNodeId: asset.sourceNodeId,
    urlToken: buildGeneratedAssetUrlToken(asset.id),
    name: compactText(asset.name, 120),
    aspectRatio: asset.aspectRatio,
    transparentPng: asset.transparentPng,
  }))
}

function summarizeRefinementPlanForPrompt(plan: WebPageRefinementPlan | null): WebPageRefinementPlan | null {
  if (!plan) return null
  return {
    summary: compactText(plan.summary, 260),
    changeMode: plan.changeMode,
    requiresAssetRegeneration: plan.requiresAssetRegeneration,
    styleDirectives: compactStringList(plan.styleDirectives, 8, 220),
    preserveDirectives: compactStringList(plan.preserveDirectives, 8, 220),
    assetActions: plan.assetActions.slice(0, 8).map((action) => ({
      assetId: compactText(action.assetId, 120),
      reason: compactText(action.reason, 220),
      prompt: compactText(action.prompt, 320),
    })),
  }
}

function buildPromptCodeBlock(label: string, content: string): string {
  return [`<${label}>`, content, `</${label}>`].join('\n')
}

function buildPromptContext(
  context: WebPageCodeGenerationContext,
  options?: WebPageCurrentPagePromptOptions,
): unknown {
  const currentPageMode: WebPageCurrentPagePromptMode =
    options?.currentPageMode === 'session_history' ? 'session_history' : 'inline'
  const isCodegenCompact = options?.promptDetailMode === 'codegen_compact'
  return {
    styleBible: compactStringList(context.styleBible, isCodegenCompact ? 8 : 10, isCodegenCompact ? 170 : 220),
    brandPatternSeed: compactStringList(context.brandPatternSeed, isCodegenCompact ? 6 : 10, isCodegenCompact ? 170 : 220),
    refinementAttachments: summarizeWebHeroRefinementAttachmentsForPrompt(context.refinementAttachments),
    request: {
      ...context.request,
      prompt: compactText(context.request.prompt, isCodegenCompact ? 520 : 900),
      label: compactText(context.request.label, 120),
      target: compactText(context.request.target, isCodegenCompact ? 220 : 360),
    },
    media: isCodegenCompact ? summarizeMediaForCodegenPrompt(context.media) : summarizeMediaForPrompt(context.media),
    referenceScreenshots: isCodegenCompact
      ? summarizeReferenceScreenshotsForCodegenPrompt(context.referenceScreenshots)
      : context.referenceScreenshots.slice(0, 6).map(summarizeScreenshotForPrompt),
    copy: context.copy,
    screenshotAnalysis: isCodegenCompact
      ? summarizeAnalysisForCodegenPrompt(context.screenshotAnalysis)
      : summarizeAnalysisForPrompt(context.screenshotAnalysis),
    assetPlan: isCodegenCompact
      ? summarizeAssetPlanForCodegenPrompt(context.assetPlan)
      : summarizeAssetPlanForPrompt(context.assetPlan),
    generatedAssets: summarizeGeneratedAssetsForPrompt(context.generatedAssets),
    refinementPlan: summarizeRefinementPlanForPrompt(context.refinementPlan),
    currentPage: context.currentPage && context.refinementAttachments.length > 0
      ? (
          currentPageMode === 'session_history'
            ? {
                mode: 'session-history-baseline',
                pageHash: options?.currentPageHash || 'unknown',
                htmlRef: 'already-in-this-session-history',
                cssRef: 'already-in-this-session-history',
                documentRef: 'already-in-this-session-history',
              }
            : {
                mode: 'existing-page-edit',
                htmlRef: 'see-current-page-html-block',
                cssRef: 'see-current-page-css-block',
                documentRef: 'see-current-page-document-block',
              }
        )
      : null,
    designGuidelines: compactStringList(
      context.designGuidelines,
      isCodegenCompact ? 5 : WEB_PROMPT_GUIDELINE_LIMIT,
      isCodegenCompact ? 140 : WEB_PROMPT_LIST_ITEM_LIMIT,
    ),
    generationWorkflow: compactStringList(
      context.generationWorkflow,
      isCodegenCompact ? 4 : WEB_PROMPT_GUIDELINE_LIMIT,
      isCodegenCompact ? 130 : WEB_PROMPT_LIST_ITEM_LIMIT,
    ),
    outputContract: context.outputContract,
  }
}

export function replaceWebPageAssetUrlTokens(text: string, assets: WebPageGeneratedAsset[]): string {
  let next = text
  for (const asset of assets) {
    const token = buildGeneratedAssetUrlToken(asset.id)
    next = next.split(token).join(asset.url)
  }
  return next
}

function replaceResolvedAssetUrlsWithTokens(text: string, assets: WebPageGeneratedAsset[]): string {
  let next = text
  for (const asset of assets) {
    if (!asset.url) continue
    const token = buildGeneratedAssetUrlToken(asset.id)
    next = next.split(asset.url).join(token)
  }
  return next
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readCurrentWebPageCode(record: UnknownRecord): WebPageCurrentCode | null {
  const html = readString(record.webHeroHtml)
  const css = readString(record.webHeroCss)
  const documentHtml = readString(record.webHeroDocumentHtml)
  if (!html || !css || !documentHtml) return null
  return {
    html,
    css,
    documentHtml,
  }
}

function readGeneratedAssetsFromData(value: unknown): WebPageGeneratedAsset[] {
  if (!Array.isArray(value)) return []
  const assets: WebPageGeneratedAsset[] = []
  value.forEach((item) => {
    if (!isRecord(item)) return
    const id = readString(item.id)
    const sourceNodeId = readString(item.sourceNodeId)
    const url = readString(item.url)
    const name = readString(item.name)
    const aspectRatio = readString(item.aspectRatio)
    if (!id || !sourceNodeId || !url || !name || !aspectRatio) return
    assets.push({
      id,
      sourceNodeId,
      url,
      name,
      aspectRatio,
      transparentPng: readBoolean(item.transparentPng),
    })
  })
  return assets
}

export function buildWebPageDocumentHtmlFromParts(input: { html: string; css: string }): string {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '  <title>JarvisHub WebHero</title>',
    '  <style>',
    input.css.split('\n').map((line) => `    ${line}`).join('\n'),
    '  </style>',
    '</head>',
    '<body>',
    input.html.split('\n').map((line) => `  ${line}`).join('\n'),
    '</body>',
    '</html>',
  ].join('\n')
}

function readFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.round(numeric)
}

function resolveAspectRatio(width: number | null, height: number | null): string | null {
  if (!width || !height) return null
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const divisor = gcd(width, height)
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
}

function readResultUrl(value: unknown, preferredIndex: unknown): string {
  if (!Array.isArray(value)) return ''
  const indexNumber = typeof preferredIndex === 'number' ? preferredIndex : Number(preferredIndex)
  const index = Number.isFinite(indexNumber) ? Math.max(0, Math.floor(indexNumber)) : 0
  const preferred = value[index]
  if (isRecord(preferred)) {
    const preferredUrl = readString(preferred.url)
    if (preferredUrl) return preferredUrl
  }
  for (const item of value) {
    if (!isRecord(item)) continue
    const url = readString(item.url)
    if (url) return url
  }
  return ''
}

function readResultItem(value: unknown, preferredIndex: unknown): UnknownRecord | null {
  if (!Array.isArray(value)) return null
  const indexNumber = typeof preferredIndex === 'number' ? preferredIndex : Number(preferredIndex)
  const index = Number.isFinite(indexNumber) ? Math.max(0, Math.floor(indexNumber)) : 0
  const preferred = value[index]
  if (isRecord(preferred) && readString(preferred.url)) return preferred
  for (const item of value) {
    if (isRecord(item) && readString(item.url)) return item
  }
  return null
}

function readNodeLabel(node: Node): string {
  const data = isRecord(node.data) ? node.data : {}
  return readString(data.label) || String(node.id)
}

function readPrimaryVideoUrl(data: UnknownRecord): string {
  return readString(data.videoUrl) || readResultUrl(data.videoResults, data.videoPrimaryIndex)
}

function readPrimaryImageUrl(data: UnknownRecord): string {
  return readString(data.imageUrl) || readResultUrl(data.imageResults, data.imagePrimaryIndex)
}

function readAssetDimensions(data: UnknownRecord, resultItem: UnknownRecord | null): { width: number | null; height: number | null } {
  const width =
    readFiniteNumber(resultItem?.width) ??
    readFiniteNumber(resultItem?.naturalWidth) ??
    readFiniteNumber(resultItem?.imageWidth) ??
    readFiniteNumber(data.imageWidth) ??
    readFiniteNumber(data.width)
  const height =
    readFiniteNumber(resultItem?.height) ??
    readFiniteNumber(resultItem?.naturalHeight) ??
    readFiniteNumber(resultItem?.imageHeight) ??
    readFiniteNumber(data.imageHeight) ??
    readFiniteNumber(data.height)
  return { width, height }
}

function readMediaMeaning(data: UnknownRecord): string {
  const candidates = [
    data.webImageMeaning,
    data.imageMeaning,
    data.visualMeaning,
    data.description,
    data.prompt,
    data.structuredPrompt,
  ]
  for (const value of candidates) {
    const text = readString(value)
    if (text) return text
  }
  return ''
}

function pickNodeMediaAsset(node: Node): WebHeroMediaAsset | null {
  const data = isRecord(node.data) ? node.data : {}
  const sourceLabel = readNodeLabel(node)
  const videoItem = readResultItem(data.videoResults, data.videoPrimaryIndex)
  const videoUrl = readPrimaryVideoUrl(data)
  if (videoUrl) {
    const { width, height } = readAssetDimensions(data, videoItem)
    return {
      kind: 'video',
      url: videoUrl,
      sourceNodeId: String(node.id),
      sourceLabel,
      prompt: readString(data.prompt),
      meaning: readMediaMeaning(data) || sourceLabel,
      width,
      height,
      aspectRatio: resolveAspectRatio(width, height),
    }
  }
  const imageItem = readResultItem(data.imageResults, data.imagePrimaryIndex)
  const imageUrl = readPrimaryImageUrl(data)
  if (imageUrl) {
    const { width, height } = readAssetDimensions(data, imageItem)
    return {
      kind: 'image',
      url: imageUrl,
      sourceNodeId: String(node.id),
      sourceLabel,
      prompt: readString(data.prompt),
      meaning: readMediaMeaning(data) || sourceLabel,
      width,
      height,
      aspectRatio: resolveAspectRatio(width, height),
    }
  }
  return null
}

function readOrderingNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function readMediaOrder(node: Node, fallbackIndex: number): number {
  const data = isRecord(node.data) ? node.data : {}
  return (
    readOrderingNumber(data.webScreenshotOrder) ??
    readOrderingNumber(data.screenshotOrder) ??
    readOrderingNumber(data.pageOrder) ??
    readOrderingNumber(data.order) ??
    fallbackIndex
  )
}

export function resolveWebHeroMediaAssets(nodes: Node[], edges: Edge[], targetNodeId: string): WebHeroMediaAsset[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const))
  const inboundEdges = edges.filter((edge) => edge.target === targetNodeId)
  const inboundAssets: Array<{ asset: WebHeroMediaAsset; order: number; y: number; x: number; edgeIndex: number }> = []
  const seenSourceIds = new Set<string>()

  inboundEdges.forEach((edge, edgeIndex) => {
    const sourceNode = nodesById.get(edge.source)
    if (!sourceNode) return
    const sourceData = isRecord(sourceNode.data) ? sourceNode.data : {}
    if (readString(sourceData.webPageAssetForNodeId) === targetNodeId) return
    const asset = pickNodeMediaAsset(sourceNode)
    if (!asset) return
    seenSourceIds.add(sourceNode.id)
    inboundAssets.push({
      asset,
      order: readMediaOrder(sourceNode, edgeIndex),
      y: typeof sourceNode.position?.y === 'number' ? sourceNode.position.y : 0,
      x: typeof sourceNode.position?.x === 'number' ? sourceNode.position.x : 0,
      edgeIndex,
    })
  })

  const previewBoundIndexBase = inboundEdges.length
  nodes.forEach((node, fallbackIndex) => {
    if (seenSourceIds.has(node.id)) return
    if (node.id === targetNodeId) return
    const data = isRecord(node.data) ? node.data : {}
    if (readString(data.webPreviewForNodeId) !== targetNodeId) return
    if (readString(data.webPageAssetForNodeId) === targetNodeId) return
    const asset = pickNodeMediaAsset(node)
    if (!asset) return
    seenSourceIds.add(node.id)
    inboundAssets.push({
      asset,
      order: readMediaOrder(node, previewBoundIndexBase + fallbackIndex),
      y: typeof node.position?.y === 'number' ? node.position.y : 0,
      x: typeof node.position?.x === 'number' ? node.position.x : 0,
      edgeIndex: previewBoundIndexBase + fallbackIndex,
    })
  })

  const sortedInboundAssets = inboundAssets
    .sort((left, right) =>
      left.order - right.order ||
      left.y - right.y ||
      left.x - right.x ||
      left.edgeIndex - right.edgeIndex,
    )
    .map((item) => item.asset)

  if (sortedInboundAssets.length) return sortedInboundAssets

  const targetNode = nodesById.get(targetNodeId)
  if (!targetNode) return []
  const ownAsset = pickNodeMediaAsset(targetNode)
  return ownAsset ? [ownAsset] : []
}

export function resolveWebHeroMediaAsset(nodes: Node[], edges: Edge[], targetNodeId: string): WebHeroMediaAsset | null {
  const assets = resolveWebHeroMediaAssets(nodes, edges, targetNodeId)
  const inboundVideo = assets.find((asset) => asset.kind === 'video')
  if (inboundVideo) return inboundVideo
  return assets.find((asset) => asset.kind === 'image') || null
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;')
}

function cssUrl(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '')
}

function normalizeLineList(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function resolveWebPageStyleBible(data: unknown): string[] {
  const record = isRecord(data) ? data : {}
  const raw = record.webVisualStyleBible ?? record.webPageStyleBible ?? record.webDesignStyleBible
  if (Array.isArray(raw)) {
    return raw.map((item) => readString(item)).filter(Boolean).slice(0, 12)
  }
  const text = readString(raw)
  if (text) {
    return text.split(/\n+/).map((item) => item.trim()).filter(Boolean).slice(0, 12)
  }
  const template = readString(record.webDesignTemplate)
  const intent = readString(record.webDesignIntent)
  return [
    template ? `template: ${template}` : 'template: infer from user request and screenshots',
    intent ? `intent: ${intent}` : 'intent: keep all generated screenshots within one coherent website design system',
    'all screenshots and final webpage must share one themeMode, color token set, typography mood, radius/shadow/material, icon style, image treatment, and spacing rhythm',
  ]
}

function resolveWebHeroCopy(data: unknown): WebHeroCopy {
  const record = isRecord(data) ? data : {}
  const lines = normalizeLineList(record.prompt)
  return {
    eyebrow: readString(record.webHeroEyebrow) || lines[0] || DEFAULT_COPY.eyebrow,
    title: readString(record.webHeroTitle) || lines[1] || readString(record.label) || DEFAULT_COPY.title,
    subtitle: readString(record.webHeroSubtitle) || lines.slice(2).join(' ') || DEFAULT_COPY.subtitle,
    primaryCta: readString(record.webHeroPrimaryCta) || DEFAULT_COPY.primaryCta,
    secondaryCta: readString(record.webHeroSecondaryCta) || DEFAULT_COPY.secondaryCta,
  }
}

function buildHeroHtml(copy: WebHeroCopy, media: WebHeroMediaAsset): string {
  const mediaMarkup =
    media.kind === 'video'
      ? `<video class="tc-hero-media" src="${escapeAttribute(media.url)}" autoplay muted loop playsinline aria-hidden="true"></video>`
      : `<img class="tc-hero-media" src="${escapeAttribute(media.url)}" alt="" aria-hidden="true" />`

  return [
    '<section class="tc-aigc-hero">',
    `  ${mediaMarkup}`,
    '  <div class="tc-hero-shade" aria-hidden="true"></div>',
    '  <div class="tc-hero-content">',
    `    <p class="tc-hero-eyebrow">${escapeHtml(copy.eyebrow)}</p>`,
    `    <h1 class="tc-hero-title">${escapeHtml(copy.title)}</h1>`,
    `    <p class="tc-hero-subtitle">${escapeHtml(copy.subtitle)}</p>`,
    '    <div class="tc-hero-actions">',
    `      <a class="tc-hero-primary" href="#">${escapeHtml(copy.primaryCta)}</a>`,
    `      <a class="tc-hero-secondary" href="#">${escapeHtml(copy.secondaryCta)}</a>`,
    '    </div>',
    '  </div>',
    '</section>',
  ].join('\n')
}

function buildHeroCss(media: WebHeroMediaAsset): string {
  const imageFallback = media.kind === 'image'
    ? `background-image: linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.54)), url("${cssUrl(media.url)}");`
    : ''

  return [
    ':root {',
    '  --tc-hero-text: #ffffff;',
    '  --tc-hero-muted: rgba(255, 255, 255, 0.78);',
    '  --tc-hero-accent: #0071e3;',
    '}',
    '',
    '.tc-aigc-hero {',
    '  position: relative;',
    '  min-height: min(760px, 92vh);',
    '  overflow: hidden;',
    '  display: flex;',
    '  align-items: end;',
    '  justify-content: center;',
    '  padding: clamp(72px, 10vw, 120px) 24px 56px;',
    '  color: var(--tc-hero-text);',
    '  background-color: #000000;',
    `  ${imageFallback}`,
    '  background-size: cover;',
    '  background-position: center;',
    '}',
    '',
    '.tc-hero-media {',
    '  position: absolute;',
    '  inset: 0;',
    '  width: 100%;',
    '  height: 100%;',
    '  object-fit: cover;',
    '}',
    '',
    '.tc-hero-shade {',
    '  position: absolute;',
    '  inset: 0;',
    '  background: linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.24) 42%, rgba(0,0,0,0.72) 100%);',
    '}',
    '',
    '.tc-hero-content {',
    '  position: relative;',
    '  z-index: 1;',
    '  width: min(980px, 100%);',
    '  text-align: center;',
    '}',
    '',
    '.tc-hero-eyebrow {',
    '  margin: 0 0 14px;',
    '  font: 600 13px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;',
    '  letter-spacing: 0;',
    '  text-transform: uppercase;',
    '  color: var(--tc-hero-muted);',
    '}',
    '',
    '.tc-hero-title {',
    '  margin: 0;',
    '  font: 700 72px/0.98 Inter, ui-sans-serif, system-ui, sans-serif;',
    '  letter-spacing: 0;',
    '}',
    '',
    '.tc-hero-subtitle {',
    '  max-width: 720px;',
    '  margin: 22px auto 0;',
    '  font: 500 21px/1.36 Inter, ui-sans-serif, system-ui, sans-serif;',
    '  letter-spacing: 0;',
    '  color: var(--tc-hero-muted);',
    '}',
    '',
    '.tc-hero-actions {',
    '  display: flex;',
    '  justify-content: center;',
    '  gap: 12px;',
    '  flex-wrap: wrap;',
    '  margin-top: 30px;',
    '}',
    '',
    '.tc-hero-primary,',
    '.tc-hero-secondary {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  min-height: 42px;',
    '  padding: 0 18px;',
    '  border-radius: 999px;',
    '  font: 600 15px/1 Inter, ui-sans-serif, system-ui, sans-serif;',
    '  text-decoration: none;',
    '}',
    '',
    '.tc-hero-primary {',
    '  background: var(--tc-hero-accent);',
    '  color: #ffffff;',
    '}',
    '',
    '.tc-hero-secondary {',
    '  color: #ffffff;',
    '  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.42);',
    '}',
    '',
    '@media (max-width: 640px) {',
    '  .tc-aigc-hero {',
    '    align-items: center;',
    '    min-height: 720px;',
    '    padding: 72px 18px 44px;',
    '  }',
    '  .tc-hero-title {',
    '    font-size: 44px;',
    '  }',
    '  .tc-hero-subtitle {',
    '    font-size: 17px;',
    '  }',
    '}',
  ].join('\n')
}

export function buildWebHeroCode(input: { data: unknown; media: WebHeroMediaAsset }): WebHeroBuildResult {
  const copy = resolveWebHeroCopy(input.data)
  const html = buildHeroHtml(copy, input.media)
  const css = buildHeroCss(input.media)
  const documentHtml = ['<!doctype html>', '<html lang="zh-CN">', '<head>', '  <meta charset="utf-8" />', '  <meta name="viewport" content="width=device-width, initial-scale=1" />', '  <title>JarvisHub Hero</title>', '  <style>', css.split('\n').map((line) => `    ${line}`).join('\n'), '  </style>', '</head>', '<body>', html.split('\n').map((line) => `  ${line}`).join('\n'), '</body>', '</html>'].join('\n')
  return {
    html,
    css,
    documentHtml,
    media: input.media,
    copy,
  }
}

export function buildWebPageCodeGenerationContext(input: { data: unknown; media: WebHeroMediaAsset; referenceScreenshots?: WebHeroMediaAsset[] }): WebPageCodeGenerationContext {
  const record = isRecord(input.data) ? input.data : {}
  const copy = resolveWebHeroCopy(record)
  const prompt = readString(record.prompt)
  const label = readString(record.label) || '网页代码'
  const styleBible = resolveWebPageStyleBible(record)
  const currentPage = readCurrentWebPageCode(record)
  const cachedGeneratedAssets = readGeneratedAssetsFromData(record.webPageGeneratedAssets)
  return {
    styleBible,
    brandPatternSeed: buildBrandPatternSeed(record),
    refinementAttachments: readWebHeroRefinementAttachments(record.webHeroRefinementAttachments),
    request: {
      prompt,
      label,
      pageKind: 'landing_page',
      target: readString(record.webPageTarget) || '生成一个完整、可预览、可下载的产品落地页网页代码。',
    },
    media: input.media,
    referenceScreenshots: Array.isArray(input.referenceScreenshots) ? input.referenceScreenshots : [input.media],
    copy,
    screenshotAnalysis: null,
    assetPlan: null,
    generatedAssets: cachedGeneratedAssets,
    currentPage: currentPage
      ? {
          html: replaceResolvedAssetUrlsWithTokens(currentPage.html, cachedGeneratedAssets),
          css: replaceResolvedAssetUrlsWithTokens(currentPage.css, cachedGeneratedAssets),
          documentHtml: replaceResolvedAssetUrlsWithTokens(currentPage.documentHtml, cachedGeneratedAssets),
        }
      : null,
    refinementPlan: null,
    designGuidelines: WEB_PAGE_DESIGN_GUIDELINES,
    generationWorkflow: WEB_PAGE_GENERATION_WORKFLOW,
    outputContract: {
      format: 'json',
      requiredFields: ['html', 'css', 'documentHtml', 'pagePlan', 'assetUsage', 'notes'],
    },
  }
}

export function withWebPageScreenshotAnalysis(
  context: WebPageCodeGenerationContext,
  screenshotAnalysis: WebPageScreenshotAnalysis,
): WebPageCodeGenerationContext {
  return {
    ...context,
    screenshotAnalysis,
  }
}

export function buildWebPageScreenshotAnalysisPrompt(context: WebPageCodeGenerationContext): string {
  return [
    '你是 JarvisHub 的网页截图视觉取证 agent。请仔细分析上游网页设计截图，输出可供网页代码生成复刻的结构化视觉细节。',
    '',
    '分析目标：',
    '- 把提供的网页截图视为主要视觉事实源，而不是灵感 moodboard。先做图像参考分析，再抽设计系统，再产出实现导向的观察。',
    '- 若存在多张截图，先判断每张图是 full-page / section-level / detail / supporting reference 中的哪一种，并把它们视为同一网站的连续证据。',
    '- 把截图中的视觉事实文本化：布局比例、模块边界、图片与文字关系、圆角、渐变、阴影、层级、间距、对齐、字体尺度。',
    '- 必须先抽取统一 styleBible：themeMode、primary background、surface/card color、accent colors、typography mood、radius/shadow/material、icon style、image treatment、spacing rhythm。',
    '- 如果截图中有可辨认的导航、标题、CTA 或 section heading，请尽量提取这些可读文本；若无法确认，请写“未能从截图确认”，不要猜。',
    '- 若多张截图之间出现深浅主题跳变、字体气质突变、组件 token 不一致，应在 consistencyWarnings 中指出，并在 implementationPriorities 中要求以 Hero/首屏与 styleBible 为准统一。',
    '- 不要评价好坏，不要泛泛而谈，不要复述用户需求；只输出对还原网页有帮助的观察。',
    '- 不要把截图替换成更方便实现的 generic redesign；分析必须服务于高保真还原。',
    '- 不要建议直接复用整张截图，不要把截图裁切成网页素材。',
    '- 若某些细节无法确定，请写“未能从截图确认”，不要猜。',
    '- 输出必须是严格 JSON，不要 Markdown，不要代码块围栏，不要解释。',
    '',
    '输入上下文 JSON：',
    JSON.stringify({
      request: context.request,
      brandPatternSeed: summarizeBrandPatternSeed(context.brandPatternSeed),
      styleBible: compactStringList(context.styleBible, 10, 220),
      media: summarizeMediaForPrompt(context.media),
      referenceScreenshots: context.referenceScreenshots.slice(0, 6).map(summarizeScreenshotForPrompt),
      copy: context.copy,
      screenshotAnalysis: context.screenshotAnalysis,
      designGuidelines: context.designGuidelines,
    }, null, 2),
    '',
    '输出 JSON schema：',
    JSON.stringify({
      summary: '一句话总结截图的主要版式与视觉气质',
      styleBible: ['同一网站必须共享的 themeMode、背景、surface、accent、字体、圆角、阴影、图标、图片处理、间距 token'],
      consistencyWarnings: ['如果多张截图之间存在风格漂移或主题跳变，在这里指出；没有则返回空数组'],
      layout: ['首屏/导航/主体/下方 section 的网格关系、宽高比例、主要元素占比'],
      spacing: ['边距、间距、留白节奏、内容对齐方式'],
      typography: ['标题/副标题/正文/按钮的字号层级、字重、行高、字距、文本密度'],
      colorAndGradient: ['背景色、渐变方向、色块关系、强调色、透明度关系'],
      imageTreatment: ['图片裁切方式、透明背景、叠放层级、混合模式、阴影、边缘处理'],
      shapeAndRadius: ['卡片/按钮/图片容器/面板的圆角、边框、分隔线、阴影'],
      componentDetails: ['导航、CTA、卡片、时间线、统计块、图标、标签等组件细节'],
      responsiveNotes: ['桌面优先实现方式，以及移动端断点应如何保持原意'],
      implementationPriorities: ['生成 HTML/CSS 时最必须还原的 5-8 个视觉要点'],
    }, null, 2),
  ].join('\n')
}

export function withWebPageAssetPlan(context: WebPageCodeGenerationContext, assetPlan: WebPageAssetPlan): WebPageCodeGenerationContext {
  return {
    ...context,
    assetPlan,
  }
}

export function withWebPageGeneratedAssets(
  context: WebPageCodeGenerationContext,
  generatedAssets: WebPageGeneratedAsset[],
): WebPageCodeGenerationContext {
  return {
    ...context,
    generatedAssets,
    currentPage: context.currentPage
      ? {
          html: replaceResolvedAssetUrlsWithTokens(context.currentPage.html, generatedAssets),
          css: replaceResolvedAssetUrlsWithTokens(context.currentPage.css, generatedAssets),
          documentHtml: replaceResolvedAssetUrlsWithTokens(context.currentPage.documentHtml, generatedAssets),
        }
      : null,
  }
}

export function withWebPageRefinementPlan(
  context: WebPageCodeGenerationContext,
  refinementPlan: WebPageRefinementPlan,
): WebPageCodeGenerationContext {
  return {
    ...context,
    refinementPlan,
  }
}

export function buildWebPageAssetPlanPrompt(context: WebPageCodeGenerationContext): string {
  return [
    '你是 JarvisHub 的网页视觉资产规划 agent。请分析上游网页设计截图、多图视觉取证结果和用户需求，输出后续网站生成需要知道的独立图片资产计划。',
    '',
    '核心判断原则：',
    '- 上游图像是网页设计截图或视觉基准图，不是要被裁切复用的页面图片。',
    '- 只列出应该单独生成的图片资产：hero 主视觉、人物/产品图、章节插图、复杂背景纹理、品牌符号、需要透明背景的装饰物等。',
    '- 对复杂主视觉采用分层计划：背景/环境/场景单独列为 background_motif 或 photo；主体产品/人物/设备/车辆等单独列为 hero_object/product_mockup/portrait，并在需要叠放时设置 transparentPng=true。',
    '- 分层计划必须通用，不要只服务汽车；任何产品、硬件、人物、设备、艺术主体或场景化主视觉都适用。',
    '- 不要把普通 HTML 组件列为图片资产，例如导航、按钮、卡片、表格、时间线、文本排版、普通渐变背景。',
    '- 通用 UI 图标不进入图片资产清单；后续网页代码应优先使用 Iconify SVG URL。复杂定制图标/品牌符号才可列为 logo_mark。',
    '- 如页面需要图标，请在 iconStrategy 中给出英文关键词归一化建议，例如 手机图标 -> smartphone / phone / mobile。',
    '- 可以根据用户目标补充截图下方 sections 需要的 supporting assets，但必须说明用途。',
    '- 必须按 section 做 visual slot 覆盖：凡是预览图里出现的独立图片位、人物/生活方式图片、产品场景图、设备 UI mockup、插图或大面积媒体位，都要在 coverageChecklist 中逐项标记为 asset、public_search、existing_canvas 或 code_procedural；不能只覆盖 hero 后漏掉中段卡片图片。',
    '- 对老人、儿童、睡眠、家庭、办公室、天气、气温、遥控器、车辆示意、通用服务图标等非精确品牌主体，优先规划为 public_search / web_asset_search / icon_search 可复用素材；只有找不到合适素材或需要强品牌一致性时才生成新图。',
    '- 先做 coverage pass：对每张截图里的主要可见视觉主体做清点，然后再决定哪些应该成为独立资产，哪些明确留给 HTML/CSS/SVG 实现。不要只规划 1-2 个显眼物体后就忽略其余关键视觉主体。',
    '- 每张参考截图都应该在 coverageChecklist 中被逐一点名，写清楚它对应的资产覆盖状态；不要只写一条泛泛的“已覆盖大部分视觉”。',
    '- 如果预览中出现 gallery / grid / masonry / carousel / photo wall / selected works / 作品墙 / 摄影集 / 多图片项目卡，必须按可见 tile/card 拆分 visualSlots：3x3 gallery 至少输出 9 个独立 slot，2x3 至少 6 个。禁止把整张 gallery 作为一个 generate asset 或一张整体拼图。',
    '- 摄影、个人作品集、案例展示、艺术作品墙、作品集项目卡等展示类 gallery 默认优先用 public_search / web_asset_search / canvas_web_style_reference_search 找公网图片；每个 tile 必须有独立 searchQuery，搜索词要体现每张图的内容差异。只有用户明确要求原创或具体品牌主体无法搜索时，才允许逐张生成独立图片；永远不要生成一张包含多个格子的 gallery 合成图。',
    '- gallery 类型的 visualSlots 不需要都进入 items：如果 implementation 是 public_search / web_asset_search，assetId 可为 null，searchQuery 必须具体；只有 implementation=generate 的单张 tile 才需要对应 items 中的独立资产。',
    '- coverageChecklist 对 gallery 必须逐格记录，例如 `work/photo-01 -> public_search:black and white fashion portrait`；不要写 `work/gallery -> generate:asset-gallery-grid` 这种整体覆盖。',
    '- 默认把资产数量控制在 6-12 个；不要为了省事漏掉明显需要独立生成或检索复用的产品主体、设备 UI mockup、人物/生活方式图片、场景插图、品牌符号或复杂环境层，也不要把每个小图标都拆成独立图片资产。',
    '- 如果多个 section 明显依赖不同图片主体，不要把它们粗暴合并成一个大而泛的 hero asset；要按可复用层或 section 职责拆分。',
    '- 不要让所有资产都变成同一种宽图背景。只要页面里存在可独立叠放的主体，就应拆出前景主体、背景环境和 section 级辅助图三种角色里至少两种。',
    '- 16:9 只适合横向背景板、全景环境或 banner。若资产是独立主体、透明叠放主体、头像、产品件、徽标、装置、设备 UI 近景或局部插图，优先使用 1:1、4:5、3:4 或更适合主体的比例，不要默认全部给 16:9。',
    '- 对复杂主视觉要强制分层：背景/环境/场景单独列为 background_motif 或 photo；主体产品/人物/设备/车辆等单独列为 hero_object/product_mockup/portrait，并在需要叠放时设置 transparentPng=true。',
    '- 如果 asset plan 里出现 hero_object / portrait / product_mockup / logo_mark 这类前景角色，至少要有一个真正可叠放的透明前景资产，而不是把它们也塞进宽图背景板。',
    '- 每个资产都要补充 2-5 条 mustKeep，写清楚必须保留的可观察视觉事实：主体形状、材质、光线、镜头角度、裁切方式、配色、发光/阴影、界面细节等。',
    '- 每个资产都要补充 1-4 条 avoid，明确容易跑偏的方向：错误材质、错误镜头、错误风格、错误背景、错误文字/logo 等。',
    '- 每个资产的 prompt 必须写到可直接用于图片生成：至少说明主体是什么、所处场景、材质/质感、光线/色温、构图或裁切方式，以及它在网页中的使用方式；不要只写“clean cutout”“wide backdrop”“nice illustration”这种空泛描述。',
    '- 每个资产的 prompt 需要有足够长度和信息密度，避免一两句话就结束；如果写不清楚，说明这个资产本身还没有拆细。',
    '- 只给比例，不给像素尺寸；比例用 16:9、4:3、1:1、3:4、9:16 等形式。',
    '- transparentPng 仅在需要抠图、悬浮主体、logo mark、装饰物叠加时为 true。',
    '- Prompt 要直接适合图片生成模型执行，避免提到“网页截图里的第几个元素”这种无法独立生成的指代。',
    '- implementationNotes 与 coverageChecklist 必须一起让后续代码生成知道：哪些视觉主体已经有独立资产，哪些应该继续用 HTML/CSS/SVG 实现。',
    '- coverageChecklist 不要只写“整体已覆盖”；至少要写出参考截图 01/02/03... 对应的资产覆盖结论，并指出哪些 section 仍应由 HTML/CSS/SVG 承担。',
    '- 如果没有必要单独生成图片，也要返回空 items 并说明原因。',
    '',
    '本轮个人作品集/Awwwards 预览的关键反例约束：',
    '- 不能只生成 1 个抽象素材并复用全站；这会破坏预览图风格一致性和素材语义。',
    '- Hero 若有大型棱镜/玻璃立方/3D 主视觉，应作为 hero_object 单独生成或分层生成，不能用泛 abstract texture 替代。',
    '- About 若有明显人物侧脸/肖像，应作为 portrait 单独生成；如果无真人授权图，生成一个风格一致的虚构人物肖像资产，不要改成 monogram 占位。',
    '- Work/Selected Work 若有三张作品展示图，应优先规划为 public_search/web_asset_search 查询候选，例如 abstract product sculpture、cinematic canyon neon portal、black and white fashion portrait；只有搜索失败或候选不贴合时才转生成。',
    '- Work/Portfolio 如果是 3x3 或 masonry gallery，要把每个作品 tile 拆成独立 public_search/web_asset_search 槽位；不能把九宫格整体生成成一张图片，也不能让最终代码九个格子都复用同一张图。',
    '- Contact 若主要是文字、分割线、金色符号和 email CTA，可大部分 code_procedural/icon_search；如果有明显品牌 monogram 或装饰符号，再规划 logo_mark/section_illustration。',
    '- 至少逐页有一个视觉槽位决策：Preview 1 Hero、Preview 2 About、Preview 3 Work、Preview 4 Contact 都必须在 visualSlots 和 coverageChecklist 中出现。',
    '- 输出必须是严格 JSON，不要 Markdown，不要代码块围栏，不要解释。',
    '',
    '输入上下文 JSON：',
    JSON.stringify({
      request: context.request,
      brandPatternSeed: summarizeBrandPatternSeed(context.brandPatternSeed),
      styleBible: compactStringList(
        context.screenshotAnalysis?.styleBible?.length ? context.screenshotAnalysis.styleBible : context.styleBible,
        10,
        220,
      ),
      media: summarizeMediaForPrompt(context.media),
      referenceScreenshots: context.referenceScreenshots.slice(0, 6).map(summarizeScreenshotForPrompt),
      screenshotAnalysis: context.screenshotAnalysis,
      copy: context.copy,
      designGuidelines: context.designGuidelines,
    }, null, 2),
    '',
    '输出 JSON schema：',
    JSON.stringify({
      summary: '一句话总结截图风格与资产拆分策略',
      visualSlots: [
        {
          sectionId: 'hero',
          screenshotOrder: 1,
          slotId: 'hero-prism-object',
          description: 'Hero 右侧大型半透明玻璃棱镜/3D 主视觉',
          implementation: 'generate | public_search | web_asset_search | icon_search | code_procedural | existing_canvas',
          assetId: 'asset-hero-prism',
          searchQuery: null,
          reason: '该槽位是预览首屏的核心非代码视觉主体，不能由 CSS 文本替代',
        },
      ],
      items: [
        {
          id: 'asset-hero-object',
          name: '中文资产名',
          role: 'hero_object | portrait | product_mockup | section_illustration | background_motif | logo_mark | photo | other',
          source: 'screenshot | supporting | public_search | web_asset_search | icon_search',
          placement: '计划放在哪个 section 或页面区域',
          prompt: '给图片生成模型的完整提示词',
          aspectRatio: '16:9',
          transparentPng: false,
          reason: '为什么它应该单独生成，而不是用 HTML/CSS 实现',
          mustKeep: ['必须保留的形状 / 材质 / 光线 / 镜头 / 裁切等关键视觉事实'],
          avoid: ['容易跑偏但必须避免的方向'],
        },
      ],
      iconStrategy: '通用图标先调用 icon_search / Iconify；将中文语义归一化为英文关键词后优先选择 lucide/tabler/ph/mdi/meteocons 等开源图标，不为通用 UI 图标生成图片或手写 SVG。',
      implementationNotes: ['给网站生成 agent 的资产引用建议'],
      coverageChecklist: ['sectionId/visualSlot -> generate:asset-id 或 public_search:web-search-query 或 web_asset_search:query 或 icon_search:icon-query 或 code_procedural:原因'],
    }, null, 2),
  ].join('\n')
}

export function buildWebPageAssetPlanRetryPrompt(input: {
  context: WebPageCodeGenerationContext
  failureReasons: string[]
  previousPlan: WebPageAssetPlan
}): string {
  return [
    '你是 JarvisHub 的网页视觉资产规划 agent。上一轮 asset plan 质量不合格，请在同一套截图证据上重新输出更细粒度、可执行的 JSON 资产计划。',
    '',
    '必须修正的问题：',
    ...input.failureReasons.map((reason) => `- ${reason}`),
    '',
    '重写要求：',
    '- 仍然遵守所有原始资产规划规则。',
    '- 不要沿用上一轮过于粗糙的宽图背景方案；必须把前景主体、背景环境、section 重点、品牌符号拆得更清楚。',
    '- 必须补全每个 section 的 visual slot；人物/生活方式图、设备界面、场景图、图标组、产品局部和 CTA 媒体位不能因为不是 hero 就被漏掉。',
    '- 普通图标优先 icon_search / Iconify；通用 lifestyle/photo/vector 资产优先 public_search 或 web_asset_search；不要规划成模型手写 SVG。',
    '- coverageChecklist 必须逐张覆盖所有参考截图，并清楚区分哪些部分已由资产承接，哪些仍由 HTML/CSS/SVG 承担。',
    '- visualSlots 必须是第一等输出：每张预览图至少一个 slot，slot 的 implementation 必须明确是 generate / public_search / web_asset_search / icon_search / code_procedural / existing_canvas。',
    '- generate slot 必须有 assetId 且 assetId 必须出现在 items 中；public_search/web_asset_search/icon_search slot 必须有 searchQuery。',
    '- 如果失败原因涉及 gallery/grid/masonry/carousel/作品墙/摄影集，必须把上一轮整体 gallery 资产拆成每个可见 tile/card 的 visualSlots；3x3 至少 9 个 slot，不能再返回 `asset-gallery-grid` 这种整图资产。',
    '- 展示类 gallery 的 tile 默认改为 public_search 或 web_asset_search，并为每个 tile 写不同 searchQuery；只有无法搜索的具体原创主体才允许逐张 generate。',
    '- 每个资产的 prompt 必须具体到主体、材质、光线、构图和网页用途；每个资产至少 2 条 mustKeep 和 1 条 avoid，不能用很短的通用描述糊过去。',
    '- 只输出新的完整 JSON，不要解释，不要复述失败原因。',
    '',
    '上一轮 asset plan：',
    JSON.stringify(summarizeAssetPlanForPrompt(input.previousPlan), null, 2),
    '',
    '输入上下文 JSON：',
    JSON.stringify({
      request: input.context.request,
      brandPatternSeed: summarizeBrandPatternSeed(input.context.brandPatternSeed),
      styleBible: compactStringList(
        input.context.screenshotAnalysis?.styleBible?.length ? input.context.screenshotAnalysis.styleBible : input.context.styleBible,
        10,
        220,
      ),
      media: summarizeMediaForPrompt(input.context.media),
      referenceScreenshots: input.context.referenceScreenshots.slice(0, 6).map(summarizeScreenshotForPrompt),
      screenshotAnalysis: input.context.screenshotAnalysis,
      copy: input.context.copy,
      designGuidelines: input.context.designGuidelines,
    }, null, 2),
    '',
    '输出 JSON schema：',
    JSON.stringify({
      summary: '一句话总结截图风格与资产拆分策略',
      visualSlots: [
        {
          sectionId: 'hero',
          screenshotOrder: 1,
          slotId: 'hero-prism-object',
          description: 'Hero 右侧大型半透明玻璃棱镜/3D 主视觉',
          implementation: 'generate | public_search | web_asset_search | icon_search | code_procedural | existing_canvas',
          assetId: 'asset-hero-prism',
          searchQuery: null,
          reason: '该槽位是预览首屏的核心非代码视觉主体，不能由 CSS 文本替代',
        },
      ],
      items: [
        {
          id: 'asset-hero-object',
          name: '中文资产名',
          role: 'hero_object | portrait | product_mockup | section_illustration | background_motif | logo_mark | photo | other',
          source: 'screenshot | supporting | public_search | web_asset_search | icon_search',
          placement: '计划放在哪个 section 或页面区域',
          prompt: '给图片生成模型的完整提示词',
          aspectRatio: '16:9',
          transparentPng: false,
          reason: '为什么它应该单独生成，而不是用 HTML/CSS 实现',
          mustKeep: ['必须保留的形状 / 材质 / 光线 / 镜头 / 裁切等关键视觉事实'],
          avoid: ['容易跑偏但必须避免的方向'],
        },
      ],
      iconStrategy: '通用图标先调用 icon_search / Iconify；将中文语义归一化为英文关键词后优先选择 lucide/tabler/ph/mdi/meteocons 等开源图标，不为通用 UI 图标生成图片或手写 SVG。',
      implementationNotes: ['给网站生成 agent 的资产引用建议'],
      coverageChecklist: ['sectionId/visualSlot -> generate:asset-id 或 public_search:web-search-query 或 web_asset_search:query 或 icon_search:icon-query 或 code_procedural:原因'],
    }, null, 2),
  ].join('\n')
}

export function buildWebPageRefinementPlanPrompt(
  context: WebPageCodeGenerationContext,
  options?: WebPageCurrentPagePromptOptions,
): string {
  const currentPageMode: WebPageCurrentPagePromptMode =
    options?.currentPageMode === 'session_history' ? 'session_history' : 'inline'
  return [
    '你是 JarvisHub 的网页调优决策 agent。当前任务不是从零生成网页，而是基于已经存在的网页代码和局部评论，判断应该如何修改。',
    '',
    '目标：',
    currentPageMode === 'session_history'
      ? '- 当前网页 HTML/CSS 已经作为同一条 codegen 对话中的较早网页结果存在；把那一版视为唯一修改基底，不要要求重新粘贴整页代码。'
      : '- 先阅读当前网页 HTML/CSS 与 refinementAttachments，判断每条评论是可以通过 HTML/CSS/原生 JS 调整完成，还是必须重生成已有图片资产。',
    '- 只有当评论明确要求改变图片主体内容、产品渲染、插图语义、品牌图形、照片本体或当前网页代码无法通过样式层实现时，才允许要求 asset regeneration。',
    '- 若需要重生成图片资产，只能复用已有 generatedAssets / assetPlan 中已经存在的 assetId；禁止新增 assetId，禁止要求重跑上游截图分析，禁止把整页推倒重来。',
    '- 若可以只改样式或结构，明确给出 style_only，并说明应该保留哪些现有结构、组件和 token。',
    '- 不要避重就轻：必须覆盖 refinementAttachments 的核心修改意图。',
    '- 输出必须是严格 JSON，不要 Markdown，不要代码块围栏，不要解释。',
    '',
    '输入上下文 JSON：',
    JSON.stringify(buildPromptContext(context, options), null, 2),
    ...(currentPageMode === 'session_history'
      ? [
          '',
          `当前网页基底签名：${options?.currentPageHash || 'unknown'}。请直接沿用本 session 较早消息中的网页代码作为修改基底。`,
        ]
      : [
          '',
          '当前网页 HTML（必须把它视为修改基底，而不是参考示意）：',
          buildPromptCodeBlock('current-page-html', context.currentPage?.html || ''),
          '',
          '当前网页 CSS（必须把它视为修改基底，而不是参考示意）：',
          buildPromptCodeBlock('current-page-css', context.currentPage?.css || ''),
        ]),
    '',
    '输出 JSON schema：',
    JSON.stringify({
      summary: '一句话总结本轮调优的修改方向',
      changeMode: 'style_only | asset_regeneration',
      requiresAssetRegeneration: false,
      styleDirectives: ['按评论真正需要执行的样式/结构修改动作'],
      preserveDirectives: ['必须保留的现有结构、组件、token、资产映射'],
      assetActions: [
        {
          assetId: '必须来自 generatedAssets / assetPlan.items 的已存在 assetId',
          reason: '为什么当前评论无法只靠样式层解决',
          prompt: '给该图片资产节点的新完整提示词；仅在需要重生该资产时填写',
        },
      ],
    }, null, 2),
  ].join('\n')
}

export function buildWebPageStyleOnlyPatchPrompt(
  context: WebPageCodeGenerationContext,
  options?: WebPageCurrentPagePromptOptions,
): string {
  const currentPageMode: WebPageCurrentPagePromptMode =
    options?.currentPageMode === 'session_history' ? 'session_history' : 'inline'
  const promptContext = {
    styleBible: compactStringList(context.styleBible, 10, 220),
    brandPatternSeed: compactStringList(context.brandPatternSeed, 10, 220),
    refinementAttachments: summarizeWebHeroRefinementAttachmentsForPrompt(context.refinementAttachments),
    request: {
      ...context.request,
      prompt: compactText(context.request.prompt, 900),
      label: compactText(context.request.label, 120),
      target: compactText(context.request.target, 360),
    },
    referenceScreenshots: context.referenceScreenshots.slice(0, 6).map(summarizeScreenshotForPrompt),
    screenshotAnalysis: summarizeAnalysisForPrompt(context.screenshotAnalysis),
    assetPlan: summarizeAssetPlanForPrompt(context.assetPlan),
    generatedAssets: summarizeGeneratedAssetsForPrompt(context.generatedAssets),
    refinementPlan: summarizeRefinementPlanForPrompt(context.refinementPlan),
    currentPage: currentPageMode === 'session_history'
      ? {
          mode: 'session-history-baseline',
          pageHash: options?.currentPageHash || 'unknown',
          htmlRef: 'already-in-this-session-history',
          cssRef: 'already-in-this-session-history',
        }
      : {
          mode: 'existing-page-edit',
          htmlRef: 'see-current-page-html-block',
          cssRef: 'see-current-page-css-block',
        },
  }
  return [
    '你是 JarvisHub 的网页局部编辑 agent。当前任务是基于现有网页代码和局部评论，只返回最小必要的 search/replace edits。',
    '',
    '关键要求：',
    currentPageMode === 'session_history'
      ? `- 当前网页完整代码已经在同一条 codegen session 的较早消息中给出；必须以该基底（pageHash=${options?.currentPageHash || 'unknown'}）返回局部 edits，不要要求重新贴整页代码。`
      : '- 当前网页 HTML/CSS 已随本轮上下文提供；必须把它们视为唯一编辑基底，不要另起炉灶重写整页。',
    '- 这是 style_only 修改：不要返回完整 html/css/documentHtml，不要重写整页，不要要求新增图片资产，不要改变 assetId / data-asset-id / urlToken 映射。',
    '- 只允许返回精确 search/replace edits；search 必须是当前基底里真实存在、逐字符完全匹配且唯一的原文片段。',
    '- 不要使用省略号、占位符、正则、模糊匹配、伪代码或“其余保持不变”之类描述。',
    '- 若需要插入新结构或新样式，使用 replace：把一个稳定锚点片段替换为“原片段 + 新内容”。',
    '- htmlEdits 与 cssEdits 会按数组顺序依次应用在演进中的文本上；后一个 edit 可以基于前一个 edit 的结果。',
    '- 优先改 CSS；只有评论明确涉及结构、文案层级、组件顺序或 DOM 语义时才改 HTML。',
    '- 必须逐条响应 refinementAttachments；notes 中简要说明每条关键评论如何落地。',
    '- 输出必须是严格 JSON，不要 Markdown，不要代码块围栏，不要解释。',
    '',
    '输入上下文 JSON：',
    JSON.stringify(promptContext, null, 2),
    ...(currentPageMode === 'session_history'
      ? [
          '',
          `当前网页基底签名：${options?.currentPageHash || 'unknown'}。请直接沿用本 session 较早消息中的 html/css 基底。`,
        ]
      : [
          '',
          '当前网页 HTML（edits 必须精确命中其中原文）：',
          buildPromptCodeBlock('current-page-html', context.currentPage?.html || ''),
          '',
          '当前网页 CSS（edits 必须精确命中其中原文）：',
          buildPromptCodeBlock('current-page-css', context.currentPage?.css || ''),
        ]),
    '',
    '输出 JSON schema：',
    JSON.stringify({
      summary: '一句话总结本轮局部修改',
      htmlEdits: [
        {
          search: '当前 HTML 中唯一且完整的原文片段',
          replace: '替换后的完整片段',
        },
      ],
      cssEdits: [
        {
          search: '当前 CSS 中唯一且完整的原文片段',
          replace: '替换后的完整片段',
        },
      ],
      notes: ['简要说明本轮 edits 如何落实评论'],
    }, null, 2),
  ].join('\n')
}

const ICONIFY_GUIDELINES = [
  'Iconify 图标协议：',
  '- 通用 UI 图标必须优先使用 Iconify 公开 SVG URL，不要手写粗糙 inline SVG，不要用截图裁切，不要为普通图标生成图片资产。',
  '- 先把中文图标需求归一化为英文关键词，再选择稳定图标 id。优先级：lucide:* 用于现代线性 UI；mdi:* 用于覆盖更广的通用符号；tabler:* 用于产品界面补充。',
  '- URL 格式为 https://api.iconify.design/{collection}/{icon}.svg?color=%23HEX&width=24&height=24，例如 https://api.iconify.design/lucide/smartphone.svg?color=%23000000&width=24&height=24。',
  '- 在 HTML 中用 <img class="site-icon" src="..." alt="" aria-hidden="true"> 或 CSS mask 使用这些 SVG；图标尺寸、颜色必须由 CSS 统一控制，保持全站一致。',
  '- 不要引用无法确定存在的冷门图标。常用优先候选包括 lucide/smartphone、lucide/rocket、lucide/brain-circuit、lucide/workflow、lucide/sparkles、lucide/shield-check、lucide/chart-line、lucide/play、lucide/arrow-right、mdi/robot-outline、mdi/car-electric、tabler/brand-x。',
  '- 品牌 logo、人物头像、产品主视觉、复杂装饰不属于通用 UI 图标，必须使用 generatedAssets 或纯 HTML/CSS 结构表达。',
].join('\n')

export function buildWebPageCodeGenerationPrompt(
  context: WebPageCodeGenerationContext,
  options?: WebPageCurrentPagePromptOptions,
): string {
  const hasRefinementAttachments = context.refinementAttachments.length > 0
  const hasCurrentPage = Boolean(context.currentPage?.html && context.currentPage?.css && context.currentPage?.documentHtml)
  const currentPageMode: WebPageCurrentPagePromptMode =
    options?.currentPageMode === 'session_history' ? 'session_history' : 'inline'
  return [
    hasRefinementAttachments && hasCurrentPage
      ? '你是 JarvisHub 的网页代码修改 agent。请基于当前已有网页代码、调优评论、上游 AIGC 资产事实和网页设计规范，返回修改后的完整网页代码。'
      : '你是 JarvisHub 的网页代码生成 agent。请根据用户需求、上游 AIGC 资产事实和网页设计规范，生成完整网页代码。',
    '',
    '关键要求：',
    ...(hasRefinementAttachments && hasCurrentPage
      ? [
          currentPageMode === 'session_history'
            ? `- 当前任务是修改已有网页，不是从零重写。当前网页完整代码已经在本 session 的较早网页结果中给出；必须以该基底（pageHash=${options?.currentPageHash || 'unknown'}）返回完整修改后结果。`
            : '- 当前任务是修改已有网页，不是从零重写。必须以 currentPage.html / currentPage.css 为唯一修改基底，返回完整修改后结果。',
          '- 除非评论明确要求全局重构，否则保持未被评论涉及的 section 结构、信息架构、className、data-asset-id、组件层级和文案尽量稳定。',
          '- 优先做最小必要修改：若 refinementPlan.requiresAssetRegeneration=false，只允许通过 HTML/CSS/原生 JS 调整完成，不要借口重生成整页来回避局部修改。',
          '- 若 refinementPlan.assetActions 非空，相关图片资产已经或即将按同一 assetId 重生成；你必须继续沿用原有 assetId / urlToken 映射，不得新增或改名。',
          '- 必须逐条响应 refinementAttachments；notes 中应说明你如何落实每一条关键评论。',
        ]
      : [
          '- 不要复用固定 HTML 模板；必须先根据输入资产尺寸、含义和用户目标规划页面。',
          '- 不是“输入图片生成模板”，而是使用图片/视频的 size、meaning、prompt 作为设计事实。',
        ]),
    '- brandPatternSeed 是第一步网页截图/视觉基准阶段已经抽取出来的统一品牌约束摘要；它不是完整 skill 文本，而是第二步代码生成必须继承的短风格种子。',
    '- 生成代码时必须同时遵循 styleBible 与 brandPatternSeed：前者负责截图视觉取证后的统一 token，后者负责把第一步的品牌模式、模板方向和一致性约束延续到 HTML/CSS。',
    '- 若存在多张上游网页截图，它们已按 referenceScreenshots 顺序作为多图视觉输入传给视觉分析步骤；必须把 screenshotAnalysis 作为整体布局与滚动顺序参考。',
    '- referenceScreenshots 是多图输入的文字元数据清单，用于理解每一段的角色、尺寸、顺序和含义；不要直接引用这些 URL 作为网页素材。',
    '- run-scoped skill `canvas-image-reference-to-code` 提供更严格的 screenshot-to-code fidelity 规则；它不是可选灵感，而是本轮 codegen 的硬约束来源。需要细节时按 overview/section 渐进读取，不要把它当成要全文复制进结果的提示词。',
    '- run-scoped skill `canvas-web-design-patterns` 提供从本地 web-design-skills 库提炼出的 section pattern 选择、scroll choreography 和公共图片来源规则。每次 codegen / refine 都必须先读取它的 overview，再按需只读取一个最相关 section；禁止跳过它，也禁止把多个 pattern 生硬拼接成大杂烩。',
    '- 先做 reference-first workflow：先识别每张图是 full-page / section-level / component-detail / supporting-style reference，再做设计系统抽取，最后才写实现；不要跳过分析直接写 generic landing page。',
    '- 必须优先遵循 screenshotAnalysis 中的视觉取证结果，还原截图里的元素占比、间距、圆角、渐变、阴影、图片/文字叠放关系和组件边界。',
    '- provided screenshots are the primary visual source of truth: workflow must stay image analysis -> design system extraction -> implementation，而不是跳成 generic coding。',
    '- Preserve the screenshot direction unless the user explicitly asks for a redesign. 如果“更方便实现的模板”和“截图真实方向”冲突，必须站在截图这一边。',
    '- 但风格一致性优先于逐图死磕：如果截图之间出现深色/浅色主题跳变或 token 不一致，必须以 styleBible、Hero/首屏截图和用户选择的模板为准统一，不要把跑偏截图的浅色/深色主题原样带入最终网页。',
    '- 如果多张截图各自承担不同角色，必须有意识地翻译它们：hero 截图服务 hero，局部 detail 截图只约束对应 section / component，不要把局部截图误用成整站 redesign 指令。',
    '- 不允许忽略任意一张已经提供的关键参考图；若某张图只应局部生效，应在实现中局部吸收，而不是直接无视。',
    '- 若截图中存在清晰可读的导航、标题、CTA 或 section heading，尽量保留或贴近它们；若文本不可读，用长度和层级相近的克制占位文案，不要补大段营销话术。',
    '- 文本处理必须克制：不要发明大量营销 copy，不要用 “revolutionize / seamless / next-gen / transformative platform” 之类 filler 话术去填空。',
    '- 不要额外发明截图没有暗示的 badge、渐变 blob、装饰卡、浮夸阴影或多余 UI chrome。',
    '- 不要把网页截图当成 loose inspiration / moodboard，不要把它偷换成 generic SaaS、agency、portfolio、dashboard 模板。',
    '- 保持截图里的视觉密度和 section 角色分工；不要为了省事把多段页面收缩成一个通用 Hero + 三张卡片模板。',
    '- repeated components 必须统一：相同按钮、Tabs、统计块、卡片、标签、图标的结构和 token 保持一致；即便截图里有轻微渲染噪声，也不能放大成代码层面的不一致。',
    '- 当截图存在歧义时，只允许谨慎推断，并继续保持可见语言；不要因为局部模糊就重新设计整页。',
    '- 不要默认读取 run-scoped skill `canvas-web-motion`。动效应先来自 screenshotAnalysis、styleBible、brandPatternSeed、当前代码与设计模式约束；只有用户明确要求修复动效实现，或现有代码有具体低层动画 bug 时才按需读取 motion skill。',
    '- 若需要动效库，默认优先使用 GSAP 完成 landing page 动效；只有用户明确要求 Anime.js，或页面上下文已经显式采用 Anime.js 时才改用 Anime.js。若你认为其他可直接 CDN 运行的前端 runtime 更适合实现截图要求，也允许使用，但必须有明确理由且不能依赖构建步骤。',
    '- 在写代码前先决定 motion map：默认控制在 3-5 个 motion beats。通常只需要 nav/page shell entrance、hero copy+media reveal、一个 below-the-fold reveal group、一个可选 scroll-driven/perspective section，以及一个可选 trust/logo marquee 或 hover accent。',
    '- masked reveal 适合大标题或关键标签，不适合把整页每段文字都切碎；marquee 只适合 logo/trust/data strips；ScrollTrigger 的 scrub/pin 最多用于一个真正有叙事意义的 section，且移动端应更克制。',
    '- 若使用动效库、字体、图片 CDN 或框架 runtime，允许在 html/documentHtml 中直接声明它们；也允许在 html 字符串末尾放置一个 <script type="module">...</script> 作为页面动效初始化脚本。不要假设本地 npm、Vite 或其他构建步骤。',
    '- 动效必须服务于信息层级与品牌气质，优先 animate transform / opacity，并为 prefers-reduced-motion 提供更克制或静态的回退。',
    '- generatedAssets 默认仍是主媒体来源；但允许根据 `canvas-web-design-patterns` 的规则引入外部 public image URLs、字体 CDN 或其他浏览器可直接运行的依赖来增强设计感。若某个 generated asset 已明确承担主视觉职责，不要被外部资源随意替换掉；notes 与 assetUsage 中应说明这些外部依赖服务了哪些 section。',
    '- assetPlan.visualSlots 是最终实现的素材决策表，必须逐项落实：implementation=generate 的 slot 使用对应 generatedAssets token；implementation=public_search/web_asset_search 的 slot 使用已解析公共 URL 或在缺 URL 时保留高质量语义占位并在 notes 说明；implementation=icon_search 的 slot 使用 Iconify；implementation=code_procedural 的 slot 用 HTML/CSS/SVG 实现。不要把所有 slot 合并成一张泛用图。',
    '- 若 assetPlan.visualSlots 包含 gallery/grid/masonry/carousel tile 槽位，最终每个 gallery item 必须使用对应的独立 URL/token/语义占位；禁止把一个 aggregate gallery image 或同一个 generated asset 重复填入所有格子。',
    '- 摄影/作品集/案例展示 gallery 若使用 public_search/web_asset_search，按每个 tile 的 searchQuery 或 resolved URL 分别落位；没有 resolved URL 时可用差异化 CSS 占位和 notes 说明，不要回退为一张 AI 生成的九宫格整图。',
    '- 对个人作品集/Awwwards 预览，Hero 棱镜/玻璃立方、About 人物侧脸、Work 三个项目媒体图是不同视觉主体；最终代码必须保持它们的 section 角色和构图差异，不要用同一张抽象图重复填充全站。',
    '- Work/Selected Work 的项目卡媒体应优先呈现为三张不同作品展示图或搜索/生成结果：抽象产品雕塑、峡谷霓虹入口、黑白人物摄影这类差异化视觉，而不是三个相同背景裁切。',
    '- Contact 预览主要由大号 serif 文案、金色线条、email CTA、社交链接和 monogram/符号构成；除非 assetPlan 明确生成了 contact media，否则应贴近该排版，而不是塞入无关大图。',
    ...(hasRefinementAttachments
      ? [
          '- refinementAttachments 是用户在当前网页预览中通过 Picker / Pods 选择出来的局部调优目标；存在时，它们是本轮最高优先级修改约束。',
          '- selectionKind=element 时，优先修改该 selector/label 对应的元素及其直接容器；selectionKind=pod 时，必须把 podMembers 视为同一设计区域整体协调修改。',
          '- refinementAttachments 的 executionScope 固定为 node-only：不要要求新增或重跑上游截图、不要改变 assetPlan 与 generatedAssets 的身份映射、不要引入新的图片资产需求；优先在当前网页 HTML/CSS 层完成调整。',
          '- 若 attachment note 只指向局部区域，就保留无关 sections、组件和站点级 token；只有评论明确要求全局变化时，才允许扩散到整页。',
        ]
      : []),
    '- 上游截图只作为整体视觉参考，不允许把它作为页面 img、CSS background-image、video poster 或任何页面媒体直接复用。',
    '- 如 generatedAssets 中存在与 assetPlan.items.id 对应的 urlToken，必须在对应位置使用这个 urlToken，并添加 data-asset-id="..." 与稳定 className；真实 URL 会在本地解析后替换，不要编造 URL。',
    '- 每个 generatedAssets 条目都必须被最终 HTML/CSS/documentHtml 使用至少一次；如果某个资产在 assetPlan 中存在，不能因为页面不好摆放就省略它，必须按 placement 局部吸收或作为有意义的 section 媒体/前景/背景/品牌符号使用。',
    '- 如 assetPlan.items 中列出图片资产但 generatedAssets 尚无对应 URL，只能使用语义化占位元素，不要假装图片已经生成。',
    '- 需要图片的位置应优先按 asset id 建立映射，禁止改用整张上游截图替代计划资产。',
    '- 通用图标按 Iconify 图标协议实现，保持一套统一 icon size/color/stroke 视觉语言。',
    '- 同一组 Tabs、卡片、按钮、标签、统计块和图标必须统一样式；不要复刻截图中偶发的不一致，Tabs 的下标/箭头/图标要么全组都有，要么全组都没有。',
    '- 若 generatedAssets 同时包含背景图和透明主体图，必须用 HTML/CSS 分层叠放，并为主体层提供克制的 hover/视差/浮动动效；不要把主体烘焙回背景图里。',
    '- 必须生成完整网页，而不是只生成 Hero。Hero 只是完整 landing page 的第一个 section。',
    '- 在输出前必须做一次 fidelity 自检：1) layout logic 是否仍与截图一致；2) typography / spacing mood 是否一致；3) 是否漂移成 generic redesign；4) repeated components 是否一致；5) 若文字不可读，占位 copy 是否简洁且视觉上可信。',
    '- 自检还必须确认：每张预览对应的 section 都保留了主要视觉主体；所有 generatedAssets 是否都被使用；不同 section 的媒体是否没有被错误复用成同一张图；最终页面是否仍像预览图而不是新的通用模板。',
    '- 输出必须是严格 JSON，不要 Markdown，不要代码块围栏，不要解释。',
    '',
    ICONIFY_GUIDELINES,
    '',
    '输入上下文 JSON（已压缩；最终 codegen 不重复输入图片本体，只使用 screenshotAnalysis、assetPlan 与 generatedAssets.urlToken / data-asset-id 映射）：',
    JSON.stringify(buildPromptContext(context, { ...options, promptDetailMode: 'codegen_compact' }), null, 2),
    ...(hasRefinementAttachments && hasCurrentPage
      ? (
          currentPageMode === 'session_history'
            ? [
                '',
                `当前网页基底签名：${options?.currentPageHash || 'unknown'}。请直接沿用本 session 较早消息中的完整网页代码，不要要求重新贴整页 HTML/CSS/documentHtml。`,
              ]
            : [
                '',
                '当前网页 HTML（必须基于它进行局部修改，而不是忽略它另起炉灶）：',
                buildPromptCodeBlock('current-page-html', context.currentPage?.html || ''),
                '',
                '当前网页 CSS（必须基于它进行局部修改，而不是忽略它另起炉灶）：',
                buildPromptCodeBlock('current-page-css', context.currentPage?.css || ''),
                '',
                '当前网页 documentHtml（如需核对最终结构与内联脚本，可参考此完整文档）：',
                buildPromptCodeBlock('current-page-document', context.currentPage?.documentHtml || ''),
              ]
        )
      : []),
    '',
    '输出 JSON schema：',
    JSON.stringify({
      html: 'body 内可直接渲染的 HTML 字符串，不包含 style 标签；如需动效，可在末尾包含 <script type="module"> 标签',
      css: '完整自包含 CSS 字符串',
      documentHtml: '完整 HTML 文档字符串，包含 doctype/head/meta viewport/style/body',
      pagePlan: ['导航：...', 'Hero：...', 'Features：...', 'CTA：...', 'Footer：...'],
      assetUsage: '说明上游资产如何按尺寸和含义被使用；若使用外部公共图片 URL，也要说明它服务的 section 角色与原因',
      notes: [
        '实现自检说明',
        'fidelity: layout logic 与截图是否一致',
        'fidelity: typography / spacing mood 是否一致',
        'fidelity: 是否避免 generic redesign',
        'fidelity: repeated components 是否一致',
        'fidelity: placeholder copy 是否克制且视觉可信',
      ],
    }, null, 2),
  ].join('\n')
}

function summarizeStyleOnlyPatchForPrompt(
  patch: WebPageStyleOnlyPatchResult | null,
): {
  summary: string
  htmlEdits: Array<{ search: string; replace: string }>
  cssEdits: Array<{ search: string; replace: string }>
  notes: string[]
} | null {
  if (!patch) return null
  return {
    summary: compactText(patch.summary, 260),
    htmlEdits: patch.htmlEdits.slice(0, 8).map((edit) => ({
      search: compactText(edit.search, 220),
      replace: compactText(edit.replace, 220),
    })),
    cssEdits: patch.cssEdits.slice(0, 8).map((edit) => ({
      search: compactText(edit.search, 220),
      replace: compactText(edit.replace, 220),
    })),
    notes: compactStringList(patch.notes, 6, 180),
  }
}

export function buildWebPageStyleOnlyPatchRetryPrompt(input: {
  context: WebPageCodeGenerationContext
  currentPageHash?: string | null
  failureReason: string
  previousPatch: WebPageStyleOnlyPatchResult | null
}): string {
  const { context, currentPageHash, failureReason, previousPatch } = input
  return [
    '你是 JarvisHub 的网页局部编辑修复 agent。上一轮 style_only patch 无法在当前网页基底上精确 apply；请根据失败原因返回一份修正后的 search/replace edits。',
    '',
    '关键要求：',
    '- 只返回新的严格 JSON patch，不要返回完整 html/css/documentHtml，不要整页重写。',
    '- 必须以本条消息里提供的当前网页 HTML/CSS 为唯一基底重新定位，不能沿用上一轮未命中的 search 片段。',
    '- search 必须在当前基底中逐字符完全匹配且唯一命中；如果需要多步修改，请拆成多个更小的 edits。',
    '- 优先改 CSS；只有评论明确涉及结构、文案层级、组件顺序或 DOM 语义时才改 HTML。',
    '- 不要使用省略号、占位符、正则、模糊匹配、伪代码或“其余保持不变”之类描述。',
    '- 保持 style_only 边界：不要新增资产，不要修改 assetId / data-asset-id / urlToken 映射，不要要求重跑上游分析。',
    '- 输出必须是严格 JSON，不要 Markdown，不要代码块围栏，不要解释。',
    '',
    `当前网页基底签名：${currentPageHash || 'unknown'}`,
    `上一轮失败原因：${compactText(failureReason, 420)}`,
    '',
    '上一轮未成功 patch 摘要：',
    JSON.stringify(summarizeStyleOnlyPatchForPrompt(previousPatch), null, 2),
    '',
    '输入上下文 JSON：',
    JSON.stringify({
      styleBible: compactStringList(context.styleBible, 10, 220),
      brandPatternSeed: compactStringList(context.brandPatternSeed, 10, 220),
      refinementAttachments: summarizeWebHeroRefinementAttachmentsForPrompt(context.refinementAttachments),
      screenshotAnalysis: summarizeAnalysisForPrompt(context.screenshotAnalysis),
      assetPlan: summarizeAssetPlanForPrompt(context.assetPlan),
      generatedAssets: summarizeGeneratedAssetsForPrompt(context.generatedAssets),
      refinementPlan: summarizeRefinementPlanForPrompt(context.refinementPlan),
      currentPage: {
        mode: 'retry-inline-baseline',
        htmlRef: 'see-current-page-html-block',
        cssRef: 'see-current-page-css-block',
      },
    }, null, 2),
    '',
    '当前网页 HTML（search 必须精确命中其中原文）：',
    buildPromptCodeBlock('current-page-html', context.currentPage?.html || ''),
    '',
    '当前网页 CSS（search 必须精确命中其中原文）：',
    buildPromptCodeBlock('current-page-css', context.currentPage?.css || ''),
    '',
    '输出 JSON schema：',
    JSON.stringify({
      summary: '一句话总结修正后的局部修改',
      htmlEdits: [
        {
          search: '当前 HTML 中唯一且完整的原文片段',
          replace: '替换后的完整片段',
        },
      ],
      cssEdits: [
        {
          search: '当前 CSS 中唯一且完整的原文片段',
          replace: '替换后的完整片段',
        },
      ],
      notes: ['简要说明本轮修正后的 edits 如何落实评论'],
    }, null, 2),
  ].join('\n')
}

function extractJsonObjectText(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const candidates = collectTopLevelJsonObjectTexts(text)
  if (candidates.length > 0) return candidates[candidates.length - 1] || ''
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text
}

function collectTopLevelJsonObjectTexts(raw: string): string[] {
  const candidates: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (char === '}') {
      if (depth <= 0) continue
      depth -= 1
      if (depth === 0 && start >= 0) {
        candidates.push(raw.slice(start, index + 1))
        start = -1
      }
    }
  }

  return candidates
}

function tryParseJsonRecord(text: string): UnknownRecord | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseJsonRecordFromRawText(input: {
  rawText: string
  preferredKeys: string[]
  emptyMessage: string
  invalidMessagePrefix: string
  objectMessage: string
}): UnknownRecord {
  const text = input.rawText.trim()
  if (!text) throw new Error(input.emptyMessage)

  const candidateTexts: string[] = []
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]?.trim()) candidateTexts.push(fenced[1].trim())
  candidateTexts.push(...collectTopLevelJsonObjectTexts(text))

  const fallback = extractJsonObjectText(text)
  if (fallback) candidateTexts.push(fallback)

  const parseErrors: string[] = []
  const parsedRecords: UnknownRecord[] = []

  for (let index = candidateTexts.length - 1; index >= 0; index -= 1) {
    const candidate = candidateTexts[index]
    if (!candidate) continue
    const parsed = tryParseJsonRecord(candidate)
    if (parsed) {
      parsedRecords.push(parsed)
      if (input.preferredKeys.every((key) => Object.prototype.hasOwnProperty.call(parsed, key))) {
        return parsed
      }
      continue
    }
    try {
      JSON.parse(candidate)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      parseErrors.push(message)
    }
  }

  if (parsedRecords.length > 0) return parsedRecords[0] as UnknownRecord

  if (parseErrors.length > 0) {
    throw new Error(`${input.invalidMessagePrefix}：${parseErrors[0]}`)
  }
  throw new Error(input.objectMessage)
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => readString(item)).filter(Boolean)
}

function parseSearchReplaceEdits(value: unknown, label: string): WebPageSearchReplaceEdit[] {
  if (!Array.isArray(value)) return []
  const edits: WebPageSearchReplaceEdit[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const search = typeof item.search === 'string' ? item.search : ''
    const replace = typeof item.replace === 'string' ? item.replace : ''
    if (!search) throw new Error(`网页局部编辑结果存在缺少 search 的 ${label} edit`)
    edits.push({ search, replace })
  }
  return edits
}

function readScreenshotAnalysis(value: unknown): WebPageScreenshotAnalysis {
  const record = isRecord(value) ? value : {}
  return {
    summary: readString(record.summary),
    styleBible: readStringArray(record.styleBible),
    consistencyWarnings: readStringArray(record.consistencyWarnings),
    layout: readStringArray(record.layout),
    spacing: readStringArray(record.spacing),
    typography: readStringArray(record.typography),
    colorAndGradient: readStringArray(record.colorAndGradient),
    imageTreatment: readStringArray(record.imageTreatment),
    shapeAndRadius: readStringArray(record.shapeAndRadius),
    componentDetails: readStringArray(record.componentDetails),
    responsiveNotes: readStringArray(record.responsiveNotes),
    implementationPriorities: readStringArray(record.implementationPriorities),
  }
}

function readBoolean(value: unknown): boolean {
  return value === true
}

function readAssetRole(value: unknown): WebPagePlannedAssetRole {
  const text = readString(value)
  return WEB_PAGE_ASSET_PLAN_ROLES.includes(text as WebPagePlannedAssetRole) ? (text as WebPagePlannedAssetRole) : 'other'
}

function readAssetSource(value: unknown): WebPagePlannedAssetSource {
  const text = readString(value)
  return WEB_PAGE_ASSET_PLAN_SOURCES.includes(text as WebPagePlannedAssetSource) ? (text as WebPagePlannedAssetSource) : 'supporting'
}

function readVisualSlotImplementation(value: unknown): WebPageVisualSlotImplementation {
  return normalizeVisualSlotImplementation(readString(value)) || 'code_procedural'
}

function readNullableString(value: unknown): string | null {
  const text = readString(value)
  return text || null
}

function readNullableScreenshotOrder(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  const order = Math.trunc(numeric)
  return order > 0 ? order : null
}

function parseVisualSlots(value: unknown): WebPageVisualSlot[] {
  if (!Array.isArray(value)) return []
  const slots: WebPageVisualSlot[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const sectionId = readString(item.sectionId)
    const slotId = readString(item.slotId)
    const description = readString(item.description)
    const reason = readString(item.reason)
    if (!sectionId) throw new Error('网页视觉槽位缺少 sectionId')
    if (!slotId) throw new Error(`网页视觉槽位 ${sectionId} 缺少 slotId`)
    if (!description) throw new Error(`网页视觉槽位 ${sectionId}/${slotId} 缺少 description`)
    slots.push({
      sectionId,
      screenshotOrder: readNullableScreenshotOrder(item.screenshotOrder),
      slotId,
      description,
      implementation: readVisualSlotImplementation(item.implementation),
      assetId: readNullableString(item.assetId),
      searchQuery: readNullableString(item.searchQuery),
      reason,
    })
  }
  return slots
}

function parsePlannedAssets(value: unknown): WebPagePlannedAsset[] {
  if (!Array.isArray(value)) return []
  const items: WebPagePlannedAsset[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const id = readString(item.id)
    const name = readString(item.name)
    const placement = readString(item.placement)
    const prompt = readString(item.prompt)
    const aspectRatio = readString(item.aspectRatio)
    const reason = readString(item.reason)
    if (!id) throw new Error('网页视觉资产计划存在缺少 id 的资产')
    if (!name) throw new Error(`网页视觉资产计划资产 ${id} 缺少 name`)
    if (!placement) throw new Error(`网页视觉资产计划资产 ${id} 缺少 placement`)
    if (!prompt) throw new Error(`网页视觉资产计划资产 ${id} 缺少 prompt`)
    if (!aspectRatio) throw new Error(`网页视觉资产计划资产 ${id} 缺少 aspectRatio`)
    items.push({
      id,
      name,
      role: readAssetRole(item.role),
      source: readAssetSource(item.source),
      placement,
      prompt,
      aspectRatio,
      transparentPng: readBoolean(item.transparentPng),
      reason,
      mustKeep: readStringArray(item.mustKeep),
      avoid: readStringArray(item.avoid),
    })
  }
  return items
}

function readRefinementChangeMode(value: unknown): WebPageRefinementPlan['changeMode'] {
  return readString(value) === 'asset_regeneration' ? 'asset_regeneration' : 'style_only'
}

function parseRefinementAssetActions(value: unknown): WebPageRefinementAssetAction[] {
  if (!Array.isArray(value)) return []
  const actions: WebPageRefinementAssetAction[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const assetId = readString(item.assetId)
    const reason = readString(item.reason)
    const prompt = readString(item.prompt)
    if (!assetId) throw new Error('网页调优决策结果存在缺少 assetId 的 assetAction')
    if (!reason) throw new Error(`网页调优决策结果资产 ${assetId} 缺少 reason`)
    if (!prompt) throw new Error(`网页调优决策结果资产 ${assetId} 缺少 prompt`)
    actions.push({ assetId, reason, prompt })
  }
  return actions
}

export function parseWebPageAssetPlanResult(rawText: string): WebPageAssetPlan {
  const parsed = parseJsonRecordFromRawText({
    rawText,
    preferredKeys: ['summary', 'items'],
    emptyMessage: '网页视觉资产计划结果为空',
    invalidMessagePrefix: '网页视觉资产计划结果不是有效 JSON',
    objectMessage: '网页视觉资产计划结果必须是 JSON object',
  })
  return {
    summary: readString(parsed.summary),
    visualSlots: parseVisualSlots(parsed.visualSlots),
    items: parsePlannedAssets(parsed.items),
    iconStrategy: readString(parsed.iconStrategy),
    implementationNotes: readStringArray(parsed.implementationNotes),
    coverageChecklist: readStringArray(parsed.coverageChecklist),
  }
}

export function parseWebPageScreenshotAnalysisResult(rawText: string): WebPageScreenshotAnalysis {
  const parsed = parseJsonRecordFromRawText({
    rawText,
    preferredKeys: ['summary', 'implementationPriorities'],
    emptyMessage: '网页截图视觉分析结果为空',
    invalidMessagePrefix: '网页截图视觉分析结果不是有效 JSON',
    objectMessage: '网页截图视觉分析结果必须是 JSON object',
  })
  const analysis = readScreenshotAnalysis(parsed)
  if (!analysis.summary) throw new Error('网页截图视觉分析结果缺少 summary')
  if (!analysis.implementationPriorities.length) throw new Error('网页截图视觉分析结果缺少 implementationPriorities')
  return analysis
}

export function parseWebPageRefinementPlanResult(rawText: string): WebPageRefinementPlan {
  const parsed = parseJsonRecordFromRawText({
    rawText,
    preferredKeys: ['summary', 'changeMode'],
    emptyMessage: '网页调优决策结果为空',
    invalidMessagePrefix: '网页调优决策结果不是有效 JSON',
    objectMessage: '网页调优决策结果必须是 JSON object',
  })
  const summary = readString(parsed.summary)
  const changeMode = readRefinementChangeMode(parsed.changeMode)
  const assetActions = parseRefinementAssetActions(parsed.assetActions)
  const requiresAssetRegeneration = readBoolean(parsed.requiresAssetRegeneration) || assetActions.length > 0
  if (!summary) throw new Error('网页调优决策结果缺少 summary')
  if (changeMode === 'style_only' && requiresAssetRegeneration) {
    throw new Error('网页调优决策结果冲突：style_only 不能要求 asset regeneration')
  }
  if (changeMode === 'asset_regeneration' && assetActions.length === 0) {
    throw new Error('网页调优决策结果缺少需要重生成的 assetActions')
  }
  return {
    summary,
    changeMode,
    requiresAssetRegeneration,
    styleDirectives: readStringArray(parsed.styleDirectives),
    preserveDirectives: readStringArray(parsed.preserveDirectives),
    assetActions,
  }
}

export function parseWebPageStyleOnlyPatchResult(rawText: string): WebPageStyleOnlyPatchResult {
  const parsed = parseJsonRecordFromRawText({
    rawText,
    preferredKeys: ['htmlEdits', 'cssEdits'],
    emptyMessage: '网页局部编辑结果为空',
    invalidMessagePrefix: '网页局部编辑结果不是有效 JSON',
    objectMessage: '网页局部编辑结果必须是 JSON object',
  })
  const summary = readString(parsed.summary)
  const htmlEdits = parseSearchReplaceEdits(parsed.htmlEdits, 'html')
  const cssEdits = parseSearchReplaceEdits(parsed.cssEdits, 'css')
  if (!summary) throw new Error('网页局部编辑结果缺少 summary')
  if (!htmlEdits.length && !cssEdits.length) {
    throw new Error('网页局部编辑结果没有提供任何 htmlEdits 或 cssEdits')
  }
  return {
    summary,
    htmlEdits,
    cssEdits,
    notes: readStringArray(parsed.notes),
  }
}

function countExactOccurrences(text: string, search: string): number {
  if (!search) return 0
  let count = 0
  let fromIndex = 0
  while (fromIndex <= text.length) {
    const nextIndex = text.indexOf(search, fromIndex)
    if (nextIndex < 0) break
    count += 1
    fromIndex = nextIndex + Math.max(1, search.length)
  }
  return count
}

function applySearchReplaceEdits(input: {
  sourceName: 'html' | 'css'
  text: string
  edits: WebPageSearchReplaceEdit[]
}): string {
  let next = input.text
  input.edits.forEach((edit, index) => {
    const occurrenceCount = countExactOccurrences(next, edit.search)
    if (occurrenceCount !== 1) {
      const compactSearch = compactText(edit.search, 160)
      const occurrenceLabel = occurrenceCount === 0 ? '0 次' : `${occurrenceCount} 次`
      throw new Error(
        `网页局部编辑 ${input.sourceName} 第 ${index + 1} 个 patch 未命中唯一原文：search 在当前内容中出现 ${occurrenceLabel}。search=${compactSearch}`,
      )
    }
    next = next.replace(edit.search, edit.replace)
  })
  return next
}

export function applyWebPageStyleOnlyPatchResult(input: {
  currentPage: WebPageCurrentCode
  patch: WebPageStyleOnlyPatchResult
  pagePlan?: string[]
  assetUsage?: string
}): WebPageCodeGenerationResult {
  const html = applySearchReplaceEdits({
    sourceName: 'html',
    text: input.currentPage.html,
    edits: input.patch.htmlEdits,
  })
  const css = applySearchReplaceEdits({
    sourceName: 'css',
    text: input.currentPage.css,
    edits: input.patch.cssEdits,
  })
  const documentHtml = buildWebPageDocumentHtmlFromParts({ html, css })
  return {
    html,
    css,
    documentHtml,
    pagePlan: Array.isArray(input.pagePlan) ? input.pagePlan.filter(Boolean) : [],
    assetUsage: input.assetUsage || '',
    notes: input.patch.notes.length ? input.patch.notes : [input.patch.summary],
  }
}

export function parseWebPageCodeGenerationResult(rawText: string): WebPageCodeGenerationResult {
  const parsed = parseJsonRecordFromRawText({
    rawText,
    preferredKeys: ['html', 'css'],
    emptyMessage: '网页代码生成结果为空',
    invalidMessagePrefix: '网页代码生成结果不是有效 JSON',
    objectMessage: '网页代码生成结果必须是 JSON object',
  })
  const html = readString(parsed.html)
  const css = readString(parsed.css)
  const rawDocumentHtml = readString(parsed.documentHtml)
  if (!html) throw new Error('网页代码生成结果缺少 html')
  if (!css) throw new Error('网页代码生成结果缺少 css')
  const documentHtml = rawDocumentHtml && /<!doctype html>/i.test(rawDocumentHtml) && /<style[\s>]/i.test(rawDocumentHtml) && /<body[\s>]/i.test(rawDocumentHtml)
    ? rawDocumentHtml
    : buildWebPageDocumentHtmlFromParts({ html, css })
  if (!documentHtml) throw new Error('网页代码生成结果缺少 documentHtml')
  if (!/<!doctype html>/i.test(documentHtml)) throw new Error('documentHtml 缺少 <!doctype html>')
  if (!/<style[\s>]/i.test(documentHtml)) throw new Error('documentHtml 缺少 style')
  if (!/<body[\s>]/i.test(documentHtml)) throw new Error('documentHtml 缺少 body')
  return {
    html,
    css,
    documentHtml,
    pagePlan: readStringArray(parsed.pagePlan),
    assetUsage: readString(parsed.assetUsage),
    notes: readStringArray(parsed.notes),
  }
}
