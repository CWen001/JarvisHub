// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentWorkspaceRuntime } from './agentWorkspaceRuntime'

const viewModel = {
  current: {
    projectId: 'project-1',
    projectName: '手表',
    flowId: 'flow-1',
    flowName: 'GT Runner',
    sessionId: 'session-1',
    sessionTitle: '跑步腕表方向',
  },
  projects: [{
    id: 'project-1',
    name: '手表',
    current: true,
    sessions: [{ id: 'session-1', title: '跑步腕表方向', updatedAt: 10, current: true }],
  }],
  assets: {
    state: 'ready' as const,
    errorMessage: '',
    count: 1,
    current: {
      nodeId: 'node-1',
      title: 'GT Runner 概念图',
      kind: 'image' as const,
      url: 'https://cdn.example/runner.png',
      assetId: 'asset-1',
      scope: 'canvas' as const,
    },
    items: [{
      nodeId: 'node-1',
      title: 'GT Runner 概念图',
      kind: 'image' as const,
      url: 'https://cdn.example/runner.png',
      assetId: 'asset-1',
      scope: 'canvas' as const,
    }],
  },
  run: { status: 'running' as const, label: '正在生成视觉成果', startedAt: Date.now() - 3_000 },
  timeline: [{
    id: 'message-user',
    role: 'user' as const,
    content: '设计一个儿童手表',
    timestamp: '01:17',
    phase: 'final' as const,
    result: 'result' as const,
    assets: [],
  }, {
    id: 'message-assistant',
    role: 'assistant' as const,
    content: '### 推荐方向\n\n采用 **收藏品质** 的材料策略。',
    timestamp: '01:18',
    phase: 'final' as const,
    result: 'result' as const,
    assets: [],
    decision: {
      toolCallId: 'ask-1',
      question: '### 请选择策略\n\n这是 **推荐组合**。',
      options: ['按此策略生成', '调整策略'],
      awaitingReply: true,
    },
  }],
  composer: {
    draft: '',
    pendingReferences: [{ kind: 'image' as const, url: 'https://cdn.example/reference.png', label: '材料参考图', assetId: 'ref-1' }],
    sending: true,
    ready: true,
    selectedSkill: null,
    availableSkills: [{ id: 'skill-1', key: 'watch-design', name: '手表设计' }],
  },
}

const runtimeSnapshot = { ...viewModel, revision: 0 }
const { runtimeDispatch } = vi.hoisted(() => ({
  runtimeDispatch: vi.fn().mockResolvedValue({ accepted: true, command: { type: 'assets.open' } }),
}))

const runtime = {
  getSnapshot: () => runtimeSnapshot,
  subscribe: () => () => {},
  dispatch: runtimeDispatch,
} as AgentWorkspaceRuntime

let narrowViewport = false

vi.mock('@mantine/hooks', () => ({
  useMediaQuery: () => narrowViewport,
}))

import { AgentWorkspace } from './AgentWorkspace'

beforeAll(() => {
  class ResizeObserverStub {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: ResizeObserverStub,
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(() => {
  narrowViewport = false
  runtimeDispatch.mockClear()
  cleanup()
})

describe('Agent Workspace Product View', () => {
  function ControlledAgentWorkspace(): JSX.Element {
    const [railCollapsed, setRailCollapsed] = useState(false)
    return (
      <AgentWorkspace
        brand={{ name: 'Watch Design Studio', mark: 'W', accentColor: '#29463f' }}
        runtime={runtime}
        railCollapsed={railCollapsed}
        onRailCollapsedChange={setRailCollapsed}
      />
    )
  }

  it('renders academy chrome and authoritative Project context around the timeline', async () => {
    render(
      <MantineProvider>
        <ControlledAgentWorkspace />
      </MantineProvider>,
    )

    expect(screen.getByRole('img', { name: '华中科技大学设计学院' })).toBeTruthy()
    expect(screen.getByText('Watch Design Studio')).toBeTruthy()
    expect(screen.queryByText('专业智能手表设计工作台')).toBeNull()
    expect(screen.getByText('设计方向')).toBeTruthy()
    expect(screen.getByText('GT Runner')).toBeTruthy()
    expect(screen.getByText('对话')).toBeTruthy()
    expect(screen.getAllByText('跑步腕表方向').length).toBeGreaterThan(0)
    expect(screen.getByText('GT Runner 概念图')).toBeTruthy()
    expect(screen.getAllByText('正在生成视觉成果').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: '请选择策略' })).toBeTruthy()
    expect(screen.queryByText('### 请选择策略')).toBeNull()
    expect(screen.getByRole('button', { name: '添加参考图' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '移除材料参考图' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '选择技能' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '中断' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '打开资产' }))
    fireEvent.click(screen.getByRole('button', { name: '进入专业工作台' }))
    expect(runtimeDispatch).toHaveBeenNthCalledWith(1, { type: 'open-assets' })
    expect(runtimeDispatch).toHaveBeenNthCalledWith(2, { type: 'open-professional-workspace' })

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '继续优化表带' } })
    expect(runtimeDispatch).toHaveBeenLastCalledWith({ type: 'chat.set-draft', text: '继续优化表带' })
    fireEvent.click(screen.getByRole('button', { name: '按此策略生成' }))
    expect(runtimeDispatch).toHaveBeenLastCalledWith({ type: 'decision.answer', option: '按此策略生成' })
    fireEvent.click(screen.getByRole('button', { name: '移除材料参考图' }))
    expect(runtimeDispatch).toHaveBeenLastCalledWith({ type: 'chat.remove-reference', url: 'https://cdn.example/reference.png' })
    fireEvent.change(screen.getByRole('combobox', { name: '选择技能' }), { target: { value: 'skill-1' } })
    expect(runtimeDispatch).toHaveBeenLastCalledWith({ type: 'chat.select-skill', skill: { id: 'skill-1', key: 'watch-design', name: '手表设计' } })

    fireEvent.click(screen.getByRole('button', { name: '预览GT Runner 概念图' }))
    expect(await screen.findByRole('dialog', { name: 'GT Runner 概念图' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '在专业工作台打开此节点' }))
    expect(runtimeDispatch).toHaveBeenLastCalledWith({ type: 'open-professional-workspace', nodeId: 'node-1' })
  })

  it('collapses the desktop Project Context Rail without hiding the permanent top bar', () => {
    render(
      <MantineProvider>
        <ControlledAgentWorkspace />
      </MantineProvider>,
    )

    const workspace = document.querySelector('.agent-workspace')
    fireEvent.click(screen.getByRole('button', { name: '收起项目栏' }))
    expect(workspace?.getAttribute('data-rail-collapsed')).toBe('true')
    expect(screen.getByRole('button', { name: '新对话' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '资产，1 项' })).toBeTruthy()
    expect(screen.getAllByRole('status', { name: '正在生成视觉成果' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Watch Design Studio')).toBeTruthy()
  })

  it('provides an operable close action inside the narrow Project Drawer', async () => {
    narrowViewport = true
    render(
      <MantineProvider>
        <ControlledAgentWorkspace />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '打开项目栏' }))
    const closeButton = await screen.findByRole('button', { name: '关闭项目栏' })
    fireEvent.click(closeButton)
    await waitFor(() => expect(screen.queryByRole('button', { name: '关闭项目栏' })).toBeNull())
  })
})
