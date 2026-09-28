// Shared between the web app and Cloud Functions. Keep dependency-free.

export type PersonKey = 'gooya' | 'eunbi'

export type ColorName =
  | 'blue' | 'orange' | 'pink' | 'red' | 'green' | 'teal' | 'indigo' | 'purple' | 'yellow'

export interface ColorDef {
  name: ColorName
  label: string
  light: string
  dark: string
}

export const COLORS: Record<ColorName, ColorDef> = {
  blue: { name: 'blue', label: 'Blue', light: '#007aff', dark: '#0a84ff' },
  orange: { name: 'orange', label: 'Orange', light: '#ff9500', dark: '#ff9f0a' },
  pink: { name: 'pink', label: 'Pink', light: '#ff2d55', dark: '#ff375f' },
  red: { name: 'red', label: 'Red', light: '#ff3b30', dark: '#ff453a' },
  green: { name: 'green', label: 'Green', light: '#34c759', dark: '#30d158' },
  teal: { name: 'teal', label: 'Teal', light: '#30b0c7', dark: '#40c8e0' },
  indigo: { name: 'indigo', label: 'Indigo', light: '#5856d6', dark: '#5e5ce6' },
  purple: { name: 'purple', label: 'Purple', light: '#af52de', dark: '#bf5af2' },
  yellow: { name: 'yellow', label: 'Yellow', light: '#ffcc00', dark: '#ffd60a' },
}

export interface PersonDef {
  key: PersonKey
  email: string
  name: string
  timezone: string
  color: ColorName
}

export const PEOPLE: Record<PersonKey, PersonDef> = {
  gooya: {
    key: 'gooya',
    email: 'goochoi913@gmail.com',
    name: '구야',
    timezone: 'America/New_York',
    color: 'blue',
  },
  eunbi: {
    key: 'eunbi',
    email: 'evapark7147@gmail.com',
    name: '은비',
    timezone: 'Asia/Seoul',
    color: 'orange',
  },
}

export const PERSON_KEYS: PersonKey[] = ['gooya', 'eunbi']

export function personForEmail(email?: string | null): PersonDef | null {
  if (!email) return null
  const e = email.trim().toLowerCase()
  for (const key of PERSON_KEYS) {
    if (PEOPLE[key].email === e) return PEOPLE[key]
  }
  return null
}

export function otherPerson(key: PersonKey): PersonKey {
  return key === 'gooya' ? 'eunbi' : 'gooya'
}

export function isPersonKey(v: unknown): v is PersonKey {
  return v === 'gooya' || v === 'eunbi'
}

const HEX = /^#([0-9a-f]{6})$/i

/** Resolve a stored color (hex or legacy palette name) to light/dark hex values. */
export function colorPair(c: string | null | undefined, fallback: ColorName = 'blue'): { light: string; dark: string } {
  if (c && HEX.test(c)) return { light: c, dark: c }
  const def = (c && (COLORS as Record<string, ColorDef>)[c]) || COLORS[fallback]
  return { light: def.light, dark: def.dark }
}
