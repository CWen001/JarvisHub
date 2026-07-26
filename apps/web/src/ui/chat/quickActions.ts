export type ChatQuickActionGroup = 'context' | 'project' | 'starter'

export type ChatQuickActionPreset = {
  key: string
  label: string
  description: string
  prompt: string
  group: ChatQuickActionGroup
  disabled?: boolean
}

type BuildChatInspirationQuickActionsInput = {
  currentProjectId: string | null
  currentProjectName: string | null
  hasFocusedReference: boolean
  selectedNodeLabel: string | null
  selectedNodeKind: string | null
  hasStoryboardContext: boolean
}

type TranslateFn = (input: string) => string

const WEB_HERO_PERSISTENT_WORKFLOW_CONTRACT_LINES = [
  '2.1 先在目标 WebHero 节点 data 上创建/刷新短 JSON `webPageWorkflowContract`，并把它作为后续步骤的 source of truth；它相当于隐藏存储节点，不依赖长聊天上下文。',
  '2.2 contract 至少包含 version、goal、targetWebHeroNodeId、currentStep、stepStatus、selectedStyleReference、sharedStyleBible、approvedPreviewNodes、flatVisualSlotsContract、acceptanceCriteria、missingItems。',
  '2.3 固定步骤：a) `style_reference_selection` 搜索并让用户选择风格参考；b) `preview_generation` 生成 3-4 张 16:9 / 1k / 横屏 / 同一 style bible 分区预览；c) `preview_visual_spec` 独立写 `webPageReferencePrompt`、`webPageImplementationBrief`、`fontPlan`、`previewDetailChecklist`、`webPagePreviewVisualSpecs`、`componentReferencePlan`；d) `asset_inventory` 在下一次独立调用写 `visibleSubjectInventory`、扁平 `visualSlots` 与 `webPageAssetDecisions`，不得混写两个阶段；e) `asset_resolution` 搜索/生成素材并创建四分区资产决策看板；f) `final_code` 读取预览和 resolved assets 后写 HTML/CSS。',
  '2.4 每一步开始前重新读取 flow/node context 与 `webPageWorkflowContract`，Todo 从 contract 生成；每步完成后更新 currentStep、stepStatus、missingItems 和下一步 acceptanceCriteria。',
  '2.5 `flatVisualSlotsContract` 要求 `webPageAssetRequirements.visualSlots` 是先验扁平数组，每个 slot 直接包含 sectionId、previewNodeId 或 screenshotOrder、subjectId、slotId、description、implementation、assetId、renderMode、status、intendedWebUsage；不要只写 `{ previewNodeId, sectionId, slots:[...] }`，不要在代码 gate 失败后才补字段。',
]

const WEB_HERO_STYLE_REFERENCE_SELECTION_LINES = [
  '3.0 生成预览图前必须先完成风格选择：调用 `canvas_web_style_reference_search` 搜索 Awwwards/SiteInspire/Dribbble/Behance/竞品等风格参考。',
  '3.0.1 如果 search 返回可用 image results，选 5 张风格差异清晰的真实结果，直接调用 `ask_user`，把它们放进 `optionCards`：每项包含 value、imageUrl、thumbnailUrl、title、displayValue；value 可含机器可读 URL，displayValue 必须是“已选择风格参考：B”这类短文本，避免聊天区显示裸 URL。不要创建画布参考图片节点，不要在文字里列来源/页面/图片网址。右侧 AI Chat 会以缩略图选择卡展示，用户选择前不要生成网页预览图。',
  '3.0.2 用户选择后，用独立一次 `canvas_update_node_data` 把 canonical selectedStyleReference 写入 `webPageWorkflowContract.selectedStyleReference`，同一调用必须传 `webHeroResetDownstreamEvidence=true`，且不得同时写 specs/assets/drafts；后续状态更新只能传 partial contract，不能重发 selectedStyleReference。随后据此生成 `sharedStyleBible`；风格图仅作为聊天记录展示，不能注入 AI Chat 的 referenceImages/assetInputs。WebHero 预览的唯一模型输入由服务端从持久化选择解析，不能只根据 URL 文本推断风格。',
  '3.0.2b 如果用户点“都不满意，自定义”，必须请用户上传/提供一个真实公网、模型可读取的参考图；自定义文字只能补充 sharedStyleBible，不能单独成为 selectedStyleReference。',
  '3.0.3 如果 search 返回 degraded/空结果，不要自己生成风格参考图，不要继续生成网页预览图；必须把搜索失败写入 contract.missingItems，并向用户说明 style reference search 当前没有拿到真实公网参考，需要先修复搜索或更换搜索词/来源。',
  '3.0.4 风格参考候选必须来自真实搜索结果或已有真实 URL，不允许用生图结果冒充公网风格参考。',
]

