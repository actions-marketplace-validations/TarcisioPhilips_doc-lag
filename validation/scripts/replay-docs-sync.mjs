#!/usr/bin/env node
/**
 * Replay docs-sync validation cases (synthetic fixtures + public PR ranges).
 *
 * Usage (from repo root, after `npm run build`):
 *   node validation/scripts/replay-docs-sync.mjs
 *   node validation/scripts/replay-docs-sync.mjs --synthetic-only
 *   node validation/scripts/replay-docs-sync.mjs --public-only
 *
 * Writes JSON under validation/docs-sync/results/ and prints a summary.
 * Public clones are cached in validation/docs-sync/.cache/ (gitignored).
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CASES_PATH = path.join(ROOT, "validation/docs-sync/cases.json");
const RESULTS_DIR = path.join(ROOT, "validation/docs-sync/results");
const CACHE_DIR = path.join(ROOT, "validation/docs-sync/.cache");
const CLI = path.join(ROOT, "dist/cli.js");

const args = new Set(process.argv.slice(2));
const syntheticOnly = args.has("--synthetic-only");
const publicOnly = args.has("--public-only");

function git(repo, gitArgs, opts = {}) {
  return execFileSync("git", ["-C", repo, ...gitArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

function writeFiles(repo, files) {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(repo, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
}

function createFixtureRepo({ baseFiles, headFiles }) {
  const repo = mkdtempSync(path.join(tmpdir(), "doc-lag-val-"));
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "validation@doc-lag.local"]);
  git(repo, ["config", "user.name", "doc-lag Validation"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  writeFiles(repo, baseFiles);
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "commit.gpgsign=false", "commit", "-m", "base"]);
  const base = git(repo, ["rev-parse", "HEAD"]).trim();
  if (headFiles) {
    for (const [relative, content] of Object.entries(headFiles)) {
      if (content === null) git(repo, ["rm", "-f", "--", relative]);
      else writeFiles(repo, { [relative]: content });
    }
    git(repo, ["add", "-A"]);
    git(repo, ["-c", "commit.gpgsign=false", "commit", "-m", "head"]);
  }
  const head = git(repo, ["rev-parse", "HEAD"]).trim();
  return { repo, base, head };
}

function packageJson(extra = {}) {
  return `${JSON.stringify({ name: "fixture", private: true, ...extra }, null, 2)}\n`;
}

function synthFixtures() {
  const commanderBase = `import { Command } from "commander";
const program = new Command();
program.option("--verbose", "verbose");
program.parse();
`;
  const commanderHeadFlag = `import { Command } from "commander";
const program = new Command();
program.option("--verbose", "verbose");
program.option("--audit", "run audit");
program.parse();
`;
  const commanderHeadHidden = `import { Command } from "commander";
const program = new Command();
program.option("--verbose", "verbose");
program.option("--secret", "hidden").hideHelp();
program.parse();
`;
  const commanderHeadCmd = `import { Command } from "commander";
const program = new Command();
program.option("--verbose", "verbose");
program.command("publish").action(() => {});
program.parse();
`;

  return {
    "synth-cli-flag-undocumented": () =>
      createFixtureRepo({
        baseFiles: {
          "package.json": packageJson({ type: "module", dependencies: { commander: "^12.0.0" } }),
          "src/cli.ts": commanderBase,
          "README.md": "# Fixture\n\nUse `--verbose`.\n",
        },
        headFiles: { "src/cli.ts": commanderHeadFlag },
      }),
    "synth-cli-flag-documented": () =>
      createFixtureRepo({
        baseFiles: {
          "package.json": packageJson({ type: "module", dependencies: { commander: "^12.0.0" } }),
          "src/cli.ts": commanderBase,
          "README.md": "# Fixture\n\nUse `--verbose`.\n",
        },
        headFiles: {
          "src/cli.ts": commanderHeadFlag,
          "README.md": "# Fixture\n\nUse `--verbose` and `--audit`.\n",
        },
      }),
    "synth-cli-flag-hidden": () =>
      createFixtureRepo({
        baseFiles: {
          "package.json": packageJson({ type: "module", dependencies: { commander: "^12.0.0" } }),
          "src/cli.ts": commanderBase,
          "README.md": "# Fixture\n",
        },
        headFiles: { "src/cli.ts": commanderHeadHidden },
      }),
    "synth-cli-command-undocumented": () =>
      createFixtureRepo({
        baseFiles: {
          "package.json": packageJson({ type: "module", dependencies: { commander: "^12.0.0" } }),
          "src/cli.ts": commanderBase,
          "README.md": "# Fixture\n",
        },
        headFiles: { "src/cli.ts": commanderHeadCmd },
      }),
    "synth-cli-flag-click-undocumented": () =>
      createFixtureRepo({
        baseFiles: {
          "cli.py": "import click\n@click.command()\n@click.option('--env', default='dev')\ndef main(env):\n    pass\n",
          "README.md": "# Fixture\n",
        },
        headFiles: {
          "cli.py":
            "import click\n@click.command()\n@click.option('--env', default='dev')\n@click.option('--region')\ndef main(env, region):\n    pass\n",
        },
      }),
    "synth-cli-flag-argparse-undocumented": () =>
      createFixtureRepo({
        baseFiles: {
          "cli.py":
            "import argparse\np=argparse.ArgumentParser()\np.add_argument('--verbose', action='store_true')\nargs=p.parse_args()\n",
          "README.md": "# Fixture\n",
        },
        headFiles: {
          "cli.py":
            "import argparse\np=argparse.ArgumentParser()\np.add_argument('--verbose', action='store_true')\np.add_argument('--timeout', type=int)\nargs=p.parse_args()\n",
        },
      }),
    "synth-action-input-undocumented": () =>
      createFixtureRepo({
        baseFiles: {
          "action.yml": "name: x\ninputs:\n  token:\n    description: token\nruns:\n  using: node20\n  main: index.js\n",
          "README.md": "# Action\n\n`token`\n",
        },
        headFiles: {
          "action.yml":
            "name: x\ninputs:\n  token:\n    description: token\n  dry-run:\n    description: dry run\nruns:\n  using: node20\n  main: index.js\n",
        },
      }),
    "synth-action-input-documented": () =>
      createFixtureRepo({
        baseFiles: {
          "action.yml": "name: x\ninputs:\n  token:\n    description: token\nruns:\n  using: node20\n  main: index.js\n",
          "README.md": "# Action\n\n`token`\n",
        },
        headFiles: {
          "action.yml":
            "name: x\ninputs:\n  token:\n    description: token\n  dry-run:\n    description: dry run\nruns:\n  using: node20\n  main: index.js\n",
          "README.md": "# Action\n\n`token` and `dry-run`\n",
        },
      }),
    "synth-action-output-undocumented": () =>
      createFixtureRepo({
        baseFiles: {
          "action.yml":
            "name: x\ninputs:\n  token:\n    description: token\noutputs:\n  result:\n    description: result\nruns:\n  using: node20\n  main: index.js\n",
          "README.md": "# Action\n",
        },
        headFiles: {
          "action.yml":
            "name: x\ninputs:\n  token:\n    description: token\noutputs:\n  result:\n    description: result\n  artifact-url:\n    description: url\nruns:\n  using: node20\n  main: index.js\n",
        },
      }),
    "synth-package-bin-undocumented": () =>
      createFixtureRepo({
        baseFiles: {
          "package.json": packageJson({ bin: { fixture: "bin.js" } }),
          "README.md": "# Fixture\n",
        },
        headFiles: {
          "package.json": packageJson({ bin: { fixture: "bin.js", widget: "widget.js" } }),
        },
      }),
    "synth-mcp-tool-undocumented": () =>
      createFixtureRepo({
        baseFiles: {
          "package.json": packageJson({
            type: "module",
            dependencies: { "@modelcontextprotocol/sdk": "^1.0.0" },
          }),
          "src/server.ts":
            'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nconst s = new McpServer({ name: "x", version: "1" });\ns.registerTool("ping", {}, async () => ({ content: [] }));\n',
          "README.md": "# MCP\n",
        },
        headFiles: {
          "src/server.ts":
            'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nconst s = new McpServer({ name: "x", version: "1" });\ns.registerTool("ping", {}, async () => ({ content: [] }));\ns.registerTool("list_widgets", {}, async () => ({ content: [] }));\n',
        },
      }),
    "synth-mcp-tool-documented": () =>
      createFixtureRepo({
        baseFiles: {
          "package.json": packageJson({
            type: "module",
            dependencies: { "@modelcontextprotocol/sdk": "^1.0.0" },
          }),
          "src/server.ts":
            'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nconst s = new McpServer({ name: "x", version: "1" });\ns.registerTool("ping", {}, async () => ({ content: [] }));\n',
          "README.md": "# MCP\n",
        },
        headFiles: {
          "src/server.ts":
            'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nconst s = new McpServer({ name: "x", version: "1" });\ns.registerTool("ping", {}, async () => ({ content: [] }));\ns.registerTool("list_widgets", {}, async () => ({ content: [] }));\n',
          "README.md": "# MCP\n\nTool `list_widgets`.\n",
        },
      }),
    "synth-env-added-opt-in": () =>
      createFixtureRepo({
        baseFiles: {
          ".env.example": "API_URL=http://localhost\n",
          "README.md": "# Env\n",
        },
        headFiles: { ".env.example": "API_URL=http://localhost\nWIDGET_TOKEN=\n" },
      }),
    "synth-env-added-default-off": () =>
      createFixtureRepo({
        baseFiles: {
          ".env.example": "API_URL=http://localhost\n",
          "README.md": "# Env\n",
        },
        headFiles: { ".env.example": "API_URL=http://localhost\nWIDGET_TOKEN=\n" },
      }),
    "synth-rule-pairing-undocumented": () =>
      createFixtureRepo({
        baseFiles: {
          "src/api/routes.ts": "export const routes = [];\n",
          "docs/api.md": "# API\n\nStable.\n",
          "README.md": "# App\n",
        },
        headFiles: {
          "src/api/routes.ts": "export const routes = ['/v2'];\n",
        },
      }),
    "synth-rule-pairing-documented": () =>
      createFixtureRepo({
        baseFiles: {
          "src/api/routes.ts": "export const routes = [];\n",
          "docs/api.md": "# API\n\nStable.\n",
          "README.md": "# App\n",
        },
        headFiles: {
          "src/api/routes.ts": "export const routes = ['/v2'];\n",
          "docs/api.md": "# API\n\nNow includes `/v2`.\n",
        },
      }),
  };
}

function writeConfig(repo, docsSync) {
  const config = { docsSync: { enforce: false, ...(docsSync || {}) } };
  writeFileSync(path.join(repo, "doc-lag.config.json"), JSON.stringify(config, null, 2));
}

function runScan({ cwd, base, head, configPath }) {
  const cliArgs = [
    CLI,
    "scan",
    "--base",
    base,
    "--head",
    head,
    "--cwd",
    cwd,
    "--format",
    "json",
    "--fail-on",
    "none",
    "--docs-sync",
  ];
  if (configPath) cliArgs.push("--config", configPath);
  const started = Date.now();
  const result = spawnSync(process.execPath, cliArgs, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const elapsedMs = Date.now() - started;
  let report = null;
  let parseError = null;
  try {
    report = JSON.parse(result.stdout || "{}");
  } catch (err) {
    parseError = String(err);
  }
  return {
    exitCode: result.status ?? 2,
    elapsedMs,
    stdout: result.stdout,
    stderr: result.stderr,
    report,
    parseError,
    crashed: result.status === 2 || Boolean(parseError) || result.error,
  };
}

function ensurePublicClone(repoFull) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const dest = path.join(CACHE_DIR, repoFull.replace("/", "__"));
  if (!existsSync(path.join(dest, ".git"))) {
    mkdirSync(path.dirname(dest), { recursive: true });
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    console.error(`[clone] ${repoFull} → ${dest}`);
    execFileSync(
      "git",
      ["clone", "--filter=blob:none", "--no-checkout", `https://github.com/${repoFull}.git`, dest],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
  }
  return dest;
}

function fetchCommits(repoPath, shas) {
  for (const sha of shas) {
    try {
      git(repoPath, ["cat-file", "-e", `${sha}^{commit}`]);
    } catch {
      console.error(`[fetch] ${sha} in ${repoPath}`);
      execFileSync("git", ["-C", repoPath, "fetch", "--filter=blob:none", "--depth=1", "origin", sha], {
        stdio: ["ignore", "inherit", "inherit"],
      });
    }
  }
  // Need trees for both ends; deepen if sparse
  try {
    execFileSync(
      "git",
      ["-C", repoPath, "fetch", "--filter=blob:none", "--deepen=50", "origin", ...shas],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    // best-effort
  }
}

function scoreSynthetic(caseDef, findingIds) {
  const expected = new Set(caseDef.expectIds || []);
  const absent = new Set(caseDef.expectAbsent || []);
  const got = new Set(findingIds);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const id of expected) {
    if (got.has(id)) tp += 1;
    else fn += 1;
  }
  for (const id of got) {
    if (!expected.has(id)) fp += 1;
  }
  for (const id of absent) {
    if (got.has(id)) fp += 1;
  }
  return { tp, fp, fn, expected: [...expected], got: [...got] };
}

function kindOfFinding(id) {
  // docs.missing:cli.flag:--x@path OR docs.missing:rule:name
  const parts = id.split(":");
  if (parts[0] !== "docs.missing") return "other";
  if (parts[1] === "rule") return "rule";
  return parts[1] || "other";
}

function main() {
  if (!existsSync(CLI)) {
    console.error("dist/cli.js missing — run npm run build first");
    process.exit(2);
  }
  mkdirSync(RESULTS_DIR, { recursive: true });
  const cases = JSON.parse(readFileSync(CASES_PATH, "utf8"));
  const builders = synthFixtures();
  const results = [];
  const byDetector = {};

  const bump = (detector, key, n = 1) => {
    byDetector[detector] ??= { tp: 0, fp: 0, fn: 0, cases: 0 };
    byDetector[detector][key] += n;
  };

  if (!publicOnly) {
    for (const caseDef of cases.synthetic) {
      const build = builders[caseDef.id];
      if (!build) throw new Error(`No fixture builder for ${caseDef.id}`);
      console.error(`[synthetic] ${caseDef.id}`);
      const fixture = build();
      try {
        writeConfig(fixture.repo, {
          ...(caseDef.docsSync || {}),
        });
        // Enable docsSync via presence of config; also pass --docs-sync
        const scan = runScan({
          cwd: fixture.repo,
          base: fixture.base,
          head: fixture.head,
          configPath: path.join(fixture.repo, "doc-lag.config.json"),
        });
        const findings = (scan.report?.findings || []).filter((f) => f.ruleId === "docs.missing");
        const ids = findings.map((f) => f.id);
        const score = scoreSynthetic(caseDef, ids);
        const detector = caseDef.detector;
        byDetector[detector] ??= { tp: 0, fp: 0, fn: 0, cases: 0 };
        byDetector[detector].cases += 1;
        byDetector[detector].tp += score.tp;
        byDetector[detector].fp += score.fp;
        byDetector[detector].fn += score.fn;
        const entry = {
          id: caseDef.id,
          kind: "synthetic",
          detector,
          crashed: Boolean(scan.crashed),
          exitCode: scan.exitCode,
          elapsedMs: scan.elapsedMs,
          docsSync: scan.report?.docsSync ?? null,
          findingIds: ids,
          score,
          stderrTail: (scan.stderr || "").slice(-500),
        };
        results.push(entry);
        writeFileSync(path.join(RESULTS_DIR, `${caseDef.id}.json`), JSON.stringify(entry, null, 2));
      } finally {
        rmSync(fixture.repo, { recursive: true, force: true });
      }
    }
  }

  if (!syntheticOnly) {
    for (const caseDef of cases.public) {
      console.error(`[public] ${caseDef.id} (${caseDef.repo}#${caseDef.pr})`);
      let entry;
      try {
        const repoPath = ensurePublicClone(caseDef.repo);
        fetchCommits(repoPath, [caseDef.base, caseDef.head]);
        // materialize trees for scan (blobless may need checkout of head)
        try {
          git(repoPath, ["checkout", "--force", caseDef.head]);
        } catch (err) {
          // retry with fuller fetch
          execFileSync("git", ["-C", repoPath, "fetch", "--filter=blob:none", "origin", caseDef.head], {
            stdio: ["ignore", "inherit", "inherit"],
          });
          git(repoPath, ["checkout", "--force", caseDef.head]);
        }
        const configPath = path.join(repoPath, ".doc-lag-validation.json");
        writeFileSync(
          configPath,
          JSON.stringify(
            {
              docsSync: {
                enforce: false,
                detectors: {
                  "action.input": true,
                  "action.output": true,
                  "package.bin": true,
                  "cli.flag": true,
                  "cli.command": true,
                  "mcp.tool": true,
                },
              },
            },
            null,
            2,
          ),
        );
        const scan = runScan({
          cwd: repoPath,
          base: caseDef.base,
          head: caseDef.head,
          configPath,
        });
        const findings = (scan.report?.findings || []).filter((f) => f.ruleId === "docs.missing");
        entry = {
          id: caseDef.id,
          kind: "public",
          repo: caseDef.repo,
          pr: caseDef.pr,
          url: caseDef.url,
          base: caseDef.base,
          head: caseDef.head,
          surfaceFocus: caseDef.surfaceFocus,
          notes: caseDef.notes,
          crashed: Boolean(scan.crashed),
          exitCode: scan.exitCode,
          elapsedMs: scan.elapsedMs,
          docsSync: scan.report?.docsSync ?? null,
          findings: findings.map((f) => ({
            id: f.id,
            message: f.message,
            suggestion: f.suggestion,
            surface: f.surface ?? null,
            kind: kindOfFinding(f.id),
          })),
          findingIds: findings.map((f) => f.id),
          stderrTail: (scan.stderr || "").slice(-800),
          parseError: scan.parseError,
        };
      } catch (err) {
        entry = {
          id: caseDef.id,
          kind: "public",
          repo: caseDef.repo,
          pr: caseDef.pr,
          url: caseDef.url,
          crashed: true,
          error: String(err && err.message ? err.message : err),
        };
      }
      results.push(entry);
      writeFileSync(path.join(RESULTS_DIR, `${caseDef.id}.json`), JSON.stringify(entry, null, 2));
    }
  }

  const synthetic = results.filter((r) => r.kind === "synthetic");
  const publicResults = results.filter((r) => r.kind === "public");
  const synthTotals = synthetic.reduce(
    (acc, r) => {
      acc.tp += r.score?.tp || 0;
      acc.fp += r.score?.fp || 0;
      acc.fn += r.score?.fn || 0;
      if (r.crashed) acc.crashes += 1;
      return acc;
    },
    { tp: 0, fp: 0, fn: 0, crashes: 0 },
  );
  const publicCrashes = publicResults.filter((r) => r.crashed).length;
  const publicFindingCount = publicResults.reduce((n, r) => n + (r.findingIds?.length || 0), 0);

  const precision = (tp, fp) => (tp + fp === 0 ? null : tp / (tp + fp));
  const recall = (tp, fn) => (tp + fn === 0 ? null : tp / (tp + fn));

  const perDetector = Object.fromEntries(
    Object.entries(byDetector).map(([k, v]) => [
      k,
      {
        ...v,
        precision: precision(v.tp, v.fp),
        recall: recall(v.tp, v.fn),
      },
    ]),
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    synthetic: {
      cases: synthetic.length,
      ...synthTotals,
      precision: precision(synthTotals.tp, synthTotals.fp),
      recall: recall(synthTotals.tp, synthTotals.fn),
      perDetector,
    },
    public: {
      cases: publicResults.length,
      crashes: publicCrashes,
      totalFindings: publicFindingCount,
      repos: [...new Set(publicResults.map((r) => r.repo).filter(Boolean))],
    },
    results: results.map((r) => ({
      id: r.id,
      kind: r.kind,
      crashed: r.crashed,
      findingCount: r.findingIds?.length ?? null,
      score: r.score ?? null,
    })),
  };

  writeFileSync(path.join(RESULTS_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main();
