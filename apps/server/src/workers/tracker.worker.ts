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

// ── XPath evaluator ───────────────────────────────────────────────────────────

/**
 * Runs an XPath expression against an HTML string.
 * Returns the trimmed text content of the first matching node, or null.
 */
function evaluateXPath(html: string, xpath: string): string | null {
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const result = doc.evaluate(
    xpath,
    doc,
    null,
    dom.window.XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  )
  const node = result.singleNodeValue
  return node ? (node as Element).textContent?.trim() ?? null : null
}

// ── Condition evaluator ───────────────────────────────────────────────────────

type Operator = '<' | '>' | '==' | 'contains'

/**
 * Compares extracted value against targetValue using the stored operator.
 * Strips currency symbols and commas before numeric comparison.
 */
function evaluateCondition(
  rawValue: string,
  operator: Operator,
  targetValue: string | number
): boolean {
  if (operator === 'contains') {
    return rawValue.toLowerCase().includes(String(targetValue).toLowerCase())
  }

  // Normalize: strip ₹, $, commas, spaces → parse float
  const numeric = parseFloat(rawValue.replace(/[^\d.]/g, ''))
  const target  = typeof targetValue === 'number' ? targetValue : parseFloat(String(targetValue))

  if (isNaN(numeric) || isNaN(target)) {
    console.warn(`[worker] Could not parse numeric values: "${rawValue}" vs ${targetValue}`)
    return false
  }

  switch (operator) {
    case '<':  return numeric < target
    case '>':  return numeric > target
    case '==': return numeric === target
    default:   return false
  }
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