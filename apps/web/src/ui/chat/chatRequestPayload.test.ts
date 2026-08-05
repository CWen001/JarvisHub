import { describe, expect, it } from 'vitest'
import { resolveCanvasSelectionPolicy, resolveChatRequestExecution } from './chatRequestPayload'

describe('resolveChatRequestExecution', () => {
  it('requires a delivered asset when the user accepts a generation strategy', () => {
    expect(resolveChatRequestExecution({
      isGenerationAuthorization: true,
    })).toEqual({
      mode: 'auto',
      forceAssetGeneration: true,
    })
  })

  it('keeps ordinary chat turns open to text-only delivery', () => {
    expect(resolveChatRequestExecution({
      isGenerationAuthorization: false,
    })).toEqual({
      mode: 'auto',
      forceAssetGeneration: false,
    })
  })
})

describe('resolveCanvasSelectionPolicy', () => {
  it('does not turn a hidden Professional Workspace selection into an Agent Workspace attachment', () => {
    expect(resolveCanvasSelectionPolicy({
      surface: 'agent-workspace',
      explicitAttachCanvasContext: false,
      hasImplicitRequest: false,
      hasReplicateTarget: false,
    })).toEqual({
      includeSelectedCanvasMedia: false,
      attachSelectedCanvasNodeContext: false,
    })
  })

  it('keeps native canvas-selection behavior in Professional Workspace', () => {
    expect(resolveCanvasSelectionPolicy({
      surface: 'native',
      explicitAttachCanvasContext: false,
      hasImplicitRequest: false,
      hasReplicateTarget: false,
    })).toEqual({
      includeSelectedCanvasMedia: true,
      attachSelectedCanvasNodeContext: true,
    })
  })

  it('allows explicit canvas-context commands without silently attaching selected media', () => {
    expect(resolveCanvasSelectionPolicy({
      surface: 'agent-workspace',
      explicitAttachCanvasContext: true,
      hasImplicitRequest: false,
      hasReplicateTarget: false,
    })).toEqual({
      includeSelectedCanvasMedia: false,
      attachSelectedCanvasNodeContext: true,
    })
  })
})
