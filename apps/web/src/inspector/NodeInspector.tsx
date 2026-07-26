import React, { useEffect, useMemo } from 'react'
import { useRFStore } from '../canvas/store'
import { useUIStore } from '../ui/uiStore'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { textToImageSchema, composeVideoSchema, subtitleAlignSchema, defaultsFor } from './forms'
import { TextInput, Textarea, NumberInput, Select, Button, Title, Divider, Text, Group } from '@mantine/core'
import { setJarvisHubImageDragData } from '../canvas/dnd/setJarvisHubImageDragData'

function resolveSchemaByKind(kind?: string) {
  if (kind === 'textToImage') return textToImageSchema
  if (kind === 'composeVideo') return composeVideoSchema
  if (kind === 'subtitleAlign') return subtitleAlignSchema
  return textToImageSchema
}

function EmptyState() {
  return (
    <div className="tc-node-inspector tc-node-inspector--empty">
      <h2 className="tc-node-inspector__title" style={{ margin: '8px 0 12px', fontSize: 16 }}>属性</h2>
      <div className="tc-node-inspector__hint" style={{ fontSize: 12, opacity: .7 }}>选中一个节点以编辑属性。</div>
    </div>
  )
}

function InspectorActions({ selectedId }: { selectedId: string }) {
  const cancelNode = useRFStore((s) => s.cancelNode)
  const setNodeStatus = useRFStore((s) => s.setNodeStatus)
  const runSelected = useRFStore((s) => s.runSelected)

  return (
    <Group className="tc-node-inspector__actions" gap="xs" style={{ margin: '4px 0 10px' }}>
      <Button className="tc-node-inspector__action" size="xs" onClick={() => runSelected()}>运行</Button>
      <Button className="tc-node-inspector__action" size="xs" variant="light" color="red" onClick={() => { cancelNode(selectedId); setNodeStatus(selectedId, 'error', { progress: 0, lastError: '任务已取消' }) }}>停止</Button>
      <Button className="tc-node-inspector__action" size="xs" variant="subtle" onClick={() => useRFStore.getState().updateNodeData(selectedId, { logs: [] })}>清空日志</Button>
    </Group>
  )
}

function SubflowSection({ selectedId, subflowRef }: { selectedId: string; subflowRef?: string }) {
  if (!subflowRef) {
    return (
      <Group className="tc-node-inspector__subflow-actions" gap="xs" wrap="wrap">
        <Button className="tc-node-inspector__action" size="xs" onClick={() => useUIStore.getState().openSubflow(selectedId)}>打开子工作流</Button>
        <Button className="tc-node-inspector__action" size="xs" variant="subtle" onClick={() => {
          const flows = require('../flows/registry') as any
          const list = flows.listFlows?.() || []
          if (!list.length) { alert('库中暂无工作流'); return }
          const pick = prompt('输入要引用的 Flow 名称：\n' + list.map((f:any)=>`- ${f.name} (${f.id})`).join('\n'))
          const match = list.find((f:any)=> f.name === pick || f.id === pick)
          if (match) {
            const rec = flows.getFlow?.(match.id)
            useRFStore.getState().updateNodeData(selectedId, { subflowRef: match.id, label: match.name, subflow: undefined, io: rec?.io })
          }
        }}>转换为引用</Button>
      </Group>
    )
  }

  return (
    <Group className="tc-node-inspector__subflow-actions" gap="xs" wrap="wrap">
      <Button className="tc-node-inspector__action" size="xs" variant="subtle" onClick={() => {
        const flows = require('../flows/registry') as any
        const rec = flows.getFlow?.(subflowRef)
        if (!rec) { alert('引用的 Flow 不存在'); return }
        useRFStore.getState().updateNodeData(selectedId, { subflow: { nodes: rec.nodes, edges: rec.edges }, subflowRef: undefined })
      }}>解除引用并嵌入副本</Button>
      <Button className="tc-node-inspector__action" size="xs" variant="subtle" onClick={() => {
        const flows = require('../flows/registry') as any
        const rec = flows.getFlow?.(subflowRef)
        if (!rec) { alert('Flow 不存在'); return }
        useRFStore.getState().updateNodeData(selectedId, { io: rec.io })
      }}>同步 IO</Button>
    </Group>
  )
}

