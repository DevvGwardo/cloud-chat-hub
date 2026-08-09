// @vitest-environment node
// POST /api/hermes/approvals/:id — resolves parked server-side tool approvals
// (approval-engine). Mirrors the bridge's /v1/approvals/{id} contract.
import type { AddressInfo } from 'net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approvalPolicyStore } from '../approval-engine'

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

describe('POST /api/hermes/approvals/:id', () => {
  beforeEach(() => {
    approvalPolicyStore.resetForTests()
  })

  afterEach(() => {
    approvalPolicyStore.resetForTests()
  })

  it('rejects missing or invalid decisions', async () => {
    const server = await createTestServer()
    try {
      const missing = await fetch(`${server.url}/api/hermes/approvals/abc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(missing.status).toBe(400)

      const invalid = await fetch(`${server.url}/api/hermes/approvals/abc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'maybe' }),
      })
      expect(invalid.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  it('returns 404 for unknown or expired approvals', async () => {
    const server = await createTestServer()
    try {
      const response = await fetch(`${server.url}/api/hermes/approvals/nope`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      })
      expect(response.status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('resolves a parked approval and lets the awaiting tool call proceed', async () => {
    const server = await createTestServer()
    try {
      let parkedApprovalId = ''
      const outcomePromise = approvalPolicyStore.authorize({
        conversationId: 'conv-approve',
        tool: 'run_command',
        command: 'rm -rf /tmp/x',
        reason: 'run destructive command',
        emit: (payload) => {
          parkedApprovalId = payload.approval_id
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(parkedApprovalId).not.toBe('')

      const response = await fetch(`${server.url}/api/hermes/approvals/${parkedApprovalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved', reason: 'user said go' }),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { ok: boolean; approval_id: string; decision: string }
      expect(body).toEqual({ ok: true, approval_id: parkedApprovalId, decision: 'approved' })

      await expect(outcomePromise).resolves.toBe('approved')
    } finally {
      await server.close()
    }
  })

  it('approved_for_session inserts a session rule so the same command runs silently next time', async () => {
    const server = await createTestServer()
    try {
      let parkedApprovalId = ''
      const outcomePromise = approvalPolicyStore.authorize({
        conversationId: 'conv-session',
        tool: 'run_command',
        command: 'git push',
        reason: 'push',
        emit: (payload) => {
          parkedApprovalId = payload.approval_id
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 10))

      const response = await fetch(`${server.url}/api/hermes/approvals/${parkedApprovalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved_for_session' }),
      })
      expect(response.status).toBe(200)
      await expect(outcomePromise).resolves.toBe('approved')

      // Same command + tool is now allowed without emitting another request.
      const emitted: unknown[] = []
      await expect(
        approvalPolicyStore.authorize({
          conversationId: 'conv-session',
          tool: 'run_command',
          command: 'git push',
          reason: 'push again',
          emit: (payload) => emitted.push(payload),
        }),
      ).resolves.toBe('approved')
      expect(emitted).toHaveLength(0)
    } finally {
      await server.close()
    }
  })

  it('approved with reason "prefix" inserts a durable prefix rule (Always for prefix)', async () => {
    const server = await createTestServer()
    try {
      let parkedApprovalId = ''
      const outcomePromise = approvalPolicyStore.authorize({
        conversationId: 'conv-prefix',
        tool: 'run_command',
        command: 'npm run lint',
        reason: 'lint',
        emit: (payload) => {
          parkedApprovalId = payload.approval_id
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 10))

      const response = await fetch(`${server.url}/api/hermes/approvals/${parkedApprovalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved', reason: 'prefix' }),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { ok: boolean; decision: string }
      expect(body.decision).toBe('approved')
      await expect(outcomePromise).resolves.toBe('approved')

      // A different command under the same prefix runs silently (rule matched).
      const emitted: unknown[] = []
      await expect(
        approvalPolicyStore.authorize({
          conversationId: 'conv-prefix',
          tool: 'run_command',
          command: 'npm run lint -- --fix',
          reason: 'lint again',
          emit: (payload) => emitted.push(payload),
        }),
      ).resolves.toBe('approved')
      expect(emitted).toHaveLength(0)

      // A command outside the prefix still parks.
      const emitted2: unknown[] = []
      const parked = approvalPolicyStore.authorize({
        conversationId: 'conv-prefix',
        tool: 'run_command',
        command: 'npm run test',
        reason: 'test',
        emit: (payload) => emitted2.push(payload),
      })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(emitted2).toHaveLength(1)
      approvalPolicyStore.resetForTests()
      await expect(parked).resolves.toBe('abort')
    } finally {
      await server.close()
    }
  })
})
