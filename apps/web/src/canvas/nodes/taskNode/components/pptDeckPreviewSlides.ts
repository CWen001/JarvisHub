export type PptSlidePreview = {
  index: number
  title: string
  subtitle?: string
  bullets: string[]
  section?: string
  imageUrl?: string
  svgUrl?: string
  svgMarkup?: string
  speakerNotes?: string
}

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const readStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.map(readString).filter(Boolean)
}

const slidesFromOutline = (outline: string): PptSlidePreview[] => {
  return outline
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*#\d.\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((line, index) => ({ index, title: line, bullets: [], section: `P${index + 1}` }))
}

const normalizeSlides = (value: unknown): PptSlidePreview[] => {
  if (!Array.isArray(value)) return []
  return value.slice(0, 60).map((item, index) => {
    const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
    const title = readString(record.title) || readString(record.label) || `Slide ${index + 1}`
    const subtitle = readString(record.subtitle) || readString(record.summary)
    const section = readString(record.section)
    const bullets = readStringArray(record.bullets).slice(0, 6)
    const imageUrl = readString(record.imageUrl)
    const svgUrl = readString(record.svgUrl)
    const svgMarkup = readString(record.svgMarkup)
    const speakerNotes = readString(record.speakerNotes) || readString(record.notes)
    return { index, title, subtitle, section, bullets, imageUrl, svgUrl, svgMarkup, speakerNotes }
  })
}

export function resolvePptDeckPreviewSlides(input: {
  slides: unknown
  outline: string
}): PptSlidePreview[] {
  const slides = normalizeSlides(input.slides)
  return slides.length ? slides : slidesFromOutline(input.outline)
}
