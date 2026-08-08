import { spawn, type ChildProcess, execSync } from 'child_process';
import { createInterface } from 'readline';
import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

type TunnelProvider = 'cloudflared' | 'localtunnel';

interface TunnelState {
  running: boolean;
  url: string | null;
  provider: TunnelProvider | null;
  error: string | null;
  pid: number | null;
  /** Per-tunnel access token; requests via the tunnel hostname must present it. */
  accessToken: string | null;
}

let state: TunnelState = {
  running: false,
  url: null,
  provider: null,
  error: null,
  pid: null,
  accessToken: null,
};

let currentProcess: ChildProcess | null = null;

/** Check if cloudflared is on PATH. Uses execSync for proper env resolution. */
export function cloudflaredAvailable(): boolean {
  try {
    execSync('which cloudflared', { stdio: 'ignore', encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/** Check if brew is available. Uses execSync for proper env resolution. */
export function brewAvailable(): boolean {
  try {
    execSync('which brew', { stdio: 'ignore', encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/** Install cloudflared via brew. */
export function installCloudflared(): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    if (!brewAvailable()) {
      resolve({ ok: false, message: 'Homebrew not found. Install cloudflared manually: brew install cloudflared' });
      return;
    }
    const proc = spawn('brew', ['install', 'cloudflared'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: string[] = [];
    proc.stdout?.on('data', (c) => chunks.push(c.toString()));
    proc.stderr?.on('data', (c) => chunks.push(c.toString()));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, message: 'cloudflared installed successfully.' });
      } else {
        resolve({ ok: false, message: chunks.join('').slice(-200) || 'Install failed.' });
      }
    });
    proc.on('error', () => resolve({ ok: false, message: 'Failed to start brew install.' }));
  });
}

/**
 * Start a tunnel using available provider.
 * Tries cloudflared first, falls back to localtunnel.
 */
export function startTunnel(localPort: number): Promise<TunnelState> {
  return new Promise((resolve) => {
    if (state.running) {
      resolve(state);
      return;
    }

    const useCloudflared = cloudflaredAvailable();

    if (useCloudflared) {
      startCloudflaredTunnel(localPort, resolve);
    } else {
      startLocaltunnel(localPort, resolve);
    }
  });
}

/**
 * cloudflared silently merges ~/.cloudflared/config.yml into quick tunnels.
 * If that config defines named-tunnel ingress rules (with the mandatory
 * http_status:404 catch-all), every quick-tunnel request 404s instead of
 * reaching --url. Point --config at an empty file to isolate the quick tunnel.
 */
function emptyConfigPath(): string {
  const p = join(tmpdir(), 'spark-cloudflared-quick-tunnel.yml');
  try {
    writeFileSync(p, '');
  } catch {
    // fall back to default config resolution
  }
  return p;
}

function startCloudflaredTunnel(localPort: number, resolve: (s: TunnelState) => void) {
  const proc = spawn('cloudflared', ['tunnel', '--config', emptyConfigPath(), '--url', `http://localhost:${localPort}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group so killTunnel() can take down wrapper children too
    detached: process.platform !== 'win32',
  });
  currentProcess = proc;

  const rl = createInterface({ input: proc.stdout! });
  let resolved = false;

  rl.on('line', (line) => {
    // cloudflared outputs: "https://xxxx.trycloudflare.com"
    const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !resolved) {
      resolved = true;
      const url = match[0];
      state = { running: true, url, provider: 'cloudflared', error: null, pid: proc.pid ?? null, accessToken: randomBytes(16).toString('hex') };
      resolve({ ...state });
    }
  });

  proc.stderr?.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !resolved) {
      resolved = true;
      const url = match[0];
      state = { running: true, url, provider: 'cloudflared', error: null, pid: proc.pid ?? null, accessToken: randomBytes(16).toString('hex') };
      resolve({ ...state });
    }
  });

  proc.on('close', (code) => {
    if (currentProcess === proc) currentProcess = null;
    if (!resolved) {
      state = { running: false, url: null, provider: null, error: `cloudflared exited with code ${code}`, pid: null, accessToken: null };
      resolve({ ...state });
    } else {
      // Tunnel was live (or torn down via killTunnel/timeout) — clear the
      // state now that the process is really gone, preserving any error.
      state = { running: false, url: null, provider: null, error: state.error, pid: null, accessToken: null };
    }
  });

  proc.on('error', (err) => {
    if (currentProcess === proc) currentProcess = null;
    if (!resolved) {
      state = { running: false, url: null, provider: null, error: err.message, pid: null, accessToken: null };
      resolve({ ...state });
    }
  });

  // Timeout after 15s
  setTimeout(() => {
    if (!resolved) {
      resolved = true;
      state = { running: false, url: null, provider: null, error: 'cloudflared timed out (15s)', pid: null, accessToken: null };
      killTunnel();
      resolve({ ...state });
    }
  }, 15000);
}

function startLocaltunnel(localPort: number, resolve: (s: TunnelState) => void) {
  const proc = spawn('npx', ['--yes', 'localtunnel', '--port', String(localPort)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group so killTunnel() can take down the localtunnel
    // client child that npx spawns — SIGTERMing just npx orphans it.
    detached: process.platform !== 'win32',
  });
  currentProcess = proc;

  const rl = createInterface({ input: proc.stdout! });
  let resolved = false;

  rl.on('line', (line) => {
    // localtunnel outputs: "your url is: https://xxxx.loca.lt"
    const match = line.match(/https:\/\/[a-z0-9-]+\.loca\.lt/);
    if (match && !resolved) {
      resolved = true;
      const url = match[0];
      state = { running: true, url, provider: 'localtunnel', error: null, pid: proc.pid ?? null, accessToken: randomBytes(16).toString('hex') };
      resolve({ ...state });
    }
  });

  proc.stderr?.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.loca\.lt/);
    if (match && !resolved) {
      resolved = true;
      const url = match[0];
      state = { running: true, url, provider: 'localtunnel', error: null, pid: proc.pid ?? null, accessToken: randomBytes(16).toString('hex') };
      resolve({ ...state });
    }
  });

  proc.on('close', (code) => {
    if (currentProcess === proc) currentProcess = null;
    if (!resolved) {
      state = { running: false, url: null, provider: null, error: `localtunnel exited with code ${code}`, pid: null, accessToken: null };
      resolve({ ...state });
    } else {
      // Tunnel was live (or torn down via killTunnel/timeout) — clear the
      // state now that the process is really gone, preserving any error.
      state = { running: false, url: null, provider: null, error: state.error, pid: null, accessToken: null };
    }
  });

  proc.on('error', (err) => {
    if (currentProcess === proc) currentProcess = null;
    if (!resolved) {
      state = { running: false, url: null, provider: null, error: err.message, pid: null, accessToken: null };
      resolve({ ...state });
    }
  });

  // Timeout after 15s
  setTimeout(() => {
    if (!resolved) {
      resolved = true;
      state = { running: false, url: null, provider: null, error: 'localtunnel timed out (15s)', pid: null, accessToken: null };
      killTunnel();
      resolve({ ...state });
    }
  }, 15000);
}

/**
 * Stop the running tunnel. Kills the whole process group (the tunnel
 * processes are spawned detached) so wrapper children — e.g. the localtunnel
 * client spawned by npx — die too. SIGTERMing only the wrapper would orphan
 * the child and leave the tunnel accepting connections.
 *
 * currentProcess/state are NOT cleared here: they reset on the child's
 * 'close' event, so state.running stays true (and the access-token gate in
 * index.ts stays armed) until the tunnel is actually dead. Escalates to
 * SIGKILL if the group hasn't exited shortly after.
 */
export function killTunnel() {
  const proc = currentProcess;
  if (!proc?.pid) {
    // No tracked process — just clear any stale state.
    state = { running: false, url: null, provider: null, error: null, pid: null, accessToken: null };
    return;
  }
  try {
    // detached spawn → -pid targets the whole process group
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    // Group may already be gone — fall back to the process alone
    try { proc.kill('SIGTERM'); } catch { /* intentionally ignored */ }
  }
  const escalate = setTimeout(() => {
    if (currentProcess === proc) {
      const pid = proc.pid;
      if (!pid) return; // already exited — nothing to escalate
      try { process.kill(-pid, 'SIGKILL'); } catch { /* intentionally ignored */ }
    }
  }, 5000);
  escalate.unref?.();
}

/** Get current tunnel state. */
export function getTunnelState(): TunnelState {
  return { ...state };
}
