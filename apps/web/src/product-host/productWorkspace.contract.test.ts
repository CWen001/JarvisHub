import { expect, it } from 'vitest'
import { transitionProductWorkspace } from './productWorkspace'

const context = {
  projectId: 'project-1',
  flowId: 'flow-1',
  sessionId: 'session-1',
  selectedNodeId: 'node-1',
}

it('switches to the complete native Canvas and back without changing native context', () => {
  const canvas = transitionProductWorkspace({ surface: 'chat', context }, 'open-canvas')
  expect(canvas).toEqual({ surface: 'canvas', context })

  expect(transitionProductWorkspace(canvas, 'return-to-chat')).toEqual({
    surface: 'chat',
    context,
  })
})
