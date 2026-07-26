import React from 'react'
import { Button, Divider, Group, Modal, Select, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core'
import type { ModelCatalogModelKind, ModelCatalogModelDto } from '../deps'
import { toast, upsertModelCatalogModel } from '../deps'
import { KIND_OPTIONS } from '../modelCatalog.constants'
import { prettyJson, safeParseJson } from '../modelCatalog.utils'

export type ModelEditorState =
  | { mode: 'create' }
  | { mode: 'edit'; model: ModelCatalogModelDto }
  | { mode: 'duplicate'; model: ModelCatalogModelDto }

function parseModelCatalogModelKind(value: string | null): ModelCatalogModelKind {
  if (value === 'image' || value === 'video' || value === 'multimodal') return value
  return 'multimodal'
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

export function ModelEditModal({
  editor,
  vendorOptions,
  onClose,
  onSaved,
}: {
  editor: ModelEditorState | null
  vendorOptions: Array<{ value: string; label: string }>
  onClose: () => void
  onSaved: () => Promise<void> | void
}): JSX.Element {
  const opened = !!editor
  const mode = editor?.mode || null
  const isNew = mode === 'create' || mode === 'duplicate'
  const sourceModel = editor && editor.mode !== 'create' ? editor.model : null
  const isDuplicate = mode === 'duplicate'

  const [submitting, setSubmitting] = React.useState(false)
  const [modelKey, setModelKey] = React.useState('')
  const [modelAlias, setModelAlias] = React.useState('')
  const [vendorKey, setVendorKey] = React.useState<string>('')
  const [labelZh, setLabelZh] = React.useState('')
  const [kind, setKind] = React.useState<ModelCatalogModelKind>('multimodal')
  const [enabled, setEnabled] = React.useState(true)
  const [meta, setMeta] = React.useState('')

  React.useEffect(() => {
    if (!opened) return
    if (mode === 'create') {
      const nextKind: ModelCatalogModelKind = 'multimodal'
      setModelKey('')
      setModelAlias('')
      setVendorKey(vendorOptions[0]?.value || '')
      setLabelZh('')
      setKind(nextKind)
      setEnabled(true)
      setMeta('')
      setSubmitting(false)
      return
    }

    if (!sourceModel) return

    const nextModelKey = isDuplicate ? '' : String(sourceModel.modelKey || '').trim()
    const nextAlias = String(sourceModel.modelAlias || '').trim()
    const nextKind = parseModelCatalogModelKind(sourceModel.kind)
    setModelKey(nextModelKey)
    setModelAlias(isDuplicate ? '' : nextAlias)
    setVendorKey(sourceModel.vendorKey)
    setLabelZh(sourceModel.labelZh || '')
    setKind(nextKind)
    setEnabled(!!sourceModel.enabled)
    setMeta(prettyJson(sourceModel.meta))
    setSubmitting(false)
  }, [isDuplicate, mode, opened, sourceModel, vendorOptions])

  const submitModel = React.useCallback(async () => {
    const trimmedModelKey = modelKey.trim()
    const modelAliasRaw = modelAlias.trim()
    const finalAlias = modelAliasRaw || null
    const trimmedVendorKey = vendorKey.trim()
    const trimmedLabelZh = labelZh.trim()

    if (!trimmedVendorKey) {
      toast('请选择厂商', 'error')
      return
    }
    if (!trimmedModelKey) {
      toast('请填写模型 Key（例如 gpt-4.1 / nano-banana-pro）', 'error')
      return
    }
    if (!trimmedLabelZh) {
      toast('请填写中文名称', 'error')
      return
    }
    const metaParsed = safeParseJson(meta)
    if (!metaParsed.ok) {
      toast(`meta JSON 无效：${metaParsed.error}`, 'error')
      return
    }

    if (submitting) return
    setSubmitting(true)
    try {
      await upsertModelCatalogModel({
        modelKey: trimmedModelKey,
        vendorKey: trimmedVendorKey,
        modelAlias: finalAlias,
        labelZh: trimmedLabelZh,
        kind,
        enabled,
        ...(typeof metaParsed.value === 'undefined' ? {} : { meta: metaParsed.value }),
      })
      toast('已保存模型', 'success')
      onClose()
      await onSaved()
    } catch (error: unknown) {
      console.error('save model failed', error)
      toast(toErrorMessage(error, '保存模型失败'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [enabled, kind, labelZh, meta, modelAlias, modelKey, onClose, onSaved, submitting, vendorKey])

  return (
    <Modal
      className="stats-model-catalog-model-modal"
      opened={opened}
      onClose={onClose}
      title={mode === 'edit' ? '编辑模型' : mode === 'duplicate' ? '复制模型' : '新增模型'}
      size="lg"
      radius="md"
      centered
      lockScroll={false}
    >
      <Stack className="stats-model-catalog-model-form" gap="sm">
        <Select
          className="stats-model-catalog-model-form-vendor"
          label="所属平台"
          data={vendorOptions}
          value={vendorKey}
          onChange={(value) => setVendorKey(value || '')}
          searchable
          disabled={!isNew}
        />
        <TextInput
          className="stats-model-catalog-model-form-key"
          label="唯一标识"
          placeholder="例如 gpt-4.1 / nano-banana-pro"
          value={modelKey}
          onChange={(event) => setModelKey(event.currentTarget.value)}
          disabled={!isNew}
        />
        <Select
          className="stats-model-catalog-model-form-kind"
          label="模型类型"
          data={KIND_OPTIONS}
          value={kind}
          onChange={(value) => setKind(parseModelCatalogModelKind(value))}
        />
        <TextInput
          className="stats-model-catalog-model-form-label"
          label="模型名称"
          placeholder="例如 GPT-4.1 / Gemini 3.1 Flash Image"
          value={labelZh}
          onChange={(event) => setLabelZh(event.currentTarget.value)}
        />
        <TextInput
          className="stats-model-catalog-model-form-alias"
          label="Public 别名"
          placeholder="留空则不设置别名"
          value={modelAlias}
          onChange={(event) => setModelAlias(event.currentTarget.value)}
        />

        <Textarea className="stats-model-catalog-model-form-meta" label="描述 / meta（JSON，可选）" value={meta} onChange={(event) => setMeta(event.currentTarget.value)} minRows={4} autosize />
        <Text className="stats-model-catalog-model-form-meta-hint" size="xs" c="dimmed">
          视频模型可在 `meta.videoOptions.controls` 或 `meta.videoOptions.controlMappings` 中声明节点控制栏映射。
          例如：`controls: [&#123; key: "duration", binding: "durationSeconds" &#125;, &#123; key: "size", binding: "size" &#125;]`。
        </Text>
        <Switch className="stats-model-catalog-model-form-enabled" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} label="模型启用" />

        <Divider className="stats-model-catalog-model-form-divider" label="保存说明" labelPosition="left" />
        <Text className="stats-model-catalog-model-form-hint" size="xs" c="dimmed">
          模型目录只保存生成所需的模型身份、能力类型、启用状态和 meta 参数。
        </Text>

        <Group className="stats-model-catalog-model-form-actions" justify="flex-end" gap={8}>
          <Button className="stats-model-catalog-model-form-cancel" variant="subtle" onClick={onClose}>取消</Button>
          <Button className="stats-model-catalog-model-form-save" onClick={() => void submitModel()} loading={submitting}>
            保存
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
