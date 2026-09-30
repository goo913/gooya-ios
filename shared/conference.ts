import type { EventConference } from './model'

// Video calls in calendar events. Google Calendar says which call an event has (its conference data); other events
// only carry the link somewhere: in the location ("https://gatech.zoom.us/j/9663…"), the URL field or the notes
// ("Join Zoom Meeting https://…"). Apple Calendar finds those links and offers Join; so does GOOYA.

const PROVIDERS: { name: string; pattern: RegExp }[] = [
  { name: 'Google Meet', pattern: /https?:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}[^\s"'<>)\]]*/i },
  { name: 'Zoom', pattern: /https?:\/\/(?:[\w-]+\.)*zoom(?:gov)?\.us\/(?:j|my|w|s|wc\/join)\/[^\s"'<>)\]]+/i },
  { name: 'Microsoft Teams', pattern: /https?:\/\/teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/[^\s"'<>)\]]+/i },
  { name: 'Webex', pattern: /https?:\/\/(?:[\w-]+\.)*webex\.com\/(?:meet|join|[\w-]+\/j\.php)[^\s"'<>)\]]*/i },
  { name: 'FaceTime', pattern: /https?:\/\/facetime\.apple\.com\/join[^\s"'<>)\]]+/i },
  { name: 'GoTo Meeting', pattern: /https?:\/\/(?:global\.|app\.)?goto(?:meeting)?\.com\/(?:join\/)?\d{6,}[^\s"'<>)\]]*/i },
]

/** A link's call provider ("Zoom" for gatech.zoom.us), or null for a link that is not a call. */
export function providerOf(url: string): string | null {
  for (const p of PROVIDERS) if (p.pattern.test(url)) return p.name
  return null
}

/** The first video-call link in these texts (location, URL, notes, in that order), or null. */
export function findConference(...texts: (string | null | undefined)[]): EventConference | null {
  for (const text of texts) {
    if (!text) continue
    for (const p of PROVIDERS) {
      const m = p.pattern.exec(text)
      if (m) return { name: p.name, url: m[0].replace(/[.,;]+$/, '') }
    }
  }
  return null
}

/** "gatech.zoom.us" for "https://gatech.zoom.us/j/96638815067?pwd=…", as Apple Calendar names the call. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^https?:\/\//, '').split(/[/?#]/)[0]
  }
}
