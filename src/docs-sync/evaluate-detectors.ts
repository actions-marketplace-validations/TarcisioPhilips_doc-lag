import { catFileBatch } from "../core/git-helpers.js";
import type { DocsSyncConfig, SurfaceKind } from "../core/docs-sync-config.js";
import { listDocumentationFiles } from "../core/docs.js";
import type { DocsDiscoveryOptions, Finding } from "../types.js";
import { createGlobMatcher, matchesAnyGlob, matchesGlob, normalizeRepoPath } from "./match.js";
import {
  isRegisteredDetectorKind,
  runRegisteredDetectors,
} from "./detectors/registry.js";
import { KIND_LABELS, type SurfaceDecl } from "./detectors/types.js";
import { buildMentionIndex, type MentionIndex } from "./mention-index.js";

export interface DetectorEvalResult {
  findings: Finding[];
  newSurfaces: number;
  warnings: string[];
}

function surfaceKey(kind: SurfaceKind, name: string): string {
  return `${kind}\0${name}`;
}

function parseIgnoreSymbols(
  entries: string[],
): Array<{ kind: string; name: string; glob?: string }> {
  return entries.map((entry) => {
    const at = entry.indexOf("@");
    const main = at === -1 ? entry : entry.slice(0, at);
    const glob = at === -1 ? undefined : entry.slice(at + 1);
    const colon = main.indexOf(":");
    return {
      kind: main.slice(0, colon),
      name: main.slice(colon + 1),
      glob: glob || undefined,
    };
  });
}

function isIgnored(
  surface: SurfaceDecl,
  ignores: Array<{ kind: string; name: string; glob?: string }>,
): boolean {
  return ignores.some((ignore) => {
    if (ignore.kind !== surface.kind || ignore.name !== surface.name) {
      return false;
    }
    if (!ignore.glob) {
      return true;
    }
    return matchesGlob(surface.path, ignore.glob);
  });
}

function collectSurfaces(options: {
  cwd: string;
  ref: string;
  paths: string[];
  enabledKinds: SurfaceKind[];
  warn?: (message: string) => void;
}): Map<string, SurfaceDecl> {
  const map = new Map<string, SurfaceDecl>();
  if (options.paths.length === 0 || options.enabledKinds.length === 0) {
    return map;
  }
  const objects = options.paths.map((p) => `${options.ref}:${p}`);
  const blobs = catFileBatch(options.cwd, objects);
  for (const filePath of options.paths) {
    const buf = blobs.get(`${options.ref}:${filePath}`);
    if (!buf) {
      continue;
    }
    const content = buf.toString("utf8");
    const decls = runRegisteredDetectors({
      kinds: options.enabledKinds,
      path: filePath,
      content,
      warn: options.warn,
    });
    for (const decl of decls) {
      const key = surfaceKey(decl.kind, decl.name);
      // First declaration wins (stable); later duplicates ignored.
      if (!map.has(key)) {
        map.set(key, decl);
      }
    }
  }
  return map;
}

function filterPathsForKinds(
  paths: string[],
  kinds: SurfaceKind[],
  config: DocsSyncConfig,
): string[] {
  const globs = new Set<string>();
  for (const kind of kinds) {
    for (const pattern of config.detectors[kind].paths) {
      globs.add(pattern);
    }
  }
  const matches = createGlobMatcher([...globs]);
  return paths.filter((p) => matches(p));
}

/** Walk up from the source dir; cache by directory so siblings share one lookup. */
function nearestReadme(
  sourcePath: string,
  headFiles: Set<string>,
  cache: Map<string, string | undefined>,
): string | undefined {
  const parts = normalizeRepoPath(sourcePath).split("/");
  parts.pop();
  const dirKey = parts.join("/");
  if (cache.has(dirKey)) {
    return cache.get(dirKey);
  }
  let result: string | undefined;
  const walk = [...parts];
  while (true) {
    const candidate = walk.length === 0 ? "README.md" : `${walk.join("/")}/README.md`;
    if (headFiles.has(candidate)) {
      result = candidate;
      break;
    }
    if (walk.length === 0) {
      break;
    }
    walk.pop();
  }
  cache.set(dirKey, result);
  return result;
}