function TextToImageForm({ selectedId, form }: { selectedId: string; form: ReturnType<typeof useForm<any>> }) {
  return (
    <form className="tc-node-inspector__form" onSubmit={form.handleSubmit((values) => useRFStore.getState().updateNodeData(selectedId, values))} style={{ marginTop: 12 }}>
      <Textarea className="tc-node-inspector__textarea" label="提示词" autosize minRows={3} {...form.register('prompt')} error={form.formState.errors.prompt?.message as any} />
      <Group className="tc-node-inspector__row" grow mt={8}>
        <Controller name="steps" control={form.control} render={({ field }) => (
          <NumberInput className="tc-node-inspector__number" label="Steps" min={1} max={100} value={field.value} onChange={(v)=>field.onChange(Number(v))} />
        )} />
        <Controller name="seed" control={form.control} render={({ field }) => (
          <NumberInput className="tc-node-inspector__number" label="Seed" value={field.value ?? ''} onChange={(v)=>field.onChange(v===undefined? undefined : Number(v))} />
        )} />
      </Group>
      <Controller name="aspect" control={form.control} render={({ field }) => (
        <Select
          className="tc-node-inspector__select"
          mt={8}
          label="比例"
          data={[
            { value: 'auto', label: 'auto' },
            { value: '1:1', label: '1:1' },
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '4:3', label: '4:3' },
            { value: '3:4', label: '3:4' },
            { value: '3:2', label: '3:2' },
            { value: '2:3', label: '2:3' },
            { value: '5:4', label: '5:4' },
            { value: '4:5', label: '4:5' },
            { value: '21:9', label: '21:9' },
          ]}
          value={field.value}
          onChange={field.onChange}
        />
      )} />
      <Button className="tc-node-inspector__action" type="submit" mt={10}>应用</Button>
    </form>
  )
}

function ComposeVideoForm({ selectedId, form }: { selectedId: string; form: ReturnType<typeof useForm<any>> }) {
  return (
    <form className="tc-node-inspector__form" onSubmit={form.handleSubmit((values) => useRFStore.getState().updateNodeData(selectedId, values))} style={{ marginTop: 12 }}>
      <Textarea className="tc-node-inspector__textarea" label="脚本" autosize minRows={4} {...form.register('script')} error={form.formState.errors.script?.message as any} />
      <Group className="tc-node-inspector__row" grow mt={8}>
        <Controller name="duration" control={form.control} render={({ field }) => (
          <NumberInput className="tc-node-inspector__number" label="Duration(s)" min={1} max={600} value={field.value} onChange={(v)=>field.onChange(Number(v))} />
        )} />
        <Controller name="fps" control={form.control} render={({ field }) => (
          <NumberInput className="tc-node-inspector__number" label="FPS" min={1} max={60} value={field.value} onChange={(v)=>field.onChange(Number(v))} />
        )} />
      </Group>
      <TextInput
        className="tc-node-inspector__input"
        label="Remix 目标 ID（可选）"
        placeholder="例如：gen_01ka5v1x58e5ksd0s62qr1exyb"
        {...form.register('remixTargetId')}
        error={form.formState.errors.remixTargetId?.message as any}
        mt={8}
      />
      <Button className="tc-node-inspector__action" type="submit" mt={10}>应用</Button>
    </form>
  )
}

