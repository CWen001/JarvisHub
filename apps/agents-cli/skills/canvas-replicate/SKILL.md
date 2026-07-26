---
name: canvas-replicate
description: 多资产复刻能力：基于真实参考图片执行角色或主体替换，保持版式、构图与镜头连续性；所有"目标 / 参考"语义必须由 prompt 文字 + 稳定参考节点顺序约定承担。（素材生成场景：参考图复刻、主体/角色替换、多参考图顺序约定的单图生成 prompt 组织。）
---

# JarvisHub Replicate

你负责处理"复刻 / 替换 / 角色定妆复用 / 主体保留 + 风格迁移"任务。本 skill 不定义画布工具字段；所有"哪张图是被改造目标 / 哪些图是参考约束"的语义必须靠 **prompt 文字** + **参考节点传入顺序约定** 来表达。内部画布素材必须传 `sourceNodeId`/`assetId`，Harness/Hono 在执行时解析最新持久化 URL；Agent 不传内部 URL。

## 0. 工具调用边界

调用当前图像生成能力时，只使用当前 harness 暴露的 schema。本 skill 只约定复刻语义：

- 第 1 张参考图：被改造目标图。
- 第 2 张及之后：参考约束图，例如角色、产品、风格、场景或局部约束。
- prompt 必须显式说明哪张是目标、哪些是参考、要保留什么、要替换什么。
- 负向约束用于排除改变构图、修改背景、混脸、双主体、额外人物等失败模式。
- 不要向工具传任何当前 schema 未暴露字段；旧 role 通道、target/source/replacement 结构化字段、mask role 字段、模型 / 厂商字段都不能从本 skill 推断出来。
- 视频场景同理：第 1 张参考图作为首帧 / 驱动图，其余作为附加参考；实际字段以当前 video tool schema 为准。

复刻任务走当前图像生成能力；不要用结构 patch 自建 image 节点等待宿主 auto-run。

## 1. 输入理解

- 用户提供 N 张图 + 自然语言指令。先识别哪张是**目标**（"把这张图里的人换成 X""复刻这张海报但换成新模特""保留这个构图但换成赛博风"），哪些是**参考**。
- 若用户没明示，按"用户描述顺序最先出现的图 = 目标"或"用户在描述里加 (主图)/(target)/(待改造) 标签的图 = 目标"。
- 若仍无法判定，**必须先 ask_user 一次**，不允许猜测。
- 多张参考图共存时，先在 prompt 中提取一致性锚点（形状比例、材质、配色、关键识别特征、版式分区），再写"replicate the layout of image 1, replace the subject identity using images 2-N"这类显式说明。

## 2. Prompt 写法（替代旧 role= 通道）

原来通过结构化 role 字段传达的语义，现在必须在 prompt 里**逐字写明**。最低成立模板：

```
Image 1 is the target composition: [描述构图、镜头、版式、文字区].
Images 2..N are identity references for the subject: [描述要复用的人物/产品/风格特征].
Replicate the camera framing, lighting, and layout from Image 1.
Replace the subject identity in Image 1 with the consolidated identity defined by Images 2..N:
- Face / hair / wardrobe / proportions taken from Images 2..N.
- Pose, gesture, expression follow Image 1.
Preserve text blocks, headlines, brand marks, and information hierarchy from Image 1 verbatim where readable.
Do not introduce subjects or props not present in any reference.
```

中文版同样必须明确"目标=第几张 / 参考=第几张 / 保留项 / 替换项 / 冲突项的优先级"。

## 3. 执行策略

1. 先确认目标图与参考图集合，按 §1 / §2 写明。
2. 输出替换策略摘要：保留项、替换项、冲突项与冲突解析方式。
3. 对 9 宫格 / 镜头图片任务：保持分格与镜头顺序，逐格替换主体身份；逐格调用当前图像生成能力，每次 prompt 明确"this call regenerates panel N only"，并把目标图（panel N）放第 1 位。
4. 对带版式与文字区的设计图：保持信息层级和文案区可读性，替换主体并维持原有表达结构；prompt 中明确"preserve all readable text exactly as in image 1"。
5. 多角色 / 多主体复刻：若一张目标图包含多个被替换主体，把每个主体的参考图按"主体 1 ref → 主体 2 ref → ..."顺序追加到 `referenceImages[2..N]`，prompt 显式标注 "Image 2-3: identity for subject A in image 1; image 4-5: identity for subject B in image 1"。
6. 风格迁移类（保留主体 + 换风格）：把目标主体图作为第 1 张参考图，风格参考图作为第 2..N 张参考图，prompt 写 "preserve subject identity from image 1, transfer visual style from images 2..N"。

## 4. 多 Part / 多镜头一致性

- 同一组主体出现在多个镜头时，**所有镜头共用一组参考 sourceNodeId/assetId**（同一份角色图、同一份场景 Base 图），不要为每个镜头重新生成不同身份的 ref。
- 跨镜头一致性靠 prompt 中重复的 CH/PR 编号、外观文字描述 + 共享参考节点 ID 双重保证。
- 多 Part 故事板复刻：每个 Part 单独处理，遵循 `storyboard-image-production` 的 Scene And Part Rules 与 Continuity Lock；参考图闭集必须只包含本 Part 实际出现的主体 ref，不放冗余 ref（无关 ref 会污染 image_edit 的注意力）。

## 5. 失败策略（强制 fail-loud）

- 关键资产缺失（用户明确要复刻 X 但未提供 X 的参考图）→ 直接 `ask_user` 索取/上传素材并形成可引用节点，不允许编造未在输入中出现的关键识别特征。
- 冲突无法解（参考图之间互斥，例如同一主体两份参考图发型不同且未明确以哪张为准）→ 直接报错并说明具体缺口，请用户决策。
- 参考图数量超过 16 → 显式失败，请用户筛选关键参考图。
- 参考节点未成功持久化、已删除或无可用媒体 → 按 sourceNodeId 报错并指出哪张缺失，不回退到历史 URL。
- 用户传入像素尺寸（`1280x720`）当 `aspectRatio` → 改用比例字符串（`16:9` 等），不要塞进工具参数；如果用户坚持像素，提示"当前工具只接受比例枚举"。
- **禁止**：静默兜底（用 text_to_image 替代 image_edit）、编造 reference URL、复制内部 URL、把 prompt 文字描述当成参考图替代品、把模型字段塞进工具参数试图换模型解决一致性问题。

## 6. 与 storyboard-image-production 的边界

- 本 skill 处理的是"用户已经有清晰的目标图和参考图，要做替换/复刻"的任务。
- 如果用户的实际意图是"从剧本/分场剧情生成成套故事板分镜"，应转交 `storyboard-image-production`，不在本 skill 内独立完成。
- 复刻场景里同一组角色 ref / 场景 Base ref 的"先生成基底，再多镜头复用"链路属于 `storyboard-visual-assets` + `storyboard-image-production` 的上游视觉资产与图板生产流程；本 skill 只覆盖"已有目标版式 + 已有身份 ref -> 出新主体"这一步。
