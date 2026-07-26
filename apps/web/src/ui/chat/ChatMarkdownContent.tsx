import { memo } from 'react'
import { MarkdownContent } from '../MarkdownContent'

export const ChatMarkdownContent = memo(function ChatMarkdownContent({ markdownText }: { markdownText: string }): JSX.Element | null {
  if (!String(markdownText || '').trim()) return null
  return (
    <div className="tc-ai-chat-bubble__content">
      <MarkdownContent markdownText={markdownText} variant="chat" />
    </div>
  )
})
