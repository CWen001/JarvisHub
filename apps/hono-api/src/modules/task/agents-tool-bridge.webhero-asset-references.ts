import { AppError } from "../../middleware/error";

type FlowGraphRecord = {
	nodes?: unknown[];
	edges?: unknown[];
};

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRecordArray(value: unknown): Record<string, unknown>[] {
	let parsed = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value) as unknown;
		} catch {
			return [];
		}
	}
	return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
}

function flowNodeId(node: unknown): string {
	return isRecord(node) ? readTrimmedString(node.id) : "";
}

function flowNodeData(node: unknown): Record<string, unknown> {
	return isRecord(node) && isRecord(node.data) ? node.data : {};
}

function findNode(graph: FlowGraphRecord, nodeId: string): unknown | null {
	return (graph.nodes || []).find((node) => flowNodeId(node) === nodeId) || null;
}

function readHostedUrl(value: unknown): string {
	const seen = new Set<object>();
	const visit = (item: unknown, depth: number): string => {
		if (depth > 6) return "";
		if (typeof item === "string") {
			const trimmed = item.trim();
			try {
				const parsed = new URL(trimmed);
				return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : "";
			} catch {
				return "";
			}
		}
		if (Array.isArray(item)) {
			for (const child of item) {
				const url = visit(child, depth + 1);
				if (url) return url;
			}
			return "";
		}
		if (!isRecord(item) || seen.has(item)) return "";
		seen.add(item);
		for (const key of ["url", "imageUrl", "src", "outputUrl", "hostedUrl"]) {
			const url = visit(item[key], depth + 1);
			if (url) return url;
		}
		for (const key of ["imageResults", "results", "images", "outputs"]) {
			const url = visit(item[key], depth + 1);
			if (url) return url;
		}
		return "";
	};
	return visit(value, 0);
}

function assetRecordId(record: Record<string, unknown>): string {
	return readTrimmedString(record.assetId)
		|| readTrimmedString(record.id)
		|| readTrimmedString(record.requirementId)
		|| readTrimmedString(record.slotId)
		|| readTrimmedString(record.webPageAssetId);
}

function resolvedAssetNodeUrl(
	graph: FlowGraphRecord,
	targetNodeId: string,
	record: Record<string, unknown>,
): string {
	const sourceNodeId = readTrimmedString(record.sourceNodeId);
	const assetId = assetRecordId(record);
	if (!sourceNodeId || !assetId) return "";
	const sourceData = flowNodeData(findNode(graph, sourceNodeId));
	const status = readTrimmedString(sourceData.status).toLowerCase();
	if (status !== "success" && status !== "succeeded") return "";
	if (readTrimmedString(sourceData.webPageAssetForNodeId) !== targetNodeId) return "";
	if (readTrimmedString(sourceData.webPageAssetId) !== assetId) return "";
	return readHostedUrl(sourceData.imageUrl) || readHostedUrl(sourceData.imageResults);
}

export function hasUsableWebHeroResolvedAssetReference(
	graph: FlowGraphRecord,
	targetNodeId: string,
	resolvedAssets: unknown,
	assetId: string,
): boolean {
	if (!assetId) return false;
	return parseRecordArray(resolvedAssets).some((record) => {
		if (assetRecordId(record) !== assetId) return false;
		return Boolean(readHostedUrl(record) || resolvedAssetNodeUrl(graph, targetNodeId, record));
	});
}

function invalidReference(targetNodeId: string, sourceNodeId: string, reason: string): never {
	throw new AppError("WebHero asset reference cannot be resolved", {
		status: 409,
		code: "webhero_asset_reference_invalid",
		details: {
			nodeId: targetNodeId,
			sourceNodeId,
			reason,
			requiredNextStep:
				"Persist the generated asset's exact sourceNodeId in webPageResolvedAssets, then use {{asset:<sourceNodeId>}} in section drafts and staged WebHero code.",
		},
	});
}

export function materializeWebHeroAssetReferences(
	graph: FlowGraphRecord,
	targetNodeId: string,
	source: string,
): string {
	if (!source.includes("{{asset:")) return source;
	const targetData = flowNodeData(findNode(graph, targetNodeId));
	const ledger = parseRecordArray(targetData.webPageResolvedAssets);
	const materialized = source.replace(/\{\{asset:([^{}\s]+)\}\}/g, (_token, rawSourceNodeId: string) => {
		const sourceNodeId = rawSourceNodeId.trim();
		const record = ledger.find((item) => readTrimmedString(item.sourceNodeId) === sourceNodeId);
		if (!record) invalidReference(targetNodeId, sourceNodeId, "sourceNodeId is not present in webPageResolvedAssets");
		const url = resolvedAssetNodeUrl(graph, targetNodeId, record);
		if (!url) invalidReference(targetNodeId, sourceNodeId, "source node is not a successful owned WebHero asset with a hosted URL");
		return url;
	});
	if (materialized.includes("{{asset:")) {
		invalidReference(targetNodeId, "", "asset token must use the exact {{asset:<sourceNodeId>}} syntax");
	}
	return materialized;
}
