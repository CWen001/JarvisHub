import type { AgentsChatResponseDto } from "./apiKey.schemas";
import type {
	PublicChatTurnVerdict,
	PublicChatUiSnapshot,
	PublicChatUiSnapshotAgentTraceItem,
	PublicChatUiSnapshotAgentTraceSnapshot,
	PublicChatUiSnapshotDiagnosticFlag,
	PublicChatUiSnapshotTodoItem,
	PublicChatUiSnapshotToolCall,
	PublicChatUiSnapshotToolCallMedia,
	PublicChatUiSnapshotToolCallSnapshot,
	PublicChatUiSnapshotToolCallStatus,
} from "./public-chat-session.repo";

type SnapshotAccumulatorState = {
	toolCallsByTurn: Record<string, PublicChatUiSnapshotToolCall[]>;
	turnOrder: string[];
	currentTurnId: string | null;
	todoSnapshot: PublicChatUiSnapshotTodoItem[];
	agentTraceItems: PublicChatUiSnapshotAgentTraceItem[];
	toolSequence: number;
};

type PublicChatUiSnapshotAccumulator = {
	recordEvent: (eventName: string, data: unknown) => void;
	buildSnapshot: (
		response?: AgentsChatResponseDto | null,
		finalization?: PublicChatUiSnapshotFinalization,
	) => PublicChatUiSnapshot | null;
};

type PublicChatUiSnapshotFinalization = {
	status: "failed";
	message: string;
	finishedAtMs?: number;
};

type ResolvedPublicChatUiSnapshotFinalization = {
	status: "failed";
	message: string;
	finishedAtMs: number;
};

const PENDING_TOOL_CALL_TURN_ID = "__pending__";
const MAX_AGENT_TRACE_ITEMS = 300;

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readEpochMs(value: unknown, fallback: number): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

function readNonNegativeMs(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return Math.max(0, Math.trunc(value));
}

function normalizeFinishedAtMs(value: unknown, fallback: number): number {
	const direct = readNonNegativeMs(value);
	if (direct !== null) return direct;
	return Number.isFinite(fallback) ? Math.max(0, Math.trunc(fallback)) : 0;
}

function isPublicChatUiSnapshotToolCallStatus(value: unknown): value is PublicChatUiSnapshotToolCallStatus {
	return value === "running" || value === "succeeded" || value === "failed" || value === "denied" || value === "blocked";
}

function normalizeToolCallStatus(value: unknown, fallback: PublicChatUiSnapshotToolCallStatus): PublicChatUiSnapshotToolCallStatus {
	return isPublicChatUiSnapshotToolCallStatus(value) ? value : fallback;
}

function normalizeTodoStatus(value: unknown, completed: unknown): PublicChatUiSnapshotTodoItem["status"] {
	if (
		value === "completed" ||
		value === "in_progress" ||
		value === "waiting" ||
		value === "blocked" ||
		value === "pending"
	) return value;
	return completed === true ? "completed" : "pending";
}

function normalizeTodoItems(value: unknown): PublicChatUiSnapshotTodoItem[] {
	if (!Array.isArray(value)) return [];
	const out: PublicChatUiSnapshotTodoItem[] = [];
	for (const item of value) {
		const record = asRecord(item);
		if (!record) continue;
		const content = readTrimmedString(record.content) || readTrimmedString(record.text);
		if (!content) continue;
		out.push({
			status: normalizeTodoStatus(record.status, record.completed),
			content,
		});
		if (out.length >= 20) break;
	}
	return out;
}

function normalizeStringArray(value: unknown, limit: number): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		const text = readTrimmedString(item);
		if (!text) continue;
		out.push(text);
		if (out.length >= limit) break;
	}
	return out;
}

function normalizeTurnVerdict(value: unknown): PublicChatUiSnapshot["turnVerdict"] | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const status = readTrimmedString(record.status);
	if (status !== "satisfied" && status !== "partial" && status !== "failed") return undefined;
	return {
		status: status as PublicChatTurnVerdict,
		reasons: normalizeStringArray(record.reasons, 12),
	};
}

function normalizeDiagnosticFlags(value: unknown): PublicChatUiSnapshotDiagnosticFlag[] {
	if (!Array.isArray(value)) return [];
	const out: PublicChatUiSnapshotDiagnosticFlag[] = [];
	for (const item of value) {
		const record = asRecord(item);
		if (!record) continue;
		const code = readTrimmedString(record.code);
		const title = readTrimmedString(record.title);
		const detail = readTrimmedString(record.detail);
		const severity = record.severity === "high" ? "high" : record.severity === "medium" ? "medium" : null;
		if (!code || !title || !detail || !severity) continue;
		out.push({ code, severity, title, detail });
		if (out.length >= 20) break;
	}
	return out;
}

