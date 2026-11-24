import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { AppShell } from '@/components/app-shell'
import { useTasks } from '@/components/tasks'
import { api, put } from '@/lib/api'
import { humanKey } from '@/lib/format'
import type { Profile } from '@/lib/types'
import { cn } from '@/lib/utils'

const text = z.string().trim()
const optionalUrl = z.union([z.literal(''), z.url('Enter a full link starting with https://')])
const optionalNumber = z.union([z.literal(''), z.string().regex(/^\d+(\.\d+)?$/, 'Enter a number')])

const schema = z.object({
  full_name: text, email: z.union([z.literal(''), z.email('Enter a valid email')]), phone: text,
  current_city: text, linkedin: optionalUrl, github: optionalUrl, portfolio: optionalUrl,
  current_company: text, current_title: text, total_experience_years: optionalNumber,
  notice_period: text, current_ctc_lpa: text, expected_ctc_lpa: text,
  willing_to_relocate: text, work_authorization_india: text,
  highest_degree: text, university: text, graduation_year: optionalNumber,
  discipline: text, education_start_month: text, education_start_year: optionalNumber,
  education_end_month: text, education_end_year: optionalNumber,
  cgpa: text, class_12_percent: text, class_10_percent: text,
  how_did_you_hear: text, eeo_default: text,
  experience_years: optionalNumber, locations: text, target_roles: text,
  salary_min: optionalNumber, salary_max: optionalNumber, salary_walk_away: optionalNumber,
})
type Form = z.infer<typeof schema>

const GROUPS: { title: string; hint: string; fields: { key: keyof Form; placeholder?: string; missingKey?: string }[] }[] = [
  {
    title: 'Contact', hint: 'Typed into every application form.',
    fields: [{ key: 'full_name' }, { key: 'email' }, { key: 'phone' }, { key: 'current_city', placeholder: 'Gurugram, Haryana' },
      { key: 'linkedin', placeholder: 'https://linkedin.com/in/you' }, { key: 'github' }, { key: 'portfolio' }],
  },
  {
    title: 'Current job', hint: 'Indian forms almost always ask notice period and CTC.',
    fields: [{ key: 'current_company' }, { key: 'current_title' }, { key: 'total_experience_years' },
      { key: 'notice_period', placeholder: '30 days' }, { key: 'current_ctc_lpa', placeholder: 'Only if you want it shared' },
      { key: 'expected_ctc_lpa', placeholder: '18' }, { key: 'willing_to_relocate', placeholder: 'Yes: Bangalore, Hyderabad' },
      { key: 'work_authorization_india', placeholder: 'Yes, Indian citizen' }],
  },
  {
    title: 'Education', hint: 'Greenhouse forms ask the start and end month. CGPA and 10th/12th % are only used when a form asks.',
    fields: [{ key: 'highest_degree' }, { key: 'university' }, { key: 'discipline', placeholder: 'Computer Science' },
      { key: 'graduation_year' }, { key: 'education_start_month', placeholder: 'November' },
      { key: 'education_start_year', placeholder: '2022' }, { key: 'education_end_month', placeholder: 'May' },
      { key: 'education_end_year', placeholder: '2026' }, { key: 'cgpa', placeholder: '8.2' },
      { key: 'class_12_percent', placeholder: '87' }, { key: 'class_10_percent', placeholder: '90' }],
  },
  {
    title: 'Defaults', hint: 'Used when a form asks these.',
    fields: [{ key: 'how_did_you_hear' }, { key: 'eeo_default', placeholder: 'Prefer not to say' }],
  },
  {
    title: 'Job search', hint: 'Drives the scan and the experience badge. Separate items with commas.',
    fields: [{ key: 'experience_years' }, { key: 'locations', placeholder: 'Gurugram, Bangalore, Remote' },
      { key: 'target_roles', placeholder: 'AI Engineer, ML Engineer' },
      { key: 'salary_min', missingKey: 'target_salary_min', placeholder: 'Lowest CTC you would accept (LPA)' },
      { key: 'salary_max', placeholder: 'Target CTC (LPA)' }, { key: 'salary_walk_away', placeholder: 'LPA' }],
  },
]

