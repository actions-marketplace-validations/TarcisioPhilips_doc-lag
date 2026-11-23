import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ScanError } from "../errors.js";

/** Same filenames as docs-config; kept local to avoid an import cycle. */
const CONFIG_FILENAMES = ["doc-lag.config.json", ".doc-lag.json"] as const;

/** Public surface kinds extracted by docs-sync detectors. */
export const SURFACE_KINDS = [
  "action.input",
  "action.output",
  "package.bin",
  "package.exports",
  "cli.flag",
  "cli.command",
  "cli.argv",
  "mcp.tool",
  "env.added",
] as const;

export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export const CHANGE_KINDS = ["added", "modified", "renamed", "deleted"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const DEFAULT_RULE_CHANGE_KINDS: readonly ChangeKind[] = [
  "added",
  "modified",
  "renamed",
];

export const DEFAULT_DOCS_SYNC_SKIP_LABELS: readonly string[] = ["no-docs-needed"];
export const DEFAULT_DOCS_SYNC_SKIP_TRAILER = "Docs-Not-Needed";
export const DEFAULT_MAX_FINDINGS = 50;
export const DEFAULT_PACKAGES: readonly string[] = ["packages/*", "apps/*"];

/** Built-in code excludes always applied to docs-sync candidates. */
export const DEFAULT_CODE_EXCLUDE: readonly string[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/coverage/**",
  "**/vendor/**",
  "**/.venv/**",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/fixtures/**",
  "**/__fixtures__/**",
  "**/examples/**",
  "**/example/**",
  "**/testdata/**",
];

const ACTION_YML_PATHS = [
  "action.yml",
  "action.yaml",
  "**/action.yml",
  "**/action.yaml",
] as const;

const PACKAGE_JSON_PATHS = ["package.json", "**/package.json"] as const;

const CLI_SOURCE_PATHS = ["**/*.{ts,tsx,js,mjs,cjs,py}"] as const;

const ENV_EXAMPLE_PATHS = [
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.local.example",
  ".env.development.example",
  ".env.production.example",
  "**/.env.example",
  "**/.env.sample",
  "**/.env.template",
  "**/.env.local.example",
  "**/.env.development.example",
  "**/.env.production.example",
] as const;

export const DEFAULT_DETECTOR_PATHS: Readonly<Record<SurfaceKind, readonly string[]>> = {
  "action.input": ACTION_YML_PATHS,
  "action.output": ACTION_YML_PATHS,
  "package.bin": PACKAGE_JSON_PATHS,
  "package.exports": PACKAGE_JSON_PATHS,
  "cli.flag": CLI_SOURCE_PATHS,
  "cli.command": CLI_SOURCE_PATHS,
  "cli.argv": CLI_SOURCE_PATHS,
  "mcp.tool": CLI_SOURCE_PATHS,
  "env.added": ENV_EXAMPLE_PATHS,
};

export const DEFAULT_DETECTOR_ENABLED: Readonly<Record<SurfaceKind, boolean>> = {
  "action.input": true,
  "action.output": true,
  "package.bin": true,
  "package.exports": false,
  "cli.flag": true,
  "cli.command": true,
  "cli.argv": false,
  "mcp.tool": true,
  "env.added": false,
};

const DOCS_SYNC_KEYS = new Set([
  "enabled",
  "enforce",
  "skipLabels",
  "skipTrailer",
  "ignore",
  "ignoreSymbols",
  "detectors",
  "rules",
  "packages",
  "maxFindings",
]);

const DETECTOR_OBJECT_KEYS = new Set(["enabled", "paths", "docs"]);

const RULE_KEYS = new Set([
  "name",
  "code",
  "docs",
  "exclude",
  "changeKinds",
  "perPackage",
  "message",
]);

const RULE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SURFACE_KIND_SET = new Set<string>(SURFACE_KINDS);
const CHANGE_KIND_SET = new Set<string>(CHANGE_KINDS);

export interface DetectorConfig {
  enabled: boolean;
  paths: string[];
  /** When set, mentions must appear in a matching doc. Absent = all in-scope docs. */
  docs?: string[];
}

export interface DocsSyncRule {
  name: string;
  code: string[];
  docs: string[];
  exclude: string[];
  changeKinds: ChangeKind[];
  perPackage: boolean;
  message?: string;
}

/** Fully resolved docs-sync configuration. */
export interface DocsSyncConfig {
  enabled: boolean;
  enforce: boolean;
  skipLabels: string[];
  skipTrailer: string;
  ignore: string[];
  ignoreSymbols: string[];
  detectors: Record<SurfaceKind, DetectorConfig>;
  rules: DocsSyncRule[];
  packages: string[];
  maxFindings: number;
}

/** Validated file-layer / partial docsSync section (before defaults merge). */
export interface DocsSyncConfigFile {
  enabled?: boolean;
  enforce?: boolean;
  skipLabels?: string[];
  skipTrailer?: string;
  ignore?: string[];
  ignoreSymbols?: string[];
  detectors?: Partial<Record<SurfaceKind, Partial<DetectorConfig>>>;
  rules?: DocsSyncRuleFile[];
  packages?: string[];
  maxFindings?: number;
}

export interface DocsSyncRuleFile {
  name: string;
  code: string[];
  docs: string[];
  exclude?: string[];
  changeKinds?: ChangeKind[];
  perPackage?: boolean;
  message?: string;
}

export interface DocsSyncEnvOverrides {
  enabled?: boolean;
  enforce?: boolean;
}

export interface DocsSyncOverrides {
  /** Explicit config file path (relative to cwd or absolute). */
  configPath?: string;
  /** Pre-parsed docsSync file layer; when set, skips disk discovery/load. */
  docsSync?: DocsSyncConfigFile;
  /** CLI/Action/MCP enabled override. */
  enabled?: boolean;
  /** CLI/Action/MCP enforce override. */
  enforce?: boolean;
  /** Action docs-sync-skip-labels override (replaces). */
  skipLabels?: string[];
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
}

function discoverDocsSyncConfigPath(
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

function loadDocsSyncFromFile(filePath: string): DocsSyncConfigFile | undefined {
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
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ScanError(`Invalid config ${filePath}: expected a JSON object`);
  }
  const body = parsed as Record<string, unknown>;
  if (body.docsSync === undefined) {
    return undefined;
  }
  return parseDocsSyncSection(body.docsSync, filePath);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function trimGlobList(values: string[]): string[] {
  return values.map((item) => item.trim()).filter(Boolean);
}

function assertNoUnknownKeys(
  body: Record<string, unknown>,
  allowed: Set<string>,
  sourceLabel: string,
  pathLabel: string,
): void {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new ScanError(
        `Invalid config ${sourceLabel}: unknown key "${key}" under ${pathLabel}`,
      );
    }
  }
}

