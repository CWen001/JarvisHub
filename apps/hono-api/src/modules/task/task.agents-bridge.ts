import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import { listAssetsForUser, type AssetRow } from "../asset/asset.repo";
import type { AppContext } from "../../types";
import { readBrandedEnv, readBrandedProcessEnv } from "../../utils/brandedEnv";
import { appendTraceEvent } from "../../trace";
import { writeUserExecutionTrace, buildUserMemoryContext, formatMemoryContextForPrompt } from "../memory/memory.service";
import type { PublicChatPromptContext, PublicChatReferenceImageSlot } from "./chat-prompt.types";
import { buildPublicChatExecutionPlanningDirective } from "./public-chat-execution-planning";
import { detectPptIntent, buildPptMasterSystemPromptAddendum } from "./agents-tool-bridge.ppt-master-prompt";
import {
	buildPublicChatExpectedDeliverySummary,
	verifyPublicChatDelivery,
	type PublicChatCanvasPersistenceEvidence,
	type PublicChatDeliveryEvidence,
	type PublicChatExpectedDeliveryKind,
	type PublicChatDeliveryVerificationSummary,
	type PublicChatExpectedDeliverySummary,
} from "./public-chat-delivery-verifier";
import { getFlowForOwner, listFlowsByOwner } from "../flow/flow.repo";
import {
	CANVAS_PLAN_TAG_NAME,
	canvasPlanSchema,
	type ChatCanvasPlan,
} from "../apiKey/canvasPlanProtocol";
import {
	normalizePublicFlowAnchorBindings,
	type PublicFlowAnchorBinding,
} from "../flow/flow.anchor-bindings";
import type { TaskRequestDto, TaskResultDto } from "./task.schemas";
import { createSseEventParser } from "../../utils/sse";
import type { SseEventMessage } from "../../utils/sse";
import { buildCanvasCapabilityManifest } from "../ai/tool-schemas";
import { buildCanvasAgentRemoteTools } from "./canvas-tools/catalog";
import type { CanvasRemoteToolDefinition } from "./canvas-tools/types";
import {
	loadGenerationContractModule,
	loadImagePromptSpecModule,
	type GenerationContract,
	type ImagePromptSpecV2,
} from "../../platform/node/shared-schema-loader";
import {
	resolveAgentLlmCredentials,
	resolveModelConfigDefaultModel,
	resolveMultimodalLlmCredentials,
	type AgentLlmCredentials,
} from "../model-config/model-config.service";
import { getCatalogVendorByKey } from "../model-catalog/model-catalog.repo";

type ActiveCanvasModelLabel = { vendorLabel: string; modelLabel: string };
type ActiveCanvasModelsSnapshot = {
	image: ActiveCanvasModelLabel | null;
	video: ActiveCanvasModelLabel | null;
};

async function resolveActiveCanvasModelLabel(
	c: AppContext,
	slot: "image" | "video",
): Promise<ActiveCanvasModelLabel | null> {
	try {
		const resolved = await resolveModelConfigDefaultModel(c, slot);
		if (!resolved) return null;
		const vendor = await getCatalogVendorByKey(c.env.DB, resolved.vendorKey);
		const vendorLabel = vendor?.name?.trim() || resolved.vendorKey;
		const modelLabel = resolved.label?.trim() || resolved.modelAlias || resolved.modelKey;
		if (!vendorLabel || !modelLabel) return null;
		return { vendorLabel, modelLabel };
	} catch (err) {
		// 默认模型未配置或不可用：active-model 注入是只读快照，不应阻断对话；
		// 真正的硬性失败由 bridge 的 resolveCanvasTaskModel 在生成时报。
		console.warn("[agents-bridge] active-model snapshot resolve failed", {
			slot,
			err: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
}

async function resolveActiveCanvasModelsSnapshot(
	c: AppContext,
): Promise<ActiveCanvasModelsSnapshot> {
	const [image, video] = await Promise.all([
		resolveActiveCanvasModelLabel(c, "image"),
		resolveActiveCanvasModelLabel(c, "video"),
	]);
	return { image, video };
}

function redactLlmCredsForLog(creds: AgentLlmCredentials): {
	vendorKey: string;
	baseUrl: string;
	modelKey: string;
	apiKey: string;
} {
	const apiKey = creds.apiKey || "";
	return {
		vendorKey: creds.vendorKey,
		baseUrl: creds.baseUrl,
		modelKey: creds.modelKey,
		apiKey:
			apiKey.length > 12
				? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`
				: apiKey
					? "***"
					: "",
	};
}

const generationContractModule = loadGenerationContractModule();
const imagePromptSpecModule = loadImagePromptSpecModule();
const { parseGenerationContract } = generationContractModule;
const { parseImagePromptSpecV2 } = imagePromptSpecModule;
const AGENTS_BRIDGE_MIN_TIMEOUT_MS = 5_000;
const AGENTS_BRIDGE_MAX_TIMEOUT_MS = 7_200_000;
const AGENTS_BRIDGE_DEFAULT_TIMEOUT_MS = 7_200_000;
const AGENTS_BRIDGE_RESPONSE_SNIFF_MAX_BYTES = 1024;
const PUBLIC_AGENTS_LOCAL_ALLOWED_TOOLS = [
	"TodoWrite",
	"Skill",
	"ask_user",
	"task_create",
	"task_update",
	"task_get",
	"task_list",
	"task_claim",
	"Agent",
	"canvas_list_attempts",
	"canvas_read_node_media_for_context",
	"memory_save",
	"memory_search",
	"memory_forget",
] as const;

const PUBLIC_AGENTS_ROOT_DENIED_TOOLS = new Set([
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
]);

function isPublicAgentsRootDeniedTool(name: string): boolean {
	return PUBLIC_AGENTS_ROOT_DENIED_TOOLS.has(String(name || "").trim());
}

type AgentsBridgeChatResponse = {
	id?: string;
	text?: string;
	assets?: Array<{
		type?: string;
		url?: string;
		thumbnailUrl?: string;
	}>;
	trace?: {
		toolCalls?: Array<Record<string, unknown>>;
		output?: Record<string, unknown>;
		summary?: Record<string, unknown>;
		completion?: Record<string, unknown>;
		planning?: Record<string, unknown>;
		turns?: Array<Record<string, unknown>>;
		runtime?: Record<string, unknown>;
		todoList?: Record<string, unknown>;
		todoEvents?: Array<Record<string, unknown>>;
	};
};

type AgentsBridgeStreamToolCall = {
	toolCallId?: unknown;
	toolName?: unknown;
	phase?: unknown;
	status?: unknown;
	input?: unknown;
	outputPreview?: unknown;
	outputJson?: unknown;
	canvasMutation?: unknown;
	startedAt?: unknown;
	finishedAt?: unknown;
	durationMs?: unknown;
	errorMessage?: unknown;
	agentId?: unknown;
	agentType?: unknown;
	agentDepth?: unknown;
	parentToolCallId?: unknown;
};

type AgentsBridgeStreamMediaResult = {
	toolCallId?: unknown;
	toolName?: unknown;
	kind?: unknown;
	status?: unknown;
	pending?: unknown;
	nodeId?: unknown;
	taskId?: unknown;
	progress?: unknown;
	url?: unknown;
	thumbnailUrl?: unknown;
	errorMessage?: unknown;
	emittedAt?: unknown;
};

type AgentsBridgeCanvasMutationStreamHint = {
	wroteCanvas: true;
	flowId: string;
	createdNodeIds?: string[];
	updatedNodeIds?: string[];
	deletedNodeIds?: string[];
	deletedEdgeIds?: string[];
	assetUrls?: string[];
};

type AgentsBridgeStreamTodoListEvent = {
	threadId?: unknown;
	turnId?: unknown;
	sourceToolCallId?: unknown;
	items?: unknown;
	totalCount?: unknown;
	completedCount?: unknown;
	inProgressCount?: unknown;
	waitingCount?: unknown;
	blockedCount?: unknown;
	pendingCount?: unknown;
	agentId?: unknown;
	agentType?: unknown;
	agentDepth?: unknown;
	parentToolCallId?: unknown;
};

type AgentsBridgeStreamThinkingEvent = {
	threadId?: unknown;
	turnId?: unknown;
	turnIndex?: unknown;
	text?: unknown;
	toolNames?: unknown;
	toolCallCount?: unknown;
};

type AgentsBridgeStreamEvent =
	| { event: "content"; data: { delta?: string } }
	| { event: "thinking"; data: AgentsBridgeStreamThinkingEvent }
	| { event: "tool"; data: AgentsBridgeStreamToolCall }
	| { event: "media_result"; data: AgentsBridgeStreamMediaResult }
	| { event: "todo_list"; data: AgentsBridgeStreamTodoListEvent }
	| { event: "result"; data: { response: AgentsBridgeChatResponse } }
	| { event: "error"; data: { message?: string; code?: string; details?: unknown } }
	| { event: "done"; data: { reason?: string } }
	| {
			event:
				| "thread.started"
				| "turn.started"
				| "item.started"
				| "item.updated"
				| "item.completed"
				| "turn.completed";
			data: Record<string, unknown>;
	  };

type AgentsBridgeStreamObserver = (event: AgentsBridgeStreamEvent) => void | Promise<void>;

function readBridgeToolCallEffectsFromOutputJson(outputJson: unknown): Record<string, unknown> | null {
	const record = isRecord(outputJson) ? outputJson : null;
	if (!record) return null;
	const directEffects = isRecord(record.effects) ? record.effects : null;
	if (directEffects) return directEffects;
	const data = isRecord(record.data) ? record.data : null;
	return data && isRecord(data.effects) ? data.effects : null;
}

function buildCanvasMutationStreamHint(input: {
	toolCall: AgentsBridgeStreamToolCall;
	canvasFlowId?: string | null;
}): AgentsBridgeCanvasMutationStreamHint | null {
	const phase = readTrimmedString(input.toolCall.phase).toLowerCase();
	if (phase !== "completed") return null;
	const status = readTrimmedString(input.toolCall.status).toLowerCase();
	if (status !== "succeeded") return null;
	const flowId = readTrimmedString(input.canvasFlowId);
	if (!flowId) return null;
	const effects = readBridgeToolCallEffectsFromOutputJson(input.toolCall.outputJson);
	if (effects?.wroteCanvas !== true) return null;

	const createdNodeIds = readTrimmedStringArray(effects.createdNodeIds);
	const updatedNodeIds = readTrimmedStringArray(effects.updatedNodeIds);
	const deletedNodeIds = readTrimmedStringArray(effects.deletedNodeIds);
	const deletedEdgeIds = readTrimmedStringArray(effects.deletedEdgeIds);
	const assetUrls = readTrimmedStringArray(effects.createdAssetUrls);

	return {
		wroteCanvas: true,
		flowId,
		...(createdNodeIds.length ? { createdNodeIds } : {}),
		...(updatedNodeIds.length ? { updatedNodeIds } : {}),
		...(deletedNodeIds.length ? { deletedNodeIds } : {}),
		...(deletedEdgeIds.length ? { deletedEdgeIds } : {}),
		...(assetUrls.length ? { assetUrls } : {}),
	};
}

function normalizeAgentsBridgeStreamToolCall(
	payload: Record<string, unknown>,
	canvasFlowId?: string | null,
): AgentsBridgeStreamToolCall {
	const toolCall = payload as AgentsBridgeStreamToolCall;
	const canvasMutation = buildCanvasMutationStreamHint({ toolCall, canvasFlowId });
	const { canvasMutation: _upstreamCanvasMutation, ...cleanToolCall } = toolCall;
	return canvasMutation ? { ...cleanToolCall, canvasMutation } : cleanToolCall;
}

type AgentsBridgeAssetRole =
	| "target"
	| "reference"
	| "character"
	| "scene"
	| "prop"
	| "product"
	| "style"
	| "context"
	| "mask";

type AgentsBridgeAssetInput = {
	assetId?: string;
	assetRefId?: string;
	url: string;
	role: AgentsBridgeAssetRole;
	weight?: number;
	note?: string;
	name?: string;
};

type AgentsBridgeSelectedMediaReference = {
	nodeId?: string;
	kind: "image" | "video";
	url: string;
	thumbnailUrl?: string;
	label?: string;
};

type AgentsBridgeReferenceImageSlot = PublicChatReferenceImageSlot;

type AgentsBridgeChatContextSkill = {
	key: string | null;
	name: string | null;
	content?: string | null;
};

type AgentsBridgeChatContext = {
	currentProjectName: string | null;
	skill: AgentsBridgeChatContextSkill | null;
	selectedNodeLabel: string | null;
	selectedNodeKind: string | null;
	selectedNodeTextPreview: string | null;
	selectedReference: {
		nodeId: string | null;
		label: string | null;
		kind: string | null;
		anchorBindings?: PublicFlowAnchorBinding[];
		roleName?: string | null;
		roleCardId?: string | null;
		imageUrl: string | null;
		sourceUrl: string | null;
			productionLayer: string | null;
			creationStage: string | null;
			approvalStatus: string | null;
			hasUpstreamTextEvidence: boolean;
			hasDownstreamComposeVideo: boolean;
	} | null;
};

type AgentsBridgeRemoteToolDefinition = CanvasRemoteToolDefinition;

const EXECUTION_TRACE_TOOL_CALL_LIMIT = 48;
const EXECUTION_TRACE_ARRAY_LIMIT = 24;
const EXECUTION_TRACE_OBJECT_KEY_LIMIT = 24;
const EXECUTION_TRACE_STRING_LIMIT = 800;
const EXECUTION_TRACE_TEXT_PREVIEW_LIMIT = 2000;


type CanvasPlanDiagnostics = {
	tagPresent: boolean;
	normalized: false;
	parseSuccess: boolean;
	error: string;
	errorCode: string;
	errorDetail: string;
	schemaIssues: string[];
	detectedTagName: string;
	nodeCount: number;
	edgeCount: number;
	nodeKinds: string[];
	hasAssetUrls: boolean;
	action: string;
	summary: string;
	reason: string;
	rawPayload: string;
};

type BridgeToolEvidence = {
	toolNames: string[];
	readProjectState: boolean;
	readNodeContextBundle: boolean;
	readVideoReviewBundle: boolean;
	readMaterialAssets: boolean;
	generatedAssets: boolean;
	wroteCanvas: boolean;
};

type ToolStatusSummary = {
	totalToolCalls: number;
	succeededToolCalls: number;
	failedToolCalls: number;
	deniedToolCalls: number;
	blockedToolCalls: number;
	runMs: number | null;
};

type ToolExecutionIssueSummary = {
	failedToolCalls: number;
	deniedToolCalls: number;
	blockedToolCalls: number;
	coordinationBlockedToolCalls: number;
	actionableBlockedToolCalls: number;
	hasExecutionIssues: boolean;
};

type DiagnosticFlag = {
	code: string;
	severity: "high" | "medium";
	title: string;
	detail: string;
};

type VideoPromptGovernanceSummary = {
	active: boolean;
	sourceHints: string[];
	hasExecutablePrompt: boolean;
	usesDeprecatedVideoPromptField: boolean;
};

type ImagePromptSpecGovernanceSummary = {
	active: boolean;
	sourceHints: string[];
	visualPromptTargetCount: number;
	validSpecCount: number;
	missingSpecCount: number;
	invalidSpecCount: number;
	missingReferenceBindingsCount: number;
	missingIdentityConstraintsCount: number;
	missingEnvironmentObjectsCount: number;
	missingCharacterContinuityCount: number;
};

type VisualDeliverySummary = {
	imageLikeNodeCount: number;
	preproductionImageLikeNodeCount: number;
	reusablePreproductionImageLikeNodeCount: number;
	hasVideoNodes: boolean;
	hasMaterializedVisualOutputs: boolean;
};

type WebHeroDeliveryEvidence = {
	checked: boolean;
	updatedWebHeroNodeIds: string[];
	sectionCount: number;
	previewReferenceImageCount: number;
	referencedSectionIds: string[];
	missingReferencedSectionIds: string[];
	errorCode?: string;
};

type FlowPatchNodeFinalState = {
	id: string;
	kind: string;
	data: Record<string, unknown>;
};

type AgentsRuntimeTraceSummary = {
	profile: "general" | "code" | "unknown";
	registeredToolNames: string[];
	requiredSkills: string[];
	loadedSkills: string[];
	allowedSubagentTypes: string[];
	contextDiagnostics?: {
		totalChars: number;
		totalBudgetChars: number;
		sources: Array<{
			id: string;
			kind: string;
			summary: string;
			chars: number;
			budgetChars: number;
			truncated: boolean;
		}>;
	};
	capabilitySnapshot?: {
		providers: Array<{
			kind: string;
			name: string;
			toolNames: string[];
			toolCount: number;
		}>;
		exposedToolNames: string[];
	};
	policySummary?: {
		totalDecisions: number;
		allowCount: number;
		denyCount: number;
		requiresApprovalCount: number;
		uniqueDeniedSignatures: string[];
	};
};

type AgentsTodoListItemSummary = {
	text: string;
	completed: boolean;
	status: "pending" | "in_progress" | "waiting" | "blocked" | "completed";
};

type AgentsTodoListTraceSummary = {
	sourceToolCallId: string;
	items: AgentsTodoListItemSummary[];
	totalCount: number;
	completedCount: number;
	inProgressCount: number;
	waitingCount: number;
	blockedCount: number;
	pendingCount: number;
};

type AgentsTodoEventTraceSummary = AgentsTodoListTraceSummary & {
	atMs: number | null;
	startedAt: string | null;
	finishedAt: string | null;
	durationMs: number | null;
};

type AgentsPlanningTraceSummary = {
	source: "todo_list" | "unknown";
	planningRequired: boolean;
	minimumStepCount: number;
	hasChecklist: boolean;
	latestStepCount: number;
	maxObservedStepCount: number;
	completedCount: number;
	inProgressCount: number;
	waitingCount: number;
	blockedCount: number;
	pendingCount: number;
	meetsMinimumStepCount: boolean;
	checklistComplete: boolean;
};

type AgentsCompletionTraceSummary = {
	source: "deterministic" | "final_self_check" | "unknown";
	terminal: "success" | "explicit_failure" | "blocked" | "unknown";
	allowFinish: boolean;
	failureReason: string | null;
	rationale: string;
	successCriteria: string[];
	missingCriteria: string[];
	requiredActions: string[];
};

type AgentsSemanticTaskSummary = {
	taskGoal: string;
	requestedOutput: string;
	taskKind: string;
	recommendedNextStage: string;
	mustStop: boolean;
	blockingGaps: string[];
	successCriteria: string[];
	deliveryContract?: {
		kind: Exclude<PublicChatExpectedDeliveryKind, "none">;
		minStillCount?: number;
	} | null;
};

type AgentsSemanticExecutionIntentSummary = {
	detected: boolean;
	source: "task_interrogation_json" | "tool_trace_output_json" | "none";
	taskKind: string | null;
	mustStop: boolean;
	requiresExecutionDelivery: boolean;
	reason: string;
};

type BridgeToolCall = {
	toolCallId: string;
	name: string;
	status: "succeeded" | "failed" | "denied" | "blocked" | "";
	pathHint: string;
	errorMessage: string;
	outputPreview: string;
	outputChars: number | null;
	outputHead: string;
	outputTail: string;
	outputJson: Record<string, unknown> | null;
	inputJson: Record<string, unknown> | null;
	requestedAgentType: string;
};

type AgentsBridgeOutputMode = "plan_with_assets" | "plan_only" | "direct_assets" | "text_only";

type AgentsBridgeDecision = {
	executionKind: "plan" | "execute" | "generate" | "answer";
	canvasAction: "create_canvas_workflow" | "write_canvas" | "none";
	assetCount: number;
	projectStateRead: boolean;
	requiresConfirmation: boolean;
	reason: string;
};

type AgentsBridgeCanvasMutation = {
	deletedNodeIds: string[];
	deletedEdgeIds: string[];
	createdNodeIds: string[];
	patchedNodeIds: string[];
	executableNodeIds: string[];
};

type AgentsBridgeTurnVerdictStatus = "satisfied" | "partial" | "failed";

type AgentsBridgeTurnVerdict = {
	status: AgentsBridgeTurnVerdictStatus;
	reasons: string[];
};

export type AgentsBridgeAskUserPrompt = {
	toolCallId: string;
	question: string;
	options: string[];
	optionCards: AgentsBridgeAskUserOptionCard[];
	urgency: "info" | "confirmation" | "blocker";
	askedAt: string | null;
	awaitingReply: true;
};

type AgentsBridgeAskUserOptionCard = {
	value: string;
	imageUrl: string;
	thumbnailUrl?: string;
	title?: string;
	displayValue?: string;
};

type AgentsBridgeResponseMeta = {
	requestId?: string;
	sessionId?: string;
	outputMode: AgentsBridgeOutputMode;
	toolEvidence: BridgeToolEvidence;
	expectedDelivery?: PublicChatExpectedDeliverySummary;
	deliveryEvidence?: PublicChatDeliveryEvidence;
	deliveryVerification?: PublicChatDeliveryVerificationSummary;
	promptPipeline: PromptPipelineTraceSummary;
	toolStatusSummary: ToolStatusSummary;
	diagnosticFlags: DiagnosticFlag[];
	canvasPlan: CanvasPlanDiagnostics;
	canvasMutation?: AgentsBridgeCanvasMutation;
	agentDecision: AgentsBridgeDecision;
	completionTrace?: AgentsCompletionTraceSummary;
	semanticExecutionIntent?: AgentsSemanticExecutionIntentSummary;
	planningTrace?: AgentsPlanningTraceSummary;
	todoList?: AgentsTodoListTraceSummary;
	todoEvents?: AgentsTodoEventTraceSummary[];
	askUserPrompt?: AgentsBridgeAskUserPrompt;
	turnVerdict: AgentsBridgeTurnVerdict;
};

type PromptPipelineTarget =
	| "general_chat"
	| "text_evidence_context"
	| "visual_generation";

type PromptPipelinePrecheckSnapshot = {
	target: PromptPipelineTarget;
	roleMentionCount: number;
	matchedRoleCardCount: number;
	missingRoleCardCount: number;
	ambiguousRoleCardCount: number;
	autoReferenceImageCount: number;
	generationGateActive: boolean;
	directGenerationReady: boolean;
	generationGateReason: string;
};

type PromptPipelineStageStatus = "not_needed" | "pending" | "completed";

type PromptPipelineStageSummary = {
	status: PromptPipelineStageStatus;
	reason: string;
};

type PromptPipelineTraceSummary = {
	target: PromptPipelineTarget;
	precheck: PromptPipelineStageSummary;
	prerequisiteGeneration: PromptPipelineStageSummary;
	promptGeneration: PromptPipelineStageSummary;
	precheckSnapshot: PromptPipelinePrecheckSnapshot;
};

const HARD_FAILURE_DIAGNOSTIC_CODES = new Set<string>([
	"image_prompt_spec_v2_missing",
	"image_prompt_spec_v2_invalid",
	"image_prompt_spec_v2_reference_bindings_missing",
	"image_prompt_spec_v2_identity_constraints_missing",
	"image_prompt_spec_v2_environment_objects_missing",
	"image_prompt_spec_v2_character_continuity_missing",
]);

const IMAGE_PROMPT_CONTEXT_KINDS = new Set<string>([
	"image",
	"imageedit",
]);

const IMAGE_PROMPT_SPEC_NODE_KINDS = new Set<string>([
	"image",
	"imageedit",
]);

const TEAM_COORDINATION_BLOCKED_MESSAGE_HINTS = [
	"已有 team 子代理尚未结束",
	"等待子代理终态后才能继续",
	"请在下一轮重新发起",
];

function readTraceStringField(
	value: Record<string, unknown> | null | undefined,
	key: string,
): string {
	if (!value) return "";
	const raw = value[key];
	return typeof raw === "string" ? raw.trim() : "";
}

function readTraceNumberField(
	value: Record<string, unknown> | null | undefined,
	key: string,
): number | null {
	if (!value) return null;
	const raw = value[key];
	if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
	return raw;
}

function readTraceBooleanField(
	value: Record<string, unknown> | null | undefined,
	key: string,
): boolean | null {
	if (!value) return null;
	const raw = value[key];
	return typeof raw === "boolean" ? raw : null;
}

async function parseAgentsBridgeSseResponse(input: {
	response: Response;
	c: AppContext;
	canvasFlowId?: string | null;
	onEvent?: AgentsBridgeStreamObserver;
}): Promise<AgentsBridgeChatResponse | null> {
	if (!input.response.body) {
		throw new Error("agents_bridge_stream_missing_body");
	}

	const reader = input.response.body.getReader();
	const decoder = new TextDecoder();
	const parser = createSseEventParser();
	let finalResponse: AgentsBridgeChatResponse | null = null;

	const appendTodoTraceEvent = (toolCallRaw: AgentsBridgeStreamToolCall) => {
		const toolName =
			typeof toolCallRaw?.toolName === "string" ? toolCallRaw.toolName.trim() : "";
		const phase =
			typeof toolCallRaw?.phase === "string" ? toolCallRaw.phase.trim().toLowerCase() : "";
		if (toolName !== "TodoWrite" || phase !== "completed") return;
		const outputPreview =
			typeof toolCallRaw?.outputPreview === "string"
				? toolCallRaw.outputPreview.trim()
				: "";
		const todoText = outputPreview;
		if (!todoText) return;
		appendTraceEvent(input.c, "public:agent:todo_write", {
			toolName,
			text: todoText,
		});
	};

	const parseRecordPayload = (payloadText: string): Record<string, unknown> => {
		const payload = JSON.parse(payloadText) as unknown;
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			throw new Error("sse_payload_not_object");
		}
		return payload as Record<string, unknown>;
	};

	const parseNamedSseEvent = (rawEvent: SseEventMessage): AgentsBridgeStreamEvent => {
		const payloadText = rawEvent.data.trim();
		const payload = parseRecordPayload(payloadText);
		switch (rawEvent.event) {
			case "content":
				return { event: "content", data: payload };
			case "thinking":
				return { event: "thinking", data: payload as AgentsBridgeStreamThinkingEvent };
			case "tool":
				return {
					event: "tool",
					data: normalizeAgentsBridgeStreamToolCall(payload, input.canvasFlowId),
				};
			case "media_result":
				return { event: "media_result", data: payload as AgentsBridgeStreamMediaResult };
			case "todo_list":
				return { event: "todo_list", data: payload as AgentsBridgeStreamTodoListEvent };
			case "result": {
				const response =
					"response" in payload &&
					payload.response &&
					typeof payload.response === "object" &&
					!Array.isArray(payload.response)
						? (payload.response as AgentsBridgeChatResponse)
						: null;
				if (!response) {
					throw new Error("result_event_missing_response");
				}
				return { event: "result", data: { response } };
			}
			case "error":
				return { event: "error", data: payload };
			case "done":
				return { event: "done", data: payload };
			case "thread.started":
			case "turn.started":
			case "item.started":
			case "item.updated":
			case "item.completed":
			case "turn.completed":
				return { event: rawEvent.event, data: payload };
			default:
				throw new Error(`unexpected_sse_event:${rawEvent.event || "message"}`);
		}
	};

	const handleParsedEvent = async (event: AgentsBridgeStreamEvent): Promise<void> => {
		await input.onEvent?.(event);
		if (event.event === "tool") {
			appendTodoTraceEvent(event.data);
			return;
		}
		if (event.event === "result") {
			finalResponse = event.data.response;
			return;
		}
		if (event.event === "error") {
			const message =
				typeof event.data.message === "string" && event.data.message.trim()
					? event.data.message.trim()
					: "agents_bridge_stream_failed";
			const code =
				typeof event.data.code === "string" && event.data.code.trim()
					? event.data.code.trim()
					: "agents_bridge_stream_failed";
			appendTraceEvent(input.c, "public:agent:bridge_stream_error", {
				message,
				code,
				details: event.data.details,
			});
			console.warn(
				`[agents-bridge] stream error code=${code} message=${message} details=${truncateForDebugLog(
					event.data.details,
					1200,
				)}`,
			);
			throw new AppError(message, {
				status: 502,
				code,
				details: event.data.details,
			});
		}
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const events = parser.push(decoder.decode(value, { stream: true }));
			for (const rawEvent of events) {
				const payloadText = rawEvent.data.trim();
				if (!payloadText) continue;
				let event: AgentsBridgeStreamEvent;
				try {
					event = parseNamedSseEvent(rawEvent);
				} catch (error) {
					throw new AppError("Agents bridge 流事件解析失败", {
						status: 502,
						code: "agents_bridge_stream_invalid_event",
						details: {
							reason: error instanceof Error ? error.message : "unknown_parse_error",
							payloadPreview: payloadText.slice(0, 500),
						},
					});
				}
				await handleParsedEvent(event);
			}
		}
		for (const rawEvent of parser.finish()) {
			const payloadText = rawEvent.data.trim();
			if (!payloadText) continue;
			let event: AgentsBridgeStreamEvent;
			try {
				event = parseNamedSseEvent(rawEvent);
			} catch (error) {
				throw new AppError("Agents bridge 流事件解析失败", {
					status: 502,
					code: "agents_bridge_stream_invalid_event",
					details: {
						reason: error instanceof Error ? error.message : "unknown_parse_error",
						payloadPreview: payloadText.slice(0, 500),
					},
				});
			}
			await handleParsedEvent(event);
		}
		if (!finalResponse) {
			throw new AppError("Agents bridge stream ended before result event", {
				status: 502,
				code: "agents_bridge_stream_ended_before_result",
			});
		}
		return finalResponse;
	} finally {
		reader.releaseLock();
	}
}

async function parseAgentsBridgeJsonResponse(response: Response): Promise<AgentsBridgeChatResponse> {
	try {
		const payload = (await response.json()) as unknown;
		if (payload && typeof payload === "object" && !Array.isArray(payload)) {
			return payload as AgentsBridgeChatResponse;
		}
	} catch {
		throw new Error("agents_bridge_json_response_invalid");
	}
	throw new Error("agents_bridge_json_response_invalid");
}

function normalizeAgentsBridgePayloadPreviewStart(text: string): string {
	return text.replace(/^\uFEFF/, "").trimStart();
}

function looksLikeAgentsBridgeSsePayload(text: string): boolean {
	const start = normalizeAgentsBridgePayloadPreviewStart(text);
	return /^(?:event|data|id|retry)\s*:/i.test(start) || start.startsWith(":");
}

function shouldKeepSniffingAgentsBridgePayload(text: string): boolean {
	const start = normalizeAgentsBridgePayloadPreviewStart(text).toLowerCase();
	if (!start) return true;
	if (looksLikeAgentsBridgeSsePayload(start)) return false;
	return ["event:", "data:", "id:", "retry:", ":"].some((prefix) =>
		prefix.startsWith(start),
	);
}

function decodeAgentsBridgePreviewChunks(chunks: Uint8Array[]): string {
	const decoder = new TextDecoder();
	let text = "";
	for (const chunk of chunks) {
		text += decoder.decode(chunk, { stream: true });
	}
	text += decoder.decode();
	return text;
}

function createResponseWithBufferedBody(
	response: Response,
	chunks: Uint8Array[],
	reader: ReadableStreamDefaultReader<Uint8Array>,
	readerDone: boolean,
): Response {
	let chunkIndex = 0;
	let released = false;
	const releaseReader = () => {
		if (released) return;
		released = true;
		reader.releaseLock();
	};
	if (readerDone) {
		releaseReader();
	}

	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (chunkIndex < chunks.length) {
				controller.enqueue(chunks[chunkIndex++]!);
				return;
			}
			if (readerDone) {
				controller.close();
				return;
			}
			const next = await reader.read();
			if (next.done) {
				readerDone = true;
				releaseReader();
				controller.close();
				return;
			}
			controller.enqueue(next.value);
		},
		async cancel(reason) {
			if (readerDone) return;
			readerDone = true;
			try {
				await reader.cancel(reason);
			} finally {
				releaseReader();
			}
		},
	});

	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: new Headers(response.headers),
	});
}

async function sniffAgentsBridgeResponseForSse(
	response: Response,
): Promise<{ response: Response; isSse: boolean }> {
	if (!response.body) {
		return { response, isSse: false };
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	let readerDone = false;
	let preview = "";

	try {
		while (totalBytes < AGENTS_BRIDGE_RESPONSE_SNIFF_MAX_BYTES) {
			const next = await reader.read();
			if (next.done) {
				readerDone = true;
				break;
			}
			chunks.push(next.value);
			totalBytes += next.value.byteLength;
			preview = decodeAgentsBridgePreviewChunks(chunks);
			if (
				looksLikeAgentsBridgeSsePayload(preview) ||
				!shouldKeepSniffingAgentsBridgePayload(preview)
			) {
				break;
			}
		}
	} catch (error) {
		reader.releaseLock();
		throw error;
	}

	return {
		response: createResponseWithBufferedBody(response, chunks, reader, readerDone),
		isSse: looksLikeAgentsBridgeSsePayload(preview),
	};
}

async function parseAgentsBridgeProtocolResponse(input: {
	response: Response;
	c: AppContext;
	responseContentType: string;
	allowSseSniff: boolean;
	canvasFlowId?: string | null;
	onEvent?: AgentsBridgeStreamObserver;
}): Promise<AgentsBridgeChatResponse | null> {
	if (input.responseContentType.includes("text/event-stream")) {
		return await parseAgentsBridgeSseResponse({
			response: input.response,
			c: input.c,
			canvasFlowId: input.canvasFlowId,
			onEvent: input.onEvent,
		});
	}

	if (!input.allowSseSniff) {
		return await parseAgentsBridgeJsonResponse(input.response);
	}

	const sniffed = await sniffAgentsBridgeResponseForSse(input.response);
	if (sniffed.isSse) {
		return await parseAgentsBridgeSseResponse({
			response: sniffed.response,
			c: input.c,
			canvasFlowId: input.canvasFlowId,
			onEvent: input.onEvent,
		});
	}
	return await parseAgentsBridgeJsonResponse(sniffed.response);
}

function extractCanvasPlanPayload(text: string): string {
	const match = text.match(
		new RegExp(`<${CANVAS_PLAN_TAG_NAME}>([\\s\\S]*?)</${CANVAS_PLAN_TAG_NAME}>`, "i"),
	);
	return match ? String(match[1] || "").trim() : "";
}

function detectCanvasPlanTagName(text: string): string {
	const matches = Array.from(
		text.matchAll(/<\s*\/?\s*([a-z][a-z0-9_]*)\s*>/gi),
	);
	for (const match of matches) {
		const tagName = String(match[1] || "").trim();
		if (!tagName || tagName.toLowerCase() === CANVAS_PLAN_TAG_NAME.toLowerCase()) continue;
		if (tagName.toLowerCase().endsWith("canvas_plan")) {
			return tagName;
		}
	}
	return "";
}

function collectCanvasPlanNodeKinds(plan: ChatCanvasPlan): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const node of plan.nodes) {
		const kind = typeof node.kind === "string" ? node.kind.trim() : "";
		if (!kind || seen.has(kind)) continue;
		seen.add(kind);
		out.push(kind);
	}
	return out;
}

const GENERATED_ASSET_URL_KEYS = new Set([
	"url",
	"imageUrl",
	"videoUrl",
	"audioUrl",
	"thumbnailUrl",
	"assetUrl",
]);

const GENERATED_ASSET_RESULT_KEYS = new Set([
	"imageResults",
	"videoResults",
	"audioResults",
	"results",
	"assets",
	"outputs",
]);

function valueHasGeneratedAssetUrl(value: unknown, currentKey = ""): boolean {
	if (typeof value === "string") {
		return GENERATED_ASSET_URL_KEYS.has(currentKey) && /^https?:\/\//i.test(value.trim());
	}
	if (Array.isArray(value)) {
		return value.some((item) => valueHasGeneratedAssetUrl(item, currentKey));
	}
	if (!value || typeof value !== "object") return false;
	return Object.entries(value).some(([key, entryValue]) => {
		if (typeof entryValue === "string") {
			return GENERATED_ASSET_URL_KEYS.has(key) && /^https?:\/\//i.test(entryValue.trim());
		}
		if (GENERATED_ASSET_RESULT_KEYS.has(key)) {
			return valueHasGeneratedAssetUrl(entryValue, "url");
		}
		return valueHasGeneratedAssetUrl(entryValue, key);
	});
}

function nodeConfigHasGeneratedAssetUrl(node: ChatCanvasPlan["nodes"][number]): boolean {
	const config = node.config ?? {};
	if (valueHasGeneratedAssetUrl(config)) return true;
	if (!config || typeof config !== "object") return false;
	const record = config as Record<string, unknown>;
	const kind = typeof node.kind === "string" ? node.kind.trim() : "";
	const directUrlKey =
		kind === "composeVideo" || kind === "video"
			? "videoUrl"
			: kind === "audio"
				? "audioUrl"
				: "imageUrl";
	const directUrlRaw = typeof record[directUrlKey] === "string" ? record[directUrlKey].trim() : "";
	if (!/^https?:\/\//i.test(directUrlRaw)) return false;
	const sourceUrl = typeof record.sourceUrl === "string" ? record.sourceUrl.trim() : "";
	if (sourceUrl && sourceUrl === directUrlRaw) return false;
	const referenceImages = Array.isArray(record.referenceImages)
		? record.referenceImages
				.map((item) => (typeof item === "string" ? item.trim() : ""))
				.filter(Boolean)
		: [];
	if (referenceImages.includes(directUrlRaw)) return false;
	const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
	return status === "success";
}

function buildCanvasPlanDiagnostics(text: string): CanvasPlanDiagnostics {
	const rawPayload = extractCanvasPlanPayload(text);
	const detectedTagName = rawPayload ? CANVAS_PLAN_TAG_NAME : detectCanvasPlanTagName(text);
	if (!rawPayload) {
		const errorCode = detectedTagName ? "invalid_canvas_plan_tag_name" : "";
		const errorDetail = detectedTagName
			? `unexpected tag <${detectedTagName}>; expected <${CANVAS_PLAN_TAG_NAME}>`
			: "";
		return {
			tagPresent: false,
			normalized: false,
			parseSuccess: false,
			error: errorCode,
			errorCode,
			errorDetail,
			schemaIssues: [],
			detectedTagName,
			nodeCount: 0,
			edgeCount: 0,
			nodeKinds: [],
			hasAssetUrls: false,
			action: "",
			summary: "",
			reason: "",
			rawPayload: "",
		};
	}
	const parsedJsonResult = (() => {
		try {
			return { ok: true as const, value: JSON.parse(rawPayload) as unknown, errorDetail: "" };
		} catch (error) {
			return {
				ok: false as const,
				value: null,
				errorDetail: (error as Error).message || "unknown_json_parse_error",
			};
		}
	})();
	const parsedJson = parsedJsonResult.ok ? parsedJsonResult.value : null;
	const parsedPlan = canvasPlanSchema.safeParse(parsedJson);
	const plan = parsedPlan.success ? parsedPlan.data : null;
	const schemaIssues = parsedPlan.success
		? []
		: parsedPlan.error.issues.map((issue) => {
				const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "<root>";
				return `${pathLabel}: ${issue.message}`;
			});
	const nodeKinds = plan ? collectCanvasPlanNodeKinds(plan) : [];
	const hasAssetUrls = plan ? plan.nodes.some((node) => nodeConfigHasGeneratedAssetUrl(node)) : false;
	const errorCode = !rawPayload
		? ""
		: !parsedJsonResult.ok
			? "invalid_canvas_plan_json"
			: parsedPlan.success
				? ""
				: "invalid_canvas_plan_schema";
	const errorDetail = !rawPayload
		? ""
		: !parsedJsonResult.ok
			? parsedJsonResult.errorDetail
			: parsedPlan.success
				? ""
				: schemaIssues.join("; ");
	return {
		tagPresent: Boolean(rawPayload),
		normalized: false,
		parseSuccess: parsedPlan.success,
		error: errorCode,
		errorCode,
		errorDetail,
		schemaIssues,
		detectedTagName,
		nodeCount: plan ? plan.nodes.length : 0,
		edgeCount: plan && Array.isArray(plan.edges) ? plan.edges.length : 0,
		nodeKinds,
		hasAssetUrls,
		action: plan?.action ?? "",
		summary: plan?.summary ?? "",
		reason: plan?.reason ?? "",
		rawPayload,
	};
}

function summarizeBridgeToolEvidence(toolCalls: BridgeToolCall[]): BridgeToolEvidence {
	const names = toolCalls
		.map((call) => (typeof call.name === "string" ? call.name.trim() : ""))
		.filter(Boolean);
	const uniqueNames = Array.from(new Set(names));
	const hasSuccessfulTool = (name: string): boolean =>
		toolCalls.some((call) => call.name === name && call.status === "succeeded");
	const successfulEffects = toolCalls
		.filter((call) => call.status === "succeeded")
		.map(readBridgeToolCallEffects)
		.filter((effects): effects is Record<string, unknown> => Boolean(effects));
	const hasEffectArray = (key: string): boolean =>
		successfulEffects.some((effects) => Array.isArray(effects[key]) && (effects[key] as unknown[]).length > 0);
	const readProjectState =
		hasSuccessfulTool("canvas_project_flows_list") ||
		hasSuccessfulTool("canvas_canvas_workflow_analyze") ||
		hasSuccessfulTool("canvas_flow_get");
	const readNodeContextBundle = hasSuccessfulTool("canvas_node_context_bundle_get");
	const readVideoReviewBundle = hasSuccessfulTool("canvas_video_review_bundle_get");
	const readMaterialAssets =
		hasSuccessfulTool("canvas_material_assets_list") ||
		hasSuccessfulTool("canvas_material_asset_versions") ||
		hasSuccessfulTool("canvas_material_impacted_shots");
	const generatedAssets =
		hasEffectArray("createdAssetUrls") ||
		hasEffectArray("pendingTaskIds") ||
		hasSuccessfulTool("canvas_draw") ||
		hasSuccessfulTool("canvas_draw_batch") ||
		hasSuccessfulTool("canvas_video") ||
		hasSuccessfulTool("canvas_run_task") ||
		hasSuccessfulTool("canvas_task_result");
	const wroteCanvas = successfulEffects.some((effects) => effects.wroteCanvas === true);
	return {
		toolNames: uniqueNames,
		readProjectState,
		readNodeContextBundle,
		readVideoReviewBundle,
		readMaterialAssets,
		generatedAssets,
		wroteCanvas,
	};
}

function readBridgeToolCallEffects(toolCall: BridgeToolCall): Record<string, unknown> | null {
	return readBridgeToolCallEffectsFromOutputJson(toolCall.outputJson);
}

function hasSuccessfulRequestedAgentType(
	toolCalls: BridgeToolCall[],
	...agentTypes: string[]
): boolean {
	const expected = new Set(
		agentTypes.map((item) => String(item || "").trim()).filter(Boolean),
	);
	if (expected.size === 0) return false;
	return toolCalls.some((call) => {
		if (call.status !== "succeeded") return false;
		if (expected.has(call.requestedAgentType)) return true;
		const outputAgentType =
			typeof call.outputJson?.agentType === "string"
				? String(call.outputJson.agentType).trim()
				: "";
		return Boolean(outputAgentType) && expected.has(outputAgentType);
	});
}

function resolvePromptPipelineTarget(input: {
	selectedNodeKind: string | null;
	selectedReferenceKind: string | null;
	referenceImageCount: number;
}): PromptPipelineTarget {
	if (
		input.referenceImageCount > 0 ||
		isImagePromptContextKind(input.selectedNodeKind) ||
		isImagePromptContextKind(input.selectedReferenceKind) ||
		normalizeComparableKind(input.selectedReferenceKind) === "composevideo" ||
		normalizeComparableKind(input.selectedReferenceKind) === "video"
	) {
		return "visual_generation";
	}
	return "general_chat";
}

function buildPromptPipelinePrecheckSnapshot(input: {
	target: PromptPipelineTarget;
	mentionRoleInjection: {
		mentions: string[];
		matched: Array<{ roleNameKey: string }>;
		missing: string[];
		ambiguous: string[];
		referenceImages: string[];
	};
	generationGate: PublicAgentsGenerationGate;
	mergedReferenceImages: string[];
}): PromptPipelinePrecheckSnapshot {
	return {
		target: input.target,
		roleMentionCount: input.mentionRoleInjection.mentions.length,
		matchedRoleCardCount: input.mentionRoleInjection.matched.length,
		missingRoleCardCount: input.mentionRoleInjection.missing.length,
		ambiguousRoleCardCount: input.mentionRoleInjection.ambiguous.length,
		autoReferenceImageCount: input.mergedReferenceImages.length,
		generationGateActive: input.generationGate.active,
		directGenerationReady: input.generationGate.directGenerationReady,
		generationGateReason: input.generationGate.reason,
	};
}

function buildPromptPipelineTraceSummary(input: {
	target: PromptPipelineTarget;
	precheckSnapshot: PromptPipelinePrecheckSnapshot;
	toolEvidence: BridgeToolEvidence;
	toolCalls: BridgeToolCall[];
	text: string;
	assetCount: number;
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
}): PromptPipelineTraceSummary {
	const hasPrecheckEvidence =
		input.toolEvidence.readProjectState ||
		input.toolEvidence.readNodeContextBundle ||
		input.toolEvidence.readVideoReviewBundle ||
		input.toolEvidence.readMaterialAssets;
	const promptGenerationDelivered =
		Boolean(input.text.trim()) ||
		input.assetCount > 0 ||
		input.toolEvidence.wroteCanvas ||
		(input.canvasPlanDiagnostics.parseSuccess === true &&
			input.canvasPlanDiagnostics.nodeCount > 0) ||
		hasSuccessfulRequestedAgentType(
			input.toolCalls,
			"image_prompt_specialist",
			"video_prompt_specialist",
			"pacing_reviewer",
		);
	const prerequisiteNeeded =
		input.target === "visual_generation" &&
		(!input.precheckSnapshot.directGenerationReady ||
			input.precheckSnapshot.matchedRoleCardCount > 0);
	const prerequisiteCompleted =
		input.precheckSnapshot.directGenerationReady &&
		(input.precheckSnapshot.matchedRoleCardCount > 0 ||
			input.precheckSnapshot.autoReferenceImageCount > 0);
	return {
		target: input.target,
		precheck: {
			status:
				input.target === "general_chat"
					? "not_needed"
					: hasPrecheckEvidence
						? "completed"
						: "pending",
			reason:
				input.target === "general_chat"
					? "general_chat_without_project_precheck"
					: hasPrecheckEvidence
						? "project_evidence_read"
						: "no_runtime_evidence_read",
		},
		prerequisiteGeneration: {
			status: !prerequisiteNeeded
				? "not_needed"
				: prerequisiteCompleted
					? "completed"
					: "pending",
			reason: !prerequisiteNeeded
				? "no_prerequisite_assets_required"
				: prerequisiteCompleted
					? "preflight_assets_or_anchors_available"
					: input.precheckSnapshot.generationGateReason,
		},
		promptGeneration: {
			status: input.target === "general_chat"
				? "not_needed"
				: promptGenerationDelivered
					? "completed"
					: "pending",
			reason: input.target === "general_chat"
				? "general_chat_without_visual_prompt_pipeline"
				: promptGenerationDelivered
					? "prompt_or_canvas_result_delivered"
					: "no_prompt_generation_result",
		},
		precheckSnapshot: input.precheckSnapshot,
	};
}

function buildPromptPipelineRequestSummary(input: {
	target: PromptPipelineTarget;
	precheckSnapshot: PromptPipelinePrecheckSnapshot;
}): PromptPipelineTraceSummary {
	const prerequisiteNeeded =
		input.target === "visual_generation" &&
		(!input.precheckSnapshot.directGenerationReady ||
			input.precheckSnapshot.matchedRoleCardCount > 0);
	const prerequisiteCompleted =
		input.precheckSnapshot.directGenerationReady &&
		(input.precheckSnapshot.matchedRoleCardCount > 0 ||
			input.precheckSnapshot.autoReferenceImageCount > 0);
	return {
		target: input.target,
		precheck: {
			status: input.target === "general_chat" ? "not_needed" : "completed",
			reason:
				input.target === "general_chat"
					? "general_chat_without_project_precheck"
					: "bridge_context_collected",
		},
		prerequisiteGeneration: {
			status: !prerequisiteNeeded
				? "not_needed"
				: prerequisiteCompleted
					? "completed"
					: "pending",
			reason: !prerequisiteNeeded
				? "no_prerequisite_assets_required"
				: prerequisiteCompleted
					? "preflight_assets_or_anchors_available"
					: input.precheckSnapshot.generationGateReason,
		},
		promptGeneration: {
			status: input.target === "general_chat" ? "not_needed" : "pending",
			reason:
				input.target === "general_chat"
					? "general_chat_without_visual_prompt_pipeline"
					: "awaiting_agents_execution",
		},
		precheckSnapshot: input.precheckSnapshot,
	};
}

function normalizeBridgeToolCalls(toolCalls: Array<Record<string, unknown>>): BridgeToolCall[] {
	return toolCalls.map((call) => {
		const toolCallId = typeof call.toolCallId === "string" ? call.toolCallId.trim() : "";
		const name = typeof call.name === "string" ? call.name.trim() : "";
		const status = typeof call.status === "string" ? call.status.trim() : "";
		const pathHint = typeof call.pathHint === "string" ? call.pathHint.trim() : "";
		const errorMessage =
			typeof call.errorMessage === "string"
				? call.errorMessage.trim()
				: typeof call.outputPreview === "string"
					? call.outputPreview.trim()
					: "";
		const outputPreview = typeof call.outputPreview === "string" ? call.outputPreview.trim() : "";
		const outputChars =
			typeof call.outputChars === "number" && Number.isFinite(call.outputChars)
				? Math.max(0, Math.trunc(call.outputChars))
				: null;
		const outputHead = typeof call.outputHead === "string" ? call.outputHead.trim() : "";
		const outputTail = typeof call.outputTail === "string" ? call.outputTail.trim() : "";
		const outputJson =
			call.outputJson && typeof call.outputJson === "object" && !Array.isArray(call.outputJson)
				? (call.outputJson as Record<string, unknown>)
				: null;
		const inputJson =
			call.input && typeof call.input === "object" && !Array.isArray(call.input)
				? (call.input as Record<string, unknown>)
				: null;
		const requestedAgentType =
			typeof inputJson?.agent_type === "string"
				? String(inputJson.agent_type).trim()
				: "";
		return {
			toolCallId,
			name,
			status:
				status === "succeeded" || status === "failed" || status === "denied" || status === "blocked"
					? status
					: "",
			pathHint,
			errorMessage,
			outputPreview,
			outputChars,
			outputHead,
			outputTail,
			outputJson,
			inputJson,
			requestedAgentType,
		};
	});
}

function truncateExecutionTraceString(value: unknown, maxLength = EXECUTION_TRACE_STRING_LIMIT): string {
	const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
	if (!text) return "";
	return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…` : text;
}

function sanitizeExecutionTraceValue(value: unknown, depth = 0): unknown {
	if (typeof value === "string") {
		return truncateExecutionTraceString(value);
	}
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null ||
		typeof value === "undefined"
	) {
		return value ?? null;
	}
	if (depth >= 3) {
		if (Array.isArray(value)) {
			return `[array:${value.length}]`;
		}
		if (value && typeof value === "object") {
			return `[object:${Object.keys(value as Record<string, unknown>).length}]`;
		}
		return truncateExecutionTraceString(value);
	}
	if (Array.isArray(value)) {
		return value
			.slice(0, EXECUTION_TRACE_ARRAY_LIMIT)
			.map((item) => sanitizeExecutionTraceValue(item, depth + 1));
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entryValue] of Object.entries(value as Record<string, unknown>).slice(
			0,
			EXECUTION_TRACE_OBJECT_KEY_LIMIT,
		)) {
			out[key] = sanitizeExecutionTraceValue(entryValue, depth + 1);
		}
		return out;
	}
	return truncateExecutionTraceString(value);
}

function buildExecutionTraceToolCallSummary(toolCalls: BridgeToolCall[]): Array<Record<string, unknown>> {
	return toolCalls.slice(0, EXECUTION_TRACE_TOOL_CALL_LIMIT).map((toolCall) => ({
		toolCallId: toolCall.toolCallId,
		name: toolCall.name,
		status: toolCall.status,
		...(toolCall.pathHint ? { pathHint: truncateExecutionTraceString(toolCall.pathHint, 240) } : {}),
		...(toolCall.requestedAgentType
			? { requestedAgentType: truncateExecutionTraceString(toolCall.requestedAgentType, 120) }
			: {}),
		...(toolCall.errorMessage
			? { errorMessage: truncateExecutionTraceString(toolCall.errorMessage, 320) }
			: {}),
		...(toolCall.outputPreview
			? { outputPreview: truncateExecutionTraceString(toolCall.outputPreview, 320) }
			: {}),
		...(typeof toolCall.outputChars === "number" ? { outputChars: toolCall.outputChars } : {}),
		...(toolCall.outputHead ? { outputHead: truncateExecutionTraceString(toolCall.outputHead, 320) } : {}),
		...(toolCall.outputTail ? { outputTail: truncateExecutionTraceString(toolCall.outputTail, 320) } : {}),
		...(toolCall.inputJson ? { input: sanitizeExecutionTraceValue(toolCall.inputJson) } : {}),
		...(toolCall.outputJson ? { outputJson: sanitizeExecutionTraceValue(toolCall.outputJson) } : {}),
	}));
}

function readCanonicalBridgeToolOutputJson(toolCall: BridgeToolCall): Record<string, unknown> | null {
	if (toolCall.outputJson) return toolCall.outputJson;
	// outputPreview is a log surface only; completion / verdict authority must never
	// infer structured tool facts from preview text.
	return null;
}

function readBridgeAskUserOptions(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const text = typeof item === "string" ? item.trim() : "";
		if (!text || seen.has(text)) continue;
		seen.add(text);
		out.push(text);
		if (out.length >= 8) break;
	}
	return out;
}