function SubtitleAlignForm({ selectedId, form }: { selectedId: string; form: ReturnType<typeof useForm<any>> }) {
  return (
    <form className="tc-node-inspector__form" onSubmit={form.handleSubmit((values) => useRFStore.getState().updateNodeData(selectedId, values))} style={{ marginTop: 12 }}>
      <TextInput className="tc-node-inspector__input" label="音频 URL" {...form.register('audioUrl')} error={form.formState.errors.audioUrl?.message as any} />
      <Textarea className="tc-node-inspector__textarea" mt={8} label="字幕文本" autosize minRows={4} {...form.register('transcript')} error={form.formState.errors.transcript?.message as any} />
      <Button className="tc-node-inspector__action" type="submit" mt={10}>应用</Button>
    </form>
  )
}

function SubflowIoSection({
  selectedId,
  subflowIO,
  bindings,
}: {
  selectedId: string
  subflowIO: any
  bindings: { inputs?: Record<string, string>; outputs?: Record<string, string> }
}) {
  return (
    <div className="tc-node-inspector__io" style={{ marginTop: 14 }}>
      <h3 className="tc-node-inspector__subtitle" style={{ margin: '8px 0 8px', fontSize: 14 }}>IO 映射</h3>
      <div className="tc-node-inspector__hint" style={{ fontSize: 12, opacity: .7, marginBottom: 6 }}>配置父级变量名/键，与子工作流 IO 对应（占位实现）。</div>
      <div className="tc-node-inspector__label" style={{ fontWeight: 600, margin: '6px 0' }}>Inputs</div>
      {(subflowIO.inputs || []).length === 0 && <div className="tc-node-inspector__hint" style={{ fontSize: 12, opacity: .6 }}>无</div>}
      {(subflowIO.inputs || []).map((p: any) => (
        <div className="tc-node-inspector__io-row" key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span className="tc-node-inspector__io-label" style={{ width: 120, fontSize: 12 }}>{p.label} <span className="tc-node-inspector__io-meta" style={{ opacity: .6 }}>({p.type})</span></span>
          <input
            className="tc-node-inspector__io-input"
            placeholder="父级变量名"
            value={bindings.inputs?.[p.id] || ''}
            onChange={(e) => useRFStore.getState().updateNodeData(selectedId, { ioBindings: { inputs: { ...bindings.inputs, [p.id]: e.target.value }, outputs: bindings.outputs } })}
            style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,.35)' }}
          />
        </div>
      ))}
      <div className="tc-node-inspector__label" style={{ fontWeight: 600, margin: '6px 0' }}>Outputs</div>
      {(subflowIO.outputs || []).length === 0 && <div className="tc-node-inspector__hint" style={{ fontSize: 12, opacity: .6 }}>无</div>}
      {(subflowIO.outputs || []).map((p: any) => (
        <div className="tc-node-inspector__io-row" key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span className="tc-node-inspector__io-label" style={{ width: 120, fontSize: 12 }}>{p.label} <span className="tc-node-inspector__io-meta" style={{ opacity: .6 }}>({p.type})</span></span>
          <input
            className="tc-node-inspector__io-input"
            placeholder="父级输出键"
            value={bindings.outputs?.[p.id] || ''}
            onChange={(e) => useRFStore.getState().updateNodeData(selectedId, { ioBindings: { inputs: bindings.inputs, outputs: { ...bindings.outputs, [p.id]: e.target.value } } })}
            style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,.35)' }}
          />
        </div>
      ))}
    </div>
  )
}

