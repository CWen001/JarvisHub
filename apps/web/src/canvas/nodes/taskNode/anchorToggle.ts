export const UI_ANCHOR_ELIGIBLE_KINDS = new Set<string>([
  'image',
  'imageEdit',
  'textToImage',
  'imageFission',
])

export type AnchorToggleInput = {
  kind: string | null | undefined
  productionLayer: string | null | undefined
  approvalStatus: string | null | undefined
}

export type AnchorToggleDecision = {
  visible: boolean
  active: boolean
  clearOnClick: boolean
}

// Why: previously TaskNode.tsx used `canToggleAnchor || canToggleApproval` as the
// visibility predicate, where canToggleApproval also matched any node already tagged
// productionLayer === 'anchors' | 'expansion'. That created a single-direction door:
// a non-eligible-kind node could see "取消锚点", click it, and lose the button entirely
// (no way to set it back). This helper makes visibility kind-only and symmetric.
export function decideAnchorToggle(input: AnchorToggleInput): AnchorToggleDecision {
  const kind = String(input.kind ?? '').trim()
  const visible = UI_ANCHOR_ELIGIBLE_KINDS.has(kind)
  const isExplicitAnchor = String(input.productionLayer ?? '').trim() === 'anchors'
  const isApproved = String(input.approvalStatus ?? '').trim() === 'approved'
  const active = visible && isExplicitAnchor && isApproved
  return { visible, active, clearOnClick: active }
}
