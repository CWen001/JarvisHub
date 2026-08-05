export type PublicChatResponseAsset = {
	type: "image" | "video";
	url: string;
	thumbnailUrl?: string;
	assetId?: string;
	assetRefId?: string;
};

export type PublicChatMediaDeliveryReconciliation = {
	assets: PublicChatResponseAsset[];
	persistedSuccessfulNodeIds: string[];
	unresolvedSuccessfulNodeIds: string[];
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function httpUrl(value: unknown): string {
	const normalized = text(value);
	return /^https?:\/\//i.test(normalized) ? normalized : "";
}

function terminalSuccessfulNodeIds(mediaResults: readonly unknown[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of mediaResults) {
		if (!isRecord(value)) continue;
		const status = text(value.status).toLowerCase();
		if (status !== "succeeded" && status !== "success") continue;
		if (value.pending === true) continue;
		const nodeId = text(value.nodeId);
		if (!nodeId || seen.has(nodeId)) continue;
		seen.add(nodeId);
		out.push(nodeId);
	}
	return out;
}

function persistedAssetFromNode(node: RecordValue): PublicChatResponseAsset | null {
	const data = isRecord(node.data) ? node.data : {};
	if (text(data.status).toLowerCase() !== "success") return null;
	const kind = text(data.kind).toLowerCase();
	const video = kind === "video" || kind === "composevideo";
	const url = httpUrl(video ? data.videoUrl : data.imageUrl);
	if (!url) return null;
	const thumbnailUrl = video ? httpUrl(data.thumbnailUrl) : "";
	const assetId = text(data.assetId);
	const assetRefId = text(data.assetRefId);
	return {
		type: video ? "video" : "image",
		url,
		...(thumbnailUrl ? { thumbnailUrl } : {}),
		...(assetId ? { assetId } : {}),
		...(assetRefId ? { assetRefId } : {}),
	};
}

function assetIdentity(asset: PublicChatResponseAsset): string {
	return text(asset.assetId) || text(asset.assetRefId) || text(asset.url);
}

function parseJsonRecord(value: unknown): RecordValue | null {
	if (isRecord(value)) return value;
	const raw = text(value);
	if (!raw.startsWith("{")) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function collectPersistedSuccessRecords(value: unknown, out: Set<string>, depth = 0): void {
	if (depth > 8) return;
	if (Array.isArray(value)) {
		for (const item of value) collectPersistedSuccessRecords(item, out, depth + 1);
		return;
	}
	if (!isRecord(value)) return;
	const nodeId = text(value.nodeId);
	const status = text(value.status).toLowerCase();
	if (
		nodeId &&
		value.persisted === true &&
		(status === "success" || status === "succeeded" || status === "completed")
	) {
		out.add(nodeId);
	}
	for (const [key, child] of Object.entries(value)) {
		if (key === "fullText") {
			const parsed = parseJsonRecord(child);
			if (parsed) collectPersistedSuccessRecords(parsed, out, depth + 1);
			continue;
		}
		if (
			key === "completed" ||
			key === "dispatched" ||
			key === "results" ||
			key === "structuredOutput" ||
			key === "outputJson"
		) {
			collectPersistedSuccessRecords(child, out, depth + 1);
		}
	}
}

export function collectSuccessfulPersistedMediaNodeIds(toolCalls: readonly unknown[]): string[] {
	const out = new Set<string>();
	for (const value of toolCalls) {
		if (!isRecord(value) || text(value.status).toLowerCase() !== "succeeded") continue;
		const output = isRecord(value.outputJson) ? value.outputJson : null;
		const requestedType = text(value.requestedAgentType).toLowerCase();
		const outputType = output ? text(output.subagentType ?? output.agentType).toLowerCase() : "";
		if (text(value.name) !== "Agent" || (requestedType !== "media" && outputType !== "media")) continue;
		collectPersistedSuccessRecords(output, out);
	}
	return [...out];
}

export function reconcilePublicChatMediaDelivery(input: {
	upstreamAssets: readonly PublicChatResponseAsset[];
	mediaResults: readonly unknown[];
	flowGraph: unknown;
}): PublicChatMediaDeliveryReconciliation {
	const successfulNodeIds = terminalSuccessfulNodeIds(input.mediaResults);
	const requested = new Set(successfulNodeIds);
	const persistedByNodeId = new Map<string, PublicChatResponseAsset>();
	const graph = isRecord(input.flowGraph) ? input.flowGraph : null;
	const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
	for (const value of nodes) {
		if (!isRecord(value)) continue;
		const nodeId = text(value.id);
		if (!requested.has(nodeId)) continue;
		const asset = persistedAssetFromNode(value);
		if (asset) persistedByNodeId.set(nodeId, asset);
	}

	const recoveredAssets = successfulNodeIds
		.map((nodeId) => persistedByNodeId.get(nodeId) ?? null)
		.filter((asset): asset is PublicChatResponseAsset => asset !== null);
	const seen = new Set<string>();
	const assets = [...recoveredAssets, ...input.upstreamAssets].filter((asset) => {
		const identity = assetIdentity(asset);
		if (!identity || seen.has(identity)) return false;
		seen.add(identity);
		return true;
	});

	return {
		assets,
		persistedSuccessfulNodeIds: successfulNodeIds.filter((nodeId) => persistedByNodeId.has(nodeId)),
		unresolvedSuccessfulNodeIds: successfulNodeIds.filter((nodeId) => !persistedByNodeId.has(nodeId)),
	};
}
