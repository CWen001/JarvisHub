// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
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
    const onClose = vi.fn()

    render(
      <MantineProvider>
        <ProductAssetPanel runtime={runtime} opened onClose={onClose} />
      </MantineProvider>,
    )

    expect(screen.getByText('权威项目资产与当前画布成果')).toBeTruthy()
    expect(screen.getByText('GT Runner concept')).toBeTruthy()
    expect(document.querySelector('.product-asset-panel')).not.toBeNull()
    expect(document.querySelector('.asset-center-panel-root')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '关闭资产' }))
    expect(onClose).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: '在专业工作台打开' }))
    fireEvent.click(screen.getByRole('button', { name: '继续修改' }))
    fireEvent.click(screen.getByRole('button', { name: '作为对话参考' }))
    fireEvent.click(screen.getByRole('button', { name: '预览GT Runner concept' }))
    await waitFor(() => expect(adapter.commands).toContainEqual({
      type: 'workspace.open-professional',
      nodeId: 'node-1',
    }))
    expect(adapter.commands).toContainEqual(expect.objectContaining({ type: 'asset.modify' }))
    expect(adapter.commands).toContainEqual(expect.objectContaining({ type: 'asset.reference' }))
    await waitFor(() => expect(document.querySelector('.artifact-preview img')).not.toBeNull())
    const previewDialog = screen.getByRole('dialog', { name: 'GT Runner concept' })
    expect(within(previewDialog).getByRole('button', { name: '继续修改' })).toBeTruthy()
    expect(within(previewDialog).getByRole('button', { name: '在专业工作台打开此节点' })).toBeTruthy()
    expect(within(previewDialog).getByRole('link', { name: '下载' })).toBeTruthy()
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
    render(<MantineProvider><ProductAssetPanel runtime={runtime} opened onClose={() => {}} /></MantineProvider>)

    expect(screen.getByRole(role).textContent).toContain(message)
  })

  it('does not offer node navigation for an asset without a stable Canvas node', async () => {
    const adapter = createInMemoryAgentWorkspaceAdapter({
      projects: [{ id: 'project-1', name: '手表' }],
      currentProjectId: 'project-1',
      currentFlow: { id: 'flow-1', name: '方向' },
      sessionsByProject: { 'project-1': [] },
      assets: [{
        nodeId: '',
        title: 'Library reference',
        kind: 'image',
        url: 'https://cdn.example/library.png',
        assetId: 'asset-library',
        status: 'success',
        updatedAt: 1,
        scope: 'all',
      }],
    })
    render(<MantineProvider><ProductAssetPanel runtime={createAgentWorkspaceRuntime(adapter)} opened onClose={() => {}} /></MantineProvider>)

    const dialogs = screen.getAllByRole('dialog')
    const drawer = dialogs[dialogs.length - 1]!
    fireEvent.click(within(drawer).getByRole('radio', { name: '全部资产' }))
    expect(await within(drawer).findByText('Library reference')).toBeTruthy()
    expect(within(drawer).queryByRole('button', { name: '在专业工作台打开' })).toBeNull()

    fireEvent.click(within(drawer).getByRole('button', { name: '预览Library reference' }))
    const previewDialog = await screen.findByRole('dialog', { name: 'Library reference' })
    expect(within(previewDialog).queryByRole('button', { name: '在专业工作台打开此节点' })).toBeNull()
    expect(within(previewDialog).getByRole('button', { name: '添加到专业工作台' })).toBeTruthy()
    expect(within(previewDialog).getByRole('button', { name: '作为参考' })).toBeTruthy()
    expect(within(previewDialog).getByRole('link', { name: '下载' })).toBeTruthy()
  })
})
