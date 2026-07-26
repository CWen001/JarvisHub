const PPT_CREATION_FIELDS = [
  'label',
  'content',
  'prompt',
  'systemPrompt',
  'nodeWidth',
  'nodeHeight',
  'outline',
  'audience',
  'tone',
  'format',
  'slideCount',
  'sourceNodeIds',
  'sourceFiles',
] as const

export function sanitizeNodeDataForCanvasClone(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  if (record.kind !== 'pptDeck') return { ...record }
  const cloned: Record<string, unknown> = { kind: 'pptDeck' }
  for (const field of PPT_CREATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) cloned[field] = record[field]
  }
  cloned.pptMasterStatus = 'draft'
  return cloned
}
