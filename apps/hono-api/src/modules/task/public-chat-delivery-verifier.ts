export type PublicChatSemanticTaskSummary = {
	taskGoal: string;
	requestedOutput: string;
	taskKind: string;
	recommendedNextStage: string;
	mustStop: boolean;
	blockingGaps: string[];
	successCriteria: string[];
	deliveryContract?: PublicChatSemanticDeliveryContract | null;
};

export type PublicChatExpectedDeliveryKind =
	| "none"
	| "generic_execution"
	| "single_baseframe_preproduction"
	| "video_followup";

export type PublicChatSemanticDeliveryContract = {
	kind: Exclude<PublicChatExpectedDeliveryKind, "none">;
	minStillCount?: number;
};

export type PublicChatExpectedDeliverySummary = {
	active: boolean;
	kind: PublicChatExpectedDeliveryKind;
	source:
		| "none"
		| "semantic_task_summary"
		| "selected_video_context";
	reason: string;
	minStillCount: number | null;
};

export type PublicChatDeliveryEvidence = {
	assetCount: number;
	imageAssetCount: number;
	videoAssetCount: number;
	directImageOutputCount?: number;
	directVideoOutputCount?: number;
	pendingDirectImageTaskCount?: number;
	pendingDirectVideoTaskCount?: number;
	wroteCanvas: boolean;
	generatedAssets: boolean;
	imageLikeNodeCount: number;
	preproductionImageLikeNodeCount: number;
	reusablePreproductionImageLikeNodeCount: number;
	hasVideoNodes: boolean;
	hasMaterializedVisualOutputs: boolean;
	webHeroDelivery?: PublicChatWebHeroDeliveryEvidence;
	canvasPersistence?: PublicChatCanvasPersistenceEvidence;
};

export type PublicChatWebHeroDeliveryEvidence = {
	checked: boolean;
	updatedWebHeroNodeIds: string[];
	sectionCount: number;
	previewReferenceImageCount: number;
	referencedSectionIds: string[];
	missingReferencedSectionIds: string[];
	errorCode?: string;
};

export type PublicChatCanvasPersistenceEvidence = {
	checked: boolean;
	flowId: string | null;
	updatedAt: string | null;
	declaredNodeIds: string[];
	persistedNodeIds: string[];
	missingNodeIds: string[];
	declaredAssetUrls: string[];
	persistedAssetUrls: string[];
	missingAssetUrls: string[];
	persistedVisualNodeCount: number;
	persistedImageNodeCount: number;
	persistedVideoNodeCount: number;
	persistedMaterializedOutputCount: number;
	errorCode?: string;
};

export type PublicChatDeliveryVerificationSummary = {
	applicable: boolean;
	status: "not_applicable" | "satisfied" | "failed";
	code: string | null;
	summary: string;
};

function normalizeText(value: string | null | undefined): string {
	return String(value || "").trim().toLowerCase();
}

function isVideoLikeKind(value: string | null | undefined): boolean {
	const normalized = normalizeText(value);
	return normalized === "video" || normalized === "composevideo";
}

function readEvidenceCount(value: number | null | undefined): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) return 0;
	return Math.max(0, Math.trunc(numeric));
}

function countPendingDirectImageTasks(evidence: PublicChatDeliveryEvidence): number {
	return readEvidenceCount(evidence.pendingDirectImageTaskCount);
}

function countPendingDirectVideoTasks(evidence: PublicChatDeliveryEvidence): number {
	return readEvidenceCount(evidence.pendingDirectVideoTaskCount);
}

function countPendingDirectMediaTasks(evidence: PublicChatDeliveryEvidence): number {
	return countPendingDirectImageTasks(evidence) + countPendingDirectVideoTasks(evidence);
}

function countDirectMediaOutputs(evidence: PublicChatDeliveryEvidence): number {
	return readEvidenceCount(evidence.directImageOutputCount) + readEvidenceCount(evidence.directVideoOutputCount);
}

