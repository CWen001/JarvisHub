import { AppError } from "../../middleware/error";
import { WEBHERO_CODE_INPUT_PHASES, hasMeaningfulWebHeroEvidence } from "../flow/flow.webhero-evidence-phases";
import { buildDefaultWebHeroGoalContract } from "./agents-tool-bridge.webhero-gate";
import {
	findMisplacedWebHeroWorkflowFields,
	requiredWebHeroWorkflowFieldPaths,
	WEBHERO_WORKFLOW_FIELD_PATH_ERROR,
} from "./agents-tool-bridge.webhero-workflow-contract";
import {
	diagnoseWebHeroAssetDecisions,
	diagnoseWebHeroAssetRequirements,
	diagnoseWebHeroImplementationBrief,
	diagnoseWebHeroSectionDraft,
} from "./agents-tool-bridge.webhero-evidence-contract";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertValidWebHeroEvidenceField(input: {
	nodeId: unknown;
	field: string;
	value: unknown;
}): void {
	let issues: string[] = [];
	if (input.field === "webPageImplementationBrief") {
		issues = diagnoseWebHeroImplementationBrief(input.value).issues;
	} else if (input.field === "webPageAssetRequirements") {
		issues = diagnoseWebHeroAssetRequirements(input.value).issues;
	} else if (input.field === "webPageAssetDecisions") {
		issues = diagnoseWebHeroAssetDecisions(input.value).issues;
	} else if (input.field === "webPageSectionDrafts") {
		if (!Array.isArray(input.value)) {
			issues = ["webPageSectionDrafts must be an array"];
		} else if (input.value.length > 0) {
			issues = input.value.flatMap((draft) => diagnoseWebHeroSectionDraft(draft).issues);
		}
	}
	if (issues.length === 0) return;
	throw new AppError(`Invalid WebHero evidence field: ${input.field}`, {
		status: 400,
		code: "webhero_evidence_invalid",
		details: {
			nodeId: typeof input.nodeId === "string" ? input.nodeId : null,
			field: input.field,
			issues,
		},
	});
}

