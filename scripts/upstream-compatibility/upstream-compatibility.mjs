#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ACTION = 'Move Product behavior into a Product-owned root, or register a narrow Integration Seam / Upstream Patch.'

function normalizePath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '')
}

function matchesOwnedRoot(filePath, pattern) {
  const path = normalizePath(filePath)
  const root = normalizePath(pattern)
  if (!root) return false
  if (root.endsWith('/**')) {
    const prefix = root.slice(0, -3).replace(/\/$/, '')
    return path === prefix || path.startsWith(`${prefix}/`)
  }
  if (root.includes('*')) {
    const escaped = root.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    const expression = escaped.replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*')
    return new RegExp(`^${expression}$`).test(path)
  }
  return path === root
}

function validateRegistry(registry) {
  const errors = []
  if (!registry || typeof registry !== 'object') return ['registry must be an object']
  if (!String(registry.upstreamRef || '').trim()) errors.push('registry.upstreamRef is required')
  if (!Array.isArray(registry.productOwnedRoots) || registry.productOwnedRoots.length === 0) {
    errors.push('registry.productOwnedRoots must contain at least one Product-owned root')
  }
  const seenRoots = new Set()
  for (const root of registry.productOwnedRoots || []) {
    const path = normalizePath(root?.path)
    if (!path || !String(root?.owner || '').trim()) errors.push(`invalid Product-owned root: ${path || '<missing path>'}`)
    if (seenRoots.has(path)) errors.push(`duplicate Product-owned root: ${path}`)
    seenRoots.add(path)
  }
  const seenTouchpoints = new Set()
  for (const touchpoint of registry.touchpoints || []) {
    const path = normalizePath(touchpoint?.path)
    const classification = String(touchpoint?.classification || '').trim()
    if (!path || seenTouchpoints.has(path)) errors.push(`${path || '<missing path>'}: touchpoint path must be unique`)
    if (classification !== 'integration-seam' && classification !== 'upstream-patch') {
      errors.push(`${path || '<missing path>'}: classification must be integration-seam or upstream-patch`)
    }
    if (!String(touchpoint?.purpose || '').trim()) errors.push(`${path || '<missing path>'}: purpose is required`)
    if (!String(touchpoint?.adapter || '').trim()) errors.push(`${path || '<missing path>'}: owning adapter is required`)
    if (!Array.isArray(touchpoint?.tests) || touchpoint.tests.length === 0) errors.push(`${path || '<missing path>'}: contract tests are required`)
    if (!String(touchpoint?.upstreamDisposition || '').trim()) errors.push(`${path || '<missing path>'}: upstream disposition is required`)
    seenTouchpoints.add(path)
  }
  return errors
}

export function evaluateCompatibility({ registry, changes }) {
  const registryErrors = validateRegistry(registry)
  const violations = []
  const warnings = []
  const productOwnedChanges = []
  const registeredTouchpoints = []
  const touchpointByPath = new Map((registry?.touchpoints || []).map((item) => [normalizePath(item.path), item]))

  for (const rawChange of changes || []) {
    const change = { ...rawChange, path: normalizePath(rawChange.path) }
    const owned = (registry?.productOwnedRoots || []).find((root) => matchesOwnedRoot(change.path, root.path))
    if (owned) {
      productOwnedChanges.push({ ...change, owner: owned.owner })
      continue
    }
    const touchpoint = touchpointByPath.get(change.path)
    if (!touchpoint) {
      violations.push({ path: change.path, reason: 'unregistered_upstream_derived_change', action: ACTION })
      continue
    }
    registeredTouchpoints.push({ ...change, ...touchpoint })
    const changedLines = Number(change.added || 0) + Number(change.deleted || 0)
    const warningChangedLines = Number(touchpoint.warningChangedLines || 0)
    if (warningChangedLines > 0 && changedLines > warningChangedLines) {
      warnings.push({ path: change.path, reason: 'registered_touchpoint_growth', changedLines, warningChangedLines })
    }
  }

  return {
    ok: registryErrors.length === 0 && violations.length === 0,
    registryErrors,
    violations,
    warnings,
    productOwnedChanges,
    registeredTouchpoints,
  }
}

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim()
}

function parseNumstat(output) {
  return output ? output.split('\n').filter(Boolean).map((line) => {
    const [addedRaw, deletedRaw, ...pathParts] = line.split('\t')
    return {
      path: pathParts.join('\t'),
      added: addedRaw === '-' ? 0 : Number(addedRaw || 0),
      deleted: deletedRaw === '-' ? 0 : Number(deletedRaw || 0),
    }
  }) : []
}

export function mergeGitChanges(...groups) {
  const byPath = new Map()
  for (const change of groups.flat()) {
    const path = normalizePath(change.path)
    const previous = byPath.get(path) || { path, added: 0, deleted: 0 }
    byPath.set(path, {
      path,
      added: previous.added + Number(change.added || 0),
      deleted: previous.deleted + Number(change.deleted || 0),
      ...(previous.untracked || change.untracked ? { untracked: true } : {}),
    })
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function readGitChanges(repoRoot, ref, includeUntracked) {
  const committed = parseNumstat(git(repoRoot, ['diff', '--numstat', `${ref}...HEAD`, '--']))
  const worktree = parseNumstat(git(repoRoot, ['diff', '--numstat', 'HEAD', '--']))
  const changes = mergeGitChanges(committed, worktree)
  if (includeUntracked) {
    const untracked = git(repoRoot, ['ls-files', '--others', '--exclude-standard'])
    const known = new Set(changes.map((item) => item.path))
    for (const path of untracked ? untracked.split('\n') : []) {
      if (path && !known.has(path)) changes.push({ path, added: 0, deleted: 0, untracked: true })
    }
  }
  return changes
}

function parseArgs(argv) {
  const options = { registry: 'config/upstream-compatibility.json', repoRoot: process.cwd(), includeUntracked: false, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--registry') options.registry = argv[++index]
    else if (arg === '--repo-root') options.repoRoot = argv[++index]
    else if (arg === '--ref') options.ref = argv[++index]
    else if (arg === '--include-untracked') options.includeUntracked = true
    else if (arg === '--json') options.json = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function printHuman(result, ref) {
  console.log(`Upstream Compatibility Surface against ${ref}`)
  console.log(`Product-owned changes: ${result.productOwnedChanges.length}`)
  console.log(`Registered touchpoints: ${result.registeredTouchpoints.length}`)
  for (const item of result.registeredTouchpoints) console.log(`  ${item.classification}: ${item.path}`)
  for (const warning of result.warnings) console.warn(`WARNING ${warning.path}: ${warning.changedLines} changed lines exceed ${warning.warningChangedLines}`)
  for (const error of result.registryErrors) console.error(`REGISTRY ERROR ${error}`)
  for (const violation of result.violations) console.error(`UNREGISTERED ${violation.path}: ${violation.action}`)
  console.log(result.ok ? 'Compatibility surface: PASS' : 'Compatibility surface: FAIL')
}

export function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const registry = JSON.parse(readFileSync(new URL(options.registry, pathToFileURL(`${options.repoRoot}/`)), 'utf8'))
  const ref = options.ref || registry.upstreamRef
  const result = evaluateCompatibility({ registry, changes: readGitChanges(options.repoRoot, ref, options.includeUntracked) })
  if (options.json) console.log(JSON.stringify({ ref, ...result }, null, 2))
  else printHuman(result, ref)
  if (!result.ok) process.exitCode = 1
  return result
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) runCli()
