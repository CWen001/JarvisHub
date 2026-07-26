import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../types";
import { execute, executeWithChanges, queryAll, queryOne } from "../../db/db";
import { assertOpenWorkspaceDataScope } from "../auth/open-workspace-data-scope";

export type DreaminaAccountRow = {
	id: string;
	label: string;
	cli_path: string | null;
	session_root: string;
	enabled: number;
	last_healthcheck_at: string | null;
	last_login_at: string | null;
	last_error: string | null;
	meta_json: string | null;
	created_at: string;
	updated_at: string;
};

export type DreaminaProjectBindingRow = {
	id: string;
	project_id: string;
	account_id: string;
	enabled: number;
	default_model_version: string | null;
	default_ratio: string | null;
	default_resolution_type: string | null;
	default_video_resolution: string | null;
	created_at: string;
	updated_at: string;
};

let schemaEnsured = false;

export async function ensureDreaminaSchema(db: PrismaClient): Promise<void> {
	if (schemaEnsured) return;

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS dreamina_accounts (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      cli_path TEXT,
      session_root TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_healthcheck_at TEXT,
      last_login_at TEXT,
      last_error TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_dreamina_accounts_updated
     ON dreamina_accounts(updated_at DESC)`,
	);

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS dreamina_project_bindings (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      default_model_version TEXT,
      default_ratio TEXT,
      default_resolution_type TEXT,
      default_video_resolution TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (account_id) REFERENCES dreamina_accounts(id)
    )`,
	);
	await execute(
		db,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_dreamina_project_bindings_project
     ON dreamina_project_bindings(project_id)`,
	);

	schemaEnsured = true;
}

export async function listDreaminaAccountsByOwner(
	db: PrismaClient,
	ownerId: string,
): Promise<DreaminaAccountRow[]> {
	assertOpenWorkspaceDataScope({
		userId: ownerId,
		resource: "dreamina_accounts",
		operation: "list",
	});
	await ensureDreaminaSchema(db);
	return await queryAll<DreaminaAccountRow>(
		db,
		`SELECT id, label, cli_path, session_root, enabled, last_healthcheck_at, last_login_at, last_error, meta_json, created_at, updated_at
     FROM dreamina_accounts
     ORDER BY updated_at DESC, created_at DESC`,
	);
}

export async function getDreaminaAccountByIdForOwner(
	db: PrismaClient,
	id: string,
	ownerId: string,
): Promise<DreaminaAccountRow | null> {
	assertOpenWorkspaceDataScope({
		userId: ownerId,
		resource: "dreamina_accounts",
		operation: "get",
	});
	await ensureDreaminaSchema(db);
	return await queryOne<DreaminaAccountRow>(
		db,
		`SELECT id, label, cli_path, session_root, enabled, last_healthcheck_at, last_login_at, last_error, meta_json, created_at, updated_at
     FROM dreamina_accounts
     WHERE id = ?
     LIMIT 1`,
		[id],
	);
}

export async function upsertDreaminaAccountRow(
	db: PrismaClient,
	input: {
		id?: string;
		ownerId: string;
		label: string;
		cliPath: string | null;
		sessionRoot: string;
		enabled: boolean;
		metaJson: string | null;
		nowIso: string;
	},
): Promise<DreaminaAccountRow> {
	assertOpenWorkspaceDataScope({
		userId: input.ownerId,
		resource: "dreamina_accounts",
		operation: "upsert",
	});
	await ensureDreaminaSchema(db);
	const id = (input.id || "").trim() || randomUUID();
	const existing = await getDreaminaAccountByIdForOwner(db, id, input.ownerId);
	if (existing) {
		await execute(
			db,
			`UPDATE dreamina_accounts
       SET label = ?, cli_path = ?, session_root = ?, enabled = ?, meta_json = ?, updated_at = ?
       WHERE id = ?`,
			[
				input.label,
				input.cliPath,
				input.sessionRoot,
				input.enabled ? 1 : 0,
				input.metaJson,
				input.nowIso,
				id,
			],
		);
	} else {
		await execute(
			db,
			`INSERT INTO dreamina_accounts (
         id, label, cli_path, session_root, enabled, meta_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				input.label,
				input.cliPath,
				input.sessionRoot,
				input.enabled ? 1 : 0,
				input.metaJson,
				input.nowIso,
				input.nowIso,
			],
		);
	}
	const row = await getDreaminaAccountByIdForOwner(db, id, input.ownerId);
	if (!row) throw new Error("dreamina account upsert failed");
	return row;
}

