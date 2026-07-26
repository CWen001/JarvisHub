#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const EXECUTE = process.argv.includes("--execute");
const CONFIRM_ENV = "CONFIRM_PURGE_LEGACY_VISUAL";
const CONFIRM_VALUE = "DELETE_LEGACY_VISUAL_DATA";

const LEGACY_VISUAL_NODE_KINDS = new Set([
	"storyboard",
	"storyboardscript",
	"storyboardimage",
	"storyboardshot",
	"novelstoryboard",
]);

const LEGACY_VISUAL_DB_TABLES = [
	"storyboard_assets",
	"storyboard_asset_views",
	"storyboard_shots",
	"storyboard_render_jobs",
	"storyboard_timeline_tracks",
	"storyboard_diagnostic_logs",
];

const LEGACY_VISUAL_TEXT_TOKENS = [
	"分镜",
	"NanoComic",
	"nanoComic",
	"storyboard",
	"Storyboard",
	"STORYBOARD",
	"storyboardScript",
	"storyboardImage",
	"storyboardShot",
	"novelStoryboard",
	"storyboardChunks",
	"storyboardPlans",
	"chapterGrounded",
	"ChapterGrounded",
	"chapter_grounded",
	"chapter-grounded",
	"authorityBaseFrame",
	"authority_base_frame",
	"lockedAnchors",
	"workspaceAction",
	"chapter_asset_generation",
	"chapter_script_generation",
	"shot_video_generation",
	"chapterAssetRepair",
	"chapterContinuity",
	"shot_anchor_lock",
];

