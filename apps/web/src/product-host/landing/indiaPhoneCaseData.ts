export type CaseLanguage = 'zh' | 'en'

type Copy = { zh: string; en: string }

type CaseBatch = {
  number: number
  phase: number
  title: Copy
  intent: Copy
  question: Copy
  verdict: Copy
  learning: Copy
  next: Copy
  strategies: Copy[]
  promptFiles: string[]
  schemaFiles: string[]
  score?: number
  status: 'review' | 'baseline' | 'pass' | 'reject'
  displayNumber?: string
  note?: Copy
}

export const CASE_PATH = '/cases/india-phone-design'
export const CASE_ASSET_ROOT = '/product-host/landing/cases/india-phone-design/batches'

export const phases: Array<{ number: number; range: string; title: Copy; description: Copy }> = [
  { number: 1, range: '01–04', title: { zh: '建立可见基线', en: 'Establishing a visible baseline' }, description: { zh: '先验证价值层级、转面差异和文化表达比例能否真正被看见。', en: 'Testing whether value hierarchy, form transitions and cultural-expression ratios are visibly judgeable.' } },
  { number: 2, range: '05–09', title: { zh: '从系列语言到文化抽象', en: 'From family language to cultural abstraction' }, description: { zh: '建立相机秩序、系列一致性，并把文化来源从图案转译为结构关系。', en: 'Building camera order and family coherence while translating cultural sources into structural relationships.' } },
  { number: 3, range: '10–13', title: { zh: '让工艺成为可见证据', en: 'Making process visible as evidence' }, description: { zh: '用命名工艺、明确区域、边界行为和呈现证明控制生成结果。', en: 'Controlling outputs through named processes, exact zones, boundary behaviour and presentation proof.' } },
  { number: 4, range: '14–16', title: { zh: '原创性门禁与系统整合', en: 'Originality gates and system integration' }, description: { zh: '保留失败批次，用固定门禁检验原创性、功能细节与相机—机身整合。', en: 'Keeping failed batches visible while testing originality, functional detail and camera-to-chassis integration.' } },
  { number: 5, range: 'VALIDATION 01–03', title: { zh: '方法应用与边界验证', en: 'Applied validation' }, description: { zh: '把已经形成的方法用于相机区、P 系列与更强文化表达，检验适用边界。', en: 'Applying the established method to camera zones, P-series products and stronger cultural expression to test its limits.' } },
]

