import type { PrismaClient } from "../../types";
import { execute, queryAll, queryOne } from "../../db/db";
import { assertOpenWorkspaceDataScope } from "../auth/open-workspace-data-scope";
import { PUBLIC_CHAT_SESSION_KEY_MAX_LENGTH } from "./public-chat-session.constants";

export type PublicChatSessionRow = {
	id: string;
	session_key: string;
	created_at: string;
	updated_at: string;
};

export type PublicChatMessageRole = "user" | "assistant";

export type PublicChatAskUserUrgency = "info" | "confirmation" | "blocker";

export type PublicChatAskUserPrompt = {
	toolCallId: string;
	question: string;
	options: string[];
	optionCards: PublicChatAskUserOptionCard[];
	urgency: PublicChatAskUserUrgency;
	askedAt: string | null;
	awaitingReply: boolean;
};

export type PublicChatAskUserOptionCard = {
	value: string;
	imageUrl: string;
	thumbnailUrl?: string;
	title?: string;
	displayValue?: string;
};

export type PublicChatMessageRow = {
	id: string;
	session_id: string;
	role: PublicChatMessageRole;
	content: string;
	skill_mention: string | null;
	assets_json: string | null;
	ask_user_prompt_json: string | null;
	ui_snapshot_json: string | null;
	created_at: string;
};

export type PublicChatUiSnapshotTodoItem = {
	status: "pending" | "in_progress" | "waiting" | "blocked" | "completed";
	content: string;
};

export type PublicChatUiSnapshotToolCallStatus =
	| "running"
	| "succeeded"
	| "failed"
	| "denied"
	| "blocked";

export type PublicChatUiSnapshotToolCallMedia = {
	kind: "image" | "video";
	status: "queued" | "running" | "succeeded" | "failed";
	pending: boolean;
	nodeId: string;
	taskId: string;
	progress?: number;
	url?: string;
	thumbnailUrl?: string;
	errorMessage?: string;
};

export type PublicChatUiSnapshotToolCall = {
	toolCallId: string;
	toolName: string;
	status: PublicChatUiSnapshotToolCallStatus;
	media?: PublicChatUiSnapshotToolCallMedia;
	input?: unknown;
	outputJson?: Record<string, unknown>;
	outputPreview: string;
	errorMessage: string;
	startedAtMs: number;
	finishedAtMs: number | null;
	durationMs: number | null;
	turnId: string;
	parentToolCallId?: string;
	agentId?: string;
	agentType?: string;
	agentDepth?: number;
};

export type PublicChatUiSnapshotToolCallSnapshot = {
	turnIds: string[];
	record: {
		toolCallsByTurn: Record<string, PublicChatUiSnapshotToolCall[]>;
	};
};

export type PublicChatUiSnapshotAgentTraceItem =
	| {
		id: string;
		kind: "thinking";
		turnId: string;
		turnIndex: number | null;
		text: string;
		at: number;
		parentToolCallId?: string;
		agentId?: string;
	}
	| {
		id: string;
		kind: "tool";
		turnId: string;
		toolCallId: string;
		at: number;
	}
	| {
		id: string;
		kind: "todo";
		turnId: string;
		sourceToolCallId: string;
		at: number;
		parentToolCallId?: string;
		agentId?: string;
	}
	| {
		id: string;
		kind: "response";
		turnId: string;
		text: string;
		at: number;
	};

export type PublicChatUiSnapshotAgentTraceSnapshot = {
	items: PublicChatUiSnapshotAgentTraceItem[];
};

export type PublicChatUiSnapshotDiagnosticFlag = {
	code: string;
	severity: "high" | "medium";
	title: string;
	detail: string;
};

export type PublicChatUiSnapshot = {
	todoSnapshot?: PublicChatUiSnapshotTodoItem[];
	toolCallSnapshot?: PublicChatUiSnapshotToolCallSnapshot;
	agentTraceSnapshot?: PublicChatUiSnapshotAgentTraceSnapshot;
	turnVerdict?: {
		status: PublicChatTurnVerdict;
		reasons: string[];
	};
	diagnosticFlags?: PublicChatUiSnapshotDiagnosticFlag[];
};

export type PublicChatTurnVerdict = "satisfied" | "partial" | "failed";
export type PublicChatRunOutcome = "promote" | "hold" | "discard";

export type PublicChatTurnRunRow = {
	id: string;
	session_id: string;
	request_id: string | null;
	session_key: string;
	project_id: string | null;
	label: string | null;
	workflow_key: string;
	request_kind: string;
	user_message_id: string | null;
	assistant_message_id: string | null;
	output_mode: string;
	turn_verdict: PublicChatTurnVerdict;
	turn_verdict_reasons_json: string;
	run_outcome: PublicChatRunOutcome;
	agent_decision_json: string | null;
	tool_status_summary_json: string | null;
	diagnostic_flags_json: string | null;
	canvas_plan_json: string | null;
	asset_count: number;
	canvas_write: number;
	run_ms: number | null;
	created_at: string;
};