async function fileExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function resolveRepoRoot() {
	let dir = path.resolve(process.cwd());
	for (let i = 0; i < 12; i += 1) {
		if (await fileExists(path.join(dir, "pnpm-workspace.yaml"))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return path.resolve(process.cwd());
}

function normalizeKind(value) {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text, source) {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`Invalid JSON in ${source}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function findLegacyTokenMatches(text) {
	return Array.from(new Set(LEGACY_VISUAL_TEXT_TOKENS.filter((token) => text.includes(token)))).sort();
}

function stringifyForResidualScan(value) {
	return JSON.stringify(value);
}

function pruneFlowData(data) {
	if (!isRecord(data) || !Array.isArray(data.nodes)) {
		return { data, removedNodeIds: [], removedEdgeIds: [] };
	}
	const removedNodeIds = [];
	const nextNodes = [];
	for (const node of data.nodes) {
		const nodeRecord = isRecord(node) ? node : null;
		const id = typeof nodeRecord?.id === "string" ? nodeRecord.id : "";
		const nodeData = isRecord(nodeRecord?.data) ? nodeRecord.data : null;
		const kind = normalizeKind(nodeData?.kind);
		if (id && LEGACY_VISUAL_NODE_KINDS.has(kind)) {
			removedNodeIds.push(id);
			continue;
		}
		nextNodes.push(node);
	}
	const removedIdSet = new Set(removedNodeIds);
	const removedEdgeIds = [];
	const nextEdges = Array.isArray(data.edges)
		? data.edges.filter((edge) => {
				if (!isRecord(edge)) return true;
				const source = typeof edge.source === "string" ? edge.source : "";
				const target = typeof edge.target === "string" ? edge.target : "";
				const remove = removedIdSet.has(source) || removedIdSet.has(target);
				if (remove && typeof edge.id === "string") removedEdgeIds.push(edge.id);
				return !remove;
			})
		: data.edges;
	if (removedNodeIds.length === 0 && removedEdgeIds.length === 0) {
		return { data, removedNodeIds, removedEdgeIds };
	}
	return {
		data: {
			...data,
			nodes: nextNodes,
			...(Array.isArray(data.edges) ? { edges: nextEdges } : {}),
		},
		removedNodeIds,
		removedEdgeIds,
	};
}

function pruneBookIndex(data) {
	if (!isRecord(data)) return { data, removedKeys: [], removedMaterialCount: 0 };
	const assets = isRecord(data.assets) ? { ...data.assets } : null;
	const removedKeys = [];
	if (assets && Object.prototype.hasOwnProperty.call(assets, "storyboardPlans")) {
		delete assets.storyboardPlans;
		removedKeys.push("assets.storyboardPlans");
	}
	if (assets && Object.prototype.hasOwnProperty.call(assets, "storyboardChunks")) {
		delete assets.storyboardChunks;
		removedKeys.push("assets.storyboardChunks");
	}
	let removedMaterialCount = 0;
	const nextMaterials = Array.isArray(data.materials)
		? data.materials.filter((item) => {
				const kind = normalizeKind(isRecord(item) ? item.kind : "");
				const remove = kind === "storyboardscript";
				if (remove) removedMaterialCount += 1;
				return !remove;
			})
		: data.materials;
	return {
		data: {
			...data,
			...(assets ? { assets } : {}),
			...(Array.isArray(data.materials) ? { materials: nextMaterials } : {}),
		},
		removedKeys,
		removedMaterialCount,
	};
}

async function walkJsonFiles(rootDir) {
	const out = [];
	async function walk(dir) {
		const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			const entryPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(entryPath);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".json")) out.push(entryPath);
		}
	}
	await walk(rootDir);
	return out;
}

async function inspectProjectData(projectDataRoot) {
	const files = (await fileExists(projectDataRoot)) ? await walkJsonFiles(projectDataRoot) : [];
	const affectedBookIndexes = [];
	const unknownLegacyJsonFiles = [];
	for (const filePath of files) {
		const raw = await fs.readFile(filePath, "utf8");
		const tokenMatches = findLegacyTokenMatches(raw);
		if (tokenMatches.length === 0) continue;
		const parsed = parseJson(raw, filePath);
		if (path.basename(filePath) === "index.json") {
			const pruned = pruneBookIndex(parsed);
			if (pruned.removedKeys.length > 0 || pruned.removedMaterialCount > 0) {
				const remainingTokenMatches = findLegacyTokenMatches(stringifyForResidualScan(pruned.data));
				affectedBookIndexes.push({
					filePath,
					removedKeys: pruned.removedKeys,
					removedMaterialCount: pruned.removedMaterialCount,
					remainingTokenMatches,
					nextData: pruned.data,
				});
				if (remainingTokenMatches.length === 0) continue;
			}
		}
		unknownLegacyJsonFiles.push({ filePath, tokenMatches });
	}
	return { affectedBookIndexes, unknownLegacyJsonFiles };
}

function quoteIdent(name) {
	if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
	return `"${name}"`;
}

function inspectJsonDataRow(row, sourcePrefix) {
	const tokenMatches = findLegacyTokenMatches(row.data || "");
	if (tokenMatches.length === 0) return null;
	const parsed = parseJson(row.data, `${sourcePrefix}:${row.id}`);
	const pruned = pruneFlowData(parsed);
	const remainingTokenMatches = findLegacyTokenMatches(stringifyForResidualScan(pruned.data));
	return {
		id: row.id,
		tokenMatches,
		remainingTokenMatches,
		...pruned,
	};
}

function summarizeTextRowTokenMatches(rows, textFields) {
	const matches = [];
	for (const row of rows) {
		const text = textFields.map((field) => row[field] || "").join("\n");
		const tokenMatches = findLegacyTokenMatches(text);
		if (tokenMatches.length > 0) matches.push({ id: row.id, tokenMatches });
	}
	return matches;
}

async function inspectDatabase() {
	const databaseUrl = String(process.env.DATABASE_URL || "").trim();
	if (!databaseUrl) {
		return { skipped: true, reason: "DATABASE_URL is not set" };
	}
	const { PrismaClient } = await import("@prisma/client");
	const prisma = new PrismaClient();
	try {
		const tables = [];
		for (const table of LEGACY_VISUAL_DB_TABLES) {
			const existsRows = await prisma.$queryRawUnsafe(
				"SELECT to_regclass($1) AS name",
				`public.${table}`,
			);
			const exists = Boolean(existsRows?.[0]?.name);
			const count = exists
				? Number((await prisma.$queryRawUnsafe(`SELECT count(*)::int AS count FROM ${quoteIdent(table)}`))?.[0]?.count || 0)
				: 0;
			tables.push({ table, exists, count });
		}
		const flows = await prisma.flows.findMany({ select: { id: true, data: true } });
		const affectedFlows = [];
		const unknownFlowTokenMatches = [];
		for (const flow of flows) {
			const inspected = inspectJsonDataRow(flow, "flows");
			if (!inspected) continue;
			if (inspected.removedNodeIds.length || inspected.removedEdgeIds.length) affectedFlows.push(inspected);
			if (inspected.remainingTokenMatches.length > 0) {
				unknownFlowTokenMatches.push({
					id: flow.id,
					tokenMatches: inspected.remainingTokenMatches,
				});
			}
		}
		const versions = await prisma.flow_versions.findMany({ select: { id: true, data: true } });
		const affectedFlowVersions = [];
		const unknownFlowVersionTokenMatches = [];
		for (const version of versions) {
			const inspected = inspectJsonDataRow(version, "flow_versions");
			if (!inspected) continue;
			if (inspected.removedNodeIds.length || inspected.removedEdgeIds.length) affectedFlowVersions.push(inspected);
			if (inspected.remainingTokenMatches.length > 0) {
				unknownFlowVersionTokenMatches.push({
					id: version.id,
					tokenMatches: inspected.remainingTokenMatches,
				});
			}
		}
		const assetRows = await prisma.assets.findMany({ select: { id: true, data: true } });
		const assetTokenMatches = summarizeTextRowTokenMatches(assetRows, ["data"]);
		const memoryRows = await prisma.memory_entries.findMany({
			select: { id: true, title: true, summary_text: true, content_json: true, source_kind: true, source_id: true },
		});
		const memoryTokenMatches = summarizeTextRowTokenMatches(memoryRows, [
			"title",
			"summary_text",
			"content_json",
			"source_kind",
			"source_id",
		]);
		return {
			skipped: false,
			tables,
			affectedFlows,
			unknownFlowTokenMatches,
			affectedFlowVersions,
			unknownFlowVersionTokenMatches,
			assetTokenMatches,
			memoryCleanup: {
				status: memoryTokenMatches.length > 0 ? "blocked" : "clear",
				matchedRows: memoryTokenMatches,
				reason:
					memoryTokenMatches.length > 0
						? "Legacy visual memory rows cannot be reliably deleted without risking unrelated conversation history."
						: "No legacy visual memory token matches found.",
			},
			prisma,
		};
	} catch (error) {
		await prisma.$disconnect();
		throw error;
	}
}

async function executeDatabaseCleanup(dbReport) {
	const prisma = dbReport.prisma;
	if (!prisma) return;
	if (dbReport.memoryCleanup?.status === "blocked") {
		throw new Error(`Refusing execute: ${dbReport.memoryCleanup.reason}`);
	}
	for (const flow of dbReport.affectedFlows) {
		await prisma.flows.update({
			where: { id: flow.id },
			data: { data: JSON.stringify(flow.data), updated_at: new Date().toISOString() },
		});
	}
	for (const version of dbReport.affectedFlowVersions) {
		await prisma.flow_versions.update({
			where: { id: version.id },
			data: { data: JSON.stringify(version.data) },
		});
	}
	for (const table of dbReport.tables.filter((item) => item.exists && item.count > 0)) {
		await prisma.$executeRawUnsafe(`DELETE FROM ${quoteIdent(table.table)}`);
	}
}

function buildExecuteBlockers(projectData, dbReport) {
	const blockers = [];
	if (projectData.unknownLegacyJsonFiles.length > 0) {
		blockers.push({
			code: "unknown_project_data_legacy_json",
			count: projectData.unknownLegacyJsonFiles.length,
			reason: "Project-data JSON contains legacy visual tokens that this script cannot safely rewrite.",
		});
	}
	const blockedBookIndexes = projectData.affectedBookIndexes.filter((item) => item.remainingTokenMatches.length > 0);
	if (blockedBookIndexes.length > 0) {
		blockers.push({
			code: "book_index_residual_legacy_tokens",
			count: blockedBookIndexes.length,
			reason: "Book index cleanup would still leave legacy visual tokens behind.",
		});
	}
	if (dbReport.skipped) return blockers;
	if (dbReport.memoryCleanup?.status === "blocked") {
		blockers.push({
			code: "blocked_memory_cleanup",
			count: dbReport.memoryCleanup.matchedRows?.length || 0,
			reason: dbReport.memoryCleanup.reason,
		});
	}
	if (dbReport.assetTokenMatches.length > 0) {
		blockers.push({
			code: "unhandled_asset_token_matches",
			count: dbReport.assetTokenMatches.length,
			reason: "Asset rows contain legacy visual tokens; this script reports them but does not guess-delete asset data.",
		});
	}
	if (dbReport.unknownFlowTokenMatches.length > 0) {
		blockers.push({
			code: "unknown_flow_legacy_json",
			count: dbReport.unknownFlowTokenMatches.length,
			reason: "Flow JSON contains legacy visual tokens beyond removable legacy nodes.",
		});
	}
	if (dbReport.unknownFlowVersionTokenMatches.length > 0) {
		blockers.push({
			code: "unknown_flow_version_legacy_json",
			count: dbReport.unknownFlowVersionTokenMatches.length,
			reason: "Flow version JSON contains legacy visual tokens beyond removable legacy nodes.",
		});
	}
	return blockers;
}

async function main() {
	if (EXECUTE && process.env[CONFIRM_ENV] !== CONFIRM_VALUE) {
		throw new Error(`Refusing execute: set ${CONFIRM_ENV}=${CONFIRM_VALUE}`);
	}
	const repoRoot = await resolveRepoRoot();
	const projectDataRoot = process.env.PROJECT_DATA_ROOT
		? path.resolve(process.env.PROJECT_DATA_ROOT)
		: path.join(repoRoot, "project-data");
	const projectData = await inspectProjectData(projectDataRoot);
	const dbReport = await inspectDatabase();
	try {
		const executeBlockers = buildExecuteBlockers(projectData, dbReport);
		const safeReport = {
			mode: EXECUTE ? "execute" : "dry-run",
			projectDataRoot,
			projectData: {
				affectedBookIndexes: projectData.affectedBookIndexes.map((item) => ({
					filePath: item.filePath,
					removedKeys: item.removedKeys,
					removedMaterialCount: item.removedMaterialCount,
					remainingTokenMatches: item.remainingTokenMatches,
				})),
				unknownLegacyJsonFiles: projectData.unknownLegacyJsonFiles,
			},
			database: dbReport.skipped
				? dbReport
				: {
						tables: dbReport.tables,
						affectedFlows: dbReport.affectedFlows.map((item) => ({
							id: item.id,
							removedNodeIds: item.removedNodeIds,
							removedEdgeIds: item.removedEdgeIds,
							remainingTokenMatches: item.remainingTokenMatches,
						})),
						unknownFlowTokenMatches: dbReport.unknownFlowTokenMatches,
						affectedFlowVersions: dbReport.affectedFlowVersions.map((item) => ({
							id: item.id,
							removedNodeIds: item.removedNodeIds,
							removedEdgeIds: item.removedEdgeIds,
							remainingTokenMatches: item.remainingTokenMatches,
						})),
						unknownFlowVersionTokenMatches: dbReport.unknownFlowVersionTokenMatches,
						assetTokenMatches: dbReport.assetTokenMatches,
						memoryCleanup: dbReport.memoryCleanup,
					},
			executeBlockers,
		};
		console.log(JSON.stringify(safeReport, null, 2));
		if (!EXECUTE) return;
		if (executeBlockers.length > 0) {
			throw new Error(`Refusing execute: preflight blocked (${executeBlockers.map((item) => item.code).join(", ")})`);
		}
		for (const item of projectData.affectedBookIndexes) {
			await fs.writeFile(item.filePath, `${JSON.stringify(item.nextData, null, 2)}\n`);
		}
		await executeDatabaseCleanup(dbReport);
	} finally {
		if (!dbReport.skipped && dbReport.prisma) await dbReport.prisma.$disconnect();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
