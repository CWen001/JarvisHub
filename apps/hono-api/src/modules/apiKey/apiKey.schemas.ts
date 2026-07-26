import { z } from "@hono/zod-openapi";
import { PUBLIC_CHAT_SESSION_KEY_MAX_LENGTH } from "./public-chat-session.constants";
import {
	PUBLIC_FLOW_ANCHOR_BINDING_KINDS,
	PUBLIC_FLOW_ANCHOR_REFERENCE_VIEWS,
} from "../flow/flow.anchor-bindings";
import {
	PUBLIC_FLOW_APPROVAL_STATUS_VALUES,
	PUBLIC_FLOW_CREATION_STAGE_VALUES,
	PUBLIC_FLOW_PRODUCTION_LAYER_VALUES,
	optionalNonEmptyString,
} from "../flow/flow.public.schemas";
import { TaskKindSchema, TaskRequestSchema, TaskResultSchema } from "../task/task.schemas";
import { loadGenerationContractModule } from "../../platform/node/shared-schema-loader";

const generationContractModule = loadGenerationContractModule();
const {
	GENERATION_CONTRACT_VERSION,
	GENERATION_CONTRACT_MAX_LIST_ITEMS,
	GENERATION_CONTRACT_MAX_TEXT_LENGTH,
	GENERATION_CONTRACT_MAX_ID_LENGTH,
} = generationContractModule;

const PUBLIC_CHAT_ASSET_ROLES = [
	"target",
	"reference",
	"character",
	"scene",
	"prop",
	"product",
	"style",
	"context",
	"mask",
] as const;

const PUBLIC_CHAT_SELECTED_MEDIA_KINDS = ["image", "video"] as const;

const PublicChatDiagnosticFlagSchema = z.object({
	code: z.string(),
	severity: z.enum(["high", "medium"]),
	title: z.string(),
	detail: z.string(),
});

const PublicChatCanvasPlanTraceSchema = z.object({
	tagPresent: z.boolean(),
	normalized: z.boolean(),
	parseSuccess: z.boolean(),
	error: z.string(),
	errorCode: z.string(),
	errorDetail: z.string(),
	schemaIssues: z.array(z.string()),
	detectedTagName: z.string(),
	nodeCount: z.number().int().min(0),
	edgeCount: z.number().int().min(0),
	nodeKinds: z.array(z.string()),
	hasAssetUrls: z.boolean(),
	action: z.string(),
	summary: z.string(),
	reason: z.string(),
	rawPayload: z.string(),
});

const PublicChatAgentDecisionSchema = z.object({
	executionKind: z.enum(["plan", "execute", "generate", "answer"]),
	canvasAction: z.enum(["create_canvas_workflow", "write_canvas", "none"]),
	assetCount: z.number().int().min(0),
	projectStateRead: z.boolean(),
	requiresConfirmation: z.boolean(),
	reason: z.string().min(1).max(500),
});

const PublicChatTurnVerdictSchema = z.object({
	status: z.enum(["satisfied", "partial", "failed"]),
	reasons: z.array(z.string().min(1)).min(1),
});

const PublicChatTodoListItemSchema = z.object({
	text: z.string().min(1),
	completed: z.boolean(),
	status: z.enum(["pending", "in_progress", "waiting", "blocked", "completed"]),
});

const PublicChatTodoListTraceSchema = z.object({
	sourceToolCallId: z.string().min(1),
	items: z.array(PublicChatTodoListItemSchema).min(1).max(20),
	totalCount: z.number().int().min(1),
	completedCount: z.number().int().min(0),
	inProgressCount: z.number().int().min(0),
	waitingCount: z.number().int().min(0),
	blockedCount: z.number().int().min(0),
	pendingCount: z.number().int().min(0),
});

const PublicChatTodoEventTraceSchema = PublicChatTodoListTraceSchema.extend({
	atMs: z.number().int().min(0).nullable(),
	startedAt: z.string().nullable(),
	finishedAt: z.string().nullable(),
	durationMs: z.number().int().min(0).nullable(),
});

