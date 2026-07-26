import { useState } from 'react'
import { Badge, Button, Group, Modal, Text } from '@mantine/core'
import { IconCheck, IconEdit, IconMaximize } from '@tabler/icons-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChatMarkdownContent } from './ChatMarkdownContent'
import {
  formatAskUserQuestionForDisplay,
  getAskUserUrgencyBadgeColor,
  getAskUserUrgencyLabel,
  type PendingAskUserState,
} from './askUserPrompt'

type AskUserPendingCardProps = {
  pendingAskUser: PendingAskUserState
  layout: 'compact' | 'expanded' | 'maximized'
  disabled?: boolean
  canContinue: boolean
  onSelectOption: (option: string) => void
  onSubmitOption?: (option: string) => void
  onContinue: () => void
}

function AskUserOptionMarkdown({ markdownText }: { markdownText: string }): JSX.Element {
  return (
    <span className="tc-ai-chat-ask-user-pending__option-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        allowedElements={['p', 'strong', 'em', 'del', 'code', 'br']}
        unwrapDisallowed
        components={{
          p: ({ node: _node, ...props }) => <span {...props} />,
          code: ({ node: _node, ...props }) => (
            <code className="tc-ai-chat-ask-user-pending__option-code" {...props} />
          ),
        }}
      >
        {markdownText}
      </ReactMarkdown>
    </span>
  )
}

function formatOptionAccessibleText(markdownText: string): string {
  return String(markdownText || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(
      /(^|[\s(（\[])([*_])(?=\S)(.+?\S)\2(?=$|[\s)）\].,!?，。！？：；])/g,
      '$1$3',
    )
    .replace(/\s+/g, ' ')
    .trim()
}

function getImageOptionLetter(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index)
}

function getImageOptionTitle(
  card: PendingAskUserState['optionCards'][number],
  letter: string,
): string {
  return String(card.title || '').trim()
    || String(card.displayValue || '').trim()
    || `选项 ${letter}`
}

