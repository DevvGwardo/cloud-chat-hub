// @vitest-environment node
import express from 'express';
import type { AddressInfo } from 'net';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { registerWorkspaceRoutes } from '../routes/workspace';

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
});
