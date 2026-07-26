---
name: flova-costume-romance-minidrama
description: Use when 用户要制作古风甜宠短剧、古装恋爱短片、男女主暧昧互动、身份悬念、反差人设、高密度糖点、1-2 分钟竖屏/横屏短剧视频。
---

# Costume Romance Minidrama

## Mission

用于古风甜宠短剧：围绕古装甜宠类型的反差人设、身份悬念、高密度糖点、站位连续和情绪节拍，制作 1:30-2:00 左右的短剧视频。

This is a genre template on top of scripted short-film production. It should coordinate with `flova-scripted-short-production` or `canvas-long-video-production` for long multi-clip execution.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- 古风甜宠短剧,
- costume romance minidrama,
- palace/jianghu/school/courtyard romance,
- meet-cute, misunderstanding resolution, intimacy escalation,
- identity-secret romance hooks,
- short video romance drama.

Do not use it for serious historical drama, action wuxia, or non-romance costume videos unless the user wants sweet-romance genre grammar.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Do not assume fixed models, exact video length, or reference_video support.

Use exposed role-image, scene-image, per-shot video, text overlay, and assembly capabilities through the proper sub-agent. Treat BGM/VO as a plan or bound user asset unless this turn exposes a real audio tool.

## Workflow

1. Confirm script source: user-provided or AI-generated.
2. Review/confirm script.
3. Confirm character references or generate character designs.
4. Confirm aspect ratio, BGM, and subtitle policy.
5. Build storyboard.
6. Generate/confirm scene images.
7. Generate videos shot by shot.
8. Create BGM/VO/subtitle plan if requested; generate or attach real assets only when supported by this turn's tools.
9. Assemble and export.

Pause after script, character images, production preferences, storyboard, scenes, video batch, and final cut.

## Genre Requirements

A strong short costume romance needs:

- contrast personas: each lead has public/private contrast.
- identity hook: each lead has a secret or hidden status.
- dense sweet beats: touch, gaze, near-distance, teasing line, protective gesture, accidental closeness.
- emotional landing every 10-15s.
- no empty transitional padding.

For AI-generated scripts:

- target 10-14 shots,
- 1:30-2:00 total,
- scene + dialogue + action format,
- each scene has an emotional landing,
- at least one explicit identity hint or reversal,
- each lead gets at least one persona-reveal moment.

## Character Policy

Use user-provided references first.

Do not hard-code one beauty standard. Character design should follow:

- user reference images,
- user-described appearance,
- genre expectations only as a secondary guide.

Each lead should have:

- face/hair/wardrobe,
- costume palette,
- accessories,
- emotional bearing,
- public persona,
- private contrast,
- secret/identity clue.

If references exist, do not alter face, hair, costume, or color without user approval.

## Scene Policy

Core scenes may include:

- palace courtyard,
- garden corridor,
- bamboo path,
- study room,
- riverside bridge,
- lantern street,
- inn room,
- academy courtyard,
- mountain pavilion.

Scene images should be realistic cinematic costume-drama spaces unless the user requests stylization:

- natural light,
- candles/lanterns,
- mist/morning/evening atmosphere,
- real architectural/material texture,
- no game-CG look by default.

## Storyboard Rules

10-14 shots by default.

Each shot:

- 8-15s if the tool supports it,
- contains at least one action beat or line,
- includes start and end positions for both leads,
- preserves continuity from previous shot,
- specifies scene, action, dialogue, camera, emotion.

Every shot must state:

- starting position/facing/hand state,
- ending position/facing/hand state.

From Shot 2 onward, opening state should reference the previous shot's ending state unless there is a clear scene/time cut.

Sweet-beat camera language:

- close-up for eye contact,
- slow push for emotional reveal,
- hands/fabric/hair ornament detail for tension,
- two-shot for distance closing,
- over-shoulder for hidden gaze,
- foreground veil/flowers/curtain for layered romance.

Avoid empty atmosphere shots unless they include micro-action, environmental motion, or emotional setup.

## Prompt Rules

Use Chinese prompts by default for this genre unless this turn's tool list performs better with English.

Video prompt structure:

1. reference binding for characters and scene,
2. continuity opening state,
3. camera move,
4. lead actions and micro-expressions,
5. dialogue with `{...}` only if video model should produce speech,
6. scene/environment motion,
7. ending continuity state,
8. negative constraints.

If dialogue/VO/subtitles are handled in post, do not force the video model to generate readable subtitles.

Negative constraints:

```text
无随机文字，无水印，无多余人物，无现代物件，无服装错乱，无脸部漂移，无字幕（若字幕后期添加）
```

## Audio And Subtitles

BGM default if requested:

- light costume-romance instrumental,
- gentle strings/pipa/dizi,
- restrained sweetness,
- no vocal lyrics by default.

Subtitle policy:

- if user wants subtitles, add in assembly/timeline, not in video generation prompts.
- align subtitles to dialogue timing.

Dialogue clarity is more important than BGM.

## Quality Review

Check:

- romance genre beats are dense enough,
- both leads remain visually consistent,
- references are preserved,
- no modern artifacts,
- start/end positions maintain continuity,
- identity hook is visible,
- sweet beats are not empty posing,
- subtitle policy followed,
- real media URLs exist.

If a shot lacks emotional landing, rewrite the beat before regenerating.

## Output Contract

Return:

- `script_source`,
- `genre_plan`,
- `characters`,
- `scene_list`,
- `storyboard`,
- `prompts`,
- `media`,
- `audio_subtitle_plan`,
- `assembly_plan`,
- `review`.

Do not present a script as a finished minidrama.
