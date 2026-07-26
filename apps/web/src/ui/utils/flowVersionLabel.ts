const FLOW_VERSION_FALLBACK_LABEL = '—'

export function readFlowVersionDisplayLabel(
  version: { label: string | null | undefined; name: string | null | undefined },
): string {
  const label = typeof version.label === 'string' ? version.label.trim() : ''
  if (label) return label
  const name = typeof version.name === 'string' ? version.name.trim() : ''
  if (name) return name
  return FLOW_VERSION_FALLBACK_LABEL
}
