# Fixture cases — `preview-service`

Synthetic Node.js repository used for doc-lag Gate 0 and, later, as an automated test fixture.

---

## Docs-sync (`docs.missing`) validation

Missing-docs check cases live under [`docs-sync/`](docs-sync/):

| Path | Role |
| --- | --- |
| [`docs-sync/cases.json`](docs-sync/cases.json) | Machine-readable synthetic + public PR cases (≥10 public repos) |
| [`docs-sync/results/`](docs-sync/results/) | Last replay JSON (per case + `summary.json`) |
| [`docs-sync/judgments.json`](docs-sync/judgments.json) | Manual TP/FP/FN/TN labels for public PRs |
| [`docs-sync/PRECISION.md`](docs-sync/PRECISION.md) | Precision / recall report |
| [`scripts/replay-docs-sync.mjs`](scripts/replay-docs-sync.mjs) | Offline replay harness (`npm run build` first) |

```bash
npm run build
node validation/scripts/replay-docs-sync.mjs
```

Synthetic fixtures cover commander / click / argparse flags, Action inputs/outputs, `package.bin`, MCP tools, opt-in `env.added`, and pairing rules. Public replays cover Actions, Python CLIs, an MCP server, and doc-lag’s own PR that added configurable docs paths.

---

# Fixture cases — `preview-service` (Gate 0)

Synthetic Node.js repository used for doc-lag Gate 0 and, later, as an automated test fixture.

## Git history

| Ref | SHA | Commit date (America/Sao_Paulo) | Message |
|---|---|---|---|
| `main` (base) | `041f53207c40e3126468809a7e4b1ab829b5551b` | 2026-11-01 12:00 | Initial preview-service docs and source (base) |
| `stale-docs` (head) | `308fdcaeaa8c3e11b75f397542d453770ba7a0f1` | 2026-11-17 15:00 | Break docs: drop deploy:preview, move helper, remove env, rename flag and route |

Recreate with `scripts/create-fixture.sh` from the validation workspace root. Recreating will produce the same trees and messages; SHAs will change if Git or file bytes differ.

`git diff --name-status main...stale-docs` must be:

```
M	.env.example
M	package.json
M	src/cli.js
A	src/lib/preview-engine.js
D	src/lib/preview.js
M	src/server.js
```

No Markdown path is part of the PR.

## Cases the PR should surface

### A — removed npm script, still documented

- **Change:** `scripts["deploy:preview"]` deleted from `package.json`.
- **Still documented:** `README.md` (fenced `npm run deploy:preview`), `AGENTS.md` (“run `npm run deploy:preview`”).
- **Expected PR-aware finding:** confirmed; evidence cites `package.json#scripts` as the fact that changed in this diff, plus the doc `file:line`.

### B — moved file, still linked and path-referenced

- **Change:** `src/lib/preview.js` renamed to `src/lib/preview-engine.js`; export `buildPreview` renamed to `buildSnapshot`. Call sites in `src/server.js` were updated.
- **Still documented:** Markdown link `[src/lib/preview.js](src/lib/preview.js)` in `README.md`; backtick path in `AGENTS.md` and `docs/setup.md`; README fenced example `require("./src/lib/preview")` and `buildPreview("docs-example")`.
- **Expected PR-aware finding:** confirmed missing path / stale link, with the rename in the diff as evidence. The stale `buildPreview()` example may be `needs-review` if the MVP does not yet parse JS examples.

### C — env var removed from `.env.example`, still documented

- **Change:** `PREVIEW_SECRET` removed from `.env.example`. The server also stopped reading it (same commit, because the preview route was replaced).
- **Still documented:** `README.md`, `AGENTS.md`, `docs/setup.md`, `docs/api.md`.
- **Expected PR-aware finding:** confirmed stale env reference against `.env.example`, citing the `.env.example` deletion in this diff.

### D — renamed CLI flag and HTTP route (optional / later extractor)

- **Change:** `--dry-run` renamed to `--check-only` in `src/cli.js` (including `--help` output). `GET /api/preview` renamed to `GET /api/snapshots` in `src/server.js`.
- **Still documented:** `README.md` and `docs/cli.md` for the flag; `docs/api.md` and `AGENTS.md` for the route.
- **Expected finding:** when flag/route extractors exist (spec RF-15 is P1). Not required to block the MVP if A–C already prove the wedge.

## Case the PR scan must not blame on the PR

### N — pre-existing stale docs, untouched by the diff

`docs/maintenance.md` (present on `main`, not modified on `stale-docs`) tells the reader to run `npm run ancient:cleanup` and links to `docs/legacy-handbook.md`. Neither the script nor the file has ever existed.

- **`--all` / baseline scan:** may report these as stale.
- **PR scan vs `main`:** must not present them as caused by this pull request.

## Notes for tool authors

- `scripts/deploy-preview.js` is intentionally left in the tree after the script is removed from `package.json`, so a path checker should not treat the *file* as missing unless a doc points at a path that really disappeared (`src/lib/preview.js`).
- `DATABASE_URL` remains in `.env.example` and is not read by the tiny server. That is pre-existing “orphan env” noise, also not caused by the PR.
- `docs-drift.yml` is committed only so NickitaChe/docs-drift can be reproduced against this fixture. doc-lag’s MVP should not require an equivalent file for rules A–C.
