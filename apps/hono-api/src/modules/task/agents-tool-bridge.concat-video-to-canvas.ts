import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
	PublicFlowCreateTaskNodeSchema,
	PublicFlowGraphSchema,
	PublicFlowPatchResponseSchema,
	optionalNonEmptyString,
} from "../flow/flow.public.schemas";
import { applyPublicFlowGraphPatch } from "../flow/flow.public.service";
import {
	createFlowVersion,
	mapFlowRowToDto,
	updateFlow,
	updateFlowByIdUnsafe,
	type FlowRow,
} from "../flow/flow.repo";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import { uploadInlineAssetBytesToRustfs } from "./task.inline-asset-utils";
import { readTrimmedString } from "./agents-tool-bridge.video-result";

const DEFAULT_CONCAT_FPS = 30;
const DEFAULT_CONCAT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CONCAT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_CONCAT_SOURCES = 20;

export type VideoConcatProbeSummary = {
	nodeId: string | null;
	url: string;
	hasAudio: boolean;
};

export type VideoConcatRequestedAudioPolicy = "preserve" | "drop" | "auto";
export type VideoConcatEffectiveAudioPolicy = "preserve" | "drop";

export function decideEffectiveAudioPolicy(input: {
	requested: VideoConcatRequestedAudioPolicy;
	probes: ReadonlyArray<VideoConcatProbeSummary>;
}): VideoConcatEffectiveAudioPolicy {
	if (input.requested === "drop") return "drop";
	if (input.requested === "preserve") {
		const silent = input.probes.find((probe) => !probe.hasAudio);
		if (silent) {
			throw new AppError("视频拼接要求保留声音，但源视频缺少音轨", {
				status: 400,
				code: "video_concat_source_audio_missing",
				details: {
					nodeId: silent.nodeId,
					url: silent.url,
					requestedPolicy: "preserve",
				},
			});
		}
		return "preserve";
	}
	const allHaveAudio = input.probes.every((probe) => probe.hasAudio);
	const noneHaveAudio = input.probes.every((probe) => !probe.hasAudio);
	if (allHaveAudio) return "preserve";
	if (noneHaveAudio) return "drop";
	const audibleNodeIds = input.probes
		.filter((probe) => probe.hasAudio)
		.map((probe) => probe.nodeId);
	const silentNodeIds = input.probes
		.filter((probe) => !probe.hasAudio)
		.map((probe) => probe.nodeId);
	throw new AppError(
		"视频拼接 audioPolicy=auto 但源视频音轨状态混合，请显式指定 'preserve' 或 'drop'",
		{
			status: 400,
			code: "video_concat_source_audio_mixed",
			details: {
				audibleNodeIds,
				silentNodeIds,
				requestedPolicy: "auto",
			},
		},
	);
}

type FlowNodeRecord = Record<string, unknown> & {
	id?: unknown;
	type?: unknown;
	data?: unknown;
	position?: unknown;
	parentId?: unknown;
	style?: unknown;
};

type VideoConcatSource = {
	nodeId: string | null;
	url: string;
	label: string | null;
	order: number;
};

type VideoProbeInfo = {
	width: number;
	height: number;
	durationSeconds: number | null;
	hasAudio: boolean;
};

type CommandResult = {
	stdout: string;
	stderr: string;
};

type FlowGraphRecord = {
	nodes: unknown[];
	edges: unknown[];
	viewport?: unknown;
};

