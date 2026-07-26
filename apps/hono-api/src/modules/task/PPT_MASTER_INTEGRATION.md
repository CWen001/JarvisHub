# PPT Master Integration

This canvas integration is based on `https://github.com/hugohe3/ppt-master`.

The upstream project is a Python + agent workflow, not a browser component.
JarvisHub exposes it on the canvas as a `pptDeck` task node and a remote agent tool:

- `canvas_create_ppt_node` creates a visual PPT deck node.
- Every graph persistence boundary reconciles PPT identities. A new PPT node entering
  through create, duplicate, paste, import, full-flow upsert, rollback, or checkpoint
  restore receives a fresh server UUID and loses copied runtime/path/slide/export
  state. Existing node IDs retain workspace-bound evidence from the current database
  snapshot; ordinary updates, rollback, and checkpoint restore cannot replace the
  current project path, runtime, slide SVGs, or PPTX with historical values. Only the
  project initializer, SVG writer, and exporter may publish their respective evidence.
  Two different nodes cannot own the same workspace identity.
- `canvas_ppt_master_project_init` runs `scripts/project_manager.py init` and writes
  `pptMasterProjectPath` back to the node. `canvas_create_ppt_node` first assigns an
  immutable, server-generated `pptMasterWorkspaceId`; callers cannot provide runtime,
  workspace, status, path, slide, or export fields. Initialization accepts no
  `baseDir`. The only legal base directory is derived from the persisted JarvisHub
  ownership tuple `(projectId, flowId, nodeId, pptMasterWorkspaceId)` and is created
  under the configured `PPT_MASTER_PROJECTS_ROOT`. Success requires the upstream
  `README.md` and `svg_output/` artifacts, plus the integration's `svg_final/` write
  directory. The command validates persisted `topic_research` state and `pptResearch`
  before starting Python. Repeating the exact init for the same ownership tuple and
  target may reuse its valid materialized project (`reused: true`); an identically
  named project in any other tuple is a different directory and can never be reused.
  An existing incomplete same-tuple directory is reported as
  `ppt_master_project_conflict` and is never repaired, renamed, or deleted
  automatically. Concurrent calls for the same exact target are serialized
  in-process, so only one call starts Python and the waiter reuses that exact result.
  After Python returns, the route reloads the latest Flow, revalidates the preconditions,
  and writes with a single `updated_at` compare-and-swap; it never overwrites concurrent
  canvas edits with the pre-init snapshot.
- `canvas_ppt_master_write_slide_svg` writes an immutable
  `svg_artifacts/NN_slide_<sha256>.svg` only after a
  successful `project_init`. The project path must be owned by the current
  `(projectId, flowId, nodeId, pptMasterWorkspaceId)` tuple; a missing, stale,
  cross-workspace, or out-of-root path is rejected even when it is a fully materialized
  PPT Master project. An arbitrary existing directory is not accepted. The write tool
  never creates the project structure or re-runs initialization as a hidden side
  effect. When the
  persisted slide has `imageUrl`, SVG markup must place it with
  `<image href="{{PPT_SLIDE_IMAGE}}" .../>`. The write boundary downloads that one
  canonical source once, but only when it is recognized by the platform asset hosting
  boundary; HTTP redirects are rejected. The download enforces an 8 MB streaming limit
  and is stored as immutable `images/NN_slide_image_<sha256>.<ext>`. The tool rewrites
  the exact placeholder and rejects malformed SVG or any unresolved image reference
  before the image/SVG commit. Active SVG content (`script`, `foreignObject`, embedded
  document elements, event attributes, and script-bearing attribute values) is rejected
  structurally before persistence. The writer never overwrites a published slide slot:
  it creates a content-addressed artifact and the route publishes the inseparable
  `slides[i].svgPath/svgUrl` pair only through an `updated_at` compare-and-swap. A lost
  CAS leaves an unreferenced immutable file and cannot change the current slide. The
  artifact path must be a concrete direct child of `svg_artifacts/`, its filename index
  must equal `slides[i].index`, and its filename hash must equal its bytes.
- `canvas_ppt_master_export_to_pptx` runs `scripts/svg_to_pptx.py` and writes
  `pptxPath` / `pptxUrl` back to the node. Its public schema has no `source` field.
  Export is a pure consumer of the exact immutable artifact list in the Flow snapshot:
  it validates every artifact and SVG image reference, copies that exact list into a
  request-scoped direct child `export_source_<UUID>/` using canonical `NN_slide.svg`
  names, and invokes Python on that snapshot. The snapshot is removed on success or
  failure. Unreferenced old artifacts, `svg_final`, and `svg_output` are never export
  authorities. The converter never substitutes another source directory when the
  requested snapshot directory is missing. The requested project path
  must equal the target node's persisted materialized project path and belong to the
  same ownership tuple. Any missing, cross-workspace, or invalid flow/readiness
  evidence fails closed. Export never downloads images, injects missing elements,
  rewrites SVGs, or heals guessed filenames. The API allocates
  `exports/ppt_export_<UUID>.pptx` and passes that exact path with `-o`; output identity
  therefore does not depend on the configured external runtime's default naming. The
  API accepts `Output file:` only when it exactly equals the preallocated path and is a
  real file inside the current project's `exports/` directory; it never scans for a
  guessed "latest" result. The route publishes that result only if the same Flow
  `updated_at` used to authorize the artifact snapshot still matches; otherwise it
  returns `flow_snapshot_stale` and leaves the unique PPTX unreferenced.
