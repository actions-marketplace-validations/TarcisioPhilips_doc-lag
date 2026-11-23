import {
  isJsTsPath,
  isPythonPath,
  lineAtOffset,
  stripCommentsForPath,
} from "./comment-strip.js";
import type { SurfaceDecl } from "./types.js";

/** Skip files already covered by library-gated CLI detectors. */
const IMPORT_COMMANDER =
  /(?:import\s+.*?from\s+['"]commander['"]|require\s*\(\s*['"]commander['"]\s*\))/s;
const IMPORT_ARGPARSE =
  /(?:import\s+argparse\b|from\s+argparse\s+import|import\s+.*\bargparse\b)/;
const IMPORT_CLICK = /(?:import\s+click\b|from\s+click\s+import|import\s+.*\bclick\b)/;

function hasArgvReference(content: string, js: boolean): boolean {
  if (js) {
    return /process\.argv\b/.test(content);
  }
  return /sys\.argv\b/.test(content);
}

function usesCliLibrary(content: string, js: boolean): boolean {
  if (js) {
    return IMPORT_COMMANDER.test(content);
  }
  return IMPORT_ARGPARSE.test(content) || IMPORT_CLICK.test(content);
}

/**
 * Detect long flags compared against process.argv / sys.argv (hand-rolled CLIs).
 * Off by default (`cli.argv`); skipped when commander/argparse/click is imported.
 */
export function detectCliArgv(path: string, content: string): SurfaceDecl[] {
  const js = isJsTsPath(path);
  const py = isPythonPath(path);
  if (!js && !py) {
    return [];
  }

  if (usesCliLibrary(content, js)) {
    return [];
  }
  if (!hasArgvReference(content, js)) {
    return [];
  }

  const stripped = stripCommentsForPath(path, content);
  const found = new Map<string, SurfaceDecl>();

  const patterns: RegExp[] = js
    ? [
        // process.argv.includes("--flag")
        /\bprocess\.argv\s*\.\s*includes\s*\(\s*(['"`])(--[a-zA-Z0-9][\w-]*)\1\s*\)/g,
        // arg === "--flag" / arg == "--flag" (hand-rolled argv loops)
        /\b(?:arg|args|argv|option|opt|flag)\b\s*(?:===|==|!==|!=)\s*(['"`])(--[a-zA-Z0-9][\w-]*)\1/g,
        // "--flag" === arg
        /(['"`])(--[a-zA-Z0-9][\w-]*)\1\s*(?:===|==|!==|!=)\s*\b(?:arg|args|argv|option|opt|flag)\b/g,
      ]
    : [
        // "--flag" in sys.argv
        /(['"])(--[a-zA-Z0-9][\w-]*)\1\s+in\s+sys\.argv\b/g,
        // arg == "--flag"
        /\b(?:arg|args|argv|option|opt|flag)\b\s*(?:==|!=)\s*(['"])(--[a-zA-Z0-9][\w-]*)\1/g,
        // "--flag" == arg
        /(['"])(--[a-zA-Z0-9][\w-]*)\1\s*(?:==|!=)\s*\b(?:arg|args|argv|option|opt|flag)\b/g,
      ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(stripped)) !== null) {
      const flag = match[2]!;
      addFlag(found, path, stripped, match.index, flag, match[0]!);
    }
  }

  return [...found.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.line - b.line,
  );
}

function addFlag(
  found: Map<string, SurfaceDecl>,
  path: string,
  content: string,
  offset: number,
  flag: string,
  literal: string,
): void {
  if (found.has(flag)) {
    return;
  }
  const line = lineAtOffset(content, offset);
  const mentionNames = [flag];
  if (flag.startsWith("--no-") && flag.length > 5) {
    mentionNames.push(`--${flag.slice(5)}`);
  }
  found.set(flag, {
    kind: "cli.argv",
    name: flag,
    path,
    line,
    pointer: `#L${line}`,
    literal: literal.trim().slice(0, 120),
    mentionNames,
  });
}
