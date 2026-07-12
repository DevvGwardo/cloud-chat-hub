import { contextBridge, ipcRenderer } from 'electron'
import os from 'os'

// Main process sets ELECTRON_API_PORT env var before creating BrowserWindow
const apiPort = Number(process.env.ELECTRON_API_PORT) || 3001
const snapshotDir = process.env.CLOUDCHAT_IMAGE_SNAPSHOT_DIR || ''

contextBridge.exposeInMainWorld('electronAPI', {
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  },
  platform: process.platform,
  homeDir: os.homedir(),
  snapshotDir,
  apiPort,
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  openrouterOAuth: (): Promise<string> => ipcRenderer.invoke('openrouter:oauth'),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:open-external', url),
  saveFile: (defaultFilename: string, content: string): Promise<{ saved: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('file:save-dialog', { defaultFilename, content }),
  snapshotLocalImage: (path: string): Promise<{ url: string; hash: string; path: string }> =>
    ipcRenderer.invoke('cloudchat:snapshotLocalImage', path),
  notifyAttentionRequest: (payload?: { title?: string; body?: string }) => ipcRenderer.invoke('app:notify-attention', payload),
  clearAttentionRequest: () => ipcRenderer.invoke('app:clear-attention'),
  terminal: {
    spawn: (options?: { cwd?: string; command?: string } | string) =>
      ipcRenderer.invoke('terminal:spawn', typeof options === 'string' ? { cwd: options } : options),
    write: (id: string, data: string) => ipcRenderer.send('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('terminal:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.send('terminal:kill', id),
    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, data: string) => callback(id, data)
      ipcRenderer.on('terminal:data', handler)
      return () => { ipcRenderer.removeListener('terminal:data', handler) }
    },
    onExit: (callback: (id: string, exitCode: number) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, exitCode: number) => callback(id, exitCode)
      ipcRenderer.on('terminal:exit', handler)
      return () => { ipcRenderer.removeListener('terminal:exit', handler) }
    }
  },
  browser: {
    create: (url?: string) => ipcRenderer.invoke('browser:create', url),
    navigate: (url: string) => ipcRenderer.invoke('browser:navigate', url),
    goBack: () => ipcRenderer.invoke('browser:go-back'),
    goForward: () => ipcRenderer.invoke('browser:go-forward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    close: () => ipcRenderer.invoke('browser:close'),
    resize: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('browser:resize', bounds),
    show: () => ipcRenderer.invoke('browser:show'),
    hide: () => ipcRenderer.invoke('browser:hide'),
    getUrl: (): Promise<string | null> => ipcRenderer.invoke('browser:get-url'),
    onForceResize: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('browser:force-resize', handler);
      return () => { ipcRenderer.removeListener('browser:force-resize', handler); };
    },
    onNavigated: (callback: (url: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, url: string) => callback(url);
      ipcRenderer.on('browser:navigated', handler);
      return () => { ipcRenderer.removeListener('browser:navigated', handler); };
    },
    onLoading: (callback: (loading: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, loading: boolean) => callback(loading);
      ipcRenderer.on('browser:loading', handler);
      return () => { ipcRenderer.removeListener('browser:loading', handler); };
    },
    onFailLoad: (callback: (payload: { url: string; errorCode: number; errorDescription: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { url: string; errorCode: number; errorDescription: string },
      ) => callback(payload);
      ipcRenderer.on('browser:fail-load', handler);
      return () => { ipcRenderer.removeListener('browser:fail-load', handler); };
    },
    onNavState: (callback: (state: { canGoBack: boolean; canGoForward: boolean }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        state: { canGoBack: boolean; canGoForward: boolean },
      ) => callback(state);
      ipcRenderer.on('browser:nav-state', handler);
      return () => { ipcRenderer.removeListener('browser:nav-state', handler); };
    },
  },
  onNewChat: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('new-chat', handler)
    return () => { ipcRenderer.removeListener('new-chat', handler) }
  },
  bridge: {
    status: () => ipcRenderer.invoke('bridge:status'),
    start: () => ipcRenderer.invoke('bridge:start'),
    installDeps: () => ipcRenderer.invoke('bridge:install-deps'),
    installHermesAgent: () => ipcRenderer.invoke('bridge:install-hermes-agent'),
    onInstallProgress: (callback: (line: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, line: string) => callback(line)
      ipcRenderer.on('bridge:install-progress', handler)
      return () => { ipcRenderer.removeListener('bridge:install-progress', handler) }
    },
  },
})