function LogsSection({ logs }: { logs?: string[] }) {
  return (
    <>
      <Divider className="tc-node-inspector__divider" my={12} />
      <Title className="tc-node-inspector__section-title" order={6}>运行日志</Title>
      <div className="tc-node-inspector__logs" style={{ maxHeight: 160, overflow: 'auto', border: '1px solid rgba(127,127,127,.25)', borderRadius: 8, padding: '8px 10px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12 }}>
        {(logs && logs.length) ? logs.map((l, i) => (<div className="tc-node-inspector__log-line" key={i}>{l}</div>)) : <Text className="tc-node-inspector__hint" size="xs" c="dimmed">暂无日志</Text>}
      </div>
    </>
  )
}

function PreviewSection({ result, label }: { result: any; label: string }) {
  return (
    <>
      <Divider className="tc-node-inspector__divider" my={12} />
      <Title className="tc-node-inspector__section-title" order={6}>预览</Title>
      {result?.preview?.type === 'image' && result.preview.src && (
        <img
          className="tc-node-inspector__preview"
          src={result.preview.src}
          alt={label}
          draggable
          onDragStart={(evt) => setJarvisHubImageDragData(evt, result.preview.src)}
          style={{ width: '100%', borderRadius: 8, border: '1px solid rgba(127,127,127,.25)' }}
        />
      )}
      {result?.preview?.type === 'audio' && (
        <Text className="tc-node-inspector__hint" size="xs" c="dimmed">（音频占位，暂未生成音频数据）</Text>
      )}
      {!result?.preview && (
        <Text className="tc-node-inspector__hint" size="xs" c="dimmed">暂无预览</Text>
      )}
    </>
  )
}

export default function NodeInspector(): JSX.Element {
  const nodes = useRFStore((s) => s.nodes)
  const updateNodeLabel = useRFStore((s) => s.updateNodeLabel)

  const selected = useMemo(() => nodes.find((n) => n.selected), [nodes])
  const logs = (selected?.data as any)?.logs as string[] | undefined
  const result = (selected?.data as any)?.lastResult as any
  const kind = (selected?.data as any)?.kind as string | undefined
  const subflowRef = (selected?.data as any)?.subflowRef as string | undefined
  const subflowIO = (selected?.data as any)?.io as any
  const bindings = (selected?.data as any)?.ioBindings as { inputs?: Record<string,string>; outputs?: Record<string,string> } || { inputs: {}, outputs: {} }
  const form = useForm<any>({
    resolver: zodResolver(resolveSchemaByKind(kind)),
    defaultValues: defaultsFor(kind),
  })

  useEffect(() => {
    if (!selected) return
    const data = { ...defaultsFor(kind), ...(selected.data || {}) }
    const { label, kind: _k, ...rest } = data as any
    form.reset(rest)
  }, [selected?.id, kind])

  if (!selected) return <EmptyState />

  return (
    <div className="tc-node-inspector">
      <Title className="tc-node-inspector__title" order={6} style={{ margin: '2px 0 8px' }}>属性</Title>
      <Text className="tc-node-inspector__meta" size="xs" c="dimmed" style={{ marginBottom: 6 }}>ID: {selected.id}</Text>
      <Text className="tc-node-inspector__meta" size="xs" c="dimmed" style={{ marginBottom: 8 }}>状态：{(selected.data as any)?.status ?? 'idle'}</Text>

      <InspectorActions selectedId={selected.id} />

      {kind === 'subflow' && (
        <div className="tc-node-inspector__subflow" style={{ padding: 10, border: '1px dashed rgba(127,127,127,.35)', borderRadius: 8, marginBottom: 10 }}>
          <Text className="tc-node-inspector__hint" size="xs" c="dimmed" mb={6}>子工作流模式：{subflowRef ? `引用 (${subflowRef})` : '嵌入'}</Text>
          <SubflowSection selectedId={selected.id} subflowRef={subflowRef} />
        </div>
      )}

      <TextInput
        className="tc-node-inspector__input"
        label="标题"
        size="sm"
        value={(selected.data as any)?.label ?? ''}
        onChange={(e) => updateNodeLabel(selected.id, e.currentTarget.value)}
      />

      {kind === 'textToImage' && <TextToImageForm selectedId={selected.id} form={form} />}
      {kind === 'composeVideo' && <ComposeVideoForm selectedId={selected.id} form={form} />}
      {kind === 'subtitleAlign' && <SubtitleAlignForm selectedId={selected.id} form={form} />}

      {kind === 'subflow' && subflowIO && (
        <SubflowIoSection selectedId={selected.id} subflowIO={subflowIO} bindings={bindings} />
      )}

      <LogsSection logs={logs} />
      <PreviewSection result={result} label={String((selected.data as any)?.label || '')} />
    </div>
  )
}
