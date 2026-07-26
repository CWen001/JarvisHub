---
name: flova-industrial-product-promo
description: "Use when 用户要基于工业产品图、设备参数、接口模块或功能卖点生成工业产品商业宣传片、科技产品广告、爆炸拆解视频、功能流光可视化或高端工业风产品展示片。"
---

# Industrial Product Promo

## Mission

用于工业产品商业宣传片：从产品图片和参数中提取结构、材质、功能逻辑，再生成五类镜头的元素图、关键帧、视频 clip 和审片反馈。

运行边界：真实生成、等待、读写、分辨率字段和节点数据以当前 JarvisHub agent harness 暴露的 canvas tools 为准。

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## Harness Boundary

- `explore`：读取产品图、参数、画布节点、已有真实 URL 和素材缺口。
- `plan`：输出用户配置、产品结构分析、五类镜头 shot manifest、旁白/字幕策略。
- `media`：生成元素图、关键帧和视频 clip；所有下游引用必须是真实图片 URL。
- `critic`：检查产品一致性、材质质感、功能可视化逻辑、拆解层次和字幕/旁白是否符合用户选择。

若用户要求 60s+、120s、180s 或最终成片拼接，优先加载 `canvas-long-video-production` 做总控；此流程提供工业产品路线和镜头规范。

## Intake

先确认六项配置，能合并成一次问题，但不要在缺配置时直接生成：

1. 时长：`15s`、`30s`、`60s`、`120s`、`180s`。
2. 画幅：`16:9` 横屏或 `9:16` 竖屏。
3. 视觉风格：冷峻工业风、赛博科技风、极简纯白高端风、暗金奢华工业风，或用户自定义。
4. 输出画质意图：默认按 harness 视频生成能力执行；若用户要高清/2K/4K，记录为后处理目标，不把未支持参数塞进视频生成工具。
5. 旁白：无旁白、男声旁白、女声旁白。
6. 字幕：仅在选择旁白后询问；无旁白时默认不加字幕。

必要输入：

- 至少一张产品图或渲染图。
- 产品全称、定位、核心功能或技术参数。

缺产品图时不要进入媒体生成。只有文字参数可以先输出方案和缺口，但不能声称能保持外观一致。

## Product Analysis

根据上传图片数量决定分析深度：

| 输入 | 分析重点 | 风险 |
| --- | --- | --- |
| 1 张图 | 轮廓比例、可见面材质、接口/屏幕/按钮/灯光；不可见面标记为推断 | 360 环绕和拆解镜头一致性风险高 |
| 2-3 张图 | 识别正面/背面/侧面/局部，交叉验证颜色、接口和细节 | 可做有限补面 |
| 4 张以上 | 按正背侧俯视和局部分组，建立完整角度档案 | 可支持环绕和拆解 |

从文字参数提取：

- 产品全称与面向客户。
- 核心功能、输入输出逻辑、模块构成。
- 可视化逻辑，例如“1 进 8 出”转成一条输入流光分叉为 8 条输出路径。
- 模块层级，例如外壳、接口模组、主板、电源、温控。

输出中必须标注每条信息来源：`direct image`、`user text`、`multi-view inference` 或 `default inference`。推断值不能当作强绑定视觉依据。

## Element Assets

视频前先生成或绑定元素图。已有满意真实 URL 时直接复用，不重复生成。

| Element | 内容 | 用途 |
| --- | --- | --- |
| `Product_Exterior` | 正面、3/4 侧面、背面或俯视 | 外观质感、环绕、开场 |
| `Module_Explode_Set` | 外壳、接口模组、主板、电源、温控等独立模块 | 爆炸拆解 |
| `PCB_Closeup` | 主板正俯视、芯片、走线、散热孔 | 主板特效 |
| `Operation_Hands` | 手指旋钮、按键、屏幕操作 | 真人极简操作 |

元素图完成前不要生成视频 clip。若某元素缺真实 URL，对应镜头保持 blocked；可继续生成不依赖该元素的其它镜头。

## Shot System

全片由五类镜头组成，五类缺一不可，除非用户明确要求只展示某一类。

