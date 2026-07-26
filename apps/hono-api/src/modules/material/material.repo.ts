import { execute, queryAll, queryOne } from "../../db/db";
import type { PrismaClient } from "../../types";
import { assertOpenWorkspaceDataScope } from "../auth/open-workspace-data-scope";
import type {
	MaterialAssetDto,
	MaterialAssetVersionDto,
	MaterialImpactResponseDto,
	MaterialShotRefDto,
} from "./material.schemas";

type MaterialAssetRow = {
	id: string;
	project_id: string;
	kind: string;
	name: string;
	current_version: number;
	created_at: string;
	updated_at: string;
};

type MaterialVersionRow = {
	id: string;
	asset_id: string;
	project_id: string;
	version: number;
	data_json: string;
	note: string | null;
	created_at: string;
};

type ShotMaterialRefRow = {
	id: string;
	project_id: string;
	shot_id: string;
	asset_id: string;
	asset_version: number;
	created_at: string;
	updated_at: string;
};

type D1Database = PrismaClient;

let materialSchemaEnsured = false;

function toMaterialAssetDto(row: MaterialAssetRow): MaterialAssetDto {
	const kind = row.kind;
	return {
		id: row.id,
		projectId: row.project_id,
		kind:
			kind === "character" || kind === "scene" || kind === "prop" || kind === "style"
				? kind
				: "prop",
		name: row.name,
		currentVersion: Math.max(1, Math.trunc(Number(row.current_version || 1))),
		latestVersion: null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function toVersionDto(row: MaterialVersionRow): MaterialAssetVersionDto {
	let data: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(row.data_json);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			data = parsed as Record<string, unknown>;
		}
	} catch {
		data = {};
	}
	return {
		id: row.id,
		assetId: row.asset_id,
		projectId: row.project_id,
		version: Math.max(1, Math.trunc(Number(row.version || 1))),
		data,
		note: row.note,
		createdAt: row.created_at,
	};
}

