import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectActionSurfaces } from "../src/docs-sync/detectors/action-yml.js";
import { scan } from "../src/core/scan.js";
import {
  cleanupFixture,
  createFixtureRepo,
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

const BASE_ACTION = `name: demo
description: demo
inputs:
  fail-on:
    description: threshold
outputs:
  report-path:
    description: path
runs:
  using: node20
  main: dist/index.js
`;

describe("detectActionSurfaces", () => {
  it("extracts input and output keys with lines", () => {
    const surfaces = detectActionSurfaces("action.yml", BASE_ACTION);
    expect(surfaces.map((s) => `${s.kind}:${s.name}`).sort()).toEqual([
      "action.input:fail-on",
      "action.output:report-path",
    ]);
    expect(surfaces.find((s) => s.name === "fail-on")?.pointer).toBe("/inputs/fail-on");
    expect(surfaces.find((s) => s.name === "fail-on")?.line).toBeGreaterThan(1);
  });

  it("skips [internal] and deprecated inputs", () => {
    const content = `name: demo
inputs:
  public:
    description: ok
  secret:
    description: "[internal] hide me"
  old:
    description: legacy
    deprecationMessage: use public
outputs: {}
runs:
  using: node20
  main: index.js
`;
    const surfaces = detectActionSurfaces("action.yml", content);
    expect(surfaces.map((s) => s.name)).toEqual(["public"]);
  });

  it("action-yaml-invalid → warning, no crash, empty", () => {
    const warnings: string[] = [];
    const surfaces = detectActionSurfaces(
      "action.yml",
      "inputs: [\n  - broken",
      { warn: (m) => warnings.push(m) },
    );
    expect(surfaces).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("action detector integration", () => {
  it("action-input-added-undocumented → finding", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# Action\n\nUses `fail-on`.\n",
          "action.yml": BASE_ACTION,
        },
        headFiles: {
          "action.yml": BASE_ACTION.replace(
            "  fail-on:\n    description: threshold\n",
            "  fail-on:\n    description: threshold\n  docs-sync:\n    description: Enable docs sync\n",
          ),
        },
      }),
    );
    writeFileSync(
      path.join(fixture.repo, "doc-lag.config.json"),
      JSON.stringify({ docsSync: {} }),
    );
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    const missing = report.findings.filter((f) => f.ruleId === "docs.missing");
    expect(missing.map((f) => f.id)).toContain(
      "docs.missing:action.input:docs-sync@action.yml",
    );
    expect(report.docsSync?.newSurfaces).toBeGreaterThanOrEqual(1);
  });

  it("action-input-added-in-table → 0", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# Action\n",
          "action.yml": BASE_ACTION,
        },
        headFiles: {
          "action.yml": BASE_ACTION.replace(
            "  fail-on:\n    description: threshold\n",
            "  fail-on:\n    description: threshold\n  docs-sync:\n    description: Enable\n",
          ),
          "README.md": [
            "# Action",
            "",
            "| Input | Desc |",
            "| --- | --- |",
            "| `docs-sync` | Enable |",
            "",
          ].join("\n"),
        },
      }),
    );
    writeFileSync(
      path.join(fixture.repo, "doc-lag.config.json"),
      JSON.stringify({ docsSync: {} }),
    );
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(
      report.findings.filter((f) => f.id.includes("action.input:docs-sync")),
    ).toHaveLength(0);
  });

  it("action-input-internal → 0", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# Action\n",
          "action.yml": BASE_ACTION,
        },
        headFiles: {
          "action.yml": BASE_ACTION.replace(
            "  fail-on:\n    description: threshold\n",
            "  fail-on:\n    description: threshold\n  secret:\n    description: \"[internal] token\"\n",
          ),
        },
      }),
    );
    writeFileSync(
      path.join(fixture.repo, "doc-lag.config.json"),
      JSON.stringify({ docsSync: {} }),
    );
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.findings.filter((f) => f.id.includes("action.input:secret"))).toHaveLength(
      0,
    );
  });

  it("action-output-added → finding when undocumented", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# Action\n",
          "action.yml": BASE_ACTION,
        },
        headFiles: {
          "action.yml": BASE_ACTION.replace(
            "  report-path:\n    description: path\n",
            "  report-path:\n    description: path\n  docs-missing-count:\n    description: count\n",
          ),
        },
      }),
    );
    writeFileSync(
      path.join(fixture.repo, "doc-lag.config.json"),
      JSON.stringify({ docsSync: {} }),
    );
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(
      report.findings.some((f) => f.id === "docs.missing:action.output:docs-missing-count@action.yml"),
    ).toBe(true);
  });

  it("action-input-archive-prose-only (upload-artifact style) → finding", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# Action\n\nUses `fail-on`.\n",
          "action.yml": BASE_ACTION,
        },
        headFiles: {
          "action.yml": BASE_ACTION.replace(
            "  fail-on:\n    description: threshold\n",
            "  fail-on:\n    description: threshold\n  archive:\n    description: Upload as a single archive\n",
          ),
          "README.md": [
            "# Action",
            "",
            "Contents are uploaded together into an immutable archive.",
            "",
            "### Zip archives",
            "",
            "When an Artifact is uploaded, files form a Zip archive.",
            "",
          ].join("\n"),
        },
      }),
    );
    writeFileSync(
      path.join(fixture.repo, "doc-lag.config.json"),
      JSON.stringify({ docsSync: {} }),
    );
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.findings.map((f) => f.id)).toContain(
      "docs.missing:action.input:archive@action.yml",
    );
  });

  it("action-input-archive-in-table → 0", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# Action\n",
          "action.yml": BASE_ACTION,
        },
        headFiles: {
          "action.yml": BASE_ACTION.replace(
            "  fail-on:\n    description: threshold\n",
            "  fail-on:\n    description: threshold\n  archive:\n    description: Upload as a single archive\n",
          ),
          "README.md": [
            "# Action",
            "",
            "| Input | Desc |",
            "| --- | --- |",
            "| `archive` | Upload as archive |",
            "",
          ].join("\n"),
        },
      }),
    );
    writeFileSync(
      path.join(fixture.repo, "doc-lag.config.json"),
      JSON.stringify({ docsSync: {} }),
    );
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(
      report.findings.filter((f) => f.id.includes("action.input:archive")),
    ).toHaveLength(0);
  });
});