export function AskUserPendingCard({
  pendingAskUser,
  layout,
  disabled = false,
  canContinue,
  onSelectOption,
  onSubmitOption,
  onContinue,
}: AskUserPendingCardProps): JSX.Element {
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const rootClassName = [
    'tc-ai-chat-ask-user-pending',
    `tc-ai-chat-ask-user-pending--${layout}`,
  ].join(' ')
  const hasOptionCards = pendingAskUser.optionCards.length > 0
  const displayQuestion = formatAskUserQuestionForDisplay(
    pendingAskUser.question,
    pendingAskUser.options,
  )

  return (
    <div className={rootClassName} aria-label="ask-user-pending-bar">
      <Group
        className="tc-ai-chat-ask-user-pending__header"
        justify="space-between"
        align="center"
        gap={8}
        wrap="nowrap"
      >
        <Text className="tc-ai-chat-ask-user-pending__status" size="xs" fw={700}>
          等待你的回复
        </Text>
        <Badge
          className="tc-ai-chat-ask-user-pending__badge"
          size="xs"
          radius="sm"
          variant="light"
          color={getAskUserUrgencyBadgeColor(pendingAskUser.urgency)}
        >
          {getAskUserUrgencyLabel(pendingAskUser.urgency)}
        </Badge>
      </Group>

      <div className="tc-ai-chat-ask-user-pending__question">
        <ChatMarkdownContent markdownText={displayQuestion} />
      </div>

      {hasOptionCards ? (
        <div
          className="tc-ai-chat-ask-user-pending__image-options"
          role="group"
          aria-label="style-reference-image-options"
        >
          {pendingAskUser.optionCards.map((card, index) => {
            const selected = pendingAskUser.selectedOption === card.value
            const thumb = card.thumbnailUrl || card.imageUrl
            const optionLetter = getImageOptionLetter(index)
            const visibleTitle = getImageOptionTitle(card, optionLetter)
            const accessibleLabel = `${optionLetter}. ${visibleTitle}`
            return (
              <div
                key={`${pendingAskUser.toolCallId}_pending_image_option_${index}`}
                className={[
                  'tc-ai-chat-ask-user-pending__image-option-wrap',
                  selected ? 'tc-ai-chat-ask-user-pending__image-option-wrap--selected' : '',
                ].filter(Boolean).join(' ')}
              >
                <button
                  type="button"
                  className="tc-ai-chat-ask-user-pending__image-option"
                  aria-pressed={selected}
                  aria-label={accessibleLabel}
                  onClick={() => {
                    onSelectOption(card.value)
                    onSubmitOption?.(card.value)
                  }}
                  disabled={disabled}
                >
                  <span className="tc-ai-chat-ask-user-pending__image-option-media">
                    <img
                      className="tc-ai-chat-ask-user-pending__image-option-img"
                      src={thumb}
                      alt=""
                      loading="lazy"
                    />
                    <span
                      className="tc-ai-chat-ask-user-pending__image-option-letter"
                      aria-hidden="true"
                    >
                      {optionLetter}
                    </span>
                  </span>
                  <span className="tc-ai-chat-ask-user-pending__image-option-caption">
                    <span className="tc-ai-chat-ask-user-pending__image-option-title">
                      {visibleTitle}
                    </span>
                    <span
                      className="tc-ai-chat-ask-user-pending__image-option-indicator"
                      aria-hidden="true"
                    >
                      {selected ? <IconCheck size={14} stroke={2.4} /> : null}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="tc-ai-chat-ask-user-pending__image-option-zoom"
                  aria-label={`放大查看：${accessibleLabel}`}
                  onClick={() => setPreviewImageUrl(card.imageUrl)}
                  disabled={disabled}
                >
                  <IconMaximize size={14} />
                </button>
              </div>
            )
          })}
          <button
            type="button"
            className="tc-ai-chat-ask-user-pending__custom-style-option"
            onClick={() => onSelectOption('都不满意，自定义')}
            disabled={disabled}
            aria-label="都不满意，自定义"
          >
            <IconEdit size={18} />
            <span>自定义</span>
          </button>
        </div>
      ) : pendingAskUser.options.length > 0 ? (
        <div
          className="tc-ai-chat-ask-user-pending__options"
          role="group"
          aria-label="ask-user-options"
        >
          {pendingAskUser.options.map((option, index) => {
            const selected = pendingAskUser.selectedOption === option
            const accessibleText = formatOptionAccessibleText(option) || `选项 ${index + 1}`
            return (
              <button
                key={`${pendingAskUser.toolCallId}_pending_option_${index}`}
                type="button"
                className={[
                  'tc-ai-chat-ask-user-pending__option',
                  selected ? 'tc-ai-chat-ask-user-pending__option--selected' : '',
                ].filter(Boolean).join(' ')}
                aria-pressed={selected}
                aria-label={`${index + 1}. ${accessibleText}`}
                onClick={() => onSelectOption(option)}
                disabled={disabled}
              >
                <span className="tc-ai-chat-ask-user-pending__option-index" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="tc-ai-chat-ask-user-pending__option-body">
                  <AskUserOptionMarkdown markdownText={option} />
                </span>
                <span className="tc-ai-chat-ask-user-pending__option-indicator" aria-hidden="true">
                  {selected ? <IconCheck size={15} stroke={2.4} /> : null}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

      <Modal
        opened={Boolean(previewImageUrl)}
        onClose={() => setPreviewImageUrl(null)}
        withCloseButton={false}
        centered
        size="min(92vw, 980px)"
        padding={0}
        styles={{
          content: { background: 'transparent', boxShadow: 'none' },
          body: { padding: 0 },
        }}
      >
        {previewImageUrl ? (
          <img
            className="tc-ai-chat-ask-user-pending__image-preview"
            src={previewImageUrl}
            alt=""
          />
        ) : null}
      </Modal>

      {hasOptionCards ? null : (
        <Group
          className="tc-ai-chat-ask-user-pending__footer"
          justify="flex-end"
          align="center"
          gap={10}
          wrap="wrap"
        >
          <Button
            className="tc-ai-chat-ask-user-pending__continue"
            size="xs"
            radius="xs"
            onClick={onContinue}
            disabled={disabled || !canContinue}
          >
            继续
          </Button>
        </Group>
      )}
    </div>
  )
}
