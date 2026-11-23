import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scan } from "../src/core/scan.js";
import { detectMcpTools } from "../src/docs-sync/detectors/mcp-tools.js";
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

function enableDocsSync(repo: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(
    path.join(repo, "doc-lag.config.json"),
    JSON.stringify({ docsSync: { ...extra } }),
  );
}

const TS_SDK_BASE = `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
const server = new McpServer({ name: "demo", version: "1.0.0" });
`;

const PY_FASTMCP_BASE = `from mcp.server.fastmcp import FastMCP
mcp = FastMCP("demo")
`;

describe("detectMcpTools unit", () => {
  it("detects TS registerTool / tool with string literal names", () => {
    const content = `${TS_SDK_BASE}
server.registerTool("scan_diff", { title: "Scan" }, async () => ({}));
server.tool("list_rules", {}, async () => ({}));
`;
    const names = detectMcpTools("src/mcp.ts", content).map((s) => s.name).sort();
    expect(names).toEqual(["list_rules", "scan_diff"]);
  });

  it("skips when SDK is not imported, variable args, and underscore names", () => {
    expect(
      detectMcpTools(
        "src/other.ts",
        `server.registerTool("nope", {}, async () => ({}));\n`,
      ),
    ).toHaveLength(0);

    expect(
      detectMcpTools(
        "src/mcp.ts",
        `${TS_SDK_BASE}
const NAME = "dyn";
server.registerTool(NAME, {}, async () => ({}));
server.registerTool("_internal", {}, async () => ({}));
`,
      ).map((s) => s.name),
    ).toEqual([]);
  });

  it("ignores tools mentioned only inside comments", () => {
    expect(
      detectMcpTools(
        "src/mcp.ts",
        `${TS_SDK_BASE}
// server.registerTool("commented", {}, async () => ({}));
/* server.tool("blocked", {}, async () => ({})); */
server.registerTool("ok", {}, async () => ({}));
`,
      ).map((s) => s.name),
    ).toEqual(["ok"]);
  });

  it("detects FastMCP decorator name from def / name= kwarg", () => {
    const byDef = detectMcpTools(
      "server.py",
      `${PY_FASTMCP_BASE}
@mcp.tool()
def add(a: int, b: int) -> int:
    return a + b

@mcp.tool()
async def summarize(text: str) -> str:
    return text
`,
    ).map((s) => s.name).sort();
    expect(byDef).toEqual(["add", "summarize"]);

    const byName = detectMcpTools(
      "server.py",
      `${PY_FASTMCP_BASE}
@mcp.tool(name="custom_search")
def search_impl(q: str) -> str:
    return q
`,
    ).map((s) => s.name);
    expect(byName).toEqual(["custom_search"]);
  });

  it("skips FastMCP underscore tools and files without mcp/fastmcp import", () => {
    expect(
      detectMcpTools(
        "server.py",
        `${PY_FASTMCP_BASE}
@mcp.tool()
def _private() -> None:
    pass

@mcp.tool(name="_hidden")
def visible_name() -> None:
    pass
`,
      ),
    ).toHaveLength(0);

    expect(
      detectMcpTools(
        "other.py",
        `@app.tool()
def fake() -> None:
    pass
`,
      ),
    ).toHaveLength(0);
  });
});

