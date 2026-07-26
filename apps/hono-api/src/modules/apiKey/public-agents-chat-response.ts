import { randomUUID } from "node:crypto";
import type { AppContext } from "../../types";
import { persistUserConversationTurn } from "../memory/memory.service";
import type { TaskAssetDto, TaskResultDto } from "../task/task.schemas";
import {
	AgentsChatResponseSchema,
	type AgentsChatRequestDto,
	type AgentsChatResponseDto,
} from "./apiKey.schemas";
import {
	appendPublicChatTurnRun,
	type PublicChatRunOutcome,
} from "./public-chat-session.repo";
import { buildPublicChatUiSnapshotFromResponse } from "./public-chat-ui-snapshot";

type PublicChatTraceDto = NonNullable<AgentsChatResponseDto["trace"]>;
type PublicChatAgentDecisionDto = NonNullable<AgentsChatResponseDto["agentDecision"]>;

type StructuredAgentsMetadata = {
	agentDecision?: PublicChatAgentDecisionDto;
	trace?: PublicChatTraceDto;
};

type PublicChatLedgerScope = {
	projectId: string | null;
	label: string | null;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalTrimmedString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function stringifyOptionalJson(value: unknown): string | null {
	if (typeof value === "undefined") return null;
	try {
		return JSON.stringify(value);
	} catch {
		return null;
	}
}

type PersistedUserAsset = {
	title: string;
	url: string;
	thumbnailUrl?: string;
	type?: "image" | "video";
};

function derivePersistedUserAssets(requestInput: AgentsChatRequestDto): PersistedUserAsset[] {
	const out: PersistedUserAsset[] = [];
	const seen = new Set<string>();
	const selected = Array.isArray(requestInput.selectedMediaReferences)
		? requestInput.selectedMediaReferences
		: [];
	for (const item of selected) {
		const url = typeof item.url === "string" ? item.url.trim() : "";
		if (!url || seen.has(url)) continue;
		const kind = item.kind === "video" ? "video" : "image";
		const thumb = typeof item.thumbnailUrl === "string" ? item.thumbnailUrl.trim() : "";
		seen.add(url);
		const label = typeof item.label === "string" ? item.label.trim() : "";
		out.push({
			title: label || `参考-${out.length + 1}`,
			url,
			...(thumb ? { thumbnailUrl: thumb } : {}),
			type: kind,
		});
	}
	const inputs = Array.isArray(requestInput.assetInputs) ? requestInput.assetInputs : [];
	for (const input of inputs) {
		const url = typeof input.url === "string" ? input.url.trim() : "";
		if (!url || seen.has(url)) continue;
		seen.add(url);
		const name = typeof input.name === "string" ? input.name.trim() : "";
		const note = typeof input.note === "string" ? input.note.trim() : "";
		out.push({
			title: name || note || `参考-${out.length + 1}`,
			url,
			type: "image",
		});
	}
	return out;
}

function normalizeResponseAssets(assets: TaskAssetDto[]): AgentsChatResponseDto["assets"] {
	if (!Array.isArray(assets) || assets.length === 0) return undefined;
	const out: NonNullable<AgentsChatResponseDto["assets"]> = [];
	for (const asset of assets) {
		const url = typeof asset.url === "string" ? asset.url.trim() : "";
		if (!url) continue;
		const thumbnailUrl =
			typeof asset.thumbnailUrl === "string" && asset.thumbnailUrl.trim()
				? asset.thumbnailUrl.trim()
				: undefined;
		const assetName =
			typeof asset.assetName === "string" && asset.assetName.trim()
				? asset.assetName.trim()
				: undefined;
		const assetRefId =
			typeof asset.assetRefId === "string" && asset.assetRefId.trim()
				? asset.assetRefId.trim()
				: undefined;
		const assetId =
			typeof asset.assetId === "string" && asset.assetId.trim()
				? asset.assetId.trim()
				: undefined;
		out.push({
			type: asset.type,
			url,
			...(thumbnailUrl ? { thumbnailUrl } : {}),
			...(assetName ? { title: assetName } : {}),
			...(assetId ? { assetId } : {}),
			...(assetRefId ? { assetRefId } : {}),
		});
		if (out.length >= 24) break;
	}
	return out.length > 0 ? out : undefined;
}

function extractTaskTextFromResult(result: TaskResultDto): string {
	const raw = isPlainRecord(result.raw) ? result.raw : null;
	const directResultText =
		raw && typeof raw.text === "string" && raw.text.trim() ? raw.text.trim() : "";
	if (directResultText) return directResultText;
	const nestedResponse =
		raw && isPlainRecord(raw.response) ? raw.response : null;
	const nestedResponseText =
		nestedResponse && typeof nestedResponse.text === "string" && nestedResponse.text.trim()
			? nestedResponse.text.trim()
			: "";
	if (nestedResponseText) return nestedResponseText;
	const nestedOutputText =
		nestedResponse && typeof nestedResponse.output_text === "string"
			? nestedResponse.output_text.trim()
			: raw && typeof raw.output_text === "string"
				? raw.output_text.trim()
				: "";
	if (nestedOutputText) return nestedOutputText;
	if (nestedResponse && Array.isArray(nestedResponse.output_text)) {
		const merged = nestedResponse.output_text
			.filter((item): item is string => typeof item === "string")
			.join("")
			.trim();
		if (merged) return merged;
	}
	const choiceContent =
		nestedResponse &&
		Array.isArray(nestedResponse.choices) &&
		isPlainRecord(nestedResponse.choices[0]) &&
		isPlainRecord(nestedResponse.choices[0].message) &&
		typeof nestedResponse.choices[0].message.content === "string"
			? nestedResponse.choices[0].message.content.trim()
			: "";
	return choiceContent;
}

function extractStructuredAgentsMetadata(result: TaskResultDto): StructuredAgentsMetadata {
	if (!isPlainRecord(result.raw)) return {};
	const raw = result.raw;
	const meta = isPlainRecord(raw.meta) ? raw.meta : null;
	if (!meta) return {};
	const parsedAgentDecision = AgentsChatResponseSchema.pick({
		agentDecision: true,
	}).safeParse({
		agentDecision: meta.agentDecision,
	});
	const parsedTrace = AgentsChatResponseSchema.pick({
		trace: true,
	}).safeParse({
		trace: {
			requestId:
				typeof meta.requestId === "string" && meta.requestId.trim()
					? meta.requestId.trim()
					: undefined,
			sessionId:
				typeof meta.sessionId === "string" && meta.sessionId.trim()
					? meta.sessionId.trim()
					: undefined,
			outputMode: meta.outputMode,
			toolEvidence: meta.toolEvidence,
			toolStatusSummary: meta.toolStatusSummary,
			canvasMutation: meta.canvasMutation,
			diagnosticFlags: meta.diagnosticFlags,
			canvasPlan: meta.canvasPlan,
			todoList: meta.todoList,
			todoEvents: meta.todoEvents,
			runtime: meta.runtime,
			turnVerdict: meta.turnVerdict,
		},
	});
	return {
		...(parsedAgentDecision.success && parsedAgentDecision.data.agentDecision
			? { agentDecision: parsedAgentDecision.data.agentDecision }
			: {}),
		...(parsedTrace.success && parsedTrace.data.trace
			? { trace: parsedTrace.data.trace }
			: {}),
	};
}

export function extractAgentsRawMeta(result: TaskResultDto): Record<string, unknown> | null {
	if (!isPlainRecord(result.raw)) return null;
	const raw = result.raw;
	return isPlainRecord(raw.meta) ? raw.meta : null;
}

export function buildAgentsChatResponseFromTaskResult(result: TaskResultDto): AgentsChatResponseDto {
	const structuredMetadata = extractStructuredAgentsMetadata(result);
	const response = {
		id: result.id,
		vendor: "agents",
		text: extractTaskTextFromResult(result),
		...(result.assets.length ? { assets: normalizeResponseAssets(result.assets) } : {}),
		...(structuredMetadata.agentDecision ? { agentDecision: structuredMetadata.agentDecision } : {}),
		...(structuredMetadata.trace ? { trace: structuredMetadata.trace } : {}),
	};
	return AgentsChatResponseSchema.parse(response);
}

function derivePublicChatWorkflowKey(input: {
	mode?: AgentsChatRequestDto["mode"];
	planOnly?: boolean;
	forceAssetGeneration?: boolean;
}): string {
	if (input.forceAssetGeneration === true) return "public_chat.asset_forced";
	if (input.planOnly === true) return "public_chat.plan_only";
	if (input.mode === "auto") return "public_chat.auto";
	return "public_chat.chat";
}

function derivePublicChatRunOutcome(input: {
	turnVerdict: PublicChatTraceDto["turnVerdict"]["status"];
	assetCount: number;
	canvasWrite: boolean;
}): PublicChatRunOutcome {
	if (input.turnVerdict === "failed") return "discard";
	if (input.turnVerdict === "partial") return "hold";
	return input.canvasWrite || input.assetCount > 0 ? "promote" : "hold";
}

function derivePublicChatLedgerScope(input: {
	requestInput: AgentsChatRequestDto;
	rawMeta: Record<string, unknown> | null;
}): PublicChatLedgerScope {
	return {
		projectId:
			normalizeOptionalTrimmedString(input.rawMeta?.projectId) ??
			normalizeOptionalTrimmedString(input.requestInput.canvasProjectId),
		label: normalizeOptionalTrimmedString(input.rawMeta?.label),
	};
}

export async function persistAgentsChatConversationTurn(input: {
	c: AppContext;
	userId: string;
	requestInput: AgentsChatRequestDto;
	response: AgentsChatResponseDto;
	result: TaskResultDto;
	assistantUiSnapshot?: unknown;
}): Promise<void> {
	const sessionKey =
		typeof input.requestInput.sessionKey === "string" ? input.requestInput.sessionKey.trim() : "";
	if (!sessionKey) return;

	const userText =
		typeof input.requestInput.displayPrompt === "string" && input.requestInput.displayPrompt.trim()
			? input.requestInput.displayPrompt.trim()
			: typeof input.requestInput.prompt === "string" && input.requestInput.prompt.trim()
				? input.requestInput.prompt.trim()
				: "";
	const rawMeta = extractAgentsRawMeta(input.result);
	const assistantUiSnapshot = buildPublicChatUiSnapshotFromResponse({
		response: input.response,
		preferredSnapshot: input.assistantUiSnapshot,
	});
	const userAssets = derivePersistedUserAssets(input.requestInput);
	const persisted = await persistUserConversationTurn(input.c, {
		userId: input.userId,
		sessionKey,
		userText,
		assistantText: input.response.text,
		userAssets: userAssets.length ? userAssets : undefined,
		assistantAssets: input.response.assets ?? [],
		assistantAskUserPrompt: rawMeta?.askUserPrompt,
		assistantUiSnapshot,
		userMessageId: input.requestInput.userMessageId.trim(),
		assistantMessageId: input.requestInput.assistantMessageId.trim(),
	});
	const trace = input.response.trace;
	if (!persisted || !trace?.turnVerdict) return;

	const assetCount = Array.isArray(input.response.assets) ? input.response.assets.length : 0;
	const canvasWrite = trace.toolEvidence?.wroteCanvas === true;
	const ledgerScope = derivePublicChatLedgerScope({
		requestInput: input.requestInput,
		rawMeta,
	});
	await appendPublicChatTurnRun(input.c.env.DB, {
		id: randomUUID(),
		userId: input.userId,
		sessionId: persisted.sessionId,
		requestId: trace.requestId ?? null,
		sessionKey,
		projectId: ledgerScope.projectId,
		label: ledgerScope.label,
		workflowKey: derivePublicChatWorkflowKey({
			mode: input.requestInput.mode,
			planOnly: input.requestInput.planOnly === true,
			forceAssetGeneration: input.requestInput.forceAssetGeneration === true,
		}),
		requestKind: "chat",
		userMessageId: persisted.userMessageId,
		assistantMessageId: persisted.assistantMessageId,
		outputMode: trace.outputMode,
		turnVerdict: trace.turnVerdict.status,
		turnVerdictReasonsJson: JSON.stringify(trace.turnVerdict.reasons),
		runOutcome: derivePublicChatRunOutcome({
			turnVerdict: trace.turnVerdict.status,
			assetCount,
			canvasWrite,
		}),
		agentDecisionJson: stringifyOptionalJson(input.response.agentDecision),
		toolStatusSummaryJson: stringifyOptionalJson(trace.toolStatusSummary),
		diagnosticFlagsJson: stringifyOptionalJson(trace.diagnosticFlags),
		canvasPlanJson: stringifyOptionalJson(trace.canvasPlan),
		assetCount,
		canvasWrite,
		runMs: trace.toolStatusSummary?.runMs ?? null,
		nowIso: new Date().toISOString(),
	});
}
