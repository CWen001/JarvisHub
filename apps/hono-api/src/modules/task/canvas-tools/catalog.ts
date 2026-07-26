import { z } from "zod";

import {
	PublicFlowAnchorBindingSchema,
	PublicFlowPatchRequestSchema,
	optionalNonEmptyString,
} from "../../flow/flow.public.schemas";
import { WEBHERO_EVIDENCE_PHASE_DESCRIPTION } from "../../flow/flow.webhero-evidence-phases";
import {
	AgentImageGenerateToCanvasArgsSchema,
	AgentVideoGenerateToCanvasArgsSchema,
} from "../agents-tool-bridge.agent-media-schemas";
import { PublicAgentsVideoConcatToCanvasArgsSchema } from "../agents-tool-bridge.concat-video-to-canvas";
import { CanvasFlowInspectArgsSchema } from "../agents-tool-bridge.flow-inspect";
import { CanvasGenerationContextGetArgsSchema } from "../agents-tool-bridge.generation-context";
import {
	findMisplacedWebHeroWorkflowFields,
	webHeroMisplacedFieldSchemaGuards,
	WEBHERO_WORKFLOW_CONTRACT_FIELD_PATHS,
	WEBHERO_WORKFLOW_FIELD_PATH_ERROR,
	WEBHERO_WORKFLOW_FIELD_PATH_ISSUE_PARAM,
} from "../agents-tool-bridge.webhero-workflow-contract";
import { defineCanvasTools } from "./schema";
import type {
	BuildCanvasAgentRemoteToolsInput,
	CanvasRemoteToolDefinition,
	CanvasToolEffects,
	CanvasToolPermission,
	CanvasToolSpec,
	ToolResultEffects,
} from "./types";
const provider = { id: "canvas", kind: "remote" } as const;

const stringRecordSchema = z.record(z.unknown());

const UpdateNodeDataValueSchema = stringRecordSchema
	.superRefine((data, ctx) => {
		for (const field of findMisplacedWebHeroWorkflowFields(data)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: [field],
				message: `${field} must be nested at ${WEBHERO_WORKFLOW_CONTRACT_FIELD_PATHS[field]}`,
				params: {
					[WEBHERO_WORKFLOW_FIELD_PATH_ISSUE_PARAM]: WEBHERO_WORKFLOW_FIELD_PATH_ERROR.code,
				},
			});
		}
	})
	.describe(WEBHERO_EVIDENCE_PHASE_DESCRIPTION);

const CanvasAssetInputArgsSchema = z
	.object({
		url: optionalNonEmptyString,
		sourceNodeId: optionalNonEmptyString,
		assetId: optionalNonEmptyString,
		assetRefId: optionalNonEmptyString,
		role: optionalNonEmptyString,
		weight: z.number().finite().optional(),
		note: z.string().optional(),
		name: z.string().optional(),
	})
	.strict()
	.superRefine((reference, ctx) => {
		if (reference.sourceNodeId || reference.assetId || reference.url) return;
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: "asset input requires sourceNodeId, assetId, or an external url; assetRefId is metadata only",
		});
	});

const CanvasGenericNodeDataArgsSchema = z
	.object({
		label: z.string().optional(),
		content: z.string().optional(),
		prompt: z.string().optional(),
		systemPrompt: z.string().optional(),
		webHeroHtml: z.string().optional(),
		webHeroCss: z.string().optional(),
		webHeroDocumentHtml: z.string().optional(),
		nodeWidth: z.number().finite().optional(),
		nodeHeight: z.number().finite().optional(),
	})
	.passthrough();

const CanvasEdgeDataArgsSchema = stringRecordSchema;

const EmptyArgsSchema = z.object({}).strict();
const IdArrayArgsSchema = z.array(z.string().min(1));

const ProjectContextGetArgsSchema = z.object({
	refresh: z.boolean().optional(),
}).strict();

const WebAssetSearchArgsSchema = z.object({
	kind: z.enum(["icon", "image"]),
	query: z.string().min(1),
	limit: z.number().int().min(1).max(20).optional(),
	prefix: z.string().optional(),
	licenseType: z.enum(["all", "all-cc", "commercial", "modification"]).optional(),
	aspectRatio: z.enum(["tall", "wide", "square"]).optional(),
	size: z.enum(["small", "medium", "large"]).optional(),
	format: z.enum(["png", "jpg", "jpeg", "webp", "gif"]).optional(),
	requireTransparent: z.boolean().optional(),
	preferTransparent: z.boolean().optional(),
}).strict();

const WebStyleReferenceSearchArgsSchema = z.object({
	query: z.string().min(1),
	source: z.enum(["all", "pinterest", "dribbble", "behance", "design", "competitors"]).optional(),
	limit: z.number().int().min(1).max(10).optional(),
	proxy: z.string().optional(),
}).strict();

const LimitArgsSchema = z.object({
	limit: z.number().finite().optional(),
}).strict();

const PipelineRunGetArgsSchema = z.object({
	runId: z.string().min(1),
}).strict();

const NodeContextBundleGetArgsSchema = z.object({
	nodeId: optionalNonEmptyString,
}).strict();