export function buildUpdateNodeDataSemanticPatch(
	patchNodeData: Array<Record<string, unknown>>,
): {
	patch: {
		patchNodeData: Array<Record<string, unknown> & {
			mergeStrategy: "overwrite" | "skip-equal";
			webHeroRewindFromPhase?: string;
		}>;
	};
	effects: {
		updatedNodeIds: string[];
		wroteCanvas: true;
	};
} {
	const items = patchNodeData.flatMap((item) => {
		const id = item.id;
		const data = isPlainRecord(item.data)
			? item.data as Record<string, unknown>
			: {};
		for (const field of [
			"webPageImplementationBrief",
			"webPageAssetRequirements",
			"webPageAssetDecisions",
			"webPageSectionDrafts",
		]) {
			if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
			assertValidWebHeroEvidenceField({ nodeId: id, field, value: data[field] });
		}
			const misplacedWorkflowFields = findMisplacedWebHeroWorkflowFields(data);
			if (misplacedWorkflowFields.length > 0) {
				throw new AppError(WEBHERO_WORKFLOW_FIELD_PATH_ERROR.message, {
					status: 400,
					code: WEBHERO_WORKFLOW_FIELD_PATH_ERROR.code,
				details: {
					nodeId: typeof id === "string" ? id : null,
					fields: misplacedWorkflowFields,
					requiredPaths: requiredWebHeroWorkflowFieldPaths(misplacedWorkflowFields),
				},
			});
		}
		const suppliedServerOwnedFields = ["webPreviewStyleReferenceUrls", "webHeroCodeEvidence", "webHeroFinalCodeStale"]
			.filter((field) => Object.prototype.hasOwnProperty.call(data, field));
		if (suppliedServerOwnedFields.length > 0) {
			throw new AppError("WebHero provenance fields are server-owned", {
				status: 409,
				code: "webhero_provenance_field_server_owned",
				details: {
					nodeId: typeof id === "string" ? id : null,
					fields: suppliedServerOwnedFields,
				},
			});
		}
		const {
			webPageWorkflowContract,
			webHeroGoalContract,
			webPageSectionDrafts,
			webHeroResetDownstreamEvidence,
			webHeroRewindFromPhase,
			...replaceFields
		} = data;
		const allowedRewindPhases = new Set([
			"preview_visual_spec",
			"asset_inventory",
			"asset_resolution",
			"section_codegen",
		]);
		if (
			typeof webHeroRewindFromPhase !== "undefined" &&
			(typeof webHeroRewindFromPhase !== "string" || !allowedRewindPhases.has(webHeroRewindFromPhase))
		) {
			throw new AppError("webHeroRewindFromPhase is invalid", {
				status: 400,
				code: "webhero_evidence_rewind_invalid",
				details: {
					nodeId: typeof id === "string" ? id : null,
					allowedPhases: Array.from(allowedRewindPhases),
				},
			});
		}
		if (typeof webPageWorkflowContract !== "undefined" && !isPlainRecord(webPageWorkflowContract)) {
			throw new AppError("webPageWorkflowContract must be an object", {
				status: 400,
				code: "canvas_workflow_contract_invalid",
				details: { nodeId: typeof id === "string" ? id : null },
			});
		}
		if (typeof webHeroGoalContract !== "undefined" && !isPlainRecord(webHeroGoalContract)) {
			throw new AppError("webHeroGoalContract must be an object", {
				status: 400,
				code: "canvas_goal_contract_invalid",
				details: { nodeId: typeof id === "string" ? id : null },
			});
		}
		const styleSelectionTransition = isPlainRecord(webPageWorkflowContract) &&
			Object.prototype.hasOwnProperty.call(webPageWorkflowContract, "selectedStyleReference");
		const approvedPreviewTransition = isPlainRecord(webPageWorkflowContract) &&
			Object.prototype.hasOwnProperty.call(webPageWorkflowContract, "approvedPreviewNodes");
		const sharedStyleBibleTransition = isPlainRecord(webPageWorkflowContract) &&
			Object.prototype.hasOwnProperty.call(webPageWorkflowContract, "sharedStyleBible");
		const transitionCount = Number(styleSelectionTransition) + Number(approvedPreviewTransition);
		if (sharedStyleBibleTransition && !styleSelectionTransition) {
			throw new AppError("selectedStyleReference and sharedStyleBible must be written together in one style transition", {
				status: 409,
				code: "webhero_style_bible_transition_required",
				details: {
					nodeId: typeof id === "string" ? id : null,
					requiredFlag: "webHeroResetDownstreamEvidence=true",
				},
			});
		}
		if (
			styleSelectionTransition
			&& !isPlainRecord(webPageWorkflowContract.selectedStyleReference)
		) {
			throw new AppError("A WebHero style transition requires a canonical selectedStyleReference object", {
				status: 400,
				code: "webhero_style_reference_transition_invalid",
				details: { nodeId: typeof id === "string" ? id : null },
			});
		}
		if (
			typeof webHeroResetDownstreamEvidence !== "undefined" &&
			webHeroResetDownstreamEvidence !== true
		) {
			throw new AppError("webHeroResetDownstreamEvidence only accepts true", {
				status: 400,
				code: "webhero_downstream_transition_invalid",
				details: { nodeId: typeof id === "string" ? id : null },
			});
		}
		const invalidatesDownstream = webHeroResetDownstreamEvidence === true;
		if (invalidatesDownstream && transitionCount !== 1) {
			throw new AppError("A WebHero downstream reset requires exactly one style or approved-preview transition", {
				status: 400,
				code: "webhero_downstream_transition_invalid",
				details: { nodeId: typeof id === "string" ? id : null },
			});
		}
		if (!invalidatesDownstream && transitionCount > 0) {
			throw new AppError("WebHero style and approved-preview transitions require webHeroResetDownstreamEvidence=true", {
				status: 409,
				code: "webhero_downstream_transition_required",
				details: { nodeId: typeof id === "string" ? id : null },
			});
		}
		const styleBibleIsUsable = sharedStyleBibleTransition &&
			isPlainRecord(webPageWorkflowContract) &&
			hasMeaningfulWebHeroEvidence(webPageWorkflowContract.sharedStyleBible);
		if (styleSelectionTransition && !styleBibleIsUsable) {
			throw new AppError("selectedStyleReference and sharedStyleBible must be written together in one style transition", {
				status: 409,
				code: "webhero_style_bible_transition_required",
				details: {
					nodeId: typeof id === "string" ? id : null,
					requiredFlag: "webHeroResetDownstreamEvidence=true",
				},
			});
		}
		const downstreamFieldNames = WEBHERO_CODE_INPUT_PHASES
			.flatMap(({ fields }) => fields)
			.filter((field) => field !== "webPageSectionDrafts");
		const suppliedDownstreamFields = downstreamFieldNames.filter((field) =>
			Object.prototype.hasOwnProperty.call(replaceFields, field),
		);
		if (
			invalidatesDownstream &&
			(
				typeof webPageSectionDrafts !== "undefined" ||
				suppliedDownstreamFields.length > 0
			)
		) {
			throw new AppError("A WebHero transition reset cannot also write downstream evidence", {
				status: 400,
				code: "webhero_downstream_transition_invalid",
				details: {
					nodeId: typeof id === "string" ? id : null,
					fields: [
						...(typeof webPageSectionDrafts === "undefined" ? [] : ["webPageSectionDrafts"]),
						...suppliedDownstreamFields,
					],
				},
			});
		}
		const invalidatesFinalCode = invalidatesDownstream;
		let workflowPatch = webPageWorkflowContract;
		if (isPlainRecord(webPageWorkflowContract) && invalidatesDownstream) {
			const incomingStatus = isPlainRecord(webPageWorkflowContract.stepStatus)
				? webPageWorkflowContract.stepStatus
				: {};
			const resetStatus = styleSelectionTransition
				? {
					preview_generation: "pending",
					preview_visual_spec: "pending",
					asset_inventory: "pending",
					asset_resolution: "pending",
					section_codegen: "pending",
					merge_codegen: "pending",
					final_code: "pending",
				}
				: {
					preview_visual_spec: "pending",
					asset_inventory: "pending",
					asset_resolution: "pending",
					section_codegen: "pending",
					merge_codegen: "pending",
					final_code: "pending",
				};
			workflowPatch = {
				...webPageWorkflowContract,
				...(styleSelectionTransition
					? { currentStep: "preview_generation", approvedPreviewNodes: [] }
					: { currentStep: "preview_visual_spec" }),
				stepStatus: { ...incomingStatus, ...resetStatus },
			};
		}
		const transitionGoalStep = styleSelectionTransition
			? "preview_generation"
			: "preview_visual_spec";
		const incomingGoalText = isPlainRecord(webHeroGoalContract) && typeof webHeroGoalContract.goal === "string"
			? webHeroGoalContract.goal
			: "";
		const transitionGoalContract = invalidatesFinalCode
			? buildDefaultWebHeroGoalContract({
				nodeId: typeof id === "string" ? id : "",
				...(incomingGoalText ? { goal: incomingGoalText } : {}),
				currentStep: transitionGoalStep,
				stepStatus: isPlainRecord(workflowPatch) && isPlainRecord(workflowPatch.stepStatus)
					? workflowPatch.stepStatus
					: undefined,
			})
			: null;
		if (transitionGoalContract && !incomingGoalText) delete transitionGoalContract.goal;
		const goalPatch = invalidatesFinalCode
			? transitionGoalContract || undefined
			: webHeroGoalContract;
		const downstreamResetFields = invalidatesDownstream ? {
			webPagePreviewVisualSpecs: [],
			visibleSubjectInventory: [],
			webPageVisibleSubjectInventory: [],
			webPageAssetRequirements: { visibleSubjectInventory: [], visualSlots: [] },
			webPageResolvedAssets: [],
			webPageAssetDecisions: {
				icons: [],
				searchAssets: [],
				generatedAssets: [],
				fontPlan: [],
				stylePlan: [],
			},
			componentReferencePlan: {},
			webPageImplementationBrief: {},
			webPageReferencePrompt: "",
			fontPlan: {},
			previewDetailChecklist: [],
		} : {};
		const finalCodeResetFields = invalidatesFinalCode ? {
			webHeroFinalCodeStale: true,
			webHeroCodeEvidence: null,
			webHeroHtml: "",
			webHeroCss: "",
			webHeroDocumentHtml: "",
			webHeroCodeSessionId: null,
			webHeroCodeCommittedAt: null,
			webHeroCodegenSessionKey: null,
			webHeroCodegenSessionPageHash: null,
			status: "idle",
			progress: 0,
			webHeroProgressLabel: "等待重新生成网页代码",
		} : {};
		const replacementPatch = { ...replaceFields, ...downstreamResetFields, ...finalCodeResetFields };
		const sectionDraftPatch = invalidatesDownstream ? [] : webPageSectionDrafts;
		const requestedRewindPhase = typeof webHeroRewindFromPhase === "string"
			? webHeroRewindFromPhase
			: "";
		if (requestedRewindPhase) {
			const phaseFields = WEBHERO_CODE_INPUT_PHASES.find((item) => item.phase === requestedRewindPhase)?.fields || [];
			const writesRequestedPhase = phaseFields.some((field) =>
				field === "webPageSectionDrafts"
					? typeof sectionDraftPatch !== "undefined"
					: Object.prototype.hasOwnProperty.call(replaceFields, field),
			);
			if (!writesRequestedPhase) {
				throw new AppError("webHeroRewindFromPhase must match the evidence phase being written", {
					status: 400,
					code: "webhero_evidence_rewind_invalid",
					details: {
						nodeId: typeof id === "string" ? id : null,
						requestedPhase: requestedRewindPhase,
					},
				});
			}
		}
		const contractPatchData = {
			...(typeof workflowPatch === "undefined" ? {} : { webPageWorkflowContract: workflowPatch }),
			...(typeof goalPatch === "undefined" ? {} : { webHeroGoalContract: goalPatch }),
		};
		return [
			...(Object.keys(contractPatchData).length === 0 ? [] : [{
				id,
				data: contractPatchData,
				mergeStrategy: "skip-equal" as const,
				...(invalidatesDownstream ? {
					webHeroRewindFromPhase: styleSelectionTransition
						? "preview_generation"
						: "preview_visual_spec",
				} : {}),
			}]),
			...(typeof sectionDraftPatch === "undefined" ? [] : [{
				id,
				data: { webPageSectionDrafts: sectionDraftPatch },
				mergeStrategy: "skip-equal" as const,
				...(requestedRewindPhase === "section_codegen"
					? { webHeroRewindFromPhase: requestedRewindPhase }
					: {}),
			}]),
			...(Object.keys(replacementPatch).length === 0 ? [] : [{
				id,
				data: replacementPatch,
				mergeStrategy: "overwrite" as const,
				...(requestedRewindPhase && requestedRewindPhase !== "section_codegen"
					? { webHeroRewindFromPhase: requestedRewindPhase }
					: {}),
			}]),
		];
	});
	return {
		patch: { patchNodeData: items },
		effects: {
			updatedNodeIds: patchNodeData
				.map((item) => typeof item.id === "string" ? item.id.trim() : "")
				.filter(Boolean),
			wroteCanvas: true,
		},
	};
}
