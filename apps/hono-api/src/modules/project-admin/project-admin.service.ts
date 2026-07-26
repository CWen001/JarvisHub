import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { isAdminRequest } from "../workspace/admin";
import { getProjectById, updateProjectName } from "../project/project.repo";
import { deleteProjectGraph } from "../project/project-delete";
import type { AdminProjectDto } from "./project-admin.schemas";
import {
	getProjectForAdmin,
	listProjectsForAdmin,
	type AdminProjectRow,
} from "./project-admin.repo";

function sanitizePathSegment(value: string): string {
	return String(value || "")
		.trim()
		.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildProjectDataRoot(projectId: string): string {
	return path.join(process.cwd(), "project-data", sanitizePathSegment(projectId));
}

async function removeProjectDataRootOrThrow(projectId: string): Promise<void> {
	const projectRoot = buildProjectDataRoot(projectId);
	try {
		await fs.rm(projectRoot, { recursive: true, force: true });
	} catch (error) {
		throw new AppError("Failed to delete project local data", {
			status: 500,
			code: "project_local_data_delete_failed",
			details: {
				projectId,
				projectRoot,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
	}
}

function requireAdmin(c: AppContext): void {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
}

function normalizeFlowCount(value: unknown): number {
	const n = typeof value === "number" ? value : Number(value ?? 0);
	return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function mapRowToDto(row: AdminProjectRow): AdminProjectDto {
	return {
			id: String(row.id),
			name: String(row.name || ""),
			ownerId: null,
			owner: null,
			ownerName: null,
		flowCount: normalizeFlowCount(row.flow_count),
		createdAt: String(row.created_at || ""),
		updatedAt: String(row.updated_at || ""),
	};
}

export async function listAdminProjects(
	c: AppContext,
	input: {
		q?: string | null;
		ownerId?: string | null;
		limit?: number;
	},
): Promise<AdminProjectDto[]> {
	requireAdmin(c);
	const rows = await listProjectsForAdmin(c.env.DB, {
		q: input.q,
		ownerId: input.ownerId,
		limit: typeof input.limit === "number" ? input.limit : 200,
	});
	return rows.map(mapRowToDto);
}

export async function updateAdminProject(
	c: AppContext,
	input: {
		projectId: string;
		name?: string;
	},
): Promise<AdminProjectDto> {
	requireAdmin(c);

	const projectId = (input.projectId || "").trim();
	if (!projectId) {
		throw new AppError("projectId is required", {
			status: 400,
			code: "invalid_request",
		});
	}

	const existing = await getProjectById(c.env.DB, projectId);
	if (!existing) {
		throw new AppError("Project not found", {
			status: 404,
			code: "project_not_found",
		});
	}

	const nowIso = new Date().toISOString();

	if (typeof input.name === "string") {
		const nextName = input.name.trim();
		if (!nextName) {
			throw new AppError("name is required", {
				status: 400,
				code: "invalid_request",
			});
		}
		await updateProjectName(c.env.DB, { id: projectId, name: nextName, nowIso });
	}

	const updated = await getProjectForAdmin(c.env.DB, projectId);
	if (!updated) {
		throw new AppError("Project not found", {
			status: 404,
			code: "project_not_found",
		});
	}
	return mapRowToDto(updated);
}

export async function deleteAdminProject(
	c: AppContext,
	input: { projectId: string },
): Promise<void> {
	requireAdmin(c);

	const projectId = (input.projectId || "").trim();
	if (!projectId) {
		throw new AppError("projectId is required", {
			status: 400,
			code: "invalid_request",
		});
	}

	const existing = await getProjectById(c.env.DB, projectId);
	if (!existing) {
		// idempotent
		return;
	}

	await deleteProjectGraph(projectId);
	await removeProjectDataRootOrThrow(projectId);
}