function buildCanvasPersistenceVerification(
	evidence: PublicChatDeliveryEvidence,
): PublicChatDeliveryVerificationSummary | null {
	const persistence = evidence.canvasPersistence;
	if (!evidence.wroteCanvas || !persistence) return null;
	const declaredWriteTargetCount =
		persistence.declaredNodeIds.length + persistence.declaredAssetUrls.length;
	if (declaredWriteTargetCount <= 0) return null;
	if (!persistence.checked) {
		return {
			applicable: true,
			status: "failed",
			code: "canvas_write_verification_unavailable",
			summary: persistence.errorCode || "canvas_write_verification_unavailable",
		};
	}
	if (persistence.missingNodeIds.length > 0 || persistence.missingAssetUrls.length > 0) {
		return {
			applicable: true,
			status: "failed",
			code: "canvas_write_not_persisted",
			summary: "canvas_write_not_persisted",
		};
	}
	return null;
}

function buildWebHeroDeliveryVerification(
	evidence: PublicChatDeliveryEvidence,
): PublicChatDeliveryVerificationSummary | null {
	const webHero = evidence.webHeroDelivery;
	if (!webHero) return null;
	if (!webHero.checked) {
		return {
			applicable: true,
			status: "failed",
			code: "webhero_delivery_verification_unavailable",
			summary: webHero.errorCode || "webhero_delivery_verification_unavailable",
		};
	}
	if (webHero.previewReferenceImageCount === 0) {
		// Final code was committed without ever loading the approved preview images
		// as multimodal evidence. Without this gate the model writes a plausible-looking
		// page from prose/asset metadata alone and the result drifts from the previews.
		return {
			applicable: true,
			status: "failed",
			code: "webhero_final_code_skipped_preview_vision",
			summary: "final code was committed without calling canvas_read_node_media_for_context on the approved preview screenshots",
		};
	}
	if (webHero.previewReferenceImageCount > 0 && webHero.sectionCount < webHero.previewReferenceImageCount) {
		return {
			applicable: true,
			status: "failed",
			code: "webhero_section_count_below_preview_references",
			summary: "webhero_section_count_below_preview_references",
		};
	}
	if (webHero.missingReferencedSectionIds.length > 0) {
		return {
			applicable: true,
			status: "failed",
			code: "webhero_referenced_section_missing",
			summary: "webhero_referenced_section_missing",
		};
	}
	return null;
}

function normalizePositiveStillCount(value: unknown): number | null {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) return null;
	return Math.max(1, Math.trunc(numeric));
}

function readStructuredDeliveryContract(
	summary: PublicChatSemanticTaskSummary | null,
): PublicChatSemanticDeliveryContract | null {
	const contract = summary?.deliveryContract;
	if (!contract) return null;
	const kind = normalizeText(contract.kind);
		if (
			kind !== "generic_execution" &&
			kind !== "single_baseframe_preproduction" &&
			kind !== "video_followup"
		) {
		return null;
	}
	const minStillCount = normalizePositiveStillCount(contract.minStillCount);
	return {
		kind: kind as PublicChatSemanticDeliveryContract["kind"],
		...(minStillCount ? { minStillCount } : {}),
	};
}

function computeStillDeliveryUnitCount(evidence: PublicChatDeliveryEvidence): number {
	return Math.max(
		evidence.imageAssetCount,
		readEvidenceCount(evidence.directImageOutputCount),
		evidence.imageLikeNodeCount,
	);
}

function buildPendingDirectMediaVerification(
	kind: "image" | "video" | "any",
	evidence: PublicChatDeliveryEvidence,
): PublicChatDeliveryVerificationSummary | null {
	const pendingCount =
		kind === "image"
			? countPendingDirectImageTasks(evidence)
			: kind === "video"
				? countPendingDirectVideoTasks(evidence)
				: countPendingDirectMediaTasks(evidence);
	if (pendingCount <= 0) return null;
	const completedCount =
		kind === "image"
			? readEvidenceCount(evidence.directImageOutputCount) + evidence.imageAssetCount
			: kind === "video"
				? readEvidenceCount(evidence.directVideoOutputCount) + evidence.videoAssetCount
				: countDirectMediaOutputs(evidence) + evidence.assetCount;
	if (completedCount > 0) return null;
	return {
		applicable: true,
		status: "failed",
		code: "direct_media_generation_pending_result",
		summary: "direct_media_generation_pending_result",
	};
}