const ExecutionGetArgsSchema = z.object({
	executionId: z.string().min(1),
}).strict();

const ExecutionEventsListArgsSchema = z.object({
	executionId: z.string().min(1),
	afterSeq: z.number().finite().optional(),
	limit: z.number().finite().optional(),
}).strict();

const CheckpointCreateArgsSchema = z.object({
	label: z.string().optional(),
	kind: z.enum(["auto", "explicit"]).optional(),
}).strict();

const CheckpointRestoreArgsSchema = z.object({
	versionId: z.string().min(1),
}).strict();

const CheckpointListArgsSchema = z.object({
	limit: z.number().finite().optional(),
	labelPrefix: z.string().optional(),
}).strict();

const EvaluateNodeReadMediaArgsSchema = z.object({
	nodeId: z.string().min(1),
}).strict();

const WaitForResultArgsSchema = z.object({
	nodeId: optionalNonEmptyString,
	taskId: optionalNonEmptyString,
}).strict();

const CreateTextNodeArgsSchema = z.object({
	node: z
		.object({
			id: optionalNonEmptyString,
			parentId: optionalNonEmptyString,
			selected: z.boolean().optional(),
			data: CanvasGenericNodeDataArgsSchema.optional(),
		})
		.strict(),
}).strict();

const CreateWebHeroNodeArgsSchema = z.object({
	node: z
		.object({
			id: optionalNonEmptyString,
			parentId: optionalNonEmptyString,
			selected: z.boolean().optional(),
			data: CanvasGenericNodeDataArgsSchema.optional(),
		})
		.strict(),
}).strict();

const CreatePptNodeArgsSchema = z.object({
	node: z
		.object({
			id: optionalNonEmptyString,
			parentId: optionalNonEmptyString,
			selected: z.boolean().optional(),
			data: z.object({
				label: z.string().optional(),
				content: z.string().optional(),
				prompt: z.string().optional(),
				systemPrompt: z.string().optional(),
				nodeWidth: z.number().finite().optional(),
				nodeHeight: z.number().finite().optional(),
				outline: z.string().optional(),
				audience: z.string().optional(),
				tone: z.string().optional(),
				format: z.enum(["ppt169", "ppt43", "xhs", "story"]).optional(),
				slideCount: z.number().int().min(1).max(80).optional(),
				sourceNodeIds: z.array(z.string().min(1)).optional(),
				sourceFiles: z.array(z.string().min(1)).optional(),
			}).strict().optional(),
		})
		.strict(),
}).strict();

const CreateGroupArgsSchema = z.object({
	group: z
		.object({
			id: optionalNonEmptyString,
			parentId: optionalNonEmptyString,
			selected: z.boolean().optional(),
			label: z.string().optional(),
			groupKind: z.string().optional(),
			width: z.number().finite().optional(),
			height: z.number().finite().optional(),
		})
		.strict(),
}).strict();

const ConnectNodesArgsSchema = z.object({
	edges: z.array(
		z
			.object({
				id: optionalNonEmptyString,
				source: z.string().min(1),
				target: z.string().min(1),
				sourceHandle: z.string().optional(),
				targetHandle: z.string().optional(),
				type: z.string().optional(),
				label: z.string().optional(),
				data: CanvasEdgeDataArgsSchema.optional(),
			})
			.passthrough(),
	),
}).strict();

const BindReferencesArgsSchema = z.object({
	bindings: z.array(
		z
			.object({
				nodeId: z.string().min(1),
				referenceImages: z.array(z.string()).optional(),
				assetInputs: z.array(CanvasAssetInputArgsSchema).optional(),
				anchorBindings: z.array(PublicFlowAnchorBindingSchema).optional(),
			})
			.strict(),
	),
}).strict();

const UpdateNodeDataArgsSchema = z.object({
	patchNodeData: z.array(
		z
			.object({
				id: z.string().min(1),
				data: UpdateNodeDataValueSchema,
			})
			.strict(),
	),
}).strict();

const WebHeroCodeFieldArgsSchema = z.enum([
	"webHeroHtml",
	"webHeroCss",
	"html",
	"css",
]);

const WebHeroCodeReadinessSnapshotArgsSchema = {
	flowUpdatedAt: z.string().min(1).max(80),
	codeInputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	previewNodeIds: z.array(z.string().min(1).max(160)).min(1).max(4).refine(
		(items) => new Set(items).size === items.length,
		"previewNodeIds must not contain duplicates",
	),
};

const WebHeroCodeStageChunkArgsSchema = z.object({
	nodeId: z.string().min(1),
	sessionId: z.string().min(1).max(120),
	...WebHeroCodeReadinessSnapshotArgsSchema,
	field: WebHeroCodeFieldArgsSchema,
	index: z.number().int().min(0),
	total: z.number().int().min(1).max(200),
	chunk: z.string().min(1).max(8000).optional(),
	chunkBase64: z.string().min(1).max(32000).optional(),
}).strict();

