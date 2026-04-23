import { Worker, Queue } from 'bullmq'
import { db } from '../db/index.js'
import { trackers, trackerResults } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { runExtraction } from '../services/extraction.service.js'
import { sendNotificationEmail } from '../services/email.service.js'
import 'dotenv/config'

// ── Redis connection ──────────────────────────────────────────────────────────

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
}

// ── Queue: one job per tracker, repeated on a schedule ───────────────────────

export const trackerQueue = new Queue('tracker-checks', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 50,
    removeOnFail: 20,
  },
})

/**
 * Enqueue a repeating job for a tracker.
 * intervalMs default: 5 minutes
 */
export async function scheduleTracker(trackerId: string, intervalMs = 5 * 60 * 1000) {
  await trackerQueue.upsertJobScheduler(
    `tracker-${trackerId}`,           // stable scheduler ID — safe to call repeatedly
    { every: intervalMs },
    {
      name: 'check-tracker',
      data: { trackerId },
      opts: { removeOnComplete: 50, removeOnFail: 20 },
    }
  )
  console.log(`[queue] Scheduled tracker ${trackerId} every ${intervalMs / 1000}s`)
}

// ── Job processor ─────────────────────────────────────────────────────────────

const worker = new Worker(
  'tracker-checks',
  async (job) => {
    const { trackerId } = job.data as { trackerId: string }
    console.log(`[worker] Processing tracker ${trackerId}`)

    // 1. Load tracker from DB
    const [tracker] = await db
      .select()
      .from(trackers)
      .where(eq(trackers.id, trackerId))

    if (!tracker) {
      console.warn(`[worker] Tracker ${trackerId} not found — removing job`)
      return { skipped: true, reason: 'not_found' }
    }

    if (tracker.status !== 'active') {
      return { skipped: true, reason: tracker.status }
    }

    const { rule } = tracker

    // 2. Run Extraction via shared service
    let triggered: boolean
    let extractedValue: string

    try {
      const result = await runExtraction(tracker.targetUrl, rule)
      triggered = result.triggered
      extractedValue = result.extractedValue
    } catch (err: any) {
      console.error(`[worker] Extraction failed for tracker ${trackerId}:`, err.message)
      
      // Update tracker status to error
      await db.update(trackers)
        .set({ status: 'error', lastCheckedAt: new Date() })
        .where(eq(trackers.id, trackerId))

      // Exit early to prevent accessing unassigned variables below
      return { skipped: true, reason: 'extraction_failed', error: err.message }
    }

    console.log(`[worker] Extracted value: "${extractedValue}" | Condition: ${rule.operator} ${rule.targetValue}`)

    // 6. Update lastCheckedAt
    await db.update(trackers)
      .set({ lastCheckedAt: new Date() })
      .where(eq(trackers.id, trackerId))

    // 7. Fire notification if condition is met
    if (triggered) {
      console.log(`🔔 [worker] CONDITION MET for tracker ${trackerId}!`)
      console.log(`   URL: ${tracker.targetUrl}`)
      console.log(`   Value: "${extractedValue}" ${rule.operator} ${rule.targetValue}`)

      if (tracker.notificationEmail) {
        await sendNotificationEmail(
          tracker.notificationEmail,
          tracker.targetUrl,
          extractedValue,
          rule.humanReadableSummary || `${rule.operator} ${rule.targetValue}`
        ).catch(err => console.error('[worker] Failed to send email:', err.message))
      } else {
        console.log(`[worker] No notification email set for tracker ${trackerId}`)
      }
    }

    // 8. Store result
    await db.insert(trackerResults).values({
      trackerId,
      extractedValue,
      isConditionMet: triggered,
    })

    return {
      triggered,
      extractedValue,
      rule: rule.rule,
      operator: rule.operator,
      targetValue: rule.targetValue,
    }
  },
  {
    connection,
    concurrency: 2,
  }
)

// ── Worker lifecycle ──────────────────────────────────────────────────────────

worker.on('completed', (job, result) => {
  console.log(`[worker] Job ${job.id} done:`, JSON.stringify(result))
})

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err.message)
})

console.log('[worker] Tracker worker started — listening for jobs...')