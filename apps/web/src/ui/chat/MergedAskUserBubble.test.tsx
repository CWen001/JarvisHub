// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { useRFStore } from '../../canvas/store'
import { MergedAskUserBubble, type ChatMessage } from './AiChatDialog'
import { AskUserPendingCard } from './AskUserPendingCard'

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

describe('Ask User compatibility', () => {
  it('keeps generic image option cards selectable', () => {
    const onSelectOption = vi.fn()
    const onSubmitOption = vi.fn()
    render(
      <MantineProvider>
        <AskUserPendingCard
          pendingAskUser={{
            sourceMessageId: 'ask-1',
            toolCallId: 'ask-tool-1',
            question: '选择参考图',
            options: [],
            optionCards: [{ value: 'reference-b', imageUrl: 'https://cdn.example/b.png', title: '方向 B' }],
            urgency: 'blocker',
            askedAt: null,
            awaitingReply: true,
            selectedOption: '',
          }}
          layout="expanded"
          canContinue={false}
          onSelectOption={onSelectOption}
          onSubmitOption={onSubmitOption}
          onContinue={vi.fn()}
        />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'A. 方向 B' }))
    expect(onSelectOption).toHaveBeenCalledWith('reference-b')
    expect(onSubmitOption).toHaveBeenCalledWith('reference-b')
  })

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
