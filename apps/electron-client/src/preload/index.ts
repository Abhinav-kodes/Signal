import { contextBridge, ipcRenderer } from 'electron'

// Expose a safe API to the renderer to tell the main process to navigate
contextBridge.exposeInMainWorld('browserApi', {
  navigate: (url: string) => ipcRenderer.send('navigate-to', url),

  goBack: () => ipcRenderer.send('go-back'),
  goForward: () => ipcRenderer.send('go-forward'),
  reload: () => ipcRenderer.send('reload-page'),

  onUrlChange: (callback: (url: string) => void) => {
    ipcRenderer.on('update-url', (_event, url) => callback(url))
  }
})