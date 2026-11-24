import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import { ThemeProvider } from 'next-themes'
import { KeyRound } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TasksProvider } from '@/components/tasks'
import { ApiError, hasToken } from '@/lib/api'
import ApplyPage from '@/pages/apply'
import JobsPage from '@/pages/jobs'
import OverviewPage from '@/pages/overview'
import PipelinePage from '@/pages/pipeline'
import ProfilePage from '@/pages/profile'
import SettingsPage from '@/pages/settings'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
})

function NoToken() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="max-w-md space-y-3 text-center">
        <KeyRound className="mx-auto size-8 text-muted-foreground" />
        <h1 className="text-lg font-medium">Open the dashboard from its link</h1>
        <p className="text-sm text-muted-foreground">
          The dashboard only answers requests that carry its access token. Start it with
          <code className="mx-1 rounded bg-muted px-1">python -m backend</code>
          and open the link it prints (it ends in <code className="rounded bg-muted px-1">#token=…</code>). The token is
          also saved in <code className="rounded bg-muted px-1">data/.dashboard-token</code>.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          {hasToken() ? (
            <TasksProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<OverviewPage />} />
                  <Route path="/jobs" element={<JobsPage />} />
                  <Route path="/pipeline" element={<PipelinePage />} />
                  <Route path="/apply" element={<ApplyPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<OverviewPage />} />
                </Routes>
              </BrowserRouter>
            </TasksProvider>
          ) : (
            <NoToken />
          )}
          <Toaster richColors position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