function readBridgeAskUserOptionCards(value: unknown): AgentsBridgeAskUserOptionCard[] {
	if (!Array.isArray(value)) return [];
	const out: AgentsBridgeAskUserOptionCard[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		const optionValue = typeof record.value === "string" ? record.value.trim() : "";
		const imageUrl = typeof record.imageUrl === "string" ? record.imageUrl.trim() : "";
		if (!optionValue || !imageUrl || seen.has(optionValue)) continue;
		seen.add(optionValue);
		const thumbnailUrl = typeof record.thumbnailUrl === "string" ? record.thumbnailUrl.trim() : "";
		const title = typeof record.title === "string" ? record.title.trim() : "";
		const displayValue = typeof record.displayValue === "string" ? record.displayValue.trim() : "";
		out.push({
			value: optionValue,
			imageUrl,
			...(thumbnailUrl ? { thumbnailUrl } : {}),
			...(title ? { title } : {}),
			...(displayValue ? { displayValue } : {}),
		});
		if (out.length >= 8) break;
	}
	return out;
}

function readBridgeAskUserPrompt(toolCall: BridgeToolCall): AgentsBridgeAskUserPrompt | null {
	if (toolCall.name !== "ask_user" || toolCall.status !== "succeeded") return null;
	const outputJson = readCanonicalBridgeToolOutputJson(toolCall);
	if (!outputJson) return null;
	const status = typeof outputJson.status === "string" ? outputJson.status.trim() : "";
	if (status !== "awaiting_user_reply") return null;
	const toolCallId = typeof toolCall.toolCallId === "string" ? toolCall.toolCallId.trim() : "";
	const question = typeof outputJson.question === "string" ? outputJson.question.trim() : "";
	if (!toolCallId || !question) return null;
	const urgencyRaw = typeof outputJson.urgency === "string" ? outputJson.urgency.trim() : "";
	const urgency: AgentsBridgeAskUserPrompt["urgency"] =
		urgencyRaw === "info" || urgencyRaw === "confirmation" || urgencyRaw === "blocker"
			? urgencyRaw
			: "confirmation";
	const askedAt =
		typeof outputJson.askedAt === "string" && outputJson.askedAt.trim()
			? outputJson.askedAt.trim()
			: null;
	return {
		toolCallId,
		question,
		options: readBridgeAskUserOptions(outputJson.options),
		optionCards: readBridgeAskUserOptionCards(outputJson.optionCards),
		urgency,
		askedAt,
		awaitingReply: true,
	};
}

function findBridgeAskUserPrompt(toolCalls: BridgeToolCall[]): AgentsBridgeAskUserPrompt | null {
	for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
		const prompt = readBridgeAskUserPrompt(toolCalls[index]);
		if (prompt) return prompt;
	}
	return null;
}

function readBridgeAskUserPromptFromStreamEvent(
	event: AgentsBridgeStreamToolCall,
): AgentsBridgeAskUserPrompt | null {
	const toolName = typeof event.toolName === "string" ? event.toolName.trim() : "";
	if (toolName !== "ask_user") return null;
	const phase = typeof event.phase === "string" ? event.phase.trim() : "";
	if (phase !== "completed") return null;
	const status = typeof event.status === "string" ? event.status.trim() : "";
	if (status && status !== "succeeded") return null;
	const outputJson =
		event.outputJson && typeof event.outputJson === "object" && !Array.isArray(event.outputJson)
			? (event.outputJson as Record<string, unknown>)
			: null;
	if (!outputJson) return null;
	const outputStatus = typeof outputJson.status === "string" ? outputJson.status.trim() : "";
	if (outputStatus !== "awaiting_user_reply") return null;
	const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId.trim() : "";
	const question = typeof outputJson.question === "string" ? outputJson.question.trim() : "";
	if (!toolCallId || !question) return null;
	const urgencyRaw = typeof outputJson.urgency === "string" ? outputJson.urgency.trim() : "";
	const urgency: AgentsBridgeAskUserPrompt["urgency"] =
		urgencyRaw === "info" || urgencyRaw === "confirmation" || urgencyRaw === "blocker"
			? urgencyRaw
			: "confirmation";
	const askedAt =
		typeof outputJson.askedAt === "string" && outputJson.askedAt.trim()
			? outputJson.askedAt.trim()
			: null;
	return {
		toolCallId,
		question,
		options: readBridgeAskUserOptions(outputJson.options),
		optionCards: readBridgeAskUserOptionCards(outputJson.optionCards),
		urgency,
		askedAt,
		awaitingReply: true,
	};
}

function isTeamCoordinationBlockedToolCall(toolCall: BridgeToolCall): boolean {
	if (toolCall.status !== "blocked") return false;
	const diagnosticText = [toolCall.errorMessage, toolCall.outputPreview]
		.map((item) => item.trim())
		.filter(Boolean)
		.join("\n");
	if (!diagnosticText) return false;
	return TEAM_COORDINATION_BLOCKED_MESSAGE_HINTS.every((hint) => diagnosticText.includes(hint));
}

function isExecutionPlanningBlockedToolCall(toolCall: BridgeToolCall): boolean {
	if (toolCall.status !== "blocked") return false;
	const diagnosticText = [toolCall.errorMessage, toolCall.outputPreview]
		.map((item) => item.trim())
		.filter(Boolean)
		.join("\n");
	if (!diagnosticText) return false;
	return (
		diagnosticText.includes("Execution planning required before") ||
		diagnosticText.includes("当前回合要求 checklist-first")
	);
}

function summarizeBridgeToolExecutionIssues(input: {
	toolCalls: BridgeToolCall[];
	toolStatusSummary: ToolStatusSummary;
}): ToolExecutionIssueSummary {
	const failedToolCalls =
		typeof input.toolStatusSummary.failedToolCalls === "number" ? input.toolStatusSummary.failedToolCalls : 0;
	const deniedToolCalls =
		typeof input.toolStatusSummary.deniedToolCalls === "number" ? input.toolStatusSummary.deniedToolCalls : 0;
	const observedBlockedToolCalls = input.toolCalls.filter((toolCall) => toolCall.status === "blocked");
	const blockedToolCalls =
		typeof input.toolStatusSummary.blockedToolCalls === "number"
			? input.toolStatusSummary.blockedToolCalls
			: observedBlockedToolCalls.length;
	const coordinationBlockedToolCalls = observedBlockedToolCalls.filter(
		(toolCall) =>
			isTeamCoordinationBlockedToolCall(toolCall) ||
			isExecutionPlanningBlockedToolCall(toolCall),
	).length;
	const actionableBlockedToolCalls = Math.max(
		blockedToolCalls - coordinationBlockedToolCalls,
		observedBlockedToolCalls.length - coordinationBlockedToolCalls,
		0,
	);
	return {
		failedToolCalls,
		deniedToolCalls,
		blockedToolCalls,
		coordinationBlockedToolCalls,
		actionableBlockedToolCalls,
		hasExecutionIssues:
			failedToolCalls > 0 || deniedToolCalls > 0 || actionableBlockedToolCalls > 0,
	};
}

function isMediaToolCallName(name: string): boolean {
	return (
		name === "canvas_image_generate_to_canvas" ||
		name === "canvas_image_wait_for_result" ||
		name === "canvas_video_generate_to_canvas" ||
		name === "canvas_video_wait_for_result" ||
		name === "canvas_video_concat_to_canvas"
	);
}

function isMediaWaitToolCallName(name: string): boolean {
	return name === "canvas_image_wait_for_result" || name === "canvas_video_wait_for_result";
}

function readBridgeToolErrorCode(toolCall: BridgeToolCall): string {
	const outputJson = readCanonicalBridgeToolOutputJson(toolCall);
	const directCode = typeof outputJson?.code === "string" ? outputJson.code.trim() : "";
	if (directCode) return directCode;
	const error = isRecord(outputJson?.error) ? outputJson.error : null;
	const errorCode = typeof error?.code === "string" ? error.code.trim() : "";
	if (errorCode) return errorCode;
	const data = isRecord(outputJson?.data) ? outputJson.data : null;
	const dataCode = typeof data?.code === "string" ? data.code.trim() : "";
	return dataCode;
}

function hasMediaWaitTimeout(toolCalls: BridgeToolCall[]): boolean {
	return toolCalls.some((toolCall) => {
		if (toolCall.status !== "failed" && toolCall.status !== "blocked") return false;
		if (!isMediaWaitToolCallName(toolCall.name)) return false;
		const code = readBridgeToolErrorCode(toolCall);
		return code === "agents_tool_image_wait_timeout" || code === "agents_tool_video_wait_timeout";
	});
}

