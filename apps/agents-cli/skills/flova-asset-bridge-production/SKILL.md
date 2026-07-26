---
name: flova-asset-bridge-production
description: Use when 用户已有一批独立图片、视频、音频或画布资产，想继续串成短片、补桥接镜头、做故事板、转视频或合成完整作品。
---

# Asset Bridge Production

## Mission

用于已有资产续作：先盘点现有图片、视频、音频或画布节点，再围绕这些资产搭建故事板、补缺口、生成桥接片段和合成视频。

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- user already generated assets,
- turn existing images into a video,
- continue from existing clips,
- build a story around provided images/videos/audio,
- bridge disconnected assets,
- map assets into storyboard slots,
- avoid wasting already approved assets.

Do not use it when the user wants a full new production from scratch with no existing assets.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Do not assume asset IDs exist unless visible in current canvas facts or supplied by the user. If IDs are unavailable, identify assets by filename, URL, or node label and ask the harness/tool layer to bind them when possible.

## Asset-First Rule

Existing assets are the source of truth.

Do not ignore, replace, or regenerate approved assets unless:

- the user explicitly asks to replace them,
- an asset is unusable,
- the storyboard requires a missing continuity bridge.

## Workflow

1. Inventory all existing assets.
2. Summarize each asset.
3. Ask/confirm final goal.
4. Create final video spec anchored to assets.
5. Build storyboard with explicit asset placement.
6. Audit gaps.
7. Create only missing visual assets and video clips; bind existing audio or create an audio plan unless a real audio tool is exposed.
8. Assemble and QA.

Pause after inventory/spec, storyboard mapping, gap generation, and final assembly.

## Inventory Format

Create an asset table:

- `asset_ref`: ID/path/URL/node label,
- `type`: image/video/audio,
- `content_summary`,
- `best_use`: character, scene, prop, B-roll, keyframe, music, SFX,
- `quality_notes`,
- `must_use`: yes/no/unknown,
- `constraints`.

If an asset is video/audio, note approximate duration and important timestamps if available.

## Final Spec

Must state:

- story/goal is anchored to existing assets,
- which assets are mandatory,
- which assets are optional,
- allowed new generation scope,
- duration and aspect ratio,
- output style,
- audio/subtitle policy.

## Storyboard Mapping

Every existing mandatory asset must be assigned to one of:

- `key_element`,
- `shot`,
- `audio_layer`,
- `transition/reference`,
- `cover/social asset`.

Each shot must include:

- `shot_id`,
- `story_function`,
- `required_asset_refs`,
- `new_generation_needed`,
- `bridge_reason`,
- `duration`,
- `camera_language`,
- `continuity_in`,
- `continuity_out`.

If an asset cannot fit the story, say why and ask whether to exclude it.

## Gap Audit

Only generate for real gaps:

- missing character reference,
- missing scene establishing shot,
- missing transition,
- missing action clip,
- missing audio,
- missing cover.

For every proposed new generation, state:

- what it fills,
- which existing asset it must reference,
- why it is necessary.

## Prompt Rules

For image-to-video from an asset:

```text
Use <<<image_1>>> as the confirmed visual anchor. Preserve its subject, palette, composition, and material. Add only [specified motion]. No subtitles, no random text.
```

For bridge clip:

```text
Bridge from [previous asset state] to [next asset state]. Preserve [character/scene] continuity. The clip should explain the visual transition, not introduce a new subplot.
```

For asset-based storyboard:

- do not invent major new characters,
- do not change asset identity,
- do not introduce an unrelated visual style.

## Assembly Rules

Assemble in the confirmed storyboard order.

Respect:

- original video/audio timing when kept,
- image hold duration,
- music/VO alignment,
- clip continuity,
- user-approved assets.

If a video clip has no intended audio, mute embedded audio and use designed audio layers.

## QA

Check:

- every mandatory asset appears,
- no approved asset was replaced silently,
- bridges actually connect visual states,
- aspect ratio consistent,
- style continuity,
- audio sync,
- total duration,
- no unexplained new plot elements.

If QA fails, fix the smallest gap or mapping issue.
