// @vitest-environment node
import express from 'express';
import type { AddressInfo } from 'net';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerWorkspaceRoutes } from '../routes/workspace';

// Deterministic DNS for the fetch-url SSRF tests: localhost / internal names
// resolve to blocked addresses, everything else to a public IP.
vi.mock('dns/promises', () => ({
  lookup: vi.fn(async (hostname: string) => {
    if (hostname === 'localhost' || hostname === 'internal.example') {
      return [{ address: hostname === 'localhost' ? '127.0.0.1' : '10.0.0.5', family: 4 }];
    }
    return [{ address: '93.184.216.34', family: 4 }];
  }),
}));

async function createTestServer() {
  const app = express();
  registerWorkspaceRoutes(app);

  return await new Promise<{
    close: () => Promise<void>;
    url: string;
  }>((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
  });
}

describe('workspace context routes', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function makeWorkspace() {
    const repoDir = await mkdtemp(join(tmpdir(), 'spark-workspace-route-'));
    tempDirs.push(repoDir);
    await mkdir(join(repoDir, '.git'));
    await mkdir(join(repoDir, 'src'));
    await writeFile(join(repoDir, 'src', 'app.ts'), 'export const ok = true;\n');
    return repoDir;
  }

  it('reads files inside an attached git workspace', async () => {
    const repoDir = await makeWorkspace();
    const server = await createTestServer();

    try {
      const params = new URLSearchParams({ root: repoDir, file: 'src/app.ts' });
      const response = await fetch(`${server.url}/functions/v1/workspace/read?${params}`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.content).toContain('export const ok = true');
    } finally {
      await server.close();
    }
  });

  it('rejects arbitrary filesystem roots', async () => {
    const server = await createTestServer();

    try {
      const params = new URLSearchParams({ root: '/', file: 'etc/passwd' });
      const response = await fetch(`${server.url}/functions/v1/workspace/read?${params}`);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('attached git workspace');
    } finally {
      await server.close();
    }
  });

  it('rejects symlinks that escape the workspace root', async () => {
    const repoDir = await makeWorkspace();
    const outsideDir = await mkdtemp(join(tmpdir(), 'spark-workspace-secret-'));
    tempDirs.push(outsideDir);
    const secretPath = join(outsideDir, 'secret.txt');
    await writeFile(secretPath, 'do not leak\n');
    await symlink(secretPath, join(repoDir, 'src', 'secret-link.txt'));
    const server = await createTestServer();

    try {
      const params = new URLSearchParams({ root: repoDir, file: 'src/secret-link.txt' });
      const response = await fetch(`${server.url}/functions/v1/workspace/read?${params}`);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('attached git workspace');
    } finally {
      await server.close();
    }
  });

  it('validates workspace search roots too', async () => {
    const nonRepoDir = await mkdtemp(join(tmpdir(), 'spark-workspace-nonrepo-'));
    tempDirs.push(nonRepoDir);
    await writeFile(join(nonRepoDir, 'leak.txt'), 'secret\n');
    const server = await createTestServer();

    try {
      const params = new URLSearchParams({ path: nonRepoDir, q: 'leak' });
      const response = await fetch(`${server.url}/functions/v1/workspace/search?${params}`);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('attached git workspace');
    } finally {
      await server.close();
    }
  });

  // ─── fetch-url SSRF guard ──────────────────────────────────────────────────

  const actualFetch = global.fetch;
  const originalUrl = (input: RequestInfo | URL) =>
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetch-url rejects loopback IP literals', async () => {
    const server = await createTestServer();

    try {
      const params = new URLSearchParams({ url: 'http://127.0.0.1:3001/secret' });
      const response = await fetch(`${server.url}/functions/v1/fetch-url?${params}`);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('private or loopback');
    } finally {
      await server.close();
    }
  });

  it('fetch-url rejects localhost resolved via DNS', async () => {
    const server = await createTestServer();

    try {
      const params = new URLSearchParams({ url: 'http://localhost:3001/secret' });
      const response = await fetch(`${server.url}/functions/v1/fetch-url?${params}`);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('private or loopback');
    } finally {
      await server.close();
    }
  });

  it('fetch-url rejects redirects into private address space', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      // First hop (public) redirects to the cloud metadata service.
      if (originalUrl(input).startsWith('https://public.example/')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data' },
        });
      }
      return actualFetch(input);
    }));

    const server = await createTestServer();

    try {
      const params = new URLSearchParams({ url: 'https://public.example/page' });
      const response = await fetch(`${server.url}/functions/v1/fetch-url?${params}`);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('private or loopback');
    } finally {
      await server.close();
    }
  });

  it('fetch-url rejects redirects to private hostnames resolved via DNS', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (originalUrl(input).startsWith('https://public.example/')) {
        return new Response(null, {
          status: 301,
          headers: { location: 'http://internal.example/secret' },
        });
      }
      return actualFetch(input);
    }));

    const server = await createTestServer();

    try {
      const params = new URLSearchParams({ url: 'https://public.example/page' });
      const response = await fetch(`${server.url}/functions/v1/fetch-url?${params}`);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('private or loopback');
    } finally {
      await server.close();
    }
  });

  it('fetch-url fetches public URLs and returns truncated content', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (originalUrl(input).startsWith('https://public.example/')) {
        return new Response('<html><body>hello public world</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      return actualFetch(input);
    }));

    const server = await createTestServer();

    try {
      const params = new URLSearchParams({ url: 'https://public.example/page' });
      const response = await fetch(`${server.url}/functions/v1/fetch-url?${params}`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.fetched).toBe(true);
      expect(data.content).toContain('hello public world');
    } finally {
      await server.close();
    }
  });
});
