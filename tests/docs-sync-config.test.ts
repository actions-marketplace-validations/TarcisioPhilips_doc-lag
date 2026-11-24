import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocLagConfig } from "../src/core/docs-config.js";
import {
  DEFAULT_CODE_EXCLUDE,
  DEFAULT_DOCS_SYNC_IGNORE,
  DEFAULT_DOCS_SYNC_SKIP_LABELS,
  DEFAULT_DOCS_SYNC_SKIP_TRAILER,
  DEFAULT_MAX_FINDINGS,
  SURFACE_KINDS,
  createDefaultDocsSyncConfig,
  parseDocsSyncBoolean,
  parseDocsSyncEnv,
  parseDocsSyncSection,
  resolveDocsSyncConfig,
} from "../src/core/docs-sync-config.js";
import { ScanError } from "../src/errors.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "doc-lag-docs-sync-"));
  tempDirs.push(dir);
  return dir;
}

describe("createDefaultDocsSyncConfig", () => {
  it("is disabled with §7.2 defaults", () => {
    const defaults = createDefaultDocsSyncConfig();
    expect(defaults.enabled).toBe(false);
    expect(defaults.enforce).toBe(false);
    expect(defaults.skipLabels).toEqual([...DEFAULT_DOCS_SYNC_SKIP_LABELS]);
    expect(defaults.skipTrailer).toBe(DEFAULT_DOCS_SYNC_SKIP_TRAILER);
    expect(defaults.ignore).toEqual([...DEFAULT_DOCS_SYNC_IGNORE]);
    expect(defaults.ignoreSymbols).toEqual([]);
    expect(defaults.rules).toEqual([]);
    expect(defaults.packages).toEqual(["packages/*", "apps/*"]);
    expect(defaults.maxFindings).toBe(DEFAULT_MAX_FINDINGS);
    expect(defaults.detectors["action.input"].enabled).toBe(true);
    expect(defaults.detectors["package.exports"].enabled).toBe(false);
    expect(defaults.detectors["env.added"].enabled).toBe(false);
    expect(defaults.detectors["cli.argv"].enabled).toBe(false);
    expect(defaults.detectors["cli.flag"].enabled).toBe(true);
    expect(DEFAULT_CODE_EXCLUDE).toContain("**/node_modules/**");
    expect(DEFAULT_DOCS_SYNC_IGNORE).toContain("**/scripts/**");
    expect(DEFAULT_DOCS_SYNC_IGNORE).toContain("**/tests/**");
    expect(DEFAULT_DOCS_SYNC_IGNORE).toContain("**/examples/**");
    expect(DEFAULT_CODE_EXCLUDE).not.toContain("**/tests/**");
  });
});

