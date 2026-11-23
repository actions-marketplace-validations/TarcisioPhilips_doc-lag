import { prepareDocumentationContent } from "../core/doc-content.js";
import type { SurfaceKind } from "../core/docs-sync-config.js";
import { isCommonSurfaceWord } from "./common-words.js";
import { matchesAnyGlob, normalizeRepoPath } from "./match.js";
import {
  DETECTOR_ALLOWED_CONTEXTS,
  STRUCTURED_MENTION_CONTEXTS,
  type MentionContext,
} from "./detectors/types.js";

/** Contexts that count for common English surface names (no heading/prose). */
const COMMON_WORD_CONTEXTS: ReadonlySet<MentionContext> = new Set(
  STRUCTURED_MENTION_CONTEXTS,
);

export interface MentionHit {
  docPath: string;
  line: number;
  context: MentionContext;
}

interface IndexedSpan {
  docPath: string;
  line: number;
  context: MentionContext;
  text: string;
}

export interface MentionIndex {
  /** Docs that contributed to the index (sorted). */
  docPaths: string[];
  hasMention(options: {
    kind: SurfaceKind;
    name: string;
    /** Optional aliases that also satisfy the mention (e.g. --color for --no-color). */
    aliases?: string[];
    /** Optional restriction globs; undefined = all indexed docs. */
    docsGlobs?: string[];
  }): boolean;
  /** First hit for a name (for sibling targeting). */
  firstMention(options: {
    kind: SurfaceKind;
    name: string;
    aliases?: string[];
    docsGlobs?: string[];
  }): MentionHit | undefined;
  /** Count mentions of names in allowed contexts, per doc. */
  countMentionsByDoc(options: {
    kind: SurfaceKind;
    names: string[];
    docsGlobs?: string[];
  }): Map<string, { count: number; firstLine: number }>;
}

function isFenceOpen(line: string): { fence: string } | null {
  const match = /^(```|~~~)/.exec(line.trimStart());
  if (!match) {
    return null;
  }
  return { fence: match[1]! };
}

function extractInlineCodeSpans(line: string): { start: number; end: number; text: string }[] {
  const spans: { start: number; end: number; text: string }[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i += 1;
      continue;
    }
    // Skip fenced leftovers; only single-backtick inline here.
    let j = i + 1;
    while (j < line.length && line[j] !== "`") {
      j += 1;
    }
    if (j >= line.length) {
      break;
    }
    spans.push({ start: i, end: j + 1, text: line.slice(i + 1, j) });
    i = j + 1;
  }
  return spans;
}

/**
 * Extract `**bold**` / `__bold__` tokens (CommonMark emphasis).
 * Used as structured mentions for MCP tools and Action inputs/outputs.
 */
export function extractBoldSpans(line: string): { start: number; end: number; text: string }[] {
  const spans: { start: number; end: number; text: string }[] = [];
  const patterns: RegExp[] = [
    /\*\*(?!\s)([^*]+?)\*\*/g,
    // Allow underscores inside the token (`__read_file__`).
    /__(?!\s)((?:(?!__).)+?)__/g,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const inner = match[1]!;
      const trimmed = inner.trim();
      if (!trimmed) {
        continue;
      }
      spans.push({
        start: match.index,
        end: match.index + match[0]!.length,
        text: trimmed,
      });
    }
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  return spans;
}

function pushBoldSpans(
  spans: IndexedSpan[],
  path: string,
  lineNo: number,
  lineOrCell: string,
): void {
  for (const bold of extractBoldSpans(lineOrCell)) {
    spans.push({
      docPath: path,
      line: lineNo,
      context: "bold",
      text: bold.text,
    });
  }
}

function blankRanges(line: string, ranges: { start: number; end: number }[]): string {
  if (ranges.length === 0) {
    return line;
  }
  const chars = [...line];
  for (const range of ranges) {
    for (let i = range.start; i < range.end && i < chars.length; i += 1) {
      chars[i] = " ";
    }
  }
  return chars.join("");
}

/**
 * Build a mention index from in-scope documentation at head.
 * Content is prepared (frontmatter/MDX blanked) so JSX/imports do not count.
 */
