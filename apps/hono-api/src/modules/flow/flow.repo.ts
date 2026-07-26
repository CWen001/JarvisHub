import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { assertOpenWorkspaceDataScope } from "../auth/open-workspace-data-scope";
import type { FlowDto } from "./flow.schemas";

export type FlowRow = {
	id: string;
	name: string;
	data: string;
	project_id: string | null;
	created_at: string;
	updated_at: string;
};

export type FlowVersionRow = {
	id: string;
	flow_id: string;
	name: string;
	data: string;
	reason: string;
	label: string | null;
	created_at: string;
};

export type FlowVersionReason =
	| "manual_save"
	| "agent_turn"
	| "agent_explicit"
	| "rollback"
	| "execution"
	| "internal_cleanup"
	| "legacy";

export const ALL_FLOW_VERSION_REASONS: readonly FlowVersionReason[] = [
	"manual_save",
	"agent_turn",
	"agent_explicit",
	"rollback",
	"execution",
	"internal_cleanup",
	"legacy",
];

export type FlowVersionAudience = "user" | "agent";

const HIDDEN_FROM_USER_REASONS: ReadonlySet<FlowVersionReason> = new Set([
	"agent_turn",
	"internal_cleanup",
]);

const HIDDEN_FROM_AGENT_REASONS: ReadonlySet<FlowVersionReason> = new Set([
	"internal_cleanup",
]);

function visibleReasonsFor(audience: FlowVersionAudience): FlowVersionReason[] {
	const blacklist =
		audience === "user" ? HIDDEN_FROM_USER_REASONS : HIDDEN_FROM_AGENT_REASONS;
	return ALL_FLOW_VERSION_REASONS.filter((r) => !blacklist.has(r));
}

function parseFlowData(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function readFlowScopeMeta(value: unknown): {
	scopeType: "project" | "chapter" | "shot" | null;
	scopeId: string | null;
} {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { scopeType: null, scopeId: null };
	}
	const record = value as Record<string, unknown>;
	const meta = record.__canvasFlowScope;
	if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
		return { scopeType: null, scopeId: null };
	}
	const scopeRecord = meta as Record<string, unknown>;
	const scopeType =
		scopeRecord.scopeType === "project" || scopeRecord.scopeType === "chapter" || scopeRecord.scopeType === "shot"
			? scopeRecord.scopeType
			: null;
	const scopeId =
		typeof scopeRecord.scopeId === "string" && scopeRecord.scopeId.trim()
			? scopeRecord.scopeId.trim()
			: null;
	return { scopeType, scopeId };
}

