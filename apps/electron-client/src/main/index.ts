import { app, BrowserWindow, WebContentsView, ipcMain } from 'electron'
import { join } from 'path'

app.setName('Signal Browser')

// 1. Enforce Single Instance (Crucial for deep linking)
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // If another instance is already running, quit this one immediately
  app.quit()
} else {
  let mainWindow: BrowserWindow
  let browserView: WebContentsView

  const UI_HEIGHT = 50

  // 2. Register the protocol with Electron
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('signal', process.execPath, [join(process.cwd(), process.argv[1] as string)])
    }
  } else {
    app.setAsDefaultProtocolClient('signal')
  }

// 3. Helper function to parse and load the deep link URL
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
          mainWindow.webContents.send('update-url', targetUrl)
          
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.focus()
          return true; // We found and loaded a link!
        }
      } catch (err) {
        console.error('Failed to parse deep link:', err)
      }
    }
    return false; // No link found
  }

  // 4. Handle deep links when the app is ALREADY RUNNING
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      
      // We need to wait a tiny bit to ensure the window is focused
      // before pushing the new URL on some Linux window managers
      setTimeout(() => handleDeepLink(commandLine), 100)
    }
  })

  // 1. Tell Chromium to ignore certificate errors globally
app.commandLine.appendSwitch('ignore-certificate-errors')

// 2. Catch the specific event and force it to proceed
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
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }

    browserView = new WebContentsView()
    mainWindow.contentView.addChildView(browserView)

    const resizeView = () => {
      const bounds = mainWindow.getBounds()
      browserView.setBounds({
        x: 0,
        y: UI_HEIGHT,
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

    const updateUrlBar = (url: string) => {
      mainWindow.webContents.send('update-url', url)
    }

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