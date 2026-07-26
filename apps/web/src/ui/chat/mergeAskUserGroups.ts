import type { ChatMessage } from './AiChatDialog'

export type MergedMessageGroup =
  | { kind: 'single'; message: ChatMessage }
  | { kind: 'ask-user-merged'; askMessage: ChatMessage; userReply: ChatMessage; continuation: ChatMessage }

export function buildMergedMessageGroups(messages: ChatMessage[]): MergedMessageGroup[] {
  const result: MergedMessageGroup[] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (
      msg.role === 'assistant' &&
      msg.askUserPrompt &&
      i + 2 < messages.length &&
      messages[i + 1].role === 'user' &&
      messages[i + 2].role === 'assistant'
    ) {
      result.push({
        kind: 'ask-user-merged',
        askMessage: msg,
        userReply: messages[i + 1],
        continuation: messages[i + 2],
      })
      i += 3
    } else {
      result.push({ kind: 'single', message: msg })
      i += 1
    }
  }
  return result
}