export function mapFlowRowToDto(row: FlowRow): FlowDto {
	const data = parseFlowData(row.data);
	const scopeMeta = readFlowScopeMeta(data);
	return {
		id: row.id,
		name: row.name,
		data,
		scopeType: scopeMeta.scopeType,
		scopeId: scopeMeta.scopeId,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function listFlowsByOwner(
	db: PrismaClient,
	ownerId: string,
	projectId?: string,
): Promise<FlowRow[]> {
	void db;
	assertOpenWorkspaceDataScope({
		userId: ownerId,
		resource: "flows",
		operation: "list",
	});
	return getPrismaClient().flows.findMany({
		where: {
			...(projectId ? { project_id: projectId } : {}),
		},
		orderBy: { updated_at: "desc" },
	});
}

export async function listFlowsByProject(
	db: PrismaClient,
	projectId: string,
): Promise<FlowRow[]> {
	void db;
	return getPrismaClient().flows.findMany({
		where: { project_id: projectId },
		orderBy: { updated_at: "desc" },
	});
}

export async function getFlowForOwner(
	db: PrismaClient,
	id: string,
	ownerId: string,
): Promise<FlowRow | null> {
	void db;
	assertOpenWorkspaceDataScope({
		userId: ownerId,
		resource: "flows",
		operation: "get",
	});
	return getPrismaClient().flows.findFirst({
		where: { id },
	});
}

export async function getFlowByIdUnsafe(
	db: PrismaClient,
	id: string,
): Promise<FlowRow | null> {
	void db;
	return getPrismaClient().flows.findFirst({
		where: { id },
	});
}

export async function createFlow(
	db: PrismaClient,
	params: {
		id: string;
		name: string;
		data: string;
		ownerId: string;
		projectId?: string | null;
		nowIso: string;
	},
): Promise<FlowRow> {
	void db;
	assertOpenWorkspaceDataScope({
		userId: params.ownerId,
		resource: "flows",
		operation: "create",
	});
	const { id, name, data, projectId, nowIso } = params;
	await getPrismaClient().flows.create({
		data: {
			id,
			name,
			data,
			project_id: projectId ?? null,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
	const row = await getFlowByIdUnsafe(db, id);
	if (!row) {
		throw new Error("Failed to load created flow");
	}
	return row;
}

export async function updateFlow(
	db: PrismaClient,
	params: {
		id: string;
		name: string;
		data: string;
		ownerId: string;
		projectId?: string | null;
		nowIso: string;
	},
): Promise<FlowRow | null> {
	void db;
	assertOpenWorkspaceDataScope({
		userId: params.ownerId,
		resource: "flows",
		operation: "update",
	});
	const { id, name, data, projectId, nowIso } = params;
	await getPrismaClient().flows.updateMany({
		where: { id },
		data: {
			name,
			data,
			project_id: projectId ?? null,
			updated_at: nowIso,
		},
	});
	return getFlowByIdUnsafe(db, id);
}

export async function updateFlowIfUpdatedAtMatches(
	db: PrismaClient,
	params: {
		id: string;
		name: string;
		data: string;
		ownerId: string;
		projectId?: string | null;
		baseUpdatedAt: string;
		nowIso: string;
	},
): Promise<FlowRow | null> {
	void db;
	assertOpenWorkspaceDataScope({
		userId: params.ownerId,
		resource: "flows",
		operation: "update_if_current",
	});
	const { id, name, data, projectId, baseUpdatedAt, nowIso } = params;
	const result = await getPrismaClient().flows.updateMany({
		where: { id, updated_at: baseUpdatedAt },
		data: {
			name,
			data,
			project_id: projectId ?? null,
			updated_at: nowIso,
		},
	});
	if (result.count !== 1) return null;
	return getFlowByIdUnsafe(db, id);
}

export async function updateFlowByIdUnsafe(
	db: PrismaClient,
	params: {
		id: string;
		name: string;
		data: string;
		nowIso: string;
	},
): Promise<FlowRow | null> {
	void db;
	const { id, name, data, nowIso } = params;
	await getPrismaClient().flows.updateMany({
		where: { id },
		data: {
			name,
			data,
			updated_at: nowIso,
		},
	});
	return getFlowByIdUnsafe(db, id);
}

export async function updateFlowByIdUnsafeIfUpdatedAtMatches(
	db: PrismaClient,
	params: {
		id: string;
		name: string;
		data: string;
		baseUpdatedAt: string;
		nowIso: string;
	},
): Promise<FlowRow | null> {
	void db;
	const { id, name, data, baseUpdatedAt, nowIso } = params;
	const result = await getPrismaClient().flows.updateMany({
		where: { id, updated_at: baseUpdatedAt },
		data: {
			name,
			data,
			updated_at: nowIso,
		},
	});
	if (result.count !== 1) return null;
	return getFlowByIdUnsafe(db, id);
}

export async function deleteFlowById(
	db: PrismaClient,
	id: string,
	ownerId: string,
): Promise<void> {
	void db;
	assertOpenWorkspaceDataScope({
		userId: ownerId,
		resource: "flows",
		operation: "delete",
	});
	const prisma = getPrismaClient();
	await prisma.$transaction([
		prisma.flow_versions.deleteMany({ where: { flow_id: id } }),
		prisma.flows.deleteMany({ where: { id } }),
	]);
}

export async function createFlowVersion(
	db: PrismaClient,
	params: {
		id: string;
		flowId: string;
		name: string;
		data: string;
		userId: string;
		nowIso: string;
		reason: FlowVersionReason;
		label: string | null;
	},
): Promise<void> {
	void db;
	assertOpenWorkspaceDataScope({
		userId: params.userId,
		resource: "flow_versions",
		operation: "create",
	});
	const { id, flowId, name, data, nowIso, reason, label } = params;
	await getPrismaClient().flow_versions.create({
		data: {
			id,
			flow_id: flowId,
			name,
			data,
			reason,
			label,
			created_at: nowIso,
		},
	});
}

export async function listFlowVersions(
	db: PrismaClient,
	flowId: string,
	opts: {
		audience: FlowVersionAudience;
		reasons?: FlowVersionReason[];
	},
): Promise<FlowVersionRow[]> {
	void db;
	const reasonsIn = opts.reasons && opts.reasons.length > 0
		? opts.reasons
		: visibleReasonsFor(opts.audience);
	const rows = await getPrismaClient().flow_versions.findMany({
		where: { flow_id: flowId, reason: { in: reasonsIn } },
		orderBy: { created_at: "desc" },
	});
	return rows.map(mapFlowVersionRow);
}

export async function getFlowVersion(
	db: PrismaClient,
	versionId: string,
	flowId: string,
	userId: string,
): Promise<FlowVersionRow | null> {
	void db;
	assertOpenWorkspaceDataScope({
		userId,
		resource: "flow_versions",
		operation: "read",
	});
	const row = await getPrismaClient().flow_versions.findFirst({
		where: { id: versionId, flow_id: flowId },
	});
	return row ? mapFlowVersionRow(row) : null;
}

function mapFlowVersionRow(row: {
	id: string;
	flow_id: string;
	name: string;
	data: string;
	reason: string;
	label: string | null;
	created_at: string;
}): FlowVersionRow {
	return {
		id: row.id,
		flow_id: row.flow_id,
		name: row.name,
		data: row.data,
		reason: row.reason,
		label: row.label,
		created_at: row.created_at,
	};
}
