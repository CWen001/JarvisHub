// Pure, dependency-free text-node size estimator shared by the frontend
// (apps/web) and the backend (apps/hono-api) so BOTH ends size a text node
// identically. Backend layout coordinates are only trustworthy if the server
// estimates a text node's box the same way the browser renders it — otherwise
// long (esp. CJK) content overflows whatever the backend stacked beneath it.
//
// This module has zero runtime dependencies (only Number/Math/RegExp/String)
// and must stay that way: it is transpiled independently by Vite/esbuild
// (web) and ts-node/esbuild (hono-api).

export type TextNodeSize = { w: number; h: number }

// Mirrors NODE_SIZE_PROFILES.text in apps/web/src/canvas/nodeSizes.ts. Kept in
// sync by canvas-layout.textNodeSize.test.ts (profile-parity guard).
export const TEXT_NODE_SIZE_PROFILE = {
  defaultW: 460,
  defaultH: 360,
  minW: 240,
  maxW: 1240,
  minH: 240,
  maxH: 680,
} as const

const TEXT_LAYOUT_LINE_HEIGHT = 22
const TEXT_LAYOUT_CHROME_HEIGHT = 104
const TEXT_LAYOUT_HORIZONTAL_CHROME = 64
const TEXT_LAYOUT_AVG_CHAR_PX = 8.4

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function readPositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

// Width "units": CJK/full-width chars count as 1.65, whitespace 0.45, ascii 1.
// This is what makes the estimate accurate for Chinese-heavy content.
function textLayoutUnits(value: string): number {
  let units = 0
  for (const char of value) {
    if (/\s/.test(char)) {
      units += 0.45
    } else if (char.charCodeAt(0) > 255) {
      units += 1.65
    } else {
      units += 1
    }
  }
  return units
}

// Collects the layout-relevant text from a task node's data record, de-duped,
// in priority order (prompt > content > text > latest result > label).
export function readTextLayoutContent(data: Record<string, unknown>): string {
  const textResultsLatest =
    Array.isArray(data.textResults) && data.textResults.length > 0
      ? readTrimmedString(readRecord(data.textResults[data.textResults.length - 1])?.text)
      : ''
  const rawValues = [
    data.prompt,
    data.content,
    data.text,
    textResultsLatest,
    data.label,
  ]
  const seen = new Set<string>()
  const values: string[] = []
  for (const value of rawValues) {
    const text = readTrimmedString(value)
    if (!text || seen.has(text)) continue
    seen.add(text)
    values.push(text)
  }
  return values.join('\n')
}

// Estimate a text node's rendered box from its data. Before manual ownership,
// `baseSize` is the measured/known box used as a floor. After manual ownership,
// the persisted nodeWidth/nodeHeight values are authoritative.
export function estimateTextNodeSize(data: Record<string, unknown>, baseSize?: TextNodeSize): TextNodeSize {
  const profile = TEXT_NODE_SIZE_PROFILE
  const content = readTextLayoutContent(data)
  const manuallySized = data.textManualSized === true
  const storedW = readPositiveNumber(data.nodeWidth)
  const storedH = readPositiveNumber(data.nodeHeight)
  const existingW = manuallySized
    ? storedW ?? baseSize?.w ?? profile.defaultW
    : baseSize?.w ?? storedW ?? profile.defaultW
  const existingH = manuallySized
    ? storedH ?? baseSize?.h ?? profile.defaultH
    : baseSize?.h ?? storedH ?? profile.defaultH

  if (manuallySized) {
    return {
      w: Math.round(clampNumber(existingW, profile.minW, profile.maxW)),
      h: Math.round(clampNumber(existingH, profile.minH, profile.maxH)),
    }
  }

  if (!content) {
    return {
      w: Math.round(clampNumber(Math.max(existingW, profile.defaultW), profile.minW, profile.maxW)),
      h: Math.round(clampNumber(existingH, profile.minH, profile.maxH)),
    }
  }

  const lines = content.split(/\r?\n/)
  const longestLineUnits = Math.max(1, ...lines.map(textLayoutUnits))
  const estimatedW = clampNumber(
    Math.ceil(TEXT_LAYOUT_HORIZONTAL_CHROME + longestLineUnits * TEXT_LAYOUT_AVG_CHAR_PX),
    profile.defaultW,
    profile.maxW,
  )
  const width = Math.round(clampNumber(Math.max(existingW, estimatedW), profile.minW, profile.maxW))
  const charsPerLine = Math.max(16, Math.floor((width - TEXT_LAYOUT_HORIZONTAL_CHROME) / TEXT_LAYOUT_AVG_CHAR_PX))
  const visualLineCount = lines.reduce((sum, line) => {
    const units = Math.max(1, textLayoutUnits(line))
    return sum + Math.max(1, Math.ceil(units / charsPerLine))
  }, 0)
  const estimatedH = TEXT_LAYOUT_CHROME_HEIGHT + visualLineCount * TEXT_LAYOUT_LINE_HEIGHT
  const height = Math.round(clampNumber(Math.max(existingH, estimatedH, profile.defaultH), profile.minH, profile.maxH))
  return { w: width, h: height }
}
