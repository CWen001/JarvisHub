import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateCompatibility, mergeGitChanges } from './upstream-compatibility.mjs'

const registry = {
  upstreamRef: 'upstream/main',
  productOwnedRoots: [
    { path: 'apps/web/src/product-host/**', owner: 'Agent Workspace Product Host' },
  ],
  touchpoints: [
    {
      path: 'apps/web/src/ui/chat/AiChatDialog.tsx',
      classification: 'integration-seam',
      purpose: 'Expose mounted Native Chat Authority',
      adapter: 'Agent Workspace Adapter',
      tests: ['native-chat-contract'],
      upstreamDisposition: 'permanent',
      warningChangedLines: 40,
    },
    {
      path: 'apps/hono-api/src/modules/task/task.agents-bridge.ts',
      classification: 'upstream-patch',
      purpose: 'Temporary delivery correction',
      adapter: 'Public Chat Delivery Adapter',
      tests: ['public-chat-delivery'],
      upstreamDisposition: 'submit-upstream',
      warningChangedLines: 20,
    },
  ],
}

test('accepts Product-owned changes and registered native touchpoints', () => {
  const result = evaluateCompatibility({
    registry,
    changes: [
      { path: 'apps/web/src/product-host/AgentWorkspace.tsx', added: 80, deleted: 0 },
      { path: 'apps/web/src/ui/chat/AiChatDialog.tsx', added: 5, deleted: 2 },
    ],
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.violations, [])
  assert.equal(result.productOwnedChanges.length, 1)
  assert.equal(result.registeredTouchpoints.length, 1)
})

test('rejects an unregistered upstream-derived edit with an actionable reason', () => {
  const result = evaluateCompatibility({
    registry,
    changes: [{ path: 'apps/web/src/canvas/store.ts', added: 2, deleted: 0 }],
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.violations, [{
    path: 'apps/web/src/canvas/store.ts',
    reason: 'unregistered_upstream_derived_change',
    action: 'Move Product behavior into a Product-owned root, or register a narrow Integration Seam / Upstream Patch.',
  }])
})

test('warns when a registered seam grows without redefining compliance as line count', () => {
  const result = evaluateCompatibility({
    registry,
    changes: [{ path: 'apps/web/src/ui/chat/AiChatDialog.tsx', added: 35, deleted: 20 }],
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.warnings, [{
    path: 'apps/web/src/ui/chat/AiChatDialog.tsx',
    reason: 'registered_touchpoint_growth',
    changedLines: 55,
    warningChangedLines: 40,
  }])
})

test('supports explicit wildcard Product-owned roots without treating upstream changes as local edits', () => {
  const result = evaluateCompatibility({
    registry: {
      ...registry,
      productOwnedRoots: [...registry.productOwnedRoots, { path: 'docs/agent-workspace-*.md', owner: 'Product docs' }],
    },
    changes: [{ path: 'docs/agent-workspace-product-view.md', added: 10, deleted: 0 }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.productOwnedChanges[0].owner, 'Product docs')

  assert.deepEqual(mergeGitChanges(
    [{ path: 'apps/web/src/App.tsx', added: 2, deleted: 1 }],
    [{ path: 'apps/web/src/App.tsx', added: 1, deleted: 0 }, { path: 'README.md', added: 3, deleted: 0 }],
  ), [
    { path: 'apps/web/src/App.tsx', added: 3, deleted: 1 },
    { path: 'README.md', added: 3, deleted: 0 },
  ])
})

test('requires complete ownership and verification metadata for every touchpoint', () => {
  const result = evaluateCompatibility({
    registry: {
      ...registry,
      touchpoints: [{
        path: 'apps/web/src/App.tsx',
        classification: 'integration-seam',
        purpose: '',
        adapter: '',
        tests: [],
        upstreamDisposition: '',
      }],
    },
    changes: [],
  })

  assert.equal(result.ok, false)
  assert.ok(result.registryErrors.some((error) => error.includes('apps/web/src/App.tsx')))
})