function assertPublicChatDataScope(userId: string, operation: string): void {
	assertOpenWorkspaceDataScope({
		userId,
		resource: "public_chat_sessions",
		operation,
	});
}

export type PublicChatRunStatus = "running" | "succeeded" | "failed" | "aborted";

export type PublicChatRunRow = {
	id: string;
	user_id: string;
	session_key: string;
	canvas_project_id: string | null;
	canvas_flow_id: string | null;
	status: PublicChatRunStatus;
	request_text: string;
	display_text: string;
	request_json: string;
	response_json: string | null;
	error_json: string | null;
	user_message_id: string | null;
	assistant_message_id: string | null;
	created_at: string;
	updated_at: string;
	finished_at: string | null;
};

export type PublicChatRunEventRow = {
	id: string;
	run_id: string;
	user_id: string;
	seq: number;
	event_name: string;
	data_json: string;
	created_at: string;
};

let schemaEnsured = false;
let schemaEnsurePromise: Promise<void> | null = null;

export async function ensurePublicChatSessionSchema(db: PrismaClient): Promise<void> {
	if (schemaEnsured) return;
	if (schemaEnsurePromise) {
		await schemaEnsurePromise;
		return;
	}
	schemaEnsurePromise = (async () => {
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS public_chat_sessions (
      id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(session_key)
    )`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_sessions_updated
     ON public_chat_sessions(updated_at DESC)`,
		);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS public_chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      skill_mention TEXT,
      assets_json TEXT,
      ask_user_prompt_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES public_chat_sessions(id)
    )`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_messages_session_created
     ON public_chat_messages(session_id, created_at ASC)`,
		);
		await execute(db, `ALTER TABLE public_chat_messages ADD COLUMN IF NOT EXISTS ask_user_prompt_json TEXT`);
		await execute(db, `ALTER TABLE public_chat_messages ADD COLUMN IF NOT EXISTS ui_snapshot_json TEXT`);
		await execute(db, `ALTER TABLE public_chat_messages ADD COLUMN IF NOT EXISTS skill_mention TEXT`);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS public_chat_turn_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      request_id TEXT,
      session_key TEXT NOT NULL,
      project_id TEXT,
      book_id TEXT,
      chapter_id TEXT,
      label TEXT,
      workflow_key TEXT NOT NULL,
      request_kind TEXT NOT NULL,
      user_message_id TEXT,
      assistant_message_id TEXT,
      output_mode TEXT NOT NULL,
      turn_verdict TEXT NOT NULL,
      turn_verdict_reasons_json TEXT NOT NULL,
      run_outcome TEXT NOT NULL DEFAULT 'hold',
      agent_decision_json TEXT,
      tool_status_summary_json TEXT,
      diagnostic_flags_json TEXT,
      canvas_plan_json TEXT,
      asset_count INTEGER NOT NULL DEFAULT 0,
      canvas_write INTEGER NOT NULL DEFAULT 0,
      run_ms INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES public_chat_sessions(id)
    )`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_session_created
     ON public_chat_turn_runs(session_id, created_at ASC)`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_workflow_created
     ON public_chat_turn_runs(workflow_key, created_at DESC)`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_verdict_created
     ON public_chat_turn_runs(turn_verdict, created_at DESC)`,
		);
		await execute(db, `ALTER TABLE public_chat_turn_runs ADD COLUMN IF NOT EXISTS project_id TEXT`);
		await execute(db, `ALTER TABLE public_chat_turn_runs ADD COLUMN IF NOT EXISTS book_id TEXT`);
		await execute(db, `ALTER TABLE public_chat_turn_runs ADD COLUMN IF NOT EXISTS chapter_id TEXT`);
		await execute(db, `ALTER TABLE public_chat_turn_runs ADD COLUMN IF NOT EXISTS label TEXT`);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_project_created
     ON public_chat_turn_runs(project_id, created_at DESC)`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_book_chapter_created
     ON public_chat_turn_runs(book_id, chapter_id, created_at DESC)`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_label_created
     ON public_chat_turn_runs(label, created_at DESC)`,
		);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS public_chat_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      canvas_project_id TEXT,
      canvas_flow_id TEXT,
      status TEXT NOT NULL,
      request_text TEXT NOT NULL,
      display_text TEXT NOT NULL,
      request_json TEXT NOT NULL,
      response_json TEXT,
      error_json TEXT,
      event_seq INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    )`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_runs_user_scope_status
     ON public_chat_runs(user_id, session_key, status, updated_at DESC)`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_runs_canvas_scope_status
     ON public_chat_runs(user_id, canvas_project_id, canvas_flow_id, status, updated_at DESC)`,
		);
		await execute(db, `ALTER TABLE public_chat_runs ADD COLUMN IF NOT EXISTS user_message_id TEXT`);
		await execute(db, `ALTER TABLE public_chat_runs ADD COLUMN IF NOT EXISTS assistant_message_id TEXT`);
		await execute(db, `ALTER TABLE public_chat_runs ADD COLUMN IF NOT EXISTS event_seq INTEGER NOT NULL DEFAULT 0`);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS public_chat_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      event_name TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(run_id, seq),
      FOREIGN KEY (run_id) REFERENCES public_chat_runs(id)
    )`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_run_events_user_run_seq
     ON public_chat_run_events(user_id, run_id, seq ASC)`,
		);
		await execute(
			db,
			`UPDATE public_chat_runs AS run
	     SET event_seq = event_max.max_seq
	     FROM (
	       SELECT run_id, MAX(seq) AS max_seq
	       FROM public_chat_run_events
	       GROUP BY run_id
	     ) AS event_max
	     WHERE run.id = event_max.run_id
	       AND run.event_seq < event_max.max_seq`,
		);
		schemaEnsured = true;
	})();
	try {
		await schemaEnsurePromise;
	} finally {
		schemaEnsurePromise = null;
	}
}

