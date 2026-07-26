export type ImageResolutionPreset = '1K' | '2K' | '4K'

const EXPLICIT_IMAGE_RESOLUTION_TOKEN_PATTERN = /(^|[^A-Za-z0-9])([１２４124])\s*[kKＫｋ](?=$|[^A-Za-z0-9])/g
const FULLWIDTH_DIGIT_TO_ASCII: Record<string, ImageResolutionPreset> = {
  '１': '1K',
  '1': '1K',
  '２': '2K',
  '2': '2K',
  '４': '4K',
  '4': '4K',
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function inferImageResolutionFromPrompt(prompt: unknown): ImageResolutionPreset | undefined {
  const text = readTrimmedString(prompt)
  if (!text) return undefined
  EXPLICIT_IMAGE_RESOLUTION_TOKEN_PATTERN.lastIndex = 0
  const match = EXPLICIT_IMAGE_RESOLUTION_TOKEN_PATTERN.exec(text)
  if (!match) return undefined
  const digit = match[2] || ''
  return FULLWIDTH_DIGIT_TO_ASCII[digit]
}

export function resolveImageResolutionSetting(input: {
  imageResolution?: unknown
  resolution?: unknown
  prompt?: unknown
}): string | undefined {
  const explicitImageResolution = readTrimmedString(input.imageResolution)
  if (explicitImageResolution) return explicitImageResolution
  const explicitResolution = readTrimmedString(input.resolution)
  if (explicitResolution) return explicitResolution
  return inferImageResolutionFromPrompt(input.prompt)
}
