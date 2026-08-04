export type AgentWorkspaceChatIntegrationCommand =
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

export type AgentWorkspaceChatIntegration = Readonly<{
  execute: (command: AgentWorkspaceChatIntegrationCommand) => void | Promise<void>
}>

let activeIntegration: AgentWorkspaceChatIntegration | null = null
const listeners = new Set<() => void>()

export function registerAgentWorkspaceChatIntegration(
  integration: AgentWorkspaceChatIntegration,
): () => void {
  activeIntegration = integration
  for (const listener of listeners) listener()
  return () => {
    if (activeIntegration !== integration) return
    activeIntegration = null
    for (const listener of listeners) listener()
  }
}

export async function executeAgentWorkspaceChatCommand(
  command: AgentWorkspaceChatIntegrationCommand,
): Promise<void> {
  if (!activeIntegration) throw new Error('Agent 对话能力尚未就绪')
  await activeIntegration.execute(command)
}

export function subscribeAgentWorkspaceChatIntegration(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isAgentWorkspaceChatIntegrationReady(): boolean {
  return activeIntegration !== null
}
