import type { AppContext } from "../../types";
import {
	listProjectChatArtifactSessions,
	listExecutionTraces,
	persistConversationTurn,
	searchMemoryEntries,
	writeExecutionTrace,
	writeMemoryEntries,
	updateMemoryEntryById,
	deleteMemoryEntryById,
	loadEntriesForScope,
	type ExecutionTraceRow,
	type NormalizedMemoryEntry,
	type PersistConversationTurnResult,
	type ProjectChatArtifactSession,
} from "./memory.repo";
import {
	findPublicChatSessionByKey,
	listPublicChatMessages,
	normalizePublicChatAskUserPrompt,
	restoreTruncatedPublicChatAskUserQuestion,
	type PublicChatAskUserPrompt,
	type PublicChatMessageRow,
} from "../apiKey/public-chat-session.repo";
import { normalizePublicChatUiSnapshot } from "../apiKey/public-chat-ui-snapshot";
import type {
	ExecutionTraceWriteRequest,
	MemoryProjectChatArtifactSessionsRequest,
	MemorySearchRequest,
	MemoryWriteRequest,
} from "./memory.schemas";

export type MemoryConversationItem = {
	id: string;
	role: string;
	content: string;
	assets: unknown[];
	skillMention: string | null;
	askUserPrompt: PublicChatAskUserPrompt | null;
	uiSnapshot: unknown | null;
	createdAt: string;
};

function resolveScopeIdAlias(scopeType: string, scopeId: string, userId: string): string {
	if (scopeType === "user" && scopeId === "_self") return userId;
	return scopeId;
}