| 类别 | 目标 | 常见镜头 |
| --- | --- | --- |
| 外观质感 | 建立产品质感和形体 | 360 环绕、接口/旋钮/屏幕微距、金属棱线硬光 |
| 功能可视化 | 把抽象功能变成可见信号流 | 输入端点亮、主干流光、节点爆闪、多路分叉、端口消散 |
| 爆炸拆解 | 展示内部模块和结构层次 | 合拢到分离、模块悬浮、低角度巡览、焦点切换 |
| 主板特效 | 展示技术感和内部逻辑 | PCB 微距、粒子沿走线流动、信号放大节点高亮 |
| 真人操作 | 证明产品可用性和尺度 | 旋钮慢放、按键反馈、屏幕 UI 状态变化 |

推荐时长分配：

| 总时长 | 外观 | 功能 | 拆解 | 主板 | 操作 |
| --- | --- | --- | --- | --- | --- |
| 15s | 3s | 3s | 3s | 3s | 3s |
| 30s | 6s | 6s | 6s | 6s | 6s |
| 60s | 12s | 12s | 12s | 12s | 12s |
| 120s | 20s | 25s | 25s | 20s | 30s |
| 180s | 30s | 35s | 35s | 30s | 50s |

120s 和 180s 允许增加镜头数量，但不要用重复镜头填时长。

## Prompt Rules

### Style Tokens

按用户选择使用一套主视觉，不要混搭：

- 冷峻工业风：pure black studio background, hard 45 degree key light, brushed gunmetal, cold silver sheen, tech-blue accent。
- 赛博科技风：deep space black background, electric blue and violet rim light, cyan particles, luminous grid, neon edge glow。
- 极简纯白高端风：soft light gray gradient, satin finish, clean form, even diffused light, minimal reflection。
- 暗金奢华工业风：matte black, dark gold accent, warm amber rim light, subtle mirror floor reflection。

### Functional Light Beats

功能可视化镜头必须按顺序写入：

1. 起点唤醒：输入端口由暗至亮。
2. 主干行进：流光沿主链路匀速前进。
3. 节点汇聚：节点短促爆闪并扩散粒子环。
4. 多路分叉：分支数量与输出通道或功能逻辑一致。
5. 端口消散：流光抵达输出端后留下残影再熄灭。

### Exploded View Beats

爆炸拆解镜头必须写清：

- 起始状态：完整产品合拢。
- 分离方向：外壳、接口模组、主板、电源、温控分别向哪里移动。
- 悬浮距离：模块之间保持均匀间隔。
- 运动曲线：slow ease-in-out，不要弹跳或过冲。
- 焦点顺序：接口金属面、散热孔、PCB 纹理、外壳内壁。

### Failure Avoidance

每条图片或视频 prompt 都要避免：

- no watermark
- no subtitles unless user requested subtitles
- no text overlay unless user requested text
- no cheap glow
- no neon clutter
- no cartoon style
- no warped product geometry
- no blurry product edges

## Narration And Subtitles

仅当用户选择旁白时编写旁白脚本。旁白要专业、短句、对应画面行为，不要堆空洞口号。

旁白总字数建议：

| 时长 | 字数 |
| --- | --- |
| 15s | 30-45 字 |
| 30s | 100-120 字 |
| 60s | 210-240 字 |
| 120s | 450-510 字 |
| 180s | 680-760 字 |

字幕只在用户选择旁白且选择字幕时出现。无旁白时不要自动加字幕。若本轮工具列表不支持最终视频合成或字幕叠加，必须说明只能生成 clip / 脚本 / 素材，不要假装已完成字幕成片。

## Review Checklist

critic 必须检查：

- 产品几何和接口布局是否漂移。
- 材质是否符合用户图：拉丝、喷砂、镜面、烤漆、RGB 透光。
- 功能流光是否符合参数逻辑，分叉数量是否正确。
- 拆解模块是否层次清楚，是否出现不存在的部件。
- 手部操作是否干净，手指和按键无明显畸变。
- 旁白、字幕、BGM 是否符合用户选择。
- 高画质请求是否被记录为后处理目标，而不是伪造视频生成参数。

## Output Contract

根据阶段输出其一：

- `productAnalysis`：外观、模块、功能逻辑、覆盖度、推断标注。
- `elementManifest`：元素图清单、参考 URL、缺失项。
- `shotManifest`：五类镜头、时长、参考图职责、旁白/字幕设置。
- `imageResults`：元素图或关键帧真实 `imageUrl`。
- `videoResults`：clip 真实 `videoUrl`、taskId、节点 id、失败原因。
- `review`：可用镜头、需重试镜头、最小重试建议。

不得把 queued/running、只有 taskId、只有节点存在说成已完成。缺少真实 URL 时必须继续等待、显式失败或说明阻塞。
