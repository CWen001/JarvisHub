export {
  attachNativeChatAuthority as registerAgentWorkspaceChatIntegration,
  executeNativeChatCommand as executeAgentWorkspaceChatCommand,
  isNativeChatAuthorityReady as isAgentWorkspaceChatIntegrationReady,
  subscribeNativeChatAuthority as subscribeAgentWorkspaceChatIntegration,
} from '../ui/chat/nativeChatAuthority'
export type {
  NativeChatAuthority as AgentWorkspaceChatIntegration,
  NativeChatCommand as AgentWorkspaceChatIntegrationCommand,
} from '../ui/chat/nativeChatAuthority'
