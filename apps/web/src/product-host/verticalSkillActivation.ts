import type { AgentsChatToolStreamPayload } from '../api/server'
import { installedVerticalSkills } from './installedVerticalSkills'
import { isRegisteredVerticalSkillKey } from './productHost'

export function resolveLoadedVerticalSkill<T extends Readonly<{ key: string }>>(
  payload: AgentsChatToolStreamPayload,
  availableSkills: readonly T[],
): T | null {
  if (String(payload.toolName || '').trim() !== 'Skill') return null
  if (payload.phase !== 'completed') return null
  if (payload.status && payload.status !== 'succeeded') return null
  const input = payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)
    ? payload.input as Record<string, unknown>
    : null
  const key = typeof input?.skill === 'string' ? input.skill.trim() : ''
  if (!isRegisteredVerticalSkillKey(key, installedVerticalSkills)) return null
  return availableSkills.find((skill) => String(skill.key || '').trim() === key) ?? null
}
