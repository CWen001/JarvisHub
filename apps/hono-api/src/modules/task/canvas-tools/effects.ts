import { AppError } from "../../../middleware/error";
import type { ToolResultEffects } from "./types";

type FlowGraphLike = {
	nodes?: unknown[];
	edges?: unknown[];
};

type IdentifiedItem = {
	id: string;
	value: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readId(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function collectIdentifiedItems(items: readonly unknown[] | undefined): IdentifiedItem[] {
	if (!Array.isArray(items)) return [];
	const out: IdentifiedItem[] = [];
	for (const item of items) {
		if (!isRecord(item)) continue;
		const id = readId(item.id);
		if (!id) continue;
		out.push({ id, value: item });
	}
	return out;
}

function mapById(items: readonly IdentifiedItem[]): Map<string, unknown> {
	return new Map(items.map((item) => [item.id, item.value]));
}

function compareJson(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function nonEmpty(values: string[]): string[] | undefined {
	return values.length > 0 ? values : undefined;
}

export function deriveFlowGraphEffects(input: {
	before: FlowGraphLike;
	after: FlowGraphLike;
}): ToolResultEffects {
	const beforeNodes = collectIdentifiedItems(input.before.nodes);
	const afterNodes = collectIdentifiedItems(input.after.nodes);
	const beforeEdges = collectIdentifiedItems(input.before.edges);
	const afterEdges = collectIdentifiedItems(input.after.edges);
	const beforeNodeById = mapById(beforeNodes);
	const afterNodeById = mapById(afterNodes);
	const beforeEdgeById = mapById(beforeEdges);
	const afterEdgeById = mapById(afterEdges);

	const createdNodeIds = afterNodes
		.map((item) => item.id)
		.filter((id) => !beforeNodeById.has(id));
	const deletedNodeIds = beforeNodes
		.map((item) => item.id)
		.filter((id) => !afterNodeById.has(id));
	const updatedNodeIds = afterNodes
		.filter((item) => beforeNodeById.has(item.id) && !compareJson(beforeNodeById.get(item.id), item.value))
		.map((item) => item.id);
	const createdEdgeIds = afterEdges
		.map((item) => item.id)
		.filter((id) => !beforeEdgeById.has(id));
	const deletedEdgeIds = beforeEdges
		.map((item) => item.id)
		.filter((id) => !afterEdgeById.has(id));
	const updatedEdgeIds = afterEdges
		.filter((item) => beforeEdgeById.has(item.id) && !compareJson(beforeEdgeById.get(item.id), item.value))
		.map((item) => item.id);

	return {
		...(nonEmpty(createdNodeIds) ? { createdNodeIds } : {}),
		...(nonEmpty(updatedNodeIds) ? { updatedNodeIds } : {}),
		...(nonEmpty(deletedNodeIds) ? { deletedNodeIds } : {}),
		...(nonEmpty(createdEdgeIds) ? { createdEdgeIds } : {}),
		...(nonEmpty(updatedEdgeIds) ? { updatedEdgeIds } : {}),
		...(nonEmpty(deletedEdgeIds) ? { deletedEdgeIds } : {}),
		wroteCanvas: true,
	};
}

export function mergeToolResultEffects(
	left: ToolResultEffects,
	right: ToolResultEffects,
): ToolResultEffects {
	return {
		...left,
		...right,
		wroteCanvas: left.wroteCanvas === true || right.wroteCanvas === true,
	};
}

export function assertNonEmptyCanvasDelete(input: { nodeIds: string[]; edgeIds: string[] }): void {
	if (input.nodeIds.length > 0 || input.edgeIds.length > 0) return;
	throw new AppError("canvas_delete_canvas_items requires nodeIds or edgeIds", {
		status: 400,
		code: "invalid_tool_args",
	});
}
