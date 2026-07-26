import { randomUUID } from "node:crypto";
import { streamSSE } from "hono/streaming";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import {
	buildAgentsChatResponseFromTaskResult,
	persistAgentsChatConversationTurn,
} from "../apiKey/public-agents-chat-response";
import {
	AgentsChatRequestSchema,
	type AgentsChatRequestDto,
} from "../apiKey/apiKey.schemas";
import { createPublicChatUiSnapshotAccumulator } from "../apiKey/public-chat-ui-snapshot";
import {
	appendPublicChatRunEvent,
	createPublicChatRun,
	findPublicChatRunById,
	findPublicChatSessionByKey,
	listActivePublicChatRuns,
	listPublicChatMessages,
	listPublicChatRunEventsAfter,
	markStalePublicChatRunsAsFailed,
	normalizePublicChatAskUserPrompt,
	resolveOrCreatePublicChatSession,
	updatePublicChatRunStatus,
	upsertPublicChatMessage,
	type PublicChatAskUserOptionCard,
	type PublicChatRunEventRow,
	type PublicChatRunRow,
} from "../apiKey/public-chat-session.repo";
import type { TaskRequestDto, TaskResultDto } from "./task.schemas";
import { runAgentsBridgeChatTask, type AgentsBridgeAskUserPrompt } from "./task.agents-bridge";

type ResponsesInputPromptResolution = {
	prompt: string;
	referenceImages: string[];
};

type AskUserOptionCardSelection = {
	card: PublicChatAskUserOptionCard;
	prompt: string;
};

type StreamWritable = {
	writeSSE: (input: { id?: string; event: string; data: string }) => Promise<void>;
};

type StreamErrorPayload = {
	message: string;
	code?: string;
	details?: unknown;
};

type PublicChatRunDto = {
	runId: string;
	status: PublicChatRunRow["status"];
	sessionKey: string;
	canvasProjectId: string | null;
	canvasFlowId: string | null;
	requestText: string;
	displayText: string;
	userMessageId: string;
	assistantMessageId: string;
	request: unknown;
	response: unknown;
	error: unknown;
	createdAt: string;
	updatedAt: string;
	finishedAt: string | null;
};

type ExecutionContextLike = {
	waitUntil: (promise: Promise<unknown>) => void;
};

const FORWARDED_STREAM_EVENTS = new Set([
	"content",
	"media_result",
	"thinking",
	"tool",
	"todo_list",
	"thread.started",
	"turn.started",
	"item.started",
	"item.updated",
	"item.completed",
	"turn.completed",
]);

const STREAM_POLL_INTERVAL_MS = 350;
const STREAM_REPLAY_BATCH_SIZE = 100;
const MEDIA_RESULT_STREAM_GRACE_MS = 90 * 60_000;
const STALE_PUBLIC_CHAT_RUN_THRESHOLD_SECONDS = 10 * 60;
const STALE_PUBLIC_CHAT_RUN_SWEEP_LIMIT = 20;
const MEDIA_GENERATION_TOOL_NAMES = new Set([
	"canvas_image_generate_to_canvas",
	"canvas_video_generate_to_canvas",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRunEventData(dataJson: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(dataJson || "{}");
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function readRunEventString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionChoiceText(value: unknown): string {
	const raw = typeof value === "string" ? value.trim() : "";
	if (!raw) return "";
	const selectedMatch = raw.match(/已选择(?:视觉)?风格参考[：:\s]*([A-Za-z0-9_-]+)/i);
	if (selectedMatch?.[1]) return selectedMatch[1].trim().toLowerCase();
	const directMatch = raw.match(/^(?:选择|选|用|参考)?\s*([A-Za-z0-9_-])\s*$/i);
	if (directMatch?.[1]) return directMatch[1].trim().toLowerCase();
	return raw.toLowerCase();
}

export function matchAskUserOptionCardSelection(input: {
	prompt: string;
	cards: PublicChatAskUserOptionCard[];
}): AskUserOptionCardSelection | null {
	const choice = normalizeOptionChoiceText(input.prompt);
	if (!choice) return null;
	for (const card of input.cards) {
		const candidates = [
			card.value,
			card.displayValue,
			card.title,
		].map(normalizeOptionChoiceText).filter(Boolean);
		if (candidates.some((candidate) => candidate === choice)) {
			return { card, prompt: input.prompt };
		}
	}
	return null;
}

function buildAskUserOptionCardSelectionPrompt(selection: AskUserOptionCardSelection): string {
	const card = selection.card;
	const lines = [
		"<ask_user_option_card_selection>",
		`selectedValue=${card.value}`,
		card.displayValue ? `displayValue=${card.displayValue}` : "",
		card.title ? `title=${card.title}` : "",
		"referenceImagePolicy=metadata_only_do_not_read_external_url",
		"</ask_user_option_card_selection>",
	].filter(Boolean);
	return `${lines.join("\n")}\n\n${selection.prompt}`.trim();
}

export function mergeAskUserOptionCardSelectionIntoRequest(
	input: AgentsChatRequestDto,
	selection: AskUserOptionCardSelection | null,
): AgentsChatRequestDto {
	if (!selection?.card.imageUrl) return input;
	const card = selection.card;
	const prompt = buildAskUserOptionCardSelectionPrompt(selection);
	const selectedReference = {
		...(input.chatContext?.selectedReference ?? {}),
		label: card.title || card.displayValue || card.value,
		kind: "style_reference",
		imageUrl: card.imageUrl,
		sourceUrl: card.imageUrl,
		thumbnailUrl: card.thumbnailUrl,
		value: card.value,
	};
	return {
		...input,
		prompt,
		chatContext: {
			...(input.chatContext ?? {}),
			selectedReference,
		},
	};
}

async function resolveAskUserOptionCardSelectionFromSession(input: {
	c: AppContext;
	userId: string;
	sessionKey: string;
	prompt: string;
}): Promise<AskUserOptionCardSelection | null> {
	const sessionKey = input.sessionKey.trim();
	const prompt = input.prompt.trim();
	if (!sessionKey || !prompt) return null;
	const session = await findPublicChatSessionByKey(input.c.env.DB, {
		userId: input.userId,
		sessionKey,
	});
	if (!session) return null;
	const messages = await listPublicChatMessages(input.c.env.DB, {
		userId: input.userId,
		sessionId: session.id,
		limit: 12,
	});
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== "assistant" || !message.ask_user_prompt_json) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(message.ask_user_prompt_json);
		} catch {
			continue;
		}
		const askUserPrompt = normalizePublicChatAskUserPrompt(parsed);
		if (!askUserPrompt?.awaitingReply || !askUserPrompt.optionCards.length) continue;
		const selection = matchAskUserOptionCardSelection({
			prompt,
			cards: askUserPrompt.optionCards,
		});
		if (selection) return selection;
	}
	return null;
}

