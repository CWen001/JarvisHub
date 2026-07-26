import { createTheme, type MantineColorScheme } from '@mantine/core'

export const canvasDesignTokens = {
  radius: {
    sharp: '0px',
    field: '6px',
    panel: '10px',
    modal: '14px',
    pill: '999px'
  },
  spacing: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
    10: '40px'
  },
  fontSize: {
    micro: '11px',
    caption: '12px',
    bodySm: '13px',
    body: '14px',
    title: '16px',
    h2: '20px',
    h1: '24px'
  },
  lineHeight: {
    micro: '14px',
    caption: '16px',
    bodySm: '18px',
    body: '20px',
    title: '22px',
    h2: '26px',
    h1: '30px'
  },
  shadow: {
    subtle: '0 10px 24px rgba(0, 0, 0, 0.2)',
    panel: '0 18px 40px rgba(0, 0, 0, 0.3)',
    modal: '0 28px 64px rgba(0, 0, 0, 0.45)'
  },
  dark: {
    appBg: '#181818',
    appBgStrong: '#181818',
    surface: '#1c1c1e',
    surfaceRaised: '#2c2c2e',
    surfaceSubtle: '#3a3a3c',
    surfaceInline: 'rgba(255, 255, 255, 0.05)',
    borderSubtle: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(51, 156, 255, 0.4)',
    textPrimary: '#ffffff',
    textSecondary: 'rgba(235, 235, 245, 0.6)',
    textTertiary: 'rgba(235, 235, 245, 0.3)',
    accentBlue: '#339CFF',
    accentCyan: '#339CFF',
    success: '#30D158',
    warning: '#FFD60A',
    danger: '#FF453A',
    info: '#339CFF'
  }
} as const

const sansSerifFontFamily = [
  'Inter',
  'ui-sans-serif',
  'system-ui',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'sans-serif'
].join(', ')

const monospaceFontFamily = [
  'ui-monospace',
  '"SFMono-Regular"',
  'Menlo',
  'Monaco',
  'Consolas',
  'monospace'
].join(', ')

