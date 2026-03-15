/*
Main process for the Signal Electron app.

Responsibilities:
- Enforce a single app instance (required for deep linking).
- Register the custom protocol: signal://
- Parse deep links and load the target URL.
- Create the main BrowserWindow and embedded WebContentsView.
- Handle navigation commands from the renderer via IPC.
- Synchronize the URL bar with page navigation events.

Architecture:

Renderer (React UI)
       │
       ▼
   Preload API
       │
       ▼
     IPC
       │
       ▼
Main Process (this file)
       │
       ▼
WebContentsView loads websites
*/

import { app, BrowserWindow, WebContentsView, ipcMain } from 'electron'
import { join } from 'path'

app.setName('Signal')

// Enforce single instance - prevents multiple copies of the app from running.
// Required so deep links (signal://) are handled by the already running instance.
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // If another instance is already running, quit this one immediately
  app.quit()
} else {
  let mainWindow: BrowserWindow    // Main application window
  let browserView: WebContentsView // Embedded browser that loads web pages

  const UI_HEIGHT = 50 // Height reserved for the top UI (search bar / controls)

  // Register the protocol with Electron
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('signal', process.execPath, [join(process.cwd(), process.argv[1] as string)]) // Used in development mode (electron .) so the correct script is launched
    }
  } else {
    app.setAsDefaultProtocolClient('signal') // Used in production after the app is packaged
  }

  // Helper function to parse and load the deep link URL
  // NOTE: Now returns a boolean so we know if it succeeded!
  const handleDeepLink = (argv: string[]): boolean => {
    const deepLinkArg = argv.find(arg => arg.startsWith('signal://'))
    if (deepLinkArg && browserView && mainWindow) {
      try {
        // Chrome sometimes adds a trailing slash (signal://track/?url=...) 
        // new URL() handles this perfectly.
        const parsedUrl = new URL(deepLinkArg)
        const targetUrl = parsedUrl.searchParams.get('url')
        
        if (targetUrl) {
          browserView.webContents.loadURL(targetUrl)
          mainWindow.webContents.send('update-url', targetUrl) // Send IPC message to renderer to update the URL bar
          
          if (mainWindow.isMinimized()) mainWindow.restore() // Restore the window if it was minimized
          mainWindow.focus()
          return true; // We found and loaded a link!
        }
      } catch (err) {
        console.error('Failed to parse deep link:', err)
      }
    }
    return false; // No link found
  }

  // Handle deep links when the app is already running.
  // This event fires when a second instance is attempted (e.g., clicking signal:// link).
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      
      // We need to wait a tiny bit to ensure the window is focused
      // before pushing the new URL on some Linux window managers
      setTimeout(() => handleDeepLink(commandLine), 100)
    }
  })

// Disable SSL certificate validation
// TODO: Handle certificate errors safely
app.commandLine.appendSwitch('ignore-certificate-errors')

// Catch the specific event and force it to proceed
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  // Prevent the default behavior of immediately halting the load
  event.preventDefault()
  // Tell the app to trust the certificate anyway
  callback(true)
})

  app.whenReady().then(() => {
    const iconPath = process.env['ELECTRON_RENDERER_URL'] 
      ? join(__dirname, '../../build/icons/512x512.png')
      : join(process.resourcesPath, 'build/icons/512x512.png')

    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      icon: iconPath, 
      webPreferences: {
        preload: join(app.getAppPath(), 'out/preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])       // Load the Vite/Dev server in development
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html')) // Load the built frontend in production
    }

    browserView = new WebContentsView()
    mainWindow.contentView.addChildView(browserView)  // Attach the browser view below the UI (React toolbar + embedded web page)

    const resizeView = () => {
      const bounds = mainWindow.getBounds()
      browserView.setBounds({
        x: 0,
        y: UI_HEIGHT, // 50
        width: bounds.width,
        height: bounds.height - UI_HEIGHT - 30 
      })
    }

    resizeView()
    mainWindow.on('resize', resizeView)

   // Handle deep links when the app is launched from COLD (completely closed)
    const launchedWithDeepLink = handleDeepLink(process.argv)

    // If no deep link was provided, load default
    if (!launchedWithDeepLink) {
      browserView.webContents.loadURL('https://google.com')
    }
    
    // Update renderer: searchbar
    const updateUrlBar = (url: string) => {
      mainWindow.webContents.send('update-url', url)
    }

    // Notify the renderer to update the URL bar when navigation occurs
    // (covers link clicks, SPA navigation, redirects, etc.)
    browserView.webContents.on('did-navigate', (_event, url) => updateUrlBar(url))
    browserView.webContents.on('did-navigate-in-page', (_event, url) => updateUrlBar(url))

    ipcMain.on('navigate-to', (_event, input) => {
      let finalUrl = input
      const isLikelyUrl = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(input) || input.startsWith('http://') || input.startsWith('https://') || input.startsWith('localhost:')

      if (isLikelyUrl) {
        if (!input.startsWith('http://') && !input.startsWith('https://')) {
          finalUrl = 'https://' + input
        }
      } else {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(input)}`
      }
      browserView.webContents.loadURL(finalUrl)
    })

    ipcMain.on('go-back', () => {
      if (browserView.webContents.navigationHistory.canGoBack()) {
        browserView.webContents.navigationHistory.goBack()
      }
    })

    ipcMain.on('go-forward', () => {
      if (browserView.webContents.navigationHistory.canGoForward()) {
        browserView.webContents.navigationHistory.goForward()
      }
    })

    ipcMain.on('reload-page', () => {
      browserView.webContents.reload()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}