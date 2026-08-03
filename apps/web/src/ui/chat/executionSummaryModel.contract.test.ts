import { expect, it } from 'vitest'
import type { LiveChatRunRecord, LiveToolCallRecord } from './liveChatRunStore'
import { resolveExecutionSummary } from './executionSummaryModel'

function agentCall(overrides: Partial<LiveToolCallRecord> = {}): LiveToolCallRecord {
  return {
    toolCallId: 'agent-1',
    toolName: 'Agent',
    status: 'running',
    input: { subagent_type: 'media', description: 'Generate concept' },
    outputPreview: '',
    errorMessage: '',
    startedAtMs: 1_000,
    finishedAtMs: null,
    durationMs: null,
    turnId: 'turn-1',
    ...overrides,
  }
}

function run(overrides: Partial<LiveChatRunRecord> = {}): LiveChatRunRecord {
  return {
    runId: 'run-1',
    status: 'running',
    requestText: '',
    displayText: '',
    projectId: 'project-1',
    projectName: 'Project',
    flowId: 'flow-1',
    sessionKey: 'session-1',
    skillName: '',
    requestId: '',
    sessionId: '',
    userMessageId: 'user-1',
    assistantMessageId: 'assistant-1',
    startedAt: 1_000,
    updatedAt: 1_000,
    finishedAt: null,
    errorMessage: '',
    doneReason: '',
    assistantPreview: '',
    assetCount: 0,
    todoItems: [],
    logs: [],
    agentTraceItems: [],
    toolCallsByTurn: { 'turn-1': [agentCall()] },
    turnOrder: ['turn-1'],
    currentTurnId: 'turn-1',
    lastAppliedSeq: 0,
    ...overrides,
  }
}

it('reduces an active Jarvis run to one compact execution summary', () => {
  expect(resolveExecutionSummary(run(), 66_000)).toMatchObject({
    phase: 'running',
    headline: '1 个子任务执行中',
    taskCount: 1,
    completedTaskCount: 0,
    elapsedLabel: '1分05秒',
  })
})

it('uses the terminal Jarvis result and duration after completion', () => {
  expect(resolveExecutionSummary(run({
    status: 'succeeded',
    finishedAt: 5_000,
    toolCallsByTurn: {
      'turn-1': [agentCall({ status: 'succeeded', finishedAtMs: 5_000, durationMs: 4_000 })],
    },
  }), 99_000)).toMatchObject({
    phase: 'succeeded',
    headline: '子任务已完成',
    taskCount: 1,
    completedTaskCount: 1,
    elapsedLabel: '4秒',
  })
})

it('projects failure without inventing an Artifact result', () => {
  expect(resolveExecutionSummary(run({
    status: 'failed',
    finishedAt: 4_000,
    errorMessage: 'Provider failed',
    toolCallsByTurn: {
      'turn-1': [agentCall({ status: 'failed', finishedAtMs: 4_000, errorMessage: 'Provider failed' })],
    },
  }), 9_000)).toMatchObject({
    phase: 'failed',
    headline: '1 个子任务需要处理',
    failedTaskCount: 1,
    errorMessage: 'Provider failed',
  })
})
