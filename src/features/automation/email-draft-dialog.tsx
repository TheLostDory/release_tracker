import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { toUserMessage } from '@/lib/errors'
import { getEmailDraft, type EmailDraft, type EmailStep } from './api'
import { MAILTO_BODY_LIMIT, mailtoUrl, textToHtml } from './email-draft'

/** Draft of the RC / escalation / release email: edit, copy or open in the mail app, then mark the step done. */
export function EmailDraftDialog({
  releaseId,
  step,
  stepName,
  open,
  onOpenChange,
  onMarkSent,
}: {
  releaseId: string
  step: EmailStep
  stepName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present when the step can still be completed by this user. */
  onMarkSent?: () => void
}) {
  const draft = useQuery({ queryKey: ['email-draft', releaseId, step], queryFn: () => getEmailDraft(releaseId, step), enabled: open, staleTime: 0, gcTime: 0 })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{stepName}: draft</DialogTitle>
          <DialogDescription>Written from the release’s data. Edit anything, then copy it or open it in your mail app.</DialogDescription>
        </DialogHeader>
        {draft.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : draft.error ? (
          <p className="text-sm text-destructive">{toUserMessage(draft.error)}</p>
        ) : draft.data ? (
          <DraftForm key={draft.dataUpdatedAt} draft={draft.data} onMarkSent={onMarkSent} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DraftForm({ draft, onMarkSent, onDone }: { draft: EmailDraft; onMarkSent?: () => void; onDone: () => void }) {
  const [to, setTo] = useState(draft.to)
  const [cc, setCc] = useState(draft.cc)
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.text)
  const edited = body !== draft.text
  const html = edited ? textToHtml(body) : draft.html

  async function copy(quiet = false) {
    try {
      // Rich text pastes formatted into Outlook; plain text everywhere else.
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([body], { type: 'text/plain' }) }),
      ])
    } catch {
      await navigator.clipboard.writeText(body)
    }
    if (!quiet) toast.success('Email copied: paste it into Outlook')
  }

  async function openInMail() {
    const fits = body.length <= MAILTO_BODY_LIMIT
    if (!fits) {
      await copy(true)
      toast.info('The email is long: its text is in your clipboard, paste it into the new message.')
    }
    window.location.href = mailtoUrl(to, cc, subject, fits ? body : null)
  }

  return (
    <div className="min-w-0 space-y-3">
      {draft.notes.map((n) => (
        <p key={n} className="text-sm text-amber-800 dark:text-amber-300">
          {n}
        </p>
      ))}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">
          To
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Set default recipients in Settings → Automation" />
        </label>
        <label className="space-y-1 text-xs font-medium">
          Cc
          <Input value={cc} onChange={(e) => setCc(e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1 text-xs font-medium">
        Subject
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="block space-y-1 text-xs font-medium">
        Message
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="font-mono text-xs" />
      </label>
      <DialogFooter className="flex-wrap gap-2 sm:justify-between">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void copy()}>
            <Copy />
            Copy email
          </Button>
          <Button variant="outline" onClick={() => void openInMail()}>
            <Mail />
            Open in mail app
          </Button>
        </div>
        {onMarkSent && (
          <Button
            onClick={() => {
              onMarkSent()
              onDone()
              toast.success('Marked as sent')
            }}
          >
            <Check />
            Mark as sent
          </Button>
        )}
      </DialogFooter>
    </div>
  )
}
