import { AppError } from "../../middleware/error";
import { readSelectedWebHeroStyleReference } from "../flow/flow.webhero-style-reference";
import { assertWebHeroFinalCodePayloadUsable } from "./agents-tool-bridge.webhero-gate";
import type {
	WebHeroCodeCanonicalField,
	WebHeroCodeStageCommitting,
	WebHeroCodeStageCommitted,
	WebHeroCodeStageFields,
	WebHeroCodeStageSession,
	WebHeroCodeStageStaging,
} from "./agents-tool-bridge.webhero-stage-session.repo";
import type { ToolResultEffects } from "./canvas-tools/types";

export type WebHeroCodeField =
	| "webHeroHtml"
	| "webHeroCss"
	| "webHeroDocumentHtml"
	| "html"
	| "css"
	| "documentHtml";

export type WebHeroCodeCommitOutcome =
	| {
			kind: "patch";
			nodeId: string;
			sessionId: string;
			committedAt: string;
			patch: Record<string, unknown>;
			effects: ToolResultEffects;
	  }
	| {
			kind: "idempotent";
			nodeId: string;
			sessionId: string;
			committedAt: string;
			committedNodeIds: string[];
	  };

export type WebHeroCodeStageChunkResult = {
	nodeId: string;
	sessionId: string;
	field: WebHeroCodeCanonicalField;
	index: number;
	total: number;
	received: number;
	complete: boolean;
};

export type WebHeroCodeStageIdentity = {
	nodeId: string;
	sessionId: string;
};

export type WebHeroCodeReadinessSnapshot = {
	flowUpdatedAt: string;
	previewNodeIds: string[];
	codeInputDigest: string;
};

// The merge-dispatch precondition and every staged chunk require the parent agent to copy
// flowUpdatedAt / codeInputDigest / previewNodeIds verbatim from the latest readiness result.
// Those values only ever lived in the tool's structured `data`, never in the model-visible
// content — so the agent could never satisfy the contract and looped forever. Emitting them as
// a deterministic, copy-ready block in the readiness content closes that gap.
export function buildWebHeroMergeDispatchSnapshotText(snapshot: WebHeroCodeReadinessSnapshot): string {
	return [
		"[MERGE DISPATCH SNAPSHOT — copy these values EXACTLY into the webhero_merge_codegen task_contract and into every canvas_webhero_code_stage_raw_chunk call]",
		`flowUpdatedAt: ${snapshot.flowUpdatedAt}`,
		`codeInputDigest: ${snapshot.codeInputDigest}`,
		`previewNodeIds (use as task_contract.approvedPreviewNodes; persistedDraftCount = ${snapshot.previewNodeIds.length}): ${JSON.stringify(snapshot.previewNodeIds)}`,
	].join("\n");
}


export function nextWebHeroFlowRevision(baseUpdatedAt: string, candidateIso: string): string {
	const baseMs = Date.parse(baseUpdatedAt);
	const candidateMs = Date.parse(candidateIso);
	if (!Number.isFinite(baseMs) || !Number.isFinite(candidateMs)) {
		throw new AppError("WebHero flow revision timestamps must be valid ISO dates", {
			status: 500,
			code: "webhero_flow_revision_invalid",
			details: { baseUpdatedAt, candidateIso },
		});
	}
	return new Date(Math.max(candidateMs, baseMs + 1)).toISOString();
}

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequiredTrimmedString(record: Record<string, unknown>, key: string): string {
	const value = readTrimmedString(record[key]);
	if (!value) {
		throw new AppError(`${key} is required`, {
			status: 400,
			code: "invalid_tool_args",
			details: { field: key },
		});
	}
	return value;
}

export function readWebHeroCodeStageIdentity(
	args: Record<string, unknown>,
): WebHeroCodeStageIdentity {
	return {
		nodeId: readRequiredTrimmedString(args, "nodeId"),
		sessionId: readRequiredTrimmedString(args, "sessionId"),
	};
}

