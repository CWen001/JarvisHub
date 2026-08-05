#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { evaluateCompatibility } from './upstream-compatibility.mjs'

function git(repoRoot, args, options = {}) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', ...options }).trim()
}

function readCommittedChanges(repoRoot, ref) {
  const output = git(repoRoot, ['diff', '--numstat', `${ref}...HEAD`, '--'])
  return output ? output.split('\n').map((line) => {
    const [addedRaw, deletedRaw, ...pathParts] = line.split('\t')
    return {
      path: pathParts.join('\t'),
      added: addedRaw === '-' ? 0 : Number(addedRaw || 0),
      deleted: deletedRaw === '-' ? 0 : Number(deletedRaw || 0),
    }
  }) : []
}

export function buildReplayPlan({ registry, changes }) {
  const compatibility = evaluateCompatibility({ registry, changes })
  if (!compatibility.ok) {
    const paths = compatibility.violations.map((item) => item.path).join(', ')
    throw new Error(`Cannot replay an invalid Upstream Compatibility Surface: ${paths || compatibility.registryErrors.join('; ')}`)
  }
  return {
    productOwnedPaths: compatibility.productOwnedChanges.map((item) => item.path).sort(),
    touchpoints: compatibility.registeredTouchpoints
      .map((item) => ({ path: item.path, classification: item.classification }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  }
}

export function verifyReplayCoverage({ expectedPaths, replayedPaths }) {
  const expected = new Set(expectedPaths)
  const replayed = new Set(replayedPaths)
  return {
    ok: [...expected].every((path) => replayed.has(path)) && [...replayed].every((path) => expected.has(path)),
    missingPaths: [...expected].filter((path) => !replayed.has(path)).sort(),
    unexpectedPaths: [...replayed].filter((path) => !expected.has(path)).sort(),
  }
}

function applyPaths({ sourceRoot, replayRoot, ref, paths }) {
  if (paths.length === 0) return
  const patch = execFileSync(
    'git',
    ['-C', sourceRoot, 'diff', '--binary', `${ref}...HEAD`, '--', ...paths],
    { maxBuffer: 100 * 1024 * 1024 },
  )
  if (patch.length === 0) return
  execFileSync('git', ['-C', replayRoot, 'apply', '--index', '--binary', '-'], { input: patch })
}

function runValidationCommands(repoRoot, commands) {
  const results = []
  for (const command of commands) {
    const startedAt = Date.now()
    const run = spawnSync(command, { cwd: repoRoot, shell: true, stdio: 'inherit' })
    results.push({ command, ok: run.status === 0, durationMs: Date.now() - startedAt })
    if (run.status !== 0) throw new Error(`Replay validation failed: ${command}`)
  }
  return results
}

export function describeUpstreamDivergence(upstreamAheadCount) {
  return upstreamAheadCount > 0
    ? `${upstreamAheadCount} upstream commit(s) are not in Product HEAD; a real temporary-worktree merge or rebase rehearsal is required.`
    : 'no new upstream changes were present; this is replayability verification, not a conflict rehearsal.'
}

function reportMarkdown({ ref, sourceHead, upstreamAheadCount, plan, coverage, validationResults }) {
  const lines = [
    '# Upstream replayability report',
    '',
    `- Upstream baseline: \`${ref}\``,
    `- Product head: \`${sourceHead}\``,
    `- Upstream divergence: ${describeUpstreamDivergence(upstreamAheadCount)}`,
    `- Product-owned paths replayed: ${plan.productOwnedPaths.length}`,
    `- Integration Seams replayed: ${plan.touchpoints.filter((item) => item.classification === 'integration-seam').length}`,
    `- Upstream Patches replayed: ${plan.touchpoints.filter((item) => item.classification === 'upstream-patch').length}`,
    `- Coverage: ${coverage.ok ? 'PASS' : 'FAIL'}`,
    '',
    '## Registered native touchpoints',
    '',
    ...plan.touchpoints.map((item) => `- ${item.classification}: \`${item.path}\``),
    '',
    '## Validation commands',
    '',
    ...(validationResults.length
      ? validationResults.map((item) => `- ${item.ok ? 'PASS' : 'FAIL'} (${item.durationMs} ms): \`${item.command}\``)
      : ['- Not run by this invocation.']),
    '',
    '## Future upstream change',
    '',
    'When `upstream/main` diverges, run this replay in a temporary worktree first, then perform a real temporary-worktree merge or rebase rehearsal and record the actual conflict set.',
    '',
  ]
  if (!coverage.ok) {
    lines.push(`Missing: ${coverage.missingPaths.join(', ') || 'none'}`)
    lines.push(`Unexpected: ${coverage.unexpectedPaths.join(', ') || 'none'}`)
  }
  return lines.join('\n')
}

function parseArgs(argv) {
  const options = {
    repoRoot: process.cwd(),
    registry: 'config/upstream-compatibility.json',
    report: 'docs/upstream-compatibility/replay-report.md',
    runTests: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--repo-root') options.repoRoot = resolve(argv[++index])
    else if (arg === '--registry') options.registry = argv[++index]
    else if (arg === '--report') options.report = argv[++index]
    else if (arg === '--run-tests') options.runTests = true
    else if (arg === '--no-tests') options.runTests = false
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

export function runReplayCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const registry = JSON.parse(readFileSync(resolve(options.repoRoot, options.registry), 'utf8'))
  const ref = registry.upstreamRef
  git(options.repoRoot, ['rev-parse', '--verify', ref])
  const sourceHead = git(options.repoRoot, ['rev-parse', 'HEAD'])
  const upstreamAheadCount = Number(git(options.repoRoot, ['rev-list', '--count', `HEAD..${ref}`]) || 0)
  const changes = readCommittedChanges(options.repoRoot, ref)
  const plan = buildReplayPlan({ registry, changes })
  const tempRoot = mkdtempSync(join(tmpdir(), 'jarvishub-upstream-replay-'))
  const replayRoot = join(tempRoot, 'worktree')
  let coverage
  try {
    git(options.repoRoot, ['worktree', 'add', '--detach', replayRoot, ref])
    applyPaths({ sourceRoot: options.repoRoot, replayRoot, ref, paths: plan.productOwnedPaths })
    for (const touchpoint of plan.touchpoints) {
      applyPaths({ sourceRoot: options.repoRoot, replayRoot, ref, paths: [touchpoint.path] })
    }
    const replayedOutput = git(replayRoot, ['diff', '--name-only', ref, '--'])
    coverage = verifyReplayCoverage({
      expectedPaths: changes.map((item) => item.path),
      replayedPaths: replayedOutput ? replayedOutput.split('\n') : [],
    })
    if (!coverage.ok) throw new Error(`Replay coverage failed; missing=${coverage.missingPaths.join(',')}; unexpected=${coverage.unexpectedPaths.join(',')}`)
  } finally {
    try { git(options.repoRoot, ['worktree', 'remove', '--force', replayRoot]) } catch {}
    rmSync(tempRoot, { recursive: true, force: true })
  }
  const validationResults = options.runTests
    ? runValidationCommands(options.repoRoot, registry.replayValidationCommands || [])
    : []
  const report = reportMarkdown({ ref, sourceHead, upstreamAheadCount, plan, coverage, validationResults })
  writeFileSync(resolve(options.repoRoot, options.report), report)
  console.log(`Replayability: PASS (${changes.length} paths)`)
  console.log(`Report: ${resolve(options.repoRoot, options.report)}`)
  return { plan, coverage, validationResults }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) runReplayCli()
