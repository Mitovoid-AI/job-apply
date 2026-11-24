import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, LabelList, XAxis } from 'recharts'
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { AppShell } from '@/components/app-shell'
import { CompanyAvatar, FitBadge } from '@/components/badges'
import { useTasks } from '@/components/tasks'
import { api } from '@/lib/api'
import type { BatchSummary, Job, Overview } from '@/lib/types'

const chartConfig = { value: { label: 'Jobs', color: 'var(--chart-2)' } } satisfies ChartConfig

function Stat({ label, value, hint }: { label: string; value: number | undefined; hint: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value ?? <Skeleton className="h-7 w-10" />}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 text-xs text-muted-foreground">{hint}</CardContent>
    </Card>
  )
}

const NEED_LINK: Record<string, string> = { profile: '/profile', batch: '/apply' }

export default function OverviewPage() {
  const { start, isRunning } = useTasks()
  const { data } = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/overview') })
  const { data: jobs = [] } = useQuery({ queryKey: ['jobs'], queryFn: () => api<Job[]>('/jobs') })
  const { data: batches = [] } = useQuery({ queryKey: ['batches'], queryFn: () => api<BatchSummary[]>('/apply/batches') })
  const ready = batches.reduce((n, b) => n + b.jobs - b.submitted, 0)
  const picks = jobs
    .filter(j => j.in_scan && !j.pipeline && (j.fit?.level === 'fits' || j.fit?.level === 'stretch'))
    .slice(0, 5)
  const c = data?.counts

  return (
    <AppShell title="Overview">
      <div className="space-y-4">
        {ready > 0 && (
          <Link to="/apply" className="flex items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm hover:bg-emerald-500/15">
            <CheckCircle2 className="size-4 text-emerald-600" />
            <span className="flex-1">
              {ready} application{ready === 1 ? ' is' : 's are'} prepared. Check {ready === 1 ? 'it' : 'them'} and press Submit.
            </span>
            <ArrowRight className="size-4" />
          </Link>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Matches in last scan" value={c?.matches}
            hint={data?.scan_errors
              ? `Didn't answer: ${data.scan_failed?.length ? data.scan_failed.join(', ') : `${data.scan_errors} boards`}. Scan again to retry.`
              : 'Every company board answered'} />
          <Stat label="Fit your experience" value={c?.fits} hint="Asks no more years than you have" />
          <Stat label="To apply" value={c?.to_apply} hint="Tracked, not applied yet" />
          <Stat label="Applied" value={c?.applied} hint={`${c?.interviewing ?? 0} interviewing · ${c?.offers ?? 0} offers`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Funnel</CardTitle>
              <CardDescription>From scan to offer</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-56 w-full">
                <BarChart data={data?.funnel ?? []} margin={{ top: 20 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="stage" tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                  <Bar dataKey="value" fill="var(--color-value)" radius={6}>
                    <LabelList dataKey="value" position="top" className="fill-foreground" fontSize={12} />
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Needs action</CardTitle>
              <CardDescription>Stale applications, missing answers</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data && data.needs_action.length === 0 && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 text-emerald-600" /> Nothing waiting on you.
                </p>
              )}
              {data?.needs_action.map((n, i) => {
                if (n.kind === 'discover') {
                  const running = isRunning('discover')
                  return (
                    <button key={i} type="button" disabled={running} onClick={() => start('/discover', 'Finding companies')}
                      className="flex w-full items-start gap-2 rounded-md p-2 text-left text-sm hover:bg-muted disabled:opacity-60">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                      <span className="flex-1">{running ? 'Finding companies for your roles…' : n.text}</span>
                      <ArrowRight className="mt-0.5 size-4 text-muted-foreground" />
                    </button>
                  )
                }
                const to = n.job_id ? `/jobs?job=${n.job_id}` : NEED_LINK[n.kind] ?? '/'
                return (
                  <Link key={i} to={to} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-muted">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <span className="flex-1">{n.text}</span>
                    <ArrowRight className="mt-0.5 size-4 text-muted-foreground" />
                  </Link>
                )
              })}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Worth a look</CardTitle>
            <CardDescription>New jobs at your level that you haven't tracked yet</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {picks.length === 0 && <p className="py-2 text-sm text-muted-foreground">None in the latest scan.</p>}
            {picks.map(j => (
              <Link key={j.id} to={`/jobs?job=${j.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                <CompanyAvatar name={j.company} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{j.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{j.company} · {j.location}</div>
                </div>
                <FitBadge fit={j.fit} />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
