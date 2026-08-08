/**
 * Spark Electron — Core App Tests
 *
 * Tests the basic app launch, window properties, security headers,
 * and the Electron API bridge exposed via preload.
 */
import { test, expect } from '@playwright/test'
import { launchElectronApp, ElectronAppFixture, ElectronAPI } from './electron-app'

let fixture: ElectronAppFixture

test.beforeAll(async () => {
  fixture = await launchElectronApp()
})

test.afterAll(async () => {
  await fixture.close()
})

test.describe('App Launch', () => {
  test('main window opens with correct title', async () => {
    const title = await fixture.window.title()
    // The app is named "Spark" (BrowserWindow title + index.html <title>)
    expect(title).toContain('Spark')
  })

  test('window has reasonable dimensions', async () => {
    const dims = await fixture.window.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }))
    // The BrowserWindow is created at 1400x900 (electron/index.ts createWindow).
    // Allow tolerance for the hiddenInset title bar / scrollbars.
    expect(dims.width).toBeGreaterThanOrEqual(1300)
    expect(dims.height).toBeGreaterThanOrEqual(800)
  })

  test('page loads without JS errors', async () => {
    // Deterministic wait: once React has mounted into #root, load-time errors
    // have already fired. Errors are collected by the launcher from the first
    // load (before this test body runs), so nothing can slip past.
    await fixture.window.waitForFunction(() => {
      const root = document.getElementById('root')
      return root !== null && root.children.length > 0
    }, undefined, { timeout: 15_000 })

    // Filter out known non-critical warnings
    const criticalErrors = fixture.windowErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('ResizeObserver') &&
      !e.includes('Non-Error promise rejection')
    )
    expect(criticalErrors).toHaveLength(0)
  })
})

test.describe('Electron API Bridge (preload)', () => {
  test('window.electronAPI is exposed', async () => {
    const hasAPI = await fixture.window.evaluate(() => {
      return typeof (window as unknown as { electronAPI?: ElectronAPI }).electronAPI !== 'undefined'
    })
    expect(hasAPI).toBe(true)
  })

  test('electronAPI exposes version info', async () => {
    const versions = await fixture.window.evaluate(() => {
      const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI
      return {
        hasElectron: typeof api?.versions?.electron === 'string',
        hasNode: typeof api?.versions?.node === 'string',
        hasChrome: typeof api?.versions?.chrome === 'string',
      }
    })
    expect(versions.hasElectron).toBe(true)
    expect(versions.hasNode).toBe(true)
    expect(versions.hasChrome).toBe(true)
  })

  test('electronAPI exposes platform string', async () => {
    const platform = await fixture.window.evaluate(() => {
      return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI?.platform
    })
    expect(typeof platform).toBe('string')
    expect(['darwin', 'linux', 'win32']).toContain(platform)
  })

  test('electronAPI exposes apiPort', async () => {
    const port = await fixture.window.evaluate(() => {
      return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI?.apiPort
    })
    expect(typeof port).toBe('number')
    expect(port).toBeGreaterThanOrEqual(3000)
    expect(port).toBeLessThan(65536)
  })

  test('electronAPI exposes browser control methods', async () => {
    const browserAPI = await fixture.window.evaluate(() => {
      const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI?.browser
      if (!api) return null
      return {
        create: typeof api.create === 'function',
        navigate: typeof api.navigate === 'function',
        close: typeof api.close === 'function',
        resize: typeof api.resize === 'function',
        show: typeof api.show === 'function',
        hide: typeof api.hide === 'function',
        goBack: typeof api.goBack === 'function',
        goForward: typeof api.goForward === 'function',
        reload: typeof api.reload === 'function',
        getUrl: typeof api.getUrl === 'function',
      }
    })
    expect(browserAPI).not.toBeNull()
    expect(browserAPI!.create).toBe(true)
    expect(browserAPI!.navigate).toBe(true)
    expect(browserAPI!.close).toBe(true)
    expect(browserAPI!.resize).toBe(true)
    expect(browserAPI!.show).toBe(true)
    expect(browserAPI!.hide).toBe(true)
    expect(browserAPI!.goBack).toBe(true)
    expect(browserAPI!.goForward).toBe(true)
    expect(browserAPI!.reload).toBe(true)
    expect(browserAPI!.getUrl).toBe(true)
  })

  test('electronAPI exposes terminal control methods', async () => {
    const termAPI = await fixture.window.evaluate(() => {
      const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI?.terminal
      if (!api) return null
      return {
        spawn: typeof api.spawn === 'function',
        write: typeof api.write === 'function',
        resize: typeof api.resize === 'function',
        kill: typeof api.kill === 'function',
        onData: typeof api.onData === 'function',
        onExit: typeof api.onExit === 'function',
      }
    })
    expect(termAPI).not.toBeNull()
    expect(termAPI!.spawn).toBe(true)
    expect(termAPI!.write).toBe(true)
    expect(termAPI!.kill).toBe(true)
  })
})

test.describe('Security', () => {
  test('Content-Security-Policy header is set', async () => {
    // The main process injects a CSP on every main-window document response
    // via session.webRequest.onHeadersReceived (electron/index.ts). The
    // launcher captured the header from the first load — assert it actually
    // reached the renderer instead of a tautology.
    // Note: we intentionally do NOT assert `eval` is blocked here — in dev
    // (unpackaged) builds the CSP relaxes script-src with 'unsafe-eval' for
    // HMR, so eval blocking is only guaranteed in packaged builds. The header
    // itself is always present.
    expect(fixture.cspHeader).not.toBeNull()
    expect(fixture.cspHeader!).toContain("default-src 'self'")
    expect(fixture.cspHeader!).toContain('script-src')
  })

  test('contextIsolation prevents direct node access', async () => {
    const hasNodeAccess = await fixture.window.evaluate(() => {
      // In a properly isolated context, these should be undefined
      return {
        hasRequire: typeof (window as unknown as { require?: unknown }).require !== 'undefined',
        hasProcess: typeof (window as unknown as { process?: { versions?: { node?: string } } }).process !== 'undefined' &&
                    typeof (window as unknown as { process?: { versions?: { node?: string } } }).process?.versions?.node !== 'undefined',
        hasGlobal: typeof (globalThis as unknown as { process?: { versions?: { node?: string } } }).process !== 'undefined' &&
                   typeof (globalThis as unknown as { process?: { versions?: { node?: string } } }).process?.versions?.node !== 'undefined',
      }
    })
    // nodeIntegration is false + contextIsolation is true
    // so window.require, window.process and globalThis.process should NOT be available
    expect(hasNodeAccess.hasRequire).toBe(false)
    expect(hasNodeAccess.hasProcess).toBe(false)
    expect(hasNodeAccess.hasGlobal).toBe(false)
  })
})
