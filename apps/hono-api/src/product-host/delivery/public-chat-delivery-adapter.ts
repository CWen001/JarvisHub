export type PublicChatResponseAsset = {
	type: "image" | "video";
	url: string;
	thumbnailUrl?: string;
	assetId?: string;
	assetRefId?: string;
};

export type PublicChatDeliveryAdapterResult = {
	assets: PublicChatResponseAsset[];
	executionEvidence: { generatedAssets: boolean; wroteCanvas: boolean };
	mediaReconciliation: {
		claimedSuccessfulNodeIds: string[];
		persistedSuccessfulNodeIds: string[];
		unresolvedSuccessfulNodeIds: string[];
	};
};

export type PublicChatDeliveryOutcome = {
	status: "satisfied" | "partial" | "failed";
	reasons: string[];
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
	) out.add(nodeId);
	for (const [key, child] of Object.entries(value)) {
		if (key === "fullText") {
			const parsed = parseJsonRecord(child);
			if (parsed) collectPersistedSuccessRecords(parsed, out, depth + 1);
			continue;
		}
		if (["completed", "dispatched", "results", "structuredOutput", "outputJson"].includes(key)) {
			collectPersistedSuccessRecords(child, out, depth + 1);
		}
	}
}

function successfulPersistedMediaNodeIds(toolCalls: readonly unknown[]): string[] {
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

function terminalSuccessfulNodeIds(mediaResults: readonly unknown[]): string[] {
	const out = new Set<string>();
	for (const value of mediaResults) {
		if (!isRecord(value)) continue;
		const status = text(value.status).toLowerCase();
		if ((status !== "succeeded" && status !== "success") || value.pending === true) continue;
		const nodeId = text(value.nodeId);
		if (nodeId) out.add(nodeId);
	}
	return [...out];
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

export async function reconcilePublicChatDelivery(input: {
	upstreamAssets: readonly PublicChatResponseAsset[];
	streamMediaResults: readonly unknown[];
	toolCalls: readonly unknown[];
	flowId: string | null | undefined;
	readFlowGraph: (flowId: string) => Promise<unknown>;
}): Promise<PublicChatDeliveryAdapterResult> {
	const claimedSuccessfulNodeIds = terminalSuccessfulNodeIds([
		...input.streamMediaResults,
		...successfulPersistedMediaNodeIds(input.toolCalls).map((nodeId) => ({ nodeId, status: "succeeded" })),
	]);
	let flowGraph: unknown = null;
	if (text(input.flowId) && claimedSuccessfulNodeIds.length > 0) {
		try {
			flowGraph = await input.readFlowGraph(text(input.flowId));
		} catch {
			flowGraph = null;
		}
	}
	const graph = isRecord(flowGraph) ? flowGraph : null;
	const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
	const requested = new Set(claimedSuccessfulNodeIds);
	const persistedByNodeId = new Map<string, PublicChatResponseAsset>();
	for (const value of nodes) {
		if (!isRecord(value)) continue;
		const nodeId = text(value.id);
		if (!requested.has(nodeId)) continue;
		const asset = persistedAssetFromNode(value);
		if (asset) persistedByNodeId.set(nodeId, asset);
	}
	const persistedSuccessfulNodeIds = claimedSuccessfulNodeIds.filter((nodeId) => persistedByNodeId.has(nodeId));
	const unresolvedSuccessfulNodeIds = claimedSuccessfulNodeIds.filter((nodeId) => !persistedByNodeId.has(nodeId));
	const recovered = persistedSuccessfulNodeIds.map((nodeId) => persistedByNodeId.get(nodeId)!).filter(Boolean);
	const seen = new Set<string>();
	const assets = [...recovered, ...input.upstreamAssets].filter((asset) => {
		const identity = assetIdentity(asset);
		if (!identity || seen.has(identity)) return false;
		seen.add(identity);
		return true;
	});
	const recoveredPersistedMedia = persistedSuccessfulNodeIds.length > 0;
	return {
		assets,
		executionEvidence: { generatedAssets: recoveredPersistedMedia, wroteCanvas: recoveredPersistedMedia },
		mediaReconciliation: { claimedSuccessfulNodeIds, persistedSuccessfulNodeIds, unresolvedSuccessfulNodeIds },
	};
}

