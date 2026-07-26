---
name: flova-one-take-camera-route
description: Use when 用户要多人物或复杂空间的一镜到底运镜、红线路径规划、群像穿梭、角色逐个经过、空间可拍性预演或 route-to-video 工作流。
---

# One-Take Camera Route

## Mission

用于复杂空间一镜到底运镜：先设计角色、空间和可行路线，再用全景群像图 + 运镜路线图指导一镜到底视频生成。

This is a route-planning skill. It is not just a video prompt style. It should produce evidence that the camera path is physically possible before video generation.

## JarvisHub Execution Model

- 主 Agent 负责编排：读取画布事实、整理任务 brief、按阶段同步 TodoWrite 进度，并把已确认的文本成果写入画布；媒体生成、等待、拼接和评审交给具备相应能力的执行 agent 或当前可用工具。TodoWrite 不是画布写入前置条件。
- 图像、视频和拼接交给具备媒体能力的执行 agent：brief 给出稳定输出身份、用途、真实参考 URL 和关键约束；需要下游引用时必须等待真实 `imageUrl` / `videoUrl`，不能把提交态当完成态。
- 多模态验收交给 `critic` sub-agent：只读取真实媒体并评审，不生成、不补素材。
- 当前已知 canvas 工具集没有通用音频生成、音频驱动口型、末帧抽取或视频直改工具；旁白、BGM、字幕、末帧承接和精准 lip sync 只能作为后期合成计划或 `blocked` 项，除非本轮工具列表明确暴露对应能力。

## When To Use

Use this skill for:

- one-take multi-character camera move,
- camera path through a room/space,
- group reveal in one continuous take,
- route annotation image,
- red path / arrow planning board,
- passing each character once,
- complex spatial camera choreography.

Use `flova-one-shot-continuity-film` when the task is long-form narrative one-shot continuity across clips. Use this skill when the hard part is the spatial route.

## Canvas-Native Boundary

Follow the JarvisHub Execution Model. If route annotation images or first-frame/start-frame video control are not exposed, return the planning board prompt and video prompt as runnable artifacts and mark the blocked stage.

## Required Intake

Collect:

- character count,
- identity references for each character,
- scene type,
- visual style,
- aspect ratio,
- one-take rhythm: slow glide, medium pass-through, urgent close follow,
- whether each character needs a close pass,
- start and end emphasis,
- existing group image or route image if any.

## Workflow

1. Lock final video spec.
2. Generate or bind character references.
3. Generate or bind empty scene.
4. Create wide master group image.
5. Create route annotation image.
6. Generate one-take video from master image and route plan.
7. Assemble/QA.

Pause after empty scene, group master image, route plan, and generated video.

If the user already uploaded a usable group master image, skip character/scene generation. If the uploaded image already has a clear route plan, skip route annotation and extract route instructions.

## Physical Feasibility Rules

Before route generation, confirm:

- all characters are visible in the master image,
- there is a navigable path,
- the camera does not pass through walls, furniture, or bodies,
- start point matches the master image viewpoint,
- route has one start and one end,
- route covers each required subject,
- the path does not branch or reset.

Prefer a simpler route over an impressive but impossible route.

## Key Elements

Character element:

- face/hair/body/outfit,
- unique identity anchors,
- pose,
- required close-up or pass-by note.

Scene element:

- layout,
- doors/walkable zones,
- furniture,
- foreground/midground/background,
- light direction,
- obstacles,
- route-safe gaps.

## Wide Master Image

Purpose:

- lock the scene,
- place all characters,
- show a real start viewpoint,
- leave room for camera movement.

Prompt requirements:

- wide master shot,
- 16:9 unless user specifies,
- all characters visible,
- no text/overlays,
- navigable path,
- foreground/midground/background separation,
- no route lines yet.

## Route Annotation Image

Create a planning-board version of the exact same wide master image.

Rules:

- do not change character positions,
- do not change furniture, lighting, perspective, or scale,
- overlay one continuous red route line,
- add hand-drawn arrows at direction changes,
- start route from the current viewpoint,
- pass required characters in order,
- no labels unless user explicitly asks,
- no extra objects.

The route annotation is a reference only. It must not appear in final video.

## Route Extraction

If analyzing an uploaded/created route image, extract:

- start point,
- end point,
- movement sequence,
- subjects passed in order,
- pauses or close-pass moments,
- camera height changes,
- pan/tilt/orbit moments,
- obstacles to avoid.

Use this extraction to write the final video prompt.

## Video Prompt Rules

Required statements:

```text
one continuous take, no cuts, no camera reset, start exactly from the first frame/master shot
```

Route statement:

```text
follow the camera path and motion logic shown by the route planning image, but do not display any red lines or arrows in the final video
```

Momentum:

- slow glide: gentle forward movement, subtle handheld sway,
- medium pass-through: steady handheld push through the space,
- urgent close follow: fast handheld pursuit, close and reactive, but no unreadable shaking.

Coverage:

```text
briefly frame each required character clearly at least once
```

Negative constraints:

```text
no red lines, no arrows, no planning overlays, no jump cuts, no teleporting, no sudden viewpoint change, no duplicated people, no face drift, no wardrobe drift, no impossible clipping
```

## QA

Check:

- first video frame matches master image,
- no route marks visible,
- no cut/reset/teleport,
- each required character is framed clearly,
- identities and outfits hold,
- path remains physically plausible,
- no collision through objects,
- final motion matches chosen rhythm.

If QA fails:

- route problem -> simplify route annotation,
- identity problem -> strengthen references,
- path mark visible -> regenerate video with stronger no-overlay instruction,
- route ignored -> make route simpler and more visible in planning image.
