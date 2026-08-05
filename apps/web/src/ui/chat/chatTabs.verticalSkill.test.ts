import { describe, expect, it } from 'vitest'
import {
  bindAiChatTabSession,
  readAiChatTabsState,
  writeAiChatTabsState,
} from './chatTabs'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

describe('Session vertical Skill persistence', () => {
  it('restores one selected vertical in Session scope without binding the Project', () => {
    const storage = memoryStorage()
    const projectId = 'project-1'
    const initial = readAiChatTabsState(projectId, {
      storage,
      createBaseKey: () => 'conversation-1',
      createTabId: () => 'tab-1',
      now: () => 1,
    })
    const selected = bindAiChatTabSession(initial, 'tab-1', {
      storage,
      sessionKey: 'session-1',
      scope: {
        projectId,
        flowId: 'flow-1',
        lane: 'general',
        skill: {
          id: 'tablet',
          key: 'tablet-design-kernel',
          name: 'Tablet Design Kernel',
        },
      },
    })
    writeAiChatTabsState(selected, projectId, { storage })

    expect(readAiChatTabsState(projectId, { storage }).tabs[0]?.sessionScope?.skill).toEqual({
      id: 'tablet',
      key: 'tablet-design-kernel',
      name: 'Tablet Design Kernel',
    })
    expect(readAiChatTabsState('project-2', {
      storage,
      createBaseKey: () => 'conversation-2',
      createTabId: () => 'tab-2',
    }).tabs[0]?.sessionScope).toBeUndefined()
  })
})
