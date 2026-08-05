import { describe, expect, it } from "vitest";
import {
	collectSuccessfulPersistedMediaNodeIds,
	reconcilePublicChatMediaDelivery,
} from "./public-chat-media-reconciliation";

describe("public Chat media-to-Canvas delivery reconciliation", () => {
	it("recovers a successful persisted Canvas image omitted by the Media sub-agent response", () => {
		const result = reconcilePublicChatMediaDelivery({
			upstreamAssets: [],
			mediaResults: [{
				kind: "image",
				status: "succeeded",
				pending: false,
				nodeId: "tablet_concept_01",
			}],
			flowGraph: {
				nodes: [{
					id: "tablet_concept_01",
					data: {
						kind: "image",
						status: "success",
						imageUrl: "https://jarvis.example/assets/tablet-concept.png",
						assetId: "asset-tablet-01",
					},
				}],
			},
		});

		expect(result.assets).toEqual([{
			type: "image",
			url: "https://jarvis.example/assets/tablet-concept.png",
			assetId: "asset-tablet-01",
		}]);
		expect(result.persistedSuccessfulNodeIds).toEqual(["tablet_concept_01"]);
		expect(result.unresolvedSuccessfulNodeIds).toEqual([]);
	});

	it("finds persisted media declared only inside a successful Media sub-agent result", () => {
		const nodeIds = collectSuccessfulPersistedMediaNodeIds([{
			name: "Agent",
			status: "succeeded",
			requestedAgentType: "media",
			outputJson: {
				subagentType: "media",
				fullText: JSON.stringify({
					phase: "visual_asset",
					status: "completed",
					completed: [{
						nodeId: "tablet_concept_01",
						assetId: "asset-tablet-01",
						status: "success",
						persisted: true,
					}],
				}),
			},
		}]);

		expect(nodeIds).toEqual(["tablet_concept_01"]);
	});
});
