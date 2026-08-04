import { expect, it } from 'vitest'
import type { LiveChatRunRecord, LiveToolCallRecord } from './liveChatRunStore'
import { resolveExecutionSummary, resolvePersistedExecutionSummary } from './executionSummaryModel'

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

it('compresses direct Skill and media Tools into product-language tasks', () => {
  const summary = resolveExecutionSummary(run({
    status: 'succeeded',
    finishedAt: 3_000,
    toolCallsByTurn: {
      'turn-1': [
        agentCall({ toolCallId: 'skill-1', toolName: 'Skill', status: 'succeeded', input: { skill: 'watch-design-kernel' }, finishedAtMs: 1_500 }),
        agentCall({ toolCallId: 'image-1', toolName: 'canvas_image_generate_to_canvas', status: 'succeeded', input: {}, finishedAtMs: 3_000 }),
      ],
    },
  }), 4_000)

  expect(summary).toMatchObject({ taskCount: 2, completedTaskCount: 2, phase: 'succeeded' })
  expect(summary.tasks.map((task) => task.title)).toEqual(['设计能力', '生成视觉成果'])
  expect(JSON.stringify(summary)).not.toContain('watch-design-kernel')
})

it('projects failure without inventing an Artifact result', () => {
  const summary = resolveExecutionSummary(run({
    status: 'failed',
    finishedAt: 4_000,
    errorMessage: 'Provider failed',
    toolCallsByTurn: {
      'turn-1': [agentCall({
        status: 'failed',
        input: { description: 'internal prompt detail', prompt: 'secret provider instruction' },
        finishedAtMs: 4_000,
        errorMessage: 'Provider failed',
      })],
    },
  }), 9_000)

  expect(summary).toMatchObject({
    phase: 'failed',
    headline: '1 个子任务需要处理',
    failedTaskCount: 1,
    errorMessage: '本轮设计执行未完成，请重试或调整设计要求。',
  })
  expect(JSON.stringify(summary)).not.toContain('Provider failed')
  expect(JSON.stringify(summary)).not.toContain('internal prompt detail')
  expect(JSON.stringify(summary)).not.toContain('secret provider instruction')
})

it('preserves non-terminal persisted status instead of inventing completion', () => {
  const summary = resolvePersistedExecutionSummary({
    'turn-1': [agentCall({ status: 'running' })],
  })

  expect(summary).toMatchObject({
    phase: 'running',
    headline: '1 项设计任务执行中',
    completedTaskCount: 0,
    activeTaskLabel: '执行设计任务',
  })
  expect(summary.tasks[0]).toMatchObject({ status: 'running', subtitle: '正在处理' })
})

it('derives persisted parent failure from child facts and retains safe duration', () => {
  const summary = resolvePersistedExecutionSummary({
    'turn-1': [
      agentCall({ status: 'succeeded', finishedAtMs: 5_000, durationMs: 4_000 }),
      agentCall({
        toolCallId: 'child-1',
        toolName: 'canvas_image_generate_to_canvas',
        status: 'failed',
        parentToolCallId: 'agent-1',
        startedAtMs: 2_000,
        finishedAtMs: 4_000,
        durationMs: 2_000,
      }),
    ],
  })

  expect(summary).toMatchObject({
    phase: 'failed',
    failedTaskCount: 1,
    elapsedLabel: '4秒',
  })
  expect(summary.tasks[0]).toMatchObject({ status: 'failed', childToolCount: 1 })
})
