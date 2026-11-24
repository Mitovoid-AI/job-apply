import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import {
  type ColumnDef, type SortingState, flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
} from '@tanstack/react-table'
import { ArrowUpDown, BriefcaseBusiness, ExternalLink, FileText, MoreHorizontal, Plus, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AppShell, ScanButton } from '@/components/app-shell'
import { CompanyAvatar, FitBadge, GradeBadge, StatusBadge } from '@/components/badges'
import { FacetFilter, type FacetOption } from '@/components/facet-filter'
import { JobSheet } from '@/components/job-sheet'
import { LinkedInImport } from '@/components/linkedin-import'
import { useTasks } from '@/components/tasks'
import { api, post } from '@/lib/api'
import { FIT_LABEL, STATUS_LABEL, ago } from '@/lib/format'
import type { FitLevel, Job } from '@/lib/types'

const FIT_ORDER: Record<string, number> = { fits: 0, stretch: 1, unknown: 2, senior: 3 }
const fitKey = (j: Job) => j.fit?.level ?? 'unknown'
const statusKey = (j: Job) => j.pipeline?.status ?? 'new'
const gradeKey = (j: Job) => j.pipeline?.grade ?? 'none'
const POSTED_LABEL: Record<string, string> = {
  week: '7 days or less', month: '8–30 days', quarter: '31–90 days', older: 'Over 90 days', none: 'No date',
}
const POSTED_ORDER: Record<string, number> = { week: 0, month: 1, quarter: 2, older: 3, none: 4 }
function postedKey(j: Job) {
  if (!j.posted_at) return 'none'
  const days = (Date.now() - new Date(j.posted_at).getTime()) / 864e5
  return Number.isNaN(days) ? 'none' : days <= 7 ? 'week' : days <= 30 ? 'month' : days <= 90 ? 'quarter' : 'older'
}

function facet(jobs: Job[], key: (j: Job) => string, label: (v: string) => string, order?: (v: string) => number): FacetOption[] {
  const counts = new Map<string, number>()
  for (const j of jobs) counts.set(key(j), (counts.get(key(j)) ?? 0) + 1)
  const opts = [...counts].map(([value, count]) => ({ value, label: label(value), count }))
  return order ? opts.sort((a, b) => order(a.value) - order(b.value)) : opts.sort((a, b) => a.label.localeCompare(b.label))
}

