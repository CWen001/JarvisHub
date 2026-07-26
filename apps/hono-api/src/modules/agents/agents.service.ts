import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import path from "node:path";
import { isAdminRequest } from "../workspace/admin";
import { getProjectById, getProjectForOwner } from "../project/project.repo";
import { getFlowForOwner } from "../flow/flow.repo";
import {
	listExecutionEvents,
	listExecutionsForOwnerFlow,
	listNodeRunsForExecutionOwner,
	mapExecutionEventRow,
	mapExecutionRow,
	mapNodeRunRow,
} from "../execution/execution.repo";
import {
	maybeStartAgentsBridgeOnDemand,
	readAgentsBridgeTimeoutMs,
	readAgentsBridgeToken,
	runAgentsBridgeChatTask,
} from "../task/task.agents-bridge";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import {
	AgentSkillSchema,
	AgentPipelineRunSchema,
	type AgentDiagnosticsResponseDto,
	type ProjectWorkspaceContextDto,
	type UpdateGlobalWorkspaceContextFileRequestDto,
	type UpdateProjectWorkspaceContextFileRequestDto,
	type AgentSkillDto,
	type RuntimeAgentSkillDto,
	type RuntimeAgentSkillsResponseDto,
	type AgentPipelineRunDto,
	type UpsertAgentSkillRequestDto,
	type CreateAgentPipelineRunRequestDto,
	type UpdateAgentPipelineRunStatusRequestDto,
	type ProjectWorkspaceContextVerifyResponseDto,
	type RollbackGlobalWorkspaceContextFileRequestDto,
	type RollbackProjectWorkspaceContextFileRequestDto,
} from "./agents.schemas";
import {
	createAgentPipelineRunRow,
	deleteAgentSkillRow,
	getAgentPipelineRunRowById,
	getAgentSkillRowById,
	getAgentSkillRowByKey,
	listAgentPipelineRunsRows,
	listAgentSkillsRows,
	updateAgentPipelineRunRow,
	upsertAgentSkillRow,
	type AgentPipelineRunRow,
	type AgentSkillRow,
} from "./agents.repo";
import { listUserExecutionTraces } from "../memory/memory.service";
import {
	listRecentPublicChatTurnRuns,
	type PublicChatTurnRunRow,
} from "../apiKey/public-chat-session.repo";
import {
	ensureProjectWorkspaceContextFiles,
	getGlobalWorkspaceContextFileVersionContent,
	getProjectWorkspaceContext,
	getProjectWorkspaceContextFileVersionContent,
	rollbackGlobalWorkspaceContextFileVersion,
	rollbackProjectWorkspaceContextFileVersion,
	updateGlobalWorkspaceContextFile,
	updateProjectWorkspaceContextFile,
	type ProjectWorkspaceContextFileDto,
	type ProjectWorkspaceContextFileVersionContentDto,
} from "./project-context.service";

function requireAdmin(c: AppContext): void {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
}

function normalizeKey(value: unknown): string {
	const trimmed = typeof value === "string" ? value.trim() : "";
	return trimmed;
}

function extractTraceMetaValue(
	meta: Record<string, unknown> | null,
	key: string,
): string {
	if (!meta) return "";
	const value = meta[key];
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	return trimmed ? trimmed : "";
}

function matchesDiagnosticsFilter(
	meta: Record<string, unknown> | null,
	input: {
		projectId?: string;
		label?: string;
	},
): boolean {
	const projectId = input.projectId ? extractTraceMetaValue(meta, "projectId") : "";
	const label = input.label ? extractTraceMetaValue(meta, "label") : "";
	if (input.projectId && projectId !== input.projectId) return false;
	if (input.label && label !== input.label) return false;
	return true;
}

function normalizeOptionalString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function parseJsonValue<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

type FlowGraphNode = {
	id: string;
	type?: string;
	data?: Record<string, unknown>;
	position?: unknown;
};

type FlowGraphEdge = {
	id?: string;
	source: string;
	target: string;
};

type NodeContextSummary = {
	nodeId: string;
	type: string | null;
	kind: string | null;
	label: string | null;
	prompt: string | null;
	content: string | null;
	imageUrl: string | null;
	videoUrl: string | null;
	imageResults: unknown[];
	videoResults: unknown[];
	storyBeatPlan: unknown[];
	data: Record<string, unknown>;
};

