import { randomUUID } from "node:crypto";
import {
	PublicFlowCreateNodeSchema,
	type PublicFlowGraph,
	type PublicFlowPatchRequestDto,
} from "./flow.public.schemas";
import {
	getPublicFlowNodeHandles,
	getPublicFlowTaskNodeCoreType,
	listPublicFlowNodeHandles,
} from "./flow.node-protocol";
import { autoWireReferenceEdges } from "./flow.reference-autowire";
import { AppError } from "../../middleware/error";
import { readSelectedWebHeroStyleReference, type WebHeroPatchAuthority } from "./flow.webhero-style-reference";
import { WEBHERO_CODE_INPUT_PHASES, hasMeaningfulWebHeroEvidence } from "./flow.webhero-evidence-phases";
import {
	reconcilePptMasterNodeIdentities,
	type PptMasterWriteAuthority,
} from "../task/agents-tool-bridge.ppt-master-node-create";
// Shared, dependency-free text estimator so the backend sizes a text node the
// same way the browser renders it. Relative import (not a bare specifier):
// esbuild bundles it inline; packages:'external' would leave a bare specifier
// pointing at a .ts entry that Node cannot execute at runtime.
import { estimateTextNodeSize } from "../../../../../packages/canvas-layout/src/textNodeSize";
import { assignIncrementalPositions } from "../../../../../packages/canvas-layout/src/incrementalPlacement";
import { LAYOUT_GAP_Y, LAYOUT_RANK_GAP_X } from "../../../../../packages/canvas-layout/src/balancedDagLayout";
import {
	readCanvasHarnessOrigin,
	type CanvasHarnessOrigin,
} from "../../../../../packages/canvas-layout/src/harnessOrigin";

type NodeLike = Record<string, unknown> & { id?: unknown; data?: unknown };
type EdgeLike = Record<string, unknown> & { id?: unknown; source?: unknown; target?: unknown };

type WebHeroRewindPhase =
	| "preview_generation"
	| "preview_visual_spec"
	| "asset_inventory"
	| "asset_resolution"
	| "section_codegen";

type WebHeroRewindAudit = {
	nodeId: string;
	rewindPhase: WebHeroRewindPhase;
	clearedFields: string[];
};

type ApplyPatchResult = {
	data: PublicFlowGraph;
	stats: {
		deletedNodes: number;
		deletedEdges: number;
		createdNodes: number;
		createdEdges: number;
		patchedNodes: number;
		appendedArrays: number;
		webHeroRewinds: WebHeroRewindAudit[];
	};
	idMap?: {
		nodes?: Record<string, string>;
		edges?: Record<string, string>;
	};
};

const GROUP_PADDING = 8;
export const GROUP_MIN_WIDTH = 160;
export const GROUP_MIN_HEIGHT = 90;
const GROUP_GAP_X = 12;
const GROUP_GAP_Y = 12;
const TOPLEVEL_COLLISION_GAP = 24;
const TOPLEVEL_COLLISION_STEP = 32;
const TOPLEVEL_COLLISION_MAX_ITER = 200;
const TOPOLOGY_GAP_X = TOPLEVEL_COLLISION_GAP;
const TOPOLOGY_GAP_Y = TOPLEVEL_COLLISION_GAP;
const SAME_COLUMN_THRESHOLD = 120;
export const CURRENT_LAYOUT_VERSION = 2;
const LAYOUT_EXCLUDED_GROUP_SOURCES = new Set<string>();

function asObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function readId(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readNonNegativeInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

function omitCanvasOrigin(value: unknown): Record<string, unknown> {
	const data = asObject(value) || {};
	const { canvasOrigin: _canvasOrigin, ...rest } = data;
	return rest;
}

function resolveCanvasCreationOrigin(
	nodes: NodeLike[],
	value: unknown,
): CanvasHarnessOrigin | null {
	const input = asObject(value);
	if (!input) return null;
	const conversationTurnId = readId(input.publicChatRunId);
	const agentRunId = readId(input.runId);
	const agentId = readId(input.agentId);
	const parentToolCallId = readId(input.parentToolCallId);
	const toolCallId = readId(input.toolCallId);
	const llmTurnIndex = readNonNegativeInteger(input.llmTurnIndex);
	const executionBatchIndex = readNonNegativeInteger(input.executionBatchIndex);
	const executionBatchCallIndex = readNonNegativeInteger(input.executionBatchCallIndex);
	const executionBatchCallCount = readNonNegativeInteger(input.executionBatchCallCount);
	const toolCallIndex = readNonNegativeInteger(input.toolCallIndex);
	if (
		!conversationTurnId
		|| !agentRunId
		|| !agentId
		|| !toolCallId
		|| llmTurnIndex === null
		|| executionBatchIndex === null
		|| executionBatchCallIndex === null
		|| executionBatchCallCount === null
		|| executionBatchCallCount === 0
		|| executionBatchCallIndex >= executionBatchCallCount
		|| toolCallIndex === null
	) {
		return null;
	}

	let maxTurnIndex = -1;
	const matchingTurnIndices: number[] = [];
	for (const node of nodes) {
		const existing = readCanvasHarnessOrigin(asObject(node.data)?.canvasOrigin);
		if (!existing) continue;
		maxTurnIndex = Math.max(maxTurnIndex, existing.conversationTurnIndex);
		if (existing.conversationTurnId === conversationTurnId) {
			matchingTurnIndices.push(existing.conversationTurnIndex);
		}
	}
	const conversationTurnIndex = matchingTurnIndices.length > 0
		? Math.min(...matchingTurnIndices)
		: maxTurnIndex + 1;

	return readCanvasHarnessOrigin({
		conversationTurnId,
		conversationTurnIndex,
		agentRunId,
		agentId,
		...(parentToolCallId ? { parentToolCallId } : {}),
		llmTurnIndex,
		executionBatchIndex,
		executionBatchCallIndex,
		executionBatchCallCount,
		toolCallIndex,
		toolCallId,
		...(input.schemaVersion === 2 ? {
			schemaVersion: 2,
			invocationPath: input.invocationPath,
			layoutStagePath: input.layoutStagePath,
			layoutItemPath: input.layoutItemPath,
		} : {}),
	});
}

function readFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumeric(value: unknown): number | null {
	const direct = readFiniteNumber(value);
	if (direct !== null) return direct;
	if (typeof value !== "string") return null;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function readNodePosition(
	node: NodeLike | null | undefined,
): { x: number; y: number } | null {
	if (!node) return null;
	const record = asObject(node.position);
	const x = readFiniteNumber(record?.x);
	const y = readFiniteNumber(record?.y);
	if (x === null || y === null) return null;
	return { x, y };
}

function readGroupSize(
	node: NodeLike | null | undefined,
): { width: number; height: number } | null {
	if (!node || readId(node.type) !== "groupNode") return null;
	const style = asObject(node.style);
	const width = readNumeric(style?.width);
	const height = readNumeric(style?.height);
	if (width === null || height === null) return null;
	return { width, height };
}

function readNodeParentId(node: NodeLike | null | undefined): string {
	if (!node) return "";
	return readId((node as Record<string, unknown>).parentId);
}

function isGroupNode(node: NodeLike | null | undefined): boolean {
	return readId(node?.type) === "groupNode";
}

// 与 apps/web/src/canvas/nodeSizes.ts 保持一致：image / video / storyboard 共享同一基准。
const MEDIA_BASE_W = 320;
const MEDIA_MIN_H = 180;
const MEDIA_MAX_H = 760;
const MEDIA_MIN_ASPECT = 9 / 16;
const MEDIA_MAX_ASPECT = 16 / 9;
// VideoContent chrome (header/actions/padding/gaps); matches MEDIA_VIDEO_CHROME_H
// in apps/web/src/canvas/nodeSizes.ts. Added to a video's height before clamping
// so backend coordinates match the frontend's rendered video box.
const MEDIA_VIDEO_CHROME_H = 84;

function parseAspectRatio(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*[:x×\/]\s*(\d+(?:\.\d+)?)$/i);
	if (match) {
		const w = Number.parseFloat(match[1]);
		const h = Number.parseFloat(match[2]);
		if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return w / h;
		return null;
	}
	const num = Number.parseFloat(trimmed);
	return Number.isFinite(num) && num > 0 ? num : null;
}

function readMediaAspectRatio(data: Record<string, unknown>): number | null {
	const candidates = [data.aspectRatio, data.aspect, data.size, data.imageSize];
	for (const candidate of candidates) {
		const ratio = parseAspectRatio(candidate);
		if (ratio !== null) return ratio;
	}
	return null;
}

function computeMediaFallbackHeight(width: number, aspectRatio: number | null, chromeH = 0): number {
	if (aspectRatio === null) return width;
	const clamped = Math.max(MEDIA_MIN_ASPECT, Math.min(MEDIA_MAX_ASPECT, aspectRatio));
	const computed = Math.round(width / clamped) + chromeH;
	return Math.max(MEDIA_MIN_H, Math.min(MEDIA_MAX_H, computed));
}

function fallbackNodeSize(
	node: NodeLike,
): { width: number; height: number } {
	if (readId(node.type) === "taskNode") {
		const data = asObject(node.data) || {};
		const kind = readId(data.kind);
		const kindLower = kind.toLowerCase();
		const coreType = getPublicFlowTaskNodeCoreType(kind || null);
		if (kindLower === "imageedit") return { width: 320, height: 220 };
		if (kindLower === "workflowinput" || kindLower === "workflowoutput") return { width: 260, height: 140 };
		if (kindLower === "reference" || kindLower === "character") return { width: 320, height: 180 };
		if (coreType === "text") {
			// Content-aware text sizing (shared with the frontend) so long / CJK
			// text nodes reserve their true height instead of a flat 360. Empty or
			// short text still resolves to the 460×360 default.
			const size = estimateTextNodeSize(data);
			return { width: size.w, height: size.h };
		}
		if (coreType === "image") {
			const aspect = readMediaAspectRatio(data);
			return { width: MEDIA_BASE_W, height: computeMediaFallbackHeight(MEDIA_BASE_W, aspect) };
		}
		if (coreType === "video") {
			const aspect = readMediaAspectRatio(data);
			return { width: MEDIA_BASE_W, height: computeMediaFallbackHeight(MEDIA_BASE_W, aspect, MEDIA_VIDEO_CHROME_H) };
		}
		return { width: 420, height: 240 };
	}
	if (readId(node.type) === "ioNode") return { width: 104, height: 36 };
	if (isGroupNode(node)) return { width: 240, height: 160 };
	return { width: 220, height: 120 };
}

function readNodeSize(
	node: NodeLike,
): { width: number; height: number } {
	const fallback = fallbackNodeSize(node);
	const data = asObject(node.data);
	const style = asObject(node.style);
	const kind = readId(data?.kind);
	const kindLower = kind.toLowerCase();
	const isOrdinaryTextNode =
		readId(node.type) === "taskNode" &&
		getPublicFlowTaskNodeCoreType(kind || null) === "text" &&
		kindLower !== "webhero" &&
		kindLower !== "pptdeck" &&
		!(typeof data?.webPageAssetBoardSection === "string" && typeof data.webPageAssetBoardForNodeId === "string") &&
		!(data?.webPageAssetBoardDisplay === true && typeof data.webPageAssetBoardForNodeId === "string") &&
		!(data?.webPageSectionDraftsDisplay === true && typeof data.webPageSectionDraftsForNodeId === "string");
	if (isOrdinaryTextNode) {
		const size = estimateTextNodeSize(data || {}, {
			w:
				readNumeric((node as Record<string, unknown>).width) ??
				readNumeric(style?.width) ??
				readNumeric(data?.nodeWidth) ??
				fallback.width,
			h:
				readNumeric((node as Record<string, unknown>).height) ??
				readNumeric(style?.height) ??
				readNumeric(data?.nodeHeight) ??
				fallback.height,
		});
		return { width: size.w, height: size.h };
	}
	const width =
		readNumeric((node as Record<string, unknown>).width) ??
		readNumeric(data?.nodeWidth) ??
		readNumeric(style?.width) ??
		fallback.width;
	const height =
		readNumeric((node as Record<string, unknown>).height) ??
		readNumeric(data?.nodeHeight) ??
		readNumeric(style?.height) ??
		fallback.height;
	return { width, height };
}

function shouldExcludeNodeFromGroupArrange(node: NodeLike): boolean {
	if (isGroupNode(node)) return true;
	const data = asObject(node.data) || {};
	const source = readId(data.source);
	return Boolean(source) && LAYOUT_EXCLUDED_GROUP_SOURCES.has(source);
}

function shouldPreserveExplicitGroupLayout(node: NodeLike): boolean {
	if (!isGroupNode(node)) return false;
	const data = asObject(node.data) || {};
	return data.preserveExplicitLayout === true;
}

function rebuildNodeById(nodes: readonly NodeLike[]): Map<string, NodeLike> {
	const nodeById = new Map<string, NodeLike>();
	for (const node of nodes) {
		const id = readId(node.id);
		if (!id) continue;
		nodeById.set(id, node);
	}
	return nodeById;
}

function orderNodesParentFirst(nodes: readonly NodeLike[]): NodeLike[] {
	const nodeById = rebuildNodeById(nodes);
	const visited = new Set<string>();
	const visiting = new Set<string>();
	const ordered: NodeLike[] = [];

	const visit = (node: NodeLike): void => {
		const id = readId(node.id);
		if (!id) {
			ordered.push(node);
			return;
		}
		if (visited.has(id)) return;
		if (visiting.has(id)) {
			visiting.delete(id);
			visited.add(id);
			ordered.push(node);
			return;
		}
		visiting.add(id);
		const parentId = readNodeParentId(node);
		if (parentId && parentId !== id) {
			const parent = nodeById.get(parentId);
			if (parent) visit(parent);
		}
		visiting.delete(id);
		if (visited.has(id)) return;
		visited.add(id);
		ordered.push(node);
	};

	for (const node of nodes) visit(node);
	return ordered;
}

function replaceNodePositions(options: {
	nodes: readonly NodeLike[];
	positionById: ReadonlyMap<string, { x: number; y: number }>;
}): NodeLike[] {
	if (options.positionById.size === 0) return [...options.nodes];
	return options.nodes.map((node) => {
		const id = readId(node.id);
		if (!id) return node;
		const position = options.positionById.get(id);
		if (!position) return node;
		return {
			...node,
			position,
		};
	});
}

function updateSingleGroupFrame(options: {
	nodes: readonly NodeLike[];
	groupId: string;
}): NodeLike[] {
	const nodeById = rebuildNodeById(options.nodes);
	const group = nodeById.get(options.groupId);
	if (!group || !isGroupNode(group)) return [...options.nodes];

	const children = options.nodes.filter(
		(node) => readNodeParentId(node) === options.groupId,
	);
	if (children.length === 0) return [...options.nodes];

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const child of children) {
		const position = readNodePosition(child);
		if (!position) continue;
		const size = readNodeSize(child);
		minX = Math.min(minX, position.x);
		minY = Math.min(minY, position.y);
		maxX = Math.max(maxX, position.x + size.width);
		maxY = Math.max(maxY, position.y + size.height);
	}

	if (
		!Number.isFinite(minX) ||
		!Number.isFinite(minY) ||
		!Number.isFinite(maxX) ||
		!Number.isFinite(maxY)
	) {
		return [...options.nodes];
	}

	const groupPosition = readNodePosition(group) || { x: 0, y: 0 };
	const desiredPosition = {
		x: groupPosition.x + (minX - GROUP_PADDING),
		y: groupPosition.y + (minY - GROUP_PADDING),
	};
	const bboxWidth = Math.max(
		GROUP_MIN_WIDTH,
		(maxX - minX) + GROUP_PADDING * 2,
	);
	const bboxHeight = Math.max(
		GROUP_MIN_HEIGHT,
		(maxY - minY) + GROUP_PADDING * 2,
	);
	const currentSize = readNodeSize(group);
	// `data.manualSize === true` means the user manually resized this group.
	// Recompute is then grow-only: keep the user's larger size, but always
	// expand if children no longer fit.
	const groupData = asObject(group.data) || {};
	const manualSize = groupData.manualSize === true;
	const desiredSize = manualSize
		? {
			width: Math.max(bboxWidth, currentSize.width),
			height: Math.max(bboxHeight, currentSize.height),
		}
		: { width: bboxWidth, height: bboxHeight };
	const dx = desiredPosition.x - groupPosition.x;
	const dy = desiredPosition.y - groupPosition.y;
	const positionChanged = Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1;
	const sizeChanged =
		Math.abs(desiredSize.width - currentSize.width) > 0.1 ||
		Math.abs(desiredSize.height - currentSize.height) > 0.1;
	if (!positionChanged && !sizeChanged) return [...options.nodes];

	return orderNodesParentFirst(
		options.nodes.map((node) => {
			const id = readId(node.id);
			if (id === options.groupId) {
				const style = asObject(node.style) || {};
				return {
					...node,
					position: desiredPosition,
					width: desiredSize.width,
					height: desiredSize.height,
					style: {
						...style,
						width: desiredSize.width,
						height: desiredSize.height,
					},
				};
			}
			if (!positionChanged || readNodeParentId(node) !== options.groupId) return node;
			const position = readNodePosition(node) || { x: 0, y: 0 };
			return {
				...node,
				position: {
					x: position.x - dx,
					y: position.y - dy,
				},
			};
		}),
	);
}

