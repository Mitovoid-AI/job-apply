export type Status =
  | 'to_apply' | 'applied' | 'hr_screen' | 'technical' | 'final_round'
  | 'offer' | 'accepted' | 'rejected' | 'withdrawn' | 'expired'

export type FitLevel = 'fits' | 'stretch' | 'senior' | 'unknown'

export interface Fit {
  level: FitLevel
  min: number | null
  max: number | null
  quote: string | null
}

export interface Evaluation {
  grade: string
  score: number
  recommendation?: string
  summary?: string
  gaps?: string[]
  report?: string | null
  evaluated_at?: string
}

export interface ResumeMeta {
  base?: string
  page_count?: number
  page_limit?: number
  projects?: string[]
  dropped?: string[]
  built_at?: string
}

export interface PipelineEntry {
  id: number
  company: string
  role: string
  grade: string | null
  score: number | null
  status: Status
  source: string
  url: string
  location: string
  date_found: string
  date_applied: string | null
  next_action: string
  notes: string
  resume_pdf?: string
  resume_meta?: ResumeMeta
  evaluation?: Evaluation
  updated_at?: string
}

export interface Job {
  id: string
  url: string
  company: string
  title: string
  location: string
  source: string
  tier: string | null
  posted_at: string | null
  department: string
  remote: boolean
  in_scan: boolean
  match?: 'core' | 'adjacent' | null
  fit: Fit | null
  pipeline: PipelineEntry | null
}

export interface JobDetail extends Job {
  jd: string | null
  jd_fetched_at: string | null
  report_text: string | null
}

export interface Overview {
  last_scan: string | null
  scan_errors: number
  scan_failed?: string[]
  counts: {
    matches: number; fits: number; to_apply: number; applied: number
    interviewing: number; offers: number; rejected: number
  }
  funnel: { stage: string; value: number }[]
  needs_action: { kind: string; job_id: string | null; text: string }[]
}

export interface Task {
  id: string
  kind: 'scan' | 'resume' | 'evaluate' | 'prepare' | 'window'
  key: string
  status: 'running' | 'done' | 'error'
  started_at: string
  finished_at: string | null
  result: Record<string, unknown> | null
  error: string | null
}

export interface Profile {
  exists: boolean
  answers: Record<string, string | number | null>
  candidate: { experience_years: number | null; locations: string[] | null; target_roles: string[] | null }
  salary: { min: number | null; max: number | null; walk_away: number | null }
  missing: string[]
  optional: string[]
}

export interface BatchField {
  key: string
  label: string
  required: boolean
  type: 'text' | 'select' | 'textarea' | 'file' | 'checkbox'
  options?: string[]
  value: string | null
  source: 'profile' | 'draft' | 'need' | 'resume' | 'edited' | 'empty'
  approved?: boolean
  note?: string
}

export interface BatchJob {
  n: number
  job_id?: string
  pipeline_id?: number
  company: string
  role: string
  url: string
  source?: string
  fit?: Fit | null
  prepared_at?: string
  grade_error?: string | null
  grade?: string
  resume_pdf?: string
  ready: boolean
  blockers?: string[]
  consent?: string[]
  fields: BatchField[]
  result?: { status: string; at?: string; note?: string } | null
  summary: { needs: number; drafts_pending: number }
}

export interface Batch {
  name: string
  created_at: string
  jobs: BatchJob[]
  hash: string
  changed_since_shown: boolean
  submit_command: string | null
}

export interface BatchSummary {
  name: string
  created_at: string
  jobs: number
  ready: number
  submitted: number
  needs: number
  drafts_pending: number
}

export interface Health {
  ok: boolean
  tailor: boolean
  claude: boolean
  node: boolean
  profile: boolean
  cv: boolean
  daily_scan_at: string | null
  llm: boolean
  auto_prepare: string[]
  auto_evaluate: boolean
}

export interface WindowState {
  status: 'idle' | 'opening' | 'filling' | 'waiting' | 'submitted' | 'closed' | 'timeout'
  batch?: string
  n?: number
  company?: string
  role?: string
  problems?: { label: string; error: string }[]
  missing?: string[]
  proof?: string
}
