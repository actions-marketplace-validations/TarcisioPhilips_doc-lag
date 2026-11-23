/**
 * Short English tokens that commonly collide with Action inputs / bins / tools
 * when matched as bare whole words in headings or prose.
 *
 * Fixed, sorted list — deterministic; no locale / dictionary downloads.
 */
export const COMMON_SURFACE_WORDS: readonly string[] = [
  "archive",
  "artifact",
  "artifacts",
  "auth",
  "branch",
  "cache",
  "check",
  "clean",
  "color",
  "command",
  "config",
  "data",
  "debug",
  "default",
  "directory",
  "dry",
  "env",
  "error",
  "export",
  "file",
  "files",
  "filter",
  "flag",
  "force",
  "format",
  "header",
  "help",
  "host",
  "id",
  "ignore",
  "include",
  "input",
  "json",
  "key",
  "level",
  "limit",
  "list",
  "log",
  "mode",
  "name",
  "option",
  "output",
  "overwrite",
  "package",
  "path",
  "pattern",
  "port",
  "query",
  "quiet",
  "recursive",
  "ref",
  "release",
  "required",
  "root",
  "run",
  "script",
  "secret",
  "server",
  "status",
  "tag",
  "timeout",
  "token",
  "tool",
  "type",
  "url",
  "user",
  "value",
  "verbose",
  "version",
  "write",
  "yaml",
];

const COMMON_SET = new Set(COMMON_SURFACE_WORDS);

/**
 * Normalize a surface name for the common-word gate.
 * Strips a leading `--` from CLI flags; lowercases.
 */
export function commonWordKey(name: string): string {
  let base = name.trim();
  if (base.startsWith("--")) {
    base = base.slice(2);
  }
  return base.toLowerCase();
}

export function isCommonSurfaceWord(name: string): boolean {
  return COMMON_SET.has(commonWordKey(name));
}
