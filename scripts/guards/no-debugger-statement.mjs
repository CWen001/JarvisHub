import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT_DIR = process.cwd()
const STAGED_MODE = process.argv.includes('--staged')
const TARGET_DIRS = ['apps/web', 'apps/hono-api', 'scripts', '.github', 'docs']
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.pnpm-store',
  '.wrangler',
  'coverage',
  'test-results',
  'dist-tmp',
])
const TARGET_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
])
const ALLOWLIST_PATTERNS = [
  /\/scripts\/guards\//,
  /\/apps\/web\/src\/ui\/stats\/system\/StatsPublicApiDebugger\.tsx$/,
  /\/apps\/web\/src\/ui\/stats\/system\/StatsSystemManagement\.tsx$/,
  /\/apps\/web\/src\/ui\/stats\/system\/StatsMemoryContextDebugger\.tsx$/,
  /\/apps\/web\/src\/ui\/stats\/system\/StatsMemoryDebugger\.tsx$/,
]

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      files.push(...(await collectFiles(fullPath)))
      continue
    }
    if (!entry.isFile()) continue
    files.push(fullPath)
  }
  return files
}

async function collectTargetFiles() {
  const files = []
  for (const relDir of TARGET_DIRS) {
    const absDir = path.join(ROOT_DIR, relDir)
    const meta = await stat(absDir).catch(() => null)
    if (!meta || !meta.isDirectory()) continue
    files.push(...(await collectFiles(absDir)))
  }
  return files
}

function collectStagedFiles() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  })
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((rel) => path.join(ROOT_DIR, rel))
}

function isAllowed(filePath) {
  const normalized = filePath.split(path.sep).join('/')
  return ALLOWLIST_PATTERNS.some((pattern) => pattern.test(normalized))
}

function containsDebugger(code) {
  return /(^|[^\w$])debugger\s*;?/m.test(code)
}

async function main() {
  const allFiles = STAGED_MODE ? collectStagedFiles() : await collectTargetFiles()
  const violations = []

  for (const filePath of allFiles) {
    if (isAllowed(filePath)) continue
    const ext = path.extname(filePath).toLowerCase()
    if (!TARGET_EXTS.has(ext)) continue
    const code = await readFile(filePath, 'utf8').catch(() => '')
    if (!code) continue
    if (containsDebugger(code)) {
      violations.push(path.relative(ROOT_DIR, filePath))
    }
  }

  if (violations.length > 0) {
    console.error('Found forbidden debugger statements:')
    for (const file of violations) {
      const content = await readFile(path.join(ROOT_DIR, file), 'utf8').catch(() => '')
      const lines = content.split('\n')
      const lineNo = lines.findIndex((l) => /(^|[^\w$])debugger\s*;?/.test(l)) + 1
      const snippet = lines[lineNo - 1]?.trim() ?? ''
      console.error(`- ${file}:${lineNo}: ${snippet}`)
    }
    process.exit(1)
  }

  console.log('No debugger statements found.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
