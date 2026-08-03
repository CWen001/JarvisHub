// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../ui/chat/AiChatDialog', () => ({
  default: () => <div data-testid="agent-chat" />,
}))

vi.mock('./ProductHistoryNavigation', () => ({
  ProductHistoryNavigation: () => <div>Project navigation</div>,
}))

import { AgentWorkspace } from './AgentWorkspace'

beforeAll(() => {
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

describe('AgentWorkspace project history', () => {
  it('opens its portal above the Agent Chat surface', () => {
    render(
      <MantineProvider>
        <AgentWorkspace
          brand={{ name: 'Watch Design Studio', mark: 'W', accentColor: '#3157d5' }}
          projects={[]}
          currentProject={{ id: 'project-1', name: '手表' }}
          onSelectProject={vi.fn()}
          onOpenAssets={vi.fn()}
          onOpenProfessionalWorkspace={vi.fn()}
        />
      </MantineProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Open project and conversation history' })
    fireEvent.click(trigger)

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const drawerRoot = document.querySelector<HTMLElement>('.agent-workspace-history-drawer')
    expect(drawerRoot?.style.getPropertyValue('--mb-z-index')).toBe('800')
  })
})