function normalizeOutputJson(value: unknown): Record<string, unknown> | undefined {
	const record = asRecord(value);
	return record ? record : undefined;
}

function normalizeMediaStatus(value: unknown): PublicChatUiSnapshotToolCallMedia["status"] | null {
	return value === "queued" || value === "running" || value === "succeeded" || value === "failed"
		? value
		: null;
}

function normalizeMediaProgress(value: unknown): number | undefined {
	const parsed =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim()
				? Number(value)
				: Number.NaN;
	if (!Number.isFinite(parsed)) return undefined;
	return Math.max(0, Math.min(100, Math.trunc(parsed)));
}

function normalizeToolCallMedia(value: unknown): PublicChatUiSnapshotToolCallMedia | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const kind = record.kind === "video" ? "video" : record.kind === "image" ? "image" : null;
	const status = normalizeMediaStatus(record.status);
	if (!kind || !status) return undefined;
	const nodeId = readTrimmedString(record.nodeId);
	const taskId = readTrimmedString(record.taskId);
	if (!nodeId && !taskId) return undefined;
	const progress = normalizeMediaProgress(record.progress);
	const url = readTrimmedString(record.url);
	const thumbnailUrl = readTrimmedString(record.thumbnailUrl);
	const errorMessage = readTrimmedString(record.errorMessage);
	return {
		kind,
		status,
		pending: record.pending === true || status === "queued" || status === "running",
		nodeId,
		taskId,
		...(typeof progress === "number" ? { progress } : {}),
		...(url ? { url } : {}),
		...(thumbnailUrl ? { thumbnailUrl } : {}),
		...(errorMessage ? { errorMessage } : {}),
	};
}

function readOutputRecord(outputJson: unknown): Record<string, unknown> | null {
	const record = asRecord(outputJson);
	if (!record) return null;
	const data = asRecord(record.data);
	return data ?? record;
}

function readMediaKindFromToolName(toolName: string): "image" | "video" | null {
	if (toolName.startsWith("canvas_image_")) return "image";
	if (toolName.startsWith("canvas_video_")) return "video";
	return null;
}

function readMediaIdentityFromToolCall(call: PublicChatUiSnapshotToolCall): {
	kind?: "image" | "video";
	nodeId?: string;
	taskId?: string;
} | null {
	if (call.media) {
		return {
			kind: call.media.kind,
			...(call.media.nodeId ? { nodeId: call.media.nodeId } : {}),
			...(call.media.taskId ? { taskId: call.media.taskId } : {}),
		};
	}
	const kind = readMediaKindFromToolName(call.toolName);
	const output = readOutputRecord(call.outputJson);
	if (!kind || !output) return null;
	const nodeId = readTrimmedString(output.nodeId);
	const taskId =
		readTrimmedString(output.taskId) ||
		readTrimmedString(kind === "image" ? output.imageTaskId : output.videoTaskId);
	if (!nodeId && !taskId) return null;
	return {
		kind,
		...(nodeId ? { nodeId } : {}),
		...(taskId ? { taskId } : {}),
	};
}

function mediaIdentityMatches(call: PublicChatUiSnapshotToolCall, media: PublicChatUiSnapshotToolCallMedia): boolean {
	const candidate = readMediaIdentityFromToolCall(call);
	if (!candidate) return false;
	if (candidate.kind && candidate.kind !== media.kind) return false;
	if (media.taskId && candidate.taskId) return media.taskId === candidate.taskId;
	if (!media.nodeId || !candidate.nodeId || media.nodeId !== candidate.nodeId) return false;
	if (media.taskId && candidate.taskId && media.taskId !== candidate.taskId) return false;
	return true;
}

function shouldApplyMediaRecord(
	current: PublicChatUiSnapshotToolCallMedia | undefined,
	next: PublicChatUiSnapshotToolCallMedia,
): boolean {
	if (!current) return true;
	if (current.taskId && next.taskId && current.taskId !== next.taskId) return false;
	if (!current.pending && next.pending) return false;
	return true;
}

