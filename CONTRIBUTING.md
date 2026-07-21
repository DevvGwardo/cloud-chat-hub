# Contributing to Spark

Thanks for wanting to help. Here's how to get involved.

## Reporting Issues

The fastest path is **inside the app**: click the "Report Issue" button (bottom-left of the chat panel). It pre-fills your version, OS, and the last error.

Or file directly: <https://github.com/DevvGwardo/spark/issues/new/choose>

Three templates:

| Template | When to use |
|----------|-------------|
| **Bug Report** | Something is broken or behaves unexpectedly |
| **Feature Request** | You wish Spark could do something it can't |
| **Beta Feedback** | Reactions, friction, half-formed thoughts — the catch-all |

## Submitting Pull Requests

1. Fork and clone
2. Create a branch: `git checkout -b your-name/short-description`
3. Make your changes (see Dev setup below)
4. Run checks: `npm run typecheck && npm run lint && npm test`
5. Commit and push, then open a PR

Keep PRs focused. One concern per PR is much easier to review than a grab-bag.

## Dev Setup

```bash
# 1. Install JS deps
npm install

# 2. Set up the Hermes bridge (required for Hermes Agent mode)
cd hermes-bridge
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..

# 3. Run everything
./start-all.sh
# OR for Electron dev with hot reload:
npm run electron:dev
```

This spawns three things: the Express API server (port 3001), the Hermes bridge (port 3002), and either the Vite dev server or Electron with hot reload.

### Manual startup (if you prefer separate terminals)

```bash
# Terminal 1: API server
npm run server

# Terminal 2: Hermes bridge
cd hermes-bridge && .venv/bin/python main.py

# Terminal 3: Frontend
npm run dev
```

## Code Style

- TypeScript everywhere on the frontend / Electron / server side
- Match existing style — don't reformat code you aren't touching
- Run `npm run lint` and `npm run typecheck` before pushing
- Keep diffs minimal. Don't "improve" adjacent code — surface those ideas in an issue instead

## Project Conventions

- **Zustand** for state management (not Redux, not Context for global state)
- **Tailwind CSS** with the design tokens in `src/lib/tokens.ts`
- **react-markdown** + **rehype** plugins for markdown rendering
- Tool call results are displayed inline in chat messages, not in separate panels
- Settings are stored in localStorage via Zustand persist, never in a backend

## License

Spark is licensed under the **MIT License** (see [LICENSE](LICENSE)). By contributing, you agree your contributions will be licensed the same way.
