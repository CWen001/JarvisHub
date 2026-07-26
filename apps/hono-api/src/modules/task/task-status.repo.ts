import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { assertOpenWorkspaceDataScope } from "../auth/open-workspace-data-scope";

export type TaskStatusRow = {
	id: string;
	task_id: string;
	provider: string;
	status: string;
	data: string | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
};

let schemaEnsured = false;

export async function ensureTaskStatusesSchema(db: PrismaClient): Promise<void> {
	void db;
	if (schemaEnsured) return;
	// DDL is handled by startup schema bootstrap for Postgres.
	schemaEnsured = true;
}

export async function upsertTaskStatus(
	db: PrismaClient,
	input: {
		taskId: string;
		provider: string;
		userId?: string | null;
		status: string;
		data?: unknown;
		completedAt?: string | null;
		nowIso: string;
	},
): Promise<void> {
	await ensureTaskStatusesSchema(db);
	const taskId = (input.taskId || "").trim();
	const provider = (input.provider || "").trim();
	if (input.userId) {
		assertOpenWorkspaceDataScope({
			userId: input.userId,
			resource: "task_statuses",
			operation: "upsert",
		});
	}
	if (!taskId || !provider) return;

	const data =
		typeof input.data === "undefined" ? null : JSON.stringify(input.data ?? null);

	const prisma = getPrismaClient();
	const existing = await prisma.task_statuses.findUnique({
		where: {
			task_id_provider: { task_id: taskId, provider },
		},
		select: { completed_at: true },
	});
	await prisma.task_statuses.upsert({
		where: {
			task_id_provider: { task_id: taskId, provider },
		},
		create: {
			id: crypto.randomUUID(),
			task_id: taskId,
			provider,
			status: input.status,
			data,
			created_at: input.nowIso,
			updated_at: input.nowIso,
			completed_at: input.completedAt ?? null,
		},
		update: {
			status: input.status,
			data,
			updated_at: input.nowIso,
			completed_at: input.completedAt ?? existing?.completed_at ?? null,
		},
	});
}
