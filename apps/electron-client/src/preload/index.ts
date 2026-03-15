/*
  Preload script for the Electron renderer.

  Purpose:
  - Acts as a secure bridge between the renderer (frontend UI) and the main process.
  - Exposes a limited API (`window.browserApi`) to the renderer using `contextBridge`.
  - The renderer can request navigation actions (navigate, back, forward, reload)
    without having direct access to Node.js or Electron internals.

  Architecture:
  Renderer UI (React)
        │
        ▼
  window.browserApi
        │
        ▼
  ipcRenderer (IPC messaging)
        │
        ▼
  Main process (handles navigation in WebContentsView)

  This approach keeps the renderer sandboxed while still allowing controlled
  communication with the Electron main process.
*/

import { contextBridge, ipcRenderer } from 'electron'

// Expose a safe API to the renderer so it can request navigation actions from the main process
contextBridge.exposeInMainWorld('browserApi', {

  // send the message "navigate-to" from renderer (frontend) to main process (backend)  
  // The main process will handle loading the given URL
  navigate: (url: string) => ipcRenderer.send('navigate-to', url),

  // Send navigation control commands to the main process
  goBack: () => ipcRenderer.send('go-back'),
  goForward: () => ipcRenderer.send('go-forward'),
  reload: () => ipcRenderer.send('reload-page'),

  // Allows the renderer to listen for URL changes sent by the main process.
  // When the main process emits "update-url", this runs the provided callback
  // so the renderer search bar can update the displayed URL.
  onUrlChange: (callback: (url: string) => void) => {
    ipcRenderer.on('update-url', (_event, url) => callback(url))
  }
})