import type { Express, Request, Response } from 'express';
import { realpath, readFile, stat } from 'fs/promises';
import { isAbsolute, resolve, relative, sep } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { sendJson } from '../lib/helpers';
import { resolveAttachedLocalRepoPath } from '../lib/github-utils';
import { workspaceIndex } from '../workspace-indexer';

const execFileAsync = promisify(execFile);

const MAX_FILE_BYTES = 51_200; // 50KB + small buffer
const MAX_DIFF_BYTES = 100_000;
const MAX_URL_BYTES = 20_000;
const MAX_FOLDER_DEPTH = 3;
const MAX_FOLDER_ENTRIES = 200;
const FETCH_URL_TIMEOUT_MS = 12_000;

function isUnderRoot(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function resolveWorkspaceRoot(rootPath: string): Promise<string | null> {
  const repoRoot = resolveAttachedLocalRepoPath(rootPath);
  if (!repoRoot) {
    return null;
  }
  return realpath(repoRoot);
}

async function resolveUnderRoot(rootPath: string, targetPath: string): Promise<string | null> {
  const root = await resolveWorkspaceRoot(rootPath);
  if (!root) {
    return null;
  }
  const target = resolve(root, targetPath.replace(/^\.?\//, ''));
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(target) === resolve('/')) {
    return null;
  }
  const realTarget = await realpath(target);
  return isUnderRoot(root, realTarget) ? realTarget : null;
}

function truncateText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) {
    return { text, truncated: false };
  }
  return {
    text: buf.subarray(0, maxBytes).toString('utf8') + '\n\n[Truncated]',
    truncated: true,
  };
}

// ─── SSRF guard for /functions/v1/fetch-url ─────────────────────────────────

class BlockedUrlError extends Error {}

/**
 * True when the IP is a private/loopback/link-local/reserved address that
 * must never be fetched by the URL proxy (SSRF). Handles both IPv4 and IPv6,
 * including IPv4-mapped IPv6 (`::ffff:127.0.0.1`).
 */
export function isBlockedIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  // IPv4-mapped IPv6: check the embedded IPv4 address.
  if (normalized.startsWith('::ffff:')) {
    return isBlockedIp(normalized.slice('::ffff:'.length));
  }
  // Unspecified addresses.
  if (normalized === '0.0.0.0' || normalized === '::') return true;
  // Loopback: 127.0.0.0/8 and ::1.
  if (normalized === '::1' || normalized.startsWith('127.')) return true;
  // Link-local: 169.254.0.0/16 and fe80::/10.
  if (normalized.startsWith('169.254.')) return true;
  if (normalized.startsWith('fe80:')) return true;
  // Unique-local IPv6: fc00::/7.
  if (/^f[cd][0-9a-f]*:/.test(normalized)) return true;
  // Private IPv4: 10/8, 172.16/12, 192.168/16.
  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('192.168.')) return true;
  if (normalized.startsWith('172.')) {
    const second = Number(normalized.split('.')[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/**
 * Resolve the URL hostname and reject it if any resolved address is in a
 * blocked range. IP literals are checked directly (no DNS). Throws
 * BlockedUrlError when the target must not be fetched.
 */
async function assertUrlAllowed(url: URL): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new BlockedUrlError('URL resolves to a private or loopback address');
    }
    return;
  }
  const addresses = await lookup(hostname, { all: true });
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new BlockedUrlError('URL resolves to a private or loopback address');
    }
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function runGitDiff(cwd: string): Promise<string> {
  const parts: string[] = [];
  try {
    const staged = await execFileAsync('git', ['diff', '--cached'], {
      cwd,
      maxBuffer: MAX_DIFF_BYTES,
      encoding: 'utf8',
    });
    if (staged.stdout.trim()) {
      parts.push('## Staged\n' + staged.stdout.trimEnd());
    }
  } catch {
    // not a git repo or no staged changes
  }
  try {
    const unstaged = await execFileAsync('git', ['diff'], {
      cwd,
      maxBuffer: MAX_DIFF_BYTES,
      encoding: 'utf8',
    });
    if (unstaged.stdout.trim()) {
      parts.push('## Unstaged\n' + unstaged.stdout.trimEnd());
    }
  } catch {
    // ignore
  }
  if (parts.length === 0) {
    return '(no staged or unstaged changes)';
  }
  const combined = parts.join('\n\n');
  return truncateText(combined, MAX_DIFF_BYTES).text;
}

function buildFolderTree(
  entries: Array<{ path: string; isDirectory: boolean }>,
  folderPath: string,
  maxDepth: number,
): string[] {
  const prefix = folderPath ? folderPath.replace(/\/$/, '') + '/' : '';
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue;
    const rest = entry.path.slice(prefix.length);
    if (!rest) continue;
    const depth = rest.split('/').length;
    if (depth > maxDepth) continue;
    const line = entry.isDirectory ? `${entry.path}/` : entry.path;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= MAX_FOLDER_ENTRIES) break;
  }

  return lines.sort();
}

