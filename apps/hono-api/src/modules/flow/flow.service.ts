import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { appendTraceEvent, setTraceStage } from "../../trace";
import {
	createFlow,
	createFlowVersion,
	deleteFlowById,
	getFlowForOwner,
	getFlowVersion,
	listFlowVersions,
	listFlowsByOwner,
	mapFlowRowToDto,
	updateFlow,
	updateFlowIfUpdatedAtMatches,
} from "./flow.repo";
import { getProjectForOwner } from "../project/project.repo";
import { syncCanvasNodesToAssets } from "../asset/sync-canvas-assets";
import { reconcilePptMasterGraphIdentities } from "../task/agents-tool-bridge.ppt-master-node-create";

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function summarizeGraphShape(value: unknown): {
	nodeCount: number;
	edgeCount: number;
	isExplicitGraph: boolean;
} {
	const root = asRecord(value);
	if (!root) {
		return { nodeCount: 0, edgeCount: 0, isExplicitGraph: false };
	}
	const nodes = asArray(root.nodes);
	const edges = asArray(root.edges);
	const hasGraphKeys = Object.prototype.hasOwnProperty.call(root, "nodes")
		|| Object.prototype.hasOwnProperty.call(root, "edges");
	return {
		nodeCount: nodes.length,
		edgeCount: edges.length,
		isExplicitGraph: hasGraphKeys,
	};
}

function buildStaleSnapshotDetails(input: {
	flowId: string;
	baseUpdatedAt: string;
	currentUpdatedAt: string | null;
	incomingShape: ReturnType<typeof summarizeGraphShape>;
	currentShape: ReturnType<typeof summarizeGraphShape>;
}) {
	return {
		flowId: input.flowId,
		baseUpdatedAt: input.baseUpdatedAt,
		currentUpdatedAt: input.currentUpdatedAt,
		incomingNodeCount: input.incomingShape.nodeCount,
		incomingEdgeCount: input.incomingShape.edgeCount,
		currentNodeCount: input.currentShape.nodeCount,
		currentEdgeCount: input.currentShape.edgeCount,
	};
}

function throwStaleSnapshotError(
	c: AppContext,
	input: {
		flowId: string;
		projectId: string | null;
		baseUpdatedAt: string;
		currentUpdatedAt: string | null;
		incomingShape: ReturnType<typeof summarizeGraphShape>;
		currentShape: ReturnType<typeof summarizeGraphShape>;
	},
): never {
	const details = buildStaleSnapshotDetails(input);
	setTraceStage(c, "flow:upsert:stale_snapshot", {
		projectId: input.projectId,
		...details,
	});
	throw new AppError("Flow snapshot is stale; refresh the canvas before saving", {
		status: 409,
		code: "flow_snapshot_stale",
		details,
	});
}

export function sanitizeFlowDataForStorage(value: unknown): unknown {
	const seen = new WeakSet<object>();
	const looksLikeBase64DataUrl = (raw: string) =>
		/^data:[^;]+;base64,/i.test((raw || "").trim());
	const looksLikeBlobUrl = (raw: string) =>
		(raw || "").trim().toLowerCase().startsWith("blob:");

	const walk = (v: any): any => {
		if (v === null || v === undefined) return v;
		if (typeof v === "string") {
			if (looksLikeBase64DataUrl(v) || looksLikeBlobUrl(v)) return undefined;
			return v;
		}
		if (typeof v !== "object") return v;
		if (seen.has(v)) return undefined;
		seen.add(v);

		if (Array.isArray(v)) {
			const out: any[] = [];
			for (const item of v) {
				const next = walk(item);
				if (next !== undefined) out.push(next);
			}
			return out;
		}

		const out: Record<string, any> = {};
		for (const [key, val] of Object.entries(v)) {
			if (key === "measured") continue;
			const next = walk(val);
			if (next !== undefined) out[key] = next;
		}
		return out;
	};

	return walk(value);
}

function attachFlowScopeMeta(
	value: unknown,
	input: { scopeType?: string; scopeId?: string | null },
): unknown {
	const root =
		value && typeof value === "object" && !Array.isArray(value)
			? { ...(value as Record<string, unknown>) }
			: {};
	const scopeType = input.scopeType ?? null;
	const scopeId =
		typeof input.scopeId === "string" && input.scopeId.trim()
			? input.scopeId.trim()
			: null;
	if (!scopeType || !scopeId) {
		return root;
	}
	return {
		...root,
		__canvasFlowScope: {
			scopeType,
			scopeId,
		},
	};
}

