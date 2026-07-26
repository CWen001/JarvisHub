export const PUBLIC_FLOW_PRODUCTION_LAYER_VALUES = [
	"evidence",
	"constraints",
	"anchors",
	"expansion",
	"execution",
	"results",
] as const;

export const PUBLIC_FLOW_CREATION_STAGE_VALUES = [
	"source_understanding",
	"constraint_definition",
	"world_anchor_lock",
	"character_anchor_lock",
	"single_variable_expansion",
	"approved_keyframe_selection",
	"video_plan",
	"video_execution",
	"result_persistence",
] as const;

export const PUBLIC_FLOW_APPROVAL_STATUS_VALUES = [
	"needs_confirmation",
	"approved",
	"rejected",
] as const;

export type PublicFlowProductionLayer =
	(typeof PUBLIC_FLOW_PRODUCTION_LAYER_VALUES)[number];

export type PublicFlowCreationStage =
	(typeof PUBLIC_FLOW_CREATION_STAGE_VALUES)[number];

export type PublicFlowApprovalStatus =
	(typeof PUBLIC_FLOW_APPROVAL_STATUS_VALUES)[number];
