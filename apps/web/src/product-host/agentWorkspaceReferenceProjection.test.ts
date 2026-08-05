import { describe, expect, it } from 'vitest'
import {
  clearSubmittedAgentWorkspaceReferences,
  projectAgentWorkspacePendingReferences,
  removeAgentWorkspacePendingReference,
} from './agentWorkspaceReferenceProjection'

const nativeComposerState = {
  replicateTargetImage: 'https://cdn.example/hidden-target.png',
  manualReferenceImages: ['https://cdn.example/reference.png'],
  manualReferenceVideos: [],
  uploadedReferenceAssetMeta: {
    'https://cdn.example/reference.png': { assetId: 'asset-reference', name: '材质参考' },
  },
}

describe('Agent Workspace reference projection', () => {
  it('projects a Professional target image into the Agent Composer before it can affect execution', () => {
    expect(projectAgentWorkspacePendingReferences(nativeComposerState)).toEqual([
      {
        kind: 'image',
        url: 'https://cdn.example/hidden-target.png',
        label: '目标效果图',
      },
      {
        kind: 'image',
        url: 'https://cdn.example/reference.png',
        label: '材质参考',
        assetId: 'asset-reference',
      },
    ])
  })

  it('removes a visible target reference from the same authoritative Chat Session state', () => {
    expect(removeAgentWorkspacePendingReference(
      nativeComposerState,
      'https://cdn.example/hidden-target.png',
    ).replicateTargetImage).toBe('')
  })

  it('clears all submitted Product references after a successful Agent request', () => {
    expect(clearSubmittedAgentWorkspaceReferences(nativeComposerState)).toMatchObject({
      replicateTargetImage: '',
      manualReferenceImages: [],
      manualReferenceVideos: [],
      uploadedReferenceAssetMeta: {},
    })
  })
})
