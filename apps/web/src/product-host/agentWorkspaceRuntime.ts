import {
  projectAgentWorkspace,
  resolveAgentWorkspaceIntent,
  type AgentWorkspaceFacts,
  type AgentWorkspaceIntent,
  type AgentWorkspaceViewModel,
  type NativeAgentWorkspaceCommand,
} from './agentWorkspaceProjection'

export type AgentWorkspaceRuntimeSnapshot = Readonly<AgentWorkspaceViewModel & {
  revision: number
}>

export type AgentWorkspaceIntentOutcome =
  | Readonly<{ accepted: true; command: NativeAgentWorkspaceCommand }>
  | Readonly<{ accepted: false; message: string }>

export type AgentWorkspaceRuntimeAdapter = Readonly<{
  readFacts: () => AgentWorkspaceFacts
  subscribe: (listener: () => void) => () => void
  execute: (command: NativeAgentWorkspaceCommand) => void | Promise<void>
}>

export type AgentWorkspaceRuntime = Readonly<{
  getSnapshot: () => AgentWorkspaceRuntimeSnapshot
  subscribe: (listener: () => void) => () => void
  dispatch: (intent: AgentWorkspaceIntent) => Promise<AgentWorkspaceIntentOutcome>
}>

function projectSnapshot(facts: AgentWorkspaceFacts, revision: number): AgentWorkspaceRuntimeSnapshot {
  return Object.freeze({ ...projectAgentWorkspace(facts), revision })
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : '原生命令执行失败'
}

export function createAgentWorkspaceRuntime(
  adapter: AgentWorkspaceRuntimeAdapter,
): AgentWorkspaceRuntime {
  let revision = 0
  let snapshot = projectSnapshot(adapter.readFacts(), revision)
  const listeners = new Set<() => void>()
  let unsubscribeAdapter: (() => void) | null = null
  const refresh = () => {
    revision += 1
    snapshot = projectSnapshot(adapter.readFacts(), revision)
    for (const listener of listeners) listener()
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      if (listeners.size === 0) unsubscribeAdapter = adapter.subscribe(refresh)
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          unsubscribeAdapter?.()
          unsubscribeAdapter = null
        }
      }
    },
    dispatch: async (intent: AgentWorkspaceIntent): Promise<AgentWorkspaceIntentOutcome> => {
      const command = resolveAgentWorkspaceIntent(intent)
      try {
        await adapter.execute(command)
        return Object.freeze({ accepted: true, command })
      } catch (error: unknown) {
        return Object.freeze({ accepted: false, message: errorMessage(error) })
      }
    },
  })
}

export type InMemoryAgentWorkspaceAdapter = AgentWorkspaceRuntimeAdapter & Readonly<{
  commands: NativeAgentWorkspaceCommand[]
  replaceFacts: (facts: AgentWorkspaceFacts) => void
}>

export function createInMemoryAgentWorkspaceAdapter(
  initialFacts: AgentWorkspaceFacts,
  options: Readonly<{
    execute?: (command: NativeAgentWorkspaceCommand) => void | Promise<void>
  }> = {},
): InMemoryAgentWorkspaceAdapter {
  let facts = initialFacts
  const commands: NativeAgentWorkspaceCommand[] = []
  const listeners = new Set<() => void>()

  return Object.freeze({
    commands,
    readFacts: () => facts,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    execute: async (command: NativeAgentWorkspaceCommand) => {
      if (options.execute) await options.execute(command)
      commands.push(command)
    },
    replaceFacts: (nextFacts: AgentWorkspaceFacts) => {
      facts = nextFacts
      for (const listener of listeners) listener()
    },
  })
}
