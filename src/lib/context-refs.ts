import { getApiBaseUrl } from '@/lib/api';
import { getRepoPathSuggestions, normalizeRepoPath } from '@/hooks/chat-utils';
import { estimateTokens } from '@/lib/tokens';

export type ContextRefKind = 'file' | 'folder' | 'diff' | 'url';

export interface ParsedContextRef {
  kind: ContextRefKind;
  /** Raw token as typed, e.g. `@file:src/foo.ts` */
  raw: string;
  /** Path or URL payload (empty for `@diff`) */
  value: string;
  start: number;
  end: number;
}

export interface ContextRefQuery {
  kind: ContextRefKind | 'picker';
  /** Partial path/url after the colon */
  query: string;
  /** Replace range in the composer text */
  replaceStart: number;
  replaceEnd: number;
}

export interface ExpandContextRefsOptions {
  workspaceRoot?: string | null;
  repoFileTree?: string[];
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  githubPat?: string;
}

export interface ExpandContextRefsResult {
  /** Message to send to the model (context block + user text) */
  expanded: string;
  /** Original user text unchanged */
  original: string;
  estimatedTokens: number;
  warnings: string[];
}

const CONTEXT_REF_RE = /@(file|folder|url):(\S+)|@diff\b/g;

const PICKER_ITEMS: Array<{ kind: ContextRefKind; label: string; insert: string; hint: string }> = [
  { kind: 'file', label: '@file:', insert: '@file:', hint: 'Include file contents' },
  { kind: 'folder', label: '@folder:', insert: '@folder:', hint: 'List folder tree' },
  { kind: 'diff', label: '@diff', insert: '@diff ', hint: 'Git diff (staged + unstaged)' },
  { kind: 'url', label: '@url:', insert: '@url:', hint: 'Fetch URL summary' },
];

export const CONTEXT_REF_PICKER_ITEMS = PICKER_ITEMS;

export function parseContextRefs(text: string): ParsedContextRef[] {
  const refs: ParsedContextRef[] = [];
  for (const match of text.matchAll(CONTEXT_REF_RE)) {
    const index = match.index ?? 0;
    const kind = (match[1] ?? 'diff') as ContextRefKind;
    const value = match[2] ?? '';
    refs.push({
      kind,
      raw: match[0],
      value,
      start: index,
      end: index + match[0].length,
    });
  }
  return refs;
}

export function hasContextRefs(text: string): boolean {
  return CONTEXT_REF_RE.test(text);
}

/**
 * Detect an in-progress context ref at the cursor for autocomplete.
 * Requires explicit prefixes to avoid colliding with room @mentions.
 */
export function detectContextRefQuery(text: string, cursorPos = text.length): ContextRefQuery | null {
  const before = text.slice(0, cursorPos);

  const typed = before.match(/@(file|folder|url):([^\s@]*)$/);
  if (typed) {
    return {
      kind: typed[1] as ContextRefKind,
      query: typed[2] ?? '',
      replaceStart: before.length - typed[0].length,
      replaceEnd: cursorPos,
    };
  }

  if (/@$/.test(before)) {
    return {
      kind: 'picker',
      query: '',
      replaceStart: cursorPos - 1,
      replaceEnd: cursorPos,
    };
  }

  return null;
}

export function filterPickerItems(query: string) {
  const q = query.toLowerCase();
  if (!q) return PICKER_ITEMS;
  return PICKER_ITEMS.filter(
    (item) =>
      item.kind.includes(q) ||
      item.label.toLowerCase().includes(q) ||
      item.hint.toLowerCase().includes(q),
  );
}

export function filterFileSuggestions(paths: string[], query: string, limit = 12): string[] {
  const q = normalizeRepoPath(query).toLowerCase();
  if (!q) {
    return paths.filter((p) => !p.endsWith('/')).slice(0, limit);
  }
  return getRepoPathSuggestions(paths, q, limit);
}

export function filterFolderSuggestions(paths: string[], query: string, limit = 12): string[] {
  const q = normalizeRepoPath(query).toLowerCase();
  const dirs = new Set<string>();
  for (const p of paths) {
    const segments = p.split('/');
    let acc = '';
    for (let i = 0; i < segments.length - 1; i++) {
      acc = acc ? `${acc}/${segments[i]}` : segments[i];
      dirs.add(acc);
    }
    if (p.endsWith('/')) dirs.add(p.replace(/\/$/, ''));
  }
  const all = [...dirs].sort();
  if (!q) return all.slice(0, limit);
  return all.filter((d) => d.toLowerCase().includes(q)).slice(0, limit);
}

function fenceLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rs: 'rust',
    go: 'go',
    json: 'json',
    md: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'bash',
    css: 'css',
    html: 'html',
  };
  return map[ext] ?? ext ?? '';
}

async function readWorkspaceFile(root: string, filePath: string): Promise<{ content: string; truncated?: boolean }> {
  const params = new URLSearchParams({ root, file: filePath });
  const res = await fetch(`${getApiBaseUrl()}/functions/v1/workspace/read?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Read failed (${res.status})`);
  }
  return { content: data.content ?? '', truncated: data.truncated };
}