export const batches: CaseBatch[] = [
  {
    number: 1, phase: 1, status: 'review',
    title: { zh: '可见价值层级', en: 'Visible Value Hierarchy' },
    intent: { zh: '方法基线（Method Baseline）', en: 'Method Baseline' },
    question: { zh: '抽象的功能价值优先级，能否形成可辨认的印度市场高端手机外观差异？', en: 'Can abstract functional-value priorities produce visibly different India-oriented high-end exteriors?' },
    verdict: { zh: '四张方案过于相似，设计问题无法被清晰判断。', en: 'The four proposals were too similar for the design question to be judged clearly.' },
    learning: { zh: '抽象产品策略不能直接充当造型变量；比较必须落到可见几何关系。', en: 'Abstract product priorities cannot stand in for visible form variables; comparisons need concrete geometric relationships.' },
    next: { zh: '把下一轮变量收窄为倒角、中框、背板转面与握持关系。', en: 'Narrow the next comparison to chamfer, frame, rear transition and grip relationships.' },
    strategies: [{ zh: '基准方案', en: 'Control' }, { zh: '影像优先', en: 'Camera-first' }, { zh: '续航耐用优先', en: 'Endurance-first' }, { zh: '平衡方案', en: 'Balanced' }],
    promptFiles: ['01-control.prompt.txt', '02-camera-first.prompt.txt', '03-endurance-first.prompt.txt', '04-balanced.prompt.txt'], schemaFiles: [],
  },
  {
    number: 2, phase: 1, status: 'review',
    title: { zh: '倒角、中框与背板转面', en: 'Chamfer, Frame, Rear Transition and Grip' },
    intent: { zh: '方法基线（Method Baseline）', en: 'Method Baseline' },
    question: { zh: '哪一种克制的倒角和转面关系，最能建立成熟中端手机的体量与握持感？', en: 'Which moderate corner, chamfer, frame and rear transition gives a mature mid-range phone the best grip and volume character?' },
    verdict: { zh: '变量仍然太细微，呈现视角也没有充分暴露差异。', en: 'The variables remained too subtle and the views did not expose the changed surfaces.' },
    learning: { zh: '受控实验不能退化成微小变体；构图必须为被比较的关系提供证据。', en: 'A controlled batch must not collapse into micro-variants; composition must visibly prove the relation under test.' },
    next: { zh: '放大形态拓扑差异，并明确功能形态与文化表达的设计权限。', en: 'Increase topology contrast and define the design authority of functional form versus cultural expression.' },
    strategies: [{ zh: '窄平框与微倒角', en: 'Narrow flat frame / micro-chamfer' }, { zh: '平直正面与柔和背弧', en: 'Flat front / rear arc' }, { zh: '对称双弧', en: 'Symmetric dual arc' }, { zh: '宽平面与局部切面', en: 'Broad flat / local facets' }],
    promptFiles: ['01-narrow-flat-micro-chamfer.prompt.txt', '02-flat-front-rear-arc.prompt.txt', '03-symmetric-dual-arc.prompt.txt', '04-broad-flat-local-facets.prompt.txt'], schemaFiles: [],
  },
  {
    number: 3, phase: 1, status: 'review',
    title: { zh: '功能形态 60 / 文化表达 40', en: 'Functional Form 60 / Cultural Expression 40' },
    intent: { zh: '印度文化方向组合（India Cultural Directions）', en: 'India Cultural Directions' },
    question: { zh: '60/40 的设计权限能否形成成熟、面向印度市场的中端手机？', en: 'Can a 60% Functional Form / 40% Cultural Expression balance create mature India-oriented mid-range exteriors?' },
    verdict: { zh: '织物方向有效，但其余方向让文化几何压过了成熟手机形态。', en: 'The textile direction worked, but cultural geometry overrode mature phone form in the other concepts.' },
    learning: { zh: '文化特色应丰富已经解决的物理区域，不应默认决定大体量和相机拓扑。', en: 'Cultural expression should enrich a resolved physical zone, not determine major volume or camera topology by default.' },
    next: { zh: '把默认比例调整为 80% Functional Form / 20% Cultural Expression。', en: 'Move the default to 80% Functional Form / 20% Cultural Expression.' },
    strategies: [{ zh: '织物工艺', en: 'Textile craft' }, { zh: '石材镶嵌', en: 'Stone inlay' }, { zh: '现代建筑', en: 'Modern architecture' }, { zh: '季风自然', en: 'Monsoon nature' }],
    promptFiles: ['01-textile-craft.prompt.txt', '02-stone-inlay.prompt.txt', '03-modern-architecture.prompt.txt', '04-monsoon-nature.prompt.txt'], schemaFiles: ['schema-before.md', 'schema-tested.md'],
    note: { zh: '第四个方向只保留了 Prompt，未生成图像；Comparison Board 如实保留空位。', en: 'The fourth direction retained its Prompt but no image was generated; the empty board cell is preserved.' },
  },
  {
    number: 4, phase: 1, status: 'review',
    title: { zh: '克制的文化表达 80/20', en: 'Restrained Cultural Expression 80/20' },
    intent: { zh: '印度文化方向组合（India Cultural Directions）', en: 'India Cultural Directions' },
    question: { zh: '80/20 是否能在保留成熟功能形态的同时，维持可读的印度文化特色？', en: 'Does an 80/20 balance preserve mature phone form while retaining readable India character?' },
    verdict: { zh: '整体可接受，但呈现背景削弱了部分机身轮廓。', en: 'The batch was accepted with a presentation correction: some backgrounds weakened silhouette separation.' },
    learning: { zh: '评价用 Hero 的背景必须同时在明度与色相上区别于手机。', en: 'Evaluation heroes need a backdrop separated from the phone in both luminance and hue.' },
    next: { zh: '固定背景分离规则，转向相机架构与系列识别。', en: 'Fix backdrop separation and move the experiment toward camera architecture and family recognition.' },
    strategies: [{ zh: '织物 80/20', en: 'Textile 80/20' }, { zh: '石材 80/20', en: 'Stone 80/20' }, { zh: '建筑 80/20', en: 'Architecture 80/20' }, { zh: '季风 80/20', en: 'Monsoon 80/20' }],
    promptFiles: ['01-textile-80-20.prompt.txt', '02-stone-inlay-80-20.prompt.txt', '03-architecture-80-20.prompt.txt', '04-monsoon-80-20.prompt.txt'], schemaFiles: [],
  },
  {
    number: 5, phase: 2, status: 'review',
    title: { zh: '横向相机架构探索', en: 'Transsion-like Horizontal Camera Exploration' },
    intent: { zh: '相机架构基线（Camera Architecture Baseline）', en: 'Camera Architecture Baseline' },
    question: { zh: '哪种上部横向相机架构能建立传音式家族语言，同时不复制现有产品？', en: 'Which upper horizontal camera architecture could become a Transsion-like family language without copying a released signature?' },
    verdict: { zh: '方案 1、3 获得偏好，但镜头、闪光灯及软硬材料关系仍不稳定。', en: 'Concepts 1 and 3 were preferred, while lens, flash and soft/hard material relationships remained inconsistent.' },
    learning: { zh: '相机区首先需要严格的镜头—闪光灯层级和可信的硬质零件边界。', en: 'Camera zones first need strict lens-to-flash hierarchy and credible hard-part boundaries.' },
    next: { zh: '建立嵌套系列 Schema，验证四个成员能否共享同一设计语法。', en: 'Build a nested series Schema and test whether four members can share one design grammar.' },
    strategies: [{ zh: '双环横桥', en: 'Twin-ring bridge' }, { zh: '顶边阶台', en: 'Top-edge terrace' }, { zh: '分段横梁', en: 'Segmented crossbar' }, { zh: '编织带窗口', en: 'Woven-band windows' }],
    promptFiles: ['01-horizontal-twin-ring-bridge.prompt.txt', '02-top-edge-terrace.prompt.txt', '03-segmented-crossbar.prompt.txt', '04-woven-band-windows.prompt.txt'], schemaFiles: [],
  },
  {
    number: 6, phase: 2, status: 'baseline', score: 78,
    title: { zh: '佩斯利涡旋纹（Paisley / Boteh）：系列系统候选', en: 'Paisley Series-System Candidate' },
    intent: { zh: '佩斯利涡旋纹（Paisley / Boteh）', en: 'Paisley / Boteh' },
    question: { zh: '一个嵌套系列 Schema 能否同时维持家族一致性、相机层级、材料接合和佩斯利涡旋纹（Paisley）文化表达？', en: 'Can one nested series-level Schema keep family coherence, camera hierarchy, rigid-material junctions and Paisley expression?' },
    verdict: { zh: '作为量化基线保留，但候选 Schema 不予晋升。', en: 'Retained as the quantitative baseline, but the candidate Schema was not promoted.' },
    learning: { zh: '相机功能拓扑必须先成立；文化关系应进入内部秩序，而不是支配相机外轮廓。', en: 'Functional camera topology must resolve first; cultural relationships should enter internal order rather than dictate the enclosure silhouette.' },
    next: { zh: '加入字面图案排除和远近阅读层级，重新测试 Paisley 抽象。', en: 'Add literal-copy exclusion and distance hierarchy, then retest Paisley abstraction.' },
    strategies: [{ zh: '基础款', en: 'Base' }, { zh: '标准款', en: 'Standard' }, { zh: 'Pro', en: 'Pro' }, { zh: '印度限定款', en: 'India Edition' }],
    promptFiles: ['01-base.prompt.txt', '02-standard.prompt.txt', '03-pro.prompt.txt', '04-india-edition.prompt.txt'], schemaFiles: ['phone-design-judgment-before.schema.json', 'schema-candidate.json'],
  },
  {
    number: 7, phase: 2, status: 'pass', score: 82,
    title: { zh: '佩斯利涡旋纹（Paisley / Boteh）：抽象控制', en: 'Paisley / Boteh Abstraction Control' },
    intent: { zh: '佩斯利涡旋纹（Paisley / Boteh）', en: 'Paisley / Boteh' },
    question: { zh: '字面复制排除与远近层级，能否保留可读的佩斯利涡旋关系并维持成熟手机第一印象？', en: 'Can literal-copy exclusion and distance hierarchy preserve a readable Boteh relationship while keeping a mature first read?' },
    verdict: { zh: '通过：四图均保留，作为正式 Learning Batch。', en: 'Pass — retained as a complete four-image Learning Batch.' },
    learning: { zh: '相机内部功能秩序是更可靠的文化载体；含糊表面效果容易变成磨损或文化缺席。', en: 'Camera-internal functional order is a more reliable carrier; vague surface effects can read as wear or cultural absence.' },
    next: { zh: '要求载体在正常尺寸可见，并绑定精确物理区域或功能层级。', en: 'Require normal-size carrier legibility tied to an exact physical zone or functional hierarchy.' },
    strategies: [{ zh: '流动式相机体量', en: 'Flow enclosure' }, { zh: '内部功能秩序', en: 'Internal order' }, { zh: '表面路径', en: 'Surface routing' }, { zh: '边缘节奏', en: 'Edge cadence' }],
    promptFiles: ['01-paisley-flow.prompt.txt', '02-paisley-internal-order.prompt.txt', '03-paisley-surface-routing.prompt.txt', '04-paisley-edge-cadence.prompt.txt'], schemaFiles: ['schema-v0.6.0-candidate.json'],
  },
  {
    number: 8, phase: 2, status: 'reject', score: 59,
    title: { zh: '曼陀罗（Mandala）：径向秩序', en: 'Mandala Radial Order' },
    intent: { zh: '曼陀罗（Mandala）', en: 'Mandala' },
    question: { zh: '中心—外围层级和径向节奏，能否在不生成花盘图形的情况下保持可见？', en: 'Can centre-to-periphery hierarchy and radial cadence remain visible without becoming a rosette graphic?' },
    verdict: { zh: '拒绝：四图中两张违反裸机整体连续性门禁。', en: 'Reject — two outputs failed the naked whole-body continuity gate.' },
    learning: { zh: '可见不等于可信；边缘和表面载体必须保持齐平、无边框和连续转面。', en: 'Visible does not mean credible; perimeter and surface carriers must remain flush, borderless and continuous.' },
    next: { zh: '加入整体连续性约束，并用安全的相机内部秩序搭配一个次级可见关系。', en: 'Add whole-body continuity and pair safe camera-internal order with one subordinate visible cue.' },
    strategies: [{ zh: '固定环节奏', en: 'Retention cadence' }, { zh: '横梁焦点', en: 'Crossbar focus' }, { zh: '倒角扩散', en: 'Chamfer diffusion' }, { zh: '表面聚焦', en: 'Surface focus' }],
    promptFiles: ['01-mandala-retention-cadence.prompt.txt', '02-mandala-crossbar-focus.prompt.txt', '03-mandala-chamfer-diffusion.prompt.txt', '04-mandala-surface-focus.prompt.txt'], schemaFiles: ['schema-v0.7.0-candidate.json'],
  },
  {
    number: 9, phase: 2, status: 'pass', score: 85,
    title: { zh: '莲花（Lotus）：分层涌现', en: 'Lotus Layered Emergence' },
    intent: { zh: '莲花（Lotus）', en: 'Lotus' },
    question: { zh: '齐平表面与连续周界约束，能否把莲花（Lotus）转译为嵌套展开和轻盈层次，而非花瓣？', en: 'Can flush-surface and continuous-perimeter constraints translate Lotus through nested opening and buoyant layering without petals?' },
    verdict: { zh: '通过：四个方向均满足整体连续性。', en: 'Pass — all four directions retained whole-body continuity.' },
    learning: { zh: '硬质嵌套相机层级最清晰；笼统的哑光、缎面或清漆描述仍缺乏可见确定性。', en: 'Rigid nested camera layers are clearest; generic matte, satin or clear-coat language remains visually ambiguous.' },
    next: { zh: '为每种 CMF 指定真实工艺、可见特征、区域、尺度与边界。', en: 'Name the real process, visible signature, zone, scale and boundary behaviour for each CMF move.' },
    strategies: [{ zh: '嵌套镜头座', en: 'Nested seats' }, { zh: '分层横梁', en: 'Layered crossbar' }, { zh: '表面涌现', en: 'Finish emergence' }, { zh: '倒角展开', en: 'Chamfer opening' }],
    promptFiles: ['01-lotus-nested-seats.prompt.txt', '02-lotus-layered-crossbar.prompt.txt', '03-lotus-finish-emergence.prompt.txt', '04-lotus-chamfer-opening.prompt.txt'], schemaFiles: ['schema-v0.8.0-candidate.json'],
  },
  {
    number: 10, phase: 3, status: 'pass', score: 84,
    title: { zh: '孔雀（Peacock）：工艺与创新预算', en: 'Peacock Process + Innovation Budget' },
    intent: { zh: '孔雀（Peacock）', en: 'Peacock' },
    question: { zh: '命名 CMF 工艺和独立创新预算，能否产生更明确的可见差异，同时避免孔雀形似？', en: 'Can named CMF processes and an independent innovation budget create visible specificity without peacock resemblance?' },
    verdict: { zh: '通过，但未超过当前最佳；部分工艺仍漂移成羽毛状图形。', en: 'Pass, below the current best; some processes still drifted into feather-like graphics.' },
    learning: { zh: '工艺名称提升了具体性，但不能自动保证抽象；创新幅度应与文化比例分开控制。', en: 'Process names improve specificity but do not guarantee abstraction; innovation posture should remain separate from cultural ratio.' },
    next: { zh: '为工艺增加允许的视觉特征和形似检查。', en: 'Add permitted visual signatures and motif-resemblance checks for each process.' },
    strategies: [{ zh: '渐变 PVD 脊梁', en: 'PVD spine' }, { zh: 'IMT 深度场', en: 'IMT depth field' }, { zh: '激光纹理侧轨', en: 'Laser rail' }, { zh: 'NCVM 相机平台', en: 'NCVM court' }],
    promptFiles: ['01-peacock-pvd-spine.prompt.txt', '02-peacock-imt-depth-field.prompt.txt', '03-peacock-laser-rail.prompt.txt', '04-peacock-ncvm-court.prompt.txt'], schemaFiles: ['schema-v0.9.0-candidate.json'],
  },
  {
    number: 11, phase: 3, status: 'pass', score: 83,
    title: { zh: '生命之树（Tree of Life）：功能层级', en: 'Tree of Life Functional Hierarchy' },
    intent: { zh: '生命之树（Tree of Life）', en: 'Tree of Life' },
    question: { zh: '工艺外观守则能否通过真实相机、中框和接缝关系表达主干—分支—末端，而不画树？', en: 'Can process appearance guards translate trunk–branch–terminal hierarchy through functional relationships without drawing a tree?' },
    verdict: { zh: '通过但低于最佳；负面禁令把一个方向推向了电路线感。', en: 'Pass below the current best; a negative ban redirected one output toward circuit-line styling.' },
    learning: { zh: '正向允许特征应主导提示词；过长接缝和依赖光照的 IMT 场不可靠。', en: 'Positive permitted signatures should dominate; long seams and lighting-dependent IMT fields are unreliable.' },
    next: { zh: '压缩为一种工艺、一个区域、一种正向效果和一个边界。', en: 'Reduce the rule to one process, one zone, one affirmative effect and one boundary.' },
    strategies: [{ zh: '纵向工具脊梁', en: 'Vertical tool spine' }, { zh: '中框馈入横桥', en: 'Frame-fed bridge' }, { zh: '装配节奏', en: 'Assembly cadence' }, { zh: '嵌入路径', en: 'Embedded route' }],
    promptFiles: ['01-tree-vertical-tool-spine.prompt.txt', '02-tree-frame-fed-bridge.prompt.txt', '03-tree-assembly-cadence.prompt.txt', '04-tree-embedded-route.prompt.txt'], schemaFiles: ['schema-v1.0.0-candidate.json'],
  },
  {
    number: 12, phase: 3, status: 'pass', score: 85,
    title: { zh: '大象意象（Elephant）：沉稳体量与保护', en: 'Elephant: Calm Mass and Protection' },
    intent: { zh: '大象意象（Elephant）', en: 'Elephant' },
    question: { zh: '紧凑的正向工艺规格能否表达稳定和保护，同时避免动物或宗教图像？', en: 'Can a compact positive process specification express stability and protection without animal or devotional imagery?' },
    verdict: { zh: '通过并追平最佳；框架馈入的锻造鞍座与陶瓷效果肩台最强。', en: 'Pass, equal to the current best; the forged frame-fed saddle and ceramic-effect shoulder were strongest.' },
    learning: { zh: '真实功能体量比细微侧轨纹理更可靠；不可见的工艺等同于没有证据。', en: 'Functional mass carriers outperform subtle rail texture; an invisible process supplies no evidence.' },
    next: { zh: '加入呈现证明：指定观察视角、投影面积和灯光任务。', en: 'Add departure proof: revealing view, projected area and lighting task.' },
    strategies: [{ zh: '保护眉台', en: 'Protective brow' }, { zh: '锻造鞍座', en: 'Forged saddle' }, { zh: '沉稳侧轨', en: 'Grounded rail' }, { zh: '陶瓷肩台', en: 'Ceramic shoulder' }],
    promptFiles: ['01-elephant-protective-brow.prompt.txt', '02-elephant-forged-saddle.prompt.txt', '03-elephant-grounded-rail.prompt.txt', '04-elephant-ceramic-shoulder.prompt.txt'], schemaFiles: ['schema-v1.1.0-candidate.json'],
  },
  {
    number: 13, phase: 3, status: 'pass', score: 86,
    title: { zh: '海娜手绘（Mehndi）：线密度工艺', en: 'Mehndi Line Density as Process' },
    intent: { zh: '海娜手绘（Mehndi）', en: 'Mehndi' },
    question: { zh: '呈现证明字段能否让细微工艺可被判断，同时把海娜手绘（Mehndi）控制在克制的次级层？', en: 'Can departure proof make subtle craft processes judgeable while Mehndi remains a restrained secondary layer?' },
    verdict: { zh: '通过并创造新最佳。', en: 'Pass — new best.' },
    learning: { zh: '相机硬件上的激光蚀刻和微铣刀路最稳定；宽幅 IMT 容易扩张成满版图案。', en: 'Laser etching and micro-milled toolpaths on camera hardware are robust; broad IMT fields tend to become all-over patterns.' },
    next: { zh: '用“一个有界物理零件”约束文化载体覆盖范围。', en: 'Constrain cultural-carrier coverage to one bounded physical part.' },
    strategies: [{ zh: '激光蚀刻鞍座', en: 'Laser saddle' }, { zh: '微压纹侧轨', en: 'Embossed rail' }, { zh: 'IMT 背板带', en: 'IMT ribbon' }, { zh: '微铣镜头平台', en: 'Milled court' }],
    promptFiles: ['01-mehndi-laser-saddle.prompt.txt', '02-mehndi-embossed-rail.prompt.txt', '03-mehndi-imt-ribbon.prompt.txt', '04-mehndi-milled-court.prompt.txt'], schemaFiles: ['schema-v1.2.0-candidate.json'],
  },
  {
    number: 14, phase: 4, status: 'reject', score: 59,
    title: { zh: '彩砂地画（Rangoli）：功能节点秩序', en: 'Rangoli Functional Node Order' },
    intent: { zh: '彩砂地画（Rangoli）', en: 'Rangoli' },
    question: { zh: '一个有界功能零件能否承载彩砂地画（Rangoli）的间距、对称和连续性，同时避免地画与假开孔？', en: 'Can one bounded functional part carry Rangoli spacing, symmetry and continuity without floor-art graphics or fake apertures?' },
    verdict: { zh: '拒绝：一个方案复制了可识别的竞品相机组合。', en: 'Reject — one output copied a recognizable competitor camera signature.' },
    learning: { zh: '有界载体解决了纹样溢出，却不能自动保证原创性；成熟不能通过复制获得。', en: 'Bounded carriers prevented spillover but did not guarantee originality; maturity cannot be achieved through copying.' },
    next: { zh: '加入组合级原创性检查：外轮廓、镜头、闪光灯、中框关系与 CMF 联合判断。', en: 'Add a combination-level originality check across enclosure, lenses, flash, frame relationship and CMF.' },
    strategies: [{ zh: '微铣镜头平台', en: 'Milled court' }, { zh: 'PVD 横桥', en: 'PVD bridge' }, { zh: '压纹侧轨', en: 'Embossed rail' }, { zh: 'IMT 鞍座', en: 'IMT saddle' }],
    promptFiles: ['01-rangoli-milled-court.prompt.txt', '02-rangoli-pvd-bridge.prompt.txt', '03-rangoli-embossed-rail.prompt.txt', '04-rangoli-imt-saddle.prompt.txt'], schemaFiles: ['schema-v1.3.0-candidate.json'],
  },
  {
    number: 15, phase: 4, status: 'pass', score: 87,
    title: { zh: '阿育王法轮（Ashoka Chakra）：连续节奏', en: 'Ashoka Chakra: Continuous Cadence' },
    intent: { zh: '阿育王法轮（Ashoka Chakra）', en: 'Ashoka Chakra' },
    question: { zh: '组合级原创性与功能零件上的精确节奏，能否避免车轮图形和竞品复制？', en: 'Can combination-level originality and functional process cadence avoid wheel graphics and copied competitor signatures?' },
    verdict: { zh: '通过并创造最终最佳。', en: 'Pass — new best.' },
    learning: { zh: '镜头固定环、横桥边缘和声学格栅上的功能微节奏，比符号化表面图形更稳健。', en: 'Functional micro-cadence on retention rings, bridge edges and acoustic grilles is more robust than symbolic graphics.' },
    next: { zh: '保留原创性、命名工艺、有界载体和呈现证明，测试相机—机身整合。', en: 'Retain originality, named process, bounded carrier and proof while testing camera-to-chassis integration.' },
    strategies: [{ zh: '金刚石切削主环', en: 'Diamond-cut main ring' }, { zh: '滚花电源键', en: 'Knurled power key' }, { zh: '光刻横桥边缘', en: 'Photo-etched bridge edge' }, { zh: '声学格栅节奏', en: 'Acoustic grille cadence' }],
    promptFiles: ['01-chakra-diamond-ring.prompt.txt', '02-chakra-knurled-key.prompt.txt', '03-chakra-etched-bridge.prompt.txt', '04-chakra-speaker-cadence.prompt.txt'], schemaFiles: ['schema-v1.4.0-candidate.json'],
  },
  {
    number: 16, phase: 4, status: 'reject', score: 59,
    title: { zh: '倒角 × 相机矩阵与印度镂空格栅（Jali）特色', en: 'Chamfer × Camera Matrix with Jali Character' },
    intent: { zh: '印度镂空格栅（Jali）', en: 'Jali' },
    question: { zh: '相机—机身整合链能否让四种倒角与相机组合形成清晰、相关但不同的主流手机？', en: 'Can camera-to-chassis integration make four chamfer and camera combinations distinct, related and physically coherent?' },
    verdict: { zh: '拒绝：一张正面违反中性屏幕门禁，且共同的印度镂空格栅（Jali）没有被清晰执行。', en: 'Reject — one front violated the neutral-screen gate and the shared Jali grille was not visibly executed.' },
    learning: { zh: '2×2 形态矩阵成立，但长 Prompt 会丢失重复不变量，次级文化载体也可能在呈现中消失。', en: 'The 2×2 form matrix worked, but long Prompts can lose repeated invariants and hide subordinate cultural carriers.' },
    next: { zh: '最终整合应提升中性正面为显著不变量，并分别证明主创新与次级文化载体。', en: 'Final consolidation should elevate the neutral front and separately prove the leading departure and supporting carrier.' },
    strategies: [{ zh: '平框 × 横向桥', en: 'Flat rail × horizontal bridge' }, { zh: '平框 × 纵向轴', en: 'Flat rail × vertical axis' }, { zh: '后弧 × 横向鞍座', en: 'Rear arc × horizontal saddle' }, { zh: '后弧 × 纵向基准', en: 'Rear arc × vertical datum' }],
    promptFiles: ['01-flat-rail-horizontal-bridge.prompt.txt', '02-flat-rail-vertical-axis.prompt.txt', '03-rear-arc-horizontal-saddle.prompt.txt', '04-rear-arc-vertical-datum.prompt.txt'], schemaFiles: ['schema-v1.5.0-candidate.json'],
  },
  {
    number: 17, displayNumber: 'VALIDATION 01', phase: 5, status: 'review',
    title: { zh: '彩砂地画（Rangoli）：相机功能节点秩序', en: 'Rangoli Camera-zone Integration' },
    intent: { zh: '彩砂地画（Rangoli）', en: 'Rangoli' },
    question: { zh: '拓扑中立的嵌套 Schema，能否通过功能节点秩序表达彩砂地画（Rangoli），同时保持成熟的相机架构？', en: 'Can a topology-neutral nested Schema express Rangoli through functional node order while preserving mature camera architecture?' },
    verdict: { zh: '四个方向均通过 Base Contract；保留评审，不晋升 Schema。', en: 'All four directions pass the Base Contract; retain for review without promoting the Schema.' },
    learning: { zh: '把文化秩序隐藏在真实硬件比例中最可靠；反射切面和细微边界容易退化为通用 CMF。', en: 'Cultural order is strongest when embedded in real hardware proportion; facets and subtle boundaries can collapse into generic CMF.' },
    next: { zh: '将成熟方法应用到明确的 P 系列产品角色。', en: 'Apply the mature method to a defined P-series product role.' },
    strategies: [{ zh: '加长节点秩序', en: 'Elongated node order' }, { zh: '紧凑镜像平台', en: 'Compact mirrored court' }, { zh: '连接环与接缝', en: 'Connected rings and seam' }, { zh: '边框连接反射区', en: 'Edge-linked reflectivity' }],
    promptFiles: ['01-elongated-node-order.prompt.txt', '02-compact-mirrored-court.prompt.txt', '03-connected-rings-seam.prompt.txt', '04-edge-linked-reflectivity.prompt.txt'], schemaFiles: ['phone-design-judgment-before.schema.json', 'schema-candidate.json'],
  },
  {
    number: 18, displayNumber: 'VALIDATION 02', phase: 5, status: 'review',
    title: { zh: '印度阶梯井（Stepwell）：P 系列耐用型产品验证', en: 'Stepwell-inspired P-series Validation' },
    intent: { zh: '印度阶梯井（Stepwell）', en: 'Stepwell' },
    question: { zh: '印度阶梯井（Stepwell）的浅层退台与锚定下沉关系，能否帮助 P 系列表达长续航与轻娱乐价值？', en: 'Can stepwell-like shallow setbacks and anchored descent help a P-series phone express endurance and light-entertainment value?' },
    verdict: { zh: '四图中三张通过、一张因伪硬件被拒绝；全部结果保留。', en: 'Three of four pass; one is rejected for pseudo-hardware. Every result is retained.' },
    learning: { zh: 'Schema 能支持明显不同的 P 系列方向，但密集相机区仍会诱发伪硬件，工艺载体也容易越界扩张。', en: 'The Schema supports distinct P-series directions, but dense camera courts still invite pseudo-hardware and carrier spillover.' },
    next: { zh: '继续检验更强文化表达时的功能可信度与物理边界。', en: 'Continue testing functional credibility and physical boundaries under stronger cultural expression.' },
    strategies: [{ zh: '上部动力平台', en: 'Upper Power Deck' }, { zh: '续航脊梁', en: 'Endurance Spine' }, { zh: '双环纹理场', en: 'Twin Ring Field' }, { zh: '中框馈入鞍座', en: 'Frame-Fed Saddle' }],
    promptFiles: ['01-upper-power-deck.prompt.txt', '02-endurance-spine.prompt.txt', '03-twin-ring-field.prompt.txt', '04-frame-fed-saddle.prompt.txt'], schemaFiles: ['schema-v1.4.0.json'],
  },
  {
    number: 19, displayNumber: 'VALIDATION 03', phase: 5, status: 'review',
    title: { zh: '印度高级工艺组合（Premium Indian Craft Directions）', en: 'Premium Indian Craft Directions' },
    intent: { zh: '比德里金属镶嵌（Bidri）／印度镂空格栅（Jali）／印度阶梯井（Stepwell）／米纳卡里珐琅（Meenakari）', en: 'Bidri / Jali / Stepwell / Meenakari' },
    question: { zh: '更强的印度文化工艺表达，能否在 2026 高端手机上保持成熟、功能层级、连续性与品牌中立？', en: 'Can stronger Indian craft expression preserve maturity, functional hierarchy, continuity and brand neutrality in a 2026 premium phone?' },
    verdict: { zh: '四图中两张通过、两张分别因装饰性假开孔和非中性正面被拒绝。', en: 'Two of four pass; two are rejected for decorative false apertures and a non-neutral front.' },
    learning: { zh: '比德里金属镶嵌与米纳卡里珐琅在有界硬质功能零件上成立；开放式镂空容易被误读为相机孔。', en: 'Bidri inlay and Meenakari cells work on bounded rigid functional parts; open-looking Jali voids risk becoming camera apertures.' },
    next: { zh: '保留“文化工艺必须属于真实零件”的边界，不从单批结果晋升 Schema。', en: 'Keep the rule that cultural craft belongs to a real part; do not promote a Schema change from one batch.' },
    strategies: [{ zh: '比德里午夜镶嵌（Bidri）', en: 'Bidri Midnight Inlay' }, { zh: '印度镂空格栅光影（Jali）', en: 'Jali Shadow Glass' }, { zh: '印度阶梯井层台（Stepwell）', en: 'Stepwell Terrace' }, { zh: '米纳卡里精密珐琅边（Meenakari）', en: 'Meenakari Precision Edge' }],
    promptFiles: ['01-bidri-midnight-inlay.prompt.txt', '02-jali-shadow-glass.prompt.txt', '03-stepwell-terrace.prompt.txt', '04-meenakari-precision-edge.prompt.txt'], schemaFiles: ['schema-v1.4.0.json'],
  },
]

export function copy(text: Copy, language: CaseLanguage): string {
  return text[language]
}
