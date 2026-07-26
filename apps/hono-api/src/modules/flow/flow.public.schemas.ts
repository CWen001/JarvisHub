import { z } from "zod";
import {
	PUBLIC_FLOW_ANCHOR_BINDING_KINDS,
	PUBLIC_FLOW_ANCHOR_REFERENCE_VIEWS,
} from "./flow.anchor-bindings";
import {
	PUBLIC_FLOW_APPROVAL_STATUS_VALUES,
	PUBLIC_FLOW_CREATION_STAGE_VALUES,
	PUBLIC_FLOW_PRODUCTION_LAYER_VALUES,
} from "./flow.production-metadata";

export {
	PUBLIC_FLOW_APPROVAL_STATUS_VALUES,
	PUBLIC_FLOW_CREATION_STAGE_VALUES,
	PUBLIC_FLOW_PRODUCTION_LAYER_VALUES,
} from "./flow.production-metadata";

function emptyStringToUndefined(value: unknown): unknown {
	return typeof value === "string" && value.trim() === "" ? undefined : value;
}

export const optionalNonEmptyString = z.preprocess(
	emptyStringToUndefined,
	z.string().min(1).optional(),
);

function toArray(value: unknown): unknown[] | undefined {
	if (typeof value === "undefined") return undefined;
	return Array.isArray(value) ? value : [value];
}

function normalizePublicFlowPatchRequest(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const raw = value as Record<string, unknown>;
	const deleteNodeIds = toArray(raw.deleteNodeIds);
	const deleteEdgeIds = toArray(raw.deleteEdgeIds);
	const createNodes = [
		...(toArray(raw.createNodes) || []),
		...(toArray(raw.createNode) || []),
	];
	const createEdges = [
		...(toArray(raw.createEdges) || []),
		...(toArray(raw.createEdge) || []),
	];
	const patchNodeData = [
		...(toArray(raw.patchNodeData) || []),
		...(toArray(raw.patchNode) || []),
	];
	const appendNodeArrays = [
		...(toArray(raw.appendNodeArrays) || []),
		...(toArray(raw.appendNodeArray) || []),
	];
	return {
		allowOverwrite: raw.allowOverwrite,
		...(deleteNodeIds?.length ? { deleteNodeIds } : {}),
		...(deleteEdgeIds?.length ? { deleteEdgeIds } : {}),
		...(createNodes.length ? { createNodes } : {}),
		...(createEdges.length ? { createEdges } : {}),
		...(patchNodeData.length ? { patchNodeData } : {}),
		...(appendNodeArrays.length ? { appendNodeArrays } : {}),
	};
}

export const PublicFlowGraphSchema = z.object({
	nodes: z.array(z.unknown()).default([]),
	edges: z.array(z.unknown()).default([]),
	viewport: z
		.object({
			x: z.number(),
			y: z.number(),
			zoom: z.number(),
		})
		.nullable()
		.optional(),
	meta: z.record(z.string(), z.unknown()).optional(),
});

export type PublicFlowGraph = z.infer<typeof PublicFlowGraphSchema>;