const PublicChatRuntimeContextDiagnosticsSchema = z.object({
	totalChars: z.number().int().min(0),
	totalBudgetChars: z.number().int().min(0),
	sources: z.array(
		z.object({
			id: z.string().min(1),
			kind: z.string().min(1),
			summary: z.string().min(1),
			chars: z.number().int().min(0),
			budgetChars: z.number().int().min(0),
			truncated: z.boolean(),
		}),
	).max(16),
});

const PublicChatRuntimeCapabilitySnapshotSchema = z.object({
	providers: z.array(
		z.object({
			kind: z.string().min(1),
			name: z.string().min(1),
			toolNames: z.array(z.string()).max(128),
			toolCount: z.number().int().min(0),
		}),
	).max(12),
	exposedToolNames: z.array(z.string()).max(256),
});

const PublicChatRuntimePolicySummarySchema = z.object({
	totalDecisions: z.number().int().min(0),
	allowCount: z.number().int().min(0),
	denyCount: z.number().int().min(0),
	requiresApprovalCount: z.number().int().min(0),
	uniqueDeniedSignatures: z.array(z.string()).max(32),
});

const PublicChatRuntimeTraceSchema = z.object({
	profile: z.enum(["general", "code", "unknown"]),
	registeredToolNames: z.array(z.string()).max(256),
	requiredSkills: z.array(z.string()).max(32),
	loadedSkills: z.array(z.string()).max(64),
	allowedSubagentTypes: z.array(z.string()).max(16),
	contextDiagnostics: PublicChatRuntimeContextDiagnosticsSchema.optional(),
	capabilitySnapshot: PublicChatRuntimeCapabilitySnapshotSchema.optional(),
	policySummary: PublicChatRuntimePolicySummarySchema.optional(),
	canvasCapabilities: z
		.object({
			version: z.string().nullable(),
			remoteToolNames: z.array(z.string()).max(128),
			nodeKinds: z.array(z.string()).max(128),
		})
		.optional(),
});

const publicChatGenerationContractTextSchema = z.string().trim().min(1).max(GENERATION_CONTRACT_MAX_TEXT_LENGTH);

export const PublicChatGenerationContractSchema = z
	.object({
		version: z.literal(GENERATION_CONTRACT_VERSION),
		fixedConstraints: z
			.array(publicChatGenerationContractTextSchema)
			.max(GENERATION_CONTRACT_MAX_LIST_ITEMS),
		editableVariable: publicChatGenerationContractTextSchema.nullable(),
		forbiddenChanges: z
			.array(publicChatGenerationContractTextSchema)
			.max(GENERATION_CONTRACT_MAX_LIST_ITEMS),
		approvedKeyframeId: z.string().trim().min(1).max(GENERATION_CONTRACT_MAX_ID_LENGTH).nullable(),
	})
	.strict();

const PublicChatTraceSchema = z.object({
	requestId: z.string().optional(),
	sessionId: z.string().optional(),
	outputMode: z.enum(["plan_with_assets", "plan_only", "direct_assets", "text_only"]),
	toolEvidence: z.object({
		toolNames: z.array(z.string()),
		readProjectState: z.boolean(),
		readNodeContextBundle: z.boolean(),
		readVideoReviewBundle: z.boolean(),
		readMaterialAssets: z.boolean(),
		generatedAssets: z.boolean(),
		wroteCanvas: z.boolean(),
	}),
	toolStatusSummary: z.object({
		totalToolCalls: z.number().int().min(0),
		succeededToolCalls: z.number().int().min(0),
		failedToolCalls: z.number().int().min(0),
		deniedToolCalls: z.number().int().min(0),
		blockedToolCalls: z.number().int().min(0),
		runMs: z.number().nullable(),
	}),
	canvasMutation: z
		.object({
			deletedNodeIds: z.array(z.string()),
			deletedEdgeIds: z.array(z.string()),
			createdNodeIds: z.array(z.string()),
			patchedNodeIds: z.array(z.string()),
			executableNodeIds: z.array(z.string()),
		})
		.optional(),
	diagnosticFlags: z.array(PublicChatDiagnosticFlagSchema),
	canvasPlan: PublicChatCanvasPlanTraceSchema,
	todoList: PublicChatTodoListTraceSchema.optional(),
	todoEvents: z.array(PublicChatTodoEventTraceSchema).max(32).optional(),
	runtime: PublicChatRuntimeTraceSchema.optional(),
	turnVerdict: PublicChatTurnVerdictSchema,
});

