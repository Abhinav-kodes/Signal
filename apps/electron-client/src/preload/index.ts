import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('browserApi', {
  navigate: (url: string) => ipcRenderer.send('navigate-to', url),
  goBack: () => ipcRenderer.send('go-back'),
  goForward: () => ipcRenderer.send('go-forward'),
  reload: () => ipcRenderer.send('reload-page'),
  startPicker: () => ipcRenderer.send('start-picker'),
  saveWatch: (data: { selector: string; outerHtml: string; condition: string }) =>
    ipcRenderer.send('save-watch', data),
  overlayShow: () => ipcRenderer.send('overlay-show'),
  overlayHide: () => ipcRenderer.send('overlay-hide'),
  startLogin: (config: { domain: string; clientId: string; audience?: string }) => ipcRenderer.send('start-login', config),
  onAuthSuccess: (cb: (urlWithToken: string) => void) =>
    ipcRenderer.on('auth-success', (_e, url) => cb(url)),
  onUrlChange: (cb: (url: string) => void) =>
    ipcRenderer.on('update-url', (_e, url) => cb(url)),
  onElementSelected: (cb: (data: { selector: string; outerHtml: string }) => void) =>
    ipcRenderer.on('element-selected', (_e, data) => cb(data)),
  onPickerCancelled: (cb: () => void) =>
    ipcRenderer.on('picker-cancelled', () => cb()),
  onWatchSaved: (cb: () => void) =>
    ipcRenderer.on('watch-saved', () => cb()),
})