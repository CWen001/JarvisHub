#!/usr/bin/env node
import process from "node:process";

const EXECUTE = process.argv.includes("--execute");

function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value) {
	return typeof value === "string" ? value : "";
}

function isLegacyAssetBoardGroup(node) {
	if (!isRecord(node)) return false;
	if (node.type !== "groupNode") return false;
	const data = isRecord(node.data) ? node.data : null;
	if (!data) return false;
	const kind = readString(data.groupKind);
	return kind === "webPageAssetBoard" || kind === "webPageAssetBoardSection";
}

function isLegacyAssetBoardItem(node) {
	if (!isRecord(node)) return false;
	const data = isRecord(node.data) ? node.data : null;
	if (!data) return false;
	if (data.webPageAssetBoardDisplay === true) return false;
	return readString(data.webPageAssetBoardSection) !== "" && readString(data.webPageAssetBoardForNodeId) !== "";
}

function readParentId(node) {
	if (!isRecord(node)) return "";
	return readString(node.parentNode) || readString(node.parentId);
}

function collectDescendantIds(nodes, rootIds) {
	const ids = new Set(rootIds);
	let changed = true;
	while (changed) {
		changed = false;
		for (const node of nodes) {
			if (!isRecord(node)) continue;
			const id = readString(node.id);
			if (!id || ids.has(id)) continue;
			const parentId = readParentId(node);
			if (parentId && ids.has(parentId)) {
				ids.add(id);
				changed = true;
			}
		}
	}
	return ids;
}

function dedupeDisplayBoards(nodes) {
	const seenByWebHero = new Map();
	const dropIds = new Set();
	for (const node of nodes) {
		if (!isRecord(node)) continue;
		const data = isRecord(node.data) ? node.data : null;
		if (!data) continue;
		if (data.webPageAssetBoardDisplay !== true) continue;
		const webHeroId = readString(data.webPageAssetBoardForNodeId);
		if (!webHeroId) continue;
		const id = readString(node.id);
		if (!id) continue;
		if (seenByWebHero.has(webHeroId)) {
			dropIds.add(id);
		} else {
			seenByWebHero.set(webHeroId, id);
		}
	}
	return dropIds;
}

function pruneFlowData(data) {
	if (!isRecord(data) || !Array.isArray(data.nodes)) {
		return { changed: false, data, removedNodeIds: [], removedEdgeIds: [] };
	}
	const nodes = data.nodes;
	const directLegacyIds = [];
	for (const node of nodes) {
		if (!isRecord(node)) continue;
		const id = readString(node.id);
		if (!id) continue;
		if (isLegacyAssetBoardGroup(node) || isLegacyAssetBoardItem(node)) {
			directLegacyIds.push(id);
		}
	}
	const dropIds = collectDescendantIds(nodes, directLegacyIds);
	const dupeDisplayIds = dedupeDisplayBoards(nodes);
	dupeDisplayIds.forEach((id) => dropIds.add(id));

	if (!dropIds.size) {
		return { changed: false, data, removedNodeIds: [], removedEdgeIds: [] };
	}

	const removedNodeIds = Array.from(dropIds);
	const nextNodes = nodes.filter((node) => !dropIds.has(readString(node?.id || "")));
	const removedEdgeIds = [];
	const nextEdges = Array.isArray(data.edges)
		? data.edges.filter((edge) => {
				if (!isRecord(edge)) return true;
				const source = readString(edge.source);
				const target = readString(edge.target);
				if (dropIds.has(source) || dropIds.has(target)) {
					if (typeof edge.id === "string") removedEdgeIds.push(edge.id);
					return false;
				}
				return true;
			})
		: data.edges;

	return {
		changed: true,
		data: {
			...data,
			nodes: nextNodes,
			...(Array.isArray(data.edges) ? { edges: nextEdges } : {}),
		},
		removedNodeIds,
		removedEdgeIds,
	};
}

async function main() {
	const databaseUrl = readString(process.env.DATABASE_URL).trim();
	if (!databaseUrl) {
		console.error("DATABASE_URL is not set");
		process.exit(1);
	}
	const { PrismaClient } = await import("@prisma/client");
	const prisma = new PrismaClient();
	try {
		const flows = await prisma.flows.findMany({ select: { id: true, data: true } });
		const updates = [];
		for (const row of flows) {
			let parsed;
			try {
				parsed = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
			} catch {
				continue;
			}
			const result = pruneFlowData(parsed);
			if (result.changed) {
				updates.push({ id: row.id, nextData: result.data, removedNodeIds: result.removedNodeIds, removedEdgeIds: result.removedEdgeIds });
			}
		}
		console.log(`flows scanned: ${flows.length}`);
		console.log(`flows needing prune: ${updates.length}`);
		for (const u of updates) {
			console.log(`  flow ${u.id}: -${u.removedNodeIds.length} nodes, -${u.removedEdgeIds.length} edges`);
		}

		const versions = await prisma.flow_versions.findMany({ select: { id: true, data: true } });
		const versionUpdates = [];
		for (const row of versions) {
			let parsed;
			try {
				parsed = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
			} catch {
				continue;
			}
			const result = pruneFlowData(parsed);
			if (result.changed) {
				versionUpdates.push({ id: row.id, nextData: result.data, removedNodeIds: result.removedNodeIds, removedEdgeIds: result.removedEdgeIds });
			}
		}
		console.log(`flow_versions scanned: ${versions.length}`);
		console.log(`flow_versions needing prune: ${versionUpdates.length}`);
		for (const u of versionUpdates) {
			console.log(`  version ${u.id}: -${u.removedNodeIds.length} nodes, -${u.removedEdgeIds.length} edges`);
		}

		if (!EXECUTE) {
			console.log("\n[dry-run] Pass --execute to apply these updates.");
			return;
		}

		for (const u of updates) {
			await prisma.flows.update({ where: { id: u.id }, data: { data: JSON.stringify(u.nextData) } });
		}
		for (const u of versionUpdates) {
			await prisma.flow_versions.update({ where: { id: u.id }, data: { data: JSON.stringify(u.nextData) } });
		}
		console.log(`\nApplied ${updates.length} flow updates and ${versionUpdates.length} version updates.`);
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
