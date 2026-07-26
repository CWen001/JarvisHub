export type AttachedDocKind = 'text' | 'markdown' | 'pdf'

export type AttachedDoc = {
  id: string
  name: string
  kind: AttachedDocKind
  sizeBytes: number
  contentText: string
}

const TEXT_EXTENSIONS = new Set(['txt', 'log', 'csv', 'tsv', 'json', 'yaml', 'yml'])
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd'])
const PDF_EXTENSIONS = new Set(['pdf'])

export type ClassifiedFile =
  | { kind: 'image'; file: File }
  | { kind: 'doc'; file: File; docKind: AttachedDocKind }
  | { kind: 'unsupported'; file: File }

export function classifyUploadedFile(file: File): ClassifiedFile {
  const mime = String(file.type || '').toLowerCase()
  const name = String(file.name || '')
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''

  if (mime.startsWith('image/')) return { kind: 'image', file }

  if (mime === 'application/pdf' || PDF_EXTENSIONS.has(ext)) {
    return { kind: 'doc', file, docKind: 'pdf' }
  }
  if (mime === 'text/markdown' || MARKDOWN_EXTENSIONS.has(ext)) {
    return { kind: 'doc', file, docKind: 'markdown' }
  }
  if (mime.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) {
    return { kind: 'doc', file, docKind: 'text' }
  }

  return { kind: 'unsupported', file }
}

async function readFileAsText(file: File): Promise<string> {
  const reader = new FileReader()
  return new Promise((resolve, reject) => {
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.onload = () => {
      const result = reader.result
      resolve(typeof result === 'string' ? result : '')
    }
    reader.readAsText(file)
  })
}

export async function parseAttachedDoc(
  file: File,
  docKind: AttachedDocKind,
): Promise<AttachedDoc> {
  const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const name =
    typeof file?.name === 'string' && file.name.trim() ? file.name.trim() : `upload-${id}`
  const sizeBytes = typeof file?.size === 'number' ? file.size : 0

  let contentText = ''
  if (docKind === 'pdf') {
    const { extractPdfText } = await import('./pdfTextExtract')
    contentText = await extractPdfText(file)
  } else {
    contentText = await readFileAsText(file)
  }

  return {
    id,
    name,
    kind: docKind,
    sizeBytes,
    contentText: String(contentText || '').trim(),
  }
}

export function formatDocSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const MAX_INLINE_CHARS_PER_DOC = 60000

export function buildAttachedDocsPromptBlock(docs: readonly AttachedDoc[]): string {
  if (!docs.length) return ''
  const parts = docs.map((doc) => {
    const body = doc.contentText.length > MAX_INLINE_CHARS_PER_DOC
      ? `${doc.contentText.slice(0, MAX_INLINE_CHARS_PER_DOC)}\n[... 截断：原文共 ${doc.contentText.length} 字符，已截取前 ${MAX_INLINE_CHARS_PER_DOC} 字符]`
      : doc.contentText
    const escapedName = doc.name.replace(/"/g, '\\"')
    return [
      `<<<USER_UPLOADED_FILE name="${escapedName}" kind="${doc.kind}" bytes=${doc.sizeBytes}>>>`,
      body,
      '<<<END_FILE>>>',
    ].join('\n')
  })
  return parts.join('\n\n')
}
