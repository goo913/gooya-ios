import { onDocumentWritten } from 'firebase-functions/v2/firestore'

/**
 * Share (on by default) is `private: false`. Builds from before Share leave the field out, and the other person's
 * phone asks only for their shared things (owner == them and private == false, src/lib/db.ts), so a document written
 * without it is marked shared here; it is on the other phone a moment later. A document that says either is left alone.
 */
function sharedByDefault(collection: string) {
  return onDocumentWritten(`${collection}/{id}`, async (event) => {
    const after = event.data?.after
    if (!after?.exists || typeof after.data()?.private === 'boolean') return
    await after.ref.set({ private: false }, { merge: true })
  })
}

export const schedulesSharedByDefault = sharedByDefault('schedules')
export const routinesSharedByDefault = sharedByDefault('routines')
