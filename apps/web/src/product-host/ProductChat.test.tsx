// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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

afterEach(cleanup)

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

  it('shows the Semantic Work Item details while active, then condenses completion until reopened', async () => {
    const active: AgentWorkspaceRuntimeSnapshot = {
      ...base,
      run: {
        id: 'run-1',
        status: 'running',
        label: '设计任务正在进行',
        goal: '生成一组儿童手表设计提案',
        startedAt: Date.now() - 5_000,
        todoItems: [
          { content: '建立造型方向', status: 'completed' },
          { content: '生成视觉提案', status: 'in_progress' },
        ],
      },
    }
    const rendered = render(<MantineProvider><ProductChat view={active} onIntent={vi.fn()} /></MantineProvider>)

    expect(screen.getByText('生成一组儿童手表设计提案')).toBeTruthy()
    expect(screen.getByText('生成视觉提案')).toBeTruthy()
    expect(screen.getAllByText('进行中').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /设计任务正在进行/ }).getAttribute('aria-expanded')).toBe('true')

    rendered.rerender(<MantineProvider><ProductChat view={{
      ...active,
      revision: 2,
      run: { ...active.run, status: 'succeeded', label: '本轮设计已经完成' },
      composer: { ...active.composer, sending: false },
    }} onIntent={vi.fn()} /></MantineProvider>)

    const completed = screen.getByRole('button', { name: /本轮设计已经完成/ })
    await waitFor(() => expect(completed.getAttribute('aria-expanded')).toBe('false'))
    expect(screen.queryByText('生成视觉提案')).toBeNull()
    fireEvent.click(completed)
    expect(screen.getByText('生成视觉提案')).toBeTruthy()
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0)
  })

  it('preserves Chinese IME composition while an older authoritative draft snapshot arrives', () => {
    const onIntent = vi.fn()
    const rendered = render(<MantineProvider><ProductChat view={{
      ...base,
      composer: { ...base.composer, draft: '', sending: false },
    }} onIntent={onIntent} /></MantineProvider>)
    const input = screen.getByRole('textbox') as HTMLTextAreaElement

    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'ni' } })
    rendered.rerender(<MantineProvider><ProductChat view={{
      ...base,
      revision: 2,
      composer: { ...base.composer, draft: '', sending: false },
    }} onIntent={onIntent} /></MantineProvider>)

    expect(input.value).toBe('ni')
    fireEvent.change(input, { target: { value: '你' } })
    fireEvent.compositionEnd(input)
    expect(onIntent).toHaveBeenLastCalledWith({ type: 'chat.set-draft', text: '你' })
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
