// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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
    count: 1,
    current: {
      nodeId: 'node-1',
      title: 'GT Runner 概念图',
      kind: 'image' as const,
      url: 'https://cdn.example/runner.png',
      assetId: 'asset-1',
    },
    items: [{
      nodeId: 'node-1',
      title: 'GT Runner 概念图',
      kind: 'image' as const,
      url: 'https://cdn.example/runner.png',
      assetId: 'asset-1',
    }],
  },
  run: { status: 'running' as const, label: '正在生成视觉成果' },
}

vi.mock('../ui/chat/AiChatDialog', () => ({
  ProductChatTimeline: () => <div data-testid="product-timeline">Product timeline</div>,
}))

const runtimeSnapshot = { ...viewModel, revision: 0 }

vi.mock('./agentWorkspaceAdapter', () => ({
  useAuthoritativeAgentWorkspaceRuntime: () => ({
    getSnapshot: () => runtimeSnapshot,
    subscribe: () => () => {},
    dispatch: vi.fn().mockResolvedValue({ accepted: true, command: { type: 'assets.open' } }),
  }),
}))

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
  cleanup()
})

describe('Agent Workspace Product View', () => {
  it('renders academy chrome and authoritative Project context around the timeline', () => {
    const onOpenAssets = vi.fn()
    const onOpenProfessionalWorkspace = vi.fn()
    render(
      <MantineProvider>
        <AgentWorkspace
          brand={{ name: 'Watch Design Studio', mark: 'W', accentColor: '#29463f' }}
          projects={[]}
          currentProject={{ id: 'project-1', name: '手表' }}
          currentFlow={{ id: 'flow-1', name: 'GT Runner' }}
          onSelectProject={vi.fn()}
          onCreateProject={vi.fn()}
          onCreateFlow={vi.fn()}
          onOpenAssets={onOpenAssets}
          onOpenProfessionalWorkspace={onOpenProfessionalWorkspace}
        />
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
    expect(screen.getByText('正在生成视觉成果')).toBeTruthy()
    expect(screen.getByTestId('product-timeline')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '打开资产' }))
    fireEvent.click(screen.getByRole('button', { name: '进入专业工作台' }))
    expect(onOpenAssets).toHaveBeenCalledOnce()
    expect(onOpenProfessionalWorkspace).toHaveBeenCalledWith('node-1')
  })

  it('collapses the desktop Project Context Rail without hiding the permanent top bar', () => {
    render(
      <MantineProvider>
        <AgentWorkspace
          brand={{ name: 'Watch Design Studio', mark: 'W', accentColor: '#29463f' }}
          projects={[]}
          currentProject={{ id: 'project-1', name: '手表' }}
          currentFlow={{ id: 'flow-1', name: 'GT Runner' }}
          onSelectProject={vi.fn()}
          onCreateProject={vi.fn()}
          onCreateFlow={vi.fn()}
          onOpenAssets={vi.fn()}
          onOpenProfessionalWorkspace={vi.fn()}
        />
      </MantineProvider>,
    )

    const workspace = document.querySelector('.agent-workspace')
    fireEvent.click(screen.getByRole('button', { name: '收起项目栏' }))
    expect(workspace?.getAttribute('data-rail-collapsed')).toBe('true')
    expect(screen.getByRole('button', { name: '新对话' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '资产，1 项' })).toBeTruthy()
    expect(screen.getByRole('status', { name: '正在生成视觉成果' })).toBeTruthy()
    expect(screen.getByText('Watch Design Studio')).toBeTruthy()
  })

  it('provides an operable close action inside the narrow Project Drawer', async () => {
    narrowViewport = true
    render(
      <MantineProvider>
        <AgentWorkspace
          brand={{ name: 'Watch Design Studio', mark: 'W', accentColor: '#29463f' }}
          projects={[]}
          currentProject={{ id: 'project-1', name: '手表' }}
          currentFlow={{ id: 'flow-1', name: 'GT Runner' }}
          onSelectProject={vi.fn()}
          onCreateProject={vi.fn()}
          onCreateFlow={vi.fn()}
          onOpenAssets={vi.fn()}
          onOpenProfessionalWorkspace={vi.fn()}
        />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '打开项目栏' }))
    const closeButton = await screen.findByRole('button', { name: '关闭项目栏' })
    fireEvent.click(closeButton)
    await waitFor(() => expect(screen.queryByRole('button', { name: '关闭项目栏' })).toBeNull())
  })
})