export const AgentsChatRequestSchema = z.object({
	vendor: z.string().optional().openapi({
		description:
			"指定厂商 key（默认 auto）；vendor=auto 会从系统级已启用且已配置的厂商列表中依次重试，直到成功或候选耗尽。",
		example: "auto",
	}),
	vendorCandidates: z.array(z.string()).optional().openapi({
		description:
			"当 vendor=auto 时用于限制候选厂商列表（仅用于自动回退范围与顺序；最终仍会过滤掉系统级未启用/未配置的厂商）。",
		example: ["apimart"],
	}),
	prompt: optionalNonEmptyString,
	displayPrompt: optionalNonEmptyString,
	modelKey: z.string().optional(),
	modelAlias: z.string().optional(),
	systemPrompt: z.string().optional(),
	temperature: z.number().min(0).max(2).optional(),
	model: z.string().optional().openapi({
		description:
			"OpenAI responses 兼容字段：模型别名/模型名。服务端会按 model catalog 映射到对应 vendor。",
		example: "gemini-2.5-pro",
	}),
	input: z.union([z.string(), z.array(z.unknown())]).optional().openapi({
		description:
			"OpenAI responses 兼容字段：支持字符串或消息数组。若传入该字段，服务端会自动提取用户文本与参考图。",
		example: "你好，帮我总结这段文案。",
	}),
	instructions: z.string().optional().openapi({
		description:
			"OpenAI responses 兼容字段：系统提示词。会映射到 systemPrompt。",
		example: "请用中文回答。",
	}),
	max_output_tokens: z.number().int().min(1).optional(),
	tool_choice: z.unknown().optional(),
	tools: z.array(z.unknown()).optional(),
	stream: z.boolean().optional(),
	bridgeTimeoutMs: z.number().int().min(5_000).max(7_200_000).optional().openapi({
		description:
			"可选：本轮 agents bridge 执行超时，毫秒。用于长任务调试或前端可恢复任务，默认由服务端控制。",
		example: 120000,
	}),
	response_format: z.unknown().optional(),
	mode: z.enum(["chat", "auto"]).optional().openapi({
		description:
			"对话模式（默认 chat）；auto 表示统一的最高质量 agents 执行模式，只负责执行强度与完成态要求，不负责本地业务意图分流。具体创作场景语义必须由 skill 选择或 agents 语义决策触发，不能由本地 route 注入。",
		example: "auto",
	}),
	requiredSkills: z.array(z.string().trim().min(1).max(120)).max(32).optional().openapi({
		description:
			"可选：用户在 AI Chat 任务菜单中显式选择的 runtime skill key。服务端仅透传给 agents-cli requiredSkills，不做本地语义路由或关键词匹配。",
		example: ["storyboard-image-production"],
	}),
	sessionKey: z.string().min(1).max(PUBLIC_CHAT_SESSION_KEY_MAX_LENGTH).optional().openapi({
		description:
			"会话键（建议前端稳定传递）。服务端按 userId + sessionKey 隔离并持久化聊天历史，用于跨轮记忆。",
		example: "canvas-main:default",
	}),
	userMessageId: z.string().min(1).max(120).openapi({
		description:
			"必填：客户端为本轮 user 消息生成的稳定 ID。服务端持久化时直接使用该 ID，恢复 / 历史合并都以此为准；缺失时直接报错（不再回退到服务端生成的 UUID）。",
		example: "m_user_1700000000000",
	}),
	assistantMessageId: z.string().min(1).max(120).openapi({
		description:
			"必填：客户端为本轮 assistant 消息预生成的稳定 ID。服务端持久化时直接使用该 ID；缺失时直接报错（不再回退到服务端生成的 UUID）。",
		example: "m_ai_pending_1700000000000",
	}),
	canvasProjectId: z.string().min(1).max(120).optional().openapi({
		description: "可选：当前画布项目 ID（用于 agents-cli 在对话中定位“当前项目”）。",
		example: "13b29494-8a2e-4cca-8172-8c778642be8f",
	}),
	canvasFlowId: z.string().min(1).max(120).optional().openapi({
		description: "可选：当前 Flow ID（用于 agents-cli 在对话中定位“当前画布/工作流”）。",
		example: "96bb2e49-fb93-4fd6-b64b-22777a7b185e",
	}),
	canvasNodeId: z.string().min(1).max(120).optional().openapi({
		description: "可选：当前用户选中的节点 ID（用于 agents-cli 直接读取当前节点证据包）。",
		example: "96a6e963-0eaa-47cf-ab9f-15c79491424f",
	}),
		chatContext: z
			.object({
				currentProjectName: z.string().min(1).max(200).optional(),
				skill: z
					.object({
					key: z.string().min(1).max(120).optional(),
					name: z.string().min(1).max(120).optional(),
				})
				.optional(),
			selectedNodeLabel: z.string().min(1).max(200).optional(),
			selectedNodeKind: z.string().min(1).max(120).optional(),
			selectedNodeTextPreview: z.string().min(1).max(2000).optional(),
			selectedReference: z
				.object({
					nodeId: z.string().min(1).max(120).optional(),
					label: z.string().min(1).max(200).optional(),
					kind: z.string().min(1).max(120).optional(),
					anchorBindings: z
						.array(
							z.object({
								kind: z.enum(PUBLIC_FLOW_ANCHOR_BINDING_KINDS),
								refId: z.string().min(1).max(160).optional(),
								entityId: z.string().min(1).max(160).optional(),
								label: z.string().min(1).max(200).optional(),
								sourceBookId: z.string().min(1).max(120).optional(),
								sourceNodeId: z.string().min(1).max(120).optional(),
								assetId: z.string().min(1).max(120).optional(),
								assetRefId: z.string().min(1).max(160).optional(),
								imageUrl: z.string().min(1).max(2048).optional(),
								referenceView: z.enum(PUBLIC_FLOW_ANCHOR_REFERENCE_VIEWS).optional(),
								category: z.string().min(1).max(120).optional(),
								note: z.string().min(1).max(500).optional(),
							}),
						)
						.max(24)
						.optional(),
					imageUrl: z.string().min(1).max(2048).optional(),
					sourceUrl: z.string().min(1).max(2048).optional(),
					shotNo: z.number().int().min(1).optional(),
					productionLayer: z.enum(PUBLIC_FLOW_PRODUCTION_LAYER_VALUES).optional(),
					creationStage: z.enum(PUBLIC_FLOW_CREATION_STAGE_VALUES).optional(),
					approvalStatus: z.enum(PUBLIC_FLOW_APPROVAL_STATUS_VALUES).optional(),
					hasUpstreamTextEvidence: z.boolean().optional(),
					hasDownstreamComposeVideo: z.boolean().optional(),
				})
				.optional(),
		})
		.optional()
		.openapi({
			description:
				"前端传给 agents bridge 的结构化对话上下文。用于后端统一构建 system prompt，避免前端自行拼接整段 prompt。",
		}),
	generationContract: PublicChatGenerationContractSchema.optional().openapi({
		description:
			"薄执行合同：用于把当前已锁定的连续性锚点、唯一可编辑变量、禁止漂移项和已确认关键帧状态，从 /public/agents/chat 显式传给 agents bridge 与 agents-cli。",
	}),
	requestedImageCount: z.number().int().min(1).max(15).optional().openapi({
		description:
			"期望产图数量（主要用于 mode=auto 的回填与兜底出图目标张数）。",
		example: 1,
	}),
	aspectRatio: z.string().max(20).optional().openapi({
		description:
			"期望画幅比例（例如 1:1 / 4:3 / 3:4 / 16:9 / 9:16）。用于 auto 兜底出图。",
		example: "9:16",
	}),
	referenceImages: z.array(z.string()).optional().openapi({
		description:
			"参考图片 URL 列表（用于 chat/auto 模式；建议按需提供，不限制数量）。",
		example: ["https://example.com/reference.png"],
	}),
	selectedMediaReferences: z
		.array(
			z.object({
				nodeId: z.string().min(1).max(120).optional(),
				kind: z.enum(PUBLIC_CHAT_SELECTED_MEDIA_KINDS),
				url: z.string().min(1).max(2048),
				thumbnailUrl: z.string().min(1).max(2048).optional(),
				label: z.string().min(1).max(200).optional(),
			}),
		)
		.max(24)
		.optional()
		.openapi({
			description:
				"用户在画布/聊天框中显式选中的媒体引用。图片仍会同时走 referenceImages/assetInputs；视频以 videoUrl 事实传给 agents，不能混入 referenceImages。",
		}),
	assetInputs: z
		.array(
			z
				.object({
					assetId: z.string().min(1).max(120).optional(),
					assetRefId: z.string().min(1).max(160).optional(),
					url: z.string().min(1).max(2048).optional(),
					role: z.enum(PUBLIC_CHAT_ASSET_ROLES).optional().openapi({
						description:
							"资产角色：target=被改造目标；reference/character/scene/prop/product/style/context/mask=辅助参考。",
						example: "reference",
					}),
					weight: z.number().min(0).max(1).optional().openapi({
						description: "该资产参考权重，0-1。",
						example: 0.8,
					}),
					note: z.string().max(500).optional().openapi({
						description: "该资产的补充说明（简短）。",
						example: "保留角色发型和服饰轮廓",
					}),
					name: z.string().min(1).max(200).optional().openapi({
						description: "该资产的稳定命名引用，可供 agents 以 @name 语义使用。",
						example: "女主角色卡",
					}),
				})
				.refine((v) => Boolean((v.assetId || "").trim() || (v.url || "").trim()), {
					message: "assetInputs 每项至少提供 assetId 或 url",
					path: ["assetId"],
				}),
		)
		.optional()
		.openapi({
			description:
				"多资产输入契约（推荐）。用于把目标图/参考图/角色图等结构化传给 agents-cli，不再写死“仅两图”或固定张数上限。",
		}),
	disableQualityReview: z.boolean().optional().openapi({
		description:
			"是否禁用候选图质检/排序流程（默认 true）。开启后会强制走“直接生成”路径，不做逐张候选评审。",
		example: true,
	}),
	debug: z.boolean().optional().openapi({
		description:
			"是否回显调试日志（默认 false）。开启后响应会附带 debugLogs/debug，便于定位自动生成链路问题。",
		example: true,
	}),
	planOnly: z.boolean().optional().openapi({
		description:
			"仅输出规划偏好。对 agents 专用聊天入口这不是本地硬拦截；bridge 仍会保留执行工具，由 agents 基于真实意图与证据自主决定是否只返回规划或直接执行。",
		example: true,
	}),
	forceAssetGeneration: z.boolean().optional().openapi({
		description:
			"强制本轮优先尝试真实资产生成/生成节点落地，而不是只给提示词或抽象建议。若证据或权限不足导致无法生成，应显式失败并返回缺口。",
		example: true,
	}),
	disableMemory: z.boolean().optional().openapi({
		description:
			"禁用本轮 memory 读写（不注入已有记忆到 prompt，不在对话后存储新记忆）。",
		example: true,
	}),
}).refine(
	(v) =>
		(typeof v.prompt === "string" && v.prompt.trim().length > 0) ||
		(typeof v.input === "string" && v.input.trim().length > 0) ||
		(Array.isArray(v.input) && v.input.length > 0),
	{
		message: "prompt 或 input 至少提供一个",
		path: ["prompt"],
	},
);