export function buildConcatSourceEdges(sourceNodeIds: string[], targetNodeId: string) {
	return sourceNodeIds.map((sourceNodeId, index) => ({
		id: `${sourceNodeId}-to-${targetNodeId}-concat-${index}`,
		source: sourceNodeId,
		target: targetNodeId,
		sourceHandle: "out-video",
		targetHandle: "in-any",
		type: "default",
		data: {
			role: "concat_source",
			relationshipKind: "aggregation",
			order: index + 1,
		},
	}));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumeric(value: unknown): number | null {
	const direct = readFiniteNumber(value);
	if (direct !== null) return direct;
	if (typeof value !== "string" || !value.trim()) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function normalizePositiveInteger(value: unknown): number | null {
	const parsed = readNumeric(value);
	if (parsed === null || parsed <= 0) return null;
	return Math.max(1, Math.trunc(parsed));
}

function clampTimeoutMs(value: unknown): number {
	const parsed = normalizePositiveInteger(value);
	if (!parsed) return DEFAULT_CONCAT_TIMEOUT_MS;
	return Math.min(Math.max(parsed, 5_000), MAX_CONCAT_TIMEOUT_MS);
}

function assertNodeRuntime(): void {
	const processRef = globalThis.process;
	if (!processRef?.versions?.node) {
		throw new AppError("视频拼接需要 Node.js runtime 与本地 ffmpeg", {
			status: 500,
			code: "video_concat_node_runtime_required",
		});
	}
}

function readNodeData(node: FlowNodeRecord | null): Record<string, unknown> {
	if (!node || !isRecord(node.data)) return {};
	return node.data;
}

function readNodeVideoUrl(node: FlowNodeRecord): string {
	const data = readNodeData(node);
	const direct = readTrimmedString(data.videoUrl);
	if (direct) return direct;
	const videoResults = Array.isArray(data.videoResults) ? data.videoResults : [];
	for (const item of videoResults) {
		if (!isRecord(item)) continue;
		const url = readTrimmedString(item.url);
		if (url) return url;
	}
	return "";
}

function readNodeLabel(node: FlowNodeRecord): string {
	const data = readNodeData(node);
	return readTrimmedString(data.label) || readTrimmedString(node.id);
}

function readSourceNodeIds(input: Record<string, unknown>): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const append = (value: unknown): void => {
		const nodeId = readTrimmedString(value);
		if (!nodeId || seen.has(nodeId)) return;
		seen.add(nodeId);
		out.push(nodeId);
	};
	if (Array.isArray(input.sourceNodeIds)) {
		for (const item of input.sourceNodeIds) append(item);
	}
	if (Array.isArray(input.nodeIds)) {
		for (const item of input.nodeIds) append(item);
	}
	if (Array.isArray(input.sources)) {
		for (const item of input.sources) {
			if (!isRecord(item)) continue;
			append(item.nodeId);
		}
	}
	return out;
}

function readDirectSources(input: Record<string, unknown>): VideoConcatSource[] {
	if (!Array.isArray(input.sources)) return [];
	const out: VideoConcatSource[] = [];
	for (const item of input.sources) {
		if (!isRecord(item)) continue;
		const url = readTrimmedString(item.url);
		if (!url) continue;
		out.push({
			nodeId: readTrimmedString(item.nodeId) || null,
			url,
			label: readTrimmedString(item.label) || readTrimmedString(item.name) || null,
			order: out.length,
		});
	}
	return out;
}

export function resolveConcatSourceVideosFromGraph(options: {
	graph: FlowGraphRecord;
	bodyArgs: unknown;
}): VideoConcatSource[] {
	if (!isRecord(options.bodyArgs)) {
		throw new AppError("Invalid video concat request", {
			status: 400,
			code: "invalid_video_concat_request",
		});
	}

	const directSources = readDirectSources(options.bodyArgs);
	const nodeIds = readSourceNodeIds(options.bodyArgs);
	const nodes = options.graph.nodes
		.filter(isRecord)
		.map((node): FlowNodeRecord => node);
	const nodeById = new Map<string, FlowNodeRecord>();
	for (const node of nodes) {
		const id = readTrimmedString(node.id);
		if (id) nodeById.set(id, node);
	}

	const sources: VideoConcatSource[] = [];
	const usedDirectNodeIds = new Set<string>();
	for (const source of directSources) {
		sources.push({ ...source, order: sources.length });
		if (source.nodeId) usedDirectNodeIds.add(source.nodeId);
	}
	for (const nodeId of nodeIds) {
		if (usedDirectNodeIds.has(nodeId)) continue;
		const node = nodeById.get(nodeId);
		if (!node) {
			throw new AppError("视频拼接源节点不存在", {
				status: 404,
				code: "video_concat_source_node_not_found",
				details: { nodeId },
			});
		}
		const url = readNodeVideoUrl(node);
		if (!url) {
			throw new AppError("视频拼接源节点缺少真实 videoUrl", {
				status: 400,
				code: "video_concat_source_url_missing",
				details: { nodeId },
			});
		}
		sources.push({
			nodeId,
			url,
			label: readNodeLabel(node) || null,
			order: sources.length,
		});
	}

	if (sources.length < 2) {
		throw new AppError("视频拼接至少需要 2 个源视频", {
			status: 400,
			code: "video_concat_requires_two_sources",
			details: { sourceCount: sources.length },
		});
	}
	if (sources.length > MAX_CONCAT_SOURCES) {
		throw new AppError("视频拼接源视频数量过多", {
			status: 400,
			code: "video_concat_too_many_sources",
			details: {
				sourceCount: sources.length,
				maxSourceCount: MAX_CONCAT_SOURCES,
			},
		});
	}
	return sources;
}

function buildOutputParentId(options: {
	bodyArgs: Record<string, unknown>;
	graph: FlowGraphRecord;
	sourceNodeIds: string[];
}): string | undefined {
	const outputNode = isRecord(options.bodyArgs.outputNode)
		? options.bodyArgs.outputNode
		: {};
	const explicitParentId = readTrimmedString(outputNode.parentId);
	if (explicitParentId) return explicitParentId;
	const nodes = options.graph.nodes
		.filter(isRecord)
		.map((node): FlowNodeRecord => node);
	const nodeById = new Map<string, FlowNodeRecord>();
	for (const node of nodes) {
		const id = readTrimmedString(node.id);
		if (id) nodeById.set(id, node);
	}
	const parentIds = options.sourceNodeIds
		.map((id) => readTrimmedString(nodeById.get(id)?.parentId))
		.filter(Boolean);
	if (!parentIds.length) return undefined;
	const first = parentIds[0];
	return parentIds.every((id) => id === first) ? first : undefined;
}

function runCommand(options: {
	command: string;
	args: string[];
	timeoutMs: number;
	errorCode: string;
	errorMessage: string;
}): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(options.command, options.args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(
				new AppError(options.errorMessage, {
					status: 500,
					code: options.errorCode,
					details: { timeoutMs: options.timeoutMs },
				}),
			);
		}, options.timeoutMs);

		child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
		child.on("error", (err: NodeJS.ErrnoException) => {
			clearTimeout(timer);
			const missing = err.code === "ENOENT";
			reject(
				new AppError(
					missing ? `${options.command} 未安装或不在 PATH 中` : options.errorMessage,
					{
						status: 500,
						code: missing ? "video_concat_binary_missing" : options.errorCode,
						details: {
							command: options.command,
							error: err.message,
						},
					},
				),
			);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			const stdout = Buffer.concat(stdoutChunks).toString("utf8");
			const stderr = Buffer.concat(stderrChunks).toString("utf8");
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}
			reject(
				new AppError(options.errorMessage, {
					status: 500,
					code: options.errorCode,
					details: {
						command: options.command,
						exitCode: code,
						stderr: stderr.slice(-4000),
					},
				}),
			);
		});
	});
}

