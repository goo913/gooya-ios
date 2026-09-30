import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findConference, hostOf, providerOf } from './conference.ts'

test('a call link in the place, the URL or the notes, in that order', () => {
  const zoom = 'https://gatech.zoom.us/j/96638815067?pwd=2YrAL4afI21GdbmaOgufPYX-UC09sof.1'
  assert.deepEqual(findConference(zoom, null, 'Join with Google Meet: https://meet.google.com/jke-jwff-ahm'), { name: 'Zoom', url: zoom })
  assert.deepEqual(findConference('', undefined, 'Join with Google Meet: https://meet.google.com/jke-jwff-ahm\nOr dial: (US) +1 470-268-2442'), { name: 'Google Meet', url: 'https://meet.google.com/jke-jwff-ahm' })
  // In HTML notes the link ends at the quote; a sentence's full stop is not part of it.
  assert.deepEqual(findConference('<a href="https://zoom.us/j/123456789">Join</a>'), { name: 'Zoom', url: 'https://zoom.us/j/123456789' })
  assert.deepEqual(findConference('Call in at https://facetime.apple.com/join#v=1&p=AbCdEf&k=XyZ.'), { name: 'FaceTime', url: 'https://facetime.apple.com/join#v=1&p=AbCdEf&k=XyZ' })
  assert.equal(findConference('Room 4', 'https://example.com/agenda', 'Bring the slides'), null)
})

test('the provider and host of a link', () => {
  assert.equal(providerOf('https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0'), 'Microsoft Teams')
  assert.equal(providerOf('https://docs.google.com/document/d/1'), null)
  assert.equal(hostOf('https://gatech.zoom.us/j/96638815067?pwd=x'), 'gatech.zoom.us')
  assert.equal(hostOf('not a url/at all'), 'not a url')
})
