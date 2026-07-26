---
name: flova-cinematic-lighting-planner
description: Use when 用户要根据剧本、参考图或视频规划电影布光、光型、色温、情绪光影、多人光向分配、运镜降级策略或镜头级 lighting prompt。（素材生成场景：为单镜头/单图生成光型、色温、光向的 lighting prompt 片段。）
---

# Cinematic Lighting Planner

## Mission

用于电影布光规划：为任何创作流程提供镜头级光型、色温、光向、多角色受光关系和运镜降级策略。

This is usually a module inside another production skill. It should not own the whole video pipeline unless the user's main request is lighting planning.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- cinematic lighting plan,
- lighting style from story or image,
- shot-by-shot light design,
- improving cinematic mood,
- multi-character light direction,
- Tyndall/volumetric light,
- noir side light, backlight, top light, under light,
- camera motion fallback when model cannot execute movement.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Use only model choices exposed by this turn's tool list. This skill outputs planning constraints and prompt fragments that other image/video skills can use.

## Intake

Collect:

- input type: text script, image, video, or reference image + background,
- aspect ratio if generating video,
- narrative beat or shot list,
- mood,
- existing light condition,
- whether user wants manual light selection or AI recommendation.

## Workflow

1. Analyze scene/story/reference.
2. Build or accept shot list.
3. Select lighting mode: manual or AI recommended.
4. Produce per-shot lighting plan.
5. Inject prompt fragments into image/video prompts.
6. QA generated result and simplify camera/light if needed.

Pause after lighting recommendation if the user asked to approve the look.

## Light Types

| Light Type | Use For | Prompt Fragment |
| --- | --- | --- |
| backlight | entrances, farewell, silhouette, mystery | strong backlight, glowing rim around hair and shoulders, face partly in shadow |
| cold top light | interrogation, pressure, isolation | harsh cool overhead light, shadows under brow and cheekbones, clinical blue-white tone |
| Tyndall/volumetric | hope, sacred reveal, dusty room, turn | visible volumetric light shafts through haze, particles suspended in warm beam |
| under light | menace, uncanny, villain, suspense | low source uplight, inverted shadows across face, dim amber or sickly green cast |
| side light | character study, tension, realism | strong side light with sharp falloff, one side lit and one side in deep shadow |
| hard light | action, conflict, hot daylight | direct undiffused source, crisp shadows, high specular highlights |
| soft light | warmth, memory, intimacy, daily life | large diffused source, feathered shadows, lifted contrast, warm soft tone |

## Narrative Recommendation

Default by beat:

- `opening`: backlight, soft light, or Tyndall.
- `development`: side light, hard light, or cold top light.
- `turn`: Tyndall for hope/reversal, under light for threat, hard light for conflict.
- `ending`: soft light, backlight, or Tyndall.

When scene physics conflicts with mood, preserve plausibility first. For example, do not force warm sunset backlight into a sealed fluorescent office unless a practical source is present.

## Multi-Character Lighting

For conflict:

- opposing light directions,
- warmer light on sympathetic side and cooler light on opposing side when useful,
- no more than two major light systems in one shot.

For alliance/intimacy:

- shared key light,
- main subject slightly brighter,
- secondary subject 50-70% intensity,
- background in ambient shadow.

For three or more:

- choose one lighting protagonist,
- reduce others by distance and importance,
- do not give every character a separate dramatic light.

## Shot Lighting Fields

Each shot should include:

- `shot_id`,
- `story_beat`,
- `mood`,
- `light_type`,
- `intensity`,
- `color_temperature`,
- `source_position`,
- `subject_light_priority`,
- `background_light`,
- `prompt_fragment`,
- `avoid`.

## Camera Motion Fallback

If generated video fails to follow camera movement:

1. Retry with simpler camera wording.
2. Replace camera motion with subject motion when possible.
3. Simplify to pan/push/follow with one direction.
4. Fall back to locked-off shot and preserve lighting.
5. Only switch model/tool with user confirmation if the harness exposes alternatives.

Do not sacrifice subject stability and lighting just to keep a complex camera move.

## Prompt Fragments

Backlight:

```text
strong backlight from behind the subject, warm rim light tracing the silhouette, hair and shoulder halo, face partly in deep shadow, high contrast
```

Cold top light:

```text
harsh cool overhead light, deep shadows under the brow and cheekbones, desaturated blue-grey skin tone, no warm fill
```

Tyndall:

```text
visible volumetric light shafts cutting through dusty air, warm particles suspended in the beam, subject isolated inside the light cone
```

Side light:

```text
strong single-source side light from camera-left, one half of the face illuminated, opposite side falls into deep shadow
```

Soft light:

```text
large diffused warm source, gentle feathered shadows, lifted contrast, intimate natural skin tone
```

## QA

Check:

- light source is physically plausible,
- color temperature fits scene/mood,
- main subject has clear light priority,
- multi-character light does not conflict,
- prompt fragment matches storyboard,
- generated output did not flatten into even light,
- camera fallback did not alter story meaning.