export type AgentsChatRequestDto = z.infer<typeof AgentsChatRequestSchema>;

export const AgentsChatResponseSchema = z.object({
	id: z.string(),
	vendor: z.string(),
	text: z.string(),
	assets: z
		.array(
				z.object({
					type: z.string().optional(),
					title: z.string().optional(),
					url: z.string().optional(),
					thumbnailUrl: z.string().optional(),
					assetId: z.string().optional(),
					assetRefId: z.string().optional(),
					vendor: z.string().optional(),
					modelKey: z.string().optional(),
					taskId: z.string().optional(),
				}),
		)
		.optional(),
	agentDecision: PublicChatAgentDecisionSchema.optional(),
	trace: PublicChatTraceSchema.optional(),
	debugLogs: z.array(z.string()).optional(),
	debug: z
		.object({
			mode: z.enum(["chat", "auto"]).optional(),
			referenceImagesCount: z.number().optional(),
			rawAssetCount: z.number().optional(),
			autoJsonAssetCount: z.number().optional(),
			mergedAssetCount: z.number().optional(),
			autoJson: z
				.object({
					present: z.boolean(),
					total: z.number().optional(),
					valid: z.number().optional(),
					empty: z.number().optional(),
				})
				.optional(),
		})
		.optional(),
});

export type AgentsChatResponseDto = z.infer<typeof AgentsChatResponseSchema>;

