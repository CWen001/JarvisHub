const VIDEO_RENDER_NODE_KINDS = new Set(['video', 'composeVideo'])
const MEDIA_PROMPT_SOURCE_NODE_KINDS = new Set([
  'image',
  'imageEdit',
  'video',
  'composeVideo',
])

type MergeExecutionPromptSequenceInput = {
  kind: string
  ownPrompt: string
  upstreamPrompts: string[]
}

export function mergeExecutionPromptSequence(input: MergeExecutionPromptSequenceInput): string[] {
  const ownPrompt = input.ownPrompt.trim()
  const upstreamPrompts = input.upstreamPrompts

  if (VIDEO_RENDER_NODE_KINDS.has(input.kind)) {
    return [ownPrompt, ...upstreamPrompts].filter(Boolean)
  }

  return [...upstreamPrompts, ownPrompt].filter(Boolean)
}

export function shouldInheritInboundPromptForExecution(input: {
  targetKind: string
  sourceKind: string
}): boolean {
  if (VIDEO_RENDER_NODE_KINDS.has(input.targetKind)) {
    return !MEDIA_PROMPT_SOURCE_NODE_KINDS.has(input.sourceKind)
  }

  return true
}
