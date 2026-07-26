import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

export type AdminProjectRow = {
	id: string;
	name: string;
	created_at: string;
	updated_at: string;
	flow_count?: number | null;
};

export async function listProjectsForAdmin(
	db: PrismaClient,
	input: {
		q?: string | null;
		ownerId?: string | null;
		limit: number;
	},
): Promise<AdminProjectRow[]> {
	void db;
	void input.ownerId;
	const q = (input.q || "").trim();
	const rows = await getPrismaClient().projects.findMany({
		where: {
			...(q
				? {
						OR: [
							{ name: { contains: q, mode: "insensitive" } },
							{ id: { contains: q, mode: "insensitive" } },
						],
					}
				: {}),
		},
		orderBy: [{ updated_at: "desc" }, { id: "desc" }],
		take: input.limit,
	});

	const flowCounts = await Promise.all(
		rows.map((row) =>
			getPrismaClient().flows.count({ where: { project_id: row.id } }),
		),
	);
	return rows.map((row, index) => ({
		id: row.id,
		name: row.name,
		created_at: row.created_at,
		updated_at: row.updated_at,
		flow_count: flowCounts[index] ?? 0,
	}));
}

export async function getProjectForAdmin(
	db: PrismaClient,
	projectId: string,
): Promise<AdminProjectRow | null> {
	void db;
	const row = await getPrismaClient().projects.findUnique({
		where: { id: projectId },
	});
	if (!row) return null;
	const flowCount = await getPrismaClient().flows.count({
		where: { project_id: row.id },
	});
	return {
		id: row.id,
		name: row.name,
		created_at: row.created_at,
		updated_at: row.updated_at,
		flow_count: flowCount,
	};
}