export function readWebHeroCodeReadinessSnapshot(
	args: Record<string, unknown>,
): WebHeroCodeReadinessSnapshot {
	const flowUpdatedAt = readRequiredTrimmedString(args, "flowUpdatedAt");
	const codeInputDigest = readRequiredTrimmedString(args, "codeInputDigest");
	if (!/^sha256:[a-f0-9]{64}$/.test(codeInputDigest)) {
		throw new AppError("codeInputDigest must be the exact readiness SHA-256 digest", {
			status: 400,
			code: "webhero_code_invalid_args",
			details: { field: "codeInputDigest" },
		});
	}
	const rawPreviewNodeIds = args.previewNodeIds;
	if (!Array.isArray(rawPreviewNodeIds)) {
		throw new AppError("previewNodeIds must be a non-empty array", {
			status: 400,
			code: "webhero_code_invalid_args",
			details: { field: "previewNodeIds" },
		});
	}
	const previewNodeIds = rawPreviewNodeIds.map(readTrimmedString);
	if (
		previewNodeIds.length < 1 ||
		previewNodeIds.length > 20 ||
		previewNodeIds.some((nodeId) => !nodeId) ||
		new Set(previewNodeIds).size !== previewNodeIds.length
	) {
		throw new AppError("previewNodeIds must contain unique non-empty node IDs", {
			status: 400,
			code: "webhero_code_invalid_args",
			details: { field: "previewNodeIds" },
		});
	}
	return { flowUpdatedAt, previewNodeIds: previewNodeIds.slice().sort(), codeInputDigest };
}

export function assertWebHeroCodeReadinessSnapshotMatches(
	expected: WebHeroCodeReadinessSnapshot,
	actual: WebHeroCodeReadinessSnapshot,
): void {
	const expectedIds = expected.previewNodeIds.slice().sort();
	const actualIds = actual.previewNodeIds.slice().sort();
	if (
		expected.flowUpdatedAt === actual.flowUpdatedAt &&
		expected.codeInputDigest === actual.codeInputDigest &&
		expectedIds.length === actualIds.length &&
		expectedIds.every((nodeId, index) => nodeId === actualIds[index])
	) {
		return;
	}
	throw new AppError("WebHero readiness snapshot changed before code commit", {
		status: 409,
		code: "webhero_code_readiness_snapshot_mismatch",
		details: { expected: { ...expected, previewNodeIds: expectedIds }, actual: { ...actual, previewNodeIds: actualIds } },
	});
}

function readWebHeroCodeField(value: unknown): WebHeroCodeCanonicalField {
	const field = readTrimmedString(value);
	if (field === "webHeroHtml" || field === "html") return "webHeroHtml";
	if (field === "webHeroCss" || field === "css") return "webHeroCss";
	if (
		field === "webHeroDocumentHtml" ||
		field === "documentHtml"
	) {
		throw new AppError(
			"webHeroDocumentHtml is derived from staged HTML and CSS at commit time",
			{
				status: 400,
				code: "webhero_code_document_field_forbidden",
				details: { field },
			},
		);
	}
	throw new AppError("webHero code field is invalid", {
		status: 400,
		code: "webhero_code_invalid_args",
		details: { field: "field", got: value },
	});
}

function decodeBase64Utf8(value: string): string {
	const compact = value.replace(/\s+/g, "");
	if (!compact || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
		throw new AppError("chunkBase64 must be valid base64", {
			status: 400,
			code: "webhero_code_invalid_args",
			details: { field: "chunkBase64" },
		});
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(compact, "base64"));
	} catch {
		throw new AppError("chunkBase64 must decode to UTF-8 text", {
			status: 400,
			code: "webhero_code_invalid_args",
			details: { field: "chunkBase64" },
		});
	}
}

function readWebHeroCodeChunk(args: Record<string, unknown>): string {
	const rawChunk = typeof args.chunk === "string" ? args.chunk : "";
	const rawChunkBase64 = typeof args.chunkBase64 === "string" ? args.chunkBase64 : "";
	const hasChunk = rawChunk.trim().length > 0;
	const hasChunkBase64 = rawChunkBase64.trim().length > 0;
	if (!hasChunk && !hasChunkBase64) {
		throw new AppError("either chunk or chunkBase64 must be provided", {
			status: 400,
			code: "webhero_code_invalid_args",
			details: { fields: ["chunk", "chunkBase64"] },
		});
	}
	if (hasChunk && hasChunkBase64) {
		throw new AppError("provide exactly one of chunk or chunkBase64", {
			status: 400,
			code: "webhero_code_invalid_args",
			details: { fields: ["chunk", "chunkBase64"] },
		});
	}
	const chunk = hasChunkBase64 ? decodeBase64Utf8(rawChunkBase64) : rawChunk;
	if (!chunk.trim()) {
		throw new AppError("decoded chunk must be non-empty", {
			status: 400,
			code: "webhero_code_invalid_args",
			details: { field: hasChunkBase64 ? "chunkBase64" : "chunk" },
		});
	}
	if (chunk.length > 8000) {
		throw new AppError("chunk must be at most 8000 characters", {
			status: 400,
			code: "webhero_code_invalid_args",
			details: { field: "chunk", length: chunk.length },
		});
	}
	return chunk;
}

