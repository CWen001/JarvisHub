import { useEffect, useRef } from 'react'

type DeferredSilentSaveInput = {
  enabled: boolean
  saving: boolean
  changeKey: string
  delayMs: number
  onTrigger: () => void
}

export function useDeferredSilentSave(input: DeferredSilentSaveInput): void {
  const savingRef = useRef(input.saving)
  const onTriggerRef = useRef(input.onTrigger)

  useEffect(() => {
    savingRef.current = input.saving
  }, [input.saving])

  useEffect(() => {
    onTriggerRef.current = input.onTrigger
  }, [input.onTrigger])

  useEffect(() => {
    if (!input.enabled) return
    if (savingRef.current) return
    if (typeof window === 'undefined') return
    const timer = window.setTimeout(() => {
      if (savingRef.current) return
      onTriggerRef.current()
    }, input.delayMs)
    return () => {
      window.clearTimeout(timer)
    }
  }, [input.enabled, input.changeKey, input.delayMs])
}