async function enrichRequestWithPendingAskUserSelection(input: {
	c: AppContext;
	userId: string;
	requestInput: AgentsChatRequestDto;
}): Promise<AgentsChatRequestDto> {
	const sessionKey =
		typeof input.requestInput.sessionKey === "string"
			? input.requestInput.sessionKey.trim()
			: "";
	const prompt =
		(typeof input.requestInput.displayPrompt === "string" && input.requestInput.displayPrompt.trim()) ||
		(typeof input.requestInput.prompt === "string" && input.requestInput.prompt.trim()) ||
		"";
	if (!sessionKey || !prompt) return input.requestInput;
	const selection = await resolveAskUserOptionCardSelectionFromSession({
		c: input.c,
		userId: input.userId,
		sessionKey,
		prompt,
	});
	return mergeAskUserOptionCardSelectionIntoRequest(input.requestInput, selection);
}

function readToolOutputRecord(payload: Record<string, unknown>): Record<string, unknown> | null {
	const outputJson = isRecord(payload.outputJson) ? payload.outputJson : null;
	const data = isRecord(outputJson?.data) ? outputJson.data : null;
	return data ?? outputJson;
}

function readMediaPendingKeyFromToolEvent(payload: Record<string, unknown>): string | null {
	const toolName = readRunEventString(payload.toolName);
	if (!MEDIA_GENERATION_TOOL_NAMES.has(toolName)) return null;
	const output = readToolOutputRecord(payload);
	if (!output || output.pending !== true) return null;
	return (
		readRunEventString(payload.toolCallId) ||
		readRunEventString(output.taskId) ||
		readRunEventString(output.nodeId) ||
		null
	);
}

export function applyMediaTailEvent(input: {
	pendingMediaKeys: Set<string>;
	eventName: string;
	dataJson: string;
}): void {
	const data = parseRunEventData(input.dataJson);
	if (!data) return;
	if (input.eventName === "tool") {
		const key = readMediaPendingKeyFromToolEvent(data);
		if (key) input.pendingMediaKeys.add(key);
		return;
	}
	if (input.eventName !== "media_result") return;
	const key =
		readRunEventString(data.toolCallId) ||
		readRunEventString(data.taskId) ||
		readRunEventString(data.nodeId);
	if (!key) return;
	if (data.pending === true) {
		input.pendingMediaKeys.add(key);
		return;
	}
	input.pendingMediaKeys.delete(key);
}

function normalizeHttpUrl(raw: unknown): string {
	return typeof raw === "string" && /^https?:\/\//i.test(raw.trim()) ? raw.trim() : "";
}

function mergeUniqueUrls(primary: string[], secondary: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of [...primary, ...secondary]) {
		const url = normalizeHttpUrl(item);
		if (!url || seen.has(url)) continue;
		seen.add(url);
		out.push(url);
	}
	return out;
}