function readBoundedInteger(
	record: Record<string, unknown>,
	key: string,
	min: number,
	max: number,
): number {
	const value = record[key];
	if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
		throw new AppError(`${key} must be an integer between ${min} and ${max}`, {
			status: 400,
			code: "webhero_code_invalid_args",
			details: { field: key, got: value, min, max },
		});
	}
	return value;
}

function cloneFields(fields: WebHeroCodeStageFields): WebHeroCodeStageFields {
	const cloned: WebHeroCodeStageFields = {};
	for (const field of ["webHeroHtml", "webHeroCss"] as const) {
		const staged = fields[field];
		if (staged) cloned[field] = { total: staged.total, chunks: { ...staged.chunks } };
	}
	return cloned;
}

function assertSessionIdentity(
	session: WebHeroCodeStageSession,
	flowId: string,
	identity: WebHeroCodeStageIdentity,
): void {
	if (
		session.flowId === flowId &&
		session.nodeId === identity.nodeId &&
		session.sessionId === identity.sessionId
	) {
		return;
	}
	throw new AppError("Loaded webHero code stage session identity does not match the command", {
		status: 409,
		code: "webhero_code_stage_identity_mismatch",
		details: {
			expected: {
				flowId: session.flowId,
				nodeId: session.nodeId,
				sessionId: session.sessionId,
			},
			got: { flowId, ...identity },
		},
	});
}

export function buildWebHeroDocumentHtml(html: string, css: string): string {
	const styleBlock = `<style>\n${css}\n</style>`;
	const skipDocumentTrivia = (value: string, from: number): number => {
		let index = from;
		while (index < value.length) {
			const whitespace = value.slice(index).match(/^[\uFEFF\s]+/);
			if (whitespace) {
				index += whitespace[0].length;
				continue;
			}
			if (value.startsWith("<!--", index)) {
				const end = value.indexOf("-->", index + 4);
				if (end < 0) return index;
				index = end + 3;
				continue;
			}
			break;
		}
		return index;
	};
	let rootIndex = skipDocumentTrivia(html, 0);
	const leadingDoctype = html.slice(rootIndex).match(/^<!doctype\s+html[^>]*>/i);
	if (leadingDoctype) {
		rootIndex = skipDocumentTrivia(html, rootIndex + leadingDoctype[0].length);
	}
	const htmlOpening = html.slice(rootIndex).match(/^<html(?:\s[^>]*)?>/i);
	if (htmlOpening) {
		const afterHtmlOpening = rootIndex + htmlOpening[0].length;
		const headIndex = skipDocumentTrivia(html, afterHtmlOpening);
		const headOpening = html.slice(headIndex).match(/^<head(?:\s[^>]*)?>/i);
		if (headOpening) {
			const afterHeadOpening = headIndex + headOpening[0].length;
			const firstHeadContentIndex = skipDocumentTrivia(html, afterHeadOpening);
			if (html.startsWith(styleBlock, firstHeadContentIndex)) return html;
			return `${html.slice(0, afterHeadOpening)}\n${styleBlock}${html.slice(afterHeadOpening)}`;
		}
		return `${html.slice(0, afterHtmlOpening)}\n<head>\n${styleBlock}\n</head>${html.slice(afterHtmlOpening)}`;
	}
	const doctype = leadingDoctype?.[0] || "<!doctype html>";
	const doctypeStart = leadingDoctype ? skipDocumentTrivia(html, 0) : -1;
	const fragment = leadingDoctype
		? `${html.slice(0, doctypeStart)}${html.slice(doctypeStart + leadingDoctype[0].length)}`
		: html;
	return [
		doctype,
		'<html lang="en">',
		"<head>",
		'<meta charset="utf-8" />',
		'<meta name="viewport" content="width=device-width, initial-scale=1" />',
		"<title>WebHero Preview</title>",
		styleBlock,
		"</head>",
		"<body>",
		fragment,
		"</body>",
		"</html>",
	].join("\n");
}

