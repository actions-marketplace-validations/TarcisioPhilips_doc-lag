import {
  diffNumstatIgnoreWhitespace,
  type NameStatusEntry,
  type NumstatEntry,
} from "../core/git-helpers.js";
import type { DocsSyncConfig, DocsSyncRule } from "../core/docs-sync-config.js";
import type { ChangeInfo, EvidenceItem, Finding } from "../types.js";
import type { CandidateFile } from "./candidates.js";
import {
  createGlobMatcher,
  isGlobPattern,
  normalizeRepoPath,
  packageRootFor,
  resolveDocsPattern,
} from "./match.js";

const MATCHED_FILES_CAP = 20;

export interface RuleEvalContext {
  cwd: string;
  effectiveBase: string;
  head: string;
  headFiles: Set<string>;
  entries: NameStatusEntry[];
  codeCandidates: CandidateFile[];
  config: DocsSyncConfig;
}

function numstatIndex(entries: NumstatEntry[]): Map<string, NumstatEntry> {
  const map = new Map<string, NumstatEntry>();
  for (const entry of entries) {
    map.set(normalizeRepoPath(entry.path), entry);
    if (entry.previousPath) {
      map.set(normalizeRepoPath(entry.previousPath), entry);
    }
  }
  return map;
}

function entryByPath(entries: NameStatusEntry[]): Map<string, NameStatusEntry> {
  const map = new Map<string, NameStatusEntry>();
  for (const entry of entries) {
    map.set(normalizeRepoPath(entry.path), entry);
    if (entry.previousPath) {
      map.set(normalizeRepoPath(entry.previousPath), entry);
    }
  }
  return map;
}

/**
 * Meaningful doc change: numstat added+deleted > 0, not deleted, not R100.
 */
export function isMeaningfulChange(
  path: string,
  nameStatus: Map<string, NameStatusEntry>,
  numstat: Map<string, NumstatEntry>,
): boolean {
  const normalized = normalizeRepoPath(path);
  const status = nameStatus.get(normalized);
  if (!status) {
    return false;
  }
  if (status.status === "deleted") {
    return false;
  }
  if (status.pureRename) {
    return false;
  }
  const stats = numstat.get(normalized);
  if (!stats || stats.binary) {
    return false;
  }
  return stats.added + stats.deleted > 0;
}

function suggestRuleTarget(
  rule: DocsSyncRule,
  headFiles: Set<string>,
  packageRoot?: string,
): { path: string; line: number } {
  const patterns = rule.docs.map((pattern) => resolveDocsPattern(pattern, packageRoot));
  const literals = patterns.filter((p) => !isGlobPattern(p));
  const globs = patterns.filter((p) => isGlobPattern(p));

  for (const literal of literals) {
    if (headFiles.has(literal)) {
      return { path: literal, line: 1 };
    }
  }

  const globMatch = createGlobMatcher(globs);
  const matched: string[] = [];
  for (const filePath of headFiles) {
    if (globMatch(filePath)) {
      matched.push(filePath);
    }
  }
  matched.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (matched[0]) {
    return { path: matched[0], line: 1 };
  }

  if (literals[0]) {
    return { path: literals[0], line: 1 };
  }
  return { path: patterns[0] ?? "README.md", line: 1 };
}

function buildRuleFinding(options: {
  rule: DocsSyncRule;
  matched: CandidateFile[];
  packageRoot?: string;
  target: { path: string; line: number };
  skipLabel: string;
  skipTrailer: string;
  enforced: boolean;
}): Finding {
  const { rule, matched, packageRoot, target, skipLabel, skipTrailer, enforced } = options;
  const sorted = [...matched].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const shown = sorted.slice(0, MATCHED_FILES_CAP);
  const docsList = rule.docs
    .map((pattern) => resolveDocsPattern(pattern, packageRoot))
    .join(", ");

  const message =
    rule.message ??
    `Files matching rule "${rule.name}" changed (${sorted.length} file(s)) but no documentation matching ${docsList} was updated.`;

  const suggestion = `Update ${target.path} to reflect the change, or skip with the "${skipLabel}" label / "${skipTrailer}: <reason>" commit trailer if no docs are needed.`;

  const evidence: EvidenceItem[] = shown.map((file) => ({
    path: file.path,
    pointer: "changed",
    head: file.kind,
  }));

  const first = sorted[0]!;
  const change: ChangeInfo = {
    path: first.path,
    kind: first.kind,
  };

  const id = packageRoot
    ? `docs.missing:rule:${rule.name}@${packageRoot}`
    : `docs.missing:rule:${rule.name}`;

  return {
    id,
    ruleId: "docs.missing",
    status: "needs-review",
    severity: "warning",
    message,
    documentation: target,
    evidence,
    change,
    suggestion,
    enforced: enforced || undefined,
    surface: {
      trigger: "rule",
      rule: rule.name,
      package: packageRoot,
      matchedFiles: shown.map((f) => f.path),
      matchedFilesTotal: sorted.length,
      expectedDocs: rule.docs.map((pattern) =>
        resolveDocsPattern(pattern, packageRoot),
      ),
    },
  };
}

