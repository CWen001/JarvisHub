import React from 'react'
import { createRoot } from 'react-dom/client'
import {
  MantineProvider,
  MantineThemeProvider,
} from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ModalsProvider } from '@mantine/modals'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './dark.css'
import './light.css'
import { installAuth401Interceptor } from './auth/fetch401Interceptor'
import { buildCanvasTheme } from './theme/canvasTheme'

function primeLightAppearance(): void {
  document.documentElement.setAttribute('data-mantine-color-scheme', 'light')
  document.documentElement.style.colorScheme = 'light'
}

function LightThemeProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const theme = React.useMemo(() => buildCanvasTheme('light'), [])
  return <MantineThemeProvider theme={theme}>{children}</MantineThemeProvider>
}

export function bootstrapJarvisApp(app: React.ReactNode): void {
  primeLightAppearance()
  installAuth401Interceptor()
  const container = document.getElementById('root')
  if (!container) throw new Error('Root container not found')
  createRoot(container).render(
    <React.StrictMode>
      <MantineProvider defaultColorScheme="light" forceColorScheme="light">
        <LightThemeProvider>
          <ModalsProvider>
            <Notifications position="top-right" zIndex={2000} />
            {app}
          </ModalsProvider>
        </LightThemeProvider>
      </MantineProvider>
    </React.StrictMode>,
  )
}