function normalizeOptionalString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalNullableString(value: unknown): string | null {
	const normalized = normalizeOptionalString(value);
	return normalized ? normalized : null;
}

function normalizeSkillMention(value: unknown): string | null {
	const normalized = normalizeOptionalString(value);
	return normalized.startsWith("@") ? normalized.slice(0, 160) : null;
}

function stringifyJson(value: unknown): string {
	try {
		return JSON.stringify(value ?? null);
	} catch {
		return "null";
	}
}

function normalizePublicChatRunStatus(value: unknown): PublicChatRunStatus {
	return value === "succeeded" || value === "failed" || value === "aborted" ? value : "running";
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	return Math.max(1, Math.min(max, Math.trunc(numeric)));
}

function normalizeStringArray(value: unknown, limit: number): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const text = normalizeOptionalString(item);
		if (!text || seen.has(text)) continue;
		seen.add(text);
		out.push(text);
		if (out.length >= limit) break;
	}
	return out;
}

function normalizePublicChatAskUserOptionCards(value: unknown): PublicChatAskUserOptionCard[] {
	if (!Array.isArray(value)) return [];
	const out: PublicChatAskUserOptionCard[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		const optionValue = normalizeOptionalString(record.value);
		const imageUrl = normalizeOptionalString(record.imageUrl);
		if (!optionValue || !imageUrl || seen.has(optionValue)) continue;
		seen.add(optionValue);
		const thumbnailUrl = normalizeOptionalString(record.thumbnailUrl);
		const title = normalizeOptionalString(record.title);
		const displayValue = normalizeOptionalString(record.displayValue);
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

export function normalizePublicChatAskUserPrompt(value: unknown): PublicChatAskUserPrompt | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const toolCallId = normalizeOptionalString(record.toolCallId);
	const question = normalizeOptionalString(record.question);
	if (!toolCallId || !question) return null;
	const urgencyRaw = normalizeOptionalString(record.urgency);
	const urgency: PublicChatAskUserUrgency =
		urgencyRaw === "info" || urgencyRaw === "confirmation" || urgencyRaw === "blocker"
			? urgencyRaw
			: "confirmation";
	const askedAt = normalizeOptionalString(record.askedAt) || null;
	return {
		toolCallId,
		question,
		options: normalizeStringArray(record.options, 8),
		optionCards: normalizePublicChatAskUserOptionCards(record.optionCards),
		urgency,
		askedAt,
		awaitingReply: record.awaitingReply !== false,
	};
}

const TRUNCATED_ASK_USER_QUESTION_SUFFIX = /…\(truncated,len=\d+\)$/;

export function restoreTruncatedPublicChatAskUserQuestion(
	prompt: PublicChatAskUserPrompt | null,
	assistantContent: unknown,
): PublicChatAskUserPrompt | null {
	if (!prompt) return null;
	const content = normalizeOptionalString(assistantContent);
	if (
		!content ||
		content.length <= prompt.question.length ||
		!TRUNCATED_ASK_USER_QUESTION_SUFFIX.test(prompt.question)
	) {
		return prompt;
	}
	return {
		...prompt,
		question: content,
	};
}

export function normalizePublicChatSessionKey(value: unknown): string {
	const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!raw) return "";
	return raw.replace(/[^a-z0-9:_-]/g, "").slice(0, PUBLIC_CHAT_SESSION_KEY_MAX_LENGTH);
}

