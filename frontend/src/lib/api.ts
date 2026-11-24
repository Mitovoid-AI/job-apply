// API client. The backend prints a link with #token=...; it is kept in localStorage so
// later visits to http://127.0.0.1:8765 work without the link.
const TOKEN_KEY = 'job-apply-token'

function readToken(): string | null {
  const m = window.location.hash.match(/token=([^&]+)/)
  if (m) {
    try {
      localStorage.setItem(TOKEN_KEY, m[1])
    } catch {
      /* storage blocked: keep it in memory only */
    }
    history.replaceState(null, '', window.location.pathname + window.location.search)
    return m[1]
  }
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

let token = readToken()

export const hasToken = () => Boolean(token)

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Token': token } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail ?? detail
    } catch {
      /* not JSON */
    }
    if (res.status === 401) {
      token = null
      try {
        localStorage.removeItem(TOKEN_KEY)
      } catch {
        /* ignore */
      }
    }
    throw new ApiError(res.status, typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return res.json() as Promise<T>
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
export const put = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) })

export const pdfUrl = (path: string) =>
  `/api/files/pdf?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token ?? '')}`
