import { app, BrowserWindow, WebContentsView, ipcMain, shell } from 'electron'
import { join } from 'path'
import { writeFile, mkdirSync, existsSync } from 'fs'

app.setName('Signal Browser')

const gotTheLock = app.requestSingleInstanceLock()

const SNAPSHOT_PATH = join(app.getAppPath(), 'page-snapshot.html')
const WATCHES_DIR = join(app.getAppPath(), 'watches')

if (!existsSync(WATCHES_DIR)) mkdirSync(WATCHES_DIR, { recursive: true })

const saveHtmlSnapshot = (html: string) => {
  writeFile(SNAPSHOT_PATH, html, 'utf-8', (err) => {
    if (err) console.error('Failed to save HTML snapshot:', err)
    else console.log(`[Snapshot saved] ${SNAPSHOT_PATH}`)
  })
}

const saveWatch = (data: { url: string; condition: string; elementHtml: string; selector: string; timestamp: string }) => {
  const filename = `watch-${Date.now()}.json`
  const filepath = join(WATCHES_DIR, filename)
  const content = JSON.stringify(data, null, 2)
  writeFile(filepath, content, 'utf-8', (err) => {
    if (err) console.error('Failed to save watch:', err)
    else console.log(`[Watch saved] ${filepath}`)
  })
}

