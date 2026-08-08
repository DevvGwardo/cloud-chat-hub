# Security Policy

## Supported Versions

Spark is pre-1.0. Security fixes land in the latest beta release — please upgrade to the newest `v1.0.0-beta.*` release to receive fixes.

| Version | Supported |
|---------|-----------|
| `1.0.0-beta.x` (latest) | ✅ |
| Older beta releases | ❌ |

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.** Use GitHub's private vulnerability reporting instead:

- **GitHub Security Advisories:** <https://github.com/DevvGwardo/spark/security/advisories/new>

When reporting, include as much of the following as you can:

- The affected version and platform (macOS / Windows / Linux)
- Steps to reproduce, or a minimal proof of concept
- The impact you observed and any mitigations you tried

You will receive an acknowledgement, and we will keep you updated as the report is triaged. If the issue is confirmed, a fix ships in the next beta release and the advisory is published once it is patched.

## Credentials and Secrets

Spark stores API keys and credentials locally in `~/.hermes/auth.json` (on Windows: `%USERPROFILE%\.hermes\auth.json`), managed via `hermes auth` or the settings UI. Treat this file like a password:

- Never commit `auth.json`, `.env`, or any credential files to the repository
- Never paste `~/.hermes/auth.json` contents into issues, pull requests, or chat messages
- If a bug report touches credentials, redact them first

If you believe credentials stored in `~/.hermes/auth.json` may have been exposed, rotate them at the provider and remove the file so Spark prompts for fresh ones.