async function assertFfmpegAvailable(timeoutMs: number): Promise<void> {
	await runCommand({
		command: "ffmpeg",
		args: ["-version"],
		timeoutMs,
		errorCode: "video_concat_ffmpeg_unavailable",
		errorMessage: "ffmpeg 不可用，无法拼接视频",
	});
	await runCommand({
		command: "ffprobe",
		args: ["-version"],
		timeoutMs,
		errorCode: "video_concat_ffprobe_unavailable",
		errorMessage: "ffprobe 不可用，无法校验源视频",
	});
}

function describeFetchFailureCause(error: unknown): Record<string, unknown> {
	if (!(error instanceof Error)) {
		return { errorString: String(error) };
	}
	const out: Record<string, unknown> = {
		name: error.name,
		message: error.message,
	};
	const cause = (error as { cause?: unknown }).cause;
	if (cause && typeof cause === "object") {
		const c = cause as Record<string, unknown>;
		out.cause = {
			name: typeof c.name === "string" ? c.name : undefined,
			message: typeof c.message === "string" ? c.message : undefined,
			code: typeof c.code === "string" ? c.code : undefined,
			errno: typeof c.errno === "number" ? c.errno : undefined,
			syscall: typeof c.syscall === "string" ? c.syscall : undefined,
			address: typeof c.address === "string" ? c.address : undefined,
			port: typeof c.port === "number" ? c.port : undefined,
		};
	} else if (cause !== undefined) {
		out.cause = String(cause);
	}
	return out;
}

