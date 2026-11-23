# Contributing

Thanks for contributing to **doc-lag**.

**Process:** follow the **Development workflow** in [`AGENTS.md`](AGENTS.md) — same steps for humans and every coding agent (Cursor, Claude Code, Codex, Grok, etc.). It is tool-agnostic and not tied to any particular agent framework. Keep detailed plans outside the repository; PR descriptions get only a short summary (never paste the whole spec).

**Quick local loop** (Node.js 20+):

```bash
npm install
npm test
npm run build
node dist/cli.js scan --base main --head HEAD
```

Open a focused PR against `main` with a conventional description and a test plan. Do not bump the package version or publish; the maintainer releases.