export function stageWebHeroCodeChunkCommand(
	existing: WebHeroCodeStageSession | null,
	flowId: string,
	args: Record<string, unknown>,
	nowIso = new Date().toISOString(),
): { session: WebHeroCodeStageStaging; result: WebHeroCodeStageChunkResult } {
	const identity = readWebHeroCodeStageIdentity(args);
	const readinessSnapshot = readWebHeroCodeReadinessSnapshot(args);
	const field = readWebHeroCodeField(args.field);
	const index = readBoundedInteger(args, "index", 0, 199);
	const total = readBoundedInteger(args, "total", 1, 200);
	if (index >= total) {
		throw new AppError("index must be lower than total", {
			status: 400,
			code: "webhero_code_invalid_args",
			details: { index, total },
		});
	}
	const chunk = readWebHeroCodeChunk(args);
	if (existing) {
		assertSessionIdentity(existing, flowId, identity);
		assertWebHeroCodeReadinessSnapshotMatches(existing, readinessSnapshot);
		if (existing.status === "committed") {
			throw new AppError("This webHero code session has already been committed", {
				status: 400,
				code: "webhero_code_session_committed",
				details: { ...identity, committedAt: existing.committedAt },
			});
		}
		if (existing.status === "committing") {
			throw new AppError("This webHero code session is currently committing", {
				status: 409,
				code: "webhero_code_commit_in_progress",
				details: identity,
			});
		}
	}

	const fields = cloneFields(existing?.fields || {});
	const stagedField = fields[field];
	if (stagedField && stagedField.total !== total) {
		throw new AppError("staged field total changed within the same session", {
			status: 400,
			code: "webhero_code_invalid_args",
			details: { field, expectedTotal: stagedField.total, gotTotal: total },
		});
	}
	const nextField = stagedField || { total, chunks: {} };
	const chunkKey = index.toString();
	const existingChunk = nextField.chunks[chunkKey];
	if (typeof existingChunk === "string" && existingChunk !== chunk) {
		throw new AppError("staged chunk content changed within the same session", {
			status: 409,
			code: "webhero_code_chunk_conflict",
			details: { field, index },
		});
	}
	if (typeof existingChunk === "undefined") nextField.chunks[chunkKey] = chunk;
	fields[field] = nextField;
	const session: WebHeroCodeStageStaging = {
		status: "staging",
		flowId,
		nodeId: identity.nodeId,
		sessionId: identity.sessionId,
		flowUpdatedAt: readinessSnapshot.flowUpdatedAt,
		previewNodeIds: readinessSnapshot.previewNodeIds,
		codeInputDigest: readinessSnapshot.codeInputDigest,
		version: existing?.version || 0,
		createdAt: existing?.createdAt || nowIso,
		updatedAt: nowIso,
		fields,
	};
	const received = Object.keys(nextField.chunks).length;
	return {
		session,
		result: {
			...identity,
			field,
			index,
			total,
			received,
			complete: received === total,
		},
	};
}

function assembleStageField(
	session: WebHeroCodeStageSession,
	field: WebHeroCodeCanonicalField,
): string {
	const staged = session.fields[field];
	if (!staged) return "";
	const parts: string[] = [];
	for (let index = 0; index < staged.total; index += 1) {
		const chunk = staged.chunks[index.toString()];
		if (typeof chunk !== "string") {
			throw new AppError("Staged webHero code chunks are incomplete", {
				status: 400,
				code: "webhero_code_stage_incomplete",
				details: {
					nodeId: session.nodeId,
					sessionId: session.sessionId,
					field,
					missingIndex: index,
					total: staged.total,
				},
			});
		}
		parts.push(chunk);
	}
	return parts.join("");
}

export function replaceWebHeroCodeStageContent<T extends WebHeroCodeStageSession>(
	session: T,
	code: { html: string; css: string },
): T {
	return {
		...session,
		fields: {
			webHeroHtml: { total: 1, chunks: { "0": code.html } },
			webHeroCss: { total: 1, chunks: { "0": code.css } },
		},
	};
}

