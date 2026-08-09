import updater from 'electron-updater'
import { dialog, BrowserWindow } from 'electron'

const { autoUpdater } = updater

export function setupAutoUpdater(mainWindow: BrowserWindow) {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // Private repo: a fine-grained read-only PAT is baked into the build at
  // CI time via the CLOUDCHAT_UPDATE_TOKEN env var (see .github/workflows/release.yml).
  // electron-updater needs it set on the GitHub provider to fetch releases.
  // For local dev / unsigned builds without the token, updates silently no-op.
  const updateToken = process.env.CLOUDCHAT_UPDATE_TOKEN
  if (updateToken) {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'DevvGwardo',
      repo: 'spark',
      private: true,
      token: updateToken,
    })
  }

  autoUpdater.on('update-available', (info) => {
    console.log(`Update available: ${info.version}`)
  })

  autoUpdater.on('update-downloaded', async (info) => {
    let hasStreams = false
    try {
      hasStreams = await mainWindow.webContents.executeJavaScript(
        'window.__updateHasActiveStreams ? window.__updateHasActiveStreams() : false'
      )
    } catch {
      // Renderer not ready or function missing — assume no streams
    }

    // The main window may already be gone (macOS keeps the app alive after
    // close, and updates can land while the window is closed) — fall back to
    // an unparented dialog instead of throwing on a destroyed window.
    const dialogOptions: Electron.MessageBoxOptions = {
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: hasStreams
        ? 'You have an active response in progress. Restarting now will interrupt it.'
        : 'Restart CloudChat to install the update.',
      buttons: hasStreams ? ['Restart Anyway', 'Later'] : ['Restart Now', 'Later'],
      defaultId: 0,
    }
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, dialogOptions)
      : await dialog.showMessageBox(dialogOptions)

    if (result.response === 0) {
      autoUpdater.quitAndInstall()
    }
  })

  autoUpdater.on('error', (error) => {
    console.error('Auto-updater error:', error)
  })

  // Check for updates (silently fails if no internet or no releases)
  autoUpdater.checkForUpdates().catch(() => {})
}
