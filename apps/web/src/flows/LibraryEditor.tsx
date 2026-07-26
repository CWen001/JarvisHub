import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap, ReactFlowProvider, ConnectionLineType, addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import TaskNode from '../canvas/nodes/TaskNode'
import { type FlowIO } from './registry'
import { listServerFlows, getServerFlow, saveServerFlow, deleteServerFlow, listFlowVersions, rollbackFlow, type FlowDto, type FlowVersionDto, type FlowVersionReason } from '../api/server'
import { Badge, Button, Group, Title, TextInput, Stack, Text, Divider, Select, Modal } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import { usePreventBrowserSwipeNavigation } from '../utils/usePreventBrowserSwipeNavigation'
import { readFlowVersionDisplayLabel } from '../ui/utils/flowVersionLabel'

const REASON_CHIP: Record<FlowVersionReason, { label: string; color: string }> = {
  manual_save: { label: '保存', color: 'blue' },
  rollback: { label: '回滚', color: 'orange' },
  agent_explicit: { label: 'Agent 检查点', color: 'grape' },
  agent_turn: { label: 'Agent 自动', color: 'cyan' },
  execution: { label: '执行', color: 'gray' },
  internal_cleanup: { label: '系统', color: 'gray' },
  legacy: { label: '归档', color: 'gray' },
}

type Props = { flowId: string; onClose: () => void }
type PortType = FlowIO['inputs'][number]['type']

const PORT_TYPES = new Set<PortType>(['image', 'audio', 'subtitle', 'video', 'any'])

function readLibraryEditorErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return fallback
}

function readFlowGraphData(flow: FlowDto | null | undefined): { nodes: Node[]; edges: Edge[] } {
  const data = flow?.data
  if (!data || typeof data !== 'object') return { nodes: [], edges: [] }
  const record = data as { nodes?: unknown; edges?: unknown }
  return {
    nodes: Array.isArray(record.nodes) ? record.nodes as Node[] : [],
    edges: Array.isArray(record.edges) ? record.edges as Edge[] : [],
  }
}

function readPortType(value: string | undefined): PortType {
  const normalized = String(value || '').trim()
  return PORT_TYPES.has(normalized as PortType) ? normalized as PortType : 'any'
}

