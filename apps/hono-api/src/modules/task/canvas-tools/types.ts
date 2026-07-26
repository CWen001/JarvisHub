import type { ZodTypeAny } from "zod";

export type CanvasToolScope = "workspace" | "project" | "flow" | "node";

export type CanvasToolProvider = {
	id: "canvas";
	kind: "remote";
};

export type CanvasToolEffects = {
	readOnly: boolean;
	mutatesCanvas?: boolean;
	generatesMedia?: boolean;
	mediaKind?: "image" | "video";
	destructive?: boolean;
	longRunning?: boolean;
	costBearing?: boolean;
};

export type CanvasToolPermission = {
	defaultMode: "allow" | "ask" | "deny";
	requiresUserIntent?: boolean;
};

export type CanvasToolExposure = "agent" | "internal";

export type CanvasToolHandler =
	| "project_flows_list"
	| "project_context_get"
	| "web_asset_search"
	| "web_style_reference_search"
	| "node_context_bundle_get"
	| "video_review_bundle_get"
	| "pipeline_runs_list"
	| "pipeline_run_get"
	| "executions_list"
	| "execution_get"
	| "execution_node_runs_get"
	| "execution_events_list"
	| "flow_get"
	| "flow_inspect"
	| "generation_context_get"
	| "flow_patch"
	| "flow_checkpoint_create"
	| "flow_checkpoint_restore"
	| "flow_checkpoint_list"
	| "evaluate_node_read_media"
	| "image_generate_to_canvas"
	| "image_wait_for_result"
	| "video_generate_to_canvas"
	| "video_wait_for_result"
	| "video_concat_to_canvas"
	| "create_text_node"
	| "create_webhero_node"
	| "create_ppt_node"
	| "ppt_master_project_init"
	| "ppt_master_export_to_pptx"
	| "ppt_master_check_readiness"
	| "ppt_master_write_slide_svg"
	| "create_group"
	| "connect_nodes"
	| "bind_references"
	| "update_node_data"
	| "webhero_code_stage_chunk"
	| "webhero_code_stage_raw_chunk"
	| "webhero_code_commit"
	| "delete_canvas_items"
	| "reflow_layout"
	| "group_existing_nodes"
	| "webhero_check_readiness";

export type CanvasJsonSchema = Record<string, unknown>;

export type CanvasToolSpec = {
	name: string;
	description: string;
	zodInputSchema: ZodTypeAny;
	inputSchema: CanvasJsonSchema;
	outputSchema?: CanvasJsonSchema;
	provider: CanvasToolProvider;
	scope: CanvasToolScope;
	effects: CanvasToolEffects;
	permission: CanvasToolPermission;
	exposure: CanvasToolExposure;
	handler: CanvasToolHandler;
};

export type CanvasRemoteToolDefinition = {
	name: string;
	description: string;
	parameters: CanvasJsonSchema;
	provider: CanvasToolProvider;
	scope: CanvasToolScope;
	effects: CanvasToolEffects;
	permission: CanvasToolPermission;
	outputSchema?: CanvasJsonSchema;
};

export type BuildCanvasAgentRemoteToolsInput = {
	publicAgentsRequest: boolean;
	canvasProjectId: string | null;
	canvasFlowId: string | null;
};

export type ToolResultEffects = {
	createdNodeIds?: string[];
	updatedNodeIds?: string[];
	deletedNodeIds?: string[];
	createdEdgeIds?: string[];
	updatedEdgeIds?: string[];
	deletedEdgeIds?: string[];
	createdAssetUrls?: string[];
	pendingTaskIds?: string[];
	wroteCanvas?: boolean;
};

export type ToolResultEnvelope = {
	ok: true;
	content: string;
	data?: Record<string, unknown>;
	effects?: ToolResultEffects;
};
