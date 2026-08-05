import { describe, expect, it } from "vitest";
import {
	finalizePublicChatDeliveryOutcome,
	reconcilePublicChatDelivery,
} from "./public-chat-delivery-adapter";

const mediaAgentCall = {
	name: "Agent",
	status: "succeeded",
	requestedAgentType: "media",
	outputJson: {
		subagentType: "media",
		fullText: JSON.stringify({
			status: "completed",
			completed: [{
				nodeId: "tablet_concept_01",
				assetId: "asset-tablet-01",
				status: "success",
				persisted: true,
			}],
		}),
	},
};

const persistedGraph = {
	nodes: [{
		id: "tablet_concept_01",
		data: {
			kind: "image",
			status: "success",
			imageUrl: "https://jarvis.example/assets/tablet-concept.png",
			assetId: "asset-tablet-01",
		},
	}],
};

describe("Public Chat Delivery Adapter", () => {
	it("materializes a same-turn Media asset from authoritative Canvas persistence", async () => {
		const result = await reconcilePublicChatDelivery({
			upstreamAssets: [],
			streamMediaResults: [],
			toolCalls: [mediaAgentCall],
			flowId: "flow-1",
			readFlowGraph: async (flowId) => {
				expect(flowId).toBe("flow-1");
				return persistedGraph;
			},
		});

		expect(result.assets).toEqual([{
			type: "image",
			url: "https://jarvis.example/assets/tablet-concept.png",
			assetId: "asset-tablet-01",
		}]);
		expect(result.executionEvidence).toEqual({ generatedAssets: true, wroteCanvas: true });
		expect(result.mediaReconciliation).toEqual({
			claimedSuccessfulNodeIds: ["tablet_concept_01"],
			persistedSuccessfulNodeIds: ["tablet_concept_01"],
			unresolvedSuccessfulNodeIds: [],
		});
	});

	it("preserves a usable Artifact when a downstream runtime failure reaches final delivery", () => {
		expect(finalizePublicChatDeliveryOutcome({
			outcome: {
				status: "failed",
				reasons: ["runtime_completion_explicit_failure", "runtime_completion_reason:summary_failed"],
			},
			hasUsableArtifact: true,
		})).toEqual({
			status: "partial",
			reasons: ["runtime_completion_explicit_failure", "runtime_completion_reason:summary_failed"],
		});
	});

	it("does not infer an unrelated historical Canvas asset", async () => {
		const result = await reconcilePublicChatDelivery({
			upstreamAssets: [],
			streamMediaResults: [],
			toolCalls: [],
			flowId: "flow-1",
			readFlowGraph: async () => persistedGraph,
		});

		expect(result.assets).toEqual([]);
		expect(result.executionEvidence).toEqual({ generatedAssets: false, wroteCanvas: false });
	});

});