export async function createPublicChatRun(
	db: PrismaClient,
	input: {
		id: string;
		userId: string;
		sessionKey: string;
		canvasProjectId?: string | null;
		canvasFlowId?: string | null;
		requestText: string;
		displayText: string;
		requestJson: string;
		userMessageId?: string | null;
		assistantMessageId?: string | null;
		nowIso: string;
	},
): Promise<PublicChatRunRow | null> {
	await ensurePublicChatSessionSchema(db);
	const id = normalizeOptionalString(input.id);
	const userId = normalizeOptionalString(input.userId);
	const sessionKey = normalizePublicChatSessionKey(input.sessionKey);
	const requestText = normalizeOptionalString(input.requestText);
	const displayText = normalizeOptionalString(input.displayText) || requestText;
	if (!id || !userId || !sessionKey || !requestText) return null;
	await execute(
		db,
		`INSERT INTO public_chat_runs (
      id,
      user_id,
      session_key,
      canvas_project_id,
      canvas_flow_id,
      status,
      request_text,
      display_text,
      request_json,
      response_json,
      error_json,
      user_message_id,
      assistant_message_id,
      created_at,
      updated_at,
      finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			userId,
			sessionKey,
			normalizeOptionalNullableString(input.canvasProjectId),
			normalizeOptionalNullableString(input.canvasFlowId),
			"running",
			requestText,
			displayText,
			input.requestJson,
			null,
			null,
			normalizeOptionalNullableString(input.userMessageId ?? null),
			normalizeOptionalNullableString(input.assistantMessageId ?? null),
			input.nowIso,
			input.nowIso,
			null,
		],
	);
	return queryOne<PublicChatRunRow>(
		db,
		`SELECT * FROM public_chat_runs
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
		[id, userId],
	);
}

export async function appendPublicChatRunEvent(
	db: PrismaClient,
	input: {
		runId: string;
		userId: string;
		eventName: string;
		data: unknown;
		nowIso: string;
	},
): Promise<PublicChatRunEventRow | null> {
	await ensurePublicChatSessionSchema(db);
	const runId = normalizeOptionalString(input.runId);
	const userId = normalizeOptionalString(input.userId);
	const eventName = normalizeOptionalString(input.eventName);
	if (!runId || !userId || !eventName) return null;
	return queryOne<PublicChatRunEventRow>(
		db,
		`WITH next_event AS (
       UPDATE public_chat_runs AS run
       SET event_seq = GREATEST(
             run.event_seq,
             (
               SELECT COALESCE(MAX(seq), 0)
               FROM public_chat_run_events
               WHERE run_id = run.id AND user_id = run.user_id
             )
           ) + 1,
           updated_at = ?
       WHERE run.id = ? AND run.user_id = ?
       RETURNING run.id AS run_id, run.user_id, run.event_seq AS seq
     )
     INSERT INTO public_chat_run_events (
       id,
       run_id,
       user_id,
       seq,
       event_name,
       data_json,
       created_at
     )
     SELECT
       run_id || '_evt_' || seq::text,
       run_id,
       user_id,
       seq,
       ?,
       ?,
       ?
     FROM next_event
     RETURNING *`,
		[input.nowIso, runId, userId, eventName, stringifyJson(input.data), input.nowIso],
	);
}

export async function updatePublicChatRunStatus(
	db: PrismaClient,
	input: {
		runId: string;
		userId: string;
		status: PublicChatRunStatus;
		responseJson?: string | null;
		errorJson?: string | null;
		nowIso: string;
		finishedAt?: string | null;
	},
): Promise<void> {
	await ensurePublicChatSessionSchema(db);
	const runId = normalizeOptionalString(input.runId);
	const userId = normalizeOptionalString(input.userId);
	if (!runId || !userId) return;
	const status = normalizePublicChatRunStatus(input.status);
	await execute(
		db,
		`UPDATE public_chat_runs
     SET status = ?,
         response_json = ?,
         error_json = ?,
         updated_at = ?,
         finished_at = ?
     WHERE id = ? AND user_id = ?`,
		[
			status,
			input.responseJson ?? null,
			input.errorJson ?? null,
			input.nowIso,
			input.finishedAt ?? (status === "running" ? null : input.nowIso),
			runId,
			userId,
		],
	);
}

