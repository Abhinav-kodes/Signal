// apps/electron-client/src/renderer/renderer.ts
import type { SetupTrackerPayload } from '@signal/shared-types'

declare global {
  interface Window {
    browserApi: {
      navigate: (url: string) => void
      goBack: () => void
      goForward: () => void
      reload: () => void
      startPicker: () => void
      overlayShow: () => void
      overlayHide: () => void
      onUrlChange: (cb: (url: string) => void) => void
      onElementSelected: (cb: (data: { selector: string; outerHtml: string }) => void) => void
      onPickerCancelled: (cb: () => void) => void
      startLogin: (config: { domain: string; clientId: string; audience?: string }) => void
      onAuthSuccess: (cb: (urlWithToken: string) => void) => void
    }
  }
}

const SERVER_URL = 'http://localhost:3001'

const AUTH0_DOMAIN = 'dev-t05i3iaer8b872m2.us.auth0.com'
const AUTH0_CLIENT_ID = 'tWCQgA4EEMXI4frwFotI0QnEMC7zlmim'
const AUTH0_AUDIENCE = 'https://api.signal.local'
let authToken: string | null = null

const urlInput   = document.getElementById('url-input')      as HTMLInputElement
const goBtn      = document.getElementById('go-btn')         as HTMLButtonElement
const backBtn    = document.getElementById('back-btn')       as HTMLButtonElement
const forwardBtn = document.getElementById('forward-btn')    as HTMLButtonElement
const reloadBtn  = document.getElementById('reload-btn')     as HTMLButtonElement
const pickerBtn  = document.getElementById('picker-btn')     as HTMLButtonElement
const dialog     = document.getElementById('watch-dialog')   as HTMLDivElement
const dialogSel  = document.getElementById('dialog-selector') as HTMLSpanElement
const dialogPrev = document.getElementById('dialog-preview')  as HTMLDivElement
const condInput  = document.getElementById('condition-input') as HTMLInputElement
const confirmBtn = document.getElementById('confirm-watch')  as HTMLButtonElement
const cancelBtn  = document.getElementById('cancel-watch')   as HTMLButtonElement
const toast      = document.getElementById('toast')          as HTMLDivElement

const loginBtn   = document.getElementById('login-btn')      as HTMLButtonElement
const monitorsBtn = document.getElementById('monitors-btn')   as HTMLButtonElement
const monitorsDialog = document.getElementById('monitors-dialog') as HTMLDivElement
const closeMonitorsBtn = document.getElementById('close-monitors-btn') as HTMLButtonElement
const monitorsList = document.getElementById('monitors-list') as HTMLDivElement

let pendingElement: { selector: string; outerHtml: string } | null = null

// ── Navigation ────────────────────────────────────────────────────────────────

const navigate = () => {
  const url = urlInput.value.trim()
  if (url) window.browserApi.navigate(url)
}

goBtn.addEventListener('click', navigate)
urlInput.addEventListener('keypress', (e: KeyboardEvent) => {
  if (e.key === 'Enter') navigate()
})
backBtn.addEventListener('click',    () => window.browserApi.goBack())
forwardBtn.addEventListener('click', () => window.browserApi.goForward())
reloadBtn.addEventListener('click',  () => window.browserApi.reload())

window.browserApi.onUrlChange((newUrl) => {
  urlInput.value = newUrl
})

// ── Picker ────────────────────────────────────────────────────────────────────

pickerBtn.addEventListener('click', () => {
  pickerBtn.classList.add('active')
  pickerBtn.title = 'Click an element on the page...'
  window.browserApi.startPicker()
})

window.browserApi.onPickerCancelled(() => {
  pickerBtn.classList.remove('active')
  pickerBtn.title = 'Pick element to watch'
})

window.browserApi.onElementSelected(({ selector, outerHtml }) => {
  pickerBtn.classList.remove('active')
  pickerBtn.title = 'Pick element to watch'
  pendingElement = { selector, outerHtml }
  dialogSel.textContent = selector
  dialogPrev.textContent = outerHtml.slice(0, 200) + (outerHtml.length > 200 ? '…' : '')
  condInput.value = ''
  showDialog()
})

// ── Dialog ────────────────────────────────────────────────────────────────────

const showDialog = () => {
  window.browserApi.overlayShow()
  dialog.classList.add('visible')
  condInput.focus()
}

const hideDialog = () => {
  dialog.classList.remove('visible')
  window.browserApi.overlayHide()
  pendingElement = null
}

const showToast = (msg: string, success = true) => {
  toast.textContent = msg
  toast.style.borderLeftColor = success ? '#34a853' : '#ea4335'
  toast.classList.add('visible')
  setTimeout(() => toast.classList.remove('visible'), 3000)
}

cancelBtn.addEventListener('click', hideDialog)

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dialog.classList.contains('visible')) hideDialog()
})

// ── Save Watch → POST /api/trackers/setup ─────────────────────────────────────

