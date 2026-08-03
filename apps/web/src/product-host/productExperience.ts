import type { VerticalExtensionDescriptor, VerticalBrand } from './productHost'

type NativeProjectSummary = Readonly<{
  id: string
  name: string
  updatedAt: string
}>

type NativeSessionSummary = Readonly<{
  id: string
  updatedAt: number
}>

export type ProductEntry = Readonly<{
  surface: 'chat'
  brand: VerticalBrand
  projectId: string | null
  sessionId: string | null
  needsNativeProjectCreation: boolean
}>

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function resolveProductEntry(input: Readonly<{
  extension: VerticalExtensionDescriptor
  projects: readonly NativeProjectSummary[]
  sessionsByProject: Readonly<Record<string, readonly NativeSessionSummary[]>>
}>): ProductEntry {
  const project = [...input.projects]
    .filter((item) => item.id.trim())
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))[0] ?? null
  const session = project
    ? [...(input.sessionsByProject[project.id] ?? [])]
      .filter((item) => item.id.trim())
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
    : null

  return Object.freeze({
    surface: 'chat',
    brand: input.extension.brand,
    projectId: project?.id ?? null,
    sessionId: session?.id ?? null,
    needsNativeProjectCreation: project === null,
  })
}
