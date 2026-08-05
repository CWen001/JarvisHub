import { describe, expect, it } from 'vitest'
import { reconcileArtifactDelivery } from './artifactDeliveryReconciliation'

const providerAsset = {
  title: '生成图片',
  kind: 'image' as const,
  url: 'https://provider.example/result.png',
  nodeId: 'node-1',
  assetId: 'asset-1',
}

const hostedAsset = {
  nodeId: 'node-1',
  title: '项目图片',
  kind: 'image' as const,
  url: 'https://jarvis.example/assets/asset-1',
  assetId: 'asset-1',
  status: 'success' as const,
  updatedAt: 20,
}

const timeline = [{
  id: 'assistant-1',
  role: 'assistant' as const,
  content: '图片已生成',
  timestamp: '10:00',
  phase: 'final' as const,
  result: 'result' as const,
  assets: [providerAsset],
}]

const run = {
  status: 'succeeded' as const,
  assistantMessageId: 'assistant-1',
  startedAt: 10,
  updatedAt: 20,
  todoItems: [],
  media: [{ nodeId: 'node-1', status: 'succeeded' as const, pending: false }],
}

describe('Agent Workspace Artifact delivery reconciliation', () => {
  it('delivers the stable hosted Artifact once and prefers it over an earlier provider URL', () => {
    const result = reconcileArtifactDelivery({ timeline, assets: [hostedAsset], run })

    expect(result.timeline[0]?.assets).toEqual([{
      title: '项目图片',
      kind: 'image',
      url: 'https://jarvis.example/assets/asset-1',
      nodeId: 'node-1',
      assetId: 'asset-1',
    }])
    expect(result.run).toMatchObject({ status: 'succeeded', label: '本轮设计已经完成' })
  })

  it('keeps authoritative execution active while provider success awaits a stable Jarvis asset', () => {
    const result = reconcileArtifactDelivery({
      timeline: [{ ...timeline[0]!, assets: [] }],
      assets: [],
      run: { ...run, status: 'running' },
    })

    expect(result.run).toMatchObject({ status: 'running', label: '图片已生成，正在保存到项目' })
    expect(result.timeline[0]?.assets).toEqual([])
  })

  it('preserves a usable Artifact and reports partial completion after a downstream failure', () => {
    const result = reconcileArtifactDelivery({
      timeline: [{ ...timeline[0]!, assets: [] }],
      assets: [hostedAsset],
      run: { ...run, status: 'failed' },
    })

    expect(result.timeline[0]?.assets?.[0]?.url).toBe('https://jarvis.example/assets/asset-1')
    expect(result.run).toMatchObject({ status: 'partial', label: '结果已生成，后续步骤部分完成' })
  })

  it('reports authoritative failure without manufacturing an Artifact', () => {
    const result = reconcileArtifactDelivery({
      timeline: [{ ...timeline[0]!, assets: [] }],
      assets: [],
      run: { ...run, status: 'failed', media: [{ nodeId: 'node-1', status: 'failed', pending: false }] },
    })

    expect(result.timeline[0]?.assets).toEqual([])
    expect(result.run).toMatchObject({ status: 'failed', label: '本轮设计需要处理' })
  })
})