const WebHeroCodeStageRawChunkArgsSchema = z.object({
	nodeId: z.string().min(1),
	sessionId: z.string().min(1).max(120),
	...WebHeroCodeReadinessSnapshotArgsSchema,
	field: WebHeroCodeFieldArgsSchema,
	index: z.number().int().min(0),
	total: z.number().int().min(1).max(200),
	chunk: z.string().min(1).max(8000),
}).strict();

const WebHeroCodeCommitArgsSchema = z.object({
	nodeId: z.string().min(1),
	sessionId: z.string().min(1).max(120),
}).strict();

const PptMasterProjectInitArgsSchema = z.object({
	nodeId: z.string().min(1),
	projectName: z.string().min(1).max(120),
	format: z.enum(["ppt169", "ppt43", "xhs", "story"]).optional(),
	timeoutMs: z.number().min(5000).max(600000).optional(),
}).strict();

const PptMasterExportToPptxArgsSchema = z.object({
	nodeId: z.string().min(1),
	projectPath: z.string().min(1),
	timeoutMs: z.number().min(5000).max(600000).optional(),
}).strict();

const PptMasterCheckReadinessArgsSchema = z.object({
	nodeId: z.string().min(1),
}).strict();

const PptMasterWriteSlideSvgArgsSchema = z.object({
	nodeId: z.string().min(1),
	slideIndex: z.number().int().min(1).max(99),
	svgMarkup: z.string().min(8),
}).strict();

const WebHeroCheckReadinessArgsSchema = z.object({
	nodeId: z.string().min(1),
	force: z.boolean().optional(),
}).strict();

const DeleteCanvasItemsArgsSchema = z.object({
	nodeIds: IdArrayArgsSchema.optional(),
	edgeIds: IdArrayArgsSchema.optional(),
}).strict();

const ReflowLayoutArgsSchema = z.object({
	scope: z.enum(["canvas", "topLevelGroups", "group"]),
	targetGroupId: z.string().optional(),
	focusNodeId: z.string().optional(),
}).strict();

const GroupExistingNodesArgsSchema = z.object({
	nodeIds: z.array(z.string().min(1)).min(1).max(200),
	label: z.string().min(1).max(80).optional(),
}).strict();

const allowPermission: CanvasToolPermission = { defaultMode: "allow" };
const askPermission: CanvasToolPermission = { defaultMode: "ask", requiresUserIntent: true };
const readOnlyEffects: CanvasToolEffects = { readOnly: true };
const canvasWriteEffects: CanvasToolEffects = { readOnly: false, mutatesCanvas: true };
const nonCanvasSideEffectEffects: CanvasToolEffects = { readOnly: false, mutatesCanvas: false };

