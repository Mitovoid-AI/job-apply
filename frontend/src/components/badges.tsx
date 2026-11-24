import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FIT_LABEL, STATUS_LABEL, initials, yearsText } from '@/lib/format'
import type { Fit, Status } from '@/lib/types'
import { cn } from '@/lib/utils'

const FIT_STYLE = {
  fits: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  stretch: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  senior: 'bg-rose-500/12 text-rose-700 dark:text-rose-400',
  unknown: 'bg-muted text-muted-foreground',
} as const

export function FitBadge({ fit }: { fit: Fit | null }) {
  if (!fit) return <span className="text-xs text-muted-foreground">—</span>
  const years = yearsText(fit.min, fit.max)
  const badge = (
    <Badge variant="secondary" className={cn('font-normal', FIT_STYLE[fit.level])}>
      {years ? `${years} · ` : ''}
      {FIT_LABEL[fit.level]}
    </Badge>
  )
  if (!fit.quote) return badge
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-xs">“…{fit.quote}…”</TooltipContent>
    </Tooltip>
  )
}

const GRADE_STYLE: Record<string, string> = {
  A: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  B: 'bg-teal-500/15 text-teal-700 dark:text-teal-400',
  C: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  D: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  F: 'bg-rose-500/15 text-rose-700 dark:text-rose-400',
}

export function GradeBadge({ grade, score }: { grade?: string | null; score?: number | null }) {
  if (!grade) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <Badge variant="secondary" className={cn('font-medium tabular-nums', GRADE_STYLE[grade] ?? '')}>
      {grade}
      {score != null ? ` · ${Number(score).toFixed(1)}` : ''}
    </Badge>
  )
}

export function StatusBadge({ status }: { status?: Status | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">New</span>
  const muted = ['rejected', 'withdrawn', 'expired'].includes(status)
  return (
    <Badge variant="outline" className={cn('font-normal', muted && 'text-muted-foreground')}>
      {STATUS_LABEL[status]}
    </Badge>
  )
}

function hue(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

export function CompanyAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-medium', className)}
      style={{ backgroundColor: `hsl(${hue(name)} 70% 50% / 0.14)`, color: `hsl(${hue(name)} 60% 38%)` }}
    >
      {initials(name)}
    </div>
  )
}
