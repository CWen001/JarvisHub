import React from 'react'
import type { ChatSelectableSkill, ChatTabRuntimeState } from '../ui/chat/chatRuntimeStore'
import { readAiChatTabsState, selectAiChatTab, writeAiChatTabsState } from '../ui/chat/chatTabs'
import {
  registerAgentWorkspaceChatIntegration,
  type AgentWorkspaceChatIntegrationCommand,
} from './agentWorkspaceChatIntegration'
import { notifyNativeChatNavigationChanged } from './nativeChatNavigation'

export type NativeChatWorkspaceAuthority = Readonly<{
  setDraft: (text: string) => void
  submit: () => void | Promise<void>
  interrupt: () => void
  uploadReferences: (files: readonly File[]) => void | Promise<void>
  addReference: (
    reference: Extract<AgentWorkspaceChatIntegrationCommand, { type: 'reference.add' }>['reference'],
    continuation?: 'reference' | 'modify',
  ) => void | Promise<void>
  removeReference: (url: string) => void | Promise<void>
  answerDecision: (option: string) => void | Promise<void>
  selectSkill: (skill: Extract<AgentWorkspaceChatIntegrationCommand, { type: 'skill.select' }>['skill']) => void
  createSession: (projectId: string) => void
  selectSession: (projectId: string, sessionId: string) => void
}>

type NativeChatWorkspaceAuthorityInput = Readonly<{
  activeTabId: string
  currentProjectId: string
  updateTabRuntime: (tabId: string, updater: (current: ChatTabRuntimeState) => ChatTabRuntimeState) => void
  setDraft: (value: string | ((current: string) => string)) => void
  send: (options?: Readonly<{ text?: string; displayText?: string }>) => void | Promise<void>
  interrupt: () => void
  uploadReferences: (files: readonly File[]) => void | Promise<void>
  addReferenceImages: (urls: string[], options: Readonly<{ source: string }>) => void
  selectSkill: (skill: ChatSelectableSkill | null) => void
  startNewConversation: () => void
  selectConversation: (sessionId: string) => void
}>

export function createNativeChatWorkspaceAuthority(
  input: NativeChatWorkspaceAuthorityInput,
): NativeChatWorkspaceAuthority {
  return {
    setDraft: (text) => input.setDraft(text),
    submit: () => input.send(),
    interrupt: input.interrupt,
    uploadReferences: input.uploadReferences,
    removeReference: (url) => {
      if (!input.activeTabId) return
      input.updateTabRuntime(input.activeTabId, (current) => ({
        ...current,
        manualReferenceImages: current.manualReferenceImages.filter((item) => item !== url),
        manualReferenceVideos: (current.manualReferenceVideos || []).filter((item) => item.url !== url),
        uploadedReferenceAssetMeta: Object.fromEntries(
          Object.entries(current.uploadedReferenceAssetMeta).filter(([itemUrl]) => itemUrl !== url),
        ),
      }))
    },
    addReference: (reference, continuation) => {
      if (reference.kind === 'video') {
        if (!input.activeTabId) return
        input.updateTabRuntime(input.activeTabId, (current) => {
          const videos = current.manualReferenceVideos || []
          if (videos.some((item) => item.url === reference.url)) return current
          return {
            ...current,
            manualReferenceVideos: [...videos, {
              url: reference.url,
              label: reference.label || '参考视频',
              ...(reference.thumbnailUrl ? { thumbnailUrl: reference.thumbnailUrl } : {}),
              ...(reference.nodeId ? { nodeId: reference.nodeId } : {}),
            }],
          }
        })
      } else {
        input.addReferenceImages([reference.url], { source: '资产' })
        if (input.activeTabId && (reference.assetId || reference.assetRefId || reference.label)) {
          input.updateTabRuntime(input.activeTabId, (current) => ({
            ...current,
            uploadedReferenceAssetMeta: {
              ...current.uploadedReferenceAssetMeta,
              [reference.url]: {
                ...(reference.assetId ? { assetId: reference.assetId } : {}),
                ...(reference.assetRefId ? { assetRefId: reference.assetRefId } : {}),
                ...(reference.label ? { name: reference.label } : {}),
              },
            },
          }))
        }
      }
      if (continuation === 'modify') {
        input.setDraft((current) => current || `请基于「${reference.label || '当前资产'}」继续修改：`)
      }
    },
    answerDecision: (option) => input.send({ text: option, displayText: option }),
    selectSkill: (skill) => input.selectSkill(skill as ChatSelectableSkill | null),
    createSession: (projectId) => {
      if (projectId === input.currentProjectId) input.startNewConversation()
    },
    selectSession: (projectId, sessionId) => {
      if (projectId === input.currentProjectId) {
        input.selectConversation(sessionId)
        return
      }
      const projectState = readAiChatTabsState(projectId)
      writeAiChatTabsState(selectAiChatTab(projectState, sessionId), projectId)
      notifyNativeChatNavigationChanged(projectId)
    },
  }
}