const LABELS: Partial<Record<keyof Form, string>> = {
  linkedin: 'LinkedIn', github: 'GitHub', current_ctc_lpa: 'Current CTC (LPA)', expected_ctc_lpa: 'Expected CTC (LPA)',
  work_authorization_india: 'Work authorization in India', eeo_default: 'Diversity questions answer',
  salary_min: 'Salary floor (LPA)', salary_max: 'Salary target (LPA)', salary_walk_away: 'Walk-away (LPA)',
  cgpa: 'CGPA', class_12_percent: 'Class 12 (%)', class_10_percent: 'Class 10 (%)',
  education_start_month: 'Start month', education_start_year: 'Start year',
  education_end_month: 'End month', education_end_year: 'End year',
  experience_years: 'Years of experience (for matching)',
}

const str = (v: unknown) => (v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v))
const list = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)
const num = (s: string) => (s === '' ? null : Number(s))

export default function ProfilePage() {
  const qc = useQueryClient()
  const { start } = useTasks()
  const { data } = useQuery({ queryKey: ['profile'], queryFn: () => api<Profile>('/profile') })
  const form = useForm<Form>({ resolver: zodResolver(schema) })
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = form

  useEffect(() => {
    if (!data) return
    const a = data.answers
    reset({
      ...(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, str(v)])) as Partial<Form>),
      experience_years: str(data.candidate.experience_years),
      locations: str(data.candidate.locations), target_roles: str(data.candidate.target_roles),
      salary_min: str(data.salary.min), salary_max: str(data.salary.max), salary_walk_away: str(data.salary.walk_away),
    } as Form)
  }, [data, reset])

  const save = useMutation({
    mutationFn: (f: Form) => {
      const { experience_years, locations, target_roles, salary_min, salary_max, salary_walk_away, ...answers } = f
      return put<Profile>('/profile', {
        answers: {
          ...answers,
          total_experience_years: num(answers.total_experience_years) ?? '',
          graduation_year: num(answers.graduation_year) ?? '',
          education_start_year: num(answers.education_start_year) ?? '',
          education_end_year: num(answers.education_end_year) ?? '',
        },
        candidate: { experience_years: num(experience_years), locations: list(locations), target_roles: list(target_roles) },
        salary: { min: salary_min, max: salary_max, walk_away: salary_walk_away },
      })
    },
    onSuccess: p => {
      qc.setQueryData(['profile'], p)
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['jobs'] })
      // New roles or locations (or no company list yet): rebuild the company list for them.
      if (p.company_list_stale === 'profile_changed' || p.company_list_stale === 'missing') {
        toast.success('Profile saved. Finding companies for your roles (a few minutes)…')
        start('/discover', 'Finding companies')
      } else toast.success('Profile saved')
    },
    onError: e => toast.error((e as Error).message),
  })

  if (!data) {
    return <AppShell title="Profile"><Skeleton className="h-96 w-full" /></AppShell>
  }
  if (!data.exists) {
    return (
      <AppShell title="Profile">
        <p className="text-sm text-muted-foreground">
          config/profile.yml doesn't exist yet. Copy config/profile.example.yml to config/profile.yml and reload.
        </p>
      </AppShell>
    )
  }

  const missing = new Set(data.missing)
  return (
    <AppShell
      title="Profile"
      actions={
        <Button size="sm" onClick={handleSubmit(f => save.mutate(f))} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          {isDirty ? 'Save changes' : 'Saved'}
        </Button>
      }
    >
      <form onSubmit={handleSubmit(f => save.mutate(f))} className="mx-auto max-w-4xl space-y-4">
        {missing.size > 0 && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            {missing.size} answer{missing.size === 1 ? '' : 's'} still empty. Application forms that ask for them will
            stop and ask you.
          </p>
        )}
        {GROUPS.map(g => (
          <Card key={g.title}>
            <CardHeader>
              <CardTitle className="text-base">{g.title}</CardTitle>
              {g.hint && <CardDescription>{g.hint}</CardDescription>}
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {g.fields.map(({ key, placeholder, missingKey }) => {
                const isMissing = missing.has(missingKey ?? key)
                return (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={key}>{LABELS[key] ?? humanKey(key)}</Label>
                    <Input id={key} placeholder={placeholder} {...register(key)}
                      aria-invalid={!!errors[key]} className={cn(isMissing && 'border-amber-500')} />
                    {errors[key] ? (
                      <p className="text-xs text-destructive">{errors[key]?.message}</p>
                    ) : isMissing ? (
                      <p className="text-xs text-amber-700 dark:text-amber-400">Needed for applications</p>
                    ) : null}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        ))}
        <p className="text-xs text-muted-foreground">
          Saved to config/profile.yml (comments in the file are kept). Claude Code reads the same file.
        </p>
      </form>
    </AppShell>
  )
}
