import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { AutomationSettings, JobPurpose } from './api'
import { parseParamList, PURPOSE_LABEL } from './jobs'

type Job = AutomationSettings['jenkins']['jobs'][number]

const toText = (p: Record<string, string>) => Object.entries(p).map(([k, v]) => `${k}=${v}`).join(', ')
/** The project's automated Jenkins jobs: purpose, job path, parameters. */
export function JobsEditor({ jobs, onChange }: { jobs: Job[]; onChange: (jobs: Job[]) => void }) {
  const update = (i: number, patch: Partial<Job>) => onChange(jobs.map((j, k) => (k === i ? { ...j, ...patch } : j)))
  return (
    <div className="space-y-2">
      {jobs.map((job, i) => (
        <div key={i} className="grid items-center gap-2 sm:grid-cols-[11rem_1fr_1fr_auto]">
          <Select value={job.purpose} onValueChange={(v) => update(i, { purpose: v as JobPurpose })}>
            <SelectTrigger size="sm" className="w-full" aria-label="Purpose">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PURPOSE_LABEL) as JobPurpose[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {p === 'AUTOMATED' ? 'Other job / parent' : PURPOSE_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input aria-label="Job path" className="h-8 font-mono text-xs" placeholder="folder/job-name" value={job.jobPath} onChange={(e) => update(i, { jobPath: e.target.value })} />
          <Input
            aria-label="Parameters"
            className="h-8 font-mono text-xs"
            placeholder={job.startedByParent ? 'Set by the parent job' : 'RC_VERSION={{version}}, ENV=staging'}
            disabled={!!job.startedByParent}
            defaultValue={toText(job.parameters)}
            onBlur={(e) => update(i, { parameters: parseParamList(e.target.value) })}
          />
          <Button size="icon-sm" variant="ghost" aria-label="Remove job" onClick={() => onChange(jobs.filter((_, k) => k !== i))}>
            <Trash2 />
          </Button>
          {job.purpose !== 'AUTOMATED' && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-4 sm:pl-[11.5rem]">
              <input
                type="checkbox"
                className="size-3.5 accent-foreground"
                checked={!!job.startedByParent}
                onChange={(e) => update(i, { startedByParent: e.target.checked })}
              />
              Started by the parent job: don’t start it here, take its run from the parent’s run
            </label>
          )}
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          const used = new Set(jobs.map((j) => j.purpose))
          const purpose = (['LOAD_TEST', 'LONGEVITY', 'HIT'] as const).find((p) => !used.has(p)) ?? 'AUTOMATED'
          onChange([...jobs, { purpose, jobPath: '', parameters: {} }])
        }}
      >
        <Plus />
        Add job
      </Button>
    </div>
  )
}
