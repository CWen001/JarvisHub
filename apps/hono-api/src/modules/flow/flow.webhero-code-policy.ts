import { AppError } from "../../middleware/error";

export type WebHeroFinalCodeMutationSource = "generic" | "webhero_transition" | "webhero_code_commit";

type FlowPatchLike = {
	allowOverwrite?: boolean;
	createNodes?: Array<{ data?: Record<string, unknown> }>;
	patchNodeData?: Array<{ id: string; data?: Record<string, unknown> }>;
};

export type WebHeroPolicyGraph = {
	nodes?: Array<{ id?: string; data?: Record<string, unknown> }>;
};

const CANONICAL_FINAL_CODE_FIELDS = [
	"webHeroHtml",
	"webHeroCss",
	"webHeroDocumentHtml",
] as const;

const LEGACY_FINAL_CODE_FIELDS = ["html", "css", "documentHtml"] as const;

export function dataWritesWebHeroFinalCode(data: Record<string, unknown>): boolean {
	return [...CANONICAL_FINAL_CODE_FIELDS, ...LEGACY_FINAL_CODE_FIELDS].some((field) =>
		Object.prototype.hasOwnProperty.call(data, field),
	);
}

function dataWritesCanonicalWebHeroFinalCode(data: Record<string, unknown>): boolean {
	return CANONICAL_FINAL_CODE_FIELDS.some((field) =>
		Object.prototype.hasOwnProperty.call(data, field),
	);
}

function dataWritesLegacyWebHeroFinalCode(data: Record<string, unknown>): boolean {
	return LEGACY_FINAL_CODE_FIELDS.some((field) =>
		Object.prototype.hasOwnProperty.call(data, field),
	);
}

function isWebHeroNodeData(data: Record<string, unknown>): boolean {
	return typeof data.kind === "string" && data.kind.trim().toLowerCase() === "webhero";
}

export function narrowWebHeroPolicyGraph(graph: { nodes?: unknown[] }): WebHeroPolicyGraph {
	return {
		nodes: (graph.nodes || []).flatMap((node) => {
			if (!node || typeof node !== "object" || Array.isArray(node)) return [];
			const record = node as Record<string, unknown>;
			const data = record.data && typeof record.data === "object" && !Array.isArray(record.data)
				? record.data as Record<string, unknown>
				: undefined;
			return [{ id: typeof record.id === "string" ? record.id : undefined, data }];
		}),
	};
}

function writesNonEmptyWebHeroSectionDrafts(data: Record<string, unknown>): boolean {
	if (!Object.prototype.hasOwnProperty.call(data, "webPageSectionDrafts")) return false;
	return !Array.isArray(data.webPageSectionDrafts) || data.webPageSectionDrafts.length > 0;
}

