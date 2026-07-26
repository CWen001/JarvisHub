import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { assertOpenWorkspaceDataScope } from "../auth/open-workspace-data-scope";
import { deleteProjectGraph } from "./project-delete";

export type ProjectRow = {
	id: string;
	name: string;
	created_at: string;
	updated_at: string;
};

function mapProjectRow(
	row: {
		id: string;
		name: string;
		created_at: string;
		updated_at: string;
	},
): ProjectRow {
	return {
		id: row.id,
		name: row.name,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

export async function listProjectsByOwner(
	db: PrismaClient,
	ownerId: string,
): Promise<ProjectRow[]> {
	void db;
	assertOpenWorkspaceDataScope({
		userId: ownerId,
		resource: "projects",
		operation: "list",
	});
	const projects = await getPrismaClient().projects.findMany({
		orderBy: { updated_at: "desc" },
	});
	return projects.map((row) => mapProjectRow(row));
}

export async function getProjectById(
	db: PrismaClient,
	projectId: string,
): Promise<ProjectRow | null> {
	void db;
	const row = await getPrismaClient().projects.findUnique({
		where: { id: projectId },
	});
	if (!row) return null;
	return mapProjectRow(row);
}

export async function getProjectForOwner(
	db: PrismaClient,
	projectId: string,
	ownerId: string,
): Promise<ProjectRow | null> {
	void db;
	assertOpenWorkspaceDataScope({
		userId: ownerId,
		resource: "projects",
		operation: "get",
	});
	return getProjectById(db, projectId);
}

export async function findLatestProjectForOwnerByNamePrefix(
	db: PrismaClient,
	input: {
		ownerId: string;
		namePrefix: string;
		excludeProjectId?: string;
	},
): Promise<ProjectRow | null> {
	void db;
	assertOpenWorkspaceDataScope({
		userId: input.ownerId,
		resource: "projects",
		operation: "find_latest_by_name_prefix",
	});
	const row = await getPrismaClient().projects.findFirst({
		where: {
			name: { startsWith: input.namePrefix },
			...(input.excludeProjectId
				? { id: { not: input.excludeProjectId } }
				: {}),
		},
		orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
	});
	if (!row) return null;
	return mapProjectRow(row);
}

export async function createProject(
	db: PrismaClient,
	params: { id: string; name: string; ownerId: string; nowIso: string },
): Promise<ProjectRow> {
	void db;
	assertOpenWorkspaceDataScope({
		userId: params.ownerId,
		resource: "projects",
		operation: "create",
	});
	const { id, name, nowIso } = params;
	await getPrismaClient().projects.create({
		data: {
			id,
			name,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
	const row = await getProjectById(db, id);
	if (!row) {
		throw new Error("Failed to load created project");
	}
	return row;
}

export async function updateProjectName(
	db: PrismaClient,
	params: { id: string; name: string; nowIso: string },
): Promise<ProjectRow | null> {
	void db;
	await getPrismaClient().projects.update({
		where: { id: params.id },
		data: { name: params.name, updated_at: params.nowIso },
	});
	return getProjectById(db, params.id);
}

export async function deleteProjectById(
	db: PrismaClient,
	projectId: string,
): Promise<void> {
	void db;
	await deleteProjectGraph(projectId);
}
