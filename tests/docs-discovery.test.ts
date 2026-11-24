import { describe, expect, it } from "vitest";
import { isDocumentationPath, listDocumentationFiles } from "../src/core/docs.js";
import {
  DEFAULT_DOCS_EXCLUDE,
  DEFAULT_DOCS_INCLUDE,
} from "../src/core/docs-config.js";

describe("isDocumentationPath (defaults)", () => {
  it("keeps legacy root Markdown and docs/**/*.md", () => {
    expect(isDocumentationPath("README.md")).toBe(true);
    expect(isDocumentationPath("readme.md")).toBe(true);
    expect(isDocumentationPath("AGENTS.md")).toBe(true);
    expect(isDocumentationPath("CLAUDE.md")).toBe(true);
    expect(isDocumentationPath("CONTRIBUTING.md")).toBe(true);
    expect(isDocumentationPath("docs/setup.md")).toBe(true);
    expect(isDocumentationPath("docs/guide/install.md")).toBe(true);
  });

  it("includes Step 1 default layouts (mdx + common dirs)", () => {
    expect(isDocumentationPath("docs/guide.mdx")).toBe(true);
    expect(isDocumentationPath("documentation/api.md")).toBe(true);
    expect(isDocumentationPath("website/docs/intro.mdx")).toBe(true);
    expect(isDocumentationPath("website/src/pages/index.md")).toBe(true);
    expect(isDocumentationPath("apps/docs/start.mdx")).toBe(true);
    expect(isDocumentationPath("packages/api/README.md")).toBe(true);
    expect(isDocumentationPath("packages/api/docs/usage.md")).toBe(true);
    expect(isDocumentationPath("apps/web/README.md")).toBe(true);
    expect(isDocumentationPath("src/foo/README.md")).toBe(true);
    expect(isDocumentationPath("servers/fetch/README.md")).toBe(true);
    expect(isDocumentationPath("content/blog/hello.mdx")).toBe(true);
  });

  it("excludes unsafe, generated, and noisy paths by default", () => {
    expect(isDocumentationPath("src/main.ts")).toBe(false);
    expect(isDocumentationPath("package.json")).toBe(false);
    expect(isDocumentationPath("docs/note.txt")).toBe(false);
    expect(isDocumentationPath("node_modules/foo/README.md")).toBe(false);
    expect(isDocumentationPath("dist/docs/guide.md")).toBe(false);
    expect(isDocumentationPath("packages/api/CHANGELOG.md")).toBe(false);
    expect(isDocumentationPath("LICENSE.md")).toBe(false);
    expect(isDocumentationPath("../README.md")).toBe(false);
    expect(isDocumentationPath("/abs/README.md")).toBe(false);
  });
});

describe("isDocumentationPath (overrides)", () => {
  it("replaces include when options.include is set", () => {
    const options = {
      include: ["packages/*/README.md"],
      exclude: [...DEFAULT_DOCS_EXCLUDE],
    };
    expect(isDocumentationPath("packages/api/README.md", options)).toBe(true);
    expect(isDocumentationPath("README.md", options)).toBe(false);
    expect(isDocumentationPath("docs/setup.md", options)).toBe(false);
  });

  it("keeps case-insensitive root matching when root patterns are listed", () => {
    const options = {
      include: ["README.md", "AGENTS.md"],
      exclude: [] as string[],
    };
    expect(isDocumentationPath("readme.md", options)).toBe(true);
    expect(isDocumentationPath("Agents.md", options)).toBe(true);
  });

  it("applies exclude after include", () => {
    const options = {
      include: ["docs/**/*.md"],
      exclude: ["docs/secret.md"],
    };
    expect(isDocumentationPath("docs/setup.md", options)).toBe(true);
    expect(isDocumentationPath("docs/secret.md", options)).toBe(false);
  });
});

describe("listDocumentationFiles", () => {
  it("filters and sorts deterministically", () => {
    const files = [
      "docs/b.md",
      "src/main.ts",
      "README.md",
      "docs/a.mdx",
      "packages/api/README.md",
      "CHANGELOG.md",
    ];
    expect(listDocumentationFiles(files)).toEqual([
      "README.md",
      "docs/a.mdx",
      "docs/b.md",
      "packages/api/README.md",
    ]);
  });

  it("exposes non-empty built-in defaults", () => {
    expect(DEFAULT_DOCS_INCLUDE.length).toBeGreaterThan(5);
    expect(DEFAULT_DOCS_EXCLUDE.length).toBeGreaterThan(5);
  });
});
