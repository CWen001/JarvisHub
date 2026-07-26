---
name: flova-aesthetic-style-routes
description: Use when 用户点名电影导演、动画大师、港片、武侠、水墨、默片、废土、乐高、怪谈、复古流行或其他视觉美学路线，需要翻译成可执行的画面/分镜/提示词约束。（素材生成场景：把命名美学路线转成单素材的镜头/光色/构图/材质 prompt 约束。）
---

# Aesthetic Style Routes

## Mission

用于审美路线转译：不为每个导演、片种或 IP 单独建流程，而是把用户提到的审美参考转译为可执行的镜头、光色、构图、节奏、材质、表演和声音约束，供 storyboard、image、video、assembly 流程调用。

This workflow is a style adapter. It usually works with another production skill such as scripted shorts, long video, product films, MV, anime, or one-take camera routing.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill when the user asks for:

- "某导演风格",
- "大师美学",
- "港式恐怖喜剧",
- "黑白默片",
- "水墨武侠",
- "东亚文艺片",
- "废土朋克",
- "乐高风",
- "90s/日漫/手绘动画美学",
- "复古爵士/盖茨比/梦境蒙太奇",
- any named aesthetic reference that must be translated into production rules.

Do not use this as the whole production pipeline when the user needs scripts, assets, clips, or assembly. Pair it with the relevant creative skill.

## Boundary

Follow the JarvisHub Execution Model. Use only tool parameters and model choices exposed in this turn.

Avoid relying on a living artist/director name as the only prompt instruction. Convert the reference into observable style traits. For protected franchises, branded worlds, official characters, or exact scenes, create an original route inspired by broad visual grammar instead of copying names, logos, costumes, or shot-for-shot material.

## Style Route Output Contract

When using this skill, produce or inject a `Style_Route` with:

- `route_name`,
- `source_reference_user_words`,
- `safe_descriptive_route`,
- `visual_world`,
- `palette`,
- `lighting`,
- `camera_language`,
- `composition`,
- `editing_pace`,
- `performance`,
- `texture/material`,
- `sound/music_notes`,
- `negative_constraints`,
- `best_for`,
- `not_for`,
- `prompt_tail`.

The `prompt_tail` must be descriptive and usable inside image/video prompts without relying only on a proper name.

## Route Families

### Crime, Power, and Shadow

Use for crime family, mafia, tragic power, political betrayal, slow-burn menace.

Traits:

- low-key lighting,
- deep chiaroscuro,
- warm practical lamps against dark rooms,
- slow push-ins,
- still faces with controlled micro-expressions,
- old wood, leather, smoke, paperwork, heavy doors,
- sparse dialogue and long pauses.

Negative:

- no neon cyberpunk,
- no slapstick,
- no over-fast cutting.

### Medieval Political Epic

Use for dynastic power, castle politics, war councils, icy pressure.

Traits:

- torch/candle light,
- cold exterior daylight,
- stone, fur, iron, mud,
- wide halls and high-backed seats,
- symmetrical political blocking,
- slow dolly and tense table geography,
- muted palette with hard contrast.

Negative:

- no modern UI,
- no glossy fantasy game armor unless user asks.

### Symmetric Deadpan Comedy

Use for precise pastel comedy, quirky ensemble, dollhouse framing.

Traits:

- centered composition,
- flat frontal camera,
- controlled lateral pans,
- pastel or carefully blocked color palette,
- chapter-like tableaux,
- dry acting,
- miniature-like set geometry.

Negative:

- no handheld chaos,
- no random clutter,
- no asymmetric over-dramatic lighting.

### Suspense and Psychological Tension

Use for paranoia, voyeurism, locked-room dread, uncertain perception.

Traits:

- point-of-view tension,
- corridors, staircases, windows, mirrors,
- slow reveal,
- off-screen sound,
- sharp silhouette,
- restricted color palette,
- dangerous empty space in frame.

Negative:

- no gore,
- no explicit horror shock unless user asks and policy allows.

### Urban Neon Melancholy

Use for lonely city romance, memory, insomnia, rain, night streets.

Traits:

- shallow focus,
- saturated practical lights,
- reflections in glass/rain,
- obstructed framing,
- slow motion or step-print feel,
- voiceover or music can carry emotion,
- warm skin against green/red/amber urban light.

Negative:

- no clean commercial lighting,
- no direct exposition-heavy acting.

### Social Realist County/Street

Use for ordinary people, small towns, work units, factories, trains, long takes.

Traits:

- naturalistic camera,
- long observational takes,
- muted grey/earth palette,
- ambient sound,
- non-glamorous faces and locations,
- social detail in background,
- emotional restraint.

Negative:

- no hyper-stylized glamour,
- no fantasy lighting.

### Stoic Western and Desert Myth

Use for western, frontier, dry landscapes, quiet revenge, moral fatigue.

Traits:

- wide horizon,
- dust and hard sun,
- long shadows,
- minimal dialogue,
- weathered faces,
- gun/horse/vehicle details as ritual objects,
- slow build then sudden action.

Negative:

- no glossy superhero framing,
- no crowded city neon unless hybrid requested.

### Wasteland Punk

Use for desert chase, scrap vehicles, survival tribes, brutal motion.

Traits:

- orange dust, cyan sky contrast,
- aggressive vehicle movement,
- low mounted cameras,
- metal, leather, rust, smoke,
- kinetic editing,
- practical stunt feeling.

Negative:

- no clean sci-fi chrome,
- no soft pastel.

### Chinese Color Spectacle

Use for grand historical pageantry, ritual, court, war, heroic color symbolism.