const CANVAS_TOOL_SPECS = defineCanvasTools([
	{
		name: "canvas_project_flows_list",
		description: "List flows in the authorized JarvisHub project.",
		zodInputSchema: EmptyArgsSchema,
		provider,
		scope: "project",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "project_flows_list",
	},
	{
		name: "canvas_project_context_get",
		description: "Read the authorized JarvisHub project workspace context assembled by hono-api.",
		zodInputSchema: ProjectContextGetArgsSchema,
		provider,
		scope: "project",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "project_context_get",
	},
	{
		name: "canvas_web_asset_search",
		description:
			"Search real reusable web assets before WebHero/code generation. Use kind=icon for open-source Iconify icons instead of model-written SVG; use kind=image for Openverse web imagery with license metadata. For cutout/foreground/logo/product overlay needs, pass requireTransparent=true or preferTransparent=true with format=png so the tool probes PNG alpha and returns transparentBackground evidence; if no verified alpha candidate is found, generate a matching webpage asset instead of using an opaque rectangle.",
		zodInputSchema: WebAssetSearchArgsSchema,
		provider,
		scope: "project",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "web_asset_search",
	},
	{
		name: "canvas_web_style_reference_search",
		description:
			"Search style reference images from design/reference sources such as Awwwards, SiteInspire, Pinterest, Dribbble, Behance, or competitors before building a WebHero visual direction. After getting results, call ask_user with optionCards that include imageUrl thumbnails so the user can pick a style. Do not create canvas nodes for references. This is read-only inspiration, not final webpage media.",
		zodInputSchema: WebStyleReferenceSearchArgsSchema,
		provider,
		scope: "project",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "web_style_reference_search",
	},
	{
		name: "canvas_pipeline_runs_list",
		description: "List agent pipeline runs in the authorized project.",
		zodInputSchema: LimitArgsSchema,
		provider,
		scope: "project",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "pipeline_runs_list",
	},
	{
		name: "canvas_pipeline_run_get",
		description: "Read one agent pipeline run by runId in the authorized project scope.",
		zodInputSchema: PipelineRunGetArgsSchema,
		provider,
		scope: "project",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "pipeline_run_get",
	},
	{
		name: "canvas_node_context_bundle_get",
		description: "Read a real node context bundle for one node in the authorized JarvisHub flow.",
		zodInputSchema: NodeContextBundleGetArgsSchema,
		provider,
		scope: "node",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "node_context_bundle_get",
	},
	{
		name: "canvas_video_review_bundle_get",
		description: "Read a real video review bundle for one video/composeVideo node in the authorized flow.",
		zodInputSchema: NodeContextBundleGetArgsSchema,
		provider,
		scope: "node",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "video_review_bundle_get",
	},
	{
		name: "canvas_executions_list",
		description: "List workflow executions for the authorized flow.",
		zodInputSchema: LimitArgsSchema,
		provider,
		scope: "flow",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "executions_list",
	},
	{
		name: "canvas_execution_get",
		description: "Read one workflow execution by executionId in the authorized flow scope.",
		zodInputSchema: ExecutionGetArgsSchema,
		provider,
		scope: "flow",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "execution_get",
	},
	{
		name: "canvas_execution_node_runs_get",
		description: "List node runs for one workflow execution by executionId in the authorized flow scope.",
		zodInputSchema: ExecutionGetArgsSchema,
		provider,
		scope: "flow",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "execution_node_runs_get",
	},
	{
		name: "canvas_execution_events_list",
		description: "List execution events for one workflow execution in the authorized flow scope.",
		zodInputSchema: ExecutionEventsListArgsSchema,
		provider,
		scope: "flow",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "execution_events_list",
	},
	{
		name: "canvas_flow_get",
		description: "Read the complete current JarvisHub flow graph, including full node data and edges. This is a heavyweight snapshot for workflows that truly need complete business-node content or deep recovery state; use canvas_flow_inspect for ordinary existence, status, persistence, and dependency checks.",
		zodInputSchema: EmptyArgsSchema,
		provider,
		scope: "flow",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "flow_get",
	},
	{
		name: "canvas_flow_inspect",
		description: "Read a compact canvas state ledger for existence, status, persisted media, and optional dependencies. Returns no prompts, media URLs, result arrays, layout, vendor debug payloads, or arbitrary node data. Use exact nodeIds when known: missingNodeIds is computed against the complete graph even when output is size-truncated. Never infer absence from omitted prefix matches when truncated=true.",
		zodInputSchema: CanvasFlowInspectArgsSchema,
		provider,
		scope: "flow",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "flow_inspect",
	},
	{
		name: "canvas_generation_context_get",
		description: "Read one media node's prompt, model, generation parameters, and ID-first references for an explicit retry or regeneration decision. Do not call during routine state checks; use canvas_flow_inspect first. Internal generated-media URLs and vendor debug payloads are omitted.",
		zodInputSchema: CanvasGenerationContextGetArgsSchema,
		provider,
		scope: "flow",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "generation_context_get",
	},
	{
		name: "canvas_flow_patch",
		description: "Internal deterministic JarvisHub flow graph patch. Not exposed to ordinary agents.",
		zodInputSchema: PublicFlowPatchRequestSchema,
		provider,
		scope: "flow",
		effects: { ...canvasWriteEffects, destructive: true },
		permission: askPermission,
		exposure: "internal",
		handler: "flow_patch",
	},
	{
		name: "canvas_flow_checkpoint_create",
		description: "Snapshot the current authorized flow data into a flow_versions row as an agent checkpoint.",
		zodInputSchema: CheckpointCreateArgsSchema,
		provider,
		scope: "flow",
		effects: { readOnly: false, mutatesCanvas: false },
		permission: allowPermission,
		exposure: "agent",
		handler: "flow_checkpoint_create",
	},
	{
		name: "canvas_flow_checkpoint_restore",
		description: "Restore the authorized flow data to a prior flow_versions snapshot.",
		zodInputSchema: CheckpointRestoreArgsSchema,
		provider,
		scope: "flow",
		effects: { ...canvasWriteEffects, destructive: true },
		permission: askPermission,
		exposure: "agent",
		handler: "flow_checkpoint_restore",
	},
	{
		name: "canvas_flow_checkpoint_list",
		description: "List recent flow_versions rows for the authorized flow, newest first.",
		zodInputSchema: CheckpointListArgsSchema,
		provider,
		scope: "flow",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "flow_checkpoint_list",
	},
	{
		name: "canvas_evaluate_node_read_media",
		description:
			"Read a canvas node's real runtime media URLs or text content. Fails loud when the node has no inspectable media/text. Do not treat a queued/running media node without imageUrl/videoUrl as completed output; use the matching wait tool before evaluating and call this only after real media URLs exist. Not for existence checks: this tool 404s on non-existent nodeIds. Use canvas_flow_inspect for existence, state, persistence, and dependency checks.",
		zodInputSchema: EvaluateNodeReadMediaArgsSchema,
		provider,
		scope: "node",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "evaluate_node_read_media",
	},
	{
		name: "canvas_image_generate_to_canvas",
		description: "Submit an image render through the backend vendor pipeline and persist it on canvas. Provide a stable outputKey, label, prompt, optional aspectRatio/resolution, optional references, and optional purpose metadata for storyboard, visual asset, WebHero preview, webpage asset usage, or pptDeck slide imagery. For WebHero previews, set purpose.kind=webPreview and provide purpose.forNodeId, a unique purpose.sectionId, and purpose.order exactly contiguous 1..N; never pass purpose.slotId for webPreview. The server atomically persists sectionId/order as webScreenshotSectionId/webScreenshotOrder. For WebHero preview and webpage asset generation, omit resolution by default; the backend uses the configured image model defaultImageSize and falls back to 1K for APIMart/GPT-Image-2 WebHero media. For WebHero webpage assets, set purpose.kind=webPageAsset and preserve purpose.forNodeId/assetId/slotId/placement. Set purpose.transparentPng=true only for a single isolated cutout with no background plate, such as a product/device/logo/sticker foreground that must layer over live HTML/CSS; do not request transparency for full hero scenes, illustration clusters, dashboards, maps, backgrounds, or composed section artwork. For WebHero webpage assets, never add a rounded/square card, border, drop shadow, glass tile, or frame by default. Add that container only when the approved preview visibly places this exact subject inside such a card/panel; otherwise generate a transparent cutout, background-matched media, masked media, or full-bleed media directly. For pptDeck slide imagery, set purpose.kind=pptDeckImage, purpose.forNodeId=<pptDeck node id>, and purpose.slideIndex=<slide.index>; these fields are mandatory so the backend groups all generated PPT image nodes together on the canvas. PPT image prompts must generate only the illustration/photo/chart/diagram asset needed inside the slide, not a complete PPT slide screenshot, slide mockup, title/bullet layout, footer, or presentation frame. Avoid blue-purple gradients and purple/indigo neon gradient palettes.",
		zodInputSchema: AgentImageGenerateToCanvasArgsSchema,
		provider,
		scope: "flow",
		effects: {
			...canvasWriteEffects,
			generatesMedia: true,
			mediaKind: "image",
			costBearing: true,
			longRunning: true,
		},
		permission: { defaultMode: "ask", requiresUserIntent: true },
		exposure: "agent",
		handler: "image_generate_to_canvas",
	},
	{
		name: "canvas_image_wait_for_result",
		description:
			"Wait for one existing queued/running image canvas node with a bounded backend polling budget. The tool is bound to the target nodeId, recognizes existing imageUrl or imageResults[].url, patches only that same node when terminal, returns pending:true if the bounded wait expires while the task is still queued/running, and does so without submitting or patching anything else. Agents must not pass timeout or poll settings; those fields are protocol errors.",
		zodInputSchema: WaitForResultArgsSchema,
		provider,
		scope: "node",
		effects: canvasWriteEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "image_wait_for_result",
	},
	{
		name: "canvas_video_generate_to_canvas",
		description: "Submit an image-to-video clip through the backend vendor pipeline and persist it on canvas. Provide a stable outputKey, label, prompt, at least one reference, and optional aspectRatio, durationSeconds, audioMode, and returnLastFrame fields.",
		zodInputSchema: AgentVideoGenerateToCanvasArgsSchema,
		provider,
		scope: "flow",
		effects: {
			...canvasWriteEffects,
			generatesMedia: true,
			mediaKind: "video",
			costBearing: true,
			longRunning: true,
		},
		permission: { defaultMode: "ask", requiresUserIntent: true },
		exposure: "agent",
		handler: "video_generate_to_canvas",
	},
	{
		name: "canvas_video_wait_for_result",
		description:
			"Wait for one existing queued/running video canvas node with a bounded backend polling budget. The tool is bound to the target nodeId, recognizes existing videoUrl or videoResults[].url, patches only that same node when terminal, returns pending:true if the bounded wait expires while the task is still queued/running, and does so without submitting or patching anything else. Agents must not pass timeout or poll settings; those fields are protocol errors.",
		zodInputSchema: WaitForResultArgsSchema,
		provider,
		scope: "node",
		effects: canvasWriteEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "video_wait_for_result",
	},
	{
		name: "canvas_video_concat_to_canvas",
		description: "Concatenate existing video assets and persist the merged output on the current flow. audioPolicy controls audio handling: 'preserve' (require audio on every source, fail otherwise), 'drop' (output silent video), 'auto' (default — preserve when all sources have audio, drop when all are silent, fail loud on mixed sources).",
		zodInputSchema: PublicAgentsVideoConcatToCanvasArgsSchema,
		provider,
		scope: "flow",
		effects: { ...canvasWriteEffects, generatesMedia: true, mediaKind: "video", longRunning: true },
		permission: allowPermission,
		exposure: "agent",
		handler: "video_concat_to_canvas",
	},
	{
		name: "canvas_create_text_node",
		description: "Create a text taskNode on the current JarvisHub flow.",
		zodInputSchema: CreateTextNodeArgsSchema,
		provider,
		scope: "flow",
		effects: canvasWriteEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "create_text_node",
	},
	{
		name: "canvas_create_webhero_node",
		description:
			"Create a webHero taskNode on the current JarvisHub flow for final website/page code. After creating the node, follow the 6-step webPageWorkflowContract in order: style reference selection, preview generation, preview visual spec, asset inventory, asset resolution, then final code. Use this when a website workflow needs a concrete Web Hero target and none exists; node.id is required for stable staged code writeback, and final HTML/CSS must live in webHeroHtml, webHeroCss, and webHeroDocumentHtml, not in a text node.",
		zodInputSchema: CreateWebHeroNodeArgsSchema,
		provider,
		scope: "flow",
		effects: canvasWriteEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "create_webhero_node",
	},
	{
		name: "canvas_create_ppt_node",
		description:
			"Create a pptDeck taskNode on the current JarvisHub flow for any PPT / PPTX / slides / presentation request. IMPORTANT: After creating the node, you MUST follow the 6-step PPT Master serial pipeline in pptMasterWorkflowContract.acceptanceCriteria IN ORDER: (1) topic_research — gather sources or accept user-supplied content into pptResearch, (2) project_init — call canvas_ppt_master_project_init to materialize <project> on disk, (3) strategist_outline — persist slides[] with index/title/subtitle/bullets/speakerNotes/visualBrief, (4) image_generation — call canvas_image_generate_to_canvas for every slide whose visualBrief needs an image, passing purpose.kind=pptDeckImage with forNodeId and slideIndex (the backend derives slides[i].imageUrl automatically — never set it yourself), (5) svg_authoring — author one SVG per page by calling canvas_ppt_master_write_slide_svg (the server publishes one immutable SVG artifact and patches slides[i].svgUrl automatically), (6) export_pptx — call canvas_ppt_master_export_to_pptx. PPT image prompts must generate only in-slide illustration/photo/chart/diagram assets, not full PPT screenshots or slide mockups, and must avoid blue-purple gradients. PPT image calls must pass purpose.kind=pptDeckImage with forNodeId and slideIndex so all generated image files are grouped on the canvas. The canvas runtime DOES support local SVG file writes via canvas_ppt_master_write_slide_svg — do NOT claim svg_authoring is impossible. DO NOT SKIP ANY STEP. Each step updates stepStatus via canvas_update_node_data and may only start after the prior step is completed.",
		zodInputSchema: CreatePptNodeArgsSchema,
		provider,
		scope: "flow",
		effects: canvasWriteEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "create_ppt_node",
	},
	{
		name: "canvas_ppt_master_project_init",
		description:
			"Step 2/6 of the PPT Master pipeline. Initialize a local PPT Master project inside the target node's server-owned workspace by running scripts/project_manager.py init. The caller cannot choose or reuse a filesystem directory. ONLY call after pptMasterWorkflowContract.stepStatus.topic_research=completed. Requires PPT_MASTER_HOME or PPT_MASTER_SKILL_DIR to point at ppt-master/skills/ppt-master. This updates the node with pptMasterProjectPath and project_init=completed.",
		zodInputSchema: PptMasterProjectInitArgsSchema,
		provider,
		scope: "flow",
		effects: { ...canvasWriteEffects, longRunning: true },
		permission: allowPermission,
		exposure: "agent",
		handler: "ppt_master_project_init",
	},
	{
		name: "canvas_ppt_master_export_to_pptx",
		description:
			"Step 6/6 (final) of the PPT Master pipeline. Export the exact immutable SVG artifacts persisted on the target deck to editable PPTX by running scripts/svg_to_pptx.py. The caller cannot select an alternate source directory. ONLY call after pptMasterWorkflowContract.stepStatus.svg_authoring=completed. The server runs canvas_ppt_master_check_readiness internally; if readiness fails the call is refused. This updates the pptDeck node with pptxPath / pptxUrl and stepStatus.export_pptx=completed.",
		zodInputSchema: PptMasterExportToPptxArgsSchema,
		provider,
		scope: "flow",
		effects: { ...canvasWriteEffects, longRunning: true, costBearing: false },
		permission: allowPermission,
		exposure: "agent",
		handler: "ppt_master_export_to_pptx",
	},
	{
		name: "canvas_ppt_master_check_readiness",
		description:
			"[REQUIRED before export_pptx] Inspect the pptDeck node and return a readiness report for the 6-step PPT Master pipeline. Returns: ready (boolean), stepStatus, missing (string[] of missing items: research, projectPath, slides, imageUrls, svgUrls), summary (Markdown). Always call this just before canvas_ppt_master_export_to_pptx. If ready=false, fix every missing item, then re-check.",
		zodInputSchema: PptMasterCheckReadinessArgsSchema,
		provider,
		scope: "flow",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "ppt_master_check_readiness",
	},
	{
		name: "canvas_ppt_master_write_slide_svg",
		description:
			"Step 5/6 of the PPT Master pipeline. Publish one hand-authored SVG page as an immutable content-addressed artifact. svgMarkup is the full SVG markup (must start with <svg>). When the slide has a generated pptDeckImage, place that image with <image href=\"{{PPT_SLIDE_IMAGE}}\" .../>; the server materializes the backend-derived slide URL into the project and rewrites that exact placeholder. Do not pass a URL, sourceNodeId, or guessed filename. slides[i].imageUrl is backend-owned (derived from the generated image node) — never set it yourself. The tool atomically patches the artifact's svgUrl onto the persisted slide. Use this AFTER image_generation=completed.",
		zodInputSchema: PptMasterWriteSlideSvgArgsSchema,
		provider,
		scope: "flow",
		effects: { ...canvasWriteEffects, longRunning: false, costBearing: false },
		permission: allowPermission,
		exposure: "agent",
		handler: "ppt_master_write_slide_svg",
	},
	{
		name: "canvas_webhero_code_stage_chunk",
		description:
			"Stage one bounded HTML or CSS chunk for a target WebHero node after same-node readiness passes. Every chunk must copy the exact flowUpdatedAt, previewNodeIds, and codeInputDigest returned by that readiness call; the session and current flow must keep the same snapshot. Use one stable sessionId and stage only webHeroHtml/html plus webHeroCss/css; webHeroDocumentHtml is derived canonically at commit and cannot be staged. Pass exactly one payload field: valid chunkBase64 or a raw chunk under 8000 characters. Never pass both.",
		zodInputSchema: WebHeroCodeStageChunkArgsSchema,
		provider,
		scope: "flow",
		effects: nonCanvasSideEffectEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "webhero_code_stage_chunk",
	},
	{
		name: "canvas_webhero_code_stage_raw_chunk",
		description:
			"Stage one raw HTML or CSS chunk under 8000 characters after same-node readiness passes. Every chunk must copy the exact flowUpdatedAt, previewNodeIds, and codeInputDigest returned by that readiness call; the session and current flow must keep the same snapshot. Use one stable sessionId and stage only webHeroHtml/html plus webHeroCss/css; webHeroDocumentHtml is derived canonically at commit and cannot be staged.",
		zodInputSchema: WebHeroCodeStageRawChunkArgsSchema,
		provider,
		scope: "flow",
		effects: nonCanvasSideEffectEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "webhero_code_stage_raw_chunk",
	},
	{
		name: "canvas_webhero_code_commit",
		description:
			"Atomically commit staged WebHero HTML/CSS to the target node with forced overwrite and a server-derived webHeroDocumentHtml. If a response is lost, retry the same sessionId: an already committed session returns idempotent success only when persisted node code exactly matches it. Never use a new session as a commit retry.",
		zodInputSchema: WebHeroCodeCommitArgsSchema,
		provider,
		scope: "flow",
		effects: canvasWriteEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "webhero_code_commit",
	},
	{
		name: "canvas_webhero_check_readiness",
		description:
			"Inspect WebHero final-code readiness. Returns ready, missing evidence, previewNodeCount, exact previewNodeIds, flowUpdatedAt, and a canonical codeInputDigest over the style/spec/asset/draft inputs. A merge task_contract and every staged chunk must copy all three snapshot fields exactly; each successful readiness result can authorize only one serialized merge dispatch.",
		zodInputSchema: WebHeroCheckReadinessArgsSchema,
		provider,
		scope: "flow",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "webhero_check_readiness",
	},
	{
		name: "canvas_create_group",
		description: "Create a groupNode container on the current JarvisHub flow.",
		zodInputSchema: CreateGroupArgsSchema,
		provider,
		scope: "flow",
		effects: canvasWriteEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "create_group",
	},
	{
		name: "canvas_connect_nodes",
		description: "Create one or more edges between existing or newly created JarvisHub nodes.",
		zodInputSchema: ConnectNodesArgsSchema,
		provider,
		scope: "flow",
		effects: canvasWriteEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "connect_nodes",
	},
	{
		name: "canvas_bind_references",
		description: "Bind reference images, asset inputs, or anchor bindings to existing canvas nodes.",
		zodInputSchema: BindReferencesArgsSchema,
		provider,
		scope: "flow",
		effects: canvasWriteEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "bind_references",
	},
	{
		name: "canvas_update_node_data",
		description: `Update data on existing canvas nodes: explicitly supplied ordinary fields replace their previous value, omitted fields are preserved, WebHero workflow/goal contracts merge semantically, and WebHero section drafts upsert by previewNodeId. Changing patchNodeData[].data.webPageWorkflowContract.selectedStyleReference OR patchNodeData[].data.webPageWorkflowContract.approvedPreviewNodes is an exclusive state transition: pass patchNodeData[].data.webHeroResetDownstreamEvidence=true in that same item, change exactly one of those two fields, and do not include specs/assets/briefs/checklists/drafts in the transition call. A selectedStyleReference transition must also set a non-null sibling patchNodeData[].data.webPageWorkflowContract.sharedStyleBible (both fields nested inside the same webPageWorkflowContract object). selectedStyleReference, sharedStyleBible, and approvedPreviewNodes are invalid at patchNodeData[].data top level. Later status updates must be partial and must not resend either transition field. The transition atomically clears downstream and committed-code evidence. Rewriting preview_visual_spec, asset_inventory, asset_resolution, or section_codegen after downstream evidence exists requires patchNodeData[].data.webHeroRewindFromPhase set to that exact phase; preview approval changes use the reset transition above. The response reports cleared fields in stats.webHeroRewinds. For generated WebHero media, persist webPageResolvedAssets records with the exact assetId and sourceNodeId returned by the canvas node; internal imageUrl values are intentionally hidden and must not be copied or guessed. External searched/reused media records use their browser URL. ${WEBHERO_EVIDENCE_PHASE_DESCRIPTION} webPageAssetDecisions requires icons/searchAssets/generatedAssets/fontPlan/stylePlan, generatedAssets requires real assetId+slotId+sourceNodeId|generatedNodeId records, and non-empty webPageSectionDrafts must be exact successful section_codegen outputs with runtime-injected provenance. WebHero final-code creation remains forbidden and must use the dedicated staged commit tools.`,
		zodInputSchema: UpdateNodeDataArgsSchema,
		provider,
		scope: "flow",
		effects: canvasWriteEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "update_node_data",
	},
	{
		name: "canvas_delete_canvas_items",
		description: "Delete existing canvas nodes and/or edges from the current flow.",
		zodInputSchema: DeleteCanvasItemsArgsSchema,
		provider,
		scope: "flow",
		effects: { ...canvasWriteEffects, destructive: true },
		permission: askPermission,
		exposure: "agent",
		handler: "delete_canvas_items",
	},
	{
		name: "canvas_reflow_layout",
		description:
			"Reflow the current canvas layout to avoid node overlap. Call after node/group creation or edge changes. scope=canvas reflows the whole canvas (and top-level groups); scope=topLevelGroups only repositions top-level groupNodes; scope=group reflows the inner contents of one specified group (targetGroupId required). Layout execution is performed by the frontend; the server only validates arguments.",
		zodInputSchema: ReflowLayoutArgsSchema,
		provider,
		scope: "flow",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "reflow_layout",
	},
	{
		name: "canvas_group_existing_nodes",
		description:
			"Wrap one or more existing canvas nodes into a NEW group node (atomically rewrites their parentId and converts child positions to local coordinates). " +
			"Constraints: all target nodes must currently share the same parentId (top-level OR same group); groupNodes are filtered out; node IDs must already exist on the canvas. " +
			"Use this AFTER canvas_flow_inspect has confirmed the target node IDs exist and share a parent. " +
			"To discover the new group's id, call canvas_flow_inspect afterwards. " +
			"Does NOT support appending to an existing group. Layout execution is performed by the frontend; the server only validates arguments.",
		zodInputSchema: GroupExistingNodesArgsSchema,
		provider,
		scope: "flow",
		effects: readOnlyEffects,
		permission: allowPermission,
		exposure: "agent",
		handler: "group_existing_nodes",
	},
]);

