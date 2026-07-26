import React from 'react'
import { ActionIcon, Group, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconArrowRight, IconCircleCheck, IconCircleDashed, IconTrash } from '@tabler/icons-react'
import type { ModelConfigDefaultSlot, ModelConfigDto } from '../../api/server'
import { REASON_TEXT, SLOT_HINT, SLOT_LABEL, SLOT_ORDER, deriveSlotStatus, type SlotStatus } from './slotStatus'

export type StatusOverviewProps = {
  className?: string
  config: ModelConfigDto | null
  busySlot?: ModelConfigDefaultSlot | null
  onJumpToProvider: (vendorKey: string | null) => void
  onClearSlot: (slot: ModelConfigDefaultSlot) => void
}

type RowVisual = {
  icon: React.ReactNode
  primary: string
  secondary: string
  tone: 'ok' | 'warn' | 'bad'
}

function visualForStatus(slot: ModelConfigDefaultSlot, status: SlotStatus): RowVisual {
  if (status.state === 'unset') {
    return {
      icon: <IconCircleDashed size={16} className="tc-status-row-icon-unset" />,
      primary: SLOT_LABEL[slot],
      secondary: '未设置',
      tone: 'warn',
    }
  }
  if (status.state === 'invalid') {
    return {
      icon: <IconAlertTriangle size={16} className="tc-status-row-icon-invalid" />,
      primary: `${SLOT_LABEL[slot]} · ${status.modelKey}`,
      secondary: REASON_TEXT[status.reason],
      tone: 'bad',
    }
  }
  return {
    icon: <IconCircleCheck size={16} className="tc-status-row-icon-ok" />,
    primary: `${SLOT_LABEL[slot]} · ${status.label}`,
    secondary: `${status.modelKey} · ${status.providerName}`,
    tone: 'ok',
  }
}

function toneColor(tone: RowVisual['tone']): string {
  if (tone === 'ok') return 'var(--mantine-color-teal-7)'
  if (tone === 'warn') return 'var(--mantine-color-yellow-7)'
  return 'var(--mantine-color-red-7)'
}

export default function StatusOverview({
  className,
  config,
  busySlot,
  onJumpToProvider,
  onClearSlot,
}: StatusOverviewProps): JSX.Element {
  const rootClassName = ['tc-model-status-overview', className].filter(Boolean).join(' ')

  return (
    <Stack className={rootClassName} gap={4}>
      {SLOT_ORDER.map((slot) => {
        const status = deriveSlotStatus(slot, config)
        const visual = visualForStatus(slot, status)
        const targetVendorKey =
          status.state === 'invalid' || status.state === 'healthy' ? status.vendorKey : null
        const canClear = status.state !== 'unset'
        const busy = busySlot === slot

        return (
          <Paper
            key={slot}
            className={`tc-model-status-row tc-model-status-row--${slot} tc-model-status-row--${visual.tone}`}
            data-tone={visual.tone}
            data-slot={slot}
            p="xs"
            radius="xs"
            withBorder={false}
            style={{
              background:
                visual.tone === 'bad'
                  ? 'rgba(255, 99, 99, 0.08)'
                  : visual.tone === 'warn'
                    ? 'rgba(255, 196, 0, 0.08)'
                    : 'rgba(56, 200, 140, 0.06)',
            }}
          >
            <Group className="tc-model-status-row-inner" justify="space-between" wrap="nowrap" gap={8}>
              <Group className="tc-model-status-row-left" gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                <span className="tc-model-status-row-icon" style={{ color: toneColor(visual.tone), display: 'inline-flex' }}>
                  {visual.icon}
                </span>
                <Stack className="tc-model-status-row-text" gap={0} style={{ minWidth: 0 }}>
                  <Text className="tc-model-status-row-primary" size="xs" fw={600} truncate>
                    {visual.primary}
                  </Text>
                  <Text className="tc-model-status-row-secondary" size="xs" c="dimmed" truncate>
                    {status.state === 'unset' ? SLOT_HINT[slot] : visual.secondary}
                  </Text>
                </Stack>
              </Group>
              <Group className="tc-model-status-row-actions" gap={2} wrap="nowrap">
                {targetVendorKey ? (
                  <Tooltip className="tc-model-status-row-jump-tooltip" label={`定位到 ${targetVendorKey}`} withArrow>
                    <ActionIcon
                      className="tc-model-status-row-jump"
                      size="sm"
                      variant="subtle"
                      aria-label={`jump-to-provider-${slot}`}
                      onClick={() => onJumpToProvider(targetVendorKey)}
                    >
                      <IconArrowRight size={14} />
                    </ActionIcon>
                  </Tooltip>
                ) : (
                  <Tooltip className="tc-model-status-row-config-tooltip" label="去 Providers 配置一个" withArrow>
                    <ActionIcon
                      className="tc-model-status-row-config"
                      size="sm"
                      variant="subtle"
                      aria-label={`scroll-to-providers-${slot}`}
                      onClick={() => onJumpToProvider(null)}
                    >
                      <IconArrowRight size={14} />
                    </ActionIcon>
                  </Tooltip>
                )}
                <Tooltip
                  className="tc-model-status-row-clear-tooltip"
                  label={canClear ? `清除 ${SLOT_LABEL[slot]}` : '当前未设置'}
                  withArrow
                >
                  <ActionIcon
                    className="tc-model-status-row-clear"
                    size="sm"
                    variant="subtle"
                    color="red"
                    disabled={!canClear || busy}
                    loading={busy}
                    aria-label={`clear-default-${slot}`}
                    onClick={() => onClearSlot(slot)}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          </Paper>
        )
      })}
    </Stack>
  )
}
