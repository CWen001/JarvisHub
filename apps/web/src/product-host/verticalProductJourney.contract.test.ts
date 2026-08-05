import { describe, expect, it } from 'vitest'
import { buildAssetChatReference } from '../ui/assetChatReference'
import { resolveNativeArtifactProjection } from '../ui/chat/nativeArtifactProjection'
import { installedVerticalSkills } from './installedVerticalSkills'
import { sharedProductBrand } from './productIdentity'
import { installVerticalProductHost } from './productHost'
import { resolveProductEntry } from './productExperience'
import { buildProjectSessionNavigation } from './productNavigationModel'
import { transitionProductWorkspace } from './productWorkspace'

for (const skillKey of installedVerticalSkills) {
  describe(`${skillKey} complete shared Product Host journey`, () => {
    it('preserves native identity from resume through Artifact reference and Canvas round-trip', async () => {
      const installation = await installVerticalProductHost(installedVerticalSkills, {
        discoverSkills: async () => ({
          skills: installedVerticalSkills.map((key) => ({ key, name: key })),
          loadErrors: [],
        }),
      })
      expect(installation.skillKeys).toContain(skillKey)

      const projects = [{
        id: 'project-1',
        name: 'Design project',
        updatedAt: '2026-08-03T00:00:00Z',
      }]
      const sessions = [{ id: 'session-1', title: 'Direction', updatedAt: 20 }]
      expect(resolveProductEntry({
        brand: sharedProductBrand,
        projects,
        sessionsByProject: { 'project-1': sessions },
      }).sessionId).toBe('session-1')
      expect(buildProjectSessionNavigation({
        projects,
        sessionsByProject: { 'project-1': sessions },
      })[0]?.sessions[0]?.id).toBe('session-1')

      const asset = {
        title: 'Professional design concept',
        url: 'https://cdn.example/concept.png',
        mediaType: 'image' as const,
        assetId: 'asset-1',
        assetRefId: 'design_concept',
        nodeId: 'node-1',
      }
      expect(resolveNativeArtifactProjection({
        asset,
        nodes: [{
          id: 'node-1',
          data: {
            kind: 'image',
            imageUrl: asset.url,
            assetId: asset.assetId,
            assetRefId: asset.assetRefId,
            status: 'success',
          },
        }],
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