// The "workflow fields must be nested under webPageWorkflowContract" rule lives in a
// zod superRefine, which zodToJsonSchema drops — so the schema transmitted to the agent
// CLI cannot express it and the CLI can only learn of a misplaced field after a failed
// server round-trip. Re-attach the rule to the transmitted canvas_update_node_data
// schema as standard `{ not: {} }` property guards so the CLI's generic validator
// rejects it pre-flight. The server zod check remains the authoritative enforcement.
(() => {
	const spec = CANVAS_TOOL_SPECS.find((item) => item.name === "canvas_update_node_data");
	const dataSchema = (spec?.inputSchema as {
		properties?: { patchNodeData?: { items?: { properties?: { data?: Record<string, unknown> } } } };
	})?.properties?.patchNodeData?.items?.properties?.data;
	if (!dataSchema) {
		throw new Error("canvas_update_node_data schema shape changed: cannot attach WebHero field-path guards");
	}
	dataSchema.properties = {
		...(dataSchema.properties as Record<string, unknown> | undefined),
		...webHeroMisplacedFieldSchemaGuards(),
	};
})();

const toolSpecByName = new Map<string, CanvasToolSpec>(
	CANVAS_TOOL_SPECS.map((spec) => [spec.name, spec]),
);

export function listCanvasToolSpecs(): CanvasToolSpec[] {
	return CANVAS_TOOL_SPECS.slice();
}

