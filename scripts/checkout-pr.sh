#!/usr/bin/env bash
# Fetch and check out a GitHub PR branch locally, then verify it builds.
# Referenced by the review-pr skills (.agents, .claude, .opencode) and the
# GitHub copilot instructions — keep this path working.
set -euo pipefail

PR_NUMBER="${1:-}"
if [[ -z "$PR_NUMBER" ]]; then
  echo "usage: scripts/checkout-pr.sh <pr-number>" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required (brew install gh)" >&2
  exit 1
fi

gh pr checkout "$PR_NUMBER"
echo "checked out PR #$PR_NUMBER — run: gh pr diff, npm run typecheck && npm run lint && npm test"