function parseFlowGraphData(raw: string): {
	nodes: FlowGraphNode[];
	edges: FlowGraphEdge[];
} {
	const parsed = parseJsonValue<unknown>(raw, null);
	if (!isRecord(parsed)) return { nodes: [], edges: [] };
	const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
	const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
	return {
		nodes: rawNodes
			.filter((item): item is Record<string, unknown> => isRecord(item))
			.map((item) => ({
				id: typeof item.id === "string" ? item.id : "",
				type: typeof item.type === "string" ? item.type : undefined,
				data: isRecord(item.data) ? item.data : {},
				position: item.position,
			}))
			.filter((item) => item.id.trim().length > 0),
		edges: rawEdges
			.filter((item): item is Record<string, unknown> => isRecord(item))
			.map((item) => ({
				id: typeof item.id === "string" ? item.id : undefined,
				source: typeof item.source === "string" ? item.source : "",
				target: typeof item.target === "string" ? item.target : "",
			}))
			.filter((item) => item.source.trim().length > 0 && item.target.trim().length > 0),
	};
}

function readFirstResultUrl(value: unknown): string | null {
	if (!Array.isArray(value)) return null;
	for (const item of value) {
		if (!isRecord(item)) continue;
		const url = normalizeOptionalString(item.url);
		if (url) return url;
	}
	return null;
}

function readArrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function summarizeFlowNode(node: FlowGraphNode): NodeContextSummary {
	const data = node.data ?? {};
	const imageUrl =
		normalizeOptionalString(data.imageUrl) ||
		readFirstResultUrl(data.imageResults);
	const videoUrl =
		normalizeOptionalString(data.videoUrl) ||
		readFirstResultUrl(data.videoResults);
	return {
		nodeId: node.id,
		type: normalizeOptionalString(node.type),
		kind: normalizeOptionalString(data.kind),
		label: normalizeOptionalString(data.label),
		prompt: normalizeOptionalString(data.prompt),
		content: normalizeOptionalString(data.content),
		imageUrl,
		videoUrl,
		imageResults: readArrayValue(data.imageResults),
		videoResults: readArrayValue(data.videoResults),
		storyBeatPlan: readArrayValue(data.storyBeatPlan),
		data,
	};
}

function isVideoNodeSummary(node: NodeContextSummary): boolean {
	const kind = String(node.kind || "").trim().toLowerCase();
	return kind === "video" || kind === "composevideo";
}

function mapPublicChatTurnRunRow(row: PublicChatTurnRunRow) {
	return {
		id: row.id,
		sessionId: row.session_id,
		sessionKey: row.session_key,
		requestId: normalizeOptionalString(row.request_id),
		projectId: normalizeOptionalString(row.project_id),
		label: normalizeOptionalString(row.label),
		workflowKey: row.workflow_key,
		requestKind: row.request_kind,
		userMessageId: normalizeOptionalString(row.user_message_id),
		assistantMessageId: normalizeOptionalString(row.assistant_message_id),
		outputMode: row.output_mode,
		turnVerdict: row.turn_verdict,
		turnVerdictReasons: parseJsonValue<string[]>(row.turn_verdict_reasons_json, []),
		runOutcome: row.run_outcome,
		agentDecision: parseJsonValue<Record<string, unknown> | null>(row.agent_decision_json, null),
		toolStatusSummary: parseJsonValue<Record<string, unknown> | null>(
			row.tool_status_summary_json,
			null,
		),
		diagnosticFlags: parseJsonValue<Array<Record<string, unknown>>>(
			row.diagnostic_flags_json,
			[],
		),
		canvasPlan: parseJsonValue<Record<string, unknown> | null>(row.canvas_plan_json, null),
		assetCount: Math.max(0, Math.trunc(Number(row.asset_count || 0))),
		canvasWrite: Number(row.canvas_write || 0) === 1,
		runMs:
			typeof row.run_ms === "number" && Number.isFinite(row.run_ms)
				? Math.max(0, Math.trunc(row.run_ms))
				: null,
		createdAt: row.created_at,
	} as const;
}

function normalizeRequiredString(value: unknown, label: string): string {
	const trimmed = typeof value === "string" ? value.trim() : "";
	if (!trimmed) {
		throw new AppError(`${label} 不能为空`, {
			status: 400,
			code: "invalid_request",
		});
	}
	return trimmed;
}

