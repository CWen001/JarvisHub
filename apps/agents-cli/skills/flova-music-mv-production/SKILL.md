---
name: flova-music-mv-production
description: Use when 用户要基于上传音乐、歌词、节拍、插画角色、动画 OP/ED、青春偶像群像或史诗纯画面制作音乐 MV、舞蹈卡点视频或音画同步短片。
---

# Music MV Production

## Mission

用于音乐 MV 与音画同步短片：以音乐为主时间线，先分析音频结构，再规划视觉段落、关键元素、分镜、视频片段和最终合成。

This workflow is audio-led. The music structure controls shot timing, cut points, movement intensity, lip-sync windows, choreography counts, and final assembly.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- music video from uploaded audio,
- lyric-synced MV,
- singer or avatar lip-sync MV,
- beat-cut dance video,
- flat illustration character choreography,
- anime OP or ED,
- idol group MV,
- epic instrumental visual MV,
- music-driven montage or visualizer short.

Do not use it for product ads with only background music unless the music controls the edit. Use product/commercial skills for product-first work.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. Use only tools and model choices exposed by this turn's tool list.

Map responsibilities:

- audio analysis -> current audio/file analysis capability,
- script/storyboard -> current storyboard planner,
- character/scene/style assets -> current image generation and reference-binding tools,
- lyric/lip-sync clips -> current audio-driven video tool if exposed,
- non-lip-sync clips -> current image/video generation tools,
- assembly -> current canvas/video assembly tools.

If the harness cannot perform exact audio analysis, lip-sync, vertical generation, subtitles, or final assembly, return the best runnable plan/prompts and mark the blocked stage.

## Required Intake

Collect:

- uploaded music or requested generated music direction,
- target duration and selected segment if the audio is long,
- aspect ratio and platform,
- MV mode,
- output language for lyrics/dialogue/subtitles,
- whether lyrics, subtitles, VO, or lip-sync are required,
- existing character/scene/reference assets,
- visual style and forbidden elements,
- final deliverable: storyboard, prompts, clips, or assembled video.

If no audio is provided:

- ask whether to generate/choose a BGM direction,
- do not claim beat-accurate editing until an audio file or generated audio exists.

## Mode Selection

Choose one primary mode:

| Mode | Use For | Core Constraint |
| --- | --- | --- |
| `audio_lip_sync_mv` | singer, spokesperson, avatar, lyric performance | final audio and lyric timing must be locked before video generation |
| `instrumental_epic_mv` | orchestral/cinematic instrumental visuals | no lip-sync, no narration, music drives scale and motion |
| `flat_illustration_dance_mv` | 2D character/pet/illustration dancing | reference image is identity anchor; choreography uses 8-count timing |
| `anime_op_ed` | anime opening/ending sequence | 90s TV OP/ED grammar, character/scene rhythm, optional ED credits |
| `youth_idol_mv` | group idol, school/youth documentary MV | handheld natural energy, group chemistry, bright rhythm |

Secondary modules may be mixed only when they do not fight the primary mode. For example, a flat illustration dance MV can borrow anime OP transition grammar, but it should still keep dance timing as the master.

## Workflow

1. Analyze audio and references.
2. Lock final video spec.
3. Build music timeline map.
4. Create visual concept and key elements.
5. Draft storyboard with shot-level timestamps.
6. Bind or generate assets.
7. Generate keyframes if needed.
8. Generate video clips by shot.
9. Assemble to the music timeline.
10. Run audio-visual QA.

Pause after:

- audio/timeline analysis,
- final video spec,
- storyboard,
- key assets,
- first generated clip or first batch,
- final assembly.

For autonomous runs, use critic review as the confirmation substitute and state the decision.

## Audio Timeline Map

Create a structured timeline before visual generation.

Minimum fields:

- `audio_id`,
- `duration_ms`,
- `bpm` if detectable,
- `meter` if detectable,
- `sections`: intro, verse, pre-chorus, chorus, bridge, outro, drop, build,
- `strong_beats`: timestamp list,
- `energy_curve`: low, medium, high, drop, release,
- `lyric_lines`: `line_id`, text, `start_ms`, `end_ms` if available,
- `cut_windows`: recommended cut points,
- `performance_windows`: where singer/dancer/lip-sync should appear.

Rules:

- Do not cut through a lyric phrase unless the user explicitly asks for glitch/fragmented editing.
- For lyric-sync shots, include about 0.5-1s buffer around phrase boundaries when possible.
- Keep generated lip-sync clips at original timing. Do not time-stretch lip-sync output in final assembly.
- If the audio is longer than the requested duration, propose a segment with clear start/end timestamps.

## Final Video Spec

Lock:

- title,
- primary mode,
- duration and exact audio segment,
- aspect ratio,
- platform,
- visual style,
- output language,
- subtitle policy,
- lip-sync policy,
- asset policy,
- clip generation strategy,
- final assembly strategy,
- QA criteria.

If the user changes the audio segment, regenerate the timeline map and dependent storyboard timing.

## Key Elements

Register:

- performer/lead character,
- secondary characters or idol members,
- recurring scenes,
- stage/set,
- key props,
- style references,
- uploaded music as the master audio layer.

For characters, store:

- identity anchors from uploaded references,
- outfit variants,
- movement limits,
- facial/performance tone,
- voice or singing role if supported.

For flat illustrations:

- classify flat art vs realistic/rendered reference,
- extract linework, color, costume, silhouette, movable parts,
- if only a head/bust exists, mark full-body details as inferred and ask before generating full-body references.

For idol/group MV:

- define each member's role without sexualized styling,
- keep natural, youth-oriented performance energy,
- track group blocking and safe composition for 9:16.

## Storyboard Rules

Every shot must include:

- `shot_id`,
- `timestamp_start`,
- `timestamp_end`,
- `audio_anchor`: lyric line, beat range, section, or drop,
- `visual_role`: performance, narrative, dance, scene, insert, transition, ending,
- `key_elements`,
- `framing`,
- `camera_movement`,
- `subject_motion`,
- `cut_or_transition`,
- `audio_notes`,
- `continuity_from_previous`,
- `generation_path`: lip-sync, image-to-video, text-to-video, or assembly-only.

Timing rules:

- dance/cardio shots should land major pose changes on strong beats,
- high-energy sections can use shorter shots,
- calm sections need longer shots and fewer visual events,
- chorus/drop should contain the clearest identity/performance beat,
- ED/ending segments should slow down and leave room for credits only if exact text is supplied.

Do not invent readable credits, logos, lyrics, or on-screen text. Use post/assembly for exact text when supported.

## Mode Details

### Audio Lip-Sync MV

Use when the user wants singing, rapping, talking, or avatar performance.

Rules:

- Final audio must exist before final video generation.
- Lyric lines must be mapped to shot windows.
- Use audio-driven video only for shots where the visible performer should mouth the audio.
- Use non-lip-sync clips for B-roll, memory shots, dance cutaways, and environment shots.
- Warn the user if they request lip-sync generation before final audio is locked.

Prompt should describe visible performance:

```text
The performer sings the selected audio phrase with [emotion], [body action], [camera movement], no subtitles, no random text, no extra music.
```

### Instrumental Epic MV

Use for orchestral, trailer, heroic, sci-fi, battlefield, landscape, or purely visual music videos.

Rules:

- No lip-sync, no narration, no subtitles by default.
- Use section-level emotional escalation: quiet setup -> build -> climax -> release.
- Wide shots should dominate when scale is important.
- Match repeated musical motifs with repeated-but-escalating visuals.
- Keep lighting and palette consistent across each section.

Prompt emphasis:

- visible scale,
- atmosphere,
- large-space camera movement,
- silhouettes or partial figures when identity is not important,
- no speech, no singer, no subtitle text.

