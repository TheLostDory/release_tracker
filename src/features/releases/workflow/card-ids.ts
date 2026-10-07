import type { WorkflowTaskType } from '@/types/domain'

/** DOM id of the card (report/approval) that controls a managed step. */
export function managedCardId(type: WorkflowTaskType): string {
  return `card-${type}`
}
