/** Early reminder options in Apple Reminders' wording. Values are minutes before the due time. */
export const EARLY_REMINDERS: Array<{ value: number | null; label: string }> = [
  { value: null, label: 'None' },
  { value: 5, label: '5 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
  { value: 10080, label: '1 week before' },
]

export function earlyReminderLabel(value: number): string {
  const found = EARLY_REMINDERS.find((a) => a.value === value)
  if (found) return found.label
  if (value % 10080 === 0) return `${value / 10080} weeks before`
  if (value % 1440 === 0) return `${value / 1440} days before`
  if (value % 60 === 0) return `${value / 60} hours before`
  return `${value} minutes before`
}

/** Date-only tasks alert at this local time. */
export const DATE_ONLY_ALERT_TIME = '09:00'