function compactSingleGroup(options: {
	nodes: readonly NodeLike[];
	groupId: string;
}): NodeLike[] {
	const group = options.nodes.find((node) => readId(node.id) === options.groupId);
	if (!group || !isGroupNode(group)) return [...options.nodes];
	if (shouldPreserveExplicitGroupLayout(group)) return [...options.nodes];

	const allChildren = options.nodes.filter(
		(node) => readNodeParentId(node) === options.groupId,
	);
	if (allChildren.length === 0) return [...options.nodes];

	const arrangeableChildren = allChildren.filter(
		(node) => !shouldExcludeNodeFromGroupArrange(node),
	);

	let nextNodes = [...options.nodes];
	if (arrangeableChildren.length > 0) {
		const colCount = Math.max(
			1,
			Math.ceil(Math.sqrt(arrangeableChildren.length)),
		);
		const rowCount = Math.max(
			1,
			Math.ceil(arrangeableChildren.length / colCount),
		);
		const colWidths = Array.from({ length: colCount }, () => 0);
		const rowHeights = Array.from({ length: rowCount }, () => 0);

		arrangeableChildren.forEach((node, index) => {
			const row = Math.floor(index / colCount);
			const col = index % colCount;
			const size = readNodeSize(node);
			colWidths[col] = Math.max(colWidths[col] || 0, size.width);
			rowHeights[row] = Math.max(rowHeights[row] || 0, size.height);
		});

		const colOffsets = Array.from({ length: colCount }, () => 0);
		const rowOffsets = Array.from({ length: rowCount }, () => 0);

		let cursorX = GROUP_PADDING;
		for (let col = 0; col < colCount; col += 1) {
			colOffsets[col] = cursorX;
			cursorX += (colWidths[col] || 0) + GROUP_GAP_X;
		}

		let cursorY = GROUP_PADDING;
		for (let row = 0; row < rowCount; row += 1) {
			rowOffsets[row] = cursorY;
			cursorY += (rowHeights[row] || 0) + GROUP_GAP_Y;
		}

		const positionById = new Map<string, { x: number; y: number }>();
		arrangeableChildren.forEach((node, index) => {
			const row = Math.floor(index / colCount);
			const col = index % colCount;
			positionById.set(readId(node.id), {
				x: colOffsets[col] ?? GROUP_PADDING,
				y: rowOffsets[row] ?? GROUP_PADDING,
			});
		});

		nextNodes = replaceNodePositions({
			nodes: nextNodes,
			positionById,
		});
	}

	return updateSingleGroupFrame({
		nodes: nextNodes,
		groupId: options.groupId,
	});
}

function resolveTopLevelCollisions(options: {
	nodes: readonly NodeLike[];
	movableTopLevelIds: ReadonlySet<string>;
}): NodeLike[] {
	if (options.movableTopLevelIds.size === 0) return [...options.nodes];
	type Box = { id: string; x: number; y: number; width: number; height: number };
	const fixedBoxes: Box[] = [];
	const movableBoxes: Box[] = [];
	for (const node of options.nodes) {
		const id = readId(node.id);
		if (!id) continue;
		if (readNodeParentId(node)) continue;
		const pos = readNodePosition(node);
		if (!pos) continue;
		const size = readNodeSize(node);
		const box: Box = { id, x: pos.x, y: pos.y, width: size.width, height: size.height };
		if (options.movableTopLevelIds.has(id)) movableBoxes.push(box);
		else fixedBoxes.push(box);
	}
	if (movableBoxes.length === 0) return [...options.nodes];

	const collides = (a: Box, b: Box): boolean => {
		return !(
			a.x + a.width + TOPLEVEL_COLLISION_GAP <= b.x ||
			b.x + b.width + TOPLEVEL_COLLISION_GAP <= a.x ||
			a.y + a.height + TOPLEVEL_COLLISION_GAP <= b.y ||
			b.y + b.height + TOPLEVEL_COLLISION_GAP <= a.y
		);
	};

	const placed: Box[] = [...fixedBoxes];
	const adjustedPositions = new Map<string, { x: number; y: number }>();
	for (const box of movableBoxes) {
		let iter = 0;
		let rightAttempts = 0;
		const startX = box.x;
		while (iter < TOPLEVEL_COLLISION_MAX_ITER) {
			const hit = placed.find((other) => collides(box, other));
			if (!hit) break;
			rightAttempts += 1;
			if (rightAttempts <= 3) {
				box.x = hit.x + hit.width + TOPLEVEL_COLLISION_GAP + TOPLEVEL_COLLISION_STEP;
			} else {
				box.x = startX;
				box.y = hit.y + hit.height + TOPLEVEL_COLLISION_GAP + TOPLEVEL_COLLISION_STEP;
				rightAttempts = 0;
			}
			iter += 1;
		}
		placed.push(box);
		adjustedPositions.set(box.id, { x: box.x, y: box.y });
	}

	return replaceNodePositions({ nodes: options.nodes, positionById: adjustedPositions });
}

