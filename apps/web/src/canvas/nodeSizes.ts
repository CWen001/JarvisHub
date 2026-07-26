import { getTaskNodeCoreType, type TaskNodeCoreType } from './nodes/taskNodeSchema'

export type NodeSizeProfile = {
  defaultW: number
  defaultH: number
  minW: number
  maxW: number
  minH: number
  maxH: number
  // chromeH: vertical space inside the node consumed by non-media UI (header/actions/padding/gaps).
  // Used by computeMediaNodeHeight so the inner <video> matches its source aspect edge-to-edge.
  chromeH?: number
}

// 媒体节点（image / video / storyboard）共享同一基准尺寸，避免同 aspect 下视觉差异。
// maxH ≥ MEDIA_BASE_W × 16/9 保证 9:16 不被截断；maxW ≤ maxH × 16/9 保证 16:9 不被截断。
export const MEDIA_BASE_W = 320
const MEDIA_MIN_W = 200
const MEDIA_MAX_W = 560
const MEDIA_MIN_H = 180
const MEDIA_MAX_H = 760

// VideoContent.tsx 的 chrome：8+8 padding + ~30 header + ~30 actions + 6+6 gaps = 84
export const MEDIA_VIDEO_CHROME_H = 84

export const NODE_SIZE_PROFILES = {
  text:      { defaultW: 460, defaultH: 360, minW: 240, maxW: 1240, minH: 240, maxH: 680 },
  imageEdit: { defaultW: 320, defaultH: 220, minW: 180, maxW: 420, minH: 120, maxH: 420 },
  image:     { defaultW: MEDIA_BASE_W, defaultH: MEDIA_BASE_W, minW: MEDIA_MIN_W, maxW: MEDIA_MAX_W, minH: MEDIA_MIN_H, maxH: MEDIA_MAX_H },
  video:     { defaultW: MEDIA_BASE_W, defaultH: MEDIA_BASE_W, minW: MEDIA_MIN_W, maxW: MEDIA_MAX_W, minH: MEDIA_MIN_H, maxH: MEDIA_MAX_H, chromeH: MEDIA_VIDEO_CHROME_H },
  small:     { defaultW: 320, defaultH: 180, minW: 200, maxW: 420, minH: 120, maxH: 320 },
  default:   { defaultW: 420, defaultH: 240, minW: 220, maxW: 620, minH: 120, maxH: 480 },
} satisfies Record<string, NodeSizeProfile>

export type NodeSizeProfileKey = keyof typeof NODE_SIZE_PROFILES

const SMALL_KINDS = new Set(['reference', 'character'])

export function pickNodeSizeProfileKey(input: {
  kind?: string | null
  coreType?: TaskNodeCoreType | null
}): NodeSizeProfileKey {
  const kind = (input.kind || '').trim()
  if (kind === 'imageEdit') return 'imageEdit'
  if (SMALL_KINDS.has(kind)) return 'small'
  const coreType = input.coreType ?? (kind ? getTaskNodeCoreType(kind) : null)
  if (coreType === 'text') return 'text'
  if (coreType === 'video') return 'video'
  if (coreType === 'image') return 'image'
  return 'default'
}

export function getNodeSizeProfile(input: {
  kind?: string | null
  coreType?: TaskNodeCoreType | null
}): NodeSizeProfile {
  return NODE_SIZE_PROFILES[pickNodeSizeProfileKey(input)]
}

export function estimateNodeRenderSize(input: {
  kind?: string | null
  coreType?: TaskNodeCoreType | null
}): { w: number; h: number } {
  const profile = getNodeSizeProfile(input)
  return { w: profile.defaultW, h: profile.defaultH }
}

const MIN_ASPECT_RATIO = 9 / 16
const MAX_ASPECT_RATIO = 16 / 9

export function computeMediaNodeHeight(
  nodeWidth: number,
  naturalWidth: number,
  naturalHeight: number,
  profile: NodeSizeProfile,
): number {
  if (naturalWidth <= 0 || naturalHeight <= 0) return nodeWidth
  const rawRatio = naturalWidth / naturalHeight
  const clampedRatio = Math.max(MIN_ASPECT_RATIO, Math.min(MAX_ASPECT_RATIO, rawRatio))
  const chromeH = profile.chromeH ?? 0
  const computedHeight = Math.round(nodeWidth / clampedRatio) + chromeH
  return Math.max(profile.minH, Math.min(profile.maxH, computedHeight))
}
