import { create } from 'zustand'
import type { PersonKey } from '@shared/people'
import type { CalendarEvent, DateKey, EventOccurrence, Schedule, Task, TaskOccurrence } from '@shared/model'

export interface EditorRequest {
  kind: 'task' | 'schedule' | 'event'
  /** An event of a two-way calendar, and the occurrence opened. */
  event?: CalendarEvent
  eventOcc?: EventOccurrence
  task?: Task
  /** The occurrence being edited (effective, override-aware values). */
  occ?: TaskOccurrence
  schedule?: Schedule
  /** Edit only this occurrence (date key in the item's own zone). */
  dayOnly?: DateKey
  initialOwner?: PersonKey
  initialDate?: DateKey
  /** Minutes since local midnight for a timed default start. */
  initialMinutes?: number
  initialAllDay?: boolean
  initialListId?: string
}

export type DetailRequest =
  | { kind: 'task'; taskId: string; dateKey: DateKey }
  | { kind: 'schedule'; scheduleId: string; dateKey: DateKey }
  | { kind: 'event'; eventId: string; dateKey: DateKey }

interface SheetsState {
  editor: EditorRequest | null
  detail: DetailRequest | null
  openEditor: (r: EditorRequest) => void
  closeEditor: () => void
  openDetail: (r: DetailRequest) => void
  closeDetail: () => void
}

export const useSheets = create<SheetsState>((set) => ({
  editor: null,
  detail: null,
  openEditor: (editor) => set({ editor }),
  closeEditor: () => set({ editor: null }),
  openDetail: (detail) => set({ detail }),
  closeDetail: () => set({ detail: null }),
}))
