// @vitest-environment node
import type { AddressInfo } from 'net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HERMES_TOOL_CAPABLE_MODELS } from '../provider-config'

async function createTestServer() {
  const { createApp } = await import('../index')
  const app = createApp()

  return await new Promise<{
    close: () => Promise<void>
    url: string
  }>((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error)
                return
              }
              closeResolve()
            })
          }),
      })
    })
  })
}

describe('Hermes validate-key route', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns the curated Hermes model shortlist after the bridge validates', async () => {
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      if (url.includes('/functions/v1/validate-key')) {
        return realFetch(input, init)
      }

      // Bridge /models validates the key but returns no usable catalog so the
      // route falls back to the curated HERMES_TOOL_CAPABLE_MODELS shortlist.
      if (url.includes('/models')) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/health')) {
        return new Response(JSON.stringify({
          status: 'ok',
          has_openrouter_creds: true,
          has_minimax_creds: false,
          brain_initialized: true,
          active_requests: 0,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return realFetch(input, init)
    }))

    const server = await createTestServer()

    try {
      const response = await realFetch(`${server.url}/functions/v1/validate-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'hermes',
          api_key: 'openrouter-key',
        }),
      })

      const body = await response.json()

      expect(response.ok).toBe(true)
      expect(body.valid).toBe(true)
      expect(body.defaultModel).toBe(HERMES_TOOL_CAPABLE_MODELS[0])
      expect(body.models).toEqual(expect.arrayContaining([...HERMES_TOOL_CAPABLE_MODELS]))
    } finally {
      await server.close()
    }
  })

  it('does not warn for default_model_credentialed-only setups (custom CLI base_url)', async () => {
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      // Local validate-key request must hit the test server, not the bridge mock.
      if (url.includes('/functions/v1/validate-key')) {
        return realFetch(input, init)
      }

      if (url.includes('/models')) {
        return new Response(JSON.stringify({
          data: [{ id: 'deepseek-v4-flash' }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/health')) {
        return new Response(JSON.stringify({
          status: 'ok',
          has_openrouter_creds: false,
          has_minimax_creds: false,
          default_model_credentialed: true,
          hermes_default_model: 'deepseek-v4-flash',
          provider_credentials: { openrouter: false, anthropic: false },
          brain_initialized: true,
          active_requests: 0,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return realFetch(input, init)
    }))

    const server = await createTestServer()

    try {
      const response = await realFetch(`${server.url}/functions/v1/validate-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'hermes',
        }),
      })

      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.valid).toBe(true)
      expect(body.defaultModel).toBe('deepseek-v4-flash')
      expect(body.warning).toBeUndefined()
    } finally {
      await server.close()
    }
  })

})
