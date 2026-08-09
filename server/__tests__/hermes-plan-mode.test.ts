// @vitest-environment node
// Plan-mode enforcement on the Hermes agent-loop bridge path: the server must
// pass `plan_mode: true` in the bridge request body, strip mutating tools from
// forwarded custom tool definitions, and still emit the trailing `usage`
// custom field at stream end.
import type { AddressInfo } from 'net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const providerConfigMocks = vi.hoisted(() => ({
  createProviderModel: vi.fn(),
}))

const hermesProfileMocks = vi.hoisted(() => ({
  getHubSelectedProfileName: vi.fn(() => 'agent-two'),
}))

const repoCloneMocks = vi.hoisted(() => ({
  ensureRepoClone: vi.fn(),
  getManagedRepoClone: vi.fn(),
}))

vi.mock('../provider-config', async () => {
  const actual = await vi.importActual<typeof import('../provider-config')>('../provider-config')
  return {
    ...actual,
    createProviderModel: providerConfigMocks.createProviderModel,
  }
})

vi.mock('../lib/hermes-profiles', async () => {
  const actual = await vi.importActual<typeof import('../lib/hermes-profiles')>('../lib/hermes-profiles')
  return {
    ...actual,
    getHubSelectedProfileName: hermesProfileMocks.getHubSelectedProfileName,
  }
})

vi.mock('../repo-clone-manager', async () => {
  const actual = await vi.importActual<typeof import('../repo-clone-manager')>('../repo-clone-manager')
  return {
    ...actual,
    ensureRepoClone: repoCloneMocks.ensureRepoClone,
    getManagedRepoClone: repoCloneMocks.getManagedRepoClone,
  }
})

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
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error)
                return
              }
              resolveClose()
            })
          }),
      })
    })
  })
}

describe('Hermes agent-loop plan mode', () => {
  const actualFetch = global.fetch

  beforeEach(() => {
    providerConfigMocks.createProviderModel.mockReturnValue({ id: 'hermes-model' })
    repoCloneMocks.ensureRepoClone.mockRejectedValue(new Error('clone unavailable'))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('passes plan_mode to the bridge, strips mutating custom tools, and emits the usage event', async () => {
    let upstreamBody: {
      plan_mode?: boolean
      custom_tools?: unknown[]
    } | null = null

    const bridgeStream = [
      'data: {"id":"chatcmpl-plan","choices":[{"index":0,"delta":{"content":"Plan: inspect the repo."}}]}\n\n',
      'data: {"id":"chatcmpl-plan","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":14,"completion_tokens":7,"total_tokens":21}}\n\n',
      'data: [DONE]\n\n',
    ].join('')

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as { url: string }).url
      if (url.includes('/functions/v1/chat')) {
        return actualFetch(input, init)
      }
      if (url.includes('/chat/completions')) {
        upstreamBody = JSON.parse(String(init?.body)) as { plan_mode?: boolean; custom_tools?: unknown[] }
        return new Response(bridgeStream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      throw new Error(`Unexpected upstream fetch: ${url}`)
    }))

    const server = await createTestServer()

    try {
      const response = await actualFetch(`${server.url}/functions/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Profile': 'agent-two',
        },
        body: JSON.stringify({
          provider: 'hermes',
          model: 'meta-llama/llama-4-maverick',
          api_key: 'or-key',
          planMode: true,
          conversation_id: 'conv-plan',
          custom_tools: [
            { name: 'run_command' },
            { name: 'execute_python' },
            { function: { name: 'write_file' } },
            { name: 'read_repo_file' },
            { function: { name: 'web_search' } },
          ],
          messages: [{ role: 'user', content: 'Plan the refactor.' }],
        }),
      })

      expect(response.ok).toBe(true)
      const body = await response.text()

      // 1. plan_mode is forwarded to the bridge (B1 honors it).
      const capturedUpstreamBody = upstreamBody as { plan_mode?: boolean; custom_tools?: unknown[] } | null
      expect(capturedUpstreamBody?.plan_mode).toBe(true)

      // 2. Mutating custom tools are stripped; read-only tools are kept.
      const forwardedNames = (capturedUpstreamBody?.custom_tools ?? []).map((toolDef) => {
        const record = toolDef as { name?: string; function?: { name?: string } }
        return record.name ?? record.function?.name
      })
      expect(forwardedNames).toEqual(['read_repo_file', 'web_search'])
      expect(forwardedNames).not.toContain('run_command')
      expect(forwardedNames).not.toContain('execute_python')
      expect(forwardedNames).not.toContain('write_file')

      // 3. Streaming still works and the trailing usage event is emitted.
      expect(body).toContain('Plan: inspect the repo.')
      expect(body).toContain('"type":"usage"')
      expect(body).toContain('"input_tokens":14')
      expect(body).toContain('"output_tokens":7')
      expect(body).toContain('"model":"meta-llama/llama-4-maverick"')
    } finally {
      await server.close()
    }
  })
})