export default function LibraryEditor({ flowId, onClose }: Props) {
  const [currentId, setCurrentId] = useState<string>(flowId)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [name, setName] = useState('')
  const [io, setIo] = useState<FlowIO>({ inputs: [], outputs: [] })
  const [serverList, setServerList] = useState<FlowDto[]>([])
  const [versions, setVersions] = useState<FlowVersionDto[]>([])
  const [currentUpdatedAt, setCurrentUpdatedAt] = useState<string>('')
  const [flowLoadError, setFlowLoadError] = useState('')
  const [serverListLoadError, setServerListLoadError] = useState('')
  const [versionsLoadError, setVersionsLoadError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [dirty, setDirty] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  usePreventBrowserSwipeNavigation({ rootRef, withinSelector: '.tc-library-editor__flow' })

  // Load initial
  useEffect(() => {
    (async () => {
      try {
        const r = await getServerFlow(flowId)
        const data = readFlowGraphData(r)
        setNodes(data.nodes)
        setEdges(data.edges)
        setName(r?.name || '')
        setIo({ inputs: [], outputs: [] })
        setCurrentId(flowId)
        setCurrentUpdatedAt(r?.updatedAt || '')
        setDirty(false)
        setFlowLoadError('')
        try {
          setVersions(await listFlowVersions(flowId))
          setVersionsLoadError('')
        } catch (error: unknown) {
          setVersionsLoadError(readLibraryEditorErrorMessage(error, '历史版本加载失败'))
        }
      } catch (error: unknown) {
        setFlowLoadError(readLibraryEditorErrorMessage(error, '工作流加载失败'))
      }
    })()
  }, [flowId])

  // Load lists when open
  useEffect(() => {
    listServerFlows()
      .then((list) => {
        setServerList(list)
        setServerListLoadError('')
      })
      .catch((error: unknown) => {
        setServerListLoadError(readLibraryEditorErrorMessage(error, '服务端工作流列表加载失败'))
      })
  }, [])

  useEffect(() => { setDirty(true) }, [nodes, edges, name])

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)), [])
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), [])
  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge({ ...c, type: 'smoothstep', animated: true }, eds)), [])

  const saveAll = async () => {
    const saved = await saveServerFlow({ id: currentId, name, nodes, edges })
    setServerList(await listServerFlows())
    setCurrentId(saved.id)
    setCurrentUpdatedAt(saved.updatedAt || '')
    setDirty(false)
    onClose()
  }

  const saveAs = async () => {
    const saved = await saveServerFlow({ name, nodes, edges })
    setServerList(await listServerFlows())
    setCurrentId(saved.id)
    setCurrentUpdatedAt(saved.updatedAt || '')
    alert('已另存为服务端工作流: ' + saved.name)
  }

  const removeCurrent = async () => {
    if (!currentId) return
    if (!confirm('确定删除当前工作流吗？')) return
    await deleteServerFlow(currentId); setServerList(await listServerFlows())
    setDirty(false)
    onClose()
  }

  const loadById = async (id: string) => {
    setCurrentId(id)
    try {
      const r = await getServerFlow(id)
      const data = readFlowGraphData(r)
      setNodes(data.nodes)
      setEdges(data.edges)
      setName(r?.name || '')
      setIo({ inputs: [], outputs: [] })
      setCurrentUpdatedAt(r?.updatedAt || '')
      setFlowLoadError('')
      try {
        setVersions(await listFlowVersions(id))
        setVersionsLoadError('')
      } catch (error: unknown) {
        setVersionsLoadError(readLibraryEditorErrorMessage(error, '历史版本加载失败'))
      }
    } catch (error: unknown) {
      setFlowLoadError(readLibraryEditorErrorMessage(error, '工作流加载失败'))
    }
  }

  const addPort = (dir: 'inputs'|'outputs') => {
    const label = prompt('端口名称：')?.trim(); if (!label) return
    const type = readPortType(prompt('端口类型（image/audio/subtitle/video/any）：', 'any')?.trim())
    setIo((prev) => ({ ...prev, [dir]: [...prev[dir], { id: `${dir}-${Date.now().toString(36)}`, label, type }] }))
  }
  const removePort = (dir: 'inputs'|'outputs', id: string) => setIo((prev)=>({ ...prev, [dir]: prev[dir].filter(p=>p.id !== id) }))

  return (
    <div className="tc-library-editor" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="tc-library-editor__panel" ref={rootRef} style={{ width: '92%', height: '92%', background: 'var(--mantine-color-default)', color: 'inherit', borderRadius: 12, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,.35)', display: 'grid', gridTemplateColumns: '1fr 320px', border: '1px solid rgba(127,127,127,.25)' }}>
        <div className="tc-library-editor__main" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="tc-library-editor__header" style={{ padding: 10, borderBottom: '1px solid rgba(127,127,127,.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Title className="tc-library-editor__title" order={5}>工作流编辑</Title>
            <Group className="tc-library-editor__actions" gap="xs">
              <Select className="tc-library-editor__select" size="xs" placeholder="选择服务端工作流" data={serverList.map(f=>({ value: f.id, label: f.name }))} value={currentId} onChange={(v)=> v && loadById(v)} searchable clearable style={{ width: 260 }} />
              <Button className="tc-library-editor__action" size="xs" onClick={saveAll}>保存</Button>
              <Button className="tc-library-editor__action" size="xs" variant="light" onClick={saveAs}>另存为</Button>
              <Button className="tc-library-editor__action" size="xs" variant="light" onClick={async ()=>{
                setShowHistory(true)
                try {
                  setVersions(await listFlowVersions(currentId))
                  setVersionsLoadError('')
                } catch (error: unknown) {
                  setVersionsLoadError(readLibraryEditorErrorMessage(error, '历史版本加载失败'))
                }
              }}>历史</Button>
              <Button className="tc-library-editor__action" size="xs" variant="light" color="red" onClick={removeCurrent}>删除</Button>
              <Button className="tc-library-editor__action" size="xs" variant="light" onClick={()=>{ if (dirty && !confirm('有未保存更改，确定关闭？')) return; onClose() }}>关闭</Button>
            </Group>
          </div>
          {flowLoadError || serverListLoadError ? (
            <Stack className="tc-library-editor__load-errors" gap={4} p="xs">
              {flowLoadError ? <Text className="tc-library-editor__load-error" size="xs" c="red">{flowLoadError}</Text> : null}
              {serverListLoadError ? <Text className="tc-library-editor__load-error" size="xs" c="red">{serverListLoadError}</Text> : null}
            </Stack>
          ) : null}
          <div className="tc-library-editor__canvas" style={{ height: '100%' }}>
            <ReactFlowProvider>
              <ReactFlow
                className="tc-library-editor__flow"
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={{ taskNode: TaskNode }}
                fitView
                connectionLineType={ConnectionLineType.SmoothStep}
              >
                <MiniMap className="tc-library-editor__minimap" position="bottom-left" />
                <Controls className="tc-library-editor__controls" position="bottom-left" />
                <Background className="tc-library-editor__background" gap={16} size={1} color="#2a2f3a" variant={BackgroundVariant.Dots} />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
        </div>
        <div className="tc-library-editor__side" style={{ borderLeft: '1px solid rgba(127,127,127,.2)', padding: 12, overflow: 'auto' }}>
          <Title className="tc-library-editor__section-title" order={6}>配置</Title>
          <TextInput className="tc-library-editor__input" label="名称" value={name} onChange={(e)=>setName(e.currentTarget.value)} />
          <Divider className="tc-library-editor__divider" my={10} />
          <Title className="tc-library-editor__section-title" order={6}>IO 端口</Title>
          <Text className="tc-library-editor__section-label" size="xs" c="dimmed">Inputs</Text>
          {io.inputs.length === 0 && <Text className="tc-library-editor__empty" size="xs" c="dimmed">无</Text>}
          <Stack className="tc-library-editor__list" gap={6}>
            {io.inputs.map(p => (
              <Group className="tc-library-editor__row" key={p.id} justify="space-between">
                <Text className="tc-library-editor__row-text" size="sm">{p.label} <Text className="tc-library-editor__row-meta" span c="dimmed">({p.type})</Text></Text>
                <Button className="tc-library-editor__row-action" size="xs" color="red" variant="subtle" onClick={()=>removePort('inputs', p.id)}>删除</Button>
              </Group>
            ))}
          </Stack>
          <Button className="tc-library-editor__add" mt={6} variant="subtle" onClick={()=>addPort('inputs')}>+ 添加输入</Button>

          <Divider className="tc-library-editor__divider" my={10} />
          <Text className="tc-library-editor__section-label" size="xs" c="dimmed">Outputs</Text>
          {io.outputs.length === 0 && <Text className="tc-library-editor__empty" size="xs" c="dimmed">无</Text>}
          <Stack className="tc-library-editor__list" gap={6}>
            {io.outputs.map(p => (
              <Group className="tc-library-editor__row" key={p.id} justify="space-between">
                <Text className="tc-library-editor__row-text" size="sm">{p.label} <Text className="tc-library-editor__row-meta" span c="dimmed">({p.type})</Text></Text>
                <Button className="tc-library-editor__row-action" size="xs" color="red" variant="subtle" onClick={()=>removePort('outputs', p.id)}>删除</Button>
              </Group>
            ))}
          </Stack>
          <Button className="tc-library-editor__add" mt={6} variant="subtle" onClick={()=>addPort('outputs')}>+ 添加输出</Button>
        </div>
      </div>
      <Modal className="tc-library-editor__modal" opened={showHistory} onClose={()=>setShowHistory(false)} title="保存历史" size="lg" centered>
        <Stack className="tc-library-editor__modal-stack">
          {versionsLoadError ? <Text className="tc-library-editor__load-error" size="sm" c="red">{versionsLoadError}</Text> : null}
          {versions.length === 0 && !versionsLoadError && <Text className="tc-library-editor__empty" size="sm" c="dimmed">暂无历史</Text>}
          {versions.map(v => {
            const chip = REASON_CHIP[v.reason] ?? REASON_CHIP.legacy
            const displayLabel = readFlowVersionDisplayLabel(v)
            return (
              <Group className="tc-library-editor__row" key={v.id} justify="space-between" align="center" wrap="nowrap">
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={6} wrap="nowrap">
                    <Badge className="tc-library-editor__row-reason" size="xs" variant="light" color={chip.color}>{chip.label}</Badge>
                    <Text className="tc-library-editor__row-text" size="sm" fw={500} truncate>{displayLabel}</Text>
                  </Group>
                  <Text size="xs" c="dimmed">{new Date(v.createdAt).toLocaleString()}</Text>
                </Stack>
                <Button className="tc-library-editor__row-action" size="xs" variant="light" onClick={() => {
                  modals.openConfirmModal({
                    title: '回滚到该版本？',
                    centered: true,
                    children: <Text size="sm">回滚后当前未保存的更改将丢失。{displayLabel ? `目标版本：${displayLabel}` : ''}</Text>,
                    labels: { confirm: '回滚', cancel: '取消' },
                    confirmProps: { color: 'orange' },
                    onConfirm: async () => {
                      if (!currentUpdatedAt) {
                        notifications.show({ color: 'red', title: '回滚失败', message: '当前画布缺少更新时间戳，请刷新后重试。' })
                        return
                      }
                      try {
                        await rollbackFlow(currentId, { versionId: v.id, baseUpdatedAt: currentUpdatedAt })
                      } catch (error: unknown) {
                        notifications.show({ color: 'red', title: '回滚失败', message: readLibraryEditorErrorMessage(error, '请刷新后重试') })
                        return
                      }
                      // 服务端已回滚成功；以下任意失败只警告，不再展示"失败"
                      try {
                        const r = await getServerFlow(currentId)
                        const data = readFlowGraphData(r)
                        setNodes(data.nodes)
                        setEdges(data.edges)
                        setName(r?.name || '')
                        setCurrentUpdatedAt(r?.updatedAt || '')
                        setShowHistory(false)
                        try {
                          setVersions(await listFlowVersions(currentId))
                          setVersionsLoadError('')
                        } catch (error: unknown) {
                          setVersionsLoadError(readLibraryEditorErrorMessage(error, '历史版本加载失败'))
                        }
                        notifications.show({ color: 'teal', title: '回滚成功', message: '画布已恢复到所选版本' })
                      } catch (error: unknown) {
                        // 服务端已成功；本地脏标志必须清，否则下次保存会用旧 baseUpdatedAt 撞 409
                        setDirty(false)
                        notifications.show({ color: 'yellow', title: '回滚已完成', message: readLibraryEditorErrorMessage(error, '画布刷新失败，请刷新页面查看最新状态') })
                      }
                    },
                  })
                }}>回滚</Button>
              </Group>
            )
          })}
        </Stack>
      </Modal>
    </div>
  )
}
