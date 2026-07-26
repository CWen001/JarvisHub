const POSE_EDITOR_ELIGIBLE_KINDS = new Set<string>(['image', 'imageEdit'])

// Why this exists: uniqueDefs at TaskNode.tsx ~5601 used to gate PoseEditor on
// `kind === 'image'` only. Per product decision (Phase 3.3), imageEdit kind also
// should expose 图片编辑 since handlePoseSaved can already write into imageEdit
// chains. character kind is intentionally excluded — its visual semantics differ
// and we don't want chained imageEdit drift on identity-anchored assets.
export function isPoseEditorEligibleKind(kind: string | null | undefined): boolean {
  if (typeof kind !== 'string') return false
  return POSE_EDITOR_ELIGIBLE_KINDS.has(kind)
}
