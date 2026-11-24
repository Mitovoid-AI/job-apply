import type { FitLevel, Status } from './types'

export const STATUS_LABEL: Record<Status, string> = {
  to_apply: 'To apply',
  applied: 'Applied',
  hr_screen: 'HR screen',
  technical: 'Technical',
  final_round: 'Final round',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
}

export const STATUSES = Object.keys(STATUS_LABEL) as Status[]

export const FIT_LABEL: Record<FitLevel, string> = {
  fits: 'Fits',
  stretch: 'Stretch',
  senior: 'Too senior',
  unknown: 'Not stated',
}

export function yearsText(min: number | null, max: number | null) {
  if (min == null) return ''
  return max != null ? `${min}–${max} yrs` : `${min}+ yrs`
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(iso).toLocaleDateString()
}

export function initials(name: string) {
  return name
    .split(/[\s.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]!.toUpperCase())
    .join('')
}

export function humanKey(key: string) {
  const s = key.replace(/_/g, ' ').replace(/\blpa\b/i, '(LPA)').replace(/\bctc\b/i, 'CTC').replace(/\beeo\b/i, 'EEO')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
