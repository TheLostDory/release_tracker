import {
  Ban,
  CalendarClock,
  CircleCheck,
  GitCompareArrows,
  Clock,
  Hourglass,
  OctagonX,
  Rocket,
  TimerOff,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import type { ActionKind } from './action-items'
import type { ReleaseStatus } from '@/types/domain'

export const RELEASE_STATUS_ICONS: Record<ReleaseStatus, LucideIcon> = {
  ON_TRACK: CircleCheck,
  AT_RISK: TriangleAlert,
  BLOCKED: OctagonX,
  WAITING_FOR_APPROVAL: Hourglass,
  RELEASED: Rocket,
}

export const ACTION_KIND_ICONS: Record<ActionKind, LucideIcon> = {
  blocked: Ban,
  overdue: TimerOff,
  due_today: Clock,
  awaiting_approval: Hourglass,
  deployment_overdue: TimerOff,
  deployment_soon: CalendarClock,
  code_mismatch: GitCompareArrows,
}
