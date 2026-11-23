# doc-lag

[![npm](https://img.shields.io/npm/v/doc-lag.svg)](https://www.npmjs.com/package/doc-lag)
[![CI](https://github.com/TarcisioPhilips/doc-lag/actions/workflows/ci.yml/badge.svg)](https://github.com/TarcisioPhilips/doc-lag/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Your code changed. Did your docs keep up?**

doc-lag scans a Git range and reports documentation that this change made stale —
with evidence, not guesses. Use it from the CLI, a GitHub Action, or an MCP server
for coding agents.

```text
scripts.missing:README.md:42:deploy:preview  CONFIRMED  README.md:42
`npm run deploy:preview` is documented but no longer exists in package.json scripts.
Evidence: package.json#scripts
  base: "deploy:preview" was present
  head: "deploy:preview" is absent
Suggested action: Update the documented command or restore the script.
```

It catches removed/renamed `package.json` scripts still documented as `npm`/`pnpm`/`yarn`/`bun`
commands, local Markdown links and paths broken by the diff, and env keys removed from
committed example files (`.env.example` and similar) that docs still mention.

### What counts as documentation

By default doc-lag scans these paths at `head` (`.md` and `.mdx`):

| Included | Examples |
| --- | --- |
| Root canonical docs | `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` |
| Docs trees | `docs/**`, `documentation/**`, `content/**` |
| Site / app docs | `website/docs/**`, `website/src/pages/**`, `apps/docs/**` |
| Monorepo package docs | `packages/*/README.md`, `packages/*/docs/**`, `apps/*/README.md` |

Excluded by default: `node_modules`, `.git`, `dist`, `build`, `.next`, `out`, `coverage`,
`vendor`, `.venv`, `site`, `_site`, plus `CHANGELOG.md` / `LICENSE.md`.

Configure with `doc-lag.config.json` (`docs.include` / `docs.exclude`), or CLI
`--docs-include` / `--docs-exclude`, Action `docs-include` / `docs-exclude`, MCP
`docs_include` / `docs_exclude`.

Planned: OpenAPI/Swagger and reStructuredText support.

MDX is prepared heuristically (frontmatter, `import`/`export`, JSX) so JSX/imports
do not create false-positive findings; line numbers still refer to the original file.

![Terminal demo: after renaming API_TIMEOUT to REQUEST_TIMEOUT in .env.example, npx doc-lag scan reports a confirmed env.stale finding at docs/setup.md:3 with evidence and a rename suggestion](docs/demo/doc-lag-demo.gif)

---

## Quickstart (~1 minute)

Requires **Node.js 20+** and Git.

### CLI

```bash
# one-shot (no install)
npx doc-lag scan --base main

# or install globally
npm install -g doc-lag
doc-lag scan --base main --head HEAD
```

`--head` defaults to `HEAD`. Add `--format json` or `--format sarif` for machines; `--fail-on none` for advisory runs.

### GitHub Action

```yaml
# .github/workflows/doc-lag.yml
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

Include `labeled` / `unlabeled` so adding the `no-docs-needed` label re-runs the check.

### MCP (coding agents)

Prefer the subcommand (there is no separate `doc-lag-mcp` package on npm):

```bash
npx -y doc-lag mcp
# same bin, via the doc-lag package:
npx -y -p doc-lag doc-lag-mcp
# or after: npm install -g doc-lag
doc-lag-mcp
```

**Cursor** — `.cursor/mcp.json`:

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

**Claude Code:**

```bash
claude mcp add doc-lag -- npx -y doc-lag mcp
```

Or commit a project `.mcp.json` with the same `mcpServers` shape.

**VS Code / Copilot** — `.vscode/mcp.json`:

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

**Codex** — `.codex/config.toml` (project) or `~/.codex/config.toml`:

```toml
[mcp_servers.doc-lag]
command = "npx"
args = ["-y", "doc-lag", "mcp"]
```

---

## Set it up with your coding agent

Paste this prompt into Claude Code, Cursor, Codex, or VS Code Copilot:

````text
Set up doc-lag in this repository following
https://github.com/TarcisioPhilips/doc-lag/blob/main/docs/AGENT_SETUP.md

Constraints:
- Read-only setup: do not rewrite application docs unless I ask.
- Do not commit secrets or API keys.
- Add `.github/workflows/doc-lag.yml` with contents: read, pull-requests: write,
  actions/checkout@v4 with fetch-depth: 0, and uses: TarcisioPhilips/doc-lag@v0.
- Optionally register the MCP server for the tool I am using (Cursor `.cursor/mcp.json`,
  Claude Code `claude mcp add` / `.mcp.json`, VS Code `.vscode/mcp.json`,
  Codex `.codex/config.toml`) using `npx -y doc-lag mcp`.
- Do not enable Jev ranking (`--rank jev` / `rank: jev`) unless I explicitly ask.
- Run `npx doc-lag scan --base <default-branch>` (or merge-base) once and report findings.
````

One-liner for your agent:

```text
Set up doc-lag in this repo following https://github.com/TarcisioPhilips/doc-lag/blob/main/docs/AGENT_SETUP.md
```

Machine-readable copies: [`docs/AGENT_SETUP.md`](docs/AGENT_SETUP.md), [`AGENTS.md`](AGENTS.md), [`llms.txt`](llms.txt).

---

## How it works

The scan is **PR-aware**: it reports documentation references invalidated by
*this* `base..head` diff. A leftover command that was already stale before the
change is not reported. That keeps the signal focused on the review at hand.

### Rules

| Rule | Confirmed | Needs-review |
| --- | --- | --- |
| `scripts.missing` | Documented `npm`/`pnpm`/`yarn`/`bun` script invocations removed or renamed in `package.json` | — |
| `links.broken` | Markdown / image links to files deleted or renamed in the diff | Inline `` `path/like` `` heuristics |
| `env.stale` | Code-block / inline-code env keys removed from `.env.example` (and similar) | Bare keys in Markdown table cells |

Documentation in scope: see [What counts as documentation](#what-counts-as-documentation) (Markdown + MDX; configurable globs).

**confirmed** findings fail CI by default (`--fail-on confirmed`). **needs-review** findings are advisory and do not fail that threshold.

Default scan is offline: no signup, no API keys. The GitHub Action may call the
GitHub API only to create/update the sticky PR comment. The tool never executes
commands found in documentation.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `--base <ref>` | required | Base Git ref |
| `--head <ref>` | `HEAD` | Head Git ref |
| `--format <text\|json\|sarif>` | `text` | Output format |
| `--fail-on <confirmed\|none>` | `confirmed` | CI threshold |
| `--rank <none\|jev>` | `none` | Optional semantic ranking (**since 0.3.0**) |
| `--cwd <path>` | current directory | Repository to scan |
| `--config <path>` | auto-discover | `doc-lag.config.json` or `.doc-lag.json` |
| `--docs-include <glob>` | built-in includes | Repeatable; replaces include when set |
| `--docs-exclude <glob>` | built-in excludes | Repeatable; replaces exclude when set |
| `--docs-sync` / `--no-docs-sync` | off | Force-enable/disable the docs-sync check (**since 0.4.0**) |
| `--docs-sync-enforce` | off | Fail on `docs.missing` under `--fail-on confirmed` (implies `--docs-sync`) (**since 0.4.0**) |

`DOC_LAG_RANK=jev` is equivalent to `--rank jev` when the flag is omitted (**since 0.3.0**).  
`DOC_LAG_CONFIG=<path>` is equivalent to `--config` when the flag is omitted.  
`DOC_LAG_DOCS_SYNC=true|false` and `DOC_LAG_DOCS_SYNC_ENFORCE=true|false` match the docs-sync flags when omitted (**since 0.4.0**).

Example `doc-lag.config.json` (docs discovery + optional docs-sync):

```json
{
  "$schema": "./schema/doc-lag.config.schema.json",
  "docs": {
    "include": ["README.md", "docs/**/*.{md,mdx}", "packages/*/README.md"],
    "exclude": ["**/node_modules/**", "**/CHANGELOG.md"]
  },
  "docsSync": {
    "enforce": false,
    "rules": [
      { "name": "cli", "code": ["src/cli/**"], "docs": ["README.md", "docs/**"] }
    ]
  }
}
```

Point `$schema` at [`schema/doc-lag.config.schema.json`](schema/doc-lag.config.schema.json) for editor autocomplete.

### Missing docs check (`docs.missing`) *(since 0.4.0)*

Besides stale references, doc-lag can flag **missing** documentation: a PR that
adds a public surface (CLI flag, Action input, MCP tool, …) or changes paired
code paths without updating the docs that should describe them.

**Off by default.** Enable with a `docsSync` object in config, CLI `--docs-sync`,
Action `docs-sync: true`, MCP `docs_sync: true`, or `DOC_LAG_DOCS_SYNC=true`.

Mentions in docs include inline code, markdown tables, fenced YAML/`with:` keys,
and bold list items such as `- **tool_name**` (MCP tools and Action inputs/outputs).

When enabled it can report:

| Kind | What triggers a finding |
| --- | --- |
| Pairing rules | Code matching `docsSync.rules[].code` changed without a meaningful update under `docs` |
| `action.input` / `action.output` | New keys in `action.yml` not mentioned in docs |
| `package.bin` (and opt-in `package.exports`) | New bin / exports subpaths not mentioned |
| `cli.flag` / `cli.command` | New commander / argparse / click flags or commands not mentioned |
| `cli.argv` (opt-in) | New hand-rolled `process.argv` / `sys.argv` long flags not mentioned (**since 0.4.0**) |
| `mcp.tool` | New MCP tools not mentioned |
| `env.added` (opt-in) | New keys in `.env.example`-family files not mentioned |

Common English surface names (e.g. Action input `archive`) must appear in a
**structured** doc context — inline code, a markdown table cell, bold
(`**archive**`), or a fenced YAML/`with:` key — not only in headings or bare
prose.

Findings are `needs-review` with optional `surface` metadata. They do **not** fail
`--fail-on confirmed` unless you set `docsSync.enforce: true` / `--docs-sync-enforce`
/ Action `docs-sync-enforce: true`.

**Skip legitimately:**

- Commit trailer: `Docs-Not-Needed: <reason>` (skips the whole check for that range)
- PR label: `no-docs-needed` (Action; labels from the event payload — subscribe to
  `labeled` / `unlabeled` so adding/removing the label re-runs the job)
- Config: `ignoreSymbols` / `ignore` for known-undocumented surfaces or paths

See [What counts as documentation](#what-counts-as-documentation) for which files
count as mentions. This repo dogfoods docs-sync via root `doc-lag.config.json`
with `enforce: false` (advisory Dogfood CI job).

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No blocking findings (or `--fail-on none`) |
| 1 | At least one finding at the configured threshold |
| 2 | Usage, configuration, or execution error (including an invalid Git ref) |

Findings go to stdout; errors to stderr.

### Rule limitations

**`links.broken`** does not report pre-existing broken links, external URLs
(`http://`, `https://`, `mailto:`, …), or missing in-file anchors (file existence
only). Renames detected by Git include the new path as a suggested fix.

**`env.stale`** only reads committed example files (`.env.example`, `.env.sample`,
`.env.template`, and similar) via Git at the given refs — never real `.env`
files. Freeform prose without an extractable key is ignored. A 1:1 remove/add
in the same example file yields a rename hint.

### What this will *not* do

- Automatically rewrite docs
- Decide whether freeform prose is semantically correct
- Upload repo contents to AI services **unless you opt into `--rank jev`**
- Require MCP, Jev, or another external model (default remains local)
- Execute, install, or evaluate commands mentioned in the scanned repository

---

## Optional: Jev ranking *(since 0.3.0)*

By default doc-lag stays offline. When a PR produces many **needs-review**
findings, optional **[Jev](https://docs.typesafe.ai)** ranking (TypeSafe AI’s
non-generative System One model) puts the ones that matter first and sinks likely
false alarms. Ranking **never** changes a finding’s `status` and never upgrades
anything to `confirmed` — order and evidence only. `docs.missing` findings are
excluded from Jev candidates (deterministic order; never sent to the API).

**When to enable:** large PRs with a noisy needs-review list (especially
`env.stale` table cells or heuristic path mentions). Skip it for small PRs or when
you want a fully offline CI job.

**Example:** three `env.stale` needs-review hits after removing billing/SMTP keys.
Without ranking, a glossary table that merely mentions `LEGACY_TOKEN` sits mixed
in with real config docs. With `--rank jev`, billing/SMTP docs surface first
(~0.96 / ~0.91 confidence) and the glossary mention drops last (~0.22).

**Benchmark** (43 public PRs from 13 open-source projects; evaluation only — not
an endorsement of those projects, TypeSafe, or Jev):

| Ranker | nDCG@3 | P@2 |
| --- | ---: | ---: |
| Jev (`score`) | 0.86 | 0.96 |
| Path overlap | 0.73 | 0.88 |
| BM25 | 0.62 | 0.72 |

Rough cost on that set: ~US$0.007 total and ~0.4s per case.

**Privacy:** when ranking is enabled, PR diff summaries and documentation excerpts
are sent to `https://api.typesafe.ai`. The key is read only from
`TYPESAFE_API_KEY` and is never logged. Missing key → clear error (exit 2).
Timeouts, 4xx/5xx, and rate limits fall back to deterministic order with a warning.

### Setup (CLI / Action / MCP)

```bash
export TYPESAFE_API_KEY="your-key"   # https://console.typesafe.ai
npx doc-lag scan --base main --head HEAD --rank jev
```

```yaml
- uses: TarcisioPhilips/doc-lag@v0
  with:
    fail-on: confirmed
    rank: jev
  env:
    TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
```

```json
{
  "name": "scan_diff",
  "arguments": {
    "base": "main",
    "head": "HEAD",
    "rank": "jev"
  }
}
```

---

## GitHub Action details

On `pull_request`, the Action scans `base.sha..head.sha`, writes a job summary,
and posts or updates a single sticky PR comment. Fork PRs without comment
permission still get the job summary; the step does not fail for that reason.

Subscribe to `types: [opened, synchronize, reopened, labeled, unlabeled]` so the
`no-docs-needed` label skip re-runs when labels change. Labels are read from the
event payload (no extra API call).

**Inputs:** `fail-on`, `comment`, `working-directory`, `sarif`, `rank` (**since 0.3.0**),
optional `base` / `head` overrides, `config` / `docs-include` / `docs-exclude`,
`docs-sync` / `docs-sync-enforce` / `docs-sync-skip-labels` (empty = use config;
**since 0.4.0**).  
**Outputs:** `findings-count`, `confirmed-count`, `needs-review-count`,
`docs-missing-count` (**since 0.4.0**), `report-path`, `sarif-path`.

With `comment: true` (default), zero findings still upsert the sticky comment
(“No documentation drift findings…”) so it is obvious the scan ran. Re-runs
match `<!-- doc-lag-sticky -->` instead of posting duplicates. When docs-sync
findings exist, the comment/summary include a **Missing documentation** section
(not repeated under Needs review).

The Action is a **composite action that installs and builds from source** in
`${{ github.action_path }}` (locked by `package-lock.json`). Pin a tag or SHA for
reproducibility.

Optional SARIF upload:

```yaml
      - name: doc-lag
        id: doc-lag
        uses: TarcisioPhilips/doc-lag@v0
        with:
          sarif: true

      - if: steps.doc-lag.outputs.sarif-path != ''
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: ${{ steps.doc-lag.outputs.sarif-path }}
          category: doc-lag
```

(`security-events: write` required for the upload step.)

### MCP tools

All tools are annotated read-only; paths are constrained to the workspace.

| Tool | Purpose |
| --- | --- |
| `scan_diff` | Scan `base..head` (defaults: merge-base with main → `HEAD`). Set `include_working_tree: true` for uncommitted edits. Optional `rank: "jev"` (**since 0.3.0**). Optional `docs_sync` / `docs_sync_enforce` for `docs.missing` (**since 0.4.0**; Action items text when findings exist). |
| `explain_finding` | Re-scan and return one finding by stable id (including `docs.missing` **since 0.4.0**) with full evidence. |
| `list_rules` | List `scripts.missing`, `links.broken`, `env.stale`, `docs.missing` (**since 0.4.0**), plus docs-sync detectors. |

---

## Why this is different

doc-lag focuses on **PR-specific change-to-document traceability** (this diff →
these evidence-backed doc hits), not broad repository linting or age-based
“docs older than code” heuristics. Competitive notes:
[`docs/validation.md`](docs/validation.md), [`PROJECT_SPEC.md`](PROJECT_SPEC.md),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Roadmap

1. Local read-only deterministic CLI (scripts, links, and env rules) — shipped.
2. GitHub Action + optional SARIF — shipped.
3. Agent-facing MCP (`doc-lag mcp`; bin `doc-lag-mcp` inside the `doc-lag` package) — shipped on npm.
4. Optional semantic ranking with Jev (`--rank jev`) — shipped in **0.3.0**.
5. GitHub Pages only after initial developer adoption.

## Contributing / development

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and the **Development workflow** in [`AGENTS.md`](AGENTS.md) (spec → plan → tests → focused PRs; same process for humans and agents).

From a clone (Node 20+):

```bash
npm install
npm test
npm run build

# scan with the built CLI
node dist/cli.js scan --base main --head HEAD

# or without a build step
npx tsx src/cli.ts scan --base main --head HEAD
npm run scan -- --base main --head HEAD
npm run mcp
```

Test fixtures are created in a temporary Git repository at runtime (`npm test`).
Issues and PRs welcome.

## License

MIT — see [LICENSE](LICENSE).