describe("parseDocsSyncSection / parseDocLagConfig", () => {
  it("config-docsSync-empty-object-enables: empty object enables with defaults", () => {
    const section = parseDocsSyncSection({}, "x");
    expect(section.enabled).toBe(true);

    const file = parseDocLagConfig({ docsSync: {} }, "x");
    expect(file.docsSync?.enabled).toBe(true);
  });

  it("config-enabled-false: enabled false disables even with other keys", () => {
    const section = parseDocsSyncSection(
      {
        enabled: false,
        enforce: true,
        detectors: { "env.added": true },
      },
      "x",
    );
    expect(section.enabled).toBe(false);
    expect(section.enforce).toBe(true);
    expect(section.detectors?.["env.added"]).toEqual({ enabled: true });
  });

  it("accepts boolean and object detector shorthand", () => {
    const section = parseDocsSyncSection(
      {
        detectors: {
          "cli.flag": { enabled: true, paths: ["src/**"], docs: ["README.md"] },
          "env.added": true,
          "package.exports": false,
        },
      },
      "x",
    );
    expect(section.detectors?.["cli.flag"]).toEqual({
      enabled: true,
      paths: ["src/**"],
      docs: ["README.md"],
    });
    expect(section.detectors?.["env.added"]).toEqual({ enabled: true });
    expect(section.detectors?.["package.exports"]).toEqual({ enabled: false });
  });

  it("accepts a valid pairing rule", () => {
    const section = parseDocsSyncSection(
      {
        rules: [
          {
            name: "cli",
            code: ["src/cli/**"],
            docs: ["README.md", "docs/**"],
            exclude: ["src/cli/**/*.test.ts"],
            changeKinds: ["added", "modified", "renamed"],
            perPackage: false,
            message: "CLI changed; update the CLI reference.",
          },
        ],
      },
      "x",
    );
    expect(section.rules).toHaveLength(1);
    expect(section.rules?.[0]?.name).toBe("cli");
  });

  it("trims globs and drops empty strings", () => {
    const section = parseDocsSyncSection(
      {
        ignore: ["  dist/**  ", "", "  "],
        skipLabels: [" no-docs-needed ", ""],
        packages: [" packages/* ", ""],
        rules: [{ name: "api", code: [" app/** ", ""], docs: [" docs/** ", ""] }],
      },
      "x",
    );
    expect(section.ignore).toEqual(["dist/**"]);
    expect(section.skipLabels).toEqual(["no-docs-needed"]);
    expect(section.packages).toEqual(["packages/*"]);
    expect(section.rules?.[0]?.code).toEqual(["app/**"]);
    expect(section.rules?.[0]?.docs).toEqual(["docs/**"]);
  });

  it("config-unknown-key: rejects unknown keys under docsSync", () => {
    expect(() => parseDocsSyncSection({ detector: true }, "cfg.json")).toThrow(
      /cfg\.json.*"detector"/,
    );
    expect(() =>
      parseDocsSyncSection(
        { detectors: { "cli.flag": { enabled: true, path: ["src/**"] } } },
        "cfg.json",
      ),
    ).toThrow(/path/);
    expect(() =>
      parseDocsSyncSection(
        { rules: [{ name: "x", code: ["a"], docs: ["b"], unknown: 1 }] },
        "cfg.json",
      ),
    ).toThrow(/unknown/);
  });

  it("config-unknown-detector: rejects unknown detector ids", () => {
    expect(() =>
      parseDocsSyncSection({ detectors: { "cli.flags": true } }, "cfg.json"),
    ).toThrow(/cli\.flags/);
    for (const kind of SURFACE_KINDS) {
      expect(() => parseDocsSyncSection({ detectors: { [kind]: true } }, "x")).not.toThrow();
    }
  });

  it("config-duplicate-rule: rejects duplicate rule names", () => {
    expect(() =>
      parseDocsSyncSection(
        {
          rules: [
            { name: "cli", code: ["a"], docs: ["b"] },
            { name: "cli", code: ["c"], docs: ["d"] },
          ],
        },
        "cfg.json",
      ),
    ).toThrow(/duplicate.*cli/i);
  });

  it("rejects invalid rule names, empty arrays, changeKinds, maxFindings", () => {
    expect(() =>
      parseDocsSyncSection({ rules: [{ name: "CLI", code: ["a"], docs: ["b"] }] }, "x"),
    ).toThrow(/name/);
    expect(() =>
      parseDocsSyncSection({ rules: [{ name: "-cli", code: ["a"], docs: ["b"] }] }, "x"),
    ).toThrow(/name/);
    expect(() =>
      parseDocsSyncSection({ rules: [{ name: "cli", code: [], docs: ["b"] }] }, "x"),
    ).toThrow(/code/);
    expect(() =>
      parseDocsSyncSection({ rules: [{ name: "cli", code: ["a"], docs: [] }] }, "x"),
    ).toThrow(/docs/);
    expect(() =>
      parseDocsSyncSection(
        { rules: [{ name: "cli", code: ["a"], docs: ["b"], changeKinds: ["moved"] }] },
        "x",
      ),
    ).toThrow(/changeKinds/);
    expect(() => parseDocsSyncSection({ maxFindings: 0 }, "x")).toThrow(/maxFindings/);
    expect(() => parseDocsSyncSection({ maxFindings: 1001 }, "x")).toThrow(/maxFindings/);
    expect(() => parseDocsSyncSection({ maxFindings: 1.5 }, "x")).toThrow(/maxFindings/);
  });

  it("rejects invalid ignoreSymbols", () => {
    expect(() => parseDocsSyncSection({ ignoreSymbols: ["cli.flag"] }, "x")).toThrow(
      /ignoreSymbols/,
    );
    expect(() => parseDocsSyncSection({ ignoreSymbols: ["nope:--x"] }, "x")).toThrow(
      /ignoreSymbols/,
    );
    expect(() => parseDocsSyncSection({ ignoreSymbols: ["cli.flag:"] }, "x")).toThrow(
      /ignoreSymbols/,
    );
    expect(() =>
      parseDocsSyncSection({ ignoreSymbols: ["cli.flag:--docs-sync"] }, "x"),
    ).not.toThrow();
    expect(() =>
      parseDocsSyncSection({ ignoreSymbols: ["cli.flag:--x@src/**"] }, "x"),
    ).not.toThrow();
  });

  it("rejects non-object docsSync and bad types", () => {
    expect(() => parseDocLagConfig({ docsSync: [] }, "x")).toThrow(/docsSync/);
    expect(() => parseDocsSyncSection({ enabled: "yes" }, "x")).toThrow(/enabled/);
    expect(() => parseDocsSyncSection({ enforce: 1 }, "x")).toThrow(/enforce/);
    expect(() => parseDocsSyncSection({ skipTrailer: 1 }, "x")).toThrow(/skipTrailer/);
    expect(() => parseDocsSyncSection({ ignore: "x" }, "x")).toThrow(/ignore/);
  });

  it("keeps docs parsing working alongside docsSync", () => {
    const file = parseDocLagConfig(
      {
        docs: { include: ["README.md"] },
        docsSync: { enabled: true, maxFindings: 10 },
      },
      "x",
    );
    expect(file.docs?.include).toEqual(["README.md"]);
    expect(file.docsSync?.enabled).toBe(true);
    expect(file.docsSync?.maxFindings).toBe(10);
  });

  it("omits docsSync when absent (FR-1 shape)", () => {
    expect(parseDocLagConfig({}, "x")).toEqual({});
    expect(parseDocLagConfig({ docs: { include: ["a.md"] } }, "x")).toEqual({
      docs: { include: ["a.md"] },
    });
  });
});

