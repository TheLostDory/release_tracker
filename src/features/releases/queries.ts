import { useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { sprintKeys } from '@/features/sprints/queries'
import { toDayString } from '@/lib/dates'
import { toUserMessage } from '@/lib/errors'
import {
  createRelease,
  deleteRelease,
  getRelease,
  listActivity,
  listReleases,
  updateApproval,
  updateRelease,
  updateReport,
  updateTask,
  type ApprovalPatch,
  type ReleaseDetail,
  type ReleaseFilters,
  type ReleasePatch,
  type ReleaseTask,
  type ReportPatch,
  type TaskPatch,
} from './api'
import { applyApprovalPatch, applyReportPatch, applyTaskPatch } from './workflow-sync'

export const releaseKeys = {
  all: ['releases'] as const,
  lists: () => [...releaseKeys.all, 'list'] as const,
  list: (filters: ReleaseFilters) => [...releaseKeys.lists(), filters] as const,
  detail: (id: string) => [...releaseKeys.all, 'detail', id] as const,
  activity: (id: string) => [...releaseKeys.all, 'activity', id] as const,
}

export function useReleases(filters: ReleaseFilters, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: releaseKeys.list(filters),
    queryFn: () => listReleases(filters),
    enabled: options.enabled ?? true,
  })
}

export function useRelease(id: string | undefined) {
  return useQuery({
    queryKey: releaseKeys.detail(id ?? ''),
    queryFn: () => getRelease(id!),
    enabled: !!id,
  })
}

/**
 * Warm the release page on hover/focus: its code chunk and its data, so the
 * click feels instant. Cheap to call repeatedly (dedup + 30s freshness).
 */
export function usePrefetchRelease() {
  const qc = useQueryClient()
  return useCallback(
    (id: string) => {
      void import('@/pages/release-detail-page')
      void qc.prefetchQuery({ queryKey: releaseKeys.detail(id), queryFn: () => getRelease(id), staleTime: 30_000 })
    },
    [qc],
  )
}

export function useReleaseActivity(id: string) {
  return useQuery({ queryKey: releaseKeys.activity(id), queryFn: () => listActivity(id) })
}

/**
 * Background refresh (not awaited) so callers can navigate right away.
 * Lists, sprint counts and the release's activity all derive from writes.
 */
function refreshAfterWrite(qc: QueryClient, releaseId?: string) {
  void qc.invalidateQueries({ queryKey: releaseKeys.lists() })
  void qc.invalidateQueries({ queryKey: sprintKeys.all })
  if (releaseId) {
    void qc.invalidateQueries({ queryKey: releaseKeys.detail(releaseId) })
    void qc.invalidateQueries({ queryKey: releaseKeys.activity(releaseId) })
  }
}

/** Live updates: refetch when anyone changes this release (Server-Sent Events). */
export function useReleaseRealtime(releaseId: string | undefined) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!releaseId) return
    let timer: number | undefined
    // Coalesce bursts (one save can touch several rows via triggers).
    const refresh = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => refreshAfterWrite(qc, releaseId), 300)
    }
    // EventSource reconnects by itself; same-origin, sends the session cookie.
    const source = new EventSource(`/api/releases/${releaseId}/events`)
    source.addEventListener('change', refresh)
    return () => {
      window.clearTimeout(timer)
      source.close()
    }
  }, [qc, releaseId])
}

/** Shared optimistic-update plumbing for edits to one release's detail. */
function useOptimisticReleaseMutation<V>(
  releaseId: string,
  mutationFn: (vars: V) => Promise<void>,
  apply: (release: ReleaseDetail, vars: V, now: string) => ReleaseDetail,
) {
  const qc = useQueryClient()
  const key = releaseKeys.detail(releaseId)
  return useMutation({
    mutationFn,
    onMutate: async (vars: V) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<ReleaseDetail>(key)
      if (previous) qc.setQueryData<ReleaseDetail>(key, apply(previous, vars, new Date().toISOString()))
      return { previous }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous)
      toast.error(toUserMessage(err))
    },
    onSettled: () => refreshAfterWrite(qc, releaseId),
  })
}

export interface TaskUpdate {
  task: ReleaseTask
  patch: TaskPatch
}

export function useUpdateTask(releaseId: string) {
  return useOptimisticReleaseMutation<TaskUpdate>(
    releaseId,
    async ({ task, patch }) => {
      await updateTask(task.id, patch)
      // The release's actual deployment date follows the Deployment step
      // (viewer's local calendar day, see lib/dates.ts).
      if (task.task_type === 'DEPLOYMENT' && patch.status && patch.status !== task.status) {
        await updateRelease(releaseId, {
          actual_deployment_date: patch.status === 'COMPLETED' ? toDayString(new Date()) : null,
        })
      }
    },
    (release, { task, patch }, now) => ({
      ...release,
      tasks: release.tasks.map((t) => (t.id === task.id ? applyTaskPatch(t, patch, now) : t)),
      actual_deployment_date:
        task.task_type === 'DEPLOYMENT' && patch.status
          ? patch.status === 'COMPLETED'
            ? toDayString(new Date())
            : null
          : release.actual_deployment_date,
    }),
  )
}

export function useUpdateReport(releaseId: string) {
  return useOptimisticReleaseMutation<{ id: string; patch: ReportPatch }>(
    releaseId,
    ({ id, patch }) => updateReport(id, patch),
    (release, { id, patch }, now) => applyReportPatch(release, id, patch, now),
  )
}

export function useUpdateApproval(releaseId: string) {
  return useOptimisticReleaseMutation<{ id: string; patch: ApprovalPatch }>(
    releaseId,
    ({ id, patch }) => updateApproval(id, patch),
    (release, { patch }, now) => applyApprovalPatch(release, patch, now),
  )
}

export function useCreateRelease() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: createRelease, onSuccess: () => refreshAfterWrite(qc) })
}

export function useUpdateRelease() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ReleasePatch }) => updateRelease(id, patch),
    onSuccess: (_data, { id }) => refreshAfterWrite(qc, id),
  })
}

export function useDeleteRelease() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteRelease,
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: releaseKeys.detail(id) })
      qc.removeQueries({ queryKey: releaseKeys.activity(id) })
      refreshAfterWrite(qc)
    },
  })
}
