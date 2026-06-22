// @vitest-environment node
import os from 'os'
import { request as httpRequest } from 'http'
import type { AddressInfo } from 'net'
import { describe, expect, it, vi } from 'vitest'

const TUNNEL_URL = 'https://test-tunnel.trycloudflare.com'
const TUNNEL_HOST = 'test-tunnel.trycloudflare.com'
const TOKEN = 'abc123token'

vi.mock('../lib/tunnel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tunnel')>()
  return {
    ...actual,
    getTunnelState: () => ({
      running: true,
      url: TUNNEL_URL,
      provider: 'cloudflared' as const,
      error: null,
      pid: 1234,
      accessToken: TOKEN,
    }),
  }
})

async function createTestServer(host?: string) {
  const { createApp } = await import('../index')
  const app = createApp({ serveFrontend: true })

  return await new Promise<{ close: () => Promise<void>; url: string }>((resolve) => {
    const server = app.listen(0, host, () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://${host ?? '127.0.0.1'}:${port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()))
          }),
      })
    })
  })
}

function firstLanIp(): string | null {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return null
}

// fetch/undici refuses to override the Host header, so tunnel-host requests
// go through node:http directly.
function rawGet(
  serverUrl: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  const { hostname, port } = new URL(serverUrl)
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path, headers }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

// Tunnel traffic terminates at the local cloudflared process, so the gate
// keys off the Host header matching the tunnel hostname.
describe('public tunnel access token gate', () => {
  it('blocks tunnel-host requests without the token', async () => {
    const server = await createTestServer()
    try {
      const res = await rawGet(server.url, '/functions/v1/health', { host: TUNNEL_HOST })
      expect(res.status).toBe(401)
    } finally {
      await server.close()
    }
  })

  it('accepts tunnel-host requests with ?key= and sets the auth cookie', async () => {
    const server = await createTestServer()
    try {
      const res = await rawGet(server.url, `/functions/v1/health?key=${TOKEN}`, { host: TUNNEL_HOST })
      expect(res.status).toBe(200)
      expect(String(res.headers['set-cookie'])).toContain(`spark_remote_key=${TOKEN}`)
    } finally {
      await server.close()
    }
  })

  it('accepts tunnel-host requests with the auth cookie', async () => {
    const server = await createTestServer()
    try {
      const res = await rawGet(server.url, '/functions/v1/health', {
        host: TUNNEL_HOST,
        cookie: `spark_remote_key=${TOKEN}`,
      })
      expect(res.status).toBe(200)
    } finally {
      await server.close()
    }
  })

  it('leaves local/LAN hosts ungated while the tunnel runs', async () => {
    const server = await createTestServer()
    try {
      const res = await fetch(`${server.url}/functions/v1/health`)
      expect(res.ok).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('embeds the keyed tunnel URL in /api/remote/info for loopback desktop requests', async () => {
    const server = await createTestServer()
    try {
      const res = await fetch(`${server.url}/api/remote/info`)
      expect(res.ok).toBe(true)
      const body = (await res.json()) as { url: string; tunnelUrl: string; qrSvg: string }
      expect(body.url).toBe(`${TUNNEL_URL}/?key=${TOKEN}`)
      expect(body.tunnelUrl).toBe(`${TUNNEL_URL}/?key=${TOKEN}`)
      const qrSvg = Buffer.from(body.qrSvg.split(',')[1] ?? '', 'base64').toString('utf8')
      expect(qrSvg).toContain(TOKEN)
    } finally {
      await server.close()
    }
  })

  it('does not expose the tunnel token in non-loopback remote info responses', async () => {
    const lanIp = firstLanIp()
    if (!lanIp) return
    const server = await createTestServer('0.0.0.0')
    try {
      const res = await fetch(`${server.url.replace('0.0.0.0', lanIp)}/api/remote/info`)
      expect(res.ok).toBe(true)
      const body = (await res.json()) as { url: string; tunnelUrl: string; qrSvg: string }
      expect(body.url).toBe(TUNNEL_URL)
      expect(body.tunnelUrl).toBe(TUNNEL_URL)
      expect(body.url).not.toContain(TOKEN)
      expect(body.tunnelUrl).not.toContain(TOKEN)
      const qrSvg = Buffer.from(body.qrSvg.split(',')[1] ?? '', 'base64').toString('utf8')
      expect(qrSvg).not.toContain(TOKEN)
    } finally {
      await server.close()
    }
  })

  it('classifies loopback addresses without trusting forwarded headers', async () => {
    const { isLoopbackAddress } = await import('../index')

    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('127.2.3.4')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('192.168.1.40')).toBe(false)
    expect(isLoopbackAddress('::ffff:10.0.0.5')).toBe(false)
  })
})