export async function findPublicChatRunById(
	db: PrismaClient,
	input: { runId: string; userId: string },
): Promise<PublicChatRunRow | null> {
	await ensurePublicChatSessionSchema(db);
	const runId = normalizeOptionalString(input.runId);
	const userId = normalizeOptionalString(input.userId);
	if (!runId || !userId) return null;
	return queryOne<PublicChatRunRow>(
		db,
		`SELECT * FROM public_chat_runs
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
		[runId, userId],
	);
}

export async function markStalePublicChatRunsAsFailed(
	db: PrismaClient,
	input: {
		userId: string;
		sessionKey?: string | null;
		runId?: string | null;
		skipRunIds?: string[];
		thresholdSecondsAgo: number;
		nowIso: string;
		errorJson?: string | null;
		limit?: number;
	},
): Promise<{ markedRunIds: string[] }> {
	await ensurePublicChatSessionSchema(db);
	const userId = normalizeOptionalString(input.userId);
	if (!userId) return { markedRunIds: [] };
	const thresholdSecondsAgo = Math.max(60, Math.trunc(Number(input.thresholdSecondsAgo) || 600));
	const cutoffIso = new Date(Date.now() - thresholdSecondsAgo * 1000).toISOString();
	const sessionKey = normalizePublicChatSessionKey(input.sessionKey || "");
	const targetRunId = normalizeOptionalString(input.runId);
	const limit = normalizePositiveInteger(input.limit, 20, 100);
	const skipSet = new Set(
		(input.skipRunIds || [])
			.map((id) => normalizeOptionalString(id))
			.filter((id) => id.length > 0),
	);
	const selectParts = ["status = 'running'", "user_id = ?", "updated_at < ?"];
	const selectParams: Array<string | number> = [userId, cutoffIso];
	if (sessionKey) {
		selectParts.push("session_key = ?");
		selectParams.push(sessionKey);
	}
	if (targetRunId) {
		selectParts.push("id = ?");
		selectParams.push(targetRunId);
	}
	selectParams.push(limit);
	const stale = await queryAll<{ id: string }>(
		db,
		`SELECT id FROM public_chat_runs
     WHERE ${selectParts.join(" AND ")}
     ORDER BY updated_at ASC
     LIMIT ?`,
		selectParams,
	);
	const targets = stale
		.map((row) => normalizeOptionalString(row?.id))
		.filter((id) => id.length > 0 && !skipSet.has(id));
	if (targets.length === 0) return { markedRunIds: [] };
	const placeholders = targets.map(() => "?").join(", ");
	const errorJson = input.errorJson ?? null;
	await execute(
		db,
		`UPDATE public_chat_runs
     SET status = 'failed',
         error_json = ?,
         updated_at = ?,
         finished_at = ?
     WHERE user_id = ? AND status = 'running' AND id IN (${placeholders})`,
		[errorJson, input.nowIso, input.nowIso, userId, ...targets],
	);
	return { markedRunIds: targets };
}

export async function listActivePublicChatRuns(
	db: PrismaClient,
	input: {
		userId: string;
		sessionKey: string;
		canvasProjectId?: string | null;
		canvasFlowId?: string | null;
		limit?: number;
	},
): Promise<PublicChatRunRow[]> {
	await ensurePublicChatSessionSchema(db);
	const userId = normalizeOptionalString(input.userId);
	const sessionKey = normalizePublicChatSessionKey(input.sessionKey);
	if (!userId || !sessionKey) return [];
	const whereParts = ["user_id = ?", "session_key = ?", "status = 'running'"];
	const params: Array<string | number> = [userId, sessionKey];
	const canvasProjectId = normalizeOptionalNullableString(input.canvasProjectId);
	const canvasFlowId = normalizeOptionalNullableString(input.canvasFlowId);
	if (canvasProjectId) {
		whereParts.push("canvas_project_id = ?");
		params.push(canvasProjectId);
	}
	if (canvasFlowId) {
		whereParts.push("canvas_flow_id = ?");
		params.push(canvasFlowId);
	}
	const limit = normalizePositiveInteger(input.limit, 5, 20);
	params.push(limit);
	return queryAll<PublicChatRunRow>(
		db,
		`SELECT * FROM public_chat_runs
     WHERE ${whereParts.join(" AND ")}
     ORDER BY updated_at DESC
     LIMIT ?`,
		params,
	);
}

export async function listPublicChatRunEventsAfter(
	db: PrismaClient,
	input: {
		runId: string;
		userId: string;
		afterSeq: number;
		limit?: number;
	},
): Promise<PublicChatRunEventRow[]> {
	await ensurePublicChatSessionSchema(db);
	const runId = normalizeOptionalString(input.runId);
	const userId = normalizeOptionalString(input.userId);
	if (!runId || !userId) return [];
	const afterSeq = Math.max(0, Math.trunc(Number(input.afterSeq || 0)));
	const limit = normalizePositiveInteger(input.limit, 100, 500);
	return queryAll<PublicChatRunEventRow>(
		db,
		`SELECT * FROM public_chat_run_events
     WHERE run_id = ? AND user_id = ? AND seq > ?
     ORDER BY seq ASC
     LIMIT ?`,
		[runId, userId, afterSeq, limit],
	);
}

export async function resolveOrCreatePublicChatSession(
	db: PrismaClient,
	input: { id: string; userId: string; sessionKey: string; nowIso: string },
): Promise<PublicChatSessionRow | null> {
	await ensurePublicChatSessionSchema(db);
	assertPublicChatDataScope(input.userId, "resolve_or_create_session");
	const sessionKey = normalizePublicChatSessionKey(input.sessionKey);
	if (!sessionKey) return null;
	await execute(
		db,
		`INSERT INTO public_chat_sessions (id, session_key, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_key) DO UPDATE SET
         updated_at = excluded.updated_at`,
		[input.id, sessionKey, input.nowIso, input.nowIso],
	);
	return queryOne<PublicChatSessionRow>(
		db,
		`SELECT * FROM public_chat_sessions WHERE session_key = ? LIMIT 1`,
		[sessionKey],
	);
}

export async function findPublicChatSessionByKey(
	db: PrismaClient,
	input: { userId: string; sessionKey: string },
): Promise<PublicChatSessionRow | null> {
	await ensurePublicChatSessionSchema(db);
	assertPublicChatDataScope(input.userId, "find_session_by_key");
	const sessionKey = normalizePublicChatSessionKey(input.sessionKey);
	if (!sessionKey) return null;
	return queryOne<PublicChatSessionRow>(
		db,
		`SELECT * FROM public_chat_sessions WHERE session_key = ? LIMIT 1`,
		[sessionKey],
	);
}

export async function listPublicChatSessionsByPrefix(
	db: PrismaClient,
	input: { userId: string; sessionKeyPrefix: string; limit?: number },
): Promise<PublicChatSessionRow[]> {
	await ensurePublicChatSessionSchema(db);
	assertPublicChatDataScope(input.userId, "list_sessions_by_prefix");
	const sessionKeyPrefix = normalizePublicChatSessionKey(input.sessionKeyPrefix);
	if (!sessionKeyPrefix) return [];
	const limit = Number.isFinite(input.limit)
		? Math.max(1, Math.min(30, Math.trunc(Number(input.limit))))
		: 10;
	return queryAll<PublicChatSessionRow>(
		db,
		`SELECT * FROM public_chat_sessions
		 WHERE session_key LIKE ?
		 ORDER BY updated_at DESC
		 LIMIT ?`,
		[`${sessionKeyPrefix}%`, limit],
	);
}

export async function appendPublicChatMessage(
	db: PrismaClient,
	input: {
		id: string;
		userId: string;
		sessionId: string;
		role: PublicChatMessageRole;
		content: string;
		skillMention?: string | null;
		assetsJson?: string | null;
		askUserPromptJson?: string | null;
		uiSnapshotJson?: string | null;
		nowIso: string;
	},
): Promise<void> {
	await ensurePublicChatSessionSchema(db);
	assertPublicChatDataScope(input.userId, "append_message");
	const sessionId = String(input.sessionId || "").trim();
	const content = String(input.content || "").trim();
	const skillMention = normalizeSkillMention(input.skillMention);
	const hasAssistantMetadata =
		input.role === "assistant" &&
		Boolean(input.assetsJson || input.askUserPromptJson || input.uiSnapshotJson);
	if (!sessionId || (!content && !hasAssistantMetadata)) return;
	await execute(
		db,
		`INSERT INTO public_chat_messages (
        id,
        session_id,
        role,
        content,
        skill_mention,
        assets_json,
        ask_user_prompt_json,
        ui_snapshot_json,
        created_at
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.id,
			sessionId,
			input.role,
			content,
			skillMention,
			input.assetsJson ?? null,
			input.askUserPromptJson ?? null,
			input.uiSnapshotJson ?? null,
			input.nowIso,
		],
	);
	await execute(
		db,
		`UPDATE public_chat_sessions
       SET updated_at = ?
       WHERE id = ?`,
		[input.nowIso, sessionId],
	);
}