function collectAffectedGroupIds(options: {
	createdNodeIds: readonly string[];
	nodeById: ReadonlyMap<string, NodeLike>;
}): string[] {
	const groupIds = new Set<string>();
	for (const createdNodeId of options.createdNodeIds) {
		const node = options.nodeById.get(createdNodeId);
		if (!node) continue;
		const nodeId = readId(node.id);
		if (isGroupNode(node) && nodeId) groupIds.add(nodeId);

		let parentId = readNodeParentId(node);
		while (parentId) {
			const parent = options.nodeById.get(parentId);
			if (!parent || !isGroupNode(parent)) break;
			groupIds.add(parentId);
			parentId = readNodeParentId(parent);
		}
	}
	return Array.from(groupIds);
}

function sortGroupIdsByDepthDesc(
	groupIds: readonly string[],
	nodeById: ReadonlyMap<string, NodeLike>,
): string[] {
	const depthCache = new Map<string, number>();
	const computeDepth = (groupId: string): number => {
		if (depthCache.has(groupId)) return depthCache.get(groupId) || 0;
		const node = nodeById.get(groupId);
		const parentId = readNodeParentId(node);
		const depth =
			parentId && nodeById.has(parentId) && isGroupNode(nodeById.get(parentId))
				? computeDepth(parentId) + 1
				: 0;
		depthCache.set(groupId, depth);
		return depth;
	};

	return [...groupIds].sort((left, right) => {
		const depthDelta = computeDepth(right) - computeDepth(left);
		if (depthDelta !== 0) return depthDelta;
		return left.localeCompare(right);
	});
}

function getNodeAbsolutePosition(
	node: NodeLike,
	nodeById: Map<string, NodeLike>,
	visiting: Set<string> = new Set(),
): { x: number; y: number } | null {
	const id = readId(node.id);
	if (id) {
		if (visiting.has(id)) return readNodePosition(node);
		visiting.add(id);
	}
	const base = readNodePosition(node);
	if (!base) return null;
	const parentId = readId((node as Record<string, unknown>).parentId);
	if (!parentId || parentId === id) return base;
	const parent = nodeById.get(parentId);
	if (!parent) return base;
	const parentAbs = getNodeAbsolutePosition(parent, nodeById, visiting);
	if (!parentAbs) return base;
	return {
		x: parentAbs.x + base.x,
		y: parentAbs.y + base.y,
	};
}

function shouldTreatChildPositionAsAbsolute(input: {
	parentNode: NodeLike;
	parentAbsPosition: { x: number; y: number };
	childPosition: { x: number; y: number };
}): boolean {
	const parentSize = readGroupSize(input.parentNode);
	if (!parentSize) return true;
	const margin = 24;
	const withinRelativeBounds =
		input.childPosition.x >= -margin &&
		input.childPosition.y >= -margin &&
		input.childPosition.x <= parentSize.width + margin &&
		input.childPosition.y <= parentSize.height + margin;
	if (withinRelativeBounds) return false;
	const normalized = {
		x: input.childPosition.x - input.parentAbsPosition.x,
		y: input.childPosition.y - input.parentAbsPosition.y,
	};
	const withinNormalizedBounds =
		normalized.x >= -margin &&
		normalized.y >= -margin &&
		normalized.x <= parentSize.width + margin &&
		normalized.y <= parentSize.height + margin;
	return withinNormalizedBounds;
}

function normalizeCreateNodePositionRelativeToParent(
	node: NodeLike,
	nodeById: Map<string, NodeLike>,
): NodeLike {
	const parentId = readId((node as Record<string, unknown>).parentId);
	if (!parentId) return node;
	const parent = nodeById.get(parentId);
	if (!parent || readId(parent.type) !== "groupNode") return node;
	const childPosition = readNodePosition(node);
	const parentAbsPosition = getNodeAbsolutePosition(parent, nodeById);
	if (!childPosition || !parentAbsPosition) return node;
	if (
		!shouldTreatChildPositionAsAbsolute({
			parentNode: parent,
			parentAbsPosition,
			childPosition,
		})
	) {
		return node;
	}
	return {
		...node,
		position: {
			x: childPosition.x - parentAbsPosition.x,
			y: childPosition.y - parentAbsPosition.y,
		},
	};
}

function computeGroupNestingDepth(
	groupId: string,
	nodeById: ReadonlyMap<string, NodeLike>,
): number {
	let depth = 0;
	let cursorId: string | undefined = groupId;
	const visited = new Set<string>();
	while (cursorId) {
		if (visited.has(cursorId)) return depth;
		visited.add(cursorId);
		const node = nodeById.get(cursorId);
		const parentId = readNodeParentId(node);
		if (!parentId) return depth;
		const parent = nodeById.get(parentId);
		if (!parent || !isGroupNode(parent)) return depth;
		depth += 1;
		cursorId = parentId;
		if (depth > 64) return depth;
	}
	return depth;
}

function recomputeAffectedGroupFrames(options: {
	nodes: readonly NodeLike[];
	groupIdsDepthDesc: readonly string[];
}): NodeLike[] {
	let nodes: NodeLike[] = [...options.nodes];
	for (const groupId of options.groupIdsDepthDesc) {
		nodes = updateSingleGroupFrame({ nodes, groupId });
	}
	return nodes;
}

function collectTopLevelAncestorIds(options: {
	nodeIds: Iterable<string>;
	nodeById: ReadonlyMap<string, NodeLike>;
}): Set<string> {
	const topLevelIds = new Set<string>();
	for (const nodeId of options.nodeIds) {
		let node = options.nodeById.get(nodeId);
		while (node) {
			const parentId = readNodeParentId(node);
			if (!parentId) {
				const topLevelId = readId(node.id);
				if (topLevelId) topLevelIds.add(topLevelId);
				break;
			}
			node = options.nodeById.get(parentId);
		}
	}
	return topLevelIds;
}

function settleTopLevelLayoutAfterGeometryChange(options: {
	nodes: readonly NodeLike[];
	movableNodeIds: Iterable<string>;
	affectedGroupIds: readonly string[];
	baselineNodeById: ReadonlyMap<string, NodeLike> | null;
}): NodeLike[] {
	let nextNodes = [...options.nodes];
	if (options.affectedGroupIds.length > 0) {
		const nodeById = rebuildNodeById(nextNodes);
		const sortedGroupIds = sortGroupIdsByDepthDesc(
			options.affectedGroupIds,
			nodeById,
		);
		nextNodes = recomputeAffectedGroupFrames({
			nodes: nextNodes,
			groupIdsDepthDesc: sortedGroupIds,
		});
	}

	const finalNodeById = rebuildNodeById(nextNodes);
	const candidateTopLevelIds = collectTopLevelAncestorIds({
		nodeIds: options.movableNodeIds,
		nodeById: finalNodeById,
	});
	const movableTopLevelIds = new Set<string>();
	for (const topLevelId of candidateTopLevelIds) {
		const finalNode = finalNodeById.get(topLevelId);
		const baselineNode = options.baselineNodeById?.get(topLevelId);
		if (!finalNode || !baselineNode) {
			movableTopLevelIds.add(topLevelId);
			continue;
		}
		const finalPosition = readNodePosition(finalNode);
		const baselinePosition = readNodePosition(baselineNode);
		const finalSize = readNodeSize(finalNode);
		const baselineSize = readNodeSize(baselineNode);
		if (
			finalPosition?.x !== baselinePosition?.x ||
			finalPosition?.y !== baselinePosition?.y ||
			finalSize.width !== baselineSize.width ||
			finalSize.height !== baselineSize.height
		) {
			movableTopLevelIds.add(topLevelId);
		}
	}
	return resolveTopLevelCollisions({ nodes: nextNodes, movableTopLevelIds });
}

function buildGroupAncestorChain(
	nodeId: string,
	nodeById: ReadonlyMap<string, NodeLike>,
): string[] {
	const chain: string[] = [];
	const visited = new Set<string>();
	let cursor: string | undefined = nodeId;
	while (cursor && !visited.has(cursor)) {
		visited.add(cursor);
		chain.push(cursor);
		const node = nodeById.get(cursor);
		if (!node) break;
		const parentId = readNodeParentId(node);
		if (!parentId) break;
		const parent = nodeById.get(parentId);
		if (!parent || !isGroupNode(parent)) break;
		cursor = parentId;
	}
	return chain;
}

function findTopologyMovedSubject(
	sourceId: string,
	targetId: string,
	nodeById: ReadonlyMap<string, NodeLike>,
): string {
	const sChain = buildGroupAncestorChain(sourceId, nodeById);
	const tChain = buildGroupAncestorChain(targetId, nodeById);
	const sChainSet = new Set(sChain);
	for (let i = 0; i < tChain.length; i += 1) {
		if (sChainSet.has(tChain[i])) {
			return i === 0 ? tChain[0] : tChain[i - 1];
		}
	}
	return tChain[tChain.length - 1] ?? targetId;
}

function tarjanStronglyConnectedComponents(
	nodeIds: readonly string[],
	outgoing: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
	const indexMap = new Map<string, number>();
	const lowlink = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	let nextIndex = 0;
	const sccs: string[][] = [];

	type Frame = { node: string; iter: Iterator<string>; lastChild: string | null };
	for (const root of nodeIds) {
		if (indexMap.has(root)) continue;
		const frames: Frame[] = [];
		const startIter = (outgoing.get(root) || new Set()).values();
		indexMap.set(root, nextIndex);
		lowlink.set(root, nextIndex);
		nextIndex += 1;
		stack.push(root);
		onStack.add(root);
		frames.push({ node: root, iter: startIter, lastChild: null });

		while (frames.length > 0) {
			const top = frames[frames.length - 1];
			if (top.lastChild !== null) {
				lowlink.set(
					top.node,
					Math.min(lowlink.get(top.node) ?? 0, lowlink.get(top.lastChild) ?? 0),
				);
				top.lastChild = null;
			}
			const step = top.iter.next();
			if (step.done) {
				if (lowlink.get(top.node) === indexMap.get(top.node)) {
					const scc: string[] = [];
					while (stack.length > 0) {
						const w = stack.pop() as string;
						onStack.delete(w);
						scc.push(w);
						if (w === top.node) break;
					}
					sccs.push(scc);
				}
				frames.pop();
				if (frames.length > 0) {
					frames[frames.length - 1].lastChild = top.node;
				}
				continue;
			}
			const child = step.value;
			if (!indexMap.has(child)) {
				indexMap.set(child, nextIndex);
				lowlink.set(child, nextIndex);
				nextIndex += 1;
				stack.push(child);
				onStack.add(child);
				const childIter = (outgoing.get(child) || new Set()).values();
				frames.push({ node: child, iter: childIter, lastChild: null });
			} else if (onStack.has(child)) {
				lowlink.set(
					top.node,
					Math.min(lowlink.get(top.node) ?? 0, indexMap.get(child) ?? 0),
				);
			}
		}
	}
	return sccs;
}

