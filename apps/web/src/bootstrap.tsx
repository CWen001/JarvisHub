import React from 'react'
import { createRoot } from 'react-dom/client'
import {
  MantineProvider,
  MantineThemeProvider,
  localStorageColorSchemeManager,
  useMantineColorScheme,
  type MantineColorScheme,
} from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ModalsProvider } from '@mantine/modals'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './dark.css'
import './light.css'
import { installAuth401Interceptor } from './auth/fetch401Interceptor'
import { buildCanvasTheme } from './theme/canvasTheme'

const COLOR_SCHEME_STORAGE_KEY = 'canvas-color-scheme'
const DEFAULT_COLOR_SCHEME: MantineColorScheme = 'dark'
const colorSchemeManager = localStorageColorSchemeManager({ key: COLOR_SCHEME_STORAGE_KEY })

function primeColorSchemeAttribute(): void {
  try {
    const stored = colorSchemeManager.get(DEFAULT_COLOR_SCHEME)
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
    const computed = stored === 'auto' ? (prefersDark ? 'dark' : 'light') : stored
    document.documentElement.setAttribute('data-mantine-color-scheme', computed)
  } catch {
    document.documentElement.setAttribute('data-mantine-color-scheme', DEFAULT_COLOR_SCHEME)
  }
}

function DynamicThemeProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { colorScheme } = useMantineColorScheme()
  const theme = React.useMemo(() => buildCanvasTheme(colorScheme), [colorScheme])
  return <MantineThemeProvider theme={theme}>{children}</MantineThemeProvider>
}

export function bootstrapJarvisApp(app: React.ReactNode): void {
  primeColorSchemeAttribute()
  installAuth401Interceptor()
  const container = document.getElementById('root')
  if (!container) throw new Error('Root container not found')
  createRoot(container).render(
    <React.StrictMode>
      <MantineProvider colorSchemeManager={colorSchemeManager} defaultColorScheme={DEFAULT_COLOR_SCHEME}>
        <DynamicThemeProvider>
          <ModalsProvider>
            <Notifications position="top-right" zIndex={2000} />
            {app}
          </ModalsProvider>
        </DynamicThemeProvider>
      </MantineProvider>
    </React.StrictMode>,
  )
}
