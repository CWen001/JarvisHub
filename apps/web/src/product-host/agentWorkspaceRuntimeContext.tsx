import React from 'react'
import type { AgentWorkspaceRuntime } from './agentWorkspaceRuntime'

const AgentWorkspaceRuntimeContext = React.createContext<AgentWorkspaceRuntime | null>(null)

export function AgentWorkspaceRuntimeProvider({
  runtime,
  children,
}: Readonly<{
  runtime: AgentWorkspaceRuntime
  children: React.ReactNode
}>): JSX.Element {
  return (
    <AgentWorkspaceRuntimeContext.Provider value={runtime}>
      {children}
    </AgentWorkspaceRuntimeContext.Provider>
  )
}

export function useAgentWorkspaceRuntime(): AgentWorkspaceRuntime | null {
  return React.useContext(AgentWorkspaceRuntimeContext)
}
