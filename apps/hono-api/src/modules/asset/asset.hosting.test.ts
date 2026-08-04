import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const assetRepo = vi.hoisted(() => ({
	createAssetRow: vi.fn(),
	findGeneratedAssetBySourceUrl: vi.fn(),
	updateAssetDataRow: vi.fn(),
}));

vi.mock("./asset.repo", () => assetRepo);

import { persistGeneratedTaskAssets } from "./asset.hosting";

describe("persistGeneratedTaskAssets", () => {
	beforeEach(() => {
		assetRepo.createAssetRow.mockReset();
		assetRepo.findGeneratedAssetBySourceUrl.mockReset();
		assetRepo.updateAssetDataRow.mockReset();
		assetRepo.findGeneratedAssetBySourceUrl.mockResolvedValue(null);
		assetRepo.createAssetRow.mockResolvedValue({ id: "duplicate-asset" });
	});

	it("does not persist an already-hosted asset with a stable asset id again", async () => {
		const asset = {
			type: "image" as const,
			url: "https://assets.example.test/gen/images/watch.png",
			thumbnailUrl: null,
			assetId: "asset-existing",
			sourceUrl: "https://provider.example.test/watch.png",
			modelInputUrl: "https://provider.example.test/watch.png",
		};
		const context = {
			env: {
				DB: {},
				R2_ACCESS_KEY_ID: "test-access-key",
				R2_SECRET_ACCESS_KEY: "test-secret-key",
				R2_BUCKET_URL: "https://account.example.test/bucket",
				R2_PUBLIC_BASE_URL: "https://assets.example.test",
				R2_REGION: "auto",
			},
			req: { url: "http://localhost:8788/public/agents/tools/execute" },
		// Only env/req are used by this asset-hosting branch.
		} as unknown as AppContext;

		const result = await persistGeneratedTaskAssets({
			c: context,
			userId: "local-workspace",
			assets: [asset],
		});

		expect(result).toEqual([asset]);
		expect(assetRepo.findGeneratedAssetBySourceUrl).not.toHaveBeenCalled();
		expect(assetRepo.createAssetRow).not.toHaveBeenCalled();
		expect(assetRepo.updateAssetDataRow).not.toHaveBeenCalled();
	});
});
