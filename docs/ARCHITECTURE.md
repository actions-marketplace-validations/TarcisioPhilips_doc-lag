# Architecture

doc-lag is a local, read-only, deterministic pipeline. It never executes
commands found in documentation, never installs packages from a scanned
repository, and never modifies that repository.

## Pipeline

```
git range (base..head)  [optional: ephemeral WORKING_TREE commit]
  → source extractors     (facts from changed manifests, env examples, path changes)
  → resolve docs config   (defaults ← doc-lag.config.json ← CLI/Action/MCP)
  → documentation discovery (Markdown + MDX globs; include/exclude)
  → prepare doc content   (frontmatter; MDX import/export/JSX neutralized)
  → documentation extractors (references: scripts, links, env vars)
  → rules                 (compare facts vs references)
  → optional docsSync     (when enabled: candidates → detectors → mention index
                           → pairing rules → docs.missing findings + report.docsSync)
  → finding normalizer    (stable IDs, deterministic sort)
  → optional Jev ranking  (--rank jev only: reorder needs-review/unknown; never change status;
                           docs.missing excluded from Jev candidates)
  → reporters + exit code (text / JSON / SARIF)
  → adapters: CLI · GitHub Action · MCP (stdio, read-only tools)
```

Orchestration lives in `src/core/scan.ts`. Git access is confined to
`src/core/git.ts`, which only runs `git` with argument arrays (no shell, and
never a command parsed from a README). Working-tree scans use a temporary
index + `commit-tree` snapshot (`src/core/working-tree.ts`) so the real index
and stash are untouched.

## Modules

| Area | Role |
| --- | --- |
| `src/core/git.ts` | Resolve refs, list trees, read files at a revision, diff paths |
| `src/core/docs.ts` | Decide which Markdown/MDX files are in scope (glob include/exclude) |
| `src/core/docs-config.ts` | Defaults, `doc-lag.config.json` load, precedence |
| `src/core/docs-sync-config.ts` | Docs-sync config types, defaults, validation, env overrides |
| `src/core/doc-content.ts` | Frontmatter + MDX preparation (line-preserving) |
| `src/docs-sync/` | Missing-docs engine: candidates, detectors, mention index, pairing rules |
| `src/extractors/package-scripts.ts` | Extract script changes from package.json at base/head |
| `src/extractors/markdown-scripts.ts` | Extract script invocations from Markdown |
| `src/extractors/markdown-links.ts` | Extract local links and inline code paths from Markdown |
| `src/extractors/path-changes.ts` | Extract deleted/renamed files from git diff |
| `src/extractors/env-example.ts` | Extract env key changes from committed `.env.example`-like files |
| `src/extractors/markdown-env.ts` | Extract env var references from Markdown |
| `src/rules/scripts-missing.ts` | Report documented scripts missing from package.json |
| `src/rules/links-broken.ts` | Report links to files deleted/renamed in the diff |
| `src/rules/env-vars-stale.ts` | Report documented env keys removed from example files |
| `src/findings/` | IDs, sorting, summary counts |
| `src/reporters/` | Text, JSON, and SARIF output, CI exit codes |
| `src/action/` | GitHub Action runner: inputs/outputs, sticky comment, job summary |
| `action.yml` | Composite Action entry (build-from-source) |
| `src/mcp/` | Read-only MCP server (stdio): `scan_diff`, `explain_finding`, `list_rules` |
| `src/ranking/` | Optional Jev semantic ranking (HTTP client, redaction, caps) |
| `src/core/scan-with-ranking.ts` | `scan()` plus opt-in ranking wrapper |
| `src/core/paths.ts` | Constrain tool paths to the workspace/repo root |
| `src/core/default-base.ts` | Default base = merge-base with main/master |
| `src/core/working-tree.ts` | Ephemeral working-tree commit for uncommitted scans |
| `src/cli.ts` | Commander interface (`scan`, `mcp`) |

## Adding a later rule

New rule families should follow the same contract so they slot in without
changing the CLI or report schema:

1. Add a source extractor in `src/extractors/` that reads a source of truth
   from git at `base` and `head` (for example, existing paths, or keys in
   `.env.example`).
2. Add a documentation extractor if the references live in Markdown (local
   links, `` `$VAR` `` mentions, and so on).
