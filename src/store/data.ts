import { create } from 'zustand'
import type { PersonKey } from '@shared/people'
import type { CalendarEvent, Schedule, SyncDirection, Task, TaskList, UserDoc } from '@shared/model'

export interface IntegrationCalendar {
  name: string
  color: string
  primary?: boolean
  direction: SyncDirection
  /** false for calendars GOOYA may not change (holidays, subscriptions, shared for viewing): Import only. */
  writable?: boolean
  lastSync?: number
}

export interface IntegrationAccount {
  id: string
  source: 'google' | 'apple'
  email: string
  status: 'connected' | 'error'
  error?: string
  calendars: Record<string, IntegrationCalendar>
  exportTasks?: boolean
  exportSchedules?: boolean
  /** The "GOOYA" calendar made in this account for the copies. */
  exportCalendarId?: string
  lastSync?: number
}

interface DataState {
  tasks: Task[]
  schedules: Schedule[]
  users: Partial<Record<PersonKey, UserDoc>>
  lists: TaskList[]
  events: CalendarEvent[]
  accounts: IntegrationAccount[]
  loaded: { tasks: boolean; schedules: boolean; users: boolean; lists: boolean }
  /** The tasks and lists last came from the server, not only from this phone's copy (which may be behind). */
  fresh: { tasks: boolean; lists: boolean }
  setFresh: (what: 'tasks' | 'lists', fresh: boolean) => void
  setTasks: (tasks: Task[]) => void
  setLists: (lists: TaskList[]) => void
  setEvents: (events: CalendarEvent[]) => void
  setAccounts: (accounts: IntegrationAccount[]) => void
  setSchedules: (schedules: Schedule[]) => void
  setUsers: (users: Partial<Record<PersonKey, UserDoc>>) => void
}

export const useData = create<DataState>((set) => ({
  tasks: [],
  schedules: [],
  users: {},
  lists: [],
  events: [],
  accounts: [],
  loaded: { tasks: false, schedules: false, users: false, lists: false },
  fresh: { tasks: false, lists: false },
  setFresh: (what, fresh) => set((s) => (s.fresh[what] === fresh ? s : { fresh: { ...s.fresh, [what]: fresh } })),
  setTasks: (tasks) => set((s) => ({ tasks, loaded: { ...s.loaded, tasks: true } })),
  setLists: (lists) => set((s) => ({ lists: [...lists].sort((a, b) => a.order - b.order), loaded: { ...s.loaded, lists: true } })),
  setEvents: (events) => set({ events }),
  setAccounts: (accounts) => set({ accounts }),
  setSchedules: (schedules) => set((s) => ({ schedules, loaded: { ...s.loaded, schedules: true } })),
  setUsers: (users) => set((s) => ({ users, loaded: { ...s.loaded, users: true } })),
}))
