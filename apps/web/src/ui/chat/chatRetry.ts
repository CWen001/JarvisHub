export function resolveNativeRetryText(
  messages: readonly Readonly<{ id: string; role: string; content: string }>[],
  failedMessageId: string,
): string | null {
  const failedIndex = messages.findIndex((message) => message.id === failedMessageId)
  if (failedIndex < 0) return null
  for (let index = failedIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const content = String(message?.content || '').trim()
    if (message?.role === 'user' && content) return content
  }
  return null
}
