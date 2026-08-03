import { expect, it } from 'vitest'
import { resolveNativeArtifactProjection } from './nativeArtifactProjection'

it('projects a reliable native asset and node identity into an Artifact Card', () => {
  expect(resolveNativeArtifactProjection({
    asset: {
      title: 'Watch concept',
      url: 'https://cdn.example/watch.png',
      mediaType: 'image',
      assetId: 'asset-1',
      assetRefId: 'watch_hero',
    },
    nodes: [{
      id: 'node-1',
      data: {
        kind: 'image',
        imageUrl: 'https://cdn.example/watch.png',
        status: 'success',
      },
    }],
  })).toEqual({
    kind: 'artifact-card',
    title: 'Watch concept',
    url: 'https://cdn.example/watch.png',
    previewUrl: 'https://cdn.example/watch.png',
    mediaType: 'image',
    assetId: 'asset-1',
    assetRefId: 'watch_hero',
    nodeId: 'node-1',
    status: 'success',
  })
})

it('falls back to the native thumbnail when stable identity is incomplete', () => {
  expect(resolveNativeArtifactProjection({
    asset: {
      title: 'Unbound image',
      url: 'https://cdn.example/unbound.png',
      mediaType: 'image',
    },
    nodes: [],
  })).toEqual({ kind: 'native-thumbnail' })
})