async function downloadVideoSource(source: VideoConcatSource, filePath: string): Promise<void> {
	if (!/^https?:\/\//i.test(source.url)) {
		throw new AppError("视频拼接源 URL 必须是 http(s) 真实资产地址", {
			status: 400,
			code: "video_concat_source_url_invalid",
			details: {
				nodeId: source.nodeId,
				url: source.url,
			},
		});
	}
	let host = "";
	try {
		host = new URL(source.url).host;
	} catch {}
	const startedAt = Date.now();
	let response: Response;
	try {
		response = await fetch(source.url);
	} catch (error) {
		const elapsedMs = Date.now() - startedAt;
		const failure = describeFetchFailureCause(error);
		console.error("[video_concat_source_fetch_failed]", {
			nodeId: source.nodeId,
			host,
			elapsedMs,
			...failure,
		});
		throw new AppError("下载视频拼接源时网络请求失败", {
			status: 502,
			code: "video_concat_source_fetch_failed",
			details: {
				nodeId: source.nodeId,
				url: source.url,
				host,
				elapsedMs,
				...failure,
			},
		});
	}
	if (!response.ok) {
		throw new AppError("下载视频拼接源失败", {
			status: 502,
			code: "video_concat_source_download_failed",
			details: {
				nodeId: source.nodeId,
				url: source.url,
				host,
				status: response.status,
			},
		});
	}
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await response.arrayBuffer());
	} catch (error) {
		const elapsedMs = Date.now() - startedAt;
		const failure = describeFetchFailureCause(error);
		console.error("[video_concat_source_body_failed]", {
			nodeId: source.nodeId,
			host,
			elapsedMs,
			...failure,
		});
		throw new AppError("读取视频拼接源响应体失败", {
			status: 502,
			code: "video_concat_source_body_failed",
			details: {
				nodeId: source.nodeId,
				url: source.url,
				host,
				elapsedMs,
				...failure,
			},
		});
	}
	if (!bytes.byteLength) {
		throw new AppError("下载的视频拼接源为空", {
			status: 502,
			code: "video_concat_source_empty",
			details: {
				nodeId: source.nodeId,
				url: source.url,
				host,
			},
		});
	}
	await writeFile(filePath, bytes);
}

function readProbeDuration(value: unknown): number | null {
	const parsed = readNumeric(value);
	if (parsed === null || parsed <= 0) return null;
	return parsed;
}

function parseProbeInfo(raw: string, source: VideoConcatSource): VideoProbeInfo {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new AppError("ffprobe 返回了不可解析的 JSON", {
			status: 500,
			code: "video_concat_probe_parse_failed",
			details: { nodeId: source.nodeId, url: source.url },
		});
	}
	if (!isRecord(parsed)) {
		throw new AppError("ffprobe 返回结构无效", {
			status: 500,
			code: "video_concat_probe_invalid",
			details: { nodeId: source.nodeId, url: source.url },
		});
	}
	const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
	const videoStream = streams.find((stream) => {
		if (!isRecord(stream)) return false;
		return readTrimmedString(stream.codec_type).toLowerCase() === "video";
	});
	const audioStream = streams.find((stream) => {
		if (!isRecord(stream)) return false;
		return readTrimmedString(stream.codec_type).toLowerCase() === "audio";
	});
	if (!isRecord(videoStream)) {
		throw new AppError("源视频缺少视频轨", {
			status: 400,
			code: "video_concat_source_video_track_missing",
			details: { nodeId: source.nodeId, url: source.url },
		});
	}
	const width = normalizePositiveInteger(videoStream.width);
	const height = normalizePositiveInteger(videoStream.height);
	if (!width || !height) {
		throw new AppError("无法读取源视频尺寸", {
			status: 400,
			code: "video_concat_source_size_missing",
			details: { nodeId: source.nodeId, url: source.url },
		});
	}
	const format = isRecord(parsed.format) ? parsed.format : {};
	return {
		width,
		height,
		durationSeconds:
			readProbeDuration(format.duration) ?? readProbeDuration(videoStream.duration),
		hasAudio: Boolean(audioStream),
	};
}

