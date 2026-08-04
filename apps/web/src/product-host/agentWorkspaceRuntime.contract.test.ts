import { describe, expect, it } from 'vitest'
import {
  createAgentWorkspaceRuntime,
  createInMemoryAgentWorkspaceAdapter,
} from './agentWorkspaceRuntime'

const initialFacts = {
  projects: [{ id: 'project-1', name: '手表设计' }],
  currentProjectId: 'project-1',
  currentFlow: { id: 'flow-1', name: 'GT Runner' },
  sessionsByProject: {
    'project-1': [{ id: 'session-1', title: '跑步腕表', updatedAt: 10 }],
  },
  currentSessionId: 'session-1',
  assets: [],
  run: { status: 'idle' as const, label: '等待你的设计意图' },
}

describe('Agent Workspace Runtime', () => {
  it('publishes immutable snapshots and native command outcomes through one Interface', async () => {
    const adapter = createInMemoryAgentWorkspaceAdapter(initialFacts)
    const runtime = createAgentWorkspaceRuntime(adapter)
    const revisions: number[] = []
    const unsubscribe = runtime.subscribe(() => revisions.push(runtime.getSnapshot().revision))

    expect(runtime.getSnapshot().current).toMatchObject({
      projectId: 'project-1',
      flowId: 'flow-1',
      sessionId: 'session-1',
    })
    expect(Object.isFrozen(runtime.getSnapshot())).toBe(true)

    await expect(runtime.dispatch({ type: 'new-session', projectId: 'project-1' })).resolves.toEqual({
      accepted: true,
      command: {
        type: 'chat.navigate',
        command: { type: 'new-session', projectId: 'project-1' },
      },
    })
    expect(adapter.commands).toEqual([{
      type: 'chat.navigate',
      command: { type: 'new-session', projectId: 'project-1' },
    }])

    adapter.replaceFacts({
      ...initialFacts,
      currentSessionId: 'session-2',
      sessionsByProject: {
        'project-1': [
          ...initialFacts.sessionsByProject['project-1'],
          { id: 'session-2', title: '新方向', updatedAt: 20 },
        ],
      },
    })
    expect(runtime.getSnapshot().current?.sessionId).toBe('session-2')
    expect(revisions).toEqual([1])
    unsubscribe()
  })

  it('rejects a native command failure without mutating authoritative state', async () => {
    const adapter = createInMemoryAgentWorkspaceAdapter(initialFacts, {
      execute: async () => { throw new Error('native command failed') },
    })
    const runtime = createAgentWorkspaceRuntime(adapter)
    const before = runtime.getSnapshot()

    await expect(runtime.dispatch({ type: 'open-assets' })).resolves.toEqual({
      accepted: false,
      message: 'native command failed',
    })
    expect(runtime.getSnapshot()).toBe(before)
  })
})