function isSurfaceKind(value: string): value is SurfaceKind {
  return SURFACE_KIND_SET.has(value);
}

function parseIgnoreSymbol(entry: string, sourceLabel: string, index: number): string {
  const trimmed = entry.trim();
  if (!trimmed) {
    throw new ScanError(
      `Invalid config ${sourceLabel}: "docsSync.ignoreSymbols[${index}]" must be "<kind>:<name>" or "<kind>:<name>@<glob>"`,
    );
  }
  const atIndex = trimmed.indexOf("@");
  const main = atIndex === -1 ? trimmed : trimmed.slice(0, atIndex);
  const glob = atIndex === -1 ? undefined : trimmed.slice(atIndex + 1);
  const colon = main.indexOf(":");
  if (colon <= 0) {
    throw new ScanError(
      `Invalid config ${sourceLabel}: "docsSync.ignoreSymbols[${index}]" must be "<kind>:<name>" or "<kind>:<name>@<glob>"`,
    );
  }
  const kind = main.slice(0, colon);
  const name = main.slice(colon + 1);
  if (!isSurfaceKind(kind) || name.length === 0) {
    throw new ScanError(
      `Invalid config ${sourceLabel}: "docsSync.ignoreSymbols[${index}]" must use a known kind and non-empty name`,
    );
  }
  if (glob !== undefined && glob.length === 0) {
    throw new ScanError(
      `Invalid config ${sourceLabel}: "docsSync.ignoreSymbols[${index}]" path glob after @ must be non-empty`,
    );
  }
  return trimmed;
}

