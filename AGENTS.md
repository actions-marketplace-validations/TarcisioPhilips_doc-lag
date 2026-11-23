# AGENTS.md — doc-lag

Short orientation for coding agents working in **this** repository or setting up doc-lag in another project.

## If you are setting up doc-lag in the user’s repo

Follow **[docs/AGENT_SETUP.md](docs/AGENT_SETUP.md)** end-to-end.

One-liner the human can paste:

```text
Set up doc-lag in this repo following https://github.com/TarcisioPhilips/doc-lag/blob/main/docs/AGENT_SETUP.md
```

Consumer commands (npm package `doc-lag`, **0.3.0**):

```bash
npx doc-lag scan --base main
npx -y doc-lag mcp
# bin inside package doc-lag (not a separate npm package):
npx -y -p doc-lag doc-lag-mcp
```

Docs in scope by default: root `README`/`AGENTS`/`CLAUDE`/`CONTRIBUTING`, `docs/**`, common site/monorepo paths, `.md` + `.mdx`. Configure with `doc-lag.config.json` or `--docs-include` / `--docs-exclude`. Planned: OpenAPI/Swagger and reStructuredText support.

Optional docs-sync (`docs.missing`): off by default; enable with `docsSync` in config or `--docs-sync` / Action `docs-sync` / MCP `docs_sync`. Pairing rules plus detectors for Action inputs/outputs, package bins, CLI flags/commands (commander/argparse/click), MCP tools, and opt-in `env.added` / `cli.argv` (hand-rolled argv). Common English names need structured doc mentions (inline code, table, or YAML key). Skip with commit trailer `Docs-Not-Needed: <reason>` or the `no-docs-needed` PR label (Action reads labels from the event; use `labeled`/`unlabeled` workflow types). Agents: prefer `scan_diff` with `docs_sync: true` before finishing and follow the Action items block.

**This repo dogfoods docs-sync** via root `doc-lag.config.json` (`enforce: false`; CI Dogfood uses `fail-on: none`). Legitimate skips: `Docs-Not-Needed: <reason>` trailer or `no-docs-needed` PR label (owner-managed). JSON Schema: `schema/doc-lag.config.schema.json`.

Safety: read-only by default; no secrets in git; do **not** enable `--rank jev` / `rank: jev` unless the user asks (requires `TYPESAFE_API_KEY`; sends diff/doc excerpts to a third party).

## If you are developing doc-lag itself

```bash
npm install
npm test
npm run build
node dist/cli.js scan --base main --head HEAD
npm run mcp
```

Node.js 20+. Details: [README](README.md), [PROJECT_SPEC.md](PROJECT_SPEC.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development workflow

Tool-agnostic process for humans and coding agents (Cursor, Claude Code, Codex, Grok, etc.). Follow this for every non-trivial change.

1. **Spec first (local only)** — Before coding a non-trivial feature, write a short spec/plan under **`.plans/`** (gitignored; never commit). Do **not** put implementation plans in `docs/` — that tree is user-facing documentation only. Specs should cover: how it works end-to-end; numbered testable functional requirements; non-functional requirements; config / CLI / Action / MCP changes; edge cases and out-of-scope; open questions with a proposed default; acceptance checklist. Implement against that local spec.
2. **Plan in small tasks** — Break the work into ordered, reviewable steps before writing code. Prefer shipping one step at a time. Keep full plans in `.plans/`; PR descriptions get only a short summary (never paste the whole spec).
3. **Tests with behavior** — Add or update tests for every behavior change. Prefer test-first when practical. Use temp git fixtures for end-to-end scan cases and named edge-case fixtures (false positives, path layouts, config overrides).
4. **One focused PR per step** — Branch off `main`, keep the diff scoped, use a conventional PR description with a **Test plan** checklist (summary + checklist only). Delete the branch after merge. Do not pile unrelated steps into one PR.
5. **Keep docs in sync** — Update `README.md`, `AGENTS.md`, `docs/AGENT_SETUP.md`, `llms.txt`, and `CHANGELOG.md` (**Unreleased**) whenever user-facing behavior or setup changes. Dogfood: run doc-lag on its own PRs (CI Dogfood job with `docsSync` from `doc-lag.config.json` / local `scan --base main`).
6. **Safety invariants** — Core scan stays deterministic, read-only, and offline (no network). Never commit secrets; gitleaks runs in CI. Optional `--rank jev` is opt-in only and never the default.
7. **No release from feature PRs** — Do not bump `package.json` version or publish to npm. The maintainer cuts releases.

Local gate before push: `npm test && npm run build`.
