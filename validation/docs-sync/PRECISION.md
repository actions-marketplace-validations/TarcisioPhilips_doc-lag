# Docs-sync validation — precision report

**Date:** 2026-11-20  
**Tool:** local `node dist/cli.js scan --docs-sync` (read-only, offline, no network during scan)  
**Replay:** `node validation/scripts/replay-docs-sync.mjs`  
**Artifacts:** `validation/docs-sync/cases.json`, `results/*.json`, `judgments.json`

## Cases run

| Corpus | Cases | Crashes | Notes |
| --- | ---: | ---: | --- |
| Synthetic fixtures (ground truth) | 16 | 0 | commander / click / argparse / Action / package.bin / MCP / env.added / pairing rules |
| Public historical PRs | 13 | 0 | **13 repositories** (commander-era Actions, click/black, httpie, MCP servers, doc-lag dogfood) |

Public repos: `TarcisioPhilips/doc-lag`, `actions/checkout`, `softprops/action-gh-release`, `modelcontextprotocol/servers`, `pallets/click`, `psf/black`, `httpie/cli`, `astral-sh/setup-uv`, `pnpm/action-setup`, `docker/login-action`, `actions/upload-artifact`, `actions/setup-node`, `actions/github-script`.

## Synthetic precision (exact IDs)

| | Count |
| --- | ---: |
| True positives | 10 |
| False positives | 0 |
| False negatives | 0 |
| **Precision** | **1.00** |
| **Recall** | **1.00** |

### Per detector (synthetic)

| Detector | Cases | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `cli.flag` | 5 | 3 | 0 | 0 | 1.00 | 1.00 |
| `cli.command` | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| `action.input` | 2 | 1 | 0 | 0 | 1.00 | 1.00 |
| `action.output` | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| `package.bin` | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| `mcp.tool` | 2 | 1 | 0 | 0 | 1.00 | 1.00 |
| `env.added` | 2 | 1 | 0 | 0 | 1.00 | 1.00 |
| pairing `rule` | 2 | 1 | 0 | 0 | 1.00 | 1.00 |

## Public PR judgments

Well-maintained Action/CLI repos usually document new surfaces in the same PR, so the public corpus is **TN-heavy**. Judgments after inspecting diffs + docs at head (`judgments.json`):

| | Count |
| --- | ---: |
| True negatives | 11 |
| True positives | 0 |
| False positives | 0 |
| False negatives | 2 |
| Crashes | 0 |

Public finding precision is undefined (no positive findings emitted). On cases with a detectable new surface that should have been flagged, recall is **0/2** (both FNs below). Combined with synthetic, owner gate (≥80% of findings judged correct) is met for **emitted** findings (synthetic 10/10 correct; public 0 FPs).

### Notable noise / gaps

1. **Prose collision FN** — `actions/upload-artifact#764` added Action input `archive`. Docs never document it as an input, but README prose about “Zip archives” satisfied the mention index → **no finding**. Short/common tokens are a precision/recall tradeoff.
2. **Hand-rolled CLI FN** — `modelcontextprotocol/servers#5359` adds `--read-only` via manual argv parsing, not commander/argparse/click → **detector silent** (documented v1 limitation).
3. **Library repos** (click, black) rarely expose consumer CLIs in the same tree; expect mostly TNs unless scanning example apps.

### Suggested tweaks

- For `action.input` / `action.output`, prefer mention contexts that look like input tables / `with:` YAML keys (stricter than bare prose) when the name is a common English word.
- Optional later detector: hand-rolled `--flag` string compares in `main`/argv loops (high noise risk — keep off by default).
- Keep pairing rules for monorepos; public Action PRs are covered well by structured detectors when docs lag.
- Continue dogfood with `enforce: false` until more FN/FP budget is collected on this repo’s own PRs.

## Dogfood check

Replaying `TarcisioPhilips/doc-lag#14` with docs-sync enabled: **6** new surfaces, **0** `docs.missing` findings (README documented the new flags/inputs/params). Matches the expected dogfood outcome.

## How to reproduce

```bash
npm run build
node validation/scripts/replay-docs-sync.mjs
# optional: --synthetic-only | --public-only
```

Public clones are cached under `validation/docs-sync/.cache/` (gitignored). Committed machine results live in `validation/docs-sync/results/`.