function hasBlockedMediaGeneration(toolCalls: BridgeToolCall[]): boolean {
	return toolCalls.some((toolCall) => {
		if (toolCall.status !== "failed" && toolCall.status !== "blocked") return false;
		if (!isMediaToolCallName(toolCall.name)) return false;
		if (isMediaWaitToolCallName(toolCall.name)) {
			const code = readBridgeToolErrorCode(toolCall);
			if (
				code === "agents_tool_image_wait_timeout" ||
				code === "agents_tool_video_wait_timeout"
			) {
				return false;
			}
		}
		return true;
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeAgentsRuntimeTraceSummary(value: unknown): AgentsRuntimeTraceSummary | null {
	if (!isRecord(value)) return null;
	const profileRaw = typeof value.profile === "string" ? value.profile.trim() : "";
	const profile =
		profileRaw === "general" || profileRaw === "code" ? profileRaw : "unknown";
	return {
		profile,
		registeredToolNames: readTrimmedStringArray(value.registeredToolNames).slice(0, 256),
		requiredSkills: readTrimmedStringArray(value.requiredSkills).slice(0, 32),
		loadedSkills: readTrimmedStringArray(value.loadedSkills).slice(0, 64),
		allowedSubagentTypes: readTrimmedStringArray(value.allowedSubagentTypes).slice(0, 16),
		...(isRecord(value.contextDiagnostics)
			? {
					contextDiagnostics: {
						totalChars:
							typeof value.contextDiagnostics.totalChars === "number"
								? value.contextDiagnostics.totalChars
								: 0,
						totalBudgetChars:
							typeof value.contextDiagnostics.totalBudgetChars === "number"
								? value.contextDiagnostics.totalBudgetChars
								: 0,
						sources: Array.isArray(value.contextDiagnostics.sources)
							? value.contextDiagnostics.sources
									.filter(isRecord)
									.map((item) => ({
										id: typeof item.id === "string" ? item.id : "",
										kind: typeof item.kind === "string" ? item.kind : "",
										summary: typeof item.summary === "string" ? item.summary : "",
										chars: typeof item.chars === "number" ? item.chars : 0,
										budgetChars: typeof item.budgetChars === "number" ? item.budgetChars : 0,
										truncated: item.truncated === true,
									}))
									.filter((item) => item.id && item.kind)
									.slice(0, 16)
							: [],
					},
			  }
			: {}),
		...(isRecord(value.capabilitySnapshot)
			? {
					capabilitySnapshot: {
						providers: Array.isArray(value.capabilitySnapshot.providers)
							? value.capabilitySnapshot.providers
									.filter(isRecord)
									.map((item) => ({
										kind: typeof item.kind === "string" ? item.kind : "",
										name: typeof item.name === "string" ? item.name : "",
										toolNames: readTrimmedStringArray(item.toolNames).slice(0, 128),
										toolCount: typeof item.toolCount === "number" ? item.toolCount : 0,
									}))
									.filter((item) => item.kind && item.name)
									.slice(0, 12)
							: [],
						exposedToolNames: readTrimmedStringArray(value.capabilitySnapshot.exposedToolNames).slice(0, 256),
					},
			  }
			: {}),
		...(isRecord(value.policySummary)
			? {
					policySummary: {
						totalDecisions:
							typeof value.policySummary.totalDecisions === "number"
								? value.policySummary.totalDecisions
								: 0,
						allowCount:
							typeof value.policySummary.allowCount === "number"
								? value.policySummary.allowCount
								: 0,
						denyCount:
							typeof value.policySummary.denyCount === "number"
								? value.policySummary.denyCount
								: 0,
						requiresApprovalCount:
							typeof value.policySummary.requiresApprovalCount === "number"
								? value.policySummary.requiresApprovalCount
								: 0,
						uniqueDeniedSignatures: readTrimmedStringArray(
							value.policySummary.uniqueDeniedSignatures,
						).slice(0, 32),
					},
			  }
			: {}),
	};
}

function normalizeAgentsTodoListTraceSummary(value: unknown): AgentsTodoListTraceSummary | null {
	if (!isRecord(value)) return null;
	const sourceToolCallId =
		typeof value.sourceToolCallId === "string" ? value.sourceToolCallId.trim() : "";
	const rawItems = Array.isArray(value.items) ? value.items : [];
	const items: AgentsTodoListItemSummary[] = [];
	for (const entry of rawItems) {
		if (!isRecord(entry)) continue;
		const text = typeof entry.text === "string" ? entry.text.trim() : "";
		if (!text) continue;
		const statusRaw = typeof entry.status === "string" ? entry.status.trim() : "";
		const status: AgentsTodoListItemSummary["status"] =
			statusRaw === "completed" ||
			statusRaw === "in_progress" ||
			statusRaw === "waiting" ||
			statusRaw === "blocked" ||
			statusRaw === "pending"
				? statusRaw
				: entry.completed === true
					? "completed"
					: "pending";
		items.push({
			text,
			completed: status === "completed",
			status,
		});
		if (items.length >= 20) break;
	}
	if (!sourceToolCallId || items.length <= 0) return null;
	const completedCount = items.filter((item) => item.status === "completed").length;
	const inProgressCount = items.filter((item) => item.status === "in_progress").length;
	const waitingCount = items.filter((item) => item.status === "waiting").length;
	const blockedCount = items.filter((item) => item.status === "blocked").length;
	const pendingCount = items.filter((item) => item.status === "pending").length;
	return {
		sourceToolCallId,
		items,
		totalCount: items.length,
		completedCount,
		inProgressCount,
		waitingCount,
		blockedCount,
		pendingCount,
	};
}

function normalizeAgentsTodoEventTraceSummaries(value: unknown): AgentsTodoEventTraceSummary[] {
	if (!Array.isArray(value)) return [];
	const out: AgentsTodoEventTraceSummary[] = [];
	for (const entry of value) {
		const todoList = normalizeAgentsTodoListTraceSummary(entry);
		if (!todoList) continue;
		const atMs = isRecord(entry) && typeof entry.atMs === "number" && Number.isFinite(entry.atMs)
			? Math.max(0, Math.trunc(entry.atMs))
			: null;
		const startedAt =
			isRecord(entry) && typeof entry.startedAt === "string" && entry.startedAt.trim()
				? entry.startedAt.trim()
				: null;
		const finishedAt =
			isRecord(entry) && typeof entry.finishedAt === "string" && entry.finishedAt.trim()
				? entry.finishedAt.trim()
				: null;
		const durationMs =
			isRecord(entry) && typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs)
				? Math.max(0, Math.trunc(entry.durationMs))
				: null;
		out.push({
			...todoList,
			atMs,
			startedAt,
			finishedAt,
			durationMs,
		});
		if (out.length >= 32) break;
	}
	return out;
}

function normalizeAgentsCompletionTraceSummary(value: unknown): AgentsCompletionTraceSummary | null {
	if (!isRecord(value)) return null;
	const sourceRaw = typeof value.source === "string" ? value.source.trim() : "";
	const terminalRaw = typeof value.terminal === "string" ? value.terminal.trim() : "";
	return {
		source:
			sourceRaw === "deterministic" || sourceRaw === "final_self_check"
				? sourceRaw
				: "unknown",
		terminal:
			terminalRaw === "success" ||
			terminalRaw === "explicit_failure" ||
			terminalRaw === "blocked"
				? terminalRaw
				: "unknown",
		allowFinish: value.allowFinish === true,
		failureReason:
			typeof value.failureReason === "string" && value.failureReason.trim()
				? value.failureReason.trim()
				: null,
		rationale: typeof value.rationale === "string" ? value.rationale.trim() : "",
		successCriteria: readTrimmedStringArray(value.successCriteria).slice(0, 16),
		missingCriteria: readTrimmedStringArray(value.missingCriteria).slice(0, 16),
		requiredActions: readTrimmedStringArray(value.requiredActions).slice(0, 16),
	};
}

function normalizeAgentsPlanningTraceSummary(value: unknown): AgentsPlanningTraceSummary | null {
	if (!isRecord(value)) return null;
	const sourceRaw = typeof value.source === "string" ? value.source.trim() : "";
	const readCount = (input: unknown, fallback = 0): number => {
		const num = typeof input === "number" ? input : Number(input);
		if (!Number.isFinite(num)) return fallback;
		return Math.max(0, Math.trunc(num));
	};
	return {
		source: sourceRaw === "todo_list" ? "todo_list" : "unknown",
		planningRequired: value.planningRequired === true,
		minimumStepCount: Math.max(2, readCount(value.minimumStepCount, 2)),
		hasChecklist: value.hasChecklist === true,
		latestStepCount: readCount(value.latestStepCount),
		maxObservedStepCount: readCount(value.maxObservedStepCount),
		completedCount: readCount(value.completedCount),
		inProgressCount: readCount(value.inProgressCount),
		waitingCount: readCount(value.waitingCount),
		blockedCount: readCount(value.blockedCount),
		pendingCount: readCount(value.pendingCount),
		meetsMinimumStepCount: value.meetsMinimumStepCount === true,
		checklistComplete: value.checklistComplete === true,
	};
}

function deriveAgentsPlanningTraceSummaryFromTodo(input: {
	todoList: AgentsTodoListTraceSummary | null;
	todoEvents: AgentsTodoEventTraceSummary[];
}): AgentsPlanningTraceSummary | null {
	const todoList = input.todoList;
	const maxObservedStepCount = input.todoEvents.reduce(
		(max, item) => Math.max(max, item.totalCount),
		0,
	);
	const latestStepCount = todoList?.totalCount ?? 0;
	const hasChecklist = latestStepCount > 0 || maxObservedStepCount > 0;
	if (!hasChecklist) return null;
	const completedCount = todoList?.completedCount ?? 0;
	const inProgressCount = todoList?.inProgressCount ?? 0;
	const waitingCount = todoList?.waitingCount ?? 0;
	const blockedCount = todoList?.blockedCount ?? 0;
	const pendingCount = todoList?.pendingCount ?? 0;
	return {
		source: "todo_list",
		planningRequired: false,
		minimumStepCount: 2,
		hasChecklist: true,
		latestStepCount,
		maxObservedStepCount,
		completedCount,
		inProgressCount,
		waitingCount,
		blockedCount,
		pendingCount,
		meetsMinimumStepCount: Math.max(latestStepCount, maxObservedStepCount) >= 2,
		checklistComplete:
			pendingCount <= 0 &&
			inProgressCount <= 0 &&
			waitingCount <= 0 &&
			blockedCount <= 0,
	};
}

function readTrimmedStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => String(item || "").trim())
		.filter(Boolean);
}

function tryParseStructuredJsonRecord(text: string): Record<string, unknown> | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (
		(!trimmed.startsWith("{") || !trimmed.endsWith("}")) &&
		(!trimmed.startsWith("[") || !trimmed.endsWith("]"))
	) {
		return null;
	}
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function normalizeAgentsSemanticTaskSummaryFromRecord(
	record: Record<string, unknown>,
): AgentsSemanticTaskSummary | null {
	const taskGoal = readTrimmedString(record.taskGoal);
	const requestedOutput = readTrimmedString(record.requestedOutput);
	const taskKind = readTrimmedString(record.taskKind);
	const recommendedNextStage = readTrimmedString(record.recommendedNextStage);
	const blockingGaps = readTrimmedStringArray(record.blockingGaps).slice(0, 16);
	const successCriteria = readTrimmedStringArray(record.successCriteria).slice(0, 32);
	const hasTaskInterrogationShape =
		Boolean(taskGoal) &&
		Boolean(requestedOutput) &&
		Boolean(taskKind) &&
		Boolean(recommendedNextStage) &&
		Array.isArray(record.blockingGaps) &&
		Array.isArray(record.successCriteria) &&
		"mustStop" in record;
	if (!hasTaskInterrogationShape) return null;
	const deliveryContractRaw = asRecord(record.deliveryContract);
		const deliveryContractKind = readTrimmedString(deliveryContractRaw?.kind);
		const normalizedDeliveryContractKind =
			deliveryContractKind === "generic_execution" ||
			deliveryContractKind === "single_baseframe_preproduction" ||
			deliveryContractKind === "video_followup"
				? (deliveryContractKind as Exclude<PublicChatExpectedDeliveryKind, "none">)
				: null;
	const deliveryContractMinStillCountRaw = Number(deliveryContractRaw?.minStillCount);
	const normalizedDeliveryContractMinStillCount =
		Number.isFinite(deliveryContractMinStillCountRaw) && deliveryContractMinStillCountRaw > 0
			? Math.max(1, Math.trunc(deliveryContractMinStillCountRaw))
			: null;
	return {
		taskGoal,
		requestedOutput,
		taskKind,
		recommendedNextStage,
		mustStop: record.mustStop === true,
		blockingGaps,
		successCriteria,
		...(normalizedDeliveryContractKind
			? {
					deliveryContract: {
						kind: normalizedDeliveryContractKind,
						...(normalizedDeliveryContractMinStillCount
							? { minStillCount: normalizedDeliveryContractMinStillCount }
							: {}),
					},
			  }
			: {}),
	};
}

function normalizeAgentsSemanticTaskSummaryFromText(text: string): AgentsSemanticTaskSummary | null {
	const parsed = tryParseStructuredJsonRecord(text);
	if (!parsed) return null;
	return normalizeAgentsSemanticTaskSummaryFromRecord(parsed);
}

function normalizeAgentsSemanticTaskSummaryFromToolCalls(
	toolCalls: BridgeToolCall[],
): AgentsSemanticTaskSummary | null {
	for (const toolCall of toolCalls) {
		if (toolCall.status !== "succeeded") continue;
		const parsed = readCanonicalBridgeToolOutputJson(toolCall);
		if (!parsed) continue;
		const direct = normalizeAgentsSemanticTaskSummaryFromRecord(parsed);
		if (direct) return direct;
		const nestedCandidates = [
			asRecord(parsed.result),
			asRecord(parsed.output),
			asRecord(parsed.summary),
			asRecord(parsed.semanticTask),
			asRecord(parsed.semantic_summary),
			asRecord(parsed.taskSummary),
			asRecord(parsed.task_summary),
		].filter((item): item is Record<string, unknown> => Boolean(item));
		for (const candidate of nestedCandidates) {
			const normalized = normalizeAgentsSemanticTaskSummaryFromRecord(candidate);
			if (normalized) return normalized;
		}
	}
	return null;
}

function buildAgentsSemanticExecutionIntentSummary(
	input: {
		taskSummary: AgentsSemanticTaskSummary | null;
		source: AgentsSemanticExecutionIntentSummary["source"];
	},
): AgentsSemanticExecutionIntentSummary {
	const { taskSummary, source } = input;
	if (!taskSummary) {
		return {
			detected: false,
			source: "none",
			taskKind: null,
			mustStop: false,
			requiresExecutionDelivery: false,
			reason: "no_structured_semantic_task_summary",
		};
	}
	const requiresExecutionDelivery =
		taskSummary.mustStop !== true &&
		taskSummary.blockingGaps.length === 0 &&
		Boolean(taskSummary.recommendedNextStage);
	return {
		detected: true,
		source,
		taskKind: taskSummary.taskKind,
		mustStop: taskSummary.mustStop,
		requiresExecutionDelivery,
		reason: requiresExecutionDelivery
			? "agents_marked_next_stage_as_executable_delivery"
			: "agents_marked_task_as_stop_or_blocked",
	};
}