export function buildMentionIndex(options: {
  docs: Array<{ path: string; content: string }>;
}): MentionIndex {
  const spans: IndexedSpan[] = [];
  const docPaths: string[] = [];

  for (const doc of options.docs) {
    const path = normalizeRepoPath(doc.path);
    docPaths.push(path);
    const prepared = prepareDocumentationContent(doc.content, path);
    const lines = prepared.split(/\r?\n/);
    let fence: string | null = null;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      const lineNo = i + 1;
      const trimmed = line.trimStart();

      if (fence) {
        if (trimmed.startsWith(fence)) {
          fence = null;
        } else if (trimmed.length > 0) {
          spans.push({ docPath: path, line: lineNo, context: "fencedCode", text: line });
        }
        continue;
      }

      const open = isFenceOpen(line);
      if (open) {
        fence = open.fence;
        continue;
      }

      if (trimmed.startsWith("#")) {
        spans.push({ docPath: path, line: lineNo, context: "heading", text: line });
        const codes = extractInlineCodeSpans(line);
        for (const code of codes) {
          spans.push({
            docPath: path,
            line: lineNo,
            context: "inlineCode",
            text: code.text,
          });
        }
        pushBoldSpans(spans, path, lineNo, line);
        continue;
      }

      if (line.includes("|")) {
        const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
        for (const cell of cells) {
          spans.push({ docPath: path, line: lineNo, context: "tableCell", text: cell });
          for (const code of extractInlineCodeSpans(cell)) {
            spans.push({
              docPath: path,
              line: lineNo,
              context: "inlineCode",
              text: code.text,
            });
          }
          pushBoldSpans(spans, path, lineNo, cell);
        }
        continue;
      }

      const codes = extractInlineCodeSpans(line);
      for (const code of codes) {
        spans.push({
          docPath: path,
          line: lineNo,
          context: "inlineCode",
          text: code.text,
        });
      }
      const bolds = extractBoldSpans(line);
      for (const bold of bolds) {
        spans.push({
          docPath: path,
          line: lineNo,
          context: "bold",
          text: bold.text,
        });
      }
      const remainder = blankRanges(line, [...codes, ...bolds]).trim();
      if (remainder.length > 0) {
        spans.push({ docPath: path, line: lineNo, context: "text", text: remainder });
      }
    }
  }

  docPaths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  function filterSpans(
    kind: SurfaceKind,
    docsGlobs: string[] | undefined,
  ): IndexedSpan[] {
    const allowed = new Set(DETECTOR_ALLOWED_CONTEXTS[kind]);
    return spans.filter((span) => {
      if (!allowed.has(span.context)) {
        return false;
      }
      if (docsGlobs && docsGlobs.length > 0 && !matchesAnyGlob(span.docPath, docsGlobs)) {
        return false;
      }
      return true;
    });
  }

  function yamlKeyMatch(name: string, text: string): boolean {
    return new RegExp(`(^|\\s)${escapeRegExp(name)}\\s*:`).test(text);
  }

  function wholeWordMatch(name: string, text: string): boolean {
    // `-` counts as a word character so `zip-archives` does not match `archive`.
    return new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`).test(text);
  }

  function nameMatches(kind: SurfaceKind, name: string, text: string, context: MentionContext): boolean {
    if (kind === "package.exports") {
      // Match pkg/subpath or ./subpath as substring.
      if (text.includes(name)) {
        return true;
      }
      if (name.includes("/") && !name.startsWith("./")) {
        const slash = name.indexOf("/");
        const sub = `./${name.slice(slash + 1)}`;
        return text.includes(sub);
      }
      return false;
    }

    const common = isCommonSurfaceWord(name);
    if (common && !COMMON_WORD_CONTEXTS.has(context)) {
      // Headings / bare prose ("Zip archives") must not satisfy common tokens.
      return false;
    }

    if (
      (kind === "action.input" || kind === "action.output") &&
      context === "fencedCode"
    ) {
      // `with:` / YAML key form — required for common words in fences; also
      // accepted for non-common action surfaces (existing behavior).
      if (yamlKeyMatch(name, text)) {
        return true;
      }
      // Common action names in a fence without a key form do not count.
      if (common) {
        return false;
      }
    }

    if (kind === "cli.flag" || kind === "cli.argv") {
      return wholeWordMatch(name, text);
    }

    return wholeWordMatch(name, text);
  }

  function anyNameMatches(
    kind: SurfaceKind,
    names: string[],
    text: string,
    context: MentionContext,
  ): boolean {
    return names.some((name) => nameMatches(kind, name, text, context));
  }

  return {
    docPaths,
    hasMention({ kind, name, aliases, docsGlobs }) {
      const names = [name, ...(aliases ?? [])];
      return filterSpans(kind, docsGlobs).some((span) =>
        anyNameMatches(kind, names, span.text, span.context),
      );
    },
    firstMention({ kind, name, aliases, docsGlobs }) {
      const names = [name, ...(aliases ?? [])];
      const hit = filterSpans(kind, docsGlobs).find((span) =>
        anyNameMatches(kind, names, span.text, span.context),
      );
      if (!hit) {
        return undefined;
      }
      return { docPath: hit.docPath, line: hit.line, context: hit.context };
    },
    countMentionsByDoc({ kind, names, docsGlobs }) {
      const counts = new Map<string, { count: number; firstLine: number }>();
      if (names.length === 0) {
        return counts;
      }
      for (const span of filterSpans(kind, docsGlobs)) {
        let matched = 0;
        for (const name of names) {
          if (nameMatches(kind, name, span.text, span.context)) {
            matched += 1;
          }
        }
        if (matched === 0) {
          continue;
        }
        const prev = counts.get(span.docPath);
        if (!prev) {
          counts.set(span.docPath, { count: matched, firstLine: span.line });
        } else {
          prev.count += matched;
          if (span.line < prev.firstLine) {
            prev.firstLine = span.line;
          }
        }
      }
      return counts;
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
