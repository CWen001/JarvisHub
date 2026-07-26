// 画布图实体（节点/边）身份保留协调。
//
// 背景：load() 全量重建会给每个节点造新对象/新 data 引用，击穿 TaskNode 的
// memo（areTaskNodePropsEqual 对 data 做引用比较），导致 agent 回复期间整块画布
// 重渲染闪烁。让未变实体复用旧引用即可恢复 memo、消除闪烁，同步语义不变。

const REACT_FLOW_RUNTIME_ENTITY_KEYS = new Set([
  'width',
  'height',
  'measured',
  'positionAbsolute',
  'dragging',
  'resizing',
])

function stripReactFlowRuntimeEntityFields(entity: unknown): unknown {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return entity
  const source = entity as Record<string, unknown>
  let changed = false
  const comparable: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    if (REACT_FLOW_RUNTIME_ENTITY_KEYS.has(key)) {
      changed = true
      continue
    }
    comparable[key] = source[key]
  }
  return changed ? comparable : entity
}

// 节点/边都是服务端可序列化数据，用结构序列化判等即可：
// 内容不同 → JSON 不同（绝不漏判更新）；内容相同 → 复用旧引用。
// React Flow 会在节点顶层注入 width/height/measured 等运行时字段；这些字段不属于
// 服务端画布语义，agent reload 时不能因为它们缺失而击穿 memo。
export function graphEntityEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(stripReactFlowRuntimeEntityFields(a)) === JSON.stringify(stripReactFlowRuntimeEntityFields(b))
  } catch {
    return false
  }
}

// 按 id 协调：next 中与 prev 结构相等的实体复用 prev 的对象引用。
// prev 为空（初次加载/切 flow）时原样返回 next，与全量替换行为一致。
export function reconcileById<T extends { id: string }>(prev: readonly T[], next: readonly T[]): T[] {
  if (prev.length === 0) return next as T[]
  const prevById = new Map(prev.map((entity) => [entity.id, entity]))
  return next.map((entity) => {
    const old = prevById.get(entity.id)
    return old && graphEntityEqual(old, entity) ? old : entity
  })
}
