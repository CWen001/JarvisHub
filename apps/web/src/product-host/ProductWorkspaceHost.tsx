import React from 'react'
import { NativeChatAuthorityHost } from '../ui/chat/AiChatDialog'
import { AgentWorkspace } from './AgentWorkspace'
import {
  useAuthoritativeAgentWorkspaceRuntime,
  type ProductionAgentWorkspaceCommands,
} from './agentWorkspaceAdapter'
import type { ProductBrand } from './productIdentity'
import HomePage from './landing/HomePage'
import IndiaPhoneCasePage from './landing/IndiaPhoneCasePage'
import { CASE_PATH } from './landing/indiaPhoneCaseData'

type ProductWorkspaceRuntimeInput = Pick<
  Parameters<typeof useAuthoritativeAgentWorkspaceRuntime>[0],
  'enabled' | 'projects' | 'currentProject' | 'currentFlow'
>

type ProductWorkspaceHostProps =
  | Readonly<{ surface: 'entry'; pathname: string }>
  | Readonly<{
      surface: 'workspace'
      brand: ProductBrand
      runtimeInput: ProductWorkspaceRuntimeInput
      commands: ProductionAgentWorkspaceCommands
    }>

function ProductWorkspaceAgent({
  brand,
  runtimeInput,
  commands,
  railCollapsed,
  setRailCollapsed,
}: Extract<ProductWorkspaceHostProps, { surface: 'workspace' }> & Readonly<{
  railCollapsed: boolean
  setRailCollapsed: (collapsed: boolean) => void
}>): JSX.Element {
  const runtime = useAuthoritativeAgentWorkspaceRuntime({ ...runtimeInput, ...commands })
  return (
    <div className="agent-workspace-surface" data-rail-collapsed={railCollapsed}>
      <AgentWorkspace
        brand={brand}
        runtime={runtime}
        railCollapsed={railCollapsed}
        onRailCollapsedChange={setRailCollapsed}
      />
    </div>
  )
}

function ProductWorkspaceSurface(
  props: Extract<ProductWorkspaceHostProps, { surface: 'workspace' }>,
): JSX.Element {
  const [railCollapsed, setRailCollapsed] = React.useState(false)

  React.useEffect(() => {
    document.documentElement.dataset.productHost = 'true'
    return () => { delete document.documentElement.dataset.productHost }
  }, [])

  return (
    <NativeChatAuthorityHost>
      <ProductWorkspaceAgent
        {...props}
        railCollapsed={railCollapsed}
        setRailCollapsed={setRailCollapsed}
      />
    </NativeChatAuthorityHost>
  )
}

export function ProductWorkspaceHost(props: ProductWorkspaceHostProps): JSX.Element {
  if (props.surface === 'workspace') return <ProductWorkspaceSurface {...props} />
  return props.pathname === CASE_PATH ? <IndiaPhoneCasePage /> : <HomePage />
}
