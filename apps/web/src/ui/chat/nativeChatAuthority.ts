export type NativeChatCommand =
  | Readonly<{ type: 'draft.set'; text: string }>
  | Readonly<{ type: 'request.submit' }>
  | Readonly<{ type: 'request.interrupt' }>
  | Readonly<{ type: 'references.upload'; files: readonly File[] }>
  | Readonly<{
      type: 'reference.add'
      reference: Readonly<{
        kind: 'image' | 'video'
        url: string
        thumbnailUrl?: string
        label?: string
        nodeId?: string
        assetId?: string
        assetRefId?: string
      }>
      continuation?: 'reference' | 'modify'
    }>
  | Readonly<{ type: 'reference.remove'; url: string }>
  | Readonly<{ type: 'decision.answer'; option: string }>
  | Readonly<{ type: 'skill.select'; skill: Readonly<{ id: string; key: string; name: string }> | null }>
  | Readonly<{ type: 'session.select'; projectId: string; sessionId: string }>
  | Readonly<{ type: 'session.create'; projectId: string }>

export type NativeChatAuthority = Readonly<{
  execute: (command: NativeChatCommand) => void | Promise<void>
}>

let activeAuthority: NativeChatAuthority | null = null
const listeners = new Set<() => void>()

export function attachNativeChatAuthority(authority: NativeChatAuthority): () => void {
  if (activeAuthority) throw new Error('Native Chat Authority 已经挂载')
  activeAuthority = authority
  for (const listener of listeners) listener()
  return () => {
    if (activeAuthority !== authority) return
    activeAuthority = null
    for (const listener of listeners) listener()
  }
}

export async function executeNativeChatCommand(command: NativeChatCommand): Promise<void> {
  if (!activeAuthority) throw new Error('Agent 对话能力尚未就绪')
  await activeAuthority.execute(command)
}

export function subscribeNativeChatAuthority(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isNativeChatAuthorityReady(): boolean {
  return activeAuthority !== null
}