function correctTopologyDirection(options: {
	nodes: readonly NodeLike[];
	edges: readonly unknown[];
	touchedNodeIds: ReadonlySet<string>;
}): { nodes: NodeLike[]; movedSubjectIds: Set<string> } {
	const movedSubjectIds = new Set<string>();
	if (options.touchedNodeIds.size === 0) {
		return { nodes: [...options.nodes], movedSubjectIds };
	}

	const nodeIdSet = new Set<string>();
	for (const node of options.nodes) {
		const id = readId(node.id);
		if (id) nodeIdSet.add(id);
	}

	type EdgePair = { source: string; target: string };
	const validPairs: EdgePair[] = [];
	const outgoing = new Map<string, Set<string>>();
	const undirected = new Map<string, Set<string>>();
	for (const raw of options.edges) {
		const obj = asObject(raw) as EdgeLike | null;
		if (!obj) continue;
		const source = readId(obj.source);
		const target = readId(obj.target);
		if (!source || !target) continue;
		if (source === target) continue;
		if (!nodeIdSet.has(source) || !nodeIdSet.has(target)) continue;
		const layoutWeight = readFiniteNumber(asObject(obj.data)?.layoutWeight);
		if (layoutWeight !== null && Math.max(0, layoutWeight) < 0.5) continue;
		validPairs.push({ source, target });
		if (!outgoing.has(source)) outgoing.set(source, new Set());
		outgoing.get(source)?.add(target);
		if (!undirected.has(source)) undirected.set(source, new Set());
		undirected.get(source)?.add(target);
		if (!undirected.has(target)) undirected.set(target, new Set());
		undirected.get(target)?.add(source);
	}
	if (validPairs.length === 0) {
		return { nodes: [...options.nodes], movedSubjectIds };
	}

	const allIds: string[] = [];
	for (const id of nodeIdSet) allIds.push(id);
	const sccs = tarjanStronglyConnectedComponents(allIds, outgoing);
	const taintedNodes = new Set<string>();
	for (const scc of sccs) {
		if (scc.length > 1) for (const id of scc) taintedNodes.add(id);
	}

	const subgraphNodes = new Set<string>();
	for (const id of options.touchedNodeIds) {
		if (nodeIdSet.has(id)) subgraphNodes.add(id);
	}
	for (const id of [...subgraphNodes]) {
		const neighbors = undirected.get(id);
		if (!neighbors) continue;
		for (const n of neighbors) subgraphNodes.add(n);
	}

	const processEdges = validPairs.filter(
		(e) =>
			subgraphNodes.has(e.source) &&
			subgraphNodes.has(e.target) &&
			!taintedNodes.has(e.source) &&
			!taintedNodes.has(e.target),
	);
	if (processEdges.length === 0) {
		return { nodes: [...options.nodes], movedSubjectIds };
	}

	const subOutgoing = new Map<string, Set<string>>();
	const subIncoming = new Map<string, Set<string>>();
	for (const id of subgraphNodes) {
		subOutgoing.set(id, new Set());
		subIncoming.set(id, new Set());
	}
	for (const e of processEdges) {
		subOutgoing.get(e.source)?.add(e.target);
		subIncoming.get(e.target)?.add(e.source);
	}
	const indeg = new Map<string, number>();
	for (const id of subgraphNodes) {
		indeg.set(id, subIncoming.get(id)?.size ?? 0);
	}
	const queue: string[] = [];
	for (const [id, d] of indeg.entries()) if (d === 0) queue.push(id);
	const topoOrder: string[] = [];
	while (queue.length > 0) {
		const v = queue.shift() as string;
		topoOrder.push(v);
		for (const w of subOutgoing.get(v) ?? new Set()) {
			indeg.set(w, (indeg.get(w) ?? 0) - 1);
			if (indeg.get(w) === 0) queue.push(w);
		}
	}
	const topoIdx = new Map<string, number>();
	topoOrder.forEach((id, i) => topoIdx.set(id, i));
	const sortedEdges = [...processEdges].sort((a, b) => {
		const aIdx = topoIdx.get(a.source) ?? 0;
		const bIdx = topoIdx.get(b.source) ?? 0;
		return aIdx - bIdx;
	});

	let nodes: NodeLike[] = [...options.nodes];
	let nodeById = rebuildNodeById(nodes);

	const shiftSubject = (subjectId: string, dx: number, dy: number): void => {
		if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
		nodes = nodes.map((node) => {
			if (readId(node.id) !== subjectId) return node;
			const pos = readNodePosition(node) || { x: 0, y: 0 };
			return { ...node, position: { x: pos.x + dx, y: pos.y + dy } };
		});
		nodeById = rebuildNodeById(nodes);
		movedSubjectIds.add(subjectId);
	};

	for (const e of sortedEdges) {
		const sourceNode = nodeById.get(e.source);
		const targetNode = nodeById.get(e.target);
		if (!sourceNode || !targetNode) continue;
		const sourceAbs = getNodeAbsolutePosition(sourceNode, nodeById);
		if (!sourceAbs) continue;
		const sourceSize = readNodeSize(sourceNode);
		const requiredX = sourceAbs.x + sourceSize.width + TOPOLOGY_GAP_X;
		const subjectId = findTopologyMovedSubject(e.source, e.target, nodeById);
		if (subjectId === e.source) continue;
		const subjectNode = nodeById.get(subjectId);
		if (!subjectNode) continue;
		const subjectAbs = getNodeAbsolutePosition(subjectNode, nodeById);
		if (!subjectAbs) continue;
		if (subjectAbs.x + 0.001 >= requiredX) continue;
		shiftSubject(subjectId, requiredX - subjectAbs.x, 0);
	}

	for (const e of sortedEdges) {
		const sourceNode = nodeById.get(e.source);
		const targetNode = nodeById.get(e.target);
		if (!sourceNode || !targetNode) continue;
		const sourceAbs = getNodeAbsolutePosition(sourceNode, nodeById);
		if (!sourceAbs) continue;
		const sourceSize = readNodeSize(sourceNode);
		const subjectId = findTopologyMovedSubject(e.source, e.target, nodeById);
		if (subjectId === e.source) continue;
		const subjectNode = nodeById.get(subjectId);
		if (!subjectNode) continue;
		const subjectAbs = getNodeAbsolutePosition(subjectNode, nodeById);
		if (!subjectAbs) continue;
		if (Math.abs(subjectAbs.x - sourceAbs.x) >= SAME_COLUMN_THRESHOLD) continue;
		const requiredY = sourceAbs.y + sourceSize.height + TOPOLOGY_GAP_Y;
		if (subjectAbs.y + 0.001 >= requiredY) continue;
		shiftSubject(subjectId, 0, requiredY - subjectAbs.y);
	}

	return { nodes, movedSubjectIds };
}

function autoAssignParentByContainment(options: {
	nodes: readonly NodeLike[];
	candidateNodeIds: ReadonlySet<string>;
}): NodeLike[] {
	if (options.candidateNodeIds.size === 0) return [...options.nodes];
	const nodeById = rebuildNodeById(options.nodes);

	type GroupRect = {
		id: string;
		depth: number;
		absX: number;
		absY: number;
		width: number;
		height: number;
	};
	const groupRects: GroupRect[] = [];
	for (const node of options.nodes) {
		if (!isGroupNode(node)) continue;
		const groupId = readId(node.id);
		if (!groupId) continue;
		const abs = getNodeAbsolutePosition(node, nodeById);
		if (!abs) continue;
		const size = readGroupSize(node) || readNodeSize(node);
		groupRects.push({
			id: groupId,
			depth: computeGroupNestingDepth(groupId, nodeById),
			absX: abs.x,
			absY: abs.y,
			width: size.width,
			height: size.height,
		});
	}
	groupRects.sort((a, b) => b.depth - a.depth);

	if (groupRects.length === 0) return [...options.nodes];

	let mutated = false;
	const next = options.nodes.map((node) => {
		const id = readId(node.id);
		if (!id || !options.candidateNodeIds.has(id)) return node;
		if (readNodeParentId(node)) return node;
		const abs = getNodeAbsolutePosition(node, nodeById);
		if (!abs) return node;
		const size = readNodeSize(node);
		const left = abs.x;
		const top = abs.y;
		const right = abs.x + size.width;
		const bottom = abs.y + size.height;

		for (const g of groupRects) {
			if (g.id === id) continue;
			if (
				left >= g.absX &&
				top >= g.absY &&
				right <= g.absX + g.width &&
				bottom <= g.absY + g.height
			) {
				mutated = true;
				return {
					...node,
					parentId: g.id,
					position: { x: abs.x - g.absX, y: abs.y - g.absY },
				};
			}
		}
		return node;
	});

	if (!mutated) return [...options.nodes];
	return orderNodesParentFirst(next);
}

function stableJson(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return "";
	}
}

function mergeWebHeroWorkflowContract(
	existing: Record<string, unknown>,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const next: Record<string, unknown> = { ...existing, ...patch };
	const existingStepStatus = asObject(existing.stepStatus);
	const patchStepStatus = asObject(patch.stepStatus);
	if (patchStepStatus) {
		next.stepStatus = { ...(existingStepStatus || {}), ...patchStepStatus };
	}
	return next;
}

function mergePptMasterWorkflowContract(
	existing: Record<string, unknown>,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const next: Record<string, unknown> = { ...existing, ...patch };
	const existingStepStatus = asObject(existing.stepStatus);
	const patchStepStatus = asObject(patch.stepStatus);
	if (patchStepStatus) {
		next.stepStatus = { ...(existingStepStatus || {}), ...patchStepStatus };
	}
	return next;
}

function mergeWebHeroGoalContract(
	existing: Record<string, unknown>,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const next: Record<string, unknown> = { ...existing, ...patch };
	if (Array.isArray(patch.steps) && Array.isArray(existing.steps)) {
		const patchById = new Map(
			patch.steps
				.filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === "object" && !Array.isArray(step))
				.map((step) => [readId(step.id), step] as const)
				.filter(([id]) => Boolean(id)),
		);
		const existingIds = new Set<string>();
		const mergedSteps = existing.steps.map((step) => {
			const record = asObject(step);
			const id = record ? readId(record.id) : "";
			if (id) existingIds.add(id);
			const itemPatch = id ? patchById.get(id) : null;
			return record && itemPatch ? { ...record, ...itemPatch } : step;
		});
		for (const [id, step] of patchById.entries()) {
			if (!existingIds.has(id)) mergedSteps.push(step);
		}
		next.steps = mergedSteps;
	}
	return next;
}

function hasWebHeroDownstreamEvidence(data: Record<string, unknown>, phase: string): boolean {
	const codeFields = [
		"webHeroHtml",
		"webHeroCss",
		"webHeroDocumentHtml",
		"webHeroCodeSessionId",
		"webHeroCodeEvidence",
	];
	const downstreamFields: Record<string, string[]> = {
		preview_generation: [
			"webPagePreviewVisualSpecs",
			"visibleSubjectInventory",
			"webPageVisibleSubjectInventory",
			"webPageAssetRequirements",
			"webPageResolvedAssets",
			"webPageAssetDecisions",
			"componentReferencePlan",
			"webPageImplementationBrief",
			"webPageReferencePrompt",
			"fontPlan",
			"previewDetailChecklist",
			"webPageSectionDrafts",
			...codeFields,
		],
		preview_visual_spec: [
			"visibleSubjectInventory",
			"webPageVisibleSubjectInventory",
			"webPageAssetRequirements",
			"webPageResolvedAssets",
			"webPageAssetDecisions",
			"webPageSectionDrafts",
			...codeFields,
		],
		asset_inventory: ["webPageResolvedAssets", "webPageSectionDrafts", ...codeFields],
		asset_resolution: ["webPageSectionDrafts", ...codeFields],
		section_codegen: codeFields,
	};
	if (phase === "preview_generation") {
		const workflow = asObject(data.webPageWorkflowContract) || {};
		if (Array.isArray(workflow.approvedPreviewNodes) && workflow.approvedPreviewNodes.length > 0) return true;
	}
	return (downstreamFields[phase] || []).some((field) => hasMeaningfulWebHeroEvidence(data[field]));
}