export function getCanvasToolSpec(name: string): CanvasToolSpec | null {
	return toolSpecByName.get(name) ?? null;
}

export function buildCanvasAgentRemoteTools(
	input: BuildCanvasAgentRemoteToolsInput,
): CanvasRemoteToolDefinition[] {
	if (!input.publicAgentsRequest) return [];
	const projectId = String(input.canvasProjectId || "").trim();
	const flowId = String(input.canvasFlowId || "").trim();
	if (!projectId && !flowId) return [];
	const specs: readonly CanvasToolSpec[] = CANVAS_TOOL_SPECS;
	return specs.filter((spec) => {
		if (spec.exposure !== "agent") return false;
		if (spec.scope === "project") return Boolean(projectId);
		if (spec.scope === "flow" || spec.scope === "node") return Boolean(flowId);
		return true;
	}).map((spec) => ({
		name: spec.name,
		description: spec.description,
		parameters: spec.inputSchema,
		provider: spec.provider,
		scope: spec.scope,
		effects: spec.effects,
		permission: spec.permission,
		...(spec.outputSchema ? { outputSchema: spec.outputSchema } : {}),
	}));
}

export function buildEffectsForToolResult(
	spec: CanvasToolSpec,
	effects?: ToolResultEffects,
): ToolResultEffects {
	return {
		...(effects || {}),
		...(spec.effects.mutatesCanvas ? { wroteCanvas: effects?.wroteCanvas ?? true } : {}),
	};
}
