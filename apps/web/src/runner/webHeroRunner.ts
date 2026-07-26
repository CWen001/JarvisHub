import type { Edge, Node } from '@xyflow/react'

type NodeRunStatus = 'idle' | 'queued' | 'running' | 'success' | 'error' | 'canceled'

type Getter = () => {
  nodes?: Node[]
  edges?: Edge[]
  setNodeStatus?: (id: string, status: NodeRunStatus, patch?: Record<string, unknown>) => void
  appendLog?: (id: string, line: string) => void
  endRunToken?: (id: string) => void
}

type Setter = (fn: (state: unknown) => unknown) => void

const WEBHERO_TRANSACTIONAL_MERGE_REQUIRED =
  'WebHero 不再支持节点 Runner 直接生成或拼接最终代码。请在 AI Chat 中继续当前 WebHero 任务；唯一合法路径是 webhero_merge_codegen → canvas_webhero_code_stage_raw_chunk → canvas_webhero_code_commit。'

export async function runWebHeroNode(id: string, get: Getter, _set: Setter): Promise<void> {
  const state = get()
  if (!(Array.isArray(state.nodes) ? state.nodes : []).some((node) => node.id === id)) return
  state.setNodeStatus?.(id, 'error', {
    progress: 0,
    lastError: WEBHERO_TRANSACTIONAL_MERGE_REQUIRED,
    webHeroProgressLabel: '请通过 AI Chat 完成事务式网页合并',
  })
  state.appendLog?.(id, `[${new Date().toLocaleTimeString()}] blocked: legacy WebHero Runner is disabled`)
  state.endRunToken?.(id)
  throw new Error(WEBHERO_TRANSACTIONAL_MERGE_REQUIRED)
}

