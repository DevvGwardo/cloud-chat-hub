# Changelog

All notable changes to Spark are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Drive the real `hermes-agent` via the ACP transport; works on both supported ACP SDK versions and follows the hermes-desktop session model
- Expose CLI custom `base_url` providers without requiring an empty OpenRouter pin
- Hermes repo mode now auto-provisions a managed local checkout and always works on it when one is attached (hermes-desktop parity), keeping terminal/files build tools instead of GitHub-API-only tools

### Changed
- Relicensed from PolyForm Shield to MIT
- CI now runs the hermes-bridge Python test suite (327 tests) against a committed fake-agent fixture; previously only the JS suite and config-sync check ran

### Fixed
- CI runs the Release workflow on Node 22 so Windows `better-sqlite3` prebuilds resolve
- Cloudflared quick-tunnel auth bypass: requests with the public tunnel host in `X-Forwarded-Host` (Host rewritten to the local origin) now require the tunnel key
- Repo verifier path escape: verification file paths that escape the workspace (`..`, absolute paths, symlink traversal) are rejected
- Workspace context routes constrained to attached git checkouts — arbitrary filesystem roots (`root=/&file=etc/passwd` style) can no longer be read
- Hermes repo tool registry race: overlapping repo runs serialize registration/deregistration so one run can't call another run's repo/GitHub handlers
- hermes-bridge tests: httpx stub crash when `main` is imported fresh, process-global repo-tool registry lock leak in adapter tests, and brain-token patch targeting the wrong module namespace

## [1.0.0-beta.8] - 2026-07-20

### Added
- Hermes control plane aligned with Hermes 0.18+: runs parity, live subagents, and reasoning-effort support
- Live MCP dashboard with persisted telemetry and agent git-history tools
- Paste-to-attach images in chat, with inline rendering in user bubbles and HTTP image serving
- Spark landing page: persistent viewport frame and Lenis smooth scrolling

### Fixed
- Remote access: mobile UX overhaul, tunnel auth and config fixes, reliability and perf work; closed a tunnel key exposure to LAN clients
- MiniBrowser store now stays in sync with the Electron BrowserView
- CI: cleared TypeScript errors and lint failures from the Hermes alignment work

## [1.0.0-beta.7] - 2026-06-12

### Added
- Hermes effort slider, agent task panel, sidebar system/logs/pairing/webhooks panels, and background runs
- Authoritative scheduled-deployment archive with a deployment detail view
- Chat scroll-streaming, Hermes sessions, voice input, and Cursor composer bridge
- Landing page: sky-frame hero card, sticky hero, and light-theme redesign

### Changed
- Shared `chat-store` singleton with a conversation list index; improved hermes admin/profile/transcribe routes
- Hermes bridge: reasoning-effort passthrough, profile-aware provider listing, and credential-aware provider rerouting (deepseek-v4-flash routed via `credential_pool`)
- Full QA surface audit — chat/sidebar/layout fixes with an audit ledger

## [1.0.0-beta.6] - 2026-06-04

### Added
- Hermes panel features: session search filter, cron run-history summary, skill list filter, session status counts, usage budget level, and memories export to Markdown

### Changed
- Optimized resize performance for the Electron and web UI

## [1.0.0-beta.5] - 2026-06-03

### Changed
- Rebranded the app from CloudChat to Spark: strings, favicon, README, screenshots, and repo assets
- Hermes-first provider positioning: Hermes default with first-class ordering, agent-aware welcome, and a status pill
- New landing site: real Hermes-agent feature site with Spark logo and shadcn-dark theme; SEO (canonical, OG/Twitter, structured data, sitemap)

### Added
- Hermes Control v1 for mobile, and easiest-onboarding bridge startup for web/headless use
- 30-second agent-loop showcase and Spark × Hermes demo videos, with autoplay GIF previews in the README

## [1.0.0-beta.4] - 2026-05-29

### Added
- Kanban agent orchestrator with SQLite-backed persistence, live progress, status dropdowns, and multi-agent team dispatch
- Mobile Hermes control UI at `/m`, remote access via QR code + tunnel (cloudflared/localtunnel), room chat, swarm panel, and queue system
- Conversation management: color-coded tags, archive, import/export (JSON or Markdown), conversation tree overlay, SSE auto-reconnect, approval scopes (once/session/always), and Mermaid diagram rendering
- Structured pino logging with request-ID middleware; hardened Express headers, CSP, XSS/CSRF, and PAT protection; TypeScript strict mode; CI workflow
- Performance: React.lazy code splitting, memoized store selectors, and ErrorBoundary fallbacks
- Cross-platform build support: Intel macOS and Linux targets, Windows signing scaffold, cross-platform preinstall

## [1.0.0-beta.3] - 2026-04-16

### Fixed
- CI now pre-imports the Developer ID certificate into the keychain for `afterPack` signing

## [1.0.0-beta.2] - 2026-04-16

### Added
- macOS app signing and notarization via the App Store Connect API

## [1.0.0-beta.1] - 2026-04-16

### Added
- Initial public beta: desktop Electron app with a bundled Hermes bridge and beta distribution infrastructure
- Hermes agent profiles with context windows, decoupled from the local Hermes CLI, with provider/model sync on switch
- Expandable tool-call sections, conversation fork/rewind, predefined cron job templates, and a skills hub
- Electron updater, tray icon, and workspace-indexer fixes

[Unreleased]: https://github.com/DevvGwardo/spark/compare/v1.0.0-beta.8...HEAD
[1.0.0-beta.8]: https://github.com/DevvGwardo/spark/compare/v1.0.0-beta.7...v1.0.0-beta.8
[1.0.0-beta.7]: https://github.com/DevvGwardo/spark/compare/v1.0.0-beta.6...v1.0.0-beta.7
[1.0.0-beta.6]: https://github.com/DevvGwardo/spark/compare/v1.0.0-beta.5...v1.0.0-beta.6
[1.0.0-beta.5]: https://github.com/DevvGwardo/spark/compare/v1.0.0-beta.4...v1.0.0-beta.5
[1.0.0-beta.4]: https://github.com/DevvGwardo/spark/compare/v1.0.0-beta.3...v1.0.0-beta.4
[1.0.0-beta.3]: https://github.com/DevvGwardo/spark/compare/v1.0.0-beta.2...v1.0.0-beta.3
[1.0.0-beta.2]: https://github.com/DevvGwardo/spark/compare/v1.0.0-beta.1...v1.0.0-beta.2
[1.0.0-beta.1]: https://github.com/DevvGwardo/spark/releases/tag/v1.0.0-beta.1
