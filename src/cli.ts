#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { isEntryPoint } from "./is-entry.js";
import { Command, Option } from "commander";
import { scanWithRanking } from "./core/scan-with-ranking.js";
import { ScanError } from "./errors.js";
import { parseRankProvider } from "./ranking/jev-rank.js";
import { exitCodeFor } from "./reporters/exit-code.js";
import { formatJson } from "./reporters/json.js";
import { formatSarif } from "./reporters/sarif.js";
import { formatText } from "./reporters/text.js";
import type { FailOn, OutputFormat, RankProvider } from "./types.js";

function packageVersion(): string {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const raw = readFileSync(packageJsonUrl, "utf8");
  return (JSON.parse(raw) as { version: string }).version;
}

function resolveRankOption(cliRank: string | undefined, env: NodeJS.ProcessEnv): RankProvider {
  // CLI flag wins; otherwise DOC_LAG_RANK acts as config.
  if (cliRank !== undefined) {
    return parseRankProvider(cliRank);
  }
  return parseRankProvider(env.DOC_LAG_RANK);
}

export interface CliScanOptions {
  base: string;
  head: string;
  format: OutputFormat;
  failOn: FailOn;
  cwd: string;
  rank?: RankProvider;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  docsInclude?: string[];
  docsExclude?: string[];
  /** undefined = config/env; true/false = CLI force. */
  docsSync?: boolean;
  docsSyncEnforce?: boolean;
}

function resolveDocsSyncCliFlags(options: {
  /** Set by `--docs-sync` / `--no-docs-sync` (commander boolean pair). */
  docsSync?: boolean;
  docsSyncEnforce?: boolean;
}): { docsSync?: boolean; docsSyncEnforce?: boolean } {
  // Commander only sets docsSync when one of the flags is present.
  let docsSync = options.docsSync;
  const docsSyncEnforce = options.docsSyncEnforce === true ? true : undefined;
  if (docsSyncEnforce === true && docsSync === undefined) {
    docsSync = true;
  }
  return { docsSync, docsSyncEnforce };
}

function resolveConfigPathOption(
  cliConfig: string | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (cliConfig !== undefined && cliConfig.trim() !== "") {
    return cliConfig.trim();
  }
  const fromEnv = env.DOC_LAG_CONFIG?.trim();
  return fromEnv || undefined;
}

export async function runScanCommand(
  options: CliScanOptions,
): Promise<{ output: string; exitCode: number }> {
  const report = await scanWithRanking({
    cwd: path.resolve(options.cwd),
    base: options.base,
    head: options.head,
    rank: options.rank ?? "none",
    env: options.env,
    configPath: options.configPath,
    docs: {
      include: options.docsInclude,
      exclude: options.docsExclude,
    },
    docsSyncEnabled: options.docsSync,
    docsSyncEnforce: options.docsSyncEnforce,
  });
  const output =
    options.format === "json"
      ? formatJson(report)
      : options.format === "sarif"
        ? formatSarif(report)
        : formatText(report);
  return { output, exitCode: exitCodeFor(report, options.failOn) };
}

