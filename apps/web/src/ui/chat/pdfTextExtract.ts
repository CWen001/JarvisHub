// Lazy module: only loaded when a PDF file is attached, so pdfjs-dist is not in the main chunk.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

const globalOptions = pdfjs.GlobalWorkerOptions as { workerSrc: string }
if (!globalOptions.workerSrc) {
  globalOptions.workerSrc = workerUrl
}

export async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: buffer })
  const pdf = await loadingTask.promise
  const pageTexts: string[] = []
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo)
    const textContent = await page.getTextContent()
    const items = textContent.items as Array<{ str?: unknown }>
    const lineParts: string[] = []
    for (const item of items) {
      const str = typeof item?.str === 'string' ? item.str : ''
      if (str) lineParts.push(str)
    }
    pageTexts.push(`# Page ${pageNo}\n${lineParts.join(' ')}`.trim())
  }
  return pageTexts.join('\n\n').trim()
}
