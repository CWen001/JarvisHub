// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./agentWorkspaceAdapter', () => ({
  useAuthoritativeAgentWorkspaceRuntime: () => ({
    getSnapshot: () => ({}),
    subscribe: () => () => {},
    dispatch: vi.fn(),
  }),
}))
vi.mock('./AgentWorkspace', () => ({
  AgentWorkspace: () => <div>Product timeline</div>,
}))
vi.mock('../ui/chat/AiChatDialog', () => ({
  default: () => <div data-testid="native-chat-authority" />,
}))

import { ProductWorkspaceHost } from './ProductWorkspaceHost'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  })
})

describe('Product Workspace Host', () => {
  it('owns the public Product entry routes', () => {
    const { rerender } = render(<ProductWorkspaceHost surface="entry" pathname="/" />)
    expect(screen.getByRole('heading', { level: 1, name: '专业设计，由此生成' })).toBeTruthy()

    rerender(<ProductWorkspaceHost surface="entry" pathname="/cases/india-phone-design" />)
    expect(screen.getByRole('heading', { level: 1, name: '印度市场手机外观设计迭代' })).toBeTruthy()
  })

  it('owns Agent Workspace composition', () => {
    render(<ProductWorkspaceHost
      surface="workspace"
      brand={{ name: 'Design Studio', mark: 'D', accentColor: '#000000' }}
      runtimeInput={{ projects: [], currentProject: null, currentFlow: null }}
      commands={{
        onSelectProject: vi.fn(),
        onCreateProject: vi.fn(),
        onCreateFlow: vi.fn(),
        onOpenAssets: vi.fn(),
        onOpenProfessionalWorkspace: vi.fn(),
      }}
    />)

    expect(screen.getByText('Product timeline')).toBeTruthy()
    expect(screen.getByTestId('native-chat-authority')).toBeTruthy()
  })
})