function parseDetectorEntry(
  kind: SurfaceKind,
  value: unknown,
  sourceLabel: string,
): Partial<DetectorConfig> {
  const keyPath = `docsSync.detectors.${kind}`;
  if (typeof value === "boolean") {
    return { enabled: value };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ScanError(
      `Invalid config ${sourceLabel}: "${keyPath}" must be a boolean or object`,
    );
  }
  const body = value as Record<string, unknown>;
  assertNoUnknownKeys(body, DETECTOR_OBJECT_KEYS, sourceLabel, keyPath);
  const result: Partial<DetectorConfig> = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "${keyPath}.enabled" must be a boolean`,
      );
    }
    result.enabled = body.enabled;
  }
  if (body.paths !== undefined) {
    if (!isStringArray(body.paths)) {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "${keyPath}.paths" must be an array of strings`,
      );
    }
    const paths = trimGlobList(body.paths);
    if (paths.length === 0) {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "${keyPath}.paths" must be a non-empty array of strings`,
      );
    }
    result.paths = paths;
  }
  if (body.docs !== undefined) {
    if (!isStringArray(body.docs)) {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "${keyPath}.docs" must be an array of strings`,
      );
    }
    const docs = trimGlobList(body.docs);
    if (docs.length === 0) {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "${keyPath}.docs" must be a non-empty array of strings`,
      );
    }
    result.docs = docs;
  }
  return result;
}

function parseRule(
  value: unknown,
  sourceLabel: string,
  index: number,
): DocsSyncRuleFile {
  const keyPath = `docsSync.rules[${index}]`;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ScanError(`Invalid config ${sourceLabel}: "${keyPath}" must be an object`);
  }
  const body = value as Record<string, unknown>;
  assertNoUnknownKeys(body, RULE_KEYS, sourceLabel, keyPath);

  if (typeof body.name !== "string" || !RULE_NAME_PATTERN.test(body.name)) {
    throw new ScanError(
      `Invalid config ${sourceLabel}: "${keyPath}.name" must match /^[a-z0-9][a-z0-9-]*$/`,
    );
  }
  if (!isStringArray(body.code)) {
    throw new ScanError(
      `Invalid config ${sourceLabel}: "${keyPath}.code" must be an array of strings`,
    );
  }
  const code = trimGlobList(body.code);
  if (code.length === 0) {
    throw new ScanError(
      `Invalid config ${sourceLabel}: "${keyPath}.code" must be a non-empty array of strings`,
    );
  }
  if (!isStringArray(body.docs)) {
    throw new ScanError(
      `Invalid config ${sourceLabel}: "${keyPath}.docs" must be an array of strings`,
    );
  }
  const docs = trimGlobList(body.docs);
  if (docs.length === 0) {
    throw new ScanError(
      `Invalid config ${sourceLabel}: "${keyPath}.docs" must be a non-empty array of strings`,
    );
  }

  const rule: DocsSyncRuleFile = { name: body.name, code, docs };

  if (body.exclude !== undefined) {
    if (!isStringArray(body.exclude)) {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "${keyPath}.exclude" must be an array of strings`,
      );
    }
    rule.exclude = trimGlobList(body.exclude);
  }
  if (body.changeKinds !== undefined) {
    if (!Array.isArray(body.changeKinds) || body.changeKinds.some((k) => typeof k !== "string")) {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "${keyPath}.changeKinds" must be an array of strings`,
      );
    }
    const kinds: ChangeKind[] = [];
    for (const kind of body.changeKinds as string[]) {
      if (!CHANGE_KIND_SET.has(kind)) {
        throw new ScanError(
          `Invalid config ${sourceLabel}: "${keyPath}.changeKinds" contains unknown value "${kind}"`,
        );
      }
      kinds.push(kind as ChangeKind);
    }
    rule.changeKinds = kinds;
  }
  if (body.perPackage !== undefined) {
    if (typeof body.perPackage !== "boolean") {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "${keyPath}.perPackage" must be a boolean`,
      );
    }
    rule.perPackage = body.perPackage;
  }
  if (body.message !== undefined) {
    if (typeof body.message !== "string") {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "${keyPath}.message" must be a string`,
      );
    }
    rule.message = body.message;
  }
  return rule;
}

/**
 * Parse and validate a `docsSync` config object (already JSON-parsed).
 * Presence of the object without `enabled` means enabled (owner Q2).
 */
export function parseDocsSyncSection(raw: unknown, sourceLabel: string): DocsSyncConfigFile {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ScanError(`Invalid config ${sourceLabel}: "docsSync" must be an object`);
  }
  const body = raw as Record<string, unknown>;
  assertNoUnknownKeys(body, DOCS_SYNC_KEYS, sourceLabel, "docsSync");

  const result: DocsSyncConfigFile = {
    // Presence of the docsSync object implies enabled unless explicitly false.
    enabled: true,
  };

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "docsSync.enabled" must be a boolean`,
      );
    }
    result.enabled = body.enabled;
  }
  if (body.enforce !== undefined) {
    if (typeof body.enforce !== "boolean") {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "docsSync.enforce" must be a boolean`,
      );
    }
    result.enforce = body.enforce;
  }
  if (body.skipLabels !== undefined) {
    if (!isStringArray(body.skipLabels)) {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "docsSync.skipLabels" must be an array of strings`,
      );
    }
    result.skipLabels = trimGlobList(body.skipLabels);
  }
  if (body.skipTrailer !== undefined) {
    if (typeof body.skipTrailer !== "string" || body.skipTrailer.trim() === "") {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "docsSync.skipTrailer" must be a non-empty string`,
      );
    }
    result.skipTrailer = body.skipTrailer.trim();
  }
  if (body.ignore !== undefined) {
    if (!isStringArray(body.ignore)) {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "docsSync.ignore" must be an array of strings`,
      );
    }
    result.ignore = trimGlobList(body.ignore);
  }
  if (body.ignoreSymbols !== undefined) {
    if (!isStringArray(body.ignoreSymbols)) {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "docsSync.ignoreSymbols" must be an array of strings`,
      );
    }
    result.ignoreSymbols = body.ignoreSymbols.map((entry, index) =>
      parseIgnoreSymbol(entry, sourceLabel, index),
    );
  }
  if (body.detectors !== undefined) {
    if (
      body.detectors === null ||
      typeof body.detectors !== "object" ||
      Array.isArray(body.detectors)
    ) {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "docsSync.detectors" must be an object`,
      );
    }
    const detectorsRaw = body.detectors as Record<string, unknown>;
    const detectors: Partial<Record<SurfaceKind, Partial<DetectorConfig>>> = {};
    for (const [key, value] of Object.entries(detectorsRaw)) {
      if (!isSurfaceKind(key)) {
        throw new ScanError(
          `Invalid config ${sourceLabel}: unknown detector id "${key}" under docsSync.detectors (valid: ${SURFACE_KINDS.join(", ")})`,
        );
      }
      detectors[key] = parseDetectorEntry(key, value, sourceLabel);
    }
    result.detectors = detectors;
  }
  if (body.rules !== undefined) {
    if (!Array.isArray(body.rules)) {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "docsSync.rules" must be an array`,
      );
    }
    const rules = body.rules.map((rule, index) => parseRule(rule, sourceLabel, index));
    const seen = new Set<string>();
    for (const rule of rules) {
      if (seen.has(rule.name)) {
        throw new ScanError(
          `Invalid config ${sourceLabel}: duplicate docsSync rule name "${rule.name}"`,
        );
      }
      seen.add(rule.name);
    }
    result.rules = rules;
  }
  if (body.packages !== undefined) {
    if (!isStringArray(body.packages)) {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "docsSync.packages" must be an array of strings`,
      );
    }
    result.packages = trimGlobList(body.packages);
  }
  if (body.maxFindings !== undefined) {
    if (
      typeof body.maxFindings !== "number" ||
      !Number.isInteger(body.maxFindings) ||
      body.maxFindings < 1 ||
      body.maxFindings > 1000
    ) {
      throw new ScanError(
        `Invalid config ${sourceLabel}: "docsSync.maxFindings" must be an integer from 1 to 1000`,
      );
    }
    result.maxFindings = body.maxFindings;
  }

  return result;
}

