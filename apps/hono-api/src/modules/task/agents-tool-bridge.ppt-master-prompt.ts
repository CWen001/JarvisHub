/**
 * PPT Master system-prompt injection.
 *
 * When a public-agents chat turn looks like a PPT/PPTX/slides/演示文稿 request,
 * we inject a strict serial-pipeline instruction so the agent cannot skip
 * topic_research / project_init / image_generation / svg_authoring / export_pptx.
 *
 * Detection is intentionally permissive (CN + EN, with light verbiage) so that
 * casual phrasings still trigger the gate.
 */

const PPT_KEYWORDS_EN = [
  "ppt", "pptx", "powerpoint", "slide", "slides", "deck",
  "presentation",
];

const PPT_KEYWORDS_CN = [
  "ppt", "幻灯片", "幻灯", "演示文稿", "演示稿", "演讲稿",
  "汇报稿", "ppt大纲", "做一份ppt", "做个ppt", "做一个ppt",
  "生成ppt", "创建ppt", "制作ppt", "演示", "ppt模板",
];

function normalizeLower(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function detectPptIntent(input: {
  prompt: string;
  selectedNodeKind?: string | null;
}): boolean {
  const kind = (input.selectedNodeKind || "").trim();
  if (kind === "pptDeck") return true;
  const text = normalizeLower(input.prompt);
  if (!text) return false;
  for (const kw of PPT_KEYWORDS_EN) {
    if (text.includes(kw)) return true;
  }
  // Chinese keywords are matched case-insensitively too (no-op for Hanzi).
  for (const kw of PPT_KEYWORDS_CN) {
    if (text.includes(kw)) return true;
  }
  return false;
}

/**
 * Build a strict PPT Master pipeline system-prompt addendum. This is merged
 * into the upstream system prompt sent to the agents bridge whenever the
 * incoming chat looks like a PPT request.
 */
export function buildPptMasterSystemPromptAddendum(): string {
  return [
    "## PPT MASTER MODE (ENFORCED 6-STEP SERIAL PIPELINE)",
    "",
    "The current request targets a PowerPoint / PPT / slide deck. You MUST",
    "follow the PPT Master pipeline exactly, IN ORDER, with no skipping.",
    "Use ONLY these canvas tools — never claim the runtime lacks fs / svg / web search.",
    "",
    "Steps (each step MUST persist its outputs and set",
    "`pptMasterWorkflowContract.stepStatus.<step>=completed` via",
    "`canvas_update_node_data` BEFORE moving on):",
    "",
    "1. `topic_research` — Gather real source material for the topic. If the",
    "   user only gives a topic (e.g. a person, product, company), use web",
    "   search / web fetch to assemble a research summary; persist it into",
    "   `pptResearch` (Markdown). Skipping is forbidden for celebrity /",
    "   product / company topics. If the user already supplied substantive",
    "   content, copy it into `pptResearch` and mark completed.",
    "",
    "2. `project_init` — Call `canvas_ppt_master_project_init` with",
    "   `{nodeId, projectName}`. The server creates a server-owned workspace",
    "   and writes `pptMasterProjectPath` back onto the node. Verify it is",
    "   non-empty; never pass baseDir or choose/reuse a filesystem directory.",
    "",
    "3. `strategist_outline` — Author `slides[]` with",
    "   `{index, title, subtitle, section, bullets[3-5], speakerNotes, visualBrief}`.",
    "   `visualBrief` MUST describe concrete imagery (hero portrait,",
    "   timeline, chart, diagram, etc.) for every non-text slide.",
    "   `visualBrief` and later image prompts MUST describe only the in-slide",
    "   illustration/photo/diagram asset needed by the slide, NOT a full PPT",
    "   slide screenshot, slide layout, title block, bullets, footer, or UI chrome.",
    "   Avoid blue-purple gradients and purple/indigo neon gradient palettes;",
    "   they make the result look AI-generated.",
    "",
    "4. `image_generation` — For every slide whose `visualBrief` calls for",
    "   imagery, call `canvas_image_generate_to_canvas`. Generate at",
    "   most 2 in parallel; await results with `canvas_image_wait_for_result`.",
    "   Every PPT image-generation prompt MUST explicitly say: generate only",
    "   the illustration/photo/chart/diagram asset that belongs inside the",
    "   PPT, do not render a complete slide or screenshot, do not include",
    "   presentation text/bullets/title bars, and avoid blue-purple gradients.",
    "   Pass `purpose.kind=\"pptDeckImage\"`, `purpose.forNodeId=<pptDeck nodeId>`,",
    "   and `purpose.slideIndex=<slide.index>` on every generated slide image.",
    "   The backend uses these to group the image nodes AND to link each slide",
    "   to its image: it derives `slides[i].imageUrl` from the generated image",
    "   node automatically. DO NOT set `slides[i].imageUrl` yourself — it is",
    "   backend-owned and any value you write is ignored.",
    "   This step is MANDATORY — a PPT without imagery is unacceptable.",
    "   Pure-text slides may set `slides[i].svgIntent=true` to skip image",
    "   generation for that slide.",
    "",
    "5. `svg_authoring` — Author one full `<svg viewBox=\"0 0 1280 720\" ...>`",
    "   per page BY HAND, page by page. Call",
    "   `canvas_ppt_master_write_slide_svg` with",
    "   `{nodeId, slideIndex, svgMarkup}` for EACH slide. The server writes",
    "   an immutable content-addressed SVG artifact and atomically patches",
    "   `slides[i].svgUrl` back onto the node automatically. When a slide has a",
    "   generated image, place it with",
    "   `<image href=\"{{PPT_SLIDE_IMAGE}}\" .../>`. The server resolves",
    "   that exact placeholder from the backend-derived slide imageUrl; do not pass a URL, sourceNodeId, or guessed filename —",
    "   never replace generated images with hand-drawn shapes. NEVER batch",
    "   SVGs via a script loop.",
    "",
    "6. `export_pptx` — After EVERY slide has `svgUrl`, call",
    "   `canvas_ppt_master_check_readiness` and ensure `ready=true`. Then",
    "   call `canvas_ppt_master_export_to_pptx` with",
    "   `{nodeId, projectPath}`. The server exports only the immutable SVG",
    "   artifacts persisted on that deck. The node will receive",
    "   `pptxUrl` and `pptxPath`.",
    "",
    "Forbidden behaviors (the server enforces these — violations are blocked):",
    "- Marking a later step `completed` while an earlier step is still `pending` / `blocked`.",
    "- Claiming `svg_authoring` is impossible — `canvas_ppt_master_write_slide_svg` IS available.",
    "- Skipping `image_generation` when the outline contains non-text slides.",
    "- Returning a 'PPT outline' to the user as the final deliverable. Deliverable = real `.pptx` file + slides with imagery + SVGs.",
    "",
    "If `canvas_create_ppt_node` has not yet been called for this chat, call",
    "it FIRST before doing any other step. The created node already carries",
    "`pptMasterWorkflowContract` — read it and follow `acceptanceCriteria`.",
  ].join("\n");
}

export type PptStepKey =
  | "topic_research"
  | "project_init"
  | "strategist_outline"
  | "image_generation"
  | "svg_authoring"
  | "export_pptx";

export const PPT_STEP_ORDER: PptStepKey[] = [
  "topic_research",
  "project_init",
  "strategist_outline",
  "image_generation",
  "svg_authoring",
  "export_pptx",
];