Traits:

- one dominant color per sequence,
- mass choreography,
- flags, silk, armor, palace/courtyard geometry,
- top-down or wide symmetrical compositions,
- strong contrast between individual and group,
- ceremonial percussion and silence.

Negative:

- no random mixed palette,
- no casual modern props.

### Ink Wuxia and Classical Martial Arts

Use for wuxia, sword, mountain temples, brush-painting atmosphere.

Traits:

- mist, negative space, ink wash gradients,
- restrained action before explosive movement,
- bamboo, water, roof tiles, robes,
- silhouettes and flowing fabric,
- lyrical camera movement,
- percussion/guqin/flute sound notes.

Negative:

- no modern neon,
- no overly literal game VFX unless requested.

### Hong Kong Folk Horror Comedy

Use for folk ritual, talismans, slapstick fear, old street alleys, temple interiors.

Traits:

- warm tungsten mixed with sickly green/blue night,
- paper talismans, incense, wooden doors, cluttered interiors,
- fast reaction comedy,
- practical props,
- exaggerated but readable blocking,
- suspense resolved with comic timing.

Negative:

- no graphic gore,
- no solemn prestige-horror only if user wants comedy.

### Black-and-White Silent Slapstick

Use for silent film, physical comedy, vintage city/stage gag.

Traits:

- monochrome,
- 4:3,
- locked-off or simple tracking camera,
- pantomime acting,
- exaggerated timing,
- intertitle cards only if exact text supplied,
- film grain/flicker.

Negative:

- no synchronized modern dialogue,
- no hyper-real color.

### Retro Jazz / Decadent Party

Use for 1920s glamour, doomed romance, champagne, luxury decay.

Traits:

- art deco geometry,
- gold/black/cream palette with jewel accents,
- champagne bubbles, satin, tuxedo fabric, pearls,
- sweeping party camera,
- lonely closeups after spectacle,
- jazz/brass notes.

Negative:

- no modern nightclub LEDs unless hybrid requested.

### Hand-Painted Warm Fantasy Animation

Use for warm countryside fantasy, aircraft/childhood wonder, cozy magical realism.

Traits:

- hand-painted backgrounds,
- soft natural light,
- puffy clouds, grass, wind, small machines,
- childlike wonder without copying protected characters,
- gentle camera and expressive environmental motion.

Negative:

- no exact franchise creatures, costumes, or logos.

### Teenage Sky and Light Anime

Use for youth, sky, city, rain, trains, longing, supernatural romance.

Traits:

- luminous skies,
- reflections and rain,
- high-detail background painting,
- lens flare,
- lonely small figures against vast clouds,
- emotional weather,
- clean modern school/city details.

Negative:

- no named franchise/couple replication,
- no overdark noir palette.

### Dream Montage Anime

Use for dream/reality switch, identity, surreal memory, psychological cuts.

Traits:

- match cuts,
- repeated objects,
- theatrical blocking,
- sudden reality shifts,
- saturated signs/interiors,
- layered reflections/screens,
- editing is the main effect.

Negative:

- no linear-only coverage if the user asks for dream logic.

### Maximal Abstract Animation

Use for elastic anime motion, wild color, morphing composition.

Traits:

- exaggerated squash/stretch,
- loose perspective,
- graphic color blocks,
- fast transformation,
- kinetic hand-drawn linework,
- musical rhythm.

Negative:

- no restrained realism unless hybrid requested.

### Classic Hand-Painted Chinese Animation

Use for old studio-style folk tales, paper-cut, ink, watercolor, myth.

Traits:

- visible brush texture,
- mineral colors,
- decorative clouds/waves,
- flat theatrical staging,
- elegant motion,
- handcrafted texture.

Negative:

- no glossy 3D render.

### Toy Brick / Miniature World

Use for block-toy world, stop-motion feel, playful builds.

Traits:

- plastic brick material,
- modular studs,
- miniature scale,
- stop-motion-like movement,
- playful physical transformations,
- bright but controlled colors.

Negative:

- no real brand logos unless user owns/provides them,
- avoid exact named toy branding in prompts.

### 3D Folklore / Ghost Tale

Use for stylized supernatural folktale, not graphic horror.

Traits:

- doll-like 3D faces,
- lacquer/wood/paper textures,
- lantern light,
- quiet uncanny stillness,
- slow camera,
- shadow movement.

Negative:

- no gore,
- no realistic violence.

## Applying Routes

When a route is selected:

1. State the selected route and why it fits.
2. Translate it into the `Style_Route` contract.
3. Inject only relevant constraints into the active production skill.
4. Keep route-specific negatives short and strong.
5. If multiple references are requested, define which route controls which layer: camera, palette, performance, editing, or world design.

Do not stack more than three route families in one prompt. If more are requested, ask the user to rank them or assign layers.

## Prompt Tail Examples

Use descriptive prompt tails such as:

```text
low-key chiaroscuro lighting, slow deliberate camera push, heavy wood-and-leather interior, restrained micro-expressions, sparse sound, no neon, no fast cutting
```

```text
hand-painted cel animation look, pastel color identity, soft glow rim light, ritualized transformation pose, limited-animation hold, no protected logos or exact franchise costume
```

```text
one dominant red ceremonial palette, wide symmetrical courtyard composition, mass choreography, silk and flags moving in wind, restrained heroic percussion
```

## QA

Check:

- route is descriptive, not just a proper name,
- protected/official identifiers removed when needed,
- visual style does not conflict with the production task,
- palette/camera/editing constraints are specific enough,
- negative constraints prevent the most likely drift,
- route is not overloaded with unrelated references.
