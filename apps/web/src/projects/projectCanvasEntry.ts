import type { FlowDto } from '../api/server'

export type ProjectCanvasOwnerType = 'project' | 'chapter' | 'shot'

export type ProjectCanvasOwnerContext = {
  ownerType: ProjectCanvasOwnerType
  ownerId: string
}

export type ProjectCanvasCurrentFlowSnapshot = {
  id?: string | null
  source?: 'local' | 'server' | null
  ownerType?: ProjectCanvasOwnerType | string | null
  ownerId?: string | null
}

export type ProjectCanvasProjectRecord = {
  id: string
  name: string
}

export type ProjectCanvasCurrentProjectSnapshot = {
  id?: string | null
  name?: string | null
}

function toTimestamp(value: string | null | undefined): number {
  const timestamp = Date.parse(String(value || ''))
  return Number.isFinite(timestamp) ? timestamp : 0
}

function normalizeId(value: string | null | undefined): string {
  return String(value || '').trim()
}

function normalizeProjectRecord(project: ProjectCanvasProjectRecord): ProjectCanvasProjectRecord | null {
  const id = normalizeId(project.id)
  const name = String(project.name || '')
  if (!id || !name.trim()) return null
  return id === project.id && name === project.name ? project : { id, name }
}

export function normalizeProjectCanvasOwnerType(
  value: unknown,
): ProjectCanvasOwnerType | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized === 'chapter' || normalized === 'shot' || normalized === 'project' ? normalized : null
}

function getExpectedOwner(input: {
  projectId: string
  ownerContext?: ProjectCanvasOwnerContext | null
}): ProjectCanvasOwnerContext {
  return input.ownerContext || { ownerType: 'project', ownerId: input.projectId }
}

export function isCurrentFlowScopedToProjectTarget(input: {
  currentFlow: ProjectCanvasCurrentFlowSnapshot
  projectId: string
  ownerContext?: ProjectCanvasOwnerContext | null
}): boolean {
  if (input.currentFlow.source !== 'server') return false
  if (!normalizeId(input.currentFlow.id)) return false

  const currentOwnerType = normalizeProjectCanvasOwnerType(input.currentFlow.ownerType)
  const currentOwnerId = normalizeId(input.currentFlow.ownerId)
  if (!currentOwnerType || !currentOwnerId) return false

  const expectedOwner = getExpectedOwner(input)
  return currentOwnerType === expectedOwner.ownerType && currentOwnerId === expectedOwner.ownerId
}

export function resolveStudioProjectSelection(input: {
  projects: readonly ProjectCanvasProjectRecord[]
  requestedProjectId?: string | null
  existingProject?: ProjectCanvasCurrentProjectSnapshot | null
}): ProjectCanvasProjectRecord | null {
  const projects = input.projects
    .map((project) => normalizeProjectRecord(project))
    .filter((project): project is ProjectCanvasProjectRecord => project !== null)
  const requestedProjectId = normalizeId(input.requestedProjectId)
  if (requestedProjectId) {
    const requestedProject = projects.find((project) => project.id === requestedProjectId)
    if (requestedProject) return requestedProject
  }

  const existingProjectId = normalizeId(input.existingProject?.id)
  if (existingProjectId) {
    const existingProject = projects.find((project) => project.id === existingProjectId)
    if (existingProject) return existingProject
  }

  return projects[0] || null
}

export function resolveRequestedProjectFlowIdForLoad(input: {
  requestedFlowId?: string | null
  projectId: string
  currentFlow?: ProjectCanvasCurrentFlowSnapshot | null
  ownerContext?: ProjectCanvasOwnerContext | null
}): string {
  const requestedFlowId = normalizeId(input.requestedFlowId)
  if (!requestedFlowId) return ''

  const currentFlow = input.currentFlow
  if (!currentFlow || currentFlow.source !== 'server') return requestedFlowId
  if (normalizeId(currentFlow.id) !== requestedFlowId) return requestedFlowId

  return isCurrentFlowScopedToProjectTarget({
    currentFlow,
    projectId: input.projectId,
    ownerContext: input.ownerContext,
  })
    ? requestedFlowId
    : ''
}

export function hasProjectFlowContent(flow: FlowDto): boolean {
  const nodes = Array.isArray(flow.data?.nodes) ? flow.data.nodes : []
  const edges = Array.isArray(flow.data?.edges) ? flow.data.edges : []
  return nodes.length > 0 || edges.length > 0
}

export function sortProjectFlowsByEntryPriority(flows: FlowDto[]): FlowDto[] {
  return [...flows].sort((left, right) => {
    const leftHasContent = hasProjectFlowContent(left) ? 1 : 0
    const rightHasContent = hasProjectFlowContent(right) ? 1 : 0
    if (leftHasContent !== rightHasContent) return rightHasContent - leftHasContent
    return toTimestamp(right.updatedAt || right.createdAt) - toTimestamp(left.updatedAt || left.createdAt)
  })
}

export function pickProjectEntryFlow(flows: FlowDto[], preferredFlowId?: string): FlowDto | null {
  const normalizedPreferredFlowId = String(preferredFlowId || '').trim()
  if (normalizedPreferredFlowId) {
    const preferred = flows.find((flow) => flow.id === normalizedPreferredFlowId)
    if (preferred) return preferred
  }
  return sortProjectFlowsByEntryPriority(flows)[0] || null
}

export function isRequestedProjectFlowMissing(flows: FlowDto[], preferredFlowId?: string): boolean {
  const normalizedPreferredFlowId = String(preferredFlowId || '').trim()
  if (!normalizedPreferredFlowId) return false
  return !flows.some((flow) => flow.id === normalizedPreferredFlowId)
}
