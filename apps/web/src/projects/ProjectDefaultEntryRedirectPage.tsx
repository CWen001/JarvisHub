import React from 'react'
import { AppShell, Badge, Group } from '@mantine/core'
import { buildStudioUrl } from '../utils/appRoutes'
import { spaReplace } from '../utils/spaNavigate'

export default function ProjectDefaultEntryRedirectPage({ projectId }: { projectId: string }): JSX.Element {
  React.useEffect(() => {
    let timer: number | null = null
    const normalizedProjectId = String(projectId || '').trim()
    timer = window.setTimeout(() => {
      if (!normalizedProjectId) {
        spaReplace('/projects')
        return
      }
      spaReplace(buildStudioUrl({ projectId: normalizedProjectId }))
    }, 0)
    return () => {
      if (timer != null) window.clearTimeout(timer)
    }
  }, [projectId])

  return (
    <AppShell padding="md">
      <AppShell.Main>
        <Group justify="center" align="center" style={{ minHeight: '100vh' }}>
          <Badge variant="light" color="gray">正在打开项目画布…</Badge>
        </Group>
      </AppShell.Main>
    </AppShell>
  )
}