function parsePromptPayloadFieldValue(raw: string): unknown {
	const trimmed = raw.trim();
	if (!trimmed) return "";
	if (
		(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
		(trimmed.startsWith("[") && trimmed.endsWith("]"))
	) {
		try {
			return JSON.parse(trimmed) as unknown;
		} catch {
			return trimmed;
		}
	}
	return trimmed;
}

function extractStructuredPromptPayloadFromText(text: string): Record<string, unknown> | null {
	const parsedJson = tryParseStructuredJsonRecord(text);
	if (parsedJson) return parsedJson;
	const fieldNames = [
		"imagePrompt",
		"structuredPrompt",
		"imagePromptSpecV2",
		"prompt",
		"storyBeatPlan",
		"videoPrompt",
	];
	const record: Record<string, unknown> = {};
	const normalizedText = text.replace(/\r/g, "");
	const labelPattern = new RegExp(`^\\s*(${fieldNames.join("|")}):\\s*(.*)$`);
	let activeKey: string | null = null;
	let activeLines: string[] = [];

	const flushActiveField = () => {
		if (!activeKey) return;
		record[activeKey] = parsePromptPayloadFieldValue(activeLines.join("\n"));
		activeKey = null;
		activeLines = [];
	};

	for (const line of normalizedText.split("\n")) {
		const match = line.match(labelPattern);
		if (match) {
			flushActiveField();
			activeKey = String(match[1] || "").trim() || null;
			const initialValue = String(match[2] || "");
			activeLines = initialValue ? [initialValue] : [];
			continue;
		}
		if (activeKey) activeLines.push(line);
	}
	flushActiveField();
	return Object.keys(record).length > 0 ? record : null;
}

function hasVideoPromptGovernanceShape(record: Record<string, unknown>): boolean {
	return (
		(typeof record.prompt === "string" && record.prompt.trim().length > 0) ||
		(typeof record.videoPrompt === "string" && record.videoPrompt.trim().length > 0) ||
		Array.isArray(record.storyBeatPlan)
	);
}

function isPlaceholderVideoPromptRecord(record: Record<string, unknown>): boolean {
	const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
	return status === "error";
}

function applyVideoPromptGovernanceRecord(
	summary: VideoPromptGovernanceSummary,
	record: Record<string, unknown>,
	sourceHint: string,
): void {
	if (isPlaceholderVideoPromptRecord(record)) return;
	if (!summary.sourceHints.includes(sourceHint)) summary.sourceHints.push(sourceHint);
	const hasExecutablePrompt =
		typeof record.prompt === "string" && record.prompt.trim().length > 0;
	const usesDeprecatedVideoPromptField =
		typeof record.videoPrompt === "string" && record.videoPrompt.trim().length > 0;
	summary.active = true;
	summary.hasExecutablePrompt = summary.hasExecutablePrompt || hasExecutablePrompt;
	summary.usesDeprecatedVideoPromptField =
		summary.usesDeprecatedVideoPromptField || usesDeprecatedVideoPromptField;
}

function buildVideoPromptGovernanceSummary(input: {
	text: string;
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
}): VideoPromptGovernanceSummary {
	const summary: VideoPromptGovernanceSummary = {
		active: false,
		sourceHints: [],
		hasExecutablePrompt: false,
		usesDeprecatedVideoPromptField: false,
	};
	const textPayload = extractStructuredPromptPayloadFromText(input.text);
	if (textPayload && hasVideoPromptGovernanceShape(textPayload)) {
		applyVideoPromptGovernanceRecord(summary, textPayload, "final_text_payload");
	}
	if (input.canvasPlanDiagnostics.parseSuccess && input.canvasPlanDiagnostics.rawPayload) {
		try {
			const parsed = JSON.parse(input.canvasPlanDiagnostics.rawPayload) as unknown;
			if (isRecord(parsed) && Array.isArray(parsed.nodes)) {
				for (const node of parsed.nodes) {
					if (!isRecord(node)) continue;
					const kind = typeof node.kind === "string" ? node.kind.trim() : "";
					if (kind !== "composeVideo" && kind !== "video") continue;
					const config = isRecord(node.config) ? node.config : null;
					if (!config) continue;
					applyVideoPromptGovernanceRecord(summary, config, "canvas_plan_video_node");
				}
			}
		} catch {
			// canvas plan parse errors are already captured elsewhere
		}
	}
	return summary;
}

function normalizeComparableKind(value: unknown): string {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function sanitizeSelectedReferenceKindForAgents(value: string | null | undefined): string | null {
	const normalized = normalizeComparableKind(value);
	if (!normalized) return null;
	return normalized;
}

function sanitizeSelectedReferenceForAgents(
	selectedReference: PublicChatPromptContext["selectedReference"],
): PublicChatPromptContext["selectedReference"] {
	if (!selectedReference) return null;
	return {
		...selectedReference,
		kind: sanitizeSelectedReferenceKindForAgents(selectedReference.kind),
	};
}

function isImagePromptContextKind(value: unknown): boolean {
	return IMAGE_PROMPT_CONTEXT_KINDS.has(normalizeComparableKind(value));
}

function isImagePromptSpecNodeKind(kind: string): boolean {
	return IMAGE_PROMPT_SPEC_NODE_KINDS.has(kind);
}

function isVisualDeliveryNodeKind(kind: string): boolean {
	return (
		kind === "image" ||
		kind === "imageedit" ||
		kind === "composevideo" ||
		kind === "video"
	);
}

function isVideoLikeNodeKind(kind: string): boolean {
	return kind === "video" || kind === "composevideo";
}

function hasVideoOnlyPayloadSignals(record: Record<string, unknown>): boolean {
	return (
		Array.isArray(record.storyBeatPlan) ||
		(typeof record.videoPrompt === "string" && record.videoPrompt.trim().length > 0)
	);
}

function isLikelyImagePromptTextPayload(input: {
	record: Record<string, unknown>;
	likelyImageContext: boolean;
}): boolean {
	if (
		typeof input.record.imagePrompt === "string" &&
		input.record.imagePrompt.trim().length > 0
	) {
		return true;
	}
	if (Object.prototype.hasOwnProperty.call(input.record, "structuredPrompt")) {
		return true;
	}
	if (Object.prototype.hasOwnProperty.call(input.record, "imagePromptSpecV2")) {
		return true;
	}
	if (!input.likelyImageContext) return false;
	if (hasVideoOnlyPayloadSignals(input.record)) return false;
	return typeof input.record.prompt === "string" && input.record.prompt.trim().length > 0;
}

function readValidImagePromptSpecV2(
	value: unknown,
): { ok: true; value: ImagePromptSpecV2 | null } | { ok: false; error: string } {
	const parsed = parseImagePromptSpecV2(value);
	if (!parsed.ok) return parsed;
	return parsed;
}

function readStructuredPromptField(record: Record<string, unknown>): unknown {
	if (Object.prototype.hasOwnProperty.call(record, "structuredPrompt")) {
		return record.structuredPrompt;
	}
	if (Object.prototype.hasOwnProperty.call(record, "imagePromptSpecV2")) {
		return record.imagePromptSpecV2;
	}
	return undefined;
}

function readFlowPatchNodeFinalStateId(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function mergeFlowPatchNodeFinalStateData(
	existing: Record<string, unknown> | null,
	patch: Record<string, unknown>,
	kind: string,
): Record<string, unknown> {
	const next: Record<string, unknown> = {
		...(existing ?? {}),
		...patch,
	};
	if (kind && typeof next.kind !== "string") next.kind = kind;
	return next;
}

function buildFlowPatchNodeFinalStates(input: {
	toolCalls: BridgeToolCall[];
	selectedNodeKind: string | null;
}): Map<string, FlowPatchNodeFinalState> {
	const states = new Map<string, FlowPatchNodeFinalState>();
	const selectedNodeKind = normalizeComparableKind(input.selectedNodeKind);
	for (const toolCall of input.toolCalls) {
		if (toolCall.name !== "canvas_flow_patch" || toolCall.status !== "succeeded" || !toolCall.inputJson) {
			continue;
		}
		const createNodes = Array.isArray(toolCall.inputJson.createNodes)
			? toolCall.inputJson.createNodes
			: [];
		createNodes.forEach((node, index) => {
			if (!isRecord(node)) return;
			const data = isRecord(node.data) ? node.data : null;
			if (!data) return;
			const nodeId = readFlowPatchNodeFinalStateId(
				node.id,
				`${toolCall.toolCallId}:create:${index}`,
			);
			const previous = states.get(nodeId);
			const explicitKind = normalizeComparableKind(data.kind);
			const kind = explicitKind || previous?.kind || "";
			states.set(nodeId, {
				id: nodeId,
				kind,
				data: mergeFlowPatchNodeFinalStateData(previous?.data ?? null, data, kind),
			});
		});
		const patchNodeData = Array.isArray(toolCall.inputJson.patchNodeData)
			? toolCall.inputJson.patchNodeData
			: [];
		patchNodeData.forEach((patch, index) => {
			if (!isRecord(patch)) return;
			const data = isRecord(patch.data) ? patch.data : null;
			if (!data) return;
			const nodeId = readFlowPatchNodeFinalStateId(
				patch.id,
				`${toolCall.toolCallId}:patch:${index}`,
			);
			const previous = states.get(nodeId);
			const explicitKind = normalizeComparableKind(data.kind);
			const kind = explicitKind || previous?.kind || selectedNodeKind;
			states.set(nodeId, {
				id: nodeId,
				kind,
				data: mergeFlowPatchNodeFinalStateData(previous?.data ?? null, data, kind),
			});
		});
	}
	return states;
}

type ImagePromptSpecAnchorSummary = {
	hasReferenceAnchors: boolean;
	hasCharacterAnchors: boolean;
	hasEnvironmentAnchors: boolean;
	characterStateEvidenceCount: number;
};

function summarizeImagePromptSpecAnchors(assetInputs: AgentsBridgeAssetInput[]): ImagePromptSpecAnchorSummary {
	let hasCharacterAnchors = false;
	let hasEnvironmentAnchors = false;
	let characterStateEvidenceCount = 0;
	for (const item of assetInputs) {
		if (item.role === "character") {
			hasCharacterAnchors = true;
			const parsed = parseCharacterContinuityNote(String(item.note || ""));
			if (parsed.age || parsed.state || parsed.stateLabel || parsed.stateKey) {
				characterStateEvidenceCount += 1;
			}
			continue;
		}
		hasEnvironmentAnchors = true;
	}
	return {
		hasReferenceAnchors: assetInputs.length > 0,
		hasCharacterAnchors,
		hasEnvironmentAnchors,
		characterStateEvidenceCount,
	};
}

function readRecordAssetInputs(record: Record<string, unknown>): AgentsBridgeAssetInput[] {
	if (!Array.isArray(record.assetInputs)) return [];
	return normalizeAgentsBridgeAssetInputs(record.assetInputs);
}

function resolveImagePromptSpecAnchorSummary(input: {
	record: Record<string, unknown>;
	sourceHint: string;
	requestAnchorSummary: ImagePromptSpecAnchorSummary;
}): ImagePromptSpecAnchorSummary {
	const localAssetInputs = readRecordAssetInputs(input.record);
	const hasReferenceImages =
		Array.isArray(input.record.referenceImages) &&
		input.record.referenceImages.some((item) => typeof item === "string" && item.trim().length > 0);
	if (localAssetInputs.length === 0 && !hasReferenceImages) {
		return input.sourceHint === "final_text_payload"
			? input.requestAnchorSummary
			: {
				hasReferenceAnchors: false,
				hasCharacterAnchors: false,
				hasEnvironmentAnchors: false,
				characterStateEvidenceCount: 0,
			};
	}
	const localSummary = summarizeImagePromptSpecAnchors(localAssetInputs);
	return {
		hasReferenceAnchors: localSummary.hasReferenceAnchors || hasReferenceImages,
		hasCharacterAnchors: localSummary.hasCharacterAnchors,
		hasEnvironmentAnchors: localSummary.hasEnvironmentAnchors,
		characterStateEvidenceCount: localSummary.characterStateEvidenceCount,
	};
}

function applyImagePromptSpecGovernanceRecord(
	summary: ImagePromptSpecGovernanceSummary,
	record: Record<string, unknown>,
	sourceHint: string,
	requestAnchorSummary: ImagePromptSpecAnchorSummary,
): void {
	summary.active = true;
	summary.visualPromptTargetCount += 1;
	if (!summary.sourceHints.includes(sourceHint)) summary.sourceHints.push(sourceHint);
	const structuredPrompt = readStructuredPromptField(record);
	if (typeof structuredPrompt === "undefined") {
		summary.missingSpecCount += 1;
		return;
	}
	const parsed = readValidImagePromptSpecV2(structuredPrompt);
	if (!parsed.ok || !parsed.value) {
		summary.invalidSpecCount += 1;
		return;
	}
	summary.validSpecCount += 1;
	const anchorSummary = resolveImagePromptSpecAnchorSummary({
		record,
		sourceHint,
		requestAnchorSummary,
	});
		if (anchorSummary.hasReferenceAnchors && (parsed.value.referenceBindings ?? []).length <= 0) {
			summary.missingReferenceBindingsCount += 1;
		}
		if (anchorSummary.hasCharacterAnchors && (parsed.value.identityConstraints ?? []).length <= 0) {
			summary.missingIdentityConstraintsCount += 1;
		}
	if (anchorSummary.hasEnvironmentAnchors && parsed.value.environmentObjects.length <= 0) {
		summary.missingEnvironmentObjectsCount += 1;
	}
	if (
		anchorSummary.characterStateEvidenceCount > 0 &&
		parsed.value.continuityConstraints.length <= 0
	) {
		summary.missingCharacterContinuityCount += 1;
	}
}

function recordHasMaterializedVisualOutput(record: Record<string, unknown>): boolean {
	const imageUrl = typeof record.imageUrl === "string" ? record.imageUrl.trim() : "";
	if (imageUrl) return true;
	const videoUrl = typeof record.videoUrl === "string" ? record.videoUrl.trim() : "";
	if (videoUrl) return true;
	if (Array.isArray(record.videoResults) && record.videoResults.length > 0) return true;
	return false;
}

function applyVisualDeliveryRecord(
	summary: VisualDeliverySummary,
	record: Record<string, unknown>,
	kind: string,
): void {
	if (!isVideoLikeNodeKind(kind)) {
		summary.imageLikeNodeCount += 1;
		const productionLayer = normalizeComparableKind(record.productionLayer);
		if (productionLayer === "preproduction") {
			summary.preproductionImageLikeNodeCount += 1;
		}
		if (isReusablePreproductionImageLikeNode(record, kind)) {
			summary.reusablePreproductionImageLikeNodeCount += 1;
		}
	}
	if (isVideoLikeNodeKind(kind)) summary.hasVideoNodes = true;
	if (recordHasMaterializedVisualOutput(record)) {
		summary.hasMaterializedVisualOutputs = true;
	}
}

function isReusablePreproductionImageLikeNode(
	record: Record<string, unknown>,
	kind: string,
): boolean {
	if (isVideoLikeNodeKind(kind)) return false;
	const productionLayer = normalizeComparableKind(record.productionLayer);
	const creationStage = normalizeComparableKind(record.creationStage);
	return (
		productionLayer === "preproduction" ||
		productionLayer === "anchors" ||
		creationStage === "single_variable_expansion"
	);
}

function buildVisualDeliverySummary(input: {
	toolCalls: BridgeToolCall[];
	selectedNodeKind: string | null;
}): VisualDeliverySummary {
	const summary: VisualDeliverySummary = {
		imageLikeNodeCount: 0,
		preproductionImageLikeNodeCount: 0,
		reusablePreproductionImageLikeNodeCount: 0,
		hasVideoNodes: false,
		hasMaterializedVisualOutputs: false,
	};
	const nodeStates = buildFlowPatchNodeFinalStates({
		toolCalls: input.toolCalls,
		selectedNodeKind: input.selectedNodeKind,
	});
	for (const state of nodeStates.values()) {
		if (!state.kind || !isVisualDeliveryNodeKind(state.kind)) continue;
		applyVisualDeliveryRecord(summary, state.data, state.kind);
	}
	return summary;
}

type DirectMediaDeliveryEvidence = {
	directImageOutputCount: number;
	directVideoOutputCount: number;
	pendingDirectImageTaskCount: number;
	pendingDirectVideoTaskCount: number;
};

type CanvasFlowPersistenceSummary = {
	nodeIds: Set<string>;
	assetUrls: Set<string>;
	visualNodeCount: number;
	imageNodeCount: number;
	videoNodeCount: number;
	materializedOutputCount: number;
};

type WebHeroToolUpdateCandidate = {
	nodeId: string;
	data: Record<string, unknown>;
};

type DeclaredCanvasWriteTargets = {
	nodeIds: string[];
	assetUrls: string[];
};

function toolCallOutputJsonForDelivery(toolCall: BridgeToolCall): Record<string, unknown> | null {
	const outputJson = isRecord(toolCall.outputJson) ? toolCall.outputJson : null;
	if (!outputJson) return null;
	const nestedData = isRecord(outputJson.data) ? outputJson.data : null;
	const hasDirectSignal = (record: Record<string, unknown>): boolean =>
		Object.prototype.hasOwnProperty.call(record, "pending") ||
		Object.prototype.hasOwnProperty.call(record, "status") ||
		Object.prototype.hasOwnProperty.call(record, "nodeId") ||
		Object.prototype.hasOwnProperty.call(record, "taskId") ||
		Object.prototype.hasOwnProperty.call(record, "imageTaskId") ||
		Object.prototype.hasOwnProperty.call(record, "videoTaskId") ||
		Object.prototype.hasOwnProperty.call(record, "imageUrl") ||
		Object.prototype.hasOwnProperty.call(record, "videoUrl") ||
		Object.prototype.hasOwnProperty.call(record, "imageResults") ||
		Object.prototype.hasOwnProperty.call(record, "videoResults");
	if (hasDirectSignal(outputJson)) return outputJson;
	return nestedData && hasDirectSignal(nestedData) ? nestedData : outputJson;
}

function appendUniqueTrimmedString(
	list: string[],
	seen: Set<string>,
	value: unknown,
): void {
	const item = typeof value === "string" ? value.trim() : "";
	if (!item || seen.has(item)) return;
	seen.add(item);
	list.push(item);
}

function appendUniqueHttpUrl(list: string[], seen: Set<string>, value: unknown): void {
	const url = typeof value === "string" ? value.trim() : "";
	if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
	seen.add(url);
	list.push(url);
}

function appendStringArrayValues(
	value: unknown,
	append: (item: unknown) => void,
): void {
	if (!Array.isArray(value)) return;
	for (const item of value) append(item);
}

function collectResultUrlsFromRecord(
	record: Record<string, unknown>,
	resultKey: string,
	appendUrl: (value: unknown) => void,
): void {
	const results = Array.isArray(record[resultKey]) ? record[resultKey] : [];
	for (const item of results) {
		if (!isRecord(item)) continue;
		appendUrl(item.url);
	}
}

function collectMediaUrlsFromRecord(
	record: Record<string, unknown>,
	appendUrl: (value: unknown) => void,
): void {
	appendUrl(record.imageUrl);
	appendUrl(record.videoUrl);
	collectResultUrlsFromRecord(record, "imageResults", appendUrl);
	collectResultUrlsFromRecord(record, "videoResults", appendUrl);
	const cellGroups = [
		record.imageCells,
		record.storyboardEditorCells,
		record.storyboardCells,
	];
	for (const group of cellGroups) {
		if (!Array.isArray(group)) continue;
		for (const item of group) {
			if (!isRecord(item)) continue;
			appendUrl(item.imageUrl);
			appendUrl(item.videoUrl);
		}
	}
}

function recordHasWebHeroCode(record: Record<string, unknown>): boolean {
	return (
		readTrimmedString(record.webHeroHtml).length > 0 ||
		readTrimmedString(record.webHeroCss).length > 0 ||
		readTrimmedString(record.webHeroDocumentHtml).length > 0
	);
}

function collectWebHeroUpdateCandidates(toolCalls: BridgeToolCall[]): WebHeroToolUpdateCandidate[] {
	const candidates: WebHeroToolUpdateCandidate[] = [];
	const seen = new Set<string>();
	for (const toolCall of toolCalls) {
		if (toolCall.status !== "succeeded") continue;
		if (toolCall.name !== "canvas_update_node_data" && toolCall.name !== "canvas_flow_patch") continue;
		const patchNodeData = Array.isArray(toolCall.inputJson?.patchNodeData)
			? toolCall.inputJson.patchNodeData
			: [];
		for (const item of patchNodeData) {
			if (!isRecord(item)) continue;
			const nodeId = readTrimmedString(item.id);
			const data = isRecord(item.data) ? item.data : null;
			if (!nodeId || !data || !recordHasWebHeroCode(data)) continue;
			if (seen.has(nodeId)) continue;
			seen.add(nodeId);
			candidates.push({ nodeId, data });
		}
	}
	return candidates;
}

function countHtmlSections(html: string): number {
	const matches = html.match(/<section(?:\s|>)/gi);
	return matches ? matches.length : 0;
}

function collectDomIds(html: string): Set<string> {
	const ids = new Set<string>();
	const idPattern = /\bid\s*=\s*["']([^"']+)["']/gi;
	let match = idPattern.exec(html);
	while (match) {
		const id = String(match[1] || "").trim();
		if (id) ids.add(id);
		match = idPattern.exec(html);
	}
	return ids;
}

function collectHashSectionReferences(source: string): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	const append = (value: string) => {
		const id = value.trim();
		if (!id || seen.has(id)) return;
		seen.add(id);
		ids.push(id);
	};
	const selectorPattern = /["']#([A-Za-z][A-Za-z0-9_-]*)["']/g;
	let selectorMatch = selectorPattern.exec(source);
	while (selectorMatch) {
		append(String(selectorMatch[1] || ""));
		selectorMatch = selectorPattern.exec(source);
	}
	const cssPattern = /#([A-Za-z][A-Za-z0-9_-]*)\s*[{,.:[>\s]/g;
	let cssMatch = cssPattern.exec(source);
	while (cssMatch) {
		append(String(cssMatch[1] || ""));
		cssMatch = cssPattern.exec(source);
	}
	return ids;
}

function outputJsonHasMediaContext(outputJson: Record<string, unknown>): boolean {
	const directUrls =
		Array.isArray(outputJson.media) ||
		Array.isArray(outputJson.items) ||
		Array.isArray(outputJson.images) ||
		Array.isArray(outputJson.imageUrls);
	if (directUrls) return true;
	const data = isRecord(outputJson.data) ? outputJson.data : null;
	return data ? outputJsonHasMediaContext(data) : false;
}

function countPreviewReferenceImagesRead(toolCalls: BridgeToolCall[]): number {
	let total = 0;
	for (const toolCall of toolCalls) {
		if (toolCall.status !== "succeeded") continue;
		if (toolCall.name !== "canvas_read_node_media_for_context") continue;
		const inputNodeIds = Array.isArray(toolCall.inputJson?.nodeIds)
			? toolCall.inputJson.nodeIds.filter((item: unknown) => typeof item === "string" && (item as string).trim()).length
			: 0;
		const outputJson = toolCallOutputJsonForDelivery(toolCall);
		if (outputJson && outputJsonHasMediaContext(outputJson)) {
			total += Math.max(1, inputNodeIds);
		} else {
			total += inputNodeIds;
		}
	}
	return total;
}

function buildWebHeroDeliveryEvidence(toolCalls: BridgeToolCall[]): WebHeroDeliveryEvidence | null {
	const candidates = collectWebHeroUpdateCandidates(toolCalls);
	if (candidates.length === 0) return null;
	const latest = candidates[candidates.length - 1];
	const documentHtml =
		readTrimmedString(latest.data.webHeroDocumentHtml) ||
		[
			readTrimmedString(latest.data.webHeroHtml),
			readTrimmedString(latest.data.webHeroCss),
		]
			.filter(Boolean)
			.join("\n");
	if (!documentHtml) {
		return {
			checked: false,
			updatedWebHeroNodeIds: candidates.map((item) => item.nodeId),
			sectionCount: 0,
			previewReferenceImageCount: countPreviewReferenceImagesRead(toolCalls),
			referencedSectionIds: [],
			missingReferencedSectionIds: [],
			errorCode: "webhero_document_html_missing",
		};
	}
	const domIds = collectDomIds(documentHtml);
	const referencedSectionIds = collectHashSectionReferences(
		[
			documentHtml,
			readTrimmedString(latest.data.webHeroCss),
			readTrimmedString(latest.data.webHeroHtml),
		].join("\n"),
	);
	const missingReferencedSectionIds = referencedSectionIds.filter((id) => !domIds.has(id));
	return {
		checked: true,
		updatedWebHeroNodeIds: candidates.map((item) => item.nodeId),
		sectionCount: countHtmlSections(documentHtml),
		previewReferenceImageCount: countPreviewReferenceImagesRead(toolCalls),
		referencedSectionIds,
		missingReferencedSectionIds,
	};
}

function collectDeclaredCanvasWriteTargets(
	toolCalls: BridgeToolCall[],
): DeclaredCanvasWriteTargets {
	const nodeIds: string[] = [];
	const assetUrls: string[] = [];
	const seenNodeIds = new Set<string>();
	const seenAssetUrls = new Set<string>();
	const appendNodeId = (value: unknown) => appendUniqueTrimmedString(nodeIds, seenNodeIds, value);
	const appendAssetUrl = (value: unknown) => appendUniqueHttpUrl(assetUrls, seenAssetUrls, value);
	for (const toolCall of toolCalls) {
		if (toolCall.status !== "succeeded") continue;
		const effects = readBridgeToolCallEffects(toolCall);
		if (effects) {
			appendStringArrayValues(effects.createdNodeIds, appendNodeId);
			appendStringArrayValues(effects.updatedNodeIds, appendNodeId);
			appendStringArrayValues(effects.createdAssetUrls, appendAssetUrl);
		}
		const outputJson = toolCallOutputJsonForDelivery(toolCall);
		if (!outputJson) continue;
		appendNodeId(outputJson.nodeId);
		collectMediaUrlsFromRecord(outputJson, appendAssetUrl);
		const data = isRecord(outputJson.data) ? outputJson.data : null;
		if (data) {
			appendNodeId(data.nodeId);
			collectMediaUrlsFromRecord(data, appendAssetUrl);
		}
	}
	return { nodeIds, assetUrls };
}

function recordHasResultUrl(record: Record<string, unknown>, resultKey: string): boolean {
	const results = Array.isArray(record[resultKey]) ? record[resultKey] : [];
	return results.some((item) => {
		if (!isRecord(item)) return false;
		const url = readTrimmedString(item.url);
		return /^https?:\/\//i.test(url);
	});
}

function recordHasDirectImageOutput(record: Record<string, unknown>): boolean {
	const imageUrl = readTrimmedString(record.imageUrl);
	if (/^https?:\/\//i.test(imageUrl)) return true;
	return recordHasResultUrl(record, "imageResults");
}

function recordHasDirectVideoOutput(record: Record<string, unknown>): boolean {
	const videoUrl = readTrimmedString(record.videoUrl);
	if (/^https?:\/\//i.test(videoUrl)) return true;
	return recordHasResultUrl(record, "videoResults");
}

function recordHasPendingDirectTask(record: Record<string, unknown>): boolean {
	if (record.pending === true) return true;
	const taskId =
		readTrimmedString(record.taskId) ||
		readTrimmedString(record.imageTaskId) ||
		readTrimmedString(record.videoTaskId);
	if (!taskId) return false;
	const status = readTrimmedString(record.status).toLowerCase();
	return status === "queued" || status === "running" || status === "pending" || status === "submitted";
}

function buildDirectMediaDeliveryEvidence(toolCalls: BridgeToolCall[]): DirectMediaDeliveryEvidence {
	const summary: DirectMediaDeliveryEvidence = {
		directImageOutputCount: 0,
		directVideoOutputCount: 0,
		pendingDirectImageTaskCount: 0,
		pendingDirectVideoTaskCount: 0,
	};
	for (const toolCall of toolCalls) {
		if (toolCall.status !== "succeeded") continue;
		const outputJson = toolCallOutputJsonForDelivery(toolCall);
		if (!outputJson) continue;
		if (
			toolCall.name === "canvas_image_generate_to_canvas" ||
			toolCall.name === "canvas_image_wait_for_result"
		) {
			if (recordHasDirectImageOutput(outputJson)) {
				summary.directImageOutputCount += 1;
			} else if (toolCall.name === "canvas_image_generate_to_canvas" && recordHasPendingDirectTask(outputJson)) {
				summary.pendingDirectImageTaskCount += 1;
			}
			continue;
		}
		if (
			toolCall.name === "canvas_video_generate_to_canvas" ||
			toolCall.name === "canvas_video_wait_for_result" ||
			toolCall.name === "canvas_video_concat_to_canvas"
		) {
			if (recordHasDirectVideoOutput(outputJson)) {
				summary.directVideoOutputCount += 1;
			} else if (toolCall.name === "canvas_video_generate_to_canvas" && recordHasPendingDirectTask(outputJson)) {
				summary.pendingDirectVideoTaskCount += 1;
			}
		}
	}
	return summary;
}

function parseFlowGraphRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value) as unknown;
			return isRecord(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}
	return isRecord(value) ? value : null;
}

function readFlowUpdatedAt(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (value instanceof Date) return value.toISOString();
	return null;
}

function summarizeCanvasFlowPersistence(graph: Record<string, unknown>): CanvasFlowPersistenceSummary {
	const summary: CanvasFlowPersistenceSummary = {
		nodeIds: new Set<string>(),
		assetUrls: new Set<string>(),
		visualNodeCount: 0,
		imageNodeCount: 0,
		videoNodeCount: 0,
		materializedOutputCount: 0,
	};
	const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
	for (const item of nodes) {
		if (!isRecord(item)) continue;
		const nodeId = readTrimmedString(item.id);
		if (nodeId) summary.nodeIds.add(nodeId);
		const data = isRecord(item.data) ? item.data : {};
		const kind = normalizeComparableKind(data.kind);
		if (isVisualDeliveryNodeKind(kind)) summary.visualNodeCount += 1;
		if (isVideoLikeNodeKind(kind)) {
			summary.videoNodeCount += 1;
		} else if (isVisualDeliveryNodeKind(kind)) {
			summary.imageNodeCount += 1;
		}
		const beforeUrlCount = summary.assetUrls.size;
		collectMediaUrlsFromRecord(data, (value) => {
			const url = typeof value === "string" ? value.trim() : "";
			if (/^https?:\/\//i.test(url)) summary.assetUrls.add(url);
		});
		if (summary.assetUrls.size > beforeUrlCount) summary.materializedOutputCount += 1;
	}
	return summary;
}

async function buildCanvasPersistenceEvidence(input: {
	c: AppContext;
	userId: string;
	flowId: string;
	toolCalls: BridgeToolCall[];
}): Promise<PublicChatCanvasPersistenceEvidence | null> {
	const declared = collectDeclaredCanvasWriteTargets(input.toolCalls);
	if (declared.nodeIds.length === 0 && declared.assetUrls.length === 0) return null;
	try {
		const flow = await getFlowForOwner(input.c.env.DB, input.flowId, input.userId);
		if (!flow) {
			return {
				checked: false,
				flowId: input.flowId,
				updatedAt: null,
				declaredNodeIds: declared.nodeIds,
				persistedNodeIds: [],
				missingNodeIds: declared.nodeIds,
				declaredAssetUrls: declared.assetUrls,
				persistedAssetUrls: [],
				missingAssetUrls: declared.assetUrls,
				persistedVisualNodeCount: 0,
				persistedImageNodeCount: 0,
				persistedVideoNodeCount: 0,
				persistedMaterializedOutputCount: 0,
				errorCode: "flow_not_found",
			};
		}
		const graph = parseFlowGraphRecord(flow.data);
		if (!graph) {
			return {
				checked: false,
				flowId: input.flowId,
				updatedAt: readFlowUpdatedAt(flow.updated_at),
				declaredNodeIds: declared.nodeIds,
				persistedNodeIds: [],
				missingNodeIds: declared.nodeIds,
				declaredAssetUrls: declared.assetUrls,
				persistedAssetUrls: [],
				missingAssetUrls: declared.assetUrls,
				persistedVisualNodeCount: 0,
				persistedImageNodeCount: 0,
				persistedVideoNodeCount: 0,
				persistedMaterializedOutputCount: 0,
				errorCode: "flow_data_invalid",
			};
		}
		const summary = summarizeCanvasFlowPersistence(graph);
		const persistedNodeIds = declared.nodeIds.filter((nodeId) => summary.nodeIds.has(nodeId));
		const missingNodeIds = declared.nodeIds.filter((nodeId) => !summary.nodeIds.has(nodeId));
		const persistedAssetUrls = declared.assetUrls.filter((url) => summary.assetUrls.has(url));
		const missingAssetUrls = declared.assetUrls.filter((url) => !summary.assetUrls.has(url));
		const evidence: PublicChatCanvasPersistenceEvidence = {
			checked: true,
			flowId: input.flowId,
			updatedAt: readFlowUpdatedAt(flow.updated_at),
			declaredNodeIds: declared.nodeIds,
			persistedNodeIds,
			missingNodeIds,
			declaredAssetUrls: declared.assetUrls,
			persistedAssetUrls,
			missingAssetUrls,
			persistedVisualNodeCount: summary.visualNodeCount,
			persistedImageNodeCount: summary.imageNodeCount,
			persistedVideoNodeCount: summary.videoNodeCount,
			persistedMaterializedOutputCount: summary.materializedOutputCount,
		};
		if (missingNodeIds.length > 0 || missingAssetUrls.length > 0) {
			appendTraceEvent(input.c, "public:agent:canvas_write_not_persisted", {
				flowId: input.flowId,
				updatedAt: evidence.updatedAt,
				declaredNodeCount: declared.nodeIds.length,
				missingNodeIds,
				declaredAssetUrlCount: declared.assetUrls.length,
				missingAssetUrls,
				persistedVisualNodeCount: summary.visualNodeCount,
				persistedVideoNodeCount: summary.videoNodeCount,
			});
		}
		return evidence;
	} catch (error) {
		const code =
			isRecord(error) && typeof error.code === "string" && error.code.trim()
				? error.code.trim()
				: "canvas_write_verification_failed";
		return {
			checked: false,
			flowId: input.flowId,
			updatedAt: null,
			declaredNodeIds: declared.nodeIds,
			persistedNodeIds: [],
			missingNodeIds: declared.nodeIds,
			declaredAssetUrls: declared.assetUrls,
			persistedAssetUrls: [],
			missingAssetUrls: declared.assetUrls,
			persistedVisualNodeCount: 0,
			persistedImageNodeCount: 0,
			persistedVideoNodeCount: 0,
			persistedMaterializedOutputCount: 0,
			errorCode: code,
		};
	}
}

function buildPublicChatDeliveryEvidence(input: {
	assets: Array<{ type: "image" | "video"; url: string; thumbnailUrl?: string }>;
	toolEvidence: BridgeToolEvidence;
	visualDelivery: VisualDeliverySummary;
	toolCalls: BridgeToolCall[];
	canvasPersistence: PublicChatCanvasPersistenceEvidence | null;
}): PublicChatDeliveryEvidence {
	const imageAssetCount = input.assets.filter((asset) => asset.type === "image").length;
	const videoAssetCount = input.assets.filter((asset) => asset.type === "video").length;
	const directMediaEvidence = buildDirectMediaDeliveryEvidence(input.toolCalls);
	const webHeroDelivery = buildWebHeroDeliveryEvidence(input.toolCalls);
	return {
		assetCount: input.assets.length,
		imageAssetCount,
		videoAssetCount,
		directImageOutputCount: directMediaEvidence.directImageOutputCount,
		directVideoOutputCount: directMediaEvidence.directVideoOutputCount,
		pendingDirectImageTaskCount: directMediaEvidence.pendingDirectImageTaskCount,
		pendingDirectVideoTaskCount: directMediaEvidence.pendingDirectVideoTaskCount,
			wroteCanvas: input.toolEvidence.wroteCanvas,
			generatedAssets: input.toolEvidence.generatedAssets,
			imageLikeNodeCount: input.visualDelivery.imageLikeNodeCount,
			preproductionImageLikeNodeCount:
				input.visualDelivery.preproductionImageLikeNodeCount,
			reusablePreproductionImageLikeNodeCount:
				input.visualDelivery.reusablePreproductionImageLikeNodeCount,
			hasVideoNodes: input.visualDelivery.hasVideoNodes,
			hasMaterializedVisualOutputs:
				input.visualDelivery.hasMaterializedVisualOutputs,
			...(webHeroDelivery ? { webHeroDelivery } : {}),
			...(input.canvasPersistence ? { canvasPersistence: input.canvasPersistence } : {}),
		};
	}

function buildImagePromptSpecGovernanceSummary(input: {
	text: string;
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
	toolCalls: BridgeToolCall[];
	likelyImageContext: boolean;
	selectedNodeKind: string | null;
	requestAssetInputs: AgentsBridgeAssetInput[];
}): ImagePromptSpecGovernanceSummary {
	const requestAnchorSummary = summarizeImagePromptSpecAnchors(input.requestAssetInputs);
	const summary: ImagePromptSpecGovernanceSummary = {
		active: false,
		sourceHints: [],
		visualPromptTargetCount: 0,
		validSpecCount: 0,
		missingSpecCount: 0,
		invalidSpecCount: 0,
		missingReferenceBindingsCount: 0,
		missingIdentityConstraintsCount: 0,
		missingEnvironmentObjectsCount: 0,
		missingCharacterContinuityCount: 0,
	};

	const textPayload = extractStructuredPromptPayloadFromText(input.text);
	if (
		textPayload &&
		isLikelyImagePromptTextPayload({
			record: textPayload,
			likelyImageContext: input.likelyImageContext,
		})
	) {
		applyImagePromptSpecGovernanceRecord(
			summary,
			textPayload,
			"final_text_payload",
			requestAnchorSummary,
		);
	}

	if (input.canvasPlanDiagnostics.parseSuccess && input.canvasPlanDiagnostics.rawPayload) {
		try {
			const parsed = JSON.parse(input.canvasPlanDiagnostics.rawPayload) as unknown;
			if (isRecord(parsed) && Array.isArray(parsed.nodes)) {
				for (const node of parsed.nodes) {
					if (!isRecord(node)) continue;
						const kind = normalizeComparableKind(node.kind);
						if (!isImagePromptSpecNodeKind(kind)) continue;
						const config = isRecord(node.config) ? node.config : null;
						if (!config || typeof readStructuredPromptField(config) === "undefined") continue;
						applyImagePromptSpecGovernanceRecord(
						summary,
						config,
						"canvas_plan_image_node",
						requestAnchorSummary,
					);
				}
			}
		} catch {
			// canvas plan parse errors are already captured elsewhere
		}
	}

	const nodeStates = buildFlowPatchNodeFinalStates({
		toolCalls: input.toolCalls,
		selectedNodeKind: input.selectedNodeKind,
	});
	for (const state of nodeStates.values()) {
		if (!isImagePromptSpecNodeKind(state.kind) || typeof readStructuredPromptField(state.data) === "undefined") {
			continue;
		}
		applyImagePromptSpecGovernanceRecord(
			summary,
			state.data,
			"flow_patch_final_node_state",
			requestAnchorSummary,
		);
	}

	return summary;
}

function buildAgentsBridgeCanvasMutationSummary(
	toolCalls: BridgeToolCall[],
): AgentsBridgeCanvasMutation | null {
	const deletedNodeIds: string[] = [];
	const deletedEdgeIds: string[] = [];
	const createdNodeIds: string[] = [];
	const patchedNodeIds: string[] = [];
	const executableNodeIds: string[] = [];
	const seenDeletedNodeIds = new Set<string>();
	const seenDeletedEdgeIds = new Set<string>();
	const seenCreatedNodeIds = new Set<string>();
	const seenPatchedNodeIds = new Set<string>();
	const appendDeletedNodeId = (value: unknown) => {
		const nodeId = typeof value === "string" ? value.trim() : "";
		if (!nodeId || seenDeletedNodeIds.has(nodeId)) return;
		seenDeletedNodeIds.add(nodeId);
		deletedNodeIds.push(nodeId);
	};
	const appendDeletedEdgeId = (value: unknown) => {
		const edgeId = typeof value === "string" ? value.trim() : "";
		if (!edgeId || seenDeletedEdgeIds.has(edgeId)) return;
		seenDeletedEdgeIds.add(edgeId);
		deletedEdgeIds.push(edgeId);
	};
	const appendCreatedNodeId = (value: unknown) => {
		const nodeId = typeof value === "string" ? value.trim() : "";
		if (!nodeId || seenCreatedNodeIds.has(nodeId)) return;
		seenCreatedNodeIds.add(nodeId);
		createdNodeIds.push(nodeId);
	};
	const appendPatchedNodeId = (value: unknown) => {
		const nodeId = typeof value === "string" ? value.trim() : "";
		if (!nodeId || seenPatchedNodeIds.has(nodeId)) return;
		seenPatchedNodeIds.add(nodeId);
		patchedNodeIds.push(nodeId);
	};
	const appendStringArray = (value: unknown, append: (item: unknown) => void) => {
		if (!Array.isArray(value)) return;
		for (const item of value) append(item);
	};
	for (const toolCall of toolCalls) {
		if (toolCall.status !== "succeeded") continue;
		const effects = readBridgeToolCallEffects(toolCall);
		if (effects) {
			appendStringArray(effects.deletedNodeIds, appendDeletedNodeId);
			appendStringArray(effects.deletedEdgeIds, appendDeletedEdgeId);
			appendStringArray(effects.createdNodeIds, appendCreatedNodeId);
			appendStringArray(effects.updatedNodeIds, appendPatchedNodeId);
			if (
				Array.isArray(effects.createdNodeIds) ||
				Array.isArray(effects.updatedNodeIds) ||
				Array.isArray(effects.deletedNodeIds) ||
				Array.isArray(effects.deletedEdgeIds) ||
				effects.wroteCanvas === true
			) {
				continue;
			}
		}
	}

	if (
		!deletedNodeIds.length &&
		!deletedEdgeIds.length &&
		!createdNodeIds.length &&
		!patchedNodeIds.length &&
		!executableNodeIds.length
	) {
		return null;
	}

	return {
		deletedNodeIds,
		deletedEdgeIds,
		createdNodeIds,
		patchedNodeIds,
		executableNodeIds,
	};
}

function classifyBridgeOutputMode(input: {
	assetCount: number;
	canvasPlanParsed: boolean;
	canvasPlanHasAssetUrls: boolean;
	wroteCanvas: boolean;
}): AgentsBridgeOutputMode {
	if (input.canvasPlanParsed && input.canvasPlanHasAssetUrls) return "plan_with_assets";
	if (input.canvasPlanParsed) return "plan_only";
	if (input.wroteCanvas) return "direct_assets";
	if (input.assetCount > 0) return "direct_assets";
	return "text_only";
}

function decorateCanvasPlanDiagnosticsForOutputMode(input: {
	outputMode: AgentsBridgeOutputMode;
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
}): CanvasPlanDiagnostics {
	if (input.outputMode !== "text_only") return input.canvasPlanDiagnostics;
	if (input.canvasPlanDiagnostics.tagPresent) return input.canvasPlanDiagnostics;
	if (input.canvasPlanDiagnostics.errorCode === "invalid_canvas_plan_tag_name") {
		return input.canvasPlanDiagnostics;
	}
	return {
		...input.canvasPlanDiagnostics,
		summary: "plain_text_answer_without_canvas_plan",
		reason: "not_applicable_text_only",
	};
}

function buildDiagnosticFlags(input: {
	requestKind: string;
	text: string;
	toolEvidence: BridgeToolEvidence;
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
	outputMode: AgentsBridgeOutputMode;
	toolStatusSummary: ToolStatusSummary;
	toolExecutionIssues: ToolExecutionIssueSummary;
	toolCalls: BridgeToolCall[];
	runtimeTrace: AgentsRuntimeTraceSummary | null;
	generationGate: PublicAgentsGenerationGate;
	forceAssetGeneration: boolean;
	semanticExecutionIntent: AgentsSemanticExecutionIntentSummary;
	planningTrace: AgentsPlanningTraceSummary | null;
	todoListTrace: AgentsTodoListTraceSummary | null;
	selectedNodeKind: string | null;
	selectedReference: AgentsBridgeChatContext["selectedReference"];
	requestAssetInputs: AgentsBridgeAssetInput[];
}): DiagnosticFlag[] {
	const flags: DiagnosticFlag[] = [];
	const canvasPlanParsed = input.canvasPlanDiagnostics.parseSuccess === true;
	const canvasPlanTagPresent = input.canvasPlanDiagnostics.tagPresent === true;
	const canvasPlanNodeCount =
		typeof input.canvasPlanDiagnostics.nodeCount === "number" ? input.canvasPlanDiagnostics.nodeCount : 0;
	void input.requestKind;
	void input.toolEvidence;
	if (canvasPlanTagPresent && !canvasPlanParsed) {
		flags.push({
			code: input.canvasPlanDiagnostics.errorCode || "invalid_canvas_plan",
			severity: "medium",
			title: "画布计划无效",
			detail: input.canvasPlanDiagnostics.errorDetail || "canvas_canvas_plan 无法解析或不符合 schema。",
		});
	}
	if (canvasPlanParsed && canvasPlanNodeCount <= 0) {
		flags.push({
			code: "parsed_plan_without_nodes",
			severity: "medium",
			title: "画布计划解析成功但没有节点",
			detail: "这是无效结果，前端无法创建任何节点。",
		});
	}
	if (input.toolExecutionIssues.hasExecutionIssues) {
		flags.push({
			code: "tool_execution_issues",
			severity: "medium",
			title: "存在工具执行异常",
			detail:
				`failed=${input.toolExecutionIssues.failedToolCalls}, ` +
				`denied=${input.toolExecutionIssues.deniedToolCalls}, ` +
				`blocked=${input.toolExecutionIssues.blockedToolCalls}, ` +
				`coordinationBlocked=${input.toolExecutionIssues.coordinationBlockedToolCalls}, ` +
				`actionableBlocked=${input.toolExecutionIssues.actionableBlockedToolCalls}`,
		});
	}
	const truncatedContextSources =
		input.runtimeTrace?.contextDiagnostics?.sources.filter((source) => source.truncated) ?? [];
	if (truncatedContextSources.length > 0) {
		flags.push({
			code: "agents_runtime_context_truncated",
			severity: "medium",
			title: "Agents runtime 上下文已触发预算裁剪",
			detail:
				`以下上下文来源在 agents-cli 内已按 budget 截断：${truncatedContextSources
					.map((source) => `${source.id}(${source.chars}/${source.budgetChars})`)
					.join(", ")}。` +
				"若本轮语义证据不足、遗漏约束或引用事实不完整，应优先检查这些来源是否被裁剪。",
		});
	}
	const runtimeRequiresApprovalCount =
		input.runtimeTrace?.policySummary?.requiresApprovalCount ?? 0;
	if (runtimeRequiresApprovalCount > 0) {
		flags.push({
			code: "agents_runtime_requires_approval",
			severity: "medium",
			title: "Agents runtime 存在待审批动作",
			detail:
				`policy engine 本轮标记了 ${runtimeRequiresApprovalCount} 次 requires_approval。` +
				"这表示部分工具或命令因高风险/远程本地访问约束没有被直接执行，应由上游显式审批后重试。",
		});
	}
	const runtimePolicyDenyCount = input.runtimeTrace?.policySummary?.denyCount ?? 0;
	if (runtimePolicyDenyCount > 0) {
		const deniedSignatures =
			input.runtimeTrace?.policySummary?.uniqueDeniedSignatures.slice(0, 4) ?? [];
		flags.push({
			code: "agents_runtime_policy_denials_present",
			severity: "medium",
			title: "Agents runtime 存在策略拒绝",
			detail:
				`policy engine 本轮明确拒绝了 ${runtimePolicyDenyCount} 次动作。` +
				(deniedSignatures.length > 0
					? ` 拒绝摘要：${deniedSignatures.join(" | ")}`
					: ""),
		});
	}
	const hasChecklistInProgress =
		(input.todoListTrace?.inProgressCount ?? 0) > 0 ||
		(input.todoListTrace?.pendingCount ?? 0) > 0;
	const checklistExecutionGateActive =
		input.semanticExecutionIntent.requiresExecutionDelivery || input.forceAssetGeneration;
	if (checklistExecutionGateActive && hasChecklistInProgress && input.todoListTrace) {
		flags.push({
			code: "todo_checklist_incomplete",
			severity: "medium",
			title: "Checklist 仍有未完成项",
			detail:
				`Todo 清单仍有 pending=${input.todoListTrace.pendingCount}, in_progress=${input.todoListTrace.inProgressCount}。` +
				"执行型回合在关键项未完成时不得判定为 satisfied。",
		});
	}
	const videoPromptGovernance = buildVideoPromptGovernanceSummary({
		text: input.text,
		canvasPlanDiagnostics: input.canvasPlanDiagnostics,
	});
	const imagePromptSpecGovernance = buildImagePromptSpecGovernanceSummary({
		text: input.text,
		canvasPlanDiagnostics: input.canvasPlanDiagnostics,
		toolCalls: input.toolCalls,
		likelyImageContext:
			isImagePromptContextKind(input.selectedNodeKind) ||
			isImagePromptContextKind(input.selectedReference?.kind),
		selectedNodeKind: input.selectedNodeKind,
		requestAssetInputs: input.requestAssetInputs,
	});
	if (videoPromptGovernance.active) {
		if (!videoPromptGovernance.hasExecutablePrompt) {
			flags.push({
				code: "video_prompt_core_fields_missing",
				severity: "high",
				title: "视频提示词缺少核心字段",
				detail:
					videoPromptGovernance.usesDeprecatedVideoPromptField
						? "视频节点必须提供 `prompt`；`videoPrompt` 已废弃，不再作为执行字段。"
						: "视频节点必须提供 `prompt`，并把真实会参与生成的镜头、动作、导演意图与约束直接写进 prompt 本体。",
			});
		}
	}
	if (imagePromptSpecGovernance.invalidSpecCount > 0) {
		flags.push({
			code: "image_prompt_spec_v2_invalid",
			severity: "high",
			title: "图片结构化提示词非法",
			detail:
				`图片结果里检测到 ${imagePromptSpecGovernance.invalidSpecCount} 个无效 structuredPrompt。` +
				" 若提供结构化 JSON，请统一写入 `structuredPrompt`，并显式提供 version=v2、shotIntent、spatialLayout、cameraPlan、lightingPlan 等核心字段。",
		});
	}
	if (imagePromptSpecGovernance.missingSpecCount > 0) {
		flags.push({
			code: "image_prompt_spec_v2_missing",
			severity: "high",
			title: "图片缺少结构化提示词",
			detail:
				`图片结果里检测到 ${imagePromptSpecGovernance.missingSpecCount} 个目标缺少 structuredPrompt。` +
				" 若结果需要结构化图片提示词，必须同步提供 version=v2 的 structuredPrompt，并包含 shotIntent、spatialLayout、cameraPlan、lightingPlan 等核心字段。",
		});
	}
	if (imagePromptSpecGovernance.missingReferenceBindingsCount > 0) {
		flags.push({
			code: "image_prompt_spec_v2_reference_bindings_missing",
			severity: "high",
			title: "结构化提示词缺少参考绑定",
			detail:
				`检测到 ${imagePromptSpecGovernance.missingReferenceBindingsCount} 个 structuredPrompt 未显式填写 referenceBindings。已有参考输入时禁止只在自然语言 prompt 里口头引用。`,
		});
	}
	if (imagePromptSpecGovernance.missingIdentityConstraintsCount > 0) {
		flags.push({
			code: "image_prompt_spec_v2_identity_constraints_missing",
			severity: "high",
			title: "结构化提示词缺少身份锁定",
			detail:
				`检测到 ${imagePromptSpecGovernance.missingIdentityConstraintsCount} 个 structuredPrompt 未填写 identityConstraints。存在角色绑定时必须显式锁定身份。`,
		});
	}
	if (imagePromptSpecGovernance.missingEnvironmentObjectsCount > 0) {
		flags.push({
			code: "image_prompt_spec_v2_environment_objects_missing",
			severity: "high",
			title: "结构化提示词缺少环境/道具锚点",
			detail:
				`检测到 ${imagePromptSpecGovernance.missingEnvironmentObjectsCount} 个 structuredPrompt 未填写 environmentObjects。存在场景/道具参考时必须落结构化字段。`,
		});
	}
	if (imagePromptSpecGovernance.missingCharacterContinuityCount > 0) {
		flags.push({
			code: "image_prompt_spec_v2_character_continuity_missing",
			severity: "high",
			title: "结构化提示词缺少角色连续性约束",
			detail:
				`检测到 ${imagePromptSpecGovernance.missingCharacterContinuityCount} 个 structuredPrompt 未填写 continuityConstraints。存在角色年龄/状态证据时，必须显式约束状态连续性。`,
		});
	}
	return flags;
}

function buildAgentsBridgeDecision(input: {
	outputMode: AgentsBridgeOutputMode;
	assetCount: number;
	toolEvidence: BridgeToolEvidence;
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
}): AgentsBridgeDecision {
	const executionKind =
		input.toolEvidence.wroteCanvas
			? "execute"
			: input.outputMode === "plan_only" || input.outputMode === "plan_with_assets"
			? input.outputMode === "plan_with_assets"
				? "generate"
				: "plan"
			: input.outputMode === "direct_assets"
				? "generate"
				: "answer";
	const canvasAction =
		input.toolEvidence.wroteCanvas
			? "write_canvas"
			: input.canvasPlanDiagnostics.parseSuccess &&
			  input.canvasPlanDiagnostics.action === "create_canvas_workflow"
			? "create_canvas_workflow"
			: "none";
	const requiresConfirmation =
		(executionKind === "plan" && input.assetCount === 0) ||
		(canvasAction === "create_canvas_workflow" && !input.toolEvidence.generatedAssets);
	const reasonParts = [
		`mode=${input.outputMode}`,
		`projectStateRead=${input.toolEvidence.readProjectState ? "yes" : "no"}`,
		`assetCount=${input.assetCount}`,
		canvasAction === "write_canvas"
			? "canvas_write_done"
			: canvasAction === "create_canvas_workflow"
				? "canvas_plan_ready"
				: "no_canvas_plan",
	];
	return {
		executionKind,
		canvasAction,
		assetCount: input.assetCount,
		projectStateRead: input.toolEvidence.readProjectState,
		requiresConfirmation,
		reason: reasonParts.join("; "),
	};
}

function buildAgentsBridgeTurnVerdict(input: {
	text: string;
	assetCount: number;
	toolEvidence: BridgeToolEvidence;
	toolExecutionIssues: ToolExecutionIssueSummary;
	toolCalls: BridgeToolCall[];
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
	diagnosticFlags: DiagnosticFlag[];
	forceAssetGeneration: boolean;
	semanticExecutionIntent: AgentsSemanticExecutionIntentSummary;
	deliveryVerification: PublicChatDeliveryVerificationSummary;
	completionTrace?: AgentsCompletionTraceSummary | null;
}): AgentsBridgeTurnVerdict {
	const failedReasons = new Set<string>();
	const partialReasons = new Set<string>();
	const validCanvasPlan =
		input.canvasPlanDiagnostics.parseSuccess === true &&
		input.canvasPlanDiagnostics.nodeCount > 0;
	const invalidCanvasPlan =
		input.canvasPlanDiagnostics.errorCode === "invalid_canvas_plan_tag_name" ||
		(input.canvasPlanDiagnostics.tagPresent === true &&
			input.canvasPlanDiagnostics.parseSuccess !== true);
	const parsedPlanWithoutNodes =
		input.canvasPlanDiagnostics.parseSuccess === true &&
		input.canvasPlanDiagnostics.nodeCount <= 0;
	const hasExecutionEvidence =
		input.assetCount > 0 || input.toolEvidence.generatedAssets || input.toolEvidence.wroteCanvas;
	const hasDeliveredResult =
		Boolean(input.text.trim()) ||
		input.assetCount > 0 ||
		input.toolEvidence.wroteCanvas ||
		validCanvasPlan;
	const forceAssetGenerationDeferredToCanvasPlan =
		input.forceAssetGeneration &&
		!hasExecutionEvidence &&
		validCanvasPlan &&
		input.canvasPlanDiagnostics.action === "create_canvas_workflow";
	const forceAssetGenerationUnmet =
		input.forceAssetGeneration &&
		!hasExecutionEvidence &&
		!forceAssetGenerationDeferredToCanvasPlan;
	const semanticExecutionDeliveryUnmet =
		input.semanticExecutionIntent.requiresExecutionDelivery &&
		!hasExecutionEvidence &&
		!validCanvasPlan;
	const genericDeliveryFailureRedundant =
		input.deliveryVerification.code === "generic_execution_delivery_missing" &&
		(
			forceAssetGenerationUnmet ||
			forceAssetGenerationDeferredToCanvasPlan ||
			semanticExecutionDeliveryUnmet
		);

	if (input.completionTrace) {
		if (input.completionTrace.allowFinish !== true || input.completionTrace.terminal === "blocked") {
			failedReasons.add("runtime_completion_blocked");
			if (input.completionTrace.failureReason) {
				failedReasons.add(`runtime_completion_reason:${input.completionTrace.failureReason}`);
			}
		} else if (input.completionTrace.terminal === "explicit_failure") {
			failedReasons.add("runtime_completion_explicit_failure");
			if (input.completionTrace.failureReason) {
				failedReasons.add(`runtime_completion_reason:${input.completionTrace.failureReason}`);
			}
		}
	}

	if (invalidCanvasPlan) failedReasons.add("invalid_canvas_plan");
	if (parsedPlanWithoutNodes) failedReasons.add("parsed_plan_without_nodes");
	if (!hasDeliveredResult) failedReasons.add("empty_response_without_execution");
	if (forceAssetGenerationUnmet) failedReasons.add("force_asset_generation_unmet");
	if (semanticExecutionDeliveryUnmet) {
		failedReasons.add("semantic_execution_delivery_unmet");
	}
	if (
		input.deliveryVerification.applicable &&
		input.deliveryVerification.status === "failed" &&
		input.deliveryVerification.code &&
		!genericDeliveryFailureRedundant
	) {
		if (input.deliveryVerification.code === "direct_media_generation_pending_result") {
			partialReasons.add("external_media_generation_waiting");
		} else {
			failedReasons.add(input.deliveryVerification.code);
		}
	}
	if (!hasExecutionEvidence) {
		if (hasMediaWaitTimeout(input.toolCalls)) failedReasons.add("media_wait_timeout");
		if (hasBlockedMediaGeneration(input.toolCalls)) failedReasons.add("media_generation_blocked");
	}
	if (forceAssetGenerationDeferredToCanvasPlan) {
		partialReasons.add("force_asset_generation_deferred_to_canvas_plan");
	}
	if (input.toolExecutionIssues.hasExecutionIssues) partialReasons.add("tool_execution_issues");
	if (input.diagnosticFlags.length > 0) {
		for (const flag of input.diagnosticFlags) {
			const code = String(flag.code || "").trim();
			if (!code) continue;
			if (HARD_FAILURE_DIAGNOSTIC_CODES.has(code)) {
				failedReasons.add(code);
				continue;
			}
			partialReasons.add(code);
		}
		partialReasons.add("diagnostic_flags_present");
	}

	if (failedReasons.size > 0) {
		return {
			status: "failed",
			reasons: Array.from(failedReasons),
		};
	}

	if (partialReasons.size > 0) {
		return {
			status: "partial",
			reasons: Array.from(partialReasons),
		};
	}

	return {
		status: "satisfied",
		reasons: ["validated_result"],
	};
}


function pickFirstAnchorBindingByKind(
	bindings: PublicFlowAnchorBinding[],
	kind: PublicFlowAnchorBinding["kind"],
): PublicFlowAnchorBinding | null {
	for (const binding of bindings) {
		if (binding.kind === kind) return binding;
	}
	return null;
}

function readSelectedReferenceRoleName(
	selectedReferenceRaw: Record<string, unknown>,
	anchorBindings: PublicFlowAnchorBinding[],
): string | null {
	if (typeof selectedReferenceRaw.roleName === "string") {
		return String(selectedReferenceRaw.roleName).trim() || null;
	}
	return pickFirstAnchorBindingByKind(anchorBindings, "character")?.label || null;
}

function readSelectedReferenceRoleCardId(
	selectedReferenceRaw: Record<string, unknown>,
	anchorBindings: PublicFlowAnchorBinding[],
): string | null {
	if (typeof selectedReferenceRaw.roleCardId === "string") {
		return String(selectedReferenceRaw.roleCardId).trim() || null;
	}
	return pickFirstAnchorBindingByKind(anchorBindings, "character")?.refId || null;
}

function normalizeAgentsBridgeChatContext(raw: unknown): AgentsBridgeChatContext {
		if (!raw || typeof raw !== "object") {
			return {
				currentProjectName: null,
				skill: null,
			selectedNodeLabel: null,
			selectedNodeKind: null,
			selectedNodeTextPreview: null,
			selectedReference: null,
		};
	}
	const value = raw as Record<string, unknown>;
	const skillRaw = value.skill;
	const selectedReferenceRaw = value.selectedReference;
	const normalizedAnchorBindings =
		selectedReferenceRaw && typeof selectedReferenceRaw === "object"
			? normalizePublicFlowAnchorBindings(
					(selectedReferenceRaw as Record<string, unknown>).anchorBindings,
			  )
			: [];
	const skill =
		skillRaw && typeof skillRaw === "object"
			? {
					key:
						typeof (skillRaw as Record<string, unknown>).key === "string"
							? String((skillRaw as Record<string, unknown>).key).trim() || null
							: null,
					name:
						typeof (skillRaw as Record<string, unknown>).name === "string"
							? String((skillRaw as Record<string, unknown>).name).trim() || null
							: null,
			  }
			: null;
	return {
			currentProjectName:
				typeof value.currentProjectName === "string"
					? String(value.currentProjectName).trim() || null
					: null,
			skill,
		selectedNodeLabel:
			typeof value.selectedNodeLabel === "string"
				? String(value.selectedNodeLabel).trim() || null
				: null,
		selectedNodeKind:
			typeof value.selectedNodeKind === "string"
				? String(value.selectedNodeKind).trim() || null
				: null,
		selectedNodeTextPreview:
			typeof value.selectedNodeTextPreview === "string"
				? String(value.selectedNodeTextPreview).trim() || null
				: null,
		selectedReference:
			selectedReferenceRaw && typeof selectedReferenceRaw === "object"
				? {
						nodeId:
							typeof (selectedReferenceRaw as Record<string, unknown>).nodeId === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).nodeId).trim() || null
								: null,
						label:
							typeof (selectedReferenceRaw as Record<string, unknown>).label === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).label).trim() || null
								: null,
						kind:
							typeof (selectedReferenceRaw as Record<string, unknown>).kind === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).kind).trim() || null
								: null,
						...(normalizedAnchorBindings.length
							? { anchorBindings: normalizedAnchorBindings }
							: {}),
						roleName: readSelectedReferenceRoleName(
							selectedReferenceRaw as Record<string, unknown>,
							normalizedAnchorBindings,
						),
						roleCardId: readSelectedReferenceRoleCardId(
							selectedReferenceRaw as Record<string, unknown>,
							normalizedAnchorBindings,
						),
						imageUrl:
							typeof (selectedReferenceRaw as Record<string, unknown>).imageUrl === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).imageUrl).trim() || null
								: null,
						sourceUrl:
							typeof (selectedReferenceRaw as Record<string, unknown>).sourceUrl === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).sourceUrl).trim() || null
								: null,
						productionLayer:
							typeof (selectedReferenceRaw as Record<string, unknown>).productionLayer === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).productionLayer).trim() || null
								: null,
						creationStage:
							typeof (selectedReferenceRaw as Record<string, unknown>).creationStage === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).creationStage).trim() || null
								: null,
							approvalStatus:
								typeof (selectedReferenceRaw as Record<string, unknown>).approvalStatus === "string"
									? String((selectedReferenceRaw as Record<string, unknown>).approvalStatus).trim() || null
									: null,
							hasUpstreamTextEvidence:
								(selectedReferenceRaw as Record<string, unknown>).hasUpstreamTextEvidence === true,
						hasDownstreamComposeVideo:
							(selectedReferenceRaw as Record<string, unknown>).hasDownstreamComposeVideo === true,
				  }
				: null,
	};
}

