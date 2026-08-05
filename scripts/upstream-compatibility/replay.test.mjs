import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReplayPlan, describeUpstreamDivergence, verifyReplayCoverage } from './replay.mjs'

const touchpoint = (path, classification) => ({
  path,
  classification,
  purpose: 'fixture purpose',
  adapter: 'fixture adapter',
  tests: ['fixture test'],
  upstreamDisposition: 'fixture disposition',
})

const registry = {
  upstreamRef: 'upstream/main',
  productOwnedRoots: [{ path: 'apps/web/src/product-host/**', owner: 'Product Host' }],
  touchpoints: [
    touchpoint('apps/web/src/App.tsx', 'integration-seam'),
    touchpoint('apps/web/src/ui/chat/chatRetry.ts', 'upstream-patch'),
  ],
}

const changes = [
  { path: 'apps/web/src/product-host/AgentWorkspace.tsx', added: 10, deleted: 0 },
  { path: 'apps/web/src/App.tsx', added: 2, deleted: 0 },
  { path: 'apps/web/src/ui/chat/chatRetry.ts', added: 3, deleted: 1 },
]

test('builds a replay plan with Product roots first and each native touchpoint isolated', () => {
  assert.deepEqual(buildReplayPlan({ registry, changes }), {
    productOwnedPaths: ['apps/web/src/product-host/AgentWorkspace.tsx'],
    touchpoints: [
      { path: 'apps/web/src/App.tsx', classification: 'integration-seam' },
      { path: 'apps/web/src/ui/chat/chatRetry.ts', classification: 'upstream-patch' },
    ],
  })
})

test('reports when a real upstream merge rehearsal is required', () => {
  assert.equal(describeUpstreamDivergence(0), 'no new upstream changes were present; this is replayability verification, not a conflict rehearsal.')
  assert.equal(describeUpstreamDivergence(3), '3 upstream commit(s) are not in Product HEAD; a real temporary-worktree merge or rebase rehearsal is required.')
})

test('rejects replay coverage that omits or adds a changed path', () => {
  assert.deepEqual(verifyReplayCoverage({
    expectedPaths: changes.map((item) => item.path),
    replayedPaths: changes.slice(0, 2).map((item) => item.path),
  }), {
    ok: false,
    missingPaths: ['apps/web/src/ui/chat/chatRetry.ts'],
    unexpectedPaths: [],
  })
})