function mapAgentSkillRow(row: AgentSkillRow): AgentSkillDto {
	return AgentSkillSchema.parse({
		id: row.id,
		key: row.key,
		name: row.name,
		description: row.description ?? null,
		content: row.content,
		enabled: Number(row.enabled ?? 1) !== 0,
		visible: Number(row.visible ?? 1) !== 0,
		sortOrder:
			typeof row.sort_order === "number" && Number.isFinite(row.sort_order)
				? Math.trunc(row.sort_order)
				: row.sort_order ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

function parseJsonSafe(value: string | null | undefined): unknown {
	if (typeof value !== "string" || !value.trim()) return undefined;
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

function truncateForLog(value: unknown, max = 2000): string {
	const text = String(value ?? "");
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

function mapAgentPipelineRunRow(row: AgentPipelineRunRow): AgentPipelineRunDto {
	const parsedStages = parseJsonSafe(row.stages_json);
	const stages = Array.isArray(parsedStages) ? parsedStages : [];
	return AgentPipelineRunSchema.parse({
		id: row.id,
		ownerId: "local-workspace",
		projectId: row.project_id,
		title: row.title,
		goal: row.goal ?? null,
		status: row.status,
		stages,
		progress: parseJsonSafe(row.progress_json),
		result: parseJsonSafe(row.result_json),
		errorMessage: row.error_message ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		startedAt: row.started_at ?? null,
		finishedAt: row.finished_at ?? null,
	});
}

const DEFAULT_PUBLIC_AGENT_SKILL_KEY = "skill_default";

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeAgentsRuntimeSkillItem(
	value: unknown,
	refreshedAt: string,
): RuntimeAgentSkillDto | null {
	if (!isRecord(value)) return null;
	const name = typeof value.name === "string" ? value.name.trim() : "";
	const description =
		typeof value.description === "string" ? value.description.trim() : "";
	if (!name || !description) return null;
	return {
		id: `runtime:${name}`,
		key: name,
		name,
		description,
		source: "agents-cli",
		enabled: true,
		visible: true,
		sortOrder: null,
		createdAt: refreshedAt,
		updatedAt: refreshedAt,
	};
}

function normalizeAgentsRuntimeSkillsResponse(
	value: unknown,
): RuntimeAgentSkillsResponseDto {
	if (!isRecord(value)) {
		throw new AppError("Agents runtime skills 响应不是合法对象", {
			status: 502,
			code: "agents_runtime_skills_invalid_response",
		});
	}
	const source = typeof value.source === "string" ? value.source.trim() : "";
	if (source !== "agents-cli") {
		throw new AppError("Agents runtime skills 来源无效", {
			status: 502,
			code: "agents_runtime_skills_invalid_source",
			details: { source },
		});
	}
	const refreshedAt =
		typeof value.refreshedAt === "string" && value.refreshedAt.trim()
			? value.refreshedAt.trim()
			: new Date().toISOString();
	const rawSkills = Array.isArray(value.skills) ? value.skills : null;
	if (!rawSkills) {
		throw new AppError("Agents runtime skills 缺少 skills 数组", {
			status: 502,
			code: "agents_runtime_skills_missing_skills",
		});
	}
	const rawLoadErrors = Array.isArray(value.loadErrors) ? value.loadErrors : null;
	if (!rawLoadErrors) {
		throw new AppError("Agents runtime skills 缺少 loadErrors 数组", {
			status: 502,
			code: "agents_runtime_skills_missing_load_errors",
		});
	}
	const loadErrors: string[] = [];
	for (const entry of rawLoadErrors) {
		if (typeof entry !== "string") {
			throw new AppError("Agents runtime skills loadErrors 含非字符串条目", {
				status: 502,
				code: "agents_runtime_skills_invalid_load_errors",
			});
		}
		loadErrors.push(entry);
	}
	const skills = rawSkills
		.map((item) => normalizeAgentsRuntimeSkillItem(item, refreshedAt))
		.filter((item): item is RuntimeAgentSkillDto => item !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
	return { skills, loadErrors };
}

async function fetchAgentsRuntimeSkills(
	baseUrl: string,
	token: string | null,
	timeoutMs: number,
): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort();
	}, Math.max(5_000, Math.min(timeoutMs, 60_000)));
	try {
		const headers: Record<string, string> = {
			Accept: "application/json",
		};
		if (token) headers.Authorization = `Bearer ${token}`;
		const response = await fetch(`${baseUrl}/skills`, {
			method: "GET",
			headers,
			signal: controller.signal,
		});
		const body = await response.json().catch((): unknown => null);
		if (!response.ok) {
			throw new AppError("Agents runtime skills 获取失败", {
				status: 502,
				code: "agents_runtime_skills_upstream_failed",
				details: {
					status: response.status,
					body,
				},
			});
		}
		return body;
	} catch (error) {
		if (error instanceof AppError) throw error;
		throw new AppError("Agents runtime skills 请求失败", {
			status: 502,
			code: "agents_runtime_skills_fetch_failed",
			details: {
				message: error instanceof Error ? error.message : String(error),
			},
		});
	} finally {
		clearTimeout(timeout);
	}
}

export async function getPublicAgentSkill(
	c: AppContext,
): Promise<AgentSkillDto | null> {
	const byKey = await getAgentSkillRowByKey(
		c.env.DB,
		DEFAULT_PUBLIC_AGENT_SKILL_KEY,
	);
	if (byKey) {
		const enabled = Number(byKey.enabled ?? 1) !== 0;
		const visible = Number(byKey.visible ?? 1) !== 0;
		return enabled && visible ? mapAgentSkillRow(byKey) : null;
	}

	const rows = await listAgentSkillsRows(c.env.DB, { enabled: true, visible: true });
	const merged = rows.map(mapAgentSkillRow);
	const first = merged[0];
	return first ?? null;
}

export async function listPublicAgentSkills(
	c: AppContext,
): Promise<AgentSkillDto[]> {
	const rows = await listAgentSkillsRows(c.env.DB, { enabled: true, visible: true });
	return rows.map(mapAgentSkillRow);
}

export async function listRuntimeAgentSkills(
	c: AppContext,
): Promise<RuntimeAgentSkillsResponseDto> {
	const baseUrl = await maybeStartAgentsBridgeOnDemand(c);
	if (!baseUrl) {
		throw new AppError("Agents bridge 未配置，无法读取 runtime skills", {
			status: 503,
			code: "agents_runtime_skills_bridge_unavailable",
		});
	}
	const body = await fetchAgentsRuntimeSkills(
		baseUrl,
		readAgentsBridgeToken(c),
		readAgentsBridgeTimeoutMs(c),
	);
	return normalizeAgentsRuntimeSkillsResponse(body);
}

export async function listAdminAgentSkills(
	c: AppContext,
): Promise<AgentSkillDto[]> {
	requireAdmin(c);
	const rows = await listAgentSkillsRows(c.env.DB);
	return rows.map(mapAgentSkillRow);
}

export async function upsertAdminAgentSkill(
	c: AppContext,
	input: UpsertAgentSkillRequestDto,
): Promise<AgentSkillDto> {
	requireAdmin(c);

	const requestedId =
		typeof input.id === "string" && input.id.trim() ? input.id.trim() : "";
	const requestedKey = normalizeKey(input.key);

	const existingById = requestedId
		? await getAgentSkillRowById(c.env.DB, requestedId)
		: null;
	if (existingById && requestedKey && requestedKey !== existingById.key) {
		throw new AppError("key 不允许修改", {
			status: 400,
			code: "invalid_request",
		});
	}
	const existingByKey =
		!existingById && requestedKey
			? await getAgentSkillRowByKey(c.env.DB, requestedKey)
			: null;
	const existing: AgentSkillRow | null = existingById || existingByKey;

	const key =
		requestedKey ||
		existing?.key ||
		`skill_${crypto.randomUUID()}`;
	const id = existing?.id || requestedId || crypto.randomUUID();

	const name = normalizeRequiredString(
		normalizeOptionalString(input.name) || existing?.name || key,
		"name",
	);

	const hasDescription = Object.prototype.hasOwnProperty.call(
		input,
		"description",
	);
	const description = hasDescription
		? normalizeOptionalString(input.description)
		: (existing?.description ?? null);

	const hasContent = Object.prototype.hasOwnProperty.call(input, "content");
	const content = hasContent
		? normalizeRequiredString(input.content, "content")
		: existing
			? existing.content
			: normalizeRequiredString(input.content, "content");

	const enabled =
		typeof input.enabled === "boolean"
			? input.enabled
			: existing
				? Number(existing.enabled ?? 1) !== 0
				: true;
	const visible =
		typeof input.visible === "boolean"
			? input.visible
			: existing
				? Number(existing.visible ?? 1) !== 0
				: true;
	const sortOrder = (() => {
		if (Object.prototype.hasOwnProperty.call(input, "sortOrder")) {
			if (typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)) {
				return Math.trunc(input.sortOrder);
			}
			return input.sortOrder === null ? null : null;
		}
		if (existing) {
			return typeof existing.sort_order === "number" && Number.isFinite(existing.sort_order)
				? Math.trunc(existing.sort_order)
				: existing.sort_order ?? null;
		}
		return null;
	})();

	const nowIso = new Date().toISOString();
	const row = await upsertAgentSkillRow(
		c.env.DB,
		{
			id,
			key,
			name,
			description,
			content,
			enabled,
			visible,
			sortOrder,
		},
		nowIso,
	);
	return mapAgentSkillRow(row);
}

export async function deleteAdminAgentSkill(
	c: AppContext,
	id: string,
): Promise<void> {
	requireAdmin(c);
	const existing = await getAgentSkillRowById(c.env.DB, id);
	if (!existing) {
		throw new AppError("未找到该 skill", {
			status: 404,
			code: "skill_not_found",
		});
	}
	await deleteAgentSkillRow(c.env.DB, id);
}

export async function getAdminAgentSkillById(
	c: AppContext,
	id: string,
): Promise<AgentSkillDto> {
	requireAdmin(c);
	const row = await getAgentSkillRowById(c.env.DB, id);
	if (!row) {
		throw new AppError("未找到该 skill", {
			status: 404,
			code: "skill_not_found",
		});
	}
	return mapAgentSkillRow(row);
}

export async function createUserAgentPipelineRun(
	c: AppContext,
	userId: string,
	input: CreateAgentPipelineRunRequestDto,
): Promise<AgentPipelineRunDto> {
	const projectId = input.projectId.trim();
	const ownedProject = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!ownedProject) {
		throw new AppError("Project not found", {
			status: 400,
			code: "project_not_found",
		});
	}
	const nowIso = new Date().toISOString();
	const row = await createAgentPipelineRunRow(c.env.DB, {
		id: crypto.randomUUID(),
		ownerId: userId,
		projectId,
		title: input.title.trim(),
		goal:
			typeof input.goal === "string" && input.goal.trim()
				? input.goal.trim()
				: null,
		status: "queued",
		stagesJson: JSON.stringify(input.stages),
		nowIso,
	});
	return mapAgentPipelineRunRow(row);
}

async function assertProjectWorkspaceContextAccess(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<string> {
	if (isAdminRequest(c)) {
		const project = await getProjectById(c.env.DB, projectId);
		if (!project) {
			throw new AppError("Project not found", { status: 404, code: "project_not_found" });
		}
		return userId;
	}
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) {
		throw new AppError("Project not found or no permission", {
			status: 403,
			code: "project_context_forbidden",
			details: { projectId },
		});
	}
	return userId;
}

export async function getUserProjectWorkspaceContext(
	c: AppContext,
	userId: string,
	input: {
		projectId: string;
		refresh?: boolean;
	},
): Promise<ProjectWorkspaceContextDto> {
	const ownerId = await assertProjectWorkspaceContextAccess(c, userId, input.projectId);
	return getProjectWorkspaceContext({
		c,
		ownerId,
		projectId: input.projectId,
		...(input.refresh === true ? { refresh: true } : {}),
	});
}

export async function updateUserProjectWorkspaceContextFile(
	c: AppContext,
	userId: string,
	input: UpdateProjectWorkspaceContextFileRequestDto,
): Promise<ProjectWorkspaceContextDto> {
	const ownerId = await assertProjectWorkspaceContextAccess(c, userId, input.projectId);
	await updateProjectWorkspaceContextFile({
		c,
		ownerId,
		projectId: input.projectId,
		fileName: input.fileName,
		content: input.content,
	});
	return getProjectWorkspaceContext({
		c,
		ownerId,
		projectId: input.projectId,
	});
}

export async function updateAdminGlobalWorkspaceContextFile(
	c: AppContext,
	input: UpdateGlobalWorkspaceContextFileRequestDto,
): Promise<ProjectWorkspaceContextFileDto> {
	requireAdmin(c);
	return updateGlobalWorkspaceContextFile({
		fileName: input.fileName,
		content: input.content,
		updatedBy: "admin:" + String(c.get("userId") || "unknown"),
	});
}

export async function getUserProjectWorkspaceContextFileVersion(
	c: AppContext,
	userId: string,
	input: { projectId: string; fileName: string; versionId: string },
): Promise<ProjectWorkspaceContextFileVersionContentDto> {
	const ownerId = await assertProjectWorkspaceContextAccess(c, userId, input.projectId);
	return getProjectWorkspaceContextFileVersionContent({
		ownerId,
		projectId: input.projectId,
		fileName: input.fileName,
		versionId: input.versionId,
	});
}

export async function rollbackUserProjectWorkspaceContextFileVersion(
	c: AppContext,
	userId: string,
	input: RollbackProjectWorkspaceContextFileRequestDto,
): Promise<ProjectWorkspaceContextFileDto> {
	const ownerId = await assertProjectWorkspaceContextAccess(c, userId, input.projectId);
	return rollbackProjectWorkspaceContextFileVersion({
		ownerId,
		projectId: input.projectId,
		fileName: input.fileName,
		versionId: input.versionId,
		updatedBy: userId,
	});
}

export async function getAdminGlobalWorkspaceContextFileVersion(
	c: AppContext,
	input: { fileName: string; versionId: string },
): Promise<ProjectWorkspaceContextFileVersionContentDto> {
	requireAdmin(c);
	return getGlobalWorkspaceContextFileVersionContent({
		fileName: input.fileName,
		versionId: input.versionId,
	});
}

export async function rollbackAdminGlobalWorkspaceContextFileVersion(
	c: AppContext,
	input: RollbackGlobalWorkspaceContextFileRequestDto,
): Promise<ProjectWorkspaceContextFileDto> {
	requireAdmin(c);
	return rollbackGlobalWorkspaceContextFileVersion({
		fileName: input.fileName,
		versionId: input.versionId,
		updatedBy: "admin:" + String(c.get("userId") || "unknown"),
	});
}

export async function verifyUserProjectWorkspaceContext(
	c: AppContext,
	userId: string,
	input: { projectId: string },
): Promise<ProjectWorkspaceContextVerifyResponseDto> {
	const ownerId = await assertProjectWorkspaceContextAccess(c, userId, input.projectId);
	const ctx = await getProjectWorkspaceContext({
		c,
		ownerId,
		projectId: input.projectId,
	});

	const maxCharsPerFile = 3_000;
	const maxTotalChars = 12_000;
	let totalChars = 0;
	const files: Array<{
		layer: "global" | "project";
		path: string;
		charCount: number;
		truncated: boolean;
		updatedAt: string | null;
		updatedBy: string | null;
	}> = [];
	const warnings: string[] = [];

	const takeFiles = (items: ProjectWorkspaceContextFileDto[]) => {
		for (const item of items) {
			if (totalChars >= maxTotalChars) break;
			const raw = String(item.content || "");
			const remaining = Math.max(0, maxTotalChars - totalChars);
			const budget = Math.min(maxCharsPerFile, remaining);
			if (budget <= 0) break;
			const effective = raw.length > budget ? raw.slice(0, budget) : raw;
			const truncated = raw.length > effective.length;
			totalChars += effective.length;
			files.push({
				layer: item.layer,
				path: item.path,
				charCount: effective.length,
				truncated,
				updatedAt: item.updatedAt,
				updatedBy: item.updatedBy,
			});
		}
	};

	// Match agents-cli assembler order: roots include workspaceRoot first, then resourceRoots.
	// In this app, project context is the key runtime root (localResourcePaths).
	takeFiles(ctx.globalFiles);
	takeFiles(ctx.projectFiles);

	if (files.length === 0) warnings.push("No context files found under global/project context dirs.");
	if (totalChars >= maxTotalChars) warnings.push("Context hit maxTotalChars budget; later files were omitted.");
	if (files.some((f) => f.truncated)) warnings.push("Some files were truncated due to maxCharsPerFile budget.");

	return {
		projectId: ctx.projectId,
		ownerId: ctx.ownerId,
		projectRoot: ctx.projectRoot,
		globalContextDir: ctx.globalContextDir,
		projectContextDir: ctx.projectContextDir,
		budgets: { maxCharsPerFile, maxTotalChars },
		totalChars,
		files,
		warnings,
	};
}

export async function getAdminProjectWorkspaceContext(
	c: AppContext,
	userId: string,
	input: {
		projectId: string;
		refresh?: boolean;
	},
): Promise<ProjectWorkspaceContextDto> {
	requireAdmin(c);
	const ownerId = await assertProjectWorkspaceContextAccess(c, userId, input.projectId);
	return getProjectWorkspaceContext({
		c,
		ownerId,
		projectId: input.projectId,
		...(input.refresh === true ? { refresh: true } : {}),
	});
}

export async function getAdminAgentDiagnostics(
	c: AppContext,
	userId: string,
	input: {
		projectId?: string;
		label?: string;
		workflowKey?: string;
		turnVerdict?: "satisfied" | "partial" | "failed";
		runOutcome?: "promote" | "hold" | "discard";
		limit: number;
	},
): Promise<AgentDiagnosticsResponseDto> {
	requireAdmin(c);
	const traces = (await listUserExecutionTraces(c, userId, {
		limit: Math.max(input.limit * 3, 60),
		requestKindPrefix: "agents_bridge:",
	})).filter((item) => matchesDiagnosticsFilter(item.meta, input)).slice(0, input.limit);
	const publicChatRuns = (
		await listRecentPublicChatTurnRuns(c.env.DB, {
			userId,
			...(input.projectId ? { projectId: input.projectId, sessionKeyPrefix: `project:${input.projectId}` } : {}),
			...(input.label ? { label: input.label } : {}),
			...(input.workflowKey ? { workflowKey: input.workflowKey } : {}),
			...(input.turnVerdict ? { turnVerdict: input.turnVerdict } : {}),
			...(input.runOutcome ? { runOutcome: input.runOutcome } : {}),
			limit: input.limit,
		})
	).map(mapPublicChatTurnRunRow);
	return {
		projectId: input.projectId ?? null,
		label: input.label ?? null,
		traces,
		publicChatRuns,
	};
}

export async function getNodeContextBundle(input: {
	c: AppContext;
	ownerId: string;
	projectId: string;
	flowId: string;
	nodeId: string;
}) {
	const row = await getFlowForOwner(input.c.env.DB, input.flowId, input.ownerId);
	if (!row || row.project_id !== input.projectId) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}

	const graph = parseFlowGraphData(row.data);
	const targetNode = graph.nodes.find((node) => node.id === input.nodeId);
	if (!targetNode) {
		throw new AppError("Node not found", {
			status: 404,
			code: "node_not_found",
		});
	}
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	const upstreamNodes = graph.edges
		.filter((edge) => edge.target === input.nodeId)
		.map((edge) => nodesById.get(edge.source))
		.filter((node): node is FlowGraphNode => Boolean(node))
		.map(summarizeFlowNode);
	const downstreamNodes = graph.edges
		.filter((edge) => edge.source === input.nodeId)
		.map((edge) => nodesById.get(edge.target))
		.filter((node): node is FlowGraphNode => Boolean(node))
		.map(summarizeFlowNode);

	const executionRows = await listExecutionsForOwnerFlow(input.c.env.DB, {
		ownerId: input.ownerId,
		flowId: input.flowId,
		limit: 5,
	});
	const recentExecutions = await Promise.all(
		executionRows.map(async (execution) => {
			const [nodeRuns, events] = await Promise.all([
				listNodeRunsForExecutionOwner(input.c.env.DB, {
					ownerId: input.ownerId,
					executionId: execution.id,
				}),
				listExecutionEvents(input.c.env.DB, {
					executionId: execution.id,
					afterSeq: 0,
					limit: 100,
				}),
			]);
			return {
				...mapExecutionRow(execution),
				nodeRuns: nodeRuns.map(mapNodeRunRow),
				events: events.map(mapExecutionEventRow),
			};
		}),
	);
	const executionTraces = await listUserExecutionTraces(input.c, input.ownerId, {
		limit: 20,
		requestKindPrefix: "agents_bridge:",
	});

	return {
		projectId: input.projectId,
		flowId: input.flowId,
		node: summarizeFlowNode(targetNode),
		upstreamNodes,
		downstreamNodes,
		recentExecutions,
		diagnostics: {
			executionTraces: executionTraces.filter((trace) =>
				matchesDiagnosticsFilter(trace.meta, {
					projectId: input.projectId,
				}),
			),
		},
	};
}

