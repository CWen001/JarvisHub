// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { useRFStore } from '../../canvas/store'
import { MergedAskUserBubble, type ChatMessage } from './AiChatDialog'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(() => {
  useRFStore.setState({ nodes: [] })
})

function message(input: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role'>): ChatMessage {
  return {
    content: '',
    ts: '12:00',
    phase: 'final',
    ...input,
  }
}

describe('MergedAskUserBubble', () => {
  it('shows a successful persisted Artifact recovered from the continuation Tool snapshot', () => {
    useRFStore.setState({
      nodes: [{
        id: 'node-1',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          kind: 'image',
          label: 'GT runner watch',
          imageUrl: 'https://cdn.example/gt-runner.png',
          assetId: 'asset-1',
          status: 'success',
        },
      }],
    })

    const { container } = render(
      <MantineProvider>
        <MergedAskUserBubble
          projectArtifacts
          group={{
            kind: 'ask-user-merged',
            askMessage: message({
              id: 'ask-1',
              role: 'assistant',
              askUserPrompt: {
                toolCallId: 'ask-tool-1',
                question: '选择方向',
                options: ['A'],
                optionCards: [],
                urgency: 'confirmation',
                askedAt: null,
                awaitingReply: false,
              },
            }),
            userReply: message({ id: 'reply-1', role: 'user', content: 'A' }),
            continuation: message({
              id: 'continuation-1',
              role: 'assistant',
              content: '设计已生成。',
              toolCallSnapshot: {
                turnIds: ['turn-1'],
                record: {
                  toolCallsByTurn: {
                    'turn-1': [{
                      toolCallId: 'tool-1',
                      toolName: 'canvas_image_generate_to_canvas',
                      status: 'succeeded',
                      outputPreview: '',
                      errorMessage: '',
                      startedAtMs: 1,
                      finishedAtMs: 2,
                      durationMs: 1,
                      turnId: 'turn-1',
                      outputJson: {
                        ok: true,
                        data: {
                          nodeId: 'node-1',
                          status: 'success',
                          pending: false,
                          imageUrl: 'https://cdn.example/gt-runner.png',
                          assetId: 'asset-1',
                        },
                      },
                    }],
                  },
                },
              },
            }),
          }}
        />
      </MantineProvider>,
    )

    expect(container.querySelector('.native-artifact-card')).not.toBeNull()
  })
})