function normalizeToolCall(value: unknown, fallbackTurnId: string): PublicChatUiSnapshotToolCall | null {
	const record = asRecord(value);
	if (!record) return null;
	const toolCallId = readTrimmedString(record.toolCallId);
	const toolName = readTrimmedString(record.toolName);
	const turnId = readTrimmedString(record.turnId) || fallbackTurnId;
	if (!toolCallId || !toolName || !turnId) return null;
	const startedAtMs = typeof record.startedAtMs === "number" && Number.isFinite(record.startedAtMs)
		? record.startedAtMs
		: readEpochMs(record.startedAt, 0);
	const finishedAtMs = typeof record.finishedAtMs === "number" && Number.isFinite(record.finishedAtMs)
		? record.finishedAtMs
		: record.finishedAtMs === null
			? null
			: readTrimmedString(record.finishedAt)
				? readEpochMs(record.finishedAt, 0)
				: null;
	const outputJson = normalizeOutputJson(record.outputJson);
	const media = normalizeToolCallMedia(record.media);
	const parentToolCallId = readTrimmedString(record.parentToolCallId);
	const agentId = readTrimmedString(record.agentId);
	const agentType = readTrimmedString(record.agentType);
	const agentDepth = typeof record.agentDepth === "number" && Number.isFinite(record.agentDepth)
		? Math.max(0, Math.trunc(record.agentDepth))
		: null;
	return {
		toolCallId,
		toolName,
		status: normalizeToolCallStatus(record.status, "running"),
		...(media ? { media } : {}),
		...(typeof record.input !== "undefined" ? { input: record.input } : {}),
		...(outputJson ? { outputJson } : {}),
		outputPreview: readTrimmedString(record.outputPreview),
		errorMessage: readTrimmedString(record.errorMessage),
		startedAtMs: Number.isFinite(startedAtMs) ? Math.max(0, Math.trunc(startedAtMs)) : 0,
		finishedAtMs: finishedAtMs === null || !Number.isFinite(finishedAtMs) ? null : Math.max(0, Math.trunc(finishedAtMs)),
		durationMs: readNonNegativeMs(record.durationMs),
		turnId,
		...(parentToolCallId ? { parentToolCallId } : {}),
		...(agentId ? { agentId } : {}),
		...(agentType ? { agentType } : {}),
		...(agentDepth !== null ? { agentDepth } : {}),
	};
}

function normalizeToolCallSnapshot(value: unknown): PublicChatUiSnapshotToolCallSnapshot | undefined {
	const record = asRecord(value);
	const snapshotRecord = asRecord(record?.record);
	const rawByTurn = asRecord(snapshotRecord?.toolCallsByTurn);
	if (!record || !rawByTurn) return undefined;
	const rawTurnIds = normalizeStringArray(record.turnIds, 50);
	const turnIds: string[] = [];
	const toolCallsByTurn: Record<string, PublicChatUiSnapshotToolCall[]> = {};
	for (const turnId of rawTurnIds) {
		const calls = rawByTurn[turnId];
		if (!Array.isArray(calls)) continue;
		const normalizedCalls = calls
			.map((item) => normalizeToolCall(item, turnId))
			.filter((item): item is PublicChatUiSnapshotToolCall => item !== null);
		if (!normalizedCalls.length) continue;
		turnIds.push(turnId);
		toolCallsByTurn[turnId] = normalizedCalls;
	}
	if (!turnIds.length) return undefined;
	return {
		turnIds,
		record: {
			toolCallsByTurn,
		},
	};
}

function normalizeTraceItem(value: unknown): PublicChatUiSnapshotAgentTraceItem | null {
	const record = asRecord(value);
	if (!record) return null;
	const id = readTrimmedString(record.id);
	const kind = readTrimmedString(record.kind);
	const at = typeof record.at === "number" && Number.isFinite(record.at) ? Math.max(0, Math.trunc(record.at)) : 0;
	if (kind === "thinking") {
		const text = readTrimmedString(record.text);
		if (!id || !text) return null;
		const parentToolCallId = readTrimmedString(record.parentToolCallId);
		const agentId = readTrimmedString(record.agentId);
		return {
			id,
			kind,
			turnId: readTrimmedString(record.turnId),
			turnIndex: readNonNegativeMs(record.turnIndex),
			text,
			at,
			...(parentToolCallId ? { parentToolCallId } : {}),
			...(agentId ? { agentId } : {}),
		};
	}
	if (kind === "tool") {
		const toolCallId = readTrimmedString(record.toolCallId);
		if (!id || !toolCallId) return null;
		return {
			id,
			kind,
			turnId: readTrimmedString(record.turnId),
			toolCallId,
			at,
		};
	}
	if (kind === "todo") {
		const sourceToolCallId = readTrimmedString(record.sourceToolCallId);
		if (!id || !sourceToolCallId) return null;
		const parentToolCallId = readTrimmedString(record.parentToolCallId);
		const agentId = readTrimmedString(record.agentId);
		return {
			id,
			kind,
			turnId: readTrimmedString(record.turnId),
			sourceToolCallId,
			at,
			...(parentToolCallId ? { parentToolCallId } : {}),
			...(agentId ? { agentId } : {}),
		};
	}
	if (kind === "response") {
		const text = readTrimmedString(record.text);
		if (!id || !text) return null;
		return {
			id,
			kind,
			turnId: readTrimmedString(record.turnId),
			text,
			at,
		};
	}
	return null;
}