async function readGithubFile(
  pat: string,
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
): Promise<string> {
  const res = await fetch(`${getApiBaseUrl()}/functions/v1/github-integration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'read-file',
      pat,
      owner,
      repo,
      path: filePath,
      ref: branch,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(typeof data.error === 'string' ? data.error : `GitHub read failed (${res.status})`);
  }
  return data.content ?? '';
}

async function listWorkspaceFolder(root: string, folder: string): Promise<string[]> {
  const params = new URLSearchParams({ root, folder });
  const res = await fetch(`${getApiBaseUrl()}/functions/v1/workspace/list?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `List failed (${res.status})`);
  }
  return data.paths ?? [];
}

async function fetchWorkspaceDiff(root: string): Promise<string> {
  const params = new URLSearchParams({ root });
  const res = await fetch(`${getApiBaseUrl()}/functions/v1/workspace/diff?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Diff failed (${res.status})`);
  }
  return data.diff ?? '';
}

async function fetchUrlSummary(url: string): Promise<{ body: string; fetched: boolean }> {
  const params = new URLSearchParams({ url });
  const res = await fetch(`${getApiBaseUrl()}/functions/v1/fetch-url?${params}`);
  const data = await res.json().catch(() => ({}));
  if (data.fetched && typeof data.content === 'string') {
    return { body: data.content, fetched: true };
  }
  const note = typeof data.note === 'string' ? data.note : 'URL not fetched — use web tools if needed.';
  return { body: note, fetched: false };
}

export async function searchWorkspaceFiles(
  root: string,
  query: string,
  limit = 12,
): Promise<string[]> {
  const params = new URLSearchParams({ path: root, q: query || '.', limit: String(limit) });
  const res = await fetch(`${getApiBaseUrl()}/functions/v1/workspace/search?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return [];
  const results = (data.results ?? []) as Array<{ path: string; isDirectory: boolean }>;
  return results.filter((r) => !r.isDirectory).map((r) => r.path).slice(0, limit);
}

function buildContextBlock(sections: string[]): string {
  if (sections.length === 0) return '';
  return ['<context>', ...sections, '</context>', ''].join('\n');
}

export async function expandContextRefs(
  text: string,
  options: ExpandContextRefsOptions = {},
): Promise<ExpandContextRefsResult> {
  const refs = parseContextRefs(text);
  const warnings: string[] = [];
  const sections: string[] = [];

  for (const ref of refs) {
    try {
      if (ref.kind === 'file') {
        const path = normalizeRepoPath(ref.value);
        let content = '';
        let truncated = false;
        if (options.workspaceRoot) {
          const result = await readWorkspaceFile(options.workspaceRoot, path);
          content = result.content;
          truncated = !!result.truncated;
        } else if (options.githubPat && options.repoOwner && options.repoName && options.repoBranch) {
          content = await readGithubFile(
            options.githubPat,
            options.repoOwner,
            options.repoName,
            options.repoBranch,
            path,
          );
          if (content.length > 51_200) {
            content = content.slice(0, 51_200) + '\n\n[Truncated]';
            truncated = true;
          }
        } else {
          warnings.push(`@file:${path} — no workspace or repo configured`);
          continue;
        }
        const lang = fenceLang(path);
        sections.push(
          `### File: \`${path}\`${truncated ? ' (truncated)' : ''}\n\`\`\`${lang}\n${content}\n\`\`\``,
        );
      } else if (ref.kind === 'folder') {
        const folder = normalizeRepoPath(ref.value);
        let paths: string[] = [];
        if (options.workspaceRoot) {
          paths = await listWorkspaceFolder(options.workspaceRoot, folder);
        } else if (options.repoFileTree?.length) {
          const prefix = folder ? `${folder}/` : '';
          paths = options.repoFileTree
            .filter((p) => p.startsWith(prefix))
            .slice(0, 200);
        } else {
          warnings.push(`@folder:${folder} — no workspace or repo tree available`);
          continue;
        }
        sections.push(
          `### Folder: \`${folder || '.'}\`\n${paths.length ? paths.map((p) => `- ${p}`).join('\n') : '(empty)'}`,
        );
      } else if (ref.kind === 'diff') {
        if (!options.workspaceRoot) {
          warnings.push('@diff — no local workspace path (clone or attach a local repo)');
          continue;
        }
        const diff = await fetchWorkspaceDiff(options.workspaceRoot);
        sections.push(`### Git diff\n\`\`\`diff\n${diff}\n\`\`\``);
      } else if (ref.kind === 'url') {
        const { body, fetched } = await fetchUrlSummary(ref.value);
        sections.push(
          fetched
            ? `### URL: ${ref.value}\n${body}`
            : `### URL: ${ref.value}\n> ${body}`,
        );
      }
    } catch (err) {
      warnings.push(`${ref.raw} — ${err instanceof Error ? err.message : 'expansion failed'}`);
    }
  }

  const contextBlock = buildContextBlock(sections);
  const expanded = contextBlock ? `${contextBlock}${text}` : text;
  return {
    expanded,
    original: text,
    estimatedTokens: estimateTokens(expanded),
    warnings,
  };
}

export function estimateContextRefTokens(text: string): number {
  return estimateTokens(text);
}
