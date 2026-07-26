import type { LiveToolCallRecord, LiveToolCallStatus } from './liveChatRunStore'
import { getLiveToolCallEffectiveStatus } from './mediaToolStatus'

export type ToolExecutionStatus = {
  dispatchStatus: LiveToolCallStatus
  runStatus: LiveToolCallStatus
  hasDescendants: boolean
  shouldShowDispatchStatus: boolean
}

function collectDescendants(
  toolCallId: string,
  childrenByParent: Map<string, LiveToolCallRecord[]>,
): LiveToolCallRecord[] {
  const out: LiveToolCallRecord[] = []
  const visit = (parentId: string): void => {
    const children = childrenByParent.get(parentId) ?? []
    for (const child of children) {
      out.push(child)
      visit(child.toolCallId)
    }
  }
  visit(toolCallId)
  return out
}

function aggregateActiveDescendantStatus(descendants: LiveToolCallRecord[]): LiveToolCallStatus | null {
	if (descendants.length === 0) return null
	const statuses = descendants.map(getLiveToolCallEffectiveStatus)
	if (statuses.some((status) => status === 'running')) return 'running'
	return null
}

export function resolveToolExecutionStatus(
  call: LiveToolCallRecord,
  childrenByParent: Map<string, LiveToolCallRecord[]>,
): ToolExecutionStatus {
	const dispatchStatus = getLiveToolCallEffectiveStatus(call)
	const descendantStatus = aggregateActiveDescendantStatus(collectDescendants(call.toolCallId, childrenByParent))
	const runStatus = dispatchStatus === 'running' ? 'running' : descendantStatus ?? dispatchStatus
	return {
		dispatchStatus,
		runStatus,
    hasDescendants: descendantStatus !== null,
    shouldShowDispatchStatus: descendantStatus !== null && descendantStatus !== dispatchStatus,
  }
}
