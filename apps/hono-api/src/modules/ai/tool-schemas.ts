/**
 * AI tool contracts + canvas node capability specs.
 *
 * NOTE: This file is intentionally a lightweight, implementation-aligned
 * source of truth for model/node capabilities (kept in sync with apps/web).
 * Manifest does not expose model selection fields — model selection is owned
 * by the user (node-level override) or the global default table, not by the agent.
 */

export type CanvasNodeKind =
	| "text"
	| "imageEdit"
	| "image"
	| "webHero"
	| "imageFission"
	| "mosaic"
	| "video"
	| "composeVideo"
	| "audio"
	| "subtitle";

export type CanvasCapabilityToolSchema = {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
};

export type CanvasCapabilityNodeSpec = {
	label: string;
	purpose: string;
	output?: Record<string, string>;
	fields?: Record<string, string>;
	input?: Record<string, string>;
};

export type CanvasCapabilityManifest = {
	version: string;
	summary: string;
	remoteTools: CanvasCapabilityToolSchema[];
	nodeSpecs: Record<string, CanvasCapabilityNodeSpec>;
	protocols: {
		flowPatch: {
			supportedMutationOperations: readonly string[];
			supportedCreateNodeTypes: readonly string[];
			supportedTaskNodeKinds: readonly CanvasNodeKind[];
			groupedWriteLayout: readonly string[];
			handleMatrix: {
				textLikeTargets: readonly string[];
				textLikeSources: readonly string[];
				imageLikeTargets: readonly string[];
				imageLikeSources: readonly string[];
				videoLikeTargets: readonly string[];
				videoLikeSources: readonly string[];
			};
		};
		executionModel: {
			assetGenerationFlow: readonly string[];
		};
	};
};

const FLOW_PATCH_SUPPORTED_CREATE_NODE_TYPES = ["taskNode", "groupNode"] as const;
const FLOW_PATCH_SUPPORTED_TASK_NODE_KINDS = [
	"text",
	"imageEdit",
	"image",
	"webHero",
	"imageFission",
	"mosaic",
	"video",
	"composeVideo",
	"audio",
	"subtitle",
] as const satisfies readonly CanvasNodeKind[];

/**
 * Node kind + model capability specs.
 * Keep this aligned with the frontend model lists / runner constraints.
 */
