import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scan } from "../src/core/scan.js";
import { detectCliArgv } from "../src/docs-sync/detectors/cli-argv.js";
import {
  cleanupFixture,
  createFixtureRepo,
  type FixtureRepo,
} from "./helpers/fixture.js";

const fixtures: FixtureRepo[] = [];

afterEach(() => {
  while (fixtures.length > 0) {
    const f = fixtures.pop();
    if (f) cleanupFixture(f.repo);
  }
});

function track(fixture: FixtureRepo): FixtureRepo {
  fixtures.push(fixture);
  return fixture;
}

function enableArgv(repo: string): void {
  writeFileSync(
    path.join(repo, "doc-lag.config.json"),
    JSON.stringify({
      docsSync: {
        detectors: { "cli.argv": true },
      },
    }),
  );
}

describe("detectCliArgv unit", () => {
  it("extracts process.argv.includes long flags", () => {
    const content = `
const args = process.argv.slice(2);
if (process.argv.includes("--read-only")) {
  mode = "ro";
}
`;
    expect(detectCliArgv("src/cli.ts", content).map((s) => s.name)).toEqual([
      "--read-only",
    ]);
  });

  it("extracts arg === flag compares when process.argv is present", () => {
    const content = `
for (const arg of process.argv.slice(2)) {
  if (arg === "--read-only") {
    readOnly = true;
  } else if (arg === "--verbose") {
    verbose = true;
  }
}
`;
    expect(detectCliArgv("src/main.ts", content).map((s) => s.name).sort()).toEqual([
      "--read-only",
      "--verbose",
    ]);
  });

  it("extracts Python sys.argv membership", () => {
    const content = `
import sys
if "--read-only" in sys.argv:
    read_only = True
`;
    expect(detectCliArgv("cli.py", content).map((s) => s.name)).toEqual(["--read-only"]);
  });

  it("skips commander-gated files", () => {
    const content = `
import { Command } from "commander";
const program = new Command();
if (process.argv.includes("--read-only")) {}
`;
    expect(detectCliArgv("src/cli.ts", content)).toEqual([]);
  });

  it("skips when process.argv is absent", () => {
    const content = `if (arg === "--read-only") {}`;
    expect(detectCliArgv("src/cli.ts", content)).toEqual([]);
  });

  it("ignores flags in comments", () => {
    const content = `
// process.argv.includes("--secret")
const x = process.argv;
`;
    expect(detectCliArgv("src/cli.ts", content)).toEqual([]);
  });
});

describe("cli.argv scan fixtures", () => {
  it("off by default → 0 findings even with hand-rolled flag", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# App\n",
          "src/cli.ts": "console.log(process.argv);\n",
        },
        headFiles: {
          "src/cli.ts":
            'for (const arg of process.argv) {\n  if (arg === "--read-only") {}\n}\n',
        },
      }),
    );
    writeFileSync(
      path.join(fixture.repo, "doc-lag.config.json"),
      JSON.stringify({ docsSync: {} }),
    );
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.findings.filter((f) => f.id.includes("cli.argv"))).toHaveLength(0);
    expect(report.docsSync?.detectors ?? []).not.toContain("cli.argv");
  });

  it("enabled + undocumented → finding", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# App\n",
          "src/cli.ts": "console.log(process.argv);\n",
        },
        headFiles: {
          "src/cli.ts":
            'for (const arg of process.argv) {\n  if (arg === "--read-only") {}\n}\n',
        },
      }),
    );
    enableArgv(fixture.repo);
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.findings.map((f) => f.id)).toContain(
      "docs.missing:cli.argv:--read-only@src/cli.ts",
    );
  });

  it("enabled + documented → 0", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# App\n",
          "src/cli.ts": "console.log(process.argv);\n",
        },
        headFiles: {
          "src/cli.ts":
            'for (const arg of process.argv) {\n  if (arg === "--read-only") {}\n}\n',
          "README.md": "# App\n\nPass `--read-only`.\n",
        },
      }),
    );
    enableArgv(fixture.repo);
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.findings.filter((f) => f.id.includes("cli.argv"))).toHaveLength(0);
  });
});