function normalizeComparableString(value: string | null | undefined): string {
	return String(value || "").trim().toLowerCase();
}

function isDirectVideoSceneAnchorReference(
	selectedReference: AgentsBridgeChatContext["selectedReference"],
): boolean {
	if (!selectedReference) return false;
	const kind = normalizeComparableString(selectedReference.kind);
	const productionLayer = normalizeComparableString(selectedReference.productionLayer);
	const creationStage = normalizeComparableString(selectedReference.creationStage);
	if (productionLayer === "anchors") return true;
	if (
		kind === "image" &&
		selectedReference.hasUpstreamTextEvidence &&
		selectedReference.hasDownstreamComposeVideo
	) {
		return true;
	}
	return creationStage === "approved_keyframe_selection";
}

function summarizeAssetRoles(assetInputs: AgentsBridgeAssetInput[]): string[] {
	const counts = new Map<AgentsBridgeAssetRole, number>();
	for (const item of assetInputs) {
		const role = item.role;
		counts.set(role, (counts.get(role) || 0) + 1);
	}
	return Array.from(counts.entries()).map(([role, count]) => `${role}:${count}`);
}

function describeReferenceImageRole(
	role: AgentsBridgeAssetRole | null | undefined,
): string | null {
	switch (role) {
		case "target":
			return "目标图";
		case "reference":
			return "参考图";
		case "character":
			return "角色参考";
		case "scene":
			return "场景参考";
		case "prop":
			return "道具参考";
		case "product":
			return "产品参考";
		case "style":
			return "风格参考";
		case "context":
			return "场景参考";
		case "mask":
			return "遮罩参考";
		default:
			return null;
	}
}

function inferReferenceImageSlotLabel(input: {
	role: AgentsBridgeAssetRole | null;
	name: string | null;
	note: string | null;
	selectedReferenceLabel: string | null;
}): string | null {
	if (input.name) return input.name;
	if (input.selectedReferenceLabel) return input.selectedReferenceLabel;
	if (input.note) {
		const trimmedNote = input.note.trim();
		if (trimmedNote.length <= 80) return trimmedNote;
	}
	return describeReferenceImageRole(input.role) || "参考图";
}

function buildReferenceImageSlots(input: {
	referenceImages: string[];
	assetInputs: AgentsBridgeAssetInput[];
	selectedReference: AgentsBridgeChatContext["selectedReference"];
}): AgentsBridgeReferenceImageSlot[] {
	if (!input.referenceImages.length) return [];
	const assetInputByUrl = new Map<string, AgentsBridgeAssetInput>();
	for (const item of input.assetInputs) {
		const url = String(item.url || "").trim();
		if (!url || assetInputByUrl.has(url)) continue;
		assetInputByUrl.set(url, item);
	}
	return input.referenceImages.map((url, index) => {
		const matchedAsset = assetInputByUrl.get(url) || null;
		const matchedSelectedReference =
			input.selectedReference?.imageUrl?.trim() === url ? input.selectedReference : null;
		const role = matchedAsset?.role || null;
		const name =
			typeof matchedAsset?.name === "string" && matchedAsset.name.trim()
				? matchedAsset.name.trim()
				: null;
		const note =
			typeof matchedAsset?.note === "string" && matchedAsset.note.trim()
				? matchedAsset.note.trim()
				: null;
		const selectedReferenceLabel =
			typeof matchedSelectedReference?.label === "string" &&
			matchedSelectedReference.label.trim()
				? matchedSelectedReference.label.trim()
				: null;
		return {
			slot: `图${index + 1}`,
			url,
			role: describeReferenceImageRole(role),
			label: inferReferenceImageSlotLabel({
				role,
				name,
				note,
				selectedReferenceLabel,
			}),
			note,
		};
	});
}

function summarizeReferenceImageSlotsForTrace(
	slots: AgentsBridgeReferenceImageSlot[],
): string[] {
	return slots.map((slot) => {
		const parts = [slot.slot];
		if (slot.label) parts.push(slot.label);
		if (slot.role) parts.push(`role=${slot.role}`);
		if (slot.note) parts.push(`note=${slot.note}`);
		return parts.join(" | ");
	});
}

type PublicAgentsGenerationGate = {
	active: boolean;
	directGenerationReady: boolean;
	hasVisualAnchors: boolean;
	reason: string;
};