export const PublicVisionRequestSchema = z
	.object({
		vendor: z.string().optional().openapi({
			description:
				"指定厂商 key（默认 auto）；vendor=auto 会从系统级已启用且已配置的厂商列表中依次重试，直到成功或候选耗尽。",
			example: "auto",
		}),
		vendorCandidates: z.array(z.string()).optional().openapi({
			description:
				"当 vendor=auto 时用于限制候选厂商列表（仅用于自动回退范围与顺序；最终仍会过滤掉系统级未启用/未配置的厂商）。",
			example: ["yunwu"],
		}),
		imageUrl: z.string().optional().openapi({
			description: "图片 URL（http(s)）；也支持传相对路径（以本次请求的 origin 补全）。",
			example:
				"https://github.com/dianping/cat/raw/master/cat-home/src/main/webapp/images/logo/cat_logo03.png",
		}),
		imageData: z.string().optional().openapi({
			description: "图片 DataURL（data:image/*;base64,...）。",
			example: "data:image/png;base64,...",
		}),
		prompt: z.string().optional().openapi({
			description:
				"图片理解任务提示词（可选；为空时服务端会使用默认指令）。若调用方已提供 prompt，服务端会原样透传，不做静默改写或自动拼接。",
			example:
				"请详细分析我提供的图片，推测可用于复现它的英文提示词，包含主体、环境、镜头、光线和风格。输出必须是纯英文提示词，不要添加中文备注或翻译。",
		}),
		modelKey: z.string().optional().openapi({
			description: "模型 Key（厂商内；可选）。",
			example: "gemini-1.5-pro-latest",
		}),
		modelAlias: z.string().optional().openapi({
			description:
				"模型别名（Public 统一别名；推荐）。若其值恰好等于真实 model_key，服务端也会按精确 model_key 解析；未提供时只会使用统一 model config 中已启用的模型，不注入内置默认模型。",
			example: "your-enabled-vision-model",
		}),
		systemPrompt: z.string().optional().openapi({
			description: "系统提示词（可选）。",
			example: "请用中文回答。",
		}),
		temperature: z.number().min(0).max(2).optional().openapi({
			description: "采样温度（可选）。",
			example: 0.2,
		}),
	})
	.refine((v) => Boolean(v.imageUrl || v.imageData), {
		message: "imageUrl 或 imageData 必须提供一个",
		path: ["imageUrl"],
	});

