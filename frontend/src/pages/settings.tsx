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
  { key: 'cv', label: 'cv.md (used by Evaluate)', fix: 'Create cv.md with your CV in Markdown.' },
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
            <p>This dashboard never submits applications. In Claude Code (opened in this repo), run /apply to prepare a
              batch, review and fix it on the Apply page, then paste the submit command into Claude Code.</p>
            <p>The dashboard only listens on 127.0.0.1. Its access token is in data/.dashboard-token.</p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
