# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Docs-sync opt-in `cli.argv` detector for hand-rolled `process.argv` / `sys.argv` long flags (off by default; skipped when commander/argparse/click is imported)
- Docs-sync validation corpus: `validation/docs-sync/` cases (≥10 public repos + synthetic fixtures), replay script, committed results, and precision report; dogfood config ignores `validation/**` (fixture bait strings)
- Docs-sync mention index: bold tokens (`**name**` / `__name__`) count as structured mentions for MCP tools and Action inputs/outputs (and related kinds)
- Dogfood docs-sync on this repository: root `doc-lag.config.json` (`enforce: false`), CI `pull_request` types include `labeled`/`unlabeled`, and JSON Schema `schema/doc-lag.config.schema.json` for editor autocomplete
- Docs-sync Jev exclusion + caps/perf: `docs.missing` findings are never sent to Jev ranking; oversized/candidate-cap truncation verified; Node 22 perf budget for 2,000 changed files
- Docs-sync MCP wiring: `scan_diff` / `explain_finding` params `docs_sync` / `docs_sync_enforce`, **Action items for the agent** text for `docs.missing`, and `list_rules` includes `docs.missing` plus detectors
- Docs-sync Action/reporter surfacing: sticky comment + job summary **Missing documentation** section, SARIF locations at declaration sites, Action inputs `docs-sync` / `docs-sync-enforce` / `docs-sync-skip-labels`, output `docs-missing-count`, and PR label skip from the event payload
- Docs-sync opt-in `env.added` detector for new keys in `.env.example`-family files (reuses env extractors; off by default)
- Docs-sync MCP surface detector for `mcp.tool` (TS/JS `@modelcontextprotocol/sdk` `registerTool` / `tool`, Python FastMCP `@x.tool`) with underscore-name skipping
- Docs-sync CLI surface detectors for `cli.flag` / `cli.command` (commander, argparse, click) with comment stripping, hidden/suppressed handling, and negation mention matching
- Docs-sync structured surface detectors for `action.input` / `action.output` (YAML via `yaml`) and `package.bin` / `package.exports`, plus a mention index over in-scope docs (MDX/frontmatter-aware)
- Docs-sync pairing rules engine (`docs.missing`): enable with `docsSync` in config or `--docs-sync` / `DOC_LAG_DOCS_SYNC`; optional `--docs-sync-enforce` / `DOC_LAG_DOCS_SYNC_ENFORCE`; skip via `Docs-Not-Needed` commit trailer or `no-docs-needed` label (Action); text/JSON report `docsSync` metadata. Off by default; output stays byte-identical when disabled
- Config schema support for `docsSync` in `doc-lag.config.json` / `.doc-lag.json` (types, defaults, strict validation, env `DOC_LAG_DOCS_SYNC` / `DOC_LAG_DOCS_SYNC_ENFORCE`)
- MDX support (`.mdx`) with heuristic preparation: YAML frontmatter, `import`/`export`, and JSX/MDX expressions are neutralized without shifting finding line numbers
- Configurable documentation discovery via `doc-lag.config.json` / `.doc-lag.json` (`docs.include` / `docs.exclude`)
- CLI: `--config`, `--docs-include`, `--docs-exclude`; env `DOC_LAG_CONFIG`
- GitHub Action inputs: `config`, `docs-include`, `docs-exclude`
- MCP `scan_diff` / `explain_finding` params: `config`, `docs_include`, `docs_exclude`
- Broader default include globs: `documentation/**`, `website/docs/**`, `website/src/pages/**`, `apps/docs/**`, `packages/*/README.md`, `packages/*/docs/**`, `apps/*/README.md`, `content/**` (md + mdx)
- Default excludes for generated/build trees and `CHANGELOG.md` / `LICENSE.md`
- README section **What counts as documentation**
- Shared **Development workflow** in [`AGENTS.md`](AGENTS.md) (local `.plans/` specs → plan → tests → focused PRs; docs sync; safety; no feature-PR releases) and [`CONTRIBUTING.md`](CONTRIBUTING.md) pointer for humans and coding agents; `.plans/` gitignored

### Changed

- Docs-sync mention index: common English surface names (e.g. Action input `archive`) require structured documentation hits (inline code, table cell, bold, or fenced YAML/`with:` key), not heading/prose alone
- `git cat-file --batch` reads no longer abort huge diffs at a 32 MiB Node maxBuffer: one-shot large buffer first, then size-budgeted chunks; oversized objects are skipped with a warning instead of exit 2
- Default scan may report additional findings in monorepos and MDX doc sites (more paths in scope). Escape hatch: set `docs.include` to the legacy root + `docs/**/*.md` list. Findings for previously scanned Markdown paths remain compatible; report `schemaVersion` stays `1.0`.

## [0.3.0] — 2026-11-18

### Added

- Optional Jev semantic ranking for `needs-review` / `unknown` findings (ordering and evidence only; never changes status):
  - CLI: `--rank jev` or `DOC_LAG_RANK=jev` (requires `TYPESAFE_API_KEY`)
  - GitHub Action input: `rank: jev`
  - MCP `scan_diff` / `explain_finding`: `rank: "jev"`
- README rewrite aimed at npm adoption: quickstart (`npx doc-lag`), Action, and MCP first
- Agent setup docs: [`AGENTS.md`](AGENTS.md), [`docs/AGENT_SETUP.md`](docs/AGENT_SETUP.md), [`llms.txt`](llms.txt)

### Changed

- Default scan remains offline and deterministic when ranking is omitted (`--rank none`)

## [0.2.1] — 2026-11-18

### Fixed

- `doc-lag` and `doc-lag-mcp` now run when launched through npm/npx bin symlinks (they exited silently under npm installs in 0.2.0)

## [0.2.0] — 2026-11-17

### Added

- Read-only MCP server over stdio for coding agents (`doc-lag mcp` / `doc-lag-mcp` bin)
  - Tools: `scan_diff`, `explain_finding`, `list_rules`
  - Optional `include_working_tree` for uncommitted edits

[0.3.0]: https://github.com/TarcisioPhilips/doc-lag/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/TarcisioPhilips/doc-lag/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/TarcisioPhilips/doc-lag/compare/v0.1.1...v0.2.0