export async function listUserFlows(
	c: AppContext,
	userId: string,
	projectId?: string,
	scope?: { scopeType?: string; scopeId?: string },
) {
	void userId;
	const rows = await listFlowsByOwner(c.env.DB, userId, projectId);
	return rows.map((r) => {
		const dto = mapFlowRowToDto(r);
		return {
			...dto,
			data: sanitizeFlowDataForStorage(dto.data ?? {}),
		};
	}).filter((dto) => {
		if (!scope?.scopeType && !scope?.scopeId) return true;
		if (scope?.scopeType && dto.scopeType !== scope.scopeType) return false;
		if (scope?.scopeId && dto.scopeId !== scope.scopeId) return false;
		return true;
	});
}

export async function getUserFlow(
	c: AppContext,
	id: string,
	userId: string,
) {
	void userId;
	const row = await getFlowForOwner(c.env.DB, id, userId);
	if (!row) {
		// align with stricter semantics; frontend treats 4xx as generic error
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	const dto = mapFlowRowToDto(row);
	return {
		...dto,
		data: sanitizeFlowDataForStorage(dto.data ?? {}),
	};
}

export async function upsertUserFlow(
	c: AppContext,
	userId: string,
	input: {
		id?: string;
		name: string;
		data: unknown;
		projectId?: string | null;
		baseUpdatedAt?: string | null;
		scopeType?: string;
		scopeId?: string | null;
		allowEmptyGraphOverwrite?: true;
	},
) {
	void userId;
	const nowIso = new Date().toISOString();
	const normalizedProjectId =
		typeof input.projectId === "string" && input.projectId.trim()
			? input.projectId.trim()
			: null;
	if (normalizedProjectId) {
		const project = await getProjectForOwner(c.env.DB, normalizedProjectId, userId);
		if (!project) {
			setTraceStage(c, "flow:upsert:project_missing", {
				userId,
				flowId: input.id ?? null,
				projectId: normalizedProjectId,
				name: input.name,
			});
			throw new AppError("Project not found", {
				status: 404,
				code: "project_not_found",
				details: {
					projectId: normalizedProjectId,
				},
			});
		}
	}
	let sanitizedData = attachFlowScopeMeta(
		sanitizeFlowDataForStorage(input.data ?? {}),
		{ scopeType: input.scopeType, scopeId: input.scopeId },
	);
	let dataJson = JSON.stringify(sanitizedData ?? {});
	let nextShape = summarizeGraphShape(sanitizedData);
	setTraceStage(c, "flow:upsert:begin", {
		userId,
		flowId: input.id ?? null,
		projectId: normalizedProjectId,
		name: input.name,
		nextShape,
	});

	if (input.id) {
		const existing = await getFlowForOwner(c.env.DB, input.id, userId);
		if (!existing) {
			appendTraceEvent(c, "flow:upsert:missing_existing", {
				flowId: input.id,
				projectId: normalizedProjectId,
			});
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
			});
		}
		sanitizedData = reconcilePptMasterGraphIdentities(
			sanitizeFlowDataForStorage(mapFlowRowToDto(existing).data ?? {}),
			sanitizedData,
		) as typeof sanitizedData;
		dataJson = JSON.stringify(sanitizedData ?? {});
		nextShape = summarizeGraphShape(sanitizedData);
		const existingShape = summarizeGraphShape(mapFlowRowToDto(existing).data);
		appendTraceEvent(c, "flow:upsert:existing_loaded", {
			flowId: input.id,
			projectId: normalizedProjectId,
			existingShape,
			nextShape,
		});
		const baseUpdatedAt =
			typeof input.baseUpdatedAt === "string" && input.baseUpdatedAt.trim()
				? input.baseUpdatedAt.trim()
				: "";
		if (!baseUpdatedAt) {
			setTraceStage(c, "flow:upsert:missing_base_updated_at", {
				flowId: input.id,
				projectId: normalizedProjectId,
				currentUpdatedAt: existing.updated_at,
				existingShape,
				nextShape,
			});
			throw new AppError("baseUpdatedAt is required for updating an existing flow", {
				status: 400,
				code: "base_updated_at_required",
				details: {
					flowId: input.id,
					currentUpdatedAt: existing.updated_at,
				},
			});
		}
		if (existing.updated_at !== baseUpdatedAt) {
			throwStaleSnapshotError(c, {
				flowId: input.id,
				projectId: normalizedProjectId,
				baseUpdatedAt,
				currentUpdatedAt: existing.updated_at,
				incomingShape: nextShape,
				currentShape: existingShape,
			});
		}
		if (
			nextShape.isExplicitGraph
			&& nextShape.nodeCount === 0
			&& nextShape.edgeCount === 0
			&& existingShape.nodeCount > 0
			&& input.allowEmptyGraphOverwrite !== true
		) {
			setTraceStage(c, "flow:upsert:blocked_empty_overwrite", {
				flowId: input.id,
				projectId: normalizedProjectId,
				existingShape,
				nextShape,
			});
			throw new AppError("Refusing to overwrite a non-empty flow with an empty graph", {
				status: 409,
				code: "empty_flow_overwrite_blocked",
				details: {
					flowId: input.id,
					existingNodeCount: existingShape.nodeCount,
					existingEdgeCount: existingShape.edgeCount,
				},
			});
		}
		const updated = await updateFlowIfUpdatedAtMatches(c.env.DB, {
			id: input.id,
			name: input.name,
			data: dataJson,
			ownerId: userId,
			projectId: normalizedProjectId,
			baseUpdatedAt,
			nowIso,
		});
		if (!updated) {
			const current = await getFlowForOwner(c.env.DB, input.id, userId);
			const currentShape = current
				? summarizeGraphShape(mapFlowRowToDto(current).data)
				: { nodeCount: 0, edgeCount: 0, isExplicitGraph: false };
			throwStaleSnapshotError(c, {
				flowId: input.id,
				projectId: normalizedProjectId,
				baseUpdatedAt,
				currentUpdatedAt: current?.updated_at ?? null,
				incomingShape: nextShape,
				currentShape,
			});
		}
		await createFlowVersion(c.env.DB, {
			id: crypto.randomUUID(),
			flowId: updated.id,
			name: updated.name,
			data: updated.data,
			userId,
			nowIso,
			reason: "manual_save",
			label: null,
		});
		setTraceStage(c, "flow:upsert:updated", {
			flowId: updated.id,
			projectId: updated.project_id ?? normalizedProjectId,
			nextShape,
		});
		syncCanvasNodesToAssets(c.env.DB, userId, normalizedProjectId, sanitizedData).catch(() => {});
		return mapFlowRowToDto(updated);
	}

	sanitizedData = reconcilePptMasterGraphIdentities(null, sanitizedData) as typeof sanitizedData;
	dataJson = JSON.stringify(sanitizedData ?? {});
	nextShape = summarizeGraphShape(sanitizedData);
	const id = crypto.randomUUID();
	const created = await createFlow(c.env.DB, {
		id,
		name: input.name,
		data: dataJson,
		ownerId: userId,
		projectId: normalizedProjectId,
		nowIso,
	});
	await createFlowVersion(c.env.DB, {
		id: crypto.randomUUID(),
		flowId: created.id,
		name: created.name,
		data: created.data,
		userId,
		nowIso,
		reason: "manual_save",
		label: "initial-save",
	});
	setTraceStage(c, "flow:upsert:created", {
		flowId: created.id,
		projectId: created.project_id ?? normalizedProjectId,
		nextShape,
	});
	syncCanvasNodesToAssets(c.env.DB, userId, normalizedProjectId, sanitizedData).catch(() => {});
	return mapFlowRowToDto(created);
}

