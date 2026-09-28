import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import type { Request } from 'firebase-functions/v2/https'
import { PEOPLE, personForEmail, type PersonKey } from '../../../shared/people'
import type { SyncDirection } from '../../../shared/model'

export const APP_URL = 'https://gooya-eunbee.web.app'
export const FUNCTIONS_URL = 'https://us-east1-gooya-37d79.cloudfunctions.net'

/** 32-byte hex key for AES-256-GCM (Secret Manager). */
export const INTEGRATIONS_KEY = defineSecret('INTEGRATIONS_KEY')
export const GOOGLE_OAUTH_CLIENT_ID = defineSecret('GOOGLE_OAUTH_CLIENT_ID')
export const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret('GOOGLE_OAUTH_CLIENT_SECRET')

export interface CalendarConfig {
  name: string
  color: string
  primary?: boolean
  direction: SyncDirection
  syncToken?: string
  ctag?: string
  url?: string
  lastSync?: number
}

export interface WatchChannel {
  channelId: string
  resourceId: string
  expiration: number
}

export interface AccountDoc {
  source: 'google' | 'apple'
  email: string
  status: 'connected' | 'error'
  error?: string
  connectedAt: number
  calendars: Record<string, CalendarConfig>
  exportCalendarId?: string
  exportTasks?: boolean
  exportSchedules?: boolean
  watch?: Record<string, WatchChannel>
  lastSync?: number
  homeUrl?: string
}

export function keyBytes(): Buffer {
  const hex = INTEGRATIONS_KEY.value().trim()
  if (hex.length !== 64) throw new Error('INTEGRATIONS_KEY must be 32 bytes hex')
  return Buffer.from(hex, 'hex')
}

/** AES-256-GCM: iv(12) + tag(16) + ciphertext, base64. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64')
}

export function decrypt(blob: string): string {
  const buf = Buffer.from(blob, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function sign(payload: string): string {
  return createHmac('sha256', keyBytes()).update(payload).digest('base64url')
}

export function shortHash(s: string, n = 16): string {
  return createHash('sha1').update(s).digest('hex').slice(0, n)
}

/** Verify a Firebase ID token from `?token=` or Authorization: Bearer and map it to a person. */
export async function personFromRequest(req: Request): Promise<PersonKey | null> {
  const header = req.get('authorization') || ''
  const token = (header.startsWith('Bearer ') ? header.slice(7) : String(req.query.token ?? '')).trim()
  if (!token) return null
  try {
    const decoded = await getAuth().verifyIdToken(token)
    const person = personForEmail(decoded.email)
    return decoded.email_verified && person ? person.key : null
  } catch {
    return null
  }
}

/** Person whose widget token matches (Reminders bridge, ICS feed). */
export async function personFromWidgetToken(token: string): Promise<PersonKey | null> {
  if (!token || token.length < 24) return null
  const snap = await getFirestore().collection('users').where('widgetToken', '==', token).limit(1).get()
  if (snap.empty) return null
  const key = snap.docs[0].id
  return key in PEOPLE ? (key as PersonKey) : null
}

export const accountsRef = (person: PersonKey) => getFirestore().collection('integrations').doc(person).collection('accounts')
export const secretRef = (accountId: string) => getFirestore().collection('integrationSecrets').doc(accountId)
export const eventsRef = () => getFirestore().collection('events')

export function eventDocId(source: 'google' | 'apple', accountId: string, calendarId: string, externalId: string): string {
  return `${source[0]}_${accountId}_${shortHash(`${calendarId}:${externalId}`, 20)}`
}

/** Google event ids must be [a-v0-9]{5,1024}; sha1 hex fits. */
export function googleEventIdFor(localId: string): string {
  return `gooya${createHash('sha1').update(localId).digest('hex').slice(0, 30)}`
}

export function nowMs(): number {
  return Date.now()
}