export type PublicVisionRequestDto = z.infer<typeof PublicVisionRequestSchema>;

export const PublicVisionResponseSchema = z.object({
	id: z.string(),
	vendor: z.string(),
	text: z.string(),
});

export type PublicVisionResponseDto = z.infer<typeof PublicVisionResponseSchema>;

// ---- Public tasks (open single workspace) ----

export const PublicRunTaskRequestSchema = z.object({
	vendor: z.string().optional().openapi({
		description:
			"指定厂商 key（默认 auto）；vendor=auto 会从系统级已启用且已配置的厂商列表中依次重试，直到成功或候选耗尽。",
		example: "auto",
	}),
	vendorCandidates: z.array(z.string()).optional().openapi({
		description:
			"当 vendor=auto 时用于限制候选厂商列表；最终仍会过滤掉系统级未启用/未配置的厂商，候选全部不可用时显式失败。",
		example: ["apimart"],
	}),
	request: TaskRequestSchema,
});

export type PublicRunTaskRequestDto = z.infer<typeof PublicRunTaskRequestSchema>;

export const PublicRunTaskResponseSchema = z.object({
	vendor: z.string(),
	result: TaskResultSchema,
});

export type PublicRunTaskResponseDto = z.infer<typeof PublicRunTaskResponseSchema>;