function ruleCodeMatches(
  file: CandidateFile,
  rule: DocsSyncRule,
  codeMatches: (path: string) => boolean,
  excludeMatches: (path: string) => boolean,
): boolean {
  if (file.pureRename) {
    return false;
  }
  if (!rule.changeKinds.includes(file.kind)) {
    return false;
  }
  if (!codeMatches(file.path)) {
    return false;
  }
  if (rule.exclude.length > 0 && excludeMatches(file.path)) {
    return false;
  }
  return true;
}

function docsMeaningfullyUpdated(
  rule: DocsSyncRule,
  ctx: RuleEvalContext,
  nameStatus: Map<string, NameStatusEntry>,
  numstat: Map<string, NumstatEntry>,
  packageRoot?: string,
): boolean {
  const patterns = rule.docs.map((pattern) => resolveDocsPattern(pattern, packageRoot));
  const docsMatch = createGlobMatcher(patterns);
  for (const entry of ctx.entries) {
    const path = normalizeRepoPath(entry.path);
    if (!docsMatch(path)) {
      continue;
    }
    if (isMeaningfulChange(path, nameStatus, numstat)) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluate pairing rules → docs.missing findings.
 */
export function evaluatePairingRules(ctx: RuleEvalContext): Finding[] {
  if (ctx.config.rules.length === 0) {
    return [];
  }

  const numstatEntries = diffNumstatIgnoreWhitespace(
    ctx.cwd,
    ctx.effectiveBase,
    ctx.head,
  );
  const numstat = numstatIndex(numstatEntries);
  const nameStatus = entryByPath(ctx.entries);
  const findings: Finding[] = [];
  const skipLabel = ctx.config.skipLabels[0] ?? "no-docs-needed";
  const skipTrailer = ctx.config.skipTrailer;

  for (const rule of ctx.config.rules) {
    const codeMatches = createGlobMatcher(rule.code);
    const excludeMatches = createGlobMatcher(rule.exclude);
    const matched = ctx.codeCandidates.filter((file) =>
      ruleCodeMatches(file, rule, codeMatches, excludeMatches),
    );
    if (matched.length === 0) {
      continue;
    }

    if (rule.perPackage) {
      const byPackage = new Map<string, CandidateFile[]>();
      for (const file of matched) {
        const root = packageRootFor(file.path, ctx.config.packages);
        if (!root) {
          continue;
        }
        const list = byPackage.get(root) ?? [];
        list.push(file);
        byPackage.set(root, list);
      }
      const roots = [...byPackage.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      for (const root of roots) {
        const files = byPackage.get(root)!;
        if (docsMeaningfullyUpdated(rule, ctx, nameStatus, numstat, root)) {
          continue;
        }
        findings.push(
          buildRuleFinding({
            rule,
            matched: files,
            packageRoot: root,
            target: suggestRuleTarget(rule, ctx.headFiles, root),
            skipLabel,
            skipTrailer,
            enforced: ctx.config.enforce,
          }),
        );
      }
      continue;
    }

    if (docsMeaningfullyUpdated(rule, ctx, nameStatus, numstat)) {
      continue;
    }
    findings.push(
      buildRuleFinding({
        rule,
        matched,
        target: suggestRuleTarget(rule, ctx.headFiles),
        skipLabel,
        skipTrailer,
        enforced: ctx.config.enforce,
      }),
    );
  }

  return findings;
}
