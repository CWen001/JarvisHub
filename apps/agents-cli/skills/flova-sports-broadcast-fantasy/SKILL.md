---
name: flova-sports-broadcast-fantasy
description: Use when 用户上传本人照片，要生成体育转播镜头、场边嘉宾 cutaway、球场穿越幻想、世界杯倒挂金钩或直播包装风格短片。
---

# Sports Broadcast Fantasy

## Mission

用于体育直播感与体育幻想短片：基于用户参考照制作体育直播 cutaway 或体育幻想短片，同时把身份还原、直播图文、场馆氛围和运动动作拆成可验证阶段。

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- user as courtside sports broadcast guest,
- NBA/KBO/baseball/basketball/soccer broadcast-style cutaway,
- sports TV name graphic,
- arena crowd reaction video,
- sports fantasy sequence,
- being pulled into TV/screen and performing a highlight move,
- fake-but-plausible sports broadcast packaging.

Do not use it for real sports news, factual scores, or claiming the generated video is actual broadcast footage.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Use only exposed model choices and do not assume overlay/text rendering, generated commentators, or static scorebug support. When text overlays are required, prefer post/assembly if the image/video model cannot render stable text.

## Required Intake

For identity-preserving broadcast cutaway:

- user/person reference photo,
- display name or broadcast label text,
- sport/league flavor,
- venue/team context if desired,
- aspect ratio,
- duration.

If display text is missing, ask before generation. Do not invent names.

For sports fantasy:

- protagonist reference or fictional character permission,
- sport and highlight action,
- desired transformation premise,
- duration and aspect ratio.

## Modes

| Mode | Use For | Core Rule |
| --- | --- | --- |
| `broadcast_cutaway` | seated audience/courtside/stadium TV shot | start with still screenshot and confirm likeness |
| `sports_fantasy_action` | pulled into screen, bicycle kick, dunk, heroic play | split impossible action into controlled shots |

## Broadcast Cutaway Workflow

1. Verify person reference and display name.
2. Generate a broadcast-style still frame.
3. Pause for likeness and overlay review.
4. Use still frame plus original reference to generate continuous video.
5. Assemble/adjust audio and overlays if supported.
6. QA identity, text, and broadcast grammar.

The still frame is the identity gate. Do not proceed to video if the person no longer resembles the reference.

## Broadcast Still Requirements

Still frame should define:

- sport and venue,
- camera type: telephoto live broadcast cutaway,
- subject seated or standing naturally,
- surrounding crowd,
- scorebug/name graphic if supported,
- network-like graphic treatment without claiming official authenticity beyond the fictional prompt,
- broadcast compression, interlacing/grain if desired.

Text rule:

- Use exact user-provided display name.
- If text rendering is unreliable, create text-free still/video and add graphic in assembly.
- Do not invent official league marks/logos unless the user provided permission/assets and the harness supports it.

## Broadcast Video Rules

Use one continuous take unless the user asks for montage.

Natural action sequence:

- camera lands on subject,
- subject smiles/glances at field/court,
- relaxed wave,
- reacts to game/crowd,
- turns to companion or claps,
- ends naturally.

Avoid:

- constant direct eye contact,
- exaggerated acting,
- talking to camera unless explicitly scripted,
- scorebug animation if the graphic should be static,
- random subtitles.

Commentary:

- If commentary is requested, write a short, harmless line that names the display label.
- If audio generation is unavailable, return commentary text and SFX notes for assembly.

## Sports Fantasy Action Workflow

Use when the user wants a transformation or highlight move.

1. Confirm protagonist reference or generate fictional character reference.
2. Lock outfit continuity. Do not force a generic jersey unless user wants it.
3. Split into 2-4 shots based on spatial change and action complexity.
4. Generate each shot with the same character reference.
5. Use white flash, motion blur, match cut, or final frame continuity for transitions.
6. Assemble with SFX.

For impossible/complex athletic actions, do not make one overlong prompt carry the whole sequence. Use controlled shots:

- setup / portal / transition,
- arrival / stance,
- athletic action,
- landing / result.

## World Cup / Soccer Fantasy Template

Two-shot default:

- `Shot_01`: viewer watches a match; screen liquefies/portal opens; bright transition.
- `Shot_02`: protagonist appears on the pitch and performs a highlight move.

Character continuity:

- preserve hair, face, outfit, and accessories from reference,
- do not change into a football kit unless specified,
- if action requires sports shoes or equipment, ask or mark as added styling.

Action prompt should describe sequence by camera beat:

- face/stance closeup,
- rear or side setup,
- slow-motion athletic move,
- normal-speed landing and ball result.

## Prompt Rules

Use English for broadcast-style prompts if the harness performs better; otherwise use Chinese. Exact display text stays exactly as supplied.

Image prompt structure:

```text
<<<image_1>>> preserve the subject's likeness. [sport/venue/broadcast still], [subject behavior], [camera/framing], [graphic plan], [broadcast texture], no random text.
```

Video prompt structure:

```text
<<<image_1>>> <<<image_2>>> preserve identity throughout. [continuous broadcast/action sequence]. [camera behavior]. [crowd/environment motion]. [audio/SFX notes]. no subtitles, no random text, no unwanted cuts.
```

For overlays, separate:

- "model-generated approximate graphic" if acceptable,
- "post-production exact overlay" if exact text is important.

## QA

Check:

- likeness preserved,
- display name exact or flagged for post overlay,
- no unwanted official claims,
- sport/venue style coherent,
- action physically readable,
- no random subtitle/text,
- broadcast graphics are static when required,
- identity/outfit continuity across shots.

If one issue fails, regenerate or post-fix only that still, clip, overlay, or transition.
