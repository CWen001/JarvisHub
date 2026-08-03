import { expect, it } from 'vitest'
import { resolveNativeArtifactProjection } from './nativeArtifactProjection'

it('projects a successful same-node native asset into an Artifact Card', () => {
  expect(resolveNativeArtifactProjection({
    asset: {
      title: 'Watch concept',
      url: 'https://cdn.example/watch.png',
      mediaType: 'image',
      assetId: 'asset-1',
      assetRefId: 'watch_hero',
      nodeId: 'node-1',
    },
    nodes: [{
      id: 'node-1',
      data: {
        kind: 'image',
        imageUrl: 'https://cdn.example/watch.png',
        assetId: 'asset-1',
        assetRefId: 'watch_hero',
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

it('does not infer Artifact identity from a matching Canvas URL', () => {
  expect(resolveNativeArtifactProjection({
    asset: {
      title: 'Unbound image',
      url: 'https://cdn.example/unbound.png',
      mediaType: 'image',
      assetId: 'asset-1',
    },
    nodes: [{
      id: 'unrelated-node',
      data: {
        kind: 'image',
        imageUrl: 'https://cdn.example/unbound.png',
        assetId: 'different-asset',
        status: 'success',
      },
    }],
  })).toEqual({ kind: 'native-thumbnail' })
})

it.each(['queued', 'running', 'failed'])(
  'waits for successful persistence instead of projecting a %s placeholder',
  (status) => {
    expect(resolveNativeArtifactProjection({
      asset: {
        title: 'Watch concept',
        url: 'https://cdn.example/watch.png',
        mediaType: 'image',
        assetId: 'asset-1',
        nodeId: 'node-1',
      },
      nodes: [{
        id: 'node-1',
        data: {
          kind: 'image',
          imageUrl: 'https://cdn.example/watch.png',
          assetId: 'asset-1',
          status,
        },
      }],
    })).toEqual({ kind: 'native-thumbnail' })
  },
)

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
