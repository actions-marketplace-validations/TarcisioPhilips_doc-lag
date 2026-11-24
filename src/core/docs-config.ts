import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ScanError } from "../errors.js";
import type { DocsDiscoveryOptions } from "../types.js";
import {
  parseDocsSyncSection,
  type DocsSyncConfigFile,
} from "./docs-sync-config.js";

export type { DocsDiscoveryOptions };

export interface DocLagConfigFile {
  docs?: Partial<DocsDiscoveryOptions>;
  docsSync?: DocsSyncConfigFile;
}

export interface DocsConfigOverrides {
  /** Explicit config file path (relative to cwd or absolute). */
  configPath?: string;
  /** When set (including empty array attempt), replaces include from lower layers. */
  include?: string[];
  /** When set, replaces exclude from lower layers. */
  exclude?: string[];
  warn?: (message: string) => void;
}

/** Built-in include globs (Step 1 defaults). */
export const DEFAULT_DOCS_INCLUDE: readonly string[] = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "docs/**/*.{md,mdx}",
  "documentation/**/*.{md,mdx}",
  "website/docs/**/*.{md,mdx}",
  "website/src/pages/**/*.{md,mdx}",
  "apps/docs/**/*.{md,mdx}",
  // Nested package/server READMEs (monorepos, MCP servers, src/*/README.md)
  "**/README.md",
  "packages/*/docs/**/*.{md,mdx}",
  "content/**/*.{md,mdx}",
];

/** Built-in exclude globs (generated trees + noisy non-instructional docs). */
export const DEFAULT_DOCS_EXCLUDE: readonly string[] = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/out/**",
  "**/coverage/**",
  "**/vendor/**",
  "**/.venv/**",
  "**/site/**",
  "**/_site/**",
  "**/CHANGELOG.md",
  "**/CHANGELOG.mdx",
  "**/LICENSE.md",
];

export const CONFIG_FILENAMES = ["doc-lag.config.json", ".doc-lag.json"] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Parse and validate a doc-lag config object (already JSON-parsed).
 */
export function parseDocLagConfig(raw: unknown, sourceLabel: string): DocLagConfigFile {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ScanError(`Invalid config ${sourceLabel}: expected a JSON object`);
  }
  const body = raw as Record<string, unknown>;
  const result: DocLagConfigFile = {};

  if (body.docs !== undefined) {
    if (body.docs === null || typeof body.docs !== "object" || Array.isArray(body.docs)) {
      throw new ScanError(`Invalid config ${sourceLabel}: "docs" must be an object`);
    }
    const docs = body.docs as Record<string, unknown>;
    result.docs = {};
    if (docs.include !== undefined) {
      if (!isStringArray(docs.include)) {
        throw new ScanError(
          `Invalid config ${sourceLabel}: "docs.include" must be an array of strings`,
        );
      }
      result.docs.include = docs.include.map((item) => item.trim()).filter(Boolean);
    }
    if (docs.exclude !== undefined) {
      if (!isStringArray(docs.exclude)) {
        throw new ScanError(
          `Invalid config ${sourceLabel}: "docs.exclude" must be an array of strings`,
        );
      }
      result.docs.exclude = docs.exclude.map((item) => item.trim()).filter(Boolean);
    }
  }

  if (body.docsSync !== undefined) {
    result.docsSync = parseDocsSyncSection(body.docsSync, sourceLabel);
  }

  return result;
}

export function loadConfigFile(filePath: string): DocLagConfigFile {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ScanError(`Unable to read config ${filePath}: ${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ScanError(`Invalid JSON in config ${filePath}: ${message}`);
  }
  return parseDocLagConfig(parsed, filePath);
}

/**
 * Auto-discover config under `cwd`. Prefer `doc-lag.config.json` over `.doc-lag.json`.
 */
export function discoverConfigPath(
  cwd: string,
  warn?: (message: string) => void,
): string | undefined {
  const primary = path.join(cwd, CONFIG_FILENAMES[0]);
  const secondary = path.join(cwd, CONFIG_FILENAMES[1]);
  const primaryExists = existsSync(primary);
  const secondaryExists = existsSync(secondary);
  if (primaryExists && secondaryExists) {
    warn?.(
      `doc-lag: both ${CONFIG_FILENAMES[0]} and ${CONFIG_FILENAMES[1]} exist; using ${CONFIG_FILENAMES[0]}`,
    );
  }
  if (primaryExists) {
    return primary;
  }
  if (secondaryExists) {
    return secondary;
  }
  return undefined;
}

function applyLayer(
  current: DocsDiscoveryOptions,
  layer: Partial<DocsDiscoveryOptions> | undefined,
): DocsDiscoveryOptions {
  if (!layer) {
    return current;
  }
  return {
    include: layer.include !== undefined ? [...layer.include] : current.include,
    exclude: layer.exclude !== undefined ? [...layer.exclude] : current.exclude,
  };
}

/**
 * Resolve effective docs discovery options.
 * Precedence: overrides → config file → built-in defaults (replace per key).
 */
export function resolveDocsDiscoveryOptions(
  cwd: string,
  overrides: DocsConfigOverrides = {},
): DocsDiscoveryOptions {
  let resolved: DocsDiscoveryOptions = {
    include: [...DEFAULT_DOCS_INCLUDE],
    exclude: [...DEFAULT_DOCS_EXCLUDE],
  };

  const explicitConfig =
    overrides.configPath !== undefined && overrides.configPath.trim() !== ""
      ? path.isAbsolute(overrides.configPath)
        ? overrides.configPath
        : path.resolve(cwd, overrides.configPath)
      : undefined;

  const configPath = explicitConfig ?? discoverConfigPath(cwd, overrides.warn);
  if (configPath !== undefined) {
    if (explicitConfig && !existsSync(explicitConfig)) {
      throw new ScanError(`Config file not found: ${explicitConfig}`);
    }
    const fileConfig = loadConfigFile(configPath);
    resolved = applyLayer(resolved, fileConfig.docs);
  }

  resolved = applyLayer(resolved, {
    include: overrides.include,
    exclude: overrides.exclude,
  });

  if (resolved.include.length === 0) {
    throw new ScanError("docs.include resolved empty; provide at least one include glob");
  }

  return resolved;
}

/** Split Action / env multi-value strings on commas or newlines. */
export function parseGlobList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return undefined;
  }
  const items = trimmed
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}