describe("mcp.tool integration fixtures", () => {
  it("mcp-tool-ts-registerTool → 1 when undocumented", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# mcp\n",
          "src/mcp.ts": TS_SDK_BASE,
        },
        headFiles: {
          "src/mcp.ts": `${TS_SDK_BASE}server.registerTool("scan_diff", { title: "Scan" }, async () => ({}));\n`,
        },
      }),
    );
    enableDocsSync(fixture.repo);
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.findings.map((f) => f.id)).toContain(
      "docs.missing:mcp.tool:scan_diff@src/mcp.ts",
    );
  });

  it("mcp-tool-ts-registerTool documented → 0", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "Tools: `scan_diff`.\n",
          "src/mcp.ts": TS_SDK_BASE,
        },
        headFiles: {
          "src/mcp.ts": `${TS_SDK_BASE}server.registerTool("scan_diff", {}, async () => ({}));\n`,
        },
      }),
    );
    enableDocsSync(fixture.repo);
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.findings.filter((f) => f.id.includes("mcp.tool:scan_diff"))).toHaveLength(0);
  });

  it("mcp-tool documented as bold list item → 0 (no false positive)", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# App\n",
          "src/mcp.ts": TS_SDK_BASE,
        },
        headFiles: {
          "src/mcp.ts": `${TS_SDK_BASE}server.registerTool("create_entities", {}, async () => ({}));\n`,
          "README.md": [
            "# Tools",
            "",
            "- **create_entities**",
            "- **summary**: unrelated",
            "",
          ].join("\n"),
        },
      }),
    );
    enableDocsSync(fixture.repo);
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(
      report.findings.filter((f) => f.id.includes("mcp.tool:create_entities")),
    ).toHaveLength(0);
  });

  it("mcp-tool-ts-no-sdk-import → 0", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# mcp\n",
          "src/other.ts": `export function registerTool(_n: string) {}\n`,
        },
        headFiles: {
          "src/other.ts": `export function registerTool(_n: string) {}
registerTool("fake_tool");
`,
        },
      }),
    );
    enableDocsSync(fixture.repo);
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.findings.filter((f) => f.id.includes("mcp.tool"))).toHaveLength(0);
  });

  it("mcp-tool-fastmcp-decorator → 1", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# py\n",
          "server.py": PY_FASTMCP_BASE,
        },
        headFiles: {
          "server.py": `${PY_FASTMCP_BASE}
@mcp.tool()
def add(a: int, b: int) -> int:
    return a + b
`,
        },
      }),
    );
    enableDocsSync(fixture.repo);
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.findings.map((f) => f.id)).toContain(
      "docs.missing:mcp.tool:add@server.py",
    );
  });

  it("mcp-tool-fastmcp-name-kwarg → 1 for custom name", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# py\n",
          "server.py": PY_FASTMCP_BASE,
        },
        headFiles: {
          "server.py": `${PY_FASTMCP_BASE}
@mcp.tool(name="custom_search")
def search_impl(q: str) -> str:
    return q
`,
        },
      }),
    );
    enableDocsSync(fixture.repo);
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.findings.map((f) => f.id)).toContain(
      "docs.missing:mcp.tool:custom_search@server.py",
    );
    expect(report.findings.filter((f) => f.id.includes("search_impl"))).toHaveLength(0);
  });

  it("mcp-tool-underscore → 0", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# mcp\n",
          "src/mcp.ts": TS_SDK_BASE,
          "server.py": PY_FASTMCP_BASE,
        },
        headFiles: {
          "src/mcp.ts": `${TS_SDK_BASE}server.registerTool("_secret", {}, async () => ({}));\n`,
          "server.py": `${PY_FASTMCP_BASE}
@mcp.tool()
def _private() -> None:
    pass
`,
        },
      }),
    );
    enableDocsSync(fixture.repo);
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.findings.filter((f) => f.id.includes("mcp.tool"))).toHaveLength(0);
  });

  it("docsSync off → byte-identical (no docsSync field)", () => {
    const fixture = track(
      createFixtureRepo({
        baseFiles: {
          "README.md": "# mcp\n",
          "src/mcp.ts": TS_SDK_BASE,
        },
        headFiles: {
          "src/mcp.ts": `${TS_SDK_BASE}server.registerTool("scan_diff", {}, async () => ({}));\n`,
        },
      }),
    );
    const report = scan({ cwd: fixture.repo, base: fixture.base, head: fixture.head });
    expect(report.docsSync).toBeUndefined();
    expect(report.findings.filter((f) => f.ruleId === "docs.missing")).toHaveLength(0);
  });
});