function resetWebHeroCodeFromPhase(
	next: Record<string, unknown>,
	rewindPhase: WebHeroRewindPhase,
	options: { clearPreviewVisualSpecs?: boolean } = {},
): string[] {
	const clearedFields = new Set<string>([
		"webHeroFinalCodeStale",
		"webHeroCodeEvidence",
		"webHeroHtml",
		"webHeroCss",
		"webHeroDocumentHtml",
		"webHeroCodeSessionId",
		"webHeroCodeCommittedAt",
		"webHeroCodegenSessionKey",
		"webHeroCodegenSessionPageHash",
	]);
	const nextWorkflow = asObject(next.webPageWorkflowContract) || {};
	const normalizePhase = (value: unknown): string => {
		const token = readId(value).toLowerCase();
		if (["style_selection", "style_reference"].includes(token)) return "style_reference_selection";
		if (["final_code", "final_codegen", "merge"].includes(token)) return "merge_codegen";
		return token;
	};
	const phaseOrder = [
		"style_reference_selection",
		"preview_generation",
		"preview_visual_spec",
		"asset_inventory",
		"asset_resolution",
		"section_codegen",
		"merge_codegen",
		"completed",
	];
	const currentPhase = normalizePhase(nextWorkflow.currentStep);
	const currentIndex = phaseOrder.indexOf(currentPhase);
	const rewindIndex = phaseOrder.indexOf(rewindPhase);
	const effectivePhase = currentIndex >= 0 && rewindIndex >= 0 && currentIndex < rewindIndex
		? currentPhase
		: rewindPhase;
	const stepStatus = asObject(nextWorkflow.stepStatus) || {};
	const resetStatus: Record<string, string> = { merge_codegen: "pending", final_code: "pending" };
	if (["preview_generation", "preview_visual_spec"].includes(rewindPhase)) {
		Object.assign(resetStatus, {
			...(rewindPhase === "preview_generation" ? { preview_visual_spec: "pending" } : {}),
			asset_inventory: "pending",
			asset_resolution: "pending",
			section_codegen: "pending",
		});
		next.visibleSubjectInventory = [];
		next.webPageVisibleSubjectInventory = [];
		next.webPageAssetRequirements = { visibleSubjectInventory: [], visualSlots: [] };
		next.webPageResolvedAssets = [];
		next.webPageAssetDecisions = { icons: [], searchAssets: [], generatedAssets: [], fontPlan: [], stylePlan: [] };
		next.webPageSectionDrafts = [];
		[
			"visibleSubjectInventory",
			"webPageVisibleSubjectInventory",
			"webPageAssetRequirements",
			"webPageResolvedAssets",
			"webPageAssetDecisions",
			"webPageSectionDrafts",
		].forEach((field) => clearedFields.add(field));
		if (rewindPhase === "preview_generation" || options.clearPreviewVisualSpecs) {
			next.webPagePreviewVisualSpecs = [];
			clearedFields.add("webPagePreviewVisualSpecs");
		}
			if (rewindPhase === "preview_generation" || options.clearPreviewVisualSpecs) {
			next.webPageReferencePrompt = "";
			next.webPageImplementationBrief = {};
			next.fontPlan = {};
			next.previewDetailChecklist = [];
			next.componentReferencePlan = {};
			[
				"webPageReferencePrompt",
				"webPageImplementationBrief",
				"fontPlan",
				"previewDetailChecklist",
				"componentReferencePlan",
			].forEach((field) => clearedFields.add(field));
		}
	} else if (rewindPhase === "asset_inventory") {
		Object.assign(resetStatus, { asset_resolution: "pending", section_codegen: "pending" });
		next.webPageResolvedAssets = [];
		next.webPageSectionDrafts = [];
		clearedFields.add("webPageResolvedAssets");
		clearedFields.add("webPageSectionDrafts");
	} else if (rewindPhase === "asset_resolution") {
		Object.assign(resetStatus, { section_codegen: "pending" });
		next.webPageSectionDrafts = [];
		clearedFields.add("webPageSectionDrafts");
	}
	next.webPageWorkflowContract = {
		...nextWorkflow,
		...(rewindPhase === "preview_generation" ? { approvedPreviewNodes: [] } : {}),
		currentStep: effectivePhase,
		stepStatus: { ...stepStatus, ...resetStatus },
	};
	const goal = asObject(next.webHeroGoalContract);
	if (goal) {
		const effectiveIndex = phaseOrder.indexOf(effectivePhase);
		const steps = Array.isArray(goal.steps)
			? goal.steps.map((value) => {
				const step = asObject(value);
				if (!step) return value;
				const stepId = normalizePhase(step.id);
				const stepIndex = phaseOrder.indexOf(stepId);
				if (stepIndex < 0 || effectiveIndex < 0) return value;
				return {
					...step,
					status: stepIndex < effectiveIndex
						? "completed"
						: stepIndex === effectiveIndex ? "in_progress" : "pending",
				};
			})
			: goal.steps;
		next.webHeroGoalContract = {
			...goal,
			...(rewindPhase === "preview_generation" ? { approvedPreviewNodes: [] } : {}),
			currentStep: effectivePhase,
			...(Array.isArray(steps) ? { steps } : {}),
		};
	}
	next.webHeroFinalCodeStale = true;
	next.webHeroCodeEvidence = null;
	next.webHeroHtml = "";
	next.webHeroCss = "";
	next.webHeroDocumentHtml = "";
	next.webHeroCodeSessionId = null;
	next.webHeroCodeCommittedAt = null;
	next.webHeroCodegenSessionKey = null;
	next.webHeroCodegenSessionPageHash = null;
	next.status = "idle";
	next.progress = 0;
	next.webHeroProgressLabel = "等待重新生成网页代码";
	return Array.from(clearedFields);
}

function approvedPreviewNodeIds(webHeroData: Record<string, unknown>): string[] {
	const workflow = asObject(webHeroData.webPageWorkflowContract) || {};
	return Array.isArray(workflow.approvedPreviewNodes)
		? Array.from(new Set(workflow.approvedPreviewNodes.map(readId).filter(Boolean))).sort()
		: [];
}

function approvedPreviewMediaEvidenceFingerprint(
	nodeById: Map<string, NodeLike>,
	previewNodeIds: string[],
): string {
	return stableJson(previewNodeIds.map((previewNodeId) => {
		const previewData = ensureNodeDataObject(nodeById.get(previewNodeId) || {});
		return {
			id: previewNodeId,
			status: previewData.status,
			imageUrl: previewData.imageUrl,
			imageResults: previewData.imageResults,
			webPreviewStyleReferenceUrls: previewData.webPreviewStyleReferenceUrls,
			webScreenshotOrder: previewData.webScreenshotOrder,
			webScreenshotSectionId: previewData.webScreenshotSectionId,
		};
	}));
}

function invalidateCommittedWebHeroCodeIfInputsChanged(
	existing: Record<string, unknown>,
	next: Record<string, unknown>,
	patch: Record<string, unknown>,
	options: {
		nodeId: string;
		authorizedRewindPhase?: WebHeroRewindPhase;
	},
): Omit<WebHeroRewindAudit, "nodeId"> | null {
	if (readId(existing.kind) !== "webHero") return null;
	const existingWorkflow = asObject(existing.webPageWorkflowContract) || {};
	const nextWorkflow = asObject(next.webPageWorkflowContract) || {};
	const sharedStyleBibleChanged = stableJson(existingWorkflow.sharedStyleBible) !== stableJson(nextWorkflow.sharedStyleBible);
	const explicitlyChangedPhases: string[] = WEBHERO_CODE_INPUT_PHASES
		.filter((item) => item.fields.some((field) =>
			Object.prototype.hasOwnProperty.call(patch, field)
			&& stableJson(existing[field]) !== stableJson(next[field])
			&& hasMeaningfulWebHeroEvidence(next[field]),
		))
		.map((item) => item.phase);
	if (
		sharedStyleBibleChanged
		&& hasMeaningfulWebHeroEvidence(nextWorkflow.sharedStyleBible)
		&& Object.prototype.hasOwnProperty.call(asObject(patch.webPageWorkflowContract) || {}, "sharedStyleBible")
	) {
		explicitlyChangedPhases.push("preview_generation");
	}
	if (new Set(explicitlyChangedPhases).size > 1) {
		throw new AppError("A committed WebHero cannot replace multiple dependent evidence phases in one patch", {
			status: 409,
			code: "webhero_codegen_input_transition_mixed",
			details: { phases: explicitlyChangedPhases },
		});
	}
	const canonicalApprovedSet = (value: unknown): string[] => Array.isArray(value)
		? Array.from(new Set(value.map(readId).filter(Boolean))).sort()
		: [];
	const existingStyleUrls = readSelectedWebHeroStyleReference(existing)?.referenceUrls.slice().sort() || [];
	const nextStyleUrls = readSelectedWebHeroStyleReference(next)?.referenceUrls.slice().sort() || [];
	const approvedPreviewNodesChanged =
		stableJson(canonicalApprovedSet(existingWorkflow.approvedPreviewNodes)) !==
		stableJson(canonicalApprovedSet(nextWorkflow.approvedPreviewNodes));
	let rewindPhase = "";
	if (stableJson(existingStyleUrls) !== stableJson(nextStyleUrls) || sharedStyleBibleChanged) {
		rewindPhase = "preview_generation";
	} else if (approvedPreviewNodesChanged) {
		rewindPhase = "preview_visual_spec";
	} else {
		for (const item of WEBHERO_CODE_INPUT_PHASES) {
			if (item.fields.some((field) => stableJson(existing[field]) !== stableJson(next[field]))) {
				rewindPhase = item.phase;
				break;
			}
		}
	}
	if (!rewindPhase) return null;
	if (!hasWebHeroDownstreamEvidence(existing, rewindPhase)) return null;
	if (options.authorizedRewindPhase !== rewindPhase) {
		throw new AppError("A WebHero evidence rewrite would clear downstream evidence and requires explicit rewind authorization", {
			status: 409,
			code: "webhero_evidence_rewind_required",
			details: {
				nodeId: options.nodeId,
				rewindPhase,
				providedPhase: options.authorizedRewindPhase || null,
				requiredField: `patchNodeData[].data.webHeroRewindFromPhase=${rewindPhase}`,
			},
		});
	}
	return {
		rewindPhase: rewindPhase as WebHeroRewindPhase,
		clearedFields: resetWebHeroCodeFromPhase(next, rewindPhase as WebHeroRewindPhase, {
			clearPreviewVisualSpecs: approvedPreviewNodesChanged,
		}),
	};
}

