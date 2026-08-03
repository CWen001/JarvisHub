import type { VerticalExtensionDescriptor } from './productHost'

export const watchExtension = {
  id: 'watch-design',
  brand: {
    name: 'Watch Design Studio',
    mark: 'W',
    accentColor: '#4967dc',
  },
  skillRoot: 'apps/agents-cli/skills/watch-design-kernel',
} as const satisfies VerticalExtensionDescriptor