confirmBtn.addEventListener('click', async () => {
  const condition = condInput.value.trim()
  if (!condition || !pendingElement) return

  confirmBtn.disabled = true
  confirmBtn.textContent = 'Compiling rule…'

  try {
    // Extract lightweight metadata from the stored outerHtml
    const parsed = new DOMParser().parseFromString(pendingElement.outerHtml, 'text/html')
    const rootEl = parsed.body.firstElementChild

    const payload: SetupTrackerPayload = {
      targetUrl: urlInput.value,
      userIntent: condition,
      sanitizedHtml: pendingElement.outerHtml,
      highlightedElement: {
        tagName:     rootEl?.tagName ?? pendingElement.outerHtml.match(/^<(\w+)/)?.[1]?.toUpperCase() ?? 'DIV',
        className:   rootEl?.className || undefined,
        textContent: (rootEl?.textContent ?? parsed.body.textContent ?? '').trim().slice(0, 500),
      },
    }

    const res = await fetch(`${SERVER_URL}/api/trackers/setup`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail?.error ?? `Server ${res.status}`)
    }

    const { tracker, rule } = await res.json()
    console.log('[renderer] Tracker created:', tracker.id, '| Rule:', rule)

    hideDialog()
    showToast(`✓ Watch saved — monitoring ${rule.extractionType} rule`)

  } catch (err: any) {
    console.error('[renderer] Setup failed:', err)
    showToast(`✗ ${err.message ?? 'Failed to create watch'}`, false)
  } finally {
    confirmBtn.disabled = false
    confirmBtn.textContent = 'Save Watch'
  }
})

// ── Auth & Monitors ───────────────────────────────────────────────────────────

loginBtn.addEventListener('click', () => {
  window.browserApi.startLogin({ domain: AUTH0_DOMAIN, clientId: AUTH0_CLIENT_ID, audience: AUTH0_AUDIENCE })
})

window.browserApi.onAuthSuccess((urlWithToken) => {
  // Extract token from hash: signal://callback#access_token=...&expires_in=...
  const hash = urlWithToken.split('#')[1]
  if (hash) {
    const params = new URLSearchParams(hash)
    const token = params.get('access_token')
    if (token) {
      authToken = token
      loginBtn.style.display = 'none'
      monitorsBtn.style.display = 'block'
      showToast('Successfully logged in!', true)
    }
  }
})

const loadMonitors = async () => {
  if (!authToken) return
  monitorsList.innerHTML = 'Loading...'
  try {
    const res = await fetch(`${SERVER_URL}/api/trackers`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    
    if (data.trackers.length === 0) {
      monitorsList.innerHTML = '<div style="text-align:center; padding: 20px;">No monitors saved yet.</div>'
      return
    }

    monitorsList.innerHTML = data.trackers.map((t: any) => `
      <div style="background: #1a1b1d; border: 1px solid #3c4043; padding: 12px; border-radius: 8px;">
        <div style="color: #8ab4f8; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${t.targetUrl}">
          ${t.targetUrl}
        </div>
        <div style="color: #e8eaed;">
          <strong>Rule:</strong> ${t.rule.humanReadableSummary || `${t.rule.operator} ${t.rule.targetValue}`}
        </div>
        <div style="color: #9aa0a6; font-size: 11px; margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
          <span>Status: <span style="color: ${t.status === 'active' ? '#34a853' : '#ea4335'}">${t.status}</span></span>
          <button class="test-btn" data-id="${t.id}" style="padding: 4px 10px; background: #3c4043; border: none; border-radius: 4px; color: #8ab4f8; font-size: 11px; cursor: pointer;">Test Now</button>
        </div>
      </div>
    `).join('')
  } catch (err: any) {
    monitorsList.innerHTML = `<div style="color: #ea4335">Failed to load monitors: ${err.message}</div>`
  }
}

monitorsList.addEventListener('click', async (e) => {
  const btn = e.target as HTMLButtonElement
  if (btn.classList.contains('test-btn')) {
    const id = btn.getAttribute('data-id')
    if (!id || !authToken) return

    const originalText = btn.textContent
    btn.textContent = 'Testing...'
    btn.disabled = true

    try {
      const res = await fetch(`${SERVER_URL}/api/trackers/${id}/test`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      })
      const data = await res.json()
      
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)

      alert(`✅ Extracted Value: ${data.extractedValue}\nCondition Met: ${data.triggered ? 'YES' : 'NO'}\nRule: ${data.operator} ${data.targetValue}`)
    } catch (err: any) {
      alert(`❌ Test Failed:\n${err.message}`)
    } finally {
      btn.textContent = originalText || 'Test Now'
      btn.disabled = false
    }
  }
})

monitorsBtn.addEventListener('click', () => {
  window.browserApi.overlayShow()
  monitorsDialog.classList.add('visible')
  loadMonitors()
})

closeMonitorsBtn.addEventListener('click', () => {
  monitorsDialog.classList.remove('visible')
  window.browserApi.overlayHide()
})