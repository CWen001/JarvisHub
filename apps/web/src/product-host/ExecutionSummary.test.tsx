// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { LiveChatRunRecord } from '../ui/chat/liveChatRunStore'
import { resolvePersistedExecutionSummary } from '../ui/chat/executionSummaryModel'
import { ExecutionSummary } from './ExecutionSummary'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  })
})

const run: LiveChatRunRecord = {
  runId: 'run-1',
  status: 'running',
  requestText: '',
  displayText: '',
  projectId: 'project-1',
  projectName: '手表',
  flowId: 'flow-1',
  sessionKey: 'session-1',
  skillName: '',
  requestId: '',
  sessionId: 'session-1',
  userMessageId: 'user-1',
  assistantMessageId: 'assistant-1',
  startedAt: Date.now() - 2_000,
  updatedAt: Date.now(),
  finishedAt: null,
  errorMessage: '',
  doneReason: '',
  assistantPreview: '',
  assetCount: 0,
  todoItems: [],
  logs: [],
  agentTraceItems: [],
  toolCallsByTurn: {
    'turn-1': [{
      toolCallId: 'image-1',
      toolName: 'canvas_image_generate_to_canvas',
      status: 'running',
      outputPreview: '',
      errorMessage: '',
      startedAtMs: Date.now() - 1_000,
      finishedAtMs: null,
      durationMs: null,
      turnId: 'turn-1',
    }],
  },
  turnOrder: ['turn-1'],
  currentTurnId: 'turn-1',
  lastAppliedSeq: 1,
}

describe('Compact Execution Row', () => {
  it('advances authoritative product activity in place without a Workspace shortcut', () => {
    render(<MantineProvider><ExecutionSummary run={run} /></MantineProvider>)

    const toggle = screen.getByRole('button', { name: '展开执行摘要' })
    expect(within(toggle).getByText('生成视觉成果 · 正在处理')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /专业工作台/ })).toBeNull()

    fireEvent.click(toggle)
    expect(screen.getByText('生成视觉成果')).toBeTruthy()
  })

  it('projects persisted failures through the same product vocabulary without raw details', () => {
    const summary = resolvePersistedExecutionSummary({
      'turn-1': [{
        toolCallId: 'agent-secret-id',
        toolName: 'Agent',
        status: 'failed',
        input: { prompt: 'internal provider prompt' },
        outputPreview: 'raw trace payload',
        errorMessage: 'provider credential leaked',
        startedAtMs: 1,
        finishedAtMs: 2,
        durationMs: 1,
        turnId: 'turn-1',
      }],
    })

    expect(summary.phase).toBe('failed')
    expect(summary.headline).toBe('1 项设计任务需要处理')
    expect(summary.tasks[0]).toMatchObject({ title: '执行设计任务', subtitle: '需要处理' })
    expect(JSON.stringify(summary)).not.toContain('internal provider prompt')
    expect(JSON.stringify(summary)).not.toContain('raw trace payload')
    expect(JSON.stringify(summary)).not.toContain('provider credential leaked')
  })
})
