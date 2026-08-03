export type ProductNavigationSession = Readonly<{
  id: string
  title: string
  updatedAt: number
}>

export type ProductNavigationProject = Readonly<{
  id: string
  name: string
  sessions: readonly ProductNavigationSession[]
  latestSessionId: string | null
}>

export function buildProjectSessionNavigation(input: Readonly<{
  projects: readonly Readonly<{ id: string; name: string; updatedAt: string }>[]
  sessionsByProject: Readonly<Record<string, readonly ProductNavigationSession[]>>
}>): ProductNavigationProject[] {
  return input.projects.map((project) => {
    const sessions = [...(input.sessionsByProject[project.id] ?? [])]
      .sort((left, right) => right.updatedAt - left.updatedAt)
    return {
      id: project.id,
      name: project.name,
      sessions,
      latestSessionId: sessions[0]?.id ?? null,
    }
  })
}