function normalizeAgentTraceSnapshot(value: unknown): PublicChatUiSnapshotAgentTraceSnapshot | undefined {
	const record = asRecord(value);
	if (!record || !Array.isArray(record.items)) return undefined;
	const items = record.items
		.map((item) => normalizeTraceItem(item))
		.filter((item): item is PublicChatUiSnapshotAgentTraceItem => item !== null)
		.slice(0, 300);
	return items.length > 0 ? { items } : undefined;
}

function compactSnapshot(snapshot: PublicChatUiSnapshot): PublicChatUiSnapshot | null {
	const out: PublicChatUiSnapshot = {};
	if (snapshot.todoSnapshot && snapshot.todoSnapshot.length > 0) out.todoSnapshot = snapshot.todoSnapshot;
	if (snapshot.toolCallSnapshot && snapshot.toolCallSnapshot.turnIds.length > 0) out.toolCallSnapshot = snapshot.toolCallSnapshot;
	if (snapshot.agentTraceSnapshot && snapshot.agentTraceSnapshot.items.length > 0) out.agentTraceSnapshot = snapshot.agentTraceSnapshot;
	if (snapshot.turnVerdict) out.turnVerdict = snapshot.turnVerdict;
	if (snapshot.diagnosticFlags) out.diagnosticFlags = snapshot.diagnosticFlags;
	return Object.keys(out).length > 0 ? out : null;
}

export function normalizePublicChatUiSnapshot(value: unknown): PublicChatUiSnapshot | null {
	const record = asRecord(value);
	if (!record) return null;
	return compactSnapshot({
		todoSnapshot: normalizeTodoItems(record.todoSnapshot),
		toolCallSnapshot: normalizeToolCallSnapshot(record.toolCallSnapshot),
		agentTraceSnapshot: normalizeAgentTraceSnapshot(record.agentTraceSnapshot),
		turnVerdict: normalizeTurnVerdict(record.turnVerdict),
		diagnosticFlags: normalizeDiagnosticFlags(record.diagnosticFlags),
	});
}

export function buildPublicChatUiSnapshotFromResponse(input: {
	response: AgentsChatResponseDto;
	preferredSnapshot?: unknown;
}): PublicChatUiSnapshot | null {
	const preferred = normalizePublicChatUiSnapshot(input.preferredSnapshot);
	const fromResponse = compactSnapshot({
		todoSnapshot: normalizeTodoItems(input.response.trace?.todoList?.items),
		turnVerdict: normalizeTurnVerdict(input.response.trace?.turnVerdict),
		diagnosticFlags: normalizeDiagnosticFlags(input.response.trace?.diagnosticFlags),
	});
	if (!preferred) return fromResponse;
	return compactSnapshot({
		todoSnapshot: preferred.todoSnapshot ?? fromResponse?.todoSnapshot,
		toolCallSnapshot: preferred.toolCallSnapshot,
		agentTraceSnapshot: preferred.agentTraceSnapshot,
		turnVerdict: preferred.turnVerdict ?? fromResponse?.turnVerdict,
		diagnosticFlags: preferred.diagnosticFlags ?? fromResponse?.diagnosticFlags,
	});
}

function readTurnIdFromLifecycleEvent(data: unknown, fallback: string): string {
	const record = asRecord(data);
	if (!record) return fallback;
	const direct = readTrimmedString(record.turnId);
	if (direct) return direct;
	const nested = asRecord(record.turn);
	return readTrimmedString(nested?.id) || fallback;
}

