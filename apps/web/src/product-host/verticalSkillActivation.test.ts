import { describe, expect, it } from 'vitest'
import { resolveLoadedVerticalSkill } from './verticalSkillActivation'

const skills = [
  { id: 'watch', key: 'watch-design-kernel', name: 'Watch Design Kernel' },
  { id: 'tablet', key: 'tablet-design-kernel', name: 'Tablet Design Kernel' },
  { id: 'research', key: 'research', name: 'Research' },
]
const startedAt = '2026-08-04T00:00:00Z'

describe('vertical Skill activation', () => {
  it('projects a completed native load of a registered vertical', () => {
    expect(resolveLoadedVerticalSkill({
      toolCallId: 'tool-1',
      toolName: 'Skill',
      phase: 'completed',
      status: 'succeeded',
      startedAt,
      input: { skill: 'tablet-design-kernel' },
    }, skills)).toEqual(skills[1])
  })

  it('ignores ordinary Skills and unsuccessful or incomplete loads', () => {
    expect(resolveLoadedVerticalSkill({
      toolCallId: 'tool-1',
      toolName: 'Skill',
      phase: 'completed',
      status: 'succeeded',
      startedAt,
      input: { skill: 'research' },
    }, skills)).toBeNull()
    expect(resolveLoadedVerticalSkill({
      toolCallId: 'tool-2',
      toolName: 'Skill',
      phase: 'started',
      startedAt,
      input: { skill: 'watch-design-kernel' },
    }, skills)).toBeNull()
    expect(resolveLoadedVerticalSkill({
      toolCallId: 'tool-3',
      toolName: 'Skill',
      phase: 'completed',
      status: 'failed',
      startedAt,
      input: { skill: 'watch-design-kernel' },
    }, skills)).toBeNull()
  })
})
