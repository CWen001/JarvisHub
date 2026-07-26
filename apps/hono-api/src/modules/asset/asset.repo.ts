import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { assertOpenWorkspaceDataScope } from "../auth/open-workspace-data-scope";

export type AssetRow = {
	id: string;
	name: string;
	data: string | null;
	project_id: string | null;
	created_at: string;
	updated_at: string;
};

function jsonStringLiteral(value: string): string {
	return JSON.stringify(value);
}

export async function findGeneratedAssetBySourceUrl(
	db: PrismaClient,
	userId: string,
	sourceUrl: string,
): Promise<AssetRow | null> {
	void db;
	assertOpenWorkspaceDataScope({
		userId,
		resource: "assets",
		operation: "find_generated_by_source_url",
	});
	const trimmed = sourceUrl.trim();
	if (!trimmed) return null;

	const marker = `"sourceUrl":${jsonStringLiteral(trimmed)}`;
	return getPrismaClient().assets.findFirst({
		where: {
			data: {
				contains: `"kind":"generation"`,
			},
			AND: {
				data: {
					contains: marker,
				},
			},
		},
		orderBy: { created_at: "desc" },
	});
}

function buildKindWhereClause(kind: string): object {
	if (kind === "video" || kind === "image") {
		return {
			OR: [
				{ data: { contains: `"kind":${jsonStringLiteral(kind)}` } },
				{ data: { contains: `"type":${jsonStringLiteral(kind)}` } },
			],
		};
	}
	return { data: { contains: `"kind":${jsonStringLiteral(kind)}` } };
}

export async function listAssetsForUser(
	db: PrismaClient,
	userId: string,
	params?: {
		limit?: number;
		cursor?: string | null;
		projectId?: string | null;
		kind?: string | null;
	},
): Promise<AssetRow[]> {
	void db;
	assertOpenWorkspaceDataScope({
		userId,
		resource: "assets",
		operation: "list",
	});
	const rawLimit = params?.limit;
	const normalizedLimit =
		typeof rawLimit === "number" && !Number.isNaN(rawLimit) ? rawLimit : 10;
	const limit = Math.max(1, Math.min(normalizedLimit, 200));
	const cursor = params?.cursor ? String(params.cursor) : null;
	const projectId = params?.projectId ? String(params.projectId) : null;
	const kind = params?.kind ? String(params.kind).trim() : null;

	return getPrismaClient().assets.findMany({
		where: {
			...(projectId ? { project_id: projectId } : {}),
			...(kind ? buildKindWhereClause(kind) : {}),
			...(cursor ? { created_at: { lt: cursor } } : {}),
		},
		orderBy: { created_at: "desc" },
		take: limit,
	});
}

export async function listAssetsForUserByKind(
	db: PrismaClient,
	userId: string,
	input: {
		kind: string;
		projectId?: string | null;
		limit?: number;
	},
): Promise<AssetRow[]> {
	void db;
	assertOpenWorkspaceDataScope({
		userId,
		resource: "assets",
		operation: "list_by_kind",
	});
	const kind = String(input.kind || "").trim();
	if (!kind) return [];
	const rawLimit = input.limit;
	const limit =
		typeof rawLimit === "number" && Number.isFinite(rawLimit)
			? Math.max(1, Math.min(Math.trunc(rawLimit), 5000))
			: 2000;
	const projectId = input.projectId ? String(input.projectId) : null;
	return getPrismaClient().assets.findMany({
		where: {
			...(projectId ? { project_id: projectId } : {}),
			data: {
				contains: `"kind":${jsonStringLiteral(kind)}`,
			},
		},
		orderBy: { created_at: "desc" },
		take: limit,
	});
}

export async function getAssetByIdForUser(
	db: PrismaClient,
	id: string,
	userId: string,
): Promise<AssetRow | null> {
	void db;
	assertOpenWorkspaceDataScope({
		userId,
		resource: "assets",
		operation: "get",
	});
	return getPrismaClient().assets.findFirst({
		where: { id },
	});
}

export async function createAssetRow(
	db: PrismaClient,
	userId: string,
	input: { name: string; data: unknown; projectId?: string | null },
	nowIso: string,
): Promise<AssetRow> {
	void db;
	assertOpenWorkspaceDataScope({
		userId,
		resource: "assets",
		operation: "create",
	});
	const id = crypto.randomUUID();
	await getPrismaClient().assets.create({
		data: {
			id,
			name: input.name,
			data: JSON.stringify(input.data ?? null),
			project_id: input.projectId ?? null,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
	const row = await getAssetByIdForUser(db, id, userId);
	if (!row) {
		throw new Error("asset create failed");
	}
	return row;
}

export async function updateAssetDataRow(
	db: PrismaClient,
	userId: string,
	id: string,
	data: unknown,
	nowIso: string,
): Promise<void> {
	void db;
	assertOpenWorkspaceDataScope({
		userId,
		resource: "assets",
		operation: "update",
	});
	await getPrismaClient().assets.updateMany({
		where: { id },
		data: { data: JSON.stringify(data ?? null), updated_at: nowIso },
	});
}

export async function renameAssetRow(
	db: PrismaClient,
	userId: string,
	id: string,
	name: string,
	nowIso: string,
): Promise<AssetRow> {
	void db;
	assertOpenWorkspaceDataScope({
		userId,
		resource: "assets",
		operation: "rename",
	});
	const existing = await getAssetByIdForUser(db, id, userId);
	if (!existing) {
		throw new Error("asset not found or unauthorized");
	}
	await getPrismaClient().assets.update({
		where: { id },
		data: {
			name,
			updated_at: nowIso,
		},
	});
	const row = await getAssetByIdForUser(db, id, userId);
	if (!row) {
		throw new Error("asset rename failed");
	}
	return row;
}

export async function deleteAssetRow(
	db: PrismaClient,
	userId: string,
	id: string,
): Promise<void> {
	void db;
	assertOpenWorkspaceDataScope({
		userId,
		resource: "assets",
		operation: "delete",
	});
	const existing = await getAssetByIdForUser(db, id, userId);
	if (!existing) {
		throw new Error("asset not found or unauthorized");
	}
	await getPrismaClient().assets.delete({ where: { id } });
}