function startToolCall(
	state: SnapshotAccumulatorState,
	data: Record<string, unknown>,
	nowMs: number,
): void {
	const turnId = state.currentTurnId ?? PENDING_TOOL_CALL_TURN_ID;
	const startedAtMs = readEpochMs(data.startedAt, nowMs);
	const toolCallId = readTrimmedString(data.toolCallId) || `anon-${state.toolSequence + 1}`;
	const toolName = readTrimmedString(data.toolName) || "tool";
	state.toolSequence += 1;
	const parentToolCallId = readTrimmedString(data.parentToolCallId);
	const agentId = readTrimmedString(data.agentId);
	const agentType = readTrimmedString(data.agentType);
	const agentDepth = typeof data.agentDepth === "number" && Number.isFinite(data.agentDepth)
		? Math.max(0, Math.trunc(data.agentDepth))
		: null;
	const record: PublicChatUiSnapshotToolCall = {
		toolCallId,
		toolName,
		status: "running",
		...(typeof data.input !== "undefined" ? { input: data.input } : {}),
		...(normalizeOutputJson(data.outputJson) ? { outputJson: normalizeOutputJson(data.outputJson) } : {}),
		outputPreview: readTrimmedString(data.outputPreview),
		errorMessage: readTrimmedString(data.errorMessage),
		startedAtMs,
		finishedAtMs: null,
		durationMs: null,
		turnId,
		...(parentToolCallId ? { parentToolCallId } : {}),
		...(agentId ? { agentId } : {}),
		...(agentType ? { agentType } : {}),
		...(agentDepth !== null ? { agentDepth } : {}),
	};
	state.toolCallsByTurn[turnId] = [...(state.toolCallsByTurn[turnId] ?? []), record].sort(
		(a, b) => a.startedAtMs - b.startedAtMs,
	);
	if (!state.turnOrder.includes(turnId)) state.turnOrder.push(turnId);
}

function completeToolCall(
	state: SnapshotAccumulatorState,
	data: Record<string, unknown>,
	nowMs: number,
): void {
	const toolCallId = readTrimmedString(data.toolCallId);
	let foundTurnId = "";
	let foundIndex = -1;
	if (toolCallId) {
		for (const turnId of state.turnOrder) {
			const index = (state.toolCallsByTurn[turnId] ?? []).findIndex((call) => call.toolCallId === toolCallId);
			if (index >= 0) {
				foundTurnId = turnId;
				foundIndex = index;
				break;
			}
		}
	}
	if (!foundTurnId || foundIndex < 0) {
		startToolCall(state, data, nowMs);
		foundTurnId = state.currentTurnId ?? PENDING_TOOL_CALL_TURN_ID;
		foundIndex = Math.max(0, (state.toolCallsByTurn[foundTurnId] ?? []).length - 1);
	}
	const bucket = state.toolCallsByTurn[foundTurnId] ?? [];
	const base = bucket[foundIndex];
	if (!base) return;
	const finishedAtMs = readEpochMs(data.finishedAt, nowMs);
	const durationMs =
		typeof data.durationMs === "number" && Number.isFinite(data.durationMs)
			? Math.max(0, Math.trunc(data.durationMs))
			: Math.max(0, Math.trunc(finishedAtMs - base.startedAtMs));
	const outputJson = normalizeOutputJson(data.outputJson);
	const parentToolCallId = readTrimmedString(data.parentToolCallId);
	const agentId = readTrimmedString(data.agentId);
	const agentType = readTrimmedString(data.agentType);
	const agentDepth = typeof data.agentDepth === "number" && Number.isFinite(data.agentDepth)
		? Math.max(0, Math.trunc(data.agentDepth))
		: null;
	const updated: PublicChatUiSnapshotToolCall = {
		...base,
		status: normalizeToolCallStatus(data.status, "succeeded"),
		...(typeof data.input !== "undefined" ? { input: data.input } : {}),
		...(outputJson ? { outputJson } : {}),
		outputPreview: readTrimmedString(data.outputPreview) || base.outputPreview,
		errorMessage: readTrimmedString(data.errorMessage) || base.errorMessage,
		finishedAtMs,
		durationMs,
		...(parentToolCallId ? { parentToolCallId } : {}),
		...(agentId ? { agentId } : {}),
		...(agentType ? { agentType } : {}),
		...(agentDepth !== null ? { agentDepth } : {}),
	};
	state.toolCallsByTurn[foundTurnId] = bucket.map((call, index) => (index === foundIndex ? updated : call));
}