export const PublicFetchTaskResultRequestSchema = z.object({
	taskId: z.string().min(1),
	vendor: z.string().optional().openapi({
		description:
			"任务所属厂商（可选）；不传或传 auto 时会尝试基于 taskId 推断；若无法推断则需要显式传 vendor。",
		example: "auto",
	}),
	taskKind: TaskKindSchema.optional(),
	prompt: z.string().nullable().optional(),
});

export type PublicFetchTaskResultRequestDto = z.infer<
	typeof PublicFetchTaskResultRequestSchema
>;

export const PublicFetchTaskResultResponseSchema = z.object({
	vendor: z.string(),
	result: TaskResultSchema,
});

export type PublicFetchTaskResultResponseDto = z.infer<
	typeof PublicFetchTaskResultResponseSchema
>;

export const PublicDrawRequestSchema = z.object({
	vendor: z.string().optional().openapi({
		description:
			"指定厂商 key（默认 auto）；vendor=auto 会从系统级已启用且已配置的厂商列表中依次重试，直到成功或候选耗尽。",
		example: "auto",
	}),
	vendorCandidates: z.array(z.string()).optional().openapi({
		description:
			"当 vendor=auto 时用于限制候选厂商列表（仅用于自动回退范围与顺序；最终仍会过滤掉系统级未启用/未配置的厂商）。",
		example: ["apimart"],
	}),
	async: z.boolean().optional().openapi({
		description:
			"是否异步执行（立即返回 taskId，结果通过 /public/tasks/result 轮询）。默认 false；vendor=tuzi 时会默认启用（除非显式传 async=false）。",
		example: true,
	}),
	kind: z.enum(["text_to_image", "image_edit"]).optional().openapi({
		description: "任务类型（默认 text_to_image）。",
		example: "text_to_image",
	}),
	prompt: z.string().min(1).openapi({
		description: "提示词（必填）。",
		example: "一张电影感海报，中文“JarvisHub”，高细节，干净背景",
	}),
	negativePrompt: z.string().optional().openapi({
		description: "反向提示词（可选；不同厂商可能忽略）。",
		example: "low quality, blurry, watermark",
	}),
	seed: z.number().optional().openapi({
		description: "随机种子（可选；不同厂商可能忽略）。",
		example: 42,
	}),
	width: z.number().optional().openapi({
		description:
			"宽度（像素）。目前仅 qwen 会严格使用；其他厂商可能仅用于推断横竖构图/选择 portrait/landscape。",
		example: 1328,
	}),
	height: z.number().optional().openapi({
		description:
			"高度（像素）。目前仅 qwen 会严格使用；其他厂商可能仅用于推断横竖构图/选择 portrait/landscape。",
		example: 1328,
	}),
	steps: z.number().optional().openapi({
		description: "采样步数（可选；不同厂商可能忽略）。",
		example: 30,
	}),
	cfgScale: z.number().optional().openapi({
		description: "提示词强度/CFG（可选；不同厂商可能忽略）。",
		example: 7,
	}),
	extras: z.record(z.unknown()).optional().openapi({
		description:
			"额外参数透传（常用：modelAlias/modelKey/aspectRatio/referenceImages/resolution）。不同厂商/通道支持不一致。",
		example: {
			modelAlias: "nano-banana-pro",
			aspectRatio: "1:1",
		},
	}),
});

export type PublicDrawRequestDto = z.infer<typeof PublicDrawRequestSchema>;

export const PublicVideoRequestSchema = z.object({
	vendor: z.string().optional().openapi({
		description:
			"指定厂商 key（默认 auto）；vendor=auto 会从系统级已启用且已配置的厂商列表中依次重试，直到成功或候选耗尽。",
		example: "auto",
	}),
	vendorCandidates: z.array(z.string()).optional().openapi({
		description:
			"当 vendor=auto 时用于限制候选厂商列表（仅用于自动回退范围与顺序；最终仍会过滤掉系统级未启用/未配置的厂商）。",
		example: ["apimart"],
	}),
	prompt: z.string().min(1),
	durationSeconds: z.number().optional(),
	extras: z.record(z.unknown()).optional(),
});