export const canvasNodeSpecs = {
	text: {
		label: "文本",
		purpose: "统一文本节点，承载通用 prompt_refine/chat 结果，可作为脚本与文案中间层；允许创建空文本节点作为占位或后续补写锚点。",
		output: {
			textResults: "Array<{ text: string }>",
		},
		fields: {
			prompt: "string (optional; empty text node allowed)",
			systemPrompt: "string (optional)",
		},
	},
	webHero: {
		label: "网页交付",
		purpose:
			"承载网站/落地页/WebHero 的最终代码交付目标。最终网页代码必须写入 webHeroHtml、webHeroCss、webHeroDocumentHtml；不要把最终代码写入 text 节点。",
		fields: {
			label: "string (visible canvas title)",
			prompt: "string (website brief)",
			webHeroHtml: "string (final body/section HTML)",
			webHeroCss: "string (final CSS)",
			webHeroDocumentHtml: "string (full final HTML document)",
		},
		output: {
			webHeroDocumentHtml: "完整可预览 HTML 文档",
		},
	},
	video: {
		label: "图生/文生视频",
		purpose: "视频执行节点。`prompt` 是唯一真实执行的视频生产提示词，运行时会在此基础上继续拼接画布连入的文本节点内容。视频参数遵循 image_to_video 最小契约：duration 4..15 秒整数，size 为 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9 / adaptive，generate_audio 控制有声视频。direct videogen 画布持久化与计费规格固定为 720p。所有参考图统一作为 reference_image 传给后端，不再发送首帧/尾帧 role。模型由服务端按用户配置/全局默认强制选择；node.data 不得携带任何模型/厂商相关字段，传入即被拒。若需要导演视角、经典镜头借鉴、动作边界或物理约束，必须直接写进 `prompt`。若上游是长镜头脚本，应优先把逐段文本拆成多个 text 节点后再连接到 composeVideo/video。",
		fields: {
			prompt: "string (required executable production prompt)",
			storyBeatPlan: "Array<string | { summary: string; rhythm?: string; durationSec?: number; motionIntensity?: string; continuity?: string; cameraMotion?: string }> (required human-readable beat list)",
			referenceImages: "string[] (required real public image URL; runtime sends each URL as provider reference_image input)",
			durationSeconds: "integer 4..15",
			size: "16:9 | 9:16 | 1:1 | 4:3 | 3:4 | 21:9 | adaptive",
			generate_audio: "boolean (optional)",
		},
	},
	image: {
		label: "图像",
		purpose:
			"统一图像生成节点；支持文生图与图生图，输出候选图与主图。若本轮已确认角色卡/权威基底帧/场景锚点，必须把 referenceImages 连同角色职责一起持久化到节点数据，不能只在 prompt 文案里口头提到。提示词应尽量具体，包含用途/上下文、主体数量、空间关系、镜头、光线、材质与情绪；复杂画面可分步描述，并优先用正向语义定义目标场景而不是简单堆负面词。需要高精度控制时，可直接使用英文或中英混合镜头语言。模型由服务端按用户配置/全局默认强制选择；node.data 不得携带任何模型/厂商相关字段，传入即被拒。",
		output: {
			imageResults: "Array<{ url: string; title?: string; shotNo?: number }>",
			imageUrl: "string (primary)",
		},
		fields: {
			label: "string (visible canvas title; required for generated images, especially multi-image outputs)",
			shotNo:
				"number (optional positive display order; required for multi-image outputs when this node represents one shot)",
			prompt: "string",
			structuredPrompt:
				"optional ImagePromptSpecV2 JSON view of the same executable prompt. Prefer filling referenceBindings + identityConstraints instead of leaving reference reuse implicit.",
			systemPrompt: "string (optional)",
			referenceImages:
				"string[] (optional but mandatory when this node must directly reuse request-carried reference images and no canvas edge carries them)",
			imageCameraControl:
				"optional { enabled?: boolean; presetId?: 'front'|'left'|'right'|'back'|'left45'|'right45'|'topDown'|'lowAngle'; azimuthDeg?: number; elevationDeg?: number; distance?: number }. When enabled, runtime will append a 3D-camera-style viewpoint instruction to the final prompt.",
			imageLightingRig:
				"optional { main?: { enabled?: boolean; presetId?: 'left'|'top'|'right'|'topLeft'|'front'|'topRight'|'bottom'|'back'; azimuthDeg?: number; elevationDeg?: number; intensity?: number; colorHex?: string }; fill?: same-shape }. When enabled, runtime will append main/fill lighting instructions to the final prompt.",
			imageTaskId:
				"string (runtime task id written by canvas_image_generate_to_canvas for queued/running direct image tasks; canvas_image_wait_for_result uses it to poll and patch the same node)",
			imageTaskKind:
				"'text_to_image' | 'image_edit' (runtime task kind written by direct image generation so wait/result polling uses the same task endpoint semantics)",
			aspect:
				"string (deprecated alias for aspectRatio; do not use in new payloads)",
			aspectRatio:
				"Allowed values: '1:1' | '3:2' | '2:3' | '4:3' | '3:4' | '5:4' | '4:5' | '16:9' | '9:16' | '2:1' | '1:2' | '21:9' | '9:21'. May also accept literal 'WIDTHxHEIGHT' pixel string for vendors that need explicit pixels. NOTE: when this image node carries `webPreviewForNodeId` (i.e. it is a WebHero webpage preview screenshot), the canvas preview slot is hard-locked to 16:9 layout (700x394 display box); any other aspectRatio supplied for preview nodes will be ignored by the bridge — do not waste tokens picking a different aspect for preview nodes.",
			size:
				"string (deprecated alias for aspectRatio; do not use in new payloads)",
			imageSize:
				"string (deprecated alias for imageResolution; do not use in new payloads)",
			imageResolution:
				"Allowed values: '1k' | '2k' | '4k' (default comes from the configured image model's defaultImageSize; built-in WebHero fallback is '1k' for APIMart/GPT-Image-2 and '2k' for Gateway safety). IMPORTANT: Gateway gpt-image-2 has a minimum pixel budget (~1,000,000 pixels). For non-square aspectRatio (anything other than '1:1'), the '1k' tier is REJECTED by Gateway server-side (e.g. '16:9'+'1k'=1024x576 fails). For non-square Gateway requests, choose '2k' or '4k'. For square '1:1', all tiers pass. For WebHero preview nodes (those with `webPreviewForNodeId`) and WebHero webpage asset nodes (those with `webPageAssetForNodeId`), omit this field unless the user/model config explicitly asks for a higher tier.",
			resolution:
				"string (deprecated alias for imageResolution; do not use in new payloads)",
			sampleCount:
				"number (optional; vendor adapter decides whether to honor it)",
			reversePrompt: "string (optional)",
			webPreviewForNodeId:
				"string (optional; when set, this image node is treated as a WebHero webpage preview screenshot for the referenced webHero nodeId. Triggers preview-slot constraints: aspectRatio is hard-locked to 16:9 (layout), nodeWidth/nodeHeight are forced to 700x394, imageResolution defaults from the configured image model; built-in APIMart/GPT-Image-2 fallback is '1k'. '1k' plus locked 16:9 is rejected by Gateway's minimum pixel budget, so use '2k' or higher when Gateway is the resolved vendor.",
		},
	},
	imageEdit: {
		label: "图片编辑",
		purpose:
			"统一图像编辑节点；以入图为基础做风格/构图/细节编辑，功能以可选能力启用。若编辑任务依赖明确角色或道具身份，必须保留原始 referenceImages 与绑定语义，避免编辑后漂移成默认人物或默认物体。模型由服务端按用户配置/全局默认强制选择；node.data 不得携带任何模型/厂商相关字段，传入即被拒。",
		output: {
			imageResults: "Array<{ url: string; title?: string; shotNo?: number }>",
			imageUrl: "string (primary)",
		},
		fields: {
			label: "string (visible canvas title; required for generated image edit outputs)",
			shotNo:
				"number (optional positive display order; use when the edit belongs to a multi-image sequence)",
			prompt: "string",
			systemPrompt: "string (optional)",
			referenceImages:
				"string[] (recommended when editing should use the current image as the primary base frame; runtime treats non-empty referenceImages as image_edit execution)",
			imageCameraControl:
				"optional camera control object with the same contract as image nodes. Use it when the edit should change viewpoint via prompt injection instead of freeform prompt prose only.",
			imageLightingRig:
				"optional lighting rig object with the same contract as image nodes. Use it when the edit should relight the reference with explicit main/fill light directions.",
			imageTaskId:
				"string (runtime task id written by canvas_image_generate_to_canvas for queued/running direct image edit tasks; canvas_image_wait_for_result uses it to poll and patch the same node)",
			imageTaskKind:
				"'text_to_image' | 'image_edit' (runtime task kind written by direct image generation so wait/result polling uses the same task endpoint semantics)",
			aspect:
				"string (deprecated alias for aspectRatio; do not use in new payloads)",
			aspectRatio:
				"Allowed values: '1:1' | '3:2' | '2:3' | '4:3' | '3:4' | '5:4' | '4:5' | '16:9' | '9:16' | '2:1' | '1:2' | '21:9' | '9:21'. May also accept literal 'WIDTHxHEIGHT' pixel string.",
			size:
				"string (deprecated alias for aspectRatio; do not use in new payloads)",
			imageSize:
				"string (deprecated alias for imageResolution; do not use in new payloads)",
			imageResolution:
				"Allowed values: '1k' | '2k' | '4k' (default '2k'). IMPORTANT: Gateway has a minimum pixel budget (~1,000,000 pixels); non-square aspectRatio + '1k' is rejected by Gateway server-side. For non-square aspectRatio, use '2k' or higher.",
			resolution:
				"string (deprecated alias for imageResolution; do not use in new payloads)",
			sampleCount:
				"number (optional; vendor adapter decides whether to honor it)",
		},
	},
} as const satisfies Record<string, unknown>;

