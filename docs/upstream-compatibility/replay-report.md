# Upstream replayability report

- Upstream baseline: `upstream/main`
- Product head: `6dddcbcbb01b9b8bd04c1d5f6edd737289438e50`
- Upstream divergence: no new upstream changes were present; this is replayability verification, not a conflict rehearsal.
- Product-owned paths replayed: 114
- Integration Seams replayed: 35
- Upstream Patches replayed: 14
- Coverage: PASS

## Registered native touchpoints

- integration-seam: `apps/agents-cli/agent-definitions/canvas.json`
- integration-seam: `apps/agents-cli/package.json`
- integration-seam: `apps/agents-cli/src/core/root-persona.ts`
- upstream-patch: `apps/agents-cli/src/llm/client.ts`
- upstream-patch: `apps/agents-cli/src/server/http-server.ts`
- upstream-patch: `apps/hono-api/src/modules/apiKey/public-agents-chat-response.ts`
- upstream-patch: `apps/hono-api/src/modules/apiKey/public-chat-session.repo.test.ts`
- upstream-patch: `apps/hono-api/src/modules/apiKey/public-chat-session.repo.ts`
- upstream-patch: `apps/hono-api/src/modules/asset/asset.hosting.test.ts`
- upstream-patch: `apps/hono-api/src/modules/asset/asset.hosting.ts`
- upstream-patch: `apps/hono-api/src/modules/memory/memory.service.ts`
- upstream-patch: `apps/hono-api/src/modules/task/agents-tool-bridge.generate-image-to-canvas.test.ts`
- upstream-patch: `apps/hono-api/src/modules/task/agents-tool-bridge.generate-image-to-canvas.ts`
- upstream-patch: `apps/hono-api/src/modules/task/agents-tool-recovery.test.ts`
- upstream-patch: `apps/hono-api/src/modules/task/agents-tool-recovery.ts`
- integration-seam: `apps/hono-api/src/modules/task/canvas-tools/catalog.ts`
- integration-seam: `apps/hono-api/src/modules/task/task.agents-bridge.ts`
- integration-seam: `apps/web/package.json`
- integration-seam: `apps/web/src/App.tsx`
- integration-seam: `apps/web/src/main.tsx`
- integration-seam: `apps/web/src/styles.css`
- integration-seam: `apps/web/src/ui/AssetCenterPanel.tsx`
- integration-seam: `apps/web/src/ui/assetChatReference.contract.test.ts`
- integration-seam: `apps/web/src/ui/assetChatReference.ts`
- integration-seam: `apps/web/src/ui/canvasAssetModel.ts`
- integration-seam: `apps/web/src/ui/chat/AiChatDialog.tsx`
- integration-seam: `apps/web/src/ui/chat/chatRequestPayload.test.ts`
- integration-seam: `apps/web/src/ui/chat/chatRequestPayload.ts`
- upstream-patch: `apps/web/src/ui/chat/chatRetry.contract.test.ts`
- upstream-patch: `apps/web/src/ui/chat/chatRetry.ts`
- integration-seam: `apps/web/src/ui/chat/chatRuntimeStore.ts`
- integration-seam: `apps/web/src/ui/chat/chatTabs.ts`
- integration-seam: `apps/web/src/ui/chat/chatTabs.verticalSkill.test.ts`
- integration-seam: `apps/web/src/ui/chat/executionSummaryModel.contract.test.ts`
- integration-seam: `apps/web/src/ui/chat/executionSummaryModel.ts`
- integration-seam: `apps/web/src/ui/chat/mediaResultArtifactProjection.contract.test.ts`
- integration-seam: `apps/web/src/ui/chat/mediaResultArtifactProjection.ts`
- integration-seam: `apps/web/src/ui/chat/MergedAskUserBubble.test.tsx`
- integration-seam: `apps/web/src/ui/chat/NativeArtifactCard.tsx`
- integration-seam: `apps/web/src/ui/chat/nativeArtifactProjection.contract.test.ts`
- integration-seam: `apps/web/src/ui/chat/nativeArtifactProjection.ts`
- integration-seam: `apps/web/src/ui/chat/timelineAutoFollow.test.ts`
- integration-seam: `apps/web/src/ui/chat/timelineAutoFollow.ts`
- integration-seam: `apps/web/src/ui/chat/TodoProgressCard.test.tsx`
- integration-seam: `apps/web/src/ui/chat/TodoProgressCard.tsx`
- integration-seam: `apps/web/src/ui/shared/ArtifactPreview.tsx`
- integration-seam: `apps/web/vite.config.ts`
- integration-seam: `package-lock.json`
- integration-seam: `package.json`

## Validation commands

- PASS (312 ms): `pnpm run test:upstream-compatibility`
- PASS (1245 ms): `pnpm --filter @jarvishub/api exec vitest run src/product-host/delivery/public-chat-delivery-adapter.test.ts src/product-host/delivery/public-chat-delivery-outcome.test.ts src/modules/task/agents-tool-bridge.generate-image-to-canvas.test.ts src/modules/task/agents-tool-recovery.test.ts src/modules/asset/asset.hosting.test.ts src/modules/apiKey/public-chat-session.repo.test.ts`
- PASS (2482 ms): `pnpm --filter @jarvishub/web test`
- PASS (274 ms): `pnpm --filter @jarvishub/api build`
- PASS (4241 ms): `pnpm --filter @jarvishub/web build`
- PASS (4192 ms): `pnpm --filter @jarvishub/web build:native`
- PASS (379 ms): `pnpm --filter agents validate:agent-defs`
- PASS (201 ms): `pnpm --filter agents validate:watch-skill`
- PASS (206 ms): `pnpm --filter agents validate:tablet-skill`
- PASS (1786 ms): `pnpm --filter agents build`

## Future upstream change

When `upstream/main` diverges, run this replay in a temporary worktree first, then perform a real temporary-worktree merge or rebase rehearsal and record the actual conflict set.