function suggestDetectorTarget(options: {
  surface: SurfaceDecl;
  baseSurfaces: SurfaceDecl[];
  index: MentionIndex;
  docsGlobs: string[] | undefined;
  headFiles: Set<string>;
  readmeCache: Map<string, string | undefined>;
}): { path: string; line: number; siblings: string[] } {
  const { surface, baseSurfaces, index, docsGlobs, headFiles, readmeCache } = options;
  const siblings = baseSurfaces
    .filter((s) => s.kind === surface.kind && s.path === surface.path && s.name !== surface.name)
    .map((s) => s.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (siblings.length > 0) {
    const counts = index.countMentionsByDoc({
      kind: surface.kind,
      names: siblings,
      docsGlobs,
    });
    let bestPath: string | undefined;
    let bestCount = -1;
    let bestLine = 1;
    for (const [docPath, info] of [...counts.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    )) {
      if (info.count > bestCount) {
        bestCount = info.count;
        bestPath = docPath;
        bestLine = info.firstLine;
      }
    }
    if (bestPath && bestCount > 0) {
      return {
        path: bestPath,
        line: bestLine,
        siblings: siblings.slice(0, 3),
      };
    }
  }

  const readme = nearestReadme(surface.path, headFiles, readmeCache);
  if (readme) {
    return { path: readme, line: 1, siblings: siblings.slice(0, 3) };
  }

  if (docsGlobs && docsGlobs.length > 0) {
    const matched = index.docPaths.filter((p) => matchesAnyGlob(p, docsGlobs));
    if (matched[0]) {
      return { path: matched[0], line: 1, siblings: siblings.slice(0, 3) };
    }
  } else if (index.docPaths[0]) {
    return { path: index.docPaths[0], line: 1, siblings: siblings.slice(0, 3) };
  }

  return { path: "README.md", line: 1, siblings: siblings.slice(0, 3) };
}

function buildDetectorFinding(options: {
  surface: SurfaceDecl;
  target: { path: string; line: number; siblings: string[] };
  docsGlobs: string[] | undefined;
  enforced: boolean;
  changeKind: "added" | "modified" | "renamed" | "deleted";
}): Finding {
  const { surface, target, docsGlobs, enforced, changeKind } = options;
  const label = KIND_LABELS[surface.kind];
  const message = `New ${label} \`${surface.name}\` (${surface.path}:${surface.line}) is not mentioned in any documentation.`;
  const near =
    target.line > 1 || target.siblings.length > 0
      ? ` near line ${target.line}${
          target.siblings.length > 0 ? `, next to ${target.siblings.map((s) => `\`${s}\``).join(", ")}` : ""
        }`
      : "";
  const suggestion = `Document \`${surface.name}\` in ${target.path}${near}. If it is intentionally undocumented, add "${surface.kind}:${surface.name}" to docsSync.ignoreSymbols.`;

  return {
    id: `docs.missing:${surface.kind}:${surface.name}@${surface.path}`,
    ruleId: "docs.missing",
    status: "needs-review",
    severity: "warning",
    message,
    documentation: { path: target.path, line: target.line },
    evidence: [
      {
        path: surface.path,
        pointer: surface.pointer,
        base: null,
        head: surface.literal,
      },
    ],
    change: { path: surface.path, kind: changeKind },
    suggestion,
    enforced: enforced || undefined,
    surface: {
      trigger: "detector",
      kind: surface.kind,
      name: surface.name,
      source: { path: surface.path, line: surface.line },
      expectedDocs: docsGlobs && docsGlobs.length > 0 ? [...docsGlobs] : ["**"],
    },
  };
}

/**
 * Run structured detectors on base/head candidates, mention-check new surfaces,
 * and return docs.missing findings.
 */
export function evaluateDetectorFindings(options: {
  cwd: string;
  effectiveBase: string;
  head: string;
  headFiles: string[];
  baseSidePaths: string[];
  headSidePaths: string[];
  /** path → change kind for head-side files. */
  changeKindByPath: Map<string, "added" | "modified" | "renamed" | "deleted">;
  config: DocsSyncConfig;
  docsOptions: DocsDiscoveryOptions;
  warn?: (message: string) => void;
}): DetectorEvalResult {
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
    options.warn?.(message);
  };

  const enabledKinds = (Object.keys(options.config.detectors) as SurfaceKind[]).filter(
    (kind) => options.config.detectors[kind].enabled,
  );

  // Only kinds with a registered detector produce surfaces here.
  const registeredEnabled = enabledKinds.filter(isRegisteredDetectorKind);

  if (registeredEnabled.length === 0) {
    return { findings: [], newSurfaces: 0, warnings };
  }

  const basePaths = filterPathsForKinds(
    options.baseSidePaths,
    registeredEnabled,
    options.config,
  );
  const headPaths = filterPathsForKinds(
    options.headSidePaths,
    registeredEnabled,
    options.config,
  );

  const baseSurfaces = collectSurfaces({
    cwd: options.cwd,
    ref: options.effectiveBase,
    paths: basePaths,
    enabledKinds: registeredEnabled,
    warn,
  });
  const headSurfaces = collectSurfaces({
    cwd: options.cwd,
    ref: options.head,
    paths: headPaths,
    enabledKinds: registeredEnabled,
    warn,
  });

  const ignores = parseIgnoreSymbols(options.config.ignoreSymbols);
  const newSurfaces: SurfaceDecl[] = [];
  for (const [key, surface] of headSurfaces) {
    if (baseSurfaces.has(key)) {
      continue;
    }
    if (isIgnored(surface, ignores)) {
      continue;
    }
    newSurfaces.push(surface);
  }
  newSurfaces.sort(
    (a, b) =>
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );

  if (newSurfaces.length === 0) {
    return { findings: [], newSurfaces: 0, warnings };
  }

  const docPaths = listDocumentationFiles(options.headFiles, options.docsOptions);
  const docObjects = docPaths.map((p) => `${options.head}:${p}`);
  const docBlobs =
    docObjects.length > 0 ? catFileBatch(options.cwd, docObjects) : new Map<string, Buffer | null>();
  const docs: Array<{ path: string; content: string }> = [];
  for (const docPath of docPaths) {
    const buf = docBlobs.get(`${options.head}:${docPath}`);
    if (buf) {
      docs.push({ path: docPath, content: buf.toString("utf8") });
    }
  }
  const index = buildMentionIndex({ docs });
  const headFileSet = new Set(options.headFiles);
  const baseList = [...baseSurfaces.values()];
  const readmeCache = new Map<string, string | undefined>();

  const findings: Finding[] = [];
  for (const surface of newSurfaces) {
    const detectorDocs = options.config.detectors[surface.kind].docs;
    if (
      index.hasMention({
        kind: surface.kind,
        name: surface.name,
        aliases: surface.mentionNames?.filter((n) => n !== surface.name),
        docsGlobs: detectorDocs,
      })
    ) {
      continue;
    }
    const target = suggestDetectorTarget({
      surface,
      baseSurfaces: baseList.filter((s) => s.path === surface.path),
      index,
      docsGlobs: detectorDocs,
      headFiles: headFileSet,
      readmeCache,
    });
    findings.push(
      buildDetectorFinding({
        surface,
        target,
        docsGlobs: detectorDocs,
        enforced: options.config.enforce,
        changeKind: options.changeKindByPath.get(surface.path) ?? "modified",
      }),
    );
  }

  return {
    findings,
    newSurfaces: newSurfaces.length,
    warnings,
  };
}
