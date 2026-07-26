export type CanvasEdgeRelationshipKind = 'primary' | 'reference' | 'aggregation'

export function readCanvasEdgeRelationship(data: unknown): CanvasEdgeRelationshipKind {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'primary'
  const relationship = (data as Record<string, unknown>).relationshipKind
  return relationship === 'reference' || relationship === 'aggregation' || relationship === 'primary'
    ? relationship
    : 'primary'
}

export function getCanvasEdgeOpacity(input: {
  relationship: CanvasEdgeRelationshipKind
  connectedToSelection: boolean
  mutedByVisibility: boolean
}): number {
  if (input.mutedByVisibility) return input.connectedToSelection ? 0.08 : 0.05
  if (input.connectedToSelection) return 1
  if (input.relationship === 'reference') return 0.12
  if (input.relationship === 'aggregation') return 0.30
  return 0.55
}
