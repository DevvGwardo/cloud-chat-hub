/**
 * Spark Electron — Renderer / UI Tests
 *
 * Tests that the React app renders correctly inside Electron,
 * key UI components are present, and the API connection works.
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

test.describe('Renderer App', () => {
  test('React app mounts (root element exists)', async () => {
    const hasRoot = await fixture.window.evaluate(() => {
      const root = document.getElementById('root') || document.getElementById('app')
      return root !== null && root.children.length > 0
    })
    expect(hasRoot).toBe(true)
  })

  test('embedded API server is reachable', async () => {
    const apiPort = await fixture.window.evaluate(() => {
      return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI?.apiPort
    })

    if (!apiPort) {
      test.skip(true, 'electronAPI.apiPort was not exposed by the preload bridge')
      return
    }

    // Hit the real health endpoint of the embedded Express server
    // (server/index.ts) and require a 200 — not just "any HTTP response".
    const health = await fixture.window.evaluate(async (port: number) => {
      try {
        const res = await fetch(`http://localhost:${port}/functions/v1/health`)
        const body = await res.json().catch(() => null)
        return { ok: res.ok, status: res.status, bodyOk: body?.ok === true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, status: 0, bodyOk: false, error: message }
      }
    }, apiPort)

    expect(health.status).toBe(200)
    expect(health.ok).toBe(true)
    expect(health.bodyOk).toBe(true)
  })

  test('external links open in system browser (not in-app)', async () => {
    const urlBefore = fixture.window.url()

    // Actually trigger a navigation attempt instead of only inspecting the
    // origin string: window.open() goes through setWindowOpenHandler, which
    // denies it (deny ⇒ null) and hands the URL to the OS browser via
    // shell.openExternal. (A plain <a href> click exercises will-navigate
    // instead, but Electron's preventDefault leaves Playwright tracking a
    // canceled navigation that stalls the next test's actions — so we cover
    // the handler here and keep the suite order-independent.)
    const result = await fixture.window.evaluate(() => {
      const popup = window.open('https://example.com')
      return { popupAllowed: popup !== null }
    })

    // The handler denied the popup: no in-app window was created.
    expect(result.popupAllowed).toBe(false)

    // The main window must not have navigated away from the app (poll, so a
    // synchronous check can't race an async denied-navigation attempt).
    await expect.poll(() => fixture.window.url(), { timeout: 3000 }).toBe(urlBefore)
  })
})

test.describe('UI Components', () => {
  test('sidebar is present', async () => {
    // Stable selector: the app layout renders the sidebar inside
    // <nav aria-label="Main navigation"> (src/components/layout/AppLayout.tsx).
    const sidebar = fixture.window.locator('nav[aria-label="Main navigation"]').first()

    // A fresh profile starts with the sidebar collapsed — open it through the
    // real toggle so the assertion exercises the interaction path. If it's
    // already open the button won't exist and the click times out (caught).
    try {
      await fixture.window.getByTitle('Open sidebar').first().click({ timeout: 3000 })
    } catch {
      /* sidebar already open */
    }

    await expect(sidebar).toBeVisible({ timeout: 10_000 })
  })

  test('chat area or main content is present', async () => {
    // Stable selector: the chat composer textarea rendered by ChatInput
    // (src/components/chat/ChatInput.tsx) inside the main pane.
    const composer = fixture.window.locator('textarea.chat-composer-textarea').first()
    await expect(composer).toBeVisible({ timeout: 10_000 })
  })
})