export function buildCanvasTheme(colorScheme: MantineColorScheme) {
  const isDark = colorScheme === 'dark'

  return createTheme({
    focusRing: 'auto',
    cursorType: 'pointer',
    defaultRadius: 'xs',
    primaryColor: isDark ? 'gray' : 'dark',
    primaryShade: { light: 6, dark: 4 },
    fontFamily: sansSerifFontFamily,
    fontFamilyMonospace: monospaceFontFamily,
    radius: {
      xs: canvasDesignTokens.radius.field,
      sm: canvasDesignTokens.radius.panel,
      md: canvasDesignTokens.radius.modal,
      lg: canvasDesignTokens.radius.modal,
      xl: canvasDesignTokens.radius.modal
    },
    spacing: {
      xs: canvasDesignTokens.spacing[2],
      sm: canvasDesignTokens.spacing[3],
      md: canvasDesignTokens.spacing[4],
      lg: canvasDesignTokens.spacing[5],
      xl: canvasDesignTokens.spacing[6]
    },
    fontSizes: {
      xs: canvasDesignTokens.fontSize.micro,
      sm: canvasDesignTokens.fontSize.caption,
      md: canvasDesignTokens.fontSize.bodySm,
      lg: canvasDesignTokens.fontSize.body,
      xl: canvasDesignTokens.fontSize.title
    },
    lineHeights: {
      xs: canvasDesignTokens.lineHeight.micro,
      sm: canvasDesignTokens.lineHeight.caption,
      md: canvasDesignTokens.lineHeight.bodySm,
      lg: canvasDesignTokens.lineHeight.body,
      xl: canvasDesignTokens.lineHeight.title
    },
    headings: {
      fontFamily: sansSerifFontFamily,
      fontWeight: '700',
      textWrap: 'balance',
      sizes: {
        h1: {
          fontSize: canvasDesignTokens.fontSize.h1,
          lineHeight: canvasDesignTokens.lineHeight.h1
        },
        h2: {
          fontSize: canvasDesignTokens.fontSize.h2,
          lineHeight: canvasDesignTokens.lineHeight.h2,
          fontWeight: '650'
        },
        h3: {
          fontSize: canvasDesignTokens.fontSize.title,
          lineHeight: canvasDesignTokens.lineHeight.title,
          fontWeight: '650'
        },
        h4: {
          fontSize: canvasDesignTokens.fontSize.body,
          lineHeight: canvasDesignTokens.lineHeight.body,
          fontWeight: '650'
        },
        h5: {
          fontSize: canvasDesignTokens.fontSize.bodySm,
          lineHeight: canvasDesignTokens.lineHeight.bodySm,
          fontWeight: '600'
        },
        h6: {
          fontSize: canvasDesignTokens.fontSize.caption,
          lineHeight: canvasDesignTokens.lineHeight.caption,
          fontWeight: '600'
        }
      }
    },
    shadows: {
      xs: canvasDesignTokens.shadow.subtle,
      sm: canvasDesignTokens.shadow.subtle,
      md: canvasDesignTokens.shadow.panel,
      lg: canvasDesignTokens.shadow.modal,
      xl: canvasDesignTokens.shadow.modal
    },
    other: {
      design: canvasDesignTokens
    },
    components: {
      Button: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        },
        styles: {
          root: {
            fontWeight: 600,
            letterSpacing: '0.01em'
          }
        }
      },
      ActionIcon: {
        defaultProps: {
          radius: 'xs',
          size: 'md',
          variant: 'subtle'
        }
      },
      TextInput: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        }
      },
      PasswordInput: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        }
      },
      NumberInput: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        }
      },
      Textarea: {
        defaultProps: {
          radius: 'xs',
          size: 'sm',
          autosize: true,
          minRows: 3
        }
      },
      Select: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        }
      },
      MultiSelect: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        }
      },
      Card: {
        defaultProps: {
          radius: 'sm',
          padding: 'md'
        },
        styles: {
          root: isDark ? {
            backgroundColor: canvasDesignTokens.dark.surface,
            borderColor: canvasDesignTokens.dark.borderSubtle,
            boxShadow: canvasDesignTokens.shadow.panel,
          } : undefined
        }
      },
      Paper: {
        defaultProps: {
          radius: 'sm'
        },
        styles: {
          root: isDark ? {
            backgroundColor: canvasDesignTokens.dark.surface,
            borderColor: canvasDesignTokens.dark.borderSubtle,
          } : undefined
        }
      },
      Modal: {
        defaultProps: {
          radius: 'md',
          shadow: 'lg'
        },
        styles: {
          content: isDark ? {
            backgroundColor: canvasDesignTokens.dark.surface,
            border: `1px solid ${canvasDesignTokens.dark.borderSubtle}`,
          } : undefined,
          header: isDark ? {
            backgroundColor: canvasDesignTokens.dark.surface,
          } : undefined
        }
      },
      Drawer: {
        defaultProps: {
          radius: 'sm',
          shadow: 'lg'
        }
      },
      Menu: {
        defaultProps: {
          radius: 'sm',
          shadow: 'md'
        }
      },
      Popover: {
        defaultProps: {
          radius: 'sm',
          shadow: 'md'
        },
        styles: {
          dropdown: isDark ? {
            backgroundColor: canvasDesignTokens.dark.surfaceRaised,
            borderColor: canvasDesignTokens.dark.borderSubtle,
          } : undefined
        }
      },
      Tabs: {
        defaultProps: {
          radius: 'sm'
        }
      },
      Badge: {
        defaultProps: {
          radius: 999
        },
        styles: {
          root: {
            fontWeight: 600,
            letterSpacing: '0.02em'
          }
        }
      },
      Tooltip: {
        defaultProps: {
          openDelay: 140
        },
        styles: {
          tooltip: isDark ? {
            backgroundColor: canvasDesignTokens.dark.surfaceRaised,
            border: `1px solid ${canvasDesignTokens.dark.borderSubtle}`,
            color: canvasDesignTokens.dark.textPrimary,
          } : undefined
        }
      }
    }
  })
}