const WEB_HERO_PREVIEW_LINES = [
  '3.1 没有已确认预览时，生成 3-4 张分 section 网页预览，Hero 单独存在；每张都用 `canvas_image_generate_to_canvas` 生成真实图片节点，purpose 必须传 `kind=webPreview`、`forNodeId=<当前 webHero 节点 id>`、`flowUpdatedAt=<刚刚 canvas_flow_get 的精确 updatedAt>`、`sectionId=<唯一 section id>`、`order=<严格连续 1..N>`。webPreview 禁止传 `slotId`；服务端会在同次生成中写入 `webScreenshotSectionId/webScreenshotOrder`，不要生成后再补 patch。',
  '3.2 每张预览显式传 `aspectRatio="16:9"`、`aspect="16:9"`、`size="16:9"`、`imageResolution="1k"`、`resolution="1k"`、`nodeWidth=700`、`nodeHeight=394`；同批次必须共享 selectedStyleReference 派生出的 style bible，不能明显漂移。',
  '3.3 刚生成/改写预览图且线程未明确批准时，必须调用 ask_user 做结构化确认，不要只用普通文本说“你确认后我继续”。',
]

const WEB_HERO_ASSET_AND_CODE_LINES = [
  '4. 预览确认后进入规格与素材提取，不是立刻写 HTML/CSS；Todo 顺序必须是：读取 approved preview ids/order -> 用一次 canvas_update_node_data 写六个 preview_visual_spec 字段 -> 用下一次调用写 visibleSubjectInventory、扁平 visualSlots 与 webPageAssetDecisions -> 执行 icon_search/web_asset_search/public_search/必要生图 -> 写 webPageResolvedAssets -> 读取预览与 resolved assets -> stage/commit 最终 webHeroHtml/webHeroCss。',
  '4.1 每个预览可见的产品/人物/UI mockup/作品/背景主视觉都要有独立主体和 slot；不能每张图只写 1 个泛槽位，不能只生成 1 个泛用图。产品/硬件默认至少覆盖 Hero 产品主视觉、产品细节/结构或材质视觉、可见生态/APP/UI mockup、最终 CTA 产品视觉。',
  '4.1a Gallery/grid/masonry/carousel/作品墙/摄影集/Selected Work 这类多图片布局必须按可见 tile/card 拆成独立 visualSlots；3×3 gallery 至少 9 个独立 image/search slot。禁止把整个 gallery 截图或生成为一张大图，再在最终代码里重复填进每个格子。',
  '4.1b 摄影、个人作品集、案例展示、艺术作品墙等展示类 gallery 默认优先用 public_search/web_asset_search/canvas_web_style_reference_search 获取可用公网图片；每个 tile 写独立 searchQuery 和 resolved URL。除非用户要求原创或具体主体无法搜索，才允许逐张生成；永远不要 AI 生成整张 gallery 拼图。',
  '4.2 `renderMode="image_asset"` 必须使用真实素材 URL；`code_procedural` 只允许用于线条、网格、简单光效、按钮、文本块等 UI chrome，不能替代产品图、场景图、透明前景、section 背景大片或 UI mockup。',
  '4.3 生图前为每个 image_asset 写 `intendedWebUsage`：placement、backgroundTreatment、cropAndSafeArea、layering、interactionWithTypography、responsiveBehavior、visualContinuity；不要生成通用卡片图后硬塞进页面。`implementation="generate"` 或叙事/产品/人物/场景/UI mockup 图片槽位必须调用 `canvas_image_generate_to_canvas` 创建匹配 canvas 资产节点，带 webPageAssetForNodeId、webPageAssetId、webPageAssetSlotId。',
  '4.4 透明/cutout/产品悬浮/人物设备压字槽位，搜索时传 `kind="image"`、`format="png"`、`requireTransparent=true` 或 `preferTransparent=true`；只有 `transparentBackground="yes"` 且 `transparencyEvidence="png-alpha-probed"` 才能直接用，否则为同一 assetId 生图。',
  '4.5 已批准预览图只能做视觉参考，不能作为最终 `<img>`、CSS background 或 `webPageResolvedAssets` URL；搜索素材若采用，必须写入 `webPageResolvedAssets` 并在最终 HTML/CSS 引用，若拒绝则记录 rejected reason。',
  '4.5a 最终代码中每个 gallery item 必须引用对应独立资产/公网 URL/语义占位，不能所有 `<img>` 共用同一个 gallery aggregate asset。',
  '4.6 资产看板不是最终交付；除非用户明确只要看板，创建看板后必须继续 final_code。最终大段代码优先用 `canvas_webhero_code_stage_raw_chunk`（无 chunkBase64，每个 raw chunk < 8000）+ `canvas_webhero_code_commit`；不要用 `canvas_update_node_data` 直接写大段 HTML/CSS。',
]

