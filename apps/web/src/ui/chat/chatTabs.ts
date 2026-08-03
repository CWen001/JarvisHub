import type { ChatSessionLane } from './chatSessionKey'

export const AI_CHAT_TABS_BY_PROJECT_STORAGE_KEY = 'canvas.aiChat.tabs.byProject.v1'
export const AI_CHAT_TABS_STORAGE_KEY = 'canvas.aiChat.tabs.v1'
export const AI_CHAT_LEGACY_SESSION_STORAGE_KEY = 'canvas.aiChat.sessionBaseKey.v1'

const DEFAULT_CHAT_TAB_TITLE = '新对话'
const CHAT_TAB_TITLE_MAX_CHARS = 26

export type AiChatTabSessionSkillRef = {
  id: string
  key: string
  name: string
}

export type AiChatTabSessionScope = {
  projectId: string
  flowId: string
  lane: ChatSessionLane
  skill: AiChatTabSessionSkillRef | null
}

export type AiChatTabRecord = {
  id: string
  baseKey: string
  title: string
  createdAt: number
  updatedAt: number
  sessionKey?: string
  sessionScope?: AiChatTabSessionScope
}

export type AiChatTabsState = {
  activeTabId: string
  tabs: AiChatTabRecord[]
}

type AiChatTabsStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type AiChatTabsEnvironment = {
  storage?: AiChatTabsStorage
  now?: () => number
  createBaseKey?: () => string
  createTabId?: () => string
}

type CreateAiChatTabInput = AiChatTabsEnvironment & {
  baseKey?: string
  title?: string
}

type BindAiChatTabSessionInput = AiChatTabsEnvironment & {
  sessionKey: string
  scope: AiChatTabSessionScope
}

function getStorage(input?: AiChatTabsEnvironment): AiChatTabsStorage | null {
  if (input?.storage) return input.storage
  if (typeof window === 'undefined') return null
  return window.localStorage
}

function getNow(input?: AiChatTabsEnvironment): number {
  const value = input?.now?.() ?? Date.now()
  return Number.isFinite(value) ? value : Date.now()
}

export function createAiChatSessionBaseKey(): string {
  const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `canvas-${seed}`
}