export function buildCanvasCapabilityManifest(input?: {
	remoteTools?: readonly CanvasCapabilityToolSchema[];
}): CanvasCapabilityManifest {
	const supportedTaskNodeKinds = FLOW_PATCH_SUPPORTED_TASK_NODE_KINDS;
	const nodeSpecs = canvasNodeSpecs;
	return {
		version: "2026-04-20",
		summary:
			"JarvisHub canvas capability manifest. Use this as the source of truth for real canvas interfaces, node kinds, flow patch constraints, and bridge-exposed remote tools. Do not invent node kinds, handles, or write paths outside this manifest.",
		remoteTools: (input?.remoteTools || []).map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		})),
		nodeSpecs: nodeSpecs as Record<string, CanvasCapabilityNodeSpec>,
		protocols: {
			flowPatch: {
				supportedMutationOperations: [
					"deleteNodeIds",
					"deleteEdgeIds",
					"createNodes",
					"createEdges",
					"patchNodeData",
					"appendNodeArrays",
				],
				supportedCreateNodeTypes: FLOW_PATCH_SUPPORTED_CREATE_NODE_TYPES,
				supportedTaskNodeKinds,
				groupedWriteLayout: [
					"When createNodes writes grouped nodes (groupNode containers or child nodes with parentId), persisted flow data is normalized parent-first before save.",
					"Each affected group is compacted after write, and grouped child node order follows the final node list order. Put grouped children in the exact visual sequence you want preserved.",
					"deleteNodeIds removes existing nodes by id and cascades connected edge removal; deleteEdgeIds removes only the listed edges.",
				],
				handleMatrix: {
					textLikeTargets: [],
					textLikeSources: ["out-text", "out-text-wide"],
					imageLikeTargets: ["in-image", "in-image-wide"],
					imageLikeSources: ["out-image", "out-image-wide"],
					videoLikeTargets: ["in-any", "in-any-wide"],
					videoLikeSources: ["out-video", "out-video-wide"],
				},
			},
				executionModel: {
					assetGenerationFlow: [
						"When a direct media tool returns pending=true and the turn requires finished media or downstream URLs, agents must call the matching wait tool before claiming delivery.",
					],
				},
		},
	};
}