### Flat Illustration Dance MV

Use when a single 2D character, mascot, pet, or illustration must become a dancing MV.

Rules:

- User image is the identity anchor.
- Confirm full-body availability before choreography.
- Plan choreography in 8-count blocks.
- Create or bind full-body/pose references before video if the source is cropped.
- Keep the character's line style, color palette, silhouette, and costume consistent.
- Use secondary motion: hair, sleeves, skirt, ribbons, accessories.

Storyboard should include:

- count range,
- footwork,
- arm/hand pose,
- torso/weight shift,
- expression,
- camera scale,
- transition by pose, occlusion, or match movement.

### Anime OP/ED

Use for opening/ending sequence grammar.

Rules:

- Confirm OP, ED, or both.
- 90s TV-anime style duration is usually 90s unless user requests a short version.
- OP can be character-introduction, story-preview, or emotional-montage.
- ED can be slower, reflective, or credits-oriented.
- If ED credits are requested, require exact names/text before adding them.

Common OP structure:

1. title or world image,
2. lead character reveal,
3. group/relationship montage,
4. conflict or promise,
5. high-energy action/performance,
6. ending hero frame.

Common ED structure:

1. quiet motif,
2. character alone or traveling,
3. emotional object/landscape,
4. group echo or memory,
5. fade-out / credits if text is supplied.

### Youth Idol MV

Use for school, summer, friend group, documentary handheld, practice-room, stage, and group performance videos.

Rules:

- Keep styling natural and non-sexualized.
- Prioritize believable friendship, imperfect movement, handheld presence, and warm documentary moments.
- Build from daily life -> practice -> group energy -> stage/chorus -> sunset/afterglow.
- For vertical output, avoid wide horizontal group lines; use depth stacking and single/duo closeups.

Useful scene pool:

- classroom after school,
- rooftop,
- train platform,
- riverside,
- sports field,
- convenience store exterior,
- practice room,
- festival lights,
- sunset walk.

## Prompt Rules

Write prompts in the language that best fits the this turn's tool list. Keep exact lyrics/dialogue in the intended output language.

Image/keyframe prompts:

- visible content only,
- reference placeholders and element IDs,
- camera/framing,
- lighting and palette,
- identity/style constraints,
- no random text unless exact approved text is required.

Video prompts:

- start from the shot's confirmed storyboard,
- describe motion, not backstory,
- specify subject motion, background motion, camera motion, and cut/transition,
- include `no subtitles`, `no random text`, and `no extra music` unless the tool needs another convention.

For music-led cuts:

```text
cut on the downbeat at [timestamp], movement lands on the beat, final pose holds for the transition
```

For clips that will be assembled under the master audio:

```text
silent video track, no embedded music, no subtitles
```

## Assembly Rules

Use the uploaded/generated music as the master audio track.

Assembly checklist:

- clip order matches storyboard timestamps,
- cuts land on planned beats or lyric boundaries,
- lip-sync clips are not speed-changed,
- video clip internal audio is muted unless intentionally used,
- subtitles/lyrics are added only if exact text and safe area are known,
- transitions match the section energy,
- final fade or ending pose matches audio ending.

For missing clips:

- use best available B-roll or keyframe hold only after marking the gap,
- do not silently shift lyric/lip-sync timing to hide missing footage.

## QA

Before calling the MV complete, verify:

- master audio is present and aligned,
- all shots cover the requested duration,
- no lyric phrase is accidentally cut mid-word,
- identity/style references remain consistent,
- dance/performance beats land on music,
- no accidental subtitles, watermarks, logos, or random text,
- aspect ratio and platform safe zones are respected,
- mode-specific rules are satisfied.

If QA fails, fix the smallest affected unit: one prompt, one asset, one shot, or one assembly segment. Do not regenerate the whole MV unless the core audio timeline or visual concept changed.
