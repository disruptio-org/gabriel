// Personal Intelligence - Windows desktop shell.
//
// The window is frameless: the app draws its own chrome (the Ø titlebar with
// + ─ ▢ ✕), and those controls drive the real OS window through the preload
// bridge. The renderer is served over loopback by the same process that holds
// the API keys, so relative /api fetches work exactly as they do under Vite and
// no credential ever crosses into renderer code (§16).
import { app, BrowserWindow, ipcMain, safeStorage, session, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { startServer } from '../server/index.mjs'
import { defaultRoots } from '../server/docs/roots.mjs'
import { PROVIDER_IDS, PRIMARY, setKeyEnv } from '../server/providers.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// The installed app cannot read the repo's .env, and no key must ever be
// packaged into the installer. An installed build reads them from the per-user
// config file instead: %APPDATA%/Personal Intelligence/.env
// Credentials at rest are encrypted by the OS (DPAPI on Windows) rather than
// left in a readable file - requirements §16 asks for the platform's own
// credential mechanism where one exists.
//
// One file per provider. The primary provider keeps the original filename so
// that an existing install does not silently lose the key it already stored.
const vaultFile = (provider) =>
  join(
    app.getPath('userData'),
    provider === PRIMARY ? 'credential.bin' : `credential-${provider}.bin`,
  )

function loadStoredKeys() {
  if (!safeStorage.isEncryptionAvailable()) return
  for (const provider of PROVIDER_IDS) {
    try {
      const key = safeStorage.decryptString(readFileSync(vaultFile(provider)))
      if (key) setKeyEnv(provider, key)
    } catch {
      /* nothing stored for this provider, or it was written by another OS user */
    }
  }
}

/** Handed to the service, which calls it once a key has been verified. */
function persistKey(provider, key) {
  if (key === null) return void rmSync(vaultFile(provider), { force: true })
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS credential storage unavailable')
  }
  writeFileSync(vaultFile(provider), safeStorage.encryptString(key), { mode: 0o600 })
}

function loadUserEnv() {
  try {
    const file = join(app.getPath('userData'), '.env')
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* no per-user .env - fall back to the ambient environment */
  }
}
const DEV_URL = process.env.PI_DEV_URL ?? null

// Launcher and chat are the same window at two sizes - summoning grows it.
const LAUNCHER = { width: 380, height: 300 }
const CHAT = { width: 1020, height: 720 }

let win = null

async function createWindow() {
  // port 0: let the OS pick a free port, so a stale service never blocks launch.
  const { port } = DEV_URL
    ? { port: null }
    : await startServer({
        port: 0,
        staticDir: join(here, '..', 'dist'),
        persist: persistKey,
        docsDir: join(app.getPath('userData'), 'index'),
        docsRoots: defaultRoots(),
      })

  win = new BrowserWindow({
    ...LAUNCHER,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: true,
    center: true,
    title: 'Personal Intelligence',
    icon: join(here, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Without this, getUserMedia is refused with no prompt and no error the
  // renderer can distinguish from a hardware failure - and only in the packaged
  // app, because under Vite the page runs in a browser that asks the user
  // itself. Microphone access is granted because the user asked for voice by
  // pressing the button; everything else Chromium might request is refused.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture')
  })
  // The synchronous twin of the handler above, consulted for getUserMedia on
  // some paths. Answering only one of the two leaves the failure intermittent.
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    permission === 'media' || permission === 'audioCapture',
  )

  win.removeMenu()
  win.once('ready-to-show', () => win.show())

  // Links open in the real browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const relay = () => win?.webContents.send('pi:maximized', win.isMaximized())
  win.on('maximize', relay)
  win.on('unmaximize', relay)

  await win.loadURL(DEV_URL ?? `http://127.0.0.1:${port}/`)
}

ipcMain.handle('pi:minimize', () => win?.minimize())
ipcMain.handle('pi:close', () => win?.close())
ipcMain.handle('pi:isMaximized', () => win?.isMaximized() ?? false)
ipcMain.handle('pi:toggleMaximize', () => {
  if (!win) return false
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return win.isMaximized()
})

// Phase changes resize the real window instead of a div.
ipcMain.handle('pi:phase', (_e, phase) => {
  if (!win || win.isMaximized()) return
  const size = phase === 'desktop' ? LAUNCHER : CHAT
  win.setResizable(phase !== 'desktop')
  win.setSize(size.width, size.height, true)
  win.center()
})

app.whenReady().then(() => {
  // Encrypted store first; the plain .env stays as a fallback for a machine
  // where safeStorage is unavailable, and for seeding a fresh install.
  loadStoredKeys()
  loadUserEnv()
  return createWindow()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})

app.on('window-all-closed', () => app.quit())
