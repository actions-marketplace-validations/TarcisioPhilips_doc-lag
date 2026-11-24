import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scan } from "../src/core/scan.js";
import { formatJson } from "../src/reporters/json.js";
import { formatText } from "../src/reporters/text.js";
import {
  cleanupFixture,
  createFixtureRepo,
  git,
  type FixtureRepo,
} from "./helpers/fixture.js";

const fixtures: string[] = [];

afterEach(() => {
  while (fixtures.length > 0) {
    const repo = fixtures.pop();
    if (repo) cleanupFixture(repo);
  }
});

function track(fixture: FixtureRepo): FixtureRepo {
  fixtures.push(fixture.repo);
  return fixture;
}

function writeConfig(repo: string, docsSync: unknown): void {
  writeFileSync(
    path.join(repo, "doc-lag.config.json"),
    JSON.stringify({ docsSync }, null, 2),
    "utf8",
  );
}

describe("docs-sync pairing rules", () => {
  it("disabled-default-byte-identical: no docsSync key → identical to baseline", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# App\n",
          "src/cli.ts": "export {};\n",
        },
        headFiles: {
          "src/cli.ts": "export const x = 1;\n",
        },
      }),
    );
    const off = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(off.docsSync).toBeUndefined();
    expect(formatJson(off)).not.toContain("docsSync");
    expect(formatText(off)).not.toContain("Docs sync:");
  });

  it("rule-code-changed-no-docs → 1 finding", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# App\n",
          "src/cli/main.ts": " consola.log('hi');\n",
        },
        headFiles: {
          "src/cli/main.ts": "console.log('hi');\nconsole.log('bye');\n",
        },
      }),
    );
    writeConfig(fixture.repo, {
      rules: [{ name: "cli", code: ["src/cli/**"], docs: ["README.md"] }],
    });
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.docsSync?.status).toBe("ran");
    const missing = report.findings.filter((f) => f.ruleId === "docs.missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.id).toBe("docs.missing:rule:cli");
    expect(missing[0]?.status).toBe("needs-review");
    expect(missing[0]?.surface?.trigger).toBe("rule");
    expect(missing[0]?.documentation.path).toBe("README.md");
    expect(formatText(report)).toContain("Docs sync: ran");
    expect(formatText(report)).toContain("Evidence: src/cli/main.ts  (modified)");
  });

  it("rule-code-and-docs-changed → 0", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# App\n",
          "src/cli/main.ts": "export {};\n",
        },
        headFiles: {
          "src/cli/main.ts": "export const x = 1;\n",
          "README.md": "# App\n\nUpdated CLI.\n",
        },
      }),
    );
    writeConfig(fixture.repo, {
      rules: [{ name: "cli", code: ["src/cli/**"], docs: ["README.md"] }],
    });
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.findings.filter((f) => f.ruleId === "docs.missing")).toHaveLength(0);
    expect(report.docsSync?.status).toBe("ran");
  });

  it("rule-docs-whitespace-only → 1", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "hello\n\nworld\n",
          "src/cli/main.ts": "export {};\n",
        },
        headFiles: {
          "src/cli/main.ts": "export const x = 1;\n",
          "README.md": "hello\n  \n\nworld\n",
        },
      }),
    );
    writeConfig(fixture.repo, {
      rules: [{ name: "cli", code: ["src/cli/**"], docs: ["README.md"] }],
    });
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.findings.filter((f) => f.ruleId === "docs.missing")).toHaveLength(1);
  });

  it("rule-code-pure-rename → 0", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# App\n",
          "src/cli/old.ts": Array.from({ length: 30 }, (_, i) => `export const a${i} = ${i};`).join(
            "\n",
          ),
        },
      }),
    );
    writeConfig(fixture.repo, {
      rules: [{ name: "cli", code: ["src/cli/**"], docs: ["README.md"] }],
    });
    git(fixture.repo, ["mv", "src/cli/old.ts", "src/cli/new.ts"]);
    git(fixture.repo, ["add", "-A"]);
    git(fixture.repo, ["-c", "commit.gpgsign=false", "commit", "-m", "rename"]);
    const head = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    const report = scan({ cwd: fixture.repo, base: fixture.base, head });
    expect(report.findings.filter((f) => f.ruleId === "docs.missing")).toHaveLength(0);
  });

  it("rule-code-deleted-default → 0; opt-in → 1", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# App\n",
          "src/cli/main.ts": "export {};\n",
        },
        headFiles: {
          "src/cli/main.ts": null,
        },
      }),
    );
    writeConfig(fixture.repo, {
      rules: [{ name: "cli", code: ["src/cli/**"], docs: ["README.md"] }],
    });
    const defaultReport = scan({
      cwd: fixture.repo,
      base: fixture.base,
      head: fixture.head,
    });
    expect(defaultReport.findings.filter((f) => f.ruleId === "docs.missing")).toHaveLength(0);

    writeConfig(fixture.repo, {
      rules: [
        {
          name: "cli",
          code: ["src/cli/**"],
          docs: ["README.md"],
          changeKinds: ["added", "modified", "renamed", "deleted"],
        },
      ],
    });
    const optIn = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(optIn.findings.filter((f) => f.ruleId === "docs.missing")).toHaveLength(1);
  });

  it("rule-exclude-glob → 0", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# App\n",
          "src/cli/main.test.ts": "export {};\n",
        },
        headFiles: {
          "src/cli/main.test.ts": "export const x = 1;\n",
        },
      }),
    );
    writeConfig(fixture.repo, {
      rules: [
        {
          name: "cli",
          code: ["src/cli/**"],
          docs: ["README.md"],
          exclude: ["src/cli/**/*.test.ts"],
        },
      ],
    });
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    // Also excluded by default docsSync.ignore **/*.test.* — either way, 0.
    expect(report.findings.filter((f) => f.ruleId === "docs.missing")).toHaveLength(0);
  });

  it("rule-per-package: one package undocumented", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "packages/a/README.md": "# A\n",
          "packages/a/src/index.ts": "export {};\n",
          "packages/b/README.md": "# B\n",
          "packages/b/src/index.ts": "export {};\n",
        },
        headFiles: {
          "packages/a/src/index.ts": "export const a = 1;\n",
          "packages/a/README.md": "# A\n\nUpdated.\n",
          "packages/b/src/index.ts": "export const b = 1;\n",
        },
      }),
    );
    writeConfig(fixture.repo, {
      rules: [
        {
          name: "pkg-src",
          code: ["packages/*/src/**"],
          docs: ["README.md"],
          perPackage: true,
        },
      ],
    });
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    const missing = report.findings.filter((f) => f.ruleId === "docs.missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.id).toBe("docs.missing:rule:pkg-src@packages/b");
    expect(missing[0]?.surface?.package).toBe("packages/b");
    expect(missing[0]?.documentation.path).toBe("packages/b/README.md");
  });

  it("trailer-skip: skips whole check", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# App\n",
          "src/cli/main.ts": "export {};\n",
        },
      }),
    );
    writeConfig(fixture.repo, {
      rules: [{ name: "cli", code: ["src/cli/**"], docs: ["README.md"] }],
    });
    writeFileSync(path.join(fixture.repo, "src/cli/main.ts"), "export const x = 1;\n");
    git(fixture.repo, ["add", "-A"]);
    git(fixture.repo, [
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "change\n\nDocs-Not-Needed: covered elsewhere\n",
    ]);
    const head = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    const report = scan({ cwd: fixture.repo, base: fixture.base, head });
    expect(report.docsSync?.status).toBe("skipped");
    expect(report.docsSync?.skipReason).toBe("trailer:covered elsewhere");
    expect(report.findings.filter((f) => f.ruleId === "docs.missing")).toHaveLength(0);
    expect(formatText(report)).toContain("Docs sync: skipped");
  });

  it("docs-only-pr → ran, 0 findings", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: { "README.md": "# App\n" },
        headFiles: { "README.md": "# App\n\nMore.\n" },
      }),
    );
    writeConfig(fixture.repo, {
      rules: [{ name: "cli", code: ["src/cli/**"], docs: ["README.md"] }],
    });
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.docsSync?.status).toBe("ran");
    expect(report.docsSync?.candidateFiles).toBe(0);
    expect(report.findings.filter((f) => f.ruleId === "docs.missing")).toHaveLength(0);
  });

  it("FR-28: --no-docs-sync / docsSyncEnabled false → docsSync absent", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# App\n",
          "src/cli/main.ts": "export {};\n",
        },
        headFiles: {
          "src/cli/main.ts": "export const x = 1;\n",
        },
      }),
    );
    writeConfig(fixture.repo, {
      rules: [{ name: "cli", code: ["src/cli/**"], docs: ["README.md"] }],
    });
    const report = scan({
      cwd: fixture.repo,
      base: fixture.base,
      head: fixture.head,
      docsSyncEnabled: false,
    });
    expect(report.docsSync).toBeUndefined();
    expect(report.findings.filter((f) => f.ruleId === "docs.missing")).toHaveLength(0);
  });

  it("maxFindings caps with omitted", () => {
    const baseFiles: Record<string, string> = { "README.md": "# App\n" };
    const headFiles: Record<string, string> = {};
    for (let i = 0; i < 3; i += 1) {
      baseFiles[`src/cli/f${i}.ts`] = "export {};\n";
      headFiles[`src/cli/f${i}.ts`] = "export const x = 1;\n";
    }
    // Three separate rules so we get 3 findings to cap.
    const fixture = track(createFixtureRepo({ baseFiles, headFiles }));
    writeConfig(fixture.repo, {
      maxFindings: 2,
      rules: [
        { name: "r0", code: ["src/cli/f0.ts"], docs: ["README.md"] },
        { name: "r1", code: ["src/cli/f1.ts"], docs: ["README.md"] },
        { name: "r2", code: ["src/cli/f2.ts"], docs: ["README.md"] },
      ],
    });
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.docsSync?.findings).toBe(3);
    expect(report.docsSync?.omitted).toBe(1);
    expect(report.findings.filter((f) => f.ruleId === "docs.missing")).toHaveLength(2);
  });
});