export default function JobsPage() {
  const qc = useQueryClient()
  const { start } = useTasks()
  const [params, setParams] = useSearchParams()
  const openId = params.get('job')
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('job', id)
    else next.delete('job')
    setParams(next, { replace: true })
  }
  const [search, setSearch] = useState('')
  const [fits, setFits] = useState<string[]>([])
  const [grades, setGrades] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [companies, setCompanies] = useState<string[]>([])
  const [posted, setPosted] = useState<string[]>([])
  const [showAdjacent, setShowAdjacent] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'fit', desc: false }])
  // A worldwide company list can mean thousands of jobs: draw 200 rows at a time.
  const [limit, setLimit] = useState(200)

  const { data: jobs = [], isLoading } = useQuery({ queryKey: ['jobs'], queryFn: () => api<Job[]>('/jobs') })
  const track = useMutation({
    mutationFn: (id: string) => post(`/jobs/${id}/track`),
    onSuccess: () => {
      qc.invalidateQueries()
      toast.success('Added to your pipeline')
    },
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return jobs.filter(j =>
      (showAdjacent || j.match !== 'adjacent') &&
      (!q ||`${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q)) &&
      (!fits.length || fits.includes(fitKey(j))) &&
      (!grades.length || grades.includes(gradeKey(j))) &&
      (!statuses.length || statuses.includes(statusKey(j))) &&
      (!companies.length || companies.includes(j.company)) &&
      (!posted.length || posted.includes(postedKey(j))),
    )
  }, [jobs, showAdjacent, search, fits, grades, statuses, companies, posted])
  const adjacentCount = jobs.filter(j => j.match === 'adjacent').length
  useEffect(() => setLimit(200), [filtered, sorting])

  const columns = useMemo<ColumnDef<Job>[]>(() => [
    {
      id: 'role',
      header: 'Role',
      accessorFn: j => `${j.title} ${j.company}`,
      cell: ({ row: { original: j } }) => (
        <div className="flex min-w-0 items-center gap-3">
          <CompanyAvatar name={j.company} />
          <div className="min-w-0">
            <div className="truncate font-medium">{j.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {j.company}
              {j.tier === '1' && ' · Tier 1'}
              {j.match === 'adjacent' && ' · adjacent role'}
              {j.source === 'linkedin' && ' · from a LinkedIn alert'}
              {!j.in_scan && ' · not in latest scan'}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'location',
      header: 'Location',
      accessorFn: j => j.location,
      cell: ({ getValue }) => <span className="text-sm text-muted-foreground">{(getValue() as string) || '—'}</span>,
    },
    {
      id: 'fit',
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => column.toggleSorting()}>
          Experience <ArrowUpDown />
        </Button>
      ),
      accessorFn: j => FIT_ORDER[fitKey(j)] * 100 + (j.fit?.min ?? 50),
      cell: ({ row }) => <FitBadge fit={row.original.fit} />,
    },
    {
      id: 'grade',
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => column.toggleSorting()}>
          Grade <ArrowUpDown />
        </Button>
      ),
      accessorFn: j => j.pipeline?.grade ?? 'Z',
      cell: ({ row: { original: j } }) => <GradeBadge grade={j.pipeline?.grade} score={j.pipeline?.score} />,
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: j => statusKey(j),
      cell: ({ row: { original: j } }) => <StatusBadge status={j.pipeline?.status} />,
    },
    {
      id: 'posted',
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => column.toggleSorting()}>
          Posted <ArrowUpDown />
        </Button>
      ),
      accessorFn: j => j.posted_at ?? '',
      sortDescFirst: true,
      cell: ({ row: { original: j } }) => <span className="text-xs text-muted-foreground">{ago(j.posted_at)}</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row: { original: j } }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Job actions" onClick={e => e.stopPropagation()}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => setOpen(j.id)}>Open details</DropdownMenuItem>
            {!j.pipeline && (
              <DropdownMenuItem onSelect={() => track.mutate(j.id)}>
                <Plus /> Track
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => start(`/jobs/${j.id}/evaluate`, `Evaluation of ${j.company}`)}>
              <Sparkles /> Evaluate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => start(`/jobs/${j.id}/resume`, `Resume for ${j.company}`)}>
              <FileText /> Build resume
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={j.url} target="_blank" rel="noreferrer">
                <ExternalLink /> Open posting
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], [start, track.mutate, setOpen])

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const anyFilter = search || fits.length || grades.length || statuses.length || companies.length || posted.length
  const clear = () => {
    setSearch('')
    setFits([])
    setGrades([])
    setStatuses([])
    setCompanies([])
    setPosted([])
  }

  return (
    <AppShell title="Jobs" actions={<LinkedInImport />}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Filter jobs" value={search} onChange={e => setSearch(e.target.value)} className="h-8 w-48" />
          <FacetFilter title="Experience" selected={fits} onChange={setFits}
            options={facet(jobs, fitKey, v => FIT_LABEL[v as FitLevel] ?? v, v => FIT_ORDER[v] ?? 9)} />
          <FacetFilter title="Grade" selected={grades} onChange={setGrades}
            options={facet(jobs, gradeKey, v => (v === 'none' ? 'Not graded' : v))} />
          <FacetFilter title="Status" selected={statuses} onChange={setStatuses}
            options={facet(jobs, statusKey, v => (v === 'new' ? 'New' : STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? v))} />
          <FacetFilter title="Company" selected={companies} onChange={setCompanies}
            options={facet(jobs, j => j.company, v => v)} />
          <FacetFilter title="Posted" selected={posted} onChange={setPosted}
            options={facet(jobs, postedKey, v => POSTED_LABEL[v] ?? v, v => POSTED_ORDER[v] ?? 9)} />
          {anyFilter ? (
            <Button variant="ghost" size="sm" onClick={clear}>
              Reset <X />
            </Button>
          ) : null}
          {adjacentCount > 0 && (
            <div className="flex items-center gap-2">
              <Switch id="show-adjacent" size="sm" checked={showAdjacent} onCheckedChange={setShowAdjacent} />
              <Label htmlFor="show-adjacent" className="text-xs font-normal text-muted-foreground">
                Adjacent roles ({adjacentCount})
              </Label>
            </div>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} of {jobs.length} jobs
          </span>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map(hg => (
                <TableRow key={hg.id}>
                  {hg.headers.map(h => (
                    <TableHead key={h.id} className={h.id === 'actions' ? 'w-10' : h.id === 'role' ? 'min-w-64' : ''}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={columns.length}><Skeleton className="h-8 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : table.getRowModel().rows.length ? (
                table.getRowModel().rows.slice(0, limit).map(row => (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => setOpen(row.original.id)}
                    data-state={row.original.id === openId ? 'selected' : undefined}>
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-48 text-center">
                    {jobs.length === 0 ? (
                      <div className="flex flex-col items-center gap-3">
                        <BriefcaseBusiness className="size-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">No jobs yet. Scan the company boards to find matches.</p>
                        <ScanButton variant="default" />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">No jobs match these filters.</span>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {filtered.length > limit && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => setLimit(l => l + 200)}>
              Show 200 more ({filtered.length - limit} not shown)
            </Button>
          </div>
        )}
      </div>
      <JobSheet jobId={openId} onClose={() => setOpen(null)} />
    </AppShell>
  )
}
