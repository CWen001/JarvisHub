import { describe, expect, it } from 'vitest'
import { buildProjectSessionNavigation } from './productNavigationModel'

it('keeps native Chat Sessions grouped under their owning Projects', () => {
  const result = buildProjectSessionNavigation({
    projects: [
      { id: 'p1', name: 'One', updatedAt: '2026-02-01T00:00:00Z' },
      { id: 'p2', name: 'Two', updatedAt: '2026-01-01T00:00:00Z' },
    ],
    sessionsByProject: {
      p1: [
        { id: 's1', title: 'First', updatedAt: 10 },
        { id: 's2', title: 'Latest', updatedAt: 20 },
      ],
      p2: [{ id: 's3', title: 'Other project', updatedAt: 30 }],
    },
  })

  expect(result).toEqual([
    {
      id: 'p1',
      name: 'One',
      sessions: [
        { id: 's2', title: 'Latest', updatedAt: 20 },
        { id: 's1', title: 'First', updatedAt: 10 },
      ],
      latestSessionId: 's2',
    },
    {
      id: 'p2',
      name: 'Two',
      sessions: [{ id: 's3', title: 'Other project', updatedAt: 30 }],
      latestSessionId: 's3',
    },
  ])
})