3. Add a rule in `src/rules/` that reports a finding **only** when the source
   fact changed in the diff *and* a documentation reference is now
   inconsistent. Untouched pre-existing drift stays silent — that is the
   PR-aware wedge.
4. Register the rule in `src/core/scan.ts`.
5. Cover it with a temp-dir git fixture in `tests/`.

Current rules:

- `scripts.missing` (RF-04): removed or renamed `package.json` scripts that
  documentation still invokes
- `links.broken` (RF-05): local Markdown links and file paths pointing to
  files deleted or renamed in the diff
- `env.stale` (RF-06): env keys removed or renamed in committed example files
  (`.env.example`, `.env.sample`, `.env.template`, …) that documentation still
  references. Never reads real `.env` files; only example files via git.
- `docs.missing` (opt-in): new public surfaces or pairing-rule mismatches; see
  **Docs-sync** below

## Docs-sync (optional `docs.missing`, since 0.4.0)

Off by default. When `docsSync` is enabled (config object, `--docs-sync`, Action
`docs-sync`, MCP `docs_sync`, or `DOC_LAG_DOCS_SYNC`), `src/docs-sync/` runs
after the classic rules:

1. **Skip gate** — disabled / PR label in `skipLabels` / `Docs-Not-Needed`
   trailer → `report.docsSync.status: "skipped"` (no findings).
2. **Effective base** — `git merge-base` of base/head (fallback: base + warning).
3. **Candidates** — changed non-doc files minus `docsSync.ignore` (defaults:
   scripts/examples/tests), generated markers, and hard code excludes
   (`node_modules` / `dist` / …).
4. **Detectors** — pure extractors per surface kind (`action.input`,
   `action.output`, `package.bin`, `package.exports`, `cli.flag`, `cli.command`,
   opt-in `cli.argv`, `mcp.tool`, opt-in `env.added`) at base and head; **new** =
   head − base by `(kind, name)`.
5. **Mention index** — tokenize in-scope docs once (via
   `prepareDocumentationContent`) into inline code, bold (`**name**` /
   `__name__`), fenced code, table cells, headings, and prose; each new surface
   must appear in an allowed context. Common English names additionally require
   a structured hit (inline code, table cell, bold, or fenced YAML/`with:` key),
   not heading/prose alone.
6. **Pairing rules** — configured `code`/`docs` globs; if code matched and no
   meaningful docs change → one finding per rule (per package when
   `perPackage`).
7. Cap at `maxFindings`; attach `finding.surface` / `finding.enforced` and
   `report.docsSync` metadata.

Detectors live under `src/docs-sync/detectors/`; the engine does not call the
network. Optional Jev ranking never scores `docs.missing` findings.

Config autocomplete: [`schema/doc-lag.config.schema.json`](../schema/doc-lag.config.schema.json).

## Finding identity and output

Finding IDs are content-derived (`ruleId:docPath:line:factName` for classic
rules; `docs.missing:<kind>:<name>@<path>` or `docs.missing:rule:<name>` for
docs-sync), not sequential. Findings are sorted by documentation path, line,
rule id, then id. The JSON report uses `schemaVersion: "1.0"` with optional
additive `docsSync`, `surface`, and `enforced` fields.

## Trust boundary

Repository content is untrusted input. Markdown, comments, `AGENTS.md`, and
`CLAUDE.md` cannot change tool behavior. File reads are limited to paths
inside the repository tree at the given git refs. The scanner never executes
commands found in documentation and does not open network connections during
a scan. The GitHub Action may call the GitHub API solely to create or update
the sticky PR comment. Optional `--rank jev` / Action `rank: jev` / MCP
`rank: "jev"` may call the TypeSafe AI API; the default path never does.

## GitHub Action packaging

`action.yml` is a **composite action that builds from source**:

1. `actions/setup-node` (Node 20; no npm cache — `uses: ./` can make
   `github.action_path` contain `/./`, which `setup-node` rejects in
   `cache-dependency-path`)
2. `npm ci --ignore-scripts` in `${{ github.action_path }}`
3. `npm run build` (tsc → `dist/`)
4. `node dist/action/main.js` against `${{ github.workspace }}`

**Why composite + build-from-source (not a committed ncc/esbuild bundle):**

