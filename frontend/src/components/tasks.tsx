import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, post } from '@/lib/api'
import type { Task } from '@/lib/types'

// Long jobs (scan, resume build, evaluation) run on the backend; this polls them,
// shows progress in the header and a toast when they finish.

interface TrackedTask extends Task {
  label: string
}

interface TasksContext {
  tasks: TrackedTask[]
  start: (path: string, label: string) => Promise<void>
  isRunning: (kind: Task['kind'], key?: string) => boolean
}

const Ctx = createContext<TasksContext | null>(null)

const defaultLabel = (t: Task) =>
  ({ scan: 'Scan', discover: 'Finding companies', resume: 'Resume build', evaluate: 'Evaluation',
     prepare: 'Preparing applications', window: 'Form window' })[t.kind]

function doneMessage(t: Task, label: string) {
  const r = (t.result ?? {}) as Record<string, unknown>
  if (t.kind === 'scan') return `Scan finished: ${r.total ?? 0} matches`
  if (t.kind === 'discover') {
    const scan = (r.scan ?? {}) as Record<string, unknown>
    return `Found ${r.companies ?? 0} companies with jobs for your roles. Scan finished: ${scan.total ?? 0} matches`
  }
  if (t.kind === 'prepare') {
    if (Array.isArray(r.prepared)) {
      const n = r.prepared.length
      const waiting = Number(r.waiting ?? 0)
      const more = waiting ? ` (${waiting} more at your level: use Prepare on the Jobs page, or scan again)` : ''
      return n ? `${n} application${n === 1 ? '' : 's'} ready to check on the Apply page${more}` : 'No new jobs at your level to prepare'
    }
    return `${r.company ?? label} is ready: ${r.needs ?? 0} answer${r.needs === 1 ? '' : 's'} for you, ${r.drafts ?? 0} AI draft${r.drafts === 1 ? '' : 's'}`
  }
  if (t.kind === 'window') {
    return r.status === 'submitted' ? `${r.company}: application submitted` : `${r.company}: window closed, nothing submitted`
  }
  if (t.kind === 'resume') {
    const pages = Number(r.page_count ?? 0)
    return `${label}: ${r.base ?? 'resume'}, ${pages} page${pages === 1 ? '' : 's'}`
  }
  return `${label}: grade ${r.grade ?? '?'} (${r.score ?? '?'})`
}

export function TasksProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [tasks, setTasks] = useState<TrackedTask[]>([])
  const labels = useRef(new Map<string, string>())

  // Pick up anything already running, e.g. the daily scan.
  useEffect(() => {
    api<Task[]>('/tasks')
      .then(ts => setTasks(ts.map(t => ({ ...t, label: defaultLabel(t) }))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const running = tasks.filter(t => t.status === 'running')
    if (running.length === 0) return
    const timer = setInterval(async () => {
      const updates = await Promise.all(running.map(t => api<Task>(`/tasks/${t.id}`).catch(() => null)))
      const finished = updates.filter((u): u is Task => !!u && u.status !== 'running')
      setTasks(prev => prev.map(t => ({ ...t, ...(updates.find(u => u?.id === t.id) ?? {}) })))
      for (const u of finished) {
        const label = labels.current.get(u.id) ?? defaultLabel(u)
        if (u.status === 'done') toast.success(doneMessage(u, label))
        else toast.error(`${label} failed`, { description: u.error ?? undefined })
      }
      if (finished.length) qc.invalidateQueries()
    }, 1500)
    return () => clearInterval(timer)
  }, [tasks, qc])

  const start = useCallback(async (path: string, label: string) => {
    try {
      const t = await post<Task>(path)
      labels.current.set(t.id, label)
      setTasks(prev => [...prev.filter(p => p.id !== t.id), { ...t, label }])
    } catch (e) {
      toast.error(`${label} didn't start`, { description: (e as Error).message })
    }
  }, [])

  const isRunning = useCallback(
    (kind: Task['kind'], key?: string) =>
      tasks.some(t => t.status === 'running' && t.kind === kind && (key === undefined || t.key === key)),
    [tasks],
  )

  return <Ctx.Provider value={{ tasks, start, isRunning }}>{children}</Ctx.Provider>
}

export function useTasks() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTasks outside TasksProvider')
  return ctx
}
