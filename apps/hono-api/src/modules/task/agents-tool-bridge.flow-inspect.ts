import { z } from "zod";

export const CanvasFlowInspectArgsSchema = z
	.object({
		nodeIds: z.array(z.string().min(1)).max(128).optional(),
		nodeIdPrefixes: z.array(z.string().min(1)).max(16).optional(),
		includeDependencies: z.boolean().optional(),
		dependencyDirection: z.enum(["incoming", "outgoing", "both"]).optional(),
		limit: z.number().int().min(1).max(200).optional(),
	})
	.strict();

export type CanvasFlowInspectArgs = z.infer<typeof CanvasFlowInspectArgsSchema>;

type RecordValue = Record<string, unknown>;

const FLOW_INSPECTION_NODE_BUDGET_CHARS = 18_000;
const FLOW_INSPECTION_TOTAL_BUDGET_CHARS = 24_000;
const FLOW_INSPECTION_LABEL_MAX_CHARS = 160;

export type CanvasFlowNodeInspection = {
	nodeId: string;
	type: string | null;
	kind: string | null;
	label: string | null;
	status: string | null;
	pending: boolean;
	persisted: boolean | null;
	mediaKind: "image" | "video" | null;
	mediaAvailable: boolean;
	assetId: string | null;
	taskId: string | null;
	parentId: string | null;
	generationContextAvailable: boolean;
};

export type CanvasFlowInspectionResult = {
	flowId: string;
	updatedAt: string;
	totalNodeCount: number;
	matchedNodeCount: number;
	truncated: boolean;
	missingNodeIds: string[];
	nodes: CanvasFlowNodeInspection[];
	dependencies: Array<{
		sourceNodeId: string;
		targetNodeId: string;
	}>;
};

function isRecord(value: unknown): value is RecordValue {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoundedString(value: unknown, maxChars: number): string | null {
	const text = readString(value);
	if (!text) return null;
	return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function readResultUrl(value: unknown): string | null {
	if (!Array.isArray(value)) return null;
	for (const item of value) {
		if (!isRecord(item)) continue;
		const url = readString(item.url);
		if (url) return url;
	}
	return null;
}

function readMediaKind(kind: string | null): "image" | "video" | null {
	const normalized = String(kind || "").toLowerCase();
	if (normalized === "image" || normalized === "imageedit") return "image";
	if (normalized === "video" || normalized === "composevideo") return "video";
	return null;
}

function summarizeNode(node: RecordValue): CanvasFlowNodeInspection | null {
	const nodeId = readString(node.id);
	if (!nodeId) return null;
	const data = isRecord(node.data) ? node.data : {};
	const kind = readString(data.kind);
	const mediaKind = readMediaKind(kind);
	const status = readString(data.status);
	const imageAvailable = Boolean(readString(data.imageUrl) || readResultUrl(data.imageResults));
	const videoAvailable = Boolean(readString(data.videoUrl) || readResultUrl(data.videoResults));
	const mediaAvailable = mediaKind === "image" ? imageAvailable : mediaKind === "video" ? videoAvailable : false;
	const assetId = readString(data.assetId);
	const successful = status === "success" || status === "succeeded";
	const generationContext = isRecord(data.generationContext) ? data.generationContext : null;

	return {
		nodeId,
		type: readString(node.type),
		kind,
		label: readBoundedString(data.label, FLOW_INSPECTION_LABEL_MAX_CHARS),
		status,
		pending: status === "queued" || status === "running",
		persisted: mediaKind ? successful && Boolean(assetId || mediaAvailable) : null,
		mediaKind,
		mediaAvailable,
		assetId,
		taskId: readString(data.taskId) || readString(data.imageTaskId) || readString(data.videoTaskId),
		parentId: readString(node.parentId),
		generationContextAvailable: Boolean(
			readString(data.prompt) ||
			readString(generationContext?.requestedPrompt) ||
			readString(generationContext?.effectivePrompt),
		),
	};
}

function uniqueStrings(values: string[] | undefined): string[] {
	if (!values?.length) return [];
	return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function inspectCanvasFlowGraph(input: {
	flowId: string;
	updatedAt: string;
	graph: unknown;
	args: CanvasFlowInspectArgs;
}): CanvasFlowInspectionResult {
	const graph = isRecord(input.graph) ? input.graph : {};
	const rawNodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isRecord) : [];
	const summaries = rawNodes
		.map(summarizeNode)
		.filter((node): node is CanvasFlowNodeInspection => node !== null);
	const byId = new Map(summaries.map((node) => [node.nodeId, node]));
	const nodeIds = uniqueStrings(input.args.nodeIds);
	const prefixes = uniqueStrings(input.args.nodeIdPrefixes);
	const selected: CanvasFlowNodeInspection[] = [];
	const selectedIds = new Set<string>();
	const addSelected = (node: CanvasFlowNodeInspection | undefined) => {
		if (!node || selectedIds.has(node.nodeId)) return;
		selectedIds.add(node.nodeId);
		selected.push(node);
	};

	if (nodeIds.length === 0 && prefixes.length === 0) {
		summaries.forEach(addSelected);
	} else {
		nodeIds.forEach((nodeId) => addSelected(byId.get(nodeId)));
		for (const node of summaries) {
			if (prefixes.some((prefix) => node.nodeId.startsWith(prefix))) addSelected(node);
		}
	}

	const missingNodeIds = nodeIds.filter((nodeId) => !byId.has(nodeId));
	const limit = input.args.limit ?? 200;
	const countLimitedNodes = selected.slice(0, limit);
	const nodes: CanvasFlowNodeInspection[] = [];
	for (const node of countLimitedNodes) {
		const candidate = [...nodes, node];
		if (nodes.length > 0 && JSON.stringify(candidate).length > FLOW_INSPECTION_NODE_BUDGET_CHARS) break;
		nodes.push(node);
	}
	const returnedIds = new Set(nodes.map((node) => node.nodeId));
	const dependencyDirection = input.args.dependencyDirection ?? "both";
	const rawEdges = Array.isArray(graph.edges) ? graph.edges.filter(isRecord) : [];
	const matchingDependencies = input.args.includeDependencies === true
		? rawEdges.flatMap((edge) => {
				const sourceNodeId = readString(edge.source);
				const targetNodeId = readString(edge.target);
				if (!sourceNodeId || !targetNodeId) return [];
				const incoming = returnedIds.has(targetNodeId);
				const outgoing = returnedIds.has(sourceNodeId);
				const include = dependencyDirection === "incoming"
					? incoming
					: dependencyDirection === "outgoing"
						? outgoing
						: incoming || outgoing;
				return include ? [{ sourceNodeId, targetNodeId }] : [];
			})
		: [];
	const baseResult = {
		flowId: input.flowId,
		updatedAt: input.updatedAt,
		totalNodeCount: summaries.length,
		matchedNodeCount: selected.length,
		missingNodeIds,
		nodes,
	};
	const dependencies: CanvasFlowInspectionResult["dependencies"] = [];
	for (const dependency of matchingDependencies) {
		const candidate = [...dependencies, dependency];
		const projected = {
			...baseResult,
			truncated: true,
			dependencies: candidate,
		};
		if (dependencies.length > 0 && JSON.stringify(projected).length > FLOW_INSPECTION_TOTAL_BUDGET_CHARS) break;
		dependencies.push(dependency);
	}
	const truncated = selected.length > nodes.length || matchingDependencies.length > dependencies.length;

	return {
		...baseResult,
		truncated,
		dependencies,
	};
}
