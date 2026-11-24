import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import {
  DndContext, type DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core'
import { FileText, KanbanSquare } from 'lucide-react'
import { toast } from 'sonner'
import { AppShell } from '@/components/app-shell'
import { CompanyAvatar, GradeBadge } from '@/components/badges'
import { JobSheet } from '@/components/job-sheet'
import { api, patch } from '@/lib/api'
import { STATUS_LABEL, ago } from '@/lib/format'
import type { Job, Status } from '@/lib/types'
import { cn } from '@/lib/utils'

const COLUMNS: { id: string; label: string; statuses: Status[]; dropAs: Status }[] = [
  { id: 'to_apply', label: 'To apply', statuses: ['to_apply'], dropAs: 'to_apply' },
  { id: 'applied', label: 'Applied', statuses: ['applied'], dropAs: 'applied' },
  { id: 'hr_screen', label: 'HR screen', statuses: ['hr_screen'], dropAs: 'hr_screen' },
  { id: 'technical', label: 'Technical', statuses: ['technical'], dropAs: 'technical' },
  { id: 'final_round', label: 'Final round', statuses: ['final_round'], dropAs: 'final_round' },
  { id: 'offer', label: 'Offer', statuses: ['offer', 'accepted'], dropAs: 'offer' },
  { id: 'closed', label: 'Closed', statuses: ['rejected', 'withdrawn', 'expired'], dropAs: 'rejected' },
]

const STALE_DAYS: Partial<Record<Status, number>> = { to_apply: 14, applied: 21 }

function daysSince(iso?: string | null) {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

function JobCard({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const p = job.pipeline!
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: job.id })
  const since = p.status === 'to_apply' ? p.date_found : p.updated_at ?? p.date_applied ?? p.date_found
  const days = daysSince(since)
  const stale = days != null && STALE_DAYS[p.status] != null && days > STALE_DAYS[p.status]!
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn(
        'w-full rounded-lg border bg-card p-3 text-left shadow-xs transition-shadow hover:shadow-sm',
        isDragging && 'z-50 opacity-80 shadow-md',
        stale && 'border-amber-400/60',
      )}
    >
      <div className="flex items-start gap-2.5">
        <CompanyAvatar name={job.company} className="size-7" />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-medium leading-snug">{job.title}</div>
          <div className="truncate text-xs text-muted-foreground">{job.company}</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <GradeBadge grade={p.grade} score={p.score} />
        {p.resume_pdf && <FileText className="size-3.5 text-muted-foreground" aria-label="Resume built" />}
        {p.status !== 'to_apply' && !COLUMNS.some(c => c.dropAs === p.status) && (
          <span className="text-xs text-muted-foreground">{STATUS_LABEL[p.status]}</span>
        )}
        <span className={cn('ml-auto text-xs', stale ? 'text-amber-600' : 'text-muted-foreground')}>
          {days != null ? ago(since) : ''}
        </span>
      </div>
    </button>
  )
}

function Column({ col, jobs, onOpen }: { col: (typeof COLUMNS)[number]; jobs: Job[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id })
  return (
    <div ref={setNodeRef}
      className={cn('flex w-64 shrink-0 flex-col rounded-xl bg-muted/50 p-2', isOver && 'ring-2 ring-primary/40')}>
      <div className="flex items-center justify-between px-1.5 pb-2 pt-1">
        <span className="text-sm font-medium">{col.label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{jobs.length}</span>
      </div>
      <div className="flex min-h-24 flex-col gap-2">
        {jobs.map(j => <JobCard key={j.id} job={j} onOpen={() => onOpen(j.id)} />)}
      </div>
    </div>
  )
}

export default function PipelinePage() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const lastDrag = useRef(0) // a drag ends with a click on the card; ignore that click
  const openId = params.get('job')
  const { data: jobs = [] } = useQuery({ queryKey: ['jobs'], queryFn: () => api<Job[]>('/jobs') })
  const tracked = jobs.filter(j => j.pipeline)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const move = useMutation({
    mutationFn: ({ entryId, status }: { entryId: number; status: Status }) => patch(`/pipeline/${entryId}`, { status }),
    onMutate: async ({ entryId, status }) => {
      await qc.cancelQueries({ queryKey: ['jobs'] })
      const prev = qc.getQueryData<Job[]>(['jobs'])
      qc.setQueryData<Job[]>(['jobs'], old =>
        old?.map(j => (j.pipeline?.id === entryId ? { ...j, pipeline: { ...j.pipeline!, status } } : j)))
      return { prev }
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(['jobs'], ctx?.prev)
      toast.error((e as Error).message)
    },
    onSettled: () => qc.invalidateQueries(),
  })

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    lastDrag.current = Date.now()
    if (!over) return
    const job = tracked.find(j => j.id === active.id)
    const col = COLUMNS.find(c => c.id === over.id)
    if (!job || !col || col.statuses.includes(job.pipeline!.status)) return
    move.mutate({ entryId: job.pipeline!.id, status: col.dropAs })
    toast.success(`${job.company} → ${STATUS_LABEL[col.dropAs]}`)
  }

  const open = (id: string | null) => {
    if (id && Date.now() - lastDrag.current < 300) return
    const next = new URLSearchParams(params)
    if (id) next.set('job', id)
    else next.delete('job')
    setParams(next, { replace: true })
  }

  return (
    <AppShell title="Pipeline">
      {tracked.length === 0 ? (
        <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
          <KanbanSquare className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nothing tracked yet. Track jobs from the Jobs page.</p>
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd} onDragCancel={() => (lastDrag.current = Date.now())}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {COLUMNS.map(col => (
              <Column key={col.id} col={col} onOpen={open}
                jobs={tracked.filter(j => col.statuses.includes(j.pipeline!.status))} />
            ))}
          </div>
        </DndContext>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Drag a card to change its status. Dropping on Closed marks it rejected; pick withdrawn or expired in the card's details.
      </p>
      <JobSheet jobId={openId} onClose={() => open(null)} />
    </AppShell>
  )
}
