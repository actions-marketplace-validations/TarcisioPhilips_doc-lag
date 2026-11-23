# Agent setup guide for doc-lag

Machine-friendly instructions for coding agents (Claude Code, Cursor, Codex, VS Code Copilot).
Humans: see the [README quickstart](../README.md#quickstart-1-minute).

**Package:** [`doc-lag`](https://www.npmjs.com/package/doc-lag) on npm (**0.4.0**).  
**Repo:** https://github.com/TarcisioPhilips/doc-lag  
**Requires:** Node.js 20+, Git.

---

## Goal

Wire doc-lag into the user’s repository so that:

1. Pull requests get an automated documentation-drift scan.
2. (Optional) The user’s coding agent can call the read-only MCP server.
3. A first local scan is run and findings are reported.

## Safety rules (always)

- **Read-only by default.** Do not rewrite application documentation unless the user asks.
- **No secrets.** Never commit API keys, tokens, or `.env` files. Do not enable Jev ranking unless the user explicitly asks (Jev needs `TYPESAFE_API_KEY` and sends diff/doc excerpts to a third party).
- **No from-source build required for consumers.** Prefer `npx doc-lag` / `npx -y doc-lag mcp` from npm. Building this repo is only for contributing to doc-lag itself.
- Prefer **advisory** first runs (`--fail-on none`) when reporting; leave the Action at `fail-on: confirmed` unless the user wants otherwise.

---

## Step 1 — Detect the project

1. Confirm the workspace is a Git repository.
2. Detect the default branch (`main` or `master`; fall back to `git symbolic-ref refs/remotes/origin/HEAD`).
3. Confirm Node.js ≥ 20 is available (`node -v`).
4. Note whether `.github/workflows/` already exists.

---

## Step 2 — Add the GitHub Action workflow

Create `.github/workflows/doc-lag.yml` (skip or merge if an equivalent workflow already exists):

```yaml
name: doc-lag

on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]

permissions:
  contents: read
  pull-requests: write

jobs:
  doc-lag:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: doc-lag
        uses: TarcisioPhilips/doc-lag@v0
        with:
          fail-on: confirmed
```

**Required details:**

| Detail | Value |
| --- | --- |
| Permissions | `contents: read`, `pull-requests: write` |
| Checkout | `actions/checkout@v4` with **`fetch-depth: 0`** (full history for the base..head range) |
| Action | `TarcisioPhilips/doc-lag@v0` (or pin a commit SHA) |
| `pull_request` types | Include `labeled` / `unlabeled` so the `no-docs-needed` skip re-runs when labels change |

Do **not** set `rank: jev` or `TYPESAFE_API_KEY` unless the user asked for Jev.

Optional later: `sarif: true` plus `github/codeql-action/upload-sarif` (needs `security-events: write`).

---

## Step 3 — Optionally register the MCP server

Prefer the published npm entrypoints (verified). There is **no** npm package named `doc-lag-mcp` — `npx doc-lag-mcp` 404s. The `doc-lag-mcp` binary is shipped **inside** package `doc-lag`:

```bash
npx -y doc-lag mcp
# same bin via the doc-lag package:
npx -y -p doc-lag doc-lag-mcp
# or after: npm install -g doc-lag
doc-lag-mcp
```

Package bins: `bin.doc-lag` → `dist/cli.js`, `bin.doc-lag-mcp` → `dist/mcp/main.js`.

Pick the config that matches the host tool. Do not invent alternate package names.

### Cursor

Create or merge `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "doc-lag": {
      "command": "npx",
      "args": ["-y", "doc-lag", "mcp"]
    }
  }
}
```

Project file: `.cursor/mcp.json`. User-global alternative: `~/.cursor/mcp.json`.

### Claude Code

```bash
claude mcp add doc-lag -- npx -y doc-lag mcp
```

Or commit project-scoped `.mcp.json`:

```json
{
  "mcpServers": {
    "doc-lag": {
      "command": "npx",
      "args": ["-y", "doc-lag", "mcp"]
    }
  }
}
```

### VS Code / Copilot

Create or merge `.vscode/mcp.json`:

```json
{
  "servers": {
    "doc-lag": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "doc-lag", "mcp"]
    }
  }
}
```

Note the top-level key is **`servers`** (not `mcpServers`), and **`type": "stdio"`** is required for this format.

### Codex

Project: `.codex/config.toml` (loaded for trusted projects). User-global: `~/.codex/config.toml`.

```toml
[mcp_servers.doc-lag]
command = "npx"
args = ["-y", "doc-lag", "mcp"]
```

### MCP tools available

| Tool | Purpose |
| --- | --- |
| `scan_diff` | Scan a git range (default merge-base with main → `HEAD`). `include_working_tree: true` includes uncommitted edits. Optional `docs_sync` / `docs_sync_enforce` for the missing-docs check (**since 0.4.0**). |
| `explain_finding` | Re-scan and return one finding by stable id (including `docs.missing`). Same `docs_sync` params as `scan_diff` (**since 0.4.0**). |
| `list_rules` | List `scripts.missing`, `links.broken`, `env.stale`, `docs.missing`, plus docs-sync detectors (**since 0.4.0** for `docs.missing`). |

All tools are read-only. Do not pass `rank: "jev"` unless the user asked.

Before finishing agent work on a repo that uses docs-sync (or when you want the check), call `scan_diff` with `docs_sync: true`. When `docs.missing` findings exist, the tool text includes an **Action items for the agent** block — follow those lines (document the surface or skip with a `Docs-Not-Needed: <reason>` trailer) before considering the task done.

---

## Step 4 — Run a first scan and report

```bash
npx doc-lag scan --base <default-branch> --fail-on none
```

If the default branch ref is missing locally:

```bash
git fetch origin <default-branch>
npx doc-lag scan --base origin/<default-branch> --fail-on none
```

Or use MCP `scan_diff` with `include_working_tree: true` when the user has uncommitted edits.

**Report back:**

- Whether the workflow file was added/updated
- Whether MCP config was added (and which path)
- Scan range used (`base..head`)
- Finding counts (confirmed / needs-review) and a short summary of each confirmed finding
- Reminder that needs-review items are advisory under `--fail-on confirmed`

---

## CLI reference (consumer)

```bash
npx doc-lag scan --base <ref> [--head HEAD] [--format text|json|sarif] [--fail-on confirmed|none] [--rank none|jev] [--cwd <path>] [--config <path>] [--docs-include <glob>] [--docs-exclude <glob>] [--docs-sync] [--docs-sync-enforce]
```

| Exit | Meaning |
| --- | --- |
| 0 | No blocking findings (or `--fail-on none`) |
| 1 | Finding(s) at the configured threshold |
| 2 | Usage / config / execution error |

Optional ranking (`--rank jev`, Action `rank: jev`, MCP `rank: "jev"`) is available in **0.3.0+**. Only enable it when the user asks; it requires `TYPESAFE_API_KEY` and sends diff summaries + doc excerpts to `https://api.typesafe.ai`. Prefer `npx doc-lag` and Action `uses: TarcisioPhilips/doc-lag@v0`.

Optional docs discovery: `doc-lag.config.json`, `--docs-include` / `--docs-exclude`, Action `docs-include` / `docs-exclude`, MCP `docs_include` / `docs_exclude`. JSON Schema: `schema/doc-lag.config.schema.json`. See README **What counts as documentation**.

Optional docs-sync (`docs.missing`, **since 0.4.0**): off by default; enable with `docsSync` in config, CLI `--docs-sync`, Action `docs-sync`, or MCP `docs_sync: true`. Enforce with `--docs-sync-enforce` / `docs-sync-enforce` / `docs_sync_enforce`. Skip with commit trailer `Docs-Not-Needed: <reason>` or PR label `no-docs-needed` (Action; use `labeled`/`unlabeled` workflow types). Includes opt-in `cli.argv` for hand-rolled argv flags.

---

## What doc-lag checks

- **`scripts.missing`** — documented package-manager script invocations removed/renamed in `package.json`
- **`links.broken`** — local Markdown/image links (confirmed) or inline path heuristics (needs-review) broken by the diff
- **`env.stale`** — env keys removed from committed example files still mentioned in docs
- **`docs.missing`** (opt-in docs-sync) — new public surfaces or paired code changes without matching docs; see README **Missing docs check**

Docs scanned by default: root `README`/`AGENTS`/`CLAUDE`/`CONTRIBUTING`, `docs/**`, common site/monorepo paths — `.md` and `.mdx`. Not yet: OpenAPI, Sphinx `.rst`.  
Pre-existing drift (already wrong at `base`) is intentionally not reported.

---

## Do not

- Teach users to `npm install && npm run build` this repo just to scan their own project
- Commit `TYPESAFE_API_KEY` or enable Jev by default
- Change Action `fail-on` to `none` in the committed workflow unless the user wants advisory CI
- Claim endorsements of TypeSafe, Jev, or third-party projects
