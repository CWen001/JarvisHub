import { z } from "zod";

export const CanvasGenerationContextGetArgsSchema = z
	.object({
		nodeId: z.string().min(1),
	})
	.strict();

type RecordValue = Record<string, unknown>;

export type CanvasGenerationReference = {
	sourceNodeId?: string;
	assetId?: string;
	assetRefId?: string;
	role?: string;
	relationshipKind?: string;
	note?: string;
	name?: string;
	url?: string;
};

export type CanvasGenerationContextResult = {
	flowId: string;
	nodeId: string;
	kind: string | null;
	status: string | null;
	requestedPrompt: string | null;
	effectivePrompt: string | null;
	exactEffectivePromptAvailable: boolean;
	negativePrompt: string | null;
	promptTransforms: string[];
	model: {
		vendor: string | null;
		modelKey: string | null;
	};
	parameters: Record<string, string | number | boolean>;
	references: CanvasGenerationReference[];
	latestExecution: {
		taskId: string | null;
		lastError: string | null;
		httpStatus: number | null;
	};
};

function isRecord(value: unknown): value is RecordValue {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstString(record: RecordValue, keys: string[]): string | null {
	for (const key of keys) {
		const value = readString(record[key]);
		if (value) return value;
	}
	return null;
}

function readParameters(data: RecordValue): Record<string, string | number | boolean> {
	const allowedKeys = [
		"aspectRatio",
		"resolution",
		"imageResolution",
		"videoResolution",
		"durationSeconds",
		"audioMode",
		"specKey",
		"imageEditSize",
		"size",
		"aspect",
	] as const;
	const result: Record<string, string | number | boolean> = {};
	for (const key of allowedKeys) {
		const value = data[key];
		if (typeof value === "string" || typeof value === "boolean") result[key] = value;
		if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
	}
	return result;
}

function readExternalUrl(value: unknown): string | null {
	const url = readString(value);
	if (!url) return null;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
		return parsed.pathname.includes("/gen/") ? null : url;
	} catch {
		return null;
	}
}

function readReferences(data: RecordValue): CanvasGenerationReference[] {
	const values = [data.assetInputs, data.anchorBindings, data.referenceImages]
		.flatMap((value) => (Array.isArray(value) ? value : []));
	return values.flatMap((value) => {
		const directUrl = readExternalUrl(value);
		if (directUrl) return [{ url: directUrl }];
		if (!isRecord(value)) return [];
		const reference: CanvasGenerationReference = {};
		for (const key of ["sourceNodeId", "assetId", "assetRefId", "role", "relationshipKind", "note", "name"] as const) {
			const field = readString(value[key]);
			if (field) reference[key] = field;
		}
		const hasStableIdentity = Boolean(reference.sourceNodeId || reference.assetId || reference.assetRefId);
		if (hasStableIdentity) return [reference];
		const url = readExternalUrl(value.url);
		return url ? [{ ...reference, url }] : [];
	});
}

export function getCanvasGenerationContextFromGraph(input: {
	flowId: string;
	graph: unknown;
	nodeId: string;
}): CanvasGenerationContextResult | null {
	const graph = isRecord(input.graph) ? input.graph : {};
	const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isRecord) : [];
	const node = nodes.find((candidate) => readString(candidate.id) === input.nodeId);
	if (!node) return null;
	const data = isRecord(node.data) ? node.data : {};
	const generationContext = isRecord(data.generationContext) ? data.generationContext : {};
	const requestedPrompt = readString(generationContext.requestedPrompt) || readString(data.prompt);
	const exactEffectivePrompt = readString(generationContext.effectivePrompt);
	const promptTransforms = Array.isArray(generationContext.promptTransforms)
		? generationContext.promptTransforms.map(readString).filter((value): value is string => Boolean(value))
		: [];

	return {
		flowId: input.flowId,
		nodeId: input.nodeId,
		kind: readString(data.kind),
		status: readString(data.status),
		requestedPrompt,
		effectivePrompt: exactEffectivePrompt || requestedPrompt,
		exactEffectivePromptAvailable: Boolean(exactEffectivePrompt),
		negativePrompt: readString(generationContext.negativePrompt) || readString(data.negativePrompt),
		promptTransforms,
		model: {
			vendor: firstString(data, ["vendor", "modelVendor", "imageModelVendor", "videoModelVendor"]),
			modelKey: firstString(data, ["modelKey", "imageModel", "videoModel", "model"]),
		},
		parameters: readParameters(data),
		references: readReferences(data),
		latestExecution: {
			taskId: firstString(data, ["taskId", "imageTaskId", "videoTaskId"]),
			lastError: readString(data.lastError),
			httpStatus: typeof data.httpStatus === "number" && Number.isFinite(data.httpStatus) ? data.httpStatus : null,
		},
	};
}