/** Built-in defaults: docsSync off when absent from config. */
export function createDefaultDocsSyncConfig(): DocsSyncConfig {
  const detectors = {} as Record<SurfaceKind, DetectorConfig>;
  for (const kind of SURFACE_KINDS) {
    detectors[kind] = {
      enabled: DEFAULT_DETECTOR_ENABLED[kind],
      paths: [...DEFAULT_DETECTOR_PATHS[kind]],
    };
  }
  return {
    enabled: false,
    enforce: false,
    skipLabels: [...DEFAULT_DOCS_SYNC_SKIP_LABELS],
    skipTrailer: DEFAULT_DOCS_SYNC_SKIP_TRAILER,
    ignore: [],
    ignoreSymbols: [],
    detectors,
    rules: [],
    packages: [...DEFAULT_PACKAGES],
    maxFindings: DEFAULT_MAX_FINDINGS,
  };
}

function applyFileLayer(
  current: DocsSyncConfig,
  layer: DocsSyncConfigFile | undefined,
): DocsSyncConfig {
  if (!layer) {
    return current;
  }

  const detectors = { ...current.detectors };
  if (layer.detectors) {
    for (const kind of SURFACE_KINDS) {
      const override = layer.detectors[kind];
      if (!override) {
        continue;
      }
      detectors[kind] = {
        enabled: override.enabled ?? detectors[kind].enabled,
        paths: override.paths ? [...override.paths] : [...detectors[kind].paths],
        docs: override.docs ? [...override.docs] : detectors[kind].docs,
      };
      if (override.docs === undefined && detectors[kind].docs === undefined) {
        delete detectors[kind].docs;
      }
    }
  }

  const rules =
    layer.rules !== undefined
      ? layer.rules.map((rule) => ({
          name: rule.name,
          code: [...rule.code],
          docs: [...rule.docs],
          exclude: rule.exclude ? [...rule.exclude] : [],
          changeKinds: rule.changeKinds
            ? [...rule.changeKinds]
            : [...DEFAULT_RULE_CHANGE_KINDS],
          perPackage: rule.perPackage ?? false,
          ...(rule.message !== undefined ? { message: rule.message } : {}),
        }))
      : current.rules.map((rule) => ({
          ...rule,
          code: [...rule.code],
          docs: [...rule.docs],
          exclude: [...rule.exclude],
          changeKinds: [...rule.changeKinds],
        }));

  return {
    enabled: layer.enabled !== undefined ? layer.enabled : current.enabled,
    enforce: layer.enforce !== undefined ? layer.enforce : current.enforce,
    skipLabels:
      layer.skipLabels !== undefined ? [...layer.skipLabels] : [...current.skipLabels],
    skipTrailer: layer.skipTrailer !== undefined ? layer.skipTrailer : current.skipTrailer,
    ignore: layer.ignore !== undefined ? [...layer.ignore] : [...current.ignore],
    ignoreSymbols:
      layer.ignoreSymbols !== undefined
        ? [...layer.ignoreSymbols]
        : [...current.ignoreSymbols],
    detectors,
    rules,
    packages: layer.packages !== undefined ? [...layer.packages] : [...current.packages],
    maxFindings:
      layer.maxFindings !== undefined ? layer.maxFindings : current.maxFindings,
  };
}

