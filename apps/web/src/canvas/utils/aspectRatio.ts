export function formatAspectRatio(w: number, h: number): string {
  if (!w || !h) return ''
  const W = Math.round(w)
  const H = Math.round(h)
  if (W <= 0 || H <= 0) return ''
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(W, H)
  const aw = W / d
  const ah = H / d
  if (aw > 64 || ah > 64) return `${W}:${H}`
  return `${aw}:${ah}`
}

const LABEL_ASPECT_SUFFIX_RE = /\s*[｜|]\s*\d+\s*[:：]\s*\d+\s*$/

export function deriveDisplayLabel(
  rawLabel: string | undefined,
  naturalWidth?: number,
  naturalHeight?: number,
): string {
  const base = (rawLabel ?? '').replace(LABEL_ASPECT_SUFFIX_RE, '').trim()
  const aspect =
    naturalWidth && naturalHeight ? formatAspectRatio(naturalWidth, naturalHeight) : ''
  return aspect ? `${base}｜${aspect}` : base
}