function buildMediaRecord(data: Record<string, unknown>): PublicChatUiSnapshotToolCallMedia | null {
	const kind = data.kind === "video" ? "video" : data.kind === "image" ? "image" : null;
	const status = normalizeMediaStatus(data.status);
	if (!kind || !status) return null;
	const nodeId = readTrimmedString(data.nodeId);
	const taskId = readTrimmedString(data.taskId);
	if (!nodeId && !taskId) return null;
	const progress = normalizeMediaProgress(data.progress);
	const url = readTrimmedString(data.url);
	const thumbnailUrl = readTrimmedString(data.thumbnailUrl);
	const errorMessage = readTrimmedString(data.errorMessage);
	return {
		kind,
		status,
		pending: data.pending === true || status === "queued" || status === "running",
		nodeId,
		taskId,
		...(typeof progress === "number" ? { progress } : {}),
		...(url ? { url } : {}),
		...(thumbnailUrl ? { thumbnailUrl } : {}),
		...(errorMessage ? { errorMessage } : {}),
	};
}

function mediaStatusToToolStatus(media: PublicChatUiSnapshotToolCallMedia): PublicChatUiSnapshotToolCallStatus {
	if (media.pending || media.status === "queued" || media.status === "running") return "running";
	if (media.status === "failed") return "failed";
	return "succeeded";
}

function applyMediaResult(
	state: SnapshotAccumulatorState,
	data: Record<string, unknown>,
	nowMs: number,
): void {
	const media = buildMediaRecord(data);
	if (!media) return;
	const toolCallId = readTrimmedString(data.toolCallId);
	let matched = false;
	for (const turnId of Object.keys(state.toolCallsByTurn)) {
		const bucket = state.toolCallsByTurn[turnId] ?? [];
		let bucketChanged = false;
		const nextBucket = bucket.map((call) => {
			const directMatch = toolCallId && call.toolCallId === toolCallId;
			const identityMatch = mediaIdentityMatches(call, media);
			if (!directMatch && !identityMatch) return call;
			matched = true;
			if (!shouldApplyMediaRecord(call.media, media)) return call;
			bucketChanged = true;
			return {
				...call,
				media,
				errorMessage: call.errorMessage || media.errorMessage || "",
			};
		});
		if (bucketChanged) state.toolCallsByTurn[turnId] = nextBucket;
	}
	if (matched) return;
	const fallbackToolCallId = toolCallId || media.taskId || media.nodeId;
	if (!fallbackToolCallId) return;
	const turnId = state.currentTurnId ?? (state.turnOrder.length > 0 ? state.turnOrder[state.turnOrder.length - 1] : PENDING_TOOL_CALL_TURN_ID);
	const record: PublicChatUiSnapshotToolCall = {
		toolCallId: fallbackToolCallId,
		toolName: readTrimmedString(data.toolName) || "media_result",
		status: mediaStatusToToolStatus(media),
		media,
		outputPreview: "",
		errorMessage: media.errorMessage ?? "",
		startedAtMs: readEpochMs(data.emittedAt, nowMs),
		finishedAtMs: media.pending ? null : readEpochMs(data.emittedAt, nowMs),
		durationMs: null,
		turnId,
	};
	state.toolCallsByTurn[turnId] = [...(state.toolCallsByTurn[turnId] ?? []), record].sort(
		(a, b) => a.startedAtMs - b.startedAtMs,
	);
	if (!state.turnOrder.includes(turnId)) state.turnOrder.push(turnId);
	upsertToolTraceItem(state, fallbackToolCallId, nowMs);
}

function finalizeRunningToolCallsByTurn(
	byTurn: Record<string, PublicChatUiSnapshotToolCall[]>,
	finalization: ResolvedPublicChatUiSnapshotFinalization,
): Record<string, PublicChatUiSnapshotToolCall[]> {
	let changed = false;
	const errorMessage = readTrimmedString(finalization.message) || "对话失败";
	const finishedAtMs = normalizeFinishedAtMs(finalization.finishedAtMs, 0);
	const next: Record<string, PublicChatUiSnapshotToolCall[]> = {};
	for (const [turnId, bucket] of Object.entries(byTurn)) {
		next[turnId] = bucket.map((call) => {
			if (call.status !== "running") return call;
			changed = true;
			return {
				...call,
				status: finalization.status,
				errorMessage,
				finishedAtMs,
				durationMs: Math.max(0, finishedAtMs - call.startedAtMs),
			};
		});
	}
	return changed ? next : byTurn;
}

function pushAgentTraceItem(
	state: SnapshotAccumulatorState,
	item: PublicChatUiSnapshotAgentTraceItem,
): void {
	state.agentTraceItems = [...state.agentTraceItems, item].slice(-MAX_AGENT_TRACE_ITEMS);
}