- Runtime discovery reads `PPT_MASTER_HOME` or `PPT_MASTER_SKILL_DIR` first, then
  falls back to `<repo>/vendor/ppt-master/skills/ppt-master` (multiple repo-root
  candidates are probed so the API can find the skill bundle whether you start it
  from the repo root or from `apps/hono-api/`).
- Partial `pptMasterWorkflowContract` updates are merged semantically. In particular,
  `stepStatus` is merged by step key, so completing a later step cannot erase persisted
  predecessor statuses.

## Where files live

| Purpose | Location |
| --- | --- |
| Skill bundle (`SKILL.md`, `scripts/`, `templates/`, `references/`) | `vendor/ppt-master/skills/ppt-master/` |
| Per-node workspace roots | `var/ppt-master-projects/projects/<projectId>/flows/<flowId>/nodes/<sha256(nodeId)>/workspaces/<workspaceId>/` |
| Per-project working directories (`svg_artifacts/`, `images/`, `exports/`) | `<workspace-root>/<projectName>_<format>_<date>/` |

Both directories are git-ignored. `scripts/dev.sh local` provisions the vendored
skill bundle automatically: if `vendor/ppt-master/skills/ppt-master/SKILL.md` is
missing it re-clones from upstream and trims `.git`, `examples/`, `projects/`,
and `.github/` to keep the checkout small.

## Workspace isolation and preview evidence

`pptMasterWorkspaceId` is allocated only when a new `pptDeck` enters a server
persistence boundary and is immutable afterwards. Project init, step-status validation, readiness, SVG writes,
and export all resolve or assert the same ownership tuple before reading or writing
files. Nodes created before this contract that do not have a workspace identity fail
closed; there is no legacy-directory migration or cross-project lookup.

The browser renders a slide only from evidence persisted on that slide, in this order:
inline `svgMarkup`, explicit `svgUrl`, explicit `imageUrl`, then the text placeholder.
Project initialization does not write a preview-base URL, and the browser never guesses
`NN_slide.svg` from a project directory. Public PPT assets are served only through
`/public/ppt-master/projects/<path-relative-to-configured-root>`; the API exposes no
absolute-path file endpoint and does not search `/tmp/ppt-master-projects`.
Inline and fetched SVGs are encoded as image URLs and rendered with `<img>`; PPT SVG
markup is never inserted into the host page or snapshot DOM with `innerHTML`,
`dangerouslySetInnerHTML`, or `<object>`.

## Slide image ownership and SVG references

`slides[i].imageUrl` is the only remote source for a generated slide image, and the
write route accepts it only when the platform asset hosting layer recognizes it as a
persisted hosted asset. Redirects are not followed. The separate canvas image node
remains useful for display and provenance, but it does not replace the required URL on
the slide record and is not accepted as workflow evidence.

The SVG author does not receive or infer internal media URLs. It declares placement
with one stable marker:

```xml
<image href="{{PPT_SLIDE_IMAGE}}"
       x="720" y="160" width="480" height="320"
       preserveAspectRatio="xMidYMid meet"/>
```

The write tool preserves the element geometry and replaces only `href`. A slide with
`imageUrl` must contain the marker; a slide without `imageUrl` must not contain it.
There is no automatic background insertion. Other `<image>` elements must reference
existing project-local files or use a `data:image/...` URI. `data-href` is not treated
as an image source; every exact lowercase `href`/`xlink:href` is checked, an element
with both is rejected as ambiguous, namespace-prefixed `<svg:image>` is supported, and
malformed XML is rejected before image download.

The same read-only resource check is used by SVG step completion, readiness, and
export. Local lookup follows the PPT Master converter order (SVG directory, project
root, `images/`, then `templates/`) while additionally rejecting absolute paths and
paths that escape the project root, including symlink resolution outside that root.
Readiness also requires a materialized project, completed pre-export workflow steps,
unique integer `slides[i].index` values, and one valid persisted `svgPath/svgUrl` pair
per slide. An unreferenced file elsewhere in the project and a stale `svgUrl` without
its matching immutable artifact cannot substitute for that evidence.

## Required environment

```
PPT_MASTER_HOME=<repo>/vendor/ppt-master/skills/ppt-master
PPT_MASTER_PROJECTS_ROOT=<repo>/var/ppt-master-projects
PPT_MASTER_PYTHON=/absolute/path/to/python3.10-or-newer
```

`scripts/dev.sh local` writes the directory settings into the hono-api process; for
production, set all three explicitly in your deployment environment. The Python
binary must report version 3.10 or newer.

## Python dependencies

The upstream skill bundle requires the dependencies listed in
`vendor/ppt-master/skills/ppt-master/requirements.txt`. The two strictly required
modules for export are `python-pptx` and `Pillow`. Install everything once with:

```
pip install -r vendor/ppt-master/skills/ppt-master/requirements.txt
```

The API process uses `PPT_MASTER_PYTHON` when configured, otherwise it invokes
`python3`. Before running an upstream script it verifies Python 3.10+ and returns
`ppt_master_python_unsupported` for an older interpreter. Install the dependencies
in that exact interpreter. The version probe uses an asynchronous child process so
an unavailable or slow interpreter does not block the API event loop. A timed-out
PPT Master command keeps its exact-target lock until the child process has closed;
it sends `SIGTERM`, escalates to `SIGKILL` after a short fixed grace period, and only
then returns `ppt_master_timeout`, so a queued init cannot overlap the old process.

After changing `PPT_MASTER_PYTHON`, restart the Hono API process; an already-running
process keeps its current environment and loaded source code.