function normalizeSelectedMediaReferences(
	value: AgentsChatRequestDto["selectedMediaReferences"],
): NonNullable<AgentsChatRequestDto["selectedMediaReferences"]> {
	if (!Array.isArray(value)) return [];
	const out: NonNullable<AgentsChatRequestDto["selectedMediaReferences"]> = [];
	const seen = new Set<string>();
	for (const item of value) {
		const url = normalizeHttpUrl(item.url);
		if (!url) continue;
		const kind = item.kind === "video" ? "video" : "image";
		const key = `${kind}|${String(item.nodeId || "").trim()}|${url}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const thumbnailUrl = normalizeHttpUrl(item.thumbnailUrl);
		const nodeId = typeof item.nodeId === "string" ? item.nodeId.trim() : "";
		const label = typeof item.label === "string" ? item.label.trim() : "";
		out.push({
			kind,
			url,
			...(nodeId ? { nodeId } : {}),
			...(thumbnailUrl ? { thumbnailUrl } : {}),
			...(label ? { label } : {}),
		});
	}
	return out;
}

function normalizeResponsesInputToPromptAndImages(inputValue: unknown): ResponsesInputPromptResolution {
	if (typeof inputValue === "string") {
		return { prompt: inputValue.trim(), referenceImages: [] };
	}
	if (!Array.isArray(inputValue)) {
		return { prompt: "", referenceImages: [] };
	}

	const textChunks: string[] = [];
	const latestUserTexts: string[] = [];
	const imageCandidates: string[] = [];
	const toolOutputs: string[] = [];

	for (const item of inputValue) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const entry = item as Record<string, unknown>;
		const entryType =
			typeof entry.type === "string" ? entry.type.trim().toLowerCase() : "";
		if (entryType === "function_call_output" || entryType === "tool_result") {
			const output =
				typeof entry.output === "string"
					? entry.output.trim()
					: typeof entry.content === "string"
						? entry.content.trim()
						: "";
			if (output) toolOutputs.push(output);
			continue;
		}

		const role =
			typeof entry.role === "string" ? entry.role.trim().toLowerCase() : "";
		const content = entry.content;
		if (typeof content === "string") {
			const text = content.trim();
			if (!text) continue;
			textChunks.push(text);
			if (role === "user") latestUserTexts.push(text);
			continue;
		}
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (!part || typeof part !== "object" || Array.isArray(part)) continue;
			const piece = part as Record<string, unknown>;
			const pieceType =
				typeof piece.type === "string" ? piece.type.trim().toLowerCase() : "";
			if (pieceType === "input_text" || pieceType === "text") {
				const text = typeof piece.text === "string" ? piece.text.trim() : "";
				if (!text) continue;
				textChunks.push(text);
				if (role === "user") latestUserTexts.push(text);
				continue;
			}
			if (pieceType === "input_image" || pieceType === "image_url") {
				const imageUrl =
					typeof piece.image_url === "string"
						? piece.image_url.trim()
						: piece.image_url &&
							  typeof piece.image_url === "object" &&
							  !Array.isArray(piece.image_url) &&
							  typeof (piece.image_url as Record<string, unknown>).url === "string"
							? String((piece.image_url as Record<string, unknown>).url).trim()
							: "";
				const normalizedImageUrl = normalizeHttpUrl(imageUrl);
				if (normalizedImageUrl) imageCandidates.push(normalizedImageUrl);
			}
		}
	}

	const latestUserText = latestUserTexts.length
		? latestUserTexts[latestUserTexts.length - 1] || ""
		: "";
	const basePrompt =
		latestUserText || (textChunks.length ? textChunks[textChunks.length - 1] || "" : "");
	const toolContext =
		toolOutputs.length > 0
			? `\n\n[Tool Outputs]\n${toolOutputs.map((text, index) => `#${index + 1}\n${text}`).join("\n\n")}`
			: "";
	return {
		prompt: `${basePrompt}${toolContext}`.trim(),
		referenceImages: mergeUniqueUrls(imageCandidates, []),
	};
}

export function buildTaskRequest(input: AgentsChatRequestDto): TaskRequestDto {
	const resolvedFromInput = normalizeResponsesInputToPromptAndImages(input.input);
	const prompt =
		typeof input.prompt === "string" && input.prompt.trim()
			? input.prompt.trim()
			: resolvedFromInput.prompt;
	if (!prompt) {
		throw new AppError("prompt 不能为空", {
			status: 400,
			code: "invalid_request",
		});
	}

	const referenceImages = mergeUniqueUrls(
		Array.isArray(input.referenceImages) ? input.referenceImages : [],
		resolvedFromInput.referenceImages,
	);
	const assetInputs = Array.isArray(input.assetInputs)
		? input.assetInputs.map((item) => ({ ...item }))
		: [];
	const selectedMediaReferences = normalizeSelectedMediaReferences(input.selectedMediaReferences);
	const extras: Record<string, unknown> = {
		...(typeof input.systemPrompt === "string" && input.systemPrompt.trim()
			? { systemPrompt: input.systemPrompt.trim() }
			: typeof input.instructions === "string" && input.instructions.trim()
				? { systemPrompt: input.instructions.trim() }
				: {}),
		...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
		...(typeof input.modelAlias === "string" && input.modelAlias.trim()
			? { modelAlias: input.modelAlias.trim() }
			: {}),
		...(typeof input.modelKey === "string" && input.modelKey.trim()
			? { modelKey: input.modelKey.trim() }
			: {}),
		...(typeof input.model === "string" && input.model.trim()
			? { modelAlias: input.model.trim() }
			: {}),
		...(typeof input.response_format !== "undefined"
			? { response_format: input.response_format }
			: {}),
		...(typeof input.mode === "string" ? { mode: input.mode } : {}),
		...(typeof input.bridgeTimeoutMs === "number" ? { bridgeTimeoutMs: input.bridgeTimeoutMs } : {}),
		...(Array.isArray(input.requiredSkills) && input.requiredSkills.length
			? { requiredSkills: input.requiredSkills }
			: {}),
		...(typeof input.sessionKey === "string" && input.sessionKey.trim()
			? { sessionKey: input.sessionKey.trim() }
			: {}),
		...(typeof input.canvasProjectId === "string" && input.canvasProjectId.trim()
			? { canvasProjectId: input.canvasProjectId.trim() }
			: {}),
		...(typeof input.canvasFlowId === "string" && input.canvasFlowId.trim()
			? { canvasFlowId: input.canvasFlowId.trim() }
			: {}),
		...(typeof input.canvasNodeId === "string" && input.canvasNodeId.trim()
			? { canvasNodeId: input.canvasNodeId.trim() }
			: {}),
		...(input.chatContext ? { chatContext: input.chatContext } : {}),
		...(typeof input.planOnly === "boolean" ? { planOnly: input.planOnly } : {}),
		...(typeof input.forceAssetGeneration === "boolean"
			? { forceAssetGeneration: input.forceAssetGeneration }
			: {}),
		...(referenceImages.length ? { referenceImages } : {}),
		...(selectedMediaReferences.length ? { selectedMediaReferences } : {}),
		...(assetInputs.length ? { assetInputs } : {}),
		...(input.generationContract ? { generationContract: input.generationContract } : {}),
		...(typeof input.debug === "boolean" ? { debug: input.debug } : {}),
		...(typeof input.disableMemory === "boolean" ? { disableMemory: input.disableMemory } : {}),
	};
	return {
		kind: "chat",
		prompt,
		extras,
	};
}

function formatPublicChatSkillMention(value: unknown): string {
	const raw = typeof value === "string" ? value.trim() : "";
	if (!raw) return "";
	const text = raw.replace(/^@+/, "").trim();
	return text ? `@${text.slice(0, 159)}` : "";
}

export function buildPublicChatSkillMention(input: AgentsChatRequestDto): string {
	const skill = input.chatContext?.skill;
	const fromContext = formatPublicChatSkillMention(skill?.key) || formatPublicChatSkillMention(skill?.name);
	if (fromContext) return fromContext;
	const firstRequiredSkill = Array.isArray(input.requiredSkills) ? input.requiredSkills[0] : "";
	return formatPublicChatSkillMention(firstRequiredSkill);
}

function toErrorMessage(error: unknown): string {
	if (error instanceof AppError) return error.message;
	if (error instanceof Error && error.message.trim()) return error.message;
	return "agents chat failed";
}

function toStreamErrorPayload(error: unknown): StreamErrorPayload {
	if (error instanceof AppError) {
		return {
			message: error.message,
			code: error.code,
			...(typeof error.details !== "undefined" ? { details: error.details } : {}),
		};
	}
	if (error instanceof Error && error.message.trim()) {
		return { message: error.message.trim() };
	}
	return { message: toErrorMessage(error) };
}

function safeParseJson(value: string | null): unknown {
	if (!value) return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function readJsonRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function buildSyntheticTerminalEventsForPublicChatRun(
	run: PublicChatRunRow,
): Array<{ event: string; data: unknown }> {
	if (run.status === "running") return [];
	if (run.status === "succeeded") {
		const stored = readJsonRecord(safeParseJson(run.response_json));
		const response = readJsonRecord(stored?.response) ?? stored;
		return [
			...(response ? [{ event: "result", data: { response } }] : []),
			{ event: "done", data: { reason: "finished" } },
		];
	}
	if (run.status === "failed") {
		const errorPayload = readJsonRecord(safeParseJson(run.error_json)) ?? {
			message: "agents chat failed",
			code: "public_chat_run_failed",
		};
		return [
			{ event: "error", data: errorPayload },
			{ event: "done", data: { reason: "error" } },
		];
	}
	return [
		{ event: "aborted", data: { reason: "aborted" } },
		{ event: "done", data: { reason: "aborted" } },
	];
}

function toPublicChatRunDto(row: PublicChatRunRow): PublicChatRunDto | null {
	const userMessageId = String(row.user_message_id || "").trim();
	const assistantMessageId = String(row.assistant_message_id || "").trim();
	if (!userMessageId || !assistantMessageId) return null;
	return {
		runId: row.id,
		status: row.status,
		sessionKey: row.session_key,
		canvasProjectId: row.canvas_project_id,
		canvasFlowId: row.canvas_flow_id,
		requestText: row.request_text,
		displayText: row.display_text,
		userMessageId,
		assistantMessageId,
		request: safeParseJson(row.request_json),
		response: safeParseJson(row.response_json),
		error: safeParseJson(row.error_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		finishedAt: row.finished_at,
	};
}

function buildPublicChatRunRequestMetadata(input: AgentsChatRequestDto): Record<string, unknown> {
	return {
		vendor: input.vendor,
		mode: input.mode,
		modelAlias: typeof input.modelAlias === "string" ? input.modelAlias : null,
		modelKey: typeof input.modelKey === "string" ? input.modelKey : null,
		model: typeof input.model === "string" ? input.model : null,
		sessionKey: typeof input.sessionKey === "string" ? input.sessionKey : null,
		canvasProjectId: typeof input.canvasProjectId === "string" ? input.canvasProjectId : null,
		canvasFlowId: typeof input.canvasFlowId === "string" ? input.canvasFlowId : null,
		canvasNodeId: typeof input.canvasNodeId === "string" ? input.canvasNodeId : null,
		planOnly: input.planOnly === true,
		forceAssetGeneration: input.forceAssetGeneration === true,
		stream: input.stream === true,
		referenceImageCount: Array.isArray(input.referenceImages) ? input.referenceImages.length : 0,
		assetInputCount: Array.isArray(input.assetInputs) ? input.assetInputs.length : 0,
		selectedMediaReferenceCount: Array.isArray(input.selectedMediaReferences)
			? input.selectedMediaReferences.length
			: 0,
	};
}

function getExecutionContext(c: AppContext): ExecutionContextLike | null {
	const maybeContext = c as AppContext & { executionCtx?: unknown };
	const executionCtx = maybeContext.executionCtx;
	if (!executionCtx || typeof executionCtx !== "object") return null;
	const candidate = executionCtx as { waitUntil?: unknown };
	const waitUntil = candidate.waitUntil;
	return typeof waitUntil === "function"
		? {
				waitUntil: (promise) => {
					waitUntil(promise);
				},
			}
		: null;
}

function scheduleBackgroundWork(c: AppContext, work: () => Promise<void>): void {
	const promise = work().catch((error) => {
		console.error("[public-agents-chat] background run failed", error);
	});
	const executionCtx = getExecutionContext(c);
	if (executionCtx) {
		executionCtx.waitUntil(promise);
		return;
	}
	void promise;
}

async function appendRunStreamEvent(input: {
	c: AppContext;
	runId: string;
	userId: string;
	event: string;
	data: unknown;
	nowIso?: string;
}): Promise<PublicChatRunEventRow | null> {
	return appendPublicChatRunEvent(input.c.env.DB, {
		runId: input.runId,
		userId: input.userId,
		eventName: input.event,
		data: input.data,
		nowIso: input.nowIso ?? new Date().toISOString(),
	});
}

const inflightPublicChatRunControllers = new Map<string, AbortController>();

function publicChatRunRegistryKey(userId: string, runId: string): string {
	return `${userId}::${runId}`;
}

export function registerPublicChatRunController(
	userId: string,
	runId: string,
	controller: AbortController,
): void {
	inflightPublicChatRunControllers.set(publicChatRunRegistryKey(userId, runId), controller);
}

export function releasePublicChatRunController(userId: string, runId: string): void {
	inflightPublicChatRunControllers.delete(publicChatRunRegistryKey(userId, runId));
}

export function getPublicChatRunController(userId: string, runId: string): AbortController | undefined {
	return inflightPublicChatRunControllers.get(publicChatRunRegistryKey(userId, runId));
}

function hasRegisteredPublicChatRunController(userId: string, runId: string): boolean {
	return Boolean(getPublicChatRunController(userId, runId));
}

async function terminalizeOrphanedPublicChatRun(input: {
	c: AppContext;
	userId: string;
	run: PublicChatRunRow;
	reason?: string;
	nowIso?: string;
}): Promise<boolean> {
	const runId = String(input.run.id || "").trim();
	if (!runId || input.run.status !== "running") return false;
	if (hasRegisteredPublicChatRunController(input.userId, runId)) return false;

	const nowIso = input.nowIso ?? new Date().toISOString();
	const reason = input.reason ?? "orphaned_after_restart";
	await appendRunStreamEvent({
		c: input.c,
		runId,
		userId: input.userId,
		event: "aborted",
		data: { reason },
		nowIso,
	});
	await appendRunStreamEvent({
		c: input.c,
		runId,
		userId: input.userId,
		event: "done",
		data: { reason: "aborted" },
		nowIso,
	});
	await updatePublicChatRunStatus(input.c.env.DB, {
		runId,
		userId: input.userId,
		status: "aborted",
		responseJson: null,
		errorJson: null,
		nowIso,
	});
	return true;
}

function isPublicChatRunAbortError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	if (error.name === "AbortError") return true;
	const message = String(error.message || "");
	return /aborted|abort/i.test(message);
}

function collectInflightRunIdsForUser(userId: string): string[] {
	const prefix = `${userId}::`;
	const ids: string[] = [];
	for (const key of inflightPublicChatRunControllers.keys()) {
		if (key.startsWith(prefix)) ids.push(key.slice(prefix.length));
	}
	return ids;
}

async function sweepStalePublicChatRunsForUser(input: {
	c: AppContext;
	userId: string;
	sessionKey?: string | null;
	runId?: string | null;
}): Promise<void> {
	try {
		const nowIso = new Date().toISOString();
		const errorPayload: StreamErrorPayload = {
			message: "Chat run timed out without progress",
			code: "stale_run_timeout",
		};
		const errorJson = JSON.stringify(errorPayload);
		const { markedRunIds } = await markStalePublicChatRunsAsFailed(input.c.env.DB, {
			userId: input.userId,
			sessionKey: input.sessionKey ?? null,
			runId: input.runId ?? null,
			skipRunIds: collectInflightRunIdsForUser(input.userId),
			thresholdSecondsAgo: STALE_PUBLIC_CHAT_RUN_THRESHOLD_SECONDS,
			nowIso,
			errorJson,
			limit: STALE_PUBLIC_CHAT_RUN_SWEEP_LIMIT,
		});
		for (const runId of markedRunIds) {
			try {
				await appendRunStreamEvent({
					c: input.c,
					runId,
					userId: input.userId,
					event: "error",
					data: errorPayload,
					nowIso,
				});
				await appendRunStreamEvent({
					c: input.c,
					runId,
					userId: input.userId,
					event: "done",
					data: { reason: "stale_timeout" },
					nowIso,
				});
			} catch (err) {
				console.warn("[public-agents-chat] sweep append stream event failed", err);
			}
		}
	} catch (err) {
		console.warn("[public-agents-chat] stale run sweep failed", err);
	}
}

async function persistInterimAskUserAssistantMessage(input: {
	c: AppContext;
	userId: string;
	sessionKey: string;
	assistantMessageId: string;
	prompt: AgentsBridgeAskUserPrompt;
}): Promise<void> {
	const sessionKey = String(input.sessionKey || "").trim();
	const assistantMessageId = String(input.assistantMessageId || "").trim();
	if (!sessionKey || !assistantMessageId) return;
	const normalized = normalizePublicChatAskUserPrompt(input.prompt);
	if (!normalized) return;
	const nowIso = new Date().toISOString();
	const session =
		(await findPublicChatSessionByKey(input.c.env.DB, {
			userId: input.userId,
			sessionKey,
		})) ??
		(await resolveOrCreatePublicChatSession(input.c.env.DB, {
			id: randomUUID(),
			userId: input.userId,
			sessionKey,
			nowIso,
		}));
	if (!session) return;
	await upsertPublicChatMessage(input.c.env.DB, {
		id: assistantMessageId,
		userId: input.userId,
		sessionId: session.id,
		role: "assistant",
		content: "",
		askUserPromptJson: JSON.stringify(normalized),
		nowIso,
	});
}

async function persistFailedAssistantMessageRow(input: {
	c: AppContext;
	userId: string;
	sessionKey: string;
	assistantMessageId: string;
	errorMessage: string;
	uiSnapshot: unknown;
}): Promise<void> {
	const sessionKey = String(input.sessionKey || "").trim();
	const assistantMessageId = String(input.assistantMessageId || "").trim();
	if (!sessionKey || !assistantMessageId) return;
	const trimmedError = String(input.errorMessage || "").trim();
	const errorText = trimmedError ? `（生成失败：${trimmedError}）` : "（生成失败）";
	const nowIso = new Date().toISOString();
	const session =
		(await findPublicChatSessionByKey(input.c.env.DB, {
			userId: input.userId,
			sessionKey,
		})) ??
		(await resolveOrCreatePublicChatSession(input.c.env.DB, {
			id: randomUUID(),
			userId: input.userId,
			sessionKey,
			nowIso,
		}));
	if (!session) return;
	const uiSnapshotJson = input.uiSnapshot ? JSON.stringify(input.uiSnapshot) : null;
	await upsertPublicChatMessage(input.c.env.DB, {
		id: assistantMessageId,
		userId: input.userId,
		sessionId: session.id,
		role: "assistant",
		content: errorText,
		uiSnapshotJson,
		nowIso,
	});
}

async function persistInitialUserMessageRow(input: {
	c: AppContext;
	userId: string;
	sessionKey: string;
	userMessageId: string;
	userText: string;
	skillMention?: string | null;
}): Promise<void> {
	const sessionKey = String(input.sessionKey || "").trim();
	const userMessageId = String(input.userMessageId || "").trim();
	const userText = String(input.userText || "").trim();
	if (!sessionKey || !userMessageId || !userText) return;
	const nowIso = new Date().toISOString();
	const session =
		(await findPublicChatSessionByKey(input.c.env.DB, {
			userId: input.userId,
			sessionKey,
		})) ??
		(await resolveOrCreatePublicChatSession(input.c.env.DB, {
			id: randomUUID(),
			userId: input.userId,
			sessionKey,
			nowIso,
		}));
	if (!session) return;
	await upsertPublicChatMessage(input.c.env.DB, {
		id: userMessageId,
		userId: input.userId,
		sessionId: session.id,
		role: "user",
		content: userText,
		skillMention: input.skillMention ?? null,
		nowIso,
	});
}

async function startPublicAgentsChatBackgroundRun(input: {
	c: AppContext;
	runId: string;
	userId: string;
	requestInput: AgentsChatRequestDto;
	taskRequest: TaskRequestDto;
}): Promise<void> {
	const controller = new AbortController();
	registerPublicChatRunController(input.userId, input.runId, controller);
	const uiSnapshotAccumulator = createPublicChatUiSnapshotAccumulator();
	const assistantMessageId = String(input.requestInput.assistantMessageId || "").trim();
	const sessionKey = String(input.requestInput.sessionKey || "").trim();
	try {
		const userMessageId = String(input.requestInput.userMessageId || "").trim();
		const initialUserText =
			(typeof input.requestInput.displayPrompt === "string" && input.requestInput.displayPrompt.trim()) ||
			(typeof input.requestInput.prompt === "string" && input.requestInput.prompt.trim()) ||
			"";
		const userSkillMention = buildPublicChatSkillMention(input.requestInput);
		if (sessionKey && userMessageId && initialUserText) {
			try {
				await persistInitialUserMessageRow({
					c: input.c,
					userId: input.userId,
					sessionKey,
					userMessageId,
					userText: initialUserText,
					skillMention: userSkillMention,
				});
			} catch (err) {
				console.warn("[public-agents-chat] initial user message persist failed", err);
			}
		}
		const result = await runAgentsBridgeChatTask(input.c, input.userId, input.taskRequest, {
			publicChatRunId: input.runId,
			onStreamEvent: async (event) => {
				uiSnapshotAccumulator.recordEvent(event.event, event.data);
				if (!FORWARDED_STREAM_EVENTS.has(event.event)) return;
				await appendRunStreamEvent({
					c: input.c,
					runId: input.runId,
					userId: input.userId,
					event: event.event,
					data: event.data,
				});
			},
			onAskUserDetected: assistantMessageId && sessionKey
				? async (prompt) => {
					try {
						await persistInterimAskUserAssistantMessage({
							c: input.c,
							userId: input.userId,
							sessionKey,
							assistantMessageId,
							prompt,
						});
					} catch (err) {
						console.warn(
							"[public-agents-chat] interim ask_user persist failed",
							err,
						);
					}
				}
				: undefined,
			abortSignal: controller.signal,
			});
			const response = buildAgentsChatResponseFromTaskResult(result);
			const assistantUiSnapshot = uiSnapshotAccumulator.buildSnapshot(response);
			await persistAgentsChatConversationTurn({
				c: input.c,
				userId: input.userId,
				requestInput: input.requestInput,
				response,
				result,
				assistantUiSnapshot,
			});
		await appendRunStreamEvent({
			c: input.c,
			runId: input.runId,
			userId: input.userId,
			event: "result",
			data: { response },
		});
		await appendRunStreamEvent({
			c: input.c,
			runId: input.runId,
			userId: input.userId,
			event: "done",
			data: { reason: "finished" },
		});
		await updatePublicChatRunStatus(input.c.env.DB, {
			runId: input.runId,
			userId: input.userId,
			status: "succeeded",
			responseJson: JSON.stringify({ response }),
			errorJson: null,
			nowIso: new Date().toISOString(),
		});
	} catch (error) {
		const aborted = controller.signal.aborted || isPublicChatRunAbortError(error);
		const errorPayload = toStreamErrorPayload(error);
		if (!aborted && sessionKey && assistantMessageId) {
			try {
				const partialSnapshot = uiSnapshotAccumulator.buildSnapshot(null, {
					status: "failed",
					message: errorPayload.message,
					finishedAtMs: Date.now(),
				});
				await persistFailedAssistantMessageRow({
					c: input.c,
					userId: input.userId,
					sessionKey,
					assistantMessageId,
					errorMessage: errorPayload.message,
					uiSnapshot: partialSnapshot,
				});
			} catch (err) {
				console.warn("[public-agents-chat] failed assistant persist failed", err);
			}
		}
		await appendRunStreamEvent({
			c: input.c,
			runId: input.runId,
			userId: input.userId,
			event: aborted ? "aborted" : "error",
			data: aborted ? { reason: "client_aborted" } : errorPayload,
		});
		await appendRunStreamEvent({
			c: input.c,
			runId: input.runId,
			userId: input.userId,
			event: "done",
			data: { reason: aborted ? "aborted" : "error" },
		});
		await updatePublicChatRunStatus(input.c.env.DB, {
			runId: input.runId,
			userId: input.userId,
			status: aborted ? "aborted" : "failed",
			responseJson: null,
			errorJson: aborted ? null : JSON.stringify(errorPayload),
			nowIso: new Date().toISOString(),
		});
	} finally {
		releasePublicChatRunController(input.userId, input.runId);
	}
}

export async function handlePublicAgentsChatAbortRunRoute(c: AppContext): Promise<Response> {
	const userId = requirePublicAgentsChatUserId(c);
	const runId = String(c.req.param("runId") || "").trim();
	if (!runId) {
		throw new AppError("runId is required", {
			status: 400,
			code: "run_id_required",
		});
	}
	await sweepStalePublicChatRunsForUser({ c, userId, runId });
	const run = await findPublicChatRunById(c.env.DB, { runId, userId });
	if (!run) {
		throw new AppError("Chat run not found", {
			status: 404,
			code: "chat_run_not_found",
		});
	}
	if (run.status !== "running") {
		return c.json({ runId, status: run.status, aborted: false }, 200);
	}
	const controller = getPublicChatRunController(userId, runId);
	if (controller) {
		if (!controller.signal.aborted) {
			controller.abort(new Error("client_aborted"));
		}
		return c.json({ runId, status: "aborting", aborted: true }, 202);
	}
	await terminalizeOrphanedPublicChatRun({ c, userId, run });
	return c.json({ runId, status: "aborted", aborted: false }, 200);
}

function parseNonNegativeInteger(value: unknown): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return 0;
	return Math.max(0, Math.trunc(numeric));
}

function sleepUnlessAborted(signal: AbortSignal, ms: number): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

async function replayAndTailPublicChatRunEvents(input: {
	c: AppContext;
	stream: StreamWritable;
	runId: string;
	userId: string;
	afterSeq: number;
}): Promise<void> {
	let cursor = Math.max(0, Math.trunc(input.afterSeq));
	let doneSeen = false;
	let mediaTailDeadlineMs: number | null = null;
	const pendingMediaKeys = new Set<string>();
	while (!input.c.req.raw.signal.aborted) {
		const events = await listPublicChatRunEventsAfter(input.c.env.DB, {
			runId: input.runId,
			userId: input.userId,
			afterSeq: cursor,
			limit: STREAM_REPLAY_BATCH_SIZE,
		});
		for (const event of events) {
			cursor = Math.max(cursor, Number(event.seq || 0));
			applyMediaTailEvent({
				pendingMediaKeys,
				eventName: event.event_name,
				dataJson: event.data_json,
			});
			await input.stream.writeSSE({
				id: String(event.seq),
				event: event.event_name,
				data: event.data_json,
			});
			if (event.event_name === "done") {
				doneSeen = true;
				if (pendingMediaKeys.size > 0 && mediaTailDeadlineMs === null) {
					mediaTailDeadlineMs = Date.now() + MEDIA_RESULT_STREAM_GRACE_MS;
				}
			}
			if (input.c.req.raw.signal.aborted) return;
		}
		if (doneSeen && pendingMediaKeys.size === 0) return;
		if (
			doneSeen &&
			mediaTailDeadlineMs !== null &&
			Date.now() >= mediaTailDeadlineMs
		) {
			return;
		}
		const run = await findPublicChatRunById(input.c.env.DB, {
			runId: input.runId,
			userId: input.userId,
		});
		if (!run) return;
		if (run.status !== "running" && !doneSeen) {
			const nowIso = new Date().toISOString();
			for (const terminalEvent of buildSyntheticTerminalEventsForPublicChatRun(run)) {
				const appended = await appendRunStreamEvent({
					c: input.c,
					runId: input.runId,
					userId: input.userId,
					event: terminalEvent.event,
					data: terminalEvent.data,
					nowIso,
				});
				if (appended) {
					cursor = Math.max(cursor, Number(appended.seq || 0));
					await input.stream.writeSSE({
						id: String(appended.seq),
						event: appended.event_name,
						data: appended.data_json,
					});
				} else {
					await input.stream.writeSSE({
						event: terminalEvent.event,
						data: JSON.stringify(terminalEvent.data ?? null),
					});
				}
				if (terminalEvent.event === "done") {
					doneSeen = true;
					if (pendingMediaKeys.size > 0 && mediaTailDeadlineMs === null) {
						mediaTailDeadlineMs = Date.now() + MEDIA_RESULT_STREAM_GRACE_MS;
					}
				}
				if (input.c.req.raw.signal.aborted) return;
			}
		}
		if (run.status !== "running" && (!doneSeen || pendingMediaKeys.size === 0)) return;
		await sleepUnlessAborted(input.c.req.raw.signal, STREAM_POLL_INTERVAL_MS);
	}
}

function requirePublicAgentsChatUserId(c: AppContext): string {
	const userId = String(c.get("userId") || "").trim();
	if (!userId) {
		throw new AppError("Unauthorized", {
			status: 401,
			code: "unauthorized",
		});
	}
	return userId;
}

export async function handlePublicAgentsChatActiveRunsRoute(c: AppContext): Promise<Response> {
	const userId = requirePublicAgentsChatUserId(c);
	const sessionKey = String(c.req.query("sessionKey") || "").trim();
	if (!sessionKey) {
		throw new AppError("sessionKey is required", {
			status: 400,
			code: "session_key_required",
		});
	}
	await sweepStalePublicChatRunsForUser({ c, userId, sessionKey });
	const runs = await listActivePublicChatRuns(c.env.DB, {
		userId,
		sessionKey,
		canvasProjectId: c.req.query("canvasProjectId") ?? null,
		canvasFlowId: c.req.query("canvasFlowId") ?? null,
		limit: 20,
	});
	const liveRuns: PublicChatRunRow[] = [];
	for (const run of runs) {
		const terminalized = await terminalizeOrphanedPublicChatRun({ c, userId, run });
		if (terminalized) continue;
		liveRuns.push(run);
		if (liveRuns.length >= 5) break;
	}
	return c.json({ runs: liveRuns.map(toPublicChatRunDto).filter((dto): dto is PublicChatRunDto => dto !== null) }, 200);
}

export async function handlePublicAgentsChatRunEventsRoute(c: AppContext): Promise<Response> {
	const userId = requirePublicAgentsChatUserId(c);
	const runId = String(c.req.param("runId") || "").trim();
	if (!runId) {
		throw new AppError("runId is required", {
			status: 400,
			code: "run_id_required",
		});
	}
	await sweepStalePublicChatRunsForUser({ c, userId, runId });
	const run = await findPublicChatRunById(c.env.DB, { runId, userId });
	if (!run) {
		throw new AppError("Chat run not found", {
			status: 404,
			code: "chat_run_not_found",
		});
	}
	await terminalizeOrphanedPublicChatRun({ c, userId, run });
	const afterSeq = parseNonNegativeInteger(c.req.query("afterSeq"));
	return streamSSE(c, async (stream) => {
		await replayAndTailPublicChatRunEvents({
			c,
			stream,
			runId,
			userId,
			afterSeq,
		});
	});
}

export async function handlePublicAgentsChatRoute(c: AppContext): Promise<Response> {
	const userId = requirePublicAgentsChatUserId(c);

	const rawBody = await c.req.json().catch(() => ({}));
	const input = AgentsChatRequestSchema.parse(rawBody);
	const effectiveInput = await enrichRequestWithPendingAskUserSelection({
		c,
		userId,
		requestInput: input,
	});
	const taskRequest = buildTaskRequest(effectiveInput);

	if (input.stream === true) {
		const requestId = String(c.get("requestId") || "").trim() || randomUUID();
		const sessionId =
			typeof input.sessionKey === "string" && input.sessionKey.trim()
				? input.sessionKey.trim()
				: "";
		if (!sessionId) {
			throw new AppError("stream agents chat requires sessionKey for resumable runs", {
				status: 400,
				code: "session_key_required",
			});
		}
		const nowIso = new Date().toISOString();
		const runId = `chat_run_${randomUUID()}`;
		const displayText =
			typeof input.displayPrompt === "string" && input.displayPrompt.trim()
				? input.displayPrompt.trim()
				: taskRequest.prompt;
		const run = await createPublicChatRun(c.env.DB, {
			id: runId,
			userId,
			sessionKey: sessionId,
			canvasProjectId: input.canvasProjectId ?? null,
			canvasFlowId: input.canvasFlowId ?? null,
			requestText: taskRequest.prompt,
			displayText,
			requestJson: JSON.stringify(buildPublicChatRunRequestMetadata(input)),
			userMessageId: input.userMessageId,
			assistantMessageId: input.assistantMessageId,
			nowIso,
		});
		if (!run) {
			throw new AppError("Failed to create resumable agents chat run", {
				status: 500,
				code: "chat_run_create_failed",
			});
		}
		await appendRunStreamEvent({
			c,
			runId,
			userId,
			event: "initial",
			data: {
				requestId,
				messageId: `msg_${randomUUID()}`,
				runId,
			},
			nowIso,
		});
		await appendRunStreamEvent({
			c,
			runId,
			userId,
			event: "session",
			data: { sessionId },
			nowIso,
		});
		scheduleBackgroundWork(c, () =>
			startPublicAgentsChatBackgroundRun({
				c,
				runId,
				userId,
				requestInput: input,
				taskRequest,
			}),
		);
			return streamSSE(c, async (stream) => {
				await replayAndTailPublicChatRunEvents({
					c,
					stream,
					runId,
					userId,
					afterSeq: 0,
				});
			});
		}

	const userSkillMention = buildPublicChatSkillMention(input);
	const initialUserText =
		(typeof input.displayPrompt === "string" && input.displayPrompt.trim()) ||
		(typeof input.prompt === "string" && input.prompt.trim()) ||
		"";
	const nonStreamSessionKey =
		typeof input.sessionKey === "string" && input.sessionKey.trim()
			? input.sessionKey.trim()
			: "";
	if (nonStreamSessionKey && input.userMessageId && initialUserText) {
		await persistInitialUserMessageRow({
			c,
			userId,
			sessionKey: nonStreamSessionKey,
			userMessageId: input.userMessageId,
			userText: initialUserText,
			skillMention: userSkillMention,
		});
	}
	const result = await runAgentsBridgeChatTask(c, userId, taskRequest, {
		abortSignal: c.req.raw.signal,
	});
	const response = buildAgentsChatResponseFromTaskResult(result);
	await persistAgentsChatConversationTurn({
		c,
		userId,
		requestInput: input,
		response,
		result,
	});
	return c.json(response);
}
