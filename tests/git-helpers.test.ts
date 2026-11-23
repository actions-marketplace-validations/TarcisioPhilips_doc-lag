import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  catFileBatch,
  createCatFileBatch,
  diffNameStatusWithSimilarity,
  diffNumstatIgnoreWhitespace,
  findCommitTrailer,
  listLinguistGenerated,
  resolveMergeBase,
} from "../src/core/git-helpers.js";
import { cleanupFixture, createFixtureRepo, git } from "./helpers/fixture.js";

const fixtures: string[] = [];

afterEach(() => {
  while (fixtures.length > 0) {
    const repo = fixtures.pop();
    if (repo) cleanupFixture(repo);
  }
});

function track<T extends { repo: string }>(fixture: T): T {
  fixtures.push(fixture.repo);
  return fixture;
}

function longContent(seed: string, n = 40): string {
  return Array.from({ length: n }, (_, i) => `${seed} line ${i} abcdefghijklmnopqrstuvwxyz`).join(
    "\n",
  );
}

describe("resolveMergeBase", () => {
  it("returns the merge-base of diverged branches", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: { "a.txt": "a\n" },
      }),
    );
    const root = fixture.base;
    git(fixture.repo, ["checkout", "-b", "feature"]);
    writeFileSync(path.join(fixture.repo, "feat.txt"), "feat\n");
    git(fixture.repo, ["add", "-A"]);
    git(fixture.repo, ["-c", "commit.gpgsign=false", "commit", "-m", "feat"]);
    const feature = git(fixture.repo, ["rev-parse", "HEAD"]).trim();

    git(fixture.repo, ["checkout", "main"]);
    writeFileSync(path.join(fixture.repo, "main.txt"), "main\n");
    git(fixture.repo, ["add", "-A"]);
    git(fixture.repo, ["-c", "commit.gpgsign=false", "commit", "-m", "main2"]);
    const main = git(fixture.repo, ["rev-parse", "HEAD"]).trim();

    const result = resolveMergeBase(fixture.repo, main, feature);
    expect(result.effectiveBase).toBe(root);
    expect(result.mergeBaseFallback).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it("shallow-merge-base-fallback: falls back to base with warning", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: { "a.txt": "a\n" },
      }),
    );
    // Unrelated orphan history → merge-base fails (same as a shallow clone miss).
    git(fixture.repo, ["checkout", "--orphan", "orphan"]);
    git(fixture.repo, ["rm", "-rf", "."]);
    writeFileSync(path.join(fixture.repo, "orphan.txt"), "o\n");
    git(fixture.repo, ["add", "-A"]);
    git(fixture.repo, ["-c", "commit.gpgsign=false", "commit", "-m", "orphan"]);
    const orphanHead = git(fixture.repo, ["rev-parse", "HEAD"]).trim();

    const warnings: string[] = [];
    const result = resolveMergeBase(fixture.repo, fixture.base, orphanHead, {
      warn: (message) => warnings.push(message),
    });
    expect(result.effectiveBase).toBe(fixture.base);
    expect(result.mergeBaseFallback).toBe(true);
    expect(warnings.some((w) => /fetch-depth|merge-base/i.test(w))).toBe(true);
  });
});

describe("diffNameStatusWithSimilarity", () => {
  it("parses added/modified/deleted", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: { "keep.txt": "k\n", "gone.txt": "g\n", "edit.txt": "e\n" },
        headFiles: {
          "keep.txt": "k\n",
          "gone.txt": null,
          "edit.txt": "e2\n",
          "new.txt": "n\n",
        },
      }),
    );
    const entries = diffNameStatusWithSimilarity(fixture.repo, fixture.base, fixture.head);
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
    expect(byPath["new.txt"]?.status).toBe("added");
    expect(byPath["edit.txt"]?.status).toBe("modified");
    expect(byPath["gone.txt"]?.status).toBe("deleted");
    expect(byPath["new.txt"]?.similarity).toBeUndefined();
  });

  it("FR-9: R100 is pure rename; R<100 is renamed with similarity", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: { "old.ts": longContent("old") },
      }),
    );

    // Pure rename (R100)
    git(fixture.repo, ["mv", "old.ts", "pure.ts"]);
    git(fixture.repo, ["add", "-A"]);
    git(fixture.repo, ["-c", "commit.gpgsign=false", "commit", "-m", "pure-rename"]);
    const afterPure = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    const pure = diffNameStatusWithSimilarity(fixture.repo, fixture.base, afterPure);
    expect(pure).toHaveLength(1);
    expect(pure[0]).toMatchObject({
      status: "renamed",
      path: "pure.ts",
      previousPath: "old.ts",
      similarity: 100,
      pureRename: true,
    });

    // Rename with edits (R<100)
    writeFileSync(
      path.join(fixture.repo, "edited.ts"),
      `${longContent("old")}\nEXTRA LINE FOR SIMILARITY DROP\n`,
    );
    git(fixture.repo, ["rm", "-f", "pure.ts"]);
    git(fixture.repo, ["add", "-A"]);
    git(fixture.repo, ["-c", "commit.gpgsign=false", "commit", "-m", "edit-rename"]);
    const afterEdit = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    const edited = diffNameStatusWithSimilarity(fixture.repo, afterPure, afterEdit);
    const rename = edited.find((e) => e.status === "renamed");
    expect(rename).toBeTruthy();
    expect(rename?.path).toBe("edited.ts");
    expect(rename?.previousPath).toBe("pure.ts");
    expect(rename?.similarity).toBeGreaterThan(0);
    expect(rename?.similarity).toBeLessThan(100);
    expect(rename?.pureRename).toBe(false);
  });
});

