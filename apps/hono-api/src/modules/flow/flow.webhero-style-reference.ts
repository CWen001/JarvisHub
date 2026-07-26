import { AppError } from "../../middleware/error";
import { hasMeaningfulWebHeroEvidence } from "./flow.webhero-evidence-phases";

const STYLE_REFERENCE_DISPLAY_URL_FIELDS = [
	"imageUrl",
	"thumbnailUrl",
	"remoteImageUrl",
	"sourceImageUrl",
	"originalImageUrl",
	"vendorReferenceImageUrl",
] as const;

const STYLE_REFERENCE_MODEL_INPUT_URL_FIELDS = [
	"modelInputImageUrl",
	"vendorReferenceImageUrl",
	"originalImageUrl",
	"sourceImageUrl",
	"remoteImageUrl",
	"imageUrl",
	"thumbnailUrl",
] as const;

type FlowGraphLike = {
	nodes?: Array<{ id?: unknown; data?: unknown }>;
};

type FlowPatchLike = {
	createNodes?: Array<{ id?: unknown; data?: Record<string, unknown> }>;
	patchNodeData?: Array<{ id: string; data?: Record<string, unknown> }>;
};

export type WebHeroPatchAuthority = "generic" | "webhero_transition" | "webhero_code_commit";

const WEBHERO_SERVER_OWNED_PATCH_FIELDS = new Set([
	"webPreviewStyleReferenceUrls",
	"webHeroCodeEvidence",
	"webHeroFinalCodeStale",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWebHeroData(data: Record<string, unknown>): boolean {
	return typeof data.kind === "string" && data.kind.trim().toLowerCase() === "webhero";
}

function isLocalOrPrivateHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	const isIpv6 = host.includes(":");
	return (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.startsWith("127.") ||
		host === "::1" ||
		host.startsWith("10.") ||
		host.startsWith("169.254.") ||
		host.startsWith("0.") ||
		host.startsWith("192.168.") ||
		/^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
		host.startsWith("::ffff:") ||
		(isIpv6 && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")))
	);
}

function readExecutableHttpUrl(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) return "";
	try {
		const parsed = new URL(value.trim());
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
		return isLocalOrPrivateHost(parsed.hostname) ? "" : parsed.toString();
	} catch {
		return "";
	}
}

export type CanonicalWebHeroStyleReference = {
	record: Record<string, unknown>;
	displayUrl: string;
	modelInputUrl: string;
	referenceUrls: string[];
};

export function readCanonicalWebHeroStyleReference(value: unknown): CanonicalWebHeroStyleReference | null {
	if (!isRecord(value)) return null;
	const displayUrl = STYLE_REFERENCE_DISPLAY_URL_FIELDS
		.map((field) => readExecutableHttpUrl(value[field]))
		.find(Boolean) || "";
	const modelInputUrl = STYLE_REFERENCE_MODEL_INPUT_URL_FIELDS
		.map((field) => readExecutableHttpUrl(value[field]))
		.find(Boolean) || "";
	if (!modelInputUrl) return null;
	return {
		record: value,
		displayUrl: displayUrl || modelInputUrl,
		modelInputUrl,
		referenceUrls: [modelInputUrl],
	};
}

export function readSelectedWebHeroStyleReference(
	data: Record<string, unknown>,
): CanonicalWebHeroStyleReference | null {
	const workflow = isRecord(data.webPageWorkflowContract) ? data.webPageWorkflowContract : null;
	return readCanonicalWebHeroStyleReference(workflow?.selectedStyleReference);
}

function assertCandidate(value: unknown, nodeId: string): void {
	if (value === null) return;
	if (readCanonicalWebHeroStyleReference(value)) return;
	throw new AppError("WebHero selectedStyleReference must be a canonical image-reference object", {
		status: 409,
		code: "webhero_style_reference_invalid",
		details: {
				nodeId,
				requiredShape:
					"object with at least one public HTTP(S) modelInputImageUrl/vendorReferenceImageUrl/originalImageUrl/sourceImageUrl/remoteImageUrl/imageUrl/thumbnailUrl",
		},
	});
}

export function assertCanonicalWebHeroStyleReferencePatch(
	graph: FlowGraphLike,
	patch: FlowPatchLike,
	authority: WebHeroPatchAuthority = "generic",
): void {
	const existingWebHeroNodeIds = new Set(
		(graph.nodes || [])
			.filter((node) => isRecord(node.data) && isWebHeroData(node.data))
			.map((node) => typeof node.id === "string" ? node.id.trim() : "")
			.filter(Boolean),
	);
	const webHeroNodeIds = new Set(existingWebHeroNodeIds);
	for (const node of patch.createNodes || []) {
		const data = node.data || {};
		const nodeId = typeof node.id === "string" ? node.id.trim() : "";
		validateServerOwnedFields(data, nodeId || "(new node)", authority);
		if (!isWebHeroData(data)) continue;
		if (nodeId) webHeroNodeIds.add(nodeId);
		validatePatchData(data, nodeId || "(new webHero)", authority);
	}
	for (const item of patch.patchNodeData || []) {
		const data = item.data || {};
		validateServerOwnedFields(data, item.id, authority);
		if (!webHeroNodeIds.has(item.id) && !isWebHeroData(data)) continue;
		const workflow = isRecord(data.webPageWorkflowContract) ? data.webPageWorkflowContract : null;
		const hasSelectedStyleTransition = Boolean(workflow) &&
			Object.prototype.hasOwnProperty.call(workflow, "selectedStyleReference");
		const hasSharedStyleBibleTransition = Boolean(workflow) &&
			Object.prototype.hasOwnProperty.call(workflow, "sharedStyleBible");
		if (hasSharedStyleBibleTransition && !hasSelectedStyleTransition) {
			throw new AppError("sharedStyleBible must change atomically with selectedStyleReference", {
				status: 409,
				code: "webhero_style_bible_transition_required",
				details: { nodeId: item.id },
			});
		}
		if (
			authority === "generic" &&
			existingWebHeroNodeIds.has(item.id) &&
			workflow &&
			(
				hasSelectedStyleTransition ||
				Object.prototype.hasOwnProperty.call(workflow, "approvedPreviewNodes")
			)
		) {
			throw new AppError("Existing WebHero style/approved-preview changes require the semantic transition tool", {
				status: 409,
				code: "webhero_downstream_transition_required",
				details: {
					nodeId: item.id,
					requiredTool: "canvas_update_node_data",
					requiredFlag: "webHeroResetDownstreamEvidence=true",
				},
			});
		}
		validatePatchData(data, item.id, authority);
	}
}

function validateServerOwnedFields(
	data: Record<string, unknown>,
	nodeId: string,
	authority: WebHeroPatchAuthority,
): void {
	const supplied = Object.keys(data).filter((field) => WEBHERO_SERVER_OWNED_PATCH_FIELDS.has(field));
	if (!supplied.length) return;
	const forbidden = supplied.filter((field) => {
		if (field === "webPreviewStyleReferenceUrls") {
			return true;
		}
		return authority !== "webhero_transition" && authority !== "webhero_code_commit";
	});
	if (!forbidden.length) return;
	throw new AppError("WebHero provenance fields are server-owned", {
		status: 409,
		code: "webhero_provenance_field_server_owned",
		details: { nodeId, fields: forbidden },
	});
}

function validatePatchData(
	data: Record<string, unknown>,
	nodeId: string,
	authority: WebHeroPatchAuthority,
): void {
	validateServerOwnedFields(data, nodeId, authority);
	if (Object.prototype.hasOwnProperty.call(data, "selectedStyleReference")) {
		throw new AppError("WebHero selectedStyleReference must be stored in webPageWorkflowContract", {
			status: 409,
			code: "webhero_style_reference_path_invalid",
			details: {
				nodeId,
				requiredPath: "webPageWorkflowContract.selectedStyleReference",
			},
		});
	}
	const hasWorkflowContract = Object.prototype.hasOwnProperty.call(data, "webPageWorkflowContract");
	if (hasWorkflowContract && !isRecord(data.webPageWorkflowContract)) {
		throw new AppError("WebHero webPageWorkflowContract must be an object", {
			status: 400,
			code: "webhero_workflow_contract_invalid",
			details: { nodeId },
		});
	}
	const workflow = isRecord(data.webPageWorkflowContract) ? data.webPageWorkflowContract : null;
	if (workflow && Object.prototype.hasOwnProperty.call(workflow, "selectedStyleReference")) {
		assertCandidate(workflow.selectedStyleReference, nodeId);
		if (isRecord(workflow.selectedStyleReference) && !hasMeaningfulWebHeroEvidence(workflow.sharedStyleBible)) {
			throw new AppError("selectedStyleReference and sharedStyleBible must be written together in one style transition", {
				status: 409,
				code: "webhero_style_bible_transition_required",
				details: { nodeId },
			});
		}
	}
}