async function probeVideoSource(
	source: VideoConcatSource,
	filePath: string,
	timeoutMs: number,
): Promise<VideoProbeInfo> {
	const result = await runCommand({
		command: "ffprobe",
		args: ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath],
		timeoutMs,
		errorCode: "video_concat_probe_failed",
		errorMessage: "读取源视频信息失败",
	});
	return parseProbeInfo(result.stdout, source);
}

export function buildConcatFilter(options: {
	sourceCount: number;
	width: number;
	height: number;
	fps: number;
	withAudio: boolean;
}): string {
	const parts: string[] = [];
	const concatInputs: string[] = [];
	for (let index = 0; index < options.sourceCount; index += 1) {
		parts.push(
			`[${index}:v:0]scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease,pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${options.fps},format=yuv420p[v${index}]`,
		);
		if (options.withAudio) {
			parts.push(
				`[${index}:a:0]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${index}]`,
			);
			concatInputs.push(`[v${index}][a${index}]`);
		} else {
			concatInputs.push(`[v${index}]`);
		}
	}
	if (options.withAudio) {
		parts.push(
			`${concatInputs.join("")}concat=n=${options.sourceCount}:v=1:a=1[outv][outa]`,
		);
	} else {
		parts.push(
			`${concatInputs.join("")}concat=n=${options.sourceCount}:v=1:a=0[outv]`,
		);
	}
	return parts.join(";");
}

async function concatVideosWithFfmpeg(options: {
	inputPaths: string[];
	outputPath: string;
	width: number;
	height: number;
	fps: number;
	withAudio: boolean;
	timeoutMs: number;
}): Promise<void> {
	const args = ["-hide_banner", "-y"];
	for (const inputPath of options.inputPaths) {
		args.push("-i", inputPath);
	}
	args.push(
		"-filter_complex",
		buildConcatFilter({
			sourceCount: options.inputPaths.length,
			width: options.width,
			height: options.height,
			fps: options.fps,
			withAudio: options.withAudio,
		}),
		"-map",
		"[outv]",
	);
	if (options.withAudio) {
		args.push("-map", "[outa]");
	}
	args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20");
	if (options.withAudio) {
		args.push("-c:a", "aac", "-b:a", "192k");
	}
	args.push("-movflags", "+faststart", options.outputPath);
	await runCommand({
		command: "ffmpeg",
		args,
		timeoutMs: options.timeoutMs,
		errorCode: "video_concat_ffmpeg_failed",
		errorMessage: "ffmpeg 视频拼接失败",
	});
}

export const PublicAgentsVideoConcatToCanvasArgsSchema = z
	.object({
		sourceNodeIds: z.array(z.string().min(1)).min(2).optional(),
		nodeIds: z.array(z.string().min(1)).min(2).optional(),
		sources: z
			.array(
				z
					.object({
						nodeId: optionalNonEmptyString,
						url: z.string().min(1),
						label: optionalNonEmptyString,
						name: optionalNonEmptyString,
					})
					.strict(),
			)
			.min(2)
			.optional(),
		outputNode: z
			.object({
				id: optionalNonEmptyString,
				label: optionalNonEmptyString,
				parentId: optionalNonEmptyString,
			})
			.strict()
			.optional(),
		label: optionalNonEmptyString,
		audioPolicy: z.enum(["preserve", "drop", "auto"]).default("auto"),
		transition: z.literal("none").default("none"),
		fps: z.number().int().min(1).max(60).default(DEFAULT_CONCAT_FPS),
		timeoutMs: z.number().int().min(5_000).max(MAX_CONCAT_TIMEOUT_MS).optional(),
	})
	.strict();