export function createNativeChatWorkspaceCommandExecutor(
  authority: NativeChatWorkspaceAuthority,
): (command: AgentWorkspaceChatIntegrationCommand) => Promise<void> {
  return async (command) => {
    switch (command.type) {
      case 'draft.set':
        authority.setDraft(command.text)
        return
      case 'request.submit':
        await authority.submit()
        return
      case 'request.interrupt':
        authority.interrupt()
        return
      case 'references.upload':
        await authority.uploadReferences(command.files)
        return
      case 'reference.add':
        await authority.addReference(command.reference, command.continuation)
        return
      case 'reference.remove':
        await authority.removeReference(command.url)
        return
      case 'decision.answer':
        await authority.answerDecision(command.option)
        return
      case 'skill.select':
        authority.selectSkill(command.skill)
        return
      case 'session.create':
        authority.createSession(command.projectId)
        return
      case 'session.select':
        authority.selectSession(command.projectId, command.sessionId)
    }
  }
}

const NATIVE_ARTIFACT_CHAT_COMMAND = 'jarvishub:native-artifact-chat-command'

type NativeArtifactWorkspaceCommand = Readonly<{
  type: 'modify' | 'reference'
  asset: Readonly<{
    url: string
    title?: string
    mediaType?: 'image' | 'video'
    thumbnailUrl?: string
    nodeId?: string
    assetId?: string
    assetRefId?: string
  }>
}>

export function useNativeArtifactWorkspaceAdapter(input: Readonly<{
  activeTabId: string
  updateTabRuntime: (tabId: string, updater: (current: ChatTabRuntimeState) => ChatTabRuntimeState) => void
  addReferenceImages: (urls: string[], options: Readonly<{ source: string }>) => void
  setDraft: (value: string | ((current: string) => string)) => void
  notify: (message: string, kind: 'success' | 'error') => void
}>): void {
  const inputRef = React.useRef(input)
  inputRef.current = input
  React.useEffect(() => {
    const onArtifactCommand = (event: Event) => {
      const currentInput = inputRef.current
      const command = (event as CustomEvent<NativeArtifactWorkspaceCommand>).detail
      const url = String(command?.asset?.url || '').trim()
      if (!command || !url || !currentInput.activeTabId) return
      const assetId = String(command.asset.assetId || '').trim()
      const assetRefId = String(command.asset.assetRefId || '').trim()
      const name = String(command.asset.title || '').trim()
      currentInput.updateTabRuntime(currentInput.activeTabId, (current) => ({
        ...current,
        uploadedReferenceAssetMeta: {
          ...current.uploadedReferenceAssetMeta,
          [url]: {
            ...(assetId ? { assetId } : {}),
            ...(assetRefId ? { assetRefId } : {}),
            ...(name ? { name } : {}),
          },
        },
      }))
      if (command.asset.mediaType === 'video') {
        currentInput.updateTabRuntime(currentInput.activeTabId, (current) => {
          const videos = current.manualReferenceVideos || []
          if (videos.some((item) => item.url === url)) return current
          return {
            ...current,
            manualReferenceVideos: [...videos, {
              url,
              label: name || 'Reference video',
              ...(command.asset.thumbnailUrl ? { thumbnailUrl: command.asset.thumbnailUrl } : {}),
              ...(command.asset.nodeId ? { nodeId: command.asset.nodeId } : {}),
            }],
          }
        })
        currentInput.notify('已添加 1 个参考视频（Artifact）', 'success')
      } else {
        currentInput.addReferenceImages([url], { source: 'Artifact' })
      }
      if (command.type === 'modify') {
        currentInput.setDraft((current) => current || `请基于「${name || '当前资产'}」继续修改：`)
      }
    }
    window.addEventListener(NATIVE_ARTIFACT_CHAT_COMMAND, onArtifactCommand)
    return () => window.removeEventListener(NATIVE_ARTIFACT_CHAT_COMMAND, onArtifactCommand)
  }, [])
}

export function useNativeChatWorkspaceAdapter(input: Readonly<{
  enabled: boolean
  authority: NativeChatWorkspaceAuthority
}>): void {
  const authorityRef = React.useRef(input.authority)
  authorityRef.current = input.authority

  React.useEffect(() => {
    if (!input.enabled) return
    return registerAgentWorkspaceChatIntegration({
      execute: (command) => createNativeChatWorkspaceCommandExecutor(authorityRef.current)(command),
    })
  }, [input.enabled])
}
