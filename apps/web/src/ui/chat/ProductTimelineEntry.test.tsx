// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ProductTimelineEntry, type ChatMessage } from './AiChatDialog'

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

function message(input: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '设计成果已完成。',
    ts: '12:00',
    phase: 'final',
    ...input,
  }
}

describe('Product Timeline entry', () => {
  it('renders conversation content without raw Skill or Tool trace payloads', () => {
    render(
      <MantineProvider>
        <ProductTimelineEntry
          group={{
            kind: 'single',
            message: message({
              agentTraceSnapshot: {
                items: [{
                  id: 'trace-1',
                  kind: 'response',
                  turnId: 'turn-1',
                  text: '<skill-loaded>raw private skill document</skill-loaded>',
                  at: 1,
                }],
              },
            }),
          }}
        />
      </MantineProvider>,
    )

    expect(screen.getByText('设计成果已完成。')).toBeTruthy()
    expect(screen.queryByText(/raw private skill document/)).toBeNull()
    expect(document.querySelector('.product-timeline-entry')).not.toBeNull()
    expect(document.querySelector('.tc-ai-chat-bubble')).toBeNull()
  })

  it('renders answered Decisions as compact Product history', () => {
    render(
      <MantineProvider>
        <ProductTimelineEntry
          group={{
            kind: 'ask-user-merged',
            askMessage: message({
              id: 'ask-1',
              askUserPrompt: {
                toolCallId: 'ask-tool-1',
                question: '选择主要控制方向',
                options: ['实体按键'],
                optionCards: [],
                urgency: 'confirmation',
                askedAt: null,
                awaitingReply: false,
              },
            }),
            userReply: message({ id: 'reply-1', role: 'user', content: '实体按键' }),
            continuation: message({ id: 'continue-1', content: '已按该方向继续。' }),
          }}
        />
      </MantineProvider>,
    )

    expect(screen.getByText('设计决策')).toBeTruthy()
    expect(screen.getByText('选择主要控制方向')).toBeTruthy()
    expect(screen.getByText('实体按键')).toBeTruthy()
    expect(screen.getByText('已按该方向继续。')).toBeTruthy()
  })

  it('renders persisted execution facts without a Professional Workspace shortcut', () => {
    render(
      <MantineProvider>
        <ProductTimelineEntry
          group={{
            kind: 'single',
            message: message({
              toolCallSnapshot: {
                turnIds: ['turn-1'],
                record: {
                  toolCallsByTurn: {
                    'turn-1': [{
                      toolCallId: 'image-1',
                      toolName: 'canvas_image_generate_to_canvas',
                      status: 'succeeded',
                      outputPreview: '',
                      errorMessage: '',
                      startedAtMs: 1,
                      finishedAtMs: 2,
                      durationMs: 1,
                      turnId: 'turn-1',
                    }],
                  },
                },
              },
            }),
          }}
        />
      </MantineProvider>,
    )

    expect(screen.getByText('已完成 1 项设计任务')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /专业工作台/ })).toBeNull()
  })
})
