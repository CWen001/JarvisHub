import { listRuntimeAgentSkills } from '../api/server'

export type NativeSkillIdentity = Readonly<{
  key: string
  name: string
}>

export type NativeSkillDiscoveryResult = Readonly<{
  skills: readonly NativeSkillIdentity[]
  loadErrors: readonly string[]
}>

export type NativeSkillDiscovery = () => Promise<NativeSkillDiscoveryResult>

export type VerticalSkillRegistry = Readonly<{
  skillKeys: readonly string[]
  skills: readonly NativeSkillIdentity[]
}>

type VerticalProductHostDependencies = Readonly<{
  discoverSkills?: NativeSkillDiscovery
}>

const STABLE_SKILL_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function normalizeVerticalSkillKeys(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Invalid Vertical Skill Registry: expected at least one native Skill key')
  }
  const keys = value.map((item) => typeof item === 'string' ? item.trim() : '')
  if (keys.some((key) => !STABLE_SKILL_KEY_PATTERN.test(key))) {
    throw new Error('Invalid Vertical Skill Registry: keys must be lowercase kebab-case')
  }
  if (new Set(keys).size !== keys.length) {
    throw new Error('Invalid Vertical Skill Registry: duplicate Skill key')
  }
  return Object.freeze(keys)
}

async function discoverNativeSkills(): Promise<NativeSkillDiscoveryResult> {
  const result = await listRuntimeAgentSkills()
  return {
    skills: result.skills.map(({ key, name }) => ({ key, name })),
    loadErrors: result.loadErrors,
  }
}

export function installVerticalProductHost(
  skillKeys: readonly string[],
  dependencies: VerticalProductHostDependencies = {},
): Promise<VerticalSkillRegistry> {
  const requiredKeys = normalizeVerticalSkillKeys(skillKeys)
  const discoverSkills = dependencies.discoverSkills ?? discoverNativeSkills

  return discoverSkills().then((result) => {
    if (result.loadErrors.length > 0) {
      throw new Error(`Native Jarvis Skill discovery failed: ${result.loadErrors.join('; ')}`)
    }
    const byKey = new Map(result.skills.map((skill) => [skill.key, skill]))
    const skills = requiredKeys.map((key) => {
      const skill = byKey.get(key)
      if (!skill) {
        throw new Error(`Vertical Product Host requires native Jarvis Skill "${key}", but it was not discovered`)
      }
      return Object.freeze({ key: skill.key, name: skill.name })
    })
    return Object.freeze({
      skillKeys: requiredKeys,
      skills: Object.freeze(skills),
    })
  })
}

export function isRegisteredVerticalSkillKey(
  skillKey: string | null | undefined,
  registry: readonly string[],
): boolean {
  const normalized = String(skillKey || '').trim()
  return Boolean(normalized && registry.includes(normalized))
}

export function selectRegisteredVerticalSkills<T extends Readonly<{ key: string }>>(
  skills: readonly T[],
  registry: readonly string[],
): T[] {
  const byKey = new Map(skills.map((skill) => [String(skill.key || '').trim(), skill]))
  return registry.flatMap((key) => {
    const skill = byKey.get(key)
    return skill ? [skill] : []
  })
}
