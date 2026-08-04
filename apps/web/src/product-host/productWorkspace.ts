export type ProductWorkspaceContext = Readonly<{
  projectId: string
  flowId: string
  sessionId: string
  selectedNodeId: string
}>

export type ProductWorkspaceState = Readonly<{
  surface: 'chat' | 'canvas'
  context: ProductWorkspaceContext
}>

export function resolveInitialProductWorkspaceSurface(
  productExtensionInstalled: boolean,
): 'product' | 'canvas' {
  return productExtensionInstalled ? 'product' : 'canvas'
}

export function transitionProductWorkspace(
  state: ProductWorkspaceState,
  command: 'open-canvas' | 'return-to-chat',
): ProductWorkspaceState {
  return Object.freeze({
    surface: command === 'open-canvas' ? 'canvas' : 'chat',
    context: state.context,
  })
}

export const PRODUCT_WORKSPACE_COMMAND = 'jarvishub:product-workspace-command'

export type ProductWorkspaceCommand = Readonly<{
  type: 'open-canvas' | 'return-to-chat'
  nodeId?: string
}>

export function dispatchProductWorkspaceCommand(command: ProductWorkspaceCommand): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PRODUCT_WORKSPACE_COMMAND, { detail: command }))
}