export async function getVideoReviewBundle(input: {
	c: AppContext;
	ownerId: string;
	projectId: string;
	flowId: string;
	nodeId: string;
}) {
	const nodeContext = await getNodeContextBundle(input);
	if (!isVideoNodeSummary(nodeContext.node)) {
		throw new AppError("Selected node is not a video node", {
			status: 400,
			code: "node_not_video",
			details: {
				nodeId: input.nodeId,
				kind: nodeContext.node.kind,
			},
		});
	}
	const node = nodeContext.node;
	const referenceImages = Array.isArray(node.data?.referenceImages)
		? (node.data.referenceImages as string[]).filter((url: unknown) => typeof url === "string" && url.trim()).slice(0, 4)
		: [];
	return {
		projectId: input.projectId,
		flowId: input.flowId,
		nodeContext,
		videoNode: {
			nodeId: node.nodeId,
			kind: node.kind,
			label: node.label,
			prompt: node.prompt,
			videoUrl: node.videoUrl,
			videoResults: node.videoResults,
			storyBeatPlan: node.storyBeatPlan,
			referenceImages,
			duration: node.data?.duration ?? null,
			size: node.data?.size ?? null,
		},
		upstreamNodes: nodeContext.upstreamNodes.map((n) => ({
			nodeId: n.nodeId,
			kind: n.kind,
			label: n.label,
			imageUrl: n.imageUrl,
		})),
	};
}

