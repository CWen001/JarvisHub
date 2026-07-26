import React from 'react'
import { notifications } from '@mantine/notifications'
import type { ModelConfigDefaultSlot } from '../../api/server'
import { SLOT_LABEL } from './slotStatus'

const UNDO_WINDOW_MS = 3000

type PreviousBinding = { vendorKey: string; modelKey: string }

export type UndoableSetSlotInput = {
  slot: ModelConfigDefaultSlot
  vendorKey: string
  modelKey: string
  modelLabel: string
  previous: PreviousBinding | null
}

export type UndoableSlotChangeApi = {
  /** Apply the new binding; if `previous` is non-null show a 3s undo toast that reverts on click. */
  setSlot: (input: UndoableSetSlotInput) => Promise<void>
}

export type UndoableSlotChangeDeps = {
  apply: (slot: ModelConfigDefaultSlot, vendorKey: string, modelKey: string) => Promise<void>
}

export function useUndoableSlotChange(deps: UndoableSlotChangeDeps): UndoableSlotChangeApi {
  const { apply } = deps
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const idRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const setSlot = React.useCallback<UndoableSlotChangeApi['setSlot']>(
    async ({ slot, vendorKey, modelKey, modelLabel, previous }) => {
      await apply(slot, vendorKey, modelKey)

      if (!previous) return
      if (previous.vendorKey === vendorKey && previous.modelKey === modelKey) return

      if (timerRef.current) clearTimeout(timerRef.current)
      const id = `slot-undo-${slot}-${Date.now()}`
      idRef.current = id

      notifications.show({
        id,
        color: 'blue',
        autoClose: UNDO_WINDOW_MS,
        withCloseButton: true,
        title: `${SLOT_LABEL[slot]} 已切换`,
        message: `已绑定到 ${modelLabel}（3 秒内点击撤销可恢复）`,
        onClick: () => {
          if (idRef.current !== id) return
          idRef.current = null
          if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
          }
          notifications.hide(id)
          void apply(slot, previous.vendorKey, previous.modelKey).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : '撤销失败'
            notifications.show({ color: 'red', title: '撤销失败', message: msg })
          })
        },
      })

      timerRef.current = setTimeout(() => {
        if (idRef.current === id) idRef.current = null
        timerRef.current = null
      }, UNDO_WINDOW_MS)
    },
    [apply],
  )

  return { setSlot }
}

/**
 * Detect cascade self-heal: backend cleared a slot=agent default that the user did not initiate.
 * Compare prev/next defaults arrays and surface a toast pointing the user back to ModelPanel.
 */
export function detectCascadeSelfHeal(
  prevDefaults: ReadonlyArray<{ slot: ModelConfigDefaultSlot }>,
  nextDefaults: ReadonlyArray<{ slot: ModelConfigDefaultSlot }>,
  options: { userInitiatedClear: boolean },
): ModelConfigDefaultSlot | null {
  if (options.userInitiatedClear) return null
  for (const d of prevDefaults) {
    if (d.slot !== 'agent') continue
    const stillThere = nextDefaults.some((n) => n.slot === 'agent')
    if (!stillThere) return 'agent'
  }
  return null
}
