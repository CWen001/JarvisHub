import { describe, expect, it, vi } from 'vitest'
import {
  installVerticalProductHost,
  isRegisteredVerticalSkillKey,
  selectRegisteredVerticalSkills,
  type NativeSkillDiscovery,
} from './productHost'
import { installedVerticalSkills } from './installedVerticalSkills'

function discoveryWith(...skillKeys: string[]): NativeSkillDiscovery {
  return async () => ({
    skills: skillKeys.map((key) => ({ key, name: key })),
    loadErrors: [],
  })
}

describe('Vertical Product Host contract', () => {
  it.each([
    [[], 'at least one'],
    [['Not Stable'], 'lowercase kebab-case'],
    [['watch-design-kernel', 'watch-design-kernel'], 'duplicate'],
  ])('fails before native discovery for invalid registry %o', async (registry, expectedMessage) => {
    const discoverSkills = vi.fn(discoveryWith('watch-design-kernel'))

    expect(() => installVerticalProductHost(registry, { discoverSkills })).toThrow(expectedMessage)
    expect(discoverSkills).not.toHaveBeenCalled()
  })

  it('installs all registered verticals through native Skill discovery', async () => {
    const installation = await installVerticalProductHost(installedVerticalSkills, {
      discoverSkills: discoveryWith('tablet-design-kernel', 'watch-design-kernel', 'research'),
    })

    expect(installation).toEqual({
      skillKeys: ['watch-design-kernel', 'tablet-design-kernel'],
      skills: [
        { key: 'watch-design-kernel', name: 'watch-design-kernel' },
        { key: 'tablet-design-kernel', name: 'tablet-design-kernel' },
      ],
    })
  })

  it('filters vertical Skills in registry order without treating ordinary Skills as verticals', () => {
    const skills = [
      { key: 'research', name: 'Research' },
      { key: 'tablet-design-kernel', name: 'Tablet Design Kernel' },
      { key: 'watch-design-kernel', name: 'Watch Design Kernel' },
    ]
    expect(selectRegisteredVerticalSkills(skills, installedVerticalSkills)).toEqual([
      skills[2],
      skills[1],
    ])
    expect(isRegisteredVerticalSkillKey('research', installedVerticalSkills)).toBe(false)
    expect(isRegisteredVerticalSkillKey('tablet-design-kernel', installedVerticalSkills)).toBe(true)
  })

  it('fails explicitly when a registered Skill is absent or discovery has load errors', async () => {
    await expect(installVerticalProductHost(installedVerticalSkills, {
      discoverSkills: discoveryWith('watch-design-kernel'),
    })).rejects.toThrow('tablet-design-kernel')

    await expect(installVerticalProductHost(installedVerticalSkills, {
      discoverSkills: async () => ({ skills: [], loadErrors: ['invalid SKILL.md'] }),
    })).rejects.toThrow('invalid SKILL.md')
  })
})
