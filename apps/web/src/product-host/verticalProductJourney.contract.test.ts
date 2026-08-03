import { describe, expect, it } from 'vitest'
import { buildAssetChatReference } from '../ui/assetChatReference'
import { resolveNativeArtifactProjection } from '../ui/chat/nativeArtifactProjection'
import { installVerticalProductHost } from './productHost'
import { resolveProductEntry } from './productExperience'
import { buildProjectSessionNavigation } from './productNavigationModel'
import { transitionProductWorkspace } from './productWorkspace'
import { fixtureExtension } from './testing/fixtureExtension'
import { installedVerticalExtension } from './installedExtension'

for (const extension of [installedVerticalExtension, fixtureExtension]) {
  describe(`${extension.id} complete Product Host journey`, () => {
    it('preserves native identity from resume through Artifact reference and Canvas round-trip', async () => {
      const skillKey = extension.skillRoot.split('/').at(-1)!
      const installation = await installVerticalProductHost(extension, {
        discoverSkills: async () => ({
          skills: [{ key: skillKey, name: skillKey }],
          loadErrors: [],
        }),
      })
      expect(installation.brand).toEqual(extension.brand)

      const projects = [{
        id: 'project-1',
        name: 'Watch project',
        updatedAt: '2026-08-03T00:00:00Z',
      }]
      const sessions = [{ id: 'session-1', title: 'Direction', updatedAt: 20 }]
      expect(resolveProductEntry({
        extension,
        projects,
        sessionsByProject: { 'project-1': sessions },
      }).sessionId).toBe('session-1')
      expect(buildProjectSessionNavigation({
        projects,
        sessionsByProject: { 'project-1': sessions },
      })[0]?.sessions[0]?.id).toBe('session-1')

      const asset = {
        title: 'Professional watch concept',
        url: 'https://cdn.example/watch.png',
        mediaType: 'image' as const,
        assetId: 'asset-1',
        assetRefId: 'watch_concept',
        nodeId: 'node-1',
      }
      expect(resolveNativeArtifactProjection({
        asset,
        nodes: [{ id: 'node-1', data: { kind: 'image', imageUrl: asset.url, status: 'success' } }],
      }).kind).toBe('artifact-card')
      expect(buildAssetChatReference({
        kind: 'image',
        title: asset.title,
        url: asset.url,
        assetId: asset.assetId,
        assetRefId: asset.assetRefId,
        nodeId: asset.nodeId,
      })).toEqual(asset)

      const context = {
        projectId: 'project-1',
        flowId: 'flow-1',
        sessionId: 'session-1',
        selectedNodeId: 'node-1',
      }
      const canvas = transitionProductWorkspace({ surface: 'chat', context }, 'open-canvas')
      expect(transitionProductWorkspace(canvas, 'return-to-chat')).toEqual({
        surface: 'chat',
        context,
      })
    })
  })
}
