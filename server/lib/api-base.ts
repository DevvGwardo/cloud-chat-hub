/**
 * Resolve the base URL of this process's own API server.
 *
 * The embedded Electron server binds an ephemeral port when :3001 is already
 * taken, and startServer() records the port it actually bound in
 * process.env.PORT. Reading it lazily — instead of capturing a const at module
 * load — means the orchestrator and team coordinator always target the real
 * server, never a hardcoded :3001 that may belong to an unrelated process.
 */
export function getApiBase(): string {
  return process.env.CLOUDCHAT_API_BASE || `http://localhost:${process.env.PORT || 3001}`;
}