export function buildPublicChatExpectedDeliverySummary(input: {
	taskSummary: PublicChatSemanticTaskSummary | null;
	requiresExecutionDelivery: boolean;
	forceAssetGeneration: boolean;
	selectedNodeKind: string | null;
	selectedReferenceKind: string | null;
}): PublicChatExpectedDeliverySummary {
	const executionRequested = input.requiresExecutionDelivery || input.forceAssetGeneration;
	if (!executionRequested) {
		return {
			active: false,
			kind: "none",
			source: "none",
			reason: "no_execution_delivery_required",
			minStillCount: null,
		};
	}
	const explicitDeliveryContract = readStructuredDeliveryContract(input.taskSummary);
	if (explicitDeliveryContract) {
		return {
			active: true,
			kind: explicitDeliveryContract.kind,
			source: "semantic_task_summary",
			reason: "explicit_structured_delivery_contract",
			minStillCount:
				explicitDeliveryContract.kind === "single_baseframe_preproduction"
					? explicitDeliveryContract.minStillCount ?? 1
					: null,
		};
	}
	if (isVideoLikeKind(input.selectedNodeKind) || isVideoLikeKind(input.selectedReferenceKind)) {
		return {
			active: true,
			kind: "video_followup",
			source: "selected_video_context",
			reason: "selected_context_is_video_like",
			minStillCount: null,
		};
	}
	return {
		active: true,
		kind: "generic_execution",
		source: "semantic_task_summary",
		reason: "generic_execution_delivery",
		minStillCount: null,
	};
}

export function verifyPublicChatDelivery(input: {
	expected: PublicChatExpectedDeliverySummary;
	evidence: PublicChatDeliveryEvidence;
}): PublicChatDeliveryVerificationSummary {
	const webHeroDeliveryVerification = buildWebHeroDeliveryVerification(input.evidence);
	if (webHeroDeliveryVerification) return webHeroDeliveryVerification;

	if (!input.expected.active || input.expected.kind === "none") {
		return {
			applicable: false,
			status: "not_applicable",
			code: null,
			summary: "no_expected_delivery_contract",
		};
	}

	const canvasPersistenceVerification = buildCanvasPersistenceVerification(input.evidence);
	if (canvasPersistenceVerification) return canvasPersistenceVerification;

	switch (input.expected.kind) {
		case "single_baseframe_preproduction": {
			const pendingVerification = buildPendingDirectMediaVerification("image", input.evidence);
			if (pendingVerification) return pendingVerification;
				const satisfied =
					input.evidence.imageAssetCount >= 1 ||
					readEvidenceCount(input.evidence.directImageOutputCount) >= 1 ||
					input.evidence.imageLikeNodeCount >= 1;
				return {
				applicable: true,
				status: satisfied ? "satisfied" : "failed",
				code: satisfied ? null : "single_baseframe_preproduction_missing",
				summary: satisfied
					? "single_baseframe_preproduction_delivered"
					: "single_baseframe_preproduction_missing",
				};
			}
			case "video_followup": {
			const pendingVerification = buildPendingDirectMediaVerification("video", input.evidence);
			if (pendingVerification) return pendingVerification;
			const satisfied =
				input.evidence.videoAssetCount >= 1 ||
				readEvidenceCount(input.evidence.directVideoOutputCount) >= 1 ||
				input.evidence.hasVideoNodes ||
				(input.evidence.wroteCanvas && input.evidence.hasMaterializedVisualOutputs);
			return {
				applicable: true,
				status: satisfied ? "satisfied" : "failed",
				code: satisfied ? null : "video_followup_delivery_missing",
				summary: satisfied
					? "video_followup_delivery_verified"
					: "video_followup_delivery_missing",
			};
		}
		case "generic_execution": {
			const pendingVerification = buildPendingDirectMediaVerification("any", input.evidence);
			if (pendingVerification) return pendingVerification;
			const satisfied =
				input.evidence.assetCount > 0 ||
				countDirectMediaOutputs(input.evidence) > 0 ||
				input.evidence.generatedAssets ||
				input.evidence.wroteCanvas;
			return {
				applicable: true,
				status: satisfied ? "satisfied" : "failed",
				code: satisfied ? null : "generic_execution_delivery_missing",
				summary: satisfied
					? "generic_execution_delivery_verified"
					: "generic_execution_delivery_missing",
			};
		}
		default:
			return {
				applicable: false,
				status: "not_applicable",
				code: null,
				summary: "no_expected_delivery_contract",
			};
	}
}