function truncateText(value: string, maxLength: number): string {
	const text = String(value || "").trim();
	if (!text) return "";
	if (text.length <= maxLength) return text;
	return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export async function buildUserMemoryContext(
	c: AppContext,
	userId: string,
	input: { projectId?: string; limitPerScope?: number },
): Promise<NormalizedMemoryEntry[]> {
	const limit = input.limitPerScope ?? 20;
	const allTypes = ["preference", "fact", "reference", "feedback"] as const;
	const userEntries = await loadEntriesForScope(c.env.DB, userId, "user", userId, [...allTypes], limit);
	const projectEntries = input.projectId
		? await loadEntriesForScope(c.env.DB, userId, "project", input.projectId, [...allTypes], limit)
		: [];
	return [...projectEntries, ...userEntries];
}

export async function loadUserSessionRecentConversation(
	c: AppContext,
	userId: string,
	input: { sessionKey?: string; recentConversationLimit?: number },
): Promise<MemoryConversationItem[]> {
	const sessionKey = String(input.sessionKey || "").trim();
	if (!sessionKey) return [];
	const limit = Number.isFinite(input.recentConversationLimit)
		? Math.max(1, Math.min(20, Math.trunc(Number(input.recentConversationLimit))))
		: 10;
	const session = await findPublicChatSessionByKey(c.env.DB, { userId, sessionKey });
	if (!session) return [];
	const rows = await listPublicChatMessages(c.env.DB, {
		userId,
		sessionId: session.id,
		limit,
	});
	return (rows as PublicChatMessageRow[]).map((row) => ({
		id: row.id,
		role: row.role,
		content: row.content,
		assets: parseJson<unknown[]>(row.assets_json, []),
		skillMention: row.skill_mention ?? null,
		askUserPrompt: restoreTruncatedPublicChatAskUserQuestion(
			normalizePublicChatAskUserPrompt(
				parseJson<Record<string, unknown> | null>(row.ask_user_prompt_json, null),
			),
			row.content,
		),
		uiSnapshot: normalizePublicChatUiSnapshot(
			parseJson<Record<string, unknown> | null>(row.ui_snapshot_json, null),
		),
		createdAt: row.created_at,
	}));
}

export async function writeUserMemoryEntries(
	c: AppContext,
	userId: string,
	input: MemoryWriteRequest,
) {
	const normalized: MemoryWriteRequest = {
		...input,
		entries: input.entries.map((entry) => ({
			...entry,
			scopeId: resolveScopeIdAlias(entry.scopeType, entry.scopeId, userId),
		})),
	};
	return writeMemoryEntries(c.env.DB, userId, normalized);
}

export async function searchUserMemoryEntries(
	c: AppContext,
	userId: string,
	input: MemorySearchRequest,
) {
	const normalized: MemorySearchRequest = input.scopes
		? {
			...input,
			scopes: input.scopes.map((s) => ({
				...s,
				scopeId: resolveScopeIdAlias(s.scopeType, s.scopeId, userId),
			})),
		}
		: input;
	return searchMemoryEntries(c.env.DB, userId, normalized);
}

export async function listUserProjectChatArtifactSessions(
	c: AppContext,
	userId: string,
	input: MemoryProjectChatArtifactSessionsRequest,
): Promise<ProjectChatArtifactSession[]> {
	return listProjectChatArtifactSessions(c.env.DB, {
		userId,
		projectId: input.projectId,
		...(input.flowId ? { flowId: input.flowId } : {}),
		...(typeof input.limitSessions === "number" ? { limitSessions: input.limitSessions } : {}),
		...(typeof input.limitTurns === "number" ? { limitTurns: input.limitTurns } : {}),
	});
}

export async function writeUserExecutionTrace(
	c: AppContext,
	userId: string,
	input: ExecutionTraceWriteRequest,
) {
	const normalized: ExecutionTraceWriteRequest = {
		...input,
		scopeId: resolveScopeIdAlias(input.scopeType, input.scopeId, userId),
	};
	return writeExecutionTrace(c.env.DB, userId, normalized);
}

export async function updateMemoryEntry(
	c: AppContext,
	userId: string,
	input: {
		id: string;
		title?: string;
		summaryText?: string;
		content?: Record<string, unknown>;
		importance?: number;
		status?: string;
		pinned?: boolean;
		tags?: string[];
	},
): Promise<NormalizedMemoryEntry | null> {
	return updateMemoryEntryById(c.env.DB, userId, input);
}

export async function deleteMemoryEntry(
	c: AppContext,
	userId: string,
	id: string,
): Promise<boolean> {
	return deleteMemoryEntryById(c.env.DB, userId, id);
}

export async function listMemoryEntriesByScope(
	c: AppContext,
	userId: string,
	input: {
		scopeType: string;
		scopeId: string;
		memoryTypes?: string[];
		limit?: number;
	},
): Promise<NormalizedMemoryEntry[]> {
	const allTypes = ["preference", "fact", "reference", "feedback"] as const;
	const types = (input.memoryTypes ?? []) as Array<typeof allTypes[number]>;
	const effectiveTypes = types.length > 0 ? types : [...allTypes];
	return loadEntriesForScope(
		c.env.DB,
		userId,
		input.scopeType as "user" | "project",
		resolveScopeIdAlias(input.scopeType, input.scopeId, userId),
		effectiveTypes,
		input.limit ?? 50,
	);
}

export async function persistUserConversationTurn(
	c: AppContext,
	input: {
		userId: string;
		sessionKey: string;
		userText: string;
		assistantText: string;
		userAssets?: unknown[];
		assistantAssets?: unknown[];
		assistantAskUserPrompt?: unknown;
		assistantUiSnapshot?: unknown;
		userMessageId: string;
		assistantMessageId: string;
	},
): Promise<PersistConversationTurnResult | null> {
	return persistConversationTurn(c.env.DB, input);
}

export function formatMemoryContextForPrompt(entries: NormalizedMemoryEntry[]): string {
	if (!entries.length) return "";
	const lines: string[] = ["# Project Memory"];
	for (const entry of entries) {
		const headline = entry.title || entry.summaryText || "";
		if (!headline) continue;
		const detail = entry.summaryText && entry.title ? ` — ${truncateText(entry.summaryText, 200)}` : "";
		lines.push(`- [${entry.memoryType}] ${headline}${detail}`);
	}
	return lines.join("\n");
}

export type ExecutionTraceDto = {
	id: string;
	scopeType: string;
	scopeId: string;
	taskId: string | null;
	requestKind: string;
	inputSummary: string;
	decisionLog: string[];
	toolCalls: Array<Record<string, unknown>>;
	meta: Record<string, unknown> | null;
	resultSummary: string | null;
	errorCode: string | null;
	errorDetail: string | null;
	createdAt: string;
};

export async function listUserExecutionTraces(
	c: AppContext,
	userId: string,
	input: {
		limit: number;
		scopeType?: string;
		scopeId?: string;
		requestKindPrefix?: string;
	},
): Promise<ExecutionTraceDto[]> {
	const resolvedScopeId = input.scopeType && input.scopeId
		? resolveScopeIdAlias(input.scopeType, input.scopeId, userId)
		: input.scopeId;
	const rows = await listExecutionTraces(c.env.DB, {
		userId,
		limit: input.limit,
		...(input.scopeType ? { scopeType: input.scopeType } : {}),
		...(resolvedScopeId ? { scopeId: resolvedScopeId } : {}),
		...(input.requestKindPrefix ? { requestKindPrefix: input.requestKindPrefix } : {}),
	});
	return rows.map(normalizeExecutionTraceRow);
}

function normalizeExecutionTraceRow(row: ExecutionTraceRow): ExecutionTraceDto {
	const toolCalls = parseJson<Array<Record<string, unknown>>>(row.tool_calls_json, []);
	const metaFromColumn = (() => {
		const parsed = parseJson<Record<string, unknown>>(row.meta_json, {});
		return Object.keys(parsed).length ? parsed : null;
	})();
	const derivedMeta = (() => {
		if (metaFromColumn) return null;
		if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
		const candidate = toolCalls.find((call) => call && typeof call === "object" && !Array.isArray(call));
		if (!candidate) return null;
		const keys = ["projectId", "flowId", "label", "sessionId", "requestId", "pagePath", "referrerPath"];
		const out: Record<string, unknown> = {};
		for (const key of keys) {
			const v = (candidate as Record<string, unknown>)[key];
			if (typeof v === "string" && v.trim()) out[key] = v.trim();
		}
		if (!Object.keys(out).length) return null;
		out.__derivedFromToolCalls = true;
		return out;
	})();
	return {
		id: row.id,
		scopeType: row.scope_type,
		scopeId: row.scope_id,
		taskId: row.task_id,
		requestKind: row.request_kind,
		inputSummary: row.input_summary,
		decisionLog: parseJson<string[]>(row.decision_log_json, []),
		toolCalls,
		meta: metaFromColumn ?? derivedMeta,
		resultSummary: row.result_summary,
		errorCode: row.error_code,
		errorDetail: row.error_detail,
		createdAt: row.created_at,
	};
}
