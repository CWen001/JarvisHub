import { describe, expect, it, vi } from 'vitest'
import { createNativeChatWorkspaceCommandExecutor } from './nativeChatWorkspaceAdapter'

function authority() {
  return {
    setDraft: vi.fn(),
    submit: vi.fn(async () => {}),
    interrupt: vi.fn(),
    uploadReferences: vi.fn(async () => {}),
    addReference: vi.fn(),
    removeReference: vi.fn(),
    answerDecision: vi.fn(async () => {}),
    selectSkill: vi.fn(),
    createSession: vi.fn(),
    selectSession: vi.fn(),
  }
}

describe('Native Chat Workspace Adapter', () => {
  it('delegates Product commands to mounted Native Chat Authority', async () => {
    const native = authority()
    const execute = createNativeChatWorkspaceCommandExecutor(native)

    await execute({ type: 'draft.set', text: '设计一款平板' })
    await execute({ type: 'request.submit' })
    await execute({ type: 'request.interrupt' })
    await execute({ type: 'decision.answer', option: '按此策略生成' })
    await execute({ type: 'skill.select', skill: { id: 'tablet', key: 'tablet-design-kernel', name: 'Tablet' } })

    expect(native.setDraft).toHaveBeenCalledWith('设计一款平板')
    expect(native.submit).toHaveBeenCalledOnce()
    expect(native.interrupt).toHaveBeenCalledOnce()
    expect(native.answerDecision).toHaveBeenCalledWith('按此策略生成')
    expect(native.selectSkill).toHaveBeenCalledWith({ id: 'tablet', key: 'tablet-design-kernel', name: 'Tablet' })
  })

  it('keeps reference and Session behavior behind the Product-owned Adapter', async () => {
    const native = authority()
    const execute = createNativeChatWorkspaceCommandExecutor(native)
    const reference = { kind: 'image' as const, url: 'https://example.com/ref.png', label: '参考图' }

    await execute({ type: 'reference.add', reference, continuation: 'modify' })
    await execute({ type: 'reference.remove', url: reference.url })
    await execute({ type: 'references.upload', files: [] })
    await execute({ type: 'session.create', projectId: 'project-1' })
    await execute({ type: 'session.select', projectId: 'project-1', sessionId: 'session-1' })

    expect(native.addReference).toHaveBeenCalledWith(reference, 'modify')
    expect(native.removeReference).toHaveBeenCalledWith(reference.url)
    expect(native.uploadReferences).toHaveBeenCalledWith([])
    expect(native.createSession).toHaveBeenCalledWith('project-1')
    expect(native.selectSession).toHaveBeenCalledWith('project-1', 'session-1')
  })
})