export function registerWorkspaceRoutes(app: Express) {
  app.get('/functions/v1/workspace/read', async (req: Request, res: Response) => {
    try {
      const rootPath = req.query.root as string;
      const filePath = req.query.file as string;
      if (!rootPath || !filePath) {
        return sendJson(res, 400, { error: 'Missing required query params: root, file' });
      }

      const absolute = await resolveUnderRoot(rootPath, filePath);
      if (!absolute) {
        return sendJson(res, 403, { error: 'Path is outside an attached git workspace' });
      }

      const info = await stat(absolute);
      if (!info.isFile()) {
        return sendJson(res, 400, { error: 'Path is not a file' });
      }

      const raw = await readFile(absolute, 'utf8');
      const { text, truncated } = truncateText(raw, MAX_FILE_BYTES);
      sendJson(res, 200, { content: text, truncated, bytes: Buffer.byteLength(text, 'utf8') });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to read file';
      sendJson(res, 500, { error: message });
    }
  });

  app.get('/functions/v1/workspace/diff', async (req: Request, res: Response) => {
    try {
      const rootPath = req.query.root as string;
      if (!rootPath) {
        return sendJson(res, 400, { error: 'Missing required query param: root' });
      }

      const root = await resolveWorkspaceRoot(rootPath);
      if (!root) {
        return sendJson(res, 403, { error: 'Path is outside an attached git workspace' });
      }
      const diff = await runGitDiff(root);
      sendJson(res, 200, { diff });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to read git diff';
      sendJson(res, 500, { error: message });
    }
  });

  app.get('/functions/v1/workspace/list', async (req: Request, res: Response) => {
    try {
      const rootPath = req.query.root as string;
      const folder = (req.query.folder as string) || '';
      const depth = Math.min(parseInt(req.query.depth as string, 10) || MAX_FOLDER_DEPTH, 6);

      if (!rootPath) {
        return sendJson(res, 400, { error: 'Missing required query param: root' });
      }

      const normalizedFolder = folder.replace(/^\.?\//, '').replace(/\/$/, '');
      const root = await resolveWorkspaceRoot(rootPath);
      if (!root) {
        return sendJson(res, 403, { error: 'Path is outside an attached git workspace' });
      }
      if (normalizedFolder) {
        const requestedFolder = resolve(root, normalizedFolder);
        if (!isUnderRoot(root, requestedFolder)) {
          return sendJson(res, 403, { error: 'Path escapes workspace root' });
        }
      }

      const entries = await workspaceIndex.scan(root);
      const paths = buildFolderTree(entries, normalizedFolder, depth);
      sendJson(res, 200, { paths, total: paths.length });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to list folder';
      sendJson(res, 500, { error: message });
    }
  });

  app.get('/functions/v1/workspace/search', async (req: Request, res: Response) => {
    try {
      const rootPath = req.query.path as string;
      const query = req.query.q as string;
      // Clamp to [1, 200] — a negative limit would flow into slice(0, -5).
      const rawLimit = parseInt(req.query.limit as string, 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

      if (!rootPath || !query) {
        return sendJson(res, 400, { error: 'Missing required query params: path, q' });
      }

      const root = await resolveWorkspaceRoot(rootPath);
      if (!root) {
        return sendJson(res, 403, { error: 'Path is outside an attached git workspace' });
      }

      const entries = await workspaceIndex.scan(root);
      const results = workspaceIndex.search(query, entries, limit);

      sendJson(res, 200, { results, total: entries.length, cached: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to search workspace';
      sendJson(res, 500, { error: message });
    }
  });

  app.get('/functions/v1/fetch-url', async (req: Request, res: Response) => {
    try {
      const rawUrl = req.query.url as string;
      if (!rawUrl) {
        return sendJson(res, 400, { error: 'Missing required query param: url' });
      }

      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        return sendJson(res, 400, { error: 'Invalid URL' });
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return sendJson(res, 400, { error: 'Only http(s) URLs are supported' });
      }

      // SSRF guard: resolve the hostname up front and reject private/loopback/
      // link-local/reserved ranges. Follow redirects manually so every hop is
      // re-checked against the same blocklist (a public URL must not redirect
      // into the local network).
      const MAX_REDIRECTS = 3;
      let currentUrl = parsed;
      let response: Awaited<ReturnType<typeof fetch>> | null = null;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await assertUrlAllowed(currentUrl);

        const hopResponse = await fetch(currentUrl.toString(), {
          redirect: 'manual',
          signal: AbortSignal.timeout(FETCH_URL_TIMEOUT_MS),
          headers: { 'User-Agent': 'CloudChat/1.0 (+context-ref)' },
        });

        if (hopResponse.status >= 300 && hopResponse.status < 400) {
          const location = hopResponse.headers.get('location');
          if (!location) {
            response = hopResponse;
            break;
          }
          try {
            currentUrl = new URL(location, currentUrl);
          } catch {
            return sendJson(res, 400, { error: 'Invalid redirect location' });
          }
          continue;
        }

        response = hopResponse;
        break;
      }

      if (!response) {
        return sendJson(res, 400, { error: `Too many redirects (max ${MAX_REDIRECTS})` });
      }

      if (!response.ok) {
        return sendJson(res, 200, {
          url: currentUrl.toString(),
          fetched: false,
          note: `HTTP ${response.status} — use web tools to fetch this URL.`,
        });
      }

      const contentType = response.headers.get('content-type') || '';
      const raw = await response.text();
      const text = contentType.includes('html') ? stripHtml(raw) : raw;
      const { text: body, truncated } = truncateText(text, MAX_URL_BYTES);

      sendJson(res, 200, {
        url: currentUrl.toString(),
        fetched: true,
        content: body,
        truncated,
      });
    } catch (err: unknown) {
      if (err instanceof BlockedUrlError) {
        return sendJson(res, 400, { error: err.message });
      }
      const message = err instanceof Error ? err.message : 'Fetch failed';
      sendJson(res, 200, {
        url: req.query.url,
        fetched: false,
        note: `${message} — use web tools to fetch this URL.`,
      });
    }
  });
}
