import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { assertOpenWorkspaceDataScope } from "../auth/open-workspace-data-scope";

export type AssetDataKind = "image" | "video" | "text" | "webpage";

type CanvasNode = {
	id: string;
	data?: {
		kind?: string;
		prompt?: string;
		textResults?: Array<{ text?: string }>;
		webHeroDocumentHtml?: string;
		webHeroHtml?: string;
		webHeroCss?: string;
		[key: string]: unknown;
	};
};

type CanvasData = {
	nodes?: CanvasNode[];
};

const PERSISTABLE_NODE_KINDS = new Set(["text", "webHero"]);

function nodeKindToAssetKind(nodeKind: string): AssetDataKind {
	if (nodeKind === "webHero") return "webpage";
	return "text";
}

function extractTextContent(node: CanvasNode): string | null {
	const results = node.data?.textResults;
	if (Array.isArray(results) && results.length > 0) {
		const text = results[0]?.text;
		if (typeof text === "string" && text.trim()) return text;
	}
	const prompt = node.data?.prompt;
	if (typeof prompt === "string" && prompt.trim()) return prompt;
	return null;
}

function extractWebpageContent(node: CanvasNode): string | null {
	const docHtml = node.data?.webHeroDocumentHtml;
	if (typeof docHtml === "string" && docHtml.trim()) return docHtml;
	return null;
}

function buildAssetDataFromNode(node: CanvasNode): Record<string, unknown> | null {
	const nodeKind = node.data?.kind;
	if (!nodeKind || !PERSISTABLE_NODE_KINDS.has(nodeKind)) return null;

	const assetKind = nodeKindToAssetKind(nodeKind);

	if (assetKind === "text") {
		const text = extractTextContent(node);
		if (!text) return null;
		return {
			kind: "text",
			text,
			prompt: node.data?.prompt || undefined,
			sourceNodeKind: nodeKind,
		};
	}

	if (assetKind === "webpage") {
		const documentHtml = extractWebpageContent(node);
		if (!documentHtml) return null;
		return {
			kind: "webpage",
			documentHtml,
			html: node.data?.webHeroHtml || undefined,
			css: node.data?.webHeroCss || undefined,
		};
	}

	return null;
}

export async function upsertAssetByNodeId(
	db: PrismaClient,
	userId: string,
	input: { nodeId: string; projectId: string | null; name: string; data: Record<string, unknown> },
): Promise<void> {
	void db;
	assertOpenWorkspaceDataScope({
		userId,
		resource: "assets",
		operation: "upsert_by_node",
	});

	const nowIso = new Date().toISOString();
	const dataWithNodeId = { ...input.data, sourceNodeId: input.nodeId };
	const dataJson = JSON.stringify(dataWithNodeId);
	const marker = `"sourceNodeId":"${input.nodeId}"`;

	const existing = await getPrismaClient().assets.findFirst({
		where: {
			project_id: input.projectId,
			data: { contains: marker },
		},
	});

	if (existing) {
		await getPrismaClient().assets.update({
			where: { id: existing.id },
			data: { name: input.name, data: dataJson, updated_at: nowIso },
		});
	} else {
		await getPrismaClient().assets.create({
			data: {
				id: crypto.randomUUID(),
				name: input.name,
				data: dataJson,
				project_id: input.projectId,
				created_at: nowIso,
				updated_at: nowIso,
			},
		});
	}
}

export async function syncCanvasNodesToAssets(
	db: PrismaClient,
	userId: string,
	projectId: string | null,
	canvasData: unknown,
): Promise<void> {
	if (!canvasData || typeof canvasData !== "object") return;
	const canvas = canvasData as CanvasData;
	const nodes = canvas.nodes;
	if (!Array.isArray(nodes)) return;

	for (const node of nodes) {
		if (!node || typeof node !== "object" || !node.id) continue;
		const nodeKind = node.data?.kind;
		if (!nodeKind || !PERSISTABLE_NODE_KINDS.has(nodeKind)) continue;

		const assetData = buildAssetDataFromNode(node);
		if (!assetData) continue;

		const name = `${nodeKind}-${node.id.slice(0, 8)}`;
		await upsertAssetByNodeId(db, userId, {
			nodeId: node.id,
			projectId,
			name,
			data: assetData,
		});
	}
}
