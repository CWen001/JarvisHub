import { create } from 'zustand'

export type User = {
  sub: string | number
  login: string
  name?: string
  avatarUrl?: string
  email?: string
  phone?: string
  hasPassword?: boolean
  role?: string | null
  guest?: boolean
}

type JwtPayload = {
  sub?: string | number
  login?: string
  name?: string
  avatarUrl?: string | null
  email?: string | null
  phone?: string | null
  hasPassword?: boolean
  role?: string | null
  guest?: boolean
}

const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60

function base64UrlDecode(input: string): string {
  input = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = input.length % 4
  if (pad) input += '='.repeat(4 - pad)
  try { return atob(input) } catch { return '' }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function resolveAuthCookieAttributes(): string {
  if (typeof window === 'undefined') return `Path=/; Max-Age=${ONE_WEEK_SECONDS}; SameSite=Lax`

  const host = String(window.location.hostname || '').toLowerCase()
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1')
  const protocol = String(window.location.protocol || '').toLowerCase()

  const domain = host.endsWith('.jarvishub.com') || host === 'jarvishub.com' ? '.jarvishub.com' : undefined
  const secure = !isLocalhost && protocol === 'https:'
  const sameSite = isLocalhost || !secure ? 'Lax' : 'None'

  const parts = [`Path=/`, `Max-Age=${ONE_WEEK_SECONDS}`, `SameSite=${sameSite}`]
  if (secure) parts.push('Secure')
  if (domain) parts.push(`Domain=${domain}`)
  return parts.join('; ')
}

function writeCookie(name: string, value: string, attributes: string) {
  if (typeof document === 'undefined') return
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; ${attributes}`
  } catch {
    // ignore
  }
}

function clearCookie(name: string, attributes: string) {
  if (typeof document === 'undefined') return
  try {
    const cleared = attributes.replace(/Max-Age=\d+/i, 'Max-Age=0')
    document.cookie = `${name}=; ${cleared}`
  } catch {
    // ignore
  }
}

function toUser(payload: JwtPayload | null | undefined): User | null {
  if (!payload?.sub || !payload.login) return null
  return {
    sub: payload.sub,
    login: payload.login,
    name: payload.name,
    avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : undefined,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    phone: typeof payload.phone === 'string' ? payload.phone : undefined,
    hasPassword: typeof payload.hasPassword === 'boolean' ? payload.hasPassword : undefined,
    role: payload.role ?? null,
    guest: payload.guest,
  }
}

function decodeJwtUser(token: string | null): User | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as JwtPayload
    return toUser(payload)
  } catch {
    return null
  }
}

function mergeUser(decoded: User | null, provided?: User | null): User | null {
  if (!decoded && !provided) return null
  if (!decoded) return provided ?? null
  if (!provided) return decoded
  return {
    sub: provided.sub ?? decoded.sub,
    login: provided.login ?? decoded.login,
    name: provided.name ?? decoded.name,
    avatarUrl: provided.avatarUrl ?? decoded.avatarUrl,
    email: provided.email ?? decoded.email,
    phone: provided.phone ?? decoded.phone,
    hasPassword: provided.hasPassword ?? decoded.hasPassword,
    role: provided.role ?? decoded.role ?? null,
    guest: provided.guest ?? decoded.guest,
  }
}

export const OPEN_WORKSPACE_USER: User = {
  sub: 'local-workspace',
  login: 'local-workspace',
  name: 'Local Workspace',
  role: 'admin',
  guest: true,
}

const initialUser = OPEN_WORKSPACE_USER

type AuthState = {
  token: string | null
  user: User | null
  loading: boolean
  login: (code: string, state?: string) => Promise<void>
  setAuth: (token: string, user?: User | null) => void
  clear: () => void
}

export const useAuth = create<AuthState>((set, get) => ({
  token: null,
  user: initialUser,
  loading: false,
  login: async (code: string, state?: string) => {
    set({ loading: true })
    try {
      const response = await fetch('/api/auth/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code, state }),
      })

      if (!response.ok) {
        throw new Error('Authentication failed')
      }

      const data = await response.json() as { token: string; user?: User | null }
      get().setAuth(data.token, data.user)
    } catch (error) {
      console.error('Login failed:', error)
      throw error
    } finally {
      set({ loading: false })
    }
  },
  setAuth: (token, user) => {
    const attrs = resolveAuthCookieAttributes()
    writeCookie('jh_token', token, attrs)
    try { localStorage.setItem('jh_token', token) } catch {}
    const mergedUser = mergeUser(decodeJwtUser(token), user)
    try {
      if (mergedUser) {
        localStorage.setItem('jh_user', JSON.stringify(mergedUser))
      } else {
        localStorage.removeItem('jh_user')
      }
    } catch {
      // ignore
    }
    set({ token, user: mergedUser })
  },
  clear: () => {
    const attrs = resolveAuthCookieAttributes()
    clearCookie('jh_token', attrs)
    try { localStorage.removeItem('jh_token'); localStorage.removeItem('jh_user') } catch {}
    set({ token: null, user: OPEN_WORKSPACE_USER })
  },
}))

export function getAuthToken() {
  return null
}

export function getAuthTokenFromCookie() { return readCookie('jh_token') }
