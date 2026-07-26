import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import type { FlowRow, FlowVersionReason } from "../flow/flow.repo";

export type WebHeroCodeCanonicalField = "webHeroHtml" | "webHeroCss";

export type WebHeroCodeStageFields = Partial<
	Record<
		WebHeroCodeCanonicalField,
		{
			total: number;
			chunks: Record<string, string>;
		}
	>
>;

type WebHeroCodeStageSessionBase = {
	flowId: string;
	nodeId: string;
	sessionId: string;
	flowUpdatedAt: string;
	previewNodeIds: string[];
	codeInputDigest: string;
	version: number;
	createdAt: string;
	updatedAt: string;
	fields: WebHeroCodeStageFields;
};

export type WebHeroCodeStageStaging = WebHeroCodeStageSessionBase & {
	status: "staging";
};

export type WebHeroCodeStageCommitting = WebHeroCodeStageSessionBase & {
	status: "committing";
	committedAt: string;
};

export type WebHeroCodeStageCommitted = WebHeroCodeStageSessionBase & {
	status: "committed";
	committedAt: string;
};

export type WebHeroCodeStageSession =
	| WebHeroCodeStageStaging
	| WebHeroCodeStageCommitting
	| WebHeroCodeStageCommitted;

type WebHeroCodeStageSessionRow = {
	id: string;
	flow_id: string;
	node_id: string;
	session_id: string;
	flow_updated_at: string;
	preview_node_ids_json: string;
	code_input_digest: string;
	status: string;
	fields_json: string;
	version: number;
	created_at: string;
	updated_at: string;
	committed_at: string | null;
};

