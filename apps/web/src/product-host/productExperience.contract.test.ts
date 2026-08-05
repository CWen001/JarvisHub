import { describe, expect, it } from 'vitest'
import { resolveProductEntry } from './productExperience'
import { sharedProductBrand } from './productIdentity'

const projects = [
  { id: 'older', name: 'Older', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'recent', name: 'Recent', updatedAt: '2026-02-01T00:00:00.000Z' },
]

describe('shared Product Host entry', () => {
  it('opens the native Chat surface and resumes the most recently used Project and Session', () => {
    const result = resolveProductEntry({
      brand: sharedProductBrand,
      projects,
      sessionsByProject: {
        recent: [
          { id: 'session-old', updatedAt: 10 },
          { id: 'session-new', updatedAt: 20 },
        ],
      },
    })

    expect(result).toEqual({
      surface: 'chat',
      brand: sharedProductBrand,
      projectId: 'recent',
      sessionId: 'session-new',
      needsNativeProjectCreation: false,
    })
  })

  it('uses the native project creation path when no Project exists', () => {
    expect(resolveProductEntry({
      brand: sharedProductBrand,
      projects: [],
      sessionsByProject: {},
    })).toEqual({
      surface: 'chat',
      brand: sharedProductBrand,
      projectId: null,
      sessionId: null,
      needsNativeProjectCreation: true,
    })
  })
})
