import React from 'react'
import { Group, Title, Transition, Button, Stack, Text, Badge, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import { useUIStore } from './uiStore'
import {
  createFlowVersion,
  getServerFlow,
  listFlowVersions,
  rollbackFlow,
  type FlowVersionDto,
  type FlowVersionReason,
} from '../api/server'
import { useRFStore } from '../canvas/store'
import { calculateSafeMaxHeight } from './utils/panelPosition'
import { PanelCard } from './PanelCard'
import { stopPanelWheelPropagation } from './utils/panelWheel'
import { readFlowVersionDisplayLabel } from './utils/flowVersionLabel'

const REASON_CHIP: Record<FlowVersionReason, { label: string; color: string }> = {
  manual_save: { label: '保存', color: 'blue' },
  rollback: { label: '回滚', color: 'orange' },
  agent_explicit: { label: 'Agent 检查点', color: 'grape' },
  agent_turn: { label: 'Agent 自动', color: 'cyan' },
  execution: { label: '执行', color: 'gray' },
  internal_cleanup: { label: '系统', color: 'gray' },
  legacy: { label: '归档', color: 'gray' },
}

function describeError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim()
  if (typeof err === 'string' && err.trim()) return err.trim()
  return fallback
}

export default function HistoryPanel(): JSX.Element | null {
  const active = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const anchorY = useUIStore((s) => s.panelAnchorY)
  const currentFlow = useUIStore((s) => s.currentFlow)
  const setCurrentFlow = useUIStore((s) => s.setCurrentFlow)
  const setDirty = useUIStore((s) => s.setDirty)
  const isDirty = useUIStore((s) => s.isDirty)
  const mounted = active === 'history'
  const [versions, setVersions] = React.useState<FlowVersionDto[]>([])
  const [loadError, setLoadError] = React.useState('')

  const reloadVersions = React.useCallback(async (flowId: string) => {
    try {
      const vs = await listFlowVersions(flowId)
      setVersions(vs)
      setLoadError('')
    } catch (err) {
      setVersions([])
      setLoadError(describeError(err, '历史加载失败'))
    }
  }, [])

  React.useEffect(() => {
    if (!mounted || !currentFlow.id) return
    void reloadVersions(currentFlow.id)
  }, [mounted, currentFlow.id, currentFlow.updatedAt, reloadVersions])

  if (!mounted) return null

  const maxHeight = calculateSafeMaxHeight(anchorY, 150)

  const performManualSave = async (label: string) => {
    if (!currentFlow.id) return
    if (isDirty) {
      notifications.show({
        color: 'red',
        title: '保存失败',
        message: '当前画布有未保存的更改，请先保存画布再创建版本快照。',
      })
      return
    }
    const trimmed = label.trim()
    if (!trimmed) {
      notifications.show({ color: 'red', title: '保存失败', message: '请填写版本名称' })
      return
    }
    try {
      await createFlowVersion(currentFlow.id, trimmed)
      await reloadVersions(currentFlow.id)
      notifications.show({
        color: 'teal',
        title: '版本已保存',
        message: trimmed,
      })
    } catch (err) {
      notifications.show({
        color: 'red',
        title: '保存失败',
        message: describeError(err, '请稍后重试'),
      })
    }
  }

  const openManualSaveModal = () => {
    if (!currentFlow.id) return
    let value = ''
    modals.open({
      title: '保存当前版本',
      centered: true,
      children: (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            为当前画布快照起一个有语义的名字，便于将来回溯。
          </Text>
          <TextInput
            data-autofocus
            label="版本名称"
            placeholder="例如：第一章定稿前"
            maxLength={120}
            onChange={(e) => {
              value = e.currentTarget.value
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                modals.closeAll()
                void performManualSave(value)
              }
            }}
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="xs" onClick={() => modals.closeAll()}>
              取消
            </Button>
            <Button
              size="xs"
              onClick={() => {
                modals.closeAll()
                void performManualSave(value)
              }}
            >
              保存
            </Button>
          </Group>
        </Stack>
      ),
    })
  }

  const performRollback = async (versionId: string) => {
    if (!currentFlow.id) return
    if (!currentFlow.updatedAt) {
      notifications.show({
        color: 'red',
        title: '回滚失败',
        message: '当前画布缺少更新时间戳，无法回滚。请刷新后重试。',
      })
      return
    }
    try {
      await rollbackFlow(currentFlow.id, {
        versionId,
        baseUpdatedAt: currentFlow.updatedAt,
      })
    } catch (err) {
      notifications.show({
        color: 'red',
        title: '回滚失败',
        message: describeError(err, '请刷新后重试'),
      })
      return
    }
    // 服务端已回滚成功；以下任意一步失败都不再展示"失败"，只警告
    try {
      const r = await getServerFlow(currentFlow.id)
      const data = (r?.data ?? {}) as { nodes?: unknown; edges?: unknown; viewport?: unknown; sceneCreationProgress?: unknown }
      useRFStore.getState().load({
        nodes: Array.isArray(data.nodes) ? data.nodes : [],
        edges: Array.isArray(data.edges) ? data.edges : [],
      })
      const vp = data.viewport
      if (vp && typeof vp === 'object' && typeof (vp as { zoom?: unknown }).zoom === 'number') {
        useUIStore.getState().setPendingInitialView({ kind: 'viewport', value: vp as { x: number; y: number; zoom: number } })
      } else {
        useUIStore.getState().setPendingInitialView({ kind: 'fit' })
      }
      useUIStore.getState().restoreCreationSession(data.sceneCreationProgress)
      setCurrentFlow({ id: r.id, name: r.name, source: 'server', updatedAt: r.updatedAt })
      setDirty(false)
      setActivePanel(null)
      notifications.show({
        color: 'teal',
        title: '回滚成功',
        message: '画布已恢复到所选版本',
      })
    } catch (err) {
      // 服务端已成功回滚；本地脏标志必须清掉，否则下次保存会用旧 baseUpdatedAt 撞 409
      setDirty(false)
      notifications.show({
        color: 'yellow',
        title: '回滚已完成',
        message: describeError(err, '画布刷新失败，请刷新页面查看最新状态'),
      })
    }
  }

  const confirmRollback = (versionId: string, label: string) => {
    modals.openConfirmModal({
      title: '回滚到该版本？',
      centered: true,
      children: (
        <Text size="sm">
          回滚后当前未保存的更改将丢失。{label ? `目标版本：${label}` : '该操作不可撤销。'}
        </Text>
      ),
      labels: { confirm: '回滚', cancel: '取消' },
      confirmProps: { color: 'orange' },
      onConfirm: () => {
        void performRollback(versionId)
      },
    })
  }

  return (
    <div
      className="history-panel-anchor"
      style={{ position: 'fixed', left: 82, top: anchorY ? anchorY - 150 : 140, zIndex: 200 }}
      data-ux-panel
    >
      <Transition
        className="history-panel-transition"
        mounted={mounted}
        transition="pop"
        duration={140}
        timingFunction="ease"
      >
        {(styles) => (
          <div className="history-panel-transition-inner" style={styles}>
            <PanelCard
              className="glass"
              style={{
                width: 460,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                transformOrigin: 'left center',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              onWheelCapture={stopPanelWheelPropagation}
              data-ux-panel
            >
              <div className="history-panel-arrow panel-arrow" />
              <Group className="history-panel-header" justify="space-between" mb={8}>
                <Title className="history-panel-title" order={6}>
                  保存历史
                </Title>
                <Group gap={6}>
                  <Button
                    className="history-panel-save"
                    size="xs"
                    variant="filled"
                    onClick={openManualSaveModal}
                    disabled={!currentFlow.id || isDirty}
                    title={isDirty ? '当前画布有未保存的更改，请先保存画布' : undefined}
                  >
                    保存版本
                  </Button>
                  <Button
                    className="history-panel-close"
                    size="xs"
                    variant="light"
                    onClick={() => setActivePanel(null)}
                  >
                    关闭
                  </Button>
                </Group>
              </Group>
              <div
                className="history-panel-body"
                style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}
              >
                <Stack className="history-panel-list" gap="xs">
                  {loadError ? (
                    <Text className="history-panel-load-error" size="sm" c="red">
                      {loadError}
                    </Text>
                  ) : (!versions || versions.length === 0) ? (
                    <Text className="history-panel-empty" size="sm" c="dimmed">
                      暂无历史
                    </Text>
                  ) : null}
                  {versions.map((v) => {
                    const chip = REASON_CHIP[v.reason] ?? REASON_CHIP.legacy
                    const displayLabel = readFlowVersionDisplayLabel(v)
                    return (
                      <Group
                        className="history-panel-row"
                        key={v.id}
                        justify="space-between"
                        align="center"
                        wrap="nowrap"
                      >
                        <Stack className="history-panel-row-meta" gap={2} style={{ flex: 1, minWidth: 0 }}>
                          <Group gap={6} wrap="nowrap">
                            <Badge
                              className="history-panel-row-reason"
                              size="xs"
                              variant="light"
                              color={chip.color}
                            >
                              {chip.label}
                            </Badge>
                            <Text
                              className="history-panel-row-label"
                              size="sm"
                              fw={500}
                              truncate
                            >
                              {displayLabel}
                            </Text>
                          </Group>
                          <Text className="history-panel-row-time" size="xs" c="dimmed">
                            {new Date(v.createdAt).toLocaleString()}
                          </Text>
                        </Stack>
                        <Button
                          className="history-panel-rollback"
                          size="xs"
                          variant="light"
                          onClick={() => confirmRollback(v.id, displayLabel)}
                        >
                          回滚
                        </Button>
                      </Group>
                    )
                  })}
                </Stack>
              </div>
            </PanelCard>
          </div>
        )}
      </Transition>
    </div>
  )
}
