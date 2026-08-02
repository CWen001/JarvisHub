import type { VerticalExtensionDescriptor } from './productHost'

export const watchExtension = {
  id: 'watch-design',
  brand: {
    name: 'Watch Design Studio',
  },
  skillRoot: 'apps/agents-cli/skills/watch-design-kernel',
} as const satisfies VerticalExtensionDescriptor
