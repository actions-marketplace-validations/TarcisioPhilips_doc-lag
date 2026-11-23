import type { SurfaceKind } from "../../core/docs-sync-config.js";

/** One public surface declaration extracted from a source file. */
export interface SurfaceDecl {
  kind: SurfaceKind;
  name: string;
  path: string;
  /** 1-based line of the declaration at this side. */
  line: number;
  /** Evidence pointer (`#L12` or JSON pointer). */
  pointer: string;
  /** Short declaration literal for evidence `head`. */
  literal: string;
  /**
   * Additional names that satisfy the mention check
   * (e.g. `--color` for `--no-color`, or `--no-shout` for `--shout`).
   */
  mentionNames?: string[];
}

export type DetectorFn = (path: string, content: string) => SurfaceDecl[];

export interface DetectorRegistration {
  kind: SurfaceKind;
  detect: DetectorFn;
}

export const KIND_LABELS: Record<SurfaceKind, string> = {
  "action.input": "GitHub Action input",
  "action.output": "GitHub Action output",
  "package.bin": "package bin",
  "package.exports": "package export",
  "cli.flag": "CLI flag",
  "cli.command": "CLI command",
  "cli.argv": "CLI argv flag",
  "mcp.tool": "MCP tool",
  "env.added": "environment variable",
};

/** Mentions contexts used by the mention index. */
export type MentionContext =
  | "inlineCode"
  | "fencedCode"
  | "tableCell"
  | "heading"
  | "text"
  | "bold";

/**
 * Structured contexts that satisfy common-English surface names (when that
 * gate is enabled) and count as intentional documentation hits.
 * Includes bold (`**name**` / `__name__`) alongside code/table/YAML fences.
 */
export const STRUCTURED_MENTION_CONTEXTS: readonly MentionContext[] = [
  "inlineCode",
  "tableCell",
  "fencedCode",
  "bold",
];

export const DETECTOR_ALLOWED_CONTEXTS: Record<SurfaceKind, readonly MentionContext[]> = {
  "cli.flag": ["inlineCode", "fencedCode", "tableCell", "heading", "text", "bold"],
  "cli.command": ["inlineCode", "fencedCode", "tableCell", "heading", "bold"],
  "cli.argv": ["inlineCode", "fencedCode", "tableCell", "heading", "text", "bold"],
  "action.input": ["inlineCode", "fencedCode", "tableCell", "heading", "bold"],
  "action.output": ["inlineCode", "fencedCode", "tableCell", "heading", "bold"],
  "package.bin": ["inlineCode", "fencedCode", "tableCell", "heading", "bold"],
  "package.exports": ["inlineCode", "fencedCode"],
  "mcp.tool": ["inlineCode", "fencedCode", "tableCell", "heading", "bold"],
  "env.added": ["inlineCode", "fencedCode", "tableCell", "heading", "text", "bold"],
};
