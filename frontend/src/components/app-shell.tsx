import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink, useLocation } from 'react-router'
import { useTheme } from 'next-themes'
import {
  BriefcaseBusiness, KanbanSquare, LayoutDashboard, Loader2, Moon, RefreshCw, Send, Settings, Sun, UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from '@/components/ui/sidebar'
import { useTasks } from '@/components/tasks'
import { api } from '@/lib/api'
import { ago } from '@/lib/format'
import type { BatchSummary, Overview, Profile } from '@/lib/types'

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/jobs', label: 'Jobs', icon: BriefcaseBusiness },
  { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { to: '/apply', label: 'Apply', icon: Send },
  { to: '/profile', label: 'Profile', icon: UserRound },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function AppSidebar() {
  const { pathname } = useLocation()
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api<Profile>('/profile') })
  const batches = useQuery({ queryKey: ['batches'], queryFn: () => api<BatchSummary[]>('/apply/batches') })
  const badge: Record<string, number> = {
    '/profile': profile.data?.missing.length ?? 0,
    '/apply': (batches.data ?? []).reduce((n, b) => n + b.needs + b.drafts_pending, 0),
  }
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Send className="size-4" />
          </div>
          <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">job-apply</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton asChild isActive={to === '/' ? pathname === '/' : pathname.startsWith(to)} tooltip={label}>
                    <NavLink to={to}>
                      <Icon />
                      <span>{label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                  {badge[to] ? <SidebarMenuBadge className="text-amber-600 dark:text-amber-400">{badge[to]}</SidebarMenuBadge> : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          Nothing is sent until you press Submit on the real form.
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle dark mode" onClick={() => setTheme(dark ? 'light' : 'dark')}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  )
}

export function ScanButton({ variant = 'outline' }: { variant?: 'outline' | 'default' }) {
  const { start, isRunning } = useTasks()
  const running = isRunning('scan')
  return (
    <Button variant={variant} size="sm" onClick={() => !running && start('/scan', 'Scan')}>
      {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      {running ? 'Scanning…' : 'Scan now'}
    </Button>
  )
}

function RunningTasks() {
  const { tasks } = useTasks()
  const running = tasks.filter(t => t.status === 'running' && t.kind !== 'scan')
  if (running.length === 0) return null
  return (
    <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
      <Loader2 className="size-3.5 animate-spin" />
      {running.length === 1 ? `${running[0]!.label}…` : `${running.length} tasks running…`}
    </div>
  )
}

export function AppShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/overview') })
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <h1 className="text-base font-medium">{title}</h1>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Last scan {ago(overview.data?.last_scan)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <RunningTasks />
            {actions}
            <ScanButton />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
