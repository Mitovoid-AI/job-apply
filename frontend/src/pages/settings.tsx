import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppShell } from '@/components/app-shell'
import { api } from '@/lib/api'
import type { Health } from '@/lib/types'

const CHECKS: { key: keyof Health; label: string; fix: string }[] = [
  { key: 'node', label: 'Node.js (runs the scan)', fix: 'Install Node 18+ or set NODE_BIN in .env.' },
  { key: 'tailor', label: 'Resume tailor (TAILOR_DIR)', fix: 'Set TAILOR_DIR in .env to the folder with tailor.py.' },
  { key: 'claude', label: 'Claude Code CLI (Evaluate)', fix: 'Install Claude Code or set CLAUDE_BIN in .env.' },
  { key: 'profile', label: 'config/profile.yml', fix: 'Copy config/profile.example.yml to config/profile.yml.' },
  { key: 'cv', label: 'cv.md (used by Evaluate and AI drafts)', fix: 'Create cv.md with your CV in Markdown.' },
  { key: 'llm', label: 'AI key for drafting form answers', fix: 'Set LLM_API_KEY or OPENROUTER_API_KEY in .env (or in the tailor’s .env).' },
]

export default function SettingsPage() {
  const { data } = useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/health') })
  return (
    <AppShell title="Settings">
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Setup</CardTitle>
            <CardDescription>What the dashboard can run on this machine</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {CHECKS.map(c => {
              const ok = data?.[c.key]
              return (
                <div key={c.key} className="flex items-start gap-3 py-2.5">
                  {ok ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 text-rose-600" />}
                  <div>
                    <div className="text-sm">{c.label}</div>
                    {data && !ok && <div className="text-xs text-muted-foreground">{c.fix}</div>}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Auto-prepare</CardTitle>
            <CardDescription>Set AUTO_PREPARE and AUTO_EVALUATE in .env and restart the dashboard.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {data?.auto_prepare?.length
              ? `After each scan, jobs marked ${data.auto_prepare.join(' or ')} get a tailored resume and every form answer prepared${data.auto_evaluate ? ', plus a grade' : ''}.`
              : 'Off'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily scan</CardTitle>
            <CardDescription>Set DAILY_SCAN_AT in .env (e.g. 09:00) and restart the dashboard.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {data?.daily_scan_at ? `Every day at ${data.daily_scan_at}, while the dashboard is running.` : 'Off'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How submitting works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Nothing is submitted without your click for that one job. On the Apply page, Submit (after you confirm)
              starts a Chrome window on this laptop, fills every answer, attaches your resume and presses the site's
              Submit button; if a required field is empty, a CAPTCHA shows or the site reports an error, it stops and
              leaves the window for you. Open filled form does the same but you press Submit yourself. Once the site
              confirms, the job is marked Applied.</p>
            <p>The dashboard only listens on 127.0.0.1. Its access token is in data/.dashboard-token.</p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