export async function deleteUserFlow(
	c: AppContext,
	id: string,
	userId: string,
) {
	void userId;
	// Ensure it belongs to the user
	const existing = await getFlowForOwner(c.env.DB, id, userId);
	if (!existing) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	await deleteFlowById(c.env.DB, id, userId);
}

export async function listUserFlowVersions(
	c: AppContext,
	flowId: string,
	userId: string,
) {
	void userId;
	// Ensure flow belongs to user
	const flow = await getFlowForOwner(c.env.DB, flowId, userId);
	if (!flow) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	const versions = await listFlowVersions(c.env.DB, flowId, { audience: "user" });
	return versions.map((v) => ({
		id: v.id,
		name: v.name,
		label: v.label,
		reason: v.reason,
		createdAt: v.created_at,
	}));
}

export async function rollbackUserFlow(
	c: AppContext,
	flowId: string,
	params: { versionId: string; baseUpdatedAt: string },
	userId: string,
) {
	const baseUpdatedAt = (params.baseUpdatedAt ?? "").trim();
	if (!baseUpdatedAt) {
		throw new AppError("baseUpdatedAt is required", {
			status: 400,
			code: "base_updated_at_required",
		});
	}
	const versionId = (params.versionId ?? "").trim();
	if (!versionId) {
		throw new AppError("versionId is required", {
			status: 400,
			code: "version_id_required",
		});
	}

	const flow = await getFlowForOwner(c.env.DB, flowId, userId);
	if (!flow) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	if (flow.updated_at !== baseUpdatedAt) {
		throw new AppError("Flow snapshot is stale", {
			status: 409,
			code: "flow_snapshot_stale",
			details: {
				flowId,
				baseUpdatedAt,
				currentUpdatedAt: flow.updated_at,
			},
		});
	}

	const version = await getFlowVersion(c.env.DB, versionId, flowId, userId);
	if (!version) {
		throw new AppError("version not found", {
			status: 404,
			code: "version_not_found",
		});
	}

	const nowIso = new Date().toISOString();
	let sanitizedVersionData: string;
	try {
		const parsed = JSON.parse(version.data ?? "{}");
		const sanitized = sanitizeFlowDataForStorage(parsed) ?? {};
		sanitizedVersionData = JSON.stringify(reconcilePptMasterGraphIdentities(
			mapFlowRowToDto(flow).data,
			sanitized,
		));
	} catch (err: unknown) {
		const reason = err instanceof Error && err.message ? err.message : "unknown parse error";
		setTraceStage(c, "flow:rollback:invalid_version_data", {
			flowId,
			versionId,
			reason,
		});
		throw new AppError("Flow version data is invalid; rollback aborted", {
			status: 500,
			code: "flow_version_data_invalid",
			details: {
				flowId,
				versionId,
				reason,
			},
		});
	}
	const updated = await updateFlowIfUpdatedAtMatches(c.env.DB, {
		id: flowId,
		name: version.name,
		data: sanitizedVersionData,
		ownerId: userId,
		projectId: flow.project_id,
		baseUpdatedAt,
		nowIso,
	});
	if (!updated) {
		throw new AppError("Flow snapshot is stale", {
			status: 409,
			code: "flow_snapshot_stale",
			details: { flowId, baseUpdatedAt },
		});
	}

	await createFlowVersion(c.env.DB, {
		id: crypto.randomUUID(),
		flowId,
		name: updated.name,
		data: updated.data,
		userId,
		nowIso,
		reason: "rollback",
		label: `restored-from:${version.id.slice(0, 8)}`,
	});

	return mapFlowRowToDto(updated);
}

export async function createUserManualFlowVersion(
	c: AppContext,
	flowId: string,
	label: string,
	userId: string,
): Promise<{ id: string; name: string; label: string | null; reason: "manual_save"; createdAt: string }> {
	const trimmed = label.trim();
	if (!trimmed) {
		throw new AppError("label is required", {
			status: 400,
			code: "label_required",
		});
	}
	if (trimmed.length > 120) {
		throw new AppError("label too long", {
			status: 400,
			code: "label_too_long",
		});
	}

	const flow = await getFlowForOwner(c.env.DB, flowId, userId);
	if (!flow) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}

	const nowIso = new Date().toISOString();
	const versionId = crypto.randomUUID();
	await createFlowVersion(c.env.DB, {
		id: versionId,
		flowId,
		name: flow.name,
		data: flow.data,
		userId,
		nowIso,
		reason: "manual_save",
		label: trimmed,
	});

	return {
		id: versionId,
		name: flow.name,
		label: trimmed,
		reason: "manual_save",
		createdAt: nowIso,
	};
}
