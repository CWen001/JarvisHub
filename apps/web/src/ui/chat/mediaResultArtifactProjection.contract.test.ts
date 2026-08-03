import { expect, it } from 'vitest'
import {
  resolveSuccessfulMediaResultArtifact,
  resolveSuccessfulToolSnapshotArtifacts,
} from './mediaResultArtifactProjection'

const succeeded = {
  kind: 'image' as const,
  nodeId: 'node-1',
  taskId: 'task-1',
  toolCallId: 'tool-1',
  toolName: 'canvas_image_generate_to_canvas' as const,
  status: 'succeeded' as const,
  pending: false,
  url: 'https://cdn.example/watch.png',
  flowId: 'flow-1',
  emittedAt: '2026-08-03T00:00:00Z',
}

it('projects a successful media event through its stable same-turn node identity', () => {
  expect(resolveSuccessfulMediaResultArtifact({
    result: succeeded,
    nodes: [{
      id: 'node-1',
      data: {
        kind: 'image',
        label: 'Cherry blossom watch',
        imageUrl: succeeded.url,
        assetId: 'asset-1',
        assetRefId: 'watch_concept',
        status: 'success',
      },
    }],
  })).toEqual({
    title: 'Cherry blossom watch',
    url: succeeded.url,
    thumbnailUrl: succeeded.url,
    mediaType: 'image',
    assetId: 'asset-1',
    assetRefId: 'watch_concept',
    nodeId: 'node-1',
  })
})

it.each([
  { ...succeeded, status: 'running' as const, pending: true },
  { ...succeeded, status: 'failed' as const, pending: false },
])('does not project $status media results', (result) => {
  expect(resolveSuccessfulMediaResultArtifact({ result, nodes: [] })).toBeNull()
})

it('recovers a persisted Artifact from a completed same-turn Tool snapshot', () => {
  expect(resolveSuccessfulToolSnapshotArtifacts({
    toolCallsByTurn: {
      'turn-1': [{
        toolCallId: 'tool-1',
        toolName: 'canvas_image_generate_to_canvas',
        status: 'succeeded',
        media: {
          kind: 'image',
          status: 'succeeded',
          pending: false,
          nodeId: 'node-1',
          taskId: 'task-1',
          url: succeeded.url,
        },
      }],
    },
    nodes: [{
      id: 'node-1',
      data: {
        kind: 'image',
        label: 'Cherry blossom watch',
        imageUrl: succeeded.url,
        assetId: 'asset-1',
        status: 'success',
      },
    }],
  })).toEqual([{
    title: 'Cherry blossom watch',
    url: succeeded.url,
    thumbnailUrl: succeeded.url,
    mediaType: 'image',
    assetId: 'asset-1',
    nodeId: 'node-1',
  }])
})

it('fails closed when the same-turn node has no stable asset identity', () => {
  expect(resolveSuccessfulMediaResultArtifact({
    result: succeeded,
    nodes: [{
      id: 'node-1',
      data: {
        kind: 'image',
        imageUrl: succeeded.url,
        status: 'success',
      },
    }],
  })).toBeNull()
})