function evaluatePublicAgentsGenerationGate(input: {
	publicAgentsRequest: boolean;
	canvasProjectId: string;
	canvasFlowId: string;
	referenceImages: string[];
	assetInputsCount: number;
	selectedReferenceKind?: string | null;
	selectedReferenceImageUrl: string;
}): PublicAgentsGenerationGate {
	const selectedReferenceIsStyle =
		normalizeComparableString(input.selectedReferenceKind) === "style_reference";
	const active = Boolean(
		input.publicAgentsRequest && input.canvasProjectId && input.canvasFlowId,
	);
	if (!active) {
		return {
			active: false,
			directGenerationReady: true,
			hasVisualAnchors:
				input.referenceImages.length > 0 ||
				input.assetInputsCount > 0 ||
				(!selectedReferenceIsStyle && /^https?:\/\//i.test(input.selectedReferenceImageUrl)),
			reason: "non_canvas_or_non_public_agents",
		};
	}

	const hasVisualAnchors =
		input.referenceImages.length > 0 ||
		input.assetInputsCount > 0 ||
		(!selectedReferenceIsStyle && /^https?:\/\//i.test(input.selectedReferenceImageUrl));
	if (hasVisualAnchors) {
		return {
			active: true,
			directGenerationReady: true,
			hasVisualAnchors: true,
			reason: "visual_anchors_present",
		};
	}

	return {
		active: true,
		directGenerationReady: false,
		hasVisualAnchors: false,
		reason: "missing_visual_anchors",
	};
}

const agentsBridgeQueueState: {
	active: number;
	waiters: Array<() => void>;
} = {
	active: 0,
	waiters: [],
};

const nodeFetchDispatcherCache = new Map<number, unknown>();

function readGlobalProcess(): { env?: Record<string, unknown>; versions?: Record<string, unknown> } | null {
	const processRef = (globalThis as typeof globalThis & { process?: unknown }).process;
	if (!isRecord(processRef)) return null;
	return {
		env: isRecord(processRef.env) ? processRef.env : undefined,
		versions: isRecord(processRef.versions) ? processRef.versions : undefined,
	};
}

function readProcessEnvString(key: string): string {
	const value = readGlobalProcess()?.env?.[key];
	return typeof value === "string" ? value : "";
}

function readErrorMessage(err: unknown): string {
	return isRecord(err) ? readTrimmedString(err.message) : "";
}

function readErrorCauseMessage(err: unknown): string {
	if (!isRecord(err) || !isRecord(err.cause)) return "";
	return readTrimmedString(err.cause.message);
}

function readErrorCode(err: unknown): string {
	if (!isRecord(err)) return "";
	const direct = readTrimmedString(err.code);
	if (direct) return direct;
	return isRecord(err.cause) ? readTrimmedString(err.cause.code) : "";
}

function readTaskExtras(request: TaskRequestDto): Record<string, unknown> {
	return isRecord(request.extras) ? request.extras : {};
}

function readAgentsBridgeMaxConcurrency(c: AppContext): number {
	const rawFromEnv =
		typeof c.env.AGENTS_BRIDGE_MAX_CONCURRENCY === "string"
			? c.env.AGENTS_BRIDGE_MAX_CONCURRENCY
			: "";
	const rawFromProcess = readProcessEnvString("AGENTS_BRIDGE_MAX_CONCURRENCY");
	const raw = rawFromEnv || rawFromProcess;
	const n = Number(raw);
	if (Number.isFinite(n) && n > 0) {
		return Math.max(1, Math.min(6, Math.trunc(n)));
	}
	return 1;
}

function toAbortError(signal?: AbortSignal): Error {
	const reason = signal?.reason;
	if (reason instanceof Error) return reason;
	const text = typeof reason === "string" ? reason.trim() : "";
	return new Error(text || "agents_bridge_request_aborted");
}

function throwIfAbortSignalAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw toAbortError(signal);
}

async function waitForAgentsBridgeQueueSlot(signal?: AbortSignal): Promise<void> {
	throwIfAbortSignalAborted(signal);
	await new Promise<void>((resolve, reject) => {
		const wake = () => {
			cleanup();
			resolve();
		};
		const onAbort = () => {
			const index = agentsBridgeQueueState.waiters.indexOf(wake);
			if (index >= 0) {
				agentsBridgeQueueState.waiters.splice(index, 1);
			}
			cleanup();
			reject(toAbortError(signal));
		};
		const cleanup = () => {
			signal?.removeEventListener("abort", onAbort);
		};
		agentsBridgeQueueState.waiters.push(wake);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function createTimedAbortController(timeoutMs: number, externalSignal?: AbortSignal) {
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort(new Error("agents_bridge_timeout"));
	}, timeoutMs);
	const onAbort = () => {
		controller.abort(toAbortError(externalSignal));
	};
	if (externalSignal?.aborted) {
		onAbort();
	} else {
		externalSignal?.addEventListener("abort", onAbort, { once: true });
	}
	return {
		signal: controller.signal,
		cleanup() {
			clearTimeout(timeout);
			externalSignal?.removeEventListener("abort", onAbort);
		},
	};
}

async function runAgentsBridgeQueued<T>(
	c: AppContext,
	task: () => Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	const maxConcurrency = readAgentsBridgeMaxConcurrency(c);
	if (agentsBridgeQueueState.active >= maxConcurrency) {
		await waitForAgentsBridgeQueueSlot(signal);
	}
	throwIfAbortSignalAborted(signal);
	agentsBridgeQueueState.active += 1;
	try {
		return await task();
	} finally {
		agentsBridgeQueueState.active = Math.max(0, agentsBridgeQueueState.active - 1);
		const wake = agentsBridgeQueueState.waiters.shift();
		if (wake) wake();
	}
}

function normalizeAgentsBridgeReferenceImages(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string") continue;
		const trimmed = item.trim();
		if (!trimmed) continue;
		if (!/^https?:\/\//i.test(trimmed)) continue;
		if (trimmed.length > 2048) continue;
		if (seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

function normalizeAgentsBridgeSelectedMediaReferences(value: unknown): AgentsBridgeSelectedMediaReference[] {
	if (!Array.isArray(value)) return [];
	const out: AgentsBridgeSelectedMediaReference[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const obj = item as Record<string, unknown>;
		const rawKind = typeof obj.kind === "string" ? obj.kind.trim().toLowerCase() : "";
		const kind = rawKind === "video" ? "video" : rawKind === "image" ? "image" : null;
		if (!kind) continue;
		const url = typeof obj.url === "string" ? obj.url.trim() : "";
		if (!url || !/^https?:\/\//i.test(url) || url.length > 2048) continue;
		const nodeId =
			typeof obj.nodeId === "string" && obj.nodeId.trim()
				? obj.nodeId.trim().slice(0, 120)
				: "";
		const dedupeKey = `${kind}|${nodeId}|${url}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		const thumbnailUrl =
			typeof obj.thumbnailUrl === "string" &&
			/^https?:\/\//i.test(obj.thumbnailUrl.trim()) &&
			obj.thumbnailUrl.trim().length <= 2048
				? obj.thumbnailUrl.trim()
				: "";
		const label =
			typeof obj.label === "string" && obj.label.trim()
				? obj.label.trim().slice(0, 200)
				: "";
		out.push({
			kind,
			url,
			...(nodeId ? { nodeId } : {}),
			...(thumbnailUrl ? { thumbnailUrl } : {}),
			...(label ? { label } : {}),
		});
		if (out.length >= 24) break;
	}
	return out;
}

function normalizeAgentsBridgeAssetRole(value: unknown): AgentsBridgeAssetRole {
	const role = typeof value === "string" ? value.trim().toLowerCase() : "";
	switch (role) {
		case "target":
		case "reference":
		case "character":
		case "scene":
		case "prop":
		case "product":
		case "style":
		case "context":
		case "mask":
			return role;
		default:
			return "reference";
	}
}

function normalizeAgentsBridgeAssetInputs(value: unknown): AgentsBridgeAssetInput[] {
	if (!Array.isArray(value)) return [];
	const out: AgentsBridgeAssetInput[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const obj = item as Record<string, unknown>;
		const url = typeof obj.url === "string" ? obj.url.trim() : "";
		if (!url || !/^https?:\/\//i.test(url) || url.length > 2048) continue;
		const role = normalizeAgentsBridgeAssetRole(obj.role);
		const dedupeKey = `${role}|${url}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		const assetId =
			typeof obj.assetId === "string" && obj.assetId.trim()
				? obj.assetId.trim().slice(0, 120)
				: "";
		const assetRefId =
			typeof obj.assetRefId === "string" && obj.assetRefId.trim()
				? obj.assetRefId.trim().slice(0, 160)
				: "";
		const note =
			typeof obj.note === "string" && obj.note.trim()
				? obj.note.trim().slice(0, 500)
				: "";
		const name =
			typeof obj.name === "string" && obj.name.trim()
				? obj.name.trim().slice(0, 160)
				: "";
		const weightRaw = Number(obj.weight);
		const weight =
			Number.isFinite(weightRaw) && weightRaw >= 0 && weightRaw <= 1
				? weightRaw
				: undefined;
		out.push({
			...(assetId ? { assetId } : {}),
			...(assetRefId ? { assetRefId } : {}),
			url,
			role,
			...(typeof weight === "number" ? { weight } : {}),
			...(note ? { note } : {}),
			...(name ? { name } : {}),
		});
		if (out.length >= 12) break;
	}
	return out;
}

function normalizeRequiredSkills(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const name = String(item || "").trim();
		if (!name) continue;
		if (name.length > 120) continue;
		if (seen.has(name)) continue;
		seen.add(name);
		out.push(name);
		if (out.length >= 8) break;
	}
	return out;
}

function hasWebHeroRequiredSkill(requiredSkills: string[]): boolean {
	return requiredSkills.some((skill) => {
		const name = skill.trim().toLowerCase();
		return (
			name === "canvas-brand-web-design" ||
			name === "canvas-image-reference-to-code" ||
			name === "canvas-web-design-patterns" ||
			name === "canvas-web-asset-planning" ||
			name.startsWith("canvas-web-")
		);
	});
}

function resolveRequestedMaxTurns(input: {
	requiredSkills: string[];
	forceLocalResourceViaBash: boolean;
}): number | null {
	if (!input.requiredSkills.length) return null;
	if (hasWebHeroRequiredSkill(input.requiredSkills)) return 48;
	if (input.forceLocalResourceViaBash) return 36;
	return 18;
}

function normalizeAgentBridgeModelField(value: unknown): string | null {
	const text = typeof value === "string" ? value.trim() : "";
	if (!text) return null;
	return text.slice(0, 200);
}

function normalizeRoleNameKey(value: string): string {
	return String(value || "").trim().toLowerCase();
}

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}


async function listProjectRoleReferenceAssets(input: {
	userId: string;
	projectId: string;
}): Promise<ProjectRoleReferenceAsset[]> {
	const rows = await listAssetsForUser(getPrismaClient(), input.userId, {
		projectId: input.projectId,
		kind: "projectRoleCard",
		limit: 200,
	});
	return rows
		.map((row) => parseMentionRoleReferenceAsset(row))
		.filter((item): item is ProjectRoleReferenceAsset => item !== null);
}

function isMentionTokenBoundaryChar(char: string): boolean {
	return /[\s,，。；;:：!！?？"'“”‘’()（）\[\]【】{}<>]/.test(char);
}

type PromptMentionToken = {
	raw: string;
	rawDisplay: string;
	mentionKey: string;
	stateKey: string;
	disambiguatorKey: string;
};

function normalizePromptMentionToken(value: string): string {
	return String(value || "")
		.trim()
		.replace(/^@+/, "")
		.replace(/[，。！？、；：,.!?;:)\]】》〉'"`]+$/g, "")
		.toLowerCase();
}

function normalizePromptMentionStateKey(value: string): string {
	return normalizeRoleNameKey(value).replace(/[\s_\-—–/／:：|｜]+/g, "");
}

function splitPromptMentionNameAndState(value: string): {
	namePart: string;
	statePart: string;
} {
	const trimmed = String(value || "").trim();
	if (!trimmed) return { namePart: "", statePart: "" };
	const separators = ["-", "—", "–", "/", "／", ":", "：", "|", "｜"];
	let splitIndex = -1;
	for (const separator of separators) {
		const index = trimmed.lastIndexOf(separator);
		if (index > 0 && index < trimmed.length - 1) {
			splitIndex = Math.max(splitIndex, index);
		}
	}
	if (splitIndex <= 0) return { namePart: trimmed, statePart: "" };
	return {
		namePart: trimmed.slice(0, splitIndex).trim(),
		statePart: trimmed.slice(splitIndex + 1).trim(),
	};
}

function parsePromptMentionToken(rawToken: string): PromptMentionToken | null {
	const cleaned = String(rawToken || "").trim();
	if (!cleaned) return null;
	const normalized = normalizePromptMentionToken(cleaned);
	if (!normalized) return null;
	const [corePart, disambiguatorPart] = normalized.split("#", 2);
	const { namePart, statePart } = splitPromptMentionNameAndState(corePart || "");
	const mentionKey = normalizeRoleNameKey(namePart || "");
	if (!mentionKey) return null;
	return {
		raw: cleaned,
		rawDisplay: cleaned.replace(/^@+/, "@"),
		mentionKey,
		stateKey: normalizePromptMentionStateKey(statePart || ""),
		disambiguatorKey: normalizeRoleNameKey(disambiguatorPart || ""),
	};
}

function extractPromptMentionTokens(prompt: string): PromptMentionToken[] {
	const text = String(prompt || "");
	const out: PromptMentionToken[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] !== "@") continue;
		let end = index + 1;
		while (end < text.length && !isMentionTokenBoundaryChar(text[end] || "")) {
			end += 1;
		}
		const token = parsePromptMentionToken(text.slice(index, end));
		if (!token) continue;
		const dedupeKey = `${token.mentionKey}:${token.stateKey || ""}#${token.disambiguatorKey || ""}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		out.push(token);
	}
	return out;
}

function doesMentionRoleStateMatchQuery(input: {
	queryStateKey: string;
	ageDescription?: string;
	stateDescription?: string;
	stateLabel?: string;
	stateKey?: string;
}): boolean {
	const queryKey = normalizePromptMentionStateKey(input.queryStateKey);
	if (!queryKey) return true;
	const candidates = new Set(
		[
		input.stateKey,
		input.stateLabel,
		input.stateDescription,
		input.ageDescription,
	]
			.map((item) => normalizePromptMentionStateKey(String(item || "")))
			.filter(Boolean),
	);
	if (candidates.size === 0) return false;
	return candidates.has(queryKey);
}

type MentionRoleReferenceAsset = {
	assetId: string;
	cardId: string;
	roleName: string;
	roleNameKey: string;
	roleIdKey: string;
	cardIdKey: string;
	imageUrl: string;
	primaryImageUrl: string | null;
	threeViewImageUrl: string | null;
	ageDescription: string;
	stateDescription: string;
	stateLabel: string;
	stateKey: string;
	chapter?: number;
	chapterStart?: number;
	chapterEnd?: number;
	chapterSpan: number[];
	updatedAtTs: number;
	referenceSource: "role_card" | "semantic_asset";
};

type ProjectRoleReferenceAsset = MentionRoleReferenceAsset;

type MentionVisualReferenceAsset = {
	refId: string;
	category: "scene_prop" | "spell_fx";
	name: string;
	nameKey: string;
	imageUrl: string;
	stateDescription: string;
	chapter?: number;
	chapterStart?: number;
	chapterEnd?: number;
	chapterSpan: number[];
	updatedAtTs: number;
	referenceSource: "visual_ref" | "semantic_asset";
};

type MentionBoundReferenceAsset = {
	assetId: string;
	assetRefId: string;
	assetName: string;
	assetNameKey: string;
	assetIdKey: string;
	assetRefIdKey: string;
	url: string;
	referenceImageUrl: string | null;
	nodeId: string | null;
	source: "flow" | "project_asset";
};

function normalizePositiveReferenceChapter(value: unknown): number | undefined {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
	return Math.trunc(numeric);
}

function normalizeReferenceChapterSpan(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => Number(item))
		.filter((item) => Number.isFinite(item) && item > 0)
		.map((item) => Math.trunc(item));
}

function getReferenceChapterRelevance(
	asset: {
		chapter?: number;
		chapterStart?: number;
		chapterEnd?: number;
		chapterSpan: number[];
	},
	chapter: number | null,
): 0 | 1 | 2 | 3 {
	if (chapter === null) return 3;
	if (asset.chapterSpan.length > 0) {
		if (asset.chapterSpan.includes(chapter)) return 3;
		const maxChapter = Math.max(...asset.chapterSpan);
		if (maxChapter < chapter) return 2;
		return 0;
	}
	if (typeof asset.chapter === "number") {
		if (asset.chapter === chapter) return 3;
		return asset.chapter < chapter ? 2 : 0;
	}
	const start = typeof asset.chapterStart === "number" ? asset.chapterStart : undefined;
	const end = typeof asset.chapterEnd === "number" ? asset.chapterEnd : start;
	if (typeof start === "number" && typeof end === "number") {
		if (chapter >= start && chapter <= end) return 3;
		return end < chapter ? 2 : 0;
	}
	if (typeof start === "number") {
		return chapter >= start ? 3 : 0;
	}
	return 1;
}

function isRoleReferenceApplicableToChapter(
	asset: Pick<MentionRoleReferenceAsset, "chapter" | "chapterStart" | "chapterEnd" | "chapterSpan">,
	chapter: number | null,
): boolean {
	return getReferenceChapterRelevance(asset, chapter) > 0;
}

function sortRoleReferenceAssets(assets: MentionRoleReferenceAsset[], chapter: number | null): MentionRoleReferenceAsset[] {
	return assets.slice().sort((left, right) => {
		const leftCovered = getReferenceChapterRelevance(left, chapter);
		const rightCovered = getReferenceChapterRelevance(right, chapter);
		if (leftCovered !== rightCovered) return rightCovered - leftCovered;
		return right.updatedAtTs - left.updatedAtTs;
	});
}

function readRoleAgeDescription(value: Record<string, unknown>): string {
	const direct = readTrimmedString(value.ageDescription);
	if (direct) return direct;
	const age = readTrimmedString(value.age);
	if (age) return age;
	const ageLabel = readTrimmedString(value.ageLabel);
	if (ageLabel) return ageLabel;
	return "";
}

function readRoleStateLabel(value: Record<string, unknown>): string {
	const direct = readTrimmedString(value.stateLabel);
	if (direct) return direct;
	const currentState = readTrimmedString(value.currentState);
	if (currentState) return currentState;
	const healthStatus = readTrimmedString(value.healthStatus);
	if (healthStatus) return healthStatus;
	const injuryStatus = readTrimmedString(value.injuryStatus);
	if (injuryStatus) return injuryStatus;
	return "";
}

function hasRoleAgeOrStateEvidence(asset: MentionRoleReferenceAsset): boolean {
	return Boolean(
		asset.ageDescription ||
			asset.stateDescription ||
			asset.stateLabel ||
			asset.stateKey,
	);
}

function normalizeSemanticReferenceToken(value: string): string {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 80);
}

function buildSemanticRoleReferenceAssetRefId(
	asset: Pick<
		MentionRoleReferenceAsset,
		"roleName" | "roleNameKey" | "roleIdKey" | "stateKey" | "stateLabel"
	>,
): string {
	const base =
		normalizeSemanticReferenceToken(asset.roleIdKey) ||
		normalizeSemanticReferenceToken(asset.roleNameKey) ||
		normalizeSemanticReferenceToken(asset.roleName) ||
		"role";
	const state =
		normalizeSemanticReferenceToken(asset.stateKey) ||
		normalizeSemanticReferenceToken(asset.stateLabel);
	return [base, state].filter(Boolean).join("_").slice(0, 160);
}

function buildSemanticVisualReferenceAssetRefId(input: {
	role: "scene" | "prop" | "reference";
	name: string;
}): string {
	const rolePrefix = normalizeSemanticReferenceToken(input.role) || "reference";
	const nameToken = normalizeSemanticReferenceToken(input.name) || "anchor";
	return `${rolePrefix}_${nameToken}`.slice(0, 160);
}

function buildRoleReferenceNote(prefix: string, asset: MentionRoleReferenceAsset): string {
	const stateLine = String(asset.stateDescription || "").split("\n").map((item) => item.trim()).find(Boolean) || "";
	const parts = [
		prefix,
		asset.threeViewImageUrl
			? "reference=three_view"
			: asset.referenceSource === "semantic_asset"
				? "reference=semantic_asset"
				: "reference=role_card",
	];
	if (asset.ageDescription) parts.push(`age=${asset.ageDescription}`);
	if (asset.stateLabel) parts.push(`stateLabel=${asset.stateLabel}`);
	if (stateLine) parts.push(`state=${stateLine}`);
	if (asset.stateKey) parts.push(`stateKey=${asset.stateKey}`);
	return parts.filter(Boolean).join(" | ");
}

function buildVisualReferenceNote(prefix: string, asset: MentionVisualReferenceAsset): string {
	const parts = [
		prefix,
		`category=${asset.category}`,
		...(asset.referenceSource === "semantic_asset" ? ["reference=semantic_asset"] : []),
	];
	if (asset.stateDescription) parts.push(`state=${asset.stateDescription}`);
	return parts.filter(Boolean).join(" | ");
}

function buildBoundReferenceNote(asset: MentionBoundReferenceAsset): string {
	const parts = [
		asset.nodeId ? `canvas-node:${asset.nodeId}` : null,
		asset.assetName && asset.assetName !== asset.assetRefId ? asset.assetName : null,
	].filter(Boolean);
	return [`@${asset.assetRefId}`, ...parts].join(" · ");
}

function pickMentionBoundReferenceAsset(
	mention: PromptMentionToken,
	candidates: MentionBoundReferenceAsset[],
): MentionBoundReferenceAsset | "missing" | "ambiguous" {
	if (candidates.length === 0) return "missing";
	if (candidates.length === 1) return candidates[0] || "missing";
	const preferred = candidates.filter(
		(item) =>
			item.assetRefIdKey === mention.mentionKey || item.assetIdKey === mention.mentionKey,
	);
	if (preferred.length === 1) return preferred[0] || "missing";
	return "ambiguous";
}

function pickMentionRoleReferenceAsset(
	mention: PromptMentionToken,
	candidates: MentionRoleReferenceAsset[],
): MentionRoleReferenceAsset | "missing" | "ambiguous" {
	if (candidates.length === 0) return "missing";
	const narrowedByState = mention.stateKey
		? candidates.filter((candidate) =>
				doesMentionRoleStateMatchQuery({
					queryStateKey: mention.stateKey,
					ageDescription: candidate.ageDescription,
					stateDescription: candidate.stateDescription,
					stateLabel: candidate.stateLabel,
					stateKey: candidate.stateKey,
				}),
			)
		: candidates;
	if (narrowedByState.length === 0) return "missing";
	if (!mention.disambiguatorKey) return narrowedByState.length === 1 ? narrowedByState[0]! : "ambiguous";
	const matched =
		narrowedByState.find((item) => item.roleIdKey && item.roleIdKey.startsWith(mention.disambiguatorKey)) ||
		narrowedByState.find((item) => item.cardIdKey && item.cardIdKey.startsWith(mention.disambiguatorKey)) ||
		null;
	return matched || "missing";
}

function parseMentionRoleReferenceAsset(row: AssetRow): MentionRoleReferenceAsset | null {
	const rawData = typeof row.data === "string" ? row.data.trim() : "";
	if (!rawData) return null;
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(rawData);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const obj = parsed as Record<string, unknown>;
	const kind = String(obj.kind || "").trim();
	if (kind !== "projectRoleCard") return null;
	const roleName = String(obj.roleName || "").trim();
	const roleNameKey = normalizeRoleNameKey(String(obj.roleNameKey || roleName));
	const primaryImageUrlRaw = String(obj.imageUrl || "").trim();
	const primaryImageUrl = /^https?:\/\//i.test(primaryImageUrlRaw) ? primaryImageUrlRaw : null;
	const threeViewImageUrlRaw = String(obj.threeViewImageUrl || "").trim();
	const threeViewImageUrl = /^https?:\/\//i.test(threeViewImageUrlRaw) ? threeViewImageUrlRaw : null;
	const imageUrl = threeViewImageUrl || primaryImageUrl;
	if (!roleName || !roleNameKey || !imageUrl) return null;
	const stateDescription = readTrimmedString(obj.stateDescription);
	const stateKey = normalizeRoleNameKey(readTrimmedString(obj.stateKey));
	const ageDescription = readRoleAgeDescription(obj);
	const stateLabel = readRoleStateLabel(obj);
	return {
		assetId: row.id,
		cardId: String(obj.cardId || row.id || "").trim(),
		roleName,
		roleNameKey,
		roleIdKey: normalizeRoleNameKey(String(obj.roleId || "")),
		cardIdKey: normalizeRoleNameKey(String(obj.cardId || row.id || "")),
		imageUrl,
		primaryImageUrl,
		threeViewImageUrl,
		ageDescription,
		stateDescription,
		stateLabel,
		stateKey,
		chapter: normalizePositiveReferenceChapter(obj.chapter),
		chapterStart: normalizePositiveReferenceChapter(obj.chapterStart),
		chapterEnd: normalizePositiveReferenceChapter(obj.chapterEnd),
		chapterSpan: normalizeReferenceChapterSpan(obj.chapterSpan),
		updatedAtTs: (() => {
			const ts = Date.parse(String(obj.updatedAt || row.updated_at || row.created_at || ""));
			return Number.isFinite(ts) ? ts : 0;
		})(),
		referenceSource: "role_card",
	};
}

function parseMentionGenerationAsset(row: AssetRow): MentionBoundReferenceAsset | null {
	const rawData = typeof row.data === "string" ? row.data.trim() : "";
	if (!rawData) return null;
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(rawData);
	} catch {
		return null;
	}
	const obj = asRecord(parsed);
	if (!obj) return null;
	if (readTrimmedString(obj.kind) !== "generation") return null;
	const assetId = readTrimmedString(row.id);
	const assetRefId = (readTrimmedString(obj.assetRefId) || assetId).slice(0, 160);
	const assetRefIdKey = normalizeRoleNameKey(assetRefId);
	const url = readTrimmedString(obj.url);
	if (!assetId || !assetRefIdKey || !url || !/^https?:\/\//i.test(url)) return null;
	const assetName =
		readTrimmedString(obj.assetName) ||
		readTrimmedString(row.name) ||
		assetRefId;
	const thumbnailUrl = readTrimmedString(obj.thumbnailUrl);
	return {
		assetId,
		assetRefId,
		assetName,
		assetNameKey: normalizeRoleNameKey(assetName),
		assetIdKey: normalizeRoleNameKey(assetId),
		assetRefIdKey,
		url,
		referenceImageUrl:
			thumbnailUrl && /^https?:\/\//i.test(thumbnailUrl) ? thumbnailUrl : url,
		nodeId: null,
		source: "project_asset",
	};
}

function collectFlowNodeMentionReferenceAssets(flowData: unknown): MentionBoundReferenceAsset[] {
	const graph = asRecord(flowData);
	const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
	const out: MentionBoundReferenceAsset[] = [];
	for (const rawNode of nodes) {
		const node = asRecord(rawNode);
		if (!node) continue;
		const nodeId = readTrimmedString(node.id) || null;
		const data = asRecord(node.data) || {};
		const nodeLabel = readTrimmedString(data.label) || nodeId || "asset";
		const rootAssetId = readTrimmedString(data.assetId);
		const rootAssetRefId = readTrimmedString(data.assetRefId);
		const pushAsset = (item: unknown) => {
			const record = asRecord(item);
			if (!record) return;
			const url = readTrimmedString(record.url);
			if (!url || !/^https?:\/\//i.test(url)) return;
			const assetId = readTrimmedString(record.assetId) || rootAssetId;
			const assetRefId = (
				readTrimmedString(record.assetRefId) ||
				rootAssetRefId ||
				assetId
			).slice(0, 160);
			const assetRefIdKey = normalizeRoleNameKey(assetRefId);
			if (!assetId || !assetRefIdKey) return;
			const assetName =
				readTrimmedString(record.assetName) ||
				readTrimmedString(record.title) ||
				nodeLabel;
			const thumbnailUrl = readTrimmedString(record.thumbnailUrl);
			out.push({
				assetId,
				assetRefId,
				assetName,
				assetNameKey: normalizeRoleNameKey(assetName),
				assetIdKey: normalizeRoleNameKey(assetId),
				assetRefIdKey,
				url,
				referenceImageUrl:
					thumbnailUrl && /^https?:\/\//i.test(thumbnailUrl) ? thumbnailUrl : url,
				nodeId,
				source: "flow",
			});
		};
		const imageResults = Array.isArray(data.imageResults) ? data.imageResults : [];
		for (const item of imageResults) pushAsset(item);
		const videoResults = Array.isArray(data.videoResults) ? data.videoResults : [];
		for (const item of videoResults) pushAsset(item);
		if (imageResults.length === 0 && videoResults.length === 0) {
			const fallbackUrl = readTrimmedString(data.imageUrl) || readTrimmedString(data.videoUrl);
			if (fallbackUrl) {
				pushAsset({
					url: fallbackUrl,
					thumbnailUrl: readTrimmedString(data.videoThumbnailUrl) || undefined,
					assetId: rootAssetId || undefined,
					assetRefId: rootAssetRefId || undefined,
					assetName: nodeLabel,
					title: nodeLabel,
				});
			}
		}
	}
	return out;
}

function buildBoundReferenceAssetLookup(
	assets: MentionBoundReferenceAsset[],
): Map<string, MentionBoundReferenceAsset[]> {
	const lookup = new Map<string, MentionBoundReferenceAsset[]>();
	for (const item of assets) {
		for (const key of [item.assetRefIdKey, item.assetIdKey, item.assetNameKey]) {
			if (!key) continue;
			const list = lookup.get(key) || [];
			list.push(item);
			lookup.set(key, list);
		}
	}
	return lookup;
}

async function resolveMentionBoundAssetInputs(input: {
	userId: string;
	projectId: string;
	canvasFlowId?: string | null;
	prompt: string;
	existingAssetInputs: AgentsBridgeAssetInput[];
}): Promise<{
	mentions: string[];
	matched: MentionBoundReferenceAsset[];
	missing: string[];
	ambiguous: string[];
	assetInputs: AgentsBridgeAssetInput[];
	referenceImages: string[];
	resolvedMentionKeys: string[];
}> {
	const mentions = extractPromptMentionTokens(input.prompt);
	if (!input.userId || !input.projectId || mentions.length === 0) {
		return {
			mentions: mentions.map((item) => item.rawDisplay),
			matched: [],
			missing: [],
			ambiguous: [],
			assetInputs: [],
			referenceImages: [],
			resolvedMentionKeys: [],
		};
	}
	const assets: MentionBoundReferenceAsset[] = [];
	if (input.canvasFlowId) {
		const flow = await getFlowForOwner(
			getPrismaClient(),
			input.canvasFlowId,
			input.userId,
		);
		if (flow?.data) {
			try {
				assets.push(...collectFlowNodeMentionReferenceAssets(JSON.parse(flow.data)));
			} catch {
				// malformed flow payload should not block mention resolution
			}
		}
	}
	const rows = await listAssetsForUser(getPrismaClient(), input.userId, {
		projectId: input.projectId,
		kind: "generation",
		limit: 200,
	});
	assets.push(
		...rows
			.map((row) => parseMentionGenerationAsset(row))
			.filter((item): item is MentionBoundReferenceAsset => item !== null),
	);
	const lookup = buildBoundReferenceAssetLookup(assets);
	const matched: MentionBoundReferenceAsset[] = [];
	const missing: string[] = [];
	const ambiguous: string[] = [];
	const resolvedMentionKeys: string[] = [];
	for (const mention of mentions) {
		const picked = pickMentionBoundReferenceAsset(
			mention,
			lookup.get(mention.mentionKey) || [],
		);
		if (picked === "missing") {
			missing.push(mention.rawDisplay);
			continue;
		}
		if (picked === "ambiguous") {
			ambiguous.push(mention.rawDisplay);
			continue;
		}
		matched.push(picked);
		resolvedMentionKeys.push(mention.mentionKey);
	}
	const existingKeys = new Set(
		input.existingAssetInputs.map(
			(item) =>
				`${item.role}|${String(item.assetId || "").trim()}|${String(item.assetRefId || "").trim()}|${item.url}`,
		),
	);
	const assetInputs: AgentsBridgeAssetInput[] = [];
	const referenceImages: string[] = [];
	const seenReferenceImages = new Set<string>();
	for (const item of matched) {
		const referenceImageUrl = item.referenceImageUrl || item.url;
		const dedupeKey = `reference|${item.assetId}|${item.assetRefId}|${item.url}`;
		if (!existingKeys.has(dedupeKey)) {
			assetInputs.push({
				assetId: item.assetId,
				assetRefId: item.assetRefId,
				url: item.url,
				role: "reference",
				note: buildBoundReferenceNote(item),
				name: item.assetName,
			});
		}
		if (referenceImageUrl && !seenReferenceImages.has(referenceImageUrl)) {
			seenReferenceImages.add(referenceImageUrl);
			referenceImages.push(referenceImageUrl);
		}
		if (assetInputs.length >= 6 && referenceImages.length >= 6) break;
	}
	return {
		mentions: mentions.map((item) => item.rawDisplay),
		matched,
		missing,
		ambiguous,
		assetInputs,
		referenceImages,
		resolvedMentionKeys,
	};
}

async function resolveMentionRoleAssetInputs(input: {
	userId: string;
	projectId: string;
	prompt: string;
	existingAssetInputs: AgentsBridgeAssetInput[];
	skipMentionKeys?: string[];
}): Promise<{
	mentions: string[];
	matched: MentionRoleReferenceAsset[];
	missing: string[];
	ambiguous: string[];
	assetInputs: AgentsBridgeAssetInput[];
	referenceImages: string[];
}> {
	const mentions = extractPromptMentionTokens(input.prompt);
	const skipMentionKeys = new Set(
		(input.skipMentionKeys || []).map((item) => normalizeRoleNameKey(item)),
	);
	const pendingMentions = mentions.filter(
		(item) => !skipMentionKeys.has(item.mentionKey),
	);
	if (!input.userId || !input.projectId || pendingMentions.length === 0) {
		return { mentions: pendingMentions.map((item) => item.rawDisplay), matched: [], missing: [], ambiguous: [], assetInputs: [], referenceImages: [] };
	}
	const rows = await listAssetsForUser(getPrismaClient(), input.userId, {
		projectId: input.projectId,
		kind: "projectRoleCard",
		limit: 200,
	});
	const roleAssets = rows
		.map((row) => parseMentionRoleReferenceAsset(row))
		.filter((item): item is MentionRoleReferenceAsset => item !== null);
	const roleAssetMap = new Map<string, MentionRoleReferenceAsset[]>();
	for (const item of roleAssets) {
		const list = roleAssetMap.get(item.roleNameKey) || [];
		list.push(item);
		roleAssetMap.set(item.roleNameKey, list);
	}
	const matched: MentionRoleReferenceAsset[] = [];
	const missing: string[] = [];
	const ambiguous: string[] = [];
	for (const mention of pendingMentions) {
		const picked = pickMentionRoleReferenceAsset(
			mention,
			sortRoleReferenceAssets(roleAssetMap.get(mention.mentionKey) || [], null),
		);
		if (picked === "missing") {
			missing.push(mention.rawDisplay);
			continue;
		}
		if (picked === "ambiguous") {
			ambiguous.push(mention.rawDisplay);
			continue;
		}
		matched.push(picked);
	}
	const existingKeys = new Set(
		input.existingAssetInputs.map(
			(item) =>
				`${item.role}|${String(item.assetId || "").trim()}|${String(item.assetRefId || "").trim()}|${item.url}`,
		),
	);
	const assetInputs: AgentsBridgeAssetInput[] = [];
	const referenceImages: string[] = [];
	const seenUrls = new Set<string>();
	for (const item of matched) {
		const dedupeKey = `character|${item.assetId}|${item.imageUrl}`;
		if (!existingKeys.has(dedupeKey)) {
			assetInputs.push({
				assetId: item.assetId,
				assetRefId: buildSemanticRoleReferenceAssetRefId(item),
				url: item.imageUrl,
				role: "character",
				note: buildRoleReferenceNote(`@${item.roleName}`, item),
				name: item.roleName,
			});
		}
		if (!seenUrls.has(item.imageUrl)) {
			seenUrls.add(item.imageUrl);
			referenceImages.push(item.imageUrl);
		}
		if (assetInputs.length >= 4 && referenceImages.length >= 4) break;
	}
	return {
		mentions: pendingMentions.map((item) => item.rawDisplay),
		matched,
		missing,
		ambiguous,
		assetInputs,
		referenceImages,
	};
}

function readRequestHeader(c: AppContext, key: string): string {
	const v = c.req.header(key);
	return typeof v === "string" ? v.trim() : "";
}

function resolveEffectiveUserId(c: AppContext, inputUserId: string): string {
	const direct = String(inputUserId || "").trim();
	if (direct) return direct;
	const fromCtxUserId = String(c.get("userId") || "").trim();
	if (fromCtxUserId) return fromCtxUserId;
	const fromCtxApiKeyOwnerId = String(c.get("apiKeyOwnerId") || "").trim();
	if (fromCtxApiKeyOwnerId) return fromCtxApiKeyOwnerId;
	const fromHeader =
		readRequestHeader(c, "x-agents-user-id") ||
		readRequestHeader(c, "x-user-id") ||
		readRequestHeader(c, "x-api-key-owner-id");
	return fromHeader;
}

function sanitizePathSegmentForAgents(raw: string): string {
	return String(raw || "")
		.trim()
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.slice(0, 120);
}

function normalizeLocalResourcePathForAgents(value: string): string | null {
	const raw = String(value || "").trim();
	if (!raw) return null;
	return raw.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

type CharacterContinuityNote = {
	age: string;
	state: string;
	stateLabel: string;
	stateKey: string;
};

function parseCharacterContinuityNote(note: string): CharacterContinuityNote {
	const parsed: CharacterContinuityNote = {
		age: "",
		state: "",
		stateLabel: "",
		stateKey: "",
	};
	for (const segment of String(note || "").split("|")) {
		const item = segment.trim();
		if (!item) continue;
		if (item.startsWith("age=")) {
			parsed.age = item.slice("age=".length).trim();
			continue;
		}
		if (item.startsWith("state=")) {
			parsed.state = item.slice("state=".length).trim();
			continue;
		}
		if (item.startsWith("stateLabel=")) {
			parsed.stateLabel = item.slice("stateLabel=".length).trim();
			continue;
		}
		if (item.startsWith("stateKey=")) {
			parsed.stateKey = item.slice("stateKey=".length).trim();
			continue;
		}
	}
	return parsed;
}

function collectCharacterContinuityPromptLines(assetInputs: AgentsBridgeAssetInput[]): string[] {
	const lines: string[] = [];
	const seen = new Set<string>();
	for (const item of assetInputs) {
		if (item.role !== "character") continue;
		const parsed = parseCharacterContinuityNote(String(item.note || ""));
		const roleName = String(item.name || item.assetRefId || item.assetId || item.url || "角色").trim();
		const ageLine = parsed.age ? `- ${roleName} 年龄锚点：${parsed.age}` : "";
		const stateParts = [parsed.stateLabel, parsed.state].filter(Boolean);
		const stateLine =
			stateParts.length > 0
				? `- ${roleName} 状态锚点：${stateParts.join("；")}${
						parsed.stateKey ? `（stateKey=${parsed.stateKey}）` : ""
				  }`
				: "";
		for (const line of [ageLine, stateLine]) {
			if (!line || seen.has(line)) continue;
			seen.add(line);
			lines.push(line);
		}
	}
	return lines;
}

const RUNTIME_REFERENCE_CONTEXT_START_TAG = "<canvas_runtime_reference_context>";
const RUNTIME_REFERENCE_CONTEXT_END_TAG = "</canvas_runtime_reference_context>";

function decoratePromptWithReferenceImages(
	prompt: string,
	referenceImages: string[],
	assetInputs: AgentsBridgeAssetInput[],
	referenceImageSlots: AgentsBridgeReferenceImageSlot[],
	selectedMediaReferences: AgentsBridgeSelectedMediaReference[],
	selectedReference: AgentsBridgeChatContext["selectedReference"],
	options?: {
		suppressProductIntegrity?: boolean;
	},
): string {
	const base = typeof prompt === "string" ? prompt : "";
	if (!referenceImages.length && !assetInputs.length && !selectedMediaReferences.length) return base;
	if (base.includes(RUNTIME_REFERENCE_CONTEXT_START_TAG)) return base;
	const hasCharacterReference = assetInputs.some((item) => item.role === "character");
	const hasSubjectIntegrityReference = assetInputs.some(
		(item) => item.role === "product" || item.role === "target" || item.role === "reference",
	);
	const hasEnvironmentReference = assetInputs.some(
		(item) => item.role === "scene" || item.role === "prop" || item.role === "context",
	);
	const characterContinuityLines = collectCharacterContinuityPromptLines(assetInputs);
	const suppressProductIntegrity = options?.suppressProductIntegrity === true;
	const blocks: string[] = [];
	if (selectedMediaReferences.length) {
		blocks.push(
			"【选中媒体引用】",
			...selectedMediaReferences.map((item, idx) => {
				const parts = [
					`#${idx + 1}`,
					`kind=${item.kind}`,
					`url=${item.url}`,
					item.nodeId ? `nodeId=${item.nodeId}` : "",
					item.thumbnailUrl ? `thumbnailUrl=${item.thumbnailUrl}` : "",
					item.label ? `label=${item.label}` : "",
				].filter(Boolean);
				return `- ${parts.join(" | ")}`;
			}),
			"",
			"【选中媒体引用约束】",
			"- selectedMediaReferences 来自用户当前在画布/聊天框显式选择的真实媒体。",
			"- kind=video 的 url 是视频文件，只能作为视频证据或视频操作输入，不得当作 referenceImages 图片 URL。",
			"- 若要新建 image_to_video 任务，仍必须提供真实参考图片 URL；已有视频 URL 不能替代首帧/参考图前置资产。",
			"",
		);
	}
	if (assetInputs.length) {
		blocks.push(
			"【资产输入】",
			...assetInputs.map((item, idx) => {
				const parts = [
					`#${idx + 1}`,
					`role=${item.role}`,
					`url=${item.url}`,
					item.assetId ? `assetId=${item.assetId}` : "",
					typeof item.weight === "number" ? `weight=${item.weight}` : "",
					item.name ? `name=${item.name}` : "",
					item.note ? `note=${item.note}` : "",
				].filter(Boolean);
				return `- ${parts.join(" | ")}`;
			}),
			"",
		);
	}
	if (referenceImageSlots.length) {
		blocks.push(
			"【参考图图位协议】",
			"- 对第三方图片/视频模型，参考图的有效语义是图位顺序，不是字段名 `referenceImages` 本身。",
			...(referenceImageSlots.length > 2
				? [
					"- 当前参考资产超过 2 张时，执行层会先把它们合成为一张带右下角资产 id/名字标记的拼图参考板。",
					"- 这种情况下，最终执行 prompt 不要再逐张写 `图1/图2/图3` 职责分配，而要按资产 id / 名称引用，例如 `@li_changan`、`@night_market`。",
				]
				: [
					"- 参考资产不超过 2 张时，你在最终执行 prompt 里必须显式使用 `图1`、`图2` 这种图位编号来引用这些参考图。",
					"- 若不同参考图承担不同职责，必须按图位写清楚，例如“人物外观严格参考图1，场景与光线延续图2”。",
				]),
			"",
		);
	}
	if (referenceImageSlots.length) {
		blocks.push(
			"【参考图图位清单】",
			...referenceImageSlots.map((slot) => {
				const parts = [slot.slot, `url=${slot.url}`];
				if (slot.role) parts.push(`role=${slot.role}`);
				if (slot.label) parts.push(`label=${slot.label}`);
				if (slot.note) parts.push(`note=${slot.note}`);
				return `- ${parts.join(" | ")}`;
			}),
			"",
		);
	} else if (referenceImages.length) {
		blocks.push("【参考图】", ...referenceImages.map((url) => `- ${url}`), "");
	}
	if (hasCharacterReference) {
		blocks.push(
			"【角色参考一致性约束】",
			"- 角色参考图锁定角色身份：脸型、发型、服装主轮廓、配色与可识别特征必须保持一致。",
			"- 允许调整景别、机位、光线与动作，但不得把同一角色改成另一张脸或另一套核心服设。",
			"- 多角色同场时，必须维持各角色之间的体型、站位关系与主次关系，不得串脸。",
			"- 若文字描述与角色参考图冲突，以角色参考图中的身份锚点为准。",
		);
	}
	if (hasSubjectIntegrityReference && !suppressProductIntegrity) {
		blocks.push(
			"【参考主体保真硬约束】",
			"- 参考图中的主体对象必须保持同一对象：外轮廓、比例、结构、关键开孔/按键/接口位置不可改变。",
			"- 保持完整主体，不得裁掉关键部件；禁止只保留局部导致主体信息不完整。",
			"- 保持主材质与颜色一致（允许正常光照变化，不允许改色改材质）。",
			"- 允许改变背景、道具与模特姿态，但主体对象不得被重绘成不同款式。",
			"- 若参考图本身是纯净背景主体图，优先保留主体边界清晰、无形变、无遮挡。",
		);
	} else if (hasEnvironmentReference) {
		blocks.push(
			"【场景与道具连续性约束】",
			"- 场景参考图锁定空间结构、地标、主光方向与环境材质，不得无因跳场景。",
			"- 道具参考图锁定材质、比例、关键结构与摆放关系，不得替换成另一件相似但不同的物件。",
			"- 当角色参考与场景/道具参考同时存在时，必须同时保持人物身份和环境连续性，不能只保留其中一半。",
		);
		} else if (!hasCharacterReference && suppressProductIntegrity) {
			blocks.push(
				"【视觉参考使用约束】",
				"- 当前参考图仅作为视觉锚点与连续性证据，不自动等同于既有图主体替换任务。",
				"- 若任务绑定视频节点等 project-scoped 创作上下文，应优先服从当前画布目标与真实参考输入。",
				"- 仅当用户明确要求复刻/替换既有图主体时，才把版式保留与主体替换视为主目标。",
			);
	}
	if (characterContinuityLines.length > 0) {
			blocks.push(
				"【角色年龄与状态连续性约束】",
				...characterContinuityLines,
				"- 若需要从“重伤/濒死”转为“恢复/无伤”，必须在 continuityConstraints 明确恢复原因与时间跨度。",
				"",
			);
	}
	const identityLines: string[] = [];
	if (selectedReference?.roleName?.trim()) {
		identityLines.push(`- 当前已明确绑定角色：${selectedReference.roleName.trim()}。最终执行 prompt 不得退回“默认少年/默认人物/未命名角色”。`);
	}
		if (selectedReference?.roleCardId?.trim()) {
			identityLines.push(`- 当前已明确绑定角色卡：${selectedReference.roleCardId.trim()}。若创建执行节点，必须把该角色绑定以 referenceImages 或真实连边保留下来。`);
		}
		if (identityLines.length > 0) {
		blocks.push("【身份锁定】", ...identityLines, "");
	}
	const runtimeReferenceContext = [
		RUNTIME_REFERENCE_CONTEXT_START_TAG,
		...blocks,
		RUNTIME_REFERENCE_CONTEXT_END_TAG,
	].join("\n");
	return [runtimeReferenceContext, base].filter(Boolean).join("\n\n");
}