export type PublicVideoRequestDto = z.infer<typeof PublicVideoRequestSchema>;

export const PublicOssUploadRequestSchema = z
	.object({
		sourceUrl: z.string().optional().openapi({
			description: "待上传的远端文件 URL（http/https）。",
			example: "https://example.com/sample.mp4",
		}),
		dataUrl: z.string().optional().openapi({
			description: "待上传文件的 Data URL（data:<mime>;base64,...）。",
			example: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
		}),
		fileName: z.string().optional().openapi({
			description: "原始文件名（可选，用于扩展名推断）。",
			example: "sample.mp4",
		}),
		contentType: z.string().optional().openapi({
			description: "内容类型（可选；优先于 fileName 推断）。",
			example: "video/mp4",
		}),
		name: z.string().optional().openapi({
			description: "资产展示名（可选）。",
			example: "产品演示视频",
		}),
		prompt: z.string().optional(),
		vendor: z.string().optional(),
		modelKey: z.string().optional(),
		taskKind: z.string().optional(),
	})
	.refine((v) => Boolean(v.sourceUrl || v.dataUrl), {
		message: "sourceUrl 或 dataUrl 必须提供一个",
		path: ["sourceUrl"],
	});

export type PublicOssUploadRequestDto = z.infer<typeof PublicOssUploadRequestSchema>;

export const PublicOssUploadResponseSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.enum(["image", "video", "file"]),
	url: z.string(),
	key: z.string(),
	contentType: z.string(),
	size: z.number().nullable(),
});

export type PublicOssUploadResponseDto = z.infer<typeof PublicOssUploadResponseSchema>;

export const PublicVideoUnderstandRequestSchema = z.object({
	vendor: z.string().optional().openapi({
		description: "厂商 key（默认 auto；推荐配合 vendorCandidates=['gemini']）。",
		example: "auto",
	}),
	vendorCandidates: z.array(z.string()).optional().openapi({
		description: "vendor=auto 时候选厂商（建议只放 gemini）。",
		example: ["gemini"],
	}),
	prompt: z.string().min(1).openapi({
		description: "视频理解任务提示词（例如总结、镜头拆解、问答等）。",
		example: "请总结视频内容并输出 5 个镜头段落。",
	}),
	videoFileUri: optionalNonEmptyString.openapi({
		description: "Gemini Files API 返回的 file_uri（可选；若未提供可用 videoUrl/videoData 自动上传）。",
		example: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
	}),
	videoUrl: z.string().optional().openapi({
		description: "远程视频 URL（http/https）。当未传 videoFileUri 时，服务端会下载并上传为 Gemini file_uri。",
		example: "https://example.com/sample.mp4",
	}),
	videoData: z.string().optional().openapi({
		description: "视频 Data URL（data:video/*;base64,...）。当未传 videoFileUri 时，服务端会上传为 Gemini file_uri。",
		example: "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb20...",
	}),
	videoMimeType: z.string().optional().openapi({
		description: "视频 MIME（默认 video/mp4）。",
		example: "video/mp4",
	}),
	modelAlias: z.string().optional().openapi({
		description: "模型别名（推荐文本模型别名）。",
		example: "gemini-3-flash-preview",
	}),
	modelKey: z.string().optional().openapi({
		description: "模型 key（可选）。",
		example: "gemini-3-flash-preview",
	}),
	systemPrompt: z.string().optional().openapi({
		description: "系统提示词（可选）。",
		example: "请用中文回答。",
	}),
	temperature: z.number().min(0).max(2).optional().openapi({
		description: "采样温度（可选）。",
		example: 0.2,
	}),
}).refine((v) => Boolean(v.videoFileUri || v.videoUrl || v.videoData), {
	message: "videoFileUri / videoUrl / videoData 至少提供一个",
	path: ["videoFileUri"],
});

export type PublicVideoUnderstandRequestDto = z.infer<typeof PublicVideoUnderstandRequestSchema>;

export const PublicVideoUnderstandResponseSchema = z.object({
	id: z.string(),
	vendor: z.string(),
	text: z.string(),
	result: TaskResultSchema,
});

export type PublicVideoUnderstandResponseDto = z.infer<typeof PublicVideoUnderstandResponseSchema>;
