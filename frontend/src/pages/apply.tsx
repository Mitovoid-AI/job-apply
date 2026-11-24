import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { AlertTriangle, Check, Copy, ExternalLink, FileText, Send, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { AppShell } from '@/components/app-shell'
import { CompanyAvatar, GradeBadge } from '@/components/badges'
import { api, patch, pdfUrl } from '@/lib/api'
import type { Batch, BatchField, BatchJob, BatchSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

const SOURCE_STYLE: Record<BatchField['source'], string> = {
  profile: 'text-muted-foreground',
  resume: 'text-muted-foreground',
  edited: 'text-sky-700 dark:text-sky-400',
  draft: 'text-violet-700 dark:text-violet-400',
  need: 'text-amber-700 dark:text-amber-400',
  empty: 'text-muted-foreground',
}
const SOURCE_LABEL: Record<BatchField['source'], string> = {
  profile: 'from profile', resume: 'tailored resume', edited: 'edited by you',
  draft: 'draft', need: 'needs you', empty: 'left empty',
}

function FieldRow({ field, onSave }: { field: BatchField; onSave: (edit: Partial<BatchField>) => void }) {
  const [value, setValue] = useState(field.value ?? '')
  useEffect(() => setValue(field.value ?? ''), [field.value])
  const needs = field.required && (!value || field.source === 'need')
  const id = `f-${field.key}`
  const commit = (v: string) => v !== (field.value ?? '') && onSave({ value: v })

  let control: React.ReactNode
  if (field.type === 'file') {
    control = <p className="truncate pt-1.5 text-sm text-muted-foreground">{value || '—'}</p>
  } else if (field.type === 'select' && field.options?.length) {
    control = (
      <Select value={value || undefined} onValueChange={v => { setValue(v); commit(v) }}>
        <SelectTrigger id={id} className={cn('w-full', needs && 'border-amber-500')}>
          <SelectValue placeholder="Choose an answer" />
        </SelectTrigger>
        <SelectContent>
          {field.options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    )
  } else if (field.type === 'textarea' || field.source === 'draft') {
    control = (
      <Textarea id={id} value={value} rows={3} onChange={e => setValue(e.target.value)} onBlur={e => commit(e.target.value)}
        className={cn(needs && 'border-amber-500')} />
    )
  } else {
    control = (
      <Input id={id} value={value} onChange={e => setValue(e.target.value)} onBlur={e => commit(e.target.value)}
        className={cn(needs && 'border-amber-500')} placeholder={field.required ? 'Required' : 'Optional'} />
    )
  }

  return (
    <div className="grid gap-1.5 py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="leading-snug">
          {field.label}
          {field.required && <span className="text-amber-600"> *</span>}
        </Label>
        <p className={cn('text-xs', SOURCE_STYLE[needs ? 'need' : field.source])}>
          {needs ? SOURCE_LABEL.need : SOURCE_LABEL[field.source]}
          {field.note ? ` · ${field.note}` : ''}
        </p>
      </div>
      <div className="space-y-1.5">
        {control}
        {field.source === 'draft' && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={!!field.approved} onCheckedChange={v => onSave({ approved: v })} />
            {field.approved ? 'Approved: this text may be submitted' : 'Approve this draft'}
          </label>
        )}
      </div>
    </div>
  )
}

function JobBlock({ batch, job }: { batch: string; job: BatchJob }) {
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: (body: { fields?: Partial<BatchField>[]; ready?: boolean }) =>
      patch<Batch>(`/apply/batches/${batch}/jobs/${job.n}`, { fields: body.fields ?? [], ready: body.ready ?? null }),
    onSuccess: b => {
      qc.setQueryData(['batch', batch], b)
      qc.invalidateQueries({ queryKey: ['batches'] })
    },
    onError: e => toast.error((e as Error).message),
  })
  const blockedReason = job.summary.needs
    ? `${job.summary.needs} required answer${job.summary.needs === 1 ? '' : 's'} missing`
    : job.summary.drafts_pending
      ? `${job.summary.drafts_pending} draft${job.summary.drafts_pending === 1 ? '' : 's'} not approved`
      : null
  const done = job.result?.status

  return (
    <Card className={cn(job.ready && !done && 'ring-1 ring-emerald-500/40')}>
      <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0">
        <Badge variant="outline" className="tabular-nums">#{job.n}</Badge>
        <CompanyAvatar name={job.company} />
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-base">{job.role}</CardTitle>
          <p className="truncate text-sm text-muted-foreground">{job.company}</p>
        </div>
        <GradeBadge grade={job.grade} />
        {job.resume_pdf && (
          <Button variant="ghost" size="sm" asChild>
            <a href={pdfUrl(job.resume_pdf)} target="_blank" rel="noreferrer"><FileText /> Resume</a>
          </Button>
        )}
        <Button variant="ghost" size="sm" asChild>
          <a href={job.url} target="_blank" rel="noreferrer">Form <ExternalLink /></a>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {done ? (
          <p className="flex items-center gap-2 rounded-md bg-muted p-2 text-sm">
            <Check className="size-4 text-emerald-600" /> {done} {job.result?.at ? `on ${job.result.at.slice(0, 10)}` : ''}
            {job.result?.note ? ` · ${job.result.note}` : ''}
          </p>
        ) : null}
        {!!job.blockers?.length && (
          <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{job.blockers.join(' · ')}</span>
          </div>
        )}
        <div className="divide-y">
          {job.fields.map(f => (
            <FieldRow key={f.key} field={f} onSave={edit => save.mutate({ fields: [{ key: f.key, ...edit }] })} />
          ))}
        </div>
        {!!job.consent?.length && (
          <div className="flex items-start gap-2 rounded-md border p-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <span>By submitting you agree to: {job.consent.join(' · ')}</span>
          </div>
        )}
        {!done && (
          <div className="flex flex-wrap items-center gap-3 border-t pt-3">
            <Switch id={`ready-${job.n}`} checked={job.ready}
              onCheckedChange={v => {
                if (v && blockedReason) toast.warning(`Not ready yet: ${blockedReason}`)
                else save.mutate({ ready: v })
              }} />
            <Label htmlFor={`ready-${job.n}`}>Ready to submit</Label>
            {blockedReason && <span className="text-xs text-amber-700 dark:text-amber-400">{blockedReason}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function ApplyPage() {
  const [params, setParams] = useSearchParams()
  const { data: batches = [], isLoading } = useQuery({ queryKey: ['batches'], queryFn: () => api<BatchSummary[]>('/apply/batches') })
  const name = params.get('batch') ?? batches[0]?.name
  const { data: batch } = useQuery({
    queryKey: ['batch', name],
    queryFn: () => api<Batch>(`/apply/batches/${name}`),
    enabled: !!name,
  })

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied. Paste it into Claude Code.')
    } catch {
      toast.error("Couldn't copy. Select the text and copy it yourself.")
    }
  }

  return (
    <AppShell title="Apply">
      {!isLoading && batches.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
          <Send className="size-8 text-muted-foreground" />
          <h2 className="text-base font-medium">No apply batches yet</h2>
          <p className="text-sm text-muted-foreground">
            In Claude Code (opened in this repo), run <code className="rounded bg-muted px-1">/apply</code> with the jobs you
            want. Claude reads each form, builds the resumes and saves a batch here for you to review.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="space-y-2">
            {batches.map(b => (
              <button key={b.name} onClick={() => setParams({ batch: b.name })}
                className={cn('w-full rounded-lg border p-3 text-left text-sm hover:bg-muted',
                  b.name === name && 'border-primary bg-muted')}>
                <div className="font-medium">{b.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {b.jobs} job{b.jobs === 1 ? '' : 's'} · {b.ready} ready · {b.submitted} sent
                </div>
                {(b.needs > 0 || b.drafts_pending > 0) && (
                  <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    {b.needs ? `${b.needs} answers needed` : ''}
                    {b.needs && b.drafts_pending ? ' · ' : ''}
                    {b.drafts_pending ? `${b.drafts_pending} drafts to approve` : ''}
                  </div>
                )}
              </button>
            ))}
          </div>

          {batch && (
            <div className="space-y-4">
              {batch.changed_since_shown && (
                <p className="rounded-md border border-sky-500/30 bg-sky-500/10 p-2 text-sm">
                  You changed this batch after Claude showed it to you. When you send the command, Claude lists your
                  changes and asks once before submitting.
                </p>
              )}
              {batch.jobs.map(j => <JobBlock key={j.n} batch={batch.name} job={j} />)}

              <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
                {batch.submit_command ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <code className="rounded-md bg-muted px-2 py-1 text-sm">{batch.submit_command}</code>
                    <Button size="sm" onClick={() => copy(batch.submit_command!)}><Copy /> Copy command</Button>
                    <span className="text-xs text-muted-foreground">
                      Paste it into Claude Code. Nothing is submitted from this page.
                    </span>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Mark jobs as ready to get the command for Claude Code.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  )
}
