import { describe, expect, it } from 'vitest'
import { resolveProductEntry } from './productExperience'
import { fixtureExtension } from './testing/fixtureExtension'
import { installedVerticalExtension } from './installedExtension'

const projects = [
  { id: 'older', name: 'Older', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'recent', name: 'Recent', updatedAt: '2026-02-01T00:00:00.000Z' },
]

for (const extension of [installedVerticalExtension, fixtureExtension]) {
  describe(`${extension.id} Product Host entry`, () => {
    it('opens the native Chat surface and resumes the most recently used Project and Session', () => {
      const result = resolveProductEntry({
        extension,
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
        brand: extension.brand,
        projectId: 'recent',
        sessionId: 'session-new',
        needsNativeProjectCreation: false,
      })
    })

    it('uses the native project creation path when no Project exists', () => {
      expect(resolveProductEntry({
        extension,
        projects: [],
        sessionsByProject: {},
      })).toEqual({
        surface: 'chat',
        brand: extension.brand,
        projectId: null,
        sessionId: null,
        needsNativeProjectCreation: true,
      })
    })
  })
}