export function createProgram(): Command {
  const program = new Command();
  // Apply before subcommands are added so they inherit the callback.
  program.exitOverride();
  program
    .name("doc-lag")
    .description(
      "Detect documentation that may be stale after a code change. Local, read-only, and deterministic. Never executes commands found in docs.",
    )
    .version(packageVersion());

  program
    .command("scan")
    .description("Scan a git range for documentation made stale by the change")
    .requiredOption("--base <ref>", "Base git ref to compare from")
    .option("--head <ref>", "Head git ref to compare to", "HEAD")
    .addOption(
      new Option("--format <format>", "Output format")
        .choices(["text", "json", "sarif"])
        .default("text"),
    )
    .addOption(
      new Option("--fail-on <threshold>", "Exit 1 when findings match this threshold")
        .choices(["confirmed", "none"])
        .default("confirmed"),
    )
    .addOption(
      new Option(
        "--rank <provider>",
        "Optional semantic ranking of needs-review findings (default: none / offline). " +
          "jev requires TYPESAFE_API_KEY and sends diff + doc excerpts to TypeSafe AI.",
      )
        .choices(["none", "jev"])
        .default(undefined),
    )
    .option("--cwd <path>", "Repository path (defaults to the current directory)")
    .option(
      "--config <path>",
      "Path to doc-lag.config.json / .doc-lag.json (defaults to auto-discover under --cwd)",
    )
    .option(
      "--docs-include <glob>",
      "Documentation include glob (repeatable; replaces defaults/config include when set)",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option(
      "--docs-exclude <glob>",
      "Documentation exclude glob (repeatable; replaces defaults/config exclude when set)",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option(
      "--docs-sync",
      "Force-enable the docs-sync check (overrides config / DOC_LAG_DOCS_SYNC)",
    )
    .option(
      "--no-docs-sync",
      "Force-disable the docs-sync check (overrides config / DOC_LAG_DOCS_SYNC)",
    )
    .option(
      "--docs-sync-enforce",
      "Fail the scan when docs.missing findings exist under --fail-on confirmed (implies --docs-sync)",
    )
    .addHelpText(
      "after",
      `
Exit codes:
  0  no blocking findings (or --fail-on none)
  1  at least one finding at the configured threshold
  2  usage, configuration, or execution error

Examples:
  doc-lag scan --base main --head HEAD
  doc-lag scan --base origin/main --head HEAD --format json --fail-on confirmed
  doc-lag scan --base main --head HEAD --rank jev   # requires TYPESAFE_API_KEY
  doc-lag scan --base main --docs-include "packages/*/README.md"
  doc-lag scan --base main --docs-sync              # pairing rules / surface check

Config:
  doc-lag.config.json / .doc-lag.json   docs.include / docs.exclude / docsSync
  DOC_LAG_CONFIG=<path>                 same as --config when the flag is omitted
  DOC_LAG_RANK=jev                      same as --rank jev when the flag is omitted
  DOC_LAG_DOCS_SYNC=true|false          enable docs-sync when the flag is omitted
  DOC_LAG_DOCS_SYNC_ENFORCE=true|false  enforce docs.missing when the flag is omitted

Docs discovery defaults cover root README/AGENTS/CLAUDE/CONTRIBUTING, docs/**,
website/docs, apps/docs, **/README.md, content/** (md+mdx). See README
"What counts as documentation". Docs-sync is off by default; enable with
docsSync in config or --docs-sync (default ignore: scripts/examples/tests).
`,
    )
    .action(
      async (opts: {
        base: string;
        head: string;
        format: OutputFormat;
        failOn: FailOn;
        rank?: string;
        cwd?: string;
        config?: string;
        docsInclude?: string[];
        docsExclude?: string[];
        docsSync?: boolean;
        docsSyncEnforce?: boolean;
      }) => {
        const docsSyncFlags = resolveDocsSyncCliFlags(opts);
        const result = await runScanCommand({
          base: opts.base,
          head: opts.head,
          format: opts.format,
          failOn: opts.failOn,
          cwd: opts.cwd ?? process.cwd(),
          rank: resolveRankOption(opts.rank, process.env),
          env: process.env,
          configPath: resolveConfigPathOption(opts.config, process.env),
          docsInclude:
            opts.docsInclude && opts.docsInclude.length > 0 ? opts.docsInclude : undefined,
          docsExclude:
            opts.docsExclude && opts.docsExclude.length > 0 ? opts.docsExclude : undefined,
          docsSync: docsSyncFlags.docsSync,
          docsSyncEnforce: docsSyncFlags.docsSyncEnforce,
        });
        process.stdout.write(result.output);
        process.exitCode = result.exitCode;
      },
    );

  program
    .command("mcp")
    .description(
      "Start the read-only MCP server over stdio (for Cursor, Claude Code, VS Code, Codex). Does not write to stdout except MCP messages.",
    )
    .option("--cwd <path>", "Workspace root used to constrain tool path arguments")
    .addHelpText(
      "after",
      `
Examples:
  doc-lag mcp
  doc-lag mcp --cwd /path/to/repo
`,
    )
    .action(async (opts: { cwd?: string }) => {
      const { runMcpStdio } = await import("./mcp/stdio.js");
      await runMcpStdio({
        workspaceRoot: path.resolve(opts.cwd ?? process.cwd()),
      });
    });

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = createProgram();
  program.configureOutput({
    writeOut: (str) => process.stdout.write(str),
    writeErr: (str) => process.stderr.write(str),
  });
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof ScanError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    if (isCommanderError(error)) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        process.exitCode = 0;
        return;
      }
      process.exitCode = 2;
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  }
}

function isCommanderError(error: unknown): error is { code: string; message: string } {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string",
  );
}

const isEntry = isEntryPoint(process.argv[1], import.meta.url);

if (isEntry) {
  void runCli(process.argv);
}