export async function listUserAgentPipelineRuns(
	c: AppContext,
	userId: string,
	input?: { projectId?: string | null; limit?: number },
): Promise<AgentPipelineRunDto[]> {
	const rows = await listAgentPipelineRunsRows(c.env.DB, {
		ownerId: userId,
		projectId: input?.projectId ?? null,
		limit: input?.limit ?? 50,
	});
	return rows.map(mapAgentPipelineRunRow);
}

export async function getUserAgentPipelineRunById(
	c: AppContext,
	userId: string,
	id: string,
): Promise<AgentPipelineRunDto> {
	const row = await getAgentPipelineRunRowById(c.env.DB, { id, ownerId: userId });
	if (!row) {
		throw new AppError("Pipeline run not found", {
			status: 404,
			code: "pipeline_run_not_found",
		});
	}
	return mapAgentPipelineRunRow(row);
}

export async function updateUserAgentPipelineRunStatus(
	c: AppContext,
	userId: string,
	id: string,
	input: UpdateAgentPipelineRunStatusRequestDto,
): Promise<AgentPipelineRunDto> {
	const existing = await getAgentPipelineRunRowById(c.env.DB, { id, ownerId: userId });
	if (!existing) {
		throw new AppError("Pipeline run not found", {
			status: 404,
			code: "pipeline_run_not_found",
		});
	}

	const nowIso = new Date().toISOString();
	const hasErrorMessage = Object.prototype.hasOwnProperty.call(
		input,
		"errorMessage",
	);
	const nextErrorMessage = hasErrorMessage
		? input.errorMessage ?? null
		: existing.error_message ?? null;
	const startedAt =
		input.status === "running" && !existing.started_at ? nowIso : undefined;
	const finishedAt =
		input.status === "succeeded" ||
		input.status === "failed" ||
		input.status === "canceled"
			? nowIso
			: input.status === "running"
				? null
				: undefined;

	const updated = await updateAgentPipelineRunRow(c.env.DB, {
		id,
		ownerId: userId,
		status: input.status,
		progressJson:
			Object.prototype.hasOwnProperty.call(input, "progress")
				? JSON.stringify(input.progress ?? null)
				: undefined,
		resultJson:
			Object.prototype.hasOwnProperty.call(input, "result")
				? JSON.stringify(input.result ?? null)
				: undefined,
		errorMessage: nextErrorMessage,
		startedAt,
		finishedAt:
			typeof finishedAt === "undefined" ? existing.finished_at : finishedAt,
		nowIso,
	});
	if (!updated) {
		throw new AppError("Pipeline run not found", {
			status: 404,
			code: "pipeline_run_not_found",
		});
	}
	return mapAgentPipelineRunRow(updated);
}

function sanitizePathSegment(raw: string): string {
	return String(raw || "")
		.trim()
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.slice(0, 120);
}

function buildScopedProjectDataRoot(ownerId: string, projectId: string): string {
	void ownerId;
	return path.join(
		resolveProjectDataRepoRoot(process.cwd()),
		"project-data",
		"workspace",
		"projects",
		sanitizePathSegment(projectId),
	);
}

function buildProjectDataRoot(projectId: string, ownerId?: string): string {
	if (ownerId) return buildScopedProjectDataRoot(ownerId, projectId);
	return path.join(
		resolveProjectDataRepoRoot(process.cwd()),
		"project-data",
		sanitizePathSegment(projectId),
	);
}

function buildProjectAgentRunsRoot(projectId: string, ownerId?: string): string {
	return path.join(
		buildProjectDataRoot(projectId, ownerId),
		"agents-runs",
	);
}