function upsertThinkingTraceItem(
	state: SnapshotAccumulatorState,
	item: Extract<PublicChatUiSnapshotAgentTraceItem, { kind: "thinking" }>,
): void {
	const existingIndex = state.agentTraceItems.findIndex((existing) =>
		existing.kind === "thinking" &&
		existing.turnId === item.turnId &&
		existing.turnIndex === item.turnIndex);
	if (existingIndex >= 0) {
		state.agentTraceItems = state.agentTraceItems.map((existing, index) => {
			if (index !== existingIndex || existing.kind !== "thinking") return existing;
			return {
				...existing,
				text: item.text,
				at: item.at,
				...(item.parentToolCallId ? { parentToolCallId: item.parentToolCallId } : {}),
				...(item.agentId ? { agentId: item.agentId } : {}),
			};
		});
		return;
	}
	pushAgentTraceItem(state, item);
}

function findToolTraceTurnId(state: SnapshotAccumulatorState, toolCallId: string): string {
	for (const turnId of state.turnOrder) {
		if ((state.toolCallsByTurn[turnId] ?? []).some((call) => call.toolCallId === toolCallId)) return turnId;
	}
	return state.currentTurnId ?? PENDING_TOOL_CALL_TURN_ID;
}

function upsertToolTraceItem(state: SnapshotAccumulatorState, toolCallId: string, nowMs: number): void {
	if (!toolCallId) return;
	const turnId = findToolTraceTurnId(state, toolCallId);
	const existingIndex = state.agentTraceItems.findIndex((item) => item.kind === "tool" && item.toolCallId === toolCallId);
	if (existingIndex >= 0) {
		state.agentTraceItems = state.agentTraceItems.map((item, index) => {
			if (index !== existingIndex || item.kind !== "tool") return item;
			return { ...item, turnId };
		});
		return;
	}
	pushAgentTraceItem(state, {
		id: `tool:${toolCallId}`,
		kind: "tool",
		turnId,
		toolCallId,
		at: nowMs,
	});
}

function upsertTodoTraceItem(state: SnapshotAccumulatorState, data: Record<string, unknown>, nowMs: number): void {
	const sourceToolCallId = readTrimmedString(data.sourceToolCallId) || "todo";
	const turnId = readTrimmedString(data.turnId) || state.currentTurnId || PENDING_TOOL_CALL_TURN_ID;
	const parentToolCallId = readTrimmedString(data.parentToolCallId);
	const agentId = readTrimmedString(data.agentId);
	const existingIndex = state.agentTraceItems.findIndex((item) => item.kind === "todo");
	if (existingIndex >= 0) {
		state.agentTraceItems = state.agentTraceItems.map((item, index) => {
			if (index !== existingIndex || item.kind !== "todo") return item;
			return {
				...item,
				id: `todo:${sourceToolCallId}`,
				turnId,
				sourceToolCallId,
				at: nowMs,
				...(parentToolCallId ? { parentToolCallId } : {}),
				...(agentId ? { agentId } : {}),
			};
		});
		return;
	}
	pushAgentTraceItem(state, {
		id: `todo:${sourceToolCallId}`,
		kind: "todo",
		turnId,
		sourceToolCallId,
		at: nowMs,
		...(parentToolCallId ? { parentToolCallId } : {}),
		...(agentId ? { agentId } : {}),
	});
}

function resolveTrailingTurnId(state: SnapshotAccumulatorState): string {
	if (state.currentTurnId) return state.currentTurnId;
	if (state.turnOrder.length > 0) return state.turnOrder[state.turnOrder.length - 1];
	return PENDING_TOOL_CALL_TURN_ID;
}

function upsertResponseTraceItem(state: SnapshotAccumulatorState, response: AgentsChatResponseDto | null | undefined, nowMs: number): void {
	const text = readTrimmedString(response?.text);
	if (!text) return;
	const turnId = resolveTrailingTurnId(state);
	const existingIndex = state.agentTraceItems.findIndex((item) => item.kind === "response");
	if (existingIndex >= 0) {
		state.agentTraceItems = state.agentTraceItems.map((item, index) => {
			if (index !== existingIndex || item.kind !== "response") return item;
			return { ...item, text, at: nowMs, turnId };
		});
		return;
	}
	pushAgentTraceItem(state, {
		id: `response:${nowMs}`,
		kind: "response",
		turnId,
		text,
		at: nowMs,
	});
}