export async function updateDreaminaAccountProbeRow(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		lastHealthcheckAt: string;
		lastLoginAt?: string | null;
		lastError?: string | null;
	},
): Promise<void> {
	assertOpenWorkspaceDataScope({
		userId: input.ownerId,
		resource: "dreamina_accounts",
		operation: "update_probe",
	});
	await ensureDreaminaSchema(db);
	await execute(
		db,
		`UPDATE dreamina_accounts
     SET last_healthcheck_at = ?, last_login_at = ?, last_error = ?, updated_at = ?
     WHERE id = ?`,
		[
			input.lastHealthcheckAt,
			input.lastLoginAt ?? null,
			input.lastError ?? null,
			input.lastHealthcheckAt,
			input.id,
		],
	);
}

export async function deleteDreaminaAccountForOwner(
	db: PrismaClient,
	id: string,
	ownerId: string,
): Promise<void> {
	assertOpenWorkspaceDataScope({
		userId: ownerId,
		resource: "dreamina_accounts",
		operation: "delete",
	});
	await ensureDreaminaSchema(db);
	await execute(db, `DELETE FROM dreamina_project_bindings WHERE account_id = ?`, [
		id,
	]);
	await execute(db, `DELETE FROM dreamina_accounts WHERE id = ?`, [id]);
}

export async function getDreaminaProjectBindingForOwner(
	db: PrismaClient,
	projectId: string,
	ownerId: string,
): Promise<DreaminaProjectBindingRow | null> {
	assertOpenWorkspaceDataScope({
		userId: ownerId,
		resource: "dreamina_project_bindings",
		operation: "get",
	});
	await ensureDreaminaSchema(db);
	return await queryOne<DreaminaProjectBindingRow>(
		db,
		`SELECT id, project_id, account_id, enabled, default_model_version, default_ratio, default_resolution_type, default_video_resolution, created_at, updated_at
     FROM dreamina_project_bindings
     WHERE project_id = ?
     LIMIT 1`,
		[projectId],
	);
}

export async function upsertDreaminaProjectBindingRow(
	db: PrismaClient,
	input: {
		projectId: string;
		ownerId: string;
		accountId: string;
		enabled: boolean;
		defaultModelVersion: string | null;
		defaultRatio: string | null;
		defaultResolutionType: string | null;
		defaultVideoResolution: string | null;
		nowIso: string;
	},
): Promise<DreaminaProjectBindingRow> {
	assertOpenWorkspaceDataScope({
		userId: input.ownerId,
		resource: "dreamina_project_bindings",
		operation: "upsert",
	});
	await ensureDreaminaSchema(db);
	const existing = await getDreaminaProjectBindingForOwner(
		db,
		input.projectId,
		input.ownerId,
	);
	if (existing) {
		await execute(
			db,
			`UPDATE dreamina_project_bindings
       SET account_id = ?, enabled = ?, default_model_version = ?, default_ratio = ?, default_resolution_type = ?, default_video_resolution = ?, updated_at = ?
       WHERE project_id = ?`,
			[
				input.accountId,
				input.enabled ? 1 : 0,
				input.defaultModelVersion,
				input.defaultRatio,
				input.defaultResolutionType,
				input.defaultVideoResolution,
				input.nowIso,
				input.projectId,
			],
		);
	} else {
		await execute(
			db,
			`INSERT INTO dreamina_project_bindings (
         id, project_id, account_id, enabled, default_model_version, default_ratio, default_resolution_type, default_video_resolution, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				randomUUID(),
				input.projectId,
				input.accountId,
				input.enabled ? 1 : 0,
				input.defaultModelVersion,
				input.defaultRatio,
				input.defaultResolutionType,
				input.defaultVideoResolution,
				input.nowIso,
				input.nowIso,
			],
		);
	}
	const row = await getDreaminaProjectBindingForOwner(
		db,
		input.projectId,
		input.ownerId,
	);
	if (!row) throw new Error("dreamina project binding upsert failed");
	return row;
}

export async function deleteDreaminaProjectBindingForOwner(
	db: PrismaClient,
	projectId: string,
	ownerId: string,
): Promise<number> {
	assertOpenWorkspaceDataScope({
		userId: ownerId,
		resource: "dreamina_project_bindings",
		operation: "delete",
	});
	await ensureDreaminaSchema(db);
	return await executeWithChanges(
		db,
		`DELETE FROM dreamina_project_bindings WHERE project_id = ?`,
		[projectId],
	);
}