export const PublicFlowGetResponseSchema = z.object({
	id: z.string(),
	name: z.string(),
	data: PublicFlowGraphSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type PublicFlowGetResponseDto = z.infer<typeof PublicFlowGetResponseSchema>;

export const PublicFlowPatchNodeDataMergeStrategySchema = z.enum([
	"skip-equal",
	"overwrite",
	"fail",
]);

export const PublicFlowWebHeroRewindPhaseSchema = z.enum([
	"preview_generation",
	"preview_visual_spec",
	"asset_inventory",
	"asset_resolution",
	"section_codegen",
]);

export type PublicFlowPatchNodeDataMergeStrategy = z.infer<
	typeof PublicFlowPatchNodeDataMergeStrategySchema
>;

export const PublicFlowPatchNodeDataSchema = z.object({
	id: z.string().min(1),
	data: z.record(z.string(), z.unknown()),
	mergeStrategy: PublicFlowPatchNodeDataMergeStrategySchema.optional(),
	webHeroRewindFromPhase: PublicFlowWebHeroRewindPhaseSchema.optional(),
});

export const PublicFlowAppendNodeArraySchema = z.object({
	id: z.string().min(1),
	key: z.string().min(1),
	items: z.array(z.unknown()).min(1),
});

export const PublicFlowCreateEdgeSchema = z
	.object({
		id: optionalNonEmptyString,
		source: z.string().min(1),
		target: z.string().min(1),
		sourceHandle: optionalNonEmptyString,
		targetHandle: optionalNonEmptyString,
		type: optionalNonEmptyString,
		label: z.string().optional(),
		data: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

const PublicFlowNodePositionSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
});

const PublicFlowTaskNodeKindSchema = z.enum([
	"text",
	"image",
	"imageEdit",
	"video",
	"imageFission",
	"mosaic",
	"composeVideo",
	"audio",
	"subtitle",
	"webHero",
	"pptDeck",
]);

const PublicFlowProductionLayerSchema = z.enum(PUBLIC_FLOW_PRODUCTION_LAYER_VALUES);

const PublicFlowCreationStageSchema = z.enum(PUBLIC_FLOW_CREATION_STAGE_VALUES);

const PublicFlowApprovalStatusSchema = z.enum(PUBLIC_FLOW_APPROVAL_STATUS_VALUES);

const PublicFlowAnchorBindingSchema = z
	.object({
		kind: z.enum(PUBLIC_FLOW_ANCHOR_BINDING_KINDS),
		refId: optionalNonEmptyString,
		entityId: optionalNonEmptyString,
		label: optionalNonEmptyString,
		sourceBookId: optionalNonEmptyString,
		sourceNodeId: optionalNonEmptyString,
		assetId: optionalNonEmptyString,
		assetRefId: optionalNonEmptyString,
		imageUrl: optionalNonEmptyString,
		referenceView: z.enum(PUBLIC_FLOW_ANCHOR_REFERENCE_VIEWS).optional(),
		category: optionalNonEmptyString,
		note: optionalNonEmptyString,
	})
	.passthrough();

export { PublicFlowAnchorBindingSchema };

const PublicFlowImageCameraControlSchema = z
	.object({
		enabled: z.boolean().optional(),
		presetId: optionalNonEmptyString,
		azimuthDeg: z.number().finite().optional(),
		elevationDeg: z.number().finite().optional(),
		distance: z.number().finite().optional(),
	})
	.passthrough();

const PublicFlowImageLightControlSchema = z
	.object({
		enabled: z.boolean().optional(),
		presetId: optionalNonEmptyString,
		azimuthDeg: z.number().finite().optional(),
		elevationDeg: z.number().finite().optional(),
		intensity: z.number().finite().optional(),
		colorHex: optionalNonEmptyString,
	})
	.passthrough();

const PublicFlowImageLightingRigSchema = z
	.object({
		main: PublicFlowImageLightControlSchema.optional(),
		fill: PublicFlowImageLightControlSchema.optional(),
	})
	.passthrough();

const PublicFlowTaskNodeDataSchema = z
	.object({
		kind: PublicFlowTaskNodeKindSchema,
		label: z.string().optional(),
		referenceImages: z.array(z.string().min(1)).optional(),
		anchorBindings: z.array(PublicFlowAnchorBindingSchema).optional(),
		assetInputs: z
			.array(
				z.object({
					sourceNodeId: optionalNonEmptyString,
					assetId: optionalNonEmptyString,
					assetRefId: optionalNonEmptyString,
					url: optionalNonEmptyString,
					role: optionalNonEmptyString,
					weight: z.number().finite().optional(),
					relationshipKind: z.enum(["primary", "reference"]).optional(),
					note: z.string().optional(),
					name: z.string().optional(),
				}).superRefine((reference, ctx) => {
					if (reference.sourceNodeId || reference.assetId || reference.url) return;
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "asset input requires sourceNodeId, assetId, or an external url; assetRefId is metadata only",
					});
				}),
			)
			.optional(),
		nodeWidth: z.number().finite().optional(),
		nodeHeight: z.number().finite().optional(),
		productionLayer: PublicFlowProductionLayerSchema.optional(),
		creationStage: PublicFlowCreationStageSchema.optional(),
			approvalStatus: PublicFlowApprovalStatusSchema.optional(),
			imageCameraControl: PublicFlowImageCameraControlSchema.optional(),
			imageLightingRig: PublicFlowImageLightingRigSchema.optional(),
		})
		.passthrough();

const PublicFlowGroupNodeDataSchema = z
	.object({
		label: z.string().optional(),
		isGroup: z.boolean().optional(),
		groupKind: z.string().optional(),
	})
	.passthrough();

const PublicFlowGroupNodeStyleSchema = z
	.object({
		width: z.number().finite(),
		height: z.number().finite(),
	})
	.passthrough();

