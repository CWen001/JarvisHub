// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { TodoProgressCard } from './TodoProgressCard'

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

const completedItems = [
  { status: 'completed' as const, content: 'Generate and persist the artifact' },
  { status: 'completed' as const, content: 'Verify the canvas node' },
  { status: 'completed' as const, content: 'Return the result' },
]

describe('TodoProgressCard', () => {
  it('collapses a running todo trace when the Agent Workspace run becomes inactive', async () => {
    const { rerender } = render(
      <MantineProvider>
        <TodoProgressCard
          items={completedItems}
          active
          compact
          defaultOpen
          title="主任务 Todo"
        />
      </MantineProvider>,
    )

    const toggle = screen.getByRole('button', { name: '折叠主任务 Todo' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    rerender(
      <MantineProvider>
        <TodoProgressCard
          items={completedItems}
          active={false}
          compact
          defaultOpen
          title="主任务 Todo"
        />
      </MantineProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开主任务 Todo' }).getAttribute('aria-expanded')).toBe('false')
    })
  })

  it('preserves native Professional Workspace expansion behavior', async () => {
    const { rerender } = render(
      <MantineProvider>
        <TodoProgressCard items={completedItems} active defaultOpen title="主任务 Todo" />
      </MantineProvider>,
    )

    rerender(
      <MantineProvider>
        <TodoProgressCard items={completedItems} active={false} defaultOpen title="主任务 Todo" />
      </MantineProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '折叠主任务 Todo' }).getAttribute('aria-expanded')).toBe('true')
    })
  })
})
