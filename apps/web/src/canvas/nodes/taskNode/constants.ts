export const BASE_DURATION_OPTIONS = Array.from({ length: 12 }, (_item, index) => {
  const value = String(index + 4)
  return { value, label: `${value}s` }
})

export const VEO_DURATION_OPTIONS = [
  { value: '5', label: '5s' },
] as const

export const MINIMAX_DURATION_OPTIONS = [
  { value: '5', label: '5s' },
] as const

export const SAMPLE_OPTIONS = [1, 2, 3, 4, 5] as const
