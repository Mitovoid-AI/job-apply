import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, FileText, Loader2, Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { CompanyAvatar, FitBadge, GradeBadge, StatusBadge } from '@/components/badges'
import { useTasks } from '@/components/tasks'
import { api, patch, pdfUrl, post } from '@/lib/api'
import { STATUSES, STATUS_LABEL, ago } from '@/lib/format'
import type { JobDetail, PipelineEntry, Status } from '@/lib/types'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 px-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

const markdown =
  'text-sm leading-relaxed [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold ' +
  '[&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-medium [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 ' +
  '[&_table]:my-3 [&_table]:w-full [&_table]:text-xs [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border ' +
  '[&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-xs'

export function JobSheet({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { start, isRunning } = useTasks()
  const [showReport, setShowReport] = useState(false)
  const [showJd, setShowJd] = useState(false)
  const { data: job, isLoading } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api<JobDetail>(`/jobs/${jobId}`),
    enabled: !!jobId,
  })

  const track = useMutation({
    mutationFn: () => post(`/jobs/${jobId}/track`),
    onSuccess: () => {
      qc.invalidateQueries()
      toast.success('Added to your pipeline')
    },
  })
  const update = useMutation({
    mutationFn: (fields: Partial<PipelineEntry>) => patch(`/pipeline/${job!.pipeline!.id}`, fields),
    onSuccess: () => qc.invalidateQueries(),
    onError: e => toast.error((e as Error).message),
  })

  const p = job?.pipeline
  const evaluating = !!jobId && isRunning('evaluate', jobId)
  const building = !!jobId && isRunning('resume', jobId)

  return (
    <Sheet open={!!jobId} onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {isLoading || !job ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader className="flex-row items-start gap-3">
              <CompanyAvatar name={job.company} className="size-10" />
              <div className="min-w-0 space-y-1">
                <SheetTitle className="leading-tight">{job.title}</SheetTitle>
                <SheetDescription>
                  {job.company} · {job.location || 'Location not listed'} · {job.source}
                </SheetDescription>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <FitBadge fit={job.fit} />
                  <GradeBadge grade={p?.grade} score={p?.score} />
                  <StatusBadge status={p?.status} />
                </div>
              </div>
            </SheetHeader>

            <div className="flex flex-wrap gap-2 px-4 pb-4">
              {!p && (
                <Button size="sm" variant="outline" onClick={() => track.mutate()} disabled={track.isPending}>
                  <Plus /> Track
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => !evaluating && start(`/jobs/${job.id}/evaluate`, `Evaluation of ${job.company}`)}
              >
                {evaluating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {evaluating ? 'Evaluating… (1–2 min)' : p?.evaluation ? 'Re-evaluate' : 'Evaluate'}
              </Button>
              <Button
                size="sm"
                onClick={() => !building && start(`/jobs/${job.id}/resume`, `Resume for ${job.company}`)}
              >
                {building ? <Loader2 className="animate-spin" /> : <FileText />}
                {building ? 'Building…' : p?.resume_pdf ? 'Rebuild resume' : 'Build resume'}
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <a href={job.url} target="_blank" rel="noreferrer">
                  Posting <ExternalLink />
                </a>
              </Button>
            </div>
            <Separator />

            <div className="space-y-6 py-4">
              {job.fit?.quote && (
                <Section title="Experience asked">
                  <p className="text-sm text-muted-foreground">“…{job.fit.quote}…”</p>
                </Section>
              )}

              <Section title="Evaluation">
                {p?.evaluation ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <GradeBadge grade={p.evaluation.grade} score={p.evaluation.score} />
                      {p.evaluation.recommendation && <span className="text-sm font-medium">{p.evaluation.recommendation}</span>}
                    </div>
                    {p.evaluation.summary && <p className="text-sm">{p.evaluation.summary}</p>}
                    {!!p.evaluation.gaps?.length && (
                      <div className="flex flex-wrap gap-1">
                        {p.evaluation.gaps.map(g => (
                          <Badge key={g} variant="outline" className="font-normal">Gap: {g}</Badge>
                        ))}
                      </div>
                    )}
                    {job.report_text && (
                      <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setShowReport(s => !s)}>
                        {showReport ? 'Hide full report' : 'Read full report'}
                      </Button>
                    )}
                    {showReport && job.report_text && (
                      <div className={markdown}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{job.report_text}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                ) : p?.grade ? (
                  <div className="flex items-center gap-2 text-sm">
                    <GradeBadge grade={p.grade} score={p.score} />
                    <span className="text-muted-foreground">Graded in Claude Code. {p.notes}</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Not evaluated yet. Evaluate runs Claude Code in the background and grades the job A–F against your CV.
                  </p>
                )}
              </Section>

              <Section title="Resume">
                {p?.resume_pdf ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      {p.resume_meta?.base ?? 'Tailored resume'}
                      {p.resume_meta?.page_count != null &&
                        ` · ${p.resume_meta.page_count} page${p.resume_meta.page_count === 1 ? '' : 's'}`}
                      {p.resume_meta?.built_at ? ` · built ${ago(p.resume_meta.built_at)}` : ''}
                      {' · '}
                      <a className="underline underline-offset-2" href={pdfUrl(p.resume_pdf)} target="_blank" rel="noreferrer">
                        Open PDF
                      </a>
                    </p>
                    <iframe title="Resume preview" src={pdfUrl(p.resume_pdf)} className="h-[560px] w-full rounded-md border" />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No tailored resume yet. Build resume runs your resume tailor with this job's description (about 30 s).
                  </p>
                )}
              </Section>

              {p && (
                <Section title="Tracker">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="status">Status</Label>
                      <Select value={p.status} onValueChange={v => update.mutate({ status: v as Status })}>
                        <SelectTrigger id="status" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map(s => (
                            <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="next">Next action</Label>
                      <Input
                        id="next"
                        defaultValue={p.next_action}
                        key={`${p.id}-${p.next_action}`}
                        placeholder="Follow up on Monday"
                        onBlur={e => e.target.value !== p.next_action && update.mutate({ next_action: e.target.value })}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Found {p.date_found}
                    {p.date_applied ? ` · applied ${p.date_applied}` : ''}
                  </p>
                </Section>
              )}

              <Section title="Job description">
                {job.jd ? (
                  <>
                    <p className={`whitespace-pre-line text-sm text-muted-foreground ${showJd ? '' : 'line-clamp-6'}`}>{job.jd}</p>
                    <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setShowJd(s => !s)}>
                      {showJd ? 'Show less' : 'Show full description'}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Not fetched yet. It's fetched after each scan.</p>
                )}
              </Section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
