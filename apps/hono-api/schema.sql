-- JarvisHub open-workspace schema.
-- This schema is intentionally single-instance: no login tables, no tenant/user
-- isolation columns, no commercial billing tables, and no per-user model tokens.

CREATE TABLE IF NOT EXISTS tasks (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	slug TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	description TEXT,
	completed INTEGER NOT NULL DEFAULT 0,
	due_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flows (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	data TEXT NOT NULL,
	project_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_flows_project_id ON flows(project_id);

CREATE TABLE IF NOT EXISTS flow_versions (
	id TEXT PRIMARY KEY,
	flow_id TEXT NOT NULL,
	name TEXT NOT NULL,
	data TEXT NOT NULL,
	reason TEXT NOT NULL DEFAULT 'legacy',
	label TEXT,
	created_at TEXT NOT NULL,
	FOREIGN KEY (flow_id) REFERENCES flows(id)
);

ALTER TABLE flow_versions ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE flow_versions ADD COLUMN IF NOT EXISTS label TEXT;

CREATE INDEX IF NOT EXISTS idx_flow_versions_flow_id ON flow_versions(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_versions_flow_id_reason ON flow_versions(flow_id, reason);

CREATE TABLE IF NOT EXISTS workflow_executions (
	id TEXT PRIMARY KEY,
	flow_id TEXT NOT NULL,
	flow_version_id TEXT NOT NULL,
	status TEXT NOT NULL,
	concurrency INTEGER NOT NULL DEFAULT 1,
	trigger TEXT,
	error_message TEXT,
	created_at TEXT NOT NULL,
	started_at TEXT,
	finished_at TEXT,
	FOREIGN KEY (flow_id) REFERENCES flows(id),
	FOREIGN KEY (flow_version_id) REFERENCES flow_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_executions_flow_id ON workflow_executions(flow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_flow_version_id ON workflow_executions(flow_version_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions(status);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_created_at ON workflow_executions(created_at);

CREATE TABLE IF NOT EXISTS workflow_node_runs (
	id TEXT PRIMARY KEY,
	execution_id TEXT NOT NULL,
	node_id TEXT NOT NULL,
	status TEXT NOT NULL,
	attempt INTEGER NOT NULL DEFAULT 1,
	error_message TEXT,
	output_refs TEXT,
	created_at TEXT NOT NULL,
	started_at TEXT,
	finished_at TEXT,
	FOREIGN KEY (execution_id) REFERENCES workflow_executions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_node_runs_execution_node ON workflow_node_runs(execution_id, node_id);
CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_execution_id ON workflow_node_runs(execution_id);
CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_status ON workflow_node_runs(status);

CREATE TABLE IF NOT EXISTS workflow_execution_events (
	id TEXT PRIMARY KEY,
	execution_id TEXT NOT NULL,
	seq INTEGER NOT NULL,
	event_type TEXT NOT NULL,
	level TEXT NOT NULL DEFAULT 'info',
	node_id TEXT,
	message TEXT,
	data TEXT,
	created_at TEXT NOT NULL,
	FOREIGN KEY (execution_id) REFERENCES workflow_executions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_execution_events_execution_seq ON workflow_execution_events(execution_id, seq);
CREATE INDEX IF NOT EXISTS idx_workflow_execution_events_execution_id ON workflow_execution_events(execution_id);
CREATE INDEX IF NOT EXISTS idx_workflow_execution_events_node_id ON workflow_execution_events(node_id);

CREATE TABLE IF NOT EXISTS model_catalog_vendors (
	key TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	base_url_hint TEXT,
	auth_type TEXT NOT NULL DEFAULT 'bearer',
	auth_header TEXT,
	auth_query_param TEXT,
	api_protocol TEXT,
	meta TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

ALTER TABLE model_catalog_vendors ADD COLUMN IF NOT EXISTS api_protocol TEXT;

CREATE TABLE IF NOT EXISTS model_catalog_vendor_api_keys (
	vendor_key TEXT PRIMARY KEY,
	api_key TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (vendor_key) REFERENCES model_catalog_vendors(key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS model_catalog_models (
	model_key TEXT NOT NULL,
	vendor_key TEXT NOT NULL,
	model_alias TEXT,
	label_zh TEXT NOT NULL,
	kind TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	meta TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (vendor_key, model_key),
	FOREIGN KEY (vendor_key) REFERENCES model_catalog_vendors(key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_model_catalog_models_vendor_kind ON model_catalog_models(vendor_key, kind);
CREATE INDEX IF NOT EXISTS idx_model_catalog_models_enabled ON model_catalog_models(enabled);

CREATE TABLE IF NOT EXISTS model_catalog_default_models (
	slot TEXT PRIMARY KEY,
	vendor_key TEXT NOT NULL,
	model_key TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (vendor_key, model_key) REFERENCES model_catalog_models(vendor_key, model_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_model_catalog_default_models_model ON model_catalog_default_models(vendor_key, model_key);

CREATE TABLE IF NOT EXISTS model_catalog_mappings (
	id TEXT PRIMARY KEY,
	vendor_key TEXT NOT NULL,
	task_kind TEXT NOT NULL,
	name TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	request_profile TEXT,
	result_path TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (vendor_key) REFERENCES model_catalog_vendors(key) ON DELETE CASCADE,
	UNIQUE (vendor_key, task_kind, name)
);

CREATE INDEX IF NOT EXISTS idx_model_catalog_mappings_vendor_kind ON model_catalog_mappings(vendor_key, task_kind);

CREATE TABLE IF NOT EXISTS prompt_samples (
	id TEXT PRIMARY KEY,
	node_kind TEXT NOT NULL,
	scene TEXT NOT NULL,
	command_type TEXT NOT NULL,
	title TEXT NOT NULL,
	prompt TEXT NOT NULL,
	description TEXT,
	input_hint TEXT,
	output_note TEXT,
	keywords TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_samples_kind ON prompt_samples(node_kind);

CREATE TABLE IF NOT EXISTS llm_node_presets (
	id TEXT PRIMARY KEY,
	scope TEXT NOT NULL,
	preset_type TEXT NOT NULL,
	title TEXT NOT NULL,
	prompt TEXT NOT NULL,
	description TEXT,
	enabled INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_node_presets_scope_type_enabled ON llm_node_presets(scope, preset_type, enabled);

CREATE TABLE IF NOT EXISTS agent_skills (
	id TEXT PRIMARY KEY,
	key TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	description TEXT,
	content TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	visible INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_enabled_visible_sort ON agent_skills(enabled, visible, sort_order);

CREATE TABLE IF NOT EXISTS agent_presets (
	id TEXT PRIMARY KEY,
	key TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	description TEXT,
	system_prompt TEXT,
	opening_message TEXT,
	skill_ids TEXT,
	enabled INTEGER NOT NULL DEFAULT 1,
	visible INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_presets_enabled_visible_sort ON agent_presets(enabled, visible, sort_order);

CREATE TABLE IF NOT EXISTS agent_pipeline_runs (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	title TEXT NOT NULL,
	goal TEXT,
	status TEXT NOT NULL,
	stages_json TEXT NOT NULL,
	progress_json TEXT,
	result_json TEXT,
	error_message TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	started_at TEXT,
	finished_at TEXT,
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_pipeline_runs_project_updated ON agent_pipeline_runs(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_pipeline_runs_status_updated ON agent_pipeline_runs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS assets (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	data TEXT,
	project_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);

CREATE TABLE IF NOT EXISTS chapters (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	chapter_index INTEGER NOT NULL,
	title TEXT NOT NULL,
	summary TEXT,
	status TEXT NOT NULL,
	sort_order INTEGER NOT NULL,
	cover_asset_id TEXT,
	continuity_context TEXT,
	style_profile_override TEXT,
	legacy_chunk_index INTEGER,
	source_book_id TEXT,
	source_book_chapter INTEGER,
	last_worked_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (project_id, chapter_index),
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_chapters_project_sort ON chapters(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_chapters_project_last_worked ON chapters(project_id, last_worked_at);

CREATE TABLE IF NOT EXISTS storyboard_assets (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	name TEXT NOT NULL,
	version INTEGER NOT NULL DEFAULT 1,
	prompt_pack_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_storyboard_assets_project ON storyboard_assets(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS storyboard_asset_views (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	asset_id TEXT NOT NULL,
	view_kind TEXT NOT NULL,
	image_url TEXT NOT NULL,
	metadata_json TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (asset_id) REFERENCES storyboard_assets(id)
);

CREATE INDEX IF NOT EXISTS idx_storyboard_asset_views_asset_view ON storyboard_asset_views(asset_id, view_kind);

CREATE TABLE IF NOT EXISTS storyboard_shots (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	chapter_id TEXT,
	chunk_index INTEGER NOT NULL,
	shot_index INTEGER NOT NULL,
	title TEXT,
	summary TEXT,
	scene_asset_id TEXT NOT NULL,
	character_asset_ids TEXT NOT NULL,
	prop_asset_ids TEXT NOT NULL,
	camera_plan_json TEXT NOT NULL,
	lighting_plan_json TEXT NOT NULL,
	continuity_tail_frame_url TEXT,
	status TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (project_id, chunk_index, shot_index)
);

CREATE INDEX IF NOT EXISTS idx_storyboard_shots_project ON storyboard_shots(project_id, chunk_index, shot_index);
CREATE INDEX IF NOT EXISTS idx_storyboard_shots_project_chapter_shot ON storyboard_shots(project_id, chapter_id, shot_index);

CREATE TABLE IF NOT EXISTS storyboard_render_jobs (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	shot_id TEXT NOT NULL,
	model_key TEXT NOT NULL,
	mode TEXT NOT NULL,
	params_json TEXT NOT NULL,
	seed INTEGER,
	status TEXT NOT NULL,
	output_video_url TEXT,
	output_last_frame_url TEXT,
	cost_cents INTEGER,
	latency_ms INTEGER,
	fail_code TEXT,
	fail_reason TEXT,
	based_on_job_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (shot_id) REFERENCES storyboard_shots(id),
	FOREIGN KEY (based_on_job_id) REFERENCES storyboard_render_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_storyboard_render_jobs_shot_created ON storyboard_render_jobs(shot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storyboard_render_jobs_project ON storyboard_render_jobs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS storyboard_timeline_tracks (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	shot_id TEXT NOT NULL,
	active_job_id TEXT NOT NULL,
	position INTEGER NOT NULL DEFAULT 0,
	duration_ms INTEGER NOT NULL DEFAULT 0,
	audio_track_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (project_id, shot_id),
	FOREIGN KEY (shot_id) REFERENCES storyboard_shots(id),
	FOREIGN KEY (active_job_id) REFERENCES storyboard_render_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_storyboard_timeline_tracks_project ON storyboard_timeline_tracks(project_id, position);

CREATE TABLE IF NOT EXISTS storyboard_diagnostic_logs (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	shot_id TEXT,
	job_id TEXT,
	stage TEXT NOT NULL,
	level TEXT NOT NULL,
	message TEXT NOT NULL,
	summary_json TEXT,
	created_at TEXT NOT NULL,
	FOREIGN KEY (shot_id) REFERENCES storyboard_shots(id),
	FOREIGN KEY (job_id) REFERENCES storyboard_render_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_storyboard_diagnostic_project_stage ON storyboard_diagnostic_logs(project_id, stage, created_at DESC);

CREATE TABLE IF NOT EXISTS material_assets (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	name TEXT NOT NULL,
	current_version INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_assets_project ON material_assets(project_id, kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS material_asset_versions (
	id TEXT PRIMARY KEY,
	asset_id TEXT NOT NULL,
	project_id TEXT NOT NULL,
	version INTEGER NOT NULL,
	data_json TEXT NOT NULL,
	note TEXT,
	created_at TEXT NOT NULL,
	UNIQUE (asset_id, version),
	FOREIGN KEY (asset_id) REFERENCES material_assets(id)
);

CREATE INDEX IF NOT EXISTS idx_material_versions_asset ON material_asset_versions(asset_id, version DESC);

CREATE TABLE IF NOT EXISTS shot_material_refs (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	shot_id TEXT NOT NULL,
	asset_id TEXT NOT NULL,
	asset_version INTEGER NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (project_id, shot_id, asset_id),
	FOREIGN KEY (asset_id) REFERENCES material_assets(id)
);

CREATE INDEX IF NOT EXISTS idx_shot_material_refs_project ON shot_material_refs(project_id, shot_id);

CREATE TABLE IF NOT EXISTS vendor_api_call_logs (
	vendor TEXT NOT NULL,
	task_id TEXT NOT NULL,
	task_kind TEXT,
	status TEXT NOT NULL,
	started_at TEXT,
	finished_at TEXT,
	duration_ms INTEGER,
	error_message TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	request_json TEXT,
	response_json TEXT,
	PRIMARY KEY (vendor, task_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_api_call_logs_vendor_finished_at ON vendor_api_call_logs(vendor, finished_at);
CREATE INDEX IF NOT EXISTS idx_vendor_api_call_logs_status ON vendor_api_call_logs(status);
CREATE INDEX IF NOT EXISTS idx_vendor_api_call_logs_finished_at ON vendor_api_call_logs(finished_at);

CREATE TABLE IF NOT EXISTS api_request_logs (
	id TEXT PRIMARY KEY,
	method TEXT NOT NULL,
	path TEXT NOT NULL,
	status INTEGER,
	stage TEXT,
	aborted INTEGER NOT NULL DEFAULT 0,
	started_at TEXT NOT NULL,
	finished_at TEXT,
	duration_ms INTEGER,
	trace_json TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_request_logs_path_started_at ON api_request_logs(path, started_at);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_started_at ON api_request_logs(started_at);

CREATE TABLE IF NOT EXISTS prompt_evolution_runs (
	id TEXT PRIMARY KEY,
	actor_id TEXT,
	since_hours INTEGER NOT NULL,
	min_samples INTEGER NOT NULL,
	dry_run INTEGER NOT NULL DEFAULT 1,
	action TEXT NOT NULL,
	metrics_json TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_evolution_runs_created_at ON prompt_evolution_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS prompt_evolution_runtime (
	id INTEGER PRIMARY KEY,
	active_run_id TEXT,
	canary_percent INTEGER NOT NULL DEFAULT 5,
	status TEXT NOT NULL DEFAULT 'idle',
	last_action TEXT,
	note TEXT,
	updated_at TEXT NOT NULL,
	updated_by TEXT
);

CREATE TABLE IF NOT EXISTS task_statuses (
	id TEXT PRIMARY KEY,
	task_id TEXT NOT NULL,
	provider TEXT NOT NULL,
	status TEXT NOT NULL,
	data TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	completed_at TEXT,
	UNIQUE (task_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_task_statuses_status ON task_statuses(status);
CREATE INDEX IF NOT EXISTS idx_task_statuses_created_at ON task_statuses(created_at);

CREATE TABLE IF NOT EXISTS task_results (
	task_id TEXT PRIMARY KEY,
	vendor TEXT NOT NULL,
	kind TEXT NOT NULL,
	status TEXT NOT NULL,
	result TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_results_updated_at ON task_results(updated_at);
CREATE INDEX IF NOT EXISTS idx_task_results_status ON task_results(status);

CREATE TABLE IF NOT EXISTS video_generation_histories (
	id TEXT PRIMARY KEY,
	node_id TEXT,
	project_id TEXT,
	prompt TEXT NOT NULL,
	parameters TEXT,
	image_url TEXT,
	task_id TEXT NOT NULL,
	generation_id TEXT,
	status TEXT NOT NULL,
	video_url TEXT,
	thumbnail_url TEXT,
	duration INTEGER,
	width INTEGER,
	height INTEGER,
	token_id TEXT,
	provider TEXT NOT NULL,
	model TEXT,
	cost REAL,
	is_favorite INTEGER NOT NULL DEFAULT 0,
	rating INTEGER,
	notes TEXT,
	remix_target_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_video_history_task ON video_generation_histories(task_id);
CREATE INDEX IF NOT EXISTS idx_video_history_provider ON video_generation_histories(provider);

CREATE TABLE IF NOT EXISTS vendor_task_refs (
	kind TEXT NOT NULL,
	task_id TEXT NOT NULL,
	vendor TEXT NOT NULL,
	pid TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (kind, task_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_task_refs_kind_pid ON vendor_task_refs(kind, pid);
CREATE INDEX IF NOT EXISTS idx_vendor_task_refs_kind_vendor ON vendor_task_refs(kind, vendor);

CREATE TABLE IF NOT EXISTS public_chat_sessions (
	id TEXT PRIMARY KEY,
	session_key TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_chat_sessions_updated ON public_chat_sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS public_chat_messages (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	role TEXT NOT NULL,
	content TEXT NOT NULL,
	assets_json TEXT,
	ask_user_prompt_json TEXT,
	created_at TEXT NOT NULL,
	FOREIGN KEY (session_id) REFERENCES public_chat_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_public_chat_messages_session_created ON public_chat_messages(session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public_chat_turn_runs (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	request_id TEXT,
	session_key TEXT NOT NULL,
	project_id TEXT,
	book_id TEXT,
	chapter_id TEXT,
	label TEXT,
	workflow_key TEXT NOT NULL,
	request_kind TEXT NOT NULL,
	user_message_id TEXT,
	assistant_message_id TEXT,
	output_mode TEXT NOT NULL,
	turn_verdict TEXT NOT NULL,
	turn_verdict_reasons_json TEXT NOT NULL,
	run_outcome TEXT NOT NULL DEFAULT 'hold',
	agent_decision_json TEXT,
	tool_status_summary_json TEXT,
	diagnostic_flags_json TEXT,
	canvas_plan_json TEXT,
	asset_count INTEGER NOT NULL DEFAULT 0,
	canvas_write INTEGER NOT NULL DEFAULT 0,
	run_ms INTEGER,
	created_at TEXT NOT NULL,
	FOREIGN KEY (session_id) REFERENCES public_chat_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_session_created ON public_chat_turn_runs(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_workflow_created ON public_chat_turn_runs(workflow_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_verdict_created ON public_chat_turn_runs(turn_verdict, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_project_created ON public_chat_turn_runs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_tool_invocations (
	id TEXT PRIMARY KEY,
	principal_key TEXT NOT NULL,
	idempotency_key TEXT NOT NULL,
	tool_name TEXT NOT NULL,
	context_hash TEXT NOT NULL,
	status TEXT NOT NULL,
	result_json TEXT,
	error_json TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (principal_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_invocations_principal_key ON agent_tool_invocations(principal_key, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_agent_tool_invocations_status_updated ON agent_tool_invocations(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS webhero_code_stage_sessions (
	id TEXT PRIMARY KEY,
	flow_id TEXT NOT NULL,
	node_id TEXT NOT NULL,
	session_id TEXT NOT NULL,
	flow_updated_at TEXT NOT NULL,
	preview_node_ids_json TEXT NOT NULL,
	code_input_digest TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('staging', 'committed')),
	fields_json TEXT NOT NULL,
	version INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	committed_at TEXT,
	UNIQUE (flow_id, node_id, session_id),
	FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
);

ALTER TABLE webhero_code_stage_sessions ADD COLUMN IF NOT EXISTS flow_updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE webhero_code_stage_sessions ADD COLUMN IF NOT EXISTS preview_node_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE webhero_code_stage_sessions ADD COLUMN IF NOT EXISTS code_input_digest TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_webhero_code_stage_session_identity ON webhero_code_stage_sessions(flow_id, node_id, session_id);
CREATE INDEX IF NOT EXISTS idx_webhero_code_stage_status_updated ON webhero_code_stage_sessions(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_entries (
	id TEXT PRIMARY KEY,
	scope_type TEXT NOT NULL,
	scope_id TEXT NOT NULL,
	memory_type TEXT NOT NULL,
	title TEXT,
	summary_text TEXT,
	content_json TEXT NOT NULL,
	source_kind TEXT NOT NULL,
	source_id TEXT,
	importance REAL NOT NULL DEFAULT 0.6,
	status TEXT NOT NULL DEFAULT 'active',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_scope ON memory_entries(scope_type, scope_id, memory_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_entries_status ON memory_entries(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_entry_tags (
	id TEXT PRIMARY KEY,
	memory_id TEXT NOT NULL,
	tag TEXT NOT NULL,
	created_at TEXT NOT NULL,
	FOREIGN KEY (memory_id) REFERENCES memory_entries(id)
);

CREATE INDEX IF NOT EXISTS idx_memory_entry_tags_tag ON memory_entry_tags(tag, memory_id);

CREATE TABLE IF NOT EXISTS memory_links (
	id TEXT PRIMARY KEY,
	memory_id TEXT NOT NULL,
	target_type TEXT NOT NULL,
	target_id TEXT NOT NULL,
	relation TEXT NOT NULL,
	created_at TEXT NOT NULL,
	FOREIGN KEY (memory_id) REFERENCES memory_entries(id)
);

CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_type, target_id);

CREATE TABLE IF NOT EXISTS execution_traces (
	id TEXT PRIMARY KEY,
	scope_type TEXT NOT NULL,
	scope_id TEXT NOT NULL,
	task_id TEXT,
	request_kind TEXT NOT NULL,
	input_summary TEXT NOT NULL,
	decision_log_json TEXT,
	tool_calls_json TEXT,
	meta_json TEXT,
	result_summary TEXT,
	error_code TEXT,
	error_detail TEXT,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_execution_traces_scope ON execution_traces(scope_type, scope_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dreamina_accounts (
	id TEXT PRIMARY KEY,
	label TEXT NOT NULL,
	cli_path TEXT,
	session_root TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	last_healthcheck_at TEXT,
	last_login_at TEXT,
	last_error TEXT,
	meta_json TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dreamina_accounts_updated ON dreamina_accounts(updated_at DESC);

CREATE TABLE IF NOT EXISTS dreamina_project_bindings (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	account_id TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	default_model_version TEXT,
	default_ratio TEXT,
	default_resolution_type TEXT,
	default_video_resolution TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (project_id) REFERENCES projects(id),
	FOREIGN KEY (account_id) REFERENCES dreamina_accounts(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dreamina_project_bindings_project ON dreamina_project_bindings(project_id);
CREATE INDEX IF NOT EXISTS idx_dreamina_project_bindings_updated ON dreamina_project_bindings(updated_at DESC);