describe("diffNumstatIgnoreWhitespace", () => {
  it("FR-22: whitespace/blank-line-only edits are not meaningful", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: { "docs/a.md": "hello\n\nworld\n" },
        headFiles: { "docs/a.md": "hello\n  \n\nworld\n" },
      }),
    );
    const entries = diffNumstatIgnoreWhitespace(fixture.repo, fixture.base, fixture.head);
    expect(entries.every((e) => e.added + e.deleted === 0 || e.binary)).toBe(true);
    const doc = entries.find((e) => e.path === "docs/a.md");
    if (doc) {
      expect(doc.added + doc.deleted).toBe(0);
    }
  });

  it("reports added/deleted line counts for real edits", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: { "docs/a.md": "one\n" },
        headFiles: { "docs/a.md": "one\ntwo\n" },
      }),
    );
    const entries = diffNumstatIgnoreWhitespace(fixture.repo, fixture.base, fixture.head);
    expect(entries).toEqual([
      expect.objectContaining({ path: "docs/a.md", added: 1, deleted: 0, binary: false }),
    ]);
  });
});

describe("catFileBatch / createCatFileBatch", () => {
  it("reads multiple paths at a ref in one batch", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: { "a.txt": "aaa\n", "b.txt": "bbb\n" },
      }),
    );
    const results = catFileBatch(fixture.repo, [
      `${fixture.base}:a.txt`,
      `${fixture.base}:b.txt`,
      `${fixture.base}:missing.txt`,
    ]);
    expect(results.get(`${fixture.base}:a.txt`)?.toString("utf8")).toBe("aaa\n");
    expect(results.get(`${fixture.base}:b.txt`)?.toString("utf8")).toBe("bbb\n");
    expect(results.get(`${fixture.base}:missing.txt`)).toBeNull();

    const batch = createCatFileBatch(fixture.repo);
    try {
      expect(batch.read(`${fixture.base}:a.txt`)?.toString("utf8")).toBe("aaa\n");
      expect(batch.read(`${fixture.base}:missing.txt`)).toBeNull();
    } finally {
      batch.close();
    }
  });

  it("is read-only (does not dirty the worktree or index)", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: { "a.txt": "aaa\n" },
      }),
    );
    const beforeStatus = git(fixture.repo, ["status", "--porcelain"]);
    const beforeIndex = git(fixture.repo, ["rev-parse", "HEAD"]);
    catFileBatch(fixture.repo, [`${fixture.head}:a.txt`]);
    expect(git(fixture.repo, ["status", "--porcelain"])).toBe(beforeStatus);
    expect(git(fixture.repo, ["rev-parse", "HEAD"])).toBe(beforeIndex);
  });

  it("chunks large batches without crashing (forces multi-chunk path)", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "a.txt": "aaa\n",
          "b.txt": "bbb\n",
          "c.txt": "ccc\n",
        },
      }),
    );
    const objects = [
      `${fixture.head}:a.txt`,
      `${fixture.head}:b.txt`,
      `${fixture.head}:c.txt`,
    ];
    // Budget of 4 bytes forces a separate chunk per file (each is 4 bytes).
    const results = catFileBatch(fixture.repo, objects, {
      catFileChunkBudgetBytes: 4,
    });
    expect(results.get(`${fixture.head}:a.txt`)?.toString("utf8")).toBe("aaa\n");
    expect(results.get(`${fixture.head}:b.txt`)?.toString("utf8")).toBe("bbb\n");
    expect(results.get(`${fixture.head}:c.txt`)?.toString("utf8")).toBe("ccc\n");
  });

  it("skips oversized objects with a deterministic warning instead of crashing", () => {
    const big = "x".repeat(200);
    const fixture = track(
      createFixtureRepo({
        baseFiles: { "small.txt": "ok\n", "big.txt": `${big}\n` },
      }),
    );
    const warnings: string[] = [];
    const results = catFileBatch(
      fixture.repo,
      [`${fixture.head}:small.txt`, `${fixture.head}:big.txt`],
      {
        catFileMaxObjectBytes: 50,
        warn: (message) => warnings.push(message),
      },
    );
    expect(results.get(`${fixture.head}:small.txt`)?.toString("utf8")).toBe("ok\n");
    expect(results.get(`${fixture.head}:big.txt`)).toBeNull();
    expect(warnings.some((w) => w.includes("big.txt") && w.includes("oversized"))).toBe(
      true,
    );
  });
});

