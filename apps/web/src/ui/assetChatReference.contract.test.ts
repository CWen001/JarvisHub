import { expect, it } from 'vitest'
import { buildAssetChatReference } from './assetChatReference'

it('preserves native asset identity when attaching an Asset Center item to Chat', () => {
  expect(buildAssetChatReference({
    kind: 'image',
    title: 'Reference watch',
    url: 'https://cdn.example/reference.png',
    assetId: 'asset-1',
    assetRefId: 'reference_watch',
    nodeId: 'node-1',
  })).toEqual({
    title: 'Reference watch',
    url: 'https://cdn.example/reference.png',
    mediaType: 'image',
    assetId: 'asset-1',
    assetRefId: 'reference_watch',
    nodeId: 'node-1',
  })
})

it('does not fabricate a Chat reference for non-media assets', () => {
  expect(buildAssetChatReference({ kind: 'text', title: 'Brief' })).toBeNull()
})
