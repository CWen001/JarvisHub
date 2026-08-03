export const NATIVE_CHAT_NAVIGATION_COMMAND = 'jarvishub:native-chat-navigation-command'
export const NATIVE_CHAT_NAVIGATION_CHANGED = 'jarvishub:native-chat-navigation-changed'

export type NativeChatNavigationCommand =
  | Readonly<{ type: 'select-session'; projectId: string; sessionId: string }>
  | Readonly<{ type: 'new-session'; projectId: string }>

export function dispatchNativeChatNavigation(command: NativeChatNavigationCommand): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(NATIVE_CHAT_NAVIGATION_COMMAND, { detail: command }))
}

export function notifyNativeChatNavigationChanged(projectId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(NATIVE_CHAT_NAVIGATION_CHANGED, {
    detail: { projectId },
  }))
}