export function createPublicChatUiSnapshotAccumulator(
	now: () => number = () => Date.now(),
): PublicChatUiSnapshotAccumulator {
	const state: SnapshotAccumulatorState = {
		toolCallsByTurn: {},
		turnOrder: [],
		currentTurnId: null,
		todoSnapshot: [],
		agentTraceItems: [],
		toolSequence: 0,
	};
	return {
		recordEvent(eventName, data) {
			if (eventName === "turn.started") {
				const turnId = readTurnIdFromLifecycleEvent(data, `turn-${state.turnOrder.length + 1}`);
				state.currentTurnId = turnId;
				if (!state.turnOrder.includes(turnId)) state.turnOrder.push(turnId);
				if (!state.toolCallsByTurn[turnId]) state.toolCallsByTurn[turnId] = [];
				state.agentTraceItems = state.agentTraceItems.map((item) => {
					if (item.turnId !== PENDING_TOOL_CALL_TURN_ID) return item;
					if (item.kind === "thinking") return { ...item, turnId };
					if (item.kind === "tool") return { ...item, turnId };
					if (item.kind === "todo") return { ...item, turnId };
					if (item.kind === "response") return { ...item, turnId };
					return item;
				});
				return;
			}
			if (eventName === "turn.completed") {
				state.currentTurnId = null;
				return;
			}
			if (eventName === "thinking") {
				const record = asRecord(data);
				const text = readTrimmedString(record?.text);
				if (!text) return;
				const turnId = readTrimmedString(record?.turnId) || state.currentTurnId || PENDING_TOOL_CALL_TURN_ID;
				const rawTurnIndex = record?.turnIndex;
				const turnIndex = typeof rawTurnIndex === "number" && Number.isFinite(rawTurnIndex)
					? Math.max(0, Math.trunc(rawTurnIndex))
					: null;
				const parentToolCallId = readTrimmedString(record?.parentToolCallId);
				const agentId = readTrimmedString(record?.agentId);
				upsertThinkingTraceItem(state, {
					id: `thinking:${turnId}:${turnIndex ?? state.agentTraceItems.length}`,
					kind: "thinking",
					turnId,
					turnIndex,
					text,
					at: now(),
					...(parentToolCallId ? { parentToolCallId } : {}),
					...(agentId ? { agentId } : {}),
				});
				return;
			}
			if (eventName === "todo_list") {
				const record = asRecord(data);
				const todoSnapshot = normalizeTodoItems(record?.items);
				if (!record || todoSnapshot.length === 0) return;
				state.todoSnapshot = todoSnapshot;
				upsertTodoTraceItem(state, record, now());
				return;
			}
			if (eventName === "media_result") {
				const record = asRecord(data);
				if (!record) return;
				applyMediaResult(state, record, now());
				return;
			}
			if (eventName !== "tool") return;
			const record = asRecord(data);
			if (!record) return;
			const phase = readTrimmedString(record.phase);
			const isAskUserTool = readTrimmedString(record.toolName) === "ask_user";
			if (phase === "started") {
				startToolCall(state, record, now());
				if (!isAskUserTool) {
					upsertToolTraceItem(state, readTrimmedString(record.toolCallId), now());
				}
				return;
			}
			if (phase === "completed") {
				completeToolCall(state, record, now());
				if (!isAskUserTool) {
					upsertToolTraceItem(state, readTrimmedString(record.toolCallId), now());
				}
			}
		},
		buildSnapshot(response, finalization) {
			const snapshotNow = now();
			upsertResponseTraceItem(state, response, snapshotNow);
			const toolCallsByTurn = finalization
				? finalizeRunningToolCallsByTurn(state.toolCallsByTurn, {
						status: finalization.status,
						message: finalization.message,
						finishedAtMs: normalizeFinishedAtMs(finalization.finishedAtMs, snapshotNow),
					})
				: state.toolCallsByTurn;
			const turnIds = state.turnOrder.filter((turnId) => (toolCallsByTurn[turnId] ?? []).length > 0);
			const toolCallSnapshot = turnIds.length > 0
				? {
						turnIds,
						record: {
							toolCallsByTurn: Object.fromEntries(
								turnIds.map((turnId) => [turnId, toolCallsByTurn[turnId] ?? []]),
							),
						},
					}
				: undefined;
			const liveSnapshot = compactSnapshot({
				todoSnapshot: state.todoSnapshot,
				toolCallSnapshot,
				agentTraceSnapshot: state.agentTraceItems.length > 0 ? { items: state.agentTraceItems } : undefined,
			});
			return response
				? buildPublicChatUiSnapshotFromResponse({ response, preferredSnapshot: liveSnapshot })
				: liveSnapshot;
		},
	};
}