export function readAgentsBridgeBaseUrl(c: AppContext): string {
	const rawFromEnv =
		typeof c.env.AGENTS_BRIDGE_BASE_URL === "string"
			? c.env.AGENTS_BRIDGE_BASE_URL
			: "";
	const rawFromProcess = readProcessEnvString("AGENTS_BRIDGE_BASE_URL");
	const raw = rawFromEnv || rawFromProcess;
	return raw.trim().replace(/\/+$/, "");
}

export function readCanvasApiBaseFromEnv(c: AppContext): string {
	const rawInternal = readBrandedEnv(c.env, "API_INTERNAL_BASE");
	const rawBase =
		typeof c.env.CANVAS_API_BASE_URL === "string"
			? c.env.CANVAS_API_BASE_URL
			: "";
	const rawProcessInternal = readBrandedProcessEnv("API_INTERNAL_BASE");
	const rawProcessBase = readProcessEnvString("CANVAS_API_BASE_URL");
	const raw = rawInternal || rawBase || rawProcessInternal || rawProcessBase;
	return raw.trim().replace(/\/+$/, "");
}

export function buildAgentsBridgeRemoteTools(input: {
	publicAgentsRequest: boolean;
	canvasProjectId: string | null;
	canvasFlowId: string | null;
}): AgentsBridgeRemoteToolDefinition[] {
	return buildCanvasAgentRemoteTools(input);
}

