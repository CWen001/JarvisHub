---
name: flova-anime-crossover-production
description: Use when 用户要 90s 赛璐璐动画、魔法少女变身、动画 OP/ED 风格片段、次元破壁、屏幕穿越或二次元角色互动短片。
---

# Anime Crossover Production

## Mission

用于动画跨界短片：为原创动画角色、魔法变身、群像合体、屏幕破壁和现实/动画世界交互生成可控分镜、资产与视频提示词。

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- 90s hand-painted cel anime feel,
- magical transformation sequence,
- magical-girl group battle,
- anime OP/ED-like segment,
- character breaks through the screen,
- viewer pulled into another world,
- original anime character enters reality.

Do not use it to reproduce named protected anime characters, official costumes, logos, theme songs, or exact transformation shots. Use original characters and style vocabulary.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Do not assume unlisted model choices, dialogue synthesis, or perfect one-take screen break effects. If exact dialogue or SFX cannot be generated in-video, keep them as audio/assembly notes or bind user-provided audio.

## Required Intake

Collect:

- anime mode,
- original character description or reference image,
- aspect ratio: 4:3, 16:9, or 9:16,
- duration,
- output language,
- transformation/crossover direction,
- whether dialogue, BGM, SFX, OP/ED, or cover assets are needed,
- reference assets and their roles.

If the user provides a protected character reference, transform it into an original character with similar high-level traits only, removing names, logos, signature props, and distinctive protected identifiers.

## Modes

| Mode | Use For | Core Rule |
| --- | --- | --- |
| `magical_transformation` | solo or group transformation | ritualized sequence and color identity |
| `anime_battle_sequence` | magical confrontation or finale | emotion before action |
| `screen_crossover` | character enters/leaves screen/world | one physical boundary and clear material rules |
| `anime_op_ed_segment` | short OP/ED grammar | music/character rhythm over plot density |

## Workflow

1. Lock final video spec and reference mapping.
2. Analyze character/style references.
3. Create key elements.
4. Draft storyboard.
5. Generate/bind assets.
6. Generate video clips.
7. Plan or attach audio; generate it only if this turn exposes a real audio tool.
8. Assemble and QA.

Pause after spec, storyboard, character assets, key scene/keyframe, first clip/batch, and final assembly.

## Key Elements

For each character:

- daily/base form,
- transformed form,
- color identity,
- role in group,
- signature accessory/weapon,
- voice if supported.

For magical scenes:

- daily scene,
- transformation space,
- battle arena,
- villain/dark scene if any.

For crossover:

- real-world room/desk/screen,
- screen content/keyframe,
- character-in-screen form,
- character-in-reality form,
- boundary effect material.

## Magical Transformation Rules

Solo transformation sequence:

1. emotional trigger,
2. object/accessory activation,
3. body becomes light silhouette,
4. ribbons/light/energy form gloves/boots/clothes,
5. hair/accessory/headpiece change,
6. hero pose hold.

Group transformation:

- shared resolve,
- synchronized accessory raise,
- quick individual transformation flashes,
- color lights converge,
- group hero pose,
- optional declaration.

Each member's color identity must stay stable. Do not give each character a full solo transformation inside a short group sequence unless the user requests a long version.

## Anime Battle Rules

Emotion comes before action.

Confrontation rhythm:

- villain pressure,
- hero close-up/emotional hesitation,
- two-shot color contrast,
- emotional trigger,
- composition flips,
- final calm beat before battle.

Avoid turning every scene into random energy beams. Use eye closeups, stillness, symbolic objects, and short declarations.

## Screen Crossover Rules

Choose one direction:

- `character_pulls_viewer_in`: screen becomes liquid/portal; character reaches out and pulls viewer in.
- `viewer_pulls_character_out`: hard glass breaks; viewer pulls character from screen into reality.

Material rules:

- Liquid/portal direction uses membrane, ripples, soft refraction. No glass shards.
- Glass-break direction uses hard cracks, glass fragments, pixel/electric edge. No liquid membrane.

One-take rule:

- Keep one continuous POV shot when possible.
- The screen/monitor is the physical boundary.
- The character's design must stay consistent before and after crossing.
- The viewer's hands/arms remain realistic and should not gain magical effects.

## Dialogue Rules

Use exact language selected by user.

Keep lines short:

- Japanese: short conversational phrase,
- Chinese: <=10 Chinese characters where possible,
- English: <=6 words where possible.

If in-video dialogue support is unreliable, plan dialogue as an audio layer instead of embedding it into video generation.

No subtitles unless the user explicitly wants post-added subtitles.

## Prompt Rules

Use visible animation/film language:

- cel shading,
- hand-painted background,
- soft glow,
- rim light,
- limited animation hold,
- dramatic close-up,
- rotating transformation camera,
- pose freeze,
- speed lines only when stylistically appropriate.

Avoid:

- protected names/logos,
- exact official costume descriptions,
- random UI text,
- over-sexualized transformation shots,
- unreadable overlong dialogue.

Screen crossover video template:

```text
first-person POV, one continuous shot, <<<image_1>>> as confirmed start frame, [direction-specific boundary material], [character action], [viewer hand action if any], [transition into/out of screen], no subtitles, no random text, no background music unless requested.
```

## OP/ED Segment Rules

For OP:

- introduce protagonist,
- reveal group/world,
- hint conflict,
- build to action or hero pose.

For ED:

- slower rhythm,
- reflective walk/object/sky,
- emotional afterimage,
- credits only if exact text is supplied.

Use `flova-music-mv-production` when uploaded music or beat timing is the main driver.

## QA

Check:

- original character, not protected copy,
- color identities stable,
- transformation/battle emotional rhythm intact,
- screen boundary material does not conflict,
- POV not broken in crossover,
- no random text/subtitles,
- dialogue short and usable,
- generated clips preserve form transitions and character identity.

Fix one character sheet, keyframe, shot, or audio line at a time.
