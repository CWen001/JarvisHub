import React from 'react'
import { Tooltip, UnstyledButton } from '@mantine/core'
import type { ModelConfigDefaultSlot } from '../../api/server'
import { REASON_TEXT, SLOT_LABEL, type SlotEligibility } from './slotStatus'

export type ModelSlotChipProps = {
  className?: string
  slot: ModelConfigDefaultSlot
  bound: boolean
  eligibility: SlotEligibility
  loading: boolean
  onClick: () => void
}

const SHORT_LABEL: Record<ModelConfigDefaultSlot, string> = {
  agent: 'Agent',
  image: 'Image',
  video: 'Video',
  multimodal: 'Multimodal',
}

export default function ModelSlotChip({
  className,
  slot,
  bound,
  eligibility,
  loading,
  onClick,
}: ModelSlotChipProps): JSX.Element {
  const rootClassName = [
    'tc-model-slot-chip',
    `tc-model-slot-chip--${slot}`,
    bound ? 'tc-model-slot-chip--bound' : 'tc-model-slot-chip--unbound',
    !eligibility.eligible ? 'tc-model-slot-chip--disabled' : null,
    loading ? 'tc-model-slot-chip--loading' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const tooltipLabel = bound
    ? `当前 ${SLOT_LABEL[slot]}（点击 StatusOverview 行可清除）`
    : eligibility.eligible
      ? `点击设为 ${SLOT_LABEL[slot]}`
      : `不可绑定到 ${SLOT_LABEL[slot]}：${REASON_TEXT[eligibility.reason]}`

  const interactive = !bound && eligibility.eligible && !loading
  const dot = bound ? '●' : '○'

  return (
    <Tooltip className="tc-model-slot-chip-tooltip" label={tooltipLabel} withArrow position="top">
      <UnstyledButton
        className={rootClassName}
        aria-label={`slot-chip-${slot}-${bound ? 'bound' : 'unbound'}`}
        aria-disabled={!interactive}
        disabled={!interactive}
        onClick={() => {
          if (!interactive) return
          onClick()
        }}
        style={{
          fontSize: 11,
          lineHeight: 1,
          padding: '3px 7px',
          borderRadius: 999,
          border: '1px solid',
          borderColor: bound
            ? 'var(--mantine-color-blue-5)'
            : eligibility.eligible
              ? 'var(--mantine-color-default-border)'
              : 'var(--mantine-color-gray-3)',
          background: bound
            ? 'var(--mantine-color-blue-light)'
            : 'transparent',
          color: bound
            ? 'var(--mantine-color-blue-7)'
            : eligibility.eligible
              ? 'var(--mantine-color-text)'
              : 'var(--mantine-color-dimmed)',
          cursor: interactive ? 'pointer' : 'default',
          opacity: !eligibility.eligible ? 0.55 : 1,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontWeight: bound ? 600 : 500,
          userSelect: 'none',
        }}
      >
        <span className="tc-model-slot-chip-dot" aria-hidden>{dot}</span>
        <span className="tc-model-slot-chip-label">{SHORT_LABEL[slot]}</span>
      </UnstyledButton>
    </Tooltip>
  )
}