export async function upsertPublicChatMessage(
	db: PrismaClient,
	input: {
		id: string;
		userId: string;
		sessionId: string;
		role: PublicChatMessageRole;
		content: string;
		skillMention?: string | null;
		assetsJson?: string | null;
		askUserPromptJson?: string | null;
		uiSnapshotJson?: string | null;
		nowIso: string;
	},
): Promise<void> {
	await ensurePublicChatSessionSchema(db);
	assertPublicChatDataScope(input.userId, "upsert_message");
	const sessionId = String(input.sessionId || "").trim();
	const content = String(input.content || "").trim();
	const skillMention = normalizeSkillMention(input.skillMention);
	const hasAssistantMetadata =
		input.role === "assistant" &&
		Boolean(input.assetsJson || input.askUserPromptJson || input.uiSnapshotJson);
	if (!sessionId || (!content && !hasAssistantMetadata)) return;
	await execute(
		db,
		`INSERT INTO public_chat_messages (
        id,
        session_id,
        role,
        content,
        skill_mention,
        assets_json,
        ask_user_prompt_json,
        ui_snapshot_json,
        created_at
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         role = EXCLUDED.role,
         content = CASE
           WHEN length(EXCLUDED.content) > 0 THEN EXCLUDED.content
           ELSE public_chat_messages.content
         END,
         skill_mention = COALESCE(EXCLUDED.skill_mention, public_chat_messages.skill_mention),
         assets_json = COALESCE(EXCLUDED.assets_json, public_chat_messages.assets_json),
         ask_user_prompt_json = COALESCE(EXCLUDED.ask_user_prompt_json, public_chat_messages.ask_user_prompt_json),
         ui_snapshot_json = COALESCE(EXCLUDED.ui_snapshot_json, public_chat_messages.ui_snapshot_json)`,
		[
			input.id,
			sessionId,
			input.role,
			content,
			skillMention,
			input.assetsJson ?? null,
			input.askUserPromptJson ?? null,
			input.uiSnapshotJson ?? null,
			input.nowIso,
		],
	);
	await execute(
		db,
		`UPDATE public_chat_sessions
       SET updated_at = ?
       WHERE id = ?`,
		[input.nowIso, sessionId],
	);
}

