import React from 'react'

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

const NativeChatAuthorityContext = React.createContext<NativeChatAuthority | null>(null)

export function NativeChatAuthorityProvider({
  authority,
  children,
}: React.PropsWithChildren<{ authority: NativeChatAuthority }>): JSX.Element {
  if (React.useContext(NativeChatAuthorityContext)) {
    throw new Error('Native Chat Authority 已经挂载')
  }
  return React.createElement(NativeChatAuthorityContext.Provider, { value: authority }, children)
}

export function useNativeChatAuthority(): NativeChatAuthority | null {
  return React.useContext(NativeChatAuthorityContext)
}