export function assertWebHeroFinalCodeMutationSource(
	patch: FlowPatchLike,
	source: WebHeroFinalCodeMutationSource,
	graph?: WebHeroPolicyGraph,
): void {
	const untrustedSectionDraftWrites = [
		...(patch.createNodes || []),
		...(patch.patchNodeData || []),
	].filter((item) => writesNonEmptyWebHeroSectionDrafts(item.data || {}));
	if (source !== "webhero_transition" && untrustedSectionDraftWrites.length > 0) {
		throw new AppError("WebHero section drafts require runtime-verified section_codegen provenance", {
			status: 409,
			code: "webhero_section_draft_trusted_write_required",
			details: { sectionDraftWriteCount: untrustedSectionDraftWrites.length },
		});
	}
	const webHeroNodeIds = new Set(
		(graph?.nodes || [])
			.filter((node) => isWebHeroNodeData(node.data || {}))
			.map((node) => String(node.id || "").trim())
			.filter(Boolean),
	);
	for (const node of patch.createNodes || []) {
		const id = typeof (node as { id?: unknown }).id === "string"
			? String((node as { id: string }).id).trim()
			: "";
		if (id && isWebHeroNodeData(node.data || {})) webHeroNodeIds.add(id);
	}
	const createWrites = (patch.createNodes || []).filter((node) =>
		dataWritesCanonicalWebHeroFinalCode(node.data || {})
		|| (isWebHeroNodeData(node.data || {}) && dataWritesLegacyWebHeroFinalCode(node.data || {})),
	);
	const patchWrites = (patch.patchNodeData || []).filter((item) => {
		const data = item.data || {};
		return dataWritesCanonicalWebHeroFinalCode(data)
			|| (
				dataWritesLegacyWebHeroFinalCode(data)
				&& (webHeroNodeIds.has(item.id) || isWebHeroNodeData(data))
			);
	});
	if (createWrites.length === 0 && patchWrites.length === 0) return;

	if (source === "generic") {
		throw new AppError(
			"WebHero final code can only be written by canvas_webhero_code_commit",
			{
				status: 409,
				code: "webhero_final_code_commit_only",
				details: { finalCodeWriteCount: createWrites.length + patchWrites.length },
			},
		);
	}
	if (source === "webhero_transition") {
		const invalidFields: string[] = [];
		if (createWrites.length > 0) invalidFields.push("createNodes");
		if (patchWrites.length !== 1) invalidFields.push("exactly one final-code clearing patchNodeData item");
		for (const item of patchWrites) {
			const data = item.data || {};
			for (const field of LEGACY_FINAL_CODE_FIELDS) {
				if (Object.prototype.hasOwnProperty.call(data, field)) invalidFields.push(field);
			}
			for (const field of CANONICAL_FINAL_CODE_FIELDS) {
				if (data[field] !== "") invalidFields.push(`${field}=empty string`);
			}
			if (data.webHeroCodeSessionId !== null) invalidFields.push("webHeroCodeSessionId=null");
			if (data.webHeroCodeCommittedAt !== null) invalidFields.push("webHeroCodeCommittedAt=null");
			if (data.webHeroFinalCodeStale !== true) invalidFields.push("webHeroFinalCodeStale=true");
			if (data.webHeroCodeEvidence !== null) invalidFields.push("webHeroCodeEvidence=null");
		}
		if (invalidFields.length > 0) {
			throw new AppError("WebHero transition authority may only clear canonical final code", {
				status: 409,
				code: "webhero_final_code_transition_contract_invalid",
				details: { invalidFields: Array.from(new Set(invalidFields)) },
			});
		}
		return;
	}

	const invalidFields: string[] = [];
	if (createWrites.length > 0) invalidFields.push("createNodes");
	if (patch.allowOverwrite !== true) invalidFields.push("allowOverwrite=true");
	if (patchWrites.length !== 1) invalidFields.push("exactly one final-code patchNodeData item");
	for (const item of patchWrites) {
		const data = item.data || {};
		for (const field of LEGACY_FINAL_CODE_FIELDS) {
			if (Object.prototype.hasOwnProperty.call(data, field)) invalidFields.push(field);
		}
		for (const field of CANONICAL_FINAL_CODE_FIELDS) {
			if (!Object.prototype.hasOwnProperty.call(data, field)) invalidFields.push(field);
		}
		if (typeof data.webHeroCodeSessionId !== "string" || !data.webHeroCodeSessionId.trim()) {
			invalidFields.push("webHeroCodeSessionId");
		}
		if (typeof data.webHeroCodeCommittedAt !== "string" || !data.webHeroCodeCommittedAt.trim()) {
			invalidFields.push("webHeroCodeCommittedAt");
		}
	}
	if (invalidFields.length > 0) {
		throw new AppError("WebHero commit source must use the canonical complete overwrite contract", {
			status: 409,
			code: "webhero_final_code_commit_contract_invalid",
			details: { invalidFields: Array.from(new Set(invalidFields)) },
		});
	}
}
