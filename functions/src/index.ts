import { setGlobalOptions } from 'firebase-functions/v2'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { normalizeTask } from '../../shared/normalize'
import type { Task } from '../../shared/model'
import { rebuildQueueForTask, sendDueAlerts, extendQueues } from './alerts'
import { notifyTaskAdded, sendSyncPush } from './notify'
import { reminderWakeups } from '../../shared/reminders'
import type { PersonKey } from '../../shared/people'

setGlobalOptions({ region: 'us-east1', maxInstances: 5, memory: '256MiB' })
initializeApp()
// Optional fields left undefined (a calendar's first sync token, say) are simply not written, instead of failing the write.
getFirestore().settings({ ignoreUndefinedProperties: true })

/** Keep the alert queue in sync with every task change; notify on additions by the other person. */
export const onTaskWritten = onDocumentWritten('tasks/{taskId}', async (event) => {
  const taskId = event.params.taskId
  const after = event.data?.after
  const before = event.data?.before
  const task: Task | null = after?.exists ? normalizeTask(taskId, after.data() as Record<string, unknown>) : null
  try {
    await rebuildQueueForTask(taskId, task)
  } catch (e) {
    logger.error('rebuildQueueForTask failed', { taskId, error: String(e) })
  }
  if (task && !before?.exists && task.createdBy !== task.owner) {
    try {
      await notifyTaskAdded(task)
    } catch (e) {
      logger.error('notifyTaskAdded failed', { taskId, error: String(e) })
    }
  }
  // One of a person's reminders changed somewhere other than their iPhone's own Reminders sync (the other person's
  // GOOYA, another device): wake that iPhone so the change is in Reminders now, not the next time GOOYA opens there.
  const wake = reminderWakeups(before?.exists ? (before.data() as Record<string, unknown>) : null, after?.exists ? (after.data() as Record<string, unknown>) : null)
  for (const person of wake) {
    try {
      await sendSyncPush(person as PersonKey)
    } catch (e) {
      logger.error('sendSyncPush failed', { taskId, person, error: String(e) })
    }
  }
})

/** Every minute: send alerts that are due. */
export const sendAlerts = onSchedule({ schedule: '* * * * *', timeZone: 'America/New_York', retryCount: 0 }, async () => {
  const sent = await sendDueAlerts()
  if (sent) logger.info(`sent ${sent} alert(s)`)
})

/** Daily: extend the 14-day alert window for repeating tasks. */
export const extendAlerts = onSchedule({ schedule: '0 3 * * *', timeZone: 'America/New_York', retryCount: 1 }, async () => {
  const n = await extendQueues()
  logger.info(`extended alert queues for ${n} task(s)`)
})

export { widgetFeed } from './widget'
export * from './integrations/index'
