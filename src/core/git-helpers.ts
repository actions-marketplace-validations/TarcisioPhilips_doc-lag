import { execFileSync } from "node:child_process";
import { ScanError } from "../errors.js";
import { git } from "./git.js";

export interface MergeBaseResult {
  effectiveBase: string;
  mergeBaseFallback: boolean;
  warning?: string;
}

export interface NameStatusEntry {
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "other";
  path: string;
  previousPath?: string;
  /** Similarity percent 0–100 for renamed/copied entries. */
  similarity?: number;
  /** True when similarity is exactly 100 (pure rename/copy). */
  pureRename?: boolean;
}

export interface NumstatEntry {
  path: string;
  previousPath?: string;
  added: number;
  deleted: number;
  binary: boolean;
}

export interface CommitTrailerResult {
  found: boolean;
  /** Present when found; truncated to 100 characters. */
  value?: string;
  /** True when git is too old for %(trailers:...) — skip disabled. */
  unsupported?: boolean;
}

export interface GitHelperOptions {
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
  /**
   * Soft cap per object: larger blobs are skipped (null) with a warning.
   * Default 8 MiB — keeps huge single files from blowing the process.
   */
  catFileMaxObjectBytes?: number;
  /**
   * Max total uncompressed bytes per `git cat-file --batch` chunk.
   * Default 16 MiB — avoids Node's execFile maxBuffer crash on large ranges.
   */
  catFileChunkBudgetBytes?: number;
}

/** Default soft skip for a single git object in cat-file batches. */
export const CAT_FILE_MAX_OBJECT_BYTES = 8 * 1024 * 1024;
/** Default chunk budget for batched cat-file reads. */
export const CAT_FILE_CHUNK_BUDGET_BYTES = 16 * 1024 * 1024;

export interface CatFileBatch {
  /** Read an object (`sha` or `ref:path`). Returns null when missing. */
  read(object: string): Buffer | null;
  close(): void;
}

const TRAILER_VALUE_MAX = 100;

/**
 * Effective base for docs-sync: `git merge-base <base> <head>`.
 * On failure (e.g. shallow clone), falls back to `base` and sets mergeBaseFallback.
 */
export function resolveMergeBase(
  cwd: string,
  base: string,
  head: string,
  options: GitHelperOptions = {},
): MergeBaseResult {
  try {
    const effectiveBase = git(cwd, ["merge-base", base, head], {
      env: options.env,
    }).trim();
    if (!effectiveBase) {
      throw new Error("empty merge-base");
    }
    return { effectiveBase, mergeBaseFallback: false };
  } catch {
    const warning =
      "doc-lag: git merge-base failed (shallow clone?); falling back to base. Prefer fetch-depth: 0.";
    options.warn?.(warning);
    return {
      effectiveBase: base,
      mergeBaseFallback: true,
      warning,
    };
  }
}

function parseStatusCode(token: string): {
  status: NameStatusEntry["status"];
  similarity?: number;
  pureRename?: boolean;
} {
  const code = token[0];
  if (code === "R" || code === "C") {
    const similarity = Number.parseInt(token.slice(1), 10);
    const status = code === "R" ? "renamed" : "copied";
    if (Number.isFinite(similarity)) {
      return { status, similarity, pureRename: similarity === 100 };
    }
    return { status };
  }
  if (code === "A") return { status: "added" };
  if (code === "M") return { status: "modified" };
  if (code === "D") return { status: "deleted" };
  return { status: "other" };
}

/**
 * `git diff --name-status -M -z <base> <head>` with rename/copy similarity.
 */
export function diffNameStatusWithSimilarity(
  cwd: string,
  base: string,
  head: string,
  options: GitHelperOptions = {},
): NameStatusEntry[] {
  const output = git(cwd, ["diff", "--name-status", "-M", "-z", base, head], {
    env: options.env,
  });
  const tokens = output.split("\0").filter(Boolean);
  const entries: NameStatusEntry[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const parsed = parseStatusCode(token);
    if (parsed.status === "renamed" || parsed.status === "copied") {
      const previousPath = tokens[i + 1];
      const nextPath = tokens[i + 2];
      i += 2;
      if (!previousPath || !nextPath) {
        continue;
      }
      entries.push({
        status: parsed.status,
        path: nextPath,
        previousPath,
        similarity: parsed.similarity,
        pureRename: parsed.pureRename,
      });
      continue;
    }
    const filePath = tokens[i + 1];
    i += 1;
    if (!filePath) {
      continue;
    }
    entries.push({ status: parsed.status, path: filePath });
  }

  return entries;
}