describe("parseDocsSyncBoolean / parseDocsSyncEnv", () => {
  it("accepts true/false/empty and rejects other values", () => {
    expect(parseDocsSyncBoolean(undefined)).toBeUndefined();
    expect(parseDocsSyncBoolean("")).toBeUndefined();
    expect(parseDocsSyncBoolean("  ")).toBeUndefined();
    expect(parseDocsSyncBoolean("true")).toBe(true);
    expect(parseDocsSyncBoolean("TRUE")).toBe(true);
    expect(parseDocsSyncBoolean("false")).toBe(false);
    expect(() => parseDocsSyncBoolean("yes", "DOC_LAG_DOCS_SYNC")).toThrow(ScanError);
    expect(() => parseDocsSyncBoolean("1", "DOC_LAG_DOCS_SYNC")).toThrow(/DOC_LAG_DOCS_SYNC/);
  });

  it("reads DOC_LAG_DOCS_SYNC and DOC_LAG_DOCS_SYNC_ENFORCE", () => {
    expect(parseDocsSyncEnv({})).toEqual({});
    expect(parseDocsSyncEnv({ DOC_LAG_DOCS_SYNC: "true" })).toEqual({ enabled: true });
    expect(parseDocsSyncEnv({ DOC_LAG_DOCS_SYNC: "false" })).toEqual({ enabled: false });
    expect(parseDocsSyncEnv({ DOC_LAG_DOCS_SYNC_ENFORCE: "true" })).toEqual({ enforce: true });
    expect(
      parseDocsSyncEnv({
        DOC_LAG_DOCS_SYNC: "true",
        DOC_LAG_DOCS_SYNC_ENFORCE: "false",
      }),
    ).toEqual({ enabled: true, enforce: false });
  });
});

