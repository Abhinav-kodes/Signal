import { chromium } from 'playwright'
import { JSDOM } from 'jsdom'
import type { TrackerRule } from '@signal/shared-types'

export interface ExtractionResult {
  triggered: boolean;
  extractedValue: string;
  rule: TrackerRule;
}

function evaluateCondition(rawValue: string, operator: string, targetValue: string | number): boolean {
  if (operator === 'contains') {
    return rawValue.toLowerCase().includes(String(targetValue).toLowerCase())
  }

  const numeric = parseFloat(rawValue.replace(/[^\d.]/g, ''))
  const target = typeof targetValue === 'number' ? targetValue : parseFloat(String(targetValue))

  if (isNaN(numeric) || isNaN(target)) {
    console.warn(`Could not parse numeric values: "${rawValue}" vs ${targetValue}`)
    return false
  }

  switch (operator) {
    case '<': return numeric < target
    case '>': return numeric > target
    case '==': return numeric === target
    default: return false
  }
}

export async function runExtraction(targetUrl: string, rule: TrackerRule): Promise<ExtractionResult> {
  let html: string
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'en-IN,en;q=0.9',
      }
    })
    const page = await context.newPage()
    
    // Navigate and wait for the DOM to be ready, avoiding networkidle which hangs on Amazon
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    html = await page.content()
  } finally {
    await browser.close()
  }

  const dom = new JSDOM(html)
  const doc = dom.window.document

  // Self-healing check
  if (rule.validationAnchorXpath) {
    try {
      const anchorResult = doc.evaluate(
        rule.validationAnchorXpath, doc, null, dom.window.XPathResult.FIRST_ORDERED_NODE_TYPE, null
      )
      if (!anchorResult.singleNodeValue) {
        throw new Error(`Anchor validation failed: ${rule.validationAnchorXpath}`)
      }
    } catch (err: any) {
      throw new Error(`Anchor validation error: ${err.message}`)
    }
  }

  // Value extraction
  let extractedValue: string | null = null
  if (rule.extractionType === 'xpath') {
    try {
      const elResult = doc.evaluate(
        rule.rule, doc, null, dom.window.XPathResult.FIRST_ORDERED_NODE_TYPE, null
      )
      const el = elResult.singleNodeValue as Element
      extractedValue = el ? (el.textContent?.trim() || null) : null
    } catch (err: any) {
      throw new Error(`XPath evaluation failed: ${err.message}`)
    }
  }

  if (extractedValue === null) {
    throw new Error(`Failed to extract value using rule: ${rule.rule}`)
  }

  const triggered = evaluateCondition(extractedValue, rule.operator, rule.targetValue)

  return {
    triggered,
    extractedValue,
    rule
  }
}