/**
 * `git diff --numstat -M -z -w --ignore-blank-lines <base> <head>`
 * (`-w` ≡ `--ignore-all-space`).
 *
 * Rename records from git are shaped as: `added\\tdeleted\\t\\0old\\0new\\0`.
 * Regular records: `added\\tdeleted\\tpath\\0`.
 */
export function diffNumstatIgnoreWhitespace(
  cwd: string,
  base: string,
  head: string,
  options: GitHelperOptions = {},
): NumstatEntry[] {
  const output = git(
    cwd,
    ["diff", "--numstat", "-M", "-z", "-w", "--ignore-blank-lines", base, head],
    { env: options.env },
  );
  if (!output) {
    return [];
  }

  const entries: NumstatEntry[] = [];
  // Split carefully: keep empty fields (rename has empty path after tabs).
  const tokens = output.endsWith("\0") ? output.slice(0, -1).split("\0") : output.split("\0");

  for (let i = 0; i < tokens.length; i += 1) {
    const stats = tokens[i]!;
    const tab = stats.indexOf("\t");
    if (tab === -1) {
      continue;
    }
    const tab2 = stats.indexOf("\t", tab + 1);
    if (tab2 === -1) {
      continue;
    }
    const addedRaw = stats.slice(0, tab);
    const deletedRaw = stats.slice(tab + 1, tab2);
    const pathPart = stats.slice(tab2 + 1);
    const binary = addedRaw === "-" || deletedRaw === "-";
    const added = binary ? 0 : Number.parseInt(addedRaw, 10) || 0;
    const deleted = binary ? 0 : Number.parseInt(deletedRaw, 10) || 0;

    if (pathPart.length > 0) {
      entries.push({ path: pathPart, added, deleted, binary });
      continue;
    }

    // Rename/copy: following two NUL fields are old and new paths.
    const previousPath = tokens[i + 1];
    const nextPath = tokens[i + 2];
    i += 2;
    if (!previousPath || !nextPath) {
      continue;
    }
    entries.push({
      path: nextPath,
      previousPath,
      added,
      deleted,
      binary,
    });
  }

  return entries;
}

interface BatchCheckEntry {
  object: string;
  /** Uncompressed size when present; null when missing. */
  size: number | null;
}

/**
 * Size-check many objects via `git cat-file --batch-check` (tiny stdout).
 */
function catFileBatchCheck(
  cwd: string,
  objects: string[],
  options: GitHelperOptions,
): BatchCheckEntry[] {
  if (objects.length === 0) {
    return [];
  }
  let output: Buffer;
  try {
    output = execFileSync("git", ["-C", cwd, "cat-file", "--batch-check"], {
      input: `${objects.join("\n")}\n`,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env,
    });
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: Buffer | string }).stderr ?? "").trim()
        : "";
    const suffix = stderr ? `: ${stderr}` : "";
    throw new ScanError(`git cat-file --batch-check failed${suffix}`);
  }

  const lines = output.toString("utf8").split("\n");
  // Trailing newline yields an empty last line.
  const entries: BatchCheckEntry[] = [];
  let lineIndex = 0;
  for (const object of objects) {
    const line = lines[lineIndex] ?? "";
    lineIndex += 1;
    if (!line || line.endsWith(" missing")) {
      entries.push({ object, size: null });
      continue;
    }
    const match = /^(?<sha>[0-9a-f]+)\s+(?<type>\w+)\s+(?<size>\d+)$/.exec(line);
    if (!match?.groups) {
      throw new ScanError(`Unexpected git cat-file --batch-check line: ${line}`);
    }
    entries.push({ object, size: Number.parseInt(match.groups.size!, 10) });
  }
  return entries;
}

function parseCatFileBatchOutput(
  output: Buffer,
  objects: string[],
): Map<string, Buffer | null> {
  const results = new Map<string, Buffer | null>();
  let offset = 0;
  for (const object of objects) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) {
      throw new ScanError("Unexpected git cat-file --batch output (truncated header)");
    }
    const header = output.subarray(offset, headerEnd).toString("utf8");
    offset = headerEnd + 1;
    if (header.endsWith(" missing")) {
      results.set(object, null);
      continue;
    }
    const match = /^(?<sha>[0-9a-f]+)\s+(?<type>\w+)\s+(?<size>\d+)$/.exec(header);
    if (!match?.groups) {
      throw new ScanError(`Unexpected git cat-file header: ${header}`);
    }
    const size = Number.parseInt(match.groups.size!, 10);
    if (offset + size + 1 > output.length) {
      throw new ScanError("Unexpected git cat-file --batch output (truncated content)");
    }
    const content = Buffer.from(output.subarray(offset, offset + size));
    offset += size;
    if (output[offset] !== 0x0a) {
      throw new ScanError("Unexpected git cat-file framing");
    }
    offset += 1;
    results.set(object, content);
  }
  return results;
}

