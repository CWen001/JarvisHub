export type ChatTodoItem = {
  status: 'pending' | 'in_progress' | 'waiting' | 'blocked' | 'completed'
  content: string
}

export function countCompletedTodoItems(items: ChatTodoItem[]): number {
  return items.filter((item) => item.status === 'completed').length
}

export function findInProgressTodoItem(items: ChatTodoItem[]): ChatTodoItem | null {
  return items.find((item) => item.status === 'in_progress') ?? null
}

export function findWaitingTodoItem(items: ChatTodoItem[]): ChatTodoItem | null {
  return items.find((item) => item.status === 'waiting') ?? null
}

export function findBlockedTodoItem(items: ChatTodoItem[]): ChatTodoItem | null {
  return items.find((item) => item.status === 'blocked') ?? null
}
