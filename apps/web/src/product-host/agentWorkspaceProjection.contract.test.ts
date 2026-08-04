import { describe, expect, it } from 'vitest'
import {
  projectAgentWorkspace,
  resolveAgentWorkspaceIntent,
} from './agentWorkspaceProjection'

const facts = {
  projects: [
    { id: 'project-1', name: '手表设计', updatedAt: '2026-08-04T08:00:00Z' },
    { id: 'project-2', name: '历史项目', updatedAt: '2026-08-03T08:00:00Z' },
  ],
  currentProjectId: 'project-1',
  currentFlow: { id: 'flow-1', name: 'GT Runner', updatedAt: '2026-08-04T08:30:00Z' },
  sessionsByProject: {
    'project-1': [
      { id: 'session-old', title: '初始讨论', updatedAt: 10 },
      { id: 'session-current', title: '跑步腕表方向', updatedAt: 20 },
    ],
  },
  currentSessionId: 'session-current',
  assets: [
    {
      nodeId: 'node-1',
      title: 'GT Runner 概念图',
      kind: 'image' as const,
      url: 'https://cdn.example/runner.png',
      assetId: 'asset-1',
      status: 'success' as const,
      updatedAt: 30,
    },
    {
      nodeId: 'node-pending',
      title: '未完成图',
      kind: 'image' as const,
      url: 'https://cdn.example/pending.png',
      assetId: 'asset-pending',
      status: 'running' as const,
      updatedAt: 40,
    },
  ],
  run: {
    status: 'running' as const,
    label: '正在生成视觉成果',
  },
}

describe('Agent Workspace Projection', () => {
  it('projects authoritative Project context without inventing missing design facts', () => {
    expect(projectAgentWorkspace(facts)).toEqual({
      current: {
        projectId: 'project-1',
        projectName: '手表设计',
        flowId: 'flow-1',
        flowName: 'GT Runner',
        sessionId: 'session-current',
        sessionTitle: '跑步腕表方向',
      },
      projects: [
        {
          id: 'project-1',
          name: '手表设计',
          current: true,
          sessions: [
            { id: 'session-current', title: '跑步腕表方向', updatedAt: 20, current: true },
            { id: 'session-old', title: '初始讨论', updatedAt: 10, current: false },
          ],
        },
        { id: 'project-2', name: '历史项目', current: false, sessions: [] },
      ],
      assets: {
        count: 1,
        current: {
          nodeId: 'node-1',
          title: 'GT Runner 概念图',
          kind: 'image',
          url: 'https://cdn.example/runner.png',
          assetId: 'asset-1',
        },
      },
      run: { status: 'running', label: '正在生成视觉成果' },
    })
  })

  it('fails closed when no stable successful Artifact identity exists', () => {
    expect(projectAgentWorkspace({
      ...facts,
      assets: [{
        nodeId: 'node-2',
        title: '无身份图片',
        kind: 'image',
        url: 'https://cdn.example/no-identity.png',
        status: 'success',
        updatedAt: 50,
      }],
    }).assets).toEqual({ count: 0, current: null })
  })

  it('returns a recursively immutable Product View Model', () => {
    const view = projectAgentWorkspace(facts)
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.projects)).toBe(true)
    expect(Object.isFrozen(view.projects[0]?.sessions)).toBe(true)
    expect(Object.isFrozen(view.assets.current)).toBe(true)
  })

  it.each([
    [{ type: 'select-project', projectId: 'project-2' }, { type: 'project.select', projectId: 'project-2' }],
    [{ type: 'select-session', projectId: 'project-1', sessionId: 'session-old' }, {
      type: 'chat.navigate',
      command: { type: 'select-session', projectId: 'project-1', sessionId: 'session-old' },
    }],
    [{ type: 'new-session', projectId: 'project-1' }, {
      type: 'chat.navigate',
      command: { type: 'new-session', projectId: 'project-1' },
    }],
    [{ type: 'new-flow', projectId: 'project-1' }, { type: 'flow.create', projectId: 'project-1' }],
    [{ type: 'new-project' }, { type: 'project.create' }],
    [{ type: 'open-assets' }, { type: 'assets.open' }],
    [{ type: 'open-professional-workspace', nodeId: 'node-1' }, { type: 'workspace.open-professional', nodeId: 'node-1' }],
  ] as const)('maps Product View intent %o to one native command', (intent, command) => {
    expect(resolveAgentWorkspaceIntent(intent)).toEqual(command)
  })
})
