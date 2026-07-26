let pendingProjectId: string | null = null

export function markSkipNextProjectFlowLoad(projectId: string): void {
  const normalized = String(projectId || '').trim()
  pendingProjectId = normalized || null
}

export function consumeSkipProjectFlowLoad(projectId: string): boolean {
  const normalized = String(projectId || '').trim()
  if (!normalized || !pendingProjectId || pendingProjectId !== normalized) return false
  pendingProjectId = null
  return true
}