function mergeWebHeroSectionDrafts(
	current: unknown,
	patch: unknown,
	nodeId: string,
): Record<string, unknown>[] {
	const existingDrafts = typeof current === "undefined" || current === null ? [] : current;
	if (!Array.isArray(existingDrafts) || !Array.isArray(patch)) {
		throw new AppError("webPageSectionDrafts must be an array", {
			status: 400,
			code: "webhero_section_drafts_invalid",
			details: { nodeId },
		});
	}
	if (patch.length === 0) return [];
	const merged: Record<string, unknown>[] = [];
	const indexByPreviewNodeId = new Map<string, number>();
	for (const raw of existingDrafts) {
		const draft = asObject(raw);
		if (!draft) {
			throw new AppError("Stored webPageSectionDrafts contains a non-object draft", {
				status: 409,
				code: "webhero_section_drafts_invalid",
				details: { nodeId },
			});
		}
		const previewNodeId = readId(draft.previewNodeId);
		if (!previewNodeId || indexByPreviewNodeId.has(previewNodeId)) {
			throw new AppError("Stored webPageSectionDrafts requires unique previewNodeId values", {
				status: 409,
				code: "webhero_section_drafts_invalid",
				details: { nodeId, previewNodeId: previewNodeId || null },
			});
		}
		indexByPreviewNodeId.set(previewNodeId, merged.length);
		merged.push(draft);
	}
	const incomingIds = new Set<string>();
	for (const raw of patch) {
		const draft = asObject(raw);
		const previewNodeId = readId(draft?.previewNodeId);
		if (!draft || !previewNodeId || incomingIds.has(previewNodeId)) {
			throw new AppError("webPageSectionDrafts patch requires unique previewNodeId values", {
				status: 400,
				code: "webhero_section_drafts_invalid",
				details: { nodeId, previewNodeId: previewNodeId || null },
			});
		}
		incomingIds.add(previewNodeId);
		const existingIndex = indexByPreviewNodeId.get(previewNodeId);
		if (typeof existingIndex === "number") {
			merged[existingIndex] = draft;
		} else {
			indexByPreviewNodeId.set(previewNodeId, merged.length);
			merged.push(draft);
		}
	}
	return merged.sort((left, right) => {
		const leftOrder = typeof left.order === "number" && Number.isFinite(left.order) ? left.order : Number.MAX_SAFE_INTEGER;
		const rightOrder = typeof right.order === "number" && Number.isFinite(right.order) ? right.order : Number.MAX_SAFE_INTEGER;
		return leftOrder - rightOrder;
	});
}

function ensureNodeId(node: NodeLike): string {
	const id = readId(node.id);
	return id || `n-${randomUUID()}`;
}

function ensureEdgeId(edge: EdgeLike): string {
	const id = readId(edge.id);
	return id || `e-${randomUUID()}`;
}

function assertValidEdgeHandle(options: {
	node: NodeLike;
	nodeId: string;
	handleId: string;
	direction: "source" | "target";
}): void {
	const { node, nodeId, handleId, direction } = options;
	const knownHandles = getPublicFlowNodeHandles(node);
	if (!knownHandles) return;
	const handleSet = direction === "source" ? knownHandles.sources : knownHandles.targets;
	if (handleSet.has(handleId)) return;
	const side = direction === "source" ? "sourceHandle" : "targetHandle";
	throw new AppError(`createEdges ${side} 非法: ${handleId}`, {
		status: 400,
		code: "flow_patch_invalid_handle",
		details: {
			nodeId,
			side,
			handleId,
			allowedHandles: listPublicFlowNodeHandles(node, direction),
		},
	});
}

function ensureFlowGraphShape(raw: unknown): PublicFlowGraph {
	const obj = asObject(raw) || {};
	const nodes = Array.isArray(obj.nodes) ? obj.nodes : [];
	const edges = Array.isArray(obj.edges) ? obj.edges : [];
	const viewport = obj.viewport ?? undefined;
	const metaObj = asObject(obj.meta);
	return {
		nodes,
		edges,
		...(typeof viewport === "undefined"
			? {}
			: { viewport: viewport as { x: number; y: number; zoom: number } | null }),
		...(metaObj ? { meta: metaObj } : {}),
	};
}

function readLayoutVersion(graph: PublicFlowGraph): number {
	const meta = (graph as { meta?: Record<string, unknown> }).meta;
	if (!meta) return 0;
	const value = meta.layoutVersion;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	return 0;
}

function withLayoutVersion(
	graph: PublicFlowGraph,
	version: number,
): PublicFlowGraph {
	const meta = (graph as { meta?: Record<string, unknown> }).meta || {};
	return {
		...graph,
		meta: { ...meta, layoutVersion: version },
	};
}

export function migrateFlowLayoutOnRead(input: {
	data: PublicFlowGraph;
}): { data: PublicFlowGraph; migrated: boolean } {
	const graph = ensureFlowGraphShape(input.data);
	const currentVersion = readLayoutVersion(graph);
	if (currentVersion >= CURRENT_LAYOUT_VERSION) {
		return { data: graph, migrated: false };
	}

	let nodeList: NodeLike[] = (graph.nodes || [])
		.map((raw) => asObject(raw) as NodeLike | null)
		.filter((node): node is NodeLike => Boolean(node));
	const edgeList: unknown[] = Array.isArray(graph.edges) ? [...graph.edges] : [];

	const allNodeIds = new Set<string>();
	for (const node of nodeList) {
		const id = readId(node.id);
		if (id) allNodeIds.add(id);
	}
	if (allNodeIds.size === 0) {
		const stamped = withLayoutVersion(
			{ ...graph, nodes: nodeList, edges: edgeList },
			CURRENT_LAYOUT_VERSION,
		);
		return { data: stamped, migrated: true };
	}

	nodeList = autoAssignParentByContainment({
		nodes: nodeList,
		candidateNodeIds: allNodeIds,
	});

	const topoResult = correctTopologyDirection({
		nodes: nodeList,
		edges: edgeList,
		touchedNodeIds: allNodeIds,
	});
	nodeList = topoResult.nodes;

	const allGroupIds: string[] = [];
	for (const node of nodeList) {
		if (isGroupNode(node)) {
			const id = readId(node.id);
			if (id) allGroupIds.push(id);
		}
	}
	nodeList = settleTopLevelLayoutAfterGeometryChange({
		nodes: nodeList,
		movableNodeIds: allNodeIds,
		affectedGroupIds: allGroupIds,
		baselineNodeById: null,
	});

	const stamped = withLayoutVersion(
		{ ...graph, nodes: orderNodesParentFirst(nodeList), edges: edgeList },
		CURRENT_LAYOUT_VERSION,
	);
	return { data: stamped, migrated: true };
}

function ensureNodeDataObject(node: NodeLike): Record<string, unknown> {
	const data = asObject(node.data);
	return data ? data : {};
}

function validateCreateNode(raw: unknown): NodeLike {
	const parsed = PublicFlowCreateNodeSchema.safeParse(raw);
	if (!parsed.success) {
		throw new AppError("createNodes 节点协议不合法；仅支持前端真实节点协议", {
			status: 400,
			code: "invalid_flow_create_node",
			details: {
				issues: parsed.error.issues.map((issue) => ({
					path: issue.path,
					message: issue.message,
					code: issue.code,
				})),
			},
		});
	}
	return parsed.data as NodeLike;
}

export function mergePublicFlowNodeData(options: {
	existing: Record<string, unknown>;
	patch: Record<string, unknown>;
	allowOverwrite: boolean;
	strategy: "skip-equal" | "overwrite" | "fail";
	nodeId: string;
	webHeroRewindFromPhase?: WebHeroRewindPhase;
	onWebHeroRewind?: (audit: WebHeroRewindAudit) => void;
}): Record<string, unknown> {
	const { existing, patch, allowOverwrite, strategy, nodeId } = options;
	const next: Record<string, unknown> = { ...existing };

	const conflicts: string[] = [];
	for (const [key, value] of Object.entries(patch)) {
		const current = next[key];
		if (
			readId(existing.kind) === "webHero"
			&& ["webPageWorkflowContract", "webHeroGoalContract"].includes(key)
			&& typeof current !== "undefined"
			&& current !== null
			&& !asObject(current)
		) {
			throw new AppError(`Stored WebHero ${key} must be normalized before semantic updates`, {
				status: 409,
				code: key === "webPageWorkflowContract"
					? "webhero_stored_workflow_contract_invalid"
					: "webhero_stored_goal_contract_invalid",
				details: { nodeId, field: key },
			});
		}
		if (
			!allowOverwrite &&
			strategy === "skip-equal" &&
			readId(existing.kind) === "webHero" &&
			key === "webPageSectionDrafts"
		) {
			next[key] = mergeWebHeroSectionDrafts(current, value, nodeId);
			continue;
		}
		if (
			!allowOverwrite &&
			strategy === "skip-equal" &&
			readId(existing.kind) === "webHero" &&
			key === "webHeroGoalContract"
		) {
			const currentContract = asObject(current);
			const contractPatch = asObject(value);
			if (currentContract && contractPatch) {
				next[key] = mergeWebHeroGoalContract(currentContract, contractPatch);
				continue;
			}
		}
		// WebHero initializes this contract at node creation, then advances it
		// through partial canvas_update_node_data patches.
		if (
			!allowOverwrite &&
			strategy === "skip-equal" &&
			readId(existing.kind) === "webHero" &&
			key === "webPageWorkflowContract"
		) {
			const currentContract = asObject(current);
			const contractPatch = asObject(value);
			if (currentContract && contractPatch) {
				next[key] = mergeWebHeroWorkflowContract(currentContract, contractPatch);
				continue;
			}
		}
		if (
			readId(existing.kind) === "pptDeck" &&
			key === "pptMasterWorkflowContract"
		) {
			const currentContract = asObject(current);
			const contractPatch = asObject(value);
			if (currentContract && contractPatch) {
				next[key] = mergePptMasterWorkflowContract(currentContract, contractPatch);
				continue;
			}
		}
		if (typeof current === "undefined" || current === null) {
			next[key] = value;
			continue;
		}
		if (allowOverwrite || strategy === "overwrite") {
			next[key] = value;
			continue;
		}
		if (stableJson(current) === stableJson(value)) continue;
		if (strategy === "fail") {
			conflicts.push(key);
			continue;
		}
		// strategy === "skip-equal" with unequal values: keep old, skip silently.
	}

	if (conflicts.length) {
		throw new AppError(`patchNodeData 会覆盖既有字段: ${conflicts.join(", ")}`, {
			status: 409,
			code: "flow_patch_conflict",
			details: { nodeId, keys: conflicts },
		});
	}
	const rewind = invalidateCommittedWebHeroCodeIfInputsChanged(existing, next, patch, {
		nodeId,
		...(options.webHeroRewindFromPhase
			? { authorizedRewindPhase: options.webHeroRewindFromPhase }
			: {}),
	});
	if (rewind) options.onWebHeroRewind?.({ nodeId, ...rewind });

	return next;
}

