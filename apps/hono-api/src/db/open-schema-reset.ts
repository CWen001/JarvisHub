export const OPEN_SCHEMA_RESET_CONFIRMATION = "DROP_OLD_JARVISHUB_SCHEMA" as const;

export const OPEN_SCHEMA_APP_TABLES = [
	"tasks",
	"projects",
	"flows",
	"flow_versions",
	"workflow_executions",
	"workflow_node_runs",
	"workflow_execution_events",
	"model_catalog_vendors",
	"model_catalog_vendor_api_keys",
	"model_catalog_models",
	"model_catalog_default_models",
	"model_catalog_mappings",
	"prompt_samples",
	"llm_node_presets",
	"agent_skills",
	"agent_presets",
	"agent_pipeline_runs",
	"assets",
	"chapters",
	"storyboard_assets",
	"storyboard_asset_views",
	"storyboard_shots",
	"storyboard_render_jobs",
	"storyboard_timeline_tracks",
	"storyboard_diagnostic_logs",
	"material_assets",
	"material_asset_versions",
	"shot_material_refs",
	"vendor_api_call_logs",
	"api_request_logs",
	"prompt_evolution_runs",
	"prompt_evolution_runtime",
	"task_statuses",
	"task_results",
	"video_generation_histories",
	"vendor_task_refs",
	"public_chat_sessions",
	"public_chat_messages",
	"public_chat_turn_runs",
	"agent_tool_invocations",
	"memory_entries",
	"memory_entry_tags",
	"memory_links",
	"execution_traces",
	"dreamina_accounts",
	"dreamina_project_bindings",
] as const;

function quoteIdent(identifier: string): string {
	return `"${identifier.replace(/"/g, `""`)}"`;
}

export function buildDropAppTablesSql(tables: readonly string[]): string {
	return [...tables]
		.reverse()
		.map((table) => `DROP TABLE IF EXISTS ${quoteIdent(table)} CASCADE;`)
		.join("\n");
}
