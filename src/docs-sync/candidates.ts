import {
  catFileBatch,
  diffNameStatusWithSimilarity,
  listLinguistGenerated,
  type NameStatusEntry,
} from "../core/git-helpers.js";
import {
  DEFAULT_CODE_EXCLUDE,
  type ChangeKind,
} from "../core/docs-sync-config.js";
import { createDocumentationPathMatcher } from "../core/docs.js";
import type { DocsDiscoveryOptions } from "../types.js";
import { createGlobMatcher, normalizeRepoPath } from "./match.js";

export const MAX_CANDIDATE_CODE_FILES = 2000;
export const MAX_FILE_BYTES = 1_048_576;
export const BINARY_SAMPLE_BYTES = 8192;

const GENERATED_HEADER =
  /@generated\b|DO NOT EDIT\b|Code generated\b/i;

export interface CandidateFile {
  path: string;
  /** Previous path for renames/copies. */
  previousPath?: string;
  kind: ChangeKind;
  /** True when R100 / C100 — excluded from pairing-rule matches. */
  pureRename: boolean;
}

export interface CandidateBuildResult {
  /** All name-status entries (code + docs + other). */
  entries: NameStatusEntry[];
  /** Code candidates for detectors (A/M/R<100/C; excludes docs/ignores/generated/…). */
  codeCandidates: CandidateFile[];
  /** Paths to read on the base side (deleted + rename/copy sources). */
  baseSidePaths: string[];
  /** Paths to read on the head side (A/M/R/C destinations). */
  headSidePaths: string[];
  truncated: boolean;
  warnings: string[];
}

function toChangeKind(entry: NameStatusEntry): ChangeKind | null {
  switch (entry.status) {
    case "added":
    case "copied":
      return "added";
    case "modified":
      return "modified";
    case "deleted":
      return "deleted";
    case "renamed":
      return "renamed";
    default:
      return null;
  }
}

function looksGeneratedHeader(content: Buffer): boolean {
  const sample = content.subarray(0, Math.min(content.length, 4096)).toString("utf8");
  const lines = sample.split(/\r?\n/).slice(0, 5);
  return lines.some((line) => GENERATED_HEADER.test(line));
}

function isBinaryBuffer(content: Buffer): boolean {
  const sample = content.subarray(0, Math.min(content.length, BINARY_SAMPLE_BYTES));
  return sample.includes(0);
}

/**
 * Build docs-sync candidate sets from `effBase..head`.
 */
export function buildCandidates(options: {
  cwd: string;
  effectiveBase: string;
  head: string;
  docsOptions: DocsDiscoveryOptions;
  ignore: string[];
  warn?: (message: string) => void;
}): CandidateBuildResult {
  const warnings: string[] = [];
  const entries = diffNameStatusWithSimilarity(
    options.cwd,
    options.effectiveBase,
    options.head,
  );

  const isExcluded = createGlobMatcher([...DEFAULT_CODE_EXCLUDE, ...options.ignore]);
  const isDocPath = createDocumentationPathMatcher(options.docsOptions);
  const headPathsForAttr = [
    ...new Set(
      entries
        .filter((e) => e.status !== "deleted")
        .map((e) => e.path)
        .filter(Boolean),
    ),
  ];
  const linguistGenerated = listLinguistGenerated(
    options.cwd,
    options.head,
    headPathsForAttr,
  );

  // Prefetch head contents for non-deleted changed paths (generated/binary/size checks).
  const headObjectNames = headPathsForAttr.map((p) => `${options.head}:${p}`);
  const headBlobs =
    headObjectNames.length > 0
      ? catFileBatch(options.cwd, headObjectNames)
      : new Map<string, Buffer | null>();

  const codeCandidates: CandidateFile[] = [];
  const baseSidePaths: string[] = [];
  const headSidePaths: string[] = [];
  let truncated = false;

  for (const entry of entries) {
    const kind = toChangeKind(entry);
    if (kind === null) {
      continue;
    }

    const path = normalizeRepoPath(entry.path);
    const previousPath = entry.previousPath
      ? normalizeRepoPath(entry.previousPath)
      : undefined;
    const pureRename = entry.pureRename === true;

    // Docs set is never "code".
    const pathIsDoc = isDocPath(path);
    const prevIsDoc = previousPath ? isDocPath(previousPath) : false;

    if (kind === "deleted") {
      if (!pathIsDoc && !isExcluded(path)) {
        baseSidePaths.push(path);
      }
      // Deleted code still participates in pairing rules when changeKinds includes deleted.
      if (!pathIsDoc && !isExcluded(path) && !linguistGenerated.has(path)) {
        codeCandidates.push({ path, kind, pureRename: false });
      }
      continue;
    }

    if (pathIsDoc || (kind === "renamed" && prevIsDoc && pathIsDoc)) {
      continue;
    }
    if (isExcluded(path)) {
      continue;
    }
    if (linguistGenerated.has(path)) {
      continue;
    }

    const blob = headBlobs.get(`${options.head}:${path}`) ?? null;
    if (blob) {
      if (blob.length > MAX_FILE_BYTES) {
        truncated = true;
        warnings.push(
          `doc-lag: skipping oversized file ${path} (>${MAX_FILE_BYTES} bytes) for docs-sync`,
        );
        options.warn?.(warnings[warnings.length - 1]!);
        continue;
      }
      if (isBinaryBuffer(blob)) {
        continue;
      }
      if (looksGeneratedHeader(blob)) {
        continue;
      }
    }

    // Detector head-side: A/M/R<100/C (not pure R100).
    if (!pureRename) {
      headSidePaths.push(path);
    }
    // Base-side rename/copy sources so moves are not "new".
    if (previousPath && (kind === "renamed" || entry.status === "copied")) {
      baseSidePaths.push(previousPath);
    }
    if (kind === "modified" || kind === "added") {
      // modified also exists at base
      if (kind === "modified") {
        baseSidePaths.push(path);
      }
    }

    codeCandidates.push({
      path,
      previousPath,
      kind,
      pureRename,
    });
  }

  if (codeCandidates.length > MAX_CANDIDATE_CODE_FILES) {
    truncated = true;
    warnings.push(
      `doc-lag: docs-sync candidate cap (${MAX_CANDIDATE_CODE_FILES}) hit; truncating`,
    );
    options.warn?.(warnings[warnings.length - 1]!);
    codeCandidates.length = MAX_CANDIDATE_CODE_FILES;
  }

  return {
    entries,
    codeCandidates,
    baseSidePaths: [...new Set(baseSidePaths)].sort(),
    headSidePaths: [...new Set(headSidePaths)].sort(),
    truncated,
    warnings,
  };
}