function appendNodeArray(options: {
	node: NodeLike;
	key: string;
	items: unknown[];
}): { nextNode: NodeLike; appended: number } {
	const { node, key, items } = options;
	if (!key.trim()) {
		throw new AppError("appendNodeArrays.key 不能为空", {
			status: 400,
			code: "invalid_flow_patch",
		});
	}
	if (!items.length) return { nextNode: node, appended: 0 };

	const data = ensureNodeDataObject(node);
	const current = (data as Record<string, unknown>)[key];
	if (typeof current === "undefined" || current === null) {
		return {
			nextNode: { ...node, data: { ...data, [key]: [...items] } },
			appended: items.length,
		};
	}
	if (!Array.isArray(current)) {
		throw new AppError(`appendNodeArrays 目标字段不是数组: ${key}`, {
			status: 409,
			code: "flow_patch_type_mismatch",
			details: { nodeId: readId(node.id), key, currentType: typeof current },
		});
	}
	return {
		nextNode: { ...node, data: { ...data, [key]: [...current, ...items] } },
		appended: items.length,
	};
}

export function applyPublicFlowGraphPatch(options: {
	current: unknown;
	patch: PublicFlowPatchRequestDto;
	origin?: unknown;
	pptMasterWriteAuthority?: PptMasterWriteAuthority;
	webHeroPatchAuthority?: WebHeroPatchAuthority;
}): ApplyPatchResult {
	const current = ensureFlowGraphShape(options.current);
	const allowOverwrite = options.patch.allowOverwrite === true;

	let nodeList: NodeLike[] = (Array.isArray(current.nodes) ? current.nodes : [])
		.map((raw) => asObject(raw) as NodeLike | null)
		.filter((node): node is NodeLike => Boolean(node));
	const originalNodes = [...nodeList];
	const edgeList: unknown[] = Array.isArray(current.edges) ? [...current.edges] : [];

	const nodeById = new Map<string, NodeLike>();
	for (const node of nodeList) {
		const id = readId(node.id);
		if (!id) continue;
		nodeById.set(id, node);
	}
	const originalNodeById = new Map(nodeById);
	// This exclusivity guard exists to stop the agent from writing two input
	// evidence phases in one canvas_update_node_data call. A webhero_code_commit
	// patch is not an input write: it persists final code plus the completed
	// workflow contract, which by contract carries the historical
	// selectedStyleReference and the approved preview set forward. Those carried
	// fields are not a phase transition, so commit is not subject to this check.
	if (options.webHeroPatchAuthority !== "webhero_code_commit") {
		const requestedInputPhasesByNode = new Map<string, Set<string>>();
		for (const item of options.patch.patchNodeData || []) {
			const nodeId = readId(item.id);
			const nodeData = ensureNodeDataObject(nodeById.get(nodeId) || {});
			if (!nodeId || readId(nodeData.kind) !== "webHero") continue;
			const patchData = asObject(item.data) || {};
			const phases = requestedInputPhasesByNode.get(nodeId) || new Set<string>();
			for (const definition of WEBHERO_CODE_INPUT_PHASES) {
				if (definition.fields.some((field) =>
					Object.prototype.hasOwnProperty.call(patchData, field)
					&& hasMeaningfulWebHeroEvidence(patchData[field]),
				)) phases.add(definition.phase);
			}
			const workflowPatch = asObject(patchData.webPageWorkflowContract) || {};
			if (
				["selectedStyleReference", "sharedStyleBible"].some((field) =>
					Object.prototype.hasOwnProperty.call(workflowPatch, field)
					&& hasMeaningfulWebHeroEvidence(workflowPatch[field]),
				)
			) phases.add("preview_generation");
			const clearsApprovedAsPartOfStyleTransition =
				Object.prototype.hasOwnProperty.call(workflowPatch, "selectedStyleReference")
				&& Array.isArray(workflowPatch.approvedPreviewNodes)
				&& workflowPatch.approvedPreviewNodes.length === 0;
			if (
				Object.prototype.hasOwnProperty.call(workflowPatch, "approvedPreviewNodes")
				&& !clearsApprovedAsPartOfStyleTransition
			) {
				phases.add("preview_visual_spec");
			}
			requestedInputPhasesByNode.set(nodeId, phases);
		}
		for (const [nodeId, phases] of requestedInputPhasesByNode.entries()) {
			if (phases.size <= 1) continue;
			throw new AppError("A WebHero patch must persist one canonical evidence phase at a time", {
				status: 409,
				code: "webhero_codegen_input_transition_mixed",
				details: { nodeId, phases: Array.from(phases) },
			});
		}
	}

	let createdNodes = 0;
	let deletedNodes = 0;
	let deletedEdges = 0;
	const patchedNodeIds = new Set<string>();
	let appendedArrays = 0;
	let createdEdges = 0;
	const webHeroRewinds: WebHeroRewindAudit[] = [];
	let createdNodeWithoutExplicitId = false;
	const autoWireTargetNodeIds = new Set<string>();
	const createdNodeIds: string[] = [];
	// Created nodes whose request carried NO explicit position — the backend
	// owns their placement (DAG-aware) rather than trusting an agent coordinate.
	const autoPlaceNodeIds = new Set<string>();
	const creationOrigin = resolveCanvasCreationOrigin(nodeList, options.origin);

	const deleteEdgeIdSet = new Set(
		(options.patch.deleteEdgeIds || []).map((id) => readId(id)).filter(Boolean),
	);
	if (deleteEdgeIdSet.size > 0) {
		const existingEdgeIds = new Set<string>();
		for (const raw of edgeList) {
			const edge = asObject(raw) as EdgeLike | null;
			const edgeId = readId(edge?.id);
			if (edgeId) existingEdgeIds.add(edgeId);
		}
		const missingEdgeIds = [...deleteEdgeIdSet].filter((edgeId) => !existingEdgeIds.has(edgeId));
		if (missingEdgeIds.length > 0) {
			throw new AppError(`deleteEdgeIds 边不存在: ${missingEdgeIds.join(", ")}`, {
				status: 404,
				code: "flow_edge_not_found",
				details: { edgeIds: missingEdgeIds },
			});
		}
		const retainedEdges: unknown[] = [];
		for (const raw of edgeList) {
			const edge = asObject(raw) as EdgeLike | null;
			const edgeId = readId(edge?.id);
			if (edgeId && deleteEdgeIdSet.has(edgeId)) {
				deletedEdges += 1;
				continue;
			}
			retainedEdges.push(raw);
		}
		edgeList.length = 0;
		edgeList.push(...retainedEdges);
	}

	const deleteNodeIdSet = new Set(
		(options.patch.deleteNodeIds || []).map((id) => readId(id)).filter(Boolean),
	);
	if (deleteNodeIdSet.size > 0) {
		const missingNodeIds = [...deleteNodeIdSet].filter((nodeId) => !nodeById.has(nodeId));
		if (missingNodeIds.length > 0) {
			throw new AppError(`deleteNodeIds 节点不存在: ${missingNodeIds.join(", ")}`, {
				status: 404,
				code: "flow_node_not_found",
				details: { nodeIds: missingNodeIds },
			});
		}
		const retainedNodes: NodeLike[] = [];
		for (const node of nodeList) {
			const nodeId = readId(node.id);
			if (nodeId && deleteNodeIdSet.has(nodeId)) {
				nodeById.delete(nodeId);
				deletedNodes += 1;
				continue;
			}
			retainedNodes.push(node);
		}
		nodeList = retainedNodes;

		const retainedEdges: unknown[] = [];
		for (const raw of edgeList) {
			const edge = asObject(raw) as EdgeLike | null;
			const edgeId = readId(edge?.id);
			const sourceId = readId(edge?.source);
			const targetId = readId(edge?.target);
			if ((sourceId && deleteNodeIdSet.has(sourceId)) || (targetId && deleteNodeIdSet.has(targetId))) {
				if (!edgeId || !deleteEdgeIdSet.has(edgeId)) {
					deletedEdges += 1;
				}
				continue;
			}
			retainedEdges.push(raw);
		}
		edgeList.length = 0;
		edgeList.push(...retainedEdges);
	}

	const nodeIdRebindMap: Record<string, string> = {};

	const normalizedCreateNodes = (options.patch.createNodes || []).map((raw) => {
		const validated = validateCreateNode(raw);
		const obj: NodeLike = {
			...validated,
			data: {
				...omitCanvasOrigin(validated.data),
				...(creationOrigin ? { canvasOrigin: creationOrigin } : {}),
			},
		};
		if (!readId(obj.id)) createdNodeWithoutExplicitId = true;
		let id = ensureNodeId(obj);
		if (nodeById.has(id)) {
			const fresh = `n-${randomUUID()}`;
			nodeIdRebindMap[id] = fresh;
			id = fresh;
		}
		const parent = readNodeParentId(obj);
		const remappedParent = parent && nodeIdRebindMap[parent] ? nodeIdRebindMap[parent] : parent;
		const next: NodeLike = { ...obj, id };
		if (remappedParent && remappedParent !== parent) {
			(next as Record<string, unknown>).parentId = remappedParent;
		}
		return next;
	});

	for (const obj of orderNodesParentFirst(normalizedCreateNodes)) {
		const id = readId(obj.id);
		const hadExplicitPosition = readNodePosition(obj) !== null;
		let next = normalizeCreateNodePositionRelativeToParent(
			obj,
			nodeById,
		);
		if (!hadExplicitPosition) {
			// Backend owns placement: seed a placeholder so the node always has a
			// finite position; the real coordinate is computed by
			// assignIncrementalPositions (top-level) or compactSingleGroup (grouped).
			autoPlaceNodeIds.add(id);
			if (!readNodePosition(next)) {
				next = { ...next, position: { x: 0, y: 0 } };
			}
		}
		nodeById.set(id, next);
		nodeList.push(next);
		createdNodes += 1;
		createdNodeIds.push(id);
		autoWireTargetNodeIds.add(id);
	}

	for (const item of options.patch.patchNodeData || []) {
		const id = readId(item.id);
		const existing = id ? nodeById.get(id) : null;
		if (!id || !existing) {
			throw new AppError(`patchNodeData 节点不存在: ${id || "(missing id)"}`, {
				status: 404,
				code: "flow_node_not_found",
				details: { nodeId: id || null },
			});
		}
		const prevData = ensureNodeDataObject(existing);
		const merged = mergePublicFlowNodeData({
			existing: prevData,
			patch: omitCanvasOrigin(item.data),
			allowOverwrite,
			strategy: item.mergeStrategy ?? "skip-equal",
			nodeId: id,
			...(item.webHeroRewindFromPhase
				? { webHeroRewindFromPhase: item.webHeroRewindFromPhase }
				: {}),
			onWebHeroRewind: (audit) => webHeroRewinds.push(audit),
		});
		const next = { ...existing, data: merged };
		nodeById.set(id, next);
		patchedNodeIds.add(id);
		autoWireTargetNodeIds.add(id);
	}

	for (const item of options.patch.appendNodeArrays || []) {
		const id = readId(item.id);
		const existing = id ? nodeById.get(id) : null;
		if (!id || !existing) {
			throw new AppError(`appendNodeArrays 节点不存在: ${id || "(missing id)"}`, {
				status: 404,
				code: "flow_node_not_found",
				details: { nodeId: id || null },
			});
		}
		const appended = appendNodeArray({ node: existing, key: item.key, items: item.items });
		nodeById.set(id, appended.nextNode);
		appendedArrays += appended.appended;
	}

	if (createdNodeIds.length > 0) {
		nodeList = orderNodesParentFirst(
			nodeList.map((node) => {
				const id = readId(node.id);
				return id ? nodeById.get(id) || node : node;
			}),
		);
		const candidateForAutoParent = new Set(createdNodeIds);
		nodeList = autoAssignParentByContainment({
			nodes: nodeList,
			candidateNodeIds: candidateForAutoParent,
		});
		let workingNodeById = rebuildNodeById(nodeList);
		const affectedGroupIds = sortGroupIdsByDepthDesc(
			collectAffectedGroupIds({
				createdNodeIds,
				nodeById: workingNodeById,
			}),
			workingNodeById,
		);
		for (const groupId of affectedGroupIds) {
			nodeList = compactSingleGroup({
				nodes: nodeList,
				groupId,
			});
			workingNodeById = rebuildNodeById(nodeList);
		}
		nodeList = settleTopLevelLayoutAfterGeometryChange({
			nodes: nodeList,
			movableNodeIds: createdNodeIds,
			affectedGroupIds,
			baselineNodeById: originalNodeById,
		});
		workingNodeById = rebuildNodeById(nodeList);
		nodeById.clear();
		for (const [id, node] of workingNodeById.entries()) {
			nodeById.set(id, node);
		}
	}

	const finalNodeIds = new Set(nodeById.keys());

	const edgeById = new Set<string>();
	for (const raw of edgeList) {
		const obj = asObject(raw) as EdgeLike | null;
		if (!obj) continue;
		const id = readId(obj.id);
		if (id) edgeById.add(id);
	}

	const edgeIdRebindMap: Record<string, string> = {};

	for (const raw of options.patch.createEdges || []) {
		const obj = asObject(raw) as EdgeLike | null;
		if (!obj) {
			throw new AppError("createEdges 元素必须是 object", {
				status: 400,
				code: "invalid_flow_patch",
			});
		}
		const rawSource = readId(obj.source);
		const rawTarget = readId(obj.target);
		const source = rawSource && nodeIdRebindMap[rawSource] ? nodeIdRebindMap[rawSource] : rawSource;
		const target = rawTarget && nodeIdRebindMap[rawTarget] ? nodeIdRebindMap[rawTarget] : rawTarget;
		if (!source || !target) {
			throw new AppError("createEdges 必须提供 source/target", {
				status: 400,
				code: "invalid_flow_patch",
			});
		}
		if (!finalNodeIds.has(source) || !finalNodeIds.has(target)) {
			const message = createdNodeWithoutExplicitId
				? "createEdges 引用的节点不存在；若引用同批新节点，必须显式提供稳定 id，不能使用 label"
				: "createEdges 引用的节点不存在";
			throw new AppError(message, {
				status: 409,
				code: "flow_patch_ref_missing",
				details: {
					source,
					target,
					...(createdNodeWithoutExplicitId
						? {
								hint: "若 createEdges 需要引用同批新节点，createNodes 必须显式提供稳定 id，且边只能使用这些 id，不能使用 label。",
						  }
						: {}),
				},
			});
		}
		const sourceNode = nodeById.get(source) || null;
		const targetNode = nodeById.get(target) || null;
		if (!sourceNode || !targetNode) {
			const message = createdNodeWithoutExplicitId
				? "createEdges 引用的节点不存在；若引用同批新节点，必须显式提供稳定 id，不能使用 label"
				: "createEdges 引用的节点不存在";
			throw new AppError(message, {
				status: 409,
				code: "flow_patch_ref_missing",
				details: {
					source,
					target,
					...(createdNodeWithoutExplicitId
						? {
								hint: "若 createEdges 需要引用同批新节点，createNodes 必须显式提供稳定 id，且边只能使用这些 id，不能使用 label。",
						  }
						: {}),
				},
			});
		}
		const sourceHandle = readId(obj.sourceHandle);
		const targetHandle = readId(obj.targetHandle);
		if (sourceHandle) {
			assertValidEdgeHandle({
				node: sourceNode,
				nodeId: source,
				handleId: sourceHandle,
				direction: "source",
			});
		}
		if (targetHandle) {
			assertValidEdgeHandle({
				node: targetNode,
				nodeId: target,
				handleId: targetHandle,
				direction: "target",
			});
		}
		const explicitEdgeId = readId(obj.id);
		let id = ensureEdgeId(obj);
		if (edgeById.has(id)) {
			const fresh = `e-${randomUUID()}`;
			if (explicitEdgeId) edgeIdRebindMap[explicitEdgeId] = fresh;
			id = fresh;
		}
		const next = {
			...obj,
			id,
			source,
			target,
			...(sourceHandle ? { sourceHandle } : {}),
			...(targetHandle ? { targetHandle } : {}),
		};
		edgeById.add(id);
		edgeList.push(next);
		createdEdges += 1;
	}

	const autoWired = autoWireReferenceEdges({
		nodeById,
		edgeList,
		targetNodeIds: autoWireTargetNodeIds,
	});
	createdEdges += autoWired.createdEdges;
	deletedEdges += autoWired.deletedEdges;

	if (createdNodeIds.length > 0) {
		// DAG-aware placement for backend-owned (positionless) nodes. Runs HERE —
		// after same-patch createEdges AND autowired reference edges are in
		// edgeList — so each new node anchors to its real dependency neighbours
		// (placing it before edges exist would always fall back to "isolated").
		// v2 placement may compact existing siblings in the exact active stage;
		// other stages and conversation turns remain fixed.
		const placementNodeById = rebuildNodeById(nodeList);
		const autoPlaceTopLevel = new Set<string>();
		for (const id of createdNodeIds) {
			if (!autoPlaceNodeIds.has(id)) continue;
			const node = placementNodeById.get(id);
			if (node && !readNodeParentId(node)) autoPlaceTopLevel.add(id);
		}
		if (autoPlaceTopLevel.size > 0) {
			// Refresh nodeList from nodeById so it carries the autowire updates
			// (e.g. upstreamReferenceOrder) before we replace positions and re-sync
			// nodeById — otherwise the re-sync would clobber those data fields.
			nodeList = nodeList.map((node) => {
				const id = readId(node.id);
				return id ? nodeById.get(id) || node : node;
			});
			const placementBoxes = nodeList
				.filter((node) => Boolean(readId(node.id)) && !readNodeParentId(node) && Boolean(readNodePosition(node)))
				.map((node) => {
					const size = readNodeSize(node);
					const pos = readNodePosition(node) || { x: 0, y: 0 };
					return {
						id: readId(node.id),
						x: pos.x,
						y: pos.y,
						w: size.width,
						h: size.height,
						origin: readCanvasHarnessOrigin(asObject(node.data)?.canvasOrigin),
					};
				});
			const placementEdges: { source: string; target: string }[] = [];
			for (const raw of edgeList) {
				const edge = asObject(raw);
				const source = readId(edge?.source);
				const target = readId(edge?.target);
				if (source && target) placementEdges.push({ source, target });
			}
			const placements = assignIncrementalPositions(placementBoxes, placementEdges, autoPlaceTopLevel, {
				rankGapX: LAYOUT_RANK_GAP_X,
				gapY: LAYOUT_GAP_Y,
			});
			if (placements.size > 0) {
				nodeList = replaceNodePositions({ nodes: nodeList, positionById: placements });
				nodeList = settleTopLevelLayoutAfterGeometryChange({
					nodes: nodeList,
					movableNodeIds: placements.keys(),
					affectedGroupIds: [],
					baselineNodeById: originalNodeById,
				});
				const rebuilt = rebuildNodeById(nodeList);
				nodeById.clear();
				for (const [id, node] of rebuilt.entries()) nodeById.set(id, node);
			}
		}

		const topoResult = correctTopologyDirection({
			nodes: nodeList,
			edges: edgeList,
			touchedNodeIds: new Set(createdNodeIds),
		});
		if (topoResult.movedSubjectIds.size > 0) {
			nodeList = topoResult.nodes;
			let workingNodeById = rebuildNodeById(nodeList);
			const affectedGroupsAfterTopo = new Set<string>();
			for (const id of topoResult.movedSubjectIds) {
				let cursor = workingNodeById.get(id);
				while (cursor) {
					const pid = readNodeParentId(cursor);
					if (!pid) break;
					const parent = workingNodeById.get(pid);
					if (!parent || !isGroupNode(parent)) break;
					affectedGroupsAfterTopo.add(pid);
					cursor = parent;
				}
			}
			nodeList = settleTopLevelLayoutAfterGeometryChange({
				nodes: nodeList,
				movableNodeIds: topoResult.movedSubjectIds,
				affectedGroupIds: [...affectedGroupsAfterTopo],
				baselineNodeById: originalNodeById,
			});
			workingNodeById = rebuildNodeById(nodeList);
			nodeById.clear();
			for (const [id, node] of workingNodeById.entries()) {
				nodeById.set(id, node);
			}
		}
	}

	for (const [nodeId, originalNode] of originalNodeById.entries()) {
		const originalData = ensureNodeDataObject(originalNode);
		if (readId(originalData.kind) !== "webHero") continue;
		const nextNode = nodeById.get(nodeId);
		if (!nextNode) continue;
		const nextData = { ...ensureNodeDataObject(nextNode) };
		const previousPreviewNodeIds = approvedPreviewNodeIds(originalData);
		const nextPreviewNodeIds = approvedPreviewNodeIds(nextData);
		if (stableJson(previousPreviewNodeIds) !== stableJson(nextPreviewNodeIds)) continue;
		const previousFingerprint = approvedPreviewMediaEvidenceFingerprint(originalNodeById, previousPreviewNodeIds);
		const nextFingerprint = approvedPreviewMediaEvidenceFingerprint(nodeById, nextPreviewNodeIds);
		if (previousFingerprint === nextFingerprint) continue;
		const clearedFields = resetWebHeroCodeFromPhase(nextData, "preview_generation");
		webHeroRewinds.push({ nodeId, rewindPhase: "preview_generation", clearedFields });
		nodeById.set(nodeId, { ...nextNode, data: nextData });
	}

	const finalNodesBeforePptIdentity = orderNodesParentFirst(
		nodeList.map((node) => {
			const id = readId(node.id);
			if (!id) return node;
			return nodeById.get(id) || node;
		}),
	);
	const finalNodes = reconcilePptMasterNodeIdentities({
		existingNodes: originalNodes,
		nextNodes: finalNodesBeforePptIdentity,
		writeAuthority: options.pptMasterWriteAuthority,
	}) as NodeLike[];

	const hasNodeRebinds = Object.keys(nodeIdRebindMap).length > 0;
	const hasEdgeRebinds = Object.keys(edgeIdRebindMap).length > 0;
	const idMap =
		hasNodeRebinds || hasEdgeRebinds
			? {
					...(hasNodeRebinds ? { nodes: nodeIdRebindMap } : {}),
					...(hasEdgeRebinds ? { edges: edgeIdRebindMap } : {}),
			  }
			: undefined;

	return {
		data: {
			nodes: finalNodes,
			edges: edgeList,
			...(typeof current.viewport === "undefined" ? {} : { viewport: current.viewport }),
			meta: {
				...((current as { meta?: Record<string, unknown> }).meta || {}),
				layoutVersion: CURRENT_LAYOUT_VERSION,
			},
		},
		stats: {
			deletedNodes,
			deletedEdges,
			createdNodes,
			createdEdges,
			patchedNodes: patchedNodeIds.size,
			appendedArrays,
			webHeroRewinds,
		},
		...(idMap ? { idMap } : {}),
	};
}