export function assertWebHeroCommittedNodeData(
	session: WebHeroCodeStageCommitted,
	nodeData: Record<string, unknown>,
): void {
	const html = assembleStageField(session, "webHeroHtml");
	const css = assembleStageField(session, "webHeroCss");
	const expectedDocument = buildWebHeroDocumentHtml(html, css);
	const mismatchedFields: string[] = [];
	if (nodeData.webHeroHtml !== html) mismatchedFields.push("webHeroHtml");
	if (nodeData.webHeroCss !== css) mismatchedFields.push("webHeroCss");
	if (nodeData.webHeroDocumentHtml !== expectedDocument) {
		mismatchedFields.push("webHeroDocumentHtml");
	}
	if (readTrimmedString(nodeData.webHeroCodeSessionId) !== session.sessionId) {
		mismatchedFields.push("webHeroCodeSessionId");
	}
	if (readTrimmedString(nodeData.webHeroCodeCommittedAt) !== session.committedAt) {
		mismatchedFields.push("webHeroCodeCommittedAt");
	}
	if (nodeData.webHeroFinalCodeStale !== false) {
		mismatchedFields.push("webHeroFinalCodeStale");
	}
	const evidence = isRecord(nodeData.webHeroCodeEvidence) ? nodeData.webHeroCodeEvidence : null;
	const evidencePreviewNodeIds = Array.isArray(evidence?.previewNodeIds)
		? evidence.previewNodeIds.map(readTrimmedString).filter(Boolean).sort()
		: [];
	const evidenceStyleReferenceUrls = Array.isArray(evidence?.styleReferenceUrls)
		? evidence.styleReferenceUrls.map(readTrimmedString).filter(Boolean).sort()
		: [];
	const currentStyleReferenceUrls = readSelectedWebHeroStyleReference(nodeData)?.referenceUrls
		.slice()
		.sort() || [];
	if (
		!evidence ||
		evidence.version !== 2 ||
		readTrimmedString(evidence.sessionId) !== session.sessionId ||
		readTrimmedString(evidence.codeInputDigest) !== session.codeInputDigest ||
		JSON.stringify(evidencePreviewNodeIds) !== JSON.stringify(session.previewNodeIds.slice().sort()) ||
		JSON.stringify(evidenceStyleReferenceUrls) !== JSON.stringify(currentStyleReferenceUrls)
	) {
		mismatchedFields.push("webHeroCodeEvidence");
	}
	if (!mismatchedFields.length) return;
	throw new AppError("Persisted webHero code does not match the committed stage session", {
		status: 409,
		code: "webhero_code_commit_state_mismatch",
		details: {
			flowId: session.flowId,
			nodeId: session.nodeId,
			sessionId: session.sessionId,
			mismatchedFields,
		},
	});
}

export function beginWebHeroCodeCommitCommand(
	session: WebHeroCodeStageSession | null,
	flowId: string,
	args: Record<string, unknown>,
	nowIso = new Date().toISOString(),
):
	| { session: WebHeroCodeStageCommitting; outcome: Extract<WebHeroCodeCommitOutcome, { kind: "patch" }> }
	| { session: WebHeroCodeStageCommitted; outcome: Extract<WebHeroCodeCommitOutcome, { kind: "idempotent" }> } {
	const identity = readWebHeroCodeStageIdentity(args);
	if (!session) {
		throw new AppError(
			"No staged webHero code chunks found for this node/session. The commit sessionId must exactly match the staging sessionId.",
			{
				status: 400,
				code: "webhero_code_stage_not_found",
				details: identity,
			},
		);
	}
	assertSessionIdentity(session, flowId, identity);
	if (session.status === "committed") {
		return {
			session,
			outcome: {
				kind: "idempotent",
				...identity,
				committedAt: session.committedAt,
				committedNodeIds: [identity.nodeId],
			},
		};
	}
	if (session.status === "committing") {
		throw new AppError("This webHero code session is currently committing", {
			status: 409,
			code: "webhero_code_commit_in_progress",
			details: identity,
		});
	}
	const html = assembleStageField(session, "webHeroHtml");
	const css = assembleStageField(session, "webHeroCss");
	const data: Record<string, unknown> = {
		status: "success",
		progress: 100,
		webHeroProgressLabel: "网页代码已生成",
		lastError: null,
		webHeroHtml: html,
		webHeroCss: css,
		webHeroDocumentHtml: buildWebHeroDocumentHtml(html, css),
		webHeroCodeCommittedAt: nowIso,
		webHeroCodeSessionId: identity.sessionId,
	};
	assertWebHeroFinalCodePayloadUsable(data, { requireComplete: true });
	const committing: WebHeroCodeStageCommitting = {
		...session,
		status: "committing",
		updatedAt: nowIso,
		committedAt: nowIso,
	};
	return {
		session: committing,
		outcome: {
			kind: "patch",
			...identity,
			committedAt: nowIso,
			patch: {
				allowOverwrite: true,
				patchNodeData: [{ id: identity.nodeId, data }],
			},
			effects: {
				updatedNodeIds: [identity.nodeId],
				wroteCanvas: true,
			},
		},
	};
}

export function completeWebHeroCodeCommitCommand(
	session: WebHeroCodeStageCommitting,
	nowIso = new Date().toISOString(),
): WebHeroCodeStageCommitted {
	return { ...session, status: "committed", updatedAt: nowIso };
}