function createAiChatTabId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `tab-${crypto.randomUUID()}`
    }
  } catch {
    // ignore
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function createBaseKey(input?: AiChatTabsEnvironment): string {
  const value = input?.createBaseKey?.() || createAiChatSessionBaseKey()
  return normalizeString(value) || createAiChatSessionBaseKey()
}

function createTabId(input?: AiChatTabsEnvironment): string {
  const value = input?.createTabId?.() || createAiChatTabId()
  return normalizeString(value) || createAiChatTabId()
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

export function normalizeAiChatTabTitle(value: unknown): string {
  const firstLine = normalizeString(value)
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || DEFAULT_CHAT_TAB_TITLE
  if (firstLine.length <= CHAT_TAB_TITLE_MAX_CHARS) return firstLine
  return `${firstLine.slice(0, CHAT_TAB_TITLE_MAX_CHARS - 1).trimEnd()}…`
}

function createAiChatTab(input?: CreateAiChatTabInput): AiChatTabRecord {
  const now = getNow(input)
  return {
    id: createTabId(input),
    baseKey: normalizeString(input?.baseKey) || createBaseKey(input),
    title: normalizeAiChatTabTitle(input?.title),
    createdAt: now,
    updatedAt: now,
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizeAiChatTabSessionSkill(value: unknown): AiChatTabSessionSkillRef | null {
  const record = readRecord(value)
  if (!record) return null
  const id = normalizeString(record.id)
  const key = normalizeString(record.key)
  const name = normalizeString(record.name)
  if (!id) return null
  return { id, key, name }
}

function normalizeChatSessionLane(value: unknown): ChatSessionLane | null {
  return value === 'general' ? 'general' : null
}

function normalizeAiChatTabSessionScope(value: unknown): AiChatTabSessionScope | null {
  const record = readRecord(value)
  if (!record) return null
  const projectId = normalizeString(record.projectId)
  const flowId = normalizeString(record.flowId)
  const lane = normalizeChatSessionLane(record.lane)
  if (!projectId || !lane) return null
  const skill = (() => {
    if (record.skill === null) return null
    return normalizeAiChatTabSessionSkill(record.skill)
  })()
  if (record.skill !== null && !skill) return null
  return {
    projectId,
    flowId,
    lane,
    skill,
  }
}

function areSameSessionScopes(
  left: AiChatTabSessionScope | undefined,
  right: AiChatTabSessionScope,
): boolean {
  return Boolean(
    left &&
    left.projectId === right.projectId &&
    left.flowId === right.flowId &&
    left.lane === right.lane &&
    left.skill?.id === right.skill?.id &&
    left.skill?.key === right.skill?.key &&
    left.skill?.name === right.skill?.name,
  )
}

function normalizeAiChatTabRecord(value: unknown): AiChatTabRecord | null {
  const record = readRecord(value)
  if (!record) return null
  const id = normalizeString(record.id)
  const baseKey = normalizeString(record.baseKey)
  if (!id || !baseKey) return null
  const fallbackTime = Date.now()
  const sessionKey = normalizeString(record.sessionKey)
  const sessionScope = sessionKey ? normalizeAiChatTabSessionScope(record.sessionScope) : null
  return {
    id,
    baseKey,
    title: normalizeAiChatTabTitle(record.title),
    createdAt: normalizeTimestamp(record.createdAt, fallbackTime),
    updatedAt: normalizeTimestamp(record.updatedAt, fallbackTime),
    ...(sessionKey && sessionScope ? { sessionKey, sessionScope } : {}),
  }
}

function normalizeAiChatTabsState(value: unknown): AiChatTabsState | null {
  const record = readRecord(value)
  if (!record || !Array.isArray(record.tabs)) return null
  const tabs = record.tabs
    .map((item) => normalizeAiChatTabRecord(item))
    .filter((item): item is AiChatTabRecord => item !== null)
  if (!tabs.length) return null
  const activeTabId = normalizeString(record.activeTabId)
  const activeExists = tabs.some((tab) => tab.id === activeTabId)
  return {
    activeTabId: activeExists ? activeTabId : tabs[0]!.id,
    tabs,
  }
}

function readByProjectRecord(storage: AiChatTabsStorage): Record<string, AiChatTabsState> {
  try {
    const raw = storage.getItem(AI_CHAT_TABS_BY_PROJECT_STORAGE_KEY)
    if (!raw || !raw.trim()) return {}
    const record = readRecord(JSON.parse(raw))
    if (!record) return {}
    const out: Record<string, AiChatTabsState> = {}
    for (const [key, value] of Object.entries(record)) {
      const projectId = normalizeString(key)
      if (!projectId) continue
      const normalized = normalizeAiChatTabsState(value)
      if (normalized) out[projectId] = normalized
    }
    return out
  } catch {
    return {}
  }
}

function writeByProjectRecord(
  storage: AiChatTabsStorage,
  record: Record<string, AiChatTabsState>,
): void {
  try {
    storage.setItem(AI_CHAT_TABS_BY_PROJECT_STORAGE_KEY, JSON.stringify(record))
  } catch {
    // ignore local persistence failures
  }
}

function readLegacyTabsForProject(
  storage: AiChatTabsStorage,
  projectId: string,
): AiChatTabRecord[] {
  try {
    const raw = storage.getItem(AI_CHAT_TABS_STORAGE_KEY)
    if (!raw || !raw.trim()) return []
    const parsed = normalizeAiChatTabsState(JSON.parse(raw))
    if (!parsed) return []
    return parsed.tabs.filter((tab) => tab.sessionScope?.projectId === projectId)
  } catch {
    return []
  }
}

export function writeAiChatTabsState(
  state: AiChatTabsState,
  projectId: string,
  input?: AiChatTabsEnvironment,
): void {
  const normalizedProjectId = normalizeString(projectId)
  if (!normalizedProjectId) return
  const storage = getStorage(input)
  if (!storage) return
  const record = readByProjectRecord(storage)
  record[normalizedProjectId] = state
  writeByProjectRecord(storage, record)
}

export function peekAiChatTabsState(
  projectId: string,
  input?: AiChatTabsEnvironment,
): AiChatTabsState | null {
  const normalizedProjectId = normalizeString(projectId)
  const storage = getStorage(input)
  if (!normalizedProjectId || !storage) return null
  const existing = readByProjectRecord(storage)[normalizedProjectId]
  if (existing) return existing
  const migratedTabs = readLegacyTabsForProject(storage, normalizedProjectId)
  return migratedTabs.length
    ? { activeTabId: migratedTabs[0]!.id, tabs: migratedTabs }
    : null
}

export function readAiChatTabsState(
  projectId: string,
  input?: AiChatTabsEnvironment,
): AiChatTabsState {
  const normalizedProjectId = normalizeString(projectId)
  const storage = getStorage(input)

  if (normalizedProjectId && storage) {
    const record = readByProjectRecord(storage)
    const existing = record[normalizedProjectId]
    if (existing) return existing

    const migratedTabs = readLegacyTabsForProject(storage, normalizedProjectId)
    if (migratedTabs.length) {
      const migrated: AiChatTabsState = {
        activeTabId: migratedTabs[0]!.id,
        tabs: migratedTabs,
      }
      record[normalizedProjectId] = migrated
      writeByProjectRecord(storage, record)
      return migrated
    }
  }

  const tab = createAiChatTab({
    ...input,
    title: DEFAULT_CHAT_TAB_TITLE,
  })
  const state = { activeTabId: tab.id, tabs: [tab] }
  if (normalizedProjectId) {
    writeAiChatTabsState(state, normalizedProjectId, input)
  }
  return state
}

export function addAiChatTab(
  state: AiChatTabsState,
  input?: CreateAiChatTabInput,
): AiChatTabsState {
  const tab = createAiChatTab(input)
  const tabs = [...state.tabs, tab]
  return {
    activeTabId: tab.id,
    tabs,
  }
}

export function selectAiChatTab(state: AiChatTabsState, tabId: string): AiChatTabsState {
  const normalizedTabId = normalizeString(tabId)
  if (!normalizedTabId || state.activeTabId === normalizedTabId) return state
  if (!state.tabs.some((tab) => tab.id === normalizedTabId)) return state
  return {
    ...state,
    activeTabId: normalizedTabId,
  }
}

export function closeAiChatTab(state: AiChatTabsState, tabId: string): AiChatTabsState {
  const normalizedTabId = normalizeString(tabId)
  const closingIndex = state.tabs.findIndex((tab) => tab.id === normalizedTabId)
  if (closingIndex < 0 || state.tabs.length <= 1) return state

  const tabs = state.tabs.filter((tab) => tab.id !== normalizedTabId)
  if (state.activeTabId !== normalizedTabId) {
    return {
      activeTabId: state.activeTabId,
      tabs,
    }
  }

  const nextActiveTab = tabs[Math.min(closingIndex, tabs.length - 1)] || tabs[0]
  return {
    activeTabId: nextActiveTab.id,
    tabs,
  }
}

export function updateAiChatTabTitle(
  state: AiChatTabsState,
  tabId: string,
  title: string,
  input?: AiChatTabsEnvironment,
): AiChatTabsState {
  const normalizedTabId = normalizeString(tabId)
  const normalizedTitle = normalizeAiChatTabTitle(title)
  let changed = false
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== normalizedTabId || tab.title === normalizedTitle) return tab
    changed = true
    return {
      ...tab,
      title: normalizedTitle,
      updatedAt: getNow(input),
    }
  })
  return changed ? { ...state, tabs } : state
}

export function bindAiChatTabSession(
  state: AiChatTabsState,
  tabId: string,
  input: BindAiChatTabSessionInput,
): AiChatTabsState {
  const normalizedTabId = normalizeString(tabId)
  const sessionKey = normalizeString(input.sessionKey)
  const sessionScope = normalizeAiChatTabSessionScope(input.scope)
  if (!normalizedTabId || !sessionKey || !sessionScope) return state

  let changed = false
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== normalizedTabId) return tab
    if (tab.sessionKey === sessionKey && areSameSessionScopes(tab.sessionScope, sessionScope)) {
      return tab
    }
    changed = true
    return {
      ...tab,
      sessionKey,
      sessionScope,
      updatedAt: getNow(input),
    }
  })

  return changed ? { ...state, tabs } : state
}