function normalizeComparableString(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function clipSubjectLabel(value: string | null | undefined, maxChars = 18): string | null {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  if (normalized.length <= maxChars) return normalized
  if (maxChars <= 1) return normalized.slice(0, maxChars)
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`
}

function isImageNodeKind(kind: string | null): boolean {
  const normalized = normalizeComparableString(kind)
  return normalized === 'image' || normalized === 'imageedit'
}

function isVideoNodeKind(kind: string | null): boolean {
  const normalized = normalizeComparableString(kind)
  return normalized === 'video' || normalized === 'composevideo'
}

function isTextNodeKind(kind: string | null): boolean {
  const normalized = normalizeComparableString(kind)
  return normalized === 'text' || normalized === 'storyboardscript' || normalized === 'scriptdoc' || normalized === 'noveldoc'
}

function isWebHeroNodeKind(kind: string | null): boolean {
  const normalized = normalizeComparableString(kind)
  return normalized === 'webhero' || normalized === 'web' || normalized === 'landinghero'
}

export function buildChatInspirationQuickActions(
  input: BuildChatInspirationQuickActionsInput,
  t: TranslateFn,
): ChatQuickActionPreset[] {
  const projectLabel = input.currentProjectName || input.currentProjectId || '当前项目'
  const selectedLabel = clipSubjectLabel(input.selectedNodeLabel)
  const selectedKind = normalizeComparableString(input.selectedNodeKind)
  const actions: ChatQuickActionPreset[] = []

  if (isImageNodeKind(selectedKind)) {
    actions.push({
      key: 'selected-image-optimize-prompt',
      group: 'context',
      label: t('优化当前图片提示词'),
      description: selectedLabel
        ? `围绕「${selectedLabel}」读取节点上下文后直接回写原节点`
        : t('读取当前图片节点上下文后，直接优化并回写原节点'),
      prompt: [
        '请把当前选中的图片节点视为本轮唯一主目标，并直接优化它的提示词。',
        '要求：',
        '1. 先读取当前节点 bundle，确认现有 prompt/systemPrompt/negativePrompt、结果图、参考图、上下游与 diagnostics。',
        '2. 结合当前结果图与本轮上下文，判断如何提高主体、构图、镜头、光线、材质或风格执行度；不要只给建议文本。',
		'3. 若证据足够，直接回写当前节点；canvas_update_node_data 会替换本次明确提供的字段并保留未提供字段。',
        '4. 默认保留原 imageModel/aspect/sampleCount，除非我明确要求一起改。',
        '5. 除非确实需要保留旧版或分叉方案，否则不要新建平行图片节点。',
      ].join('\n'),
    })

    actions.push({
      key: input.hasStoryboardContext ? 'selected-shot-continue-scene' : 'selected-image-continue-scene',
      group: 'context',
      label: input.hasStoryboardContext ? t('承接当前镜头继续') : t('围绕当前图片继续创作'),
      description: input.hasStoryboardContext
        ? t('把当前选中帧当作连续性锚点，推进下一步场景')
        : t('围绕当前图片与参考继续推进最小必要下一步'),
      prompt: [
        '请围绕当前选中的图片节点继续推进 JarvisHub 创作。',
        '要求：',
        '1. 先读取当前节点 bundle 与相关上下游，确认它在当前流程中的角色。',
        '2. 如果它已经带有 continuity 证据，优先把它当作连续性锚点推进下一步；不要另起无关分支。',
        '3. 由 agents 基于本轮证据判断应该续写场景、补足中间节点、修复当前锚点，还是只返回下一步规划；不要套固定 SOP。',
        '4. 若当前 project/flow 作用域充分且动作明确，可以直接写画布；若证据不足，先补证并说明阻塞点。',
      ].join('\n'),
    })
  } else if (isVideoNodeKind(selectedKind)) {
    actions.push({
      key: 'selected-video-diagnose',
      group: 'context',
      label: t('诊断当前视频节点'),
      description: selectedLabel
        ? `围绕「${selectedLabel}」定位卡点并做最小必要修正`
        : t('复盘当前视频节点并修正最关键问题'),
      prompt: [
        '请围绕当前选中的视频节点做一次最小必要的诊断与修正。',
        '要求：',
        '1. 先读取当前节点 bundle；若需要复盘视频结果，再读取对应的视频 review bundle。',
        '2. 判断问题主要在当前 prompt、连续性锚点、对白保留，还是上游素材不足。',
        '3. 若属于当前节点可直接修正的问题，优先直接回写当前节点；不要默认新建另一条视频链。',
        '4. 若证据不足，明确缺少哪个上游节点、关键帧或文本证据；不要编造。',
      ].join('\n'),
    })

    if (input.hasStoryboardContext) {
      actions.push({
        key: 'selected-video-continue-scene',
        group: 'context',
        label: t('承接当前视频继续'),
        description: t('沿用当前连续性锚点，推进下一步场景或镜头'),
        prompt: [
          '请把当前选中的视频节点当作连续性锚点，继续推进 JarvisHub 场景创作。',
          '要求：',
          '1. 先确认当前节点对应的章节、镜头、关键帧或上下游依赖。',
          '2. 基于已验证证据判断下一步应该补关键帧、续写镜头、回修当前节点，还是连接后续视频链。',
          '3. 若当前动作明确且可执行，可以直接写画布；否则返回最小必要计划，并说明缺失证据。',
        ].join('\n'),
      })
    }
  } else if (isTextNodeKind(selectedKind)) {
    actions.push({
      key: 'selected-text-to-workflow',
      group: 'context',
      label: t('把当前文本推进成方案'),
      description: selectedLabel
        ? `把「${selectedLabel}」当作上游证据，推进成最小必要工作流`
        : t('把当前文本节点推进成最小必要工作流'),
      prompt: [
        '请把当前选中的文本/脚本节点作为上游证据，推进成最小必要的 JarvisHub 工作流。',
        '要求：',
        '1. 先读取当前节点和上下游，确认它是文案、剧本、分镜脚本还是章节文本。',
        '2. 由 agents 自主判断这轮更适合推进图片、分镜、视频，还是先补结构节点；不要机械套固定流程。',
        '3. 若当前 project/flow 作用域充分且动作明确，可以直接写画布；否则返回最小必要方案。',
        '4. 若文本证据不足以落到执行，明确指出还缺哪类视觉锚点、章节定位或参考图。',
      ].join('\n'),
    })
  } else if (selectedLabel || selectedKind) {
    if (isWebHeroNodeKind(selectedKind)) {
      actions.push({
        key: 'selected-webhero-generate',
        group: 'context',
        label: t('生成当前网页'),
        description: selectedLabel
          ? `围绕「${selectedLabel}」继续网页生成并回写当前节点`
          : t('围绕当前网页节点继续生成并回写当前节点'),
        prompt: [
          '请把当前选中的 webHero 节点当作本轮唯一网页目标。',
          '要求：',
          '1. 先读取当前 webHero 节点及其上下游视觉资产，判断当前处于哪一阶段：网页预览图、网页资产、还是最终代码。',
          '2. 先读取 `canvas-brand-web-design` 与 `canvas-web-design-patterns`，遵守 staged workflow：风格参考搜索与用户选择 -> 分 section 预览 -> 预览确认 -> 资产清单/搜索/生成/看板 -> 最终 HTML/CSS。需要拼长图、复杂素材拆解或明确动效修复时再读取专项 skill；不要读取 `canvas-image-reference-to-code`。',
          ...WEB_HERO_PERSISTENT_WORKFLOW_CONTRACT_LINES,
          ...WEB_HERO_STYLE_REFERENCE_SELECTION_LINES,
          ...WEB_HERO_PREVIEW_LINES,
          ...WEB_HERO_ASSET_AND_CODE_LINES,
          '5. 生成 `webPageReferencePrompt`、`webPageImplementationBrief`、`fontPlan`、`previewDetailChecklist`、`componentReferencePlan` 时保持实现级细节，但不要重复粘贴长检索结果；优先存 retrieval record，再在代码阶段按需读取。',
          '6. 当前选中的 webHero 节点是唯一回写目标；最终至少写回 `webHeroHtml`、`webHeroCss`、`webHeroDocumentHtml`。最终 CSS 必须防移动端横向溢出，窄屏下 section、nav、footer、媒体容器都要 `max-width:100%`、`min-width:0`、允许换行/断行。',
          '7. 代码提交前自检：`webHeroHtml` 至少包含与已批准预览顺序对应的真实 `<section>`，`webHeroCss` 不是 `<style></style>` 或极短占位；commit 后再读当前节点确认三段字段非空且 documentHtml 不是 `<main></main>` 空壳。',
        ].join('\n'),
      })

      actions.push({
        key: 'selected-webhero-refine',
        group: 'context',
        label: t('调优当前网页'),
        description: selectedLabel
          ? `围绕「${selectedLabel}」的选区评论做网页局部调优`
          : t('围绕当前网页节点的选区评论做网页局部调优'),
        prompt: [
          '请把当前选中的 webHero 节点作为本轮唯一修改目标，并根据预览里的 Tweaks 评论做定向修改。',
          '要求：',
          '1. 先读取 `canvas-brand-web-design` 与 `canvas-web-design-patterns`；若需要回到预览确认后的前置阶段，继续走 `webPageReferencePrompt` / `webPageAssetRequirements` / `webPageResolvedAssets` 链路；代码修改阶段不要默认读取 motion 相关 skill，只有用户明确要求修动效实现、或现有代码已有具体 motion bug 需要按实现细节修复时再按需读取。不要把 React 最终代码修改切回 image-to-code。',
          '2. 先判断这次 Tweaks 命中的是：已有代码局部样式、某一张网页预览图、还是某一个网页素材资产。优先修改最小作用域，不要直接整页重做。',
          '3. 优先局部修改现有 HTML/CSS 与当前结构；只有在确实无法只靠现有 HTML/CSS/现有素材完成时，才允许重生成真正命中的网页资产。',
          '3.1 如果 Tweaks 指出图片卡片化、圆角矩形过多或产品展示布局不对，优先改媒体结构：把大图从 rounded card 中移出，改成 full-bleed / masked stage / gradient blend / center product stage；配置页保持顶部标题、左侧颜色轨、中央大车图、右侧参数栈。',
          '4. 如果只是某一张网页预览图或某一个素材不对，只改那个对象；不要把已确认的其它网页截图和素材一起推翻。',
          '5. 如果评论本质上是在否定某一张网页预览图，而不是代码细节，优先先修这张预览图并确认，再继续影响最终代码。',
          '6. Tweaks 的回复允许用户选择某一张图后再补充自定义修改方向，模型要把两部分都当成有效修改信号。',
          '7. 最终仍要把更新后的 `webHeroHtml` / `webHeroCss` / `webHeroDocumentHtml` 回写到当前节点，不要新建平行节点。',
        ].join('\n'),
      })
    }
    actions.push({
      key: 'selected-node-next-step',
      group: 'context',
      label: t('诊断当前节点下一步'),
      description: selectedLabel
        ? `围绕「${selectedLabel}」确认最稳妥的下一步`
        : t('围绕当前选中节点确认最稳妥的下一步'),
      prompt: [
        '请围绕当前选中的节点做一次面向执行的诊断。',
        '要求：',
        '1. 先读取当前节点及其上下游，确认它在工作流中的位置与职责。',
        '2. 说明当前节点最关键的完成度、缺口和下一步动作。',
        '3. 若这是显式、确定性的画布改动且证据充分，可以直接执行；否则只返回最小必要建议，不要臆造。',
      ].join('\n'),
    })
  }

  actions.push(
    {
      key: 'single-video-sop',
      group: 'project',
      label: t('根据上传文本快捷创作单个视频'),
      description: input.hasFocusedReference
        ? t('先结合已上传文本、当前选中节点和参考图自主定位最相关进度，再选择最小必要的视频生产路径')
        : t('先从项目文本与现有画布证据里定位最相关进度，再快速推进 1 条单视频创作'),
      prompt: [
        '请进入“根据上传文本快捷创作单个视频”模式，目标是在 JarvisHub 中完成 1 条短视频。',
        '要求：',
        '1. 先读取当前项目状态、当前选中节点、已上传小说文本、参考图和其它本轮可验证证据；禁止跳过取证直接编排。',
        '2. 由 agents 基于本轮证据自主判断应该承接已有关键帧、修复关键帧、补足连续性锚点，还是直接进入单视频生产；不要把某个固定 SOP 当成默认路线。',
        '3. 若局部证据不足，优先继续补证并选择最稳妥的最小必要 JarvisHub 节点方案；只有在完全无法定位可用正文、场景锚点或画布落点时，才说明缺口。',
        '4. 若涉及章节正文或连续镜头，优先把 continuity checkpoint、上一镜头锚点、必须保留与禁止漂移转成真实约束；如果缺少显式 checkpoint，应继续从项目状态、章节索引、已有关联节点里定位，而不是直接停止。',
        '5. 优先复用现有 agents-cli 能力与 prompt specialists；不要新增本地硬编码决策链。',
      ].join('\n'),
    },
    {
      key: 'project-text-scene-pipeline',
      group: 'project',
      label: t('从当前项目文本启动场景创作'),
      description: input.currentProjectId
        ? `从 ${projectLabel} 的已上传文本里选一个可独立成段的小场景，直接拉起完整创作流程`
        : t('当前未选择项目，无法读取项目文本'),
      prompt: [
        '请直接读取当前项目已上传的文本素材，并仅基于本轮实际读取到的文本内容推进一次项目内场景创作。',
        '要求：',
        '1. 先明确你本轮实际读取到的文本片段/章节范围，以及当前项目里已确认的节点、参考图与连续性锚点。',
        '2. 由 agents 基于已读取证据判断这轮应该新起场景、承接上一镜头、修复连续性，还是只返回下一步规划；不要在前端写死固定流程。',
        '3. 如果适合落到 JarvisHub，就返回最小必要的画布工作流或节点计划；若局部证据仍不足，优先继续补证并给出当前最稳妥的推进方案。',
        '4. 若当前选中节点已经带有 tail frame 等连续性证据，优先按该证据推进，而不是另起一段新的剧情分支。',
      ].join('\n'),
      disabled: !input.currentProjectId,
    },
    {
      key: 'starter-prompts',
      group: 'starter',
      label: t('推荐一组起步任务'),
      description: t('按图片、分镜、视频、画布编排给出可直接执行的方向'),
      prompt: '请给我 6 个适合 JarvisHub 新用户直接体验的快捷创作方向，覆盖图片生成、图像改写、分镜设计、视频脚本和画布编排，并告诉我每个方向适合什么时候用、第一步该怎么开始。',
    },
  )

  return actions
}
