# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] — 2026-11-23

### Added

- **Docs-sync** (`docs.missing`): optional check for missing documentation when a PR adds a public surface or changes paired code without updating the docs that should describe it. **Off by default.** Enable with a `docsSync` object in config, CLI `--docs-sync` / `DOC_LAG_DOCS_SYNC`, Action `docs-sync`, or MCP `docs_sync`. Findings are `needs-review` unless `docsSync.enforce` / `--docs-sync-enforce` / Action `docs-sync-enforce` / MCP `docs_sync_enforce`. Skip via commit trailer `Docs-Not-Needed: <reason>` or PR label `no-docs-needed` (Action; labels from the event payload — use `labeled`/`unlabeled` workflow types). Default reports stay byte-identical when disabled.
  - Pairing rules (`docsSync.rules`) for code↔docs path groups
  - Surface detectors: `action.input` / `action.output`, `package.bin` (opt-in `package.exports`), `cli.flag` / `cli.command` (commander, argparse, click), `mcp.tool`, opt-in `env.added`, and opt-in `cli.argv` (hand-rolled `process.argv` / `sys.argv` long flags; skipped when a framework parser is imported)
  - Mention index over in-scope docs (MDX/frontmatter-aware): inline code, markdown tables, fenced YAML/`with:` keys, and bold tokens (`**name**` / `__name__`). Common English surface names (e.g. Action input `archive`) require those structured hits — not headings or bare prose alone
  - Action/reporter: sticky comment + job summary **Missing documentation** section, SARIF locations at declaration sites, inputs `docs-sync` / `docs-sync-enforce` / `docs-sync-skip-labels`, output `docs-missing-count`
  - MCP: `scan_diff` / `explain_finding` params `docs_sync` / `docs_sync_enforce`, **Action items for the agent** text when `docs.missing` exists, `list_rules` includes `docs.missing` and detectors
  - Optional Jev ranking never scores `docs.missing`; oversized/candidate-cap truncation verified; Node 22 perf budget for large diffs
  - Config schema for `docsSync`; JSON Schema `schema/doc-lag.config.schema.json` for editor autocomplete
  - Dogfood on this repository (`doc-lag.config.json` with `enforce: false`; CI Dogfood `fail-on: none`; ignore `validation/**` fixture bait)
  - Validation corpus under `validation/docs-sync/` (synthetic + public PR cases, replay script, committed results, precision report)
- Configurable documentation discovery via `doc-lag.config.json` / `.doc-lag.json` (`docs.include` / `docs.exclude`); CLI `--config` / `--docs-include` / `--docs-exclude`; Action and MCP equivalents; env `DOC_LAG_CONFIG`
- MDX support (`.mdx`) with heuristic preparation (frontmatter / import-export / JSX neutralized without shifting finding line numbers)
- Broader default include globs (site/monorepo paths) and default excludes for generated/build trees plus `CHANGELOG.md` / `LICENSE.md`
- README section **What counts as documentation**
- Shared **Development workflow** in [`AGENTS.md`](AGENTS.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md) for humans and coding agents

### Changed

- Docs-sync mention index: common English surface names require structured documentation hits (inline code, table cell, bold, or fenced YAML/`with:` key), not heading/prose alone
- Default scan may report additional findings in monorepos and MDX doc sites (more paths in scope). Escape hatch: set `docs.include` to the legacy root + `docs/**/*.md` list. Findings for previously scanned Markdown paths remain compatible; report `schemaVersion` stays `1.0`

### Fixed

- `git cat-file --batch` reads no longer abort huge diffs at a 32 MiB Node maxBuffer: one-shot large buffer first, then size-budgeted chunks; oversized objects are skipped with a warning instead of exit 2

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

[0.4.0]: https://github.com/TarcisioPhilips/doc-lag/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/TarcisioPhilips/doc-lag/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/TarcisioPhilips/doc-lag/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/TarcisioPhilips/doc-lag/compare/v0.1.1...v0.2.0
