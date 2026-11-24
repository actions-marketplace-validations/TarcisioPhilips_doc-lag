import { describe, expect, it } from "vitest";
import { extractScriptInvocations, documentedCommand } from "../src/extractors/markdown-scripts.js";
import { isDocumentationPath } from "../src/core/docs.js";

describe("extractScriptInvocations", () => {
  it("parses npm, pnpm, yarn, and bun run forms", () => {
    const markdown = [
      "Use `npm run deploy:preview` first.",
      "or pnpm run deploy:preview",
      "or yarn run deploy:preview",
      "or bun run deploy:preview",
    ].join("\n");
    const found = extractScriptInvocations(markdown, "README.md");
    expect(found.map((item) => documentedCommand(item))).toEqual([
      "npm run deploy:preview",
      "pnpm run deploy:preview",
      "yarn run deploy:preview",
      "bun run deploy:preview",
    ]);
    expect(found.every((item) => item.script === "deploy:preview")).toBe(true);
  });

  it("parses short pnpm and yarn invocations", () => {
    const found = extractScriptInvocations(
      "Then `pnpm deploy:preview` or `yarn deploy:preview`.",
      "docs/setup.md",
    );
    expect(found.map((item) => item.raw)).toEqual(["pnpm deploy:preview", "yarn deploy:preview"]);
    expect(found.every((item) => item.form === "short")).toBe(true);
  });

  it("does not treat `npm test` without run as a script invocation", () => {
    const found = extractScriptInvocations("Run npm test after npm install.", "README.md");
    expect(found).toEqual([]);
  });

  it("finds multiple invocations on one line", () => {
    const found = extractScriptInvocations(
      "npm run build && npm run test",
      "AGENTS.md",
    );
    expect(found.map((item) => item.script)).toEqual(["build", "test"]);
    expect(found.map((item) => item.line)).toEqual([1, 1]);
  });
});

describe("isDocumentationPath", () => {
  it("includes the documented Markdown set", () => {
    expect(isDocumentationPath("README.md")).toBe(true);
    expect(isDocumentationPath("readme.md")).toBe(true);
    expect(isDocumentationPath("AGENTS.md")).toBe(true);
    expect(isDocumentationPath("CLAUDE.md")).toBe(true);
    expect(isDocumentationPath("CONTRIBUTING.md")).toBe(true);
    expect(isDocumentationPath("docs/setup.md")).toBe(true);
    expect(isDocumentationPath("docs/guide/install.md")).toBe(true);
    expect(isDocumentationPath("docs/guide.mdx")).toBe(true);
  });

  it("excludes other files", () => {
    expect(isDocumentationPath("src/README.md")).toBe(true);
    expect(isDocumentationPath("package.json")).toBe(false);
    expect(isDocumentationPath("docs/note.txt")).toBe(false);
    expect(isDocumentationPath("node_modules/foo/README.md")).toBe(false);
  });
});