function storageError(message: string, details?: unknown): AppError {
	return new AppError(message, {
		status: 500,
		code: "webhero_code_stage_storage_invalid",
		details,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseFields(value: string): WebHeroCodeStageFields {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw storageError("Stored webHero code stage fields are not valid JSON");
	}
	if (!isRecord(parsed)) {
		throw storageError("Stored webHero code stage fields must be an object");
	}
	const fields: WebHeroCodeStageFields = {};
	for (const field of ["webHeroHtml", "webHeroCss"] as const) {
		const candidate = parsed[field];
		if (typeof candidate === "undefined") continue;
		if (!isRecord(candidate) || !Number.isInteger(candidate.total) || Number(candidate.total) < 1) {
			throw storageError("Stored webHero code stage field is invalid", { field });
		}
		if (!isRecord(candidate.chunks)) {
			throw storageError("Stored webHero code stage chunks are invalid", { field });
		}
		const chunks: Record<string, string> = {};
		for (const [index, chunk] of Object.entries(candidate.chunks)) {
			if (!/^\d+$/.test(index) || typeof chunk !== "string") {
				throw storageError("Stored webHero code stage chunk is invalid", { field, index });
			}
			chunks[index] = chunk;
		}
		fields[field] = { total: Number(candidate.total), chunks };
	}
	return fields;
}

function parsePreviewNodeIds(value: string): string[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw storageError("Stored webHero readiness preview node IDs are not valid JSON");
	}
	if (!Array.isArray(parsed)) {
		throw storageError("Stored webHero readiness preview node IDs must be an array");
	}
	const ids = parsed.map((item) => typeof item === "string" ? item.trim() : "");
	if (
		ids.length < 1
		|| ids.length > 4
		|| ids.some((item) => !item)
		|| new Set(ids).size !== ids.length
	) {
		throw storageError("Stored webHero readiness preview node IDs are invalid");
	}
	return ids.slice().sort();
}

function mapRow(row: WebHeroCodeStageSessionRow): WebHeroCodeStageSession {
	if (!row.flow_updated_at.trim()) {
		throw storageError("Stored webHero readiness flow revision is missing");
	}
	if (!/^sha256:[a-f0-9]{64}$/.test(row.code_input_digest)) {
		throw storageError("Stored webHero code input digest is invalid");
	}
	const base: WebHeroCodeStageSessionBase = {
		flowId: row.flow_id,
		nodeId: row.node_id,
		sessionId: row.session_id,
		flowUpdatedAt: row.flow_updated_at,
		previewNodeIds: parsePreviewNodeIds(row.preview_node_ids_json),
		codeInputDigest: row.code_input_digest,
		version: row.version,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		fields: parseFields(row.fields_json),
	};
	if (row.status === "staging") return { ...base, status: "staging" };
	if ((row.status === "committing" || row.status === "committed") && row.committed_at) {
		return { ...base, status: row.status, committedAt: row.committed_at };
	}
	throw storageError("Stored webHero code stage status is invalid", {
		status: row.status,
		committedAt: row.committed_at,
	});
}

export async function findWebHeroCodeStageSession(
	db: PrismaClient,
	input: { flowId: string; nodeId: string; sessionId: string },
): Promise<WebHeroCodeStageSession | null> {
	void db;
	const rows = await getPrismaClient().$queryRaw<WebHeroCodeStageSessionRow[]>`
		SELECT id, flow_id, node_id, session_id, flow_updated_at, preview_node_ids_json, code_input_digest, status, fields_json, version, created_at, updated_at, committed_at
		FROM webhero_code_stage_sessions
		WHERE flow_id = ${input.flowId}
			AND node_id = ${input.nodeId}
			AND session_id = ${input.sessionId}
		LIMIT 1
	`;
	return rows[0] ? mapRow(rows[0]) : null;
}

export async function saveWebHeroCodeStageSession(
	db: PrismaClient,
	input: {
		session: WebHeroCodeStageStaging;
		expectedVersion: number | null;
	},
): Promise<WebHeroCodeStageSession> {
	void db;
	const prisma = getPrismaClient();
	const { session, expectedVersion } = input;
	const committedAt = null;
	let written = 0;
	if (expectedVersion === null) {
		written = await prisma.$executeRaw`
			INSERT INTO webhero_code_stage_sessions (
				id, flow_id, node_id, session_id, flow_updated_at, preview_node_ids_json, code_input_digest,
				status, fields_json, version, created_at, updated_at, committed_at
			)
			VALUES (
				${crypto.randomUUID()}, ${session.flowId}, ${session.nodeId}, ${session.sessionId},
				${session.flowUpdatedAt}, ${JSON.stringify(session.previewNodeIds)}, ${session.codeInputDigest}, ${session.status},
				${JSON.stringify(session.fields)}, 1, ${session.createdAt}, ${session.updatedAt}, ${committedAt}
			)
			ON CONFLICT (flow_id, node_id, session_id) DO NOTHING
		`;
	} else {
		written = await prisma.$executeRaw`
			UPDATE webhero_code_stage_sessions
			SET status = ${session.status},
				fields_json = ${JSON.stringify(session.fields)},
				version = version + 1,
				updated_at = ${session.updatedAt},
				committed_at = ${committedAt}
			WHERE flow_id = ${session.flowId}
				AND node_id = ${session.nodeId}
				AND session_id = ${session.sessionId}
				AND version = ${expectedVersion}
		`;
	}
	if (written !== 1) {
		throw new AppError("webHero code stage session changed concurrently", {
			status: 409,
			code: "webhero_code_stage_version_conflict",
			details: {
				flowId: session.flowId,
				nodeId: session.nodeId,
				sessionId: session.sessionId,
				expectedVersion,
			},
		});
	}
	return { ...session, version: expectedVersion === null ? 1 : expectedVersion + 1 };
}

export async function deleteExpiredWebHeroCodeStageSessions(
	db: PrismaClient,
	input: {
		beforeIso: string;
		excludeIdentity: { flowId: string; nodeId: string; sessionId: string };
	},
): Promise<number> {
	void db;
	return getPrismaClient().$executeRaw`
		DELETE FROM webhero_code_stage_sessions
		WHERE status = 'staging'
			AND updated_at < ${input.beforeIso}
			AND NOT (
				flow_id = ${input.excludeIdentity.flowId}
				AND node_id = ${input.excludeIdentity.nodeId}
				AND session_id = ${input.excludeIdentity.sessionId}
			)
	`;
}

export async function commitWebHeroFlowAndStageSession(
	db: PrismaClient,
	input: {
		session: WebHeroCodeStageCommitted;
		expectedVersion: number;
		flow: {
			id: string;
			name: string;
			data: string;
			projectId: string | null;
			baseUpdatedAt: string;
			nowIso: string;
		};
		version: {
			id: string;
			reason: FlowVersionReason;
			label: string | null;
		};
	},
): Promise<{ session: WebHeroCodeStageCommitted; flow: FlowRow | null }> {
	void db;
	const { session, expectedVersion, flow, version } = input;
	return getPrismaClient().$transaction(async (tx) => {
		const written = await tx.$executeRaw`
			UPDATE webhero_code_stage_sessions
			SET status = 'committed',
				fields_json = ${JSON.stringify(session.fields)},
				version = version + 1,
				updated_at = ${session.updatedAt},
				committed_at = ${session.committedAt}
			WHERE flow_id = ${session.flowId}
				AND node_id = ${session.nodeId}
				AND session_id = ${session.sessionId}
				AND status = 'staging'
				AND version = ${expectedVersion}
		`;
		if (written !== 1) {
			throw new AppError("webHero code stage session changed before flow commit", {
				status: 409,
				code: "webhero_code_stage_version_conflict",
				details: {
					flowId: session.flowId,
					nodeId: session.nodeId,
					sessionId: session.sessionId,
					expectedVersion,
				},
			});
		}
		const updated = await tx.flows.updateMany({
			where: { id: flow.id, updated_at: flow.baseUpdatedAt },
			data: {
				name: flow.name,
				data: flow.data,
				project_id: flow.projectId,
				updated_at: flow.nowIso,
			},
		});
		if (updated.count !== 1) {
			throw new AppError("Flow changed concurrently before webHero code commit", {
				status: 409,
				code: "webhero_flow_write_conflict",
				details: {
					flowId: flow.id,
					expectedUpdatedAt: flow.baseUpdatedAt,
				},
			});
		}
		const row = await tx.flows.findUnique({ where: { id: flow.id } });
		if (!row) {
			throw storageError("Committed webHero flow row could not be loaded", { flowId: flow.id });
		}
		await tx.flow_versions.create({
			data: {
				id: version.id,
				flow_id: row.id,
				name: row.name,
				data: row.data,
				reason: version.reason,
				label: version.label,
				created_at: flow.nowIso,
			},
		});
		return {
			session: { ...session, version: expectedVersion + 1 },
			flow: row as FlowRow,
		};
	});
}
