---
name: flova-pet-anthropomorphic-vlog
description: Use when 用户上传猫狗等宠物照片，要制作萌宠拟人打工 Vlog、猫猫情感短片、宠物职场梗、双宠物日常或系列化宠物剧情。
---

# Pet Anthropomorphic Vlog

## Mission

用于萌宠拟人 Vlog：用真实宠物身份作为视觉锚点，把人类处境、职场梗或集体情绪翻译成宠物能自然表演的短视频。

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- cat/dog workday vlog,
- pet as office worker / designer / barista / boss,
- anthropomorphic pet comedy,
- cat emotional short,
- pet replacing human situations,
- two-pet or pet group daily story,
- pet series planning.

Do not use it for normal pet portrait generation or human POV romance scenes.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model for image analysis, image generation, video generation, review, and assembly. Treat audio as plan or bound asset unless a real audio tool is exposed.

## Hard Intake Rule

Require at least one clear pet reference image unless the user explicitly wants a fully fictional pet. For identity-preserving work, the image must show face, body/coat, and distinguishing marks clearly enough.

If multiple pet images are provided, classify:

- same pet, different angles,
- different pets,
- pose/environment reference only,
- conflicting references.

Ask for confirmation before binding references.

## Safety and Tone

The pet may be anthropomorphized, but must remain an animal character.

Avoid:

- turning the pet into a human,
- realistic animal injury, abuse, danger, overwork harm, or pain,
- dangerous tools/traffic/mechanisms as if the pet is truly at risk,
- discriminatory profession jokes.

Workplace satire should be visual, light, and fictional.

## Modes

| Mode | Use For | Core Rule |
| --- | --- | --- |
| `pet_workday_vlog` | job/persona-based funny daily video | profession DNA + pet visual DNA |
| `pet_emotional_short` | nostalgia, reunion, childhood, healing | cat body + human situation + collective emotion |
| `multi_pet_vlog` | two pets, cat/dog pair, group interaction | each pet has separate identity card |

## Workflow

1. Analyze pet visual DNA.
2. Confirm anthropomorphism level and video spec.
3. Choose profession/emotional situation/story direction.
4. Draft storyboard.
5. Generate or bind pet character references and scene references.
6. Generate shot videos.
7. Add BGM/SFX/VO only if requested by mode.
8. Assemble and QA.

Pause after visual DNA/spec, story direction, storyboard, character reference, first clip/batch, and final assembly.

## Pet Visual DNA

Extract:

- species/breed if known,
- coat color and pattern,
- face shape,
- eye color/shape,
- ears,
- tail,
- body size,
- posture habits,
- unique marks,
- temperament impression,
- safe anthropomorphic options.

This becomes the identity authority. Do not rewrite pet appearance per shot.

## Anthropomorphism Level

Confirm one:

- `light`: mostly natural pet behavior, small props/costume.
- `medium`: pet wears work accessories and interacts with scaled props.
- `strong`: pet performs stylized human-like scenes, but still visibly animal.

Even in strong mode, preserve pet anatomy, coat, and recognizable identity.

## Pet Workday Vlog

Define profession DNA:

- profession title,
- workplace,
- daily tasks,
- visual props,
- workplace joke,
- 3s hook,
- 7s climax,
- ending gag.

Useful profession routes:

- programmer pet,
- designer pet,
- barista pet,
- convenience-store pet,
- office clerk pet,
- boss pet,
- customer-service pet,
- teacher pet,
- doctor pet,
- lawyer pet,
- chef pet,
- streamer pet,
- photographer pet,
- security pet.

Every joke must be visible. For example, "requirements changed" needs a screen/message/sticky-note reaction, not just a subtitle.

## Pet Emotional Short

Use the formula:

```text
pet body x human situation x collective emotion
```

Choose:

- collective emotion: nostalgia, longing, grievance, healing, reunion,
- human situation: childhood, dorm life, graduation, returning home, workplace, family meal,
- memory anchors: soda bottle, old desk, rooftop, village shop, school bag, lunchbox, train station.

Three layers:

- cute hook in first 0-5s,
- anthropomorphic story in 60-70% of runtime,
- emotional close in last 10-15%.

Avoid heavy narrated sentiment. Let action, silence, and a small final gesture carry the emotion.

## Storyboard Rules

Each shot must include:

- `shot_id`,
- `scene_location`,
- `pet_character_ids`,
- `visible_pet_behavior`,
- `anthropomorphic_action_if_any`,
- `scaled_props`,
- `camera_style`,
- `duration`,
- `audio_notes`,
- `continuity`.

Default:

- 9:16,
- 15s/30s/45s/60s options,
- shots of 3-5s for vlog comedy,
- 6-10s for emotional moments,
- low/animal-height handheld, selfie-like, or gentle documentary camera.

Use natural animal behavior first: walking, sitting, pawing, sniffing, blinking, tail movement, hiding, stretching, napping. Add human-like props only when needed.

## Asset Rules

For each pet:

- create/bind one character reference image,
- if needed, create a double-panel reference: head/face closeup + full-body costume pose,
- for two pets, also create a two-pet scale reference if consistent same-frame size matters.

Scene assets:

- create only for recurring workplaces/rooms/locations,
- record light, prop layout, and pet-scale object sizes.

## Audio Rules

Default:

- no narration,
- no heavy subtitles,
- SFX and BGM are optional.

For workday comedy:

- light BGM is allowed,
- environmental SFX: keyboard, office AC, coffee machine, scanner, door chime.

For emotional shorts:

- BGM can carry emotion,
- use pet sounds sparingly,
- avoid over-explaining with VO.

## Prompt Rules

Use reference placeholders for pet identity. Do not re-describe pet appearance in every shot unless needed for identity correction.

Video prompt order:

1. camera style,
2. pet action,
3. prop/environment reaction,
4. sound cue,
5. negative constraints.

Always include:

```text
preserve the pet identity from the reference image, realistic animal texture, pet-scale props, no subtitles, no random text
```

For human presence:

- show only hands, back, or partial body when useful,
- avoid generating identifiable human faces unless the user provided/approved them.

## QA

Check:

- pet identity stable,
- pet remains animal-like,
- props are scaled to pet body,
- workplace/emotion joke is visible without explanation,
- no unsafe or harmful animal behavior,
- no unwanted subtitles,
- continuity of costume, props, and scene light.

Fix one shot or reference at a time.
