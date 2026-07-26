---
name: flova-themed-transformation-series
description: Use when 用户要按星座、生肖、五行、季节、自定义角色组等分组，结合节日、IP、场合或营销主题，批量生成统一镜头结构的主题变身特效短片系列。
---

# Themed Transformation Series

## Mission

用于主题变身特效短片系列：根据一组角色分类和一个主题，自动推导每组成员的信物、场景、妆造/视觉点缀、互动动作和一句台词，批量生成统一镜头结构的变身特效短片。

This is a series-production workflow. Each clip is independent, but all clips share a consistent transformation grammar.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- 十二星座/十二生肖/五行/四季变身系列,
- holiday shopping transformation clips,
- IP-themed character transformation content,
- wedding/circus/music-festival/graduation themed series,
- product or campaign talisman transformation videos,
- batch marketing clips with one repeated structure and many variants.

Do not use it for single product commercials, one-shot ads, or narrative story films unless the core idea is transformation-series production.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Use only parameters exposed by this turn's tool list.

If text-to-video, 15s clips, 16:9, or batch execution are unsupported, return prompts and a batch plan. If the harness supports parallel jobs, independent group-member clips may be generated in parallel.

## Required Intake

Ask for or infer two core parameters:

- `group_system`: the members to generate, such as zodiac signs, Chinese zodiac, five elements, seasons, custom personas.
- `theme`: the campaign or transformation world, such as 521, 618, Valentine's Day, New Year, wedding, circus, music festival, fantasy IP, game IP, graduation, product category.

For each group member, collect or infer:

- member name,
- symbolic traits,
- talisman/object,
- scene,
- styling motif,
- color palette,
- interaction action,
- short line.

If the group system is common knowledge, infer traits and let the user review. If it is custom, ask for missing member names or trait definitions.

## Style Policy

Do not copy rigid demographic or skin-tone restrictions from source material. Character appearance should follow:

- user-provided character reference, if any;
- user-specified brand/IP style;
- otherwise a consistent stylized 3D character series.

Keep characters consistent across the series, but do not arbitrarily erase or forbid skin tones, body types, or identities. If the user wants a specific art style, follow it as long as it is safe and appropriate.

Default visual basis when the user gives no style:

- stylized 3D animation,
- elegant fantasy/fashion transformation,
- ornate costume detail,
- polished game-cinematic rendering,
- no live-action realism unless requested.

## Planning Table

Before generation, output a table and ask for confirmation:

| Member | Core Trait | Talisman | Scene | Styling Motif | Palette | Interaction | Short Line |
| --- | --- | --- | --- | --- | --- | --- | --- |

Derivation rules:

- `talisman`: one recognizable object combining member symbolism and theme.
- `scene`: a space where the talisman and theme make sense.
- `styling motif`: a small visual addition to a shared base look.
- `palette`: member color plus theme color.
- `interaction`: a natural motion with the talisman or scene.
- `short line`: under about 20 Chinese characters unless user requests another language.

Examples:

- Zodiac tiger + 618 -> athletic equipment, sport flagship store, orange/gold power motif.
- Rabbit + Valentine's Day -> pink jewelry, romantic boutique, rose/crystal motif.
- Water element + music festival -> translucent soundwave token, rainy stage light, blue/silver shimmer.
- Wedding theme + spring -> bouquet/ring box, garden aisle, floral lace motif.

Do not generate until the table is approved or the user has asked for autonomous execution.

## Clip Structure

Each member clip should follow the same six-part structure:

1. Empty scene opening: no character visible.
2. Talisman/object is thrown upward or enters with strong motion.
3. Object lands or triggers a transformation burst.
4. Particles/energy/material spiral from feet/body base to head and form the character styling.
5. Camera pulls back to reveal full body and scene.
6. Camera orbits or pushes in; character interacts with talisman/scene and speaks the short line.

This structure is intentionally repeatable. Variation should come from talisman, scene, styling motif, palette, interaction, and line.

## Prompt Assembly

Build each video prompt from confirmed table fields.

Template:

```text
画面开场，[scene description]，画面内没有任何人物。
[talisman] 从画面下方向上快速抛起，镜头跟随 [talisman] 的抛物线运动。
[talisman] 落地瞬间化为 [color/material] 粒子，粒子螺旋环绕，从地面向上逐步实体化。
先出现 [footwear/base styling]，再出现 [costume/styling motif]，最后完整呈现 [character description following user reference or series style]。
镜头快速拉远，展示角色全身与 [scene] 背景，[interaction action]。
镜头 360 度环绕并缓慢推近至面部特写，角色 [ending gesture/gaze]，说出 {[short line]}。
无背景音乐，无字幕，无水印，无其他人物。
```

If the model should not generate speech, remove the spoken-line wrapper and mark the line for later VO/subtitle handling instead. If subtitles are forbidden, do not ask the video model to render the line visually.

All prompts should use the user's language by default. If the user requests a different language for lines, preserve that exact language for dialogue.

## Visual Consistency

Across all member clips:

- same base art style,
- same camera structure,
- similar clip duration,
- similar transformation rhythm,
- consistent quality and rendering,
- no random extra characters,
- no uncontrolled text/subtitles/watermarks.

Per-member differences:

- talisman,
- scene,
- color,
- motif,
- interaction,
- line,
- expression/attitude.

## Batch Execution

Because each member clip is independent, the harness may run them in parallel if supported.

Batch process:

1. Confirm planning table.
2. Generate prompt per member.
3. Submit independent video jobs.
4. Track each job status.
5. Review clips.
6. Regenerate failed clips only.
7. Return a series table with URLs and review notes.

Do not let a failed member block completed members unless the user needs all clips in one final assembled reel.

## Safety And Brand Constraints

Avoid:

- gore,
- injury,
- violent harm,
- sexualized minors,
- non-consensual transformation framing,
- unwanted body deformation,
- random animal ears/horns/tails/wings unless the user explicitly wants fantasy traits and they are appropriate,
- unauthorized IP logos or exact protected characters when the user only names a general theme.

For IP-like themes, adapt broad visual motifs rather than copying exact protected designs unless the user owns or supplies the assets and rights context.

## Quality Review

For each clip, check:

- member identity and theme are recognizable,
- talisman matches the planning table,
- empty opening has no character,
- transformation sequence is visible,
- character reveal is clear,
- interaction and line match the table,
- no background music if forbidden,
- no subtitles/text/watermark unless explicitly allowed,
- no extra characters,
- art style consistent across series,
- actual video URL exists before marking complete.

If one clip fails, regenerate that member with a tighter prompt; do not regenerate the whole series automatically.

## Output Contract

Return:

- `group_system`: member list and traits.
- `theme`: campaign/theme interpretation.
- `planning_table`: confirmed or proposed table.
- `batch_prompts`: prompt per member.
- `media`: per-member video URLs or pending states.
- `review`: per-member pass/fail notes.
- `next_actions`: regenerate failed clips, assemble reel, or create cover/title card if needed.

Do not present ungenerated prompts as completed clips.