export type PublicAgentsVideoConcatToCanvasResult = {
	ok: true;
	flowId: string;
	updatedAt: string;
	stats: {
		deletedNodes: number;
		deletedEdges: number;
		createdNodes: number;
		createdEdges: number;
		patchedNodes: number;
		appendedArrays: number;
	};
	nodeId: string;
	status: "success";
	videoUrl: string;
	sourceCount: number;
	sourceNodeIds: string[];
	durationSeconds: number | null;
	debug: {
		width: number;
		height: number;
		fps: number;
		audioPolicy: VideoConcatEffectiveAudioPolicy;
		requestedAudioPolicy: VideoConcatRequestedAudioPolicy;
		transition: "none";
		sourceVideos: Array<{
			nodeId: string | null;
			url: string;
			label: string | null;
			durationSeconds: number | null;
		}>;
	};
};

export async function concatVideoToCanvas(input: {
	c: AppContext;
	requestUserId: string;
	devBypass: boolean;
	flowId: string;
	row: FlowRow;
	bodyArgs: unknown;
	runContext?: unknown;
}): Promise<PublicAgentsVideoConcatToCanvasResult> {
	assertNodeRuntime();
	const parsedArgs = PublicAgentsVideoConcatToCanvasArgsSchema.safeParse(input.bodyArgs);
	if (!parsedArgs.success) {
		throw new AppError("Invalid video concat to canvas request", {
			status: 400,
			code: "invalid_video_concat_to_canvas_request",
			details: { issues: parsedArgs.error.issues },
		});
	}
	const bodyArgs = parsedArgs.data;
	const timeoutMs = clampTimeoutMs(bodyArgs.timeoutMs);
	const dto = mapFlowRowToDto(input.row);
	const current = sanitizeFlowDataForStorage(dto.data ?? {});
	const graph = PublicFlowGraphSchema.parse(current) as FlowGraphRecord;
	const sources = resolveConcatSourceVideosFromGraph({
		graph,
		bodyArgs,
	});
	const existingNodeIds = new Set(
		graph.nodes
			.filter(isRecord)
			.map((node) => readTrimmedString(node.id))
			.filter(Boolean),
	);
	const sourceNodeIds = sources
		.map((source) => source.nodeId)
		.filter(
			(nodeId): nodeId is string =>
				typeof nodeId === "string" && nodeId.length > 0 && existingNodeIds.has(nodeId),
		);

	await assertFfmpegAvailable(10_000);
	const tempRoot = await mkdtemp(path.join(tmpdir(), "canvas-video-concat-"));
	try {
		const inputPaths = sources.map((_, index) => path.join(tempRoot, `input-${index}.mp4`));
		for (let index = 0; index < sources.length; index += 1) {
			await downloadVideoSource(sources[index], inputPaths[index]);
		}
		const probes: VideoProbeInfo[] = [];
		const probeSummaries: VideoConcatProbeSummary[] = [];
		for (let index = 0; index < sources.length; index += 1) {
			const probe = await probeVideoSource(sources[index], inputPaths[index], 30_000);
			probes.push(probe);
			probeSummaries.push({
				nodeId: sources[index].nodeId,
				url: sources[index].url,
				hasAudio: probe.hasAudio,
			});
		}
		const effectiveAudioPolicy = decideEffectiveAudioPolicy({
			requested: bodyArgs.audioPolicy,
			probes: probeSummaries,
		});
		const firstProbe = probes[0];
		const outputPath = path.join(tempRoot, "concat-output.mp4");
		await concatVideosWithFfmpeg({
			inputPaths,
			outputPath,
			width: firstProbe.width,
			height: firstProbe.height,
			fps: bodyArgs.fps,
			withAudio: effectiveAudioPolicy === "preserve",
			timeoutMs,
		});
		const outputBytes = new Uint8Array(await readFile(outputPath));
		if (!outputBytes.byteLength) {
			throw new AppError("视频拼接产物为空", {
				status: 500,
				code: "video_concat_output_empty",
			});
		}
		const videoUrl = await uploadInlineAssetBytesToRustfs({
			c: input.c,
			userId: input.requestUserId,
			mimeType: "video/mp4",
			bytes: outputBytes,
			prefix: "gen/videos/concat",
		});
		const durationSeconds = probes.every((probe) => probe.durationSeconds !== null)
			? probes.reduce((sum, probe) => sum + (probe.durationSeconds ?? 0), 0)
			: null;
		const outputNode = isRecord(bodyArgs.outputNode) ? bodyArgs.outputNode : {};
		const label =
			readTrimmedString(outputNode.label) ||
			readTrimmedString(bodyArgs.label) ||
			`视频拼接｜${sources.length}段`;
		const nodeId = readTrimmedString(outputNode.id) || crypto.randomUUID();
		const nowIso = new Date().toISOString();
		const finalNode = PublicFlowCreateTaskNodeSchema.parse({
			id: nodeId,
			type: "taskNode",
			...(buildOutputParentId({ bodyArgs, graph, sourceNodeIds })
				? { parentId: buildOutputParentId({ bodyArgs, graph, sourceNodeIds }) }
				: {}),
			data: {
				kind: "composeVideo",
				label,
				status: "success",
				progress: 100,
				videoUrl,
				videoResults: [
					{
						url: videoUrl,
						title: label,
						...(durationSeconds !== null ? { duration: durationSeconds } : {}),
					},
				],
				videoPrimaryIndex: 0,
				...(durationSeconds !== null
					? { videoDurationSeconds: durationSeconds }
					: {}),
				videoModel: "ffmpeg-concat",
				videoModelVendor: "local-ffmpeg",
				vendor: "local-ffmpeg",
				sourceVideoNodeIds: sourceNodeIds,
				sourceVideoUrls: sources.map((source) => source.url),
				concatMetadata: {
					audioPolicy: effectiveAudioPolicy,
					requestedAudioPolicy: bodyArgs.audioPolicy,
					transition: "none",
					width: firstProbe.width,
					height: firstProbe.height,
					fps: bodyArgs.fps,
					sourceCount: sources.length,
					createdAt: nowIso,
				},
			},
		});
		const createEdges = buildConcatSourceEdges(sourceNodeIds, nodeId);
		const applied = applyPublicFlowGraphPatch({
			current,
			origin: input.runContext,
			patch: {
				createNodes: [finalNode],
				...(createEdges.length ? { createEdges } : {}),
			},
		});
		const sanitizedNext = sanitizeFlowDataForStorage(applied.data);
		const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
		if (!nextParsed.success) {
			throw new AppError("Flow patch produced invalid data", {
				status: 500,
				code: "flow_patch_invalid",
				details: { issues: nextParsed.error.issues },
			});
		}
		const nextJson = JSON.stringify(sanitizedNext ?? {});
		const updated = input.devBypass
			? await updateFlowByIdUnsafe(input.c.env.DB, {
					id: input.flowId,
					name: input.row.name,
					data: nextJson,
					nowIso,
			  })
			: await updateFlow(input.c.env.DB, {
					id: input.flowId,
					name: input.row.name,
					data: nextJson,
					ownerId: input.requestUserId,
					projectId: input.row.project_id,
					nowIso,
			  });
		if (!updated) {
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
			});
		}
			const versionUserId = input.requestUserId;
		await createFlowVersion(input.c.env.DB, {
			id: crypto.randomUUID(),
			flowId: updated.id,
			name: updated.name,
			data: updated.data,
			userId: versionUserId,
			nowIso,
			reason: "agent_turn",
			label: "concat-video",
		});
		const response = PublicFlowPatchResponseSchema.parse({
			ok: true,
			flowId: updated.id,
			updatedAt: updated.updated_at,
			stats: applied.stats,
			data: nextParsed.data,
		});
		return {
			ok: true,
			flowId: response.flowId,
			updatedAt: response.updatedAt,
			stats: response.stats,
			nodeId,
			status: "success",
			videoUrl,
			sourceCount: sources.length,
			sourceNodeIds,
			durationSeconds,
			debug: {
				width: firstProbe.width,
				height: firstProbe.height,
				fps: bodyArgs.fps,
				audioPolicy: effectiveAudioPolicy,
				requestedAudioPolicy: bodyArgs.audioPolicy,
				transition: "none",
				sourceVideos: sources.map((source, index) => ({
					nodeId: source.nodeId,
					url: source.url,
					label: source.label,
					durationSeconds: probes[index]?.durationSeconds ?? null,
				})),
			},
		};
	} finally {
		await rm(tempRoot, { recursive: true, force: true });
	}
}
