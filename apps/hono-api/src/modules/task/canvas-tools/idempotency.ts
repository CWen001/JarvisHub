import type { PrismaClient } from "../../../types";
import { AppError } from "../../../middleware/error";
import { getPrismaClient } from "../../../platform/node/prisma";
import type {
	CanvasToolEffects,
	ToolResultEnvelope,
} from "./types";

export type AgentToolInvocationStatus = "running" | "succeeded" | "failed";

export type AgentToolInvocationRow = {
	id: string;
	principal_key: string;
	idempotency_key: string;
	tool_name: string;
	context_hash: string;
	status: AgentToolInvocationStatus;
	result_json: string | null;
	error_json: string | null;
	created_at: string;
	updated_at: string;
};

export type ToolInvocationDecision =
	| { kind: "execute" }
	| { kind: "cached"; envelope: ToolResultEnvelope };

type ToolInvocationError = {
	code: string;
	message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeStableJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalizeStableJson);
	if (!isRecord(value)) return value;
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		out[key] = normalizeStableJson(value[key]);
	}
	return out;
}

function stableStringify(value: unknown): string {
	return JSON.stringify(normalizeStableJson(value));
}

function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function parseEnvelope(json: string | null): ToolResultEnvelope {
	if (!json) {
		throw new AppError("Cached tool result missing", {
			status: 409,
			code: "tool_invocation_cached_result_missing",
		});
	}
	const parsed = JSON.parse(json) as unknown;
	if (!isRecord(parsed) || parsed.ok !== true || typeof parsed.content !== "string") {
		throw new AppError("Cached tool result invalid", {
			status: 409,
			code: "tool_invocation_cached_result_invalid",
		});
	}
	const data = isRecord(parsed.data) ? parsed.data : undefined;
	const effects = isRecord(parsed.effects) ? parsed.effects : undefined;
	return {
		ok: true,
		content: parsed.content,
		...(data ? { data } : {}),
		...(effects ? { effects } : {}),
	};
}

function parseStoredError(json: string | null): ToolInvocationError {
	if (!json) {
		return {
			code: "tool_invocation_failed_previous",
			message: "Tool invocation failed previously",
		};
	}
	try {
		const parsed = JSON.parse(json) as unknown;
		if (!isRecord(parsed)) throw new Error("invalid");
		const code = typeof parsed.code === "string" && parsed.code.trim()
			? parsed.code.trim()
			: "tool_invocation_failed_previous";
		const message = typeof parsed.message === "string" && parsed.message.trim()
			? parsed.message.trim()
			: "Tool invocation failed previously";
		return { code, message };
	} catch {
		return {
			code: "tool_invocation_failed_previous",
			message: "Tool invocation failed previously",
		};
	}
}

export function requiresToolInvocationIdempotency(effects: CanvasToolEffects): boolean {
	return Boolean(effects.mutatesCanvas || effects.costBearing || effects.longRunning);
}

export async function buildToolInvocationContextHash(input: {
	toolName: string;
	providerKind: string | undefined;
	context: Record<string, unknown>;
	args: Record<string, unknown>;
}): Promise<string> {
	const canonical = stableStringify({
		toolName: input.toolName,
		providerKind: input.providerKind || "remote",
		context: input.context,
		args: input.args,
	});
	const encoded = new TextEncoder().encode(canonical);
	return toHex(await crypto.subtle.digest("SHA-256", encoded));
}

export function decideToolInvocation(input: {
	existing: AgentToolInvocationRow | null;
	contextHash: string;
}): ToolInvocationDecision {
	if (!input.existing) return { kind: "execute" };
	if (input.existing.context_hash !== input.contextHash) {
		throw new AppError("idempotency_key_conflict: idempotency key was reused with different tool context", {
			status: 409,
			code: "idempotency_key_conflict",
		});
	}
	if (input.existing.status === "running") {
		throw new AppError("Tool invocation with this idempotency key is still running", {
			status: 409,
			code: "tool_idempotency_in_progress",
		});
	}
	if (input.existing.status === "failed") {
		const error = parseStoredError(input.existing.error_json);
		throw new AppError(error.message, {
			status: 409,
			code: error.code,
		});
	}
	return { kind: "cached", envelope: parseEnvelope(input.existing.result_json) };
}

export async function findToolInvocationByKey(
	db: PrismaClient,
	input: {
		principalKey: string;
		idempotencyKey: string;
	},
): Promise<AgentToolInvocationRow | null> {
	void db;
	const rows = await getPrismaClient().$queryRaw<AgentToolInvocationRow[]>`
		SELECT id, principal_key, idempotency_key, tool_name, context_hash, status, result_json, error_json, created_at, updated_at
		FROM agent_tool_invocations
		WHERE principal_key = ${input.principalKey}
			AND idempotency_key = ${input.idempotencyKey}
		LIMIT 1
	`;
	return rows[0] ?? null;
}

export async function createRunningToolInvocation(
	db: PrismaClient,
	input: {
		id: string;
		principalKey: string;
		idempotencyKey: string;
		toolName: string;
		contextHash: string;
		nowIso: string;
	},
): Promise<boolean> {
	void db;
	// ON CONFLICT DO NOTHING：并发同 key 时不再抛 23505，而是返回未插入，
	// 由调用方重查后优雅返回"进行中"/缓存结果。
	const inserted = await getPrismaClient().$executeRaw`
		INSERT INTO agent_tool_invocations (
			id,
			principal_key,
			idempotency_key,
			tool_name,
			context_hash,
			status,
			created_at,
			updated_at
		)
		VALUES (
			${input.id},
			${input.principalKey},
			${input.idempotencyKey},
			${input.toolName},
			${input.contextHash},
			'running',
			${input.nowIso},
			${input.nowIso}
		)
		ON CONFLICT (principal_key, idempotency_key) DO NOTHING
	`;
	return inserted > 0;
}

export async function completeToolInvocation(
	db: PrismaClient,
	input: {
		id: string;
		envelope: ToolResultEnvelope;
		nowIso: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().$executeRaw`
		UPDATE agent_tool_invocations
		SET status = 'succeeded',
			result_json = ${JSON.stringify(input.envelope)},
			error_json = NULL,
			updated_at = ${input.nowIso}
		WHERE id = ${input.id}
	`;
}

export async function failToolInvocation(
	db: PrismaClient,
	input: {
		id: string;
		error: unknown;
		nowIso: string;
	},
): Promise<void> {
	void db;
	const error = input.error instanceof AppError
		? { code: input.error.code, message: input.error.message }
		: input.error instanceof Error
			? { code: "tool_invocation_failed", message: input.error.message }
			: { code: "tool_invocation_failed", message: String(input.error || "unknown error") };
	await getPrismaClient().$executeRaw`
		UPDATE agent_tool_invocations
		SET status = 'failed',
			result_json = NULL,
			error_json = ${JSON.stringify(error)},
			updated_at = ${input.nowIso}
		WHERE id = ${input.id}
	`;
}
