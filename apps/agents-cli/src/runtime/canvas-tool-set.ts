/**
 * LOCAL_CANVAS_TOOLS — Layer A 静态注册的画布 runtime 本地工具白名单。
 *
 * 此清单是 sub-agent 定义校验、CI 校验脚本、运行时启动注册三处的单一事实源。
 * 与 hono-api 侧 REMOTE_CANVAS_TOOLS（Layer B，per-request 注入）合起来构成
 * canvas runtime 下 sub-agent 可以声明的工具全集。
 *
 * 修改此列表必须同步更新：
 *  - `canvas-runtime.ts` 注册顺序（实现侧）
 *  - `agent-definitions/canvas.json`（声明侧）
 *  - 跨仓 CI 校验脚本（如有）
 */
export const LOCAL_CANVAS_TOOLS = [
  "TodoWrite",
  "task_create",
  "task_update",
  "task_get",
  "task_list",
  "task_claim",
  "Skill",
  "canvas_list_attempts",
  "ask_user",
  "component_reference_search",
  "icon_search",
  "font_recommendation_search",
  "web_asset_search",
  "web_asset_public_search",
  "web_generation_retrieval_prepare",
  "web_generation_codegen_prepare",
  "webhero_debug_resume_plan",
  "retrieval_record_get",
  "retrieval_record_list",
  "canvas_read_node_media_for_context",
  "task_board_read",
  "Agent",
] as const;

export type LocalCanvasToolName = (typeof LOCAL_CANVAS_TOOLS)[number];

/**
 * 已知的 hono-api 注入 remote tools（Layer B 当前快照）。
 * 仅用于 CI/校验侧给出"声明的工具是否在 LOCAL ∪ REMOTE 全集里"的提示，
 * 不用于运行时注册——运行时 Layer B 由 hono-api 在请求体里逐请求注入。
 *
 * 真实事实源在 hono-api 侧 `apps/hono-api/src/modules/task/canvas-tools/catalog.ts`。
 * 此处只列出 exposure: "agent" 的 remote tools；internal tools 不应被 sub-agent 声明。
 */
export const KNOWN_REMOTE_CANVAS_TOOLS = [
  "canvas_project_flows_list",
  "canvas_project_context_get",
  "canvas_web_asset_search",
  "canvas_web_style_reference_search",
  "canvas_pipeline_runs_list",
  "canvas_pipeline_run_get",
  "canvas_node_context_bundle_get",
  "canvas_video_review_bundle_get",
  "canvas_executions_list",
  "canvas_execution_get",
  "canvas_execution_node_runs_get",
  "canvas_execution_events_list",
  "canvas_flow_get",
	"canvas_flow_inspect",
	"canvas_generation_context_get",
  "canvas_flow_checkpoint_create",
  "canvas_flow_checkpoint_restore",
  "canvas_flow_checkpoint_list",
  "canvas_evaluate_node_read_media",
  "canvas_image_generate_to_canvas",
  "canvas_image_wait_for_result",
  "canvas_video_generate_to_canvas",
  "canvas_video_wait_for_result",
  "canvas_video_concat_to_canvas",
  "canvas_create_text_node",
  "canvas_create_webhero_node",
  "canvas_webhero_code_stage_chunk",
  "canvas_webhero_code_stage_raw_chunk",
  "canvas_webhero_code_commit",
  "canvas_webhero_check_readiness",
  "canvas_create_group",
  "canvas_connect_nodes",
  "canvas_bind_references",
  "canvas_update_node_data",
  "canvas_delete_canvas_items",
  "canvas_reflow_layout",
  "canvas_group_existing_nodes",
] as const;

export type KnownRemoteCanvasToolName = (typeof KNOWN_REMOTE_CANVAS_TOOLS)[number];

export const CANVAS_ROOT_AGENT_DENIED_TOOLS = [
  "canvas_evaluate_node",
  "canvas_evaluate_node_read_media",
  "canvas_image_generate_to_canvas",
  "canvas_image_wait_for_result",
  "canvas_video_generate_to_canvas",
  "canvas_video_wait_for_result",
  "canvas_video_concat_to_canvas",
  "canvas_webhero_code_stage_chunk",
  "canvas_webhero_code_stage_raw_chunk",
  "canvas_webhero_code_commit",
] as const;

export function isCanvasRootAgentDeniedTool(name: string): boolean {
  return (CANVAS_ROOT_AGENT_DENIED_TOOLS as readonly string[]).includes(String(name || "").trim());
}
