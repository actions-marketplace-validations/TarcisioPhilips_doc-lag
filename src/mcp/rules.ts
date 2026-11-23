import {
  DEFAULT_DETECTOR_ENABLED,
  SURFACE_KINDS,
  type SurfaceKind,
} from "../core/docs-sync-config.js";
import { KIND_LABELS } from "../docs-sync/detectors/types.js";

export interface RuleInfo {
  id: string;
  title: string;
  description: string;
  /** How findings from this rule are typically classified. */
  statuses: Array<"confirmed" | "needs-review" | "unknown">;
}

export interface DetectorInfo {
  id: SurfaceKind;
  title: string;
  /** Whether the detector is on by default when docsSync is enabled. */
  defaultEnabled: boolean;
  /** Languages / formats the v1 detector covers. */
  languages: string[];
}

/**
 * Catalog of deterministic rules registered in the scan pipeline.
 * Keep in sync with `src/core/scan.ts` / `src/rules/*` / docs-sync.
 */
export const RULE_CATALOG: readonly RuleInfo[] = [
  {
    id: "scripts.missing",
    title: "Missing package scripts",
    description:
      "Documented npm/pnpm/yarn/bun script invocations that were removed or renamed in package.json in the scanned diff.",
    statuses: ["confirmed"],
  },
  {
    id: "links.broken",
    title: "Broken local links",
    description:
      "Local Markdown links and file-path references pointing to files deleted or renamed in the scanned diff.",
    statuses: ["confirmed", "needs-review"],
  },
  {
    id: "env.stale",
    title: "Stale environment variable references",
    description:
      "Documented env keys removed or renamed in committed example files (.env.example and similar) in the scanned diff.",
    statuses: ["confirmed", "needs-review"],
  },
  {
    id: "docs.missing",
    title: "Missing documentation for new public surfaces",
    description:
      "New public surfaces (CLI flags/commands, Action inputs/outputs, package bins, MCP tools, opt-in env keys) or pairing-rule code changes without matching documentation updates. Opt-in via docsSync / docs_sync; status is always needs-review.",
    statuses: ["needs-review"],
  },
] as const;

const DETECTOR_LANGUAGES: Readonly<Record<SurfaceKind, readonly string[]>> = {
  "action.input": ["YAML"],
  "action.output": ["YAML"],
  "package.bin": ["JSON"],
  "package.exports": ["JSON"],
  "cli.flag": ["TypeScript", "JavaScript", "Python"],
  "cli.command": ["TypeScript", "JavaScript", "Python"],
  "cli.argv": ["TypeScript", "JavaScript", "Python"],
  "mcp.tool": ["TypeScript", "JavaScript", "Python"],
  "env.added": ["dotenv"],
};

export function listRules(): RuleInfo[] {
  return RULE_CATALOG.map((rule) => ({ ...rule, statuses: [...rule.statuses] }));
}

export function listDetectors(): DetectorInfo[] {
  return SURFACE_KINDS.map((id) => ({
    id,
    title: KIND_LABELS[id],
    defaultEnabled: DEFAULT_DETECTOR_ENABLED[id],
    languages: [...DETECTOR_LANGUAGES[id]],
  }));
}
