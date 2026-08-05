import { describe, expect, it } from "vitest";
import { buildAgentsBridgeTurnVerdict } from "./task.agents-bridge";

const baseInput = {
	text: "图片已经生成并保存到项目。",
	assetCount: 1,
	toolEvidence: {
		toolNames: ["Agent"],
		readProjectState: true,
		readNodeContextBundle: false,
		readVideoReviewBundle: false,
		readMaterialAssets: false,
		generatedAssets: true,
		wroteCanvas: true,
	},
	toolExecutionIssues: {
		failedToolCalls: 0,
		recoveredFailedToolCalls: 0,
		deniedToolCalls: 0,
		blockedToolCalls: 0,
		coordinationBlockedToolCalls: 0,
		actionableBlockedToolCalls: 0,
		hasExecutionIssues: false,
	},
	toolCalls: [],
	canvasPlanDiagnostics: {
		tagPresent: false,
		normalized: false as const,
		parseSuccess: false,
		error: "",
		errorCode: "",
		errorDetail: "",
		schemaIssues: [],
		detectedTagName: "",
		nodeCount: 0,
		edgeCount: 0,
		nodeKinds: [],
		hasAssetUrls: false,
		action: "",
		summary: "",
		reason: "",
		rawPayload: "",
	},
	diagnosticFlags: [],
	forceAssetGeneration: true,
	semanticExecutionIntent: {
		detected: true,
		source: "tool_trace_output_json" as const,
		taskKind: "image_generation",
		mustStop: false,
		requiresExecutionDelivery: true,
		reason: "execution_requested",
	},
	deliveryVerification: {
		applicable: true,
		status: "satisfied" as const,
		code: null,
		summary: "generic_execution_delivery_verified",
	},
};

describe("public Chat turn verdict with a usable persisted asset", () => {
	it("reports partial completion instead of discarding the asset after a downstream runtime failure", () => {
		const verdict = buildAgentsBridgeTurnVerdict({
			...baseInput,
			completionTrace: {
				source: "deterministic" as const,
				terminal: "explicit_failure" as const,
				allowFinish: true,
				failureReason: "downstream_summary_failed",
				rationale: "asset persisted before summary failure",
				successCriteria: [],
				missingCriteria: [],
				requiredActions: [],
			},
		});

		expect(verdict).toEqual({
			status: "partial",
			reasons: [
				"runtime_completion_explicit_failure",
				"runtime_completion_reason:downstream_summary_failed",
			],
		});
	});
});
