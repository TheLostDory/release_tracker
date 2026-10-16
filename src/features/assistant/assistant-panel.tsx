import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { ArrowUp, ExternalLink, RotateCcw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { toUserMessage } from '@/lib/errors'
import { safeHttpUrl } from '@/lib/safe-url'
import { assistantApi, type ChatSource } from './api'
import { conversationFor, linkify } from './linkify'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
}

const EXAMPLES = ['Which version was ABC-123 released in?', "What's in the next release?", 'Which releases are blocked, and why?', 'Did the Jenkins jobs pass for the latest release?']

/** "Ask" button in the top bar + a side panel to chat about the current project's releases. */
export function AssistantPanel() {
  const { data: config } = useQuery({ queryKey: ['assistant', 'config'], queryFn: assistantApi.config, staleTime: Infinity })
  const { currentProject } = useCurrentProject()
  const [open, setOpen] = useState(false)
  // One conversation per project; switching projects starts a new one.
  const [turns, setTurns] = useState<Turn[]>([])
  const [projectId, setProjectId] = useState(currentProject?.id)
  if (projectId !== currentProject?.id) {
    setProjectId(currentProject?.id)
    setTurns([])
  }

  if (!config?.enabled || !currentProject) return null
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label="Ask about releases">
        <Sparkles />
        <span className="hidden md:inline">Ask</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="size-4" /> Ask about releases
            </SheetTitle>
            <SheetDescription>
              Answers from {currentProject.name}: releases, their Jira versions and issues, and Jenkins builds.
            </SheetDescription>
          </SheetHeader>
          <Chat projectId={currentProject.id} turns={turns} setTurns={setTurns} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  )
}

function Chat({
  projectId,
  turns,
  setTurns,
  onNavigate,
}: {
  projectId: string
  turns: Turn[]
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>
  onNavigate: () => void
}) {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const ask = useMutation({
    mutationFn: (question: string) =>
      assistantApi.ask(
        projectId,
        conversationFor(
          turns.map(({ role, content }) => ({ role, content })),
          question,
        ),
      ),
  })

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns.length, ask.isPending])

  async function send(question: string) {
    const q = question.trim()
    if (!q || ask.isPending) return
    setError(null)
    setInput('')
    setTurns((t) => [...t, { role: 'user', content: q }])
    try {
      const { answer, sources } = await ask.mutateAsync(q)
      setTurns((t) => [...t, { role: 'assistant', content: answer, sources }])
    } catch (err) {
      // Drop the unanswered question from the history; put it back in the box.
      setTurns((t) => t.slice(0, -1))
      setInput(q)
      setError(toUserMessage(err))
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void send(input)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {turns.length === 0 && !ask.isPending && (
          <div className="space-y-2">
            <p className="text-muted-foreground">Try asking:</p>
            {EXAMPLES.map((q) => (
              <button
                key={q}
                type="button"
                className="block w-full rounded-md border px-3 py-2 text-left hover:bg-muted/50"
                onClick={() => setInput(q)}
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="ml-8 rounded-lg bg-primary px-3 py-2 break-words whitespace-pre-wrap text-primary-foreground">
              {t.content}
            </div>
          ) : (
            <Answer key={i} turn={t} onNavigate={onNavigate} />
          ),
        )}
        {ask.isPending && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Sparkles className="size-4 animate-pulse" /> Looking through releases, Jira and Jenkins…
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="space-y-2 border-t p-3">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            autoFocus
            rows={2}
            maxLength={4000}
            aria-label="Your question"
            placeholder="Ask about a release, version or issue key…"
            className="max-h-40 min-h-10 resize-none"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send(input)
              }
            }}
          />
          <Button type="submit" size="icon" aria-label="Send" disabled={!input.trim() || ask.isPending}>
            <ArrowUp />
          </Button>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>AI answers can be wrong; check the linked sources.</span>
          {turns.length > 0 && (
            <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => setTurns([])} disabled={ask.isPending}>
              <RotateCcw className="size-3" /> New chat
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

function Answer({ turn, onNavigate }: { turn: Turn; onNavigate: () => void }) {
  const sources = turn.sources ?? []
  return (
    <div className="mr-4 space-y-2">
      <div className="break-words whitespace-pre-wrap">
        {linkify(turn.content, sources).map((s, i) =>
          s.href ? (
            <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">
              {s.text}
            </a>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </div>
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {sources.map((s) => {
            const chip = 'inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground'
            if (s.kind === 'release') {
              if (!/^\/releases\/[\w-]+$/.test(s.url)) return null
              return (
                <Link key={s.url} to={s.url} onClick={onNavigate} className={chip}>
                  {s.label}
                </Link>
              )
            }
            const href = safeHttpUrl(s.url)
            return href ? (
              <a key={s.url} href={href} target="_blank" rel="noopener noreferrer" className={chip}>
                {s.label} <ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
            ) : null
          })}
        </div>
      )}
    </div>
  )
}
