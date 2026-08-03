import { listRuntimeAgentSkills } from '../api/server'

export type VerticalBrand = Readonly<{
  name: string
  mark: string
  accentColor: string
}>

export type VerticalExtensionDescriptor = Readonly<{
  id: string
  brand: VerticalBrand
  skillRoot: string
}>

export type NativeSkillIdentity = Readonly<{
  key: string
  name: string
}>

export type NativeSkillDiscoveryResult = Readonly<{
  skills: readonly NativeSkillIdentity[]
  loadErrors: readonly string[]
}>

export type NativeSkillDiscovery = () => Promise<NativeSkillDiscoveryResult>

export type VerticalProductInstallation = Readonly<{
  extensionId: string
  brand: VerticalBrand
  skill: NativeSkillIdentity
}>

type VerticalProductHostDependencies = Readonly<{
  discoverSkills?: NativeSkillDiscovery
}>

const DESCRIPTOR_FIELDS = ['brand', 'id', 'skillRoot'] as const
const BRAND_FIELDS = ['accentColor', 'mark', 'name'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SKILL_ROOT_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function descriptorError(message: string): Error {
  return new Error(`Invalid Vertical Extension Descriptor: ${message}`)
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw descriptorError('descriptor must be an object')
  }
}

export function validateVerticalExtensionDescriptor(
  value: unknown,
): VerticalExtensionDescriptor {
  assertRecord(value)

  const fields = Object.keys(value).sort()
  if (
    fields.length !== DESCRIPTOR_FIELDS.length
    || fields.some((field, index) => field !== DESCRIPTOR_FIELDS[index])
  ) {
    throw descriptorError('descriptor may contain only id, brand, and skillRoot')
  }

  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!STABLE_ID_PATTERN.test(id)) {
    throw descriptorError('id must be a stable lowercase kebab-case identifier')
  }

  assertRecord(value.brand)
  const brandFields = Object.keys(value.brand).sort()
  if (
    brandFields.length !== BRAND_FIELDS.length
    || brandFields.some((field, index) => field !== BRAND_FIELDS[index])
  ) {
    throw descriptorError('brand must contain exactly name, mark, and accentColor')
  }
  const brandName = typeof value.brand.name === 'string' ? value.brand.name.trim() : ''
  if (!brandName) throw descriptorError('brand.name must be a non-empty string')
  const brandMark = typeof value.brand.mark === 'string' ? value.brand.mark.trim() : ''
  if (!brandMark || brandMark.length > 4) {
    throw descriptorError('brand.mark must contain 1–4 visible characters')
  }
  const accentColor = typeof value.brand.accentColor === 'string'
    ? value.brand.accentColor.trim().toLowerCase()
    : ''
  if (!/^#[a-f0-9]{6}$/.test(accentColor)) {
    throw descriptorError('brand.accentColor must be a six-digit hex color')
  }

  const skillRoot = typeof value.skillRoot === 'string' ? value.skillRoot.trim() : ''
  const skillRootSegments = skillRoot.split('/')
  if (
    skillRootSegments.length < 2
    || skillRoot.startsWith('/')
    || skillRoot.includes('\\')
    || skillRootSegments.some((segment) => !SKILL_ROOT_SEGMENT_PATTERN.test(segment))
  ) {
    throw descriptorError('skillRoot must be a repository-relative lowercase kebab-case path')
  }

  return Object.freeze({
    id,
    brand: Object.freeze({
      name: brandName,
      mark: brandMark,
      accentColor,
    }),
    skillRoot,
  })
}

function skillKeyFromRoot(skillRoot: string): string {
  return skillRoot.slice(skillRoot.lastIndexOf('/') + 1)
}

async function discoverNativeSkills(): Promise<NativeSkillDiscoveryResult> {
  const result = await listRuntimeAgentSkills()
  return {
    skills: result.skills.map(({ key, name }) => ({ key, name })),
    loadErrors: result.loadErrors,
  }
}

export function installVerticalProductHost(
  descriptor: VerticalExtensionDescriptor,
  dependencies: VerticalProductHostDependencies = {},
): Promise<VerticalProductInstallation> {
  const extension = validateVerticalExtensionDescriptor(descriptor)
  const discoverSkills = dependencies.discoverSkills ?? discoverNativeSkills

  return discoverSkills().then((result) => {
    if (result.loadErrors.length > 0) {
      throw new Error(`Native Jarvis Skill discovery failed: ${result.loadErrors.join('; ')}`)
    }

    const expectedSkillKey = skillKeyFromRoot(extension.skillRoot)
    const skill = result.skills.find((candidate) => candidate.key === expectedSkillKey)
    if (!skill) {
      throw new Error(
        `Vertical Extension "${extension.id}" requires native Jarvis Skill "${expectedSkillKey}", but it was not discovered`,
      )
    }

    return Object.freeze({
      extensionId: extension.id,
      brand: extension.brand,
      skill: Object.freeze({ key: skill.key, name: skill.name }),
    })
  })
}