function isMaxBufferError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const err = error as { code?: string; message?: string };
  return (
    err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
    Boolean(err.message && /maxBuffer/i.test(err.message))
  );
}

function catFileBatchChunk(
  cwd: string,
  objects: string[],
  options: GitHelperOptions,
  maxBuffer: number,
): Map<string, Buffer | null> {
  if (objects.length === 0) {
    return new Map();
  }
  let output: Buffer;
  try {
    output = execFileSync("git", ["-C", cwd, "cat-file", "--batch"], {
      input: `${objects.join("\n")}\n`,
      maxBuffer,
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env,
    });
  } catch (error) {
    if (isMaxBufferError(error)) {
      throw error;
    }
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: Buffer | string }).stderr ?? "").trim()
        : "";
    const suffix = stderr ? `: ${stderr}` : "";
    throw new ScanError(`git cat-file --batch failed${suffix}`);
  }
  return parseCatFileBatchOutput(output, objects);
}

/** One-shot batch with a large buffer (fast path for normal PRs). */
const CAT_FILE_ONESHOT_MAX_BUFFER = 256 * 1024 * 1024;

function catFileBatchChunked(
  cwd: string,
  objects: string[],
  options: GitHelperOptions,
): Map<string, Buffer | null> {
  const results = new Map<string, Buffer | null>();
  const maxObject = options.catFileMaxObjectBytes ?? CAT_FILE_MAX_OBJECT_BYTES;
  const chunkBudget = options.catFileChunkBudgetBytes ?? CAT_FILE_CHUNK_BUDGET_BYTES;
  const checked = catFileBatchCheck(cwd, objects, options);

  const pending: Array<{ object: string; size: number }> = [];
  for (const entry of checked) {
    if (entry.size === null) {
      results.set(entry.object, null);
      continue;
    }
    if (entry.size > maxObject) {
      options.warn?.(
        `doc-lag: skipping oversized git object ${entry.object} (>${maxObject} bytes)`,
      );
      results.set(entry.object, null);
      continue;
    }
    pending.push({ object: entry.object, size: entry.size });
  }

  let chunk: string[] = [];
  let chunkBytes = 0;
  const flush = (): void => {
    if (chunk.length === 0) {
      return;
    }
    const partial = catFileBatchChunk(
      cwd,
      chunk,
      options,
      Math.max(32 * 1024 * 1024, chunkBudget + 1024 * 1024),
    );
    for (const [key, value] of partial) {
      results.set(key, value);
    }
    chunk = [];
    chunkBytes = 0;
  };

  for (const item of pending) {
    if (chunk.length > 0 && chunkBytes + item.size > chunkBudget) {
      flush();
    }
    chunk.push(item.object);
    chunkBytes += item.size;
    if (chunkBytes >= chunkBudget) {
      flush();
    }
  }
  flush();
  return results;
}

/**
 * Read many git objects via `git cat-file --batch`.
 * Keys are the requested object names (`sha` or `ref:path`). Missing → null.
 *
 * Fast path: one batch with a large maxBuffer (byte-identical for normal ranges).
 * On maxBuffer overflow, or when test overrides request chunking: size-check via
 * `--batch-check`, skip oversized objects with a warning, and fetch in budgeted
 * chunks so huge diffs do not abort with exit 2. Read-only.
 */
export function catFileBatch(
  cwd: string,
  objects: string[],
  options: GitHelperOptions = {},
): Map<string, Buffer | null> {
  if (objects.length === 0) {
    return new Map();
  }

  const forceChunked =
    options.catFileChunkBudgetBytes !== undefined ||
    options.catFileMaxObjectBytes !== undefined;

  if (!forceChunked) {
    try {
      return catFileBatchChunk(cwd, objects, options, CAT_FILE_ONESHOT_MAX_BUFFER);
    } catch (error) {
      if (!isMaxBufferError(error)) {
        const stderr =
          error && typeof error === "object" && "stderr" in error
            ? String((error as { stderr?: Buffer | string }).stderr ?? "").trim()
            : "";
        const suffix = stderr ? `: ${stderr}` : "";
        throw new ScanError(`git cat-file --batch failed${suffix}`);
      }
      options.warn?.(
        "doc-lag: git cat-file --batch exceeded buffer; retrying in size-budgeted chunks",
      );
    }
  }

  return catFileBatchChunked(cwd, objects, options);
}

