import React, { useEffect } from 'react'
import { Modal, TextInput, Textarea, Button, Group } from '@mantine/core'
import { useUIStore } from './uiStore'
import { useRFStore } from '../canvas/store'
import { defaultsFor } from '../inspector/forms'

type FormSetter = (k: string, v: any) => void

function renderPromptSection(form: any, setField: FormSetter) {
  return (
    <Textarea
      className="param-modal-field"
      label="Prompt"
      autosize
      minRows={4}
      value={form.prompt || ''}
      onChange={(e) => setField('prompt', e.currentTarget.value)}
      placeholder="填写或粘贴生成提示词（英文，可含动作/光影/对白/音效描述）"
    />
  )
}

function renderSubtitleAlignSection(form: any, setField: FormSetter) {
  return (
    <>
      <TextInput className="param-modal-field" label="音频 URL" value={form.audioUrl||''} onChange={(e)=>setField('audioUrl', e.currentTarget.value)} />
      <Textarea className="param-modal-field" mt={8} label="字幕文本" autosize minRows={4} value={form.transcript||''} onChange={(e)=>setField('transcript', e.currentTarget.value)} />
    </>
  )
}

export default function ParamModal(): JSX.Element {
  const nodeId = useUIStore(s => s.paramNodeId)
  const close = useUIStore(s => s.closeParam)
  const nodes = useRFStore(s => s.nodes)
  const edges = useRFStore(s => s.edges)
  const update = useRFStore(s => s.updateNodeData)
  const runSelected = useRFStore(s => s.runSelected)
  const n = nodes.find(n => n.id === nodeId)
  const kind = (n?.data as any)?.kind as string | undefined
  const [form, setForm] = React.useState<any>({})
  useEffect(()=>{
    if (n) {
      const base = defaultsFor(kind)
      setForm({ ...base, ...(n.data||{}) })
    }
  },[nodeId])

  const setField = (k: string, v: any) => setForm((f:any)=>({ ...f, [k]: v }))
  const saveRun = () => { if (!n) return; update(n.id, form); runSelected(); close() }
  const isPromptSupportedKind =
    kind === 'image' ||
    kind === 'video'
  const isSubtitleAlignKind = kind === 'subtitle'

  return (
    <Modal className="param-modal" opened={!!nodeId} onClose={close} title="参数" centered>
      {!n && <div className="param-modal-empty">节点不存在</div>}
      {n && (
        <div className="param-modal-body">
          {isPromptSupportedKind && renderPromptSection(form, setField)}
          {isSubtitleAlignKind && renderSubtitleAlignSection(form, setField)}
          <Group className="param-modal-footer" justify="flex-end" mt={12}>
            <Group className="param-modal-footer-actions" gap="xs">
              <Button className="param-modal-cancel" variant="subtle" onClick={close}>取消</Button>
              <Button className="param-modal-save" onClick={saveRun}>保存并执行</Button>
            </Group>
          </Group>
        </div>
      )}
    </Modal>
  )
}
