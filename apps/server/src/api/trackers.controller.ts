import type { Request, Response } from 'express'
import { db } from '../db/index.js'
import { trackers } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import type { SetupTrackerPayload, ExtractionRule } from '@signal/shared-types'
import { EXTRACTION_RULE_SYSTEM_PROMPT } from './prompts.js'
import { scheduleTracker } from '../workers/tracker.worker.js'

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent'

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strips the HTML down to a lean ~4KB context:
 * removes scripts, styles, svg, hidden elements,
 * and collapses whitespace.
 */
function sanitizeHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 6000) // hard cap — Gemini flash handles 1M ctx but we bill per token
}

/** Call Gemini and return the raw text of the first candidate */
async function callGemini(userPrompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

  const body = {
    system_instruction: { parts: [{ text: EXTRACTION_RULE_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0,        // deterministic output
      responseMimeType: 'application/json',  // forces JSON mode
    },
  }

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini API error ${res.status}: ${err}`)
  }

  const data = await res.json() as any
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!text) throw new Error('Gemini returned empty response')
  return text
}

/** Parse and validate the LLM output against ExtractionRule shape */
function parseExtractionRule(raw: string): ExtractionRule {
  let parsed: any
  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    // Gemini occasionally wraps JSON in ```json ``` even with JSON mode
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (!match) throw new Error(`Could not parse Gemini output as JSON: ${raw.slice(0, 200)}`)
    parsed = JSON.parse(match[1].trim())
  }

  // Minimal runtime validation
  const required: (keyof ExtractionRule)[] = [
    'extractionType', 'rule', 'operator', 'targetValue', 'validationAnchorXpath'
  ]
  for (const key of required) {
    if (parsed[key] === undefined || parsed[key] === null) {
      throw new Error(`ExtractionRule missing field: ${key}`)
    }
  }

  if (!['xpath', 'jsonpath'].includes(parsed.extractionType)) {
    throw new Error(`Invalid extractionType: ${parsed.extractionType}`)
  }
  if (!['<', '>', '==', 'contains'].includes(parsed.operator)) {
    throw new Error(`Invalid operator: ${parsed.operator}`)
  }

  return parsed as ExtractionRule
}

// ── Controllers ──────────────────────────────────────────────────────────────

export async function setupTracker(req: Request, res: Response) {
  const payload = req.body as SetupTrackerPayload

  if (!payload.targetUrl || !payload.userIntent || !payload.sanitizedHtml) {
    res.status(400).json({ error: 'targetUrl, userIntent, and sanitizedHtml are required' })
    return
  }

  // 1. Sanitize HTML before sending to Gemini
  const leanHtml = sanitizeHtml(payload.sanitizedHtml)

  // 2. Build the user prompt — context-rich, intent-first
  const userPrompt = `
USER INTENT: ${payload.userIntent}

HIGHLIGHTED ELEMENT:
Tag: ${payload.highlightedElement.tagName}
Class: ${payload.highlightedElement.className ?? '(none)'}
Text content: ${payload.highlightedElement.textContent}

PAGE HTML FRAGMENT (pruned):
${leanHtml}
`.trim()

  let rule: ExtractionRule
  try {
    const raw = await callGemini(userPrompt)
    rule = parseExtractionRule(raw)
  } catch (err: any) {
    console.error('[setupTracker] Gemini call failed:', err.message)
    res.status(502).json({ error: 'Failed to generate extraction rule', detail: err.message })
    return
  }

  // 3. Persist tracker to DB
  try {
    const userId = (req as any).auth?.payload?.sub ?? 'local-user';
    let notificationEmail = null;

    // Fetch email from Auth0 if we have an auth header
    const authHeader = req.headers.authorization;
    if (authHeader && process.env.AUTH0_ISSUER_BASE_URL) {
      try {
        const userinfoRes = await fetch(new URL('/userinfo', process.env.AUTH0_ISSUER_BASE_URL), {
          headers: { 'Authorization': authHeader }
        });
        if (userinfoRes.ok) {
          const profile = await userinfoRes.json();
          notificationEmail = profile.email || null;
        }
      } catch (err) {
        console.warn('[setupTracker] Failed to fetch userinfo from Auth0:', err);
      }
    }

    const [tracker] = await db
      .insert(trackers)
      .values({
        userId,
        notificationEmail,
        targetUrl: payload.targetUrl,
        rule,
        status: 'active',
      })
      .returning()

    // Schedule the repeating BullMQ job (every 5 min)
    await scheduleTracker(tracker.id, 5 * 60 * 1000)

    console.log(`[setupTracker] Created tracker ${tracker.id} for ${payload.targetUrl} (User: ${userId})`)
    res.status(201).json({ tracker, rule })
  } catch (err: any) {
    console.error('[setupTracker] DB insert failed:', err.message)
    res.status(500).json({ error: 'Database error', detail: err.message })
  }
}

export async function listTrackers(req: Request, res: Response) {
  const userId = (req as any).auth?.payload?.sub ?? 'local-user';
  const rows = await db
    .select()
    .from(trackers)
    .where(eq(trackers.userId, userId))
    .orderBy(trackers.createdAt)

  res.json({ trackers: rows })
}

import { runExtraction } from '../services/extraction.service.js';
import { sendNotificationEmail } from '../services/email.service.js';

export async function testTracker(req: Request, res: Response) {
  const userId = (req as any).auth?.payload?.sub ?? 'local-user';
  const trackerId = req.params.id;

  try {
    const [tracker] = await db
      .select()
      .from(trackers)
      .where(eq(trackers.id, trackerId))

    if (!tracker) {
      return res.status(404).json({ error: 'Tracker not found' });
    }

    if (tracker.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await runExtraction(tracker.targetUrl, tracker.rule);

    if (result.triggered && tracker.notificationEmail) {
      await sendNotificationEmail(
        tracker.notificationEmail,
        tracker.targetUrl,
        result.extractedValue,
        tracker.rule.humanReadableSummary || `${tracker.rule.operator} ${tracker.rule.targetValue}`
      ).catch(err => console.error('[testTracker] Failed to send email:', err.message));
    }
    
    res.json({
      success: true,
      extractedValue: result.extractedValue,
      triggered: result.triggered,
      operator: tracker.rule.operator,
      targetValue: tracker.rule.targetValue
    });
  } catch (err: any) {
    console.error(`[testTracker] Error testing tracker ${trackerId}:`, err);
    res.status(500).json({ error: err.message });
  }
}