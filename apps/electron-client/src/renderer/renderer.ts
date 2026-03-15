/*
Renderer-side toolbar controller for the Signal.

Responsibilities:
- Defines the TypeScript interface for the API exposed by the preload script (`window.browserApi`).
- Connects the UI elements (URL input, Go, Back, Forward, Reload buttons) to navigation actions.
- Sends navigation requests to the main process via the preload bridge.
- Listens for URL updates from the main process and updates the search bar accordingly.

Architecture:

Renderer UI (this file)
        │
        ▼
window.browserApi  (exposed by preload via contextBridge)
        │
        ▼
IPC messaging (ipcRenderer ↔ ipcMain)
        │
        ▼
Main process
        │
        ▼
WebContentsView loads and navigates web pages
*/

// Define the interface for TypeScript to know about our exposed API
declare global {
  interface Window {
    browserApi: {
      navigate: (url: string) => void
      goBack: () => void
      goForward: () => void
      reload: () => void
      onUrlChange: (callback: (url: string) => void) => void
    }
  }
}

const input = document.getElementById('url-input') as HTMLInputElement
const button = document.getElementById('go-btn') as HTMLButtonElement
const backBtn = document.getElementById('back-btn') as HTMLButtonElement
const forwardBtn = document.getElementById('forward-btn') as HTMLButtonElement
const reloadBtn = document.getElementById('reload-btn') as HTMLButtonElement

const navigate = () => {
  const url = input.value.trim()
  if (url) {
    window.browserApi.navigate(url)
  }
}

button.addEventListener('click', navigate)

input.addEventListener('keypress', (e: KeyboardEvent) => {
  if (e.key === 'Enter') navigate()
})

backBtn.addEventListener('click', () => window.browserApi.goBack())
forwardBtn.addEventListener('click', () => window.browserApi.goForward())
reloadBtn.addEventListener('click', () => window.browserApi.reload())

// Listens for URL changes
window.browserApi.onUrlChange((newUrl) => {
  input.value = newUrl
})