describe("findCommitTrailer", () => {
  it("trailer-skip: finds a non-empty trailer value and truncates to 100 chars", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: { "a.txt": "a\n" },
      }),
    );
    const long = "x".repeat(120);
    git(fixture.repo, [
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      `work\n\nDocs-Not-Needed: ${long}\n`,
    ]);
    const head = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    const result = findCommitTrailer(fixture.repo, fixture.base, head, "Docs-Not-Needed");
    expect(result).toEqual({
      found: true,
      value: "x".repeat(100),
    });
  });

  it("trailer-empty-value: empty trailer is not a skip; emits warning", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: { "a.txt": "a\n" },
      }),
    );
    git(fixture.repo, [
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "work\n\nDocs-Not-Needed: \n",
    ]);
    const head = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    const warnings: string[] = [];
    const result = findCommitTrailer(fixture.repo, fixture.base, head, "Docs-Not-Needed", {
      warn: (message) => warnings.push(message),
    });
    expect(result.found).toBe(false);
    expect(warnings.some((w) => /empty/i.test(w))).toBe(true);
  });

  it("returns not found when no trailer is present", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: { "a.txt": "a\n" },
        headFiles: { "a.txt": "b\n" },
      }),
    );
    const result = findCommitTrailer(fixture.repo, fixture.base, fixture.head, "Docs-Not-Needed");
    expect(result).toEqual({ found: false });
  });
});

describe("listLinguistGenerated", () => {
  it("generated-linguist: marks paths from .gitattributes at the given ref", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          ".gitattributes": "*.gen.ts linguist-generated\n",
          "src/ok.ts": "export {}\n",
          "src/x.gen.ts": "export {}\n",
        },
      }),
    );
    const generated = listLinguistGenerated(fixture.repo, fixture.head, [
      "src/ok.ts",
      "src/x.gen.ts",
      "missing.ts",
    ]);
    expect(generated.has("src/x.gen.ts")).toBe(true);
    expect(generated.has("src/ok.ts")).toBe(false);
    expect(generated.has("missing.ts")).toBe(false);
  });

  it("reads attributes from the ref, not the working tree", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          ".gitattributes": "*.gen.ts linguist-generated\n",
          "src/x.gen.ts": "export {}\n",
        },
        headFiles: {
          ".gitattributes": "",
          "src/x.gen.ts": "export {}\n",
        },
      }),
    );
    const atBase = listLinguistGenerated(fixture.repo, fixture.base, ["src/x.gen.ts"]);
    const atHead = listLinguistGenerated(fixture.repo, fixture.head, ["src/x.gen.ts"]);
    expect(atBase.has("src/x.gen.ts")).toBe(true);
    expect(atHead.has("src/x.gen.ts")).toBe(false);
  });
});

describe("helpers stay offline", () => {
  it("does not call fetch", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: { "a.txt": "a\n", ".gitattributes": "*.gen.ts linguist-generated\n" },
        headFiles: { "a.txt": "b\n", "x.gen.ts": "z\n" },
      }),
    );
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("network unexpected");
    }) as typeof fetch;
    try {
      resolveMergeBase(fixture.repo, fixture.base, fixture.head);
      diffNameStatusWithSimilarity(fixture.repo, fixture.base, fixture.head);
      diffNumstatIgnoreWhitespace(fixture.repo, fixture.base, fixture.head);
      findCommitTrailer(fixture.repo, fixture.base, fixture.head, "Docs-Not-Needed");
      listLinguistGenerated(fixture.repo, fixture.head, ["x.gen.ts"]);
      catFileBatch(fixture.repo, [`${fixture.head}:a.txt`]);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalls).toBe(0);
  });
});
