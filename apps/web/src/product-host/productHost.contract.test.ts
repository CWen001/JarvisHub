import { describe, expect, it, vi } from 'vitest'
import {
  installVerticalProductHost,
  type NativeSkillDiscovery,
  type VerticalExtensionDescriptor,
} from './productHost'
import { installedVerticalExtension } from './installedExtension'
import { fixtureExtension } from './testing/fixtureExtension'

function discoveryWith(...skillKeys: string[]): NativeSkillDiscovery {
  return async () => ({
    skills: skillKeys.map((key) => ({ key, name: key })),
    loadErrors: [],
  })
}

describe('Vertical Product Host contract', () => {
  const brand = { name: 'Broken', mark: 'B', accentColor: '#123456' }

  it.each([
    [{ brand, skillRoot: 'skills/example' }, 'id'],
    [{ id: 'broken', skillRoot: 'skills/example' }, 'brand'],
    [{ id: 'broken', brand }, 'skillRoot'],
    [{ id: 'Not Stable', brand, skillRoot: 'skills/example' }, 'id'],
    [{ id: 'broken', brand: { ...brand, name: '' }, skillRoot: 'skills/example' }, 'brand.name'],
    [{ id: 'broken', brand: { ...brand, mark: '' }, skillRoot: 'skills/example' }, 'brand.mark'],
    [{ id: 'broken', brand: { ...brand, accentColor: 'blue' }, skillRoot: 'skills/example' }, 'brand.accentColor'],
    [{ id: 'broken', brand, skillRoot: '../example' }, 'skillRoot'],
    [{ id: 'broken', brand, skillRoot: 'skills/example', callback: () => undefined }, 'only id, brand, and skillRoot'],
  ])('fails before native discovery for invalid descriptor %o', async (descriptor, expectedMessage) => {
    const discoverSkills = vi.fn(discoveryWith('example'))

    expect(() => installVerticalProductHost(
      descriptor as unknown as VerticalExtensionDescriptor,
      { discoverSkills },
    )).toThrow(expectedMessage)
    expect(discoverSkills).not.toHaveBeenCalled()
  })

  it('installs the Watch brand and resolves its Skill through native discovery', async () => {
    const installation = await installVerticalProductHost(installedVerticalExtension, {
      discoverSkills: discoveryWith('watch-design-kernel'),
    })

    expect(installation).toEqual({
      extensionId: 'watch-design',
      brand: { name: 'Watch Design Studio', mark: 'W', accentColor: '#29463f' },
      skill: { key: 'watch-design-kernel', name: 'watch-design-kernel' },
    })
  })

  it('uses the same Host contract for the non-production Fixture Extension', async () => {
    const installation = await installVerticalProductHost(fixtureExtension, {
      discoverSkills: discoveryWith('fixture-design-kernel'),
    })

    expect(installation).toEqual({
      extensionId: 'fixture-design',
      brand: { name: 'Fixture Design Lab', mark: 'F', accentColor: '#7c3aed' },
      skill: { key: 'fixture-design-kernel', name: 'fixture-design-kernel' },
    })
  })

  it('fails explicitly when the Extension Skill is absent or native discovery has load errors', async () => {
    await expect(installVerticalProductHost(installedVerticalExtension, {
      discoverSkills: discoveryWith('some-other-skill'),
    })).rejects.toThrow('watch-design-kernel')

    await expect(installVerticalProductHost(installedVerticalExtension, {
      discoverSkills: async () => ({ skills: [], loadErrors: ['invalid SKILL.md'] }),
    })).rejects.toThrow('invalid SKILL.md')
  })
})