export const PublicFlowCreateTaskNodeSchema = z
	.object({
		id: optionalNonEmptyString,
		type: z.literal("taskNode"),
		// Optional: when omitted, the backend assigns a DAG-aware position
		// (assignIncrementalPositions) instead of trusting an agent coordinate.
		position: PublicFlowNodePositionSchema.optional(),
		data: PublicFlowTaskNodeDataSchema,
		parentId: optionalNonEmptyString,
		selected: z.boolean().optional(),
		draggable: z.boolean().optional(),
		selectable: z.boolean().optional(),
		focusable: z.boolean().optional(),
		dragHandle: optionalNonEmptyString,
	})
	.passthrough();

export const PublicFlowCreateGroupNodeSchema = z
	.object({
		id: optionalNonEmptyString,
		type: z.literal("groupNode"),
		// Optional: when omitted, the backend auto-places the group via
		// assignIncrementalPositions (single source of truth for coordinates).
		// webHero-owned groups still pass an explicit anchor-relative position.
		position: PublicFlowNodePositionSchema.optional(),
		data: PublicFlowGroupNodeDataSchema,
		style: PublicFlowGroupNodeStyleSchema,
		parentId: optionalNonEmptyString,
		selected: z.boolean().optional(),
		draggable: z.boolean().optional(),
		selectable: z.boolean().optional(),
		focusable: z.boolean().optional(),
	})
	.passthrough();

export const PublicFlowCreateNodeSchema = z.union([
	PublicFlowCreateTaskNodeSchema,
	PublicFlowCreateGroupNodeSchema,
]);

const PublicFlowPatchRequestObjectSchema = z
	.object({
		allowOverwrite: z.boolean().optional(),
		deleteNodeIds: z.array(z.string().min(1)).optional(),
		deleteEdgeIds: z.array(z.string().min(1)).optional(),
		createNodes: z.array(PublicFlowCreateNodeSchema).optional(),
		createEdges: z.array(PublicFlowCreateEdgeSchema).optional(),
		patchNodeData: z.array(PublicFlowPatchNodeDataSchema).optional(),
		appendNodeArrays: z.array(PublicFlowAppendNodeArraySchema).optional(),
	})
	.superRefine((patch, ctx) => {
		const explicitNodeIds = new Set<string>();
		for (const [index, node] of (patch.createNodes || []).entries()) {
			const nodeId = typeof node.id === "string" ? node.id.trim() : "";
			if (!nodeId) continue;
			if (explicitNodeIds.has(nodeId)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["createNodes", index, "id"],
					message: `duplicate explicit create node id: ${nodeId}`,
					params: {
						code: "duplicate_flow_create_node_id",
						nodeId,
					},
				});
				continue;
			}
			explicitNodeIds.add(nodeId);
		}
	});

export const PublicFlowPatchRequestSchema = z.preprocess(
	normalizePublicFlowPatchRequest,
	PublicFlowPatchRequestObjectSchema,
);

export type PublicFlowPatchRequestDto = z.infer<typeof PublicFlowPatchRequestSchema>;

export const PublicFlowPatchResponseSchema = z.object({
	ok: z.literal(true),
	flowId: z.string(),
	updatedAt: z.string(),
	stats: z.object({
		deletedNodes: z.number(),
		deletedEdges: z.number(),
		createdNodes: z.number(),
		createdEdges: z.number(),
		patchedNodes: z.number(),
		appendedArrays: z.number(),
		webHeroRewinds: z.array(z.object({
			nodeId: z.string(),
			rewindPhase: PublicFlowWebHeroRewindPhaseSchema,
			clearedFields: z.array(z.string()),
		})).default([]),
	}),
	idMap: z
		.object({
			nodes: z.record(z.string(), z.string()).optional(),
			edges: z.record(z.string(), z.string()).optional(),
		})
		.optional(),
	data: PublicFlowGraphSchema,
});

export type PublicFlowPatchResponseDto = z.infer<typeof PublicFlowPatchResponseSchema>;

export const PublicProjectFlowListItemSchema = z.object({
	id: z.string(),
	name: z.string(),
	updatedAt: z.string(),
});

export const PublicProjectFlowsResponseSchema = z.object({
	items: z.array(PublicProjectFlowListItemSchema),
});

export type PublicProjectFlowsResponseDto = z.infer<typeof PublicProjectFlowsResponseSchema>;
