import type { VerticalExtensionDescriptor } from '../productHost'

/** Contract-test Adapter only. It is not imported by the production Extension entry. */
export const fixtureExtension = {
  id: 'fixture-design',
  brand: {
    name: 'Fixture Design Lab',
    mark: 'F',
    accentColor: '#7c3aed',
  },
  skillRoot: 'test-fixtures/skills/fixture-design-kernel',
} as const satisfies VerticalExtensionDescriptor