function buildPublicAgentsAllowedTools(
	remoteTools: readonly AgentsBridgeRemoteToolDefinition[],
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const name of PUBLIC_AGENTS_LOCAL_ALLOWED_TOOLS) {
		if (isPublicAgentsRootDeniedTool(name)) continue;
		if (seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	for (const tool of remoteTools) {
		const name = typeof tool.name === "string" ? tool.name.trim() : "";
		if (isPublicAgentsRootDeniedTool(name)) continue;
		if (!name || seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out;
}

function isNodeRuntime(): boolean {
	return typeof readGlobalProcess()?.versions?.node === "string";
}

function isConnRefusedError(err: unknown): boolean {
	const msg = readErrorMessage(err);
	const cause = readErrorCauseMessage(err);
	const combined = `${msg}\n${cause}`.toLowerCase();
	return combined.includes("econnrefused") || combined.includes("connect refused");
}

function readBoolEnvFlag(value: unknown): boolean {
	const v = String(value ?? "")
		.trim()
		.toLowerCase();
	return v === "1" || v === "true" || v === "yes" || v === "on";
}

function readAgentsBridgeDebugLog(c: AppContext): boolean {
	const fromEnv = readBoolEnvFlag(c.env.AGENTS_BRIDGE_DEBUG_LOG);
	if (fromEnv) return true;
	return readBoolEnvFlag(readProcessEnvString("AGENTS_BRIDGE_DEBUG_LOG"));
}

function shouldDropOnHeadersTimeout(c: AppContext, request: TaskRequestDto): boolean {
	const extras = readTaskExtras(request);
	if (typeof extras?.bridgeDropOnTimeout === "boolean") return extras.bridgeDropOnTimeout;
	const fromEnv = readBoolEnvFlag(c.env.AGENTS_BRIDGE_DROP_ON_TIMEOUT);
	if (fromEnv) return true;
	const fromProcess = readProcessEnvString("AGENTS_BRIDGE_DROP_ON_TIMEOUT");
	if (fromProcess) return readBoolEnvFlag(fromProcess);
	// Default on: timeout-drop avoids whole request failure in long multi-tool runs.
	return true;
}

function isHeadersTimeoutError(err: unknown): boolean {
	const msg = readErrorMessage(err);
	const causeMsg = readErrorCauseMessage(err);
	const code = readErrorCode(err);
	const combined = `${msg}\n${causeMsg}`.toLowerCase();
	return (
		combined.includes("headers timeout") ||
		combined.includes("und_err_headers_timeout") ||
		code === "UND_ERR_HEADERS_TIMEOUT"
	);
}

async function createNodeFetchDispatcher(timeoutMs: number): Promise<unknown | null> {
	if (!isNodeRuntime()) return null;
	const key = Math.max(5_000, Math.floor(timeoutMs));
	if (nodeFetchDispatcherCache.has(key)) {
		return nodeFetchDispatcherCache.get(key) || null;
	}
	try {
		const undici = await import("undici");
		if (!undici?.Agent) return null;
		const dispatcher = new undici.Agent({
			headersTimeout: key + 15_000,
			bodyTimeout: key + 15_000,
		});
		nodeFetchDispatcherCache.set(key, dispatcher);
		return dispatcher;
	} catch {
		return null;
	}
}

function truncateForDebugLog(input: unknown, maxChars = 1200): string {
	const text =
		input && typeof input === "object"
			? (() => {
					try {
						return JSON.stringify(input);
					} catch {
						return String(input);
					}
				})()
			: String(input ?? "");
	if (!text) return "";
	return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export async function maybeStartAgentsBridgeOnDemand(c: AppContext): Promise<string> {
	if (!isNodeRuntime()) return readAgentsBridgeBaseUrl(c);
	try {
		const mod = await import("../../platform/node/agents-bridge-autostart");
		if (typeof mod?.maybeAutostartAgentsBridge === "function") {
			await mod.maybeAutostartAgentsBridge();
		}
		const processBase = readProcessEnvString("AGENTS_BRIDGE_BASE_URL").trim();
		if (processBase) {
			c.env.AGENTS_BRIDGE_BASE_URL = processBase;
		}
	} catch {
		// best effort: caller will fallback to existing error handling
	}
	return readAgentsBridgeBaseUrl(c);
}

export function readAgentsBridgeToken(c: AppContext): string | null {
	const raw =
		typeof c.env.AGENTS_BRIDGE_TOKEN === "string" ? c.env.AGENTS_BRIDGE_TOKEN : "";
	const trimmed = raw.trim();
	return trimmed ? trimmed : null;
}

export function readAgentsBridgeTimeoutMs(c: AppContext): number {
	const raw =
		typeof c.env.AGENTS_BRIDGE_TIMEOUT_MS === "string"
			? c.env.AGENTS_BRIDGE_TIMEOUT_MS
			: "";
	const n = Number(raw);
	if (Number.isFinite(n) && n > 0) {
		return Math.max(
			AGENTS_BRIDGE_MIN_TIMEOUT_MS,
			Math.min(AGENTS_BRIDGE_MAX_TIMEOUT_MS, Math.floor(n)),
		);
	}
	return AGENTS_BRIDGE_DEFAULT_TIMEOUT_MS;
}

function readTimeoutFromRequestExtras(request: TaskRequestDto): number | null {
	const extras = isRecord(request.extras) ? request.extras : null;
	const raw = extras?.bridgeTimeoutMs;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return null;
	return Math.max(
		AGENTS_BRIDGE_MIN_TIMEOUT_MS,
		Math.min(AGENTS_BRIDGE_MAX_TIMEOUT_MS, Math.floor(n)),
	);
}

async function readResponseTextSafe(res: Response, limit = 4096): Promise<string> {
	try {
		const text = await res.text();
		return text.length > limit ? `${text.slice(0, limit)}…` : text;
	} catch {
		return "";
	}
}

export function isAgentsBridgeEnabled(c: AppContext): boolean {
	return !!readAgentsBridgeBaseUrl(c);
}

function isPublicAgentsRequest(c: AppContext): boolean {
	return c.get("publicApi") === true;
}

function assertPublicAgentsRequestSafe(
	input: {
		forceLocalResourceViaBash: boolean;
		localResourcePaths: string[];
		requiredSkills: string[];
	},
): void {
	void input;
}

export async function runAgentsBridgeChatTask(
	c: AppContext,
	userId: string,
	request: TaskRequestDto,
	options?: {
		onStreamEvent?: AgentsBridgeStreamObserver;
		onAskUserDetected?: (prompt: AgentsBridgeAskUserPrompt) => void | Promise<void>;
		abortSignal?: AbortSignal;
		publicChatRunId?: string;
	},
): Promise<TaskResultDto> {
	const effectiveUserId = resolveEffectiveUserId(c, userId);
	if (!effectiveUserId) {
		throw new AppError("Unauthorized: missing userId for agents bridge", {
			status: 401,
			code: "unauthorized",
		});
	}

	let baseUrl = readAgentsBridgeBaseUrl(c);
	if (!baseUrl) {
		baseUrl = await maybeStartAgentsBridgeOnDemand(c);
	}
	if (!baseUrl) {
		throw new AppError("Agents bridge 未配置（缺少 AGENTS_BRIDGE_BASE_URL）", {
			status: 400,
			code: "agents_bridge_not_configured",
		});
	}

	if (request.kind !== "chat" && request.kind !== "prompt_refine") {
		throw new AppError("Agents bridge 仅支持 chat/prompt_refine", {
			status: 400,
			code: "invalid_task_kind",
			details: { vendor: "agents", kind: request.kind },
		});
	}

	const extras = readTaskExtras(request);
	const requestedSystemPrompt =
		typeof extras.systemPrompt === "string" && extras.systemPrompt.trim()
			? extras.systemPrompt.trim()
			: "";
	const chatContext = normalizeAgentsBridgeChatContext(extras.chatContext);
	const canvasProjectId = readTrimmedString(extras.canvasProjectId);
	const requestedCanvasFlowId = readTrimmedString(extras.canvasFlowId);
	let canvasFlowId = requestedCanvasFlowId;
	const publicAgentsRequest = isPublicAgentsRequest(c);
	const canvasNodeId = readTrimmedString(extras.canvasNodeId);
	const requestedSessionKey = typeof extras.sessionKey === "string" ? String(extras.sessionKey).trim() : "";
	const publicChatRunId =
		typeof options?.publicChatRunId === "string" && options.publicChatRunId.trim()
			? options.publicChatRunId.trim()
			: "";
	if (publicAgentsRequest && canvasProjectId && !canvasFlowId) {
		const candidateFlows = await listFlowsByOwner(c.env.DB, effectiveUserId, canvasProjectId);
		const resolvedFlowId =
			Array.isArray(candidateFlows) && candidateFlows.length > 0 && typeof candidateFlows[0]?.id === "string"
				? candidateFlows[0].id.trim()
				: "";
		if (resolvedFlowId) {
			canvasFlowId = resolvedFlowId;
		}
	}
	// Public agents chat without canvas context leaves agents-cli without remote
	// canvas tools. Fail loudly instead of silently downgrading to plain chat.
	if (publicAgentsRequest && !canvasProjectId && !canvasFlowId) {
		throw new AppError(
				"JarvisHub 对话未绑定 canvas context：缺少 canvasProjectId/canvasFlowId，Agent 将无法调用画布工具（flow_patch / image / video / evaluate）。请在发起 /public/agents/chat 时通过 extras.canvasProjectId 或 extras.canvasFlowId 绑定当前画布。",
			{
				status: 400,
				code: "agents_chat_missing_canvas_context",
				details: {
					userId: effectiveUserId,
					hint: "extras.canvasProjectId and/or extras.canvasFlowId required for canvas-capable agent turns",
				},
			},
		);
	}
	if (publicAgentsRequest && canvasProjectId && !canvasFlowId) {
		throw new AppError(
			"JarvisHub 对话绑定了项目但未能解析出任何 flow：Agent 将无法进行画布级写操作（flow_patch / video / evaluate）。请先在该项目下创建 flow，或通过 extras.canvasFlowId 直接绑定已有 flow。",
			{
				status: 409,
				code: "agents_chat_project_has_no_flow",
				details: {
					userId: effectiveUserId,
					canvasProjectId,
				},
				},
			);
		}
		const sessionKey = requestedSessionKey;
	const diagnosticsLabel =
		typeof extras.diagnosticsLabel === "string" ? String(extras.diagnosticsLabel).trim() : "";
	const planOnly = extras.planOnly === true;
	const forceAssetGeneration = extras.forceAssetGeneration === true;
	const parsedGenerationContract = parseGenerationContract((extras as Record<string, unknown>).generationContract);
	if (!parsedGenerationContract.ok) {
		throw new AppError(`generationContract 无效: ${parsedGenerationContract.error}`, {
			status: 400,
			code: "invalid_generation_contract",
		});
	}
	const generationContract: GenerationContract | null = parsedGenerationContract.value;
	const mode =
		typeof (extras as Record<string, unknown>).mode === "string" &&
		String((extras as Record<string, unknown>).mode).trim().toLowerCase() === "auto"
			? "auto"
			: "chat";
	const responseFormat =
		typeof (extras as Record<string, unknown>).responseFormat !== "undefined"
			? (extras as Record<string, unknown>).responseFormat
			: typeof (extras as Record<string, unknown>).response_format !== "undefined"
				? (extras as Record<string, unknown>).response_format
				: undefined;
	if (publicAgentsRequest && canvasProjectId && canvasFlowId) {
		const flow = await getFlowForOwner(c.env.DB, canvasFlowId, effectiveUserId);
		if (!flow || flow.project_id !== canvasProjectId) {
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
				details: {
					canvasProjectId,
					canvasFlowId,
					userId: effectiveUserId,
				},
			});
		}
	}
		const effectiveChatContext = chatContext;
	const explicitLocalResourcePathsRaw = Array.isArray(extras.localResourcePaths)
		? extras.localResourcePaths
				.map((x) => String(x || "").trim())
				.filter(Boolean)
				.slice(0, 12)
		: [];
	const extrasReferenceImages = extras.referenceImages;
	const extrasAssetInputs = extras.assetInputs;
	const hasReferenceImages =
		Array.isArray(extrasReferenceImages) &&
		extrasReferenceImages.some((item: unknown) => String(item || "").trim().length > 0);
	const hasAssetInputs =
		Array.isArray(extrasAssetInputs) &&
		extrasAssetInputs.some((item: unknown) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) return false;
			return String((item as { url?: unknown }).url || "").trim().length > 0;
		});
	const forceLocalResourceViaBash = Boolean(extras.forceLocalResourceViaBash);
	const localResourcePathsRaw = [...explicitLocalResourcePathsRaw].slice(0, 12);
	const localResourcePaths = localResourcePathsRaw
		.map((x) => normalizeLocalResourcePathForAgents(x))
		.filter((x): x is string => Boolean(x));
	if (
		forceLocalResourceViaBash &&
		localResourcePathsRaw.length > 0 &&
		localResourcePaths.length !== localResourcePathsRaw.length
	) {
		throw new AppError("本地资源路径无效：路径不能为空", {
			status: 400,
			code: "invalid_local_resource_paths",
			details: {
				raw: localResourcePathsRaw,
				normalized: localResourcePaths,
			},
		});
	}
	const explicitAllowedSubagentTypes = Array.isArray(extras.allowedSubagentTypes)
		? extras.allowedSubagentTypes
				.map((item) => String(item || "").trim())
				.filter(Boolean)
				.slice(0, 12)
		: [];
	const requiredSkills = normalizeRequiredSkills(extras.requiredSkills);
	const allowedSubagentTypes = explicitAllowedSubagentTypes;
	if (publicAgentsRequest) {
		assertPublicAgentsRequestSafe({
			forceLocalResourceViaBash,
			localResourcePaths,
			requiredSkills,
		});
	}
	const modelKey = normalizeAgentBridgeModelField(extras.modelKey);
	const modelAlias = normalizeAgentBridgeModelField(extras.modelAlias);
	const referenceImages = normalizeAgentsBridgeReferenceImages(extras.referenceImages);
	const selectedMediaReferences = normalizeAgentsBridgeSelectedMediaReferences(extras.selectedMediaReferences);
	const baseAssetInputs = normalizeAgentsBridgeAssetInputs(extras.assetInputs);
	const executionPlanningDirective = buildPublicChatExecutionPlanningDirective({
		publicAgentsRequest,
		requestKind: request.kind,
		prompt: request.prompt,
		planOnly,
		canvasProjectId,
		canvasNodeId,
		selectedNodeKind: effectiveChatContext.selectedNodeKind,
		requiredSkills,
		hasReferenceImages: referenceImages.length > 0,
		hasAssetInputs: baseAssetInputs.length > 0,
		selectedReference: effectiveChatContext.selectedReference,
	});
	const mentionBoundInjection =
		publicAgentsRequest && canvasProjectId
			? await resolveMentionBoundAssetInputs({
				userId: effectiveUserId,
				projectId: canvasProjectId,
				canvasFlowId,
				prompt: request.prompt,
				existingAssetInputs: baseAssetInputs,
			})
			: { mentions: [], matched: [], missing: [], ambiguous: [], assetInputs: [], referenceImages: [], resolvedMentionKeys: [] };
	const mentionRoleInjection =
		publicAgentsRequest && canvasProjectId
			? await resolveMentionRoleAssetInputs({
				userId: effectiveUserId,
				projectId: canvasProjectId,
				prompt: request.prompt,
				existingAssetInputs: [...baseAssetInputs, ...mentionBoundInjection.assetInputs],
				skipMentionKeys: mentionBoundInjection.resolvedMentionKeys,
			})
			: { mentions: [], matched: [], missing: [], ambiguous: [], assetInputs: [], referenceImages: [] };
		const assetInputs = [
			...baseAssetInputs,
			...mentionBoundInjection.assetInputs,
			...mentionRoleInjection.assetInputs,
		];
	const mergedReferenceImages = (() => {
		const out: string[] = [];
		const seen = new Set<string>();
		for (const url of [
				...referenceImages,
				...mentionBoundInjection.referenceImages,
				...mentionRoleInjection.referenceImages,
				...assetInputs.map((item) => item.url),
			]) {
			const trimmed = String(url || "").trim();
			if (!trimmed || seen.has(trimmed)) continue;
			seen.add(trimmed);
			out.push(trimmed);
		}
		return out;
	})();
	const referenceImageSlots = buildReferenceImageSlots({
		referenceImages: mergedReferenceImages,
		assetInputs,
		selectedReference: effectiveChatContext.selectedReference,
	});
	const generationGate = evaluatePublicAgentsGenerationGate({
		publicAgentsRequest,
		canvasProjectId,
		canvasFlowId,
		referenceImages: mergedReferenceImages,
			assetInputsCount: assetInputs.length,
			selectedReferenceKind: effectiveChatContext.selectedReference?.kind || null,
			selectedReferenceImageUrl:
				effectiveChatContext.selectedReference?.imageUrl?.trim() || "",
		});
	const promptPipelineTarget = resolvePromptPipelineTarget({
		selectedNodeKind: effectiveChatContext.selectedNodeKind,
		selectedReferenceKind: effectiveChatContext.selectedReference?.kind || null,
		referenceImageCount: mergedReferenceImages.length,
	});
	const promptPipelinePrecheck = buildPromptPipelinePrecheckSnapshot({
			target: promptPipelineTarget,
			mentionRoleInjection,
			generationGate,
			mergedReferenceImages,
	});
	const promptPipelineRequestSummary = buildPromptPipelineRequestSummary({
		target: promptPipelineTarget,
		precheckSnapshot: promptPipelinePrecheck,
	});
	const pptIntent = detectPptIntent({
		prompt: request.prompt,
		selectedNodeKind: effectiveChatContext.selectedNodeKind,
	});
	const pptMasterAddendum = pptIntent ? buildPptMasterSystemPromptAddendum() : "";
	const systemPrompt = pptMasterAddendum
		? [requestedSystemPrompt, pptMasterAddendum].filter(Boolean).join("\n\n")
		: requestedSystemPrompt;
		const prompt = decoratePromptWithReferenceImages(
		request.prompt,
		mergedReferenceImages,
		assetInputs,
		referenceImageSlots,
			selectedMediaReferences,
			effectiveChatContext.selectedReference,
		);
	const disableMemory = extras.disableMemory === true;
	const finalSystemPrompt = systemPrompt || "";
	const finalPrompt = prompt;
	const debugLogEnabled = readAgentsBridgeDebugLog(c);
	const requestedMaxTurns = resolveRequestedMaxTurns({
		requiredSkills,
		forceLocalResourceViaBash,
	});
	const resourceWhitelist = null;

	const canvasApiBaseUrl = (() => {
		const fromEnv = readCanvasApiBaseFromEnv(c);
		if (fromEnv) return fromEnv;
		try {
			const url = new URL(c.req.url);
			return url.origin;
		} catch {
			return "";
		}
	})();
	const useRequestAuth = readBoolEnvFlag(c.env.AGENTS_BRIDGE_USE_REQUEST_AUTH);
	const envCanvasApiKey =
		typeof c.env.CANVAS_API_KEY === "string"
			? c.env.CANVAS_API_KEY.trim()
			: "";
	const reqAuthorization = (c.req.header("authorization") || "").trim();
	const reqApiKey = (c.req.header("x-api-key") || "").trim();
	const canvasApiKey = envCanvasApiKey || reqApiKey;
	const canvasAuthorization =
		useRequestAuth || !canvasApiKey ? reqAuthorization : "";
	const remoteTools = buildAgentsBridgeRemoteTools({
		publicAgentsRequest,
		canvasProjectId,
		canvasFlowId,
	});
	const allowedTools: string[] | null = publicAgentsRequest
		? buildPublicAgentsAllowedTools(remoteTools)
		: null;
	const allowedToolsDecisionLog = allowedTools
		? `allowedTools=explicit:${allowedTools.length}`
		: "allowedTools=default";
	const canvasCapabilityManifest = buildCanvasCapabilityManifest({
		remoteTools,
	});
	const remoteToolEndpoint =
		canvasApiBaseUrl && remoteTools.length > 0
			? `${canvasApiBaseUrl}/public/agents/tools/execute`
			: "";
	const token = readAgentsBridgeToken(c);
	const timeoutMs =
		readTimeoutFromRequestExtras(request) ?? readAgentsBridgeTimeoutMs(c);
	if (remoteTools.length > 0) {
		console.info(
			`[agents-bridge.remote-tools] user=${effectiveUserId} kind=${request.kind} bridgeTimeoutMs=${timeoutMs} remoteToolConfigTimeoutMs=${timeoutMs} remoteToolCount=${remoteTools.length} remoteToolEndpoint=${remoteToolEndpoint ? "configured" : "missing"} envTimeout=${typeof c.env.AGENTS_BRIDGE_TIMEOUT_MS === "string" && c.env.AGENTS_BRIDGE_TIMEOUT_MS.trim() ? c.env.AGENTS_BRIDGE_TIMEOUT_MS.trim() : "unset"}`,
		);
	}
	const dropOnHeadersTimeout = shouldDropOnHeadersTimeout(c, request);
	const requestAbort = createTimedAbortController(timeoutMs, options?.abortSignal);
	const runOnce = async (): Promise<Response> => {
		throwIfAbortSignalAborted(requestAbort.signal);
		const dispatcher = await createNodeFetchDispatcher(timeoutMs);
		const agentCreds = await resolveAgentLlmCredentials(c);
		if (!agentCreds) {
			throw new Error(
				"agent_llm_credentials_missing: 未配置 Agent 大脑模型。请在 ModelPanel → Agent 大脑 选择一个 multimodal 模型，并确保对应 vendor 已配置 API Key。",
			);
		}
		const multimodalCreds = await resolveMultimodalLlmCredentials(c);
		const multimodalCredsForBridge = multimodalCreds
			? {
				apiKey: multimodalCreds.apiKey,
				baseUrl: multimodalCreds.baseUrl,
				model: multimodalCreds.modelKey,
				...(multimodalCreds.apiProtocol ? { apiProtocol: multimodalCreds.apiProtocol } : {}),
			  }
			: null;
		const activeCanvasModels = await resolveActiveCanvasModelsSnapshot(c);
		const hasActiveCanvasModels = Boolean(
			activeCanvasModels.image || activeCanvasModels.video,
		);
		if (debugLogEnabled) {
			console.info(
				`[agents-bridge.debug] llm-creds user=${effectiveUserId} ${JSON.stringify(redactLlmCredsForLog(agentCreds))}`,
			);
		}
		if (debugLogEnabled) {
			console.info(
				`[agents-bridge.debug] request user=${effectiveUserId} kind=${request.kind} timeoutMs=${timeoutMs} skills=${requiredSkills.length} refImages=${mergedReferenceImages.length} selectedMedia=${selectedMediaReferences.length} assets=${assetInputs.length} localPaths=${localResourcePaths.length} promptChars=${finalPrompt.length} systemChars=${finalSystemPrompt.length} modelKey=${modelKey || "n/a"} modelAlias=${modelAlias || "n/a"}`,
			);
			if (mentionBoundInjection.mentions.length > 0) {
				console.info(
					`[agents-bridge.debug] mention-asset-injection mentions=${mentionBoundInjection.mentions.join(",") || "n/a"} matched=${mentionBoundInjection.matched.map((item) => item.assetRefId).join(",") || "n/a"} missing=${mentionBoundInjection.missing.join(",") || "n/a"} ambiguous=${mentionBoundInjection.ambiguous.join(",") || "n/a"}`,
				);
			}
			if (mentionRoleInjection.mentions.length > 0) {
				console.info(
					`[agents-bridge.debug] mention-role-injection mentions=${mentionRoleInjection.mentions.join(",") || "n/a"} matched=${mentionRoleInjection.matched.map((item) => item.roleName).join(",") || "n/a"} missing=${mentionRoleInjection.missing.join(",") || "n/a"} ambiguous=${mentionRoleInjection.ambiguous.join(",") || "n/a"}`,
				);
			}
				console.info(`[agents-bridge.debug] prompt=${truncateForDebugLog(finalPrompt)}`);
			if (finalSystemPrompt) {
				console.info(
					`[agents-bridge.debug] systemPrompt=${truncateForDebugLog(finalSystemPrompt)}`,
				);
			}
		}
			const init: RequestInit & { dispatcher?: unknown } = {
			method: "POST",
			headers: {
					"Content-Type": "application/json",
					Accept: "text/event-stream, application/json",
					"x-agents-user-id": effectiveUserId,
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({
					prompt: finalPrompt,
					stream: request.kind === "chat",
					userId: effectiveUserId,
					...(finalSystemPrompt ? { systemPrompt: finalSystemPrompt } : {}),
					...(typeof responseFormat !== "undefined"
						? { responseFormat }
						: {}),
					...(allowedTools ? { allowedTools } : {}),
					...(resourceWhitelist ? { resourceWhitelist } : {}),
					...(mergedReferenceImages.length
						? { referenceImages: mergedReferenceImages }
						: {}),
					...(referenceImageSlots.length
						? { referenceImageSlots }
						: {}),
					...(selectedMediaReferences.length
						? { selectedMediaReferences }
						: {}),
					...(assetInputs.length ? { assetInputs } : {}),
					...(generationContract ? { generationContract } : {}),
					...(canvasProjectId ? { canvasProjectId: canvasProjectId } : {}),
					...(canvasFlowId ? { canvasFlowId: canvasFlowId } : {}),
					...(canvasNodeId ? { canvasNodeId: canvasNodeId } : {}),
					...(requiredSkills.length ? { requiredSkills } : {}),
					...(allowedSubagentTypes.length ? { allowedSubagentTypes } : {}),
					...(requiredSkills.length
						? {
								maxTurns: requestedMaxTurns,
								compactPrelude: true,
						  }
						: null),
					...(canvasApiBaseUrl ? { canvasApiBaseUrl } : {}),
					...(canvasAuthorization ? { canvasAuthorization } : {}),
					...(canvasApiKey ? { canvasApiKey } : {}),
					...(remoteTools.length ? { remoteTools } : {}),
					...(publicAgentsRequest ? { canvasCapabilityManifest } : {}),
					...(remoteToolEndpoint
						? {
								remoteToolConfig: {
									endpoint: remoteToolEndpoint,
									...(canvasAuthorization ? { authToken: canvasAuthorization } : {}),
									...(canvasApiKey ? { apiKey: canvasApiKey } : {}),
									...(canvasProjectId ? { projectId: canvasProjectId } : {}),
									...(canvasFlowId ? { flowId: canvasFlowId } : {}),
									...(canvasNodeId ? { nodeId: canvasNodeId } : {}),
									...(publicChatRunId ? { publicChatRunId } : {}),
									...(sessionKey ? { sessionKey } : {}),
									timeoutMs,
								},
						  }
						: {}),
					...(forceLocalResourceViaBash ? { forceLocalResourceViaBash: true } : {}),
					...(localResourcePaths.length ? { localResourcePaths } : {}),
					...(disableMemory ? { disableMemory: true } : {}),
					...(canvasApiBaseUrl ? { memorySyncUrl: `${canvasApiBaseUrl}/memory/write` } : {}),
					...(canvasProjectId ? { memorySyncProjectId: canvasProjectId } : {}),
					...(modelKey ? { modelKey } : {}),
					...(modelAlias ? { modelAlias } : {}),
					llmApiKey: agentCreds.apiKey,
					llmApiBaseUrl: agentCreds.baseUrl,
					llmModel: agentCreds.modelKey,
					...(agentCreds.apiProtocol ? { llmApiProtocol: agentCreds.apiProtocol } : {}),
					...(multimodalCredsForBridge ? { multimodalCreds: multimodalCredsForBridge } : {}),
					...(sessionKey ? { sessionId: sessionKey } : {}),
					...(canvasProjectId || canvasNodeId || diagnosticsLabel || executionPlanningDirective || hasActiveCanvasModels
						? {
							diagnosticContext: {
								source: "agents_bridge",
								requestKind: request.kind,
								...(canvasProjectId ? { projectId: canvasProjectId } : {}),
								...(canvasFlowId ? { flowId: canvasFlowId } : {}),
								...(canvasNodeId ? { nodeId: canvasNodeId } : {}),
								...(effectiveChatContext.selectedNodeKind
									? {
										selectedNodeKind: sanitizeSelectedReferenceKindForAgents(
											effectiveChatContext.selectedNodeKind,
										),
									  }
									: {}),
								...(executionPlanningDirective
									? {
										planningRequired: executionPlanningDirective.planningRequired,
										planningMinimumSteps:
											executionPlanningDirective.planningMinimumSteps,
										planningChecklistFirst:
											executionPlanningDirective.checklistFirst,
										planningReason: executionPlanningDirective.reason,
										...(Array.isArray(executionPlanningDirective.checklistItems) &&
										executionPlanningDirective.checklistItems.length > 0
											? {
												planningChecklistItems:
													executionPlanningDirective.checklistItems,
											}
											: {}),
									}
									: {}),
								...(hasActiveCanvasModels ? { activeCanvasModels } : {}),
								promptPipeline: promptPipelineRequestSummary,
								...(diagnosticsLabel ? { label: diagnosticsLabel } : {}),
							},
						}
						: {}),
				}),
				signal: requestAbort.signal,
			};
			if (dispatcher) init.dispatcher = dispatcher;
			const targetUrl = `${baseUrl}/chat`;
		if (isNodeRuntime()) {
			try {
				return await fetch(targetUrl, init);
			} catch (err) {
				// /chat is non-idempotent (it may trigger tool side effects).
				// Never replay on header-timeout; otherwise one user request can
				// execute twice and duplicate generation tasks.
				if (isHeadersTimeoutError(err)) {
					throw new Error(
						"agents_bridge_headers_timeout_non_retriable",
					);
				}
				throw err;
			}
		}
		return await fetch(targetUrl, init);
	};

	try {
		let res: Response | null = null;
		await runAgentsBridgeQueued(c, async () => {
			try {
				res = await runOnce();
			} catch (err: unknown) {
				throwIfAbortSignalAborted(requestAbort.signal);
				const isHeadersTimeout =
					readErrorMessage(err).includes("agents_bridge_headers_timeout_non_retriable");
				if (isHeadersTimeout && dropOnHeadersTimeout) {
					if (debugLogEnabled) {
						console.warn(
							`[agents-bridge.debug] headers-timeout dropped user=${effectiveUserId} kind=${request.kind}`,
						);
					}
					throw new AppError("Agents bridge 请求头超时（任务未完成，已停止本轮执行）", {
						status: 504,
						code: "agents_bridge_headers_timeout_dropped",
						details: {
							baseUrl,
							timeoutMs,
							dropOnHeadersTimeout: true,
						},
					});
				}
				if (isConnRefusedError(err)) {
					try {
						const recoveredBase = await maybeStartAgentsBridgeOnDemand(c);
						if (recoveredBase) {
							baseUrl = recoveredBase;
							res = await runOnce();
						} else {
							throw err;
						}
					} catch {
						// fall through to original wrapped error
					}
				}
				if (!res) {
					const causeMessage = readErrorCauseMessage(err) || undefined;
					throw new AppError("Agents bridge 网络请求失败（无法连接或已超时）", {
						status: 502,
						code: "agents_bridge_fetch_failed",
						details: {
							baseUrl,
							timeoutMs,
							error: {
								name: isRecord(err) ? readTrimmedString(err.name) || undefined : undefined,
								message: readErrorMessage(err) || String(err || ""),
								cause: causeMessage,
							},
						},
					});
				}
			}
		}, requestAbort.signal);

			if (!res) {
				throw new AppError("Agents bridge 网络请求失败（无法连接或已超时）", {
					status: 502,
					code: "agents_bridge_fetch_failed",
				details: { baseUrl, timeoutMs, error: { name: "UnknownError" } },
			});
		}

		const response: Response = res;
		throwIfAbortSignalAborted(requestAbort.signal);

		if (!response.ok) {
			const body = await readResponseTextSafe(response);
			if (debugLogEnabled) {
				console.warn(
					`[agents-bridge.debug] response failed status=${response.status} body=${truncateForDebugLog(body)}`,
				);
			}
			throw new AppError("Agents bridge 调用失败", {
				status: 502,
				code: "agents_bridge_failed",
				details: {
					status: response.status,
					body: body || null,
				},
			});
		}

		const responseContentType = String(response.headers.get("content-type") || "").toLowerCase();
		const detectedAskUserPrompts = new Map<string, AgentsBridgeAskUserPrompt>();
		const askUserDispatched = new Set<string>();
		const observerWithAskUserCapture: AgentsBridgeStreamObserver = async (event) => {
			if (event.event === "tool") {
				const prompt = readBridgeAskUserPromptFromStreamEvent(event.data);
				if (prompt) {
					detectedAskUserPrompts.set(prompt.toolCallId, prompt);
					if (options?.onAskUserDetected && !askUserDispatched.has(prompt.toolCallId)) {
						askUserDispatched.add(prompt.toolCallId);
						try {
							await options.onAskUserDetected(prompt);
						} catch (err) {
							console.warn(
								"[agents-bridge] onAskUserDetected callback failed",
								err,
							);
						}
					}
				}
			}
			if (options?.onStreamEvent) {
				await options.onStreamEvent(event);
			}
		};
		const data = await parseAgentsBridgeProtocolResponse({
			response,
			c,
			responseContentType,
			allowSseSniff: request.kind === "chat",
			canvasFlowId,
			onEvent: observerWithAskUserCapture,
		});
		throwIfAbortSignalAborted(requestAbort.signal);
		const text = typeof data?.text === "string" ? data.text : "";
		throwIfAbortSignalAborted(requestAbort.signal);
	const bridgeToolCalls = Array.isArray(data?.trace?.toolCalls)
		? data!.trace!.toolCalls
				.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
				.slice(0, 200)
		: [];
	const normalizedBridgeToolCalls = normalizeBridgeToolCalls(bridgeToolCalls);
	const assets = Array.isArray(data?.assets)
		? data.assets
				.map((asset) => {
					const rawType = typeof asset?.type === "string" ? asset.type.trim().toLowerCase() : "";
					const type = rawType === "video" ? "video" : rawType === "image" ? "image" : null;
					const url = typeof asset?.url === "string" ? asset.url.trim() : "";
					const thumbnailUrl =
						type === "video" && typeof asset?.thumbnailUrl === "string"
							? asset.thumbnailUrl.trim()
							: "";
					if (!type || !url || !/^https?:\/\//i.test(url)) return null;
					return {
						type,
						url,
						...(thumbnailUrl && /^https?:\/\//i.test(thumbnailUrl)
							? { thumbnailUrl }
							: {}),
					};
				})
				.filter((asset): asset is { type: "image" | "video"; url: string; thumbnailUrl?: string } => !!asset)
				.slice(0, 24)
		: [];
	const traceOutput =
		data?.trace?.output && typeof data.trace.output === "object" && !Array.isArray(data.trace.output)
			? data.trace.output
			: null;
	const traceSummary =
		data?.trace?.summary && typeof data.trace.summary === "object" && !Array.isArray(data.trace.summary)
			? data.trace.summary
			: null;
	const traceTurns = Array.isArray(data?.trace?.turns)
		? data.trace.turns
				.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
				.slice(0, 24)
		: [];
	const traceRuntime = normalizeAgentsRuntimeTraceSummary(data?.trace?.runtime);
	const traceTodoList = normalizeAgentsTodoListTraceSummary(data?.trace?.todoList);
	const traceTodoEvents = normalizeAgentsTodoEventTraceSummaries(data?.trace?.todoEvents);
	const tracePlanning =
		normalizeAgentsPlanningTraceSummary(data?.trace?.planning) ??
		deriveAgentsPlanningTraceSummaryFromTodo({
			todoList: traceTodoList,
			todoEvents: traceTodoEvents,
		});
	const traceCompletion = normalizeAgentsCompletionTraceSummary(data?.trace?.completion);
	const semanticTaskSummaryFromToolTrace =
		normalizeAgentsSemanticTaskSummaryFromToolCalls(normalizedBridgeToolCalls);
	const semanticTaskSummaryFromText = normalizeAgentsSemanticTaskSummaryFromText(text);
	const semanticTaskSummary = semanticTaskSummaryFromToolTrace ?? semanticTaskSummaryFromText;
	const semanticExecutionIntent = buildAgentsSemanticExecutionIntentSummary({
		taskSummary: semanticTaskSummary,
		source: semanticTaskSummaryFromToolTrace ? "tool_trace_output_json" : "task_interrogation_json",
	});
	const canvasPlanDiagnosticsRaw = buildCanvasPlanDiagnostics(text);
	const toolEvidence = summarizeBridgeToolEvidence(normalizedBridgeToolCalls);
	const outputMode = classifyBridgeOutputMode({
		assetCount: assets.length,
		canvasPlanParsed: Boolean(canvasPlanDiagnosticsRaw.parseSuccess),
		canvasPlanHasAssetUrls: Boolean(canvasPlanDiagnosticsRaw.hasAssetUrls),
		wroteCanvas: toolEvidence.wroteCanvas,
	});
	const canvasPlanDiagnostics = decorateCanvasPlanDiagnosticsForOutputMode({
		outputMode,
		canvasPlanDiagnostics: canvasPlanDiagnosticsRaw,
	});
	const promptPipeline = buildPromptPipelineTraceSummary({
		target: promptPipelineTarget,
		precheckSnapshot: promptPipelinePrecheck,
		toolEvidence,
		toolCalls: normalizedBridgeToolCalls,
		text,
		assetCount: assets.length,
		canvasPlanDiagnostics,
	});
	if (debugLogEnabled) {
		console.info(
			`[agents-bridge.debug] response ok user=${effectiveUserId} kind=${request.kind} textChars=${text.length} assets=${assets.length}`,
		);
		console.info(`[agents-bridge.debug] responseText=${truncateForDebugLog(text)}`);
	}
	const id =
		typeof data?.id === "string" && data.id.trim()
			? data.id.trim()
			: `task_${crypto.randomUUID()}`;
	const traceScopeType = canvasProjectId ? "project" : "user";
		const traceScopeId = canvasProjectId || effectiveUserId;
		const requestId = String(c.get("requestId") || "").trim();
		const pagePath = readRequestHeader(c, "x-canvas-page-path");
		const referrerPath = readRequestHeader(c, "x-canvas-referrer-path");
		const trimmedText = text.trim();
		const assistantTextPreview = trimmedText
			? truncateExecutionTraceString(trimmedText, EXECUTION_TRACE_TEXT_PREVIEW_LIMIT)
			: "";
		const assistantTextHead = truncateExecutionTraceString(
			readTraceStringField(traceOutput, "head") || trimmedText.slice(0, 1200),
			1200,
		);
		const assistantTextTail = truncateExecutionTraceString(
			readTraceStringField(traceOutput, "tail") ||
				(trimmedText ? trimmedText.slice(Math.max(0, trimmedText.length - 1200)) : ""),
			1200,
		);
		const fallbackSucceededToolCalls = normalizedBridgeToolCalls.filter(
			(call) => call.status === "succeeded",
		).length;
		const fallbackFailedToolCalls = normalizedBridgeToolCalls.filter(
			(call) => call.status === "failed",
		).length;
		const fallbackDeniedToolCalls = normalizedBridgeToolCalls.filter(
			(call) => call.status === "denied",
		).length;
		const fallbackBlockedToolCalls = normalizedBridgeToolCalls.filter(
			(call) => call.status === "blocked",
		).length;
		const toolStatusSummary: ToolStatusSummary = {
			totalToolCalls:
				readTraceNumberField(traceSummary, "totalToolCalls") ?? normalizedBridgeToolCalls.length,
			succeededToolCalls:
				readTraceNumberField(traceSummary, "succeededToolCalls") ?? fallbackSucceededToolCalls,
			failedToolCalls:
				readTraceNumberField(traceSummary, "failedToolCalls") ?? fallbackFailedToolCalls,
			deniedToolCalls:
				readTraceNumberField(traceSummary, "deniedToolCalls") ?? fallbackDeniedToolCalls,
			blockedToolCalls:
				readTraceNumberField(traceSummary, "blockedToolCalls") ?? fallbackBlockedToolCalls,
			runMs: readTraceNumberField(traceSummary, "runMs") ?? null,
		};
		const toolExecutionIssues = summarizeBridgeToolExecutionIssues({
			toolCalls: normalizedBridgeToolCalls,
			toolStatusSummary,
		});
			const visualDelivery = buildVisualDeliverySummary({
				toolCalls: normalizedBridgeToolCalls,
				selectedNodeKind: effectiveChatContext.selectedNodeKind,
			});
				const expectedDelivery = buildPublicChatExpectedDeliverySummary({
					taskSummary: semanticTaskSummary,
					requiresExecutionDelivery: semanticExecutionIntent.requiresExecutionDelivery,
					forceAssetGeneration,
					selectedNodeKind: effectiveChatContext.selectedNodeKind,
					selectedReferenceKind: effectiveChatContext.selectedReference?.kind ?? null,
				});
				const canvasPersistence =
					canvasFlowId && toolEvidence.wroteCanvas
						? await buildCanvasPersistenceEvidence({
								c,
								userId: effectiveUserId,
								flowId: canvasFlowId,
								toolCalls: normalizedBridgeToolCalls,
						  })
						: null;
				const deliveryEvidence = buildPublicChatDeliveryEvidence({
					assets,
					toolEvidence,
					visualDelivery,
					toolCalls: normalizedBridgeToolCalls,
					canvasPersistence,
				});
		const deliveryVerification = verifyPublicChatDelivery({
			expected: expectedDelivery,
			evidence: deliveryEvidence,
		});
		const diagnosticFlags = buildDiagnosticFlags({
			requestKind: request.kind,
			text,
			toolEvidence,
			canvasPlanDiagnostics,
			outputMode,
			toolStatusSummary,
			toolExecutionIssues,
			toolCalls: normalizedBridgeToolCalls,
			runtimeTrace: traceRuntime,
			generationGate,
			forceAssetGeneration,
			semanticExecutionIntent,
			planningTrace: tracePlanning,
			todoListTrace: traceTodoList,
			selectedNodeKind: effectiveChatContext.selectedNodeKind,
			selectedReference: effectiveChatContext.selectedReference,
			requestAssetInputs: assetInputs,
		});
		const agentDecision = buildAgentsBridgeDecision({
			outputMode,
			assetCount: assets.length,
			toolEvidence,
			canvasPlanDiagnostics,
		});
		const turnVerdict = buildAgentsBridgeTurnVerdict({
			text,
			assetCount: assets.length,
			toolEvidence,
			toolExecutionIssues,
			toolCalls: normalizedBridgeToolCalls,
			canvasPlanDiagnostics,
			diagnosticFlags,
			forceAssetGeneration,
			semanticExecutionIntent,
			deliveryVerification,
			completionTrace: traceCompletion,
		});
		const canvasMutation = buildAgentsBridgeCanvasMutationSummary(normalizedBridgeToolCalls);
		let askUserPrompt = findBridgeAskUserPrompt(normalizedBridgeToolCalls);
		if (!askUserPrompt && detectedAskUserPrompts.size > 0) {
			let fallback: AgentsBridgeAskUserPrompt | null = null;
			for (const prompt of detectedAskUserPrompts.values()) {
				fallback = prompt;
			}
			if (fallback) {
				console.warn(
					"[agents-bridge] ask_user prompt extraction fell back to stream event",
					{
						toolCallId: fallback.toolCallId,
						reason: "trace_tool_calls_missing_ask_user_output",
						detectedCount: detectedAskUserPrompts.size,
					},
				);
				askUserPrompt = fallback;
			}
		}
		const bridgeResponseMeta: AgentsBridgeResponseMeta = {
			...(requestId ? { requestId } : {}),
			...(sessionKey ? { sessionId: sessionKey } : {}),
			outputMode,
			toolEvidence,
			...(expectedDelivery.active ? { expectedDelivery } : {}),
			...(deliveryVerification.applicable ? { deliveryVerification } : {}),
			...(expectedDelivery.active ? { deliveryEvidence } : {}),
			promptPipeline,
			toolStatusSummary,
			diagnosticFlags,
			canvasPlan: canvasPlanDiagnostics,
			...(canvasMutation ? { canvasMutation } : {}),
			agentDecision,
			...(traceCompletion ? { completionTrace: traceCompletion } : {}),
			...(semanticExecutionIntent.detected ? { semanticExecutionIntent } : {}),
			...(tracePlanning ? { planningTrace: tracePlanning } : {}),
			...(traceTodoList ? { todoList: traceTodoList } : {}),
			...(traceTodoEvents.length > 0 ? { todoEvents: traceTodoEvents } : {}),
			...(askUserPrompt ? { askUserPrompt } : {}),
			turnVerdict,
		};
		const executionTraceToolCalls = buildExecutionTraceToolCallSummary(normalizedBridgeToolCalls);
		const compactResponseTrace: Record<string, unknown> = {
			...(traceOutput
				? {
						output: {
							textChars:
								typeof traceOutput.textChars === "number" && Number.isFinite(traceOutput.textChars)
									? traceOutput.textChars
									: text.length,
							...(assistantTextPreview ? { preview: assistantTextPreview } : {}),
							...(assistantTextHead ? { head: assistantTextHead } : {}),
							...(assistantTextTail ? { tail: assistantTextTail } : {}),
						},
				  }
				: {}),
			...(traceSummary ? { summary: sanitizeExecutionTraceValue(traceSummary) } : {}),
			...(traceCompletion ? { completion: sanitizeExecutionTraceValue(traceCompletion) } : {}),
			...(tracePlanning ? { planning: sanitizeExecutionTraceValue(tracePlanning) } : {}),
			...(traceRuntime ? { runtime: sanitizeExecutionTraceValue(traceRuntime) } : {}),
			...(traceTodoList ? { todoList: sanitizeExecutionTraceValue(traceTodoList) } : {}),
			...(traceTodoEvents.length > 0
				? { todoEvents: sanitizeExecutionTraceValue(traceTodoEvents) }
				: {}),
			...(traceTurns.length > 0
				? {
						turns: traceTurns.slice(0, 8).map((turn) => ({
							turn: typeof turn.turn === "number" ? turn.turn : null,
							textPreview: truncateExecutionTraceString(turn.textPreview, 320),
							textChars:
								typeof turn.textChars === "number" && Number.isFinite(turn.textChars)
									? turn.textChars
									: null,
							toolCallCount:
								typeof turn.toolCallCount === "number" && Number.isFinite(turn.toolCallCount)
									? turn.toolCallCount
									: null,
							toolNames: Array.isArray(turn.toolNames)
								? turn.toolNames
										.filter((name): name is string => typeof name === "string" && !!name.trim())
										.slice(0, 12)
								: [],
							finished: turn.finished === true,
						})),
				  }
				: {}),
		};
		await writeUserExecutionTrace(c, effectiveUserId, {
			scopeType: traceScopeType,
			scopeId: traceScopeId,
			taskId: id,
			requestKind: `agents_bridge:${request.kind}`,
			inputSummary: [
				canvasProjectId ? `project=${canvasProjectId}` : "",
				diagnosticsLabel ? `label=${diagnosticsLabel}` : "",
				`prompt=${String(request.prompt || "").trim().slice(0, 1000)}`,
			]
				.filter(Boolean)
				.join("; "),
			decisionLog: [
				`baseUrl=${baseUrl}`,
				`requiredSkills=${requiredSkills.join(",") || "none"}`,
				`runtimeProfile=${traceRuntime?.profile || "unknown"}`,
				`runtimeRegisteredTools=${traceRuntime?.registeredToolNames.length ?? 0}`,
				`runtimeLoadedSkills=${traceRuntime?.loadedSkills.join(",") || "none"}`,
				`runtimeAllowedSubagentTypes=${traceRuntime?.allowedSubagentTypes.join(",") || "none"}`,
				`planning=${tracePlanning ? `${tracePlanning.hasChecklist ? "present" : "missing"}:${Math.max(tracePlanning.latestStepCount, tracePlanning.maxObservedStepCount)}/${tracePlanning.minimumStepCount}:${tracePlanning.checklistComplete ? "complete" : "open"}` : "none"}`,
				`todoList=${traceTodoList ? `${traceTodoList.completedCount}/${traceTodoList.totalCount}` : "none"}`,
				`todoEvents=${traceTodoEvents.length}`,
				`semanticExecutionIntent=${semanticExecutionIntent.detected ? `${semanticExecutionIntent.taskKind || "unknown"}:${semanticExecutionIntent.requiresExecutionDelivery ? "execute" : "non_execute"}` : "none"}`,
				allowedToolsDecisionLog,
				`referenceImages=${mergedReferenceImages.length}`,
				`selectedMediaReferences=${selectedMediaReferences.length}`,
				`assetInputs=${assetInputs.length}`,
				`bridgeToolCalls=${bridgeToolCalls.length}`,
				`turns=${traceTurns.length}`,
				`toolStatuses=succeeded:${toolStatusSummary.succeededToolCalls},failed:${toolStatusSummary.failedToolCalls},denied:${toolStatusSummary.deniedToolCalls},blocked:${toolStatusSummary.blockedToolCalls}`,
				`toolIssueSummary=failed:${toolExecutionIssues.failedToolCalls},denied:${toolExecutionIssues.deniedToolCalls},blocked:${toolExecutionIssues.blockedToolCalls},coordinationBlocked:${toolExecutionIssues.coordinationBlockedToolCalls},actionableBlocked:${toolExecutionIssues.actionableBlockedToolCalls}`,
				`outputMode=${outputMode}`,
				`promptPipelineTarget=${promptPipeline.target}`,
				`promptPipelinePrecheck=${promptPipeline.precheck.status}:${promptPipeline.precheck.reason}`,
				`promptPipelinePrerequisite=${promptPipeline.prerequisiteGeneration.status}:${promptPipeline.prerequisiteGeneration.reason}`,
				`promptPipelineGeneration=${promptPipeline.promptGeneration.status}:${promptPipeline.promptGeneration.reason}`,
				`canvasPlan=${canvasPlanDiagnostics.parseSuccess ? "parsed" : canvasPlanDiagnostics.tagPresent ? "invalid" : "missing"}`,
				`canvasPlanNodes=${Number(canvasPlanDiagnostics.nodeCount || 0)}`,
				`expectedDelivery=${expectedDelivery.active ? `${expectedDelivery.kind}:${expectedDelivery.reason}` : "none"}`,
				`deliveryVerification=${deliveryVerification.status}:${deliveryVerification.code || "ok"}`,
				`readProjectState=${toolEvidence.readProjectState ? "yes" : "no"}`,
				`flags=${diagnosticFlags.length}`,
				`turnVerdict=${turnVerdict.status}:${turnVerdict.reasons.join(",")}`,
			],
			toolCalls: executionTraceToolCalls,
			meta: {
				provider: "agents_bridge",
				responseId: id,
				assetCount: assets.length,
				textChars: text.length,
				...(assistantTextPreview ? { assistantTextPreview } : {}),
				...(assistantTextHead ? { assistantTextHead } : {}),
				...(assistantTextTail ? { assistantTextTail } : {}),
				...(requestId ? { requestId } : {}),
				...(pagePath ? { pagePath } : {}),
				...(referrerPath ? { referrerPath } : {}),
				...(canvasProjectId ? { projectId: canvasProjectId } : {}),
				...(canvasFlowId ? { flowId: canvasFlowId } : {}),
				...(diagnosticsLabel ? { label: diagnosticsLabel } : {}),
				...(sessionKey ? { sessionId: sessionKey } : {}),
				...(modelKey ? { modelKey } : {}),
				...(modelAlias ? { modelAlias } : {}),
				...(traceRuntime ? { agentsRuntime: traceRuntime } : {}),
				...(traceCompletion ? { agentsCompletion: traceCompletion } : {}),
				...(tracePlanning ? { agentsPlanning: tracePlanning } : {}),
				...bridgeResponseMeta,
				requestContext: {
					promptChars: String(request.prompt || "").trim().length,
					requiredSkills,
					loadedSkills: traceRuntime?.loadedSkills ?? [],
					allowedTools: allowedTools ?? [],
					runtimeProfile: traceRuntime?.profile || "unknown",
					runtimeRegisteredToolNames: traceRuntime?.registeredToolNames ?? [],
					runtimeAllowedSubagentTypes: traceRuntime?.allowedSubagentTypes ?? [],
					runtimeContextTotalChars: traceRuntime?.contextDiagnostics?.totalChars ?? 0,
					runtimeContextTotalBudgetChars: traceRuntime?.contextDiagnostics?.totalBudgetChars ?? 0,
					runtimeContextTruncatedSourceIds:
						traceRuntime?.contextDiagnostics?.sources
							.filter((source) => source.truncated)
							.map((source) => source.id) ?? [],
					runtimePolicySummary: traceRuntime?.policySummary ?? null,
					referenceImages: mergedReferenceImages.length,
					referenceImageSlots: summarizeReferenceImageSlotsForTrace(referenceImageSlots),
					selectedMediaReferences: selectedMediaReferences.length,
					assetInputs: assetInputs.length,
					maxTurns: requestedMaxTurns,
					publicAgentsRequest,
				},
				responseTrace: compactResponseTrace,
			},
			resultSummary: `mode=${outputMode}; verdict=${turnVerdict.status}; delivery=${deliveryVerification.status}:${deliveryVerification.code || "ok"}; assets=${assets.length}; textChars=${text.length}; tools=${bridgeToolCalls.length}; canvasPlanNodes=${Number(canvasPlanDiagnostics.nodeCount || 0)}`,
		});
		return {
			id,
			kind: request.kind,
			status: "succeeded",
			assets,
			raw: {
				provider: "agents_bridge",
				vendor: "agents",
				userId: effectiveUserId,
				text,
				meta: bridgeResponseMeta,
			},
		};
	} finally {
		requestAbort.cleanup();
	}
}
