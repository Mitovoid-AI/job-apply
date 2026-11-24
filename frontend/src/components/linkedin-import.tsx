import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Inbox, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { post } from '@/lib/api'

// Paste a LinkedIn job-alert email; its jobs join the Jobs list. LinkedIn itself is never contacted.
export function LinkedInImport() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const run = useMutation({
    mutationFn: () => post<{ found: number; added: number }>('/linkedin/import', { text }),
    onSuccess: r => {
      qc.invalidateQueries()
      if (r.found === 0) {
        toast.error('No LinkedIn job links found', { description: 'Paste the whole alert email, including the "View job" links.' })
        return
      }
      toast.success(`Added ${r.added} new job${r.added === 1 ? '' : 's'} (${r.found} in the alert)`)
      setText('')
      setOpen(false)
    },
    onError: e => toast.error((e as Error).message),
  })
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} title="Add the jobs from a LinkedIn job-alert email">
        <Inbox /> <span className="hidden sm:inline">Import LinkedIn alert</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Import a LinkedIn job alert</DialogTitle>
            <DialogDescription>
              Open the alert email, select all, copy, and paste it here. Only what's in the email is read; LinkedIn
              isn't contacted. You apply on LinkedIn or the company's site; these jobs can't be auto-filled. You can
              also drop alert .eml files in data/linkedin-alerts/ and the next scan imports them.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={text} onChange={e => setText(e.target.value)} rows={10}
            placeholder={'Machine Learning Engineer\nAcme AI\nBengaluru, Karnataka, India\nView job: https://www.linkedin.com/comm/jobs/view/…'}
            className="max-h-80 font-mono text-xs" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => run.mutate()} disabled={!text.trim() || run.isPending}>
              {run.isPending && <Loader2 className="animate-spin" />} Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