if (!gotTheLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow
  let browserView: WebContentsView

  const UI_HEIGHT = 50

  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('signal', process.execPath, [join(process.cwd(), process.argv[1] as string)])
    }
  } else {
    app.setAsDefaultProtocolClient('signal')
  }

  let shouldLogHtml = false

  const handleDeepLink = (argv: string[]): boolean => {
    const deepLinkArg = argv.find(arg => arg.startsWith('signal://'))
    if (deepLinkArg && browserView && mainWindow) {
      try {
        const parsedUrl = new URL(deepLinkArg)
        
        // Handle Auth0 callback
        if (parsedUrl.hostname === 'callback' || parsedUrl.pathname === '//callback') {
          console.log('[main] Received Auth callback URL:', deepLinkArg)
          mainWindow.webContents.send('auth-success', deepLinkArg)
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.focus()
          return true
        }

        const targetUrl = parsedUrl.searchParams.get('url')
        if (targetUrl) {
          shouldLogHtml = true
          browserView.webContents.loadURL(targetUrl)
          mainWindow.webContents.send('update-url', targetUrl)
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.focus()
          return true
        }
      } catch (err) {
        console.error('Failed to parse deep link:', err)
      }
    }
    return false
  }

  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      setTimeout(() => handleDeepLink(commandLine), 100)
    }
  })

  app.commandLine.appendSwitch('ignore-certificate-errors')

  app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
    event.preventDefault()
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

    let snapshotTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleSnapshot = () => {
      if (!shouldLogHtml) return
      if (snapshotTimer) clearTimeout(snapshotTimer)
      snapshotTimer = setTimeout(async () => {
        try {
          const html = await browserView.webContents.executeJavaScript('document.documentElement.outerHTML')
          saveHtmlSnapshot(html)
        } catch { /* skip */ }
      }, 500)
    }

    const injectDomWatcher = () => {
      browserView.webContents.executeJavaScript(`
        (() => {
          if (window.__domWatcherInjected) return;
          window.__domWatcherInjected = true;
          const observer = new MutationObserver(() => console.log('__DOM_CHANGED__'));
          observer.observe(document.documentElement, {
            childList: true, subtree: true, attributes: true, characterData: true
          });
        })();
      `).catch(err => console.error('Failed to inject DOM watcher:', err))
    }

    // Inject the element picker into the browserView page
    const injectElementPicker = () => {
      // Fire-and-forget — does NOT await user interaction
      browserView.webContents.executeJavaScript(`
        (() => {
          if (window.__pickerActive) return;
          window.__pickerActive = true;

          const overlay = document.createElement('div');
          overlay.style.cssText =
            'position:fixed;pointer-events:none;z-index:2147483647;' +
            'border:2px solid #8ab4f8;background:rgba(138,180,248,0.15);' +
            'border-radius:3px;box-sizing:border-box;';
          document.body.appendChild(overlay);

          const tooltip = document.createElement('div');
          tooltip.style.cssText =
            'position:fixed;z-index:2147483647;background:#202124;' +
            'color:#8ab4f8;font-size:11px;font-family:monospace;' +
            'padding:3px 8px;border-radius:4px;pointer-events:none;' +
            'border:1px solid #8ab4f8;max-width:400px;white-space:nowrap;' +
            'overflow:hidden;text-overflow:ellipsis;';
          document.body.appendChild(tooltip);

          const getSelector = (el) => {
            if (el.id) return '#' + CSS.escape(el.id);
            if (el.className && typeof el.className === 'string') {
              const cls = el.className.trim().split(/\\s+/).slice(0, 2).join('.');
              if (cls) return el.tagName.toLowerCase() + '.' + cls;
            }
            return el.tagName.toLowerCase();
          };

          let lastHovered = null;

          const onMouseMove = (e) => {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el || el === overlay || el === tooltip) return;
            lastHovered = el;
            const r = el.getBoundingClientRect();
            overlay.style.left   = r.left + 'px';
            overlay.style.top    = r.top + 'px';
            overlay.style.width  = r.width + 'px';
            overlay.style.height = r.height + 'px';
            tooltip.textContent  = getSelector(el);
            tooltip.style.left   = (e.clientX + 12) + 'px';
            tooltip.style.top    = Math.max(4, e.clientY - 28) + 'px';
          };

          const cleanup = () => {
            document.removeEventListener('mousemove', onMouseMove, true);
            document.removeEventListener('mousedown', onMouseDown, true);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            tooltip.remove();
            window.__pickerActive = false;
          };

          // Block mousedown to prevent pages (e.g. Amazon) from navigating
          const onMouseDown = (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
          };

          const onClick = (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            const el = lastHovered;
            if (!el) return;
            // Store result BEFORE cleanup so it survives event removal
            window.__pickerResult = {
              selector: getSelector(el),
              outerHtml: el.outerHTML.slice(0, 2000)
            };
            cleanup();
            // Short signal — large JSON in console.log gets truncated by Chromium
            console.log('__PICKER_DONE__');
          };

          const onKey = (e) => {
            if (e.key === 'Escape') {
              cleanup();
              console.log('__PICKER_CANCELLED__');
            }
          };

          document.addEventListener('mousemove', onMouseMove, true);
          document.addEventListener('mousedown', onMouseDown, true);
          document.addEventListener('click', onClick, true);
          document.addEventListener('keydown', onKey, true);
        })();
      `).catch(err => console.error('Picker inject error:', err))
    }

    // In console-message handler, detect picker signals:
    // Note: Electron v41 deprecated signature is (event, level, message, line, sourceId)
    browserView.webContents.on('console-message', async (_event, _level, msg) => {
      if (msg === '__DOM_CHANGED__') {
        scheduleSnapshot()

      } else if (msg === '__PICKER_DONE__') {
        console.log('[main] Picker done signal received — reading result...')
        try {
          // window.__pickerResult was set synchronously before console.log fired
          const result = await browserView.webContents.executeJavaScript(
            '(window.__pickerResult && window.__pickerResult.selector) ? window.__pickerResult : null'
          )
          console.log('[main] Picker result:', result)
          if (result && result.selector) {
            mainWindow.webContents.send('element-selected', {
              selector: result.selector,
              outerHtml: result.outerHtml
            })
          } else {
            console.error('[main] Picker result missing or invalid')
            mainWindow.webContents.send('picker-cancelled')
          }
        } catch (err) {
          console.error('[main] Failed to read picker result:', err)
          mainWindow.webContents.send('picker-cancelled')
        }

      } else if (msg === '__PICKER_CANCELLED__') {
        console.log('[main] Picker cancelled')
        mainWindow.webContents.send('picker-cancelled')
      }
    })

    ipcMain.on('start-picker', () => {
      browserView.webContents.focus()
      injectElementPicker()
    })

    ipcMain.on('save-watch', (_event, data: { selector: string; outerHtml: string; condition: string }) => {
      const url = browserView.webContents.getURL()
      saveWatch({
        url,
        selector: data.selector,
        elementHtml: data.outerHtml,
        condition: data.condition,
        timestamp: new Date().toISOString()
      })
      mainWindow.webContents.send('watch-saved')
    })

    // Move the browserView off-screen so the renderer dialog can appear on top
    ipcMain.on('overlay-show', () => {
      browserView.setBounds({ x: 0, y: 10000, width: 1, height: 1 })
    })

    // Restore normal browserView bounds after dialog is closed
    ipcMain.on('overlay-hide', () => {
      resizeView()
    })

    ipcMain.on('start-login', (_event, authConfig) => {
      const { domain, clientId, audience } = authConfig;
      const redirectUri = encodeURIComponent('signal://callback');
      const audienceParam = audience ? `&audience=${encodeURIComponent(audience)}` : '';
      // We use the Implicit flow (response_type=token) for simplicity in this Electron setup
      const authUrl = `https://${domain}/authorize?response_type=token&client_id=${clientId}&redirect_uri=${redirectUri}&scope=openid profile email${audienceParam}`;
      console.log('[main] Opening Auth0 login URL:', authUrl);
      shell.openExternal(authUrl);
    })

    resizeView()
    mainWindow.on('resize', resizeView)

    const launchedWithDeepLink = handleDeepLink(process.argv)
    if (!launchedWithDeepLink) {
      browserView.webContents.loadURL('https://google.com')
    }

    const updateUrlBar = (url: string) => {
      mainWindow.webContents.send('update-url', url)
    }

    browserView.webContents.on('did-finish-load', () => {
      // Ensure the view doesn't intercept events outside its bounds
      browserView.setBackgroundColor('#00000000')
      if (!shouldLogHtml) return
      injectDomWatcher()
      scheduleSnapshot()
    })

    browserView.webContents.on('did-navigate', (_event, url) => {
      updateUrlBar(url)
    })

    browserView.webContents.on('did-navigate-in-page', (_event, url) => {
      updateUrlBar(url)
      if (shouldLogHtml) scheduleSnapshot()
    })

    ipcMain.on('navigate-to', (_event, input) => {
      let finalUrl = input
      const isLikelyUrl =
        /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(input) ||
        input.startsWith('http://') ||
        input.startsWith('https://') ||
        input.startsWith('localhost:')

      if (isLikelyUrl) {
        if (!input.startsWith('http://') && !input.startsWith('https://')) {
          finalUrl = 'https://' + input
        }
      } else {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(input)}`
      }

      shouldLogHtml = true
      browserView.webContents.loadURL(finalUrl)
    })

    ipcMain.on('go-back', () => {
      if (browserView.webContents.navigationHistory.canGoBack())
        browserView.webContents.navigationHistory.goBack()
    })

    ipcMain.on('go-forward', () => {
      if (browserView.webContents.navigationHistory.canGoForward())
        browserView.webContents.navigationHistory.goForward()
    })

    ipcMain.on('reload-page', () => {
      browserView.webContents.reload()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}