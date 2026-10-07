import { describe, expect, it } from 'vitest'
import { dueTone, formatDayRange, parseDay, relativeDayLabel, toDayString } from './dates'

describe('dates', () => {
  it('round-trips calendar days without timezone drift', () => {
    expect(toDayString(parseDay('2026-10-13'))).toBe('2026-10-13')
  })

  it('formats ranges compactly', () => {
    expect(formatDayRange('2026-10-05', '2026-10-16')).toBe('Oct 5 – 16')
    expect(formatDayRange('2026-09-21', '2026-10-02')).toBe('Sep 21 – Oct 2')
    expect(formatDayRange('2026-12-28', '2027-01-08')).toBe('Dec 28, 2026 – Jan 8, 2027')
  })
})

describe('relative days', () => {
  const today = new Date(2026, 9, 7, 15, 30) // Oct 7, afternoon local time

  it('labels days relative to today regardless of time of day', () => {
    expect(relativeDayLabel('2026-10-07', today)).toBe('Today')
    expect(relativeDayLabel('2026-10-08', today)).toBe('Tomorrow')
    expect(relativeDayLabel('2026-10-06', today)).toBe('Yesterday')
    expect(relativeDayLabel('2026-10-13', today)).toBe('In 6 days')
    expect(relativeDayLabel('2026-10-04', today)).toBe('3 days ago')
  })

  it('assigns due tones', () => {
    expect(dueTone('2026-10-06', today)).toBe('overdue')
    expect(dueTone('2026-10-07', today)).toBe('today')
    expect(dueTone('2026-10-09', today)).toBe('soon')
    expect(dueTone('2026-10-10', today)).toBe('normal')
  })
})
