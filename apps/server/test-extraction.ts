import { chromium } from 'playwright';
import { JSDOM } from 'jsdom';

const job = {
  id: "38dc52e1-e7dc-4b09-b957-cbc99ff2e090",
  target_url: "https://www.amazon.in/Boult-Audio-X1-Earphones-Cancellation/dp/B07TCN5VR9/",
  rule: {
    rule: "//span[contains(@class,'a-price-whole')][1]",
    operator: "<",
    targetValue: 300,
    extractionType: "xpath",
    validationAnchorXpath: "//span[@id='productTitle']"
  }
};

function evaluateXPath(html: string, xpath: string): string | null {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  try {
    const result = doc.evaluate(
      xpath,
      doc,
      null,
      dom.window.XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    const node = result.singleNodeValue;
    return node ? (node as Element).textContent?.trim() ?? null : null;
  } catch (err) {
    console.error(`Error evaluating XPath: ${xpath}`, err);
    return null;
  }
}

function evaluateCondition(rawValue: string, operator: string, targetValue: string | number): boolean {
  if (operator === 'contains') {
    return rawValue.toLowerCase().includes(String(targetValue).toLowerCase());
  }

  const numeric = parseFloat(rawValue.replace(/[^\d.]/g, ''));
  const target = typeof targetValue === 'number' ? targetValue : parseFloat(String(targetValue));

  if (isNaN(numeric) || isNaN(target)) {
    console.warn(`Could not parse numeric values: "${rawValue}" vs ${targetValue}`);
    return false;
  }

  switch (operator) {
    case '<': return numeric < target;
    case '>': return numeric > target;
    case '==': return numeric === target;
    default: return false;
  }
}

async function run() {
  console.log(`Starting test for ${job.target_url}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'en-IN,en;q=0.9',
      }
    });
    
    console.log('Navigating...');
    const page = await context.newPage();
    await page.goto(job.target_url, { waitUntil: 'networkidle', timeout: 30_000 });
    
    console.log('Fetching HTML...');
    const html = await page.content();
    
    // Check Anchor
    const anchorValue = evaluateXPath(html, job.rule.validationAnchorXpath);
    if (!anchorValue) {
      console.log('VALIDATION ANCHOR FAILED: Page structure might have changed.');
      console.log(`   Could not find element for: ${job.rule.validationAnchorXpath}`);
    } else {
      console.log(`Validation anchor found: "${anchorValue.substring(0, 50)}..."`);
    }

    // Check Rule
    const extractedValue = evaluateXPath(html, job.rule.rule);
    if (extractedValue === null) {
      console.log('EXTRACTION FAILED: Rule matched nothing.');
      console.log(`   Rule: ${job.rule.rule}`);
    } else {
      console.log(`Extracted value: "${extractedValue}"`);
      
      const triggered = evaluateCondition(extractedValue, job.rule.operator, job.rule.targetValue);
      console.log(`\nCONDITION EVALUATION:`);
      console.log(`Extracted: ${parseFloat(extractedValue.replace(/[^\d.]/g, ''))}`);
      console.log(`Operator:  ${job.rule.operator}`);
      console.log(`Target:    ${job.rule.targetValue}`);
      console.log(`Result:    ${triggered ? 'CONDITION MET' : 'CONDITION NOT MET'}`);
    }

  } catch (err) {
    console.error('Test execution failed:', err);
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

run();