/**
 * Parse `true` / `false` / empty for docs-sync env vars.
 * Invalid values throw ScanError (exit 2).
 */
export function parseDocsSyncBoolean(
  raw: string | undefined,
  envName = "value",
): boolean | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return undefined;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new ScanError(
    `Invalid ${envName} value "${raw}" (expected true|false)`,
  );
}

/** Read docs-sync overrides from environment variables. */
export function parseDocsSyncEnv(env: NodeJS.ProcessEnv = process.env): DocsSyncEnvOverrides {
  const result: DocsSyncEnvOverrides = {};
  const enabled = parseDocsSyncBoolean(env.DOC_LAG_DOCS_SYNC, "DOC_LAG_DOCS_SYNC");
  if (enabled !== undefined) {
    result.enabled = enabled;
  }
  const enforce = parseDocsSyncBoolean(
    env.DOC_LAG_DOCS_SYNC_ENFORCE,
    "DOC_LAG_DOCS_SYNC_ENFORCE",
  );
  if (enforce !== undefined) {
    result.enforce = enforce;
  }
  return result;
}

/**
 * Resolve effective docs-sync options.
 * Precedence: explicit overrides → environment → config file → built-in defaults.
 * Arrays replace per key (never merge). Only enabled / enforce / skipLabels are
 * overridable outside the config file in v1.
 */
export function resolveDocsSyncConfig(
  cwd: string,
  overrides: DocsSyncOverrides = {},
): DocsSyncConfig {
  let resolved = createDefaultDocsSyncConfig();

  let fileLayer = overrides.docsSync;
  if (fileLayer === undefined) {
    const explicitConfig =
      overrides.configPath !== undefined && overrides.configPath.trim() !== ""
        ? path.isAbsolute(overrides.configPath)
          ? overrides.configPath
          : path.resolve(cwd, overrides.configPath)
        : undefined;

    const configPath = explicitConfig ?? discoverDocsSyncConfigPath(cwd, overrides.warn);
    if (configPath !== undefined) {
      if (explicitConfig && !existsSync(explicitConfig)) {
        throw new ScanError(`Config file not found: ${explicitConfig}`);
      }
      fileLayer = loadDocsSyncFromFile(configPath);
    }
  }

  resolved = applyFileLayer(resolved, fileLayer);

  const envLayer = parseDocsSyncEnv(overrides.env ?? process.env);
  if (envLayer.enabled !== undefined) {
    resolved = { ...resolved, enabled: envLayer.enabled };
  }
  if (envLayer.enforce !== undefined) {
    resolved = { ...resolved, enforce: envLayer.enforce };
  }

  if (overrides.enabled !== undefined) {
    resolved = { ...resolved, enabled: overrides.enabled };
  }
  if (overrides.enforce !== undefined) {
    resolved = { ...resolved, enforce: overrides.enforce };
  }
  if (overrides.skipLabels !== undefined) {
    resolved = { ...resolved, skipLabels: [...overrides.skipLabels] };
  }

  return resolved;
}