- Avoids committing generated Action `dist/` bloat while the package is not
  yet published to npm.
- `package-lock.json` keeps installs reproducible for external consumers who
  pin `TarcisioPhilips/doc-lag@<tag-or-sha>`.
- One source tree serves CLI, library, and Action; no separate bundle drift.

**Trade-off:** each Action run pays for `npm ci` + `tsc`. If that becomes a
reliability or latency problem for consumers, switch to a bundled JS Action
(`runs: using: node20`) with a CI check that the committed bundle matches
`main`, without changing the scan/report contract.

### Action behavior

On `pull_request`, the Action resolves `base`/`head` from
`pull_request.base.sha` / `pull_request.head.sha` (overridable via inputs).
Callers should checkout with `fetch-depth: 0` so both SHAs exist locally.

It always writes:

- a versioned JSON report (`report-path` output)
- a GitHub Job Summary (same content as the comment, without the HTML marker)

When `comment: true`, it upserts a single sticky PR comment identified by
`<!-- doc-lag-sticky -->`, **including when there are zero findings** (the
body says so explicitly). Re-runs update that same comment rather than
creating a new one. If the token cannot write comments (common on fork PRs:
401/403/404), it logs a warning and continues — the job still gets the
summary and does **not** fail for that reason.

When `sarif: true`, it also writes SARIF 2.1.0 (`sarif-path`) for optional
upload with `github/codeql-action/upload-sarif`.

`fail-on: confirmed|none` maps to the same exit codes as the CLI.

## MCP adapter (read-only)

`src/mcp/` wraps the same `scan()` core used by the CLI and GitHub Action.
Entry points: `doc-lag mcp` (stdio) and the `doc-lag-mcp` bin.

| Tool | Role |
| --- | --- |
| `scan_diff` | Scan `base..head` (defaults: merge-base with main → `HEAD`; optional `include_working_tree`; optional `rank: "jev"`; optional `docs_sync` / `docs_sync_enforce`) |
| `explain_finding` | Re-scan and return one finding by stable id with full evidence (including `docs.missing`) |
| `list_rules` | List deterministic rules (`scripts.missing`, `links.broken`, `env.stale`, `docs.missing`) plus docs-sync detectors |

Trust / safety:

- All tools advertise `readOnlyHint: true`, `destructiveHint: false`.
- `scan_diff` sets `openWorldHint: true` because optional `rank=jev` may call
  TypeSafe AI; `explain_finding` and `list_rules` stay `openWorldHint: false`.
- `cwd` arguments are resolved with `constrainToRoot` against the MCP workspace
  root; path traversal outside the repo is rejected.
- The server never executes commands found in documentation and never modifies
  the scanned repository (working-tree mode only creates unreachable ephemeral
  git objects via a temp index).

Handlers live in `src/mcp/handlers.ts` so unit tests can exercise behavior
without a transport; `tests/mcp-server.test.ts` covers in-process
(`InMemoryTransport`) and stdio client round trips.

## Optional Jev semantic ranking

Implemented in `src/ranking/` and applied only through `scanWithRanking()` when
`rank=jev` is requested (CLI `--rank jev` / `DOC_LAG_RANK`, Action `rank`, MCP
`scan_diff.rank`). Default `scan()` remains offline and byte-identical.

- **Stable IDs**: Finding IDs are content-derived (`ruleId:docPath:line:name`),
  not sequential. Ranked findings keep the same ids.
- **Evidence array**: Successful scores append `jev#relevance` evidence with
  `score` / `confidence` (ordering signals only).
- **Status granularity**: Jev may re-order `needs-review` / `unknown` findings
  but cannot upgrade them to `confirmed` — only deterministic rules can.
- **Versioned JSON schema**: `schemaVersion: "1.0"` with additive
  `finding.ranking` and `report.ranking` when ranking is requested.
- **Deterministic default**: Without ranking, same inputs produce identical JSON
  (sorted findings, stable IDs).
- **Privacy / failure policy**: Privacy notice on enable; key only from
  `TYPESAFE_API_KEY`; missing key → clear error; timeouts/4xx/5xx/429 →
  deterministic order + warning; secrets redacted from errors.

The adapter sits *after* the normalizer, never inside rule evaluators.
