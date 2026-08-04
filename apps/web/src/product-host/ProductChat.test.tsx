// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentWorkspaceRuntimeSnapshot } from './agentWorkspaceRuntime'
import { ProductChat } from './ProductChat'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
})

const base: AgentWorkspaceRuntimeSnapshot = {
  revision: 1,
  current: { projectId: 'p1', projectName: '项目', flowId: 'f1', flowName: '方向', sessionId: 's1', sessionTitle: '对话' },
  projects: [],
  assets: { state: 'ready', errorMessage: '', count: 0, current: null, items: [] },
  run: { status: 'running', label: '图片已生成，正在保存到项目', startedAt: Date.now() - 5_000 },
  timeline: [
    { id: 'u1', role: 'user', content: '**保持原样**', timestamp: '01:00', phase: 'final', result: 'result', assets: [] },
    { id: 'a1', role: 'assistant', content: '', timestamp: '01:00', phase: 'thinking', result: 'progress', assets: [] },
  ],
  composer: { draft: '', pendingReferences: [], sending: true, ready: true, selectedSkill: null, availableSkills: [] },
}

describe('Product Chat Interaction Continuity', () => {
  it('shows the provider-complete saving phase and keeps user Markdown as plain text', () => {
    render(<MantineProvider><ProductChat view={base} onIntent={vi.fn()} /></MantineProvider>)
    expect(screen.getByRole('status', { name: '图片已生成，正在保存到项目' })).toBeTruthy()
    expect(screen.getByText('**保持原样**')).toBeTruthy()
    expect(screen.queryByText('保持原样')).toBeNull()
  })

  it('delivers a stable Artifact while truthfully labelling partial completion', () => {
    const onIntent = vi.fn()
    const partial: AgentWorkspaceRuntimeSnapshot = {
      ...base,
      revision: 2,
      run: { status: 'partial', label: '结果已生成，后续步骤部分完成' },
      timeline: [{
        id: 'a2', role: 'assistant', content: '图片已经生成。', timestamp: '01:01', phase: 'final', result: 'partial',
        assets: [{ title: '概念图', kind: 'image', url: 'https://cdn.example/result.png', nodeId: 'node-1', assetId: 'asset-1' }],
      }],
      composer: { ...base.composer, sending: false },
    }
    render(<MantineProvider><ProductChat view={partial} onIntent={onIntent} /></MantineProvider>)
    expect(screen.getByRole('img', { name: '概念图' })).toBeTruthy()
    expect(screen.getByText('结果已生成；部分后续步骤未完成。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '作为参考' }))
    expect(onIntent).toHaveBeenCalledWith(expect.objectContaining({ type: 'asset.reference' }))
  })
})