describe("resolveDocsSyncConfig", () => {
  it("FR-1: no docsSync and no overrides → disabled defaults", () => {
    const cwd = tempCwd();
    const resolved = resolveDocsSyncConfig(cwd);
    expect(resolved).toEqual(createDefaultDocsSyncConfig());
    expect(resolved.enabled).toBe(false);
  });

  it("FR-2: docsSync empty object enables with all defaults", () => {
    const cwd = tempCwd();
    writeFileSync(path.join(cwd, "doc-lag.config.json"), JSON.stringify({ docsSync: {} }));
    const resolved = resolveDocsSyncConfig(cwd);
    expect(resolved.enabled).toBe(true);
    expect(resolved.enforce).toBe(false);
    expect(resolved.skipLabels).toEqual(["no-docs-needed"]);
    expect(resolved.detectors["cli.flag"].enabled).toBe(true);
    expect(resolved.detectors["env.added"].enabled).toBe(false);
    expect(resolved.maxFindings).toBe(50);
  });

  it("FR-3: enabled false disables even if other keys present", () => {
    const cwd = tempCwd();
    writeFileSync(
      path.join(cwd, "doc-lag.config.json"),
      JSON.stringify({
        docsSync: { enabled: false, enforce: true, detectors: { "env.added": true } },
      }),
    );
    const resolved = resolveDocsSyncConfig(cwd);
    expect(resolved.enabled).toBe(false);
    expect(resolved.enforce).toBe(true);
    expect(resolved.detectors["env.added"].enabled).toBe(true);
  });

  it("FR-4 / config-env-vs-flag-precedence: env overrides config; flags override env", () => {
    const cwd = tempCwd();
    writeFileSync(
      path.join(cwd, "doc-lag.config.json"),
      JSON.stringify({ docsSync: { enabled: true, enforce: false } }),
    );

    const fromEnv = resolveDocsSyncConfig(cwd, {
      env: { DOC_LAG_DOCS_SYNC: "false", DOC_LAG_DOCS_SYNC_ENFORCE: "true" },
    });
    expect(fromEnv.enabled).toBe(false);
    expect(fromEnv.enforce).toBe(true);

    const fromFlag = resolveDocsSyncConfig(cwd, {
      env: { DOC_LAG_DOCS_SYNC: "false" },
      enabled: true,
      enforce: true,
    });
    expect(fromFlag.enabled).toBe(true);
    expect(fromFlag.enforce).toBe(true);

    const flagDisable = resolveDocsSyncConfig(cwd, {
      env: { DOC_LAG_DOCS_SYNC: "true" },
      enabled: false,
    });
    expect(flagDisable.enabled).toBe(false);
  });

  it("FR-6: arrays from higher layers replace (no merge)", () => {
    const cwd = tempCwd();
    writeFileSync(
      path.join(cwd, "doc-lag.config.json"),
      JSON.stringify({
        docsSync: {
          skipLabels: ["docs-skip", "legacy-skip"],
          ignore: ["vendor/**"],
        },
      }),
    );

    const withOverride = resolveDocsSyncConfig(cwd, {
      skipLabels: ["only-this"],
    });
    expect(withOverride.skipLabels).toEqual(["only-this"]);
    expect(withOverride.ignore).toEqual(["vendor/**"]);
  });

  it("merges detector keys onto defaults without wiping unspecified detectors", () => {
    const cwd = tempCwd();
    writeFileSync(
      path.join(cwd, "doc-lag.config.json"),
      JSON.stringify({
        docsSync: {
          detectors: {
            "env.added": true,
            "cli.flag": { enabled: true, paths: ["src/cli.ts"], docs: ["README.md"] },
          },
        },
      }),
    );
    const resolved = resolveDocsSyncConfig(cwd);
    expect(resolved.detectors["env.added"].enabled).toBe(true);
    expect(resolved.detectors["cli.flag"].paths).toEqual(["src/cli.ts"]);
    expect(resolved.detectors["cli.flag"].docs).toEqual(["README.md"]);
    expect(resolved.detectors["action.input"].enabled).toBe(true);
    expect(resolved.detectors["mcp.tool"].enabled).toBe(true);
  });

  it("applies default changeKinds when a rule omits them", () => {
    const cwd = tempCwd();
    writeFileSync(
      path.join(cwd, "doc-lag.config.json"),
      JSON.stringify({
        docsSync: {
          rules: [{ name: "api", code: ["app/**"], docs: ["docs/**"] }],
        },
      }),
    );
    const resolved = resolveDocsSyncConfig(cwd);
    expect(resolved.rules[0]?.changeKinds).toEqual(["added", "modified", "renamed"]);
  });

  it("loads .doc-lag.json when primary is absent", () => {
    const cwd = tempCwd();
    writeFileSync(path.join(cwd, ".doc-lag.json"), JSON.stringify({ docsSync: { maxFindings: 3 } }));
    const resolved = resolveDocsSyncConfig(cwd);
    expect(resolved.enabled).toBe(true);
    expect(resolved.maxFindings).toBe(3);
  });

  it("enables via env alone when no config docsSync key", () => {
    const cwd = tempCwd();
    const resolved = resolveDocsSyncConfig(cwd, {
      env: { DOC_LAG_DOCS_SYNC: "true" },
    });
    expect(resolved.enabled).toBe(true);
    expect(resolved.detectors["cli.flag"].enabled).toBe(true);
  });
});