function toShotRefDto(row: ShotMaterialRefRow): MaterialShotRefDto {
	return {
		id: row.id,
		projectId: row.project_id,
		shotId: row.shot_id,
		assetId: row.asset_id,
		assetVersion: Math.max(1, Math.trunc(Number(row.asset_version || 1))),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function ensureMaterialSchema(db: PrismaClient): Promise<void> {
	if (materialSchemaEnsured) return;
	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS material_assets (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			name TEXT NOT NULL,
			current_version INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_material_assets_project
		 ON material_assets(project_id, kind, updated_at DESC)`,
	);
	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS material_asset_versions (
			id TEXT PRIMARY KEY,
			asset_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			version INTEGER NOT NULL,
			data_json TEXT NOT NULL,
			note TEXT,
			created_at TEXT NOT NULL,
			UNIQUE (asset_id, version),
			FOREIGN KEY (asset_id) REFERENCES material_assets(id)
		)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_material_versions_asset
		 ON material_asset_versions(asset_id, version DESC)`,
	);
	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS shot_material_refs (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			shot_id TEXT NOT NULL,
			asset_id TEXT NOT NULL,
			asset_version INTEGER NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			UNIQUE (project_id, shot_id, asset_id),
			FOREIGN KEY (asset_id) REFERENCES material_assets(id)
		)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_shot_material_refs_project
		 ON shot_material_refs(project_id, shot_id)`,
	);
	materialSchemaEnsured = true;
}

export async function ensureProjectOwnership(
	db: D1Database,
	projectId: string,
	ownerId: string,
): Promise<boolean> {
	assertOpenWorkspaceDataScope({
		userId: ownerId,
		resource: "material_projects",
		operation: "check_ownership",
	});
	const row = await queryOne<{ id: string }>(
		db,
		`SELECT id FROM projects WHERE id = ? LIMIT 1`,
		[projectId],
	);
	return !!row?.id;
}

export async function createMaterialAsset(
	db: D1Database,
	input: {
		id: string;
		ownerId: string;
		projectId: string;
		kind: "character" | "scene" | "prop" | "style";
		name: string;
		nowIso: string;
	},
): Promise<MaterialAssetDto> {
	assertOpenWorkspaceDataScope({
		userId: input.ownerId,
		resource: "material_assets",
		operation: "create",
	});
	await execute(
		db,
		`INSERT INTO material_assets (
			id, project_id, kind, name, current_version, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			input.id,
			input.projectId,
			input.kind,
			input.name,
			1,
			input.nowIso,
			input.nowIso,
		],
	);
	const row = await queryOne<MaterialAssetRow>(
		db,
		`SELECT * FROM material_assets WHERE id = ? LIMIT 1`,
		[input.id],
	);
	if (!row) throw new Error("Failed to load created material asset");
	return toMaterialAssetDto(row);
}

export async function listMaterialAssets(
	db: D1Database,
	input: {
		ownerId: string;
		projectId: string;
		kind?: "character" | "scene" | "prop" | "style";
	},
): Promise<MaterialAssetDto[]> {
	assertOpenWorkspaceDataScope({
		userId: input.ownerId,
		resource: "material_assets",
		operation: "list",
	});
	const rows = input.kind
		? await queryAll<MaterialAssetRow>(
				db,
				`SELECT * FROM material_assets
				 WHERE project_id = ? AND kind = ?
				 ORDER BY updated_at DESC`,
				[input.projectId, input.kind],
			)
		: await queryAll<MaterialAssetRow>(
				db,
				`SELECT * FROM material_assets
				 WHERE project_id = ?
				 ORDER BY updated_at DESC`,
				[input.projectId],
			);
	const assets = rows.map(toMaterialAssetDto);
	if (assets.length === 0) return assets;

	const placeholders = assets.map(() => "?").join(", ");
	const versionRows = await queryAll<MaterialVersionRow>(
		db,
		`SELECT * FROM material_asset_versions
		 WHERE asset_id IN (${placeholders})
		   AND version = (
		     SELECT current_version
		     FROM material_assets
		     WHERE id = material_asset_versions.asset_id
		     LIMIT 1
		   )`,
		assets.map((asset) => asset.id),
	);
	const latestVersionByAssetId = new Map(
		versionRows.map((row) => [row.asset_id, toVersionDto(row)]),
	);
	return assets.map((asset) => ({
		...asset,
		latestVersion: latestVersionByAssetId.get(asset.id) || null,
	}));
}

export async function getMaterialAssetForOwner(
	db: D1Database,
	input: {
		ownerId: string;
		assetId: string;
	},
): Promise<MaterialAssetDto | null> {
	assertOpenWorkspaceDataScope({
		userId: input.ownerId,
		resource: "material_assets",
		operation: "get",
	});
	const row = await queryOne<MaterialAssetRow>(
		db,
		`SELECT * FROM material_assets WHERE id = ? LIMIT 1`,
		[input.assetId],
	);
	return row ? toMaterialAssetDto(row) : null;
}

export async function createMaterialVersion(
	db: D1Database,
	input: {
		id: string;
		ownerId: string;
		projectId: string;
		assetId: string;
		version: number;
		data: Record<string, unknown>;
		note: string | null;
		createdAt: string;
	},
): Promise<MaterialAssetVersionDto> {
	assertOpenWorkspaceDataScope({
		userId: input.ownerId,
		resource: "material_asset_versions",
		operation: "create",
	});
	await execute(
		db,
		`INSERT INTO material_asset_versions (
			id, asset_id, project_id, version, data_json, note, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			input.id,
			input.assetId,
			input.projectId,
			input.version,
			JSON.stringify(input.data),
			input.note,
			input.createdAt,
		],
	);
	await execute(
		db,
		`UPDATE material_assets
		 SET current_version = ?, updated_at = ?
		 WHERE id = ?`,
		[input.version, input.createdAt, input.assetId],
	);
	const row = await queryOne<MaterialVersionRow>(
		db,
		`SELECT * FROM material_asset_versions
		 WHERE id = ? LIMIT 1`,
		[input.id],
	);
	if (!row) throw new Error("Failed to load created material version");
	return toVersionDto(row);
}

// 给已存在的素材追加新版本：版本号在单条 wCTE 内原子分配。
// 对 material_assets 行的 UPDATE 提供行锁，使并发追加串行化；
// GREATEST(current_version, MAX(version)) 兜底历史/存量漂移。
// 与 public_chat_run_events 的 event_seq 方案同构，消除并发 UNIQUE(asset_id, version) 23505。
export async function appendMaterialVersion(
	db: D1Database,
	input: {
		id: string;
		ownerId: string;
		projectId: string;
		assetId: string;
		data: Record<string, unknown>;
		note: string | null;
		createdAt: string;
	},
): Promise<MaterialAssetVersionDto> {
	assertOpenWorkspaceDataScope({
		userId: input.ownerId,
		resource: "material_asset_versions",
		operation: "create",
	});
	const row = await queryOne<MaterialVersionRow>(
		db,
		`WITH bumped AS (
			UPDATE material_assets
			SET current_version = GREATEST(
				current_version,
				(SELECT COALESCE(MAX(version), 0) FROM material_asset_versions WHERE asset_id = ?)
			) + 1,
			updated_at = ?
			WHERE id = ?
			RETURNING current_version AS version
		)
		INSERT INTO material_asset_versions (
			id, asset_id, project_id, version, data_json, note, created_at
		)
		SELECT ?, ?, ?, (SELECT version FROM bumped), ?, ?, ?
		WHERE EXISTS (SELECT 1 FROM bumped)
		RETURNING *`,
		[
			input.assetId,
			input.createdAt,
			input.assetId,
			input.id,
			input.assetId,
			input.projectId,
			JSON.stringify(input.data),
			input.note,
			input.createdAt,
		],
	);
	if (!row) throw new Error("Failed to load created material version");
	return toVersionDto(row);
}

export async function listMaterialVersions(
	db: D1Database,
	input: {
		ownerId: string;
		assetId: string;
		limit: number;
	},
): Promise<MaterialAssetVersionDto[]> {
	assertOpenWorkspaceDataScope({
		userId: input.ownerId,
		resource: "material_asset_versions",
		operation: "list",
	});
	const limit = Math.max(1, Math.min(200, Math.floor(input.limit)));
	const rows = await queryAll<MaterialVersionRow>(
		db,
		`SELECT * FROM material_asset_versions
		 WHERE asset_id = ?
		 ORDER BY version DESC
		 LIMIT ?`,
		[input.assetId, limit],
	);
	return rows.map(toVersionDto);
}

export async function upsertShotMaterialRef(
	db: D1Database,
	input: {
		id: string;
		ownerId: string;
		projectId: string;
		shotId: string;
		assetId: string;
		assetVersion: number;
		nowIso: string;
	},
): Promise<MaterialShotRefDto> {
	assertOpenWorkspaceDataScope({
		userId: input.ownerId,
		resource: "shot_material_refs",
		operation: "upsert",
	});
	await execute(
		db,
		`INSERT INTO shot_material_refs (
			id, project_id, shot_id, asset_id, asset_version, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(project_id, shot_id, asset_id) DO UPDATE SET
			asset_version = excluded.asset_version,
			updated_at = excluded.updated_at`,
		[
			input.id,
			input.projectId,
			input.shotId,
			input.assetId,
			input.assetVersion,
			input.nowIso,
			input.nowIso,
		],
	);
	const row = await queryOne<ShotMaterialRefRow>(
		db,
		`SELECT * FROM shot_material_refs
		 WHERE project_id = ? AND shot_id = ? AND asset_id = ?
		 LIMIT 1`,
		[input.projectId, input.shotId, input.assetId],
	);
	if (!row) throw new Error("Failed to load shot material ref");
	return toShotRefDto(row);
}

export async function listImpactedShots(
	db: D1Database,
	input: {
		ownerId: string;
		projectId: string;
		assetId?: string;
	},
): Promise<MaterialImpactResponseDto> {
	assertOpenWorkspaceDataScope({
		userId: input.ownerId,
		resource: "shot_material_refs",
		operation: "list_impacted_shots",
	});
	const rows = input.assetId
		? await queryAll<{
				shot_id: string;
				asset_id: string;
				asset_version: number;
				current_version: number;
			}>(
				db,
				`SELECT
					r.shot_id,
					r.asset_id,
					r.asset_version,
					a.current_version
				 FROM shot_material_refs r
				 INNER JOIN material_assets a ON a.id = r.asset_id
				 WHERE r.project_id = ? AND r.asset_id = ?
				 ORDER BY r.updated_at DESC`,
				[input.projectId, input.assetId],
			)
		: await queryAll<{
				shot_id: string;
				asset_id: string;
				asset_version: number;
				current_version: number;
			}>(
				db,
				`SELECT
					r.shot_id,
					r.asset_id,
					r.asset_version,
					a.current_version
				 FROM shot_material_refs r
				 INNER JOIN material_assets a ON a.id = r.asset_id
				 WHERE r.project_id = ?
				 ORDER BY r.updated_at DESC`,
				[input.projectId],
			);
	return {
		projectId: input.projectId,
		items: rows.map((row) => {
			const boundVersion = Math.max(1, Math.trunc(Number(row.asset_version || 1)));
			const currentVersion = Math.max(
				1,
				Math.trunc(Number(row.current_version || 1)),
			);
			return {
				shotId: row.shot_id,
				assetId: row.asset_id,
				boundVersion,
				currentVersion,
				isOutdated: boundVersion < currentVersion,
			};
		}),
	};
}

export async function listShotMaterialRefs(
	db: D1Database,
	input: {
		ownerId: string;
		projectId: string;
		shotId: string;
	},
): Promise<MaterialShotRefDto[]> {
	assertOpenWorkspaceDataScope({
		userId: input.ownerId,
		resource: "shot_material_refs",
		operation: "list",
	});
	const rows = await queryAll<ShotMaterialRefRow>(
		db,
		`SELECT * FROM shot_material_refs
		 WHERE project_id = ? AND shot_id = ?
		 ORDER BY updated_at DESC`,
		[input.projectId, input.shotId],
	);
	return rows.map(toShotRefDto);
}