/**
 * Convenience reader over `catFileBatch`. Prefer `catFileBatch` when all paths are known.
 * Each `read` issues a one-object batch (still read-only).
 */
export function createCatFileBatch(
  cwd: string,
  options: GitHelperOptions = {},
): CatFileBatch {
  const cache = new Map<string, Buffer | null>();
  let closed = false;
  return {
    read(object: string): Buffer | null {
      if (closed) {
        throw new ScanError("git cat-file --batch already closed");
      }
      if (!cache.has(object)) {
        const batch = catFileBatch(cwd, [object], options);
        cache.set(object, batch.get(object) ?? null);
      }
      return cache.get(object) ?? null;
    },
    close(): void {
      closed = true;
      cache.clear();
    },
  };
}

function supportsTrailersFormat(cwd: string, options: GitHelperOptions): boolean {
  try {
    const sample = git(
      cwd,
      ["log", "-1", "--format=%(trailers:key=Docs-Not-Needed,valueonly)"],
      { env: options.env },
    );
    return !sample.includes("%(trailers:");
  } catch {
    return false;
  }
}

/**
 * Search `git log <base>..<head>` for a commit trailer key.
 * Non-empty value → found (truncated to 100). Empty-only → warning, not found.
 * Unsupported git → unsupported: true + warning (skip disabled).
 */
export function findCommitTrailer(
  cwd: string,
  base: string,
  head: string,
  trailerKey: string,
  options: GitHelperOptions = {},
): CommitTrailerResult {
  if (!supportsTrailersFormat(cwd, options)) {
    options.warn?.(
      "doc-lag: git is too old for commit trailer parsing; docs-sync trailer skip disabled (need git ≥ 2.25).",
    );
    return { found: false, unsupported: true };
  }

  const format = `%(trailers:key=${trailerKey},valueonly)`;
  let output: string;
  try {
    output = git(cwd, ["log", `${base}..${head}`, `--format=${format}`], {
      env: options.env,
    });
  } catch (error) {
    if (error instanceof ScanError) {
      options.warn?.(
        "doc-lag: unable to read commit trailers; docs-sync trailer skip disabled.",
      );
      return { found: false, unsupported: true };
    }
    throw error;
  }

  for (const line of output.split(/\r?\n/)) {
    const value = line.trim();
    if (value.length === 0) {
      continue;
    }
    return {
      found: true,
      value: value.length > TRAILER_VALUE_MAX ? value.slice(0, TRAILER_VALUE_MAX) : value,
    };
  }

  // valueonly cannot distinguish "no trailer" from "empty trailer"; scan bodies.
  let sawEmpty = false;
  try {
    const bodies = git(cwd, ["log", `${base}..${head}`, "--format=%B%x00"], {
      env: options.env,
    });
    const keyPrefix = `${trailerKey}:`;
    for (const body of bodies.split("\0")) {
      for (const line of body.split(/\r?\n/)) {
        if (!line.startsWith(keyPrefix)) {
          continue;
        }
        const rest = line.slice(keyPrefix.length).trim();
        if (rest.length === 0) {
          sawEmpty = true;
        } else {
          return {
            found: true,
            value: rest.length > TRAILER_VALUE_MAX ? rest.slice(0, TRAILER_VALUE_MAX) : rest,
          };
        }
      }
    }
  } catch {
    // ignore secondary probe failures
  }

  if (sawEmpty) {
    options.warn?.(
      `doc-lag: found empty "${trailerKey}" commit trailer (a reason is required); ignoring.`,
    );
  }
  return { found: false };
}

/**
 * Paths with `linguist-generated` set/true at `ref` (via `git check-attr --source`).
 */
export function listLinguistGenerated(
  cwd: string,
  ref: string,
  paths: string[],
  options: GitHelperOptions = {},
): Set<string> {
  const generated = new Set<string>();
  if (paths.length === 0) {
    return generated;
  }

  const output = git(
    cwd,
    ["check-attr", "--source", ref, "-z", "--stdin", "linguist-generated"],
    {
      env: options.env,
      input: `${paths.join("\0")}\0`,
    },
  );

  const tokens = output.split("\0").filter(Boolean);
  for (let i = 0; i + 2 < tokens.length; i += 3) {
    const filePath = tokens[i]!;
    const value = tokens[i + 2]!;
    if (value === "set" || value === "true") {
      generated.add(filePath);
    }
  }
  return generated;
}
