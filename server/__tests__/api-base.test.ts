// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest'

import { getApiBase } from '../lib/api-base'

describe('getApiBase', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('falls back to localhost:3001 with no env hints', () => {
    vi.stubEnv('PORT', '')
    vi.stubEnv('CLOUDCHAT_API_BASE', '')
    expect(getApiBase()).toBe('http://localhost:3001')
  })

  it('uses process.env.PORT — the port the embedded server actually bound', () => {
    vi.stubEnv('PORT', '58310')
    vi.stubEnv('CLOUDCHAT_API_BASE', '')
    expect(getApiBase()).toBe('http://localhost:58310')
  })

  it('lets an explicit CLOUDCHAT_API_BASE override win', () => {
    vi.stubEnv('PORT', '9999')
    vi.stubEnv('CLOUDCHAT_API_BASE', 'http://127.0.0.1:7777')
    expect(getApiBase()).toBe('http://127.0.0.1:7777')
  })
})