export async function listPublicChatMessages(
	db: PrismaClient,
	input: { userId: string; sessionId: string; limit?: number },
): Promise<PublicChatMessageRow[]> {
	await ensurePublicChatSessionSchema(db);
	assertPublicChatDataScope(input.userId, "list_messages");
	const sessionId = String(input.sessionId || "").trim();
	if (!sessionId) return [];
	const limit = Number.isFinite(input.limit)
		? Math.max(1, Math.min(80, Math.trunc(Number(input.limit))))
		: 24;
	const rows = await queryAll<PublicChatMessageRow>(
		db,
		`SELECT * FROM public_chat_messages
     WHERE session_id = ?
     ORDER BY created_at DESC, ctid DESC
     LIMIT ?`,
		[sessionId, limit],
	);
	return rows.reverse();
}

export async function appendPublicChatTurnRun(
	db: PrismaClient,
	input: {
		id: string;
		userId: string;
		sessionId: string;
		requestId?: string | null;
		sessionKey: string;
		projectId?: string | null;
		label?: string | null;
		workflowKey: string;
		requestKind: string;
		userMessageId?: string | null;
		assistantMessageId?: string | null;
		outputMode: string;
		turnVerdict: PublicChatTurnVerdict;
		turnVerdictReasonsJson: string;
		runOutcome: PublicChatRunOutcome;
		agentDecisionJson?: string | null;
		toolStatusSummaryJson?: string | null;
		diagnosticFlagsJson?: string | null;
		canvasPlanJson?: string | null;
		assetCount: number;
		canvasWrite: boolean;
		runMs?: number | null;
		nowIso: string;
	},
): Promise<void> {
	await ensurePublicChatSessionSchema(db);
	assertPublicChatDataScope(input.userId, "append_turn_run");
	const sessionId = String(input.sessionId || "").trim();
	const sessionKey = normalizePublicChatSessionKey(input.sessionKey);
	const workflowKey = String(input.workflowKey || "").trim().toLowerCase();
	const requestKind = String(input.requestKind || "").trim();
	const outputMode = String(input.outputMode || "").trim();
	const turnVerdict = String(input.turnVerdict || "").trim() as PublicChatTurnVerdict;
	const runOutcome = String(input.runOutcome || "").trim() as PublicChatRunOutcome;
	if (!sessionId || !sessionKey || !workflowKey || !requestKind || !outputMode) return;
	await execute(
		db,
		`INSERT INTO public_chat_turn_runs (
      id, session_id, request_id, session_key, project_id, label, workflow_key, request_kind,
      user_message_id, assistant_message_id, output_mode, turn_verdict,
      turn_verdict_reasons_json, run_outcome, agent_decision_json,
      tool_status_summary_json, diagnostic_flags_json, canvas_plan_json,
      asset_count, canvas_write, run_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.id,
			sessionId,
			input.requestId?.trim() || null,
			sessionKey,
			input.projectId?.trim() || null,
			input.label?.trim() || null,
			workflowKey,
			requestKind,
			input.userMessageId?.trim() || null,
			input.assistantMessageId?.trim() || null,
			outputMode,
			turnVerdict,
			input.turnVerdictReasonsJson,
			runOutcome,
			input.agentDecisionJson ?? null,
			input.toolStatusSummaryJson ?? null,
			input.diagnosticFlagsJson ?? null,
			input.canvasPlanJson ?? null,
			Math.max(0, Math.trunc(Number(input.assetCount || 0))),
			input.canvasWrite ? 1 : 0,
			typeof input.runMs === "number" && Number.isFinite(input.runMs)
				? Math.max(0, Math.trunc(input.runMs))
				: null,
			input.nowIso,
		],
	);
}

export async function listPublicChatTurnRuns(
	db: PrismaClient,
	input: { userId: string; sessionId: string; limit?: number },
): Promise<PublicChatTurnRunRow[]> {
	await ensurePublicChatSessionSchema(db);
	assertPublicChatDataScope(input.userId, "list_turn_runs");
	const sessionId = String(input.sessionId || "").trim();
	if (!sessionId) return [];
	const limit = Number.isFinite(input.limit)
		? Math.max(1, Math.min(100, Math.trunc(Number(input.limit))))
		: 24;
	return queryAll<PublicChatTurnRunRow>(
		db,
		`SELECT * FROM public_chat_turn_runs
     WHERE session_id = ?
     ORDER BY created_at ASC
     LIMIT ?`,
		[sessionId, limit],
	);
}

export async function listPublicChatTurnRunsByWorkflow(
	db: PrismaClient,
	input: { userId: string; workflowKey: string; limit?: number },
): Promise<PublicChatTurnRunRow[]> {
	await ensurePublicChatSessionSchema(db);
	assertPublicChatDataScope(input.userId, "list_turn_runs_by_workflow");
	const workflowKey = String(input.workflowKey || "").trim().toLowerCase();
	if (!workflowKey) return [];
	const limit = Number.isFinite(input.limit)
		? Math.max(1, Math.min(200, Math.trunc(Number(input.limit))))
		: 50;
	return queryAll<PublicChatTurnRunRow>(
		db,
		`SELECT * FROM public_chat_turn_runs
     WHERE workflow_key = ?
     ORDER BY created_at DESC
     LIMIT ?`,
		[workflowKey, limit],
	);
}

export async function listRecentPublicChatTurnRuns(
	db: PrismaClient,
	input: {
		userId: string;
		projectId?: string;
		label?: string;
		turnVerdict?: PublicChatTurnVerdict;
		runOutcome?: PublicChatRunOutcome;
		sessionKeyPrefix?: string;
		workflowKey?: string;
		limit?: number;
	},
): Promise<PublicChatTurnRunRow[]> {
	await ensurePublicChatSessionSchema(db);
	assertPublicChatDataScope(input.userId, "list_recent_turn_runs");
	const sessionKeyPrefix = input.sessionKeyPrefix
		? normalizePublicChatSessionKey(input.sessionKeyPrefix)
		: "";
	const workflowKey = input.workflowKey ? String(input.workflowKey || "").trim().toLowerCase() : "";
	const limit = Number.isFinite(input.limit)
		? Math.max(1, Math.min(200, Math.trunc(Number(input.limit))))
		: 50;
	const whereParts: string[] = [];
	const params: Array<string | number> = [];
	const projectId = input.projectId ? String(input.projectId || "").trim() : "";
	const label = input.label ? String(input.label || "").trim() : "";
	const turnVerdict = input.turnVerdict ? String(input.turnVerdict || "").trim() : "";
	const runOutcome = input.runOutcome ? String(input.runOutcome || "").trim() : "";
	if (projectId && sessionKeyPrefix) {
		whereParts.push("(project_id = ? OR session_key LIKE ?)");
		params.push(projectId, `${sessionKeyPrefix}%`);
	} else if (projectId) {
		whereParts.push("project_id = ?");
		params.push(projectId);
	} else if (sessionKeyPrefix) {
		whereParts.push("session_key LIKE ?");
		params.push(`${sessionKeyPrefix}%`);
	}
	if (label) {
		whereParts.push("label = ?");
		params.push(label);
	}
	if (turnVerdict) {
		whereParts.push("turn_verdict = ?");
		params.push(turnVerdict);
	}
	if (runOutcome) {
		whereParts.push("run_outcome = ?");
		params.push(runOutcome);
	}
	if (workflowKey) {
		whereParts.push("workflow_key = ?");
		params.push(workflowKey);
	}
	params.push(limit);
	return queryAll<PublicChatTurnRunRow>(
		db,
		`SELECT * FROM public_chat_turn_runs
     ${whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : ""}
     ORDER BY created_at DESC
     LIMIT ?`,
		params,
	);
}
