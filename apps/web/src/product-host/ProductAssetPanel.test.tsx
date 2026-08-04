// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useRFStore } from '../canvas/store'
import { useUIStore } from '../ui/uiStore'
import { ProductAssetPanel } from './ProductAssetPanel'
import { createAgentWorkspaceRuntime, createInMemoryAgentWorkspaceAdapter } from './agentWorkspaceRuntime'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class { observe() {} unobserve() {} disconnect() {} },
  })
})

afterEach(() => {
  useUIStore.getState().setActivePanel(null)
  useRFStore.setState({ nodes: [] })
})

describe('Product Asset Panel', () => {
  it('renders authoritative Canvas assets in Product-owned presentation', async () => {
    const adapter = createInMemoryAgentWorkspaceAdapter({
      projects: [{ id: 'project-1', name: '手表' }],
      currentProjectId: 'project-1',
      currentFlow: { id: 'flow-1', name: '方向' },
      sessionsByProject: { 'project-1': [] },
      assets: [{
        nodeId: 'node-1',
        title: 'GT Runner concept',
        kind: 'image',
        url: 'https://cdn.example/runner.png',
        assetId: 'asset-1',
        status: 'success',
        updatedAt: 1,
      }],
    })
    const runtime = createAgentWorkspaceRuntime(adapter)
    useUIStore.getState().setActivePanel('gallery')

    render(
      <MantineProvider>
        <ProductAssetPanel runtime={runtime} />
      </MantineProvider>,
    )

    expect(screen.getByText('权威项目资产与当前画布成果')).toBeTruthy()
    expect(screen.getByText('GT Runner concept')).toBeTruthy()
    expect(document.querySelector('.product-asset-panel')).not.toBeNull()
    expect(document.querySelector('.asset-center-panel-root')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '在专业工作台打开' }))
    fireEvent.click(screen.getByRole('button', { name: '添加到专业工作台' }))
    fireEvent.click(screen.getByRole('button', { name: '作为对话参考' }))
    fireEvent.click(screen.getByRole('button', { name: '预览GT Runner concept' }))
    await waitFor(() => expect(adapter.commands).toContainEqual({
      type: 'workspace.open-professional',
      nodeId: 'node-1',
    }))
    expect(adapter.commands).toContainEqual(expect.objectContaining({ type: 'asset.add-to-canvas' }))
    expect(adapter.commands).toContainEqual(expect.objectContaining({ type: 'asset.reference' }))
    await waitFor(() => expect(document.querySelector('.product-asset-preview img')).not.toBeNull())
  })

  it.each([
    ['loading', '正在读取资产', 'status'],
    ['error', '无法读取项目资产，请稍后重试。', 'alert'],
  ] as const)('renders the authoritative %s state', (assetsState, message, role) => {
    const runtime = createAgentWorkspaceRuntime(createInMemoryAgentWorkspaceAdapter({
      projects: [{ id: 'project-1', name: '手表' }],
      currentProjectId: 'project-1',
      currentFlow: { id: 'flow-1', name: '方向' },
      sessionsByProject: { 'project-1': [] },
      assets: [],
      assetsState,
      assetsErrorMessage: assetsState === 'error' ? message : '',
    }))
    useUIStore.getState().setActivePanel('gallery')

    render(<MantineProvider><ProductAssetPanel runtime={runtime} /></MantineProvider>)

    expect(screen.getByRole(role).textContent).toContain(message)
  })
})
